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
  "To review|Needs review"
  "Aktif blok ban|Aktif aralık ban"
  "Active block ban|Active range ban"
  "saldırgan|ihlal eden IP"
  "Saldırgan|İhlal eden IP"
  "saldır|ihlal"
  "Saldır|İhlal"
  "attacker|offending IP"
  "Attacker|Offending IP"
  "attack|violation"
  "Attack|Violation"
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
# Türkçe panel metinlerinde CSF'in İngilizce terimi tek başına geçmez: "do not delete" yalnız "silinmez" açıklamasıyla
tr_end=$(grep -n "^    en: {" "$JS" | head -n 1 | cut -d: -f1)
hits=$(head -n "${tr_end:-1}" "$JS" | grep -oE "[a-z_0-9]+: '([^'\\\\]|\\\\.)*'" | grep -i "do not delete" | grep -vi "silinmez")
if [ -n "$hits" ]; then bad=$((bad + 1)); echo "  ✗ «do not delete» Türkçe metinde «silinmez» açıklaması olmadan:"; printf '%s\n' "$hits" | cut -c1-140 | sed 's/^/      /'; fi
# eklentinin susturma işlemi "yoksay / ignore" demez: o sözcük yalnız CSF / lfd anlamında (csf.ignore, IGNORE_ALLOW, lfd durumları)
SUS='s_review_h|s_ignored|s_ignored_h|ev_manual_ignore|ev_manual_unignore|st_ign|st_ign_f|w_ignore|w_unignore|ignore|unignore|ign_who|ign_forever_l|m_ignore_t|m_ignore_b|m_ignchg_t|m_ignchg_b|l_ign|ic_review_w|col_until|col_by'
hits=$( { grep -oE "(^|[^a-z_0-9])($SUS): '([^'\\\\]|\\\\.)*'" "$JS"; grep -oE '^ *(M_IGN16|M_A_IGNORED|M_A_IGNORED_F|M_A_UNIGNORED|M_A_NOTIGN|M_S_IGNORED|M_L_IGN)="[^"]*"' "$SH"; } |
  sed "s/^[^:=]*[:=] *//" | grep -iE "oksay|ignor")
if [ -n "$hits" ]; then bad=$((bad + 1)); echo "  ✗ eklentinin susturma metninde «yoksay / ignore» (CSF'in anlamıyla karışır):"; printf '%s\n' "$hits" | cut -c1-140 | sed 's/^/      /'; fi
wp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
node "$(wp "$H/sozluk.js")" "$(wp "$JS")" || bad=$((bad + 1))     # her durum rozeti Terimler'de açıklanmış mı
if [ "$bad" -eq 0 ]; then echo "Terim tutarlılığı: eski ad kalmadı"; exit 0; fi
echo "Terim tutarlılığı: $bad sorun"; exit 1
