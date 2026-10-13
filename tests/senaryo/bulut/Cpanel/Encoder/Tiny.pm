package Cpanel::Encoder::Tiny;
# cPanel'siz test kurulumu için taklit: HTML kaçışı (csf'in arayüz çıktısı testte kullanılmaz, derlenmesi yeter).
use strict;
use warnings;

my %MAP = ( '&' => '&amp;', '<' => '&lt;', '>' => '&gt;', '"' => '&quot;', "'" => '&#39;' );

sub safe_html_encode_str {
    my $s = join( '', grep { defined } @_ );
    $s =~ s/([&<>"'])/$MAP{$1}/g;
    return $s;
}

1;
