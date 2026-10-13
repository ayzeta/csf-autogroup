package Cpanel::Encoder::URI;
# cPanel'siz test kurulumu için taklit: URI kaçışı (ayrılmış olmayan karakterler dışında her bayt %XX).
use strict;
use warnings;

sub uri_encode_str {
    my $s = defined $_[0] ? $_[0] : '';
    $s =~ s/([^A-Za-z0-9\-._~])/sprintf('%%%02X', ord($1))/ge;
    return $s;
}

1;
