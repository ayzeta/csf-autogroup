#!/usr/bin/perl
# denemeler-ornek.txt satırlarını lfd'nin kendi ayrıştırıcısına (CSF ConfigServer::RegexMain::processline) verir; lfd'nin döndürdüğü
# "IP|hesap" (ModSecurity: "IP||site") ikinci sütundakiyle aynı mı. "-" = lfd bu satırı saymaz. Tarih yer tutucuları ({DTI} {DTS}
# {DTA}) ortamdan. Eklentinin günlük taraması (acct_all) aynı satırları sayar; böylece biçimler tahmin değil, lfd'nin kendisi.
use strict;
use warnings;
use lib '/usr/local/csf/lib';
use ConfigServer::RegexMain ();

# lfd'nin ayarları: ilgili kurallar açık (csf.conf okunmaz; _config dolu %config'i yeniden yüklemez)
%ConfigServer::RegexMain::config = ( LF_SSHD => 1, LF_FTPD => 1, LF_CPANEL => 1, LF_MODSEC => 1, LF_HTACCESS => 1,
    LF_SMTPAUTH => 1, LF_POP3D => 1, LF_IMAPD => 1, LF_APACHE_ERRPORT => 2 );
my %path = ( SSHD => '/t/secure', FTPD => '/t/messages', CPANEL => '/t/login_log', MODSEC => '/t/error_log', HTACCESS => '/t/error_log' );
my %gl;
for my $k ( keys %path ) { $gl{"${k}_LOG"}{ $path{$k} } = 1 }

my ( $ok, $bad ) = ( 0, 0 );
open( my $fh, '<', $ARGV[0] ) or die "okunamadı: $ARGV[0]\n";
while ( my $l = <$fh> ) {
    chomp $l;
    next unless length $l;
    my ( $k, $exp, $line ) = split( /\t/, $l, 3 );
    for my $v (qw(DTI DTS DTA)) { my $x = $ENV{$v} // ''; $line =~ s/\{$v\}/$x/g }
    my @r   = ConfigServer::RegexMain::processline( $line, $path{$k}, \%gl );
    my $got = ( @r && defined $r[1] && length $r[1] ) ? $r[1] : '-';    # saymadığı satırda boş değer döner
    if   ( $got eq $exp ) { $ok++ }
    else                  { $bad++; print "  lfd farklı: $k beklenen [$exp] gelen [$got]: $line\n" }
}
print "$ok satır lfd ile aynı, " . ( $bad ? "$bad farklı" : "farklı yok" ) . "\n";
exit( $bad ? 1 : 0 );
