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
#   csf.rignore) — it is reported by email instead.
#   Alert emails show who owns each block (ASN / org / country) and each IP's
#   hostname + ban reason (DNS: PTR + Team Cymru; set LOOKUP=0 to disable).
#   Emails when the deny list reaches 80% of its limit.
#
# Config : optional config.env in the same dir (see config.env.example).
# Cron   : e.g.  */10 * * * * /path/csf_autogroup.sh >/dev/null 2>&1
#
# ⚠️  This script MODIFIES your firewall (auto-bans /24 subnets). Whitelist your
#     own IPs in csf.allow, start with high thresholds, and watch the log.
# ============================================================================
set -o pipefail

VERSION="1.1.0"   # sürüm — başlangıç log satırında görünür

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
SAYAC_FILE="${SAYAC_FILE:-/var/lib/csf_autogroup/counter}"
LOCK_FILE="${LOCK_FILE:-${SAYAC_FILE}.lock}"
THRESHOLD_24="${THRESHOLD_24:-3}"
THRESHOLD_24_PERMANENT="${THRESHOLD_24_PERMANENT:-5}"
THRESHOLD_16="${THRESHOLD_16:-5}"
THRESHOLD_TEMP_24="${THRESHOLD_TEMP_24:-3}"
THRESHOLD_TEMP_16="${THRESHOLD_TEMP_16:-5}"
LOOKUP="${LOOKUP:-1}"                            # 1 = hostname/owner lookups in emails
LOOKUP_TIMEOUT="${LOOKUP_TIMEOUT:-2}"            # seconds per DNS query
LOG_MAX_LINES="${LOG_MAX_LINES:-5000}"
SAYAC_RETENTION_DAYS="${SAYAC_RETENTION_DAYS:-180}"
TODAY=$(date '+%Y-%m-%d')
NL=$'\n'

# ── Messages (printf templates; %s placeholders) ────────────────────────────
if [ "$MSG_LANG" = "tr" ]; then
  export LANG=tr_TR.UTF-8 LC_ALL=tr_TR.UTF-8
  M_START="--- Başladı ---";                                       M_END="--- Bitti ---"
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
  M_OK24_DND="OK /24 eklendi: %s.0/24 (%s kalıcı tekil) [do not delete]"
  M_OK24="OK /24 eklendi: %s.0/24 (%s kalıcı tekil)"
  M_B24_DND="%s.0/24 -> %s kalıcı tekil nedeniyle kalıcı ban + do not delete"
  M_B24="%s.0/24 -> %s kalıcı tekil nedeniyle kalıcı banlandı"
  M_DELSINGLE="Silindi tekil: %s"
  M_DELSINGLE_FAIL="UYARI tekil silinemedi: %s"
  M_KEPT_DND="Tekil tutuldu (do not delete): %s"
  M_TAG_FAIL="silinemedi";                                         M_TAG_KEPT="do not delete, tutuldu"
  M_ADD24_FAIL="HATA /24 eklenemedi: %s.0/24"
  M_24_DONE="/24 turu bitti. %s yeni blok eklendi."
  M_MAIL24_BODY="Aşağıdaki /24 blokları otomatik eklendi ve tekil IPler silindi:"
  M_MAIL24_SUBJ="CSF /24 Gruplama: %s blok eklendi"
  M_OWNER="   Sahibi: %s"
  M_WARN16="UYARI /16: %s.0.0/16 - %s IP, %s farklı /24 - MANUEL KONTROL ET"
  M_WARN16_B="%s.0.0/16 -> %s IP, %s farklı /24 bloğundan"
  M_SKIP16="ATLANDI /16: %s.0.0/16 bugün zaten uyarıldı"
  M_16_DONE="/16 turu bitti. %s uyarı gönderildi."
  M_MAIL16_BODY="Aşağıdaki /16 bloklarından yüksek sayıda IP engellendi.\nManuel inceleme yapmanız önerilir:"
  M_MAIL16_SUBJ="CSF /16 Uyarısı: %s blok"
  M_TCLEAN="Temizlendi: %s (kalıcı ban kapsamında)"
  M_TSKIP24="ATLANDI temp /24: %s.0/24 zaten kalıcı banlı"
  M_TC24_PERM="Auto-grouped from temp /24: %s geçici tekil, 2. kez grup saldırısı nedeniyle kalıcı banlandı - do not delete"
  M_TOK24_PERM="OK Temp→Kalıcı /24 eklendi: %s.0/24 (%s geçici tekil) [2. kez grup saldırısı - do not delete]"
  M_TB24_PERM="%s.0/24 -> %s geçici tekil, 2. kez grup saldırısı nedeniyle kalıcı banlandı [do not delete]"
  M_TADD24_FAIL="HATA Temp→Kalıcı /24 eklenemedi: %s.0/24"
  M_TOK24="OK Temp /24 eklendi: %s.0/24 (%s geçici tekil) [ilk kez geçici banlandı]"
  M_TB24="%s.0/24 -> %s geçici tekil nedeniyle ilk kez geçici banlandı"
  M_TADD24T_FAIL="HATA Temp /24 eklenemedi: %s.0/24"
  M_T24_DONE="Temp /24 turu bitti. %s yeni temp blok, %s kalıcıya alındı."
  M_MAILT24_BODY="Aşağıdaki /24 blokları geçici olarak eklendi:"
  M_MAILT24_SUBJ="CSF /24 Temp Gruplama: %s blok eklendi"
  M_MAILT24P_BODY="Aşağıdaki /24 blokları 2. kez grup saldırısı nedeniyle kalıcı bana alındı:"
  M_MAILT24P_SUBJ="CSF /24 Gruplama: %s blok eklendi"
  M_TWARN16="UYARI Temp /16: %s.0.0/16 - %s IP, %s farklı /24 - MANUEL KONTROL ET"
  M_TSKIP16="ATLANDI temp /16: %s.0.0/16 zaten kalıcı banlı"
  M_TSKIP16D="ATLANDI temp /16: %s.0.0/16 bugün zaten uyarıldı"
  M_T16_DONE="Temp /16 turu bitti. %s uyarı gönderildi."
  M_MAILT16_BODY="Aşağıdaki /16 bloklarından yüksek sayıda geçici ban var.\nManuel inceleme yapmanız önerilir:"
  M_MAILT16_SUBJ="CSF /16 Temp Uyarısı: %s blok"
  M_WL_LOADED="Beyaz liste yüklendi: %s aralık, %s rignore alan adı"
  M_WL_SELF="sunucu IP'si"
  M_WL_SKIP="ATLANDI %s: beyaz listeyle çakışıyor (%s)"
  M_WL_SKIPD="ATLANDI %s: beyaz listede (%s), bugün zaten bildirildi"
  M_WL_RETRY="ATLANDI %s: beyaz liste (%s) DNS hatası nedeniyle doğrulanamadı, sonraki turda tekrar denenecek"
  M_WL_B="%s -> %s tekil, BANLANMADI. Beyaz liste: %s"
  M_WL_NOTE="   Not: içinde beyaz listede kayıt var (%s)"
  M_MAILWL_BODY="Aşağıdaki bloklar gruplama eşiğine ulaştı ama CSF beyaz listeleriyle çakıştığı için banlanmadı.\nTekil banlar yerinde duruyor:"
  M_MAILWL_SUBJ="CSF Gruplama: %s blok beyaz liste nedeniyle atlandı"
  M_CC_NOLOOKUP="UYARI: CC_IGNORE/CC_ALLOW veya csf.rignore tanımlı ama DNS sorgusu yapılamıyor (LOOKUP=0 ya da dig/host yok); bu kontroller atlandı"
  M_LOOKUP_OFF="UYARI: DNS sorguları art arda zaman aşımına uğradı, bu turda kapatıldı"
  M_CLEANCNT="Sayaç temizliği yapıldı (%s günden eski kayıtlar silindi)"
  M_LOGTRIM="Log %s satırda tutuldu (önceki: %s satır)"
  M_MAIL_PERMFULL_SUBJ="!!! CSF Limit Uyarısı: %%%s doluluk !!!"
  M_MAIL_PERMFULL_BODY="CSF deny listesi limite yaklaşıyor!"
  M_MAIL_TEMPFULL_SUBJ="!!! CSF Temp Limit Uyarısı: %%%s doluluk !!!"
  M_MAIL_TEMPFULL_BODY="CSF geçici ban listesi limite yaklaşıyor!"
  M_MAIL_DETAIL="Detay için: tail -100 %s"
else
  M_START="--- Started ---";                                       M_END="--- Done ---"
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
  M_OK24_DND="OK /24 added: %s.0/24 (%s permanent singles) [do not delete]"
  M_OK24="OK /24 added: %s.0/24 (%s permanent singles)"
  M_B24_DND="%s.0/24 -> %s permanent singles, permanent ban + do not delete"
  M_B24="%s.0/24 -> %s permanent singles, permanent ban"
  M_DELSINGLE="Removed single: %s"
  M_DELSINGLE_FAIL="WARNING could not remove single: %s"
  M_KEPT_DND="Single kept (do not delete): %s"
  M_TAG_FAIL="not removed";                                        M_TAG_KEPT="do not delete, kept"
  M_ADD24_FAIL="ERROR could not add /24: %s.0/24"
  M_24_DONE="/24 pass done. %s new block(s) added."
  M_MAIL24_BODY="The following /24 blocks were auto-added and their single IPs removed:"
  M_MAIL24_SUBJ="CSF /24 grouping: %s block(s) added"
  M_OWNER="   Owner: %s"
  M_WARN16="WARNING /16: %s.0.0/16 - %s IPs, %s distinct /24s - REVIEW MANUALLY"
  M_WARN16_B="%s.0.0/16 -> %s IPs across %s distinct /24 blocks"
  M_SKIP16="SKIPPED /16: %s.0.0/16 already warned today"
  M_16_DONE="/16 pass done. %s warning(s) sent."
  M_MAIL16_BODY="A high number of IPs were blocked from the following /16 ranges.\nManual review recommended:"
  M_MAIL16_SUBJ="CSF /16 warning: %s block(s)"
  M_TCLEAN="Cleaned: %s (covered by a permanent ban)"
  M_TSKIP24="SKIPPED temp /24: %s.0/24 already permanently banned"
  M_TC24_PERM="Auto-grouped from temp /24: %s temp singles, 2nd group attack -> permanent ban - do not delete"
  M_TOK24_PERM="OK temp->permanent /24 added: %s.0/24 (%s temp singles) [2nd group attack - do not delete]"
  M_TB24_PERM="%s.0/24 -> %s temp singles, 2nd group attack -> permanent ban [do not delete]"
  M_TADD24_FAIL="ERROR could not add temp->permanent /24: %s.0/24"
  M_TOK24="OK temp /24 added: %s.0/24 (%s temp singles) [first temp ban]"
  M_TB24="%s.0/24 -> %s temp singles, first temp ban"
  M_TADD24T_FAIL="ERROR could not add temp /24: %s.0/24"
  M_T24_DONE="Temp /24 pass done. %s new temp block(s), %s promoted to permanent."
  M_MAILT24_BODY="The following /24 blocks were temporarily added:"
  M_MAILT24_SUBJ="CSF /24 temp grouping: %s block(s) added"
  M_MAILT24P_BODY="The following /24 blocks were permanently banned after a 2nd group attack:"
  M_MAILT24P_SUBJ="CSF /24 grouping: %s block(s) added"
  M_TWARN16="WARNING temp /16: %s.0.0/16 - %s IPs, %s distinct /24s - REVIEW MANUALLY"
  M_TSKIP16="SKIPPED temp /16: %s.0.0/16 already permanently banned"
  M_TSKIP16D="SKIPPED temp /16: %s.0.0/16 already warned today"
  M_T16_DONE="Temp /16 pass done. %s warning(s) sent."
  M_MAILT16_BODY="A high number of temp bans exist from the following /16 ranges.\nManual review recommended:"
  M_MAILT16_SUBJ="CSF /16 temp warning: %s block(s)"
  M_WL_LOADED="Whitelist loaded: %s ranges, %s rignore domains"
  M_WL_SELF="server IP"
  M_WL_SKIP="SKIPPED %s: overlaps a whitelist entry (%s)"
  M_WL_SKIPD="SKIPPED %s: whitelisted (%s), already reported today"
  M_WL_RETRY="SKIPPED %s: whitelist (%s) could not be verified (DNS failure), will retry next run"
  M_WL_B="%s -> %s singles, NOT banned. Whitelist: %s"
  M_WL_NOTE="   Note: contains a whitelist entry (%s)"
  M_MAILWL_BODY="The following blocks reached the grouping threshold but were NOT banned because they overlap a CSF whitelist.\nThe single bans stay in place:"
  M_MAILWL_SUBJ="CSF grouping: %s block(s) skipped (whitelist)"
  M_CC_NOLOOKUP="WARNING: CC_IGNORE/CC_ALLOW or csf.rignore is set but DNS lookups are unavailable (LOOKUP=0 or no dig/host); those checks were skipped"
  M_LOOKUP_OFF="WARNING: DNS lookups timed out repeatedly, disabled for this run"
  M_CLEANCNT="Counter cleaned (records older than %s days removed)"
  M_LOGTRIM="Log trimmed to %s lines (was: %s lines)"
  M_MAIL_PERMFULL_SUBJ="!!! CSF limit warning: %s%% full !!!"
  M_MAIL_PERMFULL_BODY="CSF deny list is approaching its limit!"
  M_MAIL_TEMPFULL_SUBJ="!!! CSF temp limit warning: %s%% full !!!"
  M_MAIL_TEMPFULL_BODY="CSF temp ban list is approaching its limit!"
  M_MAIL_DETAIL="Details: tail -100 %s"
fi
m() { local f="$1"; shift; printf "$f" "$@"; }   # format a message template

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"; }
# Kilit (fd 9) alt süreçlere geçmesin: arka planda teslimat yapan bir MTA kilidi tutup sonraki turları engellemesin.
mail() { command mail "$@" 9>&-; }

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
temp_added() {   # CIDR → csf -td gerçekten tuttu mu? Sayaç kaydı buna bağlı, kaybolmasın diye iki yoldan bakılır.
    [[ "$CSF_OUT" =~ (not\ a\ valid|failed|servers\ addresses) ]] && return 1
    [ -r "$CSF_VAR/csf.tempban" ] && grep -qF "|$1|" "$CSF_VAR/csf.tempban" && return 0
    [[ "$CSF_OUT" == *blocked* ]] && return 0      # "... blocked on port" / "already temporarily blocked"
    [ ! -r "$CSF_VAR/csf.tempban" ]
}
csf_run() {      # csf'i çalıştır, çıktıyı log'a yaz, CSF_OUT'ta sakla (csf hata durumunda da 0 döner)
    CSF_OUT=$("$CSF_BIN" "$@" 2>&1 9>&-)
    [ -n "$CSF_OUT" ] && printf '%s\n' "$CSF_OUT" >> "$LOG_FILE"
}

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
            OWN_S[$p]="AS$asn${cc:+ $cc}"
        fi
    fi
    OWN_LONG="${OWN_L[$p]}"; OWN_SHORT="${OWN_S[$p]}"; OWN_ASN="${OWN_A[$p]}"; OWN_CC="${OWN_C[$p]}"
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
    # owner_lookup DNS sorgusu yapar ve REPLY'yi ezer → satır "out" içinde toplanır
    if [ "$3" = 1 ]; then owner_lookup "$1"; [ -n "$OWN_SHORT" ] && out+="  [$OWN_SHORT]"; fi
    [ -n "$why" ] && out+="  $why"
    REPLY="$out"
}
ip_lines() {     # "IP IP ..." KIND(perm|temp) WITH_OWNER → REPLY; tekrarsız, sıralı, ilk 40, fazlası "(+N)"
    local all ip n=0 total out="" note
    all=$(printf '%s\n' $1 | grep -E "$IPV4_RE" | sort -Vu)
    total=$(printf '%s\n' "$all" | grep -c .)
    for ip in $all; do
        [ "$n" -ge 40 ] && break; n=$((n + 1))
        if [ "$2" = temp ]; then note="${TNOTE[$ip]}"; else note="${SINGLE_NOTE[$ip]}"; fi
        ip_line "$ip" "$note" "$3"; out+="$REPLY$NL"
    done
    [ "$total" -gt 40 ] && out+="   (+$((total - 40)))$NL"
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
    # Sunucunun kendi IP'leri: CSF yalnızca IP'nin kendisini korur, içinde bulunduğu /24'ü değil.
    for ip in $( { ip -4 -o addr show 2>/dev/null | awk '{print $4}'; hostname -I 2>/dev/null | tr ' ' '\n'; } | sed 's#/.*##' | grep -E "$IPV4_RE" | sort -u); do
        case "$ip" in 127.*) continue;; esac
        wl_add "$ip" "$M_WL_SELF: $ip"
    done
    rignore_load "$CSF_DIR/csf.rignore"
    CC_LIST=$( { conf_val CC_IGNORE | sed 's/^/CC_IGNORE=/'; conf_val CC_ALLOW | sed 's/^/CC_ALLOW=/'; } | grep -v '=$' | LC_ALL=C tr '[:lower:]' '[:upper:]')
    log "$(m "$M_WL_LOADED" "${#WL_LO[@]}" "${#RIGNORE[@]}")"
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
    if grep -qF "WLSKIP_$3 $TODAY" "$SAYAC_FILE"; then log "$(m "$M_WL_SKIPD" "$1" "$WL_HIT")"; return; fi
    log "$(m "$M_WL_SKIP" "$1" "$WL_HIT")"
    echo "WLSKIP_$3 $TODAY" >> "$SAYAC_FILE"
    wl_skip_body+="$(m "$M_WL_B" "$1" "$2" "$WL_HIT")$NL"
    owner_line "$4"; wl_skip_body+="$REPLY"
    ip_lines "$4" "$5" 0; wl_skip_body+="$REPLY"
    wl_skipped=$((wl_skipped + 1))
}

[ -f "$DENY_FILE" ] || { log "$(m "$M_ERR_NOFILE" "$DENY_FILE")"; exit 1; }
[ -f "$CSF_CONF" ]  || { log "$(m "$M_ERR_NOFILE" "$CSF_CONF")"; exit 1; }

mkdir -p "$(dirname "$SAYAC_FILE")"; touch "$SAYAC_FILE"
# Tek seferde tek çalışma: cron turu uzarsa ikinci kopya aynı bloğu tekrar eklemesin.
if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    flock -n 9 || { log "$M_LOCKED"; exit 0; }
fi
log "$M_START (v$VERSION)"

# ── Permanent deny limit ────────────────────────────────────────────────────
limit=$(grep "^DENY_IP_LIMIT" "$CSF_CONF" | cut -d'=' -f2 | tr -d ' "')
current_count=$(grep -cP '^\d+\.\d+\.\d+\.\d+|^\d+\.\d+\.\d+\.\d+\/\d+' "$DENY_FILE" || true)
if [ -n "$limit" ] && [ "$limit" -gt 0 ] 2>/dev/null; then
    percent=$((current_count * 100 / limit))
    log "$(m "$M_PERM_USAGE" "$current_count" "$limit" "$percent")"
    if [ "$percent" -ge 80 ]; then
        log "$(m "$M_PERM_WARN")"
        doluluk_satiri=$(m "$M_PERM_FULL" "$current_count" "$limit" "$percent")
        printf '%s\n\n%s\n\n%s\n' "$(m "$M_MAIL_PERMFULL_BODY")" "$doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
            mail -s "$(m "$M_MAIL_PERMFULL_SUBJ" "$percent")" "$ALERT_MAIL"
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
    log "$(m "$M_TEMP_USAGE" "$temp_current" "$temp_limit" "$temp_percent")"
    if [ "$temp_percent" -ge 80 ]; then
        log "$(m "$M_TEMP_WARN")"
        temp_doluluk_satiri=$(m "$M_TEMP_FULL" "$temp_current" "$temp_limit" "$temp_percent")
        printf '%s\n\n%s\n\n%s\n' "$(m "$M_MAIL_TEMPFULL_BODY")" "$temp_doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
            mail -s "$(m "$M_MAIL_TEMPFULL_SUBJ" "$temp_percent")" "$ALERT_MAIL"
    else
        temp_doluluk_satiri=$(m "$M_TEMP_USAGE" "$temp_current" "$temp_limit" "$temp_percent")
    fi
else
    log "$(m "$M_NOLIMIT" "DENY_TEMP_IP_LIMIT")"; temp_doluluk_satiri=""
fi

# ── Read csf.deny: singles (grouping) + CIDRs (coverage) ────────────────────
# Tekiller yalnızca ana dosyadan gruplanır (csf -dr Include dosyalarına dokunmaz);
# kapsama kontrolü Include dosyalarındaki CIDR'leri de görür. Aynı IP'nin tekrar
# eden satırları (LF_REPEATBLOCK) tek IP sayılır.
declare -A DENY_IP SINGLE_NOTE count24 ips24
DC_LO=(); DC_HI=()
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
            cidr_range "$tok" && { DC_LO+=("$R_LO"); DC_HI+=("$R_HI"); }
        else
            DENY_IP[$tok]=1
            if [ "$2" = 1 ] && [ -z "${SINGLE_NOTE[$tok]+x}" ]; then
                SINGLE_NOTE[$tok]="${line#"$tok"}"; p="${tok%.*}"
                count24[$p]=$((${count24[$p]:-0} + 1)); ips24[$p]+=" $tok"
            fi
        fi
    done < "$1"
}
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
    if ! deny_has "${prefix}.0/24"; then log "$(m "$M_ADD24_FAIL" "$prefix")"; continue; fi
    DC_LO+=("$lo"); DC_HI+=($((lo + 255)))
    if [ "$n" -ge "$THRESHOLD_24_PERMANENT" ]; then
        log "$(m "$M_OK24_DND" "$prefix" "$n")"
        added24_body+="$(m "$M_B24_DND" "$prefix" "$n")$NL"
    else
        log "$(m "$M_OK24" "$prefix" "$n")"
        added24_body+="$(m "$M_B24" "$prefix" "$n")$NL"
    fi
    added24=$((added24 + 1))
    owner_line "${ips24[$prefix]# }"; added24_body+="$REPLY"
    for ip in $(printf '%s\n' ${ips24[$prefix]} | sort -V); do
        tag=""
        if [[ "${SINGLE_NOTE[$ip]}" =~ [Dd][Oo][[:space:]]+[Nn][Oo][Tt][[:space:]]+[Dd][Ee][Ll][Ee][Tt][Ee] ]]; then
            # csf -dr "do not delete" satırlarını silmez; /24 zaten kapsıyor, olduğu gibi kalsın.
            log "$(m "$M_KEPT_DND" "$ip")"; tag="  [$M_TAG_KEPT]"
        else
            csf_run -dr "$ip"
            if deny_has "$ip"; then log "$(m "$M_DELSINGLE_FAIL" "$ip")"; tag="  [$M_TAG_FAIL]"
            else log "$(m "$M_DELSINGLE" "$ip")"; fi
        fi
        ip_line "$ip" "${SINGLE_NOTE[$ip]}" 0; added24_body+="$REPLY$tag$NL"
    done
done
if [ "$added24" -gt 0 ]; then
    printf '%s\n\n%s\n%s\n%s\n' "$(m "$M_MAIL24_BODY")" "$added24_body" "$doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAIL24_SUBJ" "$added24")" "$ALERT_MAIL"
fi
log "$(m "$M_24_DONE" "$added24")"

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
        if ! perm_covers "$lo" $((lo + 65535)); then
            if grep -qF "WARN16_${prefix} $TODAY" "$SAYAC_FILE"; then
                log "$(m "$M_SKIP16" "$prefix")"; continue
            fi
            log "$(m "$M_WARN16" "$prefix" "${count16[$prefix]}" "$subnet_count")"
            warn_body+="$(m "$M_WARN16_B" "$prefix" "${count16[$prefix]}" "$subnet_count")$NL"
            wl_overlap "$lo" $((lo + 65535)) && warn_body+="$(m "$M_WL_NOTE" "$WL_HIT")$NL"
            ip_lines "${ips16[$prefix]}" perm 1; warn_body+="$REPLY"
            warn16=$((warn16 + 1)); echo "WARN16_${prefix} $TODAY" >> "$SAYAC_FILE"
        fi
    fi
done
if [ "$warn16" -gt 0 ]; then
    printf '%b\n\n%s\n%s\n%s\n' "$(m "$M_MAIL16_BODY")" "$warn_body" "$doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAIL16_SUBJ" "$warn16")" "$ALERT_MAIL"
fi
log "$(m "$M_16_DONE" "$warn16")"

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
        "$CSF_BIN" -tr "$ip" >> "$LOG_FILE" 2>&1 9>&- && log "$(m "$M_TCLEAN" "$ip")"; continue
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
        if perm_covers "$lo" $((lo + 255)); then log "$(m "$M_TSKIP24" "$prefix")"; continue; fi
        if wl_check "$prefix" "${temp_ips24[$prefix]}"; then
            wl_skip "${prefix}.0/24" "$n" "$prefix" "${temp_ips24[$prefix]}" temp; continue
        fi
        if grep -qE "^${prefix//./\\.} " "$SAYAC_FILE"; then
            csf_run -d "${prefix}.0/24" "$(m "$M_TC24_PERM" "$n")"
            if deny_has "${prefix}.0/24"; then
                DC_LO+=("$lo"); DC_HI+=($((lo + 255)))
                log "$(m "$M_TOK24_PERM" "$prefix" "$n")"
                temp_perm_added24=$((temp_perm_added24 + 1))
                temp_perm_added24_body+="$(m "$M_TB24_PERM" "$prefix" "$n")$NL"
                owner_line "${temp_ips24[$prefix]# }"; temp_perm_added24_body+="$REPLY"
                ip_lines "${temp_ips24[$prefix]}" temp 0; temp_perm_added24_body+="$REPLY"
                sed -i "/^${prefix//./\\.} /d" "$SAYAC_FILE"
            else
                log "$(m "$M_TADD24_FAIL" "$prefix")"
            fi
        else
            csf_run -td "${prefix}.0/24" 43200
            if temp_added "${prefix}.0/24"; then
                TC_LO+=("$lo"); TC_HI+=($((lo + 255)))
                log "$(m "$M_TOK24" "$prefix" "$n")"
                temp_added24=$((temp_added24 + 1))
                temp_added24_body+="$(m "$M_TB24" "$prefix" "$n")$NL"
                owner_line "${temp_ips24[$prefix]# }"; temp_added24_body+="$REPLY"
                ip_lines "${temp_ips24[$prefix]}" temp 0; temp_added24_body+="$REPLY"
                echo "$prefix $(date '+%Y-%m-%d')" >> "$SAYAC_FILE"
            else
                log "$(m "$M_TADD24T_FAIL" "$prefix")"
            fi
        fi
    fi
done
if [ "$temp_added24" -gt 0 ]; then
    printf '%s\n\n%s\n%s\n%s\n' "$(m "$M_MAILT24_BODY")" "$temp_added24_body" "$temp_doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAILT24_SUBJ" "$temp_added24")" "$ALERT_MAIL"
fi
if [ "$temp_perm_added24" -gt 0 ]; then
    printf '%s\n\n%s\n%s\n%s\n' "$(m "$M_MAILT24P_BODY")" "$temp_perm_added24_body" "$doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAILT24P_SUBJ" "$temp_perm_added24")" "$ALERT_MAIL"
fi
log "$(m "$M_T24_DONE" "$temp_added24" "$temp_perm_added24")"

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
        if perm_covers "$lo" $((lo + 65535)); then log "$(m "$M_TSKIP16" "$prefix")"; continue; fi
        if grep -qF "WARN_TEMP16_${prefix} $TODAY" "$SAYAC_FILE"; then log "$(m "$M_TSKIP16D" "$prefix")"; continue; fi
        log "$(m "$M_TWARN16" "$prefix" "${temp_count16[$prefix]}" "$subnet_count")"
        temp_warn_body+="$(m "$M_WARN16_B" "$prefix" "${temp_count16[$prefix]}" "$subnet_count")$NL"
        wl_overlap "$lo" $((lo + 65535)) && temp_warn_body+="$(m "$M_WL_NOTE" "$WL_HIT")$NL"
        ip_lines "${temp_ips16[$prefix]}" temp 1; temp_warn_body+="$REPLY"
        temp_warn16=$((temp_warn16 + 1)); echo "WARN_TEMP16_${prefix} $TODAY" >> "$SAYAC_FILE"
    fi
done
if [ "$temp_warn16" -gt 0 ]; then
    printf '%b\n\n%s\n%s\n%s\n' "$(m "$M_MAILT16_BODY")" "$temp_warn_body" "$temp_doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAILT16_SUBJ" "$temp_warn16")" "$ALERT_MAIL"
fi
log "$(m "$M_T16_DONE" "$temp_warn16")"

# ── Whitelist skips: one email per run (each block once per day) ────────────
if [ "$wl_skipped" -gt 0 ]; then
    printf '%b\n\n%s\n%s\n' "$(m "$M_MAILWL_BODY")" "$wl_skip_body" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAILWL_SUBJ" "$wl_skipped")" "$ALERT_MAIL"
fi

# ── Counter retention + log rotation ────────────────────────────────────────
if [ -f "$SAYAC_FILE" ]; then
    cutoff=$(date -d "$SAYAC_RETENTION_DAYS days ago" '+%Y-%m-%d')
    awk -v d="$cutoff" '$2 >= d' "$SAYAC_FILE" > "${SAYAC_FILE}.tmp" && mv "${SAYAC_FILE}.tmp" "$SAYAC_FILE"
    log "$(m "$M_CLEANCNT" "$SAYAC_RETENTION_DAYS")"
fi
if [ -f "$LOG_FILE" ]; then
    line_count=$(wc -l < "$LOG_FILE")
    if [ "$line_count" -gt "$LOG_MAX_LINES" ]; then
        tail -"$LOG_MAX_LINES" "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
        log "$(m "$M_LOGTRIM" "$LOG_MAX_LINES" "$line_count")"
    fi
fi
log "$M_END"
