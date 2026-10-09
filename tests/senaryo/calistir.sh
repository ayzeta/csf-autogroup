#!/bin/bash
# Senaryo matrisi: motorun kararları (uyarı, gizleme, ban, beyaz liste) her koruma katmanı × saldırı türü × zaman için
# beklenenle karşılaştırılır. Sunucuda değil, geliştirme makinesinde çalışır; bash ve node gerekir. CSF, DNS ve diğer
# dış araçlar tests/durum-tablosu/bin altındaki taklitlerdir; hiçbir şey sisteme yazılmaz.
#
#   bash tests/senaryo/calistir.sh        her senaryo bir satır; beklenmeyen varsa çıkış kodu 1
#
# Ağ 151.80.0.0/16 (taklit DNS'te AS16276 OVH, FR). Şüpheli ağ uyarısı: 4 farklı /24'ten 6 tekil (eşik 5).
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"; BIN="$REPO/tests/durum-tablosu/bin"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"; cp "$BIN"/* "$W/bin/"; chmod +x "$W"/bin/*
wp() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
DT=$(LC_ALL=C date '+%a %b %d %H:%M:%S %Y'); OLD=$(LC_ALL=C date -d '-3 days' '+%a %b %d %H:%M:%S %Y')
N=0; F=0; OUT=""

mk() {   # temiz kök
    R="$W/r$N"; rm -rf "$R"; mkdir -p "$R/app" "$R/etc/csf" "$R/var/lib/csf" "$R/var/lib/csf_autogroup/cloud"
    D="$R/etc/csf/csf.deny"; T="$R/var/lib/csf/csf.tempban"; A="$R/etc/csf/csf.allow"; C="$R/var/lib/csf_autogroup/counter"; CF="$R/etc/csf/csf.conf"
    : > "$D"; : > "$T"; : > "$C"; printf '127.0.0.1\n' > "$A"; : > "$R/etc/csf/csf.ignore"; : > "$R/etc/csf/csf.rignore"; : > "$R/lfd.log"
    printf '%s\n' 'DENY_IP_LIMIT = "500"' 'DENY_TEMP_IP_LIMIT = "100"' 'CC_DENY = ""' 'CC_DENY_PORTS = ""' 'CC_DENY_PORTS_TCP = ""' 'CC_DENY_PORTS_UDP = ""' > "$CF"
    cp "$REPO/csf_autogroup.sh" "$R/app/csf_autogroup.sh"
    printf '%s\n' "MSG_LANG=tr" "ALERT_MAIL=" "DENY_FILE=$D" "CSF_CONF=$CF" "CSF_BIN=$W/bin/csf" "CSF_VAR=$R/var/lib/csf" \
        "LOG_FILE=$R/autogroup.log" "SAYAC_FILE=$C" "IMUNIFY_BIN=$W/bin/imunify360-agent" "LFD_LOG=$R/lfd.log" > "$R/app/config.env"
}
run() { env SIM_ROOT="$R" PATH="${XB:+$XB:}$W/bin:/usr/bin:/bin" AG_BY=root bash "$R/app/csf_autogroup.sh" "$@"; }
# XB: ek taklit dizini (ör. ipset'in "küme yok" dediği durum)
mkdir -p "$W/noset"; printf '%s\n' '#!/bin/bash' '# ipset taklidi: hiçbir küme yüklü değil' 'exit 1' > "$W/noset/ipset"; chmod +x "$W/noset/ipset"
why() {  # saldırı türü → lfd notu
    case "$1" in
        web)  echo "(mod_security) mod_security (id:2008) triggered by $2" ;;
        mail) echo "(smtpauth) Failed SMTP AUTH login from $2" ;;
        ssh)  echo "(sshd) Failed SSH login from $2" ;;
        perm) echo "(PERMBLOCK) $2 (FR/France/-) has had more than 3 temp blocks in the last 259200 secs" ;;
    esac
}
single() { printf '%s\n' "$1 # lfd: $(why "$2" "$1") (FR/France/-): 5 in the last 3600 secs - ${3:-$DT}" >> "$D"; }
attack() {   # TÜR [TARİH] → 6 tekil, 4 blok; mix = 5 web + 1 ssh; pweb/pssh/pyok = 5 web + 1 PERMBLOCK (önceki ban günlükte)
    local k="$1" d="${2:-$DT}" ip
    for ip in 151.80.7.1 151.80.7.2 151.80.8.1 151.80.8.2 151.80.9.1; do single "$ip" "$(case $k in mail|ssh) echo $k;; *) echo web;; esac)" "$d"; done
    case "$k" in
        mix) single 151.80.10.1 ssh "$d" ;;
        pweb|pssh|pyok) single 151.80.10.1 perm "$d"
            [ "$k" = pweb ] && echo "Oct  4 20:33:04 lin lfd[1]: $(why web 151.80.10.1) (FR/France/-): 10 in the last 3600 secs - *Blocked in csf* for 43200 secs [LF_TRIGGER]" >> "$R/lfd.log"
            [ "$k" = pssh ] && echo "Oct  4 20:33:04 lin lfd[1]: $(why ssh 151.80.10.1) (FR/France/-): 5 in the last 3600 secs - *Blocked in csf* for 3600 secs [LF_SSHD]" >> "$R/lfd.log" ;;
        *) single 151.80.10.1 "$k" "$d" ;;
    esac
}
layer() {    # koruma katmanı
    case "$1" in
        yok) ;;
        liste-web) printf '%s\n' CLOUD_BAN=1 CLOUD_SOURCES=gcp CLOUD_TCP=80,443 CLOUD_UDP=443 >> "$R/app/config.env"; echo "151.80.0.0/16" > "$R/var/lib/csf_autogroup/cloud/gcp.txt" ;;
        asn-web)   sed -i 's/^CC_DENY_PORTS = ""/CC_DENY_PORTS = "AS16276"/; s/^CC_DENY_PORTS_TCP = ""/CC_DENY_PORTS_TCP = "80,443"/; s/^CC_DENY_PORTS_UDP = ""/CC_DENY_PORTS_UDP = "443"/' "$CF" ;;
        asn-posta) sed -i 's/^CC_DENY_PORTS = ""/CC_DENY_PORTS = "AS16276"/; s/^CC_DENY_PORTS_TCP = ""/CC_DENY_PORTS_TCP = "465,587,110,995,143,993"/' "$CF" ;;
        asn-hepsi) sed -i 's/^CC_DENY = ""/CC_DENY = "AS16276"/' "$CF" ;;
        ulke-hepsi) sed -i 's/^CC_DENY = ""/CC_DENY = "FR"/' "$CF" ;;
        ulke-web)  sed -i 's/^CC_DENY_PORTS = ""/CC_DENY_PORTS = "FR"/; s/^CC_DENY_PORTS_TCP = ""/CC_DENY_PORTS_TCP = "80,443"/; s/^CC_DENY_PORTS_UDP = ""/CC_DENY_PORTS_UDP = "443"/' "$CF" ;;
        kismi-once) printf '%s\n' "tcp|in|d=80,443|s=151.80.0.0/16 # csf_autogroup: elle /16 kısmi ban (root) [svc=web] - do not delete - $OLD" "udp|in|d=443|s=151.80.0.0/16 # csf_autogroup: elle /16 kısmi ban (root) [svc=web] - do not delete - $OLD" >> "$D" ;;
    esac
}
review() {   # → "G[:açık servisler]" (Kontrol edilecekler'de) ya da "-"
    run --status --json 2>/dev/null > "$R/st.json"
    node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const r=(j.review||[]).find(x=>x.cidr==='151.80.0.0/16'); console.log(r ? 'G' + (r.pnsvc ? ':' + r.pnsvc : '') : '-');" "$(wp "$R/st.json")" 2>&1
}
check() {    # AD BEKLENEN GERÇEK
    N=$((N + 1))
    if [ "${3%%:*}" = "$2" ]; then OUT+="  ✓ $1 → $3"$'\n'; else F=$((F + 1)); OUT+="  ✗ $1 → $3 (beklenen $2)"$'\n'; fi
}
# ── 1) Kapsama: ağ yalnız saldırdığı her servis gerçekten kapalıysa Kontrol edilecekler'den düşer ──
cell() {   # KATMAN SALDIRI BEKLENEN — kısmi ban önceden konmuşsa saldırılar bandan sonra (bugün), uyarıyı motor üretir
    mk; layer "$1"; attack "$2"; run >/dev/null 2>&1; check "kapsama · $1 · $2" "$3" "$(review)"
}
for k in liste-web asn-web; do
    cell $k web -; cell $k mail G; cell $k ssh G; cell $k mix G; cell $k pweb -; cell $k pssh G; cell $k pyok -
done
cell yok web G
cell asn-posta web G; cell asn-posta mail -; cell asn-posta mix G
cell asn-hepsi web -; cell asn-hepsi ssh -; cell asn-hepsi mix -
cell ulke-hepsi web -; cell ulke-hepsi ssh -
cell ulke-web web -; cell ulke-web ssh G
cell kismi-once web G; cell kismi-once mail G; cell kismi-once ssh G     # web kısmi banından sonra web gelmesi = sızıntı, o da görünür

# kiralık liste ayarı açık ama gerçekte etkin değilse kapsama sayılmaz (liste dosyaları diskte kalsa da)
# uyarı liste yokken oluşmuş, sonra liste açılmış: etkinken gizlenir, eklenti duraklatılınca yeniden görünür
mk; attack web; run >/dev/null 2>&1; layer liste-web
check "kapsama · liste sonradan açılınca eski uyarı gizlenir" - "$(review)"
echo ENABLED=0 >> "$R/app/config.env"
check "kapsama · eklenti duraklatılmışken liste kapalı sayılmaz" G "$(review)"
mk; layer liste-web; attack web; XB="$W/noset"; run >/dev/null 2>&1; r=$(review); XB=""
check "kapsama · ag_cloud kümesi yüklü değilken liste kapalı sayılmaz" G "$r"

# ── 2) Kısmi ban saldırılardan SONRA konduysa öncekiler uyarı üretmez ──
mk; attack web "$OLD"; run >/dev/null 2>&1
printf '%s\n' "tcp|in|d=80,443|s=151.80.0.0/16 # csf_autogroup: elle /16 kısmi ban (root) [svc=web] - do not delete - $DT" >> "$D"
check "kısmi ban sonradan konunca eski uyarı gizlenir" - "$(review)"

# ── 3) İzinli servisler beyaz liste sayılır: o aralıkta blok banı konmaz, "atlandı" diye görünür ──
mk; printf 'Include %s\n' "$R/etc/csf/csf_autogroup.services.allow" >> "$A"
echo "151.80.7.0/24 # csf_autogroup: service google-common" > "$R/etc/csf/csf_autogroup.services.allow"
for x in 1 2 3 4 5 6; do single 151.80.7.$x web; done; run >/dev/null 2>&1
check "izinli servis aralığına blok banı konmaz" - "$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)"
check "izinli servis aralığı 'beyaz liste yüzünden atlandı' olarak görünür" G "$(grep -q '"type":"skip_wl","cidr":"151.80.7.0/24"' "$R/var/lib/csf_autogroup/events.jsonl" && echo G || echo -)"
# eklentinin kendi port istisnası ise beyaz liste değildir
mk; printf '%s\n' "tcp|in|d=80,443|s=151.80.7.0/24 # csf_autogroup: exception for 151.80.7.0/24 [svc=web]" >> "$A"
for x in 1 2 3 4 5 6; do single 151.80.7.$x ssh; done; run >/dev/null 2>&1
check "eklentinin port istisnası beyaz liste sayılmaz (blok banlanır)" G "$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)"

# csf.rignore: IP kartı motorla aynı kurala bakar (lfd'nin düzenli ifade biçimi de, ileri doğrulama da)
for rg in '.googlebot.com' '.*\.googlebot\.com$'; do
  mk; printf '%s\n' "$rg" > "$R/etc/csf/csf.rignore"; export PTR_GOOGLE=1
  r=$(run --lookup 151.80.7.9 --json 2>/dev/null | grep -q '"rig":"[^"]' && echo G || echo -); unset PTR_GOOGLE
  check "IP kartı · csf.rignore «$rg» tanınır" G "$r"
done

# ── 3b) Ban penceresi: kendi /24 banı ve onu kapsayan /16 varken "zaten kapsayan" en geniş olan (dosya sırasından bağımsız) ──
for ord in 24-16 16-24; do
  mk; l24="151.80.7.0/24 # csf_autogroup: elle /24 ban (root) - do not delete - $DT"; l16="151.80.0.0/16 # Manually denied: hosting - $DT"
  if [ "$ord" = 24-16 ]; then printf '%s\n%s\n' "$l24" "$l16" >> "$D"; else printf '%s\n%s\n' "$l16" "$l24" >> "$D"; fi
  check "ban penceresi · kapsayan en geniş ban ($ord sırası)" G "$(run --inside 151.80.7.0/24 --json 2>/dev/null | grep -q '"cover":"151.80.0.0/16' && echo G || echo -)"
done

# ── 3e) Otomatik blok banı: servisi zaten kapalı tekiller (katman konmadan önceki saldırılar) eşiğe sayılmaz ──
b24() { mk; layer "$1"; for x in 1 2 3; do single 151.80.7.$x "$2" "$OLD"; done; run >/dev/null 2>&1; grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -; }
check "blok banı · katman yok, web saldırısı → banlanır" G "$(b24 yok web)"
check "blok banı · liste web'i kapatıyor, web saldırısı → banlanmaz" - "$(b24 liste-web web)"
check "blok banı · liste web'i kapatıyor, SSH saldırısı → banlanır" G "$(b24 liste-web ssh)"
check "blok banı · /16 kısmi web banı var, web saldırısı → banlanmaz" - "$(b24 kismi-once web)"
check "blok banı · /16 kısmi web banı var, SSH saldırısı → banlanır" G "$(b24 kismi-once ssh)"

# ── 3d) Sağlayıcı sıralaması: port listesiyle banlı sağlayıcı yalnız açık servislere saldırı sürüyorsa görünür ──
rank() {   # → "-" sıralamada yok, "G" var, "G:pb" var ve port listesiyle banlı işaretli
    run --status --json 2>/dev/null > "$R/st.json"
    node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const a=(j.asn_top||[]).find(x=>x.asn==='16276'); console.log(a ? 'G' + (a.denied ? ':pb' : '') : '-');" "$(wp "$R/st.json")" 2>&1
}
mk; layer asn-web; for x in 7.1 8.1 9.1; do single 151.80.$x web; done; run >/dev/null 2>&1
check "sıralama · web banlı sağlayıcı, yalnız web saldırısı → görünmez" - "$(rank)"
mk; layer asn-web; for x in 7.1 8.1 9.1; do single 151.80.$x ssh; done; run >/dev/null 2>&1
r=$(rank); check "sıralama · web banlı sağlayıcı, SSH saldırısı → görünür" G "$r"
check "sıralama · ve 'port listesiyle banlı' işaretli" G "$([ "$r" = G:pb ] && echo G || echo -)"
mk; layer asn-hepsi; for x in 7.1 8.1 9.1; do single 151.80.$x ssh; done; run >/dev/null 2>&1
check "sıralama · her şey banlı sağlayıcı → görünmez" - "$(rank)"

# ── 3c) Eski blok temizliği: do not delete (tekrar gelip kalıcıya alınan) bloklar korunur ──
mk; D400=$(LC_ALL=C date -d '-400 days' '+%a %b %d %H:%M:%S %Y')
printf '%s\n' "151.80.7.0/24 # Auto-grouped from temp /24: 3 geçici tekil, 2. kez grup saldırısı nedeniyle kalıcı banlandı - do not delete - $D400" \
              "151.80.8.0/24 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - $D400" >> "$D"
run --action expire 365 >/dev/null 2>&1
check "eski blok temizliği · do not delete blok kalır" G "$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)"
check "eski blok temizliği · sıradan eski blok kalkar" - "$(grep -q '^151.80.8.0/24 ' "$D" && echo G || echo -)"

# ── 4) Sunucunun kendi sağlayıcısı (taklit: 203.0.113.10 → AS64500) hiçbir durumda banlanmaz ──
prov() { run --config set "$@" >/dev/null 2>&1; run --prov-apply >/dev/null 2>&1; }
inconf() { grep -q "^CC_DENY = \".*$1" "$CF" && echo G || echo -; }
mk; prov ASN_BAN=1 ASN_ALL=AS64500,AS14061
check "kendi sağlayıcısı listeye eklense de CSF'e yazılmaz" - "$(inconf AS64500)"
check "öteki sağlayıcı yazılır" G "$(inconf AS14061)"
mk; export NO_DNS=1; prov ASN_BAN=1 ASN_ALL=AS14061; unset NO_DNS
check "DNS sessiz, önceki bilgi yok: yeni sağlayıcı eklenmez (kendi sağlayıcısı bilinmiyor)" - "$(inconf AS14061)"
mk; mkdir -p "$R/var/lib/csf/Geo"; printf '203.0.113.0\t203.0.113.255\t64500\tUS\tEXAMPLE-HOSTING\n' > "$R/var/lib/csf/Geo/ip2asn-combined.tsv"
export NO_DNS=1; prov ASN_BAN=1 ASN_ALL=AS64500,AS14061; unset NO_DNS
check "DNS sessiz ama CSF'in ASN verisi var: kendi sağlayıcısı oradan tanınır" - "$(inconf AS64500)"
check "DNS sessiz ama CSF'in ASN verisi var: öteki sağlayıcı yazılır" G "$(inconf AS14061)"

printf 'Senaryolar\n%s' "$OUT"
echo "$N senaryo, $F beklenmeyen"
[ "$F" -eq 0 ]
