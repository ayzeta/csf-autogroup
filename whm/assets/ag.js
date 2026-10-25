/* CSF Auto-Group — WHM eklentisi arayüzü.
 * Sayfanın tamamı api.php'nin döndürdüğü veriden kurulur; veri csf_autogroup.sh
 * --status --json çıktısıdır (terminaldeki --status ile aynı kaynak).
 * Durum değiştiren her işlem bir onay penceresinden geçer; riskli olanlarda
 * (ör. /16 banı, beyaz listeyi aşmak, "do not delete" kaldırmak) hedef elle yazılır. */

/* Sekme başlığı: WHM::header() verilen adı <title>'a koymuyor; şablon "WHM [sunucu]  - 138.0.13"
 * diye ortada boş bir yuva bırakıyor (CSF'nin kendi sayfası "WHM [lin] ConfigServer Security &
 * Firewall - 136.0.38"). Ad o yuvaya yazılır, sürüm eki yerinde kalır. Ürün adı çevrilmez. */
(function () {
  var ad = 'CSF Auto-Group', t = String(document.title || '');
  if (t.indexOf(ad) >= 0) return;   // yedek kabuk zaten yazdı
  var i = t.lastIndexOf(' - ');
  document.title = i > 0 && /^[0-9.]+$/.test(t.slice(i + 3).trim()) ? (t.slice(0, i).trim() + ' ' + ad + t.slice(i)).trim()
    : (t.trim() ? t.trim() + ' ' + ad : ad);
})();

(function () {
  'use strict';

  var BOOT = window.AG_BOOT || {};
  var $app = document.getElementById('ag-app');
  var S = null;                 // son durum verisi
  var UPD = null;               // güncelleme kontrolü sonucu
  var UPD_T = 0, UPD_BUSY = false; // son denetim zamanı (sn), denetim sürüyor mu
  var LANG = 'en';
  var CLOCK = 0;                // sunucu saati - istemci saati (sn)
  var UI = { gf: 'all', gq: '', ef: 'all', cf: 'all', open: {}, evLimit: 40, commits: false, st: 'general', gs: 'added', gd: -1, gp: 0, pp: 0, cd: 30, menu: null, at: 'atk',
             tab: location.hash === '#settings' ? 'settings' : location.hash === '#history' ? 'history' : location.hash === '#prov' ? 'prov' : 'overview', asnAll: false };
  var CFG = null, DRAFT = {}, cfgLoading = false;
  var STALE = false;            // işlem bitti, yeni durum gelene kadar ekran eski: eylemler bekletilir
  var WORK_MSG = '', WORK_SUB = '';   // STALE === 'work' iken ortadaki kutu: başlık, ne beklendiği
  var pollTimer = null, wasRunning = false, busy = false, CONN = null, LAST_OK = 0, HIDDEN_DUE = false;
  // BACK: sekmeye / sayfaya eski veriyle dönüldü (tarayıcı gizli sekmeyi uyutur; veri bir saatlik olabilir). Yeni durum gelene
  // kadar Son tur / Tur süresi / Sıradaki eski veriden hesaplanmaz, "güncelleniyor…" yazar: önce eski verinin yaşı
  // ("1 saat önce") gerçek gibi görünüyordu, yeni veri ancak ~15 sn sonra "14 dk önce" diyordu
  var BACK = false;

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
    book: svg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M8 7h7M8 11h7"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>')
  };

  /* ── Diller ────────────────────────────────────────────────────── */
  var DICT = {
    tr: {
     
      dry: 'Deneme turu', dry_h: 'Hiçbir şeyi değiştirmeden bir turun ne yapacağını gösterir.', sb_last_h: 'Tur: eklentinin banları tarayıp karar verdiği her çalışma (cron ile düzenli çalışır).', sb_fetched: 'Durum verisinin alındığı saat: {0}.', sb_updating: 'güncelleniyor…', run: 'Şimdi çalıştır', run_log: 'Tur çıktısı',
      upd_avail: '<b>Güncelleme var:</b> v{0} → v{1}', upd_commits: '{0} değişiklik', upd_show: 'Değişiklikleri gör', upd_hide: 'Gizle',
      upd_apply: 'Güncelle', upd_dirty: 'Sunucudaki kopyada yerel değişiklik var; güncelleme SSH üzerinden yapılmalı. Neyin değiştiğine kurulum klasöründe git status ile bakabilirsiniz.',
      upd_diverged: 'Sunucudaki kopya GitHub\'dakinden ayrılmış; güncelleme SSH üzerinden yapılmalı. Kurulum klasöründe git status ile bakabilirsiniz.',
      k_perm: 'Kalıcı liste', k_temp: 'Geçici liste', k_groups: 'Aktif aralık banı', k_review: 'Kontrol edilecek',
      k_lines: '{0} / {1} satır', k_nolimit: 'limit tanımsız', k_dnd: '{0} tanesi silinmez', k_review_m: 'son {0} gün',
      s_review: 'Kontrol edilecekler', s_review_h: 'Eklentinin kendiliğinden banlamayıp kararı size bıraktıkları: çok bloktan ihlal gelen ağlar (şüpheli ağ), beyaz listeyle çakıştığı için banlanmayan bloklar ve izin listesinde olduğu için banı işlemeyen IP\'ler. Neden sütunu kaç IP\'nin hangi servise ihlal ettiğini söyler; IP sayısına tıklayınca tek tek görünür. Banlayın ya da ⋯ menüsünden yoksayın.',
      s_groups: 'Aktif aralık banları', s_events: 'Son işlemler', s_lookup: 'IP sorgula', s_pending: 'İzlenenler',
      s_pending_h: 'Bir kez geçici blok banı almış bloklar. İzleme süresi içinde aynı bloktan yeniden {0} geçici ban gelirse blok kalıcı ve silinmez olarak banlanır.', s_ignored: 'Yoksayılanlar', s_config: 'Kurallar',
      lookup_ph: '185.220.101.12', lookup_btn: 'Sorgula', lookup_hint: 'Hostname, sahip (ASN), duyurulan aralık, kayıt ve CSF listelerindeki durumu.',
      f_all: 'Tümü', f_perm: 'Kalıcı', f_dnd: 'Silinmez', f_temp: 'Geçici', f_manual: 'Elle', g_search: 'CIDR, AS ya da kurum',
      e_all: 'Tümü', e_bans: 'Banlar', e_warn: 'Şüpheli ağlar', e_skip: 'Atlananlar', e_aviol: 'İzinli IP\'den ihlaller', e_po: 'Açık servis', e_manual: 'Elle işlemler', e_clean: 'Temizlik', cf_all: 'Tümü', cf_config: 'Ayar değişiklikleri', cf_test_mail: 'Test mailleri', cf_digest: 'Haftalık özetler',
      ev_add24: 'Blok banı', ev_promote: 'Tekrar geldi, kalıcı', ev_temp24: 'Geçici blok banı', ev_skip_wl: 'Atlandı', ev_allow_viol: 'İzinli IP\'den ihlal', av_d: '{0} · son 24 saatte {1} kez', ev_part_open: 'Açık servis', po_d: 'kapalı: {0} · açık servislere bandan sonra {1} ihlal', ev_warn16: 'Şüpheli ağ',
      ev_warn16t: 'Şüpheli ağ', ev_clean_temp: 'Geçici ban silindi', clean_d: 'zaten kalıcı listede (tekil ya da blok banı içinde)', ev_manual_ban: 'Elle ban', ev_manual_unban: 'Kaldırıldı',
      ev_manual_forget: 'İzlemeden çıkarıldı', ev_manual_ignore: 'Yoksayıldı', ev_manual_unignore: 'Yoksayma kalktı',
      kind_perm: 'kalıcı', kind_promoted: 'tekrar geldi, kalıcı', kind_temp: 'geçici', kind_manual: 'elle', kind_perm_h: 'Kalıcı blok banı: blokta yeterince kalıcı tekil ban (tek IP) birikince eklendi.', kind_promoted_h: 'Tekrar geldi, kalıcı: önce 12 saatlik geçici blok banı aldı, izleme süresi içinde tekrar ihlal edince kalıcı banlandı.', kind_temp_h: 'Geçici blok banı: süresi dolunca kalkar; izleme süresi içinde tekrar gelirse kalıcı olur.', kind_manual_h: 'Elle: panelden eklendi.', g_hit: 'son deneme: {0} (ban o denemeyi düşürdü)', kind_dnd_h: 'Silinmez (CSF\'in "do not delete" işareti): CSF bu banı liste dolsa da kendiliğinden silmez.', evh_add24: 'Blok banı: blokta (/24) yeterince kalıcı tekil ban birikince blok kalıcı banlandı, tekiller silindi.', evh_promote: 'Tekrar geldi, kalıcı: daha önce geçici blok banı almış blok, izleme süresi içinde tekrar ihlal ettiği için kalıcı banlandı.', evh_temp24: 'Geçici blok banı: blokta yeterince geçici tekil ban birikince 12 saatliğine banlandı ve izlemeye alındı.', evh_skip_wl: 'Atlandı: ban eşiğine ulaştı ama bir beyaz liste kaydıyla çakıştığı için banlanmadı.', evh_part_open: 'Açık servis: aralığın kısmi banı yalnız seçilen servisleri kapatıyor; bandan sonra açık kalan servislere blok ya da ağ eşiği kadar ihlal geldi. Kontrol edilecekler satırı aralık banlanınca kalkar, bu kayıt kalır (aralık başına günde bir).', evh_allow_viol: 'İzinli IP\'den ihlal: izin listesindeki, yoksayılan ya da sunucunun kendi adresinden lfd kuralına takılan deneme geldi; lfd banlamadı ya da ban işlemedi. Kontrol edilecekler satırı kontrol süresi bitince kalkar, bu kayıt kalır (IP başına günde bir).', evh_warn16: 'Şüpheli ağ: ağda (/16) birçok bloktan tekil ban (kalıcı ve geçici) birikti. Ağ banlanmaz; bakmanız önerilir.', evh_warn16t: 'Şüpheli ağ: ağda (/16) birçok bloktan geçici tekil ban birikti. Ağ banlanmaz; bakmanız önerilir.', evh_clean_temp: 'Geçici ban silindi: IP zaten kalıcı listede olduğu için geçici banı gereksizdi.', evh_expire: 'Eski blok kaldırıldı: eski blok banı sınırını geçtiği için kaldırıldı.', evh_manual: 'Elle işlem: panelden biri tarafından yapıldı.', rep_h: 'Bu ağ son günlerde {0} ayrı gün şüpheli olarak işaretlendi.', p_why: 'Geçici blok banı: {0}', p_why_none: 'sebebi kayıtlı değil (olay kaydı başlamadan izlemeye alınmış)', cov_info: '{0} · {1} eklendi', cov_why: 'Banın sebebi: {0}', own_why: 'Bu IP\'nin sebebi: {0}', asn_why: 'en sık: {0}',
      ips: 'IP\'ler', hide: 'Gizle', ban16: 'Ağı banla (/16)', ban24: 'Bloğu banla (/24)', mode_h: 'Ne kapatılsın', chg16: 'Banı değiştir (/16)', chg24: 'Banı değiştir (/24)', ban24_full: 'Bloğu tamamen banla (/24)', ban24_full_h: 'Ağda kısmi ban var ({0} kapalı); bu, blok için bütün servisleri kapatır.', ban24_perm: 'Bloğu kalıcı banla (/24)', st_ban: 'şu an banlı', st_part: 'şu an kısmi banlı', st_cov: '{0} banının içinde', st_review: 'Kontrol edilecekler\'de', st_watch: 'izleniyor', st_ign: 'yoksayıldı ({0} tarihine kadar)', st_unbanned: 'artık banlı değil', st_left: 'artık Kontrol edilecekler\'de değil', goto: 'Genel bakışta göster', r_mix: '{0} kalıcı · {1} geçici', imp_same: 'Şu anki kayıtlarda değişen bir şey olmazdı; etkisi bundan sonra gelen banlarda görülür.', imp_up: 'Yüksek eşik mevcut banları kaldırmaz; bundan sonra aynı sonuç için daha çok tekil ban gerekir.', h_part_sug: 'Bu aralıktan gelen ihlaller yalnız şu servislere: {0}. Aralığın geri kalanını kesmeden, yalnız bunları kapatan kısmi ban da yetebilir.', h_part_go: 'Seçilen servislere geç', svc_other: 'diğer', svc_repeat: 'tekrar banlanan', svc_scan: 'port taraması', ub_info: '{0} konmuş · {1}', ub_info0: '{0} konmuş', ub_since: 'Bu kısmi ban konduktan sonra aynı aralıktan diğer servislere yeni banlar geldi: {0}. Tam ban daha uygun olabilir.', l_blk: 'Bloğun durumu', blk_left: 'Bu blokta {0} tekil ban var; eşik {1}. {2} tane daha gelirse blok otomatik banlanır.', blk_over: 'Bu blokta {0} tekil ban var ve eşik ({1}) aşıldı: bir sonraki turda banlanması beklenir. Beyaz listedeyse banlanmaz, Kontrol edilecekler\'de "atlandı" diye görünür.', blk_tleft: 'Geçici listede bu bloktan {0} IP var; eşik {1}. {2} tane daha gelirse blok geçici banlanır.', blk_tover: 'Geçici listede bu bloktan {0} IP var ve eşik ({1}) aşıldı: bir sonraki turda geçici banlanması beklenir (beyaz listede değilse).', imp_b: 'Bu değerle, şu anki tekil banlardan yaklaşık {0} blok daha banlanırdı.', imp_n: 'Bu değerle, şu anki tekil banlardan (kalıcı ve geçici) yaklaşık {0} ağ daha şüpheli olarak bildirilirdi.', imp_tb: 'Bu değerle, şu anki geçici banlardan yaklaşık {0} blok daha geçici banlanırdı.', r_narrow: 'Tekillerin {1} / {2}\'si {0} bloğunda; bütün ağ yerine o bloğu banlamak yetebilir.', r_svc: 'ihlaller: {0}', svc_att_h: '{0} IP bu servise ihlal etmiş (ban sebeplerine göre)', h_no_att: 'Bu aralıkta kayıtlı bir ihlal sebebi yok; kapatılacak servisleri seçin.', h_att_pre: 'Bu aralıktan ihlal görülen servisler işaretlendi: {0}.', h_scan: 'Bu aralıktan port taraması da kayıtlı ({0} IP); "Her şey" daha uygun olabilir.', h_exc_att: 'Açık bıraktığınız servislerden bazılarına bu aralıktan ihlal kayıtlı: {0}.', h_exc_pick: 'Açık kalacak servisleri seçin; ihlal görülen servisler önceden işaretlenmez.', sum_close: 'Kapanır', sum_open: 'Açık kalır', sum_all_close: 'bu aralıktan gelen ve bu aralığa giden her şey', sum_all_open: 'hiçbir şey', sum_svc_close: 'bu aralıktan şunlara gelen bağlantılar: {0}', sum_svc_open: 'diğer her şey; sunucudan bu aralığa giden bağlantılar da', sum_exc_close: 'bu aralıktan gelen ve bu aralığa giden diğer her şey', sum_none: 'henüz seçim yok', sum_dns2: 'DNS (iki yönde)', mode_all: 'Her şey', mode_svc: 'Seçilen servisler', mode_exc: 'Her şey, şunlar hariç', md_all: 'Aralıktan gelen ve aralığa giden bütün bağlantılar kesilir.', md_svc: 'Yalnız seçtiğiniz servislere bu aralıktan gelen bağlantılar kapanır; diğer her şey açık kalır. Sunucudan bu aralığa giden bağlantılar (posta, DNS, web istekleri) etkilenmez.', md_exc: 'Aralık tamamen kesilir, seçtiğiniz servisler açık kalır. Her servis için CSF\'ye iki yönlü izin satırı eklenir; ban kaldırılınca bu satırlar da kaldırılır.', svc_h_block: 'Kapatılacak servisler', svc_h_in: 'Açık kalsın · bu aralıktan gelen', svc_h_out: 'Açık kalsın · sunucudan bu aralığa giden', svc_sync_s: 'posta eşitleme', svc_min_s: 'gelen posta', p_last: 'son ihlal {0}', svc_web: 'Web', svc_ssh: 'SSH', svc_ftp: 'FTP', svc_cp: 'cPanel · WHM · Webmail', svc_min: 'Gelen posta', svc_sync: 'Posta eşitleme', svc_dns: 'DNS', svc_mout: 'Giden posta', svc_wout: 'Giden web', svc_pasv: 'pasif {0}', svc_ports: 'port {0}', svc_x_svc: 'Başka portlar', svc_x_exc: 'Başka portlar (gelen)', svc_x_ph: 'ör. 8080, 30000-35000', h_dns_mail: 'Posta için DNS de gerekebilir: bu sunucu alan adlarının DNS\'ini de yapıyorsa, karşı posta sunucuları posta teslim etmeden önce MX kaydını, sizden gelen postayı alırken de SPF, DKIM ve DMARC kayıtlarını buradan sorgulayabilir. DNS kapalı kalırsa posta gecikebilir ya da hiç ulaşmayabilir.', h_dns_web: 'Web için DNS de gerekebilir: bu aralıktaki arama motoru botları ve ziyaretçiler, sitelere bağlanmadan önce alan adlarını bu sunucunun DNS\'inden çözüyor olabilir.', h_cp_exc: 'cpanel.alanadi.com gibi adresler web portundan (443) çalışır; onların da açık kalması için Web\'i de seçin.', h_cp_svc: 'cPanel, WHM ve Webmail\'e cpanel.alanadi.com gibi adreslerle web portundan (443) da girilebilir; tamamen kapatmak için Web\'i de seçin.', h_dns_blk: 'DNS\'i kapatmak, bu sunucu alan adlarının DNS\'ini de yapıyorsa bu aralıktan gelen posta ve ziyaretleri de etkileyebilir.', h_ftp_nopasv: 'FTP\'nin pasif port aralığı bulunamadı; dosya aktarımı da çalışsın diye o aralığı "Başka portlar"a ekleyin (ör. 30000-35000).', h_chg_restore: 'Kısmi bana çevrilince, bu ban konurken kaldırılan {0} kayıt geri yüklenir; kısmi ban aralığı tamamen kapsamaz.', m_svc_t: '{0} için seçilen servisler kapatılsın mı?', m_svc_b16: 'Ağdaki 65.536 adresten seçtiğiniz servislere gelen bağlantılar engellenir. Ban silinmez olarak eklenir (CSF\'in "do not delete" işareti): liste dolsa da kendiliğinden kalkmaz.', m_svc_b24: 'Bloktaki 256 adresten seçtiğiniz servislere gelen bağlantılar engellenir. Ban silinmez olarak eklenir (CSF\'in "do not delete" işareti): liste dolsa da kendiliğinden kalkmaz.', m_chg_t: 'Banı değiştir: {0}', chg_btn: 'Değiştir', chg: 'Banı değiştir', in_clean_na: 'Kapsananlar kaldırılmaz', in_clean_na_d: 'Kısmi ban aralığı tamamen kapsamadığı için içindeki banlar yerinde kalır; onlar diğer servisleri de kapatıyor.', in_part: 'Kısmi banlar', in_part_repl: 'yenisiyle değiştirilir', in_watch_keep: 'izlenmeye devam eder', kind_partial: 'kısmi', kind_partial_h: 'Kısmi ban: yalnız seçilen servislere bu aralıktan gelen bağlantılar kapalı; diğer her şey açık.', f_partial: 'Kısmi', g_closed: 'kapalı: {0}', g_open: 'açık: {0}', l_part_net: 'Kısmi (ağ)', l_part_blk: 'Kısmi (blok)', l_part_rng: 'Kısmi (/{0})', l_part_d: 'kapalı: {0} · bu aralıktan gelen; diğer bağlantılar açık', l_open: 'açık bırakılanlar: {0}', ev_svc: 'kısmi · kapalı: {0}', ev_exc: 'açık: {0}', ev_full: 'tam ban', ev_manual_change: 'Ban değiştirildi', terms: 'Terimler', terms_t: 'Terimler', s_groups_h: 'Şu an CSF\'te duran aralık banları (blok /24, ağ /16, duyurulan aralık ve kısmi banlar): eklentinin koyduğu ve sizin panelden koyduklarınız. Tekil banlar sayılmaz.', pv_intro: 'İhlallerin çoğu bulut firmalarının kiraladığı sunuculardan gelir. Önce Kiralık sunucuları kapatın; yetmezse bir sağlayıcının tamamını banlayın. İzinli servisler ikisinin de önüne geçer.', pv_cl_redund: 'CSF\'in bu sağlayıcı için yüklediği adreslerin %{0}\'i {1} listesinde: kiralık sunucular zaten kapalı, bu sağlayıcı banına gerek kalmamış olabilir.', pv_cl_part: 'Adreslerinin %{0}\'i {1} listesinde.', lim_shown: '{0} / {1} gösteriliyor', lim_more: 'Daha fazla', lim_all: 'Hepsini göster', lim_less: 'Daralt', at_im: 'Imunify360', at_atk_s: 'lfd ve eklentinin banları', at_blk_s: 'csf.deny\'ye elle ya da başka araçla eklenenler', at_im_s: 'Imunify360\'ın kendi engelledikleri', at_ban_s: 'sağlayıcı banında ya da kiralık sunucu listesinde', p_cl2: '{0}\'i {1} listesinde', asn_why0: 'sebep bilinmiyor: banları olay kaydından önce konmuş', at_ban: 'Banlı', ban_empty: 'Banlı sağlayıcı yok.', ban_h: 'Sağlayıcı banında ya da bütün banları bir kiralık sunucu listesinde kalan sağlayıcılar; diğer sekmelerin sıralamasına girmezler.', ev_grp_n: '{0} kayıt', pv_all_prov: 'Tamamı ve ayrıntı Sağlayıcılar\'da ({0})', pv_how: 'Nasıl çalışır?', pv_lay_asn: 'Sağlayıcı banı', pv_lay_cl: 'Kiralık sunucular', pv_lay_svc: 'İzinli servisler', pv_u_prov: 'sağlayıcı', pv_u_list: 'liste', pv_u_addr: 'adres', pv_u_rng: 'aralık', pv_lay_csf: 'CSF\'te {0} aralık', pv_lay_unl: '{0} sağlayıcının adresleri CSF\'e henüz yüklenmedi', pv_lay_rng: '{0} adres aralığı', pv_lay_fail: '{0} liste indirilemiyor', pv_lay_last: 'son indirme {0}', pv_lay_offm: 'kapalı', pv_sum_asn: 'Bir sağlayıcının bütün ağını (ASN) kapatır: kiraladığı sunucularla birlikte kendi servisleri de kapanır. Kiralık sunucular yetmezse kullanın.', pv_sum_cl: 'Bulut firmalarının (Google Cloud, AWS, Azure…) herkese kiraladığı sunucuları kapatır. İhlallerin çoğu buradan gelir; ziyaretçileriniz ve firmanın kendi servisleri (Googlebot, Gmail, Outlook) bu listelerde yok.', pv_sum_svc: 'Adreslerini yayımlayan servisleri her banın önüne geçirir: yukarıdaki iki katman da onları kesmez.', pv_sec_provs: 'Sağlayıcılar', pv_sec_provs_h: 'en çok 50 · sağdaki listeden "Banla…" ile de eklenir', pv_add_ph: 'AS numarası, ör. AS14061', pv_add_btn: 'Ekle ve ölç', pv_rm: 'Listeden çıkar', pv_sec_ports_asn: 'Port listesindeki sağlayıcılar için kapatılan portlar', pv_ports_share_s: 'CSF\'te bu liste bütün port listeli sağlayıcılar için ortak', pv_ports_web: 'TCP 80, 443 · UDP 443 (HTTP/3) — SSH, posta, DNS ve sunucunun kendi bağlantıları açık', pv_ports_cust: 'TCP {0} · UDP {1}', pv_sec_ports: 'Kapatılan portlar', pv_sec_lists: 'Listeler', pv_sec_srcs: 'Kaynaklar', pv_tile_addr: 'Adres', pv_tile_pot: 'olay kaydındaki {0} ihlal eden IP bu listede', pv_tile_fail: 'indirilemiyor (ilk hata {0})', pv_ed_t: '{0} · indirme adresi', pv_ed_close: 'Kapat', pv_ex_lists: 'Ek listeler', pv_ex_lists_h: 'Satır başına ad|https://adres (düz IP listesi ya da JSON): hazır listelerde olmayan bir firma için.', pv_ex_addr: 'Ek adresler', k_CLOUD_EXTRA: 'Ek listeler', bad_clx: 'Geçersiz satır: {0} (ad|https://adres; ad küçük harf, rakam, tire)', bad_clx_n: 'En çok 20 liste', pv_src_microsoft365: 'Microsoft 365', pv_src_microsoft365_d: 'Outlook, Exchange Online (yeni Outlook posta eşitleme ve gönderimi)', cl_m365_w: 'Kiralık sunucularda posta portları (465, 587, IMAP, POP) kapalı ve Azure seçili: yeni Outlook, IMAP hesaplarının postasını Microsoft 365 sunucuları üzerinden eşitleyip gönderiyor; bu sunucuların bir kısmı Azure listesinde. İzinli servislerde Microsoft 365\'i açın.', r_pnear: 'İhlal eden IP\'lerin hepsi {0} kapsamında, ama ihlaller {1} servisine geliyor ve kapalı portlar bunu kapsamıyor. Kapatmak için port listesine {2} ekleyin.', pn_lists: 'ilgili', in_cloud: 'Bu aralık {0} listesinde: {1} zaten kapalı. Diğer portları da kapatmak istiyorsanız banlayın.', pv_imp_addip: 'İzinli servislere ekle', pv_imp_added: 'Ek adreslere eklendi ({0}); kaydedince geçerli olur.', pv_imp_srcoff: '{0} kaynağı İzinli servislerde kapalı: açarsanız izinli olur.', pv_imp_fake: '{0} diyor ama {0} listesinde değil: sahte bot olabilir.', under_cl_h: 'Bu kısmi ban {0} listesinin içinde ve kapattığı portları liste de kapatıyor. Kaldırmak listede yer açar; o listeyi sonra kapatırsanız bu aralık da açılır.', under_cl: 'kiralık sunucu listesinde', pv_cov_t2: 'Gereksizleşen banlar', pv_cov_h2: 'Bu banların kapattığı her şeyi daha geniş bir engel (sağlayıcı banı, kiralık sunucu listesi ya da /16 banı) zaten kapatıyor; sağlayıcı ve liste için CSF\'in yüklediği aralıklarla doğrulandı. Durmaları zarar vermez, kaldırmak kalıcı listede yer açar. O geniş engeli ileride kaldırırsanız bu aralıklar açılır.', pv_imp_allow: 'Bunların {0} isteği ({1} IP) izinli servislerden: CSF bunlara bandan önce izin verir, ban onları kesmez.', pv_imp_al: 'izinli · {0} — banlanmaz', pv_imp_alp: '{0}/{1} izinli · {2}', bn_cloud: '{0} listesi', p_cl: '{0} tanesi kiralık sunucu listesinde', p_cl_h: 'Bu banların IP\'leri açık bir kiralık sunucu listesinde: o sunucular seçilen portlarda zaten kapalı, sıralamada sayılmadı.', k_ENABLED: 'CSF Auto-Group', en_1: 'Çalışıyor', en_0: 'Duraklatıldı', h_ENABLED: 'Duraklatınca yeni ban konmaz ve uyarı gitmez; sağlayıcı banı ile kiralık sunucu banı CSF\'ten hemen kaldırılır. İzinli servisler ve mevcut blok banları yerinde kalır. Açınca her şey ayarlardaki hâline döner.', sb_paused: 'Koruma duraklatıldı', sb_paused_s: 'Yeni ban konmuyor; sağlayıcı banı, kiralık sunucu banı ve blok sayacı kaldırıldı', paused_bar: 'CSF Auto-Group duraklatıldı: yeni ban konmuyor, sağlayıcı banı ve kiralık sunucu banı CSF\'ten kaldırıldı. Mevcut blok banları duruyor.', resume: 'Sürdür', resuming: 'Sürdürülüyor…', m_resume_t: 'Eklenti sürdürülsün mü?', m_resume_b: 'Turlar yeniden çalışır. Sağlayıcı banı, kiralık sunucu listesi ve izinli servisler CSF ayarlarına yeniden yazılır; CSF kurallarını yeniden kurar, ardından lfd yeniden başlar (birkaç saniye sürer).', pv_ev_add: 'eklendi: {0}', pv_ev_del: 'çıkarıldı: {0}', pv_ev_mv: '{0} → {1}', pv_ev_tot: 'toplam {0} sağlayıcı', pv_ev_mode: 'port listesi: {0}', pv_why_t: 'Bu sağlayıcıdan banlananlar', pv_why_n: '{0} IP · olay kaydına göre (son {1} gün)', pv_why_cnt: 'CSF\'te şu an: {0}', pv_why_r: 'Ban sebepleri', pv_why_s: 'İhlal edilen servisler: {0}', pv_why_web: 'İhlaller yalnız web\'e: "Port listesi" (yalnız web) yeterli.', pv_why_more: 'Web dışında da ihlal var ({0}): bunları da kesmek için "Her şey" ya da ortak port listesine o portlar.', pv_why_none: 'Olay kaydında bu sağlayıcıdan banlanmış IP yok.', cl_azure: 'Azure', cl_azure_d: 'Azure veri merkezleri', cl_azure_w: 'Azure listesi Azure\'un bütün veri merkezi adreslerini içerir; Bingbot\'un adresleri de bunların içinde. İzinli servislerde Bing açık değilse Bingbot da kesilir.', cl_azure_h: 'Microsoft listeyi her hafta yeni bir dosya adıyla yayımlıyor; adres indirme sayfasıdır, güncel dosya oradan bulunur. Doğrudan bir .json adresi de yazılabilir.', r_apfx: 'Tekillerin {1} / {2}\'si duyurulan {0} aralığında; /16 yerine o aralığı banlamak yetebilir.', banpfx: 'Duyurulan aralığı banla ({0})', banpfx_h: 'Sahibinin internete duyurduğu aralık: {0} adres. /16\'nın tamamını kapatmadan yalnız bu bölümü banlar.', m_banpfx_t: '{0} kalıcı olarak banlansın mı?', m_banpfx_b: 'Bu, sahibinin duyurduğu aralıktaki {0} adresin tamamını engeller; /16\'nın geri kalanı açık kalır. Ban silinmez olarak eklenir (CSF\'in "do not delete" işareti): liste dolsa da kendiliğinden kalkmaz.', m_svc_bpfx: 'Duyurulan aralıktaki {0} adresten seçtiğiniz servislere gelen bağlantılar engellenir. Ban silinmez olarak eklenir (CSF\'in "do not delete" işareti): liste dolsa da kendiliğinden kalkmaz.', k_CLOUD_BAN: 'Kiralık sunucular', k_CLOUD_SOURCES: 'Listeler', k_CLOUD_TCP: 'TCP portları', k_CLOUD_UDP: 'UDP portları', h_CLOUD_SOURCES: 'Listeler her gün yeniden indirilir. İndirilemezse önceki liste korunur.', h_CLOUD_TCP: 'Virgüllü portlar ya da aralıklar (30000:35000), en çok 15. Varsayılan 80,443: siteler. Boş bırakılırsa TCP kapatılmaz.', h_CLOUD_UDP: 'Virgüllü portlar ya da aralıklar, en çok 15. 443: HTTP/3. Boş bırakılırsa UDP kapatılmaz.', cl_t: 'Kiralık sunucular', cl_h: 'Bulut firmalarının herkese kiraladığı sanal sunucuların adreslerini (firmaların yayımladığı listelerden) yalnız seçilen portlarda kapatır. İhlallerin çoğu bu kiralık sunuculardan gelir; sitelerinizin ziyaretçileri (ev ve mobil internet) bu listelerde yoktur. Firmanın kendi servisleri de yoktur: örneğin Google Cloud listesinde Googlebot ve Gmail bulunmaz, bu yüzden bütün ASN\'i banlamaktan daha dar ve güvenlidir. İzin listesi (csf.allow, izinli servisler) önce gelir; sunucunun bu bulutlara kendi açtığı bağlantılar etkilenmez.', cl_n: 'CSF\'te yüklü: {0} aralık · son indirme {1}', cl_n0: 'Listeler kaydedince indirilir ve uygulanır.', cl_own: 'Kendi sunucularınız ya da kullandığınız bir servis bu bulutlarda çalışıp sitelere bağlanıyorsa (izleme, webhook) adresini csf.allow\'a ya da İzinli servisler → Ek adresler\'e ekleyin.', cl_noports: 'En az bir port girin; yoksa hiçbir şey kapatılmaz.', cl_err: 'İndirilemedi, önceki liste kullanılıyor: {0}', cl_urls: 'Kaynak adreslerini göster ve düzenle', cl_urls_h: 'Listeler bu adreslerden indirilir. Sağlayıcı adresi değiştirirse yenisini buraya yazın.', cl_gcp: 'Google Cloud', cl_gcp_d: 'kiralık sunucular (Compute Engine)', cl_aws: 'AWS', cl_aws_d: 'kiralık sunucular (EC2)', cl_oracle: 'Oracle Cloud', cl_oracle_d: 'kiralık sunucular (OCI)', cl_digitalocean: 'DigitalOcean', cl_digitalocean_d: 'kiralık sunucular (Droplet)', cl_linode: 'Linode', cl_linode_d: 'kiralık sunucular (Akamai)', cl_vultr: 'Vultr', cl_vultr_d: 'kiralık sunucular', l_cloud: 'Bu IP {0} kiralık sunucu listesinde · kapalı: {1}', v_cloud: 'bu IP {0} kiralık sunucu listesinde', ev_cloud_fail: 'Kiralık sunucu listesi indirilemiyor', clfail_bar: 'Kiralık sunucu listesi uyarı süresinden uzun süredir indirilemiyor: {0}. Eski liste kullanılıyor; adres değişmiş olabilir.', under_pv_h: 'Bu ban {0} sağlayıcı banının içinde: CSF o sağlayıcının yüklediği aralıklarla bu banın kapattığı her şeyi zaten kapatıyor. Kaldırmak listede yer açar; sağlayıcı banını sonra kaldırırsanız bu aralık da açılır.', pv_cov_t: 'Gereksizleşen banlar', pv_cov_h: 'Bu banların kapattığı her şeyi daha geniş bir engel (sağlayıcı banı, kiralık sunucu listesi ya da /16 banı) zaten kapatıyor; sağlayıcı ve liste için CSF\'in yüklediği aralıklarla doğrulandı. Durmaları zarar vermez, kaldırmak kalıcı listede yer açar. O geniş engeli ileride kaldırırsanız bu aralıklar açılır.', pv_cov_all: 'Hepsini kaldır ({0})', pv_cov_done: 'Toplu kaldırma bitti: {0} kaldırıldı, {1} kaldırılamadı.', pv_cov_m: '{0} ban kaldırılsın mı?', pv_cov_mb: 'Şu banlar daha geniş bir engelin içinde; kaldırıldıktan sonra da o engel onları kapatmaya devam eder. Elle konmuş bir banın kaldırdığı kayıtlar varsa geri yüklenir.', k_prov: '{0} sağlayıcı banı', bn_t: 'Banlı sağlayıcılar sıralamada gösterilmez:', bn_all: 'her şey', bn_nl: 'adresleri CSF\'e henüz yüklenmedi', bn_go: 'Sağlayıcılar sekmesinde yönet', pv_url_reset: 'Varsayılana dön', pv_url_changed: 'değiştirildi', k_SVC_URLS: 'Kaynak adresleri', bad_svcu: 'Geçersiz adres: {0} (https:// ile başlamalı)', ev_svc_fail: 'Liste indirilemiyor', evh_svc_fail: 'Bir izinli servis listesi uyarı süresinden uzun süredir indirilemiyor; eski liste kullanılıyor.', svcfail_bar: 'İzinli servis listesi uyarı süresinden uzun süredir indirilemiyor: {0}. Eski liste kullanılıyor; adres değişmiş olabilir.', svcfail_go: 'Kaynak adreslerine bak', pv_svc_last: 'Son indirme {0} · csf.allow\'da {1} adres · her gün yenilenir', pv_svc_never: 'Listeler henüz indirilmedi; kaydedince indirilir.', pv_urls: 'Kaynak adreslerini göster ve düzenle', pv_urls_h: 'Hazır kaynaklar bu adreslerden indirilir. Bir sağlayıcı adresini değiştirirse o kaynağı kapatıp yeni adresi Ek adresler\'e kendi adınızla ekleyin.', pv_src_t: '{0} adres · {1}', pv_extra_l: 'Ek adresleriniz', m_asn_add: 'Sağlayıcı banına ekle', m_asn_go: 'Sağlayıcılar sekmesinde göster', m_asn_in: 'Bu sağlayıcı zaten sağlayıcı banı listesinde.', v_allow: 'Sonuç: erişebilir, {0} içinde. İzin bütün banların önüne geçer.', v_block: 'Sonuç: tamamen banlı, bütün portlar kapalı ({0}).', v_part: 'Sonuç: kısmi banlı. Yalnız şunlar kapalı: {0}. Diğer bağlantılar (SSH, posta…) açık.', v_self: 'Sonuç: bu sunucunun kendi adresi. lfd kendi adreslerini her zaman yoksayar; eklenti kendi IP\'sini içeren aralığı banlamaz.', v_none: 'Sonuç: banlı değil, bütün bağlantılar açık.', v_wl_lfd: '{0}: bu kayıt yalnız lfd\'nin bu IP\'yi kendiliğinden banlamasını engeller; güvenlik duvarındaki banlar yine geçerlidir.', v_wl_port: '{0}: bu satır yalnız o portu açar; diğer bağlantılar için yukarıdaki sonuç geçerlidir.', v_wl_port_in: '{0}: yalnız gelen yönü açar; bu IP\'nin banı iki yönlü olduğu için cevaplar düşer, satır bağlantı açmaz (karşı yön satırı da gerekir).', v_wl_port_out: '{0}: yalnız sunucunun bu adrese açtığı bağlantılar için; bu adresi kapsayan bir ban o bağlantıları da keser (cevap gelen yönde düşer).', v_single: 'tekil ban', v_temp: 'geçici ban', dr_covered: 'Bu IP\'nin ağı zaten tamamen kapalı; blok ya da ağ banı ayrıca bir şey değiştirmez.', raw_line: 'CSF satırı', more_d: 'Ayrıntı', in_clean_s: 'İçerideki kalıcı kayıtlar ve geçici banlar silinir. Kalıcı olanlar saklanır; bu ban kaldırılırken geri yüklenebilir.', h_part_go2: 'Yalnız {0} kapat', h_now: 'Şu an: {0}.', now_all: 'her şey kapalı', now_svc: 'yalnız {0} kapalı', now_exc: 'her şey kapalı, açık: {0}', chg_same: 'Seçim şu anki banla aynı; değiştirmek için başka bir seçenek seçin.', m_restore_ips: 'Geri yüklenecekler: {0}', under_cc: 'ülke banı içinde', under_asn: 'sağlayıcı banında', cov_under: '{0} banının içinde', under_cc_h: 'Bu blok {0} içinde; ülke ya da sağlayıcı banı onu zaten kapatıyor. Kaldırmak kalıcı listede bir satır boşaltır.', pv_card_nodata: 'CSF bu sağlayıcının adreslerini henüz yüklemedi; kural şu an etkisiz olabilir (Sağlayıcılar sekmesi).', tab_prov: 'Sağlayıcılar', pv_add: 'Banla…', pv_inlist: 'listede', pv_add_h: 'Sağlayıcı banı listesine ekler ve etkisini ölçer; kaydetmeden uygulanmaz.', pv_ev_t: 'Sağlayıcı banı olayları', pv_ev_none: 'Henüz sağlayıcı banı olayı yok.', pv_open_tab: 'Sağlayıcılar sekmesinde aç', pv_top_h: 'Banlamak istediğiniz sağlayıcıda "Banla…"ya basın: listeye eklenir ve etkisi ölçülür; kaydedince CSF\'e uygulanır.', blk_wl: 'Blok bir izin listesiyle çakıştığı için eşiği aşsa da otomatik banlanmaz; Kontrol edilecekler\'de görünür.', sum_wl_open: 'yalnız beyaz listedeki adresler ({0}): csf.allow bandan önce gelir', pv_tcp_ph: 'ör. 80,443', pv_udp_ph: 'ör. 443 (boş: UDP kapatılmaz)', h_ASN_TCP: 'Virgüllü portlar ya da aralıklar (30000:35000), en çok 15. Boş bırakılırsa TCP kapatılmaz.', h_ASN_UDP: 'Virgüllü portlar ya da aralıklar, en çok 15. Boş bırakılırsa UDP kapatılmaz.', pv_busy: 'Bir tur çalışıyor; ayar kaydedildi, bir sonraki turda CSF\'e uygulanır.', bad_svcx_n: 'En çok 50 kayıt', pv_src_uptimerobot: 'UptimeRobot', pv_src_uptimerobot_d: 'site izleme', pv_src_pingdom: 'Pingdom', pv_src_pingdom_d: 'site izleme', pv_src_statuscake: 'StatusCake', pv_src_statuscake_d: 'site izleme', pv_row_ports: 'Port listesi', pv_row_all: 'Her şey', k_ASN_ALL: 'Her şeyi kapatılan sağlayıcılar', pv_row_all_h: 'Sağlayıcıdan gelen her şey kesilir (CC_DENY). CSF bunu yanıtlardan önce uygular: sunucunun o sağlayıcıdaki API\'lere, yedek hedeflerine bağlantıları da çalışmaz.', pv_row_ports_h: 'Aşağıdaki ortak port listesindeki portlar kapanır (CC_DENY_PORTS).', pv_imp_hide: 'Gizle', pv_imp_again: 'Yeniden ölç', pv_imp_at: 'Ölçüldü: {0}', st_prov: 'Sağlayıcı banı', pv_exp: 'Deneysel', pv_asn_t: 'Sağlayıcı (ASN) banı', pv_asn_h: 'Bir sağlayıcının bütün adreslerini CSF ile banlar (CC_DENY / CC_DENY_PORTS). Eklenti ayarı CSF\'e yazar, adres listesi güncel kalsın diye CSF\'in ASN verisini de yeniler.', k_ASN_BAN: 'Sağlayıcı banı', k_ASN_LIST: 'Sağlayıcılar', k_ASN_MODE: 'Ortak port listesi', k_ASN_TCP: 'TCP portları', k_ASN_UDP: 'UDP portları', h_ASN_LIST: 'AS numaraları, virgülle (en çok 50). Her biri için aşağıda ne kapatılacağını seçin. Bir IP\'nin sağlayıcısını IP sorgula kartı gösterir; sunucunun kendi sağlayıcısı banlanmaz.', pv_m_web: 'Yalnız web', pv_m_ports: 'Seçilen portlar', pv_m_all: 'Her şey', pv_md_web: '"Port listesi" seçilen sağlayıcılardan sitelere gelen web istekleri kesilir: TCP 80, 443 ve HTTP/3 için UDP 443. Posta, DNS ve sunucudan dışarı giden bağlantılar etkilenmez.', pv_md_ports: '"Port listesi" seçilen sağlayıcılardan yalnız yazdığınız portlara gelen bağlantılar kesilir.', pv_md_all: 'Sağlayıcıdan gelen her şey kesilir. CSF bu banı yanıtlardan da önce uygular: sunucunun o sağlayıcıdaki API\'lere, yedek hedeflerine yaptığı bağlantılar da çalışmaz.', pv_ports_share: 'CSF port kısıtlı banlarda (CC_DENY_PORTS) tek bir port listesi kullanır; bu yüzden liste bütün sağlayıcılar için ortak. Orada başka bir ülke ya da sağlayıcı farklı portlarla varsa liste değiştirilmez ve sebebi burada gösterilir.', pv_set_n: 'CSF\'te yüklü · {0} aralık', pv_set_0: 'CSF\'te boş: adresler henüz yüklenmedi', pv_set_load: 'CSF yüklüyor…', pv_set_load_h: 'lfd birkaç dakika önce yeniden başladı; CSF sağlayıcının aralıklarını dolduruyor. Sayfa kendiliğinden yenilenir.', pv_lay_load: 'CSF aralıkları yüklüyor', pv_set_new: 'kaydedilince uygulanır', pv_geo: 'CSF\'in ASN verisi {0} indirildi; ayardaki süreden eskiyse eklenti yeniler.', pv_noipset: 'CSF ayarında LF_IPSET = 0: sağlayıcı aralıkları küme olarak tutulmuyor, yüklenen aralık sayısı okunamıyor (ban yine işler).', pv_noipset_imu: 'CSF ayarında LF_IPSET = 0: sağlayıcı aralıkları küme olarak tutulmuyor. Yüklenen aralık sayısı okunamıyor ve port listeli sağlayıcı banı Imunify360 yönlendirmesine karşı korunamıyor (ban koruması kümeye bakar). LF_IPSET = 1 önerilir.', pv_geo_none: 'CSF\'in ASN verisi henüz yok; ilk sağlayıcı banında indirilir.', pv_svc_off_w: 'İzinli servisler kapalı: Google\'ın botları gibi bu sağlayıcıda çalışan servisler de kesilir.', pv_imp: 'Etkisini ölç', pv_imp_h: 'Banlamadan önce: son 24 saatin web günlüklerinde bu sağlayıcıdan sitelere gelen istekler.', pv_imp_wait: 'Son 24 saatin bütün sitelerdeki web günlükleri taranıyor; günlükler büyükse biraz sürer.', pv_imp_fails: 'Başarısız isteklerden örnekler (izinli servisler dışında; kod · site · adres)', pv_imp_ocodes: 'İzinli servisler dışındaki isteklerin cevapları', pv_imp_acodes: 'İzinli servislerin cevapları', pv_imp_asvc: 'İzinli servislerden gelen istekler', pv_imp_sum: 'Son 24 saat: {0} istek, {1} IP · başarılı (2xx): {2}', pv_imp_codes: 'Cevap kodları', pv_imp_posts: 'Başarılı POST istekleri (ödeme bildirimi, webhook olabilir)', pv_imp_bots: 'Tarayıcı olmayan istemciler (2xx)', pv_imp_sites: 'En çok başarılı istek alan siteler', pv_imp_noposts: 'Başarılı POST isteği yok; webhook görünmüyor.', pv_imp_tip: 'Listede tanıdığınız bir servis (ödeme, kargo, pazaryeri) varsa: adreslerini yayımlıyorsa aşağıdaki İzinli servislere ekleyin; yayımlamıyorsa bu sağlayıcıyı banlamayın.', pv_imp_none: 'Son 24 saatte bu sağlayıcıdan sitelere istek gelmemiş.', pv_imp_nodata: 'CSF\'in ASN verisi yok; ilk sağlayıcı banında indirilir. Ölçüm ondan sonra yapılabilir.', pv_imp_nologs: 'Web günlükleri bulunamadı: /var/log/apache2/domlogs, /usr/local/apache/domlogs ve /etc/apache2/logs/domlogs yok. Ölçüm Apache erişim günlüklerini (domlogs) okur; günlükler başka bir dizindeyse config.env\'e DOMLOGS=/yol yazın.', pv_svc_t: 'İzinli servisler', pv_svc_h: 'Adreslerini kendileri yayımlayan servisler csf.allow\'a yazılır. CSF önce izin listesine baktığı için bu adresler ülke ve sağlayıcı banından geçer; bütün portlarda izinlidir. Google ve OpenAI her ziyaretçi türü için ayrı liste yayımlar; kutucuktaki çiplerle her biri ayrı açılıp kapatılır. Bir servisin tek bir adresi ihlal ediyorsa onu «İzinli servislerden hariç tutulanlar» alanına yazın: listenin kalanı izinli kalır, o adrese ban işler.', k_SVC_ALLOW: 'İzinli servisler', k_SVC_SOURCES: 'Kaynaklar', k_SVC_EXTRA: 'Ek adresler', k_SVC_SKIP: 'İzinli servislerde kapalı alt listeler', k_SVC_EXCEPT: 'İzinli servislerden hariç tutulanlar', k_CLOUD_URLS: 'Kiralık liste adresleri', h_SVC_SOURCES: 'Listeler her gün yeniden indirilir. İndirilemezse önceki liste korunur.', h_SVC_EXTRA: 'Satır başına bir kayıt: ad|https://adres-listesi ya da ad|IP (ad|1.2.3.0/24). Liste adresi JSON ya da düz metin olabilir.', pv_src_google: 'Google', pv_src_google_d: 'Googlebot, AdsBot, Gmail resimleri', pv_src_bing: 'Bing', pv_src_bing_d: 'Bingbot', pv_src_apple: 'Apple', pv_src_apple_d: 'Applebot (Siri, Spotlight)', pv_src_duckduckgo: 'DuckDuckGo', pv_src_duckduckgo_d: 'DuckDuckBot', pv_src_openai: 'OpenAI', pv_src_openai_d: 'GPTBot, arama botu, ChatGPT', pv_src_stripe: 'Stripe', pv_src_stripe_d: 'ödeme bildirimleri', pv_src_mollie: 'Mollie', pv_src_mollie_d: 'ödeme bildirimleri', pv_src_n: '{0} adres', pv_svc_sum: 'csf.allow\'da {0} adres · son güncelleme {1}', pv_svc_err: 'İndirilemedi, önceki liste kullanılıyor: {0}', pv_svc_nolist: 'Yandex ve Facebook adres listesi yayımlamadığı için burada yok.', pv_applying: 'Sağlayıcı ayarları CSF\'e uygulanıyor…', pv_applied: 'Sağlayıcı ayarları CSF\'e uygulandı.', ev_provider: 'Sağlayıcı banı', evh_provider: 'Sağlayıcı banı CSF ayarlarına (CC_DENY / CC_DENY_PORTS) yazıldı ya da oradan kaldırıldı; ayrıntıda o anki sağlayıcı listesi.', evh_cloud_fail: 'Bir kiralık sunucu listesi uyarı süresinden uzun süredir indirilemiyor; eski liste kullanılıyor.', evh_config: 'Panelden bir ayar kaydedildi; ayrıntıda eski ve yeni değer, yapan kişi.', evh_test_mail: 'Ayarlar → Bildirim sayfasından deneme maili gönderildi.', pv_ev_rm: 'kaldırıldı: {0}', bad_asn_list: 'AS ile başlayan numaralar, virgülle (en çok 50)', bad_ports: 'virgüllü portlar ya da aralıklar (30000:35000), en çok 15', bad_svcx: 'Geçersiz satır: {0}', bad_svce: 'Geçersiz adres: {0} (IPv4 adres ya da 1.2.3.0/24 gibi aralık yazın)', syncing: 'İşlem tamam, liste güncelleniyor…', working: 'İşlem yapılıyor…', boot_wait: 'Sunucunun durumu okunuyor: CSF listeleri, olay kaydı ve sağlayıcı kümeleri taranıyor.', w_ban: 'Ban ekleniyor…', w_chg: 'Ban değiştiriliyor…', w_unban: 'Ban kaldırılıyor…', w_expire: 'Eski blok banları kaldırılıyor…', w_forget: 'İzlemeden çıkarılıyor…', w_ignore: 'Yoksayılıyor…', w_unignore: 'Yoksayma kaldırılıyor…', w_csf: 'csf.deny yazıldı; CSF güvenlik duvarı kurallarını baştan kuruyor (csf -r). Bekleyişin çoğu bu; banı çok sunucuda daha uzun sürer.', w_prov: 'Ayarlar csf.conf\'a yazıldı; CSF kuralları baştan kuruyor, ardından lfd yeniden başlatılıyor. Sağlayıcı aralıklarını lfd sonradan doldurur.', w_light: 'Yalnız eklentinin kendi kaydı değişiyor; CSF\'e dokunulmuyor.', working_s: 'CSF güncelleniyor; birkaç saniye sürebilir. Bitince liste kendiliğinden yenilenir.', ev_fix_udp: 'Ban tamamlandı', evh_fix_udp: 'Bu sürümden önce konan kısmi ban ya da istisnada web için UDP 443 satırı yoktu; eklendi. HTTP/3 (QUIC) bu porttan çalışır.', fix_udp_d: 'UDP 443 eklendi (HTTP/3)', r_after: 'yalnız kısmi bandan sonrakiler', ban_btn: 'Banla', m_ban24_t: '{0} kalıcı olarak banlansın mı?', m_ban24_b: 'Bu, bloktaki 256 adresin tamamını engeller. Ban silinmez olarak eklenir (CSF\'in "do not delete" işareti): liste dolsa da kendiliğinden kalkmaz.', in_loading: 'İçindekiler okunuyor…', in_h: 'İçinde şu an', in_blocks: 'Blok banları', in_singles: 'Tekil banlar', in_temps: 'Geçici banlar', in_watched: 'İzlenen bloklar', in_others: 'Başka aralıklar', in_owner: 'Sahip', in_none: 'İçinde başka kayıt yok.', in_watch_end: 'ban sürerken izlenmez', in_oth_keep: 'dokunulmaz', in_clean0: 'Kapsananları kaldır', in_clean_d: 'Aralığın içindeki kalıcı kayıtlar (silinmez olanlar ve başka aralıklar dahil) kalıcı listeden, geçici banlar geçici listeden silinir. Silinen kalıcı kayıtlar saklanır; bu ban kaldırılırken isterseniz eski hâlleriyle geri yüklenir. Geçici banlar geri yüklenmez, süreleri zaten dolacaktı. Silinmez ("do not delete") satırlar CSF\'in liste sınırına girmediği için boşalan satırlara sayılmaz.', in_cover: 'Bu aralık zaten banlı: {0}. Yeni ban gerekmez. Aralığı ayrı banlamak istiyorsanız önce kapsayan banı kaldırın (Aktif aralık banları ya da IP kartı).', in_wl: 'Beyaz listeyle çakışıyor:', under: '{0} içinde', under_h: 'Bu blok {0} banının içinde; ayrıca gerekmiyor. Kaldırmak kalıcı listede bir satır boşaltır.', under_hp: 'Bu blok {0} banının içinde; izlemenin anlamı kalmadı.', l_perm_net: 'Kalıcı (ağ)', l_perm_rng: 'Kalıcı (/{0})', l_port: 'Port sınırlı · {0} {1} kapalı · {2}', l_ccd_cc: 'Ülke banlı · CC_DENY {0}', l_ccd_asn: 'ASN banlı · CC_DENY {0}', l_ccp: 'Port sınırlı · CC_DENY_PORTS {0} · {1}', l_ccd_src: 'Ülke ve ASN burada Team Cymru\'dan; CSF kendi veritabanını kullanır, nadiren farklı olabilir.', ev_removed: '{0} kayıt kaldırıldı', r_partial: 'bu ağda kısmi ban var: {0}', m_unban_part: 'Kısmi ban kaldırılır; bu aralıktan seçili servislere gelen bağlantılar yeniden açılır. İçindeki diğer banlar yerinde kalır.', ev_restored: '{0} kayıt geri yüklendi', m_restore_d: 'Kayıtlar kalıcı listeye eski yorum ve tarihleriyle döner, silinmez ("do not delete") işaretleri dahil. İşaretlemezseniz bu kayıtların banı da kalkar ve kayıtlar silinir.', m_restore: 'Bu ban konurken kaldırılan {0} kaydı geri yükle', m_unban_rb: 'Ban kalıcı listeden kaldırılır.', in_free_pt: 'kalıcı listede {0} satır, geçici listede {1} kayıt boşalır', in_free_t: 'geçici listede {0} kayıt boşalır', in_free_p: 'kalıcı listede {0} satır boşalır', in_sgl_dnd: '{0} silinmez dahil', in_keep: 'kalır', in_rm: 'kaldırılır', dir_in: 'gelen', dir_out: 'giden', in_ports: 'Port sınırlı satırlar', in_self: 'Bu aralıkta sunucunun kendi IP\'si var ({0}); banlanamaz.', ban_anyway: 'Yine de banla', ignore: 'Yoksay', unban: 'Kaldır',
      promote: 'Kalıcı yap', forget: 'İzlemeden çıkar', unignore: 'Yoksaymayı bitir', show_all: 'Tümünü göster ({0})', more: 'Daha fazla',
      n_ip: '{0} IP', n_subnets: '{0} farklı blok', from_temp: 'geçici banlardan', from_perm: 'kalıcı banlardan', days_left: '{0} gün kaldı',
      ttl_left: 'geçici ban: {0} kaldı', until: '{0} tarihine kadar', by: '{0} tarafından', wl: 'beyaz liste: {0}', and_more: '+{0} IP daha',
      no_review: 'Göz atılacak bir şey yok.', no_groups: 'Aktif aralık banı yok.', no_pending: 'İzlenen blok yok.',
      no_events: 'Henüz kayıt yok. İlk turdan sonra burada görünecek.', no_match: 'Eşleşen kayıt yok.',
      c_t24: 'Blok banı (/24)', c_t24p: 'Silinmez ban eşiği', c_t16: 'Şüpheli ağ (/16)', c_tt24: 'Geçici blok banı (/24)',
      c_ret: 'İzleme süresi', c_lookup: 'Sahip / hostname sorgusu', c_on: 'açık', c_off: 'kapalı', c_days: '{0} gün', c_forever: 'Süresiz', ign_change: 'Süreyi değiştir', rewatch: 'İzlemeyi yeniden başlat', m_rewatch_t: '{0} izlemesi yeniden başlasın mı?', m_rewatch_b: 'İzleme süresi bugünden itibaren yeniden sayılır (Ayarlar → Ban kuralları → İzleme süresi kadar). Bu sürede aynı bloktan yeni geçici ban gelirse blok kalıcı banlanır.', w_rewatch: 'İzleme yeniden başlatılıyor…', ev_manual_rewatch: 'İzleme yeniden başladı', ign_forever: 'süresiz', ign_who: '{0} yoksaydı, {1}', ign_forever_l: 'süresiz yoksayıldı', st_ign_f: 'yoksayıldı (süresiz)', c_singles: '≥ {0} tekil', c_gloss: 'tekil = tek IP banı · blok = /24 · ağ = /16 · silinmez = CSF liste dolsa da silmez',
      now: 'az önce', min_ago: '{0} dk önce', h_ago: '{0} sa önce', d_ago: '{0} gün önce', dur_h: '{0} sa {1} dk', dur_m: '{0} dk',
      cancel: 'Vazgeç', confirm: 'Onayla', close: 'Kapat', reload: 'Sayfayı yenile', type_to_confirm: 'Onaylamak için {0} yazın',
      m_ban16_t: '{0} kalıcı olarak banlansın mı?', m_ban16_b: 'Bu, ağdaki 65.536 adresin tamamını engeller. Ban silinmez olarak eklenir (CSF\'in "do not delete" işareti): liste dolsa da kendiliğinden kalkmaz.',
      m_force_t: 'Beyaz listeye rağmen banlansın mı?', m_force_b: 'Bu blok CSF beyaz listelerinden biriyle çakışıyor:',
      m_force_n: 'csf.allow\'daki adresler bu ban olsa da erişmeye devam eder. csf.ignore ve diğer listelerdekiler ise engellenir.',
      m_promote_t: '{0} şimdi kalıcı yapılsın mı?', m_promote_b: 'Blok kalıcı listeye silinmez olarak eklenir (CSF\'in "do not delete" işareti) ve izlemeden çıkarılır.',
      m_forget_t: '{0} izlemeden çıkarılsın mı?', m_forget_b: 'Bu bloktan bir sonraki ihlal yine "ilk kez" sayılır ve 12 saatlik geçici blok banı alır.',
      m_unban_t: '{0} kaldırılsın mı?', m_unban_b: 'Blok banı kaldırılır. Blok banı eklenirken silinen tekil banlar geri gelmez; bu adresler tamamen açılır.',
      m_unban_dnd: 'Bu ban silinmez işaretli ("do not delete"). Kaldırmak için csf.deny\'deki işaret önce silinir (dosyanın yedeği alınır).',
      m_ignore_t: '{0} yoksayılsın mı?', m_ignore_b: 'Bu kayıt Kontrol edilecekler listesinden gizlenir; şüpheli ağsa (/16) uyarı maili de gelmez. Süresiz seçilirse siz kaldırana kadar sürer. Geri almak: Genel bakış → Yoksayılanlar → Yoksaymayı kaldır (IP kartından da).', m_ignore_d: 'Süre', m_ignchg_t: '{0} yoksayma süresi değişsin mi?', m_ignchg_b: 'Şu anki bitiş: {0}. Yeni süre bugünden sayılır; süresiz seçilirse siz kaldırana kadar sürer.',
      m_unignore_t: '{0} tekrar izlensin mi?', m_run_t: 'Tur şimdi çalıştırılsın mı?',
      m_run_b: 'Zamanlanmış turun (cron) yaptığının aynısı şimdi yapılır: eşiği geçen bloklar banlanır, bildirimler gönderilir.',
      m_dry_t: 'Deneme turu', m_dry_wait: 'Tur hiçbir şeyi değiştirmeden simüle ediliyor…', m_dry_none: 'Bu tur hiçbir değişiklik yapmazdı.',
      m_upd_t: 'v{0} sürümüne güncellensin mi?', m_upd_b: 'update.sh çalıştırılır; config.env ve kayıtlar korunur. Birkaç saniye sürer.',
      m_upd_run: 'Güncelleniyor…', m_upd_ok: 'Güncelleme tamamlandı.', m_upd_fail: 'Güncelleme tamamlanamadı; çıktıya bakın.',
      t_started: 'Tur başlatıldı.', t_done: 'Tur tamamlandı.', t_busy: 'Başka bir tur çalışıyor, birazdan tekrar deneyin.', t_cron_busy: 'Bir tur zaten çalışıyor (büyük olasılıkla cron); bitince sonuçlar burada görünecek.',
      t_err: 'İşlem tamamlanamadı: {0}', e_bad_ip: 'geçerli bir IPv4 adresi değil', e_bad_input: 'girilen değer geçersiz', e_bad_asn: 'geçerli bir AS numarası değil (ör. AS16276)', e_busy: 'bir tur ya da işlem sürüyor, bitince yeniden deneyin', e_confirm_mismatch: 'onay metni eşleşmedi', e_no_script: 'motor dosyası bulunamadı (kurulumu denetleyin)', e_unknown: 'bilinmeyen istek', e_unsafe_repo: 'kurulum dosyasının sahibi root değil ya da başka kullanıcılar yazabiliyor; güvenlik için arayüzden güncellenmez, SSH ile update.sh çalıştırın', e_uptodate: 'zaten güncel', e_session: 'oturum süresi doldu, sayfayı yenileyin', e_bad_target: 'hedef geçersiz', e_bad_value: 'ayar değeri geçersiz', session: 'Oturum süresi doldu. Sayfayı yenileyin.', t_copied: 'Kopyalandı.',
      l_host: 'Hostname', l_fwd: 'ad tekrar bu IP\'ye çözülüyor (doğrulandı)', l_nofwd: 'ad bu IP\'ye geri çözülmüyor (doğrulanamadı)', l_noptr: 'Ters DNS kaydı yok',
      l_owner: 'Sahip', l_prefix: 'Duyurulan aralık', l_reg: 'Kayıt', l_fw: 'Güvenlik duvarı', l_wl: 'Beyaz liste',
      l_pending: 'İzleniyor', l_ign: 'Yoksayılıyor', l_notbanned: 'Engelli değil', l_none: 'Yok', l_perm_single: 'Kalıcı (tekil)',
      l_perm_cover: 'Kalıcı (blok)', l_temp: 'Geçici', l_nolookup: 'Sahip ve hostname sorguları kapalı (Ayarlar → Kaynaklar ve yenileme → Sahip ve hostname sorgusu).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Kopyala', bad_ip: 'Geçerli bir IPv4 adresi yazın.', ipv6_no: 'IPv6 adresleri desteklenmiyor: eklenti yalnız IPv4 banlarını gruplar ve gösterir; IPv6 banları CSF ekranında olduğu gibi durur.',
      foot: 'CSF Auto-Group v{0} · {1} olarak oturum açıldı',
      tab_overview: 'Genel bakış', tab_settings: 'Ayarlar', tab_history: 'Geçmiş', show_less: 'Daha az göster', s_cfglog: 'Ayar geçmişi', ev_loading: 'Yükleniyor…', ev_err: 'Olay kaydı okunamadı ({0}); liste yalnız son turların olaylarını gösteriyor, eksik olabilir. Sayfa kendiliğinden yeniden dener.', singles_s: 'tekil', kd_win: 'son {0} günde', kd_since: 'kurulumdan beri', kd_since_n: 'karşılaştırma kurulumdan beri ({0} gün)', kd_lines: 'satır', kd_same: 'değişmedi', kr_ring: '{1} kaydın {0} tanesi atlanan blok', kr_warn: 'şüpheli ağ', kr_skip: 'atlandı', kr_allow: 'izinli IP\'den ihlal', kr_po: 'açık servis', kr_other: 'diğer', st_upd: 'Sürüm ve güncelleme', upd_check: 'Güncellemeleri denetle', upd_checking: 'Denetleniyor…', upd_cur: 'Kurulu sürüm', upd_ok: 'Güncel', upd_new: 'Yeni sürüm var: v{0}', upd_last: 'Son denetim: {0}', upd_never: 'Henüz denetlenmedi', upd_auto: 'Sayfa açıkken yarım saatte bir kendiliğinden de denetlenir; yeni sürüm çıkınca üstte bildirim belirir.', upd_err_not_git: 'Kurulum bir git deposu değil; arayüzden güncelleme yapılamaz (update.sh de çalışmaz).', upd_err_unreachable: 'GitHub\'a ulaşılamadı; biraz sonra tekrar deneyin.', upd_err_detached: 'Depo bir dala bağlı değil; güncelleme SSH üzerinden yapılmalı.', c_auto_on: '{0} günü geçen blok banları her turda kendiliğinden kaldırılır', c_auto_off: '{0} günü geçen blok banları Eski süzgecinde toplanır, kendiliğinden kaldırılmaz', hc_csf: 'CSF', hc_lfd: 'lfd', hc_cron: 'Cron', hc_csf_ok: 'Güvenlik duvarı kuralları yüklü', hc_csf_off: 'CSF devre dışı (csf.disable)', hc_csf_testing: 'CSF test modunda (TESTING = 1)', hc_csf_norules: 'CSF kuralları yüklü değil', hc_csf_missing: 'CSF bulunamadı (kaldırılmış ya da kurulu değil): banlar uygulanmıyor', hc_csf_unknown: 'Durum okunamadı (iptables yok)', hc_lfd_ok: 'lfd çalışıyor', hc_lfd_down: 'lfd çalışmıyor: yeni ban gelmez', hc_cron_ok: 'Turlar zamanında çalışıyor', hc_cron_late: 'Tur gecikti', sb_fw: 'Güvenlik duvarında sorun var', f_old: 'Eski', old_h: '{0} blok banı {1} günden eski.', old_auto: 'Otomatik kaldırma açık; sıradaki turda kaldırılacaklar.', old_manual: 'Otomatik kaldırma kapalı (Ayarlar → Ban kuralları → Eski banlar).', old_rm: 'Eskileri kaldır ({0})', m_exp_t: '{0} eski blok banı kaldırılsın mı?', m_exp_b: '{1} günden eski {0} blok banı csf.deny\'den kaldırılır (silinmez olanlar da). Bu bloklardan tekrar ihlal gelirse yeniden banlanırlar. csf.deny önce yedeklenir.', ev_expire: 'Eski blok kaldırıldı', ev_limit_gone: 'CSF sınırı sildi, izleniyor', evh_limit_gone: 'Eklentinin bu blok banı eklenti dışında csf.deny dosyasından kalktı: büyük olasılıkla kalıcı liste sınırı (CSF ayarı DENY_IP_LIMIT) dolduğu için CSF en eski satırları sildi, ya da elle kaldırıldı. İçindeki tekil banlar daha önce silinmişti. Blok izlemeye alındı: yeniden ihlal ederse silinmez işaretli kalıcı ban konur. Liste sık doluyorsa DENY_IP_LIMIT değerini artırın.', exp_age: '{0} gün önce eklenmişti', rep_n: 'tekrar ediyor · {0} gün', k_BLOCK_EXPIRE_DAYS: 'Eski blok banı sınırı (gün)', h_BLOCK_EXPIRE_DAYS: 'Bu süreden eski blok banları Aktif aralık banları tablosunda "Eski" filtresinde toplanır.', k_BLOCK_EXPIRE_AUTO: 'Eski blok banlarını otomatik kaldır', h_BLOCK_EXPIRE_AUTO: 'Açıksa her turda bu süreden eski blok banları kaldırılır ve mailde bildirilir. Elle eklenen banlara dokunulmaz.', from_log: 'eski kayıt', sn_server: 'Sunucu', st_deps: 'Sunucu gereksinimleri', st_deps_h: 'Eklentinin kullandığı araçlar ve eksik olduğunda ne olduğu.', dep_ok: 'Var', dep_missing: 'Yok', dep_warn: 'Eksik', dep_opt: 'isteğe bağlı', dep_csf: 'Güvenlik duvarı; banları o uygular.', dep_csf_x: 'Zorunlu: CSF olmadan hiçbir şey çalışmaz.', dep_crontab: 'Turları zamanında çalıştırır.', dep_crontab_x: 'Turlar otomatik çalışmaz; zamanlama Ayarlar\'dan değiştirilemez.', dep_mail: 'Uyarı mailleri ve haftalık özet.', dep_mail_x: 'Uyarı mailleri ve haftalık özet gönderilmez.', dep_dns: 'Sahip ve hostname sorguları.', dep_dns_x: 'Sahip ve hostname bilgisi olmaz; CC_IGNORE / CC_ALLOW ve csf.rignore kontrol edilemez, bu listelere dayanan bloklar banlanmaz.', dep_logrotate: 'Günlük dosyası büyüyünce arşivler (eskisini sıkıştırıp saklar, yeni dosya açar).', dep_logrotate_x: 'Günlükten saklama süresinden eski satırlar silinir (yedek yöntem).', dep_logrotate_w: 'Kurulu ama ayar dosyası yok; günlükten şimdilik saklama süresinden eski satırlar siliniyor. update.sh ya da install.sh ile yeniden kurun.', dep_flock: 'Aynı anda tek tur çalışmasını sağlar.', dep_flock_x: 'Üst üste binen turlara karşı koruma olmaz.', dep_timeout: 'Eklentinin çalıştırdığı komutlara zaman sınırı koyar.', dep_timeout_x: 'Takılan bir komut sayfayı bekletebilir.', dep_git: 'Arayüzden güncelleme.', dep_git_x: 'Güncelleme kontrolü ve Güncelle düğmesi çalışmaz.', dep_modsec: 'cPanel\'in eşleşme kaydı (Uyuşanlar Listesi) var; ban sebeplerinde ModSecurity kuralının mesajı görünür.', dep_modsec_w: 'cPanel eşleşme kaydı yok; mesajlar ModSecurity günlüğü ve kural dosyasından okunuyor (Imunify kuralları yalnız numarayla görünebilir).', dep_modsec_x: 'ModSecurity günlüğü bulunamadı; ban sebeplerinde kurallar yalnız numarayla görünür.', dep_sqlite3: 'ModSecurity eşleşme kaydını okur.', dep_sqlite3_x: 'Eşleşme kaydı okunamaz; mesajlar ModSecurity günlüğü ve kural dosyasından okunur (Imunify kuralları yalnız numarayla görünebilir).', dep_imunify: 'Sağlayıcılar kartındaki Imunify sekmesi; Imunify beyaz listesindeki IP\'lerin bloğu banlanmaz.', dep_imunify_x: 'Imunify sekmesi görünmez; Imunify beyaz listesi kontrol edilmez (CSF listeleri yine kontrol edilir).', k_logfile: 'Durum', log_rot: 'logrotate: {2} MB\'ı geçince arşivlenir, son {3} arşiv saklanır · şu an {0} · {1} arşiv.', k_LOG_ROTATE_MB: 'Günlük boyutu (MB)', h_LOG_ROTATE_MB: 'Günlük bu boyutu geçince arşivlenir: eskisi sıkıştırılıp saklanır, yeni dosya açılır (logrotate günde bir kontrol eder).', k_LOG_ROTATE_KEEP: 'Arşiv sayısı', h_LOG_ROTATE_KEEP: 'Kaç eski günlük arşivinin (sıkıştırılmış) saklanacağı.', log_lines: 'Şu an {0} satır; en eskisi {1}.', no_cfglog: 'Henüz ayar değişikliği yok.', ev_config: 'Ayar değişti', ev_test_mail: 'Test maili',
      st_notify: 'Bildirim', st_mail: 'Uyarı maili adresi', st_mail_h: 'Tur bildirimleri (blok banları, şüpheli ağlar, liste doluluğu, güvenlik duvarı sorunları) ve haftalık özet buraya gider. root@localhost, cPanel\'de sunucunun iletişim adresine yönlenir.',
      st_lang: 'Dil', st_lang_h: 'Günlük, mail ve bu panelin dili.', st_test: 'Test maili gönder', st_test_h: 'Kayıtlı adrese gönderilir.',
      st_test_dirty: 'Önce yeni adresi kaydedin.', mail_whm: 'WHM iletişim adresi', mail_custom: 'Başka adres', mail_whm_h: 'WHM → Basic WebHost Manager Setup\'taki iletişim adresine gider: {0}. Adresi WHM\'de değiştirirseniz eklenti de ona gönderir.', mail_whm_none: 'WHM\'de iletişim adresi bulunamadı; root@localhost\'a gider.', ic_ev_h: 'Güvenlik duvarı sorunu ve liste doluyor hemen gider (başladığında ve düzeldiğinde birer kez). Tur bildirimleri banları, şüpheli ağları ve atlananları kapsar. İzinli IP\'den ihlal ve açık servis kayıtları (Kontrol edilecekler\'deki izinli / yoksayılan / sunucu IP\'si ve açık servis satırları) IP ya da aralık başına günde bir kez gider; yoksaydıklarınız gitmez. Tur bildirimleri ve bu kayıtlar e-postada turun sonunda, Slack\'te saatte en fazla bir mesajda toplanır. Haftalık özet seçilen günde.', ic_fw: 'Güvenlik duvarı sorunu', ic_list: 'Liste doluyor', ic_run: 'Tur bildirimleri', ic_review: 'İzinli IP\'den ihlal, açık servis', ic_digest: 'Haftalık özet', st_events: 'Olaylar ve kanallar', st_events_f: 'Hangi olay hangi kanala', st_mail_c: 'E-posta', st_digest_f: 'Gün', st_digest_off: 'Haftalık özet kapalı; Olaylar ve kanallar tablosunda açılır.', nt_all: 'WHM\'deki tüm kanallar', nt_email: 'Yalnız e-posta', nt_slack: 'Yalnız Slack', nt_h_noslack: 'Slack: WHM\'de tanımlı değil', k_NOTIFY: 'Bildirim kanalları', ic_test: 'Slack\'e deneme gönder', ic_test_h: 'Ayarlardan bağımsız, WHM\'deki Slack kanalına hemen gönderilir.', k_IC_FIREWALL: 'Slack: güvenlik duvarı sorunu', k_IC_LISTFULL: 'Slack: liste doluyor', k_IC_RUN: 'Slack: tur bildirimleri', k_IC_REVIEW: 'Slack: izinli IP\'den ihlal, açık servis', k_IE_REVIEW: 'E-posta: izinli IP\'den ihlal, açık servis', k_IC_DIGEST: 'Slack: haftalık özet', k_IE_FIREWALL: 'E-posta: güvenlik duvarı sorunu', k_IE_LISTFULL: 'E-posta: liste doluyor', k_IE_RUN: 'E-posta: tur bildirimleri', k_IE_DIGEST: 'E-posta: haftalık özet', st_thr: 'Ban kuralları', st_thr_h: 'Ne zaman ban konacağı ya da uyarı verileceği; hepsi tekil (tek IP) ban sayısıyla ölçülür.',
      k_THRESHOLD_24: 'Kalıcı ban eşiği', h_THRESHOLD_24: 'Bir blokta (/24) bu kadar kalıcı tekil ban (tek IP) olunca blok banlanır.',
      k_THRESHOLD_24_PERMANENT: 'Silinmez ban eşiği', h_THRESHOLD_24_PERMANENT: 'Bir blokta bu kadar tekil ban olunca blok banı silinmez olarak işaretlenir (CSF\'in "do not delete" işareti): CSF liste dolsa bile bu banı silmez. Blok banı eşiğinden küçük olamaz.',
      k_THRESHOLD_16: 'Şüpheli ağ eşiği', h_THRESHOLD_16: 'Bir ağda (/16), en az 2 farklı bloktan bu kadar tekil ban (tek IP; kalıcı ve geçici birlikte sayılır) olunca şüpheli ağ olarak bildirilir. Ağ banlanmaz.',
      k_THRESHOLD_TEMP_24: 'Geçici ban eşiği', h_THRESHOLD_TEMP_24: 'Bir blokta bu kadar geçici tekil ban (tek IP) olunca: ilk sefer 12 saatlik geçici blok banı, tekrar gelirse kalıcı.',
      k_THRESHOLD_TEMP_16: 'Şüpheli ağ, geçici banlardan (/16)',
      st_sched: 'Zamanlama', st_sched_h: 'Turların cron ile ne sıklıkla çalışacağı. Sık tur, eşiği aşan bloğu daha erken banlar (en geç bir tur sonra). Her tur, hiçbir şey olmasa da günlüğe bir özet satırı ve Geçmiş\'e bir tur kaydı yazar: sıklık arttıkça günlük daha çabuk dolar ve tur kayıtları çoğalır (Kayıt saklama süresince tutulur).', cron_5: '5 dk', cron_10: '10 dk', cron_15: '15 dk', cron_30: '30 dk', cron_0: 'Saatte bir',
      st_lookup: 'Sorgular', k_LOOKUP: 'Sahip ve hostname sorgusu', h_LOOKUP: 'Mailde ve panelde ASN, kurum ve hostname gösterir; CC_IGNORE ve csf.rignore kontrolleri de buna bağlı.',
      k_LOOKUP_TIMEOUT: 'DNS zaman aşımı (sn)', h_LOOKUP_TIMEOUT: 'Her sorgu için bekleme süresi.', st_nodns: 'Sunucuda dig/host yok; sorgular çalışmaz (dnf install bind-utils).',
      on: 'Açık', off: 'Kapalı', g_runs: 'Çalışma', st_general: 'Genel', st_general_h: 'Eklentinin çalışması: açık mı, turlar hangi sıklıkla, günlük ve mailler hangi dilde.', st_notify_h: 'Hangi olay hangi kanala gider; e-posta adresi, Slack denemesi ve haftalık özetin günü.', st_server_h: 'Sürüm ve güncelleme, CSF\'in liste sınırları, sunucudaki araçlar, günlük dosyası.', st_hist_h: 'Ayarların kim tarafından, ne zaman, neden neye değiştirildiği.', st_ch: 'Kanallar', g_review: 'Kontrol edilecekler', pv_sec_refresh: 'Yenileme', k_CLOUD_REFRESH_DAYS: 'Listeleri yenile (gün)', h_CLOUD_REFRESH_DAYS: 'Kiralık sunucu listeleri bu kadar günde bir yeniden indirilir.', k_CLOUD_FAIL_DAYS: 'İndirilemezse uyar (gün)', h_CLOUD_FAIL_DAYS: 'Bir liste bu kadar gün üst üste indirilemezse mailde ve panelde bildirilir; o sürede son indirilen liste kullanılır.', k_SVC_REFRESH_DAYS: 'Listeleri yenile (gün)', h_SVC_REFRESH_DAYS: 'İzinli servis listeleri bu kadar günde bir yeniden indirilir.', k_SVC_FAIL_DAYS: 'İndirilemezse uyar (gün)', h_SVC_FAIL_DAYS: 'Bir liste bu kadar gün üst üste indirilemezse mailde ve panelde bildirilir; o sürede son indirilen liste kullanılır.', k_GEO_REFRESH_DAYS: 'CSF\'in ASN verisini yenile (gün)', h_GEO_REFRESH_DAYS: 'CSF sağlayıcı aralıklarını (ip2asn) kendiliğinden yenilemez; dosya bu kadar günden eskiyse lfd\'ye yeniden indirtilir.', k_OWNER_TTL_DAYS: 'Sahip bilgisini yeniden sor (gün)', h_OWNER_TTL_DAYS: 'Bir bloğun sağlayıcı ve ülke bilgisi bu kadar gün saklanır, sonra yeniden sorulur.', k_IMUNIFY_REFRESH_MIN: 'Imunify360 listesini yenile (dakika)', h_IMUNIFY_REFRESH_MIN: 'Imunify360\'ın bu sunucudaki kara listesi bu kadar dakikada bir yeniden okunur.', k_BLOCK_ACTIVE_DAYS: 'Denenen blok eski sayılmaz (gün)', h_BLOCK_ACTIVE_DAYS: 'Banlı bloktan bu süre içinde deneme geldiyse eski blok temizliği onu kaldırmaz.', st_lists: 'Listeler', st_lists_h: 'Eklentinin indirdiği listelerin ne sıklıkla yenileneceği ve indirilemezse ne zaman uyarılacağı.', pv_refresh_n: 'Listeler {0} günde bir yenilenir.', pv_to_lists: 'Ayarlar → Kaynaklar ve yenileme', im_q_ports: 'Port listesiyle banlarsanız ne değişir?', im_q_all: '"Her şey" ile banlarsanız ne değişir?', im_q_ban: 'Bu sağlayıcı şu an banlı ({0}). Son 24 saatte ne geldi?', im_lead: 'Son 24 saatte bu sağlayıcının adreslerinden sitelerinize {0} istek geldi.', im_lead_al: 'Çoğu izinli servislerden; ban onlara dokunmaz.', im_ip_n: '{0} IP', im_req_n: '{0} istek', im_ok_n: '{0} başarılı', im_b_al_t: 'İzinli servisler — ban etkilemez', im_b_al_d: 'CSF izinli servislere bütün banlardan önce izin verir.', im_b_cl_t: 'Kiralık sunucu listesindeki adresler — zaten kapalı', im_b_cl_d: 'Bu adreslerin web portları kiralık sunucu listesiyle ({0}) kapalı.', im_b_cl_seen: 'Son istek: {0}.', im_b_op_t: 'Geri kalan adresler — şu an açık, ban bunları keser', im_b_op_tb: 'Geri kalan adresler', im_b_op_none: 'Bu adreslerden istek gelmedi.', im_b_op_ex: 'En çok: {0}, {1} istek ({2})', im_c_ok: '{0} başarılı', im_c_403: '{0} reddedildi (403)', im_c_404: '{0} bulunamadı (404)', im_c_4: '{0} başka hata (4xx)', im_c_3: '{0} yönlendirildi (3xx)', im_c_5: '{0} sunucu hatası (5xx)', im_v_safe_t: 'Banlamak güvenli görünüyor', im_v_safe: 'Kesilecek {0} isteğin hiçbiri başarılı değil; bilinen bir ziyaretçi ya da entegrasyon kesilmez.', im_v_safe_al: 'İzinli servisler ({0}) çalışmaya devam eder.', im_v_warn_t: 'Dikkat: banlarsanız başarılı istekler de kesilir', im_v_warn: 'Kesilecek {0} isteğin {1} tanesi başarılı. Aşağıdaki açık adresler listesinde kimden geldiğine bakın; tanıdığınız bir servis (ödeme, kargo, pazaryeri) varsa önce İzinli servislere ekleyin.', im_v_none_t: 'Banlamak bir şey değiştirmez', im_v_none: 'Son 24 saatte bu sağlayıcının açık adreslerinden istek gelmedi.', im_h_t: 'Bu sağlayıcıdan gelen ihlaller', im_h_csf: 'CSF içinde bu sağlayıcıdan {0} var.', im_h_last: 'Son ihlal {0}.', im_h_bx: '{0} blok banı (başka kaynaktan)', im_h_ev: 'Olay kaydına göre son {1} günde {0} IP banlandı.', im_h_why: 'En sık sebep: {0}.', im_h_web: 'İhlallerin hepsi web\'e: port listesi (yalnız web) yeterli.', im_h_more: 'Web dışında da ihlal var ({0}). Bunları da kesmek için "Her şey"i seçin ya da ortak port listesine o portları ekleyin.', im_h_none: 'Olay kaydında bu sağlayıcıdan banlanmış IP yok.', im_d_open: 'Açık adresler: banlarsanız kesilecekler', im_d_open_b: 'Geri kalan adresler', im_d_cloud: 'Kiralık listedeki adresler', im_d_fails: 'Reddedilen istek örnekleri', im_d_acodes: 'İzinli servislerin aldığı cevaplar', im_d_afails: 'Reddedilen istek örnekleri (en sık)', im_d_acodes_h: 'Bu cevapları sitelerinizin ya da ModSecurity\'nin izinli botlara verdiği cevaplar oluşturur (ör. yasak sayfa için 403). İhlal değildir; ban bunları değiştirmez.', im_al_h: 'Bu istekler izinli bir servisten geldi: CSF bunlara bütün banlardan önce izin verir.', im_st_temp: 'geçici banlı · {0} kaldı', im_st_temp_h: 'lfd geçici banı: süre dolunca kendiliğinden kalkar.', im_st_deny: 'kalıcı banlı', im_st_deny_h: 'Bu IP csf.deny içinde.', im_st_deny24: 'blok banlı', im_st_deny24_h: 'Bu IP\'nin /24 bloğu csf.deny içinde.', im_st_imu: 'Imunify kara listesinde', im_st_imu_h: 'Imunify360\'ın bu sunucudaki kara listesinde.', im_st_none: 'şu an banlı değil', im_st_none_h: 'csf.deny, geçici banlar ve Imunify kara listesinde yok.', p_t2: '{0} tekil ban', p_g2: '{0} blok banı', p_last2: 'son ihlal {0}', p_svc: 'Servis: {0}', p_svc_rep: '{0} bilinmiyor', p_cl3: '+{0} ban {1} listesinde (zaten kapalı)', p_b2: '+{0} blok banı başka kaynaktan', p_b_h: 'csf.deny içinde CSF Auto-Group dışında eklenmiş aralıklar; sıralamaya girmez.', pv_inlist2: 'Sağlayıcı banında', pv_inlist_h: 'Bu sağlayıcı Sağlayıcı banı listesinde ve CSF\'e yazıldı.', pv_inlist_u: 'Ban listesinde · kaydedilmedi', pv_inlist_uh: 'Sağlayıcılar sekmesinde listeye eklendi ama henüz kaydedilmedi; kaydedince CSF\'e yazılır.', t_cc: 'Ülke: {0} ({1})', t_asn: '{0}: sağlayıcı numarası (ASN) — bu adresleri internete duyuran kuruluş', t_chipn: 'Bu süzgeçteki kayıt sayısı', im_rsn_n: '{0} IP', imr_CAPTCHA_DOS_ALERT: 'Doğrulama (captcha) sayfasını çok sık isteyen adres: DoS benzeri yük', imr_WAF_BRUTEFORCE: 'Web uygulama güvenlik duvarının yakaladığı şifre denemesi', imr_SMTP_BRUTEFORCE: 'Posta şifresi denemesi', imr_SSH_BRUTEFORCE: 'SSH şifre denemesi', imr_FTP_BRUTEFORCE: 'FTP şifre denemesi', imr_PORT_SCAN: 'Port taraması', imr_DOS_ALERT: 'Aşırı bağlantı (DoS benzeri yük)', imr_other: 'Imunify360\'ın engelleme sebebi: {0}', bn_cloud_h: 'Bu sağlayıcının banları bir kiralık sunucu listesinin içinde: o liste zaten kapatıyor.', bn_all_h: 'CC_DENY: bu sağlayıcının bütün adresleri her portta kapalı.', bn_ports_h: 'CC_DENY_PORTS: bu sağlayıcı yalnız bu portlarda kapalı; öteki servisler (SSH, posta…) açık.', dnd_s: 'silinmez', dnd_h: 'Silinmez: csf.deny içinde "do not delete" işaretli. CSF bu banı liste dolsa da ya da süresi geçse de kendiliğinden silmez.', st_tip: 'Bu kaydın bugünkü durumu', k_perm_h: 'csf.deny: CSF\'in kalıcı ban listesi. Sınır csf.conf\'taki DENY_IP_LIMIT; dolunca CSF en eski (silinmez olmayan) satırı siler.', k_temp_h: 'CSF\'in geçici ban listesi. Sınır csf.conf\'taki DENY_TEMP_IP_LIMIT.', kd_tip_up: '{0} {1} arttı', kd_tip_dn: '{0} {1} azaldı', from_log_h: 'Olay kaydı başlamadan önceki bir iş: eklentinin günlük dosyasından okundu. IP ve sebep ayrıntısı olmayabilir.', pv_tile_wait: 'seçili · kaydedince indirilir', pv_tile_off: 'seçili değil', pv_tile_pot_h: 'Olay kaydında banlanmış IP\'lerden {0} tanesi bu listenin adreslerinde: liste açıkken bunlar web\'e hiç ulaşamazdı.', pv_tile_addr_h: 'Listenin indirildiği adresi göster ya da değiştir', st_run: 'Çalışma', st_src: 'Kaynaklar ve yenileme', st_src_h: 'Eklentinin dışarıdan aldığı bilgiler: IP sahipleri, indirilen listeler, CSF\'in ASN verisi ve Imunify360 listesi; ne sıklıkla yenilendikleri.', g_old: 'Eski banlar', k_cron: 'Tur sıklığı', g_blk: 'Blok banı (/24)', g_net: 'Şüpheli ağ (/16)', g_watch: 'İzleme', g_own: 'Sahip sorgusu', g_cl: 'Kiralık sunucu listeleri', g_svc: 'İzinli servis listeleri', g_geo: 'CSF\'in ASN verisi', g_imu: 'Imunify360', g_log: 'Günlük dosyası', k_lines_full: '{0} / {1} satır dolu', pv_exp_h: 'Deneysel: yeni bir katman. Yanlış ayar bir hizmeti kesebilir; sağlayıcı eklemeden önce Etkisini ölç ile deneyin.', lay_on_h: 'Açık: bu katman CSF\'e uygulanıyor.', lay_warn_h: 'Açık, ama dikkat isteyen bir durum var (ör. liste indirilemiyor ya da adresler CSF\'e henüz yüklenmedi); ayrıntı kartın içinde.', lay_off_h: 'Kapalı: bu katman CSF\'e uygulanmıyor.', dep_ok_h: 'Sunucuda kurulu ve eklenti kullanabiliyor.', dep_missing_h: 'Sunucuda bulunamadı: yanında yazan işlev çalışmaz.', upd_new_h: 'Depoda daha yeni bir sürüm var; Güncelle ile kurulur.', l_perm_cover_h: 'Bu IP\'yi kapsayan kalıcı ban: IP\'den gelen her bağlantı engelli.', l_part_h: 'Kısmi ban: yalnız seçilen servisler (portlar) kapalı, diğerleri açık.', terms_h: 'Panelde geçen terimlerin kısa sözlüğü (tekil, blok, ağ, silinmez, kiralık sunucu…)', p_svc_h: 'Bilinmiyor: lfd bu IP\'leri tekrar banı (PERMBLOCK) olarak kalıcıya aldı; o satır servisi söylemez. Servis ilk geçici banın lfd günlüğündeki kaydından okunur; o kayıt günlükte kalmamışsa bilinmez.', 'svs_google-common': 'Googlebot', 'svs_google-common_h': 'Google arama tarayıcısı (Googlebot ve ortak tarayıcılar). Sitelerin Google\'da görünmesi için gerekir.', 'svs_google-special': 'Özel botlar', 'svs_google-special_h': 'AdsBot, Storebot gibi özel Google tarayıcıları (reklam ve alışveriş denetimleri).', 'svs_google-user': 'Kullanıcı istekleri', 'svs_google-user_h': 'Bir kullanıcının tetiklediği Google istekleri (site doğrulama, akış okuyucu…).', 'svs_google-user-google': 'Kullanıcı istekleri (Google)', 'svs_google-user-google_h': 'Google\'ın kendi ağından gelen kullanıcı tetiklemeli istekler.', 'svs_openai-gptbot': 'GPTBot', 'svs_openai-gptbot_h': 'OpenAI\'ın yapay zekâ eğitimi için siteleri tarayan botu. Çok sayıda sayfayı hızla ister; bazı güvenlik araçları ihlal diye raporlar.', 'svs_openai-search': 'Arama botu', 'svs_openai-search_h': 'OAI-SearchBot: sitelerin ChatGPT aramasında görünmesi için gerekir.', 'svs_openai-user': 'ChatGPT kullanıcı istekleri', 'svs_openai-user_h': 'ChatGPT-User: bir kullanıcı ChatGPT\'ye bir sayfayı açtırınca gelen istek. Herkes istediği adrese yönlendirebilir.', pv_ex_except: 'İzinli servislerden hariç tutulanlar', h_SVC_EXCEPT: 'Bu adresler izinli servis listelerinde olsa da izinli sayılmaz; csf.deny\'deki banları çalışır. Satır başına bir IP ya da aralık (ör. 74.7.241.35).', pv_exc_open: 'Önce Sağlayıcılar sekmesini açın.', pv_exc_added: '{0} izinli servislerden hariç tutulacak; Sağlayıcılar sekmesinde kaydedince geçerli olur.', v_allow_ban: 'CSF\'teki banı da işlemiyor.', dr_exc_btn: 'İzinli servislerden hariç tut', dr_exc_h: 'IP izinli servis listesinden çıkarılır; banı çalışmaya başlar. Servisin diğer adresleri izinli kalır.', dr_wl_csfallow: 'İzin csf.allow içindeki bir satırdan geliyor; o satırı kaldırırsanız banlar çalışır.', l_layers: 'Bu IP\'yi kapsayan banlar', l_layers_x: 'Bu IP\'yi kapsayan banlar (şu an etkisiz)', l_who: 'Kim', m_exc_t: '{0} izinli servislerden hariç tutulsun mu?', m_exc_b: 'Bu adres {0} listesinde olduğu için şu an hiçbir ban onu kesmiyor. Hariç tutulunca izinli servis listesi bu adres olmadan yeniden yazılır, CSF yeniden yüklenir ve adresin banları çalışır. Servisin diğer adresleri izinli kalır. Geri almak için: Sağlayıcılar → İzinli servisler → İzinli servislerden hariç tutulanlar.', t_exc_ok: '{0} izinli servislerden hariç tutuldu.', im_bt: 'Bu sağlayıcıdan konmuş banlar (CSF içinde, şu an)', im_bn: 'Bu sağlayıcının adreslerinde {0} ban var: {1}.', im_bl: 'Sonuncusu {0}.', im_bk_p: '{0} kısmi ban', im_bo: '{0} tanesi başka hiçbir şeyin kapatmadığı adreslerde: bu banlar iş görüyor.', im_bc: '{0} tanesi kiralık sunucu listesinin ({1}) içinde: o liste bu adresleri web\'de zaten kapatıyor.', im_ba: '{0} tanesi izinli servis adresinde ({1}): bu banlar etkisiz, çünkü CSF izni bandan önce uygular. Kesmek için IP kartından "İzinli servislerden hariç tut".', im_bs: 'İhlal edilen servisler: {0}', svc_unknown: 'bilinmiyor', im_bd: 'Banlar tek tek', im_bd_n: 'en yeni {0} / {1}', im_bi_open: 'ban işliyor', im_bi_open_h: 'Bu adresi başka bir katman kapatmıyor; CSF\'teki banı onu kesiyor.', im_bi_cloud: '{0} listesinde', im_bi_cloud_h: 'Bu adres kiralık sunucu listesinde; web portları o listeyle zaten kapalı.', im_bi_allow: 'izinli ({0}) · etkisiz', im_bi_allow_h: 'Bu adres izinli servis listesinde: CSF izni bandan önce uyguladığı için ban işlemiyor.', im_v_hist_t: 'Şu an kesilecek trafik yok, ama bu sağlayıcıdan ihlal geliyordu', im_v_hist: 'Son 24 saatte açık adreslerinden istek gelmedi; ama {0} adresi ayrı ayrı banlanmış (sonuncusu {1}). Banlarsanız yeni adreslerinden gelecek ihlaller da baştan kapanır; izinli servisler etkilenmez.', col_net: 'Ağ / blok', col_why: 'Neden', col_marked: 'İşaretlendi', col_marked_h: 'Şüpheli ağ ve atlanan blokta eklentinin aralığı en son işaretlediği zaman; izinli / yoksayılan / sunucu IP\'si satırında kontrol süresindeki ilk kayıt (son kayıt not satırında). Satır kontrol süresi boyunca listede kalır.', r_gone: 'bu uyarının dayandığı tekil banlar artık CSF\'te yok', col_ip: 'IP', col_host: 'Ters DNS', col_reason: 'Sebep', col_until: 'Yoksayma bitişi', col_by: 'Yoksayan', col_req: 'İstek', col_now: 'Şu an', col_ban: 'Ban', col_banned: 'Konduğu zaman · sebep', s_ignored_h: 'Kontrol edilecekler\'den sizin yoksaydığınız aralıklar. Bitiş tarihine kadar listede görünmezler; yeniden ihlal gelirse o tarihten sonra yine işaretlenirler.', r_perm: '{0} kalıcı', r_temp: '{0} geçici', r_gone_s: 'tekil ban kalmadı', l_perm_single_h: 'Bu IP\'nin kendisi csf.deny\'de kalıcı banlı (tekil ban): bütün portlar kapalı. Altta CSF\'teki satırı görebilirsiniz.', evh_digest: 'Eklentinin haftalık özet mailini/bildirimini gönderdiği an. İçeriği Ayarlar → Bildirim\'deki "Özeti önizle" ile görülür.', r_svc_unk: 'servis bilinmiyor', rg_k16: 'Ağ (/16) · 65.536 adres', rg_k24: 'Blok (/24) · 256 adres', rg_kp: 'Duyurulan aralık ({0})', rg_cover: 'Aralığın tamamı banlı: {0}', rg_cover_h: 'Bu aralığı içine alan bir ban var: aralıktaki her adres, bütün portlarda kapalı.', rg_part: 'Bu aralığın kısmi banı: {0} kapalı', rg_layers: 'Aralığın tamamına uygulanan engeller', rg_by_part: 'bu aralığın kısmi banı', rg_v_full: 'Sonuç: aralığın tamamı banlı ({0}). İçinden gelen her bağlantı kapalı.', rg_v_part: 'Sonuç: aralık kısmi banlı. Aşağıdaki engellerin portları bütün aralık için kapalı; diğer servisler yalnız tek tek banlı IP\'lere kapalı.', rg_v_none: 'Sonuç: aralığın kendisi banlı değil. İçindeki banlı IP\'ler ve bloklar tek tek kapalı; aralıktan yeni bir IP gelirse bütün servislere ulaşabilir.', rg_sv: 'İhlal edilen servisler', rg_c_svc: 'Servis', rg_c_ips: 'İhlal eden IP', rg_sv_closed: 'kapalı', rg_sv_closed_h: 'Bu servis bütün aralık için kapalı: {0}.', rg_sv_open: 'açık', rg_sv_open_h: 'Bu servis aralığın geneli için açık: yalnız tek tek banlanmış IP\'ler kesiliyor, aralıktan yeni bir IP gelirse ulaşır.', rg_sv_unk: 'servis bilinmiyor', rg_q_full: 'Kontrol edilecek bir şey yok.', rg_q_noatt: 'Bu aralıktan kayıtlı ihlal yok.', rg_q_open: 'Bakılacak olan: {0} aralığın geneli için açık. İhlal sürüyorsa aralığı (ya da yalnız bu servisleri) banlayın; tek seferlikse tek tek banlar yeter.', rg_q_closed: 'İhlal edilen bütün servisler aralığın tamamı için zaten kapalı; banlamanın ek etkisi olmaz.', rg_in: 'Aralığın içindeki banlar', rg_in_blk: '{0} blok banı', rg_in_oth: '{0} başka CSF satırı (aralık banı)', rg_in_sgl: '{0} tekil ban (her biri o IP\'yi tamamen kapatır)', rg_in_tmp: '{0} geçici ban', rg_in_wat: '{0} izlenen blok', rg_in_part: '{0} kısmi ban (daha dar aralıklarda)', rg_in_port: '{0} port kuralı', rg_in_none: 'Bu aralıkta ban yok.', rg_sgl_t: 'Tekil banlar', rg_sgl_tt: 'Tekil ve geçici banlar', rg_rv: '{0} olarak işaretli ({1}).', rg_rv_ips: 'Şu an banlı olmayan IP\'ler', rg_self_l: 'Sunucunun kendisi', rg_cloud: 'Aralık {0} kiralık sunucu listesinde · kapalı: {1}', rg_cloud_h: 'Bu aralığın tamamı bu kiralık sunucu listesinde; listedeki portlar aralığın her adresi için kapalı.', rg_ccp: 'Sağlayıcı banı ({0}) · kapalı: {1}', rg_ccp_h: 'Aralığın tamamı CSF\'te port listesiyle banlı bir sağlayıcının duyurduğu aralıkta; listedeki portlar her adres için kapalı.', rg_own: 'Bu aralığın banı: {0}', rg_added: '{0} eklendi ({1})', rg_gn: '{0} tekil ban üzerine konmuş', rg_noev: 'Banın dayandığı ihlallerin ayrıntısı kayıtlarda yok (olay kaydından önce konmuş).', rg_q_full_att: 'Yukarıdaki ihlallerin hepsi kesiliyor; yapılacak bir şey yok.', rg_in_none_own: 'Bu aralığın kendi banından başka ban yok: içindeki tekiller blok banı konunca CSF\'ten temizlendi (yerlerini bu ban tutuyor).', v_wl_svc: 'izinli servis {0} ({1})', ab_b: 'Ban işlemiyor', ab_i: 'lfd yoksaydı', ab_g: 'İzinli aralık', ab_b_h: 'Ban işlemiyor: lfd bu IP\'yi banladı ama IP izin listesinde (csf.allow ya da Include ettiği bir dosya). CSF izni bandan önce uyguladığı için IP sunucuya ulaşıyor. CSF\'in IGNORE_ALLOW ayarı 0 (varsayılan) olduğunda böyle olur. Ayrıntı: Terimler.', ab_i_h: 'lfd yoksaydı: lfd bu IP\'nin başarısız denemelerini gördü ama banlamadı, çünkü IP izin listesinde ve CSF\'in IGNORE_ALLOW ayarı 1. Elle banlasanız da izin bandan önce gelir. Ayrıntı: Terimler.', ab_g_h: 'İzinli aralık: aynı izin kaydının içinden birden çok IP ihlal ediyor; karar tek tek IP\'ler değil o kayıt hakkında. İzinli servisse aralığı hariç tutabilirsiniz. Ayrıntı: Terimler.', ab_b_n: 'lfd banladı ama ban işlemiyor; izin: {0}.', ab_i_n: 'lfd denemeleri saydı ama banlamadı; izin/yoksayma: {0}.', ab_g_n: 'Bu izin kaydının içinden ihlal ediyorlar: {0}. İhlal sürüyorsa aralığı izinli servislerden hariç tutun; servisin diğer listeleri izinli kalır.', ab_own: 'Bu izni siz eklediniz: banın işlemesini istiyorsanız {0} dosyasından kaldırın.', ab_y_n0: 'lfd denemeleri saydı ama banlamadı; yoksayma {0}.', ab_src_none: 'kaynak bulunamadı — IP sunucunun adreslerinde, csf.allow, csf.ignore, GLOBAL_IGNORE, CC_IGNORE, RELAYHOSTS ve csf.rignore\'da değil', ab_s: 'Sunucu IP\'si', ab_s_h: 'Sunucunun kendi IP\'si: lfd bu adresten gelen başarısız denemeleri saydı ama banlamadı, çünkü adres sunucunun kendi IP\'lerinden biri; lfd kendi adreslerini her zaman yoksayar (ignoreip, ayardan bağımsız). Denemeler sunucunun içinden geliyor; posta günlüğünde hangi hesapla yapıldığı görünüyorsa satırda yazar. Bu IP banlanamaz. Ayrıntı: Terimler.', ab_s_n: 'lfd denemeleri saydı ama banlamadı: {0} bu sunucunun kendi adresi; lfd kendi adreslerini her zaman yoksayar. Banlanamaz.', l_acct: 'Denemeler', l_acct_h: 'Bu IP\'nin günlüklerde yanlış şifreyle denediği hesaplar ve ModSecurity\'nin engellediği web adresleri, deneme sayısıyla; lfd\'nin saydığı satırlardan. Kaynak csf.conf\'taki SMTPAUTH_LOG, POP3D_LOG, IMAPD_LOG, SSHD_LOG, FTPD_LOG, CPANEL_LOG, HTACCESS_LOG ve MODSEC_LOG dosyaları; yalnız Kontrol edilecekler süresi içindeki satırlar.', ac_mail: 'denenen posta hesapları: {0}', ac_ssh: 'denenen SSH kullanıcıları: {0}', ac_ftp: 'denenen FTP hesapları: {0}', ac_cp: 'denenen cPanel/WHM girişleri: {0}', ac_htp: 'denenen web şifresi kullanıcıları: {0}', ac_web: 'hedef: {0}', pb_svc: 'önceki ban: {0}', why_pb: 'Tekrar ban (PERMBLOCK): lfd LF_PERMBLOCK_INTERVAL içinde LF_PERMBLOCK_COUNT\'tan fazla geçici ban alan IP\'yi kalıcıya aldı', ab_s_acct: 'Posta sunucusuna sunucunun içinden bu hesaplarla yanlış şifre denendi ({0}): {1}.', ab_cnt: '{0} kez', asn_bar_atk: 'Çubuk: sıralama ağırlığı (blok banı ×4 + tekil ban); açık renkli bölüm elle ya da başka araçla eklenen aralıklar.', asn_bar_blk: 'Çubuk: csf.deny\'deki aralık sayısı.', asn_bar_im: 'Çubuk: Imunify360\'ın engellediği IP sayısı.', asn_hint_h: 'En az 5 blok banı olan (en az 15 tekil, 5 ayrı blok) ve sağlayıcı banında olmayan sağlayıcıda gösterilir.', dot_bad: 'Hatalı alan var; düzeltilmeden kaydedilemez.', dot_warn: 'Eksik araç var (Sunucu bölümünde).', dot_dirty: 'Kaydedilmemiş değişiklik var.', dot_upd: 'Yeni sürüm var.', save_bad_in: 'hata: {0}', dry_s_act: 'Bu tur şunları yapardı', dry_s_none: 'Bu tur hiçbir ban koymaz, kaldırmaz.', dry_s_mail: 'Gönderilecek bildirimler', dry_s_prob: 'Sorunlar', dry_s_round: 'Tur özeti', dry_s_raw: 'Ham çıktı', pv_imp_cancel: 'Vazgeç', pv_imp_cancel_h: 'Bekleme kapanır; ölçüm sunucuda en çok bir dakika daha sürer, sonucu gösterilmez.', r_aa: '{0} tanesi izin ya da yoksayma listesinde: lfd banlamadı ya da banı işlemiyor (IP listesinde işaretli)', po: 'Açık servis', po_h: 'Açık servis: bu aralığın kısmi banı yalnız seçilen servisleri kapatıyor; ban konduktan sonra açık kalan servislere blok ya da ağ eşiği kadar ihlal geldi. Ayrıntı: Terimler.', po_n: 'Kısmi ban yalnız {0} kapatıyor; Neden sütunundaki servislere ban konduktan sonra ihlal geldi. Banı değiştirip bu servisleri de kapatabilirsiniz.', ab_y: 'Yoksayılıyor', ab_y_h: 'Yoksayılıyor: lfd bu IP\'nin başarısız denemelerini gördü ama banlamadı, çünkü IP yoksayılanlarda (csf.ignore, GLOBAL_IGNORE, csf.rignore, CC_IGNORE ya da RELAYHOSTS; satırda hangisi olduğu yazar). Yoksayma güvenlik duvarında izin değildir: CSF bu IP\'yi tek başına banlamaz ama içinde olduğu blok banlanırsa kesilir (ölçüldü). Ayrıntı: Terimler.', ab_y_n: 'lfd denemeleri saydı ama banlamadı; yoksayma: {0}. CSF bu IP\'yi tek başına banlamaz; bloğunu banlarsanız kesilir.', ab_y_own: 'lfd\'nin bu IP\'yi kendiliğinden banlamasını istiyorsanız {0} dosyasından kaldırın.', dr_rv_cnt: 'Son {1} günde {0} kez.', rg_aa: 'Bu aralıkta izinli ama ihlal eden {0} IP var (ban işlemiyor ya da lfd yoksaydı); Kontrol edilecekler\'de görünür.', ab_last: 'Son kayıt: {0} ({1}).', rv_drop_try: 'Yeni deneme gelmezse {0} tarihinde listeden kendiliğinden düşer.', rv_drop_warn: 'Yeni uyarı gelmezse {0} tarihinde listeden kendiliğinden düşer.', rv_drop_viol: 'Açık servislere yeni ihlal gelmezse {0} tarihinde listeden kendiliğinden düşer.', im_b_cdn_t: 'CDN arkasındaki sitelere — ban etkilemez', im_b_cdn_d: 'Bu siteler (ya da www adları) {0} üzerinden geliyor: güvenlik duvarı bu isteklerin ziyaretçisini değil CDN\'i görür, ban onları kesmez. Kesmek için {1} panelinde IP ya da ASN engeli kullanın.', im_cdn_other: 'başka adres', im_v_cdn: 'CDN arkasındaki sitelere gelen {0} istek bu karardan bağımsız: güvenlik duvarı onları görmez.', k_SAYAC_RETENTION_DAYS: 'İzleme süresi (gün)',
      h_SAYAC_RETENTION_DAYS: 'Geçici banlanmış bir blok bu süre içinde tekrar gelirse kalıcı olur.', k_REVIEW_DAYS: 'Listede kalma süresi (gün)',
      h_REVIEW_DAYS: 'Kontrol edilecekler listesindeki bir satırın, son kaydından sonra kaç gün kalacağı: şüpheli ağlar, atlanan bloklar, izinli / yoksayılan / sunucu IP\'si satırları ve açık servisler. Bu sürede yeni kayıt gelmezse satır kendiliğinden düşer.', k_LOG_KEEP_DAYS: 'Günlük saklama süresi (gün)', h_LOG_KEEP_DAYS: 'Günlükte bu kadar günden eski satırlar silinir (yalnız logrotate yoksa).', k_EVENTS_DAYS: 'Geçmiş saklama süresi (gün)', h_EVENTS_DAYS: 'Banlar, uyarılar, elle işlemler ve ayar değişiklikleri bu kadar gün tutulur. Aktif bir aralık banının dayandığı ihlaller de buradan okunur; süre kısalırsa eski banların sebebi görünmez.', k_RUN_DAYS: 'Tur kayıtları saklama süresi (gün)', h_RUN_DAYS: 'Her turun kaydı (süre, liste doluluğu) bu kadar gün tutulur. Özet kartlarının 30 gün önceyle karşılaştırması ve haftalık özetteki tur sayımı buradan okunur; en az 31 gün.', g_keep: 'Kayıt saklama', keep_now: 'Şu an {0} olay (en eskisi {1}) · {2} tur kaydı (en eskisi {3}) · {4}.',
      st_csf: 'CSF liste sınırları', st_csf_h: 'Bunlar CSF\'in kendi ayarları; buradan değil CSF\'ten değiştirilir.',
      csf_deny: 'Kalıcı liste (DENY_IP_LIMIT)', csf_temp: 'Geçici liste (DENY_TEMP_IP_LIMIT)', csf_open: 'CSF ayarlarını aç',
      default_v: 'varsayılan {0}', range_v: '{0}–{1} arası bir tam sayı', mail_bad: 'Geçerli bir e-posta adresi yazın.',
      rule_dnd: 'Silinmez ban eşiği, blok banı eşiğinden küçük olamaz.', dirty_n: '{0} değişiklik kaydedilmedi', discard: 'Vazgeç',
      try_save: 'Kaydetmeden önce dene', save: 'Kaydet', m_save_t: 'Ayarlar kaydedilsin mi?', m_save_b: 'Şu değişiklikler kaydedilecek (önceki ayar yedeklenir). Sağlayıcı ayarları hemen, diğerleri bir sonraki turda uygulanır:',
      m_try_t: 'Yeni eşiklerle deneme turu', m_try_b: 'Kaydedilmemiş ayarlarla; hiçbir şey değişmez.',
      auto: 'otomatik', focus_gone: '{0} artık listede değil; güncel durumu gösteriliyor.',
      new_badge: 'Son ziyaretinizden beri yeni', new_rec: 'Son ziyaretinizden beri yeni kayıt ({0}); İşaretlendi sütunu ilk kaydı gösterir.', actions: 'İşlemler', overdue: 'Tur gecikti · son tur {0} (beklenen aralık {1})',
      since_visit: 'Son ziyaretinizden beri ({0}):', sn_add: '{0} blok banı', sn_temp: '{0} geçici blok banı', sn_warn: '{0} şüpheli ağ',
      sn_skip: '{0} atlanan blok', sn_aviol: '{0} izinli IP\'den ihlal kaydı', sn_po: '{0} açık servis kaydı', sn_gone: '{0} eklenti dışında kaldırılan blok banı', show_new: 'Göster', e_new: 'Son ziyaretten beri', ch_total: '{0} olay', ch_title_n: 'Son {0} gün', ch_d: '{0} gün', sb_ok: 'Koruma çalışıyor', sb_run: 'Tur çalışıyor', sb_late: 'Turlar zamanında çalışmıyor', sb_every: 'Cron her {0}', sb_24: 'son 24 saatte {0}/{1} tur', sb_none: 'henüz tur yok', sb_last: 'Son tur', sb_dur: 'Tur süresi', sb_avg: 'ort. {0}', sb_next: 'Sıradaki', sb_now: 'şimdi', sb_spark: 'Son {0} turun süresi', pg_prev: 'Önceki sayfa', pg_next: 'Sonraki sayfa', dirty_leave: '{0} değişiklik kaydedilmedi', dirty_leave_b: 'Sekme değiştirilirse kaydedilmemiş değişiklikler kaybolur. Kalıp Kaydet ile saklayabilir ya da vazgeçip devam edebilirsiniz.', dirty_go: 'Kaydetmeden geç', conn_net: 'Sunucuya ulaşılamıyor; gösterilenler {0} alındı. Yeniden deneniyor…', conn_session: 'Oturumun süresi doldu.', upd_busy: 'Bir güncelleme zaten çalışıyor.', sec: '{0} sn', lk_recent: 'Son bakılanlar',
      ch_add: 'Blok banı', ch_promote: 'Tekrar geldi, kalıcı', ch_temp: 'Geçici blok banı', ch_warn: 'Şüpheli ağ', ch_skip: 'Atlandı',
      ch_empty: 'Son {0} günde kayıt yok; grafik olay kaydı biriktikçe dolacak.', ipcard: 'IP kartı', col_block: 'Blok', col_owner: 'Sahip', col_since: 'Başlangıç', col_left: 'Kalan izleme', col_state: 'Durum', left_short: '{0} kaldı',
      col_singles: 'Tekil', col_added: 'Eklendi', sort_by: 'Sırala', of_n: '{0}–{1} / {2}', s_asn: 'En çok engellenen sağlayıcılar', s_asn_ban: 'Banlı sağlayıcılar',
      s_asn_h: 'lfd\'nin tekil banları ve eklentinin blok banları, sağlayıcıya göre (sahibi sorgulanmış {0} bloktan sayılır)', p_g: '{0} blok', p_b: '+{0} blok CSF Auto-Group dışından', p_t: '{0} tekil', p_bn: '{0} blok',
      at_atk: 'İhlaller', at_blk: 'Elle / başka araçla', blk_h: 'csf.deny\'ye eklenti dışında eklenmiş aralıklar (sizin elle eklediğiniz ya da başka bir aracın eklediği), sağlayıcıya göre. Bu aralıklar zaten banlı; sağlayıcının geri kalanı açık.',
      blk_empty: 'csf.deny\'de CSF Auto-Group\'un eklemediği aralık yok (ya da sahipleri henüz bilinmiyor).',
      im_h: 'Imunify360\'ın bu sunucuda kendi engellediği IP\'ler (merkezi liste değil), sağlayıcıya göre; sahibi sorgulanmış {1} / {0} IP\'den sayılır. Imunify360\'ın listesi değiştirilmez.',
      im_n: '{0} IP', im_empty: 'Imunify360 yerel kara listesi boş.', asn_pban: '{0} banlı; açık servislere ihlal sürüyor', asn_pban_h: 'Bu sağlayıcı port listesiyle banlı; burada sayılan ihlaller listenin açık bıraktığı servislere (ör. SSH, posta). Sürerse o portları ekleyin ya da her şeyi banlayın.', asn_denied: 'CSF\'de zaten engelli',
      asn_hint: 'Sağlayıcı banı önerisi', asn_filling: 'Sahip bilgileri toplanıyor; her turda 50 blok sorgulanır.',
      asn_nolookup: 'Sahip sorgusu kapalı (Ayarlar → Kaynaklar ve yenileme).', m_asn_t: 'AS{0} sağlayıcısını toptan banlamak',
      m_asn_b: '{1} sağlayıcısından {0} ayrı blok banı eklendi; her biri aynı blokta en az {2} ihlal eden IP demek. İhlal sürekli bu sağlayıcıdan geliyorsa sağlayıcının (ASN) tamamını banlamak, blokları tek tek banlamaktan daha kalıcı olur.',
      m_asn_w: 'Bu, o sağlayıcıdaki meşru kullanıcıları da (ör. orada çalışan ödeme ya da izleme servislerini) engelleyebilir. Önce etkisini ölçün; adreslerini yayımlayan servisleri İzinli servislerden açık tutabilirsiniz.',
      m_asn_s: 'Sağlayıcılar sekmesinde listeye eklenir ve son 24 saatte bu sağlayıcıdan sitelere gelen istekler ölçülür. Kaydedene kadar hiçbir şey uygulanmaz.',
      edit: 'Düzenle', st_digest: 'Haftalık özet',
      st_digest_h: 'Seçilen gün 09:00\'dan sonraki ilk turda gönderilir: yeni blok banları, en çok engellenen sağlayıcılar, izlemesi bitecek bloklar.',
      st_digest_day: 'Gönderim günü', d1: 'Pzt', d2: 'Sal', d3: 'Çar', d4: 'Per', d5: 'Cum', d6: 'Cmt', d7: 'Paz',
      digest_prev: 'Özeti önizle', m_digest_t: 'Haftalık özet önizlemesi', ev_digest: 'Haftalık özet'
    },
    en: {
     
      dry: 'Dry run', dry_h: 'Shows what a run would do without changing anything.', sb_last_h: 'Run: each time the plugin scans the bans and acts on them (on a cron schedule).', sb_fetched: 'Status data fetched at {0}.', sb_updating: 'updating…', run: 'Run now', run_log: 'Run output',
      upd_avail: '<b>Update available:</b> v{0} → v{1}', upd_commits: '{0} changes', upd_show: 'View changes', upd_hide: 'Hide',
      upd_apply: 'Update', upd_dirty: 'The server copy has local changes; update over SSH. Run git status in the install folder to see what changed.',
      upd_diverged: 'The server copy has diverged from GitHub; update over SSH. Run git status in the install folder to see the state.',
      k_perm: 'Permanent list', k_temp: 'Temp list', k_groups: 'Active range bans', k_review: 'Needs review',
      k_lines: '{0} / {1} lines', k_nolimit: 'no limit set', k_dnd: '{0} marked do not delete', k_review_m: 'last {0} days',
      s_review: 'Needs review', s_review_h: 'What the plugin did not ban on its own and leaves to you: networks with violations from many blocks (suspicious range), blocks skipped because they overlap a whitelist, and IPs whose ban does not work because they are in an allow list. The Why column says how many IPs hit which service; click the IP count to see them one by one. Ban it, or ignore it from the ⋯ menu.',
      s_groups: 'Active range bans', s_events: 'Recent actions', s_lookup: 'Look up an IP', s_pending: 'Watched',
      s_pending_h: 'Blocks that got a temp block ban once. If {0} temp bans come from the same block again within the watch period, the block is banned permanently (do not delete).', s_ignored: 'Ignored', s_config: 'Rules',
      lookup_ph: '185.220.101.12', lookup_btn: 'Look up', lookup_hint: 'Hostname, owner (ASN), announced range, registry and status in the CSF lists.',
      f_all: 'All', f_perm: 'Permanent', f_dnd: 'Do not delete', f_temp: 'Temp', f_manual: 'Manual', g_search: 'CIDR, AS or org',
      e_all: 'All', e_bans: 'Bans', e_warn: 'Suspicious', e_skip: 'Skipped', e_aviol: 'Allowed-IP violations', e_po: 'Open service', e_manual: 'Manual', e_clean: 'Cleanup', cf_all: 'All', cf_config: 'Settings changes', cf_test_mail: 'Test emails', cf_digest: 'Weekly summaries',
      ev_add24: 'Block ban', ev_promote: 'Came back, permanent', ev_temp24: 'Temp block ban', ev_skip_wl: 'Skipped', ev_allow_viol: 'Violation from allowed IP', av_d: '{0} · {1} times in the last 24 hours', ev_part_open: 'Open service', po_d: 'closed: {0} · {1} violations on the open services since the ban', ev_warn16: 'Suspicious network',
      ev_warn16t: 'Suspicious network', ev_clean_temp: 'Temp ban removed', clean_d: 'already in the permanent list (single or inside a block ban)', ev_manual_ban: 'Manual ban', ev_manual_unban: 'Removed',
      ev_manual_forget: 'Unwatched', ev_manual_ignore: 'Ignored', ev_manual_unignore: 'Unignored',
      kind_perm: 'permanent', kind_promoted: 'came back, permanent', kind_temp: 'temp', kind_manual: 'manual', kind_perm_h: 'Permanent block ban: added once enough permanent single (one-IP) bans piled up in the block.', kind_promoted_h: 'Came back, permanent: got a 12-hour temp block ban first, then violated again within the watch period and was banned permanently.', kind_temp_h: 'Temp block ban: lifted when it expires; becomes permanent if the block comes back within the watch period.', kind_manual_h: 'Manual: added from the plugin.', g_hit: 'last attempt: {0} (the ban dropped it)', kind_dnd_h: 'do not delete: CSF keeps this ban even when the list is full.', evh_add24: 'Block ban: enough permanent single bans piled up in the block (/24), so it was banned permanently and the singles removed.', evh_promote: 'Came back, permanent: a block that had a temp block ban violated again within the watch period, so it was banned permanently.', evh_temp24: 'Temp block ban: enough temp single bans piled up in the block, so it was banned for 12 hours and is now watched.', evh_skip_wl: 'Skipped: reached the ban threshold but overlaps a whitelist entry, so it was not banned.', evh_part_open: 'Open service: the range\'s partial ban closes only the chosen services; since it went in, the services left open took violations up to the block or network threshold. The review row goes when the range is banned; this record stays (one per range per day).', evh_allow_viol: 'Violation from allowed IP: an allowed, ignored or server-own address tripped an lfd rule; lfd did not ban it or the ban did not apply. The review row goes when the review period ends; this record stays (one per IP per day).', evh_warn16: 'Suspicious network: single bans (permanent and temp) piled up across several blocks of the network (/16). Networks are never banned; worth a look.', evh_warn16t: 'Suspicious network: temp single bans piled up across several blocks of the network (/16). Networks are never banned; worth a look.', evh_clean_temp: 'Temp ban removed: the IP was already in the permanent list, so its temp ban was redundant.', evh_expire: 'Old block removed: it was older than the old block ban limit.', evh_manual: 'Manual action: done by someone from the plugin.', rep_h: 'This network was flagged as suspicious on {0} separate days recently.', p_why: 'Temp block ban: {0}', p_why_none: 'reason not recorded (watched since before the event log started)', cov_info: '{0} · added {1}', cov_why: 'Ban reason: {0}', own_why: 'This IP: {0}', asn_why: 'most often: {0}',
      ips: 'IPs', hide: 'Hide', ban16: 'Ban network (/16)', ban24: 'Ban block (/24)', mode_h: 'What to block', chg16: 'Change ban (/16)', chg24: 'Change ban (/24)', ban24_full: 'Ban the whole block (/24)', ban24_full_h: 'The network has a partial ban ({0} blocked); this blocks every service for the block.', ban24_perm: 'Ban the block permanently (/24)', st_ban: 'banned now', st_part: 'partially banned now', st_cov: 'inside the {0} ban', st_review: 'in Needs review', st_watch: 'watched', st_ign: 'ignored (until {0})', st_unbanned: 'no longer banned', st_left: 'no longer in Needs review', goto: 'Show in Overview', r_mix: '{0} permanent · {1} temp', imp_same: 'Nothing would change for the current entries; the effect shows on bans that come in from now on.', imp_up: 'A higher threshold doesn\'t remove existing bans; from now on more single bans are needed for the same result.', h_part_sug: 'Violations from this range only target: {0}. A partial ban that blocks just these, without cutting the rest of the range, may be enough.', h_part_go: 'Switch to selected services', svc_other: 'other', svc_repeat: 'banned repeatedly', svc_scan: 'port scan', ub_info: 'added {0} · {1}', ub_info0: 'added {0}', ub_since: 'Since this partial ban was added, new bans came from the same range to other services: {0}. A full ban may fit better.', l_blk: 'Block status', blk_left: 'This block has {0} single bans; the threshold is {1}. {2} more and the block is banned automatically.', blk_over: 'This block has {0} single bans, over the threshold ({1}): it should be banned on the next run. If it is whitelisted it is not banned and shows up in Needs review as skipped.', blk_tleft: 'The temp list has {0} IPs from this block; the threshold is {1}. {2} more and the block gets a temp ban.', blk_tover: 'The temp list has {0} IPs from this block, over the threshold ({1}): it should get a temp ban on the next run (unless whitelisted).', imp_b: 'At this value, about {0} more blocks would be banned from the current single bans.', imp_n: 'At this value, about {0} more networks would be reported as suspicious from the current single bans (permanent and temp).', imp_tb: 'At this value, about {0} more blocks would get a temp ban from the current temp bans.', r_narrow: '{1} of {2} singles are in {0}; banning that block instead of the whole network may be enough.', r_svc: 'violations: {0}', svc_att_h: '{0} IPs hit this service (from ban reasons)', h_no_att: 'No violation reasons are recorded for this range; pick the services to block.', h_att_pre: 'Services this range hit are selected: {0}.', h_scan: 'Port scans from this range are recorded too ({0} IPs); "Everything" may fit better.', h_exc_att: 'Some of the services you keep open were hit from this range: {0}.', h_exc_pick: 'Pick the services to keep open; services hit are not preselected.', sum_close: 'Blocked', sum_open: 'Stays open', sum_all_close: 'everything from and to this range', sum_all_open: 'nothing', sum_svc_close: 'connections from this range to: {0}', sum_svc_open: 'everything else, including connections from this server to the range', sum_exc_close: 'everything else from and to this range', sum_none: 'nothing selected yet', sum_dns2: 'DNS (both directions)', mode_all: 'Everything', mode_svc: 'Selected services', mode_exc: 'Everything except', md_all: 'All connections from and to the range are cut.', md_svc: 'Only connections from the range to the services you pick are blocked; everything else stays open. Connections from this server to the range (mail, DNS, web requests) are not affected.', md_exc: 'The range is cut completely and the services you pick stay open. Two-way allow lines are added to CSF for each; they are removed with the ban.', svc_h_block: 'Services to block', svc_h_in: 'Keep open · from this range', svc_h_out: 'Keep open · from this server to the range', svc_sync_s: 'mail sync', svc_min_s: 'incoming mail', p_last: 'last violation {0}', svc_web: 'Web', svc_ssh: 'SSH', svc_ftp: 'FTP', svc_cp: 'cPanel · WHM · Webmail', svc_min: 'Incoming mail', svc_sync: 'Mail sync', svc_dns: 'DNS', svc_mout: 'Outgoing mail', svc_wout: 'Outgoing web', svc_pasv: 'passive {0}', svc_ports: 'port {0}', svc_x_svc: 'Other ports', svc_x_exc: 'Other ports (inbound)', svc_x_ph: 'e.g. 8080, 30000-35000', h_dns_mail: 'Mail may also need DNS: if this server also hosts the DNS for its domains, other mail servers may look up the MX record here before delivering, and the SPF, DKIM and DMARC records when receiving your mail. With DNS closed, mail may be delayed or not arrive at all.', h_dns_web: 'Web may also need DNS: crawlers and visitors in this range may resolve your domains on this server\'s DNS before connecting.', h_cp_exc: 'Addresses like cpanel.example.com work through the web port (443); select Web too to keep them open.', h_cp_svc: 'cPanel, WHM and Webmail can also be reached through the web port (443) via addresses like cpanel.example.com; select Web too to block them completely.', h_dns_blk: 'Blocking DNS may also affect mail and visits from this range if this server hosts the DNS for its domains.', h_ftp_nopasv: 'FTP\'s passive port range wasn\'t found; add it to "Other ports" (e.g. 30000-35000) so transfers work too.', h_chg_restore: 'Switching to a partial ban restores the {0} entries removed when this ban was added, since a partial ban doesn\'t cover the whole range.', m_svc_t: 'Block the selected services for {0}?', m_svc_b16: 'Connections from the 65,536 addresses in the network to the services you pick are blocked. The ban is added as "do not delete" and is kept even when the list is full.', m_svc_b24: 'Connections from the 256 addresses in the block to the services you pick are blocked. The ban is added as "do not delete" and is kept even when the list is full.', m_chg_t: 'Change ban: {0}', chg_btn: 'Change', chg: 'Change ban', in_clean_na: 'Covered entries stay', in_clean_na_d: 'A partial ban doesn\'t cover the whole range, so the bans inside stay; they block the other services too.', in_part: 'Partial bans', in_part_repl: 'replaced', in_watch_keep: 'still watched', kind_partial: 'partial', kind_partial_h: 'Partial ban: only connections from this range to the selected services are blocked; everything else is open.', f_partial: 'Partial', g_closed: 'blocked: {0}', g_open: 'open: {0}', l_part_net: 'Partial (network)', l_part_blk: 'Partial (block)', l_part_rng: 'Partial (/{0})', l_part_d: 'blocked: {0} · from this range; other connections open', l_open: 'kept open: {0}', ev_svc: 'partial · blocked: {0}', ev_exc: 'open: {0}', ev_full: 'full ban', ev_manual_change: 'Ban changed', terms: 'Terms', terms_t: 'Terms', s_groups_h: 'Range bans in CSF now (block /24, network /16, announced range and partial bans): the ones the plugin added and the ones you added from the panel. Single bans are not counted.', pv_intro: 'Most violations come from servers cloud companies rent out. Block Rented servers first; if that isn\'t enough, ban a provider\'s whole network. Allowed services come before both.', pv_cl_redund: '{0}% of the addresses CSF loaded for this provider are in the {1} list: those rented servers are already blocked, so this provider ban may no longer be needed.', pv_cl_part: '{0}% of its addresses are in the {1} list.', lim_shown: 'Showing {0} of {1}', lim_more: 'Show more', lim_all: 'Show all', lim_less: 'Show less', at_im: 'Imunify360', at_atk_s: 'lfd\'s and the plugin\'s bans', at_blk_s: 'added to csf.deny by hand or another tool', at_im_s: 'what Imunify360 blocked itself', at_ban_s: 'in the provider ban or a rented-server list', p_cl2: '{0} in the {1} list', asn_why0: 'no reason recorded', at_ban: 'Banned', ban_empty: 'No banned providers.', ban_h: 'Providers in the provider ban, or whose bans all fall in a rented-server list; they\'re left out of the other tabs\' rankings.', ev_grp_n: '{0} entries', pv_all_prov: 'All of them, with details, in Providers ({0})', pv_how: 'How it works', pv_lay_asn: 'Provider ban', pv_lay_cl: 'Rented servers', pv_lay_svc: 'Allowed services', pv_u_prov: 'providers', pv_u_list: 'lists', pv_u_addr: 'addresses', pv_u_rng: 'ranges', pv_lay_csf: '{0} ranges in CSF', pv_lay_unl: '{0} providers\' addresses not loaded into CSF yet', pv_lay_rng: '{0} address ranges', pv_lay_fail: '{0} lists not downloading', pv_lay_last: 'last download {0}', pv_lay_offm: 'off', pv_sum_asn: 'Blocks a provider\'s whole network (ASN): its own services go with the servers it rents out. Use it when rented servers aren\'t enough.', pv_sum_cl: 'Blocks the servers cloud companies (Google Cloud, AWS, Azure…) rent out to anyone. Most violations come from them; your visitors and the companies\' own services (Googlebot, Gmail, Outlook) aren\'t in these lists.', pv_sum_svc: 'Lets services that publish their addresses through every ban: neither layer above blocks them.', pv_sec_provs: 'Providers', pv_sec_provs_h: 'up to 50 · also added with "Ban…" in the list on the right', pv_add_ph: 'AS number, e.g. AS14061', pv_add_btn: 'Add and measure', pv_rm: 'Remove from the list', pv_sec_ports_asn: 'Ports blocked for port-list providers', pv_ports_share_s: 'CSF shares this list among all port-list providers', pv_ports_web: 'TCP 80, 443 · UDP 443 (HTTP/3) — SSH, mail, DNS and this server\'s own connections stay open', pv_ports_cust: 'TCP {0} · UDP {1}', pv_sec_ports: 'Blocked ports', pv_sec_lists: 'Lists', pv_sec_srcs: 'Sources', pv_tile_addr: 'Address', pv_tile_pot: '{0} offending IPs from the event log are in this list', pv_tile_fail: 'not downloading (first failure {0})', pv_ed_t: '{0} · download address', pv_ed_close: 'Close', pv_ex_lists: 'Extra lists', pv_ex_lists_h: 'One per line: name|https://url (plain IP list or JSON), for a company not in the built-in lists.', pv_ex_addr: 'Extra addresses', k_CLOUD_EXTRA: 'Extra lists', bad_clx: 'Invalid line: {0} (name|https://url; name lowercase letters, digits, dash)', bad_clx_n: 'At most 20 lists', pv_src_microsoft365: 'Microsoft 365', pv_src_microsoft365_d: 'Outlook, Exchange Online (new Outlook mail sync and sending)', cl_m365_w: 'Mail ports (465, 587, IMAP, POP) are blocked for rented servers and Azure is selected: the new Outlook syncs and sends IMAP accounts\' mail through Microsoft 365 servers, some of which are in the Azure list. Turn Microsoft 365 on in Allowed services.', r_pnear: 'Every offending IP is covered by {0}, but the violations hit {1}, which the blocked ports don\'t include. To block them, add {2} to the port list.', pn_lists: 'the matching', in_cloud: 'This range is in the {0} list: {1} already blocked. Ban it if you want the other ports blocked too.', pv_imp_addip: 'Add to allowed services', pv_imp_added: 'Added to extra addresses ({0}); applies when you save.', pv_imp_srcoff: 'The {0} source is off in Allowed services: turn it on to allow it.', pv_imp_fake: 'Says {0} but isn\'t in the {0} list: may be a fake bot.', under_cl_h: 'This partial ban is inside the {0} list and the list blocks its ports too. Removing it frees a line; if you turn that list off later, this range opens.', under_cl: 'in a rented-server list', pv_cov_t2: 'Bans no longer needed', pv_cov_h2: 'A wider block (the provider ban, a rented-server list or a /16 ban) already blocks everything these bans block; provider and list are checked against the ranges CSF loaded. Keeping them does no harm; removing them frees lines in the permanent list. If you remove that wider block later, these ranges open.', pv_imp_allow: '{0} of these requests ({1} IPs) come from allowed services: CSF lets them through before the ban, so it won\'t block them.', pv_imp_al: 'allowed · {0} — not blocked', pv_imp_alp: '{0}/{1} allowed · {2}', bn_cloud: '{0} list', p_cl: '{0} in a rented-server list', p_cl_h: 'These bans\' IPs are in an active rented-server list: those servers are already blocked on the chosen ports, so they aren\'t counted here.', k_ENABLED: 'CSF Auto-Group', en_1: 'Running', en_0: 'Paused', h_ENABLED: 'While paused no new bans are added and no warnings are sent; the provider ban and the rented-server ban are removed from CSF right away. Allowed services and existing block bans stay. Turning it back on restores everything as set.', sb_paused: 'Protection is paused', sb_paused_s: 'No new bans; provider ban, rented-server ban and block counter removed', paused_bar: 'CSF Auto-Group is paused: no new bans, provider and rented-server bans removed from CSF. Existing block bans stay.', resume: 'Resume', resuming: 'Resuming…', m_resume_t: 'Resume the plugin?', m_resume_b: 'Runs start again. The provider ban, rented server list and allowed services are written back to the CSF settings; CSF rebuilds its rules, then lfd restarts (takes a few seconds).', pv_ev_add: 'added: {0}', pv_ev_del: 'removed: {0}', pv_ev_mv: '{0} → {1}', pv_ev_tot: '{0} providers in all', pv_ev_mode: 'port list: {0}', pv_why_t: 'Banned from this provider', pv_why_n: '{0} IPs · from the event log (last {1} days)', pv_why_cnt: 'In CSF now: {0}', pv_why_r: 'Ban reasons', pv_why_s: 'Services hit: {0}', pv_why_web: 'Violations hit the web only: "Port list" (web only) is enough.', pv_why_more: 'There are violations beyond the web too ({0}): to block them, "Everything" or those ports in the shared port list.', pv_why_none: 'The event log has no banned IPs from this provider.', cl_azure: 'Azure', cl_azure_d: 'Azure datacenters', cl_azure_w: 'The Azure list holds all Azure datacenter addresses, Bingbot\'s included. Unless Bing is on in Allowed services, Bingbot is blocked too.', cl_azure_h: 'Microsoft publishes the list weekly under a new file name; the address is the download page, where the current file is found. A direct .json address works too.', r_apfx: '{1} of {2} singles are in the announced range {0}; banning it instead of the whole network may be enough.', banpfx: 'Ban announced range ({0})', banpfx_h: 'The range its owner announces on the internet: {0} addresses. Bans only this part instead of the whole /16.', m_banpfx_t: 'Permanently ban {0}?', m_banpfx_b: 'This blocks all {0} addresses in the range its owner announces; the rest of the /16 stays open. The ban is added as "do not delete" and is kept even when the list is full.', m_svc_bpfx: 'Connections from the {0} addresses in the announced range to the services you pick are blocked. The ban is added as "do not delete" and is kept even when the list is full.', k_CLOUD_BAN: 'Rented servers', k_CLOUD_SOURCES: 'Lists', k_CLOUD_TCP: 'TCP ports', k_CLOUD_UDP: 'UDP ports', h_CLOUD_SOURCES: 'Lists are downloaded again as often as set in Refresh below. If a download fails, the previous list is kept.', h_CLOUD_TCP: 'Comma separated ports or ranges (30000:35000), at most 15. Default 80,443: websites. Left empty, no TCP is blocked.', h_CLOUD_UDP: 'Comma separated ports or ranges, at most 15. 443: HTTP/3. Left empty, no UDP is blocked.', cl_t: 'Rented servers', cl_h: 'Blocks the addresses of the virtual servers cloud companies rent out to anyone (from the lists they publish), on the selected ports only. Most violations come from these rented servers; your sites\' visitors (home and mobile internet) aren\'t in these lists. Neither are the companies\' own services: the Google Cloud list has no Googlebot or Gmail, so it is narrower and safer than banning the whole ASN. The allow list (csf.allow, allowed services) comes first; connections this server opens to these clouds are not affected.', cl_n: 'Loaded in CSF: {0} ranges · last download {1}', cl_n0: 'The lists are downloaded and applied when you save.', cl_own: 'If your own servers or a service you use run in these clouds and connect to your sites (monitoring, webhooks), add the address to csf.allow or to Allowed services → Extra addresses.', cl_noports: 'Enter at least one port; otherwise nothing is blocked.', cl_err: 'Not downloaded, using the previous list: {0}', cl_urls: 'Show and edit source addresses', cl_urls_h: 'The lists are downloaded from these addresses. If a provider changes its address, type the new one here.', cl_gcp: 'Google Cloud', cl_gcp_d: 'rented servers (Compute Engine)', cl_aws: 'AWS', cl_aws_d: 'rented servers (EC2)', cl_oracle: 'Oracle Cloud', cl_oracle_d: 'rented servers (OCI)', cl_digitalocean: 'DigitalOcean', cl_digitalocean_d: 'rented servers (Droplets)', cl_linode: 'Linode', cl_linode_d: 'rented servers (Akamai)', cl_vultr: 'Vultr', cl_vultr_d: 'rented servers', l_cloud: 'This IP is in the {0} rented-server list · blocked: {1}', v_cloud: 'this IP is in the {0} rented-server list', ev_cloud_fail: 'Rented-server list not downloading', clfail_bar: 'A rented-server list hasn\'t downloaded for longer than the warning period: {0}. The old list is used; the address may have changed.', under_pv_h: 'This ban is inside the {0} provider ban: CSF already blocks everything it blocks with the ranges it loaded for that provider. Removing it frees a line; if you remove the provider ban later, this range opens too.', pv_cov_t: 'Bans no longer needed', pv_cov_h: 'A wider block (the provider ban, a rented-server list or a /16 ban) already blocks everything these bans block; provider and list are checked against the ranges CSF loaded. Keeping them does no harm; removing them frees lines in the permanent list. If you remove that wider block later, these ranges open.', pv_cov_all: 'Remove all ({0})', pv_cov_done: 'Bulk removal finished: {0} removed, {1} failed.', pv_cov_m: 'Remove {0} bans?', pv_cov_mb: 'These bans are inside a wider block, which keeps blocking them after they are removed. Entries a manual ban removed are restored.', k_prov: '{0} provider bans', bn_t: 'Banned providers are left out of the ranking:', bn_all: 'everything', bn_nl: 'addresses not loaded into CSF yet', bn_go: 'Manage in the Providers tab', pv_url_reset: 'Reset to default', pv_url_changed: 'changed', k_SVC_URLS: 'Source addresses', bad_svcu: 'Invalid address: {0} (must start with https://)', ev_svc_fail: 'List not downloading', evh_svc_fail: 'An allowed service list hasn\'t downloaded for longer than the warning period; the old list is used.', svcfail_bar: 'An allowed service list hasn\'t downloaded for longer than the warning period: {0}. The old list is used; the address may have changed.', svcfail_go: 'Check source addresses', pv_svc_last: 'Last download {0} · {1} addresses in csf.allow · refreshed daily', pv_svc_never: 'Not downloaded yet; they are downloaded when you save.', pv_urls: 'Show and edit source addresses', pv_urls_h: 'The built-in sources are downloaded from these addresses. If a provider changes its address, turn that source off and add the new address under Extra addresses with your own name.', pv_src_t: '{0} addresses · {1}', pv_extra_l: 'Your extra addresses', m_asn_add: 'Add to provider ban', m_asn_go: 'Show on the Providers tab', m_asn_in: 'This provider is already in the provider ban list.', v_allow: 'Result: gets through, it is in {0}. The allow comes before every ban.', v_block: 'Result: fully banned, every port closed ({0}).', v_part: 'Result: partially banned. Only these are closed: {0}. Other connections (SSH, mail…) are open.', v_none: 'Result: not banned, all connections are open.', v_wl_lfd: '{0}: this entry only stops lfd from banning the IP by itself; firewall bans still apply.', v_wl_port: '{0}: this line only opens that port; the result above applies to other connections.', v_wl_port_in: '{0}: opens the incoming direction only; this IP\'s ban covers both directions, so replies are dropped and the line opens nothing (a matching outgoing line is also needed).', v_wl_port_out: '{0}: covers only connections the server makes to this address; a ban covering it cuts those too (replies are dropped on the way in).', v_single: 'single ban', v_temp: 'temp ban', dr_covered: 'This IP\'s network is already fully blocked; a block or network ban changes nothing.', raw_line: 'CSF line', more_d: 'Details', in_clean_s: 'Permanent entries and temp bans inside are removed. Permanent ones are kept and can be restored when this ban is lifted.', h_part_go2: 'Block only {0}', h_now: 'Now: {0}.', now_all: 'everything blocked', now_svc: 'only {0} blocked', now_exc: 'everything blocked, open: {0}', chg_same: 'The selection matches the current ban; pick something else to change it.', m_restore_ips: 'To restore: {0}', under_cc: 'inside a country ban', under_asn: 'in a provider ban', cov_under: 'inside the {0} ban', under_cc_h: 'This block is inside {0}; the country or provider ban already blocks it. Removing it frees a line in the permanent list.', pv_card_nodata: 'CSF hasn\'t loaded this provider\'s addresses yet; the rule may have no effect right now (Providers tab).', tab_prov: 'Providers', pv_add: 'Ban…', pv_inlist: 'in list', pv_add_h: 'Adds it to the provider ban list and measures the impact; nothing is applied until you save.', pv_ev_t: 'Provider ban events', pv_ev_none: 'No provider ban events yet.', pv_open_tab: 'Open in the Providers tab', pv_top_h: 'Press "Ban…" on the provider you want to ban: it is added to the list and its impact measured; saving applies it to CSF.', blk_wl: 'The block overlaps an allow list, so it is not banned automatically even over the threshold; it shows in the review list.', sum_wl_open: 'only the whitelisted addresses ({0}): csf.allow comes before the ban', pv_tcp_ph: 'e.g. 80,443', pv_udp_ph: 'e.g. 443 (empty: no UDP blocked)', h_ASN_TCP: 'Comma separated ports or ranges (30000:35000), at most 15. Left empty, no TCP is blocked.', h_ASN_UDP: 'Comma separated ports or ranges, at most 15. Left empty, no UDP is blocked.', pv_busy: 'A run is in progress; the setting is saved and will be applied to CSF on the next run.', bad_svcx_n: 'At most 50 entries', pv_src_uptimerobot: 'UptimeRobot', pv_src_uptimerobot_d: 'site monitoring', pv_src_pingdom: 'Pingdom', pv_src_pingdom_d: 'site monitoring', pv_src_statuscake: 'StatusCake', pv_src_statuscake_d: 'site monitoring', pv_row_ports: 'Port list', pv_row_all: 'Everything', k_ASN_ALL: 'Providers with everything blocked', pv_row_all_h: 'Everything from the provider is cut (CC_DENY). CSF applies it before replies, so this server\'s connections to APIs or backup targets there stop working too.', pv_row_ports_h: 'The ports in the shared port list below are blocked (CC_DENY_PORTS).', pv_imp_hide: 'Hide', pv_imp_again: 'Measure again', pv_imp_at: 'Measured {0}', st_prov: 'Provider ban', pv_exp: 'Experimental', pv_asn_t: 'Provider (ASN) ban', pv_asn_h: 'Bans all of a provider\'s addresses with CSF (CC_DENY / CC_DENY_PORTS). The plugin writes the setting to CSF and refreshes CSF\'s ASN data so the address list stays current.', k_ASN_BAN: 'Provider ban', k_ASN_LIST: 'Providers', k_ASN_MODE: 'Shared port list', k_ASN_TCP: 'TCP ports', k_ASN_UDP: 'UDP ports', h_ASN_LIST: 'AS numbers, comma separated (at most 50). Choose below what to block for each. The IP lookup card shows an IP\'s provider; this server\'s own provider is never banned.', pv_m_web: 'Web only', pv_m_ports: 'Selected ports', pv_m_all: 'Everything', pv_md_web: 'Web requests to your sites from providers set to "Port list" are cut: TCP 80, 443 and UDP 443 for HTTP/3. Mail, DNS and connections from this server out are not affected.', pv_md_ports: 'For providers set to "Port list", only connections to the ports you enter are cut.', pv_md_all: 'Everything from the provider is cut. CSF applies this ban before replies too, so this server\'s connections to APIs or backup targets at that provider stop working as well.', pv_ports_share: 'CSF uses a single port list for port-limited bans (CC_DENY_PORTS), so the list is shared by all providers. If another country or provider there uses different ports, the list isn\'t changed and the reason is shown here.', pv_set_n: 'loaded in CSF · {0} ranges', pv_set_0: 'empty in CSF: addresses not loaded yet', pv_set_load: 'CSF is loading…', pv_set_load_h: 'lfd restarted a few minutes ago; CSF is filling in the provider\'s ranges. The page refreshes by itself.', pv_lay_load: 'CSF is loading ranges', pv_set_new: 'applied when saved', pv_geo: 'CSF\'s ASN data downloaded {0}; the plugin refreshes it when older than the period set below.', pv_noipset: 'LF_IPSET = 0 in the CSF settings: provider ranges are not kept as sets, so the loaded range count can not be read (the ban still works).', pv_noipset_imu: 'LF_IPSET = 0 in the CSF settings: provider ranges are not kept as sets. The loaded range count can not be read and a provider ban with a port list can not be protected from the Imunify360 redirect (the ban guard matches the set). LF_IPSET = 1 is recommended.', pv_geo_none: 'No ASN data in CSF yet; it is downloaded with the first provider ban.', pv_svc_off_w: 'Allowed services are off: services running at this provider, such as Google\'s crawlers, are cut too.', pv_imp: 'Measure impact', pv_imp_h: 'Before banning: requests from this provider to your sites in the last 24 hours of web logs.', pv_imp_wait: 'Reading the last 24 hours of web logs for every site; this takes a while when the logs are large.', pv_imp_fails: 'Failed requests, examples (other than allowed services; code · site · path)', pv_imp_ocodes: 'Responses to requests other than allowed services', pv_imp_acodes: 'Responses to allowed services', pv_imp_asvc: 'Requests from allowed services', pv_imp_sum: 'Last 24 hours: {0} requests, {1} IPs · successful (2xx): {2}', pv_imp_codes: 'Response codes', pv_imp_posts: 'Successful POST requests (may be payment notifications, webhooks)', pv_imp_bots: 'Non-browser clients (2xx)', pv_imp_sites: 'Sites with the most successful requests', pv_imp_noposts: 'No successful POST requests; no webhooks seen.', pv_imp_tip: 'If you recognise a service (payment, shipping, marketplace): add it to Allowed services below if it publishes its addresses; otherwise don\'t ban this provider.', pv_imp_none: 'No requests from this provider to your sites in the last 24 hours.', pv_imp_nodata: 'No ASN data in CSF yet; it is downloaded with the first provider ban. Measure after that.', pv_imp_nologs: 'Web logs not found: none of /var/log/apache2/domlogs, /usr/local/apache/domlogs and /etc/apache2/logs/domlogs exists. The measurement reads the Apache access logs (domlogs); if they live elsewhere, set DOMLOGS=/path in config.env.', pv_svc_t: 'Allowed services', pv_svc_h: 'Services that publish their own addresses are written to csf.allow. CSF checks the allow list first, so these addresses pass country and provider bans; they are allowed on every port. Google and OpenAI publish a separate list for each kind of visitor; the chips on the tile switch each one on or off. If one address of a service violates, add it to “Excluded from allowed services”: the rest of the list stays allowed and bans work on that address.', k_SVC_ALLOW: 'Allowed services', k_SVC_SOURCES: 'Sources', k_SVC_EXTRA: 'Extra addresses', k_SVC_SKIP: 'Allowed services: sub-lists turned off', k_SVC_EXCEPT: 'Excluded from allowed services', k_CLOUD_URLS: 'Rented server list addresses', h_SVC_SOURCES: 'Lists are downloaded again as often as set in Refresh below. If a download fails, the previous list is kept.', h_SVC_EXTRA: 'One entry per line: name|https://address-list or name|IP (name|1.2.3.0/24). The list may be JSON or plain text.', pv_src_google: 'Google', pv_src_google_d: 'Googlebot, AdsBot, Gmail images', pv_src_bing: 'Bing', pv_src_bing_d: 'Bingbot', pv_src_apple: 'Apple', pv_src_apple_d: 'Applebot (Siri, Spotlight)', pv_src_duckduckgo: 'DuckDuckGo', pv_src_duckduckgo_d: 'DuckDuckBot', pv_src_openai: 'OpenAI', pv_src_openai_d: 'GPTBot, search bot, ChatGPT', pv_src_stripe: 'Stripe', pv_src_stripe_d: 'payment notifications', pv_src_mollie: 'Mollie', pv_src_mollie_d: 'payment notifications', pv_src_n: '{0} addresses', pv_svc_sum: '{0} addresses in csf.allow · updated {1}', pv_svc_err: 'Couldn\'t download, using the previous list: {0}', pv_svc_nolist: 'Yandex and Facebook don\'t publish address lists, so they aren\'t here.', pv_applying: 'Applying provider settings to CSF…', pv_applied: 'Provider settings applied to CSF.', ev_provider: 'Provider ban', evh_provider: 'The provider ban was written to (or removed from) the CSF settings (CC_DENY / CC_DENY_PORTS); the details show the provider list at that moment.', evh_cloud_fail: 'A rented-server list has not downloaded for longer than the warning period; the old list is used.', evh_config: 'A setting was saved from the panel; the details show the old and new value and who changed it.', evh_test_mail: 'A test email was sent from Settings → Notifications.', pv_ev_rm: 'removed: {0}', bad_asn_list: 'numbers starting with AS, comma separated (at most 50)', bad_ports: 'comma separated ports or ranges (30000:35000), at most 15', bad_svcx: 'Invalid line: {0}', bad_svce: 'Invalid address: {0} (write an IPv4 address or a range like 1.2.3.0/24)', syncing: 'Done, updating the list…', working: 'Working…', boot_wait: 'Reading the server\'s state: CSF lists, the event log and the provider sets.', w_ban: 'Adding the ban…', w_chg: 'Changing the ban…', w_unban: 'Removing the ban…', w_expire: 'Removing old block bans…', w_forget: 'Stopping the watch…', w_ignore: 'Ignoring…', w_unignore: 'Removing the ignore…', w_csf: 'csf.deny is written; CSF is rebuilding its firewall rules (csf -r). That is most of the wait; it takes longer on servers with many bans.', w_prov: 'The settings are written to csf.conf; CSF is rebuilding its rules, then lfd is restarted. lfd fills in the provider ranges afterwards.', w_light: 'Only the plugin\'s own record changes; CSF is not touched.', working_s: 'CSF is being updated; this can take a few seconds. The list refreshes by itself when it is done.', ev_fix_udp: 'Ban completed', evh_fix_udp: 'Partial bans and exceptions added before this version had no UDP 443 line for the web; it was added. HTTP/3 (QUIC) runs on this port.', fix_udp_d: 'UDP 443 added (HTTP/3)', r_after: 'only bans after the partial ban', ban_btn: 'Ban', m_ban24_t: 'Permanently ban {0}?', m_ban24_b: 'This blocks all 256 addresses in the block. The ban is added as "do not delete" and is kept even when the list is full.', in_loading: 'Reading what is inside…', in_h: 'Inside right now', in_blocks: 'Block bans', in_singles: 'Single bans', in_temps: 'Temp bans', in_watched: 'Watched blocks', in_others: 'Other ranges', in_owner: 'Owner', in_none: 'Nothing else inside.', in_watch_end: 'not watched while banned', in_oth_keep: 'left as they are', in_clean0: 'Remove covered entries', in_clean_d: 'Permanent entries inside the range (including "do not delete" ones and other ranges) are removed from the permanent list, temp bans from the temp list. The removed permanent entries are kept: when you lift this ban you can restore them exactly as they were. Temp bans are not restored; they would have expired anyway. "do not delete" lines don\'t count toward CSF\'s list limit, so they are not counted as freed.', in_cover: 'Already banned: {0}. No new ban is needed. To ban this range on its own, remove the covering ban first (Active range bans or the IP card).', in_wl: 'Overlaps a whitelist entry:', under: 'inside {0}', under_h: 'This block is inside the {0} ban and no longer needed. Removing it frees a line in the permanent list.', under_hp: 'This block is inside the {0} ban; watching it no longer matters.', l_perm_net: 'Permanent (network)', l_perm_rng: 'Permanent (/{0})', l_port: 'Port-limited · {0} {1} blocked · {2}', l_ccd_cc: 'Country blocked · CC_DENY {0}', l_ccd_asn: 'ASN blocked · CC_DENY {0}', l_ccp: 'Port-limited · CC_DENY_PORTS {0} · {1}', l_ccd_src: 'Country and ASN here come from Team Cymru; CSF uses its own database, which can rarely differ.', ev_removed: '{0} entries removed', r_partial: 'this network has a partial ban: {0}', m_unban_part: 'The partial ban is removed; connections from this range to the selected services are allowed again. Other bans inside stay in place.', ev_restored: '{0} entries restored', m_restore_d: 'They go back to the permanent list with their original comments and dates, "do not delete" markers included. If you leave this unchecked, these entries are unbanned too and discarded.', m_restore: 'Restore the {0} entries removed when this ban was added', m_unban_rb: 'The ban is removed from the permanent list.', in_free_pt: 'frees {0} lines in the permanent list and {1} entries in the temp list', in_free_t: 'frees {0} entries in the temp list', in_free_p: 'frees {0} lines in the permanent list', in_sgl_dnd: 'incl. {0} do not delete', in_keep: 'kept', in_rm: 'removed', dir_in: 'inbound', dir_out: 'outbound', in_ports: 'Port-limited lines', in_self: 'This range contains this server\'s own IP ({0}); it can\'t be banned.', ban_anyway: 'Ban anyway', ignore: 'Ignore', unban: 'Remove',
      promote: 'Make permanent', forget: 'Stop watching', unignore: 'Stop ignoring', show_all: 'Show all ({0})', more: 'Show more',
      n_ip: '{0} IPs', n_subnets: '{0} distinct blocks', from_temp: 'from temp bans', from_perm: 'from permanent bans', days_left: '{0} days left',
      ttl_left: 'temp ban: {0} left', until: 'until {0}', by: 'by {0}', wl: 'whitelist: {0}', and_more: '+{0} more IPs',
      no_review: 'Nothing to review.', no_groups: 'No active range bans.', no_pending: 'No watched blocks.',
      no_events: 'Nothing recorded yet. Runs will show up here.', no_match: 'No matching entries.',
      c_t24: 'Block ban (/24)', c_t24p: 'Do not delete threshold', c_t16: 'Suspicious network (/16)', c_tt24: 'Temp block ban (/24)',
      c_ret: 'Watch period', c_lookup: 'Owner / hostname lookups', c_on: 'on', c_off: 'off', c_days: '{0} days', c_forever: 'Indefinitely', ign_change: 'Change duration', rewatch: 'Restart the watch', m_rewatch_t: 'Restart the watch on {0}?', m_rewatch_b: 'The watch period starts again from today (the watch period under Settings → Ban rules → Watching). A new temporary ban from this block within that period makes the block permanent.', w_rewatch: 'Restarting the watch…', ev_manual_rewatch: 'Watch restarted', ign_forever: 'no end date', ign_who: '{0} ignored it {1}', ign_forever_l: 'ignored indefinitely', st_ign_f: 'ignored (indefinitely)', c_singles: '≥ {0} singles', c_gloss: 'single = one-IP ban · block = /24 · network = /16 · do not delete = CSF keeps it even when the list is full',
      now: 'just now', min_ago: '{0} min ago', h_ago: '{0} h ago', d_ago: '{0} d ago', dur_h: '{0} h {1} min', dur_m: '{0} min',
      cancel: 'Cancel', confirm: 'Confirm', close: 'Close', reload: 'Reload page', type_to_confirm: 'Type {0} to confirm',
      m_ban16_t: 'Permanently ban {0}?', m_ban16_b: 'This blocks all 65,536 addresses in the network. The ban is added as "do not delete" and is kept even when the list is full.',
      m_force_t: 'Ban despite the whitelist?', m_force_b: 'This block overlaps a CSF whitelist entry:',
      m_force_n: 'Addresses in csf.allow keep getting through even with this ban. Those in csf.ignore and the other lists will be blocked.',
      m_promote_t: 'Make {0} permanent now?', m_promote_b: 'The block is added to the permanent list as "do not delete" and is no longer watched.',
      m_forget_t: 'Stop watching {0}?', m_forget_b: 'The next violation from this block counts as the "first time" again and gets a 12-hour temp block ban.',
      m_unban_t: 'Remove {0}?', m_unban_b: 'The block ban is removed. The single bans deleted when it was added do not come back; these addresses are fully unblocked.',
      m_unban_dnd: 'This ban is marked "do not delete". The marker is removed from csf.deny first (a backup is kept).',
      m_ignore_t: 'Ignore {0}?', m_ignore_b: 'The item is hidden from Needs review; for a suspicious network (/16) its warning emails stop too. "Indefinitely" lasts until you stop it. To undo: Overview → Ignored → Stop ignoring (also from the IP card).', m_ignore_d: 'For', m_ignchg_t: 'Change how long {0} is ignored?', m_ignchg_b: 'Current end: {0}. The new period counts from today; Forever lasts until you remove it.',
      m_unignore_t: 'Watch {0} again?', m_run_t: 'Run now?',
      m_run_b: 'Does exactly what the scheduled (cron) run would: blocks over the threshold get banned and notifications are sent.',
      m_dry_t: 'Dry run', m_dry_wait: 'Simulating a run without changing anything…', m_dry_none: 'This run would not change anything.',
      m_upd_t: 'Update to v{0}?', m_upd_b: 'Runs update.sh; config.env and records are kept. Takes a few seconds.',
      m_upd_run: 'Updating…', m_upd_ok: 'Update complete.', m_upd_fail: 'The update did not complete; see the output.',
      t_started: 'Run started.', t_done: 'Run finished.', t_busy: 'Another run is in progress, try again shortly.', t_cron_busy: 'A run is already in progress (most likely cron); results will show up here when it finishes.',
      t_err: 'Could not complete: {0}', e_bad_ip: 'not a valid IPv4 address', e_bad_input: 'the value is not valid', e_bad_asn: 'not a valid AS number (e.g. AS16276)', e_busy: 'a run or action is in progress; try again when it finishes', e_confirm_mismatch: 'the confirmation text did not match', e_no_script: 'engine file not found (check the install)', e_unknown: 'unknown request', e_unsafe_repo: 'an install file is not owned by root or is writable by others; for safety it is not updated from the panel, run update.sh over SSH', e_uptodate: 'already up to date', e_session: 'the session expired; reload the page', e_bad_target: 'invalid target', e_bad_value: 'invalid setting value', session: 'Session expired. Reload the page.', t_copied: 'Copied.',
      l_host: 'Hostname', l_fwd: 'the name resolves back to this IP (forward-confirmed)', l_nofwd: 'the name does not resolve back to this IP (not confirmed)', l_noptr: 'No reverse DNS',
      l_owner: 'Owner', l_prefix: 'Announced range', l_reg: 'Registry', l_fw: 'Firewall', l_wl: 'Whitelist',
      l_pending: 'Watched', l_ign: 'Ignored', l_notbanned: 'Not blocked', l_none: 'None', l_perm_single: 'Permanent (single)',
      l_perm_cover: 'Permanent (block)', l_temp: 'Temp', l_nolookup: 'Owner and hostname lookups are off (Settings → Sources and refresh → Owner and hostname lookups).',
      l_abuse: 'AbuseIPDB', l_bgp: 'bgp.he.net', l_copy: 'Copy', bad_ip: 'Enter a valid IPv4 address.', ipv6_no: 'IPv6 addresses are not supported: the plugin groups and shows IPv4 bans only; IPv6 bans stay as they are in the CSF screen.',
      foot: 'CSF Auto-Group v{0} · signed in as {1}',
      tab_overview: 'Overview', tab_settings: 'Settings', tab_history: 'History', show_less: 'Show less', s_cfglog: 'Settings history', ev_loading: 'Loading…', ev_err: 'The event log could not be read ({0}); the list shows only the latest runs and may be incomplete. The page retries by itself.', singles_s: 'singles', kd_win: 'in the last {0} days', kd_since: 'since install', kd_since_n: 'compared since install ({0} days)', kd_lines: 'lines', kd_same: 'no change', kr_ring: '{0} of {1} items are skipped blocks', kr_warn: 'suspicious', kr_skip: 'skipped', kr_allow: 'violation from allowed IP', kr_po: 'open service', kr_other: 'other', st_upd: 'Version and updates', upd_check: 'Check for updates', upd_checking: 'Checking…', upd_cur: 'Installed version', upd_ok: 'Up to date', upd_new: 'New version available: v{0}', upd_last: 'Last checked: {0}', upd_never: 'Not checked yet', upd_auto: 'While the page is open it also checks every half hour; a notice appears at the top when a new version is out.', upd_err_not_git: 'The install is not a git checkout; it can\'t be updated from the plugin (update.sh won\'t work either).', upd_err_unreachable: 'Could not reach GitHub; try again in a moment.', upd_err_detached: 'The repository is not on a branch; update over SSH.', c_auto_on: 'block bans older than {0} days are removed automatically on every run', c_auto_off: 'block bans older than {0} days are collected under the Old filter, not removed automatically', hc_csf: 'CSF', hc_lfd: 'lfd', hc_cron: 'Cron', hc_csf_ok: 'Firewall rules are loaded', hc_csf_off: 'CSF is disabled (csf.disable)', hc_csf_testing: 'CSF is in testing mode (TESTING = 1)', hc_csf_norules: 'CSF rules are not loaded', hc_csf_missing: 'CSF not found (removed or not installed): no bans are applied', hc_csf_unknown: 'Status unknown (no iptables)', hc_lfd_ok: 'lfd is running', hc_lfd_down: 'lfd is not running: no new bans will arrive', hc_cron_ok: 'Runs happen on schedule', hc_cron_late: 'A run is overdue', sb_fw: 'There is a problem with the firewall', f_old: 'Old', old_h: '{0} block bans are older than {1} days.', old_auto: 'Automatic removal is on; they will be removed on the next run.', old_manual: 'Automatic removal is off (Settings → Ban rules → Old bans).', old_rm: 'Remove old ones ({0})', m_exp_t: 'Remove {0} old block bans?', m_exp_b: '{0} block bans older than {1} days are removed from csf.deny (do not delete ones too). If violations come from them again they are banned again. csf.deny is backed up first.', ev_expire: 'Old block removed', ev_limit_gone: 'Removed by CSF limit, watched', evh_limit_gone: 'This block ban of the plugin left csf.deny without the plugin: most likely CSF deleted its oldest lines because the permanent list reached its limit (CSF setting DENY_IP_LIMIT), or it was removed by hand. The single bans inside were already gone. The block is now watched: if it violates again it gets a permanent ban marked do not delete. If the list fills up often, raise DENY_IP_LIMIT.', exp_age: 'added {0} days ago', rep_n: 'repeating · {0} days', k_BLOCK_EXPIRE_DAYS: 'Old block ban limit (days)', h_BLOCK_EXPIRE_DAYS: 'Block bans older than this are grouped under the "Old" filter in the Active range bans table.', k_BLOCK_EXPIRE_AUTO: 'Remove old block bans automatically', h_BLOCK_EXPIRE_AUTO: 'When on, block bans older than this are removed on every run and reported by email. Manual bans are left alone.', from_log: 'old entry', sn_server: 'Server', st_deps: 'Server requirements', st_deps_h: 'Tools the plugin uses and what happens when one is missing.', dep_ok: 'Found', dep_missing: 'Missing', dep_warn: 'Incomplete', dep_opt: 'optional', dep_csf: 'The firewall; it applies the bans.', dep_csf_x: 'Required: nothing works without CSF.', dep_crontab: 'Runs the job on schedule.', dep_crontab_x: 'Runs don\'t happen automatically; the schedule can\'t be changed from Settings.', dep_mail: 'Alert emails and the weekly summary.', dep_mail_x: 'No alert emails or weekly summary are sent.', dep_dns: 'Owner and hostname lookups.', dep_dns_x: 'No owner or hostname info; CC_IGNORE / CC_ALLOW and csf.rignore can\'t be checked, so blocks relying on them aren\'t banned.', dep_logrotate: 'Archives the log file when it grows (compresses the old one, starts a new file).', dep_logrotate_x: 'Log lines older than the keeping period are removed instead (fallback).', dep_logrotate_w: 'Installed, but our config file is missing; log lines older than the keeping period are removed for now. Re-run update.sh or install.sh.', dep_flock: 'Makes sure only one run happens at a time.', dep_flock_x: 'No protection against overlapping runs.', dep_timeout: 'Puts a time limit on commands the plugin runs.', dep_timeout_x: 'A stuck command can keep the page waiting.', dep_git: 'Updating from the plugin.', dep_git_x: 'The update check and the Update button don\'t work.', dep_modsec: 'cPanel\'s hit log (Hits List) is available; ban reasons show the ModSecurity rule\'s message.', dep_modsec_w: 'No cPanel hit log; messages are read from the ModSecurity log and rule files (Imunify rules may show only their number).', dep_modsec_x: 'ModSecurity log not found; ban reasons show rules by number only.', dep_sqlite3: 'Reads the ModSecurity hit log.', dep_sqlite3_x: 'The hit log can\'t be read; messages come from the ModSecurity log and rule files (Imunify rules may show only their number).', dep_imunify: 'The Imunify tab in the providers card; blocks containing Imunify-whitelisted IPs are not banned.', dep_imunify_x: 'The Imunify tab is hidden; the Imunify whitelist isn\'t checked (CSF\'s lists still are).', k_logfile: 'Status', log_rot: 'logrotate: archived past {2} MB, the last {3} archives are kept · now {0} · {1} archives.', k_LOG_ROTATE_MB: 'Log size (MB)', h_LOG_ROTATE_MB: 'Once the log grows past this size it is archived: the old one is compressed and kept, a new file is started (logrotate checks daily).', k_LOG_ROTATE_KEEP: 'Archives kept', h_LOG_ROTATE_KEEP: 'How many old log archives (compressed) are kept.', log_lines: 'Now {0} lines; the oldest {1}.', no_cfglog: 'No settings changes yet.', ev_config: 'Settings changed', ev_test_mail: 'Test email',
      st_notify: 'Notifications', st_mail: 'Alert email address', st_mail_h: 'Run notices (block bans, suspicious networks, list usage, firewall problems) and the weekly summary go here. On cPanel, root@localhost is forwarded to the server contact address.',
      st_lang: 'Language', st_lang_h: 'Language of the log, emails and this panel.', st_test: 'Send test email', st_test_h: 'Sent to the saved address.',
      st_test_dirty: 'Save the new address first.', mail_whm: 'WHM contact address', mail_custom: 'Other address', mail_whm_h: 'Goes to the contact address in WHM → Basic WebHost Manager Setup: {0}. If you change it in WHM, the plugin follows.', mail_whm_none: 'No contact address found in WHM; mail goes to root@localhost.', ic_ev_h: 'Firewall problems and list usage are sent right away (once when they start and once when resolved). Run notices cover bans, suspicious networks and skips. Allowed-IP violations and open services (the allowed / ignored / server IP and open-service rows of Needs review) are sent once per IP or range per day; what you ignored is not sent. Run notices and these records go by email at the end of the run and on Slack collected into at most one message per hour. The weekly summary goes out on the chosen day.', ic_fw: 'Firewall problem', ic_list: 'List filling up', ic_run: 'Run notices', ic_review: 'Allowed-IP violations, open services', ic_digest: 'Weekly summary', st_events: 'Events and channels', st_events_f: 'Which event goes where', st_mail_c: 'Email', st_digest_f: 'Day', st_digest_off: 'Weekly summary is off; turn it on in the Events and channels table.', nt_all: 'All channels set in WHM', nt_email: 'Email only', nt_slack: 'Slack only', nt_h_noslack: 'Slack: not set in WHM', k_NOTIFY: 'Notification channels', ic_test: 'Send a Slack test', ic_test_h: 'Sent to the Slack channel set in WHM right away, whatever the settings.', k_IC_FIREWALL: 'Slack: firewall problem', k_IC_LISTFULL: 'Slack: list filling up', k_IC_RUN: 'Slack: run notices', k_IC_REVIEW: 'Slack: allowed-IP violations, open services', k_IE_REVIEW: 'Email: allowed-IP violations, open services', k_IC_DIGEST: 'Slack: weekly summary', k_IE_FIREWALL: 'Email: firewall problem', k_IE_LISTFULL: 'Email: list filling up', k_IE_RUN: 'Email: run notices', k_IE_DIGEST: 'Email: weekly summary', st_thr: 'Ban rules', st_thr_h: 'When a ban is placed or a warning is sent; all counted in single (one-IP) bans.',
      k_THRESHOLD_24: 'Permanent ban threshold', h_THRESHOLD_24: 'A block (/24) is banned once it holds this many permanent single (one-IP) bans.',
      k_THRESHOLD_24_PERMANENT: 'Do not delete at', h_THRESHOLD_24_PERMANENT: 'At this many singles the block ban also gets "do not delete": CSF keeps it even when the list is full. Can\'t be lower than the block ban threshold.',
      k_THRESHOLD_16: 'Suspicious network threshold', h_THRESHOLD_16: 'A network (/16) is reported as suspicious when this many single (one-IP) bans, permanent and temp counted together, come from at least 2 distinct blocks. The network is not banned.',
      k_THRESHOLD_TEMP_24: 'Temp ban threshold', h_THRESHOLD_TEMP_24: 'At this many temp single (one-IP) bans in a block: a 12-hour temp block ban the first time, permanent if it comes back.',
      k_THRESHOLD_TEMP_16: 'Suspicious network, from temp bans (/16)',
      st_sched: 'Schedule', st_sched_h: 'How often cron runs. More frequent runs ban a block that crosses the threshold sooner (at most one run later). Every run, even a quiet one, writes a summary line to the log and a run record to History: the more often it runs, the faster the log fills and the more run records there are (kept for the Record keeping period).', cron_5: '5 min', cron_10: '10 min', cron_15: '15 min', cron_30: '30 min', cron_0: 'Hourly',
      st_lookup: 'Lookups', k_LOOKUP: 'Owner and hostname lookups', h_LOOKUP: 'Shows ASN, organisation and hostname in emails and here; CC_IGNORE and csf.rignore checks rely on it.',
      k_LOOKUP_TIMEOUT: 'DNS timeout (s)', h_LOOKUP_TIMEOUT: 'How long to wait for each query.', st_nodns: 'Neither dig nor host is installed; lookups won\'t work (dnf install bind-utils).',
      on: 'On', off: 'Off', g_runs: 'Running', st_general: 'General', st_general_h: 'How the plugin runs: on or paused, how often, and the language of the log and the mails.', st_notify_h: 'Which event goes to which channel; the email address, the Slack test and the day of the weekly summary.', st_server_h: 'Version and update, CSF\'s list limits, the tools on the server, the log file.', st_hist_h: 'Who changed which setting, when, from what to what.', st_ch: 'Channels', g_review: 'Needs review', pv_sec_refresh: 'Refresh', k_CLOUD_REFRESH_DAYS: 'Refresh lists (days)', h_CLOUD_REFRESH_DAYS: 'The rented-server lists are downloaded again this often.', k_CLOUD_FAIL_DAYS: 'Warn if not downloaded (days)', h_CLOUD_FAIL_DAYS: 'A list that fails to download for this many days in a row is reported by mail and in the panel; the last downloaded list is used meanwhile.', k_SVC_REFRESH_DAYS: 'Refresh lists (days)', h_SVC_REFRESH_DAYS: 'The allowed-service lists are downloaded again this often.', k_SVC_FAIL_DAYS: 'Warn if not downloaded (days)', h_SVC_FAIL_DAYS: 'A list that fails to download for this many days in a row is reported by mail and in the panel; the last downloaded list is used meanwhile.', k_GEO_REFRESH_DAYS: 'Refresh CSF\'s ASN data (days)', h_GEO_REFRESH_DAYS: 'CSF never refreshes its provider ranges (ip2asn) by itself; when the file is older than this, lfd downloads it again.', k_OWNER_TTL_DAYS: 'Look owners up again (days)', h_OWNER_TTL_DAYS: 'A block\'s provider and country are kept this long, then looked up again.', k_IMUNIFY_REFRESH_MIN: 'Refresh the Imunify360 list (minutes)', h_IMUNIFY_REFRESH_MIN: 'Imunify360\'s block list on this server is read again this often.', k_BLOCK_ACTIVE_DAYS: 'A tried block is not old (days)', h_BLOCK_ACTIVE_DAYS: 'If a banned block had an attempt within this time, old-block removal keeps it.', st_lists: 'Lists', st_lists_h: 'How often the lists the plugin downloads are refreshed, and when a failed download is reported.', pv_refresh_n: 'Lists are refreshed every {0} days.', pv_to_lists: 'Settings → Sources and refresh', im_q_ports: 'What changes if you ban it on the port list?', im_q_all: 'What changes if you ban everything?', im_q_ban: 'This provider is banned now ({0}). What came in the last 24 hours?', im_lead: 'In the last 24 hours this provider\'s addresses sent {0} requests to your sites.', im_lead_al: 'Most came from allowed services; a ban does not touch them.', im_ip_n: '{0} IPs', im_req_n: '{0} requests', im_ok_n: '{0} successful', im_b_al_t: 'Allowed services — not affected by a ban', im_b_al_d: 'CSF lets allowed services through before any ban.', im_b_cl_t: 'Addresses in a rented-server list — already closed', im_b_cl_d: 'Web ports of these addresses are closed by the rented-server list ({0}).', im_b_cl_seen: 'Last request: {0}.', im_b_op_t: 'All other addresses — open now, a ban cuts these', im_b_op_tb: 'All other addresses', im_b_op_none: 'No requests from these addresses.', im_b_op_ex: 'Most: {0}, {1} requests ({2})', im_c_ok: '{0} successful', im_c_403: '{0} refused (403)', im_c_404: '{0} not found (404)', im_c_4: '{0} other errors (4xx)', im_c_3: '{0} redirected (3xx)', im_c_5: '{0} server errors (5xx)', im_v_safe_t: 'Banning looks safe', im_v_safe: 'None of the {0} requests that would be cut succeeded, so no known visitor or integration is cut.', im_v_safe_al: 'Allowed services ({0}) keep working.', im_v_warn_t: 'Careful: banning also cuts successful requests', im_v_warn: '{1} of the {0} requests that would be cut succeeded. Check who sent them in the open addresses list below; if it is a service you use (payments, shipping, marketplace), add it to Allowed services first.', im_v_none_t: 'Banning changes nothing', im_v_none: 'No requests from this provider\'s open addresses in the last 24 hours.', im_h_t: 'Violations from this provider', im_h_csf: 'CSF holds {0} from this provider.', im_h_last: 'Last violation {0}.', im_h_bx: '{0} block bans (other sources)', im_h_ev: 'Per the event log, {0} IPs were banned in the last {1} days.', im_h_why: 'Most common reason: {0}.', im_h_web: 'All violations were on the web: the port list (web only) is enough.', im_h_more: 'There are violations outside the web too ({0}). To cut those as well, choose "Everything" or add those ports to the shared port list.', im_h_none: 'No banned IPs from this provider in the event log.', im_d_open: 'Open addresses: what a ban would cut', im_d_open_b: 'All other addresses', im_d_cloud: 'Addresses in a rented-server list', im_d_fails: 'Refused request examples', im_d_acodes: 'Responses allowed services got', im_d_afails: 'Refused request examples (most frequent)', im_d_acodes_h: 'Your sites or ModSecurity gave these responses to allowed bots (e.g. 403 for a forbidden page). They are not violations, and a ban does not change them.', im_al_h: 'These requests came from an allowed service: CSF lets them through before any ban.', im_st_temp: 'temp banned · {0} left', im_st_temp_h: 'lfd temporary ban: lifted by itself when it expires.', im_st_deny: 'permanently banned', im_st_deny_h: 'This IP is in csf.deny.', im_st_deny24: 'block banned', im_st_deny24_h: 'This IP\'s /24 block is in csf.deny.', im_st_imu: 'on the Imunify block list', im_st_imu_h: 'On Imunify360\'s block list on this server.', im_st_none: 'not banned now', im_st_none_h: 'Not in csf.deny, temp bans or the Imunify block list.', p_t2: '{0} single bans', p_g2: '{0} block bans', p_last2: 'last violation {0}', p_svc: 'Services: {0}', p_svc_rep: '{0} unknown', p_cl3: '+{0} bans in the {1} list (already closed)', p_b2: '+{0} block bans from other sources', p_b_h: 'Ranges in csf.deny not added by CSF Auto-Group; they do not count in the ranking.', pv_inlist2: 'Provider-banned', pv_inlist_h: 'This provider is on the provider ban list and written to CSF.', pv_inlist_u: 'On the ban list · not saved', pv_inlist_uh: 'Added to the list on the Providers tab but not saved yet; it is written to CSF when you save.', t_cc: 'Country: {0} ({1})', t_asn: '{0}: provider number (ASN) — the organisation announcing these addresses', t_chipn: 'Entries under this filter', im_rsn_n: '{0} IPs', imr_CAPTCHA_DOS_ALERT: 'Asked for the captcha page too often: DoS-like load', imr_WAF_BRUTEFORCE: 'Password guessing caught by the web application firewall', imr_SMTP_BRUTEFORCE: 'Mail password guessing', imr_SSH_BRUTEFORCE: 'SSH password guessing', imr_FTP_BRUTEFORCE: 'FTP password guessing', imr_PORT_SCAN: 'Port scan', imr_DOS_ALERT: 'Too many connections (DoS-like load)', imr_other: 'Imunify360 block reason: {0}', bn_cloud_h: 'This provider\'s bans are inside a rented-server list: that list already closes them.', bn_all_h: 'CC_DENY: every address of this provider is closed on every port.', bn_ports_h: 'CC_DENY_PORTS: this provider is closed on these ports only; other services (SSH, mail…) stay open.', dnd_s: 'kept', dnd_h: 'Marked "do not delete" in csf.deny: CSF never removes this ban by itself, even when the list is full or the ban is old.', st_tip: 'The current state of this entry', k_perm_h: 'csf.deny: CSF\'s permanent ban list. The limit is DENY_IP_LIMIT in csf.conf; when full, CSF removes the oldest line not marked do not delete.', k_temp_h: 'CSF\'s temporary ban list. The limit is DENY_TEMP_IP_LIMIT in csf.conf.', kd_tip_up: '{0}: up {1}', kd_tip_dn: '{0}: down {1}', from_log_h: 'Work from before the event log started, read from the plugin\'s log file. IP and reason details may be missing.', pv_tile_wait: 'selected · downloaded when you save', pv_tile_off: 'not selected', pv_tile_pot_h: '{0} of the IPs banned in the event log fall in this list\'s addresses: with the list on, they could not have reached the web at all.', pv_tile_addr_h: 'Show or change the address the list is downloaded from', st_run: 'Running', st_src: 'Sources and refresh', st_src_h: 'Information the plugin gets from outside: IP owners, downloaded lists, CSF\'s ASN data and the Imunify360 list, and how often each is refreshed.', g_old: 'Old bans', k_cron: 'Run frequency', g_blk: 'Block ban (/24)', g_net: 'Suspicious network (/16)', g_watch: 'Watching', g_own: 'Owner lookups', g_cl: 'Rented-server lists', g_svc: 'Allowed-service lists', g_geo: 'CSF\'s ASN data', g_imu: 'Imunify360', g_log: 'Log file', k_lines_full: '{0} / {1} lines used', pv_exp_h: 'Experimental: a new layer. A wrong setting can cut a service; use Measure impact before adding a provider.', lay_on_h: 'On: this layer is applied in CSF.', lay_warn_h: 'On, but something needs attention (e.g. a list fails to download or addresses are not loaded into CSF yet); details are in the card.', lay_off_h: 'Off: this layer is not applied in CSF.', dep_ok_h: 'Installed on the server and usable by the plugin.', dep_missing_h: 'Not found on the server: the function next to it does not work.', upd_new_h: 'A newer version is in the repository; Update installs it.', l_perm_cover_h: 'A permanent ban covering this IP: every connection from it is blocked.', l_part_h: 'Partial ban: only the chosen services (ports) are closed, the rest stay open.', terms_h: 'A short glossary of the words the panel uses (single, block, network, kept, rented server…)', p_svc_h: 'Unknown: lfd made these IPs permanent as repeat bans (PERMBLOCK); that line does not name the service. The service is read from the first temp ban\'s line in the lfd log; if that line is gone, it is unknown.', 'svs_google-common': 'Googlebot', 'svs_google-common_h': 'Google\'s search crawler (Googlebot and common crawlers). Needed for the sites to appear in Google.', 'svs_google-special': 'Special bots', 'svs_google-special_h': 'Special Google crawlers like AdsBot and Storebot (ads and shopping checks).', 'svs_google-user': 'User requests', 'svs_google-user_h': 'Google requests triggered by a user (site verification, feed reader…).', 'svs_google-user-google': 'User requests (Google)', 'svs_google-user-google_h': 'User-triggered requests from Google\'s own network.', 'svs_openai-gptbot': 'GPTBot', 'svs_openai-gptbot_h': 'OpenAI\'s crawler for AI training. It asks for many pages quickly; some security tools report it as an violation.', 'svs_openai-search': 'Search bot', 'svs_openai-search_h': 'OAI-SearchBot: needed for the sites to appear in ChatGPT search.', 'svs_openai-user': 'ChatGPT user requests', 'svs_openai-user_h': 'ChatGPT-User: requests made when someone asks ChatGPT to open a page. Anyone can point it at any address.', pv_ex_except: 'Excluded from allowed services', h_SVC_EXCEPT: 'These addresses are not allowed even if an allowed-service list contains them; their bans in csf.deny work. One IP or range per line (e.g. 74.7.241.35).', pv_exc_open: 'Open the Providers tab first.', pv_exc_added: '{0} will be excluded from allowed services; it applies when you save on the Providers tab.', v_allow_ban: 'Its ban in CSF does not work either.', dr_exc_btn: 'Exclude from allowed services', dr_exc_h: 'The IP is taken out of the allowed-service list and its ban starts working. The service\'s other addresses stay allowed.', dr_wl_csfallow: 'The allow comes from a line in csf.allow; remove that line for the bans to work.', l_layers: 'Bans covering this IP', l_layers_x: 'Bans covering this IP (not working now)', l_who: 'Who', m_exc_t: 'Exclude {0} from allowed services?', m_exc_b: 'This address is in the {0} list, so no ban cuts it now. Once excluded, the allowed-service list is rewritten without it, CSF reloads and the address\'s bans work. The service\'s other addresses stay allowed. To undo: Providers → Allowed services → Excluded from allowed services.', t_exc_ok: '{0} excluded from allowed services.', im_bt: 'Bans on this provider (in CSF, now)', im_bn: 'This provider\'s addresses have {0} bans: {1}.', im_bl: 'The last one {0}.', im_bk_p: '{0} partial bans', im_bo: '{0} are on addresses nothing else closes: these bans do the work.', im_bc: '{0} are inside a rented-server list ({1}): that list already closes these addresses on the web.', im_ba: '{0} are on allowed-service addresses ({1}): these bans do not work, because CSF applies allows before bans. To cut them, use "Exclude from allowed services" in the IP card.', im_bs: 'Services hit: {0}', svc_unknown: 'unknown', im_bd: 'Bans one by one', im_bd_n: 'newest {0} / {1}', im_bi_open: 'ban works', im_bi_open_h: 'No other layer closes this address; its ban in CSF cuts it.', im_bi_cloud: 'in {0}', im_bi_cloud_h: 'This address is in a rented-server list; its web ports are already closed by it.', im_bi_allow: 'allowed ({0}) · no effect', im_bi_allow_h: 'This address is in an allowed-service list: CSF applies allows before bans, so the ban does not work.', im_v_hist_t: 'Nothing to cut right now, but this provider kept violating', im_v_hist: 'No requests from its open addresses in the last 24 hours; but {0} of its addresses were banned one by one (the last {1}). Banning it closes violations from its new addresses up front; allowed services are not affected.', col_net: 'Network / block', col_why: 'Why', col_marked: 'Flagged', col_marked_h: 'For suspicious networks and skipped blocks, when the plugin last flagged the range; for allowed, ignored and own-IP rows, the first record in the review window (the last one is in the note). The row stays for the review period.', r_gone: 'the single bans behind this warning are no longer in CSF', col_ip: 'IP', col_host: 'Reverse DNS', col_reason: 'Reason', col_until: 'Ignored until', col_by: 'Ignored by', col_req: 'Requests', col_now: 'Now', col_ban: 'Ban', col_banned: 'When · reason', s_ignored_h: 'Ranges you ignored in the review list. They stay hidden until the end date; if violations continue they are flagged again after that.', r_perm: '{0} permanent', r_temp: '{0} temporary', r_gone_s: 'no singles left', l_perm_single_h: 'This IP itself is permanently banned in csf.deny (single ban): every port is closed. Its CSF line is below.', evh_digest: 'When the plugin sent the weekly summary. Preview its content with "Preview summary" under Settings → Notifications.', r_svc_unk: 'service unknown', rg_k16: 'Network (/16) · 65,536 addresses', rg_k24: 'Block (/24) · 256 addresses', rg_kp: 'Announced range ({0})', rg_cover: 'Whole range banned: {0}', rg_cover_h: 'A ban covers this range: every address in it is closed on every port.', rg_part: 'Partial ban on this range: {0} closed', rg_layers: 'Blocks applied to the whole range', rg_by_part: 'this range\'s partial ban', rg_v_full: 'Result: the whole range is banned ({0}). Every connection from it is closed.', rg_v_part: 'Result: the range is partially banned. The ports of the blocks below are closed for the whole range; other services are closed only to the IPs banned one by one.', rg_v_none: 'Result: the range itself is not banned. The banned IPs and blocks in it are closed one by one; a new IP from the range can reach every service.', rg_sv: 'Services hit', rg_c_svc: 'Service', rg_c_ips: 'Offending IPs', rg_sv_closed: 'closed', rg_sv_closed_h: 'This service is closed for the whole range: {0}.', rg_sv_open: 'open', rg_sv_open_h: 'This service is open for the range as a whole: only IPs banned one by one are cut; a new IP from the range gets through.', rg_sv_unk: 'service unknown', rg_q_full: 'Nothing to check.', rg_q_noatt: 'No recorded violations from this range.', rg_q_open: 'What to look at: {0} is open for the range as a whole. If violations continue, ban the range (or only these services); if it was a one-off, the single bans are enough.', rg_q_closed: 'Every service hit is already closed for the whole range; a ban would add nothing.', rg_in: 'Bans inside the range', rg_in_blk: '{0} block bans', rg_in_oth: '{0} other CSF lines (range bans)', rg_in_sgl: '{0} single bans (each closes that IP completely)', rg_in_tmp: '{0} temp bans', rg_in_wat: '{0} watched blocks', rg_in_part: '{0} partial bans (narrower ranges)', rg_in_port: '{0} port rules', rg_in_none: 'No bans in this range.', rg_sgl_t: 'Single bans', rg_sgl_tt: 'Single and temp bans', rg_rv: 'Flagged as {0} ({1}).', rg_rv_ips: 'IPs not banned now', rg_self_l: 'This server', rg_cloud: 'Range is in the {0} rented-server list · closed: {1}', rg_cloud_h: 'This whole range is in this rented-server list; its ports are closed for every address in the range.', rg_ccp: 'Provider ban ({0}) · closed: {1}', rg_ccp_h: 'The whole range is announced by a provider banned in CSF with the port list; those ports are closed for every address.', rg_own: 'This range\'s ban: {0}', rg_added: 'added {0} ({1})', rg_gn: 'put on {0} single bans', rg_noev: 'The violations behind this ban are not in the records (it predates the event log).', rg_q_full_att: 'Every violation above is cut; nothing to do.', rg_in_none_own: 'No bans other than this range\'s own: the singles in it were removed from CSF when the block ban went in (this ban covers them).', v_wl_svc: 'the allowed service {0} ({1})', ab_b: 'Ban not working', ab_i: 'lfd ignored', ab_g: 'Allowed range', ab_b_h: 'Ban not working: lfd banned this IP but it is in the allow list (csf.allow or a file it includes). CSF applies allows before bans, so the IP reaches the server. This happens when CSF\'s IGNORE_ALLOW is 0 (the default). Details: Glossary.', ab_i_h: 'lfd ignored: lfd saw this IP\'s failed attempts but did not ban, because the IP is in the allow list and CSF\'s IGNORE_ALLOW is 1. A manual ban would not work either; the allow comes first. Details: Glossary.', ab_g_h: 'Allowed range: several IPs from inside one allow entry are violating; the decision is about that entry, not the single IPs. For an allowed service you can exclude the range. Details: Glossary.', ab_b_n: 'lfd banned it but the ban does not work; allowed by: {0}.', ab_i_n: 'lfd counted the attempts but did not ban; allowed/ignored by: {0}.', ab_g_n: 'They violation from inside this allow entry: {0}. If it continues, exclude the range from allowed services; the service\'s other lists stay allowed.', ab_own: 'You added this allow: remove it from {0} if you want the ban to work.', ab_y_n0: 'lfd counted the attempts but did not ban; ignore {0}.', ab_src_none: 'source not found — the IP is not in the server\'s addresses, csf.allow, csf.ignore, GLOBAL_IGNORE, CC_IGNORE, RELAYHOSTS or csf.rignore', ab_s: 'Server\'s IP', ab_s_h: 'Server\'s own IP: lfd counted the failed attempts from this address but did not ban, because the address is one of the server\'s own IPs; lfd always ignores its own addresses (ignoreip, regardless of settings). The attempts come from inside the server; when the mail log shows which account was used, the row says so. This IP can not be banned. Details: Glossary.', ab_s_n: 'lfd counted the attempts but did not ban: {0} is this server\'s own address; lfd always ignores its own addresses. It can not be banned.', l_acct: 'Attempts', l_acct_h: 'Accounts this IP tried with a wrong password and web addresses ModSecurity blocked for it, with the number of tries; from the lines lfd counts. Read from SMTPAUTH_LOG, POP3D_LOG, IMAPD_LOG, SSHD_LOG, FTPD_LOG, CPANEL_LOG, HTACCESS_LOG and MODSEC_LOG in csf.conf; only lines within the Needs review period.', ac_mail: 'mail accounts tried: {0}', ac_ssh: 'SSH users tried: {0}', ac_ftp: 'FTP accounts tried: {0}', ac_cp: 'cPanel/WHM logins tried: {0}', ac_htp: 'web password users tried: {0}', ac_web: 'targets: {0}', pb_svc: 'earlier ban: {0}', why_pb: 'Repeat ban (PERMBLOCK): lfd made the IP permanent after more than LF_PERMBLOCK_COUNT temp bans within LF_PERMBLOCK_INTERVAL', ab_s_acct: 'Wrong passwords were tried on the mail server from inside the server with these accounts ({0}): {1}.', ab_cnt: '{0} times', asn_bar_atk: 'Bar: ranking weight (block bans ×4 + single bans); the lighter part is ranges added by hand or another tool.', asn_bar_blk: 'Bar: number of ranges in csf.deny.', asn_bar_im: 'Bar: number of IPs Imunify360 blocked.', asn_hint_h: 'Shown for a provider with at least 5 block bans (at least 15 singles in 5 separate blocks) that is not in the provider ban.', dot_bad: 'A field has an error; it can not be saved until fixed.', dot_warn: 'A tool is missing (Server section).', dot_dirty: 'Unsaved changes.', dot_upd: 'A newer version is available.', save_bad_in: 'error: {0}', dry_s_act: 'This run would do', dry_s_none: 'This run would place or remove no ban.', dry_s_mail: 'Notifications that would be sent', dry_s_prob: 'Problems', dry_s_round: 'Run summary', dry_s_raw: 'Raw output', pv_imp_cancel: 'Cancel', pv_imp_cancel_h: 'Closes the wait; the measurement runs on the server for at most another minute and its result is not shown.', r_aa: '{0} of them are in an allow or ignore list: lfd did not ban them or their ban does not work (marked in the IP list)', po: 'Open service', po_h: 'Open service: this range\'s partial ban closes only the chosen services; since it went in, the services left open were hit up to the block or network threshold. Details: Glossary.', po_n: 'The partial ban closes only {0}; the services in the Why column were hit after the ban. Change the ban to close them too.', ab_y: 'Ignored', ab_y_h: 'Ignored: lfd saw this IP\'s failed attempts but did not ban, because the IP is ignored (csf.ignore, GLOBAL_IGNORE, csf.rignore, CC_IGNORE or RELAYHOSTS; the row says which). Ignoring is not a firewall allow: CSF refuses to ban the IP on its own, but a ban on its block cuts it (measured). Details: Glossary.', ab_y_n: 'lfd counted the attempts but did not ban; ignored by: {0}. CSF will not ban this IP on its own; banning its block cuts it.', ab_y_own: 'Remove it from {0} if you want lfd to ban this IP on its own.', dr_rv_cnt: '{0} times in the last {1} days.', rg_aa: '{0} allowed IPs in this range are violating (ban not working or ignored by lfd); they show in the review list.', ab_last: 'Last entry: {0} ({1}).', rv_drop_try: 'Drops off the list by itself on {0} if no new attempt comes.', rv_drop_warn: 'Drops off the list by itself on {0} if no new warning comes.', rv_drop_viol: 'Drops off the list by itself on {0} if no new violation of the open services comes.', im_b_cdn_t: 'To sites behind a CDN — a ban does not affect them', im_b_cdn_d: 'These sites (or their www names) come through {0}: the firewall sees the CDN, not the visitor, so a ban does not cut these requests. To cut them, use an IP or ASN block in the {1} panel.', im_cdn_other: 'another address', im_v_cdn: 'The {0} requests to sites behind a CDN are outside this decision: the firewall does not see them.', k_SAYAC_RETENTION_DAYS: 'Watch period (days)',
      h_SAYAC_RETENTION_DAYS: 'A temp-banned block that returns within this time becomes permanent.', k_REVIEW_DAYS: 'Days kept in the list',
      h_REVIEW_DAYS: 'How many days a Needs review row stays after its last record: suspicious networks, skipped blocks, allowed / ignored / server-IP rows and open services. With no new record in that time the row drops out by itself.', k_LOG_KEEP_DAYS: 'Log kept for (days)', h_LOG_KEEP_DAYS: 'Log lines older than this many days are removed (only when logrotate is missing).', k_EVENTS_DAYS: 'History kept for (days)', h_EVENTS_DAYS: 'Bans, warnings, manual actions and setting changes are kept this many days. An active range ban\'s violations are read from here too; with a shorter period, the reason of older bans is not shown.', k_RUN_DAYS: 'Run records kept for (days)', h_RUN_DAYS: 'Each run\'s record (duration, list usage) is kept this many days. The summary cards\' comparison with 30 days ago and the run count in the weekly summary are read from here; at least 31 days.', g_keep: 'Record keeping', keep_now: 'Now {0} events (oldest {1}) · {2} run records (oldest {3}) · {4}.',
      st_csf: 'CSF list limits', st_csf_h: 'These are CSF\'s own settings; change them in CSF, not here.',
      csf_deny: 'Permanent list (DENY_IP_LIMIT)', csf_temp: 'Temp list (DENY_TEMP_IP_LIMIT)', csf_open: 'Open CSF settings',
      default_v: 'default {0}', range_v: 'a whole number from {0} to {1}', mail_bad: 'Enter a valid email address.',
      rule_dnd: 'The do not delete threshold can\'t be lower than the block ban threshold.', dirty_n: '{0} unsaved changes', discard: 'Discard',
      try_save: 'Try before saving', save: 'Save', m_save_t: 'Save settings?', m_save_b: 'These changes will be saved (the previous settings are backed up). Provider settings apply right away, the others on the next run:',
      m_try_t: 'Dry run with the new thresholds', m_try_b: 'Uses the unsaved settings; nothing is changed.',
      auto: 'automatic', focus_gone: '{0} is no longer on the list; showing its current state.',
      new_badge: 'New since your last visit', new_rec: 'New record since your last visit ({0}); the Flagged column shows the first record.', actions: 'Actions', overdue: 'Run overdue · last run {0} (expected every {1})',
      since_visit: 'Since your last visit ({0}):', sn_add: '{0} block bans', sn_temp: '{0} temp block bans', sn_warn: '{0} suspicious networks',
      sn_skip: '{0} skipped blocks', sn_aviol: '{0} allowed-IP violation records', sn_po: '{0} open-service records', sn_gone: '{0} block bans removed outside the plugin', show_new: 'Show', e_new: 'Since last visit', ch_total: '{0} events', ch_title_n: 'Last {0} days', ch_d: '{0} days', sb_ok: 'Protection is running', sb_run: 'A run is in progress', sb_late: 'Runs are not on schedule', sb_every: 'Cron every {0}', sb_24: '{0}/{1} runs in the last 24 h', sb_none: 'no runs yet', sb_last: 'Last run', sb_dur: 'Run time', sb_avg: 'avg {0}', sb_next: 'Next', sb_now: 'now', sb_spark: 'Last {0} run times', pg_prev: 'Previous page', pg_next: 'Next page', dirty_leave: '{0} unsaved changes', dirty_leave_b: 'Switching tabs discards the unsaved changes. Stay and Save to keep them, or continue without saving.', dirty_go: 'Leave without saving', conn_net: 'Can\'t reach the server; what you see was fetched {0}. Retrying…', conn_session: 'Your session has expired.', upd_busy: 'An update is already running.', sec: '{0} s', lk_recent: 'Recently viewed',
      ch_add: 'Block ban', ch_promote: 'Came back, permanent', ch_temp: 'Temp block ban', ch_warn: 'Suspicious network', ch_skip: 'Skipped',
      ch_empty: 'Nothing in the last {0} days; the chart fills as the event log grows.', ipcard: 'IP card', col_block: 'Block', col_owner: 'Owner', col_since: 'Since', col_left: 'Watch left', col_state: 'State', left_short: '{0} left',
      col_singles: 'Singles', col_added: 'Added', sort_by: 'Sort', of_n: '{0}–{1} of {2}', s_asn: 'Most blocked providers', s_asn_ban: 'Banned providers',
      s_asn_h: 'lfd\'s single bans and the plugin\'s block bans, by provider (counted from the {0} blocks whose owner has been looked up)', p_g: '{0} blocks', p_b: '+{0} blocks not from CSF Auto-Group', p_t: '{0} singles', p_bn: '{0} blocks',
      at_atk: 'Violations', at_blk: 'By hand / other tools', blk_h: 'Ranges in csf.deny the plugin didn\'t add (added by you or another tool), by provider. These ranges are already banned; the rest of the provider is open.',
      blk_empty: 'No ranges in csf.deny that CSF Auto-Group did not add (or their owners aren\'t known yet).',
      im_h: 'IPs Imunify360 blocked on this server itself (not its central list), by provider; counted from the {1} of {0} IPs whose owner has been looked up. Imunify360\'s list is not changed.',
      im_n: '{0} IPs', im_empty: 'The Imunify360 local blacklist is empty.', asn_denied: 'Already blocked in CSF', asn_pban: 'banned on {0}; violations on open services', asn_pban_h: 'This provider is banned with the port list; the violations counted here are on services that list leaves open (e.g. SSH, mail). Add those ports or ban everything if they continue.',
      asn_hint: 'Provider ban suggestion', asn_filling: 'Collecting owner info; 50 blocks are looked up per run.',
      asn_nolookup: 'Owner lookups are off (Settings → Sources and refresh).', m_asn_t: 'Ban all of AS{0}',
      m_asn_b: '{0} separate block bans were added for {1}; each means at least {2} offending IPs in the same block. If violations keep coming from this provider, banning the whole provider (ASN) lasts longer than banning blocks one by one.',
      m_asn_w: 'This can also block legitimate users of that provider (e.g. payment or monitoring services running there). Measure the impact first; services that publish their addresses can stay open through Allowed services.',
      m_asn_s: 'It is added to the list on the Providers tab and its requests to your sites over the last 24 hours are measured. Nothing is applied until you save.',
      edit: 'Edit', st_digest: 'Weekly summary',
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
  function tErr(s) {   // "İşlem tamamlanamadı: …" — sunucunun kısa hata kodu (bad_input, busy…) cümleye çevrilir; motorun iletisi olduğu gibi
    return t('t_err', s && DICT[LANG]['e_' + s] !== undefined ? t('e_' + s) : s);
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
  function stamp(ts) {            // "05.10 14:20"; başka yıldan kayıtta yıl da ("05.10.2025 14:20")
    var d = new Date(ts * 1000), oy = d.getFullYear() !== new Date(nowSec() * 1000).getFullYear();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    if (LANG !== 'tr') return d.toLocaleString('en-US', oy ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + (oy ? '.' + d.getFullYear() : '') + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dayStr(ymd) {          // "2026-10-05" → "5 Eki 2026" (motorun gün biçimi panelin diliyle)
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : String(ymd || '');
  }
  var DEP_NAMES = { csf: 'CSF', crontab: 'cron', mail: 'mail', dns: 'dig / host', logrotate: 'logrotate', flock: 'flock', timeout: 'timeout', git: 'git', imunify: 'Imunify360', modsec: 'ModSecurity', sqlite3: 'sqlite3' };
  function updCard() {
    var u = UPD, has = u && u.ok && !u.uptodate, blocked = has && (u.dirty || u.diverged);
    var state = !u ? '<span class="ag-muted">' + t('upd_never') + '</span>'
      : !u.ok ? '<span class="ag-upd-bad">' + esc(t('upd_err_' + u.error) !== 'upd_err_' + u.error ? t('upd_err_' + u.error) : tErr(u.error || '?')) + '</span>'
      : u.uptodate ? '<span class="ag-pill ag-pill-ok">' + t('upd_ok') + '</span>'
      : '<span class="ag-pill ag-pill-acc" title="' + esc(t('upd_new_h')) + '">' + esc(t('upd_new', u.latest)) + '</span>';
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
      var wk = 'dep_' + d.k + '_w', txt = ok ? t('dep_' + d.k) : warn && t(wk) !== wk ? t(wk) : t('dep_' + d.k + '_x');   // uyarı metni olmayan araçta eksik metni (ham anahtar görünmesin)
      var pill = ok ? 'ag-pill-ok' : opt ? 'ag-pill-n' : warn ? 'ag-pill-warn' : (d.k === 'csf' ? 'ag-pill-bad' : 'ag-pill-warn');
      return '<div class="ag-dep"><div class="ag-dep-ic ' + (ok ? 'ok' : opt ? 'n' : 'bad') + '">' + (ok ? IC.check : IC.alert) + '</div>' +
        '<div class="ag-dep-m"><div class="ag-dep-t"><b>' + esc(DEP_NAMES[d.k] || d.k) + '</b>' + (opt ? '<span class="ag-muted">' + t('dep_opt') + '</span>' : '') + '</div>' +
        '<div class="ag-dep-d">' + esc(txt) + '</div></div>' +
        '<span class="ag-pill ' + pill + '" title="' + esc(t(ok ? 'dep_ok_h' : 'dep_missing_h')) + '">' + t('dep_' + (ok ? 'ok' : warn ? 'warn' : 'missing')) + '</span></div>';
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
  function api(a, params, again) {
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
      // sayfa 12 saatten uzun açık kaldı, anahtarın süresi geçti ama WHM oturumu açık: yeni anahtarla bir kez yinele
      // (önce "Oturumun süresi doldu" deyip yoklamayı durduruyordu; Son tur günlerce eski kalıyordu)
      if (j && j.error === 'csrf_stale' && j.csrf && !again) { BOOT.csrf = j.csrf; return api(a, params, true); }
      if (j && j.error === 'session') setConn('session');
      // PHP'nin kodlu hatası (session, unsafe_repo…) İngilizce iletiyle gelir: panelin dilindeki cümle yazılır, ayrıntı (yol) korunur
      if (j && j.error && DICT[LANG]['e_' + j.error] !== undefined) {
        var dt = /: (\/\S+)$/.exec(j.message || '');
        j.message = t('e_' + j.error) + (dt ? ' (' + dt[1] + ')' : '');
      }
      return j || { ok: false, error: 'empty' };
    });
  }

  /* Bağlantı çubuğu: sayfa eski veriyi "güncel" gibi göstermesin */
  var $conn = null;
  function setConn(k) {
    if (CONN === 'session' && k === 'net') return;
    if (CONN === k && k !== 'net') return;               // kesinti sürdükçe "… önce" her denemede yeniden yazılır (donmasın)
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
  var EVL = null, EVK = {}, EVMORE = false, EVBUSY = false, EV_SHORT = false, EVERR = '';
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
      if (!r || !r.ok) { EVERR = (r && (r.message || r.error)) || '?'; return 0; }
      EVERR = '';
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
      if (!r || !r.ok) { toast(tErr((r && r.error) || '?'), 'bad'); return 0; }
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
  function shortOwner(s) { return String(s || '').replace(/^(AS\d+)\s+[^ ]+ - /, '$1 '); }
  function ownerOf(cidr) {         // → {asn, cc, name, label} ya da {}
    var c = (S.owners || {})[prefixOf(cidr)], o = OWNERS[cidr] || {};
    // Cymru kurum adı ülkeyle bitiyor ("OVH, FR"); bayrak zaten gösterildiği için tabloda atılır.
    if (c) return { asn: c[0], cc: c[1], name: String(c[2] || '').replace(/^[^ ]+ - /, '').replace(/,\s*[A-Z]{2}$/, ''), label: 'AS' + c[0] + ' ' + (c[2] || '') };
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
  var NEW_TYPES = ['add24', 'promote', 'temp24', 'warn16', 'warn16t', 'skip_wl', 'manual_ban', 'limit_gone', 'allow_viol', 'part_open'];
  function overdue() {
    if (!S.last_run || !(S.cron_interval > 0)) return false;
    // eldeki durum verisi eskiyse (sekme arka planda kaldı, yenileme bekleniyor) "son tur" saati şimdiki saatle kıyaslanınca
    // yanlış gecikme çıkar: karar taze veriyi bekler. Gerçek gecikme taze veride yine görünür.
    if (LAST_OK && nowSec() - LAST_OK > 120) return false;
    return nowSec() - S.last_run.t > Math.max(3 * S.cron_interval, 2700);
  }

  /* ── Parçalar ──────────────────────────────────────────────────── */
  function empty(icon, text) { return '<div class="ag-empty">' + (IC[icon] || '') + esc(text) + '</div>'; }
  function ccName(cc) { try { return new Intl.DisplayNames([LANG === 'tr' ? 'tr' : 'en'], { type: 'region' }).of(String(cc).toUpperCase()) || cc; } catch (e) { return cc; } }
  function flag(cc) { return cc ? '<span class="ag-flag" title="' + esc(t('t_cc', ccName(cc), cc)) + '">' + esc(cc) + '</span>' : ''; }
  function asnB(n, name) { n = String(n || '').replace(/^AS/i, ''); return '<span class="ag-asn" title="' + esc(t('t_asn', 'AS' + n) + (name ? ' — ' + name : '')) + '">AS' + esc(n) + '</span>'; }
  function newDot(ts) { return isNew(ts) ? '<span class="ag-newdot" title="' + esc(t('new_badge')) + '"></span>' : ''; }
  // Kontrol edilecekler satırı ne zaman kendiliğinden düşer: son kaydı + Listede kalma süresi (REVIEW_DAYS). İzinli /
  // yoksayılan / sunucu IP'si: son deneme (ips[].t); açık servis: son ihlal (e.last); şüpheli ağ / atlandı: son uyarı (e.t)
  function rvDrop(e) {
    var rd = (S.config || {}).review_days || 7, last = 0, k = 'rv_drop_warn';
    if (/^allow_/.test(e.type)) { k = 'rv_drop_try'; (e.ips || []).forEach(function (x) { if (x.t > last) last = x.t; }); }
    else if (e.type === 'part_open') { k = 'rv_drop_viol'; last = e.last || 0; }
    else last = e.t || 0;
    if (!last) return '';
    return t(k, new Date((last + rd * 86400) * 1000).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }));
  }
  // Kontrol edilecekler satırı: satırın zamanı ilk kayıttır (izinli IP günlerdir kayıt alıyor olabilir); son ziyaretten beri
  // o IP'ye / aralığa yeni kayıt geldiyse de "yeni" — son ziyaret çubuğunun saydığı ve "Göster"in götürdüğü satır bu
  function rvDot(e, noT) {
    if (!noT && isNew(e.t)) return newDot(e.t);
    var k = {}, m = 0; k[e.cidr] = 1; (e.ips || []).forEach(function (x) { if (x.ip) k[x.ip] = 1; });
    (S.events || []).forEach(function (v) { if (k[v.cidr] && NEW_TYPES.indexOf(v.type) >= 0 && v.t > m) m = v.t; });
    return isNew(m) ? '<span class="ag-newdot" title="' + esc(t('new_rec', rel(m))) + '"></span>' : '';
  }
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
      '<div class="ag-tabs" role="tablist">' + ['overview', 'history', 'prov', 'settings'].map(function (k) {
        return '<button class="ag-tab' + (UI.tab === k ? ' on' : '') + '" role="tab" aria-selected="' + (UI.tab === k) + '" data-act="tab" data-tab="' + k + '">' + t('tab_' + k) + '</button>';
      }).join('') + '</div>' +
      '<div class="ag-head-actions">' +
      '<button class="ag-btn ag-head-help" data-act="terms" title="' + esc(t('terms_h')) + '">' + IC.book + esc(t('terms')) + '</button>' +
      (UI.ranOnce ? '<button class="ag-btn" data-act="runlog">' + IC.terminal + t('run_log') + '</button>' : '') +
      '<button class="ag-btn" data-act="dry" title="' + esc(t('dry_h')) + '">' + IC.eye + t('dry') + '</button>' +
      '<button class="ag-btn ag-btn-primary" data-act="run"' + (run ? ' disabled' : '') + '>' + IC.play + t('run') + '</button>' +
      '</div></div>';
  }

  /* Durum bandı: koruma çalışıyor mu, son tur, süre, sıradaki tur, son turların süreleri */
  function sec(s) { s = Math.max(0, Math.round(s || 0)); return s < 60 ? t('sec', s) : dur(s); }
  function nextLeft() {          // sıradaki cron tikine kaç saniye var (-1: bilinmiyor / duraklatılmış)
    if (S.enabled === false) return -1;                     // duraklatılmış: tur çalışsa da iş yapmaz, geri sayım yanıltır
    var cm = String(S.cron_min || ''), d = new Date(nowSec() * 1000), m = d.getMinutes(), s = d.getSeconds(), x, left;
    if ((x = /^\*\/(\d+)$/.exec(cm)) && +x[1] > 0) { var n = +x[1]; left = (Math.min(60, (Math.floor(m / n) + 1) * n) - m) * 60 - s; }
    else if (/^\d+(,\d+)*$/.test(cm)) {                     // "0" ya da "5,35": en yakın sonraki dakika
      left = Math.min.apply(null, cm.split(',').map(function (v) { return (((+v - m + 60) % 60) || 60) * 60 - s; }));
    }
    else return -1;
    return Math.max(0, left);
  }
  function nextIn() { var left = nextLeft(); return left < 0 ? '' : Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2); }
  // tur zamanı geldi mi: tik 2 dakikadan yeni ve son tur olayı tikten önce → tur bitince hemen görünsün diye sık yoklanır
  function runDue() {
    var left = nextLeft(), iv = S.cron_interval || 0, lr = S.last_run;
    if (left < 0 || !(iv > 0) || S.running) return false;
    var since = iv - left;
    return since >= 0 && since < 120 && (!lr || nowSec() - lr.t > since);
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
    var HL = S.health || {}, fwBad = HL.lfd === 'down' || HL.csf === 'off' || HL.csf === 'norules' || HL.csf === 'missing';
    var paused = S.enabled === false;
    var st = run ? 'run' : (late || fwBad || paused) ? 'bad' : 'ok';
    var sub = paused && !run ? t('sb_paused_s') : fwBad && !run ? [HL.csf !== 'ok' && HL.csf !== 'unknown' ? t('hc_csf_' + HL.csf) : '', HL.lfd === 'down' ? t('hc_lfd_down') : ''].filter(Boolean).join(' · ')
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
      t(run ? 'sb_run' : paused ? 'sb_paused' : fwBad ? 'sb_fw' : late ? 'sb_late' : 'sb_ok') + '</b><span>' + esc(sub) + '</span>' + healthChips(HL, late) + '</div></div>' +
      m(t('sb_last'), BACK ? backTxt() : lr ? esc(rel(lr.t)) : '—', '', 'ag-last', t('sb_last_h') + ' ' + t('sb_fetched', new Date(LAST_OK * 1000).toLocaleTimeString(loc()))) +
      m(t('sb_dur'), BACK ? '…' : ds.length ? esc(sec(ds[ds.length - 1])) : '—', !BACK && ds.length > 1 ? esc(t('sb_avg', sec(avg))) : '', 'ag-dur') +
      m(t('sb_next'), BACK ? '…' : run ? t('sb_now') : (nextIn() || '—'), '', 'ag-next') +
      (L.length > 1 ? '<div class="ag-band-g"><small>' + t('sb_spark', L.length) + '</small><div class="ag-spark">' + spark + '</div></div>' : '<div></div>') +
      '</section>';
  }

  // sürüm numarası aynıysa (yalnız test / belge değişikliği, VERSION artmadı) commit kısa adıyla: "v1.15.19 (318cba4)"
  function updV(v, c) { return UPD.current === UPD.latest && c ? v + ' (' + c + ')' : v; }
  function banner() {
    if (!UPD || !UPD.ok || UPD.uptodate) return '';
    var blocked = UPD.dirty ? t('upd_dirty') : (UPD.diverged ? t('upd_diverged') : '');
    var list = UI.commits ? '<ul class="ag-commits">' + (UPD.commits || []).map(function (c) {
      return '<li><code>' + esc(c.hash) + '</code>' + esc(c.subject) + '</li>';
    }).join('') + '</ul>' : '';
    return '<div class="ag-banner">' + IC.download +
      '<div class="ag-grow">' + t('upd_avail', esc(updV(UPD.current, UPD.current_commit)), esc(updV(UPD.latest, UPD.latest_commit))) + ' · ' + t('upd_commits', (UPD.commits || []).length) +
      (blocked ? '<div class="ag-sub" style="color:#92400e">' + esc(blocked) + '</div>' : '') + '</div>' +
      '<button class="ag-btn ag-btn-sm" data-act="commits">' + (UI.commits ? t('upd_hide') : t('upd_show')) + '</button>' +
      (blocked ? '' : '<button class="ag-btn ag-btn-sm ag-btn-primary" data-act="update">' + t('upd_apply') + '</button>') +
      list + '</div>';
  }

  function sinceBar() {
    if (!(SEEN0 > 0)) return '';
    // her olay türü kendi adıyla sayılır (günlük kontrol kayıtları ve eklenti dışında kalkan banlar şüpheli ağ değildir)
    var c = { add: 0, temp: 0, warn: 0, skip: 0, aviol: 0, po: 0, gone: 0 };
    var SN = { add24: 'add', promote: 'add', manual_ban: 'add', temp24: 'temp', warn16: 'warn', warn16t: 'warn', skip_wl: 'skip', allow_viol: 'aviol', part_open: 'po', limit_gone: 'gone' };
    (S.events || []).forEach(function (e) { if (isNew(e.t) && SN[e.type]) c[SN[e.type]]++; });
    var parts = [];
    ['add', 'temp', 'warn', 'skip', 'aviol', 'po', 'gone'].forEach(function (k) { if (c[k]) parts.push(t('sn_' + k, c[k])); });
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
  // kartlardaki değişim, grafikte seçilen dönem için (7 / 30 gün); eklenti o dönemden yeniyse kurulumdan beri
  function winLbl() {
    var days = UI.cd === 7 ? 7 : 30, f = (S.runs || {}).first || 0;
    return f && f > nowSec() - days * 86400 ? t('kd_since') : t('kd_win', days);
  }
  function delta(d, unit) {      // unit: sayının birimi ("satır"), boş olabilir; dönem kartların üstündeki seçimde yazar
    if (d == null) return '';
    if (!d) return '<span class="ag-kpi-d eq">— <span class="ag-kpi-dl">' + esc(t('kd_same')) + '</span></span>';
    var wl = winLbl(); wl = wl.charAt(0).toUpperCase() + wl.slice(1);
    return '<span class="ag-kpi-d ' + (d > 0 ? 'up' : 'dn') + '" title="' + esc(t(d > 0 ? 'kd_tip_up' : 'kd_tip_dn', wl, num(Math.abs(d)) + (unit ? ' ' + t(unit) : ''))) + '">' + (d > 0 ? '▲' : '▼') + ' ' + num(Math.abs(d)) +
      (unit ? '<span class="ag-kpi-dl"> ' + esc(t(unit)) + '</span>' : '') + '</span>';
  }
  // 7 / 30 gün: kartların değişimini ve grafiği birlikte belirler
  function periodBar() {
    var days = UI.cd === 7 ? 7 : 30, f = (S.runs || {}).first || 0, since = f && f > nowSec() - days * 86400;
    return '<div class="ag-period">' + (since ? '<span class="ag-period-n">' + esc(t('kd_since_n', num(Math.max(1, Math.round((nowSec() - f) / 86400))))) + '</span>' : '') +
      '<div class="ag-chips">' + [7, 30].map(function (d) {
        return '<button class="ag-chip' + (days === d ? ' on' : '') + '" data-act="cd" data-d="' + d + '">' + t('ch_d', d) + '</button>';
      }).join('') + '</div></div>';
  }
  /* Kart: [simge] [başlık / sayı + değişim / açıklama] [halka] — telefonda: [simge + başlık] / [sayı ··· halka] / [açıklama] */
  function kpi(icon, tone, label, value, dl, meta, rg, tip, ltip) {
    return '<div class="ag-kpi"><div class="ag-kpi-ic ' + tone + '">' + IC[icon] + '</div>' +
      '<div class="ag-kpi-l"' + (ltip ? ' title="' + esc(ltip) + '"' : '') + '>' + esc(label) + '</div>' +
      '<div class="ag-kpi-v">' + value + dl + '</div>' +
      '<div class="ag-kpi-m">' + meta + '</div>' +
      '<div class="ag-kpi-g"' + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + (rg || '') + '</div></div>';
  }
  function usageKpi(icon, label, pair, before) {
    var used = pair[0], lim = pair[1], p = lim > 0 ? Math.round(used * 100 / lim) : 0;
    var cls = p >= 90 ? 'bad' : (p >= 80 ? 'warn' : '');
    return kpi(icon, 'n', label, lim > 0 ? (LANG === 'tr' ? '%' + p : p + '%') : num(used), before >= 0 ? delta(used - before, 'kd_lines') : '',
      lim > 0 ? t('k_lines_full', num(used), num(lim)) : t('k_nolimit'), lim > 0 ? ring(p, cls) : '', lim > 0 ? t('k_lines', num(used), num(lim)) : '', t(icon === 'list' ? 'k_perm_h' : 'k_temp_h'));
  }
  function kpis() {
    var days = UI.cd === 7 ? 7 : 30, G = S.groups, n = G.length, wk = nowSec() - days * 86400;
    var dnd = G.filter(function (g) { return g.dnd; }).length;
    // blok banı: seçilen dönemde eklenen − kaldırılan (elle ya da eski olduğu için)
    var added = G.filter(function (g) { return g.added && g.added >= wk; }).length;
    // kaldırılan: eklenenle aynı küme (her tür blok/ağ banı; yalnız /24 değil)
    var removed = (S.events || []).filter(function (e) { return e.t >= wk && (e.type === 'manual_unban' || e.type === 'expire' || e.type === 'limit_gone') && /\//.test(e.cidr || ''); }).length;
    // kontrol edilecek: son N günde işaretlenen farklı kayıt − ondan önceki N günde işaretlenen (aynı ölçü)
    var rwn = (S.review_win || {})[days], rv = S.review.length, rDelta = rwn ? rwn[0] - rwn[1] : (S.review_prev == null ? null : rv - S.review_prev);
    // alt satır: türe göre döküm, yalnız sıfır olmayanlar (şüpheli ağ / atlandı / izinli saldıran / açık servis)
    var rk = { warn: 0, skip: 0, allow: 0, po: 0 };
    S.review.forEach(function (e) { rk[/^warn16/.test(e.type) ? 'warn' : e.type === 'skip_wl' ? 'skip' : e.type === 'part_open' ? 'po' : /^allow_/.test(e.type) ? 'allow' : 'skip']++; });
    // kart dar: en fazla iki parça (önce şüpheli ağ, sonra en kalabalık tür; gerisi "N diğer"), türlerin tamamı ipucunda
    var rks = ['warn', 'skip', 'allow', 'po'].filter(function (k) { return rk[k]; });
    var rfirst = rks.slice(0, 1), rrest = rks.slice(1).sort(function (a, b) { return rk[b] - rk[a]; });
    if (rrest.length === 1) { rfirst.push(rrest[0]); rrest = []; }
    var rpart = function (k) { return '<b' + (k === 'warn' ? ' class="ag-kpi-mw"' : '') + '>' + num(rk[k]) + '</b> ' + esc(t('kr_' + k)); };
    var rsub = '<span title="' + esc(rks.map(function (k) { return num(rk[k]) + ' ' + t('kr_' + k); }).join(', ')) + '">' +
      rfirst.map(rpart).join(' · ') + (rrest.length ? ' · <b>' + num(rrest.reduce(function (a, k) { return a + rk[k]; }, 0)) + '</b> ' + esc(t('kr_other')) : '') + '</span>';
    var R7 = S.runs || {};
    return '<div class="ag-kpis">' +
      kpi('ban', 'acc', t('k_groups'), num(n), delta(added - removed, ''), esc(t('k_dnd', num(dnd))) +
        ((S.asn_banned || []).filter(function (b) { return b.how !== 'cloud'; }).length ? '<br><button class="ag-link" data-act="tab" data-tab="prov">' + esc(t('k_prov', num(S.asn_banned.filter(function (b) { return b.how !== 'cloud'; }).length))) + '</button>' : ''),
        '', '') +
      kpi('alert', rv ? 'warn' : 'ok', t('k_review'), '<span' + (rv ? ' class="warn"' : '') + '>' + num(rv) + '</span>', delta(rDelta, ''),
        rv ? rsub : esc(t('k_review_m', num(S.config.review_days))),
        '', '') +
      usageKpi('list', t('k_perm'), S.usage.perm, R7['p' + days] == null ? -1 : R7['p' + days]) +
      usageKpi('clock', t('k_temp'), S.usage.temp, R7['t' + days] == null ? -1 : R7['t' + days]) + '</div>';
  }

  /* Etkinlik: yığılmış çubuklar; üzerine gelince o günün dökümü, sağda dönem toplamları */
  var SERIES = [['A', 'ch_add', 'var(--ag-d-ban)'], ['P', 'ch_promote', 'var(--ag-d-prom)'], ['T', 'ch_temp', 'var(--ag-d-temp)'], ['W', 'ch_warn', 'var(--ag-d-warn)'], ['S', 'ch_skip', 'var(--ag-d-skip)']];
  function activity() {
    var D = S.daily || {}, days = UI.cd === 7 ? 7 : 30, off = 30 - days, max = 0, tot = 0, sums = {}, cols = [], i;
    var loc = LANG === 'tr' ? 'tr-TR' : 'en-US', H = 128;
    SERIES.forEach(function (s) { sums[s[0]] = 0; });
    for (i = off; i < 30; i++) {
      var sum = 0, vals = SERIES.map(function (s) { var v = (D[s[0]] || [])[i] || 0; sum += v; sums[s[0]] += v; return v; });
      max = Math.max(max, sum); tot += sum; cols.push({ i: i, vals: vals, sum: sum });
    }
    // eksen: 3–4 "yuvarlak" çizgi (1, 2, 5 × 10ⁿ adımı); çubuk boyu bu tepeye göre
    var step = 1, raw = Math.max(1, max) / 3, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    [1, 2, 5, 10].some(function (m) { step = m * mag; return step >= raw; }); step = Math.max(1, Math.round(step));
    var top = Math.max(step, Math.ceil(Math.max(1, max) / step) * step), grid = '', yax = '';
    for (var gv = 0; gv <= top; gv += step) {
      var gy = (gv / top * H).toFixed(1);
      if (gv) grid += '<div class="ag-grid-l" style="bottom:' + gy + 'px"></div>';
      yax += '<span style="bottom:' + gy + 'px">' + num(gv) + '</span>';
    }
    var bars = cols.map(function (c, j) {
      var day = new Date((D.start + c.i * 86400) * 1000);
      var segs = c.vals.map(function (v, k) {
        return v ? '<i style="height:' + Math.max(2, Math.round(v / top * H) - 1) + 'px;background:' + SERIES[k][2] + '"></i>' : '';
      }).join('');
      var tip = c.sum ? '<div class="ag-tip"><b>' + esc(day.toLocaleDateString(loc, { day: 'numeric', month: 'long', weekday: 'long' })) + '</b>' +
        c.vals.map(function (v, k) { return v ? '<div><i style="background:' + SERIES[k][2] + '"></i>' + esc(t(SERIES[k][1])) + '<em>' + num(v) + '</em></div>' : ''; }).join('') + '</div>' : '';
      // baloncuk çubuğun yanında açılır: sol yarıda sağa, sağ yarıda sola (kartın dışına taşmaz)
      var edge = j >= days * 2 / 3 ? ' r' : j < days / 3 ? ' lft' : ' mid';
      return '<div class="ag-c' + edge + (c.sum ? ' has' : '') + '">' + segs + tip + '</div>';
    }).join('');
    var xstep = days === 7 ? 1 : 7, ax = '';
    for (i = 0; i < days; i += xstep) {
      var dd = new Date((D.start + (off + i) * 86400) * 1000);
      ax += '<span style="left:' + (i * 100 / days).toFixed(2) + '%">' + esc(dd.toLocaleDateString(loc, { day: 'numeric', month: 'short' })) + '</span>';
    }
    var totals = SERIES.map(function (s) { return '<div' + (sums[s[0]] ? '' : ' class="z"') + '><i style="background:' + s[2] + '"></i>' + esc(t(s[1])) + '<b>' + num(sums[s[0]]) + '</b></div>'; }).join('');
    return '<section class="ag-card ag-activity"><div class="ag-card-h"><h2>' + IC.chart + t('ch_title_n', days) + '</h2><span class="ag-count">' + t('ch_total', num(tot)) + '</span><div class="ag-grow"></div>' + periodBar() + '</div>' +
      (tot ? '<div class="ag-chart2"><div class="ag-plot"><div class="ag-yax" style="height:' + H + 'px">' + yax + '</div><div class="ag-bars" style="height:' + H + 'px">' + grid + bars + '</div><div class="ag-axis">' + ax + '</div></div>' +
        '<div class="ag-totals">' + totals + '</div></div>'
        : '<div class="ag-empty ag-empty-sm">' + t('ch_empty', num(UI.cd === 7 ? 7 : 30)) + '</div>') + '</section>';
  }

  // ban sebebi: "lfd - (mod_security) mod_security (id:1302) triggered" → "ModSecurity 1302: <kuralın mesajı>"
  // (mesaj cPanel'in ModSecurity eşleşme kaydından, durum çıktısındaki "modsec" alanında; eski kayıtlar da düzelir)
  function whyText(w) {
    w = String(w || '').replace(/^lfd\s*-\s*/, '');
    if (/^\s*\(PERMBLOCK\)\s*$/.test(w)) return t('why_pb');   // eski kayıtlar: motor nedeni kesiyordu (1.15.5 öncesi)
    var m = w.match(/mod_security \(id:(\d+)\)/);
    if (!m) return w;
    var msg = (S.modsec || {})[m[1]];
    return 'ModSecurity ' + m[1] + (msg ? ': ' + msg : '');
  }
  // Günlüklerde denenenler (motorun acct_all'ı: posta, SSH, FTP, cPanel/WHM, web şifresi, web hedefi), servis başına bir parça.
  // Sebepte ModSecurity kural numarası varsa (lfd "id:1302", kısa sebep "ModSecurity 1302") web hedefleri yalnız o kuralınkiler;
  // web en çok 5, çoktan aza. Motorun mail ve Slack satırıyla (acct_text) aynı.
  var AC_ORD = ['mail', 'cp', 'ssh', 'ftp', 'htp', 'web'];
  function acctParts(a, why) {
    if (!a || !a.length) return [];
    var m = /(?:id:|ModSecurity )(\d+)/.exec(why || ''), rid = m ? m[1] : '', G = {};
    a.forEach(function (x) {
      var s = x.s || 'mail';
      if (s === 'web' && rid && x.i !== rid) return;
      (G[s] = G[s] || []).push(x);
    });
    return AC_ORD.filter(function (s) { return G[s]; }).map(function (s) {
      var L = G[s].slice().sort(function (p, q) { return q.n - p.n; }).slice(0, s === 'web' ? 5 : 10);
      return t('ac_' + s, L.map(function (x) { return x.u + ' (' + num(x.n) + ')'; }).join(', '));
    });
  }
  function ipTable(ips, total) {
    if (!ips || !ips.length) return '';
    var rows = ips.map(function (i) {
      var rawWhy = i.why;
      i = Object.assign({}, i, { why: whyText(i.why) });
      if (/PERMBLOCK/.test(i.why) && i.svc && !/^(repeat|other)$/.test(i.svc)) i.why += ' · ' + t('pb_svc', svcLabel(i.svc));
      var ac = acctParts(i.acct || (S.accts || {})[i.ip], rawWhy).join(' · ');
      if (ac) i.why += (i.why ? ' · ' : '') + ac;
      var own = i.owner ? esc(shortOwner(i.owner)) : (i.res === 'kept' ? '<span class="ag-pill ag-pill-n" title="' + esc(t('dnd_h')) + '">' + esc(t('dnd_s')) + '</span>' : '');
      var ak = abKind(i);
      var alp = i.al != null && i.bk ? '<span class="ag-pill ag-pill-warn ag-pill-xs" title="' + esc(t('ab_' + ak + (ak === 'y' && !i.al ? '_n0' : '_n'), ak === 's' ? i.ip : i.al || t('ab_src_none'))) + '">' + esc(t('ab_' + ak)) + '</span> ' : '';
      return '<div class="ag-ip"><span class="ag-mono" data-ip="' + esc(i.ip) + '">' + esc(i.ip) + '</span>' +
        '<span title="' + esc(i.host) + '">' + (i.host ? esc(i.host) : '<span class="ag-muted">—</span>') + '</span>' +
        '<span class="ag-muted" title="' + esc(i.owner || '') + '">' + own + '</span>' +
        '<span class="ag-muted" title="' + esc(i.why) + '">' + alp + esc(i.why) + '</span></div>';
    }).join('');
    var more = total && total > ips.length ? '<div class="ag-ip-more">' + t('and_more', total - ips.length) + '</div>' : '';
    var head = '<div class="ag-ip ag-ip-h"><span>' + esc(t('col_ip')) + '</span><span>' + esc(t('col_host')) + '</span><span>' + esc(t('col_owner')) + '</span><span>' + esc(t('col_reason')) + '</span></div>';
    return '<div class="ag-ips">' + head + rows + more + '</div>';
  }

  // Kontrol edilecekler satırının (şüpheli ağ, atlandı) bilgisi: Neden sütunu (meta), not satırları (det), sağlayıcı notu (pnote),
  // daraltma önerileri. Tablo ve aralık kartı aynı işlevi kullanır — ikisi her zaman aynı şeyi söyler. nIp: IP sayısının yazımı
  // (tabloda IP listesini açan bağlantı, kartta düz metin).
  function rvParts(e, nIp) {
    var is16 = /\/16$/.test(e.cidr), hasIps = e.ips && e.ips.length;
    var meta = e.n == null ? [] : [nIp];   // olay kaydından önceki uyarıda IP sayısı bilinmeyebilir
    var det = [];                // satırın altındaki notlar (uzun açıklamalar sütunu daraltmasın)
    if (e.hist && e.n === 0) { meta = [esc(t('r_gone_s'))]; det.push(esc(t('r_gone'))); }
    if (is16 && e.n) det.push(esc(t('n_subnets', num(e.subnets))));
    if (is16 && e.n !== 0 && !e.aa) det.push(esc(e.perm != null ? [e.perm ? t('r_perm', num(e.perm)) : '', e.temp ? t('r_temp', num(e.temp)) : ''].filter(Boolean).join(' · ') : t(e.type === 'warn16t' ? 'from_temp' : 'from_perm')));
    // sıra önemli: satır tek satıra sığmayınca sondaki kesilir — karar için gereken bilgi önde, sahip adı en sonda
    var narrow = null, apx = null;
    if (is16 && hasIps) {
      var by = {}, sv = {};
      e.ips.forEach(function (x) { var q = pfxOf(x.ip); by[q] = (by[q] || 0) + 1; var k = x.svc || svcOfReason(x.why); sv[k] = (sv[k] || 0) + 1; });
      var top = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })[0];
      if (top && by[top] >= 2 && by[top] >= e.ips.length * 0.6) narrow = { p: top, n: by[top] };
      var known = Object.keys(sv).filter(function (k) { return k !== 'other' && k !== 'repeat'; });
      if (known.length && known.length <= 3) meta.push(esc(countList(sv)));
      else if (!known.length) meta.push('<span title="' + esc(t('p_svc_h')) + '">' + esc(t('r_svc_unk')) + '</span>');
      if (narrow) det.push(esc(t('r_narrow', narrow.p + '.0/24', num(narrow.n), num(e.ips.length))));
      var ap = {};
      e.ips.forEach(function (x) { var b = bitsOf(x.pfx); if (x.pfx && b > 16 && b < 24) ap[x.pfx] = (ap[x.pfx] || 0) + 1; });
      var atop = Object.keys(ap).sort(function (a, b) { return ap[b] - ap[a]; })[0];
      if (atop && ap[atop] >= 2 && ap[atop] >= e.ips.length * 0.6) { apx = { p: atop, n: ap[atop] }; det.push(esc(t('r_apfx', atop, num(apx.n), num(e.ips.length)))); }
    }
    if (e.partial) det.push(esc(t('r_partial', e.partial + (e.partial_svc ? ' · ' + svcNames(e.partial_svc) : '')) + (e.after ? ' · ' + t('r_after') : '')));
    var pnote = '';
    if (e.pnear) {               // saldıranlar banlı sağlayıcıda / bulut listesinde ama port kapalı değil: karar notu, kesilmesin diye ayrı satırda
      var pks = String(e.pnsvc || '').split(',').filter(Boolean);
      pnote = '<div class="ag-row-n">' + esc(t('r_pnear', e.pnear, pks.map(svcLabel).join(', '), pks.map(function (k) { return svcPorts(k, null, false); }).filter(Boolean).join(', '))) + '</div>';
    }
    if (e.wl) det.push('<span title="' + esc(e.wl) + '">' + esc(t('wl', wlShort(e.wl) + (e.wlc ? ' (' + e.wlc + ')' : ''))) + '</span>');   // yorumuyla, öteki satırlarla aynı
    if (e.aa) det.push(esc(t('r_aa', num(e.aa))));
    return { meta: meta, det: det, pnote: pnote, narrow: narrow, apx: apx };
  }
  function review() {
    if (!S.review.length) {
      return '<div class="ag-okbar">' + IC.check + '<b>' + t('no_review') + '</b><span>' + t('k_review_m', num(S.config.review_days)) + '</span></div>';
    }
    var RM = S.repeat_min || 3;
    function repOf(e) { return (e.rep || 0) >= RM ? 1 : 0; }
    // İzinli ama banlandı: lfd banlamış, ama IP bir izin listesinde olduğu için ban işlemiyor. Karar: izinli kalsın mı?
    // izin kaydının kaynağı ve kim kaldırır: izinli servis (eklenti, "hariç tut"), yoksa hangi dosya (sizin kararınız)
    function wlSrc(wl) {
      var sm = /services\.allow \(([^)]+)\)/.exec(wl || '');
      if (sm) return { svc: sm[1] };
      var f = String(wl || '').replace(/ → .*$/, '').replace(/[: ].*$/, '');
      if (/^(CC_IGNORE|CC_ALLOW|RELAYHOSTS)$/.test(f)) f = 'csf.conf (' + f + ')';   // ayar, dosya değil
      return { file: f || '' };
    }
    function rvOwner(e, x) {
      var o = x && x.asn ? { asn: x.asn, cc: x.cc, name: String(x.owner || '').replace(/^AS\d+\s*/, '').replace(/^[^ ]+ - /, '').replace(/,\s*[A-Z]{2}$/, ''), label: x.owner } : ownerOf(/\//.test(e.cidr) ? e.cidr : e.cidr + '/32');
      return { o: o, h: o.asn ? flag(o.cc) + asnB(o.asn) + '<span class="ag-org">' + esc(o.name || '') + '</span>' : '' };   // sahip yoksa hücre boş (telefonda tek "—" satırı olmasın)
    }
    // ortak satır: aynı sütunlar (Ağ/blok · Durum · Neden · Sahip · İşaretlendi · düğme · menü) + not satırı + açılır IP listesi
    function rvRow(e, pill, whyH, btn, mitems, note, ips) {
      var key = 'r:' + e.cidr, open = UI.open[key], ow = rvOwner(e, (e.ips || [])[0]);
      var first = (e.ips || [])[0] ? e.ips[0].ip : e.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
      if (ips) mitems = [{ act: 'toggle', label: open ? t('hide') : t('ips'), icon: 'list', attrs: 'data-key="' + esc(key) + '"' }].concat(mitems);
      return '<div class="ag-item" data-row="' + esc(e.cidr) + '"><div class="ag-tr ag-tr-r">' +
        '<div class="ag-td ag-td-main">' + rvDot(e) + '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(e.cidr) + '</span></div>' +
        '<div class="ag-td ag-td-state">' + pill + '</div>' +
        '<div class="ag-td ag-td-why">' + (whyH || '<span class="ag-muted">—</span>') + '</div>' +
        '<div class="ag-td ag-td-own" title="' + esc(ow.o.label || '') + '">' + ow.h + '</div>' +
        '<div class="ag-td ag-when">' + relT(e.t) + '</div>' +
        '<div class="ag-td ag-td-btn">' + (btn || '') + '</div>' +
        '<div class="ag-td ag-td-act">' + menu('rm:' + e.cidr, mitems) + '</div></div>' +
        '<div class="ag-tr-note">' + (ow.o.asn ? '<span class="ag-own-n">' + ow.h + '</span>' : '') + (note ? '<div>' + note + '</div>' : '') +
          (rvDrop(e) ? '<div class="ag-muted">' + esc(rvDrop(e)) + '</div>' : '') + '</div>' +   // ne zaman kendiliğinden düşer
        (open && ips ? ipTable(e.ips, e.total) : '') + '</div>';
    }
    function exBtn(target, svc) {
      return '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="svcexc" data-t="' + esc(target) + '" data-n="' + esc(svc) + '" title="' + esc(t('dr_exc_h')) + '">' + esc(t('dr_exc_btn')) + '</button>';
    }
    // İzinli ama saldırıyor: tek IP (ban işlemiyor / lfd yoksaydı) ya da bir izin kaydının aralığından birden çok IP
    function abRow(e) {
      var x = (e.ips || [])[0] || {}, src = wlSrc(e.wl), grp = e.type === 'allow_grp';
      // i + tam izin değil = csf.ignore / csf.rignore: yalnız lfd'yi durdurur, güvenlik duvarında izin vermez (elle ban işler)
      var bk = grp ? 'g' : abKind(e);
      var pill = '<span class="ag-pill ag-pill-warn" title="' + esc(t('ab_' + bk + '_h')) + '">' + esc(t('ab_' + bk)) + '</span>';
      var key = 'r:' + e.cidr, sv = {};
      (e.ips || []).forEach(function (i) { var k = i.svc || svcOfReason(i.why); sv[k] = (sv[k] || 0) + 1; });
      var whyH = grp ? '<button class="ag-link" data-act="toggle" data-key="' + esc(key) + '">' + esc(t('n_ip', num(e.n))) + '</button> · ' + esc(countList(sv))
        : esc([x.svc && x.svc !== 'other' ? svcLabel(x.svc) : whyText(x.why), e.cnt > 1 ? t('ab_cnt', num(e.cnt)) : ''].filter(Boolean).join(' · '));
      // izin kaynağı + satırdaki yorum ("csf.allow: 1.2.3.4 (ofis)"); kaynak bulunamadıysa nerelere bakıldığı; dosyadan kaldırma notu yalnız dosya kaynaklarında
      var wlT = e.wl ? wlShort(e.wl) + (e.wlc ? ' (' + e.wlc + ')' : '') : t('ab_src_none');
      var how = src.svc || !e.wl ? '' : ' ' + t(bk === 'y' ? 'ab_y_own' : 'ab_own', src.file || '?');
      var note = bk === 's'
        ? esc(t('ab_s_n', e.cidr)) + (e.acct && e.acct.length ? ' ' + esc(t('ab_s_acct', e.acctf || '', e.acct.map(function (a) { return a.u + ' (' + num(a.n) + ')'; }).join(', '))) : '')
        : '<span title="' + esc(e.wl || '') + '">' + esc(t('ab_' + bk + (bk === 'y' && !e.wl ? '_n0' : '_n'), wlT) + how) + '</span>';   // kaynak yokken CSF'in davranışı söylenmez (ölçülmedi)
      note += (!grp && x.why ? ' ' + esc(t('ab_last', whyText(x.why), rel(x.t))) : '');   // satırın İşaretlendi sütunu ilk kayıt, burada son kayıt ve zamanı
      // menü: IP kartı (aralık gönderilmez) + Yoksay — öteki Kontrol edilecekler satırlarıyla aynı
      return rvRow(e, pill, whyH, src.svc && bk !== 's' ? exBtn(e.cidr, src.svc) : '',
        (x.ip ? [{ act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(x.ip) + '"' }] : [])
          .concat([{ act: 'ignore', label: t('ignore'), icon: 'mute', attrs: 'data-c="' + esc(e.cidr) + '"' }]), note, grp);
    }
    // Kısmi banı yetmiyor: kısmi bandan sonra kapalı olmayan servislere gelen saldırılar blok/ağ eşiğine ulaştı
    function poRow(e) {
      var pill = '<span class="ag-pill ag-pill-part" title="' + esc(t('po_h')) + '">' + esc(t('po')) + '</span>';
      var btn = '<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="chg" data-c="' + esc(e.cidr) + '">' + esc(t('chg')) + '</button>';
      return rvRow(e, pill, esc(countList(e.since || {})), btn,
        [{ act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(e.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1')) + '"' },
         { act: 'ignore', label: t('ignore'), icon: 'mute', attrs: 'data-c="' + esc(e.cidr) + '"' }],
        esc(t('po_n', svcNames(e.svc, e.extra) || '?')), false);
    }
    // uzun listede 20'şer (en önemliler önde: tekrar edenler, sonra en yeni)
    var items = S.review.slice().sort(function (a, b) { return (repOf(b) - repOf(a)) || (b.t - a.t); }).slice(0, lim('rv', 20)).map(function (e) {
      if (e.type === 'allow_ban' || e.type === 'allow_grp') return abRow(e);
      if (e.type === 'part_open') return poRow(e);
      var key = 'r:' + e.cidr, open = UI.open[key], is16 = /\/16$/.test(e.cidr), hasIps = e.ips && e.ips.length;
      var pill = e.type === 'skip_wl' ? '<span class="ag-pill ag-pill-skip"' + evTitle(e.type) + '>' + t('ev_skip_wl') + '</span>'
        : '<span class="ag-pill ag-pill-dw"' + evTitle(e.type) + '>' + esc(t('ev_' + e.type)) + '</span>';
      // IP sayısı tıklanınca IP listesi açılır (ayrı "IP'ler" düğmesi yerine)
      var nIp = e.n == null ? '' : hasIps ? '<button class="ag-link" data-act="toggle" data-key="' + esc(key) + '" aria-expanded="' + !!open + '">' + esc(t('n_ip', num(e.n))) + '</button>' : esc(t('n_ip', num(e.n)));
      var P = rvParts(e, nIp), meta = P.meta, det = P.det, pnote = P.pnote, narrow = P.narrow, apx = P.apx;
      var owner = shortOwner(e.owner || ownerOfIps(e.ips) || ownerOf(e.cidr).label);
      var first = hasIps ? e.ips[0].ip : e.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
      // en dar öneri satırda düğme; ötekiler ve diğer işler ⋯ menüsünde
      var B = [];
      if (narrow) B.push({ act: 'ban24', label: lbl24(narrow.p), icon: 'ban', danger: true, attrs: 'data-t="' + esc(narrow.p) + '"' + tip24(narrow.p) });
      if (apx) B.push({ act: 'banpfx', label: t('banpfx', '/' + bitsOf(apx.p)), icon: 'ban', danger: true, attrs: 'data-c="' + esc(apx.p) + '" title="' + esc(t('banpfx_h', num(Math.pow(2, 32 - bitsOf(apx.p))))) + '"' });
      if (is16) B.push({ act: 'ban16', label: lbl16(pfx(e.cidr)), icon: 'ban', danger: true, attrs: 'data-t="' + esc(pfx(e.cidr)) + '"' });
      else B.push({ act: 'banforce', label: t('ban_anyway'), icon: 'ban', danger: true, attrs: 'data-t="' + esc(pfx(e.cidr)) + '" data-wl="' + esc(e.wl || '') + '"' });
      // satır düğmesi: en dar blok/ağ banı; duyurulan aralık banı (uzun ad) menüde, önerisi not satırında
      var b0 = B.filter(function (x) { return x.act !== 'banpfx'; })[0]; B = B.filter(function (x) { return x !== b0; });
      var swl = /services\.allow \(([^)]+)\): ([0-9.\/]+)/.exec(e.wl || '');    // izinli servis listesi yüzünden atlandı
      var mitems = B.concat([{ act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' },
                             { act: 'ignore', label: t('ignore'), icon: 'mute', attrs: 'data-c="' + esc(e.cidr) + '"' }])
        .concat(swl ? [{ act: 'svcexc', label: t('dr_exc_btn') + ' (' + swl[2] + ')', icon: 'ban', danger: true, attrs: 'data-t="' + esc(swl[2]) + '" data-n="' + esc(swl[1]) + '"' }] : []);
      if (hasIps) mitems.unshift({ act: 'toggle', label: open ? t('hide') : t('ips'), icon: 'list', attrs: 'data-key="' + esc(key) + '"' });
      // sahip: olaydaki IP'lerden ya da sahip önbelleğinden; bayrak + AS + ad (Aktif blok banları ile aynı)
      var o = ownerOf(e.cidr), i0 = hasIps ? e.ips[0] : null;
      if (!o.asn && i0 && i0.asn) o = { asn: i0.asn, cc: i0.cc, name: String(i0.owner || '').replace(/^AS\d+\s*/, '').replace(/^[^ ]+ - /, '').replace(/,\s*[A-Z]{2}$/, ''), label: i0.owner };
      var ownH = o.asn ? flag(o.cc) + asnB(o.asn) + '<span class="ag-org">' + esc(o.name || '') + '</span>' : owner ? '<span class="ag-org">' + esc(owner) + '</span>' : '';   // sahip yoksa boş
      return '<div class="ag-item" data-row="' + esc(e.cidr) + '"><div class="ag-tr ag-tr-r">' +
        '<div class="ag-td ag-td-main">' + rvDot(e, e.hist) + '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(e.cidr) + '</span></div>' +
        '<div class="ag-td ag-td-state">' + pill + '</div>' +
        '<div class="ag-td ag-td-why">' + (meta.length ? meta.join(' · ') : '<span class="ag-muted">—</span>') + '</div>' +
        '<div class="ag-td ag-td-own" title="' + esc(o.label || owner || '') + '">' + ownH + '</div>' +
        '<div class="ag-td ag-when">' + relT(e.t) + '</div>' +
        '<div class="ag-td ag-td-btn"><button class="ag-btn ag-btn-sm ag-btn-danger" data-act="' + b0.act + '" ' + b0.attrs + '>' + esc(b0.label) + '</button></div>' +
        '<div class="ag-td ag-td-act">' + menu('rm:' + e.cidr, mitems) + '</div></div>' +
        // notlar: Durum sütunu hizasından başlar; dar kartta sahip de burada (sahip sütunu gizlenir). "Tekrar ediyor" rozeti de
        // burada, sahibin önünde: ağ sütununda adresi daraltıp gizliyordu, alt satıra inince satırın ilk satır hizasını bozuyordu
        // (sahip satırı geniş ekranda ve telefonda gizli; rozet her düzende görünsün diye kendi kabında, sahibin yanında)
        '<div class="ag-tr-note">' + (repOf(e) ? '<div class="ag-note-top"><span class="ag-pill ag-pill-dw ag-rep" title="' + esc(t('rep_h', num(e.rep))) + '">' + esc(t('rep_n', num(e.rep))) + '</span>' : '') +
          (o.asn || owner ? '<span class="ag-own-n">' + ownH + '</span>' : '') + (repOf(e) ? '</div>' : '') + (det.length ? '<div>' + det.join(' · ') + '</div>' : '') + pnote +
          (rvDrop(e) ? '<div class="ag-muted">' + esc(rvDrop(e)) + '</div>' : '') + '</div>' +
        (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }).join('');
    var head = '<div class="ag-thead ag-tr-r"><span class="ag-th ag-td-main">' + esc(t('col_net')) + '</span><span class="ag-th">' + esc(t('col_state')) + '</span>' +
      '<span class="ag-th">' + esc(t('col_why')) + '</span><span class="ag-th ag-td-own">' + esc(t('col_owner')) + '</span>' +
      '<span class="ag-th ag-when" title="' + esc(t('col_marked_h')) + '">' + esc(t('col_marked')) + '</span><span></span><span></span></div>';
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.alert + t('s_review') + '</h2>' +
      '<span class="ag-count warn">' + S.review.length + '</span>' +
      '<span class="ag-hint">' + t('s_review_h') + '</span></div>' +
      '<div class="ag-card-b ag-tbl">' + head + items + '</div>' + limFoot('rv', 20, S.review.length) + '</section>';
  }

  /* Aktif grup banları: sıralanabilir, sayfalı tablo */
  var PAGE = 10;       // iki tablo da (gruplar, izlenenler) aynı sayfa boyunda
  function isOld(g) {           // otomatik eklenmiş ve "eski" gün sınırını geçmiş blok banı
    var d = (S.expire && S.expire.days) || 365;
    // do not delete (tekrar gelip kalıcıya alınan ya da elle işaretlenen) blok eski sayılmaz — motor da kaldırmaz
    // son 30 günde denenen (sayacına paket gelen) blok da eski sayılmaz — motor da kaldırmaz (BLOCK_ACTIVE_DAYS)
    if (g.hit && nowSec() - g.hit < 30 * 86400) return false;
    return (g.kind === 'perm' || g.kind === 'promoted') && !g.dnd && g.added > 0 && nowSec() - g.added >= d * 86400;
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
      var kindCls = { perm: 'ag-pill-ban', promoted: 'ag-pill-prom', temp: 'ag-pill-temp', manual: 'ag-pill-ban', partial: 'ag-pill-part' }[g.kind] || 'ag-pill-n';
      // kısmi banda kapalı servisler, istisnalı tam banda açık bırakılanlar
      // geçici banın kalan süresi rozetin içinde değil altında (dar sütunda kesiliyordu)
      var gnote = g.kind === 'temp' && g.ttl > 0 ? t('left_short', dur(g.ttl)) : g.kind === 'partial' ? t('g_closed', svcNames(g.svc, g.extra) || t('svc_ports', String(g.ports || '').replace(/_/g, '–'))) : (g.open || g.open_extra) ? t('g_open', svcNames(g.open, g.open_extra)) : '';
      // rozette kısa hâli (satır tek satır kalsın): "kısmi · Web", "geçici · 5 sa", "elle · açık: SSH"; uzun açıklama rozetin ipucunda
      var gshort = g.kind === 'temp' && g.ttl > 0 ? dur(g.ttl) : g.kind === 'partial' ? (svcNames(g.svc, g.extra) || String(g.ports || '').replace(/_/g, '–')) : (g.open || g.open_extra) ? t('g_open', svcNames(g.open, g.open_extra)) : '';
      var first = ev && ev.ips && ev.ips[0] ? ev.ips[0].ip : /\/32$/.test(g.cidr) ? g.cidr.replace(/\/32$/, '') : g.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
      var when = g.added ? relT(g.added) : '—';
      var items = [];
      if (ev && ev.ips && ev.ips.length) items.push({ act: 'toggle', label: open ? t('hide') : t('ips'), icon: 'list', attrs: 'data-key="' + esc(key) + '"' });
      items.push({ act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first) + '"' });
      // geçici blok banı: İzlenenler ve Geçmiş'teki gibi buradan da kalıcıya alınır
      if (g.kind === 'temp' && bitsOf(g.cidr) === 24 && !g.under) items.push({ act: 'promote', label: t('promote'), icon: 'ban', attrs: 'data-t="' + esc(g.cidr.replace(/\.0\/24$/, '')) + '"' });
      if ((g.kind === 'manual' || g.kind === 'partial') && bitsOf(g.cidr) >= 16 && bitsOf(g.cidr) <= 24)
        items.push({ act: 'chg', label: t('chg'), icon: 'sliders', attrs: 'data-c="' + esc(g.cidr) + '"' });
      if (bitsOf(g.cidr) > 16 && bitsOf(g.under) > 16) items.push({ act: 'ban16', label: lbl16(p16(g.cidr)), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16(g.cidr)) + '"' });
      items.push({ act: 'unban', label: t('unban'), icon: 'x', danger: true, attrs: 'data-c="' + esc(g.cidr) + '" data-dnd="' + (g.dnd ? 1 : 0) + '" data-kind="' + esc(g.kind) + '" data-restore="' + (g.restore || 0) + '"' });
      var gtag = g.under ? '<span class="ag-ctag" title="' + esc(t('under_h', g.under)) + '">' + esc(t('under', '/' + bitsOf(g.under))) + '</span>' : g.pcov ? pcovNote(g.pcov) : ccPill(g.cidr);
      return '<div class="ag-item" data-row="' + esc(g.cidr) + '"><div class="ag-tr">' +
        '<div class="ag-td ag-td-main">' + newDot(g.added) + '<span class="ag-cidr" data-ip="' + esc(first) + '">' + esc(g.cidr) + '</span></div>' +
        '<div class="ag-td ag-td-state"><span class="ag-pill ' + kindCls + '" title="' + esc(t('kind_' + g.kind + '_h') + (g.dnd ? ' ' + t('kind_dnd_h') : '') + (gnote ? ' · ' + gnote : '') + (g.hit ? ' · ' + t('g_hit', rel(g.hit)) : '')) + '">' + (g.dnd ? IC.lock : '') +
          '<span class="ag-pill-t">' + esc(t('kind_' + g.kind) + (gshort ? ' · ' + gshort : '')) + '</span></span></div>' +
        // sahip ve onu kapsayan geniş ban yan yana: "/16 içinde", "sağlayıcı banında", "bulut listesinde", "ülke banında"
        // etiket varken AS rozeti yer kaplamasın: AS numarası ipucunda (o.label) duruyor, ad ve etiket görünür kalsın
        '<div class="ag-td ag-td-own" title="' + esc(o.label || '') + '">' + (o.asn ? flag(o.cc) + (gtag ? '' : asnB(o.asn)) + '<span class="ag-org">' + esc(o.name || '') + '</span>' : gtag ? '' : '<span class="ag-muted ag-own-none">—</span>') +
          gtag + '</div>' +
        '<div class="ag-td ag-num-c' + (g.n ? '' : ' ag-num-0') + '">' + (g.n ? num(g.n) + '<span class="ag-mob"> ' + esc(t('singles_s')) + '</span>' : '—') + '</div>' +
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
      if (f !== 'all' && !n && UI.gf !== f) return '';               // boş filtre görünmez (seçiliyse kalır)
      return '<button class="ag-chip' + (UI.gf === f ? ' on' : '') + (n ? '' : ' zero') + '" data-act="gf" data-f="' + f + '">' + t('f_' + f) +
        '<span class="ag-chip-n" title="' + esc(t('t_chipn')) + '">' + num(n) + '</span></button>';
    }).join('');
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.ban + t('s_groups') + '</h2>' +
      '<span class="ag-count" id="ag-gcount">' + groupCount() + '</span><span class="ag-hint ag-hint-l">' + esc(t('s_groups_h')) + '</span><div class="ag-tools"><div class="ag-chips">' + chips + '</div>' +
      '<input class="ag-input ag-gq" id="ag-gq" type="search" placeholder="' + esc(t('g_search')) + '" value="' + esc(UI.gq) + '">' +
      // dar ekranda tablo başlığı (sıralama düğmeleri) gizlenir: aynı sıralamalar bu seçimde
      '<select class="ag-input ag-msort" id="ag-gsort" aria-label="' + esc(t('sort_by')) + '">' + [['added', -1], ['added', 1], ['n', -1], ['cidr', 1], ['kind', 1], ['owner', 1]].map(function (o) {
        var v = o[0] + ':' + o[1], cur = (UI.gs || 'added') + ':' + (UI.gd || -1);
        return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + esc(t('sort_by') + ': ' + t({ added: 'col_added', n: 'col_singles', cidr: 'col_block', kind: 'col_state', owner: 'col_owner' }[o[0]]) + (o[0] === 'added' || o[0] === 'n' ? (o[1] < 0 ? ' ↓' : ' ↑') : '')) + '</option>';
      }).join('') + '</select></div></div>' +
      oldBar() + '<div class="ag-card-b ag-tbl" id="ag-groups-b">' + groupRows() + '</div></section>';
  }

  var EV_CLASS = {
    add24: 'ag-pill-ban', promote: 'ag-pill-prom', temp24: 'ag-pill-temp', skip_wl: 'ag-pill-skip', warn16: 'ag-pill-dw',
    warn16t: 'ag-pill-dw', allow_viol: 'ag-pill-warn', part_open: 'ag-pill-part', clean_temp: 'ag-pill-n', manual_ban: 'ag-pill-ban', manual_change: 'ag-pill-n', manual_unban: 'ag-pill-n',
    manual_forget: 'ag-pill-n', manual_rewatch: 'ag-pill-n', manual_ignore: 'ag-pill-n', manual_unignore: 'ag-pill-n', fix_udp: 'ag-pill-part', provider: 'ag-pill-ban', svc_fail: 'ag-pill-dw', cloud_fail: 'ag-pill-dw', limit_gone: 'ag-pill-dw', config: 'ag-pill-acc', test_mail: 'ag-pill-n', digest: 'ag-pill-n'
  };
  var EV_GROUP = {
    bans: ['add24', 'promote', 'temp24', 'manual_ban'], warn: ['warn16', 'warn16t'], skip: ['skip_wl'], aviol: ['allow_viol'], po: ['part_open'],
    manual: ['manual_ban', 'manual_change', 'manual_unban', 'manual_forget', 'manual_rewatch', 'manual_ignore', 'manual_unignore', 'provider'], clean: ['clean_temp', 'expire', 'fix_udp', 'limit_gone']
  };
  // olay rozeti açıklaması (üzerine gelince); elle işlemler tek açıklamayı paylaşır
  function evTitle(type) {
    var k = 'evh_' + (/^manual_/.test(type) ? 'manual' : type), v = t(k);
    return v === k ? '' : ' title="' + esc(v) + '"';
  }
  // sağlayıcı banı olayı: bir önceki sağlayıcı banı olayına göre ne değişti (yoksa boş → listenin tamamı yazılır)
  function provDiff(e) {
    function m(x) { var o = {}; String(x.asn || '').split(',').filter(Boolean).forEach(function (a) { o[a] = 'p'; }); String(x.all || '').split(',').filter(Boolean).forEach(function (a) { o[a] = 'a'; }); return o; }
    var prev = evList().filter(function (x) { return x.type === 'provider' && x.t < e.t; }).sort(function (a, b) { return b.t - a.t; })[0];
    if (!prev) return '';
    var A = m(prev), B = m(e), add = [], del = [], mv = [], out = [];
    Object.keys(B).forEach(function (k) { if (!A[k]) add.push(k); else if (A[k] !== B[k]) mv.push(t('pv_ev_mv', k, B[k] === 'a' ? t('pv_row_all') : t('pv_row_ports'))); });
    Object.keys(A).forEach(function (k) { if (!B[k]) del.push(k); });
    if (add.length) out.push(t('pv_ev_add', add.join(', ')));
    if (del.length) out.push(t('pv_ev_del', del.join(', ')));
    out = out.concat(mv);
    if ((prev.mode || 'web') !== (e.mode || 'web') && e.asn) out.push(t('pv_ev_mode', t('pv_m_' + (e.mode || 'web'))));
    if (!out.length) return '';
    return out.join(' · ') + ' · ' + t('pv_ev_tot', num(Object.keys(B).length));
  }
  // Olay × kanal tablosu: dört olay sınıfı, e-posta IE_* ve Slack IC_* anahtarları. Eski NOTIFY (all/email/slack) ve DIGEST
  // anahtarlarının etkisi hücrelere çevrilir: NOTIFY=email → Slack sütunu kapalı, NOTIFY=slack → e-posta sütunu kapalı,
  // DIGEST=0 → özet satırı kapalı. Tabloya dokunulunca (evchip) etkin değerler anahtarlara yazılır, NOTIFY=all ve DIGEST=1 olur.
  var EV_KINDS = ['FIREWALL', 'LISTFULL', 'RUN', 'REVIEW', 'DIGEST'];
  function chEff(k) {
    var nt = String(cv('NOTIFY') || 'all'), v = cv(k);
    if (nt === 'email' && k.indexOf('IC_') === 0) return '0';
    if (nt === 'slack' && k.indexOf('IE_') === 0) return '0';
    if (/_DIGEST$/.test(k) && String(cv('DIGEST')) === '0') return '0';
    return v == null || v === '' ? '1' : String(v);
  }
  // Ayar adı ve değeri insan diliyle (kaydetme penceresi ve Ayar geçmişi aynı yazar; ham anahtar / "1 → 0" görünmez)
  function cfgLabel(k) {
    var m = { ALERT_MAIL: 'st_mail', MSG_LANG: 'st_lang', CRON_MIN: 'st_sched', DIGEST: 'st_digest', DIGEST_DAY: 'st_digest_day' };
    return m[k] ? t(m[k]) : (DICT[LANG]['k_' + k] ? t('k_' + k) : k);
  }
  function cfgShow(k, v) {
    v = v == null ? '' : String(v);
    if (v === '') return '';
    if (k === 'ALERT_MAIL' && v === 'whm') return t('mail_whm');
    if (k === 'NOTIFY') return t('nt_' + v);
    if (/^I[EC]_|^(ASN_BAN|SVC_ALLOW|CLOUD_BAN|LOOKUP|DIGEST|BLOCK_EXPIRE_AUTO)$/.test(k)) return v === '1' ? t('on') : t('off');
    if (k === 'ENABLED') return t('en_' + (v === '0' ? 0 : 1));
    if (k === 'ASN_MODE') return t('pv_m_' + v);
    if (k === 'MSG_LANG') return v === 'en' ? 'English' : 'Türkçe';
    if (k === 'DIGEST_DAY' && /^[1-7]$/.test(v)) return t('d' + v);
    if (k === 'CRON_MIN') { var c = { '*/5': 'cron_5', '*/10': 'cron_10', '*/15': 'cron_15', '*/30': 'cron_30', '0': 'cron_0' }[v]; return c ? t(c) : v; }
    return v;
  }
  function cfgListDiff(k, a, b) {   // liste ayarı → ["eklendi: …", "çıkarıldı: …"]; liste değilse null
    if (!/^(SVC_SOURCES|CLOUD_SOURCES|ASN_LIST|ASN_ALL|SVC_EXTRA|CLOUD_EXTRA|SVC_URLS|CLOUD_URLS|SVC_SKIP|SVC_EXCEPT)$/.test(k)) return null;
    var sp = function (v) { return String(v || '').split(/[\s,]+/).filter(Boolean); }, A0 = sp(a), B0 = sp(b);
    var ad = B0.filter(function (x) { return A0.indexOf(x) < 0; }), rm = A0.filter(function (x) { return B0.indexOf(x) < 0; }), o = [];
    if (ad.length) o.push(t('pv_ev_add', ad.join(', ')));
    if (rm.length) o.push(t('pv_ev_del', rm.join(', ')));
    return o.length ? o : null;
  }
  // tmHtml: telefonda görünen saat (.ag-ev-tm2) metnin hemen ardından, rozetlerden önce — önce rozetler arada kalıyor,
  // saat tek başına bir satıra düşüyordu
  function evDetail(e, noteHtml, tmHtml) {
    var d = [];
    if (e.type === 'add24' || e.type === 'promote' || e.type === 'temp24') {
      d.push(t('n_ip', num(e.n)));
    }
    if (e.type === 'warn16' || e.type === 'warn16t') d.push(t('n_ip', num(e.n)), t('n_subnets', num(e.subnets)), e.perm != null ? t('r_mix', num(e.perm), num(e.temp || 0)) : t(e.type === 'warn16t' ? 'from_temp' : 'from_perm'));
    if (e.type === 'skip_wl') { if (e.n != null) d.push(t('n_ip', num(e.n))); if (e.wl) d.push(t('wl', wlShort(e.wl))); }
    // izinli IP'den ihlal: tür (ban işlemiyor / lfd yoksaydı / yoksayılıyor / sunucu IP'si) · servis · son 24 saatte kaç kez · izin kaydı
    if (e.type === 'allow_viol') { d.push(t('ab_' + (e.kind || 'b')), t('av_d', svcNames(e.svc || 'other'), num(e.n || 0))); if (e.src) d.push(t('wl', wlShort(e.src))); }
    if (e.type === 'part_open') d.push(t('po_d', svcNames(e.svc, e.extra), num(e.n || 0)));
    var owner = shortOwner(e.owner || ownerOfIps(e.ips));   // "AS15169 GOOGLE - Google LLC, US" → "AS15169 Google LLC, US" (tablodaki kısa adla aynı); kendi satırında
    if (e.changes) e.changes.forEach(function (c) {
      var dl = cfgListDiff(c.key, c.from, c.to);
      d.push(cfgLabel(c.key) + ': ' + (dl ? dl.join(' · ') : (cfgShow(c.key, c.from) || '—') + ' → ' + (cfgShow(c.key, c.to) || '—')));
    });
    if (e.to) d.push(e.to);
    if (e.by) d.push(t('by', e.by));
    if (e.removed) { var rn = (e.removed.ranges || 0) + (e.removed.singles || 0) + (e.removed.partials || 0) + (e.removed.temps || 0); if (rn) d.push(t('ev_removed', num(rn))); }
    if (e.restored) d.push(t('ev_restored', num(e.restored)));
    if (e.mode === 'svc' && (e.type === 'manual_ban' || e.type === 'manual_change')) d.push(t('ev_svc', svcNames(e.svc, e.extra) || t('svc_ports', String(e.ports || '').replace(/_/g, '–'))));
    if (e.mode === 'exc') d.push(t('ev_exc', svcNames(e.open, e.extra)));
    if (e.type === 'manual_change' && e.mode === 'all') d.push(t('ev_full'));
    if (e.type === 'clean_temp') d.push(t('clean_d'));
    if (e.type === 'fix_udp') d.push(t('fix_udp_d'));
    if ((e.type === 'svc_fail' || e.type === 'cloud_fail') && e.names) d.push(e.names);
    if (e.type === 'provider' && provDiff(e)) d.push(provDiff(e));
    else if (e.type === 'provider') d.push(e.asn || e.all ? [e.asn ? e.asn + ' · ' + t('pv_m_' + (e.mode || 'web')) : '', e.all ? e.all + ' · ' + t('pv_row_all') : ''].filter(Boolean).join(' · ') : t('pv_ev_rm', e.removed || '—'));
    if (e.after) d.push(t('r_after'));
    var fromLog = e.src === 'log';                         // olay kaydından önceki iş: rozet + açıklama
    if (e.until) d.push(e.until >= '9999' ? t('ign_forever_l') : t('until', dayStr(e.until)));   // panelin tarih biçimiyle
    if (e.type === 'expire' && e.age != null) d.push(t('exp_age', num(e.age)));
    var dt = esc(d.join(' · ')), tmA = dt ? (tmHtml || '') : '', tmZ = dt ? '' : (tmHtml || '');   // metin yoksa saat eskisi gibi sonda
    return dt + tmA + (noteHtml || '') + (fromLog ? ' <span class="ag-pill ag-pill-n ag-pill-xs" title="' + esc(t('from_log_h')) + '">' + esc(t('from_log')) + '</span>' : '') + (e.dnd && (e.type === 'add24' || e.type === 'promote' || e.type === 'temp24') ? ' <span class="ag-pill ag-pill-n ag-pill-xs" title="' + esc(t('dnd_h')) + '">' + esc(t('dnd_s')) + '</span>' : '') +
      (owner ? '<div class="ag-ev-o">' + esc(owner) + '</div>' : '') + tmZ;
  }
  var EV_ICON = {
    add24: ['ban', 'd-ban'], manual_ban: ['ban', 'd-ban'], manual_change: ['sliders', 'n'], promote: ['lock', 'd-prom'], temp24: ['clock', 'd-temp'], warn16: ['alert', 'd-warn'], warn16t: ['alert', 'd-warn'],
    skip_wl: ['check', 'd-skip'], allow_viol: ['alert', 'warn'], part_open: ['sliders', 'd-part'], fix_udp: ['sliders', 'd-part'], provider: ['globe', 'd-ban'], svc_fail: ['alert', 'd-warn'], cloud_fail: ['alert', 'd-warn'], limit_gone: ['alert', 'd-warn'], clean_temp: ['x', 'n'], expire: ['hour', 'n'], config: ['sliders', 'acc'], test_mail: ['inbox', 'n'], digest: ['inbox', 'n']
  };
  // olay rengi ve simgesi: türüne göre; kısmi elle ban mavi (kısmi), kaldırılan sağlayıcı banı nötr
  function evCls(e) {
    if (e.type === 'manual_ban' && e.mode === 'svc') return 'ag-pill-part';
    if (e.type === 'provider' && !e.asn && !e.all) return 'ag-pill-n';
    return EV_CLASS[e.type] || 'ag-pill-n';
  }
  function evIcon(e) {
    if (e.type === 'manual_ban' && e.mode === 'svc') return ['ban', 'd-part'];
    if (e.type === 'provider' && !e.asn && !e.all) return ['globe', 'n'];
    return EV_ICON[e.type] || (/^manual_/.test(e.type) ? ['sliders', 'n'] : ['list', 'n']);
  }
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
      return '<button class="ag-chip' + (UI.cf === f ? ' on' : '') + '" data-act="cf" data-f="' + f + '">' + t('cf_' + f) + '<span class="ag-chip-n" title="' + esc(t('t_chipn')) + '">' + num(n) + '</span></button>';
    }).join('') + '</div>'
      : '<div class="ag-chips">' + (SEEN0 > 0 ? ['all', 'new'] : ['all']).concat(['bans', 'warn', 'skip', 'aviol', 'po', 'manual', 'clean']).map(function (f) {
      var n = all.filter(function (e) { return match(e, f); }).length;
      if (!n && f !== 'all' && f !== UI.ef) return '';
      return '<button class="ag-chip' + (UI.ef === f ? ' on' : '') + '" data-act="ef" data-f="' + f + '">' + t('e_' + f) + '<span class="ag-chip-n" title="' + esc(t('t_chipn')) + '">' + num(n) + '</span></button>';
    }).join('') + '</div>';
    var seenC = {};
    // aynı dakikada art arda gelen aynı tür temizlik olayları (geçici ban silindi, eski blok, UDP 443) tek satır
    var GRP = ['clean_temp', 'expire', 'fix_udp'], comp = [];
    shown.forEach(function (e) {
      var last = comp[comp.length - 1];
      if (!cfg && last && GRP.indexOf(e.type) >= 0 && last[0].type === e.type && Math.floor(last[0].t / 60) === Math.floor(e.t / 60)) last.push(e);
      else comp.push([e]);
    });
    function ipOf(e) { return e.ips && e.ips[0] && e.ips[0].ip ? e.ips[0].ip : /\//.test(e.cidr) && !/\/32$/.test(e.cidr) ? String(e.cidr).replace(/\/\d+$/, '').replace(/\.0$/, '.1') : String(e.cidr || '').replace(/\/32$/, ''); }
    function grpRow(g) {
      var e = g[0], key = 'eg:' + e.t + ':' + e.type, open = UI.open[key], ic = evIcon(e), cs = g.map(function (x) { return x.cidr || ''; }).filter(Boolean);
      return '<div class="ag-item"><div class="ag-ev clickable" data-act="toggle" aria-expanded="' + !!open + '" data-key="' + esc(key) + '">' +
        '<div class="ag-ev-ic ' + ic[1] + '">' + IC[ic[0]] + '</div><div class="ag-ev-b"><div class="ag-ev-t"><span class="ag-ev-n">' + esc(t('ev_grp_n', num(g.length))) + '</span>' +
        '<span class="ag-pill ' + evCls(e) + '"' + evTitle(e.type) + '>' + esc(t('ev_' + e.type)) + '</span>' +
        '<span class="ag-ev-time" title="' + esc(new Date(e.t * 1000).toLocaleString(loc())) + '">' + stamp(e.t) + '<span class="ag-chev">' + (open ? '−' : '+') + '</span></span></div>' +
        '<div class="ag-ev-d"><span class="ag-mono">' + esc(cs.slice(0, 3).join(', ')) + '</span>' + (cs.length > 3 ? ' +' + num(cs.length - 3) : '') + ' · ' + evDetail(e, '',
        '<span class="ag-ev-tm2" title="' + esc(new Date(e.t * 1000).toLocaleString(loc())) + '">' + stamp(e.t) + '<span class="ag-chev">' + (open ? '−' : '+') + '</span></span>') + '</div></div>' +
        '<div class="ag-ev-m"><span class="ag-ev-m0"></span></div></div>' +
        (open ? '<div class="ag-grp-l">' + g.map(function (x) { return x.cidr ? '<span class="ag-cidr" data-ip="' + esc(ipOf(x)) + '">' + esc(x.cidr) + '</span>' : ''; }).join('') + '</div>' : '') + '</div>';
    }
    var rows = comp.map(function (g, i) { return g.length > 1 ? grpRow(g) : evRow(g[0], i); }).join('');
    function evRow(e, i) {
      var key = 'e:' + e.t + ':' + e.type + ':' + (e.cidr || i);
      var open = UI.open[key], has = e.ips && e.ips.length;
      // bugünkü durum ve eylemler: kayıt eski olsa da öğenin şu anki hâline göre (not yalnız en yeni satırda)
      var st = !cfg && e.cidr ? itemState(e.cidr) : null, note = '';
      if (st && !seenC[e.cidr]) { seenC[e.cidr] = 1; note = stateNote(e, st); }
      var mitems = st ? itemMenu(e.cidr, e, st) : null;
      var ic = evIcon(e);
      // zaman ve aç/kapa, başlık satırının sağında (rozetin yanında): ayrı sütun telefonda satırı bir satır uzatıyordu
      // telefonda (ag-ev-tm2) ayrıntının sonunda metin olarak: başlıkta sığmayınca tek başına satıra düşüyordu
      // aç/kapa işaretinin yeri her satırda ayrılır (IP listesi yoksa boş): tarih rakamları satırdan satıra kaymasın
      var tmi = stamp(e.t) + '<span class="ag-chev">' + (has ? (open ? '−' : '+') : '') + '</span>', tmt = ' title="' + esc(new Date(e.t * 1000).toLocaleString(loc())) + '"';
      var tm = '<span class="ag-ev-time"' + tmt + '>' + tmi + '</span>', tm2 = '<span class="ag-ev-tm2"' + tmt + '>' + tmi + '</span>';
      return '<div class="ag-item"><div class="ag-ev' + (has ? ' clickable" data-act="toggle" aria-expanded="' + !!open + '" data-key="' + esc(key) : '') + '">' +
        '<div class="ag-ev-ic ' + ic[1] + '">' + IC[ic[0]] + '</div>' +
        '<div class="ag-ev-b"><div class="ag-ev-t">' + newDot(NEW_TYPES.indexOf(e.type) >= 0 ? e.t : 0) +
        // adres de IP kartını açsın (diğer tablolar gibi): tek IP kendisi, blok/ağ için ilk kayıtlı IP ya da ağın .1'i
        (e.cidr ? '<span class="ag-cidr" data-ip="' + esc(e.ips && e.ips[0] && e.ips[0].ip ? e.ips[0].ip
          : /\//.test(e.cidr) && !/\/32$/.test(e.cidr) ? String(e.cidr).replace(/\/\d+$/, '').replace(/\.0$/, '.1') : String(e.cidr).replace(/\/32$/, '')) + '">' + esc(e.cidr) + '</span>' : '') + '<span class="ag-pill ' + evCls(e) + '"' + evTitle(e.type) + '>' + esc(t('ev_' + e.type)) + '</span>' + tm + '</div>' +
        '<div class="ag-ev-d">' + evDetail(e, note ? ' <span class="ag-pill ag-pill-n ag-pill-xs ag-ev-st" title="' + esc(t('st_tip')) + '">' + esc(note) + '</span>' : '', tm2) + '</div></div>' +
        '<div class="ag-ev-m">' + (mitems ? menu('hm:' + key, mitems) : '<span class="ag-ev-m0"></span>') + '</div></div>' +   // menüsüz satırda yer tutucu: zaman sütunu kaymasın
        (open ? ipTable(e.ips, e.total) : '') + '</div>';
    }
    var more = list.length > shown.length || (EVL && EVMORE) ? '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="evmore"' +
      (EVBUSY && EV_SHORT ? ' disabled>' + t('ev_loading') : '>' + t('more')) + '</button></div>' : '';
    return '<section class="ag-card" id="' + (cfg ? 'ag-cfglog' : 'ag-events') + '"><div class="ag-card-h"><h2>' + (cfg ? IC.sliders + t('s_cfglog') : IC.list + t('s_events')) + '</h2>' +
      (chips ? '<div class="ag-tools">' + chips + '</div>' : '') + '</div>' +
      // olay kaydı okunamadıysa liste yalnız durum çıktısındaki son olaylardan: eksik olabileceği söylenir
      (EVERR ? '<div class="ag-oldbar ag-svcfail">' + IC.alert + '<span>' + esc(t('ev_err', EVERR)) + '</span></div>' : '') +
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
    var name = String(a.name || '').replace(/^[^ ]+ - /, '').replace(/,\s*[A-Z]{2}$/, '');
    return '<div class="ag-asn-r"><span class="ag-rank">' + (i + 1) + '</span><div class="ag-asn-m">' +
      '<div class="ag-asn-t">' + flag(a.cc) + '' + asnB(a.asn, a.name) + '<span class="ag-org" title="' + esc(a.name) + '">' + esc(name) + '</span></div>' +
      '<div class="ag-asn-b" title="' + esc(t(UI.at === 'blk' ? 'asn_bar_blk' : UI.at === 'im' ? 'asn_bar_im' : 'asn_bar_atk')) + '"><i style="width:' + w + '%"></i>' + (w2 ? '<i class="o" style="width:' + w2 + '%"></i>' : '') + '</div><div class="ag-sub">' + sub + '</div></div>' +
      (ASN_ROW_ACT && a.asn ? asnAddBtn('AS' + a.asn) : '') + '</div>';
  }
  var ASN_ROW_ACT = false;      // Sağlayıcılar sekmesinde sağlayıcı satırlarına "Banla…" düğmesi
  function asnAddBtn(a) {
    var inl = CFG && (',' + String(cv('ASN_LIST') || '') + ',' + String(cv('ASN_ALL') || '') + ',').indexOf(',' + a + ',') >= 0 && String(cv('ASN_BAN')) === '1';
    var saved = CFG && (',' + String(CFG.values.ASN_LIST || '') + ',' + String(CFG.values.ASN_ALL || '') + ',').indexOf(',' + a + ',') >= 0 && String(CFG.values.ASN_BAN) === '1';
    return inl ? '<span class="ag-pill ag-pill-ban ag-asn-act" title="' + esc(t(saved ? 'pv_inlist_h' : 'pv_inlist_uh')) + '">' + esc(t(saved ? 'pv_inlist2' : 'pv_inlist_u')) + '</span>'
      : '<button class="ag-btn ag-btn-sm ag-btn-danger ag-asn-act" data-act="asnadd" data-v="' + esc(a) + '" title="' + esc(t('pv_add_h')) + '">' + esc(t('pv_add')) + '</button>';
  }
  // uzun listeler başta kısa: UI.lim[anahtar] kadar satır; altbilgi "5 / 23 gösteriliyor · Daha fazla · Hepsi · Daralt"
  function lim(key, def) { UI.lim = UI.lim || {}; return UI.lim[key] || def; }
  function limFoot(key, def, total) {
    var n = lim(key, def);
    if (total <= def) return '';
    var shown = Math.min(n, total);
    return '<div class="ag-card-f ag-limf"><span class="ag-muted">' + esc(t('lim_shown', num(shown), num(total))) + '</span>' +
      (shown < total ? '<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="limmore" data-k="' + key + '" data-d="' + def + '">' + esc(t('lim_more')) + '</button>' +
        '<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="limall" data-k="' + key + '" data-n="' + total + '">' + esc(t('lim_all')) + '</button>' : '') +
      (shown > def ? '<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="limless" data-k="' + key + '">' + esc(t('lim_less')) + '</button>' : '') + '</div>';
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
    return list.slice(0, lim('asn:' + UI.at, 5)).map(function (a, i) {
      var name = String(a.name || '').replace(/,\s*[A-Z]{2}$/, ''), L = [];
      // her bilgi kendi satırında: ban sayısı ve son saldırı / saldırılan servisler / sayılmayanlar
      var head = [];
      if (a.singles) head.push('<b>' + esc(t('p_t2', num(a.singles))) + '</b>');
      if (a.groups) head.push('<b>' + esc(t('p_g2', num(a.groups))) + '</b>');
      L.push(head.join(', ') + (a.last > 0 ? ' <span class="ag-muted">· ' + esc(t('p_last2', rel(a.last))) + '</span>' : ''));
      if (a.svc) L.push('<span' + (/(^|,)repeat:/.test(a.svc) ? ' title="' + esc(t('p_svc_h')) + '"' : '') + '>' + esc(t('p_svc', svcList(a.svc))) + '</span>');
      if (a.cloud) L.push('<span class="ag-muted" title="' + esc(t('p_cl_h')) + '">' + esc(t('p_cl3', num(a.cloud), a.cs ? t('cl_' + a.cs) : t('pv_lay_cl'))) + '</span>');
      if (a.blocks) L.push('<span class="ag-muted" title="' + esc(t('p_b_h')) + '">' + esc(t('p_b2', num(a.blocks))) + '</span>');
      var tw = topWhy(String(a.asn)) || (a.why ? whyText(a.why) : '');
      var whyl = '<div class="ag-asn-w" title="' + esc(tw) + '">' + esc(tw ? t('asn_why', tw) : t('asn_why0')) + '</div>';
      // Öneri: en az 5 kendi grup banı (≥15 saldırgan, 5 ayrı blok) ve CC_DENY'de değilse.
      // port listesiyle banlı sağlayıcı: sıralamada yalnız açık servislere saldırı sürdüğü için var
      var dp = S.dports || [], dps = (dp[0] ? 'TCP ' + dp[0] : '') + (dp[0] && dp[1] ? ' · ' : '') + (dp[1] ? 'UDP ' + dp[1] : '');
      var tail = a.denied ? '<div><span class="ag-pill ag-pill-part ag-pill-xs" title="' + esc(t('asn_pban_h')) + '">' + esc(t('asn_pban', dps || '—')) + '</span></div>'
        : a.groups >= 5 ? '<div><button class="ag-link" data-act="asnhint" data-asn="' + esc(a.asn) + '" data-name="' + esc(name) + '" data-g="' + num(a.groups) + '" title="' + esc(t('asn_hint_h')) + '">' + t('asn_hint') + '</button></div>' : '';
      return asnRow(i, a, pct(wt(a), max), '<div class="ag-asn-ls">' + L.map(function (x) { return '<div>' + x + '</div>'; }).join('') + '</div>' + tail + whyl, a.blocks ? pct(a.blocks * 4, max) : 0);
    }).join('');
  }
  function asnBlocks() {        // csf.deny'deki başka kaynaklı aralıklar
    var list = S.blocks_top || [], max = 0;
    list.forEach(function (a) { max = Math.max(max, a.blocks); });
    return list.slice(0, lim('asn:' + UI.at, 5)).map(function (a, i) {
      var parts = [t('p_bn', num(a.blocks))];
      if (a.groups) parts.push('<span class="ag-muted">' + t('p_g', num(a.groups)) + '</span>');
      if (a.singles) parts.push('<span class="ag-muted">' + t('p_t', num(a.singles)) + '</span>');
      return asnRow(i, a, pct(a.blocks, max), parts.join(' · ') + (a.denied ? ' · <span class="ag-pill ag-pill-ok">' + t('asn_denied') + '</span>' : ''));
    }).join('');
  }
  function imReason(k) { var v = t('imr_' + k); return v === 'imr_' + k ? t('imr_other', k) : v; }   // Imunify360 sebep kodu → açıklama
  function asnImunify() {       // Imunify360'ın bu sunucudaki kendi kara listesi
    var im = S.imunify || {}, list = im.top || [], max = 0;
    list.forEach(function (a) { max = Math.max(max, a.count); });
    return list.slice(0, lim('asn:' + UI.at, 5)).map(function (a, i) {
      var rs = (a.reasons || []).map(function (r) { return '<span class="ag-reason" title="' + esc(imReason(r[0]) + ' · ' + t('im_rsn_n', num(r[1]))) + '">' + esc(r[0]) + ' <b>' + num(r[1]) + '</b></span>'; }).join('');
      return asnRow(i, a, pct(a.count, max), '<b class="ag-imc">' + t('im_n', num(a.count)) + '</b>' + (rs ? '<span class="ag-reasons">' + rs + '</span>' : ''));
    }).join('');
  }
  function topAsn() {
    var im = S.imunify || {}, tabs = [['atk', t('at_atk')], ['blk', t('at_blk')]];
    if (im.present) tabs.push(['im', t('at_im')]);       // banlılar sıralamaya girmez: ayrı kart (bannedAsn)
    if (!tabs.some(function (x) { return x[0] === UI.at; })) UI.at = 'atk';
    var chips = '<div class="ag-chips ag-chips-full">' + tabs.map(function (x) {
      return '<button class="ag-chip' + (UI.at === x[0] ? ' on' : '') + '" data-act="at" data-t="' + x[0] + '">' + esc(x[1]) + (x[2] ? '<span class="ag-chip-n" title="' + esc(t('t_chipn')) + '">' + num(x[2]) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
    var body, hint;
    var dp = S.dports || [], pk = (dp[0] ? 'TCP ' + dp[0] : '') + (dp[0] && dp[1] ? ' · ' : '') + (dp[1] ? 'UDP ' + dp[1] : '');
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
    body += limFoot('asn:' + UI.at, 5, nAll.length);
    var tabLink = ASN_ROW_ACT ? '' : '<button class="ag-link" data-act="tab" data-tab="prov">' + esc(t('pv_open_tab')) + '</button>';
    if (ASN_ROW_ACT) hint = esc(t('pv_top_h')) + ' ' + hint;
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.globe + t('s_asn') + '</h2><span class="ag-count">' + num(nAll.length) + '</span>' + tabLink + chips +
      // Sağlayıcılar'da uzun açıklama; Genel bakış'ta tek satır (sekmenin ne gösterdiği)
      '<span class="ag-hint" style="width:100%">' + (ASN_ROW_ACT ? hint : esc(t('at_' + UI.at + '_s'))) + '</span></div><div class="ag-card-b">' + body + '</div></section>';
  }
  // Banlı sağlayıcılar: sağlayıcı banında ya da bütün banları bir kiralık sunucu listesinde kalanlar — sıralama değil, şu anki
  // durum (nasıl kapalı, CSF kümeyi yükledi mi); o yüzden sıralama kartının sekmesi değil, kendi kartı. Banlı yoksa kart yok.
  function bannedAsn() {
    var BN = S.asn_banned || [];
    if (!BN.length) return '';
    var dp = S.dports || [], pk = (dp[0] ? 'TCP ' + dp[0] : '') + (dp[0] && dp[1] ? ' · ' : '') + (dp[1] ? 'UDP ' + dp[1] : '');
    var body = BN.slice(0, lim('asn:ban', 5)).map(function (b, i) {
      var nm = String(b.name || '').replace(/^[^ ]+ - /, '').replace(/,\s*[A-Z]{2}$/, '');
      var how = b.how === 'cloud' ? '<span class="ag-pill ag-pill-part ag-pill-xs" title="' + esc(t('bn_cloud_h')) + '">' + esc(t('bn_cloud', t('cl_' + b.src))) + '</span>'
        : b.how === 'all' ? '<span class="ag-pill ag-pill-ban ag-pill-xs" title="' + esc(t('bn_all_h')) + '">' + esc(t('bn_all')) + '</span>'
        : '<span class="ag-pill ag-pill-part ag-pill-xs" title="' + esc(t('bn_ports_h')) + '">' + esc(pk || '—') + '</span>';
      var ld = b.how === 'cloud' ? '' : b.n === 0 ? (setsLoading() ? ' · <span class="ag-muted" title="' + esc(t('pv_set_load_h')) + '">' + esc(t('pv_set_load')) + '</span>' : ' · <span class="ag-warn-t">' + esc(t('bn_nl')) + '</span>') : b.n > 0 ? ' · ' + esc(t('pv_set_n', num(b.n))) : '';
      // sıra numarası yok: bu bir sıralama değil liste (numara yalnız "En çok engellenen"de)
      return '<div class="ag-asn-r"><div class="ag-asn-m"><div class="ag-asn-t">' + asnB(b.asn, b.name) + '<span class="ag-org" title="' + esc(b.name || '') + '">' + esc(nm) + '</span></div>' +
        '<div class="ag-sub">' + how + ld + '</div></div></div>';
    }).join('') + limFoot('asn:ban', 5, BN.length);
    var tabLink = ASN_ROW_ACT ? '' : '<button class="ag-link" data-act="tab" data-tab="prov">' + esc(t('pv_open_tab')) + '</button>';
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.globe + t('s_asn_ban') + '</h2><span class="ag-count">' + num(BN.length) + '</span>' + tabLink +
      '<span class="ag-hint" style="width:100%">' + esc(t('ban_h')) + '</span></div><div class="ag-card-b">' + body + '</div></section>';
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
        '<div class="ag-td ag-td-own" title="' + esc(o.label || '') + '">' + (o.asn ? flag(o.cc) + '' + asnB(o.asn, o.name) + '<span class="ag-org">' + esc(o.name || '') + '</span>' : '<span class="ag-muted ag-own-none">—</span>') + '</div>' +
        '<div class="ag-td ag-when ag-td-since">' + esc(dayStr(p.since)) + '</div>' +
        '<div class="ag-td ag-td-left"><div class="ag-left' + urg + '"><div class="ag-days"><i style="width:' + pct + '%"></i></div><span>' + t('days_left', num(left)) + '</span></div></div>' +
        '<div class="ag-td ag-td-act">' + menu('pm:' + p.prefix, pitems.concat(p.under ? [] : [{ act: 'promote', label: t('promote'), icon: 'ban', attrs: 'data-t="' + esc(p.prefix) + '"' }])
                                .concat(bitsOf(p.under) > 16 ? [{ act: 'ban16', label: lbl16(p16(p.prefix)), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16(p.prefix)) + '"' }] : []).concat([
                                { act: 'rewatch', label: t('rewatch'), icon: 'clock', attrs: 'data-t="' + esc(p.prefix) + '"' },
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
      '<span class="ag-hint" style="width:100%">' + t('s_pending_h', num(S.config.tt24 || S.config.t24 || 3)) + '</span></div>' +
      '<div class="ag-card-b ag-tbl">' + body + '</div></section>';
  }

  function ignored() {
    if (!S.ignored.length) return '';
    // kart dar sütunda: satır başına iki satır (aralık ····· Yoksaymayı kaldır / bitiş · yoksayan); dört sütunlu düzen
    // kartın dışına taşıp düğmeyi gizliyordu
    var rows = S.ignored.slice(0, lim('ign', 10)).map(function (g) {   // uzun listede 10'ar 10'ar
      var until = g.until >= '9999' ? t('ign_forever') : dayStr(g.until);
      // işlemler ⋯ menüsünde (öteki kartlarla aynı): iki düğme dar sütuna sığmıyordu
      var items = [{ act: 'ignore', label: t('ign_change'), icon: 'clock', attrs: 'data-c="' + esc(g.cidr) + '" data-chg="1" data-until="' + esc(until) + '"' },
                   { act: 'unignore', label: t('unignore'), icon: 'x', attrs: 'data-c="' + esc(g.cidr) + '"' }];
      return '<div class="ag-item" data-row="' + esc(g.cidr) + '"><div class="ag-tr ag-tr-i"><div class="ag-td ag-td-main"><span class="ag-cidr" data-ip="' + esc(String(g.cidr).replace(/\/\d+$/, '').replace(/\.0$/, '.1')) + '">' + esc(g.cidr) + '</span></div>' +
        '<div class="ag-td ag-td-until"><span title="' + esc(t('col_until')) + '">' + esc(until) + '</span> · <span title="' + esc(t('col_by')) + (g.since ? ' · ' + new Date(g.since * 1000).toLocaleString(loc()) : '') + '">' +
          esc(g.since ? t('ign_who', g.by, rel(g.since)) : g.by) + '</span></div>' +
        '<div class="ag-td ag-td-act">' + menu('im:' + g.cidr, items) + '</div></div></div>';
    }).join('');
    var head = '<div class="ag-thead ag-tr-i"><span class="ag-th">' + esc(t('col_net')) + '</span><span class="ag-th">' + esc(t('col_until')) + '</span><span></span></div>';
    return '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.mute + t('s_ignored') + '</h2><span class="ag-count">' + S.ignored.length + '</span>' +
      '<span class="ag-hint" style="width:100%">' + esc(t('s_ignored_h')) + '</span></div>' +
      '<div class="ag-card-b ag-tbl">' + head + rows + '</div>' + limFoot('ign', 10, S.ignored.length) + '</section>';
  }

  /* ── Ayarlar sekmesi ───────────────────────────────────────────── */
  var RANGES = {
    THRESHOLD_24: [2, 50], THRESHOLD_24_PERMANENT: [2, 100], THRESHOLD_16: [2, 500], THRESHOLD_TEMP_24: [2, 50],
    THRESHOLD_TEMP_16: [2, 500], LOOKUP_TIMEOUT: [1, 10], SAYAC_RETENTION_DAYS: [7, 730], REVIEW_DAYS: [1, 90], BLOCK_EXPIRE_DAYS: [30, 3650], BLOCK_ACTIVE_DAYS: [1, 365], OWNER_TTL_DAYS: [1, 180], IMUNIFY_REFRESH_MIN: [10, 1440], CLOUD_REFRESH_DAYS: [1, 30], CLOUD_FAIL_DAYS: [1, 30], SVC_REFRESH_DAYS: [1, 30], SVC_FAIL_DAYS: [1, 30], GEO_REFRESH_DAYS: [7, 90], LOG_ROTATE_MB: [1, 100], LOG_ROTATE_KEEP: [1, 52], LOG_KEEP_DAYS: [1, 365], EVENTS_DAYS: [30, 730], RUN_DAYS: [31, 365]
  };
  var TRY_KEYS = ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24', 'LOOKUP', 'LOOKUP_TIMEOUT', 'SAYAC_RETENTION_DAYS', 'REVIEW_DAYS'];
  function cv(k) { return DRAFT[k] !== undefined ? DRAFT[k] : (CFG ? CFG.values[k] : ''); }
  function setNorm(k, v) {      // ASN ve kaynak listeleri küme gibi karşılaştırılır
    if (['ASN_LIST', 'ASN_ALL', 'SVC_SOURCES'].indexOf(k) < 0) return String(v == null ? '' : v);
    var a = String(v || '').toUpperCase().replace(/\s/g, '').split(',').filter(Boolean);
    return a.filter(function (x, i) { return a.indexOf(x) === i; }).sort().join(',');
  }
  function changedKeys() { return Object.keys(DRAFT).filter(function (k) { return setNorm(k, DRAFT[k]) !== setNorm(k, CFG.values[k]); }); }
  function cfgErrors() {
    var e = {};
    Object.keys(RANGES).forEach(function (k) {
      var v = String(cv(k)), r = RANGES[k];
      if (!/^\d{1,6}$/.test(v) || +v < r[0] || +v > r[1]) e[k] = t('range_v', r[0], r[1]);
    });
    // Yerel adresler de geçerli ("root", "root@localhost"); kural script'teki cfg_check ile aynı.
    if (String(cv('ALERT_MAIL')) !== 'whm' && !/^[A-Za-z0-9._%+-]+(@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*)?$/.test(String(cv('ALERT_MAIL')))) e.ALERT_MAIL = t('mail_bad');
    if (!e.THRESHOLD_24 && !e.THRESHOLD_24_PERMANENT && +cv('THRESHOLD_24_PERMANENT') < +cv('THRESHOLD_24')) e.THRESHOLD_24_PERMANENT = t('rule_dnd');
    ['ASN_LIST', 'ASN_ALL'].forEach(function (k) { if (!/^(AS\d{1,10}(,AS\d{1,10}){0,49})?$/.test(String(cv(k) || '').toUpperCase().replace(/\s/g, ''))) e.ASN_LIST = t('bad_asn_list'); });
    ['CLOUD_TCP', 'CLOUD_UDP'].forEach(function (k) { if (!/^(\d{1,5}(:\d{1,5})?(,\d{1,5}(:\d{1,5})?){0,14})?$/.test(String(cv(k) || ''))) e[k] = t('bad_ports'); });
    if (String(cv('CLOUD_BAN')) === '1' && !e.CLOUD_TCP && !e.CLOUD_UDP && !String(cv('CLOUD_TCP') || '') && !String(cv('CLOUD_UDP') || '')) e.CLOUD_TCP = t('cl_noports');
    var cu = String(cv('CLOUD_URLS') || '').split(/\s+/).filter(Boolean).filter(function (x) { return !/^[a-z0-9-]{1,40}\|https:\/\/[A-Za-z0-9._~:\/?#@=%+&-]{4,255}$/.test(x); });
    if (cu.length) e.CLOUD_URLS = t('bad_svcu', cu[0].replace(/^[^|]*\|/, ''));
    ['ASN_TCP', 'ASN_UDP'].forEach(function (k) { if (!/^(\d{1,5}(:\d{1,5})?(,\d{1,5}(:\d{1,5})?){0,14})?$/.test(String(cv(k) || ''))) e[k] = t('bad_ports'); });
    var bx = String(cv('SVC_EXTRA') || '').split(/\s+/).filter(Boolean).filter(function (x) { return !/^[A-Za-z0-9._-]{1,40}\|(https:\/\/[A-Za-z0-9._~:\/?#@=%+&-]{4,255}|\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?)$/.test(x); });
    // hariç tutulanlar: motorla aynı kural (IPv4 adres ya da /8–/32 aralık); hatalı satır kaydetmeden önce görünür
    var ex = String(cv('SVC_EXCEPT') || '').split(/[\s,]+/).filter(Boolean).filter(function (x) { return !/^\d{1,3}(\.\d{1,3}){3}(\/([89]|[12]\d|3[0-2]))?$/.test(x); });
    if (ex.length) e.SVC_EXCEPT = t('bad_svce', ex[0]);
    if (bx.length) e.SVC_EXTRA = t('bad_svcx', bx[0]);
    else if (String(cv('SVC_EXTRA') || '').split(/\s+/).filter(Boolean).length > 50) e.SVC_EXTRA = t('bad_svcx_n');
    var bu = String(cv('SVC_URLS') || '').split(/\s+/).filter(Boolean).filter(function (x) { return !/^[a-z0-9-]{1,40}\|https:\/\/[A-Za-z0-9._~:\/?#@=%+&-]{4,255}$/.test(x); });
    if (bu.length) e.SVC_URLS = t('bad_svcu', bu[0].replace(/^[^|]*\|/, ''));
    var cx = String(cv('CLOUD_EXTRA') || '').split(/\s+/).filter(Boolean);
    var cxb = cx.filter(function (x) { return !/^[a-z0-9-]{1,30}\|https:\/\/[A-Za-z0-9._~:\/?#@=%+&-]{4,255}$/.test(x); });
    if (cxb.length) e.CLOUD_EXTRA = t('bad_clx', cxb[0]); else if (cx.length > 20) e.CLOUD_EXTRA = t('bad_clx_n');
    return e;
  }
  function loadCfg() {
    if (cfgLoading) return;
    cfgLoading = true;
    api('config_get').then(function (d) {
      cfgLoading = false;
      if (!d || !d.ok) { toast(tErr((d && (d.message || d.error)) || '?'), 'bad'); return; }
      CFG = d; DRAFT = {}; UI.asnRaw = null; render();
      if (UI.pendingAsn && UI.tab === 'prov') { var pa = UI.pendingAsn; UI.pendingAsn = null; ACTIONS.asnadd({ getAttribute: function () { return pa; } }); }
    }).catch(function (e) { cfgLoading = false; toast(tErr(e.message), 'bad'); });
  }
  function field(k, errs) {
    var r = RANGES[k], changed = CFG && String(cv(k)) !== String(CFG.values[k]);
    return '<div class="ag-field' + (errs[k] ? ' bad' : '') + (changed ? ' changed' : '') + '"><div class="ag-field-l"><label for="ag-f-' + k + '">' + t('k_' + k) + '</label>' +
      '<span class="ag-sub">' + t('default_v', esc(CFG.defaults[k])) + '</span></div>' +
      // sayı kutusu: − / + düğmeleriyle (tarayıcının küçük oklarına bağımlı değil), dar; sınırlar RANGES'tan
      '<div class="ag-numwrap"><button type="button" class="ag-numbtn" data-act="numstep" data-k="' + k + '" data-d="-1" tabindex="-1" aria-label="−">−</button>' +
      '<input class="ag-input ag-num" id="ag-f-' + k + '" data-cfg="' + k + '" type="number" inputmode="numeric" min="' + r[0] + '" max="' + r[1] + '" step="1" value="' + esc(cv(k)) + '">' +
      '<button type="button" class="ag-numbtn" data-act="numstep" data-k="' + k + '" data-d="1" tabindex="-1" aria-label="+">+</button></div>' +
      '<div class="ag-field-h">' + (errs[k] ? esc(errs[k]) : t('h_' + k)) + '</div><div class="ag-field-i">' + esc(thrImpact(k)) + '</div></div>';
  }
  // Eşiğin etkisi: motorun verdiği ağ başına, blok başına "kalıcı:geçici" sayılarıyla (S.dist). Motordaki gibi:
  // eşiği geçen bloklar banlanır ve ağ sayımına girmez; ağda kalıcı ve geçici tekiller birlikte sayılır.
  function distCalc(t24, tt24, t16) {
    var D = (S && S.dist) || {}, b = 0, tb = 0, n = 0;
    Object.keys(D).forEach(function (net) {
      var sum = 0, blocks = 0;
      D[net].forEach(function (pair) {
        var q = String(pair).split(':'), pc = +q[0] || 0, tc = +q[1] || 0;
        if (pc >= t24) { b++; return; }
        if (tc >= tt24) { tb++; return; }
        if (pc + tc > 0) { sum += pc + tc; blocks++; }
      });
      if (sum >= t16 && blocks >= 2) n++;
    });
    return { b: b, tb: tb, n: n };
  }
  function thrImpact(k) {
    if (!CFG || !S || !S.dist || String(cv(k)) === String(CFG.values[k]) || !(+cv(k) > 0)) return '';
    if (['THRESHOLD_24', 'THRESHOLD_TEMP_24', 'THRESHOLD_16'].indexOf(k) < 0) return '';
    // fark gösterilir: eşiği zaten aşıp banlanmamış bloklar (beyaz liste, yoksayma) iki hesapta da aynı kalır
    if (+cv(k) > +CFG.values[k]) return t('imp_up');
    var V = CFG.values, now = distCalc(+cv('THRESHOLD_24'), +cv('THRESHOLD_TEMP_24'), +cv('THRESHOLD_16')),
        was = distCalc(+V.THRESHOLD_24, +V.THRESHOLD_TEMP_24, +V.THRESHOLD_16);
    var d = k === 'THRESHOLD_24' ? now.b - was.b : k === 'THRESHOLD_TEMP_24' ? now.tb - was.tb : now.n - was.n;
    return d > 0 ? t(k === 'THRESHOLD_24' ? 'imp_b' : k === 'THRESHOLD_TEMP_24' ? 'imp_tb' : 'imp_n', num(d)) : t('imp_same');
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
    // hata varsa hangi bölümde olduğu yazılır (Kaydet o yüzden kapalı)
    var badIn = bad ? settingsSections().filter(function (x) { return x.keys.some(function (k) { return errs[k]; }); }).map(function (x) { return x.label; }) : [];
    return '<div class="ag-savebar"><span>' + t('dirty_n', ch.length) + (badIn.length ? ' · <span class="ag-warn-t">' + esc(t('save_bad_in', badIn.join(', '))) + '</span>' : '') + '</span><div class="ag-grow"></div>' +
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
    var isWhm = String(cv('ALERT_MAIL')) === 'whm';
    // olay × kanal tablosu (EV_KINDS, chEff); bir kanalın kartı (e-posta adresi / Slack denemesi) yalnız o kanala en az bir olay gidiyorsa çizilir
    var EVK = EV_KINDS.map(function (x) { return [x, 'ic_' + { FIREWALL: 'fw', LISTFULL: 'list', RUN: 'run', REVIEW: 'review', DIGEST: 'digest' }[x]]; });
    var mOn = EV_KINDS.some(function (x) { return chEff('IE_' + x) === '1'; }), sOn = EV_KINDS.some(function (x) { return chEff('IC_' + x) === '1'; });
    var evKeys = ['NOTIFY', 'DIGEST'].concat(EVK.map(function (x) { return 'IE_' + x[0]; }), EVK.map(function (x) { return 'IC_' + x[0]; }));
    var evChanged = evKeys.some(function (k) { return DRAFT[k] !== undefined && String(DRAFT[k]) !== String(CFG.values[k]); });
    var ntCh = '<div class="ag-field w' + (evChanged ? ' changed' : '') + '"><div class="ag-field-l"><label>' + t('st_events_f') + '</label></div>' +
      '<table class="ag-evm"><thead><tr><th></th><th>' + esc(t('st_mail_c')) + '</th><th>Slack</th></tr></thead><tbody>' +
      EVK.map(function (x) { return '<tr><td>' + esc(t(x[1])) + '</td>' + ['IE_', 'IC_'].map(function (p) { var k = p + x[0], on = chEff(k) === '1';
        return '<td><button type="button" class="ag-chk' + (on ? ' on' : '') + '" data-act="evchip" data-k="' + k + '" aria-pressed="' + on + '" aria-label="' + esc(t(x[1]) + ' · ' + (p === 'IE_' ? t('st_mail_c') : 'Slack')) + '">' + (on ? IC.check : '') + '</button></td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table><div class="ag-field-h">' + t('ic_ev_h') + '</div></div>';
    var ntMail = (mOn ? '<div class="ag-field' + (errs.ALERT_MAIL ? ' bad' : '') + (mailDirty ? ' changed' : '') + '"><div class="ag-field-l"><label for="ag-f-mail">' + t('st_mail') + '</label></div>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<div class="ag-chips"><button type="button" class="ag-chip' + (isWhm ? ' on' : '') + '" data-act="mailmode" data-v="whm">' + t('mail_whm') + '</button>' +
      '<button type="button" class="ag-chip' + (isWhm ? '' : ' on') + '" data-act="mailmode" data-v="custom">' + t('mail_custom') + '</button></div>' +
      (isWhm ? '' : '<input class="ag-input" id="ag-f-mail" data-cfg="ALERT_MAIL" type="email" autocomplete="off" style="flex:1;min-width:220px" value="' + esc(cv('ALERT_MAIL')) + '">') + '</div>' +
      '<div class="ag-field-h">' + (errs.ALERT_MAIL ? esc(errs.ALERT_MAIL) : isWhm ? (CFG.whm_contact && CFG.whm_contact !== 'root@localhost' ? esc(t('mail_whm_h', CFG.whm_contact)) : t('mail_whm_none')) : t('st_mail_h')) + '</div></div>' : '');
    var ntLang = '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_lang') + '</label></div>' + seg('MSG_LANG', [['tr', 'Türkçe'], ['en', 'English']]) +
      '<div class="ag-field-h">' + t('st_lang_h') + '</div></div>';   // Genel bölümünde (günlük, mail ve panel dili bildirimden geniş)
    var dgOn = chEff('IE_DIGEST') === '1' || chEff('IC_DIGEST') === '1';   // özet açık mı: Olaylar tablosundaki satırından (ayrı anahtar yok)
    var ntDg = '<div class="ag-field"><div class="ag-field-l"><label>' + t('st_digest_f') + '</label>' +
      '<button class="ag-link" data-act="digestprev">' + t('digest_prev') + '</button></div>' +
      seg('DIGEST_DAY', [1, 2, 3, 4, 5, 6, 7].map(function (d) { return [String(d), t('d' + d)]; })) +
      '<div class="ag-field-h">' + (dgOn ? t('st_digest_h') : '<span style="color:var(--ag-warn)">' + esc(t('st_digest_off')) + '</span>') + '</div></div>';
    var ntMt = (mOn ? '<div class="ag-field"><button class="ag-btn" data-act="cfgtest"' + (mailDirty ? ' disabled' : '') + '>' + IC.inbox + t('st_test') + '</button>' +
      '<div class="ag-field-h">' + (mailDirty ? t('st_test_dirty') : t('st_test_h') + ' ' + esc(CFG.values.ALERT_MAIL === 'whm' ? (CFG.whm_contact || 'root@localhost') : CFG.values.ALERT_MAIL)) + '</div></div>' : '');
    var ntSt = (sOn ? '<div class="ag-field"><button class="ag-btn" data-act="ictest"' + (CFG.slack ? '' : ' disabled') + '>' + IC.bell + t('ic_test') + '</button>' +
      '<div class="ag-field-h">' + (CFG.slack ? t('ic_test_h') : esc(t('nt_h_noslack'))) + '</div></div>' : '');
    // kartlar sınıfına göre: hangi olay hangi kanala → kanalların kendisi (e-posta, Slack) → haftalık özetin günü
    var notify = card('list', t('st_events'), '', ntCh) + (mOn ? card('inbox', t('st_mail_c'), '', ntMail + ntMt) : '') + (sOn ? card('bell', 'Slack', '', ntSt) : '') +
      card('clock', t('st_digest'), '', ntDg);
    // grup kartı: her ayar grubu kendi kartında (bölüm içi büyük harfli alt başlık yerine); bölümün açıklaması kartların üstünde tek satır
    function gc(icon, k, inner, hint) { return card(icon, t(k), hint || '', inner); }
    function lead(txt) { return '<p class="ag-sec-lead">' + esc(txt) + '</p>'; }
    var thr = gc('ban', 'g_blk', field('THRESHOLD_24', errs) + field('THRESHOLD_24_PERMANENT', errs) + field('THRESHOLD_TEMP_24', errs)) +
      gc('alert', 'g_net', field('THRESHOLD_16', errs)) + gc('hour', 'g_watch', field('SAYAC_RETENTION_DAYS', errs));
    var cronCur = String(CFG.values.CRON_MIN || '');
    // sunucuda olmayan araca ait ayar gösterilmez ya da kilitli: crontab yoksa zamanlama, Imunify yoksa onun yenilemesi
    var depS = function (k) { var d = (CFG.deps || []).filter(function (x) { return x.k === k; })[0]; return d ? d.s : 'ok'; };
    var sched = '<div class="ag-field' + (String(cv('ENABLED')) !== String(CFG.values.ENABLED) ? ' changed' : '') + '"><div class="ag-field-l"><label>' + t('k_ENABLED') + '</label></div>' +
      seg('ENABLED', [['1', t('en_1')], ['0', t('en_0')]]) + '<div class="ag-field-h">' + esc(t('h_ENABLED')) + '</div></div>' +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_cron') + '</label></div>' +
      (depS('crontab') === 'ok' ? seg('CRON_MIN', [['*/5', t('cron_5')], ['*/10', t('cron_10')], ['*/15', t('cron_15')], ['*/30', t('cron_30')], ['0', t('cron_0')]]) +
        '<div class="ag-field-h">' + t('st_sched_h') + (cronCur && ['*/5', '*/10', '*/15', '*/30', '0'].indexOf(cronCur) < 0 ? ' (' + esc(cronCur) + ')' : '') + '</div>'
        : '<div class="ag-field-h"><span style="color:var(--ag-warn)">' + esc(t('dep_crontab_x')) + '</span></div>') + '</div>';
    var src = gc('search', 'g_own', '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_LOOKUP') + '</label></div>' + seg('LOOKUP', [['1', t('on')], ['0', t('off')]]) +
      '<div class="ag-field-h">' + (CFG.dns_tool ? t('h_LOOKUP') : '<span style="color:var(--ag-warn)">' + t('st_nodns') + '</span>') + '</div></div>' + field('LOOKUP_TIMEOUT', errs) +
      field('OWNER_TTL_DAYS', errs)) +
      gc('shield', 'g_cl', field('CLOUD_REFRESH_DAYS', errs) + field('CLOUD_FAIL_DAYS', errs)) +
      gc('check', 'g_svc', field('SVC_REFRESH_DAYS', errs) + field('SVC_FAIL_DAYS', errs)) +
      gc('globe', 'g_geo', field('GEO_REFRESH_DAYS', errs)) +
      (depS('imunify') === 'ok' ? gc('shield', 'g_imu', field('IMUNIFY_REFRESH_MIN', errs)) : '');
    var LG = CFG.log || {}, rot = !!LG.rotate;
    var old = gc('clock', 'g_old', field('BLOCK_EXPIRE_DAYS', errs) + field('BLOCK_ACTIVE_DAYS', errs) +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_BLOCK_EXPIRE_AUTO') + '</label></div>' + seg('BLOCK_EXPIRE_AUTO', [['1', t('on')], ['0', t('off')]]) +
      '<div class="ag-field-h">' + t('h_BLOCK_EXPIRE_AUTO') + '</div></div>');
    var rvc = gc('list', 'g_review', field('REVIEW_DAYS', errs));      // Ban kuralları'nda: listede kalma süresi kuralların çıktısına ait
    var logc = gc('terminal', 'g_log', (rot ? ['LOG_ROTATE_MB', 'LOG_ROTATE_KEEP'] : ['LOG_KEEP_DAYS']).map(function (k) { return field(k, errs); }).join('') +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_logfile') + '</label></div><div class="ag-loginfo">' +
      (rot ? t('log_rot', esc(bytes(LG.bytes)), num(LG.archives), num(CFG.values.LOG_ROTATE_MB || 1), num(CFG.values.LOG_ROTATE_KEEP || 5)) : t('log_lines', num(LG.lines), LG.oldest ? rel(LG.oldest) : '—')) + '</div></div>');
    // olay kaydının saklama süreleri (gün): Geçmiş ve tur kayıtları; altında şu an kaç kayıt, en eskisi ne zaman, dosya boyutu
    var EV = CFG.ev || {};
    var keepc = gc('list', 'g_keep', field('EVENTS_DAYS', errs) + field('RUN_DAYS', errs) +
      '<div class="ag-field"><div class="ag-field-l"><label>' + t('k_logfile') + '</label></div><div class="ag-loginfo">' +
      t('keep_now', num(EV.n || 0), EV.oldest ? esc(rel(EV.oldest)) : '—', num(EV.runs || 0), EV.runs_oldest ? esc(rel(EV.runs_oldest)) : '—', esc(bytes(EV.bytes || 0))) + '</div></div>');
    // sınırın yanında doluluk: Genel bakıştaki kartlarla aynı veri (S.usage) ve aynı eşikler (%80 turuncu, %90 kırmızı)
    function fill(pair, limit) {
      var used = (pair || [])[0] || 0, lim = (pair || [])[1] || limit || 0;
      if (!lim) return '—';
      var p = Math.round(used * 100 / lim), cls = p >= 90 ? ' bad' : p >= 80 ? ' warn' : '';
      return '<div class="ag-left ag-fill' + cls + '"><span>' + esc(t('k_lines', num(used), num(lim))) + ' · ' + (LANG === 'tr' ? '%' + p : p + '%') + '</span>' +
        '<div class="ag-days"><i style="width:' + Math.min(100, p) + '%"></i></div></div>';
    }
    var U = (S && S.usage) || {};
    var csf = '<dl class="ag-kv" style="padding:0">' +
      '<dt>' + t('csf_deny') + '</dt><dd>' + fill(U.perm, CFG.csf.deny_limit) + '</dd>' +
      '<dt>' + t('csf_temp') + '</dt><dd>' + fill(U.temp, CFG.csf.temp_limit) + '</dd></dl>' +
      '<a class="ag-btn ag-btn-sm" href="../configserver/csf.cgi" target="_top">' + IC.ext + t('csf_open') + '</a>';
    var secs = settingsSections(), cur = secs.filter(function (x) { return x.k === UI.st; })[0] || secs[0];
    // bölüm sırası önceliğe göre: önce eklentinin kendisi (çalışıyor mu, ne sıklıkla, hangi dilde), sonra kurallar, bildirim, kaynaklar, sunucu
    // her bölüm aynı kalıpla açılır: tek satır açıklama + kartlar (bazısında açıklama olmayınca bölümler arası geçişte içerik kayıyordu)
    var body = cur.k === 'general' ? lead(t('st_general_h')) + card('play', t('st_general'), '', sched + ntLang)   // tek grup: bölümle aynı adlı tek kart
      : cur.k === 'thr' ? lead(t('st_thr_h')) + thr + rvc + old                 // eski banlar ve listede kalma süresi de ban kuralı
      : cur.k === 'notify' ? lead(t('st_notify_h')) + notify
      : cur.k === 'src' ? lead(t('st_src_h')) + src
      : cur.k === 'server' ? lead(t('st_server_h')) + updCard() + card('shield', t('st_csf'), t('st_csf_h'), csf) + depsCard() + keepc + logc   // günlük dosyası sunucu işi
      : lead(t('st_hist_h')) + events(true);
    var nav = secs.map(function (x) {
      return '<button class="ag-setnav-i' + (x.k === cur.k ? ' on' : '') + '" data-act="st" data-s="' + x.k + '"' + (x.k === cur.k ? ' aria-current="page"' : '') + '>' +
        IC[x.icon] + '<span>' + esc(x.label) + '</span><i class="ag-setnav-dot' + secState(x) + '" title="' + esc(dotTitle(secState(x), x)) + '"></i></button>';
    }).join('');
    return '<div class="ag-setwrap"><nav class="ag-setnav" aria-label="' + esc(t('tab_settings')) + '">' + nav + '</nav>' +
      '<div class="ag-setmain ag-setform">' + body + '</div></div>' +
      '<div id="ag-savebar-slot">' + saveBar() + '</div>';
  }
  function pausedBar() {         // genel anahtar kapalı: tek tıkla sürdür
    return S.enabled === false ? '<div class="ag-oldbar ag-svcfail">' + IC.alert + '<span>' + esc(t('paused_bar')) + '</span>' +
      '<button class="ag-btn ag-btn-sm ag-btn-primary" data-act="resume"' + (busy ? ' disabled' : '') + '>' + esc(t('resume')) + '</button></div>' : '';
  }
  function svcFailBar() {        // izinli servis listesi uyarı süresinden uzun süredir indirilemiyorsa (motor da bildirim gönderir)
    var sv = (S.prov || {}).svc || {}, cl = (S.prov || {}).cloud || {}, now = nowSec();
    function failOld(days) { return function (x) { return x.e && x.f > 0 && now - x.f > (days || 3) * 86400; }; }   // ayar: İndirilemezse uyar (gün)
    var bad = sv.on ? (sv.src || []).filter(failOld((S.config || {}).svc_fail)).map(function (x) { return x.n; }) : [];
    var cbad = cl.on ? (cl.src || []).filter(failOld((S.config || {}).cloud_fail)).map(function (x) { return t('cl_' + x.n); }) : [];
    function bar(msg) { return '<div class="ag-oldbar ag-svcfail">' + IC.alert + '<span>' + esc(msg) + '</span><button class="ag-btn ag-btn-sm" data-act="tab" data-tab="prov">' + esc(t('svcfail_go')) + '</button></div>'; }
    return (bad.length ? bar(t('svcfail_bar', bad.join(', '))) : '') + (cbad.length ? bar(t('clfail_bar', cbad.join(', '))) : '');
  }
  function cfgTab() { return UI.tab === 'settings' || UI.tab === 'prov'; }   // ayar taslağı tutan sekmeler
  /* Sağlayıcılar sekmesi: kim saldırıyor → etkisi ne → banla, tek ekranda */
  function provTab() {
    if (!CFG) { loadCfg(); return '<div class="ag-card" style="padding:40px;text-align:center"><span class="ag-spin"></span></div>'; }
    var errs = cfgErrors();
    function card(icon, title, hint, inner) {
      return '<section class="ag-card ag-setform"' + (icon === 'globe' ? ' id="ag-prov-card"' : '') + '><div class="ag-card-h"><h2>' + IC[icon] + esc(title) + '</h2>' + (hint ? '<span class="ag-hint">' + esc(hint) + '</span>' : '') + '</div>' +
        '<div class="ag-form">' + inner + '</div></section>';
    }
    ASN_ROW_ACT = true; var top = topAsn() + bannedAsn(); ASN_ROW_ACT = false;
    var evAll = evList().filter(function (e) { return /^(provider|svc_fail|cloud_fail)$/.test(e.type); }).sort(function (a, b) { return b.t - a.t; });
    var ev = evAll.slice(0, lim('pev', 5)).map(function (e) {
      var ic = evIcon(e);
      return '<div class="ag-ev"><div class="ag-ev-ic ' + ic[1] + '">' + IC[ic[0]] + '</div><div class="ag-ev-b"><div class="ag-ev-t">' + (e.cidr ? '<span class="ag-cidr">' + esc(e.cidr) + '</span>' : '') +
        '<span class="ag-pill ' + evCls(e) + '"' + evTitle(e.type) + '>' + esc(t('ev_' + e.type)) + '</span></div><div class="ag-ev-d">' + evDetail(e) + '</div></div>' +
        '<div class="ag-ev-time" title="' + esc(new Date(e.t * 1000).toLocaleString(loc())) + '">' + stamp(e.t) + '</div></div>';
    }).join('');
    var evc = '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.list + esc(t('pv_ev_t')) + '</h2>' + (evAll.length ? '<span class="ag-count">' + num(evAll.length) + '</span>' : '') + '</div><div class="ag-card-b">' +
      (ev || '<div class="ag-empty ag-empty-sm">' + esc(t('pv_ev_none')) + '</div>') + limFoot('pev', 5, evAll.length) + '</div></section>';
    var cov = (S.groups || []).filter(function (g) { return g.pcov || g.under; });   // sağlayıcı / kiralık liste ya da /16 banının içinde
    function provName(a) {        // "DIGITALOCEAN-ASN - DigitalOcean, LLC, US" → "DigitalOcean, LLC"; bulut listesi → liste adı
      if (/^cloud:/.test(a)) return t('v_cloud', t('cl_' + a.slice(6)));
      var b = (S.asn_banned || []).filter(function (x) { return 'AS' + x.asn === a; })[0], n = String((b && b.name) || '');
      return n.replace(/^[^ ]+ - /, '').replace(/,\s*[A-Z]{2}$/, '');
    }
    var ccl = true;               // başlık ve açıklama üç engeli birden anar
    var covc = cov.length ? '<section class="ag-card"><div class="ag-card-h"><h2>' + IC.shield + esc(t(ccl ? 'pv_cov_t2' : 'pv_cov_t')) + '</h2><span class="ag-count">' + num(cov.length) + '</span>' +
      '<span class="ag-hint" style="width:100%">' + esc(t(ccl ? 'pv_cov_h2' : 'pv_cov_h')) + '</span></div><div class="ag-card-b">' +
      cov.slice(0, lim('cov', 3)).map(function (g) {
        var what = g.kind === 'partial' ? t('g_closed', svcNames(g.svc, g.extra) || t('svc_ports', String(g.ports || '').replace(/_/g, '–'))) : t('kind_' + g.kind);
        var an = g.pcov ? provName(g.pcov) : '', first = g.cidr.replace(/\/\d+$/, '').replace(/\.0$/, '.1');
        // aralık IP kartını açar (tablodaki gibi); sağlayıcı bgp.he.net'te açılır
        return '<div class="ag-cov-r"><span class="ag-cidr" data-ip="' + esc(first) + '" title="' + esc(t('ipcard')) + '">' + esc(g.cidr) + '</span>' +
          '<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="unban" data-c="' + esc(g.cidr) + '" data-dnd="' + (g.dnd ? 1 : 0) + '" data-kind="' + esc(g.kind) + '" data-restore="' + (g.restore || 0) + '">' + esc(t('unban')) + '</button>' +
          '<div class="ag-cov-m"><span>' + esc(what) + (g.dnd ? ' · ' + t('dnd_s') : '') + '</span>' +
          (!g.pcov ? '<span class="ag-cov-a"><span class="ag-org">' + esc(t('cov_under', g.under)) + '</span></span>' :
          /^cloud:/.test(g.pcov) ? '<span class="ag-cov-a"><span class="ag-org">' + esc(an) + '</span></span>' :
          '<a class="ag-cov-a" href="https://bgp.he.net/' + esc(g.pcov) + '" target="_blank" rel="noopener" title="bgp.he.net"><b class="ag-asn" title="' + esc(t('t_asn', g.pcov)) + '">' + esc(g.pcov) + '</b>' + (an ? '<span class="ag-org">' + esc(an) + '</span>' : '') + '</a>') + '</div></div>';
      }).join('') +
      limFoot('cov', 3, cov.length) + (cov.length > 1 ? '<div class="ag-card-f"><button class="ag-btn ag-btn-sm ag-btn-danger" data-act="pcovall">' + esc(t('pv_cov_all', num(cov.length))) + '</button></div>' : '') + '</div></section>' : '';
    return provLayers() + '<div class="ag-grid ag-provtab"><div class="ag-col">' + provView(errs) + '</div><div class="ag-col">' + top + covc + evc + '</div></div>' +
      '<div id="ag-savebar-slot">' + saveBar() + '</div>';
  }
  /* Ayarlar → Sağlayıcı banı: ASN banı ve izinli servisler. İstenen durum ayarlarda; motor her turda CSF'te kurar */
  var PROV_KEYS = ['ASN_BAN', 'ASN_LIST', 'ASN_ALL', 'ASN_MODE', 'ASN_TCP', 'ASN_UDP', 'SVC_ALLOW', 'SVC_SOURCES', 'SVC_EXTRA', 'SVC_URLS', 'SVC_SKIP', 'SVC_EXCEPT', 'CLOUD_BAN', 'CLOUD_SOURCES', 'CLOUD_TCP', 'CLOUD_UDP', 'CLOUD_URLS', 'CLOUD_EXTRA', 'ENABLED'];
  var CLOUD_CAT = ['gcp', 'aws', 'azure', 'oracle', 'digitalocean', 'linode', 'vultr'];
  var SVC_CAT = ['google', 'bing', 'microsoft365', 'apple', 'duckduckgo', 'openai', 'stripe', 'mollie', 'uptimerobot', 'pingdom', 'statuscake'];
  function provView(errs) {
    var P = (S && S.prov) || { svc: {}, asn: {} }, PA = P.asn || {}, PS = P.svc || {}, PC = P.cloud || {};
    var aOn = String(cv('ASN_BAN')) === '1', sOn = String(cv('SVC_ALLOW')) === '1', cOn = String(cv('CLOUD_BAN')) === '1', mode = String(cv('ASN_MODE') || 'web');
    function asnSplit(v) { return String(v || '').toUpperCase().replace(/\s/g, '').split(',').filter(Boolean); }
    // ASN_LIST: ortak port listesiyle · ASN_ALL: her şey (CC_DENY). Eski ayar ASN_MODE=all: listedekilerin hepsi "her şey"
    var lp = asnSplit(cv('ASN_LIST')), la = asnSplit(cv('ASN_ALL'));
    if (mode === 'all') { la = la.concat(lp.filter(function (a) { return la.indexOf(a) < 0; })); lp = []; }
    else la = la.filter(function (a) { return lp.indexOf(a) < 0; });      // iki listede birden: motor gibi port listesi
    var union = lp.concat(la.filter(function (a) { return lp.indexOf(a) < 0; })).filter(function (a) { return /^AS\d{1,10}$/.test(a); });
    var savedAll = asnSplit(CFG.values.ASN_LIST).concat(asnSplit(CFG.values.ASN_ALL)), savedOn = String(CFG.values.ASN_BAN) === '1';
    function err(k) { return errs[k] ? '<div class="ag-warnbox">' + esc(errs[k]) + '</div>' : ''; }
    function sec(title, hint, inner) { return '<div class="ag-sec"><div class="ag-sec-h"><b>' + esc(title) + '</b>' + (hint ? '<span>' + esc(hint) + '</span>' : '') + '</div>' + inner + '</div>'; }
    // her katman aynı kalıpta: başlıkta aç/kapat, tek cümlelik özet, uzun açıklama katlı, sonra bölümler
    function pc(id, icon, title, exp, key, sum, how, body) {
      var changed = String(cv(key)) !== String(CFG.values[key]);
      return '<section class="ag-card ag-pc' + (changed ? ' changed' : '') + '" id="' + id + '"><div class="ag-card-h"><h2>' + IC[icon] + esc(title) + '</h2>' + (exp ? '<span class="ag-tag" title="' + esc(t('pv_exp_h')) + '">' + esc(t('pv_exp')) + '</span>' : '') +
        '<div class="ag-grow"></div>' + seg(key, [['1', t('on')], ['0', t('off')]]) + '</div>' +
        '<div class="ag-pc-sum">' + sum + '</div><details class="ag-how"><summary>' + esc(t('pv_how')) + '</summary><p>' + esc(how) + '</p></details>' + body + '</section>';
    }
    // ortak port seçimi (sağlayıcı banı ve bulut listeleri aynı bileşen): yalnız web ya da seçilen portlar
    function ports(isWeb, act, tk, uk, custom) {
      var tv = String(cv(tk) || ''), uv = String(cv(uk) || '');
      var h = '<div class="ag-ports"><div class="ag-chips">' + [['web', t('pv_m_web')], ['ports', t('pv_m_ports')]].map(function (o) {
        return '<button type="button" class="ag-chip' + ((o[0] === 'web') === isWeb && !(o[0] === 'web' && custom) ? ' on' : '') + '" data-act="' + act + '" data-v="' + o[0] + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div><span class="ag-muted">' + esc(isWeb && !custom ? t('pv_ports_web') : t('pv_ports_cust', tv || '—', uv || '—')) + '</span></div>';
      if (!isWeb || custom) h += '<div class="ag-ports-in"><label>' + esc(t('k_' + tk)) + '<input class="ag-input" data-cfg="' + tk + '" autocomplete="off" placeholder="' + esc(t('pv_tcp_ph')) + '" value="' + esc(tv) + '"></label>' +
        '<label>' + esc(t('k_' + uk)) + '<input class="ag-input" data-cfg="' + uk + '" autocomplete="off" placeholder="' + esc(t('pv_udp_ph')) + '" value="' + esc(uv) + '"></label></div>' + err(tk) + err(uk);
      return h;
    }
    // kaynak kutucuğu: seçim + "Adres" (o kaynağın indirme adresini aç); altında sayı/son indirme, olay kaydında kaç saldırgan
    function tile(kind, k, on, label, desc, line, warn, pot, subs) {
      var ed = UI.urlEdit === kind + ':' + k;
      return '<div class="ag-tile' + (on ? ' on' : '') + (ed ? ' ed' : '') + '"><button type="button" class="ag-tile-m" data-act="' + (kind === 'cl' ? 'cloudsrc' : 'svcsrc') + '" data-v="' + k + '" aria-pressed="' + on + '">' +
        '<b>' + esc(label) + '</b><small title="' + esc(desc) + '">' + esc(desc) + '</small>' +
        (line ? '<em' + (warn ? ' class="bad"' : '') + '>' + esc(line) + '</em>' : '<em class="ag-muted">' + esc(t(on ? 'pv_tile_wait' : 'pv_tile_off')) + '</em>') +
        (pot ? '<em class="pot" title="' + esc(t('pv_tile_pot_h', num(pot))) + '">' + esc(t('pv_tile_pot', num(pot))) + '</em>' : '') + '</button>' +
        '<button type="button" class="ag-tile-ed" data-act="srcedit" data-v="' + kind + ':' + k + '" aria-expanded="' + ed + '" title="' + esc(t('pv_tile_addr_h')) + '">' + IC.sliders + esc(t('pv_tile_addr')) + '</button>' + (subs || '') + '</div>';
    }
    // açık kutucuğun adres düzenleyicisi (kutucukların altında): her alt liste ayrı satır, değiştirilmişse "Varsayılana dön"
    function editor(kind, label, rows) {
      return '<div class="ag-urled"><div class="ag-urled-h"><b>' + esc(t('pv_ed_t', label)) + '</b><button type="button" class="ag-link" data-act="srcedit" data-v="">' + esc(t('pv_ed_close')) + '</button></div>' +
        rows.map(function (r) {
          var ch = r.cur !== r.def;
          return '<div class="ag-urled-r">' + (r.sub ? '<span class="ag-muted">' + esc(r.sub) + '</span>' : '') +
            '<div class="ag-url-in"><input class="ag-input ag-mono" ' + (kind === 'cl' ? 'data-cloudurl' : 'data-svcurl') + '="' + esc(r.nm) + '" data-def="' + esc(r.def) + '" spellcheck="false" value="' + esc(r.cur) + '">' +
            (ch ? '<span class="ag-pill ag-pill-dw">' + esc(t('pv_url_changed')) + '</span><button type="button" class="ag-link" data-act="' + (kind === 'cl' ? 'cloudurlreset' : 'svcurlreset') + '" data-k="' + esc(r.nm) + '">' + esc(t('pv_url_reset')) + '</button>' : '') + '</div></div>';
        }).join('') + '<div class="ag-muted">' + esc(t(kind === 'cl' ? 'cl_urls_h' : 'pv_urls_h')) + '</div></div>';
    }

    function toLists() { return '<button type="button" class="ag-link" data-act="tab" data-tab="settings" data-s="src">' + esc(t('pv_to_lists')) + '</button>'; }
    // ── sağlayıcı banı ──
    var names = {}; [].concat(S.asn_top || [], S.blocks_top || []).forEach(function (a) { if (a.name) names['AS' + a.asn] = a.name; });
    (S.asn_banned || []).forEach(function (b) { if (b.name && !names['AS' + b.asn]) names['AS' + b.asn] = b.name; });
    var setLoading = setsLoading();
    var sets = {}, setTot = 0, cpct = {}; (PA.sets || []).forEach(function (x) { sets[x.a] = x.n; cpct[x.a] = x; if (x.n > 0) setTot += x.n; if (x.d && !names[x.a]) names[x.a] = x.d; });
    function shortName(n) { return String(n || '').replace(/^[^ ]+ - /, '').replace(/,\s*[A-Z]{2}$/, ''); }
    var rows = union.map(function (a) {
      var isAll = la.indexOf(a) >= 0, im = (UI.impact || {})[a];
      var st = !savedOn || savedAll.indexOf(a) < 0 ? '<span class="ag-muted">' + esc(t('pv_set_new')) + '</span>'
        : sets[a] > 0 ? '<span class="ag-muted">' + esc(t('pv_set_n', num(sets[a]))) + '</span>'
        : sets[a] === 0 ? (setLoading ? '<span class="ag-muted" title="' + esc(t('pv_set_load_h')) + '"><span class="ag-spin ag-spin-sm"></span> ' + esc(t('pv_set_load')) + '</span>'
          : '<span class="ag-warn-t">' + esc(t('pv_set_0')) + '</span>') : '';
      var md = '<div class="ag-chips">' + [['ports', 'pv_row_ports'], ['all', 'pv_row_all']].map(function (o) {
        return '<button type="button" class="ag-chip' + ((o[0] === 'all') === isAll ? ' on' : '') + '" data-act="asnmode" data-k="' + esc(a) + '" data-v="' + o[0] + '" title="' + esc(t(o[1] + '_h')) + '">' + esc(t(o[1])) + '</button>';
      }).join('') + '</div>';
      return '<div class="ag-prow" id="ag-prow-' + esc(a) + '"><div class="ag-prow-nm">' + asnB(a, names[a]) + '<span class="ag-org" title="' + esc(names[a] || '') + '">' + esc(shortName(names[a])) + '</span></div>' +
        '<div class="ag-prow-st">' + st + '</div>' + md +
        '<button class="ag-btn ag-btn-sm" data-act="asnimpact" data-v="' + esc(a) + '"' + (im === 'wait' ? ' disabled' : '') + '>' + (im && im !== 'wait' ? IC.x + esc(t('pv_imp_hide')) : IC.search + esc(t('pv_imp'))) + '</button>' +
        '<button class="ag-iconbtn" data-act="asnrm" data-v="' + esc(a) + '" title="' + esc(t('pv_rm')) + '" aria-label="' + esc(t('pv_rm')) + '">' + IC.x + '</button>' +
        (cpct[a] && cpct[a].cl >= 90 && cpct[a].cls ? '<div class="ag-prow-x ag-prow-n">' + esc(t('pv_cl_redund', num(cpct[a].cl), t('cl_' + cpct[a].cls))) + '</div>'
          : cpct[a] && cpct[a].cl >= 10 && cpct[a].cls ? '<div class="ag-prow-x ag-prow-m">' + esc(t('pv_cl_part', num(cpct[a].cl), t('cl_' + cpct[a].cls))) + '</div>' : '') +
        (im ? '<div class="ag-prow-x">' + impactHtml(im, a, isAll) + '</div>' : '') + '</div>';
    }).join('');
    var asnBody = '';
    if (aOn) {
      asnBody = sec(t('pv_sec_provs'), t('pv_sec_provs_h'),
          '<div class="ag-addrow"><input class="ag-input ag-mono" id="ag-asn-add" placeholder="' + esc(t('pv_add_ph')) + '" autocomplete="off" spellcheck="false"><button type="button" class="ag-btn ag-btn-sm" data-act="asnaddin">' + esc(t('pv_add_btn')) + '</button></div>' +
          (rows ? '<div class="ag-prows">' + rows + '</div>' : '') + err('ASN_LIST') +
          '<div class="ag-note">' + esc(PA.geo_t ? t('pv_geo', rel(PA.geo_t)) : t('pv_geo_none')) + ' ' + toLists() + '</div>' +
          // LF_IPSET=0: CSF aralıkları küme olarak tutmaz; yüklenen aralık sayısı okunamaz, Imunify yönlendirmesine karşı koruma kurulamaz
          (PA.ipset === false ? '<div class="ag-warn-t">' + esc(t((S.imunify || {}).present ? 'pv_noipset_imu' : 'pv_noipset')) + '</div>' : '')) +
        (lp.length ? sec(t('pv_sec_ports_asn'), t('pv_ports_share_s'), ports(mode !== 'ports', 'asnports', 'ASN_TCP', 'ASN_UDP', false)) : '') +
        (UI.provMsg ? '<div class="ag-sec"><div class="ag-warnbox">' + esc(UI.provMsg) + '</div></div>' : '') +
        (!sOn ? '<div class="ag-sec"><div class="ag-warnbox">' + esc(t('pv_svc_off_w')) + '</div></div>' : '');
    }

    // ── bulut listeleri ──
    var csrc = PC.src || [], cpick = String(cv('CLOUD_SOURCES') || '').split(',').filter(Boolean), pot = PC.pot || {};
    function cOf(k) { return csrc.filter(function (x) { return x.n === k; })[0]; }
    function cOver(k) { var x = String(cv('CLOUD_URLS') || '').split(/\s+/).filter(function (e) { return e.indexOf(k + '|') === 0; })[0]; return x ? x.slice(k.length + 1) : ''; }
    var ctv = String(cv('CLOUD_TCP') || ''), cuv = String(cv('CLOUD_UDP') || ''), cWeb = ctv === '80,443' && cuv === '443';
    var clBody = '';
    var picked = String(cv('SVC_SOURCES') || '').split(',').filter(Boolean);
    if (cOn) {
      var clast = csrc.reduce(function (a, x) { return Math.max(a, x.t || 0); }, 0);
      var ctiles = CLOUD_CAT.map(function (k) {
        var on = cpick.indexOf(k) >= 0, x = cOf(k);
        var line = on && x && x.c ? (x.e && x.f ? t('pv_tile_fail', rel(x.f)) : t('pv_src_t', num(x.c), x.t ? rel(x.t) : '—')) : '';
        return tile('cl', k, on, t('cl_' + k), t('cl_' + k + '_d'), line, on && x && x.e, pot[k] || 0);
      }).join('');
      var ced = '';
      if (/^cl:/.test(UI.urlEdit || '')) {
        var ek = UI.urlEdit.slice(3), def = (PC.cat || {})[ek] || '';
        if (def) ced = editor('cl', t('cl_' + ek), [{ nm: ek, def: def, cur: cOver(ek) || def }]) + (ek === 'azure' ? '<div class="ag-note">' + esc(t('cl_azure_h')) + '</div>' : '');
      }
      var cex = String(cv('CLOUD_EXTRA') || '').split(/\s+/).filter(Boolean);
      var cexOpen = cex.length || errs.CLOUD_EXTRA;
      clBody = sec(t('pv_sec_lists'), PC.n > 0 ? t('cl_n', num(PC.n), clast ? rel(clast) : '—') : t('cl_n0'),
          '<div class="ag-tiles">' + ctiles + '</div>' + ced + err('CLOUD_URLS') +
          '<details class="ag-more2"' + (cexOpen ? ' open' : '') + '><summary>' + esc(t('pv_ex_lists')) + (cex.length ? ' (' + num(cex.length) + ')' : '') + '</summary>' +
          '<textarea class="ag-input ag-ta" data-cfg="CLOUD_EXTRA" rows="2" spellcheck="false" placeholder="hetzner|https://ornek.com/liste.txt">' + esc(cex.join('\n')) + '</textarea>' +
          '<div class="ag-note">' + esc(t('pv_ex_lists_h')) + (cex.length ? ' ' + cex.map(function (e) { var n = e.slice(0, e.indexOf('|')), x = cOf('x-' + n), p0 = pot['x-' + n]; return n + ': ' + (x ? num(x.c) + ' ' + t('pv_u_rng') : '—') + (p0 ? ' · ' + t('pv_tile_pot', num(p0)) : ''); }).join(' · ') : '') + '</div>' + err('CLOUD_EXTRA') + '</details>') +
        sec(t('pv_sec_ports'), '', ports(cWeb && !UI.cloudPorts, 'cloudports', 'CLOUD_TCP', 'CLOUD_UDP', false) +
          '<div class="ag-note">' + esc(t('cl_own')) + '</div>' +
          (cpick.indexOf('azure') >= 0 && !(sOn && picked.indexOf('bing') >= 0) ? '<div class="ag-warnbox">' + esc(t('cl_azure_w')) + '</div>' : '') +
          (cpick.indexOf('azure') >= 0 && !(sOn && picked.indexOf('microsoft365') >= 0) && /(^|,)(465|587|993|995|143|110)(,|$)/.test(ctv.replace(/\s/g, '')) ? '<div class="ag-warnbox">' + esc(t('cl_m365_w')) + '</div>' : '')) +
        '<div class="ag-sec"><div class="ag-note">' + esc(t('pv_refresh_n', num(cv('CLOUD_REFRESH_DAYS') || 1))) + ' ' + toLists() + '</div></div>';
    }

    // ── izinli servisler ──
    var src = PS.src || [];
    function mine(k) { return src.filter(function (x) { return x.n === k || x.n.indexOf(k + '-') === 0; }); }
    function urlOver(nm) { var x = String(cv('SVC_URLS') || '').split(/\s+/).filter(function (e) { return e.indexOf(nm + '|') === 0; })[0]; return x ? x.slice(nm.length + 1) : ''; }
    var svcBody = '';
    if (sOn) {
      var tot = src.reduce(function (a, x) { return a + (x.c || 0); }, 0), last = src.reduce(function (a, x) { return Math.max(a, x.t || 0); }, 0);
      var stiles = SVC_CAT.map(function (k) {
        var on = picked.indexOf(k) >= 0, m = mine(k), n = m.reduce(function (a, x) { return a + (x.c || 0); }, 0), lt = m.reduce(function (a, x) { return Math.max(a, x.t || 0); }, 0);
        var bad = m.filter(function (x) { return x.e; });
        var line = on && n ? (bad.length ? t('pv_tile_fail', bad[0].f ? rel(bad[0].f) : '—') : t('pv_src_t', num(n), lt ? rel(lt) : '—')) : '';
        // birden çok liste yayımlayan kaynak: alt listeler kutucuğun içinde ayrı ayrı seçilir (SVC_SKIP = alınmayanlar)
        var subs = '', sk = String(cv('SVC_SKIP') || '').split(',').filter(Boolean), names = String((PS.cat || {})[k] || '').split(' ').filter(Boolean).map(function (e) { return e.slice(0, e.indexOf('|')); });
        if (on && names.length > 1) subs = '<div class="ag-tile-subs">' + names.map(function (nm) {
          var x = m.filter(function (y) { return y.n === nm; })[0], use = sk.indexOf(nm) < 0;
          return '<button type="button" class="ag-chip ag-chip-xs' + (use ? ' on' : '') + '" data-act="svcsub" data-v="' + esc(nm) + '" aria-pressed="' + use + '" title="' + esc(t('svs_' + nm + '_h')) + '">' +
            (use ? IC.check : '') + esc(t('svs_' + nm)) + (x && x.c ? ' <span class="ag-muted">' + num(x.c) + '</span>' : '') + '</button>';
        }).join('') + '</div>';
        return tile('svc', k, on, t('pv_src_' + k), t('pv_src_' + k + '_d'), line, on && bad.length > 0, 0, subs);
      }).join('');
      var sed = '';
      if (/^svc:/.test(UI.urlEdit || '')) {
        var sk = UI.urlEdit.slice(4), cat = (PS.cat || {})[sk] || '';
        var srows = String(cat).split(' ').filter(Boolean).map(function (e) {
          var nm = e.slice(0, e.indexOf('|')), def = e.slice(e.indexOf('|') + 1);
          return { nm: nm, def: def, cur: urlOver(nm) || def, sub: nm !== sk ? nm.slice(sk.length + 1) : '' };
        });
        if (srows.length) sed = editor('svc', t('pv_src_' + sk), srows);
      }
      var sex = String(cv('SVC_EXTRA') || '').split(/\s+/).filter(Boolean);
      svcBody = sec(t('pv_sec_srcs'), tot ? t('pv_svc_last', last ? rel(last) : '—', num(tot)) : t('pv_svc_never'),
        '<div class="ag-tiles">' + stiles + '</div>' + sed + err('SVC_URLS') +
        '<div class="ag-note">' + esc(t('pv_svc_nolist')) + '</div>' +
        '<details class="ag-more2"' + (sex.length || errs.SVC_EXTRA ? ' open' : '') + '><summary>' + esc(t('pv_ex_addr')) + (sex.length ? ' (' + num(sex.length) + ')' : '') + '</summary>' +
        '<textarea class="ag-input ag-ta" data-cfg="SVC_EXTRA" rows="3" spellcheck="false" placeholder="odeme|https://ornek.com/ips.txt&#10;ofis|203.0.113.10">' + esc(sex.join('\n')) + '</textarea>' +
        '<div class="ag-note">' + esc(t('h_SVC_EXTRA')) + '</div>' + err('SVC_EXTRA') + '</details>' +
        (function () { var xe = String(cv('SVC_EXCEPT') || '').split(/\s+/).filter(Boolean);
          return '<details class="ag-more2"' + (xe.length || errs.SVC_EXCEPT ? ' open' : '') + '><summary>' + esc(t('pv_ex_except')) + (xe.length ? ' (' + num(xe.length) + ')' : '') + '</summary>' +
            '<textarea class="ag-input ag-ta" data-cfg="SVC_EXCEPT" rows="2" spellcheck="false" placeholder="74.7.241.35">' + esc(xe.join('\n')) + '</textarea>' +
            '<div class="ag-note">' + esc(t('h_SVC_EXCEPT')) + '</div>' + err('SVC_EXCEPT') + '</details>'; })()) +
        '<div class="ag-sec"><div class="ag-note">' + esc(t('pv_refresh_n', num(cv('SVC_REFRESH_DAYS') || 1))) + ' ' + toLists() + '</div></div>';
    }

    return pc('ag-cloud-card', 'shield', t('pv_lay_cl'), true, 'CLOUD_BAN', esc(t('pv_sum_cl')), t('cl_h'), clBody) +
      pc('ag-prov-card', 'globe', t('pv_lay_asn'), true, 'ASN_BAN', esc(t('pv_sum_asn')), t('pv_asn_h') + ' ' + t('pv_md_all'), asnBody) +
      pc('ag-svc-card', 'check', t('pv_lay_svc'), false, 'SVC_ALLOW', esc(t('pv_sum_svc')), t('pv_svc_h'), svcBody);
  }
  // Sağlayıcılar sekmesinin üstü: üç koruma katmanı, ne açık, ne kadar kapsıyor, sorun var mı — tek bakışta
  // WHM'nin üstte sabit duran başlığı kartın üstünü örtmesin: sayfada sabit/yapışkan en alt kenar kadar pay bırak
  function scrollToEl(el) {
    if (!el) return;
    var top = 0;
    document.querySelectorAll('body *').forEach(function (n) {
      if (n === el || n.contains(el) || !n.getBoundingClientRect) return;
      var cs = window.getComputedStyle(n);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return;
      var r = n.getBoundingClientRect();
      if (r.top <= 0 + 2 && r.bottom > 0 && r.height < window.innerHeight / 3 && r.width > window.innerWidth / 2) top = Math.max(top, r.bottom);
    });
    // scroll-margin-top: öğe hangi kapsayıcıda kayarsa kaysın (pencere ya da WHM'nin içerik alanı) başlığın altında kalır
    el.style.scrollMarginTop = (top + 12) + 'px';
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function provLayers() {
    var P = (S && S.prov) || {}, PA = P.asn || {}, PC = P.cloud || {}, PS = P.svc || {}, now = nowSec();
    function st(on, warn) { return '<span class="ag-st ' + (!on ? 'off' : warn ? 'warn' : 'on') + '" title="' + esc(t(!on ? 'lay_off_h' : warn ? 'lay_warn_h' : 'lay_on_h')) + '"><i></i>' + esc(on ? t('on') : t('off')) + '</span>'; }
    function lay(id, icon, tone, label, v, unit, meta, on, warn) {
      return '<button type="button" class="ag-lay-i" data-act="laygo" data-v="' + id + '"><div class="ag-kpi"><div class="ag-kpi-ic ' + tone + '">' + IC[icon] + '</div><div class="ag-kpi-l">' + esc(label) + '</div>' +
        '<div class="ag-kpi-v">' + v + ' <small>' + esc(unit) + '</small></div><div class="ag-kpi-m">' + meta + '</div><div class="ag-kpi-g">' + st(on, warn) + '</div></div></button>';
    }
    var aList = String(PA.list || '').split(',').concat(String(PA.all || '').split(',')).filter(Boolean);
    var setTot = (PA.sets || []).reduce(function (a, x) { return a + (x.n > 0 ? x.n : 0); }, 0), unloaded = (PA.sets || []).filter(function (x) { return x.n === 0; }).length;
    var csrc = PC.src || [], clast = csrc.reduce(function (a, x) { return Math.max(a, x.t || 0); }, 0), cbad = csrc.filter(function (x) { return x.e; }).length;
    var cweb = PC.tcp === '80,443' && PC.udp === '443';
    var ssrc = PS.src || [], stot = ssrc.reduce(function (a, x) { return a + (x.c || 0); }, 0), slast = ssrc.reduce(function (a, x) { return Math.max(a, x.t || 0); }, 0);
    var sbad = ssrc.filter(function (x) { return x.e && x.f > 0 && now - x.f > ((S.config || {}).svc_fail || 3) * 86400; }).length;
    var nlist = String(PC.sources || '').split(',').filter(Boolean).length + String(PC.extra || '').split(/\s+/).filter(Boolean).length;
    return '<p class="ag-intro">' + esc(t('pv_intro')) + '</p><div class="ag-lay">' +
      lay('ag-cloud-card', 'shield', 'acc', t('pv_lay_cl'), num(nlist), t('pv_u_list'),
        PC.on ? esc(t('pv_lay_rng', num(PC.n || 0))) + ' · ' + esc(cweb ? t('pv_m_web') : t('pv_m_ports')) + (cbad ? ' · <span class="ag-kpi-mw">' + esc(t('pv_lay_fail', num(cbad))) + '</span>' : clast ? ' · ' + esc(rel(clast)) : '') : esc(t('pv_lay_offm')), PC.on, cbad > 0) +
      lay('ag-prov-card', 'globe', 'acc', t('pv_lay_asn'), num(aList.length), t('pv_u_prov'),
        PA.on ? esc(t(PA.mode === 'ports' ? 'pv_m_ports' : 'pv_m_web')) + ' · ' + (unloaded ? (setsLoading() ? esc(t('pv_lay_load')) : '<span class="ag-kpi-mw">' + esc(t('pv_lay_unl', num(unloaded))) + '</span>') : esc(t('pv_lay_csf', num(setTot)))) : esc(t('pv_lay_offm')), PA.on, unloaded > 0) +
      lay('ag-svc-card', 'check', 'ok', t('pv_lay_svc'), num(stot), t('pv_u_addr'),
        PS.on ? (sbad ? '<span class="ag-kpi-mw">' + esc(t('pv_lay_fail', num(sbad))) + '</span>' : esc(slast ? t('pv_lay_last', rel(slast)) : t('pv_svc_never'))) : esc(t('pv_lay_offm')), PS.on, sbad > 0) +
      '</div>';
  }
  // sağlayıcının engelleme geçmişi (olay kaydı + CSF'teki banlar), cümle olarak
  // sağlayıcının CSF'teki banları: kaçı kiralık listede (zaten kapalı), kaçı izinli serviste (etkisiz), kaçı iş görüyor
  function impBans(B) {
    if (!B || !B.n) return '';
    var kinds = [B.s ? t('p_t2', num(B.s)) : '', B.b ? t('p_g2', num(B.b)) : '', B.p ? t('im_bk_p', num(B.p)) : ''].filter(Boolean).join(', ');
    function names(o, pre) { return Object.keys(o || {}).map(function (k) { var L = t(pre + k); return L === pre + k ? k : L; }).join(', '); }
    var rows = [];
    if (B.open) rows.push(['ok', t('im_bo', num(B.open))]);
    if (B.cloud) rows.push(['c', t('im_bc', num(B.cloud), names(B.csrc, 'cl_'))]);
    if (B.allow) rows.push(['w', t('im_ba', num(B.allow), names(B.asvc, 'svs_'))]);
    var sv = Object.keys(B.svc || {}).sort(function (x, y) { return B.svc[y] - B.svc[x]; }).map(function (k) { return (k === 'repeat' ? t('svc_unknown') : svcShort(k)) + ' ' + num(B.svc[k]); }).join(', ');
    var items = (B.items || []).map(function (x) {
      var cv = String(x[3] || ''), cvh = cv === 'open' ? '<span class="ag-pill ag-pill-ban ag-pill-xs" title="' + esc(t('im_bi_open_h')) + '">' + esc(t('im_bi_open')) + '</span>'
        : /^cloud:/.test(cv) ? '<span class="ag-pill ag-pill-part ag-pill-xs" title="' + esc(t('im_bi_cloud_h')) + '">' + esc(t('im_bi_cloud', t('cl_' + cv.slice(6)))) + '</span>'
        : '<span class="ag-pill ag-pill-warn ag-pill-xs" title="' + esc(t('im_bi_allow_h')) + '">' + esc(t('im_bi_allow', cv.slice(6))) + '</span>';
      return '<tr><td class="ag-mono">' + esc(x[0]) + '</td><td>' + (x[1] ? esc(rel(x[1])) : '—') + '<div class="ag-muted ag-im-ex">' + esc(x[5] || '') + '</div></td><td class="ag-im-st">' + cvh + '</td></tr>';
    }).join('');
    return '<div class="ag-im-hist"><h4>' + esc(t('im_bt')) + '</h4><p>' + esc(t('im_bn', num(B.n), kinds)) + (B.last ? ' ' + esc(t('im_bl', rel(B.last))) : '') + '</p>' +
      '<ul class="ag-im-bl">' + rows.map(function (r) { return '<li class="' + r[0] + '">' + esc(r[1]) + '</li>'; }).join('') + '</ul>' +
      (sv ? '<p class="ag-muted">' + esc(t('im_bs', sv)) + '</p>' : '') +
      (items ? '<details class="ag-im-more"><summary><span class="ag-im-mt">' + esc(t('im_bd')) + '</span><span class="ag-im-ms">' + esc(t('im_bd_n', num((B.items || []).length), num(B.n))) + '</span></summary><div class="ag-im-mb"><table class="ag-im-t"><thead><tr><th>' + esc(t('col_ban')) + '</th><th>' + esc(t('col_banned')) + '</th><th>' + esc(t('col_now')) + '</th></tr></thead><tbody>' + items + '</tbody></table></div></details>' : '') + '</div>';
  }
  function impHist(a) {
    var n = a.replace(/^AS/, ''), R = {}, V = {}, seen = {}, cnt = 0, first = 0;
    evList().forEach(function (e) {
      (e.ips || []).forEach(function (i) {
        if (String(i.asn || e.asn || '') !== n || seen[i.ip]) return;
        seen[i.ip] = 1; cnt++; first = first ? Math.min(first, e.t) : e.t;
        var w = whyText(i.why); if (w) R[w] = (R[w] || 0) + 1;
        var k = svcOfReason(i.why); if (k !== 'other' && k !== 'repeat') V[k] = (V[k] || 0) + 1;
      });
    });
    var top = [].concat(S.asn_top || [], S.blocks_top || []).filter(function (x) { return 'AS' + x.asn === a; })[0], parts = [];
    if (top && top.singles) parts.push(t('p_t', num(top.singles)));
    if (top && top.groups) parts.push(t('p_g', num(top.groups)));
    if (top && top.blocks) parts.push(t('im_h_bx', num(top.blocks)));
    var p = [];
    if (parts.length) p.push(t('im_h_csf', parts.join(', ')) + (top && top.last ? ' ' + t('im_h_last', rel(top.last)) : ''));
    if (cnt) {
      var rs = Object.keys(R).sort(function (x, y) { return R[y] - R[x]; });
      p.push(t('im_h_ev', num(cnt), num(Math.max(1, Math.round((nowSec() - first) / 86400)))) + (rs.length ? ' ' + t('im_h_why', rs[0]) : ''));
      var other = Object.keys(V).filter(function (k) { return k !== 'web' && k !== 'scan'; });
      if (Object.keys(V).length) p.push(other.length ? t('im_h_more', other.map(svcLabel).join(', ')) : t('im_h_web'));
    }
    if (!p.length) p.push(t('im_h_none'));
    return '<div class="ag-im-hist"><h4>' + esc(t('im_h_t')) + '</h4>' + p.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div>';
  }
  function impWait(a) { UI.impact[a] = 'wait'; render(); }
  function impDur(sec) { sec = +sec || 0; return sec >= 3600 ? Math.round(sec / 3600) + (LANG === 'tr' ? ' sa' : ' h') : Math.max(1, Math.round(sec / 60)) + (LANG === 'tr' ? ' dk' : ' min'); }
  function impTk(k) { k = String(k || ''); return k.length >= 12 ? k.slice(6, 8) + '.' + k.slice(4, 6) + ' ' + k.slice(8, 10) + ':' + k.slice(10, 12) : ''; }
  // IP'nin şu anki durumu (motor: "temp:SANİYE,deny,deny24,imunify") → rozetler, her biri açıklamalı
  function impState(st) {
    var o = String(st || '').split(',').filter(Boolean).map(function (x) {
      if (/^temp:/.test(x)) return '<span class="ag-pill ag-pill-bad" title="' + esc(t('im_st_temp_h')) + '">' + esc(t('im_st_temp', impDur(x.slice(5)))) + '</span>';
      var k = { deny: 'im_st_deny', deny24: 'im_st_deny24', imunify: 'im_st_imu' }[x];
      return k ? '<span class="ag-pill ag-pill-bad" title="' + esc(t(k + '_h')) + '">' + esc(t(k)) + '</span>' : '';
    }).join(' ');
    return o || '<span class="ag-pill" title="' + esc(t('im_st_none_h')) + '">' + esc(t('im_st_none')) + '</span>';
  }
  // cevap kodlarını sözle: "3 başarılı · 27 reddedildi (403) · 23 yönlendirildi"
  function impCodes(o) {
    o = o || {}; var g = { ok: 0, r3: 0, f403: 0, f404: 0, f4: 0, f5: 0 };
    Object.keys(o).forEach(function (c) { var n = +o[c] || 0;
      if (/^2/.test(c)) g.ok += n; else if (/^3/.test(c)) g.r3 += n; else if (c === '403') g.f403 += n; else if (c === '404') g.f404 += n; else if (/^4/.test(c)) g.f4 += n; else g.f5 += n; });
    return [['ok', 'im_c_ok'], ['f403', 'im_c_403'], ['f404', 'im_c_404'], ['f4', 'im_c_4'], ['r3', 'im_c_3'], ['f5', 'im_c_5']]
      .filter(function (x) { return g[x[0]]; }).map(function (x) { return t(x[1], num(g[x[0]])); }).join(' · ');
  }
  function impactHtml(d, a, isAll) {
    var hist = (d && d.bans && d.bans.n ? impBans(d.bans) : '') + impHist(a);
    if (d === 'wait') return '<div class="ag-impact ag-im"><span class="ag-spin ag-spin-sm"></span> ' + esc(t('pv_imp_wait')) +
      ' <button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="impcancel" data-v="' + esc(a) + '" title="' + esc(t('pv_imp_cancel_h')) + '">' + esc(t('pv_imp_cancel')) + '</button></div>';
    if (!d.ok) return '<div class="ag-impact ag-im"><p class="ag-muted">' + esc(d.error === 'no_asn_data' ? t('pv_imp_nodata') : d.error === 'no_logs' ? t('pv_imp_nologs') : tErr(d.message || d.error || '?')) + '</p>' + hist + '</div>';
    var C = d.cloud || {}, O = d.open || { req: Math.max(0, (d.total || 0) - (d.areq || 0)), ips: Math.max(0, (d.ips || 0) - (d.aips || 0)), ok: 0, codes: d.ocodes || {}, top: [] };
    var D = d.cdn || {}, tot = d.total || 0, al = d.areq || 0, cl = C.req || 0, op = O.req || 0, cd = D.req || 0;
    var q = d.ban ? t('im_q_ban', t(d.ban === 'all' ? 'pv_row_all' : 'pv_row_ports')) : t(isAll ? 'im_q_all' : 'im_q_ports');
    var h = '<div class="ag-impact ag-im"><p class="ag-im-q">' + esc(q) + '</p>';
    if (!tot) return h + '<p class="ag-im-lead">' + esc(t('pv_imp_none')) + '</p>' + hist + impAgain(a) + '</div>';
    h += '<p class="ag-im-lead">' + esc(t('im_lead', num(tot))) + (al * 2 > tot ? ' ' + esc(t('im_lead_al')) : '') + '</p>';
    function pc(n) { return tot ? Math.max(n ? 0.8 : 0, n * 100 / tot) : 0; }
    h += '<div class="ag-im-bar" aria-hidden="true"><i class="d" style="width:' + pc(cd) + '%"></i><i class="g" style="width:' + pc(al) + '%"></i><i class="c" style="width:' + pc(cl) + '%"></i><i class="o" style="width:' + pc(op) + '%"></i></div>';
    // izinli servisler: hangi servis kaç istek (aynı kaynağın alt listeleri toplanır)
    var sv = {}; Object.keys(d.asvc || {}).forEach(function (k) { var b0 = k.split('-')[0]; sv[b0] = (sv[b0] || 0) + d.asvc[k]; });
    var svs = Object.keys(sv).sort(function (x, y) { return sv[y] - sv[x]; }).map(function (k) { var L = t('pv_src_' + k); return (L === 'pv_src_' + k ? k : L) + ': ' + t('im_req_n', num(sv[k])); });
    function bk(cls, tt, dd, n, ips) {
      return '<div class="ag-im-bk ' + cls + '"><span class="ag-im-dot"></span><div><div class="ag-im-bt">' + esc(tt) + '</div><div class="ag-im-bd">' + dd + '</div></div>' +
        '<div class="ag-im-bn"><b>' + num(n) + '</b><span>' + esc(t('im_ip_n', num(ips || 0))) + '</span></div></div>';
    }
    h += '<div class="ag-im-bks">';
    if (cd) {                      // CDN arkasındaki siteler: hangi site, hangi CDN; kesmenin yeri CDN'in paneli
      var ds = D.sites || {}, dk = Object.keys(ds).sort(function (x, y) { return ds[y][0] - ds[x][0]; });
      var cdns = dk.map(function (k) { return ds[k][1] === 'other' ? t('im_cdn_other') : ds[k][1]; }).filter(function (v, i, A) { return A.indexOf(v) === i; });
      h += bk('d', t('im_b_cdn_t'), esc(t('im_b_cdn_d', dk.slice(0, 4).map(function (k) { return k + ' (' + (ds[k][1] === 'other' ? t('im_cdn_other') : ds[k][1]) + ')'; }).join(', '), cdns.join(', '))), cd, D.ips);
    }
    if (al) h += bk('g', t('im_b_al_t'), esc(svs.slice(0, 4).join(' · ') + (svs.length ? '. ' : '') + t('im_b_al_d')), al, d.aips);
    if (C.web) h += bk('c', t('im_b_cl_t'), esc(t('im_b_cl_d', String(C.lists || '').split(' ').filter(Boolean).map(function (x) { return t('cl_' + x) === 'cl_' + x ? x : t('cl_' + x); }).join(', '))) + (cl ? ' ' + esc(t('im_b_cl_seen', impTk(C.last))) : ''), cl, C.ips);
    var oc = impCodes(O.codes), ex = (O.top || [])[0];
    var od = op ? esc(oc || '') + (ex ? '<br>' + esc(t('im_b_op_ex', ex[0], num(ex[1]), ex[3])) : '') : esc(t('im_b_op_none'));
    h += bk('o' + (op ? ' on' : ''), t(d.ban ? 'im_b_op_tb' : 'im_b_op_t'), od, op, O.ips) + '</div>';
    // karar
    if (!d.ban) {
      var Bh = d.bans || {};
      var vk = !op && Bh.open ? ['safe', t('im_v_hist_t'), t('im_v_hist', num(Bh.open), Bh.last ? rel(Bh.last) : '—')]
        : !op ? ['none', t('im_v_none_t'), t('im_v_none')] : !O.ok ? ['safe', t('im_v_safe_t'), t('im_v_safe', num(op)) + (al ? ' ' + t('im_v_safe_al', svs.slice(0, 3).map(function (x) { return x.replace(/: .*$/, ''); }).join(', ')) : '')]
        : ['warn', t('im_v_warn_t'), t('im_v_warn', num(op), num(O.ok))];
      if (cd) vk[2] += ' ' + t('im_v_cdn', num(cd));   // CDN üzerinden gelenler banla da kesilmez
      h += '<div class="ag-im-v ' + vk[0] + '"><b>' + esc(vk[1]) + '</b><p>' + esc(vk[2]) + '</p></div>';
    }
    h += hist;
    // ayrıntılar: ham listeler kapalı başlıklarda, başlıkta özet sayı
    function det(title, sum, body) { return body ? '<details class="ag-im-more"><summary><span class="ag-im-mt">' + esc(title) + '</span><span class="ag-im-ms">' + esc(sum) + '</span></summary><div class="ag-im-mb">' + body + '</div></details>' : ''; }
    function iprows(L) {
      return (L || []).length ? '<table class="ag-im-t"><thead><tr><th>' + esc(t('col_ip')) + '</th><th>' + esc(t('col_req')) + '</th><th>' + esc(t('col_now')) + '</th></tr></thead><tbody>' + L.map(function (x) {
        return '<tr><td class="ag-mono">' + esc(x[0]) + '</td><td>' + esc(t('im_req_n', num(x[1]))) + (x[2] ? ' · ' + esc(t('im_ok_n', num(x[2]))) : '') + '<div class="ag-muted ag-im-ex">' + esc(x[3] || '') + '</div></td><td class="ag-im-st">' + impState(x[4]) + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
    }
    function lst(a2, extra) { return (a2 || []).length ? '<ul class="ag-im-l">' + a2.map(function (x) { return '<li><span>' + esc(x[0]) + (extra ? extra(x) : '') + '</span><b>' + num(x[1]) + '</b></li>'; }).join('') + '</ul>' : ''; }
    var BOTS = [[/googlebot|google-inspectiontool|adsbot-google|storebot-google|googleother/i, 'google'], [/bingbot|msnbot|adidxbot/i, 'bing'], [/duckduckbot|duckassist/i, 'duckduckgo'],
      [/applebot/i, 'apple'], [/gptbot|chatgpt-user|oai-searchbot/i, 'openai'], [/uptimerobot/i, 'uptimerobot'], [/pingdom/i, 'pingdom'], [/statuscake/i, 'statuscake'], [/stripe/i, 'stripe'], [/mollie/i, 'mollie'], [/microsoft office|outlook|exchange/i, 'microsoft365']];
    var svcOn = String(cv('SVC_ALLOW')) === '1', svcPick = String(cv('SVC_SOURCES') || '').split(',');
    function allow(x) { return x[2] >= x[1] && x[2] > 0 ? ' <span class="ag-pill ag-pill-ok" title="' + esc(t('im_al_h')) + '">' + esc(t('pv_imp_al', x[3])) + '</span>' : x[2] > 0 ? ' <span class="ag-pill ag-pill-ok">' + esc(t('pv_imp_alp', num(x[2]), num(x[1]), x[3])) + '</span>' : ''; }
    function botNote(x) {
      if (x[2] >= x[1]) return '';
      var m = BOTS.filter(function (b2) { return b2[0].test(x[0]); })[0]; if (!m) return '';
      var nm = t('pv_src_' + m[1]);
      return '<div class="ag-muted ag-im-ex">' + esc(!svcOn || svcPick.indexOf(m[1]) < 0 ? t('pv_imp_srcoff', nm) : t('pv_imp_fake', nm)) + '</div>';
    }
    function postAct(x) { return x[4] && x[2] < x[1] ? ' <button type="button" class="ag-link" data-act="svcaddip" data-ip="' + esc(x[4]) + '" data-n="' + esc(String(x[0]).split(' · ')[0]) + '">' + esc(t('pv_imp_addip')) + '</button>' : ''; }
    h += '<div class="ag-im-dets">' +
      det(t(d.ban ? 'im_d_open_b' : 'im_d_open'), t('im_ip_n', num(O.ips || 0)), iprows(O.top)) +
      (cl ? det(t('im_d_cloud'), t('im_ip_n', num(C.ips || 0)), iprows(C.ex)) : '') +
      det(t('im_d_fails'), num((d.fails || []).reduce(function (s2, x) { return s2 + x[1]; }, 0)), lst(d.fails, function (x) { return x[4] ? ' <span class="ag-mono ag-muted">' + esc(x[4]) + '</span>' : ''; })) +
      // izinli servislerin aldığı cevaplar: sayıların altında reddedilen isteklerin örnekleri (kod · site · istek ×N · servis · örnek IP)
      (al ? det(t('im_d_acodes'), impCodes(d.acodes), '<p class="ag-im-note">' + esc(t('im_d_acodes_h')) + '</p>' +
        ((d.afails || []).length ? '<p class="ag-im-note"><b>' + esc(t('im_d_afails')) + '</b></p>' + lst(d.afails, function (x) {
          var nm = x[3] ? (t('pv_src_' + x[3]) === 'pv_src_' + x[3] ? x[3] : t('pv_src_' + x[3])) : '';
          return (nm ? ' <span class="ag-muted">· ' + esc(nm) + '</span>' : '') + (x[4] ? ' <span class="ag-mono ag-muted">' + esc(x[4]) + '</span>' : ''); }) : '')) : '') +
      det(t('pv_imp_posts'), num((d.posts || []).length), lst(d.posts, function (x) { return allow(x) + (x[4] ? ' <span class="ag-mono ag-muted">' + esc(x[4]) + '</span>' : '') + postAct(x) + botNote(x); })) +
      det(t('pv_imp_bots'), num((d.bots || []).length), lst(d.bots, function (x) { return allow(x) + botNote(x); })) +
      det(t('pv_imp_sites'), num((d.sites || []).length), lst(d.sites)) + '</div>' +
      '<p class="ag-im-note">' + esc(t('pv_imp_tip')) + '</p>' + impAgain(a) + '</div>';
    return h;
  }
  function impAgain(a) { var d = UI.impact && UI.impact[a]; return '<p class="ag-im-foot">' + (d && d._at ? esc(t('pv_imp_at', rel(d._at))) + ' · ' : '') + '<button class="ag-link" data-act="asnimpact" data-v="' + esc(a) + '" data-again="1">' + esc(t('pv_imp_again')) + '</button> · ' + esc(t('pv_imp_h')) + '</p>'; }
  /* Ayarlar bölümleri: hangi anahtar hangi bölümde (kaydedilmemiş değişiklik noktası için) */
  function settingsSections() {
    return [
      { k: 'general', icon: 'play', label: t('st_general'), keys: ['ENABLED', 'CRON_MIN', 'MSG_LANG'] },
      { k: 'thr', icon: 'sliders', label: t('st_thr'), keys: ['THRESHOLD_24', 'THRESHOLD_24_PERMANENT', 'THRESHOLD_16', 'THRESHOLD_TEMP_24', 'SAYAC_RETENTION_DAYS', 'REVIEW_DAYS', 'BLOCK_EXPIRE_DAYS', 'BLOCK_ACTIVE_DAYS', 'BLOCK_EXPIRE_AUTO'] },
      { k: 'notify', icon: 'inbox', label: t('st_notify'), keys: ['NOTIFY', 'ALERT_MAIL', 'DIGEST', 'DIGEST_DAY', 'IE_FIREWALL', 'IE_LISTFULL', 'IE_RUN', 'IE_REVIEW', 'IE_DIGEST', 'IC_FIREWALL', 'IC_LISTFULL', 'IC_RUN', 'IC_REVIEW', 'IC_DIGEST'] },
      { k: 'src', icon: 'globe', label: t('st_src'), keys: ['LOOKUP', 'LOOKUP_TIMEOUT', 'OWNER_TTL_DAYS', 'CLOUD_REFRESH_DAYS', 'CLOUD_FAIL_DAYS', 'SVC_REFRESH_DAYS', 'SVC_FAIL_DAYS', 'GEO_REFRESH_DAYS', 'IMUNIFY_REFRESH_MIN'] },
      { k: 'server', icon: 'shield', label: t('sn_server'), keys: ['EVENTS_DAYS', 'RUN_DAYS', 'LOG_ROTATE_MB', 'LOG_ROTATE_KEEP', 'LOG_KEEP_DAYS'] },
      { k: 'hist', icon: 'list', label: t('s_cfglog'), keys: [] }
    ];
  }
  // menü noktasının anlamı (ipucu): kaydedilmemiş değişiklik / güncelleme var / eksik araç / hatalı alan
  function dotTitle(st, x) {
    if (st === ' bad') return t('dot_bad');
    if (st === ' warn') return t('dot_warn');
    if (st === ' dirty') return x.k === 'server' && UPD && UPD.ok && !UPD.uptodate && !x.keys.some(function (k) { return changedKeys().indexOf(k) >= 0; }) ? t('dot_upd') : t('dot_dirty');
    return '';
  }
  function secState(x) {       // '' | ' dirty' (kaydedilmemiş) | ' bad' (hatalı alan ya da eksik zorunlu araç)
    var errs = cfgErrors(), ch = changedKeys();
    if (x.keys.some(function (k) { return errs[k]; })) return ' bad';
    if (x.k === 'server' && ((CFG && CFG.deps) || []).some(function (d) { return d.s !== 'ok' && ['imunify', 'modsec', 'sqlite3'].indexOf(d.k) < 0; })) return ' warn';
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
      : UI.tab === 'prov' ? provTab()
      : UI.tab === 'history' ? '<div class="ag-history">' + events() + '</div>'
      : statusBand() + pausedBar() + svcFailBar() + sinceBar() + kpis() + activity() + '<div class="ag-grid"><div class="ag-col">' + review() + groups() + pending() + '</div>' +
        '<div class="ag-col">' + lookupCard() + ignored() + topAsn() + bannedAsn() + '</div></div>';   // yoksayılanlar Kontrol edilecekler'in uzantısı: sağlayıcı özetinden önce
    $app.innerHTML = '<div class="ag-wrap' + (STALE ? ' ag-stale' : '') + '">' + head() + '<div id="ag-bnr">' + banner() + '</div>' +
      (STALE === 'work' ? '<div class="ag-wait" role="status" aria-live="polite"><div class="ag-wait-b"><span class="ag-spin"></span><b>' + esc(WORK_MSG || t('working')) + '</b><span>' + esc(WORK_SUB || t('working_s')) + '</span></div></div>'
        : STALE ? '<div class="ag-sync" role="status"><span class="ag-spin ag-spin-sm"></span>' + esc(t('syncing')) + '</div>' : '') + body +
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
  function backTxt() { return '<span class="ag-spin ag-spin-sm"></span> <span class="ag-back-t">' + esc(t('sb_updating')) + '</span>'; }
  function goBack() {             // eski veriyle dönüş: sayıları kaldır, eylemleri beklet (ekran yeniden çizilmez: açık form kalır)
    BACK = true;
    var lb = document.getElementById('ag-last'); if (lb) lb.innerHTML = backTxt();
    ['ag-dur', 'ag-next'].forEach(function (id) {
      var e = document.getElementById(id); if (!e) return;
      e.textContent = '…'; if (e.nextElementSibling) e.nextElementSibling.textContent = '';
    });
    var wr = $app.querySelector('.ag-wrap'); if (wr) wr.classList.add('ag-stale');
  }
  function refresh(light) {       // light: sekmeye / sayfaya dönüşte; veri eskiyse sayılar yeni durum gelene kadar gösterilmez
    if (light && LAST_OK && nowSec() - LAST_OK > 70) goBack();
    return api('status').then(function (d) {
      if (!d || d.ok === false) { throw new Error((d && (d.message || d.error)) || 'status'); }
      S = d; BACK = false; if (STALE !== 'work') STALE = false; LANG = d.lang === 'tr' ? 'tr' : 'en'; try { localStorage.setItem('ag-lang', LANG); } catch (e) {} CLOCK = d.now - Date.now() / 1000; LAST_OK = d.now; setConn(null);
      if (SEEN0 === null) { SEEN0 = d.last_seen || 0; setTimeout(function () { api('seen').catch(function () {}); }, 1500); }
      document.documentElement.lang = LANG;
      if (wasRunning && !d.running) toast(t('t_done'), 'ok');
      wasRunning = d.running;
      // CSF sağlayıcı kümelerini dolduruyorsa (lfd yeni başladı, boş küme var) sonucu bir dakika bekletme
      var filling = setsLoading() && (((d.prov || {}).asn || {}).sets || []).some(function (x) { return x.n === 0; });
      schedule(d.running ? 3000 : filling ? 10000 : runDue() ? 5000 : 60000);
      if (!busy && !(cfgTab() && CFG && changedKeys().length)) render();
      else if (!STALE) {          // çizilemedi (kaydedilmemiş ayar): bekleme görünümü yine de kalkmalı
        var wr = $app.querySelector('.ag-wrap.ag-stale'); if (wr) wr.classList.remove('ag-stale');
        var sy = $app.querySelector('.ag-sync'); if (sy) sy.remove();
      }
      evLoad().then(function (n) { if (n && !busy && !(cfgTab() && CFG && changedKeys().length)) render(); });
    }).catch(function (e) {
      if (BACK) { BACK = false; render(); }   // yenilenemedi: bağlantı uyarısı son verinin yaşını söyler
      if (STALE) { STALE = false; render(); }
      if (!S) $app.innerHTML = '<div class="ag-wrap">' + empty('alert', String(e.message || e)) + '</div>';
      else if (CONN !== 'session') setConn('net');
      schedule(60000);
    });
  }
  var DUE_HIT = false;
  setInterval(function () {
    if (document.hidden || !S || BACK) return;
    var el = document.getElementById('ag-next'); if (el && !S.running) el.textContent = nextIn() || '—';
    var left = nextLeft();                                  // cron tiki: 60 sn'lik yoklamayı beklemeden 3 sn sonra sor, run olayı gelene kadar 5 sn'de bir sürer
    if (left === 0 && !DUE_HIT) { DUE_HIT = true; schedule(3000); } else if (left > 5) DUE_HIT = false;
  }, 1000);
  function schedule(ms) {
    clearTimeout(pollTimer);
    if (CONN === 'session') return;
    // Sekme görünmüyorsa sunucuyu yorma: vakti gelen yoklama sekmeye dönülünce yapılır
    pollTimer = setTimeout(function () { if (document.hidden) { HIDDEN_DUE = true; return; } refresh(); }, ms);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !S || CONN === 'session') return;
    if (HIDDEN_DUE || nowSec() - LAST_OK > 30) { HIDDEN_DUE = false; refresh(true); }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted && S && CONN !== 'session') refresh(true); });   // tarayıcının geri/ileri önbelleğinden dönüş: eski ekran yenilenir

  /* ── Toast ─────────────────────────────────────────────────────── */
  var $toasts = null;
  function toast(msg, kind) {
    if (!$toasts) { $toasts = document.createElement('div'); $toasts.className = 'ag-toasts'; document.body.appendChild($toasts); }
    var el = document.createElement('div');
    el.className = 'ag-toast ' + (kind || 'ok');
    el.innerHTML = (kind === 'bad' ? IC.alert : IC.check) + '<div>' + esc(msg) + '</div>';
    $toasts.appendChild(el);
    setTimeout(function () { el.remove(); }, Math.max(kind === 'bad' ? 7000 : 3500, String(msg).length * 55));   // uzun metin okunacak kadar kalır
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
      var days = opts.days ? '<label>' + t('m_ignore_d') + '</label><div class="ag-chips" id="ag-days">' + [7, 30, 90, 0].map(function (d, i) {   // 0 = süresiz
        return '<button type="button" class="ag-chip' + (i === 1 ? ' on' : '') + '" data-d="' + d + '">' + (d ? t('c_days', d) : t('c_forever')) + '</button>';
      }).join('') + '</div>' : '';
      var typed = opts.typed ? '<label>' + t('type_to_confirm', '<span class="ag-target">' + esc(opts.typed) + '</span>') + '</label>' +
        '<input class="ag-input ag-mono" id="ag-typed" autocomplete="off" spellcheck="false">' : '';
      wrap.innerHTML = '<div class="ag-modal' + (opts.wide ? ' wide' : '') + (opts.cls ? ' ' + opts.cls : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + hid + '">' +
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
  function workStart(title, sub) {   // ortadaki bekleme kutusu: ne yapılıyor, ne bekleniyor; süre saniyede bir yazılır
    WORK_MSG = title || ''; WORK_SUB = sub || '';
  }
  function workText(name, extra) {
    if (/^ban/.test(name)) return [t(extra && extra.replace ? 'w_chg' : 'w_ban'), t('w_csf')];
    if (name === 'unban' || name === 'expire') return [t('w_' + name), t('w_csf')];
    if (name === 'forget' || name === 'rewatch' || name === 'ignore' || name === 'unignore') return [t('w_' + name), t('w_light')];
    return [t('working'), t('working_s')];
  }
  function doAction(name, target, extra) {
    var p = { name: name, target: target, confirm: target };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    var wt = workText(name, extra); workStart(wt[0], wt[1]);
    busy = true; STALE = 'work'; render();          // sunucudaki işlem sürerken de eylemler bekler
    return api('action', p).then(function (r) {
      busy = false;
      // sonuç, durum yenilendikten sonra döner: ardından yeniden açılan IP / aralık kartı yeni banı görsün
      if (r.ok) { toast(r.message, 'ok'); STALE = true; render(); return refresh().then(function () { return r; }, function () { return r; }); }
      STALE = false; render();
      if (r.code === 3) toast(t('t_busy'), 'bad');
      else if (r.code !== 4) toast(tErr(r.message || r.error || '?'), 'bad');
      return r;
    }).catch(function (e) { busy = false; STALE = false; render(); toast(tErr(e.message), 'bad'); return { ok: false }; });
  }
  function banName(bits) { return bits === 16 || bits === 24 ? 'ban' + bits : 'banpfx'; }   // /17–/23: duyurulan aralık
  function forceBan(bits, target, cidr, wl) {
    return modal({
      icon: 'alert', tone: 'bad', title: t('m_force_t'), typed: cidr, okText: t('ban_anyway'), okClass: 'ag-btn-danger-solid',
      html: '<p>' + t('m_force_b') + '</p><div class="ag-warnbox">' + esc(wl) + '</div><p>' + t('m_force_n') + '</p>'
    }).then(function (m) { if (m.ok) return doAction(banName(bits), target, { force: '1' }); });
  }
  /* Elle /24 ya da /16 banı: önce içindekiler okunur (motorun --inside taraması; ban eylemi aynı hesabı
     kullanır), pencere neyin kapsanacağını, beyaz liste çakışmasını ve "kapsananları kaldır"ı gösterir. */
  function p16(c) { var a = String(c).split('.'); return a[0] + '.' + a[1]; }
  function bitsOf(c) { var m = /\/(\d+)$/.exec(String(c || '')); return m ? +m[1] : 32; }
  // Ban sebebinden servis — motordaki AWK_CLS ile aynı kural (csf_autogroup.sh); birini değiştirirsen ötekini de değiştir
  function svcOfReason(r) {
    r = String(r || '').toLowerCase().replace(/ \([a-z][a-z]\/[^)]*\)/g, '');   // ülke ve rDNS servis değildir (motorla aynı)
    if (/permblock/.test(r)) return 'repeat';
    if (/mod_?security|lf_modsec/.test(r)) return 'web';          // ModSecurity yalnız web trafiğinde çalışır
    if (/port ?scan|ps_limit|lf_distattack/.test(r)) return 'scan';
    if (/failed ssh login/.test(r)) return 'ssh';                 // lfd "yoksayıldı" satırı ön ek yazmaz (motorla aynı)
    if (/failed (pop3|imap) login|failed smtp auth/.test(r)) return 'sync';
    if (/failed ftp login/.test(r)) return 'ftp';
    if (/sshd|lf_sshd/.test(r)) return 'ssh';
    if (/ftpd|lf_ftpd|lf_distftp/.test(r)) return 'ftp';
    if (/cpanel|cpaneld|whm|webmail|lf_cpanel|webmin|lf_webmin|directadmin/.test(r)) return 'cp';
    if (/smtpauth|lf_smtpauth|lf_distsmtp|sasl|imapd|pop3d|lf_pop3d|lf_imapd|dovecot|courier/.test(r)) return 'sync';
    if (/exim|lf_eximsyntax|smtp|relay|spam/.test(r)) return 'min';
    if (/named|lf_dns|dns/.test(r)) return 'dns';
    if (/mod_?security|htpasswd|lf_htaccess|lf_modsec|apache|nginx|litespeed|http|wordpress|wp-|xmlrpc|joomla|login\.php|lf_apache|404/.test(r)) return 'web';
    return 'other';
  }
  function svcList(sv) {         // "repeat:28,sync:1,other:2" → "28'inin servisi bilinmiyor, posta eşitleme 1, diğer 2" (hepsi)
    return String(sv).split(',').filter(Boolean).map(function (x) { var p = x.split(':'), n = num(+p[1] || 0);
      return p[0] === 'repeat' ? t('p_svc_rep', n) : svcShort(p[0]) + ' ' + n; }).join(', ');
  }
  function svcSplit(sv) {        // "web:28,ssh:3" → "Web 28, SSH 3" (en çok üç servis)
    return String(sv).split(',').filter(Boolean).slice(0, 3).map(function (x) { var p = x.split(':'); return svcShort(p[0]) + ' ' + num(+p[1] || 0); }).join(', ');
  }
  function svcShort(k) { return k === 'cp' ? 'cPanel' : k === 'sync' ? t('svc_sync_s') : k === 'min' ? t('svc_min_s') : svcLabel(k); }
  function svcLabel(k) { return k === 'other' ? t('svc_other') : k === 'scan' ? t('svc_scan') : k === 'repeat' ? t('svc_repeat') : t('svc_' + k); }
  function countList(o) { return Object.keys(o || {}).sort(function (a, b) { return o[b] - o[a]; }).map(function (k) { return svcLabel(k) + ' (' + num(o[k]) + ')'; }).join(', '); }
  // Servis seçimi iki kipte aynı liste; "giden" servisler yalnız "hariç" kipinde (diğer kip yalnız gelen bağlantıları kapatır)
  var SVC_IN = ['web', 'ssh', 'ftp', 'cp', 'min', 'sync', 'dns'], SVC_OUT = ['mout', 'wout'];
  function svcPorts(k, d, exc) {
    if (k === 'ssh') return d && d.ssh ? String(d.ssh).split(',').join(', ') : '22';
    if (k === 'ftp') return '21' + (exc && d && d.ftp_pasv ? ' · ' + t('svc_pasv', String(d.ftp_pasv).replace('_', '–')) : '');
    // cp: motorun listesiyle aynı (2081, 2084–2085, 2088–2094 cPanel portu değil; "2077–2096" yazmak yanıltırdı)
    return { web: '80, 443', cp: '2077–2080, 2082, 2083, 2086, 2087, 2095, 2096', min: '25', sync: '465, 587, IMAP, POP3', dns: '53', mout: '25', wout: '80, 443' }[k] || '';
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
    var pfx = bits > 16 && bits < 24;                // duyurulan aralık: hedef tam CIDR
    var cidr = bits === 16 ? target + '.0.0/16' : pfx ? target : target + '.0/24', D = null, W = null;
    function ttl() { return pfx ? t('m_banpfx_t', cIn()) : t(bits === 16 ? 'm_ban16_t' : 'm_ban24_t', cIn()); }
    function lead0() { return pfx ? t('m_banpfx_b', num(Math.pow(2, 32 - bits))) : t(bits === 16 ? 'm_ban16_b' : 'm_ban24_b'); }
    var M = { mode: 'all', clean: true, extra: { svc: '', exc: '' }, sel: { svc: {}, exc: {} } };
    function att(k) { return D && D.attacks ? +(D.attacks[k] || 0) : 0; }
    function attList(keys) { return keys.map(function (k) { return t('svc_' + k) + ' (' + num(att(k)) + ')'; }).join(', '); }
    function cIn() { return '<span class="ag-mono">' + esc(cidr) + '</span>'; }
    function changing() { return !!D && (D.own_full || (D.own_partial || []).indexOf(cidr) >= 0); }
    function picked() {
      var s = M.sel[M.mode] || {};
      return Object.keys(s).filter(function (k) { return s[k] && (M.mode === 'exc' || SVC_IN.indexOf(k) >= 0); });
    }
    function curBan() {            // değiştirilen banın şu anki hâli: kip, servisler, ek portlar
      var g = (S.groups || []).filter(function (x) { return x.cidr === cidr; })[0];
      if (!g) return null;
      if (g.kind === 'partial') return { mode: 'svc', svc: String(g.svc || ''), extra: String(g.extra || '') };
      if (g.open || g.open_extra) return { mode: 'exc', svc: String(g.open || ''), extra: String(g.open_extra || '') };
      return { mode: 'all', svc: '', extra: '' };
    }
    function nowDesc() {
      var c = curBan(); if (!c) return '';
      return c.mode === 'all' ? t('now_all') : c.mode === 'svc' ? t('now_svc', svcNames(c.svc, c.extra) || c.extra) : t('now_exc', svcNames(c.svc, c.extra) || c.extra);
    }
    function sameAsNow() {
      var c = curBan(); if (!c || c.mode !== M.mode) return false;
      if (M.mode === 'all') return true;
      var a = picked().slice().sort().join(','), b = c.svc.split(',').filter(Boolean).sort().join(',');
      return a === b && String(portsOk(M.extra[M.mode]) || '') === String(c.extra || '');
    }
    function hints() {             // öneri gerekçesi ve servisler arası bağımlılıklar (ayrıntı: README → Manual bans)
      var s = M.sel[M.mode] || {}, h = [];
      var hit = SVC_IN.filter(function (k) { return att(k) > 0; });
      var tot = Object.keys(D && D.attacks || {}).reduce(function (a, k) { return a + att(k); }, 0);
      if (M.mode === 'all' && !changing() && hit.length && hit.length <= 2 && !att('scan') && att('other') <= tot * 0.2)
        h.push({ text: t('h_part_sug', attList(hit)), mode: 'svc', label: t('h_part_go2', svcNames(hit.join(','), '')), btn: true });
      if (changing() && nowDesc()) h.unshift(t('h_now', nowDesc()));
      if (changing() && sameAsNow()) h.push(t('chg_same'));
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
      var op = M.mode === 'all' ? (D && D.wl ? t('sum_wl_open', wlShort(D.wl)) : t('sum_all_open')) : M.mode === 'svc' ? t('sum_svc_open') : list;
      return '<div class="ag-sum-r"><span class="ag-sum-k bad">' + esc(t('sum_close')) + '</span><span>' + esc(cl) + '</span></div>' +
        '<div class="ag-sum-r"><span class="ag-sum-k ok">' + esc(t('sum_open')) + '</span><span>' + esc(op) + '</span></div>';
    }
    function drawHints() {
      var sm = W.querySelector('#ag-sum'); if (sm) sm.innerHTML = summary();
      var hb = W.querySelector('#ag-hints'); if (!hb) return;
      var h = hints();
      hb.innerHTML = h.map(function (x) {
        return typeof x === 'string' ? '<div>' + esc(x) + '</div>'
          : '<div>' + esc(x.text) + (x.btn ? '<div class="ag-hint-act"><button type="button" class="ag-btn ag-btn-sm ag-btn-primary" data-mode="' + x.mode + '">' + esc(x.label) + '</button></div>'
            : ' <button type="button" class="ag-link" data-mode="' + x.mode + '">' + esc(x.label) + '</button>') + '</div>';
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
      ok.disabled = blocked || !typedOk || !modeOk || (changing() && sameAsNow());
      ok.textContent = changing() ? t('chg_btn') : D && D.wl ? t('ban_anyway') : t('ban_btn');
    }
    function refresh() {           // seçim değişince: başlık, açıklama, servisler, ipuçları, temizlik, akıbetler, düğme
      if (!W || !D) return;
      var h3 = W.querySelector('.ag-modal-h h3'), lead = W.querySelector('#ag-lead');
      if (h3) h3.innerHTML = changing() ? t('m_chg_t', cIn()) : M.mode === 'svc' ? t('m_svc_t', cIn()) : (o.title || ttl());
      if (lead) lead.innerHTML = M.mode === 'svc' ? (pfx ? t('m_svc_bpfx', num(Math.pow(2, 32 - bits))) : t(bits === 16 ? 'm_svc_b16' : 'm_svc_b24')) : (o.body || lead0());
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
        cl.querySelector('span').textContent = M.mode === 'svc' ? t('in_clean_na_d') : t('in_clean_s');
        var dtl = cl.querySelector('details'); if (dtl) dtl.style.display = M.mode === 'svc' ? 'none' : '';
      }
      okState();
    }
    return modal({
      icon: 'ban', tone: 'bad', okText: t('ban_btn'), okClass: 'ag-btn-danger-solid',
      title: o.title || ttl(),
      html: '<p id="ag-lead">' + (o.body || lead0()) + '</p><div id="ag-in"><div class="ag-in"><div class="ag-in-h">' + esc(t('in_loading')) + '</div>' +
        '<div class="ag-in-r"><div class="ag-skel" style="width:70%"></div></div></div></div>',
      onOpen: function (w) {
        W = w;
        var ok = w.querySelector('[data-m="ok"]'); if (ok) ok.disabled = true;
        api('inside', { bits: bits, target: target }).then(function (r) {
          var box = w.querySelector('#ag-in'); if (!box || !ok) return;
          if (!r || !r.ok) { box.innerHTML = '<div class="ag-warnbox">' + esc(tErr((r && (r.message || r.error)) || '?')) + '</div>'; return; }
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
      return doAction(banName(bits), target, extra).then(function (r) {
        if (r && r.code === 4) return forceBan(bits, target, cidr, r.message);   // beyaz liste pencere açıkken değişti
        return r;
      });
    });
  }
  function insideHtml(d, bits, cidr) {
    if (d.cover && !d.own_full) return '<div class="ag-warnbox">' + esc(t('in_cover', d.cover)) + '</div>';
    var clw = d.cloud ? '<div class="ag-infobox">' + esc(t('in_cloud', t('cl_' + d.cloud), [d.cloud_tcp ? 'TCP ' + d.cloud_tcp : '', d.cloud_udp ? 'UDP ' + d.cloud_udp : ''].filter(Boolean).join(', '))) + '</div>' : '';
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
    if (d.wl) h += '<div class="ag-warnbox">' + esc(t('in_wl')) + ' <b title="' + esc(d.wl) + '">' + esc(wlShort(d.wl)) + '</b><br>' + esc(t('m_force_n')) + '</div>';
    h = clw + h;
    h += '<div class="ag-mode"><div class="ag-mode-h">' + esc(t('mode_h')) + '</div><div class="ag-chips">' + ['all', 'svc', 'exc'].map(function (m) {
      return '<button type="button" class="ag-chip" data-mode="' + m + '">' + esc(t('mode_' + m)) + '</button>';
    }).join('') + '</div><div class="ag-mode-d" id="ag-md"></div><div id="ag-svcbox"></div><div class="ag-sum" id="ag-sum"></div>' +
      '<div class="ag-mode-hint" id="ag-hints" style="display:none"></div></div>';
    if (!d.own_full && (d.removable || d.free) + d.temps > 0) {
      var cbt = t('in_clean0') + (d.free && d.temps ? ' · ' + t('in_free_pt', num(d.free), num(d.temps)) : d.free ? ' · ' + t('in_free_p', num(d.free)) : d.temps ? ' · ' + t('in_free_t', num(d.temps)) : '');
      h += '<label class="ag-clean" data-b="' + esc(cbt) + '"><input type="checkbox" id="ag-clean" checked><div><b>' + esc(cbt) + '</b><span>' + esc(t('in_clean_s')) + '</span>' +
        '<details class="ag-more"><summary>' + esc(t('more_d')) + '</summary>' + esc(t('in_clean_d')) + '</details></div></label>';
    }
    if (bits < 24 || d.wl) h += '<label>' + t('type_to_confirm', '<span class="ag-target">' + esc(cidr) + '</span>') + '</label>' +
      '<input class="ag-input ag-mono" id="ag-typed2" autocomplete="off" spellcheck="false">';
    return h;
  }
  // Kısmi ban varken ban düğmeleri ne yapacaklarını söylesin: aynı aralığın kısmi banı varsa "Banı değiştir" (pencere
  // mevcut banla açılır), daha geniş bir kısmi banın içindeki blokta "Bloğu tamamen banla" (o blok için bütün servisler)
  function partialAt(c) { return (S.groups || []).filter(function (g) { return g.kind === 'partial' && g.cidr === c; })[0]; }
  function partialOver(c) { return (S.groups || []).filter(function (g) { return g.kind === 'partial' && g.cidr !== c && covers(g, c); })[0]; }
  function lbl16(a) { return partialAt(a + '.0.0/16') ? t('chg16') : t('ban16'); }
  function tempAt(c) { return (S.groups || []).some(function (g) { return g.kind === 'temp' && g.cidr === c; }); }
  function lbl24(a) { var c = a + '.0/24'; return partialAt(c) ? t('chg24') : tempAt(c) ? t('ban24_perm') : partialOver(c) ? t('ban24_full') : t('ban24'); }
  function tip24(a) { var o = partialOver(a + '.0/24'); return o && !partialAt(a + '.0/24') ? ' title="' + esc(t('ban24_full_h', svcNames(o.svc, o.extra) || o.ports)) + '"' : ''; }
  function ccPill(c) {          // ülke ya da sağlayıcı banının (CC_DENY) içinde kalan blok
    var o = outerCover(c);
    return o && o.kind === 'cc' ? '<span class="ag-ctag" title="' + esc(t('under_cc_h', o.cidr)) + '">' + esc(t(/ AS\d/.test(o.cidr) ? 'under_asn' : 'under_cc')) + '</span>' : '';
  }
  function setsLoading() {      // lfd 10 dk içinde başladı: boş ülke/ASN kümesi henüz dolmamış olabilir
    var h = (S && S.health) || {}; return h.lfd_age >= 0 && h.lfd_age < 600;
  }
  function pcovNote(a) {        // sağlayıcı banının ya da bulut listesinin (CSF'in yüklediği aralıklarla doğrulanmış) içinde kalan ban
    var cl = /^cloud:/.test(a);
    return '<span class="ag-ctag" title="' + esc(cl ? t('under_cl_h', t('cl_' + a.slice(6))) : t('under_pv_h', a)) + '">' + esc(t(cl ? 'under_cl' : 'under_asn')) + '</span>';
  }
  function underPill(u, hp) {   // daha geniş bir banın içinde kalan blok
    return '<span class="ag-pill ag-pill-n ag-under" title="' + esc(t(hp ? 'under_hp' : 'under_h', u)) + '">' + esc(t('under', '/' + bitsOf(u))) + '</span>';
  }

  var TERMS = { tr: [['§','Banlar'],['İhlal / ihlal eden IP','lfd\'nin ban sebebi saydığı olay: art arda hatalı giriş, ModSecurity eşleşmesi, port taraması… İhlal eden IP, bu olayların geldiği adres. Şifresini unutan bir kullanıcı da ihlal üretir; bu yüzden "saldırı" denmez.'],['Tekil','Tek bir IP\'nin banı. lfd koyar (çok sayıda hatalı giriş, ModSecurity, port taraması…). Kalıcı ya da geçici olabilir.'],['Blok (/24)','Aynı 256 adreslik bloktan yeterince tekil gelince eklentinin bloğun tamamına koyduğu ban.'],['Ağ (/16)','65.536 adreslik ağ. Eklenti ağı kendiliğinden banlamaz; çok bloktan ihlal gelirse "şüpheli ağ" diye bildirir, banı siz koyarsınız.'],['Duyurulan aralık','Bir sağlayıcının internete ilan ettiği adres aralığı (ör. /18). İhlal eden IP\'lerin çoğu tek bir aralıktaysa bütün ağ yerine yalnız o aralığı banlamak yetebilir.'],['Tam / kısmi','Tam ban aralıktan gelen her bağlantıyı kapatır. Kısmi ban yalnız seçilen servisleri (ör. Web) kapatır; o aralıktan diğer bağlantılar açık kalır.'],['Kalıcı / geçici','Kalıcı ban siz kaldırana kadar durur. Geçici blok banı 12 saat sürer, sonra blok izlemeye alınır.'],['İzlenen','Bir kez geçici banlanmış blok. İzleme süresi içinde yeniden ihlal ederse kalıcı banlanır.'],['Tekrar geldi, kalıcı','Geçici banı bittikten sonra izleme süresinde yeniden ihlal eden blok. Kalıcı banlanır ve silinmez işaretini alır.'],['Elle','Panelden sizin koyduğunuz ban. Eklenti onu kendiliğinden kaldırmaz.'],['Silinmez (do not delete)','CSF kalıcı liste dolunca en eski satırları siler; csf.deny içinde "do not delete" işaretli banlar silinmez. Eklentinin kalıcıya aldığı ve elle koyduğunuz blok banları bu işareti alır.'],['Eski','Ayarlardaki gün sınırından eski blok banı. Son {AD} günde ihlal görülen blok eski sayılmaz. İsterseniz eskiler kendiliğinden kaldırılır (Ayarlar → Ban kuralları → Eski banlar).'],['Aralık banı','Tek bir IP yerine bir adres aralığını kapatan ban: blok (/24), ağ (/16), duyurulan aralık ya da kısmi ban. Genel bakıştaki "Aktif aralık banları" bunları sayar; lfd\'nin tekil banları ayrı tutulur.'],['Gereksizleşen ban','Daha geniş bir engelin (sağlayıcı banı, kiralık sunucu listesi, /16 ban) zaten kapattığı ban. Kaldırmak listede yer açar.'],['§','Sağlayıcı ve listeler'],['Sağlayıcı (ASN)','İnternette adres aralıklarını duyuran şirket ya da kurum; AS numarasıyla tanınır (ör. AS14061 DigitalOcean).'],['Sağlayıcı banı','Bir sağlayıcının bütün ağını kapatır. "Port listesi" seçilirse yalnız o portlar (varsayılan web), "Her şey" seçilirse bütün portlar kapanır. En geniş engel; sağlayıcının kendi servisleri de kapanır.'],['Kiralık sunucular','Bulut firmalarının (Google Cloud, AWS, Azure…) herkese kiraladığı sunucuların listeleri. İhlallerin çoğu buradan gelir; seçilen portlarda kapatılır, firmaların kendi servisleri (Googlebot, Gmail) bu listelerde yoktur.'],['İzinli servisler','Adreslerini yayımlayan servisler (Googlebot, Bing, ödeme bildirimleri…). İzin listesine yazılır, her banın önüne geçer. Bir adresi ihlal ediyorsa "İzinli servislerden hariç tut" ile yalnız o adres çıkarılır.'],['CDN arkasındaki site','Alan adı (ya da www adı) sunucuya değil bir CDN\'e (QUIC.cloud, Cloudflare…) ya da başka bir adrese yönleniyor. O sitenin ziyaretçileri güvenlik duvarına CDN üzerinden gelir: CSF banı onları kesemez, kesmenin yeri CDN\'in paneli. Eklenti bu siteleri günde bir DNS ile tanır; Etkisini ölç ve sızıntı denetimi onların isteklerini ayrı gösterir.'],['§','İzin ve yoksayma (CSF)'],['İzin listesi (beyaz liste)','csf.allow ve onun Include ettiği dosyalar (izinli servisler dahil). CSF izni bandan önce uygular: izinli bir adres banlansa da sunucuya ulaşır. Tek portluk izin satırı (ör. yalnız SSH) yalnız o portu açar.'],['Yoksayma','csf.ignore ve csf.rignore (ters DNS adına göre). Yalnız lfd\'nin banlamasını durdurur; güvenlik duvarında izin değildir. CSF yoksayılan bir IP\'yi tek başına banlamaz, ama içinde olduğu blok banlanırsa o IP de kesilir.'],['IGNORE_ALLOW','csf.conf\'taki CSF ayarı. 0 (varsayılan) ise lfd izin listesindeki bir IP\'yi de banlar ama ban işlemez ("Ban işlemiyor"); 1 ise hiç banlamaz, her denemeyi günlüğe "ignored" diye yazar ("lfd yoksaydı"). Eklenti iki durumu da gösterir.'],['§','Kontrol edilecekler'],['Kontrol edilecekler','Eklentinin kendiliğinden banlamayıp kararı size bıraktığı durumlar. Satırlar son {RD} günden gelir ve bugünkü veriyle yeniden sınanır; artık geçerli değilse kendiliğinden düşer. Her satır son kaydından {RD} gün sonra düşer (izinli / sunucu IP\'si satırında son deneme, şüpheli ağ ve atlandıda son uyarı, açık serviste açık servislere son ihlal); tarih satırın notunda yazar. Daha önce susturmak için Yoksay (7, 30, 90 gün ya da süresiz).'],['Şüpheli ağ','Bir ağdan (/16) en az {T16} tekil, en az 2 farklı bloktan ihlal etmiş. Eklenti ağı kendiliğinden banlamaz; satır daha dar bir aralık önerebilir.'],['Atlandı','Blok eşiği aşıldı ama blok bir izin ya da yoksayma listesiyle çakıştığı için banlanmadı. "Yine de banla" bloğun izinli olmayan adreslerini kapatır.'],['Ban işlemiyor','lfd bu IP\'yi banladı ama IP izin listesinde: ban işlemez, IP sunucuya ulaşır (IGNORE_ALLOW = 0).'],['lfd yoksaydı','lfd başarısız denemeleri gördü ama banlamadı, çünkü IP izin listesinde ve IGNORE_ALLOW = 1.'],['Yoksayılıyor','lfd başarısız denemeleri gördü ama IP yoksayılanlarda (csf.ignore, GLOBAL_IGNORE, csf.rignore, CC_IGNORE, RELAYHOSTS) olduğu için banlamadı; satırda hangisi olduğu yazar. Bloğunu banlarsanız kesilir.'],['Sunucu IP\'si (kendi adresi)','lfd başarısız denemeleri saydı ama banlamadı, çünkü IP sunucunun kendi adreslerinden biri: lfd kendi adreslerini her zaman yoksayar (ignoreip). Denemeler sunucunun içinden gelir; posta günlüğünde görünen hesap satırda yazar. Bu IP banlanamaz.'],['İzinli aralık','Aynı izin kaydının içinden birden çok IP ihlal ediyor; karar tek tek IP\'ler değil o kayıt hakkında. İzinli servisse aralığı hariç tutabilirsiniz.'],['Açık servis','Kısmi banlı bir aralıktan, ban konduktan sonra açık bırakılan servislere blok ya da ağ eşiği kadar ihlal geldi. Banı değiştirip o servisleri de kapatabilirsiniz.'],['Tekrar ediyor','Aynı ağ son günlerde birden çok ayrı gün şüpheli olarak işaretlendi; listede üste alınır.'],['§','Araçlar'],['Tur','Eklentinin cron ile düzenli çalışması (Ayarlar → Genel): CSF listelerini okur, blok ve ağ kararlarını verir, bildirimleri gönderir. Genel bakıştaki durum çubuğu son turu ve süresini gösterir.'],['Deneme turu','Hiçbir şeyi değiştirmeden bir turun ne yapacağını gösterir (kuru çalıştırma). Ayarlar\'da kaydedilmemiş değerlerle de denenebilir.'],['ModSecurity','Web uygulaması güvenlik duvarı (Apache modülü). Kuralı tetikleyen istekler lfd\'de "mod_security" sebebiyle banlanır; kural mesajı cPanel\'in eşleşme kaydından (modsec.sqlite) okunur.'],['Imunify360','CloudLinux\'un güvenlik paketi. Kendi kara listesi ve gri listesi (WebShield) CSF\'ten önce çalışır; beyaz listesi csf.allow\'a Include ile girer. Eklenti Imunify\'ın engellediklerini ayrı sekmede gösterir ve Imunify yönlendirmesinin CSF banlarını atlamasını engeller (ban koruması).'],['Ters DNS / ileri doğrulama','IP\'den ada (PTR) ve addan yeniden IP\'ye çözüm. csf.rignore ve izinli servis denetimleri bir adı yalnız iki yön tutarlıysa (ad bu IP\'ye geri çözülüyorsa) geçerli sayar; lfd de öyle yapar.'],['Team Cymru','Bir IP\'nin sağlayıcısını (ASN) ve ülkesini DNS ile sorduğumuz açık servis; sahip bilgileri buradan gelir ve önbellekte tutulur (Ayarlar → Kaynaklar ve yenileme).'],['AbuseIPDB','IP kartındaki dış bağlantı: adresin başka sunuculardan gelen şikâyet geçmişi. Eklenti sorgu yapmaz, sayfayı açar.'],['CSF','ConfigServer Security & Firewall: sunucunun güvenlik duvarı. Banları o uygular; eklenti onun listelerine yazar.'],['lfd','CSF\'in günlükleri izleyen parçası. Hatalı giriş, ModSecurity, port taraması gibi ihlallerde tekil banları o koyar; eklenti bu banları bloklara ve ağlara göre gruplar.']], en: [['§','Bans'],['Violation / offending IP','What lfd counts as a ban reason: repeated failed logins, a ModSecurity match, a port scan… The offending IP is the address they came from. A user who forgot a password produces a violation too, which is why it is not called an attack.'],['Single','A ban on one IP, added by lfd (failed logins, ModSecurity, port scans…). Permanent or temporary.'],['Block (/24)','When enough singles come from the same 256-address block, the plugin bans the whole block.'],['Network (/16)','A 65,536-address network. The plugin never bans it by itself; when violations come from many blocks it reports a "suspicious network" and you decide.'],['Announced range','An address range a provider announces on the internet (e.g. /18). If most offending IPs sit in one range, banning just that range may be enough instead of the whole network.'],['Full / partial','A full ban closes every connection from the range. A partial ban closes only the chosen services (e.g. Web); other connections from that range stay open.'],['Permanent / temporary','A permanent ban stays until you remove it. A temporary block ban lasts 12 hours, then the block is watched.'],['Watched','A block that had a temporary ban. If it violates again within the watch period it is banned permanently.'],['Came back, permanent','A block that violated again within the watch period after its temporary ban. It is banned permanently and marked kept.'],['Manual','A ban you added from the panel. The plugin never removes it by itself.'],['Kept (do not delete)','When CSF\'s permanent list is full it deletes the oldest lines; bans marked "do not delete" in csf.deny are kept. Blocks the plugin makes permanent and blocks you ban by hand get this mark.'],['Old','A block ban older than the day limit in Settings. A block with a violation in the last {AD} days is not old. Old ones can be removed automatically (Settings → Ban rules → Old bans).'],['Range ban','A ban on an address range instead of one IP: a block (/24), a network (/16), an announced range or a partial ban. "Active range bans" on the Overview counts these; lfd\'s single bans are kept apart.'],['Ban no longer needed','A ban that a wider block (provider ban, rented-server list, /16 ban) already covers. Removing it frees a line.'],['§','Providers and lists'],['Provider (ASN)','The company or organisation that announces address ranges on the internet; known by its AS number (e.g. AS14061 DigitalOcean).'],['Provider ban','Blocks a provider\'s whole network. With "Port list" only those ports (web by default) are closed, with "Everything" every port. The widest block; the provider\'s own services are blocked too.'],['Rented servers','Lists of the servers cloud companies (Google Cloud, AWS, Azure…) rent out to anyone. Most violations come from them; blocked on the chosen ports. The companies\' own services (Googlebot, Gmail) are not in these lists.'],['Allowed services','Services that publish their addresses (Googlebot, Bing, payment notifications…). Written to the allow list, they come before every ban. If one of their addresses violates, "Exclude from allowed services" takes out just that address.'],['Site behind a CDN','The domain (or its www name) points to a CDN (QUIC.cloud, Cloudflare…) or another address instead of the server. Its visitors reach the firewall through the CDN: a CSF ban can not cut them; the place to block them is the CDN\'s panel. The plugin detects these sites once a day by DNS; Measure impact and the leak check show their requests separately.'],['§','Allows and ignores (CSF)'],['Allow list (whitelist)','csf.allow and the files it includes (allowed services too). CSF applies allows before bans: an allowed address reaches the server even when banned. A single-port allow line (e.g. SSH only) opens just that port.'],['Ignore','csf.ignore and csf.rignore (by reverse DNS name). It only stops lfd from banning; it is not a firewall allow. CSF refuses to ban an ignored IP on its own, but a ban on its block cuts it too.'],['IGNORE_ALLOW','A CSF setting in csf.conf. With 0 (the default) lfd also bans an IP in the allow list but the ban does not work ("Ban not working"); with 1 it does not ban and logs every attempt as "ignored" ("lfd ignored"). The plugin shows both.'],['§','Review list'],['Review list','What the plugin did not ban on its own and leaves to you. Rows come from the last {RD} days and are re-checked against today\'s data; a row that no longer applies drops out by itself. Each row drops out {RD} days after its last record (the last attempt for allowed / server-IP rows, the last warning for suspicious networks and skips, the last violation of the open services for an open service); the date is in the row\'s note. To silence one earlier, use Ignore (7, 30, 90 days or indefinitely).'],['Suspicious network','At least {T16} singles from at least 2 different blocks of one network (/16). The plugin does not ban the network by itself; the row may suggest a narrower range.'],['Skipped','The block threshold was reached but the block overlaps an allow or ignore list, so it was not banned. "Ban anyway" closes the block\'s addresses that are not allowed.'],['Ban not working','lfd banned this IP but it is in the allow list: the ban does not work and the IP reaches the server (IGNORE_ALLOW = 0).'],['lfd ignored','lfd saw the failed attempts but did not ban, because the IP is in the allow list and IGNORE_ALLOW = 1.'],['Ignored','lfd saw the failed attempts but did not ban because the IP is ignored (csf.ignore, GLOBAL_IGNORE, csf.rignore, CC_IGNORE, RELAYHOSTS); the row says which. Banning its block cuts it.'],['Server\'s IP (its own address)','lfd counted the failed attempts but did not ban, because the IP is one of the server\'s own addresses: lfd always ignores its own addresses (ignoreip). The attempts come from inside the server; the account seen in the mail log is shown on the row. This IP can not be banned.'],['Allowed range','Several IPs from inside one allow entry are violating; the decision is about that entry, not the single IPs. For an allowed service you can exclude the range.'],['Open service','Since a partial ban went in, the services it left open were hit up to the block or network threshold. Change the ban to close them too.'],['Repeating','The same network was flagged as suspicious on several separate days recently; it moves to the top of the list.'],['§','Tools'],['Run','The plugin\'s scheduled execution by cron (Settings → Schedule): it reads CSF\'s lists, decides on blocks and networks and sends the notifications. The status bar on the Overview shows the last run and its duration.'],['Dry run','Shows what a run would do without changing anything. In Settings it can also use the unsaved values.'],['ModSecurity','The web application firewall (an Apache module). Requests that trigger a rule are banned by lfd with the reason "mod_security"; the rule message is read from cPanel\'s hit log (modsec.sqlite).'],['Imunify360','CloudLinux\'s security suite. Its own block list and greylist (WebShield) act before CSF; its whitelist enters csf.allow through an Include. The plugin shows what Imunify blocks on its own tab and stops Imunify\'s redirect from bypassing CSF bans (ban guard).'],['Reverse DNS / forward check','Resolving an IP to a name (PTR) and the name back to an IP. csf.rignore and the allowed-service checks accept a name only when both directions agree (the name resolves back to this IP); lfd does the same.'],['Team Cymru','The public service we ask by DNS for an IP\'s provider (ASN) and country; owner information comes from it and is cached (Settings → Sources and refresh).'],['AbuseIPDB','An external link on the IP card: the address\'s complaint history reported from other servers. The plugin does not query it; it opens the page.'],['CSF','ConfigServer Security & Firewall: the server\'s firewall. It applies the bans; the plugin writes to its lists.'],['lfd','The part of CSF that watches the logs. It adds the single bans for failed logins, ModSecurity hits, port scans…; the plugin groups those bans into blocks and networks.']] };
  var ACTIONS = {
    terms: function () {          // ilk kez bakan için kısa sözlük
      modal({ icon: 'list', tone: 'acc', title: t('terms_t'), noCancel: true, okText: t('close'), cls: 'ag-modal-terms',
        html: '<dl class="ag-terms">' + (TERMS[LANG] || TERMS.tr).map(function (x) {   // '§' = bölüm başlığı
          // ayarlanabilir sayılar sunucudaki değerle: {RD} Kontrol edilecekler günü, {T16} şüpheli ağ eşiği, {AD} denenen blok günü
          var C = S.config || {}, d = String(x[1]).replace(/\{(RD|T16|AD)\}/g, function (_, k) { return num(k === 'RD' ? C.review_days || 7 : k === 'T16' ? C.t16 || 5 : C.active_days || 30); });
          return x[0] === '§' ? '<dt class="ag-terms-h">' + esc(x[1]) + '</dt>' : '<dt>' + esc(x[0]) + '</dt><dd>' + esc(d) + '</dd>';
        }).join('') + '</dl>' });
    },
    resume: function () {         // ENABLED=1 kaydet, sağlayıcı / bulut banını CSF'e şimdi yeniden yaz
      modal({ icon: 'play', tone: 'acc', title: t('m_resume_t'), html: '<p>' + esc(t('m_resume_b')) + '</p>', okText: t('resume') })
        .then(function (m) {
          if (!m.ok) return;
          workStart(t('resuming'), t('w_prov')); busy = true; STALE = 'work'; render();
          api('config_set', { 'v[ENABLED]': '1' }).then(function (r) {
            if (!r.ok) { busy = false; STALE = false; render(); toast(tErr(r.message || r.error || '?'), 'bad'); return; }
            api('prov_apply').then(function () { busy = false; STALE = false; CFG = null; refresh(); }, function () { busy = false; STALE = false; refresh(); });
          });
        });
    },
    pcovall: function () {        // sağlayıcı banının içinde kalan banları sırayla kaldırır (her biri ayrı işlem, aynı kurallar)
      var L = (S.groups || []).filter(function (g) { return g.pcov || g.under; });
      if (!L.length) return;
      // tek tek kaldırmadaki kural: silinmez, elle ya da kısmi ban varsa yazarak onay (burada adet, Eskileri kaldır gibi)
      var prot = L.some(function (g) { return g.dnd || g.kind === 'manual' || g.kind === 'partial'; });
      modal({
        icon: 'alert', tone: 'bad', title: t('pv_cov_m', num(L.length)), okText: t('pv_cov_all', num(L.length)), okClass: 'ag-btn-danger-solid',
        typed: prot ? String(L.length) : null,
        html: '<p>' + esc(t('pv_cov_mb')) + '</p><div class="ag-warnbox ag-mono">' + L.map(function (g) { return esc(g.cidr) + (g.dnd ? ' · ' + t('dnd_s') : ''); }).join('<br>') + '</div>'
      }).then(function (m) {
        if (!m.ok) return;
        var ok = 0, bad = 0;
        L.reduce(function (pr, g) { return pr.then(function () { return doAction('unban', g.cidr, g.restore ? { restore: '1' } : {}).then(function (r) { if (r && r.ok) ok++; else bad++; }); }); }, Promise.resolve())
          .then(function () { if (L.length > 1) toast(t('pv_cov_done', num(ok), num(bad)), bad ? 'bad' : 'ok'); });
      });
    },
    tab: function (el) {
      var k = el.getAttribute('data-tab');
      if (k === UI.tab && !el.getAttribute('data-s')) return;
      var ds = el.getAttribute('data-s');
      function go() {
        UI.tab = k; history.replaceState(null, '', k === 'overview' ? '#' : '#' + k);
        if (ds) UI.st = ds;
        if (k === 'settings' || k === 'prov') { CFG = null; DRAFT = {}; UI.asnRaw = null; }
        render(); window.scrollTo(0, 0);
      }
      // kaydedilmemiş değişiklik varken: tarayıcının kutusu yerine uygulamanın penceresi
      if (k !== UI.tab && cfgTab() && CFG && changedKeys().length) {
        modal({ icon: 'alert', tone: 'warn', title: t('dirty_leave', changedKeys().length), html: '<p>' + esc(t('dirty_leave_b')) + '</p>', okText: t('dirty_go') })
          .then(function (m) { if (m.ok) go(); });
        return;
      }
      go();
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
    limmore: function (el) { UI.lim = UI.lim || {}; var k = el.getAttribute('data-k'), d = +el.getAttribute('data-d'); UI.lim[k] = (UI.lim[k] || d) + 10; render(); },
    limall: function (el) { UI.lim = UI.lim || {}; UI.lim[el.getAttribute('data-k')] = +el.getAttribute('data-n'); render(); },
    limless: function (el) { UI.lim = UI.lim || {}; delete UI.lim[el.getAttribute('data-k')]; render(); },
    ef: function (el) { UI.ef = el.getAttribute('data-f'); UI.evLimit = 40; render(); },
    cf: function (el) { UI.cf = el.getAttribute('data-f'); UI.evLimit = 40; render(); },
    cd: function (el) { UI.cd = +el.getAttribute('data-d'); render(); },
    menu: function (el) { var k = el.getAttribute('data-key'); UI.menu = UI.menu === k ? null : k; render(); },
    gsort: function (el) { var k = el.getAttribute('data-k'); if (UI.gs === k) UI.gd = -UI.gd; else { UI.gs = k; UI.gd = k === 'added' || k === 'n' ? -1 : 1; } UI.gp = 0; render(); },
    gpage: function (el) { UI.gp = Math.max(0, UI.gp + (+el.getAttribute('data-d'))); render(); },
    shownew: function () {
      var cs = {};
      (S.events || []).forEach(function (e) { if (isNew(e.t) && NEW_TYPES.indexOf(e.type) >= 0 && e.cidr) cs[e.cidr] = 1; });
      var one = Object.keys(cs), st = one.length === 1 ? itemState(one[0]) : null;
      if (st && (st.r || st.g || st.p) && focusRow(one[0])) return;   // tek öğe, eylemleriyle birlikte Genel bakış'ta
      UI.ef = 'new'; UI.evLimit = 200; UI.tab = 'history'; history.replaceState(null, '', '#history'); render(); window.scrollTo(0, 0);
    },
    asnhint: function (el) {      // çok blok banı alan sağlayıcı: sağlayıcı banına ekle (Sağlayıcılar sekmesi), etkisi ölçülür
      var n = el.getAttribute('data-asn'), asn = 'AS' + n, name = el.getAttribute('data-name'), g = el.getAttribute('data-g');
      var P = (S.prov || {}).asn || {}, inl = P.on && (',' + (P.list || '') + ',' + (P.all || '') + ',').indexOf(',' + asn + ',') >= 0;
      modal({
        icon: 'globe', tone: 'warn', title: esc(t('m_asn_t', n)), okText: inl ? t('m_asn_go') : t('m_asn_add'),
        html: '<p>' + esc(t('m_asn_b', g, name, num((S.config || {}).t24 || 3))) + '</p><div class="ag-warnbox">' + esc(t('m_asn_w')) + '</div><p class="ag-muted">' + esc(inl ? t('m_asn_in') : t('m_asn_s')) + '</p>'
      }).then(function (m) {
        if (!m.ok) return;
        if (!inl) UI.pendingAsn = asn;            // ayarlar yüklenince listeye eklenir ve ölçülür (ACTIONS.asnadd)
        if (UI.tab === 'prov' && CFG) { if (!inl) { UI.pendingAsn = null; ACTIONS.asnadd({ getAttribute: function () { return asn; } }); } return; }
        UI.tab = 'prov'; history.replaceState(null, '', '#prov'); CFG = null; DRAFT = {}; UI.asnRaw = null; render(); window.scrollTo(0, 0);
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
    cfgchip: function (el) { DRAFT[el.getAttribute('data-k')] = el.getAttribute('data-v'); UI.asnRaw = null; if (/^ASN_/.test(el.getAttribute('data-k'))) UI.provMsg = ''; render(); },
    asnadd: function (el) {
      var a = el.getAttribute('data-v'), lp = String(cv('ASN_LIST') || '').split(',').filter(Boolean);
      if (lp.indexOf(a) < 0 && String(cv('ASN_ALL') || '').split(',').indexOf(a) < 0) lp.push(a);
      DRAFT.ASN_LIST = lp.join(','); DRAFT.ASN_BAN = '1'; UI.asnRaw = null; UI.impact = UI.impact || {}; impWait(a);
      // o sağlayıcının satırına (altında ölçüm penceresi) kaydırır; kartın üstüne kaydırınca pencere ekran dışında kalıyordu
      scrollToEl(document.getElementById('ag-prow-' + a) || document.getElementById('ag-prov-card'));
      api('asn_impact', { asn: a }).then(function (r) { if (r) r._at = nowSec(); UI.impact[a] = r; render(); });
    },
    numstep: function (el) {     // sayı kutusunun − / + düğmesi: sınır içinde bir adım, sonra kutunun kendi input olayı (taslak, doğrulama)
      var inp = document.getElementById('ag-f-' + el.getAttribute('data-k')); if (!inp) return;
      var v = parseInt(inp.value, 10), mn = parseInt(inp.getAttribute('min'), 10), mx = parseInt(inp.getAttribute('max'), 10);
      if (isNaN(v)) v = isNaN(mn) ? 0 : mn; v += +el.getAttribute('data-d');
      if (!isNaN(mn) && v < mn) v = mn; if (!isNaN(mx) && v > mx) v = mx;
      inp.value = String(v); inp.dispatchEvent(new Event('input', { bubbles: true }));
    },
    asnaddin: function () {      // kutuya yazılan AS numarasını ekle ve etkisini ölç (sağdaki "Banla…" ile aynı)
      var inp = document.getElementById('ag-asn-add'), v = String(inp ? inp.value : '').toUpperCase().replace(/\s/g, ''), m = /^(AS)?(\d{1,10})$/.exec(v);
      if (!m) { if (inp) inp.classList.add('bad'); return; }
      ACTIONS.asnadd({ getAttribute: function () { return 'AS' + m[2]; } });
    },
    asnrm: function (el) {       // listeden çıkar (kaydedince CSF'ten kalkar)
      var a = el.getAttribute('data-v');
      DRAFT.ASN_LIST = String(cv('ASN_LIST') || '').split(',').filter(function (x) { return x && x !== a; }).join(',');
      DRAFT.ASN_ALL = String(cv('ASN_ALL') || '').split(',').filter(function (x) { return x && x !== a; }).join(',');
      if (UI.impact) delete UI.impact[a]; render();
    },
    asnports: function (el) { DRAFT.ASN_MODE = el.getAttribute('data-v') === 'ports' ? 'ports' : 'web'; UI.provMsg = ''; render(); },
    cloudports: function (el) {  // yalnız web = TCP 80,443 + UDP 443; seçilen portlar = kutular açılır
      if (el.getAttribute('data-v') === 'web') { DRAFT.CLOUD_TCP = '80,443'; DRAFT.CLOUD_UDP = '443'; UI.cloudPorts = false; } else UI.cloudPorts = true;
      render();
    },
    srcedit: function (el) { var v = el.getAttribute('data-v') || ''; UI.urlEdit = UI.urlEdit === v ? '' : v; render(); },
    laygo: function (el) { scrollToEl(document.getElementById(el.getAttribute('data-v'))); },
    asnmode: function (el) {     // satır başına: ortak port listesi ya da her şey
      var a = el.getAttribute('data-k'), all = el.getAttribute('data-v') === 'all';
      var lp = String(cv('ASN_LIST') || '').split(',').filter(Boolean), la = String(cv('ASN_ALL') || '').split(',').filter(Boolean);
      if (String(cv('ASN_MODE')) === 'all') { la = la.concat(lp); lp = []; DRAFT.ASN_MODE = 'web'; }
      lp = lp.filter(function (x) { return x !== a; }); la = la.filter(function (x) { return x !== a; });
      (all ? la : lp).push(a);
      DRAFT.ASN_LIST = lp.join(','); DRAFT.ASN_ALL = la.join(','); UI.provMsg = ''; render();
    },
    svcurlreset: function (el) {   // değiştirilmiş kaynak adresini varsayılana döndür
      var k = el.getAttribute('data-k');
      DRAFT.SVC_URLS = String(cv('SVC_URLS') || '').split(/\s+/).filter(function (e) { return e && e.indexOf(k + '|') !== 0; }).join(' '); render();
    },
    svcaddip: function (el) {      // ölçümdeki bir IP'yi İzinli servisler → Ek adresler'e (kaydedince geçerli)
      var ip = el.getAttribute('data-ip'), nm = ('webhook-' + String(el.getAttribute('data-n') || 'ip')).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 40);
      var cur = String(cv('SVC_EXTRA') || '').split(/\s+/).filter(Boolean);
      if (!cur.some(function (e) { return e.slice(e.indexOf('|') + 1) === ip; })) cur.push(nm + '|' + ip);
      DRAFT.SVC_EXTRA = cur.join(' '); DRAFT.SVC_ALLOW = '1'; toast(t('pv_imp_added', ip), 'ok'); render();
    },
    cloudsrc: function (el) {
      var k = el.getAttribute('data-v'), cur = String(cv('CLOUD_SOURCES') || '').split(',').filter(Boolean), i = cur.indexOf(k);
      if (i >= 0) cur.splice(i, 1); else cur.push(k);
      DRAFT.CLOUD_SOURCES = CLOUD_CAT.filter(function (x) { return cur.indexOf(x) >= 0; }).join(','); render();
    },
    cloudurlreset: function (el) {
      var k = el.getAttribute('data-k');
      DRAFT.CLOUD_URLS = String(cv('CLOUD_URLS') || '').split(/\s+/).filter(function (e) { return e && e.indexOf(k + '|') !== 0; }).join(' '); render();
    },
    svcsub: function (el) {        // alt liste: alınmayanlar SVC_SKIP'te
      var k = el.getAttribute('data-v'), cur = String(cv('SVC_SKIP') || '').split(',').filter(Boolean), i = cur.indexOf(k);
      if (i >= 0) cur.splice(i, 1); else cur.push(k);
      DRAFT.SVC_SKIP = cur.join(','); render();
    },
    svcsrc: function (el) {
      var k = el.getAttribute('data-v'), cur = String(cv('SVC_SOURCES') || '').split(',').filter(Boolean), i = cur.indexOf(k);
      if (i >= 0) cur.splice(i, 1); else cur.push(k);
      DRAFT.SVC_SOURCES = SVC_CAT.filter(function (x) { return cur.indexOf(x) >= 0; }).join(','); render();
    },
    asnimpact: function (el) {
      var a = el.getAttribute('data-v'); UI.impact = UI.impact || {};
      if (UI.impact[a] && UI.impact[a] !== 'wait' && !el.getAttribute('data-again')) { delete UI.impact[a]; render(); return; }   // açıkken: gizle
      impWait(a);
      // vazgeçilirse (impcancel) cevap geldiğinde yok sayılır: her başlatma kendi numarasını taşır
      UI.impTok = UI.impTok || {}; var tok = UI.impTok[a] = (UI.impTok[a] || 0) + 1;
      api('asn_impact', { asn: a }).then(function (r) { if (UI.impTok[a] !== tok || UI.impact[a] !== 'wait') return; if (r) r._at = nowSec(); UI.impact[a] = r; render(); });
    },
    impcancel: function (el) {
      var a = el.getAttribute('data-v'); UI.impTok = UI.impTok || {}; UI.impTok[a] = (UI.impTok[a] || 0) + 1;
      if (UI.impact) delete UI.impact[a]; render();
    },
    evchip: function (el) {   // olay × kanal hücresi: etkin tablo anahtarlara yazılır (eski NOTIFY/DIGEST etkisi dahil), tıklanan hücre tersine döner
      var k = el.getAttribute('data-k'), eff = {};
      EV_KINDS.forEach(function (x) { eff['IE_' + x] = chEff('IE_' + x); eff['IC_' + x] = chEff('IC_' + x); });
      eff[k] = eff[k] === '1' ? '0' : '1'; eff.NOTIFY = 'all'; eff.DIGEST = '1';
      Object.keys(eff).forEach(function (x) { if (String(CFG.values[x] == null ? '' : CFG.values[x]) === eff[x]) delete DRAFT[x]; else DRAFT[x] = eff[x]; });
      render();
    },
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
        toast(r.ok ? r.message : tErr(r.message || r.error || '?'), r.ok ? 'ok' : 'bad');
      });
    },
    cfgdiscard: function () { DRAFT = {}; UI.asnRaw = null; render(); },
    cfgtest: function (el) {
      el.disabled = true;
      api('config_test_mail').then(function (r) {
        el.disabled = false;
        toast(r.ok ? r.message : tErr(r.message || r.error || '?'), r.ok ? 'ok' : 'bad');
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
            pre.outerHTML = drySummary(r.output || r.message || r.error || '');
          });
        }
      });
    },
    cfgsave: function () {
      var ch = changedKeys();
      var list = '<ul class="ag-changes">' + ch.map(function (k) {
        var label = cfgLabel(k), dl = cfgListDiff(k, CFG.values[k], cv(k));
        // listelerde (kaynaklar, sağlayıcılar, ek adresler) bütün liste değil, eklenen ve çıkarılan yazılır: uzun listeler pencereye sığsın
        if (dl) return '<li><b>' + esc(label) + '</b>' + dl.map(function (x) { return '<span class="ag-chg-l">' + esc(x) + '</span>'; }).join('') + '</li>';
        return '<li><b>' + esc(label) + '</b><span class="ag-mono">' + esc(cfgShow(k, CFG.values[k]) || '—') + '</span> → <span class="ag-mono">' + esc(cfgShow(k, cv(k)) || (PROV_KEYS.indexOf(k) >= 0 ? '—' : t('auto'))) + '</span></li>';
      }).join('') + '</ul>';
      modal({ icon: 'sliders', tone: 'acc', title: t('m_save_t'), html: '<p>' + t('m_save_b') + '</p>' + list, okText: t('save') }).then(function (m) {
        if (!m.ok) return;
        var p = {};
        ch.forEach(function (k) { p['v[' + k + ']'] = String(cv(k)); });
        api('config_set', p).then(function (r) {
          if (!r.ok) { toast(tErr(r.message || r.error || '?'), 'bad'); return; }
          toast(r.message, 'ok');
          CFG = null; DRAFT = {};
          if (ch.some(function (k) { return PROV_KEYS.indexOf(k) >= 0; })) {
            // CSF'e şimdi yaz (sonraki turu beklemeden): ayar CSF'e yazılır, csf ve lfd yeniden başlar
            workStart(t('pv_applying'), t('w_prov')); STALE = 'work'; busy = true; UI.provMsg = ''; UI.asnRaw = null; render();
            api('prov_apply').then(function (x) {
              var a = x && x.prov && x.prov.asn;
              UI.provMsg = a && (a.state === 'conflict' || a.state === 'self') ? a.msg : '';
              if (x && x.code === 3) toast(t('pv_busy'), 'ok');           // tur sürüyor: ayar kayıtlı, tur uygular
              else toast(x && x.ok ? (UI.provMsg || t('pv_applied')) : tErr((x && (x.message || x.error)) || '?'), x && x.ok && !UI.provMsg ? 'ok' : 'bad');
              busy = false; STALE = false; refresh();
            }, function () { busy = false; STALE = false; refresh(); });
            return;
          }
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
    banpfx: function (el) { var c = el.getAttribute('data-c'); rangeBan(bitsOf(c), c); },
    goto: function (el) { UI.menu = null; if (!focusRow(el.getAttribute('data-c'))) toast(t('focus_gone', el.getAttribute('data-c')), 'ok'); },
    ban24: function (el) { rangeBan(24, el.getAttribute('data-t')); },
    chg: function (el) { var c = el.getAttribute('data-c'), b = bitsOf(c); rangeBan(b, b === 16 ? p16(c) : b === 24 ? pfxOf(c.split('/')[0]) : c); },
    banforce: function (el) { rangeBan(24, el.getAttribute('data-t')); },
    svcexc: function (el) { svcExclude(el.getAttribute('data-t'), el.getAttribute('data-n')); },
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
          (rn ? '<label class="ag-clean"><input type="checkbox" id="ag-restore" checked><div><b>' + esc(t('m_restore', num(rn))) + '</b><span>' + esc(t('m_restore_d')) +
            (g.rips ? '<br>' + esc(t('m_restore_ips', g.rips.split(',').join(', ') + (rn > g.rips.split(',').length ? ' …' : ''))) : '') + '</span></div></label>' : ''),
        typed: dnd || kind === 'manual' || kind === 'partial' ? c : null, okText: t('unban'), okClass: 'ag-btn-danger-solid'
      }).then(function (m) {
        if (!m.ok) return;
        var rb = m.el.querySelector('#ag-restore');
        doAction('unban', c, rb && rb.checked ? { restore: '1' } : {});
      });
    },
    ignore: function (el) {
      var c = el.getAttribute('data-c'), chg = el.getAttribute('data-chg') === '1';   // chg: Yoksayılanlar → Süreyi değiştir (aynı işlem, başlık ve metin değişikliğe göre)
      modal({ icon: chg ? 'clock' : 'mute', tone: 'acc', title: t(chg ? 'm_ignchg_t' : 'm_ignore_t', '<span class="ag-mono">' + esc(c) + '</span>'),
              html: '<p>' + (chg ? t('m_ignchg_b', esc(el.getAttribute('data-until') || '')) : t('m_ignore_b')) + '</p>', days: true, okText: t(chg ? 'ign_change' : 'ignore') })
        .then(function (m) { if (m.ok) doAction('ignore', c, { days: String(m.days) }); });
    },
    rewatch: function (el) {
      var p = el.getAttribute('data-t');
      modal({ icon: 'clock', tone: 'acc', title: t('m_rewatch_t', '<span class="ag-mono">' + esc(p) + '.0/24</span>'), html: '<p>' + t('m_rewatch_b') + '</p>', okText: t('rewatch') })
        .then(function (m) { if (m.ok) doAction('rewatch', p); });
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
          if (!r.ok) { toast(tErr(r.error || '?'), 'bad'); return; }
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
            pre.outerHTML = drySummary(r.output || r.message || r.error || '');
          }).catch(function (e) { var pre = wrap.querySelector('#ag-dry'); if (pre) pre.textContent = e.message; });
        }
      });
    },
    update: function () {
      if (!UPD) return;
      modal({ icon: 'download', tone: 'acc', title: t('m_upd_t', esc(updV(UPD.latest, UPD.latest_commit))), html: '<p>' + t('m_upd_b') + '</p>', okText: t('upd_apply') }).then(function (m) {
        if (!m.ok) return;
        api('update_apply', { confirm: UPD.latest_commit }).then(function (r) {
          if (!r.ok) { toast(r.error === 'busy' ? t('upd_busy') : tErr(r.message || r.error || '?'), 'bad'); return; }
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

  // Deneme turu çıktısı: önce özet (yapılacaklar, bildirimler, sorunlar, tur satırları), ham çıktı açılır bölümde
  function drySummary(out) {
    var acts = [], mails = [], probs = [], rounds = [];
    String(out || '').split('\n').forEach(function (l) {
      var m;
      if ((m = /\[dry-run\]\s*(.*)$/.exec(l))) acts.push(m[1].trim());
      else if ((m = /\[(gönderilmeyecek mail|email not sent)\]\s*(.*)$/.exec(l))) mails.push(m[2].trim());
      else if ((m = /\]\s*(SORUN|PROBLEM):\s*(.*)$/.exec(l))) probs.push(m[2].trim());
      else if (/turu bitti\.|round done\.|round finished\./.test(l)) rounds.push(l.replace(/^\[[^\]]*\]\s*/, '').trim());
    });
    function sec(title, items, cls) {
      return '<div class="ag-dry-s"><div class="ag-dr-sub">' + esc(title) + '</div><ul class="ag-dry-l' + (cls ? ' ' + cls : '') + '">' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    return '<div class="ag-dry">' +
      (acts.length ? sec(t('dry_s_act'), acts) : '<div class="ag-dry-s ag-verdict">' + esc(t('dry_s_none')) + '</div>') +
      (mails.length ? sec(t('dry_s_mail'), mails) : '') +
      (probs.length ? sec(t('dry_s_prob'), probs, 'bad') : '') +
      (rounds.length ? sec(t('dry_s_round'), rounds) : '') +
      '<details class="ag-dry-raw"><summary>' + esc(t('dry_s_raw')) + '</summary><pre class="ag-out">' + colorize(out) + '</pre></details></div>';
  }
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
  function drAct(ev, close) {   // kart içindeki data-act düğmesi → ACTIONS (kart sayfa gövdesinde, $app dinleyicisinin dışında)
    var a = ev.target.closest('[data-act]');
    if (!a || a.disabled || !ACTIONS[a.getAttribute('data-act')]) return false;
    ev.preventDefault(); close(); ACTIONS[a.getAttribute('data-act')](a); return true;
  }
  function openDrawer(ip) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { toast(t(/:/.test(ip) ? 'ipv6_no' : 'bad_ip'), 'bad'); return; }
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
      if (drAct(ev, close)) return;
      var b = ev.target.closest('[data-dr]');
      if (b && b.getAttribute('data-dr') === 'x') close();
      if (b && b.getAttribute('data-dr') === 'copy' && navigator.clipboard) navigator.clipboard.writeText(ip).then(function () { toast(t('t_copied'), 'ok'); });
      // banlandıysa kart yeniden açılır: yeni kapsama satırı görünsün
      if (b && b.getAttribute('data-dr') === 'svcexc') svcExclude(ip, b.getAttribute('data-n')).then(function (ok) { if (ok) { close(); openDrawer(ip); } });
      if (b && b.getAttribute('data-dr') === 'banpfx') {
        var pc = b.getAttribute('data-c');
        rangeBan(bitsOf(pc), pc).then(function (r) { if (r && r.ok) { close(); openDrawer(ip); } });
      }
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
      if (d.deny) fw.push('<span class="ag-pill ag-pill-ban" title="' + esc(t('l_perm_single_h')) + '">' + t('l_perm_single') + '</span>' + rawLine(d.deny) + '');
      var mb = coverBits(d), srcOnce = 0;                           // IP'yi kapsayan en geniş tam ban (ban düğmeleri buna göre)
      (d.covers || []).forEach(function (c) {
        if (c.kind === 'cidr') {
          var cb = bitsOf(c.cidr);
          var cg = (S.groups || []).filter(function (x) { return x.cidr === c.cidr; })[0];
          var ce = (OWNERS[c.cidr] || {}).ev, cx = '';
          if (cg) cx += '<div class="ag-muted" style="margin-top:2px">' + esc(t('cov_info', t('kind_' + cg.kind) + (cg.dnd ? ' · ' + t('dnd_s') : ''), cg.added ? new Date(cg.added * 1000).toLocaleDateString(loc()) : '—')) + '</div>';
          if (ce && ce.ips && ce.ips.length) {
            cx += '<div class="ag-muted" style="margin-top:2px">' + esc(t('cov_why', ipSummary(ce.ips, ce.total))) + '</div>';
            var mine = ce.ips.filter(function (x) { return x.ip === ip; })[0];
            if (mine && mine.why) cx += '<div style="margin-top:2px">' + esc(t('own_why', whyText(mine.why))) + '</div>';
          }
          fw.push('<span class="ag-pill ag-pill-ban" title="' + esc(t('l_perm_cover_h')) + '">' + esc(cb === 24 ? t('l_perm_cover') : cb === 16 ? t('l_perm_net') : t('l_perm_rng', cb)) + '</span>' +
            '' + rawLine(c.line) + '' + cx +
            (c.open || c.open_extra ? '<div class="ag-muted" style="margin-top:2px">' + esc(t('l_open', svcNames(c.open, c.open_extra))) + '</div>' : ''));
        } else if (c.kind === 'port' && c.own) {                 // eklentinin kısmi banı
          var pb = bitsOf(c.cidr), px = (/;ports=([0-9,-]+)/.exec(c.line || '') || [])[1];
          fw.push('<span class="ag-pill ag-pill-part" title="' + esc(t('l_part_h')) + '">' + esc(pb === 16 ? t('l_part_net') : pb === 24 ? t('l_part_blk') : t('l_part_rng', pb)) + '</span>' +
            '' + rawLine(c.line) + '<div class="ag-muted" style="margin-top:2px">' + esc(t('l_part_d', svcNames(c.svc, px) || c.ports)) + '</div>');
        } else if (c.kind === 'port') {
          fw.push('<span class="ag-pill ag-pill-part">' + esc(t('l_port', c.proto, c.ports || '*', c.dir === 'in' || c.dir === 'out' ? t('dir_' + c.dir) : c.dir)) + '</span>' + rawLine(c.line) + '');
        } else if (c.kind === 'cc' || c.kind === 'asn') {
          fw.push('<span class="ag-pill ag-pill-ban">' + esc(t(c.kind === 'cc' ? 'l_ccd_cc' : 'l_ccd_asn', c.what)) + '</span>' + (srcOnce++ ? '' : '<div class="ag-muted" style="margin-top:4px">' + esc(t('l_ccd_src')) + '</div>') + asnNoData(c.what));
        } else if (c.kind === 'cloud') {
          fw.push('<span class="ag-pill ag-pill-part">' + esc(t('l_cloud', t('cl_' + c.what), [c.tcp ? 'tcp ' + c.tcp : '', c.udp ? 'udp ' + c.udp : ''].filter(Boolean).join(' · ') || '—')) + '</span>');
        } else if (c.kind === 'ccport') {
          fw.push('<span class="ag-pill ag-pill-part">' + esc(t('l_ccp', c.what, [c.tcp ? 'tcp ' + c.tcp : '', c.udp ? 'udp ' + c.udp : ''].filter(Boolean).join(' · ') || '—')) + '</span>' +
            (srcOnce++ ? '' : '<div class="ag-muted" style="margin-top:4px">' + esc(t('l_ccd_src')) + '</div>') + asnNoData(c.what));
        }
      });
      if (d.temp) fw.push('<span class="ag-pill ag-pill-temp">' + t('l_temp') + '</span>' + rawLine(d.temp) + '');
      var wl = [d.wl, d.rig ? 'csf.rignore: ' + d.rig : ''].filter(Boolean).map(esc).join('<br>');
      var wlAll = d.wl && !/^(csf\.ignore|GLOBAL_IGNORE)/.test(d.wl) && !/\((tcp|udp) (in|out) /.test(d.wl) ? d.wl : '';
      body.innerHTML = fact(t('l_fw'), verdict(d, mb) + (fw.length ? '<div class="ag-dr-sub">' + esc(t(wlAll ? 'l_layers_x' : 'l_layers')) + '</div>' + fw.join('<div style="height:8px"></div>') : '') +
          (d.self ? '' : drActs(ip, mb, d.pfx, wlAll))) +   // kendi adresi: ban düğmesi yok
        (function () {                             // bloğun eşiğe uzaklığı: beklemek mi, şimdi banlamak mı
          var b = d.blk, L = [];
          if (!b || mb <= 24) return '';
          if (d.wl && (b.s > 0 || b.t > 0)) return fact(t('l_blk'), esc(t('blk_wl', d.wl)));   // motor beyaz listedeki bloğu banlamaz
          if (b.s > 0) L.push(b.s < b.ts ? t('blk_left', num(b.s), num(b.ts), num(b.ts - b.s)) : t('blk_over', num(b.s), num(b.ts)));
          if (b.t > 0) L.push(b.t < b.tt ? t('blk_tleft', num(b.t), num(b.tt), num(b.tt - b.t)) : t('blk_tover', num(b.t), num(b.tt)));
          return L.length ? fact(t('l_blk'), L.map(esc).join('<br>')) : '';
        })() +
        fact(t('l_wl'), wl || '<span class="ag-muted">' + t('l_none') + '</span>') +
        fact(t('l_pending'), d.pend ? esc(pfxOf(ip) + '.0/24 · ' + d.pend) + (function () {   // neden izlendiği (varsa)
          var pc = pfxOf(ip) + '.0/24', pe = (OWNERS[pc] || {}).ev;
          return '<br><span class="ag-muted">' + esc(pe && pe.ips && pe.ips.length ? t('p_why', ipSummary(pe.ips, pe.total)) : t('p_why_none')) + '</span>';
        })() : '') + fact(t('l_acct'), acctParts(d.acct).length ? '<span title="' + esc(t('l_acct_h')) + '">' + acctParts(d.acct).map(esc).join('<br>') + '</span>' : '') +
        fact(t('l_ign'), d.ign ? esc(d.ign) + (d.ign_by ? '<span class="ag-muted" title="' + esc(d.ign_t ? new Date(d.ign_t * 1000).toLocaleString(loc()) : '') + '"> · ' + esc(d.ign_t ? t('ign_who', d.ign_by, rel(d.ign_t)) : d.ign_by) + '</span>' : '') + ' <button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="unignore" data-c="' + esc(String(d.ign).split(' → ')[0]) + '">' + esc(t('unignore')) + '</button>' : '') +   // yoksaymayı buradan da kaldır
        (function () {                             // Kontrol edilecekler'deki kaydı (aralık kartıyla aynı bilgi)
          var row = null, hit = null;
          (S.review || []).forEach(function (e) {
            if (row) return;
            var x = (e.ips || []).filter(function (i) { return i.ip === ip; })[0];
            if (x || e.cidr === ip) { row = e; hit = x || null; }
          });
          if (!row) return '';
          // satırın aralığı yalnız kartın IP'sinden farklıysa (ağ /16, blok /24) yazılır; aynıysa IP üç kez görünüyordu
          var h = esc(t('rg_rv', rvLabel(row), rel(row.t))) + (row.cidr === ip ? '' : ' <span class="ag-mono ag-muted">' + esc(row.cidr) + '</span>');
          if (hit && hit.bk) {
            // tablodaki satırla aynı veri, kısa satırlar hâlinde: son kayıt ve zamanı + sayı; kendi IP'de posta hesapları; izin kaynağı
            // (kendi IP'de kaynak ve "banlanamaz" cümlesi kartın Güvenlik duvarı ve Beyaz liste bölümlerinde zaten var, yinelenmez)
            var ak = abKind(hit), ls = [];
            var cntT = hit.cnt > 1 ? t('dr_rv_cnt', num(hit.cnt), num((S.config || {}).review_days || 7)) : '';
            if (hit.why) ls.push(t('ab_last', whyText(hit.why), rel(hit.t)) + (cntT ? ' ' + cntT : '')); else if (cntT) ls.push(cntT);
            if (ak === 's') { if (row.acct && row.acct.length && !(d.acct && d.acct.length)) ls.push(t('ab_s_acct', row.acctf || '', row.acct.map(function (a) { return a.u + ' (' + num(a.n) + ')'; }).join(', '))); }
            else ls.push(t('ab_' + ak + (ak === 'y' && !hit.al ? '_n0' : '_n'), hit.al || t('ab_src_none')));
            ls.forEach(function (l) { h += '<br><span class="ag-muted">' + esc(l) + '</span>'; });
          }
          if (rvDrop(row)) h += '<br><span class="ag-muted">' + esc(rvDrop(row)) + '</span>';   // tablodaki satırla aynı düşme tarihi
          // Yoksay buradan da: satır menüsündeki ile aynı pencere (yoksayılmışsa kaldırma düğmesi aşağıdaki Yoksayılıyor satırında)
          if (!d.ign) h += ' <button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="ignore" data-c="' + esc(row.cidr) + '">' + esc(t('ignore')) + '</button>';
          return fact(t('s_review'), h);
        })() +
        '<div class="ag-dr-sec">' + esc(t('l_who')) + '</div>' + (d.lookup ? '' : '<div class="ag-fact ag-muted">' + t('l_nolookup') + '</div>') +
        fact(t('l_owner'), owner) + fact(t('l_host'), host) +
        fact(t('l_prefix'), d.pfx ? '<span class="ag-mono">' + esc(d.pfx) + '</span>' + (d.cc ? ' ' + flag(d.cc) : '') : '') +
        fact(t('l_reg'), d.reg ? esc(d.reg) + (d.alloc ? ' · ' + esc(d.alloc) : '') : '');
      var sub = dr.querySelector('#ag-dr-sub'); if (sub) sub.textContent = d.asn ? ('AS' + d.asn + (d.cc ? ' · ' + d.cc : '')) : '';
      if (d.asn) dr.querySelector('#ag-dr-bgp').innerHTML = '<a class="ag-btn ag-btn-sm" target="_blank" rel="noopener noreferrer" href="https://bgp.he.net/AS' + encodeURIComponent(d.asn) + '">' + IC.ext + t('l_bgp') + '</a>';
    }).catch(function (e) { var body = dr.querySelector('#ag-dr-b'); if (body) body.innerHTML = empty('alert', e.message); });
  }
  // ── Aralık kartı ──────────────────────────────────────────────────
  // Tıklanan aralığın kendisi: aralık banlı mı (tam / kısmi / değil), saldırılan servisler kapalı mı açık mı, içindeki banlar,
  // Kontrol edilecekler'deki kaydı, sahibi. Veri: --inside (ban penceresinin taramasıyla aynı).
  var RANGE_RE = /^(\d{1,3}\.){3}\d{1,3}\/([89]|[12]\d|3[01])$/;   // /8–/31 aralık kartı (tıklanan aralık neyse kart o); /32 tek IP → IP kartı
  var SVC_TCP = { web: [80, 443], ftp: [21], cp: [2082, 2083, 2086, 2087, 2095, 2096], min: [25], sync: [465, 587, 993, 995], dns: [53] };
  function portsIn(list, ports) {      // "80,443,30000:35000" listesi bu portların hepsini içeriyor mu
    var L = String(list || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return ports.length > 0 && ports.every(function (p) {
      return L.some(function (x) { var m = /^(\d+)[:-](\d+)$/.exec(x); return m ? p >= +m[1] && p <= +m[2] : +x === p; });
    });
  }
  function rvLabel(e) {
    if (e.type === 'allow_grp') return t('ab_g');
    if (e.type === 'allow_ban') return t('ab_' + abKind(e));
    if (e.type === 'part_open') return t('po');
    return t(e.type === 'skip_wl' ? 'ev_skip_wl' : 'ev_' + e.type);
  }
  // Aralık kartının Kontrol edilecekler bölümü: tablodaki satırla aynı bilgi (rvParts) — Neden, notlar (her biri kendi satırında),
  // tekrar, düşme tarihi, satırdaki IP'ler sebepleriyle, satır menüsündeki daraltma banları ve Yoksay
  function rvCard(rv, have) {   // have: kartın "İçindeki banlar" listesindeki IP'ler (aynı IP iki listede yinelenmez)
    var h = esc(t('rg_rv', rvLabel(rv), rel(rv.t)));
    if ((rv.rep || 0) >= (S.repeat_min || 3)) h += ' <span class="ag-pill ag-pill-dw ag-pill-xs" title="' + esc(t('rep_h', num(rv.rep))) + '">' + esc(t('rep_n', num(rv.rep))) + '</span>';
    var L = [], acts = [];
    if (rv.type === 'part_open') {
      L.push(esc(countList(rv.since || {}))); L.push(esc(t('po_n', svcNames(rv.svc, rv.extra) || '?')));
    } else if (rv.type !== 'allow_ban' && rv.type !== 'allow_grp') {
      var P = rvParts(rv, esc(t('n_ip', num(rv.n))));
      if (P.meta.length) L.push(P.meta.join(' · '));
      P.det.forEach(function (x) { L.push('<span class="ag-muted">' + x + '</span>'); });
      if (P.pnote) L.push(P.pnote);
      if (P.narrow) acts.push('<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="ban24" data-t="' + esc(P.narrow.p) + '"' + tip24(P.narrow.p) + '>' + esc(lbl24(P.narrow.p)) + '</button>');
      if (P.apx) acts.push('<button class="ag-btn ag-btn-sm ag-btn-danger" data-act="banpfx" data-c="' + esc(P.apx.p) + '" title="' + esc(t('banpfx_h', num(Math.pow(2, 32 - bitsOf(P.apx.p))))) + '">' + esc(t('banpfx', '/' + bitsOf(P.apx.p))) + '</button>');
    }
    if (rvDrop(rv)) L.push('<span class="ag-muted">' + esc(rvDrop(rv)) + '</span>');
    L.forEach(function (x) { h += '<div style="margin-top:3px">' + x + '</div>'; });
    var ips = (rv.ips || []).filter(function (x) { return !(have && have[x.ip]); });   // şu an banlı olanlar yukarıdaki listede
    if (ips.length) h += '<details class="ag-im-more"><summary><span class="ag-im-mt">' + esc(t('rg_rv_ips')) + '</span><span class="ag-im-ms">' + esc(num(ips.length)) + '</span></summary><div class="ag-im-mb">' +
      '<table class="ag-im-t ag-rg-sgl"><thead><tr><th>' + esc(t('col_ip')) + '</th><th>' + esc(t('rg_c_svc')) + '</th><th>' + esc(t('col_reason')) + '</th></tr></thead><tbody>' +
      ips.map(function (x) { return '<tr><td class="ag-mono" data-ip="' + esc(x.ip) + '">' + esc(x.ip) + '</td><td>' + esc(svcLabel(x.svc || svcOfReason(x.why))) + '</td><td>' + esc(whyText(x.why)) + '</td></tr>'; }).join('') +
      '</tbody></table></div></details>';
    acts.push('<button class="ag-btn ag-btn-sm ag-btn-ghost" data-act="ignore" data-c="' + esc(rv.cidr) + '">' + esc(t('ignore')) + '</button>');
    return h + '<div class="ag-dr-acts">' + acts.join('') + '</div>';
  }
  function openRange(cidr) {
    var bits = bitsOf(cidr), base = cidr.replace(/\/\d+$/, '');
    var target = bits === 16 ? base.split('.').slice(0, 2).join('.') : bits === 24 ? base.split('.').slice(0, 3).join('.') : cidr;
    var scrim = document.createElement('div'); scrim.className = 'ag-scrim';
    var dr = document.createElement('aside'); dr.className = 'ag-drawer ag-app'; dr.style.cssText = 'margin:0;padding:0;min-height:0;background:#fff';
    var dOpener = focusSel(document.activeElement);
    dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true'); dr.setAttribute('aria-label', cidr);
    var kindT = bits === 16 ? t('rg_k16') : bits === 24 ? t('rg_k24') : t('rg_kp', '/' + bits);
    dr.innerHTML = '<div class="ag-drawer-h"><div><h3>' + esc(cidr) + '</h3><div class="ag-sub" id="ag-dr-sub">' + esc(kindT) + '</div></div>' +
      '<button class="ag-x" data-dr="x" aria-label="' + esc(t('close')) + '">' + IC.x + '</button></div>' +
      '<div class="ag-drawer-b" id="ag-dr-b">' + [1, 2, 3, 4].map(function () {
        return '<div class="ag-fact"><div class="ag-skel" style="width:30%"></div><div class="ag-skel" style="width:75%;margin-top:8px"></div></div>';
      }).join('') + '</div>' +
      '<div class="ag-drawer-f"><span id="ag-dr-bgp"></span><button class="ag-btn ag-btn-sm ag-btn-ghost" data-dr="copy">' + IC.copy + t('l_copy') + '</button></div>';
    document.body.appendChild(scrim); document.body.appendChild(dr);
    trap(dr); setTimeout(function () { var x = dr.querySelector('[data-dr="x"]'); if (x) x.focus(); }, 30);
    function close() {
      scrim.remove(); dr.remove(); var i = layerStack.indexOf(close); if (i >= 0) layerStack.splice(i, 1);
      if (!layerStack.length) refocus(dOpener);
    }
    layerStack.push(close);
    scrim.addEventListener('click', close);
    dr.addEventListener('click', function (ev) {
      if (drAct(ev, close)) return;
      var b = ev.target.closest('[data-dr]'), ipEl = ev.target.closest('[data-ip]');
      if (ipEl && !b) { close(); openDrawer(ipEl.getAttribute('data-ip')); return; }   // listedeki IP → IP kartı
      if (!b) return;
      var k = b.getAttribute('data-dr');
      if (k === 'x') close();
      if (k === 'copy' && navigator.clipboard) navigator.clipboard.writeText(cidr).then(function () { toast(t('t_copied'), 'ok'); });
      if (k === 'ban') rangeBan(bits, bits === 16 || bits === 24 ? target : cidr).then(function (r) { if (r && r.ok) { close(); openRange(cidr); } });
    });
    api('inside', { bits: String(bits), target: target }).then(function (d) {
      var body = dr.querySelector('#ag-dr-b'); if (!body) return;
      if (!d.ok) { body.innerHTML = empty('alert', d.error === 'bad_input' ? t('bad_ip') : (d.error || d.message || '?')); return; }
      // aralığın tamamını kapatan katmanlar
      var own = (d.own_partial || []).indexOf(cidr) >= 0, psv = own ? String(d.partial_svc || '').split(',').filter(Boolean) : [];
      var lay = [];
      // aralığın kendi banı (eklentinin listesinde): türü, ne zaman, silinmez mi, kaç tekille; dayandığı saldırılar olay kaydında
      var g = (S.groups || []).filter(function (x) { return x.cidr === cidr; })[0], gev = (OWNERS[cidr] || {}).ev;
      if (g && g.kind !== 'partial') {
        var gcls = { perm: 'ag-pill-ban', promoted: 'ag-pill-prom', temp: 'ag-pill-temp', manual: 'ag-pill-ban' }[g.kind] || 'ag-pill-n';
        lay.push('<span class="ag-pill ' + gcls + '" title="' + esc(t('kind_' + g.kind + '_h') + (g.dnd ? ' ' + t('kind_dnd_h') : '')) + '">' + esc(t('rg_own', t('kind_' + g.kind))) + '</span>' +
          '<div class="ag-muted" style="margin-top:3px">' + esc([g.dnd ? t('dnd_s') : '', g.added ? t('rg_added', new Date(g.added * 1000).toLocaleDateString(loc()), rel(g.added)) : '',
            g.kind === 'temp' && g.ttl > 0 ? t('left_short', dur(g.ttl)) : '', g.n ? t('rg_gn', num(g.n)) : ''].filter(Boolean).join(' · ')) + '</div>' +
          (gev && gev.ips && gev.ips.length ? '<div style="margin-top:3px">' + esc(t('cov_why', ipSummary(gev.ips, gev.total))) + '</div>' : '<div class="ag-muted" style="margin-top:3px">' + esc(t('rg_noev')) + '</div>'));
      }   // kapsayan ban (d.cover) yalnız sonuç satırında yazılır; katman listesinde ve soruda yinelenmez
      if (own) lay.push('<span class="ag-pill ag-pill-part" title="' + esc(t('l_part_h')) + '">' + esc(t('rg_part', svcNames(d.partial_svc, d.partial_extra) || '?')) + '</span>');
      if (d.cloud) lay.push('<span class="ag-pill ag-pill-part" title="' + esc(t('rg_cloud_h')) + '">' + esc(t('rg_cloud', t('cl_' + d.cloud), [d.cloud_tcp ? 'tcp ' + d.cloud_tcp : '', d.cloud_udp ? 'udp ' + d.cloud_udp : ''].filter(Boolean).join(' · ') || '—')) + '</span>');
      if (d.ccport) lay.push('<span class="ag-pill ag-pill-part" title="' + esc(t('rg_ccp_h')) + '">' + esc(t('rg_ccp', d.ccport, [d.ccp_tcp ? 'tcp ' + d.ccp_tcp : '', d.ccp_udp ? 'udp ' + d.ccp_udp : ''].filter(Boolean).join(' · ') || '—')) + '</span>');
      // saldırılan servis kapalı mı: aralığın tam banı, kendi kısmi banı, kiralık liste ya da sağlayıcının port listesi
      function closedBy(k) {
        if (d.cover) return d.cover;
        if (psv.indexOf(k) >= 0) return t('rg_by_part');
        var P = k === 'ssh' ? String(d.ssh || '22').split(',').map(Number) : SVC_TCP[k] || [];
        // web: TCP 80/443 yetmez, UDP 443 (HTTP/3) de kapalı olmalı; kiralık liste ve sağlayıcı port listesi UDP'yi ayrı tutar
        var U = k === 'web' ? [443] : [];
        if (d.cloud && portsIn(d.cloud_tcp, P) && (!U.length || portsIn(d.cloud_udp, U))) return t('cl_' + d.cloud);
        if (d.ccport && portsIn(d.ccp_tcp, P) && (!U.length || portsIn(d.ccp_udp, U))) return d.ccport;
        return '';
      }
      var A = d.attacks || {};
      if (!Object.keys(A).length && gev && gev.ips) gev.ips.forEach(function (x) { var k = x.svc || svcOfReason(x.why); A[k] = (A[k] || 0) + 1; });
      var keys = Object.keys(A).sort(function (a, b) { return A[b] - A[a]; }), openSv = [];
      var svRows = keys.map(function (k) {
        var by = k === 'other' || k === 'repeat' || k === 'scan' ? null : closedBy(k);
        if (by === '') openSv.push(k);
        var st = by === null ? '<span class="ag-muted">' + esc(t('rg_sv_unk')) + '</span>'
          : by ? '<span class="ag-pill ag-pill-ok" title="' + esc(t('rg_sv_closed_h', by)) + '">' + esc(t('rg_sv_closed')) + '</span>'
          : '<span class="ag-pill ag-pill-ban" title="' + esc(t('rg_sv_open_h')) + '">' + esc(t('rg_sv_open')) + '</span>';
        return '<tr><td>' + esc(svcLabel(k)) + '</td><td class="ag-rg-n">' + num(A[k]) + '</td><td class="ag-im-st">' + st + '</td></tr>';
      }).join('');
      var full = !!d.cover;
      var vtxt = full ? ['bad', t('rg_v_full', d.cover)] : lay.length ? ['part', t('rg_v_part')] : ['', t('rg_v_none')];
      var ask = full ? (keys.length ? t('rg_q_full_att') : t('rg_q_full')) : !keys.length ? t('rg_q_noatt') : openSv.length ? t('rg_q_open', openSv.map(svcLabel).join(', ')) : t('rg_q_closed');
      var verdictH = '<div class="ag-verdict ' + vtxt[0] + '">' + esc(vtxt[1]) + '</div>' +
        (lay.length ? '<div class="ag-dr-sub">' + esc(t('rg_layers')) + '</div>' + lay.join('<div style="height:6px"></div>') : '');
      var svH = keys.length ? '<table class="ag-im-t ag-rg-sv"><thead><tr><th>' + esc(t('rg_c_svc')) + '</th><th class="ag-th-r">' + esc(t('rg_c_ips')) + '</th><th>' + esc(t('col_now')) + '</th></tr></thead><tbody>' + svRows + '</tbody></table>' +
        '<div class="ag-verdict-a ag-muted">' + esc(ask) + '</div>' : '<span class="ag-muted">' + esc(ask) + '</span>';
      // içindeki banlar
      // aralığın kendisi banlıyken kendi eski izleme kaydı (sayaç) anlamsız: listede gösterilmez
      var wat = (d.watched || []).filter(function (x) { return !(d.cover && x === cidr); });
      function lst(a) { return a.length ? ' <span class="ag-mono ag-muted">' + esc(a.slice(0, 3).join(', ')) + (a.length > 3 ? ' +' + num(a.length - 3) : '') + '</span>' : ''; }
      var inRows = [
        d.blocks.length ? t('rg_in_blk', num(d.blocks.length)) + lst(d.blocks) : '',
        d.others.length ? t('rg_in_oth', num(d.others.length)) + lst(d.others) : '',
        d.singles + d.singles_dnd ? t('rg_in_sgl', num(d.singles + d.singles_dnd)) : '',
        d.temps ? t('rg_in_tmp', num(d.temps)) : '',
        wat.length ? t('rg_in_wat', num(wat.length)) + lst(wat) : '',
        (d.own_partial || []).filter(function (x) { return x !== cidr; }).length ? t('rg_in_part', num(d.own_partial.filter(function (x) { return x !== cidr; }).length)) : '',
        (d.ports || []).length ? t('rg_in_port', num(d.ports.length)) : ''
      ].filter(Boolean);
      // geçici tek IP banları da listede (motor kalan süreyle verir): "1 geçici ban" yazıp listede göstermiyordu
      var sgT = (d.sgl || []).filter(function (x) { return x.temp != null; }).length, sgN = d.singles + d.singles_dnd + sgT;
      var sg = (d.sgl || []).map(function (x) {
        var tp = x.temp != null ? '<span class="ag-pill ag-pill-temp ag-pill-xs" title="' + esc(t('left_short', dur(x.temp))) + '">' + esc(t('l_temp')) + ' · ' + esc(t('left_short', dur(x.temp))) + '</span> ' : '';
        return '<tr><td class="ag-mono" data-ip="' + esc(x.ip) + '">' + esc(x.ip) + '</td><td>' + esc(svcLabel(x.svc || 'other')) + '</td><td>' + tp + esc(whyText(x.why)) + '</td></tr>';
      }).join('');
      var inH = (inRows.length ? inRows.map(function (r) { return '<div>' + r + '</div>'; }).join('') : '<span class="ag-muted">' + esc(t(g && d.cover === cidr ? 'rg_in_none_own' : 'rg_in_none')) + '</span>') +
        (sg ? '<details class="ag-im-more"><summary><span class="ag-im-mt">' + esc(t(sgT ? 'rg_sgl_tt' : 'rg_sgl_t')) + '</span><span class="ag-im-ms">' + esc(t('im_bd_n', num((d.sgl || []).length), num(sgN))) + '</span></summary><div class="ag-im-mb">' +
          '<table class="ag-im-t ag-rg-sgl"><thead><tr><th>' + esc(t('col_ip')) + '</th><th>' + esc(t('rg_c_svc')) + '</th><th>' + esc(t('col_reason')) + '</th></tr></thead><tbody>' + sg + '</tbody></table></div></details>' : '');
      // Kontrol edilecekler'deki kaydı
      var rv = (S.review || []).filter(function (e) { return e.cidr === cidr; })[0];
      var have = {}; (d.sgl || []).forEach(function (x) { have[x.ip] = 1; });
      var rvH = rv ? rvCard(rv, have) : '';
      // aralıktaki izinli saldırganlar (Kontrol edilecekler'in bir satırında, tek ya da grup)
      var lo = ipNum(cidr), hi = lo + Math.pow(2, 32 - bits) - 1, aaN = 0;
      (S.review || []).forEach(function (e) { (e.ips || []).forEach(function (x) { if (x.bk) { var v = ipNum(x.ip); if (v >= lo && v <= hi) aaN++; } }); });
      if (aaN) rvH += (rvH ? '<br>' : '') + esc(t('rg_aa', num(aaN)));
      var acts = full || d.self || bits < 16 || bits > 24 ? '' : '<div class="ag-dr-acts"><button class="ag-btn ag-btn-sm ag-btn-danger" data-dr="ban">' + esc(bits === 16 ? lbl16(target) : bits === 24 ? lbl24(target) : t('banpfx', '/' + bits)) + '</button></div>';
      var oa = /^AS(\d+)/.exec(d.owner || '');
      body.innerHTML = fact(t('l_fw'), verdictH + acts) +
        fact(t('rg_sv'), svH) +
        fact(t('rg_in'), inH) +
        fact(t('s_review'), rvH) +
        fact(t('l_wl'), d.wl ? esc(d.wl) : '<span class="ag-muted">' + t('l_none') + '</span>') +
        (d.self ? fact(t('rg_self_l'), esc(t('in_self', d.self))) : '') +
        '<div class="ag-dr-sec">' + esc(t('l_who')) + '</div>' +
        fact(t('l_owner'), d.owner ? esc(shortOwner(d.owner)) : '<span class="ag-muted">—</span>');
      var sub = dr.querySelector('#ag-dr-sub'); if (sub && oa) sub.textContent = kindT + ' · AS' + oa[1];
      if (oa) dr.querySelector('#ag-dr-bgp').innerHTML = '<a class="ag-btn ag-btn-sm" target="_blank" rel="noopener noreferrer" href="https://bgp.he.net/AS' + encodeURIComponent(oa[1]) + '">' + IC.ext + t('l_bgp') + '</a>';
    }).catch(function (e) { var body = dr.querySelector('#ag-dr-b'); if (body) body.innerHTML = empty('alert', e.message); });
  }
  function pfxOf(ip) { return ip.split('.').slice(0, 3).join('.'); }
  function svcExclude(target, svc) {   // IP ya da aralık izinli servis listelerinden hariç tutulur; banları çalışmaya başlar
    var cur = String(((S && S.prov && S.prov.svc) || {}).except || '').split(/\s+/).filter(Boolean);
    if (cur.indexOf(target) >= 0) { toast(t('t_exc_ok', target), 'ok'); return Promise.resolve(true); }
    return modal({ icon: 'ban', tone: 'warn', title: esc(t('m_exc_t', target)), html: '<p>' + esc(t('m_exc_b', svc || '?')) + '</p>', okText: t('dr_exc_btn'), okClass: 'ag-btn-danger' }).then(function (m) {
      if (!m.ok) return false;
      cur.push(target);
      workStart(t('pv_applying'), t('w_prov')); STALE = 'work'; busy = true; render();
      return api('config_set', { 'v[SVC_EXCEPT]': cur.join(' ') }).then(function (r) {
        if (!r.ok) { busy = false; STALE = false; toast(tErr(r.message || r.error || '?'), 'bad'); render(); return false; }
        return api('prov_apply').then(function (x) {
          busy = false; STALE = false;
          toast(x && x.ok ? t('t_exc_ok', target) : tErr((x && (x.message || x.error)) || '?'), x && x.ok ? 'ok' : 'bad');
          return refresh().then(function () { return !!(x && x.ok); });
        });
      });
    });
  }

  /* ── Olay bağlama (tek dinleyici) ──────────────────────────────── */
  var NOHOVER = window.matchMedia && window.matchMedia('(hover: none)').matches;
  $app.addEventListener('click', function (ev) {
    var act = ev.target.closest('[data-act]'), ipEl = ev.target.closest('[data-ip]');
    // dokunmatik ekranda ipucu (title) hiç görünmez: eylemsiz bir rozete / kısaltmaya dokununca açıklaması bildirimde
    if (NOHOVER && !act && !ipEl && !ev.target.closest('a,button,input,select,textarea,label,summary')) {
      var tip = ev.target.closest('[title]');
      if (tip && tip.getAttribute('title')) { toast(tip.getAttribute('title'), 'ok'); return; }
    }
    // Açık menü, menüyü açıp kapatan düğme dışındaki her tıklamada kapanır — işlemden ÖNCE,
    // yoksa açılan onay penceresinin arkasında (ve pencere kapanınca da) menü açık kalıyordu.
    if (UI.menu && !(act && act.getAttribute('data-act') === 'menu')) {
      UI.menu = null; render();
      if (!act && !(ipEl && ipEl.getAttribute('data-ip'))) return;
    }
    if (ipEl && ipEl.getAttribute('data-ip')) {
      ev.preventDefault();
      var rtx = ipEl.classList.contains('ag-cidr') ? ipEl.textContent.trim() : '';
      if (RANGE_RE.test(rtx)) openRange(rtx); else openDrawer(ipEl.getAttribute('data-ip'));
      return;
    }
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
    if (ev.key === 'Enter' && tg.id === 'ag-asn-add') { ev.preventDefault(); ACTIONS.asnaddin(); return; }   // Sağlayıcılar: AS numarası kutusu
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
    if (ev.target.getAttribute && ev.target.getAttribute('data-cloudurl') && CFG) {
      var co = [];
      document.querySelectorAll('#ag-app [data-cloudurl]').forEach(function (inp) {
        var v = inp.value.trim(); if (v && v !== inp.getAttribute('data-def')) co.push(inp.getAttribute('data-cloudurl') + '|' + v);
      });
      DRAFT.CLOUD_URLS = co.join(' '); refreshSaveBar(); return;
    }
    if (ev.target.getAttribute && ev.target.getAttribute('data-svcurl') && CFG) {
      var ov = [];
      document.querySelectorAll('#ag-app [data-svcurl]').forEach(function (inp) {
        var v = inp.value.trim(); if (v && v !== inp.getAttribute('data-def')) ov.push(inp.getAttribute('data-svcurl') + '|' + v);
      });
      DRAFT.SVC_URLS = ov.join(' '); refreshSaveBar(); return;
    }
    if (ck && CFG) { DRAFT[ck] = ck === 'SVC_EXTRA' || ck === 'CLOUD_EXTRA' || ck === 'SVC_EXCEPT' ? ev.target.value.split(/\s+/).filter(Boolean).join(' ') : ev.target.value.trim(); refreshSaveBar(); return; }
    if (ev.target.id === 'ag-lk-ip') { UI.lk = ev.target.value; return; }
    if (ev.target.id === 'ag-gsort') {            // dar ekran: başlık gizli, sıralama bu seçimden
      var sv = String(ev.target.value).split(':'); UI.gs = sv[0]; UI.gd = +sv[1] || 1; UI.gp = 0;
      var gb = document.getElementById('ag-groups-b'); if (gb) gb.innerHTML = groupRows(); return;
    }
    if (ev.target.id === 'ag-gq') {
      UI.gq = ev.target.value; UI.gp = 0;
      var b = document.getElementById('ag-groups-b'); if (b) b.innerHTML = groupRows();
      var gc = document.getElementById('ag-gcount'); if (gc) gc.textContent = groupCount();
    }
  });

  /* ── Öğenin bugünkü durumu (Geçmiş satırındaki not ve eylemler buna göre; kayıt eski olsa da eylem güncel) ── */
  function rawLine(x) { return x ? '<details class="ag-raw"><summary>' + esc(t('raw_line')) + '</summary><div class="ag-mono">' + esc(x) + '</div></details>' : ''; }
  function asnNoData(w) {       // CSF sağlayıcının adres setini henüz doldurmadıysa kural etkisiz olabilir
    var x = (((S.prov || {}).asn || {}).sets || []).filter(function (z) { return z.a === w; })[0];
    return x && x.n === 0 ? '<div class="ag-warn-t">' + esc(t('pv_card_nodata')) + '</div>' : '';
  }
  // IP kartının en üstünde: sonuçta bu IP erişebilir mi, neyle engelli (birden çok kural varken hangisi geçerli)
  // izin kaydının kısa adı: "izinli servis openai-gptbot (74.7.241.0/25)", yoksa dosya ve kayıt ("csf.allow: 203.0.113.5");
  // tam yol (csf.allow → csf_autogroup.services.allow …) ipucunda ve IP kartının Beyaz liste bölümünde
  // İzinli / yoksayılan saldırgan türü: b = ban işlemiyor, i = lfd yoksaydı (tam izin), y = yoksayılıyor, s = sunucunun kendi IP'si.
  // En dış kapsamda: Kontrol edilecekler satırı, IP listesi, IP kartı ve olay etiketi aynı işlevi kullanır.
  function abKind(x) { return x.bk === 'i' ? (x.full === 2 ? 's' : x.full ? 'i' : 'y') : 'b'; }
  function wlShort(wl) {
    var wm = /services\.allow \(([^)]+)\): ([0-9.\/]+)/.exec(wl || '');
    if (wm) return t('v_wl_svc', wm[1], wm[2]);
    return String(wl || '').replace(/ → [^:]*/, '');
  }
  function verdict(d, mb) {
    var cv0 = d.covers || [], full = '', part = [];
    if (d.self) return '<div class="ag-verdict ok">' + esc(t('v_self')) + '</div>';   // kendi adresi: izin değil, banlanamaz
    // csf.ignore / GLOBAL_IGNORE yalnız lfd'nin banlamasını engeller; tek port açan allow satırı yalnız o portu açar
    var wlLfd = d.wl && /^(csf\.ignore|GLOBAL_IGNORE)/.test(d.wl), wlPort = d.wl && /\((tcp|udp) (in|out) /.test(d.wl);
    if (d.wl && !wlLfd && !wlPort) {
      var banned = d.deny || d.temp || cv0.some(function (c) { return c.kind === 'cidr' || c.kind === 'cc' || c.kind === 'asn' || (c.kind === 'port' && c.own); });
      var sm = /services\.allow \(([^)]+)\)/.exec(d.wl || ''), how = '';
      if (banned) how = sm ? '<div class="ag-verdict-a"><button class="ag-btn ag-btn-sm ag-btn-danger" data-dr="svcexc" data-n="' + esc(sm[1]) + '" title="' + esc(t('dr_exc_h')) + '">' + esc(t('dr_exc_btn')) + '</button>' +
          '<span class="ag-muted">' + esc(t('dr_exc_h')) + '</span></div>' : '<div class="ag-muted">' + esc(t('dr_wl_csfallow')) + '</div>';
      // kısa ad: "izinli servis openai-gptbot (74.7.241.0/25)" ya da "csf.allow"; tam yol aşağıdaki Beyaz liste bölümünde
      var wsh = wlShort(d.wl);
      return '<div class="ag-verdict ok">' + esc(t('v_allow', wsh)) + (banned ? ' ' + esc(t('v_allow_ban')) : '') + '</div>' + how;
    }
    var wn = wlLfd ? '<div class="ag-muted">' + esc(t('v_wl_lfd', wlShort(d.wl))) + '</div>' : wlPort ? '<div class="ag-muted">' + esc(t({ in_x: 'v_wl_port_in', out: 'v_wl_port_out' }[d.wle] || 'v_wl_port', wlShort(d.wl))) + '</div>' : '';
    cv0.forEach(function (c) {
      if ((c.kind === 'cc' || c.kind === 'asn') && !full) full = 'CC_DENY ' + c.what;
    });
    if (!full && mb < 99) full = cv0.filter(function (c) { return c.kind === 'cidr' && bitsOf(c.cidr) === mb; }).map(function (c) { return c.cidr; })[0] || '';
    if (!full && d.deny) full = t('v_single');
    if (!full && d.temp) full = t('v_temp');
    if (full) return '<div class="ag-verdict bad">' + esc(t('v_block', full)) + '</div>' + wn;
    cv0.forEach(function (c) {
      if (c.kind === 'port') part.push((c.own ? svcNames(c.svc, '') || c.ports : (c.proto || 'tcp') + ' ' + (c.ports || '*')) + ' (' + c.cidr + ')');
      if (c.kind === 'ccport') part.push([c.tcp ? 'TCP ' + c.tcp : '', c.udp ? 'UDP ' + c.udp : ''].filter(Boolean).join(', ') + ' (CC_DENY_PORTS ' + c.what + ')');
      if (c.kind === 'cloud') part.push([c.tcp ? 'TCP ' + c.tcp : '', c.udp ? 'UDP ' + c.udp : ''].filter(Boolean).join(', ') + ' (' + t('v_cloud', t('cl_' + c.what)) + ')');
    });
    return (part.length ? '<div class="ag-verdict part">' + esc(t('v_part', part.join(' · '))) + '</div>' : '<div class="ag-verdict">' + esc(t('v_none')) + '</div>') + wn;
  }
  // IP'yi kapsayan en geniş tam ban: /bit; ülke/ASN banı 0 (her şeyi kapsar), yoksa 99. Kısmi banlar (kind port) sayılmaz.
  function coverBits(d) {
    var mb = 99;
    (d.covers || []).forEach(function (c) {
      if (c.kind === 'cidr') mb = Math.min(mb, bitsOf(c.cidr));
      // ülke/ASN banı bloğu kesin kapsar; ağı (/16) yalnız duyurulan önek bütün ağı içeriyorsa
      else if (c.kind === 'cc' || c.kind === 'asn') mb = Math.min(mb, d.pfx && bitsOf(d.pfx) <= 16 ? 0 : 24);
    });
    return mb;
  }
  // IP kartının ban düğmeleri; mb = coverBits()
  function drActs(ip, mb, ap, wl) {
    if (mb <= 16) return '<div class="ag-muted ag-dr-note">' + esc(t('dr_covered')) + '</div>';
    var wn = '';                  // izinli IP'de "banlasanız da geçer" sonuç satırında bir kez söylenir
    // duyurulan aralık /24 ile /16 arasındaysa: az IP yüzünden bütün ağı kapatmadan o bölüm
    var pb = ap ? bitsOf(ap) : 0, pbtn = pb > 16 && pb < 24 && mb > pb && /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(ap) ?
      '<button class="ag-btn ag-btn-sm ag-btn-danger" data-dr="banpfx" data-c="' + esc(ap) + '" title="' + esc(t('banpfx_h', num(Math.pow(2, 32 - pb)))) + '">' + esc(t('banpfx', '/' + pb)) + '</button>' : '';
    return '<div class="ag-dr-acts">' + (mb > 24 ? '<button class="ag-btn ag-btn-sm ag-btn-danger" data-dr="ban24"' + tip24(pfxOf(ip)) + '>' + esc(lbl24(pfxOf(ip))) + '</button>' : '') + pbtn +
      '<button class="ag-btn ag-btn-sm ag-btn-danger" data-dr="ban16">' + esc(lbl16(p16(ip))) + '</button></div>' + wn;
  }
  function covers(g, x) {        // g aralığı x'i (IP ya da daha dar aralık) kapsıyor mu
    var bg = bitsOf(g.cidr), bx = bitsOf(x);
    if (bg > bx || bg < 1) return false;
    var d = Math.pow(2, 32 - bg);
    return Math.floor(ipNum(g.cidr) / d) === Math.floor(ipNum(x) / d);
  }
  function itemState(c) {
    if (!c || !S) return null;
    var x = /\//.test(c) ? c : c + '/32';
    var g = (S.groups || []).filter(function (o) { return o.cidr === c; })[0];
    return {
      r: (S.review || []).filter(function (o) { return o.cidr === c; })[0],
      g: g,
      p: /\/24$/.test(c) ? (S.pending || []).filter(function (o) { return o.prefix + '.0/24' === c; })[0] : null,
      ig: (S.ignored || []).filter(function (o) { return o.cidr === c; })[0],
      cov: g ? null : (S.groups || []).filter(function (o) { return o.kind !== 'partial' && o.cidr !== c && covers(o, x); })[0] || outerCover(x)
    };
  }
  // Eklentinin listelerinde olmayan ama öğeyi zaten tamamen kapatan ban: başka kaynaklı geniş aralık ya da ülke/ASN banı.
  // Ülke sahip önbelleğinden (/24 başına) bilinir; bir /16 için bilinen bütün blokları banlı ülkedeyse kapalı sayılır
  // (ağ birden çok önek içerebilir; son karar banla penceresinde, motorun kendi kontrolünde).
  function outerCover(x) {
    var w = (S.wide || []).filter(function (r) { return covers({ cidr: r }, x); })[0];
    if (w) return { cidr: w, kind: 'wide', self: w === x };       // self: öğenin kendisi başka kaynaktan banlı
    var ccd = String(S.ccd || '').split(',').filter(Boolean);
    if (!ccd.length) return null;
    function hitOf(o) { return !o ? '' : ccd.indexOf(o[1]) >= 0 ? o[1] : ccd.indexOf('AS' + o[0]) >= 0 ? 'AS' + o[0] : ''; }
    var hit = '';
    if (bitsOf(x) >= 24) hit = hitOf((S.owners || {})[prefixOf(x)]);
    else if (bitsOf(x) === 16) {
      var n16 = p16(x) + '.', ks = Object.keys(S.owners || {}).filter(function (k) { return k.indexOf(n16) === 0; });
      var hs = ks.map(function (k) { return hitOf(S.owners[k]); });
      if (hs.length && hs.every(Boolean)) hit = hs[0];
    }
    return hit ? { cidr: 'CC_DENY ' + hit, kind: 'cc', bits: 0 } : null;
  }
  function covBits(cv) { return cv.bits != null ? cv.bits : bitsOf(cv.cidr); }
  var BAN_TYPES = ['add24', 'promote', 'temp24', 'manual_ban', 'manual_change'];
  function stateNote(e, st) {    // yalnız öğenin en yeni satırında gösterilir
    if (!st) return '';
    if (st.g) return t(st.g.kind === 'partial' ? 'st_part' : 'st_ban');
    if (st.cov) return st.cov.self ? t('st_ban') : t('st_cov', st.cov.cidr);
    if (st.r) return t('st_review');
    if (st.p) return t('st_watch');
    if (st.ig) return st.ig.until >= '9999' ? t('st_ign_f') : t('st_ign', dayStr(st.ig.until));   // panelin tarih biçimiyle (ham 2027-01-03 görünüyordu)
    if (BAN_TYPES.indexOf(e.type) >= 0) return t('st_unbanned');
    if (/^warn16|^skip_wl$/.test(e.type)) return t('st_left');
    return '';
  }
  function itemMenu(c, e, st) {  // öğe için şu an geçerli eylemler — Genel bakış'taki satırlarla aynı eylemler ve pencereler
    var items = [], bits = bitsOf(c), p16v = /\//.test(c) || /^\d/.test(c) ? p16(c) : '', p24 = pfxOf(String(c).split('/')[0]);
    function first() { return e.ips && e.ips[0] && e.ips[0].ip ? e.ips[0].ip : bits < 32 ? String(c).replace(/\/\d+$/, '').replace(/\.0$/, '.1') : String(c).replace(/\/32$/, ''); }
    if (st.r) {
      if (bits === 16) items.push({ act: 'ban16', label: lbl16(p16v), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16v) + '"' });
      else items.push({ act: 'banforce', label: t('ban_anyway'), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p24) + '" data-wl="' + esc(st.r.wl || '') + '"' });
      var hwl = /services\.allow \(([^)]+)\): ([0-9.\/]+)/.exec(st.r.wl || '');
      if (hwl) items.push({ act: 'svcexc', label: t('dr_exc_btn') + ' (' + hwl[2] + ')', icon: 'ban', danger: true, attrs: 'data-t="' + esc(hwl[2]) + '" data-n="' + esc(hwl[1]) + '"' });
      items.push({ act: 'ignore', label: t('ignore'), icon: 'mute', attrs: 'data-c="' + esc(c) + '"' });
    } else if (st.g) {
      if ((st.g.kind === 'manual' || st.g.kind === 'partial') && bits >= 16 && bits <= 24) items.push({ act: 'chg', label: t('chg'), icon: 'sliders', attrs: 'data-c="' + esc(c) + '"' });
      // geçici blok banı ve aynı blok izleniyor: İzlenenler'deki "Kalıcı yap" burada da
      if (st.p && !st.p.under) items.push({ act: 'promote', label: t('promote'), icon: 'ban', attrs: 'data-t="' + esc(st.p.prefix) + '"' });
      if (bits > 16 && bitsOf(st.g.under) > 16) items.push({ act: 'ban16', label: lbl16(p16v), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16v) + '"' });
      items.push({ act: 'unban', label: t('unban'), icon: 'x', danger: true, attrs: 'data-c="' + esc(c) + '" data-dnd="' + (st.g.dnd ? 1 : 0) + '" data-kind="' + esc(st.g.kind) + '" data-restore="' + (st.g.restore || 0) + '"' });
    } else if (st.p) {
      if (!st.p.under) items.push({ act: 'promote', label: t('promote'), icon: 'ban', attrs: 'data-t="' + esc(st.p.prefix) + '"' });
      if (bitsOf(st.p.under) > 16) items.push({ act: 'ban16', label: lbl16(p16(st.p.prefix)), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16(st.p.prefix)) + '"' });
      items.push({ act: 'rewatch', label: t('rewatch'), icon: 'clock', attrs: 'data-t="' + esc(st.p.prefix) + '"' });
      items.push({ act: 'forget', label: t('forget'), icon: 'x', attrs: 'data-t="' + esc(st.p.prefix) + '"' });
    } else if (!st.cov && !st.ig) {
      // artık hiçbir listede değil: yeniden banlamak ya da bloğunu/ağını banlamak hâlâ mümkün
      if (bits === 16) items.push({ act: 'ban16', label: lbl16(p16v), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16v) + '"' });
      else if (/^\d/.test(String(c))) {
        items.push({ act: 'ban24', label: lbl24(p24), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p24) + '"' });
        items.push({ act: 'ban16', label: lbl16(p16v), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16v) + '"' });
      }
    } else if (st.cov && bits > 16 && covBits(st.cov) > 16 && bitsOf(st.cov.under) > 16) {
      // blok banının içinde: ağı banlamak hâlâ anlamlı; blok yalnız geçici banlıysa kalıcı banlamak da (IP kartıyla aynı)
      if (st.cov.kind === 'temp' && bits > 24) items.push({ act: 'ban24', label: lbl24(p24), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p24) + '"' });
      items.push({ act: 'ban16', label: lbl16(p16v), icon: 'ban', danger: true, attrs: 'data-t="' + esc(p16v) + '"' });
    }
    if (st.r || st.g || st.p) items.push({ act: 'goto', label: t('goto'), icon: 'search', attrs: 'data-c="' + esc(c) + '"' });
    items.push({ act: 'ipcard', label: t('ipcard'), icon: 'search', attrs: 'data-ip="' + esc(first()) + '"' });
    return items;
  }
  /* Genel bakış'ta bir satıra git: sayfasını aç, ayrıntısını aç, kaydır ve vurgula (mail bağlantısı da bunu kullanır) */
  function focusRow(f) {
    UI.tab = 'overview'; history.replaceState(null, '', location.pathname + location.search);
    var inReview = S.review.some(function (e) { return e.cidr === f; });
    var inGroups = S.groups.some(function (g) { return g.cidr === f; });
    if (inReview) { UI.open['r:' + f] = true; UI.lim = UI.lim || {}; UI.lim.rv = Math.max(UI.lim.rv || 20, S.review.length); }   // sınırın dışındaysa da görünsün
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
      return true;
    }
    return false;
  }

  /* ── Maildeki bağlantı: ?focus=CIDR → o satıra kay, aç, vurgula ─── */
  function applyFocus() {
    var q = new URLSearchParams(location.search), f = q.get('focus') || '', ip = q.get('ip') || '';
    if (!f && !ip) return;
    history.replaceState(null, '', location.pathname + location.hash);   // yenilemede tekrar kaymasın
    if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) { openDrawer(ip); return; }
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(f)) return;
    if (!focusRow(f)) {
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
      if (!busy && !(cfgTab() && CFG && changedKeys().length)) render();
      else {
        // yeniden çizilemiyorsa (tur sürüyor / kaydedilmemiş ayar) şerit ve kart yerinde güncellenir
        var bn = document.getElementById('ag-bnr'); if (bn) bn.innerHTML = banner();
        var c = document.getElementById('ag-updcard'); if (c) c.outerHTML = updCard();
      }
    });
  }

  /* ── Başlangıç ─────────────────────────────────────────────────── */
  (function bootWait() {          // ilk durum gelene kadar: ne okunuyor (süre sayılmaz)
    var b = document.querySelector('.ag-boot'); if (!b) return;
    try { LANG = localStorage.getItem('ag-lang') || ''; } catch (e) { LANG = ''; }
    if (LANG !== 'tr' && LANG !== 'en') LANG = /^tr/i.test(navigator.language || '') ? 'tr' : 'en';
    var txt = document.createElement('div');
    txt.className = 'ag-boot-t'; txt.textContent = t('boot_wait'); b.appendChild(txt);
  })();
  refresh().then(function () {
    if (S) applyFocus();
    checkUpdate(false);
  });
  setInterval(function () { if (!document.hidden) checkUpdate(false); }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && UPD_T && Date.now() / 1000 - UPD_T > 30 * 60) checkUpdate(false);
  });
})();
