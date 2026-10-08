#!/bin/bash
# Terim tutarlılığı: her kavramın panelde, mailde ve günlükte tek adı olsun. Aşağıdaki eski / eş anlamlı adlar
# (soldaki) kullanıcıya görünen metinlerde geçerse hata verir; sağdaki kullanılacak ad. Yeni bir kavram adı
# değiştiğinde eskisini buraya ekleyin. Kod yorumları değil, metin sözlükleri (DICT, M_*) taranır.
#
#   bash tests/metin/calistir.sh
set -u
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
JS="$REPO/whm/assets/ag.js"; SH="$REPO/csf_autogroup.sh"
YASAK=(
  "Dikkat edilecekler|Kontrol edilecekler"
  "Bulut listeleri|Kiralık sunucular"
  "Bulut listesi|kiralık sunucu listesi"
  "bulut listesi|kiralık sunucu listesi"
  "Diğer bloklar|Elle eklenenler"
  "grup banı|blok banı"
  "cloud list|rented-server list"
  "Other blocks|Added by hand"
)
# kullanıcıya görünen metinler: ag.js sözlüğündeki 'anahtar: "metin"' değerleri ve motorun M_* değişkenleri
texts() {
  grep -oE "[a-z_0-9]+: '([^'\\\\]|\\\\.)*'" "$JS"
  grep -oE '^ *M_[A-Z0-9_]+="[^"]*"' "$SH"
}
bad=0
for e in "${YASAK[@]}"; do
  old="${e%%|*}"; new="${e#*|}"
  hits=$(texts | grep -F "$old")
  [ -z "$hits" ] && continue
  bad=$((bad + 1)); echo "  ✗ «$old» yerine «$new»:"; printf '%s\n' "$hits" | cut -c1-140 | sed 's/^/      /'
done
if [ "$bad" -eq 0 ]; then echo "Terim tutarlılığı: eski ad kalmadı"; exit 0; fi
echo "Terim tutarlılığı: $bad eski ad hâlâ kullanılıyor"; exit 1
