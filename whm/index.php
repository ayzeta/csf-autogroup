#!/usr/local/cpanel/3rdparty/bin/php
<?php
/**
 * CSF Auto-Group — WHM sayfası.
 * Shebang, kurulumda sunucudaki gerçek PHP yoluna göre yeniden yazılır.
 *
 * Sayfa cPanel'in kendi kabuğu (WHM::header / WHM::footer) içinde çizilir; sol
 * menü ve üst çubuk korunur. İçerik tamamen ag.js tarafından, api.php'nin
 * döndürdüğü veriden kurulur. WHM Bootstrap yüklediği için bütün sınıflar
 * "ag-" önekli (".row", ".card" gibi adlar çakışıyor).
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

ag_input_bootstrap();
ag_bootstrap();
ag_guard();
ag_headers('text/html; charset=utf-8');

$ver      = ag_version();
$assetVer = rawurlencode($ver['version'] . ($ver['commit'] !== '' ? '-' . $ver['commit'] : ''));
$boot     = [
    'csrf'    => ag_csrf_token(),
    'version' => $ver['version'],
    'commit'  => $ver['commit'],
    'user'    => ag_user(),
];

$whmShell = '/usr/local/cpanel/php/WHM.php';
$useWhm   = is_readable($whmShell);
if ($useWhm) {
    require_once $whmShell;
    // cpsrvd yeniden yüklenirken (ör. eklenti güncellemesi) WHM başlık önbelleği birkaç saniye eksik olabilir: WHM::header
    // "User does not exist in cache_keys" fırlatıyor, sayfa 500 veriyordu (cPanel error_log, 2026-10-23). Önce kısa bekleyip
    // bir kez daha denenir; yine olmazsa sayfa WHM çerçevesi olmadan açılır (sonraki yenilemede çerçeve döner).
    $useWhm = false;
    for ($try = 0; $try < 2 && !$useWhm; $try++) {
        if ($try) usleep(1500000);
        ob_start();
        try {
            WHM::header('CSF Auto-Group', 0, 0);
            $useWhm = true;
            ob_end_flush();
        } catch (Throwable $e) {
            ob_end_clean();
        }
    }
}
if (!$useWhm) {
    echo '<!doctype html><html><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1">'
       . '<title>CSF Auto-Group</title></head><body>';
}
?>
<link rel="stylesheet" href="assets/ag.css?v=<?= $assetVer ?>">
<div id="ag-app" class="ag-app" aria-busy="true">
  <div class="ag-boot"><span class="ag-spin" aria-hidden="true"></span></div>
</div>
<script>window.AG_BOOT = <?= json_encode($boot, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
<script src="assets/ag.js?v=<?= $assetVer ?>"></script>
<?php
if ($useWhm) {
    WHM::footer();
} else {
    echo '</body></html>';
}
