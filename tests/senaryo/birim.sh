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
# tek tırnaklı programın (awk …) içindeki yorumda kesme işareti tırnağı kapatır; bash -n yakalamaz (dört kez oldu)
for f in "$REPO/csf_autogroup.sh" "$REPO"/tools/*.sh; do
    N=$((N + 1)); k=$(awk -f "$(dirname "$0")/tirnak.awk" "$f" | head -n 1)
    if [ -z "$k" ]; then echo "  ✓ tırnak içi yorumda kesme işareti yok: $(basename "$f")"; else F=$((F + 1)); echo "  ✗ $(basename "$f") $k"; fi
done
echo "Birim: $N durum, $F beklenmeyen"; [ "$F" -eq 0 ]
