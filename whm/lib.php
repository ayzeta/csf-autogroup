<?php
/**
 * CSF Auto-Group — WHM eklentisi, ortak kütüphane.
 *
 * Eklenti hiçbir güvenlik duvarı kararını kendisi vermez ve csf.deny'yi kendisi
 * ayrıştırmaz: her şey csf_autogroup.sh üzerinden yapılır (--status --json,
 * --lookup, --action, --dry-run). Böylece terminaldeki `--status` ile bu sayfa
 * hiçbir zaman farklı şey söylemez ve bir kural tek yerde değişir.
 *
 * Erişim: yalnızca WHM üzerinden, root olarak çalışan süreçte ve "all" yetkili
 * WHM hesabıyla. Durum değiştiren her istek POST + zaman damgalı CSRF anahtarı ister.
 */

declare(strict_types=1);

// PHP uyarıları çıktıya karışıp JSON'u bozmasın (ör. dizi gelen bir girdi); hatalar günlüğe gider.
@ini_set('display_errors', '0');

if (!defined('AG_LOADED')) {
    define('AG_LOADED', true);
    define('AG_STATE', '/var/cpanel/csf_autogroup');         // eklentinin kendi durumu (anahtar, kayıtlar)
    define('AG_SECRET', AG_STATE . '/.secret');
    define('AG_UPDATE_LOG', AG_STATE . '/update.log');
    define('AG_RUN_LOG', AG_STATE . '/run.log');
    define('AG_CSRF_TTL', 43200);                             // 12 saat: sayfa uzun süre açık kalabilir
    define('AG_USER_RE', '/^[a-z0-9][a-z0-9_-]{0,31}$/i');
}

/* ------------------------------------------------------------------ */
/* Ortam                                                              */
/* ------------------------------------------------------------------ */

function ag_env(string $key): string
{
    $v = getenv($key);
    if ($v !== false && $v !== '') {
        return (string) $v;
    }
    return (string) ($_SERVER[$key] ?? '');
}

function ag_euid(): int
{
    if (function_exists('posix_geteuid')) {
        return posix_geteuid();
    }
    $out = @shell_exec('id -u 2>/dev/null');
    return $out === null ? -1 : (int) trim($out);
}

/** WHM eklentileri CLI SAPI ile çalışabilir; o zaman başlıklar elle basılır. */
function ag_headers(string $ctype, int $code = 200): void
{
    static $sent = false;
    if ($sent) {
        return;
    }
    $sent = true;
    $h = [
        'Content-Type: ' . $ctype,
        'X-Frame-Options: SAMEORIGIN',
        'X-Content-Type-Options: nosniff',
        'Referrer-Policy: no-referrer',
        'Cache-Control: no-store',
    ];
    if (PHP_SAPI === 'cli') {
        if ($code !== 200) {
            echo "Status: {$code}\r\n";
        }
        echo implode("\r\n", $h) . "\r\n\r\n";
        return;
    }
    http_response_code($code);
    foreach ($h as $line) {
        header($line);
    }
}

/** CLI SAPI altında $_GET/$_POST dolmaz; CGI ortamından yeniden kurulur. */
function ag_input_bootstrap(): void
{
    if (PHP_SAPI !== 'cli') {
        return;
    }
    $qs = ag_env('QUERY_STRING');
    if ($qs !== '') {
        parse_str($qs, $g);
        $_GET = is_array($g) ? $g : [];
    }
    if (strtoupper(ag_env('REQUEST_METHOD') ?: 'GET') === 'POST') {
        $len   = (int) (ag_env('CONTENT_LENGTH') ?: 0);
        $ctype = strtolower(ag_env('CONTENT_TYPE'));
        if ($len > 0 && $len <= 65536 && strpos($ctype, 'urlencoded') !== false) {
            $fh = fopen('php://stdin', 'r');
            if ($fh) {
                parse_str((string) stream_get_contents($fh, $len), $p);
                fclose($fh);
                $_POST = is_array($p) ? $p : [];
            }
        }
    }
}

function ag_bootstrap(): void
{
    if (!is_dir(AG_STATE)) {
        @mkdir(AG_STATE, 0700, true);
    }
    @chmod(AG_STATE, 0700);
    if (ag_secret() === '') {
        $tmp = AG_SECRET . '.' . bin2hex(random_bytes(6));
        if (@file_put_contents($tmp, bin2hex(random_bytes(32))) !== false) {
            @chmod($tmp, 0600);
            @rename($tmp, AG_SECRET);
        }
        @unlink($tmp);
    }
}

/** CSRF anahtarı: 64 onaltılık karakter değilse boş döner — boş anahtarla imza üretilmez/doğrulanmaz. */
function ag_secret(): string
{
    $s = trim((string) @file_get_contents(AG_SECRET));
    return preg_match('/^[a-f0-9]{64}$/', $s) ? $s : '';
}

/* ------------------------------------------------------------------ */
/* Erişim                                                             */
/* ------------------------------------------------------------------ */

/**
 * WHM kullanıcısı tam yetkili mi? cPanel'in kendi kaydı: /var/cpanel/resellers
 * satırları "kullanıcı:acl1,acl2,…" biçiminde, `all` root eşdeğeri. Dosya
 * okunamıyorsa yetki verilmez — bilinmeyen durumda güvenli taraf reddetmektir.
 */
function ag_has_root_acl(string $user): bool
{
    if ($user === 'root') {
        return true;
    }
    if (!preg_match(AG_USER_RE, $user)) {
        return false;
    }
    $f = '/var/cpanel/resellers';
    if (!is_readable($f)) {
        return false;
    }
    foreach (preg_split('/\R/', (string) @file_get_contents($f)) as $line) {
        $pos = strpos($line, ':');
        if ($pos === false || substr($line, 0, $pos) !== $user) {
            continue;
        }
        foreach (explode(',', substr($line, $pos + 1)) as $acl) {
            if (trim($acl) === 'all') {
                return true;
            }
        }
        return false;
    }
    return false;
}

/**
 * AppConfig'teki `acls=all` sayfayı menüde yalnız tam yetkiliye gösterir ama bu
 * bir görünürlük kararıdır; adrese doğrudan gelen isteği burası durdurur.
 */
function ag_guard(): void
{
    $who = ag_env('REMOTE_USER');
    if ($who === '') {
        ag_fail('This page can only be opened from WHM.');
    }
    if (ag_euid() !== 0) {
        ag_fail('The plugin is not running as root. Re-run install.sh.');
    }
    if (!ag_has_root_acl($who)) {
        ag_fail('CSF Auto-Group requires a WHM account with the "all" privilege.');
    }
}

function ag_fail(string $msg, int $code = 403): void
{
    ag_headers('text/plain; charset=utf-8', $code);
    echo $msg . "\n";
    exit(1);
}

function ag_json($data, int $code = 200): void
{
    ag_headers('application/json; charset=utf-8', $code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit(0);
}

function ag_user(): string
{
    $u = ag_env('REMOTE_USER');
    return preg_match(AG_USER_RE, $u) ? $u : 'root';
}

/* ------------------------------------------------------------------ */
/* CSRF: "<üretim zamanı>.<HMAC>" — yalnız POST gövdesinden okunur       */
/* ------------------------------------------------------------------ */

function ag_csrf_token(): string
{
    $ts = time();
    $key = ag_secret();
    return $key === '' ? '' : $ts . '.' . hash_hmac('sha256', 'csf-autogroup|' . ag_user() . '|' . $ts, $key);
}

function ag_csrf_check(): void
{
    if (strtoupper(ag_env('REQUEST_METHOD') ?: 'GET') !== 'POST') {
        ag_json(['ok' => false, 'error' => 'POST only'], 405);
    }
    $sent = (string) ($_POST['csrf'] ?? '');
    $ok = false;
    $key = ag_secret();
    if ($key !== '' && preg_match('/^([0-9]{1,12})\.([a-f0-9]{64})$/', $sent, $m)) {
        $age = time() - (int) $m[1];
        if ($age >= -300 && $age <= AG_CSRF_TTL) {
            $want = hash_hmac('sha256', 'csf-autogroup|' . ag_user() . '|' . $m[1], $key);
            $ok = hash_equals($want, $m[2]);
        }
    }
    if (!$ok) {
        ag_json(['ok' => false, 'error' => 'session', 'message' => 'Session expired — reload the page.'], 403);
    }
}

/* ------------------------------------------------------------------ */
/* Kurulum bilgisi ve script                                          */
/* ------------------------------------------------------------------ */

/** install.sh her dağıtımda version.json yazar: sürüm, commit, repo yolu. */
function ag_version(): array
{
    static $v = null;
    if ($v !== null) {
        return $v;
    }
    $raw = json_decode((string) @file_get_contents(__DIR__ . '/version.json'), true);
    $raw = is_array($raw) ? $raw : [];
    return $v = [
        'version'   => (string) ($raw['version'] ?? '?'),
        'commit'    => (string) ($raw['commit'] ?? ''),
        'repo'      => (string) ($raw['repo'] ?? ''),
        'installed' => (string) ($raw['installed'] ?? ''),
    ];
}

/** Script yolu: repo içindeki csf_autogroup.sh. Root'a ait bir dosya olmalı. */
function ag_script(): ?string
{
    $repo = ag_version()['repo'];
    if ($repo === '' || $repo[0] !== '/') {
        return null;
    }
    $s = rtrim($repo, '/') . '/csf_autogroup.sh';
    if (!is_file($s) || @fileowner($s) !== 0) {
        return null;
    }
    return $s;
}

function ag_which(string $bin): ?string
{
    foreach (['/usr/bin/', '/bin/', '/usr/local/bin/', '/usr/sbin/', '/sbin/'] as $d) {
        if (is_file($d . $bin) && is_executable($d . $bin)) {
            return $d . $bin;
        }
    }
    return null;
}

/**
 * Script'i çalıştırır. Argümanlar tek tek kaçışlanır; kullanıcı girdisi zaten
 * çağıran tarafta katı desenlerden geçmiş olur (ikinci savunma hattı script'te).
 *
 * @return array{rc:int, out:string}
 */
function ag_run(array $args, int $timeout = 60): array
{
    $script = ag_script();
    if ($script === null) {
        return ['rc' => 127, 'out' => '', 'err' => 'csf_autogroup.sh not found — re-run install.sh.'];
    }
    $cmd = '';
    $to = ag_which('timeout');
    if ($to !== null) {
        $cmd .= escapeshellarg($to) . ' ' . (int) $timeout . ' ';
    }
    $cmd .= 'env AG_BY=' . escapeshellarg(ag_user()) . ' HOME=/root /bin/bash ' . escapeshellarg($script);
    foreach ($args as $a) {
        $cmd .= ' ' . escapeshellarg((string) $a);
    }
    // stdout ve stderr AYRI okunur: JSON yalnız stdout'tan çözülür, bir aracın basacağı zararsız
    // bir uyarı (ör. "cut: write error: Broken pipe" — WHM'in PHP'si SIGPIPE'ı yok saydığı için
    // görülüyordu, 2026-09-27) sayfayı düşüremez. stderr bir dosyaya gider: iki boruyu aynı anda
    // okumaya gerek kalmaz, dolan tampon yüzünden kilitlenme ihtimali de olmaz.
    $errf = @tempnam(AG_STATE, 'run.');
    if ($errf === false) {
        $errf = '/dev/null';
    }
    $p = @proc_open($cmd, [1 => ['pipe', 'w'], 2 => ['file', $errf, 'w']], $pipes);
    if (!is_resource($p)) {
        if ($errf !== '/dev/null') { @unlink($errf); }
        return ['rc' => 126, 'out' => '', 'err' => 'proc_open failed'];
    }
    $out = (string) stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $rc = proc_close($p);
    $err = $errf !== '/dev/null' ? (string) @file_get_contents($errf) : '';
    if ($errf !== '/dev/null') { @unlink($errf); }
    return ['rc' => (int) $rc, 'out' => rtrim($out, "\n"), 'err' => rtrim($err, "\n")];
}

/** Script'in JSON çıktısını çözer; çözülemezse ham çıktıyla birlikte hata döner. */
function ag_run_json(array $args, int $timeout = 60): array
{
    $r = ag_run($args, $timeout);
    // Bir ban yorumundaki bozuk tek bir UTF-8 baytı bütün sayfayı düşürmesin: yerine � konur.
    $d = json_decode($r['out'], true, 512, JSON_INVALID_UTF8_SUBSTITUTE);
    if (!is_array($d)) {
        $msg = trim(substr(trim($r['out'] . "\n" . $r['err']), 0, 600));
        return ['ok' => false, 'code' => $r['rc'], 'message' => $msg !== '' ? $msg : 'no output'];
    }
    return $d;
}

/** Uzun işleri (güncelleme, "şimdi çalıştır") istekten bağımsız, kendi oturumunda başlatır. */
function ag_spawn(string $shellCmd, string $log): void
{
    $setsid = ag_which('setsid');
    @exec(($setsid !== null ? escapeshellarg($setsid) . ' ' : '')
        . 'nohup env HOME=/root ' . $shellCmd . ' >> ' . escapeshellarg($log) . ' 2>&1 < /dev/null &');
}

/* ------------------------------------------------------------------ */
/* Güncelleme (repo herkese açık GitHub deposu; update.sh kullanılır)  */
/* ------------------------------------------------------------------ */

/** Yol root'a ait ve grup/diğerleri yazamıyor mu? (root olarak çalıştırılacak dosyalar için) */
function ag_root_safe(string $p): bool
{
    clearstatcache(true, $p);
    $o = @fileowner($p);
    $m = @fileperms($p);
    return $o === 0 && $m !== false && ($m & 0022) === 0;
}

/**
 * $fresh: güncellemeyi uygulamadan hemen önce true — GitHub her seferinde sorulur. Sayfa açılışlarında
 * GitHub en çok 5 dakikada bir sorulur, arada yerel bilgiyle yanıt verilir.
 */
function ag_update_check(bool $fresh = false): array
{
    $repo = ag_version()['repo'];
    $git = ag_which('git');
    if ($repo === '' || !is_dir($repo . '/.git') || $git === null) {
        return ['ok' => false, 'error' => 'not_git'];
    }
    $g = 'env HOME=/root ' . escapeshellarg($git) . ' -C ' . escapeshellarg($repo) . ' ';
    $run = static function (string $a) use ($g): string {
        return trim((string) @shell_exec($g . $a . ' 2>/dev/null'));
    };
    $branch = $run('rev-parse --abbrev-ref HEAD');
    if ($branch === '' || $branch === 'HEAD') {
        return ['ok' => false, 'error' => 'detached'];
    }
    $fetch = '';
    $stamp = AG_STATE . '/fetch.stamp';
    if ($fresh || !is_file($stamp) || time() - (int) @filemtime($stamp) > 300) {
        $to = ag_which('timeout');
        $fetch = (string) @shell_exec('env HOME=/root GIT_TERMINAL_PROMPT=0 ' . ($to !== null ? escapeshellarg($to) . ' 30 ' : '')
            . substr($g, strlen('env HOME=/root ')) . 'fetch --quiet origin ' . escapeshellarg($branch) . ' 2>&1');
        @touch($stamp);
    }
    $local = $run('rev-parse @');
    $remote = $run('rev-parse ' . escapeshellarg('origin/' . $branch));
    if ($local === '' || $remote === '') {
        // adreste kullanıcı:parola varsa sayfaya taşınmasın
        return ['ok' => false, 'error' => 'unreachable', 'detail' => trim(substr((string) preg_replace('#://[^@/\s]+@#', '://', $fetch), 0, 300))];
    }
    $base = $run('merge-base @ ' . escapeshellarg('origin/' . $branch));
    $latest = '';
    if (preg_match('/^VERSION="([^"\n]+)"/m', $run('show ' . escapeshellarg('origin/' . $branch . ':csf_autogroup.sh')), $m)) {
        $latest = $m[1];
    }
    $commits = [];
    if ($local !== $remote) {
        foreach (preg_split('/\R/', $run('log --format=%h%x09%s ' . escapeshellarg('@..origin/' . $branch))) as $l) {
            if (trim($l) !== '') {
                [$h, $subj] = array_pad(explode("\t", $l, 2), 2, '');
                $commits[] = ['hash' => $h, 'subject' => $subj];
            }
        }
    }
    return [
        'ok'             => true,
        'checked'        => (int) @filemtime($stamp),   // GitHub'a en son gerçekten sorulan an (önbellekten değil)
        'current'        => ag_version()['version'],
        'current_commit' => substr($local, 0, 7),
        'latest'         => $latest !== '' ? $latest : '?',
        'latest_commit'  => substr($remote, 0, 7),
        'commits'        => $commits,
        'uptodate'       => $local === $remote,
        // Yerel değişiklik ya da sunucuda yapılmış commit varsa güncelleme yapılmaz.
        'dirty'          => $run('status --porcelain --untracked-files=no') !== '',
        'diverged'       => $local !== $base && $local !== $remote,
    ];
}
