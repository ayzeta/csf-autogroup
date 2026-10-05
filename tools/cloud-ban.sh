#!/bin/bash
# CSF Auto-Group — bulut firmalarının kiraladığı sunucuların yayımlanmış adres listeleriyle ban (yalnız seçilen portlar).
#
# Saldırıların çoğu bulut sunucularından geliyor; ama bir bulut sağlayıcısının bütün ASN'ini banlamak kendi
# servislerini de keser (ör. Google'ın AS15169'unda Googlebot ve Gmail de var). Firmalar herkese kiraladıkları
# sunucuların adreslerini ayrıca yayımlıyor (Google Cloud cloud.json, AWS EC2, Oracle Cloud, DigitalOcean, Linode,
# Vultr, Azure); bu araç o listeleri indirir, ag_cloud ipset'ine yükler ve CSF'in LOCALINPUT zincirinin sonuna yalnız
# seçilen portlarda yeni bağlantıları düşüren bir kural ekler. CSF önce izin listesine (csf.allow, izinli
# servisler) bakar; onlar bu kuralın önünde kalır. Kural yalnız gelen YENİ bağlantıya uygulanır: sunucunun
# o bulutlara kendi açtığı bağlantılar (yedek hedefleri, API'ler) etkilenmez. Sunucunun kendi IP'leri listeden
# çıkarılır (nomatch).
#
# CSF her yeniden başlatmada zincirleri sıfırlar; kural /etc/csf/csfpost.sh'taki tek satırla (--apply) geri
# kurulur. Normalde eklenti yönetir (Sağlayıcılar → Bulut listeleriyle ban):
#   cloud-ban.sh            listeleri indir ve uygula
#   cloud-ban.sh --apply    indirmeden, son listelerle uygula (csfpost.sh bunu çağırır)
#   cloud-ban.sh --sync     --apply + csfpost.sh satırını denetle
#   cloud-ban.sh --remove   kuralı, ipset'i ve csfpost.sh satırını kaldır
# Durum dosyaları CACHE altında: active (kaynak adları), ports (tcp=…, udp=…), self (sunucu IP'leri), <ad>.txt
set -u
CACHE="${CACHE:-/var/lib/csf_autogroup/cloud}"
CSF_DIR="${CSF_DIR:-/etc/csf}"
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
SET=ag_cloud CHAIN=AG_CLOUD MARK="# csf_autogroup cloud"
POST="$CSF_DIR/csfpost.sh"
SELF_PATH="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"
UA="Mozilla/5.0 (compatible; csf-autogroup cloud-ban)"
# Microsoft'un indirme sayfası kısa UA'ya 403 döner: tam tarayıcı kimliği ve başlıklar gerekir
BUA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "cloud-ban: $1" >> "$LOG_FILE" 2>/dev/null; }
# IPv4 aralıkları; /10'dan geniş aralık ve geçersiz sekizli alınmaz (bozuk bir liste interneti kapatmasın)
ipv4_list() {
    grep -oE '(^|[^0-9.])[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' |
        awk -F'[./]' '{ ok = 1; for (i = 1; i <= 4; i++) if ($i > 255) ok = 0; if (NF == 5 && ($5 < 10 || $5 > 32)) ok = 0; if (ok) print }' | sort -u
}
# kaynağa göre süzgeç: AWS listesinde yalnız EC2 (kiralık sunucular; CloudFront, S3, Route 53 denetimleri değil)
pick() {
    case "$1" in
        aws*) awk 'BEGIN { RS = "}" } /"service": *"EC2"/' | ipv4_list ;;
        azure*) awk '/"name": *"AzureCloud",/ { f = 1 } f && /"addressPrefixes"/ { p = 1; next } p && /\]/ { exit } p' | ipv4_list ;;   # yalnız AzureCloud etiketi
        *) ipv4_list ;;
    esac
}
fetch() {        # AD ADRES → ham liste
    local u="$2"
    case "$1" in
        azure*)
            # Microsoft listeyi her hafta yeni adla yayımlar (ServiceTags_Public_TARİH.json); sabit olan indirme sayfası,
            # güncel dosyanın bağlantısı oradan okunur. Adres doğrudan bir .json ise o indirilir.
            if [[ "$u" != *.json ]]; then
                u=$(curl -fsSL --max-time 30 -A "$BUA" -H 'Accept: text/html,application/xhtml+xml' -H 'Accept-Language: en-US,en;q=0.9' "$u" 2>/dev/null |
                    grep -oE 'https://download\.microsoft\.com/download/[^"]*ServiceTags_Public_[0-9]+\.json' | head -n 1)
                [ -n "$u" ] || return 1
            fi
            curl -fsSL --max-time 120 -A "$BUA" "$u" ;;
        *) curl -fsSL --max-time 60 -A "$UA" "$u" ;;
    esac
}
hook_add() {     # csfpost.sh'a tek satır: CSF yeniden başlayınca kural geri gelsin (Imunify satırı en sonda kalır)
    local line="[ -r \"$SELF_PATH\" ] && CACHE=\"$CACHE\" LOG_FILE=\"$LOG_FILE\" bash \"$SELF_PATH\" --apply $MARK"
    if [ -f "$POST" ] && grep -qF "$MARK" "$POST"; then
        grep -qF "$line" "$POST" && return 0
        grep -vF "$MARK" "$POST" > "$POST.ag.tmp" && cat "$POST.ag.tmp" > "$POST"; rm -f "$POST.ag.tmp"
    fi
    [ -f "$POST" ] || { printf '#!/bin/bash\n' > "$POST"; chmod 700 "$POST"; }
    cp -p "$POST" "$POST.autogroup.bak" 2>/dev/null
    if grep -q 'ipset_sync' "$POST"; then
        awk -v l="$line" '!d && /ipset_sync/ { print l; d = 1 } { print }' "$POST" > "$POST.ag.tmp" && cat "$POST.ag.tmp" > "$POST"; rm -f "$POST.ag.tmp"
    else printf '%s\n' "$line" >> "$POST"; fi
    log "csfpost.sh'a satır eklendi"
}
hook_del() {
    [ -f "$POST" ] && grep -qF "$MARK" "$POST" || return 0
    cp -p "$POST" "$POST.autogroup.bak" 2>/dev/null
    grep -vF "$MARK" "$POST" > "$POST.ag.tmp" && cat "$POST.ag.tmp" > "$POST"; rm -f "$POST.ag.tmp"
    log "csfpost.sh'tan satır kaldırıldı"
}
rules_del() {
    while iptables -D LOCALINPUT ! -i lo -j "$CHAIN" 2>/dev/null; do :; done
    iptables -F "$CHAIN" 2>/dev/null; iptables -X "$CHAIN" 2>/dev/null
    ipset destroy "$SET" 2>/dev/null; ipset destroy "${SET}_t" 2>/dev/null
    return 0
}
apply() {        # son listelerle ipset'i doldur, zinciri kur (değişmiş olsa da boşluk olmadan: ipset swap)
    local names tcp="" udp="" list n s
    command -v ipset >/dev/null 2>&1 && command -v iptables >/dev/null 2>&1 || { log "ipset ya da iptables yok"; return 1; }
    names=$(cat "$CACHE/active" 2>/dev/null)
    [ -r "$CACHE/ports" ] && while IFS='=' read -r k v; do case "$k" in tcp) tcp="$v" ;; udp) udp="$v" ;; esac; done < "$CACHE/ports"
    [[ "$tcp" =~ ^[0-9,:]*$ && "$udp" =~ ^[0-9,:]*$ ]] || { tcp=""; udp=""; }
    list=$(for n in $names; do [[ "$n" =~ ^[a-z0-9-]+$ ]] && cat "$CACHE/$n.txt" 2>/dev/null; done | grep -E '^[0-9.]+(/[0-9]+)?$' | sort -u)
    if [ -z "$names" ] || [ -z "$list" ] || [ -z "$tcp$udp" ]; then rules_del; return 0; fi
    # izinli servisler (Googlebot'un bir kısmı Google Cloud aralıklarında): CSF izin listesi zaten önce gelir; izin
    # listesi bir sebeple boş kalsa da kesilmesinler diye kümeden ayrıca çıkarılırlar (aynı aralık hiç eklenmez, dar olan nomatch)
    local allow; allow=$(grep -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}(/[0-9]{1,2})?' "$CSF_DIR/csf_autogroup.services.allow" 2>/dev/null | sort -u)
    [ -n "$allow" ] && list=$(comm -23 <(printf '%s\n' "$list") <(printf '%s\n' "$allow"))
    ipset create "$SET" hash:net family inet hashsize 4096 maxelem 262144 -exist || return 1
    ipset create "${SET}_t" hash:net family inet hashsize 4096 maxelem 262144 -exist || return 1
    ipset flush "${SET}_t"
    { printf '%s\n' "$list" | awk -v s="${SET}_t" '{ print "add " s " " $1 " -exist" }'
      for s in $(cat "$CACHE/self" 2>/dev/null); do [[ "$s" =~ ^[0-9.]+$ ]] && echo "add ${SET}_t $s/32 nomatch -exist"; done
      for s in $allow; do [[ "$s" == */* ]] || s="$s/32"; echo "add ${SET}_t $s nomatch -exist"; done
    } | ipset restore -exist || { log "ipset doldurulamadı"; return 1; }
    ipset swap "${SET}_t" "$SET" && ipset destroy "${SET}_t"
    iptables -N "$CHAIN" 2>/dev/null; iptables -F "$CHAIN" || return 1
    [ -n "$tcp" ] && iptables -A "$CHAIN" -p tcp -m multiport --dports "$tcp" -m conntrack --ctstate NEW -m set --match-set "$SET" src -j DROP
    [ -n "$udp" ] && iptables -A "$CHAIN" -p udp -m multiport --dports "$udp" -m conntrack --ctstate NEW -m set --match-set "$SET" src -j DROP
    iptables -C LOCALINPUT ! -i lo -j "$CHAIN" 2>/dev/null || iptables -A LOCALINPUT ! -i lo -j "$CHAIN" || { log "LOCALINPUT zinciri yok (CSF çalışıyor mu?)"; return 1; }
    return 0
}

case "${1:-}" in
    --apply) apply; exit $? ;;
    --sync) hook_add; apply; exit $? ;;          # eklenti: indirmeden csfpost satırı + kural (portlar ya da kaynak seçimi değişti)
    --remove) rules_del; hook_del; rm -f "$CACHE/status" "$CACHE/active"; log "kaldırıldı"; exit 0 ;;
esac

# indir: her etkin kaynak "ad|adres" (SRC, satır satır); indirilemezse ya da yarıdan çok küçülürse önceki liste korunur
mkdir -p "$CACHE" 2>/dev/null
st=""
while IFS= read -r s; do
    [ -n "$s" ] || continue
    name="${s%%|*}"; src="${s#*|}"
    [[ "$name" =~ ^[a-z0-9-]+$ ]] || continue
    old="$CACHE/$name.txt"; prev=0; [ -s "$old" ] && prev=$(grep -c . "$old")
    new=$(fetch "$name" "$src" 2>/dev/null | pick "$name")
    n=$(printf '%s' "$new" | grep -c .)
    ot=$(stat -c %Y "$old" 2>/dev/null || echo 0); err=""
    if [ "$n" -eq 0 ] || { [ "$prev" -gt 0 ] && [ "$n" -lt $(( prev / 2 )) ]; }; then
        log "$name: liste alınamadı ya da beklenenden az ($n, önceki $prev); önceki liste korunuyor"
        n=$prev; err="fetch"
        [ -s "$CACHE/$name.fail" ] || date +%s > "$CACHE/$name.fail"
    else
        printf '%s\n' "$new" > "$old"; ot=$(date +%s); rm -f "$CACHE/$name.fail"
    fi
    ff=$(cat "$CACHE/$name.fail" 2>/dev/null); [[ "$ff" =~ ^[0-9]+$ ]] || ff=0
    st+="$name|$n|$ot|$err|$ff"$'\n'
done <<< "${SRC:-}"
printf '%s' "$st" > "$CACHE/status.tmp" && mv -f "$CACHE/status.tmp" "$CACHE/status"
hook_add
apply || exit 1
log "uygulandı: $(ipset list -t "$SET" 2>/dev/null | awk -F': ' '/^Number of entries/ { print $2 }') aralık"
exit 0
