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
#   csf_autogroup.sh --events latest|after|before [T] [N]   event log page as JSON (History tab)
#   csf_autogroup.sh --inside A.B.0.0/16|A.B.C.0/24 [--json]  what a manual ban would cover
#   csf_autogroup.sh --action ban16|ban24 TARGET [--keep]    manual ban; covered entries are removed unless --keep
#   csf_autogroup.sh --action banpfx A.B.C.D/N …             same for an announced prefix, /17–/23 (all ban16 options)
#   csf_autogroup.sh --action unban CIDR [--restore]         lift a ban; --restore brings back what a manual ban removed
#     ban16|ban24 … --mode svc --svc web,ssh,ftp,cp,min,sync,dns [--ports 8080,…]       block only these (inbound)
#     ban16|ban24 … --mode exc --svc web,ssh,ftp,cp,min,sync,dns,mout,wout [--ports …]  full ban, these stay open
#     ban16|ban24 … --replace   change the mode of an existing CSF Auto-Group ban
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
# Bash 5.2+: ${x//a/b} içinde "&" eşleşen parça sayılıyor (patsub_replacement); "&lt;" gibi kaçışlar bozulmasın
shopt -u patsub_replacement 2>/dev/null || true

VERSION="1.13.5"   # sürüm — başlangıç log satırında görünür

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
[ -f "$SELF_DIR/config.env" ] && . "$SELF_DIR/config.env"

# ── Config (overridable via config.env) ─────────────────────────────────────
MSG_LANG="${MSG_LANG:-en}"                       # en | tr
ALERT_MAIL="${ALERT_MAIL:-whm}"                  # whm = WHM'deki iletişim adresi; ya da bir e-posta adresi
# Bildirim kanalları: all = WHM'de tanımlı kanalların hepsi (e-posta: bizim HTML mailimiz, adres WHM'den ·
# Slack: WHM'deki Slack adresi) · email = yalnız e-posta · slack = yalnız Slack. IC_* = Slack'e gidecek olaylar.
NOTIFY="${NOTIFY:-all}"
IC_FIREWALL="${IC_FIREWALL:-1}"; IC_LISTFULL="${IC_LISTFULL:-1}"; IC_RUN="${IC_RUN:-1}"; IC_DIGEST="${IC_DIGEST:-1}"
WWWACCT_SHADOW="${WWWACCT_SHADOW:-/etc/wwwacct.conf.shadow}"   # WHM'in Slack adresi burada (CONTACTSLACK); eklentide saklanmaz
SLACK_BATCH_MIN="${SLACK_BATCH_MIN:-60}"         # tur bildirimleri Slack'e en fazla bu kadar dakikada bir (toplanarak) gider; acil olanlar hemen
WWWACCT_CONF="${WWWACCT_CONF:-/etc/wwwacct.conf}"
DENY_FILE="${DENY_FILE:-/etc/csf/csf.deny}"
CSF_CONF="${CSF_CONF:-/etc/csf/csf.conf}"
CSF_BIN="${CSF_BIN:-/sbin/csf}"
CSF_DIR="${CSF_DIR:-$(dirname "$CSF_CONF")}"     # csf.allow / csf.ignore / csf.rignore
CSF_VAR="${CSF_VAR:-/var/lib/csf}"               # csf.tempban / csf.tempallow / csf.g*
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
LFD_LOG="${LFD_LOG:-/var/log/lfd.log}"           # lfd'nin günlüğü: PERMBLOCK alan IP'nin önceki geçici ban sebebi buradan
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
RESTORE_DIR="${RESTORE_DIR:-$(dirname "$SAYAC_FILE")/restore}"   # elle banın kaldırdığı kalıcı satırlar (ban kaldırılırken geri yüklenebilir)
LOGHIST_FILE="${LOGHIST_FILE:-$(dirname "$SAYAC_FILE")/loghist.v3.jsonl}"   # günlükten çıkarılan, olay kaydından önceki işler
IMUNIFY_FILE="${IMUNIFY_FILE:-$(dirname "$SAYAC_FILE")/imunify}"         # yerel kara liste önbelleği
IMUNIFY_WL_FILE="${IMUNIFY_WL_FILE:-$(dirname "$SAYAC_FILE")/imunify_white}"  # yerel beyaz liste önbelleği
IC_STATE_FILE="${IC_STATE_FILE:-$(dirname "$SAYAC_FILE")/slack_state}"   # Slack'e bildirilmiş, süren sorunlar
SLACK_QUEUE="${SLACK_QUEUE:-$(dirname "$SAYAC_FILE")/slack_queue}"   # Slack'e gitmeyi bekleyen tur bildirimleri
SLACK_LAST="${SLACK_LAST:-$(dirname "$SAYAC_FILE")/slack_last}"      # son toplu tur bildiriminin zamanı
MODSEC_DB="${MODSEC_DB:-/var/cpanel/modsec/modsec.sqlite}"      # cPanel'in ModSecurity eşleşme kaydı (kural mesajları)
MODSEC_CACHE="${MODSEC_CACHE:-$(dirname "$SAYAC_FILE")/modsec_msgs}"   # kural no → mesaj önbelleği
IMUNIFY_REFRESH_MIN="${IMUNIFY_REFRESH_MIN:-60}"   # liste en çok bu kadar dakikada bir yeniden alınır (yalnız panelde gösterilir)
IMUNIFY_BACKFILL="${IMUNIFY_BACKFILL:-200}"   # Imunify IP'leri için turda ayrıca bu kadar /24 sorgulanır
DIGEST="${DIGEST:-1}"                   # 1 = haftalık özet maili
DIGEST_DAY="${DIGEST_DAY:-1}"           # 1 = pazartesi … 7 = pazar (09:00'dan sonraki ilk tur)
# Sağlayıcı (ASN) banı ve izinli servisler — istenen durum burada; motor her turda CSF'te kurar ve onarır.
# "auto": ayar hiç kaydedilmemişse CSF'teki mevcut duruma göre (elle kurulmuş olanı devralır).
SVC_SOURCES_SET="${SVC_SOURCES+x}"
SVC_ALLOW="${SVC_ALLOW:-auto}"          # 1 = yayımlanmış servis adresleri csf.allow'a yazılır (Include)
SVC_SOURCES="${SVC_SOURCES-google}"    # virgüllü: google bing apple duckduckgo openai stripe mollie uptimerobot pingdom statuscake microsoft365
SVC_EXTRA="${SVC_EXTRA:-}"              # boşlukla ayrılmış "ad|https://liste" ya da "ad|1.2.3.0/24"
SVC_URLS="${SVC_URLS:-}"                # hazır kaynakların değiştirilmiş adresleri: "google-common|https://… bing|https://…"
ASN_BAN="${ASN_BAN:-auto}"              # 1 = ASN_LIST'teki sağlayıcılar banlanır
ASN_LIST="${ASN_LIST:-}"                # ortak port listesiyle banlananlar, virgüllü: AS396982,AS14061
ASN_ALL="${ASN_ALL:-}"                  # her şeyi kapatılanlar (CC_DENY), virgüllü
ASN_MODE="${ASN_MODE:-web}"             # web (TCP 80,443 + UDP 443) | ports (ASN_TCP / ASN_UDP) | all (bütün portlar)
ASN_TCP="${ASN_TCP-80,443}"         # boş kaydedilirse boş kalır (varsayılana dönmez)
ASN_UDP="${ASN_UDP-443}"
ENABLED="${ENABLED:-1}"                 # 0 = duraklatıldı: tur ban koymaz, sağlayıcı / bulut banını CSF'ten kaldırır
# Bulut listeleriyle ban: bulut firmalarının kiraladığı sunucuların yayımlanmış adresleri, yalnız seçilen portlar (tools/cloud-ban.sh)
CLOUD_BAN="${CLOUD_BAN:-0}"             # 1 = açık
CLOUD_SOURCES="${CLOUD_SOURCES-gcp}"    # virgüllü: gcp aws azure oracle digitalocean linode vultr
CLOUD_TCP="${CLOUD_TCP-80,443}"
CLOUD_UDP="${CLOUD_UDP-443}"
CLOUD_URLS="${CLOUD_URLS:-}"            # değiştirilmiş kaynak adresleri: "gcp|https://… aws|https://…"
CLOUD_EXTRA="${CLOUD_EXTRA:-}"          # kendi listeleriniz: "ad|https://liste" (düz IP listesi ya da JSON), boşlukla
CLOUD_ACTIVE="${CLOUD_SOURCES//,/ }"; for _x in $CLOUD_EXTRA; do CLOUD_ACTIVE+=" x-${_x%%|*}"; done   # etkin listelerin adları (ek listeler x- önekli)
# Kapsama kararları (uyarı gizleme, gereksizleşen ban, sıralama, IP kartı, ban penceresi) için: liste gerçekten etkin mi.
# Ayar açık ama duraklatılmış (ENABLED=0) ya da ipset varken ag_cloud kümesi yüklü değilse kapalı sayılır — liste dosyaları
# diskte kalsa da. Uygulama (cloud_enforce) ve ayar gösterimi CLOUD_BAN'a bakmaya devam eder.
CLOUD_ON=0
if [ "$CLOUD_BAN" = 1 ] && [ "$ENABLED" != 0 ]; then
    CLOUD_ON=1
    command -v ipset >/dev/null 2>&1 && ! ipset list -n ag_cloud >/dev/null 2>&1 && CLOUD_ON=0
fi
TODAY=$(date '+%Y-%m-%d')
NL=$'\n'

# ── Command line ────────────────────────────────────────────────────────────
MODE=run; JSON=0; FORCE=0; DRY=0; ACT=""; ARGS=(); SETS=(); SEND=0; CLEAN=1; RESTORE=0; BMODE=all; BSVC=""; BPORTS=""; REPLACE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) MODE=run; DRY=1 ;;
        --status)  MODE=status ;;
        --lookup)  MODE=lookup ;;
        --events)  MODE=events ;;
        --inside)  MODE=inside ;;
        --asn-impact) MODE=asnimpact ;;
        --prov-apply) MODE=prov ;;
        --keep)    CLEAN=0 ;;
        --restore) RESTORE=1 ;;
        --mode)    BMODE="${2:-}"; shift ;;      # elle ban: all | svc (yalnız seçilen servisler) | exc (her şey, seçilenler hariç)
        --svc)     BSVC="${2:-}"; shift ;;
        --ports)   BPORTS="${2:-}"; shift ;;
        --replace) REPLACE=1 ;;          # eklentinin kendi banının kipini değiştir
        --action)  MODE=action; ACT="${2:-}"; shift ;;
        --config)  MODE=config ;;
        --set)     SETS+=("${2:-}"); shift ;;
        --digest)  MODE=digest ;;
        --busy)    MODE=busy ;;
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
  # Türkçe tarih/metin; ama sıralama kuralı C: tr_TR'de "i" [a-z] aralığına girmiyor (ı/i ayrı harf),
  # e-posta, alan adı ve tarih denetimleri "gmail" gibi değerleri reddediyordu (sunucuda doğrulandı).
  unset LC_ALL; export LANG=tr_TR.UTF-8 LC_COLLATE=C
  M_START="--- Başladı ---"
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
  M_PERM_USAGE="Kalıcı liste: %s / %s satır (%%%s)"
  M_PERM_WARN="UYARI: Kalıcı limit doluluk oranı %%80'i geçti!"
  M_PERM_FULL="Kalıcı liste: %s / %s satır (%%%s) — dolmak üzere"
  M_TEMP_USAGE="Geçici liste: %s / %s satır (%%%s)"
  M_TEMP_WARN="UYARI: Geçici limit doluluk oranı %%80'i geçti!"
  M_TEMP_FULL="Geçici liste: %s / %s satır (%%%s) — dolmak üzere"
  M_NOLIMIT="ATLANDI: %s limiti bulunamadı/sıfır, doluluk kontrolü atlandı"
  M_C24_DND="Auto-grouped /24: %s kalıcı tekil nedeniyle kalıcı ban - do not delete"
  M_TMIN_LEFT="%s dk kaldı"
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
  M_WARN16="ŞÜPHELİ AĞ: %s.0.0/16 - %s IP (%s kalıcı, %s geçici), %s farklı blok - elle bakın"
  M_WARN16_B="%s.0.0/16 -> %s IP (%s kalıcı, %s geçici), %s farklı bloktan"
  M_SKIP16="ATLANDI şüpheli ağ: %s.0.0/16 bugün zaten bildirildi"
  M_16_DONE="Şüpheli ağ turu bitti. %s bildirim."
  M_MAIL16_BODY="Aşağıdaki ağlarda (/16) birçok bloktan tekil ban (kalıcı ve geçici) birikti. Ağ banlanmadı;\nelle bakmanız önerilir:"
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
  M_PROV16="%s.0.0/16: saldıran IP'lerin hepsi sağlayıcı banıyla zaten kapalı (%s), uyarı atlandı"
  M_TWARN16="ŞÜPHELİ AĞ: %s.0.0/16 - geçici banlardan %s IP, %s farklı blok - elle bakın"
  M_TSKIP16="ATLANDI şüpheli ağ: %s.0.0/16 zaten kalıcı banlı"
  M_TSKIP16D="ATLANDI şüpheli ağ (geçici): %s.0.0/16 bugün zaten bildirildi"
  M_T16_DONE="Şüpheli ağ turu (geçici banlar) bitti. %s bildirim."
  M_MAILT16_BODY="Aşağıdaki ağlarda (/16) çok sayıda geçici ban birikti. Ağ banlanmadı;\nelle bakmanız önerilir:"
  M_MAILT16_SUBJ="%s şüpheli ağ (geçici banlar)"
  M_WL_LOADED="Beyaz liste yüklendi: %s aralık, %s rignore alan adı"
  M_WL_SELF="sunucu IP'si"
  M_A_SELF="%s sunucunun kendi IP'sini (%s) içeriyor; banlanamaz"
  M_WL_SKIP="ATLANDI %s: beyaz listeyle çakışıyor (%s)"
  M_WL_SKIPD="ATLANDI %s: beyaz listede (%s), bugün zaten bildirildi"
  M_WL_RETRY="ATLANDI %s: beyaz liste (%s) DNS hatası nedeniyle doğrulanamadı, sonraki turda tekrar denenecek"
  M_WL_B="%s -> %s tekil, banlanmadı, beyaz listede: %s"
  M_WL_NOTE="   Not: içinde beyaz listede kayıt var (%s)"
  M_MAILWL_BODY="Aşağıdaki bloklar ban eşiğine ulaştı ama CSF beyaz listeleriyle çakıştığı için banlanmadı.\nTekil banlar yerinde duruyor:"
  M_MAILWL_SUBJ="%s blok atlandı (beyaz liste)"
  M_CC_NOLOOKUP="UYARI: CC_IGNORE/CC_ALLOW veya csf.rignore tanımlı ama DNS sorgusu yapılamıyor (LOOKUP=0 ya da dig/host yok); bu kontroller atlandı"
  M_LOOKUP_OFF="UYARI: DNS sorguları art arda zaman aşımına uğradı, bu turda kapatıldı"
  M_CLEANCNT="Sayaç temizliği yapıldı (%s günden eski kayıtlar silindi)"
  M_LOGTRIM="Günlük %s satırda tutuldu (önceki: %s satır)"
  M_MAIL_PERMFULL_SUBJ="kalıcı liste %%%s dolu"
  M_MAIL_PERMFULL_BODY="CSF'in kalıcı ban listesi (csf.deny) dolmak üzere. Dolunca CSF en eski banları kendisi siler; do not delete olmayan blok banları da gidebilir. Eski banları kaldırın ya da DENY_IP_LIMIT'i yükseltin."
  M_MAIL_TEMPFULL_SUBJ="geçici liste %%%s dolu"
  M_MAIL_TEMPFULL_BODY="CSF'in geçici ban listesi dolmak üzere. Dolunca yeni geçici banlar eklenemeyebilir. Geçici banların süresinin dolmasını bekleyin ya da DENY_TEMP_IP_LIMIT'i yükseltin."
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
  M_A_CLEANED="%s · %s kayıt kaldırıldı"
  M_IN_COVER="Zaten kapsanıyor: %s"
  M_IN_SUM="İçinde: %s blok banı, %s tekil (%s do not delete), %s geçici ban, %s izlenen blok, %s başka aralık"
  M_IN_WL="Beyaz liste çakışması: %s"
  M_L_PORT="Port sınırlı"; M_L_CCD="CC_DENY"; M_L_CCP="CC_DENY_PORTS"
  M_A_FORGOT="%s izlemeden çıkarıldı"
  M_A_NOREC="%s izlenmiyor"
  M_A_UNBANNED="%s kaldırıldı"
  M_A_RESTORED="%s · %s kayıt geri yüklendi"
  M_A_PCOMMENT="elle /%s kısmi ban (%s)"
  M_A_PBANNED="%s: seçilen servisler kapatıldı (port %s)"
  M_A_PREMOVED="%s kısmi banı kaldırıldı"
  M_A_EXC="%s · seçilen servisler için %s izin satırı eklendi"
  M_A_NOSVC="En az bir servis seçilmeli"
  M_A_BADPORTS="Geçersiz port: %s (tek port ya da 30000-35000 gibi aralık, virgülle)"
  M_A_CHANGED="%s: ban güncellendi"
  M_A_NOSAVE="%s: kurtarma kopyası yazılamadı (%s); kapsananlar yerinde bırakıldı"
  M_A_NODRY="Elle işlemler kuru çalıştırmada (--dry-run) yapılmaz"
  M_CFG_SVCX="ad|https://adres ya da ad|IP biçiminde, en çok 50 kayıt"
  M_CFG_CLX="ad|https://adres biçiminde (ad: küçük harf, rakam, tire), en çok 20 kayıt"
  M_CFG_SVCU="kaynak|https://adres biçiminde"
  M_SVC_FAIL_SUBJ="izinli servis listesi indirilemiyor (%s)"
  M_SVC_FAIL_BODY="Şu izinli servis listeleri 3 günden uzun süredir indirilemiyor: %s. Eski listeler kullanılmaya devam ediyor; ama sağlayıcı adresini değiştirdiyse yeni sunucuları izinli değildir. Adresi panelden düzeltebilirsiniz: Sağlayıcılar → İzinli servisler → Kaynak adresleri."
  M_SVC_FAIL_OK="İzinli servis listeleri yeniden indirilebiliyor"
  M_CFG_ASN="AS ile başlayan numaralar, virgülle (en çok 50)"
  M_CFG_PORTS="virgüllü portlar ya da aralıklar (30000:35000), en çok 15"
  M_ASN_APPLIED="Sağlayıcı banı CSF'e uygulandı: %s"
  M_ASN_REMOVED="Sağlayıcı banı CSF'ten kaldırıldı: %s"
  M_ASN_CONFLICT="Sağlayıcı banı uygulanmadı: CC_DENY_PORTS'taki %s aynı port listesini kullanıyor (TCP %s, UDP %s); değiştirmek onları da etkilerdi"
  M_ASN_SELF="Sağlayıcı banı uygulanmadı: %s bu sunucunun kendi sağlayıcısı"
  M_C24_CLOSED="%s.0/24 banlanmadı: %s tekilin yalnız %s tanesi açık bir servise; ötekilerin servisi zaten kapalı (sağlayıcı banı, kiralık liste, ülke ya da kısmi ban)"
  M_ASN_NOSELF="Sağlayıcı banı uygulanmadı: %s — sunucunun kendi sağlayıcısı öğrenilemedi (DNS ve CSF'in ASN verisi yok); kendi sağlayıcısını banlamamak için yeni sağlayıcı eklenmiyor"
  M_SVC_APPLIED="İzinli servisler güncellendi: %s"
  M_SVC_REMOVED="İzinli servisler kapatıldı; csf.allow'daki Include satırı ve liste kaldırıldı"
  M_PAUSED="CSF Auto-Group duraklatıldı: yeni ban konmuyor; sağlayıcı banı ve kiralık sunucu banı CSF'te kaldırıldı (Ayarlar → Zamanlama'dan açılır)"
  M_CLOUD_REMOVED="Kiralık sunucu banı kapatıldı; kural, adres kümesi ve csfpost.sh satırı kaldırıldı"
  M_CLOUD_FAIL_SUBJ="kiralık sunucu listesi indirilemiyor (%s)"
  M_CLOUD_FAIL_BODY="Şu kiralık sunucu listeleri 3 günden uzun süredir indirilemiyor: %s. Eski listeler kullanılmaya devam ediyor; ama sağlayıcı yeni adresler aldıysa onlar banlı değildir. Adresi panelden düzeltebilirsiniz: Sağlayıcılar → Kiralık sunucular → kutucuktaki Adres düğmesi."
  M_CLOUD_FAIL_OK="Kiralık sunucu listeleri yeniden indirilebiliyor"
  M_DG_CLOUD="Kiralık sunucular: %s · kapalı %s"
  M_ASN_REFRESH="CSF'in ASN verisi %s günlüktü; yenilensin diye lfd yeniden başlatıldı (ASN banı: %s)"
  M_ASN_REFRESH_FAIL="CSF'in ASN verisi eski (%s gün) ama lfd yeniden başlatılamadı; ASN banı eski adreslerle çalışıyor"
  M_ORPHANS="Banı CSF ekranından kaldırılmış %s eski kayıt temizlendi (kurtarma kopyası / izin satırı)"
  M_A_TIME="Elle işlem süresi (%s): %s sn"
  M_PART_NOTE="   Not: bu ağda kısmi ban var (%s · %s); yalnız seçilen servisler kapalı, diğer portlardan gelenler sürebilir"
  M_PART_AFTER="   Yalnız kısmi bandan (%s) sonra gelen banlar sayıldı."
  M_PART_LEAK="   Dikkat: kapatılan servislere (%s) bandan sonra yine saldırı kaydı var; kuralın yüklü olduğunu kontrol edin: iptables -S DENYIN | grep %s"
  M_PART_MORE="   Kısmi bandan sonraki saldırılar başka servislere de: %s. Tam ban daha uygun olabilir."
  M_PSKIP16="ATLANDI şüpheli ağ: %s.0.0/16 kısmi banlı; bandan sonra %s yeni tekil var, eşiğin altında"
  M_SAME16="ATLANDI şüpheli ağ: %s.0.0/16 son uyarıdan beri yeni IP yok"
  M_FIX_UDP="%s: kısmi ban/istisnaya eksik UDP 443 satırı eklendi (HTTP/3)"
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
  M_TM_BODY="Bu bir test mailidir. %s sunucusundaki CSF Auto-Group uyarıları bu adrese gelecek.\nBu denemeyi WHM'de %s kullanıcısı gönderdi."
  M_TM_SENT="Test maili %s adresine gönderildi (mail komutu kabul etti)"
  M_TM_FAIL="mail komutu hata verdi: %s"
  M_DG_SUBJ="CSF Auto-Group haftalık özet (%s)"
  M_DG_HEAD="Son 7 gün: %s – %s"
  M_DG_COUNTS="%s blok banı · %s geçici blok banı · %s kalıcıya alındı · %s şüpheli ağ · %s atlandı (beyaz liste) · %s elle işlem · %s ayar değişikliği"
  M_DG_USAGE="Kalıcı liste: %s / %s satır (%%%s) · 7 gün önce: %s"
  M_DG_TUSAGE="Geçici liste: %s / %s satır"
  M_DG_NEW="Yeni blok banları:"
  M_DG_TOP="CSF'in en çok engellediği sağlayıcılar (ASN; blok banları ve tekil banlara göre):"
  M_DG_TOPL="   %-9s %-44s %s"
  M_DG_PG="%s blok"; M_DG_PB="+%s blok CSF Auto-Group dışından"; M_DG_PT="%s tekil"
  M_DG_EXP="14 gün içinde izlemesi bitecek bloklar (tekrar gelirlerse kalıcı olurlar):"
  M_DG_EXPL="   %-18s %s gün"
  M_DG_RUNS="Tur sağlığı: son 7 günde %s tur çalıştı (%s çalıştığı için beklenen ~%s)"
  M_DG_RUNS0="Tur sağlığı: son 7 günde %s tur çalıştı"; M_IV_MIN="%s dakikada bir"; M_IV_HOUR="saatte bir"; M_IV_HOURS="%s saatte bir"
  M_DG_IM="Imunify360'ın en çok engellediği sağlayıcılar (sunucunun kendi kara listesi, %s IP):"
  M_DG_IML="   %-9s %-44s %s IP%s"
  M_DG_NONE="   yok"
  M_DG_SENT="Haftalık özet gönderildi: %s"
  M_IC_NOSLACK="WHM'de Slack adresi tanımlı değil"; M_IC_FAIL="Slack bildirimi gönderilemedi: %s"; M_IC_SENT="Slack bildirimi gönderildi"
  M_IC_FW="Güvenlik duvarında sorun: %s"; M_IC_FW_OK="Güvenlik duvarı sorunu düzeldi"
  M_IC_PERM="Kalıcı liste %%%s dolu"; M_IC_PERM_OK="Kalıcı liste doluluğu %%80'in altına indi"
  M_IC_TEMP="Geçici liste %%%s dolu"; M_IC_TEMP_OK="Geçici liste doluluğu %%80'in altına indi"
  M_IC_TEST_S="Deneme bildirimi"; M_IC_TEST_B="Bu bir deneme bildirimidir. %s sunucusundaki CSF Auto-Group uyarıları WHM'de tanımlı Slack kanalına bu şekilde gelecek.\nBu denemeyi WHM'de %s kullanıcısı gönderdi."
  M_H_IP="IP"; M_H_HOST="Hostname"; M_H_WHY="Sebep"; M_H_MORE="ve %s IP daha"
  M_H_PANEL="Paneli aç"; M_H_PANELP="WHM → Eklentiler → CSF Auto-Group"
  M_H_PERM="Kalıcı liste"; M_H_TEMP="Geçici liste"; M_H_LINES="%s / %s satır · %%%s"; M_H_AGO="7 gün önce %s"
  M_H_WEEK="Haftalık özet"; M_H_NONE="Bu hafta yok."
  M_H_CNT="blok banı|geçici blok banı|kalıcıya alındı|şüpheli ağ|atlandı|elle işlem|ayar değişikliği"
  M_H_NEWT="Yeni blok banları"; M_H_BLOCK="Blok"; M_H_OWNER="Sahip"; M_H_STATE="Durum"
  M_H_K_add24="kalıcı"; M_H_K_promote="tekrar gelen"; M_H_K_manual_ban="elle"
  M_H_TOPT="CSF'in en çok engellediği sağlayıcılar"; M_H_TOPS="csf.deny'deki blok banlarına ve tekil banlara göre · banlı sağlayıcılar hariç"
  M_H_PBT="Sağlayıcı banı"; M_H_PBS="Bu sağlayıcılar CSF'te banlı; sıralamalarda gösterilmez"; M_H_PBK="Kapalı"; M_H_PBR="Aralık"
  M_H_PBALL="her şey"; M_H_PBNL="CSF henüz yüklemedi"
  M_H_SVC="İzinli servisler: csf.allow'da %s adres · son indirme %s"; M_H_SVCF="3 günden uzun süredir indirilemiyor: %s"
  M_DG_PB="Sağlayıcı banı (sıralamalarda gösterilmez):"; M_DG_PBL="   %-9s %-44s %s"
  M_H_PROV="Sağlayıcı"; M_H_BLK="Blok"; M_H_SGL="Tekil"; M_H_OTH="CSF Auto-Group dışı"; M_H_OTHV="+%s blok"
  M_H_IMT="Imunify360'ın en çok engellediği sağlayıcılar"; M_H_IMS="Sunucunun kendi kara listesi · %s IP"; M_H_IPS="IP"; M_H_RSN="Sebep"
  M_H_EXPT="İzlemesi bitecek bloklar"; M_H_EXPS="14 gün içinde; tekrar gelirlerse kalıcı olurlar"; M_H_DAYS="%s gün"; M_H_NONE_S="Yok"
  M_H_RUNS="Tur sağlığı"; M_H_RUNSS="son 7 gün"; M_H_RUNSV="%s tur · beklenen ~%s"
  M_H_GLOSS="tekil = tek IP banı · blok = /24 · ağ = /16 · do not delete = CSF liste dolsa da silmez"
  M_SQ_SUBJ="%s tur bildirimi (son %s dk)"
  M_H_TMT="Test maili"; M_H_TMS="Mail ayarların çalışıyor"; M_H_RSUM="%s IP · %s"
else
  M_START="--- Started ---"
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
  M_PERM_FULL="Permanent list: %s / %s lines (%s%%) — almost full"
  M_TEMP_USAGE="Temp deny usage: %s / %s lines (%s%%)"
  M_TEMP_WARN="WARNING: temp deny list is over 80%% full!"
  M_TEMP_FULL="Temp list: %s / %s lines (%s%%) — almost full"
  M_NOLIMIT="SKIPPED: %s limit missing/zero, usage check skipped"
  M_C24_DND="Auto-grouped /24: %s permanent singles -> permanent ban - do not delete"
  M_TMIN_LEFT="%s min left"
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
  M_WARN16="SUSPICIOUS NETWORK: %s.0.0/16 - %s IPs (%s permanent, %s temp), %s distinct blocks - review manually"
  M_WARN16_B="%s.0.0/16 -> %s IPs (%s permanent, %s temp) across %s distinct blocks"
  M_SKIP16="SKIPPED suspicious network: %s.0.0/16 already reported today"
  M_16_DONE="Suspicious network pass done. %s report(s)."
  M_MAIL16_BODY="Single bans (permanent and temp) have piled up across several blocks of the following networks (/16). The network was not banned;\nmanual review recommended:"
  M_MAIL16_SUBJ="%s suspicious network(s)"
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
  M_PROV16="%s.0.0/16: every attacking IP is already blocked by the provider ban (%s), warning skipped"
  M_TWARN16="SUSPICIOUS RANGE: %s.0.0/16 - %s IPs from temp bans, %s distinct blocks - review manually"
  M_TSKIP16="SKIPPED suspicious network: %s.0.0/16 already permanently banned"
  M_TSKIP16D="SKIPPED suspicious network (temp): %s.0.0/16 already reported today"
  M_T16_DONE="Suspicious network pass (temp bans) done. %s report(s)."
  M_MAILT16_BODY="Many temp bans have piled up in the following networks (/16). The network was not banned;\nmanual review recommended:"
  M_MAILT16_SUBJ="%s suspicious network(s) (temp bans)"
  M_WL_LOADED="Whitelist loaded: %s ranges, %s rignore domains"
  M_WL_SELF="server IP"
  M_A_SELF="%s contains this server's own IP (%s); it can't be banned"
  M_WL_SKIP="SKIPPED %s: overlaps a whitelist entry (%s)"
  M_WL_SKIPD="SKIPPED %s: whitelisted (%s), already reported today"
  M_WL_RETRY="SKIPPED %s: whitelist (%s) could not be verified (DNS failure), will retry next run"
  M_WL_B="%s -> %s singles, not banned, whitelisted: %s"
  M_WL_NOTE="   Note: contains a whitelist entry (%s)"
  M_MAILWL_BODY="The following blocks reached the ban threshold but were NOT banned because they overlap a CSF whitelist.\nThe single bans stay in place:"
  M_MAILWL_SUBJ="%s block(s) skipped (whitelist)"
  M_CC_NOLOOKUP="WARNING: CC_IGNORE/CC_ALLOW or csf.rignore is set but DNS lookups are unavailable (LOOKUP=0 or no dig/host); those checks were skipped"
  M_LOOKUP_OFF="WARNING: DNS lookups timed out repeatedly, disabled for this run"
  M_CLEANCNT="Counter cleaned (records older than %s days removed)"
  M_LOGTRIM="Log trimmed to %s lines (was: %s lines)"
  M_MAIL_PERMFULL_SUBJ="permanent list %s%% full"
  M_MAIL_PERMFULL_BODY="CSF's permanent ban list (csf.deny) is almost full. When it is full, CSF removes the oldest bans itself; block bans without do not delete can go too. Remove old bans or raise DENY_IP_LIMIT."
  M_MAIL_TEMPFULL_SUBJ="temp list %s%% full"
  M_MAIL_TEMPFULL_BODY="CSF's temp ban list is almost full. When it is full, new temp bans may not be added. Wait for temp bans to expire or raise DENY_TEMP_IP_LIMIT."
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
  M_IGN16="SKIPPED suspicious network: %s.0.0/16 is ignored (until %s)"
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
  M_A_CLEANED="%s · %s entries removed"
  M_IN_COVER="Already covered: %s"
  M_IN_SUM="Inside: %s block bans, %s singles (%s do not delete), %s temp bans, %s watched blocks, %s other ranges"
  M_IN_WL="Whitelist overlap: %s"
  M_L_PORT="Port-limited"; M_L_CCD="CC_DENY"; M_L_CCP="CC_DENY_PORTS"
  M_A_FORGOT="%s is no longer watched"
  M_A_NOREC="%s is not watched"
  M_A_UNBANNED="%s removed"
  M_A_RESTORED="%s · %s entries restored"
  M_A_PCOMMENT="manual /%s partial ban (%s)"
  M_A_PBANNED="%s: selected services blocked (ports %s)"
  M_A_PREMOVED="%s partial ban removed"
  M_A_EXC="%s · %s allow lines added for the selected services"
  M_A_NOSVC="Pick at least one service"
  M_A_BADPORTS="Invalid port: %s (single ports or ranges like 30000-35000, comma separated)"
  M_A_CHANGED="%s: ban updated"
  M_A_NOSAVE="%s: the restore copy could not be written (%s); covered entries were left in place"
  M_A_NODRY="Manual actions are not run in a dry run (--dry-run)"
  M_CFG_SVCX="name|https://url or name|IP, at most 50 entries"
  M_CFG_CLX="name|https://url (name: lowercase letters, digits, dash), at most 20 entries"
  M_CFG_SVCU="source|https://url"
  M_SVC_FAIL_SUBJ="allowed service list can't be downloaded (%s)"
  M_SVC_FAIL_BODY="These allowed service lists haven't downloaded for more than 3 days: %s. The old lists are still used, but if the provider changed its address its new servers aren't allowed. You can fix the address in the panel: Providers → Allowed services → Source addresses."
  M_SVC_FAIL_OK="Allowed service lists download again"
  M_CFG_ASN="numbers starting with AS, comma separated (at most 50)"
  M_CFG_PORTS="comma separated ports or ranges (30000:35000), at most 15"
  M_ASN_APPLIED="Provider ban applied to CSF: %s"
  M_ASN_REMOVED="Provider ban removed from CSF: %s"
  M_ASN_CONFLICT="Provider ban not applied: %s in CC_DENY_PORTS share the port list (TCP %s, UDP %s); changing it would affect them too"
  M_ASN_SELF="Provider ban not applied: %s is this server's own provider"
  M_C24_CLOSED="%s.0/24 not banned: only %s of %s singles hit an open service; the others' service is already closed (provider ban, rented-server list, country or partial ban)"
  M_ASN_NOSELF="Provider ban not applied: %s — this server's own provider is unknown (no DNS answer, no CSF ASN data); no new provider is added so the server's own isn't banned"
  M_SVC_APPLIED="Allowed services updated: %s"
  M_SVC_REMOVED="Allowed services turned off; the Include line in csf.allow and the list were removed"
  M_PAUSED="CSF Auto-Group is paused: no new bans; the provider ban and the rented-server ban are off in CSF (turn it back on in Settings → Schedule)"
  M_CLOUD_REMOVED="Rented-server ban turned off; the rule, the address set and the csfpost.sh line were removed"
  M_CLOUD_FAIL_SUBJ="rented-server list can't be downloaded (%s)"
  M_CLOUD_FAIL_BODY="These rented-server lists haven't downloaded for more than 3 days: %s. The old lists are still used, but addresses the provider added since aren't banned. You can fix the address in the panel: Providers → Rented servers → the Address button on the tile."
  M_CLOUD_FAIL_OK="Rented-server lists download again"
  M_DG_CLOUD="Rented servers: %s · blocked %s"
  M_ASN_REFRESH="CSF's ASN data was %s days old; lfd restarted to refresh it (ASN ban: %s)"
  M_ASN_REFRESH_FAIL="CSF's ASN data is old (%s days) but lfd couldn't be restarted; the ASN ban uses old addresses"
  M_ORPHANS="Cleaned up %s leftover entries of bans removed outside the plugin (restore copies / allow lines)"
  M_A_TIME="Manual action time (%s): %s s"
  M_PART_NOTE="   Note: this network has a partial ban (%s · %s); only the selected services are blocked, traffic to other ports can continue"
  M_PART_AFTER="   Only bans added after the partial ban (%s) were counted."
  M_PART_LEAK="   Warning: the blocked services (%s) were attacked again after the ban; check that the rule is loaded: iptables -S DENYIN | grep %s"
  M_PART_MORE="   Attacks after the partial ban also hit other services: %s. A full ban may fit better."
  M_PSKIP16="SKIPPED suspicious network: %s.0.0/16 is partially banned; %s new singles since the ban, below the threshold"
  M_SAME16="SKIPPED suspicious network: %s.0.0/16 no new IPs since the last warning"
  M_FIX_UDP="%s: added the missing UDP 443 line to the partial ban/exception (HTTP/3)"
  M_A_UNBANFAIL="%s could not be removed: %s"
  M_A_NOTFOUND="%s is not in csf.deny or the temp list (exact match)"
  M_A_IGNORED="%s will be ignored until %s"
  M_A_UNIGNORED="%s is no longer ignored"
  M_A_NOTIGN="%s is not on the ignore list"
  M_S_TITLE="CSF Auto-Group %s — status"
  M_S_LAST="Last run"; M_S_NEVER="none yet"; M_S_RUNNING="running now"
  M_S_USAGE="Usage"; M_S_PERM="permanent"; M_S_TEMP="temp"
  M_S_REVIEW="Needs review (%s days)"; M_S_PENDING="Watched"
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
  M_TM_BODY="This is a test email. CSF Auto-Group alerts from %s will arrive at this address.\nThis test was sent by the WHM user %s."
  M_TM_SENT="Test email handed to the mail command for %s"
  M_TM_FAIL="the mail command failed: %s"
  M_DG_SUBJ="CSF Auto-Group weekly summary (%s)"
  M_DG_HEAD="Last 7 days: %s – %s"
  M_DG_COUNTS="%s block bans · %s temp block bans · %s made permanent · %s suspicious networks · %s skipped (whitelist) · %s manual actions · %s settings changes"
  M_DG_USAGE="Permanent list: %s / %s lines (%s%%) · 7 days ago: %s"
  M_DG_TUSAGE="Temp list: %s / %s lines"
  M_DG_NEW="New block bans:"
  M_DG_TOP="Providers CSF blocks most (ASN; by block bans and single bans):"
  M_DG_TOPL="   %-9s %-44s %s"
  M_DG_PG="%s blocks"; M_DG_PB="+%s blocks not from CSF Auto-Group"; M_DG_PT="%s singles"
  M_DG_EXP="Watched blocks expiring within 14 days (become permanent if they return):"
  M_DG_EXPL="   %-18s %s days"
  M_DG_RUNS="Run health: %s runs in the last 7 days (about %s expected, running %s)"
  M_DG_RUNS0="Run health: %s runs in the last 7 days"; M_IV_MIN="every %s minutes"; M_IV_HOUR="every hour"; M_IV_HOURS="every %s hours"
  M_DG_IM="Providers Imunify360 blocks most (this server's own blacklist, %s IPs):"
  M_DG_IML="   %-9s %-44s %s IPs%s"
  M_DG_NONE="   none"
  M_DG_SENT="Weekly summary sent: %s"
  M_IC_NOSLACK="No Slack address is set in WHM"; M_IC_FAIL="Slack notification failed: %s"; M_IC_SENT="Slack notification sent"
  M_IC_FW="Firewall problem: %s"; M_IC_FW_OK="Firewall problem resolved"
  M_IC_PERM="Permanent list %s%% full"; M_IC_PERM_OK="Permanent list usage is back under 80%%"
  M_IC_TEMP="Temp list %s%% full"; M_IC_TEMP_OK="Temp list usage is back under 80%%"
  M_IC_TEST_S="Test notification"; M_IC_TEST_B="This is a test notification. CSF Auto-Group alerts from %s will reach the Slack channel set in WHM like this.\nThis test was sent by the WHM user %s."
  M_H_IP="IP"; M_H_HOST="Hostname"; M_H_WHY="Reason"; M_H_MORE="and %s more IPs"
  M_H_PANEL="Open the panel"; M_H_PANELP="WHM → Plugins → CSF Auto-Group"
  M_H_PERM="Permanent list"; M_H_TEMP="Temp list"; M_H_LINES="%s / %s lines · %s%%"; M_H_AGO="7 days ago %s"
  M_H_WEEK="Weekly summary"; M_H_NONE="None this week."
  M_H_CNT="block bans|temp block bans|made permanent|suspicious networks|skipped|manual actions|settings changes"
  M_H_NEWT="New block bans"; M_H_BLOCK="Block"; M_H_OWNER="Owner"; M_H_STATE="State"
  M_H_K_add24="permanent"; M_H_K_promote="repeat offender"; M_H_K_manual_ban="manual"
  M_H_TOPT="Providers CSF blocks most"; M_H_TOPS="by block bans and single bans in csf.deny · banned providers left out"
  M_H_PBT="Provider ban"; M_H_PBS="These providers are banned in CSF; the rankings leave them out"; M_H_PBK="Blocked"; M_H_PBR="Ranges"
  M_H_PBALL="everything"; M_H_PBNL="not loaded by CSF yet"
  M_H_SVC="Allowed services: %s addresses in csf.allow · last download %s"; M_H_SVCF="Not downloaded for more than 3 days: %s"
  M_DG_PB="Provider ban (left out of the rankings):"; M_DG_PBL="   %-9s %-44s %s"
  M_H_PROV="Provider"; M_H_BLK="Blocks"; M_H_SGL="Singles"; M_H_OTH="Not from CSF Auto-Group"; M_H_OTHV="+%s blocks"
  M_H_IMT="Providers Imunify360 blocks most"; M_H_IMS="This server's own blacklist · %s IPs"; M_H_IPS="IPs"; M_H_RSN="Reason"
  M_H_EXPT="Watched blocks expiring"; M_H_EXPS="within 14 days; they become permanent if they return"; M_H_DAYS="%s days"; M_H_NONE_S="None"
  M_H_RUNS="Run health"; M_H_RUNSS="last 7 days"; M_H_RUNSV="%s runs · ~%s expected"
  M_H_GLOSS="single = one-IP ban · block = /24 · network = /16 · do not delete = CSF keeps it even when the list is full"
  M_SQ_SUBJ="%s run notices (last %s min)"
  M_H_TMT="Test email"; M_H_TMS="Your mail settings work"; M_H_RSUM="%s IPs · %s"
fi
# "--": "--- Bitti …" gibi şablonlar seçenek sanılmasın. İngilizce "(s)" çoğulu metindeki ilk sayıya göre
# çözülür: "1 block ban(s)" → "1 block ban", "3 block ban(s)" → "3 block bans".
m() {
    local f="$1" r; shift; printf -v r -- "$f" "$@"
    if [[ "$r" == *"(s)"* ]]; then
        if [[ "$r" =~ ^[^0-9]*1([^0-9]|$) ]]; then r="${r//(s)/}"; else r="${r//(s)/s}"; fi
    fi
    printf '%s' "$r"
}

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
CFG_KEYS="MSG_LANG ALERT_MAIL NOTIFY DIGEST DIGEST_DAY IC_FIREWALL IC_LISTFULL IC_RUN IC_DIGEST THRESHOLD_24 THRESHOLD_24_PERMANENT THRESHOLD_16 THRESHOLD_TEMP_24 THRESHOLD_TEMP_16 LOOKUP LOOKUP_TIMEOUT SAYAC_RETENTION_DAYS REVIEW_DAYS LOG_MAX_LINES LOG_ROTATE_MB LOG_ROTATE_KEEP BLOCK_EXPIRE_DAYS BLOCK_EXPIRE_AUTO CRON_MIN SVC_ALLOW SVC_SOURCES SVC_EXTRA SVC_URLS ASN_BAN ASN_LIST ASN_ALL ASN_MODE ASN_TCP ASN_UDP CLOUD_BAN CLOUD_SOURCES CLOUD_TCP CLOUD_UDP CLOUD_URLS CLOUD_EXTRA ENABLED"
PROV_KEYS="SVC_ALLOW SVC_SOURCES SVC_EXTRA SVC_URLS ASN_BAN ASN_LIST ASN_ALL ASN_MODE ASN_TCP ASN_UDP CLOUD_BAN CLOUD_SOURCES CLOUD_TCP CLOUD_UDP CLOUD_URLS CLOUD_EXTRA ENABLED"
SVC_CATALOG="google bing apple duckduckgo openai stripe mollie uptimerobot pingdom statuscake microsoft365"
CLOUD_CATALOG="gcp aws azure oracle digitalocean linode vultr"
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
        DIGEST|IC_FIREWALL|IC_LISTFULL|IC_RUN|IC_DIGEST) opts="0 1" ;;
        NOTIFY) opts="all email slack" ;;
        DIGEST_DAY) opts="1 2 3 4 5 6 7" ;;
        ALERT_MAIL)
            # Yerel adresler de geçerli: "root", "root@localhost" (cPanel root'un postasını
            # sunucunun iletişim adresine yönlendirir; script'in varsayılanı da budur).
            # "whm": WHM'deki iletişim adresi (her gönderimde okunur)
            [ "$v" = whm ] && return 0
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
        SVC_ALLOW|ASN_BAN|CLOUD_BAN|ENABLED) opts="0 1" ;;
        CLOUD_SOURCES)
            local x; CFG_VAL=""
            for x in ${v//,/ }; do
                case " $CLOUD_CATALOG " in *" $x "*) ;; *) CFG_ERR=$(m "$M_CFG_BAD" "$k" "$x" "$(m "$M_CFG_ONEOF" "${CLOUD_CATALOG// /, }")"); return 1 ;; esac
                case ",$CFG_VAL," in *",$x,"*) ;; *) CFG_VAL+="${CFG_VAL:+,}$x" ;; esac
            done
            return 0 ;;
        ASN_MODE) opts="web ports all" ;;
        SVC_SOURCES)
            local x; CFG_VAL=""
            for x in ${v//,/ }; do
                case " $SVC_CATALOG " in *" $x "*) ;; *) CFG_ERR=$(m "$M_CFG_BAD" "$k" "$x" "$(m "$M_CFG_ONEOF" "${SVC_CATALOG// /, }")"); return 1 ;; esac
                case ",$CFG_VAL," in *",$x,"*) ;; *) CFG_VAL+="${CFG_VAL:+,}$x" ;; esac
            done
            return 0 ;;
        SVC_URLS|CLOUD_URLS)      # yalnız https adresi; ad hazır kaynaklardan biri olmalı
            local x u re='^[a-z0-9-]{1,40}[|]https://[A-Za-z0-9._~:/?#@=%+&-]{4,255}$'; CFG_VAL=""
            for x in $v; do
                [[ "$x" =~ $re ]] || { CFG_ERR=$(m "$M_CFG_BAD" "$k" "$x" "$M_CFG_SVCU"); return 1; }
                CFG_VAL+="${CFG_VAL:+ }$x"
            done
            return 0 ;;
        CLOUD_EXTRA)
            local x n=0 re='^[a-z0-9-]{1,30}[|]https://[A-Za-z0-9._~:/?#@=%+&-]{4,255}$'; CFG_VAL=""
            for x in $v; do
                n=$((n + 1))
                if [ "$n" -gt 20 ] || ! [[ "$x" =~ $re ]]; then CFG_ERR=$(m "$M_CFG_BAD" "$k" "$x" "$M_CFG_CLX"); return 1; fi
                CFG_VAL+="${CFG_VAL:+ }$x"
            done
            return 0 ;;
        SVC_EXTRA)
            local x n=0 re='^[A-Za-z0-9._-]{1,40}[|](https://[A-Za-z0-9._~:/?#@=%+&-]{4,255}|[0-9]{1,3}([.][0-9]{1,3}){3}(/[0-9]{1,2})?)$'; CFG_VAL=""
            for x in $v; do
                n=$((n + 1))
                if [ "$n" -gt 50 ] || ! [[ "$x" =~ $re ]]; then
                    CFG_ERR=$(m "$M_CFG_BAD" "$k" "$x" "$M_CFG_SVCX"); return 1
                fi
                CFG_VAL+="${CFG_VAL:+ }$x"
            done
            return 0 ;;
        ASN_LIST|ASN_ALL)
            v=$(printf '%s' "$v" | tr '[:lower:]' '[:upper:]' | tr -d ' ')
            [[ "$v" =~ ^(AS[0-9]{1,10}(,AS[0-9]{1,10}){0,49})?$ ]] && { CFG_VAL="$v"; return 0; }
            CFG_ERR=$(m "$M_CFG_BAD" "$k" "$v" "$M_CFG_ASN"); return 1 ;;
        ASN_TCP|ASN_UDP|CLOUD_TCP|CLOUD_UDP)
            [[ "$v" =~ ^([0-9]{1,5}(:[0-9]{1,5})?(,[0-9]{1,5}(:[0-9]{1,5})?){0,14})?$ ]] && return 0
            CFG_ERR=$(m "$M_CFG_BAD" "$k" "$v" "$M_CFG_PORTS"); return 1 ;;
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
    [ -n "$base" ] && { PANEL_FOOT="$(m "$M_PANEL_GEN" "$base/")$NL"; PANEL_BASE="$base/"; }
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
# CSF gelişmiş satırı: "tcp|in|d=22,80|s=1.2.3.0/24" (yorum hariç) → ADV_PROTO ADV_DIR ADV_PORTS ADV_CIDR
adv_parse() {
    local s="${1%%#*}" k v f=()
    s="${s//[[:space:]]/}"
    [[ "$s" == *"|"* ]] || return 1
    ADV_PROTO=""; ADV_DIR=""; ADV_PORTS=""; ADV_CIDR=""
    IFS='|' read -ra f <<< "$s"
    ADV_PROTO="${f[0]}"; ADV_DIR="${f[1]}"
    for k in "${f[@]:2}"; do
        v="${k#*=}"
        if [[ "$v" =~ $CIDR4_RE ]]; then ADV_CIDR="$v"
        elif [[ "$k" == [sd]=* ]]; then ADV_PORTS="${ADV_PORTS:+$ADV_PORTS,}$v"; fi
    done
    [[ "$ADV_PROTO" =~ ^[a-z]+$ ]] || ADV_PROTO="?"
    [[ "$ADV_DIR" =~ ^[a-z]+$ ]] || ADV_DIR="?"
    [[ "$ADV_PORTS" =~ ^[0-9,:_-]*$ ]] || ADV_PORTS=""
    [ -n "$ADV_CIDR" ]
}
# /8'den geniş aralık (0.0.0.0/0 gibi): gelişmiş satırda "herkes" demek — sunucu geneli port kuralı,
# belirli bir IP'ye ya da müşteriye ait değil
adv_wide() { [[ "$1" == */* ]] && [ "${1#*/}" -lt 8 ]; }
# csf.deny'deki /23 ve daha geniş aralıklar (bir blok ya da ağın üstündeki ban): tablolar "… içinde" der
wide_load() {
    local i
    WD_LO=(); WD_HI=(); WD_TXT=()
    for i in "${!DC_TXT[@]}"; do
        [ "${DC_TXT[i]#*/}" -le 23 ] || continue
        WD_LO+=("${DC_LO[i]}"); WD_HI+=("${DC_HI[i]}"); WD_TXT+=("${DC_TXT[i]}")
    done
}
under_of() {     # LO HI KENDİSİ → REPLY = kapsayan daha geniş aralık (yoksa boş)
    local i
    REPLY=""
    for i in "${!WD_LO[@]}"; do
        [ "${WD_TXT[i]}" = "$3" ] && continue
        (( WD_LO[i] <= $1 && WD_HI[i] >= $2 )) && { REPLY="${WD_TXT[i]}"; return 0; }
    done
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
    local c0; c0=$(date +%s%N)
    CSF_OUT=$("$CSF_BIN" "$@" 2>&1 9>&-)
    CSF_TN[$1]=$(( ${CSF_TN[$1]:-0} + 1 )); CSF_TMS[$1]=$(( ${CSF_TMS[$1]:-0} + ($(date +%s%N) - c0) / 1000000 ))
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
# ── HTML mail ───────────────────────────────────────────────────────────────
# Bütün mailler HTML + düz metin (multipart/alternative, UTF-8) olarak sendmail'e verilir; HTML
# göstermeyen istemci düz metni gösterir. sendmail ya da base64 yoksa eskisi gibi "mail" ile
# yalnız düz metin gider. Masaüstü Outlook HTML'i Word motoruyla çizer: div boşluklarını ve
# yuvarlak köşeleri yok sayar. Bu yüzden boşluklar hep tablo hücresinde, düğme ve çubuklar tabloyla.
# Başlıktaki ikon maile gömülü PNG (cid:), dışarıdan resim indirilmez.
SENDMAIL_BIN="${SENDMAIL_BIN:-/usr/sbin/sendmail}"
MAIL_ICON="${MAIL_ICON:-$SELF_DIR/whm/assets/mail-icon.png}"
PANEL_BASE=""
H_FONT="-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
H_MONO="Consolas,Menlo,monospace"
H_TH="color:#5f6776;font-size:11px;text-transform:uppercase;letter-spacing:.04em"
H_SP="<tr><td height=\"12\" style=\"height:12px;font-size:0;line-height:0;\">&nbsp;</td></tr>"
h_esc() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; s="${s//\"/&quot;}"; REPLY="$s"; }
h_box() {        # STİL İÇERİK → REPLY = tam genişlikte tek hücre (boşluk Outlook'ta da çalışsın diye td'de)
    REPLY="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"font-family:$H_FONT;$1\">$2</td></tr></table>"
}
h_card() {       # BAŞLIK İÇ_HTML [bad|warn] [ALT_BAŞLIK] → REPLY = kart
    local bd="#e6e8ef" tc="#111827" t out pb=10px
    case "$3" in bad) bd="#fecaca"; tc="#b91c1c" ;; warn) bd="#fde68a"; tc="#b45309" ;; esac
    [ -n "$4" ] && pb=2px
    h_esc "$1"; h_box "padding:14px 18px $pb;font-size:14px;font-weight:700;color:$tc;" "$REPLY"; out="$REPLY"
    if [ -n "$4" ]; then h_esc "$4"; h_box "padding:0 18px 10px;font-size:12px;color:#5f6776;" "$REPLY"; out+="$REPLY"; fi
    out+="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr><td height=\"1\" style=\"height:1px;border-top:1px solid #eef0f3;font-size:0;line-height:0;\">&nbsp;</td></tr></table>"
    REPLY="<tr><td bgcolor=\"#ffffff\" style=\"background:#ffffff;border:1px solid $bd;border-radius:12px;\">$out$2</td></tr>$H_SP"
}
h_bar() {        # YÜZDE RENK → REPLY = 8 px yüksekliğinde doluluk çubuğu (iki hücre)
    local pc="$1" c=""
    [ "$pc" -gt 100 ] && pc=100
    [ "$pc" -gt 0 ] && c+="<td width=\"$pc%\" bgcolor=\"$2\" style=\"background:$2;height:8px;font-size:0;line-height:0;\">&nbsp;</td>"
    [ "$pc" -lt 100 ] && c+="<td bgcolor=\"#f3f4f6\" style=\"background:#f3f4f6;height:8px;font-size:0;line-height:0;\">&nbsp;</td>"
    REPLY="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>$c</tr></table>"
}
h_usage() {      # KALICI_DOLU KALICI_SINIR GEÇİCİ_DOLU GEÇİCİ_SINIR [7_GÜN_ÖNCE] → REPLY = doluluk kartı
    local out="" i used lim lab pc col note pt
    for i in 1 2; do
        if [ "$i" = 1 ]; then used=$(num "$1"); lim=$(num "$2"); lab="$M_H_PERM"; col="#4338ca"; note="${5:+ · $(m "$M_H_AGO" "$5")}"
        else used=$(num "$3"); lim=$(num "$4"); lab="$M_H_TEMP"; col="#b45309"; note=""; fi
        [ "$lim" -gt 0 ] || continue
        pt=0; [ -n "$out" ] && pt=14px
        pc=$(( used * 100 / lim )); [ "$pc" -ge 80 ] && col="#b91c1c"
        [ "$pc" -lt 1 ] && [ "$used" -gt 0 ] && pc=1
        out+="<tr><td style=\"font-family:$H_FONT;font-size:13px;font-weight:600;padding:$pt 0 6px;\">$lab</td><td align=\"right\" style=\"font-family:$H_FONT;font-size:13px;color:#4b5563;padding:$pt 0 6px;\">$(m "$M_H_LINES" "$used" "$lim" "$(( used * 100 / lim ))")<span style=\"color:#5f6776;\">$note</span></td></tr>"
        h_bar "$pc" "$col"; out+="<tr><td colspan=\"2\">$REPLY</td></tr>"
    done
    REPLY=""
    [ -n "$out" ] && REPLY="<tr><td bgcolor=\"#ffffff\" style=\"background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;padding:16px 18px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">$out</table></td></tr>$H_SP"
}
h_doc() {        # BAŞLIK ALT_BAŞLIK GÖVDE(kart satırları) → REPLY = tam belge
    local t s foot="" ic
    h_esc "$1"; t="$REPLY"; h_esc "$2"; s="$REPLY"
    if [ -r "$MAIL_ICON" ]; then ic="<img src=\"cid:agicon\" width=\"40\" height=\"40\" alt=\"\" style=\"display:block;border:0;width:40px;height:40px;\">"
    else ic="<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr><td width=\"40\" height=\"40\" bgcolor=\"#4338ca\" style=\"background:#4338ca;border-radius:11px;font-size:0;\">&nbsp;</td></tr></table>"; fi
    if [ -n "$PANEL_BASE" ]; then
        h_esc "$PANEL_BASE"
        foot="<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" align=\"center\"><tr><td bgcolor=\"#4338ca\" style=\"background:#4338ca;border-radius:9px;padding:10px 20px;\"><a href=\"$REPLY\" style=\"font-family:$H_FONT;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;\">$M_H_PANEL</a></td></tr></table>"
        h_box "padding:10px 0 0;font-size:12px;color:#5f6776;text-align:center;" "$M_H_PANELP · v$VERSION"; foot+="$REPLY"
        h_esc "$M_H_GLOSS"; h_box "padding:6px 0 0;font-size:11px;color:#9aa1ad;text-align:center;" "$REPLY"; foot+="$REPLY"
    else
        h_box "font-size:12px;color:#5f6776;text-align:center;" "CSF Auto-Group v$VERSION"; foot="$REPLY"
        h_esc "$M_H_GLOSS"; h_box "padding:6px 0 0;font-size:11px;color:#9aa1ad;text-align:center;" "$REPLY"; foot+="$REPLY"
    fi
    REPLY="<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>$t</title><style>td,div,span,a,b{font-family:$H_FONT;}</style></head>"
    REPLY+="<body style=\"margin:0;padding:0;background:#f4f5f9;font-family:$H_FONT;color:#111827;\" bgcolor=\"#f4f5f9\">"
    REPLY+="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" bgcolor=\"#f4f5f9\" style=\"background:#f4f5f9;\"><tr><td align=\"center\" style=\"padding:24px 12px;\">"
    REPLY+="<table role=\"presentation\" width=\"640\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:640px;width:100%;\">"
    REPLY+="<tr><td style=\"padding:0 4px 16px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>"
    REPLY+="<td width=\"40\" valign=\"middle\">$ic</td>"
    REPLY+="<td valign=\"middle\" style=\"padding-left:12px;font-family:$H_FONT;\"><div style=\"font-size:18px;font-weight:700;color:#111827;\">$t</div><div style=\"font-size:13px;color:#5f6776;\">$s</div></td></tr></table></td></tr>"
    REPLY+="$3<tr><td align=\"center\" style=\"padding:8px 4px 4px;\">$foot</td></tr></table></td></tr></table></body></html>"
}
h_text() {       # BÖLÜM_METNİ → REPLY = kartın içi. Uyarı mailinin metin biçimini okur:
    # giriş paragrafı · "BLOK -> açıklama" başlıkları · "   Sahibi:/Not:" satırları · "   - IP  host  [sahip]  sebep  [etiket]"
    REPLY=$(printf '%s\n' "$1" | awk -v tk="[$M_TAG_KEPT]" -v tf="[$M_TAG_FAIL]" -v hi="$M_H_IP" -v hh="$M_H_HOST" -v hw="$M_H_WHY" \
                                     -v more="$M_H_MORE" -v mono="$H_MONO" -v ff="$H_FONT" '
        function esc(s) { gsub(/&/, "\\&amp;", s); gsub(/</, "\\&lt;", s); gsub(/>/, "\\&gt;", s); gsub(/"/, "\\&quot;", s); return s }
        function box(st, c) { return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"font-family:" ff ";" st "\">" c "</td></tr></table>" }
        function closet() { if (tb) { o = o "</table>"; tb = 0 } }
        function closeb() { closet(); if (inb) { o = o box("height:10px;font-size:0;line-height:0;", "&nbsp;"); inb = 0 } }
        function opent() { if (!tb) { o = o "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr><td width=\"130\" style=\"font-family:" ff ";padding:8px 8px 4px 18px;color:#5f6776;font-size:11px;text-transform:uppercase;letter-spacing:.04em;\">" hi "</td><td width=\"30%\" style=\"font-family:" ff ";padding:8px 8px 4px;color:#5f6776;font-size:11px;text-transform:uppercase;letter-spacing:.04em;\">" hh "</td><td style=\"font-family:" ff ";padding:8px 18px 4px 8px;color:#5f6776;font-size:11px;text-transform:uppercase;letter-spacing:.04em;\">" hw "</td></tr>"; tb = 1; zr = 0 } }
        BEGIN { intro = 1; o = ""; ip = "" }
        {
            l = $0; sub(/\r$/, "", l)
            if (l ~ /^[ \t]*$/) { if (intro && ip != "") { o = o box("padding:12px 18px 4px;font-size:13px;color:#4b5563;line-height:1.5;", ip); ip = "" } intro = 0; closeb(); next }
            if (intro) { ip = ip (ip != "" ? "<br>" : "") esc(l); next }
            if (l ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+ -> /) {
                closeb(); inb = 1; i = index(l, " -> ")
                o = o box("padding:10px 18px 0;", "<span style=\"font-family:" mono ";font-size:14px;font-weight:700;color:#111827;\">" esc(substr(l, 1, i - 1)) "</span> <span style=\"font-size:13px;color:#4b5563;\">" esc(substr(l, i + 4)) "</span>")
                next }
            if (l ~ /^   - /) {
                inb = 1; opent(); s = substr(l, 6); n = split(s, f, /  +/)
                own = ""; why = ""; tag = ""
                for (k = 3; k <= n; k++) {
                    if (f[k] ~ /^\[/) { if (f[k] == tk || f[k] == tf) tag = f[k]; else own = f[k] }
                    else why = why (why != "" ? "  " : "") f[k] }
                h = (f[2] == "-" || f[2] == "") ? "<span style=\"color:#9aa1ad;\">—</span>" : esc(f[2])
                if (own != "") h = h "<br><span style=\"font-size:11.5px;color:#5f6776;\">" esc(substr(own, 2, length(own) - 2)) "</span>"
                w = esc(why)
                if (tag != "") w = w " <span style=\"background:" (tag == tf ? "#fef2f2;color:#b91c1c" : "#f3f4f6;color:#4b5563") ";font-size:11px;white-space:nowrap;\">&nbsp;" esc(substr(tag, 2, length(tag) - 2)) "&nbsp;</span>"
                bg = (zr % 2) ? " bgcolor=\"#f7f8fa\"" : ""
                o = o "<tr><td valign=\"top\"" bg " style=\"padding:6px 8px 6px 18px;font-family:" mono ";font-size:12.5px;color:#4338ca;white-space:nowrap;\">" esc(f[1]) "</td><td valign=\"top\"" bg " style=\"padding:6px 8px;font-family:" ff ";font-size:12.5px;color:#4b5563;word-break:break-all;\">" h "</td><td valign=\"top\"" bg " style=\"padding:6px 18px 6px 8px;font-family:" ff ";font-size:12.5px;color:#111827;\">" w "</td></tr>"
                zr++; next }
            if (l ~ /^   \(\+[0-9]+\)/) { inb = 1; opent(); m2 = l; gsub(/[^0-9]/, "", m2); o = o "<tr><td colspan=\"3\" style=\"padding:6px 18px;font-family:" ff ";color:#5f6776;font-size:12px;\">" sprintf(more, m2) "</td></tr>"; next }
            if (l ~ /^  - /) { closet(); o = o box("padding:4px 18px;font-size:13px;", "&#8226; " esc(substr(l, 5))); next }
            if (l ~ /^   /) { closet(); sub(/^ +/, "", l); o = o box("padding:3px 18px 0;font-size:12.5px;color:#5f6776;", esc(l)); next }
            closeb(); o = o box("padding:8px 18px;font-size:13px;", esc(l))
        }
        END { if (intro && ip != "") o = o box("padding:12px 18px 12px;font-size:13px;color:#4b5563;line-height:1.5;", ip); closeb(); print o box("height:8px;font-size:0;line-height:0;", "&nbsp;") }')
}
h_subj() {       # KONU → REPLY = RFC 2047 kodlu konu (kelime sınırında ~40 baytlık parçalar, katlanmış)
    local LC_ALL=C IFS=$' \t\n' w chunk="" out="" words
    read -ra words <<< "$1"
    for w in "${words[@]}"; do
        if [ -n "$chunk" ] && [ $(( ${#chunk} + ${#w} + 1 )) -gt 40 ]; then
            out+="${out:+$NL }=?UTF-8?B?$(printf '%s' "$chunk" | base64 -w0)?="; chunk=" $w"
        else chunk+="${chunk:+ }$w"; fi
    done
    [ -n "$chunk" ] && out+="${out:+$NL }=?UTF-8?B?$(printf '%s' "$chunk" | base64 -w0)?="
    REPLY="$out"
}
# ── Slack (WHM'de tanımlı adres) ────────────────────────────────────────────
# Adres her gönderimde WHM'in dosyasından okunur, eklentide saklanmaz. cPanel'in kendi gönderici altyapısı
# (iContact) "e-posta hariç" seçeneği sunmadığı için kullanılmaz: e-posta zaten bizim HTML mailimizden gidiyor,
# iContact aynı olayı WHM'in e-posta kanalına da gönderip çift mail üretirdi (sunucuda iContact.pm ile doğrulandı).
slack_url() {    # → REPLY = WHM'deki Slack adresi (yalnız https://hooks.slack.com/ ile başlıyorsa), yoksa boş
    REPLY=$(awk '$1 == "CONTACTSLACK" { print $2; exit }' "$WWWACCT_SHADOW" 2>/dev/null)
    [[ "$REPLY" =~ ^https://hooks\.slack\.com/[A-Za-z0-9/_-]+$ ]] || REPLY=""
}
slack_esc() {    # METİN → REPLY: Slack biçimi için & < > kaçışlanır, JSON için \ " ve satır sonu \n olur
    local t="$1"
    t="${t//&/&amp;}"; t="${t//</&lt;}"; t="${t//>/&gt;}"
    t="${t//\\/\\\\}"; t="${t//\"/\\\"}"; t="${t//$'\r'/}"; t="${t//$'\t'/  }"; t="${t//$'\n'/\\n}"; t="${t//[[:cntrl:]]/ }"
    REPLY="$t"
}
slack_send() {   # KONU METİN [RENK] → 0 gönderildi. Adres komut satırına yazılmaz (ps'te görünmesin): curl -K - ile stdin'den
    # WHM'in kendi Slack mesajları gibi: solda renkli çizgili kart (attachment); bildirimde "fallback" görünür
    local url tmp rc col="${3:-#4338ca}" ttl body fb
    slack_url; url="$REPLY"
    [ -n "$url" ] || { IC_OUT="$M_IC_NOSLACK"; return 1; }
    command -v curl >/dev/null 2>&1 || { IC_OUT="curl yok"; return 1; }
    tmp=$(mktemp) || return 1; chmod 600 "$tmp"
    slack_esc "*[$(hostname 2>/dev/null || echo "$HOSTNAME")] $1*"; ttl="$REPLY"
    slack_esc "$2"; body="$REPLY"
    slack_esc "[$(hostname 2>/dev/null || echo "$HOSTNAME")] $1"; fb="$REPLY"
    [[ "$col" =~ ^#[0-9a-fA-F]{6}$ ]] || col="#4338ca"
    printf '{"attachments":[{"color":"%s","fallback":"%s","text":"%s\\n%s","mrkdwn_in":["text"]}]}' "$col" "$fb" "$ttl" "$body" > "$tmp"
    IC_OUT=$(printf 'url = "%s"\n' "$url" | curl -sS -m 20 -X POST -H 'Content-Type: application/json' --data-binary "@$tmp" -K - 2>&1 9>&-); rc=$?
    rm -f "$tmp"
    [ "$rc" = 0 ] && [ "$IC_OUT" = ok ] && return 0
    [ "$rc" = 0 ] && rc=1
    return $rc
}
ic_send() {      # OLAY KONU METİN → 0 gönderildi (IC_OUT = çıktı). Olay adı şimdilik yalnız günlük için.
    local subj="[CSF Auto-Group] $2" txt="$3" rc
    if [ "$DRY" = 1 ]; then echo "      [dry-run] Slack: $subj"; return 0; fi
    subj="${subj//[$'\r\n\f']/ }"
    (( ${#txt} > 3500 )) && txt="${txt:0:3500} …"
    # renk: sorun kırmızı (geçici liste turuncu), düzeldi yeşil, diğerleri lacivert
    local col="#4338ca"
    case "$1" in *Resolved) col="#047857" ;; ListTemp) col="#b45309" ;; Firewall|ListPerm) col="#b91c1c" ;; esac
    slack_send "$subj" "$txt" "$col"; rc=$?
    [ "$rc" = 0 ] || log "$(m "$M_IC_FAIL" "${IC_OUT%%$NL*}")"
    return $rc
}
slack_on() { [ "$NOTIFY" != email ]; }   # Slack kanalı seçili mi (all | slack)
# Tur bildirimleri kuyruğa yazılır, SLACK_BATCH_MIN dakikada en fazla bir mesajda toplanıp gönderilir (kanal
# kalabalıklaşmasın). Kayıt ayırıcı \036; gönderim başarısızsa kuyruk kalır, sonraki turda yeniden denenir.
slack_queue_add() { [ "$DRY" = 1 ] && return 0; printf '%s\n%s\n\036\n' "$1" "$2" >> "$SLACK_QUEUE" 2>/dev/null; }
slack_queue_flush() {
    [ "$DRY" = 1 ] && return 0
    [ -s "$SLACK_QUEUE" ] || return 0
    local now last n subj txt
    now=$(date +%s); last=$(cat "$SLACK_LAST" 2>/dev/null); [[ "$last" =~ ^[0-9]+$ ]] || last=0
    [ $(( now - last )) -ge $(( $(num "$SLACK_BATCH_MIN") * 60 )) ] || return 0
    n=$(grep -c $'^\036$' "$SLACK_QUEUE")
    subj=$(awk 'BEGIN { RS = "\036\n" } NF { split($0, a, "\n"); s = s (s != "" ? " · " : "") a[1] } END { print s }' "$SLACK_QUEUE")
    txt=$(awk 'BEGIN { RS = "\036\n" } NF { i = index($0, "\n"); t = t (t != "" ? "\n\n" : "") substr($0, i + 1) } END { printf "%s", t }' "$SLACK_QUEUE")
    [ "$n" -gt 1 ] && subj="$(m "$M_SQ_SUBJ" "$n" "$SLACK_BATCH_MIN"): $subj"
    (( ${#subj} > 180 )) && subj="${subj:0:177}..."
    if ic_send Run "$subj" "$txt"; then : > "$SLACK_QUEUE"; echo "$now" > "$SLACK_LAST"; fi
}
mail_on()  { [ "$NOTIFY" != slack ]; }   # e-posta kanalı seçili mi (all | email)
ic_track() {     # AYAR DURUM_ANAHTARI SORUN(1|0) KONU METİN DÜZELDİ_KONUSU — başlayınca bir kez, düzelince bir kez
    slack_on && [ "${!1}" = 1 ] && [ "$DRY" != 1 ] || return 0
    slack_url; [ -n "$REPLY" ] || return 0
    local had=0 tmp="$IC_STATE_FILE.tmp.$$"
    grep -qx "$2" "$IC_STATE_FILE" 2>/dev/null && had=1
    if [ "$3" = 1 ] && [ "$had" = 0 ]; then ic_send "$2" "$4" "$5" || return 0
    elif [ "$3" = 0 ] && [ "$had" = 1 ]; then ic_send "${2}Resolved" "$6" "$6" || return 0
    else return 0; fi
    # durum ancak gönderim başarılıysa değişir: başarısızsa sonraki turda yeniden denenir
    { grep -vx "$2" "$IC_STATE_FILE" 2>/dev/null; if [ "$3" = 1 ]; then echo "$2"; fi; true; } > "$tmp" && mv -f "$tmp" "$IC_STATE_FILE"
    rm -f "$tmp"
}
mail_to() {      # → REPLY = uyarı maillerinin adresi (ALERT_MAIL=whm: WHM → Basic WebHost Manager Setup'taki iletişim adresi)
    REPLY="$ALERT_MAIL"
    if [ "$ALERT_MAIL" = whm ]; then
        REPLY=$(awk '$1 == "CONTACTEMAIL" { $1 = ""; print; exit }' "$WWWACCT_CONF" 2>/dev/null)
        REPLY="${REPLY//[[:space:]]/}"
        [[ "$REPLY" =~ ^[A-Za-z0-9._%+@,-]+$ ]] || REPLY="root@localhost"
    fi
}
send_mail() {    # KONU DÜZ_METİN [HTML] → çıkış kodu; SM_OUT = komutun çıktısı
    local b r rc icon=0
    mail_to; SM_TO="$REPLY"
    # kuru çalıştırma: gönderme, düz metni göster (mail() sarmalayıcısı)
    if [ "$DRY" = 1 ]; then printf '%s\n' "$2" | mail -s "$1" "$SM_TO"; SM_OUT=""; return 0; fi
    if [ -n "$3" ] && [ -x "$SENDMAIL_BIN" ] && command -v base64 >/dev/null 2>&1; then
        b="=_csfag_a_$(date +%s)_$$"; r="=_csfag_r_$(date +%s)_$$"; h_subj "$1"
        [[ "$3" == *cid:agicon* ]] && [ -r "$MAIL_ICON" ] && icon=1
        # yapı: multipart/related [ multipart/alternative (metin, HTML) + ikon ] — ikon yoksa yalnız alternative
        SM_OUT=$( { printf 'To: %s\nSubject: %s\nMIME-Version: 1.0\nX-Mailer: CSF Auto-Group %s\n' "$SM_TO" "$REPLY" "$VERSION"
                    if [ "$icon" = 1 ]; then
                        printf 'Content-Type: multipart/related; type="multipart/alternative"; boundary="%s"\n\n--%s\n' "$r" "$r"
                    fi
                    printf 'Content-Type: multipart/alternative; boundary="%s"\n\n' "$b"
                    printf -- '--%s\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n' "$b"
                    printf '%s\n' "$2" | base64
                    printf -- '--%s\nContent-Type: text/html; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n' "$b"
                    printf '%s\n' "$3" | base64
                    printf -- '--%s--\n' "$b"
                    if [ "$icon" = 1 ]; then
                        printf -- '\n--%s\nContent-Type: image/png; name="csf-autogroup.png"\nContent-Transfer-Encoding: base64\nContent-ID: <agicon>\nContent-Disposition: inline; filename="csf-autogroup.png"\n\n' "$r"
                        base64 < "$MAIL_ICON"
                        printf -- '--%s--\n' "$r"
                    fi; } | "$SENDMAIL_BIN" -t -i 2>&1 9>&-); rc=$?
    else
        SM_OUT=$(printf '%s\n' "$2" | mail -s "$1" "$SM_TO" 2>&1); rc=$?
    fi
    return $rc
}
# Tek mail: tur içindeki tüm bildirimler (blok banları, şüpheli ağlar, atlamalar, limit, sağlık) tek
# mailde bölüm bölüm gider; konu satırı bölümlerin özetidir.
MAIL_PARTS=(); MAIL_BODY=""; MAIL_URGENT=0; MAIL_TEXTS=(); MAIL_TONES=()
mail_add() {     # KONU-PARÇASI GÖVDE [bad] (bad: HTML'de kırmızı kart — liste doluyor, güvenlik duvarı sorunu)
    MAIL_PARTS+=("$1"); MAIL_TEXTS+=("$2"); MAIL_TONES+=("${3:-}")
    MAIL_BODY+="${MAIL_BODY:+$NL────────────────────────────────────────$NL$NL}$2$NL"
}
mail_flush() {
    [ ${#MAIL_PARTS[@]} -gt 0 ] || return 0
    local subj="" pp i txt html="" hs
    for pp in "${MAIL_PARTS[@]}"; do subj+="${subj:+ · }$pp"; done
    txt=$( printf '%s\n' "$MAIL_BODY"
           [ -n "$doluluk_satiri" ] && printf '%s\n' "$doluluk_satiri"
           [ -n "$temp_doluluk_satiri" ] && printf '%s\n' "$temp_doluluk_satiri"
           printf '\n%s%s\n%s\n' "$PANEL_FOOT" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" "$M_H_GLOSS" )
    # HTML: her bölüm bir kart, altta liste doluluğu
    for i in "${!MAIL_PARTS[@]}"; do
        h_text "${MAIL_TEXTS[i]}"; h_card "${MAIL_PARTS[i]}" "$REPLY" "${MAIL_TONES[i]}"; html+="$REPLY"
    done
    h_usage "${current_count:-0}" "${limit:-0}" "${temp_current:-0}" "${temp_limit:-0}"; html+="$REPLY"
    printf -v hs '%s · %(%d.%m.%Y %H:%M)T' "$(hostname 2>/dev/null || echo "$HOSTNAME")" -1
    h_doc "CSF Auto-Group" "$hs" "$html"
    mail_on && send_mail "$([ "$MAIL_URGENT" = 1 ] && printf '!!! ')$M_SUBJ_PREFIX$subj" "$txt" "$REPLY"
    if slack_on && [ "$IC_RUN" = 1 ]; then
        local rs="" rt=""
        for i in "${!MAIL_PARTS[@]}"; do
            [ "${MAIL_TONES[i]}" = bad ] && continue
            rs+="${rs:+ · }${MAIL_PARTS[i]}"; rt+="${rt:+$NL$NL}${MAIL_TEXTS[i]}"
        done
        [ -n "$rs" ] && slack_queue_add "$rs" "$rt"
    fi
    MAIL_PARTS=(); MAIL_BODY=""; MAIL_URGENT=0; MAIL_TEXTS=(); MAIL_TONES=()
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
        is_dnd "$line" && continue                           # do not delete (tekrar gelip kalıcıya alınan / elle işaretlenen) korunur
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
# görünebiliyor (sunucuda görüldü). → H_CSF: ok|off|testing|norules|unknown, H_LFD: ok|down,
# H_LFDAGE: lfd kaç saniyedir çalışıyor (-1 bilinmiyor). lfd yeni başlamışken ülke/ASN kümeleri boştur, dolması sürer;
# panel o arada "boş" yerine "yükleniyor" der.
health_check() {
    local pid="" ipt
    H_CSF=ok; H_LFD=down; H_LFDAGE=-1
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
    elif command -v pgrep >/dev/null 2>&1 && pgrep -f '^lfd' >/dev/null 2>&1; then H_LFD=ok; pid=$(pgrep -of '^lfd' 2>/dev/null)
    fi
    if [ "$H_LFD" = ok ] && [[ "$pid" =~ ^[0-9]+$ ]]; then
        H_LFDAGE=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
        [[ "$H_LFDAGE" =~ ^[0-9]+$ ]] || H_LFDAGE=-1
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
        OWN_P[$p]=$(printf '%s' "$txt" | cut -d'|' -f2 | tr -d ' '); [[ "${OWN_P[$p]}" =~ ^[0-9.]+/[0-9]{1,2}$ ]] || OWN_P[$p]=
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
declare -A OWN_N OWN_T OWN_NEW OWN_P      # OWN_P: /24'ün sahibinin duyurduğu aralık (Team Cymru)
owners_load() {
    local p asn cc name t min
    [ -r "$OWNERS_FILE" ] || return 0
    min=$(( $(date +%s) - OWNER_TTL_DAYS * 86400 ))
    while IFS='|' read -r p asn cc name t pf; do
        [[ "$p" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || continue
        [[ "$t" =~ ^[0-9]+$ ]] && [ "$t" -ge "$min" ] || continue
        OWN_A[$p]="$asn"; OWN_C[$p]="$cc"; OWN_N[$p]="$name"; OWN_T[$p]="$t"; OWN_P[$p]="$pf"
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
        printf '%s|%s|%s|%s|%s|%s\n' "$p" "${OWN_A[$p]}" "${OWN_C[$p]}" "${OWN_N[$p]//|/ }" "${OWN_T[$p]}" "${OWN_P[$p]}"
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
    r="${r#"${r%%[![:space:]]*}"}"; r="${r#\#}"; r="${r#"${r%%[![:space:]]*}"}"; r="${r#lfd: }"; r="${r#lfd - }"
    r="${r% - [A-Z][a-z][a-z] [A-Z][a-z][a-z] *}"
    [[ "$r" == *"$2"* ]] && [ -n "${r%%"$2"*}" ] && r="${r%%"$2"*}"
    r="${r%"${r##*[![:space:]]}"}"
    for w in " from" " by" " for" ":" " -"; do [[ "$r" == *"$w" ]] && r="${r%"$w"}"; done
    r="${r%"${r##*[![:space:]]}"}"
    # "(mod_security) mod_security (id:1302) triggered" → "ModSecurity 1302: WP LOGIN VIEW RATE LIMIT: …"
    if [[ "$r" =~ mod_security\ \(id:([0-9]+)\) ]]; then
        w="${BASH_REMATCH[1]}"; modsec_msg "$w"
        r="ModSecurity $w${REPLY:+: $REPLY}"
    fi
    (( ${#r} > 100 )) && r="${r:0:97}..."
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
        local q="${1%.*}" a b c d
        if [ "$OWN_UNK" = 0 ] && [ -n "$OWN_ASN" ] && [ -z "${OWN_P[$q]}" ]; then
            IFS=. read -r a b c d <<< "$1"
            if dns_q TXT "$d.$c.$b.$a.origin.asn.cymru.com"; then
                OWN_P[$q]=$(printf '%s' "${REPLY%%$NL*}" | cut -d'|' -f2 | tr -d ' '); [[ "${OWN_P[$q]}" =~ ^[0-9.]+/[0-9]{1,2}$ ]] || OWN_P[$q]=""
                OWN_NEW[$q]=1
            fi
        fi
        jstr "$OWN_LONG"; IPJ+=",\"owner\":$REPLY,\"asn\":\"$OWN_ASN\",\"cc\":\"$OWN_CC\",\"pfx\":\"${OWN_P[$q]}\""
    fi
    IPJ+="}"
    [ -n "$why" ] && out+="  $why"
    REPLY="$out"
}
ip_lines() {     # "IP IP ..." KIND(perm|temp|mix) WITH_OWNER → REPLY; tekrarsız, sıralı, ilk 40, fazlası "(+N)"
    local all ip n=0 total out="" note js=""
    all=$(printf '%s\n' $1 | grep -E "$IPV4_RE" | sort -Vu)
    total=$(printf '%s\n' "$all" | grep -c .)
    for ip in $all; do
        [ "$n" -ge 40 ] && break; n=$((n + 1))
        case "$2" in temp) note="${TNOTE[$ip]}" ;; mix) note="${SINGLE_NOTE[$ip]:-${TNOTE[$ip]}}" ;; *) note="${SINGLE_NOTE[$ip]}" ;; esac
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
# ── ModSecurity kural mesajı ────────────────────────────────────────────────
# lfd sebebi yalnız "mod_security (id:1302) triggered" diyor. Mesaj cPanel'in eşleşme kaydında
# (WHM → ModSecurity Araçları → Uyuşanlar Listesi ile aynı kaynak; Imunify kuralları dahil).
# Salt okunur sorgu, sonuç 7 gün önbellekte ("NO|zaman|mesaj"); bulunamayan tur içinde bir kez sorulur.
declare -A MS_MSG=() MS_DONE=(); MS_LOADED=0
modsec_file_msg() { # KURAL_NO → REPLY; yedek yol: ModSecurity günlüğünde kuralın satırı → mesaj ya da kural dosyası
    local id="$1" log line f
    REPLY=""
    log=$(conf_val MODSEC_LOG); [ -r "$log" ] || return
    line=$(grep -m1 -F "[id \"$id\"]" "$log" 2>/dev/null)
    [ -n "$line" ] || return
    # Apache biçimi mesajı satırda taşır: [msg "..."]
    if [[ "$line" =~ \[msg\ \"([^\"]*)\"\] ]]; then REPLY="${BASH_REMATCH[1]}"; return; fi
    # LiteSpeed biçimi yalnız yeri verir: ... rule [id "1302"] at [/etc/.../modsec2.user.conf:88] triggered!
    f=$(printf '%s\n' "$line" | sed -n 's/.*\] at \[\(\/[^]]*\):[0-9]*\].*/\1/p')
    [ -r "$f" ] || { [[ "$line" =~ \[file\ \"([^\"]*)\"\] ]] && f="${BASH_REMATCH[1]}"; }
    [ -r "$f" ] || return
    # Kural dosyası: ters bölüyle süren satırlar birleştirilir, id'yi içeren kuralın msg:'...' alanı alınır
    REPLY=$(awk -v id="$id" -v q="'" '
        { l = $0; sub(/\r$/, "", l); buf = (buf == "" ? l : buf " " l)
          if (l ~ /\\[ \t]*$/) { sub(/\\[ \t]*$/, "", buf); next }
          if (buf ~ ("id:[ \t]*" id "([^0-9]|$)")) {
              if (match(buf, "msg:" q "[^" q "]*" q)) print substr(buf, RSTART + 5, RLENGTH - 6)
              else if (match(buf, /msg:"[^"]*"/)) print substr(buf, RSTART + 5, RLENGTH - 6)
              exit }
          buf = "" }' "$f" 2>/dev/null)
}
modsec_msg() {   # KURAL_NO → REPLY = mesaj (yoksa boş)
    local id="$1" now t m line
    REPLY=""
    [[ "$id" =~ ^[0-9]{1,12}$ ]] || return
    now=$(date +%s)
    if [ "$MS_LOADED" = 0 ]; then
        MS_LOADED=1
        if [ -r "$MODSEC_CACHE" ]; then
            # bulunan mesaj 7 gün, bulunamayan 1 gün geçerli (günlük her turda baştan taranmasın)
            while IFS='|' read -r line t m; do
                [[ "$line" =~ ^[0-9]+$ && "$t" =~ ^[0-9]+$ ]] || continue
                if [ -n "$m" ]; then [ $(( now - t )) -lt 604800 ] || continue
                else [ $(( now - t )) -lt 86400 ] || continue; fi
                MS_MSG[$line]="$m"; MS_DONE[$line]=1
            done < "$MODSEC_CACHE"
        fi
    fi
    if [ -z "${MS_DONE[$id]}" ]; then
        MS_DONE[$id]=1; m=""
        if [ -r "$MODSEC_DB" ] && command -v sqlite3 >/dev/null 2>&1; then
            m=$(timeout 10 sqlite3 -readonly "$MODSEC_DB" "SELECT meta_msg FROM hits WHERE meta_id=$id AND meta_msg IS NOT NULL AND meta_msg <> '' ORDER BY id DESC LIMIT 1;" 2>/dev/null 9>&- | awk 'NR == 1')
        fi
        [ -z "$m" ] && { modsec_file_msg "$id"; m="$REPLY"; }
        m="${m%%||*}"; m="${m//|//}"; m="${m%"${m##*[![:space:]]}"}"
        MS_MSG[$id]="$m"
        { [ -r "$MODSEC_CACHE" ] && grep -v "^$id|" "$MODSEC_CACHE" | tail -n 499; printf '%s|%s|%s\n' "$id" "$now" "$m"; } > "$MODSEC_CACHE.tmp.$$" 2>/dev/null \
            && mv -f "$MODSEC_CACHE.tmp.$$" "$MODSEC_CACHE"
        rm -f "$MODSEC_CACHE.tmp.$$"
    fi
    REPLY="${MS_MSG[$id]}"
}
conf_val() { grep -E "^[[:space:]]*$1[[:space:]]*=" "$CSF_CONF" | tail -1 | cut -d= -f2- | tr -d ' "\r'; }
wl_add() {       # CIDR LABEL
    cidr_range "$1" || return
    WL_LO+=("$R_LO"); WL_HI+=("$R_HI"); WL_TXT+=("$2")
}
wl_load() {      # FILE LABEL [DEPTH] — IP, CIDR, gelişmiş satır (tcp|in|d=22|s=IP), Include
    local file="$1" label="$2" depth="${3:-0}" line tok rest mt ip
    [ -r "$file" ] || return
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        # eklentinin kendi port istisnası (banlı aralıkta seçilen servisler açık) korunan kayıt değil. Yalnız o atlanır:
        # izinli servisler ("# csf_autogroup: service google-common", csf_autogroup.services.allow Include'u) CSF'te gerçek
        # izindir — önce "csf_autogroup" geçen her satır atlanıyor, Googlebot vb. beyaz liste sayılmıyordu.
        [[ "$line" == *"csf_autogroup: exception"* ]] && continue
        local svn=""; [[ "$line" =~ csf_autogroup:\ service\ ([A-Za-z0-9_-]+) ]] && svn=" (${BASH_REMATCH[1]})"
        line="${line%%#*}"; line="${line#"${line%%[![:space:]]*}"}"
        [ -z "$line" ] && continue
        if [[ "$line" =~ ^Include[[:space:]]+([^[:space:]]+) ]]; then
            # Include edilen dosyanın adı etikete eklenir: kayıt ana dosyada görünmez (ör. "csf.allow → imunify360.txt")
            [ "$depth" -lt 5 ] && wl_load "${BASH_REMATCH[1]}" "$label → ${BASH_REMATCH[1]##*/}" $((depth + 1)); continue
        fi
        tok="${line%%[[:space:]]*}"; rest="$tok"; mt=0
        # Gelişmiş satır yalnız bir portu açar (tcp|in|d=2083|s=IP): tek IP / dar aralık bilinen bir müşteri
        # sayılır (blok banı onu da keserdi), "herkese" açan geniş satır (s=0.0.0.0/0) ise beyaz liste değildir
        if [[ "$tok" == *"|"* ]]; then
            adv_parse "$tok" || continue
            adv_wide "$ADV_CIDR" && continue
            wl_add "$ADV_CIDR" "$label ($ADV_PROTO $ADV_DIR ${ADV_PORTS:-*}): $ADV_CIDR"
            continue
        fi
        while [[ "$rest" =~ ([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(/[0-9]{1,2})?) ]]; do
            ip="${BASH_REMATCH[1]}"          # wl_add içindeki regex BASH_REMATCH'i ezer
            rest="${rest#*"$ip"}"
            wl_add "$ip" "$label$svn: $ip"; mt=1
        done
        # csf.allow'da hostname olabilir → çöz
        if [ "$mt" = 0 ] && [[ "$label" == csf.allow* ]] && [[ "$tok" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]] && [[ "$tok" =~ [A-Za-z] ]]; then
            resolve_a "$tok"
            for ip in $REPLY; do wl_add "$ip" "$label: $tok ($ip)"; done
        fi
    done < "$file"
}
rig_match() {    # HOST(küçük harf) IP → 0: bir csf.rignore kaydıyla eşleşti ve ileri yönde doğrulandı (REPLY = kayıt),
    # 1: eşleşmedi, 2: eşleşti ama ileri sorgu cevapsız. lfd ile aynı eşleme (lfd.pl ignoreip): noktalı kayıt SONA bağlı
    # düzenli ifade (".googlebot.com" da ".*\.googlebot\.com$" da çalışır), noktasız kayıt tam eşitlik.
    local host="$1" ip="$2" d re unk=0
    for d in "${RIGNORE[@]}"; do
        d=$(printf '%s' "$d" | LC_ALL=C tr '[:upper:]' '[:lower:]')
        re="${d}\$"
        if [ "$host" = "$d" ] || { [[ "$d" == *.* ]] && [[ "$host" =~ $re ]]; }; then
            resolve_a "$host" || { unk=1; continue; }
            if printf '%s\n' "$REPLY" | grep -qxF "$ip"; then REPLY="$d"; return 0; fi
        fi
    done
    REPLY=""; [ "$unk" = 1 ] && return 2; return 1
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
self_overlap() { # LO HI → aralıkta sunucunun kendi IP'si var mı (SELF_HIT); "yine de banla" ile de geçilmez
    local i
    SELF_HIT=""
    [ "$WL_LOADED" = 1 ] || load_whitelist
    for i in "${!WL_LO[@]}"; do
        [[ "${WL_TXT[i]}" == "$M_WL_SELF: "* ]] || continue
        (( WL_LO[i] <= $2 && WL_HI[i] >= $1 )) && { SELF_HIT="${WL_TXT[i]#*: }"; return 0; }
    done
    return 1
}
wl_range16() {   # A.B LO HI → /16 için /24 ile aynı beyaz liste kontrolleri: aralık çakışması, sonra içinde tekil banı
    # olan bloklarla CC_IGNORE / CC_ALLOW (sahip önbellekten, ucuz) ve csf.rignore (her IP bir ters DNS sorgusu).
    # Sorgular sınırlı: en çok 30 blok, rignore için toplam 30 IP örneği — yüzlerce tekilli bir /16'da pencere
    # ve ban dakikalarca beklemesin (otomatik /24 banındaki sorgu sayısıyla aynı düzey)
    local p n=0 q=30 ips
    WL_HIT=""; WL_RETRY=0
    wl_overlap "$2" "$3" && return 0
    for p in $(printf '%s\n' "${!ips24[@]}" | grep -F "$1." | sort -V); do
        [[ "$p" == "$1".* ]] || continue
        ip2int "$p.0"; (( REPLY >= $2 && REPLY <= $3 )) || continue     # duyurulan aralıkta (/17–/23) yalnız içindekiler
        n=$((n + 1)); [ "$n" -le 30 ] || break
        ips=$(printf '%s\n' ${ips24[$p]} | head -n "$(( q > 3 ? 3 : (q > 0 ? q : 1) ))" | paste -sd' ' -)
        q=$(( q - $(wc -w <<< "$ips") ))
        wl_check "$p" "$ips" && return 0
    done
    if [ "$n" = 0 ]; then local fp="$(( $2 >> 24 )).$(( ($2 >> 16) & 255 )).$(( ($2 >> 8) & 255 ))"; wl_check "$fp" "$fp.1" && return 0; fi
    return 1
}
wl_check() {     # PREFIX24 "IP IP ..." → 0 = banlama (WL_HIT dolu; WL_RETRY=1 ise doğrulanamadı, sonraki tur)
    local lo hi ip host d re entry name vals v first unk=0
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
            rig_match "$host" "$ip"; case $? in
                0) WL_HIT="csf.rignore: $REPLY ($ip = $host)"; return 0 ;;
                2) unk=1 ;;
            esac
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
declare -A DENY_IP SINGLE_NOTE count24 ips24 DLINE IN_TNOTE   # DLINE: ana csf.deny'de adres → satır (bir okumada)
DC_LO=(); DC_HI=(); DC_TXT=(); AGG=(); MANB=()   # MANB: elle konan tam banlar · AGG: CSF Auto-Group'un kendi eklediği bloklar (diğer CIDR'ler değil)
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
        [ "$2" = 1 ] && [ -z "${DLINE[$tok]+x}" ] && DLINE[$tok]="$line"
        if [[ "$tok" == */* ]]; then
            cidr_range "$tok" && { DC_LO+=("$R_LO"); DC_HI+=("$R_HI"); DC_TXT+=("$tok"); }
            if [ "$2" = 1 ]; then case "$line" in *Auto-grouped*) AGG+=("$tok") ;; *csf_autogroup:*) AGG+=("$tok"); MANB+=("$tok") ;; esac; fi
        else
            DENY_IP[$tok]=1
            if [ "$2" = 1 ] && [ -z "${SINGLE_NOTE[$tok]+x}" ]; then
                SINGLE_NOTE[$tok]="${line#"$tok"}"; p="${tok%.*}"
                count24[$p]=$((${count24[$p]:-0} + 1)); ips24[$p]+=" $tok"
            fi
        fi
    done < "$1"
}
# CSF'in DENY_IP_LIMIT için saydığı satırlar (csf.pl, csf -d): boş, yorum ve Include satırları ile içinde
# "do not delete" geçenler sayılmaz, gerisi (IP, CIDR ve gelişmiş satırlar) sayılır; Include edilen dosyalar sayılmaz
deny_count() {
    awk '{ l = $0; sub(/\r$/, "", l) }
         l == "" || l ~ /^[ \t]*#/ || index(l, "Include") || tolower(l) ~ /do not delete/ { next }
         { n++ } END { print n + 0 }' "$DENY_FILE" 2>/dev/null || echo 0
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
    while IFS=' ' read -r c u b; do         # durum çıktısı IFS=, ile çağırır
        [ "$c" = "$1" ] || continue
        if [[ ! "$u" < "$TODAY" ]]; then IGN_UNTIL="$u"; return 0; fi
    done < "$IGNORE_FILE"
    return 1
}

# ── Temp group bans: csf.tempban içinde bizim eklediğimiz /24'ler ────────────
declare -A TG_TTL TG_NOTE TG_T
read_temp_groups() {
    local t ip port dir to note now p
    now=$(date +%s)
    [ -r "$CSF_VAR/csf.tempban" ] || return
    while IFS='|' read -r t ip port dir to note; do
        [[ "$ip" == */24 ]] || continue
        # Yorumdan (v1.2+) ya da sayaç kaydından (daha eski sürümlerin eklediği) tanınır.
        p="${ip%.0/24}"
        if [[ "$note" == *Auto-grouped* ]] || grep -qE "^${p//./\\.} " "$SAYAC_FILE" 2>/dev/null; then
            TG_TTL[$ip]=$(( $(num "$t") + $(num "$to") - now )); TG_NOTE[$ip]="$note"; TG_T[$ip]=$(num "$t")
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
    # sınır, ilk olayı yazan turun BAŞLANGICI: tur günlük satırlarını olaylarından birkaç saniye önce yazar,
    # sınır olayın saati olursa o turun işleri hem olay kaydından hem günlükten gelip iki kez görünürdü
    if [ "$first" -gt 0 ] && [ -r "$EVENTS_FILE" ]; then
        local rl rt rd
        rl=$(grep -m1 '"type":"run"' "$EVENTS_FILE")
        [[ "$rl" =~ \"t\":([0-9]+) ]] && rt="${BASH_REMATCH[1]}"
        [[ "$rl" =~ \"dur\":([0-9]+) ]] && rd="${BASH_REMATCH[1]}"
        [ -n "$rt" ] && [ -n "$rd" ] && [ $(( rt - rd - 2 )) -lt "$first" ] && first=$(( rt - rd - 2 ))
    fi
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
    rm -f "$LOGHIST_FILE.tmp.$$" "$(dirname "$SAYAC_FILE")/loghist.v2.jsonl"   # eski sürümün (çift kayıtlı) önbelleği
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
    pc=$(deny_count)
    # Geçici liste doluluğu: her sayfa yoklamasında csf -t (Perl) başlatmak yerine csf.tempban'ın
    # satırları sayılır; csf.pl dotempban ile aynı: boş olmayan her satır, port listesindeki her port için
    # bir DENY satırı (port yoksa bir).
    tc=0; [ -r "$CSF_VAR/csf.tempban" ] && tc=$(awk -F'|' '$0 != "" { k = split($3, a, ","); c += (k > 0 ? k : 1) } END { print c + 0 }' "$CSF_VAR/csf.tempban")
    lock_busy && running=true
    last=$(grep '"type":"run"' "$EVENTS_FILE" 2>/dev/null | grep -E '^\{"t":[0-9]+,.*\}$' | tail -1)   # yarım satır JSON'u bozmasın
    local cronm; cronm=$(cron_now)

    # Aktif grup banları (kalıcı + geçici)
    local groups=() gtext=() ghist="" gi
    wide_load
    # eklentinin kısmi banları (gelişmiş satırlar; bölünmüş olanlar tek kayıt) ve tam banların izin istisnaları
    local -A PB_P=() PB_S=() PB_D=() PB_X=() EXC_S=() EXC_X=()
    local pl re_ex='exception for ([0-9./]+) \[svc=([a-z,]*)(;ports=([0-9,-]+))?\]'
    while IFS= read -r pl; do
        adv_parse "$pl" || continue
        PB_P[$ADV_CIDR]+="${PB_P[$ADV_CIDR]:+,}$ADV_PORTS"
        [[ "$pl" =~ $RE_SV ]] && PB_S[$ADV_CIDR]="${BASH_REMATCH[1]}"
        [[ "$pl" =~ $RE_PO ]] && PB_X[$ADV_CIDR]="${BASH_REMATCH[1]}"
        [[ "$pl" =~ $re_d ]] && PB_D[$ADV_CIDR]="${BASH_REMATCH[1]}"
    done < <(grep -F '# csf_autogroup:' "$DENY_FILE" 2>/dev/null | grep -F '|')
    while IFS= read -r pl; do
        [[ "$pl" =~ $re_ex ]] && { EXC_S[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"; EXC_X[${BASH_REMATCH[1]}]="${BASH_REMATCH[4]}"; }
    done < <(grep -F 'csf_autogroup: exception for' "$CSF_DIR/csf.allow" 2>/dev/null)
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
    # sağlayıcı banının içinde kalan banlar (geçici bloklar hariç: kendiliğinden kalkarlar)
    local -A PCOV=(); local pcl=() gi2
    for gi2 in "${!g_tok[@]}"; do [ "${g_kind[gi2]}" = temp ] || pcl+=("${g_tok[gi2]}:${g_kind[gi2]}::"); done
    for c in "${!PB_P[@]}"; do pcl+=("$c:partial:$(uniq_ports "${PB_P[$c]}"):${PB_S[$c]}"); done
    prov_covmap "${pcl[@]}"
    for gi in "${!g_tok[@]}"; do
        added="${g_ep[gi]:-0}"; [[ "$added" =~ ^[0-9]+$ ]] && [ "$added" -gt 86400 ] || added=0
        tok="${g_tok[gi]}"; kind="${g_kind[gi]}"; dnd="${g_dnd[gi]}"
        REPLY=""; cidr_range "$tok" && under_of "$R_LO" "$R_HI" "$tok"
        local gu="$REPLY" grn=0
        local grip=""
        if [ "$kind" = manual ]; then
            restore_file "$tok"
            if [ -s "$REPLY" ]; then
                grn=$(grep -vc -e '^#' -e '^$' "$REPLY")                # #t| satırı kayıt değil
                grip=$(grep -oE '^[0-9][0-9./]+' "$REPLY" | head -n 6 | paste -sd, -)   # pencerede gösterilecek ilk adresler
            fi
        fi
        groups+=("{\"cidr\":\"$tok\",\"kind\":\"$kind\",\"dnd\":$dnd,\"n\":${g_n[gi]},\"added\":$added,\"ttl\":0${gu:+,\"under\":\"$gu\"}${PCOV[$tok]:+,\"pcov\":\"${PCOV[$tok]}\"}$([ "$grn" -gt 0 ] && echo ",\"restore\":$grn,\"rips\":\"$grip\"")$([ -n "${EXC_S[$tok]+x}" ] && echo ",\"open\":\"${EXC_S[$tok]}\",\"open_extra\":\"${EXC_X[$tok]}\"")}")
        [ "$added" -gt 0 ] && ghist+="$added $kind $tok"$'\n'
        [ "$JSON" = 1 ] || gtext+=("$(printf '%-18s %-9s %s' "$tok" "$kind" "$([ "$dnd" = true ] && echo 'do not delete')")")
    done
    for c in "${!PB_P[@]}"; do
        local pa=0 pp
        pp=$(uniq_ports "${PB_P[$c]}")
        [ -n "${PB_D[$c]}" ] && pa=$(LC_ALL=C date -d "${PB_D[$c]}" +%s 2>/dev/null || echo 0)
        local psince="{}"
        if [ "$pa" -gt 0 ] && cidr_range "$c"; then
            attack_json "$R_LO" "$R_HI" "$pa" "${PB_S[$c]}" < <(
                for x in "${!SINGLE_NOTE[@]}"; do printf '%s|%s\n' "$x" "${SINGLE_NOTE[$x]}"; done
                [ -r "$CSF_VAR/csf.tempban" ] && awk -F'|' '$2 !~ /\// { print $2 "|" $6 "|e:" $1 }' "$CSF_VAR/csf.tempban")
            psince="$REPLY"
        fi
        REPLY=""; cidr_range "$c" && under_of "$R_LO" "$R_HI" "$c"
        groups+=("{\"cidr\":\"$c\",\"since\":$psince,\"kind\":\"partial\",\"dnd\":false,\"n\":0,\"added\":${pa:-0},\"ttl\":0,\"svc\":\"${PB_S[$c]}\",\"extra\":\"${PB_X[$c]}\",\"ports\":\"$pp\"${REPLY:+,\"under\":\"$REPLY\"}${PCOV[$c]:+,\"pcov\":\"${PCOV[$c]}\"}}")
        [ "$JSON" = 1 ] || gtext+=("$(printf '%-18s %-9s %s' "$c" "partial" "tcp $pp")")
    done
    for c in "${!TG_TTL[@]}"; do
        [ "${TG_TTL[$c]}" -gt 0 ] || continue
        n=0; [[ "${TG_NOTE[$c]}" =~ $re_n ]] && n="${BASH_REMATCH[1]}"
        REPLY=""; cidr_range "$c" && under_of "$R_LO" "$R_HI" "$c"
        groups+=("{\"cidr\":\"$c\",\"kind\":\"temp\",\"dnd\":false,\"n\":$n,\"added\":${TG_T[$c]:-0},\"ttl\":${TG_TTL[$c]}${REPLY:+,\"under\":\"$REPLY\"}}")
        [ "$JSON" = 1 ] || gtext+=("$(printf '%-18s %-9s %s' "$c" "temp" "$(m "$M_S_TTL" "$(( TG_TTL[$c] / 3600 ))h")")")
    done

    # Terfi bekleyenler: sayaçtaki "a.b.c tarih" kayıtları
    local pending=() ptext=() age left ttl
    while read -r c u; do
        [[ "$c" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ && "$u" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
        day_epoch "$u"; age=$(( (now - REPLY) / 86400 )); left=$(( SAYAC_RETENTION_DAYS - age ))
        ttl="${TG_TTL[$c.0/24]:-0}"; [ "$ttl" -lt 0 ] && ttl=0
        REPLY=""; cidr_range "$c.0/24" && under_of "$R_LO" "$R_HI" "$c.0/24"
        pending+=("{\"prefix\":\"$c\",\"since\":\"$u\",\"days_left\":$left,\"temp_ttl\":$ttl${REPLY:+,\"under\":\"$REPLY\"}}")
        [ "$JSON" = 1 ] || ptext+=("$(printf '%-18s %s · %s' "$c.0/24" "$u" "$(m "$M_S_DAYSLEFT" "$left")")")
    done < "$SAYAC_FILE"

    # Kontrol edilecekler: son REVIEW_DAYS gündeki /16 uyarıları ve beyaz liste atlamaları,
    # blok başına en yenisi; yoksayılanlar ve o arada banlanmış olanlar düşülür.
    local review=() rtext=() t ty pbe
    local -A seen=() W16D=()
    owners_load; asn_banned                        # sağlayıcı banının kapattıkları listede tutulmaz
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
            { cover_any; } && [[ "$line" == *'"ips":[{'* ]] && ev_ipsrc "$line" | prov_cover && continue
            if { cover_any; } && [[ "$line" == *'"ips":[{'* ]] && prov_near < <(ev_ipsrc "$line"); then
                jstr "$PN_SRC"; line="${line%\}},\"pnear\":$REPLY,\"pnsvc\":\"$PN_SVC\"}"
            fi
            # aynı aralığa uyarıdan SONRA kısmi ban konduysa uyarı ele alınmıştır; bandan sonra gelen yeni uyarı görünür
            if [ -n "${PB_D[$c]}" ]; then
                pbe=$(LC_ALL=C date -d "${PB_D[$c]}" +%s 2>/dev/null || echo 0)
                [ "$t" -le "$pbe" ] && continue
                [[ "$ty" == warn16* && "$line" != *'"after":'* ]] && continue   # eski tekillerle tekrarlanmış uyarı
            fi
            [ -n "${W16D[$c]}" ] && line="${line%\}},\"rep\":${W16D[$c]}}"
            # şüpheli ağda kısmi ban varsa (yalnız seçilen servisler kapalı) satırda belirtilir
            if [[ "$ty" == warn16* ]] && cidr_range "$c" && part_note "$R_LO" "$R_HI"; then
                line="${line%\}},\"partial\":\"${REPLY%%|*}\",\"partial_svc\":\"${REPLY#*|}\"}"
            fi
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
            [ -n "${PB_P[$c]+x}" ] && continue        # olay kaydından önceki uyarı; aralığa sonradan kısmi ban konmuş
            day_epoch "$u"
            review+=("{\"t\":$REPLY,\"type\":\"$ty\",\"cidr\":\"$c\",\"day\":\"$u\",\"hist\":true${W16D[$c]:+,\"rep\":${W16D[$c]}}}")
            rtext+=("$(printf '%-18s %s · %s' "$c" "$ty" "$(date -d "$u" '+%d.%m')")")
        done < <(sort -k2,2r "$SAYAC_FILE")        # blok başına en yeni tarih
    fi

    # Bir önceki pencerede (REVIEW_DAYS gün daha geride) kaç FARKLI blok/ağ işaretlenmişti: kartın haftalık
    # değişimi aynı ölçüyle (olay sayısı değil, farklı kayıt sayısı) karşılaştırılsın.
    rv_win() {   # A B → [A, B) aralığında işaretlenen farklı blok/ağ sayısı (olay kaydı + sayaçtaki eski kayıtlar)
        local rw1="$1" rw2="$2" rs1 rs2
        printf -v rs1 '%(%Y-%m-%d)T' "$rw1"; printf -v rs2 '%(%Y-%m-%d)T' "$rw2"
        { [ -r "$EVENTS_FILE" ] && awk -v a="$rw1" -v b="$rw2" '
                   match($0, /"t":[0-9]+/) { t = substr($0, RSTART + 4, RLENGTH - 4) + 0 }
                   t >= a && t < b && /"type":"(warn16|warn16t|skip_wl)"/ && match($0, /"cidr":"[0-9.\/]+"/) { print substr($0, RSTART + 8, RLENGTH - 9) }' "$EVENTS_FILE"
               [ -r "$SAYAC_FILE" ] && awk -v a="$rs1" -v b="$rs2" '$2 >= a && $2 < b {
                   k = $1
                   if (k ~ /^WARN16_/)           { sub(/^WARN16_/, "", k);      print k ".0.0/16" }
                   else if (k ~ /^WARN_TEMP16_/) { sub(/^WARN_TEMP16_/, "", k); print k ".0.0/16" }
                   else if (k ~ /^WLSKIP_/)      { sub(/^WLSKIP_/, "", k);      print k ".0/24" } }' "$SAYAC_FILE"; } | sort -u | grep -c .
    }
    local rprev rwin="" wd
    rprev=$(rv_win $(( now - 2 * REVIEW_DAYS * 86400 )) $(( now - REVIEW_DAYS * 86400 )))
    # özet kartı grafiğin 7 / 30 gün seçimine göre: son N gün ve ondan önceki N gün
    for wd in 7 30; do
        rwin+="${rwin:+,}\"$wd\":[$(rv_win $(( now - wd * 86400 )) $(( now + 1 ))),$(rv_win $(( now - 2 * wd * 86400 )) $(( now - wd * 86400 )))]"
    done

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
    # IP listeleri olmadan: sayaçlar ve "yeni" çubuğu için yeter; IP'li kayıtları Geçmiş --events ile sayfa sayfa alır,
    # aktif/izlenen blokların ban kaydı ise aşağıdaki evx'te tam gelir
    [ -r "$EVENTS_FILE" ] && mapfile -t recent < <(grep -v '"type":"run"' "$EVENTS_FILE" | grep -E '^\{"t":[0-9]+,.*\}$' | tail -n 300 | ev_strip_ips)
    # olay kaydından önceki işler (günlükten; bir kez hesaplanıp saklanır)
    [ -f "$LOGHIST_FILE" ] || loghist_build
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
    asn_top 500                    # tam liste (panel kısa gösterir, ister genişletir)
    local tops=() a nm cc g bl sg den cl
    if [ -n "$ASN_TOP" ]; then
        while IFS='|' read -r a nm cc g bl sg den cl cs; do
            jstr "${AWHY[$a]:-}"; local wj="$REPLY"
            jstr "$nm"; tops+=("{\"asn\":\"$a\",\"name\":$REPLY,\"why\":$wj,\"cs\":\"$cs\",\"cc\":\"$cc\",\"groups\":$g,\"blocks\":$bl,\"singles\":$sg,\"cloud\":$(num "$cl"),\"denied\":$([ "$den" = 1 ] && echo true || echo false)}")
        done <<< "$ASN_TOP"
    fi
    asn_top 500 blocks
    local btops=()
    if [ -n "$ASN_TOP" ]; then
        while IFS='|' read -r a nm cc g bl sg den cl cs; do
            jstr "${AWHY[$a]:-}"; local wj="$REPLY"
            jstr "$nm"; btops+=("{\"asn\":\"$a\",\"name\":$REPLY,\"why\":$wj,\"cs\":\"$cs\",\"cc\":\"$cc\",\"groups\":$g,\"blocks\":$bl,\"singles\":$sg,\"cloud\":$(num "$cl"),\"denied\":$([ "$den" = 1 ] && echo true || echo false)}")
        done <<< "$ASN_TOP"
    fi
    local imj='{"present":false}' itops=() icnt rs r1 rn rj
    if imunify_top 500; then
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
        runsj=$(grep '"type":"run"' "$EVENTS_FILE" | awk -v c=$(( now - 86400 )) -v w=$(( now - 7 * 86400 )) -v w30=$(( now - 30 * 86400 )) '
            { t = 0; d = 0
              if (match($0, /"t":[0-9]+/))   t = substr($0, RSTART + 4, RLENGTH - 4) + 0
              if (match($0, /"dur":[0-9]+/)) d = substr($0, RSTART + 6, RLENGTH - 6) + 0
              if (NR == 1) f = t; if (t >= c) n++; T[NR] = t; D[NR] = d
              if (!got && t >= w && match($0, /"perm_used":[0-9]+/)) {
                  p7 = substr($0, RSTART + 12, RLENGTH - 12) + 0
                  if (match($0, /"temp_used":[0-9]+/)) t7 = substr($0, RSTART + 12, RLENGTH - 12) + 0; else t7 = -1
                  got = 1 }
              if (!got30 && t >= w30 && match($0, /"perm_used":[0-9]+/)) {
                  p30 = substr($0, RSTART + 12, RLENGTH - 12) + 0
                  if (match($0, /"temp_used":[0-9]+/)) t30 = substr($0, RSTART + 12, RLENGTH - 12) + 0; else t30 = -1
                  got30 = 1 } }
            END { s = NR > 36 ? NR - 35 : 1; o = ""
                  for (i = s; i <= NR; i++) o = o (o != "" ? "," : "") "[" T[i] "," D[i] "]"
                  printf "{\"n24\":%d,\"first\":%d,\"p7\":%d,\"t7\":%d,\"p30\":%d,\"t30\":%d,\"list\":[%s]}", n, f, (got ? p7 : -1), (got ? t7 : -1), (got30 ? p30 : -1), (got30 ? t30 : -1), o }')
    fi

    if [ "$JSON" = 1 ]; then
        local IFS=,
        printf '{"ok":true,"version":"%s","lang":"%s","now":%s,"running":%s,' "$VERSION" "$MSG_LANG" "$now" "$running"
        health_check
        printf '"review_prev":%s,"review_win":{%s},' "$(num "$rprev")" "$rwin"
        printf '"enabled":%s,' "$([ "$ENABLED" = 0 ] && echo false || echo true)"
        printf '"health":{"csf":"%s","lfd":"%s","lfd_age":%s},"expire":{"days":%s,"auto":%s},"repeat_min":%s,' "$H_CSF" "$H_LFD" "${H_LFDAGE:--1}" "$(num "$BLOCK_EXPIRE_DAYS")" "$([ "$BLOCK_EXPIRE_AUTO" = 1 ] && echo true || echo false)" "$(num "$REPEAT16_MIN")"
        printf '"config":{"t24":%s,"t24p":%s,"t16":%s,"tt24":%s,"tt16":%s,"retention":%s,"review_days":%s,"lookup":%s},' \
            "$(num "$THRESHOLD_24")" "$(num "$THRESHOLD_24_PERMANENT")" "$(num "$THRESHOLD_16")" "$(num "$THRESHOLD_TEMP_24")" \
            "$(num "$THRESHOLD_TEMP_16")" "$(num "$SAYAC_RETENTION_DAYS")" "$(num "$REVIEW_DAYS")" "$([ "$LOOK_INIT" = 1 ] && echo true || echo false)"
        printf '"usage":{"perm":[%s,%s],"temp":[%s,%s]},' "$(num "$pc")" "$limit" "$(num "$tc")" "$tlimit"
        printf '"last_run":%s,' "${last:-null}"
        jstr "$cronm"; printf '"cron_min":%s,"runs":%s,' "$REPLY" "$runsj"
        printf '"cron_interval":%s,"daily":{"start":%s,%s},"owners":{%s},"asn_top":[%s],"blocks_top":[%s],"imunify":%s,' \
            "$(cron_interval "$cronm")" "$dstart" "$daily" "${owners[*]}" "${tops[*]}" "${btops[*]}" "$imj"
        # sıralamalardan çıkarılan, CSF'te banlı sağlayıcılar (panel listenin altında gösterir)
        local bj="" ba bn
        asn_banned
        for ba in "${ASB_A[@]}"; do asn_name "AS$ba"; jstr "$REPLY"; bn="$REPLY"; asn_setn "AS$ba"; bj+="${bj:+,}{\"asn\":\"$ba\",\"name\":$bn,\"how\":\"${ASB[$ba]}\",\"n\":$REPLY}"; done
        for ba in "${CLB_A[@]}"; do asn_name "AS$ba"; jstr "$REPLY"; bj+="${bj:+,}{\"asn\":\"$ba\",\"name\":$REPLY,\"how\":\"cloud\",\"src\":\"${CLB_S[$ba]}\",\"n\":-1}"; done
        printf '"asn_banned":[%s],"dports":["%s","%s"],' "$bj" "$(conf_val CC_DENY_PORTS_TCP | tr -cd '0-9,:')" "$(conf_val CC_DENY_PORTS_UDP | tr -cd '0-9,:')"
        # panelin "zaten kapalı mı" kararları için: /23'ten geniş tam banlar (kaynağı ne olursa olsun) ve CC_DENY listesi
        local wdj=() ccw
        for gi in "${WD_TXT[@]}"; do wdj+=("\"$gi\""); done
        ccw=$(conf_val CC_DENY | LC_ALL=C tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9,')
        printf '"wide":[%s],"ccd":"%s",' "${wdj[*]}" "$ccw"
        prov_json; printf '"prov":%s,' "$REPLY"
        local msj=() msid
        # (burada IFS=, olduğu için liste satır satır okunur, kelimelere bölünmez)
        while read -r msid; do
            modsec_msg "$msid"; [ -n "$REPLY" ] && { jstr "$REPLY"; msj+=("\"$msid\":$REPLY"); }
        done < <( { cat "$EVENTS_FILE" "$CSF_VAR/csf.tempban" 2>/dev/null; grep -F 'mod_security' "$DENY_FILE" 2>/dev/null; } |
                  grep -oE 'mod_security \(id:[0-9]+\)' | grep -oE '[0-9]+' | sort -u | head -n 100)
        printf '"modsec":{%s},' "${msj[*]}"
        # Aktif ve izlenen blokların banı koyduran son kayıt (IP'ler + sebepler): son 300 olaya girmeyen eski
        # bloklarda da panel IP'leri ve sebebi gösterebilsin. Yalnız bu bloklar → çıktı şişmez.
        local evx=() want
        want=$( { printf '%s\n' "${g_tok[@]}" "${!TG_TTL[@]}" "${!PB_P[@]}"; printf '%s\n' "${pending[@]}" | sed -n 's/.*"prefix":"\([0-9.]*\)".*/\1.0\/24/p'; } | sort -u | paste -sd' ' -)
        [ -r "$EVENTS_FILE" ] && [ -n "$want" ] && mapfile -t evx < <(awk -v want="$want" '
            BEGIN { n = split(want, w, " "); for (i = 1; i <= n; i++) W[w[i]] = 1 }
            /"ips":\[\{/ && /"type":"(add24|promote|temp24|manual_ban)"/ && match($0, /"cidr":"[0-9.\/]+"/) {
                c = substr($0, RSTART + 8, RLENGTH - 9); if (c in W) L[c] = $0 }
            END { for (c in L) print L[c] }' "$EVENTS_FILE" | grep -E '^\{"t":[0-9]+,.*\}$')
        printf '"evx":[%s],' "${evx[*]}"
        # Ayarlar → Eşikler: eşiğin etkisini panel hesaplasın diye ağ başına, her bloğun "kalıcı:geçici" tekil sayısı
        # (banlı ya da yoksayılmış bloklar hariç; motorun turdaki sayımıyla aynı kurallar)
        local -A DB=() TPC=()
        local dp dx dl
        if [ -r "$CSF_VAR/csf.tempban" ]; then
            while IFS='|' read -r dl dx _; do
                [[ "$dx" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
                [ -n "${TPC[x$dx]}" ] || [ -n "${DENY_IP[$dx]+x}" ] && continue; TPC[x$dx]=1
                TPC[${dx%.*}]=$(( ${TPC[${dx%.*}]:-0} + 1 ))
            done < "$CSF_VAR/csf.tempban"
        fi
        for dx in "${!count24[@]}" "${!TPC[@]}"; do
            [[ "$dx" == x* ]] && continue
            [ -n "${DB[$dx]}" ] && continue
            [ -n "${DLINE[$dx.0/24]+x}" ] || [ "${TG_TTL[$dx.0/24]:-0}" -gt 0 ] && continue
            ip2int "$dx.0"; under_of "$REPLY" $((REPLY + 255)) "" && continue
            ign_until "$dx.0/24" && continue
            DB[$dx]="${count24[$dx]:-0}:${TPC[$dx]:-0}"
        done
        printf '"dist":{%s},' "$(for dx in "${!DB[@]}"; do printf '%s %s\n' "${dx%.*}" "${DB[$dx]}"; done | sort | awk '
            $1 != k { if (k != "") printf "%s\"%s\":[%s]", (n++ ? "," : ""), k, v; k = $1; v = "" }
            { v = v (v == "" ? "" : ",") "\"" $2 "\"" }
            END { if (k != "") printf "%s\"%s\":[%s]", (n ? "," : ""), k, v }')"
        printf '"groups":[%s],"pending":[%s],"review":[%s],"ignored":[%s],"events":[%s]}\n' \
            "${groups[*]}" "${pending[*]}" "${review[*]}" "${ignored[*]}" "${recent[*]}"
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
# Olay satırından "ips":[…] alanını çıkarır (dizgi içindeki köşeli parantez ve kaçışlar sayılmaz)
ev_strip_ips() {
    awk '{
        s = $0; out = ""
        while ((i = index(s, ",\"ips\":[")) > 0) {
            out = out substr(s, 1, i - 1); j = i + 8; d = 1; q = 0; n = length(s)
            while (j <= n && d > 0) {
                c = substr(s, j, 1)
                if (q) { if (c == "\\") j++; else if (c == "\"") q = 0 }
                else if (c == "\"") q = 1
                else if (c == "[") d++
                else if (c == "]") d--
                j++
            }
            s = substr(s, j)
        }
        print out s
    }'
}
# ── --events latest|after|before T N ───────────────────────────────────────
# Geçmiş sekmesi için olay kaydından bir sayfa (tur kayıtları hariç, IP'leriyle):
#   latest       → son N olay; more = daha eskisi var mı
#   before T     → zamanı ≤ T olan son N olay; more = daha eskisi var mı
#   after T      → zamanı ≥ T olan olaylar (en çok N); more = N'den fazlaydı (panel baştan yükler)
# Sınır saniyesi iki sayfada da yer alır (aynı saniyedeki olaylar kaybolmasın); panel tekrarı ayıklar.
do_events() {
    local mode="${1:-latest}" t="${2:-0}" n="${3:-300}"
    if ! [[ "$mode" =~ ^(latest|after|before)$ ]] || ! [[ "$t" =~ ^[0-9]{1,12}$ ]] || ! [[ "$n" =~ ^[0-9]{1,4}$ ]] || [ "$n" -lt 1 ] || [ "$n" -gt 1000 ]; then
        echo '{"ok":false,"error":"bad_input"}'; return 2
    fi
    { [ -r "$EVENTS_FILE" ] && grep -v '"type":"run"' "$EVENTS_FILE" | grep -E '^\{"t":[0-9]+,.*\}$'; } |
    awk -v m="$mode" -v T="$t" -v N="$n" '
        { match($0, /^\{"t":[0-9]+/); et = substr($0, 6, RLENGTH - 5) + 0
          if (m == "before" && et > T) next
          if (m == "after" && et < T) next
          c++; L[c % N] = $0 }
        END { k = c < N ? c : N
              printf "{\"ok\":true,\"more\":%s,\"events\":[", (c > N ? "true" : "false")
              for (i = c - k + 1; i <= c; i++) printf "%s%s", (i > c - k + 1 ? "," : ""), L[i % N]
              print "]}" }'
}
# ── Elle /16 ya da /24 banının kapsayacakları ─────────────────────────────
# Onay penceresi (--inside) ve ban eylemi aynı taramayı kullanır: pencerede görülen, silinenle aynıdır.
#   IN_COVER  aralığı zaten kapsayan kalıcı ban (kendisi ya da daha genişi)
#   IN_BLK    içindeki eklenti blok banları · IN_OTH başka kaynaklı aralıklar · IN_PORT port sınırlı satırlar (dokunulmaz)
#   IN_SGL    tekiller · IN_SGLD do not delete işaretli tekiller
#   Kapsananlar kaldırılırken bütün kalıcı satırlar (do not delete ve başka aralıklar dahil) silinir ve
#   RESTORE_DIR'de saklanır: ban kaldırılırken istenirse eski hâlleriyle geri yüklenir.
#   IN_TMP    geçici listedeki IP'ler ve aralıklar · IN_WATCH izlenen /24'ler (izleme her durumda biter)
#   IN_EVJ    olay kaydına giden kanıt: tekil ve geçici IP'ler, ban sebepleriyle (en çok 40) · IN_EVN toplam
inside_scan() {  # CIDR
    local lo hi i x ip t tip port dir to note line
    local -A seen=() pf=()
    cidr_range "$1" || return 1
    lo=$R_LO; hi=$R_HI
    IN_COVER=""; IN_BLK=(); IN_OTH=(); IN_SGL=(); IN_SGLD=(); IN_TMP=(); IN_WATCH=(); IN_EVJ=(); IN_EVN=0; IN_PFX=(); IN_PORT=(); IN_OWNP=(); IN_PSVC=""; IN_PEXTRA=""; IN_TNOTE=()
    local cw=-1    # kapsayanlardan en genişi kazanır (kendi /24 banı + onu kapsayan /16 varken sonuç dosya sırasına bağlıydı)
    for i in "${!DC_LO[@]}"; do
        if (( DC_LO[i] <= lo && DC_HI[i] >= hi )); then
            (( DC_HI[i] - DC_LO[i] > cw )) && { IN_COVER="${DC_TXT[i]}"; cw=$(( DC_HI[i] - DC_LO[i] )); }
            continue
        fi
        (( DC_LO[i] >= lo && DC_HI[i] <= hi )) || continue
        line="${DLINE[${DC_TXT[i]}]}"
        [ -n "$line" ] || continue                       # Include edilen dosyadaki satır: eklenti silemez, sayılmaz
        case "$line" in *Auto-grouped*|*csf_autogroup:*) IN_BLK+=("${DC_TXT[i]}") ;; *) IN_OTH+=("${DC_TXT[i]}") ;; esac
        x="${DC_TXT[i]%/*}"; pf[${x%.*}]=1
    done
    for ip in $(printf '%s\n' "${!SINGLE_NOTE[@]}" | sort -V); do
        ip2int "$ip"; (( REPLY >= lo && REPLY <= hi )) || continue
        if is_dnd "${SINGLE_NOTE[$ip]}"; then IN_SGLD+=("$ip"); else IN_SGL+=("$ip"); fi
        pf[${ip%.*}]=1
        short_reason "${SINGLE_NOTE[$ip]}" "$ip"; inside_ev "$ip" "$REPLY"
    done
    if [ -r "$CSF_VAR/csf.tempban" ]; then
        while IFS='|' read -r t tip port dir to note; do
            [ -n "$tip" ] && [ -z "${seen[$tip]}" ] || continue
            cidr_range "$tip" 2>/dev/null || continue
            (( R_LO >= lo && R_HI <= hi )) || continue
            seen[$tip]=1; IN_TMP+=("$tip"); IN_TNOTE[$tip]="$note"
            x="${tip%/*}"; pf[${x%.*}]=1
            if [[ "$tip" != */* ]] && [ -z "${SINGLE_NOTE[$tip]+x}" ]; then short_reason "$note" "$tip"; inside_ev "$tip" "$REPLY"; fi
        done < "$CSF_VAR/csf.tempban"
    fi
    while read -r x _; do
        [[ "$x" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] && [ -z "${seen[w$x]}" ] || continue
        ip2int "$x.0"; (( REPLY >= lo && REPLY <= hi )) || continue
        seen[w$x]=1; IN_WATCH+=("$x"); pf[$x]=1
    done < <(cat "$SAYAC_FILE" 2>/dev/null)
    # port sınırlı satırlar (tcp|in|d=22|s=…): tam ban değil, dokunulmaz; pencere bilgi olarak gösterir
    while IFS= read -r line; do
        adv_parse "$line" || continue
        adv_wide "$ADV_CIDR" && continue
        cidr_range "$ADV_CIDR" || continue
        (( R_LO >= lo && R_HI <= hi )) || continue
        if [[ "$line" == *"# csf_autogroup:"* ]]; then         # eklentinin kısmi banı (bölünmüş satırlar tek kayıt)
            [ -n "${seen[p$ADV_CIDR]}" ] && continue
            seen[p$ADV_CIDR]=1; IN_OWNP+=("$ADV_CIDR")
            if [ "$ADV_CIDR" = "$1" ]; then
                [[ "$line" =~ $RE_SV ]] && IN_PSVC="${BASH_REMATCH[1]}"
                [[ "$line" =~ $RE_PO ]] && IN_PEXTRA="${BASH_REMATCH[1]}"
            fi
        else IN_PORT+=("$ADV_CIDR $ADV_PROTO ${ADV_PORTS:-*}"); fi
    done < <(grep -F '|' "$DENY_FILE" 2>/dev/null | grep -v '^[[:space:]]*#')
    IN_PFX=("${!pf[@]}")
    return 0
}
restore_file() { REPLY="$RESTORE_DIR/${1//\//_}"; }   # CIDR → saklanan satırların dosyası
# Ban sebebinden servis: LFD sebebi servisi söyler ("(sshd) … [LF_SSHD]"); tanınmayanlar "other", port taraması "scan",
# LFD'nin tekrar eden saldırganı kalıcıya alması (PERMBLOCK) "repeat" — servis değil, öneri oranına girmez.
# Panelde aynı kural ag.js'teki svcOfReason'da (Kontrol edilecekler için) — birini değiştirirsen ötekini de değiştir.
AWK_CLS='function cls(r) {
    r = tolower(r)
    gsub(/ \([a-z][a-z]\/[^)]*\)/, "", r)          # "(us/united states/mail.smtp.example)" — ülke ve rDNS servis değildir
    if (r ~ /permblock/) return "repeat"         # LFD: çok geçici ban almış IP kalıcıya alındı (servisi söylemez)
    if (r ~ /mod_?security|lf_modsec/) return "web"   # ModSecurity yalnız web trafiğinde çalışır; kural mesajı yanıltmasın
    if (r ~ /port ?scan|ps_limit|lf_distattack/) return "scan"
    if (r ~ /sshd|lf_sshd/) return "ssh"
    if (r ~ /ftpd|lf_ftpd|lf_distftp/) return "ftp"
    if (r ~ /cpanel|cpaneld|whm|webmail|lf_cpanel|webmin|lf_webmin|directadmin/) return "cp"
    if (r ~ /smtpauth|lf_smtpauth|lf_distsmtp|sasl|imapd|pop3d|lf_pop3d|lf_imapd|dovecot|courier/) return "sync"
    if (r ~ /exim|lf_eximsyntax|smtp|relay|spam/) return "min"
    if (r ~ /named|lf_dns|dns/) return "dns"
    if (r ~ /mod_?security|htpasswd|lf_htaccess|lf_modsec|apache|nginx|litespeed|http|wordpress|wp-|xmlrpc|joomla|login\.php|lf_apache|404/) return "web"
    return "other"
}
function datekey(n,  a, k, M, i, h) {   # "… - Sat Sep 26 12:00:00 2026" → 20260926120000 (yoksa 0)
    split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", M, " "); k = split(n, a, /[ \t]+/)
    if (k < 4 || a[k] !~ /^[0-9][0-9][0-9][0-9]$/ || a[k - 1] !~ /^[0-9][0-9]:[0-9][0-9]:[0-9][0-9]$/) return 0
    h = a[k - 1]; gsub(/:/, "", h)
    for (i = 1; i <= 12; i++) if (M[i] == a[k - 3]) return (a[k] sprintf("%02d%02d", i, a[k - 2]) h) + 0
    return 0
}'
attack_json() {  # LO HI [SONRA_EPOCH ATLANACAK_SERVİSLER] < "ip|sebep[|e:epoch]" → REPLY = {"ssh":12,…}
    # her IP bir kez; SONRA verilirse yalnız o zamandan sonra konan banlar (tekilde nottaki tarih, geçicide epoch)
    local sk=0
    [ -n "$3" ] && [ "$3" != 0 ] && sk=$(LC_ALL=C date -d "@$3" +%Y%m%d%H%M%S 2>/dev/null || echo 0)
    REPLY=$(awk -F'|' -v lo="$1" -v hi="$2" -v se="${3:-0}" -v sk="$sk" -v skip=",${4}," "$AWK_CLS"'
        function ipn(a,  p) { split(a, p, "."); return ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4] }
        $1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ && !($1 in S) {
            v = ipn($1); if (v < lo || v > hi) next
            if (se > 0) { if ($3 ~ /^e:/) { if (substr($3, 3) + 0 <= se + 0) next } else { d = datekey($2); if (d == 0 || d <= sk + 0) next } }
            S[$1] = 1; k = cls($2); if (index(skip, "," k ",")) next; C[k]++ }
        END { o = ""; for (k in C) o = o (o == "" ? "" : ",") "\"" k "\":" C[k]; print "{" o "}" }')
    [ -n "$REPLY" ] || REPLY="{}"
}
inside_attacks() { # CIDR → REPLY = {"ssh":12,"web":3,…}: aralıktaki IP'lerin ban sebeplerinden servis başına saldıran IP
    # sayısı. Kaynaklar: kalıcı listedeki tekiller, geçici banlar, içteki banların olay kaydındaki IP sebepleri.
    local c="$1" ip x want="" lo hi
    cidr_range "$c" || { REPLY="{}"; return; }
    lo=$R_LO; hi=$R_HI
    for x in "${IN_BLK[@]}" "${IN_OTH[@]}" "${IN_OWNP[@]}" "$c"; do want+=" $x"; done
    for x in "${IN_WATCH[@]}"; do want+=" $x.0/24"; done
    attack_json "$lo" "$hi" < <(
        for ip in "${IN_SGL[@]}" "${IN_SGLD[@]}"; do printf '%s|%s\n' "$ip" "${SINGLE_NOTE[$ip]}"; done
        for ip in "${!IN_TNOTE[@]}"; do [[ "$ip" == */* ]] || printf '%s|%s\n' "$ip" "${IN_TNOTE[$ip]}"; done
        # içteki ban ve izleme kayıtlarının son IP listesi (o bloklar banlanırken silinen tekillerin sebepleri burada)
        [ -r "$EVENTS_FILE" ] && awk -v want="$want" '
            BEGIN { n = split(want, w, " "); for (i = 1; i <= n; i++) W[w[i]] = 1 }
            /"ips":\[\{/ && match($0, /"cidr":"[0-9.\/]+"/) { k = substr($0, RSTART + 8, RLENGTH - 9); if (k in W) L[k] = $0 }
            END { for (k in L) { s = L[k]
                    while (match(s, /"ip":"[0-9.]+"[^}]*/)) {
                        e = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH)
                        ip = e; sub(/^"ip":"/, "", ip); sub(/".*/, "", ip)
                        why = ""; if (match(e, /"why":"[^"]*"/)) why = substr(e, RSTART + 7, RLENGTH - 8)
                        print ip "|" why } } }' "$EVENTS_FILE")
}
inside_ev() {    # IP SEBEP → IN_EVJ'ye ekle
    IN_EVN=$((IN_EVN + 1))
    [ "$IN_EVN" -le 40 ] || return 0
    local jw w="${2:-$M_H_NOREASON}"
    is_dnd "$w" && w=$(printf '%s' "$w" | sed -E 's/[[:space:]]*-?[[:space:]]*[Dd][Oo][[:space:]]+[Nn][Oo][Tt][[:space:]]+[Dd][Ee][Ll][Ee][Tt][Ee][[:space:]]*//')
    jstr "${w:-$M_H_NOREASON}"; jw="$REPLY"
    IN_EVJ+=("{\"ip\":\"$1\",\"why\":$jw}")
}
inside_owner() { # taranan aralığın sahibi: önbellekte bilinen ilk /24 (sorgu yapılmaz)
    local x
    OWN_LONG=""; OWN_ASN=""; OWN_CC=""
    for x in "$@" "${IN_PFX[@]}"; do
        [ -n "$x" ] || continue
        [ -n "${OWN_L[$x]}" ] && { OWN_LONG="${OWN_L[$x]}"; OWN_ASN="${OWN_A[$x]}"; OWN_CC="${OWN_C[$x]}"; return 0; }
    done
    return 0
}
do_inside() {    # CIDR → JSON (onay penceresi) ya da metin
    local c="$1" pfx24="" lst clo chi cbits="${1#*/}"
    if ! { [[ "$c" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.0\.0/16$ ]] || [[ "$c" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.0/24$ ]] ||
           [[ "$c" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/(1[7-9]|2[0-3])$ ]]; } || ! cidr_range "$c" || { ip2int "${c%/*}"; [ "$REPLY" != "$R_LO" ]; }; then
        if [ "$JSON" = 1 ]; then echo '{"ok":false,"error":"bad_input"}'; else m "$M_BAD_TARGET" "$c"; echo; fi
        return 2
    fi
    clo=$R_LO; chi=$R_HI
    parse_deny "$DENY_FILE" 1
    owners_load
    inside_scan "$c"
    [[ "$c" == */24 ]] && pfx24="${c%.0/24}"
    inside_owner $pfx24
    # ülke/ASN banı (CC_DENY) aralığı zaten tamamen kapatıyorsa yeni banın etkisi olmaz. Blok kesin tek önekte
    # (duyurulan önekler /24'ten küçük olmaz); ağ (/16) ise yalnız duyurulan önek bütün ağı içeriyorsa kapalı sayılır.
    # LOOKUP kapalıysa sorulmaz, bilinmez.
    local ccd; ccd=" $(conf_val CC_DENY | LC_ALL=C tr '[:lower:],' '[:upper:] ') "
    if [ -z "$IN_COVER" ] && [ "$ccd" != "  " ]; then
        local qa qb ccn="" asn="" ap=""
        if [ -n "$pfx24" ]; then
            [ -z "$OWN_CC$OWN_ASN" ] && owner_lookup "$pfx24.1"
            ccn="$OWN_CC"; asn="$OWN_ASN"
        else
            local qc qd; IFS=. read -r qa qb qc qd <<< "${c%/*}"
            if dns_q TXT "$(( qd + 1 )).$qc.$qb.$qa.origin.asn.cymru.com"; then
                # "16276 | 151.80.0.0/16 | FR | ripencc | 2012-01-01" — birden çok satırda en geniş önek
                read -r asn ap ccn < <(printf '%s\n' "$REPLY" | awk -F'|' '{gsub(/ /,""); split($2,p,"/"); print p[2]+0, $1, $2, $3}' | sort -n | head -1 | cut -d' ' -f2-)
                asn="${asn%% *}"; [ -n "$ap" ] && [ "${ap#*/}" -le "$cbits" ] 2>/dev/null || { ccn=""; asn=""; }   # duyurulan önek bütün aralığı içermeli
            fi
        fi
        if [ -n "$ccn" ] && [[ "$ccd" == *" $ccn "* ]]; then IN_COVER="CC_DENY $ccn"
        elif [ -n "$asn" ] && [[ "$ccd" == *" AS$asn "* ]]; then IN_COVER="CC_DENY AS$asn"; fi
    fi
    # beyaz liste: ban eylemindeki kontrolün aynısı (/24'te bloktaki IP'lerle, /16'da aralık çakışması)
    WL_HIT=""; WL_RETRY=0
    if [ -n "$pfx24" ]; then wl_check "$pfx24" "${ips24[$pfx24]:-$pfx24.1}"; else wl_range16 "${c%.*.*}" "$clo" "$chi"; fi
    if [ "$JSON" = 1 ]; then
        local o k
        jarr() { local a="" x; for x in "$@"; do a+="${a:+,}\"$x\""; done; REPLY="[$a]"; }
        o="{\"ok\":true,\"cidr\":\"$c\""
        jstr "$IN_COVER"; o+=",\"cover\":$REPLY"
        local cqf csrc=""
        if [ "$CLOUD_ON" = 1 ] && cqf=$(mktemp); then
            echo "r $clo $chi" > "$cqf"; csrc=$(cloud_cover "$cqf" | awk '{ print $2; exit }'); rm -f "$cqf"
        fi
        o+=",\"cloud\":\"$csrc\",\"cloud_tcp\":\"$CLOUD_TCP\",\"cloud_udp\":\"$CLOUD_UDP\""
        jstr "$WL_HIT"; o+=",\"wl\":$REPLY,\"wl_retry\":$([ "$WL_RETRY" = 1 ] && echo true || echo false)"
        jstr "$OWN_LONG"; o+=",\"owner\":$REPLY"
        cidr_range "$c" && self_overlap "$R_LO" "$R_HI"; o+=",\"self\":\"$SELF_HIT\""
        jarr "${IN_BLK[@]}"; o+=",\"blocks\":$REPLY"
        jarr "${IN_OTH[@]}"; o+=",\"others\":$REPLY"
        jarr "${IN_PORT[@]}"; o+=",\"ports\":$REPLY"
        jarr "${IN_OWNP[@]}"; o+=",\"own_partial\":$REPLY,\"partial_svc\":\"$IN_PSVC\",\"partial_extra\":\"$IN_PEXTRA\""
        ssh_ports; o+=",\"ssh\":\"$REPLY\""
        ftp_passive; o+=",\"ftp_pasv\":\"$REPLY\""
        inside_attacks "$c"; o+=",\"attacks\":$REPLY"
        local ownf=false opn="" rcn=0
        if [ "$IN_COVER" = "$c" ] && [[ "$(deny_line "$c")" == *"csf_autogroup:"* ]]; then
            ownf=true
            opn=$(grep -F "csf_autogroup: exception for $c [" "$CSF_DIR/csf.allow" 2>/dev/null | head -n 1 | sed -n 's/.*\[svc=\([a-z,]*\)\(;ports=\([0-9,-]*\)\)\{0,1\}\].*/\1|\3/p')
            restore_file "$c"; [ -s "$REPLY" ] && rcn=$(grep -vc -e '^#' -e '^$' "$REPLY")
        fi
        o+=",\"own_full\":$ownf,\"open\":\"${opn%%|*}\",\"open_extra\":\"$([ -n "$opn" ] && echo "${opn#*|}")\",\"restore\":$rcn"
        o+=",\"singles\":${#IN_SGL[@]},\"singles_dnd\":${#IN_SGLD[@]},\"temps\":${#IN_TMP[@]}"
        jarr "${IN_WATCH[@]/%/.0/24}"; o+=",\"watched\":$REPLY"
        # "boşalır": CSF'in sınırına giren satırlar (do not delete olanlar zaten sayılmaz)
        local fr=0 fx fl
        for fx in "${IN_BLK[@]}" "${IN_OTH[@]}" "${IN_SGL[@]}"; do fl="${DLINE[$fx]}"; [ -n "$fl" ] && ! is_dnd "$fl" && fr=$((fr + 1)); done
        o+=",\"removable\":$(( ${#IN_BLK[@]} + ${#IN_OTH[@]} + ${#IN_SGL[@]} + ${#IN_SGLD[@]} )),\"free\":$fr}"
        echo "$o"; return 0
    fi
    echo "$c${OWN_LONG:+  ($OWN_LONG)}"
    [ -n "$IN_COVER" ] && echo "  $(m "$M_IN_COVER" "$IN_COVER")"
    echo "  $(m "$M_IN_SUM" ${#IN_BLK[@]} $(( ${#IN_SGL[@]} + ${#IN_SGLD[@]} )) ${#IN_SGLD[@]} ${#IN_TMP[@]} ${#IN_WATCH[@]} ${#IN_OTH[@]})"
    [ -n "$WL_HIT" ] && echo "  $(m "$M_IN_WL" "$WL_HIT")"
    return 0
}
do_lookup() {
    local ip="$1" n host="" fwd=false txt asn="" pfx="" cc="" reg="" alloc="" asname="" a b c d i
    local deny="" temp="" wl="" rig="" pend="" ign="" line t tip port dir to note now
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
    # IP'yi kapsayan bütün seviyeler, en dardan genişe: blok / ağ / başka aralıklar, port sınırlı satırlar
    # (yalnız IP'ye özgü olanlar; "herkese" kuralları sunucu geneli), CC_DENY ülke ve ASN listeleri
    local covers=() cvj ln ccd ccp op own psv pps
    local -A pseen=()
    for i in "${!DC_LO[@]}"; do
        (( DC_LO[i] <= n && DC_HI[i] >= n )) || continue
        ln="$(deny_line "${DC_TXT[i]}")"
        op=$(grep -F "csf_autogroup: exception for ${DC_TXT[i]} [" "$CSF_DIR/csf.allow" 2>/dev/null | head -n 1 | sed -n 's/.*\[svc=\([a-z,]*\)\(;ports=\([0-9,-]*\)\)\{0,1\}\].*/\1|\3/p')
        jstr "${ln:-${DC_TXT[i]}}"
        covers+=("$(( DC_HI[i] - DC_LO[i] ))|{\"kind\":\"cidr\",\"cidr\":\"${DC_TXT[i]}\",\"line\":$REPLY${op:+,\"open\":\"${op%%|*}\",\"open_extra\":\"${op#*|}\"}}")
    done
    while IFS= read -r ln; do
        adv_parse "$ln" || continue
        adv_wide "$ADV_CIDR" && continue
        cidr_range "$ADV_CIDR" || continue
        (( R_LO <= n && R_HI >= n )) || continue
        own=false; psv=""; pps="$ADV_PORTS"
        if [[ "$ln" == *"# csf_autogroup:"* ]]; then          # eklentinin kısmi banı: bölünmüş satırlar tek kayıt
            [ -n "${pseen[$ADV_CIDR]}" ] && continue
            pseen[$ADV_CIDR]=1; own=true
            [[ "$ln" =~ $RE_SV ]] && psv="${BASH_REMATCH[1]}"
            pps=$(uniq_ports "$(grep -F "|s=$ADV_CIDR # csf_autogroup:" "$DENY_FILE" | sed -n 's/.*|d=\([0-9,_]*\)|s=.*/\1/p' | paste -sd, -)")
            ln="${ln/|d=$ADV_PORTS|/|d=$pps|}"
        fi
        jstr "$ln"
        covers+=("$(( R_HI - R_LO ))|{\"kind\":\"port\",\"cidr\":\"$ADV_CIDR\",\"proto\":\"$ADV_PROTO\",\"dir\":\"$ADV_DIR\",\"ports\":\"$pps\",\"own\":$own,\"svc\":\"$psv\",\"line\":$REPLY}")
    done < <(grep -F '|' "$DENY_FILE" 2>/dev/null | grep -v '^[[:space:]]*#')
    ccd=" $(conf_val CC_DENY | LC_ALL=C tr '[:lower:],' '[:upper:] ') "
    ccp=" $(conf_val CC_DENY_PORTS | LC_ALL=C tr '[:lower:],' '[:upper:] ') "
    if [ -n "$cc" ] && [[ "$ccd" == *" $cc "* ]]; then covers+=("4294967296|{\"kind\":\"cc\",\"what\":\"$cc\"}"); fi
    if [ -n "$asn" ] && [[ "$ccd" == *" AS$asn "* ]]; then covers+=("4294967297|{\"kind\":\"asn\",\"what\":\"AS$asn\"}"); fi
    local cpt cpu w
    cpt=$(conf_val CC_DENY_PORTS_TCP); cpu=$(conf_val CC_DENY_PORTS_UDP)
    [[ "$cpt" =~ ^[0-9,:_-]*$ ]] || cpt=""; [[ "$cpu" =~ ^[0-9,:_-]*$ ]] || cpu=""
    for w in ${cc:+$cc} ${asn:+AS$asn}; do
        [[ "$ccp" == *" $w "* ]] && covers+=("4294967298|{\"kind\":\"ccport\",\"what\":\"$w\",\"tcp\":\"$cpt\",\"udp\":\"$cpu\"}")
    done
    if cloud_has "$ip"; then covers+=("4294967299|{\"kind\":\"cloud\",\"what\":\"$REPLY\",\"tcp\":\"$CLOUD_TCP\",\"udp\":\"$CLOUD_UDP\"}"); fi
    cvj=$(printf '%s\n' "${covers[@]}" | grep . | sort -t'|' -k1,1n | cut -d'|' -f2- | paste -sd, -)
    if [ -r "$CSF_VAR/csf.tempban" ]; then
        while IFS='|' read -r t tip port dir to note; do
            cidr_range "$tip" 2>/dev/null || continue
            if (( R_LO <= n && R_HI >= n )); then
                temp="$tip · $(m "$M_TMIN_LEFT" "$(( ($(num "$t") + $(num "$to") - now) / 60 ))") · $note"; break
            fi
        done < "$CSF_VAR/csf.tempban"
    fi
    wl_overlap "$n" "$n" && wl="$WL_HIT"
    if [ -n "$host" ] && [ "${#RIGNORE[@]}" -gt 0 ]; then
        rig_match "$(printf '%s' "$host" | LC_ALL=C tr '[:upper:]' '[:lower:]')" "$ip" && rig="$REPLY"   # motorun beyaz liste kuralıyla aynı
    fi
    local p24="${ip%.*}"
    line=$(grep -m1 -E "^${p24//./\\.} " "$SAYAC_FILE" 2>/dev/null)
    [ -n "$line" ] && pend="${line#* }"
    if ign_until "${ip%.*}.0/24"; then ign="${ip%.*}.0/24 → $IGN_UNTIL"
    elif ign_until "${ip%.*.*}.0.0/16"; then ign="${ip%.*.*}.0.0/16 → $IGN_UNTIL"; fi

    if [ "$JSON" = 1 ]; then
        local o="{\"ok\":true,\"ip\":\"$ip\"" k v
        for k in host asname pfx cc reg alloc deny temp wl rig pend ign; do
            v="${!k}"; jstr "$v"; o+=",\"$k\":$REPLY"
        done
        local bp="${ip%.*}" btc=0
        [ -r "$CSF_VAR/csf.tempban" ] && btc=$(awk -F'|' -v p="$bp." 'index($2, p) == 1 && $2 !~ /\// && !S[$2]++ { n++ } END { print n + 0 }' "$CSF_VAR/csf.tempban")
        o+=",\"blk\":{\"s\":${count24[$bp]:-0},\"t\":$btc,\"ts\":$THRESHOLD_24,\"tt\":$THRESHOLD_TEMP_24}"
        o+=",\"covers\":[$cvj],\"asn\":\"$asn\",\"fwd\":$fwd,\"lookup\":$([ "$LOOK_INIT" = 1 ] && echo true || echo false)}"
        echo "$o"; return 0
    fi
    echo "$ip"
    printf '  %-18s %s\n' "$M_L_HOST" "${host:--}$([ -n "$host" ] && { [ "$fwd" = true ] && echo " ($M_L_FWD)" || echo " ($M_L_NOFWD)"; })"
    [ -n "$asn" ] && printf '  %-18s %s\n' "$M_L_OWNER" "AS$asn ${asname:-?}"
    [ -n "$pfx" ] && printf '  %-18s %s\n' "$M_L_PREFIX" "$pfx ($cc)"
    [ -n "$reg" ] && printf '  %-18s %s\n' "$M_L_REG" "$reg · $alloc"
    [ -n "$deny" ]  && printf '  %-18s %s\n' "$M_L_DENY" "$deny"
    local cv
    while IFS= read -r cv; do
        cv="${cv#*|}"
        case "$cv" in
            *'"kind":"cidr"'*)   printf '  %-18s %s\n' "$M_L_DENY" "$(printf '%s' "$cv" | sed -n 's/.*"line":"\(.*\)"\(,"open":.*\)\{0,1\}}$/\1/p')" ;;
            *'"kind":"port"'*)   printf '  %-18s %s\n' "$M_L_PORT" "$(printf '%s' "$cv" | sed -n 's/.*"line":"\(.*\)"}$/\1/p')" ;;
            *'"kind":"ccport"'*) printf '  %-18s %s\n' "$M_L_CCP" "$(printf '%s' "$cv" | sed -n 's/.*"what":"\([^"]*\)".*"tcp":"\([^"]*\)".*/\1 · tcp \2/p')" ;;
            *)                   printf '  %-18s %s\n' "$M_L_CCD" "$(printf '%s' "$cv" | sed -n 's/.*"what":"\([^"]*\)".*/\1/p')" ;;
        esac
    done < <(printf '%s\n' "${covers[@]}" | grep . | sort -t'|' -k1,1n)
    [ -n "$temp" ]  && printf '  %-18s %s\n' "$M_L_TEMP" "$temp"
    [ -n "$wl" ]    && printf '  %-18s %s\n' "$M_L_WL" "$wl"
    [ -n "$rig" ]   && printf '  %-18s %s\n' "$M_L_WL" "csf.rignore: $rig"
    [ -n "$pend" ]  && printf '  %-18s %s\n' "$M_L_PENDING" "${ip%.*}.0/24 · $pend"
    [ -n "$ign" ]   && printf '  %-18s %s\n' "$M_L_IGN" "$ign"
    return 0
}

# ── --action (WHM eklentisinin butonları) ───────────────────────────────────
# Çıkış kodu: 0 tamam · 1 başarısız · 2 geçersiz girdi · 3 meşgul · 4 ek onay gerekiyor (beyaz liste)
declare -A CSF_TN=() CSF_TMS=()   # csf çağrı sayısı ve süresi (ms), komut başına
ms_s() { printf '%d,%d' $(( $1 / 1000 )) $(( $1 % 1000 / 100 )); }   # 14230 → "14,2"
act_out() {      # CODE MESAJ
    local ok=false k tl=""; [ "$1" = 0 ] && ok=true
    # elle işlem uzun sürerse nerede geçtiği görülsün: "Süre: 14,2 sn · csf -r 1× 9,1 sn · csf -tr 5× 4,0 sn"
    if [ -n "$ACT_T0" ]; then
        for k in "${!CSF_TMS[@]}"; do tl+=" · csf $k ${CSF_TN[$k]}× $(ms_s "${CSF_TMS[$k]}") sn"; done
        log "$(m "$M_A_TIME" "$ACT_NAME" "$(ms_s $(( ($(date +%s%N) - ACT_T0) / 1000000 )))")$tl"
        ACT_T0=""
    fi
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
SSHD_CONFIG="${SSHD_CONFIG:-/etc/ssh/sshd_config}"
RE_SV='\[svc=([a-z,]*)'; RE_PO=';ports=([0-9,-]+)'
RE_DATE='- ([A-Z][a-z]{2} [A-Z][a-z]{2} +[0-9]{1,2} [0-9:]{8} [0-9]{4})[[:space:]]*$'
ssh_ports() {    # sunucunun SSH port(lar)ı → REPLY ("22" ya da "33330")
    local p
    p=$(sshd -T 2>/dev/null | awk '$1 == "port" && $2 ~ /^[0-9]+$/ { print $2 }' | sort -un | paste -sd, -)
    [ -z "$p" ] && p=$(awk 'tolower($1) == "port" && $2 ~ /^[0-9]+$/ { print $2 }' "$SSHD_CONFIG" 2>/dev/null | sort -un | paste -sd, -)
    REPLY="${p:-22}"
}
svc_ports() {    # SERVİS → REPLY = TCP portları (elle bandaki servis seçimi)
    case "$1" in
        web)  REPLY="80,443" ;;
        ssh)  ssh_ports ;;
        ftp)  REPLY="21" ;;
        cp)   REPLY="2077,2078,2079,2080,2082,2083,2086,2087,2095,2096" ;;   # cPanel, WHM, Webmail, WebDAV, CalDAV/CardDAV
        min)  REPLY="25" ;;                                 # gelen posta (teslim)
        sync) REPLY="465,587,110,995,143,993" ;;            # posta eşitleme: gönderim, IMAP, POP3
        mout) REPLY="25" ;;                                 # giden posta
        wout) REPLY="80,443" ;;                             # giden web: sunucunun o aralıktaki API'lere, yedek hedeflerine erişimi
        dns)  REPLY="53" ;;
        *)    REPLY=""; return 1 ;;
    esac
}
uniq_ports() {   # "443,80,80,30000_35000" → "80,443,30000_35000" (tekil portlar ve CSF aralıkları, tekrarsız)
    tr ',' '\n' <<< "$1" | awk '($1 ~ /^[0-9]+$/ && $1 >= 1 && $1 <= 65535) || $1 ~ /^[0-9]+_[0-9]+$/' | sort -t_ -k1,1n -k2,2n -u | paste -sd, -
}
split_ports() {  # "8080, 30000-35000" → PS_ONE (tekil portlar, virgüllü) · PS_RNG (CSF aralıkları "A_B", boşluklu); 1 = geçersiz
    local x a b
    PS_ONE=""; PS_RNG=""
    [ -z "$1" ] && return 0
    [[ "$1" =~ ^[0-9]{1,5}(-[0-9]{1,5})?(,[0-9]{1,5}(-[0-9]{1,5})?)*$ ]] || return 1
    for x in ${1//,/ }; do
        if [[ "$x" == *-* ]]; then
            a=$((10#${x%-*})); b=$((10#${x#*-}))
            [ "$a" -ge 1 ] && [ "$b" -le 65535 ] && [ "$a" -lt "$b" ] || return 1
            PS_RNG+="${PS_RNG:+ }${a}_${b}"
        else
            a=$((10#$x)); [ "$a" -ge 1 ] && [ "$a" -le 65535 ] || return 1
            PS_ONE+="${PS_ONE:+,}$a"
        fi
    done
    return 0
}
ftp_passive() {  # FTP'nin pasif port aralığı (dosya aktarımı) → REPLY "30000_35000"; bulunamazsa boş
    local r=""
    [ -r "${PUREFTPD_CONF:-/etc/pure-ftpd.conf}" ] && r=$(awk '$1 == "PassivePortRange" && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ { print $2 "_" $3; exit }' "${PUREFTPD_CONF:-/etc/pure-ftpd.conf}")
    [ -z "$r" ] && [ -r "${PROFTPD_CONF:-/etc/proftpd.conf}" ] && r=$(awk '$1 == "PassivePorts" && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ { print $2 "_" $3; exit }' "${PROFTPD_CONF:-/etc/proftpd.conf}")
    # yoksa CSF'in TCP_IN'indeki ilk yüksek aralık (cPanel kurulumlarında pasif FTP için açılan 30000:35000 gibi)
    [ -z "$r" ] && r=$(conf_val TCP_IN | tr ',' '\n' | awk -F: 'NF == 2 && $1 >= 1024 && $2 > $1 { print $1 "_" $2; exit }')
    REPLY="$r"
}
chunks15() {     # "1,2,…" → 15'erlik gruplar (iptables multiport tek kuralda en çok 15 port alır)
    tr ',' '\n' <<< "$1" | awk 'NF { a[++n] = $1 } END { for (i = 1; i <= n; i += 15) { s = a[i]; for (j = i + 1; j < i + 15 && j <= n; j++) s = s "," a[j]; print s } }'
}
part_ports() {   # BSVC + BPORTS → REPLY = kapatılacak TCP portları; PART_UDPP = UDP'de de kapanacaklar; 1 = boş ya da geçersiz
    # UDP: DNS 53; web 443 — HTTP/3 (QUIC) UDP 443'ten çalışır, LiteSpeed ve yeni Apache/nginx'te açık olabilir
    local x all=""
    PART_UDPP=""
    for x in ${BSVC//,/ }; do
        case "$x" in
            web) svc_ports web; all+="${all:+,}$REPLY"; PART_UDPP+="${PART_UDPP:+,}443" ;;
            ssh|ftp|cp|min|sync) svc_ports "$x"; all+="${all:+,}$REPLY" ;;
            dns) all+="${all:+,}53"; PART_UDPP+="${PART_UDPP:+,}53" ;;
            *) return 1 ;;
        esac
    done
    split_ports "$BPORTS" || return 1
    all+="${all:+,}$PS_ONE"; PART_RNG="$PS_RNG"
    REPLY=$(uniq_ports "$all")
    [ -n "$REPLY$PART_RNG" ]
}
exc_lines() {    # CIDR → EXC_LINES: tam banın yanına csf.allow'a girecek izin satırları; 1 = boş ya da geçersiz seçim
    local c="$1" x tin="" tout="" uin="" uout="" mk ch rng=""
    EXC_LINES=""
    [ -n "$BSVC$BPORTS" ] || return 1
    for x in ${BSVC//,/ }; do
        case "$x" in
            web|ssh|ftp|cp|min|sync) svc_ports "$x"; tin+="${tin:+,}$REPLY" ;;   # aralıktan sunucuya gelen
            mout|wout) svc_ports "$x"; tout+="${tout:+,}$REPLY" ;;               # sunucudan aralığa giden
            dns) tin+="${tin:+,}53"; tout+="${tout:+,}53"; uin+="${uin:+,}53"; uout+="${uout:+,}53" ;;   # iki yönde, TCP ve UDP
            *) return 1 ;;
        esac
        case "$x" in                                                           # HTTP/3 (QUIC): UDP 443
            web) uin+="${uin:+,}443" ;;
            wout) uout+="${uout:+,}443" ;;
        esac
    done
    split_ports "$BPORTS" || return 1
    tin+="${tin:+,}$PS_ONE"; rng="$PS_RNG"
    if [[ ",$BSVC," == *,ftp,* ]]; then ftp_passive; [ -n "$REPLY" ] && rng+="${rng:+ }$REPLY"; fi   # FTP aktarımı pasif portlardan
    [ -n "$tin$tout$rng" ] || return 1
    mk="csf_autogroup: exception for $c [svc=$BSVC${BPORTS:+;ports=$BPORTS}] - do not delete"
    tin=$(uniq_ports "$tin"); tout=$(uniq_ports "$tout"); uin=$(uniq_ports "$uin"); uout=$(uniq_ports "$uout")
    # CSF önce izin, sonra ban zincirine bakar; ban "kurulmuş bağlantı" kuralından da önce geldiği için her
    # servis iki yönlü yazılır: istek ve yanıt (yanıtın kaynak portu)
    for ch in $(chunks15 "$tin"); do EXC_LINES+="tcp|in|d=$ch|s=$c # $mk"$'\n'"tcp|out|s=$ch|d=$c # $mk"$'\n'; done
    for ch in $(chunks15 "$tout"); do EXC_LINES+="tcp|out|d=$ch|d=$c # $mk"$'\n'"tcp|in|s=$ch|s=$c # $mk"$'\n'; done
    for ch in $rng; do EXC_LINES+="tcp|in|d=$ch|s=$c # $mk"$'\n'"tcp|out|s=$ch|d=$c # $mk"$'\n'; done
    for ch in $(chunks15 "$uin"); do EXC_LINES+="udp|in|d=$ch|s=$c # $mk"$'\n'"udp|out|s=$ch|d=$c # $mk"$'\n'; done
    for ch in $(chunks15 "$uout"); do EXC_LINES+="udp|out|d=$ch|d=$c # $mk"$'\n'"udp|in|s=$ch|s=$c # $mk"$'\n'; done
    EXC_LINES="${EXC_LINES%$'\n'}"
    [ -n "$EXC_LINES" ]
}
# ── Dosya yazımı: csf.deny / csf.allow tek kilitli yeniden yazımla değişir ───────
# csf'in kilidi (flock) tutulur, inode korunur (cat >), önce yedek alınır. Sonuç awk'tan geçtiği için son satır
# her zaman satır sonuyla biter: sonu satır sonsuz bir dosyada eklenen satır öncekinin yorumuna yapışmaz.
file_rewrite() { # DOSYA SİL_ADRESLER SİL_METİNLER EKLENECEK — ilk alanı listedeki adres olan ya da listedeki
    # metni içeren satırlar silinir, EKLENECEK satırlar sona eklenir; 1 = yazılamadı (dosya değişmez)
    local f="$1" tmp rc
    [ -e "$f" ] || : > "$f"
    tmp=$(mktemp) || return 1
    cp -p "$f" "$f.autogroup.bak" 2>/dev/null
    (
        command -v flock >/dev/null 2>&1 && { flock -x 8 || exit 1; }
        AG_ADD="$4" awk -v tf="$2" -v sf="$3" '
            BEGIN { while ((getline l < tf) > 0) if (l != "") T[l] = 1
                    while ((getline l < sf) > 0) if (l != "") S[++ns] = l }
            { split($0, a, /[ \t]/); k = a[1]; sub(/\r$/, "", k); if (k in T) next
              for (i = 1; i <= ns; i++) if (index($0, S[i])) next
              print }
            END { n = split(ENVIRON["AG_ADD"], L, "\n"); for (i = 1; i <= n; i++) if (L[i] != "") print L[i] }' "$f" > "$tmp" || exit 1
        cat "$tmp" > "$f" || exit 1
    ) 8<"$f"
    rc=$?; rm -f "$tmp"; return $rc
}
file_append_locked() { file_rewrite "$1" /dev/null /dev/null "$2"; }   # DOSYA SATIRLAR
file_drop_locked() {   # DOSYA METİN — metni içeren satırları sil
    local sf rc
    grep -qF -- "$2" "$1" 2>/dev/null || return 0
    sf=$(mktemp) || return 1
    printf '%s\n' "$2" > "$sf"
    file_rewrite "$1" /dev/null "$sf" ""; rc=$?; rm -f "$sf"; return $rc
}
own_partials_inside() { # LO HI → eklentinin bu aralıktaki kısmi banlarının CIDR'leri (tekrarsız)
    local l
    grep -F '# csf_autogroup:' "$DENY_FILE" 2>/dev/null | grep -F '|' | while IFS= read -r l; do
        adv_parse "$l" && cidr_range "$ADV_CIDR" && (( R_LO >= $1 && R_HI <= $2 )) && echo "$ADV_CIDR"
    done | sort -u
}
part_shown() {   # PORTLAR → iletide gösterilecek liste (CSF aralıkları 30000-35000 biçiminde)
    local x="$1${PART_RNG:+${1:+,}${PART_RNG// /,}}"
    printf '%s' "${x//_/-}"
}
partial_write() { # CIDR BITS PORTLAR → kısmi ban satırları; aynı aralığın önceki kısmi banının yerine, tek yazımda
    local c="$1" b="$2" pp="$3" dt mk lines="" ch sf rc
    dt=$(LC_ALL=C date '+%a %b %d %H:%M:%S %Y')
    mk="csf_autogroup: $(m "$M_A_PCOMMENT" "$b" "$AG_BY") [svc=$BSVC${BPORTS:+;ports=$BPORTS}] - do not delete - $dt"
    for ch in $(chunks15 "$pp"); do lines+="tcp|in|d=$ch|s=$c # $mk"$'\n'; done
    for ch in $PART_RNG; do lines+="tcp|in|d=$ch|s=$c # $mk"$'\n'; done      # CSF'te aralık tek başına satır ister
    [ -n "$PART_UDPP" ] && lines+="udp|in|d=$(uniq_ports "$PART_UDPP")|s=$c # $mk"$'\n'
    sf=$(mktemp) || return 1
    printf '%s\n' "|s=$c # csf_autogroup:" > "$sf"
    file_rewrite "$DENY_FILE" /dev/null "$sf" "$lines"; rc=$?; rm -f "$sf"; return $rc
}
ban_partial() {  # CIDR BITS PORTLAR — yalnız seçilen servislere gelen bağlantıları kapatan gelişmiş satır(lar)
    local c="$1" b="$2" pp="$3" jw
    partial_write "$c" "$b" "$pp" || { act_out 1 "$(m "$M_A_BANFAIL" "$c" "csf.deny")"; return 1; }
    csf_run -r                                                        # gelişmiş satırı csf -d ekleyemez: yeniden yükle
    jstr "$WL_HIT"; jw="$REPLY"
    owners_load; inside_owner "${c%.0/24}"; owner_kv
    log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_PBANNED" "$c" "$(part_shown "$pp")")")"
    ev manual_ban "$c" "by=\"$AG_BY\"" "wl=$jw" "force=$([ "$FORCE" = 1 ] && echo true || echo false)" "${OKV[@]}" \
       "mode=\"svc\"" "svc=\"$BSVC\"" "extra=\"$BPORTS\"" "ports=\"$pp\"" "total=$IN_EVN" "ips=[$(IFS=,; echo "${IN_EVJ[*]}")]"
    act_out 0 "$(m "$M_A_PBANNED" "$c" "$(part_shown "$pp")")"
}
restore_save() { # CIDR SATIRLAR → kapsananların kopyası; ilk satırda banın zamanı (geri yüklemede yaş hesabı için)
    local rf
    restore_file "$1"; rf="$REPLY"
    mkdir -p "$RESTORE_DIR" 2>/dev/null; chmod 700 "$RESTORE_DIR" 2>/dev/null
    { printf '#t|%s\n' "$(date +%s)"; printf '%s\n' "$2"; } > "$rf.tmp" 2>/dev/null && mv -f "$rf.tmp" "$rf"
}
unban_full_core() { # CIDR → tam banı kaldır; RESTORE=1 ise kapsananları geri yükle; banın izin istisnaları da gider.
    # Hepsi tek kilitli yazım ve tek csf -r (satır başına csf -d / -dr yerine) → UB_RN (geri yüklenen), UB_ERR
    local t="$1" rf since now delta rl body k ts nd dl="" al="" n=0 tokf subf
    local -A PRC=()
    UB_RN=0; UB_ERR=""
    restore_file "$t"; rf="$REPLY"
    local -A HAVE=()
    if [ "$RESTORE" = 1 ] && [ -s "$rf" ]; then
        while read -r k _; do [ -n "$k" ] && HAVE[$k]=1; done < "$DENY_FILE"
        now=$(date +%s)
        since=$(sed -n 's/^#t|//p' "$rf" | head -n 1)
        [[ "$since" =~ ^[0-9]+$ ]] || since=$(stat -c %Y "$rf" 2>/dev/null || echo "$now")
        delta=$(( now - since )); [ "$delta" -lt 0 ] && delta=0
        while IFS= read -r rl; do
            case "$rl" in
                '#t|'*|'') continue ;;
                'allow|'*) body="${rl#allow|}"
                           grep -qxF -- "$body" "$CSF_DIR/csf.allow" 2>/dev/null || al+="$body"$'\n' ;;
                *)  k="${rl%%[[:space:]]*}"
                    if [[ "$k" =~ $CIDR4_RE ]]; then
                        [ -n "${HAVE[$k]}" ] && continue
                        # otomatik blok banı: ban altında geçen süre yaşına sayılmaz (eski blok temizliği hemen silmesin)
                        if [ "$delta" -gt 0 ] && [[ "$rl" == *Auto-grouped* && "$rl" =~ $RE_DATE ]]; then
                            ts=$(LC_ALL=C date -d "${BASH_REMATCH[1]}" +%s 2>/dev/null) && \
                            nd=$(LC_ALL=C date -d "@$(( ts + delta ))" '+%a %b %e %H:%M:%S %Y' 2>/dev/null) && rl="${rl/"${BASH_REMATCH[1]}"/$nd}"
                        fi
                        n=$((n + 1))
                    else
                        grep -qxF -- "$rl" "$DENY_FILE" && continue      # kısmi ban satırı zaten varsa
                        if adv_parse "$rl" && [ -z "${PRC[$ADV_CIDR]}" ]; then PRC[$ADV_CIDR]=1; n=$((n + 1)); fi
                    fi
                    dl+="$rl"$'\n' ;;
            esac
        done < "$rf"
    fi
    tokf=$(mktemp) || { UB_ERR="$(m "$M_A_UNBANFAIL" "$t" "mktemp")"; return 1; }
    printf '%s\n' "$t" > "$tokf"
    if ! file_rewrite "$DENY_FILE" "$tokf" /dev/null "$dl"; then rm -f "$tokf"; UB_ERR="$(m "$M_A_UNBANFAIL" "$t" "csf.deny")"; return 1; fi
    rm -f "$tokf"
    deny_has "$t" && { UB_ERR="$(m "$M_A_UNBANFAIL" "$t" "csf.deny")"; return 1; }
    if [ -n "$al" ] || grep -qF "csf_autogroup: exception for $t [" "$CSF_DIR/csf.allow" 2>/dev/null; then
        subf=$(mktemp); printf '%s\n' "csf_autogroup: exception for $t [" > "$subf"
        file_rewrite "$CSF_DIR/csf.allow" /dev/null "$subf" "$al"; rm -f "$subf"
    fi
    rm -f "$rf"                                   # yalnız yazımlar tuttuktan sonra
    UB_RN=$n
    csf_run -r
    return 0
}
replace_full() { # CIDR BITS → eklentinin tam banının kipini değiştir. Önce yeni hâl yazılır, sonra eskisi kalkar:
    # yarıda kesilse de aralık açıkta kalmaz
    local c="$1" b="$2" xn=0 msg subf
    case "$BMODE" in
        all|exc)
            subf=$(mktemp); printf '%s\n' "csf_autogroup: exception for $c [" > "$subf"
            if ! file_rewrite "$CSF_DIR/csf.allow" /dev/null "$subf" "$([ "$BMODE" = exc ] && printf '%s' "$EXC_LINES")"; then
                rm -f "$subf"; act_out 1 "$(m "$M_A_BANFAIL" "$c" "csf.allow")"; return
            fi
            rm -f "$subf"
            [ "$BMODE" = exc ] && xn=$(grep -c . <<< "$EXC_LINES")
            csf_run -r
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_CHANGED" "$c")")"
            ev manual_change "$c" "by=\"$AG_BY\"" "mode=\"$BMODE\"" $([ "$BMODE" = exc ] && echo "open=\"$BSVC\" extra=\"$BPORTS\"")
            msg="$(m "$M_A_CHANGED" "$c")"; [ "$xn" -gt 0 ] && msg="$(m "$M_A_EXC" "$msg" "$xn")"
            act_out 0 "$msg" ;;
        svc)
            # kısmi ban aralığı kapsamaz: önce kısmi satırlar yazılır, sonra tam ban kalkar ve kaldırdıkları geri gelir
            part_ports
            local pp="$REPLY"
            partial_write "$c" "$b" "$pp" || { act_out 1 "$(m "$M_A_BANFAIL" "$c" "csf.deny")"; return; }
            RESTORE=1; unban_full_core "$c" || { act_out 1 "$UB_ERR"; return; }
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_CHANGED" "$c")")"
            ev manual_change "$c" "by=\"$AG_BY\"" "mode=\"svc\"" "svc=\"$BSVC\"" "extra=\"$BPORTS\"" "ports=\"$pp\"" "restored=$UB_RN"
            msg="$(m "$M_A_PBANNED" "$c" "$(part_shown "$pp")")"
            [ "$UB_RN" -gt 0 ] && msg="$(m "$M_A_RESTORED" "$msg" "$UB_RN")"
            act_out 0 "$msg" ;;
    esac
}
orphans_clean() { # banı CSF ekranından (eklenti dışından) kaldırılmış elle banların artıkları: kurtarma kopyaları
    # ve "exception for" izin satırları. Başka bir kopyanın içinde saklanan iç içe banlarınkiler korunur.
    local f c n=0 x sf o
    if [ -d "$RESTORE_DIR" ]; then
        for f in "$RESTORE_DIR"/*; do
            [ -f "$f" ] || continue
            case "$f" in *.tmp) continue ;; esac
            c="${f##*/}"; c="${c//_//}"
            [[ "$c" =~ $CIDR4_RE ]] || continue
            deny_has "$c" && continue
            for o in "$RESTORE_DIR"/*; do
                [ "$o" != "$f" ] && [ -f "$o" ] && grep -q "^${c//./\\.} " "$o" 2>/dev/null && continue 2
            done
            rm -f "$f"; n=$((n + 1))
        done
    fi
    sf=$(mktemp) || return 0
    while read -r x; do
        deny_has "$x" || printf '%s\n' "csf_autogroup: exception for $x [" >> "$sf"
    done < <(grep -oE 'csf_autogroup: exception for [0-9./]+ \[' "$CSF_DIR/csf.allow" 2>/dev/null | awk '{ print $4 }' | sort -u)
    if [ -s "$sf" ] && file_rewrite "$CSF_DIR/csf.allow" /dev/null "$sf" ""; then
        n=$(( n + $(grep -c . "$sf") )); csf_run -r
    fi
    rm -f "$sf"
    [ "$n" -gt 0 ] && log "$(m "$M_ORPHANS" "$n")"
    return 0
}
udp_has() {      # DOSYA ÖNEK SONEK PORT → "ÖNEK<portlar>SONEK" biçiminde, port listesinde PORT olan satır var mı
    awk -v pre="$2" -v suf="$3" -v p="$4" 'index($0, pre) == 1 { r = substr($0, length(pre) + 1); i = index(r, suf)
        if (i) { n = split(substr(r, 1, i - 1), a, ","); for (j = 1; j <= n; j++) if (a[j] == p) f = 1 } } END { exit !f }' "$1" 2>/dev/null
}
proto_fix() {    # 1.9.14 öncesi konan kısmi ban ve istisnalarda web'in UDP 443'ü (HTTP/3) yoktu: eksik satırları ekle
    local l c svc mk dadd="" aadd="" fixed=""
    local -A seen=()
    while IFS= read -r l; do                                           # kısmi banlar: csf.deny
        adv_parse "$l" || continue; c="$ADV_CIDR"
        [ -n "${seen[d$c]}" ] && continue; seen[d$c]=1
        [[ "$l" =~ $RE_SV ]] && svc="${BASH_REMATCH[1]}" || continue
        [[ ",$svc," == *,web,* ]] || continue
        udp_has "$DENY_FILE" "udp|in|d=" "|s=$c " 443 && continue
        dadd+="udp|in|d=443|s=$c # ${l#*# }"$'\n'; fixed+=" $c"
    done < <(grep -F '# csf_autogroup:' "$DENY_FILE" 2>/dev/null | grep '^tcp|in|d=')
    while IFS= read -r l; do                                           # istisnalar: csf.allow
        [[ "$l" =~ exception\ for\ ([0-9./]+)\ \[svc=([a-z,]*) ]] || continue
        c="${BASH_REMATCH[1]}"; svc="${BASH_REMATCH[2]}"
        [ -n "${seen[a$c]}" ] && continue; seen[a$c]=1
        mk="${l#*# }"
        if [[ ",$svc," == *,web,* ]] && ! udp_has "$CSF_DIR/csf.allow" "udp|in|d=" "|s=$c " 443; then
            aadd+="udp|in|d=443|s=$c # $mk"$'\n'"udp|out|s=443|d=$c # $mk"$'\n'; fixed+=" $c"
        fi
        if [[ ",$svc," == *,wout,* ]] && ! udp_has "$CSF_DIR/csf.allow" "udp|out|d=" "|d=$c " 443; then
            aadd+="udp|out|d=443|d=$c # $mk"$'\n'"udp|in|s=443|s=$c # $mk"$'\n'; fixed+=" $c"
        fi
    done < <(grep -F 'csf_autogroup: exception for ' "$CSF_DIR/csf.allow" 2>/dev/null | grep '^tcp|')
    [ -n "$fixed" ] || return 0
    [ -n "$dadd" ] && { file_append_locked "$DENY_FILE" "$dadd" || return 0; }
    [ -n "$aadd" ] && { file_append_locked "$CSF_DIR/csf.allow" "$aadd" || return 0; }
    csf_run -r
    for c in $(printf '%s\n' $fixed | sort -u); do log "$(m "$M_FIX_UDP" "$c")"; ev fix_udp "$c" "add=\"udp 443\""; done
    return 0
}
ips_after() {    # EPOCH IP… → REPLY = bu IP'lerden EPOCH'tan sonra banlananlar (tekilde nottaki tarih, geçicide epoch),
    # IPA_CLS = onların ban sebebinden servisleri ("web 3,ssh 1")
    local se="$1" sk x out; shift
    sk=$(LC_ALL=C date -d "@$se" +%Y%m%d%H%M%S 2>/dev/null || echo 0)
    out=$( { printf 'W|%s\n' "$@"; for x in "${!SINGLE_NOTE[@]}"; do printf '%s|%s\n' "$x" "${SINGLE_NOTE[$x]}"; done
             [ -r "$CSF_VAR/csf.tempban" ] && awk -F'|' '$2 !~ /\// { print $2 "|" $6 "|e:" $1 }' "$CSF_VAR/csf.tempban"; } |
        awk -F'|' -v se="$se" -v sk="$sk" "$AWK_CLS"'
            $1 == "W" { W[$2] = 1; next }
            ($1 in W) && !($1 in OK) {
                if ($3 ~ /^e:/) ok = substr($3, 3) + 0 > se + 0; else { d = datekey($2); ok = d > sk + 0 }
                if (ok) { OK[$1] = 1; L = L " " $1; C[cls($2)]++ } }
            END { o = ""; for (k in C) o = o (o == "" ? "" : ",") k " " C[k]; print o "|" L }')
    IPA_CLS="${out%%|*}"; REPLY="${out#*|}"
}
# ── Sağlayıcı banı ve izinli servisler ──────────────────────────────────────
PROV_STATE="$(dirname "$SAYAC_FILE")/provider"      # eklentinin CSF'e yazdıkları (kapatınca yalnız bunlar geri alınır)
SVC_OUT="$CSF_DIR/csf_autogroup.services.allow"
svc_urls() {     # KAYNAK → REPLY = "ad|adres" kayıtları (boşlukla); kaynaklar kendi listelerini yayımlıyor
    local G=https://developers.google.com/static/crawling/ipranges
    case "$1" in
        google)     REPLY="google-common|$G/common-crawlers.json google-special|$G/special-crawlers.json google-user|$G/user-triggered-fetchers.json google-user-google|$G/user-triggered-fetchers-google.json" ;;
        bing)       REPLY="bing|https://www.bing.com/toolbox/bingbot.json" ;;
        apple)      REPLY="apple|https://search.developer.apple.com/applebot.json" ;;
        duckduckgo) REPLY="duckduckgo|https://duckduckgo.com/duckduckbot.json" ;;
        openai)     REPLY="openai-gptbot|https://openai.com/gptbot.json openai-search|https://openai.com/searchbot.json openai-user|https://openai.com/chatgpt-user.json" ;;
        stripe)     REPLY="stripe|https://stripe.com/files/ips/ips_webhooks.txt" ;;
        mollie)     REPLY="mollie|https://ip-ranges.mollie.com/ips.txt" ;;
        uptimerobot) REPLY="uptimerobot|https://uptimerobot.com/inc/files/ips/IPv4.txt" ;;
        pingdom)    REPLY="pingdom|https://my.pingdom.com/probes/ipv4" ;;
        statuscake) REPLY="statuscake|https://www.statuscake.com/API/Locations/txt" ;;
        # Outlook / Exchange Online: yeni Outlook ve Outlook mobil, IMAP hesaplarını bu sunucular üzerinden eşitler ve gönderir
        microsoft365) REPLY="microsoft365|https://endpoints.office.com/endpoints/worldwide?ServiceAreas=Exchange&clientrequestid=b10c5ed1-bad1-445f-b386-b919946339a7" ;;
        *)          REPLY="" ;;
    esac
}
svc_srclist() {  # → REPLY = araca verilecek kaynaklar (satır satır): seçilen katalog kaynakları + elle eklenenler
    local x o=""
    local e n2 u
    for x in ${SVC_SOURCES//,/ }; do
        svc_urls "$x"
        for e in $REPLY; do
            n2="${e%%|*}"; u=$(printf '%s\n' $SVC_URLS | grep -m1 "^$n2|" | cut -d'|' -f2-)   # panelde değiştirilmiş adres
            o+="$n2|${u:-${e#*|}}"$'\n'
        done
    done
    for x in $SVC_EXTRA; do o+="extra-$x"$'\n'; done
    REPLY="$o"
}
CLOUD_DIR="$(dirname "$SAYAC_FILE")/cloud"
cloud_urls() {   # KAYNAK → REPLY = varsayılan liste adresi (firmanın kiraladığı sunucuların adresleri)
    case "$1" in
        gcp)          REPLY="https://www.gstatic.com/ipranges/cloud.json" ;;
        aws)          REPLY="https://ip-ranges.amazonaws.com/ip-ranges.json" ;;            # araç yalnız EC2'yi alır
        azure)        REPLY="https://www.microsoft.com/en-us/download/details.aspx?id=56519" ;;   # haftalık dosya bu sayfadan bulunur; araç AzureCloud'u alır
        oracle)       REPLY="https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json" ;;
        digitalocean) REPLY="https://digitalocean.com/geo/google.csv" ;;
        linode)       REPLY="https://geoip.linode.com/" ;;
        vultr)        REPLY="https://geofeed.constant.com/?text" ;;
        *)            REPLY="" ;;
    esac
}
cloud_label() {  # KAYNAK → REPLY = görünen ad
    case "$1" in gcp) REPLY="Google Cloud" ;; aws) REPLY="AWS EC2" ;; azure) REPLY="Azure" ;; oracle) REPLY="Oracle Cloud" ;; digitalocean) REPLY="DigitalOcean" ;;
        linode) REPLY="Linode (Akamai)" ;; vultr) REPLY="Vultr" ;; x-*) REPLY="${1#x-}" ;; *) REPLY="$1" ;; esac
}
cloud_srclist() { # → REPLY = araca verilecek "ad|adres" satırları (panelde değiştirilmiş adres önce)
    local IFS=$' \t\n' x u o=""
    for x in ${CLOUD_SOURCES//,/ }; do
        cloud_urls "$x"; [ -n "$REPLY" ] || continue
        u=$(printf '%s\n' $CLOUD_URLS | grep -m1 "^$x|" | cut -d'|' -f2-)
        o+="$x|${u:-$REPLY}"$'\n'
    done
    for x in $CLOUD_EXTRA; do o+="x-${x%%|*}|${x#*|}"$'\n'; done      # kendi listeleriniz
    REPLY="$o"
}
cloud_enforce() { # FORCE(1 = listeleri şimdi indir) → bulut listesi banını kur / onar / kaldır
    local IFS=$' \t\n' tool="$SELF_DIR/tools/cloud-ban.sh" sig sigf="$CLOUD_DIR/.sig" act self="" i lf need=0 n st
    [ -r "$tool" ] || return 0
    if [ "$CLOUD_BAN" = 1 ] && [ -n "${CLOUD_ACTIVE// /}" ]; then
        command -v ipset >/dev/null 2>&1 || return 0
        mkdir -p "$CLOUD_DIR" || return 0
        [ "$WL_LOADED" = 1 ] || load_whitelist
        for i in "${!WL_TXT[@]}"; do [[ "${WL_TXT[i]}" == "$M_WL_SELF: "* ]] && self+="${WL_TXT[i]#*: } "; done   # sunucunun kendi IP'leri listeden çıkarılır
        act="$CLOUD_ACTIVE"
        printf '%s\n' "$act" > "$CLOUD_DIR/active"; printf 'tcp=%s\nudp=%s\n' "$CLOUD_TCP" "$CLOUD_UDP" > "$CLOUD_DIR/ports"; printf '%s\n' "$self" > "$CLOUD_DIR/self"
        cloud_srclist; sig=$(printf '%s' "$REPLY" | cksum | cut -d' ' -f1)
        for n in $act; do [ -s "$CLOUD_DIR/$n.txt" ] || need=1; done
        [ "${1:-0}" = 1 ] && need=1
        [ "$(cat "$sigf" 2>/dev/null)" != "$sig" ] && need=2               # kaynak ya da adres değişti: hemen
        st=$(cat "$CLOUD_DIR/active" "$CLOUD_DIR/ports" "$CLOUD_DIR/self" | cksum | cut -d' ' -f1)
        if [ "$need" != 0 ]; then
            # son indirme başarısızsa (sunucu dışarı bağlanamıyor) zorlanmadıkça saatte birden sık denenmez
            # .fail = "zaman imza": kaynak ayarı değişince hemen denenir, ama AYNI ayarla başarısız olduysa yine saatte bir
            # (önce imza değişince her tur deneniyordu; sunucu dışarı çıkamıyorsa her tur 300 sn kilit tutuluyordu)
            local lfs=""; lf=""; [ -r "$CLOUD_DIR/.fail" ] && read -r lf lfs < "$CLOUD_DIR/.fail"
            if [ "${1:-0}" = 1 ] || ! [[ "$lf" =~ ^[0-9]+$ ]] || [ $(( $(date +%s) - lf )) -ge 3600 ] || { [ "$need" = 2 ] && [ "$lfs" != "$sig" ]; }; then
                if SRC="$REPLY" CACHE="$CLOUD_DIR" CSF_DIR="$CSF_DIR" LOG_FILE="$LOG_FILE" timeout 300 bash "$tool" >/dev/null 2>&1 9>&-; then
                    printf '%s' "$sig" > "$sigf"; printf '%s' "$st" > "$CLOUD_DIR/.applied"; rm -f "$CLOUD_DIR/.fail"
                else echo "$(date +%s) $sig" > "$CLOUD_DIR/.fail"; fi
                return 0
            fi
        fi
        # listeler hazır: kural ve csfpost satırı yerinde mi, kaynak seçimi / portlar / sunucu IP'leri değişti mi
        if ! iptables -C LOCALINPUT ! -i lo -j AG_CLOUD 2>/dev/null || ! grep -qF "# csf_autogroup cloud" "$CSF_DIR/csfpost.sh" 2>/dev/null ||
           [ "$(cat "$CLOUD_DIR/.applied" 2>/dev/null)" != "$st" ]; then
            CACHE="$CLOUD_DIR" CSF_DIR="$CSF_DIR" LOG_FILE="$LOG_FILE" timeout 120 bash "$tool" --sync >/dev/null 2>&1 9>&- && printf '%s' "$st" > "$CLOUD_DIR/.applied"
        fi
    elif [ -s "$CLOUD_DIR/active" ] || grep -qF "# csf_autogroup cloud" "$CSF_DIR/csfpost.sh" 2>/dev/null; then
        CACHE="$CLOUD_DIR" CSF_DIR="$CSF_DIR" LOG_FILE="$LOG_FILE" timeout 120 bash "$tool" --remove >/dev/null 2>&1 9>&-
        rm -f "$sigf" "$CLOUD_DIR/.applied"; log "$M_CLOUD_REMOVED"
    fi
    return 0
}
cloud_probe() {  # seçili olmayan hazır listeleri indir (CSF'e yazılmaz): panel "olay kaydında N saldırgan bu listede" der
    local IFS=$' \t\n' tool="$SELF_DIR/tools/cloud-ban.sh" x u o=""
    [ -r "$tool" ] || return 0
    for x in $CLOUD_CATALOG; do
        [[ " $CLOUD_ACTIVE " == *" $x "* ]] && continue
        cloud_urls "$x"; [ -n "$REPLY" ] || continue
        u=$(printf '%s\n' $CLOUD_URLS | grep -m1 "^$x|" | cut -d'|' -f2-)
        o+="$x|${u:-$REPLY}"$'\n'
    done
    [ -n "$o" ] || return 0
    mkdir -p "$CLOUD_DIR/probe" && SRC="$o" CACHE="$CLOUD_DIR/probe" LOG_FILE="$LOG_FILE" NOAPPLY=1 timeout 300 bash "$tool" >/dev/null 2>&1 9>&-
    return 0
}
cloud_pot() {    # → REPLY = JSON nesnesi {"gcp":12,…}: olay kaydındaki ve şu an banlı saldırgan IP'lerden kaç tanesi o listede
    local IFS=$' \t\n' qf x f c out=""
    REPLY="{}"
    [ -d "$CLOUD_DIR" ] || return 0
    qf=$(mktemp) || return 0
    { grep -ohE '"ip":"[0-9.]+"' "$EVENTS_FILE" 2>/dev/null | cut -d'"' -f4
      grep -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}([[:space:]]|$)' "$DENY_FILE" 2>/dev/null | tr -d ' \t'
      [ -r "$CSF_VAR/csf.tempban" ] && awk -F'|' '$2 ~ /^[0-9.]+$/ { print $2 }' "$CSF_VAR/csf.tempban"
    } | sort -u | awk -F. 'NF == 4 { printf "%.0f\n", (($1 * 256 + $2) * 256 + $3) * 256 + $4 }' | sort -n > "$qf"
    if [ -s "$qf" ]; then
        for x in $CLOUD_CATALOG $(for f in $CLOUD_ACTIVE; do [[ "$f" == x-* ]] && echo "$f"; done); do
            f="$CLOUD_DIR/$x.txt"; [ -r "$f" ] || f="$CLOUD_DIR/probe/$x.txt"; [ -r "$f" ] || continue
            c=$(awk -F'[./]' 'NF >= 4 { b = (NF == 5 ? $5 : 32); lo = (($1 * 256 + $2) * 256 + $3) * 256 + $4; printf "%.0f %.0f\n", lo, lo + 2 ^ (32 - b) - 1 }' "$f" | sort -n -k1,1 |
                awk -v qf="$qf" '{ n++; L[n] = $1 + 0; h = $2 + 0; PM[n] = (n == 1 || h > PM[n - 1]) ? h : PM[n - 1] }
                    END { while ((getline q < qf) > 0) { q += 0; a = 1; b = n; k = 0
                              while (a <= b) { m = int((a + b) / 2); if (L[m] <= q) { k = m; a = m + 1 } else b = m - 1 }
                              if (k && PM[k] >= q) c++ }
                          print c + 0 }')
            out+="${out:+,}\"$x\":$(num "$c")"
        done
    fi
    rm -f "$qf"; REPLY="{$out}"
}
prov_cloudpct() { # ASNNN → "yüzde kaynak": CSF'in o sağlayıcı için yüklediği adreslerin yüzde kaçı etkin kiralık sunucu listelerinde
    local IFS=$' \t\n' x rf
    command -v ipset >/dev/null 2>&1 || return 0
    rf=$(mktemp) || return 0
    for x in $CLOUD_ACTIVE; do
        [ -r "$CLOUD_DIR/$x.txt" ] && awk -F'[./]' -v s="$x" 'NF >= 4 { b = (NF == 5 ? $5 : 32); lo = (($1 * 256 + $2) * 256 + $3) * 256 + $4; printf "C %.0f %.0f %s\n", lo, lo + 2 ^ (32 - b) - 1, s }' "$CLOUD_DIR/$x.txt"
    done > "$rf"
    ipset list "cc_${1,,}" 2>/dev/null | awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ { split($1, s, "/"); split(s[1], p, "."); b = (s[2] == "" ? 32 : s[2] + 0)
        lo = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]; printf "A %.0f %.0f -\n", lo, lo + 2 ^ (32 - b) - 1 }' >> "$rf"
    # her ASN aralığı için listelerle kesişen adres sayısı (aralıklar küçük, listeler birkaç bin satır: doğrudan karşılaştırma yeter)
    awk '$1 == "C" { n++; L[n] = $2 + 0; H[n] = $3 + 0; S[n] = $4; next }
         { lo = $2 + 0; hi = $3 + 0; tot += hi - lo + 1
           for (i = 1; i <= n; i++) { a = (L[i] > lo ? L[i] : lo); b = (H[i] < hi ? H[i] : hi); if (b >= a) { cov += b - a + 1; by[S[i]] += b - a + 1 } } }
         END { if (!tot) exit; best = ""; for (k in by) if (best == "" || by[k] > by[best]) best = k; p = int(cov * 100 / tot); if (p > 100) p = 100; print p, best }' "$rf"
    rm -f "$rf"
}
cloud_has() {    # IP → 0: etkin bir bulut listesinde (REPLY = kaynak adı)
    local IFS=$' \t\n' x ip="$1" v
    REPLY=""
    [ "$CLOUD_ON" = 1 ] || return 1
    # CSF'e yüklenmiş küme varsa önce ona sorulur (hızlı; sunucu IP'leri nomatch); hangi listede olduğu dosyalardan
    if command -v ipset >/dev/null 2>&1 && ipset list -n ag_cloud >/dev/null 2>&1; then ipset test ag_cloud "$ip" >/dev/null 2>&1 || return 1; fi
    ip2int "$ip" || return 1; v="$REPLY"; REPLY=""
    for x in $CLOUD_ACTIVE; do
        [ -r "$CLOUD_DIR/$x.txt" ] || continue
        awk -F'[./]' -v n="$v" '{ lo = (($1 * 256 + $2) * 256 + $3) * 256 + $4; b = (NF == 5 ? $5 : 32); if (n >= lo && n <= lo + 2 ^ (32 - b) - 1) { f = 1; exit } } END { exit !f }' "$CLOUD_DIR/$x.txt" && { REPLY="$x"; return 0; }
    done
    return 1
}
cloud_health() { # 3 günden uzun süredir indirilemeyen bulut listeleri → bildirim
    local st="$CLOUD_DIR/status" n c t e f bad="" now; now=$(date +%s)
    [ "$CLOUD_BAN" = 1 ] && [ -r "$st" ] || { ic_track IC_RUN CloudFail 0 "" "" "$M_CLOUD_FAIL_OK"; return 0; }
    while IFS='|' read -r n c t e f; do
        [ -n "$e" ] || continue
        [[ "$f" =~ ^[0-9]+$ ]] && [ "$f" -gt 0 ] || continue
        [ $(( now - f )) -gt 259200 ] && bad+="${bad:+, }$n"
    done < "$st"
    if [ -n "$bad" ] && ! grep -qF "CLOUD_FAIL $TODAY" "$SAYAC_FILE" 2>/dev/null; then
        mail_add "$(m "$M_CLOUD_FAIL_SUBJ" "$bad")" "$(m "$M_CLOUD_FAIL_BODY" "$bad")" bad; cnt_add "CLOUD_FAIL $TODAY"
        jstr "$bad"; ev cloud_fail "" "names=$REPLY"; log "$(m "$M_CLOUD_FAIL_BODY" "$bad")"
    fi
    ic_track IC_RUN CloudFail "$([ -n "$bad" ] && echo 1 || echo 0)" "$(m "$M_CLOUD_FAIL_SUBJ" "$bad")" "$(m "$M_CLOUD_FAIL_BODY" "$bad")" "$M_CLOUD_FAIL_OK"
    return 0
}
prov_resolve() { # "auto" ayarları CSF'teki duruma göre çöz (bir kez, ayarlar okunduktan sonra)
    local inc=0 d p a="" x
    grep -qE "^Include[[:space:]]+$SVC_OUT([[:space:]]|\$)" "$CSF_DIR/csf.allow" 2>/dev/null && inc=1
    if [ "$SVC_ALLOW" = auto ]; then
        SVC_ALLOW=$inc
        # aracı terminalden kullanmış sunucu: o zamanki kaynaklar (Google + Mollie) korunur
        [ "$inc" = 1 ] && [ -z "$SVC_SOURCES_SET" ] && SVC_SOURCES="google,mollie"
    fi
    if [ "$ASN_BAN" = auto ]; then
        local ap="" aa=""
        d=$(conf_val CC_DENY); p=$(conf_val CC_DENY_PORTS)
        for x in ${p//,/ }; do [[ "$x" =~ ^[Aa][Ss][0-9]+$ ]] && ap+="${ap:+,}${x^^}"; done
        for x in ${d//,/ }; do [[ "$x" =~ ^[Aa][Ss][0-9]+$ ]] && aa+="${aa:+,}${x^^}"; done
        if [ -n "$ap$aa" ]; then
            ASN_BAN=1; [ -n "$ASN_LIST" ] || ASN_LIST="$ap"; [ -n "$ASN_ALL" ] || ASN_ALL="$aa"
            if [ -n "$ap" ]; then
                ASN_TCP=$(conf_val CC_DENY_PORTS_TCP); ASN_UDP=$(conf_val CC_DENY_PORTS_UDP)
                if [ "$ASN_TCP" = "80,443" ] && [ "$ASN_UDP" = "443" ]; then ASN_MODE=web; else ASN_MODE=ports; fi
            fi
        else ASN_BAN=0; fi
    fi
}
conf_set() {     # ANAHTAR DEĞER → csf.conf'ta satırı değiştir (yoksa ekle)
    if grep -qE "^[[:space:]]*$1[[:space:]]*=" "$CSF_CONF"; then
        sed -i "s|^[[:space:]]*$1[[:space:]]*=.*|$1 = \"$2\"|" "$CSF_CONF"
    else
        printf '%s = "%s"\n' "$1" "$2" >> "$CSF_CONF"
    fi
}
list_minus() {   # "A,B,C" "B" → "A,C" (büyük/küçük harf duyarsız)
    local x o="" r=",${2^^},"
    for x in ${1//,/ }; do case "$r" in *",${x^^},"*) ;; *) o+="${o:+,}$x" ;; esac; done
    printf '%s' "$o"
}
list_plus() {    # "A,B" "B,C" → "A,B,C"
    local x o="$1"
    for x in ${2//,/ }; do case ",${o^^}," in *",${x^^},"*) ;; *) o+="${o:+,}$x" ;; esac; done
    printf '%s' "$o"
}
self_asns() {    # → REPLY = sunucunun kendi IP'lerinin ASN'leri ("AS1,AS2"; sorulamazsa boş)
    local i ip o=""
    [ "$WL_LOADED" = 1 ] || load_whitelist
    for i in "${!WL_TXT[@]}"; do
        [[ "${WL_TXT[i]}" == "$M_WL_SELF: "* ]] || continue
        ip="${WL_TXT[i]#*: }"; ip="${ip%% *}"; [[ "$ip" =~ $IPV4_RE ]] || continue
        owner_lookup "$ip"; [ -n "$OWN_ASN" ] && o=$(list_plus "$o" "AS$OWN_ASN")
    done
    # DNS sorgulanamazsa son bilinen değer (yoksa kendi sağlayıcısı bir tur banlanıp sonraki turda kalkabilirdi)
    [ -z "$o" ] && [ -r "$PROV_STATE" ] && o=$(sed -n 's/^self=//p' "$PROV_STATE")
    # o da yoksa CSF'in kendi ASN verisi (ip2asn; ağ gerekmez): sağlayıcı banını CSF bu veriyle uyguluyor
    local geo="$CSF_VAR/Geo/ip2asn-combined.tsv" v a
    if [ -z "$o" ] && [ -r "$geo" ]; then
        for i in "${!WL_TXT[@]}"; do
            [[ "${WL_TXT[i]}" == "$M_WL_SELF: "* ]] || continue
            ip="${WL_TXT[i]#*: }"; ip="${ip%% *}"; [[ "$ip" =~ $IPV4_RE ]] || continue
            ip2int "$ip"; v="$REPLY"
            a=$(awk -F'\t' -v v="$v" '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ { split($1, p, "."); split($2, q, ".")
                lo = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]; hi = ((q[1] * 256 + q[2]) * 256 + q[3]) * 256 + q[4]
                if (v >= lo && v <= hi) { if ($3 + 0 > 0) print $3; exit } }' "$geo")
            [ -n "$a" ] && o=$(list_plus "$o" "AS$a")
        done
    fi
    REPLY="$o"
}
list_and() { list_minus "$1" "$(list_minus "$1" "$2")"; }   # "A,B,C" "B,C,D" → "B,C"
asn_enforce() {  # istenen sağlayıcı banını CSF'te kur / onar / kaldır → ASN_STATE (ok|off|conflict|self), ASN_MSG
    # ASN_LIST: ortak port listesiyle (CC_DENY_PORTS; CSF'te bu listede tek port listesi var) · ASN_ALL: her şey (CC_DENY)
    local had="" prev_tcp="" prev_udp="" pflag="" d p t u nd np nt nu others x changed=0 wp="" wa="" sa="" gone keep="" keepd="" wt wu pf=""
    ASN_STATE=off; ASN_MSG=""
    # ports=1: eklenti ortak port listesini kendisi yazdı (önceki değerler prev_*); yalnız o zaman geri yüklenir
    [ -r "$PROV_STATE" ] && { had=$(sed -n 's/^asn=//p' "$PROV_STATE"); prev_tcp=$(sed -n 's/^prev_tcp=//p' "$PROV_STATE"); prev_udp=$(sed -n 's/^prev_udp=//p' "$PROV_STATE"); pflag=$(sed -n 's/^ports=//p' "$PROV_STATE"); }
    d=$(conf_val CC_DENY); p=$(conf_val CC_DENY_PORTS); t=$(conf_val CC_DENY_PORTS_TCP); u=$(conf_val CC_DENY_PORTS_UDP)
    if [ "$ASN_BAN" = 1 ]; then
        if [ "$ASN_MODE" = all ]; then wa=$(list_plus "$ASN_ALL" "$ASN_LIST")      # eski ayar: hepsi "her şey"
        else wp="$ASN_LIST"; wa=$(list_minus "$ASN_ALL" "$ASN_LIST"); fi
    fi
    if [ -n "$wp$wa" ]; then                       # sunucunun kendi sağlayıcısı hiçbir kipte banlanmaz
        self_asns; sa="$REPLY"
        if [ -z "$sa" ]; then
            # kendi sağlayıcısı hiçbir yoldan öğrenilemedi: yeni sağlayıcı eklenmez, yalnız önceden uygulanmış olanlar kalır
            for x in ${wp//,/ } ${wa//,/ }; do
                case ",$had," in *",$x,"*) ;; *) ASN_STATE=self; ASN_MSG=$(m "$M_ASN_NOSELF" "$x"); wp=$(list_minus "$wp" "$x"); wa=$(list_minus "$wa" "$x") ;; esac
            done
        fi
        for x in ${wp//,/ } ${wa//,/ }; do
            case ",$sa," in *",$x,"*) ASN_STATE=self; ASN_MSG=$(m "$M_ASN_SELF" "$x"); wp=$(list_minus "$wp" "$x"); wa=$(list_minus "$wa" "$x") ;; esac
        done
    fi
    wt="$ASN_TCP"; wu="$ASN_UDP"; [ "$ASN_MODE" = web ] && { wt="80,443"; wu="443"; }
    # ortak port listesi başka bir kayıtla (ülke ya da elle eklenmiş ASN) farklı kullanılıyorsa port kısmı uygulanmaz;
    # eklentinin o listede önceden uyguladıkları da olduğu gibi kalır (yanlışlıkla kaldırılmaz)
    if [ -n "$wp" ]; then
        others=$(list_minus "$p" "$(list_plus "$wp" "$had")")
        if [ -n "$others" ] && { [ "$t" != "$wt" ] || [ "$u" != "$wu" ]; }; then
            ASN_STATE=conflict; ASN_MSG=$(m "$M_ASN_CONFLICT" "$others" "${t:--}" "${u:--}")
            # port listesinde önceden uyguladıkları ve "her şey"den port listesine alınmak istenenler olduğu gibi kalır
            keep=$(list_and "$p" "$had"); keepd=$(list_and "$(list_and "$d" "$had")" "$wp"); wp=""; wt="$t"; wu="$u"
        fi
    fi
    gone=$(list_minus "$had" "$(list_plus "$(list_plus "$(list_plus "$wp" "$wa")" "$keep")" "$keepd")")
    nd=$(list_minus "$d" "$gone"); np=$(list_minus "$p" "$gone"); nt="$t"; nu="$u"
    [ -n "$wa" ] && { nd=$(list_plus "$nd" "$wa"); np=$(list_minus "$np" "$wa"); }
    if [ -n "$wp" ]; then
        [ "$pflag" = 1 ] || { prev_tcp="$t"; prev_udp="$u"; }      # ilk kez yazarken kullanıcının değerleri saklanır
        np=$(list_plus "$np" "$wp"); nd=$(list_minus "$nd" "$wp"); nt="$wt"; nu="$wu"; pf=1
    elif [ -n "$keep" ]; then pf="$pflag"
    fi
    # port listeleri yalnız eklentinin kullandığı sürece eklentinin: liste boşaldıysa önceki değerler geri gelir
    [ -z "$pf" ] && [ -z "$np" ] && [ "$pflag" = 1 ] && { nt="$prev_tcp"; nu="$prev_udp"; }
    [ -n "$wp$wa" ] && [ "$ASN_STATE" = off ] && ASN_STATE=ok
    [ "$nd" != "$d" ] || [ "$np" != "$p" ] || [ "$nt" != "$t" ] || [ "$nu" != "$u" ] && changed=1
    if [ "$changed" = 1 ]; then
        cp -p "$CSF_CONF" "$CSF_CONF.autogroup.bak" 2>/dev/null
        conf_set CC_DENY "$nd"; conf_set CC_DENY_PORTS "$np"; conf_set CC_DENY_PORTS_TCP "$nt"; conf_set CC_DENY_PORTS_UDP "$nu"
        csf_run -r
        { systemctl restart lfd 2>/dev/null 9>&- || service lfd restart >/dev/null 2>&1 9>&-; }   # setleri lfd doldurur; kilit ona geçmesin
        if [ -n "$wp$wa" ]; then
            log "$(m "$M_ASN_APPLIED" "${wp:+$wp ($ASN_MODE)}${wp:+${wa:+ · }}${wa:+$wa (all)}")"
            ev provider "" "asn=\"$wp\"" "all=\"$wa\"" "mode=\"$ASN_MODE\"" "by=\"${AG_BY:-cron}\""
        else log "$(m "$M_ASN_REMOVED" "${gone:-?}")"; ev provider "" "asn=\"\"" "removed=\"$gone\"" "by=\"${AG_BY:-cron}\""; fi
    fi
    # çakışma / kendi sağlayıcısı: günde bir kez log'a (her turda değil)
    if [ "$ASN_STATE" = conflict ] || [ "$ASN_STATE" = self ]; then
        grep -qF "ASN_WARN $TODAY" "$SAYAC_FILE" 2>/dev/null || { log "$ASN_MSG"; cnt_add "ASN_WARN $TODAY"; }
    fi
    # eklentinin yazdıkları (bir sonraki değişiklikte yalnız bunlar geri alınır)
    x=$(list_plus "$(list_plus "$(list_plus "$wp" "$wa")" "$keep")" "$keepd")
    [ -n "$pf" ] || { prev_tcp=""; prev_udp=""; }
    if [ -n "$x$sa" ]; then printf 'asn=%s\nports=%s\nprev_tcp=%s\nprev_udp=%s\nself=%s\n' "$x" "$pf" "$prev_tcp" "$prev_udp" "$sa" > "$PROV_STATE"
    else rm -f "$PROV_STATE"; fi
    return 0
}
svc_enforce() {  # FORCE(1 = listeleri şimdi yenile) → izinli servisleri kur / kaldır
    local tool="$SELF_DIR/tools/services-allow.sh" sig inc=0 cache sigf
    cache="$(dirname "$SAYAC_FILE")/services"; sigf="$cache/.sig"
    grep -qE "^Include[[:space:]]+$SVC_OUT([[:space:]]|\$)" "$CSF_DIR/csf.allow" 2>/dev/null && inc=1
    [ -r "$tool" ] || return 0
    if [ "$SVC_ALLOW" = 1 ]; then
        svc_srclist; sig=$(printf '%s' "$REPLY" | cksum | cut -d' ' -f1)
        if [ "${1:-0}" = 1 ] || [ "$inc" = 0 ] || [ ! -s "$SVC_OUT" ] || [ "$(cat "$sigf" 2>/dev/null)" != "$sig" ]; then
            # son deneme başarısızsa (sunucu dışarı bağlanamıyor, kaynaklar boş) zorlanmadıkça saatte birden sık denenmez
            local lf; lf=$(cat "$cache/.fail" 2>/dev/null)
            if [ "${1:-0}" = 1 ] || ! [[ "$lf" =~ ^[0-9]+$ ]] || [ $(( $(date +%s) - lf )) -ge 3600 ]; then
                mkdir -p "$cache"
                if SRC="$REPLY" OUT="$SVC_OUT" ALLOW="$CSF_DIR/csf.allow" CSF_BIN="$CSF_BIN" LOG_FILE="$LOG_FILE" CACHE="$cache" \
                    timeout 300 bash "$tool" >/dev/null 2>&1 9>&-; then printf '%s' "$sig" > "$sigf"; rm -f "$cache/.fail"
                else date +%s > "$cache/.fail"; fi
            fi
        fi
    elif [ "$inc" = 1 ] || [ -e "$SVC_OUT" ]; then
        OUT="$SVC_OUT" ALLOW="$CSF_DIR/csf.allow" CSF_BIN="$CSF_BIN" LOG_FILE="$LOG_FILE" CACHE="$cache" timeout 120 bash "$tool" --remove >/dev/null 2>&1 9>&-
        rm -f "$sigf"; log "$M_SVC_REMOVED"
    fi
    return 0
}
prov_json() {    # → REPLY = durum JSON'u: izinli servisler (kaynak başına sayı, son güncelleme) ve sağlayıcı banı (set boyutları)
    local IFS=$' \t\n'     # durum çıktısı IFS=, ile çağırır; buradaki döngüler boşlukla bölünür
    local nm o s="" n c t e a sets="" geo="$CSF_VAR/Geo/ip2asn-combined.tsv" gt=0 cache
    cache="$(dirname "$SAYAC_FILE")/services"
    if [ -r "$cache/status" ]; then
        while IFS='|' read -r n c t e f; do
            [[ "$n" =~ ^[A-Za-z0-9._|-]+$ ]] || continue
            jstr "$n"; s+="${s:+,}{\"n\":$REPLY,\"c\":$(num "$c"),\"t\":$(num "$t"),\"f\":$(num "$f")"; jstr "$e"; s+=",\"e\":$REPLY}"
        done < "$cache/status"
    fi
    for a in $(list_plus "$ASN_LIST" "$ASN_ALL" | tr ',' ' '); do
        asn_setn "$a"; c="$REPLY"
        local clp="" cls=""
        if [ "$CLOUD_ON" = 1 ] && [ "$c" -gt 0 ] 2>/dev/null; then
            read -r clp cls < <(prov_cloudpct "$a")
        fi
        asn_name "$a"; jstr "$REPLY"; sets+="${sets:+,}{\"a\":\"$a\",\"n\":$c,\"d\":$REPLY,\"cl\":$(num "$clp"),\"cls\":\"$cls\"}"     # n -1: ipset yok, bilinmiyor
    done
    [ -e "$geo" ] && gt=$(stat -c %Y "$geo" 2>/dev/null || echo 0)
    local catj="" ck
    for ck in $SVC_CATALOG; do svc_urls "$ck"; jstr "$REPLY"; catj+="${catj:+,}\"$ck\":$REPLY"; done   # kaynak → "ad|adres ad|adres"
    jstr "$SVC_EXTRA"; o="{\"svc\":{\"on\":$([ "$SVC_ALLOW" = 1 ] && echo true || echo false),\"sources\":\"$SVC_SOURCES\",\"extra\":$REPLY,\"src\":[$s],\"cat\":{$catj},\"urls\":\"$SVC_URLS\"}"
    # bulut listeleri: kaynak başına sayı / son indirme, CSF zincirindeki küme boyutu
    local cs="" ccat="" cn=-1 cx
    if [ -r "$CLOUD_DIR/status" ]; then
        while IFS='|' read -r n c t e f; do
            [[ "$n" =~ ^[a-z0-9-]+$ ]] || continue
            cs+="${cs:+,}{\"n\":\"$n\",\"c\":$(num "$c"),\"t\":$(num "$t"),\"f\":$(num "$f"),\"e\":\"${e//[^a-z]/}\"}"
        done < "$CLOUD_DIR/status"
    fi
    for cx in $CLOUD_CATALOG; do cloud_urls "$cx"; ccat+="${ccat:+,}\"$cx\":\"$REPLY\""; done
    command -v ipset >/dev/null 2>&1 && cn=$(ipset list -t ag_cloud 2>/dev/null | awk -F': ' '/^Number of entries/ { print $2 }')
    [[ "$cn" =~ ^-?[0-9]+$ ]] || cn=0
    local cpot; cloud_pot; cpot="$REPLY"
    jstr "$CLOUD_EXTRA"; o+=",\"cloud\":{\"extra\":$REPLY,\"pot\":$cpot,\"on\":$([ "$CLOUD_BAN" = 1 ] && echo true || echo false),\"sources\":\"$CLOUD_SOURCES\",\"tcp\":\"$CLOUD_TCP\",\"udp\":\"$CLOUD_UDP\",\"urls\":\"$CLOUD_URLS\",\"src\":[$cs],\"cat\":{$ccat},\"n\":$cn}"
    jstr "${ASN_MSG:-}"                     # yukarıdaki döngüler REPLY'yi ezdi: sağlayıcı banı iletisi burada hazırlanır
    o+=",\"asn\":{\"on\":$([ "$ASN_BAN" = 1 ] && echo true || echo false),\"list\":\"$ASN_LIST\",\"all\":\"$ASN_ALL\",\"mode\":\"$ASN_MODE\",\"tcp\":\"$ASN_TCP\",\"udp\":\"$ASN_UDP\",\"state\":\"${ASN_STATE:-}\",\"msg\":$REPLY,\"sets\":[$sets],\"geo_t\":$(num "$gt")}}"
    REPLY="$o"
}
do_asn_impact() { # ASN → son 24 saatin web günlüklerinde bu sağlayıcıdan gelen istekler: kodlar, başarılı istekler, siteler
    local a="${1^^}" n geo="$CSF_VAR/Geo/ip2asn-combined.tsv" dir="" d files rng
    [[ "$a" =~ ^AS([0-9]{1,10})$ ]] || { echo '{"ok":false,"error":"bad_asn"}'; return 2; }
    n="${BASH_REMATCH[1]}"
    [ -r "$geo" ] || { echo '{"ok":false,"error":"no_asn_data"}'; return 1; }
    for d in ${DOMLOGS:-} /var/log/apache2/domlogs /usr/local/apache/domlogs /etc/apache2/logs/domlogs; do [ -d "$d" ] && { dir="$d"; break; }; done
    [ -n "$dir" ] || { echo '{"ok":false,"error":"no_logs"}'; return 1; }
    rng=$(mktemp) || return 1
    awk -F'\t' -v n="$n" '$3 == n && $1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {
        split($1, p, "."); split($2, q, ".")
        print ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4], ((q[1] * 256 + q[2]) * 256 + q[3]) * 256 + q[4] }' "$geo" | sort -n > "$rng"
    local lst since alw; lst=$(mktemp) || { rm -f "$rng"; return 1; }
    # izinli servisler (csf.allow Include): CSF bunlara bandan önce izin verir; ölçümde ayrıca işaretlenir
    alw=$(mktemp) || { rm -f "$rng" "$lst"; return 1; }
    [ -r "$SVC_OUT" ] && awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ { nm = $0; sub(/.*service /, "", nm); sub(/[[:space:]].*/, "", nm)
            split($1, s, "/"); split(s[1], p, "."); b = (s[2] == "" ? 32 : s[2] + 0); lo = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]
            printf "%.0f %.0f %s\n", lo, lo + 2 ^ (32 - b) - 1, nm }' "$SVC_OUT" | sort -n -k1,1 > "$alw"
    find -L "$dir" -type f -mmin -1440 ! -name '*bytes_log*' ! -name '*.offset*' ! -name '*.gz' 2>/dev/null > "$lst"
    since=$(date -d '24 hours ago' +%Y%m%d%H%M%S)
    # dosyalar tek awk'a verilir (xargs çok dosyada gruplara bölüp yalnız son grubun sonucunu bırakıyordu)
    awk -v rf="$rng" -v lf="$lst" -v since="$since" -v af="$alw" '
        BEGIN { while ((getline l < rf) > 0) { split(l, x, " "); m++; LO[m] = x[1] + 0; HI[m] = x[2] + 0 }
                while ((getline l < af) > 0) { split(l, x, " "); an++; AL[an] = x[1] + 0; h = x[2] + 0
                    if (an == 1 || h > AP[an - 1]) { AP[an] = h; AN[an] = x[3] } else { AP[an] = AP[an - 1]; AN[an] = AN[an - 1] } }
                while ((getline l < lf) > 0) if (l != "") ARGV[ARGC++] = l
                split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", MN, " "); for (i = 1; i <= 12; i++) MI[MN[i]] = sprintf("%02d", i) }
        function tkey(s,  a) { # "[05/Oct/2026:04:00:00" → 20261005040000 (günlüğün yerel saati)
            if (!match(s, /\[[0-9][0-9]\/[A-Z][a-z][a-z]\/[0-9][0-9][0-9][0-9]:[0-9][0-9]:[0-9][0-9]:[0-9][0-9]/)) return 0
            s = substr(s, RSTART + 1, RLENGTH - 1); split(s, a, /[\/:]/)
            return a[3] MI[a[2]] a[1] a[4] a[5] a[6] }
        function inr(ip,  p, v, a, b, c) {
            if (split(ip, p, ".") != 4) return 0
            v = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]; a = 1; b = m
            while (a <= b) { c = int((a + b) / 2); if (v < LO[c]) b = c - 1; else if (v > HI[c]) a = c + 1; else return 1 }
            return 0 }
        function alw(ip,  p, v, a, b, c, k) {   # izinli servis adı ya da ""
            if (!an || split(ip, p, ".") != 4) return ""
            v = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]; a = 1; b = an; k = 0
            while (a <= b) { c = int((a + b) / 2); if (AL[c] <= v) { k = c; a = c + 1 } else b = c - 1 }
            return (k && AP[k] >= v) ? AN[k] : "" }
        function js(s) { gsub(/\\/, "/", s); gsub(/"/, "", s); gsub(/[[:cntrl:]]/, " ", s); return "\"" s "\"" }   # JSON için: ters bölü ve tırnak sadeleşir
        { ip = $1; if (!(ip in SEEN)) SEEN[ip] = inr(ip); if (!SEEN[ip]) next
          k = tkey($4); if (k != 0 && k < since) next
          tot++; IPS[ip] = 1
          if (!(ip in AW)) AW[ip] = alw(ip); w = AW[ip]; if (w != "") { atot++; AIP[ip] = 1 }
          q = index($0, "\""); r = substr($0, q + 1); e = index(r, "\""); req = substr(r, 1, e - 1); rest = substr(r, e + 2)
          split(rest, f, " "); code = f[1]; C[code]++
          if (w != "") { AC[code]++; AS[w]++ } else OC[code]++       # izinli servislerin kodları ayrı: ötekilerin cevabı görünsün
          u = rest; sub(/^[^"]*"[^"]*" "/, "", u); sub(/"[^"]*$/, "", u)
          site = FILENAME; sub(/.*\//, "", site); sub(/-ssl_log$/, "", site)
          if (code ~ /^2/) { ok++; S[site]++
              if (req ~ /^POST /) { split(req, rq, " "); pk = site " · " substr(rq[2], 1, 60) " · " u; P[pk]++; if (!(pk in PI)) PI[pk] = ip; if (w != "") { PA[pk]++; PN[pk] = w } }
              if (u !~ /^Mozilla/) { B[u]++; if (w != "") { BA[u]++; BN[u] = w } } } }
        function top(A, k, X, N, I,  o, i, best, bk, n) { o = ""     # [anahtar, sayı, izinli sayı, izinli servis, örnek IP]
            for (n = 0; n < k; n++) { best = 0; bk = ""; for (i in A) if (A[i] > best) { best = A[i]; bk = i }
                if (bk == "") break; o = o (o == "" ? "" : ",") "[" js(bk) "," best "," (X[bk] + 0) "," js(N[bk]) "," js(I[bk]) "]"; delete A[bk] }
            return "[" o "]" }
        function obj(A,  o, i) { o = ""; for (i in A) o = o (o == "" ? "" : ",") js(i) ":" A[i]; return "{" o "}" }
        END { nip = 0; for (i in IPS) nip++; naip = 0; for (i in AIP) naip++
              printf "{\"ok\":true,\"total\":%d,\"ips\":%d,\"ok2xx\":%d,\"areq\":%d,\"aips\":%d,\"codes\":%s,\"ocodes\":%s,\"acodes\":%s,\"asvc\":%s,\"posts\":%s,\"bots\":%s,\"sites\":%s}\n",
                  tot, nip, ok, atot, naip, obj(C), obj(OC), obj(AC), obj(AS), top(P, 15, PA, PN, PI), top(B, 15, BA, BN), top(S, 10) }' /dev/null | grep . || echo '{"ok":true,"total":0,"ips":0,"ok2xx":0,"codes":{},"posts":[],"bots":[],"sites":[]}'
    rm -f "$rng" "$lst" "$alw"
}
svc_health() {   # izinli servis kaynaklarından 3 günden uzun süredir indirilemeyenler → bildirim
    local st="$(dirname "$SAYAC_FILE")/services/status" n c t e f bad="" now; now=$(date +%s)
    [ "$SVC_ALLOW" = 1 ] && [ -r "$st" ] || { ic_track IC_RUN SvcFail 0 "" "" "$M_SVC_FAIL_OK"; return 0; }
    while IFS='|' read -r n c t e f; do
        [ -n "$e" ] || continue
        [[ "$f" =~ ^[0-9]+$ ]] && [ "$f" -gt 0 ] || continue      # ilk başarısızlık anı bilinmiyorsa (eski sürüm) bekle
        [ $(( now - f )) -gt 259200 ] && bad+="${bad:+, }$n"     # 3 gündür indirilemiyor
    done < "$st"
    if [ -n "$bad" ] && ! grep -qF "SVC_FAIL $TODAY" "$SAYAC_FILE" 2>/dev/null; then
        mail_add "$(m "$M_SVC_FAIL_SUBJ" "$bad")" "$(m "$M_SVC_FAIL_BODY" "$bad")" bad; cnt_add "SVC_FAIL $TODAY"
        jstr "$bad"; ev svc_fail "" "names=$REPLY"; log "$(m "$M_SVC_FAIL_BODY" "$bad")"
    fi
    ic_track IC_RUN SvcFail "$([ -n "$bad" ] && echo 1 || echo 0)" "$(m "$M_SVC_FAIL_SUBJ" "$bad")" "$(m "$M_SVC_FAIL_BODY" "$bad")" "$M_SVC_FAIL_OK"
    return 0
}
daily_tasks() {  # günde bir kez, turun içinde (ayrı cron satırı gerekmez):
    # 1) yayımlanmış servis adresleri: araç kullanılıyorsa (csf.allow'da Include satırı varsa) listeler yenilenir
    # 2) ASN banı varsa CSF'in ASN verisi: lfd dosyayı yalnız yoksa indirir, kendiliğinden yenilemez; 25 günden
    #    eskiyse kenara alınır ve lfd yeniden başlatılır, lfd güncel veriyi indirip setleri yeniden doldurur
    local out="$CSF_DIR/csf_autogroup.services.allow" tool="$SELF_DIR/tools/services-allow.sh" geo="$CSF_VAR/Geo/ip2asn-combined.tsv" asn age
    grep -qF "DAILY_TASKS $TODAY" "$SAYAC_FILE" 2>/dev/null && return 0
    cnt_add "DAILY_TASKS $TODAY"
    [ "$SVC_ALLOW" = 1 ] && svc_enforce 1
    [ "$CLOUD_BAN" = 1 ] && { cloud_enforce 1; cloud_probe; }
    asn=$( { conf_val CC_DENY; echo ","; conf_val CC_DENY_PORTS; } | tr ',' '\n' | grep -iE '^AS[0-9]+$' | paste -sd, -)
    # dün yenilemek için kenara alınan dosya yerine yenisi gelmediyse (lfd indiremedi) eskisi geri konur
    if [ -n "$asn" ] && [ ! -e "$geo" ] && [ -e "$geo.old" ]; then
        mv -f "$geo.old" "$geo" && { systemctl restart lfd 2>/dev/null 9>&- || service lfd restart >/dev/null 2>&1 9>&-; }
        log "$(m "$M_ASN_REFRESH_FAIL" "?")"
    fi
    if [ -n "$asn" ] && [ -n "$(find "$geo" -mtime +25 2>/dev/null)" ]; then
        age=$(( ( $(date +%s) - $(stat -c %Y "$geo") ) / 86400 ))
        if mv -f "$geo" "$geo.old" && { systemctl restart lfd 2>/dev/null 9>&- || service lfd restart >/dev/null 2>&1 9>&-; }; then
            log "$(m "$M_ASN_REFRESH" "$age" "$asn")"
        else
            [ -e "$geo" ] || mv -f "$geo.old" "$geo"           # lfd başlatılamadıysa eski veri yerine dönsün
            log "$(m "$M_ASN_REFRESH_FAIL" "$age")"
        fi
    fi
    return 0
}
part_note() {    # LO HI → REPLY = "CIDR|svc" (aralıktaki ilk kısmi ban) ya da boş
    local x l
    REPLY=""
    x=$(own_partials_inside "$1" "$2" | head -n 1); [ -n "$x" ] || return 1
    l=$(grep -F "|s=$x # csf_autogroup:" "$DENY_FILE" | head -n 1)
    [[ "$l" =~ $RE_SV ]] && REPLY="$x|${BASH_REMATCH[1]}" || REPLY="$x|"
}
do_action() {    # NAME TARGET [DAYS]
    local name="$1" t="$2" days="${3:-30}" cidr bits pfx ip line jw
    [ "$DRY" = 1 ] && { act_out 2 "$M_A_NODRY"; return 2; }
    ACT_T0=$(date +%s%N); ACT_NAME="$name $t"
    [ -z "$BSVC" ] || [[ "$BSVC" =~ ^[a-z]+(,[a-z]+){0,9}$ ]] || { act_out 2 "$(m "$M_BAD_TARGET" "$BSVC")"; return 2; }
    take_lock || { act_out 3 "$M_BUSY"; return 3; }
    parse_deny "$DENY_FILE" 1
    case "$name" in
        ban16|ban24|banpfx)
            bits="${name#ban}"
            if [ "$name" = banpfx ]; then       # duyurulan aralık: /17–/23, ağ adresiyle verilmeli (176.88.120.0/21)
                if [[ "$t" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/(1[7-9]|2[0-3])$ ]] && cidr_range "$t" && ip2int "${t%/*}" && [ "$REPLY" = "$R_LO" ]; then
                    cidr="$t"; bits="${t#*/}"
                fi
            elif [ "$bits" = 16 ]; then [[ "$t" =~ ^[0-9]{1,3}\.[0-9]{1,3}$ ]] && cidr="$t.0.0/16"
            else [[ "$t" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] && cidr="$t.0/24"; fi
            { [ -n "$cidr" ] && cidr_range "$cidr"; } || { act_out 2 "$(m "$M_BAD_TARGET" "$t")"; return; }
            local lo=$R_LO hi=$R_HI
            [ "$BMODE" = all ] || split_ports "$BPORTS" || { act_out 2 "$(m "$M_A_BADPORTS" "$BPORTS")"; return; }
            case "$BMODE" in
                all) ;;
                svc) part_ports || { act_out 2 "$M_A_NOSVC"; return; } ;;
                exc) exc_lines "$cidr" || { act_out 2 "$M_A_NOSVC"; return; } ;;
                *)   act_out 2 "$(m "$M_BAD_TARGET" "$BMODE")"; return ;;
            esac
            if perm_covers "$lo" "$hi"; then
                # aynı aralıkta eklentinin kendi tam banı varsa ve değiştirmek isteniyorsa: kipini değiştir
                if [ "$REPLACE" = 1 ] && [[ "$(deny_line "$cidr")" == *"csf_autogroup:"* ]]; then replace_full "$cidr" "$bits"; return; fi
                act_out 1 "$(m "$M_A_EXISTS" "$cidr")"; return
            fi
            self_overlap "$lo" "$hi" && { act_out 1 "$(m "$M_A_SELF" "$cidr" "$SELF_HIT")"; return; }
            inside_scan "$cidr"
            WL_HIT=""
            if [ "$bits" = 24 ]; then wl_check "$t" "${ips24[$t]:-$t.1}"; else wl_range16 "${cidr%.*.*}" "$lo" "$hi"; fi
            if [ -n "$WL_HIT" ] && [ "$FORCE" != 1 ]; then act_out 4 "$(m "$M_A_WL" "$cidr" "$WL_HIT")"; return; fi
            # kısmi ban: aralığı tamamen kapsamaz; içindekilere ve izlemelere dokunulmaz
            if [ "$BMODE" = svc ]; then part_ports; ban_partial "$cidr" "$bits" "$REPLY"; return; fi
            # Sıra, yarıda kesilse (panelin süre sınırı) bile güvenli kalacak biçimde: önce kurtarma kopyası ve izin
            # satırları, sonra ban, sonra kapsananlar tek yazımda, tek csf -r, en sonda geçici banlar.
            local x rb=0 rs=0 rt=0 rw=0 xn=0 ln msg rf tokf subf save="" rem=() ownp=() inx=()
            restore_file "$cidr"; rf="$REPLY"
            rm -f "$rf"                                    # aynı aralığın eski kopyası: ban yokken kalmış, artık geçersiz
            if [ "$CLEAN" = 1 ]; then
                ownp=($(own_partials_inside "$lo" "$hi"))
                for x in "${IN_BLK[@]}" "${IN_OTH[@]}" "${IN_SGL[@]}" "${IN_SGLD[@]}"; do
                    ln="${DLINE[$x]}"; [ -n "$ln" ] || continue
                    rem+=("$x"); save+="$ln"$'\n'
                    # içteki kendi "hariç" banının izin satırları da onunla gider (kalsalar o portlar açık kalırdı)
                    if [[ "$ln" == *"csf_autogroup:"* ]] && grep -qF "csf_autogroup: exception for $x [" "$CSF_DIR/csf.allow" 2>/dev/null; then
                        inx+=("$x"); save+="$(grep -F "csf_autogroup: exception for $x [" "$CSF_DIR/csf.allow" | sed 's/^/allow|/')"$'\n'
                    fi
                done
                for x in "${ownp[@]}"; do save+="$(grep -F "|s=$x # csf_autogroup:" "$DENY_FILE")"$'\n'; done
                if [ -n "$save" ] && ! restore_save "$cidr" "${save%$'\n'}"; then
                    log "$(m "$M_A_NOSAVE" "$cidr" "$RESTORE_DIR")"; rem=(); inx=(); ownp=(); CLEAN=0
                fi
            fi
            if [ "$BMODE" = exc ]; then
                file_append_locked "$CSF_DIR/csf.allow" "$EXC_LINES" || { rm -f "$rf"; act_out 1 "$(m "$M_A_BANFAIL" "$cidr" "csf.allow")"; return; }
                xn=$(grep -c . <<< "$EXC_LINES")
            fi
            csf_run -d "$cidr" "$(m "$M_A_COMMENT" "$bits" "$AG_BY")"
            if ! deny_has "$cidr"; then
                [ "$BMODE" = exc ] && file_drop_locked "$CSF_DIR/csf.allow" "csf_autogroup: exception for $cidr ["
                rm -f "$rf"; act_out 1 "$(m "$M_A_BANFAIL" "$cidr" "${CSF_OUT%%$NL*}")"; return
            fi
            for x in "${IN_WATCH[@]}"; do cnt_del_prefix "$x"; rw=$((rw + 1)); done   # banlı aralıkta izlemenin anlamı yok
            # kapsananlar ve içteki kendi kısmi banlarımız tek kilitli yazımda (her biri için ayrı csf -dr yerine)
            tokf=$(mktemp); subf=$(mktemp)
            [ ${#rem[@]} -gt 0 ] && printf '%s\n' "${rem[@]}" > "$tokf"
            for x in "${ownp[@]}"; do printf '%s\n' "|s=$x # csf_autogroup:" >> "$subf"; done
            if [ ${#rem[@]} -gt 0 ] || [ ${#ownp[@]} -gt 0 ]; then
                file_rewrite "$DENY_FILE" "$tokf" "$subf" "" || log "$(m "$M_A_BANFAIL" "$cidr" "csf.deny")"
            fi
            : > "$subf"
            for x in "${inx[@]}"; do printf '%s\n' "csf_autogroup: exception for $x [" >> "$subf"; done
            [ ${#inx[@]} -gt 0 ] && file_rewrite "$CSF_DIR/csf.allow" /dev/null "$subf" ""
            rm -f "$tokf" "$subf"
            local -A LEFT=()                                # yazımdan sonra dosyada kalan adresler (tek okuma)
            while read -r x _; do [ -n "$x" ] && LEFT[$x]=1; done < "$DENY_FILE"
            for x in "${rem[@]}"; do
                [ -n "${LEFT[$x]}" ] && continue
                if [[ "$x" == */* ]]; then rb=$((rb + 1)); else rs=$((rs + 1)); fi
            done
            local rp=0                                      # içteki kısmi banlar (bölünmüş satırlar tek kayıt)
            for x in "${ownp[@]}"; do grep -qF "|s=$x # csf_autogroup:" "$DENY_FILE" || rp=$((rp + 1)); done
            if [ ${#rem[@]} -gt 0 ] || [ ${#ownp[@]} -gt 0 ] || [ "$BMODE" = exc ]; then csf_run -r; fi
            if [ "$CLEAN" = 1 ]; then
                for x in "${IN_TMP[@]}"; do csf_run -tr "$x"; grep -qF "|$x|" "$CSF_VAR/csf.tempban" 2>/dev/null || rt=$((rt + 1)); done
            fi
            jstr "$WL_HIT"; jw="$REPLY"
            owners_load; inside_owner "${t%.*}" "$t"; owner_kv
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_BANNED" "$cidr")")"
            ev manual_ban "$cidr" "by=\"$AG_BY\"" "wl=$jw" "restorable=$((rb + rs + rp))" "force=$([ "$FORCE" = 1 ] && echo true || echo false)" "${OKV[@]}" \
               "mode=\"$BMODE\"" $([ "$BMODE" = exc ] && echo "open=\"$BSVC\" extra=\"$BPORTS\"") \
               "removed={\"ranges\":$rb,\"singles\":$rs,\"partials\":$rp,\"temps\":$rt,\"watched\":$rw}" "total=$IN_EVN" "ips=[$(IFS=,; echo "${IN_EVJ[*]}")]"
            msg="$(m "$M_A_BANNED" "$cidr")"
            [ $((rb + rs + rp + rt)) -gt 0 ] && msg="$(m "$M_A_CLEANED" "$msg" $((rb + rs + rp + rt)))"
            [ "$xn" -gt 0 ] && msg="$(m "$M_A_EXC" "$msg" "$xn")"
            act_out 0 "$msg" ;;
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
            if [ -z "$line" ] && grep -qF "|s=$t # csf_autogroup:" "$DENY_FILE" 2>/dev/null; then   # kısmi ban
                file_drop_locked "$DENY_FILE" "|s=$t # csf_autogroup:" || { act_out 1 "$(m "$M_A_UNBANFAIL" "$t" "csf.deny")"; return; }
                csf_run -r
                log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_PREMOVED" "$t")")"
                ev manual_unban "$t" "by=\"$AG_BY\"" "mode=\"svc\""
                act_out 0 "$(m "$M_A_PREMOVED" "$t")"; return
            fi
            UB_RN=0
            if [ -n "$line" ]; then
                unban_full_core "$t" || { act_out 1 "$UB_ERR"; return; }
            elif [ -r "$CSF_VAR/csf.tempban" ] && grep -qF "|$t|" "$CSF_VAR/csf.tempban"; then
                csf_run -tr "$t"
                grep -qF "|$t|" "$CSF_VAR/csf.tempban" && { act_out 1 "$(m "$M_A_UNBANFAIL" "$t" "${CSF_OUT%%$NL*}")"; return; }
            else
                act_out 1 "$(m "$M_A_NOTFOUND" "$t")"; return
            fi
            log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_A_UNBANNED" "$t")")"
            ev manual_unban "$t" "by=\"$AG_BY\"" "restored=$UB_RN"
            if [ "$UB_RN" -gt 0 ]; then act_out 0 "$(m "$M_A_RESTORED" "$(m "$M_A_UNBANNED" "$t")" "$UB_RN")"
            else act_out 0 "$(m "$M_A_UNBANNED" "$t")"; fi ;;
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
asn_banned() {   # → ASB[ASN numarası]=all|ports, ASB_ORD: CSF'te şu an banlı sağlayıcılar (CC_DENY / CC_DENY_PORTS)
    declare -gA ASB=(); ASB_ORD=""; ASB_A=()
    local c k IFS=$' \t\n'                                     # durum çıktısı IFS=, ile çağırır
    for k in CC_DENY CC_DENY_PORTS; do
        for c in $(conf_val "$k" | LC_ALL=C tr '[:lower:],' '[:upper:] '); do
            [[ "$c" =~ ^AS([0-9]+)$ ]] || continue
            [ -n "${ASB[${BASH_REMATCH[1]}]}" ] && continue
            ASB[${BASH_REMATCH[1]}]=$([ "$k" = CC_DENY ] && echo all || echo ports); ASB_ORD+="${BASH_REMATCH[1]} "; ASB_A+=("${BASH_REMATCH[1]}")
        done
    done
}
asn_name() {     # ASNNN → REPLY = sağlayıcının adı (CSF'in ASN verisinden bir kez okunur, önbellekte tutulur)
    local a="$1" cache geo="$CSF_VAR/Geo/ip2asn-combined.tsv"
    cache="$(dirname "$SAYAC_FILE")/services"
    REPLY=$(grep -m1 "^$a|" "$cache/asn_names" 2>/dev/null | cut -d'|' -f2-)
    if [ -z "$REPLY" ] && [ -r "$geo" ]; then
        REPLY=$(awk -F'\t' -v n="${a#AS}" '$3 == n { print $5; exit }' "$geo" | tr -d '|"\\' | cut -c1-80)
        [ -n "$REPLY" ] && { mkdir -p "$cache"; printf '%s|%s\n' "$a" "$REPLY" >> "$cache/asn_names"; }
    fi
}
asn_setn() {     # ASNNN → REPLY = CSF'in yüklediği aralık sayısı (-1: ipset yok, bilinmiyor)
    REPLY=-1; command -v ipset >/dev/null 2>&1 && REPLY=$(ipset list "cc_${1,,}" 2>/dev/null | grep -cE '^[0-9]')
    [[ "$REPLY" =~ ^-?[0-9]+$ ]] || REPLY=-1
}
pc_ports() {     # SERVİS ",port,listesi," → 0: servisin bütün portları listede
    svc_ports "$1" || return 1
    local p; for p in ${REPLY//,/ }; do port_in "$p" "$2" || return 1; done
}
port_in() {      # PORT ",liste," → 0: port (ya da "a_b" / "a:b" aralığının tamamı) listede; liste "a:b" aralıkları içerebilir
    local p="${1//_/:}" lo hi x a b
    [[ "$2" == *",$p,"* ]] && return 0
    lo="${p%%:*}"; hi="${p##*:}"; [[ "$lo" =~ ^[0-9]+$ && "$hi" =~ ^[0-9]+$ ]] || return 1
    for x in ${2//,/ }; do
        a="${x%%:*}"; b="${x##*:}"; [[ "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ ]] || continue
        (( lo >= a && hi <= b )) && return 0
    done
    return 1
}
PCV_LO=(); PCV_HI=(); PCV_P=(); PCV_OK=0
part_covers() {  # IP SERVİS → 0: IP'yi kapsayan eklenti kısmi banı (csf.deny'de "tcp|in|d=PORTLAR|s=CIDR # csf_autogroup:") servisin
    # bütün portlarını kapatıyor. Satırlar turda bir kez okunur.
    local ip="$1" k="$2" i n l c pt
    if [ "$PCV_OK" = 0 ]; then
        PCV_OK=1
        while IFS= read -r l; do
            [[ "$l" =~ ^tcp\|in\|d=([0-9,_:]+)\|s=([0-9./]+)[[:space:]] ]] || continue
            pt="${BASH_REMATCH[1]}"; c="${BASH_REMATCH[2]}"
            cidr_range "$c" || continue
            PCV_LO+=("$R_LO"); PCV_HI+=("$R_HI"); PCV_P+=(",${pt//_/:},")
        done < <(grep -F '# csf_autogroup:' "$DENY_FILE" 2>/dev/null)
    fi
    [ "${#PCV_LO[@]}" -gt 0 ] || return 1
    ip2int "$ip"; n="$REPLY"
    for i in "${!PCV_LO[@]}"; do
        (( PCV_LO[i] <= n && PCV_HI[i] >= n )) && pc_ports "$k" "${PCV_P[i]}" && return 0
    done
    return 1
}
open_count() {   # NOT_DİZİSİ_ADI IP… → REPLY = servisi açık kalan (kapalı bir katmanca kapsanmayan) tekil sayısı
    local -n NT="$1"; shift
    local ip k o=0
    for ip in "$@"; do
        k=$(awk -v r="${NT[$ip]}" "$AWK_CLS"' BEGIN { print cls(r) }')
        if [ "$k" = repeat ]; then perm_cls "$ip"; [ -n "$REPLY" ] && k="$REPLY"; fi
        part_covers "$ip" "$k" && continue
        cover_any && prov_cover <<< "$ip|${NT[$ip]}|" && continue
        o=$((o + 1))
    done
    REPLY=$o
}
cover_any() {    # 0: geniş bir engel katmanı var (sağlayıcı banı, etkin kiralık liste, ülke banı) → kapsama denetimine değer
    [ -n "$ASB_ORD" ] || [ "$CLOUD_ON" = 1 ] || [ -n "$(conf_val CC_DENY)$(conf_val CC_DENY_PORTS)" ]
}
declare -A PERM_CLS=()
perm_cls() {     # IP → REPLY = PERMBLOCK alan IP'nin lfd günlüğündeki son geçici ban sebebinin servisi ("" bulunamadı)
    # lfd satırı: "lfd[n]: (mod_security) mod_security (id:2008) triggered by IP (IN/India/-): … *Blocked in csf* for 43200 secs"
    # ya da "(sshd) Failed SSH login from IP (…)". PERMBLOCK satırının kendisi "IP (CC/…) has had more than…" der, eşleşmez.
    local ip="$1" f l
    [ -n "${PERM_CLS[$ip]+x}" ] && { REPLY="${PERM_CLS[$ip]}"; return 0; }
    REPLY=""
    for f in "$LFD_LOG" "$LFD_LOG.1"; do
        [ -r "$f" ] || continue
        l=$(grep -hF -e "by $ip (" -e "from $ip (" "$f" 2>/dev/null | grep -F 'Blocked in csf' | grep -vi permblock | awk 'END { print }')
        [ -n "$l" ] && break
    done
    if [ -n "$l" ]; then
        l="${l#*]: }"
        REPLY=$(awk -v r="$l" "$AWK_CLS"' BEGIN { print cls(r) }')
        case "$REPLY" in repeat|other) REPLY="" ;; esac
    fi
    # yedek: lfd günlüğündeki PERMBLOCK satırı tetikleyen kuralın etiketini taşır ("… *Blocked in csf* [LF_SSHD]";
    # gerçek lfd ile ölçüldü 2026-10-09). Genel tetikleyicide ([LF_TRIGGER], ModSecurity) servis çıkmaz.
    if [ -z "$REPLY" ]; then
        for f in "$LFD_LOG" "$LFD_LOG.1"; do
            [ -r "$f" ] || continue
            l=$(grep -hF "(PERMBLOCK) $ip " "$f" 2>/dev/null | grep -oE '\[LF_[A-Z_]+\]' | awk 'END { print }')
            [ -n "$l" ] && break
        done
        if [ -n "$l" ]; then
            REPLY=$(awk -v r="$l" "$AWK_CLS"' BEGIN { print cls(r) }')
            case "$REPLY" in repeat|other) REPLY="" ;; esac
        fi
    fi
    PERM_CLS[$ip]="$REPLY"
}
prov_cover() {   # stdin "ip|sebep|asn" → 0: her IP CSF'te banlı bir sağlayıcıda ve ban saldırılan servisi kapatıyor
    # (her şey banında her servis; port listesi banında saldırının servisinin portları listede olmalı). Sahibi bilinmeyen IP: kapsanmıyor.
    local ip r a p n=0 k tcp cc ccd ccp IFS=$' \t\n'
    tcp=",$(conf_val CC_DENY_PORTS_TCP | tr -d ' '),"
    # ülke banı da kapsar: CC_DENY'deki ülke her şeyi, CC_DENY_PORTS'taki ülke yalnız o portları (IP kartı ve ban penceresi
    # bunu zaten biliyordu; uyarı kararı bilmiyor, ülkesi banlı ağ Kontrol edilecekler'de kalıyordu)
    ccd=",$(conf_val CC_DENY | tr -d ' ' | tr '[:lower:]' '[:upper:]'),"; ccp=",$(conf_val CC_DENY_PORTS | tr -d ' ' | tr '[:lower:]' '[:upper:]'),"
    PC_ASN=""
    while IFS='|' read -r ip r a; do
        [ -n "$ip" ] || continue
        [ -n "$a" ] || a="${OWN_A[${ip%.*}]}"
        k=$(awk -v r="$r" "$AWK_CLS"' BEGIN { print cls(r) }')
        # LFD PERMBLOCK (repeat): lfd IP'yi belirli sürede belirli sayıda geçici banladıktan sonra kalıcıya almış (LF_PERMBLOCK).
        # Asıl saldırı önceki geçici banlarda: servis lfd günlüğünden. Bulunamazsa IP sayılmadan geçilir — zaten tek başına
        # kalıcı ve tam banlı (yalnız PERMBLOCK varsa n=0 → kapsanmıyor, uyarı kalır). Önce PERMBLOCK "servisi bilinmiyor"
        # sayılıyor, web'i kapalı ağ (kiralık sunucu listesinde, web saldırıları + bir PERMBLOCK) Kontrol edilecekler'de kalıyordu.
        if [ "$k" = repeat ]; then perm_cls "$ip"; [ -n "$REPLY" ] || continue; k="$REPLY"; fi
        cc="${OWN_C[${ip%.*}]}"
        if [[ "$cc" =~ ^[A-Z]{2}$ ]] && { [[ "$ccd" == *",$cc,"* ]] || { [[ "$ccp" == *",$cc,"* ]] && pc_ports "$k" "$tcp"; }; }; then
            n=$((n + 1)); [[ " $PC_ASN " == *" CC_DENY $cc "* ]] || PC_ASN+="${PC_ASN:+ }CC_DENY $cc"; continue
        fi
        if [ -n "$a" ] && [ -n "${ASB[$a]}" ] && { [ "${ASB[$a]}" = all ] || pc_ports "$k" "$tcp"; }; then
            n=$((n + 1)); [[ " $PC_ASN " == *" AS$a "* ]] || PC_ASN+="${PC_ASN:+ }AS$a"; continue
        fi
        # sağlayıcı banı yoksa bulut listesi (kendi port listesiyle)
        cloud_has "$ip" && pc_ports "$k" ",${CLOUD_TCP// /}," || return 1
        cloud_label "$REPLY"; n=$((n + 1)); [[ " $PC_ASN " == *" $REPLY "* ]] || PC_ASN+="${PC_ASN:+, }$REPLY"
    done
    [ "$n" -gt 0 ]
}
prov_covmap() {  # "CIDR:TÜR:TCP:SERVİS" … → PCOV[CIDR]=ASNNN (çağıran local -A PCOV tanımlar)
    # Ban, CSF'in o sağlayıcı için YÜKLEDİĞİ aralıkların içinde kalıyorsa (ipset ile doğrulanır; ASN verisi farklı olabilir)
    # ve sağlayıcı banı bu banın kapattığı her şeyi kapatıyorsa: tam ban için "her şey", kısmi ban için portları listede.
    local IFS=$' \t\n' x c k tp sv a q="" el dt du rf ok pt
    PCOV=()
    asn_banned
    { [ ${#ASB_A[@]} -gt 0 ] && command -v ipset >/dev/null 2>&1; } || [ "$CLOUD_ON" = 1 ] || return 0
    dt=",$(conf_val CC_DENY_PORTS_TCP | tr -d ' '),"; du=",$(conf_val CC_DENY_PORTS_UDP | tr -d ' '),"
    local ct=",${CLOUD_TCP// /}," cu=",${CLOUD_UDP// /}," cx
    for x in "$@"; do
        IFS=: read -r c k tp sv <<< "$x"
        cidr_range "$c" || continue
        el=""
        for a in "${ASB_A[@]}"; do
            if [ "${ASB[$a]}" = all ]; then el+="${el:+,}$a"
            elif [ "$k" = partial ] && [ -n "$tp" ]; then
                ok=1
                for pt in ${tp//,/ }; do port_in "$pt" "$dt" || { ok=0; break; }; done
                [[ ",$sv," == *,web,* && "$du" != *,443,* ]] && ok=0          # web kısmi banı UDP 443'ü de kapatır
                [ "$ok" = 1 ] && el+="${el:+,}$a"
            fi
        done
        # bulut listesi (kendi port listesiyle; yalnız kısmi banlar — tam ban her şeyi kapatır, liste yalnız seçilen portları)
        if [ "$CLOUD_ON" = 1 ] && [ "$k" = partial ] && [ -n "$tp" ]; then
            ok=1
            for pt in ${tp//,/ }; do port_in "$pt" "$ct" || { ok=0; break; }; done
            [[ ",$sv," == *,web,* && "$cu" != *,443,* ]] && ok=0
            [ "$ok" = 1 ] && for cx in $CLOUD_ACTIVE; do el+="${el:+,}c_$cx"; done
        fi
        [ -n "$el" ] && q+="$c $R_LO $R_HI $el"$'\n'
    done
    [ -n "$q" ] || return 0
    rf=$(mktemp) || return 0
    for a in "${ASB_A[@]}"; do
        command -v ipset >/dev/null 2>&1 || break
        ipset list "cc_as$a" 2>/dev/null | awk -v a="$a" '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ {
            split($1, s, "/"); split(s[1], p, "."); b = (s[2] == "" ? 32 : s[2] + 0)
            lo = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]; printf "%s %.0f %.0f\n", a, lo, lo + 2 ^ (32 - b) - 1 }'
    done > "$rf.a"
    if [ "$CLOUD_ON" = 1 ]; then
        for cx in $CLOUD_ACTIVE; do
            [ -r "$CLOUD_DIR/$cx.txt" ] && awk -F'[./]' -v a="c_$cx" 'NF >= 4 { b = (NF == 5 ? $5 : 32); lo = (($1 * 256 + $2) * 256 + $3) * 256 + $4; printf "%s %.0f %.0f\n", a, lo, lo + 2 ^ (32 - b) - 1 }' "$CLOUD_DIR/$cx.txt"
        done >> "$rf.a"
    fi
    sort -k1,1 -k2,2n "$rf.a" > "$rf"; rm -f "$rf.a"
    while read -r c a; do [ -n "$a" ] || continue; if [[ "$a" == c_* ]]; then PCOV[$c]="cloud:${a#c_}"; else PCOV[$c]="AS$a"; fi; done < <(printf '%s' "$q" | awk -v rf="$rf" '
        BEGIN { while ((getline l < rf) > 0) { split(l, x, " "); a = x[1]; lo = x[2] + 0; hi = x[3] + 0; n = N[a] + 0
                    if (n && lo <= H[a, n] + 1) { if (hi > H[a, n]) H[a, n] = hi } else { N[a] = ++n; L[a, n] = lo; H[a, n] = hi } } }
        { lo = $2 + 0; hi = $3 + 0; k = split($4, as, ",")
          for (j = 1; j <= k; j++) { a = as[j]; for (i = 1; i <= N[a] + 0; i++) if (L[a, i] <= lo && H[a, i] >= hi) { print $1, a; next } } }')
    rm -f "$rf"
}
prov_near() {    # stdin "ip|sebep|asn" → 0: her IP banlı bir sağlayıcıda ya da bulut listesinde ama bazı saldırılar
    # kapalı olmayan portlara (PN_SRC = kapsayanlar, PN_SVC = kapanmayan servisler; panel "port listesine ekleyin" der)
    local IFS=$' \t\n' ip r a k n=0 tcp ct lab pl
    tcp=",$(conf_val CC_DENY_PORTS_TCP | tr -d ' '),"; ct=",${CLOUD_TCP// /},"
    PN_SRC=""; PN_SVC=""
    while IFS='|' read -r ip r a; do
        [ -n "$ip" ] || continue
        [ -n "$a" ] || a="${OWN_A[${ip%.*}]}"
        k=$(awk -v r="$r" "$AWK_CLS"' BEGIN { print cls(r) }')
        if [ "$k" = repeat ]; then perm_cls "$ip"; [ -n "$REPLY" ] && k="$REPLY"; fi     # PERMBLOCK: önceki geçici banın servisi
        if [ -n "$a" ] && [ -n "${ASB[$a]}" ]; then
            n=$((n + 1)); [ "${ASB[$a]}" = all ] && continue
            lab="AS$a"; pl="$tcp"
        elif cloud_has "$ip"; then cloud_label "$REPLY"; lab="$REPLY"; pl="$ct"; n=$((n + 1))
        else return 1; fi
        [[ ", $PN_SRC, " == *", $lab, "* ]] || PN_SRC+="${PN_SRC:+, }$lab"
        # sağlayıcının port listesi bu servisi kapatmıyorsa kiralık liste kapatıyor olabilir (ikisi birden geçerli)
        if [ "$pl" = "$tcp" ] && ! pc_ports "$k" "$pl" && cloud_has "$ip" && pc_ports "$k" "$ct"; then continue; fi
        if ! pc_ports "$k" "$pl"; then case "$k" in other|repeat|scan) ;; *) [[ ",$PN_SVC," == *",$k,"* ]] || PN_SVC+="${PN_SVC:+,}$k" ;; esac; fi
    done
    [ "$n" -gt 0 ] && [ -n "$PN_SVC" ]
}
ev_ipsrc() {     # OLAY_SATIRI → stdout "ip|sebep|asn" (olaydaki IP listesinden)
    printf '%s\n' "$1" | awk '{ s = $0
        while (match(s, /\{"ip":"[0-9.]+"[^}]*\}/)) {
            o = substr(s, RSTART, RLENGTH); s = substr(s, RSTART + RLENGTH)
            ip = o; sub(/^\{"ip":"/, "", ip); sub(/".*/, "", ip)
            w = ""; if (match(o, /"why":"([^"\\]|\\.)*"/)) w = substr(o, RSTART + 7, RLENGTH - 8)
            a = ""; if (match(o, /"asn":"[0-9]*"/)) a = substr(o, RSTART + 7, RLENGTH - 8)
            gsub(/\|/, " ", w); print ip "|" w "|" a } }'
}
cloud_cover() {  # DOSYA ("anahtar lo hi" satırları) → stdout "anahtar kaynak": etkin bir bulut listesinin içinde kalanlar
    local IFS=$' \t\n' x rf
    [ "$CLOUD_ON" = 1 ] && [ -n "${CLOUD_ACTIVE// /}" ] && [ -s "$1" ] || return 0
    rf=$(mktemp) || return 0
    for x in $CLOUD_ACTIVE; do
        [ -r "$CLOUD_DIR/$x.txt" ] && awk -F'[./]' -v s="$x" 'NF >= 4 { b = (NF == 5 ? $5 : 32); lo = (($1 * 256 + $2) * 256 + $3) * 256 + $4; printf "%.0f %.0f %s\n", lo, lo + 2 ^ (32 - b) - 1, s }' "$CLOUD_DIR/$x.txt"
    done | sort -n -k1,1 > "$rf"
    # aralıklar başlangıca göre sıralı; i'ye kadarki en büyük bitiş ≥ sorgunun bitişi ise sorgu bir aralığın içindedir
    awk -v rf="$rf" 'BEGIN { while ((getline l < rf) > 0) { split(l, x, " "); n++; L[n] = x[1] + 0; h = x[2] + 0
                             if (n == 1 || h > PM[n - 1]) { PM[n] = h; PS[n] = x[3] } else { PM[n] = PM[n - 1]; PS[n] = PS[n - 1] } } }
        { lo = $2 + 0; hi = $3 + 0; a = 1; b = n; k = 0
          while (a <= b) { c = int((a + b) / 2); if (L[c] <= lo) { k = c; a = c + 1 } else b = c - 1 }
          if (k && PM[k] >= hi) print $1, PS[k] }' "$1"
    rm -f "$rf"
}
declare -A CLB_S=()   # bütün banları bulut listesinde kalan sağlayıcılar → kaynak (asn_top doldurur)
declare -A AWHY=()    # sağlayıcı → en sık ban sebebi (tekil ban notlarından; asn_top doldurur)
CLB_A=()
asn_top() {      # [N] [evidence|blocks] → ASN_TOP satırları: "ASN|KURUM|CC|grup|blok|tekil|cc_deny(0/1)|bulutta|bulut listesi"
    # Sıralama saldırı kanıtına göre: kendi grup banlarımız + tekil banlar (lfd'nin yakaladıkları).
    # csf.deny'deki başka kaynaklı bloklar (elle / başka araç) gösterilir ama sıralamaya girmez.
    local -A G=() B=() T=() NM=() CC=() IS_AG=() DEN=() M=() IS_M=() CCOV=() CV=() CVS=() SCL=() PBC=()
    local c i p a qf k src ptl
    asn_banned
    # tekillerin saldırdığı servis bir kez (PERMBLOCK: lfd günlüğündeki önceki geçici ban)
    while read -r c k; do
        if [ "$k" = repeat ]; then perm_cls "$c"; [ -n "$REPLY" ] && k="$REPLY"; fi
        SCL[$c]="$k"
    done < <(for c in "${!SINGLE_NOTE[@]}"; do printf '%s|%s\n' "$c" "${SINGLE_NOTE[$c]}"; done | awk -F'|' "$AWK_CLS"'{ print $1, cls($2) }')
    ptl=",$(conf_val CC_DENY_PORTS_TCP | tr -d ' '),"
    # bulut listesinin kapsadığı tekiller ve bloklar sayılmaz (saldırdıkları sunucular zaten kapalı); ayrıca sayılır
    if [ "$CLOUD_ON" = 1 ] && qf=$(mktemp); then
        { for c in "${!SINGLE_NOTE[@]}"; do ip2int "$c"; echo "$c $REPLY $REPLY"; done
          for i in "${!DC_TXT[@]}"; do echo "${DC_TXT[i]} ${DC_LO[i]} ${DC_HI[i]}"; done; } > "$qf"
        while read -r k src; do CCOV[$k]="$src"; done < <(cloud_cover "$qf")
        rm -f "$qf"
        # tekil ban ancak saldırdığı servisin portları bulut listesinde kapalıysa kapsanmış sayılır (SSH saldırısı web listesiyle kapanmaz)
        local -A CLS_OK=() cl
        for c in "${!SINGLE_NOTE[@]}"; do
            [ -n "${CCOV[$c]}" ] || continue
            cl="${SCL[$c]}"
            [ -n "${CLS_OK[$cl]}" ] || { pc_ports "$cl" ",${CLOUD_TCP// /}," && CLS_OK[$cl]=1 || CLS_OK[$cl]=0; }
            [ "${CLS_OK[$cl]}" = 1 ] || unset "CCOV[$c]"
        done
    fi
    for c in "${AGG[@]}"; do IS_AG[$c]=1; done
    for c in "${MANB[@]}"; do IS_M[$c]=1; done                   # elle banlar: listede görünür, kanıt ağırlığı almaz
    for c in $(conf_val CC_DENY | LC_ALL=C tr '[:lower:],' '[:upper:] '); do DEN[$c]=1; done
    for c in "${!SINGLE_NOTE[@]}"; do
        p="${c%.*}"; a="${OWN_A[$p]}"; [ -n "$a" ] || continue
        NM[$a]="${OWN_N[$p]}"; CC[$a]="${OWN_C[$p]}"
        if [ -n "${CCOV[$c]}" ]; then CV[$a]=$(( ${CV[$a]:-0} + 1 )); CVS[$a]="${CCOV[$c]}"; continue; fi
        # port listesiyle banlı sağlayıcı: o portlara yapılan saldırı kapalı (sayılmaz); açık servislere olanlar sayılır
        if [ -n "${ASB[$a]}" ] && [ "${ASB[$a]}" != all ] && pc_ports "${SCL[$c]}" "$ptl"; then PBC[$a]=$(( ${PBC[$a]:-0} + 1 )); continue; fi
        T[$a]=$(( ${T[$a]:-0} + 1 ))
    done
    for i in "${!DC_TXT[@]}"; do
        c="${DC_TXT[i]%/*}"; p="${c%.*}"; a="${OWN_A[$p]}"; [ -n "$a" ] || continue
        if [ -n "${CCOV[${DC_TXT[i]}]}" ]; then CV[$a]=$(( ${CV[$a]:-0} + 1 )); CVS[$a]="${CCOV[${DC_TXT[i]}]}"; NM[$a]="${OWN_N[$p]}"; CC[$a]="${OWN_C[$p]}"; continue; fi
        [ -n "${ASB[$a]}" ] && continue                   # banlı sağlayıcının blok banları zaten ele alınmış (kanıt değil)
        if [ -n "${IS_AG[${DC_TXT[i]}]}" ]; then G[$a]=$(( ${G[$a]:-0} + 1 )); else B[$a]=$(( ${B[$a]:-0} + 1 )); fi
        [ -n "${IS_M[${DC_TXT[i]}]}" ] && M[$a]=$(( ${M[$a]:-0} + 1 ))
        NM[$a]="${OWN_N[$p]}"; CC[$a]="${OWN_C[$p]}"
    done
    # en sık ban sebebi: lfd notunun "(sshd) Failed SSH login" / "(mod_security) … (id:2008) triggered" kısmı (panel ModSecurity mesajını ekler)
    AWHY=()
    while IFS='|' read -r a k; do AWHY[$a]="$k"; done < <(for c in "${!SINGLE_NOTE[@]}"; do p="${c%.*}"; [ -n "${OWN_A[$p]}" ] && printf '%s|%s\n' "${OWN_A[$p]}" "${SINGLE_NOTE[$c]}"; done |
        awk -F'|' '{ r = $2; sub(/^[^:]*lfd[^:]*: */, "", r); sub(/^lfd - */, "", r); sub(/ (from|by) [0-9].*$/, "", r); gsub(/[|"\\]/, " ", r); if (r == "") next
                     C[$1, r]++; if (C[$1, r] > B[$1]) { B[$1] = C[$1, r]; W[$1] = r } } END { for (a in W) print a "|" substr(W[a], 1, 120) }')
    # bütün banları bulut listesinde kalan sağlayıcı sıralamaya girmez, "banlı" satırında listeyle görünür
    CLB_A=(); CLB_S=()
    for a in "${!CV[@]}"; do
        [ -z "${ASB[$a]}" ] && [ $(( ${G[$a]:-0} + ${B[$a]:-0} + ${T[$a]:-0} )) -eq 0 ] && { CLB_A+=("$a"); CLB_S[$a]="${CVS[$a]}"; }
    done
    ASN_TOP=$(for a in $(printf '%s\n' "${!G[@]}" "${!B[@]}" "${!T[@]}" | sort -u); do
        # "her şey" banlı sağlayıcı sıralamaya girmez; port listesiyle banlı olan ancak açık servislere saldırı sürüyorsa girer
        [ "${ASB[$a]}" = all ] && continue
        [ -n "${ASB[$a]}" ] && [ $(( ${G[$a]:-0} + ${B[$a]:-0} + ${T[$a]:-0} )) -eq 0 ] && continue
        # alan 7: 1 = port listesiyle banlı (kalan saldırılar açık servislere)
        printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$a" "${NM[$a]//|/ }" "${CC[$a]}" "${G[$a]:-0}" "${B[$a]:-0}" "${T[$a]:-0}" \
            "$([ -n "${ASB[$a]}" ] && echo 1 || echo 0)" "${CV[$a]:-0}" "${CVS[$a]:-}" $(( (${G[$a]:-0} - ${M[$a]:-0}) * 4 + ${T[$a]:-0} ))
    done | if [ "${2:-evidence}" = blocks ]; then awk -F'|' '$5 > 0' | sort -t'|' -k5,5nr; else sort -t'|' -k10,10nr -k5,5nr; fi \
         | cut -d'|' -f1-9 | awk -v n="${1:-10}" 'NR <= n')   # head değil: bkz. SIGPIPE notu
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
    asn_banned
    for a in $(for k in "${!CNT[@]}"; do [ -n "${ASB[$k]}" ] || echo "${CNT[$k]} $k"; done | sort -rn | awk -v n="${1:-10}" 'NR <= n {print $2}'); do
        line=$(for k in "${!RC[@]}"; do [ "${k%%|*}" = "$a" ] && echo "${RC[$k]} ${k#*|}"; done | sort -rn | awk 'NR <= 3 {printf "%s%s:%s", (NR>1?",":""), $2, $1}')
        IM_TOP+="$a|${NM[$a]//|/ }|${CC[$a]}|${CNT[$a]}|$line"$'\n'
    done
    IM_TOP="${IM_TOP%$'\n'}"
    return 0
}
ev_reason() {    # CIDR → REPLY = "3 IP · (sshd) Failed SSH login" (olay kaydından; yoksa boş)
    local id
    REPLY=$(grep -F "\"cidr\":\"$1\"" "$EVENTS_FILE" 2>/dev/null | grep -F '"ips":[{' | tail -n 1 | awk -v f="$M_H_RSUM" '
        NR == 1 { s = $0; n = 0
                  while (match(s, /"why":"[^"]*"/)) { w = substr(s, RSTART + 7, RLENGTH - 8); C[w]++; n++; s = substr(s, RSTART + RLENGTH) }
                  if (n) { b = ""; bm = 0; for (w in C) if (C[w] > bm) { bm = C[w]; b = w }; printf f, n, b }
                  exit }')
    REPLY="${REPLY/lfd - /}"
    # eski kayıtlarda ModSecurity sebebi yalnız numaralı: mesajı ekle
    if [[ "$REPLY" =~ \(mod_security\)\ mod_security\ \(id:([0-9]+)\)\ triggered ]]; then
        id="${BASH_REMATCH[1]}"; local pre="${REPLY%%(mod_security)*}"
        modsec_msg "$id"; REPLY="${pre}ModSecurity $id${REPLY:+: $REPLY}"
    fi
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
                if (ty ~ /^manual_/) ty = "manual"     # panelden yapılan işlemler; ayar değişikliği (config) ayrı sayılır
                c[ty]++
                if (ty == "run" && p0 == "" && match($0, /"perm_used":[0-9]+/)) p0 = substr($0, RSTART + 12, RLENGTH - 12) }
            END { for (k in c) print k "|" c[k]; print "perm0|" p0 }' "$EVENTS_FILE")
    fi
    [ -n "${C[perm0]}" ] && perm0="${C[perm0]}"
    limit=$(num "$(conf_val DENY_IP_LIMIT)"); tlimit=$(num "$(conf_val DENY_TEMP_IP_LIMIT)")
    pc=$(deny_count)
    tc=$("$CSF_BIN" -t 2>/dev/null 9>&- | grep -c "^DENY")
    DG_SUBJ=$(m "$M_DG_SUBJ" "$(hostname 2>/dev/null || echo "$HOSTNAME")")
    DG_BODY="$(m "$M_DG_HEAD" "$(date -d "@$since" '+%d.%m')" "$(date -d "@$now" '+%d.%m')")$NL$NL"
    local DGH="" hr hi hlab hv hk hcls
    DG_HTML=""
    DG_HSUB="$(hostname 2>/dev/null || echo "$HOSTNAME") · $(date -d "@$since" '+%d.%m') – $(date -d "@$now" '+%d.%m')"
    # yeni sürüm var mı (GitHub; en çok 30 sn, ulaşılamazsa satır eklenmez)
    local br rv to=""
    command -v timeout >/dev/null 2>&1 && to="timeout 30"
    if command -v git >/dev/null 2>&1 && [ -d "$SELF_DIR/.git" ]; then
        br=$(git -C "$SELF_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
        if [ -n "$br" ] && [ "$br" != HEAD ] && GIT_TERMINAL_PROMPT=0 $to git -C "$SELF_DIR" fetch --quiet origin "$br" >/dev/null 2>&1 9>&-; then
            rv=$(git -C "$SELF_DIR" show "origin/$br:csf_autogroup.sh" 2>/dev/null | sed -n 's/^VERSION="\([^"]*\)".*/\1/p' | awk 'NR == 1')
            if [ -n "$rv" ] && [ "$rv" != "$VERSION" ] && [ "$(git -C "$SELF_DIR" rev-parse @ 2>/dev/null)" != "$(git -C "$SELF_DIR" rev-parse "origin/$br" 2>/dev/null)" ]; then
                DG_BODY+="$(m "$M_DG_UPD" "$VERSION" "$rv")$NL$NL"
                h_esc "$(m "$M_DG_UPD" "$VERSION" "$rv")"
                DGH+="<tr><td bgcolor=\"#eef2ff\" style=\"background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:12px 18px;font-family:$H_FONT;font-size:13px;color:#3730a3;\">$REPLY</td></tr>$H_SP"
            fi
        fi
    fi
    DG_BODY+="$(m "$M_DG_COUNTS" "${C[add24]:-0}" "${C[temp24]:-0}" "${C[promote]:-0}" "${C[warn16]:-0}" "${C[skip_wl]:-0}" "${C[manual]:-0}" "${C[config]:-0}")$NL"
    DG_BODY+="$(m "$M_DG_USAGE" "$pc" "$limit" "$([ "$limit" -gt 0 ] && echo $(( pc * 100 / limit )) || echo 0)" "$perm0")$NL"
    DG_BODY+="$(m "$M_DG_TUSAGE" "$tc" "$tlimit")$NL$NL"
    # HTML: sayılar (yedi hücre) + liste doluluğu
    hr=""; hi=0; IFS='|' read -ra hlab <<< "$M_H_CNT"
    for hv in "${C[add24]:-0}" "${C[temp24]:-0}" "${C[promote]:-0}" "${C[warn16]:-0}" "${C[skip_wl]:-0}" "${C[manual]:-0}" "${C[config]:-0}"; do
        hr+="<td align=\"center\" style=\"padding:12px 4px;width:14%;${hr:+border-left:1px solid #eef0f3;}\"><div style=\"font-size:22px;font-weight:700;$([ "$hi" = 3 ] && [ "$hv" -gt 0 ] && echo 'color:#b45309;')\">$hv</div><div style=\"font-size:11.5px;color:#5f6776;\">${hlab[hi]}</div></td>"
        hi=$((hi + 1))
    done
    DGH+="<tr><td bgcolor=\"#ffffff\" style=\"background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;padding:6px;font-family:$H_FONT;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>$hr</tr></table></td></tr>$H_SP"
    h_usage "$pc" "$limit" "$tc" "$tlimit" "$([[ "$perm0" =~ ^[0-9]+$ ]] && echo "$perm0")"; DGH+="$REPLY"
    hr=""
    # yeni grup banları (7 gün): add24 / promote / manual_ban
    DG_BODY+="$M_DG_NEW$NL"
    if [ -r "$EVENTS_FILE" ]; then
        while IFS='|' read -r cidr owner hk; do
            ev_reason "$cidr"; local rs="$REPLY"
            DG_BODY+="   $(printf '%-18s' "$cidr") ${owner:--}${rs:+ · $rs}$NL"; n=$((n + 1))
            hv="M_H_K_$hk"; h_esc "${owner:-—}"; [ -n "$rs" ] && { local ho="$REPLY"; h_esc "$rs"; REPLY="$ho<br><span style=\"font-size:12px;color:#5f6776;\">$REPLY</span>"; }
            hcls="background:#f3f4f6;color:#4b5563;border:1px solid #e6e8ef"
            [ "$hk" = promote ] && hcls="background:#f3edff;color:#7c3aed;border:1px solid #ddd0fb"
            [ "$hk" = manual_ban ] && hcls="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca"
            hr+="<tr$([ $((n % 2)) = 0 ] && echo ' bgcolor="#f7f8fa" style="background:#f7f8fa;"')><td style=\"padding:8px 8px 8px 18px;font-family:$H_MONO;font-weight:600;\">$cidr</td><td style=\"padding:8px;color:#4b5563;\">$REPLY</td><td align=\"right\" style=\"padding:8px 18px 8px 8px;\"><span style=\"$hcls;border-radius:10px;padding:2px 8px;font-size:11.5px;font-weight:600;white-space:nowrap;\">${!hv:-$hk}</span></td></tr>"
        done < <(awk -v s="$since" '
            match($0, /"t":[0-9]+/) { t = substr($0, RSTART + 4, RLENGTH - 4) + 0 } t < s { next }
            /"type":"(add24|promote|manual_ban)"/ {
                c = ""; o = ""
                if (match($0, /"cidr":"[0-9.\/]+"/)) c = substr($0, RSTART + 8, RLENGTH - 9)
                if (match($0, /"owner":"[^"]*"/)) o = substr($0, RSTART + 9, RLENGTH - 10)
                if (match($0, /"type":"[a-z0-9_]+"/)) ty = substr($0, RSTART + 8, RLENGTH - 9)
                print c "|" o "|" ty }' "$EVENTS_FILE" | tail -n 25)
    fi
    [ "$n" -eq 0 ] && DG_BODY+="$M_DG_NONE$NL"
    if [ -n "$hr" ]; then
        hr="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:13px;\"><tr><td style=\"$H_TH;padding:10px 8px 6px 18px;\">$M_H_BLOCK</td><td style=\"$H_TH;padding:10px 8px 6px;\">$M_H_OWNER</td><td align=\"right\" style=\"$H_TH;padding:10px 18px 6px 8px;\">$M_H_STATE</td></tr>$hr</table><div style=\"height:8px;\"></div>"
    else h_box "padding:12px 18px 14px;font-size:13px;color:#5f6776;" "$M_H_NONE"; hr="$REPLY"; fi
    h_card "$M_H_NEWT" "$hr"; DGH+="$REPLY"; hr=""; hi=0
    # sağlayıcı banı: CSF'te banlı sağlayıcılar (sıralamalara girmezler) + izinli servislerin durumu
    asn_banned
    local pt pu pk svl="" svf="" stf
    pt=$(conf_val CC_DENY_PORTS_TCP | tr -cd '0-9,:'); pu=$(conf_val CC_DENY_PORTS_UDP | tr -cd '0-9,:')
    pk="${pt:+TCP ${pt//,/, }}${pt:+${pu:+ · }}${pu:+UDP ${pu//,/, }}"
    stf="$(dirname "$SAYAC_FILE")/services/status"
    if [ "$SVC_ALLOW" = 1 ] && [ -r "$stf" ]; then
        local sn st se sf stot=0 slast=0
        while IFS='|' read -r sn st se sf hk; do
            [[ "$st" =~ ^[0-9]+$ ]] && stot=$(( stot + st )); [[ "$se" =~ ^[0-9]+$ ]] && [ "$se" -gt "$slast" ] && slast=$se
            [ -n "$sf" ] && [[ "$hk" =~ ^[0-9]+$ ]] && [ "$hk" -gt 0 ] && [ $(( now - hk )) -gt 259200 ] && svf+="${svf:+, }$sn"
        done < "$stf"
        svl=$(m "$M_H_SVC" "$stot" "$([ "$slast" -gt 0 ] && date -d "@$slast" '+%d.%m %H:%M' || echo '—')")
    fi
    local cll=""
    if [ "$CLOUD_BAN" = 1 ] && [ -r "$CLOUD_DIR/status" ]; then
        local cnn ccc cpk
        while IFS='|' read -r cnn ccc hk; do cloud_label "$cnn"; cll+="${cll:+, }$REPLY $ccc"; done < "$CLOUD_DIR/status"
        cpk="${CLOUD_TCP:+TCP ${CLOUD_TCP//,/, }}${CLOUD_TCP:+${CLOUD_UDP:+ · }}${CLOUD_UDP:+UDP ${CLOUD_UDP//,/, }}"
        [ -n "$cll" ] && cll=$(m "$M_DG_CLOUD" "$cll" "${cpk:--}")
    fi
    if [ -n "$ASB_ORD" ] || [ -n "$svl" ] || [ -n "$cll" ]; then
        DG_BODY+="$M_DG_PB$NL"
        for a in "${ASB_A[@]}"; do
            asn_name "AS$a"; owner="$REPLY"; asn_setn "AS$a"; b="$REPLY"
            hv="$([ "${ASB[$a]}" = all ] && echo "$M_H_PBALL" || echo "${pk:--}")"
            DG_BODY+="$(m "$M_DG_PBL" "AS$a" "${owner:0:44}" "$hv$([ "$b" -ge 0 ] && echo " · $([ "$b" -gt 0 ] && echo "$b $M_H_PBR" || echo "$M_H_PBNL")")")$NL"
            h_esc "$owner"; hi=$((hi + 1)); line="$REPLY"; h_esc "$hv"
            hr+="<tr$([ $((hi % 2)) = 0 ] && echo ' bgcolor="#f7f8fa" style="background:#f7f8fa;"')><td style=\"padding:8px 8px 8px 18px;\"><b style=\"font-family:$H_MONO;color:#4338ca;\">AS$a</b> $line</td><td style=\"padding:8px;color:#4b5563;\">$REPLY</td>"
            if [ "$b" -eq 0 ]; then hr+="<td align=\"right\" style=\"padding:8px 18px 8px 8px;color:#b45309;font-weight:600;\">$M_H_PBNL</td></tr>"
            else hr+="<td align=\"right\" style=\"padding:8px 18px 8px 8px;\">$([ "$b" -gt 0 ] && echo "$b" || echo '—')</td></tr>"; fi
        done
        [ -n "$cll" ] && DG_BODY+="   $cll$NL"
        [ -n "$svl" ] && DG_BODY+="   $svl$NL"
        [ -n "$svf" ] && DG_BODY+="   $(m "$M_H_SVCF" "$svf")$NL"
        [ -n "$hr" ] && hr="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:13px;\"><tr><td style=\"$H_TH;padding:10px 8px 6px 18px;\">$M_H_PROV</td><td style=\"$H_TH;padding:10px 8px 6px;\">$M_H_PBK</td><td align=\"right\" style=\"$H_TH;padding:10px 18px 6px 8px;\">$M_H_PBR</td></tr>$hr</table>"
        if [ -n "$cll" ]; then h_esc "$cll"; h_box "padding:10px 18px 4px;font-size:12.5px;color:#4b5563;${hr:+border-top:1px solid #eef0f3;}" "$REPLY"; hr+="$REPLY"; fi
        if [ -n "$svl" ]; then h_esc "$svl"; h_box "padding:10px 18px 4px;font-size:12.5px;color:#4b5563;${hr:+border-top:1px solid #eef0f3;}" "$REPLY"; hr+="$REPLY"; fi
        if [ -n "$svf" ]; then h_esc "$(m "$M_H_SVCF" "$svf")"; h_box "padding:2px 18px 4px;font-size:12.5px;color:#b45309;font-weight:600;" "$REPLY"; hr+="$REPLY"; fi
        hr+="<div style=\"height:8px;\"></div>"
        h_card "$M_H_PBT" "$hr" "$([ -n "$svf" ] && echo warn)" "$([ -n "$ASB_ORD" ] && echo "$M_H_PBS")"; DGH+="$REPLY"; hr=""; hi=0
        DG_BODY+="$NL"
    fi
    # en çok saldıran ağlar
    DG_BODY+="$M_DG_TOP$NL"
    asn_top 5
    if [ -n "$ASN_TOP" ]; then
        while IFS='|' read -r a owner k b bl line den cl cs; do
            DG_BODY+="$(m "$M_DG_TOPL" "AS$a" "${owner:0:44}" "$(asn_parts "$b" "$bl" "$line")")$NL"   # kurum adı ülkeyle bitiyor
            h_esc "$owner"; hi=$((hi + 1))
            hr+="<tr$([ $((hi % 2)) = 0 ] && echo ' bgcolor="#f7f8fa" style="background:#f7f8fa;"')><td style=\"padding:8px 8px 8px 18px;\"><b style=\"font-family:$H_MONO;color:#4338ca;\">AS$a</b> $REPLY</td>"
            hr+="<td align=\"right\" style=\"padding:8px;$([ "$b" -gt 0 ] && echo 'font-weight:600;' || echo 'color:#5f6776;')\">$([ "$b" -gt 0 ] && echo "$b" || echo '—')</td>"
            hr+="<td align=\"right\" style=\"padding:8px;$([ "$line" -gt 0 ] && echo 'font-weight:600;' || echo 'color:#5f6776;')\">$([ "$line" -gt 0 ] && echo "$line" || echo '—')</td>"
            hr+="<td align=\"right\" style=\"padding:8px 18px 8px 8px;color:#5f6776;\">$([ "$bl" -gt 0 ] && m "$M_H_OTHV" "$bl" || echo '—')</td></tr>"
        done <<< "$ASN_TOP"
    else DG_BODY+="$M_DG_NONE$NL"; fi
    if [ -n "$hr" ]; then
        hr="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:13px;\"><tr><td style=\"$H_TH;padding:10px 8px 6px 18px;\">$M_H_PROV</td><td align=\"right\" style=\"$H_TH;padding:10px 8px 6px;\">$M_H_BLK</td><td align=\"right\" style=\"$H_TH;padding:10px 8px 6px;\">$M_H_SGL</td><td align=\"right\" style=\"$H_TH;padding:10px 18px 6px 8px;\">$M_H_OTH</td></tr>$hr</table><div style=\"height:8px;\"></div>"
    else h_box "padding:12px 18px 14px;font-size:13px;color:#5f6776;" "$M_H_NONE"; hr="$REPLY"; fi
    h_card "$M_H_TOPT" "$hr" "" "$M_H_TOPS"; DGH+="$REPLY"; hr=""; hi=0
    # Imunify360: sunucunun kendi kara listesi
    if imunify_top 5 && [ -n "$IM_TOP" ]; then
        DG_BODY+="$NL$(m "$M_DG_IM" "$IM_TOTAL")$NL"
        while IFS='|' read -r a owner k b line; do
            line="${line//:/ }"; line="${line//,/, }"          # "CAPTCHA_DOS_ALERT 900, WAF 12"
            DG_BODY+="$(m "$M_DG_IML" "AS$a" "${owner:0:44}" "$b" "${line:+ ($line)}")$NL"
            h_esc "$owner"; hi=$((hi + 1)); hv="$REPLY"; h_esc "$line"
            hr+="<tr$([ $((hi % 2)) = 0 ] && echo ' bgcolor="#f7f8fa" style="background:#f7f8fa;"')><td style=\"padding:8px 8px 8px 18px;\"><b style=\"font-family:$H_MONO;color:#4338ca;\">AS$a</b> $hv</td><td align=\"right\" style=\"padding:8px;font-weight:600;\">$b</td><td align=\"right\" style=\"padding:8px 18px 8px 8px;color:#5f6776;font-size:12px;\">$REPLY</td></tr>"
        done <<< "$IM_TOP"
        hr="<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:13px;\"><tr><td style=\"$H_TH;padding:10px 8px 6px 18px;\">$M_H_PROV</td><td align=\"right\" style=\"$H_TH;padding:10px 8px 6px;\">$M_H_IPS</td><td align=\"right\" style=\"$H_TH;padding:10px 18px 6px 8px;\">$M_H_RSN</td></tr>$hr</table><div style=\"height:8px;\"></div>"
        h_card "$M_H_IMT" "$hr" "" "$(m "$M_H_IMS" "$IM_TOTAL")"; DGH+="$REPLY"; hr=""
    fi
    # süresi dolacak terfi kayıtları
    DG_BODY+="$NL$M_DG_EXP$NL"
    while read -r p u; do
        [[ "$p" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ && "$u" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
        age=$(( (now - $(date -d "$u" +%s)) / 86400 )); left=$(( SAYAC_RETENTION_DAYS - age ))
        [ "$left" -le 14 ] || continue
        ev_reason "$p.0/24"; local xr="$REPLY" xo="${OWN_L[$p]}"
        DG_BODY+="$(m "$M_DG_EXPL" "$p.0/24" "$left")${xo:+ · $xo}${xr:+ · $xr}$NL"; exp=$((exp + 1))
        h_esc "${xo}${xo:+${xr:+ · }}${xr}"
        hr+="${hr:+<br>}<span style=\"font-family:$H_MONO;\">$p.0/24</span> <span style=\"color:#5f6776;\">· $(m "$M_H_DAYS" "$left")</span>${REPLY:+<br><span style=\"font-size:12px;color:#5f6776;\">$REPLY</span>}"
    done < "$SAYAC_FILE"
    [ "$exp" -eq 0 ] && DG_BODY+="$M_DG_NONE$NL"
    # Beklenen tur sayısı, olay kaydının başladığı andan itibaren hesaplanır: kayıt yeni başladıysa
    # "7 günde 2 tur (beklenen 336)" gibi yanlış bir alarm vermesin.
    iv=$(cron_interval); runs="${C[run]:-0}"
    local first win
    first=$(grep -m1 '"type":"run"' "$EVENTS_FILE" 2>/dev/null | grep -o '"t":[0-9]*' | cut -d: -f2)
    win=$(( now - since )); [ -n "$first" ] && [ "$first" -gt "$since" ] && win=$(( now - first ))
    if [ "$iv" -gt 0 ]; then
        local ivt; if [ $(( iv % 3600 )) -eq 0 ]; then [ "$iv" -eq 3600 ] && ivt="$M_IV_HOUR" || ivt=$(m "$M_IV_HOURS" $(( iv / 3600 )))
                   else ivt=$(m "$M_IV_MIN" $(( iv / 60 ))); fi
        if [ "$MSG_LANG" = tr ]; then DG_BODY+="$NL$(m "$M_DG_RUNS" "$runs" "$ivt" "$(( win / iv + 1 ))")$NL"
        else DG_BODY+="$NL$(m "$M_DG_RUNS" "$runs" "$(( win / iv + 1 ))" "$ivt")$NL"; fi
    else DG_BODY+="$NL$(m "$M_DG_RUNS0" "$runs")$NL"; fi
    [ -n "$PANEL_FOOT" ] && DG_BODY+="$NL${PANEL_FOOT%$NL}"
    # HTML: izleme + tur sağlığı tek kartta; turlar beklenenin %90'ının altındaysa rozet turuncu
    hv="?"; [ "$iv" -gt 0 ] && hv=$(( win / iv + 1 ))
    hcls="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0"
    [[ "$hv" =~ ^[0-9]+$ ]] && [ $(( runs * 10 )) -lt $(( hv * 9 )) ] && hcls="background:#fffbeb;color:#b45309;border:1px solid #fde68a"
    DGH+="<tr><td bgcolor=\"#ffffff\" style=\"background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;padding:14px 18px;font-family:$H_FONT;font-size:13px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">"
    DGH+="<tr><td valign=\"top\" style=\"padding-bottom:10px;\"><b>$M_H_EXPT</b> <span style=\"color:#5f6776;\">· $M_H_EXPS</span>${hr:+<br>$hr}</td><td align=\"right\" valign=\"top\" style=\"padding-bottom:10px;color:#5f6776;\">$([ -z "$hr" ] && echo "$M_H_NONE_S")</td></tr>"
    DGH+="<tr><td style=\"border-top:1px solid #eef0f3;padding-top:10px;\"><b>$M_H_RUNS</b> <span style=\"color:#5f6776;\">· $M_H_RUNSS</span></td><td align=\"right\" style=\"border-top:1px solid #eef0f3;padding-top:10px;\"><span style=\"$hcls;border-radius:10px;padding:2px 8px;font-size:12px;font-weight:600;white-space:nowrap;\">$(m "$M_H_RUNSV" "$runs" "$hv")</span></td></tr></table></td></tr>$H_SP"
    h_doc "$M_H_WEEK" "$DG_HSUB" "$DGH"; DG_HTML="$REPLY"
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
    mail_on && send_mail "$DG_SUBJ" "$DG_BODY" "$DG_HTML"
    slack_on && [ "$IC_DIGEST" = 1 ] && ic_send Digest "$DG_SUBJ" "$DG_BODY"
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
                o+="},\"defaults\":{\"MSG_LANG\":\"en\",\"ALERT_MAIL\":\"whm\",\"DIGEST\":\"1\",\"DIGEST_DAY\":\"1\",\"NOTIFY\":\"all\",\"IC_FIREWALL\":\"1\",\"IC_LISTFULL\":\"1\",\"IC_RUN\":\"1\",\"IC_DIGEST\":\"1\",\"THRESHOLD_24\":\"3\",\"THRESHOLD_24_PERMANENT\":\"5\",\"THRESHOLD_16\":\"5\",\"THRESHOLD_TEMP_24\":\"3\",\"THRESHOLD_TEMP_16\":\"5\",\"LOOKUP\":\"1\",\"LOOKUP_TIMEOUT\":\"2\",\"SAYAC_RETENTION_DAYS\":\"180\",\"REVIEW_DAYS\":\"7\",\"LOG_MAX_LINES\":\"5000\",\"LOG_ROTATE_MB\":\"1\",\"LOG_ROTATE_KEEP\":\"5\",\"BLOCK_EXPIRE_DAYS\":\"365\",\"BLOCK_EXPIRE_AUTO\":\"0\",\"CRON_MIN\":\"*/10\"}"
                ALERT_MAIL=whm mail_to; jstr "$REPLY"; o+=",\"whm_contact\":$REPLY"
                slack_url; o+=",\"slack\":$([ -n "$REPLY" ] && echo true || echo false)"
                o+=",\"csf\":{\"deny_limit\":$(num "$(conf_val DENY_IP_LIMIT)"),\"temp_limit\":$(num "$(conf_val DENY_TEMP_IP_LIMIT)")}"
                local lb=0 la=0 ll=0
                [ -f "$LOG_FILE" ] && { lb=$(wc -c < "$LOG_FILE"); ll=$(wc -l < "$LOG_FILE"); }
                la=$(ls -1 "$LOG_FILE".[0-9]* 2>/dev/null | grep -c .)
                o+=",\"log\":{\"rotate\":$([ -f "$LOGROTATE_CONF" ] && echo true || echo false),\"bytes\":$(num "$lb"),\"lines\":$(num "$ll"),\"archives\":$(num "$la")}"
                # Sunucu gereksinimleri (Ayarlar sekmesindeki kart): ok | missing | warn
                local dp="" dk ds
                for dk in csf crontab mail dns logrotate flock timeout git imunify modsec sqlite3; do
                    ds=missing
                    case "$dk" in
                        csf)       { [ -x "$CSF_BIN" ] || command -v csf >/dev/null 2>&1; } && ds=ok ;;
                        dns)       [ -n "$DIG_BIN$HOST_BIN" ] && ds=ok ;;
                        imunify)   [ -n "$IMUNIFY_BIN" ] && [ -x "$IMUNIFY_BIN" ] && ds=ok ;;
                        # ModSecurity: cPanel'in eşleşme kaydı var → ok; yalnız günlük var → warn (kural dosyasından okunur)
                        modsec)    if [ -r "$MODSEC_DB" ]; then ds=ok; elif [ -r "$(conf_val MODSEC_LOG)" ]; then ds=warn; fi ;;
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
                # config.env bash ile okunur: boşluk ya da özel karakter içeren değer (ör. SVC_EXTRA) tırnaklı yazılır
                if [ "$k" = CRON_MIN ]; then cron_new="${NEW[$k]}"
                elif [[ "${NEW[$k]}" =~ [^A-Za-z0-9@._%+*/:,=-] ]]; then lines+="$k=\"${NEW[$k]}\""$'\n'
                else lines+="$k=${NEW[$k]}"$'\n'; fi
                jstr "$old"; o="$REPLY"; jstr "${NEW[$k]}"
                changes+="${changes:+,}{\"key\":\"$k\",\"from\":$o,\"to\":$REPLY}"
                logs+=("$(m "$M_CFG_LOG" "$AG_BY" "$k" "${old:--}" "${NEW[$k]}")")
            done
            [ "$n" -eq 0 ] && { act_out 0 "$M_CFG_NOCHANGE"; return 0; }
            # sağlayıcı ayarlarından biri kaydedilince hepsi o anki değerleriyle yazılır: "auto" (CSF'teki elle kurulumu
            # devralma) yalnız hiç kaydedilmemişken geçerli; yoksa her tur CSF'teki değişikliği istek sanırdı
            local pk pv pt=0
            for pk in $PROV_KEYS; do [ -n "${NEW[$pk]+x}" ] && pt=1; done
            if [ "$pt" = 1 ]; then
                for pk in $PROV_KEYS; do
                    [[ $'\n'"$lines" == *$'\n'"$pk="* ]] && continue          # değişti, zaten yazılacak
                    grep -qE "^$pk=" "$CFG_FILE" 2>/dev/null && continue
                    pv="$(cfg_value "$pk")"
                    if [[ "$pv" =~ [^A-Za-z0-9@._%+*/:,=-] ]]; then lines+="$pk=\"$pv\""$'\n'; else lines+="$pk=$pv"$'\n'; fi
                done
            fi
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
            local tmt tmh
            tmt=$( m "$M_TM_BODY" "$(hostname 2>/dev/null || echo "$HOSTNAME")" "$AG_BY"; printf '\n\n%s' "$plink" )
            h_text "$(m "$M_TM_BODY" "$(hostname 2>/dev/null || echo "$HOSTNAME")" "$AG_BY")"; h_card "$M_H_TMT" "$REPLY"; tmh="$REPLY"
            h_doc "CSF Auto-Group" "$M_H_TMS" "$tmh"
            send_mail "$M_TM_SUBJ" "$tmt" "$REPLY"; rc=$?; out="$SM_OUT"
            if [ "$rc" -eq 0 ]; then
                log "$(m "$M_A_LOG" "$AG_BY" "$(m "$M_TM_SENT" "$SM_TO")")"
                jstr "$SM_TO"; ev test_mail "" "by=\"$AG_BY\"" "to=$REPLY"
                act_out 0 "$(m "$M_TM_SENT" "$SM_TO")"
            else
                act_out 1 "$(m "$M_TM_FAIL" "${out%%$NL*}")"
            fi ;;
        test-slack)
            # ayarlardan bağımsız: WHM'deki Slack adresini hemen dener
            if ic_send Test "$M_IC_TEST_S" "$(m "$M_IC_TEST_B" "$(hostname 2>/dev/null || echo "$HOSTNAME")" "$AG_BY")"; then
                log "$(m "$M_A_LOG" "$AG_BY" "$M_IC_SENT")"; act_out 0 "$M_IC_SENT"
            else act_out 1 "$(m "$M_IC_FAIL" "${IC_OUT%%$NL*}")"; fi ;;
        *) act_out 2 "$(m "$M_A_UNKNOWN" "$sub")" ;;
    esac
}

[ -f "$DENY_FILE" ] || { log "$(m "$M_ERR_NOFILE" "$DENY_FILE")"; exit 1; }
[ -f "$CSF_CONF" ]  || { log "$(m "$M_ERR_NOFILE" "$CSF_CONF")"; exit 1; }
mkdir -p "$(dirname "$SAYAC_FILE")"; touch "$SAYAC_FILE"

prov_resolve     # "auto" ayarlar: CSF'te elle kurulmuş sağlayıcı banı / izin listesi devralınır
case "$MODE" in
    status) LOG_MODE=quiet; do_status; exit $? ;;
    lookup) LOG_MODE=quiet; do_lookup "${ARGS[0]}"; exit $? ;;
    events) LOG_MODE=quiet; do_events "${ARGS[0]}" "${ARGS[1]}" "${ARGS[2]}"; exit $? ;;
    inside) LOG_MODE=quiet; do_inside "${ARGS[0]}"; exit $? ;;
    asnimpact) LOG_MODE=quiet; do_asn_impact "${ARGS[0]}"; exit $? ;;
    prov)   LOG_MODE=file; take_lock || { act_out 3 "$M_BUSY"; exit 3; }
            svc_enforce 0
            if [ "$ENABLED" = 0 ]; then ASN_BAN=0 asn_enforce; CLOUD_BAN=0 cloud_enforce 0; else asn_enforce; cloud_enforce 0; fi
            prov_json; echo "{\"ok\":true,\"prov\":$REPLY}"; exit 0 ;;
    action) LOG_MODE=file; do_action "$ACT" "${ARGS[0]}" "${ARGS[1]}"; exit $? ;;
    config) LOG_MODE=file; do_config; exit $? ;;
    busy)   if lock_busy; then echo busy; else echo idle; fi; exit 0 ;;
    logrotate) logrotate_write && { echo "$LOGROTATE_CONF"; exit 0; }; exit 1 ;;   # install.sh çağırır   # eklenti "Şimdi çalıştır"dan önce sorar
    digest) LOG_MODE=file; owners_load; parse_deny "$DENY_FILE" 1; panel_init; digest_build
            if [ "$SEND" = 1 ]; then mail_on && send_mail "$DG_SUBJ" "$DG_BODY" "$DG_HTML"; slack_on && [ "$IC_DIGEST" = 1 ] && ic_send Digest "$DG_SUBJ" "$DG_BODY"; log "$(m "$M_DG_SENT" "$ALERT_MAIL")"; ev digest "" "by=\"$AG_BY\""
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
if [ "$ENABLED" = 0 ]; then
    [ "$DRY" = 1 ] || { ASN_BAN=0 asn_enforce; CLOUD_BAN=0 cloud_enforce 0; }    # sağlayıcı ve bulut banı CSF'te kapalı kalsın
    logr "$M_PAUSED"
    ev run "" "v=\"$VERSION\"" "dur=$(( $(date +%s) - RUN_T0 ))" "added=0" "warn16=0" "paused=true"
    exit 0
fi

# ── Permanent deny limit ────────────────────────────────────────────────────
limit=$(grep "^DENY_IP_LIMIT" "$CSF_CONF" | cut -d'=' -f2 | tr -d ' "')
current_count=$(deny_count)          # CSF'in kendi sayımıyla aynı (do not delete satırları sınıra girmez)
if [ -n "$limit" ] && [ "$limit" -gt 0 ] 2>/dev/null; then
    percent=$((current_count * 100 / limit))
    logr "$(m "$M_PERM_USAGE" "$current_count" "$limit" "$percent")"
    if [ "$percent" -ge 80 ]; then
        log "$(m "$M_PERM_WARN")"
        doluluk_satiri=$(m "$M_PERM_FULL" "$current_count" "$limit" "$percent")
        if ! grep -qF "LIMIT_PERM $TODAY" "$SAYAC_FILE"; then      # günde bir kez (her turda değil)
            MAIL_URGENT=1; mail_add "$(m "$M_MAIL_PERMFULL_SUBJ" "$percent")" "$(m "$M_MAIL_PERMFULL_BODY")" bad; cnt_add "LIMIT_PERM $TODAY"
        fi
    else
        doluluk_satiri=$(m "$M_PERM_USAGE" "$current_count" "$limit" "$percent")
    fi
    ic_track IC_LISTFULL ListPerm "$([ "$percent" -ge 80 ] && echo 1 || echo 0)" "$(m "$M_IC_PERM" "$percent")" \
        "$(m "$M_PERM_FULL" "$current_count" "$limit" "$percent")$NL$(m "$M_MAIL_PERMFULL_BODY")" "$(m "$M_IC_PERM_OK")"
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
            MAIL_URGENT=1; mail_add "$(m "$M_MAIL_TEMPFULL_SUBJ" "$temp_percent")" "$(m "$M_MAIL_TEMPFULL_BODY")" bad; cnt_add "LIMIT_TEMP $TODAY"
        fi
    else
        temp_doluluk_satiri=$(m "$M_TEMP_USAGE" "$temp_current" "$temp_limit" "$temp_percent")
    fi
    ic_track IC_LISTFULL ListTemp "$([ "$temp_percent" -ge 80 ] && echo 1 || echo 0)" "$(m "$M_IC_TEMP" "$temp_percent")" \
        "$(m "$M_TEMP_FULL" "$temp_current" "$temp_limit" "$temp_percent")$NL$(m "$M_MAIL_TEMPFULL_BODY")" "$(m "$M_IC_TEMP_OK")"
else
    log "$(m "$M_NOLIMIT" "DENY_TEMP_IP_LIMIT")"; temp_doluluk_satiri=""
fi

# ── Read csf.deny: singles (grouping) + CIDRs (coverage) ────────────────────
parse_deny "$DENY_FILE" 1
[ "$DRY" = 1 ] || orphans_clean       # eklenti dışından kaldırılmış elle banların artıkları
[ "$DRY" = 1 ] || proto_fix           # eski kısmi ban / istisnalara eksik UDP 443 (HTTP/3)
[ "$DRY" = 1 ] || { svc_enforce 0; asn_enforce; cloud_enforce 0; }   # izinli servisler, sağlayıcı banı, bulut listeleri: istenen durum CSF'te mi
[ "$DRY" = 1 ] || daily_tasks         # günde bir: servis izin listeleri, CSF'in ASN verisi
[ "$DRY" = 1 ] || { svc_health; cloud_health; }   # indirilemeyen izinli servis / bulut listesi: bildirim

# ── /24 grouping (permanent): auto-ban + drop singles ───────────────────────
added24=0; added24_body=""
for prefix in $(printf '%s\n' "${!count24[@]}" | sort -V); do
    n="${count24[$prefix]}"
    [ "$n" -ge "$THRESHOLD_24" ] || continue
    ip2int "$prefix.0"; lo=$REPLY
    perm_covers "$lo" $((lo + 255)) && continue
    # servisi zaten kapalı tekiller (o katman konmadan önceki saldırılar) eşiğe sayılmaz
    open_count SINGLE_NOTE ${ips24[$prefix]}
    if [ "$REPLY" -lt "$THRESHOLD_24" ]; then logr "$(m "$M_C24_CLOSED" "$prefix" "$n" "$REPLY")"; continue; fi
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

# ── /16: şüpheli ağ uyarısı geçici banlar okunduktan sonra, kalıcı ve geçici tekiller birlikte (aşağıda) ─
warn16=0
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
        open_count TNOTE ${temp_ips24[$prefix]}
        if [ "$REPLY" -lt "$THRESHOLD_TEMP_24" ]; then logr "$(m "$M_C24_CLOSED" "$prefix" "$n" "$REPLY")"; continue; fi
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

# ── /16: şüpheli ağ, kalıcı ve geçici tekiller birlikte; yalnız uyarı, günde bir kez ──────────────
# Aynı ağdan gelen saldırı, LFD'nin onu hangi listeye koyduğuna bakılmadan görülsün: bir IP bir kez sayılır
# (iki listede birden varsa kalıcı sayılır). Bu turda banlanan bloklar (kalıcı ya da geçici) sayılmaz.
declare -A count16 seen_subnets ips16 perm16 tmp16 seen16
for ip in "${!SINGLE_NOTE[@]}" "${temp_alive[@]}"; do
    [ -n "${seen16[$ip]}" ] && continue; seen16[$ip]=1
    prefix24="${ip%.*}"; prefix16="${prefix24%.*}"
    [ "${count24[$prefix24]:-0}" -ge "$THRESHOLD_24" ] && continue
    [ "${temp_count24[$prefix24]:-0}" -ge "$THRESHOLD_TEMP_24" ] && continue
    count16[$prefix16]=$((${count16[$prefix16]:-0} + 1)); seen_subnets[$prefix16]+=" $prefix24"; ips16[$prefix16]+=" $ip"
    if [ -n "${SINGLE_NOTE[$ip]+x}" ]; then perm16[$prefix16]=$((${perm16[$prefix16]:-0} + 1)); else tmp16[$prefix16]=$((${tmp16[$prefix16]:-0} + 1)); fi
done
warn16=0; warn_body=""; temp_warn16=0
asn_banned
for prefix in $(printf '%s\n' "${!count16[@]}" | sort -V); do
    subnet_count=$(echo "${seen_subnets[$prefix]}" | tr ' ' '\n' | sort -u | grep -c '\.')
    if [ "${count16[$prefix]}" -ge "$THRESHOLD_16" ] && [ "$subnet_count" -ge 2 ]; then
        ip2int "$prefix.0.0"; lo=$REPLY
        if perm_covers "$lo" $((lo + 65535)); then logr "$(m "$M_TSKIP16" "$prefix")"; continue; fi
        if ign_until "$prefix.0.0/16"; then logr "$(m "$M_IGN16" "$prefix" "$IGN_UNTIL")"; continue; fi
        if cover_any; then
            pcl=""; for ip in ${ips16[$prefix]}; do pcl+="$ip|${SINGLE_NOTE[$ip]:-${TNOTE[$ip]}}|"$'\n'; done
            prov_cover <<< "$pcl" && { logr "$(m "$M_PROV16" "$prefix" "$PC_ASN")"; continue; }
        fi
        np="${perm16[$prefix]:-0}"; nt="${tmp16[$prefix]:-0}"
        # ağa eklentinin kısmi banı konmuşsa ondan önceki tekiller o kararla ele alınmıştır: yalnız sonrakiler sayılır
        pe=0; pnote=""; pl=$(grep -F "|s=$prefix.0.0/16 # csf_autogroup:" "$DENY_FILE" | head -n 1)
        [ -n "$pl" ] && [[ "$pl" =~ $RE_DATE ]] && pe=$(LC_ALL=C date -d "${BASH_REMATCH[1]}" +%s 2>/dev/null || echo 0)
        if [ "${pe:-0}" -gt 0 ]; then
            ips_after "$pe" ${ips16[$prefix]}
            ips16[$prefix]="$REPLY"; count16[$prefix]=0; np=0; nt=0
            for ip in $REPLY; do
                count16[$prefix]=$((count16[$prefix] + 1))
                if [ -n "${SINGLE_NOTE[$ip]+x}" ]; then np=$((np + 1)); else nt=$((nt + 1)); fi
            done
            subnet_count=$(for ip in $REPLY; do echo "${ip%.*}"; done | sort -u | grep -c '\.')
            if [ "${count16[$prefix]}" -lt "$THRESHOLD_16" ] || [ "$subnet_count" -lt 2 ]; then
                logr "$(m "$M_PSKIP16" "$prefix" "${count16[$prefix]}")"; continue
            fi
            [[ "$pl" =~ $RE_SV ]] && psv="${BASH_REMATCH[1]}" || psv=""
            pnote="$(m "$M_PART_AFTER" "$(date -d "@$pe" '+%d.%m %H:%M')")$NL"
            pin=""; pout=""
            for x in ${IPA_CLS//,/ }; do
                [[ "$x" =~ ^[a-z]+$ ]] || continue
                case "$x" in other|repeat|scan) ;; *) if [[ ",$psv," == *",$x,"* ]]; then pin+="${pin:+, }$x"; else pout+="${pout:+, }$x"; fi ;; esac
            done
            [ -n "$pin" ] && pnote+="$(m "$M_PART_LEAK" "$pin" "$prefix.0.0/16")$NL"
            [ -n "$pout" ] && pnote+="$(m "$M_PART_MORE" "$pout")$NL"
        fi
        # aynı ağ için son uyarıdan bu yana yeni IP gelmediyse tekrar bildirilmez (Kontrol edilecekler'de zaten duruyor)
        lw=$(grep -F "\"type\":\"warn16\",\"cidr\":\"$prefix.0.0/16\"" "$EVENTS_FILE" 2>/dev/null | tail -n 1)
        # kısmi banlı ağda yalnız bandan sonrakilerle atılmış uyarıyla karşılaştırılır (öncekiler başka listeydi)
        [ "${pe:-0}" -gt 0 ] && [[ "$lw" != *"\"after\":$pe"* ]] && lw=""
        if [ -n "$lw" ]; then
            lips=" $(grep -oE '"ip":"[0-9.]+"' <<< "$lw" | cut -d'"' -f4 | tr '\n' ' ')"
            lcnt=$(grep -oE '"ip":"' <<< "$lw" | grep -c .); ltot=$(grep -oE '"total":[0-9]+' <<< "$lw" | head -n 1 | cut -d: -f2)
            ln16=$(grep -oE '"n":[0-9]+' <<< "$lw" | head -n 1 | cut -d: -f2)
            fresh=0
            for ip in ${ips16[$prefix]}; do [[ "$lips" == *" $ip "* ]] || { fresh=1; break; }; done
            [ "$fresh" = 1 ] && [ "$lcnt" -gt 0 ] && [ "${ltot:-0}" -gt "$lcnt" ] && [ "${count16[$prefix]}" -le "${ln16:-0}" ] && fresh=0   # liste kısaltılmışsa sayıya bak
            [ "$fresh" = 0 ] && { logr "$(m "$M_SAME16" "$prefix")"; continue; }
        fi
        # günde en çok bir uyarı; ama kısmi banlı ağda bugünkü uyarı bandan ÖNCE atıldıysa sayılmaz: bandan sonraki
        # yeni saldırılar (ör. açık kalan servislere) ertesi güne kalmadan bildirilir
        if grep -qF "WARN16_${prefix} $TODAY" "$SAYAC_FILE"; then
            lt=0; [[ "$lw" =~ ^\{\"t\":([0-9]+) ]] && lt="${BASH_REMATCH[1]}"
            if [ "${pe:-0}" -eq 0 ] || [ "$lt" -ge "$(date -d 'today 00:00' +%s)" ]; then logr "$(m "$M_SKIP16" "$prefix")"; continue; fi
        fi
        log "$(m "$M_WARN16" "$prefix" "${count16[$prefix]}" "$np" "$nt" "$subnet_count")"
        warn_body+="$(m "$M_WARN16_B" "$prefix" "${count16[$prefix]}" "$np" "$nt" "$subnet_count")$NL"
        WL_HIT=""; wl_overlap "$lo" $((lo + 65535)) && warn_body+="$(m "$M_WL_NOTE" "$WL_HIT")$NL"
        part_note "$lo" $((lo + 65535)) && warn_body+="$(m "$M_PART_NOTE" "${REPLY%%|*}" "${REPLY#*|}")$NL"
        warn_body+="$pnote"
        ip_lines "${ips16[$prefix]}" mix 1; warn_body+="$REPLY"
        warn16=$((warn16 + 1)); cnt_add "WARN16_${prefix} $TODAY"
        jstr "$WL_HIT"
        ev warn16 "$prefix.0.0/16" "n=${count16[$prefix]}" "perm=$np" "temp=$nt" "subnets=$subnet_count" "wl=$REPLY" "total=$IPS_TOTAL" "ips=$IPS_J" \
           $([ "${pe:-0}" -gt 0 ] && echo "after=$pe")
    fi
done
if [ "$warn16" -gt 0 ]; then
    mail_add "$(m "$M_MAIL16_SUBJ" "$warn16")" "$(printf '%b' "$(m "$M_MAIL16_BODY")")$NL$NL$warn_body"
fi
logr "$(m "$M_16_DONE" "$warn16")"

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
        mail_add "$h_subj" "$h_body" bad; cnt_add "HEALTH $TODAY"
    fi
fi

h_all=""; for hm in "${h_msgs[@]}"; do h_all+="${h_all:+, }$hm"; done
ic_track IC_FIREWALL Firewall "$([ ${#h_msgs[@]} -gt 0 ] && echo 1 || echo 0)" "$(m "$M_IC_FW" "$h_all")" "$M_H_BODY $h_all" "$M_IC_FW_OK"

# ── Bu turun bildirimleri: tek mail ─────────────────────────────────────────
mail_flush
slack_on && [ "$IC_RUN" = 1 ] && slack_queue_flush

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
