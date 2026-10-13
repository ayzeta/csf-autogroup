#!/bin/bash
# CSF Auto-Group — geçici bir Linux kapsayıcısına (bulut geliştirme oturumu) gerçek CSF/lfd kurar; sonra senaryo
# matrisi gerçek güvenlik duvarıyla çalıştırılabilir: GERCEK=1 bash tests/senaryo/calistir.sh
#
#   bash tests/senaryo/kur-bulut.sh [KAYNAK]
#
# KAYNAK (isteğe bağlı): cPanel'in dağıttığı cpanel-csf paketi — .rpm (dnf download cpanel-csf) ya da kurulu dosyaların
# arşivi (.tgz / .tar.gz: rpm -ql cpanel-csf | tar czf cpanel-csf.tgz -T -). Verilmezse cPanel'in GitHub deposu
# (github.com/cpanel/cpanel-csf) klonlanır; orada yayımlanan son sürüm 16.07, yeni sürümler yalnız paketle dağıtılır.
#
# Gerekenler: Debian/Ubuntu tabanlı kapsayıcı, root, NET_ADMIN (iptables/ipset kural yazabilmeli), apt ve internet.
# Yapılanlar: paketler (ipset, iproute2, perl modülleri…), CSF /opt/cpanel-csf altına ve CSF'in beklediği yollara
# bağlantılarla (/usr/sbin/csf, /usr/sbin/lfd, /usr/local/csf/{lib,bin}, /etc/csf), cPanel'e özgü perl modüllerinin
# taklitleri (tests/senaryo/bulut), sendmail taklidi (/var/log/sendmail-taklit.log), csf.conf test ayarları
# (TESTING=0, LF_IPSET=1, bütün portlar açık — oturumun kendi bağlantısı kesilmesin), csf -r ve lfd.
# Sunucuda ÇALIŞTIRMAYIN: csf.conf'u ve güvenlik duvarını değiştirir. İkinci çalıştırma kurulumu yeniler.
set -u
H="$(cd "$(dirname "$0")" && pwd)"
KAYNAK="${1:-}"
OPT=/opt/cpanel-csf
die() { echo "kur-bulut: $*" >&2; exit 2; }
[ "$(id -u)" = 0 ] || die "root gerekir"
command -v apt-get >/dev/null 2>&1 || die "apt-get yok (Debian/Ubuntu tabanlı kapsayıcı gerekir)"
[ -z "$KAYNAK" ] || [ -r "$KAYNAK" ] || die "kaynak okunamıyor: $KAYNAK"

echo "== paketler"
export DEBIAN_FRONTEND=noninteractive
PK="ipset iproute2 iptables kmod bind9-host curl git python3 rpm2cpio cpio gzip tar perl
    libnet-cidr-lite-perl libio-socket-ssl-perl libnet-ip-perl libcrypt-cbc-perl libwww-perl libemail-valid-perl
    libjson-perl libnet-ssleay-perl libfile-slurper-perl libcpanel-json-xs-perl libio-socket-inet6-perl libgd-graph-perl"
# shellcheck disable=SC2086
if ! apt-get install -y -q $PK >/tmp/kur-bulut-apt.log 2>&1; then
    apt-get update -q >>/tmp/kur-bulut-apt.log 2>&1
    # shellcheck disable=SC2086
    apt-get install -y -q $PK >>/tmp/kur-bulut-apt.log 2>&1 || die "paket kurulamadı (/tmp/kur-bulut-apt.log)"
fi

echo "== yetki denetimi"
iptables -L -n >/dev/null 2>&1 || die "iptables çalışmıyor (NET_ADMIN yok?)"
ipset create agkur_t hash:net -exist 2>/dev/null && ipset destroy agkur_t || die "ipset kümesi kurulamıyor (çekirdek desteği yok?)"
ip netns add agkur_t 2>/dev/null && ip netns del agkur_t || echo "   uyarı: ağ alanı (ip netns) açılamıyor; ban koruması senaryoları atlanır"

echo "== CSF kaynağı"
rm -rf "$OPT"; mkdir -p "$OPT"
if [ -z "$KAYNAK" ]; then
    GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 https://github.com/cpanel/cpanel-csf "$OPT" || die "GitHub klonu başarısız"
else
    X=$(mktemp -d)
    case "$KAYNAK" in
        *.rpm) ( cd "$X" && rpm2cpio "$(cd "$(dirname "$KAYNAK")" && pwd)/$(basename "$KAYNAK")" | cpio -idm --quiet ) || die "rpm açılamadı" ;;
        *.tgz|*.tar.gz|*.tar) tar xf "$KAYNAK" -C "$X" || die "arşiv açılamadı" ;;
        *) die "kaynak .rpm, .tgz ya da .tar.gz olmalı" ;;
    esac
    # paket düzeni: usr/sbin/csf, usr/sbin/lfd, usr/local/csf/{lib,bin,data,…}, etc/csf → ağaç olduğu gibi $OPT altında
    [ -f "$X/usr/sbin/csf" ] && [ -f "$X/usr/sbin/lfd" ] && [ -d "$X/usr/local/csf/lib" ] && [ -d "$X/etc/csf" ] || die "pakette usr/sbin/csf, usr/sbin/lfd, usr/local/csf/lib ya da etc/csf yok"
    cp -a "$X/usr/sbin/csf" "$OPT/csf.pl"; cp -a "$X/usr/sbin/lfd" "$OPT/lfd.pl"
    mv "$X/usr/local/csf" "$OPT/csfdir"; mv "$X/etc/csf" "$OPT/etc"
    [ -L "$OPT/etc/version.txt" ] && cp -f "$OPT/csfdir/docs/version.txt" "$OPT/etc/version.txt" 2>/dev/null   # pakette /usr/local/csf/docs'a bağlantı
    rm -rf "$X"
fi
chmod +x "$OPT/csf.pl" "$OPT/lfd.pl"
[ -f "$OPT/etc/csf.conf" ] || die "$OPT/etc/csf.conf yok"
# CSF ülke/ASN verisini düz HTTP adreslerden indirir (ConfigServer/Config.pm); vekil arkasındaki oturum yalnız HTTPS'e
# çıkabiliyor. Aynı dosyalar HTTPS'te de var: yalnız bu test kopyasında adresler HTTPS yapılır.
find "$OPT" -name Config.pm -path '*ConfigServer*' -exec sed -i 's#"http://\(download\.db-ip\.com\|iptoasn\.com\|download\.geonames\.org\)/#"https://\1/#' {} \;

echo "== yerleşim"
for d in /usr/local/csf /etc/csf; do   # gerçek dosya içeren gerçek dizin = bu makinede CSF kurulu (sunucu): dokunma
    if [ -d "$d" ] && [ ! -L "$d" ]; then
        [ -z "$(find "$d" -mindepth 1 ! -type l -print -quit 2>/dev/null)" ] || die "$d gerçek bir dizin: bu makinede CSF kurulu görünüyor, betik sunucu için değil"
        rm -rf "$d"
    fi
done
rm -f /usr/local/csf /etc/csf
mkdir -p /usr/local/cpanel/3rdparty/bin /var/lib/csf/backup /var/lib/csf/Geo /var/lib/csf/lock /var/lib/csf/stats /var/lib/csf/zone /etc/cron.d /usr/local/lib/site_perl
# cpanel-csf paketi perl'ün /usr/local/cpanel/3rdparty altından çalışmasını ister ($^X denetimi; bağlantı yetmez, /proc
# gerçek yolu verir): sistem perl'ünün kopyası
PERL=/usr/local/cpanel/3rdparty/bin/perl
rm -f "$PERL"; cp -f /usr/bin/perl "$PERL"
if [ -d "$OPT/csfdir" ]; then ln -sfn "$OPT/csfdir" /usr/local/csf                       # paket: ağacın tamamı
else mkdir -p /usr/local/csf; ln -sfn "$OPT/lib" /usr/local/csf/lib; ln -sfn "$OPT/bin" /usr/local/csf/bin; fi   # GitHub: lib ve bin
ln -sfn "$OPT/etc" /etc/csf
ln -sfn "$OPT/csf.pl" /usr/sbin/csf
ln -sfn "$OPT/lfd.pl" /usr/sbin/lfd
cp -a "$H/bulut/cPstrict.pm" "$H/bulut/Cpanel" /usr/local/lib/site_perl/     # cPanel'e özgü modüllerin taklitleri
if [ ! -x /usr/sbin/sendmail ]; then
    printf '%s\n' '#!/bin/bash' '# sendmail taklidi (kur-bulut.sh): gelen posta dosyaya yazılır' 'cat >> /var/log/sendmail-taklit.log' > /usr/sbin/sendmail
    chmod +x /usr/sbin/sendmail
fi
touch /var/log/secure /var/log/exim_mainlog /var/log/maillog /var/log/messages /var/log/lfd.log
$PERL -c /usr/sbin/csf >/dev/null 2>/tmp/kur-bulut-perl.log || { cat /tmp/kur-bulut-perl.log; die "csf derlenmiyor (eksik perl modülü?)"; }
$PERL -c /usr/sbin/lfd >/dev/null 2>/tmp/kur-bulut-perl.log || { cat /tmp/kur-bulut-perl.log; die "lfd derlenmiyor (eksik perl modülü?)"; }

echo "== csf.conf"
CF=/etc/csf/csf.conf
setc() { sed -i "s|^$1 = .*|$1 = \"$2\"|" "$CF"; }
setc TESTING 0; setc LF_IPSET 1
setc TCP_IN 1:65535; setc TCP_OUT 1:65535; setc UDP_IN 1:65535; setc UDP_OUT 1:65535   # oturumun kendi bağlantıları kesilmesin
setc IPV6 0
setc LF_DIRWATCH 0; setc LF_INTEGRITY 0                                                 # kapsayıcıda yavaş ve gereksiz
# Senaryo testi lfd'nin SSH banını geçici listede bekler. LF_SSHD_PERM=1 (paket varsayılanı) ile lfd kalıcı ban için
# "csf -d" çağırır; CSF izin listesindeki IP'yi reddeder ("deny failed: … is in the allow file", 16.33'te ölçüldü) ve
# "izinli saldırgan" senaryoları ban göremez. Geçici ban lfd'nin kendi kuralıyla konur.
setc LF_SSHD_PERM 0
# İnternete vekil üzerinden çıkan oturum: CSF'in indirmeleri (ülke/ASN verisi, sağlayıcı aralıkları) de vekilden geçsin
[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ] && setc URLPROXY "${HTTPS_PROXY:-${https_proxy:-}}"
for b in IPTABLES:iptables IP6TABLES:ip6tables IPSET:ipset IP:ip MODPROBE:modprobe SENDMAIL:sendmail HOST:host; do
    p=$(command -v "${b#*:}" 2>/dev/null) && setc "${b%%:*}" "$p"
done
rm -f /etc/cron.d/csf_testing

echo "== csf -r ve lfd"
csf -r >/tmp/kur-bulut-csf.log 2>&1 || { tail -5 /tmp/kur-bulut-csf.log; die "csf -r başarısız"; }
pkill -f 'lfd - ' 2>/dev/null; pkill -f '/usr/sbin/lfd' 2>/dev/null; sleep 1
/usr/sbin/lfd >/dev/null 2>&1
sleep 3
pgrep -f 'lfd - ' >/dev/null || die "lfd başlamadı (/var/log/lfd.log)"
iptables -L LOCALINPUT -n >/dev/null 2>&1 || die "CSF zincirleri yüklenmedi"

# Sağlayıcı / ülke banı senaryoları CSF'in bölge dosyalarını ister (/var/lib/csf/zone/as16276.zone, fr.zone). lfd bunları
# yalnız başlarken ve kendi aralığında, CC_DENY'de yazılı olanlar için çıkarır (iptoasn verisinden; ölçüldü 16.33): testin
# içindeki csf -r indirmez. Burada bir kez çıkartılır, dosyalar kalır. BOLGE="" ile atlanır.
BOLGE="${BOLGE-AS16276,FR}"
if [ -n "$BOLGE" ]; then
    echo "== bölge dosyaları ($BOLGE)"
    setc CC_DENY "$BOLGE"
    pkill -f 'lfd - ' 2>/dev/null; sleep 1; /usr/sbin/lfd >/dev/null 2>&1
    n=0; want=$(printf '%s\n' "${BOLGE//,/ }" | tr '[:upper:]' '[:lower:]')
    while [ "$n" -lt 90 ]; do
        ok=1; for z in $want; do [ -s "/var/lib/csf/zone/$z.zone" ] || ok=0; done
        [ "$ok" = 1 ] && break; n=$((n + 1)); sleep 2
    done
    [ "$ok" = 1 ] && echo "   indi: $(ls /var/lib/csf/zone | paste -sd' ' -)" || echo "   uyarı: bölge dosyaları 3 dakikada inmedi (/var/log/lfd.log); sağlayıcı/ülke senaryoları düşer"
    setc CC_DENY ""
    csf -r >/tmp/kur-bulut-csf.log 2>&1 || die "csf -r başarısız"
    pkill -f 'lfd - ' 2>/dev/null; sleep 1; /usr/sbin/lfd >/dev/null 2>&1; sleep 3
    pgrep -f 'lfd - ' >/dev/null || die "lfd başlamadı (/var/log/lfd.log)"
fi
echo "kuruldu: $(csf -v 2>/dev/null | head -1) · lfd çalışıyor · kurallar yüklü"
echo "şimdi: GERCEK=1 bash $(cd "$H/../.." && pwd)/tests/senaryo/calistir.sh"
