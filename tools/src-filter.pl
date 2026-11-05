#!/usr/bin/perl
# CSF Auto-Group — kaynak süzgeci (kiralık sunucu listeleri ve izinli servisler ortak kullanır).
#
#   perl src-filter.pl SÜZGEÇ < indirilen-dosya > süzülmüş-metin
#
# SÜZGEÇ ayardaki biçimde (değerler % ile kodlu):
#   j:ALAN=DEĞER[&ALAN=DEĞER…]  JSON: koşulların hepsini taşıyan nesnelerin altındaki bütün IPv4 aralıkları. Alan bir diziyse
#                               içinde DEĞER geçmesi yeter (ör. Oracle "tags": ["OCI"]). Örnekler: AWS ip-ranges.json
#                               "j:service=EC2" (yalnız kiralık sunucular), Azure Service Tags "j:name=AzureCloud".
#   t:METİN                     düz metin / CSV: yalnız içinde METİN geçen satırlar.
# Çıktı ham metindir; araç adresleri kendi ipv4_list süzgecinden geçirir (geçersiz sekizli, çok geniş aralık elenir).
# Dosya JSON olarak çözülemezse çıkış 2 ve boş çıktı: araç listeyi indirilemedi sayar, önceki listeyi korur.
use strict; use warnings;
my $spec = $ARGV[0] // '';
sub dec { my $s = shift; $s =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge; return $s }
if ($spec =~ /^t:(.*)$/s) {
    my $t = dec($1); exit 2 unless length $t;
    while (my $l = <STDIN>) { print $l if index($l, $t) >= 0 }
    exit 0;
}
$spec =~ /^j:(.+)$/s or exit 2;
my @c = map { my ($k, $v) = split /=/, $_, 2; [dec($k), dec($v // '')] } grep { length } split /&/, $1;
exit 2 unless @c;
require JSON::PP;
my $d = do { local $/; my $raw = <STDIN>; eval { JSON::PP->new->decode($raw) } };
exit 2 unless ref $d;
my %out;
sub ips { my $x = shift;
    if (ref $x eq 'HASH') { ips($_) for values %$x } elsif (ref $x eq 'ARRAY') { ips($_) for @$x }
    elsif (defined $x && !ref $x) { $out{$1} = 1 while $x =~ m{(?<![\d.])((?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?)(?![\d.])}g } }
# bir koşul nesnenin kendisinde ya da onu içeren bir üst nesnede sağlanırsa sayılır: Oracle'da "region" bölge nesnesinde, "tags"
# her aralığın kendi nesnesinde ("region=eu-frankfurt-1&tags=OCI" ikisi birden; önce aynı nesnede aranıyor, 0 veriyordu)
sub hit { my ($h, $k) = @_; my $v = $h->{$k->[0]}; return 0 unless defined $v;
    return (grep { defined $_ && !ref $_ && $_ eq $k->[1] } @$v) ? 1 : 0 if ref $v eq 'ARRAY';
    return !ref $v && $v eq $k->[1] ? 1 : 0 }
sub walk { my ($x, $got) = @_;          # $got: üst nesnelerde sağlanmış koşullar
    if (ref $x eq 'HASH') {
        my @g = @$got; for my $i (0 .. $#c) { $g[$i] ||= hit($x, $c[$i]) }
        if (!grep { !$_ } @g) { ips($x); return }
        walk($_, \@g) for values %$x }
    elsif (ref $x eq 'ARRAY') { walk($_, $got) for @$x } }
walk($d, [ (0) x @c ]);
print "$_\n" for sort keys %out;
exit 0;
