#!/bin/bash
# CSF Auto-Group — yönlendirilen bağlantılarda CSF banlarını koru.
#
# Imunify360, gri / splash / captcha listesindeki adreslerin web ve cPanel trafiğini (80, 443, 2082–2096) nat'ta kendi
# WebShield portlarına çevirir ve INPUT zincirinin başındaki kendi zincirinde, CSF'ten ÖNCE kabul eder. Port bakan
# banlar (csf.deny'deki kısmi banlar "tcp|in|d=80,443|s=…", CC_DENY_PORTS'taki sağlayıcı / ülke banları) yönlendirilen
# bağlantıda artık 52223/52224'ü gördüğü için eşleşmez: böyle banlı bir adres JavaScript doğrulamasını geçince sitelere
# ulaşabiliyordu (sunucuda ölçüldü 2026-10-10, tools/ban-leak.sh). Tam banlar (kalıcı, geçici, blok, "her şey") bundan
# etkilenmez: port bakmazlar ve Imunify yalnız bağlantının ilk paketini kabul eder, sonrakiler CSF'te düşer.
#
# Bu araç INPUT zincirinin en başına tek bir zincir koyar: yalnız hedefi nat'ta değiştirilmiş (DNAT) gelen bağlantılarda,
# önce CSF'in izin listesi (ALLOWIN; izinli adres geçer), sonra port banları yönlendirmeden önceki porta göre
# (--ctorigdstport). Yönlendirilmemiş trafiğe dokunmaz; o zaten CSF'ten geçiyor. Sunucunun kendi açtığı bağlantıların
# cevaplarına da dokunmaz (yalnız bağlantının gelen yönü).
#
# CSF her yeniden başlatmada zincirleri sıfırlar; kural /etc/csf/csfpost.sh'taki tek satırla (--apply) geri kurulur.
# Eklenti her turda --check ile sırayı ve csf.deny / csf.conf değişikliğini denetler.
#   ban-guard.sh --apply | --sync | --check | --remove
set -u
CSF_DIR="${CSF_DIR:-/etc/csf}"
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
STATE="${STATE:-/var/lib/csf_autogroup/guard.sum}"
CHAIN=AG_GUARD MARK="# csf_autogroup guard" OWN="AG_GUARD|AG_CLOUD"
POST="$CSF_DIR/csfpost.sh"
SELF_PATH="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "ban-guard: $1" >> "$LOG_FILE" 2>/dev/null; }
conf() { sed -n "s/^$1 *= *\"\(.*\)\".*/\1/p" "$CSF_DIR/csf.conf" 2>/dev/null | head -n 1 | tr -d ' '; }
# kuralların kaynağı: csf.deny'deki gelişmiş TCP satırları ve CC_DENY_PORTS ayarları (değişince yeniden kurulur)
src_sum() { { grep -E '^tcp\|in\|' "$CSF_DIR/csf.deny" 2>/dev/null; conf CC_DENY; conf CC_DENY_PORTS; conf CC_DENY_PORTS_TCP; } | cksum | cut -d' ' -f1; }
have() { iptables -L "$1" -n >/dev/null 2>&1; }

jump_del() { while iptables -D INPUT ! -i lo -j "$CHAIN" 2>/dev/null; do :; done; }
rules_del() { jump_del; iptables -F "$CHAIN" 2>/dev/null; iptables -X "$CHAIN" 2>/dev/null; return 0; }
order_ok() {     # 0: atlama INPUT'ta tek; önünde yalnız eklentinin kendi zincirleri (kiralık liste) var
    local s n
    s=$(iptables -S INPUT 2>/dev/null | grep -- '^-A INPUT ')
    n=$(printf '%s\n' "$s" | grep -n -- "-j $CHAIN\$" | cut -d: -f1)
    [ -n "$n" ] && [ "$(printf '%s\n' "$n" | grep -c .)" -eq 1 ] || return 1
    [ "$n" -eq 1 ] && return 0
    ! printf '%s\n' "$s" | head -n $(( n - 1 )) | grep -vqE -- "-j ($OWN)\$"
}
order_fix() {
    have "$CHAIN" || return 1
    order_ok && return 0
    jump_del; iptables -I INPUT 1 ! -i lo -j "$CHAIN" || { log "INPUT zincirine kural eklenemedi"; return 1; }
    log "kural INPUT zincirinin başına alındı"
}
apply() {
    command -v iptables >/dev/null 2>&1 || return 1
    have LOCALINPUT || { log "CSF yüklü değil (LOCALINPUT yok)"; return 1; }
    iptables -N "$CHAIN" 2>/dev/null; iptables -F "$CHAIN" || return 1
    # yalnız hedefi değiştirilmiş (DNAT) bağlantının gelen yönü
    iptables -A "$CHAIN" -m conntrack ! --ctstate DNAT -j RETURN
    iptables -A "$CHAIN" -m conntrack --ctdir REPLY -j RETURN
    # 1) CSF'in izin listesi önce: izinli adres geçer (CSF de böyle yapar)
    have ALLOWIN && iptables -A "$CHAIN" -j ALLOWIN
    # 2a) kısmi banlar (csf.deny: tcp|in|d=PORTLAR|s=ARALIK): yönlendirmeden önceki port
    local l s d p n=0 c cc ports
    while IFS= read -r l; do
        l="${l%%#*}"; l="${l//[[:space:]]/}"
        [[ "$l" =~ \|s=([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?) ]] || continue; s="${BASH_REMATCH[1]}"
        [[ "$l" =~ \|d=([0-9,_:]+) ]] || continue; d="${BASH_REMATCH[1]//_/:}"
        for p in ${d//,/ }; do iptables -A "$CHAIN" -p tcp -s "$s" -m conntrack --ctorigdstport "$p" -j DROP && n=$((n + 1)); done
    done < <(grep -E '^tcp\|in\|' "$CSF_DIR/csf.deny" 2>/dev/null)
    # 2b) port listesiyle banlı sağlayıcı / ülke kümeleri (CC_DENY_PORTS × CC_DENY_PORTS_TCP)
    ports=$(conf CC_DENY_PORTS_TCP)
    if [ -n "$ports" ]; then
        for c in $(conf CC_DENY_PORTS | tr ',' ' '); do
            cc="cc_${c,,}"; ipset list -n "$cc" >/dev/null 2>&1 || continue
            for p in ${ports//,/ }; do iptables -A "$CHAIN" -p tcp -m set --match-set "$cc" src -m conntrack --ctorigdstport "${p//_/:}" -j DROP && n=$((n + 1)); done
        done
    fi
    # tam banlar (kalıcı / geçici / blok, "her şey" sağlayıcı / ülke) burada gerekmez: CSF onları port bakmadan uygular ve
    # Imunify yalnız bağlantının ilk paketini kabul ettiği için sonraki paketler CSF'in zincirinde düşer (WSL'de sınandı)
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
    # her turda: kural yerinde ve önde mi (sıra bozulmuşsa düzelt); kısmi ban / CC_DENY_PORTS değiştiyse 3 (yeniden kur)
    --check) have "$CHAIN" || exit 1; grep -qF "$MARK" "$POST" 2>/dev/null || exit 1; order_fix || exit 1
             [ "$(cat "$STATE" 2>/dev/null)" = "$(src_sum)" ] || exit 3; exit 0 ;;
    --remove) rules_del; hook_del; rm -f "$STATE"; log "kaldırıldı"; exit 0 ;;
    *) echo "kullanım: $0 --apply | --sync | --check | --remove"; exit 2 ;;
esac
