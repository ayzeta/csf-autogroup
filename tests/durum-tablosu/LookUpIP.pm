package ConfigServer::LookUpIP;
# Taklit (yalnız test): CSF'in iplookup($ip, 1) çağrısı — lfd'nin CC_IGNORE kararında kullandığı ülke / ASN. Gerçek modül CSF'in
# coğrafi verisini okur; taklit kökün $SIM_ROOT/var/lib/csf/Geo/ccmap dosyasını okur ("önek ÜLKE [ASN]", ilk eşleşen). Dosya yoksa
# test ağı 151.80.0.0/16 = FR AS16276 (taklit DNS ile aynı).
use strict; use warnings;
sub iplookup {
    my ($ip, $cconly) = @_;
    my $f = ($ENV{SIM_ROOT} // '') . '/var/lib/csf/Geo/ccmap';
    my @m = -r $f ? do { open(my $h, '<', $f) or die; map { chomp; [ split /\s+/ ] } grep { /\S/ } <$h> } : ([ '151.80.', 'FR', 'AS16276' ]);
    for my $r (@m) { return ($r->[1], $r->[2] // '') if index($ip, $r->[0]) == 0 }
    return ('-', '');
}
1;
