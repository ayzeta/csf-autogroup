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
#   Removes singles already covered by a permanent block.
#   Emails when the deny list reaches 80% of its limit.
#
# Config : optional config.env in the same dir (see config.env.example).
# Cron   : e.g.  */10 * * * * /path/csf_autogroup.sh >/dev/null 2>&1
#
# ⚠️  This script MODIFIES your firewall (auto-bans /24 subnets). Whitelist your
#     own IPs in csf.allow, start with high thresholds, and watch the log.
# ============================================================================
set -o pipefail

VERSION="1.0.0"   # sürüm — başlangıç log satırında görünür

SELF_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
[ -f "$SELF_DIR/config.env" ] && . "$SELF_DIR/config.env"

# ── Config (overridable via config.env) ─────────────────────────────────────
MSG_LANG="${MSG_LANG:-en}"                       # en | tr
ALERT_MAIL="${ALERT_MAIL:-root@localhost}"
DENY_FILE="${DENY_FILE:-/etc/csf/csf.deny}"
CSF_CONF="${CSF_CONF:-/etc/csf/csf.conf}"
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
SAYAC_FILE="${SAYAC_FILE:-/var/lib/csf_autogroup/counter}"
THRESHOLD_24="${THRESHOLD_24:-3}"
THRESHOLD_24_PERMANENT="${THRESHOLD_24_PERMANENT:-5}"
THRESHOLD_16="${THRESHOLD_16:-5}"
THRESHOLD_TEMP_24="${THRESHOLD_TEMP_24:-3}"
THRESHOLD_TEMP_16="${THRESHOLD_TEMP_16:-5}"
LOG_MAX_LINES="${LOG_MAX_LINES:-5000}"
SAYAC_RETENTION_DAYS="${SAYAC_RETENTION_DAYS:-180}"
TODAY=$(date '+%Y-%m-%d')

# ── Messages (printf templates; %s placeholders) ────────────────────────────
if [ "$MSG_LANG" = "tr" ]; then
  export LANG=tr_TR.UTF-8 LC_ALL=tr_TR.UTF-8
  M_START="--- Başladı ---";                                       M_END="--- Bitti ---"
  M_ERR_NOFILE="HATA: %s bulunamadı, çıkılıyor."
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
  M_DELSINGLE="Silindi tekil: %s";                                 M_DELSINGLE_B="  - %s silindi"
  M_DELSINGLE_FAIL="UYARI tekil silinemedi: %s"
  M_ADD24_FAIL="HATA /24 eklenemedi: %s.0/24"
  M_24_DONE="/24 turu bitti. %s yeni blok eklendi."
  M_MAIL24_BODY="Aşağıdaki /24 blokları otomatik eklendi ve tekil IPler silindi:"
  M_MAIL24_SUBJ="CSF /24 Gruplama: %s blok eklendi"
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
  M_DELSINGLE="Removed single: %s";                                M_DELSINGLE_B="  - %s removed"
  M_DELSINGLE_FAIL="WARNING could not remove single: %s"
  M_ADD24_FAIL="ERROR could not add /24: %s.0/24"
  M_24_DONE="/24 pass done. %s new block(s) added."
  M_MAIL24_BODY="The following /24 blocks were auto-added and their single IPs removed:"
  M_MAIL24_SUBJ="CSF /24 grouping: %s block(s) added"
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

# /16 uyarı mailinde tekil IP'leri listele: boşlukla ayrılmış IP'ler → dedupe +
# sıralı + virgülle birleştir, ilk 40; fazlası "(+N)" olarak kısaltılır.
list_ips() {
  local all n shown
  all=$(printf '%s\n' $1 | grep -P '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | sort -Vu)
  n=$(printf '%s\n' "$all" | grep -c .)
  shown=$(printf '%s\n' "$all" | head -40 | awk 'NR>1{printf ", "}{printf "%s",$0}')
  [ "$n" -gt 40 ] && shown="$shown  (+$((n-40)))"
  printf '   %s' "$shown"
}

[ -f "$DENY_FILE" ] || { log "$(m "$M_ERR_NOFILE" "$DENY_FILE")"; exit 1; }
[ -f "$CSF_CONF" ]  || { log "$(m "$M_ERR_NOFILE" "$CSF_CONF")"; exit 1; }

mkdir -p "$(dirname "$SAYAC_FILE")"; touch "$SAYAC_FILE"
log "$M_START (v$VERSION)"

# ── Permanent deny limit ────────────────────────────────────────────────────
limit=$(grep "^DENY_IP_LIMIT" "$CSF_CONF" | cut -d'=' -f2 | tr -d ' "')
current_count=$(grep -cP '^\d+\.\d+\.\d+\.\d+|^\d+\.\d+\.\d+\.\d+\/\d+' "$DENY_FILE" || true)
if [ -n "$limit" ] && [ "$limit" -gt 0 ] 2>/dev/null; then
    percent=$((current_count * 100 / limit))
    log "$(m "$M_PERM_USAGE" "$current_count" "$limit" "$percent")"
    if [ "$percent" -ge 80 ]; then
        log "$M_PERM_WARN"
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
temp_current=$(/sbin/csf -t 2>/dev/null | grep -c "^DENY" || true)
if [ -n "$temp_limit" ] && [ "$temp_limit" -gt 0 ] 2>/dev/null; then
    temp_percent=$((temp_current * 100 / temp_limit))
    log "$(m "$M_TEMP_USAGE" "$temp_current" "$temp_limit" "$temp_percent")"
    if [ "$temp_percent" -ge 80 ]; then
        log "$M_TEMP_WARN"
        temp_doluluk_satiri=$(m "$M_TEMP_FULL" "$temp_current" "$temp_limit" "$temp_percent")
        printf '%s\n\n%s\n\n%s\n' "$(m "$M_MAIL_TEMPFULL_BODY")" "$temp_doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
            mail -s "$(m "$M_MAIL_TEMPFULL_SUBJ" "$temp_percent")" "$ALERT_MAIL"
    else
        temp_doluluk_satiri=$(m "$M_TEMP_USAGE" "$temp_current" "$temp_limit" "$temp_percent")
    fi
else
    log "$(m "$M_NOLIMIT" "DENY_TEMP_IP_LIMIT")"; temp_doluluk_satiri=""
fi

# ── /24 grouping (permanent): auto-ban + drop singles ───────────────────────
declare -A count24 ips24
while IFS= read -r line; do
    ip=$(echo "$line" | grep -oP '^\d+\.\d+\.\d+\.\d+'); [ -z "$ip" ] && continue
    prefix24=$(echo "$ip" | cut -d. -f1-3)
    count24[$prefix24]=$((${count24[$prefix24]:-0} + 1)); ips24[$prefix24]+=" $ip"
done < <(grep -P '^\d+\.\d+\.\d+\.\d+\s' "$DENY_FILE")

added24=0; added24_body=""
for prefix in "${!count24[@]}"; do
    if [ "${count24[$prefix]}" -ge "$THRESHOLD_24" ]; then
        if ! grep -qF "${prefix}.0/24" "$DENY_FILE"; then
            if [ "${count24[$prefix]}" -ge "$THRESHOLD_24_PERMANENT" ]; then
                comment=$(m "$M_C24_DND" "${count24[$prefix]}")
            else
                comment=$(m "$M_C24_PERM" "${count24[$prefix]}")
            fi
            if /sbin/csf -d "${prefix}.0/24" "$comment" >> "$LOG_FILE" 2>&1; then
                if [ "${count24[$prefix]}" -ge "$THRESHOLD_24_PERMANENT" ]; then
                    log "$(m "$M_OK24_DND" "$prefix" "${count24[$prefix]}")"
                    added24_body+="$(m "$M_B24_DND" "$prefix" "${count24[$prefix]}")\n"
                else
                    log "$(m "$M_OK24" "$prefix" "${count24[$prefix]}")"
                    added24_body+="$(m "$M_B24" "$prefix" "${count24[$prefix]}")\n"
                fi
                added24=$((added24 + 1))
                for ip in ${ips24[$prefix]}; do
                    if /sbin/csf -dr "$ip" >> "$LOG_FILE" 2>&1; then
                        log "$(m "$M_DELSINGLE" "$ip")"; added24_body+="$(m "$M_DELSINGLE_B" "$ip")\n"
                    else
                        log "$(m "$M_DELSINGLE_FAIL" "$ip")"
                    fi
                done
            else
                log "$(m "$M_ADD24_FAIL" "$prefix")"
            fi
        fi
    fi
done
if [ "$added24" -gt 0 ]; then
    printf '%s\n\n%b\n%s\n%s\n' "$(m "$M_MAIL24_BODY")" "$added24_body" "$doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAIL24_SUBJ" "$added24")" "$ALERT_MAIL"
fi
log "$(m "$M_24_DONE" "$added24")"

# ── /16 grouping (permanent): warn only, once per day ───────────────────────
declare -A count16 seen_subnets ips16
while IFS= read -r line; do
    ip=$(echo "$line" | grep -oP '^\d+\.\d+\.\d+\.\d+'); [ -z "$ip" ] && continue
    prefix24=$(echo "$ip" | cut -d. -f1-3); prefix16=$(echo "$ip" | cut -d. -f1-2)
    [ "${count24[$prefix24]:-0}" -ge "$THRESHOLD_24" ] && continue
    count16[$prefix16]=$((${count16[$prefix16]:-0} + 1)); seen_subnets[$prefix16]+=" $prefix24"; ips16[$prefix16]+=" $ip"
done < <(grep -P '^\d+\.\d+\.\d+\.\d+\s' "$DENY_FILE")

warn16=0; warn_body=""
for prefix in "${!count16[@]}"; do
    subnet_count=$(echo "${seen_subnets[$prefix]}" | tr ' ' '\n' | grep -c '\.')
    if [ "${count16[$prefix]}" -ge "$THRESHOLD_16" ] && [ "$subnet_count" -ge 2 ]; then
        if ! grep -qF "${prefix}.0.0/16" "$DENY_FILE"; then
            if grep -qF "WARN16_${prefix} $TODAY" "$SAYAC_FILE"; then
                log "$(m "$M_SKIP16" "$prefix")"; continue
            fi
            log "$(m "$M_WARN16" "$prefix" "${count16[$prefix]}" "$subnet_count")"
            warn_body+="$(m "$M_WARN16_B" "$prefix" "${count16[$prefix]}" "$subnet_count")\n$(list_ips "${ips16[$prefix]}")\n"
            warn16=$((warn16 + 1)); echo "WARN16_${prefix} $TODAY" >> "$SAYAC_FILE"
        fi
    fi
done
if [ "$warn16" -gt 0 ]; then
    printf '%b\n\n%b\n%s\n%s\n' "$(m "$M_MAIL16_BODY")" "$warn_body" "$doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAIL16_SUBJ" "$warn16")" "$ALERT_MAIL"
fi
log "$(m "$M_16_DONE" "$warn16")"

# ── Read temp bans + clear singles already covered permanently ──────────────
declare -A temp_count24 temp_ips24
TEMP_LIST=$(/sbin/csf -t 2>/dev/null)
while IFS= read -r line; do
    ip=$(echo "$line" | grep -oP 'DENY\s+\K[\d.]+'); [ -z "$ip" ] && continue
    echo "$line" | grep -qP 'DENY\s+[\d.]+/\d+' && continue
    prefix24=$(echo "$ip" | cut -d. -f1-3); prefix16=$(echo "$ip" | cut -d. -f1-2)
    if grep -qF "$ip" "$DENY_FILE" || grep -qF "${prefix24}.0/24" "$DENY_FILE" || grep -qF "${prefix16}.0.0/16" "$DENY_FILE"; then
        /sbin/csf -tr "$ip" >> "$LOG_FILE" 2>&1 && log "$(m "$M_TCLEAN" "$ip")"; continue
    fi
    echo "$TEMP_LIST" | grep -qF "${prefix24}.0/24" && continue
    temp_count24[$prefix24]=$((${temp_count24[$prefix24]:-0} + 1)); temp_ips24[$prefix24]+=" $ip"
done < <(echo "$TEMP_LIST" | grep "^DENY")

# ── Temp /24 grouping ───────────────────────────────────────────────────────
temp_added24=0; temp_added24_body=""; temp_perm_added24=0; temp_perm_added24_body=""
for prefix in "${!temp_count24[@]}"; do
    if [ "${temp_count24[$prefix]}" -ge "$THRESHOLD_TEMP_24" ]; then
        if grep -qF "${prefix}.0/24" "$DENY_FILE"; then log "$(m "$M_TSKIP24" "$prefix")"; continue; fi
        if grep -qF "$prefix" "$SAYAC_FILE"; then
            if /sbin/csf -d "${prefix}.0/24" "$(m "$M_TC24_PERM" "${temp_count24[$prefix]}")" >> "$LOG_FILE" 2>&1; then
                log "$(m "$M_TOK24_PERM" "$prefix" "${temp_count24[$prefix]}")"
                temp_perm_added24=$((temp_perm_added24 + 1))
                temp_perm_added24_body+="$(m "$M_TB24_PERM" "$prefix" "${temp_count24[$prefix]}")\n"
                sed -i "/^$prefix /d" "$SAYAC_FILE"
            else
                log "$(m "$M_TADD24_FAIL" "$prefix")"
            fi
        else
            if /sbin/csf -td "${prefix}.0/24" 43200 >> "$LOG_FILE" 2>&1; then
                log "$(m "$M_TOK24" "$prefix" "${temp_count24[$prefix]}")"
                temp_added24=$((temp_added24 + 1))
                temp_added24_body+="$(m "$M_TB24" "$prefix" "${temp_count24[$prefix]}")\n"
                echo "$prefix $(date '+%Y-%m-%d')" >> "$SAYAC_FILE"
            else
                log "$(m "$M_TADD24T_FAIL" "$prefix")"
            fi
        fi
    fi
done
if [ "$temp_added24" -gt 0 ]; then
    printf '%s\n\n%b\n%s\n%s\n' "$(m "$M_MAILT24_BODY")" "$temp_added24_body" "$temp_doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAILT24_SUBJ" "$temp_added24")" "$ALERT_MAIL"
fi
if [ "$temp_perm_added24" -gt 0 ]; then
    printf '%s\n\n%b\n%s\n%s\n' "$(m "$M_MAILT24P_BODY")" "$temp_perm_added24_body" "$doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAILT24P_SUBJ" "$temp_perm_added24")" "$ALERT_MAIL"
fi
log "$(m "$M_T24_DONE" "$temp_added24" "$temp_perm_added24")"

# ── Temp /16: warn only, once per day ───────────────────────────────────────
declare -A temp_count16 temp_seen_subnets temp_ips16
while IFS= read -r line; do
    ip=$(echo "$line" | grep -oP 'DENY\s+\K[\d.]+'); [ -z "$ip" ] && continue
    echo "$line" | grep -qP 'DENY\s+[\d.]+/\d+' && continue
    prefix24=$(echo "$ip" | cut -d. -f1-3); prefix16=$(echo "$ip" | cut -d. -f1-2)
    grep -qF "$ip" "$DENY_FILE" && continue
    grep -qF "${prefix24}.0/24" "$DENY_FILE" && continue
    grep -qF "${prefix16}.0.0/16" "$DENY_FILE" && continue
    echo "$TEMP_LIST" | grep -qF "${prefix24}.0/24" && continue
    [ "${temp_count24[$prefix24]:-0}" -ge "$THRESHOLD_TEMP_24" ] && continue
    temp_count16[$prefix16]=$((${temp_count16[$prefix16]:-0} + 1)); temp_seen_subnets[$prefix16]+=" $prefix24"; temp_ips16[$prefix16]+=" $ip"
done < <(echo "$TEMP_LIST" | grep "^DENY")

temp_warn16=0; temp_warn_body=""
for prefix in "${!temp_count16[@]}"; do
    subnet_count=$(echo "${temp_seen_subnets[$prefix]}" | tr ' ' '\n' | grep -c '\.')
    if [ "${temp_count16[$prefix]}" -ge "$THRESHOLD_TEMP_16" ] && [ "$subnet_count" -ge 2 ]; then
        if grep -qF "${prefix}.0.0/16" "$DENY_FILE"; then log "$(m "$M_TSKIP16" "$prefix")"; continue; fi
        if grep -qF "WARN_TEMP16_${prefix} $TODAY" "$SAYAC_FILE"; then log "$(m "$M_TSKIP16D" "$prefix")"; continue; fi
        log "$(m "$M_TWARN16" "$prefix" "${temp_count16[$prefix]}" "$subnet_count")"
        temp_warn_body+="$(m "$M_WARN16_B" "$prefix" "${temp_count16[$prefix]}" "$subnet_count")\n$(list_ips "${temp_ips16[$prefix]}")\n"
        temp_warn16=$((temp_warn16 + 1)); echo "WARN_TEMP16_${prefix} $TODAY" >> "$SAYAC_FILE"
    fi
done
if [ "$temp_warn16" -gt 0 ]; then
    printf '%b\n\n%b\n%s\n%s\n' "$(m "$M_MAILT16_BODY")" "$temp_warn_body" "$temp_doluluk_satiri" "$(m "$M_MAIL_DETAIL" "$LOG_FILE")" | \
        mail -s "$(m "$M_MAILT16_SUBJ" "$temp_warn16")" "$ALERT_MAIL"
fi
log "$(m "$M_T16_DONE" "$temp_warn16")"

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
