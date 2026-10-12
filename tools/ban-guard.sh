#!/bin/bash
# CSF Auto-Group — yönlendirilen bağlantılarda CSF'in porta bağlı banlarını koru.
#
# Imunify360, gri / splash / captcha listesindeki adreslerin web ve cPanel trafiğini (80, 443, 2082–2096) nat'ta kendi
# WebShield portlarına çevirir ve INPUT zincirinin başındaki kendi zincirinde, CSF'ten ÖNCE kabul eder. Port bakan
# banlar (csf.deny'deki kısmi banlar "tcp|in|d=80,443|s=…", CC_DENY_PORTS'taki sağlayıcı / ülke banları) yönlendirilen
# bağlantıda 52223/52224'ü gördüğü için eşleşmez: böyle banlı bir adres JavaScript doğrulamasını geçince sitelere
# ulaşabiliyordu (sunucuda ölçüldü 2026-10-10, tools/ban-leak.sh). Tam banlar (kalıcı, geçici, blok, "her şey") bundan
# etkilenmez: port bakmazlar ve Imunify yalnız bağlantının ilk paketini kabul eder, sonrakiler CSF'te düşer.
#
# Kural mangle tablosunun PREROUTING zincirinde durur: nat yönlendirmesinden ÖNCE çalışır (hedef port henüz asıl port)
# ve Imunify360'ın INPUT'taki zinciriyle sıra yarışına girmez (Imunify kendi zincirini INPUT'un başına yeniden koyuyor;
# INPUT'ta kalan kural bir dakika içinde ikinci sıraya düşüyordu, sunucuda ölçüldü 2026-10-11). Yalnız yeni gelen
# bağlantılar: önce izin listesi (csf.allow + Include ettikleri, izinli servisler, csf'nin geçici izinleri; ag_allow
# kümesi — CSF de izni bandan önce uygular), sonra kısmi banlar ve CC_DENY_PORTS kümeleri. CSF'in kendisi de bu
# trafiği zaten düşürür; burada yalnız Imunify'ın yönlendirmesinden önce yakalanır. Sunucunun kendi açtığı
# bağlantıların cevaplarına dokunmaz (yalnız NEW).
#
# CSF her yeniden başlatmada zincirleri sıfırlar; kural /etc/csf/csfpost.sh'taki tek satırla (--apply) geri kurulur.
# Eklenti her turda --check ile kuralı ve kaynakların (csf.deny, csf.conf, izin listeleri) değişmediğini denetler.
#   ban-guard.sh --apply | --sync | --check | --remove
set -u
CSF_DIR="${CSF_DIR:-/etc/csf}"
CSF_VAR="${CSF_VAR:-/var/lib/csf}"
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
STATE="${STATE:-/var/lib/csf_autogroup/guard.sum}"
CHAIN=AG_GUARD MARK="# csf_autogroup guard" OWN="AG_GUARD|AG_CLOUD" ASET=ag_allow
POST="$CSF_DIR/csfpost.sh"
SELF_PATH="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "ban-guard: $1" >> "$LOG_FILE" 2>/dev/null; }
conf() { sed -n "s/^$1 *= *\"\(.*\)\".*/\1/p" "$CSF_DIR/csf.conf" 2>/dev/null | head -n 1 | tr -d ' '; }
M() { iptables -t mangle "$@"; }
have() { M -L "$1" -n >/dev/null 2>&1; }
# izin listesi kaynakları: csf.allow ve Include ettikleri, izinli servisler, CSF'in geçici izinleri
allow_files() {
    printf '%s\n' "$CSF_DIR/csf_autogroup.services.allow" "$CSF_VAR/csf.tempallow"
    [ -r "$CSF_DIR/csf.allow" ] || return 0
    printf '%s\n' "$CSF_DIR/csf.allow"
    awk '/^[[:space:]]*Include[[:space:]]/ { print $2 }' "$CSF_DIR/csf.allow"
}
allow_list() {   # IP/CIDR'ler; gelişmiş satırlardan s=, tempallow'da 2. alan; /8'den geniş aralık izin değil port kuralıdır
    local f
    while IFS= read -r f; do [ -r "$f" ] && cat "$f"; done < <(allow_files) | sed 's/#.*//' | awk -F'[ \t]+' '
        { a = ""; l = $0; if ($1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/) a = $1
          else if (match(l, /(^|\|)s=[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?/)) { a = substr(l, RSTART, RLENGTH); sub(/.*s=/, "", a) }
          else if (match(l, /^[0-9]+\|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\|/)) { split(l, x, "|"); a = x[2] }
          if (a == "") next; n = split(a, p, "/"); if (n == 2 && p[2] + 0 < 8) next; print a }' | sort -u
}
# kuralların kaynağı: csf.deny'deki gelişmiş TCP satırları, CC_DENY_PORTS ayarları, izin listeleri (değişince yeniden kurulur)
src_sum() {
    local f
    { grep -E '^tcp\|in\|' "$CSF_DIR/csf.deny" 2>/dev/null; conf CC_DENY_PORTS; conf CC_DENY_PORTS_TCP
      while IFS= read -r f; do [ -r "$f" ] && cat "$f"; done < <(allow_files); } | cksum | cut -d' ' -f1
}

jump_del() {     # bütün atlamalar: mangle PREROUTING (şimdiki) ve eski sürümün filter INPUT'u
    while M -D PREROUTING ! -i lo -j "$CHAIN" 2>/dev/null; do :; done
    while iptables -D INPUT ! -i lo -j "$CHAIN" 2>/dev/null; do :; done
}
rules_del() {
    jump_del
    M -F "$CHAIN" 2>/dev/null; M -X "$CHAIN" 2>/dev/null
    iptables -F "$CHAIN" 2>/dev/null; iptables -X "$CHAIN" 2>/dev/null       # eski sürüm (filter)
    ipset destroy "$ASET" 2>/dev/null; ipset destroy "${ASET}_t" 2>/dev/null
    return 0
}
order_ok() {     # 0: atlama mangle PREROUTING'te tek; önünde yalnız eklentinin kendi zincirleri var
    local s n
    s=$(M -S PREROUTING 2>/dev/null | grep -- '^-A PREROUTING ')
    n=$(printf '%s\n' "$s" | grep -n -- "-j $CHAIN\$" | cut -d: -f1)
    [ -n "$n" ] && [ "$(printf '%s\n' "$n" | grep -c .)" -eq 1 ] || return 1
    [ "$n" -eq 1 ] && return 0
    ! printf '%s\n' "$s" | head -n $(( n - 1 )) | grep -vqE -- "-j ($OWN)\$"
}
order_fix() {
    have "$CHAIN" || return 1
    order_ok && return 0
    jump_del; M -I PREROUTING 1 ! -i lo -j "$CHAIN" || { log "mangle PREROUTING zincirine kural eklenemedi"; return 1; }
    log "kural mangle PREROUTING zincirinin başına alındı"
}
apply() {
    command -v iptables >/dev/null 2>&1 && command -v ipset >/dev/null 2>&1 || return 1
    iptables -L LOCALINPUT -n >/dev/null 2>&1 || { log "CSF yüklü değil (LOCALINPUT yok)"; return 1; }
    # eski sürümün filter INPUT'taki zinciri kalkar
    while iptables -D INPUT ! -i lo -j "$CHAIN" 2>/dev/null; do :; done; iptables -F "$CHAIN" 2>/dev/null; iptables -X "$CHAIN" 2>/dev/null
    # izin kümesi (boşluksuz takas)
    ipset create "$ASET" hash:net family inet hashsize 4096 maxelem 262144 -exist || return 1
    ipset create "${ASET}_t" hash:net family inet hashsize 4096 maxelem 262144 -exist || return 1
    ipset flush "${ASET}_t"
    allow_list | awk -v s="${ASET}_t" '{ print "add " s " " $1 " -exist" }' | ipset restore -exist || { log "izin kümesi doldurulamadı"; return 1; }
    ipset swap "${ASET}_t" "$ASET" && ipset destroy "${ASET}_t"
    M -N "$CHAIN" 2>/dev/null; M -F "$CHAIN" || return 1
    M -A "$CHAIN" -m conntrack ! --ctstate NEW -j RETURN
    M -A "$CHAIN" -m set --match-set "$ASET" src -j RETURN
    # kısmi banlar (csf.deny: tcp|in|d=PORTLAR|s=ARALIK); /8'den geniş kaynak port kuralıdır, alınmaz
    local l s d p n=0 c cc ports
    while IFS= read -r l; do
        l="${l%%#*}"; l="${l//[[:space:]]/}"
        [[ "$l" =~ \|s=([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/([0-9]+))?) ]] || continue; s="${BASH_REMATCH[1]}"
        [ -n "${BASH_REMATCH[3]}" ] && [ "${BASH_REMATCH[3]}" -lt 8 ] && continue
        [[ "$l" =~ \|d=([0-9,_:]+) ]] || continue; d="${BASH_REMATCH[1]//_/:}"
        for p in ${d//,/ }; do M -A "$CHAIN" -p tcp -s "$s" --dport "$p" -j DROP && n=$((n + 1)); done
    done < <(grep -E '^tcp\|in\|' "$CSF_DIR/csf.deny" 2>/dev/null)
    # port listesiyle banlı sağlayıcı / ülke kümeleri (CC_DENY_PORTS × CC_DENY_PORTS_TCP)
    ports=$(conf CC_DENY_PORTS_TCP)
    if [ -n "$ports" ]; then
        for c in $(conf CC_DENY_PORTS | tr ',' ' '); do
            cc="cc_${c,,}"; ipset list -n "$cc" >/dev/null 2>&1 || continue
            for p in ${ports//,/ }; do M -A "$CHAIN" -p tcp -m set --match-set "$cc" src --dport "${p//_/:}" -j DROP && n=$((n + 1)); done
        done
    fi
    order_fix || return 1
    src_sum > "$STATE" 2>/dev/null
    return 0
}
hook_add() {     # csfpost.sh'a tek satır (kiralık liste satırıyla aynı yöntem: Imunify satırının önüne)
    local line="[ -r \"$SELF_PATH\" ] && STATE=\"$STATE\" LOG_FILE=\"$LOG_FILE\" bash \"$SELF_PATH\" --apply $MARK"
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
    grep -vF "$MARK" "$POST" > "$POST.ag.tmp" && cat "$POST.ag.tmp" > "$POST"; rm -f "$POST.ag.tmp"
    log "csfpost.sh'tan satır kaldırıldı"
}
case "${1:-}" in
    --apply) apply; exit $? ;;
    --sync) hook_add; apply; exit $? ;;
    # her turda: kural yerinde ve önde mi (sıra bozulmuşsa düzelt); kaynaklar değiştiyse 3 (yeniden kur)
    --check) have "$CHAIN" || exit 1; grep -qF "$MARK" "$POST" 2>/dev/null || exit 1; order_fix || exit 1
             [ "$(cat "$STATE" 2>/dev/null)" = "$(src_sum)" ] || exit 3; exit 0 ;;
    --remove) rules_del; hook_del; rm -f "$STATE"; log "kaldırıldı"; exit 0 ;;
    *) echo "kullanım: $0 --apply | --sync | --check | --remove"; exit 2 ;;
esac
