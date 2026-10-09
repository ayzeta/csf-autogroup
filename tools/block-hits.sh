#!/bin/bash
# CSF Auto-Group — banlı blokların "hâlâ deneniyor mu" sayacı.
#
# Bir blok banlanınca güvenlik duvarı ondan gelen bağlantıları kapıda düşürür; lfd o denemeleri hiç görmez, CSF de
# banlı adres başına sayaç tutmaz (LF_IPSET'te bütün banlar tek kümede, tek toplam sayaç). Bu araç csf.deny'deki
# aralıkları blok başına sayaçlı bir ipset'e (ag_hits) koyar ve LOCALINPUT'un başına EYLEMSİZ bir kural ekler: kural
# hiçbir bağlantıyı engellemez ya da geçirmez, yalnız sayar. Eklenti her turda sayaçları okuyup paket gelen bloğa
# "son deneme" tarihi yazar; eski blok temizliği yakın zamanda denenen bloğu kaldırmaz.
#
# CSF her yeniden yüklemede (csf -r) kuralı da kümeyi de siler (gerçek CSF 16.33 ile ölçüldü, 2026-10-09);
# /etc/csf/csfpost.sh'taki tek satır (--apply) ikisini csf.deny'den yeniden kurar. Normalde eklenti yönetir:
#   block-hits.sh --sync     kümeyi ve kuralı kur / güncelle + csfpost.sh satırını denetle
#   block-hits.sh --apply    yalnız kümeyi ve kuralı kur (csfpost.sh bunu çağırır)
#   block-hits.sh --read     paket görülen aralıklar: "CIDR PAKET" satırları
#   block-hits.sh --remove   kuralı, kümeyi ve csfpost.sh satırını kaldır
set -u
DENY="${DENY:-/etc/csf/csf.deny}"
CSF_DIR="${CSF_DIR:-/etc/csf}"
LOG_FILE="${LOG_FILE:-/var/log/csf_autogroup.log}"
SET=ag_hits MARK="# csf_autogroup hits"
POST="$CSF_DIR/csfpost.sh"
SELF_PATH="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/$(basename "$0")"
RULE=(LOCALINPUT ! -i lo -m set --match-set "$SET" src)

log() { printf '[%s] block-hits: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE" 2>/dev/null; }
have() { command -v ipset >/dev/null 2>&1 && command -v iptables >/dev/null 2>&1; }

hook_add() {     # csfpost.sh'a tek satır (kiralık liste aracıyla aynı kalıp; Imunify'nin ipset_sync satırı en sonda kalır)
    local line="[ -r \"$SELF_PATH\" ] && DENY=\"$DENY\" LOG_FILE=\"$LOG_FILE\" bash \"$SELF_PATH\" --apply $MARK"
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
apply() {        # csf.deny'deki IPv4 aralıklarıyla (ana dosya, düz satır) kümeyi yeniden kur; kural LOCALINPUT'un başında
    have || return 1
    local tmp n
    tmp=$(mktemp) || return 1
    { echo "create ${SET}_t hash:net counters -exist"; echo "flush ${SET}_t"
      awk '{ t = $1 } t ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/(1[6-9]|2[0-9]|3[0-2])$/ { print "add '"${SET}_t"' " t " -exist" }' "$DENY" 2>/dev/null
    } > "$tmp"
    n=$(grep -c '^add ' "$tmp")
    ipset restore < "$tmp" 2>/dev/null || { rm -f "$tmp"; ipset destroy "${SET}_t" 2>/dev/null; log "küme kurulamadı"; return 1; }
    rm -f "$tmp"
    ipset create "$SET" hash:net counters -exist 2>/dev/null
    ipset swap "${SET}_t" "$SET" && ipset destroy "${SET}_t" 2>/dev/null
    iptables -C "${RULE[@]}" 2>/dev/null || iptables -I "${RULE[0]}" 1 "${RULE[@]:1}"
    log "uygulandı: $n aralık"
}
remove() {
    while iptables -D "${RULE[@]}" 2>/dev/null; do :; done
    ipset destroy "$SET" 2>/dev/null; ipset destroy "${SET}_t" 2>/dev/null
    hook_del; log "kaldırıldı"
}
case "${1:-}" in
    --apply)  apply ;;
    --sync)   apply && hook_add ;;
    --read)   have && ipset list "$SET" 2>/dev/null | awk '$2 == "packets" && $3 > 0 { print $1, $3 }' ;;
    --remove) remove ;;
    *) echo "kullanım: $0 --sync | --apply | --read | --remove" >&2; exit 2 ;;
esac
