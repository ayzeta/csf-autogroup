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
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('.ag-tabs [data-tab="overview"]'); await page.waitForTimeout(900);
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
    await el.click(); await page.waitForTimeout(1800);
    const txt = await page.evaluate(() => { const d = document.querySelector('.ag-drawer'); return d ? d.innerText : ''; });
    check(`IP kartı açılıyor: ${r.cidr}`, errs.length === before && txt.length > 40, errs.slice(before).join(' | '));
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
    const listed = await page.evaluate(c => Array.from(document.querySelectorAll('[data-act="unignore"]')).some(b => b.getAttribute('data-c') === c), c);
    check(`Yoksay: ${c} listeden düştü ve Yoksayılanlar'da`, gone && listed, `düştü=${gone} listede=${listed}`);
    // "Yoksaymayı kaldır" düğmesi gerçekten görünür mü (dar sütunda kartın dışına taşıp gizlenmiş olmasın)
    const vis = await page.evaluate(c => { const b = Array.from(document.querySelectorAll('[data-act="unignore"]')).filter(b => b.getAttribute('data-c') === c)[0]; if (!b) return 'yok';
      const r = b.getBoundingClientRect(), card = b.closest('.ag-card').getBoundingClientRect(); return r.width > 0 && r.right <= card.right + 1 && r.left >= card.left - 1 ? 'ok' : `düğme ${Math.round(r.left)}–${Math.round(r.right)}, kart ${Math.round(card.left)}–${Math.round(card.right)}`; }, c);
    check('Yoksaymayı kaldır düğmesi kartın içinde görünür', vis === 'ok', vis);
    if (listed) {
      await page.click(`[data-act="unignore"][data-c="${c}"]`); await page.waitForTimeout(600);
      const ok = await page.$('.ag-modal [data-m="ok"]'); if (ok) await ok.click();
      await page.waitForTimeout(6000);
      check(`Yoksaymayı kaldır: ${c} geri geldi`, await page.$(`.ag-item[data-row="${c}"] .ag-tr-r`) !== null);
    }
  }
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
