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
  var UPD_T = 0, UPD_BUSY = false; // son denetim zamanı (sn), denetim sürüyor mu
  var LANG = 'en';
  var CLOCK = 0;                // sunucu saati - istemci saati (sn)
  var UI = { gf: 'all', gq: '', ef: 'all', cf: 'all', open: {}, evLimit: 40, commits: false, st: 'notify', gs: 'added', gd: -1, gp: 0, pp: 0, cd: 30, menu: null, at: 'atk',
             tab: location.hash === '#settings' ? 'settings' : location.hash === '#history' ? 'history' : 'overview', asnAll: false };
  var CFG = null, DRAFT = {}, cfgLoading = false;
  var pollTimer = null, wasRunning = false, busy = false, CONN = null, LAST_OK = 0, HIDDEN_DUE = false;

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
     
      dry: 'Deneme turu', dry_h: 'Hiçbir şeyi değiştirmeden bir turun ne yapacağını gösterir.', sb_last_h: 'Tur: eklentinin banları tarayıp karar verdiği her çalışma (cron ile düzenli çalışır).', run: 'Şimdi çalıştır', run_log: 'Tur çıktısı',
      upd_avail: '<b>Güncelleme var:</b> v{0} → v{1}', upd_commits: '{0} değişiklik', upd_show: 'Değişiklikleri gör', upd_hide: 'Gizle',
      upd_apply: 'Güncelle', upd_dirty: 'Sunucudaki kopyada yerel değişiklik var; güncelleme SSH üzerinden yapılmalı. Neyin değiştiğine kurulum klasöründe git status ile bakabilirsiniz.',
      upd_diverged: 'Sunucudaki kopya GitHub\'dakinden ayrılmış; güncelleme SSH üzerinden yapılmalı. Kurulum klasöründe git status ile bakabilirsiniz.',
      k_perm: 'Kalıcı liste', k_temp: 'Geçici liste', k_groups: 'Aktif blok banı', k_review: 'Kontrol edilecek',
      k_lines: '{0} / {1} satır', k_nolimit: 'limit tanımsız', k_dnd: '{0} tanesi do not delete', k_review_m: 'son {0} gün',
      s_review: 'Kontrol edilecekler', s_review_h: 'Otomatik banlanmayan ama bakmanız önerilenler: şüpheli ağlar ve beyaz liste yüzünden atlanan bloklar.',
      s_groups: 'Aktif blok banları', s_events: 'Son işlemler', s_lookup: 'IP sorgula', s_pending: 'İzlenenler',
      s_pending_h: 'Bir kez geçici blok banı almış bloklar. İzleme süresi içinde tekrar saldırırlarsa kalıcı blok banı alırlar (do not delete).', s_ignored: 'Yoksayılanlar', s_config: 'Kurallar',
      lookup_ph: '185.220.101.12', lookup_btn: 'Sorgula', lookup_hint: 'Hostname, sahip (ASN), duyurulan aralık, kayıt ve CSF listelerindeki durumu.',
      f_all: 'Tümü', f_perm: 'Kalıcı', f_dnd: 'Do not delete', f_temp: 'Geçici', f_manual: 'Elle', g_search: 'CIDR, AS ya da kurum',
      e_all: 'Tümü', e_bans: 'Banlar', e_warn: 'Şüpheli ağlar', e_skip: 'Atlananlar', e_manual: 'Elle işlemler', e_clean: 'Temizlik', cf_all: 'Tümü', cf_config: 'Ayar değişiklikleri', cf_test_mail: 'Test mailleri', cf_digest: 'Haftalık özetler',
      ev_add24: 'Blok banı', ev_promote: 'Kalıcıya alındı', ev_temp24: 'Geçici blok banı', ev_skip_wl: 'Atlandı', ev_warn16: 'Şüpheli ağ',
      ev_warn16t: 'Şüpheli ağ', ev_clean_temp: 'Geçici ban silindi', clean_d: 'zaten kalıcı listede (tekil ya da blok banı içinde)', ev_manual_ban: 'Elle ban', ev_manual_unban: 'Kaldırıldı',
      ev_manual_forget: 'İzlemeden çıkarıldı', ev_manual_ignore: 'Yoksayıldı', ev_manual_unignore: 'Yoksayma kalktı',
      kind_perm: 'kalıcı', kind_promoted: 'tekrar gelen', kind_temp: 'geçici', kind_manual: 'elle', kind_perm_h: 'Kalıcı blok banı: blokta yeterince kalıcı tekil ban (tek IP) birikince eklendi.', kind_promoted_h: 'Tekrar gelen: önce 12 saatlik geçici blok banı aldı, izleme süresi içinde tekrar saldırınca kalıcı yapıldı.', kind_temp_h: 'Geçici blok banı: süresi dolunca kalkar; izleme süresi içinde tekrar gelirse kalıcı olur.', kind_manual_h: 'Elle: panelden eklendi.', kind_dnd_h: 'do not delete: CSF, liste dolsa bile bu banı silmez.', evh_add24: 'Blok banı: blokta (/24) yeterince kalıcı tekil ban birikince blok kalıcı banlandı, tekiller silindi.', evh_promote: 'Kalıcıya alındı: daha önce geçici blok banı almış blok, izleme süresi içinde tekrar geldiği için kalıcı yapıldı.', evh_temp24: 'Geçici blok banı: blokta yeterince geçici tekil ban birikince 12 saatliğine banlandı ve izlemeye alındı.', evh_skip_wl: 'Atlandı: ban eşiğine ulaştı ama bir beyaz liste kaydıyla çakıştığı için banlanmadı.', evh_warn16: 'Şüpheli ağ: ağda (/16) birçok bloktan kalıcı tekil ban birikti. Ağ banlanmaz; bakmanız önerilir.', evh_warn16t: 'Şüpheli ağ: ağda (/16) birçok bloktan geçici tekil ban birikti. Ağ banlanmaz; bakmanız önerilir.', evh_clean_temp: 'Geçici ban silindi: IP zaten kalıcı listede olduğu için geçici banı gereksizdi.', evh_expire: 'Eski blok kaldırıldı: eski blok banı sınırını geçtiği için kaldırıldı.', evh_manual: 'Elle işlem: panelden biri tarafından yapıldı.', rep_h: 'Bu ağ son günlerde {0} ayrı gün şüpheli olarak işaretlendi.', p_why: 'Geçici blok banı: {0}', p_why_none: 'sebebi kayıtlı değil (olay kaydı başlamadan izlemeye alınmış)', cov_info: '{0} · {1} eklendi', cov_why: 'Banın sebebi: {0}', own_why: 'Bu IP\'nin sebebi: {0}', asn_why: 'en sık: {0}',
      ips: 'IP\'ler', hide: 'Gizle', ban16: 'Ağı banla (/16)', ban24: 'Bloğu banla (/24)', mode_h: 'Ne kapatılsın', imp_same: 'Şu anki kayıtlarda değişen bir şey olmazdı; etkisi bundan sonra gelen banlarda görülür.', imp_up: 'Yüksek eşik mevcut banları kaldırmaz; bundan sonra aynı sonuç için daha çok tekil ban gerekir.', h_part_sug: 'Bu aralıktan gelen saldırılar yalnız şu servislere: {0}. Aralığın geri kalanını kesmeden, yalnız bunları kapatan kısmi ban da yetebilir.', h_part_go: 'Seçilen servislere geç', svc_other: 'diğer', svc_scan: 'port taraması', ub_info: '{0} konmuş · {1}', ub_info0: '{0} konmuş', ub_since: 'Bu kısmi ban konduktan sonra aynı aralıktan diğer servislere yeni banlar geldi: {0}. Tam ban daha uygun olabilir.', l_blk: 'Bloğun durumu', blk_left: 'Bu blokta {0} tekil ban var; eşik {1}. {2} tane daha gelirse blok otomatik banlanır.', blk_over: 'Bu blokta {0} tekil ban var ve eşik ({1}) aşıldı: bir sonraki turda banlanması beklenir. Beyaz listedeyse ya da yoksayılmışsa Dikkat edilecekler\'de görünür.', blk_tleft: 'Geçici listede bu bloktan {0} IP var; eşik {1}. {2} tane daha gelirse blok geçici banlanır.', blk_tover: 'Geçici listede bu bloktan {0} IP var ve eşik ({1}) aşıldı: bir sonraki turda geçici banlanması beklenir (beyaz listede değilse).', imp_b: 'Bu değerle, şu anki tekil banlardan yaklaşık {0} blok daha banlanırdı.', imp_n: 'Bu değerle, şu anki tekil banlardan yaklaşık {0} ağ daha şüpheli olarak bildirilirdi.', imp_tb: 'Bu değerle, şu anki geçici banlardan yaklaşık {0} blok daha geçici banlanırdı.', imp_tn: 'Bu değerle, şu anki geçici banlardan yaklaşık {0} ağ daha şüpheli olarak bildirilirdi.', r_narrow: 'Tekillerin {1} / {2}\'si {0} bloğunda; bütün ağ yerine o bloğu banlamak yetebilir.', r_svc: 'saldırılar: {0}', svc_att_h: '{0} IP bu servise saldırmış (ban sebeplerine göre)', h_no_att: 'Bu aralıkta kayıtlı bir saldırı sebebi yok; kapatılacak servisleri seçin.', h_att_pre: 'Bu aralıktan saldırı görülen servisler işaretlendi: {0}.', h_scan: 'Bu aralıktan port taraması da kayıtlı ({0} IP); "Her şey" daha uygun olabilir.', h_exc_att: 'Açık bıraktığınız servislerden bazılarına bu aralıktan saldırı kayıtlı: {0}.', h_exc_pick: 'Açık kalacak servisleri seçin; saldırı görülen servisler önceden işaretlenmez.', sum_close: 'Kapanır', sum_open: 'Açık kalır', sum_all_close: 'bu aralıktan gelen ve bu aralığa giden her şey', sum_all_open: 'hiçbir şey', sum_svc_close: 'bu aralıktan şunlara gelen bağlantılar: {0}', sum_svc_open: 'diğer her şey; sunucudan bu aralığa giden bağlantılar da', sum_exc_close: 'bu aralıktan gelen ve bu aralığa giden diğer her şey', sum_none: 'henüz seçim yok', sum_dns2: 'DNS (iki yönde)', mode_all: 'Her şey', mode_svc: 'Seçilen servisler', mode_exc: 'Her şey, şunlar hariç', md_all: 'Aralıktan gelen ve aralığa giden bütün bağlantılar kesilir.', md_svc: 'Yalnız seçtiğiniz servislere bu aralıktan gelen bağlantılar kapanır; diğer her şey açık kalır. Sunucudan bu aralığa giden bağlantılar (posta, DNS, web istekleri) etkilenmez.', md_exc: 'Aralık tamamen kesilir, seçtiğiniz servisler açık kalır. Her servis için CSF\'ye iki yönlü izin satırı eklenir; ban kaldırılınca bu satırlar da kaldırılır.', svc_h_block: 'Kapatılacak servisler', svc_h_in: 'Açık kalsın · bu aralıktan gelen', svc_h_out: 'Açık kalsın · sunucudan bu aralığa giden', svc_web: 'Web', svc_ssh: 'SSH', svc_ftp: 'FTP', svc_cp: 'cPanel · WHM · Webmail', svc_min: 'Gelen posta', svc_sync: 'Posta eşitleme', svc_dns: 'DNS', svc_mout: 'Giden posta', svc_wout: 'Giden web', svc_pasv: 'pasif {0}', svc_ports: 'port {0}', svc_x_svc: 'Başka portlar', svc_x_exc: 'Başka portlar (gelen)', svc_x_ph: 'ör. 8080, 30000-35000', h_dns_mail: 'Posta için DNS de gerekebilir: bu sunucu alan adlarının DNS\'ini de yapıyorsa, karşı posta sunucuları posta teslim etmeden önce MX kaydını, sizden gelen postayı alırken de SPF, DKIM ve DMARC kayıtlarını buradan sorgulayabilir. DNS kapalı kalırsa posta gecikebilir ya da hiç ulaşmayabilir.', h_dns_web: 'Web için DNS de gerekebilir: bu aralıktaki arama motoru botları ve ziyaretçiler, sitelere bağlanmadan önce alan adlarını bu sunucunun DNS\'inden çözüyor olabilir.', h_cp_exc: 'cpanel.alanadi.com gibi adresler web portundan (443) çalışır; onların da açık kalması için Web\'i de seçin.', h_cp_svc: 'cPanel, WHM ve Webmail\'e cpanel.alanadi.com gibi adreslerle web portundan (443) da girilebilir; tamamen kapatmak için Web\'i de seçin.', h_dns_blk: 'DNS\'i kapatmak, bu sunucu alan adlarının DNS\'ini de yapıyorsa bu aralıktan gelen posta ve ziyaretleri de etkileyebilir.', h_ftp_nopasv: 'FTP\'nin pasif port aralığı bulunamadı; dosya aktarımı da çalışsın diye o aralığı "Başka portlar"a ekleyin (ör. 30000-35000).', h_chg_restore: 'Kısmi bana çevrilince, bu ban konurken kaldırılan {0} kayıt geri yüklenir; kısmi ban aralığı tamamen kapsamaz.', m_svc_t: '{0} için seçilen servisler kapatılsın mı?', m_svc_b16: 'Ağdaki 65.536 adresten seçtiğiniz servislere gelen bağlantılar engellenir. Ban "do not delete" olarak eklenir; liste dolduğunda da silinmez.', m_svc_b24: 'Bloktaki 256 adresten seçtiğiniz servislere gelen bağlantılar engellenir. Ban "do not delete" olarak eklenir; liste dolduğunda da silinmez.', m_chg_t: 'Banı değiştir: {0}', chg_btn: 'Değiştir', chg: 'Banı değiştir', in_clean_na: 'Kapsananlar kaldırılmaz', in_clean_na_d: 'Kısmi ban aralığı tamamen kapsamadığı için içindeki banlar yerinde kalır; onlar diğer servisleri de kapatıyor.', in_part: 'Kısmi banlar', in_part_repl: 'yenisiyle değiştirilir', in_watch_keep: 'izlenmeye devam eder', kind_partial: 'kısmi', kind_partial_h: 'Kısmi ban: yalnız seçilen servislere bu aralıktan gelen bağlantılar kapalı; diğer her şey açık.', f_partial: 'Kısmi', g_closed: 'kapalı: {0}', g_open: 'açık: {0}', l_part_net: 'Kısmi (ağ)', l_part_blk: 'Kısmi (blok)', l_part_rng: 'Kısmi (/{0})', l_part_d: 'kapalı: {0} · bu aralıktan gelen; diğer bağlantılar açık', l_open: 'açık bırakılanlar: {0}', ev_svc: 'kısmi · kapalı: {0}', ev_exc: 'açık: {0}', ev_full: 'tam ban', ev_manual_change: 'Ban değiştirildi', ban_btn: 'Banla', m_ban24_t: '{0} kalıcı olarak banlansın mı?', m_ban24_b: 'Bu, bloktaki 256 adresin tamamını engeller. Ban "do not delete" olarak eklenir; liste dolduğunda da silinmez.', in_loading: 'İçindekiler okunuyor…', in_h: 'İçinde şu an', in_blocks: 'Blok banları', in_singles: 'Tekil banlar', in_temps: 'Geçici banlar', in_watched: 'İzlenen bloklar', in_others: 'Başka aralıklar', in_owner: 'Sahip', in_none: 'İçinde başka kayıt yok.', in_watch_end: 'izlemeleri biter', in_oth_keep: 'dokunulmaz', in_clean0: 'Kapsananları kaldır', in_clean_d: 'Aralığın içindeki kalıcı kayıtlar (do not delete olanlar ve başka aralıklar dahil) kalıcı listeden, geçici banlar geçici listeden silinir. Silinen kalıcı kayıtlar saklanır; bu ban kaldırılırken isterseniz eski hâlleriyle geri yüklenir. Geçici banlar geri yüklenmez, süreleri zaten dolacaktı. "do not delete" satırları CSF\'in liste sınırına girmediği için boşalan satırlara sayılmaz.', in_cover: 'Bu aralık zaten banlı: {0}', in_wl: 'Beyaz listeyle çakışıyor:', under: '{0} içinde', under_h: 'Bu blok {0} banının içinde; ayrıca gerekmiyor. Kaldırmak kalıcı listede bir satır boşaltır.', under_hp: 'Bu blok {0} banının içinde; izlemenin anlamı kalmadı.', l_perm_net: 'Kalıcı (ağ)', l_perm_rng: 'Kalıcı (/{0})', l_port: 'Port sınırlı · {0} {1} kapalı · {2}', l_ccd_cc: 'Ülke banlı · CC_DENY {0}', l_ccd_asn: 'ASN banlı · CC_DENY {0}', l_ccp: 'Port sınırlı · CC_DENY_PORTS {0} · {1}', l_ccd_src: 'Ülke ve ASN burada Team Cymru\'dan; CSF kendi veritabanını kullanır, nadiren farklı olabilir.', ev_removed: '{0} kayıt kaldırıldı', r_partial: 'bu ağda kısmi ban var: {0}', m_unban_part: 'Kısmi ban kaldırılır; bu aralıktan seçili servislere gelen bağlantılar yeniden açılır. İçindeki diğer banlar yerinde kalır.', ev_restored: '{0} kayıt geri yüklendi', m_restore_d: 'Kayıtlar kalıcı listeye eski yorum ve tarihleriyle döner, do not delete işaretleri dahil. İşaretlemezseniz saklanan kayıtlar silinir.', m_restore: 'Bu ban konurken kaldırılan {0} kaydı geri yükle', m_unban_rb: 'Ban kalıcı listeden kaldırılır.', in_free_pt: 'kalıcı listede {0} satır, geçici listede {1} kayıt boşalır', in_free_t: 'geçici listede {0} kayıt boşalır', in_free_p: 'kalıcı listede {0} satır boşalır', in_sgl_dnd: '{0} do not delete dahil', in_keep: 'kalır', in_rm: 'kaldırılır', dir_in: 'gelen', dir_out: 'giden', in_ports: 'Port sınırlı satırlar', in_self: 'Bu aralıkta sunucunun kendi IP\'si var ({0}); banlanamaz.', ban_anyway: 'Yine de banla', ignore: 'Yoksay', unban: 'Kaldır',
      promote: 'Kalıcı yap', forget: 'İzlemeden çıkar', unignore: 'Kaldır', show_all: 'Tümünü göster ({0})', more: 'Daha fazla',
      n_ip: '{0} IP', n_subnets: '{0} farklı blok', from_temp: 'geçici banlardan', from_perm: 'kalıcı banlardan', days_left: '{0} gün kaldı',
      ttl_left: 'geçici ban: {0} kaldı', until: '{0} tarihine kadar', by: '{0} tarafından', wl: 'beyaz liste: {0}', and_more: '+{0} IP daha',
      no_review: 'Göz atılacak bir şey yok.', no_groups: 'Aktif blok banı yok.', no_pending: 'İzlenen blok yok.',
      no_events: 'Henüz kayıt yok. İlk turdan sonra burada görünecek.', no_match: 'Eşleşen kayıt yok.',
      c_t24: 'Blok banı (/24)', c_t24p: 'Do not delete eşiği', c_t16: 'Şüpheli ağ (/16)', c_tt24: 'Geçici blok banı (/24)', c_tt16: 'Şüpheli ağ, geçici banlardan (/16)',
      c_ret: 'İzleme süresi', c_lookup: 'Sahip / hostname sorgusu', c_on: 'açık', c_off: 'kapalı', c_days: '{0} gün', c_singles: '≥ {0} tekil', c_gloss: 'tekil = tek IP banı · blok = /24 · ağ = /16 · do not delete = CSF liste dolsa da silmez',
      now: 'az önce', min_ago: '{0} dk önce', h_ago: '{0} sa önce', d_ago: '{0} gün önce', dur_h: '{0} sa {1} dk', dur_m: '{0} dk',
      cancel: 'Vazgeç', confirm: 'Onayla', close: 'Kapat', reload: 'Sayfayı yenile', type_to_confirm: 'Onaylamak için {0} yazın',
      m_ban16_t: '{0} kalıcı olarak banlansın mı?', m_ban16_b: 'Bu, ağdaki 65.536 adresin tamamını engeller. Ban "do not delete" olarak eklenir; liste dolduğunda da silinmez.',
      m_force_t: 'Beyaz listeye rağmen banlansın mı?', m_force_b: 'Bu blok CSF beyaz listelerinden biriyle çakışıyor:',
      m_force_n: 'csf.allow\'daki adresler bu ban olsa da erişmeye devam eder. csf.ignore ve diğer listelerdekiler ise engellenir.',
      m_promote_t: '{0} şimdi kalıcı yapılsın mı?', m_promote_b: 'Blok "do not delete" olarak kalıcı listeye eklenir ve izlemeden çıkarılır.',
      m_forget_t: '{0} izlemeden çıkarılsın mı?', m_forget_b: 'Bu bloktan bir sonraki saldırı yine "ilk kez" sayılır ve 12 saatlik geçici blok banı alır.',
      m_unban_t: '{0} kaldırılsın mı?', m_unban_b: 'Blok banı kaldırılır. Blok banı eklenirken silinen tekil banlar geri gelmez; bu adresler tamamen açılır.',
      m_unban_dnd: 'Bu ban "do not delete" işaretli. Kaldırmak için csf.deny\'deki işaret önce silinir (dosyanın yedeği alınır).',
      m_ignore_t: '{0} yoksayılsın mı?', m_ignore_b: 'Bu kayıt Kontrol edilecekler listesinden gizlenir; şüpheli ağsa (/16) uyarı maili de gelmez.', m_ignore_d: 'Süre',
      m_unignore_t: '{0} tekrar izlensin mi?', m_run_t: 'Tur şimdi çalıştırılsın mı?',
      m_run_b: 'Zamanlanmış turun (cron) yaptığının aynısı şimdi yapılır: eşiği geçen bloklar banlanır, bildirimler gönderilir.',
      m_dry_t: 'Deneme turu', m_dry_wait: 'Tur hiçbir şeyi değiştirmeden simüle ediliyor…', m_dry_none: 'Bu tur hiçbir değişiklik yapmazdı.',
      m_upd_t: 'v{0} sürümüne güncellensin mi?', m_upd_b: 'update.sh çalıştırılır; config.env ve kayıtlar korunur. Birkaç saniye sürer.',
      m_upd_run: 'Güncelleniyor…', m_upd_ok: 'Güncelleme tamamlandı.', m_upd_fail: 'Güncelleme tamamlanamadı; çıktıya bakın.',
      t_started: 'Tur başlatıldı.', t_done: 'Tur tamamlandı.', t_busy: 'Başka bir tur çalışıyor, birazdan tekrar deneyin.', t_cron_busy: 'Bir tur zaten çalışıyor (büyük olasılıkla cron); bitince sonuçlar burada görünecek.',
      t_err: 'İşlem tamamlanamadı: {0}', session: 'Oturum süresi doldu. Sayfayı yenileyin.', t_copied: 'Kopyalandı.',
      l_host: 'Hostname', l_fwd: 'ad tekrar bu IP\'ye çözülüyor (doğrulandı)', l_nofwd: 'ad bu IP\'ye geri çözülmüyor (doğrulanamadı)', l_noptr: 'Ters DNS kaydı yok',
      l_owner: 'Sahip', l_prefix: 'Duyurulan aralık', l_reg: 'Kayıt', l_fw: 'Güvenlik duvarı', l_wl: 'Beyaz liste',
      l_pending: 'İzleniyor', l_ign: 'Yoksayılıyor', l_notbanned: 'Engelli değil', l_none: 'Yok', l_perm_single: 'Kalıcı (tekil)',
      l_perm_cover: 'Kalıcı (blok)', l_temp: 'Geçici', l_nolookup: 'Sahip ve hostname sorguları kapalı (LOOKUP=0).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Kopyala', bad_ip: 'Geçerli bir IPv4 adresi yazın.',
      foot: 'CSF Auto-Group v{0} · {1} olarak oturum açıldı',
      tab_overview: 'Genel bakış', tab_settings: 'Ayarlar', tab_history: 'Geçmiş', show_less: 'Daha az göster', s_cfglog: 'Ayar geçmişi', ev_loading: 'Yükleniyor…', singles_s: 'tekil', kd_week: 'bu hafta', kd_lines: 'satır', kd_same: 'değişmedi', kr_ring: '{1} kaydın {0} tanesi atlanan blok', kr_warn: 'şüpheli ağ', kr_skip: 'atlandı', st_upd: 'Sürüm ve güncelleme', upd_check: 'Güncellemeleri denetle', upd_checking: 'Denetleniyor…', upd_cur: 'Kurulu sürüm', upd_ok: 'Güncel', upd_new: 'Yeni sürüm var: v{0}', upd_last: 'Son denetim: {0}', upd_never: 'Henüz denetlenmedi', upd_auto: 'Sayfa açıkken yarım saatte bir kendiliğinden de denetlenir; yeni sürüm çıkınca üstte bildirim belirir.', upd_err_not_git: 'Kurulum bir git deposu değil; arayüzden güncelleme yapılamaz (update.sh de çalışmaz).', upd_err_unreachable: 'GitHub\'a ulaşılamadı; biraz sonra tekrar deneyin.', upd_err_detached: 'Depo bir dala bağlı değil; güncelleme SSH üzerinden yapılmalı.', c_auto_on: '{0} günü geçen blok banları her turda kendiliğinden kaldırılır', c_auto_off: '{0} günü geçen blok banları Eski süzgecinde toplanır, kendiliğinden kaldırılmaz', hc_csf: 'CSF', hc_lfd: 'LFD', hc_cron: 'Cron', hc_csf_ok: 'Güvenlik duvarı kuralları yüklü', hc_csf_off: 'CSF devre dışı (csf.disable)', hc_csf_testing: 'CSF test modunda (TESTING = 1)', hc_csf_norules: 'CSF kuralları yüklü değil', hc_csf_unknown: 'Durum okunamadı (iptables yok)', hc_lfd_ok: 'LFD çalışıyor', hc_lfd_down: 'LFD çalışmıyor: yeni ban gelmez', hc_cron_ok: 'Turlar zamanında çalışıyor', hc_cron_late: 'Tur gecikti', sb_fw: 'Güvenlik duvarında sorun var', f_old: 'Eski', old_h: '{0} blok banı {1} günden eski.', old_auto: 'Otomatik kaldırma açık; sıradaki turda kaldırılacaklar.', old_manual: 'Otomatik kaldırma kapalı (Ayarlar → Saklama).', old_rm: 'Eskileri kaldır ({0})', m_exp_t: '{0} eski blok banı kaldırılsın mı?', m_exp_b: '{1} günden eski {0} blok banı csf.deny\'den kaldırılır (do not delete olanlar da). Bu bloklardan tekrar saldırı gelirse yeniden banlanırlar. csf.deny önce yedeklenir.', ev_expire: 'Eski blok kaldırıldı', exp_age: '{0} gün önce eklenmişti', rep_n: 'tekrar ediyor · {0} gün', k_BLOCK_EXPIRE_DAYS: 'Eski blok banı sınırı (gün)', h_BLOCK_EXPIRE_DAYS: 'Bu süreden eski blok banları Aktif blok banları tablosunda "Eski" filtresinde toplanır.', k_BLOCK_EXPIRE_AUTO: 'Eski blok banlarını otomatik kaldır', h_BLOCK_EXPIRE_AUTO: 'Açıksa her turda bu süreden eski blok banları kaldırılır ve mailde bildirilir. Elle eklenen banlara dokunulmaz.', from_log: 'eklentinin günlüğünden', sn_server: 'Sunucu', st_deps: 'Sunucu gereksinimleri', st_deps_h: 'Eklentinin kullandığı araçlar ve eksik olduğunda ne olduğu.', dep_ok: 'Var', dep_missing: 'Yok', dep_warn: 'Eksik', dep_opt: 'isteğe bağlı', dep_csf: 'Güvenlik duvarı; banları o uygular.', dep_csf_x: 'Zorunlu: CSF olmadan hiçbir şey çalışmaz.', dep_crontab: 'Turları zamanında çalıştırır.', dep_crontab_x: 'Turlar otomatik çalışmaz; zamanlama Ayarlar\'dan değiştirilemez.', dep_mail: 'Uyarı mailleri ve haftalık özet.', dep_mail_x: 'Uyarı mailleri ve haftalık özet gönderilmez.', dep_dns: 'Sahip ve hostname sorguları.', dep_dns_x: 'Sahip ve hostname bilgisi olmaz; CC_IGNORE / CC_ALLOW ve csf.rignore kontrol edilemez, bu listelere dayanan bloklar banlanmaz.', dep_logrotate: 'Günlük dosyası büyüyünce arşivler (eskisini sıkıştırıp saklar, yeni dosya açar).', dep_logrotate_x: 'Günlük, satır sınırıyla kesilir (yedek yöntem).', dep_logrotate_w: 'Kurulu ama ayar dosyası yok; günlük şimdilik satır sınırıyla kesiliyor. update.sh ya da install.sh ile yeniden kurun.', dep_flock: 'Aynı anda tek tur çalışmasını sağlar.', dep_flock_x: 'Üst üste binen turlara karşı koruma olmaz.', dep_timeout: 'Eklentinin çalıştırdığı komutlara zaman sınırı koyar.', dep_timeout_x: 'Takılan bir komut sayfayı bekletebilir.', dep_git: 'Arayüzden güncelleme.', dep_git_x: 'Güncelleme kontrolü ve Güncelle düğmesi çalışmaz.', dep_modsec: 'cPanel\'in eşleşme kaydı (Uyuşanlar Listesi) var; ban sebeplerinde ModSecurity kuralının mesajı görünür.', dep_modsec_w: 'cPanel eşleşme kaydı yok; mesajlar ModSecurity günlüğü ve kural dosyasından okunuyor (Imunify kuralları yalnız numarayla görünebilir).', dep_modsec_x: 'ModSecurity günlüğü bulunamadı; ban sebeplerinde kurallar yalnız numarayla görünür.', dep_sqlite3: 'ModSecurity eşleşme kaydını okur.', dep_sqlite3_x: 'Eşleşme kaydı okunamaz; mesajlar ModSecurity günlüğü ve kural dosyasından okunur (Imunify kuralları yalnız numarayla görünebilir).', dep_imunify: 'Sağlayıcılar kartındaki Imunify sekmesi; Imunify beyaz listesindeki IP\'lerin bloğu banlanmaz.', dep_imunify_x: 'Imunify sekmesi görünmez; Imunify beyaz listesi kontrol edilmez (CSF listeleri yine kontrol edilir).', k_logfile: 'Günlük dosyası', log_rot: 'logrotate: {2} MB\'ı geçince arşivlenir, son {3} arşiv saklanır · şu an {0} · {1} arşiv.', k_LOG_ROTATE_MB: 'Günlük boyutu (MB)', h_LOG_ROTATE_MB: 'Günlük bu boyutu geçince arşivlenir: eskisi sıkıştırılıp saklanır, yeni dosya açılır (logrotate günde bir kontrol eder).', k_LOG_ROTATE_KEEP: 'Arşiv sayısı', h_LOG_ROTATE_KEEP: 'Kaç eski günlük arşivinin (sıkıştırılmış) saklanacağı.', log_lines: 'Şu an {0} / {1} satır.', no_cfglog: 'Henüz ayar değişikliği yok.', ev_config: 'Ayar değişti', ev_test_mail: 'Test maili',
      st_notify: 'Bildirim', st_mail: 'Uyarı maili adresi', st_mail_h: 'Tur bildirimleri (blok banları, şüpheli ağlar, liste doluluğu, güvenlik duvarı sorunları) ve haftalık özet buraya gider. root@localhost, cPanel\'de sunucunun iletişim adresine yönlenir.',
      st_lang: 'Dil', st_lang_h: 'Günlük, mail ve bu panelin dili.', st_test: 'Test maili gönder', st_test_h: 'Kayıtlı adrese gönderilir.',
      st_test_dirty: 'Önce yeni adresi kaydedin.', mail_whm: 'WHM iletişim adresi', mail_custom: 'Başka adres', mail_whm_h: 'WHM → Basic WebHost Manager Setup\'taki iletişim adresine gider: {0}. Adresi WHM\'de değiştirirseniz eklenti de ona gönderir.', mail_whm_none: 'WHM\'de iletişim adresi bulunamadı; root@localhost\'a gider.', ic_ev_h: 'Güvenlik duvarı sorunu ve liste doluyor hemen gider (başladığında ve düzeldiğinde birer kez). Tur bildirimleri Slack\'i kalabalıklaştırmasın diye saatte en fazla bir mesajda toplanır. Haftalık özet seçilen günde.', ic_fw: 'Güvenlik duvarı sorunu', ic_list: 'Liste doluyor', ic_run: 'Tur bildirimleri', ic_digest: 'Haftalık özet', st_notify_ch: 'Bildirim kanalları', nt_all: 'WHM\'deki tüm kanallar', nt_email: 'Yalnız e-posta', nt_slack: 'Yalnız Slack', nt_h_mail: 'E-posta: {0}', nt_h_slack: 'Slack: WHM\'deki kanal', nt_h_noslack: 'Slack: WHM\'de tanımlı değil', nt_h: 'Adresler WHM\'den alınır (Basic WebHost Manager Setup); gönderimi eklenti yapar.', st_slack_ev: 'Slack\'e gidecekler', k_NOTIFY: 'Bildirim kanalları', ic_test: 'Slack\'e deneme gönder', ic_test_h: 'Ayarlardan bağımsız, WHM\'deki Slack kanalına hemen gönderilir.', k_IC_FIREWALL: 'Slack: güvenlik duvarı sorunu', k_IC_LISTFULL: 'Slack: liste doluyor', k_IC_RUN: 'Slack: tur bildirimleri', k_IC_DIGEST: 'Slack: haftalık özet', st_thr: 'Eşikler', st_thr_h: 'Ne zaman ban konacağı ya da uyarı verileceği; hepsi tekil (tek IP) ban sayısıyla ölçülür.',
      k_THRESHOLD_24: 'Blok banı (/24)', h_THRESHOLD_24: 'Bir blokta (/24) bu kadar kalıcı tekil ban (tek IP) olunca blok banlanır.',
      k_THRESHOLD_24_PERMANENT: 'Do not delete eşiği', h_THRESHOLD_24_PERMANENT: 'Bu kadar tekil olunca blok banı "do not delete" işareti alır: CSF, liste dolsa bile bu banı silmez. Blok banı eşiğinden küçük olamaz.',
      k_THRESHOLD_16: 'Şüpheli ağ (/16)', h_THRESHOLD_16: 'Bir ağda (/16), en az 2 farklı bloktan bu kadar kalıcı tekil ban (tek IP) olunca şüpheli ağ olarak bildirilir. Ağ banlanmaz.',
      k_THRESHOLD_TEMP_24: 'Geçici blok banı (/24)', h_THRESHOLD_TEMP_24: 'Bir blokta bu kadar geçici tekil ban (tek IP) olunca: ilk sefer 12 saatlik geçici blok banı, tekrar gelirse kalıcı.',
      k_THRESHOLD_TEMP_16: 'Şüpheli ağ, geçici banlardan (/16)', h_THRESHOLD_TEMP_16: 'Bir ağda (/16), en az 2 farklı bloktan bu kadar geçici tekil ban (tek IP) olunca şüpheli ağ olarak bildirilir. Ağ banlanmaz.',
      st_sched: 'Zamanlama', st_sched_h: 'Turların cron ile ne sıklıkla çalışacağı.', cron_5: '5 dk', cron_10: '10 dk', cron_15: '15 dk', cron_30: '30 dk', cron_0: 'Saatte bir',
      st_lookup: 'Sorgular', k_LOOKUP: 'Sahip ve hostname sorgusu', h_LOOKUP: 'Mailde ve panelde ASN, kurum ve hostname gösterir; CC_IGNORE ve csf.rignore kontrolleri de buna bağlı.',
      k_LOOKUP_TIMEOUT: 'DNS zaman aşımı (sn)', h_LOOKUP_TIMEOUT: 'Her sorgu için bekleme süresi.', st_nodns: 'Sunucuda dig/host yok; sorgular çalışmaz (dnf install bind-utils).',
      on: 'Açık', off: 'Kapalı', st_keep: 'Saklama', k_SAYAC_RETENTION_DAYS: 'İzleme süresi (gün)',
      h_SAYAC_RETENTION_DAYS: 'Geçici banlanmış bir blok bu süre içinde tekrar gelirse kalıcı olur.', k_REVIEW_DAYS: 'Kontrol edilecekler (gün)',
      h_REVIEW_DAYS: 'Şüpheli ağların ve atlanan blokların Kontrol edilecekler listesinde kaç gün kalacağı.', k_LOG_MAX_LINES: 'Günlük satır sınırı', h_LOG_MAX_LINES: 'Günlük bu satır sayısında tutulur (yalnız logrotate yoksa).',
      st_csf: 'CSF liste sınırları', st_csf_h: 'Bunlar CSF\'in kendi ayarları; buradan değil CSF\'ten değiştirilir.',
      csf_deny: 'Kalıcı liste (DENY_IP_LIMIT)', csf_temp: 'Geçici liste (DENY_TEMP_IP_LIMIT)', csf_open: 'CSF ayarlarını aç',
      default_v: 'varsayılan {0}', range_v: '{0}–{1} arası bir tam sayı', mail_bad: 'Geçerli bir e-posta adresi yazın.',
      rule_dnd: 'Do not delete eşiği, blok banı eşiğinden küçük olamaz.', dirty_n: '{0} değişiklik kaydedilmedi', discard: 'Vazgeç',
      try_save: 'Kaydetmeden önce dene', save: 'Kaydet', m_save_t: 'Ayarlar kaydedilsin mi?', m_save_b: 'Şu değişiklikler config.env\'e yazılacak (önce yedek alınır):',
      m_try_t: 'Yeni eşiklerle deneme turu', m_try_b: 'Kaydedilmemiş ayarlarla; hiçbir şey değişmez.',
      auto: 'otomatik', focus_gone: '{0} artık listede değil; güncel durumu gösteriliyor.',
      new_badge: 'Son ziyaretinden beri yeni', actions: 'İşlemler', overdue: 'Tur gecikti · son tur {0} (beklenen aralık {1})',
      since_visit: 'Son ziyaretinden beri ({0}):', sn_add: '{0} blok banı', sn_temp: '{0} geçici blok banı', sn_warn: '{0} şüpheli ağ',
      sn_skip: '{0} atlanan blok', show_new: 'Göster', e_new: 'Son ziyaretten beri', ch_total: '{0} olay', ch_title_n: 'Son {0} gün', ch_d: '{0} gün', sb_ok: 'Koruma çalışıyor', sb_run: 'Tur çalışıyor', sb_late: 'Turlar zamanında çalışmıyor', sb_every: 'Cron her {0}', sb_24: 'son 24 saatte {0}/{1} tur', sb_none: 'henüz tur yok', sb_last: 'Son tur', sb_dur: 'Tur süresi', sb_avg: 'ort. {0}', sb_next: 'Sıradaki', sb_now: 'şimdi', sb_spark: 'Son {0} turun süresi', pg_prev: 'Önceki sayfa', pg_next: 'Sonraki sayfa', dirty_leave: '{0} değişiklik kaydedilmedi. Yine de sekme değiştirilsin mi?', conn_net: 'Sunucuya ulaşılamıyor; gösterilenler {0} alındı. Yeniden deneniyor…', conn_session: 'Oturumun süresi doldu.', upd_busy: 'Bir güncelleme zaten çalışıyor.', sec: '{0} sn', lk_recent: 'Son bakılanlar',
      ch_add: 'Blok banı', ch_promote: 'Kalıcıya alındı', ch_temp: 'Geçici blok banı', ch_warn: 'Şüpheli ağ', ch_skip: 'Atlandı',
      ch_empty: 'Son 30 günde kayıt yok; grafik olay kaydı biriktikçe dolacak.', ipcard: 'IP kartı', col_block: 'Blok', col_owner: 'Sahip', col_since: 'Başlangıç', col_left: 'Kalan', col_state: 'Durum', left_short: '{0} kaldı',
      col_singles: 'Tekil', col_added: 'Eklendi', of_n: '{0}–{1} / {2}', s_asn: 'En çok engellenen sağlayıcılar',
      s_asn_h: 'Blok banı ve tekil bana göre sıralı; csf.deny\'de CSF Auto-Group\'un eklemediği bloklar ayrıca belirtilir · {0} bloğun sahibi biliniyor', p_g: '{0} blok', p_b: '+{0} blok CSF Auto-Group dışından', p_t: '{0} tekil', p_bn: '{0} blok',
      at_atk: 'CSF', at_blk: 'Diğer bloklar', blk_h: 'csf.deny\'de CSF Auto-Group\'un eklemediği aralıklar (elle, LFD ya da başka bir araçla eklenmiş olabilir); zaten engelliler. csfpost.sh gibi doğrudan güvenlik duvarına yazılan kurallar burada görünmez.',
      blk_empty: 'csf.deny\'de CSF Auto-Group\'un eklemediği aralık yok (ya da sahipleri henüz bilinmiyor).',
      im_h: 'Imunify360\'ın bu sunucuda kendi engellediği IP\'ler (merkezi liste değil) · {0} IP, {1} tanesinin sahibi biliniyor. Yalnızca bilgi; CSF\'ye ban yazılmaz.',
      im_n: '{0} IP', im_empty: 'Imunify360 yerel kara listesi boş.', asn_denied: 'CSF\'de zaten engelli',
      asn_hint: 'ASN engelleme önerisi', asn_filling: 'Sahip bilgileri toplanıyor; her turda 50 blok sorgulanır.',
      asn_nolookup: 'Sahip sorgusu kapalı (Ayarlar → Sorgular).', m_asn_t: 'AS{0} sağlayıcısını CSF\'de toptan engellemek',
      m_asn_b: '{1} sağlayıcısından {0} ayrı blok banı eklendi; her biri aynı blokta en az 3 saldırgan demek. Saldırı sürekli bu sağlayıcıdan geliyorsa, sağlayıcının (ASN) tamamını CSF\'nin kendi ülke/ASN engeliyle kapatmak daha kalıcı olur.',
      m_asn_w: 'Bu, o sağlayıcıdaki meşru kullanıcıları da (ör. o sağlayıcıda sunucusu olan müşterileri) engeller. Büyük bulut sağlayıcılarında dikkatli olun.',
      m_asn_s: 'Nasıl: CSF → Firewall Configuration → CC_DENY alanına {0} ekleyin (virgülle ayırarak), kaydedip csf ve LFD\'yi yeniden başlatın. Bu eklenti csf.conf\'u değiştirmez.',
      copy_asn: '{0} kopyala', csf_open2: 'CSF\'yi aç', edit: 'Düzenle', st_digest: 'Haftalık özet',
      st_digest_h: 'Seçilen gün 09:00\'dan sonraki ilk turda gönderilir: yeni blok banları, en çok engellenen sağlayıcılar, izlemesi bitecek bloklar.',
      st_digest_day: 'Gönderim günü', d1: 'Pzt', d2: 'Sal', d3: 'Çar', d4: 'Per', d5: 'Cum', d6: 'Cmt', d7: 'Paz',
      digest_prev: 'Özeti önizle', m_digest_t: 'Haftalık özet önizlemesi', ev_digest: 'Haftalık özet'
    },
    en: {
     
      dry: 'Dry run', dry_h: 'Shows what a run would do without changing anything.', sb_last_h: 'Run: each time the plugin scans the bans and acts on them (on a cron schedule).', run: 'Run now', run_log: 'Run output',
      upd_avail: '<b>Update available:</b> v{0} → v{1}', upd_commits: '{0} changes', upd_show: 'View changes', upd_hide: 'Hide',
      upd_apply: 'Update', upd_dirty: 'The server copy has local changes; update over SSH. Run git status in the install folder to see what changed.',
      upd_diverged: 'The server copy has diverged from GitHub; update over SSH. Run git status in the install folder to see the state.',
      k_perm: 'Permanent list', k_temp: 'Temp list', k_groups: 'Active block bans', k_review: 'To review',
      k_lines: '{0} / {1} lines', k_nolimit: 'no limit set', k_dnd: '{0} marked do not delete', k_review_m: 'last {0} days',
      s_review: 'To review', s_review_h: 'Not banned automatically but worth a look: suspicious networks and blocks skipped because of a whitelist.',
      s_groups: 'Active block bans', s_events: 'Recent actions', s_lookup: 'Look up an IP', s_pending: 'Watched',
      s_pending_h: 'Blocks that got a temp block ban once. If they attack again within the watch period they get a permanent block ban (do not delete).', s_ignored: 'Ignored', s_config: 'Rules',
      lookup_ph: '185.220.101.12', lookup_btn: 'Look up', lookup_hint: 'Hostname, owner (ASN), announced range, registry and status in the CSF lists.',
      f_all: 'All', f_perm: 'Permanent', f_dnd: 'Do not delete', f_temp: 'Temp', f_manual: 'Manual', g_search: 'CIDR, AS or org',
      e_all: 'All', e_bans: 'Bans', e_warn: 'Suspicious', e_skip: 'Skipped', e_manual: 'Manual', e_clean: 'Cleanup', cf_all: 'All', cf_config: 'Settings changes', cf_test_mail: 'Test emails', cf_digest: 'Weekly summaries',
      ev_add24: 'Block ban', ev_promote: 'Made permanent', ev_temp24: 'Temp block ban', ev_skip_wl: 'Skipped', ev_warn16: 'Suspicious network',
      ev_warn16t: 'Suspicious network', ev_clean_temp: 'Temp ban removed', clean_d: 'already in the permanent list (single or inside a block ban)', ev_manual_ban: 'Manual ban', ev_manual_unban: 'Removed',
      ev_manual_forget: 'Unwatched', ev_manual_ignore: 'Ignored', ev_manual_unignore: 'Unignored',
      kind_perm: 'permanent', kind_promoted: 'repeat offender', kind_temp: 'temp', kind_manual: 'manual', kind_perm_h: 'Permanent block ban: added once enough permanent single (one-IP) bans piled up in the block.', kind_promoted_h: 'Repeat offender: got a 12-hour temp block ban first, then attacked again within the watch period and was made permanent.', kind_temp_h: 'Temp block ban: lifted when it expires; becomes permanent if the block comes back within the watch period.', kind_manual_h: 'Manual: added from the plugin.', kind_dnd_h: 'do not delete: CSF keeps this ban even when the list is full.', evh_add24: 'Block ban: enough permanent single bans piled up in the block (/24), so it was banned permanently and the singles removed.', evh_promote: 'Made permanent: a block that had a temp block ban came back within the watch period, so it was made permanent.', evh_temp24: 'Temp block ban: enough temp single bans piled up in the block, so it was banned for 12 hours and is now watched.', evh_skip_wl: 'Skipped: reached the ban threshold but overlaps a whitelist entry, so it was not banned.', evh_warn16: 'Suspicious network: permanent single bans piled up across several blocks of the network (/16). Networks are never banned; worth a look.', evh_warn16t: 'Suspicious network: temp single bans piled up across several blocks of the network (/16). Networks are never banned; worth a look.', evh_clean_temp: 'Temp ban removed: the IP was already in the permanent list, so its temp ban was redundant.', evh_expire: 'Old block removed: it was older than the old block ban limit.', evh_manual: 'Manual action: done by someone from the plugin.', rep_h: 'This network was flagged as suspicious on {0} separate days recently.', p_why: 'Temp block ban: {0}', p_why_none: 'reason not recorded (watched since before the event log started)', cov_info: '{0} · added {1}', cov_why: 'Ban reason: {0}', own_why: 'This IP: {0}', asn_why: 'most often: {0}',
      ips: 'IPs', hide: 'Hide', ban16: 'Ban network (/16)', ban24: 'Ban block (/24)', mode_h: 'What to block', imp_same: 'Nothing would change for the current entries; the effect shows on bans that come in from now on.', imp_up: 'A higher threshold doesn\'t remove existing bans; from now on more single bans are needed for the same result.', h_part_sug: 'Attacks from this range only target: {0}. A partial ban that blocks just these, without cutting the rest of the range, may be enough.', h_part_go: 'Switch to selected services', svc_other: 'other', svc_scan: 'port scan', ub_info: 'added {0} · {1}', ub_info0: 'added {0}', ub_since: 'Since this partial ban was added, new bans came from the same range to other services: {0}. A full ban may fit better.', l_blk: 'Block status', blk_left: 'This block has {0} single bans; the threshold is {1}. {2} more and the block is banned automatically.', blk_over: 'This block has {0} single bans, over the threshold ({1}): it should be banned on the next run. If it is whitelisted or ignored, it shows up in To review.', blk_tleft: 'The temp list has {0} IPs from this block; the threshold is {1}. {2} more and the block gets a temp ban.', blk_tover: 'The temp list has {0} IPs from this block, over the threshold ({1}): it should get a temp ban on the next run (unless whitelisted).', imp_b: 'At this value, about {0} more blocks would be banned from the current single bans.', imp_n: 'At this value, about {0} more networks would be reported as suspicious from the current single bans.', imp_tb: 'At this value, about {0} more blocks would get a temp ban from the current temp bans.', imp_tn: 'At this value, about {0} more networks would be reported as suspicious from the current temp bans.', r_narrow: '{1} of {2} singles are in {0}; banning that block instead of the whole network may be enough.', r_svc: 'attacks: {0}', svc_att_h: '{0} IPs attacked this service (from ban reasons)', h_no_att: 'No attack reasons are recorded for this range; pick the services to block.', h_att_pre: 'Services this range attacked are selected: {0}.', h_scan: 'Port scans from this range are recorded too ({0} IPs); "Everything" may fit better.', h_exc_att: 'Some of the services you keep open were attacked from this range: {0}.', h_exc_pick: 'Pick the services to keep open; attacked services are not preselected.', sum_close: 'Blocked', sum_open: 'Stays open', sum_all_close: 'everything from and to this range', sum_all_open: 'nothing', sum_svc_close: 'connections from this range to: {0}', sum_svc_open: 'everything else, including connections from this server to the range', sum_exc_close: 'everything else from and to this range', sum_none: 'nothing selected yet', sum_dns2: 'DNS (both directions)', mode_all: 'Everything', mode_svc: 'Selected services', mode_exc: 'Everything except', md_all: 'All connections from and to the range are cut.', md_svc: 'Only connections from the range to the services you pick are blocked; everything else stays open. Connections from this server to the range (mail, DNS, web requests) are not affected.', md_exc: 'The range is cut completely and the services you pick stay open. Two-way allow lines are added to CSF for each; they are removed with the ban.', svc_h_block: 'Services to block', svc_h_in: 'Keep open · from this range', svc_h_out: 'Keep open · from this server to the range', svc_web: 'Web', svc_ssh: 'SSH', svc_ftp: 'FTP', svc_cp: 'cPanel · WHM · Webmail', svc_min: 'Incoming mail', svc_sync: 'Mail sync', svc_dns: 'DNS', svc_mout: 'Outgoing mail', svc_wout: 'Outgoing web', svc_pasv: 'passive {0}', svc_ports: 'port {0}', svc_x_svc: 'Other ports', svc_x_exc: 'Other ports (inbound)', svc_x_ph: 'e.g. 8080, 30000-35000', h_dns_mail: 'Mail may also need DNS: if this server also hosts the DNS for its domains, other mail servers may look up the MX record here before delivering, and the SPF, DKIM and DMARC records when receiving your mail. With DNS closed, mail may be delayed or not arrive at all.', h_dns_web: 'Web may also need DNS: crawlers and visitors in this range may resolve your domains on this server\'s DNS before connecting.', h_cp_exc: 'Addresses like cpanel.example.com work through the web port (443); select Web too to keep them open.', h_cp_svc: 'cPanel, WHM and Webmail can also be reached through the web port (443) via addresses like cpanel.example.com; select Web too to block them completely.', h_dns_blk: 'Blocking DNS may also affect mail and visits from this range if this server hosts the DNS for its domains.', h_ftp_nopasv: 'FTP\'s passive port range wasn\'t found; add it to "Other ports" (e.g. 30000-35000) so transfers work too.', h_chg_restore: 'Switching to a partial ban restores the {0} entries removed when this ban was added, since a partial ban doesn\'t cover the whole range.', m_svc_t: 'Block the selected services for {0}?', m_svc_b16: 'Connections from the 65,536 addresses in the network to the services you pick are blocked. The ban is added as "do not delete" and is kept even when the list is full.', m_svc_b24: 'Connections from the 256 addresses in the block to the services you pick are blocked. The ban is added as "do not delete" and is kept even when the list is full.', m_chg_t: 'Change ban: {0}', chg_btn: 'Change', chg: 'Change ban', in_clean_na: 'Covered entries stay', in_clean_na_d: 'A partial ban doesn\'t cover the whole range, so the bans inside stay; they block the other services too.', in_part: 'Partial bans', in_part_repl: 'replaced', in_watch_keep: 'still watched', kind_partial: 'partial', kind_partial_h: 'Partial ban: only connections from this range to the selected services are blocked; everything else is open.', f_partial: 'Partial', g_closed: 'blocked: {0}', g_open: 'open: {0}', l_part_net: 'Partial (network)', l_part_blk: 'Partial (block)', l_part_rng: 'Partial (/{0})', l_part_d: 'blocked: {0} · from this range; other connections open', l_open: 'kept open: {0}', ev_svc: 'partial · blocked: {0}', ev_exc: 'open: {0}', ev_full: 'full ban', ev_manual_change: 'Ban changed', ban_btn: 'Ban', m_ban24_t: 'Permanently ban {0}?', m_ban24_b: 'This blocks all 256 addresses in the block. The ban is added as "do not delete" and is kept even when the list is full.', in_loading: 'Reading what is inside…', in_h: 'Inside right now', in_blocks: 'Block bans', in_singles: 'Single bans', in_temps: 'Temp bans', in_watched: 'Watched blocks', in_others: 'Other ranges', in_owner: 'Owner', in_none: 'Nothing else inside.', in_watch_end: 'no longer watched', in_oth_keep: 'left as they are', in_clean0: 'Remove covered entries', in_clean_d: 'Permanent entries inside the range (including "do not delete" ones and other ranges) are removed from the permanent list, temp bans from the temp list. The removed permanent entries are kept: when you lift this ban you can restore them exactly as they were. Temp bans are not restored; they would have expired anyway. "do not delete" lines don\'t count toward CSF\'s list limit, so they are not counted as freed.', in_cover: 'Already banned: {0}', in_wl: 'Overlaps a whitelist entry:', under: 'inside {0}', under_h: 'This block is inside the {0} ban and no longer needed. Removing it frees a line in the permanent list.', under_hp: 'This block is inside the {0} ban; watching it no longer matters.', l_perm_net: 'Permanent (network)', l_perm_rng: 'Permanent (/{0})', l_port: 'Port-limited · {0} {1} blocked · {2}', l_ccd_cc: 'Country blocked · CC_DENY {0}', l_ccd_asn: 'ASN blocked · CC_DENY {0}', l_ccp: 'Port-limited · CC_DENY_PORTS {0} · {1}', l_ccd_src: 'Country and ASN here come from Team Cymru; CSF uses its own database, which can rarely differ.', ev_removed: '{0} entries removed', r_partial: 'this network has a partial ban: {0}', m_unban_part: 'The partial ban is removed; connections from this range to the selected services are allowed again. Other bans inside stay in place.', ev_restored: '{0} entries restored', m_restore_d: 'They go back to the permanent list with their original comments and dates, "do not delete" markers included. If you leave this unchecked, the saved entries are discarded.', m_restore: 'Restore the {0} entries removed when this ban was added', m_unban_rb: 'The ban is removed from the permanent list.', in_free_pt: 'frees {0} lines in the permanent list and {1} entries in the temp list', in_free_t: 'frees {0} entries in the temp list', in_free_p: 'frees {0} lines in the permanent list', in_sgl_dnd: 'incl. {0} do not delete', in_keep: 'kept', in_rm: 'removed', dir_in: 'inbound', dir_out: 'outbound', in_ports: 'Port-limited lines', in_self: 'This range contains this server\'s own IP ({0}); it can\'t be banned.', ban_anyway: 'Ban anyway', ignore: 'Ignore', unban: 'Remove',
      promote: 'Make permanent', forget: 'Stop watching', unignore: 'Remove', show_all: 'Show all ({0})', more: 'Show more',
      n_ip: '{0} IPs', n_subnets: '{0} distinct blocks', from_temp: 'from temp bans', from_perm: 'from permanent bans', days_left: '{0} days left',
      ttl_left: 'temp ban: {0} left', until: 'until {0}', by: 'by {0}', wl: 'whitelist: {0}', and_more: '+{0} more IPs',
      no_review: 'Nothing to review.', no_groups: 'No active block bans.', no_pending: 'No watched blocks.',
      no_events: 'Nothing recorded yet. Runs will show up here.', no_match: 'No matching entries.',
      c_t24: 'Block ban (/24)', c_t24p: 'Do not delete threshold', c_t16: 'Suspicious network (/16)', c_tt24: 'Temp block ban (/24)', c_tt16: 'Suspicious network, from temp bans (/16)',
      c_ret: 'Watch period', c_lookup: 'Owner / hostname lookups', c_on: 'on', c_off: 'off', c_days: '{0} days', c_singles: '≥ {0} singles', c_gloss: 'single = one-IP ban · block = /24 · network = /16 · do not delete = CSF keeps it even when the list is full',
      now: 'just now', min_ago: '{0} min ago', h_ago: '{0} h ago', d_ago: '{0} d ago', dur_h: '{0} h {1} min', dur_m: '{0} min',
      cancel: 'Cancel', confirm: 'Confirm', close: 'Close', reload: 'Reload page', type_to_confirm: 'Type {0} to confirm',
      m_ban16_t: 'Permanently ban {0}?', m_ban16_b: 'This blocks all 65,536 addresses in the network. The ban is added as "do not delete" and is kept even when the list is full.',
      m_force_t: 'Ban despite the whitelist?', m_force_b: 'This block overlaps a CSF whitelist entry:',
      m_force_n: 'Addresses in csf.allow keep getting through even with this ban. Those in csf.ignore and the other lists will be blocked.',
      m_promote_t: 'Make {0} permanent now?', m_promote_b: 'The block is added to the permanent list as "do not delete" and is no longer watched.',
      m_forget_t: 'Stop watching {0}?', m_forget_b: 'The next attack from this block counts as the "first time" again and gets a 12-hour temp block ban.',
      m_unban_t: 'Remove {0}?', m_unban_b: 'The block ban is removed. The single bans deleted when it was added do not come back; these addresses are fully unblocked.',
      m_unban_dnd: 'This ban is marked "do not delete". The marker is removed from csf.deny first (a backup is kept).',
      m_ignore_t: 'Ignore {0}?', m_ignore_b: 'The item is hidden from To review; for a suspicious network (/16) its warning emails stop too.', m_ignore_d: 'For',
      m_unignore_t: 'Watch {0} again?', m_run_t: 'Run now?',
      m_run_b: 'Does exactly what the scheduled (cron) run would: blocks over the threshold get banned and notifications are sent.',
      m_dry_t: 'Dry run', m_dry_wait: 'Simulating a run without changing anything…', m_dry_none: 'This run would not change anything.',
      m_upd_t: 'Update to v{0}?', m_upd_b: 'Runs update.sh; config.env and records are kept. Takes a few seconds.',
      m_upd_run: 'Updating…', m_upd_ok: 'Update complete.', m_upd_fail: 'The update did not complete; see the output.',
      t_started: 'Run started.', t_done: 'Run finished.', t_busy: 'Another run is in progress, try again shortly.', t_cron_busy: 'A run is already in progress (most likely cron); results will show up here when it finishes.',
      t_err: 'Could not complete: {0}', session: 'Session expired. Reload the page.', t_copied: 'Copied.',
      l_host: 'Hostname', l_fwd: 'the name resolves back to this IP (forward-confirmed)', l_nofwd: 'the name does not resolve back to this IP (not confirmed)', l_noptr: 'No reverse DNS',
      l_owner: 'Owner', l_prefix: 'Announced range', l_reg: 'Registry', l_fw: 'Firewall', l_wl: 'Whitelist',
      l_pending: 'Watched', l_ign: 'Ignored', l_notbanned: 'Not blocked', l_none: 'None', l_perm_single: 'Permanent (single)',
      l_perm_cover: 'Permanent (block)', l_temp: 'Temp', l_nolookup: 'Owner and hostname lookups are off (LOOKUP=0).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Copy', bad_ip: 'Enter a valid IPv4 address.',
      foot: 'CSF Auto-Group v{0} · signed in as {1}',
      tab_overview: 'Overview', tab_settings: 'Settings', tab_history: 'History', show_less: 'Show less', s_cfglog: 'Settings history', ev_loading: 'Loading…', singles_s: 'singles', kd_week: 'this week', kd_lines: 'lines', kd_same: 'no change', kr_ring: '{0} of {1} items are skipped blocks', kr_warn: 'suspicious', kr_skip: 'skipped', st_upd: 'Version and updates', upd_check: 'Check for updates', upd_checking: 'Checking…', upd_cur: 'Installed version', upd_ok: 'Up to date', upd_new: 'New version available: v{0}', upd_last: 'Last checked: {0}', upd_never: 'Not checked yet', upd_auto: 'While the page is open it also checks every half hour; a notice appears at the top when a new version is out.', upd_err_not_git: 'The install is not a git checkout; it can\'t be updated from the plugin (update.sh won\'t work either).', upd_err_unreachable: 'Could not reach GitHub; try again in a moment.', upd_err_detached: 'The repository is not on a branch; update over SSH.', c_auto_on: 'block bans older than {0} days are removed automatically on every run', c_auto_off: 'block bans older than {0} days are collected under the Old filter, not removed automatically', hc_csf: 'CSF', hc_lfd: 'LFD', hc_cron: 'Cron', hc_csf_ok: 'Firewall rules are loaded', hc_csf_off: 'CSF is disabled (csf.disable)', hc_csf_testing: 'CSF is in testing mode (TESTING = 1)', hc_csf_norules: 'CSF rules are not loaded', hc_csf_unknown: 'Status unknown (no iptables)', hc_lfd_ok: 'LFD is running', hc_lfd_down: 'LFD is not running: no new bans will arrive', hc_cron_ok: 'Runs happen on schedule', hc_cron_late: 'A run is overdue', sb_fw: 'There is a problem with the firewall', f_old: 'Old', old_h: '{0} block bans are older than {1} days.', old_auto: 'Automatic removal is on; they will be removed on the next run.', old_manual: 'Automatic removal is off (Settings → Retention).', old_rm: 'Remove old ones ({0})', m_exp_t: 'Remove {0} old block bans?', m_exp_b: '{0} block bans older than {1} days are removed from csf.deny (do not delete ones too). If attacks come from them again they are banned again. csf.deny is backed up first.', ev_expire: 'Old block removed', exp_age: 'added {0} days ago', rep_n: 'repeating · {0} days', k_BLOCK_EXPIRE_DAYS: 'Old block ban limit (days)', h_BLOCK_EXPIRE_DAYS: 'Block bans older than this are grouped under the "Old" filter in the active block bans table.', k_BLOCK_EXPIRE_AUTO: 'Remove old block bans automatically', h_BLOCK_EXPIRE_AUTO: 'When on, block bans older than this are removed on every run and reported by email. Manual bans are left alone.', from_log: 'from the plugin\'s log', sn_server: 'Server', st_deps: 'Server requirements', st_deps_h: 'Tools the plugin uses and what happens when one is missing.', dep_ok: 'Found', dep_missing: 'Missing', dep_warn: 'Incomplete', dep_opt: 'optional', dep_csf: 'The firewall; it applies the bans.', dep_csf_x: 'Required: nothing works without CSF.', dep_crontab: 'Runs the job on schedule.', dep_crontab_x: 'Runs don\'t happen automatically; the schedule can\'t be changed from Settings.', dep_mail: 'Alert emails and the weekly summary.', dep_mail_x: 'No alert emails or weekly summary are sent.', dep_dns: 'Owner and hostname lookups.', dep_dns_x: 'No owner or hostname info; CC_IGNORE / CC_ALLOW and csf.rignore can\'t be checked, so blocks relying on them aren\'t banned.', dep_logrotate: 'Archives the log file when it grows (compresses the old one, starts a new file).', dep_logrotate_x: 'The log is trimmed by a line limit instead (fallback).', dep_logrotate_w: 'Installed, but our config file is missing; the log is trimmed by the line limit for now. Re-run update.sh or install.sh.', dep_flock: 'Makes sure only one run happens at a time.', dep_flock_x: 'No protection against overlapping runs.', dep_timeout: 'Puts a time limit on commands the plugin runs.', dep_timeout_x: 'A stuck command can keep the page waiting.', dep_git: 'Updating from the plugin.', dep_git_x: 'The update check and the Update button don\'t work.', dep_modsec: 'cPanel\'s hit log (Hits List) is available; ban reasons show the ModSecurity rule\'s message.', dep_modsec_w: 'No cPanel hit log; messages are read from the ModSecurity log and rule files (Imunify rules may show only their number).', dep_modsec_x: 'ModSecurity log not found; ban reasons show rules by number only.', dep_sqlite3: 'Reads the ModSecurity hit log.', dep_sqlite3_x: 'The hit log can\'t be read; messages come from the ModSecurity log and rule files (Imunify rules may show only their number).', dep_imunify: 'The Imunify tab in the providers card; blocks containing Imunify-whitelisted IPs are not banned.', dep_imunify_x: 'The Imunify tab is hidden; the Imunify whitelist isn\'t checked (CSF\'s lists still are).', k_logfile: 'Log file', log_rot: 'logrotate: archived past {2} MB, the last {3} archives are kept · now {0} · {1} archives.', k_LOG_ROTATE_MB: 'Log size (MB)', h_LOG_ROTATE_MB: 'Once the log grows past this size it is archived: the old one is compressed and kept, a new file is started (logrotate checks daily).', k_LOG_ROTATE_KEEP: 'Archives kept', h_LOG_ROTATE_KEEP: 'How many old log archives (compressed) are kept.', log_lines: 'Now {0} / {1} lines.', no_cfglog: 'No settings changes yet.', ev_config: 'Settings changed', ev_test_mail: 'Test email',
      st_notify: 'Notifications', st_mail: 'Alert email address', st_mail_h: 'Run notices (block bans, suspicious networks, list usage, firewall problems) and the weekly summary go here. On cPanel, root@localhost is forwarded to the server contact address.',
      st_lang: 'Language', st_lang_h: 'Language of the log, emails and this panel.', st_test: 'Send test email', st_test_h: 'Sent to the saved address.',
      st_test_dirty: 'Save the new address first.', mail_whm: 'WHM contact address', mail_custom: 'Other address', mail_whm_h: 'Goes to the contact address in WHM → Basic WebHost Manager Setup: {0}. If you change it in WHM, the plugin follows.', mail_whm_none: 'No contact address found in WHM; mail goes to root@localhost.', ic_ev_h: 'Firewall problems and list usage are sent right away (once when they start and once when resolved). Run notices are collected into at most one message per hour so Slack doesn\'t get flooded. The weekly summary goes out on the chosen day.', ic_fw: 'Firewall problem', ic_list: 'List filling up', ic_run: 'Run notices', ic_digest: 'Weekly summary', st_notify_ch: 'Notification channels', nt_all: 'All channels set in WHM', nt_email: 'Email only', nt_slack: 'Slack only', nt_h_mail: 'Email: {0}', nt_h_slack: 'Slack: the channel set in WHM', nt_h_noslack: 'Slack: not set in WHM', nt_h: 'Addresses come from WHM (Basic WebHost Manager Setup); the plugin does the sending.', st_slack_ev: 'Sent to Slack', k_NOTIFY: 'Notification channels', ic_test: 'Send a Slack test', ic_test_h: 'Sent to the Slack channel set in WHM right away, whatever the settings.', k_IC_FIREWALL: 'Slack: firewall problem', k_IC_LISTFULL: 'Slack: list filling up', k_IC_RUN: 'Slack: run notices', k_IC_DIGEST: 'Slack: weekly summary', st_thr: 'Thresholds', st_thr_h: 'When a ban is placed or a warning is sent; all counted in single (one-IP) bans.',
      k_THRESHOLD_24: 'Block ban (/24)', h_THRESHOLD_24: 'A block (/24) is banned once it holds this many permanent single (one-IP) bans.',
      k_THRESHOLD_24_PERMANENT: 'Do not delete at', h_THRESHOLD_24_PERMANENT: 'At this many singles the block ban also gets "do not delete": CSF keeps it even when the list is full. Can\'t be lower than the block ban threshold.',
      k_THRESHOLD_16: 'Suspicious network (/16)', h_THRESHOLD_16: 'A network (/16) is reported as suspicious when this many permanent single (one-IP) bans come from at least 2 distinct blocks. The network is not banned.',
      k_THRESHOLD_TEMP_24: 'Temp block ban (/24)', h_THRESHOLD_TEMP_24: 'At this many temp single (one-IP) bans in a block: a 12-hour temp block ban the first time, permanent if it comes back.',
      k_THRESHOLD_TEMP_16: 'Suspicious network, from temp bans (/16)', h_THRESHOLD_TEMP_16: 'A network (/16) is reported as suspicious when this many temp single (one-IP) bans come from at least 2 distinct blocks. The network is not banned.',
      st_sched: 'Schedule', st_sched_h: 'How often cron runs.', cron_5: '5 min', cron_10: '10 min', cron_15: '15 min', cron_30: '30 min', cron_0: 'Hourly',
      st_lookup: 'Lookups', k_LOOKUP: 'Owner and hostname lookups', h_LOOKUP: 'Shows ASN, organisation and hostname in emails and here; CC_IGNORE and csf.rignore checks rely on it.',
      k_LOOKUP_TIMEOUT: 'DNS timeout (s)', h_LOOKUP_TIMEOUT: 'How long to wait for each query.', st_nodns: 'Neither dig nor host is installed; lookups won\'t work (dnf install bind-utils).',
      on: 'On', off: 'Off', st_keep: 'Retention', k_SAYAC_RETENTION_DAYS: 'Watch period (days)',
      h_SAYAC_RETENTION_DAYS: 'A temp-banned block that returns within this time becomes permanent.', k_REVIEW_DAYS: 'To review (days)',
      h_REVIEW_DAYS: 'How long suspicious networks and skipped blocks stay on the To review list.', k_LOG_MAX_LINES: 'Log line limit', h_LOG_MAX_LINES: 'The log is trimmed to this many lines (only when logrotate is missing).',
      st_csf: 'CSF list limits', st_csf_h: 'These are CSF\'s own settings; change them in CSF, not here.',
      csf_deny: 'Permanent list (DENY_IP_LIMIT)', csf_temp: 'Temp list (DENY_TEMP_IP_LIMIT)', csf_open: 'Open CSF settings',
      default_v: 'default {0}', range_v: 'a whole number from {0} to {1}', mail_bad: 'Enter a valid email address.',
      rule_dnd: 'The do not delete threshold can\'t be lower than the block ban threshold.', dirty_n: '{0} unsaved changes', discard: 'Discard',
      try_save: 'Try before saving', save: 'Save', m_save_t: 'Save settings?', m_save_b: 'These changes will be written to config.env (a backup is kept):',
      m_try_t: 'Dry run with the new thresholds', m_try_b: 'Uses the unsaved settings; nothing is changed.',
      auto: 'automatic', focus_gone: '{0} is no longer on the list; showing its current state.',
      new_badge: 'New since your last visit', actions: 'Actions', overdue: 'Run overdue · last run {0} (expected every {1})',
      since_visit: 'Since your last visit ({0}):', sn_add: '{0} block bans', sn_temp: '{0} temp block bans', sn_warn: '{0} suspicious networks',
      sn_skip: '{0} skipped blocks', show_new: 'Show', e_new: 'Since last visit', ch_total: '{0} events', ch_title_n: 'Last {0} days', ch_d: '{0} days', sb_ok: 'Protection is running', sb_run: 'A run is in progress', sb_late: 'Runs are not on schedule', sb_every: 'Cron every {0}', sb_24: '{0}/{1} runs in the last 24 h', sb_none: 'no runs yet', sb_last: 'Last run', sb_dur: 'Run time', sb_avg: 'avg {0}', sb_next: 'Next', sb_now: 'now', sb_spark: 'Last {0} run times', pg_prev: 'Previous page', pg_next: 'Next page', dirty_leave: '{0} unsaved changes. Switch tabs anyway?', conn_net: 'Can\'t reach the server; what you see was fetched {0}. Retrying…', conn_session: 'Your session has expired.', upd_busy: 'An update is already running.', sec: '{0} s', lk_recent: 'Recently viewed',
      ch_add: 'Block ban', ch_promote: 'Made permanent', ch_temp: 'Temp block ban', ch_warn: 'Suspicious network', ch_skip: 'Skipped',
      ch_empty: 'Nothing in the last 30 days; the chart fills as the event log grows.', ipcard: 'IP card', col_block: 'Block', col_owner: 'Owner', col_since: 'Since', col_left: 'Left', col_state: 'State', left_short: '{0} left',
      col_singles: 'Singles', col_added: 'Added', of_n: '{0}–{1} of {2}', s_asn: 'Most blocked providers',
      s_asn_h: 'Ranked by block bans and single bans; ranges in csf.deny not added by CSF Auto-Group are noted separately · owner known for {0} blocks', p_g: '{0} blocks', p_b: '+{0} blocks not from CSF Auto-Group', p_t: '{0} singles', p_bn: '{0} blocks',
      at_atk: 'CSF', at_blk: 'Other blocks', blk_h: 'Ranges in csf.deny that CSF Auto-Group did not add (by hand, LFD or another tool); already blocked. Rules written straight to the firewall, e.g. by csfpost.sh, are not shown here.',
      blk_empty: 'No ranges in csf.deny that CSF Auto-Group did not add (or their owners aren\'t known yet).',
      im_h: 'IPs Imunify360 blocked on this server itself (not the cloud list) · {0} IPs, owner known for {1}. Information only; nothing is written to CSF.',
      im_n: '{0} IPs', im_empty: 'The Imunify360 local blacklist is empty.', asn_denied: 'Already blocked in CSF',
      asn_hint: 'ASN block suggestion', asn_filling: 'Collecting owner info; 50 blocks are looked up per run.',
      asn_nolookup: 'Owner lookups are off (Settings → Lookups).', m_asn_t: 'Block all of AS{0} in CSF',
      m_asn_b: '{0} separate block bans were added for {1}; each means at least 3 attackers in the same block. If attacks keep coming from this provider, closing the whole provider (ASN) with CSF\'s own country/ASN block is more durable.',
      m_asn_w: 'This also blocks legitimate users of that provider (e.g. customers hosted there). Be careful with large cloud providers.',
      m_asn_s: 'How: CSF → Firewall Configuration → add {0} to CC_DENY (comma separated), save and restart csf and LFD. This plugin never changes csf.conf.',
      copy_asn: 'Copy {0}', csf_open2: 'Open CSF', edit: 'Edit', st_digest: 'Weekly summary',
      st_digest_h: 'Sent with the first run after 09:00 on the chosen day: new block bans, most blocked providers, watched blocks about to expire.',
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
  function relT(ts) { return '<span title="' + esc(new Date(ts * 1000).toLocaleString(loc())) + '">' + rel(ts) + '</span>'; }
  function stamp(ts) {
    var d = new Date(ts * 1000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    if (LANG !== 'tr') return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  var DEP_NAMES = { csf: 'CSF', crontab: 'cron', mail: 'mail', dns: 'dig / host', logrotate: 'logrotate', flock: 'flock', timeout: 'timeout', git: 'git', imunify: 'Imunify360', modsec: 'ModSecurity', sqlite3: 'sqlite3' };
  function updCard() {
    var u = UPD, has = u && u.ok && !u.uptodate, blocked = has && (u.dirty || u.diverged);
    var state = !u ? '<span class="ag-muted">' + t('upd_never') + '</span>'
      : !u.ok ? '<span class="ag-upd-bad">' + esc(t('upd_err_' + u.error) !== 'upd_err_' + u.error ? t('upd_err_' + u.error) : t('t_err', u.error || '?')) + '</span>'
      : u.uptodate ? '<span class="ag-pill ag-pill-ok">' + t('upd_ok') + '</span>'
      : '<span class="ag-pill ag-pill-acc">' + esc(t('upd_new', u.latest)) + '</span>';
    var commits = has ? '<ul class="ag-commits ag-upd-commits">' + (u.commits || []).map(function (c) { return '<li><code>' + esc(c.hash) + '</code>' + esc(c.subject) + '</li>'; }).join('') + '</ul>' : '';
    var acts = '<button class="ag-btn" data-act="updcheck"' + (UPD_BUSY ? ' disabled' : '') + '>' + (UPD_BUSY ? '<span class="ag-spin ag-spin-sm"></span> ' + t('upd_checking') : IC.download + t('upd_check')) + '</button>' +
      (has && !blocked ? '<button class="ag-btn ag-btn-primary" data-act="update">' + t('upd_apply') + '</button>' : '');
    return '<section class="ag-card" id="ag-updcard"><div class="ag-card-h"><h2>' + IC.download + t('st_upd') + '</h2></div><div class="ag-upd">' +
      '<div class="ag-upd-row"><div><div class="ag-upd-l">' + t('upd_cur') + '</div><div class="ag-upd-v">v' + esc(S.version) + (BOOT.commit ? ' <span class="ag-muted ag-mono">' + esc(BOOT.commit) + '</span>' : '') + '</div></div>' +
      '<div class="ag-upd-st">' + state + '</div></div>' + commits +
      (blocked ? '<div class="ag-warnbox">' + esc(u.dirty ? t('upd_dirty') : t('upd_diverged')) + '</div>' : '') +
      '<div class="ag-upd-f"><div class="ag-upd-acts">' + acts + '</div><span class="ag-sub">' + (UPD_T ? esc(t('upd_last', rel(UPD_T))) + ' · ' : '') + esc(t('upd_auto')) + '</span></div></div></section>';
  }
  function depsCard() {
    var D = (CFG && CFG.deps) || [];
    if (!D.length) return '';
    var rows = D.map(function (d) {
      var ok = d.s === 'ok', warn = d.s === 'warn', opt = d.k === 'imunify' || d.k === 'modsec' || d.k === 'sqlite3';
      var txt = ok ? t('dep_' + d.k) : warn ? t('dep_' + d.k + '_w') : t('dep_' + d.k + '_x');
      var pill = ok ? 'ag-pill-ok' : opt ? 'ag-pill-n' : warn ? 'ag-pill-warn' : (d.k === 'csf' ? 'ag-pill-bad' : 'ag-pill-warn');
      return '<div class="ag-dep"><div class="ag-dep-ic ' + (ok ? 'ok' : opt ? 'n' : 'bad') + '">' + (ok ? IC.check : IC.alert) + '</div>' +
        '<div class="ag-dep-m"><div class="ag-dep-t"><b>' + esc(DEP_NAMES[d.k] || d.k) + '</b>' + (opt ? '<span class="ag-muted">' + t('dep_opt') + '</span>' : '') + '</div>' +
        '<div class="ag-dep-d">' + esc(txt) + '</div></div>' +
        '<span class="ag-pill ' + pill + '">' + t('dep_' + (ok ? 'ok' : warn ? 'warn' : 'missing')) + '</span></div>';
    }).join('');
    return '<section class="ag-card ag-depcard"><div class="ag-card-h"><h2>' + IC.shield + t('st_deps') + '</h2><span class="ag-hint">' + t('st_deps_h') + '</span></div>' +
      '<div class="ag-deps">' + rows + '</div></section>';
  }
  function bytes(n) { n = +n || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function loc() { return LANG === 'tr' ? 'tr-TR' : 'en-US'; }
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
      return r.text().then(function (tx) {
        var j = null;
        try { j = JSON.parse(tx); } catch (e) { j = null; }
        // JSON değilse: WHM giriş sayfası = oturum bitti; başka bir şey = sunucu hatası
        return j || { ok: false, error: /<html|<form/i.test(tx) ? 'session' : 'http', message: 'HTTP ' + r.status };
      });
    }, function () { return { ok: false, error: 'network' }; }).then(function (j) {
      if (j && j.error === 'session') setConn('session');
      return j || { ok: false, error: 'empty' };
    });
  }

  /* Bağlantı çubuğu: sayfa eski veriyi "güncel" gibi göstermesin */
  var $conn = null;
  function setConn(k) {
    if (CONN === 'session' && k === 'net') return;
    if (CONN === k) return;
    CONN = k;
    if (k === 'session') clearTimeout(pollTimer);          // oturum yoksa yoklamanın anlamı yok
    if (!$conn) { $conn = document.createElement('div'); $conn.className = 'ag-app ag-connwrap'; $app.parentNode.insertBefore($conn, $app); }
    $conn.innerHTML = !k ? '' : '<div class="ag-conn' + (k === 'session' ? ' bad' : '') + '">' + IC.alert + '<span>' +
      esc(k === 'session' ? t('conn_session') : t('conn_net', LAST_OK ? rel(LAST_OK) : '—')) + '</span>' +
      '<button class="ag-btn ag-btn-sm" onclick="location.reload()">' + esc(t('reload')) + '</button></div>';
  }

  /* ── Sahip bilgisi: script'in önbelleği (S.owners) + olay kaydı ─── */
  /* ── Olay kaydı: durum çıktısında olaylar IP'siz gelir (sayaçlar için yeter); IP'li kayıtlar
     --events ile sayfa sayfa yüklenir. EVL: yüklenenler (eskiden yeniye), EVK: tekrar ayıklama
     anahtarları (sınır saniyesi iki sayfada da gelir), EVMORE: olay kaydında daha eskisi var mı ── */
  var EVL = null, EVK = {}, EVMORE = false, EVBUSY = false, EV_SHORT = false;
  function evMerge(list) {
    var added = 0;
    (list || []).forEach(function (e) { var k = JSON.stringify(e); if (EVK[k]) return; EVK[k] = 1; EVL.push(e); added++; });
    if (added) EVL.sort(function (a, b) { return a.t - b.t; });
    return added;
  }
  function evLoad() {   // ilk seferde son 300 olay; sonra yalnız yeniler (son olaydan birkaç saniye geriden; tekrarlar ayıklanır)
    if (EVBUSY) return Promise.resolve(0);
    var first = !EVL || !EVL.length, last = first ? 0 : EVL[EVL.length - 1].t;
    EVBUSY = true;
    return api('events', first ? { m: 'latest', t: 0, n: 300 } : { m: 'after', t: Math.max(0, last - 5), n: 1000 }).then(function (r) {
      EVBUSY = false;
      if (!r || !r.ok) return 0;
      if (!first && r.more) { EVL = null; return evLoad(); }      // arada çok olay birikmiş: baştan yükle
      if (first) { var had = EVL ? EVL.length : -1; EVL = []; EVK = {}; EVMORE = !!r.more; return evMerge(r.events) || (had < 0 ? 1 : 0); }
      return evMerge(r.events);
    });
  }
  function evOlder() {  // "Daha fazla": bir önceki sayfa (sınır saniyesi dahil, tekrarlar ayıklanır)
    if (EVBUSY || !EVL || !EVL.length || !EVMORE) return Promise.resolve(0);
    EVBUSY = true;
    return api('events', { m: 'before', t: EVL[0].t, n: 300 }).then(function (r) {
      EVBUSY = false;
      if (!r || !r.ok) { toast(t('t_err', (r && r.error) || '?'), 'bad'); return 0; }
      var n = evMerge(r.events);
      EVMORE = !!r.more && n > 0;
      return n;
    });
  }
  // Geçmiş, ayar geçmişi ve IP/sebep isteyen yerler için kaynak: yüklendiyse IP'li sayfalar; olay kaydının
  // başına varıldıysa günlükten çıkarılan eski işler (hepsinden eski) de eklenir
  function evList() {
    if (!EVL) return S.events || [];
    return EVMORE ? EVL : (S.events || []).filter(function (e) { return e.src === 'log'; }).concat(EVL);
  }

  var OWNERS = {};
  function indexOwners() {
    OWNERS = {};
    // evx: aktif ve izlenen blokların ban kaydı (yüklü sayfalara girmeyen eskiler); önce gelir, yeni olaylar üzerine yazar
    (S.evx || []).concat(evList()).forEach(function (e) {
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
  function ipSummary(ips, total) {   // "3 IP · (sshd) Failed SSH login" — en sık ban sebebi
    var c = {}, best = '';
    (ips || []).forEach(function (i) { var w = whyText(i.why); if (w) { c[w] = (c[w] || 0) + 1; if (!best || c[w] > c[best]) best = w; } });
    return t('n_ip', num(total || (ips || []).length)) + (best ? ' · ' + best : '');
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
    var run = S.running;
    return '<div class="ag-head"><div class="ag-mark">' + IC.shield + '</div>' +
      '<div class="ag-title"><h1>CSF Auto-Group</h1><div class="ag-sub">' + esc(location.hostname) + ' · v' + esc(S.version) + '</div></div>' +
      '<div class="ag-tabs" role="tablist">' + ['overview', 'history', 'settings'].map(function (k) {
        return '<button class="ag-tab' + (UI.tab === k ? ' on' : '') + '" role="tab" aria-selected="' + (UI.tab === k) + '" data-act="tab" data-tab="' + k + '">' + t('tab_' + k) + '</button>';
      }).join('') + '</div>' +
      '<div class="ag-head-actions">' +
      (run || UI.ranOnce ? '<button class="ag-btn" data-act="runlog">' + IC.terminal + t('run_log') + '</button>' : '') +
      '<button class="ag-btn" data-act="dry" title="' + esc(t('dry_h')) + '">' + IC.eye + t('dry') + '</button>' +
      '<button class="ag-btn ag-btn-primary" data-act="run"' + (run ? ' disabled' : '') + '>' + IC.play + t('run') + '</button>' +
      '</div></div>';
  }

  /* Durum bandı: koruma çalışıyor mu, son tur, süre, sıradaki tur, son turların süreleri */
  function sec(s) { s = Math.max(0, Math.round(s || 0)); return s < 60 ? t('sec', s) : dur(s); }
  function nextIn() {
    var cm = String(S.cron_min || ''), d = new Date(nowSec() * 1000), m = d.getMinutes(), s = d.getSeconds(), x, left;
    if ((x = /^\*\/(\d+)$/.exec(cm)) && +x[1] > 0) { var n = +x[1]; left = (Math.min(60, (Math.floor(m / n) + 1) * n) - m) * 60 - s; }
    else if (/^\d+$/.test(cm)) left = (((+cm - m + 60) % 60) || 60) * 60 - s;
    else return '';
    left = Math.max(0, left);
    return Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
  }
  function healthChips(HL, late) {
    function chip(name, cls, tip) { return '<span class="ag-hc ' + cls + '" title="' + esc(tip) + '">' + (cls === 'ok' ? IC.check : IC.alert) + esc(name) + '</span>'; }
    var c = HL.csf || 'unknown', l = HL.lfd || 'down';
    return '<div class="ag-hchips">' +
      chip(t('hc_csf'), c === 'ok' ? 'ok' : c === 'testing' || c === 'unknown' ? 'warn' : 'bad', t('hc_csf_' + c)) +
      chip(t('hc_lfd'), l === 'ok' ? 'ok' : 'bad', t('hc_lfd_' + l)) +
      chip(t('hc_cron'), late ? 'bad' : 'ok', t(late ? 'hc_cron_late' : 'hc_cron_ok')) + '</div>';
  }
  function statusBand() {
    var lr = S.last_run, run = S.running, late = !run && overdue(), iv = S.cron_interval || 0;
    var R = S.runs || {}, L = R.list || [], ds = L.map(function (x) { return x[1] || 0; });
    var avg = ds.length ? Math.round(ds.reduce(function (a, b) { return a + b; }, 0) / ds.length) : 0;
    var exp = iv > 0 && R.first ? Math.max(1, Math.round(Math.min(86400, nowSec() - R.first) / iv)) : 0;
    exp = Math.max(exp, R.n24 || 0);
    var HL = S.health || {}, fwBad = HL.lfd === 'down' || HL.csf === 'off' || HL.csf === 'norules';
    var st = run ? 'run' : (late || fwBad) ? 'bad' : 'ok';
    var sub = fwBad && !run ? [HL.csf !== 'ok' && HL.csf !== 'unknown' ? t('hc_csf_' + HL.csf) : '', HL.lfd === 'down' ? t('hc_lfd_down') : ''].filter(Boolean).join(' · ')
      : late ? t('overdue', lr ? rel(lr.t) : '?', dur(iv))
      : !lr ? t('sb_none') : [iv ? t('sb_every', dur(iv)) : '', exp ? t('sb_24', num(R.n24 || 0), num(exp)) : ''].filter(Boolean).join(' · ');
    var sorted = ds.slice().sort(function (a, b) { return a - b; }), med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    var mx = Math.max.apply(null, ds.concat([1]));
    var spark = L.map(function (x) {
      var h = Math.max(12, Math.round((x[1] || 0) * 100 / mx));
      return '<i' + (med && x[1] > med * 2 ? ' class="l"' : '') + ' style="height:' + h + '%" title="' + esc(stamp(x[0]) + ' · ' + sec(x[1])) + '"></i>';
    }).join('');
    function m(label, big, small, id, tip) {
      return '<div class="ag-band-m"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><small>' + label + '</small><b' + (id ? ' id="' + id + '"' : '') + '>' + big + '</b>' + (small ? '<span>' + small + '</span>' : '') + '</div>';
    }
    return '<section class="ag-band st-' + st + '"><div class="ag-band-s"><span class="ag-pulse"><i></i></span><div><b>' +
      t(run ? 'sb_run' : fwBad ? 'sb_fw' : late ? 'sb_late' : 'sb_ok') + '</b><span>' + esc(sub) + '</span>' + healthChips(HL, late) + '</div></div>' +
      m(t('sb_last'), lr ? esc(rel(lr.t)) : '—', '', '', t('sb_last_h')) +
      m(t('sb_dur'), ds.length ? esc(sec(ds[ds.length - 1])) : '—', ds.length > 1 ? esc(t('sb_avg', sec(avg))) : '') +
      m(t('sb_next'), run ? t('sb_now') : (nextIn() || '—'), '', 'ag-next') +
      (L.length > 1 ? '<div class="ag-band-g"><small>' + t('sb_spark', L.length) + '</small><div class="ag-spark">' + spark + '</div></div>' : '<div></div>') +
      '</section>';
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

  function ring(p, cls) {
    var c = 2 * Math.PI * 15, v = Math.max(0, Math.min(100, p)) * c / 100;
    return '<svg class="ag-ring ' + cls + '" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15"></circle>' +
      '<circle cx="18" cy="18" r="15" stroke-dasharray="' + v.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 18 18)"></circle></svg>';
  }
  /* Haftalık değişim: ▲ turuncu = arttı (dikkat), ▼ yeşil = azaldı. Telefonda yalnız ok ve sayı. */
  function delta(d, unit) {
    if (d == null) return '';
    if (!d) return '<span class="ag-kpi-d eq">— <span class="ag-kpi-dl">' + esc(t('kd_same')) + '</span></span>';
    return '<span class="ag-kpi-d ' + (d > 0 ? 'up' : 'dn') + '">' + (d > 0 ? '▲' : '▼') + ' ' + num(Math.abs(d)) +
      '<span class="ag-kpi-dl"> ' + esc(t(unit)) + '</span></span>';
  }
  /* Kart: [simge] [başlık / sayı + değişim / açıklama] [halka] — telefonda: [simge + başlık] / [sayı ··· halka] / [açıklama] */
  function kpi(icon, tone, label, value, dl, meta, rg, tip) {
    return '<div class="ag-kpi"><div class="ag-kpi-ic ' + tone + '">' + IC[icon] + '</div>' +
      '<div class="ag-kpi-l">' + esc(label) + '</div>' +
      '<div class="ag-kpi-v">' + value + dl + '</div>' +
      '<div class="ag-kpi-m">' + meta + '</div>' +
      '<div class="ag-kpi-g"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + (rg || '') + '</div></div>';
  }
  function usageKpi(icon, label, pair, before) {
    var used = pair[0], lim = pair[1], p = lim > 0 ? Math.round(used * 100 / lim) : 0;
    var cls = p >= 90 ? 'bad' : (p >= 80 ? 'warn' : '');
    return kpi(icon, 'n', label, lim > 0 ? (LANG === 'tr' ? '%' + p : p + '%') : num(used), before >= 0 ? delta(used - before, 'kd_lines') : '',
      lim > 0 ? t('k_lines', num(used), num(lim)) : t('k_nolimit'), lim > 0 ? ring(p, cls) : '', lim > 0 ? t('k_lines', num(used), num(lim)) : '');
  }
  function kpis() {
    var G = S.groups, n = G.length, wk = nowSec() - 7 * 86400;
    var dnd = G.filter(function (g) { return g.dnd; }).length;
    // blok banı: bu hafta eklenen − kaldırılan (elle ya da eski olduğu için)
    var added = G.filter(function (g) { return g.added && g.added >= wk; }).length;
    var removed = (S.events || []).filter(function (e) { return e.t >= wk && (e.type === 'manual_unban' || e.type === 'expire') && /\/24$/.test(e.cidr || ''); }).length;
    // kontrol edilecek: şu anki farklı kayıt sayısı − bir önceki pencerede işaretlenen farklı kayıt sayısı (aynı ölçü)
    var rv = S.review.length, rDelta = S.review_prev == null ? null : rv - S.review_prev, rw = S.review.filter(function (e) { return /^warn16/.test(e.type); }).length, rs = rv - rw;
    var R7 = S.runs || {};
    return '<div class="ag-kpis">' +
      kpi('ban', 'acc', t('k_groups'), num(n), delta(added - removed, 'kd_week'), esc(t('k_dnd', num(dnd))),
        n ? ring(dnd * 100 / n, 'vio') : '', t('k_dnd', num(dnd))) +
      kpi('alert', rv ? 'warn' : 'ok', t('k_review'), '<span' + (rv ? ' class="warn"' : '') + '>' + num(rv) + '</span>', delta(rDelta, 'kd_week'),
        rv ? '<b class="ag-kpi-mw">' + num(rw) + '</b> ' + esc(t('kr_warn')) + ' · <b>' + num(rs) + '</b> ' + esc(t('kr_skip')) : esc(t('k_review_m', num(S.config.review_days))),
        ring(rv ? rs * 100 / rv : 0, 'info'), rv ? t('kr_ring', num(rs), num(rv)) : '') +
      usageKpi('list', t('k_perm'), S.usage.perm, R7.p7 == null ? -1 : R7.p7) +
      usageKpi('clock', t('k_temp'), S.usage.temp, R7.t7 == null ? -1 : R7.t7) + '</div>';
  }

  /* Etkinlik: yığılmış çubuklar; üzerine gelince o günün dökümü, sağda dönem toplamları */
  var SERIES = [['A', 'ch_add', 'var(--ag-accent)'], ['P', 'ch_promote', '#7c3aed'], ['T', 'ch_temp', '#d97706'], ['W', 'ch_warn', '#ea580c'], ['S', 'ch_skip', '#0284c7']];
  function activity() {
    var D = S.daily || {}, days = UI.cd === 7 ? 7 : 30, off = 30 - days, max = 0, tot = 0, sums = {}, cols = [], i;
    var loc = LANG === 'tr' ? 'tr-TR' : 'en-US', H = 128;
    SERIES.forEach(function (s) { sums[s[0]] = 0; });
    for (i = off; i < 30; i++) {
      var sum = 0, vals = SERIES.map(function (s) { var v = (D[s[0]] || [])[i] || 0; sum += v; sums[s[0]] += v; return v; });
      max = Math.max(max, sum); tot += sum; cols.push({ i: i, vals: vals, sum: sum });
    }
    var top = Math.max(1, max);
    var bars = cols.map(function (c, j) {
      var day = new Date((D.start + c.i * 86400) * 1000);
      var segs = c.vals.map(function (v, k) {
        return v ? '<i style="height:' + Math.max(3, Math.round(v / top * (H - 8))) + 'px;background:' + SERIES[k][2] + '"></i>' : '';
      }).join('');
      var tip = c.sum ? '<div class="ag-tip"><b>' + esc(day.toLocaleDateString(loc, { day: 'numeric', month: 'long', weekday: 'long' })) + '</b>' +
        c.vals.map(function (v, k) { return v ? '<div><i style="background:' + SERIES[k][2] + '"></i>' + esc(t(SERIES[k][1])) + '<em>' + num(v) + '</em></div>' : ''; }).join('') + '</div>' : '';
      // baloncuk kenardaki günlerde içeri doğru açılır (sol kenarda sağa, sağ kenarda sola), ekrandan taşmaz
      var edge = j >= days - Math.ceil(days / 6) ? ' r' : j < Math.ceil(days / 6) ? ' lft' : '';
      return '<div class="ag-c' + edge + (c.sum ? ' has' : '') + '">' + segs + tip + '</div>';
    }).join('');
    var step = days === 7 ? 1 : 7, ax = '';
    for (i = 0; i < days; i += step) {
      var dd = new Date((D.start + (off + i) * 86400) * 1000);
      ax += '<span style="left:' + (i * 100 / days).toFixed(2) + '%">' + esc(dd.toLocaleDateString(loc, { day: 'numeric', month: 'short' })) + '</span>';
    }
    var totals = SERIES.map(function (s) { return '<div><i style="background:' + s[2] + '"></i>' + esc(t(s[1])) + '<b>' + num(sums[s[0]]) + '</b></div>'; }).join('');
    var segBtns = '<div class="ag-chips">' + [7, 30].map(function (d) {
      return '<button class="ag-chip' + (days === d ? ' on' : '') + '" data-act="cd" data-d="' + d + '">' + t('ch_d', d) + '</button>';
    }).join('') + '</div>';
    return '<section class="ag-card ag-activity"><div class="ag-card-h"><h2>' + IC.chart + t('ch_title_n', days) + '</h2><span class="ag-count">' + t('ch_total', num(tot)) + '</span>' +
      '<div class="ag-tools">' + segBtns + '</div></div>' +
      (tot ? '<div class="ag-chart2"><div class="ag-plot"><div class="ag-bars" style="height:' + H + 'px">' + bars + '</div><div class="ag-axis">' + ax + '</div></div>' +
        '<div class="ag-totals">' + totals + '</div></div>'
        : '<div class="ag-empty ag-empty-sm">' + t('ch_empty') + '</div>') + '</section>';
  }

  // ban sebebi: "lfd - (mod_security) mod_security (id:1302) triggered" → "ModSecurity 1302: <kuralın mesajı>"
  // (mesaj cPanel'in ModSecurity eşleşme kaydından, durum çıktısındaki "modsec" alanında; eski kayıtlar da düzelir)
  function whyText(w) {
    w = String(w || '').replace(/^lfd\s*-\s*/, '');
    var m = w.match(/mod_security \(id:(\d+)\)/);
    if (!m) return w;
    var msg = (S.modsec || {})[m[1]];
    return 'ModSecurity ' + m[1] + (msg ? ': ' + msg : '');
  }
  function ipTable(ips, total) {
    if (!ips || !ips.length) return '';
    var rows = ips.map(function (i) {
      i = Object.assign({}, i, { why: whyText(i.why) });
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
      return '<div class="ag-okbar">' + IC.check + '<b>' + t('no_review') + '</b><span>' + t('k_review_m', num(S.config.review_days)) + '</span></div>';
    }
    var RM = S.repeat_min || 3;
    function repOf(e) { return (e.rep || 0) >= RM ? 1 : 0; }
    var items = S.review.slice().sort(function (a, b) { return (repOf(b) - repOf(a)) || (b.t - a.t); }).map(function (e) {
      var key = 'r:' + e.cidr, open = UI.open[key], is16 = /\/16$/.test(e.cidr), hasIps = e.ips && e.ips.length;
      var pill = e.type === 'skip_wl' ? '<span class="ag-pill ag-pill-info"' + evTitle(e.type) + '>' + t('ev_skip_wl') + '</span>'
        : '<span class="ag-pill ag-pill-warn"' + evTitle(e.type) + '>' + esc(t('ev_' + e.type)) + '</span>';
      var meta = e.hist ? []   // olay kaydından önceki uyarı (günlükten): IP sayısı bilinmiyor
        : is16 ? [t('n_ip', num(e.n)), t('n_subnets', num(e.subnets))] : [t('n_ip', num(e.n))];
      if (is16) meta.push(t(e.type === 'warn16t' ? 'from_temp' : 'from_perm'));
      var owner = e.owner || ownerOfIps(e.ips) || ownerOf(e.cidr).label;
      if (owner) meta.push(esc(owner));
      if (e.wl) meta.push(esc(t('wl', e.wl)));
      if (e.partial) meta.push(esc(t('r_partial', e.partial + (e.partial_svc ? ' · ' + svcNames(e.partial_svc) : ''))));
      var narrow = null;
      if (is16 && hasIps) {
        var by = {}, sv = {};
        e.ips.forEach(function (x) { var q = pfxOf(x.ip); by[q] = (by[q] || 0) + 1; var k = svcOfReason(x.why); sv[k] = (sv[k] || 0) + 1; });
        var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })[0];
        if (top && by[top] >= 2 && by[top] >= e.ips.length * 0.6) narrow = { p: top, n: by[top] };
        var known = Object.keys(sv).filter(function (k) { return k !== 'other'; });
        if (known.length && known.length <= 2) meta.push(esc(t('r_svc', countList(sv))));
        if (narrow) meta.push(esc(t('r_narrow', narrow.p + '.0/24', num(narrow.n), num(e.ips.length))));
      }
      var first = hasIps ? e.ips[0].ip : e.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
      var acts = hasIps ? '<button class="ag-btn ag-btn-sm" data-act="toggle" data-key="' + esc(key) + '">' + (open ? t('hide') : t('ips')) + '</button>' : '';
      if (narrow) acts += '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="ban24" data-t="' + esc(narrow.p) + '">' + t('ban24') + '</button>';
      if (is16) acts += '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="ban16" data-t="' + esc(pfx(e.cidr)) + '">' + t('ban16') + '</button>';
      else acts += '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="banforce" data-t="' + esc(pfx(e.cidr)) + '" data-wl="' + esc(e.wl || '') + '">' + t('ban_anyway') + '</button>';
      acts += menu('rm:' + e.cidr, [{ act: 'ignore', label: t('ignore'), icon: 'mute', attrs: 'data-c="' + esc(e.cidr) + '"' },
                                    { act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' }]);
      return '<div class="ag-item" data-row="' + esc(e.cidr) + '"><div class="ag-row">' + pill +
        '<div class="ag-row-main"><div class="ag-row-t">' + newDot(e.hist ? 0 : e.t) + '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(e.cidr) + '</span>' +
        (repOf(e) ? '<span class="ag-pill ag-pill-bad ag-rep" title="' + esc(t('rep_h', num(e.rep))) + '">' + esc(t('rep_n', num(e.rep))) + '</span>' : '') + '</div>' +
        '<div class="ag-row-s">' + meta.join(' · ') + '</div></div>' +
        '<div class="ag-row-x">' + (e.hist ? esc(e.day.slice(8, 10) + '.' + e.day.slice(5, 7)) : relT(e.t)) + '</div><div class="ag-row-a">' + acts + '</div></div>' +
        (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.alert + t('s_review') + '</h2>' +
      '<span class="ag-count warn">' + S.review.length + '</span>' +
      '<span class="ag-hint">' + t('s_review_h') + '</span></div>' +
      '<div class="ag-card-b">' + items + '</div></section>';
  }

  /* Aktif grup banları: sıralanabilir, sayfalı tablo */
  var PAGE = 10;       // iki tablo da (gruplar, izlenenler) aynı sayfa boyunda
  function isOld(g) {           // otomatik eklenmiş ve "eski" gün sınırını geçmiş blok banı
    var d = (S.expire && S.expire.days) || 365;
    return (g.kind === 'perm' || g.kind === 'promoted') && g.added > 0 && nowSec() - g.added >= d * 86400;
  }
  function kindMatch(g, f) {
    if (f === 'perm') return g.kind === 'perm' || g.kind === 'promoted';
    if (f === 'dnd') return g.dnd;
    if (f === 'temp') return g.kind === 'temp';
    if (f === 'manual') return g.kind === 'manual' || g.kind === 'partial';
    if (f === 'partial') return g.kind === 'partial';
    if (f === 'old') return isOld(g);
    return true;
  }
  function groupMatches(g) {
    if (!kindMatch(g, UI.gf)) return false;
    if (UI.gq) {
      var o = ownerOf(g.cidr), hay = (g.cidr + ' ' + (o.label || '') + ' ' + (o.cc || '')).toLowerCase();
      if (hay.indexOf(UI.gq.toLowerCase()) < 0) return false;
    }
    return true;
  }
  var KIND_ORD = { manual: 1, partial: 1, promoted: 2, perm: 3, temp: 4 };
  function ipNum(c) { var p = String(c).split('/')[0].split('.'); return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3]; }
  function groupSorted() {
    var s = UI.gs, d = UI.gd;
    return S.groups.filter(groupMatches).sort(function (a, b) {
      var x, y;
      if (s === 'cidr') { x = ipNum(a.cidr); y = ipNum(b.cidr); }
      else if (s === 'owner') { x = (ownerOf(a.cidr).label || '~').toLowerCase(); y = (ownerOf(b.cidr).label || '~').toLowerCase(); }
      else if (s === 'n') { x = a.n || 0; y = b.n || 0; }
      else if (s === 'kind') { x = KIND_ORD[a.kind] || 9; y = KIND_ORD[b.kind] || 9; }
      else { x = a.added || 0; y = b.added || 0; }
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
      var kindCls = { perm: 'ag-pill-n', promoted: 'ag-pill-acc', temp: 'ag-pill-warn', manual: 'ag-pill-bad', partial: 'ag-pill-warn' }[g.kind] || 'ag-pill-n';
      // kısmi banda kapalı servisler, istisnalı tam banda açık bırakılanlar
      var gnote = g.kind === 'partial' ? t('g_closed', svcNames(g.svc, g.extra) || t('svc_ports', String(g.ports || '').replace(/_/g, '–'))) : (g.open || g.open_extra) ? t('g_open', svcNames(g.open, g.open_extra)) : '';
      var first = ev && ev.ips && ev.ips[0] ? ev.ips[0].ip : g.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
      var when = g.added ? relT(g.added) : '—';
      var items = [];
      if (ev && ev.ips && ev.ips.length) items.push({ act: 'toggle', label: open ? t('hide') : t('ips'), icon: 'list', attrs: 'data-key="' + esc(key) + '"' });
      items.push({ act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' });
      if ((g.kind === 'manual' || g.kind === 'partial') && (bitsOf(g.cidr) === 16 || bitsOf(g.cidr) === 24))
        items.push({ act: 'chg', label: t('chg'), icon: 'sliders', attrs: 'data-c="' + esc(g.cidr) + '"' });
      if (bitsOf(g.cidr) > 16 && bitsOf(g.under) > 16) items.push({ act: 'ban16', label: t('ban16'), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16(g.cidr)) + '"' });
      items.push({ act: 'unban', label: t('unban'), icon: 'x', danger: true, attrs: 'data-c="' + esc(g.cidr) + '" data-dnd="' + (g.dnd ? 1 : 0) + '" data-kind="' + esc(g.kind) + '" data-restore="' + (g.restore || 0) + '"' });
      return '<div class="ag-item" data-row="' + esc(g.cidr) + '"><div class="ag-tr">' +
        '<div class="ag-td ag-td-main">' + newDot(g.added) + '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(g.cidr) + '</span>' + (g.under ? underPill(g.under) : '') + '</div>' +
        '<div class="ag-td ag-td-state"><span class="ag-pill ' + kindCls + '"' + ' title="' + esc(t('kind_' + g.kind + '_h') + (g.dnd ? ' ' + t('kind_dnd_h') : '')) + '"' + '>' + (g.dnd ? IC.lock : '') + esc(t('kind_' + g.kind)) + (g.kind === 'temp' && g.ttl > 0 ? ' · ' + esc(t('left_short', dur(g.ttl))) : '') + '</span>' + (gnote ? '<span class="ag-g-note">' + esc(gnote) + '</span>' : '') + '</div>' +
        '<div class="ag-td ag-td-own" title="' + esc(o.label || '') + '">' + (o.asn ? flag(o.cc) + '<span class="ag-asn">AS' + esc(o.asn) + '</span><span class="ag-org">' + esc(o.name || '') + '</span>' : '<span class="ag-muted">—</span>') + '</div>' +
        '<div class="ag-td ag-num-c">' + (g.n ? num(g.n) + '<span class="ag-mob"> ' + esc(t('singles_s')) + '</span>' : '—') + '</div>' +
        '<div class="ag-td ag-when">' + when + '</div>' +
        '<div class="ag-td ag-td-act">' + menu('gm:' + g.cidr, items) + '</div></div>' +
        (open && ev ? ipTable(ev.ips, ev.total) : '') + '</div>';
    }).join('');
    var pager = pages > 1 ? '<div class="ag-pager"><span>' + t('of_n', from + 1, from + shown.length, list.length) + '</span>' +
      '<button class="ag-iconbtn" data-act="gpage" data-d="-1"' + (UI.gp ? '' : ' disabled') + ' aria-label="' + t('pg_prev') + '">‹</button>' +
      '<button class="ag-iconbtn" data-act="gpage" data-d="1"' + (UI.gp < pages - 1 ? '' : ' disabled') + ' aria-label="' + t('pg_next') + '">›</button></div>' : '';
    return '<div class="ag-thead">' + th('cidr', t('col_block'), 'ag-td-main') + th('kind', t('col_state')) + th('owner', t('col_owner'), 'ag-td-own') +
      th('n', t('col_singles'), 'ag-num-c ag-th-r') + th('added', t('col_added'), 'ag-when') + '<span></span></div>' + rows + pager;
  }
  function oldBar() {
    if (UI.gf !== 'old') return '';
    var n = S.groups.filter(isOld).length, E = S.expire || {};
    if (!n) return '';
    return '<div class="ag-oldbar">' + IC.hour + '<span>' + esc(t('old_h', num(n), num(E.days || 365))) + ' ' + esc(t(E.auto ? 'old_auto' : 'old_manual')) + '</span>' +
      '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="expireall" data-n="' + n + '">' + t('old_rm', num(n)) + '</button></div>';
  }
  function groupCount() {
    var n = S.groups.filter(groupMatches).length;
    return n === S.groups.length ? num(n) : num(n) + ' / ' + num(S.groups.length);
  }
  function groups() {
    var chips = ['all', 'perm', 'dnd', 'temp', 'manual', 'partial', 'old'].map(function (f) {
      var n = S.groups.filter(function (g) { return kindMatch(g, f); }).length;
      if (f === 'partial' && !n && UI.gf !== f) return '';           // kısmi ban yoksa filtre görünmez
      return '<button class="ag-chip' + (UI.gf === f ? ' on' : '') + (n ? '' : ' zero') + '" data-act="gf" data-f="' + f + '">' + t('f_' + f) +
        '<span class="ag-chip-n">' + num(n) + '</span></button>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.ban + t('s_groups') + '</h2>' +
      '<span class="ag-count" id="ag-gcount">' + groupCount() + '</span><div class="ag-tools"><div class="ag-chips">' + chips + '</div>' +
      '<input class="ag-input" id="ag-gq" type="search" placeholder="' + esc(t('g_search')) + '" value="' + esc(UI.gq) + '" style="width:180px"></div></div>' +
      oldBar() + '<div class="ag-card-b ag-tbl" id="ag-groups-b">' + groupRows() + '</div></section>';
  }

  var EV_CLASS = {
    add24: 'ag-pill-ok', promote: 'ag-pill-acc', temp24: 'ag-pill-warn', skip_wl: 'ag-pill-info', warn16: 'ag-pill-warn',
    warn16t: 'ag-pill-warn', clean_temp: 'ag-pill-n', manual_ban: 'ag-pill-bad', manual_change: 'ag-pill-acc', manual_unban: 'ag-pill-n',
    manual_forget: 'ag-pill-n', manual_ignore: 'ag-pill-n', manual_unignore: 'ag-pill-n', config: 'ag-pill-acc', test_mail: 'ag-pill-n', digest: 'ag-pill-n'
  };
  var EV_GROUP = {
    bans: ['add24', 'promote', 'temp24', 'manual_ban'], warn: ['warn16', 'warn16t'], skip: ['skip_wl'],
    manual: ['manual_ban', 'manual_change', 'manual_unban', 'manual_forget', 'manual_ignore', 'manual_unignore'], clean: ['clean_temp', 'expire']
  };
  // olay rozeti açıklaması (üzerine gelince); elle işlemler tek açıklamayı paylaşır
  function evTitle(type) {
    var k = 'evh_' + (/^manual_/.test(type) ? 'manual' : type), v = t(k);
    return v === k ? '' : ' title="' + esc(v) + '"';
  }
  function evDetail(e) {
    var d = [];
    if (e.type === 'add24' || e.type === 'promote' || e.type === 'temp24') {
      d.push(t('n_ip', num(e.n)));
      if (e.dnd) d.push('do not delete');
    }
    if (e.type === 'warn16' || e.type === 'warn16t') d.push(t('n_ip', num(e.n)), t('n_subnets', num(e.subnets)), t(e.type === 'warn16t' ? 'from_temp' : 'from_perm'));
    if (e.type === 'skip_wl') { if (e.n != null) d.push(t('n_ip', num(e.n))); if (e.wl) d.push(t('wl', e.wl)); }
    var owner = e.owner || ownerOfIps(e.ips);
    if (owner) d.push(owner);
    if (e.changes) e.changes.forEach(function (c) { d.push((DICT[LANG]['k_' + c.key] || c.key) + ': ' + (c.from || '—') + ' → ' + (c.to || '—')); });
    if (e.to) d.push(e.to);
    if (e.by) d.push(t('by', e.by));
    if (e.removed) { var rn = (e.removed.ranges || 0) + (e.removed.singles || 0) + (e.removed.partials || 0) + (e.removed.temps || 0); if (rn) d.push(t('ev_removed', num(rn))); }
    if (e.restored) d.push(t('ev_restored', num(e.restored)));
    if (e.mode === 'svc' && (e.type === 'manual_ban' || e.type === 'manual_change')) d.push(t('ev_svc', svcNames(e.svc, e.extra) || t('svc_ports', String(e.ports || '').replace(/_/g, '–'))));
    if (e.mode === 'exc') d.push(t('ev_exc', svcNames(e.open, e.extra)));
    if (e.type === 'manual_change' && e.mode === 'all') d.push(t('ev_full'));
    if (e.type === 'clean_temp') d.push(t('clean_d'));
    if (e.src === 'log') d.push(t('from_log'));
    if (e.until) d.push(t('until', e.until));
    if (e.type === 'expire' && e.age != null) d.push(t('exp_age', num(e.age)));
    return esc(d.join(' · '));
  }
  var EV_ICON = {
    add24: ['ban', 'acc'], manual_ban: ['ban', 'bad'], manual_change: ['sliders', 'acc'], promote: ['lock', 'vio'], temp24: ['clock', 'warn'], warn16: ['alert', 'warn'], warn16t: ['alert', 'warn'],
    skip_wl: ['check', 'info'], clean_temp: ['x', 'n'], expire: ['hour', 'n'], config: ['sliders', 'acc'], test_mail: ['inbox', 'n'], digest: ['inbox', 'n']
  };
  /* Geçmiş sekmesi: eklentinin işleri · Ayarlar sekmesi (cfg): ayar değişiklikleri, test maili, özet */
  var CFG_TYPES = ['config', 'test_mail', 'digest'];
  function events(cfg) {
    var all = evList().slice().reverse().filter(function (e) { return (CFG_TYPES.indexOf(e.type) >= 0) === !!cfg; });
    // "son ziyaretten beri": o zamandan beri olan bütün işler — bir banı gösterip kaldırılışını saklamasın
    function match(e, f) { return f === 'all' ? true : f === 'new' ? isNew(e.t) : EV_GROUP[f].indexOf(e.type) >= 0; }
    function cmatch(e, f) { return f === 'all' || e.type === f; }
    var list = all.filter(function (e) { return cfg ? cmatch(e, UI.cf) : match(e, UI.ef); });
    var shown = list.slice(0, UI.evLimit);
    EV_SHORT = list.length < UI.evLimit;   // yüklenenler bitti: "Daha fazla" olay kaydından bir önceki sayfayı ister
    // ayar geçmişinde de Geçmiş sekmesindeki filtreler: ayar değişiklikleri / test mailleri / haftalık özetler
    var chips = cfg ? '<div class="ag-chips">' + ['all'].concat(CFG_TYPES).map(function (f) {
      var n = all.filter(function (e) { return cmatch(e, f); }).length;
      if (!n && f !== 'all' && f !== UI.cf) return '';
      return '<button class="ag-chip' + (UI.cf === f ? ' on' : '') + '" data-act="cf" data-f="' + f + '">' + t('cf_' + f) + '<span class="ag-chip-n">' + num(n) + '</span></button>';
    }).join('') + '</div>'
      : '<div class="ag-chips">' + (SEEN0 > 0 ? ['all', 'new'] : ['all']).concat(['bans', 'warn', 'skip', 'manual', 'clean']).map(function (f) {
      var n = all.filter(function (e) { return match(e, f); }).length;
      if (!n && f !== 'all' && f !== UI.ef) return '';
      return '<button class="ag-chip' + (UI.ef === f ? ' on' : '') + '" data-act="ef" data-f="' + f + '">' + t('e_' + f) + '<span class="ag-chip-n">' + num(n) + '</span></button>';
    }).join('') + '</div>';
    var rows = shown.map(function (e, i) {
      var key = 'e:' + e.t + ':' + e.type + ':' + (e.cidr || i);
      var open = UI.open[key], has = e.ips && e.ips.length;
      var ic = EV_ICON[e.type] || (/^manual_/.test(e.type) ? ['sliders', 'n'] : ['list', 'n']);
      return '<div class="ag-item"><div class="ag-ev' + (has ? ' clickable" data-act="toggle" aria-expanded="' + !!open + '" data-key="' + esc(key) : '') + '">' +
        '<div class="ag-ev-ic ' + ic[1] + '">' + IC[ic[0]] + '</div>' +
        '<div class="ag-ev-b"><div class="ag-ev-t">' + newDot(NEW_TYPES.indexOf(e.type) >= 0 ? e.t : 0) +
        // adres de IP kartını açsın (diğer tablolar gibi): tek IP kendisi, blok/ağ için ilk kayıtlı IP ya da ağın .1'i
        (e.cidr ? '<span class="ag-cidr" data-ip="' + esc(e.ips && e.ips[0] && e.ips[0].ip ? e.ips[0].ip
          : /\//.test(e.cidr) && !/\/32$/.test(e.cidr) ? String(e.cidr).replace(/\/\d+$/, '').replace(/\.0$/, '.1') : String(e.cidr).replace(/\/32$/, '')) + '">' + esc(e.cidr) + '</span>' : '') + '<span class="ag-pill ' + (EV_CLASS[e.type] || 'ag-pill-n') + '"' + evTitle(e.type) + '>' + esc(t('ev_' + e.type)) + '</span></div>' +
        '<div class="ag-ev-d">' + evDetail(e) + '</div></div>' +
        '<div class="ag-ev-time" title="' + esc(new Date(e.t * 1000).toLocaleString(loc())) + '">' + stamp(e.t) + (has ? '<span class="ag-chev">' + (open ? '−' : '+') + '</span>' : '') + '</div></div>' +
        (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }).join('');
    var more = list.length > shown.length || (EVL && EVMORE) ? '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="evmore"' +
      (EVBUSY && EV_SHORT ? ' disabled>' + t('ev_loading') : '>' + t('more')) + '</button></div>' : '';
    return '<section class="ag-card" id="' + (cfg ? 'ag-cfglog' : 'ag-events') + '"><div class="ag-card-h"><h2>' + (cfg ? IC.sliders + t('s_cfglog') : IC.list + t('s_events')) + '</h2>' +
      (chips ? '<div class="ag-tools">' + chips + '</div>' : '') + '</div>' +
      '<div class="ag-card-b">' + (rows || empty('inbox', all.length ? t('no_match') : t(cfg ? 'no_cfglog' : 'no_events'))) + '</div>' + more + '</section>';
  }

  function recentGet() { try { var r = JSON.parse(localStorage.getItem('ag-recent') || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function recentAdd(ip) {
    try { var r = recentGet().filter(function (x) { return x !== ip; }); r.unshift(ip); localStorage.setItem('ag-recent', JSON.stringify(r.slice(0, 5))); } catch (e) { /* tarayıcı depolaması kapalı */ }
  }
  function lookupCard() {
    var rec = recentGet();
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.search + t('s_lookup') + '</h2></div>' +
      '<div class="ag-lookup"><form id="ag-lk"><input class="ag-input ag-mono" id="ag-lk-ip" inputmode="decimal" autocomplete="off" value="' + esc(UI.lk || '') + '" placeholder="' + esc(t('lookup_ph')) + '">' +
      '<button class="ag-btn ag-btn-primary" type="submit">' + t('lookup_btn') + '</button></form>' +
      (rec.length ? '<div class="ag-recent"><span>' + t('lk_recent') + '</span>' + rec.map(function (ip) { return '<button class="ag-rc" data-ip="' + esc(ip) + '">' + esc(ip) + '</button>'; }).join('') + '</div>'
        : '<p>' + t('lookup_hint') + '</p>') + '</div></section>';
  }

  /* En çok engellenen sağlayıcılar: üç sekme — CSF / csf.deny'deki diğer bloklar / Imunify */
  function asnRow(i, a, w, sub, w2) {
    var name = String(a.name || '').replace(/,\s*[A-Z]{2}$/, '');
    return '<div class="ag-asn-r"><span class="ag-rank">' + (i + 1) + '</span><div class="ag-asn-m">' +
      '<div class="ag-asn-t">' + flag(a.cc) + '<span class="ag-asn">AS' + esc(a.asn) + '</span><span class="ag-org" title="' + esc(a.name) + '">' + esc(name) + '</span></div>' +
      '<div class="ag-asn-b"><i style="width:' + w + '%"></i>' + (w2 ? '<i class="o" style="width:' + w2 + '%"></i>' : '') + '</div><div class="ag-sub">' + sub + '</div></div></div>';
  }
  function pct(v, max) { return v ? Math.max(4, Math.round(v * 100 / Math.max(1, max))) : 0; }
  function asnAttack() {        // sıralama: kendi grup banlarımız + tekiller (saldırı kanıtı)
    var list = S.asn_top || [], max = 0, WHY = {};
    evList().forEach(function (e) {   // ASN → sebep sayıları (Imunify sekmesindeki gibi sebep görünsün)
      if (!e.asn || !e.ips) return;
      var c = WHY[e.asn] || (WHY[e.asn] = {});
      e.ips.forEach(function (i) { var w = whyText(i.why); if (w) c[w] = (c[w] || 0) + 1; });
    });
    function topWhy(asn) { var c = WHY[asn] || {}, b = ''; Object.keys(c).forEach(function (w) { if (!b || c[w] > c[b]) b = w; }); return b; }
    function wt(a) { return a.groups * 4 + a.singles; }
    list.forEach(function (a) { max = Math.max(max, wt(a) + (a.blocks || 0) * 4); });
    return list.slice(0, UI.asnAll ? list.length : 10).map(function (a, i) {
      var name = String(a.name || '').replace(/,\s*[A-Z]{2}$/, ''), parts = [];
      if (a.groups) parts.push(t('p_g', num(a.groups)));
      if (a.singles) parts.push(t('p_t', num(a.singles)));
      if (a.blocks) parts.push('<span class="ag-muted">' + t('p_b', num(a.blocks)) + '</span>');
      var tw = topWhy(String(a.asn)); if (tw) parts.push('<span class="ag-muted">' + esc(t('asn_why', tw)) + '</span>');
      // Öneri: en az 5 kendi grup banı (≥15 saldırgan, 5 ayrı blok) ve CC_DENY'de değilse.
      var tail = a.denied ? ' · <span class="ag-pill ag-pill-ok">' + t('asn_denied') + '</span>'
        : a.groups >= 5 ? ' · <button class="ag-link" data-act="asnhint" data-asn="' + esc(a.asn) + '" data-name="' + esc(name) + '" data-g="' + num(a.groups) + '">' + t('asn_hint') + '</button>' : '';
      return asnRow(i, a, pct(wt(a), max), parts.join(' · ') + tail, a.blocks ? pct(a.blocks * 4, max) : 0);
    }).join('');
  }
  function asnBlocks() {        // csf.deny'deki başka kaynaklı aralıklar
    var list = S.blocks_top || [], max = 0;
    list.forEach(function (a) { max = Math.max(max, a.blocks); });
    return list.slice(0, UI.asnAll ? list.length : 10).map(function (a, i) {
      var parts = [t('p_bn', num(a.blocks))];
      if (a.groups) parts.push('<span class="ag-muted">' + t('p_g', num(a.groups)) + '</span>');
      if (a.singles) parts.push('<span class="ag-muted">' + t('p_t', num(a.singles)) + '</span>');
      return asnRow(i, a, pct(a.blocks, max), parts.join(' · ') + (a.denied ? ' · <span class="ag-pill ag-pill-ok">' + t('asn_denied') + '</span>' : ''));
    }).join('');
  }
  function asnImunify() {       // Imunify360'ın bu sunucudaki kendi kara listesi
    var im = S.imunify || {}, list = im.top || [], max = 0;
    list.forEach(function (a) { max = Math.max(max, a.count); });
    return list.slice(0, UI.asnAll ? list.length : 10).map(function (a, i) {
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
    var nAll = (UI.at === 'blk' ? S.blocks_top : UI.at === 'im' ? im.top : S.asn_top) || [];
    if (nAll.length > 10) body += '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="asnall">' +
      (UI.asnAll ? t('show_less') : t('show_all', num(nAll.length))) + '</button></div>';
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.globe + t('s_asn') + '</h2>' + chips +
      '<span class="ag-hint" style="width:100%">' + hint + '</span></div><div class="ag-card-b">' + body + '</div></section>';
  }

  /* İzlenenler: bir kez geçici banlanmış /24'ler; grup tablosuyla aynı biçimde, sayfalı */
  var PPAGE = PAGE;
  function pendingSorted() { return S.pending.slice().sort(function (a, b) { return a.days_left - b.days_left; }); }
  function pending() {
    var list = pendingSorted(), pages = Math.max(1, Math.ceil(list.length / PPAGE));
    if (UI.pp >= pages) UI.pp = pages - 1;
    var from = UI.pp * PPAGE, shown = list.slice(from, from + PPAGE);
    var rows = shown.map(function (p) {
      var cidr = p.prefix + '.0/24', o = ownerOf(cidr), ev = (OWNERS[cidr] || {}).ev, key = 'p:' + cidr, open = UI.open[key];
      // neden izleniyor: geçici blok banının IP'leri ve sebepleri (olay kaydından)
      var pitems = [];
      if (ev && ev.ips && ev.ips.length) pitems.push({ act: 'toggle', label: open ? t('hide') : t('ips'), icon: 'list', attrs: 'data-key="' + esc(key) + '"' });
      var left = Math.max(0, p.days_left), ret = S.config.retention || 180, pct = Math.max(0, Math.min(100, left * 100 / ret));
      var urg = left < 7 ? ' bad' : left < 30 ? ' warn' : '';
      var first = ev && ev.ips && ev.ips[0] ? ev.ips[0].ip : p.prefix + '.1';
      return '<div class="ag-item" data-row="' + esc(cidr) + '"><div class="ag-tr ag-tr-p">' +
        '<div class="ag-td ag-td-stack"><span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(cidr) + '</span>' +
        (p.temp_ttl > 0 ? '<span class="ag-t-warn">' + t('ttl_left', dur(p.temp_ttl)) + '</span>' : '') + (p.under ? underPill(p.under, true) : '') + '</div>' +
        '<div class="ag-td ag-td-own" title="' + esc(o.label || '') + '">' + (o.asn ? flag(o.cc) + '<span class="ag-asn">AS' + esc(o.asn) + '</span><span class="ag-org">' + esc(o.name || '') + '</span>' : '<span class="ag-muted">—</span>') + '</div>' +
        '<div class="ag-td ag-when ag-td-since">' + esc(p.since) + '</div>' +
        '<div class="ag-td ag-td-left"><div class="ag-left' + urg + '"><div class="ag-days"><i style="width:' + pct + '%"></i></div><span>' + t('days_left', num(left)) + '</span></div></div>' +
        '<div class="ag-td ag-td-act">' + menu('pm:' + p.prefix, pitems.concat(p.under ? [] : [{ act: 'promote', label: t('promote'), icon: 'ban', attrs: 'data-t="' + esc(p.prefix) + '"' }])
                                .concat(bitsOf(p.under) > 16 ? [{ act: 'ban16', label: t('ban16'), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16(p.prefix)) + '"' }] : []).concat([
                                { act: 'forget', label: t('forget'), icon: 'x', attrs: 'data-t="' + esc(p.prefix) + '"' },
                                { act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' }])) + '</div></div>' +
        (open && ev ? ipTable(ev.ips, ev.total) : '') + '</div>';
    }).join('');
    var pager = pages > 1 ? '<div class="ag-pager"><span>' + t('of_n', from + 1, from + shown.length, list.length) + '</span>' +
      '<button class="ag-iconbtn" data-act="ppage" data-d="-1"' + (UI.pp ? '' : ' disabled') + ' aria-label="' + t('pg_prev') + '">‹</button>' +
      '<button class="ag-iconbtn" data-act="ppage" data-d="1"' + (UI.pp < pages - 1 ? '' : ' disabled') + ' aria-label="' + t('pg_next') + '">›</button></div>' : '';
    var body = list.length ? '<div class="ag-thead ag-tr-p"><span class="ag-th">' + t('col_block') + '</span><span class="ag-th">' + t('col_owner') + '</span>' +
      '<span class="ag-th ag-td-since">' + t('col_since') + '</span><span class="ag-th ag-th-r">' + t('col_left') + '</span><span></span></div>' + rows + pager
      : empty('check', t('no_pending'));
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.hour + t('s_pending') + '</h2><span class="ag-count">' + S.pending.length + '</span>' +
      '<span class="ag-hint" style="width:100%">' + t('s_pending_h') + '</span></div>' +
      '<div class="ag-card-b ag-tbl">' + body + '</div></section>';
  }

  function ignored() {
    if (!S.ignored.length) return '';
    var rows = S.ignored.map(function (g) {
      return '<div class="ag-row"><div class="ag-row-main"><div class="ag-row-t"><span class="ag-cidr" data-ip="' + esc(String(g.cidr).replace(/\/\d+$/, '').replace(/\.0$/, '.1')) + '">' + esc(g.cidr) + '</span></div>' +
        '<div class="ag-row-s">' + t('until', esc(g.until)) + ' · ' + t('by', esc(g.by)) + '</div></div>' +
        '<div class="ag-row-a"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="unignore" data-c="' + esc(g.cidr) + '">' + t('unignore') + '</button></div></div>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.mute + t('s_ignored') + '</h2><span class="ag-count">' + S.ignored.length + '</span></div>' +
      '<div class="ag-card-b">' + rows + '</div></section>';
  }

  function config() {
    var c = S.config;
    function kv(k, v) { return '<div class="ag-rule"><small>' + esc(k) + '</small><b>' + esc(v) + '</b></div>'; }
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.sliders + t('s_config') + '</h2>' +
      '<div class="ag-tools"><button class="ag-link" data-act="tab" data-tab="settings">' + t('edit') + '</button></div></div><div class="ag-rules">' +
      kv(t('c_t24'), t('c_singles', c.t24)) + kv(t('c_t24p'), t('c_singles', c.t24p)) + kv(t('c_t16'), t('c_singles', c.t16)) +
      kv(t('c_tt24'), t('c_singles', c.tt24)) + kv(t('c_tt16'), t('c_singles', c.tt16)) + kv(t('c_ret'), t('c_days', c.retention)) +
      '</div><div class="ag-rules-f">' + esc(t('c_gloss')) + '<br>' + esc(t('c_lookup')) + ': <b>' + (c.lookup ? t('c_on') : t('c_off')) + '</b>' +
      (S.expire ? '<br>' + esc(t(S.expire.auto ? 'c_auto_on' : 'c_auto_off', num(S.expire.days))) : '') + '</div></section>';
  }

  /* ── Ayarlar sekmesi ───────────────────────────────────────────── */
  var RANGES = {
    THRESHOLD_24: [2, 50], THRESHOLD_24_PERMANENT: [2, 100], THRESHOLD_16: [2, 500], THRESHOLD_TEMP_24: [2, 50],
    THRESHOLD_TEMP_16: [2, 500], LOOKUP_TIMEOUT: [1, 10], SAYAC_RETENTION_DAYS: [7, 730], REVIEW_DAYS: [1, 90], BLOCK_EXPIRE_DAYS: [30, 3650], LOG_ROTATE_MB: [1, 100], LOG_ROTATE_KEEP: [1, 52], LOG_MAX_LINES: [500, 100000]
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
    if (String(cv('ALERT_MAIL')) !== 'whm' && !/^[A-Za-z0-9._%+-]+(@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)?$/.test(String(cv('ALERT_MAIL')))) e.ALERT_MAIL = t('mail_bad');
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
      '<span class="ag-sub">' + t('default_v', esc(CFG.defaults[k])) + '</span></div>' +
      '<input class="ag-input ag-num" id="ag-f-' + k + '" data-cfg="' + k + '" type="number" inputmode="numeric" min="' + r[0] + '" max="' + r[1] + '" step="1" value="' + esc(cv(k)) + '">' +
      '<div class="ag-field-h">' + (errs[k] ? esc(errs[k]) : t('h_' + k)) + '</div><div class="ag-field-i">' + esc(thrImpact(k)) + '</div></div>';
  }
  // Eşiğin etkisi: motorun verdiği blok başına sayılarla (S.dist) — /16, motordaki gibi banlanacak blokları saymaz
  function distCalc(kind, t24, t16) {
    var D = (S && S.dist && S.dist[kind]) || {}, b = 0, n = 0;
    Object.keys(D).forEach(function (net) {
      var rest = D[net].filter(function (c) { return c < t24; }), sum = rest.reduce(function (a, c) { return a + c; }, 0);
      b += D[net].length - rest.length;
      if (sum >= t16 && rest.length >= 2) n++;
    });
    return { b: b, n: n };
  }
  function thrImpact(k) {
    if (!CFG || !S || !S.dist || String(cv(k)) === String(CFG.values[k]) || !(+cv(k) > 0)) return '';
    var V = CFG.values, perm = k === 'THRESHOLD_24' || k === 'THRESHOLD_16', kind = perm ? 'p' : 't';
    var k24 = perm ? 'THRESHOLD_24' : 'THRESHOLD_TEMP_24', k16 = perm ? 'THRESHOLD_16' : 'THRESHOLD_TEMP_16';
    if (k !== k24 && k !== k16) return '';
    // fark gösterilir: eşiği zaten aşıp banlanmamış bloklar (beyaz liste, yoksayma) iki hesapta da aynı kalır
    if (+cv(k) > +V[k]) return t('imp_up');
    var now = distCalc(kind, +cv(k24), +cv(k16)), was = distCalc(kind, +V[k24], +V[k16]);
    var d = k === k24 ? now.b - was.b : now.n - was.n;
    return d > 0 ? t(k === k24 ? (perm ? 'imp_b' : 'imp_tb') : (perm ? 'imp_n' : 'imp_tn'), num(d)) : t('imp_same');
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
    var isWhm = String(cv('ALERT_MAIL')) === 'whm', nt = String(cv('NOTIFY') || 'all'), mOn = nt !== 'slack', sOn = nt !== 'email';
    // kanallar: e-posta (bizim HTML mail; adres WHM'den ya da elle) + Slack (WHM'deki adres); varsayılan ikisi birden
    var mailAddr = isWhm ? (CFG.whm_contact || 'root@localhost') : String(cv('ALERT_MAIL') || '—');
    var chH = (mOn ? [t('nt_h_mail', mailAddr)] : []).concat(sOn ? [CFG.slack ? t('nt_h_slack') : t('nt_h_noslack')] : []).join(' · ') + '. ' + t('nt_h');
    var notify = '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_notify_ch') + '</label></div>' +
      seg('NOTIFY', [['all', t('nt_all')], ['email', t('nt_email')], ['slack', t('nt_slack')]]) +
      '<div class="ag-field-h">' + esc(chH) + '</div></div>' +
      (mOn ? '<div class="ag-field' + (errs.ALERT_MAIL ? ' bad' : '') + (mailDirty ? ' changed' : '') + '"><div class="ag-field-l"><label for="ag-f-mail">' + t('st_mail') + '</label></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<div class="ag-chips"><button type="button" class="ag-chip' + (isWhm ? ' on' : '') + '" data-act="mailmode" data-v="whm">' + t('mail_whm') + '</button>' +
      '<button type="button" class="ag-chip' + (isWhm ? '' : ' on') + '" data-act="mailmode" data-v="custom">' + t('mail_custom') + '</button></div>' +
      (isWhm ? '' : '<input class="ag-input" id="ag-f-mail" data-cfg="ALERT_MAIL" type="email" autocomplete="off" style="flex:1;min-width:220px" value="' + esc(cv('ALERT_MAIL')) + '">') + '</div>' +
      '<div class="ag-field-h">' + (errs.ALERT_MAIL ? esc(errs.ALERT_MAIL) : isWhm ? (CFG.whm_contact && CFG.whm_contact !== 'root@localhost' ? esc(t('mail_whm_h', CFG.whm_contact)) : t('mail_whm_none')) : t('st_mail_h')) + '</div></div>' : '') +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_lang') + '</label></div>' + seg('MSG_LANG', [['tr', 'Türkçe'], ['en', 'English']]) +
      '<div class="ag-field-h">' + t('st_lang_h') + '</div></div>' +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_digest') + '</label>' +
      '<button class="ag-link" data-act="digestprev">' + t('digest_prev') + '</button></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' + seg('DIGEST', [['1', t('on')], ['0', t('off')]]) +
      (String(cv('DIGEST')) === '1' ? seg('DIGEST_DAY', [1, 2, 3, 4, 5, 6, 7].map(function (d) { return [String(d), t('d' + d)]; })) : '') + '</div>' +
      '<div class="ag-field-h">' + t('st_digest_h') + '</div></div>' +
      (sOn ? '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_slack_ev') + '</label></div>' +
      '<div class="ag-chips ag-icwrap">' + [['IC_FIREWALL', 'ic_fw'], ['IC_LISTFULL', 'ic_list'], ['IC_RUN', 'ic_run'], ['IC_DIGEST', 'ic_digest']].map(function (x) {
        var on = String(cv(x[0])) === '1';
        return '<button type="button" class="ag-chip' + (on ? ' on' : '') + '" data-act="cfgchip" data-k="' + x[0] + '" data-v="' + (on ? '0' : '1') + '" aria-pressed="' + on + '">' + esc(t(x[1])) + '</button>';
      }).join('') + '</div>' +
      '<div class="ag-field-h">' + t('ic_ev_h') + '</div></div>' : '') +
      (mOn ? '<div class="ag-field"><button class="ag-btn" data-act="cfgtest"' + (mailDirty ? ' disabled' : '') + '>' + IC.inbox + t('st_test') + '</button>' +
      '<div class="ag-field-h">' + (mailDirty ? t('st_test_dirty') : t('st_test_h') + ' ' + esc(CFG.values.ALERT_MAIL === 'whm' ? (CFG.whm_contact || 'root@localhost') : CFG.values.ALERT_MAIL)) + '</div></div>' : '') +
      (sOn ? '<div class="ag-field"><button class="ag-btn" data-act="ictest"' + (CFG.slack ? '' : ' disabled') + '>' + IC.bell + t('ic_test') + '</button>' +
      '<div class="ag-field-h">' + (CFG.slack ? t('ic_test_h') : esc(t('nt_h_noslack'))) + '</div></div>' : '');
    var thr = ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24', 'THRESHOLD_TEMP_16'].map(function (k) { return field(k, errs); }).join('');
    var cronCur = String(CFG.values.CRON_MIN || '');
    var sched = '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_sched') + '</label></div>' +
      seg('CRON_MIN', [['*/5', t('cron_5')], ['*/10', t('cron_10')], ['*/15', t('cron_15')], ['*/30', t('cron_30')], ['0', t('cron_0')]]) +
      '<div class="ag-field-h">' + t('st_sched_h') + (cronCur && ['*/5', '*/10', '*/15', '*/30', '0'].indexOf(cronCur) < 0 ? ' (' + esc(cronCur) + ')' : '') + '</div></div>';
    var look = '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_LOOKUP') + '</label></div>' + seg('LOOKUP', [['1', t('on')], ['0', t('off')]]) +
      '<div class="ag-field-h">' + (CFG.dns_tool ? t('h_LOOKUP') : '<span style="color:var(--ag-warn)">' + t('st_nodns') + '</span>') + '</div></div>' + field('LOOKUP_TIMEOUT', errs);
    var LG = CFG.log || {}, rot = !!LG.rotate;
    var keep = (rot ? ['SAYAC_RETENTION_DAYS', 'REVIEW_DAYS', 'LOG_ROTATE_MB', 'LOG_ROTATE_KEEP'] : ['SAYAC_RETENTION_DAYS', 'REVIEW_DAYS', 'LOG_MAX_LINES']).map(function (k) { return field(k, errs); }).join('') +
      field('BLOCK_EXPIRE_DAYS', errs) +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_BLOCK_EXPIRE_AUTO') + '</label></div>' + seg('BLOCK_EXPIRE_AUTO', [['1', t('on')], ['0', t('off')]]) +
      '<div class="ag-field-h">' + t('h_BLOCK_EXPIRE_AUTO') + '</div></div>' +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_logfile') + '</label></div><div class="ag-loginfo">' +
      (rot ? t('log_rot', esc(bytes(LG.bytes)), num(LG.archives), num(CFG.values.LOG_ROTATE_MB || 1), num(CFG.values.LOG_ROTATE_KEEP || 5)) : t('log_lines', num(LG.lines), num(cv('LOG_MAX_LINES')))) + '</div></div>';
    var csf = '<dl class="ag-kv" style="padding:0">' +
      '<dt>' + t('csf_deny') + '</dt><dd>' + (CFG.csf.deny_limit ? num(CFG.csf.deny_limit) : '—') + '</dd>' +
      '<dt>' + t('csf_temp') + '</dt><dd>' + (CFG.csf.temp_limit ? num(CFG.csf.temp_limit) : '—') + '</dd></dl>' +
      '<a class="ag-btn ag-btn-sm" href="../configserver/csf.cgi" target="_top">' + IC.ext + t('csf_open') + '</a>';
    var secs = settingsSections(), cur = secs.filter(function (x) { return x.k === UI.st; })[0] || secs[0];
    var body = cur.k === 'notify' ? card('inbox', t('st_notify'), '', notify)
      : cur.k === 'thr' ? card('sliders', t('st_thr'), t('st_thr_h'), thr)
      : cur.k === 'sched' ? card('clock', t('st_sched'), '', sched)
      : cur.k === 'look' ? card('search', t('st_lookup'), '', look)
      : cur.k === 'keep' ? card('hour', t('st_keep'), '', keep)
      : cur.k === 'server' ? updCard() + card('shield', t('st_csf'), t('st_csf_h'), csf) + depsCard()
      : events(true);
    var nav = secs.map(function (x) {
      return '<button class="ag-setnav-i' + (x.k === cur.k ? ' on' : '') + '" data-act="st" data-s="' + x.k + '"' + (x.k === cur.k ? ' aria-current="page"' : '') + '>' +
        IC[x.icon] + '<span>' + esc(x.label) + '</span><i class="ag-setnav-dot' + secState(x) + '"></i></button>';
    }).join('');
    return '<div class="ag-setwrap"><nav class="ag-setnav" aria-label="' + esc(t('tab_settings')) + '">' + nav + '</nav>' +
      '<div class="ag-setmain ag-setform">' + body + '</div></div>' +
      '<div id="ag-savebar-slot">' + saveBar() + '</div>';
  }
  /* Ayarlar bölümleri: hangi anahtar hangi bölümde (kaydedilmemiş değişiklik noktası için) */
  function settingsSections() {
    return [
      { k: 'notify', icon: 'inbox', label: t('st_notify'), keys: ['NOTIFY', 'ALERT_MAIL', 'MSG_LANG', 'DIGEST', 'DIGEST_DAY', 'IC_FIREWALL', 'IC_LISTFULL', 'IC_RUN', 'IC_DIGEST'] },
      { k: 'thr', icon: 'sliders', label: t('st_thr'), keys: ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24', 'THRESHOLD_TEMP_16'] },
      { k: 'sched', icon: 'clock', label: t('st_sched'), keys: ['CRON_MIN'] },
      { k: 'look', icon: 'search', label: t('st_lookup'), keys: ['LOOKUP', 'LOOKUP_TIMEOUT'] },
      { k: 'keep', icon: 'hour', label: t('st_keep'), keys: ['SAYAC_RETENTION_DAYS', 'REVIEW_DAYS', 'BLOCK_EXPIRE_DAYS', 'BLOCK_EXPIRE_AUTO', 'LOG_ROTATE_MB', 'LOG_ROTATE_KEEP', 'LOG_MAX_LINES'] },
      { k: 'server', icon: 'shield', label: t('sn_server'), keys: [] },
      { k: 'hist', icon: 'list', label: t('s_cfglog'), keys: [] }
    ];
  }
  function secState(x) {       // '' | ' dirty' (kaydedilmemiş) | ' bad' (hatalı alan ya da eksik zorunlu araç)
    var errs = cfgErrors(), ch = changedKeys();
    if (x.keys.some(function (k) { return errs[k]; })) return ' bad';
    if (x.k === 'server' && ((CFG && CFG.deps) || []).some(function (d) { return d.s !== 'ok' && d.k !== 'imunify'; })) return ' warn';
    if (x.k === 'server' && UPD && UPD.ok && !UPD.uptodate) return ' dirty';
    return x.keys.some(function (k) { return ch.indexOf(k) >= 0; }) ? ' dirty' : '';
  }
  function refreshSaveBar() {
    document.querySelectorAll('#ag-app .ag-setnav-i').forEach(function (b) {
      var x = settingsSections().filter(function (s) { return s.k === b.getAttribute('data-s'); })[0];
      var dot = b.querySelector('.ag-setnav-dot'); if (x && dot) dot.className = 'ag-setnav-dot' + secState(x);
    });
    // Kaydet çubuğu: her tuşta baştan çizilirse belirme animasyonu her harfte yeniden oynar ("zıplar").
    // Çubuk zaten görünüyorsa yalnız içi güncellenir; yalnız ilk görünüş/kayboluşta yeniden çizilir.
    var slot = document.getElementById('ag-savebar-slot');
    if (slot) {
      var html = saveBar();
      if (slot._h !== html) {
        var cur = slot.querySelector('.ag-savebar'), tmp = document.createElement('div'); tmp.innerHTML = html;
        var nb = tmp.querySelector('.ag-savebar');
        if (cur && nb) cur.innerHTML = nb.innerHTML; else slot.innerHTML = html;
        slot._h = html;
      }
    }
    // alan hata/değişti işaretleri: yeniden çizmeden güncelle (yazarken odak kaybolmasın)
    var errs = cfgErrors();
    document.querySelectorAll('#ag-app [data-cfg]').forEach(function (inp) {
      var k = inp.getAttribute('data-cfg'), f = inp.closest('.ag-field'); if (!f) return;
      f.classList.toggle('bad', !!errs[k]);
      f.classList.toggle('changed', String(cv(k)) !== String(CFG.values[k]));
      var h = f.querySelector('.ag-field-h');
      if (h) h.textContent = errs[k] ? errs[k] : (k === 'ALERT_MAIL' ? t('st_mail_h') : t('h_' + k));
    });
    // eşik etkisi: bir eşik değişince /24 ve /16 sayıları birlikte değişir, hepsi güncellenir
    document.querySelectorAll('#ag-app .ag-field-i').forEach(function (x) {
      var inp = x.parentNode.querySelector('[data-cfg]'); if (inp) x.textContent = errs[inp.getAttribute('data-cfg')] ? '' : thrImpact(inp.getAttribute('data-cfg'));
    });
  }

  function render() {
    if (!S) return;
    indexOwners();
    var y = window.scrollY, ae = document.activeElement, fsel = ae && $app.contains(ae) ? focusSel(ae) : '', s0 = null, s1 = null;
    var mw = fsel && ae.closest ? ae.closest('.ag-menu-wrap') : null, fmenu = mw ? focusSel(mw.querySelector('[data-act="menu"]')) : '';   // menü kapanırsa odak düğmesine
    try { if (fsel && ae.id && ae.selectionStart !== undefined) { s0 = ae.selectionStart; s1 = ae.selectionEnd; } } catch (e) { s0 = null; }
    var body = UI.tab === 'settings' ? settingsView()
      : UI.tab === 'history' ? '<div class="ag-history">' + events() + '</div>'
      : statusBand() + sinceBar() + kpis() + activity() + '<div class="ag-grid"><div class="ag-col">' + review() + groups() + pending() + '</div>' +
        '<div class="ag-col">' + lookupCard() + topAsn() + ignored() + config() + '</div></div>';
    $app.innerHTML = '<div class="ag-wrap">' + head() + '<div id="ag-bnr">' + banner() + '</div>' + body +
      '<div class="ag-foot">' + esc(t('foot', S.version + (BOOT.commit ? ' (' + BOOT.commit + ')' : ''), BOOT.user || 'root')) + '</div></div>';
    $app.setAttribute('aria-busy', 'false');
    window.scrollTo(0, y);
    keyboardable($app);
    if (fsel) {
      var fe = refocus(fsel) || refocus(fmenu);
      if (fe && s0 !== null) { try { fe.setSelectionRange(s0, s1); } catch (e) { /* bu alan türü imleç desteklemiyor */ } }
    }
    if (UI.menu) {
      var mn = $app.querySelector('.ag-menu');
      if (mn) {   // aşağıda yer yoksa (kartın ya da pencerenin altı) ve yukarıda varsa yukarı açılır
        var mr = mn.getBoundingClientRect(), cd = mn.closest('.ag-card'), cr = cd ? cd.getBoundingClientRect() : null;
        var lim = Math.min(window.innerHeight, cr ? cr.bottom : window.innerHeight), top = Math.max(0, cr ? cr.top : 0);
        if (mr.bottom > lim - 4 && mr.top - mr.height - 40 > top) mn.classList.add('ag-menu-up');
      }
      var mi = $app.querySelector('.ag-menu .ag-menu-i'); if (mi && (!fsel || /data-act="menu"/.test(fsel))) mi.focus({ preventScroll: true });
    }
    if (UI.tab === 'settings' && UI.st === 'server') freshCheckIfStale();
  }

  /* Odak: öğe yeniden çizilince aynı niteliklerle bulunup odak geri verilir */
  var FKEYS = ['data-act', 'data-key', 'data-f', 'data-t', 'data-d', 'data-c', 'data-k', 'data-tab', 'data-ip', 'data-v', 'data-s'];
  function focusSel(el) {
    if (!el || el === document.body || !el.getAttribute) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    var s = '';
    FKEYS.forEach(function (a) { var v = el.getAttribute(a); if (v !== null) s += '[' + a + '="' + CSS.escape(v) + '"]'; });
    return s;
  }
  function refocus(sel) {
    if (!sel) return null;
    var el = null;
    try { el = $app.querySelector(sel) || document.querySelector(sel); } catch (e) { el = null; }
    if (el) el.focus({ preventScroll: true });
    return el;
  }
  /* Tıklanabilir ama düğme olmayan öğeler (IP, olay satırı, grafik günü) klavyeyle de ulaşılsın */
  function keyboardable(box) {
    box.querySelectorAll('[data-ip]:not(button):not(a), .ag-ev.clickable, .ag-c.has').forEach(function (e) {
      e.tabIndex = 0;
      if (!e.classList.contains('ag-c') && !e.getAttribute('role')) e.setAttribute('role', 'button');
    });
  }
  /* Pencere ve yan panel: Tab odak içinde döner */
  function trap(box) {
    box.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') return;
      var f = Array.prototype.filter.call(box.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href],[tabindex]:not([tabindex="-1"])'),
        function (e) { return e.offsetParent !== null; });
      if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
      else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
    });
  }

  /* ── Durum / yoklama ───────────────────────────────────────────── */
  function refresh() {
    return api('status').then(function (d) {
      if (!d || d.ok === false) { throw new Error((d && (d.message || d.error)) || 'status'); }
      S = d; LANG = d.lang === 'tr' ? 'tr' : 'en'; CLOCK = d.now - Date.now() / 1000; LAST_OK = d.now; setConn(null);
      if (SEEN0 === null) { SEEN0 = d.last_seen || 0; setTimeout(function () { api('seen').catch(function () {}); }, 1500); }
      document.documentElement.lang = LANG;
      if (wasRunning && !d.running) toast(t('t_done'), 'ok');
      wasRunning = d.running;
      schedule(d.running ? 3000 : 60000);
      if (!busy && !(UI.tab === 'settings' && CFG && changedKeys().length)) render();
      evLoad().then(function (n) { if (n && !busy && !(UI.tab === 'settings' && CFG && changedKeys().length)) render(); });
    }).catch(function (e) {
      if (!S) $app.innerHTML = '<div class="ag-wrap">' + empty('alert', String(e.message || e)) + '</div>';
      else if (CONN !== 'session') setConn('net');
      schedule(60000);
    });
  }
  setInterval(function () { if (document.hidden) return; var el = document.getElementById('ag-next'); if (el && S && !S.running) el.textContent = nextIn() || '—'; }, 1000);
  function schedule(ms) {
    clearTimeout(pollTimer);
    if (CONN === 'session') return;
    // Sekme görünmüyorsa sunucuyu yorma: vakti gelen yoklama sekmeye dönülünce yapılır
    pollTimer = setTimeout(function () { if (document.hidden) { HIDDEN_DUE = true; return; } refresh(); }, ms);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && HIDDEN_DUE) { HIDDEN_DUE = false; refresh(); } });

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
  var MODAL_N = 0;
  function modal(opts) {
    // menü öğesinden açıldıysa öğe menüyle birlikte kaybolur: odak menünün düğmesine döner
    var oa = document.activeElement, ow = oa && oa.closest ? oa.closest('.ag-menu-wrap') : null;
    var opener = focusSel(ow ? ow.querySelector('[data-act="menu"]') : oa), hid = 'ag-mh-' + (++MODAL_N);
    return new Promise(function (resolve) {
      var scrim = document.createElement('div'); scrim.className = 'ag-scrim';
      var wrap = document.createElement('div'); wrap.className = 'ag-modal-wrap ag-app'; wrap.style.cssText = 'background:transparent;margin:0;padding:20px;min-height:0';
      var days = opts.days ? '<label>' + t('m_ignore_d') + '</label><div class="ag-chips" id="ag-days">' + [7, 30, 90].map(function (d, i) {
        return '<button type="button" class="ag-chip' + (i === 1 ? ' on' : '') + '" data-d="' + d + '">' + t('c_days', d) + '</button>';
      }).join('') + '</div>' : '';
      var typed = opts.typed ? '<label>' + t('type_to_confirm', '<span class="ag-target">' + esc(opts.typed) + '</span>') + '</label>' +
        '<input class="ag-input ag-mono" id="ag-typed" autocomplete="off" spellcheck="false">' : '';
      wrap.innerHTML = '<div class="ag-modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + hid + '">' +
        '<div class="ag-modal-h">' + (opts.icon ? '<div class="ag-modal-ic ' + (opts.tone || 'acc') + '">' + IC[opts.icon] + '</div>' : '') +
        '<h3 id="' + hid + '" style="padding-top:' + (opts.icon ? '7px' : '0') + '">' + opts.title + '</h3></div>' +
        '<div class="ag-modal-b">' + (opts.html || '') + days + typed + '</div>' +
        '<div class="ag-modal-f">' + (opts.noCancel ? '' : '<button class="ag-btn" data-m="no">' + (opts.cancelText || t('cancel')) + '</button>') +
        (opts.okText === null ? '' : '<button class="ag-btn ' + (opts.okClass || 'ag-btn-primary') + '" data-m="ok">' + (opts.okText || t('confirm')) + '</button>') + '</div></div>';
      document.body.appendChild(scrim); document.body.appendChild(wrap);
      var ok = wrap.querySelector('[data-m="ok"]'), inp = wrap.querySelector('#ag-typed'), chosen = 30;
      if (inp && ok) { ok.disabled = true; inp.addEventListener('input', function () { ok.disabled = inp.value.trim() !== opts.typed; }); setTimeout(function () { inp.focus(); }, 30); }
      else if (ok) setTimeout(function () { ok.focus(); }, 30);
      else setTimeout(function () { var c0 = wrap.querySelector('[data-m="no"]'); if (c0) c0.focus(); }, 30);
      trap(wrap);
      var dz = wrap.querySelector('#ag-days');
      if (dz) dz.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-d]'); if (!b) return;
        chosen = +b.getAttribute('data-d');
        dz.querySelectorAll('.ag-chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      });
      function done(v) {
        scrim.remove(); wrap.remove(); var i = layerStack.indexOf(cancel); if (i >= 0) layerStack.splice(i, 1);
        resolve({ ok: v, days: chosen, el: wrap });
        setTimeout(function () { if (!layerStack.length && (document.activeElement === document.body || !document.activeElement)) refocus(opener); }, 0);
      }
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
  /* Elle /24 ya da /16 banı: önce içindekiler okunur (motorun --inside taraması; ban eylemi aynı hesabı
     kullanır), pencere neyin kapsanacağını, beyaz liste çakışmasını ve "kapsananları kaldır"ı gösterir. */
  function p16(c) { var a = String(c).split('.'); return a[0] + '.' + a[1]; }
  function bitsOf(c) { var m = /\/(\d+)$/.exec(String(c || '')); return m ? +m[1] : 32; }
  // Ban sebebinden servis — motordaki AWK_CLS ile aynı kural (csf_autogroup.sh); birini değiştirirsen ötekini de değiştir
  function svcOfReason(r) {
    r = String(r || '').toLowerCase();
    if (/port ?scan|ps_limit|lf_distattack/.test(r)) return 'scan';
    if (/sshd|lf_sshd/.test(r)) return 'ssh';
    if (/ftpd|lf_ftpd|lf_distftp/.test(r)) return 'ftp';
    if (/cpanel|cpaneld|whm|webmail|lf_cpanel|webmin|lf_webmin|directadmin/.test(r)) return 'cp';
    if (/smtpauth|lf_smtpauth|lf_distsmtp|sasl|imapd|pop3d|lf_pop3d|lf_imapd|dovecot|courier/.test(r)) return 'sync';
    if (/exim|lf_eximsyntax|smtp|relay|spam/.test(r)) return 'min';
    if (/named|lf_dns|dns/.test(r)) return 'dns';
    if (/mod_?security|htpasswd|lf_htaccess|lf_modsec|apache|nginx|litespeed|http|wordpress|wp-|xmlrpc|joomla|login\.php|lf_apache|404/.test(r)) return 'web';
    return 'other';
  }
  function svcLabel(k) { return k === 'other' ? t('svc_other') : k === 'scan' ? t('svc_scan') : t('svc_' + k); }
  function countList(o) { return Object.keys(o || {}).sort(function (a, b) { return o[b] - o[a]; }).map(function (k) { return svcLabel(k) + ' (' + num(o[k]) + ')'; }).join(', '); }
  // Servis seçimi iki kipte aynı liste; "giden" servisler yalnız "hariç" kipinde (diğer kip yalnız gelen bağlantıları kapatır)
  var SVC_IN = ['web', 'ssh', 'ftp', 'cp', 'min', 'sync', 'dns'], SVC_OUT = ['mout', 'wout'];
  function svcPorts(k, d, exc) {
    if (k === 'ssh') return d && d.ssh ? String(d.ssh).split(',').join(', ') : '22';
    if (k === 'ftp') return '21' + (exc && d && d.ftp_pasv ? ' · ' + t('svc_pasv', String(d.ftp_pasv).replace('_', '–')) : '');
    return { web: '80, 443', cp: '2077–2096', min: '25', sync: '465, 587, IMAP, POP3', dns: '53', mout: '25', wout: '80, 443' }[k] || '';
  }
  function svcNames(keys, extra) {   // "web,ssh" + "8080" → "Web, SSH, port 8080"
    var a = String(keys || '').split(',').filter(Boolean).map(function (k) { return t('svc_' + k); });
    if (extra) a.push(t('svc_ports', String(extra).split(',').join(', ').replace(/_/g, '–')));
    return a.join(', ');
  }
  function portsOk(v) {             // "8080, 30000-35000" → "8080,30000-35000"; boşsa ""; geçersizse null
    v = String(v || '').replace(/\s+/g, '');
    if (!v) return '';
    if (!/^\d{1,5}(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*$/.test(v)) return null;
    var bad = v.split(',').some(function (x) { var q = x.split('-').map(Number); return q[0] < 1 || q[q.length - 1] > 65535 || (q.length === 2 && q[0] >= q[1]); });
    return bad ? null : v;
  }
  /* Elle /24 ya da /16 banı: önce içindekiler okunur (motorun --inside taraması; ban eylemi aynı hesabı kullanır).
     Pencere neyin kapsanacağını, beyaz liste çakışmasını, "Ne kapatılsın" seçimini ve "kapsananları kaldır"ı gösterir.
     Eklentinin kendi banı için açılırsa (Banı değiştir) seçim banın şu anki hâliyle başlar. */
  function rangeBan(bits, target, o) {
    o = o || {};
    var cidr = bits === 16 ? target + '.0.0/16' : target + '.0/24', D = null, W = null;
    var M = { mode: 'all', clean: true, extra: { svc: '', exc: '' }, sel: { svc: {}, exc: {} } };
    function att(k) { return D && D.attacks ? +(D.attacks[k] || 0) : 0; }
    function attList(keys) { return keys.map(function (k) { return t('svc_' + k) + ' (' + num(att(k)) + ')'; }).join(', '); }
    function cIn() { return '<span class="ag-mono">' + esc(cidr) + '</span>'; }
    function changing() { return !!D && (D.own_full || (D.own_partial || []).indexOf(cidr) >= 0); }
    function picked() {
      var s = M.sel[M.mode] || {};
      return Object.keys(s).filter(function (k) { return s[k] && (M.mode === 'exc' || SVC_IN.indexOf(k) >= 0); });
    }
    function hints() {             // öneri gerekçesi ve servisler arası bağımlılıklar (ayrıntı: README → Manual bans)
      var s = M.sel[M.mode] || {}, h = [];
      var hit = SVC_IN.filter(function (k) { return att(k) > 0; });
      var tot = Object.keys(D && D.attacks || {}).reduce(function (a, k) { return a + att(k); }, 0);
      if (M.mode === 'all' && !changing() && hit.length && hit.length <= 2 && !att('scan') && att('other') <= tot * 0.2)
        h.push({ text: t('h_part_sug', attList(hit)), mode: 'svc', label: t('h_part_go') });
      if (M.mode === 'svc' && !changing()) h.push(hit.length ? t('h_att_pre', attList(hit)) : t('h_no_att'));
      if (M.mode === 'svc' && att('scan')) h.push(t('h_scan', num(att('scan'))));
      if (M.mode === 'exc') {
        if (!picked().length && !portsOk(M.extra.exc)) h.push(t('h_exc_pick'));
        var bad = picked().filter(function (k) { return att(k) > 0; });
        if (bad.length) h.push(t('h_exc_att', attList(bad)));
        if ((s.min || s.sync || s.mout) && !s.dns) h.push(t('h_dns_mail'));
        if (s.web && !s.dns) h.push(t('h_dns_web'));
        if (s.cp && !s.web) h.push(t('h_cp_exc'));
        if (s.ftp && !(D && D.ftp_pasv)) h.push(t('h_ftp_nopasv'));
      } else if (M.mode === 'svc') {
        if (s.dns) h.push(t('h_dns_blk'));
        if (s.cp && !s.web) h.push(t('h_cp_svc'));
        if (D && D.own_full && D.restore) h.push(t('h_chg_restore', num(D.restore)));
      }
      return h;
    }
    function chip(k, on) {          // saldırı görülen serviste kaç IP'nin saldırdığı rozetle görünür
      var n = att(k);
      return '<button type="button" class="ag-svc' + (on ? ' on' : '') + '" data-svc="' + k + '" aria-pressed="' + !!on + '">' + esc(t('svc_' + k)) +
        ' <small>' + esc(svcPorts(k, D, M.mode === 'exc')) + '</small>' +
        (n ? '<span class="ag-svc-n" title="' + esc(t('svc_att_h', num(n))) + '">' + num(n) + '</span>' : '') + '</button>';
    }
    function svcBox() {
      if (M.mode === 'all') return '';
      var s = M.sel[M.mode], ex = M.mode === 'exc';
      var h = '<div class="ag-svc-h">' + esc(t(ex ? 'svc_h_in' : 'svc_h_block')) + '</div><div class="ag-svcs">' + SVC_IN.map(function (k) { return chip(k, s[k]); }).join('') + '</div>';
      if (ex) h += '<div class="ag-svc-h">' + esc(t('svc_h_out')) + '</div><div class="ag-svcs">' + SVC_OUT.map(function (k) { return chip(k, s[k]); }).join('') + '</div>';
      return h + '<div class="ag-svc-x"><label for="ag-xports">' + esc(t(ex ? 'svc_x_exc' : 'svc_x_svc')) + '</label>' +
        '<input class="ag-input ag-mono" id="ag-xports" autocomplete="off" spellcheck="false" placeholder="' + esc(t('svc_x_ph')) + '" value="' + esc(M.extra[M.mode]) + '"></div>';
    }
    function summary() {           // işaretlerin anlamı kipten kipe değişir: sonucu düz cümleyle söyle
      var xv = portsOk(M.extra[M.mode]) || '', names = picked().map(function (k) { return k === 'dns' && M.mode === 'exc' ? t('sum_dns2') : t('svc_' + k); });
      if (xv) names.push(t('svc_ports', xv.split(',').join(', ')));
      var list = names.length ? names.join(', ') : t('sum_none');
      var cl = M.mode === 'all' ? t('sum_all_close') : M.mode === 'svc' ? t('sum_svc_close', list) : t('sum_exc_close');
      var op = M.mode === 'all' ? t('sum_all_open') : M.mode === 'svc' ? t('sum_svc_open') : list;
      return '<div class="ag-sum-r"><span class="ag-sum-k bad">' + esc(t('sum_close')) + '</span><span>' + esc(cl) + '</span></div>' +
        '<div class="ag-sum-r"><span class="ag-sum-k ok">' + esc(t('sum_open')) + '</span><span>' + esc(op) + '</span></div>';
    }
    function drawHints() {
      var sm = W.querySelector('#ag-sum'); if (sm) sm.innerHTML = summary();
      var hb = W.querySelector('#ag-hints'); if (!hb) return;
      var h = hints();
      hb.innerHTML = h.map(function (x) {
        return typeof x === 'string' ? '<div>' + esc(x) + '</div>'
          : '<div>' + esc(x.text) + ' <button type="button" class="ag-link" data-mode="' + x.mode + '">' + esc(x.label) + '</button></div>';
      }).join('');
      hb.style.display = h.length ? '' : 'none';
    }
    function okState() {
      var ok = W.querySelector('[data-m="ok"]'); if (!ok) return;
      var blocked = !D || !!D.self || (!!D.cover && !D.own_full);
      var inp = W.querySelector('#ag-typed2'), typedOk = !inp || inp.value.trim() === cidr;
      var xp = W.querySelector('#ag-xports'), xv = xp ? portsOk(xp.value) : '';
      if (xp) xp.parentNode.classList.toggle('bad', xv === null);
      var modeOk = M.mode === 'all' || (xv !== null && (picked().length > 0 || !!xv));
      ok.disabled = blocked || !typedOk || !modeOk;
      ok.textContent = changing() ? t('chg_btn') : D && D.wl ? t('ban_anyway') : t('ban_btn');
    }
    function refresh() {           // seçim değişince: başlık, açıklama, servisler, ipuçları, temizlik, akıbetler, düğme
      if (!W || !D) return;
      var h3 = W.querySelector('.ag-modal-h h3'), lead = W.querySelector('#ag-lead');
      if (h3) h3.innerHTML = changing() ? t('m_chg_t', cIn()) : M.mode === 'svc' ? t('m_svc_t', cIn()) : (o.title || t(bits === 16 ? 'm_ban16_t' : 'm_ban24_t', cIn()));
      if (lead) lead.innerHTML = M.mode === 'svc' ? t(bits === 16 ? 'm_svc_b16' : 'm_svc_b24') : (o.body || t(bits === 16 ? 'm_ban16_b' : 'm_ban24_b'));
      W.querySelectorAll('[data-mode]').forEach(function (b) { var on = b.getAttribute('data-mode') === M.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      var md = W.querySelector('#ag-md'); if (md) md.textContent = t('md_' + M.mode);
      var sb = W.querySelector('#ag-svcbox'); if (sb) sb.innerHTML = svcBox();
      drawHints();
      var tbl = W.querySelector('.ag-in'), cb = W.querySelector('#ag-clean'), cl = W.querySelector('.ag-clean');
      if (tbl) { tbl.classList.toggle('part', M.mode === 'svc'); tbl.classList.toggle('keep', M.mode !== 'svc' && !M.clean); }
      if (cb && cl) {
        cb.disabled = M.mode === 'svc'; cb.checked = M.mode !== 'svc' && M.clean;
        cl.classList.toggle('dis', M.mode === 'svc');
        cl.querySelector('b').textContent = M.mode === 'svc' ? t('in_clean_na') : cl.getAttribute('data-b');
        cl.querySelector('span').textContent = M.mode === 'svc' ? t('in_clean_na_d') : t('in_clean_d');
      }
      okState();
    }
    return modal({
      icon: 'ban', tone: 'bad', okText: t('ban_btn'), okClass: 'ag-btn-danger-solid',
      title: o.title || t(bits === 16 ? 'm_ban16_t' : 'm_ban24_t', cIn()),
      html: '<p id="ag-lead">' + (o.body || t(bits === 16 ? 'm_ban16_b' : 'm_ban24_b')) + '</p><div id="ag-in"><div class="ag-in"><div class="ag-in-h">' + esc(t('in_loading')) + '</div>' +
        '<div class="ag-in-r"><div class="ag-skel" style="width:70%"></div></div></div></div>',
      onOpen: function (w) {
        W = w;
        var ok = w.querySelector('[data-m="ok"]'); if (ok) ok.disabled = true;
        api('inside', { bits: bits, target: target }).then(function (r) {
          var box = w.querySelector('#ag-in'); if (!box || !ok) return;
          if (!r || !r.ok) { box.innerHTML = '<div class="ag-warnbox">' + esc(t('t_err', (r && (r.message || r.error)) || '?')) + '</div>'; return; }
          D = r;
          SVC_IN.forEach(function (k) { if (att(k) > 0) M.sel.svc[k] = 1; });   // öneri: bu aralıktan saldırı görülen servisler
          if (r.own_full) {                                      // kendi tam banımız: şu anki açık servislerle başla
            M.mode = r.open || r.open_extra ? 'exc' : 'all';
            if (r.open || r.open_extra) { M.sel.exc = {}; String(r.open || '').split(',').filter(Boolean).forEach(function (k) { M.sel.exc[k] = 1; }); }
            M.extra.exc = String(r.open_extra || '');
          } else if ((r.own_partial || []).indexOf(cidr) >= 0) { // kendi kısmi banımız: seçili servislerle başla
            M.mode = 'svc'; M.sel.svc = {};
            String(r.partial_svc || '').split(',').filter(Boolean).forEach(function (k) { M.sel.svc[k] = 1; });
            M.extra.svc = String(r.partial_extra || '');
          }
          box.innerHTML = insideHtml(r, bits, cidr);
          if ((r.cover && !r.own_full) || r.self) return;        // başkasının banı ya da sunucunun kendi IP'si: yapılacak bir şey yok
          box.addEventListener('click', function (ev) {
            var mb = ev.target.closest('[data-mode]');
            if (mb) { M.mode = mb.getAttribute('data-mode'); refresh(); return; }
            var sv = ev.target.closest('[data-svc]');
            if (sv) {
              var k = sv.getAttribute('data-svc'), st = M.sel[M.mode]; st[k] = !st[k];
              sv.classList.toggle('on', !!st[k]); sv.setAttribute('aria-pressed', String(!!st[k])); drawHints(); okState();
            }
          });
          box.addEventListener('input', function (ev) {
            if (ev.target.id === 'ag-xports') { M.extra[M.mode] = ev.target.value; okState(); drawHints(); }
            if (ev.target.id === 'ag-typed2') okState();
          });
          box.addEventListener('change', function (ev) { if (ev.target.id === 'ag-clean' && M.mode !== 'svc') { M.clean = ev.target.checked; refresh(); } });
          refresh();
          var inp = box.querySelector('#ag-typed2'); (inp || ok).focus();
        });
      }
    }).then(function (m) {
      if (!m.ok || !D || (D.cover && !D.own_full) || D.self) return null;
      var extra = {};
      if (D.wl) extra.force = '1';                               // çakışma pencerede gösterildi ve yazılarak onaylandı
      if (M.mode !== 'svc' && !M.clean) extra.keep = '1';
      if (changing()) extra.replace = '1';
      if (M.mode !== 'all') { extra.mode = M.mode; extra.svc = picked().join(','); var xv = portsOk(M.extra[M.mode]); if (xv) extra.ports = xv; }
      return doAction('ban' + bits, target, extra).then(function (r) {
        if (r && r.code === 4) return forceBan(bits, target, cidr, r.message);   // beyaz liste pencere açıkken değişti
        return r;
      });
    });
  }
  function insideHtml(d, bits, cidr) {
    if (d.cover && !d.own_full) return '<div class="ag-warnbox">' + esc(t('in_cover', d.cover)) + '</div>';
    if (d.self) return '<div class="ag-warnbox">' + esc(t('in_self', d.self)) + '</div>';
    function lst(a) { return a.length ? '<span class="ag-mono">' + esc(a.slice(0, 3).join(', ')) + '</span>' + (a.length > 3 ? ' +' + num(a.length - 3) : '') : ''; }
    function row(l, n, v) { return n ? '<div class="ag-in-r"><div class="ag-in-l">' + esc(l) + '</div><div class="ag-in-n">' + num(n) + '</div><div class="ag-in-v">' + v + '</div></div>' : ''; }
    function sep(a) { return a ? a + ' · ' : ''; }
    // akıbet: "Kapsananları kaldır" ve "Ne kapatılsın"a göre sınıflar değişir (keep, part), metin yeniden yazılmaz
    var fate = '<span class="ag-fate"><span class="ag-fate-rm">' + esc(t('in_rm')) + '</span><span class="ag-fate-keep">' + esc(t('in_keep')) + '</span></span>';
    var op = d.own_partial || [];
    var rows = row(t('in_blocks'), d.blocks.length, sep(lst(d.blocks)) + fate) +
      row(t('in_others'), d.others.length, sep(lst(d.others)) + fate) +
      row(t('in_singles'), d.singles + d.singles_dnd, sep(d.singles_dnd ? esc(t('in_sgl_dnd', num(d.singles_dnd))) : '') + fate) +
      row(t('in_temps'), d.temps, fate) +
      row(t('in_watched'), d.watched.length, sep(lst(d.watched)) + '<span class="ag-fate"><span class="ag-fate-wend">' + esc(t('in_watch_end')) + '</span><span class="ag-fate-wkeep">' + esc(t('in_watch_keep')) + '</span></span>') +
      row(t('in_part'), op.length, sep(lst(op)) + '<span class="ag-fate"><span class="ag-fate-pfull">' + esc(t('in_rm')) + '</span><span class="ag-fate-prt">' +
        esc(op.indexOf(cidr) >= 0 ? t('in_part_repl') : t('in_keep')) + '</span></span>') +
      row(t('in_ports'), (d.ports || []).length, sep(lst(d.ports || [])) + '<span class="ag-fate">' + esc(t('in_oth_keep')) + '</span>');
    var h = '<div class="ag-in' + (d.own_full ? ' chg' : '') + '"><div class="ag-in-h">' + esc(t('in_h')) + '</div>' + (rows || '<div class="ag-in-r"><div class="ag-in-v">' + esc(t('in_none')) + '</div></div>') +
      (d.owner ? '<div class="ag-in-r"><div class="ag-in-l">' + esc(t('in_owner')) + '</div><div class="ag-in-v ag-in-o">' + esc(d.owner) + '</div></div>' : '') + '</div>';
    if (d.wl) h += '<div class="ag-warnbox">' + esc(t('in_wl')) + ' <b>' + esc(d.wl) + '</b><br>' + esc(t('m_force_n')) + '</div>';
    h += '<div class="ag-mode"><div class="ag-mode-h">' + esc(t('mode_h')) + '</div><div class="ag-chips">' + ['all', 'svc', 'exc'].map(function (m) {
      return '<button type="button" class="ag-chip" data-mode="' + m + '">' + esc(t('mode_' + m)) + '</button>';
    }).join('') + '</div><div class="ag-mode-d" id="ag-md"></div><div id="ag-svcbox"></div><div class="ag-sum" id="ag-sum"></div>' +
      '<div class="ag-mode-hint" id="ag-hints" style="display:none"></div></div>';
    if (!d.own_full && (d.removable || d.free) + d.temps > 0) {
      var cbt = t('in_clean0') + (d.free && d.temps ? ' · ' + t('in_free_pt', num(d.free), num(d.temps)) : d.free ? ' · ' + t('in_free_p', num(d.free)) : d.temps ? ' · ' + t('in_free_t', num(d.temps)) : '');
      h += '<label class="ag-clean" data-b="' + esc(cbt) + '"><input type="checkbox" id="ag-clean" checked><div><b>' + esc(cbt) + '</b><span>' + esc(t('in_clean_d')) + '</span></div></label>';
    }
    if (bits === 16 || d.wl) h += '<label>' + t('type_to_confirm', '<span class="ag-target">' + esc(cidr) + '</span>') + '</label>' +
      '<input class="ag-input ag-mono" id="ag-typed2" autocomplete="off" spellcheck="false">';
    return h;
  }
  function underPill(u, hp) {   // daha geniş bir banın içinde kalan blok
    return '<span class="ag-pill ag-pill-n ag-under" title="' + esc(t(hp ? 'under_hp' : 'under_h', u)) + '">' + esc(t('under', '/' + bitsOf(u))) + '</span>';
  }

  var ACTIONS = {
    tab: function (el) {
      var k = el.getAttribute('data-tab');
      if (k === UI.tab) return;
      if (UI.tab === 'settings' && CFG && changedKeys().length && !window.confirm(t('dirty_leave', changedKeys().length))) return;
      UI.tab = k; history.replaceState(null, '', k === 'overview' ? '#' : '#' + k);
      if (k === 'settings') { CFG = null; DRAFT = {}; }
      render(); window.scrollTo(0, 0);
    },
    ppage: function (el) { UI.pp = Math.max(0, UI.pp + (+el.getAttribute('data-d'))); render(); },
    at: function (el) { UI.at = el.getAttribute('data-t'); render(); },
    st: function (el) { UI.st = el.getAttribute('data-s'); render(); window.scrollTo(0, 0); },
    expireall: function (el) {
      var n = +el.getAttribute('data-n'), d = String((S.expire && S.expire.days) || 365);
      modal({ icon: 'alert', tone: 'bad', title: t('m_exp_t', num(n)), html: '<p>' + esc(t('m_exp_b', num(n), d)) + '</p>',
        typed: String(n), okText: t('old_rm', num(n)), okClass: 'ag-btn-danger-solid' })
        .then(function (m) { if (m.ok) doAction('expire', d); });
    },
    updcheck: function () { checkUpdate(true); },
    asnall: function () { UI.asnAll = !UI.asnAll; render(); },
    ef: function (el) { UI.ef = el.getAttribute('data-f'); UI.evLimit = 40; render(); },
    cf: function (el) { UI.cf = el.getAttribute('data-f'); UI.evLimit = 40; render(); },
    cd: function (el) { UI.cd = +el.getAttribute('data-d'); render(); },
    menu: function (el) { var k = el.getAttribute('data-key'); UI.menu = UI.menu === k ? null : k; render(); },
    gsort: function (el) { var k = el.getAttribute('data-k'); if (UI.gs === k) UI.gd = -UI.gd; else { UI.gs = k; UI.gd = k === 'added' || k === 'n' ? -1 : 1; } UI.gp = 0; render(); },
    gpage: function (el) { UI.gp = Math.max(0, UI.gp + (+el.getAttribute('data-d'))); render(); },
    shownew: function () { UI.ef = 'new'; UI.evLimit = 200; UI.tab = 'history'; history.replaceState(null, '', '#history'); render(); window.scrollTo(0, 0); },
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
    mailmode: function (el) {
      var cur = String(cv('ALERT_MAIL'));
      if (el.getAttribute('data-v') === 'whm') { if (cur !== 'whm') UI.mailCustom = cur; DRAFT.ALERT_MAIL = 'whm'; render(); return; }
      if (cur !== 'whm') return;
      DRAFT.ALERT_MAIL = UI.mailCustom || (CFG.values.ALERT_MAIL !== 'whm' ? CFG.values.ALERT_MAIL : '');
      render(); var i = document.getElementById('ag-f-mail'); if (i) i.focus();
    },
    ictest: function (el) {
      el.disabled = true;
      api('config_test_slack').then(function (r) {
        el.disabled = false;
        toast(r.ok ? r.message : t('t_err', r.message || r.error || '?'), r.ok ? 'ok' : 'bad');
      });
    },
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
        var sv = function (v) { return k === 'ALERT_MAIL' && v === 'whm' ? t('mail_whm') : k === 'NOTIFY' ? t('nt_' + v) : /^IC_/.test(k) ? (v === '1' ? t('on') : t('off')) : v; };
        return '<li><b>' + esc(label) + '</b><span class="ag-mono">' + esc(sv(CFG.values[k]) || '—') + '</span> → <span class="ag-mono">' + esc(sv(cv(k)) || t('auto')) + '</span></li>';
      }).join('') + '</ul>';
      modal({ icon: 'sliders', tone: 'acc', title: t('m_save_t'), html: '<p>' + t('m_save_b') + '</p>' + list, okText: t('save') }).then(function (m) {
        if (!m.ok) return;
        var p = {};
        ch.forEach(function (k) { p['v[' + k + ']'] = String(cv(k)); });
        api('config_set', p).then(function (r) {
          if (!r.ok) { toast(t('t_err', r.message || r.error || '?'), 'bad'); return; }
          toast(r.message, 'ok');
          CFG = null; DRAFT = {};
          refresh();           // dil değiştiyse panel de yeni dile geçer
        });
      });
    },
    toggle: function (el) { var k = el.getAttribute('data-key'); UI.open[k] = !UI.open[k]; render(); },
    gf: function (el) { UI.gf = el.getAttribute('data-f'); UI.gp = 0; render(); },
    evmore: function () {
      UI.evLimit += 60; render();
      if (EV_SHORT && EVL && EVMORE) { var p = evOlder(); render(); p.then(function () { render(); }); }
    },
    commits: function () { UI.commits = !UI.commits; render(); },
    ban16: function (el) { rangeBan(16, el.getAttribute('data-t')); },
    ban24: function (el) { rangeBan(24, el.getAttribute('data-t')); },
    chg: function (el) { var c = el.getAttribute('data-c'), b = bitsOf(c); rangeBan(b, b === 16 ? p16(c) : pfxOf(c.split('/')[0])); },
    banforce: function (el) { rangeBan(24, el.getAttribute('data-t')); },
    promote: function (el) {
      var tg = el.getAttribute('data-t');
      rangeBan(24, tg, { title: t('m_promote_t', '<span class="ag-mono">' + esc(tg) + '.0/24</span>'), body: t('m_promote_b') });
    },
    forget: function (el) {
      var tg = el.getAttribute('data-t');
      modal({ icon: 'hour', tone: 'warn', title: t('m_forget_t', '<span class="ag-mono">' + esc(tg) + '.0/24</span>'), html: '<p>' + t('m_forget_b') + '</p>', okText: t('forget') })
        .then(function (m) { if (m.ok) doAction('forget', tg); });
    },
    unban: function (el) {
      var c = el.getAttribute('data-c'), dnd = el.getAttribute('data-dnd') === '1', kind = el.getAttribute('data-kind'), rn = +el.getAttribute('data-restore') || 0;
      // neyi kaldırdığını bilerek karar verilsin: ne zaman ve neden konmuştu; kısmi bandan sonra başka servislere saldırı geldiyse
      var g = (S.groups || []).filter(function (x) { return x.cidr === c; })[0] || {}, ev = (OWNERS[c] || {}).ev;
      var why = ev && ev.ips && ev.ips.length ? ipSummary(ev.ips, ev.total) : '';
      var info = g.added ? '<p class="ag-muted">' + (why ? t('ub_info', relT(g.added), esc(why)) : t('ub_info0', relT(g.added))) + '</p>' : '';   // relT HTML döner
      var since = g.since && Object.keys(g.since).length ? '<div class="ag-warnbox">' + esc(t('ub_since', countList(g.since))) +
        ' <button type="button" class="ag-link" data-ub="chg">' + esc(t('chg')) + '</button></div>' : '';
      modal({
        icon: 'alert', tone: 'bad', title: t('m_unban_t', '<span class="ag-mono">' + esc(c) + '</span>'),
        onOpen: function (w, done) {
          var b = w.querySelector('[data-ub="chg"]');
          if (b) b.addEventListener('click', function () { done(false); ACTIONS.chg({ getAttribute: function () { return c; } }); });
        },
        html: '<p>' + t(kind === 'partial' ? 'm_unban_part' : rn || kind === 'manual' ? 'm_unban_rb' : 'm_unban_b') + '</p>' + info + since + (dnd ? '<div class="ag-warnbox">' + t('m_unban_dnd') + '</div>' : '') +
          (rn ? '<label class="ag-clean"><input type="checkbox" id="ag-restore"><div><b>' + esc(t('m_restore', num(rn))) + '</b><span>' + esc(t('m_restore_d')) + '</span></div></label>' : ''),
        typed: dnd || kind === 'manual' || kind === 'partial' ? c : null, okText: t('unban'), okClass: 'ag-btn-danger-solid'
      }).then(function (m) {
        if (!m.ok) return;
        var rb = m.el.querySelector('#ag-restore');
        doAction('unban', c, rb && rb.checked ? { restore: '1' } : {});
      });
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
          if (!r.ok) { toast(r.error === 'busy' ? t('upd_busy') : t('t_err', r.message || r.error || '?'), 'bad'); return; }
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
    recentAdd(ip);
    var scrim = document.createElement('div'); scrim.className = 'ag-scrim';
    var dr = document.createElement('aside'); dr.className = 'ag-drawer ag-app'; dr.style.cssText = 'margin:0;padding:0;min-height:0;background:#fff';
    var dOpener = focusSel(document.activeElement);
    dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true'); dr.setAttribute('aria-label', ip);
    dr.innerHTML = '<div class="ag-drawer-h"><div><h3>' + esc(ip) + '</h3><div class="ag-sub" id="ag-dr-sub">&nbsp;</div></div>' +
      '<button class="ag-x" data-dr="x" aria-label="' + esc(t('close')) + '">' + IC.x + '</button></div>' +
      '<div class="ag-drawer-b" id="ag-dr-b">' + [1, 2, 3, 4, 5].map(function () {
        return '<div class="ag-fact"><div class="ag-skel" style="width:30%"></div><div class="ag-skel" style="width:75%;margin-top:8px"></div></div>';
      }).join('') + '</div>' +
      '<div class="ag-drawer-f"><a class="ag-btn ag-btn-sm" target="_blank" rel="noopener noreferrer" href="https://www.abuseipdb.com/check/' + encodeURIComponent(ip) + '">' + IC.ext + t('l_abuse') + '</a>' +
      '<span id="ag-dr-bgp"></span><button class="ag-btn ag-btn-sm ag-btn-ghost" data-dr="copy">' + IC.copy + t('l_copy') + '</button></div>';
    document.body.appendChild(scrim); document.body.appendChild(dr);
    trap(dr); setTimeout(function () { var x = dr.querySelector('[data-dr="x"]'); if (x) x.focus(); }, 30);
    function close() {
      scrim.remove(); dr.remove(); var i = layerStack.indexOf(close); if (i >= 0) layerStack.splice(i, 1);
      if (!layerStack.length) refocus(dOpener);
    }
    layerStack.push(close);
    scrim.addEventListener('click', close);
    dr.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dr]');
      if (b && b.getAttribute('data-dr') === 'x') close();
      if (b && b.getAttribute('data-dr') === 'copy' && navigator.clipboard) navigator.clipboard.writeText(ip).then(function () { toast(t('t_copied'), 'ok'); });
      // banlandıysa kart yeniden açılır: yeni kapsama satırı görünsün
      if (b && /^ban(16|24)$/.test(b.getAttribute('data-dr'))) {
        var bb = b.getAttribute('data-dr') === 'ban16' ? 16 : 24;
        rangeBan(bb, bb === 16 ? p16(ip) : pfxOf(ip)).then(function (r) { if (r && r.ok) { close(); openDrawer(ip); } });
      }
    });
    api('lookup', { ip: ip }).then(function (d) {
      var body = dr.querySelector('#ag-dr-b'); if (!body) return;
      if (!d.ok) { body.innerHTML = empty('alert', d.error === 'bad_ip' ? t('bad_ip') : (d.error || d.message || '?')); return; }
      var host = d.host ? '<span class="ag-mono">' + esc(d.host) + '</span> <span class="ag-pill ' + (d.fwd ? 'ag-pill-ok' : 'ag-pill-n') + '">' + (d.fwd ? t('l_fwd') : t('l_nofwd')) + '</span>'
        : '<span class="ag-muted">' + t('l_noptr') + '</span>';
      var owner = d.asn ? '<b>AS' + esc(d.asn) + '</b> ' + esc(d.asname || '') : '';
      var fw = [];
      if (d.deny) fw.push('<span class="ag-pill ag-pill-bad">' + t('l_perm_single') + '</span><div class="ag-mono ag-muted" style="margin-top:4px">' + esc(d.deny) + '</div>');
      var mb = 99;                                     // IP'yi kapsayan en geniş kalıcı aralık (ban düğmeleri buna göre)
      (d.covers || []).forEach(function (c) {
        if (c.kind === 'cidr') {
          var cb = bitsOf(c.cidr); mb = Math.min(mb, cb);
          var cg = (S.groups || []).filter(function (x) { return x.cidr === c.cidr; })[0];
          var ce = (OWNERS[c.cidr] || {}).ev, cx = '';
          if (cg) cx += '<div class="ag-muted" style="margin-top:2px">' + esc(t('cov_info', t('kind_' + cg.kind) + (cg.dnd ? ' · do not delete' : ''), cg.added ? new Date(cg.added * 1000).toLocaleDateString(loc()) : '—')) + '</div>';
          if (ce && ce.ips && ce.ips.length) {
            cx += '<div class="ag-muted" style="margin-top:2px">' + esc(t('cov_why', ipSummary(ce.ips, ce.total))) + '</div>';
            var mine = ce.ips.filter(function (x) { return x.ip === ip; })[0];
            if (mine && mine.why) cx += '<div style="margin-top:2px">' + esc(t('own_why', whyText(mine.why))) + '</div>';
          }
          fw.push('<span class="ag-pill ag-pill-bad">' + esc(cb === 24 ? t('l_perm_cover') : cb === 16 ? t('l_perm_net') : t('l_perm_rng', cb)) + '</span>' +
            '<div class="ag-mono ag-muted" style="margin-top:4px">' + esc(c.line) + '</div>' + cx +
            (c.open || c.open_extra ? '<div class="ag-muted" style="margin-top:2px">' + esc(t('l_open', svcNames(c.open, c.open_extra))) + '</div>' : ''));
        } else if (c.kind === 'port' && c.own) {                 // eklentinin kısmi banı
          var pb = bitsOf(c.cidr), px = (/;ports=([0-9,-]+)/.exec(c.line || '') || [])[1];
          fw.push('<span class="ag-pill ag-pill-warn">' + esc(pb === 16 ? t('l_part_net') : pb === 24 ? t('l_part_blk') : t('l_part_rng', pb)) + '</span>' +
            '<div class="ag-mono ag-muted" style="margin-top:4px">' + esc(c.line) + '</div><div class="ag-muted" style="margin-top:2px">' + esc(t('l_part_d', svcNames(c.svc, px) || c.ports)) + '</div>');
        } else if (c.kind === 'port') {
          fw.push('<span class="ag-pill ag-pill-warn">' + esc(t('l_port', c.proto, c.ports || '*', c.dir === 'in' || c.dir === 'out' ? t('dir_' + c.dir) : c.dir)) + '</span><div class="ag-mono ag-muted" style="margin-top:4px">' + esc(c.line) + '</div>');
        } else if (c.kind === 'cc' || c.kind === 'asn') {
          fw.push('<span class="ag-pill ag-pill-bad">' + esc(t(c.kind === 'cc' ? 'l_ccd_cc' : 'l_ccd_asn', c.what)) + '</span><div class="ag-muted" style="margin-top:4px">' + esc(t('l_ccd_src')) + '</div>');
        } else if (c.kind === 'ccport') {
          fw.push('<span class="ag-pill ag-pill-warn">' + esc(t('l_ccp', c.what, [c.tcp ? 'tcp ' + c.tcp : '', c.udp ? 'udp ' + c.udp : ''].filter(Boolean).join(' · ') || '—')) + '</span>' +
            '<div class="ag-muted" style="margin-top:4px">' + esc(t('l_ccd_src')) + '</div>');
        }
      });
      if (d.temp) fw.push('<span class="ag-pill ag-pill-warn">' + t('l_temp') + '</span><div class="ag-mono ag-muted" style="margin-top:4px">' + esc(d.temp) + '</div>');
      var wl = [d.wl, d.rig ? 'csf.rignore: ' + d.rig : ''].filter(Boolean).map(esc).join('<br>');
      body.innerHTML = (d.lookup ? '' : '<div class="ag-fact ag-muted">' + t('l_nolookup') + '</div>') +
        fact(t('l_host'), host) + fact(t('l_owner'), owner) +
        fact(t('l_prefix'), d.pfx ? '<span class="ag-mono">' + esc(d.pfx) + '</span>' + (d.cc ? ' <span class="ag-flag">' + esc(d.cc) + '</span>' : '') : '') +
        fact(t('l_reg'), d.reg ? esc(d.reg) + (d.alloc ? ' · ' + esc(d.alloc) : '') : '') +
        fact(t('l_fw'), (fw.length ? fw.join('<div style="height:8px"></div>') : '<span class="ag-pill ag-pill-n">' + t('l_notbanned') + '</span>') +
          (mb > 16 ? '<div class="ag-dr-acts">' + (mb > 24 ? '<button class="ag-btn ag-btn-sm ag-btn-danger" data-dr="ban24">' + esc(t('ban24')) + '</button>' : '') +
            '<button class="ag-btn ag-btn-sm ag-btn-danger" data-dr="ban16">' + esc(t('ban16')) + '</button></div>' : '')) +
        (function () {                             // bloğun eşiğe uzaklığı: beklemek mi, şimdi banlamak mı
          var b = d.blk, L = [];
          if (!b || mb <= 24) return '';
          if (b.s > 0) L.push(b.s < b.ts ? t('blk_left', num(b.s), num(b.ts), num(b.ts - b.s)) : t('blk_over', num(b.s), num(b.ts)));
          if (b.t > 0) L.push(b.t < b.tt ? t('blk_tleft', num(b.t), num(b.tt), num(b.tt - b.t)) : t('blk_tover', num(b.t), num(b.tt)));
          return L.length ? fact(t('l_blk'), L.map(esc).join('<br>')) : '';
        })() +
        fact(t('l_wl'), wl || '<span class="ag-muted">' + t('l_none') + '</span>') +
        fact(t('l_pending'), d.pend ? esc(pfxOf(ip) + '.0/24 · ' + d.pend) + (function () {   // neden izlendiği (varsa)
          var pc = pfxOf(ip) + '.0/24', pe = (OWNERS[pc] || {}).ev;
          return '<br><span class="ag-muted">' + esc(pe && pe.ips && pe.ips.length ? t('p_why', ipSummary(pe.ips, pe.total)) : t('p_why_none')) + '</span>';
        })() : '') + fact(t('l_ign'), d.ign ? esc(d.ign) : '');
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
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && UI.menu && !layerStack.length) {
      var mk = UI.menu; UI.menu = null; render();
      refocus('[data-act="menu"][data-key="' + CSS.escape(mk) + '"]');
      return;
    }
    var tg = ev.target;
    if ((ev.key === 'ArrowDown' || ev.key === 'ArrowUp') && tg.closest && tg.closest('.ag-menu')) {
      var items = Array.prototype.slice.call(tg.closest('.ag-menu').querySelectorAll('.ag-menu-i')), ix = items.indexOf(tg);
      if (items.length) { ev.preventDefault(); items[(ix + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
      return;
    }
    if ((ev.key === 'Enter' || ev.key === ' ') && tg.matches && tg.matches('[data-ip]:not(button):not(a), .ag-ev.clickable') && $app.contains(tg)) {
      ev.preventDefault(); tg.click();
    }
  });
  $app.addEventListener('submit', function (ev) {
    if (ev.target.id === 'ag-lk') { ev.preventDefault(); openDrawer((document.getElementById('ag-lk-ip').value || '').trim()); }
  });
  $app.addEventListener('input', function (ev) {
    var ck = ev.target.getAttribute && ev.target.getAttribute('data-cfg');
    if (ck && CFG) { DRAFT[ck] = ev.target.value.trim(); refreshSaveBar(); return; }
    if (ev.target.id === 'ag-lk-ip') { UI.lk = ev.target.value; return; }
    if (ev.target.id === 'ag-gq') {
      UI.gq = ev.target.value; UI.gp = 0;
      var b = document.getElementById('ag-groups-b'); if (b) b.innerHTML = groupRows();
      var gc = document.getElementById('ag-gcount'); if (gc) gc.textContent = groupCount();
    }
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
    else if (inGroups) {
      UI.open['g:' + f] = true; UI.gf = 'all'; UI.gq = '';
      var gix = groupSorted().findIndex(function (g) { return g.cidr === f; });
      if (gix >= 0) UI.gp = Math.floor(gix / PAGE);
    }
    else { var pi = pendingSorted().findIndex(function (p) { return p.prefix + '.0/24' === f; }); if (pi >= 0) UI.pp = Math.floor(pi / PPAGE); }
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

  /* Güncelleme denetimi: fresh = GitHub'a hemen sor (Ayarlar'daki düğme); değilse sunucudaki 5 dk önbellek */
  var UPD_TRY = 0;
  function freshCheckIfStale() {   // Güncelle düğmesinin göründüğü yerde (Ayarlar → Sunucu) eski sonuç gösterilmesin
    var n = Date.now() / 1000;
    if (UPD_BUSY || n - UPD_TRY < 120 || (UPD_T && n - UPD_T < 120)) return;
    UPD_TRY = n; setTimeout(function () { checkUpdate(true); }, 0);
  }
  function checkUpdate(fresh) {
    if (UPD_BUSY) return;
    UPD_BUSY = true; if (fresh) render();
    api('update_check', fresh ? { fresh: '1' } : {}).then(function (u) {
      UPD_BUSY = false;
      if (u && (u.ok || u.error !== 'session')) { UPD = u; UPD_T = u.checked || Date.now() / 1000; }
      if (!busy && !(UI.tab === 'settings' && CFG && changedKeys().length)) render();
      else {
        // yeniden çizilemiyorsa (tur sürüyor / kaydedilmemiş ayar) şerit ve kart yerinde güncellenir
        var bn = document.getElementById('ag-bnr'); if (bn) bn.innerHTML = banner();
        var c = document.getElementById('ag-updcard'); if (c) c.outerHTML = updCard();
      }
    });
  }

  /* ── Başlangıç ─────────────────────────────────────────────────── */
  refresh().then(function () {
    if (S) applyFocus();
    checkUpdate(false);
  });
  setInterval(function () { if (!document.hidden) checkUpdate(false); }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && UPD_T && Date.now() / 1000 - UPD_T > 30 * 60) checkUpdate(false);
  });
})();
