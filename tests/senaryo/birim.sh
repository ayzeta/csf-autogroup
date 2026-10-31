#!/bin/bash
# Motorun küçük yardımcıları, motordan çıkarılarak tek başına sınanır.
#   bash tests/senaryo/birim.sh
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
eval "$(awk '/^port_in\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
F=0; N=0
t() { N=$((N + 1)); if port_in "$1" "$2"; then r=1; else r=0; fi
      if [ "$r" = "$3" ]; then echo "  ✓ port_in $1 «$2» → $r"; else F=$((F + 1)); echo "  ✗ port_in $1 «$2» → $r (beklenen $3)"; fi; }
t 443 ",80,443," 1
t 22 ",80,443," 0
t 1500 ",80,1000:2000," 1
t 2001 ",80,1000:2000," 0
t 30000_35000 ",80,30000:40000," 1
t 30000_35000 ",80,31000:40000," 0
t 30000:35000 ",30000:35000," 1
t abc ",80," 0
# cron ortamı (PATH=/usr/bin:/bin): motor başında /usr/sbin eklenmeli (ipset, iptables orada)
N=$((N + 1)); P=$(env -i PATH=/usr/bin:/bin bash -c "$(sed -n '1,/^VERSION=/p' "$REPO/csf_autogroup.sh")"$'\n''echo "$PATH"')
case ":$P:" in *:/usr/sbin:*) echo "  ✓ cron PATH'inde /usr/sbin eklenir";; *) F=$((F + 1)); echo "  ✗ cron PATH'inde /usr/sbin yok: $P";; esac
# tek tırnaklı programın (awk …) içindeki yorumda kesme işareti tırnağı kapatır; bash -n yakalamaz (dört kez oldu)
for f in "$REPO/csf_autogroup.sh" "$REPO"/tools/*.sh; do
    N=$((N + 1)); k=$(awk -f "$(dirname "$0")/tirnak.awk" "$f" | head -n 1)
    if [ -z "$k" ]; then echo "  ✓ tırnak içi yorumda kesme işareti yok: $(basename "$f")"; else F=$((F + 1)); echo "  ✗ $(basename "$f") $k"; fi
done
echo "Birim: $N durum, $F beklenmeyen"; [ "$F" -eq 0 ]
