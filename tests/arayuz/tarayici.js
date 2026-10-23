// Arayüz testi (tests/arayuz/calistir.sh çağırır): node tarayici.js <url> [görüntü dizini]
// Playwright ile başsız Chromium: sekmeler, genişlikler, IP kartları, menüler, Yoksay akışı. Her denetim bir satır.
const { chromium } = require('playwright');
const [URL, OUT = ''] = process.argv.slice(2);
let N = 0, F = 0;
function check(name, ok, info) { N++; if (!ok) F++; console.log(`  ${ok ? '✓' : '✗'} ${name}${info ? ' → ' + info : ''}`); }
async function ready(page) {
  await page.waitForFunction(() => { const a = document.getElementById('ag-app'); return a && a.getAttribute('aria-busy') !== 'true'; }, null, { timeout: 90000 });
  await page.waitForTimeout(600);
}
async function layoutChecks(page, label, width) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`${label} · ${width} px · yatay taşma yok`, sw <= width, `belge ${sw}px`);
  const clipped = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-pill')).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim()));
  check(`${label} · ${width} px · kesilen rozet yok`, clipped.length === 0, clipped.slice(0, 5).join(' | '));
  // görünümün sağından taşan öğe (kart içinde kesilen düğme / seçenek sırası dahil)
  const over = await page.evaluate(w => Array.from(document.querySelectorAll('button, .ag-chip, .ag-pill, .ag-card, input, select')).filter(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; }).map(e => (e.className || e.tagName) + ': ' + (e.textContent || '').trim().slice(0, 30)), width);
  check(`${label} · ${width} px · sağdan taşan öğe yok`, over.length === 0, over.slice(0, 4).join(' | '));
  // tutarlılık: tablo başlığının sütun sayısı satırın hücre sayısına eşit (başlık, altındaki satırla örtüşmeli)
  const mism = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-thead')).map(h => {
    const row = h.parentElement && h.parentElement.querySelector('.ag-tr'); if (!row) return null;
    return h.children.length === row.children.length ? null : h.textContent.trim().slice(0, 30) + ': başlık ' + h.children.length + ' / satır ' + row.children.length; }).filter(Boolean));
  check(`${label} · ${width} px · tablo başlığı satırla aynı sütun sayısında`, mism.length === 0, mism.join(' | '));
  // tutarlılık: sıra numarası yalnız sıralama kartında ("En çok …")
  const rank = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-rank')).map(e => { const c = e.closest('.ag-card'), h = c && c.querySelector('h2'); return h ? h.textContent.trim() : '?'; })
    .filter(t => !/^(En çok|Most)/.test(t)));
  check(`${label} · ${width} px · sıra numarası yalnız sıralama kartında`, rank.length === 0, rank.slice(0, 3).join(' | '));
  // son satır kartın dibine yapışmasın: satırdaki en alttaki metin ile satırın alt kenarı arasında en az 6 px
  const tight = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-card-b')).map(b => {
    const rows = b.querySelectorAll(':scope > .ag-item, :scope > .ag-tbl > .ag-item, :scope > .ag-asn-r, :scope > .ag-ev, :scope > .ag-row'); const last = rows[rows.length - 1]; if (!last) return null;
    const lb = last.getBoundingClientRect().bottom; let mx = 0;
    last.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (!e.children.length && r.height > 0) mx = Math.max(mx, r.bottom); });
    if (!mx) return null; const gap = Math.round(lb - mx), c = b.closest('.ag-card'), h = c && c.querySelector('h2');
    return gap < 6 ? (h ? h.textContent.trim().slice(0, 25) : '?') + ': ' + gap + ' px' : null; }).filter(Boolean));
  check(`${label} · ${width} px · son satır kartın dibine yapışık değil`, tight.length === 0, tight.slice(0, 4).join(' | '));
  // tablo satırında hücreler üst üste binmesin (⋯ düğmesinin metnin altında kalması gibi)
  const lap = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-tr')).map(row => {
    const cs = Array.from(row.children).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return row.textContent.trim().slice(0, 30); }
    return null; }).filter(Boolean));
  check(`${label} · ${width} px · satır hücreleri üst üste binmiyor`, lap.length === 0, lap.slice(0, 3).join(' | '));
}
(async () => {
  const opts = { args: ['--no-sandbox'] };
  if (process.env.AG_CHROME) opts.executablePath = process.env.AG_CHROME;
  const browser = await chromium.launch(opts);
  const errs = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { var u = (m.location && m.location().url) || ''; if (m.type() === 'error' && !/favicon/.test(m.text() + u)) errs.push(m.text() + (u ? ' (' + u + ')' : '')); });
  const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
  console.log('Arayüz');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 }); await ready(page);
  check('sayfa açıldı, durum yüklendi', await page.$('.ag-head') !== null);
  // sekmeler, iki genişlikte
  for (const tab of ['overview', 'history', 'prov', 'settings']) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const b = await page.$(`.ag-tabs [data-tab="${tab}"]`);
      if (b) { await b.click(); await page.waitForTimeout(900); }
      await layoutChecks(page, tab, width);
      await shot(`${tab}-${width}`);
      if (width === 390 && tab === 'overview') {
        // başlık düğmeleri telefonda tek sırada (sağda alt alta dizilince başlık iki kat yükseliyordu)
        const tops = await page.$$eval('.ag-head-actions .ag-btn', L => L.map(b => Math.round(b.getBoundingClientRect().top)));
        check('390: başlık düğmeleri aynı satırda', tops.length >= 3 && Math.max(...tops) - Math.min(...tops) <= 2, tops.join(','));
      }
      if (width === 1280 && tab === 'history') {
        // zaman sütunu bütün satırlarda aynı sağ kenarda (menüsüz satırlar 42 px sağa kayıyordu); her satırda menü hücresi var
        const r = await page.evaluate(() => { const rows = Array.from(document.querySelectorAll('#ag-events .ag-ev')); if (!rows.length) return null;
          const R = rows.map(x => { const t = x.querySelector('.ag-ev-time'); return t ? Math.round(t.getBoundingClientRect().right) : -1; }).filter(v => v > 0);
          // tarih metninin sağ kenarı: aç/kapa işaretinin yeri her satırda ayrılmış olmalı (yoksa rakamlar kayar)
          const T = rows.map(x => { const t = x.querySelector('.ag-ev-time'); if (!t || !t.firstChild || t.firstChild.nodeType !== 3) return -1; const rg = document.createRange(); rg.selectNodeContents(t.firstChild); return Math.round(rg.getBoundingClientRect().right); }).filter(v => v > 0);
          return { n: rows.length, spread: Math.max(...R) - Math.min(...R), textSpread: T.length ? Math.max(...T) - Math.min(...T) : 0, noMenu: rows.filter(x => !x.querySelector('.ag-ev-m')).length }; });
        check('1280: Geçmiş satırlarında zaman sütunu ve tarih metni aynı hizada, her satırda menü hücresi', r === null || (r.spread <= 1 && r.textSpread <= 1 && r.noMenu === 0), r ? JSON.stringify(r) : 'olay yok, atlandı');
      }
      if (width === 390 && tab === 'history') {
        // Geçmiş satırı: zaman ayrıntı metninin içinde (başlıktaki gizli), ⋯ üst satırın sağında; zaman hiçbir satırda tek başına
        // bir satır başında kalmaz (önünde metin olur; rozetler arada kalıp saati alta itiyordu); durum rozetsiz satır en çok 100 px
        const r = await page.evaluate(() => { const L = Array.from(document.querySelectorAll('.ag-ev')); if (!L.length) return null;
          const e = L[0], b = e.querySelector('.ag-ev-b'), d = e.querySelector('.ag-ev-d'), t = e.querySelector('.ag-ev-t .ag-ev-time'), t2 = e.querySelector('.ag-ev-tm2'), m = e.querySelector('.ag-ev-m');
          const alone = L.filter(x => { const dd = x.querySelector('.ag-ev-d'), tt = x.querySelector('.ag-ev-tm2'); if (!dd || !tt || !dd.textContent.replace(tt.textContent, '').trim()) return false;
            return tt.getBoundingClientRect().left - dd.getBoundingClientRect().left < 8; }).length;
          const tall = L.filter(x => !x.querySelector('.ag-ev-st') && x.getBoundingClientRect().height > 100).map(x => Math.round(x.getBoundingClientRect().height));
          return { ok: !!(d && t2) && d.contains(t2) && t2.getBoundingClientRect().height > 0 && (!t || t.getBoundingClientRect().height === 0),
            menuTop: m ? Math.round(m.getBoundingClientRect().top - b.getBoundingClientRect().top) : 0, alone, tall }; });
        check('390: Geçmiş satırında zaman ayrıntıda ve tek başına kalmıyor, menü üstte, rozetsiz satır ≤ 100 px', r === null || (r.ok && r.menuTop <= 6 && r.alone === 0 && r.tall.length === 0), r ? JSON.stringify(r) : 'olay yok, atlandı');
      }
    }
  }
  // kısa telefon ekranı (tarayıcı çubukları açıkken): Terimler penceresi başlığı ve Kapat düğmesiyle görünüm içinde kalmalı
  await page.setViewportSize({ width: 390, height: 560 });
  await page.click('.ag-tabs [data-tab="overview"]'); await page.waitForTimeout(600);
  {
    const b = await page.$('[data-act="terms"]');
    if (b) {
      await b.click(); await page.waitForTimeout(600);
      const r = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); if (!m) return null; const h = m.querySelector('.ag-modal-h'), f = m.querySelector('.ag-modal-f');
        const R = e => e ? e.getBoundingClientRect() : null, mh = R(h), mf = R(f); return { ok: !!(mh && mf) && mh.top >= 0 && mf.bottom <= window.innerHeight, head: mh && Math.round(mh.top), foot: mf && Math.round(mf.bottom), vh: window.innerHeight }; });
      check('390×560: Terimler penceresi başlık ve Kapat ile görünüm içinde', !!r && r.ok, JSON.stringify(r));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
  }
  // Ayarlar: sayı kutusunun + / − düğmesi bir adım atar (kaydedilmez; geri alınır)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('.ag-tabs [data-tab="settings"]');
  await page.waitForSelector('.ag-setnav [data-s]', { timeout: 20000 }).catch(function () {}); await page.waitForTimeout(300);
  {
    // Ayarlar ilk açılışta menünün ilk bölümüyle (Genel) gelir; öncelik sırası menüdeki sırayla aynı
    const first = await page.$$eval('.ag-setnav [data-s]', L => ({ f: L[0] && L[0].getAttribute('data-s'), on: (L.filter(b => b.classList.contains('on'))[0] || {}).getAttribute ? L.filter(b => b.classList.contains('on'))[0].getAttribute('data-s') : null }));
    check('Ayarlar: ilk açılışta ilk bölüm (Genel) seçili', first.f === 'general' && first.on === 'general', JSON.stringify(first));
  }
  {
    // her bölüm aynı kalıpla açılır: ilk öğe tek satır açıklama, sonra kartlar (bölümler arası geçişte içerik kaymasın)
    const secs = await page.$$eval('.ag-setnav [data-s]', L => L.map(b => b.getAttribute('data-s')));
    const bad = [], tops = [];
    for (const s of secs) {
      await page.click(`.ag-setnav [data-s="${s}"]`); await page.waitForTimeout(400);
      const r = await page.evaluate(() => { const m = document.querySelector('.ag-setmain'); const f = m && m.firstElementChild; const n = f && f.nextElementSibling;
        return { lead: !!(f && f.classList.contains('ag-sec-lead') && f.textContent.trim()), top: n ? Math.round(n.getBoundingClientRect().top) : -1 }; });
      if (!r.lead) bad.push(s + ': açıklama yok'); else tops.push(r.top);   // ilk kartın üst kenarı bölümden bölüme aynı olmalı
    }
    const spread = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
    check('Ayarlar: her bölüm açıklama ile başlıyor, ilk kart aynı hizada (±24 px)', bad.length === 0 && spread <= 24, bad.join(' | ') + ' ' + tops.join(','));
  }
  {
    const nav = await page.$('.ag-setnav [data-s="thr"]'); if (nav) { await nav.click(); await page.waitForTimeout(500); }
    const inp = await page.$('#ag-f-THRESHOLD_24');
    if (inp) {
      const v0 = +(await inp.inputValue());
      await page.click('[data-act="numstep"][data-k="THRESHOLD_24"][data-d="1"]'); await page.waitForTimeout(200);
      const v1 = +(await page.inputValue('#ag-f-THRESHOLD_24'));
      await page.click('[data-act="numstep"][data-k="THRESHOLD_24"][data-d="-1"]'); await page.waitForTimeout(200);
      const v2 = +(await page.inputValue('#ag-f-THRESHOLD_24'));
      check('Ayarlar: sayı kutusu + / − bir adım atar', v1 === v0 + 1 && v2 === v0, `${v0} → ${v1} → ${v2}`);
      const dirty = await page.$('.ag-savebar, [data-act="cfgsave"]');
      check('Ayarlar: + sonra − ile taslak temiz (kaydet çubuğu yok)', !dirty || !(await dirty.isVisible()), '');
    } else check('Ayarlar: sayı kutusu var', false, '#ag-f-THRESHOLD_24 yok');
  }
  {
    // Bildirim: olay × kanal tablosu — 5 olay (1.15.4: Kontrol edilecekler bulguları) × 2 kanal; hücre tıklanınca kaydet çubuğu çıkar, geri tıklanınca taslak temiz; telefonda sığar
    const nav = await page.$('.ag-setnav [data-s="notify"]'); if (nav) { await nav.click(); await page.waitForTimeout(500); }
    const cells = await page.$$('.ag-evm .ag-chk');
    check('Bildirim: olay × kanal tablosu 10 hücre', cells.length === 10, String(cells.length));
    if (cells.length === 10) {
      const sel = '.ag-evm .ag-chk[data-k="IE_RUN"]';
      const p0 = await page.getAttribute(sel, 'aria-pressed');
      await page.click(sel); await page.waitForTimeout(300);
      const p1 = await page.getAttribute(sel, 'aria-pressed'), bar1 = await page.$('.ag-savebar');
      await page.click(sel); await page.waitForTimeout(300);
      const p2 = await page.getAttribute(sel, 'aria-pressed'), bar2 = await page.$('.ag-savebar');
      check('Bildirim: hücre tıklanınca değişir ve kaydet çubuğu çıkar, geri tıklanınca taslak temiz', p1 !== p0 && p2 === p0 && !!bar1 && !bar2, `${p0}→${p1}→${p2}`);
      await page.setViewportSize({ width: 390, height: 800 }); await page.waitForTimeout(400);
      const r = await page.evaluate(() => { const t = document.querySelector('.ag-evm'); const b = t && t.getBoundingClientRect();
        return b ? { r: Math.round(b.right), w: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth } : null; });
      check('Bildirim: tablo 390 px\'te sığıyor', !!r && r.r <= r.w && r.sw <= r.w, JSON.stringify(r));
      await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(400);
    }
  }
  await page.click('.ag-tabs [data-tab="overview"]'); await page.waitForTimeout(900);
  {
    // Son tur ipucu: durum verisinin alındığı saat (ss:dd:ss); geri sayım kutusu var
    const tip = await page.$eval('#ag-last', b => b.parentElement.getAttribute('title') || '').catch(() => '');
    check('Son tur ipucunda veri saati var', /\d{1,2}:\d\d:\d\d/.test(tip), tip);
  }
  // Terimler penceresi
  const terms = await page.$('[data-act="terms"]');
  if (terms) { await terms.click(); await page.waitForTimeout(600); check('Terimler penceresi açılıyor', await page.$('.ag-terms') !== null); const no = await page.$('[data-m="no"], [data-m="ok"]'); if (no) await no.click(); await page.waitForTimeout(400); }
  // Kontrol edilecekler satırları: IP kartı ve menü
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-item[data-row] .ag-tr-r')).map(r => ({
    cidr: r.closest('.ag-item').getAttribute('data-row'), ip: (r.querySelector('.ag-cidr') || {}).getAttribute ? r.querySelector('.ag-cidr').getAttribute('data-ip') : '' })));
  console.log(`  Kontrol edilecekler: ${rows.length} satır`);
  for (const r of rows) {
    const before = errs.length;
    const el = await page.$(`.ag-item[data-row="${r.cidr}"] .ag-cidr`);
    if (!el) continue;
    await el.click();
    await page.waitForFunction(() => { const d = document.querySelector('.ag-drawer'); return d && d.innerText.length > 40 && !d.querySelector('.ag-spin'); }, null, { timeout: 20000 }).catch(function () {});
    await page.waitForTimeout(300);
    const txt = await page.evaluate(() => { const d = document.querySelector('.ag-drawer'); return d ? d.innerText : ''; });
    check(`IP kartı açılıyor: ${r.cidr}`, errs.length === before && txt.length > 40, errs.slice(before).join(' | '));
    // kartın Kontrol edilecekler satırı Yoksay (yoksayılmamışsa) ya da Yoksaymayı kaldır sunmalı
    const cardIgn = await page.evaluate(() => !!document.querySelector('.ag-drawer [data-act="ignore"], .ag-drawer [data-act="unignore"]'));
    check(`IP kartında Yoksay / kaldır var: ${r.cidr}`, cardIgn);
    // kart sayfa gövdesinde (eklentinin alanı dışında): düğme tıklanınca işlem çalışmalı (önce hiçbir şey olmuyordu)
    if (cardIgn) {
      await page.click('.ag-drawer [data-act="ignore"], .ag-drawer [data-act="unignore"]'); await page.waitForTimeout(700);
      check(`IP kartındaki Yoksay / kaldır tıklanınca pencere açılır: ${r.cidr}`, await page.$('.ag-modal') !== null);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);   // onaylamadan kapat
    }
    await page.keyboard.press('Escape');   // üst katmanı (IP kartı) kapatır
    await page.waitForFunction(() => !document.querySelector('.ag-drawer'), null, { timeout: 5000 }).catch(function () {});
    await page.waitForTimeout(300);
    const mb = await page.$(`.ag-item[data-row="${r.cidr}"] [data-act="menu"]`);
    if (mb) {
      await mb.click(); await page.waitForTimeout(400);
      const acts = await page.evaluate(c => Array.from(document.querySelectorAll(`.ag-item[data-row="${c}"] .ag-menu [data-act]`)).map(b => b.getAttribute('data-act')), r.cidr);
      check(`menüde Yoksay var: ${r.cidr}`, acts.includes('ignore'), acts.join(','));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
  }
  // Yoksay akışı: ilk satır yoksayılır, Yoksayılanlar'da görünür, geri alınır
  if (rows.length) {
    const c = rows[0].cidr;
    await page.click(`.ag-item[data-row="${c}"] [data-act="menu"]`); await page.waitForTimeout(400);
    await page.click(`.ag-item[data-row="${c}"] .ag-menu [data-act="ignore"]`); await page.waitForTimeout(600);
    check('Yoksay penceresi açıldı', await page.$('.ag-modal [data-m="ok"]') !== null);
    await page.click('.ag-modal [data-m="ok"]'); await page.waitForTimeout(6000);
    const gone = await page.$(`.ag-item[data-row="${c}"] .ag-tr-r`) === null;
    const listed = await page.$(`[data-act="menu"][data-key="im:${c}"]`) !== null;
    check(`Yoksay: ${c} listeden düştü ve Yoksayılanlar'da`, gone && listed, `düştü=${gone} listede=${listed}`);
    // Yoksayılanlar satırının ⋯ menüsü: Süreyi değiştir ve Yoksaymayı kaldır, görünür (kartın / görünümün dışına taşmadan)
    const untilOf = () => page.evaluate(c => { const r = document.querySelector(`.ag-item[data-row="${c}"] .ag-td-until`); return r ? r.textContent : ''; }, c);
    const openIm = async () => { await page.click(`[data-act="menu"][data-key="im:${c}"]`); await page.waitForTimeout(400); };
    if (listed) {
      await openIm();
      const vis = await page.evaluate(() => { const b = document.querySelector('.ag-menu [data-act="unignore"]'); if (!b) return 'yok';
        const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= window.innerWidth + 1 && r.left >= -1 ? 'ok' : `menü ${Math.round(r.left)}–${Math.round(r.right)}`; });
      const acts = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-menu [data-act]')).map(b => b.getAttribute('data-act')));
      check('Yoksayılanlar menüsü: Süreyi değiştir + Yoksaymayı kaldır, görünür', vis === 'ok' && acts.includes('ignore') && acts.includes('unignore'), vis + ' ' + acts.join(','));
      // Süreyi değiştir: 30 gün → 7 gün; bitiş tarihi değişmeli
      const before7 = await untilOf();
      await page.click(`.ag-menu [data-act="ignore"][data-c="${c}"]`); await page.waitForTimeout(600);
      const d7 = await page.$('.ag-modal #ag-days [data-d="7"]'); if (d7) await d7.click();
      await page.click('.ag-modal [data-m="ok"]'); await page.waitForTimeout(6000);
      const after7 = await untilOf();
      check(`Süreyi değiştir: ${c} bitişi değişti`, after7 && after7 !== before7, `${before7} → ${after7}`);
      await openIm();
      await page.click(`.ag-menu [data-act="unignore"][data-c="${c}"]`); await page.waitForTimeout(600);
      const ok = await page.$('.ag-modal [data-m="ok"]'); if (ok) await ok.click();
      await page.waitForTimeout(6000);
      check(`Yoksaymayı kaldır: ${c} geri geldi`, await page.$(`.ag-item[data-row="${c}"] .ag-tr-r`) !== null);
    }
  }
  // İzlenenler: satır menüsünde "İzlemeyi yeniden başlat" ve kalan süre yenilenir (izlenen blok yoksa atlanır)
  const wrow = await page.$('.ag-item [data-act="menu"][data-key^="pm:"], .ag-item [data-act="menu"][data-key^="wm:"]');
  const wmenu = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('[data-act="menu"]')).filter(b => /^(pm|wm|w):/.test(b.getAttribute('data-key') || ''))[0]; return b ? b.getAttribute('data-key') : ''; });
  if (wmenu) {
    await page.click(`[data-act="menu"][data-key="${wmenu}"]`); await page.waitForTimeout(400);
    const acts = await page.evaluate(k => Array.from(document.querySelectorAll(`[data-key="${k}"] ~ .ag-menu [data-act], .ag-menu-wrap .ag-menu [data-act]`)).map(b => b.getAttribute('data-act')), wmenu);
    check('İzlenenler menüsünde izlemeyi yeniden başlat var', acts.includes('rewatch'), acts.join(','));
    const rw = await page.$('.ag-menu [data-act="rewatch"]');
    if (rw) {
      const pfx = await rw.getAttribute('data-t');
      await rw.click(); await page.waitForTimeout(500);
      const ok = await page.$('.ag-modal [data-m="ok"]'); if (ok) await ok.click();
      await page.waitForTimeout(6000);
      const left = await page.evaluate(p => { const r = Array.from(document.querySelectorAll('.ag-item[data-row]')).filter(x => x.getAttribute('data-row') === p + '.0/24')[0]; return r ? r.innerText : ''; }, pfx);
      check(`İzlemeyi yeniden başlat: ${pfx}.0/24 satırı duruyor`, left.length > 0, left.slice(0, 60).replace(/\n/g, ' '));
    }
  } else console.log('  (izlenen blok yok: izlemeyi yeniden başlat denenmedi)');
  // Deneme turu: gerçek motor kuru çalışır; pencere özetle açılmalı (ham çıktı açılır bölümde)
  const dryBtn = await page.$('[data-act="dry"]');
  if (dryBtn) {
    await dryBtn.click();
    await page.waitForFunction(() => document.querySelector('.ag-modal .ag-dry'), null, { timeout: 90000 }).catch(function () {});
    const dry = await page.evaluate(() => { const d = document.querySelector('.ag-modal .ag-dry'); return d ? { sum: d.querySelectorAll('.ag-dry-s').length, raw: !!d.querySelector('.ag-dry-raw pre') } : null; });
    check('Deneme turu penceresi özetle açılıyor (ham çıktı ayrı)', !!dry && dry.sum > 0 && dry.raw, JSON.stringify(dry));
    await shot('deneme-turu');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }
  check('JS hatası yok', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`Arayüz: ${N} denetim, ${F} beklenmeyen`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.log('  ✗ HATA: ' + e.message); process.exit(1); });
