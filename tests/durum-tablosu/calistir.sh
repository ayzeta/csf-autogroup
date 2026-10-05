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
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
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
single() { printf '%s\n' "$1 # lfd: ($2) Failed login from $1 (FR/France/-): 5 in the last 3600 secs - $DT" >> "$D"; }
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

node "$(wp "$H/render.js")" "$(wp "$REPO/whm/assets/ag.js")" "$(wp "$W/out")" "$@"; RC=$?
printf '\nMotor kuralları\n%s' "$ML"
[ "$MF" -gt 0 ] && { echo "$MF motor kuralı ihlali"; exit 1; }
exit $RC
