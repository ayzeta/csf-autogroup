#!/bin/bash
# mangle PREROUTING sırası: araçların (cloud-ban, ban-guard, block-hits) sıra denetimi ve yeniden yerleştirmesi, taklit iptables ile.
# Sunucudaki iptables-nft (lin, 2026-11-08) eylemsiz set kuralını -S çıktısında SONDA BOŞLUKLA yazıyordu:
#   "-A PREROUTING ! -i lo -m set --match-set ag_hits src "
# Araçlar satırı "src$" ile aradığı için sayacı tanımıyor, her turda kurallarını silip yeniden ekliyordu; silme ile ekleme
# arasında kiralık liste ve ban koruması devre dışıydı. Beklenen: sondaki boşluk fark etmez; yeniden yerleştirme önce ekler.
#   bash tests/senaryo/mangle-sira.sh   (birim.sh de çağırır)
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"; T="$REPO/tools"
F=0; N=0
R=(); OPS=""
iptables() {     # taklit: yalnız mangle PREROUTING (-S, -I, -D numara / kural); -C hep yok; öteki komutlar sessiz başarı
    local a=("$@") i
    [ "${a[0]}" = -w ] && a=("${a[@]:1}")
    [ "${a[0]}" = -t ] && a=("${a[@]:2}")
    case "${a[0]} ${a[1]}" in
        "-S PREROUTING") echo "-P PREROUTING ACCEPT"
            for i in "${R[@]}"; do if [ "$i" = "! -i lo -m set --match-set ag_hits src" ]; then echo "-A PREROUTING $i "; else echo "-A PREROUTING $i"; fi; done ;;
        "-I PREROUTING") local p="${a[2]}" r="${a[*]:3}"; R=("${R[@]:0:p-1}" "$r" "${R[@]:p-1}"); OPS+="I$p " ;;
        "-D PREROUTING") if [[ "${a[2]}" =~ ^[0-9]+$ ]]; then R=("${R[@]:0:a[2]-1}" "${R[@]:a[2]}"); OPS+="D${a[2]} "
                         else local r="${a[*]:2}" j; for j in "${!R[@]}"; do [ "${R[$j]}" = "$r" ] && { R=("${R[@]:0:j}" "${R[@]:j+1}"); OPS+="D "; return 0; }; done; return 1; fi ;;
        "-C "*|"-D "*) return 1 ;;       # öteki zincirlerde (INPUT, LOCALINPUT) silinecek kural yok: silme döngüleri biter
        *) return 0 ;;
    esac
}
fn() { awk -v n="$2" '$0 ~ "^"n"\\(\\) \\{" {f=1} f{print} f && /^}$/{exit}' "$1"; }   # dosyadan tek işlev
log() { :; }
eval "$(fn "$T/allow-list.sh" hits_pos)"; eval "$(fn "$T/allow-list.sh" ag_jump_place)"
M() { iptables -t mangle "$@"; }
HITS="! -i lo -m set --match-set ag_hits src"; CL="! -i lo -j AG_CLOUD"; GU="! -i lo -j AG_GUARD"
ok() { N=$((N + 1)); if [ "$2" = "$3" ]; then echo "  ✓ $1"; else F=$((F + 1)); echo "  ✗ $1: «$2» (beklenen «$3»)"; fi; }
sira() { local i o=""; for i in "${R[@]}"; do case "$i" in "$HITS") o+="hits ";; "$CL") o+="cloud ";; "$GU") o+="guard ";; *) o+="? ";; esac; done; echo "${o% }"; }

R=("$HITS" "$CL" "$GU"); ok "sondaki boşluklu sayaç başta: hits_pos 2" "$(hits_pos)" 2
# cloud-ban ve ban-guard sıra denetimi: sunucudaki sıra (guard, hits, cloud) da doğru sayılır (önlerinde yalnız eklentinin kuralları)
eval "$(fn "$T/cloud-ban.sh" order_ok)"; CHAIN=AG_CLOUD
R=("$GU" "$HITS" "$CL"); order_ok; ok "cloud-ban: önünde sondaki boşluklu sayaç varken sıra doğru" "$?" 0
R=("$HITS" "$CL" "$GU"); order_ok; ok "cloud-ban: sayaç başta, sıra doğru" "$?" 0
R=("-p tcp --dport 9 -j ACCEPT" "$CL"); order_ok; ok "cloud-ban: önünde yabancı kural varken sıra yanlış" "$?" 1
eval "$(fn "$T/ban-guard.sh" order_ok)"; CHAIN=AG_GUARD OWN="AG_GUARD|AG_CLOUD"
R=("$HITS" "$CL" "$GU"); order_ok; ok "ban-guard: önünde sondaki boşluklu sayaç varken sıra doğru" "$?" 0
R=("-p tcp --dport 9 -j ACCEPT" "$GU"); order_ok; ok "ban-guard: önünde yabancı kural varken sıra yanlış" "$?" 1
# yeniden yerleştirme: önce ekle, sonra eski kopyayı sil (arada kural hiç eksik değil)
R=("-p tcp --dport 9 -j ACCEPT" "$HITS" "$CL" "$GU"); OPS=""; ag_jump_place AG_CLOUD 1
ok "yeniden yerleştirme önce ekler, sonra eskiyi siler" "$OPS" "I1 D4 "
ok "yeniden yerleştirmeden sonra tek kopya" "$(sira)" "cloud ? hits guard"
# block-hits: sondaki boşluklu sayaç başta ve tekken dokunulmaz; değilse önce eklenir, eskisi silinir
SET=ag_hits; RULE=(PREROUTING ! -i lo -m set --match-set "$SET" src); eval "$(fn "$T/block-hits.sh" rule_first)"
R=("$HITS" "$CL" "$GU"); OPS=""; rule_first; ok "block-hits: sondaki boşluklu sayaç başta → dokunulmaz" "$OPS" ""
R=("$GU" "$HITS" "$CL"); OPS=""; rule_first; ok "block-hits: sayaç başta değil → önce ekle, sonra sil" "$OPS" "I1 D3 "
ok "block-hits: tek sayaç, başta" "$(sira)" "hits guard cloud"
echo "mangle sırası: $N durum, $F beklenmeyen"; [ "$F" -eq 0 ]
