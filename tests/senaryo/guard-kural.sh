#!/bin/bash
# ban-guard.sh --apply: CSF'in porta bağlı banlarının hepsi mangle'a kopyalanır — TCP ve UDP (1.15.135). Imunify'ın UDP'yi
# yönlendirip yönlendirmediğine bakılmaz (sunucudan sunucuya değişir; yönlendirmeyen sunucuda kural zararsız). Taklit iptables /
# ipset ile: kurulan -A kuralları sayılır. Eski sürüm udp|in| satırını ve CC_DENY_PORTS_UDP'yi atlıyordu.
#   bash tests/senaryo/guard-kural.sh   (birim.sh çağırır)
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/csf" "$T/bin" "$T/st"
printf '%s\n' 'tcp|in|d=80,443|s=198.51.100.0/24 # csf_autogroup: kısmi' 'udp|in|d=443|s=198.51.100.0/24 # csf_autogroup: kısmi' \
    'udp|in|d=53|s=203.0.113.7 # elle' > "$T/csf/csf.deny"
printf '%s\n' 'CC_DENY_PORTS = "AS64500"' 'CC_DENY_PORTS_TCP = "22"' 'CC_DENY_PORTS_UDP = "443"' > "$T/csf/csf.conf"
: > "$T/csf/csf.allow"
# taklit: iptables her -A kuralını dosyaya yazar, LOCALINPUT var, -S PREROUTING boş; ipset "cc_as64500" kümesini var sayar
# (-D başarısız: ban-guard'ın "kalmayana kadar sil" döngüleri biter)
printf '#!/bin/bash\na="$*"; case "$a" in *"-L LOCALINPUT"*) exit 0;; "-D "*|*" -D "*|"-C "*|*" -C "*) exit 1;; *" -A AG_GUARD "*) echo "${a#*-A AG_GUARD }" >> "%s";; esac; exit 0\n' "$T/kurallar" > "$T/bin/iptables"
printf '#!/bin/bash\ncase "$1 $2 $3" in "list -n cc_as64500") echo cc_as64500;; "list -n "*) exit 1;; esac; exit 0\n' > "$T/bin/ipset"
chmod +x "$T/bin/iptables" "$T/bin/ipset"
PATH="$T/bin:$PATH" CSF_DIR="$T/csf" CSF_VAR="$T/var" STATE="$T/st/guard.sum" LOG_FILE="$T/log" bash "$REPO/tools/ban-guard.sh" --apply >/dev/null 2>&1
F=0
k() { if grep -qxF -- "$1" "$T/kurallar" 2>/dev/null; then echo "  ✓ $2"; else F=1; echo "  ✗ $2: «$1» kurulmadı"; fi; }
k '-p tcp -s 198.51.100.0/24 --dport 443 -j DROP' "kısmi TCP banı kopyalanır"
k '-p udp -s 198.51.100.0/24 --dport 443 -j DROP' "kısmi UDP banı (UDP 443) kopyalanır"
k '-p udp -s 203.0.113.7 --dport 53 -j DROP' "tek IP UDP banı kopyalanır"
k '-p tcp -m set --match-set cc_as64500 src --dport 22 -j DROP' "CC_DENY_PORTS_TCP kopyalanır"
k '-p udp -m set --match-set cc_as64500 src --dport 443 -j DROP' "CC_DENY_PORTS_UDP kopyalanır"
[ "$F" = 0 ] && echo "  ✓ ban-guard TCP ve UDP banlarını kopyalar (5 kural)"
exit "$F"
