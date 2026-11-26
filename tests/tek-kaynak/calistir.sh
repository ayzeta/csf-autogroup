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
# liste indirilemedi sebebi (1.15.133): motorun her M_FE_* metninin panelde fe_* karşılığı var, panel kutusu ve uyarı bandı kodu feText'ten
# çevirir (önce yalnız "indirilemiyor" yazıyordu, sebep hiçbir yerde görünmüyordu)
m=$(grep -oE 'M_FE_[A-Z]+=' "$SHF" | sort -u | sed 's/M_FE_//; s/=//' | tr 'A-Z' 'a-z' | tr '\n' ' ')
miss=""; for k in $m; do grep -q "fe_$k: '" "$J" || miss+=" fe_$k"; done
nf=$(grep -c "feText(c.fail.e)\|feText(x.e)" "$J")
if [ -z "$m" ] || [ -n "$miss" ] || [ "$nf" -lt 2 ]; then echo "DÜŞTÜ: indirilemedi sebebi panelde yok (eksik:${miss:- -}, feText kullanımı $nf)"; F=$((F + 1)); else echo "GEÇTİ: indirilemedi sebebi motorda ve panelde aynı kodlar"; fi
# banı koyduran olay türleri (1.15.134): motorun EV_BAN_TYPES'ı ile panelin BAN_TYPES'ı aynı küme; panelde banın IP'leri (OWNERS.ev)
# yalnız BAN_IPS_TYPES'tan (önce aralığın IP taşıyan son kaydından: ban altında ihlal kaydı banın IP'leri sanılıyordu)
mb=$(grep -m1 '^EV_BAN_TYPES=' "$SHF" | sed 's/^EV_BAN_TYPES="//; s/".*//' | tr '|' '\n' | sort | tr '\n' ' ')
pb=$(grep -m1 "^  var BAN_TYPES = \[" "$J" | grep -oE "'[a-z0-9_]+'" | tr -d "'" | sort | tr '\n' ' ')
ow=$(grep -c "BAN_IPS_TYPES.indexOf(e.type) >= 0) o.ev = e" "$J")
if [ -z "$mb" ] || [ "$mb" != "$pb" ] || [ "$ow" != 1 ]; then echo "DÜŞTÜ: banı koyduran olay kümesi motor ↔ panel farklı ya da OWNERS.ev türe bakmıyor (motor: $mb · panel: $pb · süzgeç $ow)"; F=$((F + 1)); else echo "GEÇTİ: banı koyduran olay kümesi motorda ve panelde aynı ($mb)"; fi
# "servis kapalı mı" kararının UDP portları (1.15.134): yalnız svcLiveUdp'de (motorun svc_uports'u); başka yerde web için sabit UDP 443
# yazılmaz (aralık kartı QUIC'e bakmadan istiyordu) ve SSH portu sabit '22' değil, sunucudan (svcTcp)
out=$(grep -nE "=== 'web' \? \[443\]|k === 'ssh' \? String\(d\.ssh \|\| '22'\)|d\.ssh\)\.split\(','\)\.join\(', '\) : '22'" "$J")
lv=$(grep -c "function svcLiveUdp(k)" "$J")
if [ -n "$out" ] || [ "$lv" != 1 ]; then echo "DÜŞTÜ: servis portu kuralı kopyası (UDP 443 sabit ya da SSH '22'):"; echo "$out" | head -4; F=$((F + 1)); else echo "GEÇTİ: servis kapalı mı UDP kuralı tek yerde (svcLiveUdp), SSH portu sunucudan"; fi
# kartın altındaki düğme listeyi değiştirince (sayfa çubuğu, "Daha az") kart başı görünür olur (1.15.133: Aktif aralık banları, İzlenenler,
# sağlayıcı listesi sayfası kullanıcıyı sayfanın altında boşlukta bırakıyordu). pagerHtml'e verilen her eylem ve limless cardTop çağırır
acts=$(grep -oE "pagerHtml\('[a-z]+'" "$J" | sed "s/pagerHtml('//; s/'//" | sort -u; echo limless)
miss=""; for a in $acts; do awk -v a="$a" '$0 ~ "^    " a ": function" { p = 1 } p { print; if (/^    [a-z0-9_]+: function/ && $0 !~ "^    " a ":") exit; if (++n > 12) exit }' "$J" | grep -q 'cardTop(el)' || miss+=" $a"; done
if [ -n "$miss" ]; then echo "DÜŞTÜ: listeyi değiştiren düğme kart başını göstermiyor (cardTop yok):$miss"; F=$((F + 1)); else echo "GEÇTİ: sayfa / kısaltma eylemleri kart başına döner ($(echo $acts))"; fi
# TEK DURUM (1.15.136): bir adresin şu anki durumu motorda yalnız obj_state'te (AWK_ST). Etkisini ölç'ün eski kendi hesabı (ipst),
# kaynak ayrıntısının izin / aralık / blok listesi hesabı geri gelmez; panelde IP kartının hükmü, kapsayan ban düzeyi ve izin kararı
# yalnız kayıttan (d.st), Etkisini ölç rozetleri stToks'tan
sx=$(grep -cE "function ipst\(|st = \"alw\"|\"deny24:\" : \"temp24:\"" "$SHF")
pv=$(awk '/^  function verdict\(d, mb\)/ { p = 1 } p { print } p && /^  }$/ { exit }' "$J" | grep -c "st.e === 'alw'")
pc=$(awk '/^  function coverBits\(d\)/ { p = 1 } p { print } p && /^  }$/ { exit }' "$J" | grep -c "(d.covers")
pa=$(grep -c "function fullAllow(d) { return d.st ? " "$J")
pi=$(awk '/^  function impState\(st\)/ { p = 1 } p { print } p && /^  }$/ { exit }' "$J" | grep -c "stToks(st)")
# 1.15.143: IP'nin kendi banı (ipOwnBan) ve IP kartının seviye satırları (lvBanOf, motor lookup "lvs") da kayıttan
po=$(awk '/^  function ipOwnBan\(ip, d\)/ { p = 1 } p { print } p && /^  }$/ { exit }' "$J" | grep -c "if (d.st)")
pl=$(awk '/^  function lvBanOf\(d, ip, cidr, bits\)/ { p = 1 } p { print } p && /^  }$/ { exit }' "$J" | grep -c "recCov(rec, cidr)")
if [ "$sx" != 0 ] || [ "$pv" != 1 ] || [ "$pc" != 0 ] || [ "$pa" != 1 ] || [ "$pi" != 1 ] || [ "$po" != 1 ] || [ "$pl" != 1 ]; then
    echo "DÜŞTÜ: şu anki durum tek kayıttan değil (motorda eski hesap $sx; hüküm kayıttan $pv; mb covers'tan $pc; izin kayıttan $pa; Etkisini ölç $pi; kendi banı $po; seviye satırı $pl)"; F=$((F + 1))
else echo "GEÇTİ: şu anki durum tek kayıttan (motor obj_state; IP kartı hükmü, kapsayan ban, izin, kendi banı, seviye satırları, Etkisini ölç)"; fi
# DÜŞME TARİHİ (P15, 1.15.143): Kontrol edilecekler satırının listeden düşme tarihi motorun "drop" alanı; panel tarih hesaplamaz
rd=$(awk '/^  function rvDrop\(e\)/ { p = 1 } p { print } p && /^  }$/ { exit }' "$J" | grep -cE "86400|review_days")
if [ "$rd" != 0 ]; then echo "DÜŞTÜ: düşme tarihini panel hesaplıyor (rvDrop'ta $rd satır gün hesabı)"; F=$((F + 1)); else echo "GEÇTİ: düşme tarihi motordan (rvDrop yalnız metni seçer)"; fi
# GEREKSİZ BAN (1.15.144): "bu ban zaten başka engelin içinde mi" tek işlev (grpCov). Satır etiketi ülke banını görürken Gereksizleşen
# banlar kartı ve toplu kaldırma yalnız g.pcov / g.under'a bakıyordu
gp=$(grep -c "g\.pcov || g\.under\|g\.under || g\.pcov" "$J"); gu=$(grep -c "filter(grpCov)" "$J")
if [ "$gp" != 0 ] || [ "$gu" != 2 ]; then echo "DÜŞTÜ: gereksiz ban kararı tek yerde değil (kendi denetimi $gp yer, grpCov süzgeci $gu)"; F=$((F + 1)); else echo "GEÇTİ: gereksiz ban kararı tek işlevden (grpCov)"; fi
# İZLEME SINIRI (M-K, 1.15.143): "blok izleniyor mu" tek ölçüt (watch_cut). Sınırı kendisi hesaplayan yer (SAYAC_RETENTION_DAYS days ago)
# ya da İzlenenler listesinin eski gün hesabı (ret - age >= 0; yaz saati geçişinde IP kartından bir gün ayrışıyordu) geri gelmez
wc=$(grep -c 'SAYAC_RETENTION_DAYS days ago' "$SHF"); wa=$(grep -c 'ret - age >= 0' "$SHF")
if [ "$wc" != 1 ] || [ "$wa" != 0 ]; then echo "DÜŞTÜ: izleme sınırı tek yerde değil (sınırı hesaplayan $wc yer, eski gün hesabı $wa)"; F=$((F + 1))
else echo "GEÇTİ: izleme sınırı tek ölçüt (watch_cut)"; fi
[ $F -eq 0 ] && echo "GEÇTİ: tek kaynak ($J)" || echo "DÜŞTÜ: $F kural"
exit $F
