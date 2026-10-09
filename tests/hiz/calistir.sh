#!/bin/bash
# Hız: panelin açılışta beklediği durum çıktısı (--status --json) sunucu boyutunda veride kaç saniye sürüyor, zaman
# nereye gidiyor. Veri her seferinde üretilir: 1.500 tekil ban (beşte biri LFD PERMBLOCK), 80 blok banı, 250 sağlayıcı,
# 5 banlı sağlayıcı (her biri 3.000 aralık), 4 kiralık sunucu listesi (6.000 aralık), 450.000 satır lfd günlüğü,
# 6.000 Imunify360 kaydı. CSF ve ipset taklittir; sisteme bir şey yazılmaz. Linux'ta gerçekçi süre verir (Windows'taki
# Git Bash süreç açmakta çok yavaştır).
#
#   bash tests/hiz/calistir.sh            # toplam süre ve 150 ms'yi geçen bölümler
#   SINIR=15 bash tests/hiz/calistir.sh   # toplam bu kadar saniyeyi geçerse başarısız
set -u
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
B="$(mktemp -d)"; trap 'rm -rf "$B"' EXIT
R=$B/root; A=$R/var/lib/csf_autogroup
mkdir -p "$B/bin" "$R/app/tools" "$R/etc/csf" "$R/var/lib/csf/Geo" "$A/cloud" "$A/services" "$R/var/log"
cp "$REPO/csf_autogroup.sh" "$R/app/"; cp "$REPO"/tools/*.sh "$R/app/tools/"
NOW=$(date +%s)

# ── taklit araçlar ──
printf '#!/bin/bash\nexit 0\n' > "$B/bin/csf"; cp "$B/bin/csf" "$B/bin/iptables"; cp "$B/bin/csf" "$B/bin/dig"; cp "$B/bin/csf" "$B/bin/imunify360-agent"
printf '#!/bin/bash\necho 1234\nexit 0\n' > "$B/bin/pgrep"
printf '#!/bin/bash\n[ "$1" = -l ] && echo "*/5 * * * * %s/app/csf_autogroup.sh >/dev/null 2>&1"\nexit 0\n' "$R" > "$B/bin/crontab"
tr -d '\r' < "$H/bin/ipset" > "$B/bin/ipset"
chmod +x "$B"/bin/*

D=$R/etc/csf/csf.deny; T=$R/var/lib/csf/csf.tempban; O=$A/owners; C=$A/counter
printf '127.0.0.1\n' > "$R/etc/csf/csf.allow"; : > "$R/etc/csf/csf.ignore"; : > "$R/etc/csf/csf.rignore"
printf '%s\n' 'DENY_IP_LIMIT = "5000"' 'DENY_TEMP_IP_LIMIT = "1000"' 'CC_DENY = ""' 'CC_DENY_PORTS = "AS1000,AS1001,AS1002,AS1003,AS1004"' 'CC_DENY_PORTS_TCP = "80,443"' 'CC_DENY_PORTS_UDP = "443"' 'LF_IPSET = "1"' > "$R/etc/csf/csf.conf"
printf '%s\n' "MSG_LANG=tr" "ALERT_MAIL=" "LOOKUP=0" "DENY_FILE=$D" "CSF_CONF=$R/etc/csf/csf.conf" "CSF_BIN=$B/bin/csf" "CSF_VAR=$R/var/lib/csf" \
  "LOG_FILE=$R/autogroup.log" "SAYAC_FILE=$C" "LFD_LOG=$R/var/log/lfd.log" "IMUNIFY_BIN=$B/bin/imunify360-agent" \
  "ASN_BAN=1" "ASN_LIST=AS1000,AS1001,AS1002,AS1003,AS1004" "ASN_ALL=" "ASN_MODE=web" "ASN_TCP=80,443" "ASN_UDP=443" \
  "SVC_ALLOW=0" "CLOUD_BAN=1" "CLOUD_SOURCES=gcp,aws,azure,digitalocean" "CLOUD_TCP=80,443" "CLOUD_UDP=443" "ENABLED=1" > "$R/app/config.env"

# ── veri ──
awk -v now="$NOW" -v D="$D" -v O="$O" -v I="$A/imunify" -v L="$R/var/log/lfd.log" -v L1="$R/var/log/lfd.log.1" -v N="$A/services/asn_names" -v T="$T" '
  function pre(i) { return (60 + int(i / 250)) "." (i % 250) "." (i * 7 % 250) }
  function dt(s) { return strftime("%a %b %d %H:%M:%S %Y", now - s) }
  BEGIN { srand(42)
    split("(sshd) Failed SSH login|(mod_security) mod_security (id:2008) triggered|(pop3d) Failed POP3 login|(smtpauth) Failed SMTP AUTH login|(cpanel) Failed cPanel login", R, "|")
    for (i = 0; i < 680; i++) { a = 1000 + i % 250; printf "%s|%d|US|ASN-%d - Provider number %d, US|%d|%s.0/24\n", pre(i), a, a, a, now, pre(i) > O }
    for (a = 1000; a < 1250; a++) printf "AS%d|ASN-%d - Provider number %d, US\n", a, a, a > N
    for (k = 0; k < 1500; k++) { p = pre(k % 600); ip = p "." (k % 250 + 1); age = int(rand() * 40 * 86400)
      if (k % 5 == 0) {
        printf "%s # lfd: (PERMBLOCK) %s has had more than 3 temp blocks in the last 259200 secs - %s\n", ip, ip, dt(age) > D
        printf "%s lin lfd[1]: %s from %s (US/United States/-): 5 in the last 3600 secs - *Blocked in csf* for 3600 secs [LF_SSHD]\n", dt(age + 7200), R[1 + k % 5], ip > L
        printf "%s lin lfd[1]: (PERMBLOCK) %s (US/United States/-) has had more than 3 temp blocks in the last 259200 secs - *Blocked in csf* [LF_TRIGGER]\n", dt(age), ip > L
      } else printf "%s # lfd: %s from %s (US/United States/-): 10 in the last 3600 secs - %s\n", ip, R[1 + k % 5], ip, dt(age) > D }
    for (k = 600; k < 680; k++) printf "%s.0/24 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - %s\n", pre(k), dt(k * 3600) > D
    for (k = 0; k < 300; k++) printf "%d|%s.%d||in|43200|lfd - (mod_security) mod_security (id:2008) triggered by x\n", now - 600, pre(k % 600), 200 + k % 50 > T
    for (k = 0; k < 300000; k++) printf "%s lin lfd[1]: (sshd) Failed SSH login from 1.%d.%d.%d (CN/China/-): 5 in the last 3600 secs - *Blocked in csf* for 3600 secs [LF_SSHD]\n", dt(k * 10), k % 250, k % 199, k % 97 > L1
    for (k = 0; k < 150000; k++) printf "%s lin lfd[1]: *Port Scan* detected from 2.%d.%d.%d (CN/China/-). 11 hits in the last 101 seconds\n", dt(k * 10), k % 250, k % 199, k % 97 > L
    printf "#t|%d\n#total|6000\n", now > I
    split("CAPTCHA_DOS_ALERT|SMTP_BRUTE|WAF_ALERT|SSH_BRUTE|FTP_BRUTE", IR, "|")
    for (k = 0; k < 6000; k++) printf "%s.%d|%s\n", pre(k % 680), k % 250 + 1, IR[1 + int(rand() * 5)] > I }'
for s in gcp aws azure digitalocean; do
  awk -v s="$s" 'BEGIN { srand(length(s) * 7); for (i = 0; i < 1500; i++) printf "%d.%d.%d.0/%d\n", 20 + int(rand() * 40), int(rand() * 256), int(rand() * 16) * 16, 20 + int(rand() * 5) }' > "$A/cloud/$s.txt"
  printf '%s|1500|%s||0\n' "$s" "$NOW" >> "$A/cloud/status"
done
printf 'gcp azure aws digitalocean\n' > "$A/cloud/active"; date +%s > "$A/cloud/.refreshed"
printf '61.1.7 %s\n' "$(date +%F)" > "$C"

st() { env SIM_ROOT="$R" PATH="$B/bin:/usr/bin:/bin" AG_BY=root "$@"; }
st bash "$R/app/csf_autogroup.sh" --status --json > /dev/null 2>&1      # ilk açılışın önbellekleri (olay geçmişi vb.)
s=$(date +%s%N)
st env AG_PROF=1 bash "$R/app/csf_autogroup.sh" --status --json > "$B/out.json" 2> "$B/prof"
e=$(date +%s%N); ms=$(( (e - s) / 1000000 ))
grep -q '"ok":true' "$B/out.json" || { echo "Hız: durum çıktısı bozuk"; head -c 300 "$B/out.json"; exit 1; }
echo "Hız: durum çıktısı $(( ms / 1000 )),$(( ms % 1000 / 100 )) sn (1.580 ban, 450.000 lfd satırı, 6.000 Imunify kaydı)"
awk '$2 > 150 { sub(/^PROF /, "  "); print }' "$B/prof"
if [ -n "${SINIR:-}" ] && [ "$ms" -gt $(( SINIR * 1000 )) ]; then echo "  ✗ sınır $SINIR sn aşıldı"; exit 1; fi
exit 0
