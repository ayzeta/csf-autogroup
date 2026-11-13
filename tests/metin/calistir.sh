#!/bin/bash
# Terim tutarlılığı: her kavramın panelde, mailde ve günlükte tek adı olsun. Aşağıdaki eski / eş anlamlı adlar
# (soldaki) kullanıcıya görünen metinlerde geçerse hata verir; sağdaki kullanılacak ad. Yeni bir kavram adı
# değiştiğinde eskisini buraya ekleyin. Kod yorumları değil, metin sözlükleri (DICT, M_*) taranır.
#
#   bash tests/metin/calistir.sh
set -u
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
JS="$REPO/whm/assets/ag.js"; SH="${AG_SH:-$REPO/csf_autogroup.sh}"   # AG_SH: eski motorla sınama
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
  "Review list|Needs review"
  "review list|Needs review"
  "use Ignore (|use Mute ("
  "için Yoksay (|için Sustur ("
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
  grep -oE 'M_[A-Z0-9_]+="[^"]*"' "$SH"   # satırdaki bütün tanımlar (önce yalnız satır başındaki: aynı satırdaki sonrakiler denetim dışıydı)
}
bad=0
for e in "${YASAK[@]}"; do
  old="${e%%|*}"; new="${e#*|}"
  hits=$(texts | grep -F "$old")
  [ -z "$hits" ] && continue
  bad=$((bad + 1)); echo "  ✗ «$old» yerine «$new»:"; printf '%s\n' "$hits" | cut -c1-140 | sed 's/^/      /'
done
# tek terim "izin listesi" / "allow list" (kullanıcı kararı 2026-11-12; önce aynı pencerede "izin listesinde … IP kartı → Beyaz liste"
# yazıyordu). "beyaz liste" / "whitelist" yalnız Imunify360'ın kendi listesini anlatan metinde (ürünün adı) kalır.
hits=$(texts | grep -iE "beyaz list|white-?list" | grep -v "Imunify")
if [ -n "$hits" ]; then bad=$((bad + 1)); echo "  ✗ «beyaz liste / whitelist» yerine «izin listesi / allow list» (Imunify360'ın listesi dışında):"; printf '%s\n' "$hits" | cut -c1-140 | sed 's/^/      /'; fi
# Türkçe panel metinlerinde CSF'in İngilizce terimi tek başına geçmez: "do not delete" yalnız "silinmez" açıklamasıyla
tr_end=$(grep -n "^    en: {" "$JS" | head -n 1 | cut -d: -f1)
hits=$(head -n "${tr_end:-1}" "$JS" | grep -oE "[a-z_0-9]+: '([^'\\\\]|\\\\.)*'" | grep -i "do not delete" | grep -vi "silinmez")
if [ -n "$hits" ]; then bad=$((bad + 1)); echo "  ✗ «do not delete» Türkçe metinde «silinmez» açıklaması olmadan:"; printf '%s\n' "$hits" | cut -c1-140 | sed 's/^/      /'; fi
# eklentinin susturma işlemi "yoksay / ignore" demez: o sözcük yalnız CSF / lfd anlamında (csf.ignore, IGNORE_ALLOW, lfd durumları)
SUS='s_review_h|s_ignored|s_ignored_h|ev_manual_ignore|ev_manual_unignore|st_ign|st_ign_f|w_ignore|w_unignore|ignore|unignore|ign_who|ign_forever_l|m_ignore_t|m_ignore_b|m_ignchg_t|m_ignchg_b|l_ign|ic_review_w|col_until|col_by'
hits=$( { grep -oE "(^|[^a-z_0-9])($SUS): '([^'\\\\]|\\\\.)*'" "$JS"; grep -oE '^ *(M_IGN16|M_A_IGNORED|M_A_IGNORED_F|M_A_UNIGNORED|M_A_NOTIGN|M_S_IGNORED|M_L_IGN)="[^"]*"' "$SH"; } |
  sed "s/^[^:=]*[:=] *//" | grep -iE "oksay|ignor")
if [ -n "$hits" ]; then bad=$((bad + 1)); echo "  ✗ eklentinin susturma metninde «yoksay / ignore» (CSF'in anlamıyla karışır):"; printf '%s\n' "$hits" | cut -c1-140 | sed 's/^/      /'; fi
# motor metinleri: tanımlı her M_* bir yerde kullanılır (ölü metin kalmaz) ve TR / EN kümeleri aynıdır. Dolaylı kullanım
# ("M_SVCN_$k", "M_STEP_${x}" …) önekleriyle sayılır. 1.15.71'de 6 ölü metin vardı (eski geçici /16 akışı, M_SVC_APPLIED).
dyn=$(grep -oE 'M_[A-Z0-9_]*_\$\{?[a-zA-Z_]' "$SH" | sed -E 's/\$.*$//' | sort -u | paste -sd'|' -)
defs=$(grep -oE '(^|; *| )M_[A-Z0-9_]+=' "$SH" | grep -oE 'M_[A-Z0-9_]+' | sort | uniq -c)
dead=$(printf '%s\n' "$defs" | while read -r n k; do
    [ -n "$k" ] || continue
    if [ -n "$dyn" ] && [[ "$k" =~ ^($dyn) ]]; then continue; fi
    t=$(grep -oE "\b$k\b" "$SH" | wc -l); [ "$t" -gt "$n" ] || echo "$k"
done)
if [ -n "$dead" ]; then bad=$((bad + 1)); echo "  ✗ kullanılmayan motor metni:"; printf '%s\n' "$dead" | sed 's/^/      /'; fi
odd=$(printf '%s\n' "$defs" | awk '$1 % 2 { print $2 }')
if [ -n "$odd" ]; then bad=$((bad + 1)); echo "  ✗ TR ve EN'de sayısı eşit olmayan motor metni:"; printf '%s\n' "$odd" | sed 's/^/      /'; fi
wp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
node "$(wp "$H/sozluk.js")" "$(wp "$JS")" || bad=$((bad + 1))     # her durum rozeti Terimler'de açıklanmış mı
node "$(wp "$H/olu.js")" "$(wp "$JS")" "$(wp "$REPO")" || bad=$((bad + 1))   # sözlükte kullanılmayan anahtar yok
node "$(wp "$H/yol.js")" "$(wp "$JS")" "$(wp "$SH")" || bad=$((bad + 1))     # "Ayarlar → …" yolları ayar ekranında var
node "$(wp "$H/yer.js")" "$(wp "$JS")" "$(wp "$SH")" || bad=$((bad + 1))     # TR ↔ EN yer tutucuları, port sınırı metinleri
if [ "$bad" -eq 0 ]; then echo "Terim tutarlılığı: eski ad kalmadı"; exit 0; fi
echo "Terim tutarlılığı: $bad sorun"; exit 1
