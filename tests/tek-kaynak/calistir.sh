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
# GÖRSEL DİL (P4, 1.15.145): renk yalnız durum çipi + önem işareti. Geçmiş rozet tablosunda (EV_ST) durum renkleri (perm / temp / prom /
# part / allow) yok — işlem olayları renksiz, tespit olayları önemle (warn / leak); izinli yeşil (ag-pill-ok), pembe "skip" rozet sınıfı yok;
# kırmızı (ban sınıfları) yalnız perm / temp / prom / part adlarında. Önce allow pembe (izinli de bulgu da), ban olayları kırmızı, part mavi
ev=$(awk '/^  var EV_ST = \{/ { p = 1 } p { print } p && /^  \};/ { exit }' "$J" | grep -cE "'(perm|temp|prom|part|allow)'")
sc=$(grep -c "allow: 'ag-pill-ok'" "$J"); sk=$(grep -c "ag-pill-skip" "$J" "${J%.js}.css" | awk -F: '{ s += $NF } END { print s }')
rd=$(grep -oE "[a-z]+: 'ag-pill-(ban|temp|prom|part)'" "$J" | cut -d: -f1 | sort -u | tr '\n' ' ')
# mail / Slack: aynı dil — engel olmayan şeye kırmızı, işleme mor / mavi / turkuaz / pembe, "tamam"a yeşil yok (önce sorun kırmızı, kalıcıya alma
# mor, elle ban kırmızı rozet)
ml=$(grep -cE '#(b91c1c|dc2626|7c3aed|0d9488|2563eb|db2777|047857)' "$SHF")
# 1.15.146: Geçmiş "şu an" notu satırın DURUM ÇİPİ (rengi tek durum kaydından, noteSt); tamam / açık / ölçüm renksiz (yeşil yalnız izinli)
# 1.15.149: SAĞLIK göstergesi (koruma bandının noktası ve CSF / lfd / Cron çipleri) önem ölçeğinin "iyi" ucu: yeşil ZORUNLU. 1.15.146'da
# renksiz (gri) yapılmıştı, çalışan koruma "durmuş" diye okundu (kullanıcı). Sağlayıcılar'daki katmanın "Açık" rozeti de aynı sınıf (gri
# "Açık" kapalıyla karışıyordu) → yeşil. "Bakılacak bir şey yok" çubuğu (okbar) bilgi: renksiz kalır
# Yeşil = izinli ya da iyi. Değişim oku (▲ / ▼) ve ban özetindeki "Açık kalır" bilgi: yeşil / amber değil (azalan ban "iyi" değil)
ns=$(grep -c "addrPill(noteSt(e.cidr), note" "$J"); okc=$(grep -cE '^\.ag-okbar .*--ag-ok\b|^\.ag-kpi-d\.(up|dn)[^}]*color: (#|var\(--ag-(ok|warn)\))|^\.ag-sum-k\.ok \{[^}]*--ag-ok\b' "${J%.js}.css")
hg=$(grep -cE '^\.ag-pulse i \{.*background: var\(--ag-ok\).*animation: ag-pulse|^\.st-bad \.ag-pulse \{.*\.ag-pulse i \{.*animation: none|^\.ag-hc\.ok \{.*color: var\(--ag-ok\)|^\.ag-st\.on \{ color: var\(--ag-ok\)' "${J%.js}.css")
[ "$ns" = 1 ] && [ "$okc" = 0 ] && [ "$hg" = 4 ] || ml=$((ml + 1000))
if [ "$ev" != 0 ] || [ "$sc" != 1 ] || [ "$sk" != 0 ] || [ "$rd" != "part perm prom temp " ] || [ "$ml" != 0 ]; then
    echo "DÜŞTÜ: görsel dil standardı bozuk (Geçmiş rozetinde durum rengi $ev; izinli yeşil $sc; pembe sınıf $sk; kırmızı adlar: $rd; mailde eski renk $ml satır)"; F=$((F + 1))
else echo "GEÇTİ: görsel dil — renk yalnız durum çipi ve önem işareti"; fi
# Engelli rozeti DOLU (1.15.149): kalıcı / kalıcıya alındı / süreli rozetin zemini kırmızı (soluk pembe zemin kısmi banın çerçevesinden
# ayırt edilmiyordu, canlıda "elle" tam ban çerçeveli göründü); kısmi şeffaf
fl=$(grep -cE '^\.ag-pill-(ban|prom|temp) \{ background: var\(--ag-d-(ban|prom|temp-t)\); color: #fff' "${J%.js}.css")
if [ "$fl" != 3 ]; then echo "DÜŞTÜ: engelli rozeti dolu değil ($fl / 3)"; F=$((F + 1)); else echo "GEÇTİ: engelli rozeti dolu kırmızı, kısmi çerçeveli"; fi
# SAHİP ADI tek kısaltma kuralı (1.15.149): "tanıtıcı - Ad, ÜLKE" kısaltması yalnız shortName'de; Geçmiş sahibi listelerle aynı kaynaktan
# (ownerOf). Önce 4 kopya vardı; biri "AS28126 - BRISANET"i "- BRISANET" yaptı, Geçmiş olaydaki eski metni ham basıyordu
sn=$(grep -c "replace(/^\[^ \]+ - /" "$J"); so=$(grep -c "var oc = /^\\\\d/.test(e.cidr || '') ? ownerOf(" "$J")
if [ "$sn" != 0 ] || [ "$so" != 1 ]; then echo "DÜŞTÜ: sahip adı kısaltması tek işlevde değil (kopya $sn, Geçmiş sahip haritasından $so)"; F=$((F + 1)); else echo "GEÇTİ: sahip adı tek kısaltma kuralından, Geçmiş listelerle aynı kaynaktan"; fi
# Geçmiş: geniş kapsamanın ban altında ihlali (aralıksız, tek IP) satırın adresi olarak çizilir (1.15.149; önce adressiz ve menüsüzdü)
ua=$(grep -c "if (!e.cidr && e.type === 'under_ban' && e.ips && e.ips.length === 1" "$J")
if [ "$ua" != 1 ]; then echo "DÜŞTÜ: aralıksız ban altında ihlal satırı adressiz"; F=$((F + 1)); else echo "GEÇTİ: aralıksız ban altında ihlal satırı IP'siyle"; fi
# Açılır bölüm işareti (1.15.149): panelin her <details> sınıfı ▸ / ▾ işaret kuralında (ag-im-more kendi işaretini çizer). Önce summary block
# olunca tarayıcı üçgeni kayboluyordu, açılır bölüm düz başlık gibi duruyordu
dm=""; for c in $(grep -oE '<details class="ag-[a-z0-9-]+' "$J" | sed 's/.*class="//' | sort -u); do
    [ "$c" = ag-im-more ] && continue; grep -qF ".$c[open] > summary::before" "${J%.js}.css" || dm+="$c "; done
if [ -n "$dm" ]; then echo "DÜŞTÜ: açılır bölüm işaretsiz: $dm"; F=$((F + 1)); else echo "GEÇTİ: her açılır bölümde ▸ / ▾ işareti"; fi
# İzin / yoksayma ayrımı (1.15.149): kartlar "İzin listesi" satırına yalnız izin kaydı yazar; lfd'nin yoksayma kaynakları (wlKind) ayrı satırda,
# doğrulanamayan ters DNS / ülke (wl_retry) not olarak. Önce aralık kartı d.wl'yi süzmeden basıyordu (canlıda 103.47.145.0/24 "İzin listesi:
# csf.rignore"); sonuç cümlesi kaynak adını ilk ":"de kesiyordu ("csf.allow (tcp in d=1")
w1=$(grep -c "fact(t('l_wl'), d.wl ? addrHtml(d.wl, cidr)" "$J"); w2=$(grep -c "String(d.wl || '').replace(/:\.\*\$/, '')" "$J"); w3=$(grep -c "wlKind(d.wl)" "$J")
if [ "$w1" != 0 ] || [ "$w2" != 0 ] || [ "$w3" -lt 3 ]; then echo "DÜŞTÜ: izin / yoksayma ayrımı (ham satır $w1, ilk ':'de kesme $w2, wlKind $w3)"; F=$((F + 1)); else echo "GEÇTİ: kartlarda izin listesi yalnız izin kaydı; yoksayma ve doğrulanamayan ayrı"; fi
# Veri metni kesilmez (1.15.150, kullanıcı: "hiç kesmeyelim uzun yazsın"; "Google …" yanında boşluk varken kesiliyordu): CSS'te "…" ile
# kesen tek kural uygulama başlığı (.ag-title h1); panel kodunda metni "…" ile kısaltan yer yok
el=$(grep -c "text-overflow: *ellipsis" "${J%.js}.css"); eh=$(grep -c "^  \.ag-title h1 {.*text-overflow: ellipsis" "${J%.js}.css"); ej=$(grep -cE "slice\(0, ?[0-9]+\) ?\+ ?'…'|\.slice\(0, ?[0-9]+\) \+ '\.\.\.'" "$J")
if [ "$el" != 1 ] || [ "$eh" != 1 ] || [ "$ej" != 0 ]; then echo "DÜŞTÜ: veri metni kesiliyor (CSS ellipsis $el, başlık $eh, JS kesme $ej)"; F=$((F + 1)); else echo "GEÇTİ: veri metni kesilmez, sığmazsa alt satıra geçer"; fi
# KART TUTARLILIĞI (1.15.150, canlı göz denetimi): (1) kart başlığında ve Ülke satırında ülke adıyla ("MY" ne?); (2) sahip kartta bir kez
# (başlık; Kim → Sahip yalnız başlıkta yoksa); (3) kendi tam banıyla kapalı izlenen blokta "Kalıcı yap / İzlemeyi yeniden başlat" yok;
# (4) AbuseIPDB bildirim sayısı tek metinden (sıfırda "son 90 günde bildirim yok"); (5) izlenen ama banlı olmayan blokta "Kalıcı yap"
# değil "Bloğu kalıcı banla"; (6) elle ban ihlal sayılmaz ("yukarıdaki ihlallerin hepsi kesiliyor" demez)
k1=$(grep -c "ownerHtml(ho, null, false, false, true)\|ownerHtml(so, null, false, false, true)" "$J"); k1b=$(grep -c "t('lv_cc'), ccTag(" "$J")
k2=$(grep -c "fact(t('l_owner'), d.asn || ownerOf(ip + '/32').asn ? '' : owner)" "$J"); k2b=$(grep -c "var o = ownerOf(cidr); if (oa) return '';" "$J")
k3=$(grep -c "if (watchHeld(p.prefix)) return \[MI.forget(p.prefix)\];" "$J")
k4=$(grep -c "t('ab_rep'\|t('ab_rep_w'" "$J"); k4b=$(grep -c "abRep(a)" "$J")
k5=$(grep -c "label: tempAt(pfx3 + '.0/24') ? t('promote') : t('ban24_perm')" "$J")
k6=$(grep -c "Object.keys(A).filter(function (k) { return !manualOnly(k); })" "$J"); grep -q "return /^csf_autogroup:/.test(x.why || ''); }));" "$J" || k6=x
# (7) sağlayıcı kartı: başlık öteki kartlar gibi (ülke adıyla), servis dağılımı bir kez, port listesi uyarısı yalnız banlıyken
k7=$(grep -c "esc(t('asc_kind')) + (info.cc ? ' · <span class=\"ag-own-s\">' + ccTag(info.cc)" "$J"); k7b=$(grep -c "(top.svc ? '<div>' + esc(t('p_svc'" "$J")
k7c=$(grep -c "known.length && !ctx.bk && (ctx.banned || !ctx.card)" "$J")
# (8) geçici banın kalan süresi "Kendi banı" satırında (yalnız açılır CSF satırının içindeydi)
[ "$(grep -c "statePill('temp', t('l_temp')) + (d.tleft > 0 ?" "$J")" = 1 ] || k7c=x
# 1.15.152: blokları birden çok sağlayıcıya ait aralıkta başlık tek sağlayıcı yazmaz (oa yok), Sahip satırı sağlayıcıları sayar
[ "$(grep -c "oa = mixH ? null :" "$J")" = 1 ] && [ "$(grep -c "fact(t('l_owner'), mixH ||" "$J")" = 1 ] || k2b=x
if [ "$k1" != 2 ] || [ "$k1b" != 2 ] || [ "$k2" != 1 ] || [ "$k2b" != 1 ] || [ "$k3" != 1 ] || [ "$k4" != 1 ] || [ "$k4b" -lt 2 ] || [ "$k5" != 1 ] || [ "$k6" != 1 ] || [ "$k7" != 1 ] || [ "$k7b" != 0 ] || [ "$k7c" != 1 ]; then
    echo "DÜŞTÜ: kart tutarlılığı (başlık ülke adı $k1, Ülke satırı $k1b, sahip tekrarı $k2/$k2b, banlı izleme $k3, AbuseIPDB metni $k4/$k4b, Kalıcı yap adı $k5, elle ban ihlal $k6, sağlayıcı kartı $k7/$k7b/$k7c)"; F=$((F + 1))
else echo "GEÇTİ: kart tutarlılığı (ülke adıyla, sahip bir kez, banlı blokta izleme, AbuseIPDB sıfır bildirim, ban eylemi adı, elle ban ihlal değil)"; fi
# SERVİS ↔ PORT HARİTASI (T-2, 1.15.148): panel portları motordan okur (durum JSON svcp / svcpu); kendi tablosu (SVC_TCP / SVC_UDP) yok.
# Motorda kısmi banın UDP portları yalnız svc_wudp'de (part_ports'ta sabit 443 / 53 yok)
pt=$(grep -cE "SVC_TCP|SVC_UDP" "$J"); pu=$(awk '/^part_ports\(\) \{/ { p = 1 } p { print } p && /^\}/ { exit }' "$SHF" | grep -cE '"(443|53)"|,\}443|,\}53')
if [ "$pt" != 0 ] || [ "$pu" != 0 ]; then echo "DÜŞTÜ: servis-port haritası tek tanımda değil (panel tablosu $pt satır; part_ports sabit UDP $pu)"; F=$((F + 1))
else echo "GEÇTİ: servis-port haritası motordan (svc_ports / svc_wudp → svcp / svcpu)"; fi
# İZLEME SINIRI (M-K, 1.15.143): "blok izleniyor mu" tek ölçüt (watch_cut). Sınırı kendisi hesaplayan yer (SAYAC_RETENTION_DAYS days ago)
# ya da İzlenenler listesinin eski gün hesabı (ret - age >= 0; yaz saati geçişinde IP kartından bir gün ayrışıyordu) geri gelmez
wc=$(grep -c 'SAYAC_RETENTION_DAYS days ago' "$SHF"); wa=$(grep -c 'ret - age >= 0' "$SHF")
if [ "$wc" != 1 ] || [ "$wa" != 0 ]; then echo "DÜŞTÜ: izleme sınırı tek yerde değil (sınırı hesaplayan $wc yer, eski gün hesabı $wa)"; F=$((F + 1))
else echo "GEÇTİ: izleme sınırı tek ölçüt (watch_cut)"; fi
# SÜRÜM ŞERİDİ (1.15.152): sayfa eski dosyalarla açıkken (yüklenen sürüm BOOT.version ≠ sunucunun S.version) başlığın üstünde "yenile"
# şeridi; önce başlık yeni sürümü yazıp ekran eski CSS / JS ile çalışıyordu
if [ "$(grep -c "BOOT.version !== S.version" "$J")" != 1 ] || [ "$(grep -c "return verStale() + '<div class=\"ag-head\">" "$J")" != 1 ]; then echo "DÜŞTÜ: eski dosyalarla açık sayfa için sürüm şeridi yok"; F=$((F + 1))
else echo "GEÇTİ: eski dosyalarla açık sayfa sürüm şeridiyle yenilenmeyi ister"; fi
# TUR ANI (1.15.154): sunucu saati farkı isteğin gönderildiği ana göre (cevap anına göre ~10 sn kayıyordu) ve tur anı yoklaması yoldaki
# isteği beklemez; ikisi yokken 6 sn'lik tur panelde hiç "çalışıyor" görünmedi (canlı ölçüm 2026-11-27 20:00). 1.15.156: "çalışıyor"
# hafif runstate ucundan (motorun tur işareti; durum çıktısı turdan uzun sürer). Davranış testi tests/saat (gerçek nextLeft ile tik).
if [ "$(grep -c "CLOCK = d.now - sent;" "$J")" != 1 ] || [ "$(grep -c "CLOCK = d.now - Date.now()" "$J")" != 0 ] || [ "$(grep -c "if (REF_P) refreshNow(); else refresh();" "$J")" != 1 ] || [ "$(grep -c "api('runstate')" "$J")" != 1 ]; then echo "DÜŞTÜ: tur anı yoklaması saat kaymasına ya da yoldaki isteğe takılıyor"; F=$((F + 1))
else echo "GEÇTİ: tur anı yoklaması doğru saatte, yoldaki isteği beklemeden"; fi
[ $F -eq 0 ] && echo "GEÇTİ: tek kaynak ($J)" || echo "DÜŞTÜ: $F kural"
exit $F
