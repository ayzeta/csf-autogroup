#!/bin/bash
# Tek kaynak bekçisi: aynı ekran öğesi tek çiziciden çıkar (standartlaştırma, 1.15.83).
# Bir kopya kalıbı tek çizicinin dışında yazılırsa düşer: o yer ortak bileşenden kopmuş, öbür ekranlardan ayrı görünebilir.
#   - durum rengi sınıfı (ag-pill-ban, -temp, -skip …) yalnız ST_CLS'te      → statePill / stAttr
#   - class="ag-pill" yalnız stAttr'da                                       → statePill / stAttr
#   - class="ag-cidr" (adres bağlantısı) yalnız cidrLink'te                  → cidrLink
#   - class="ag-ctag" (kapsayan ban etiketi) yalnız coverTag'de             → coverTag
#   - class="ag-count" (kart sayı rozeti), class="ag-pager" (sayfa çubuğu)   → countBadge, pagerHtml (1.15.85: üçü num()'suzdu)
#   - öğe eylemi düğmesi (data-act="unban|promote|chg|ban16…") elle yazılmaz → MI.* + miBtn (objItems / selfItems; 1.15.95:
#     aralık kartı ve IP kartı kendi düğmelerini kuruyordu, aynı geçici blok üç ekranda üç ayrı eylem sunuyordu)
# Kullanım: calistir.sh [ag.js yolu]  (eski kodla sınamak için başka dosya verilebilir)
set -u
D=$(cd "$(dirname "$0")/../.." && pwd)
J=${1:-$D/whm/assets/ag.js}
F=0
kural() {   # ad, desen, izinli satır deseni
  local out
  out=$(awk -v P="$2" -v A="$3" '
    /var ST_CLS = \{/ { inst = 1 }
    inst { if (/\};/) inst = 0; next }
    $0 ~ A { next }
    $0 ~ P { printf "  %d: %s\n", NR, substr($0, 1, 150) }' "$J")
  if [ -n "$out" ]; then echo "DÜŞTÜ: $1"; echo "$out" | head -8; F=$((F + 1)); else echo "GEÇTİ: $1"; fi
}
kural "durum rengi sınıfı yalnız ST_CLS'te" "ag-pill-(ban|temp|prom|part|skip|dw|n|ok|bad|acc|warn|info)[^a-z-]" "^  function stAttr"
kural "rozet (class=\"ag-pill\") yalnız stAttr'da" "class=\"ag-pill[ \"]" "^  function stAttr"
kural "adres bağlantısı yalnız cidrLink'te" "class=\"ag-cidr\"" "^  function cidrLink"
kural "kapsayan ban etiketi yalnız coverTag'de" "class=\"ag-ctag" "^  function coverTag"
kural "kart sayı rozeti yalnız countBadge'de (sayı num() ile)" "class=\"ag-count" "^  function countBadge"
kural "sağlayıcı satırı yalnız asnRow'da (1.15.87: Banlı sağlayıcılar kendi kopyasıydı)" "class=\"ag-asn-r\"" "^    return '<div class=\"ag-asn-r\">"
kural "sayfa çubuğu yalnız pagerHtml'de (sayılar num() ile)" "class=\"ag-pager" "^    return '<div class=\"ag-pager\">"
kural "öğe eylemi düğmesi elle yazılmaz (MI.* + miBtn: menü, aralık kartı, IP kartı aynı öğeler)" 'data-(act|dr)="(unban|promote|forget|rewatch|chg|ban|ban16|ban24|banpfx|banforce)"' 'BU_DESEN_HICBIR_SATIRA_UYMAZ'
kural "kapsayan banın adı covName'den: ham CSF ayar adı (CC_DENY …) cümleye eklenmez" "'[ (]*CC_DENY(_PORTS)? '" 'BU_DESEN_HICBIR_SATIRA_UYMAZ'
[ $F -eq 0 ] && echo "GEÇTİ: tek kaynak ($J)" || echo "DÜŞTÜ: $F kural"
exit $F
