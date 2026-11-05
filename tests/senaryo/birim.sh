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
    if [ "$r" = "imap it|it|1|sync" ]; then echo "  ✓ Türkçe modda harf çevirisi İngilizce kuralla: $r (düz tr_TR: $d)"
    else F=$((F + 1)); echo "  ✗ Türkçe modda harf çevirisi: $r (beklenen imap it|it|1|sync; düz tr_TR: $d)"; fi
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
# tek tırnaklı programın (awk …) içindeki yorumda kesme işareti tırnağı kapatır; bash -n yakalamaz (dört kez oldu)
for f in "$REPO/csf_autogroup.sh" "$REPO"/tools/*.sh; do
    N=$((N + 1)); k=$(awk -f "$(dirname "$0")/tirnak.awk" "$f" | head -n 1)
    if [ -z "$k" ]; then echo "  ✓ tırnak içi yorumda kesme işareti yok: $(basename "$f")"; else F=$((F + 1)); echo "  ✗ $(basename "$f") $k"; fi
done
echo "Birim: $N durum, $F beklenmeyen"; [ "$F" -eq 0 ]
