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
// Tıklanan her öğe tıklanabilir görünmeli: kenarlık, zemin ya da alt çizgi (simge düğmesi hariç). Kabul edilen kalıplar:
// sıralanan tablo başlığı, zeminli çip grubu (sekme gibi), üzerine gelince renklenen satır / döşeme, simge düğmesi.
const KURAL = `window.agHizaKayik = function (root) {
  // sütun başlığı ile hücreleri aynı hizada (sağa yaslı başlık, sola yaslı içerik okuyanı şaşırtır)
  const out = [];
  Array.from(root.querySelectorAll('table')).filter(tb => tb.offsetWidth > 0).forEach(tb => {
    const th = Array.from(tb.querySelectorAll('thead th')), tr = tb.querySelector('tbody tr'); if (!th.length || !tr) return;
    const td = Array.from(tr.children);
    th.forEach((h, i) => { const c = td[i]; if (!c || !h.offsetWidth || !c.textContent.trim()) return;
      const a = getComputedStyle(h).textAlign, b = getComputedStyle(c).textAlign;
      const n = x => (x === 'start' ? 'left' : x === 'end' ? 'right' : x);
      if (n(a) !== n(b)) out.push((tb.className || 'table') + ': ' + h.textContent.trim() + ' (' + n(a) + ' / ' + n(b) + ')'); });
  });
  return out;
};
window.agIpBagsiz = function (root) {
  // tek başına IP ya da aralık yazan öğe IP / aralık kartını açmalı (kartın kendi başlığı, giriş kutuları hariç)
  const re = /^\\d{1,3}(\\.\\d{1,3}){3}(\\/\\d{1,2})?$/;
  return Array.from(root.querySelectorAll('td, span, div, b, li, code')).filter(e => {
    if (!e.offsetWidth || !re.test(e.textContent.trim())) return false;
    if (Array.from(e.children).some(c => c.textContent.trim() === e.textContent.trim())) return false;
    return !e.closest('[data-ip], [data-act], a, button, input, textarea, select, .ag-drawer-h');
  }).map(e => (e.className || e.tagName) + ': ' + e.textContent.trim());
};
window.agGorunmez = function (root) {
  function saydam(c) { return !c || c === 'transparent' || /rgba\\(.*,\\s*0\\)$/.test(c); }
  return Array.from(root.querySelectorAll('[data-ip],[data-act],[data-dr],button,a')).filter(e => {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    if (e.closest('.ag-tabs') || e.matches('input,select,textarea,label,summary')) return false;
    if (e.matches('.ag-th, .ag-chips:not(.ag-icwrap) > .ag-chip, .ag-ev.clickable, .ag-tile-m, .ag-lay-i, .ag-tile-ed, .ag-iconbtn, .ag-menu-i, .ag-setnav-i, .ag-x')) return false;
    const cs = getComputedStyle(e);
    if (!e.textContent.trim() && e.querySelector('svg')) return false;
    if (/underline/.test(cs.textDecorationLine)) return false;
    if (['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && !saydam(cs['border' + s + 'Color']))) return false;
    if (!saydam(cs.backgroundColor) && cs.backgroundColor !== 'rgb(255, 255, 255)') return false;
    return true;
  }).map(e => (typeof e.className === 'string' && e.className ? e.className : e.tagName) + ': ' + e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 30));
};
window.agUlkeTekrar = function (root) {
  // ülke rozetinin (US) yanındaki metin aynı kodu yeniden yazmaz ("Amazon.com, Inc., US US" gibi)
  return Array.from(root.querySelectorAll('.ag-flag')).filter(f => f.offsetWidth > 0).map(f => {
    const cc = f.textContent.trim(), p = f.parentElement; if (!/^[A-Z]{2}$/.test(cc) || !p) return null;
    const s = Array.from(p.childNodes).filter(n => n !== f).map(n => n.textContent).join(' ');
    return new RegExp('(^|[^A-Za-z])' + cc + '($|[^A-Za-z])').test(s) ? cc + ': ' + p.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60) : null;
  }).filter(Boolean);
};
// kardeş satır tutarlılığı ve dolgu (kullanıcının gözüyle bulduğu sınıflar, 2026-11-06): banlanabilen seviye (blok, ağ, sağlayıcı)
// banlı değilse düğmesi olur (yalnız Blok ve Ağ'da vardı); ülke rozeti yalnız Ülke satırında (Duyurulan aralık'ta da vardı);
// sıfır sayaç yazılmaz ("0/3"); bir cümle kapattığı servisi "açık" diye örneklemez
window.agKardes = function (root) {
  const R = [], self = /kendi adresi|own address/.test(root.innerText || '');   // sunucunun kendi IP'si: hiçbir seviye banlanmaz
  root.querySelectorAll('.ag-lv-t tbody tr').forEach(tr => {
    if (self) return;
    const c = tr.children, lab = (c[0] || {}).textContent.trim(), st = tr.querySelector('.ag-lv-st');
    if (/^(Blok|Block|Ağ|Network|Sağlayıcı|Provider)$/.test(lab) && st && !/\\b(ban|part)\\b/.test(st.className) && !tr.querySelector('.ag-lv-act button'))
      R.push(lab + ': banlı değil ama ban düğmesi yok');
    if (!/^(Ülke|Country)$/.test(lab) && c[1] && c[1].querySelector('.ag-flag')) R.push(lab + ': ülke rozeti ülke satırı dışında');
  });
  const tx = root.innerText || '';
  (tx.match(/(^|[^0-9.\\/])0\\/\\d+\\b[^\\n]{0,30}/g) || []).forEach(m => R.push('sıfır sayaç: ' + m.trim()));
  (tx.match(/[^.\\n]*kapalı[^.\\n]*\\.[^.\\n]*\\([^)\\n]*\\)\\s*açık/g) || []).forEach(s => {
    const kap = s.split('.')[0], ac = (s.match(/\\(([^)]*)\\)\\s*açık/) || [])[1] || '';
    ac.split(/[,…]/).map(x => x.trim()).filter(x => x && new RegExp('(^|[^A-Za-zçğıöşü])' + x + '($|[^A-Za-zçğıöşü])', 'i').test(kap)).forEach(x => R.push('çelişen cümle (' + x + ' hem kapalı hem açık): ' + s.trim().slice(0, 80)));
  });
  return R;
};
window.agBasliksiz = function (root) {
  return Array.from(root.querySelectorAll('table')).filter(tb => tb.offsetWidth > 0 && tb.querySelector('tbody tr'))
    .filter(tb => { const h = tb.querySelector('thead'); return !h || h.offsetHeight === 0; })
    .map(tb => (tb.className || 'table') + ': ' + (tb.querySelector('tbody tr').textContent || '').trim().slice(0, 25));
};
window.agKart = function () {
  const d = document.querySelector('.ag-drawer'); if (!d) return null;
  d.querySelectorAll('details').forEach(x => { x.open = true; });
  const kendi = ((d.querySelector('.ag-drawer-h h3') || {}).textContent || '').trim();
  const n = {}; d.querySelectorAll('[data-ip]').forEach(e => { const k = e.textContent.trim(); if (k !== kendi) n[k] = (n[k] || 0) + 1; });
  const say = {}; (d.querySelector('.ag-drawer-b') || d).textContent.replace(/(\\d+)\\s+(tekil|geçici|kalıcı)(?![a-zçğıöşü])/g, (m, x, w) => { (say[w] = say[w] || new Set()).add(x); return m; });
  return { kardes: window.agKardes(d), ulke: window.agUlkeTekrar(d), bas: window.agBasliksiz(d), ipb: window.agIpBagsiz(d), hiz: window.agHizaKayik(d), gor: window.agGorunmez(d), cok: Object.keys(n).filter(k => n[k] > 1).map(k => k + ' × ' + n[k]),
    celis: Object.keys(say).filter(w => say[w].size > 1).map(w => w + ': ' + Array.from(say[w]).join(' / ')) };
};`;
// sayfa yeniden çizilse de (veri geç geldi, yoklama) tıklama anında öğeyi yeniden bulur; page.$ tutamacı geçersiz kalıyordu
// ("Element is not attached to the DOM", ara sıra)
async function tik(page, sel) { const l = page.locator(sel).first(); if (!(await l.count())) return false; await l.click({ timeout: 15000 }); return true; }
async function kartKurallari(page, ad) {
  await page.evaluate(KURAL);
  const k = await page.evaluate(() => window.agKart());
  if (!k) return;
  check(`kart ${ad} · tıklanabilir öğeler tıklanabilir görünüyor`, k.gor.length === 0, k.gor.slice(0, 4).join(' | '));
  check(`kart ${ad} · aynı IP bir kez`, k.cok.length === 0, k.cok.slice(0, 4).join(' | '));
  check(`kart ${ad} · çelişen sayı yok`, k.celis.length === 0, k.celis.join(' | '));
  check(`kart ${ad} · tablolar başlıklı`, k.bas.length === 0, k.bas.join(' | '));
  check(`kart ${ad} · kardeş satırlar tutarlı, sıfır dolgu ve çelişen cümle yok`, k.kardes.length === 0, k.kardes.slice(0, 4).join(' | '));
  check(`kart ${ad} · ülke kodu rozetin yanında yinelenmiyor`, k.ulke.length === 0, k.ulke.slice(0, 3).join(' | '));
  check(`kart ${ad} · IP / aralık yazan her öğe tıklanıyor`, k.ipb.length === 0, k.ipb.slice(0, 4).join(' | '));
  check(`kart ${ad} · sütun başlıkları hücrelerle aynı hizada`, k.hiz.length === 0, k.hiz.slice(0, 4).join(' | '));
}
async function layoutChecks(page, label, width) {
  await page.evaluate(KURAL);
  const gor = await page.evaluate(() => window.agGorunmez(document.getElementById('ag-app')));
  const bas = await page.evaluate(() => window.agBasliksiz(document.getElementById('ag-app')));
  check(`${label} · ${width} px · tablolar başlıklı`, bas.length === 0, bas.slice(0, 3).join(' | '));
  const ulke = await page.evaluate(() => window.agUlkeTekrar(document.getElementById('ag-app')));
  check(`${label} · ${width} px · ülke kodu rozetin yanında yinelenmiyor`, ulke.length === 0, ulke.slice(0, 3).join(' | '));
  const ipb = await page.evaluate(() => window.agIpBagsiz(document.getElementById('ag-app')));
  check(`${label} · ${width} px · IP / aralık yazan her öğe tıklanıyor`, ipb.length === 0, ipb.slice(0, 4).join(' | '));
  check(`${label} · ${width} px · tıklanabilir öğeler tıklanabilir görünüyor`, gor.length === 0, gor.slice(0, 4).join(' | '));
  const kd = await page.evaluate(() => [].concat(window.agKardes(document.getElementById('ag-app')), ...Array.from(document.querySelectorAll('.ag-drawer, .ag-modal')).map(x => window.agKardes(x))));
  check(`${label} · ${width} px · kardeş satırlar tutarlı, sıfır dolgu ve çelişen cümle yok`, kd.length === 0, kd.slice(0, 4).join(' | '));
  // hiçbir yerde yatay kaydırma yok (kullanıcı kararı: kartta / pencerede / tabloda yatay çubuk istenmiyor); komut çıktısı hariç
  const yk = await page.evaluate(() => Array.from(document.querySelectorAll('#ag-app *, .ag-drawer *, .ag-modal *')).filter(e => {
    if (!e.offsetWidth || e.closest('pre, .ag-out, textarea')) return false;
    const ox = getComputedStyle(e).overflowX; return /auto|scroll/.test(ox) && e.scrollWidth > e.clientWidth + 1;
  }).map(e => (e.className || e.tagName) + ' ' + e.scrollWidth + '>' + e.clientWidth));
  check(`${label} · ${width} px · yatay kaydırma yok`, yk.length === 0, yk.slice(0, 4).join(' | '));
  // sağa yaslı (sayı) sütunun başlık metni sütundaki değerlerle aynı yerde biter (Tekil: başlık sağındaki boş sıralama oku yeri
  // metni sayıların 12 px solunda bitiriyordu)
  const hz = await page.evaluate(() => { const R = [], txr = e => { const s = document.createRange(); s.selectNodeContents(e); const r = s.getBoundingClientRect(); return r.width ? r.right : null; };
    document.querySelectorAll('#ag-app .ag-thead .ag-th.ag-num-c').forEach(h => { if (!h.offsetWidth) return;
      const tn = Array.from(h.childNodes).find(n => n.nodeType === 3 && n.textContent.trim()); if (!tn) return;
      const s = document.createRange(); s.selectNodeContents(tn); const hr = s.getBoundingClientRect().right;
      const tb = h.parentElement.parentElement, c = tb && tb.querySelector('.ag-tr .ag-td.ag-num-c'); if (!c || !c.offsetWidth) return;
      const cr = txr(c); if (cr != null && Math.abs(cr - hr) > 3) R.push(tn.textContent.trim() + ' başlık ' + Math.round(hr) + ' / değer ' + Math.round(cr)); });
    return R; });
  check(`${label} · ${width} px · sayı sütununun başlığı değerlerle hizalı`, hz.length === 0, hz.slice(0, 3).join(' | '));
  // harflerden oluşan sözcük ortadan bölünmez (IP kartı seviye sütununda "Duyur-ulan", "Sağlay-ıcı"); IP / adres / kod sayılmaz
  const bol = await page.evaluate(() => { const R = [], roots = [document.getElementById('ag-app')].concat(Array.from(document.querySelectorAll('.ag-drawer, .ag-modal')));
    roots.forEach(root => { if (!root) return; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode()) && R.length < 6) { const p = n.parentElement; if (!p || !p.offsetWidth || p.closest('pre, .ag-mono, .ag-raw, input, textarea')) continue;
        const re = /[A-Za-zÇĞİÖŞÜçğıöşü]{5,}/g; let m;
        while ((m = re.exec(n.textContent))) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          const rs = Array.from(r.getClientRects()).filter(x => x.width > 0); if (rs.length > 1 && Math.abs(rs[0].top - rs[rs.length - 1].top) > 4) { R.push(m[0]); break; } } } });
    return R; });
  check(`${label} · ${width} px · sözcük ortadan bölünmüyor`, bol.length === 0, bol.join(' | '));
  // kısa yazılı düğme satır boyu gerilmez (sağlayıcı satırındaki "Ayrıntı" eski bir seçici yüzünden telefonda kartın enine uzuyordu)
  const ger = await page.evaluate(() => Array.from(document.querySelectorAll('#ag-app .ag-btn, .ag-modal .ag-btn')).filter(b => {
    if (!b.offsetWidth || b.closest('.ag-head-actions, .ag-modal-f, .ag-lookup, .ag-savebar')) return false;
    const tx = b.textContent.trim(), cs = getComputedStyle(b);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), ic = b.querySelector('svg') ? 24 : 0;
    const need = (() => { const s = document.createElement('span'); s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + cs.font; s.textContent = tx; document.body.appendChild(s); const w = s.offsetWidth; s.remove(); return w; })();
    return tx.length > 0 && tx.length <= 24 && b.offsetWidth > (need + pad + ic) * 1.8 + 40;
  }).map(b => b.textContent.trim() + ' ' + b.offsetWidth + 'px'));
  check(`${label} · ${width} px · kısa yazılı düğme gerilmiyor`, ger.length === 0, ger.slice(0, 4).join(' | '));
  // tarih ham ISO biçiminde yazılmaz (IP kartında "izleniyor · 2026-11-06"); CSF satırı, komut çıktısı ve giriş kutuları hariç
  const iso = await page.evaluate(() => { const R = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const e = n.parentElement; if (!e || !e.offsetWidth || e.closest('pre, code, details, .ag-mono, textarea, .ag-out, .ag-commits')) continue;
      if (!e.closest('#ag-app, .ag-modal, .ag-drawer')) continue;
      const m = n.textContent.match(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}\.\d{1,2}\.20\d\d\b/); if (m) R.push(n.textContent.trim().slice(0, 60)); }
    return R; });
  check(`${label} · ${width} px · tarih ham (YYYY-AA-GG / GG.AA.YYYY) yazılmıyor`, iso.length === 0, iso.slice(0, 3).join(' | '));
  // tıklanan iki öğe üst üste binmez (dar ekranda sığmayan düğmenin yanındakinin üstüne taşması)
  const lapB = await page.evaluate(() => {
    const E = Array.from(document.querySelectorAll('#ag-app button, #ag-app a, #ag-app input, #ag-app select, #ag-app .ag-chip')).filter(e => e.offsetWidth > 0);
    const R = E.map(e => e.getBoundingClientRect()), out = [];
    for (let i = 0; i < E.length && out.length < 4; i++) for (let j = i + 1; j < E.length; j++) {
      if (E[i].contains(E[j]) || E[j].contains(E[i])) continue;
      // döşemenin köşesindeki Adres düğmesi bilerek döşemenin üstünde (metin ona yer bırakır)
      if ([E[i], E[j]].some(e => e.matches('.ag-tile-ed')) && [E[i], E[j]].some(e => e.matches('.ag-tile-m'))) continue;
      // kaydet çubuğu bilerek içeriğin üstünde yüzer (position: fixed): altındaki düğmeyle binmesi yerleşim hatası değil
      if ([E[i], E[j]].filter(e => e.closest('.ag-savebar')).length === 1) continue;
      const a = R[i], b = R[j];
      if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) { out.push(E[i].textContent.trim().slice(0, 15) + ' ↔ ' + E[j].textContent.trim().slice(0, 15)); break; }
    }
    return out;
  });
  check(`${label} · ${width} px · tıklanan öğeler üst üste binmiyor`, lapB.length === 0, lapB.join(' | '));
  // kimlik (IP / aralık adı) hiç kısaltılmaz
  // öğenin kendisi taşmasa da taşmayı gizleyen bir üst kutu onu kesebilir (telefonda "173.239.240.0/24" → "…/2" göründü)
  const cut = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-cidr, [data-ip]')).filter(e => {
    if (!e.offsetWidth) return false;
    if (e.scrollWidth > e.clientWidth + 1) return true;
    const r = e.getBoundingClientRect();
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a); if (o.overflowX === 'visible' && o.overflow === 'visible') continue;
      const q = a.getBoundingClientRect(); return r.right > q.right + 1 || r.left < q.left - 1;
    }
    return false;
  }).map(e => e.textContent.trim().slice(0, 20) + ' (' + String(e.className || e.tagName).slice(0, 20) + ' ⊂ ' + String((e.closest('.ag-item, .ag-card, .ag-drawer, .ag-modal') || {}).className || '').slice(0, 30) + ')'));
  check(`${label} · ${width} px · IP / aralık adı kesilmiyor`, cut.length === 0, cut.slice(0, 4).join(' | '));
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
const errs = [];          // sayfanın JS hataları: test yarıda düşerse de yazılır
(async () => {
  const opts = { args: ['--no-sandbox'] };
  if (process.env.AG_CHROME) opts.executablePath = process.env.AG_CHROME;
  const browser = await chromium.launch(opts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { var u = (m.location && m.location().url) || ''; if (m.type() === 'error' && !/favicon/.test(m.text() + u)) errs.push(m.text() + (u ? ' (' + u + ')' : '')); });
  const shot = async (name) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
  // test makinesinde ASN sorgusu cevapsız kalır, IP kartının sağlayıcı satırları hiç çizilmezdi (canlıda "shortName is not
  // defined" yalnız ASN gelince düştü): sorgu ASN döndürmediyse belgeleme ASN'si ve Cymru biçiminde ad eklenir
  // Susturulanlar'daki adreslerin sahibi de yoksa (test makinesinde sorgu cevapsız) uzun bir ad eklenir: 1.15.59'da sahip satırı dar
  // kartta bitişi ve ⋯ menüsünü kartın dışına itiyordu, sahipsiz test verisinde görünmedi
  await page.route('**/api.php', async route => {
    const pd = route.request().postData() || '';
    if (!/^a=(lookup|status)(&|$)/.test(pd)) return route.continue();
    // sayfa / bağlam kapanırken yoldaki istek: route.fetch atar, yakalanmazsa bütün test düşüyordu (2026-11-10, son denetimde)
    let r; try { r = await route.fetch(); } catch (e) { return; }
    let j = null;
    try { j = await r.json(); } catch (e) { return route.fulfill({ response: r }); }
    if (/^a=lookup/.test(pd) && j && j.ok && !j.asn) { j.asn = '64500'; j.asname = 'TEST-AS - Example Network, US'; j.cc = j.cc || 'US'; }
    // duyurulan aralık da (canlıda sahip sorgusu açıkken her kartta): "Duyurulan aralığı banla (/17)" düğmesi çizilsin — testte
    // yoktu, telefonda o düğmenin kartı 61 px yatay kaydırdığını göremedi
    if (/^a=lookup/.test(pd) && j && j.ok && !j.pfx && /^\d+\.\d+\.\d+\.\d+$/.test(j.ip || '')) { const o = j.ip.split('.'); j.pfx = o[0] + '.' + o[1] + '.' + (o[2] & 128) + '.0/17'; }
    if (/^a=status/.test(pd) && j && j.ok) {
      // boş harita PHP'den [] gelir (json_encode boş diziyi nesne yapmaz); diziye eklenen anahtar JSON'a yazılmaz
      if (!j.owners || Array.isArray(j.owners)) j.owners = {};
      (j.ignored || []).forEach(g => { const p = String(g.cidr).replace(/\/\d+$/, '').split('.').slice(0, 3).join('.');
        if (!j.owners[p] || j.owners[p][0] === '-') j.owners[p] = ['64500', 'TR', 'TEST-AS - Turk Telekomunikasyon Anonim Sirketi Uzun Bir Kurum Adi Ornegi, TR']; });
    }
    // gövde açıkça verilir: { response, json } birlikte verilince özgün gövde gidiyordu (enjeksiyon hiç işlemiyordu; ölçüldü)
    return route.fulfill({ status: r.status(), contentType: 'application/json', body: JSON.stringify(j) });
  });
  console.log('Arayüz');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 }); await ready(page);
  check('sayfa açıldı, durum yüklendi', await page.$('.ag-head') !== null);
  // Tur süresi ipucu: calistir.sh'nin olay kaydına eklediği tur (motorun durum çıktısından): kısmen inen liste "indirilemedi" der
  const tips = await page.$$eval('.ag-spark i', L => L.map(i => i.title));
  check('Tur süresi ipucu turu uzatan işleri yazar (yenilenen, inemeyen, csf -r)', tips.some(x => /izinli servis listeleri yenilendi/.test(x) &&
    /kiralık sunucu listeleri: 7\/8 yenilendi, 1 indirilemedi/.test(x) && /csf -r 1× \(4 sn\)/.test(x)), tips.slice(-2).join(' | '));
  // sekmeler, iki genişlikte
  for (const tab of ['overview', 'history', 'prov', 'settings']) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (await tik(page, `.ag-tabs [data-tab="${tab}"]`)) await page.waitForTimeout(900);
      await layoutChecks(page, tab, width);
      await shot(`${tab}-${width}`);
      if (width === 390 && tab === 'overview') {
        // başlık düğmeleri telefonda tek sırada (sağda alt alta dizilince başlık iki kat yükseliyordu)
        const tops = await page.$$eval('.ag-head-actions .ag-btn', L => L.map(b => Math.round(b.getBoundingClientRect().top)));
        check('390: başlık düğmeleri aynı satırda', tops.length >= 3 && Math.max(...tops) - Math.min(...tops) <= 2, tops.join(','));
        // IP sorgula telefonda özet kartlarının hemen altında, listelerden önce (önce iki sütun alt alta dizilince en alta düşüyordu)
        const lk = await page.evaluate(() => { const g = document.querySelector('.ag-grid:not(.ag-provtab)'); const c = document.querySelector('.ag-lkcard'); if (!g || !c) return null;
          const ust = Array.from(g.querySelectorAll('.ag-card')).filter(x => x !== c && x.offsetParent).map(x => Math.round(x.getBoundingClientRect().top));
          const k = document.querySelector('.ag-kpis'); return { lk: Math.round(c.getBoundingClientRect().top), ilk: Math.min(...ust), kpiAlt: k ? Math.round(k.getBoundingClientRect().bottom) : 0 }; });
        check('390: IP sorgula özet kartlarının altında, öteki kartlardan önce', !!lk && lk.lk < lk.ilk && lk.lk > lk.kpiAlt, JSON.stringify(lk));
        // tablet (tek sütun) de aynı; masaüstünde (iki sütun) sağ sütunun başında, listelerle aynı hizada
        const lkW = async (w) => { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(300);
          return page.evaluate(() => { const g = document.querySelector('.ag-grid:not(.ag-provtab)'); const c = document.querySelector('.ag-lkcard'); if (!g || !c) return null;
            const r = c.getBoundingClientRect(), L = Array.from(g.querySelectorAll('.ag-card')).filter(x => x !== c && x.offsetParent).map(x => x.getBoundingClientRect());
            return { lk: Math.round(r.top), x: Math.round(r.left), ilk: Math.min(...L.map(q => Math.round(q.top))), ilkX: Math.round(L[0].left), sw: document.documentElement.scrollWidth, w: innerWidth }; }); };
        const t9 = await lkW(900), t12 = await lkW(1280); await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(300);
        check('900 (tablet): IP sorgula öteki kartlardan önce, taşma yok', !!t9 && t9.lk < t9.ilk && t9.sw <= t9.w, JSON.stringify(t9));
        check('1280: IP sorgula sağ sütunun başında (listelerle aynı hiza)', !!t12 && Math.abs(t12.lk - t12.ilk) <= 2 && t12.x > t12.ilkX, JSON.stringify(t12));
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
          // uzun adres (10.255.255.254) ile tür rozeti sığmayınca rozet alta geçer: o satırda bir satır fazlası olağan (125 px)
          const tall = L.filter(x => { if (x.querySelector('.ag-ev-st')) return false;
            const tt = x.querySelector('.ag-ev-t'), a = tt && tt.firstElementChild, p = tt && tt.querySelector('.ag-pill');
            const wr = a && p && p.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 2;
            return x.getBoundingClientRect().height > (wr ? 125 : 100); }).map(x => Math.round(x.getBoundingClientRect().height));
          return { ok: !!(d && t2) && d.contains(t2) && t2.getBoundingClientRect().height > 0 && (!t || t.getBoundingClientRect().height === 0),
            menuTop: m ? Math.round(m.getBoundingClientRect().top - b.getBoundingClientRect().top) : 0, alone, tall }; });
        check('390: Geçmiş satırında zaman ayrıntıda ve tek başına kalmıyor, menü üstte, rozetsiz satır ≤ 100 px', r === null || (r.ok && r.menuTop <= 6 && r.alone === 0 && r.tall.length === 0), r ? JSON.stringify(r) : 'olay yok, atlandı');
        // aynı bilgi bir satırda iki kez yazılmaz ("Sunucu IP'si · … · beyaz liste: sunucu IP'si" gibi)
        const tek = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-ev-d')).map(d => {
          const tm = d.querySelector('.ag-ev-tm2'); const s = d.textContent.replace(tm ? tm.textContent : '', '');
          const P = s.split('·').map(x => x.trim().toLowerCase()).filter(x => x.length > 3);
          return P.some((a, i) => P.some((b, j) => i !== j && (a === b || b.endsWith(': ' + a)))) ? s.trim().slice(0, 90) : null; }).filter(Boolean));
        check('390: Geçmiş satırında aynı bilgi iki kez yok', tek.length === 0, tek.slice(0, 3).join(' | '));
        // önünde metin olan saat metne yapışmaz ("10 kez31.10 12:58"): ayırıcı (· ) görünür
        const yap = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-ev-d .ag-ev-tm2')).filter(tm => {
          if (!tm.getBoundingClientRect().width) return false;
          const d = tm.closest('.ag-ev-d'), r = document.createRange(); r.setStart(d, 0); r.setEndBefore(tm);
          const once = r.toString().trim(), c = getComputedStyle(tm, '::before').content;
          return once && !/[·]$/.test(once) && (!c || c === 'none' || c === 'normal'); }).map(tm => tm.closest('.ag-ev-d').textContent.trim().slice(0, 60)));
        check('390: Geçmiş satırında saat metne yapışık değil', yap.length === 0, yap.slice(0, 3).join(' | '));
      }
    }
  }
  // kısa telefon ekranı (tarayıcı çubukları açıkken): Terimler penceresi başlığı ve Kapat düğmesiyle görünüm içinde kalmalı
  await page.setViewportSize({ width: 390, height: 560 });
  await page.click('.ag-tabs [data-tab="overview"]'); await page.waitForTimeout(600);
  {
    if (await tik(page, '[data-act="terms"]')) {
      await page.waitForTimeout(600);
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
    if (await tik(page, '.ag-setnav [data-s="thr"]')) await page.waitForTimeout(500);
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
    if (await tik(page, '.ag-setnav [data-s="notify"]')) await page.waitForTimeout(500);
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
  let ipBanSinandi = false;
  const rows =await page.evaluate(() => Array.from(document.querySelectorAll('.ag-item[data-row] .ag-tr-r')).map(r => ({
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
    await kartKurallari(page, r.cidr);
    // kartın Kontrol edilecekler satırı Yoksay (yoksayılmamışsa) ya da Yoksaymayı kaldır sunmalı
    const cardIgn = await page.evaluate(() => !!document.querySelector('.ag-drawer [data-act="ignore"], .ag-drawer [data-act="unignore"]'));
    check(`IP kartında Sustur / kaldır var: ${r.cidr}`, cardIgn);
    // kart sayfa gövdesinde (eklentinin alanı dışında): düğme tıklanınca işlem çalışmalı (önce hiçbir şey olmuyordu)
    if (cardIgn) {
      await page.click('.ag-drawer [data-act="ignore"], .ag-drawer [data-act="unignore"]'); await page.waitForTimeout(700);
      check(`IP kartındaki Sustur / kaldır tıklanınca pencere açılır: ${r.cidr}`, await page.$('.ag-modal') !== null);
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);   // onaylamadan kapat
    }
    // tek IP banı: kartta "IP'yi banla" (ya da kendi banı varsa "Banı kaldır"); pencere aralık banının bileşeniyle, yalnız "Her şey" ve
    // "Seçilen servisler" kipleri, süre seçimi yalnız "Her şey"de; onaylamadan kapatılır (bir satırda yeter)
    if (!ipBanSinandi && await page.$('.ag-drawer [data-dr="ban1"]')) {
      ipBanSinandi = true;
      await page.click('.ag-drawer [data-dr="ban1"]'); await page.waitForSelector('.ag-modal #ag-ttl', { timeout: 8000 }).catch(() => {});
      const ib = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); if (!m) return null;
        const modes = Array.from(m.querySelectorAll('[data-mode]')).map(b => b.getAttribute('data-mode')).join(',');
        const ttlAll = m.querySelector('#ag-ttl').style.display !== 'none'; m.querySelector('[data-mode="svc"]').click();
        return { modes, ttlAll, ttlSvc: m.querySelector('#ag-ttl').style.display !== 'none', sure: m.querySelectorAll('[data-ttl]').length, cikis: !!m.querySelector('[data-svc="mout"]'),
          adlar: Array.from(m.querySelectorAll('[data-ttl]')).map(b => b.textContent.trim()) }; });
      check('tek IP banı: pencere kipleri "Her şey" ve "Seçilen servisler", süre yalnız "Her şey"de, giden servis yok', !!ib && ib.modes === 'all,svc' && ib.ttlAll && !ib.ttlSvc && ib.sure === 5 && !ib.cikis, JSON.stringify(ib));
      // süre adı "1 sa 0 dk" / "168 sa 0 dk" değil: sıfır dakika yazılmaz, tam gün gün olarak
      check('tek IP banı: süre adlarında "0 dk / 0 min" yok, tam gün gün olarak', !!ib && !ib.adlar.some(a => /\b0[\s ](dk|min)\b/.test(a)) && ib.adlar.some(a => /^7[\s ](gün|d)$/.test(a)), ib ? ib.adlar.join(' | ') : '');
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'ip-banla', w); }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    }
    await page.keyboard.press('Escape');   // üst katmanı (IP kartı) kapatır
    await page.waitForFunction(() => !document.querySelector('.ag-drawer'), null, { timeout: 5000 }).catch(function () {});
    await page.waitForTimeout(300);
    const mb = await page.$(`.ag-item[data-row="${r.cidr}"] [data-act="menu"]`);
    if (mb) {
      await mb.click(); await page.waitForTimeout(400);
      const acts = await page.evaluate(c => Array.from(document.querySelectorAll(`.ag-item[data-row="${c}"] .ag-menu [data-act]`)).map(b => b.getAttribute('data-act')), r.cidr);
      check(`menüde Sustur var: ${r.cidr}`, acts.includes('ignore'), acts.join(','));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
  }
  // Kontrol edilecekler satırları çoğunlukla aralık (aralık kartı açılır); tek IP banı IP sorgula'dan banlı olmayan bir IP'de sınanır
  if (!ipBanSinandi && await page.$('#ag-lk-ip')) {
    await page.fill('#ag-lk-ip', '198.51.100.77'); await page.press('#ag-lk-ip', 'Enter');
    await page.waitForFunction(() => { const d = document.querySelector('.ag-drawer'); return d && d.innerText.length > 40 && !d.querySelector('.ag-spin'); }, null, { timeout: 20000 }).catch(() => {});
    const var1 = !!(await page.$('.ag-drawer [data-dr="ban1"]'));
    check('tek IP banı: banlı olmayan IP\'nin kartında "IP\'yi banla" var', var1);
    // IP kartının düzeni: Bu IP · Üst seviyeler (tablo: blok, ağ… her seviyenin aralığı tıklanır, ban düğmesi kendi satırında) · Kim;
    // eski "Bloğun durumu" paragrafı ve kapsayan banların karışık listesi yok
    const kd = await page.evaluate(() => { const d = document.querySelector('.ag-drawer'); if (!d) return null;
      const sec = Array.from(d.querySelectorAll('.ag-dr-sec')).map(x => x.textContent.trim());
      const rows = Array.from(d.querySelectorAll('.ag-lv-t tbody tr')).map(tr => ({ l: tr.cells[0].textContent.trim(), c: !!tr.cells[1].querySelector('[data-ip]'), b: Array.from(tr.querySelectorAll('[data-dr]')).map(b => b.getAttribute('data-dr')).join(',') }));
      return { sec, rows, eski: /Bloğun durumu|Bu IP'yi kapsayan banlar/.test(d.innerText), th: d.querySelectorAll('.ag-lv-t thead th').length }; });
    const r24 = kd && kd.rows.filter(r => r.l === 'Blok')[0], r16 = kd && kd.rows.filter(r => r.l === 'Ağ')[0];
    check('IP kartı düzeni: Bu IP · Üst seviyeler · Kim; tabloda Blok ve Ağ satırı, aralık tıklanır, Bloğu / Ağı banla kendi satırında; eski bölümler yok',
      !!kd && kd.sec[0] === 'Bu IP' && kd.sec.indexOf('Üst seviyeler') > 0 && kd.sec.indexOf('Kim') > kd.sec.indexOf('Üst seviyeler') && kd.th === 3 &&
      !!r24 && r24.c && r24.b === 'ban24' && !!r16 && r16.c && r16.b === 'ban16' && !kd.eski, JSON.stringify(kd));
    // telefonlar 320–390 arası (büyük yazı boyutu da dar genişlik gibi davranır): kart her birinde yatay kaymamalı
    for (const w of [1280, 390, 360, 320]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'ip-karti', w); }
    await page.setViewportSize({ width: 1280, height: 900 });
    if (var1) {
      await page.click('.ag-drawer [data-dr="ban1"]'); await page.waitForSelector('.ag-modal #ag-ttl', { timeout: 8000 }).catch(() => {});
      const ib = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); if (!m) return null;
        const modes = Array.from(m.querySelectorAll('[data-mode]')).map(b => b.getAttribute('data-mode')).join(',');
        const ttlAll = m.querySelector('#ag-ttl').style.display !== 'none'; m.querySelector('[data-mode="svc"]').click();
        return { modes, ttlAll, ttlSvc: m.querySelector('#ag-ttl').style.display !== 'none', sure: m.querySelectorAll('[data-ttl]').length, cikis: !!m.querySelector('[data-svc="mout"]'),
          adlar: Array.from(m.querySelectorAll('[data-ttl]')).map(b => b.textContent.trim()) }; });
      check('tek IP banı: pencere kipleri "Her şey" ve "Seçilen servisler", süre yalnız "Her şey"de, giden servis yok', !!ib && ib.modes === 'all,svc' && ib.ttlAll && !ib.ttlSvc && ib.sure === 5 && !ib.cikis, JSON.stringify(ib));
      check('tek IP banı: süre adlarında "0 dk / 0 min" yok, tam gün gün olarak', !!ib && !ib.adlar.some(a => /\b0[\s ](dk|min)\b/.test(a)) && ib.adlar.some(a => /^7[\s ](gün|d)$/.test(a)), ib ? ib.adlar.join(' | ') : '');
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'ip-banla', w); }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    }
    // İzin ver (gerçek CSF'te uçtan uca): kartta "İzin ver…" → pencere (5 süre, ilki süresiz; not; geçersiz notta onay kapalı) → 1 sa +
    // not → kart yeniden açılır, "İzni kaldır" ve kalan süre → kaldır → yeniden "İzin ver…"
    const alw = await page.$('.ag-drawer [data-dr="allow1"]');
    check('izin: banlı / izinli olmayan IP\'nin kartında "İzin ver…" var', !!alw);
    if (alw) {
      await alw.click(); await page.waitForSelector('.ag-modal #ag-al-note', { timeout: 8000 }).catch(() => {});
      const am = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); if (!m) return null;
        const n = m.querySelector('#ag-al-note'), ok = m.querySelector('[data-m="ok"]');
        n.value = 'a#b'; n.dispatchEvent(new Event('input', { bubbles: true })); const bad = ok.disabled;
        n.value = 'ofis'; n.dispatchEvent(new Event('input', { bubbles: true }));
        return { sure: Array.from(m.querySelectorAll('[data-ttl]')).map(b => b.textContent.trim()), bad, ok: !ok.disabled, d: (m.querySelector('#ag-ttl-d') || {}).textContent || '' }; });
      check('izin penceresi: 5 süre (ilki süresiz), açıklama, geçersiz notta onay kapalı, geçerlide açık', !!am && am.sure.length === 5 && /^(Süresiz|No end)$/.test(am.sure[0]) && am.bad && am.ok && am.d.length > 20, JSON.stringify(am));
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'ip-izin', w); }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.click('.ag-modal [data-ttl="3600"]'); await page.click('.ag-modal [data-m="ok"]');
      await page.waitForSelector('.ag-drawer [data-dr="unallow1"]', { timeout: 60000 }).catch(() => {});
      const ak = await page.evaluate(() => { const d = document.querySelector('.ag-drawer'); return d ? { un: !!d.querySelector('[data-dr="unallow1"]'), txt: d.innerText } : null; });
      check('izin: onaydan sonra kart "İzni kaldır" ve geçici iznin kalan süresini gösterir', !!ak && ak.un && /csf\.tempallow/.test(ak.txt) && /(kaldı|left)/.test(ak.txt), ak ? ak.txt.slice(0, 400) : '');
      if (ak && ak.un) {
        await page.click('.ag-drawer [data-dr="unallow1"]'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
        await page.click('.ag-modal [data-m="ok"]');
        await page.waitForSelector('.ag-drawer [data-dr="allow1"]', { timeout: 60000 }).catch(() => {});
        check('izin: İzni kaldır sonrası kart yeniden "İzin ver…" gösterir', !!(await page.$('.ag-drawer [data-dr="allow1"]')));
      }
    }
    // Süreli aralık banı (gerçek CSF): Bloğu banla penceresinde süre yalnız "Her şey"de; süre seçilince açıklama, kapsananlar kaldırılmaz;
    // 1 sa ile onay → kartın Blok satırı kalan süreyi gösterir → Aktif aralık banları satırı "elle · süre", ⋯ → Banı kaldır (yazarak)
    const b24 = await page.$('.ag-drawer [data-dr="ban24"]');
    if (b24) {
      await b24.click(); await page.waitForSelector('.ag-modal #ag-ttl', { timeout: 30000 }).catch(() => {});
      const rb = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); const tt = m && m.querySelector('#ag-ttl'); if (!tt) return null;
        const vis = () => tt.style.display !== 'none', r = { all: vis(), n: m.querySelectorAll('#ag-ttl [data-ttl]').length };
        m.querySelector('[data-mode="svc"]').click(); r.svc = vis(); m.querySelector('[data-mode="exc"]').click(); r.exc = vis();
        m.querySelector('[data-mode="all"]').click(); m.querySelector('#ag-ttl [data-ttl="3600"]').click();
        const cb = m.querySelector('#ag-clean'); r.cb = cb ? cb.disabled : null; r.d = (m.querySelector('#ag-ttl-d') || {}).textContent || ''; return r; });
      check('aralık banı: süre yalnız "Her şey"de (5 seçenek); süre seçilince açıklama, kapsananlar kaldırılmaz', !!rb && rb.all && !rb.svc && !rb.exc && rb.n === 5 && rb.d.length > 20 && rb.cb !== false, JSON.stringify(rb));
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'aralik-sureli', w); }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.click('.ag-modal [data-m="ok"]');
      await page.waitForFunction(() => /(kaldı|left)/.test(((document.querySelector('.ag-drawer .ag-lv-t') || {}).innerText) || ''), null, { timeout: 60000 }).catch(() => {});
      const lvTxt = await page.evaluate(() => { const d = document.querySelector('.ag-drawer .ag-lv-t'); return d ? d.innerText : ''; });
      check('aralık banı: süreli /24 banından sonra kartın Blok satırı kalan süreyi gösterir', /(Blok|Block)[^\n]*\n?[^\n]*(kaldı|left)/.test(lvTxt), lvTxt.slice(0, 300));
      await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.ag-drawer'), null, { timeout: 5000 }).catch(() => {});
      const gr = '198.51.100.0/24', gm = await page.$(`.ag-item[data-row="${gr}"] [data-act="menu"]`);
      const pill = await page.evaluate(c => { const r = document.querySelector(`.ag-item[data-row="${c}"] .ag-td-state`); return r ? r.textContent.trim() : ''; }, gr);
      check('aralık banı: Aktif aralık banları satırı "elle · kalan süre", menüde Banı değiştir yok', /^(elle|manual) · \d/.test(pill), pill);
      if (gm) {
        await gm.click(); await page.waitForTimeout(400);
        const acts = await page.evaluate(c => Array.from(document.querySelectorAll(`.ag-item[data-row="${c}"] .ag-menu [data-act]`)).map(b => b.getAttribute('data-act')), gr);
        check('aralık banı: süreli elle banın menüsünde Banı değiştir yok, Banı kaldır var', !acts.includes('chg') && acts.includes('unban'), acts.join(','));
        await page.click(`.ag-item[data-row="${gr}"] .ag-menu [data-act="unban"]`); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
        const ty = await page.$('.ag-modal #ag-typed'); if (ty) await ty.fill(gr);
        await page.click('.ag-modal [data-m="ok"]');
        await page.waitForFunction(c => !document.querySelector(`.ag-item[data-row="${c}"]`), gr, { timeout: 60000 }).catch(() => {});
        check('aralık banı: süreli ban kaldırıldı', !(await page.$(`.ag-item[data-row="${gr}"]`)));
      }
    }
    if (await page.$('.ag-drawer')) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
  }
  // Yoksay akışı: ilk satır yoksayılır, Yoksayılanlar'da görünür, geri alınır
  if (rows.length) {
    const c = rows[0].cidr;
    await page.click(`.ag-item[data-row="${c}"] [data-act="menu"]`); await page.waitForTimeout(400);
    await page.click(`.ag-item[data-row="${c}"] .ag-menu [data-act="ignore"]`); await page.waitForTimeout(600);
    check('Sustur penceresi açıldı', await page.$('.ag-modal [data-m="ok"]') !== null);
    await page.click('.ag-modal [data-m="ok"]');
    await page.waitForFunction(c => !document.querySelector(`.ag-item[data-row="${c}"] .ag-tr-r`) && document.querySelector(`[data-act="menu"][data-key="im:${c}"]`), c, { timeout: 30000 }).catch(function () {});
    const gone = await page.$(`.ag-item[data-row="${c}"] .ag-tr-r`) === null;
    const listed = await page.$(`[data-act="menu"][data-key="im:${c}"]`) !== null;
    check(`Sustur: ${c} listeden düştü ve Susturulanlar'da`, gone && listed, `düştü=${gone} listede=${listed}`);
    // Yoksayılanlar satırının ⋯ menüsü: Süreyi değiştir ve Yoksaymayı kaldır, görünür (kartın / görünümün dışına taşmadan)
    const untilOf = () => page.evaluate(c => { const r = document.querySelector(`.ag-item[data-row="${c}"] .ag-td-until`); return r ? r.textContent : ''; }, c);
    const openIm = async () => { await page.click(`[data-act="menu"][data-key="im:${c}"]`); await page.waitForTimeout(400); };
    if (listed) {
      // satırın bitişi, ⋯ düğmesi ve sahibi kartın içinde (sahip uzun adla; 1.15.59'da kartın dışına itiliyordu)
      for (const w of [1280, 390]) {
        await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(300);
        const ic = await page.evaluate(async c => { const it = document.querySelector(`.ag-item[data-row="${c}"]`); if (!it) return 'satır yok';
          const card = it.closest('.ag-card').getBoundingClientRect(), bad = [];
          [['bitiş', '.ag-td-until'], ['⋯', '[data-act="menu"]'], ['sahip', '.ag-own-s']].forEach(([n, s]) => { const e = it.querySelector(s); if (!e) { bad.push(n + ' yok'); return; }
            const r = e.getBoundingClientRect(); if (r.width < 1 || r.right > card.right + 1 || r.left < card.left - 1) bad.push(`${n} ${Math.round(r.left)}–${Math.round(r.right)} (kart ${Math.round(card.left)}–${Math.round(card.right)})`); });
          return bad.length ? bad.join(', ') : 'ok'; }, c);
        check(`Susturulanlar satırı kartın içinde (bitiş, ⋯, sahip) · ${w} px`, ic === 'ok', ic);
      }
      await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300);
      await openIm();
      const vis = await page.evaluate(() => { const b = document.querySelector('.ag-menu [data-act="unignore"]'); if (!b) return 'yok';
        const r = b.getBoundingClientRect(); return r.width > 0 && r.right <= window.innerWidth + 1 && r.left >= -1 ? 'ok' : `menü ${Math.round(r.left)}–${Math.round(r.right)}`; });
      const acts = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-menu [data-act]')).map(b => b.getAttribute('data-act')));
      check('Susturulanlar menüsü: Süreyi değiştir + Susturmayı bitir, görünür', vis === 'ok' && acts.includes('ignore') && acts.includes('unignore'), vis + ' ' + acts.join(','));
      // Süreyi değiştir: 30 gün → 7 gün; bitiş tarihi değişmeli
      const before7 = await untilOf();
      await page.click(`.ag-menu [data-act="ignore"][data-c="${c}"]`); await page.waitForTimeout(600);
      await tik(page, '.ag-modal #ag-days [data-d="7"]');
      await page.click('.ag-modal [data-m="ok"]');
      await page.waitForFunction(([c, b]) => { const r = document.querySelector(`.ag-item[data-row="${c}"] .ag-td-until`); return r && r.textContent !== b; }, [c, before7], { timeout: 30000 }).catch(function () {});
      const after7 = await untilOf();
      check(`Süreyi değiştir: ${c} bitişi değişti`, after7 && after7 !== before7, `${before7} → ${after7}`);
      await openIm();
      await page.click(`.ag-menu [data-act="unignore"][data-c="${c}"]`); await page.waitForTimeout(600);
      await tik(page, '.ag-modal [data-m="ok"]');
      await page.waitForFunction(c => document.querySelector(`.ag-item[data-row="${c}"] .ag-tr-r`), c, { timeout: 30000 }).catch(function () {});
      check(`Susturmayı bitir: ${c} geri geldi`, await page.$(`.ag-item[data-row="${c}"] .ag-tr-r`) !== null);
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
      await tik(page, '.ag-modal [data-m="ok"]');
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
  // sekmeye eski veriyle dönüş: yeni durum gelene kadar salt okuyan eylem (menü) çalışır, durum değiştiren (Sustur) bildirimle bekler.
  // Önce bütün eylemler kapanıyordu; durum isteği sunucuda 5-7 sn sürünce kullanıcı sayfayı donmuş sanıyordu
  await page.click('.ag-tabs [data-tab="overview"]'); await page.waitForTimeout(600);
  const back = await page.evaluate(async () => {
    const od = Date.now; Date.now = () => od() + 120000;               // eldeki veri 2 dakika eski görünsün
    // yeni durum isteği sürerken sınanır: yerel sunucu 30 ms içinde cevaplarsa veri tazelenip denetim yanlış düşüyordu
    const of = window.fetch; window.fetch = (u, o) => o && /^a=status(&|$)/.test(String(o.body || '')) ? new Promise(r => setTimeout(() => r(of(u, o)), 3000)) : of(u, o);
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 30));
    const upd = !!document.querySelector('.ag-back-t');                // "güncelleniyor" (istek sürüyor)
    const mb = document.querySelector('.ag-item [data-act="menu"]'); if (mb) mb.click();
    await new Promise(r => setTimeout(r, 30));
    const menu = !!document.querySelector('.ag-menu');
    const mut = document.querySelector('.ag-menu [data-act="ignore"], .ag-menu [data-act="unban"], .ag-menu [data-act="forget"]');
    const n0 = document.querySelectorAll('.ag-toast').length; if (mut) mut.click();
    await new Promise(r => setTimeout(r, 30));
    const toast = document.querySelectorAll('.ag-toast').length > n0, modal = !!document.querySelector('.ag-modal');
    Date.now = od; window.fetch = of;
    return { upd, menu, mut: !!mut, toast, modal };
  });
  check('eski veriyle dönüş: menü hemen açılır, durum değiştiren eylem bildirimle bekler (pencere açılmaz)', back.upd && back.menu && back.mut && back.toast && !back.modal, JSON.stringify(back));
  // Sağlayıcılar: kiralık liste ve izinli servis kutuları tek tip — hazır gelenler de kendi eklenenler de aynı kutu, ekle / sil,
  // kutuya kaynak (taslakta; sonunda vazgeçilir, kaydedilmez)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('.ag-tabs [data-tab="prov"]');
  await page.waitForSelector('#ag-cloud-card', { timeout: 30000 }).catch(() => {});   // sekme ayarları yeniden yükler (sabit bekleme yetmiyordu)
  {
    const ac = async (k) => { await tik(page, `[data-act="cfgchip"][data-k="${k}"][data-v="1"]`); await page.waitForTimeout(400); };
    await ac('CLOUD_BAN'); await ac('SVC_ALLOW');
    const G = '#ag-cloud-card .ag-tiles', SG = '#ag-svc-card .ag-tiles';
    const hazir = await page.evaluate(() => ({ add: document.querySelectorAll('#ag-cloud-card .ag-tile-add').length, sadd: document.querySelectorAll('#ag-svc-card .ag-tile-add').length,
      modal: (document.querySelector('.ag-modal') || {}).innerText || '', kart: ((document.querySelector('#ag-cloud-card') || {}).innerText || '').slice(0, 160),
      sekme: Array.from(document.querySelectorAll('.ag-tabs [data-tab]')).filter(b => b.classList.contains('on') || b.getAttribute('aria-selected') === 'true').map(b => b.getAttribute('data-tab')).join(','),
      kartlar: Array.from(document.querySelectorAll('#ag-app section[id]')).map(x => x.id).join(','), sayfa: document.querySelector('#ag-app').innerText.slice(0, 200) }));
    check('Sağlayıcılar: katmanlar açılınca kutular ve "Ekle" düğmeleri çizilir', hazir.add === 1 && hazir.sadd === 1 && !hazir.modal, JSON.stringify(hazir));
    if (hazir.modal) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    // kaynak ayrıntısı: kutudaki satır açar; özet, IP bölümü ve "son 24 saat" (ölçüm aynı anahtarla) — sağlayıcı satırıyla aynı bileşen
    await tik(page, '#ag-cloud-card [data-act="srcinfo"][data-v="cl:gcp"]');
    await page.waitForSelector('#ag-srcd', { timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => { const d = document.querySelector('#ag-srcd'); return d && !d.querySelector('.ag-spin'); }, null, { timeout: 30000 }).catch(() => {});
    const sd = await page.evaluate(() => { const d = document.querySelector('#ag-srcd'); if (!d) return null;
      return { b: (d.querySelector('.ag-srcd-h b') || {}).textContent, w: !!d.querySelector('.ag-srcd-w h4'), m: (d.querySelector('[data-act="asnimpact"]') || {}).getAttribute ? d.querySelector('[data-act="asnimpact"]').getAttribute('data-v') : null, ham: /\bx-[a-z]|\bcl:/.test(d.innerText) }; });
    check('kaynak ayrıntısı: kiralık liste kutusundan açılır, başlık, son 24 saat bölümü, ölçüm kutunun anahtarıyla, ham ad yok', !!sd && /Google Cloud/.test(sd.b || '') && sd.w && sd.m === 'cl:gcp' && !sd.ham, JSON.stringify(sd));
    for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(300); await layoutChecks(page, 'kaynak-ayrinti', w); }
    await page.setViewportSize({ width: 1280, height: 900 });
    await tik(page, '#ag-srcd [data-act="srcinfo"]'); await page.waitForTimeout(300);
    check('kaynak ayrıntısı: Kapat ile kapanır', !(await page.$('#ag-srcd')));
    // liste başına kip: kutudaki "Ne kapatılsın" aralık banıyla aynı bileşeni açar (kipler, servis çipleri, özet); giden servisler yok
    // (kural yalnız gelen yeni bağlantıya). "Her şey, şunlar hariç" + Web → taslakta gcp=exc:web:, kutu yazısı yeni kurala göre
    await tik(page, '#ag-cloud-card [data-act="clmode"][data-v="cl:gcp"]');
    await page.waitForSelector('.ag-modal #ag-svcbox', { timeout: 10000 }).catch(() => {});
    await page.click('.ag-modal [data-mode="exc"]').catch(() => {}); await page.waitForTimeout(200);
    const cm0 = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); if (!m) return null;
      return { out: !!m.querySelector('[data-svc="mout"],[data-svc="wout"]'), web: !!m.querySelector('[data-svc="web"]'), sum: (m.querySelector('#ag-sum') || {}).innerText || '',
        ok: (m.querySelector('[data-m="ok"]') || {}).disabled, md: (m.querySelector('#ag-md') || {}).innerText || '' }; });
    check('liste kipi: pencere ortak bileşenle (servis çipleri, özet), giden servis yok, seçimsiz "hariç" uygulanamaz', !!cm0 && cm0.web && !cm0.out && /listeden/.test(cm0.md) && cm0.ok === true, JSON.stringify(cm0));
    for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(300); await layoutChecks(page, 'liste-kipi', w); }
    await page.setViewportSize({ width: 1280, height: 900 });
    // ek portta /udp: özet "UDP 443" yazar (panelin geri kalanıyla aynı; bir kez "port 443, 443/udp" yazıyordu)
    await page.fill('.ag-modal #ag-xports', '8443, 443/udp').catch(() => {}); await page.waitForTimeout(200);
    const cmU = await page.evaluate(() => (document.querySelector('.ag-modal #ag-sum') || {}).innerText || '');
    check('liste kipi: ek portta /udp özetde "port 8443, UDP 443" diye yazılır', /port 8443, UDP 443/.test(cmU) && !/443\/udp/.test(cmU), cmU);
    await page.fill('.ag-modal #ag-xports', '').catch(() => {}); await page.waitForTimeout(150);
    await page.click('.ag-modal [data-svc="web"]').catch(() => {}); await page.waitForTimeout(150);
    await page.click('.ag-modal [data-m="ok"]').catch(() => {}); await page.waitForTimeout(400);
    const cm1 = await page.evaluate(() => { const t = Array.from(document.querySelectorAll('#ag-cloud-card .ag-tile')).find(x => x.querySelector('[data-act="clmode"][data-v="cl:gcp"]'));
      return { em: t ? (t.querySelector('em.cm span') || {}).textContent : null, modal: !!document.querySelector('.ag-modal') }; });
    check('liste kipi: Uygula taslağa yazar, kutu yeni kuralı söyler ("Her şey kapalı, açık: Web"), kaydet çubuğu çıkar', !!cm1.em && /Her şey kapalı, açık: Web/.test(cm1.em) && !cm1.modal && !!(await page.$('.ag-savebar')), JSON.stringify(cm1));    const names = async (g) => page.$$eval(`${g} .ag-tile-m b`, L => L.map(b => b.textContent.trim()));
    const chips = async (g, nm) => page.$$eval(`${g} .ag-tile`, (L, nm) => { const x = L.find(e => (e.querySelector('.ag-tile-m b') || {}).textContent === nm);
      return x ? Array.from(x.querySelectorAll('.ag-tile-subs .ag-chip')).map(c => c.firstChild.textContent.trim()) : null; }, nm);
    // yeni kutu: başlık + kaynak satırları; kutunun içinden: kaynak başlığı + adres
    const addForm = async (n, u, rows) => { await page.waitForSelector('.ag-modal [data-row]', { timeout: 10000 });
      if (await page.$('.ag-modal #ag-an')) await page.fill('#ag-an', n); else await page.fill('.ag-modal [data-row="0"] [data-f="t"]', n);
      if (rows) for (let i = 0; i < rows.length; i++) { if (i) await page.click('#ag-addrow'); await page.fill(`.ag-modal [data-row="${i}"] [data-f="t"]`, rows[i][0]); await page.fill(`.ag-modal [data-row="${i}"] [data-f="u"]`, rows[i][1]);
        if (rows[i][2]) await page.fill(`.ag-modal [data-row="${i}"] [data-f="f"]`, rows[i][2]); }
      else await page.fill('.ag-modal [data-row="0"] [data-f="u"]', u);
      // düğme alanlar dolunca açılır: açılmasını bekle (bir koşuda kapalıyken basılıp 30 sn'de zaman aşımına düştü)
      const on = await page.waitForSelector('.ag-modal [data-m="ok"]:not([disabled])', { timeout: 10000 }).then(() => true, () => false);
      if (!on) {                     // açılmadı: sebebi (pencere sayısı, hata satırı, alanlar) sonuçta görünsün, 30 sn tıklama beklenmesin
        const why = await page.evaluate(() => ({ modals: document.querySelectorAll('.ag-modal').length,
          title: Array.from(document.querySelectorAll('.ag-modal h3, .ag-modal .ag-modal-t')).map(e => e.textContent.trim()),
          err: (document.querySelector('.ag-modal #ag-aerr') || {}).textContent || '',
          rows: Array.from(document.querySelectorAll('.ag-modal [data-row]')).map(r => Array.from(r.querySelectorAll('input')).map(i => i.value).join('|')) }));
        check(`ekleme penceresi (${n}): Ekle düğmesi alanlar dolunca açılır`, false, JSON.stringify(why));
        await page.keyboard.press('Escape'); await page.waitForTimeout(300); return;
      }
      await page.click('.ag-modal [data-m="ok"]'); await page.waitForTimeout(400); };
    // yeni kutu
    await tik(page, `${G} .ag-tile-add`); await addForm('deneme', 'https://ornek.com/liste.txt');
    const n1 = await names(G);
    check('kiralık liste: "Liste ekle" ile yeni kutu öteki kutular gibi görünür', n1.includes('deneme'), n1.join(','));
    // kutuya kaynak: düzenleyicideki "Kaynak ekle"
    await tik(page, `${G} .ag-tile:has(.ag-tile-m b:text-is("deneme")) .ag-tile-ed`); await page.waitForTimeout(300);
    await tik(page, '[data-act="srcadd"][data-v="cl|deneme"]'); await addForm('', '', [['ikinci', 'https://ornek.com/iki.json', 'service=EC2&region=eu-north-1']]);
    const c2 = await chips(G, 'deneme');
    // süzgeç kaynağın satırında görünür (düzenleyici açık kalır)
    const f2 = await page.$eval('.ag-urled-r[data-src="cl|x|deneme--ikinci"] [data-f="f"]', e => e.value).catch(() => null);
    check('kiralık liste: kaynağa yazılan süzgeç düzenleyicide görünür', f2 === 'service=EC2&region=eu-north-1', JSON.stringify(f2));
    check('kiralık liste: kutuya ikinci kaynak eklenince kaynaklar çip olarak görünür', !!c2 && c2.length === 2 && c2.includes('ikinci'), JSON.stringify(c2));
    await tik(page, `${G} .ag-tile:has(.ag-tile-m b:text-is("deneme")) .ag-chip-x[data-v="cl|x:deneme--ikinci"]`); await page.waitForTimeout(300);
    const c3 = await chips(G, 'deneme');
    check('kiralık liste: kaynak × ile kalkar', !!c3 && c3.length === 0, JSON.stringify(c3));
    // hazır kutu silinir, "Liste ekle" penceresinden geri gelir
    const gcp = await page.evaluate(() => (Array.from(document.querySelectorAll('#ag-cloud-card .ag-tile-m b')).map(b => b.textContent.trim()).find(t => /Google/.test(t))) || '');
    if (gcp) {
      await tik(page, `${G} .ag-tile:has(.ag-tile-m b:text-is("${gcp}")) .ag-tile-rm`); await page.waitForTimeout(300);
      const gone = !(await names(G)).includes(gcp);
      await tik(page, `${G} .ag-tile-add`); await page.waitForSelector('.ag-modal [data-ri]', { timeout: 10000 }).catch(() => {});
      const back = await page.$$eval('.ag-modal [data-ri]', L => L.map(b => b.textContent.trim()));
      const bi = back.findIndex(t => t.indexOf(gcp) === 0);
      if (bi >= 0) { await page.click(`.ag-modal [data-ri="${bi}"]`); await page.click('.ag-modal [data-m="ok"]'); await page.waitForTimeout(400); }
      else await page.keyboard.press('Escape');
      check('kiralık liste: hazır kutu silinir ve "Liste ekle"den geri gelir', gone && bi >= 0 && (await names(G)).includes(gcp), JSON.stringify({ gone, back }));
    } else check('kiralık liste: hazır kutu silinir ve "Liste ekle"den geri gelir', false, 'Google Cloud kutusu yok');
    // hazır AWS kutusunun süzgeci (service=EC2) düzenleyicide görünür: kullanıcı örnek alıp kendi kutusunda kurabilir
    await tik(page, `${G} .ag-tile-add`); await page.waitForSelector('.ag-modal [data-ri]', { timeout: 10000 }).catch(() => {});
    const ai = (await page.$$eval('.ag-modal [data-ri]', L => L.map(b => b.textContent.trim()))).findIndex(t => /^AWS/.test(t));
    if (ai >= 0) { await page.click(`.ag-modal [data-ri="${ai}"]`); await page.click('.ag-modal [data-m="ok"]'); await page.waitForTimeout(400); } else await page.keyboard.press('Escape');
    const awsT = (await names(G)).find(t => /^AWS/.test(t)) || '';
    if (awsT) { await tik(page, `${G} .ag-tile:has(.ag-tile-m b:text-is("${awsT}")) .ag-tile-ed`); await page.waitForTimeout(300); }
    const af = await page.$eval('.ag-urled-r[data-src="cl|b|aws"] [data-f="f"]', e => e.value).catch(() => null);
    check('kiralık liste: hazır AWS kutusunun süzgeci düzenleyicide görünür', af === 'service=EC2', JSON.stringify({ awsT, af }));
    if (awsT) { await tik(page, `${G} .ag-tile:has(.ag-tile-m b:text-is("${awsT}")) .ag-tile-rm`); await page.waitForTimeout(300); }
    // izinli servisler: hazır kutuya kendi kaynağınız, hazır alt kaynak silinir ve geri gelir
    const goo = (await names(SG)).find(t => /Google/.test(t)) || '';
    if (goo) {
      await tik(page, `${SG} .ag-tile:has(.ag-tile-m b:text-is("${goo}")) .ag-tile-ed`); await page.waitForTimeout(300);
      await tik(page, '[data-act="srcadd"][data-v="svc|google"]'); await addForm('ek', '203.0.113.10');
      const s1 = await chips(SG, goo);
      check('izinli servis: hazır kutuya kendi kaynağınız çip olarak eklenir', !!s1 && s1.includes('ek'), JSON.stringify(s1));
      const sub = s1 && s1.find(x => x !== 'ek');
      await tik(page, `${SG} .ag-tile:has(.ag-tile-m b:text-is("${goo}")) .ag-chip-x[data-v^="svc|b:"]`); await page.waitForTimeout(300);
      const s2 = await chips(SG, goo);
      await tik(page, `${SG} .ag-tile-add`); await page.waitForSelector('.ag-modal [data-ri]', { timeout: 10000 }).catch(() => {});
      const back = await page.$$eval('.ag-modal [data-ri]', L => L.map(b => b.textContent.trim()));
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      check('izinli servis: hazır alt kaynak × ile kalkar, "Servis ekle"de geri getirilecekler arasında', !!s2 && s2.length === s1.length - 1 && back.some(t => t.indexOf(sub || '?') >= 0), JSON.stringify({ s1, s2, back }));
    } else check('izinli servis: hazır kutuya kendi kaynağınız çip olarak eklenir', false, 'Google kutusu yok');
    // sıfırdan Google / OpenAI gibi kutu: serbest başlık (Türkçe, boşluklu), açıklama, başlıklı kaynaklar
    await tik(page, `${SG} .ag-tile-add`); await page.waitForSelector('.ag-modal #ag-an', { timeout: 10000 });
    await page.fill('#ag-ad', 'Yapay zekâ tarayıcıları');
    await addForm('Yapay Zekâ Botları', '', [['Arama botu', 'https://ornek.com/arama.json'], ['Kullanıcı istekleri', 'https://ornek.com/kullanici.json']]);
    const yz = await chips(SG, 'Yapay Zekâ Botları');
    const yzd = await page.evaluate(() => { const x = Array.from(document.querySelectorAll('#ag-svc-card .ag-tile')).find(e => (e.querySelector('.ag-tile-m b') || {}).textContent === 'Yapay Zekâ Botları'); return x ? x.querySelector('.ag-tile-m small').textContent : null; });
    check('izinli servis: sıfırdan kutu serbest başlık, açıklama ve başlıklı kaynaklarla kurulur (OpenAI gibi)', !!yz && yz.join('|') === 'Arama botu|Kullanıcı istekleri' && yzd === 'Yapay zekâ tarayıcıları', JSON.stringify({ yz, yzd }));
    // ham liste adı ekranda görünmez (x-…, extra-…, kutu--kaynak)
    const ham = await page.evaluate(() => (document.querySelector('#ag-app').innerText.match(/\b(x-[a-z0-9-]+|extra-[A-Za-z0-9._-]+|[a-z0-9]+--[a-z0-9-]+)\b/g) || []).slice(0, 5));
    check('kutular: ekranda ham liste adı yok', ham.length === 0, ham.join(', '));
    // sağlayıcı banının ortak port listesi: servis adlarıyla özet ve CSF'e yazılan değer; "Değiştir" servis çipli pencere (hariç kipi
    // yok); SSH seçilince CSF değeri TCP 22,80,443 olur, Uygula taslağa yazar
    await ac('ASN_BAN'); await page.waitForSelector('#ag-asn-add', { timeout: 10000 }).catch(() => {});
    await page.fill('#ag-asn-add', 'AS64500').catch(() => {}); await tik(page, '[data-act="asnaddin"]'); await page.waitForTimeout(600);
    const ap0 = await page.evaluate(() => { const b = document.querySelector('#ag-prov-card [data-act="asnports"]'); const s = b ? b.closest('.ag-sec') : null; return s ? s.innerText : null; });
    check('sağlayıcı port listesi: servis adıyla özet ve CSF\'e yazılan değer', !!ap0 && /Kapalı: Web/.test(ap0) && /TCP 80,443 · UDP 443/.test(ap0), JSON.stringify(ap0));
    await tik(page, '#ag-prov-card [data-act="asnports"]'); await page.waitForSelector('.ag-modal #ag-svcbox [data-svc="ssh"]', { timeout: 10000 }).catch(() => {});
    const ap1 = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); if (!m) return null;
      return { web: !!m.querySelector('[data-svc="web"].on'), modes: m.querySelectorAll('[data-mode]').length, out: !!m.querySelector('[data-svc="mout"],[data-svc="wout"]') }; });
    check('sağlayıcı port listesi: pencere servis çipleriyle, Web seçili, kip ve giden servis yok', !!ap1 && ap1.web && ap1.modes === 0 && !ap1.out, JSON.stringify(ap1));
    await page.click('.ag-modal [data-svc="ssh"]').catch(() => {}); await page.waitForTimeout(200);
    const ap2 = await page.evaluate(() => (document.querySelector('.ag-modal #ag-hints') || {}).innerText || '');
    check('sağlayıcı port listesi: SSH seçilince CSF değeri TCP 22,80,443 · UDP 443', /TCP 22,80,443 · UDP 443/.test(ap2), ap2);
    for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(300); await layoutChecks(page, 'port-listesi', w); }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click('.ag-modal [data-m="ok"]').catch(() => {}); await page.waitForTimeout(400);
    const ap3 = await page.evaluate(() => { const b = document.querySelector('#ag-prov-card [data-act="asnports"]'); const s = b ? b.closest('.ag-sec') : null; return s ? s.innerText : null; });
    check('sağlayıcı port listesi: Uygula taslağa yazar, özet "Kapalı: Web, SSH", kaydet çubuğu çıkar', !!ap3 && /Kapalı: Web, SSH/.test(ap3) && /TCP 22,80,443/.test(ap3) && !!(await page.$('.ag-savebar')), JSON.stringify(ap3));
    for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(400); await layoutChecks(page, 'prov-kutular', w); await shot(`prov-kutular-${w}`); }
    await page.setViewportSize({ width: 1280, height: 900 });
    await tik(page, '[data-act="cfgdiscard"]'); await page.waitForTimeout(400);
  }
  await page.waitForTimeout(3000); await page.keyboard.press('Escape');
  check('JS hatası yok', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`Arayüz: ${N} denetim, ${F} beklenmeyen`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.log('  ✗ HATA: ' + e.message + (errs.length ? ' · sayfa hataları: ' + errs.slice(0, 3).join(' | ') : '')); process.exit(1); });
