#!/bin/bash
# ============================================================================
# CSF Auto-Group — consolidate attacker IPs into subnet bans for ConfigServer
# Security & Firewall (CSF), keeping csf.deny from overflowing its line limit.
#
# Rules (thresholds are configurable):
#   PERMANENT /24 : >= 3 permanent singles  -> ban the /24, remove the singles
#   PERMANENT /24 : >= 5 permanent singles  -> ban /24 + "do not delete"
#   PERMANENT /16 : >= 5 singles / >=2 /24s -> warn only (once per day)
#   TEMP /24 : >= 3 temp singles, first time -> temp-ban /24 12h, count it
#   TEMP /24 : >= 3 temp singles, seen before-> permanent ban + do not delete
#   TEMP /16 : >= 5 singles / >=2 /24s       -> warn only (once per day)
#   Clears temp bans already covered by a permanent block.
#   Never bans a /24 that overlaps a CSF whitelist (csf.allow, csf.ignore,
#   GLOBAL_ALLOW/IGNORE, dyndns, temp allows, server IPs, CC_IGNORE/CC_ALLOW,
#   csf.rignore, Imunify360's local whitelist) — it is reported by email instead.
#   Alert emails show who owns each block (ASN / org / country) and each IP's
#   hostname + ban reason (DNS: PTR + Team Cymru; set LOOKUP=0 to disable).
#   Emails when the deny list reaches 80% of its limit.
#
# Usage:
#   csf_autogroup.sh                      normal run (what cron does)
#   csf_autogroup.sh --dry-run            show what a run WOULD do; changes nothing
#   csf_autogroup.sh --status [--json]    groups, watched blocks, items to review
#   csf_autogroup.sh --lookup IP [--json] who is this IP? (owner, hostname, lists)
#   csf_autogroup.sh --action NAME TARGET [DAYS] [--force] [--json]
#        ban16 A.B | ban24 A.B.C | forget A.B.C | unban CIDR
#        ignore CIDR [DAYS] | unignore CIDR          (used by the WHM plugin)
#   csf_autogroup.sh --config get|test-mail [--json]
#   csf_autogroup.sh --config set KEY=VALUE ... [--json]   validated, config.env + cron
#   csf_autogroup.sh --dry-run --set THRESHOLD_24=4 ...    try settings without saving
#   csf_autogroup.sh --digest [--send]    weekly summary: print it (or email it now)
#
# Config : optional config.env in the same dir (see config.env.example).
# Cron   : e.g.  */10 * * * * /path/csf_autogroup.sh >/dev/null 2>&1
#
# ⚠️  This script MODIFIES your firewall (auto-bans /24 subnets). Whitelist your
#     own IPs in csf.allow, start with high thresholds, and watch the log.
# ============================================================================
set -o pipefail

VERSION="1.8.0"   # sürüm — başlangıç log satırında görünür

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
[ -f "$SELF_DIR/config.env" ] && . "$SELF_DIR/config.env"

# ── Config (overridable via config.env) ─────────────────────────────────────
MSG_LANG="${MSG_LANG:-en}"                       # en | tr
ALERT_MAIL="${ALERT_MAIL:-root@localhost}"
DENY_FILE="${DENY_FILE:-/etc/csf/csf.deny}"
CSF_CONF="${CSF_CONF:-/etc/csf/csf.conf}"
CSF_BIN="${CSF_BIN:-/sbin/csf}"
CSF_DIR="${CSF_DIR:-$(dirname "$CSF_CONF")}"     # csf.allow / csf.ignore / csf.rignore
CSF_VAR="${CSF_VAR:-/var/lib/csf}"               # csf.tempban / csf.tempallow / csf.g*
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
LOGROTATE_CONF="${LOGROTATE_CONF:-/etc/logrotate.d/csf_autogroup}"   # varsa günlüğü logrotate döndürür (install.sh yazar)
SAYAC_FILE="${SAYAC_FILE:-/var/lib/csf_autogroup/counter}"
LOCK_FILE="${LOCK_FILE:-${SAYAC_FILE}.lock}"
THRESHOLD_24="${THRESHOLD_24:-3}"
THRESHOLD_24_PERMANENT="${THRESHOLD_24_PERMANENT:-5}"
THRESHOLD_16="${THRESHOLD_16:-5}"
THRESHOLD_TEMP_24="${THRESHOLD_TEMP_24:-3}"
THRESHOLD_TEMP_16="${THRESHOLD_TEMP_16:-5}"
LOOKUP="${LOOKUP:-1}"                            # 1 = hostname/owner lookups in emails
LOOKUP_TIMEOUT="${LOOKUP_TIMEOUT:-2}"            # seconds per DNS query
LOG_MAX_LINES="${LOG_MAX_LINES:-5000}"         # yalnız logrotate yoksa (yedek yöntem)
LOG_ROTATE_MB="${LOG_ROTATE_MB:-1}"             # logrotate: günlük bu boyutu geçince döndürülür
LOG_ROTATE_KEEP="${LOG_ROTATE_KEEP:-5}"         # logrotate: saklanan sıkıştırılmış arşiv sayısı
BLOCK_EXPIRE_DAYS="${BLOCK_EXPIRE_DAYS:-365}"   # bu süreden eski blok banları "eski" sayılır
BLOCK_EXPIRE_AUTO="${BLOCK_EXPIRE_AUTO:-0}"     # 1 = eski blok banları her turda kaldırılır
REPEAT16_MIN="${REPEAT16_MIN:-3}"               # şüpheli ağ, kontrol süresi içinde bu kadar ayrı günde işaretlenirse "tekrar eden"
SAYAC_RETENTION_DAYS="${SAYAC_RETENTION_DAYS:-180}"
EVENTS_FILE="${EVENTS_FILE:-$(dirname "$SAYAC_FILE")/events.jsonl}"   # WHM eklentisi / --status okur
EVENTS_MAX="${EVENTS_MAX:-5000}"   # banlar/uyarılar/elle işlemler; tur kayıtları ayrıca son RUNS_MAX
RUNS_MAX="${RUNS_MAX:-1000}"
IGNORE_FILE="${IGNORE_FILE:-$(dirname "$SAYAC_FILE")/ignored}"       # "yoksay" denen /16 ve /24'ler
REVIEW_DAYS="${REVIEW_DAYS:-7}"                                        # "kontrol edilecekler" kaç gün geriye bakar
PLUGIN_DIR="${PLUGIN_DIR:-/usr/local/cpanel/whostmgr/docroot/cgi/csf_autogroup}"   # eklenti kurulu mu?
OWNERS_FILE="${OWNERS_FILE:-$(dirname "$SAYAC_FILE")/owners}"      # /24 → ASN önbelleği (30 gün)
OWNER_TTL_DAYS="${OWNER_TTL_DAYS:-30}"
BACKFILL_MAX="${BACKFILL_MAX:-50}"      # her turda en fazla bu kadar /24'ün sahibi sorgulanır
IMUNIFY_BIN="${IMUNIFY_BIN:-$(command -v imunify360-agent 2>/dev/null)}"   # yoksa Imunify kısmı atlanır
HIST_FILE="${HIST_FILE:-$(dirname "$SAYAC_FILE")/history.jsonl}"
LOGHIST_FILE="${LOGHIST_FILE:-$(dirname "$SAYAC_FILE")/loghist.v2.jsonl}"   # günlükten çıkarılan, olay kaydından önceki işler      # "Ayrıntı" ile getirilen eski uyarılar (bir kez)
IMUNIFY_FILE="${IMUNIFY_FILE:-$(dirname "$SAYAC_FILE")/imunify}"         # yerel kara liste önbelleği
IMUNIFY_WL_FILE="${IMUNIFY_WL_FILE:-$(dirname "$SAYAC_FILE")/imunify_white}"  # yerel beyaz liste önbelleği
LFD_LOG="${LFD_LOG:-/var/log/lfd.log}"         # eski uyarıların ayrıntısı için okunur (lfd.log, .1, .gz)
IMUNIFY_REFRESH_MIN="${IMUNIFY_REFRESH_MIN:-60}"   # liste en çok bu kadar dakikada bir yeniden alınır (yalnız panelde gösterilir)
IMUNIFY_BACKFILL="${IMUNIFY_BACKFILL:-200}"   # Imunify IP'leri için turda ayrıca bu kadar /24 sorgulanır
DIGEST="${DIGEST:-1}"                   # 1 = haftalık özet maili
DIGEST_DAY="${DIGEST_DAY:-1}"           # 1 = pazartesi … 7 = pazar (09:00'dan sonraki ilk tur)
TODAY=$(date '+%Y-%m-%d')
NL=$'\n'

# ── Command line ────────────────────────────────────────────────────────────
MODE=run; JSON=0; FORCE=0; DRY=0; ACT=""; ARGS=(); SETS=(); SEND=0
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) MODE=run; DRY=1 ;;
        --status)  MODE=status ;;
        --lookup)  MODE=lookup ;;
        --action)  MODE=action; ACT="${2:-}"; shift ;;
        --config)  MODE=config ;;
        --set)     SETS+=("${2:-}"); shift ;;
        --digest)  MODE=digest ;;
        --busy)    MODE=busy ;;
        --history) MODE=history ;;
        --logrotate) MODE=logrotate ;;
        --send)    SEND=1 ;;
        --json)    JSON=1 ;;
        --force)   FORCE=1 ;;
        --version) echo "$VERSION"; exit 0 ;;
        -h|--help) sed -n '2,/^# =====/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*)        echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
        *)         ARGS+=("$1") ;;
    esac
    shift
done
# İşlemi kimin yaptığı: WHM eklentisi AG_BY ile WHM kullanıcısını geçirir.
AG_BY="${AG_BY:-root}"; [[ "$AG_BY" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || AG_BY="root"

# ── Messages (printf templates; %s placeholders) ────────────────────────────
if [ "$MSG_LANG" = "tr" ]; then
  export LANG=tr_TR.UTF-8 LC_ALL=tr_TR.UTF-8
  M_START="--- Başladı ---";                                       M_END="--- Bitti ---"
  M_END_T="--- Bitti (toplam %s sn) ---"
  M_CFG_ROTFAIL="UYARI: logrotate ayarı yazılamadı (/etc/logrotate.d)"
  M_QUIET="Tur: değişiklik yok · kalıcı %s/%s · geçici %s/%s · %s sn"
  M_STEP_OWN="Sahip sorgusu: %s blok, %s sn"
  M_STEP_IM="Imunify listesi yenilendi: %s IP, %s sn"
  M_STEP_IMFRESH="Imunify listesi güncel (%s dk önce alındı, %s dk'da bir yenilenir)"
  M_STEP_IMFAIL="Imunify listesi alınamadı (%s sn); önceki liste kullanılıyor"
  M_STEP_IMOWN="Imunify IP'lerinin sahip sorgusu: %s blok, %s sn"
  M_ERR_NOFILE="HATA: %s bulunamadı, çıkılıyor."
  M_LOCKED="ATLANDI: önceki çalışma hâlâ sürüyor"
  M_PERM_USAGE="Kalıcı Doluluk: %s / %s satır (%%%s)"
  M_PERM_WARN="UYARI: Kalıcı limit doluluk oranı %%80'i geçti!"
  M_PERM_FULL="!!! UYARI !!! Doluluk: %s / %s satır (%%%s) - ACİL MANUEL TEMİZLİK GEREKİYOR !!!"
  M_TEMP_USAGE="Geçici Doluluk: %s / %s satır (%%%s)"
  M_TEMP_WARN="UYARI: Geçici limit doluluk oranı %%80'i geçti!"
  M_TEMP_FULL="!!! UYARI !!! Geçici Doluluk: %s / %s satır (%%%s) - ACİL MANUEL TEMİZLİK GEREKİYOR !!!"
  M_NOLIMIT="ATLANDI: %s limiti bulunamadı/sıfır, doluluk kontrolü atlandı"
  M_C24_DND="Auto-grouped /24: %s kalıcı tekil nedeniyle kalıcı ban + do not delete - do not delete"
  M_C24_PERM="Auto-grouped /24: %s kalıcı tekil nedeniyle kalıcı banlandı"
  M_OK24_DND="BLOK BANI: %s.0/24 (%s kalıcı tekil) [do not delete]"
  M_OK24="BLOK BANI: %s.0/24 (%s kalıcı tekil)"
  M_B24_DND="%s.0/24 -> %s kalıcı tekil, kalıcı blok banı + do not delete"
  M_B24="%s.0/24 -> %s kalıcı tekil, kalıcı blok banı"
  M_DELSINGLE="Silindi tekil: %s"
  M_DELSINGLE_FAIL="UYARI tekil silinemedi: %s"
  M_KEPT_DND="Tekil tutuldu (do not delete): %s"
  M_TAG_FAIL="silinemedi";                                         M_TAG_KEPT="do not delete, tutuldu"
  M_ADD24_FAIL="HATA blok banı eklenemedi: %s.0/24"
  M_24_DONE="Blok turu bitti. %s yeni blok banı."
  M_MAIL24_BODY="Aşağıdaki bloklar (/24) kalıcı banlandı, içlerindeki tekil banlar silindi:"
  M_MAIL24_SUBJ="%s blok banı"
  M_OWNER="   Sahibi: %s"
  M_WARN16="ŞÜPHELİ AĞ: %s.0.0/16 - kalıcı banlardan %s IP, %s farklı blok - elle bakın"
  M_WARN16_B="%s.0.0/16 -> %s IP, %s farklı bloktan"
  M_SKIP16="ATLANDI şüpheli ağ: %s.0.0/16 bugün zaten bildirildi"
  M_16_DONE="Şüpheli ağ turu bitti. %s bildirim."
  M_MAIL16_BODY="Aşağıdaki ağlarda (/16) çok sayıda kalıcı ban birikti. Ağ banlanmadı;\nelle bakmanız önerilir:"
  M_MAIL16_SUBJ="%s şüpheli ağ"
  M_TCLEAN="Temizlendi: %s (kalıcı ban kapsamında)"
  M_TSKIP24="ATLANDI geçici blok: %s.0/24 zaten kalıcı banlı"
  M_TC24_PERM="Auto-grouped from temp /24: %s geçici tekil, 2. kez grup saldırısı nedeniyle kalıcı banlandı - do not delete"
  M_TOK24_PERM="KALICIYA ALINDI: %s.0/24 (%s geçici tekil) [2. kez geldi - do not delete]"
  M_TB24_PERM="%s.0/24 -> %s geçici tekil, 2. kez geldi, kalıcı blok banı [do not delete]"
  M_TADD24_FAIL="HATA blok kalıcıya alınamadı: %s.0/24"
  M_TOK24="GEÇİCİ BLOK BANI: %s.0/24 (%s geçici tekil) [12 saat, ilk kez]"
  M_TB24="%s.0/24 -> %s geçici tekil, 12 saatlik geçici blok banı (ilk kez)"
  M_TADD24T_FAIL="HATA geçici blok banı eklenemedi: %s.0/24"
  M_TC24="Auto-grouped temp /24: %s geçici tekil (12 saat)"
  M_T24_DONE="Geçici blok turu bitti. %s yeni geçici blok banı, %s kalıcıya alındı."
  M_MAILT24_BODY="Aşağıdaki bloklar (/24) 12 saatliğine geçici banlandı:"
  M_MAILT24_SUBJ="%s geçici blok banı"
  M_MAILT24P_BODY="Aşağıdaki bloklar (/24) daha önce geçici banlanmıştı; tekrar geldikleri için kalıcı banlandı (do not delete):"
  M_MAILT24P_SUBJ="%s blok kalıcıya alındı"
  M_TWARN16="ŞÜPHELİ AĞ: %s.0.0/16 - geçici banlardan %s IP, %s farklı blok - elle bakın"
  M_TSKIP16="ATLANDI şüpheli ağ: %s.0.0/16 zaten kalıcı banlı"
  M_TSKIP16D="ATLANDI şüpheli ağ (geçici): %s.0.0/16 bugün zaten bildirildi"
  M_T16_DONE="Şüpheli ağ turu (geçici banlar) bitti. %s bildirim."
  M_MAILT16_BODY="Aşağıdaki ağlarda (/16) çok sayıda geçici ban birikti. Ağ banlanmadı;\nelle bakmanız önerilir:"
  M_MAILT16_SUBJ="%s şüpheli ağ (geçici banlar)"
  M_WL_LOADED="Beyaz liste yüklendi: %s aralık, %s rignore alan adı"
  M_WL_SELF="sunucu IP'si"
  M_WL_SKIP="ATLANDI %s: beyaz listeyle çakışıyor (%s)"
  M_WL_SKIPD="ATLANDI %s: beyaz listede (%s), bugün zaten bildirildi"
  M_WL_RETRY="ATLANDI %s: beyaz liste (%s) DNS hatası nedeniyle doğrulanamadı, sonraki turda tekrar denenecek"
  M_WL_B="%s -> %s tekil, BANLANMADI. Beyaz liste: %s"
  M_WL_NOTE="   Not: içinde beyaz listede kayıt var (%s)"
  M_MAILWL_BODY="Aşağıdaki bloklar ban eşiğine ulaştı ama CSF beyaz listeleriyle çakıştığı için banlanmadı.\nTekil banlar yerinde duruyor:"
  M_MAILWL_SUBJ="%s blok atlandı (beyaz liste)"
  M_CC_NOLOOKUP="UYARI: CC_IGNORE/CC_ALLOW veya csf.rignore tanımlı ama DNS sorgusu yapılamıyor (LOOKUP=0 ya da dig/host yok); bu kontroller atlandı"
  M_LOOKUP_OFF="UYARI: DNS sorguları art arda zaman aşımına uğradı, bu turda kapatıldı"
  M_CLEANCNT="Sayaç temizliği yapıldı (%s günden eski kayıtlar silindi)"
  M_LOGTRIM="Günlük %s satırda tutuldu (önceki: %s satır)"
  M_MAIL_PERMFULL_SUBJ="kalıcı liste %%%s dolu"
  M_MAIL_PERMFULL_BODY="CSF deny listesi limite yaklaşıyor!"
  M_MAIL_TEMPFULL_SUBJ="geçici liste %%%s dolu"
  M_MAIL_TEMPFULL_BODY="CSF geçici ban listesi limite yaklaşıyor!"
  M_MAIL_DETAIL="Detay için: tail -100 %s"
  M_SUBJ_PREFIX="CSF Auto-Group: "
  M_EXP_SUBJ="%s eski blok banı kaldırıldı"
  M_EXP_BODY="Aşağıdaki blok banları %s günden eski olduğu için kaldırıldı (Ayarlar → Saklama):"
  M_EXP_LINE="%s -> %s gün önce eklenmişti"
  M_EXP_LOG="ESKİ BLOK KALDIRILDI: %s (%s gün)"
  M_EXP_FAIL="HATA eski blok kaldırılamadı: %s"
  M_A_EXPIRED="%s eski blok banı kaldırıldı"
  M_A_EXPNONE="Kaldırılacak eski blok banı yok"
  M_DG_UPD="Yeni sürüm var: v%s → v%s. Eklentideki Güncelle düğmesiyle ya da update.sh ile kurulabilir."
  M_H_LFD="LFD çalışmıyor"
  M_H_CSF_OFF="CSF devre dışı (csf.disable)"
  M_H_CSF_TEST="CSF test modunda (TESTING = 1)"
  M_H_CSF_RULES="CSF kuralları yüklü değil"
  M_H_BODY="Güvenlik duvarında sorun var; CSF Auto-Group bu durumda işini yapamaz. Günde bir kez bildirilir:"
  M_H_LOG="SORUN: %s"
  M_PANEL_GEN="Panel: %s → Eklentiler → CSF Auto-Group"
  M_DRY_ON="KURU ÇALIŞTIRMA — hiçbir şey değiştirilmeyecek, mail gönderilmeyecek"
  M_DRY_MAIL="[gönderilmeyecek mail] Kime: %s — Konu: %s"
  M_IGN16="ATLANDI şüpheli ağ: %s.0.0/16 yoksayılıyor (%s tarihine kadar)"
  M_BUSY="Başka bir çalışma sürüyor, biraz sonra tekrar deneyin"
  M_BAD_TARGET="Geçersiz hedef: %s"
  M_BAD_IP="Geçersiz IPv4 adresi: %s"
  M_A_UNKNOWN="Bilinmeyen işlem: %s"
  M_A_LOG="ELLE (%s): %s"
  M_A_EXISTS="%s zaten kalıcı bir blok kapsamında"
  M_A_WL="%s beyaz listeyle çakışıyor (%s). Yine de banlamak için ayrıca onay gerekiyor"
  M_A_BANNED="%s kalıcı banlandı (do not delete)"
  M_A_BANFAIL="%s eklenemedi: %s"
  M_A_COMMENT="csf_autogroup: elle /%s ban (%s) - do not delete"
  M_A_FORGOT="%s izlemeden çıkarıldı"
  M_A_NOREC="%s izlenmiyor"
  M_A_UNBANNED="%s kaldırıldı"
  M_A_UNBANFAIL="%s kaldırılamadı: %s"
  M_A_NOTFOUND="%s ne csf.deny'de ne geçici listede birebir bulunamadı"
  M_A_IGNORED="%s %s tarihine kadar yoksayılacak"
  M_A_UNIGNORED="%s artık yoksayılmıyor"
  M_A_NOTIGN="%s yoksayılanlar listesinde değil"
  M_S_TITLE="CSF Auto-Group %s — durum"
  M_S_LAST="Son çalışma"; M_S_NEVER="henüz yok"; M_S_RUNNING="şu an çalışıyor"
  M_S_USAGE="Doluluk"; M_S_PERM="kalıcı"; M_S_TEMP="geçici"
  M_S_REVIEW="Kontrol edilecekler (%s gün)"; M_S_PENDING="İzlenenler"
  M_S_GROUPS="Aktif blok banları"; M_S_IGNORED="Yoksayılanlar"; M_S_RECENT="Son işlemler"
  M_S_NONE="yok"; M_S_DAYSLEFT="%s gün kaldı"; M_S_TTL="geçici ban %s kaldı"
  M_L_HOST="Hostname"; M_L_FWD="ileri yönde doğrulandı"; M_L_NOFWD="ileri yönde doğrulanamadı"
  M_L_OWNER="Sahibi"; M_L_PREFIX="Duyurulan blok"; M_L_REG="Kayıt"; M_L_DENY="csf.deny"
  M_L_TEMP="Geçici liste"; M_L_WL="Beyaz liste"; M_L_PENDING="İzleniyor"; M_L_IGN="Yoksayılıyor"
  M_H_NOREASON="geçici ban (günlükte sebep yok)"
  M_CFG_BAD="Geçersiz değer: %s = %s (%s olmalı)"
  M_CFG_RANGE="%s ile %s arası bir tam sayı"
  M_CFG_EMAIL="geçerli bir e-posta adresi"
  M_CFG_ONEOF="şunlardan biri: %s"
  M_CFG_UNKNOWN="Bu ayar buradan değiştirilemez: %s"
  M_CFG_RULE="do not delete eşiği (%s), /24 ban eşiğinden (%s) küçük olamaz"
  M_CFG_SAVED="Ayarlar kaydedildi (%s değişiklik)"
  M_CFG_NOCHANGE="Değişiklik yok"
  M_CFG_LOG="AYAR (%s): %s: %s → %s"
  M_CFG_WFAIL="config.env yazılamadı"
  M_CFG_CRONFAIL="crontab güncellenemedi"
  M_DRY_OVR="Denenen ayarlar (kaydedilmedi): %s"
  M_DRY_NOSET="--set yalnızca --dry-run ile kullanılabilir"
  M_TM_SUBJ="CSF Auto-Group test maili"
  M_TM_BODY="Bu bir test mailidir. %s sunucusundaki CSF Auto-Group uyarıları bu adrese gelecek.\nGönderen: %s"
  M_TM_SENT="Test maili %s adresine gönderildi (mail komutu kabul etti)"
  M_TM_FAIL="mail komutu hata verdi: %s"
  M_DG_SUBJ="CSF Auto-Group haftalık özet (%s)"
  M_DG_HEAD="Son 7 gün: %s – %s"
  M_DG_COUNTS="%s blok banı · %s geçici blok banı · %s kalıcıya alındı · %s şüpheli ağ · %s atlandı (beyaz liste) · %s elle işlem"
  M_DG_USAGE="Kalıcı liste: %s / %s satır (%%%s) · 7 gün önce: %s"
  M_DG_TUSAGE="Geçici liste: %s / %s satır"
  M_DG_NEW="Yeni blok banları:"
  M_DG_TOP="En çok saldıran sağlayıcılar (ASN; blok banları ve tekil banlara göre):"
  M_DG_TOPL="   %-9s %-44s %s"
  M_DG_PG="%s blok"; M_DG_PB="+%s blok başka kaynaklı"; M_DG_PT="%s tekil"
  M_DG_EXP="14 gün içinde izlemesi bitecek bloklar (tekrar gelirlerse kalıcı olurlar):"
  M_DG_EXPL="   %-18s %s gün"
  M_DG_RUNS="Tur sağlığı: son 7 günde %s tur çalıştı (cron aralığına göre beklenen ~%s)"
  M_DG_IM="Imunify360'ın en çok engellediği sağlayıcılar (sunucunun kendi kara listesi, %s IP):"
  M_DG_IML="   %-9s %-44s %s IP%s"
  M_DG_NONE="   yok"
  M_DG_SENT="Haftalık özet gönderildi: %s"
else
  M_START="--- Started ---";                                       M_END="--- Done ---"
  M_END_T="--- Done (%s s total) ---"
  M_CFG_ROTFAIL="WARNING: could not write the logrotate config (/etc/logrotate.d)"
  M_QUIET="Run: no changes · permanent %s/%s · temp %s/%s · %s s"
  M_STEP_OWN="Owner lookups: %s blocks, %s s"
  M_STEP_IM="Imunify list refreshed: %s IPs, %s s"
  M_STEP_IMFRESH="Imunify list is current (fetched %s min ago, refreshed every %s min)"
  M_STEP_IMFAIL="Could not fetch the Imunify list (%s s); keeping the previous one"
  M_STEP_IMOWN="Owner lookups for Imunify IPs: %s blocks, %s s"
  M_ERR_NOFILE="ERROR: %s not found, exiting."
  M_LOCKED="SKIPPED: previous run still in progress"
  M_PERM_USAGE="Permanent deny usage: %s / %s lines (%s%%)"
  M_PERM_WARN="WARNING: permanent deny list is over 80%% full!"
  M_PERM_FULL="!!! WARNING !!! Usage: %s / %s lines (%s%%) - MANUAL CLEANUP NEEDED !!!"
  M_TEMP_USAGE="Temp deny usage: %s / %s lines (%s%%)"
  M_TEMP_WARN="WARNING: temp deny list is over 80%% full!"
  M_TEMP_FULL="!!! WARNING !!! Temp usage: %s / %s lines (%s%%) - MANUAL CLEANUP NEEDED !!!"
  M_NOLIMIT="SKIPPED: %s limit missing/zero, usage check skipped"
  M_C24_DND="Auto-grouped /24: %s permanent singles -> permanent ban + do not delete - do not delete"
  M_C24_PERM="Auto-grouped /24: %s permanent singles -> permanent ban"
  M_OK24_DND="BLOCK BAN: %s.0/24 (%s permanent singles) [do not delete]"
  M_OK24="BLOCK BAN: %s.0/24 (%s permanent singles)"
  M_B24_DND="%s.0/24 -> %s permanent singles, permanent block ban + do not delete"
  M_B24="%s.0/24 -> %s permanent singles, permanent block ban"
  M_DELSINGLE="Removed single: %s"
  M_DELSINGLE_FAIL="WARNING could not remove single: %s"
  M_KEPT_DND="Single kept (do not delete): %s"
  M_TAG_FAIL="not removed";                                        M_TAG_KEPT="do not delete, kept"
  M_ADD24_FAIL="ERROR could not add block ban: %s.0/24"
  M_24_DONE="Block pass done. %s new block ban(s)."
  M_MAIL24_BODY="The following blocks (/24) were permanently banned and the single bans inside them removed:"
  M_MAIL24_SUBJ="%s block ban(s)"
  M_OWNER="   Owner: %s"
  M_WARN16="SUSPICIOUS RANGE: %s.0.0/16 - %s IPs from permanent bans, %s distinct blocks - review manually"
  M_WARN16_B="%s.0.0/16 -> %s IPs across %s distinct blocks"
  M_SKIP16="SKIPPED suspicious range: %s.0.0/16 already reported today"
  M_16_DONE="Suspicious range pass done. %s report(s)."
  M_MAIL16_BODY="Many permanent bans have piled up in the following ranges (/16). The range was not banned;\nmanual review recommended:"
  M_MAIL16_SUBJ="%s suspicious range(s)"
  M_TCLEAN="Cleaned: %s (covered by a permanent ban)"
  M_TSKIP24="SKIPPED temp block: %s.0/24 already permanently banned"
  M_TC24_PERM="Auto-grouped from temp /24: %s temp singles, 2nd group attack -> permanent ban - do not delete"
  M_TOK24_PERM="MADE PERMANENT: %s.0/24 (%s temp singles) [came back - do not delete]"
  M_TB24_PERM="%s.0/24 -> %s temp singles, came back, permanent block ban [do not delete]"
  M_TADD24_FAIL="ERROR could not make block permanent: %s.0/24"
  M_TOK24="TEMP BLOCK BAN: %s.0/24 (%s temp singles) [12h, first time]"
  M_TB24="%s.0/24 -> %s temp singles, 12-hour temp block ban (first time)"
  M_TADD24T_FAIL="ERROR could not add temp block ban: %s.0/24"
  M_TC24="Auto-grouped temp /24: %s temp singles (12h)"
  M_T24_DONE="Temp block pass done. %s new temp block ban(s), %s made permanent."
  M_MAILT24_BODY="The following blocks (/24) were temp-banned for 12 hours:"
  M_MAILT24_SUBJ="%s temp block ban(s)"
  M_MAILT24P_BODY="The following blocks (/24) had been temp-banned before and came back, so they are now permanently banned (do not delete):"
  M_MAILT24P_SUBJ="%s block(s) made permanent"
  M_TWARN16="SUSPICIOUS RANGE: %s.0.0/16 - %s IPs from temp bans, %s distinct blocks - review manually"
  M_TSKIP16="SKIPPED suspicious range: %s.0.0/16 already permanently banned"
  M_TSKIP16D="SKIPPED suspicious range (temp): %s.0.0/16 already reported today"
  M_T16_DONE="Suspicious range pass (temp bans) done. %s report(s)."
  M_MAILT16_BODY="Many temp bans have piled up in the following ranges (/16). The range was not banned;\nmanual review recommended:"
  M_MAILT16_SUBJ="%s suspicious range(s) (temp bans)"
  M_WL_LOADED="Whitelist loaded: %s ranges, %s rignore domains"
  M_WL_SELF="server IP"
  M_WL_SKIP="SKIPPED %s: overlaps a whitelist entry (%s)"
  M_WL_SKIPD="SKIPPED %s: whitelisted (%s), already reported today"
  M_WL_RETRY="SKIPPED %s: whitelist (%s) could not be verified (DNS failure), will retry next run"
  M_WL_B="%s -> %s singles, NOT banned. Whitelist: %s"
  M_WL_NOTE="   Note: contains a whitelist entry (%s)"
  M_MAILWL_BODY="The following blocks reached the ban threshold but were NOT banned because they overlap a CSF whitelist.\nThe single bans stay in place:"
  M_MAILWL_SUBJ="%s block(s) skipped (whitelist)"
  M_CC_NOLOOKUP="WARNING: CC_IGNORE/CC_ALLOW or csf.rignore is set but DNS lookups are unavailable (LOOKUP=0 or no dig/host); those checks were skipped"
  M_LOOKUP_OFF="WARNING: DNS lookups timed out repeatedly, disabled for this run"
  M_CLEANCNT="Counter cleaned (records older than %s days removed)"
  M_LOGTRIM="Log trimmed to %s lines (was: %s lines)"
  M_MAIL_PERMFULL_SUBJ="permanent list %s%% full"
  M_MAIL_PERMFULL_BODY="CSF deny list is approaching its limit!"
  M_MAIL_TEMPFULL_SUBJ="temp list %s%% full"
  M_MAIL_TEMPFULL_BODY="CSF temp ban list is approaching its limit!"
  M_MAIL_DETAIL="Details: tail -100 %s"
  M_SUBJ_PREFIX="CSF Auto-Group: "
  M_EXP_SUBJ="%s old block ban(s) removed"
  M_EXP_BODY="The following block bans were removed because they are older than %s days (Settings → Retention):"
  M_EXP_LINE="%s -> added %s days ago"
  M_EXP_LOG="OLD BLOCK REMOVED: %s (%s days)"
  M_EXP_FAIL="ERROR could not remove old block: %s"
  M_A_EXPIRED="%s old block ban(s) removed"
  M_A_EXPNONE="No old block bans to remove"
  M_DG_UPD="A new version is available: v%s → v%s. Install it with the Update button in the plugin or update.sh."
  M_H_LFD="LFD is not running"
  M_H_CSF_OFF="CSF is disabled (csf.disable)"
  M_H_CSF_TEST="CSF is in testing mode (TESTING = 1)"
  M_H_CSF_RULES="CSF rules are not loaded"
  M_H_BODY="There is a problem with the firewall; CSF Auto-Group can't do its job like this. Reported once a day:"
  M_H_LOG="PROBLEM: %s"
  M_PANEL_GEN="Panel: %s → Plugins → CSF Auto-Group"
  M_DRY_ON="DRY RUN — nothing will be changed, no email will be sent"
  M_DRY_MAIL="[email not sent] To: %s — Subject: %s"
  M_IGN16="SKIPPED suspicious range: %s.0.0/16 is ignored (until %s)"
  M_BUSY="Another run is in progress, try again in a moment"
  M_BAD_TARGET="Invalid target: %s"
  M_BAD_IP="Invalid IPv4 address: %s"
  M_A_UNKNOWN="Unknown action: %s"
  M_A_LOG="MANUAL (%s): %s"
  M_A_EXISTS="%s is already covered by a permanent block"
  M_A_WL="%s overlaps a whitelist entry (%s). Banning it anyway needs an extra confirmation"
  M_A_BANNED="%s permanently banned (do not delete)"
  M_A_BANFAIL="%s could not be added: %s"
  M_A_COMMENT="csf_autogroup: manual /%s ban (%s) - do not delete"
  M_A_FORGOT="%s is no longer watched"
  M_A_NOREC="%s is not watched"
  M_A_UNBANNED="%s removed"
  M_A_UNBANFAIL="%s could not be removed: %s"
  M_A_NOTFOUND="%s is not in csf.deny or the temp list (exact match)"
  M_A_IGNORED="%s will be ignored until %s"
  M_A_UNIGNORED="%s is no longer ignored"
  M_A_NOTIGN="%s is not on the ignore list"
  M_S_TITLE="CSF Auto-Group %s — status"
  M_S_LAST="Last run"; M_S_NEVER="none yet"; M_S_RUNNING="running now"
  M_S_USAGE="Usage"; M_S_PERM="permanent"; M_S_TEMP="temp"
  M_S_REVIEW="To review (%s days)"; M_S_PENDING="Watched"
  M_S_GROUPS="Active block bans"; M_S_IGNORED="Ignored"; M_S_RECENT="Recent actions"
  M_S_NONE="none"; M_S_DAYSLEFT="%s days left"; M_S_TTL="temp ban %s left"
  M_L_HOST="Hostname"; M_L_FWD="forward-confirmed"; M_L_NOFWD="not forward-confirmed"
  M_L_OWNER="Owner"; M_L_PREFIX="Announced prefix"; M_L_REG="Registry"; M_L_DENY="csf.deny"
  M_L_TEMP="Temp list"; M_L_WL="Whitelist"; M_L_PENDING="Watched"; M_L_IGN="Ignored"
  M_H_NOREASON="temp ban (no reason in the log)"
  M_CFG_BAD="Invalid value: %s = %s (must be %s)"
  M_CFG_RANGE="a whole number from %s to %s"
  M_CFG_EMAIL="a valid email address"
  M_CFG_ONEOF="one of: %s"
  M_CFG_UNKNOWN="This setting can't be changed here: %s"
  M_CFG_RULE="the do not delete threshold (%s) can't be lower than the /24 ban threshold (%s)"
  M_CFG_SAVED="Settings saved (%s changes)"
  M_CFG_NOCHANGE="Nothing changed"
  M_CFG_LOG="SETTING (%s): %s: %s → %s"
  M_CFG_WFAIL="config.env could not be written"
  M_CFG_CRONFAIL="crontab could not be updated"
  M_DRY_OVR="Trying settings (not saved): %s"
  M_DRY_NOSET="--set only works together with --dry-run"
  M_TM_SUBJ="CSF Auto-Group test email"
  M_TM_BODY="This is a test email. CSF Auto-Group alerts from %s will arrive at this address.\nSent by: %s"
  M_TM_SENT="Test email handed to the mail command for %s"
  M_TM_FAIL="the mail command failed: %s"
  M_DG_SUBJ="CSF Auto-Group weekly summary (%s)"
  M_DG_HEAD="Last 7 days: %s – %s"
  M_DG_COUNTS="%s block bans · %s temp block bans · %s made permanent · %s suspicious ranges · %s skipped (whitelist) · %s manual actions"
  M_DG_USAGE="Permanent list: %s / %s lines (%s%%) · 7 days ago: %s"
  M_DG_TUSAGE="Temp list: %s / %s lines"
  M_DG_NEW="New block bans:"
  M_DG_TOP="Top attacking providers (ASN; by block bans and single bans):"
  M_DG_TOPL="   %-9s %-44s %s"
  M_DG_PG="%s blocks"; M_DG_PB="+%s blocks from other sources"; M_DG_PT="%s singles"
  M_DG_EXP="Watched blocks expiring within 14 days (become permanent if they return):"
  M_DG_EXPL="   %-18s %s days"
  M_DG_RUNS="Run health: %s runs in the last 7 days (about %s expected from the cron interval)"
  M_DG_IM="Providers Imunify360 blocks most (this server's own blacklist, %s IPs):"
  M_DG_IML="   %-9s %-44s %s IPs%s"
  M_DG_NONE="   none"
  M_DG_SENT="Weekly summary sent: %s"
fi
m() { local f="$1"; shift; printf -- "$f" "$@"; }   # "--" : "--- Bitti …" gibi şablonlar seçenek sanılmasın

# LOG_MODE: tee = ekrana + dosyaya (normal çalışma) · file = yalnız dosyaya (--action, çıktı JSON'a
# karışmasın) · quiet = hiçbir yere (--status/--lookup salt okur) · kuru çalıştırmada yalnız ekrana.
LOG_MODE=tee
log() {
    local line
    printf -v line '[%(%Y-%m-%d %H:%M:%S)T] %s' -1 "$1"
    if [ "$DRY" = 1 ]; then echo "$line"; return; fi
    log_flush
    case "$LOG_MODE" in
        quiet) ;;
        file)  echo "$line" >> "$LOG_FILE" ;;
        *)     printf '%s\n' "$line"; printf '%s\n' "$line" >> "$LOG_FILE" ;;
    esac
}
# Rutin satırlar (başladı, doluluk, "turu bitti: 0", adım süreleri): ekrana her zaman yazılır; dosyaya
# yalnız turda bir şey olduysa. Hiçbir şey olmayan tur dosyaya tek özet satırı bırakır — yoksa günlük
# her turda ~11 satır büyür, satır sınırı dolar ve gerçek işler birkaç günde silinirdi.
RUN_MODE=0; EVENTFUL=0; RBUF=()
log_flush() {    # biriken rutin satırları dosyaya yaz; bundan sonra tur "olaylı" sayılır
    [ "$RUN_MODE" = 1 ] && [ "$EVENTFUL" = 0 ] || return 0
    EVENTFUL=1
    [ "$DRY" = 1 ] || [ ${#RBUF[@]} -eq 0 ] || printf '%s\n' "${RBUF[@]}" >> "$LOG_FILE"
    RBUF=()
}
logr() {
    if [ "$RUN_MODE" != 1 ] || [ "$DRY" = 1 ] || [ "$LOG_MODE" != tee ] || [ "$EVENTFUL" = 1 ]; then log "$1"; return; fi
    local line
    printf -v line '[%(%Y-%m-%d %H:%M:%S)T] %s' -1 "$1"
    printf '%s\n' "$line"; RBUF+=("$line")
}
# Kilit (fd 9) alt süreçlere geçmesin: arka planda teslimat yapan bir MTA kilidi tutup sonraki turları engellemesin.
mail() {
    if [ "$DRY" = 1 ]; then          # kuru çalıştırma: mail gönderme, ne gideceğini göster
        local subj="" to="" a
        while [ $# -gt 0 ]; do a="$1"; shift; if [ "$a" = "-s" ]; then subj="$1"; shift; else to="$a"; fi; done
        echo; m "$M_DRY_MAIL" "$to" "$subj"; echo; sed 's/^/    │ /'; echo
        return 0
    fi
    command mail "$@" 9>&-
}

# ── Settings: validation (panel + --config set + --dry-run --set) ──────────
# Paneldeki her alanın tek kuralı burada; eklenti ayrıca kontrol etse de karar burada verilir.
CFG_KEYS="MSG_LANG ALERT_MAIL DIGEST DIGEST_DAY THRESHOLD_24 THRESHOLD_24_PERMANENT THRESHOLD_16 THRESHOLD_TEMP_24 THRESHOLD_TEMP_16 LOOKUP LOOKUP_TIMEOUT SAYAC_RETENTION_DAYS REVIEW_DAYS LOG_MAX_LINES LOG_ROTATE_MB LOG_ROTATE_KEEP BLOCK_EXPIRE_DAYS BLOCK_EXPIRE_AUTO CRON_MIN"
CFG_TRY_KEYS="THRESHOLD_24 THRESHOLD_24_PERMANENT THRESHOLD_16 THRESHOLD_TEMP_24 THRESHOLD_TEMP_16 LOOKUP LOOKUP_TIMEOUT SAYAC_RETENTION_DAYS REVIEW_DAYS"
logrotate_write() { # [MB] [ARŞİV] → /etc/logrotate.d/csf_autogroup (geçici dosya + mv)
    local mb="${1:-$LOG_ROTATE_MB}" keep="${2:-$LOG_ROTATE_KEEP}" tmp
    [ -d "$(dirname "$LOGROTATE_CONF")" ] && command -v logrotate >/dev/null 2>&1 || return 1
    [[ "$LOG_FILE" =~ ^/[A-Za-z0-9._/-]+$ && "$mb" =~ ^[0-9]+$ && "$keep" =~ ^[0-9]+$ ]] || return 1
    tmp="$LOGROTATE_CONF.new.$$"
    printf '%s {\n    size %sM\n    rotate %s\n    compress\n    delaycompress\n    missingok\n    notifempty\n    create 0600 root root\n}\n' \
        "$LOG_FILE" "$mb" "$keep" > "$tmp" && chmod 0644 "$tmp" && mv -f "$tmp" "$LOGROTATE_CONF" || { rm -f "$tmp"; return 1; }
}
cfg_check() {    # KEY VALUE → 0 geçerli (CFG_VAL = normalleştirilmiş değer), 1 değil (CFG_ERR)
    local k="$1" v="$2" lo="" hi="" opts=""
    CFG_ERR=""; CFG_VAL="$v"
    case "$k" in
        MSG_LANG) opts="tr en" ;;
        LOOKUP) opts="0 1" ;;
        CRON_MIN) opts="*/5 */10 */15 */30 0" ;;
        DIGEST) opts="0 1" ;;
        DIGEST_DAY) opts="1 2 3 4 5 6 7" ;;
        ALERT_MAIL)
            # Yerel adresler de geçerli: "root", "root@localhost" (cPanel root'un postasını
            # sunucunun iletişim adresine yönlendirir; script'in varsayılanı da budur).
            [[ "$v" =~ ^[A-Za-z0-9._%+-]+(@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)?$ ]] && [ ${#v} -le 254 ] && return 0
            CFG_ERR=$(m "$M_CFG_BAD" "$k" "$v" "$M_CFG_EMAIL"); return 1 ;;
        THRESHOLD_24|THRESHOLD_TEMP_24) lo=2; hi=50 ;;
        THRESHOLD_24_PERMANENT) lo=2; hi=100 ;;
        THRESHOLD_16|THRESHOLD_TEMP_16) lo=2; hi=500 ;;
        LOOKUP_TIMEOUT) lo=1; hi=10 ;;
        SAYAC_RETENTION_DAYS) lo=7; hi=730 ;;
        REVIEW_DAYS) lo=1; hi=90 ;;
        LOG_MAX_LINES) lo=500; hi=100000 ;;
        LOG_ROTATE_MB) lo=1; hi=100 ;;
        LOG_ROTATE_KEEP) lo=1; hi=52 ;;
        BLOCK_EXPIRE_DAYS) lo=30; hi=3650 ;;
        BLOCK_EXPIRE_AUTO) opts="0 1" ;;
        *) CFG_ERR=$(m "$M_CFG_UNKNOWN" "$k"); return 1 ;;
    esac
    if [ -n "$opts" ]; then
        case " $opts " in *" $v "*) return 0 ;; esac
        CFG_ERR=$(m "$M_CFG_BAD" "$k" "$v" "$(m "$M_CFG_ONEOF" "${opts// /, }")"); return 1
    fi
    if [[ "$v" =~ ^[0-9]{1,6}$ ]] && (( 10#$v >= lo && 10#$v <= hi )); then CFG_VAL=$((10#$v)); return 0; fi
    CFG_ERR=$(m "$M_CFG_BAD" "$k" "$v" "$(m "$M_CFG_RANGE" "$lo" "$hi")"); return 1
}
cfg_rules() {    # T24 T24P → çapraz kural
    CFG_ERR=""
    if [ "$2" -lt "$1" ]; then CFG_ERR=$(m "$M_CFG_RULE" "$2" "$1"); return 1; fi
    return 0
}
if [ ${#SETS[@]} -gt 0 ]; then
    if [ "$MODE" != run ] || [ "$DRY" != 1 ]; then echo "$M_DRY_NOSET" >&2; exit 2; fi
    for kv in "${SETS[@]}"; do
        k="${kv%%=*}"; v="${kv#*=}"
        case " $CFG_TRY_KEYS " in *" $k "*) ;; *) m "$M_CFG_UNKNOWN" "$k" >&2; echo >&2; exit 2 ;; esac
        cfg_check "$k" "$v" || { echo "$CFG_ERR" >&2; exit 2; }
        printf -v "$k" '%s' "$CFG_VAL"
    done
    cfg_rules "$THRESHOLD_24" "$THRESHOLD_24_PERMANENT" || { echo "$CFG_ERR" >&2; exit 2; }
fi

# ── Panel link in emails ────────────────────────────────────────────────────
# Düz WHM adresi + yol tarifi. WHM adresindeki oturum parçası (cpsess…) maile konamaz
# (birkaç saatte geçersizleşir); cPanel'in goto_uri parametresi de 2FA'lı form girişinde
# dikkate alınmadı — sunucuda iki yoldan (/?goto_uri= ve /login/?goto_uri=) denendi (2026-09-26).
panel_auto() { local h; h=$(hostname -f 2>/dev/null || hostname 2>/dev/null); [ -n "$h" ] && echo "https://$h:2087"; }
PANEL_FOOT=""
panel_init() {   # yalnız eklenti kuruluysa: maillerin sonuna eklenecek satır (bir kez)
    local base
    [ -d "$PLUGIN_DIR" ] || return
    base="$(panel_auto)"      # sunucu adından otomatik: https://$(hostname -f):2087
    [ -n "$base" ] && PANEL_FOOT="$(m "$M_PANEL_GEN" "$base/")$NL"
}

# ── IPv4 / CIDR helpers ─────────────────────────────────────────────────────
# Sonuçlar REPLY / R_LO / R_HI ile döner (alt kabuk yok → önbellekler korunur).
IPV4_RE='^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'
CIDR4_RE='^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(/[0-9]{1,2})?$'
ip2int() { local IFS=.; set -- $1; REPLY=$(( (10#$1 << 24) + (10#$2 << 16) + (10#$3 << 8) + 10#$4 )); }
cidr_range() {   # "a.b.c.d[/n]" → R_LO..R_HI; geçersizse 1 döner (/0 da reddedilir)
    local ip="${1%%/*}" bits=32 o
    [[ "$1" == */* ]] && bits="${1#*/}"
    [[ "$ip" =~ $IPV4_RE && "$bits" =~ ^[0-9]+$ ]] || return 1
    (( bits >= 1 && bits <= 32 )) || return 1
    for o in ${ip//./ }; do (( 10#$o <= 255 )) || return 1; done
    ip2int "$ip"
    local size=$(( 1 << (32 - bits) ))
    R_LO=$(( REPLY - REPLY % size )); R_HI=$(( R_LO + size - 1 ))
}
# Satır başına sabitlenmiş arama: "1.2.3.0/24" artık "21.2.3.0/24" satırını bulmaz.
deny_has() { grep -qE "^${1//./\\.}([[:space:]]|$)" "$DENY_FILE"; }
perm_covers() {  # LO HI → csf.deny içindeki bir CIDR bu aralığın tamamını kapsıyor mu?
    local i
    for i in "${!DC_LO[@]}"; do (( DC_LO[i] <= $1 && DC_HI[i] >= $2 )) && return 0; done
    return 1
}
temp_covers() {  # LO HI → aktif bir geçici CIDR ban bu aralığı kapsıyor mu?
    local i
    for i in "${!TC_LO[@]}"; do (( TC_LO[i] <= $1 && TC_HI[i] >= $2 )) && return 0; done
    return 1
}
perm_added()   { [ "$DRY" = 1 ] || deny_has "$1"; }                   # csf -d gerçekten yazdı mı?
still_denied() { [ "$DRY" = 1 ] && return 1; deny_has "$1"; }           # csf -dr sonrası satır duruyor mu?
cnt_add()        { [ "$DRY" = 1 ] || echo "$1" >> "$SAYAC_FILE"; }      # sayaç: kuru çalıştırmada yazılmaz
cnt_del_prefix() { [ "$DRY" = 1 ] || sed -i "/^${1//./\\.} /d" "$SAYAC_FILE"; }
temp_added() {   # CIDR → csf -td gerçekten tuttu mu? Sayaç kaydı buna bağlı, kaybolmasın diye iki yoldan bakılır.
    [ "$DRY" = 1 ] && return 0
    [[ "$CSF_OUT" =~ (not\ a\ valid|failed|servers\ addresses) ]] && return 1
    [ -r "$CSF_VAR/csf.tempban" ] && grep -qF "|$1|" "$CSF_VAR/csf.tempban" && return 0
    [[ "$CSF_OUT" == *blocked* ]] && return 0      # "... blocked on port" / "already temporarily blocked"
    [ ! -r "$CSF_VAR/csf.tempban" ]
}
csf_run() {      # csf'i çalıştır, çıktıyı log'a yaz, CSF_OUT'ta sakla (csf hata durumunda da 0 döner)
    if [ "$DRY" = 1 ]; then
        case "$1" in -d|-dr|-td|-tr) echo "      [dry-run] csf $*"; CSF_OUT=""; return 0 ;; esac
    fi
    CSF_OUT=$("$CSF_BIN" "$@" 2>&1 9>&-)
    log_flush                       # csf çıktısı dosyaya doğrudan yazılıyor: önce bağlam satırları
    [ -n "$CSF_OUT" ] && printf '%s\n' "$CSF_OUT" >> "$LOG_FILE"
}

# ── Event log (JSON lines) — WHM eklentisi ve --status buradan okur ─────────
jstr() {         # dizgi → REPLY = JSON dizgisi (tırnaklı, kaçışlı)
    local s="$1"
    s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//[[:cntrl:]]/ }"
    REPLY="\"$s\""
}
ev() {           # TYPE CIDR [anahtar=HAZIR_JSON ...]
    [ "$DRY" = 1 ] && return 0
    local line kv ts
    printf -v ts '%(%s)T' -1
    line="{\"t\":$ts,\"type\":\"$1\""
    if [ -n "$2" ]; then jstr "$2"; line+=",\"cidr\":$REPLY"; fi
    shift 2
    for kv in "$@"; do line+=",\"${kv%%=*}\":${kv#*=}"; done
    printf '%s}\n' "$line" >> "$EVENTS_FILE" 2>/dev/null
}
# Tek mail: tur içindeki tüm bildirimler (blok banları, şüpheli ağlar, atlamalar, limit, sağlık) tek
# mailde bölüm bölüm gider; konu satırı bölümlerin özetidir.
MAIL_PARTS=(); MAIL_BODY=""; MAIL_URGENT=0
mail_add() {     # KONU-PARÇASI GÖVDE
    MAIL_PARTS+=("$1")
    MAIL_BODY+="${MAIL_BODY:+$NL────────────────────────────────────────$NL$NL}$2$NL"
}
mail_flush() {
    [ ${#MAIL_PARTS[@]} -gt 0 ] || return 0
    local subj="" pp
    for pp in "${MAIL_PARTS[@]}"; do subj+="${subj:+ · }$pp"; done
    { printf '%s\n' "$MAIL_BODY"
      [ -n "$doluluk_satiri" ] && printf '%s\n' "$doluluk_satiri"
      [ -n "$temp_doluluk_satiri" ] && printf '%s\n' "$temp_doluluk_satiri"
      printf '\n%s%s\n' "$PANEL_FOOT" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")"; } | mail -s "$([ "$MAIL_URGENT" = 1 ] && printf '!!! ')$M_SUBJ_PREFIX$subj" "$ALERT_MAIL"
    MAIL_PARTS=(); MAIL_BODY=""; MAIL_URGENT=0
}
perm_remove() {  # CIDR → csf.deny'den kaldır ("do not delete" ise önce işaret silinir); 0 = kaldırıldı
    local line; line=$(deny_line "$1"); [ -n "$line" ] || return 1
    [ "$DRY" = 1 ] && { echo "      [dry-run] csf -dr $1"; return 0; }
    if is_dnd "$line"; then strip_dnd "$1" || return 1; fi
    csf_run -dr "$1"
    ! deny_has "$1"
}
expire_blocks() { # KİM → BLOCK_EXPIRE_DAYS'ten eski blok banlarını kaldır (yalnız otomatik eklenenler) → EXP_N, EXP_BODY
    local line tok ds ep age now re_d='- ([A-Z][a-z]{2} [A-Z][a-z]{2} +[0-9]{1,2} [0-9:]{8} [0-9]{4})[[:space:]]*$' list=()
    EXP_N=0; EXP_BODY=""
    now=$(date +%s)
    while IFS= read -r line; do
        tok="${line%%[[:space:]]*}"
        [[ "$tok" =~ $CIDR4_RE && "$tok" == */24 ]] || continue
        [[ "$line" == *Auto-grouped* ]] || continue          # elle eklenenlere (csf_autogroup:) dokunulmaz
        [[ "$line" =~ $re_d ]] || continue
        ds="${BASH_REMATCH[1]}"
        ep=$(LC_ALL=C date -d "$ds" +%s 2>/dev/null) || continue
        age=$(( (now - ep) / 86400 ))
        [ "$age" -ge "$BLOCK_EXPIRE_DAYS" ] && list+=("$tok $age")
    done < "$DENY_FILE"
    for line in "${list[@]}"; do
        tok="${line% *}"; age="${line#* }"
        if perm_remove "$tok"; then
            log "$(m "$M_EXP_LOG" "$tok" "$age")"
            EXP_N=$((EXP_N + 1)); EXP_BODY+="$(m "$M_EXP_LINE" "$tok" "$age")$NL"
            jstr "$1"; ev expire "$tok" "age=$age" "by=$REPLY"
        else
            log "$(m "$M_EXP_FAIL" "$tok")"
        fi
    done
}
# Güvenlik duvarının durumu. systemd'nin "csf" servisine bakılmaz: kurallar yüklüyken bile "failed"
# görünebiliyor (sunucuda görüldü). → H_CSF: ok|off|testing|norules|unknown, H_LFD: ok|down
health_check() {
    local pid="" ipt
    H_CSF=ok; H_LFD=down
    if [ -f "${CSF_CONF%/*}/csf.disable" ]; then H_CSF=off
    elif [ "$(conf_val TESTING)" = 1 ]; then H_CSF=testing
    else
        ipt=$(command -v iptables 2>/dev/null)
        if [ -z "$ipt" ]; then H_CSF=unknown
        elif ! { "$ipt" -S LOCALINPUT >/dev/null 2>&1 || { command -v iptables-legacy >/dev/null 2>&1 && iptables-legacy -S LOCALINPUT >/dev/null 2>&1; }; }; then H_CSF=norules
        fi
    fi
    [ -r /var/run/lfd.pid ] && read -r pid < /var/run/lfd.pid 2>/dev/null
    if [[ "$pid" =~ ^[0-9]+$ ]] && [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q '^lfd'; then H_LFD=ok
    elif command -v pgrep >/dev/null 2>&1 && pgrep -f '^lfd' >/dev/null 2>&1; then H_LFD=ok
    fi
}
owner_kv() {     # son owner_lookup sonucunu ev() argümanlarına çevirir → OKV dizisi
    OKV=()
    jstr "$OWN_LONG"; OKV+=("owner=$REPLY")
    jstr "$OWN_ASN";  OKV+=("asn=$REPLY")
    jstr "$OWN_CC";   OKV+=("cc=$REPLY")
}
num() { [[ "$1" =~ ^[0-9]+$ ]] && echo "$1" || echo 0; }

# ── DNS lookups (PTR + Team Cymru ASN) ──────────────────────────────────────
DIG_BIN=$(command -v dig 2>/dev/null); HOST_BIN=$(command -v host 2>/dev/null)
LOOK_OK=0; [ "$LOOKUP" = "1" ] && [ -n "$DIG_BIN$HOST_BIN" ] && LOOK_OK=1
LOOK_INIT="$LOOK_OK"   # 0 = kullanıcı kapattı / araç yok; 1 iken LOOK_OK=0 = bu turda arıza
LOOK_FAILS=0
declare -A PTR_OF OWN_L OWN_S OWN_A OWN_C ASNAME
# "Kayıt yok" (NXDOMAIN, boş cevap → 0 döner) ile "sorulamadı" (zaman aşımı/hata → 1 döner)
# ayrımı önemli: beyaz liste kontrolü sorulamadıysa o tur banlanmaz.
dns_q() {        # TYPE NAME → REPLY (satır satır, tırnaksız, sondaki nokta atılmış)
    local out rc
    REPLY=""
    [ "$LOOK_OK" = 1 ] || return 1
    if [ -n "$DIG_BIN" ]; then
        out=$("$DIG_BIN" +short +time="$LOOKUP_TIMEOUT" +tries=1 -t "$1" "$2" 2>/dev/null); rc=$?
    else
        out=$("$HOST_BIN" -W "$LOOKUP_TIMEOUT" -t "$1" "$2" 2>/dev/null); rc=0   # host: NXDOMAIN'de de 1 döner
        [[ "$out" == *"timed out"* || "$out" == *"no servers could be reached"* ]] && rc=9
        out=$(printf '%s\n' "$out" | sed -n -e 's/.* descriptive text //p' -e 's/.* domain name pointer //p' -e 's/.* has address //p')
    fi
    if [ "$rc" -ne 0 ]; then
        LOOK_FAILS=$((LOOK_FAILS + 1))
        [ "$LOOK_FAILS" -ge 3 ] && { LOOK_OK=0; log "$M_LOOKUP_OFF"; }
        return 1
    fi
    LOOK_FAILS=0
    REPLY=$(printf '%s\n' "$out" | grep -v '^;' | tr -d '"' | sed -e 's/\.$//' -e '/^$/d')
    return 0
}
ptr_lookup() {   # IP → REPLY = hostname ya da boş; PTR_UNK=1 ise sorulamadı
    local a b c d
    PTR_UNK=0
    if [ -z "${PTR_OF[$1]+x}" ]; then
        IFS=. read -r a b c d <<< "$1"
        if dns_q PTR "$d.$c.$b.$a.in-addr.arpa"; then PTR_OF[$1]="${REPLY%%$NL*}"
        else PTR_UNK=1; REPLY=""; return; fi
    fi
    REPLY="${PTR_OF[$1]}"
}
owner_lookup() { # IP → OWN_LONG ("AS60729 ARTIKEL10, DE"), OWN_SHORT ("AS60729 DE"), OWN_ASN, OWN_CC; OWN_UNK=1 ise sorulamadı
    local p="${1%.*}" a b c d txt asn cc name
    OWN_UNK=0
    if [ -z "${OWN_L[$p]+x}" ]; then
        IFS=. read -r a b c d <<< "$1"
        if ! dns_q TXT "$d.$c.$b.$a.origin.asn.cymru.com"; then
            OWN_UNK=1; OWN_LONG=""; OWN_SHORT=""; OWN_ASN=""; OWN_CC=""; return
        fi
        txt="${REPLY%%$NL*}"
        # "60729 | 185.220.101.0/24 | DE | ripencc | 2017-09-12"
        asn=$(printf '%s' "$txt" | cut -d'|' -f1 | awk '{print $1}')
        cc=$(printf '%s' "$txt" | cut -d'|' -f3 | tr -d ' ')
        OWN_A[$p]=""; OWN_C[$p]=""; OWN_L[$p]=""; OWN_S[$p]=""
        if [[ "$asn" =~ ^[0-9]+$ ]]; then
            if [ -z "${ASNAME[$asn]+x}" ]; then
                # "60729 | DE | ripencc | 2015-05-12 | ARTIKEL10, DE"
                dns_q TXT "AS$asn.asn.cymru.com" && \
                    ASNAME[$asn]=$(printf '%s' "${REPLY%%$NL*}" | cut -d'|' -f5- | sed 's/^ *//')
            fi
            name="${ASNAME[$asn]}"
            OWN_A[$p]="$asn"; OWN_C[$p]="$cc"
            OWN_L[$p]="AS$asn ${name:-?}"; [ -z "$name" ] && [ -n "$cc" ] && OWN_L[$p]="AS$asn, $cc"
            OWN_S[$p]="AS$asn${cc:+ $cc}"; OWN_N[$p]="$name"
        fi
        OWN_NEW[$p]=1
    fi
    OWN_LONG="${OWN_L[$p]}"; OWN_SHORT="${OWN_S[$p]}"; OWN_ASN="${OWN_A[$p]}"; OWN_CC="${OWN_C[$p]}"
}
# Önbellek satırı: "a.b.c|ASN|CC|KURUM|zaman". Sorgulanıp bilgi çıkmayan blok da (boş ASN) saklanır,
# her turda boşuna yeniden sorulmasın. OWNER_TTL_DAYS'ten eski kayıt okunmaz, yeniden sorulur.
declare -A OWN_N OWN_T OWN_NEW
owners_load() {
    local p asn cc name t min
    [ -r "$OWNERS_FILE" ] || return 0
    min=$(( $(date +%s) - OWNER_TTL_DAYS * 86400 ))
    while IFS='|' read -r p asn cc name t; do
        [[ "$p" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || continue
        [[ "$t" =~ ^[0-9]+$ ]] && [ "$t" -ge "$min" ] || continue
        OWN_A[$p]="$asn"; OWN_C[$p]="$cc"; OWN_N[$p]="$name"; OWN_T[$p]="$t"
        if [ -n "$asn" ]; then
            OWN_L[$p]="AS$asn ${name:-?}"; [ -z "$name" ] && [ -n "$cc" ] && OWN_L[$p]="AS$asn, $cc"
            OWN_S[$p]="AS$asn${cc:+ $cc}"
        else OWN_L[$p]=""; OWN_S[$p]=""; fi
    done < "$OWNERS_FILE"
}
owners_save() {  # yalnız yeni sorgu olduysa; atomik
    local p now tmp
    [ "$DRY" = 1 ] && return 0
    [ ${#OWN_NEW[@]} -gt 0 ] || return 0
    now=$(date +%s); tmp="$OWNERS_FILE.tmp.$$"
    for p in "${!OWN_A[@]}"; do
        [ -n "${OWN_NEW[$p]+x}" ] && OWN_T[$p]="$now"
        [ -n "${OWN_T[$p]}" ] || continue
        printf '%s|%s|%s|%s|%s\n' "$p" "${OWN_A[$p]}" "${OWN_C[$p]}" "${OWN_N[$p]//|/ }" "${OWN_T[$p]}"
    done > "$tmp" && mv -f "$tmp" "$OWNERS_FILE"
}
deny_prefixes() {   # csf.deny'deki grupların ve tekillerin /24 önekleri (tekrarsız) → stdout
    local i c
    for c in "${!SINGLE_NOTE[@]}"; do echo "${c%.*}"; done
    for i in "${!DC_TXT[@]}"; do c="${DC_TXT[i]%/*}"; echo "${c%.*}"; done
}
pending_prefixes() { # sayaçta izlenen /24 önekleri → stdout
    [ -r "$SAYAC_FILE" ] && awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+$/ { print $1 }' "$SAYAC_FILE"
    return 0
}
backfill_owners() { # sahibi bilinmeyen blokları bu turda sorgula (en fazla BACKFILL_MAX)
    local p n=0
    BF_N=0
    [ "$LOOK_OK" = 1 ] || return 0
    local i c order
    # Önce CSF Auto-Group'un kendi grupları (tabloda görünenler), sonra csf.deny'deki diğer
    # bloklar, en son tekiller. csf.deny'de başka kaynaklı çok sayıda CIDR olabiliyor (sunucuda
    # ölçüldü: 31 grup varken bir ASN'de 36 blok) — onlar grupların önüne geçmesin.
    order=$( { for c in "${AGG[@]}"; do c="${c%/*}"; echo "${c%.*}"; done
               pending_prefixes
               for i in "${!DC_TXT[@]}"; do c="${DC_TXT[i]%/*}"; echo "${c%.*}"; done
               for c in "${!SINGLE_NOTE[@]}"; do echo "${c%.*}"; done; } | awk '!seen[$0]++')
    for p in $order; do
        [ -n "${OWN_L[$p]+x}" ] && continue
        [ "$n" -ge "$BACKFILL_MAX" ] && break
        owner_lookup "$p.1"; n=$((n + 1))
        [ "$LOOK_OK" = 1 ] || break
    done
    BF_N=$n
}
resolve_a() {    # HOSTNAME → REPLY = IPv4 adresleri (satır satır)
    if [ "$LOOK_OK" = 1 ]; then
        dns_q A "$1" || return 1
        REPLY=$(printf '%s\n' "$REPLY" | grep -E "$IPV4_RE")
    elif command -v getent >/dev/null 2>&1; then
        REPLY=$(timeout 3 getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u)
    else REPLY=""; fi
    return 0
}
short_reason() { # "# lfd: (sshd) Failed SSH login from IP (CC/..): 5 in ... - Sat Sep 26 ..." → "(sshd) Failed SSH login"
    local r="$1" w
    r="${r#"${r%%[![:space:]]*}"}"; r="${r#\#}"; r="${r#"${r%%[![:space:]]*}"}"; r="${r#lfd: }"
    r="${r% - [A-Z][a-z][a-z] [A-Z][a-z][a-z] *}"
    [[ "$r" == *"$2"* ]] && [ -n "${r%%"$2"*}" ] && r="${r%%"$2"*}"
    r="${r%"${r##*[![:space:]]}"}"
    for w in " from" " by" " for" ":" " -"; do [[ "$r" == *"$w" ]] && r="${r%"$w"}"; done
    r="${r%"${r##*[![:space:]]}"}"
    (( ${#r} > 70 )) && r="${r:0:67}..."
    REPLY="$r"
}
ip_line() {      # IP NOTE WITH_OWNER(0|1) → REPLY = "   - IP  hostname  [ASN CC]  sebep"
    local host="-" why out
    ptr_lookup "$1"; [ -n "$REPLY" ] && host="$REPLY"
    short_reason "$2" "$1"; why="$REPLY"
    printf -v out '   - %-15s  %s' "$1" "$host"
    # Aynı satırın JSON hâli (olay kaydı için) → IPJ
    local jh="" jw
    [ "$host" != "-" ] && jh="$host"
    jstr "$jh"; jh="$REPLY"; jstr "$why"; jw="$REPLY"
    IPJ="{\"ip\":\"$1\",\"host\":$jh,\"why\":$jw"
    # owner_lookup DNS sorgusu yapar ve REPLY'yi ezer → satır "out" içinde toplanır
    if [ "$3" = 1 ]; then
        owner_lookup "$1"; [ -n "$OWN_SHORT" ] && out+="  [$OWN_SHORT]"
        jstr "$OWN_LONG"; IPJ+=",\"owner\":$REPLY,\"asn\":\"$OWN_ASN\",\"cc\":\"$OWN_CC\""
    fi
    IPJ+="}"
    [ -n "$why" ] && out+="  $why"
    REPLY="$out"
}
ip_lines() {     # "IP IP ..." KIND(perm|temp) WITH_OWNER → REPLY; tekrarsız, sıralı, ilk 40, fazlası "(+N)"
    local all ip n=0 total out="" note js=""
    all=$(printf '%s\n' $1 | grep -E "$IPV4_RE" | sort -Vu)
    total=$(printf '%s\n' "$all" | grep -c .)
    for ip in $all; do
        [ "$n" -ge 40 ] && break; n=$((n + 1))
        if [ "$2" = temp ]; then note="${TNOTE[$ip]}"; else note="${SINGLE_NOTE[$ip]}"; fi
        ip_line "$ip" "$note" "$3"; out+="$REPLY$NL"
        js+="${js:+,}$IPJ"
    done
    [ "$total" -gt 40 ] && out+="   (+$((total - 40)))$NL"
    IPS_J="[$js]"; IPS_TOTAL="$total"   # olay kaydı için: ilk 40 IP'nin JSON'u + toplam
    REPLY="$out"
}
owner_line() {   # "IP IP ..." → REPLY = ilk IP'nin /24'ü için "   Sahibi: ..." satırı (bilgi yoksa boş)
    local first
    read -r first _ <<< "$1"
    owner_lookup "$first"; REPLY=""
    [ -n "$OWN_LONG" ] && REPLY="$(m "$M_OWNER" "$OWN_LONG")$NL"
}

# ── CSF whitelists ──────────────────────────────────────────────────────────
# lfd'nin "banlama" dediği her şey + güvenlik duvarının izin verdiği her şey.
# Bir /24 bunlardan biriyle çakışıyorsa banlanmaz, maille bildirilir.
WL_LOADED=0; WL_LO=(); WL_HI=(); WL_TXT=(); RIGNORE=(); CC_LIST=""; CC_WARNED=0
conf_val() { grep -E "^[[:space:]]*$1[[:space:]]*=" "$CSF_CONF" | tail -1 | cut -d= -f2- | tr -d ' "\r'; }
wl_add() {       # CIDR LABEL
    cidr_range "$1" || return
    WL_LO+=("$R_LO"); WL_HI+=("$R_HI"); WL_TXT+=("$2")
}
wl_load() {      # FILE LABEL [DEPTH] — IP, CIDR, gelişmiş satır (tcp|in|d=22|s=IP), Include
    local file="$1" label="$2" depth="${3:-0}" line tok rest mt ip
    [ -r "$file" ] || return
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"; line="${line%%#*}"; line="${line#"${line%%[![:space:]]*}"}"
        [ -z "$line" ] && continue
        if [[ "$line" =~ ^Include[[:space:]]+([^[:space:]]+) ]]; then
            [ "$depth" -lt 5 ] && wl_load "${BASH_REMATCH[1]}" "$label" $((depth + 1)); continue
        fi
        tok="${line%%[[:space:]]*}"; rest="$tok"; mt=0
        while [[ "$rest" =~ ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(/[0-9]{1,2})?) ]]; do
            ip="${BASH_REMATCH[1]}"          # wl_add içindeki regex BASH_REMATCH'i ezer
            rest="${rest#*"$ip"}"
            wl_add "$ip" "$label: $ip"; mt=1
        done
        # csf.allow'da hostname olabilir → çöz
        if [ "$mt" = 0 ] && [ "$label" = "csf.allow" ] && [[ "$tok" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]] && [[ "$tok" =~ [A-Za-z] ]]; then
            resolve_a "$tok"
            for ip in $REPLY; do wl_add "$ip" "$label: $tok ($ip)"; done
        fi
    done < "$file"
}
rignore_load() { # FILE [DEPTH]
    local line depth="${2:-0}"
    [ -r "$1" ] || return
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"; line="${line%%#*}"; line="${line#"${line%%[![:space:]]*}"}"; line="${line%%[[:space:]]*}"
        [ -z "$line" ] && continue
        if [ "$line" = "Include" ]; then continue; fi
        [[ "$line" =~ ^[.A-Za-z0-9_] ]] && RIGNORE+=("$line")
    done < "$1"
    while IFS= read -r line; do
        [ "$depth" -lt 5 ] && rignore_load "$line" $((depth + 1))
    done < <(sed -n 's/^Include[[:space:]]\+\([^[:space:]]*\).*/\1/p' "$1")
}
load_whitelist() {
    local ip
    WL_LOADED=1
    wl_load "$CSF_DIR/csf.allow"      "csf.allow"
    wl_load "$CSF_DIR/csf.ignore"     "csf.ignore"
    wl_load "$CSF_VAR/csf.gallow"     "GLOBAL_ALLOW"
    wl_load "$CSF_VAR/csf.gignore"    "GLOBAL_IGNORE"
    wl_load "$CSF_VAR/csf.tempdyn"    "DYNDNS"
    wl_load "$CSF_VAR/csf.tempgdyn"   "GLOBAL_DYNDNS"
    wl_load "$CSF_VAR/csf.tempallow"  "csf.tempallow"
    # Imunify360'ın yerel beyaz listesi (elle eklenenler ve Imunify'ın doğruladığı arama motoru botları).
    # Önbellekten okunur (imunify_refresh, IMUNIFY_REFRESH_MIN dakikada bir); süresi dolan kayıt sayılmaz.
    if [ -r "$IMUNIFY_WL_FILE" ]; then
        local now wip wexp wcm
        now=$(date +%s)
        while IFS='|' read -r wip wexp wcm; do
            [[ "$wip" =~ ^[0-9] ]] || continue
            [[ "$wexp" =~ ^[0-9]+$ ]] && [ "$wexp" -gt 0 ] && [ "$wexp" -le "$now" ] && continue
            wl_add "$wip" "Imunify: $wip${wcm:+ ($wcm)}"
        done < "$IMUNIFY_WL_FILE"
    fi
    # Sunucunun kendi IP'leri: CSF yalnızca IP'nin kendisini korur, içinde bulunduğu /24'ü değil.
    for ip in $( { ip -4 -o addr show 2>/dev/null | awk '{print $4}'; hostname -I 2>/dev/null | tr ' ' '\n'; } | sed 's#/.*##' | grep -E "$IPV4_RE" | sort -u); do
        case "$ip" in 127.*) continue;; esac
        wl_add "$ip" "$M_WL_SELF: $ip"
    done
    rignore_load "$CSF_DIR/csf.rignore"
    CC_LIST=$( { conf_val CC_IGNORE | sed 's/^/CC_IGNORE=/'; conf_val CC_ALLOW | sed 's/^/CC_ALLOW=/'; } | grep -v '=$' | LC_ALL=C tr '[:lower:]' '[:upper:]')
    logr "$(m "$M_WL_LOADED" "${#WL_LO[@]}" "${#RIGNORE[@]}")"
}
wl_overlap() {   # LO HI → WL_HIT = çakışan beyaz liste kaydı
    local i
    WL_HIT=""
    [ "$WL_LOADED" = 1 ] || load_whitelist
    for i in "${!WL_LO[@]}"; do
        (( WL_LO[i] <= $2 && WL_HI[i] >= $1 )) && { WL_HIT="${WL_TXT[i]}"; return 0; }
    done
    return 1
}
wl_check() {     # PREFIX24 "IP IP ..." → 0 = banlama (WL_HIT dolu; WL_RETRY=1 ise doğrulanamadı, sonraki tur)
    local lo hi ip host d entry name vals v first unk=0
    WL_RETRY=0
    read -r first _ <<< "$2"
    ip2int "$1.0"; lo=$REPLY; hi=$((lo + 255))
    wl_overlap "$lo" "$hi" && return 0
    if { [ -n "$CC_LIST" ] || [ "${#RIGNORE[@]}" -gt 0 ]; } && [ "$LOOK_INIT" != 1 ]; then
        # Kullanıcı sorguları kapattı (LOOKUP=0) ya da dig/host yok: uyar, IP tabanlı kontrolle yetin.
        [ "$CC_WARNED" = 0 ] && { log "$M_CC_NOLOOKUP"; CC_WARNED=1; }
        return 1
    fi
    # CC_IGNORE / CC_ALLOW: ülke kodu ya da ASnnnn (lfd ile aynı listeler)
    if [ -n "$CC_LIST" ]; then
        owner_lookup "$first"
        if [ "$OWN_UNK" = 1 ]; then WL_HIT="CC_IGNORE/CC_ALLOW"; WL_RETRY=1; return 0; fi
        while IFS= read -r entry; do
            name="${entry%%=*}"; vals="${entry#*=}"
            for v in ${vals//,/ }; do
                if { [ -n "$OWN_ASN" ] && [ "$v" = "AS$OWN_ASN" ]; } || { [ -n "$OWN_CC" ] && [ "$v" = "$OWN_CC" ]; }; then
                    WL_HIT="$name: $v"; return 0
                fi
            done
        done <<< "$CC_LIST"
    fi
    # csf.rignore: tekillerin ters DNS'i listedeki bir alan adıyla bitiyor ve ileri yönde doğrulanıyorsa
    if [ "${#RIGNORE[@]}" -gt 0 ]; then
        for ip in $2; do
            ptr_lookup "$ip"
            [ "$PTR_UNK" = 1 ] && { unk=1; continue; }
            host=$(printf '%s' "$REPLY" | LC_ALL=C tr '[:upper:]' '[:lower:]')
            [ -z "$host" ] && continue
            for d in "${RIGNORE[@]}"; do
                d=$(printf '%s' "$d" | LC_ALL=C tr '[:upper:]' '[:lower:]')
                if [ "$host" = "$d" ] || { [[ "$d" == *.* ]] && [[ "$host" == *"$d" ]]; }; then
                    resolve_a "$host" || { unk=1; continue; }
                    if printf '%s\n' "$REPLY" | grep -qxF "$ip"; then
                        WL_HIT="csf.rignore: $d ($ip = $host)"; return 0
                    fi
                fi
            done
        done
        if [ "$unk" = 1 ]; then WL_HIT="csf.rignore"; WL_RETRY=1; return 0; fi
    fi
    return 1
}
wl_skip() {      # CIDR COUNT PREFIX24 "IPS" KIND — doğrulanamadıysa yalnız log, yoksa rapor
    if [ "$WL_RETRY" = 1 ]; then log "$(m "$M_WL_RETRY" "$1" "$WL_HIT")"; return; fi
    wl_report "$@"
}
wl_skip_body=""; wl_skipped=0
wl_report() {    # CIDR COUNT PREFIX24 "IPS" KIND — günde bir kez maile ekle
    if grep -qF "WLSKIP_$3 $TODAY" "$SAYAC_FILE"; then logr "$(m "$M_WL_SKIPD" "$1" "$WL_HIT")"; return; fi
    log "$(m "$M_WL_SKIP" "$1" "$WL_HIT")"
    cnt_add "WLSKIP_$3 $TODAY"
    wl_skip_body+="$(m "$M_WL_B" "$1" "$2" "$WL_HIT")$NL"
    owner_line "$4"; wl_skip_body+="$REPLY"
    ip_lines "$4" "$5" 0; wl_skip_body+="$REPLY"
    wl_skipped=$((wl_skipped + 1))
    owner_kv; jstr "$WL_HIT"     # OWN_* yukarıdaki owner_line'dan (ip_lines sahip sorgusu yapmadı)
    ev skip_wl "$1" "n=$2" "wl=$REPLY" "kind=\"$5\"" "${OKV[@]}" "total=$IPS_TOTAL" "ips=$IPS_J"
}

# ── Read csf.deny: singles (grouping) + CIDRs (coverage) ────────────────────
# Tekiller yalnızca ana dosyadan gruplanır (csf -dr Include dosyalarına dokunmaz);
# kapsama kontrolü Include dosyalarındaki CIDR'leri de görür. Aynı IP'nin tekrar
# eden satırları (LF_REPEATBLOCK) tek IP sayılır.
declare -A DENY_IP SINGLE_NOTE count24 ips24
DC_LO=(); DC_HI=(); DC_TXT=(); AGG=()   # AGG: CSF Auto-Group'un kendi eklediği bloklar (diğer CIDR'ler değil)
parse_deny() {   # FILE MAIN(1|0) [DEPTH]
    local line tok p depth="${3:-0}"
    [ -r "$1" ] || return
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        if [[ "$line" =~ ^Include[[:space:]]+([^[:space:]]+) ]]; then
            [ "$depth" -lt 5 ] && parse_deny "${BASH_REMATCH[1]}" 0 $((depth + 1)); continue
        fi
        tok="${line%%[[:space:]]*}"
        [[ "$tok" =~ $CIDR4_RE ]] || continue
        if [[ "$tok" == */* ]]; then
            cidr_range "$tok" && { DC_LO+=("$R_LO"); DC_HI+=("$R_HI"); DC_TXT+=("$tok"); }
            if [ "$2" = 1 ]; then case "$line" in *Auto-grouped*|*csf_autogroup:*) AGG+=("$tok") ;; esac; fi
        else
            DENY_IP[$tok]=1
            if [ "$2" = 1 ] && [ -z "${SINGLE_NOTE[$tok]+x}" ]; then
                SINGLE_NOTE[$tok]="${line#"$tok"}"; p="${tok%.*}"
                count24[$p]=$((${count24[$p]:-0} + 1)); ips24[$p]+=" $tok"
            fi
        fi
    done < "$1"
}
deny_line() { grep -m1 -E "^${1//./\\.}([[:space:]]|$)" "$DENY_FILE"; }   # CIDR/IP → csf.deny satırı
is_dnd()    { [[ "$1" =~ [Dd][Oo][[:space:]]+[Nn][Oo][Tt][[:space:]]+[Dd][Ee][Ll][Ee][Tt][Ee] ]]; }

# Tek seferde tek yazan: cron turu, elle çalıştırma ve eklentinin butonları aynı kilidi alır.
take_lock() {
    command -v flock >/dev/null 2>&1 || return 0
    exec 9>"$LOCK_FILE"
    flock -n 9
}
lock_busy() {    # başka biri kilidi tutuyor mu? (salt okunur modlar için)
    command -v flock >/dev/null 2>&1 || return 1
    [ -e "$LOCK_FILE" ] || return 1
    ! flock -n "$LOCK_FILE" true 2>/dev/null
}

# ── Ignore list ("yoksay"): "CIDR YYYY-MM-DD KİM" satırları ──────────────────
ign_until() {    # CIDR → 0 = süresi dolmamış bir yoksayma var (IGN_UNTIL)
    local c u b
    IGN_UNTIL=""
    [ -r "$IGNORE_FILE" ] || return 1
    while read -r c u b; do
        [ "$c" = "$1" ] || continue
        if [[ ! "$u" < "$TODAY" ]]; then IGN_UNTIL="$u"; return 0; fi
    done < "$IGNORE_FILE"
    return 1
}

# ── Temp group bans: csf.tempban içinde bizim eklediğimiz /24'ler ────────────
declare -A TG_TTL TG_NOTE
read_temp_groups() {
    local t ip port dir to note now p
    now=$(date +%s)
    [ -r "$CSF_VAR/csf.tempban" ] || return
    while IFS='|' read -r t ip port dir to note; do
        [[ "$ip" == */24 ]] || continue
        # Yorumdan (v1.2+) ya da sayaç kaydından (daha eski sürümlerin eklediği) tanınır.
        p="${ip%.0/24}"
        if [[ "$note" == *Auto-grouped* ]] || grep -qE "^${p//./\\.} " "$SAYAC_FILE" 2>/dev/null; then
            TG_TTL[$ip]=$(( $(num "$t") + $(num "$to") - now )); TG_NOTE[$ip]="$note"
        fi
    done < "$CSF_VAR/csf.tempban"
}

# Olay kaydından önceki işler: günlükteki (ve arşivlerindeki) iş satırları bir kez olaya çevrilir ve
# saklanır (LOGHIST_FILE). Yalnız ilk olaydan önceki satırlar alınır; sonrası zaten olay kaydında.
# TR ve EN kalıplarının ikisi de tanınır (dil sonradan değişmiş olabilir). mktime için gawk gerekir.
loghist_build() {
    local first=0 f aw
    [ "$DRY" = 1 ] && return 0
    aw=$(command -v gawk 2>/dev/null)
    if [ -z "$aw" ] || [ ! -r "$LOG_FILE" ]; then : > "$LOGHIST_FILE" 2>/dev/null; return 0; fi
    [ -r "$EVENTS_FILE" ] && [[ "$(awk 'NR == 1' "$EVENTS_FILE")" =~ ^\{\"t\":([0-9]+), ]] && first="${BASH_REMATCH[1]}"
    [ "$first" -gt 0 ] || first=$(( $(date +%s) + 1 ))
    { for f in $(ls -1r "$LOG_FILE".[0-9]*.gz 2>/dev/null); do zcat "$f" 2>/dev/null; done
      for f in "$LOG_FILE.1" "$LOG_FILE"; do [ -r "$f" ] && cat "$f"; done; } |
    grep -aE '^\[[0-9-]{10} [0-9:]{8}\] (OK |UYARI |WARNING |BLOK BANI: |BLOCK BAN: |GEÇİCİ BLOK BANI: |TEMP BLOCK BAN: |KALICIYA ALINDI: |MADE PERMANENT: |ŞÜPHELİ AĞ: |SUSPICIOUS RANGE: |Temizlendi: |Cleaned: |ATLANDI [0-9]|SKIPPED [0-9]|Silindi tekil: |Removed single: )' |
    "$aw" -v first="$first" '
        function js(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return "\"" s "\"" }
        function flush() { if (cur != "") { print cur (ips != "" ? ",\"ips\":[" ips "],\"total\":" ni : "") "}"; cur = ""; ips = ""; ni = 0 } }
        {
            ts = substr($0, 2, 19); msg = substr($0, 23)
            t = mktime(substr(ts, 1, 4) " " substr(ts, 6, 2) " " substr(ts, 9, 2) " " substr(ts, 12, 2) " " substr(ts, 15, 2) " " substr(ts, 18, 2))
            if (t <= 0 || t >= first) next
            if (msg ~ /^(Silindi tekil|Removed single): /) {          # bir önceki grup banının silinen tekilleri
                if (cur != "" && ni < 40) { ip = msg; sub(/^[^:]*: /, "", ip); sub(/ .*/, "", ip); ips = ips (ips != "" ? "," : "") "{\"ip\":" js(ip) "}"; ni++ }
                next
            }
            flush()
            ty = ""; c = ""; n = ""; sn = ""; dnd = "false"; wl = ""
            # v1.7.8 öncesi ("OK /24 eklendi", "UYARI Temp /16") ve sonraki ("BLOK BANI", "ŞÜPHELİ AĞ") kalıplar
            if (match(msg, /^(OK (Temp→Kalıcı|temp->permanent) \/24 [a-z]+|KALICIYA ALINDI|MADE PERMANENT): [0-9.]+\/24 \([0-9]+/)) ty = "promote"
            else if (match(msg, /^(OK (Temp|temp) \/24 [a-z]+|GEÇİCİ BLOK BANI|TEMP BLOCK BAN): [0-9.]+\/24 \([0-9]+/)) ty = "temp24"
            else if (match(msg, /^(OK \/24 [a-z]+|BLOK BANI|BLOCK BAN): [0-9.]+\/24 \([0-9]+/)) ty = "add24"
            else if (match(msg, /^(UYARI Temp|WARNING temp) \/16: /) || match(msg, /^(ŞÜPHELİ AĞ|SUSPICIOUS RANGE): .*(geçici banlardan|from temp bans)/)) ty = "warn16t"
            else if (match(msg, /^(UYARI|WARNING) \/16: /) || match(msg, /^(ŞÜPHELİ AĞ|SUSPICIOUS RANGE): /)) ty = "warn16"
            else if (match(msg, /^(Temizlendi|Cleaned): /)) ty = "clean_temp"
            else if (match(msg, /^(ATLANDI|SKIPPED) [0-9.]+\/24: .*\(.*\)$/) && msg !~ /(bugün zaten|already reported)/) ty = "skip_wl"
            if (ty == "") next
            if (match(msg, /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?/)) c = substr(msg, RSTART, RLENGTH)
            if (ty ~ /^(add24|temp24|promote)$/ && match(msg, /\([0-9]+ /)) n = substr(msg, RSTART + 1, RLENGTH - 2)
            if (ty ~ /^warn16/) {
                if (match(msg, /[0-9]+ IPs?[ ,]/)) { n = substr(msg, RSTART, RLENGTH); sub(/ .*/, "", n) }
                if (match(msg, /[0-9]+ (farklı|distinct)/)) { sn = substr(msg, RSTART, RLENGTH); sub(/ .*/, "", sn) }
            }
            if (ty == "promote" || msg ~ /\[do not delete\]/) dnd = "true"
            if (ty == "skip_wl" && match(msg, /\(.*\)$/)) wl = substr(msg, RSTART + 1, RLENGTH - 2)
            cur = "{\"t\":" t ",\"type\":\"" ty "\",\"cidr\":" js(c) ",\"day\":\"" substr(ts, 1, 10) "\"" (n != "" ? ",\"n\":" n : "") (sn != "" ? ",\"subnets\":" sn : "") \
                  (ty ~ /^(add24|promote)$/ ? ",\"dnd\":" dnd : "") (wl != "" ? ",\"wl\":" js(wl) : "") ",\"src\":\"log\""
        }
        END { flush() }' | awk 'NR <= 1000' > "$LOGHIST_FILE.tmp.$$" 2>/dev/null && mv -f "$LOGHIST_FILE.tmp.$$" "$LOGHIST_FILE"
    rm -f "$LOGHIST_FILE.tmp.$$"
}
# ── --status ────────────────────────────────────────────────────────────────
declare -A DAYEP
day_epoch() {    # YYYY-MM-DD → REPLY (epoch), aynı gün için tek date çağrısı
    [ -n "${DAYEP[$1]}" ] || DAYEP[$1]=$(date -d "$1" +%s 2>/dev/null || echo 0)
    REPLY="${DAYEP[$1]}"
}
do_status() {
    local now limit tlimit pc tc running=false last line tok kind dnd n added c u b
    local re_n=': ([0-9]+) ' re_d='- ([A-Z][a-z]{2} [A-Z][a-z]{2} +[0-9]{1,2} [0-9:]{8} [0-9]{4})[[:space:]]*$'
    now=$(date +%s)
    parse_deny "$DENY_FILE" 1
    read_temp_groups
    limit=$(num "$(conf_val DENY_IP_LIMIT)"); tlimit=$(num "$(conf_val DENY_TEMP_IP_LIMIT)")
    pc=$(grep -cE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$DENY_FILE")
    # Geçici liste doluluğu: her sayfa yoklamasında csf -t (Perl) başlatmak yerine csf.tempban'ın
    # satırları sayılır; csf.pl dotempban ile aynı: boş olmayan her satır, port listesindeki her port için
    # bir DENY satırı (port yoksa bir).
    tc=0; [ -r "$CSF_VAR/csf.tempban" ] && tc=$(awk -F'|' '$0 != "" { k = split($3, a, ","); c += (k > 0 ? k : 1) } END { print c + 0 }' "$CSF_VAR/csf.tempban")
    lock_busy && running=true
    last=$(grep '"type":"run"' "$EVENTS_FILE" 2>/dev/null | grep -E '^\{"t":[0-9]+,.*\}$' | tail -1)   # yarım satır JSON'u bozmasın
    local cronm; cronm=$(cron_now)

    # Aktif grup banları (kalıcı + geçici)
    local groups=() gtext=() ghist="" gi
    local g_tok=() g_kind=() g_dnd=() g_n=() g_ds=() g_ep=()
    while IFS= read -r line; do
        tok="${line%%[[:space:]]*}"
        [[ "$tok" =~ $CIDR4_RE && "$tok" == */* ]] || continue
        case "$line" in *Auto-grouped*|*csf_autogroup:*) ;; *) continue ;; esac
        kind=perm; [[ "$line" == *"from temp"* ]] && kind=promoted; [[ "$line" == *csf_autogroup:* ]] && kind=manual
        dnd=false; is_dnd "$line" && dnd=true
        n=0; [[ "$line" =~ $re_n ]] && n="${BASH_REMATCH[1]}"
        added=""; [[ "$line" =~ $re_d ]] && added="${BASH_REMATCH[1]}"
        g_tok+=("$tok"); g_kind+=("$kind"); g_dnd+=("$dnd"); g_n+=("$n"); g_ds+=("${added:-Thu Jan  1 00:00:00 1970}")
    done < "$DENY_FILE"
    # Eklenme tarihleri tek date çağrısıyla (satır başına alt süreç yerine); sayı tutmazsa tek tek
    if [ ${#g_ds[@]} -gt 0 ]; then
        mapfile -t g_ep < <(printf '%s\n' "${g_ds[@]}" | LC_ALL=C date -f - +%s 2>/dev/null)
        if [ ${#g_ep[@]} -ne ${#g_ds[@]} ]; then
            g_ep=(); for gi in "${!g_ds[@]}"; do g_ep+=("$(LC_ALL=C date -d "${g_ds[gi]}" +%s 2>/dev/null || echo 0)"); done
        fi
    fi
    for gi in "${!g_tok[@]}"; do
        added="${g_ep[gi]:-0}"; [[ "$added" =~ ^[0-9]+$ ]] && [ "$added" -gt 86400 ] || added=0
        tok="${g_tok[gi]}"; kind="${g_kind[gi]}"; dnd="${g_dnd[gi]}"
        groups+=("{\"cidr\":\"$tok\",\"kind\":\"$kind\",\"dnd\":$dnd,\"n\":${g_n[gi]},\"added\":$added,\"ttl\":0}")
        [ "$added" -gt 0 ] && ghist+="$added $kind $tok"$'\n'
        [ "$JSON" = 1 ] || gtext+=("$(printf '%-18s %-9s %s' "$tok" "$kind" "$([ "$dnd" = true ] && echo 'do not delete')")")
    done
    for c in "${!TG_TTL[@]}"; do
        [ "${TG_TTL[$c]}" -gt 0 ] || continue
        n=0; [[ "${TG_NOTE[$c]}" =~ $re_n ]] && n="${BASH_REMATCH[1]}"
        groups+=("{\"cidr\":\"$c\",\"kind\":\"temp\",\"dnd\":false,\"n\":$n,\"added\":0,\"ttl\":${TG_TTL[$c]}}")
        [ "$JSON" = 1 ] || gtext+=("$(printf '%-18s %-9s %s' "$c" "temp" "$(m "$M_S_TTL" "$(( TG_TTL[$c] / 3600 ))h")")")
    done

    # Terfi bekleyenler: sayaçtaki "a.b.c tarih" kayıtları
    local pending=() ptext=() age left ttl
    while read -r c u; do
        [[ "$c" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ && "$u" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
        day_epoch "$u"; age=$(( (now - REPLY) / 86400 )); left=$(( SAYAC_RETENTION_DAYS - age ))
        ttl="${TG_TTL[$c.0/24]:-0}"; [ "$ttl" -lt 0 ] && ttl=0
        pending+=("{\"prefix\":\"$c\",\"since\":\"$u\",\"days_left\":$left,\"temp_ttl\":$ttl}")
        [ "$JSON" = 1 ] || ptext+=("$(printf '%-18s %s · %s' "$c.0/24" "$u" "$(m "$M_S_DAYSLEFT" "$left")")")
    done < "$SAYAC_FILE"

    # Kontrol edilecekler: son REVIEW_DAYS gündeki /16 uyarıları ve beyaz liste atlamaları,
    # blok başına en yenisi; yoksayılanlar ve o arada banlanmış olanlar düşülür.
    local review=() rtext=() t ty
    local -A seen=() W16D=()
    # tekrar eden şüpheli ağ: kontrol süresi içinde kaç ayrı günde işaretlendi (sayaçtaki günlük kayıtlar)
    if [ -r "$SAYAC_FILE" ]; then
        while read -r k u; do [ -n "$k" ] && W16D[$k]="$u"; done < <(awk -v s="$(date -d "$REVIEW_DAYS days ago" +%Y-%m-%d)" '
            $1 ~ /^(WARN16_|WARN_TEMP16_)/ && $2 >= s { p = $1; sub(/^WARN(_TEMP)?16_/, "", p); if (!((p, $2) in d)) { d[p, $2] = 1; c[p]++ } }
            END { for (p in c) print p ".0.0/16", c[p] }' "$SAYAC_FILE")
    fi
    if [ -r "$EVENTS_FILE" ]; then
        while IFS= read -r line; do
            [[ "$line" =~ ^\{\"t\":([0-9]+),.*\}$ ]] || continue; t="${BASH_REMATCH[1]}"   # yarım satırlar atlanır
            [ "$t" -lt $(( now - REVIEW_DAYS * 86400 )) ] && break
            [[ "$line" =~ \"type\":\"(warn16|warn16t|skip_wl)\" ]] || continue; ty="${BASH_REMATCH[1]}"
            [[ "$line" =~ \"cidr\":\"([0-9./]+)\" ]] || continue; c="${BASH_REMATCH[1]}"
            [ -n "${seen[$c]}" ] && continue; seen[$c]=1
            ign_until "$c" && continue
            cidr_range "$c" && perm_covers "$R_LO" "$R_HI" && continue
            [ -n "${W16D[$c]}" ] && line="${line%\}},\"rep\":${W16D[$c]}}"
            review+=("$line")
            rtext+=("$(printf '%-18s %s · %s' "$c" "$ty" "$(date -d "@$t" '+%d.%m %H:%M')")")
        done < <(tac "$EVENTS_FILE")
    fi
    # Olay kaydı başlamadan önceki uyarılar ve atlamalar sayaçta tarihiyle duruyor (IP ayrıntısı yok)
    if [ -r "$SAYAC_FILE" ]; then
        local rsince k u
        rsince=$(date -d "$REVIEW_DAYS days ago" +%Y-%m-%d)
        while read -r k u; do
            [[ "$u" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
            [[ "$u" < "$rsince" ]] && continue
            case "$k" in
                WARN16_*)      ty=warn16;  c="${k#WARN16_}.0.0/16" ;;
                WARN_TEMP16_*) ty=warn16t; c="${k#WARN_TEMP16_}.0.0/16" ;;
                WLSKIP_*)      ty=skip_wl; c="${k#WLSKIP_}.0/24" ;;
                *) continue ;;
            esac
            [[ "$c" =~ $CIDR4_RE ]] || continue
            [ -n "${seen[$c]}" ] && continue; seen[$c]=1
            ign_until "$c" && continue
            cidr_range "$c" && perm_covers "$R_LO" "$R_HI" && continue
            # daha önce "Ayrıntı" ile getirildiyse saklanan sonuç da gelir
            local hc=""
            [ -r "$HIST_FILE" ] && hc=$(grep -F "{\"cidr\":\"$c\",\"day\":\"$u\"," "$HIST_FILE" | grep -E '^\{"cidr":.*\}$' | tail -1)
            day_epoch "$u"
            review+=("{\"t\":$REPLY,\"type\":\"$ty\",\"cidr\":\"$c\",\"day\":\"$u\",\"hist\":true${W16D[$c]:+,\"rep\":${W16D[$c]}}${hc:+,\"cached\":$hc}}")
            rtext+=("$(printf '%-18s %s · %s' "$c" "$ty" "$(date -d "$u" '+%d.%m')")")
        done < <(sort -k2,2r "$SAYAC_FILE")        # blok başına en yeni tarih
    fi

    # Bir önceki pencerede (REVIEW_DAYS gün daha geride) kaç FARKLI blok/ağ işaretlenmişti: kartın haftalık
    # değişimi aynı ölçüyle (olay sayısı değil, farklı kayıt sayısı) karşılaştırılsın.
    local rprev=0 rw1 rw2 rs1 rs2
    rw2=$(( now - REVIEW_DAYS * 86400 )); rw1=$(( now - 2 * REVIEW_DAYS * 86400 ))
    printf -v rs1 '%(%Y-%m-%d)T' "$rw1"; printf -v rs2 '%(%Y-%m-%d)T' "$rw2"
    rprev=$( { [ -r "$EVENTS_FILE" ] && awk -v a="$rw1" -v b="$rw2" '
                   match($0, /"t":[0-9]+/) { t = substr($0, RSTART + 4, RLENGTH - 4) + 0 }
                   t >= a && t < b && /"type":"(warn16|warn16t|skip_wl)"/ && match($0, /"cidr":"[0-9.\/]+"/) { print substr($0, RSTART + 8, RLENGTH - 9) }' "$EVENTS_FILE"
               [ -r "$SAYAC_FILE" ] && awk -v a="$rs1" -v b="$rs2" '$2 >= a && $2 < b {
                   k = $1
                   if (k ~ /^WARN16_/)           { sub(/^WARN16_/, "", k);      print k ".0.0/16" }
                   else if (k ~ /^WARN_TEMP16_/) { sub(/^WARN_TEMP16_/, "", k); print k ".0.0/16" }
                   else if (k ~ /^WLSKIP_/)      { sub(/^WLSKIP_/, "", k);      print k ".0/24" } }' "$SAYAC_FILE"; } | sort -u | grep -c .)

    # Yoksayılanlar
    local ignored=() itext=()
    if [ -r "$IGNORE_FILE" ]; then
        while read -r c u b; do
            [[ "$c" =~ $CIDR4_RE ]] || continue
            [[ "$u" < "$TODAY" ]] && continue
            jstr "$b"; ignored+=("{\"cidr\":\"$c\",\"until\":\"$u\",\"by\":$REPLY}")
            itext+=("$(printf '%-18s → %s (%s)' "$c" "$u" "$b")")
        done < "$IGNORE_FILE"
    fi

    local recent=()
    [ -r "$EVENTS_FILE" ] && mapfile -t recent < <(grep -v '"type":"run"' "$EVENTS_FILE" | grep -E '^\{"t":[0-9]+,.*\}$' | tail -n 300)
    # olay kaydından önceki işler (günlükten; bir kez hesaplanıp saklanır)
    [ -f "$LOGHIST_FILE" ] || loghist_build
    # "Ayrıntı" ile daha önce getirilenler (blok|gün): Geçmiş'teki günlük satırları da kullanır
    local hcache=()
    [ -r "$HIST_FILE" ] && mapfile -t hcache < <(grep -E '^\{"cidr":.*\}$' "$HIST_FILE")
    if [ -s "$LOGHIST_FILE" ]; then
        local lh=()
        mapfile -t lh < <(grep -E '^\{"t":[0-9]+,.*\}$' "$LOGHIST_FILE")
        recent=("${lh[@]}" "${recent[@]}")
    fi

    # Sahipler (önbellekten), en çok saldıran ağlar, son 30 günün günlük etkinliği
    owners_load
    local owners=() pfx_seen=() dstart daily=""
    for p in $( { deny_prefixes; pending_prefixes; } | sort -u); do
        [ -n "${OWN_A[$p]}" ] || continue
        jstr "${OWN_N[$p]}"; owners+=("\"$p\":[\"${OWN_A[$p]}\",\"${OWN_C[$p]}\",$REPLY]")
    done
    asn_top 10
    local tops=() a nm cc g bl sg den
    if [ -n "$ASN_TOP" ]; then
        while IFS='|' read -r a nm cc g bl sg den; do
            jstr "$nm"; tops+=("{\"asn\":\"$a\",\"name\":$REPLY,\"cc\":\"$cc\",\"groups\":$g,\"blocks\":$bl,\"singles\":$sg,\"denied\":$([ "$den" = 1 ] && echo true || echo false)}")
        done <<< "$ASN_TOP"
    fi
    asn_top 10 blocks
    local btops=()
    if [ -n "$ASN_TOP" ]; then
        while IFS='|' read -r a nm cc g bl sg den; do
            jstr "$nm"; btops+=("{\"asn\":\"$a\",\"name\":$REPLY,\"cc\":\"$cc\",\"groups\":$g,\"blocks\":$bl,\"singles\":$sg,\"denied\":$([ "$den" = 1 ] && echo true || echo false)}")
        done <<< "$ASN_TOP"
    fi
    local imj='{"present":false}' itops=() icnt rs r1 rn rj
    if imunify_top 10; then
        if [ -n "$IM_TOP" ]; then
            while IFS='|' read -r a nm cc icnt rs; do
                rj=""
                for r1 in ${rs//,/ }; do rn="${r1##*:}"; rj+="${rj:+,}[\"${r1%:*}\",$(num "$rn")]"; done
                jstr "$nm"; itops+=("{\"asn\":\"$a\",\"name\":$REPLY,\"cc\":\"$cc\",\"count\":$icnt,\"reasons\":[$rj]}")
            done <<< "$IM_TOP"
        fi
        local IFS=,
        imj="{\"present\":true,\"total\":$IM_TOTAL,\"known\":$IM_KNOWN,\"t\":$IM_T,\"top\":[${itops[*]}]}"
        unset IFS
    fi
    dstart=$(date -d "$(date -d '29 days ago' +%Y-%m-%d) 00:00" +%s)
    # Günlük etkinlik: olay kaydı + olay kaydı başlamadan önceki günler için csf.deny'deki grup
    # tarihleri ve sayaçtaki tarihli kayıtlar. Aynı olay iki kaynakta da varsa (tür + blok + gün)
    # bir kez sayılır.
    local dlist="" di dd dfiles=()
    for di in $(seq 29 -1 0); do printf -v dd '%(%Y-%m-%d)T' $(( now - di * 86400 )); dlist+="${dlist:+,}$dd"; done   # printf %T: alt süreç yok
    [ -r "$EVENTS_FILE" ] && dfiles+=("$EVENTS_FILE")
    [ -r "$SAYAC_FILE" ] && dfiles+=("$SAYAC_FILE")
    daily=$(printf '%s' "$ghist" | awk -v s="$dstart" -v dl="$dlist" -v evf="$EVENTS_FILE" -v syf="$SAYAC_FILE" '
        BEGIN { nd = split(dl, D, ","); for (k = 1; k <= nd; k++) DI[D[k]] = k - 1 }
        function put(L, key, d) {
            if (d < 0 || d > 29 || ((L, key, d) in U)) return
            U[L, key, d] = 1; C[substr(L, 1, 1), d]++
        }
        FILENAME == evf {
            if (!match($0, /"t":[0-9]+/)) next; t = substr($0, RSTART + 4, RLENGTH - 4) + 0; if (t < s) next
            if (!match($0, /"type":"[a-z0-9_]+"/)) next; ty = substr($0, RSTART + 8, RLENGTH - 9)
            c = ""; if (match($0, /"cidr":"[0-9.\/]+"/)) c = substr($0, RSTART + 8, RLENGTH - 9)
            L = (ty == "add24" || ty == "manual_ban") ? "A" : ty == "promote" ? "P" : ty == "temp24" ? "T" : \
                ty == "warn16" ? "W1" : ty == "warn16t" ? "W2" : ty == "skip_wl" ? "S" : ""
            if (L != "") put(L, c, int((t - s) / 86400))
            next
        }
        FILENAME == syf {
            if (!($2 in DI)) next; d = DI[$2]
            if ($1 ~ /^[0-9]+\.[0-9]+\.[0-9]+$/) put("T", $1 ".0/24", d)
            else if ($1 ~ /^WARN16_/)      put("W1", substr($1, 8) ".0.0/16", d)
            else if ($1 ~ /^WARN_TEMP16_/) put("W2", substr($1, 13) ".0.0/16", d)
            else if ($1 ~ /^WLSKIP_/)      put("S", substr($1, 8) ".0/24", d)
            next
        }
        NF == 3 { put($2 == "promoted" ? "P" : "A", $3, int(($1 - s) / 86400)) }   # grup: eklenme tür cidr
        END { split("A T P W S", keys, " ")
              for (k = 1; k <= 5; k++) { line = ""
                  for (d = 0; d < 30; d++) line = line (d ? "," : "") (C[keys[k], d] + 0)
                  printf "\"%s\":[%s]%s", keys[k], line, (k < 5 ? "," : "") } }' "${dfiles[@]}" -)
    [ -z "$daily" ] && daily='"A":[],"T":[],"P":[],"W":[],"S":[]'
    # Son turlar (durum bandı): son 36 turun [zaman, süre]'si, son 24 saatteki tur sayısı, ilk tur
    local runsj='{"n24":0,"first":0,"list":[]}'
    if [ -r "$EVENTS_FILE" ]; then
        # p7/t7: 7 gün önceki (ya da daha yeni ilk) turun liste doluluğu — özet kartlarındaki haftalık değişim için
        runsj=$(grep '"type":"run"' "$EVENTS_FILE" | awk -v c=$(( now - 86400 )) -v w=$(( now - 7 * 86400 )) '
            { t = 0; d = 0
              if (match($0, /"t":[0-9]+/))   t = substr($0, RSTART + 4, RLENGTH - 4) + 0
              if (match($0, /"dur":[0-9]+/)) d = substr($0, RSTART + 6, RLENGTH - 6) + 0
              if (NR == 1) f = t; if (t >= c) n++; T[NR] = t; D[NR] = d
              if (!got && t >= w && match($0, /"perm_used":[0-9]+/)) {
                  p7 = substr($0, RSTART + 12, RLENGTH - 12) + 0
                  if (match($0, /"temp_used":[0-9]+/)) t7 = substr($0, RSTART + 12, RLENGTH - 12) + 0; else t7 = -1
                  got = 1 } }
            END { s = NR > 36 ? NR - 35 : 1; o = ""
                  for (i = s; i <= NR; i++) o = o (o != "" ? "," : "") "[" T[i] "," D[i] "]"
                  printf "{\"n24\":%d,\"first\":%d,\"p7\":%d,\"t7\":%d,\"list\":[%s]}", n, f, (got ? p7 : -1), (got ? t7 : -1), o }')
    fi

    if [ "$JSON" = 1 ]; then
        local IFS=,
        printf '{"ok":true,"version":"%s","lang":"%s","now":%s,"running":%s,' "$VERSION" "$MSG_LANG" "$now" "$running"
        health_check
        printf '"review_prev":%s,' "$(num "$rprev")"
        printf '"health":{"csf":"%s","lfd":"%s"},"expire":{"days":%s,"auto":%s},"repeat_min":%s,' "$H_CSF" "$H_LFD" "$(num "$BLOCK_EXPIRE_DAYS")" "$([ "$BLOCK_EXPIRE_AUTO" = 1 ] && echo true || echo false)" "$(num "$REPEAT16_MIN")"
        printf '"config":{"t24":%s,"t24p":%s,"t16":%s,"tt24":%s,"tt16":%s,"retention":%s,"review_days":%s,"lookup":%s},' \
            "$(num "$THRESHOLD_24")" "$(num "$THRESHOLD_24_PERMANENT")" "$(num "$THRESHOLD_16")" "$(num "$THRESHOLD_TEMP_24")" \
            "$(num "$THRESHOLD_TEMP_16")" "$(num "$SAYAC_RETENTION_DAYS")" "$(num "$REVIEW_DAYS")" "$([ "$LOOK_INIT" = 1 ] && echo true || echo false)"
        printf '"usage":{"perm":[%s,%s],"temp":[%s,%s]},' "$(num "$pc")" "$limit" "$(num "$tc")" "$tlimit"
        printf '"last_run":%s,' "${last:-null}"
        jstr "$cronm"; printf '"cron_min":%s,"runs":%s,' "$REPLY" "$runsj"
        printf '"cron_interval":%s,"daily":{"start":%s,%s},"owners":{%s},"asn_top":[%s],"blocks_top":[%s],"imunify":%s,' \
            "$(cron_interval "$cronm")" "$dstart" "$daily" "${owners[*]}" "${tops[*]}" "${btops[*]}" "$imj"
        printf '"groups":[%s],"pending":[%s],"review":[%s],"ignored":[%s],"hist_cache":[%s],"events":[%s]}\n' \
            "${groups[*]}" "${pending[*]}" "${review[*]}" "${ignored[*]}" "${hcache[*]}" "${recent[*]}"
        return 0
    fi

    local x p=0 tp=0
    [ "$limit" -gt 0 ] && p=$(( pc * 100 / limit )); [ "$tlimit" -gt 0 ] && tp=$(( tc * 100 / tlimit ))
    echo "$(m "$M_S_TITLE" "$VERSION")"
    if [ "$running" = true ]; then echo "  $M_S_LAST: $M_S_RUNNING"
    elif [[ "$last" =~ \"t\":([0-9]+) ]]; then echo "  $M_S_LAST: $(date -d "@${BASH_REMATCH[1]}" '+%Y-%m-%d %H:%M')"
    else echo "  $M_S_LAST: $M_S_NEVER"; fi
    echo "  $M_S_USAGE: $M_S_PERM $pc/$limit (%$p) · $M_S_TEMP $tc/$tlimit (%$tp)"
    status_section() { local title="$1"; shift; echo; echo "$title (${#@})"; [ $# -eq 0 ] && echo "  $M_S_NONE"; for x in "$@"; do echo "  $x"; done; }
    status_section "$(m "$M_S_REVIEW" "$REVIEW_DAYS")" "${rtext[@]}"
    status_section "$M_S_PENDING" "${ptext[@]}"
    status_section "$M_S_GROUPS" "${gtext[@]}"
    [ ${#itext[@]} -gt 0 ] && status_section "$M_S_IGNORED" "${itext[@]}"
    echo; echo "$M_S_RECENT"
    for x in "${recent[@]: -12}"; do
        [[ "$x" =~ \"t\":([0-9]+) ]] && t="${BASH_REMATCH[1]}"
        [[ "$x" =~ \"type\":\"([a-z0-9_]+)\" ]] && ty="${BASH_REMATCH[1]}"
        c=""; [[ "$x" =~ \"cidr\":\"([0-9./]+)\" ]] && c="${BASH_REMATCH[1]}"
        printf '  %s  %-13s %s\n' "$(date -d "@$t" '+%d.%m %H:%M')" "$ty" "$c"
    done
    [ ${#recent[@]} -eq 0 ] && echo "  $M_S_NONE"
    return 0
}

# ── --lookup IP ─────────────────────────────────────────────────────────────
# Olay kaydı başlamadan önceki bir uyarının ayrıntısı: o gün ve bir önceki gün lfd günlüğünde bu
# bloktan geçen IP'ler (ban satırındaki sebeple), şu an csf.deny ve geçici listede olanlarla birlikte.
do_history() {   # CIDR GÜN(YYYY-MM-DD) [GÜN SAYISI, varsayılan 2: o gün ve önceki] → JSON
    local cidr="$1" day="$2" span="${3:-2}" re dl="" di f ip t why src n=0 total subnets js="" p
    local -A HT=() HW=() HS=()
    if ! [[ "$cidr" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.0/24$|^([0-9]{1,3})\.([0-9]{1,3})\.0\.0/16$ ]] || \
       ! [[ "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || ! date -d "$day" >/dev/null 2>&1 || \
       ! [[ "$span" =~ ^[0-9]{1,2}$ ]] || [ "$span" -lt 1 ] || [ "$span" -gt 60 ]; then
        echo '{"ok":false,"error":"bad_input"}'; return 2
    fi
    if [[ "$cidr" == */24 ]]; then re="${cidr%.0/24}."; else re="${cidr%.0.0/16}."; fi
    # bakılacak günler (lfd satırının başı: "Sep 26"): blok banında tekiller günler önce banlanmış olabilir
    for (( di = 0; di < span; di++ )); do dl+="${dl:+|}$(LC_ALL=C date -d "$day -$di day" '+%b %e')"; done
    # lfd satırı: "Sep 26 04:00:10 lin lfd[123]: (sshd) Failed SSH login from 34.47.1.2 (US/..): 5 in the
    # last 3600 secs - *Blocked in csf* for 3600 secs [LF_SSHD]" ya da "Incoming IP 34.47.1.2 temporary block removed"
    while IFS='|' read -r ip t why; do
        [ -n "$ip" ] || continue
        [ -z "${HT[$ip]}" ] && HT[$ip]="$t"
        [ -n "$why" ] && [ -z "${HW[$ip]}" ] && HW[$ip]="$why"
        HS[$ip]=lfd
    done < <( { for f in "$LFD_LOG" "$LFD_LOG.1"; do [ -r "$f" ] && cat "$f"; done
                for f in "$LFD_LOG".*.gz "$LFD_LOG"-*.gz; do [ -r "$f" ] && zcat "$f"; done; } 2>/dev/null |
        awk -v dl="$dl" -v pre="$re" '
            BEGIN { nd = split(dl, DL, "|"); for (k = 1; k <= nd; k++) OK[DL[k]] = 1 }
            !(substr($0, 1, 6) in OK) { next }
            {
                msg = $0; sub(/^[A-Z][a-z][a-z] +[0-9]+ [0-9:]+ [^ ]+ [^:]+: /, "", msg)
                rest = msg
                while (match(rest, /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/)) {
                    ip = substr(rest, RSTART, RLENGTH); rest = substr(rest, RSTART + RLENGTH)
                    if (index(ip, pre) != 1) continue
                    why = ""
                    if (msg ~ /Blocked in csf/) {
                        why = msg; i = index(why, ip); if (i > 1) why = substr(why, 1, i - 1)
                        sub(/ +(from|IP|by|for)? *$/, "", why); sub(/[ :-]+$/, "", why)
                        if (match(msg, /\[[A-Z0-9_]+\] *$/)) { tag = substr(msg, RSTART + 1, RLENGTH - 2); sub(/\] *$/, "", tag); why = why (why != "" ? " · " : "") tag }
                    }
                    print ip "|" substr($0, 1, 15) "|" why
                }
            }')
    # şu an csf.deny'de (kalıcı tekil) ve geçici listede olanlar
    parse_deny "$DENY_FILE" 1
    for ip in "${!SINGLE_NOTE[@]}"; do
        [[ "$ip" == "$re"* ]] || continue
        HS[$ip]=deny; short_reason "${SINGLE_NOTE[$ip]}" "$ip"; [ -n "$REPLY" ] && HW[$ip]="$REPLY"
    done
    if [ -r "$CSF_VAR/csf.tempban" ]; then
        local tt tip port dir to note
        while IFS='|' read -r tt tip port dir to note; do
            [[ "$tip" == "$re"* ]] || continue
            [ -z "${HS[$tip]}" ] && HS[$tip]=temp
            short_reason "$note" "$tip"; [ -n "$REPLY" ] && [ -z "${HW[$tip]}" ] && HW[$tip]="$REPLY"
        done < "$CSF_VAR/csf.tempban"
    fi
    total=${#HS[@]}
    subnets=$(for ip in "${!HS[@]}"; do echo "${ip%.*}"; done | sort -u | grep -c .)
    owners_load
    local looked=0
    for ip in $(printf '%s\n' "${!HS[@]}" | sort -V); do
        [ "$n" -ge 40 ] && break; n=$((n + 1))
        p="${ip%.*}"
        if [ -z "${OWN_L[$p]+x}" ] && [ "$looked" -lt 10 ]; then owner_lookup "$ip"; looked=$((looked + 1)); fi
        REPLY=""; [ "$n" -le 20 ] && ptr_lookup "$ip"
        local jh jw jo jt
        jstr "$REPLY"; jh="$REPLY"
        why="${HW[$ip]}"; [ -z "$why" ] && why="$M_H_NOREASON"
        jstr "$why"; jw="$REPLY"; jstr "${OWN_L[$p]}"; jo="$REPLY"; jstr "${HT[$ip]}"; jt="$REPLY"
        js+="${js:+,}{\"ip\":\"$ip\",\"host\":$jh,\"why\":$jw,\"owner\":$jo,\"src\":\"${HS[$ip]}\",\"when\":$jt}"
    done
    owners_save 2>/dev/null
    local res="{\"cidr\":\"$cidr\",\"day\":\"$day\",\"span\":$span,\"total\":$total,\"subnets\":$(num "$subnets"),\"ips\":[$js]}"
    # Sonuç saklanır: sayfa her açıldığında yeniden "Ayrıntı" demek gerekmesin. Aynı blok+gün için
    # (ve aynı gün sayısı) için tek satır, en çok 50 kayıt; geçici dosya + mv (aynı anda okuyan durum çıktısı yarım görmesin).
    if [ "$DRY" != 1 ]; then
        local tmp="$HIST_FILE.tmp.$$"
        { [ -r "$HIST_FILE" ] && grep -vF "{\"cidr\":\"$cidr\",\"day\":\"$day\",\"span\":$span," "$HIST_FILE" | awk 'NR <= 49'
          printf '%s
' "$res"; } > "$tmp" 2>/dev/null && mv -f "$tmp" "$HIST_FILE"
        rm -f "$tmp"
    fi
    echo "{\"ok\":true,${res#\{}"
}
do_lookup() {
    local ip="$1" n host="" fwd=false txt asn="" pfx="" cc="" reg="" alloc="" asname="" a b c d i
    local deny="" cover="" temp="" wl="" rig="" pend="" ign="" line t tip port dir to note now
    if ! [[ "$ip" =~ $IPV4_RE ]] || ! cidr_range "$ip"; then
        if [ "$JSON" = 1 ]; then jstr "$(m "$M_BAD_IP" "$ip")"; echo "{\"ok\":false,\"error\":$REPLY}"; else m "$M_BAD_IP" "$ip"; echo; fi
        return 2
    fi
    n=$R_LO; now=$(date +%s)
    parse_deny "$DENY_FILE" 1
    ptr_lookup "$ip"; host="$REPLY"
    if [ -n "$host" ] && resolve_a "$host" && printf '%s\n' "$REPLY" | grep -qxF "$ip"; then fwd=true; fi
    IFS=. read -r a b c d <<< "$ip"
    if dns_q TXT "$d.$c.$b.$a.origin.asn.cymru.com"; then
        txt="${REPLY%%$NL*}"      # "60729 | 185.220.101.0/24 | DE | ripencc | 2017-09-12"
        asn=$(printf '%s' "$txt" | cut -d'|' -f1 | awk '{print $1}')
        pfx=$(printf '%s' "$txt" | cut -d'|' -f2 | tr -d ' ')
        cc=$(printf '%s' "$txt" | cut -d'|' -f3 | tr -d ' ')
        reg=$(printf '%s' "$txt" | cut -d'|' -f4 | tr -d ' ')
        alloc=$(printf '%s' "$txt" | cut -d'|' -f5 | tr -d ' ')
        if [[ "$asn" =~ ^[0-9]+$ ]] && dns_q TXT "AS$asn.asn.cymru.com"; then
            asname=$(printf '%s' "${REPLY%%$NL*}" | cut -d'|' -f5- | sed 's/^ *//')
        fi
    fi
    [ -n "${DENY_IP[$ip]+x}" ] && deny="$(deny_line "$ip")"
    for i in "${!DC_LO[@]}"; do
        if (( DC_LO[i] <= n && DC_HI[i] >= n )); then cover="$(deny_line "${DC_TXT[i]}")"; [ -z "$cover" ] && cover="${DC_TXT[i]}"; break; fi
    done
    if [ -r "$CSF_VAR/csf.tempban" ]; then
        while IFS='|' read -r t tip port dir to note; do
            cidr_range "$tip" 2>/dev/null || continue
            if (( R_LO <= n && R_HI >= n )); then
                temp="$tip · $(( ($(num "$t") + $(num "$to") - now) / 60 )) min · $note"; break
            fi
        done < "$CSF_VAR/csf.tempban"
    fi
    wl_overlap "$n" "$n" && wl="$WL_HIT"
    if [ -n "$host" ] && [ "${#RIGNORE[@]}" -gt 0 ]; then
        for i in "${RIGNORE[@]}"; do
            if [ "$host" = "$i" ] || { [[ "$i" == *.* ]] && [[ "$host" == *"$i" ]]; }; then rig="$i"; break; fi
        done
    fi
    local p24="${ip%.*}"
    line=$(grep -m1 -E "^${p24//./\\.} " "$SAYAC_FILE" 2>/dev/null)
    [ -n "$line" ] && pend="${line#* }"
    if ign_until "${ip%.*}.0/24"; then ign="${ip%.*}.0/24 → $IGN_UNTIL"
    elif ign_until "${ip%.*.*}.0.0/16"; then ign="${ip%.*.*}.0.0/16 → $IGN_UNTIL"; fi

    if [ "$JSON" = 1 ]; then
        local o="{\"ok\":true,\"ip\":\"$ip\"" k v
        for k in host asname pfx cc reg alloc deny cover temp wl rig pend ign; do
            v="${!k}"; jstr "$v"; o+=",\"$k\":$REPLY"
        done
        o+=",\"asn\":\"$asn\",\"fwd\":$fwd,\"lookup\":$([ "$LOOK_INIT" = 1 ] && echo true || echo false)}"
        echo "$o"; return 0
    fi
    echo "$ip"
    printf '  %-18s %s\n' "$M_L_HOST" "${host:--}$([ -n "$host" ] && { [ "$fwd" = true ] && echo " ($M_L_FWD)" || echo " ($M_L_NOFWD)"; })"
    [ -n "$asn" ] && printf '  %-18s %s\n' "$M_L_OWNER" "AS$asn ${asname:-?}"
    [ -n "$pfx" ] && printf '  %-18s %s\n' "$M_L_PREFIX" "$pfx ($cc)"
    [ -n "$reg" ] && printf '  %-18s %s\n' "$M_L_REG" "$reg · $alloc"
    [ -n "$deny" ]  && printf '  %-18s %s\n' "$M_L_DENY" "$deny"
    [ -n "$cover" ] && printf '  %-18s %s\n' "$M_L_DENY" "$cover"
    [ -n "$temp" ]  && printf '  %-18s %s\n' "$M_L_TEMP" "$temp"
    [ -n "$wl" ]    && printf '  %-18s %s\n' "$M_L_WL" "$wl"
    [ -n "$rig" ]   && printf '  %-18s %s\n' "$M_L_WL" "csf.rignore: $rig"
    [ -n "$pend" ]  && printf '  %-18s %s\n' "$M_L_PENDING" "${ip%.*}.0/24 · $pend"
    [ -n "$ign" ]   && printf '  %-18s %s\n' "$M_L_IGN" "$ign"
    return 0
}

# ── --action (WHM eklentisinin butonları) ───────────────────────────────────
# Çıkış kodu: 0 tamam · 1 başarısız · 2 geçersiz girdi · 3 meşgul · 4 ek onay gerekiyor (beyaz liste)
act_out() {      # CODE MESAJ
    local ok=false; [ "$1" = 0 ] && ok=true
    if [ "$JSON" = 1 ]; then jstr "$2"; echo "{\"ok\":$ok,\"code\":$1,\"message\":$REPLY}"; else echo "$2"; fi
    return "$1"
}
strip_dnd() {    # CIDR → satırdaki "do not delete" ifadesini kaldır (csf -dr ancak böyle siler)
    # csf.deny'nin inode'u korunur ve csf'in kendi kilidi (flock) tutulur: csf/lfd aynı anda
    # yazarsa beklesin, eski inode'a yazıp kaybolmasın. Önce yedek alınır.
    local tmp rc
    tmp=$(mktemp) || return 1
    cp -p "$DENY_FILE" "${DENY_FILE}.autogroup.bak" 2>/dev/null
    (
        command -v flock >/dev/null 2>&1 && { flock -x 8 || exit 1; }
        awk -v c="$1" '{ split($0, f, /[ \t]/); if (f[1] == c) gsub(/[ ]*-?[ ]*[Dd][Oo][ \t]+[Nn][Oo][Tt][ \t]+[Dd][Ee][Ll][Ee][Tt][Ee]/, ""); print }' \
            "$DENY_FILE" > "$tmp" && [ -s "$tmp" ] && cat "$tmp" > "$DENY_FILE"
    ) 8<"$DENY_FILE"
    rc=$?; rm -f "$tmp"; return $rc
}
do_action() {    # NAME TARGET [DAYS]
    local name="$1" t="$2" days="${3:-30}" cidr bits pfx ip line jw
    take_lock || { act_out 3 "$M_BUSY"; return 3; }
    parse_deny "$DENY_FILE" 1
    case "$name" in
        ban16|ban24)
            bits="${name#ban}"
            if [ "$bits" = 16 ]; then [[ "$t" =~ ^[0-9]{1,3}\.[0-9]{1,3}$ ]] && cidr="$t.0.0/16"
            else [[ "$t" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] && cidr="$t.0/24"; fi
            { [ -n "$cidr" ] && cidr_range "$cidr"; } || { act_out 2 "$(m "$M_BAD_TARGET" "$t")"; return; }
            local lo=$R_LO hi=$R_HI
            perm_covers "$lo" "$hi" && { act_out 1 "$(m "$M_A_EXISTS" "$cidr")"; return; }
            WL_HIT=""
            if [ "$bits" = 24 ]; then wl_check "$t" "${ips24[$t]}"; else wl_overlap "$lo" "$hi"; fi
            if [ -n "$WL_HIT" ] && [ "$FORCE" != 1 ]; then act_out 4 "$(m "$M_A_WL" "$cidr" "$WL_HIT")"; return; fi
            csf_run -d "$cidr" "$(m "$M_A_COMMENT" "$bits" "$AG_BY")"
            deny_has "$cidr" || { act_out 1 "$(m "$M_A_BANFAIL" "$cidr" "${CSF_OUT%%$NL*}")"; return; }
            if [ "$bits" = 24 ]; then          # otomatik yoldaki gibi: kapsanan tekiller silinir (do not delete hariç)
                for ip in ${ips24[$t]}; do
                    is_dnd "${SINGLE_NOTE[$ip]}" || csf_run -dr "$ip"
                done
                cnt_del_prefix "$t"
            fi
            jstr "$WL_HIT"; jw="$REPLY"
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_BANNED" "$cidr")")"
            ev manual_ban "$cidr" "by=\"$AG_BY\"" "wl=$jw" "force=$([ "$FORCE" = 1 ] && echo true || echo false)"
            act_out 0 "$(m "$M_A_BANNED" "$cidr")" ;;
        forget)
            [[ "$t" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || { act_out 2 "$(m "$M_BAD_TARGET" "$t")"; return; }
            grep -qE "^${t//./\\.} " "$SAYAC_FILE" || { act_out 1 "$(m "$M_A_NOREC" "$t.0/24")"; return; }
            cnt_del_prefix "$t"
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_FORGOT" "$t.0/24")")"
            ev manual_forget "$t.0/24" "by=\"$AG_BY\""
            act_out 0 "$(m "$M_A_FORGOT" "$t.0/24")" ;;
        unban)
            { [[ "$t" =~ $CIDR4_RE ]] && cidr_range "$t"; } || { act_out 2 "$(m "$M_BAD_TARGET" "$t")"; return; }
            line=$(deny_line "$t")
            if [ -n "$line" ]; then
                if is_dnd "$line"; then strip_dnd "$t" || { act_out 1 "$(m "$M_A_UNBANFAIL" "$t" "strip")"; return; }; fi
                csf_run -dr "$t"
                deny_has "$t" && { act_out 1 "$(m "$M_A_UNBANFAIL" "$t" "${CSF_OUT%%$NL*}")"; return; }
            elif [ -r "$CSF_VAR/csf.tempban" ] && grep -qF "|$t|" "$CSF_VAR/csf.tempban"; then
                csf_run -tr "$t"
                grep -qF "|$t|" "$CSF_VAR/csf.tempban" && { act_out 1 "$(m "$M_A_UNBANFAIL" "$t" "${CSF_OUT%%$NL*}")"; return; }
            else
                act_out 1 "$(m "$M_A_NOTFOUND" "$t")"; return
            fi
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_UNBANNED" "$t")")"
            ev manual_unban "$t" "by=\"$AG_BY\""
            act_out 0 "$(m "$M_A_UNBANNED" "$t")" ;;
        expire)
            # hedef = arayüzün gördüğü gün sayısı; ayar arada değiştiyse işlem yapılmaz
            [ "$t" = "$BLOCK_EXPIRE_DAYS" ] || { act_out 2 "$(m "$M_BAD_TARGET" "$t")"; return; }
            expire_blocks "$AG_BY"
            if [ "$EXP_N" -gt 0 ]; then act_out 0 "$(m "$M_A_EXPIRED" "$EXP_N")"; else act_out 0 "$M_A_EXPNONE"; fi ;;
        ignore|unignore)
            [[ "$t" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/(16|24)$ ]] && cidr_range "$t" \
                || { act_out 2 "$(m "$M_BAD_TARGET" "$t")"; return; }
            local keep=""
            [ -r "$IGNORE_FILE" ] && keep=$(awk -v c="$t" '$1 != c' "$IGNORE_FILE")
            if [ "$name" = unignore ]; then
                ign_until "$t" || { act_out 1 "$(m "$M_A_NOTIGN" "$t")"; return; }
                printf '%s\n' "$keep" | sed '/^$/d' > "$IGNORE_FILE"
                log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_UNIGNORED" "$t")")"
                ev manual_unignore "$t" "by=\"$AG_BY\""
                act_out 0 "$(m "$M_A_UNIGNORED" "$t")"; return
            fi
            [[ "$days" =~ ^[0-9]{1,3}$ ]] && [ "$days" -ge 1 ] && [ "$days" -le 365 ] || days=30
            local until; until=$(date -d "+$days days" +%Y-%m-%d)
            { printf '%s\n' "$keep" | sed '/^$/d'; echo "$t $until $AG_BY"; } > "$IGNORE_FILE"
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_IGNORED" "$t" "$until")")"
            ev manual_ignore "$t" "by=\"$AG_BY\"" "until=\"$until\""
            act_out 0 "$(m "$M_A_IGNORED" "$t" "$until")" ;;
        *)
            act_out 2 "$(m "$M_A_UNKNOWN" "$name")" ;;
    esac
}

# ── Top attacking networks: gruplar + tekiller ASN'e göre ────────────────────
asn_top() {      # [N] [evidence|blocks] → ASN_TOP satırları: "ASN|KURUM|CC|grup|blok|tekil|cc_deny(0/1)"
    # Sıralama saldırı kanıtına göre: kendi grup banlarımız + tekil banlar (lfd'nin yakaladıkları).
    # csf.deny'deki başka kaynaklı bloklar (elle / başka araç) gösterilir ama sıralamaya girmez.
    local -A G=() B=() T=() NM=() CC=() IS_AG=() DEN=()
    local c i p a
    for c in "${AGG[@]}"; do IS_AG[$c]=1; done
    for c in $(conf_val CC_DENY | LC_ALL=C tr '[:lower:],' '[:upper:] '); do DEN[$c]=1; done
    for c in "${!SINGLE_NOTE[@]}"; do
        p="${c%.*}"; a="${OWN_A[$p]}"; [ -n "$a" ] || continue
        T[$a]=$(( ${T[$a]:-0} + 1 )); NM[$a]="${OWN_N[$p]}"; CC[$a]="${OWN_C[$p]}"
    done
    for i in "${!DC_TXT[@]}"; do
        c="${DC_TXT[i]%/*}"; p="${c%.*}"; a="${OWN_A[$p]}"; [ -n "$a" ] || continue
        if [ -n "${IS_AG[${DC_TXT[i]}]}" ]; then G[$a]=$(( ${G[$a]:-0} + 1 )); else B[$a]=$(( ${B[$a]:-0} + 1 )); fi
        NM[$a]="${OWN_N[$p]}"; CC[$a]="${OWN_C[$p]}"
    done
    ASN_TOP=$(for a in $(printf '%s\n' "${!G[@]}" "${!B[@]}" "${!T[@]}" | sort -u); do
        printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "$a" "${NM[$a]//|/ }" "${CC[$a]}" "${G[$a]:-0}" "${B[$a]:-0}" "${T[$a]:-0}" \
            $(( ${#DEN[AS$a]} > 0 )) $(( ${G[$a]:-0} * 4 + ${T[$a]:-0} ))
    done | if [ "${2:-evidence}" = blocks ]; then awk -F'|' '$5 > 0' | sort -t'|' -k5,5nr; else sort -t'|' -k8,8nr -k5,5nr; fi \
         | cut -d'|' -f1-7 | awk -v n="${1:-10}" 'NR <= n')   # head değil: bkz. SIGPIPE notu
}

# ── Imunify360: sunucunun KENDİ kara listesi (scope local, purpose drop) ────
# Yalnız okunur; bundan CSF banı üretilmez. "cloud" (merkezi) liste kullanılmaz.
# Komut ve alanlar sunucuda doğrulandı (Imunify 8.14, 2026-09-27): eski "blacklist ip list"
# kullanımdan kalkıyor, yerine "ip-list local list --purpose drop".
imunify_refresh() {
    local off=0 total=0 out page n tmp last
    IM_R=none; IM_N=0; IM_AGE=0
    [ "$DRY" = 1 ] && return 0
    if [ -z "$IMUNIFY_BIN" ] || [ ! -x "$IMUNIFY_BIN" ]; then rm -f "$IMUNIFY_FILE" "$IMUNIFY_WL_FILE"; return 0; fi
    # Liste yalnız panelde gösteriliyor, ban kararına girmiyor; imunify360-agent her çağrıda yavaş
    # açıldığı için her turda değil IMUNIFY_REFRESH_MIN dakikada bir alınır.
    last=$(sed -n 's/^#t|//p' "$IMUNIFY_FILE" 2>/dev/null | awk 'NR == 1')
    if [[ "$last" =~ ^[0-9]+$ ]] && [ $(( $(date +%s) - last )) -lt $(( IMUNIFY_REFRESH_MIN * 60 )) ]; then
        IM_R=fresh; IM_AGE=$(( ($(date +%s) - last) / 60 )); return 0
    fi
    IM_R=fail
    # Beyaz liste (ban kararında kullanılır, bkz. load_whitelist): tek sayfa yeter. Hata → eski önbellek kalır.
    out=$(timeout 90 "$IMUNIFY_BIN" ip-list local list --purpose white --by-type ip --limit 1000 --json 2>/dev/null 9>&-) && {
        printf '%s' "$out" | grep -oE '"ip": ?"[^"]*"|"expiration": ?[0-9]+|"comment": ?(null|"[^"]*")' | awk '
            function out() { if (ip != "") print ip "|" ex "|" cm }
            /^"ip"/         { out(); ip = $0; sub(/^"ip": ?"/, "", ip); sub(/"$/, "", ip); ex = 0; cm = ""; next }
            /^"expiration"/ { ex = $0; sub(/^[^0-9]*/, "", ex); next }
            /^"comment"/    { cm = $0; sub(/^"comment": ?/, "", cm); if (cm == "null") cm = ""; gsub(/^"|"$/, "", cm); gsub(/\|/, "/", cm); next }
            END             { out() }' > "$IMUNIFY_WL_FILE.tmp.$$" && mv -f "$IMUNIFY_WL_FILE.tmp.$$" "$IMUNIFY_WL_FILE"
        rm -f "$IMUNIFY_WL_FILE.tmp.$$"
    }
    tmp="$IMUNIFY_FILE.tmp.$$"; : > "$tmp"
    while :; do
        out=$(timeout 90 "$IMUNIFY_BIN" ip-list local list --purpose drop --by-type ip --limit 500 --offset "$off" --json 2>/dev/null 9>&-) \
            || { rm -f "$tmp"; return 0; }       # hata → eski önbellek kalır
        page=$(printf '%s' "$out" | grep -oE '"max_count": ?[0-9]+|"ip": ?"[^"]*"|"comment": ?(null|"[^"]*")' | awk '
            /^"max_count"/ { sub(/^[^0-9]*/, ""); print "#total|" $0; next }
            /^"ip"/        { if (ip != "") print ip "|" r; ip = $0; sub(/^"ip": ?"/, "", ip); sub(/"$/, "", ip); r = "other"; next }
            /^"comment"/   { if (match($0, /[A-Z][A-Z0-9_]{2,}/)) r = substr($0, RSTART, RLENGTH); next }
            END            { if (ip != "") print ip "|" r }')
        [ "$off" -eq 0 ] && total=$(printf '%s\n' "$page" | sed -n 's/^#total|//p' | awk 'NR == 1')
        n=$(printf '%s\n' "$page" | grep -cE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\|')
        printf '%s\n' "$page" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\|' >> "$tmp"
        off=$(( off + 500 ))
        [ "$n" -eq 0 ] || [ "$off" -ge "$(num "$total")" ] || [ "$off" -ge 20000 ] && break
    done
    IM_N=$(grep -c . "$tmp")
    { echo "#t|$(date +%s)"; echo "#total|$(num "$total")"; cat "$tmp"; } > "$tmp.2" && mv -f "$tmp.2" "$IMUNIFY_FILE" && IM_R=ok
    rm -f "$tmp"
}
backfill_imunify() { # Imunify IP'lerinin /24'leri için ayrı sorgu bütçesi
    local p n=0
    BF_N=0
    [ "$LOOK_OK" = 1 ] && [ -r "$IMUNIFY_FILE" ] || return 0
    for p in $(grep -v '^#' "$IMUNIFY_FILE" | cut -d'|' -f1 | sed 's/\.[0-9]*$//' | awk '!seen[$0]++'); do
        [ -n "${OWN_L[$p]+x}" ] && continue
        [ "$n" -ge "$IMUNIFY_BACKFILL" ] && break
        owner_lookup "$p.1"; n=$((n + 1))
        [ "$LOOK_OK" = 1 ] || break
    done
    BF_N=$n
}
imunify_top() {  # [N] → IM_TOP satırları "ASN|KURUM|CC|IP sayısı|SEBEP:n,SEBEP:n,…"; IM_TOTAL, IM_KNOWN, IM_T
    local -A CNT=() NM=() CC=() RC=()
    local ip r p a k line
    IM_TOP=""; IM_TOTAL=0; IM_KNOWN=0; IM_T=0
    [ -r "$IMUNIFY_FILE" ] || return 1
    while IFS='|' read -r ip r; do
        case "$ip" in
            "#total") IM_TOTAL="$(num "$r")"; continue ;;
            "#t")     IM_T="$(num "$r")"; continue ;;
        esac
        p="${ip%.*}"; a="${OWN_A[$p]}"; [ -n "$a" ] || continue
        IM_KNOWN=$((IM_KNOWN + 1))
        CNT[$a]=$(( ${CNT[$a]:-0} + 1 )); NM[$a]="${OWN_N[$p]}"; CC[$a]="${OWN_C[$p]}"
        RC[$a|$r]=$(( ${RC[$a|$r]:-0} + 1 ))
    done < "$IMUNIFY_FILE"
    for a in $(for k in "${!CNT[@]}"; do echo "${CNT[$k]} $k"; done | sort -rn | awk -v n="${1:-10}" 'NR <= n {print $2}'); do
        line=$(for k in "${!RC[@]}"; do [ "${k%%|*}" = "$a" ] && echo "${RC[$k]} ${k#*|}"; done | sort -rn | awk 'NR <= 3 {printf "%s%s:%s", (NR>1?",":""), $2, $1}')
        IM_TOP+="$a|${NM[$a]//|/ }|${CC[$a]}|${CNT[$a]}|$line"$'\n'
    done
    IM_TOP="${IM_TOP%$'\n'}"
    return 0
}
asn_parts() {    # grup blok tekil → "8 grup · 3 tekil · +2 blok başka kaynaklı" (sıfırlar atlanır)
    local out=""
    [ "$1" -gt 0 ] && out+="$(m "$M_DG_PG" "$1")"
    [ "$3" -gt 0 ] && out+="${out:+ · }$(m "$M_DG_PT" "$3")"
    [ "$2" -gt 0 ] && out+="${out:+ · }$(m "$M_DG_PB" "$2")"
    printf '%s' "$out"
}
cron_interval() { # crontab'daki dakika alanı → saniye (bilinmiyorsa 0); [önceden okunmuş alan]
    local c; if [ $# -gt 0 ]; then c="$1"; else c="$(cron_now)"; fi
    case "$c" in
        "*/"*) [[ "${c#*/}" =~ ^[0-9]+$ ]] && echo $(( ${c#*/} * 60 )) || echo 0 ;;
        [0-9]*) echo 3600 ;;
        *) echo 0 ;;
    esac
}
digest_build() { # → DG_SUBJ, DG_BODY
    local now since k a b line cidr owner n=0 t p u left age iv exp=0 runs perm0="-" pc limit tlimit tc
    now=$(date +%s); since=$(( now - 7 * 86400 ))
    local -A C=()
    if [ -r "$EVENTS_FILE" ]; then
        while IFS='|' read -r k a; do C[$k]="$a"; done < <(awk -v s="$since" '
            match($0, /"t":[0-9]+/) { t = substr($0, RSTART + 4, RLENGTH - 4) + 0 } t < s { next }
            match($0, /"type":"[a-z0-9_]+"/) { ty = substr($0, RSTART + 8, RLENGTH - 9)
                if (ty == "warn16t") ty = "warn16"
                if (ty ~ /^manual_/ || ty == "config") ty = "manual"
                c[ty]++
                if (ty == "run" && p0 == "" && match($0, /"perm_used":[0-9]+/)) p0 = substr($0, RSTART + 12, RLENGTH - 12) }
            END { for (k in c) print k "|" c[k]; print "perm0|" p0 }' "$EVENTS_FILE")
    fi
    [ -n "${C[perm0]}" ] && perm0="${C[perm0]}"
    limit=$(num "$(conf_val DENY_IP_LIMIT)"); tlimit=$(num "$(conf_val DENY_TEMP_IP_LIMIT)")
    pc=$(grep -cE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' "$DENY_FILE")
    tc=$("$CSF_BIN" -t 2>/dev/null 9>&- | grep -c "^DENY")
    DG_SUBJ=$(m "$M_DG_SUBJ" "$(hostname 2>/dev/null || echo "$HOSTNAME")")
    DG_BODY="$(m "$M_DG_HEAD" "$(date -d "@$since" '+%d.%m')" "$(date -d "@$now" '+%d.%m')")$NL$NL"
    # yeni sürüm var mı (GitHub; en çok 30 sn, ulaşılamazsa satır eklenmez)
    local br rv to=""
    command -v timeout >/dev/null 2>&1 && to="timeout 30"
    if command -v git >/dev/null 2>&1 && [ -d "$SELF_DIR/.git" ]; then
        br=$(git -C "$SELF_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
        if [ -n "$br" ] && [ "$br" != HEAD ] && GIT_TERMINAL_PROMPT=0 $to git -C "$SELF_DIR" fetch --quiet origin "$br" >/dev/null 2>&1 9>&-; then
            rv=$(git -C "$SELF_DIR" show "origin/$br:csf_autogroup.sh" 2>/dev/null | sed -n 's/^VERSION="\([^"]*\)".*/\1/p' | awk 'NR == 1')
            if [ -n "$rv" ] && [ "$rv" != "$VERSION" ] && [ "$(git -C "$SELF_DIR" rev-parse @ 2>/dev/null)" != "$(git -C "$SELF_DIR" rev-parse "origin/$br" 2>/dev/null)" ]; then
                DG_BODY+="$(m "$M_DG_UPD" "$VERSION" "$rv")$NL$NL"
            fi
        fi
    fi
    DG_BODY+="$(m "$M_DG_COUNTS" "${C[add24]:-0}" "${C[temp24]:-0}" "${C[promote]:-0}" "${C[warn16]:-0}" "${C[skip_wl]:-0}" "${C[manual]:-0}")$NL"
    DG_BODY+="$(m "$M_DG_USAGE" "$pc" "$limit" "$([ "$limit" -gt 0 ] && echo $(( pc * 100 / limit )) || echo 0)" "$perm0")$NL"
    DG_BODY+="$(m "$M_DG_TUSAGE" "$tc" "$tlimit")$NL$NL"
    # yeni grup banları (7 gün): add24 / promote / manual_ban
    DG_BODY+="$M_DG_NEW$NL"
    if [ -r "$EVENTS_FILE" ]; then
        while IFS='|' read -r cidr owner; do
            DG_BODY+="   $(printf '%-18s' "$cidr") ${owner:--}$NL"; n=$((n + 1))
        done < <(awk -v s="$since" '
            match($0, /"t":[0-9]+/) { t = substr($0, RSTART + 4, RLENGTH - 4) + 0 } t < s { next }
            /"type":"(add24|promote|manual_ban)"/ {
                c = ""; o = ""
                if (match($0, /"cidr":"[0-9.\/]+"/)) c = substr($0, RSTART + 8, RLENGTH - 9)
                if (match($0, /"owner":"[^"]*"/)) o = substr($0, RSTART + 9, RLENGTH - 10)
                print c "|" o }' "$EVENTS_FILE" | tail -n 25)
    fi
    [ "$n" -eq 0 ] && DG_BODY+="$M_DG_NONE$NL"
    # en çok saldıran ağlar
    DG_BODY+="$NL$M_DG_TOP$NL"
    asn_top 5
    if [ -n "$ASN_TOP" ]; then
        while IFS='|' read -r a owner k b bl line den; do
            DG_BODY+="$(m "$M_DG_TOPL" "AS$a" "${owner:0:44}" "$(asn_parts "$b" "$bl" "$line")")$NL"   # kurum adı ülkeyle bitiyor
        done <<< "$ASN_TOP"
    else DG_BODY+="$M_DG_NONE$NL"; fi
    # Imunify360: sunucunun kendi kara listesi
    if imunify_top 5 && [ -n "$IM_TOP" ]; then
        DG_BODY+="$NL$(m "$M_DG_IM" "$IM_TOTAL")$NL"
        while IFS='|' read -r a owner k b line; do
            line="${line//:/ }"; line="${line//,/, }"          # "CAPTCHA_DOS_ALERT 900, WAF 12"
            DG_BODY+="$(m "$M_DG_IML" "AS$a" "${owner:0:44}" "$b" "${line:+ ($line)}")$NL"
        done <<< "$IM_TOP"
    fi
    # süresi dolacak terfi kayıtları
    DG_BODY+="$NL$M_DG_EXP$NL"
    while read -r p u; do
        [[ "$p" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ && "$u" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
        age=$(( (now - $(date -d "$u" +%s)) / 86400 )); left=$(( SAYAC_RETENTION_DAYS - age ))
        [ "$left" -le 14 ] || continue
        DG_BODY+="$(m "$M_DG_EXPL" "$p.0/24" "$left")$NL"; exp=$((exp + 1))
    done < "$SAYAC_FILE"
    [ "$exp" -eq 0 ] && DG_BODY+="$M_DG_NONE$NL"
    # Beklenen tur sayısı, olay kaydının başladığı andan itibaren hesaplanır: kayıt yeni başladıysa
    # "7 günde 2 tur (beklenen 336)" gibi yanlış bir alarm vermesin.
    iv=$(cron_interval); runs="${C[run]:-0}"
    local first win
    first=$(grep -m1 '"type":"run"' "$EVENTS_FILE" 2>/dev/null | grep -o '"t":[0-9]*' | cut -d: -f2)
    win=$(( now - since )); [ -n "$first" ] && [ "$first" -gt "$since" ] && win=$(( now - first ))
    DG_BODY+="$NL$(m "$M_DG_RUNS" "$runs" "$([ "$iv" -gt 0 ] && echo $(( win / iv + 1 )) || echo '?')")$NL"
    [ -n "$PANEL_FOOT" ] && DG_BODY+="$NL${PANEL_FOOT%$NL}"
    return 0
}
digest_maybe() { # çalışma sonunda: seçilen gün, 09:00'dan sonra, haftada bir kez
    local wk
    [ "$DIGEST" = 1 ] || return 0
    [ "$(date +%u)" = "$DIGEST_DAY" ] || return 0
    [ "$((10#$(date +%H)))" -ge 9 ] || return 0
    wk="DIGEST_$(date +%G-W%V)"
    grep -q "^$wk " "$SAYAC_FILE" && return 0
    digest_build
    printf '%s\n' "$DG_BODY" | mail -s "$DG_SUBJ" "$ALERT_MAIL"
    cnt_add "$wk $TODAY"
    log "$(m "$M_DG_SENT" "$ALERT_MAIL")"
    ev digest ""
}

# ── --config (WHM eklentisinin Ayarlar sekmesi) ─────────────────────────────
CFG_FILE="$SELF_DIR/config.env"
INSTALL_CONF="$SELF_DIR/.install.conf"
cron_now() { crontab -l 2>/dev/null | grep -F "$SELF_DIR/csf_autogroup.sh" | grep -v '^[[:space:]]*#' | awk 'NR == 1 {print $1}'; }
cfg_value() {    # KEY → etkin değer (config.env + varsayılanlar yüklendikten sonra)
    if [ "$1" = CRON_MIN ]; then cron_now; else printf '%s' "${!1}"; fi
}
cfg_write() {    # "KEY=VALUE" satırları (stdin) → config.env: yorumlar korunur, atomik yazılır, yedek alınır
    local tmp
    tmp=$(mktemp "$SELF_DIR/.config.env.XXXXXX") || return 1
    if [ -f "$CFG_FILE" ]; then
        cp -p "$CFG_FILE" "$CFG_FILE.bak"
        # Liste ortam değişkeniyle geçer: awk -v çok satırlı değerde bazı sürümlerde hata verir.
        CFG_LIST="$1" awk '
            BEGIN { n = split(ENVIRON["CFG_LIST"], a, "\n"); for (i = 1; i <= n; i++) { if (a[i] == "") continue; k = a[i]; sub(/=.*/, "", k); val[k] = a[i]; order[++m] = k } }
            { line = $0; k = line; sub(/=.*/, "", k)
              if (line ~ /^[A-Z_0-9]+=/ && (k in val)) { if (!(k in done)) { print val[k]; done[k] = 1 } ; next }
              print line }
            END { hdr = 0
                  for (i = 1; i <= m; i++) { k = order[i]; if (!(k in done)) { if (!hdr) { print ""; print "# Set from the WHM plugin"; hdr = 1 } print val[k] } } }
        ' "$CFG_FILE" > "$tmp" || { rm -f "$tmp"; return 1; }
    else
        { echo "# CSF Auto-Group config — written by the WHM plugin"; printf '%s' "$1"; } > "$tmp"
    fi
    chmod 600 "$tmp" && mv -f "$tmp" "$CFG_FILE"
}
install_conf_write() {   # .install.conf: update.sh / install.sh --yes buradan okur; panel ayarları ezilmesin
    printf 'MSG_LANG="%s"; ALERT_MAIL="%s"; CRON_MIN="%s"\n' "$1" "$2" "$3" > "$INSTALL_CONF.tmp" && mv -f "$INSTALL_CONF.tmp" "$INSTALL_CONF"
}
cron_write() {   # CRON_MIN → crontab satırı (install.sh ile aynı biçim)
    # Önce mevcut crontab tamamen okunur, sonra yazılır: aynı boru hattında okuyup yazmak diğer
    # işleri silebiliyordu (simülasyonda yakalandı). Okuma "crontab yok" dışında bir sebeple
    # başarısız olursa hiçbir şey yazılmaz — kullanıcının diğer cron işleri riske atılmaz.
    local cur rc other
    command -v crontab >/dev/null 2>&1 || return 1
    cur=$(crontab -l 2>&1); rc=$?
    if [ "$rc" -ne 0 ]; then
        [[ "$cur" == *"no crontab"* ]] || return 1
        cur=""
    fi
    other=$(printf '%s\n' "$cur" | grep -vF "$SELF_DIR/csf_autogroup.sh")
    { [ -n "$other" ] && printf '%s\n' "$other"; echo "$1 * * * * $SELF_DIR/csf_autogroup.sh >/dev/null 2>&1"; } | crontab -
}
do_config() {
    local sub="${ARGS[0]:-get}" k v o i
    case "$sub" in
        get)
            if [ "$JSON" = 1 ]; then
                o="{\"ok\":true,\"values\":{"
                i=0
                for k in $CFG_KEYS; do jstr "$(cfg_value "$k")"; o+="$([ $i -gt 0 ] && echo ,)\"$k\":$REPLY"; i=1; done
                o+="},\"defaults\":{\"MSG_LANG\":\"en\",\"ALERT_MAIL\":\"root@localhost\",\"DIGEST\":\"1\",\"DIGEST_DAY\":\"1\",\"THRESHOLD_24\":\"3\",\"THRESHOLD_24_PERMANENT\":\"5\",\"THRESHOLD_16\":\"5\",\"THRESHOLD_TEMP_24\":\"3\",\"THRESHOLD_TEMP_16\":\"5\",\"LOOKUP\":\"1\",\"LOOKUP_TIMEOUT\":\"2\",\"SAYAC_RETENTION_DAYS\":\"180\",\"REVIEW_DAYS\":\"7\",\"LOG_MAX_LINES\":\"5000\",\"LOG_ROTATE_MB\":\"1\",\"LOG_ROTATE_KEEP\":\"5\",\"BLOCK_EXPIRE_DAYS\":\"365\",\"BLOCK_EXPIRE_AUTO\":\"0\",\"CRON_MIN\":\"*/10\"}"
                o+=",\"csf\":{\"deny_limit\":$(num "$(conf_val DENY_IP_LIMIT)"),\"temp_limit\":$(num "$(conf_val DENY_TEMP_IP_LIMIT)")}"
                local lb=0 la=0 ll=0
                [ -f "$LOG_FILE" ] && { lb=$(wc -c < "$LOG_FILE"); ll=$(wc -l < "$LOG_FILE"); }
                la=$(ls -1 "$LOG_FILE".[0-9]* 2>/dev/null | grep -c .)
                o+=",\"log\":{\"rotate\":$([ -f "$LOGROTATE_CONF" ] && echo true || echo false),\"bytes\":$(num "$lb"),\"lines\":$(num "$ll"),\"archives\":$(num "$la")}"
                # Sunucu gereksinimleri (Ayarlar sekmesindeki kart): ok | missing | warn
                local dp="" dk ds
                for dk in csf crontab mail dns logrotate flock timeout git imunify; do
                    ds=missing
                    case "$dk" in
                        csf)       { [ -x "$CSF_BIN" ] || command -v csf >/dev/null 2>&1; } && ds=ok ;;
                        dns)       [ -n "$DIG_BIN$HOST_BIN" ] && ds=ok ;;
                        imunify)   [ -n "$IMUNIFY_BIN" ] && [ -x "$IMUNIFY_BIN" ] && ds=ok ;;
                        logrotate) if command -v logrotate >/dev/null 2>&1 && [ -d "$(dirname "$LOGROTATE_CONF")" ]; then
                                       ds=ok; [ -f "$LOGROTATE_CONF" ] || ds=warn      # kurulu ama bizim dosyamız yok
                                   fi ;;
                        *)         command -v "$dk" >/dev/null 2>&1 && ds=ok ;;
                    esac
                    dp+="${dp:+,}{\"k\":\"$dk\",\"s\":\"$ds\"}"
                done
                o+=",\"deps\":[$dp]"
                o+=",\"dns_tool\":$([ -n "$DIG_BIN$HOST_BIN" ] && echo true || echo false),\"crontab\":$(command -v crontab >/dev/null 2>&1 && echo true || echo false)}"
                echo "$o"
            else
                for k in $CFG_KEYS; do printf '%-24s %s\n' "$k" "$(cfg_value "$k")"; done
            fi
            return 0 ;;
        set)
            take_lock || { act_out 3 "$M_BUSY"; return 3; }
            local -A NEW=()
            for kv in "${ARGS[@]:1}"; do
                k="${kv%%=*}"; v="${kv#*=}"
                cfg_check "$k" "$v" || { act_out 2 "$CFG_ERR"; return 2; }
                NEW[$k]="$CFG_VAL"
            done
            cfg_rules "${NEW[THRESHOLD_24]:-$THRESHOLD_24}" "${NEW[THRESHOLD_24_PERMANENT]:-$THRESHOLD_24_PERMANENT}" \
                || { act_out 2 "$CFG_ERR"; return 2; }
            local lines="" changes="" n=0 old cron_new="" logs=() msg
            for k in $CFG_KEYS; do
                [ -n "${NEW[$k]+x}" ] || continue
                old="$(cfg_value "$k")"
                [ "$old" = "${NEW[$k]}" ] && continue
                n=$((n + 1))
                if [ "$k" = CRON_MIN ]; then cron_new="${NEW[$k]}"; else lines+="$k=${NEW[$k]}"$'\n'; fi
                jstr "$old"; o="$REPLY"; jstr "${NEW[$k]}"
                changes+="${changes:+,}{\"key\":\"$k\",\"from\":$o,\"to\":$REPLY}"
                logs+=("$(m "$M_CFG_LOG" "$AG_BY" "$k" "${old:--}" "${NEW[$k]}")")
            done
            [ "$n" -eq 0 ] && { act_out 0 "$M_CFG_NOCHANGE"; return 0; }
            # Sıra: önce cron (dışarıya bağımlı adım), sonra config.env. Cron başarısız olursa hiçbir şey
            # değişmemiş olur; kayıtlar da yalnızca her şey yazıldıktan sonra düşülür.
            if [ -n "$cron_new" ]; then cron_write "$cron_new" || { act_out 1 "$M_CFG_CRONFAIL"; return 1; }; fi
            if [ -n "$lines" ]; then cfg_write "$lines" || { act_out 1 "$M_CFG_WFAIL"; return 1; }; fi
            install_conf_write "${NEW[MSG_LANG]:-$MSG_LANG}" "${NEW[ALERT_MAIL]:-$ALERT_MAIL}" "${cron_new:-$(cron_now)}"
            if [[ "$lines" == *LOG_ROTATE_* ]]; then
                logrotate_write "${NEW[LOG_ROTATE_MB]:-$LOG_ROTATE_MB}" "${NEW[LOG_ROTATE_KEEP]:-$LOG_ROTATE_KEEP}" || logs+=("$M_CFG_ROTFAIL")
            fi
            for msg in "${logs[@]}"; do log "$msg"; done
            ev config "" "by=\"$AG_BY\"" "changes=[$changes]"
            act_out 0 "$(m "$M_CFG_SAVED" "$n")" ;;
        test-mail)
            local out rc
            # Panel bağlantısı test mailinde de var: gerçek bir uyarı beklemeden bağlantı denenebilsin.
            panel_init; local plink="$PANEL_FOOT"
            out=$( { m "$M_TM_BODY" "$(hostname 2>/dev/null || echo "$HOSTNAME")" "$AG_BY"; printf '\n\n%s' "$plink"; } | command mail -s "$M_TM_SUBJ" "$ALERT_MAIL" 2>&1 9>&-); rc=$?
            if [ "$rc" -eq 0 ]; then
                log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_TM_SENT" "$ALERT_MAIL")")"
                jstr "$ALERT_MAIL"; ev test_mail "" "by=\"$AG_BY\"" "to=$REPLY"
                act_out 0 "$(m "$M_TM_SENT" "$ALERT_MAIL")"
            else
                act_out 1 "$(m "$M_TM_FAIL" "${out%%$NL*}")"
            fi ;;
        *) act_out 2 "$(m "$M_A_UNKNOWN" "$sub")" ;;
    esac
}

[ -f "$DENY_FILE" ] || { log "$(m "$M_ERR_NOFILE" "$DENY_FILE")"; exit 1; }
[ -f "$CSF_CONF" ]  || { log "$(m "$M_ERR_NOFILE" "$CSF_CONF")"; exit 1; }
mkdir -p "$(dirname "$SAYAC_FILE")"; touch "$SAYAC_FILE"

case "$MODE" in
    status) LOG_MODE=quiet; do_status; exit $? ;;
    lookup) LOG_MODE=quiet; do_lookup "${ARGS[0]}"; exit $? ;;
    action) LOG_MODE=file; do_action "$ACT" "${ARGS[0]}" "${ARGS[1]}"; exit $? ;;
    config) LOG_MODE=file; do_config; exit $? ;;
    busy)   if lock_busy; then echo busy; else echo idle; fi; exit 0 ;;
    history) LOG_MODE=quiet; do_history "${ARGS[0]}" "${ARGS[1]}" "${ARGS[2]:-2}"; exit $? ;;
    logrotate) logrotate_write && { echo "$LOGROTATE_CONF"; exit 0; }; exit 1 ;;   # install.sh çağırır   # eklenti "Şimdi çalıştır"dan önce sorar
    digest) LOG_MODE=file; owners_load; parse_deny "$DENY_FILE" 1; panel_init; digest_build
            if [ "$SEND" = 1 ]; then printf '%s\n' "$DG_BODY" | mail -s "$DG_SUBJ" "$ALERT_MAIL"; log "$(m "$M_DG_SENT" "$ALERT_MAIL")"; ev digest "" "by=\"$AG_BY\""
            else printf '%s\n\n%s\n' "$DG_SUBJ" "$DG_BODY"; fi
            exit 0 ;;
esac

# Tek seferde tek çalışma: cron turu uzarsa ikinci kopya aynı bloğu tekrar eklemesin.
take_lock || { log "$M_LOCKED"; exit 0; }
[ "$DRY" = 1 ] && log "$M_DRY_ON"
[ ${#SETS[@]} -gt 0 ] && log "$(m "$M_DRY_OVR" "${SETS[*]}")"
RUN_T0=$(date +%s)
panel_init
owners_load
RUN_MODE=1
logr "$M_START (v$VERSION)"

# ── Permanent deny limit ────────────────────────────────────────────────────
limit=$(grep "^DENY_IP_LIMIT" "$CSF_CONF" | cut -d'=' -f2 | tr -d ' "')
current_count=$(grep -cP '^\d+\.\d+\.\d+\.\d+|^\d+\.\d+\.\d+\.\d+\/\d+' "$DENY_FILE" || true)
if [ -n "$limit" ] && [ "$limit" -gt 0 ] 2>/dev/null; then
    percent=$((current_count * 100 / limit))
    logr "$(m "$M_PERM_USAGE" "$current_count" "$limit" "$percent")"
    if [ "$percent" -ge 80 ]; then
        log "$(m "$M_PERM_WARN")"
        doluluk_satiri=$(m "$M_PERM_FULL" "$current_count" "$limit" "$percent")
        if ! grep -qF "LIMIT_PERM $TODAY" "$SAYAC_FILE"; then      # günde bir kez (her turda değil)
            MAIL_URGENT=1; mail_add "$(m "$M_MAIL_PERMFULL_SUBJ" "$percent")" "$(m "$M_MAIL_PERMFULL_BODY")"; cnt_add "LIMIT_PERM $TODAY"
        fi
    else
        doluluk_satiri=$(m "$M_PERM_USAGE" "$current_count" "$limit" "$percent")
    fi
else
    log "$(m "$M_NOLIMIT" "DENY_IP_LIMIT")"; doluluk_satiri=""
fi

# ── Temp deny limit ─────────────────────────────────────────────────────────
temp_limit=$(grep "^DENY_TEMP_IP_LIMIT" "$CSF_CONF" | cut -d'=' -f2 | tr -d ' "')
temp_current=$("$CSF_BIN" -t 2>/dev/null 9>&- | grep -c "^DENY" || true)
if [ -n "$temp_limit" ] && [ "$temp_limit" -gt 0 ] 2>/dev/null; then
    temp_percent=$((temp_current * 100 / temp_limit))
    logr "$(m "$M_TEMP_USAGE" "$temp_current" "$temp_limit" "$temp_percent")"
    if [ "$temp_percent" -ge 80 ]; then
        log "$(m "$M_TEMP_WARN")"
        temp_doluluk_satiri=$(m "$M_TEMP_FULL" "$temp_current" "$temp_limit" "$temp_percent")
        if ! grep -qF "LIMIT_TEMP $TODAY" "$SAYAC_FILE"; then
            MAIL_URGENT=1; mail_add "$(m "$M_MAIL_TEMPFULL_SUBJ" "$temp_percent")" "$(m "$M_MAIL_TEMPFULL_BODY")"; cnt_add "LIMIT_TEMP $TODAY"
        fi
    else
        temp_doluluk_satiri=$(m "$M_TEMP_USAGE" "$temp_current" "$temp_limit" "$temp_percent")
    fi
else
    log "$(m "$M_NOLIMIT" "DENY_TEMP_IP_LIMIT")"; temp_doluluk_satiri=""
fi

# ── Read csf.deny: singles (grouping) + CIDRs (coverage) ────────────────────
parse_deny "$DENY_FILE" 1

# ── /24 grouping (permanent): auto-ban + drop singles ───────────────────────
added24=0; added24_body=""
for prefix in $(printf '%s\n' "${!count24[@]}" | sort -V); do
    n="${count24[$prefix]}"
    [ "$n" -ge "$THRESHOLD_24" ] || continue
    ip2int "$prefix.0"; lo=$REPLY
    perm_covers "$lo" $((lo + 255)) && continue
    if wl_check "$prefix" "${ips24[$prefix]}"; then
        wl_skip "${prefix}.0/24" "$n" "$prefix" "${ips24[$prefix]}" perm; continue
    fi
    if [ "$n" -ge "$THRESHOLD_24_PERMANENT" ]; then
        comment=$(m "$M_C24_DND" "$n")
    else
        comment=$(m "$M_C24_PERM" "$n")
    fi
    csf_run -d "${prefix}.0/24" "$comment"
    # csf -d başarısızken de 0 döner → dosyada gerçekten var mı diye bak.
    # Yoksa tekillere dokunma, yoksa saldırganlar açıkta kalır.
    if ! perm_added "${prefix}.0/24"; then log "$(m "$M_ADD24_FAIL" "$prefix")"; continue; fi
    DC_LO+=("$lo"); DC_HI+=($((lo + 255)))
    if [ "$n" -ge "$THRESHOLD_24_PERMANENT" ]; then
        log "$(m "$M_OK24_DND" "$prefix" "$n")"
        added24_body+="$(m "$M_B24_DND" "$prefix" "$n")$NL"
    else
        log "$(m "$M_OK24" "$prefix" "$n")"
        added24_body+="$(m "$M_B24" "$prefix" "$n")$NL"
    fi
    added24=$((added24 + 1))
    owner_line "${ips24[$prefix]# }"; added24_body+="$REPLY"; owner_kv
    addj=""
    for ip in $(printf '%s\n' ${ips24[$prefix]} | sort -V); do
        tag=""; res=removed
        if [[ "${SINGLE_NOTE[$ip]}" =~ [Dd][Oo][[:space:]]+[Nn][Oo][Tt][[:space:]]+[Dd][Ee][Ll][Ee][Tt][Ee] ]]; then
            # csf -dr "do not delete" satırlarını silmez; /24 zaten kapsıyor, olduğu gibi kalsın.
            log "$(m "$M_KEPT_DND" "$ip")"; tag="  [$M_TAG_KEPT]"; res=kept
        else
            csf_run -dr "$ip"
            if still_denied "$ip"; then log "$(m "$M_DELSINGLE_FAIL" "$ip")"; tag="  [$M_TAG_FAIL]"; res=fail
            else log "$(m "$M_DELSINGLE" "$ip")"; fi
        fi
        ip_line "$ip" "${SINGLE_NOTE[$ip]}" 0; added24_body+="$REPLY$tag$NL"
        addj+="${addj:+,}${IPJ%\}},\"res\":\"$res\"}"
    done
    ev add24 "${prefix}.0/24" "n=$n" "dnd=$([ "$n" -ge "$THRESHOLD_24_PERMANENT" ] && echo true || echo false)" "${OKV[@]}" "ips=[$addj]"
done
if [ "$added24" -gt 0 ]; then
    mail_add "$(m "$M_MAIL24_SUBJ" "$added24")" "$(m "$M_MAIL24_BODY")$NL$NL$added24_body"
fi
logr "$(m "$M_24_DONE" "$added24")"

# ── /16 grouping (permanent): warn only, once per day ───────────────────────
declare -A count16 seen_subnets ips16
for ip in "${!SINGLE_NOTE[@]}"; do
    prefix24="${ip%.*}"; prefix16="${prefix24%.*}"
    [ "${count24[$prefix24]:-0}" -ge "$THRESHOLD_24" ] && continue
    count16[$prefix16]=$((${count16[$prefix16]:-0} + 1)); seen_subnets[$prefix16]+=" $prefix24"; ips16[$prefix16]+=" $ip"
done

warn16=0; warn_body=""
for prefix in $(printf '%s\n' "${!count16[@]}" | sort -V); do
    subnet_count=$(echo "${seen_subnets[$prefix]}" | tr ' ' '\n' | sort -u | grep -c '\.')
    if [ "${count16[$prefix]}" -ge "$THRESHOLD_16" ] && [ "$subnet_count" -ge 2 ]; then
        ip2int "$prefix.0.0"; lo=$REPLY
        if ign_until "$prefix.0.0/16"; then logr "$(m "$M_IGN16" "$prefix" "$IGN_UNTIL")"; continue; fi
        if ! perm_covers "$lo" $((lo + 65535)); then
            if grep -qF "WARN16_${prefix} $TODAY" "$SAYAC_FILE"; then
                logr "$(m "$M_SKIP16" "$prefix")"; continue
            fi
            log "$(m "$M_WARN16" "$prefix" "${count16[$prefix]}" "$subnet_count")"
            warn_body+="$(m "$M_WARN16_B" "$prefix" "${count16[$prefix]}" "$subnet_count")$NL"
            WL_HIT=""; wl_overlap "$lo" $((lo + 65535)) && warn_body+="$(m "$M_WL_NOTE" "$WL_HIT")$NL"
            ip_lines "${ips16[$prefix]}" perm 1; warn_body+="$REPLY"
            warn16=$((warn16 + 1)); cnt_add "WARN16_${prefix} $TODAY"
            jstr "$WL_HIT"
            ev warn16 "$prefix.0.0/16" "n=${count16[$prefix]}" "subnets=$subnet_count" "wl=$REPLY" "total=$IPS_TOTAL" "ips=$IPS_J"
        fi
    fi
done
if [ "$warn16" -gt 0 ]; then
    mail_add "$(m "$M_MAIL16_SUBJ" "$warn16")" "$(printf '%b' "$(m "$M_MAIL16_BODY")")$NL$NL$warn_body"
fi
logr "$(m "$M_16_DONE" "$warn16")"

# ── Read temp bans + clear singles already covered permanently ──────────────
# csf -t çok portlu bir bani her port için ayrı satır basar → IP'ler tekilleştirilir.
# IPv6 satırları (ör. "2001:db8::1") IPv4 sayılmasın diye adres tam eşleşmeli.
declare -A temp_count24 temp_ips24 TSEEN TNOTE
TC_LO=(); TC_HI=(); temp_order=(); temp_alive=()
TEMP_LIST=$("$CSF_BIN" -t 2>/dev/null 9>&-)
while read -r kind addr _; do
    [ "$kind" = "DENY" ] || continue
    if [[ "$addr" =~ $IPV4_RE ]]; then
        [ -z "${TSEEN[$addr]+x}" ] && { TSEEN[$addr]=1; temp_order+=("$addr"); }
    elif [[ "$addr" =~ $CIDR4_RE ]]; then
        cidr_range "$addr" && { TC_LO+=("$R_LO"); TC_HI+=("$R_HI"); }
    fi
done <<< "$TEMP_LIST"
if [ -r "$CSF_VAR/csf.tempban" ]; then   # zaman|ip|port|yön|süre|yorum
    while IFS='|' read -r _ tip _ _ _ tnote; do
        [ -n "$tip" ] && [ -z "${TNOTE[$tip]+x}" ] && TNOTE[$tip]="$tnote"
    done < "$CSF_VAR/csf.tempban"
fi
for ip in "${temp_order[@]}"; do
    ip2int "$ip"; n=$REPLY
    if [ -n "${DENY_IP[$ip]+x}" ] || perm_covers "$n" "$n"; then
        csf_run -tr "$ip"; log "$(m "$M_TCLEAN" "$ip")"
        ev clean_temp "$ip"; continue
    fi
    temp_covers "$n" "$n" && continue
    prefix24="${ip%.*}"
    temp_count24[$prefix24]=$((${temp_count24[$prefix24]:-0} + 1)); temp_ips24[$prefix24]+=" $ip"
    temp_alive+=("$ip")
done

# ── Temp /24 grouping ───────────────────────────────────────────────────────
temp_added24=0; temp_added24_body=""; temp_perm_added24=0; temp_perm_added24_body=""
for prefix in $(printf '%s\n' "${!temp_count24[@]}" | sort -V); do
    n="${temp_count24[$prefix]}"
    if [ "$n" -ge "$THRESHOLD_TEMP_24" ]; then
        ip2int "$prefix.0"; lo=$REPLY
        if perm_covers "$lo" $((lo + 255)); then logr "$(m "$M_TSKIP24" "$prefix")"; continue; fi
        if wl_check "$prefix" "${temp_ips24[$prefix]}"; then
            wl_skip "${prefix}.0/24" "$n" "$prefix" "${temp_ips24[$prefix]}" temp; continue
        fi
        if grep -qE "^${prefix//./\\.} " "$SAYAC_FILE"; then
            csf_run -d "${prefix}.0/24" "$(m "$M_TC24_PERM" "$n")"
            if perm_added "${prefix}.0/24"; then
                DC_LO+=("$lo"); DC_HI+=($((lo + 255)))
                log "$(m "$M_TOK24_PERM" "$prefix" "$n")"
                temp_perm_added24=$((temp_perm_added24 + 1))
                temp_perm_added24_body+="$(m "$M_TB24_PERM" "$prefix" "$n")$NL"
                owner_line "${temp_ips24[$prefix]# }"; temp_perm_added24_body+="$REPLY"; owner_kv
                ip_lines "${temp_ips24[$prefix]}" temp 0; temp_perm_added24_body+="$REPLY"
                cnt_del_prefix "$prefix"
                ev promote "${prefix}.0/24" "n=$n" "dnd=true" "${OKV[@]}" "ips=$IPS_J"
            else
                log "$(m "$M_TADD24_FAIL" "$prefix")"
            fi
        else
            csf_run -td "${prefix}.0/24" 43200 "$(m "$M_TC24" "$n")"
            if temp_added "${prefix}.0/24"; then
                TC_LO+=("$lo"); TC_HI+=($((lo + 255)))
                log "$(m "$M_TOK24" "$prefix" "$n")"
                temp_added24=$((temp_added24 + 1))
                temp_added24_body+="$(m "$M_TB24" "$prefix" "$n")$NL"
                owner_line "${temp_ips24[$prefix]# }"; temp_added24_body+="$REPLY"; owner_kv
                ip_lines "${temp_ips24[$prefix]}" temp 0; temp_added24_body+="$REPLY"
                cnt_add "$prefix $(date '+%Y-%m-%d')"
                ev temp24 "${prefix}.0/24" "n=$n" "ttl=43200" "${OKV[@]}" "ips=$IPS_J"
            else
                log "$(m "$M_TADD24T_FAIL" "$prefix")"
            fi
        fi
    fi
done
if [ "$temp_added24" -gt 0 ]; then
    mail_add "$(m "$M_MAILT24_SUBJ" "$temp_added24")" "$(m "$M_MAILT24_BODY")$NL$NL$temp_added24_body"
fi
if [ "$temp_perm_added24" -gt 0 ]; then
    mail_add "$(m "$M_MAILT24P_SUBJ" "$temp_perm_added24")" "$(m "$M_MAILT24P_BODY")$NL$NL$temp_perm_added24_body"
fi
logr "$(m "$M_T24_DONE" "$temp_added24" "$temp_perm_added24")"

# ── Temp /16: warn only, once per day ───────────────────────────────────────
declare -A temp_count16 temp_seen_subnets temp_ips16
for ip in "${temp_alive[@]}"; do
    prefix24="${ip%.*}"; prefix16="${prefix24%.*}"
    [ "${temp_count24[$prefix24]:-0}" -ge "$THRESHOLD_TEMP_24" ] && continue
    temp_count16[$prefix16]=$((${temp_count16[$prefix16]:-0} + 1)); temp_seen_subnets[$prefix16]+=" $prefix24"; temp_ips16[$prefix16]+=" $ip"
done

temp_warn16=0; temp_warn_body=""
for prefix in $(printf '%s\n' "${!temp_count16[@]}" | sort -V); do
    subnet_count=$(echo "${temp_seen_subnets[$prefix]}" | tr ' ' '\n' | sort -u | grep -c '\.')
    if [ "${temp_count16[$prefix]}" -ge "$THRESHOLD_TEMP_16" ] && [ "$subnet_count" -ge 2 ]; then
        ip2int "$prefix.0.0"; lo=$REPLY
        if perm_covers "$lo" $((lo + 65535)); then logr "$(m "$M_TSKIP16" "$prefix")"; continue; fi
        if ign_until "$prefix.0.0/16"; then logr "$(m "$M_IGN16" "$prefix" "$IGN_UNTIL")"; continue; fi
        if grep -qF "WARN_TEMP16_${prefix} $TODAY" "$SAYAC_FILE"; then logr "$(m "$M_TSKIP16D" "$prefix")"; continue; fi
        log "$(m "$M_TWARN16" "$prefix" "${temp_count16[$prefix]}" "$subnet_count")"
        temp_warn_body+="$(m "$M_WARN16_B" "$prefix" "${temp_count16[$prefix]}" "$subnet_count")$NL"
        WL_HIT=""; wl_overlap "$lo" $((lo + 65535)) && temp_warn_body+="$(m "$M_WL_NOTE" "$WL_HIT")$NL"
        ip_lines "${temp_ips16[$prefix]}" temp 1; temp_warn_body+="$REPLY"
        temp_warn16=$((temp_warn16 + 1)); cnt_add "WARN_TEMP16_${prefix} $TODAY"
        jstr "$WL_HIT"
        ev warn16t "$prefix.0.0/16" "n=${temp_count16[$prefix]}" "subnets=$subnet_count" "wl=$REPLY" "total=$IPS_TOTAL" "ips=$IPS_J"
    fi
done
if [ "$temp_warn16" -gt 0 ]; then
    mail_add "$(m "$M_MAILT16_SUBJ" "$temp_warn16")" "$(printf '%b' "$(m "$M_MAILT16_BODY")")$NL$NL$temp_warn_body"
fi
logr "$(m "$M_T16_DONE" "$temp_warn16")"

# ── Whitelist skips: one email per run (each block once per day) ────────────
if [ "$wl_skipped" -gt 0 ]; then
    mail_add "$(m "$M_MAILWL_SUBJ" "$wl_skipped")" "$(printf '%b' "$(m "$M_MAILWL_BODY")")$NL$NL$wl_skip_body"
fi

# ── Eski blok banları (Ayarlar → Saklama; varsayılan kapalı) ────────────────
if [ "$BLOCK_EXPIRE_AUTO" = 1 ]; then
    expire_blocks cron
    [ "$EXP_N" -gt 0 ] && mail_add "$(m "$M_EXP_SUBJ" "$EXP_N")" "$(m "$M_EXP_BODY" "$BLOCK_EXPIRE_DAYS")$NL$NL$EXP_BODY"
fi

# ── Güvenlik duvarı sağlığı: sorun varsa günde bir kez bildirilir ───────────
health_check
h_msgs=()
[ "$H_LFD" = down ] && h_msgs+=("$M_H_LFD")
case "$H_CSF" in off) h_msgs+=("$M_H_CSF_OFF") ;; testing) h_msgs+=("$M_H_CSF_TEST") ;; norules) h_msgs+=("$M_H_CSF_RULES") ;; esac
if [ ${#h_msgs[@]} -gt 0 ]; then
    if ! grep -qF "HEALTH $TODAY" "$SAYAC_FILE"; then
        for hm in "${h_msgs[@]}"; do log "$(m "$M_H_LOG" "$hm")"; done          # günlüğe de günde bir kez
        MAIL_URGENT=1
        h_body="$M_H_BODY$NL"; for hm in "${h_msgs[@]}"; do h_body+="  - $hm$NL"; done
        h_subj=""; for hm in "${h_msgs[@]}"; do h_subj+="${h_subj:+, }$hm"; done
        mail_add "$h_subj" "$h_body"; cnt_add "HEALTH $TODAY"
    fi
fi

# ── Bu turun bildirimleri: tek mail ─────────────────────────────────────────
mail_flush

# ── Counter retention + log rotation ────────────────────────────────────────
if [ "$DRY" != 1 ] && [ -f "$SAYAC_FILE" ]; then
    cutoff=$(date -d "$SAYAC_RETENTION_DAYS days ago" '+%Y-%m-%d')
    awk -v d="$cutoff" '$2 >= d' "$SAYAC_FILE" > "${SAYAC_FILE}.tmp" && mv "${SAYAC_FILE}.tmp" "$SAYAC_FILE"
    logr "$(m "$M_CLEANCNT" "$SAYAC_RETENTION_DAYS")"
fi
# Günlüğü sistemin logrotate'i döndürüyorsa (1 MB, 5 sıkıştırılmış arşiv) burada kesilmez; logrotate
# yoksa eski yöntem: son LOG_MAX_LINES satır tutulur.
if [ "$DRY" != 1 ] && [ -f "$LOG_FILE" ] && [ ! -f "$LOGROTATE_CONF" ]; then
    line_count=$(wc -l < "$LOG_FILE")
    if [ "$line_count" -gt "$LOG_MAX_LINES" ]; then
        tail -"$LOG_MAX_LINES" "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
        logr "$(m "$M_LOGTRIM" "$LOG_MAX_LINES" "$line_count")"
    fi
fi
# Olay kaydı: tur kayıtları (her turda bir) ve gerçek işler ayrı sınırlanır — yoksa sessiz turlar
# banları ve uyarıları birkaç ayda kayıttan iterdi.
if [ "$DRY" != 1 ] && [ -f "$EVENTS_FILE" ]; then
    read -r ev_r ev_o < <(awk '/"type":"run"/ { r++; next } { o++ } END { print r + 0, o + 0 }' "$EVENTS_FILE")
    if [ "$ev_r" -gt $(( RUNS_MAX + 100 )) ] || [ "$ev_o" -gt "$EVENTS_MAX" ]; then
        awk -v r="$ev_r" -v o="$ev_o" -v kr="$RUNS_MAX" -v ko="$EVENTS_MAX" '
            /"type":"run"/ { if (++ri > r - kr) print; next }
            { if (++oi > o - ko) print }' "$EVENTS_FILE" > "${EVENTS_FILE}.tmp" && mv "${EVENTS_FILE}.tmp" "$EVENTS_FILE"
    fi
fi
digest_maybe

# Ban işleri bitti: ana kilit bırakılır. Aşağıdaki sahip ve Imunify sorguları ban kararlarına girmez
# ve dakikalar sürebilir; o sırada paneldeki işlemler "meşgul" demesin, sıradaki cron turu atlanmasın.
# Aynı anda iki zenginleştirme çalışmasın diye ayrı bir kilit (fd 8) kullanılır; tutuluyorsa atlanır.
if command -v flock >/dev/null 2>&1; then flock -u 9 2>/dev/null; exec 9>&-; fi
ENRICH=1
if command -v flock >/dev/null 2>&1; then exec 8>"$LOCK_FILE.enrich"; flock -n 8 || ENRICH=0; fi
if [ "$ENRICH" = 1 ]; then
# Adım süreleri günlüğe: tur uzun sürdüğünde nerede geçtiği görünsün
st=$(date +%s); backfill_owners
[ "$BF_N" -gt 0 ] && logr "$(m "$M_STEP_OWN" "$BF_N" "$(( $(date +%s) - st ))")"
st=$(date +%s); imunify_refresh
case "$IM_R" in
    ok)    logr "$(m "$M_STEP_IM" "$IM_N" "$(( $(date +%s) - st ))")" ;;
    fresh) logr "$(m "$M_STEP_IMFRESH" "$IM_AGE" "$IMUNIFY_REFRESH_MIN")" ;;
    fail)  log "$(m "$M_STEP_IMFAIL" "$(( $(date +%s) - st ))")" ;;
esac
st=$(date +%s); backfill_imunify
[ "$BF_N" -gt 0 ] && logr "$(m "$M_STEP_IMOWN" "$BF_N" "$(( $(date +%s) - st ))")"
owners_save
fi
ev run "" "v=\"$VERSION\"" "dur=$(( $(date +%s) - RUN_T0 ))" "added=$added24" "warn16=$warn16" \
    "temp_added=$temp_added24" "promoted=$temp_perm_added24" "temp_warn16=$temp_warn16" "wl_skipped=$wl_skipped" \
    "perm_used=$(num "$current_count")" "perm_limit=$(num "$limit")" "temp_used=$(num "$temp_current")" "temp_limit=$(num "$temp_limit")"
RUN_DUR=$(( $(date +%s) - RUN_T0 ))
if [ "$EVENTFUL" = 0 ] && [ "$DRY" != 1 ] && [ "$LOG_MODE" = tee ]; then
    printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$(m "$M_END_T" "$RUN_DUR")"          # ekrana her zamanki gibi
    printf '[%(%Y-%m-%d %H:%M:%S)T] %s\n' -1 "$(m "$M_QUIET" "$(num "$current_count")" "$(num "$limit")" "$(num "$temp_current")" "$(num "$temp_limit")" "$RUN_DUR")" >> "$LOG_FILE"
else
    logr "$(m "$M_END_T" "$RUN_DUR")"
fi
