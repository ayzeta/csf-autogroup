#!/usr/local/cpanel/3rdparty/bin/php
<?php
/**
 * CSF Auto-Group — WHM eklentisi JSON uçları.
 * Shebang, kurulumda sunucudaki gerçek PHP yoluna göre yeniden yazılır.
 *
 * Her uç: WHM + root + "all" yetkisi (ag_guard) ve POST + CSRF (ag_csrf_check).
 * Girdiler burada katı desenlerden geçer; script aynı kontrolü ikinci kez yapar.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

ag_input_bootstrap();
ag_bootstrap();
ag_guard();
ag_csrf_check();

$a = (string) ($_POST['a'] ?? '');

const AG_RE_16   = '/^([0-9]{1,3})\.([0-9]{1,3})$/';
const AG_RE_24   = '/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/';
const AG_RE_IP   = '/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/';
const AG_RE_CIDR = '/^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})(\/([0-9]{1,2}))?$/';

/** Desene uyan ve her okteti 0–255 olan girdi mi? */
function ag_valid(string $re, string $v): bool
{
    if (!preg_match($re, $v, $m)) {
        return false;
    }
    for ($i = 1; $i <= 4; $i++) {
        if (isset($m[$i]) && $m[$i] !== '' && (int) $m[$i] > 255) {
            return false;
        }
    }
    return !isset($m[6]) || ((int) $m[6] >= 1 && (int) $m[6] <= 32);
}

switch ($a) {

    case 'status':
        $d = ag_run_json(['--status', '--json'], 60);
        $d['plugin'] = ag_version();
        $d['user'] = ag_user();
        // "Son ziyaretinden beri yeni": kullanıcı başına son görülme zamanı (seen ucu günceller)
        $seen = AG_STATE . '/seen.' . ag_user();
        $d['last_seen'] = is_file($seen) ? (int) @file_get_contents($seen) : 0;
        ag_json($d);

    case 'seen':
        @file_put_contents(AG_STATE . '/seen.' . ag_user(), (string) time(), LOCK_EX);
        @chmod(AG_STATE . '/seen.' . ag_user(), 0600);
        ag_json(['ok' => true]);

    case 'digest_preview':
        $r = ag_run(['--digest'], 60);
        ag_json(['ok' => $r['rc'] === 0, 'output' => trim($r['out'] . "\n" . $r['err'])]);

    case 'lookup':
        $ip = trim((string) ($_POST['ip'] ?? ''));
        if (!ag_valid(AG_RE_IP, $ip)) {
            ag_json(['ok' => false, 'error' => 'bad_ip']);
        }
        ag_json(ag_run_json(['--lookup', $ip, '--json'], 45));

    case 'history':
        $cidr = trim((string) ($_POST['cidr'] ?? ''));
        $day  = trim((string) ($_POST['day'] ?? ''));
        if (!ag_valid(AG_RE_CIDR, $cidr) || !preg_match('#/(16|24)$#', $cidr) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $day)) {
            ag_json(['ok' => false, 'error' => 'bad_input']);
        }
        ag_json(ag_run_json(['--history', $cidr, $day], 90));

    case 'action':
        $name   = (string) ($_POST['name'] ?? '');
        $target = trim((string) ($_POST['target'] ?? ''));
        $re = [
            'ban16' => AG_RE_16, 'ban24' => AG_RE_24, 'forget' => AG_RE_24,
            'unban' => AG_RE_CIDR, 'ignore' => AG_RE_CIDR, 'unignore' => AG_RE_CIDR,
        ];
        if (!isset($re[$name]) || !ag_valid($re[$name], $target)) {
            ag_json(['ok' => false, 'code' => 2, 'message' => 'bad_target']);
        }
        // İkinci güvence: arayüz, kullanıcının onayladığı hedefi ayrıca gönderir.
        if ((string) ($_POST['confirm'] ?? '') !== $target) {
            ag_json(['ok' => false, 'code' => 2, 'message' => 'confirm_mismatch']);
        }
        $args = ['--action', $name, $target];
        if ($name === 'ignore') {
            $days = (int) ($_POST['days'] ?? 30);
            $args[] = (string) max(1, min(365, $days));
        }
        if (($_POST['force'] ?? '') === '1') {
            $args[] = '--force';
        }
        $args[] = '--json';
        ag_json(ag_run_json($args, 90));

    case 'dry_run':
        // Hiçbir şeyi değiştirmez; çıktı olduğu gibi gösterilir. "Kaydetmeden önce dene" için
        // kaydedilmemiş eşikler --set ile geçer (script yalnız bu anahtarları kabul eder).
        $args = ['--dry-run'];
        $try = ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24', 'THRESHOLD_TEMP_16',
                'LOOKUP', 'LOOKUP_TIMEOUT', 'SAYAC_RETENTION_DAYS', 'REVIEW_DAYS'];
        foreach ((array) ($_POST['set'] ?? []) as $k => $v) {
            if (in_array($k, $try, true) && preg_match('/^[0-9]{1,6}$/', (string) $v)) {
                $args[] = '--set';
                $args[] = $k . '=' . $v;
            }
        }
        $r = ag_run($args, 240);
        ag_json(['ok' => $r['rc'] === 0, 'rc' => $r['rc'], 'output' => trim($r['out'] . "\n" . $r['err'])]);

    case 'config_get':
        ag_json(ag_run_json(['--config', 'get', '--json'], 30));

    case 'config_set':
        // Anahtar listesi ve kaba karakter süzgeci burada; asıl doğrulama script'te (cfg_check).
        $keys = ['MSG_LANG', 'ALERT_MAIL', 'DIGEST', 'DIGEST_DAY', 'THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24',
                 'THRESHOLD_TEMP_16', 'LOOKUP', 'LOOKUP_TIMEOUT', 'SAYAC_RETENTION_DAYS', 'REVIEW_DAYS', 'LOG_MAX_LINES', 'LOG_ROTATE_MB', 'LOG_ROTATE_KEEP', 'CRON_MIN'];
        $args = ['--config', 'set'];
        foreach ((array) ($_POST['v'] ?? []) as $k => $v) {
            $v = trim((string) $v);
            if (!in_array($k, $keys, true) || !preg_match('/^[A-Za-z0-9@._%+*\/:-]{0,254}$/', $v)) {
                ag_json(['ok' => false, 'code' => 2, 'message' => 'bad_value: ' . $k]);
            }
            $args[] = $k . '=' . $v;
        }
        if (count($args) === 2) {
            ag_json(['ok' => false, 'code' => 2, 'message' => 'nothing']);
        }
        $args[] = '--json';
        ag_json(ag_run_json($args, 30));

    case 'config_test_mail':
        ag_json(ag_run_json(['--config', 'test-mail', '--json'], 30));

    case 'run_now':
        $script = ag_script();
        if ($script === null) {
            ag_json(['ok' => false, 'error' => 'no_script']);
        }
        // Bir tur (çoğunlukla cron) zaten çalışıyorsa başlatma: ikinci kopya kilide takılıp yalnız
        // "atlandı" yazardı, kullanıcıya da tur çalışmamış gibi görünürdü.
        if (trim(ag_run(['--busy'], 10)['out']) === 'busy') {
            ag_json(['ok' => false, 'error' => 'busy']);
        }
        @file_put_contents(AG_RUN_LOG, sprintf("[%s] %s: run now\n", date('Y-m-d H:i:s'), ag_user()));
        @chmod(AG_RUN_LOG, 0600);
        ag_spawn('/bin/bash ' . escapeshellarg($script), AG_RUN_LOG);
        ag_json(['ok' => true]);

    case 'run_log':
        ag_json(['ok' => true, 'log' => is_file(AG_RUN_LOG) ? (string) @file_get_contents(AG_RUN_LOG) : '']);

    case 'update_check':
        ag_json(ag_update_check());

    case 'update_apply':
        $chk = ag_update_check(true);
        if (empty($chk['ok'])) {
            ag_json($chk);
        }
        if (!empty($chk['uptodate'])) {
            ag_json(['ok' => false, 'error' => 'uptodate']);
        }
        if (!empty($chk['dirty']) || !empty($chk['diverged'])) {
            ag_json(['ok' => false, 'error' => !empty($chk['dirty']) ? 'dirty' : 'diverged']);
        }
        if ((string) ($_POST['confirm'] ?? '') !== (string) $chk['latest_commit']) {
            ag_json(['ok' => false, 'error' => 'confirm_mismatch']);
        }
        $repo = ag_version()['repo'];
        // update.sh root olarak çalışır: depo ve çalıştırılan dosyalar root'a ait, başkası yazamaz olmalı.
        foreach (['', '/.git', '/update.sh', '/install.sh', '/csf_autogroup.sh'] as $f) {
            if (!ag_root_safe($repo . $f)) {
                ag_json(['ok' => false, 'error' => 'unsafe_repo', 'message' => 'not root-owned or group/world-writable: ' . $repo . $f]);
            }
        }
        // Aynı anda tek güncelleme: update.sh bu kilidi tutar (çift tıklama, iki yönetici).
        $lk = @fopen($repo . '/.git/csf_autogroup_update.lock', 'c');
        if ($lk !== false) {
            if (!flock($lk, LOCK_EX | LOCK_NB)) {
                ag_json(['ok' => false, 'error' => 'busy']);
            }
            flock($lk, LOCK_UN);
            fclose($lk);
        }
        @file_put_contents(AG_UPDATE_LOG, sprintf("[%s] %s: %s (%s) -> %s (%s)\n", date('Y-m-d H:i:s'),
            ag_user(), $chk['current'], $chk['current_commit'], $chk['latest'], $chk['latest_commit']));
        @chmod(AG_UPDATE_LOG, 0600);
        // update.sh arka planda: kendi dosyalarını değiştiren bir istek yanıt veremeden kesilebilir.
        // Bitişi çıkış koduna bağlı bir işaretle bildirilir, kelime aramaya değil.
        ag_spawn('/bin/bash -c ' . escapeshellarg('bash ' . escapeshellarg($repo . '/update.sh')
            . '; echo "AG-UPDATE-RESULT: $?"'), AG_UPDATE_LOG);
        ag_json(['ok' => true, 'from' => $chk['current'], 'to' => $chk['latest']]);

    case 'update_log':
        ag_json(['ok' => true, 'log' => is_file(AG_UPDATE_LOG) ? (string) @file_get_contents(AG_UPDATE_LOG) : '',
                 'plugin' => ag_version()]);

    default:
        ag_json(['ok' => false, 'error' => 'unknown'], 400);
}
