package Cpanel::Sys::Hostname;
# cPanel'siz test kurulumu için taklit: makine adı.
use strict;
use warnings;
use Sys::Hostname ();

sub gethostname { return Sys::Hostname::hostname(); }

1;
