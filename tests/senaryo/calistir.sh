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
        ptag) single 151.80.10.1 perm "$d"       # günlükte yalnız PERMBLOCK satırı; tetikleyen kural etiketinde (gerçek lfd biçimi)
            echo "Oct  9 14:30:46 lin lfd[1]: (PERMBLOCK) 151.80.10.1 (FR/France/-) has had more than 3 temp blocks in the last 259200 secs - *Blocked in csf* [LF_SSHD]" >> "$R/lfd.log" ;;
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
# ── GERÇEK MOD (GERCEK=1): taklit yerine çalışan gerçek CSF/lfd (test sanal makinesi; root) ──
# Banlar gerçek csf.deny'ye yazılır ve csf -r ile güvenlik duvarına yüklenir; kiralık liste gerçek araçla (curl, ipset,
# AG_CLOUD kuralı, csfpost.sh) kurulur — listenin kaynağı yerel dosya (file://), çünkü gerçek bulut listelerinde test ağı
# yok; sağlayıcı / ülke banları gerçek csf.conf'a eklenir; sahip sorguları gerçek Team Cymru DNS'ine gider. CSF dosyaları
# test başında yedeklenir, her senaryoda ve sonda geri konur. Sunucunun kendi sağlayıcısı (özel IP) ve csf.rignore (taklit
# DNS) senaryoları bu modda atlanır.
if [ "${GERCEK:-0}" = 1 ]; then
    [ -x /usr/sbin/csf ] && [ "$(id -u)" = 0 ] || { echo "gerçek mod: root ve kurulu CSF gerekir"; exit 2; }
    BK=/root/senaryo-yedek; LST=/root/senaryo-liste.txt; mkdir -p "$BK"
    CSFF="csf.deny csf.allow csf.conf csf.rignore csf.ignore csfpost.sh"
    for f in $CSFF; do [ -e "/etc/csf/$f" ] && cp -a "/etc/csf/$f" "$BK/$f"; done
    restore() { local f; for f in $CSFF; do [ -e "$BK/$f" ] && cp -a "$BK/$f" "/etc/csf/$f"; done; }
    cloud_off() { CACHE="${R:-/tmp}/var/lib/csf_autogroup/cloud" CSF_DIR=/etc/csf bash "$REPO/tools/cloud-ban.sh" --remove >/dev/null 2>&1; }
    trap 'cloud_off; restore; csf -tf >/dev/null 2>&1; csf -r >/dev/null 2>&1; rm -rf "$W" "$LST"' EXIT
    mk() {
        R="$W/r$N"; rm -rf "$R"; mkdir -p "$R/app/tools" "$R/var/lib/csf_autogroup/cloud"
        D=/etc/csf/csf.deny; T=/var/lib/csf/csf.tempban; A=/etc/csf/csf.allow; C="$R/var/lib/csf_autogroup/counter"; CF=/etc/csf/csf.conf
        cloud_off; restore; csf -tf >/dev/null 2>&1; : > "$C"; : > "$R/lfd.log"
        cp "$REPO/csf_autogroup.sh" "$R/app/csf_autogroup.sh"; cp "$REPO"/tools/*.sh "$R/app/tools/"
        printf '%s\n' "MSG_LANG=tr" "ALERT_MAIL=" "DENY_FILE=$D" "CSF_CONF=$CF" "CSF_BIN=/usr/sbin/csf" "CSF_VAR=/var/lib/csf" \
            "LOG_FILE=$R/autogroup.log" "SAYAC_FILE=$C" "LFD_LOG=$R/lfd.log" > "$R/app/config.env"
        NEEDR=1
    }
    run() {   # csf.deny / csf.conf değiştiyse önce gerçek CSF'e yüklenir
        [ "$NEEDR" = 1 ] && { csf -r >/dev/null 2>&1; NEEDR=0; }
        env PATH="/usr/local/sbin:/usr/sbin:/usr/bin:/bin" AG_BY=root bash "$R/app/csf_autogroup.sh" "$@"
    }
    single() { printf '%s\n' "$1 # lfd: $(why "$2" "$1") (FR/France/-): 5 in the last 3600 secs - ${3:-$DT}" >> "$D"; NEEDR=1; }
    addconf() { local k="$1" v="$2" cur; cur=$(grep -E "^$k = " "$CF" | cut -d'"' -f2); sed -i "s|^$k = .*|$k = \"${cur:+$cur,}$v\"|" "$CF"; NEEDR=1; }
    setconf() { sed -i "s|^$1 = .*|$1 = \"$2\"|" "$CF"; NEEDR=1; }
    layer() {
        case "$1" in
            yok) ;;
            liste-web)
                echo "151.80.0.0/16" > "$LST"
                printf '%s\n' CLOUD_BAN=1 CLOUD_SOURCES= CLOUD_TCP=80,443 CLOUD_UDP=443 "CLOUD_EXTRA=\"test|file://$LST\"" >> "$R/app/config.env"   # | içeren değer tırnaklı (motor da öyle yazar)
                local CA="$R/var/lib/csf_autogroup/cloud"; echo "x-test" > "$CA/active"; printf 'tcp=80,443\nudp=443\n' > "$CA/ports"; echo "" > "$CA/self"
                SRC="x-test|file://$LST" CACHE="$CA" CSF_DIR=/etc/csf LOG_FILE="$R/autogroup.log" bash "$R/app/tools/cloud-ban.sh" >/dev/null 2>&1 ;;
            asn-web)   addconf CC_DENY_PORTS AS16276; setconf CC_DENY_PORTS_TCP 80,443; setconf CC_DENY_PORTS_UDP 443 ;;
            asn-posta) addconf CC_DENY_PORTS AS16276; setconf CC_DENY_PORTS_TCP 465,587,110,995,143,993 ;;
            asn-hepsi) addconf CC_DENY AS16276 ;;
            ulke-hepsi) addconf CC_DENY FR ;;
            ulke-web)  addconf CC_DENY_PORTS FR; setconf CC_DENY_PORTS_TCP 80,443; setconf CC_DENY_PORTS_UDP 443 ;;
            kismi-once) printf '%s\n' "tcp|in|d=80,443|s=151.80.0.0/16 # csf_autogroup: elle /16 kısmi ban (root) [svc=web] - do not delete - $OLD" "udp|in|d=443|s=151.80.0.0/16 # csf_autogroup: elle /16 kısmi ban (root) [svc=web] - do not delete - $OLD" >> "$D"; NEEDR=1 ;;
        esac
    }
fi

# ── 1) Kapsama: ağ yalnız saldırdığı her servis gerçekten kapalıysa Kontrol edilecekler'den düşer ──
cell() {   # KATMAN SALDIRI BEKLENEN — kısmi ban önceden konmuşsa saldırılar bandan sonra (bugün), uyarıyı motor üretir
    mk; layer "$1"; attack "$2"; run >/dev/null 2>&1; check "kapsama · $1 · $2" "$3" "$(review)"
}
for k in liste-web asn-web; do
    cell $k web -; cell $k mail G; cell $k ssh G; cell $k mix G; cell $k pweb -; cell $k pssh G; cell $k pyok -
done
cell yok web G
cell liste-web ptag G      # PERMBLOCK satırının [LF_SSHD] etiketinden: SSH, listeyle kapalı değil
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
if [ "${GERCEK:-0}" = 1 ]; then      # gerçek: liste kurulup tur çalıştıktan sonra küme ve kural kaldırılır, ayar açık kalır
    # uyarı liste yokken oluşur (liste etkinken motor uyarı hiç üretmez), sonra liste açılır ve kümesi bozulur
    mk; attack web; run >/dev/null 2>&1; layer liste-web; cloud_off; r=$(review)
else mk; layer liste-web; attack web; XB="$W/noset"; run >/dev/null 2>&1; r=$(review); XB=""; fi
check "kapsama · ag_cloud kümesi yüklü değilken liste kapalı sayılmaz" G "$r"

# ── 2) Kısmi ban saldırılardan SONRA konduysa öncekiler uyarı üretmez ──
mk; attack web "$OLD"; run >/dev/null 2>&1
printf '%s\n' "tcp|in|d=80,443|s=151.80.0.0/16 # csf_autogroup: elle /16 kısmi ban (root) [svc=web] - do not delete - $DT" >> "$D"
check "kısmi ban sonradan konunca eski uyarı gizlenir" - "$(review)"

# kısmi ban varken kapsama yalnız bandan SONRAKİ saldırılarla değerlendirilir (uyarıya / maile yazılanla aynı küme)
P5=$(LC_ALL=C date -d '-5 days' '+%a %b %d %H:%M:%S %Y')
mk; layer liste-web; layer kismi-once
for x in 11.1 11.2 12.1 12.2 13.1 13.2; do single 151.80.$x ssh "$P5"; done   # bandan önce, SSH
attack web; run >/dev/null 2>&1                                               # bandan sonra, web (listeyle de kapalı)
check "kısmi ban · bandan önceki SSH, sonraki web (kapalı) → uyarı/mail üretilmez" - "$(grep -q '"type":"warn16","cidr":"151.80.0.0/16"' "$R/var/lib/csf_autogroup/events.jsonl" 2>/dev/null && echo G || echo -)"

# ── 3) İzinli servisler beyaz liste sayılır: o aralıkta blok banı konmaz, "atlandı" diye görünür ──
mk; SVA="$(dirname "$A")/csf_autogroup.services.allow"
if [ "${GERCEK:-0}" = 1 ]; then     # gerçek: panelin yaptığı gibi özellik açılır, dosyayı ve Include'u eklentinin aracı yazar
    printf '%s\n' SVC_ALLOW=1 SVC_SOURCES= 'SVC_EXTRA="test|151.80.7.0/24"' >> "$R/app/config.env"; run --prov-apply >/dev/null 2>&1
else printf 'Include %s\n' "$SVA" >> "$A"; echo "151.80.7.0/24 # csf_autogroup: service google-common" > "$SVA"; fi
NEEDR=1
for x in 1 2 3 4 5 6; do single 151.80.7.$x web; done; run >/dev/null 2>&1
check "izinli servis aralığına blok banı konmaz" - "$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)"
check "izinli servis aralığı 'beyaz liste yüzünden atlandı' olarak görünür" G "$(grep -q '"type":"skip_wl","cidr":"151.80.7.0/24"' "$R/var/lib/csf_autogroup/events.jsonl" && echo G || echo -)"
[ "${GERCEK:-0}" = 1 ] && rm -f "$SVA"
# eklentinin kendi port istisnası ise beyaz liste değildir
mk; printf '%s\n' "tcp|in|d=80,443|s=151.80.7.0/24 # csf_autogroup: exception for 151.80.7.0/24 [svc=web]" >> "$A"
for x in 1 2 3 4 5 6; do single 151.80.7.$x ssh; done; run >/dev/null 2>&1
check "eklentinin port istisnası beyaz liste sayılmaz (blok banlanır)" G "$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)"

# csf.rignore: IP kartı motorla aynı kurala bakar (lfd'nin düzenli ifade biçimi de, ileri doğrulama da)
[ "${GERCEK:-0}" = 1 ] || for rg in '.googlebot.com' '.*\.googlebot\.com$'; do
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
check "blok banı · sağlayıcı banı web'i kapatıyor, web saldırısı → banlanmaz" - "$(b24 asn-web web)"
check "blok banı · sağlayıcı banı web'i kapatıyor, SSH saldırısı → banlanır" G "$(b24 asn-web ssh)"
check "blok banı · sağlayıcı tümden banlı, SSH saldırısı → banlanmaz" - "$(b24 asn-hepsi ssh)"
# /24 banlanınca içteki tekiller dosyadan silinir; lfd'nin tekrar ban geçmişi (csf.tempip) korunur (csf -dr onu da silerdi)
if [ "${GERCEK:-0}" = 1 ]; then
    mk; TIP=/var/lib/csf/csf.tempip; sed -i '/^151\.80\.7\./d' "$TIP" 2>/dev/null
    for x in 1 2 3; do single 151.80.7.$x ssh "$OLD"; printf '151.80.7.%s|1|%s\n' "$x" "$(date +%s)" >> "$TIP"; done
    run >/dev/null 2>&1
    r=$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)
    r+=$(grep -cE '^151\.80\.7\.[123] ' "$D")$(grep -cE '^151\.80\.7\.[123]\|' "$TIP")
    sed -i '/^151\.80\.7\./d' "$TIP"
    check "blok banı · tekiller dosyadan silinir, lfd geçmişi kalır (G=ban, 0 tekil satır, 3 geçmiş)" G03 "$r"
fi

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
r=$(node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
  const a=(j.asn_top||[]).find(x=>x.asn==='16276')||{}; const age=Date.now()/1000-(a.last||0);
  console.log(a.svc==='ssh:3' && a.last>0 && age<86400 ? 'G' : '-:'+a.svc+':'+a.last);" "$(wp "$R/st.json")" 2>&1)
check "sıralama · saldırılan servis (ssh:3) ve son saldırı zamanı satırda" G "$r"
mk; layer asn-hepsi; for x in 7.1 8.1 9.1; do single 151.80.$x ssh; done; run >/dev/null 2>&1
check "sıralama · her şey banlı sağlayıcı → görünmez" - "$(rank)"

# ── 3f) İzlenen blok: izleme süresi (180 gün) içinde yeniden saldırırsa kalıcı, süre dolduysa yeniden geçici ──
watchc() {   # GÜN_ÖNCE → "K" kalıcıya alındı, "G" geçici banlandı, "-" hiçbiri
    mk; local t; t=$(date +%s)
    printf '151.80.7 %s\n' "$(date -d "-$1 days" +%F)" >> "$C"
    for x in 1 2 3; do printf '%s|151.80.7.%s||in|43200|lfd: (sshd) Failed SSH login from 151.80.7.%s\n' "$t" "$x" "$x" >> "$T"; done
    NEEDR=1; run >/dev/null 2>&1
    if grep -q '^151.80.7.0/24 ' "$D"; then echo K; elif grep -qF '|151.80.7.0/24|' "$T"; then echo G; else echo -; fi
}
check "izlenen blok · 10 gün sonra yeniden saldırı → kalıcı" K "$(watchc 10)"
check "izlenen blok · 200 gün sonra (süre dolmuş) saldırı → yeniden geçici" G "$(watchc 200)"

# ── 3c) Eski blok temizliği: do not delete (tekrar gelip kalıcıya alınan) bloklar korunur ──
mk; D400=$(LC_ALL=C date -d '-400 days' '+%a %b %d %H:%M:%S %Y')
printf '%s\n' "151.80.7.0/24 # Auto-grouped from temp /24: 3 geçici tekil, 2. kez grup saldırısı nedeniyle kalıcı banlandı - do not delete - $D400" \
              "151.80.8.0/24 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - $D400" >> "$D"
printf '%s\n' "151.80.9.0/24 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - $D400" >> "$D"
echo "151.80.9.0/24 $(( $(date +%s) - 5 * 86400 ))" > "$(dirname "$C")/block_hits"      # 5 gün önce denenmiş (sayaç)
NEEDR=1; run --action expire 365 >/dev/null 2>&1
check "eski blok temizliği · do not delete blok kalır" G "$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)"
check "eski blok temizliği · sıradan eski blok kalkar" - "$(grep -q '^151.80.8.0/24 ' "$D" && echo G || echo -)"
check "eski blok temizliği · son 30 günde denenen blok kalır" G "$(grep -q '^151.80.9.0/24 ' "$D" && echo G || echo -)"

# ── 3j) CSF'in liste sınırı (yalnız gerçek CSF): DENY_IP_LIMIT dolunca CSF en eski işaretsiz satırı siler (csf.pl) ──
if [ "${GERCEK:-0}" = 1 ]; then
    mk; setconf DENY_IP_LIMIT 3
    printf '%s\n' "151.80.7.0/24 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - $OLD" >> "$D"
    single 198.51.100.11 ssh; NEEDR=1; run >/dev/null 2>&1                 # tur: eklentinin blok listesi kaydedilir
    csf -d 198.51.100.12 test >/dev/null 2>&1; csf -d 198.51.100.13 test >/dev/null 2>&1
    check "liste sınırı · CSF dolunca en eski işaretsiz satırı (eklentinin /24'ü) siler" - "$(grep -q '^151.80.7.0/24 ' "$D" && echo G || echo -)"
    sleep 1; run >/dev/null 2>&1
    check "liste sınırı · tur silinen bloğu izlemeye alır ve bildirir" G "$(grep -q '^151.80.7 ' "$C" && grep -q '"type":"limit_gone","cidr":"151.80.7.0/24"' "$R/var/lib/csf_autogroup/events.jsonl" && echo G || echo -)"
fi

# ── 3g) Banlı blok sayacı (yalnız gerçek CSF): eylemsiz sayan kural + sayaçlı küme; csf -r sonrası csfpost.sh ile geri gelir ──
if [ "${GERCEK:-0}" = 1 ]; then
    mk; printf '%s\n' "198.51.100.0/24 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - $DT" >> "$D"; NEEDR=1; run >/dev/null 2>&1
    hs() { echo "$(ipset list -n 2>/dev/null | grep -cx ag_hits)/$(iptables -t mangle -S PREROUTING 2>/dev/null | grep -c 'match-set ag_hits')/$(ipset list ag_hits 2>/dev/null | grep -c '^198.51.100.0/24 ')"; }
    check "sayaç · turdan sonra küme, kural ve banlı blok yerinde" G "$([ "$(hs)" = 1/1/1 ] && echo G || echo "-:$(hs)")"
    check "sayaç · kural mangle PREROUTING'in en başında (kiralık liste ve ban korumasından önce)" G "$(iptables -t mangle -S PREROUTING | grep -- '^-A' | head -n 1 | grep -q ag_hits && echo G || echo -)"
    csf -r >/dev/null 2>&1
    check "sayaç · csf -r sonrası csfpost.sh ile geri geldi" G "$([ "$(hs)" = 1/1/1 ] && echo G || echo "-:$(hs)")"
    DENY="$D" CSF_DIR=/etc/csf bash "$REPO/tools/block-hits.sh" --remove >/dev/null 2>&1
    # CSF /usr/local/csf/bin/csfpost.sh varsa yalnız onu çalıştırır (csf.pl): satır oraya yazılmalı, /etc/csf'tekinden silinmeli
    UP=/usr/local/csf/bin/csfpost.sh; mkdir -p "${UP%/*}"
    mk; printf '#!/bin/bash\n' > "$UP"; chmod 700 "$UP"
    printf '%s\n' '[ -r /x ] && bash /x --apply # csf_autogroup hits' >> /etc/csf/csfpost.sh      # eski sürümden kalmış satır
    printf '%s\n' "198.51.100.0/24 # Auto-grouped /24: 3 kalıcı tekil nedeniyle kalıcı banlandı - $DT" >> "$D"; NEEDR=1; run >/dev/null 2>&1
    check "csfpost · /usr/local/csf/bin/csfpost.sh varken satır oraya yazılır, /etc/csf'teki eski satır silinir" G "$(grep -qF '# csf_autogroup hits' "$UP" && ! grep -qF '# csf_autogroup hits' /etc/csf/csfpost.sh && echo G || echo -)"
    csf -r >/dev/null 2>&1
    check "csfpost · csf -r sonrası sayaç kuralı CSF'in çalıştırdığı dosyadan geri gelir" G "$([ "$(hs)" = 1/1/1 ] && echo G || echo "-:$(hs)")"
    DENY="$D" CSF_DIR=/etc/csf bash "$REPO/tools/block-hits.sh" --remove >/dev/null 2>&1; rm -f "$UP"
fi

# ── 3h) Kiralık liste kuralının yeri (yalnız gerçek CSF): mangle PREROUTING, nat'tan önce ──
# Imunify360 gri listeyi nat'ta WebShield portuna çevirip CSF'ten önce kabul ediyor ve kendi zincirini INPUT'un başına
# yeniden koyuyor; kural INPUT'tayken ikinci sıraya düşüyordu (sunucuda ölçüldü 2026-10-11). mangle PREROUTING'te bu yarış yok.
if [ "${GERCEK:-0}" = 1 ]; then
    mk; layer liste-web; run >/dev/null 2>&1
    mtop() {  # $1 zinciri mangle PREROUTING'te; önünde yalnız eklentinin kendi zincirleri olabilir
        local s n; s=$(iptables -t mangle -S PREROUTING | grep -- '^-A'); n=$(printf '%s\n' "$s" | grep -n -- "-j $1\$" | cut -d: -f1)
        [ -n "$n" ] && ! printf '%s\n' "$s" | head -n $(( n - 1 )) | grep -vqE -- '-j (AG_GUARD|AG_CLOUD)$|--match-set ag_hits src$' && echo G || echo "-:$(printf '%s\n' "$s" | head -n 2 | tr '\n' ' ')"; }
    check "kiralık liste · kural mangle PREROUTING'te (nat'tan önce)" G "$(mtop AG_CLOUD)"
    check "kiralık liste · filter INPUT ve LOCALINPUT'ta kural yok" - "$({ iptables -C INPUT ! -i lo -j AG_CLOUD || iptables -C LOCALINPUT ! -i lo -j AG_CLOUD; } 2>/dev/null && echo G || echo -)"
    # DROP kuralları (önlerinde cPanel'in kendi tek portluk izinleri — ör. Sectigo 80/443 — için RETURN kuralları olabilir)
    check "kiralık liste · tcp 80, tcp 443, udp 443 kuralları" G "$([ "$(iptables -t mangle -S AG_CLOUD | grep -- '--dport' | grep -c DROP)" = 3 ] && echo G || echo "-:$(iptables -t mangle -S AG_CLOUD | grep -- '--dport' | grep -c DROP)")"
    iptables -t mangle -N IMU_M 2>/dev/null; iptables -t mangle -I PREROUTING 1 -j IMU_M
    run >/dev/null 2>&1
    check "kiralık liste · mangle'da başka zincir öne geçince tur kuralı yeniden başa alır" G "$(mtop AG_CLOUD)"
    iptables -t mangle -D PREROUTING -j IMU_M 2>/dev/null; iptables -t mangle -X IMU_M 2>/dev/null
    printf '151.80.5.5 # test müşterisi\n' >> "$A"; run >/dev/null 2>&1
    check "kiralık liste · csf.allow'daki adres kümede muaf" - "$(ipset test ag_cloud 151.80.5.5 >/dev/null 2>&1 && echo G || echo -)"
    check "kiralık liste · aynı aralıkta izinsiz adres kümede" G "$(ipset test ag_cloud 151.80.6.6 >/dev/null 2>&1 && echo G || echo -)"
    csf -r >/dev/null 2>&1
    check "kiralık liste · csf -r sonrası csfpost.sh kuralı yine kurar" G "$(mtop AG_CLOUD)"
    cloud_off
fi

# ── 3i) Ban koruması (yalnız gerçek CSF): Imunify360'ın yönlendirdiği bağlantıda porta bağlı banlar ──
# Ayrı bir ağ alanında dış istemci (10.99.0.2); Imunify taklidi istemcinin 80'ini 52224'e çevirir, CSF'ten önce kabul eder ve
# kendi zincirini her seferinde INPUT'un başına yeniden koyar (sunucudaki gibi). Web kısmi banı korumasız sızar, tur korumayı
# kurunca kesilir; SSH kısmi banı ve izin listesi web'i açık bırakır; kiralık listedeki istemci de kesilir.
if [ "${GERCEK:-0}" = 1 ] && command -v ip >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
    NC=10.99.0.2; NS=10.99.0.1
    nsup() { ip netns del agcli 2>/dev/null; ip link del agv0 2>/dev/null; ip netns add agcli; ip link add agv0 type veth peer name agv1
             ip link set agv1 netns agcli; ip addr add $NS/24 dev agv0; ip link set agv0 up
             ip netns exec agcli ip addr add $NC/24 dev agv1; ip netns exec agcli ip link set agv1 up; ip netns exec agcli ip link set lo up
             # --bind 0.0.0.0: http.server varsayılanı "::" (çift yığın); IPv6'sı olmayan ağ alanında (kapsayıcı) bağlanamıyor
             (cd /tmp && nohup python3 -m http.server --bind 0.0.0.0 80 >/dev/null 2>&1 &); (cd /tmp && nohup python3 -m http.server --bind 0.0.0.0 52224 >/dev/null 2>&1 &); sleep 1; }
    imu() { ipset create agimu hash:ip -exist; ipset add agimu $NC -exist
            iptables -t nat -N IMU_T 2>/dev/null; iptables -t nat -F IMU_T; iptables -t nat -A IMU_T -p tcp -m set --match-set agimu src --dport 80 -j DNAT --to-destination :52224
            iptables -t nat -C PREROUTING -j IMU_T 2>/dev/null || iptables -t nat -I PREROUTING 1 -j IMU_T
            iptables -N IMU_T 2>/dev/null; iptables -F IMU_T; iptables -A IMU_T -m conntrack ! --ctstate NEW -j RETURN
            iptables -A IMU_T -p tcp -m set --match-set agimu src -m multiport --dports 52223,52224 -j ACCEPT
            while iptables -D INPUT -j IMU_T 2>/dev/null; do :; done; iptables -I INPUT 1 -j IMU_T; }    # her seferinde en başa (Imunify gibi)
    # --noproxy: geliştirme oturumunun vekil ayarı (http_proxy) ağ alanındaki istemciye geçmesin
    web() { [ "$(ip netns exec agcli curl -s --noproxy '*' -m 4 -o /dev/null -w '%{http_code}' http://$NS/ 2>/dev/null)" = 200 ] && echo G || echo -; }
    gstate() { STATE="$R/var/lib/csf_autogroup/guard.sum" CSF_DIR=/etc/csf bash "$REPO/tools/ban-guard.sh" "$@" >/dev/null 2>&1; }
    nsup
    mk; printf 'tcp|in|d=80,443|s=%s # csf_autogroup: test kısmi ban [svc=web] - %s\n' $NC "$DT" >> "$D"; csf -r >/dev/null 2>&1; NEEDR=0; imu
    check "ban koruması · koruma yokken web kısmi banı Imunify yönlendirmesiyle sızar" G "$(web)"
    run >/dev/null 2>&1; imu
    check "ban koruması · tur korumayı kurar: Imunify en baştayken bile web kısmi banı kesilir" - "$(web)"
    check "ban koruması · koruma mangle PREROUTING'te" G "$(mtop AG_GUARD)"
    csf -r >/dev/null 2>&1; imu
    check "ban koruması · csf -r sonrası csfpost kurar, Imunify en baştayken kesilir" - "$(web)"
    mk; printf 'tcp|in|d=22|s=%s # csf_autogroup: test kısmi ban [svc=ssh] - %s\n' $NC "$DT" >> "$D"; csf -r >/dev/null 2>&1; NEEDR=0; run >/dev/null 2>&1; imu
    check "ban koruması · yalnız SSH kısmi banı: web açık" G "$(web)"
    mk; printf 'tcp|in|d=80,443|s=%s # test - %s\n' $NC "$DT" >> "$D"; printf '%s # test müşterisi\n' $NC >> "$A"; csf -r >/dev/null 2>&1; NEEDR=0; run >/dev/null 2>&1; imu
    check "ban koruması · csf.allow + web kısmi banı: izin önce gelir" G "$(web)"
    mk; printf 'tcp|in|d=80,443|s=%s # test - %s\n' $NC "$DT" >> "$D"; printf 'tcp|in|d=22|s=%s # müşteri yalnız SSH\n' $NC >> "$A"; csf -r >/dev/null 2>&1; NEEDR=0; run >/dev/null 2>&1; imu
    check "ban koruması · yalnız SSH izni + web kısmi banı: web kesilir (tek portluk izin tam muafiyet değil)" - "$(web)"
    # izinli servislerden hariç tutma (SVC_EXCEPT): izinli servis listesindeki banlı IP geçer; panelin yaptığı gibi hariç
    # tutulup uygulanınca banı işler, listenin geri kalanı izinli kalır
    mk; printf '%s\n' SVC_ALLOW=1 SVC_SOURCES= 'SVC_EXTRA="test|10.99.0.0/24"' >> "$R/app/config.env"; run --prov-apply >/dev/null 2>&1
    printf '%s # lfd: (mod_security) mod_security (id:2008) triggered by %s (XX/-/-): 1 in the last 3600 secs - %s\n' $NC $NC "$DT" >> "$D"
    csf -r >/dev/null 2>&1; NEEDR=0
    check "hariç tutma · izinli servis listesindeki banlı IP geçer (izin önce gelir)" G "$(web)"
    run --config set "SVC_EXCEPT=$NC" >/dev/null 2>&1; run --prov-apply >/dev/null 2>&1
    SVA=/etc/csf/csf_autogroup.services.allow
    check "hariç tutma · uygulanınca IP listeden çıkar, banı işler" - "$(web)"
    check "hariç tutma · listenin geri kalanı izinli kalır (aralık bölünür)" G "$(grep -q '^10\.99\.0\.128/25 ' $SVA && grep -q '^10\.99\.0\.3 ' $SVA && ! grep -qE '^10\.99\.0\.(2|0/24) ' $SVA && echo G || echo -)"
    run --config set SVC_EXCEPT= >/dev/null 2>&1; run --prov-apply >/dev/null 2>&1
    check "hariç tutma · listeden silinince eski hâline döner (IP yine geçer)" G "$(web)"
    rm -f "$SVA"
    # izinli ama saldıran (gerçek lfd): istemci csf.allow'da, SSH'ye 10 başarısız giriş. IGNORE_ALLOW=0: lfd banlar ama ban
    # işlemez (istemci siteye ulaşır) → "Ban işlemiyor"; IGNORE_ALLOW=1: lfd banlamaz, "ignored" yazar → "lfd yoksaydı"
    SLOG=$(awk -F'"' '/^SSHD_LOG/ { print $2 }' /etc/csf/csf.conf); SLOG=${SLOG:-/var/log/secure}; touch "$SLOG"
    sshfail() { local i; for i in $(seq 1 10); do printf '%s %s sshd[%s]: Failed password for root from %s port %s ssh2\n' "$(LC_ALL=C date '+%b %e %H:%M:%S')" "$(hostname -s)" "$((7000 + i))" "$1" "$((40000 + i))" >> "$SLOG"; done; }
    # lfd yeniden başlatma: systemd varsa onunla, yoksa (kapsayıcı, tests/senaryo/kur-bulut.sh) doğrudan
    lfdre() { if systemctl restart lfd >/dev/null 2>&1; then return; fi; pkill -f 'lfd - ' 2>/dev/null; sleep 1; /usr/sbin/lfd >/dev/null 2>&1; }
    rvhas() { run --status --json 2>/dev/null | grep -o '"review":\[.*\],"ignored"' | sed 's/^"review":\[//; s/,{"t":/\n{"t":/g' | grep -E "^\{\"t\":[0-9]+,\"type\":\"allow_ban\",\"cidr\":\"$1\"" | grep -q "$2"; }
    sed -i "/^$NC|/d" /var/lib/csf/csf.tempip 2>/dev/null     # önceki koşuların tekrar ban geçmişi: LF_PERMBLOCK eşiğinde lfd geçici değil kalıcı banlar
    for ia in 0 1; do
        mk; printf '%s # test müşterisi\n' $NC >> "$A"; sed -i "s/^IGNORE_ALLOW = .*/IGNORE_ALLOW = \"$ia\"/" "$CF"; echo "LFD_LOG=/var/log/lfd.log" >> "$R/app/config.env"
        csf -r >/dev/null 2>&1; NEEDR=0; lfdre; sleep 8; sshfail $NC; sleep 25; imu
        if [ "$ia" = 0 ]; then
            check "izinli saldırgan · IGNORE_ALLOW=0: lfd izinli IP'yi banlar (geçici liste)" G "$(grep -q "|$NC|" /var/lib/csf/csf.tempban && echo G || echo -)"
            check "izinli saldırgan · IGNORE_ALLOW=0: ban işlemez, istemci siteye ulaşır" G "$(web)"
            check "izinli saldırgan · IGNORE_ALLOW=0: Kontrol edilecekler 'Ban işlemiyor'" G "$(rvhas $NC '"bk":"b".*"full":1' && echo G || echo -)"
        else
            check "izinli saldırgan · IGNORE_ALLOW=1: lfd banlamaz" - "$(grep -q "|$NC|" /var/lib/csf/csf.tempban && echo G || echo -)"
            # sayı: gerçek lfd günlüğü son 7 günü tutar, önceki test çalıştırmalarının satırları da sayılır → en az 10
            check "izinli saldırgan · IGNORE_ALLOW=1: Kontrol edilecekler 'lfd yoksaydı' (en az 10 kez, tam izin)" G "$(rvhas $NC '"bk":"i","cnt":[1-9][0-9][0-9]*,"full":1' && echo G || echo -)"
        fi
        csf -tr $NC >/dev/null 2>&1
    done
    # csf.ignore: lfd banlamaz ama güvenlik duvarında izin değildir → elle ban işler
    mk; printf '%s\n' $NC >> /etc/csf/csf.ignore; echo "LFD_LOG=/var/log/lfd.log" >> "$R/app/config.env"; csf -r >/dev/null 2>&1; NEEDR=0; lfdre; sleep 8; sshfail $NC; sleep 25
    check "izinli saldırgan · csf.ignore: Kontrol edilecekler 'Yoksayılıyor' (tam izin değil)" G "$(rvhas $NC '"bk":"i".*"full":0' && echo G || echo -)"
    # ölçüldü: CSF yoksayılan IP'yi tek başına banlamaz ("deny failed: … is in the ignore file"); içine alan blok banı keser
    check "izinli saldırgan · csf.ignore'daki IP'yi CSF tek başına banlamayı reddeder" G "$(csf -d $NC test 2>&1 | grep -q 'in the ignore file' && echo G || echo -)"
    csf -d "${NC%.*}.0/24" test >/dev/null 2>&1; imu
    check "izinli saldırgan · csf.ignore'daki IP'yi içine alan blok banı onu keser" - "$(web)"
    csf -dr "${NC%.*}.0/24" >/dev/null 2>&1; lfdre
    # sunucunun kendi IP'si: lfd kendi adreslerini her zaman yoksayar (lfd.pl ignoreip, ilk denetim) → "Sunucunun kendi IP'si"
    SIP=$(ip -4 -o addr show 2>/dev/null | awk '{print $4}' | sed 's#/.*##' | grep -v '^127\.' | head -n 1)
    if [ -n "$SIP" ]; then
        mk; echo "LFD_LOG=/var/log/lfd.log" >> "$R/app/config.env"; csf -r >/dev/null 2>&1; NEEDR=0; lfdre; sleep 8; sshfail "$SIP"; sleep 25
        check "kendi IP'si · lfd sunucunun kendi adresinden gelen başarısız girişleri yoksayar (- ignored)" G "$(grep -q "from $SIP - ignored" /var/log/lfd.log && echo G || echo -)"
        check "kendi IP'si · Kontrol edilecekler 'Sunucunun kendi IP'si' (full=2)" G "$(rvhas $SIP '"bk":"i".*"full":2' && echo G || echo -)"
    fi
    # kiralık liste: istemci listede, Imunify yönlendiriyor ve en başta
    mk; echo "$NC/32" > "$LST"
    printf '%s\n' CLOUD_BAN=1 CLOUD_SOURCES= CLOUD_TCP=80,443 CLOUD_UDP=443 "CLOUD_EXTRA=\"test|file://$LST\"" >> "$R/app/config.env"
    csf -r >/dev/null 2>&1; NEEDR=0; run >/dev/null 2>&1; imu
    check "kiralık liste · Imunify yönlendirip en başta dururken listedeki istemci kesilir" - "$(web)"
    # izin listesi CSF'in tanımıyla (tools/allow-list.sh): tek portluk izin yalnız kendi portunda geçer, tam izin her portta
    printf 'tcp|in|d=22|s=%s # müşteri yalnız SSH\n' $NC >> "$A"; csf -r >/dev/null 2>&1; run >/dev/null 2>&1; imu
    check "kiralık liste · yalnız SSH izni olan listedeki istemci web'den yine kesilir" - "$(web)"
    printf 'tcp|in|d=80|s=%s # müşteri web\n' $NC >> "$A"; csf -r >/dev/null 2>&1; run >/dev/null 2>&1; imu
    check "kiralık liste · web portuna izinli istemci geçer" G "$(web)"
    sed -i "/s=$NC # müşteri/d" "$A"; csf -r >/dev/null 2>&1; run >/dev/null 2>&1; imu
    csf -ta $NC 3600 test >/dev/null 2>&1; run >/dev/null 2>&1; imu
    check "kiralık liste · CSF'in geçici izni (csf -ta) olan istemci geçer" G "$(web)"
    csf -tar $NC >/dev/null 2>&1
    # istemci 80'de dinler (TCP_OUT 80'e izin verir; cevabın kaynak portu da 80, kural yalnız hedef porta bakmalı)
    c=$(ip netns exec agcli bash -c "cd /tmp && (nohup python3 -m http.server --bind 0.0.0.0 80 >/dev/null 2>&1 &) ; sleep 1"; curl -s --noproxy '*' -m 4 -o /dev/null -w '%{http_code}' http://$NC/ 2>/dev/null)
    ip netns exec agcli pkill -f 'http.server --bind 0.0.0.0 80$' 2>/dev/null   # yalnız istemcininki (pid alanı ortak; sunucunun 80'i kalır)
    check "kiralık liste · sunucunun listedeki adrese kendi bağlantısı kopmaz" G "$([ "$c" = 200 ] && echo G || echo -)"
    # banlı blok sayacı mangle'da kiralık listeden ÖNCE sayar: listede düşen deneme de "son deneme" tarihini yeniler
    printf '10.99.0.0/24 # test blok banı - %s\n' "$DT" >> "$D"; csf -r >/dev/null 2>&1; run >/dev/null 2>&1; imu; web >/dev/null
    check "sayaç · kiralık listede (mangle) düşen deneme de banlı bloğun sayacına yazılır" G "$(DENY="$D" bash "$REPO/tools/block-hits.sh" --read 2>/dev/null | grep -q '^10\.99\.0\.0/24 ' && echo G || echo -)"
    run >/dev/null 2>&1
    check "sayaç · tur deneme tarihini dosyaya yazar" G "$(grep -q '^10\.99\.0\.0/24 [0-9]' "$R/var/lib/csf_autogroup/block_hits" && echo G || echo -)"
    sed -i '/^10\.99\.0\.0\/24 /d' "$D"; csf -r >/dev/null 2>&1; DENY="$D" CSF_DIR=/etc/csf bash "$REPO/tools/block-hits.sh" --remove >/dev/null 2>&1
    cloud_off
    echo ENABLED=0 >> "$R/app/config.env"; run >/dev/null 2>&1
    check "ban koruması · duraklatınca kural ve csfpost satırı kalkar" - "$({ iptables -t mangle -L AG_GUARD -n || iptables -L AG_GUARD -n; } >/dev/null 2>&1 || grep -qF '# csf_autogroup guard' /etc/csf/csfpost.sh && echo G || echo -)"
    gstate --remove; while iptables -D INPUT -j IMU_T 2>/dev/null; do :; done; iptables -F IMU_T 2>/dev/null; iptables -X IMU_T 2>/dev/null
    iptables -t nat -D PREROUTING -j IMU_T 2>/dev/null; iptables -t nat -F IMU_T 2>/dev/null; iptables -t nat -X IMU_T 2>/dev/null; ipset destroy agimu 2>/dev/null
    pkill -f "http.server" 2>/dev/null; ip netns del agcli 2>/dev/null; ip link del agv0 2>/dev/null
fi

# ── 4) Sunucunun kendi sağlayıcısı (taklit: 203.0.113.10 → AS64500) hiçbir durumda banlanmaz ──
if [ "${GERCEK:-0}" != 1 ]; then     # taklit DNS gerekir (gerçek modda sunucu IP'si özel adres, Cymru cevap vermez)
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
fi

printf 'Senaryolar\n%s' "$OUT"
echo "$N senaryo, $F beklenmeyen"
[ "$F" -eq 0 ]
