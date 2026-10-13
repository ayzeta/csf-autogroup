#!/bin/bash
# CDN arkasındaki siteler: web günlüklerindeki her sitenin adı ve www'si DNS'te çözülür. Sunucunun kendi IP'lerinden biri
# değilse o ad için istekler başka bir adresten (CDN, vekil ya da başka sunucu) gelir: güvenlik duvarı ziyaretçinin IP'sini
# görmez, CSF banı o istekleri kesemez (kesmenin yeri CDN'in kendi paneli). Kim olduğu yanıt başlığından anlaşılır.
# Web günlüğü isteğin hangi addan (alanadı ya da www) geldiğini yazmadığı için bir sitenin tek adı bile dışarı gidiyorsa
# o sitenin istekleri "CDN arkasında olabilir" sayılır.
#
# Çıktı (OUT): ilk satır "#t|EPOCH", sonra dışarı giden her ad için "site|ad|adresler|kim"
#   kim: QUIC.cloud, Cloudflare, Sucuri, CloudFront, Fastly, Akamai ya da "other" (başka adres; CDN olmayabilir)
# Kullanım (motor günde bir çalıştırır; elle de çalışır):
#   bash tools/cdn-sites.sh                 yenile
#   bash tools/cdn-sites.sh --if-older 1    dosya 1 günden yeniyse dokunma
#   bash tools/cdn-sites.sh --show          dosyayı okunur yaz
OUT="${OUT:-/var/lib/csf_autogroup/cdn_sites}"
LOG_FILE="${LOG_FILE:-}"
log() { [ -n "$LOG_FILE" ] && printf '[%s] cdn-sites: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE" 2>/dev/null; }

case "${1:-}" in
    --show) [ -r "$OUT" ] || { echo "henüz yok: $OUT"; exit 0; }
            awk -F'|' 'NR == 1 { print "son tarama: " strftime("%d.%m.%Y %H:%M", $2); next } { printf "  %-30s %-34s %-18s %s\n", $1, $2, $4, $3 }' "$OUT"; exit 0 ;;
    --if-older) d="${2:-1}"; [[ "$d" =~ ^[0-9]+$ ]] || d=1
            if [ -r "$OUT" ]; then t=$(head -n 1 "$OUT" | cut -d'|' -f2); [[ "$t" =~ ^[0-9]+$ ]] && [ $(( $(date +%s) - t )) -lt $(( d * 86400 - 3600 )) ] && exit 0; fi ;;
esac

dir=""; for d in ${DOMLOGS:-} /var/log/apache2/domlogs /usr/local/apache/domlogs /etc/apache2/logs/domlogs; do [ -d "$d" ] && { dir="$d"; break; }; done
[ -n "$dir" ] || { log "web günlükleri bulunamadı"; exit 0; }
command -v getent >/dev/null 2>&1 || { log "getent yok"; exit 0; }

# son 30 günde yazılmış günlüklerin site adları (alanadı ve alanadı-ssl_log aynı site)
sites=$(find -L "$dir" -maxdepth 2 -type f -mtime -30 ! -name '*bytes_log*' ! -name '*.offset*' ! -name '*.gz' ! -name '*.bkup' 2>/dev/null |
    sed 's|.*/||; s/-ssl_log$//' | grep -E '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' | grep -vE '^[0-9.]+$' | sort -u)
# sunucunun kendi IP'leri
mine=" $( { ip -4 -o addr show 2>/dev/null | awk '{ print $4 }'; hostname -I 2>/dev/null | tr ' ' '\n'; } | sed 's#/.*##' | grep -E '^[0-9]+(\.[0-9]+){3}$' | sort -u | tr '\n' ' ')"

probe() {        # AD → kim (yanıt başlıklarından)
    local h
    h=$(curl -sk -m 6 -o /dev/null -D - "https://$1/" 2>/dev/null); [ -n "$h" ] || h=$(curl -s -m 6 -o /dev/null -D - "http://$1/" 2>/dev/null)
    h=$(printf '%s' "$h" | tr '[:upper:]' '[:lower:]')
    case "$h" in
        *x-qc-pop:*|*x-qc-cache:*) echo "QUIC.cloud" ;;
        *cf-ray:*|*"server: cloudflare"*) echo "Cloudflare" ;;
        *x-sucuri-id:*) echo "Sucuri" ;;
        *x-amz-cf-id:*) echo "CloudFront" ;;
        *x-fastly-request-id:*|*x-served-by:*cache-*) echo "Fastly" ;;
        *akamai*) echo "Akamai" ;;
        *) echo "other" ;;
    esac
}

tmp=$(mktemp) || exit 1
printf '#t|%s\n' "$(date +%s)" > "$tmp"
n=0; for s in $sites; do
    for a in "$s" "www.$s"; do
        case "$a" in www.www.*) continue ;; esac
        ips=$(getent ahostsv4 "$a" 2>/dev/null | awk '{ print $1 }' | sort -u)
        [ -n "$ips" ] || continue
        loc=0; for x in $ips; do [[ "$mine" == *" $x "* ]] && { loc=1; break; }; done
        [ "$loc" = 1 ] && continue
        printf '%s|%s|%s|%s\n' "$s" "$a" "$(printf '%s' "$ips" | paste -sd, -)" "$(probe "$a")" >> "$tmp"; n=$((n + 1))
    done
done
mkdir -p "$(dirname "$OUT")" 2>/dev/null
mv -f "$tmp" "$OUT" && chmod 644 "$OUT" 2>/dev/null
log "$(printf '%s site tarandı, %s ad sunucuya değil başka adrese gidiyor' "$(printf '%s\n' $sites | grep -c .)" "$n")"
exit 0
