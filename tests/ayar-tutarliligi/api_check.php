<?php
// whm/api.php'deki config_set anahtar listesi ve desenleriyle örnek değerleri dener (api.php çalıştırılmaz, okunur).
// kullanım: php api_check.php API.PHP DEĞERLER.TSV → reddedilenler "PANEL-KEY|PANEL-RE <tab> anahtar <tab> değer"
$src = file_get_contents($argv[1]);
if ($src === false || !preg_match("/case 'config_set':(.*?)case '/s", $src, $m)) { fwrite(STDERR, "config_set bulunamadı\n"); exit(2); }
$blk = $m[1];
preg_match('/\$keys\s*=\s*\[(.*?)\];/s', $blk, $k);
preg_match_all("/'([A-Z0-9_]+)'/", $k[1], $kk);
$keys = $kk[1];
$re = [];
if (preg_match('/\$re\s*=\s*\[(.*?)\];/s', $blk, $r)) {
    preg_match_all("/'([A-Z0-9_]+)'\s*=>\s*'((?:[^'\\\\]|\\\\.)*)'/", $r[1], $rr, PREG_SET_ORDER);
    foreach ($rr as $x) { $re[$x[1]] = str_replace(["\\\\", "\\'"], ["\\", "'"], $x[2]); }
}
preg_match("/preg_match\(\\\$re\[\\\$k\] \?\? '((?:[^'\\\\]|\\\\.)*)'/", $blk, $d);
$def = isset($d[1]) ? str_replace(["\\\\", "\\'"], ["\\", "'"], $d[1]) : '/^$/';
foreach (file($argv[2], FILE_IGNORE_NEW_LINES) as $l) {
    if ($l === '') { continue; }
    $p = explode("\t", $l, 2);
    $key = $p[0]; $val = $p[1] ?? '';
    if (!in_array($key, $keys, true)) { echo "PANEL-KEY\t$key\t(api.php anahtar listesinde yok)\n"; continue; }
    $pat = $re[$key] ?? $def;
    if (!preg_match($pat, trim($val))) { echo "PANEL-RE\t$key\t$val\t$pat\n"; }
}
