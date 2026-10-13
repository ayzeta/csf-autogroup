package cPstrict;
# cPanel'siz makinede cpanel-csf'in "use cPstrict" satırı için taklit: strict, warnings ve 5.30 özellikleri
# (imza desteği dahil) çağıranın ad alanına alınır. Yalnız test kurulumunda (tests/senaryo/kur-bulut.sh) kullanılır.
use strict;
use warnings;

sub import {
    strict->import();
    warnings->import();
    require feature;
    feature->import( ':5.30', 'signatures' );
    warnings->unimport('experimental::signatures');
    return;
}

1;
