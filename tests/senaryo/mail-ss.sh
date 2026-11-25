#!/bin/bash
# Posta portları (mail_ports): ss -ltnp bir durum çıktısında BİR kez çalışır (sunucuda tek çağrı 623 ms ölçüldü; 1.15.127'ye kadar Exim
# ve Dovecot için iki kez), sonuç MAILP_TTL saniye dosyadan okunur, ayrıştırma eski süreç başına awk'la aynı portları verir.
# Örnek satırlar ss'in "LISTEN Recv-Q Send-Q Yerel Karşı Süreç" biçiminde (sunucuda ölçülen exim / dovecot / litespeed satırlarıyla aynı).
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
SAYAC_FILE="$T/counter"; EXIM_CONF="$T/yok.conf"; unset SIM_ROOT
eval "$(awk '/^MAILP_SS=""/{f=1} f{print} f && /^svc_ports\(\) \{/{exit}' "$REPO/csf_autogroup.sh" | sed '$d')"
declare -A MAILP_MEMO=()
cat_ss() { printf '%s\n' \
  'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process' \
  'LISTEN 0      1024         0.0.0.0:587        0.0.0.0:*    users:(("exim",pid=1301,fd=6))' \
  'LISTEN 0      1024         0.0.0.0:25         0.0.0.0:*    users:(("exim",pid=1301,fd=3))' \
  'LISTEN 0      1024         0.0.0.0:465        0.0.0.0:*    users:(("exim",pid=1301,fd=5))' \
  'LISTEN 0      1024         0.0.0.0:26         0.0.0.0:*    users:(("exim",pid=1301,fd=4))' \
  'LISTEN 0      100          0.0.0.0:993        0.0.0.0:*    users:(("dovecot",pid=990,fd=40))' \
  'LISTEN 0      100          0.0.0.0:110        0.0.0.0:*    users:(("dovecot",pid=990,fd=22))' \
  'LISTEN 0      100             [::]:143           [::]:*    users:(("dovecot",pid=990,fd=27))' \
  'LISTEN 0      100          0.0.0.0:995        0.0.0.0:*    users:(("dovecot",pid=990,fd=41))' \
  'LISTEN 0      100          0.0.0.0:4190       0.0.0.0:*    users:(("dovecot",pid=990,fd=49))' \
  'LISTEN 0      4096         0.0.0.0:443        0.0.0.0:*    users:(("litespeed",pid=2201,fd=11))' \
  'LISTEN 0      128          0.0.0.0:2087       0.0.0.0:*    users:(("cpsrvd",pid=800,fd=4))'; }
ss() { echo x >> "$T/ss.calls"; cat_ss; }
eski() { cat_ss | awk -v pr="$1" '$1 == "LISTEN" && index($0, "users:((\"" pr "\"") { a = $4; sub(/.*:/, "", a); if (a ~ /^[0-9]+$/) print a }' | sort -un | paste -sd, -; }
F=0; N=0
ok() { N=$((N + 1)); if [ "$2" = "$3" ]; then echo "  ✓ $1: $2"; else F=$((F + 1)); echo "  ✗ $1: $2 (beklenen $3)"; fi; }
mail_ports smtp; a="$REPLY"; mail_ports mread; b="$REPLY"
ok "Exim portları (eski ayrıştırmayla aynı)" "$a" "$(eski exim)"
ok "Dovecot portları (eski ayrıştırmayla aynı)" "$b" "$(eski dovecot)"
ok "bir süreçte ss çağrısı" "$(wc -l < "$T/ss.calls")" 1
# yeni süreç (dosya taze): ss çağrılmaz
MAILP_MEMO=(); MAILP_SS=""; MAILP_SSD=""; mail_ports mread
ok "taze dosyayla ikinci süreç: ss çağrısı yok, aynı portlar" "$(wc -l < "$T/ss.calls") $REPLY" "1 $b"
# süresi geçmiş dosya: yeniden okunur
touch -d "@$(( $(date +%s) - MAILP_TTL - 5 ))" "$T/mailports"
MAILP_MEMO=(); MAILP_SS=""; MAILP_SSD=""; mail_ports smtp
ok "süresi geçmiş dosya: ss yeniden çalışır" "$(wc -l < "$T/ss.calls") $REPLY" "2 $a"
echo "posta portları: $N durum, $F beklenmeyen"; [ "$F" -eq 0 ]
