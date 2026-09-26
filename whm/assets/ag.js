/* CSF Auto-Group — WHM eklentisi arayüzü.
 * Sayfanın tamamı api.php'nin döndürdüğü veriden kurulur; veri csf_autogroup.sh
 * --status --json çıktısıdır (terminaldeki --status ile aynı kaynak).
 * Durum değiştiren her işlem bir onay penceresinden geçer; riskli olanlarda
 * (ör. /16 banı, beyaz listeyi aşmak, "do not delete" kaldırmak) hedef elle yazılır. */
(function () {
  'use strict';

  var BOOT = window.AG_BOOT || {};
  var $app = document.getElementById('ag-app');
  var S = null;                 // son durum verisi
  var UPD = null;               // güncelleme kontrolü sonucu
  var LANG = 'en';
  var CLOCK = 0;                // sunucu saati - istemci saati (sn)
  var UI = { gf: 'all', gq: '', ef: 'all', open: {}, evLimit: 40, gLimit: 40, commits: false };
  var pollTimer = null, wasRunning = false, busy = false;

  /* ── Simgeler (çizgi, 24px ızgara) ─────────────────────────────── */
  function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var IC = {
    shield: svg('<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),
    play: svg('<path d="M7 5v14l11-7z"/>'),
    eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    download: svg('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
    alert: svg('<path d="M12 3l9.5 17h-19L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    ban: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.01"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
    ext: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    mute: svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l4 6M21 9l-4 6"/>'),
    sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
    inbox: svg('<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 2h6l1-2h5"/>'),
    hour: svg('<path d="M6 3h12M6 21h12"/><path d="M7 3c0 5 10 5 10 9s-10 4-10 9"/><path d="M17 3c0 5-10 5-10 9"/>'),
    terminal: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>')
  };

  /* ── Diller ────────────────────────────────────────────────────── */
  var DICT = {
    tr: {
      subtitle: 'Saldırgan IP gruplama · CSF', running: 'Tur çalışıyor', idle: 'Hazır', last_run: 'son tur {0}',
      no_run: 'henüz tur yok', dry: 'Kuru çalıştır', run: 'Şimdi çalıştır', run_log: 'Tur çıktısı',
      upd_avail: '<b>Güncelleme var:</b> v{0} → v{1}', upd_commits: '{0} değişiklik', upd_show: 'Değişiklikleri gör', upd_hide: 'Gizle',
      upd_apply: 'Güncelle', upd_dirty: 'Sunucudaki kopyada yerel değişiklik var; güncelleme SSH üzerinden yapılmalı.',
      upd_diverged: 'Sunucudaki kopya GitHub\'dan ayrılmış; güncelleme SSH üzerinden yapılmalı.',
      k_perm: 'Kalıcı liste', k_temp: 'Geçici liste', k_groups: 'Aktif grup banı', k_review: 'Kontrol edilecek',
      k_lines: '{0} / {1} satır', k_nolimit: 'limit tanımsız', k_dnd: '{0} tanesi do not delete', k_review_m: 'son {0} gün',
      s_review: 'Kontrol edilecekler', s_review_h: 'Otomatik banlanmayan, göz atılması gerekenler',
      s_groups: 'Aktif grup banları', s_events: 'Son işlemler', s_lookup: 'IP sorgula', s_pending: 'Terfi bekleyenler',
      s_pending_h: 'Bir kez geçici banlandı; tekrar gelirse kalıcı + do not delete', s_ignored: 'Yoksayılanlar', s_config: 'Kurallar',
      lookup_ph: '185.220.101.12', lookup_btn: 'Sorgula', lookup_hint: 'Hostname, sahip (ASN), duyurulan blok, kayıt ve CSF listelerindeki durumu.',
      f_all: 'Tümü', f_perm: 'Kalıcı', f_dnd: 'Do not delete', f_temp: 'Geçici', f_manual: 'Elle', g_search: 'CIDR, AS ya da kurum',
      e_all: 'Tümü', e_bans: 'Banlar', e_warn: 'Uyarılar', e_skip: 'Atlananlar', e_manual: 'Elle işlemler', e_clean: 'Temizlik',
      ev_add24: 'Grup banı', ev_promote: 'Kalıcıya terfi', ev_temp24: 'Geçici grup', ev_skip_wl: 'Beyaz liste', ev_warn16: '/16 uyarısı',
      ev_warn16t: '/16 geçici', ev_clean_temp: 'Temizlendi', ev_manual_ban: 'Elle ban', ev_manual_unban: 'Kaldırıldı',
      ev_manual_forget: 'Kayıt silindi', ev_manual_ignore: 'Yoksayıldı', ev_manual_unignore: 'Yoksayma kalktı',
      kind_perm: 'kalıcı', kind_promoted: 'terfi', kind_temp: 'geçici', kind_manual: 'elle',
      ips: 'IP\'ler', hide: 'Gizle', ban16: '/16 banla', ban_anyway: 'Yine de banla', ignore: 'Yoksay', unban: 'Kaldır',
      promote: 'Kalıcı yap', forget: 'Kaydı sil', unignore: 'Kaldır', show_all: 'Tümünü göster ({0})', more: 'Daha fazla',
      n_ip: '{0} IP', n_subnets: '{0} farklı /24', n_singles: '{0} tekilden', since: '{0} tarihinden beri', days_left: '{0} gün kaldı',
      ttl_left: 'geçici ban {0}', until: '{0} tarihine kadar', by: '{0} tarafından', wl: 'beyaz liste: {0}', and_more: '+{0} IP daha',
      no_review: 'Göz atılacak bir şey yok.', no_groups: 'Aktif grup banı yok.', no_pending: 'Terfi bekleyen blok yok.',
      no_events: 'Henüz kayıt yok. İlk turdan sonra burada görünecek.', no_match: 'Eşleşen kayıt yok.',
      c_t24: '/24 grup banı', c_t24p: 'do not delete eşiği', c_t16: '/16 uyarısı', c_tt24: 'Geçici /24', c_tt16: 'Geçici /16',
      c_ret: 'Terfi kaydı saklama', c_lookup: 'Sahip / hostname sorgusu', c_on: 'açık', c_off: 'kapalı', c_days: '{0} gün', c_singles: '≥ {0} tekil',
      now: 'az önce', min_ago: '{0} dk önce', h_ago: '{0} sa önce', d_ago: '{0} gün önce', dur_h: '{0} sa {1} dk', dur_m: '{0} dk',
      cancel: 'Vazgeç', confirm: 'Onayla', close: 'Kapat', reload: 'Sayfayı yenile', type_to_confirm: 'Onaylamak için {0} yazın',
      m_ban16_t: '{0} kalıcı olarak banlansın mı?', m_ban16_b: 'Bu, 65.536 adresin tamamını engeller. Blok "do not delete" olarak eklenir; limit dolduğunda da silinmez.',
      m_force_t: 'Beyaz listeye rağmen banlansın mı?', m_force_b: 'Bu blok CSF beyaz listelerinden biriyle çakışıyor:',
      m_force_n: 'csf.allow adresleri ban içinden geçmeye devam eder; csf.ignore ve diğerleri ise ENGELLENİR.',
      m_promote_t: '{0} şimdi kalıcı yapılsın mı?', m_promote_b: 'Blok "do not delete" olarak kalıcı listeye eklenir ve terfi kaydı silinir.',
      m_forget_t: '{0} için terfi kaydı silinsin mi?', m_forget_b: 'Bu bloktan bir sonraki grup saldırısı yine "ilk kez" sayılır ve 12 saatlik geçici ban alır.',
      m_unban_t: '{0} kaldırılsın mı?', m_unban_b: 'Grup banı kaldırılır. Gruplanırken silinen tekil banlar geri gelmez; bu adresler tamamen açılır.',
      m_unban_dnd: 'Bu blok "do not delete" işaretli. Kaldırmak için csf.deny\'deki işaret önce silinir (dosyanın yedeği alınır).',
      m_ignore_t: '{0} yoksayılsın mı?', m_ignore_b: 'Bu blok "Kontrol edilecekler" listesinden gizlenir; /16 ise uyarı maili de gelmez.', m_ignore_d: 'Süre',
      m_unignore_t: '{0} tekrar izlensin mi?', m_run_t: 'Tur şimdi çalıştırılsın mı?',
      m_run_b: 'Cron\'un yapacağının aynısı hemen yapılır: eşiği geçen /24\'ler banlanır, mailler gönderilir.',
      m_dry_t: 'Kuru çalıştırma', m_dry_wait: 'Tur hiçbir şeyi değiştirmeden simüle ediliyor…', m_dry_none: 'Bu tur hiçbir değişiklik yapmazdı.',
      m_upd_t: 'v{0} sürümüne güncellensin mi?', m_upd_b: 'update.sh çalıştırılır; config.env ve kayıtlar korunur. Birkaç saniye sürer.',
      m_upd_run: 'Güncelleniyor…', m_upd_ok: 'Güncelleme tamamlandı.', m_upd_fail: 'Güncelleme tamamlanamadı; çıktıya bakın.',
      t_started: 'Tur başlatıldı.', t_done: 'Tur tamamlandı.', t_busy: 'Başka bir tur çalışıyor, birazdan tekrar deneyin.',
      t_err: 'İşlem tamamlanamadı: {0}', session: 'Oturum süresi doldu. Sayfayı yenileyin.', t_copied: 'Kopyalandı.',
      l_host: 'Hostname', l_fwd: 'ileri yönde doğrulandı', l_nofwd: 'ileri yönde doğrulanamadı', l_noptr: 'Ters DNS kaydı yok',
      l_owner: 'Sahip', l_prefix: 'Duyurulan blok', l_reg: 'Kayıt', l_fw: 'Güvenlik duvarı', l_wl: 'Beyaz liste',
      l_pending: 'Terfi bekliyor', l_ign: 'Yoksayılıyor', l_notbanned: 'Engelli değil', l_none: 'Yok', l_perm_single: 'Kalıcı (tekil)',
      l_perm_cover: 'Kalıcı (blok)', l_temp: 'Geçici', l_nolookup: 'Sahip ve hostname sorguları kapalı (LOOKUP=0).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Kopyala', bad_ip: 'Geçerli bir IPv4 adresi yazın.',
      foot: 'CSF Auto-Group v{0} · {1} olarak oturum açıldı'
    },
    en: {
      subtitle: 'Attacker IP grouping · CSF', running: 'Run in progress', idle: 'Ready', last_run: 'last run {0}',
      no_run: 'no run yet', dry: 'Dry run', run: 'Run now', run_log: 'Run output',
      upd_avail: '<b>Update available:</b> v{0} → v{1}', upd_commits: '{0} changes', upd_show: 'View changes', upd_hide: 'Hide',
      upd_apply: 'Update', upd_dirty: 'The server copy has local changes; update over SSH.',
      upd_diverged: 'The server copy has diverged from GitHub; update over SSH.',
      k_perm: 'Permanent list', k_temp: 'Temp list', k_groups: 'Active group bans', k_review: 'To review',
      k_lines: '{0} / {1} lines', k_nolimit: 'no limit set', k_dnd: '{0} marked do not delete', k_review_m: 'last {0} days',
      s_review: 'To review', s_review_h: 'Not banned automatically — worth a look',
      s_groups: 'Active group bans', s_events: 'Recent actions', s_lookup: 'Look up an IP', s_pending: 'Pending promotion',
      s_pending_h: 'Temp-banned once; back again means permanent + do not delete', s_ignored: 'Ignored', s_config: 'Rules',
      lookup_ph: '185.220.101.12', lookup_btn: 'Look up', lookup_hint: 'Hostname, owner (ASN), announced prefix, registry and CSF list status.',
      f_all: 'All', f_perm: 'Permanent', f_dnd: 'Do not delete', f_temp: 'Temp', f_manual: 'Manual', g_search: 'CIDR, AS or org',
      e_all: 'All', e_bans: 'Bans', e_warn: 'Warnings', e_skip: 'Skipped', e_manual: 'Manual', e_clean: 'Cleanup',
      ev_add24: 'Group ban', ev_promote: 'Promoted', ev_temp24: 'Temp group', ev_skip_wl: 'Whitelist', ev_warn16: '/16 warning',
      ev_warn16t: '/16 temp', ev_clean_temp: 'Cleaned', ev_manual_ban: 'Manual ban', ev_manual_unban: 'Removed',
      ev_manual_forget: 'Record removed', ev_manual_ignore: 'Ignored', ev_manual_unignore: 'Unignored',
      kind_perm: 'permanent', kind_promoted: 'promoted', kind_temp: 'temp', kind_manual: 'manual',
      ips: 'IPs', hide: 'Hide', ban16: 'Ban /16', ban_anyway: 'Ban anyway', ignore: 'Ignore', unban: 'Remove',
      promote: 'Make permanent', forget: 'Remove record', unignore: 'Remove', show_all: 'Show all ({0})', more: 'Show more',
      n_ip: '{0} IPs', n_subnets: '{0} distinct /24s', n_singles: 'from {0} singles', since: 'since {0}', days_left: '{0} days left',
      ttl_left: 'temp ban {0}', until: 'until {0}', by: 'by {0}', wl: 'whitelist: {0}', and_more: '+{0} more IPs',
      no_review: 'Nothing to review.', no_groups: 'No active group bans.', no_pending: 'No blocks pending promotion.',
      no_events: 'Nothing recorded yet. Runs will show up here.', no_match: 'No matching entries.',
      c_t24: '/24 group ban', c_t24p: 'do not delete at', c_t16: '/16 warning', c_tt24: 'Temp /24', c_tt16: 'Temp /16',
      c_ret: 'Promotion record kept', c_lookup: 'Owner / hostname lookups', c_on: 'on', c_off: 'off', c_days: '{0} days', c_singles: '≥ {0} singles',
      now: 'just now', min_ago: '{0} min ago', h_ago: '{0} h ago', d_ago: '{0} d ago', dur_h: '{0} h {1} min', dur_m: '{0} min',
      cancel: 'Cancel', confirm: 'Confirm', close: 'Close', reload: 'Reload page', type_to_confirm: 'Type {0} to confirm',
      m_ban16_t: 'Permanently ban {0}?', m_ban16_b: 'This blocks all 65,536 addresses. The block is added as "do not delete", so the deny limit never rotates it out.',
      m_force_t: 'Ban despite the whitelist?', m_force_b: 'This block overlaps a CSF whitelist entry:',
      m_force_n: 'csf.allow addresses still get through a ban; csf.ignore and the others WILL be blocked.',
      m_promote_t: 'Make {0} permanent now?', m_promote_b: 'The block is added to the permanent list as "do not delete" and its promotion record is removed.',
      m_forget_t: 'Remove the promotion record for {0}?', m_forget_b: 'The next group attack from this block counts as a "first time" again and gets a 12-hour temp ban.',
      m_unban_t: 'Remove {0}?', m_unban_b: 'The group ban is removed. The single bans deleted when it was grouped do not come back — these addresses are fully unblocked.',
      m_unban_dnd: 'This block is marked "do not delete". The marker is removed from csf.deny first (a backup is kept).',
      m_ignore_t: 'Ignore {0}?', m_ignore_b: 'The block is hidden from "To review"; for a /16 its warning emails stop too.', m_ignore_d: 'For',
      m_unignore_t: 'Watch {0} again?', m_run_t: 'Run now?',
      m_run_b: 'Does exactly what cron would: /24s over the threshold get banned and emails are sent.',
      m_dry_t: 'Dry run', m_dry_wait: 'Simulating a run without changing anything…', m_dry_none: 'This run would not change anything.',
      m_upd_t: 'Update to v{0}?', m_upd_b: 'Runs update.sh; config.env and records are kept. Takes a few seconds.',
      m_upd_run: 'Updating…', m_upd_ok: 'Update complete.', m_upd_fail: 'The update did not complete; see the output.',
      t_started: 'Run started.', t_done: 'Run finished.', t_busy: 'Another run is in progress, try again shortly.',
      t_err: 'Could not complete: {0}', session: 'Session expired. Reload the page.', t_copied: 'Copied.',
      l_host: 'Hostname', l_fwd: 'forward-confirmed', l_nofwd: 'not forward-confirmed', l_noptr: 'No reverse DNS',
      l_owner: 'Owner', l_prefix: 'Announced prefix', l_reg: 'Registry', l_fw: 'Firewall', l_wl: 'Whitelist',
      l_pending: 'Pending promotion', l_ign: 'Ignored', l_notbanned: 'Not blocked', l_none: 'None', l_perm_single: 'Permanent (single)',
      l_perm_cover: 'Permanent (block)', l_temp: 'Temp', l_nolookup: 'Owner and hostname lookups are off (LOOKUP=0).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Copy', bad_ip: 'Enter a valid IPv4 address.',
      foot: 'CSF Auto-Group v{0} · signed in as {1}'
    }
  };
  function t(k) {
    var s = (DICT[LANG] && DICT[LANG][k] !== undefined) ? DICT[LANG][k] : (DICT.en[k] !== undefined ? DICT.en[k] : k);
    for (var i = 1; i < arguments.length; i++) { s = s.split('{' + (i - 1) + '}').join(arguments[i]); }
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Number(n || 0).toLocaleString(LANG === 'tr' ? 'tr-TR' : 'en-US'); }
  function nowSec() { return Date.now() / 1000 + CLOCK; }
  function rel(ts) {
    var d = Math.max(0, nowSec() - ts);
    if (d < 60) return t('now');
    if (d < 3600) return t('min_ago', Math.floor(d / 60));
    if (d < 86400) return t('h_ago', Math.floor(d / 3600));
    return t('d_ago', Math.floor(d / 86400));
  }
  function stamp(ts) {
    var d = new Date(ts * 1000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dur(s) {
    s = Math.max(0, s | 0);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? t('dur_h', h, m) : t('dur_m', m);
  }
  function pfx(cidr) { return String(cidr).replace(/\.0\/24$/, '').replace(/\.0\.0\/16$/, ''); }

  /* ── API ───────────────────────────────────────────────────────── */
  function api(a, params) {
    var body = new URLSearchParams();
    body.set('a', a); body.set('csrf', BOOT.csrf || '');
    Object.keys(params || {}).forEach(function (k) { body.set(k, params[k]); });
    return fetch('api.php', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
    }).then(function (r) {
      return r.json().catch(function () { throw new Error('HTTP ' + r.status); });
    }).then(function (j) {
      if (j && j.error === 'session') { toast(t('session'), 'bad'); throw new Error('session'); }
      return j;
    });
  }

  /* ── Sahip bilgisi: olay kaydından, blok başına en yeni ───────── */
  var OWNERS = {};
  function indexOwners() {
    OWNERS = {};
    (S.events || []).forEach(function (e) {
      if (e.cidr && e.owner) OWNERS[e.cidr] = { owner: e.owner, asn: e.asn, cc: e.cc, ev: e };
      if (e.cidr && e.ips && !OWNERS[e.cidr]) OWNERS[e.cidr] = { owner: '', ev: e };
      else if (e.cidr && e.ips && OWNERS[e.cidr]) OWNERS[e.cidr].ev = e;
    });
  }
  function ownerOfIps(ips) {       // /16 uyarısı: IP'lerin çoğunluk sahibi
    var c = {}, best = null;
    (ips || []).forEach(function (i) { if (i.owner) { c[i.owner] = (c[i.owner] || 0) + 1; if (!best || c[i.owner] > c[best]) best = i.owner; } });
    var n = Object.keys(c).length;
    return best ? best + (n > 1 ? ' +' + (n - 1) : '') : '';
  }

  /* ── Parçalar ──────────────────────────────────────────────────── */
  function empty(icon, text) { return '<div class="ag-empty">' + (IC[icon] || '') + esc(text) + '</div>'; }

  function head() {
    var lr = S.last_run, run = S.running;
    var sub = run ? '<span class="ag-dot run"></span>' + t('running')
      : '<span class="ag-dot"></span>' + t('idle') + ' · ' + (lr ? t('last_run', rel(lr.t)) : t('no_run'));
    return '<div class="ag-head"><div class="ag-mark">' + IC.shield + '</div>' +
      '<div class="ag-title"><h1>CSF Auto-Group</h1><div class="ag-sub">' + sub + '</div></div>' +
      '<div class="ag-head-actions">' +
      (run || UI.ranOnce ? '<button class="ag-btn ag-btn-ghost" data-act="runlog">' + IC.terminal + t('run_log') + '</button>' : '') +
      '<button class="ag-btn" data-act="dry">' + IC.eye + t('dry') + '</button>' +
      '<button class="ag-btn ag-btn-primary" data-act="run"' + (run ? ' disabled' : '') + '>' + IC.play + t('run') + '</button>' +
      '</div></div>';
  }

  function banner() {
    if (!UPD || !UPD.ok || UPD.uptodate) return '';
    var blocked = UPD.dirty ? t('upd_dirty') : (UPD.diverged ? t('upd_diverged') : '');
    var list = UI.commits ? '<ul class="ag-commits">' + (UPD.commits || []).map(function (c) {
      return '<li><code>' + esc(c.hash) + '</code>' + esc(c.subject) + '</li>';
    }).join('') + '</ul>' : '';
    return '<div class="ag-banner">' + IC.download +
      '<div class="ag-grow">' + t('upd_avail', esc(UPD.current), esc(UPD.latest)) + ' · ' + t('upd_commits', (UPD.commits || []).length) +
      (blocked ? '<div class="ag-sub" style="color:#92400e">' + esc(blocked) + '</div>' : '') + '</div>' +
      '<button class="ag-btn ag-btn-sm" data-act="commits">' + (UI.commits ? t('upd_hide') : t('upd_show')) + '</button>' +
      (blocked ? '' : '<button class="ag-btn ag-btn-sm ag-btn-primary" data-act="update">' + t('upd_apply') + '</button>') +
      list + '</div>';
  }

  function usageKpi(label, pair) {
    var used = pair[0], lim = pair[1], pct = lim > 0 ? Math.round(used * 100 / lim) : 0;
    var cls = pct >= 90 ? 'bad' : (pct >= 80 ? 'warn' : '');
    return '<div class="ag-kpi"><div class="ag-kpi-l">' + esc(label) + '</div>' +
      '<div class="ag-kpi-v">' + (lim > 0 ? '%' + pct : num(used)) + '</div>' +
      '<div class="ag-kpi-m">' + (lim > 0 ? t('k_lines', num(used), num(lim)) : t('k_nolimit')) + '</div>' +
      '<div class="ag-bar"><i class="' + cls + '" style="width:' + Math.min(100, pct) + '%"></i></div></div>';
  }
  function kpis() {
    var dnd = S.groups.filter(function (g) { return g.dnd; }).length, rv = S.review.length;
    return '<div class="ag-kpis">' + usageKpi(t('k_perm'), S.usage.perm) + usageKpi(t('k_temp'), S.usage.temp) +
      '<div class="ag-kpi"><div class="ag-kpi-l">' + t('k_groups') + '</div><div class="ag-kpi-v">' + num(S.groups.length) + '</div>' +
      '<div class="ag-kpi-m">' + t('k_dnd', num(dnd)) + '</div></div>' +
      '<div class="ag-kpi"><div class="ag-kpi-l">' + t('k_review') + '</div><div class="ag-kpi-v' + (rv ? ' warn' : '') + '">' + num(rv) + '</div>' +
      '<div class="ag-kpi-m">' + t('k_review_m', S.config.review_days) + '</div></div></div>';
  }

  function ipTable(ips, total) {
    if (!ips || !ips.length) return '';
    var rows = ips.map(function (i) {
      var own = i.owner ? esc(i.owner) : (i.res === 'kept' ? '<span class="ag-pill ag-pill-n">do not delete</span>' : '');
      return '<div class="ag-ip"><span class="ag-mono" data-ip="' + esc(i.ip) + '">' + esc(i.ip) + '</span>' +
        '<span title="' + esc(i.host) + '">' + (i.host ? esc(i.host) : '<span class="ag-muted">—</span>') + '</span>' +
        '<span class="ag-muted" title="' + esc(i.owner || '') + '">' + own + '</span>' +
        '<span class="ag-muted" title="' + esc(i.why) + '">' + esc(i.why) + '</span></div>';
    }).join('');
    var more = total && total > ips.length ? '<div class="ag-ip-more">' + t('and_more', total - ips.length) + '</div>' : '';
    return '<div class="ag-ips">' + rows + more + '</div>';
  }

  function review() {
    var items = S.review.map(function (e) {
      var key = 'r:' + e.cidr, open = UI.open[key], is16 = /\/16$/.test(e.cidr);
      var pill = e.type === 'skip_wl' ? '<span class="ag-pill ag-pill-info">' + t('ev_skip_wl') + '</span>'
        : '<span class="ag-pill ag-pill-warn">' + t('ev_' + e.type) + '</span>';
      var meta = is16 ? [t('n_ip', num(e.n)), t('n_subnets', num(e.subnets))] : [t('n_ip', num(e.n))];
      var owner = e.owner || ownerOfIps(e.ips);
      if (owner) meta.push(esc(owner));
      if (e.wl) meta.push(esc(t('wl', e.wl)));
      var first = e.ips && e.ips[0] ? e.ips[0].ip : '';
      var acts = '<button class="ag-btn ag-btn-sm" data-act="toggle" data-key="' + key + '">' + (open ? t('hide') : t('ips')) + '</button>';
      if (is16) acts += '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="ban16" data-t="' + esc(pfx(e.cidr)) + '">' + t('ban16') + '</button>';
      else acts += '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="banforce" data-t="' + esc(pfx(e.cidr)) + '" data-wl="' + esc(e.wl || '') + '">' + t('ban_anyway') + '</button>';
      acts += '<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="ignore" data-c="' + esc(e.cidr) + '">' + IC.mute + t('ignore') + '</button>';
      return '<div class="ag-item"><div class="ag-row">' + pill +
        '<div class="ag-row-main"><div class="ag-row-t"><span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(e.cidr) + '</span></div>' +
        '<div class="ag-row-s">' + meta.join(' · ') + '</div></div>' +
        '<div class="ag-row-x">' + rel(e.t) + '</div><div class="ag-row-a">' + acts + '</div></div>' +
        (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.alert + t('s_review') + '</h2>' +
      '<span class="ag-count' + (S.review.length ? ' warn' : '') + '">' + S.review.length + '</span>' +
      '<span class="ag-hint">' + t('s_review_h') + '</span></div>' +
      '<div class="ag-card-b">' + (items || empty('check', t('no_review'))) + '</div></section>';
  }

  function groupMatches(g) {
    var f = UI.gf;
    if (f === 'perm' && !(g.kind === 'perm' || g.kind === 'promoted')) return false;
    if (f === 'dnd' && !g.dnd) return false;
    if (f === 'temp' && g.kind !== 'temp') return false;
    if (f === 'manual' && g.kind !== 'manual') return false;
    if (UI.gq) {
      var o = OWNERS[g.cidr] || {}, hay = (g.cidr + ' ' + (o.owner || '') + ' AS' + (o.asn || '')).toLowerCase();
      if (hay.indexOf(UI.gq.toLowerCase()) < 0) return false;
    }
    return true;
  }
  function groupRows() {
    var list = S.groups.slice().sort(function (a, b) { return (b.added || 0) - (a.added || 0); }).filter(groupMatches);
    if (!list.length) return empty('inbox', S.groups.length ? t('no_match') : t('no_groups'));
    var shown = list.slice(0, UI.gLimit);
    var html = shown.map(function (g) {
      var o = OWNERS[g.cidr] || {}, key = 'g:' + g.cidr, open = UI.open[key], ev = o.ev;
      var kindCls = { perm: 'ag-pill-n', promoted: 'ag-pill-acc', temp: 'ag-pill-warn', manual: 'ag-pill-bad' }[g.kind] || 'ag-pill-n';
      var meta = [];
      if (o.owner) meta.push(esc(o.owner));
      if (g.n) meta.push(t('n_singles', num(g.n)));
      if (g.kind === 'temp') meta.push(t('ttl_left', dur(g.ttl)));
      else if (g.added) meta.push(rel(g.added));
      var first = ev && ev.ips && ev.ips[0] ? ev.ips[0].ip : g.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
      var acts = (ev && ev.ips && ev.ips.length ? '<button class="ag-btn ag-btn-sm" data-act="toggle" data-key="' + key + '">' + (open ? t('hide') : t('ips')) + '</button>' : '') +
        '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="unban" data-c="' + esc(g.cidr) + '" data-dnd="' + (g.dnd ? 1 : 0) + '" data-kind="' + esc(g.kind) + '">' + t('unban') + '</button>';
      return '<div class="ag-item"><div class="ag-row"><div class="ag-row-main"><div class="ag-row-t">' +
        '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(g.cidr) + '</span>' +
        '<span class="ag-pill ' + kindCls + '">' + t('kind_' + g.kind) + '</span>' +
        (g.dnd ? '<span class="ag-pill ag-pill-bad">do not delete</span>' : '') + '</div>' +
        '<div class="ag-row-s">' + meta.join(' · ') + '</div></div><div class="ag-row-a">' + acts + '</div></div>' +
        (open && ev ? ipTable(ev.ips, ev.total) : '') + '</div>';
    }).join('');
    if (list.length > shown.length) html += '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="gall">' + t('show_all', num(list.length)) + '</button></div>';
    return html;
  }
  function groups() {
    var chips = ['all', 'perm', 'dnd', 'temp', 'manual'].map(function (f) {
      return '<button class="ag-chip' + (UI.gf === f ? ' on' : '') + '" data-act="gf" data-f="' + f + '">' + t('f_' + f) + '</button>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.ban + t('s_groups') + '</h2>' +
      '<span class="ag-count">' + S.groups.length + '</span><div class="ag-tools"><div class="ag-chips">' + chips + '</div>' +
      '<input class="ag-input" id="ag-gq" type="search" placeholder="' + esc(t('g_search')) + '" value="' + esc(UI.gq) + '" style="width:190px"></div></div>' +
      '<div class="ag-card-b" id="ag-groups-b">' + groupRows() + '</div></section>';
  }

  var EV_CLASS = {
    add24: 'ag-pill-ok', promote: 'ag-pill-acc', temp24: 'ag-pill-warn', skip_wl: 'ag-pill-info', warn16: 'ag-pill-warn',
    warn16t: 'ag-pill-warn', clean_temp: 'ag-pill-n', manual_ban: 'ag-pill-bad', manual_unban: 'ag-pill-n',
    manual_forget: 'ag-pill-n', manual_ignore: 'ag-pill-n', manual_unignore: 'ag-pill-n'
  };
  var EV_GROUP = {
    bans: ['add24', 'promote', 'temp24', 'manual_ban'], warn: ['warn16', 'warn16t'], skip: ['skip_wl'],
    manual: ['manual_ban', 'manual_unban', 'manual_forget', 'manual_ignore', 'manual_unignore'], clean: ['clean_temp']
  };
  function evDetail(e) {
    var d = [];
    if (e.type === 'add24' || e.type === 'promote' || e.type === 'temp24') {
      d.push(t('n_ip', num(e.n)));
      if (e.dnd) d.push('do not delete');
    }
    if (e.type === 'warn16' || e.type === 'warn16t') d.push(t('n_ip', num(e.n)), t('n_subnets', num(e.subnets)));
    if (e.type === 'skip_wl') { d.push(t('n_ip', num(e.n))); if (e.wl) d.push(t('wl', e.wl)); }
    var owner = e.owner || ownerOfIps(e.ips);
    if (owner) d.push(owner);
    if (e.by) d.push(t('by', e.by));
    if (e.until) d.push(t('until', e.until));
    return esc(d.join(' · '));
  }
  function events() {
    var all = (S.events || []).slice().reverse();
    var list = UI.ef === 'all' ? all : all.filter(function (e) { return EV_GROUP[UI.ef].indexOf(e.type) >= 0; });
    var shown = list.slice(0, UI.evLimit);
    var opts = ['all', 'bans', 'warn', 'skip', 'manual', 'clean'].map(function (f) {
      return '<option value="' + f + '"' + (UI.ef === f ? ' selected' : '') + '>' + t('e_' + f) + '</option>';
    }).join('');
    var rows = shown.map(function (e, i) {
      var key = 'e:' + e.t + ':' + e.type + ':' + (e.cidr || i), open = UI.open[key], has = e.ips && e.ips.length;
      return '<div class="ag-item"><div class="ag-ev' + (has ? ' clickable" data-act="toggle" data-key="' + esc(key) : '') + '">' +
        '<div class="ag-ev-time" title="' + esc(new Date(e.t * 1000).toLocaleString()) + '">' + stamp(e.t) + '</div>' +
        '<div class="ag-ev-b"><div class="ag-ev-t"><span class="ag-pill ' + (EV_CLASS[e.type] || 'ag-pill-n') + '">' + esc(t('ev_' + e.type)) + '</span>' +
        (e.cidr ? '<span class="ag-mono" style="font-weight:600">' + esc(e.cidr) + '</span>' : '') + '</div>' +
        '<div class="ag-ev-d">' + evDetail(e) + '</div></div></div>' + (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }).join('');
    var more = list.length > shown.length ? '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="evmore">' + t('more') + '</button></div>' : '';
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.list + t('s_events') + '</h2>' +
      '<div class="ag-tools"><select class="ag-input" id="ag-ef" style="width:160px">' + opts + '</select></div></div>' +
      '<div class="ag-card-b">' + (rows || empty('inbox', all.length ? t('no_match') : t('no_events'))) + '</div>' + more + '</section>';
  }

  function lookupCard() {
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.search + t('s_lookup') + '</h2></div>' +
      '<div class="ag-lookup"><form id="ag-lk"><input class="ag-input ag-mono" id="ag-lk-ip" inputmode="decimal" autocomplete="off" placeholder="' + esc(t('lookup_ph')) + '">' +
      '<button class="ag-btn ag-btn-primary" type="submit">' + t('lookup_btn') + '</button></form><p>' + t('lookup_hint') + '</p></div></section>';
  }

  function pending() {
    var rows = S.pending.map(function (p) {
      var cidr = p.prefix + '.0/24', o = OWNERS[cidr] || {}, ev = o.ev;
      var left = Math.max(0, p.days_left), pct = Math.max(0, Math.min(100, left * 100 / (S.config.retention || 180)));
      var first = ev && ev.ips && ev.ips[0] ? ev.ips[0].ip : p.prefix + '.1';
      var meta = [];
      if (o.owner) meta.push(esc(o.owner));
      meta.push(t('since', esc(p.since)));
      return '<div class="ag-row"><div class="ag-row-main"><div class="ag-row-t"><span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(cidr) + '</span>' +
        (p.temp_ttl > 0 ? '<span class="ag-pill ag-pill-warn">' + t('ttl_left', dur(p.temp_ttl)) + '</span>' : '') + '</div>' +
        '<div class="ag-row-s">' + meta.join(' · ') + '</div>' +
        '<div class="ag-sub" style="margin-top:4px;display:flex;gap:8px;align-items:center"><div class="ag-days"><i style="width:' + pct + '%"></i></div>' + t('days_left', left) + '</div></div>' +
        '<div class="ag-row-a" style="flex-direction:column;align-items:stretch">' +
        '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="promote" data-t="' + esc(p.prefix) + '">' + t('promote') + '</button>' +
        '<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="forget" data-t="' + esc(p.prefix) + '">' + t('forget') + '</button></div></div>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.hour + t('s_pending') + '</h2><span class="ag-count">' + S.pending.length + '</span>' +
      '<span class="ag-hint" style="width:100%">' + t('s_pending_h') + '</span></div>' +
      '<div class="ag-card-b">' + (rows || empty('check', t('no_pending'))) + '</div></section>';
  }

  function ignored() {
    if (!S.ignored.length) return '';
    var rows = S.ignored.map(function (g) {
      return '<div class="ag-row"><div class="ag-row-main"><div class="ag-row-t"><span class="ag-mono" style="font-weight:600">' + esc(g.cidr) + '</span></div>' +
        '<div class="ag-row-s">' + t('until', esc(g.until)) + ' · ' + t('by', esc(g.by)) + '</div></div>' +
        '<div class="ag-row-a"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="unignore" data-c="' + esc(g.cidr) + '">' + t('unignore') + '</button></div></div>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.mute + t('s_ignored') + '</h2><span class="ag-count">' + S.ignored.length + '</span></div>' +
      '<div class="ag-card-b">' + rows + '</div></section>';
  }

  function config() {
    var c = S.config;
    function kv(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'; }
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.sliders + t('s_config') + '</h2></div><dl class="ag-kv">' +
      kv(t('c_t24'), t('c_singles', c.t24)) + kv(t('c_t24p'), t('c_singles', c.t24p)) + kv(t('c_t16'), t('c_singles', c.t16)) +
      kv(t('c_tt24'), t('c_singles', c.tt24)) + kv(t('c_tt16'), t('c_singles', c.tt16)) + kv(t('c_ret'), t('c_days', c.retention)) +
      kv(t('c_lookup'), c.lookup ? t('c_on') : t('c_off')) + '</dl></section>';
  }

  function render() {
    if (!S) return;
    indexOwners();
    var y = window.scrollY;
    $app.innerHTML = '<div class="ag-wrap">' + head() + banner() + kpis() +
      '<div class="ag-grid"><div class="ag-col">' + review() + groups() + events() + '</div>' +
      '<div class="ag-col">' + lookupCard() + pending() + ignored() + config() + '</div></div>' +
      '<div class="ag-foot">' + esc(t('foot', S.version + (BOOT.commit ? ' (' + BOOT.commit + ')' : ''), BOOT.user || 'root')) + '</div></div>';
    $app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, y);
  }

  /* ── Durum / yoklama ───────────────────────────────────────────── */
  function refresh() {
    return api('status').then(function (d) {
      if (!d || d.ok === false) { throw new Error((d && (d.message || d.error)) || 'status'); }
      S = d; LANG = d.lang === 'tr' ? 'tr' : 'en'; CLOCK = d.now - Date.now() / 1000;
      document.documentElement.lang = LANG;
      if (wasRunning && !d.running) toast(t('t_done'), 'ok');
      wasRunning = d.running;
      schedule(d.running ? 3000 : 60000);
      if (!busy) render();
    }).catch(function (e) {
      if (!S) $app.innerHTML = '<div class="ag-wrap">' + empty('alert', String(e.message || e)) + '</div>';
      schedule(60000);
    });
  }
  function schedule(ms) { clearTimeout(pollTimer); pollTimer = setTimeout(refresh, ms); }

  /* ── Toast ─────────────────────────────────────────────────────── */
  var $toasts = null;
  function toast(msg, kind) {
    if (!$toasts) { $toasts = document.createElement('div'); $toasts.className = 'ag-toasts'; document.body.appendChild($toasts); }
    var el = document.createElement('div');
    el.className = 'ag-toast ' + (kind || 'ok');
    el.innerHTML = (kind === 'bad' ? IC.alert : IC.check) + '<div>' + esc(msg) + '</div>';
    $toasts.appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'bad' ? 7000 : 3500);
  }

  /* ── Modal ─────────────────────────────────────────────────────── */
  var layerStack = [];
  function closeTop() { var l = layerStack.pop(); if (l) l(); }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && layerStack.length) closeTop(); });

  /* opts: {icon, tone, title, html, typed, days, okText, okClass, wide, noCancel} → Promise<{ok, days}> */
  function modal(opts) {
    return new Promise(function (resolve) {
      var scrim = document.createElement('div'); scrim.className = 'ag-scrim';
      var wrap = document.createElement('div'); wrap.className = 'ag-modal-wrap ag-app'; wrap.style.cssText = 'background:transparent;margin:0;padding:20px;min-height:0';
      var days = opts.days ? '<label>' + t('m_ignore_d') + '</label><div class="ag-chips" id="ag-days">' + [7, 30, 90].map(function (d, i) {
        return '<button type="button" class="ag-chip' + (i === 1 ? ' on' : '') + '" data-d="' + d + '">' + t('c_days', d) + '</button>';
      }).join('') + '</div>' : '';
      var typed = opts.typed ? '<label>' + t('type_to_confirm', '<span class="ag-target">' + esc(opts.typed) + '</span>') + '</label>' +
        '<input class="ag-input ag-mono" id="ag-typed" autocomplete="off" spellcheck="false">' : '';
      wrap.innerHTML = '<div class="ag-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' +
        '<div class="ag-modal-h">' + (opts.icon ? '<div class="ag-modal-ic ' + (opts.tone || 'acc') + '">' + IC[opts.icon] + '</div>' : '') +
        '<h3 style="padding-top:' + (opts.icon ? '7px' : '0') + '">' + opts.title + '</h3></div>' +
        '<div class="ag-modal-b">' + (opts.html || '') + days + typed + '</div>' +
        '<div class="ag-modal-f">' + (opts.noCancel ? '' : '<button class="ag-btn" data-m="no">' + (opts.cancelText || t('cancel')) + '</button>') +
        (opts.okText === null ? '' : '<button class="ag-btn ' + (opts.okClass || 'ag-btn-primary') + '" data-m="ok">' + (opts.okText || t('confirm')) + '</button>') + '</div></div>';
      document.body.appendChild(scrim); document.body.appendChild(wrap);
      var ok = wrap.querySelector('[data-m="ok"]'), inp = wrap.querySelector('#ag-typed'), chosen = 30;
      if (inp && ok) { ok.disabled = true; inp.addEventListener('input', function () { ok.disabled = inp.value.trim() !== opts.typed; }); setTimeout(function () { inp.focus(); }, 30); }
      else if (ok) setTimeout(function () { ok.focus(); }, 30);
      var dz = wrap.querySelector('#ag-days');
      if (dz) dz.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-d]'); if (!b) return;
        chosen = +b.getAttribute('data-d');
        dz.querySelectorAll('.ag-chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      });
      function done(v) { scrim.remove(); wrap.remove(); var i = layerStack.indexOf(cancel); if (i >= 0) layerStack.splice(i, 1); resolve({ ok: v, days: chosen, el: wrap }); }
      function cancel() { done(false); }
      layerStack.push(cancel);
      wrap.addEventListener('click', function (ev) {
        var m = ev.target.closest('[data-m]');
        if (m) { if (m.getAttribute('data-m') === 'ok' && !m.disabled) done(true); else if (m.getAttribute('data-m') === 'no') done(false); }
        else if (ev.target === wrap) done(false);
      });
      if (opts.onOpen) opts.onOpen(wrap, done);
    });
  }

  /* ── İşlemler ──────────────────────────────────────────────────── */
  function doAction(name, target, extra) {
    var p = { name: name, target: target, confirm: target };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    busy = true;
    return api('action', p).then(function (r) {
      busy = false;
      if (r.ok) { toast(r.message, 'ok'); refresh(); return r; }
      if (r.code === 3) toast(t('t_busy'), 'bad');
      else if (r.code !== 4) toast(t('t_err', r.message || r.error || '?'), 'bad');
      return r;
    }).catch(function (e) { busy = false; toast(t('t_err', e.message), 'bad'); return { ok: false }; });
  }
  function forceBan(bits, target, cidr, wl) {
    return modal({
      icon: 'alert', tone: 'bad', title: t('m_force_t'), typed: cidr, okText: t('ban_anyway'), okClass: 'ag-btn-danger-solid',
      html: '<p>' + t('m_force_b') + '</p><div class="ag-warnbox">' + esc(wl) + '</div><p>' + t('m_force_n') + '</p>'
    }).then(function (m) { if (m.ok) return doAction('ban' + bits, target, { force: '1' }); });
  }
  function banFlow(bits, target, title, body, typed) {
    var cidr = bits === 16 ? target + '.0.0/16' : target + '.0/24';
    return modal({ icon: 'ban', tone: 'bad', title: title, html: '<p>' + body + '</p>', typed: typed ? cidr : null, okText: t('confirm'), okClass: 'ag-btn-danger-solid' })
      .then(function (m) {
        if (!m.ok) return;
        return doAction('ban' + bits, target).then(function (r) {
          if (r && r.code === 4) return forceBan(bits, target, cidr, r.message);
        });
      });
  }

  var ACTIONS = {
    toggle: function (el) { var k = el.getAttribute('data-key'); UI.open[k] = !UI.open[k]; render(); },
    gf: function (el) { UI.gf = el.getAttribute('data-f'); UI.gLimit = 40; render(); },
    gall: function () { UI.gLimit = 1e6; render(); },
    evmore: function () { UI.evLimit += 60; render(); },
    commits: function () { UI.commits = !UI.commits; render(); },
    ban16: function (el) {
      var tg = el.getAttribute('data-t');
      banFlow(16, tg, t('m_ban16_t', '<span class="ag-mono">' + esc(tg) + '.0.0/16</span>'), t('m_ban16_b'), true);
    },
    banforce: function (el) {
      var tg = el.getAttribute('data-t');
      forceBan(24, tg, tg + '.0/24', el.getAttribute('data-wl') || '');
    },
    promote: function (el) {
      var tg = el.getAttribute('data-t');
      banFlow(24, tg, t('m_promote_t', '<span class="ag-mono">' + esc(tg) + '.0/24</span>'), t('m_promote_b'), false);
    },
    forget: function (el) {
      var tg = el.getAttribute('data-t');
      modal({ icon: 'hour', tone: 'warn', title: t('m_forget_t', '<span class="ag-mono">' + esc(tg) + '.0/24</span>'), html: '<p>' + t('m_forget_b') + '</p>', okText: t('forget') })
        .then(function (m) { if (m.ok) doAction('forget', tg); });
    },
    unban: function (el) {
      var c = el.getAttribute('data-c'), dnd = el.getAttribute('data-dnd') === '1', kind = el.getAttribute('data-kind');
      modal({
        icon: 'alert', tone: 'bad', title: t('m_unban_t', '<span class="ag-mono">' + esc(c) + '</span>'),
        html: '<p>' + t('m_unban_b') + '</p>' + (dnd ? '<div class="ag-warnbox">' + t('m_unban_dnd') + '</div>' : ''),
        typed: dnd || kind === 'manual' ? c : null, okText: t('unban'), okClass: 'ag-btn-danger-solid'
      }).then(function (m) { if (m.ok) doAction('unban', c); });
    },
    ignore: function (el) {
      var c = el.getAttribute('data-c');
      modal({ icon: 'mute', tone: 'acc', title: t('m_ignore_t', '<span class="ag-mono">' + esc(c) + '</span>'), html: '<p>' + t('m_ignore_b') + '</p>', days: true, okText: t('ignore') })
        .then(function (m) { if (m.ok) doAction('ignore', c, { days: String(m.days) }); });
    },
    unignore: function (el) {
      var c = el.getAttribute('data-c');
      modal({ title: t('m_unignore_t', '<span class="ag-mono">' + esc(c) + '</span>'), okText: t('confirm') })
        .then(function (m) { if (m.ok) doAction('unignore', c); });
    },
    run: function () {
      modal({ icon: 'play', tone: 'acc', title: t('m_run_t'), html: '<p>' + t('m_run_b') + '</p>', okText: t('run') }).then(function (m) {
        if (!m.ok) return;
        api('run_now').then(function (r) {
          if (!r.ok) { toast(t('t_err', r.error || '?'), 'bad'); return; }
          UI.ranOnce = true; wasRunning = true; toast(t('t_started'), 'ok');
          setTimeout(refresh, 1200);
        });
      });
    },
    runlog: function () {
      var timer = null;
      modal({
        icon: 'terminal', tone: 'acc', title: t('run_log'), wide: true, okText: null, cancelText: t('close'),
        html: '<pre class="ag-out" id="ag-rl"><span class="ag-spin ag-spin-sm"></span></pre>',
        onOpen: function (wrap) {
          function pull() {
            api('run_log').then(function (r) {
              var pre = wrap.querySelector('#ag-rl'); if (!pre) return;
              pre.innerHTML = colorize(r.log || '');
              pre.scrollTop = pre.scrollHeight;
              if (S && S.running) timer = setTimeout(pull, 2000);
            });
          }
          pull();
        }
      }).then(function () { clearTimeout(timer); });
    },
    dry: function () {
      modal({
        icon: 'eye', tone: 'acc', title: t('m_dry_t'), wide: true, okText: null, cancelText: t('close'),
        html: '<pre class="ag-out" id="ag-dry"><span class="ag-spin ag-spin-sm"></span>  ' + esc(t('m_dry_wait')) + '</pre>',
        onOpen: function (wrap) {
          api('dry_run').then(function (r) {
            var pre = wrap.querySelector('#ag-dry'); if (!pre) return;
            var out = r.output || r.message || r.error || '';
            pre.innerHTML = colorize(out) + (/\[dry-run\]|\[gönderilmeyecek|\[email not sent/.test(out) ? '' : '\n<span class="q">' + esc(t('m_dry_none')) + '</span>');
          }).catch(function (e) { var pre = wrap.querySelector('#ag-dry'); if (pre) pre.textContent = e.message; });
        }
      });
    },
    update: function () {
      if (!UPD) return;
      modal({ icon: 'download', tone: 'acc', title: t('m_upd_t', esc(UPD.latest)), html: '<p>' + t('m_upd_b') + '</p>', okText: t('upd_apply') }).then(function (m) {
        if (!m.ok) return;
        api('update_apply', { confirm: UPD.latest_commit }).then(function (r) {
          if (!r.ok) { toast(t('t_err', r.error || '?'), 'bad'); return; }
          var timer = null, finished = false;
          modal({
            icon: 'download', tone: 'acc', title: t('m_upd_run'), wide: true, okText: t('reload'), noCancel: true,
            html: '<pre class="ag-out" id="ag-up"><span class="ag-spin ag-spin-sm"></span></pre><p id="ag-up-st" class="ag-sub" style="margin-top:10px"></p>',
            onOpen: function (wrap) {
              var okb = wrap.querySelector('[data-m="ok"]'); okb.disabled = true;
              function pull() {
                api('update_log').then(function (u) {
                  var pre = wrap.querySelector('#ag-up'); if (!pre) return;
                  var log = u.log || '', mm = log.match(/AG-UPDATE-RESULT: (\d+)/);
                  pre.innerHTML = colorize(log.replace(/^AG-UPDATE-RESULT:.*$/m, '')); pre.scrollTop = pre.scrollHeight;
                  if (mm) {
                    finished = true; okb.disabled = false;
                    wrap.querySelector('#ag-up-st').textContent = mm[1] === '0' ? t('m_upd_ok') : t('m_upd_fail');
                  } else timer = setTimeout(pull, 1500);
                }).catch(function () { timer = setTimeout(pull, 2500); });   // güncelleme sırasında cpsrvd yeniden başlayabilir
              }
              pull();
            }
          }).then(function () { clearTimeout(timer); if (finished) location.reload(); });
        });
      });
    }
  };

  function colorize(txt) {
    return esc(txt).split('\n').map(function (l) {
      if (/\[dry-run\]/.test(l)) return '<span class="d">' + l + '</span>';
      if (/^\s*│/.test(l)) return '<span class="q">' + l + '</span>';
      if (/(\[gönderilmeyecek mail\]|\[email not sent\])/.test(l)) return '<span class="m">' + l + '</span>';
      return l;
    }).join('\n');
  }

  /* ── IP kartı (sağ panel) ──────────────────────────────────────── */
  function fact(label, value) { return value ? '<div class="ag-fact"><div class="ag-fact-l">' + esc(label) + '</div><div class="ag-fact-v">' + value + '</div></div>' : ''; }
  function openDrawer(ip) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast(t('bad_ip'), 'bad'); return; }
    var scrim = document.createElement('div'); scrim.className = 'ag-scrim';
    var dr = document.createElement('aside'); dr.className = 'ag-drawer ag-app'; dr.style.cssText = 'margin:0;padding:0;min-height:0;background:#fff';
    dr.innerHTML = '<div class="ag-drawer-h"><div><h3>' + esc(ip) + '</h3><div class="ag-sub" id="ag-dr-sub">&nbsp;</div></div>' +
      '<button class="ag-x" data-dr="x" aria-label="' + esc(t('close')) + '">' + IC.x + '</button></div>' +
      '<div class="ag-drawer-b" id="ag-dr-b">' + [1, 2, 3, 4, 5].map(function () {
        return '<div class="ag-fact"><div class="ag-skel" style="width:30%"></div><div class="ag-skel" style="width:75%;margin-top:8px"></div></div>';
      }).join('') + '</div>' +
      '<div class="ag-drawer-f"><a class="ag-btn ag-btn-sm" target="_blank" rel="noopener noreferrer" href="https://www.abuseipdb.com/check/' + encodeURIComponent(ip) + '">' + IC.ext + t('l_abuse') + '</a>' +
      '<span id="ag-dr-bgp"></span><button class="ag-btn ag-btn-sm ag-btn-ghost" data-dr="copy">' + IC.copy + t('l_copy') + '</button></div>';
    document.body.appendChild(scrim); document.body.appendChild(dr);
    function close() { scrim.remove(); dr.remove(); var i = layerStack.indexOf(close); if (i >= 0) layerStack.splice(i, 1); }
    layerStack.push(close);
    scrim.addEventListener('click', close);
    dr.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dr]');
      if (b && b.getAttribute('data-dr') === 'x') close();
      if (b && b.getAttribute('data-dr') === 'copy' && navigator.clipboard) navigator.clipboard.writeText(ip).then(function () { toast(t('t_copied'), 'ok'); });
    });
    api('lookup', { ip: ip }).then(function (d) {
      var body = dr.querySelector('#ag-dr-b'); if (!body) return;
      if (!d.ok) { body.innerHTML = empty('alert', d.error === 'bad_ip' ? t('bad_ip') : (d.error || d.message || '?')); return; }
      var host = d.host ? '<span class="ag-mono">' + esc(d.host) + '</span> <span class="ag-pill ' + (d.fwd ? 'ag-pill-ok' : 'ag-pill-n') + '">' + (d.fwd ? t('l_fwd') : t('l_nofwd')) + '</span>'
        : '<span class="ag-muted">' + t('l_noptr') + '</span>';
      var owner = d.asn ? '<b>AS' + esc(d.asn) + '</b> ' + esc(d.asname || '') : '';
      var fw = [];
      if (d.deny) fw.push('<span class="ag-pill ag-pill-bad">' + t('l_perm_single') + '</span><div class="ag-mono ag-muted" style="margin-top:4px">' + esc(d.deny) + '</div>');
      if (d.cover) fw.push('<span class="ag-pill ag-pill-bad">' + t('l_perm_cover') + '</span><div class="ag-mono ag-muted" style="margin-top:4px">' + esc(d.cover) + '</div>');
      if (d.temp) fw.push('<span class="ag-pill ag-pill-warn">' + t('l_temp') + '</span><div class="ag-mono ag-muted" style="margin-top:4px">' + esc(d.temp) + '</div>');
      var wl = [d.wl, d.rig ? 'csf.rignore: ' + d.rig : ''].filter(Boolean).map(esc).join('<br>');
      body.innerHTML = (d.lookup ? '' : '<div class="ag-fact ag-muted">' + t('l_nolookup') + '</div>') +
        fact(t('l_host'), host) + fact(t('l_owner'), owner) +
        fact(t('l_prefix'), d.pfx ? '<span class="ag-mono">' + esc(d.pfx) + '</span>' + (d.cc ? ' <span class="ag-flag">' + esc(d.cc) + '</span>' : '') : '') +
        fact(t('l_reg'), d.reg ? esc(d.reg) + (d.alloc ? ' · ' + esc(d.alloc) : '') : '') +
        fact(t('l_fw'), fw.length ? fw.join('<div style="height:8px"></div>') : '<span class="ag-pill ag-pill-n">' + t('l_notbanned') + '</span>') +
        fact(t('l_wl'), wl || '<span class="ag-muted">' + t('l_none') + '</span>') +
        fact(t('l_pending'), d.pend ? esc(pfxOf(ip) + '.0/24 · ' + d.pend) : '') + fact(t('l_ign'), d.ign ? esc(d.ign) : '');
      var sub = dr.querySelector('#ag-dr-sub'); if (sub) sub.textContent = d.asn ? ('AS' + d.asn + (d.cc ? ' · ' + d.cc : '')) : '';
      if (d.asn) dr.querySelector('#ag-dr-bgp').innerHTML = '<a class="ag-btn ag-btn-sm" target="_blank" rel="noopener noreferrer" href="https://bgp.he.net/AS' + encodeURIComponent(d.asn) + '">' + IC.ext + t('l_bgp') + '</a>';
    }).catch(function (e) { var body = dr.querySelector('#ag-dr-b'); if (body) body.innerHTML = empty('alert', e.message); });
  }
  function pfxOf(ip) { return ip.split('.').slice(0, 3).join('.'); }

  /* ── Olay bağlama (tek dinleyici) ──────────────────────────────── */
  $app.addEventListener('click', function (ev) {
    var ipEl = ev.target.closest('[data-ip]');
    if (ipEl && ipEl.getAttribute('data-ip')) { ev.preventDefault(); openDrawer(ipEl.getAttribute('data-ip')); return; }
    var el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (fn) { ev.preventDefault(); fn(el); }
  });
  $app.addEventListener('submit', function (ev) {
    if (ev.target.id === 'ag-lk') { ev.preventDefault(); openDrawer((document.getElementById('ag-lk-ip').value || '').trim()); }
  });
  $app.addEventListener('input', function (ev) {
    if (ev.target.id === 'ag-gq') {
      UI.gq = ev.target.value; UI.gLimit = 40;
      var b = document.getElementById('ag-groups-b'); if (b) b.innerHTML = groupRows();
    }
  });
  $app.addEventListener('change', function (ev) {
    if (ev.target.id === 'ag-ef') { UI.ef = ev.target.value; UI.evLimit = 40; render(); }
  });

  /* ── Başlangıç ─────────────────────────────────────────────────── */
  refresh().then(function () {
    api('update_check').then(function (u) { UPD = u; if (u && u.ok && !u.uptodate) render(); }).catch(function () {});
  });
})();
