#!/bin/bash
# Ayar tutarlılığı: panelin gönderebileceği her ayar değeri hem panelin sunucu tarafı doğrulamasından (whm/api.php,
# config_set'teki anahtar listesi ve desenler) hem motorun doğrulamasından (cfg_check) geçiyor mu.
# Örnek değerler motorun kendisinden üretilir: kaynak katalogları, varsayılan liste adresleri, port ve liste biçimleri.
# Yeni bir kaynak ya da anahtar eklendiğinde test kendiliğinden kapsar. Sunucuda değil, geliştirme makinesinde çalışır:
# bash, php ve (taklit CSF için) tests/durum-tablosu/bin gerekir. Hiçbir şey sisteme yazılmaz.
#
#   bash tests/ayar-tutarliligi/calistir.sh
set -u
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"; cp "$REPO"/tests/durum-tablosu/bin/* "$W/bin/"; chmod +x "$W"/bin/*
ENG="$REPO/csf_autogroup.sh"; API="$REPO/whm/api.php"

# ── örnek değerler: "ANAHTAR<TAB>DEĞER" ──
cat_of() { sed -n "s/^$1=\"\\([^\"]*\\)\".*/\\1/p" "$ENG" | head -n 1; }
SVC=$(cat_of SVC_CATALOG); CLD=$(cat_of CLOUD_CATALOG)
{
    printf 'SVC_SOURCES\t%s\n' "${SVC// /,}"
    for x in $SVC; do printf 'SVC_SOURCES\t%s\n' "$x"; done
    printf 'CLOUD_SOURCES\t%s\n' "${CLD// /,}"
    for x in $CLD; do printf 'CLOUD_SOURCES\t%s\n' "$x"; done
    # varsayılan adresler: panelin "Adres" düzenleyicisi bunları (ya da değiştirilmiş hâllerini) gönderir
    grep -oE '[a-z0-9-]+\|https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^ "]*' "$ENG" | sort -u | while IFS= read -r e; do   # yardım metinlerindeki "https://…" yer tutucusu değil, gerçek adresler
        case "${e%%|*}" in extra-*|x-*) continue ;; esac
        printf 'SVC_URLS\t%s\n' "$e"
    done | awk -F'\t' -v svc=" $SVC " '{ n = $2; sub(/\|.*/, "", n); b = n; sub(/-.*/, "", b); if (index(svc, " " b " ")) print }'
    sed -n 's/^ *\([a-z]*\)) *REPLY="\(https:[^"]*\)".*/\1|\2/p' "$ENG" | awk -F'|' -v c=" $CLD " 'index(c, " " $1 " ") { print "CLOUD_URLS\t" $0 }'
    printf 'SVC_EXTRA\t%s\n' 'odeme|https://ornek.com/ips.txt?a=1&b=2 ofis|203.0.113.10 ag|203.0.113.0/24'
    printf 'CLOUD_EXTRA\t%s\n' 'hetzner|https://ornek.com/liste.txt ovh-2|https://ornek.com/a.json?x=1'
    printf 'ASN_LIST\t%s\n' 'AS396982,AS14061,AS8075'
    printf 'ASN_ALL\t%s\n' 'AS16276'
    for k in ASN_TCP CLOUD_TCP; do printf '%s\t%s\n' "$k" '80,443' "$k" '22,80,443,465,587' "$k" '30000:35000,8080' "$k" ''; done
    for k in ASN_UDP CLOUD_UDP; do printf '%s\t%s\n' "$k" '443' "$k" ''; done
    for k in ASN_BAN SVC_ALLOW CLOUD_BAN ENABLED LOOKUP DIGEST BLOCK_EXPIRE_AUTO IC_FIREWALL IC_LISTFULL IC_RUN IC_DIGEST; do printf '%s\t0\n%s\t1\n' "$k" "$k"; done
    printf 'ASN_MODE\t%s\n' web ports
    printf 'MSG_LANG\t%s\n' tr en
    printf 'NOTIFY\t%s\n' all email slack
    printf 'ALERT_MAIL\t%s\n' whm root root@localhost 'admin+csf@ornek.com.tr'
    printf 'DIGEST_DAY\t%s\n' 1 7
    printf 'THRESHOLD_24\t3\nTHRESHOLD_24_PERMANENT\t5\nTHRESHOLD_16\t5\nTHRESHOLD_TEMP_24\t3\nTHRESHOLD_TEMP_16\t5\n'
    printf 'LOOKUP_TIMEOUT\t3\nSAYAC_RETENTION_DAYS\t180\nREVIEW_DAYS\t7\nLOG_MAX_LINES\t5000\nLOG_ROTATE_MB\t10\nLOG_ROTATE_KEEP\t4\nBLOCK_EXPIRE_DAYS\t365\n'
} > "$W/values.tsv"

# ── panel: api.php'deki anahtar listesi ve desenler (php ile, dosya çalıştırılmadan okunur) ──
wp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf "%s" "$1"; fi; }   # Windows php Git Bash yolunu okuyamaz
php "$(wp "$H/api_check.php")" "$(wp "$API")" "$(wp "$W/values.tsv")" > "$W/panel.out"

# ── motor: --config set her değeri kabul ediyor mu (taklit kökte; CRON_MIN crontab yazdığı için ayrı değil) ──
R="$W/root"; mkdir -p "$R/app" "$R/etc/csf" "$R/var/lib/csf" "$R/var/lib/csf_autogroup"
: > "$R/etc/csf/csf.deny"; printf '127.0.0.1\n' > "$R/etc/csf/csf.allow"; : > "$R/var/lib/csf_autogroup/counter"
printf 'DENY_IP_LIMIT = "200"\nDENY_TEMP_IP_LIMIT = "100"\n' > "$R/etc/csf/csf.conf"
cp "$ENG" "$R/app/csf_autogroup.sh"
printf '%s\n' "MSG_LANG=tr" "DENY_FILE=$R/etc/csf/csf.deny" "CSF_CONF=$R/etc/csf/csf.conf" "CSF_BIN=$W/bin/csf" "CSF_VAR=$R/var/lib/csf" \
    "LOG_FILE=$R/log" "SAYAC_FILE=$R/var/lib/csf_autogroup/counter" > "$R/app/config.env"
: > "$W/engine.out"
while IFS=$'\t' read -r key val; do
    [ -n "$key" ] || continue
    out=$(env SIM_ROOT="$R" PATH="$W/bin:/usr/bin:/bin" AG_BY=test bash "$R/app/csf_autogroup.sh" --config set "$key=$val" --json 2>&1)
    [[ "$out" == *'"ok":true'* ]] || printf 'MOTOR\t%s\t%s\t%s\n' "$key" "$val" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)" >> "$W/engine.out"
done < "$W/values.tsv"

n=$(grep -c . "$W/values.tsv"); bad=$(cat "$W/panel.out" "$W/engine.out" | grep -c .)
if [ "$bad" -eq 0 ]; then echo "Ayar tutarlılığı: $n değerin hepsi panelden ve motordan geçiyor"; exit 0; fi
echo "Ayar tutarlılığı: $n değerden $bad tanesi reddedildi"; cat "$W/panel.out" "$W/engine.out" | sed 's/^/  ✗ /'
exit 1
