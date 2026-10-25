#!/bin/bash
# Durum × ekran tablosu: panelin her ekranının (IP kartı, Dikkat edilecekler, Aktif blok banları, İzlenenler,
# Geçmiş menüsü, banla penceresi) her ban durumunda hangi eylemleri sunduğunu motorun gerçek çıktısıyla çıkarır
# ve kurallara göre denetler (render.js). Sunucuda değil, geliştirme makinesinde çalışır; bash ve node gerekir.
# CSF, DNS ve diğer dış araçlar bin/ altındaki taklitlerdir; hiçbir şey sisteme yazılmaz.
#
#   bash tests/durum-tablosu/calistir.sh        tablo + kural sonucu
#   bash tests/durum-tablosu/calistir.sh -q     yalnız kural sonucu (ihlal varsa çıkış kodu 1)
#
# Senaryolar: ağ 151.80.0.0/16, blok 151.80.7.0/24, IP 151.80.7.9 (taklit DNS'te AS16276, FR).
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
W="$(mktemp -d)"; trap '[ -n "${AG_KEEP:-}" ] && echo "kökler duruyor: $W" || rm -rf "$W"' EXIT   # AG_KEEP=1: inceleme için kökler silinmez
mkdir -p "$W/out" "$W/bin"; cp "$H"/bin/* "$W/bin/"; chmod +x "$W"/bin/*
wp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
NOW=$(date +%s); DT=$(LC_ALL=C date '+%a %b %d %H:%M:%S %Y')

mk() {   # ad → temiz kök: boş listeler, sınırlar, taklit araçlar
    R="$W/roots/$1"; mkdir -p "$R/app" "$R/etc/csf" "$R/var/lib/csf" "$R/var/lib/csf_autogroup"
    D="$R/etc/csf/csf.deny"; T="$R/var/lib/csf/csf.tempban"; A="$R/etc/csf/csf.allow"; C="$R/var/lib/csf_autogroup/counter"
    : > "$D"; : > "$T"; : > "$C"; printf '127.0.0.1\n' > "$A"; : > "$R/etc/csf/csf.ignore"; : > "$R/etc/csf/csf.rignore"
    printf '%s\n' 'DENY_IP_LIMIT = "200"' 'DENY_TEMP_IP_LIMIT = "100"' > "$R/etc/csf/csf.conf"
    cp "$REPO/csf_autogroup.sh" "$R/app/csf_autogroup.sh"
    printf '%s\n' "MSG_LANG=tr" "ALERT_MAIL=" "DENY_FILE=$D" "CSF_CONF=$R/etc/csf/csf.conf" "CSF_BIN=$W/bin/csf" \
        "CSF_VAR=$R/var/lib/csf" "LOG_FILE=$R/autogroup.log" "SAYAC_FILE=$C" "IMUNIFY_BIN=$W/bin/imunify360-agent" > "$R/app/config.env"
}
run() { env SIM_ROOT="$R" PATH="$W/bin:/usr/bin:/bin" AG_BY=root bash "$R/app/csf_autogroup.sh" "$@"; }
single() { printf '%s\n' "$1 # lfd: ($2) Failed login from $1 (FR/France/-): 5 in the last 3600 secs - ${3:-$DT}" >> "$D"; }   # 3. parametre: tarih
dump() {
    run --status --json > "$W/out/$1.status.json" 2>/dev/null
    run --lookup 151.80.7.9 --json > "$W/out/$1.lookup.json" 2>/dev/null
    run --inside 151.80.7.0/24 --json > "$W/out/$1.in24.json" 2>/dev/null
    run --inside 151.80.0.0/16 --json > "$W/out/$1.in16.json" 2>/dev/null
}
quiet() { run "$@" >/dev/null 2>&1; }

mk none;       dump none
mk single;     single 151.80.7.9 sshd; dump single
mk temp;       printf '%s\n' "$NOW|151.80.7.9||in|3600|lfd: (sshd) Failed SSH login from 151.80.7.9" >> "$T"; dump temp
mk watched;    printf '%s\n' "$NOW|151.80.7.0/24||inout|43200|csf_autogroup: temp block 151.80.7.0/24" >> "$T"
               printf '%s\n' "151.80.7 $(date +%F)" >> "$C"; dump watched
mk b24auto;    for x in 1 2 3 4 5 6; do single 151.80.7.$x sshd; done; quiet; dump b24auto
mk b24full;    quiet --action ban24 151.80.7; dump b24full
mk b24part;    quiet --action ban24 151.80.7 --mode svc --svc web; dump b24part
mk b16full;    quiet --action ban16 151.80; dump b16full
mk b16part;    quiet --action ban16 151.80 --mode svc --svc ssh; dump b16part
mk b16p_b24f;  quiet --action ban16 151.80 --mode svc --svc ssh; quiet --action ban24 151.80.7; dump b16p_b24f
mk b16f_other; printf '%s\n' "151.80.0.0/16 # Manually denied: hosting range - $DT" >> "$D"; single 151.80.8.4 sshd; dump b16f_other
mk cc;         printf '%s\n' 'CC_DENY = "FR"' >> "$R/etc/csf/csf.conf"; single 151.80.7.5 sshd; quiet; dump cc
mk wl;         printf '%s\n' "151.80.7.0/24 # müşteri" >> "$A"; for x in 1 2 3 4 5 6; do single 151.80.7.$x sshd; done; quiet; dump wl
mk review16;   for x in 7.1 7.2 8.1 8.2 9.1 10.1; do single 151.80.$x sshd; done; quiet; dump review16

# ── motor kuralları (ekran dışı): yazılan satırlar ve uyarılar ──
MF=0; ML=""
mcheck() { [ -n "$2" ] || { ML+="  ✗ motor: $1 (kuralın komutu boş)"$'\n'; MF=$((MF + 1)); return; }   # tırnak hatası sessizce geçmesin
    if eval "$2"; then ML+="  ✓ $1"$'\n'; else ML+="  ✗ motor: $1"$'\n'; MF=$((MF + 1)); fi; }
R="$W/roots/b24part"
mcheck "web kısmi banı UDP 443'ü de kapatır (HTTP/3)" "grep -q '^udp|in|d=443|s=151.80.7.0/24 ' '$R/etc/csf/csf.deny'"
mk b24exc; quiet --action ban24 151.80.7 --mode exc --svc web
mcheck "istisnada Web açıkken UDP 443 iki yönde açık" "grep -q '^udp|in|d=443|s=151.80.7.0/24 ' '$A' && grep -q '^udp|out|s=443|d=151.80.7.0/24 ' '$A'"
mk oldpart;    for x in 7.1 7.2 8.1 8.2 9.1 10.1; do single 151.80.$x sshd; done; quiet --action ban16 151.80 --mode svc --svc web --keep; quiet
mcheck "kısmi bandan önceki tekiller şüpheli ağ uyarısı üretmez" "! grep -q '\"type\":\"warn16\",\"cidr\":\"151.80.0.0/16\"' '$R/var/lib/csf_autogroup/events.jsonl'"
printf 'WARN16_151.80 %s\n' "$(date +%F)" >> "$C"          # bugün bandan önce bildirilmiş say
for x in 20.1 21.1 22.1 23.1 24.1; do printf '%s|151.80.%s||in|3600|lfd: (sshd) Failed SSH login from 151.80.%s\n' "$(( $(date +%s) + 5 ))" "$x" "$x" >> "$T"; done
quiet
mcheck "kısmi bandan sonraki yeni saldırılar aynı gün de bildirilir" "grep -q '\"type\":\"warn16\",\"cidr\":\"151.80.0.0/16\".*\"after\":' '$R/var/lib/csf_autogroup/events.jsonl'"
mk legacy;     printf '%s\n' "tcp|in|d=80,443|s=151.80.0.0/16 # csf_autogroup: elle /16 kısmi ban (root) [svc=web] - do not delete - $DT" >> "$D"; quiet; quiet
mcheck "eski kısmi web banına UDP 443 bir kez eklenir" "[ \$(grep -c '^udp|in|d=443|s=151.80.0.0/16 ' '$D') = 1 ]"

# sağlayıcı banı: elle kurulmuş olan devralınır (CSF'e dokunulmaz), kapatınca yalnız eklentinin eklediği kalkar,
# CC_DENY_PORTS'ta farklı portlu başka kayıt varsa hiçbir şey değişmez
mk prov;       printf '%s\n' 'CC_DENY = "VN"' 'CC_DENY_PORTS = "AS396982"' 'CC_DENY_PORTS_TCP = "80,443"' 'CC_DENY_PORTS_UDP = "443"' >> "$R/etc/csf/csf.conf"
before=$(grep '^CC_DENY' "$R/etc/csf/csf.conf"); quiet
mcheck "elle kurulmuş sağlayıcı banı devralınır, CSF ayarı değişmez" "[ \"\$(grep '^CC_DENY' '$R/etc/csf/csf.conf')\" = \"\$before\" ]"
quiet --config set ASN_BAN=0; quiet --prov-apply
mcheck "sağlayıcı banı kapatılınca yalnız eklentinin eklediği kalkar" "grep -q '^CC_DENY = \"VN\"' '$R/etc/csf/csf.conf' && grep -q '^CC_DENY_PORTS = \"\"' '$R/etc/csf/csf.conf'"
sed -i 's/^CC_DENY_PORTS = .*/CC_DENY_PORTS = "CN"/; s/^CC_DENY_PORTS_TCP = .*/CC_DENY_PORTS_TCP = "22,25"/' "$R/etc/csf/csf.conf"
quiet --config set ASN_BAN=1 ASN_LIST=AS396982 ASN_MODE=web; quiet --prov-apply
mk prov2;      printf '%s\n' 'CC_DENY = "VN"' 'CC_DENY_PORTS = "AS396982"' 'CC_DENY_PORTS_TCP = "80,443"' 'CC_DENY_PORTS_UDP = "443"' >> "$R/etc/csf/csf.conf"
quiet --config set ASN_ALL=AS14061; quiet --prov-apply
mcheck "tek sağlayıcı ayarı kaydedilince diğerleri yerinde kalır (port listeli ASN kalkmaz)" "grep -q '^CC_DENY_PORTS = \"AS396982\"' '$R/etc/csf/csf.conf' && grep -q '^CC_DENY = \"VN,AS14061\"' '$R/etc/csf/csf.conf'"
sed -i 's/^CC_DENY_PORTS_TCP = .*/CC_DENY_PORTS_TCP = "22,25"/' "$R/etc/csf/csf.conf"; quiet --prov-apply
mcheck "CSF'te elle değiştirilen port listesi istek sanılmaz (kaydedilmiş liste geri yazılır)" "grep -q '^CC_DENY_PORTS_TCP = \"80,443\"' '$R/etc/csf/csf.conf'"
mk prov3;      printf '%s\n' 'CC_DENY = "VN"' 'CC_DENY_PORTS = ""' 'CC_DENY_PORTS_TCP = "22"' 'CC_DENY_PORTS_UDP = ""' >> "$R/etc/csf/csf.conf"
quiet --config set ASN_BAN=1 ASN_ALL=AS2; quiet --prov-apply; quiet --prov-apply
mcheck "yalnız 'her şey' sağlayıcısı varken kullanıcının port listesine dokunulmaz" "grep -q '^CC_DENY_PORTS_TCP = \"22\"' '$R/etc/csf/csf.conf'"
R="$W/roots/prov"
mcheck "ortak port listesi çakışmasında CSF ayarı değişmez" "grep -q '^CC_DENY_PORTS = \"CN\"' '$R/etc/csf/csf.conf' && grep -q '^CC_DENY_PORTS_TCP = \"22,25\"' '$R/etc/csf/csf.conf'"

# Kontrol edilecekler eskiyen kaydı bugünkü veriyle yeniden sınar: olay kaydından önceki (yalnız sayaçta tarihli) şüpheli ağ
# uyarısı, ölçütü bugün tutmuyorsa ya da saldırılan servisi başka bir katman kapatıyorsa listede kalmaz
rvhas() { run --status --json 2>/dev/null | grep -o '"review":\[.*\],"ignored"' | grep -q "\"cidr\":\"$1\""; }
mk rvstale;   printf 'WARN16_151.80 %s\n' "$(date -d '-3 days' +%F)" >> "$C"; single 151.80.7.1 sshd; single 151.80.8.1 sshd
mcheck "eski uyarı: tekilleri eşiğin altına inmişse Kontrol edilecekler'de kalmaz" "! rvhas 151.80.0.0/16"
mk rvgone;    printf 'WARN16_151.80 %s\n' "$(date -d '-3 days' +%F)" >> "$C"
mcheck "eski uyarı: dayandığı tekil banlar kalmamışsa listede kalmaz" "! rvhas 151.80.0.0/16"
mk rvcover;   printf 'WARN16_151.80 %s\n' "$(date -d '-3 days' +%F)" >> "$C"; printf '%s\n' 'CC_DENY = "FR"' >> "$R/etc/csf/csf.conf"
for x in 7.1 7.2 8.1 8.2 9.1; do single 151.80.$x sshd; done
for p in 7 8 9; do printf '151.80.%s|16276|FR|OVH - OVH SAS, FR|%s|151.80.0.0/16\n' "$p" "$NOW" >> "$R/var/lib/csf_autogroup/owners"; done   # sahibi bilinen IP'ler (sunucudaki gibi)
mcheck "eski uyarı: saldırılan servisi ülke/sağlayıcı/kiralık liste kapatıyorsa listede kalmaz" "! rvhas 151.80.0.0/16"
mk rvkeep;    printf 'WARN16_151.80 %s\n' "$(date -d '-3 days' +%F)" >> "$C"; for x in 7.1 7.2 8.1 8.2 9.1; do single 151.80.$x sshd; done
mcheck "eski uyarı: ölçütü bugün de tutuyorsa IP listesi ve servisiyle kalır" "run --status --json 2>/dev/null | grep -q '\"cidr\":\"151.80.0.0/16\",\"day\":\"[0-9-]*\",\"hist\":true[^]]*\"n\":5[^]]*\"svc\":\"ssh\"'"
# İzinli ama saldıran (lfd günlüğü; biçimler gerçek lfd 16.33'te ölçüldü): her saldırgan en geniş tutan grupta bir kez
lfdl() { printf '%s lin lfd[1001]: %s\n' "$(LC_ALL=C date -d "@$(( NOW - $1 ))" '+%b %e %H:%M:%S')" "$2" >> "$R/lfd.log"; }
lfdb() { lfdl "$1" "(sshd) Failed SSH login from $2 (FR/France/-): 5 in the last 3600 secs - *Blocked in csf* for 43200 secs [LF_SSHD]"; }
lfdi() { lfdl "$1" "Failed SSH login from $2 - ignored"; }
rvrow() { run --status --json 2>/dev/null | grep -o '"review":\[.*\],"ignored"' | sed 's/^"review":\[//; s/,{"t":/\n{"t":/g' | grep -E "^\{\"t\":[0-9]+,\"type\":\"[a-z_0-9]+\",\"cidr\":\"$1\"" | head -n 1; }   # satır başına bir kayıt
mkl() { mk "$1"; echo "LFD_LOG=$R/lfd.log" >> "$R/app/config.env"; : > "$R/lfd.log"; }
mkl aab;  printf '151.80.7.9 # müşteri\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "izinli IP lfd'de banlandı → 'Ban işlemiyor' (tam izin)" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\".*\"bk\":\"b\".*\"full\":1'"
# satır, panelin yazdığı düşme anında düşer (son kayıt + REVIEW_DAYS, saatiyle): motor kayıtları gün gün topluyor, pencerenin
# ilk gününü bütünüyle tuttuğu için satır bir gün geç düşüyordu (kullanıcı: "24 Eki'de düşer" yazıyor, 24 Eki'de duruyor)
mkl aadrop1; printf '151.80.7.9 # müşteri\n' >> "$A"; lfdi $(( 7 * 86400 + 3600 )) 151.80.7.9
mcheck "izinli IP satırı: son kayıt 7 gün + 1 saat önce → listeden düşmüş (panelin düşme tarihiyle aynı)" "[ -z \"\$(rvrow 151.80.7.9)\" ]"
mkl aadrop2; printf '151.80.7.9 # müşteri\n' >> "$A"; lfdi $(( 7 * 86400 - 3600 )) 151.80.7.9
mcheck "izinli IP satırı: son kayıt 7 gün − 1 saat önce → hâlâ listede" "[ -n \"\$(rvrow 151.80.7.9)\" ]"
mkl aai;  printf '151.80.7.9 # müşteri\n' >> "$A"; for x in 1 2 3; do lfdi $(( 600 * x )) 151.80.7.9; done
mcheck "IGNORE_ALLOW açıkken izinli IP yoksayıldı → 'lfd yoksaydı', 3 kez, tam izin" "rvrow 151.80.7.9 | grep -q '\"bk\":\"i\",\"cnt\":3,\"full\":1'"
rvt() { local r a b; r=$(rvrow "$1"); a="${r#*\"t\":}"; a="${a%%,*}"; b="${r#*\"ips\":[}"; b="${b#*\"t\":}"; b="${b%%,*}"; echo $((b - a)); }   # IP'nin son kaydı − satırın zamanı (saniye)
mcheck "izinli IP satırı: İşaretlendi ilk kayıt (30 dk önce), IP'nin zamanı son kayıt (10 dk önce)" "d=\$(rvt 151.80.7.9); [ \$d -ge 1150 ] && [ \$d -le 1250 ]"
mkl aay;  printf '151.80.7.9\n' >> "$R/etc/csf/csf.ignore"; lfdi 600 151.80.7.9
mcheck "csf.ignore IP'si yoksayıldı → 'Yoksayılıyor' (tam izin değil: elle ban işler)" "rvrow 151.80.7.9 | grep -q '\"bk\":\"i\",\"cnt\":1,\"full\":0'"
# Geçmiş'e kalıcı kayıt: tur, izinli IP'den ihlali IP başına günde bir olay olarak yazar (ikinci tur tekrar yazmaz)
mkl aaev; printf '151.80.7.9 # müşteri\n' >> "$A"; lfdb 3600 151.80.7.9; quiet; quiet
mcheck "izinli IP'den ihlal: tur Geçmiş'e bir olay yazar (ssh, ban işlemiyor, 1 kez); ikinci tur tekrarlamaz" "[ \$(grep -c '\"type\":\"allow_viol\",\"cidr\":\"151.80.7.9\",\"svc\":\"ssh\",\"n\":1,\"kind\":\"b\"' '$R/var/lib/csf_autogroup/events.jsonl') = 1 ]"
# web kısmi banından sonra 2 kalıcı + 1 geçici SSH tekili (hiçbir eşik tek başına dolmaz, blok banlanmaz): açık servis
mk poev; quiet --action ban24 151.80.7 --mode svc --svc web; DT2=$(LC_ALL=C date -d '+2 min' '+%a %b %d %H:%M:%S %Y'); for x in 1 2; do single 151.80.7.$x sshd "$DT2"; done
printf '%s|151.80.7.3||in|3600|lfd: (sshd) Failed SSH login from 151.80.7.3\n' "$(( $(date +%s) + 5 ))" >> "$T"; quiet; quiet
mcheck "açık servis: tur Geçmiş'e bir olay yazar (web kısmi banından sonra 3 SSH ihlali); ikinci tur tekrarlamaz" "[ \$(grep -c '\"type\":\"part_open\",\"cidr\":\"151.80.7.0/24\",\"svc\":\"web\".*\"n\":3' '$R/var/lib/csf_autogroup/events.jsonl') = 1 ]"
mkl aaevd; lfdb 3600 151.80.7.9; quiet
mcheck "izinsiz IP'nin banı işliyor: Geçmiş'e izinli ihlal olayı yazılmaz" "! grep -q '\"type\":\"allow_viol\"' '$R/var/lib/csf_autogroup/events.jsonl'"
# e-posta sınıfları (IE_*): tur bildirimi kapalıyken blok banı mail yazmaz; liste doluyor uyarısı aynı turda yine gider, ban bölümü girmez
mkm() { mk "$1"; sed -i 's/^ALERT_MAIL=$/ALERT_MAIL=root@test.invalid/' "$R/app/config.env"; printf '%s\n' "SENDMAIL_BIN=$W/bin/sendmail" "DIGEST=0" "IE_RUN=$2" "LFD_LOG=$R/lfd.log" >> "$R/app/config.env"; : > "$R/lfd.log"; }   # boş lfd günlüğü: makinenin gerçek lfd.log'u maile karışmasın
mtext() { awk '/^Content-Type: text\/plain/ { f = 1 } f && /^--/ { exit } f && !/^Content-/ && NF' "$R/mails/01.eml" | base64 -d 2>/dev/null; }   # ilk mailin düz metni
mkm mailcat1 1; for x in 1 2 3; do single 151.80.7.$x sshd; done; quiet
mcheck "IE_RUN=1: blok banı yazan tur bir e-posta gönderir, blok içinde" "[ \$(grep -c sendmail '$R/mail_calls.log') = 1 ] && mtext | grep -q '151.80.7.0/24'"
mkm mailcat0 0; for x in 1 2 3; do single 151.80.7.$x sshd; done; quiet
mcheck "IE_RUN=0: aynı tur e-posta göndermez" "[ ! -e '$R/mail_calls.log' ]"
mkm mailcatl 0; printf '%s\n' 'DENY_IP_LIMIT = "4"' 'DENY_TEMP_IP_LIMIT = "100"' > "$R/etc/csf/csf.conf"; for x in 1 2 3 4; do single 151.80.7.$x sshd; done; quiet
mcheck "IE_RUN=0, IE_LISTFULL=1: liste doluyor uyarısı tek mailde gider, blok banı bölümü girmez" "[ \$(grep -c sendmail '$R/mail_calls.log') = 1 ] && mtext | grep -q 'csf.deny' && ! mtext | grep -q '151.80.7.0/24'"
# izinli IP'den ihlal: kendi sınıfı (IE_REVIEW), maildeki izin kaydı panelle aynı (satır yorumuyla); yoksayılan IP bildirilmez
mkav() { mkm "$1" 1; echo "LFD_LOG=$R/lfd.log" >> "$R/app/config.env"; : > "$R/lfd.log"; printf '151.80.7.9 # Ofis yedek - Tue Oct 31 2023\n' >> "$A"; lfdb 3600 151.80.7.9; }
mkav avmail; quiet
mcheck "izinli IP ihlali: mail gider, izin kaydı yorumuyla (panelle aynı); olay kaynağında da yorum" "mtext | grep -q '151.80.7.9.*csf.allow: 151.80.7.9 (Ofis yedek - Tue Oct 31 2023)' && grep -q '\"type\":\"allow_viol\".*Ofis yedek' '$R/var/lib/csf_autogroup/events.jsonl'"
mkav avcat; echo "IE_REVIEW=0" >> "$R/app/config.env"; quiet
mcheck "IE_REVIEW=0: izinli IP ihlali mail yazmaz (IE_RUN açık olsa da), Geçmiş'e yine yazılır" "[ ! -e '$R/mail_calls.log' ] && grep -q '\"type\":\"allow_viol\"' '$R/var/lib/csf_autogroup/events.jsonl'"
mkav avign; quiet --action ignore 151.80.7.9 0; quiet
mcheck "yoksayılan IP: izinli ihlal olayı da maili de yazılmaz" "[ ! -e '$R/mail_calls.log' ] && ! grep -q '\"type\":\"allow_viol\"' '$R/var/lib/csf_autogroup/events.jsonl'"
mkav avign2; printf '151.80.7.0/25 9999-12-31 root\n' > "$R/var/lib/csf_autogroup/ignored"; quiet
mcheck "IP'yi içine alan yoksayılmış aralık da bildirimi durdurur (panelle aynı kural)" "[ ! -e '$R/mail_calls.log' ] && ! grep -q '\"type\":\"allow_viol\"' '$R/var/lib/csf_autogroup/events.jsonl'"
# yoksayma kaydı kimi ve zamanı taşır; eski satırda zaman olay kaydından
mk igsince; quiet --action ignore 151.80.7.9 0
mcheck "yoksayma: Yoksayılanlar kaydında yoksayan ve zaman, IP kartında da" "run --status --json 2>/dev/null | grep -q '\"cidr\":\"151.80.7.9\",\"until\":\"9999-12-31\",\"by\":\"root\",\"since\":[0-9]' && run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"ign_by\":\"root\".*\"ign_t\":[0-9]'"
mk igold; quiet --action ignore 151.80.7.9 0; sed -i 's/^\(151\.80\.7\.9 [^ ]* [^ ]*\) [0-9]*$/\1/' "$R/var/lib/csf_autogroup/ignored"
mcheck "1.15.3 öncesi yoksayma satırı (zaman alanı yok): zaman olay kaydından" "grep -qx '151.80.7.9 9999-12-31 root' '$R/var/lib/csf_autogroup/ignored' && run --status --json 2>/dev/null | grep -q '\"cidr\":\"151.80.7.9\",\"until\":\"9999-12-31\",\"by\":\"root\",\"since\":[0-9]'"
mk igskip; printf '151.80.7.0/24 # müşteri\n' >> "$A"; printf '151.80.7.0/24 9999-12-31 root 1\n' > "$R/var/lib/csf_autogroup/ignored"; for x in 1 2 3 4 5 6; do single 151.80.7.$x sshd; done; quiet
mcheck "yoksayılan aralık izin yüzünden atlansa da 'atlandı' olayı/bildirimi yazılmaz" "! grep -q '\"type\":\"skip_wl\"' '$R/var/lib/csf_autogroup/events.jsonl'"
mkl aano; lfdb 3600 151.80.7.9
mcheck "izinsiz IP banlandı → ban işliyor, listede yok" "[ -z \"\$(rvrow 151.80.7.9)\" ]"
mkl aaport; printf 'tcp|in|d=22|s=151.80.7.9 # müşteri yalnız SSH\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "tek portluk izin: ban öteki portlarda işler → listede yok" "[ -z \"\$(rvrow 151.80.7.9)\" ]"
mkl aagrp; printf '151.80.7.0/25 # müşteri ağı\n' >> "$A"; lfdb 3600 151.80.7.9; lfdb 3000 151.80.7.20
mcheck "izin aralığından 2 IP → tek 'İzinli aralık' satırı (IP'ler altında)" "rvrow 151.80.7.0/25 | grep -q '\"type\":\"allow_grp\".*\"aa\":2' && [ -z \"\$(rvrow 151.80.7.9)\" ]"
mkl aamix; printf '151.80.7.9\n151.80.7.10\n' >> "$A"; lfdb 3600 151.80.7.9; lfdb 3000 151.80.7.10; single 151.80.7.30 sshd
mcheck "/24'te 2 izinli + 1 izinsiz tekil (blok eşiği) → 'Atlandı', 2'si izinli" "rvrow 151.80.7.0/24 | grep -q '\"type\":\"skip_wl\".*\"aa\":2'"
mkl aaold; printf '151.80.7.9 # müşteri\n' >> "$A"; lfdb $(( 9 * 86400 )) 151.80.7.9
mcheck "7 günden eski kayıt → listede yok" "[ -z \"\$(rvrow 151.80.7.9)\" ]"
mkl aarot; printf '151.80.7.9 # müşteri\n' >> "$A"; lfdb 172800 151.80.7.9; mv "$R/lfd.log" "$R/lfd.log.1"; gzip -f "$R/lfd.log.1"; : > "$R/lfd.log"
mcheck "döndürülmüş, sıkıştırılmış günlük (lfd.log.1.gz) sayılır" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\"'"
# Sunucunun kendi IP'si (taklit ip: 203.0.113.10; günlük tarihleri bugün: yalnız Kontrol edilecekler penceresi sayılır): lfd kendi adreslerini her zaman yoksayar → full=2; posta günlüğünden
# (csf.conf SMTPAUTH_LOG, exim biçimi) hangi hesapla denendiği, çoktan aza
mkl aaself; for x in 1 2 3; do lfdl $(( 600 * x )) "Failed SMTP AUTH login from 203.0.113.10 - ignored"; done
printf 'SMTPAUTH_LOG = "%s"\n' "$R/exim_mainlog" >> "$R/etc/csf/csf.conf"
printf '%s\n' "$(date +%F)"' 13:34:31 dovecot_login authenticator failed for H=(site-a.example) [203.0.113.10]:56816: 535 Incorrect authentication data (set_id=info@site-a.example)' \
    "$(date +%F)"' 14:48:59 dovecot_login authenticator failed for H=(site-b.example) [203.0.113.10]:36256: 535 Incorrect authentication data (set_id=info@site-b.example)' \
    "$(date +%F)"' 05:07:23 dovecot_login authenticator failed for H=(site-a.example) [203.0.113.10]:38634: 535 Incorrect authentication data (set_id=info@site-a.example)' \
    "$(date +%F)"' 06:00:00 dovecot_login authenticator failed for H=(x) [203.0.113.99]:1: 535 Incorrect authentication data (set_id=baska@site.example)' > "$R/exim_mainlog"
mcheck "sunucunun kendi IP'si yoksayıldı → 'Sunucunun kendi IP'si' (full=2), kaynak 'sunucu IP'si'" "rvrow 203.0.113.10 | grep -q '\"wl\":\"sunucu IP.si: 203.0.113.10\".*\"bk\":\"i\",\"cnt\":3,\"full\":2'"
mcheck "kendi IP'si: posta günlüğündeki hesaplar çoktan aza, yalnız bu IP'ninkiler" "rvrow 203.0.113.10 | grep -q '\"acct\":\[{\"u\":\"info@site-a.example\",\"n\":2},{\"u\":\"info@site-b.example\",\"n\":1}\],\"acctf\":\"exim_mainlog\"'"
# dovecot (POP3D_LOG / IMAPD_LOG, aynı dosya bir kez okunur): user=<hesap> … rip=IP; satır başına bir deneme (lfd gibi); exim ile birleşir
mkl aaselfd; lfdl 600 "Failed IMAP login from 203.0.113.10 - ignored"
printf 'SMTPAUTH_LOG = "%s"\nPOP3D_LOG = "%s"\nIMAPD_LOG = "%s"\n' "$R/exim_mainlog" "$R/maillog" "$R/maillog" >> "$R/etc/csf/csf.conf"
printf '%s\n' "$(date +%F)"' 05:07:23 dovecot_login authenticator failed for H=(site-a.example) [203.0.113.10]:38634: 535 Incorrect authentication data (set_id=info@site-a.example)' > "$R/exim_mainlog"
printf '%s\n' "$(LC_ALL=C date '+%b %e')"' 04:28:26 lin dovecot[570645]: imap-login: Login aborted: Connection closed (auth failed, 3 attempts in 21 secs) (auth_failed): user=<info@site-c.example>, method=PLAIN, rip=203.0.113.10, lip=203.0.113.10, TLS, session=<a>' \
    "$(LC_ALL=C date '+%b %e')"' 04:28:46 lin dovecot[570645]: pop3-login: Login aborted: Connection closed (auth failed, 1 attempts in 2 secs) (auth_failed): user=<info@site-a.example>, method=PLAIN, rip=203.0.113.10, lip=203.0.113.10, TLS, session=<b>' \
    "$(LC_ALL=C date '+%b %e')"' 04:29:00 lin dovecot[570645]: imap-login: Login aborted: Connection closed (auth failed, 3 attempts in 18 secs) (auth_failed): user=<info>, method=PLAIN, rip=203.0.113.100, lip=203.0.113.10, TLS, session=<c>' > "$R/maillog"
mcheck "kendi IP'si: dovecot satırı lfd gibi bir deneme sayılır, exim'inkilerle birleşir (1 + 1, 1), kaynak dosyalar" "rvrow 203.0.113.10 | grep -q '\"acct\":\[{\"u\":\"info@site-a.example\",\"n\":2},{\"u\":\"info@site-c.example\",\"n\":1}\],\"acctf\":\"exim_mainlog, maillog\"'"
# döndürülmüş günlük (exim_mainlog-YYYYMMDD.gz, pencere içinde): hesaplar oradan da okunur, kaynak adı asıl dosya
mkl aaselfr; lfdl 600 "Failed SMTP AUTH login from 203.0.113.10 - ignored"
printf 'SMTPAUTH_LOG = "%s"\n' "$R/exim_mainlog" >> "$R/etc/csf/csf.conf"; : > "$R/exim_mainlog"
printf '%s\n' "$(date -d '-2 days' +%F)"' 05:07:23 dovecot_login authenticator failed for H=(site-r.example) [203.0.113.10]:38634: 535 Incorrect authentication data (set_id=info@site-r.example)' > "$R/exim_mainlog-20261011"; gzip -f "$R/exim_mainlog-20261011"
mcheck "kendi IP'si: döndürülmüş (gz) posta günlüğündeki hesap da listelenir, kaynak adı asıl dosya" "rvrow 203.0.113.10 | grep -q '\"acct\":\[{\"u\":\"info@site-r.example\",\"n\":1}\],\"acctf\":\"exim_mainlog\"'"
mkl aaselfa; printf '203.0.113.10 # kendi\n' >> "$A"; lfdl 600 "Failed SMTP AUTH login from 203.0.113.10 - ignored"
mcheck "kendi IP'si csf.allow'da da olsa önce 'sunucu IP'si' sayılır" "rvrow 203.0.113.10 | grep -q '\"wl\":\"sunucu IP.si: 203.0.113.10\".*\"full\":2'"
# Denemeler her IP için (sunucu IP'si değil de): durum haritası (IP listeleri), IP kartı, mail satırları. Tarihler bugün:
# yalnız Kontrol edilecekler penceresindeki satırlar sayılır
DTI=$(date '+%F %T'); DTS=$(LC_ALL=C date '+%b %e %H:%M:%S'); DTA=$(LC_ALL=C date '+%a %b %d %H:%M:%S.000000 %Y')
amail() { printf 'SMTPAUTH_LOG = "%s"\n' "$R/exim_mainlog" >> "$R/etc/csf/csf.conf"
    printf '%s dovecot_login authenticator failed for H=(x) [%s]:1: 535 Incorrect authentication data (set_id=%s)\n' "$DTI" "$1" info@site-a.example "$DTI" "$1" info@site-a.example "$DTI" "$1" info@site-b.example "$DTI" 198.51.100.77 baska@site.example > "$R/exim_mainlog"; }
mkav avacct; amail 151.80.7.9; quiet
mcheck "izinli IP: durumda deneme haritası (yalnız ekrandaki IP'ler), mail satırında denenen posta hesapları" "run --status --json 2>/dev/null | grep -q '\"accts\":{\"151.80.7.9\":\[{\"s\":\"mail\",\"u\":\"info@site-a.example\",\"n\":2},{\"s\":\"mail\",\"u\":\"info@site-b.example\",\"n\":1}\]}' && mtext | grep -q 'denenen posta hesapları: info@site-a.example (2), info@site-b.example (1)'"
mk lkacct; amail 198.51.100.77
mcheck "IP kartı: listede olmayan IP'nin de denedikleri (terminal önbelleği kurar, sonra JSON)" "run --lookup 198.51.100.77 2>/dev/null | grep -q 'Denemeler *denenen posta hesapları: info@site-a.example (2), baska@site.example (1), info@site-b.example (1)' && run --lookup 198.51.100.77 --json 2>/dev/null | grep -q '\"acct\":\[{\"s\":\"mail\",\"u\":\"info@site-a.example\",\"n\":2},{\"s\":\"mail\",\"u\":\"baska@site.example\",\"n\":1},{\"s\":\"mail\",\"u\":\"info@site-b.example\",\"n\":1}\]'"
mkm mailacct 1; amail 151.80.7.1; for x in 1 2 3; do single 151.80.7.$x sshd; done; quiet
mcheck "blok banı maili: tekil satırında denenen posta hesapları" "mtext | grep -q '151.80.7.1 .*denenen posta hesapları: info@site-a.example (2)'"
mk acold; printf 'SMTPAUTH_LOG = "%s"\n' "$R/exim_mainlog" >> "$R/etc/csf/csf.conf"
printf '%s dovecot_login authenticator failed for H=(x) [198.51.100.77]:1: 535 Incorrect authentication data (set_id=eski@site.example)\n' "$(date -d '-9 days' '+%F %T')" > "$R/exim_mainlog"
mcheck "Kontrol edilecekler penceresinden (7 gün) eski deneme sayılmaz" "! run --lookup 198.51.100.77 2>/dev/null | grep -q 'eski@site.example' && [ -e '$R/var/lib/csf_autogroup/denemeler' ] && ! run --lookup 198.51.100.77 --json 2>/dev/null | grep -q 'eski@site.example'"
mk acbg; amail 198.51.100.77
mcheck "panel (IP kartı JSON) önbellek yokken beklemez: kurulum arka planda, sonraki istekte denemeler gelir" "run --lookup 198.51.100.77 --json >/dev/null 2>&1; for i in 1 2 3 4 5 6 7 8 9 10; do [ -s '$R/var/lib/csf_autogroup/denemeler' ] && break; sleep 0.5; done; run --lookup 198.51.100.77 --json 2>/dev/null | grep -q '\"u\":\"baska@site.example\"'"
# SSH, FTP, cPanel/WHM, web şifresi, ModSecurity: örnek satırlar lfd'nin biçiminde (denemeler-ornek.txt; aşağıda lfd'nin kendi
# ayrıştırıcısıyla da karşılaştırılır). ModSecurity "Warning" satırları (404 izleme) lfd gibi sayılmaz; 2024 tarihli login_log satırı da.
ORNEK="$(dirname "$0")/denemeler-ornek.txt"
ornek() {
    local k e l f
    printf '%s\n' "SSHD_LOG = \"$R/secure\"" "FTPD_LOG = \"$R/messages\"" "CPANEL_LOG = \"$R/login_log\"" "MODSEC_LOG = \"$R/error_log\"" "HTACCESS_LOG = \"$R/error_log\"" >> "$R/etc/csf/csf.conf"
    while IFS=$'\t' read -r k e l; do
        l="${l//\{DTI\}/$DTI}"; l="${l//\{DTS\}/$DTS}"; l="${l//\{DTA\}/$DTA}"
        case "$k" in SSHD) f=secure ;; FTPD) f=messages ;; CPANEL) f=login_log ;; *) f=error_log ;; esac
        printf '%s\n' "$l" >> "$R/$f"
    done < "$ORNEK"
}
mk acall; ornek
AL=$(run --lookup 198.51.100.50 2>/dev/null | grep '^  Denemeler')
mcheck "SSH: lfd'nin saydığı satırlardaki kullanıcılar (sshd ve sshd-session; tanıtım dizgisi gelmeyen satır hesap taşımaz)" "grep -q 'denenen SSH kullanıcıları: root (2), admin (1), guest (1)' <<< \"\$AL\""
mcheck "FTP: pure-ftpd satırındaki hesap" "grep -q 'denenen FTP hesapları: admin (1)' <<< \"\$AL\""
mcheck "cPanel/WHM: hesap ve giriş türü, API anahtarı ayrı; 2024 tarihli satır sayılmaz" "grep -q 'denenen cPanel/WHM girişleri: root · WHM (1), root · WHM API (1)' <<< \"\$AL\" && ! grep -q eski <<< \"\$AL\""
mcheck "web şifresi (htpasswd): Apache 2.2 ve 2.4 biçimi (pid, client:port)" "grep -q 'denenen web şifresi kullanıcıları: webadmin (1), webadmin2 (1)' <<< \"\$AL\""
mcheck "ModSecurity: yalnız Access denied satırlarının site ve adresi; Warning (404 izleme) sayılmaz" "grep -q 'hedef: site-a.example /wp-login.php (2), site-b.example /x (1)' <<< \"\$AL\" && ! grep -q '/2399' <<< \"\$AL\""
mcheck "IP kartı JSON'unda servis ve web kuralı" "run --lookup 198.51.100.50 --json 2>/dev/null | grep -q '{\"s\":\"web\",\"u\":\"site-a.example /wp-login.php\",\"n\":2,\"i\":\"1302\"}'"
mkm acweb 1; ornek
printf '%s\n' "198.51.100.50 # lfd: (mod_security) mod_security (id:9999) triggered by 198.51.100.50 (FR/France/-): 5 in the last 3600 secs - $DT" >> "$D"
for x in 51 52; do single 198.51.100.$x sshd; done; quiet
mcheck "blok banı maili: ModSecurity tekilinde yalnız banı doğuran kuralın hedefi (id:9999 → site-b), öteki servisler de" "mtext | grep -q '198.51.100.50 .*denenen SSH kullanıcıları: root (2).*hedef: site-b.example /x (1)' && ! mtext | grep -q 'wp-login'"
# lfd'nin kendi ayrıştırıcısı (CSF kuruluysa): örnek satırları lfd de aynı IP ve hesapla sayıyor mu
if [ -r /usr/local/csf/lib/ConfigServer/RegexMain.pm ]; then
    LK=$(DTI="$DTI" DTS="$DTS" DTA="$DTA" "$(command -v /usr/local/cpanel/3rdparty/bin/perl || command -v perl)" "$(dirname "$0")/lfd-karsilastir.pl" "$ORNEK" 2>&1)
    mcheck "lfd'nin ayrıştırıcısı (RegexMain.pm) örnek satırları aynı IP ve hesapla sayıyor: $(tail -n 1 <<< "$LK")" "grep -q 'farklı yok' <<< \"\$LK\""
fi
# sunucu IP'si satırının hesapları da IP kartıyla aynı pencerede (satırın kendi tarihi)
mkl aaselfo; lfdl 600 "Failed SMTP AUTH login from 203.0.113.10 - ignored"; printf 'SMTPAUTH_LOG = "%s"\n' "$R/exim_mainlog" >> "$R/etc/csf/csf.conf"
printf '%s dovecot_login authenticator failed for H=(x) [203.0.113.10]:1: 535 Incorrect authentication data (set_id=%s)\n' "$(date '+%F %T')" yeni@site.example "$(date -d '-9 days' '+%F %T')" eski@site.example > "$R/exim_mainlog"
mcheck "sunucu IP'si satırı: 7 günden eski posta denemesi sayılmaz (IP kartıyla aynı)" "rvrow 203.0.113.10 | grep -q '\"acct\":\[{\"u\":\"yeni@site.example\",\"n\":1}\]'"
# IP kartı: aynı IP için tek portluk ve tam izin satırı varsa tam izin gösterilir (ban işlemez)
mk wlbest; printf '%s\n' 'tcp|in|d=22|s=151.80.7.9 # ssh ofis' '151.80.7.9 # tam izin' > "$A"
mcheck "IP kartı: tam izin satırı tek portluk satırdan önce (karar 'ban işlemiyor')" "run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"wl\":\"csf.allow: 151.80.7.9 (tam izin)\"'"
# İzinli IP'nin banı işlemez (CSF izni bandan önce uygular; csf -td izin denetlemez): hiçbir sayıma girmez
izgec() { printf '151.80.7.9 # musteri\n' >> "$A"; printf '%s|151.80.7.9||in|3600|lfd: (pop3d) Failed POP3 login from 151.80.7.9 (FR/France/-): 5 in the last 3600 secs\n' "$NOW" >> "$T"; }
mk izw16; izgec; for x in 7.1 8.1 8.2 9.1; do single 151.80.$x sshd; done; printf 'WARN16_151.80 %s\n' "$(date -d '-3 days' +%F)" >> "$C"
mcheck "izinli IP'nin geçici banı şüpheli ağ sayımına girmez (4 tekil + izinli IP, eşik 5: uyarı yok)" "! run --status --json 2>/dev/null | grep -q '\"cidr\":\"151.80.0.0/16\"'"
mcheck "Ayarlar → Eşikler etkisi ve IP kartının eşiğe uzaklığı izinli IP'nin banını saymaz" "run --status --json 2>/dev/null | grep -q '\"dist\":{\"151.80\":\[\"1:0\",\"1:0\",\"2:0\"\]}' && run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"blk\":{\"s\":1,\"t\":0,'"
mkm izblk 1; printf '151.80.7.9 # musteri\n' >> "$A"; for x in 7.1 7.2 7.9; do single 151.80.$x sshd; done; quiet
mcheck "blok eşiği: 2 tekil + izinli IP'nin kalıcı banı eşiği doldurmaz (ban da 'atlandı' satırı da yok)" "! grep -q '^151.80.7.0/24' '$D' && ! grep -q '\"type\":\"skip_wl\"' '$R/var/lib/csf_autogroup/events.jsonl' 2>/dev/null"
mk iztmp; izgec; for x in 1 2; do printf '%s|151.80.7.%s||in|3600|lfd: (sshd) Failed SSH login from 151.80.7.%s\n' "$NOW" "$x" "$x" >> "$T"; done; quiet
mcheck "geçici blok eşiği: 2 geçici tekil + izinli IP'nin geçici banı eşiği doldurmaz" "! grep -q '151.80.7.0/24' '$T'"
# lfd günlüğünde kaydı olmayan işlemeyen ban (izin bandan sonra eklenmiş, günlük dönmüş): yine "Ban işlemiyor" satırı
mkl izperm; printf '151.80.7.9 # musteri\n' >> "$A"; single 151.80.7.9 pop3d
mcheck "izinli IP'nin kalıcı banı, lfd günlüğünde kayıt yokken de 'Ban işlemiyor' satırı (izin kaydı, sebep)" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\".*\"why\":\"(pop3d) Failed login\".*\"al\":\"csf.allow: 151.80.7.9 (musteri)\",\"bk\":\"b\",\"cnt\":1,\"full\":1'"
mkl iztemp; izgec
mcheck "izinli IP'nin geçici banı, lfd günlüğünde kayıt yokken de 'Ban işlemiyor' satırı" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\".*\"bk\":\"b\",\"cnt\":1,\"full\":1'"
mkl izboth; izgec; lfdb 600 151.80.7.9
mcheck "lfd günlüğünde de kaydı varsa satır bir kez, sayı lfd'den (CSF'teki ban ikinci kez sayılmaz)" "rvrow 151.80.7.9 | grep -q '\"bk\":\"b\",\"cnt\":1,'"
mkl izold; printf '151.80.7.9 # musteri\n' >> "$A"; single 151.80.7.9 pop3d "$(LC_ALL=C date -d '-9 days' '+%a %b %d %H:%M:%S %Y')"
mcheck "pencereden (7 gün) eski işlemeyen ban satır açmaz" "[ -z \"\$(rvrow 151.80.7.9)\" ]"
# 2026-10-23 olayı: AG_PROF=1 ile durum çıktısında ölçüm saati (/proc/uptime) IFS=, yüzünden sözdizimi hatası verdi, bash case
# bloğunu terk edip tura düştü, tur csf.deny'yi ikinci kez okuyup her tekili iki kez saydı ve 2 tekilli /24'ü banladı
mk profst; for x in 1 2; do single 151.80.7.$x sshd; done; cp "$D" "$W/profst.deny"
PJ=$(env SIM_ROOT="$R" PATH="$W/bin:/usr/bin:/bin" AG_BY=root AG_PROF=1 PROF_CLK=uptime bash "$R/app/csf_autogroup.sh" --status --json 2>"$W/profst.err")
mcheck "AG_PROF=1 (/proc/uptime saati) ile durum çıktısı eksiksiz, hata yok, tura düşmez (csf.deny aynı, blok banı yok)" "[[ \"\$PJ\" == '{\"ok\":true'*'}' ]] && ! grep -qiE 'hata|error|subscript|syntax|sözdizimi' '$W/profst.err' && grep -q 'PROF  saat: uptime' '$W/profst.err' && cmp -s '$D' '$W/profst.deny'"
mcheck "aynı veride AG_PROF=1 ile deneme turu da hatasız (date ve epoch saatleri)" "( for c in date epoch uptime; do env SIM_ROOT='$R' PATH='$W/bin:/usr/bin:/bin' AG_BY=root AG_PROF=1 PROF_CLK=\$c bash '$R/app/csf_autogroup.sh' --dry-run 2>&1 >/dev/null | grep -qi 'sözdizimi\|syntax' && exit 1; done; exit 0 )"
# PERMBLOCK: lfd'nin nedeni (kaç geçici ban, hangi sürede) kesilmez, okunur metne çevrilir
mk permwhy; printf 'WARN16_151.80 %s\n' "$(date -d '-3 days' +%F)" >> "$C"; for x in 7.1 7.2 8.1 8.2; do single 151.80.$x sshd; done
printf '%s\n' "151.80.9.1 # lfd: (PERMBLOCK) 151.80.9.1 (FR/France/-) has had more than 3 temp blocks in the last 86400 secs - $DT" >> "$D"
mcheck "PERMBLOCK tekili: 'son 24 saat içinde en az 4 geçici ban aldı, kalıcıya alındı'" "run --status --json 2>/dev/null | grep -q '\"ip\":\"151.80.9.1\",\"host\":\"\",\"why\":\"Tekrar ban (PERMBLOCK): son 24 saat içinde en az 4 geçici ban aldı, kalıcıya alındı\"'"
# "*SSH login*" başarılı giriş bildirimi (izinli IP'den), saldırı değil: listeye girmez
mkl aassh; printf '151.80.7.9 # ofis\n' >> "$A"; lfdl 600 "*SSH login* from 151.80.7.9 into the root account using password authentication - ignored"
mcheck "'*SSH login*' bildirimi (başarılı giriş) izinli saldırgan sayılmaz" "[ -z \"\$(rvrow 151.80.7.9)\" ]"
# csf.allow satırındaki yorum kaynağın yanında
mkl aacm; printf '151.80.7.9 # ofis\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "csf.allow yorumu satırda (wlc) ve IP listesinde (al)" "rvrow 151.80.7.9 | grep -q '\"wl\":\"csf.allow: 151.80.7.9\",\"wlc\":\"ofis\".*\"al\":\"csf.allow: 151.80.7.9 (ofis)\"'"
# Gelişmiş izin satırı ve banın yönü (gerçek CSF 16.33'te ölçüldü): ban gelen yönü, iki yönlüyse giden yönü de keser, kurulmuş
# bağlantıların kabulü ondan sonra gelir → tek yönlü satır iki yönlü banı aşmaz; lfd'nin geçici banı LF_SELECT=0 iken "inout"
mkl aawide; printf 'tcp|in|d=1:65535|s=151.80.7.9 # ofis\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "tcp|in|d=1:65535 tek başına: lfd'nin iki yönlü banı işler ('Ban işlemiyor' değil)" "! rvrow 151.80.7.9 | grep -q '\"full\":1'"
mkl aawide2; printf '%s\n' 'tcp|in|d=1:65535|s=151.80.7.9 # ofis' 'tcp|out|s=1:65535|d=151.80.7.9 # ofis' >> "$A"; lfdb 3600 151.80.7.9
mcheck "tcp|in + tcp|out 1:65535 çifti tam izin: 'Ban işlemiyor'" "rvrow 151.80.7.9 | grep -q '\"bk\":\"b\".*\"full\":1'"
mkl aawide3; printf '%s\n' 'LF_SELECT = "1"' 'LF_TRIGGER = "0"' 'LF_BLOCKINONLY = "1"' >> "$R/etc/csf/csf.conf"; printf 'tcp|in|d=1:65535|s=151.80.7.9 # ofis\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "tcp|in|d=1:65535, lfd banları yalnız gelen yönü keserken (LF_SELECT=1, LF_TRIGGER=0, LF_BLOCKINONLY=1): 'Ban işlemiyor'" "rvrow 151.80.7.9 | grep -q '\"bk\":\"b\".*\"full\":1'"
mkl aaout; printf 'tcp|out|d=1:65535|d=151.80.7.9 # ofis\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "yalnız dışarı satırı (tcp|out|d=1:65535) tam izin değil" "! rvrow 151.80.7.9 | grep -q '\"full\":1'"
mkl aaport0; printf 'tcp|in|s=151.80.7.9 # ofis\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "portsuz gelişmiş satır (CSF kural kurmaz) tam izin değil" "! rvrow 151.80.7.9 | grep -q '\"full\":1'"
# CSF'te duran ban kendi yönüyle: geçici ban satırındaki yön, kalıcı tekil LF_BLOCKINONLY'ye göre
tb1() { printf 'tcp|in|d=1:65535|s=151.80.7.9 # ofis\n' >> "$A"; printf '%s|151.80.7.9||%s|3600|lfd: (pop3d) Failed POP3 login from 151.80.7.9 (FR/France/-): 5 in the last 3600 secs\n' "$NOW" "$1" >> "$T"; }
mkl aatin; tb1 in
mcheck "geçici ban 'in' + tcp|in|d=1:65535: 'Ban işlemiyor' (cevaplar giden yönde serbest)" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\".*\"full\":1'"
mkl aatio; tb1 inout
mcheck "geçici ban 'inout' + tcp|in|d=1:65535: ban işler" "! rvrow 151.80.7.9 | grep -q '\"full\":1'"
mkl aapin; printf 'tcp|in|d=1:65535|s=151.80.7.9 # ofis\n' >> "$A"; single 151.80.7.9 pop3d
mcheck "kalıcı tekil + tcp|in|d=1:65535 (LF_BLOCKINONLY=0): ban işler" "! rvrow 151.80.7.9 | grep -q '\"full\":1'"
mkl aapio; printf 'LF_BLOCKINONLY = "1"\n' >> "$R/etc/csf/csf.conf"; printf 'tcp|in|d=1:65535|s=151.80.7.9 # ofis\n' >> "$A"; single 151.80.7.9 pop3d
mcheck "kalıcı tekil + tcp|in|d=1:65535 (LF_BLOCKINONLY=1): 'Ban işlemiyor'" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\".*\"full\":1'"
# IP kartı: gelişmiş satırın banla birlikte ne yaptığı (wle)
mk wleo; printf 'tcp|out|d=443|d=151.80.7.9 # imunify\n' >> "$A"; single 151.80.7.9 sshd
mcheck "IP kartı: yalnız dışarı satırı → wle out" "run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"wle\":\"out\"'"
mk wlei; printf 'tcp|in|d=22|s=151.80.7.9 # ofis\n' >> "$A"; single 151.80.7.9 sshd
mcheck "IP kartı: gelen yön satırı + kalıcı ban (iki yönlü) → wle in_x" "run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"wle\":\"in_x\"'"
mk wlep; printf '%s\n' 'tcp|in|d=22|s=151.80.7.9 # ofis' 'tcp|out|s=22|d=151.80.7.9 # ofis' >> "$A"; single 151.80.7.9 sshd
mcheck "IP kartı: karşı yön satırıyla çift → wle pair" "run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"wle\":\"pair\"'"
mk wlepx; printf '%s\n' 'tcp|in|d=22|s=151.80.7.9 # ofis' 'tcp|out|d=22|d=151.80.7.9 # ofis' >> "$A"; single 151.80.7.9 sshd
mcheck "IP kartı: aynı türde port (in d=22 + out d=22) çift değil → wle in_x (gerçek CSF'te bağlantı kesiliyor)" "run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"wle\":\"in_x\"'"
mk wlet;printf 'tcp|in|d=22|s=151.80.7.9 # ofis\n' >> "$A"; printf '%s|151.80.7.9||in|3600|lfd: (sshd) Failed SSH login from 151.80.7.9\n' "$NOW" >> "$T"
mcheck "IP kartı: gelen yön satırı + geçici 'in' ban → wle in_ok" "run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"wle\":\"in_ok\"'"
mk wletio; printf 'tcp|in|d=22|s=151.80.7.9 # ofis\n' >> "$A"; printf '%s|151.80.7.9||inout|3600|lfd: (sshd) Failed SSH login from 151.80.7.9\n' "$NOW" >> "$T"
mcheck "IP kartı: gelen yön satırı + geçici 'inout' ban → wle in_x" "run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"wle\":\"in_x\"'"
# Hiçbir listede olmayan yoksayma: kaynak lfd'nin sırasıyla aranır — CC_IGNORE (sahip önbellekten), csf.rignore (lfd'nin dnscache'i)
mkl aacc; printf 'CC_IGNORE = "FR"\n' >> "$R/etc/csf/csf.conf"; printf '151.80.7|16276|FR|OVH - OVH SAS, FR|%s|151.80.0.0/16\n' "$NOW" >> "$R/var/lib/csf_autogroup/owners"; lfdi 600 151.80.7.9
mcheck "yoksayma kaynağı CC_IGNORE (ülke, sahip önbellekten) satırda" "rvrow 151.80.7.9 | grep -q '\"wl\":\"CC_IGNORE: FR\".*\"full\":0'"
mkl aarig; printf 'googlebot.com\n' > "$R/etc/csf/csf.rignore"; printf '151.80.7.9|151.80.7.9|crawl-151-80-7-9.googlebot.com\n' > "$R/var/lib/csf/csf.dnscache"; lfdi 600 151.80.7.9
mcheck "yoksayma kaynağı csf.rignore (lfd'nin ters DNS önbelleğinden, sorgusuz)" "rvrow 151.80.7.9 | grep -q '\"wl\":\"csf.rignore: googlebot.com (151.80.7.9 = crawl-151-80-7-9.googlebot.com)\"'"
mkl aanone; lfdi 600 151.80.7.9
mcheck "hiçbir kaynakta yoksa kaynak boş (panel nerelere bakıldığını yazar)" "rvrow 151.80.7.9 | grep -q '\"wl\":\"\",\"aa\":1'"
# Yoksay: izinli saldırgan satırının hedefi tek IP, izinli aralık satırınınki izin aralığı (/25); /16 ve /24 dışı da kabul edilir
mkl aaign; printf '151.80.7.9 # müşteri\n' >> "$A"; lfdb 3600 151.80.7.9; quiet --action ignore 151.80.7.9 10
mcheck "tek IP yoksayılınca Kontrol edilecekler'den düşer, Yoksayılanlar'da görünür" "[ -z \"\$(rvrow 151.80.7.9)\" ] && run --status --json 2>/dev/null | grep -q '\"ignored\":\[{\"cidr\":\"151.80.7.9\"'"
quiet --action unignore 151.80.7.9
mcheck "yoksayma kaldırılınca satır geri gelir" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\"'"
mkl aaigngrp; printf '151.80.7.0/25 # müşteri ağı\n' >> "$A"; lfdb 3600 151.80.7.9; lfdb 3000 151.80.7.20; quiet --action ignore 151.80.7.0/25 10
mcheck "izin aralığı (/25) yoksayılınca 'İzinli aralık' satırı düşer" "[ -z \"\$(rvrow 151.80.7.0/25)\" ]"
mcheck "/7 gibi aralık yoksayma hedefi olarak reddedilir" "run --action ignore 128.0.0.0/7 10 2>&1 | grep -q 'Geçersiz hedef'"
# süresiz yoksayma: 0 gün → dosyada 9999-12-31, durumda ignored kaydı; IP kartı "süresiz" yazar; kaldırılabilir
mkl aaignf; printf '151.80.7.9 # müşteri\n' >> "$A"; lfdb 3600 151.80.7.9
mcheck "süresiz yoksayma (0 gün) kabul edilir, mesajı 'siz kaldırana kadar'" "run --action ignore 151.80.7.9 0 2>&1 | grep -q 'siz kaldırana kadar yoksayılacak' && grep -q '^151.80.7.9 9999-12-31 ' '$R/var/lib/csf_autogroup/ignored'"
mcheck "süresiz yoksayılan IP listede yok, Yoksayılanlar'da 9999-12-31 ile, IP kartında 'süresiz'" "[ -z \"\$(rvrow 151.80.7.9)\" ] && run --status --json 2>/dev/null | grep -q '\"cidr\":\"151.80.7.9\",\"until\":\"9999-12-31\"' && run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '\"ign\":\"151.80.7.9 → süresiz\"'"
quiet --action unignore 151.80.7.9
mcheck "süresiz yoksayma kaldırılınca satır geri gelir" "rvrow 151.80.7.9 | grep -q '\"type\":\"allow_ban\"'"
mk paopen; quiet --action ban24 151.80.7 --mode svc --svc web
for x in 1 2 3; do printf '%s\n' "151.80.7.$x # lfd: (sshd) Failed SSH login from 151.80.7.$x (FR/France/-): 5 in the last 3600 secs - $(LC_ALL=C date -d '+1 min' '+%a %b %d %H:%M:%S %Y')" >> "$D"; done
mcheck "kısmi web banından sonra SSH'ye blok eşiği kadar saldırı → 'Kısmi yetmiyor'" "rvrow 151.80.7.0/24 | grep -q '\"type\":\"part_open\".*\"ssh\":3'"
# açık servis de Kontrol edilecekler penceresine bağlı: bandan sonra ama 7 günden eski ihlaller satır açmaz (csf.deny'de dursa da)
pdt() { LC_ALL=C date -d "$1" '+%a %b %d %H:%M:%S %Y'; }
mk poold; printf '%s\n' "tcp|in|d=80,443|s=151.80.7.0/24 # csf_autogroup: elle /24 kısmi ban (root) [svc=web] - do not delete - $(pdt '-20 days')" >> "$D"
for x in 1 2 3; do single 151.80.7.$x sshd "$(pdt '-10 days')"; done
mcheck "açık servis: bandan sonraki ama 7 günden eski ihlaller satır açmaz" "[ -z \"\$(rvrow 151.80.7.0/24)\" ]"
mk ponew; printf '%s\n' "tcp|in|d=80,443|s=151.80.7.0/24 # csf_autogroup: elle /24 kısmi ban (root) [svc=web] - do not delete - $(pdt '-20 days')" >> "$D"
for x in 1 2; do single 151.80.7.$x sshd "$(pdt '-10 days')"; done; for x in 3 4 5; do single 151.80.7.$x sshd "$(pdt '-1 day')"; done
mcheck "açık servis: son 7 gündeki ihlaller sayılır (eskiler değil), satır son ihlal zamanını taşır" "rvrow 151.80.7.0/24 | grep -q '\"type\":\"part_open\".*\"ssh\":3,*.*\"n\":3,\"last\":[0-9]'"
# İzlemeyi yeniden başlat: sayaç satırının tarihi bugün olur, olay yazılır; izlenmeyen blok reddedilir
mk rewatch; printf '151.80.7 %s\n151.80.9 %s\n' "$(date -d '-10 days' +%F)" "$(date -d '-3 days' +%F)" >> "$C"
mcheck "izlemeyi yeniden başlat: tarih bugün, öteki satır dokunulmaz, olay kaydı" "run --action rewatch 151.80.7 2>&1 | grep -q 'izleme süresi yeniden başladı' && grep -q \"^151.80.7 $(date +%F)\$\" '$C' && grep -q \"^151.80.9 $(date -d '-3 days' +%F)\$\" '$C' && grep -q '\"type\":\"manual_rewatch\"' '$R/var/lib/csf_autogroup/events.jsonl'"
mcheck "izlenmeyen blok için 'izlenmiyor'" "run --action rewatch 151.80.8 2>&1 | grep -q 'izlenmiyor'"
# Otomatik /24: tekiller csf -dr ile değil dosyadan silinir (csf -dr lfd'nin tekrar ban geçmişini de siler)
R="$W/roots/b24auto"
mcheck "otomatik /24 banı tekilleri dosyadan siler, csf -dr çağırmaz" "grep -q '^151.80.7.0/24 ' '$R/etc/csf/csf.deny' && ! grep -qE '^151\.80\.7\.[1-6] ' '$R/etc/csf/csf.deny' && ! grep -q 'csf -dr' '$R/csf_calls.log'"
# Tam aralık banı izlenen bloğun sayaç satırını saklar; ban kalkınca süresi dolmadıysa geri gelir. --keep ile izleme hiç kesilmez.
W10=$(date -d '-10 days' +%F); W400=$(date -d '-400 days' +%F)
mk rwatch;  printf '151.80.7 %s\n151.80.9 %s\n' "$W10" "$W400" >> "$C"; quiet --action ban16 151.80
mcheck "tam /16 banı izleme satırını sayaçtan alır, geri yükleme dosyasına yazar" "! grep -q '^151.80.7 ' '$C' && grep -q '^cnt|151.80.7 $W10' '$R/var/lib/csf_autogroup/restore/151.80.0.0_16'"
quiet --action unban 151.80.0.0/16
mcheck "ban kalkınca (geri yükleme seçilmese de) süresi dolmamış izleme geri gelir, dolmuş gelmez" "grep -q '^151.80.7 $W10\$' '$C' && ! grep -q '^151.80.9 ' '$C'"
mk rwatchk; printf '151.80.7 %s\n' "$W10" >> "$C"; quiet --action ban16 151.80 --keep
mcheck "kapsananlar tutulursa (--keep) izleme de sürer" "grep -q '^151.80.7 $W10\$' '$C'"
mk rwatcho; printf '151.80.7 %s\n' "$W10" >> "$C"; quiet --action ban16 151.80; sed -i '/^151\.80\.0\.0\/16 /d' "$D"; quiet
mcheck "ban CSF ekranından kaldırılınca (artık temizliği) izleme geri gelir" "grep -q '^151.80.7 $W10\$' '$C'"

# CSF'in liste sınırı (DENY_IP_LIMIT) eklentinin işaretsiz /24'ünü silerse: izlemeye alınır, bildirilir; eklentinin kendi
# kaldırması sayılmaz; izlenen blok yeniden eşiğe gelince silinmez işaretli kalıcı ban
a24() { printf '%s\n' "$1 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - $DT" >> "$D"; }
mk lgone; a24 151.80.7.0/24; a24 151.80.8.0/24; quiet; sed -i '/^151\.80\.7\.0\/24 /d' "$D"; sleep 1; quiet
mcheck "CSF'in sildiği otomatik /24 izlemeye alınır ve olay yazılır" "grep -q '^151.80.7 ' '$C' && grep -q '\"type\":\"limit_gone\",\"cidr\":\"151.80.7.0/24\"' '$R/var/lib/csf_autogroup/events.jsonl' && ! grep -q '\"cidr\":\"151.80.8.0/24\".*limit_gone\|limit_gone.*\"cidr\":\"151.80.8.0/24\"' '$R/var/lib/csf_autogroup/events.jsonl'"
quiet
mcheck "aynı kayıp bir sonraki turda yeniden bildirilmez" "[ \$(grep -c '\"type\":\"limit_gone\"' '$R/var/lib/csf_autogroup/events.jsonl') = 1 ]"
mk lgself; a24 151.80.7.0/24; quiet; sleep 1; quiet --action unban 151.80.7.0/24; quiet
mcheck "eklentinin kendi kaldırması 'CSF sildi' sayılmaz" "! grep -q '\"type\":\"limit_gone\"' '$R/var/lib/csf_autogroup/events.jsonl'"
mk lgback; printf '151.80.7 %s\n' "$(date -d '-3 days' +%F)" >> "$C"; for x in 1 2 3; do single 151.80.7.$x sshd; done; quiet
mcheck "izlenen blok kalıcı tekillerle yeniden eşiğe gelince silinmez işaretli banlanır, izleme biter" "grep -q '^151.80.7.0/24 .*do not delete' '$D' && ! grep -q '^151.80.7 ' '$C'"

# Etkisini ölç: CDN arkasındaki sitenin istekleri kendi kovasında (güvenlik duvarı ziyaretçiyi görmez), öteki kovalara girmez
mk impcdn; mkdir -p "$R/var/lib/csf/Geo" "$R/domlogs"
printf '151.80.0.0\t151.80.255.255\t16276\tFR\tOVH\n' > "$R/var/lib/csf/Geo/ip2asn-combined.tsv"
echo "DOMLOGS=$R/domlogs" >> "$R/app/config.env"
TL=$(LC_ALL=C date -d '-1 hour' '+%d/%b/%Y:%H:%M:%S +0000')
printf '151.80.7.9 - - [%s] "GET / HTTP/1.1" 200 10 "-" "Mozilla/5.0"\n' "$TL" > "$R/domlogs/dogrudan.test"
printf '151.80.7.9 - - [%s] "GET /a HTTP/1.1" 200 10 "-" "Mozilla/5.0"\n151.80.8.4 - - [%s] "GET /b HTTP/1.1" 404 10 "-" "curl"\n' "$TL" "$TL" > "$R/domlogs/cdnsite.test-ssl_log"
printf '#t|%s\ncdnsite.test|www.cdnsite.test|203.0.113.80|QUIC.cloud\n' "$NOW" > "$R/var/lib/csf_autogroup/cdn_sites"
mcheck "Etkisini ölç: CDN arkasındaki sitenin 2 isteği kendi kovasında, açık kovada yalnız doğrudan sitenin isteği" "run --asn-impact AS16276 --json 2>/dev/null | grep -q '\"cdn\":{\"req\":2,\"ips\":2,.*\"cdnsite.test\":\[2,\"QUIC.cloud\"\].*\"open\":{\"req\":1,'"

# Etkisini ölç: izinli servisin (Googlebot) 2xx/3xx dışı cevap aldığı istekler örnek olarak listelenir (kod · site · istek, sayı, servis, örnek IP)
mk impaf; mkdir -p "$R/var/lib/csf/Geo" "$R/domlogs"
printf '66.249.64.0\t66.249.95.255\t15169\tUS\tGOOGLE\n' > "$R/var/lib/csf/Geo/ip2asn-combined.tsv"
echo "DOMLOGS=$R/domlogs" >> "$R/app/config.env"
printf '66.249.64.0/19 # csf_autogroup: service googlebot\n' > "$R/etc/csf/csf_autogroup.services.allow"
TL=$(LC_ALL=C date -d '-1 hour' '+%d/%b/%Y:%H:%M:%S +0000')
printf '66.249.66.1 - - [%s] "GET /gizli HTTP/1.1" 403 10 "-" "Googlebot/2.1"\n66.249.66.1 - - [%s] "GET /gizli HTTP/1.1" 403 10 "-" "Googlebot/2.1"\n66.249.66.2 - - [%s] "GET / HTTP/1.1" 200 10 "-" "Googlebot/2.1"\n' "$TL" "$TL" "$TL" > "$R/domlogs/site.test"
mcheck "Etkisini ölç: izinli servisin 403 aldığı istek örnekte (kod · site · istek ×2, servis, örnek IP); başarılı istek listede değil" "run --asn-impact AS15169 --json 2>/dev/null | grep -q '\"afails\":\[\[\"403 · site.test · GET /gizli\",2,0,\"googlebot\",\"66.249.66.1\"\]\]'"

# ekran: yazısı aralık olan öğe IP kartı değil aralık kartı açar (tıklanan şey ile açılan şey aynı)
AGJS="$REPO/whm/assets/ag.js"                 # yol tek tırnak içerebilir ("Drive'ım"): değişkenle verilir
mcheck "aralığa tıklamak aralık kartını açar" "grep -qF 'if (RANGE_RE.test(rtx)) openRange(rtx); else openDrawer' \"\$AGJS\""
# aralık kartı /16–/24 dışındaki önekleri de tarar (CSF'teki /26 ya da /12 banına tıklanınca kart o aralığı anlatır)
mk insany; single 151.80.7.9 sshd; single 151.80.7.100 sshd; printf '%s\n' "151.80.7.0/26 # Manually denied - $DT" >> "$D"
mcheck "aralık kartı · /26: kendi banı kapsar, içindeki 1 tekil sayılır" "run --inside 151.80.7.0/26 --json 2>/dev/null | grep -q '\"cover\":\"151.80.7.0/26\".*\"singles\":1,'"
mk insatmp; single 151.80.7.9 sshd; printf '%s|151.80.7.20||inout|3600|lfd: (pop3d) Failed POP3 login from 151.80.7.20 (FR/France/-): 5 in the last 3600 secs\n' "$NOW" >> "$T"
mcheck "aralık kartı · geçici tek IP banı da listede, kalan süreyle (kart '1 geçici ban' diyor)" "run --inside 151.80.7.0/24 --json 2>/dev/null | grep -q '\"sgl\":\[{\"ip\":\"151.80.7.9\"[^]]*{\"ip\":\"151.80.7.20\",\"why\":\"[^\"]*\",\"svc\":\"sync\",\"dnd\":false,\"temp\":[0-9]*}\]'"
mcheck "aralık kartı · /12 geçerli cevap (içinde tekil yok)" "run --inside 151.0.0.0/12 --json 2>/dev/null | grep -q '\"singles\":0,'"
mcheck "aralık kartı · hizasız aralık reddedilir" "run --inside 151.80.7.5/26 --json 2>/dev/null | grep -q 'bad_input'"

# Kayıt saklama gün olarak (önce satır sayısıyla: tur sıklığı değişince kapsadığı süre de değişiyordu). Varsayılan: olaylar 180,
# tur kayıtları 31 gün; günlük (logrotate yoksa) 30 gün
evl() { printf '{"t":%s,"type":"%s","cidr":"151.80.%s.0/24"}\n' "$(( NOW - $1 * 86400 ))" "$2" "$3" >> "$R/var/lib/csf_autogroup/events.jsonl"; }
mk keep; evl 200 add24 1; evl 100 add24 2; evl 33 run 3; evl 10 run 4; evl 1 add24 5
printf '[%s] eski satır\n[%s] yeni satır\n' "$(date -d '40 days ago' '+%Y-%m-%d %H:%M:%S')" "$(date -d '2 days ago' '+%Y-%m-%d %H:%M:%S')" > "$R/autogroup.log"
echo "LOGROTATE_CONF=$R/yok" >> "$R/app/config.env"; quiet
EVF="$R/var/lib/csf_autogroup/events.jsonl"
mcheck "saklama · 180 günden eski olay silinir, 100 günlük kalır" "! grep -q '151.80.1.0' '$EVF' && grep -q '151.80.2.0' '$EVF' && grep -q '151.80.5.0' '$EVF'"
mcheck "saklama · 31 günden eski tur kaydı silinir, 10 günlük kalır" "! grep -q '151.80.3.0' '$EVF' && grep -q '151.80.4.0' '$EVF'"
mcheck "saklama · logrotate yokken günlükte 30 günden eski satır silinir" "! grep -q 'eski satır' '$R/autogroup.log' && grep -q 'yeni satır' '$R/autogroup.log'"
mcheck "saklama · ayar ekranı olay kaydının kapsamını verir (sayı, en eski)" "run --config get --json 2>/dev/null | grep -q '\"ev\":{\"n\":[0-9]*,\"oldest\":[0-9]*,\"runs\":[0-9]*,\"runs_oldest\":[0-9]*' && run --config get --json 2>/dev/null | grep -q '\"EVENTS_DAYS\":\"180\",\"RUN_DAYS\":\"31\"'"
mk keep2; evl 175 add24 1; evl 20 run 2; quiet
mcheck "saklama · süresi dolmamış kayıt varken dosya yeniden yazılmaz (yalnız tur satırı eklenir)" "grep -q '151.80.1.0' '$R/var/lib/csf_autogroup/events.jsonl' && grep -q '151.80.2.0' '$R/var/lib/csf_autogroup/events.jsonl'"

node "$(wp "$H/render.js")" "$(wp "$REPO/whm/assets/ag.js")" "$(wp "$W/out")" "$@"; RC=$?
printf '\nMotor kuralları\n%s' "$ML"
[ "$MF" -gt 0 ] && { echo "$MF motor kuralı ihlali"; exit 1; }
exit $RC
