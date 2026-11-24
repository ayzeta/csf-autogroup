#!/usr/local/cpanel/3rdparty/bin/php
<?php
/**
 * CSF Auto-Group — WHM eklentisi JSON uçları.
 * Shebang, kurulumda sunucudaki gerçek PHP yoluna göre yeniden yazılır.
 *
 * Her uç: WHM + root + "all" yetkisi (ag_guard) ve POST + CSRF (ag_csrf_check). Tek istisna tempban_check: yalnız okur,
 * GET ve CSRF anahtarsız (gerekçe işlevin başında).
 * Girdiler burada katı desenlerden geçer; script aynı kontrolü ikinci kez yapar.
 */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

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

/**
 * tempban_check — "bu IP şu an geçici banlı mı" (dışarıdan çağıran: WHMCS CSF Self-Service Unblock eklentisi, sunucu tarafından
 * create_user_session ile açılan root oturumuyla). TEK İSTİSNA: GET ve CSRF anahtarsız. CSRF denetimi durum değiştiren istekler
 * içindir; bu uç yalnız okur (dosyaya yazmaz, kilit almaz, motoru çağırmaz, ag_bootstrap'ı da çağırmaz). Koruma yerinde: WHM'in
 * adresteki cpsess belirteci ve ag_guard (WHM kullanıcısı, root süreç, "all" yetkisi); başka bir site cevabı okuyamaz (CORS yok).
 * Anahtar için index.php'yi açmak (WHM başlığını çizer) her kontrole bir ağır istek eklerdi.
 * Okuma motorun tek okuyucusuyla aynı (csf_autogroup.sh tb_load / tb_cover): satır "zaman|adres|portlar|yön|süre|yorum"; satır
 * dosyada duruyorsa ban da duruyor (lfd satırı kuralıyla birlikte siler; ölçüldü) — süresi geçmiş görünen satır da banlı sayılır.
 * Adres tek IP ya da aralık; IP'yi kapsayan her satır sayılır, port sınırlı satır da. until = en geç biten satırın bitişi.
 * Dosya yoksa ban yok; dosya var ama okunamıyorsa ok:false (çağıran "ban yok" saymasın, kendi yoluna düşsün).
 */
function ag_tempban_check(string $ip): void
{
    if (!ag_valid(AG_RE_IP, $ip)) {
        ag_json(['ok' => false, 'error' => 'bad_ip'], 400);
    }
    $f = (ag_env('AG_CSF_VAR') ?: '/var/lib/csf') . '/csf.tempban';    // AG_CSF_VAR: yalnız test (HTTP isteği ortam değişkeni kuramaz)
    if (!file_exists($f)) {
        ag_json(['ok' => true, 'blocked' => false, 'until' => null, 'ports' => '', 'rows' => []]);
    }
    $txt = is_file($f) && is_readable($f) ? @file_get_contents($f) : false;   // dizin de "okunamıyor" (PHP onu boş okur)
    if ($txt === false) {
        ag_json(['ok' => false, 'error' => 'unreadable'], 500);
    }
    $n = ip2long($ip);
    $rows = [];
    $until = null;
    $ports = [];
    foreach (preg_split('/\R/', $txt) as $line) {
        $p = explode('|', $line, 6);
        if (count($p) < 5 || $p[1] === '') {
            continue;
        }
        $addr = $p[1];
        if (strpos($addr, '/') !== false) {
            [$net, $bits] = explode('/', $addr, 2);
            $nl = ip2long($net);
            if ($nl === false || !ctype_digit($bits) || (int) $bits < 0 || (int) $bits > 32) {
                continue;
            }
            $mask = (int) $bits === 0 ? 0 : (~0 << (32 - (int) $bits)) & 0xFFFFFFFF;
            if (($n & $mask) !== ($nl & $mask)) {
                continue;
            }
        } elseif ($addr !== $ip) {
            continue;
        }
        $t = ctype_digit($p[0]) ? (int) $p[0] : 0;
        $s = ctype_digit($p[4]) ? (int) $p[4] : 0;
        $end = $t + $s;
        $until = $until === null ? $end : max($until, $end);
        if ($p[2] !== '') {
            $ports[] = $p[2];
        }
        $rows[] = ['addr' => $addr, 'start' => $t, 'until' => $end, 'ports' => $p[2], 'dir' => $p[3]];
    }
    // ports: port sınırlı satırların portları (virgüllü); bir satır bütün portları kapatıyorsa (portsuz) boş
    $all = false;
    foreach ($rows as $r) {
        $all = $all || $r['ports'] === '';
    }
    ag_json(['ok' => true, 'blocked' => $rows !== [], 'until' => $until,
             'ports' => $all ? '' : implode(',', array_unique($ports)), 'rows' => $rows]);
}

ag_input_bootstrap();
if (strtoupper(ag_env('REQUEST_METHOD') ?: 'GET') === 'GET' && (string) ($_GET['a'] ?? '') === 'tempban_check') {
    ag_guard();
    ag_tempban_check(trim((string) ($_GET['ip'] ?? '')));
}
ag_bootstrap();
ag_guard();
ag_csrf_check();

$a = (string) ($_POST['a'] ?? '');

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

    case 'abuse_block':                             // aralık kartı düğmesi: AbuseIPDB blok sorgusu (ağ adresiyle /16–/31; motor da denetler)
        $cidr = trim((string) ($_POST['cidr'] ?? ''));
        if (!preg_match('/^([0-9]{1,3}\.){3}[0-9]{1,3}\/(1[6-9]|2[0-9]|3[01])$/', $cidr)) {
            ag_json(['ok' => false, 'error' => 'bad_input']);
        }
        ag_json(ag_run_json(['--abuse-block', $cidr], 30));

    case 'bkl':                                     // CSF blok listesi aç / kapat (Ayarlar → Kaynaklar; motor csf.blocklists satırını değiştirir, csf -ra)
        $n = (string) ($_POST['n'] ?? '');
        $w = (string) ($_POST['w'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_]{1,25}$/', $n) || !in_array($w, ['on', 'off'], true)) {
            ag_json(['ok' => false, 'error' => 'bad_input']);
        }
        ag_json(ag_run_json(['--config', 'blocklist', $n, $w, '--json'], 60));

    case 'events':                                  // Geçmiş sekmesi: olay kaydından bir sayfa
        $m = (string) ($_POST['m'] ?? 'latest');
        if (!in_array($m, ['latest', 'after', 'before'], true)) {
            ag_json(['ok' => false, 'error' => 'bad_input']);
        }
        $t = max(0, (int) ($_POST['t'] ?? 0));
        $n = max(1, min(1000, (int) ($_POST['n'] ?? 300)));
        ag_json(ag_run_json(['--events', $m, (string) $t, (string) $n], 30));

    case 'inside':                                  // elle /16 ya da /24 banının onay penceresi: içindekiler
        $bits = (string) ($_POST['bits'] ?? '');
        $target = trim((string) ($_POST['target'] ?? ''));
        // duyurulan aralık (/8–/23, /16 hariç) ve aralık kartının gösterdiği öteki önekler (/8–/32): hedef tam CIDR'dir
        $pfx = preg_match('/^([89]|1[0-57-9]|2[0-35-9]|3[0-2])$/', $bits) && preg_match('/^([0-9]{1,3}\.){3}[0-9]{1,3}\/' . $bits . '$/', $target);
        if (!$pfx && !($bits === '16' && ag_valid(AG_RE_16, $target)) && !($bits === '24' && ag_valid(AG_RE_24, $target))) {
            ag_json(['ok' => false, 'error' => 'bad_input']);
        }
        ag_json(ag_run_json(['--inside', $pfx ? $target : ($bits === '16' ? $target . '.0.0/16' : $target . '.0/24'), '--json'], 45));

    case 'action':
        $name   = (string) ($_POST['name'] ?? '');
        $target = trim((string) ($_POST['target'] ?? ''));
        $re = [
            'ban1' => AG_RE_IP, 'allow1' => AG_RE_IP, 'unallow1' => AG_RE_IP, 'ban16' => AG_RE_16, 'ban24' => AG_RE_24, 'banpfx' => '/^([0-9]{1,3}\.){3}[0-9]{1,3}\/([89]|1[0-5]|1[7-9]|2[0-3])$/', 'forget' => AG_RE_24,
            'rewatch' => AG_RE_24,
            'unban' => AG_RE_CIDR, 'ignore' => AG_RE_CIDR, 'unignore' => AG_RE_CIDR,
            'expire' => '/^[0-9]{2,4}$/',          // hedef: arayüzün gördüğü "eski" gün sayısı
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
            $args[] = (string) max(0, min(365, $days));   // 0 = süresiz
        }
        if (($_POST['force'] ?? '') === '1') {
            $args[] = '--force';
        }
        if (($_POST['keep'] ?? '') === '1') {      // "kapsananları kaldır" kapalı
            $args[] = '--keep';
        }
        if ($name === 'unban' && ($_POST['restore'] ?? '') === '1') {   // elle banın kaldırdıklarını geri yükle
            $args[] = '--restore';
        }
        if (in_array($name, ['ban1', 'ban16', 'ban24', 'banpfx', 'allow1'], true)) {   // süre (saniye, en çok 30 gün; 0 = kalıcı); banda yalnız "Her şey" ile
            $ttl = (int) ($_POST['ttl'] ?? 0);
            if ($ttl < 0 || $ttl > 2592000) { ag_json(['ok' => false, 'code' => 2, 'message' => 'bad_ttl']); }
            if ($ttl > 0) { array_push($args, '--ttl', (string) $ttl); }
        }
        if ($name === 'allow1') {                // izin satırının notu (motor da denetler)
            $note = trim((string) ($_POST['note'] ?? ''));
            if ($note !== '') {
                // /u: geçersiz UTF-8'de eşleşmez; 60 karakter (mbstring her PHP'de yok)
                if (!preg_match('/^.{1,60}$/u', $note) || preg_match('/[#|\\\\"\'`$;<>\r\n]/', $note)) {
                    ag_json(['ok' => false, 'code' => 2, 'message' => 'bad_note']);
                }
                array_push($args, '--note', $note);
            }
        }
        if ($name === 'ban16' || $name === 'ban24' || $name === 'banpfx' || $name === 'ban1') {   // ne kapatılsın: all | svc (seçilen servisler) | exc (her şey, seçilenler hariç)
            $mode  = (string) ($_POST['mode'] ?? 'all');
            $svc   = (string) ($_POST['svc'] ?? '');
            $ports = (string) ($_POST['ports'] ?? '');
            if (!in_array($mode, ['all', 'svc', 'exc'], true) || ($svc !== '' && !preg_match('/^[a-z]+(,[a-z]+){0,9}$/', $svc))
                || ($ports !== '' && !preg_match('/^[0-9]{1,5}(-[0-9]{1,5})?(\/(tcp|udp))?(,[0-9]{1,5}(-[0-9]{1,5})?(\/(tcp|udp))?){0,29}$/', $ports))) {
                ag_json(['ok' => false, 'code' => 2, 'message' => 'bad_mode']);
            }
            if (($_POST['replace'] ?? '') === '1') {   // eklentinin kendi banının kipini değiştir
                $args[] = '--replace';
            }
            if ($mode !== 'all') {
                array_push($args, '--mode', $mode);
                if ($svc !== '') { array_push($args, '--svc', $svc); }
                if ($ports !== '') { array_push($args, '--ports', $ports); }
            }
        }
        $args[] = '--json';
        ag_json(ag_run_json($args, 180));   // csf -r büyük listelerde uzun sürebilir

    case 'dry_run':
        // Hiçbir şeyi değiştirmez; çıktı olduğu gibi gösterilir. "Kaydetmeden önce dene" için
        // kaydedilmemiş eşikler --set ile geçer (script yalnız bu anahtarları kabul eder).
        $args = ['--dry-run'];
        // motorun CFG_TRY_KEYS'i ve ag.js TRY_KEYS ile aynı küme (tests/ayar-tutarliligi denetler; PERM_WINDOW_DAYS eksikti,
        // panel gönderiyordu ama burada düşüyordu: deneme kayıtlı değerle koşuyordu)
        $try = ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_PFX', 'THRESHOLD_TEMP_24',
                'PERM_WINDOW_DAYS', 'LOOKUP', 'LOOKUP_TIMEOUT', 'SAYAC_RETENTION_DAYS', 'REVIEW_DAYS'];
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

    case 'abuse_key':                               // AbuseIPDB anahtarı: ayrı dosyaya, standart girdiden (config.env'e ve komut satırına girmez)
        $k = trim((string) ($_POST['key'] ?? ''));
        if (!preg_match('/^[A-Za-z0-9]{0,200}$/', $k)) {
            ag_json(['ok' => false, 'code' => 2, 'message' => 'bad_value: ABUSEIPDB_KEY']);
        }
        $r = ag_run(['--config', 'abuse-key', '--json'], 20, $k);
        $d = json_decode($r['out'], true);
        ag_json(is_array($d) ? $d : ['ok' => $r['rc'] === 0, 'message' => trim($r['out'])]);

    case 'config_set':
        // Anahtar listesi ve kaba karakter süzgeci burada; asıl doğrulama script'te (cfg_check).
        $keys = ['MSG_LANG', 'ALERT_MAIL', 'DIGEST', 'DIGEST_DAY', 'NOTIFY', 'IC_FIREWALL', 'IC_LISTFULL', 'IC_RUN', 'IC_DIGEST', 'IE_FIREWALL', 'IE_LISTFULL', 'IE_RUN', 'IE_DIGEST', 'IC_REVIEW', 'IE_REVIEW', 'THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_PFX', 'THRESHOLD_TEMP_24',
                 'LOOKUP', 'LOOKUP_TIMEOUT', 'SAYAC_RETENTION_DAYS', 'REVIEW_DAYS', 'LOG_KEEP_DAYS', 'EVENTS_DAYS', 'RUN_DAYS', 'PERM_WINDOW_DAYS', 'BANLOG_DAYS', 'LOG_ROTATE_MB', 'LOG_ROTATE_KEEP', 'BLOCK_EXPIRE_DAYS', 'BLOCK_EXPIRE_AUTO', 'CRON_MIN',
                 'SVC_ALLOW', 'SVC_SOURCES', 'SVC_EXTRA', 'SVC_URLS', 'SVC_SKIP', 'SVC_EXCEPT', 'ASN_BAN', 'ASN_LIST', 'ASN_ALL', 'ASN_MODE', 'ASN_TCP', 'ASN_UDP',
                 'CLOUD_BAN', 'CLOUD_SOURCES', 'CLOUD_TCP', 'CLOUD_UDP', 'CLOUD_MODES', 'CLOUD_URLS', 'CLOUD_EXTRA', 'SRC_LABELS', 'ENABLED',
                 'CLOUD_REFRESH_DAYS', 'CLOUD_FAIL_DAYS', 'SVC_REFRESH_DAYS', 'SVC_FAIL_DAYS', 'GEO_REFRESH_DAYS', 'REFRESH_HOUR', 'OWNER_TTL_DAYS', 'IMUNIFY_REFRESH_MIN', 'BLOCK_ACTIVE_DAYS'];
        // listeler virgül, elle eklenen servisler boşluk ve "ad|adres" içerir; diğerleri tek değer
        $re = ['SVC_EXTRA' => '/^[A-Za-z0-9._~:\/?#@=%+&|*, -]{0,16000}$/', 'SVC_SOURCES' => '/^[a-z0-9,]{0,300}$/', 'SVC_SKIP' => '/^[a-z0-9,-]{0,400}$/', 'SVC_EXCEPT' => '/^[0-9.\/, ]{0,4000}$/', 'SVC_URLS' => '/^[A-Za-z0-9._~:\/?#@=%+&|*, -]{0,6000}$/', 'ASN_LIST' => '/^[A-Za-z0-9, ]{0,800}$/', 'ASN_ALL' => '/^[A-Za-z0-9, ]{0,800}$/',
               'ASN_TCP' => '/^[0-9,:]{0,600}$/', 'ASN_UDP' => '/^[0-9,:]{0,600}$/', 'CLOUD_TCP' => '/^[0-9,:]{0,600}$/', 'CLOUD_UDP' => '/^[0-9,:]{0,600}$/', 'CLOUD_MODES' => '/^[a-z0-9=:,\/ -]{0,12000}$/',
               'CLOUD_SOURCES' => '/^[a-z0-9,]{0,300}$/', 'CLOUD_URLS' => '/^[A-Za-z0-9._~:\/?#@=%+&|*, -]{0,3000}$/', 'CLOUD_EXTRA' => '/^[A-Za-z0-9._~:\/?#@=%+&|*, -]{0,6000}$/', 'SRC_LABELS' => '/^[A-Za-z0-9._~%:= -]{0,40000}$/'];
        $args = ['--config', 'set'];
        foreach ((array) ($_POST['v'] ?? []) as $k => $v) {
            $v = trim((string) $v);
            if (!in_array($k, $keys, true) || !preg_match($re[$k] ?? '/^[A-Za-z0-9@._%+*\/:-]{0,254}$/', $v)) {
                ag_json(['ok' => false, 'code' => 2, 'message' => 'bad_value: ' . $k]);
            }
            $args[] = $k . '=' . $v;
        }
        if (count($args) === 2) {
            ag_json(['ok' => false, 'code' => 2, 'message' => 'nothing']);
        }
        $args[] = '--json';
        ag_json(ag_run_json($args, 30));

    case 'prov_apply':                              // sağlayıcı banı / izinli servisler: kaydedilen ayarı CSF'e şimdi uygula
        ag_json(ag_run_json(['--prov-apply', '--json'], 300));

    case 'asn_impact':                              // son 24 saatte bu sağlayıcıdan (ASnnn) ya da kiralık listeden (cl:ad) sitelere gelen istekler
    case 'src_ips':                                 // ayrıntı penceresi: bu sağlayıcıya / kiralık listeye düşen ihlal eden IP'ler
        $key = trim((string) ($_POST['asn'] ?? ''));
        if (preg_match('/^as[0-9]{1,10}$/i', $key)) {
            $key = strtoupper($key);
        } elseif (!preg_match('/^cl:[a-z0-9-]{1,63}(\+[a-z0-9-]{1,63}){0,30}$/', $key)) {
            ag_json(['ok' => false, 'error' => 'bad_asn']);
        }
        $st = trim((string) ($_POST['states'] ?? ''));   // ölçümdeki IP'lerin yalnız şu anki durumu (eylemden sonra; günlük okunmaz)
        if ($a === 'asn_impact' && $st !== '') {
            if (!preg_match('/^([0-9]{1,3}\.){3}[0-9]{1,3}(,([0-9]{1,3}\.){3}[0-9]{1,3}){0,299}$/', $st)) { ag_json(['ok' => false, 'error' => 'bad_states']); }
            ag_json(ag_run_json(['--asn-impact', $key, '--states', $st, '--json'], 60));
        }
        ag_json($a === 'src_ips' ? ag_run_json(['--src-ips', $key, '--json'], 60) : ag_run_json(['--asn-impact', $key, '--json'], 180));

    case 'config_test_mail':
        ag_json(ag_run_json(['--config', 'test-mail', '--json'], 30));

    case 'config_test_slack':
        ag_json(ag_run_json(['--config', 'test-slack', '--json'], 60));

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
        // fresh=1: Ayarlar'daki "Güncellemeleri denetle" düğmesi — 5 dakikalık önbellek atlanır
        ag_json(ag_update_check(($_POST['fresh'] ?? '') === '1'));

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
