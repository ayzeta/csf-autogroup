#!/bin/bash
# CSF Auto-Group — yayımlanmış servis adreslerini CSF'in izin listesine yazar.
#
# Bir ağı ya da ASN'i (CC_DENY / CC_DENY_PORTS) banlarken aynı ağdan gelen meşru servisler kesilmesin diye:
# Google'ın botları ve araçları (Googlebot, AdsBot, Storebot, site doğrulama, Gmail görsel önbelleği …) ile
# adreslerini yayımlayan ödeme ve servis sağlayıcıları (ör. Mollie). CSF önce izin listesine, sonra ban
# listelerine bakar; buradaki adresler ülke/ASN banından da geçer.
#
# Adresler ayrı bir dosyaya yazılır ve csf.allow'a Include edilir (ilk çalıştırmada satır eklenir). Düz IP
# aralığı olarak yazıldıkları için CSF onları ipset'e koyar: sayıları ne olursa olsun paket başına tek sorgu.
# Kaynak indirilemezse ya da beklenenden çok az adres dönerse o kaynağın önceki listesi korunur (Googlebot bir
# indirme hatası yüzünden kesilmesin). Dosya değiştiyse csf -r çalışır, değişmediyse hiçbir şey yapılmaz.
#
#   services-allow.sh            listeleri güncelle (sonra eklentinin turu günde bir kez kendisi çalıştırır)
#   services-allow.sh --check    yalnız göster: kaynak başına adres sayısı, değişecek mi
#
# Kendi kaynaklarınız: EXTRA dosyasına "ad|https://adres" satırları (her biri IP ya da CIDR listesi döndüren
# bir adres, JSON ya da düz metin). Tek tek adres: "ad|1.2.3.4" ya da "ad|1.2.3.0/24".
set -u
OUT="${OUT:-/etc/csf/csf_autogroup.services.allow}"
ALLOW="${ALLOW:-/etc/csf/csf.allow}"
EXTRA="${EXTRA:-/etc/csf/csf_autogroup.services.extra}"
CACHE="${CACHE:-/var/lib/csf_autogroup/services}"
CSF_BIN="${CSF_BIN:-/usr/sbin/csf}"
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
SOURCES=(
    "google-common|https://developers.google.com/static/crawling/ipranges/common-crawlers.json"
    "google-special|https://developers.google.com/static/crawling/ipranges/special-crawlers.json"
    "google-user|https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json"
    "google-user-google|https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json"
    "mollie|https://ip-ranges.mollie.com/ips.txt"
)
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "services-allow: $1" | tee -a "$LOG_FILE" 2>/dev/null; }
# IPv4 adres ve aralıkları çıkar; /16'dan geniş aralık ve geçersiz sekizli alınmaz (yanlış bir liste her şeyi açmasın)
ipv4_list() {
    grep -oE '(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' |
        awk -F'[./]' '{ ok = 1; for (i = 1; i <= 4; i++) if ($i > 255) ok = 0; if (NF == 5 && ($5 < 16 || $5 > 32)) ok = 0; if (ok) print }' | sort -u
}

mkdir -p "$CACHE" 2>/dev/null
[ -r "$EXTRA" ] && while IFS= read -r l; do
    l="${l%%#*}"; l="${l//[[:space:]]/}"; [[ "$l" == *"|"* ]] && SOURCES+=("$l")
done < "$EXTRA"

body=""; total=0
for s in "${SOURCES[@]}"; do
    name="${s%%|*}"; src="${s#*|}"
    [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || continue
    old="$CACHE/$name.txt"; prev=0; [ -s "$old" ] && prev=$(grep -c . "$old")
    if [[ "$src" == http* ]]; then
        new=$(curl -fsSL --max-time 30 "$src" 2>/dev/null | ipv4_list)
    else
        new=$(printf '%s\n' "$src" | ipv4_list)
    fi
    n=$(printf '%s' "$new" | grep -c .)
    if [ "$n" -eq 0 ] || { [ "$prev" -gt 0 ] && [ "$n" -lt $(( prev / 2 )) ]; }; then
        log "$name: geçerli adres alınamadı ya da beklenenden az ($n, önceki $prev; indirilemedi, boş ya da /16'dan geniş); önceki liste korunuyor"
        new=$(cat "$old" 2>/dev/null); n=$prev
    elif [ "$CHECK" = 0 ]; then
        printf '%s\n' "$new" > "$old"
    fi
    printf '%-20s %5s adres\n' "$name" "$n"
    [ "$n" -gt 0 ] && body+="# $name ($src)"$'\n'"$(printf '%s\n' "$new" | sed "s|\$| # csf_autogroup: service $name|")"$'\n'
    total=$(( total + n ))
done

if [ -s "$OUT" ] && [ "$(grep -v '^# güncellendi' "$OUT")" = "${body%$'\n'}" ]; then changed=0; else changed=1; fi
printf 'toplam %s adres · %s\n' "$total" "$([ "$changed" = 1 ] && echo "değişecek" || echo "değişiklik yok")"
[ "$CHECK" = 1 ] && exit 0
[ "$total" -gt 0 ] || { log "hiç adres yok, dosyaya dokunulmadı"; exit 1; }

inc=0
if ! grep -qE "^Include[[:space:]]+$OUT([[:space:]]|$)" "$ALLOW" 2>/dev/null; then
    cp -p "$ALLOW" "$ALLOW.autogroup.bak" 2>/dev/null
    printf '\n# CSF Auto-Group: yayımlanmış servis adresleri (tools/services-allow.sh)\nInclude %s\n' "$OUT" >> "$ALLOW" || exit 1
    inc=1; log "csf.allow'a Include satırı eklendi: $OUT"
fi
if [ "$changed" = 1 ]; then
    { printf '# güncellendi %s — elle düzenlemeyin, tools/services-allow.sh yeniden yazar\n' "$(date '+%Y-%m-%d %H:%M')"; printf '%s' "$body"; } > "$OUT.tmp" && mv -f "$OUT.tmp" "$OUT" || exit 1
    log "izin listesi güncellendi: $total adres"
fi
if [ "$changed" = 1 ] || [ "$inc" = 1 ]; then "$CSF_BIN" -r >/dev/null 2>&1 && log "csf -r çalıştı"; fi
exit 0
