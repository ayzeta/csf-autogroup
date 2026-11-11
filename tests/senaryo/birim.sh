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
# Türkçe modda harf sınıfı: tr_TR'de büyük I küçülünce ı olur (sunucuda ölçüldü) → motorun ayarıyla (tr_ctype) awk tolower, bash ${c,,},
# grep -i ve sebep sınıflaması İngilizce kuralla çalışmalı. Sınamak için tr_TR yerel ayarı kurulu olmalı (AlmaLinux: glibc-langpack-tr)
if locale -a 2>/dev/null | grep -qix 'tr_TR.utf8'; then
    eval "$(awk '/^tr_ctype\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
    AWK_CLS=$(awk "/^AWK_CLS='/{f=1} f{print} f && /^}'\$/{exit}" "$REPO/csf_autogroup.sh" | sed "1s/^AWK_CLS='//; \$s/'\$//")
    trk() { ( unset LC_ALL; export LANG=tr_TR.UTF-8 LC_COLLATE=C; [ "$1" = motor ] && tr_ctype
              c=IT; printf '%s|%s|%s|%s' "$(echo 'IMAP IT' | awk '{ print tolower($0) }')" "${c,,}" "$(echo 'IMAP' | grep -ci imap)" \
                  "$(awk -v r='Failed IMAP login from 1.2.3.4 - ignored' "$AWK_CLS"' BEGIN { print cls(r) }')" ); }
    N=$((N + 1)); r=$(trk motor); d=$(trk duz)
    if [ "$r" = "imap it|it|1|mread" ]; then echo "  ✓ Türkçe modda harf çevirisi İngilizce kuralla: $r (düz tr_TR: $d)"
    else F=$((F + 1)); echo "  ✗ Türkçe modda harf çevirisi: $r (beklenen imap it|it|1|mread; düz tr_TR: $d)"; fi
    N=$((N + 1)); [ "$d" != "$r" ] && echo "  ✓ sınama duyarlı: düz tr_TR farklı sonuç verir" || { F=$((F + 1)); echo "  ✗ düz tr_TR de aynı sonucu verdi: sınama hatayı yakalamaz"; }
else
    echo "  ⚠ tr_TR.utf8 yerel ayarı kurulu değil: Türkçe mod harf çevirisi sınanmadı (dnf install glibc-langpack-tr)"
fi
# kaynak süzgeci (tools/src-filter.pl) ve sayfadaki bağlantı (cloud-ban.sh link_re): örnekler sağlayıcıların GERÇEK dosyalarından
# kesildi (tests/senaryo/ornek; 2026-11-05, satır biçimi korunarak). Tam dosyalarda genel süzgeç eski ada bağlı awk ile aynı aralıkları
# verdi (AWS 1904, Azure 2598).
O="$H/ornek"; SF="$REPO/tools/src-filter.pl"
eval "$(awk '/^ipv4_list\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/tools/cloud-ban.sh")"
eval "$(awk '/^link_re\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/tools/cloud-ban.sh")"
sz() { local exp="$1" lab="$2"; shift 2; N=$((N + 1)); local r; r=$("$@" | ipv4_list | paste -sd' ' -)
       if [ "$r" = "$exp" ]; then echo "  ✓ süzgeç: $lab → $r"; else FAILS=$((FAILS + 1)); echo "  ✗ süzgeç: $lab → «$r» (beklenen «$exp»)"; fi; }
FAILS=0
sz "23.254.120.0/21 3.5.140.0/22" "AWS j:service=EC2 (AMAZON kaydı alınmaz)" perl "$SF" 'j:service=EC2' < "$O/aws-ip-ranges.json"
sz "23.254.120.0/21 3.4.12.4/32 3.5.140.0/22" "AWS süzgeçsiz: dosyadaki her aralık" cat "$O/aws-ip-ranges.json"
sz "4.144.0.0/14 4.148.0.0/15 4.150.0.0/18" "Azure j:name=AzureCloud (AzureCloud.westus bloğu alınmaz)" perl "$SF" 'j:name=AzureCloud' < "$O/azure-servicetags.json"
sz "24.144.64.0/22 24.144.68.0/22 24.144.80.0/20" "DigitalOcean CSV t:,US, (kodlu; NL satırları alınmaz)" perl "$SF" 't:%2CUS%2C' < "$O/digitalocean-geo.csv"
sz "" "JSON olmayan dosyada JSON süzgeci: boş (liste korunur)" perl "$SF" 'j:service=EC2' < "$O/digitalocean-geo.csv"
N=$((N + 1)); link_re "download.microsoft.com/*ServiceTags_Public_*.json"; L=$(grep -oE "$REPLY" "$O/microsoft-indirme-sayfasi.html" | head -n 1)
case "$L" in https://download.microsoft.com/download/*/ServiceTags_Public_*.json) echo "  ✓ sayfadaki bağlantı: Microsoft sayfasından $L";; *) FAILS=$((FAILS + 1)); echo "  ✗ sayfadaki bağlantı bulunamadı: «$L»";; esac
N=$((N + 1)); if link_re 'a]b'; then FAILS=$((FAILS + 1)); echo "  ✗ hatalı bağlantı deseni kabul edildi"; else echo "  ✓ hatalı bağlantı deseni reddedilir"; fi
# koşul üst nesnede de sağlanabilir: Oracle'da "region" bölge nesnesinde, "tags" aralık nesnesinde (gerçek Oracle dosyasından kesildi)
sz "79.76.96.0/19 89.168.64.0/18" "Oracle j:region=eu-frankfurt-1&tags=OCI (OSN ve öteki bölge alınmaz)" perl "$SF" 'j:region=eu-frankfurt-1&tags=OCI' < "$O/oracle-ip-ranges.json"
sz "139.177.96.0/21 40.233.0.0/19 79.76.96.0/19 89.168.64.0/18" "Oracle j:tags=OCI (dizi içinde değer)" perl "$SF" 'j:tags=OCI' < "$O/oracle-ip-ranges.json"
# sayfadaki bağlantı göreli de olabilir: Cloudflare sayfası "/ips-v4/#" yazıyor, Microsoft mutlak adres (iki gerçek sayfa, ağsız)
eval "$(awk '/^page_link\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/tools/cloud-ban.sh")"
for pl in "cloudflare-ips-sayfasi.html|https://www.cloudflare.com/ips/|www.cloudflare.com/ips-v4|https://www.cloudflare.com/ips-v4" \
          "microsoft-indirme-sayfasi.html|https://www.microsoft.com/en-us/download/details.aspx?id=56519|download.microsoft.com/*ServiceTags_Public_*.json|https://download.microsoft.com/download/"; do
    IFS='|' read -r pf pu pd pe < <(printf '%s\n' "$pl"); N=$((N + 1))
    curl() { cat "$O/$pf"; }; page_link "$pu" "$pd"; unset -f curl
    case "$REPLY" in "$pe"*) echo "  ✓ sayfadaki bağlantı ($pf): $REPLY";; *) FAILS=$((FAILS + 1)); echo "  ✗ sayfadaki bağlantı ($pf): «$REPLY» (beklenen $pe…)";; esac
done
# motorun hazır listeler için ürettiği satır: varsayılan süzgeç ve desen (değiştirilmiş adres yazılınca süzgeç korunur)
for f in cloud_urls cloud_flt cloud_link cloud_srclist; do eval "$(awk "/^$f\\(\\) \\{/{f=1} f{print} f && /^}\$/{exit}" "$REPO/csf_autogroup.sh")"; done
N=$((N + 1)); CLOUD_SOURCES=aws,azure,gcp; CLOUD_URLS="aws|https://ornek.com/a.json"; CLOUD_EXTRA=""; cloud_srclist
EXP=$'aws|https://ornek.com/a.json|j:service=EC2\nazure|https://www.microsoft.com/en-us/download/details.aspx?id=56519|j:name=AzureCloud|download.microsoft.com/*ServiceTags_Public_*.json\ngcp|https://www.gstatic.com/ipranges/cloud.json\n'
if [ "$REPLY" = "$EXP" ]; then echo "  ✓ motor: hazır AWS / Azure satırı varsayılan süzgeç ve desenle"; else FAILS=$((FAILS + 1)); echo "  ✗ motor satırları: $(printf '%s' "$REPLY" | tr '\n' ' ')"; fi
F=$((F + FAILS))
if command -v node >/dev/null 2>&1; then
    N=$((N + 1)); r=$(node "$H/ayar-deseni.js" "$REPO/whm/assets/ag.js" 2>&1 | tail -n 1)
    case "$r" in *" 0 beklenmeyen") echo "  ✓ panelin ayar doğrulaması (süzgeçli satırlar): $r";; *) F=$((F + 1)); echo "  ✗ panelin ayar doğrulaması: $r";; esac
fi
# liste yenileme zamanı (due_at): REFRESH_HOUR saatse son yenilemenin gününden GÜN takvim günü geçince o saatten sonraki ilk turda;
# saat kaçtıysa (bir gün daha geçti) beklemez; "off" tam GÜN×24 saat. Saat taklidi: date'e -d verilmezse ŞİMDİ'nin anı kullanılır
eval "$(awk '/^due_at\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
date() { case " $* " in *" -d "*) command date "$@" ;; *) command date -d "@$SIMDI" "$@" ;; esac; }
dz() { # TZ ŞİMDİ SON GÜN SAAT BEKLENEN AÇIKLAMA
    N=$((N + 1)); local r; r=$(export TZ="$1"; SIMDI=$(command date -d "$2" +%s); REFRESH_HOUR="$5"
        due_at "$(command date -d "$3" +%s)" "$4" && echo 1 || echo 0)
    if [ "$r" = "$6" ]; then echo "  ✓ yenileme zamanı: $7 → $r"; else F=$((F + 1)); echo "  ✗ yenileme zamanı: $7 → $r (beklenen $6)"; fi; }
dz UTC "2026-11-08 03:59" "2026-11-07 02:00" 1 4 0 "dün 02:00, saat 4, şimdi 03:59: beklenir"
dz UTC "2026-11-08 04:00" "2026-11-07 02:00" 1 4 1 "dün 02:00, saat 4, şimdi 04:00: yenilenir"
dz UTC "2026-11-08 23:50" "2026-11-08 01:00" 1 4 0 "bugün 01:00 yenilendi: ertesi güne kadar yok"
dz UTC "2026-11-08 02:00" "2026-11-06 05:00" 1 4 1 "iki gün önce: saat kaçmış, beklemeden yenilenir"
dz UTC "2026-11-08 04:10" "2026-11-05 04:30" 3 4 1 "3 günde bir: 3. gün saat 4'ten sonra"
dz UTC "2026-11-07 10:00" "2026-11-05 04:30" 3 4 0 "3 günde bir: 2. gün yenilenmez"
dz UTC "2026-11-08 00:30" "2026-11-07 23:30" 1 0 1 "saat 0: gece yarısından sonraki ilk tur"
dz UTC "2026-11-08 02:00:36" "2026-11-07 02:00:37" 1 off 0 "saat yok: 24 saat dolmadan yenilenmez"
dz UTC "2026-11-08 02:00:37" "2026-11-07 02:00:37" 1 off 1 "saat yok: tam 24 saatte yenilenir"
dz Europe/Berlin "2026-10-26 04:00" "2026-10-25 05:00" 1 4 1 "yaz saati bitiminden sonraki gün (25 saatlik gece yarısı farkı)"
dz Europe/Berlin "2026-03-30 04:00" "2026-03-29 05:00" 1 4 1 "yaz saati başlangıcından sonraki gün (23 saatlik fark)"
unset -f date
# Tur süresi ipucunun "yenilendi" işareti (rf_mark): aracın GERÇEK durum dosyasından. cloud-ban.sh yalnız indirir (NOAPPLY): bir liste
# yerel dosyadan iner, öbürü bağlantı reddiyle düşer → "1/2". Durum dosyası bu turda yazılmadıysa (araç zaman aşımında öldürüldü)
# eski başarılı satırlar sayılmaz → "0/2"; dosya yoksa "0/0". Önce çağrılmış olması yetiyordu: başarısız indirme de "yenilendi" yazacaktı
eval "$(awk '/^rf_mark\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
TD=$(mktemp -d); printf '203.0.113.0/24\n198.51.100.0/24\n' > "$TD/liste.txt"
rfm() { N=$((N + 1)); RF_JOBS=""; rf_mark cloud "$2"; if [ "$RF_JOBS" = "$3" ]; then echo "  ✓ yenileme işareti: $1 → $RF_JOBS"; else F=$((F + 1)); echo "  ✗ yenileme işareti: $1 → $RF_JOBS (beklenen $3)"; fi; }
RUN_T0=$(date +%s)
SRC="iyi|file://$TD/liste.txt"$'\n'"kotu|https://127.0.0.1:9/yok" CACHE="$TD/c" LOG_FILE=/dev/null NOAPPLY=1 bash "$REPO/tools/cloud-ban.sh" >/dev/null 2>&1
rfm "biri indi, biri bağlantı reddi" "$TD/c/status" "cloud:1/2"
RUN_T0=$(( $(date +%s) + 60 )); rfm "durum dosyası bu turda yazılmadı (zaman aşımı)" "$TD/c/status" "cloud:0/2"
rfm "durum dosyası yok" "$TD/c/yok" "cloud:0/0"
# zaman aşımı (st_fail_mark): araç GERÇEKTEN öldürülür (yanıt vermeyen adres, timeout 2) → durum dosyası yazılmaz; önceki başarılı
# satırlar "timeout" hatası ve ilk hata zamanı alır (bildirim ve panel aynı dosyayı okur), daha önce düşen listenin ilk hata zamanı korunur
eval "$(awk '/^st_fail_mark\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
k0=$(cut -d'|' -f5 < <(grep '^kotu|' "$TD/c/status")); sleep 1; T1=$(date +%s)
SRC="iyi|https://10.255.255.1/x"$'\n'"kotu|https://10.255.255.1/y" CACHE="$TD/c" LOG_FILE=/dev/null NOAPPLY=1 timeout 2 bash "$REPO/tools/cloud-ban.sh" >/dev/null 2>&1
N=$((N + 1)); m=$(stat -c %Y "$TD/c/status")
if [ "$m" -lt "$T1" ]; then echo "  ✓ zaman aşımı: araç öldürüldü, durum dosyası yazılmadı"; else F=$((F + 1)); echo "  ✗ zaman aşımı sınanamadı: araç durum dosyasını yazdı (adres yanıt verdi?)"; fi
st_fail_mark "$TD/c/status" "$T1"; RUN_T0=$T1
N=$((N + 1)); i=$(grep '^iyi|' "$TD/c/status"); k=$(grep '^kotu|' "$TD/c/status")
if [ "$(cut -d'|' -f4 <<< "$i")" = timeout ] && [ "$(cut -d'|' -f5 <<< "$i")" -ge "$T1" ] && [ -s "$TD/c/iyi.fail" ] && [ "$(cut -d'|' -f5 <<< "$k")" = "$k0" ] && [ "$k0" -gt 0 ]; then
    echo "  ✓ zaman aşımı: listelere hata ve ilk hata zamanı yazıldı, önceki ilk hata korundu"
else F=$((F + 1)); echo "  ✗ zaman aşımı işareti: iyi=«$i» kotu=«$k» (önceki ilk hata $k0)"; fi
rfm "zaman aşımından sonra" "$TD/c/status" "cloud:0/2"
rm -rf "$TD"
# tek tırnaklı programın (awk …) içindeki yorumda kesme işareti tırnağı kapatır; bash -n yakalamaz (dört kez oldu)
for f in "$REPO/csf_autogroup.sh" "$REPO"/tools/*.sh; do
    N=$((N + 1)); k=$(awk -f "$(dirname "$0")/tirnak.awk" "$f" | head -n 1)
    if [ -z "$k" ]; then echo "  ✓ tırnak içi yorumda kesme işareti yok: $(basename "$f")"; else F=$((F + 1)); echo "  ✗ $(basename "$f") $k"; fi
done
# süre yazımı (dur_text): panelin dur() işleviyle aynı biçim — gün / gün+sa / sa / sa+dk / dk / sn ("5400 sn" değil)
eval "$(awk '/^m\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
eval "$(awk '/^dur_text\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
eval "$(grep -m1 '^  M_DUR_D=' "$REPO/csf_autogroup.sh")"
for x in "604800|7 gün" "90000|1 gün 1 sa" "21600|6 sa" "5400|1 sa 30 dk" "900|15 dk" "40|40 sn"; do
    N=$((N + 1)); r=$(dur_text "${x%%|*}")
    if [ "$r" = "${x#*|}" ]; then echo "  ✓ süre ${x%%|*} sn → $r"; else F=$((F + 1)); echo "  ✗ süre ${x%%|*} sn → $r (beklenen ${x#*|})"; fi
done
# Cymru origin cevabında en dar önek (cymru_line): gerçek cevap (2026-11-11, 45.168.98.3.origin.asn.cymru.com), iki satır, sıra
# sorgudan sorguya değişiyor; ilk satırı almak aynı IP için bazen /10 bazen /15 veriyordu
eval "$(awk '/^cymru_line\(\) \{/{f=1} f{print} f && /^}$/{exit}' "$REPO/csf_autogroup.sh")"
L15='"16509 | 3.98.0.0/15 | US | arin | 2017-12-20"'; L10='"16509 | 3.64.0.0/10 | US | arin | 2017-12-20"'
for x in "$L15"$'\n'"$L10" "$L10"$'\n'"$L15" "$L10"; do
    N=$((N + 1)); cymru_line "$x"; w=$([ "$x" = "$L10" ] && echo "$L10" || echo "$L15")
    if [ "$REPLY" = "$w" ]; then echo "  ✓ cymru_line: $(printf '%s' "$x" | grep -o '/[0-9]*' | tr '\n' ' ')→ $(grep -o '[0-9.]*/[0-9]*' <<< "$REPLY")"
    else F=$((F + 1)); echo "  ✗ cymru_line: $(printf '%s' "$x" | tr '\n' ' ') → $REPLY (beklenen $w)"; fi
done
# mangle PREROUTING sırası (sondaki boşluklu iptables çıktısı, önce ekle sonra sil): ayrı betik, taklit iptables
N=$((N + 1)); if ms=$(bash "$H/mangle-sira.sh" 2>&1); then echo "  ✓ ${ms##*$'\n'}"; else F=$((F + 1)); printf '%s\n' "$ms" | grep '✗'; fi
echo "Birim: $N durum, $F beklenmeyen"; [ "$F" -eq 0 ]
