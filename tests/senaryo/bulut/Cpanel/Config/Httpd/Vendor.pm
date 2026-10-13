package Cpanel::Config::Httpd::Vendor;
# cPanel'siz test kurulumu için taklit: web sunucusu sağlayıcısı (testte web sunucusu yok; "apache" sayılır).
use strict;
use warnings;

sub httpd_vendor_info { return ( 'apache', '' ); }

1;
