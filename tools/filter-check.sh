#!/bin/bash
# CSF Auto-Group — kaynak süzgecinin canlı denetimi (yalnız okur: CSF'e, iptables'a ve eklentinin listelerine yazmaz).
#
#   bash tools/filter-check.sh
#
# cloud-ban.sh'ı yalnız indirme kipinde (NOAPPLY=1) geçici bir dizinle çalıştırır ve şunları karşılaştırır:
#   A) hazır AWS / Azure kutusu ↔ aynı adres, süzgeç ve desenle elle kurulan kopyası (bayt bayt aynı olmalı)
#   B) yeni süzgecin hazır kutu sonucu ↔ eklentinin şu anki listesi (aynı günse aynı olmalı; sağlayıcı dosyayı güncellediyse fark yazılır)
#   C) aynı yöntemle yayımlayan başka sağlayıcılar: Google Cloud bölgesi, Oracle (bölge + etiket), DigitalOcean CSV satırı,
#      Cloudflare sayfasındaki (göreli) bağlantı — sağlayıcının dosyasındaki aynı dilimin bağımsız sayımıyla
set -u
D="$(cd "$(dirname "$0")" && pwd)"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
CUR="${CUR:-/var/lib/csf_autogroup/cloud}"
AZ='https://www.microsoft.com/en-us/download/details.aspx?id=56519'; AZL='download.microsoft.com/*ServiceTags_Public_*.json'
AWS='https://ip-ranges.amazonaws.com/ip-ranges.json'; OCI='https://docs.oracle.com/en-us/iaas/tools/public_ip_ranges.json'
SRC="aws|$AWS|j:service=EC2
azure|$AZ|j:name=AzureCloud|$AZL
x-aws-kopya|$AWS|j:service=EC2
x-az-kopya|$AZ|j:name=AzureCloud|$AZL
x-aws-eu|$AWS|j:service=EC2&region=eu-north-1
x-gcp-ew1|https://www.gstatic.com/ipranges/cloud.json|j:scope=europe-west1
x-oci-fra|$OCI|j:region=eu-frankfurt-1&tags=OCI
x-do-de|https://digitalocean.com/geo/google.csv|t:%2CDE%2C
x-cf|https://www.cloudflare.com/ips/|-|www.cloudflare.com/ips-v4"
SRC="$SRC" NOAPPLY=1 CACHE="$T" LOG_FILE="$T/log" bash "$D/cloud-ban.sh" >/dev/null 2>&1
n() { [ -s "$T/$1.txt" ] && grep -c . "$T/$1.txt" || echo 0; }
echo "perl: $(perl -MJSON::PP -e 'print "JSON::PP $JSON::PP::VERSION"' 2>&1)"
echo "== A) hazır kutu ↔ elle kurulan kopyası"
for p in "aws x-aws-kopya" "azure x-az-kopya"; do set -- $p
    if [ "$(n "$1")" -gt 0 ] && cmp -s "$T/$1.txt" "$T/$2.txt"; then echo "  ✓ $1 = $2 ($(n "$1") aralık, bayt bayt)"; else echo "  ✗ $1 ($(n "$1")) ≠ $2 ($(n "$2"))"; fi
done
echo "== B) yeni süzgeç ↔ eklentinin şu anki listesi ($CUR)"
for l in aws azure; do
    if [ -s "$CUR/$l.txt" ]; then
        f=$(comm -3 <(sort -u "$CUR/$l.txt") <(sort -u "$T/$l.txt") | grep -c .)
        echo "  $l: şu anki $(grep -c . "$CUR/$l.txt") (son indirme $(date -d "@$(stat -c %Y "$CUR/$l.txt")" '+%d.%m %H:%M')) · yeni $(n "$l") · fark $f"
    else echo "  $l: eklentide şu an liste yok (kutu seçili değil), karşılaştırılmadı"; fi
done
echo "== C) başka sağlayıcılar (bağımsız sayım: sağlayıcının dosyasında aynı dilim)"
pc() { perl -MJSON::PP -e "local \$/; my \$d = JSON::PP->new->decode(<STDIN>); $1" ; }
c=$(curl -fsSL https://www.gstatic.com/ipranges/cloud.json | pc 'my %h; $h{$_->{ipv4Prefix}} = 1 for grep { ($_->{scope} // "") eq "europe-west1" && $_->{ipv4Prefix} } @{$d->{prefixes}}; print scalar keys %h')
echo "  Google Cloud europe-west1: süzgeç $(n x-gcp-ew1) · bağımsız $c"
c=$(curl -fsSL "$OCI" | pc 'my %h; for my $r (@{$d->{regions}}) { next unless $r->{region} eq "eu-frankfurt-1"; $h{$_->{cidr}} = 1 for grep { grep { $_ eq "OCI" } @{$_->{tags} || []} } @{$r->{cidrs}} } print scalar keys %h')
echo "  Oracle eu-frankfurt-1 + OCI: süzgeç $(n x-oci-fra) · bağımsız $c"
c=$(curl -fsSL https://digitalocean.com/geo/google.csv | grep ',DE,' | cut -d, -f1 | grep -E '^[0-9]+\.' | sort -u | grep -c .)
echo "  DigitalOcean ,DE,: süzgeç $(n x-do-de) · bağımsız $c"
c=$(curl -fsSL https://www.cloudflare.com/ips-v4 | grep -E '^[0-9]+\.' | sort -u | grep -c .)
echo "  Cloudflare (sayfadaki bağlantı): süzgeç $(n x-cf) · ips-v4 dosyası doğrudan $c"
echo "  AWS eu-north-1 EC2 (bilgi): $(n x-aws-eu) aralık"
grep -i 'alınamadı' "$T/log" 2>/dev/null | sed 's/^/  günlük: /'
exit 0
