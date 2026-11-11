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
    printf 'CLOUD_EXTRA\t%s\n' 'hetzner|https://ornek.com/liste.txt ovh-2|https://ornek.com/a.json?x=1' 'aws2--eu-north-1|https://ornek.com/eu.txt'
    # isteğe bağlı süzgeç ("j:alan=değer&…", "t:metin", "-") ve sayfadaki bağlantı deseni
    printf 'CLOUD_EXTRA\t%s\n' 'aws2--eu|https://ip-ranges.amazonaws.com/ip-ranges.json|j:service=EC2&region=eu-north-1' 'az|https://www.microsoft.com/en-us/download/details.aspx?id=56519|j:name=AzureCloud|download.microsoft.com/*ServiceTags_Public_*.json' 'do|https://digitalocean.com/geo/google.csv|t:%2CUS%2C'
    printf 'SVC_EXTRA\t%s\n' 'gh|https://api.github.com/meta|j:x=y|-' 'ofis|203.0.113.10'
    printf 'CLOUD_URLS\t%s\n' 'aws|https://ip-ranges.amazonaws.com/ip-ranges.json|j:service=EC2&region=eu-north-1' 'azure|https://www.microsoft.com/en-us/download/details.aspx?id=56519|-|-'
    printf 'SVC_URLS\t%s\n' 'bing|https://www.bing.com/toolbox/bingbot.json|j:x=y'
    printf 'SRC_LABELS\t%s\n' 'svc:odeme=%C3%96deme%20servisleri svc:odeme:d=webhook%20adresleri svc:yz--arama-botu=Arama%20botu cl:aws2=AWS%20b%C3%B6lgeleri' ''
    # alt liste kapatma: hazır kaynakların bütün alt liste adları (tek tek ve hepsi birden), boş değer
    SUB=$(grep -oE '[a-z0-9-]+\|(https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\$[A-Z]+/)' "$ENG" | sed 's/|.*//' | awk -v svc=" $SVC " '{ b = $0; sub(/-.*/, "", b) } index(svc, " " b " ") && $0 ~ /-/' | sort -u)
    for x in $SUB; do printf 'SVC_SKIP\t%s\n' "$x"; done
    printf 'SVC_SKIP\t%s\n' "$(echo $SUB | tr ' ' ',')" ''
    printf 'SVC_EXCEPT\t%s\n' '74.7.241.35' '74.7.241.35 74.7.243.0/24' '203.0.113.0/8 198.51.100.7/32' ''
    printf 'ASN_LIST\t%s\n' 'AS396982,AS14061,AS8075'
    printf 'ASN_ALL\t%s\n' 'AS16276'
    for k in ASN_TCP CLOUD_TCP; do printf '%s\t%s\n' "$k" '80,443' "$k" '22,80,443,465,587' "$k" '30000:35000,8080' "$k" ''; done
    for k in ASN_UDP CLOUD_UDP; do printf '%s\t%s\n' "$k" '443' "$k" ''; done
    # kiralık liste başına kip (svc / all / exc; servisler; portlar tire aralıklı)
    printf 'CLOUD_MODES\t%s\n' 'aws=exc:web:' 'azure=svc:web,ssh:8080,30000-35000 gcp=all::' 'x-kendi--alt=svc::2222' 'oracle=exc::' 'aws=svc::443/udp' 'aws=exc:web:53/udp,30000-30100/udp' ''
    for k in ASN_BAN SVC_ALLOW CLOUD_BAN ENABLED LOOKUP DIGEST BLOCK_EXPIRE_AUTO IC_FIREWALL IC_LISTFULL IC_RUN IC_DIGEST IE_FIREWALL IE_LISTFULL IE_RUN IE_DIGEST IC_REVIEW IE_REVIEW; do printf '%s\t0\n%s\t1\n' "$k" "$k"; done
    printf 'ASN_MODE\t%s\n' web ports
    printf 'MSG_LANG\t%s\n' tr en
    printf 'NOTIFY\t%s\n' all email slack
    printf 'ALERT_MAIL\t%s\n' whm root root@localhost 'admin+csf@ornek.com.tr'
    printf 'DIGEST_DAY\t%s\n' 1 7
    printf 'THRESHOLD_24\t3\nTHRESHOLD_24_PERMANENT\t5\nTHRESHOLD_16\t5\nTHRESHOLD_TEMP_24\t3\nTHRESHOLD_TEMP_16\t5\n'
    printf 'LOOKUP_TIMEOUT\t3\nSAYAC_RETENTION_DAYS\t180\nREVIEW_DAYS\t7\nLOG_KEEP_DAYS\t30\nLOG_ROTATE_MB\t10\nLOG_ROTATE_KEEP\t4\nBLOCK_EXPIRE_DAYS\t365\n'
    # yenileme ve süre ayarları (varsayılanlar ve uçlar)
    printf 'CLOUD_REFRESH_DAYS\t%s\n' 1 30; printf 'CLOUD_FAIL_DAYS\t%s\n' 3 30; printf 'SVC_REFRESH_DAYS\t%s\n' 1 7; printf 'SVC_FAIL_DAYS\t%s\n' 1 3
    printf 'REFRESH_HOUR\t%s\n' off 0 4 23; printf 'GEO_REFRESH_DAYS\t%s\n' 7 25 90;printf 'OWNER_TTL_DAYS\t%s\n' 1 30 180; printf 'IMUNIFY_REFRESH_MIN\t%s\n' 10 60 1440; printf 'BLOCK_ACTIVE_DAYS\t%s\n' 1 30 365
    printf 'LOG_KEEP_DAYS\t%s\n' 1 365; printf 'EVENTS_DAYS\t%s\n' 30 180 730; printf 'RUN_DAYS\t%s\n' 31 365; printf 'PERM_WINDOW_DAYS\t%s\n' 30 90 365; printf 'BANLOG_DAYS\t%s\n' 30 90 730
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
# yazılabilir mi: --config set yalnız CFG_KEYS'tekileri yazar, öteki anahtar için "Değişiklik yok" (ok) der. CLOUD_MODES bir kez
# yalnız PROV_KEYS'e eklenmişti: panel kaydı motor tarafından sessizce atılıyordu (2026-11-06). Her anahtar ayar listesinde olmalı
cl=$(env SIM_ROOT="$R" PATH="$W/bin:/usr/bin:/bin" AG_BY=test bash "$R/app/csf_autogroup.sh" --config get 2>/dev/null | awk '{ print $1 }')
for key in $(cut -f1 "$W/values.tsv" | sort -u); do
    printf '%s\n' "$cl" | grep -qx "$key" || printf 'MOTOR\t%s\t-\tayar listesinde (CFG_KEYS) yok: --config set bu anahtarı yazmaz\n' "$key" >> "$W/engine.out"
done
# panelin kaydettiği her anahtar (api.php izin listesi) motorun ayar listesinde
for key in $(php -r '$s = file_get_contents($argv[1]); $i = strpos($s, "case '"'"'config_set'"'"'"); $j = strpos($s, "\$re", $i); preg_match_all("/'"'"'([A-Z][A-Z0-9_]+)'"'"'/", substr($s, $i, $j - $i), $m); echo implode(" ", array_unique($m[1]));' "$(wp "$API")"); do
    printf '%s\n' "$cl" | grep -qx "$key" || printf 'PANEL\t%s\t-\tapi.php kaydediyor ama motorun ayar listesinde (CFG_KEYS) yok\n' "$key" >> "$W/engine.out"
done

# "Kaydetmeden önce dene" anahtarları üç yerde aynı küme: motor CFG_TRY_KEYS (ayar listesinde olanlar), api.php dry_run'ın $try
# listesi (listede olmayan --set sessizce düşer), panelin TRY_KEYS'i (hangi değişiklikte düğme çıkar). 1.15.92'de PERM_WINDOW_DAYS
# panelde ve motorda vardı, api.php'de yoktu: deneme kaydedilmiş değerle koşuyordu
sorted() { tr ' ,' '\n\n' | tr -d "'[];" | sed '/^$/d' | sort -u | paste -sd' ' -; }
ek=$(for k in $(sed -n 's/^CFG_TRY_KEYS="\([^"]*\)".*/\1/p' "$ENG"); do sed -n 's/^CFG_KEYS="\([^"]*\)".*/ \1 /p' "$ENG" | grep -q " $k " && echo "$k"; done | sorted)
ak=$(awk "/case 'dry_run'/{f=1} f && /\\\$try = \\[/{g=1} g{print} g && /\\];/{exit}" "$API" | sed 's/.*\$try = \[//' | grep -oE "'[A-Z0-9_]+'" | sorted)
jk=$(grep -oE "var TRY_KEYS = \[[^]]*\]" "$REPO/whm/assets/ag.js" | grep -oE "'[A-Z0-9_]+'" | sorted)
if [ -z "$ek" ] || [ "$ek" != "$ak" ] || [ "$ek" != "$jk" ]; then
    printf 'TRY\t-\t-\tdeneme anahtarları farklı: motor [%s] · api.php [%s] · ag.js [%s]\n' "$ek" "$ak" "$jk" >> "$W/engine.out"
fi
n=$(grep -c . "$W/values.tsv"); bad=$(cat "$W/panel.out" "$W/engine.out" | grep -c .)
if [ "$bad" -eq 0 ]; then echo "Ayar tutarlılığı: $n değerin hepsi panelden ve motordan geçiyor"; exit 0; fi
echo "Ayar tutarlılığı: $n değerden $bad tanesi reddedildi"; cat "$W/panel.out" "$W/engine.out" | sed 's/^/  ✗ /'
exit 1
