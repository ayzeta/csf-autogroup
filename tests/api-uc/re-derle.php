<?php
// api.php ve lib.php'deki her preg_match ifadesi PHP'de derlenmeli (1.15.140: states ucunun ifadesi iç içe grubun 299 kez tekrarı
// yüzünden "Internal error" veriyordu, uç canlıda her isteği reddetti; motor testleri api.php'yi geçmediği için görünmedi).
// Çıktı: derlenmeyen her ifade bir satır; hepsi derleniyorsa boş. Kullanım: php re-derle.php api.php lib.php
$bad = 0;
foreach (array_slice($argv, 1) as $f) {
    $src = file_get_contents($f);
    preg_match_all("/preg_match\\(\\s*'((?:[^'\\\\]|\\\\.)*)'/", $src, $m);
    foreach ($m[1] as $re) {
        $re = str_replace("\\'", "'", $re);
        if (!preg_match('~^/.*[^\\\\]/[a-zA-Z]*$~s', $re)) continue;   // kapanış ayracı kaçışsız "/" (sondaki "\/" ayraç değil)   // birleştirilerek kurulan ifadenin parçası ('…\/' . $bits . '$/'): tam değil
        if (@preg_match($re, '') === false) { $bad++; echo basename($f) . ': ' . substr($re, 0, 90) . ' → ' . preg_last_error_msg() . "\n"; }
    }
}
exit($bad ? 1 : 0);
