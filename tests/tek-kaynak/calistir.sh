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
kural "durum rengi sınıfı yalnız ST_CLS'te" "ag-pill-(ban|temp|prom|part|skip|dw|leak|n|ok|bad|acc|warn|info)[^a-z-]" "^  function stAttr"
kural "rozet (class=\"ag-pill\") yalnız stAttr'da" "class=\"ag-pill[ \"]" "^  function stAttr"
kural "adres bağlantısı yalnız cidrLink'te" "class=\"ag-cidr\"" "^  function cidrLink"
kural "değiştirilebilen durum yalnız stLink'te (durumun kendisi tıklanır; ayrı \"Ne kapatılsın\" / \"Değiştir\" yok)" "class=\"ag-stlink\"" "^  function stLink"
kural "kaynak ayrıntısı düğmesi yalnız detBtn'de (sağlayıcı, kiralık liste, blok listesi aynı düğme)" "data-act=\"srcinfo\" data-v=\"[^\"]*\" aria-expanded" "^  function detBtn"
kural "AS rozeti yalnız asnB'de (sağlayıcı kartını açar; 1.15.131'de Kapsanan banlar listesi bgp.he.net'e gidiyordu)" "class=\"ag-asn[ \"]" "^  function asnB"
kural "kapsayan ban etiketi yalnız coverTag'de" "class=\"ag-ctag" "^  function coverTag"
kural "kart sayı rozeti yalnız countBadge'de (sayı num() ile)" "class=\"ag-count" "^  function countBadge"
kural "sağlayıcı satırı yalnız asnRow'da (1.15.87: Banlı sağlayıcılar kendi kopyasıydı)" "class=\"ag-asn-r\"" "^    return '<div class=\"ag-asn-r\">"
kural "sayfa çubuğu yalnız pagerHtml'de (sayılar num() ile)" "class=\"ag-pager" "^    return '<div class=\"ag-pager\">"
kural "öğe eylemi düğmesi elle yazılmaz (MI.* + miBtn: menü, aralık kartı, IP kartı aynı öğeler)" 'data-(act|dr)="(unban|promote|forget|rewatch|chg|ban|ban16|ban24|banpfx|banforce)"' 'BU_DESEN_HICBIR_SATIRA_UYMAZ'
kural "kapsayan banın adı covName'den: ham CSF ayar adı (CC_DENY …) cümleye eklenmez" "'[ (]*CC_DENY(_PORTS)? '" 'BU_DESEN_HICBIR_SATIRA_UYMAZ'
kural "olay rozetinin adı evName'den (elle ban: türü yazıda da; renk tek başına okunmuyordu)" 'statePill[(]evSt[(]e[)], t[(]' 'BU_DESEN_HICBIR_SATIRA_UYMAZ'
# uygulama adımı (prov_apply) bitince ayarlar yeniden okunur (1.15.121): kayıttan hemen sonraki okuma uygulamanın yazdıklarını görmüyordu,
# Ayarlar kartı (birleşik dosyanın son yazımı) sayfa yenilenene kadar eski kalıyordu. Her prov_apply cevabının başarı ve hata işleyicisi CFG'yi boşaltır.
out=$(awk '/api\(.prov_apply.\)\.then\(/ { s = $0; for (i = 1; i <= 8 && (getline l) > 0; i++) s = s "\n" l; n = gsub(/CFG = null/, "&", s); if (n < 2) printf "  %d: %s\n", NR, substr($0, 1, 120) }' "$J")
if [ -n "$out" ]; then echo "DÜŞTÜ: prov_apply bitince ayarlar yeniden okunmuyor (CFG = null başarıda ve hatada)"; echo "$out" | head -4; F=$((F + 1)); else echo "GEÇTİ: prov_apply bitince ayarlar yeniden okunur"; fi
# indirilen liste dosyaları (izinli servisler, kiralık listeler) doğrudan "> dosya" ile yazılmaz: geçici dosya + mv (1.15.111; başka
# okuyucu — csfpost.sh'taki --apply ya da dışarıdan okuyan araç — "> dosya" önce boşalttığı için yazma anında boş / yarım dosya görebilir; TOOLS=dizin ile eski araçlarla sınanır)
out=$(grep -nE "> \"\\\$old\"([^.]|\$)" "${TOOLS:-$D/tools}/services-allow.sh" "${TOOLS:-$D/tools}/cloud-ban.sh" 2>/dev/null)
if [ -n "$out" ]; then echo "DÜŞTÜ: liste dosyası doğrudan yazılıyor (geçici dosya + mv olmalı)"; echo "$out" | head -4; F=$((F + 1)); else echo "GEÇTİ: liste dosyaları geçici dosya + mv ile yazılır"; fi
# grafik sınıfı panelde de (Geçmiş süzgeci, 1.15.131): evCls motorun AWK_EVC evcls'iyle aynı türleri aynı sınıfa koyar (sayı grafiktekiyle aynı)
SHF="${AG_SH:-$D/csf_autogroup.sh}"
a=$(grep -m1 "^AWK_EVC=" "$SHF" | grep -oE '"[a-z0-9_]+"\) *\?|"[a-z0-9_]+" *\?|== "[a-z0-9_]+"|"[A-Z][0-9]?"' | tr -d ' ?=)' | tr '\n' ' ')
j=$(awk '/^  function evCls\(e\)/ { p = 1 } p { print } p && /^  }/ { exit }' "$J" | grep -oE "=== '[a-z0-9_]+'|'[A-Z][0-9]?'" | sed "s/=== //" | tr -d "'" | tr '\n' ' ')
a=$(printf '%s' "$a" | tr -d '"')
if [ -z "$j" ] || [ "$a" != "$j" ]; then echo "DÜŞTÜ: evCls (panel) motorun AWK_EVC sınıflandırmasından farklı"; echo "  motor: $a"; echo "  panel: $j"; F=$((F + 1)); else echo "GEÇTİ: grafik sınıfı panelde ve motorda aynı"; fi
[ $F -eq 0 ] && echo "GEÇTİ: tek kaynak ($J)" || echo "DÜŞTÜ: $F kural"
exit $F
