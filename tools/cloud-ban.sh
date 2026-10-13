#!/bin/bash
# CSF Auto-Group — bulut firmalarının kiraladığı sunucuların yayımlanmış adres listeleriyle ban (yalnız seçilen portlar).
#
# Saldırıların çoğu bulut sunucularından geliyor; ama bir bulut sağlayıcısının bütün ASN'ini banlamak kendi
# servislerini de keser (ör. Google'ın AS15169'unda Googlebot ve Gmail de var). Firmalar herkese kiraladıkları
# sunucuların adreslerini ayrıca yayımlıyor (Google Cloud cloud.json, AWS EC2, Oracle Cloud, DigitalOcean, Linode,
# Vultr, Azure); bu araç o listeleri indirir, ag_cloud ipset'ine yükler ve mangle tablosunun PREROUTING zincirine
# yalnız seçilen portlarda yeni bağlantıları düşüren bir kural ekler. Orada kural nat yönlendirmesinden ÖNCE çalışır
# (Imunify360 gri listeyi kendi WebShield portlarına çevirip CSF'ten önce kabul ediyor) ve Imunify'ın INPUT'taki
# zinciriyle sıra yarışına girmez. İzin listesi (csf.allow ve Include ettikleri, izinli servisler) ve sunucunun kendi
# IP'leri kümede muaftır (nomatch). Kural yalnız gelen YENİ bağlantıya uygulanır: sunucunun o bulutlara kendi açtığı
# bağlantılar (yedek hedefleri, API'ler) etkilenmez.
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
CSF_VAR="${CSF_VAR:-/var/lib/csf}"
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
SET=ag_cloud CHAIN=AG_CLOUD MARK="# csf_autogroup cloud"
# CSF yalnız birini çalıştırır: /usr/local/csf/bin/csfpost.sh varsa onu, yoksa /etc/csf/csfpost.sh (csf.pl, CSF 16.33'te
# ölçüldü). Satır CSF'in çalıştıracağı dosyaya yazılır; öteki dosyada kalmış eski satır temizlenir.
POST="$CSF_DIR/csfpost.sh"; POST2=""
if [ "$CSF_DIR" = /etc/csf ] && [ -e /usr/local/csf/bin/csfpost.sh ]; then POST=/usr/local/csf/bin/csfpost.sh; POST2="$CSF_DIR/csfpost.sh"; fi
post_strip() { [ -f "$1" ] && grep -qF "$MARK" "$1" || return 0; grep -vF "$MARK" "$1" > "$1.ag.tmp" && cat "$1.ag.tmp" > "$1"; rm -f "$1.ag.tmp"; }
SELF_PATH="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"
. "$(dirname "$SELF_PATH")/allow-list.sh" || exit 1
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
    [ -n "$POST2" ] && post_strip "$POST2"
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
    [ -n "$POST2" ] && post_strip "$POST2"
    [ -f "$POST" ] && grep -qF "$MARK" "$POST" || return 0
    cp -p "$POST" "$POST.autogroup.bak" 2>/dev/null
    grep -vF "$MARK" "$POST" > "$POST.ag.tmp" && cat "$POST.ag.tmp" > "$POST"; rm -f "$POST.ag.tmp"
    log "csfpost.sh'tan satır kaldırıldı"
}
M() { iptables -t mangle "$@"; }
jump_del() {     # bütün atlamalar: mangle PREROUTING (şimdiki), eski sürümlerin filter INPUT'u ve LOCALINPUT'u
    while M -D PREROUTING ! -i lo -j "$CHAIN" 2>/dev/null; do :; done
    while iptables -D INPUT ! -i lo -j "$CHAIN" 2>/dev/null; do :; done
    while iptables -D LOCALINPUT ! -i lo -j "$CHAIN" 2>/dev/null; do :; done
}
rules_del() {
    jump_del
    M -F "$CHAIN" 2>/dev/null; M -X "$CHAIN" 2>/dev/null
    iptables -F "$CHAIN" 2>/dev/null; iptables -X "$CHAIN" 2>/dev/null     # eski sürüm (filter)
    ipset destroy "$SET" 2>/dev/null; ipset destroy "${SET}_t" 2>/dev/null
    return 0
}
# Yer: mangle PREROUTING, nat'tan önce. Imunify360 kendi zincirini INPUT'un başına yeniden koyuyor; kural INPUT'tayken
# bir dakika içinde ikinci sıraya düşüyor ve gri listedeki adresler yine geçiyordu (sunucuda ölçüldü 2026-10-11).
order_ok() {     # 0: atlama mangle PREROUTING'te tek, önünde yalnız eklentinin kendi zincirleri; eski yerlerde yok
    local s n
    s=$(M -S PREROUTING 2>/dev/null | grep -- '^-A PREROUTING ')
    n=$(printf '%s\n' "$s" | grep -n -- "-j $CHAIN\$" | cut -d: -f1)
    [ -n "$n" ] && [ "$(printf '%s\n' "$n" | grep -c .)" -eq 1 ] || return 1
    if [ "$n" -gt 1 ] && printf '%s\n' "$s" | head -n $(( n - 1 )) | grep -vqE -- '-j (AG_GUARD|AG_CLOUD)$|--match-set ag_hits src$'; then return 1; fi
    ! iptables -C INPUT ! -i lo -j "$CHAIN" 2>/dev/null && ! iptables -C LOCALINPUT ! -i lo -j "$CHAIN" 2>/dev/null
}
order_fix() {
    M -L "$CHAIN" -n >/dev/null 2>&1 || return 1
    # rule.since: kuralın doğru yerde (etkin) olduğu andan beri; tools/ban-leak.sh bundan önceki istekleri sızıntı saymaz
    # (yeri bozulmuşken gelenler eski durumdur). Dosya yoksa ilk denetimde "şimdi" yazılır.
    order_ok && { [ -s "$CACHE/rule.since" ] || date +%s > "$CACHE/rule.since"; return 0; }
    jump_del; iptables -F "$CHAIN" 2>/dev/null; iptables -X "$CHAIN" 2>/dev/null
    M -I PREROUTING "$(hits_pos)" ! -i lo -j "$CHAIN" || { log "mangle PREROUTING zincirine kural eklenemedi"; return 1; }
    date +%s > "$CACHE/rule.since"
    log "kural mangle PREROUTING zincirinin başına alındı"
}
# İzin listesi (allow-list.sh, ban korumasıyla ortak): kural CSF'in izin listesinden ÖNCE çalıştığı için CSF'in içeri
# aldığı adresler burada da geçer. Bütün portlara izinli adres kümede muaf (nomatch); tek portluk izin yalnız o portta
# geçer (zincirde kümeden önce RETURN) — müşteriye SSH için açılan satır, listedeki adresin web'ine yol açmasın.
allow_sum() { ag_allow_sum; }
apply() {        # son listelerle ipset'i doldur, zinciri kur (değişmiş olsa da boşluk olmadan: ipset swap)
    local names tcp="" udp="" list n s
    command -v ipset >/dev/null 2>&1 && command -v iptables >/dev/null 2>&1 || { log "ipset ya da iptables yok"; return 1; }
    names=$(cat "$CACHE/active" 2>/dev/null)
    [ -r "$CACHE/ports" ] && while IFS='=' read -r k v; do case "$k" in tcp) tcp="$v" ;; udp) udp="$v" ;; esac; done < "$CACHE/ports"
    [[ "$tcp" =~ ^[0-9,:]*$ && "$udp" =~ ^[0-9,:]*$ ]] || { tcp=""; udp=""; }
    list=$(for n in $names; do [[ "$n" =~ ^[a-z0-9-]+$ ]] && cat "$CACHE/$n.txt" 2>/dev/null; done | grep -E '^[0-9.]+(/[0-9]+)?$' | sort -u)
    if [ -z "$names" ] || [ -z "$list" ] || [ -z "$tcp$udp" ]; then rules_del; return 0; fi
    # izinli adresler (csf.allow + Include, izinli servisler; Googlebot'un bir kısmı Google Cloud aralıklarında): kural
    # CSF'in izin listesinden önce çalıştığı için kümede muaf. İzinli bir aralığın tamamen içinde kalan liste aralığı
    # hiç eklenmez; izinli adres daha darsa nomatch olarak eklenir (hash:net'te en dar eşleşme geçerli)
    local ents allow; ents=$(ag_allow_entries); allow=$(printf '%s\n' "$ents" | awk '$1 == "F" { print $2 }')
    if [ -n "$allow" ]; then
        # izinli aralıklar başlangıca göre sıralı ve birleşik; her liste aralığı için ikili arama
        local alr; alr=$(printf '%s\n' "$allow" | awk -F'[./]' '{ b = (NF == 5 ? $5 : 32); lo = (($1 * 256 + $2) * 256 + $3) * 256 + $4; printf "%.0f %.0f\n", lo, lo + 2 ^ (32 - b) - 1 }' | sort -n -k1,1)
        list=$(printf '%s\n' "$list" | awk -v al="$alr" '
            BEGIN { k = split(al, A, "\n"); n = 0
                    for (i = 1; i <= k; i++) { split(A[i], x, " "); lo = x[1] + 0; hi = x[2] + 0
                        if (n && lo <= H[n] + 1) { if (hi > H[n]) H[n] = hi } else { n++; L[n] = lo; H[n] = hi } } }
            { split($1, s, "/"); split(s[1], p, "."); b = (s[2] == "" ? 32 : s[2] + 0)
              lo = ((p[1] * 256 + p[2]) * 256 + p[3]) * 256 + p[4]; hi = lo + 2 ^ (32 - b) - 1
              a = 1; z = n; j = 0; while (a <= z) { c = int((a + z) / 2); if (L[c] <= lo) { j = c; a = c + 1 } else z = c - 1 }
              if (j && H[j] >= hi) next; print }')
    fi
    ipset create "$SET" hash:net family inet hashsize 4096 maxelem 262144 -exist || return 1
    ipset create "${SET}_t" hash:net family inet hashsize 4096 maxelem 262144 -exist || return 1
    ipset flush "${SET}_t"
    { printf '%s\n' "$list" | awk -v s="${SET}_t" 'NF { print "add " s " " $1 " -exist" }'
      for s in $(cat "$CACHE/self" 2>/dev/null); do [[ "$s" =~ ^[0-9.]+$ ]] && echo "add ${SET}_t $s/32 nomatch -exist"; done
      for s in $allow; do [[ "$s" == */* ]] || s="$s/32"; echo "add ${SET}_t $s nomatch -exist"; done
    } | ipset restore -exist || { log "ipset doldurulamadı"; return 1; }
    ipset swap "${SET}_t" "$SET" && ipset destroy "${SET}_t"
    M -N "$CHAIN" 2>/dev/null; M -F "$CHAIN" || return 1
    # tek portluk izinler: yalnız kapatılan portlarla kesişenler (öteki portlarda zaten bu zincir yok)
    local pr pa pp
    while read -r _ pr pa pp; do
        [ -n "$pa" ] || continue
        if [ "$pp" = all ]; then M -A "$CHAIN" -p "$pr" -s "$pa" -j RETURN || return 1; continue; fi
        case "$pr" in tcp) ag_port_hit "$pp" "$tcp" || continue ;; udp) ag_port_hit "$pp" "$udp" || continue ;; esac
        M -A "$CHAIN" -p "$pr" -s "$pa" --dport "$pp" -j RETURN || return 1
    done < <(printf '%s\n' "$ents" | grep '^P ')
    # her port (ya da a:b aralığı) için ayrı kural; mangle PREROUTING'te hedef port henüz asıl port (nat sonra gelir)
    for s in ${tcp//,/ }; do M -A "$CHAIN" -p tcp --dport "$s" -m conntrack --ctstate NEW -m set --match-set "$SET" src -j DROP || return 1; done
    for s in ${udp//,/ }; do M -A "$CHAIN" -p udp --dport "$s" -m conntrack --ctstate NEW -m set --match-set "$SET" src -j DROP || return 1; done
    order_fix || return 1
    allow_sum > "$CACHE/.allowsum" 2>/dev/null
    return 0
}

case "${1:-}" in
    --apply) apply; exit $? ;;
    # her turda (eklenti): kural yerinde ve Imunify'dan önce mi; sıra bozulmuşsa düzelt. csf.allow değiştiyse 3 döner
    # (muafiyetler yeniden kurulmalı: --sync)
    --check) M -L "$CHAIN" -n >/dev/null 2>&1 || exit 1; order_fix || exit 1
             [ "$(cat "$CACHE/.allowsum" 2>/dev/null)" = "$(allow_sum)" ] || exit 3; exit 0 ;;
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
[ "${NOAPPLY:-0}" = 1 ] && exit 0          # yalnız indir (eklentinin yoklaması: seçili olmayan listeler, CSF'e yazılmaz)
hook_add
apply || exit 1
log "uygulandı: $(ipset list -t "$SET" 2>/dev/null | awk -F': ' '/^Number of entries/ { print $2 }') aralık"
exit 0
