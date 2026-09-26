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
  var UI = { gf: 'all', gq: '', ef: 'all', open: {}, evLimit: 40, gLimit: 40, commits: false, pAll: false, gs: 'added', gd: -1, gp: 0, menu: null, at: 'atk',
             tab: location.hash === '#settings' ? 'settings' : 'overview' };
  var CFG = null, DRAFT = {}, cfgLoading = false;
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
    terminal: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    bell: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>')
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
      t_started: 'Tur başlatıldı.', t_done: 'Tur tamamlandı.', t_busy: 'Başka bir tur çalışıyor, birazdan tekrar deneyin.', t_cron_busy: 'Bir tur zaten çalışıyor (büyük olasılıkla cron); bitince sonuçlar burada görünecek.',
      t_err: 'İşlem tamamlanamadı: {0}', session: 'Oturum süresi doldu. Sayfayı yenileyin.', t_copied: 'Kopyalandı.',
      l_host: 'Hostname', l_fwd: 'ileri yönde doğrulandı', l_nofwd: 'ileri yönde doğrulanamadı', l_noptr: 'Ters DNS kaydı yok',
      l_owner: 'Sahip', l_prefix: 'Duyurulan blok', l_reg: 'Kayıt', l_fw: 'Güvenlik duvarı', l_wl: 'Beyaz liste',
      l_pending: 'Terfi bekliyor', l_ign: 'Yoksayılıyor', l_notbanned: 'Engelli değil', l_none: 'Yok', l_perm_single: 'Kalıcı (tekil)',
      l_perm_cover: 'Kalıcı (blok)', l_temp: 'Geçici', l_nolookup: 'Sahip ve hostname sorguları kapalı (LOOKUP=0).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Kopyala', bad_ip: 'Geçerli bir IPv4 adresi yazın.',
      foot: 'CSF Auto-Group v{0} · {1} olarak oturum açıldı',
      tab_overview: 'Genel bakış', tab_settings: 'Ayarlar', ev_config: 'Ayar değişti', ev_test_mail: 'Test maili',
      st_notify: 'Bildirim', st_mail: 'Uyarı maili adresi', st_mail_h: 'Gruplama, /16 uyarısı ve limit mailleri buraya gider. root@localhost, cPanel\'de sunucunun iletişim adresine yönlenir.',
      st_lang: 'Dil', st_lang_h: 'Log, mail ve bu panelin dili.', st_test: 'Test maili gönder', st_test_h: 'Kayıtlı adrese gönderilir.',
      st_test_dirty: 'Önce yeni adresi kaydedin.', st_thr: 'Eşikler', st_thr_h: 'Kaç tekil ban bir işlemi tetikler.',
      k_THRESHOLD_24: '/24 grup banı', h_THRESHOLD_24: 'Bir /24 içinde bu kadar kalıcı tekil olunca /24 banlanır.',
      k_THRESHOLD_24_PERMANENT: 'Do not delete eşiği', h_THRESHOLD_24_PERMANENT: 'Bu kadar tekil olunca /24 "do not delete" alır. /24 eşiğinden küçük olamaz.',
      k_THRESHOLD_16: '/16 uyarısı', h_THRESHOLD_16: 'En az 2 farklı /24\'ten bu kadar tekil olunca mail gelir. Otomatik ban yok.',
      k_THRESHOLD_TEMP_24: 'Geçici /24', h_THRESHOLD_TEMP_24: 'Bu kadar geçici tekil: ilk sefer 12 saat geçici ban, ikinci sefer kalıcı.',
      k_THRESHOLD_TEMP_16: 'Geçici /16 uyarısı', h_THRESHOLD_TEMP_16: 'Geçici listedeki /16 yoğunluğu için uyarı eşiği.',
      st_sched: 'Zamanlama', st_sched_h: 'Script\'in cron ile ne sıklıkla çalışacağı.', cron_5: '5 dk', cron_10: '10 dk', cron_15: '15 dk', cron_30: '30 dk', cron_0: 'Saatte bir',
      st_lookup: 'Sorgular', k_LOOKUP: 'Sahip ve hostname sorgusu', h_LOOKUP: 'Mailde ve panelde ASN, kurum ve hostname gösterir; CC_IGNORE ve csf.rignore kontrolleri de buna bağlı.',
      k_LOOKUP_TIMEOUT: 'DNS zaman aşımı (sn)', h_LOOKUP_TIMEOUT: 'Her sorgu için bekleme süresi.', st_nodns: 'Sunucuda dig/host yok; sorgular çalışmaz (dnf install bind-utils).',
      on: 'Açık', off: 'Kapalı', st_keep: 'Saklama', k_SAYAC_RETENTION_DAYS: 'Terfi kaydı saklama (gün)',
      h_SAYAC_RETENTION_DAYS: 'Geçici banlanmış /24 bu süre içinde tekrar gelirse kalıcı olur.', k_REVIEW_DAYS: 'Kontrol edilecekler (gün)',
      h_REVIEW_DAYS: 'Uyarı ve atlamaların listede kaç gün kalacağı.', k_LOG_MAX_LINES: 'Log satır sınırı', h_LOG_MAX_LINES: 'Log bu satır sayısında tutulur.',
      st_csf: 'CSF liste sınırları', st_csf_h: 'Bunlar CSF\'in kendi ayarları; buradan değil CSF\'ten değiştirilir.',
      csf_deny: 'Kalıcı liste (DENY_IP_LIMIT)', csf_temp: 'Geçici liste (DENY_TEMP_IP_LIMIT)', csf_open: 'CSF ayarlarını aç',
      default_v: 'varsayılan {0}', range_v: '{0}–{1} arası bir tam sayı', mail_bad: 'Geçerli bir e-posta adresi yazın.',
      rule_dnd: 'Do not delete eşiği /24 eşiğinden küçük olamaz.', dirty_n: '{0} değişiklik kaydedilmedi', discard: 'Vazgeç',
      try_save: 'Kaydetmeden önce dene', save: 'Kaydet', m_save_t: 'Ayarlar kaydedilsin mi?', m_save_b: 'Şu değişiklikler config.env\'e yazılacak (önce yedek alınır):',
      m_try_t: 'Yeni eşiklerle kuru çalıştırma', m_try_b: 'Kaydedilmemiş ayarlarla; hiçbir şey değişmez.', show_pending_all: 'Tümünü göster ({0})',
      panel_bad: 'https://sunucu:2087 biçiminde yazın.', auto: 'otomatik', focus_gone: '{0} artık listede değil; güncel durumu gösteriliyor.',
      new_badge: 'Son ziyaretinden beri yeni', actions: 'İşlemler', overdue: 'Tur gecikti · son tur {0} (beklenen aralık {1})',
      since_visit: 'Son ziyaretinden beri ({0}):', sn_add: '{0} grup banı', sn_temp: '{0} geçici grup', sn_warn: '{0} /16 uyarısı',
      sn_skip: '{0} beyaz liste atlaması', show_new: 'Göster', e_new: 'Son ziyaretten beri', ch_title: 'Son 30 gün', ch_total: '{0} olay',
      ch_add: 'Grup banı', ch_promote: 'Terfi', ch_temp: 'Geçici', ch_warn: '/16 uyarısı', ch_skip: 'Beyaz liste',
      ch_empty: 'Son 30 günde kayıt yok; grafik olay kaydı biriktikçe dolacak.', ipcard: 'IP kartı', col_block: 'Blok', col_owner: 'Sahip',
      col_singles: 'Tekil', col_added: 'Eklendi', of_n: '{0}–{1} / {2}', s_asn: 'En çok saldıran ağlar',
      s_asn_h: 'Grup banı ve tekil bana göre sıralı; csf.deny\'deki başka kaynaklı bloklar ayrıca belirtilir · {0} bloğun sahibi biliniyor', p_g: '{0} grup', p_b: '+{0} blok başka kaynaklı', p_t: '{0} tekil', p_bn: '{0} blok',
      at_atk: 'Saldıranlar', at_blk: 'Diğer bloklar', blk_h: 'csf.deny\'de CSF Auto-Group dışından eklenmiş aralıklar (elle ya da başka araçla); zaten engelliler.',
      blk_empty: 'csf.deny\'de başka kaynaklı aralık yok (ya da sahipleri henüz bilinmiyor).',
      im_h: 'Imunify360\'ın bu sunucuda kendi engellediği IP\'ler (merkezi liste değil) · {0} IP, {1} tanesinin sahibi biliniyor. Yalnızca bilgi; CSF\'ye ban yazılmaz.',
      im_n: '{0} IP', im_empty: 'Imunify360 yerel kara listesi boş.', asn_denied: 'CSF\'de zaten engelli',
      asn_hint: 'ASN engelleme önerisi', asn_filling: 'Sahip bilgileri toplanıyor; her turda 50 blok sorgulanır.',
      asn_nolookup: 'Sahip sorgusu kapalı (Ayarlar → Sorgular).', m_asn_t: 'AS{0} ağını CSF\'de toptan engellemek',
      m_asn_b: '{1} ağından {0} ayrı /24 grup banı eklendi; her biri aynı blokta en az 3 saldırgan demek. Saldırı sürekli bu ağdan geliyorsa, ağın tamamını CSF\'nin kendi ülke/ASN engeliyle kapatmak daha kalıcı olur.',
      m_asn_w: 'Bu, o ağdaki meşru kullanıcıları da (ör. o sağlayıcıda sunucusu olan müşterileri) engeller. Büyük bulut sağlayıcılarında dikkatli olun.',
      m_asn_s: 'Nasıl: CSF → Firewall Configuration → CC_DENY alanına {0} ekleyin (virgülle ayırarak), kaydedip csf ve lfd\'yi yeniden başlatın. Bu eklenti csf.conf\'u değiştirmez.',
      copy_asn: '{0} kopyala', csf_open2: 'CSF\'yi aç', edit: 'Düzenle', st_digest: 'Haftalık özet',
      st_digest_h: 'Seçilen gün 09:00\'dan sonraki ilk turda gönderilir: yeni gruplar, en çok saldıran ağlar, süresi dolacak terfi kayıtları.',
      st_digest_day: 'Gönderim günü', d1: 'Pzt', d2: 'Sal', d3: 'Çar', d4: 'Per', d5: 'Cum', d6: 'Cmt', d7: 'Paz',
      digest_prev: 'Özeti önizle', m_digest_t: 'Haftalık özet önizlemesi', ev_digest: 'Haftalık özet'
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
      t_started: 'Run started.', t_done: 'Run finished.', t_busy: 'Another run is in progress, try again shortly.', t_cron_busy: 'A run is already in progress (most likely cron); results will show up here when it finishes.',
      t_err: 'Could not complete: {0}', session: 'Session expired. Reload the page.', t_copied: 'Copied.',
      l_host: 'Hostname', l_fwd: 'forward-confirmed', l_nofwd: 'not forward-confirmed', l_noptr: 'No reverse DNS',
      l_owner: 'Owner', l_prefix: 'Announced prefix', l_reg: 'Registry', l_fw: 'Firewall', l_wl: 'Whitelist',
      l_pending: 'Pending promotion', l_ign: 'Ignored', l_notbanned: 'Not blocked', l_none: 'None', l_perm_single: 'Permanent (single)',
      l_perm_cover: 'Permanent (block)', l_temp: 'Temp', l_nolookup: 'Owner and hostname lookups are off (LOOKUP=0).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Copy', bad_ip: 'Enter a valid IPv4 address.',
      foot: 'CSF Auto-Group v{0} · signed in as {1}',
      tab_overview: 'Overview', tab_settings: 'Settings', ev_config: 'Settings changed', ev_test_mail: 'Test email',
      st_notify: 'Notifications', st_mail: 'Alert email address', st_mail_h: 'Grouping, /16 warning and limit emails go here. On cPanel, root@localhost is forwarded to the server contact address.',
      st_lang: 'Language', st_lang_h: 'Language of the log, emails and this panel.', st_test: 'Send test email', st_test_h: 'Sent to the saved address.',
      st_test_dirty: 'Save the new address first.', st_thr: 'Thresholds', st_thr_h: 'How many single bans trigger an action.',
      k_THRESHOLD_24: '/24 group ban', h_THRESHOLD_24: 'A /24 is banned once it holds this many permanent singles.',
      k_THRESHOLD_24_PERMANENT: 'Do not delete at', h_THRESHOLD_24_PERMANENT: 'At this many singles the /24 also gets "do not delete". Can\'t be lower than the /24 threshold.',
      k_THRESHOLD_16: '/16 warning', h_THRESHOLD_16: 'Emails when this many singles come from at least 2 distinct /24s. Never auto-bans.',
      k_THRESHOLD_TEMP_24: 'Temp /24', h_THRESHOLD_TEMP_24: 'This many temp singles: 12-hour temp ban the first time, permanent the second.',
      k_THRESHOLD_TEMP_16: 'Temp /16 warning', h_THRESHOLD_TEMP_16: 'Warning threshold for /16 density in the temp list.',
      st_sched: 'Schedule', st_sched_h: 'How often cron runs the script.', cron_5: '5 min', cron_10: '10 min', cron_15: '15 min', cron_30: '30 min', cron_0: 'Hourly',
      st_lookup: 'Lookups', k_LOOKUP: 'Owner and hostname lookups', h_LOOKUP: 'Shows ASN, organisation and hostname in emails and here; CC_IGNORE and csf.rignore checks rely on it.',
      k_LOOKUP_TIMEOUT: 'DNS timeout (s)', h_LOOKUP_TIMEOUT: 'How long to wait for each query.', st_nodns: 'Neither dig nor host is installed; lookups won\'t work (dnf install bind-utils).',
      on: 'On', off: 'Off', st_keep: 'Retention', k_SAYAC_RETENTION_DAYS: 'Promotion record kept (days)',
      h_SAYAC_RETENTION_DAYS: 'A temp-banned /24 that returns within this time becomes permanent.', k_REVIEW_DAYS: 'To review (days)',
      h_REVIEW_DAYS: 'How long warnings and skips stay on the list.', k_LOG_MAX_LINES: 'Log line limit', h_LOG_MAX_LINES: 'The log is trimmed to this many lines.',
      st_csf: 'CSF list limits', st_csf_h: 'These are CSF\'s own settings; change them in CSF, not here.',
      csf_deny: 'Permanent list (DENY_IP_LIMIT)', csf_temp: 'Temp list (DENY_TEMP_IP_LIMIT)', csf_open: 'Open CSF settings',
      default_v: 'default {0}', range_v: 'a whole number from {0} to {1}', mail_bad: 'Enter a valid email address.',
      rule_dnd: 'The do not delete threshold can\'t be lower than the /24 threshold.', dirty_n: '{0} unsaved changes', discard: 'Discard',
      try_save: 'Try before saving', save: 'Save', m_save_t: 'Save settings?', m_save_b: 'These changes will be written to config.env (a backup is kept):',
      m_try_t: 'Dry run with the new thresholds', m_try_b: 'Uses the unsaved settings; nothing is changed.', show_pending_all: 'Show all ({0})',
      panel_bad: 'Use the form https://server:2087.', auto: 'automatic', focus_gone: '{0} is no longer on the list; showing its current state.',
      new_badge: 'New since your last visit', actions: 'Actions', overdue: 'Run overdue · last run {0} (expected every {1})',
      since_visit: 'Since your last visit ({0}):', sn_add: '{0} group bans', sn_temp: '{0} temp groups', sn_warn: '{0} /16 warnings',
      sn_skip: '{0} whitelist skips', show_new: 'Show', e_new: 'Since last visit', ch_title: 'Last 30 days', ch_total: '{0} events',
      ch_add: 'Group ban', ch_promote: 'Promoted', ch_temp: 'Temp', ch_warn: '/16 warning', ch_skip: 'Whitelist',
      ch_empty: 'Nothing in the last 30 days; the chart fills as the event log grows.', ipcard: 'IP card', col_block: 'Block', col_owner: 'Owner',
      col_singles: 'Singles', col_added: 'Added', of_n: '{0}–{1} of {2}', s_asn: 'Top attacking networks',
      s_asn_h: 'Ranked by group bans and single bans; other ranges in csf.deny are noted separately · owner known for {0} blocks', p_g: '{0} groups', p_b: '+{0} blocks from other sources', p_t: '{0} singles', p_bn: '{0} blocks',
      at_atk: 'Attackers', at_blk: 'Other blocks', blk_h: 'Ranges in csf.deny added outside CSF Auto-Group (by hand or other tools); already blocked.',
      blk_empty: 'No ranges from other sources in csf.deny (or their owners aren\'t known yet).',
      im_h: 'IPs Imunify360 blocked on this server itself (not the cloud list) · {0} IPs, owner known for {1}. Information only; nothing is written to CSF.',
      im_n: '{0} IPs', im_empty: 'The Imunify360 local blacklist is empty.', asn_denied: 'Already blocked in CSF',
      asn_hint: 'ASN block suggestion', asn_filling: 'Collecting owner info; 50 blocks are looked up per run.',
      asn_nolookup: 'Owner lookups are off (Settings → Lookups).', m_asn_t: 'Block all of AS{0} in CSF',
      m_asn_b: '{0} separate /24 group bans were added for {1}; each means at least 3 attackers in the same block. If attacks keep coming from this network, closing the whole network with CSF\'s own country/ASN block is more durable.',
      m_asn_w: 'This also blocks legitimate users of that network (e.g. customers hosted there). Be careful with large cloud providers.',
      m_asn_s: 'How: CSF → Firewall Configuration → add {0} to CC_DENY (comma separated), save and restart csf and lfd. This plugin never changes csf.conf.',
      copy_asn: 'Copy {0}', csf_open2: 'Open CSF', edit: 'Edit', st_digest: 'Weekly summary',
      st_digest_h: 'Sent with the first run after 09:00 on the chosen day: new groups, top attacking networks, promotion records about to expire.',
      st_digest_day: 'Day', d1: 'Mon', d2: 'Tue', d3: 'Wed', d4: 'Thu', d5: 'Fri', d6: 'Sat', d7: 'Sun',
      digest_prev: 'Preview summary', m_digest_t: 'Weekly summary preview', ev_digest: 'Weekly summary'
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

  /* ── Sahip bilgisi: script'in önbelleği (S.owners) + olay kaydı ─── */
  var OWNERS = {};
  function indexOwners() {
    OWNERS = {};
    (S.events || []).forEach(function (e) {
      if (!e.cidr) return;
      var o = OWNERS[e.cidr] || (OWNERS[e.cidr] = {});
      if (e.owner) { o.owner = e.owner; o.asn = e.asn; o.cc = e.cc; }
      if (e.ips && e.ips.length) o.ev = e;
    });
  }
  function prefixOf(cidr) { var p = String(cidr).split('/')[0].split('.'); return p[0] + '.' + p[1] + '.' + p[2]; }
  function ownerOf(cidr) {         // → {asn, cc, name, label} ya da {}
    var c = (S.owners || {})[prefixOf(cidr)], o = OWNERS[cidr] || {};
    // Cymru kurum adı ülkeyle bitiyor ("OVH, FR"); bayrak zaten gösterildiği için tabloda atılır.
    if (c) return { asn: c[0], cc: c[1], name: String(c[2] || '').replace(/,\s*[A-Z]{2}$/, ''), label: 'AS' + c[0] + ' ' + (c[2] || '') };
    if (o.owner) return { asn: o.asn, cc: o.cc, name: String(o.owner).replace(/^AS\d+\s*/, ''), label: o.owner };
    return {};
  }
  function ownerOfIps(ips) {       // /16 uyarısı: IP'lerin çoğunluk sahibi
    var c = {}, best = null;
    (ips || []).forEach(function (i) { if (i.owner) { c[i.owner] = (c[i.owner] || 0) + 1; if (!best || c[i.owner] > c[best]) best = i.owner; } });
    var n = Object.keys(c).length;
    return best ? best + (n > 1 ? ' +' + (n - 1) : '') : '';
  }
  var SEEN0 = null;                // bu oturumun "son ziyaret" zamanı (sayfa açıkken sabit kalır)
  function isNew(ts) { return SEEN0 > 0 && ts > SEEN0; }
  var NEW_TYPES = ['add24', 'promote', 'temp24', 'warn16', 'warn16t', 'skip_wl', 'manual_ban'];
  function overdue() {
    if (!S.last_run || !(S.cron_interval > 0)) return false;
    return nowSec() - S.last_run.t > Math.max(3 * S.cron_interval, 2700);
  }

  /* ── Parçalar ──────────────────────────────────────────────────── */
  function empty(icon, text) { return '<div class="ag-empty">' + (IC[icon] || '') + esc(text) + '</div>'; }
  function flag(cc) { return cc ? '<span class="ag-flag">' + esc(cc) + '</span>' : ''; }
  function newDot(ts) { return isNew(ts) ? '<span class="ag-newdot" title="' + esc(t('new_badge')) + '"></span>' : ''; }
  function menu(key, items) {      // "⋯" menüsü; items: [{act, label, attrs, danger}]
    var open = UI.menu === key;
    return '<div class="ag-menu-wrap"><button class="ag-iconbtn' + (open ? ' on' : '') + '" data-act="menu" data-key="' + esc(key) + '" aria-label="' + esc(t('actions')) + '" aria-expanded="' + open + '">' + IC.dots + '</button>' +
      (open ? '<div class="ag-menu" role="menu">' + items.map(function (it) {
        return '<button role="menuitem" class="ag-menu-i' + (it.danger ? ' bad' : '') + '" data-act="' + it.act + '" ' + (it.attrs || '') + '>' + (it.icon ? IC[it.icon] : '') + esc(it.label) + '</button>';
      }).join('') + '</div>' : '') + '</div>';
  }

  function head() {
    var lr = S.last_run, run = S.running, late = !run && overdue();
    var sub = run ? '<span class="ag-dot run"></span>' + t('running')
      : late ? '<span class="ag-dot bad"></span><span class="ag-late">' + t('overdue', lr ? rel(lr.t) : '?', dur(S.cron_interval)) + '</span>'
      : '<span class="ag-dot"></span>' + t('idle') + ' · ' + (lr ? t('last_run', rel(lr.t)) : t('no_run'));
    return '<div class="ag-head"><div class="ag-mark">' + IC.shield + '</div>' +
      '<div class="ag-title"><h1>CSF Auto-Group</h1><div class="ag-sub">' + sub + '</div></div>' +
      '<div class="ag-head-actions">' +
      (run || UI.ranOnce ? '<button class="ag-btn ag-btn-ghost" data-act="runlog">' + IC.terminal + t('run_log') + '</button>' : '') +
      '<button class="ag-btn" data-act="dry">' + IC.eye + t('dry') + '</button>' +
      '<button class="ag-btn ag-btn-primary" data-act="run"' + (run ? ' disabled' : '') + '>' + IC.play + t('run') + '</button>' +
      '</div></div>' +
      '<div class="ag-tabs" role="tablist">' + ['overview', 'settings'].map(function (k) {
        return '<button class="ag-tab' + (UI.tab === k ? ' on' : '') + '" role="tab" aria-selected="' + (UI.tab === k) + '" data-act="tab" data-tab="' + k + '">' +
          (k === 'overview' ? IC.shield : IC.sliders) + t('tab_' + k) + '</button>';
      }).join('') + '</div>';
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

  function sinceBar() {
    if (!(SEEN0 > 0)) return '';
    var c = { add: 0, warn: 0, skip: 0, temp: 0 };
    (S.events || []).forEach(function (e) {
      if (!isNew(e.t) || NEW_TYPES.indexOf(e.type) < 0) return;
      if (e.type === 'add24' || e.type === 'promote' || e.type === 'manual_ban') c.add++;
      else if (e.type === 'temp24') c.temp++;
      else if (e.type === 'skip_wl') c.skip++;
      else c.warn++;
    });
    var parts = [];
    if (c.add) parts.push(t('sn_add', c.add));
    if (c.temp) parts.push(t('sn_temp', c.temp));
    if (c.warn) parts.push(t('sn_warn', c.warn));
    if (c.skip) parts.push(t('sn_skip', c.skip));
    if (!parts.length) return '';
    return '<div class="ag-since">' + IC.bell + '<span><b>' + t('since_visit', rel(SEEN0)) + '</b> ' + parts.join(' · ') + '</span>' +
      '<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="shownew">' + t('show_new') + '</button></div>';
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

  /* 30 günlük etkinlik: yığılmış çubuklar (grup banı, geçici, terfi, uyarı, atlama) */
  var SERIES = [['A', 'ch_add', 'var(--ag-accent)'], ['P', 'ch_promote', '#7c3aed'], ['T', 'ch_temp', '#d97706'], ['W', 'ch_warn', '#ea580c'], ['S', 'ch_skip', '#0284c7']];
  function activity() {
    var D = S.daily || {}, days = 30, max = 0, tot = 0, i, k;
    for (i = 0; i < days; i++) {
      var sum = 0;
      SERIES.forEach(function (s) { sum += (D[s[0]] || [])[i] || 0; });
      max = Math.max(max, sum); tot += sum;
    }
    var W = 720, H = 120, pad = 22, bw = (W - pad) / days, top = Math.max(1, max);
    var bars = '';
    for (i = 0; i < days; i++) {
      var y = H, tip = [], day = new Date((D.start + i * 86400) * 1000);
      SERIES.forEach(function (s) {
        var v = (D[s[0]] || [])[i] || 0; if (!v) return;
        var h = Math.max(2, v / top * (H - 8));
        y -= h;
        bars += '<rect x="' + (pad + i * bw + 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(2, bw - 4).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + s[2] + '"></rect>';
        tip.push(t(s[1]) + ': ' + v);
      });
      bars += '<rect class="ag-hit" x="' + (pad + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + H + '" fill="transparent"><title>' +
        esc(day.toLocaleDateString(LANG === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' }) + (tip.length ? ' — ' + tip.join(', ') : ' — 0')) + '</title></rect>';
    }
    var labels = '';
    for (k = 0; k < days; k += 7) {
      var dd = new Date((D.start + k * 86400) * 1000);
      labels += '<text x="' + (pad + k * bw + 2).toFixed(1) + '" y="' + (H + 14) + '" class="ag-ax">' + esc(dd.toLocaleDateString(LANG === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' })) + '</text>';
    }
    var grid = '<line x1="' + pad + '" x2="' + W + '" y1="' + (H + .5) + '" y2="' + (H + .5) + '" class="ag-gl"></line>' +
      '<text x="0" y="10" class="ag-ax">' + top + '</text>';
    var legend = SERIES.map(function (s) { return '<span><i style="background:' + s[2] + '"></i>' + t(s[1]) + '</span>'; }).join('');
    return '<section class="ag-card ag-activity"><div class="ag-card-h"><h2>' + IC.chart + t('ch_title') + '</h2><span class="ag-hint">' + t('ch_total', num(tot)) + '</span>' +
      '<div class="ag-tools ag-legend">' + legend + '</div></div>' +
      (tot ? '<div class="ag-chart"><svg viewBox="0 0 ' + W + ' ' + (H + 20) + '" preserveAspectRatio="none" role="img" aria-label="' + esc(t('ch_title')) + '">' + grid + bars + labels + '</svg></div>'
        : '<div class="ag-empty ag-empty-sm">' + t('ch_empty') + '</div>') + '</section>';
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
    if (!S.review.length) {
      return '<div class="ag-okbar">' + IC.check + '<b>' + t('no_review') + '</b><span>' + t('k_review_m', S.config.review_days) + '</span></div>';
    }
    var items = S.review.map(function (e) {
      var key = 'r:' + e.cidr, open = UI.open[key], is16 = /\/16$/.test(e.cidr);
      var pill = e.type === 'skip_wl' ? '<span class="ag-pill ag-pill-info">' + t('ev_skip_wl') + '</span>'
        : '<span class="ag-pill ag-pill-warn">' + t('ev_' + e.type) + '</span>';
      var meta = is16 ? [t('n_ip', num(e.n)), t('n_subnets', num(e.subnets))] : [t('n_ip', num(e.n))];
      var owner = e.owner || ownerOfIps(e.ips) || ownerOf(e.cidr).label;
      if (owner) meta.push(esc(owner));
      if (e.wl) meta.push(esc(t('wl', e.wl)));
      var first = e.ips && e.ips[0] ? e.ips[0].ip : '';
      var acts = '<button class="ag-btn ag-btn-sm" data-act="toggle" data-key="' + key + '">' + (open ? t('hide') : t('ips')) + '</button>';
      if (is16) acts += '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="ban16" data-t="' + esc(pfx(e.cidr)) + '">' + t('ban16') + '</button>';
      else acts += '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="banforce" data-t="' + esc(pfx(e.cidr)) + '" data-wl="' + esc(e.wl || '') + '">' + t('ban_anyway') + '</button>';
      acts += menu('rm:' + e.cidr, [{ act: 'ignore', label: t('ignore'), icon: 'mute', attrs: 'data-c="' + esc(e.cidr) + '"' },
                                    { act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' }]);
      return '<div class="ag-item" data-row="' + esc(e.cidr) + '"><div class="ag-row">' + pill +
        '<div class="ag-row-main"><div class="ag-row-t">' + newDot(e.t) + '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(e.cidr) + '</span></div>' +
        '<div class="ag-row-s">' + meta.join(' · ') + '</div></div>' +
        '<div class="ag-row-x">' + rel(e.t) + '</div><div class="ag-row-a">' + acts + '</div></div>' +
        (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.alert + t('s_review') + '</h2>' +
      '<span class="ag-count warn">' + S.review.length + '</span>' +
      '<span class="ag-hint">' + t('s_review_h') + '</span></div>' +
      '<div class="ag-card-b">' + items + '</div></section>';
  }

  /* Aktif grup banları: sıralanabilir, sayfalı tablo */
  var PAGE = 15;
  function groupMatches(g) {
    var f = UI.gf;
    if (f === 'perm' && !(g.kind === 'perm' || g.kind === 'promoted')) return false;
    if (f === 'dnd' && !g.dnd) return false;
    if (f === 'temp' && g.kind !== 'temp') return false;
    if (f === 'manual' && g.kind !== 'manual') return false;
    if (UI.gq) {
      var o = ownerOf(g.cidr), hay = (g.cidr + ' ' + (o.label || '') + ' ' + (o.cc || '')).toLowerCase();
      if (hay.indexOf(UI.gq.toLowerCase()) < 0) return false;
    }
    return true;
  }
  function ipNum(c) { var p = String(c).split('/')[0].split('.'); return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3]; }
  function groupSorted() {
    var s = UI.gs, d = UI.gd;
    return S.groups.filter(groupMatches).sort(function (a, b) {
      var x, y;
      if (s === 'cidr') { x = ipNum(a.cidr); y = ipNum(b.cidr); }
      else if (s === 'owner') { x = (ownerOf(a.cidr).label || '~').toLowerCase(); y = (ownerOf(b.cidr).label || '~').toLowerCase(); }
      else if (s === 'n') { x = a.n || 0; y = b.n || 0; }
      else { x = a.kind === 'temp' ? 9e12 : (a.added || 0); y = b.kind === 'temp' ? 9e12 : (b.added || 0); }
      return x < y ? -d : x > y ? d : 0;
    });
  }
  function th(key, label, cls) {
    var on = UI.gs === key;
    return '<button class="ag-th' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-act="gsort" data-k="' + key + '">' + esc(label) +
      '<span class="ag-sort">' + (on ? (UI.gd > 0 ? '↑' : '↓') : '') + '</span></button>';
  }
  function groupRows() {
    var list = groupSorted();
    if (!list.length) return empty('inbox', S.groups.length ? t('no_match') : t('no_groups'));
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (UI.gp >= pages) UI.gp = pages - 1;
    var from = UI.gp * PAGE, shown = list.slice(from, from + PAGE);
    var rows = shown.map(function (g) {
      var o = ownerOf(g.cidr), ev = (OWNERS[g.cidr] || {}).ev, key = 'g:' + g.cidr, open = UI.open[key];
      var kindCls = { perm: 'ag-pill-n', promoted: 'ag-pill-acc', temp: 'ag-pill-warn', manual: 'ag-pill-bad' }[g.kind] || 'ag-pill-n';
      var first = ev && ev.ips && ev.ips[0] ? ev.ips[0].ip : g.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
      var when = g.kind === 'temp' ? '<span class="ag-pill ag-pill-warn">' + t('ttl_left', dur(g.ttl)) + '</span>' : (g.added ? rel(g.added) : '—');
      var items = [];
      if (ev && ev.ips && ev.ips.length) items.push({ act: 'toggle', label: open ? t('hide') : t('ips'), icon: 'list', attrs: 'data-key="' + key + '"' });
      items.push({ act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' });
      items.push({ act: 'unban', label: t('unban'), icon: 'x', danger: true, attrs: 'data-c="' + esc(g.cidr) + '" data-dnd="' + (g.dnd ? 1 : 0) + '" data-kind="' + esc(g.kind) + '"' });
      return '<div class="ag-item" data-row="' + esc(g.cidr) + '"><div class="ag-tr">' +
        '<div class="ag-td ag-td-main">' + newDot(g.added) + '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(g.cidr) + '</span>' +
        '<span class="ag-pill ' + kindCls + '">' + t('kind_' + g.kind) + '</span>' +
        (g.dnd ? '<span class="ag-lock" title="do not delete">' + IC.lock + '</span>' : '') + '</div>' +
        '<div class="ag-td ag-td-own" title="' + esc(o.label || '') + '">' + (o.asn ? flag(o.cc) + '<span class="ag-asn">AS' + esc(o.asn) + '</span><span class="ag-org">' + esc(o.name || '') + '</span>' : '<span class="ag-muted">—</span>') + '</div>' +
        '<div class="ag-td ag-num-c">' + (g.n ? num(g.n) : '—') + '</div>' +
        '<div class="ag-td ag-when">' + when + '</div>' +
        '<div class="ag-td ag-td-act">' + menu('gm:' + g.cidr, items) + '</div></div>' +
        (open && ev ? ipTable(ev.ips, ev.total) : '') + '</div>';
    }).join('');
    var pager = pages > 1 ? '<div class="ag-pager"><span>' + t('of_n', from + 1, from + shown.length, list.length) + '</span>' +
      '<button class="ag-iconbtn" data-act="gpage" data-d="-1"' + (UI.gp ? '' : ' disabled') + ' aria-label="‹">‹</button>' +
      '<button class="ag-iconbtn" data-act="gpage" data-d="1"' + (UI.gp < pages - 1 ? '' : ' disabled') + ' aria-label="›">›</button></div>' : '';
    return '<div class="ag-thead">' + th('cidr', t('col_block'), 'ag-td-main') + th('owner', t('col_owner'), 'ag-td-own') +
      th('n', t('col_singles'), 'ag-num-c') + th('added', t('col_added'), 'ag-when') + '<span></span></div>' + rows + pager;
  }
  function groups() {
    var chips = ['all', 'perm', 'dnd', 'temp', 'manual'].map(function (f) {
      return '<button class="ag-chip' + (UI.gf === f ? ' on' : '') + '" data-act="gf" data-f="' + f + '">' + t('f_' + f) + '</button>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.ban + t('s_groups') + '</h2>' +
      '<span class="ag-count">' + S.groups.length + '</span><div class="ag-tools"><div class="ag-chips">' + chips + '</div>' +
      '<input class="ag-input" id="ag-gq" type="search" placeholder="' + esc(t('g_search')) + '" value="' + esc(UI.gq) + '" style="width:180px"></div></div>' +
      '<div class="ag-card-b ag-tbl" id="ag-groups-b">' + groupRows() + '</div></section>';
  }

  var EV_CLASS = {
    add24: 'ag-pill-ok', promote: 'ag-pill-acc', temp24: 'ag-pill-warn', skip_wl: 'ag-pill-info', warn16: 'ag-pill-warn',
    warn16t: 'ag-pill-warn', clean_temp: 'ag-pill-n', manual_ban: 'ag-pill-bad', manual_unban: 'ag-pill-n',
    manual_forget: 'ag-pill-n', manual_ignore: 'ag-pill-n', manual_unignore: 'ag-pill-n', config: 'ag-pill-acc', test_mail: 'ag-pill-n', digest: 'ag-pill-n'
  };
  var EV_GROUP = {
    bans: ['add24', 'promote', 'temp24', 'manual_ban'], warn: ['warn16', 'warn16t'], skip: ['skip_wl'],
    manual: ['manual_ban', 'manual_unban', 'manual_forget', 'manual_ignore', 'manual_unignore', 'config', 'test_mail', 'digest'], clean: ['clean_temp']
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
    if (e.changes) e.changes.forEach(function (c) { d.push((DICT[LANG]['k_' + c.key] || c.key) + ': ' + (c.from || '—') + ' → ' + (c.to || '—')); });
    if (e.to) d.push(e.to);
    if (e.by) d.push(t('by', e.by));
    if (e.until) d.push(t('until', e.until));
    return esc(d.join(' · '));
  }
  function events() {
    var all = (S.events || []).slice().reverse();
    var list = UI.ef === 'all' ? all : UI.ef === 'new' ? all.filter(function (e) { return isNew(e.t) && NEW_TYPES.indexOf(e.type) >= 0; })
      : all.filter(function (e) { return EV_GROUP[UI.ef].indexOf(e.type) >= 0; });
    var shown = list.slice(0, UI.evLimit);
    var opts = (SEEN0 > 0 ? ['all', 'new'] : ['all']).concat(['bans', 'warn', 'skip', 'manual', 'clean']).map(function (f) {
      return '<option value="' + f + '"' + (UI.ef === f ? ' selected' : '') + '>' + t('e_' + f) + '</option>';
    }).join('');
    var rows = shown.map(function (e, i) {
      var key = 'e:' + e.t + ':' + e.type + ':' + (e.cidr || i), open = UI.open[key], has = e.ips && e.ips.length;
      return '<div class="ag-item"><div class="ag-ev' + (has ? ' clickable" data-act="toggle" data-key="' + esc(key) : '') + '">' +
        '<div class="ag-ev-time" title="' + esc(new Date(e.t * 1000).toLocaleString()) + '">' + stamp(e.t) + '</div>' +
        '<div class="ag-ev-b"><div class="ag-ev-t">' + newDot(NEW_TYPES.indexOf(e.type) >= 0 ? e.t : 0) + '<span class="ag-pill ' + (EV_CLASS[e.type] || 'ag-pill-n') + '">' + esc(t('ev_' + e.type)) + '</span>' +
        (e.cidr ? '<span class="ag-mono" style="font-weight:600">' + esc(e.cidr) + '</span>' : '') + '</div>' +
        '<div class="ag-ev-d">' + evDetail(e) + '</div></div>' + (has ? '<span class="ag-chev">' + (open ? '−' : '+') + '</span>' : '') + '</div>' + (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }).join('');
    var more = list.length > shown.length ? '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="evmore">' + t('more') + '</button></div>' : '';
    return '<section class="ag-card" id="ag-events"><div class="ag-card-h"><h2>' + IC.list + t('s_events') + '</h2>' +
      '<div class="ag-tools"><select class="ag-input" id="ag-ef" style="width:170px">' + opts + '</select></div></div>' +
      '<div class="ag-card-b">' + (rows || empty('inbox', all.length ? t('no_match') : t('no_events'))) + '</div>' + more + '</section>';
  }

  function lookupCard() {
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.search + t('s_lookup') + '</h2></div>' +
      '<div class="ag-lookup"><form id="ag-lk"><input class="ag-input ag-mono" id="ag-lk-ip" inputmode="decimal" autocomplete="off" placeholder="' + esc(t('lookup_ph')) + '">' +
      '<button class="ag-btn ag-btn-primary" type="submit">' + t('lookup_btn') + '</button></form><p>' + t('lookup_hint') + '</p></div></section>';
  }

  /* En çok saldıran ağlar: üç sekme — saldıranlar / csf.deny'deki diğer bloklar / Imunify */
  function asnRow(i, a, w, sub) {
    var name = String(a.name || '').replace(/,\s*[A-Z]{2}$/, '');
    return '<div class="ag-asn-r"><span class="ag-rank">' + (i + 1) + '</span><div class="ag-asn-m">' +
      '<div class="ag-asn-t">' + flag(a.cc) + '<span class="ag-asn">AS' + esc(a.asn) + '</span><span class="ag-org" title="' + esc(a.name) + '">' + esc(name) + '</span></div>' +
      '<div class="ag-asn-b"><i style="width:' + w + '%"></i></div><div class="ag-sub">' + sub + '</div></div></div>';
  }
  function pct(v, max) { return v ? Math.max(4, Math.round(v * 100 / Math.max(1, max))) : 0; }
  function asnAttack() {        // sıralama: kendi grup banlarımız + tekiller (saldırı kanıtı)
    var list = S.asn_top || [], max = 0;
    function wt(a) { return a.groups * 4 + a.singles; }
    list.forEach(function (a) { max = Math.max(max, wt(a)); });
    return list.map(function (a, i) {
      var name = String(a.name || '').replace(/,\s*[A-Z]{2}$/, ''), parts = [];
      if (a.groups) parts.push(t('p_g', num(a.groups)));
      if (a.singles) parts.push(t('p_t', num(a.singles)));
      if (a.blocks) parts.push('<span class="ag-muted">' + t('p_b', num(a.blocks)) + '</span>');
      // Öneri: en az 5 kendi grup banı (≥15 saldırgan, 5 ayrı blok) ve CC_DENY'de değilse.
      var tail = a.denied ? ' · <span class="ag-pill ag-pill-ok">' + t('asn_denied') + '</span>'
        : a.groups >= 5 ? ' · <button class="ag-link" data-act="asnhint" data-asn="' + esc(a.asn) + '" data-name="' + esc(name) + '" data-g="' + a.groups + '">' + t('asn_hint') + '</button>' : '';
      return asnRow(i, a, pct(wt(a), max), parts.join(' · ') + tail);
    }).join('');
  }
  function asnBlocks() {        // csf.deny'deki başka kaynaklı aralıklar
    var list = S.blocks_top || [], max = 0;
    list.forEach(function (a) { max = Math.max(max, a.blocks); });
    return list.map(function (a, i) {
      var parts = [t('p_bn', num(a.blocks))];
      if (a.groups) parts.push('<span class="ag-muted">' + t('p_g', num(a.groups)) + '</span>');
      if (a.singles) parts.push('<span class="ag-muted">' + t('p_t', num(a.singles)) + '</span>');
      return asnRow(i, a, pct(a.blocks, max), parts.join(' · ') + (a.denied ? ' · <span class="ag-pill ag-pill-ok">' + t('asn_denied') + '</span>' : ''));
    }).join('');
  }
  function asnImunify() {       // Imunify360'ın bu sunucudaki kendi kara listesi
    var im = S.imunify || {}, list = im.top || [], max = 0;
    list.forEach(function (a) { max = Math.max(max, a.count); });
    return list.map(function (a, i) {
      var rs = (a.reasons || []).map(function (r) { return '<span class="ag-reason">' + esc(r[0]) + ' <b>' + num(r[1]) + '</b></span>'; }).join('');
      return asnRow(i, a, pct(a.count, max), '<b class="ag-imc">' + t('im_n', num(a.count)) + '</b>' + (rs ? '<span class="ag-reasons">' + rs + '</span>' : ''));
    }).join('');
  }
  function topAsn() {
    var im = S.imunify || {}, tabs = [['atk', t('at_atk')], ['blk', t('at_blk')]];
    if (im.present) tabs.push(['im', 'Imunify']);
    if (!tabs.some(function (x) { return x[0] === UI.at; })) UI.at = 'atk';
    var chips = '<div class="ag-chips ag-chips-full">' + tabs.map(function (x) {
      return '<button class="ag-chip' + (UI.at === x[0] ? ' on' : '') + '" data-act="at" data-t="' + x[0] + '">' + esc(x[1]) + '</button>';
    }).join('') + '</div>';
    var body, hint;
    if (UI.at === 'blk') {
      body = asnBlocks(); hint = t('blk_h');
      if (!body) body = '<div class="ag-empty ag-empty-sm">' + t('blk_empty') + '</div>';
    } else if (UI.at === 'im') {
      body = asnImunify(); hint = t('im_h', num(im.total || 0), num(im.known || 0));
      if (!body) body = '<div class="ag-empty ag-empty-sm">' + (im.total ? t('asn_filling') : t('im_empty')) + '</div>';
    } else {
      body = asnAttack(); hint = t('s_asn_h', num(Object.keys(S.owners || {}).length));
      if (!body) body = '<div class="ag-empty ag-empty-sm">' + (S.config.lookup ? t('asn_filling') : t('asn_nolookup')) + '</div>';
    }
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.globe + t('s_asn') + '</h2>' + chips +
      '<span class="ag-hint" style="width:100%">' + hint + '</span></div><div class="ag-card-b">' + body + '</div></section>';
  }

  function pending() {
    var plist = S.pending.slice().sort(function (a, b) { return a.days_left - b.days_left; });
    var pmore = !UI.pAll && plist.length > 8 ? plist.length : 0;
    if (pmore) plist = plist.slice(0, 8);
    var rows = plist.map(function (p) {
      var cidr = p.prefix + '.0/24', o = ownerOf(cidr), ev = (OWNERS[cidr] || {}).ev;
      var left = Math.max(0, p.days_left), ret = S.config.retention || 180, pct = Math.max(0, Math.min(100, left * 100 / ret));
      var urg = left < 7 ? ' bad' : left < 30 ? ' warn' : '';
      var first = ev && ev.ips && ev.ips[0] ? ev.ips[0].ip : p.prefix + '.1';
      return '<div class="ag-prow" data-row="' + esc(cidr) + '"><div class="ag-row-main"><div class="ag-row-t"><span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(cidr) + '</span>' +
        (p.temp_ttl > 0 ? '<span class="ag-pill ag-pill-warn">' + t('ttl_left', dur(p.temp_ttl)) + '</span>' : '') + '</div>' +
        '<div class="ag-row-s">' + (o.label ? flag(o.cc) + ' ' + esc(o.label) : t('since', esc(p.since))) + '</div></div>' +
        '<div class="ag-left' + urg + '"><div class="ag-days"><i style="width:' + pct + '%"></i></div><span>' + t('days_left', left) + '</span></div>' +
        menu('pm:' + p.prefix, [{ act: 'promote', label: t('promote'), icon: 'ban', attrs: 'data-t="' + esc(p.prefix) + '"' },
                                { act: 'forget', label: t('forget'), icon: 'x', attrs: 'data-t="' + esc(p.prefix) + '"' },
                                { act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' }]) + '</div>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.hour + t('s_pending') + '</h2><span class="ag-count">' + S.pending.length + '</span>' +
      '<span class="ag-hint" style="width:100%">' + t('s_pending_h') + '</span></div>' +
      '<div class="ag-card-b">' + (rows || empty('check', t('no_pending'))) + '</div>' +
      (pmore ? '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="pall">' + t('show_pending_all', num(pmore)) + '</button></div>' : '') + '</section>';
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
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.sliders + t('s_config') + '</h2>' +
      '<div class="ag-tools"><button class="ag-link" data-act="tab" data-tab="settings">' + t('edit') + '</button></div></div><dl class="ag-kv">' +
      kv(t('c_t24'), t('c_singles', c.t24)) + kv(t('c_t24p'), t('c_singles', c.t24p)) + kv(t('c_t16'), t('c_singles', c.t16)) +
      kv(t('c_tt24'), t('c_singles', c.tt24)) + kv(t('c_tt16'), t('c_singles', c.tt16)) + kv(t('c_ret'), t('c_days', c.retention)) +
      kv(t('c_lookup'), c.lookup ? t('c_on') : t('c_off')) + '</dl></section>';
  }

  /* ── Ayarlar sekmesi ───────────────────────────────────────────── */
  var RANGES = {
    THRESHOLD_24: [2, 50], THRESHOLD_24_PERMANENT: [2, 100], THRESHOLD_16: [2, 500], THRESHOLD_TEMP_24: [2, 50],
    THRESHOLD_TEMP_16: [2, 500], LOOKUP_TIMEOUT: [1, 10], SAYAC_RETENTION_DAYS: [7, 730], REVIEW_DAYS: [1, 90], LOG_MAX_LINES: [500, 100000]
  };
  var TRY_KEYS = ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24', 'THRESHOLD_TEMP_16', 'LOOKUP', 'LOOKUP_TIMEOUT', 'SAYAC_RETENTION_DAYS', 'REVIEW_DAYS'];
  function cv(k) { return DRAFT[k] !== undefined ? DRAFT[k] : (CFG ? CFG.values[k] : ''); }
  function changedKeys() { return Object.keys(DRAFT).filter(function (k) { return String(DRAFT[k]) !== String(CFG.values[k]); }); }
  function cfgErrors() {
    var e = {};
    Object.keys(RANGES).forEach(function (k) {
      var v = String(cv(k)), r = RANGES[k];
      if (!/^\d{1,6}$/.test(v) || +v < r[0] || +v > r[1]) e[k] = t('range_v', r[0], r[1]);
    });
    // Yerel adresler de geçerli ("root", "root@localhost"); kural script'teki cfg_check ile aynı.
    if (!/^[A-Za-z0-9._%+-]+(@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)?$/.test(String(cv('ALERT_MAIL')))) e.ALERT_MAIL = t('mail_bad');
    if (!e.THRESHOLD_24 && !e.THRESHOLD_24_PERMANENT && +cv('THRESHOLD_24_PERMANENT') < +cv('THRESHOLD_24')) e.THRESHOLD_24_PERMANENT = t('rule_dnd');
    return e;
  }
  function loadCfg() {
    if (cfgLoading) return;
    cfgLoading = true;
    api('config_get').then(function (d) {
      cfgLoading = false;
      if (!d || !d.ok) { toast(t('t_err', (d && (d.message || d.error)) || '?'), 'bad'); return; }
      CFG = d; DRAFT = {}; render();
    }).catch(function (e) { cfgLoading = false; toast(t('t_err', e.message), 'bad'); });
  }
  function field(k, errs) {
    var r = RANGES[k], changed = CFG && String(cv(k)) !== String(CFG.values[k]);
    return '<div class="ag-field' + (errs[k] ? ' bad' : '') + (changed ? ' changed' : '') + '"><div class="ag-field-l"><label for="ag-f-' + k + '">' + t('k_' + k) + '</label>' +
      '<span class="ag-sub">' + t('default_v', CFG.defaults[k]) + '</span></div>' +
      '<input class="ag-input ag-num" id="ag-f-' + k + '" data-cfg="' + k + '" type="number" inputmode="numeric" min="' + r[0] + '" max="' + r[1] + '" step="1" value="' + esc(cv(k)) + '">' +
      '<div class="ag-field-h">' + (errs[k] ? esc(errs[k]) : t('h_' + k)) + '</div></div>';
  }
  function seg(k, opts) {
    return '<div class="ag-chips">' + opts.map(function (o) {
      return '<button type="button" class="ag-chip' + (String(cv(k)) === String(o[0]) ? ' on' : '') + '" data-act="cfgchip" data-k="' + k + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function saveBar() {
    if (!CFG) return '';
    var ch = changedKeys(), errs = cfgErrors(), bad = Object.keys(errs).length > 0;
    if (!ch.length) return '';
    var canTry = ch.some(function (k) { return TRY_KEYS.indexOf(k) >= 0; });
    return '<div class="ag-savebar"><span>' + t('dirty_n', ch.length) + '</span><div class="ag-grow"></div>' +
      '<button class="ag-btn" data-act="cfgdiscard">' + t('discard') + '</button>' +
      (canTry ? '<button class="ag-btn" data-act="cfgtry"' + (bad ? ' disabled' : '') + '>' + IC.eye + t('try_save') + '</button>' : '') +
      '<button class="ag-btn ag-btn-primary" data-act="cfgsave"' + (bad ? ' disabled' : '') + '>' + t('save') + '</button></div>';
  }
  function settingsView() {
    if (!CFG) { loadCfg(); return '<div class="ag-card" style="padding:40px;text-align:center"><span class="ag-spin"></span></div>'; }
    var errs = cfgErrors(), mailDirty = String(cv('ALERT_MAIL')) !== String(CFG.values.ALERT_MAIL);
    function card(icon, title, hint, inner) {
      return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC[icon] + esc(title) + '</h2>' + (hint ? '<span class="ag-hint">' + esc(hint) + '</span>' : '') + '</div>' +
        '<div class="ag-form">' + inner + '</div></section>';
    }
    var notify = '<div class="ag-field' + (errs.ALERT_MAIL ? ' bad' : '') + (mailDirty ? ' changed' : '') + '"><div class="ag-field-l"><label for="ag-f-mail">' + t('st_mail') + '</label></div>' +
      '<input class="ag-input" id="ag-f-mail" data-cfg="ALERT_MAIL" type="email" autocomplete="off" value="' + esc(cv('ALERT_MAIL')) + '">' +
      '<div class="ag-field-h">' + (errs.ALERT_MAIL ? esc(errs.ALERT_MAIL) : t('st_mail_h')) + '</div></div>' +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_lang') + '</label></div>' + seg('MSG_LANG', [['tr', 'Türkçe'], ['en', 'English']]) +
      '<div class="ag-field-h">' + t('st_lang_h') + '</div></div>' +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_digest') + '</label>' +
      '<button class="ag-link" data-act="digestprev">' + t('digest_prev') + '</button></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + seg('DIGEST', [['1', t('on')], ['0', t('off')]]) +
      (String(cv('DIGEST')) === '1' ? seg('DIGEST_DAY', [1, 2, 3, 4, 5, 6, 7].map(function (d) { return [String(d), t('d' + d)]; })) : '') + '</div>' +
      '<div class="ag-field-h">' + t('st_digest_h') + '</div></div>' +
      '<div class="ag-field"><button class="ag-btn" data-act="cfgtest"' + (mailDirty ? ' disabled' : '') + '>' + IC.inbox + t('st_test') + '</button>' +
      '<div class="ag-field-h">' + (mailDirty ? t('st_test_dirty') : t('st_test_h') + ' ' + esc(CFG.values.ALERT_MAIL)) + '</div></div>';
    var thr = ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24', 'THRESHOLD_TEMP_16'].map(function (k) { return field(k, errs); }).join('');
    var cronCur = String(CFG.values.CRON_MIN || '');
    var sched = '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_sched') + '</label></div>' +
      seg('CRON_MIN', [['*/5', t('cron_5')], ['*/10', t('cron_10')], ['*/15', t('cron_15')], ['*/30', t('cron_30')], ['0', t('cron_0')]]) +
      '<div class="ag-field-h">' + t('st_sched_h') + (cronCur && ['*/5', '*/10', '*/15', '*/30', '0'].indexOf(cronCur) < 0 ? ' (' + esc(cronCur) + ')' : '') + '</div></div>';
    var look = '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_LOOKUP') + '</label></div>' + seg('LOOKUP', [['1', t('on')], ['0', t('off')]]) +
      '<div class="ag-field-h">' + (CFG.dns_tool ? t('h_LOOKUP') : '<span style="color:var(--ag-warn)">' + t('st_nodns') + '</span>') + '</div></div>' + field('LOOKUP_TIMEOUT', errs);
    var keep = ['SAYAC_RETENTION_DAYS', 'REVIEW_DAYS', 'LOG_MAX_LINES'].map(function (k) { return field(k, errs); }).join('');
    var csf = '<dl class="ag-kv" style="padding:0">' +
      '<dt>' + t('csf_deny') + '</dt><dd>' + (CFG.csf.deny_limit ? num(CFG.csf.deny_limit) : '—') + '</dd>' +
      '<dt>' + t('csf_temp') + '</dt><dd>' + (CFG.csf.temp_limit ? num(CFG.csf.temp_limit) : '—') + '</dd></dl>' +
      '<a class="ag-btn ag-btn-sm" href="../configserver/csf.cgi" target="_top">' + IC.ext + t('csf_open') + '</a>';
    return '<div class="ag-settings"><div class="ag-col">' + card('inbox', t('st_notify'), '', notify) + card('clock', t('st_sched'), '', sched) +
      card('search', t('st_lookup'), '', look) + '</div><div class="ag-col">' + card('sliders', t('st_thr'), t('st_thr_h'), thr) +
      card('hour', t('st_keep'), '', keep) + card('shield', t('st_csf'), t('st_csf_h'), csf) + '</div></div>' +
      '<div id="ag-savebar-slot">' + saveBar() + '</div>';
  }
  function refreshSaveBar() {
    var slot = document.getElementById('ag-savebar-slot'); if (slot) slot.innerHTML = saveBar();
    // alan hata/değişti işaretleri: yeniden çizmeden güncelle (yazarken odak kaybolmasın)
    var errs = cfgErrors();
    document.querySelectorAll('#ag-app [data-cfg]').forEach(function (inp) {
      var k = inp.getAttribute('data-cfg'), f = inp.closest('.ag-field'); if (!f) return;
      f.classList.toggle('bad', !!errs[k]);
      f.classList.toggle('changed', String(cv(k)) !== String(CFG.values[k]));
      var h = f.querySelector('.ag-field-h');
      if (h) h.textContent = errs[k] ? errs[k] : (k === 'ALERT_MAIL' ? t('st_mail_h') : t('h_' + k));
    });
  }

  function render() {
    if (!S) return;
    indexOwners();
    var y = window.scrollY;
    var body = UI.tab === 'settings' ? settingsView()
      : sinceBar() + kpis() + activity() + '<div class="ag-grid"><div class="ag-col">' + review() + groups() + events() + '</div>' +
        '<div class="ag-col">' + lookupCard() + topAsn() + pending() + ignored() + config() + '</div></div>';
    $app.innerHTML = '<div class="ag-wrap">' + head() + banner() + body +
      '<div class="ag-foot">' + esc(t('foot', S.version + (BOOT.commit ? ' (' + BOOT.commit + ')' : ''), BOOT.user || 'root')) + '</div></div>';
    $app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, y);
  }

  /* ── Durum / yoklama ───────────────────────────────────────────── */
  function refresh() {
    return api('status').then(function (d) {
      if (!d || d.ok === false) { throw new Error((d && (d.message || d.error)) || 'status'); }
      S = d; LANG = d.lang === 'tr' ? 'tr' : 'en'; CLOCK = d.now - Date.now() / 1000;
      if (SEEN0 === null) { SEEN0 = d.last_seen || 0; setTimeout(function () { api('seen').catch(function () {}); }, 1500); }
      document.documentElement.lang = LANG;
      if (wasRunning && !d.running) toast(t('t_done'), 'ok');
      wasRunning = d.running;
      schedule(d.running ? 3000 : 60000);
      if (!busy && !(UI.tab === 'settings' && CFG && changedKeys().length)) render();
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
    tab: function (el) {
      var k = el.getAttribute('data-tab');
      if (k === UI.tab) return;
      if (UI.tab === 'settings' && CFG && changedKeys().length && !window.confirm(t('dirty_n', changedKeys().length))) return;
      UI.tab = k; history.replaceState(null, '', k === 'settings' ? '#settings' : '#');
      if (k === 'settings') { CFG = null; DRAFT = {}; }
      render(); window.scrollTo(0, 0);
    },
    pall: function () { UI.pAll = true; render(); },
    at: function (el) { UI.at = el.getAttribute('data-t'); render(); },
    menu: function (el) { var k = el.getAttribute('data-key'); UI.menu = UI.menu === k ? null : k; render(); },
    gsort: function (el) { var k = el.getAttribute('data-k'); if (UI.gs === k) UI.gd = -UI.gd; else { UI.gs = k; UI.gd = k === 'added' || k === 'n' ? -1 : 1; } UI.gp = 0; render(); },
    gpage: function (el) { UI.gp = Math.max(0, UI.gp + (+el.getAttribute('data-d'))); render(); },
    shownew: function () { UI.ef = 'new'; UI.evLimit = 200; render(); var e = document.getElementById('ag-events'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    asnhint: function (el) {
      var asn = 'AS' + el.getAttribute('data-asn'), name = el.getAttribute('data-name'), g = el.getAttribute('data-g');
      modal({
        icon: 'globe', tone: 'warn', title: esc(t('m_asn_t', el.getAttribute('data-asn'))), okText: null, cancelText: t('close'),
        html: '<p>' + esc(t('m_asn_b', g, name)) + '</p><div class="ag-warnbox">' + esc(t('m_asn_w')) + '</div><p>' + esc(t('m_asn_s', asn)) + '</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ag-btn ag-btn-sm" data-m="copyasn">' + IC.copy + esc(t('copy_asn', asn)) + '</button>' +
          '<a class="ag-btn ag-btn-sm" href="../configserver/csf.cgi" target="_top">' + IC.ext + t('csf_open2') + '</a></div>',
        onOpen: function (wrap) {
          var b = wrap.querySelector('[data-m="copyasn"]');
          b.addEventListener('click', function (ev) { ev.stopPropagation(); if (navigator.clipboard) navigator.clipboard.writeText(asn).then(function () { toast(t('t_copied'), 'ok'); }); });
        }
      });
    },
    digestprev: function () {
      modal({
        icon: 'inbox', tone: 'acc', title: t('m_digest_t'), wide: true, okText: null, cancelText: t('close'),
        html: '<pre class="ag-out" id="ag-dg"><span class="ag-spin ag-spin-sm"></span></pre>',
        onOpen: function (wrap) {
          api('digest_preview').then(function (r) { var pre = wrap.querySelector('#ag-dg'); if (pre) pre.textContent = r.output || r.error || ''; });
        }
      });
    },
    cfgchip: function (el) { DRAFT[el.getAttribute('data-k')] = el.getAttribute('data-v'); render(); },
    cfgdiscard: function () { DRAFT = {}; render(); },
    cfgtest: function (el) {
      el.disabled = true;
      api('config_test_mail').then(function (r) {
        el.disabled = false;
        toast(r.ok ? r.message : t('t_err', r.message || r.error || '?'), r.ok ? 'ok' : 'bad');
        if (r.ok) refresh();
      });
    },
    cfgtry: function () {
      var p = {};
      changedKeys().forEach(function (k) { if (TRY_KEYS.indexOf(k) >= 0) p['set[' + k + ']'] = String(cv(k)); });
      modal({
        icon: 'eye', tone: 'acc', title: t('m_try_t'), wide: true, okText: null, cancelText: t('close'),
        html: '<p>' + t('m_try_b') + '</p><pre class="ag-out" id="ag-try"><span class="ag-spin ag-spin-sm"></span>  ' + esc(t('m_dry_wait')) + '</pre>',
        onOpen: function (wrap) {
          api('dry_run', p).then(function (r) {
            var pre = wrap.querySelector('#ag-try'); if (!pre) return;
            var out = r.output || r.message || r.error || '';
            pre.innerHTML = colorize(out) + (/\[dry-run\]|\[gönderilmeyecek|\[email not sent/.test(out) ? '' : '\n<span class="q">' + esc(t('m_dry_none')) + '</span>');
          });
        }
      });
    },
    cfgsave: function () {
      var ch = changedKeys();
      var list = '<ul class="ag-changes">' + ch.map(function (k) {
        var label = k === 'ALERT_MAIL' ? t('st_mail') : k === 'MSG_LANG' ? t('st_lang') : k === 'CRON_MIN' ? t('st_sched') : k === 'DIGEST' ? t('st_digest') : k === 'DIGEST_DAY' ? t('st_digest_day') : t('k_' + k);
        return '<li><b>' + esc(label) + '</b><span class="ag-mono">' + esc(CFG.values[k] || '—') + '</span> → <span class="ag-mono">' + esc(cv(k) || t('auto')) + '</span></li>';
      }).join('') + '</ul>';
      modal({ icon: 'sliders', tone: 'acc', title: t('m_save_t'), html: '<p>' + t('m_save_b') + '</p>' + list, okText: t('save') }).then(function (m) {
        if (!m.ok) return;
        var p = {};
        ch.forEach(function (k) { p['v[' + k + ']'] = String(cv(k)); });
        api('config_set', p).then(function (r) {
          if (!r.ok) { toast(t('t_err', r.message || r.error || '?'), r.code === 3 ? 'bad' : 'bad'); return; }
          toast(r.message, 'ok');
          CFG = null; DRAFT = {};
          refresh();           // dil değiştiyse panel de yeni dile geçer
        });
      });
    },
    toggle: function (el) { var k = el.getAttribute('data-key'); UI.open[k] = !UI.open[k]; render(); },
    gf: function (el) { UI.gf = el.getAttribute('data-f'); UI.gLimit = 40; UI.gp = 0; render(); },
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
          if (!r.ok && r.error === 'busy') { wasRunning = true; toast(t('t_cron_busy'), 'ok'); refresh(); return; }
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
    var act = ev.target.closest('[data-act]'), ipEl = ev.target.closest('[data-ip]');
    // Açık menü, menüyü açıp kapatan düğme dışındaki her tıklamada kapanır — işlemden ÖNCE,
    // yoksa açılan onay penceresinin arkasında (ve pencere kapanınca da) menü açık kalıyordu.
    if (UI.menu && !(act && act.getAttribute('data-act') === 'menu')) {
      UI.menu = null; render();
      if (!act && !(ipEl && ipEl.getAttribute('data-ip'))) return;
    }
    if (ipEl && ipEl.getAttribute('data-ip')) { ev.preventDefault(); openDrawer(ipEl.getAttribute('data-ip')); return; }
    var el = act;
    if (!el || el.disabled) return;
    var fn = ACTIONS[el.getAttribute('data-act')];
    if (fn) { ev.preventDefault(); fn(el); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && UI.menu && !layerStack.length) { UI.menu = null; render(); } });
  $app.addEventListener('submit', function (ev) {
    if (ev.target.id === 'ag-lk') { ev.preventDefault(); openDrawer((document.getElementById('ag-lk-ip').value || '').trim()); }
  });
  $app.addEventListener('input', function (ev) {
    var ck = ev.target.getAttribute && ev.target.getAttribute('data-cfg');
    if (ck && CFG) { DRAFT[ck] = ev.target.value.trim(); refreshSaveBar(); return; }
    if (ev.target.id === 'ag-gq') {
      UI.gq = ev.target.value; UI.gLimit = 40; UI.gp = 0;
      var b = document.getElementById('ag-groups-b'); if (b) b.innerHTML = groupRows();
    }
  });
  $app.addEventListener('change', function (ev) {
    if (ev.target.id === 'ag-ef') { UI.ef = ev.target.value; UI.evLimit = 40; render(); }
  });

  /* ── Maildeki bağlantı: ?focus=CIDR → o satıra kay, aç, vurgula ─── */
  function applyFocus() {
    var q = new URLSearchParams(location.search), f = q.get('focus') || '', ip = q.get('ip') || '';
    if (!f && !ip) return;
    history.replaceState(null, '', location.pathname + location.hash);   // yenilemede tekrar kaymasın
    if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { openDrawer(ip); return; }
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(f)) return;
    UI.tab = 'overview';
    var inReview = S.review.some(function (e) { return e.cidr === f; });
    var inGroups = S.groups.some(function (g) { return g.cidr === f; });
    if (inReview) UI.open['r:' + f] = true;
    else if (inGroups) { UI.open['g:' + f] = true; UI.gLimit = 1e6; UI.gf = 'all'; UI.gq = ''; }
    else if (S.pending.some(function (p) { return p.prefix + '.0/24' === f; })) UI.pAll = true;
    render();
    var el = document.querySelector('#ag-app [data-row="' + f + '"]');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('ag-flash');
      setTimeout(function () { el.classList.remove('ag-flash'); }, 2600);
    } else {
      toast(t('focus_gone', f), 'ok');
      openDrawer(f.replace(/\/\d+$/, '').replace(/\.0$/, '.1'));
    }
  }

  /* ── Başlangıç ─────────────────────────────────────────────────── */
  refresh().then(function () {
    if (S) applyFocus();
    api('update_check').then(function (u) { UPD = u; if (u && u.ok && !u.uptodate) render(); }).catch(function () {});
  });
})();
