#!/bin/bash
# tools/allow-list.sh: CSF'in izin dosyalarındaki her satır biçimi doğru sınıflanıyor mu (F = bütün portlar, P = tek port).
# Kiralık liste ve ban koruması bu listeye göre muaf tutar; yanlış sınıf ya delik (tek portluk izin tam muaf) ya da müşteri
# kesintisi (tam izin muaf değil) demektir. Biçimler CSF 16.33 kaynağından (csf.pl: tempallow, replay_entries, linefilter).
#
#   bash tests/izin-listesi/calistir.sh
H="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$H/../.." && pwd)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
CSF_DIR="$W/etc"; CSF_VAR="$W/var"; mkdir -p "$CSF_DIR" "$CSF_VAR"
NOW=$(date +%s)
printf '%s\n' \
    '# yorum' \
    '1.1.1.1 # düz IP' \
    '2.2.2.0/24 # düz aralık' \
    'tcp|in|d=22|s=3.3.3.3 # müşteri yalnız SSH' \
    'udp|in|d=53|s=3.3.3.4' \
    'tcp|in|d=2000_2010|s=3.3.3.5 # port aralığı' \
    'tcp|in|d=80,443|s=4.4.4.0/24 # csf_autogroup: exception for 4.4.4.0/24 [svc=web]' \
    'tcp|in|s=5.5.5.5 # portsuz gelişmiş satır' \
    'tcp|out|d=25|d=6.6.6.6 # dışarı' \
    'tcp|in|d=80|s=0.0.0.0/0 # herkese açan port kuralı' \
    'tcp|out|d=25|u=0 # kullanıcıya bağlı' \
    "Include $CSF_DIR/ek.allow" > "$CSF_DIR/csf.allow"
printf '%s\n' '7.7.7.7 # Include edilen dosya' "Include $CSF_DIR/ek2.allow" > "$CSF_DIR/ek.allow"
printf '%s\n' '7.7.7.8 # ikinci düzey Include' > "$CSF_DIR/ek2.allow"
printf '%s\n' '8.8.8.0/24 # csf_autogroup: service google' > "$CSF_DIR/csf_autogroup.services.allow"
printf '%s\n' '9.9.9.9' 'tcp|in|d=22|s=9.9.9.10' > "$CSF_VAR/csf.gallow"
printf '%s\n' '10.0.0.1' > "$CSF_VAR/csf.tempdyn"
printf '%s\n' '10.0.0.2' > "$CSF_VAR/csf.tempgdyn"
printf '%s\n' "$NOW|11.0.0.1||in|3600|portsuz geçici izin" "$NOW|11.0.0.2|22,53;udp|in|3600|portlu" \
    "$(( NOW - 7200 ))|11.0.0.3||in|3600|süresi dolmuş" "$NOW|11.0.0.4||out|3600|yalnız dışarı" > "$CSF_VAR/csf.tempallow"
. "$REPO/tools/allow-list.sh"
GOT=$(ag_allow_entries)
N=0; F=0; OUT=""
want() {   # SATIR VAR(1)/YOK(0) AÇIKLAMA
    N=$((N + 1)); local has=0; grep -qxF -- "$1" <<< "$GOT" && has=1
    if [ "$has" = "$2" ]; then OUT+="  ✓ $3"$'\n'; else F=$((F + 1)); OUT+="  ✗ $3 («$1» $([ "$2" = 1 ] && echo yok || echo var))"$'\n'; fi
}
want 'F 1.1.1.1' 1 'düz IP bütün portlara izin'
want 'F 2.2.2.0/24' 1 'düz aralık bütün portlara izin'
want 'P tcp 3.3.3.3 22' 1 'tek portluk gelişmiş satır yalnız o port'
want 'F 3.3.3.3' 0 'tek portluk satır tam izin sayılmaz'
want 'P udp 3.3.3.4 53' 1 'UDP gelişmiş satır'
want 'P tcp 3.3.3.5 2000:2010' 1 'port aralığı a_b → a:b'
want 'P tcp 4.4.4.0/24 80' 1 'eklentinin istisna satırı: port 80'
want 'P tcp 4.4.4.0/24 443' 1 'eklentinin istisna satırı: port 443'
want 'F 4.4.4.0/24' 0 'eklentinin istisna satırı tam izin değil'
want 'P tcp 5.5.5.5 all' 1 'portsuz gelişmiş satır: protokolün bütün portları'
want 'F 6.6.6.6' 0 'dışarı giden satır alınmaz'
grep -q '0.0.0.0' <<< "$GOT" && { F=$((F + 1)); OUT+="  ✗ /0 port kuralı izin sayıldı"$'\n'; } || OUT+="  ✓ /8'den geniş kaynak alınmaz"$'\n'; N=$((N + 1))
want 'F 7.7.7.7' 1 'Include edilen dosya'
want 'F 7.7.7.8' 1 'iç içe Include'
want 'F 8.8.8.0/24' 1 'izinli servisler'
want 'F 9.9.9.9' 1 'GLOBAL_ALLOW (csf.gallow)'
want 'P tcp 9.9.9.10 22' 1 'GLOBAL_ALLOW gelişmiş satır'
want 'F 10.0.0.1' 1 'DYNDNS (csf.tempdyn)'
want 'F 10.0.0.2' 1 'GLOBAL_DYNDNS (csf.tempgdyn)'
want 'F 11.0.0.1' 1 'portsuz geçici izin'
want 'P tcp 11.0.0.2 22' 1 'portlu geçici izin TCP'
want 'P udp 11.0.0.2 53' 1 'portlu geçici izin "53;udp"'
want 'F 11.0.0.3' 0 'süresi dolmuş geçici izin alınmaz'
want 'F 11.0.0.4' 0 'yalnız dışarı geçici izin alınmaz'
# port kesişimi (kiralık liste yalnız kapattığı portlarla kesişen tek portluk izni ekler)
pk() { N=$((N + 1)); if ag_port_hit "$1" "$2"; then r=1; else r=0; fi
       if [ "$r" = "$3" ]; then OUT+="  ✓ port $1 ∩ $2 = $3"$'\n'; else F=$((F + 1)); OUT+="  ✗ port $1 ∩ $2 (beklenen $3)"$'\n'; fi; }
pk 443 80,443 1; pk 22 80,443 0; pk 8080 8000:8100 1; pk 2000:2010 2005 1; pk 2000:2010 80,443 0
printf '%s' "$OUT"
[ "$F" = 0 ] && echo "izin listesi: $N/$N geçti" || { echo "izin listesi: $F/$N kural ihlali"; exit 1; }
