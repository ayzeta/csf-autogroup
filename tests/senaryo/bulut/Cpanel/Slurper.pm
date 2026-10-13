package Cpanel::Slurper;
# cPanel'siz test kurulumu için taklit: dosya okuma/yazma File::Slurper ile.
use strict;
use warnings;
use File::Slurper ();

sub read       { return File::Slurper::read_binary( $_[0] ); }
sub read_lines { return File::Slurper::read_lines( $_[0] ); }
sub write      { return File::Slurper::write_binary( $_[0], $_[1] ); }

sub read_dir {
    my ($path) = @_;
    opendir( my $dh, $path ) or die "Can't open '$path': $!";
    my @e = grep { defined $_ && $_ ne '.' && $_ ne '..' } readdir($dh);
    closedir($dh);
    return @e;
}

1;
