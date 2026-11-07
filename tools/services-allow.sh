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
# indirme hatası yüzünden kesilmesin). Dosya değiştiyse fark CSF'in izin kümesine (chain_ALLOW) doğrudan uygulanır;
# csf -r yalnız ilk kurulumda ya da küme kullanılamıyorsa çalışır (csf -r sırasında güvenlik duvarı birkaç saniye açık kalır).
#
# Normalde eklenti yönetir (Ayarlar → Sağlayıcı banı → İzinli servisler): seçilen kaynakları SRC ile verir,
# günde bir kez yeniler, kapatılınca --remove ile kaldırır. Elle de çalışır:
#   services-allow.sh            listeleri güncelle
#   services-allow.sh --check    yalnız göster: kaynak başına adres sayısı, değişecek mi
#   services-allow.sh --remove   Include satırını ve listeyi kaldır
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
EXCEPT="${EXCEPT:-}"     # eklenti verir; elle çalıştırmada boş (set -u altında tanımsızdı: elle çalıştırma liste üretemiyordu)
SOURCES=(
    "google-common|https://developers.google.com/static/crawling/ipranges/common-crawlers.json"
    "google-special|https://developers.google.com/static/crawling/ipranges/special-crawlers.json"
    "google-user|https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json"
    "google-user-google|https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json"
    "mollie|https://ip-ranges.mollie.com/ips.txt"
)
# eklenti seçilen kaynakları satır satır "ad|adres" olarak verir; verilmezse yukarıdaki liste
if [ -n "${SRC:-}" ]; then SOURCES=(); while IFS= read -r l; do [ -n "$l" ] && SOURCES+=("$l"); done <<< "$SRC"; fi
CHECK=0; [ "${1:-}" = "--check" ] && CHECK=1
UA="Mozilla/5.0 (compatible; csf-autogroup services-allow)"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "services-allow: $1" | tee -a "$LOG_FILE" 2>/dev/null; }
# IPv4 adres ve aralıkları çıkar; /16'dan geniş aralık ve geçersiz sekizli alınmaz (yanlış bir liste her şeyi açmasın)
ipv4_list() {     # [EN GENİŞ ÖNEK, varsayılan 16]
    local mn="${1:-16}"
    grep -oE '(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' |
        awk -F'[./]' -v mn="$mn" '{ ok = 1; for (i = 1; i <= 4; i++) if ($i > 255) ok = 0; if (NF == 5 && ($5 < mn || $5 > 32)) ok = 0; if (ok) print }' | sort -u
}
# EXCEPT: izinli servis listelerinde olsa da izinli sayılmayacak adresler (boşluk/virgül; IP ya da CIDR). Kapsayan aralık
# o adresler dışarıda kalacak şekilde en az parçaya bölünür; böylece o adresin csf.deny'deki banı çalışır.
except_filter() {
    [ -n "${EXCEPT// /}" ] || { cat; return; }
    awk -v ex="${EXCEPT//,/ }" '
        function v4(x,  p) { split(x, p, "."); return ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4] }
        function ip(v) { return int(v / 16777216) "." int(v / 65536) % 256 "." int(v / 256) % 256 "." v % 256 }
        function st(lo, hi,  i, o) { o = 0; for (i = 1; i <= n; i++) { if (EL[i] <= lo && EH[i] >= hi) return 2; if (EL[i] <= hi && EH[i] >= lo) o = 1 }; return o }
        function part(lo, b,  hi, k) { hi = lo + 2 ^ (32 - b) - 1; k = st(lo, hi)
            if (k == 0) { print ip(lo) (b == 32 ? "" : "/" b); return }
            if (k == 2 || b >= 32) return
            part(lo, b + 1); part(lo + 2 ^ (31 - b), b + 1) }
        BEGIN { m = split(ex, E, /[ 	]+/); for (i = 1; i <= m; i++) { if (E[i] !~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/) continue
                    split(E[i], q, "/"); b = (q[2] == "" ? 32 : q[2] + 0); n++; EL[n] = v4(q[1]); EH[n] = EL[n] + 2 ^ (32 - b) - 1 } }
        { split($1, q, "/"); b = (q[2] == "" ? 32 : q[2] + 0); lo = v4(q[1]); lo = lo - lo % (2 ^ (32 - b)); part(lo, b) }'
}

# Güvenlik duvarını açmadan uygulama: csf -r bütün kuralları silip yeniden kurar; o sürede (ölçüldü, CSF 16.33: 4,2 sn'lik yeniden
# yüklemenin ~2,7 sn'si) INPUT ilkesi ACCEPT ve CSF zincirleri yok, hiçbir ban işlemez. CSF, Include edilen izin dosyalarındaki düz
# IP / CIDR satırlarını chain_ALLOW kümesine (hash:net) koyar (ölçüldü): dosyanın eski ve yeni hâli arasındaki fark kümeye doğrudan
# uygulanır. Bir adres başka bir izin kaynağında da varsa (csf.allow, öteki Include'lar) kümeden silinmez. Küme yoksa, LF_IPSET
# kapalıysa ya da ipset bir adımı yapamazsa 1 döner: çağıran eskisi gibi csf -r çalıştırır. Sonraki her csf -r kümeyi dosyalardan
# yeniden kurar, sonuç aynıdır.
ents() { [ -r "$1" ] && awk '{ sub(/#.*/, ""); sub(/^[ \t]+/, ""); sub(/[ \t].*/, "") } /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/' "$1" | sort -u; }
other_allow() {   # csf.allow ve (bu dosya dışındaki) Include'larının düz IP / CIDR kayıtları
    local f; { ents "$ALLOW"; for f in $(awk '$1 == "Include" { print $2 }' "$ALLOW" 2>/dev/null); do [ "$f" = "$OUT" ] || ents "$f"; done; } | sort -u
}
live_apply() {    # ESKİ_DOSYA YENİ_DOSYA → 0: fark kümeye uygulandı
    local conf; conf="$(dirname "$ALLOW")/csf.conf"
    [ "${SVC_LIVE:-1}" = 1 ] || return 1
    command -v ipset >/dev/null 2>&1 && ipset list -n chain_ALLOW >/dev/null 2>&1 || return 1
    grep -qE '^[[:space:]]*LF_IPSET[[:space:]]*=[[:space:]]*"?1"?' "$conf" 2>/dev/null || return 1
    local a d oth x na=0 nd=0
    a=$(comm -13 <(ents "$1") <(ents "$2")); oth=$(other_allow)
    d=$(comm -23 <(ents "$1") <(ents "$2") | comm -23 - <(printf '%s\n' "$oth" | sed '/^$/d'))
    for x in $a; do ipset add chain_ALLOW "$x" -exist 2>/dev/null || return 1; na=$((na + 1)); done
    for x in $d; do ipset del chain_ALLOW "$x" -exist 2>/dev/null || return 1; nd=$((nd + 1)); done
    LIVE_MSG="+$na −$nd"
}

if [ "${1:-}" = "--remove" ]; then
    ch=0; lv=1
    if grep -qE "^Include[[:space:]]+$OUT([[:space:]]|$)" "$ALLOW" 2>/dev/null; then
        live_apply "$OUT" /dev/null || lv=0                    # kümeden önce: Include satırı silinince "öteki kaynak" hesabı doğru kalır
        cp -p "$ALLOW" "$ALLOW.autogroup.bak" 2>/dev/null
        grep -vE "^Include[[:space:]]+$OUT([[:space:]]|$)|^# CSF Auto-Group: yayımlanmış servis adresleri" "$ALLOW" > "$ALLOW.tmp" && cat "$ALLOW.tmp" > "$ALLOW"; rm -f "$ALLOW.tmp"; ch=1
    fi
    [ -e "$OUT" ] && { rm -f "$OUT"; ch=1; }
    rm -f "$CACHE/status"
    if [ "$ch" = 1 ]; then
        if [ "$lv" = 1 ]; then log "kaldırıldı (Include satırı ve liste; izin kümesinden ${LIVE_MSG:-}, csf -r gerekmedi)"
        else "$CSF_BIN" -r >/dev/null 2>&1; log "kaldırıldı (Include satırı ve liste)"; fi
    fi
    exit 0
fi
mkdir -p "$CACHE" 2>/dev/null
st=""   # kaynak başına durum: ad|adres sayısı|son başarılı güncelleme|hata (panel gösterir)
[ -r "$EXTRA" ] && while IFS= read -r l; do
    l="${l%%#*}"; l="${l//[[:space:]]/}"; [[ "$l" == *"|"* ]] && SOURCES+=("$l")
done < "$EXTRA"

body=""; total=0
for s in "${SOURCES[@]}"; do
    name="${s%%|*}"; src="${s#*|}"; flt=""; lnk=""
    [[ "$src" == *"|"* ]] && { flt="${src#*|}"; src="${src%%|*}"; }   # süzgeç (tools/src-filter.pl, kiralık listelerle ortak)
    [[ "$flt" == *"|"* ]] && { lnk="${flt#*|}"; flt="${flt%%|*}"; }   # adres bir sayfa: listenin bağlantısını bulan desen ("-" = yok)
    [ "$lnk" = "-" ] && lnk=""
    [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || continue
    old="$CACHE/$name.txt"; prev=0; [ -s "$old" ] && prev=$(grep -c . "$old")
    if [[ "$src" == http* ]]; then
        # Microsoft 365 kendi posta sunucuları için /13'e kadar aralık yayımlıyor (40.96.0.0/13); yalnız bu kaynakta izin verilir
        mn=16; [[ "$name" == microsoft365* ]] && mn=12
        if [ -n "$lnk" ]; then           # sayfada desene uyan ilk bağlantı (cloud-ban.sh'ın link_re ve page_link işlevleri, aynı kural)
            for fn in link_re page_link; do eval "$(awk "/^$fn\\(\\) \\{/{f=1} f{print} f && /^}\$/{exit}" "$(dirname "$0")/cloud-ban.sh")"; done
            if page_link "$src" "$lnk"; then src="$REPLY"; else src=""; fi
        fi
        if [[ "$src" != https://* ]]; then new=""
        elif [ -n "$flt" ] && [ "$flt" != "-" ]; then
            new=$(curl -fsSL --max-time 60 -A "$UA" "$src" 2>/dev/null | perl "$(dirname "$0")/src-filter.pl" "$flt" | ipv4_list "$mn")
        else new=$(curl -fsSL --max-time 60 -A "$UA" "$src" 2>/dev/null | ipv4_list "$mn"); fi
    else
        new=$(printf '%s\n' "$src" | ipv4_list)
    fi
    n=$(printf '%s' "$new" | grep -c .)
    ot=$(stat -c %Y "$old" 2>/dev/null || echo 0); err=""
    shr="$CACHE/$name.shrink"
    # yarıdan fazla küçülme: hata sayılır; ama aynı küçük liste 3 kez üst üste gelirse kaynak gerçekten küçülmüştür
    if [ "$n" -gt 0 ] && [ "$prev" -gt 0 ] && [ "$n" -lt $(( prev / 2 )) ]; then
        sc=$(cut -d'|' -f2 "$shr" 2>/dev/null); sn=$(cut -d'|' -f1 "$shr" 2>/dev/null)
        if [ "$sn" = "$n" ]; then sc=$(( ${sc:-0} + 1 )); else sc=1; fi
        [ "$CHECK" = 0 ] && printf '%s|%s\n' "$n" "$sc" > "$shr"
        [ "$sc" -ge 3 ] && prev=0
    else rm -f "$shr" 2>/dev/null; fi
    if [ "$n" -eq 0 ] || { [ "$prev" -gt 0 ] && [ "$n" -lt $(( prev / 2 )) ]; }; then
        log "$name: geçerli adres alınamadı ya da beklenenden az ($n, önceki $prev; indirilemedi, boş ya da /16'dan geniş); önceki liste korunuyor"
        new=$(cat "$old" 2>/dev/null); n=$prev; err="fetch"
        # ilk başarısızlık anı (bildirim 3 günü buradan sayar; hiç başarılı indirme olmasa da)
        [ "$CHECK" = 0 ] && [ ! -s "$CACHE/$name.fail" ] && date +%s > "$CACHE/$name.fail"
    elif [ "$CHECK" = 0 ]; then
        printf '%s\n' "$new" > "$old"; ot=$(date +%s); rm -f "$CACHE/$name.fail"
    fi
    ff=$(cat "$CACHE/$name.fail" 2>/dev/null); [[ "$ff" =~ ^[0-9]+$ ]] || ff=0
    st+="$name|$n|$ot|$err|$ff"$'\n'
    printf '%-20s %5s adres\n' "$name" "$n"
    [ "$n" -gt 0 ] && body+="# $name ($src)"$'\n'"$(printf '%s\n' "$new" | except_filter | sed "s|\$| # csf_autogroup: service $name|")"$'\n'
    total=$(( total + n ))
done

if [ -s "$OUT" ] && [ "$(grep -v '^# güncellendi' "$OUT")" = "${body%$'\n'}" ]; then changed=0; else changed=1; fi
printf 'toplam %s adres · %s\n' "$total" "$([ "$changed" = 1 ] && echo "değişecek" || echo "değişiklik yok")"
[ "$CHECK" = 1 ] && exit 0
printf '%s' "$st" > "$CACHE/status.tmp" 2>/dev/null && mv -f "$CACHE/status.tmp" "$CACHE/status"
[ "$total" -gt 0 ] || { log "hiç adres yok, dosyaya dokunulmadı"; exit 1; }

inc=0
if ! grep -qE "^Include[[:space:]]+$OUT([[:space:]]|$)" "$ALLOW" 2>/dev/null; then
    cp -p "$ALLOW" "$ALLOW.autogroup.bak" 2>/dev/null
    printf '\n# CSF Auto-Group: yayımlanmış servis adresleri (tools/services-allow.sh)\nInclude %s\n' "$OUT" >> "$ALLOW" || exit 1
    inc=1; log "csf.allow'a Include satırı eklendi: $OUT"
fi
prevf=""
if [ "$changed" = 1 ]; then
    prevf=$(mktemp) && { cat "$OUT" > "$prevf" 2>/dev/null || :; }   # fark için eski hâl (yoksa boş)
    { printf '# güncellendi %s — elle düzenlemeyin, tools/services-allow.sh yeniden yazar\n' "$(date '+%Y-%m-%d %H:%M')"; printf '%s' "$body"; } > "$OUT.tmp" && mv -f "$OUT.tmp" "$OUT" || { rm -f "$prevf"; exit 1; }
    log "izin listesi güncellendi: $total adres"
fi
# Include satırı yeni eklendiyse CSF dosyayı ancak yeniden yüklemede okur (ilk kurulum); yalnız içerik değiştiyse fark kümeye uygulanır
if [ "$inc" = 1 ]; then "$CSF_BIN" -r >/dev/null 2>&1 && log "csf -r çalıştı"
elif [ "$changed" = 1 ]; then
    if live_apply "$prevf" "$OUT"; then log "izin kümesine uygulandı ($LIVE_MSG), csf -r gerekmedi"
    else "$CSF_BIN" -r >/dev/null 2>&1 && log "csf -r çalıştı"; fi
fi
rm -f "$prevf"
exit 0
