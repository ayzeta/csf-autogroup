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
  // metinde geçen her IP / aralık ve ASnnn kartını açmalı: tek başına yazan öğe de, cümle ya da rozet içindeki de (addrHtml).
  // Hariç: kartın / pencerenin başlığı ve kartın kendi adresi (.ag-addr-self), giriş kutuları, CSF satırı / komut çıktısı, örnek adres ("ör." / "e.g.").
  // 1.15.131 canlı: Geçmiş rozeti "X banının içinde", IP kartı seviye satırı, aralık kartı "Sağlayıcı banı (ASnnn)" düz yazıydı;
  // eski kural yalnız metni tümüyle IP olan öğeye bakıyordu.
  const re = /\\b\\d{1,3}(\\.\\d{1,3}){3}(\\/\\d{1,2})?\\b|\\bAS\\d{3,}\\b/;
  const out = [], tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    const s = n.nodeValue, p = n.parentElement;
    if (!p || !p.offsetWidth || !re.test(s) || /ör\\.|e\\.g\\./.test(s)) continue;
    if (p.closest('[data-ip], [data-act], a, button, input, textarea, select, option, pre, code, .ag-mono, .ag-out, .ag-target, .ag-addr-self, .ag-drawer-h, .ag-title, .ag-modal h3, .ag-srcd-h')) continue;   // başlıklar: sunucu adı, pencerenin konusu
    out.push((p.className || p.tagName) + ': ' + s.trim().slice(0, 70));
  }
  return out;
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
  // "her IP bütün servislere ulaşabilir" diyen kart ayrıca tek tek servis saymaz (canlıda: banlı olmayan aralıkta "Aralığın geneline
  // açık: Web."); tek IP'nin kendi kısmi banı "aralık" demez
  // ban altında ihlal kaydı olan kart "ihlallerin hepsi kesiliyor" demez (gerçek CSF denemesinde tam banlı aralığın kartında ikisi birlikteydi)
  if (/Ban altında ihlal olarak işaretli|marked as Violation under a ban/i.test(tx) && /hepsi kesiliyor|Every violation above is cut/.test(tx)) R.push('ban altında ihlal kaydı varken "hepsi kesiliyor"');
  if (/bütün servislere ulaşabilir|can reach every service/.test(tx) && /geneline açık:|Open for the range as a whole:/.test(tx)) R.push('her şey açıkken ayrıca açık servis satırı');
  (tx.match(/Kısmi \\(bu IP\\)[^\\n]*\\n[^\\n]*\\n?[^\\n]*bu aralıktan[^\\n]*/g) || []).forEach(m => R.push('tek IP banı "aralık" diyor: ' + m.replace(/\\s+/g, ' ').slice(0, 80)));
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
// Görünüm envanteri (G9; kullanıcı: "tablolar çeşit çeşit", "bu tarz tutarsızlıkları sen bul"): aynı görevdeki öğe (rol) her ekranda
// tek görünümde. Her ekran / kart taramasında rol başına görünüm imzası (yazı boyutu, kalınlık, büyük harf, harf aralığı, renk, yazı
// ailesi; düğmede yükseklik ve zemin) toplanır; sonda rol başına birden çok imza düşer, imzanın görüldüğü yerlerle. Boş öğe sayılmaz
// (başlık satırının sondaki boş hücresi yanlış fark üretiyordu). ROL_IST: bilinçli istisna (seçici → gerekçe)
// rol → seçici; renk ayrımı tür farkıdır (düğmede normal / birincil / kırmızı): düğmelerde yalnız boyut, kalınlık, yükseklik karşılaştırılır
const ROLES = {
  'liste / tablo başlığı': '.ag-thead .ag-th, table thead th',
  'tablo hücresi': '.ag-im-t tbody td, .ag-evm tbody td',
  'liste ana hücresi': '.ag-tbl > .ag-item > .ag-tr > .ag-td-main',
  'liste ikincil hücresi': '.ag-tbl > .ag-item > .ag-tr > .ag-td-why, .ag-tbl > .ag-item > .ag-tr > .ag-td-until',
  'liste zaman sütunu': '.ag-tbl > .ag-item > .ag-tr > .ag-when',
  'kart başlığı': '.ag-card-h h2',
  'kart açıklaması': '.ag-card-h .ag-hint',
  'bölüm başlığı': '.ag-drawer h4, .ag-fact-l',
  'bağlantı': '.ag-link',
  'adres bağlantısı': '.ag-cidr',
  'düğme': '.ag-btn:not(.ag-btn-sm)',
  'küçük düğme': '.ag-btn.ag-btn-sm',
  'kart altı metni': '.ag-pager > span',
  'boş durum': '.ag-empty',
};
// bilinçli istisnalar (seçici: gerekçe) — o rolde sayılmaz
const ROL_IST = {
  '.ag-td-why .ag-link, .ag-tile .ag-link, .ag-mode-hint .ag-link, .ag-warnbox .ag-link': 'cümle içi bağlantı: çevresindeki metnin boyutunu alır',
  '.ag-lookup .ag-btn': 'IP sorgula: yanındaki büyük arama kutusuyla aynı yükseklik (38 px)',
};

const INV = {};
// adres bağlantısı (IP / aralık) hiçbir yerde birden çok satıra bölünmez. 1.15.93'e kadar IP listesinde yandaki metin uzunsa
// (hedef listesi) telefonda adres "79 / .1 / 35 …" diye parçalanıyordu (canlıda kullanıcı gördü; tablo hücresinde "her yerden böl"
// vardı, adreste "bölünmez" yoktu). Her genişlikteki her taramada denetlenir
const BOLUNEN = [];
async function adresBol(page, ad) {
  const b = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-cidr')).filter(e => e.offsetWidth > 0 && e.getClientRects().length > 1).map(e => e.textContent.trim()).slice(0, 3));
  b.forEach(x => { if (BOLUNEN.length < 8) BOLUNEN.push(ad + ' ‹' + x + '›'); });
}
// sonlu CSS canlandırmalarının bitmesini bekler (sonsuzlar — dönen simge, iskelet — beklenmez). Kaydet çubuğu ve pencereler
// scale(.97)'den açılır: canlandırma sırasında ölçülen 34 px'lik düğme 33 çıkıyor, envanter ara sıra düşüyordu (ölçüldü 2026-11-24)
async function animBekle(page) {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter(a => { const t = a.effect && a.effect.getComputedTiming(); return t && isFinite(t.endTime); })
      .map(a => a.finished.catch(() => {}))),
    new Promise(r => setTimeout(r, 3000))])).catch(() => {});
}
async function rolInv(page, ad) {
  await animBekle(page);
  const got = await page.evaluate(([R, IST]) => {
    const out = [], ist = Object.keys(IST).join(', ');
    Object.keys(R).forEach(role => Array.from(document.querySelectorAll(R[role])).forEach(e => {
      if (!(e.offsetWidth > 0 && e.offsetHeight > 0) || e.closest('.ag-menu') || !e.textContent.trim() || e.matches(ist)) return;
      const c = getComputedStyle(e), btn = /düğme/.test(role);
      const sig = btn ? [c.fontSize, c.fontWeight, 'h' + e.offsetHeight].join(' · ')
        : [c.fontSize, c.fontWeight, c.textTransform === 'none' ? '' : c.textTransform, c.letterSpacing === 'normal' ? '' : 'ls ' + c.letterSpacing,
          c.color, c.fontFamily.split(',')[0].replace(/"/g, '')].filter(Boolean).join(' · ');
      const card = e.closest('.ag-card, .ag-drawer, .ag-modal'), h = card && card.querySelector('h2, h3');
      out.push([role, sig, (h ? h.textContent.trim().slice(0, 24) : '?') + ' ‹' + e.textContent.trim().slice(0, 18) + '›', (e.className || e.tagName).toString().slice(0, 40)]);
    }));
    return out;
  }, [ROLES, ROL_IST]);
  got.forEach(([role, sig, where, cls]) => { const r = INV[role] = INV[role] || {}; const s = r[sig] = r[sig] || { n: 0, w: new Set(), cls: new Set() }; s.n++; if (s.w.size < 4) s.w.add(ad + ' › ' + where); s.cls.add(cls); });
}
function rolRapor() {
  check('adres bağlantısı hiçbir ekranda birden çok satıra bölünmüyor', BOLUNEN.length === 0, BOLUNEN.join(' | '));
  Object.keys(ROLES).forEach(role => {
    const r = INV[role] || {}, sigs = Object.keys(r);
    const info = sigs.map(s => `${r[s].n}× [${s}] ${Array.from(r[s].w).join('; ')} {${Array.from(r[s].cls).slice(0, 3).join(' | ')}}`).join('\n      ');
    check(`görünüm envanteri · ${role}: tek görünüm (${sigs.length})`, sigs.length <= 1, sigs.length > 1 ? '\n      ' + info : '');
  });
}
// aynı durum aynı renk: data-st taşıyan rozet (.ag-pill) ve seviye metni (.ag-lv-st) bütün ekranlarda ve kartlarda tek renk.
// ST_CLS (ag.js) tek kaynak; önce Etkisini ölç'te banlar arayüz kırmızısı, izinli istekler yeşildi, IP kartında geçici blok banı kalıcı rengindeydi
const ST_SEEN = {};
async function stRenk(page, ad) {
  const sts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-st]')).filter(e => e.offsetWidth > 0).map(e => {
    const cs = getComputedStyle(e), p = e.classList.contains('ag-pill');
    return { st: e.getAttribute('data-st'), p, bg: p ? cs.backgroundColor : '', fg: cs.color, tx: e.textContent.trim().slice(0, 30) }; }));
  const bad = [];
  sts.forEach(x => {
    const o = ST_SEEN[x.st] = ST_SEEN[x.st] || {};
    function cmp(k, v) { if (!o[k]) o[k] = { v, tx: x.tx, ad }; else if (o[k].v !== v) bad.push(x.st + ' "' + x.tx + '" ' + v + ' ≠ "' + o[k].tx + '" (' + o[k].ad + ') ' + o[k].v); }
    if (x.p) { cmp('bg', x.bg); cmp('fg', x.fg); } else cmp('fg', x.fg);   // seviye metninin rengi rozetin yazı rengiyle aynı
  });
  check(`${ad} · aynı durum aynı renk (${sts.length} rozet)`, bad.length === 0, bad.slice(0, 3).join(' | '));
}
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
  await stRenk(page, 'kart ' + ad);
  await adresBol(page, 'kart ' + ad);
  await rolInv(page, 'kart ' + ad);
}
async function layoutChecks(page, label, width) {
  await page.evaluate(KURAL);
  const gor = await page.evaluate(() => window.agGorunmez(document.getElementById('ag-app')));
  const bas = await page.evaluate(() => window.agBasliksiz(document.getElementById('ag-app')));
  check(`${label} · ${width} px · tablolar başlıklı`, bas.length === 0, bas.slice(0, 3).join(' | '));
  const ulke = await page.evaluate(() => window.agUlkeTekrar(document.getElementById('ag-app')));
  check(`${label} · ${width} px · ülke kodu rozetin yanında yinelenmiyor`, ulke.length === 0, ulke.slice(0, 3).join(' | '));
  const ipb = await page.evaluate(() => [].concat(window.agIpBagsiz(document.getElementById('ag-app')), ...Array.from(document.querySelectorAll('.ag-drawer, .ag-modal')).map(x => window.agIpBagsiz(x))));
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
    // kapalı <details> içindeki öğeler çizilmez ama Chromium'da ölçü kutusu kalır (offsetWidth > 0, konumu özet satırının üstü): sayılmaz
    // (1.15.118 CSF blok listelerinin "Kapalı listeler" bölümü; ⋯ düğmeleri aşağıdaki düğmelerle "biniyor" görünüyordu)
    const E = Array.from(document.querySelectorAll('#ag-app button, #ag-app a, #ag-app input, #ag-app select, #ag-app .ag-chip')).filter(e => e.offsetWidth > 0 && !e.closest('details:not([open]) > :not(summary)'));
    const R = E.map(e => e.getBoundingClientRect()), out = [];
    for (let i = 0; i < E.length && out.length < 4; i++) for (let j = i + 1; j < E.length; j++) {
      if (E[i].contains(E[j]) || E[j].contains(E[i])) continue;
      // döşemenin köşesindeki Adres düğmesi bilerek döşemenin üstünde (metin ona yer bırakır)
      if ([E[i], E[j]].some(e => e.matches('.ag-tile-ed')) && [E[i], E[j]].some(e => e.matches('.ag-tile-m'))) continue;
      // kaydet çubuğu bilerek içeriğin üstünde yüzer (position: fixed): altındaki düğmeyle binmesi yerleşim hatası değil
      if ([E[i], E[j]].filter(e => e.closest('.ag-savebar')).length === 1) continue;
      const a = R[i], b = R[j];
      // yazısız öğe (⋯ menüsü, simge düğmesi) sınıfı ve data-act'ıyla adlandırılır: yalnız boş "↔ Kapalı" bulguyu tanıtmıyordu
      const nm = e => (e.textContent.trim().slice(0, 15) || ((e.getAttribute('data-act') || e.tagName.toLowerCase()) + '.' + String(e.className || '').split(' ')[0])) + '@' + Math.round(e.getBoundingClientRect().top);
      if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) { out.push(nm(E[i]) + ' ↔ ' + nm(E[j])); break; }
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
  // liste satırının durum rozeti tek satır (C3, 1.15.131: "tekrar geldi, kalıcı" 132 px'lik sütunda iki satıra iniyordu, öteki rozetler tek)
  const wrapped = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-td-state .ag-pill')).filter(e => e.offsetHeight > 0 && e.getBoundingClientRect().height > 26).map(e => e.textContent.trim()));
  check(`${label} · ${width} px · durum rozeti iki satıra inmez`, wrapped.length === 0, wrapped.slice(0, 5).join(' | '));
  // görünümün sağından taşan öğe (kart içinde kesilen düğme / seçenek sırası dahil)
  const over = await page.evaluate(w => Array.from(document.querySelectorAll('button, .ag-chip, .ag-pill, .ag-card, input, select')).filter(e => {
    const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1; }).map(e => (e.className || e.tagName) + ': ' + (e.textContent || '').trim().slice(0, 30)), width);
  check(`${label} · ${width} px · sağdan taşan öğe yok`, over.length === 0, over.slice(0, 4).join(' | '));
  // tutarlılık: tablo başlığının sütun sayısı satırın hücre sayısına eşit (başlık, altındaki satırla örtüşmeli)
  const mism = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-thead')).map(h => {
    const row = h.parentElement && h.parentElement.querySelector('.ag-tr'); if (!row) return null;
    // bütün genişliği kaplayan alt satır (Susturulanlar'ın sahip satırı, grid-column 1 / -1) sütun değil
    const cols = Array.from(row.children).filter(c => { const s = getComputedStyle(c); return !(s.gridColumnStart === '1' && s.gridColumnEnd === '-1'); }).length;
    return h.children.length === cols ? null : h.textContent.trim().slice(0, 30) + ': başlık ' + h.children.length + ' / satır ' + cols; }).filter(Boolean));
  check(`${label} · ${width} px · tablo başlığı satırla aynı sütun sayısında`, mism.length === 0, mism.join(' | '));
  // tutarlılık: sağlayıcı satırları (En çok engellenen, Banlı sağlayıcılar) aynı bileşen — sahip bilgisi satırın aynı yerinden başlar.
  // Önce sıralama kartında sıra numarası vardı (sahip 48 px'ten), Banlı sağlayıcılar kendi kopyasıydı (18 px'ten); kullanıcı fark etti
  const pal = await page.evaluate(() => {
    const m = {}; Array.from(document.querySelectorAll('.ag-asn-r')).filter(r => r.offsetWidth > 0).forEach(r => {
      const o = r.querySelector('.ag-asn-t'); if (!o) return; const c = r.closest('.ag-card'), h = c && c.querySelector('h2');
      const x = Math.round(o.getBoundingClientRect().left - r.getBoundingClientRect().left); (m[x] = m[x] || new Set()).add(h ? h.textContent.trim().slice(0, 24) : '?'); });
    return Object.keys(m).map(x => x + ' px: ' + Array.from(m[x]).join(', '));
  });
  check(`${label} · ${width} px · sağlayıcı satırları aynı hizada başlar (sıra numarası yok)`, pal.length <= 1 && !(await page.$('.ag-rank')), pal.join(' | '));
  // son satır kartın dibine yapışmasın: satırdaki en alttaki metin ile satırın alt kenarı arasında en az 6 px
  const tight = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-card-b')).map(b => {
    const rows = b.querySelectorAll(':scope > .ag-item, :scope > .ag-tbl > .ag-item, :scope > .ag-asn-r, :scope > .ag-ev, :scope > .ag-row'); const last = rows[rows.length - 1]; if (!last) return null;
    const lb = last.getBoundingClientRect().bottom; let mx = 0;
    last.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (!e.children.length && r.height > 0) mx = Math.max(mx, r.bottom); });
    if (!mx) return null; const gap = Math.round(lb - mx), c = b.closest('.ag-card'), h = c && c.querySelector('h2');
    return gap < 6 ? (h ? h.textContent.trim().slice(0, 25) : '?') + ': ' + gap + ' px' : null; }).filter(Boolean));
  check(`${label} · ${width} px · son satır kartın dibine yapışık değil`, tight.length === 0, tight.slice(0, 4).join(' | '));
  // her liste satırında içerik satırın üst ve alt kenarından en az 6 px içeride (önce yalnız son satıra bakılıyordu; Susturulanlar'ın
  // iki satırlı satırı masaüstünde üstte 2, altta 0 px'ti — kullanıcı ekran görüntüsünden)
  const rpad = await page.evaluate(() => {
    const vis = e => { const cs = getComputedStyle(e); return e.offsetWidth > 0 && e.offsetHeight > 0 && cs.visibility !== 'hidden' && !e.closest('.ag-menu'); };
    // ölçü birimi öğe (satır + altındaki not): Kontrol edilecekler satırı notuna 4 px bırakır, öğe altta 9 px ile biter
    return Array.from(document.querySelectorAll('.ag-tbl > .ag-item')).filter(vis).map(r => {
      const rr = r.getBoundingClientRect(); let mn = 1e9, mx = -1e9;
      r.querySelectorAll('*').forEach(e => { if (!vis(e) || Array.from(e.children).some(vis)) return; const q = e.getBoundingClientRect(); mn = Math.min(mn, q.top); mx = Math.max(mx, q.bottom); });
      if (mx < 0) return null;
      const top = Math.round(mn - rr.top), bot = Math.round(rr.bottom - mx), c = r.closest('.ag-card'), h = c && c.querySelector('h2');
      return top < 6 || bot < 6 ? (h ? h.textContent.trim().slice(0, 22) : '?') + ' · ' + r.textContent.trim().slice(0, 18) + ': üst ' + top + ', alt ' + bot + ' px' : null;
    }).filter(Boolean);
  });
  check(`${label} · ${width} px · liste satırının içeriği satır kenarına yapışık değil`, rpad.length === 0, rpad.slice(0, 3).join(' | '));
  // tablo satırında hücreler üst üste binmesin (⋯ düğmesinin metnin altında kalması gibi)
  const lap = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-tr')).map(row => {
    const cs = Array.from(row.children).map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return row.textContent.trim().slice(0, 30); }
    return null; }).filter(Boolean));
  check(`${label} · ${width} px · satır hücreleri üst üste binmiyor`, lap.length === 0, lap.slice(0, 3).join(' | '));
  // tasarım standardı: liste satırının eylemleri yalnız ⋯ menüsünde (satırda düğme yok; bağlantı biçimindeki sayı/adres serbest).
  // Kontrol edilecekler satırı önce karar düğmesini satırda, Sustur'u menüde gösteriyordu (1.15.77'de kalktı)
  const rbtn = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-tbl > .ag-item > .ag-tr')).map(row => {
    const b = Array.from(row.querySelectorAll('button.ag-btn')).filter(x => !x.closest('.ag-td-act, .ag-menu') && x.offsetWidth > 0)[0];
    return b ? row.textContent.trim().slice(0, 25) + ' → ' + b.textContent.trim() : null; }).filter(Boolean));
  check(`${label} · ${width} px · liste satırında eylem düğmesi yok (eylemler ⋯ menüsünde)`, rbtn.length === 0, rbtn.slice(0, 3).join(' | '));
  // tıklanan ile açılan aynı: adres bağlantısı (.ag-cidr) yazdığı adresi açar (önce aralık yazan bağlantı ilk IP'yi taşıyordu)
  const lnk = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-cidr[data-ip]')).filter(e => e.offsetWidth > 0)
    .map(e => { const tx = e.textContent.trim(), d = e.getAttribute('data-ip'); return tx === d || tx === d + '/32' ? null : tx + ' → ' + d; }).filter(Boolean));
  check(`${label} · ${width} px · adres bağlantısı yazdığı adresi açar`, lnk.length === 0, lnk.slice(0, 3).join(' | '));
  await stRenk(page, `${label} · ${width} px`);
  await adresBol(page, label + ' ' + width);
  if (width >= 1000) await rolInv(page, label);   // masaüstü genişliği (telefonda boyutlar bilinçli küçülür; ayrı denetlenir)
}
const errs = [];          // sayfanın JS hataları: test yarıda düşerse de yazılır
const API_LOG = [];
let API_PEND = 0;
// sekme / bölüm değişiminden sonra: panelin bekleyen API isteği kalmayınca (+ çizim payı) döner, en çok 30 sn. Sabit beklemeler istek
// kuyrukta gecikince boş ekranı ölçüyordu (Kontrol edilecekler 0 satır, Ayarlar kartı yok; 2026-11-25)
async function sakin(page) {
  const t0 = Date.now(); let z = 0;
  while (Date.now() - t0 < 30000) { await page.waitForTimeout(100); z = API_PEND > 0 ? 0 : z + 1; if (z >= 3) return; }
  console.log('  [tanı] 30 sn\'de istekler bitmedi · ' + apiSon(6));
}
async function taniDurum(page, t0) {   // kararsız düşüşte ekranın anı: geçen süre, kart, dönen simge, pencere, bildirimler, son istekler
  const s = await page.evaluate(() => { const d = document.querySelector('.ag-drawer'), q = x => (document.querySelector(x) || {}).innerText || '';
    return { n: document.querySelectorAll('.ag-drawer').length, spin: !!(d && d.querySelector('.ag-spin')), dr: d ? d.innerText.replace(/\s+/g, ' ').slice(0, 160) : '',
      modal: q('.ag-modal').replace(/\s+/g, ' ').slice(0, 120), toast: (window.__agToasts || []).slice(-4).join(' / ') }; });
  return ` [tanı: ${Date.now() - t0} ms, kart ${s.n} «${s.dr}», dönen simge ${s.spin}, pencere «${s.modal}», bildirim «${s.toast}», istekler: ${apiSon(8)}]`;
}
function apiSon(n) {      // son n API isteği: "a=… başladı +ms, süre ms | bekliyor"
  const t = Date.now();
  return API_LOG.slice(-n).map(q => { const a = ((q.postData() || '').match(/^a=[a-z0-9_]+/) || ['?'])[0], r = q.timing && q.timing();
    const done = r && r.responseEnd > 0; return a + ' -' + (t - q._t0) + 'ms ' + (done ? 'süre ' + Math.round(r.responseEnd) + 'ms' : 'bekliyor'); }).join(' | ');
}
(async () => {
  const opts = { args: ['--no-sandbox'] };
  if (process.env.AG_CHROME) opts.executablePath = process.env.AG_CHROME;
  const browser = await chromium.launch(opts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errs.push(e.message));
  // API isteklerinin zaman çizelgesi (tanı): kararsız düşüşte son istekler süreleriyle yazılır (apiSon)
  await page.addInitScript(() => {   // tanı: bildirimler kaybolur; metinleri zamanıyla biriktirilir (window.__agToasts)
    window.__agToasts = [];
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.classList && n.classList.contains('ag-toast'))
      setTimeout(() => window.__agToasts.push(new Date().toTimeString().slice(0, 8) + ' ' + n.innerText.replace(/\s+/g, ' ').slice(0, 90)), 0); })))
      .observe(document, { childList: true, subtree: true });
  });
  page.on('request', q => { if (/api\.php/.test(q.url())) { q._t0 = Date.now(); API_PEND++; API_LOG.push(q); if (API_LOG.length > 60) API_LOG.shift(); } });
  page.on('requestfinished', q => { if (/api\.php/.test(q.url())) API_PEND = Math.max(0, API_PEND - 1); });
  page.on('requestfailed', q => { if (/api\.php/.test(q.url())) API_PEND = Math.max(0, API_PEND - 1); });
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
    // IP sorgula testinin IP'si (198.51.100.77) /16'dan geniş aralıkta: 1.15.88'den beri o satırda da ban düğmesi var
    if (/^a=lookup/.test(pd) && j && j.ok && !j.pfx && /^\d+\.\d+\.\d+\.\d+$/.test(j.ip || '')) { const o = j.ip.split('.'); j.pfx = j.ip === '198.51.100.77' ? '198.48.0.0/12' : o[0] + '.' + o[1] + '.' + (o[2] & 128) + '.0/17'; }
    if (/^a=status/.test(pd) && j && j.ok) {
      // boş harita PHP'den [] gelir (json_encode boş diziyi nesne yapmaz); diziye eklenen anahtar JSON'a yazılmaz
      if (!j.owners || Array.isArray(j.owners)) j.owners = {};
      (j.ignored || []).forEach(g => { const p = String(g.cidr).replace(/\/\d+$/, '').split('.').slice(0, 3).join('.');
        if (!j.owners[p] || j.owners[p][0] === '-') j.owners[p] = ['64500', 'TR', 'TEST-AS - Turk Telekomunikasyon Anonim Sirketi Uzun Bir Kurum Adi Ornegi, TR']; });
      // geçici blok banının olay kaydı (IP'leriyle): Kaldır penceresi geri yükleme kutusunu bu kayıttan kurar. Yalnız sahip dizinine
      // giren evx'e eklenir (Geçmiş ve sayaçlar değişmez). 1.15.92'de geçici blokta da kutu çıkıyordu, motor geçici blokta onu okumuyordu
      j.evx = (j.evx || []).concat([{ t: j.now - 600, type: 'temp24', cidr: '203.0.113.0/24', n: 3,
        ips: ['203.0.113.5', '203.0.113.6', '203.0.113.7'].map(ip => ({ ip: ip, why: '(sshd) Failed SSH login from ' + ip })) }]);
      // ban altında ihlal (1.15.94): test makinesinde bu kaydı doğuran veri yok (kapsamanın defterde eskimesi gerekir) → iki satır
      // eklenir: kendi satırı (kiralık liste, IP başına) ve başka türden satıra eklenmiş kayıt (şüpheli ağ + kısmi ban, "ub"). Eski
      // tarihli: sıralamada sona düşer, Sustur akışının ilk satırı olmaz; susturulmuşsa eklenmez (akış onları düşmüş görmeli)
      const mute = c => (j.ignored || []).some(g => g.cidr === c), d0 = j.now - 5 * 86400, d1 = j.now - 2 * 86400;
      const uip = (ip, w, s) => ({ ip: ip, host: '', why: w, svc: s, t: d1, owner: '', asn: '', cc: '', pfx: '' });
      j.review = j.review || [];
      if (!mute('198.51.100.200')) j.review.push({ t: d1, type: 'under_ban', cidr: '198.51.100.200', ck: 'cl', cn: 'aws', cm: 'svc', tcp: '80,443', udp: '443', since: d0, n: 1, last: d1, csfr: 1, cr_t: d1 - 240, cr_iv: 60, cdn: 1, cdn_s: 'www.site-c.example (other)', total: 1,
        ips: [uip('198.51.100.200', 'mod_security (id:2008) triggered', 'web')] });
      if (!mute('198.18.0.0/16')) j.review.push({ t: d1 - 60, type: 'warn16', cidr: '198.18.0.0/16', n: 5, perm: 5, temp: 0, subnets: 3, wl: '', total: 5,
        ips: ['198.18.7.1', '198.18.7.2', '198.18.8.1', '198.18.8.2', '198.18.9.1'].map(ip => uip(ip, '(sshd) Failed SSH login', 'ssh')),
        ub: { ck: 'part', cn: '198.18.0.0/16', cm: 'ports', tcp: '80,443', udp: '443', since: d0, n: 2, last: d1, csfr: 0, total: 2,
          ips: ['198.18.20.1', '198.18.21.1'].map(ip => uip(ip, 'mod_security (id:2008) triggered', 'web')) } });
    }
    // gövde açıkça verilir: { response, json } birlikte verilince özgün gövde gidiyordu (enjeksiyon hiç işlemiyordu; ölçüldü)
    return route.fulfill({ status: r.status(), contentType: 'application/json', body: JSON.stringify(j) });
  });
  console.log('Arayüz');
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 }); await ready(page);
  check('sayfa açıldı, durum yüklendi', await page.$('.ag-head') !== null);
  // test düzeni: tıklama seçiciyle (tik / page.click) — page.$ ile alınan öğe, panel arada yeniden çizilirse kopar ve takımı durdurur
  // ("Element is not attached to the DOM", 2026-11-24 dört koşunun birinde)
  { const src = require('fs').readFileSync(__filename, 'utf8').split('\n'), hb = [];
    src.forEach((l, i) => { if (/await (?!page\b|l\b)[A-Za-z0-9_]+\.click\(/.test(l)) hb.push(i + 1); });
    check('test düzeni: öğe tutamağıyla tıklama yok (seçiciyle tıklanır)', hb.length === 0, 'satır ' + hb.join(', '));
    const sb = []; src.forEach((l, i) => { if (/(\.ag-tabs \[data-tab=|\.ag-setnav \[data-s)/.test(l) && /waitForTimeout\(/.test(l)) sb.push(i + 1); });
    check('test düzeni: sekme / bölüm değişiminden sonra sabit bekleme yok (sakin: istekler bitene kadar)', sb.length === 0, 'satır ' + sb.join(', ')); }
  // geçici blok banını kaldırma penceresi: motor geçici blokta yalnız csf -tr yapar (geri yükleme yok, csf -r yok) → pencerede geri
  // yükleme kutusu ve "kalıcı listeden kaldırılır" yok; aynı olay kaydıyla kalıcı blokta kutu var (karşılaştırma). Düğme sayfaya
  // eklenip tıklanır: test verisinde geçici blok banı olmayabilir
  // 1.15.143 (P13): kalıcı blokta geri yüklenecekler MOTORDAN (a=restore_plan; motorun seçimi durum tablosunda gerçek veriyle sınanır).
  // Burada motorun iki cevabı verilir: iki tekil (kutu, iki satır) ve hiçbiri (olay kaydının IP'leri banlı / izinli: kutu yok, not var)
  let rplan = null;
  const rpr = async route => { const pd = route.request().postData() || '';
    if (!/^a=restore_plan/.test(pd) || !rplan) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ips: rplan }) }); };
  await page.route('**/api.php', rpr);
  for (const kd of ['temp', 'perm', 'permskip']) {
    rplan = kd === 'perm' ? [{ ip: '203.0.113.5', why: '(sshd) Failed SSH login' }, { ip: '203.0.113.6', why: '(sshd) Failed SSH login' }] : [];
    await page.evaluate(k => { const b = document.createElement('button'); b.id = 'ag-test-ub'; b.setAttribute('data-act', 'unban'); b.setAttribute('data-c', '203.0.113.0/24');
      b.setAttribute('data-kind', k === 'permskip' ? 'perm' : k); b.setAttribute('data-dnd', '0'); b.setAttribute('data-restore', '0'); document.getElementById('ag-app').appendChild(b); }, kd);
    await page.click('#ag-test-ub'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
    const ub = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); return m ? { box: !!m.querySelector('#ag-restore'), n: m.querySelectorAll('.ag-rs-l').length, txt: m.innerText } : null; });
    if (kd === 'permskip') check('kalıcı blok: motor hiçbir tekili geri yüklemeyecekse kutu yok, atlananlar notta', !!ub && !ub.box && /geri yüklenmez|not restored/.test(ub.txt), JSON.stringify(ub && { box: ub.box, txt: ub.txt.slice(0, 300) }));
    else if (kd === 'temp') check('geçici blok banını kaldır: geri yükleme kutusu ve "kalıcı listeden" yok', !!ub && !ub.box && !/kalıcı listeden|permanent list/.test(ub.txt), JSON.stringify(ub && { box: ub.box, txt: ub.txt.slice(0, 160) }));
    else check('kalıcı otomatik blok banını kaldır: motorun geri yükleyeceği tekillerle kutu var (2 satır)', !!ub && ub.box && ub.n === 2, JSON.stringify(ub && { box: ub.box, n: ub.n }));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.ag-modal'), null, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { const b = document.getElementById('ag-test-ub'); if (b) b.remove(); });
  }
  await page.unroute('**/api.php', rpr);
  // Tur süresi ipucu: calistir.sh'nin olay kaydına eklediği tur (motorun durum çıktısından): kısmen inen liste "indirilemedi" der
  const tips = await page.$$eval('.ag-spark i', L => L.map(i => i.title));
  check('Tur süresi ipucu turu uzatan işleri yazar (yenilenen, inemeyen, csf -r)', tips.some(x => /izinli servis listeleri yenilendi/.test(x) &&
    /kiralık listeler: 7\/8 yenilendi, 1 indirilemedi/.test(x) && /csf -r 1× \(4 sn\)/.test(x)), tips.slice(-2).join(' | '));
  // sekmeler, iki genişlikte
  for (const tab of ['overview', 'history', 'prov', 'settings']) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (await tik(page, `.ag-tabs [data-tab="${tab}"]`)) await sakin(page);
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
        // Geçmiş araması (1.15.165): motor bütün olay kaydında arar; IP yazılınca o IP'nin olayı ve onu içeren /24'ün olayı gelir,
        // başkası gelmez; kutu odağını korur; temizleyince liste geri gelir (calistir.sh 21 + 1 olay ekler)
        const QB = '.ag-lq[data-l="ev"]', qb = !!(await page.$(QB));   // seçiciyle (sonuç gelince sayfa yeniden çizilir, tutamak kopar)
        check('Geçmiş: arama kutusu var (liste bir sayfadan uzun)', qb);
        if (qb) {
          await page.fill(QB, '192.0.2.110');
          await page.waitForFunction(() => { const L = document.querySelectorAll('#ag-events .ag-ev'); return L.length > 0 && L.length <= 5 && !/aranıyor|Searching/.test(document.querySelector('#ag-events').innerText); }, null, { timeout: 15000 }).catch(() => {});
          const s = await page.evaluate(() => ({ adr: Array.from(document.querySelectorAll('#ag-events .ag-ev .ag-ev-t')).map(x => (x.querySelector('[data-ip],.ag-cidr') || x).textContent.trim()),
            odak: document.activeElement && document.activeElement.getAttribute('data-l') }));
          const a = s.adr.join(' ');
          check('Geçmiş araması: IP\'nin olayı ve onu içeren /24 olayı gelir, başkası gelmez; kutu odakta', s.adr.length === 2 && /192\.0\.2\.110\b/.test(a) && /192\.0\.2\.0\/24/.test(a) && s.odak === 'ev', JSON.stringify(s));
          await page.fill(QB, '');
          await page.waitForFunction(() => document.querySelectorAll('#ag-events .ag-ev').length > 5, null, { timeout: 15000 }).catch(() => {});
          check('Geçmiş araması: kutu temizlenince liste geri gelir', await page.$$eval('#ag-events .ag-ev', L => L.length) > 5);
        }
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
            // adres öğesi kendi seçicisiyle: "yeni" noktalı satırda ilk öğe nokta (1.15.165'te yeni test olaylarıyla ortaya çıktı)
            const tt = x.querySelector('.ag-ev-t'), a = tt && (tt.querySelector('[data-ip], .ag-cidr') || tt.firstElementChild), p = tt && tt.querySelector('.ag-pill');
            const wr = a && p && p.getBoundingClientRect().top >= a.getBoundingClientRect().bottom - 2;
            // sahip bloğu (.ag-ev-o) sayılmaz: uzun ad kesilmeden alt satırlara kayar (kimlik kesilmez kuralı; canlıda "AS9121 TTNet Turk
            // Telekomunikasyon…" 56 px, satır 104 px). Sınır başlık + ayrıntı + saat içindir
            const oh = (y => { const o = y.querySelector('.ag-ev-o'); return o ? o.getBoundingClientRect().height : 0; });
            return x.getBoundingClientRect().height - oh(x) > (wr ? 125 : 100); }).map(x => Math.round(x.getBoundingClientRect().height));
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
  await page.click('.ag-tabs [data-tab="overview"]'); await sakin(page);
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
  await page.waitForSelector('.ag-setnav [data-s]', { timeout: 20000 }).catch(function () {}); await sakin(page);
  {
    // Ayarlar ilk açılışta menünün ilk bölümüyle (Genel) gelir; öncelik sırası menüdeki sırayla aynı
    const first = await page.$$eval('.ag-setnav [data-s]', L => ({ f: L[0] && L[0].getAttribute('data-s'), on: (L.filter(b => b.classList.contains('on'))[0] || {}).getAttribute ? L.filter(b => b.classList.contains('on'))[0].getAttribute('data-s') : null }));
    check('Ayarlar: ilk açılışta ilk bölüm (Genel) seçili', first.f === 'general' && first.on === 'general', JSON.stringify(first));
  }
  {
    // her bölüm aynı kalıpla açılır: ilk öğe tek satır açıklama, sonra kartlar (bölümler arası geçişte içerik kaymasın)
    const secs = await page.$$eval('.ag-setnav [data-s]', L => L.map(b => b.getAttribute('data-s')));
    const bad = [], tops = [], edge = [], pw = [];
    for (const s of secs) {
      await page.click(`.ag-setnav [data-s="${s}"]`); await sakin(page);
      const r = await page.evaluate(() => { const m = document.querySelector('.ag-setmain'); const f = m && m.firstElementChild; const n = f && f.nextElementSibling;
        // kart içeriği kartın kenarına yapışmaz: metin, giriş kutusu, düğme kartın sol / sağ kenarından en az 12 px içeride (AbuseIPDB kartı
        // ortak kart gövdesi olmadan yazılmıştı, metin kenara dayanıyordu — kullanıcı ekranı 1.15.114)
        const E = [];
        (m ? m.querySelectorAll('.ag-card') : []).forEach(function (c) {
          const cr = c.getBoundingClientRect(); if (!cr.width) return;
          c.querySelectorAll('input, button, select, textarea, label, p, span, a').forEach(function (x) {
            const xr = x.getBoundingClientRect(); if (!xr.width || !xr.height || getComputedStyle(x).visibility === 'hidden') return;
            if (!x.matches('input, button, select, textarea') && !Array.from(x.childNodes).some(function (n) { return n.nodeType === 3 && n.textContent.trim(); })) return;
            if (xr.left - cr.left < 12 || cr.right - xr.right < 12) E.push(((c.querySelector('.ag-card-h h2') || {}).textContent || '?').trim().slice(0, 30) + ' → ' + (x.textContent || x.placeholder || x.tagName).trim().slice(0, 30) + ' ' + Math.round(xr.left - cr.left) + '/' + Math.round(cr.right - xr.right));
          });
        });
        // parola alanı yok: tarayıcının parola yöneticisi sayfayı giriş formu sanıp kayıtlı kullanıcı adını WHM'in arama kutusuna yazıyordu
        const P = Array.from(document.querySelectorAll('input[type="password"]')).map(function (x) { return x.id || x.name || '?'; });
        return { lead: !!(f && f.classList.contains('ag-sec-lead') && f.textContent.trim()), top: n ? Math.round(n.getBoundingClientRect().top) : -1, E: E, P: P }; });
      if (!r.lead) bad.push(s + ': açıklama yok'); else tops.push(r.top);   // ilk kartın üst kenarı bölümden bölüme aynı olmalı
      r.E.forEach(function (x) { edge.push(s + ': ' + x); }); r.P.forEach(function (x) { pw.push(s + ': ' + x); });
      if (s === 'server') { await shot('ayar-sunucu-1280'); await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(400); await shot('ayar-sunucu-390');
        const r2 = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-setmain .ag-card')).filter(function (c) { return c.scrollWidth > c.clientWidth + 1; }).map(function (c) { return ((c.querySelector('h2') || {}).textContent || '?').trim().slice(0, 30); }));
        r2.forEach(function (x) { edge.push('server 390: taşan kart ' + x); });
        await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(300); }
    }
    const spread = tops.length ? Math.max(...tops) - Math.min(...tops) : 0;
    check('Ayarlar: her bölüm açıklama ile başlıyor, ilk kart aynı hizada (±24 px)', bad.length === 0 && spread <= 24, bad.join(' | ') + ' ' + tops.join(','));
    check('Ayarlar: kart içeriği kart kenarına yapışmaz (≥12 px), telefonda kart taşmaz', edge.length === 0, edge.slice(0, 6).join(' | '));
    check('Ayarlar: parola türünde alan yok (tarayıcı WHM arama kutusunu dolduruyordu)', pw.length === 0, pw.join(' | '));
    // AbuseIPDB kayıtlı anahtar (1.15.122, kullanıcı: "anahtar kayıtlıysa kutuda olsun"): test makinesinde anahtar yok → ayar cevabı
    // "kayıtlı" taklit edilir. Kutuda maskeli anahtar (salt okunur), Değiştir ile boş yazılabilir kutu + Vazgeç; beş ayar; iki genişlikte düzen
    {
      const cfr = async route => {
        const pd = route.request().postData() || '';
        if (!/^a=config_get/.test(pd)) return route.continue();
        let r; try { r = await route.fetch(); } catch (e) { return; }
        let j = null; try { j = await r.json(); } catch (e) { return route.fulfill({ response: r }); }
        if (j && j.ok) j.abuse = Object.assign({}, j.abuse || {}, { set: true, tail: 'WXYZ', today: 3, btoday: 1 });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
      };
      await page.route('**/api.php*', cfr);
      await page.click('.ag-tabs [data-tab="overview"]').catch(() => {}); await sakin(page);
      await page.click('.ag-tabs [data-tab="settings"]'); await page.waitForSelector('.ag-setnav [data-s]', { timeout: 20000 }).catch(() => {});
      if (await tik(page, '.ag-setnav [data-s="server"]')) await page.waitForSelector('#ag-abkey', { timeout: 10000 }).catch(() => {});
      const k0 = await page.evaluate(() => { const i = document.getElementById('ag-abkey'); const c = i && i.closest('.ag-card');
        return i ? { ro: i.readOnly, v: i.value, sec: i.classList.contains('ag-secret'), edit: !!(c && c.querySelector('[data-act="abuseedit"][data-v="1"]')), clr: !!(c && c.querySelector('[data-act="abuseclr"]')),
          on: !!(c && c.querySelector('[data-k="ABUSE_ON"]')), f: ['ABUSE_CACHE_H', 'ABUSE_IP_MAX', 'ABUSE_BLK_MAX', 'ABUSE_MAX_AGE'].filter(k => c && c.querySelector('[data-cfg="' + k + '"]')).length } : null; });
      check('AbuseIPDB: kayıtlı anahtar kutuda maskeli ve salt okunur, Değiştir ve Anahtarı kaldır, açma / kapama ve dört ayar', !!k0 && k0.ro && /^•+WXYZ$/.test(k0.v) && !k0.sec && k0.edit && k0.clr && k0.on && k0.f === 4, JSON.stringify(k0));
      // masaüstünde kutu ve iki düğmesi tek satırda (maskeli kutu genişlik kuralının dışında kalınca "Anahtarı kaldır" alta düşüyordu)
      const row = await page.evaluate(() => { const i = document.getElementById('ag-abkey'), r = i && i.closest('.ag-addrow');
        return r ? Array.from(r.children).map(x => Math.round(x.getBoundingClientRect().top)) : null; });
      check('AbuseIPDB: 1280 px\'te anahtar kutusu, Değiştir ve Anahtarı kaldır aynı satırda', !!row && row.length === 3 && Math.max(...row) - Math.min(...row) <= 6, JSON.stringify(row));
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(300); await layoutChecks(page, 'abuse-kayitli', w); await shot('abuse-kayitli-' + w);
        // maskeli anahtar kesilmez (son 4 karakter anahtarı tanıtan tek parça; 390'da kutu daralıp "••••••••WX" kalıyordu)
        const cut = await page.evaluate(() => { const i = document.getElementById('ag-abkey'); return i ? { sw: i.scrollWidth, cw: i.clientWidth } : null; });
        check(`AbuseIPDB: ${w} px'te maskeli anahtar kutuya sığar (son 4 karakter kesilmez)`, !!cut && cut.sw <= cut.cw + 1, JSON.stringify(cut)); }
      await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(200);
      await page.click('[data-act="abuseedit"][data-v="1"]').catch(() => {}); await page.waitForTimeout(300);
      const k1 = await page.evaluate(() => { const i = document.getElementById('ag-abkey'); return i ? { ro: i.readOnly, v: i.value, sec: i.classList.contains('ag-secret'), focus: document.activeElement === i, back: !!document.querySelector('[data-act="abuseedit"][data-v="0"]') } : null; });
      await page.click('[data-act="abuseedit"][data-v="0"]').catch(() => {}); await page.waitForTimeout(300);
      const k2 = await page.evaluate(() => { const i = document.getElementById('ag-abkey'); return i ? i.readOnly : null; });
      check('AbuseIPDB: Değiştir boş, gizli, odaklı yazılabilir kutu açar; Vazgeç maskeli hâle döner', !!k1 && !k1.ro && k1.v === '' && k1.sec && k1.focus && k1.back && k2 === true, JSON.stringify([k1, k2]));
      await page.unroute('**/api.php*', cfr);
      await page.click('.ag-tabs [data-tab="overview"]').catch(() => {}); await sakin(page);
      await page.click('.ag-tabs [data-tab="settings"]'); await page.waitForSelector('.ag-setnav [data-s]', { timeout: 20000 }).catch(() => {});
    }
    // CSF blok listeleri (1.15.118: Sağlayıcılar sekmesinin bir katmanı; 1.15.117'de Ayarlar'daydı). Test makinesinin gerçek csf.blocklists'i:
    // üstte katman özet kutusu (tıklanınca karta gider), kart katman bileşeniyle (pc), her liste bir satır. 1.15.123: aç / kapa öteki
    // katmanlarla AYNI bileşen (kullanıcı: "sağlayıcılar sayfasında bir sürü aç-kapa anahtarı var, blok listelerini farklı yapmışsın"):
    // satırda Açık / Kapalı çipi (cfgchip, CSF_BLOCKLIST:<ad>), ⋯ menüsü ve ayrı pencere yok; tıklayınca Kaydet çubuğu, onay penceresi
    // değişen listeyi ve csf -ra'yı söyler (onaylanmaz, Vazgeç). Ayarlar'da artık yok
    const bkSet = await page.evaluate(() => !!document.querySelector('.ag-setmain .ag-bkl'));
    check('CSF blok listeleri Ayarlar\'da yok (Sağlayıcılar sekmesinde katman)', !bkSet, '');
    await page.click('.ag-tabs [data-tab="prov"]'); await page.waitForSelector('#ag-bkl-card', { timeout: 20000 }).catch(() => {});
    const bk = await page.evaluate(() => { const c = document.querySelector('#ag-bkl-card.ag-pc'); const tl = document.querySelector('.ag-lay [data-act="laygo"][data-v="ag-bkl-card"]');
      const L = Array.from(document.querySelectorAll('.ag-lay [data-act="laygo"]')).map(b => b.getAttribute('data-v'));
      const rows = c ? Array.from(c.querySelectorAll('.ag-bkl .ag-dep')) : [];
      return c ? { n: rows.length, chip: rows.filter(r => r.querySelectorAll('.ag-chip[data-act="cfgchip"][data-k^="CSF_BLOCKLIST:"]').length === 2).length,
        m: c.querySelectorAll('[data-act="menu"]').length, tile: !!tl, sira: L.join(','), how: !!c.querySelector('details.ag-how') } : null; });
    check('Sağlayıcılar: CSF blok listeleri katmanı (özet kutusu üçüncü, kart katman bileşeniyle, her liste bir satır)',
      !!bk && bk.tile && bk.sira === 'ag-cloud-card,ag-prov-card,ag-bkl-card,ag-svc-card' && bk.how && bk.n > 0, JSON.stringify(bk));
    // bekçi: sekmedeki bütün aç / kapa seçimleri tek bileşen — her blok listesi satırında katmanların Açık / Kapalı çipi, ⋯ menüsü yok
    check('Sağlayıcılar: blok listesi aç / kapa öteki katmanlarla aynı bileşen (Açık / Kapalı çipi, menü yok)', !!bk && bk.n > 0 && bk.chip === bk.n && bk.m === 0, JSON.stringify(bk));
    // kapalı listeler katlanmış bölümde (kart 15 satırla uzuyordu); açık listeler doğrudan
    const kat = await page.evaluate(() => { const d = document.querySelector('#ag-bkl-card details.ag-more2'); return d ? { open: d.open, off: d.querySelectorAll('.ag-dep').length, onv: document.querySelectorAll('#ag-bkl-card .ag-bkl:not(details .ag-bkl) .ag-dep').length } : null; });
    check('CSF blok listeleri: kapalı listeler katlanmış bölümde, başta kapalı', !!kat && !kat.open && kat.off > 0, JSON.stringify(kat));
    // Ayrıntı (1.15.123): sağlayıcı / kiralık listeyle aynı pencere (ihlal eden IP'ler + Etkisini ölç); cevap taklit (kapalı listenin
    // yoklaması internetten indirir, test ona bağlı kalmasın)
    {
      const bkr = async route => { const pd = route.request().postData() || '';
        if (/^a=asn_impact/.test(pd) && /asn=bk%3A/.test(pd)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, total: 0, ips: 0, ok2xx: 0, codes: {}, posts: [], bots: [], sites: [] }) });
        if (!/^a=src_ips/.test(pd) || !/asn=bk%3A/.test(pd)) return route.continue();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, n: 1, ips: [['198.51.100.7', 'ssh', 'lfd: (sshd) Failed SSH login', Math.floor(Date.now() / 1000) - 3600, 'deny', 'deny']] }) }); };
      await page.route('**/api.php*', bkr);
      await page.evaluate(() => { const d = document.querySelector('#ag-bkl-card details.ag-more2'); if (d) d.open = true; }); await page.waitForTimeout(200);
      const bn = await page.evaluate(() => { const b = document.querySelector('#ag-bkl-card [data-act="srcinfo"][data-v^="bk:"]'); if (!b) return ''; b.click(); return b.getAttribute('data-v'); });
      await page.waitForSelector('#ag-bkl-card #ag-srcd table', { timeout: 8000 }).catch(() => {});
      const sd = await page.evaluate(() => { const w = document.querySelector('#ag-bkl-card #ag-srcd'); return w ? { ip: /198\.51\.100\.7/.test(w.innerText), imp: !!w.querySelector('[data-act="asnimpact"][data-v^="bk:"]'), port: /port listesi|port list/i.test(w.innerText) } : null; });
      check('blok listesi: Ayrıntı sağlayıcı ve kiralık listeyle aynı pencereyi açar (ihlal eden IP tablosu, Etkisini ölç; port önerisi yok)', !!bn && !!sd && sd.ip && sd.imp && !sd.port, bn + ' ' + JSON.stringify(sd));
      // Etkisini ölç: blok listesi bir liste — sağlayıcının sorusu ("Her şey" ile banlarsanız), kararı ve "bu sağlayıcıdan" metni yok
      // (1.15.123 ilk hâlinde ölçüm penceresi yalnız cl: önekini liste sayıyordu; kullanıcının telefon ekranı)
      await page.click('#ag-bkl-card #ag-srcd [data-act="asnimpact"]').catch(() => {});
      await page.waitForSelector('#ag-bkl-card #ag-srcd .ag-impact .ag-im-lead', { timeout: 8000 }).catch(() => {});
      const im = await page.evaluate(() => { const w = document.querySelector('#ag-bkl-card #ag-srcd .ag-impact'); return w ? w.innerText.replace(/\s+/g, ' ') : ''; });
      check('blok listesi Etkisini ölç: liste metinleri (sağlayıcı sorusu, kararı ve "bu sağlayıcıdan" yok)', !!im && /listenin|list's/.test(im) && !/Her şey|Everything|sağlayıcı|provider/i.test(im), im.slice(0, 260));
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'blok-ayrinti', w); await shot('blok-ayrinti-' + w); }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => { const b = document.querySelector('#ag-bkl-card [data-act="srcinfo"][aria-expanded="true"]'); if (b) b.click(); }); await page.waitForTimeout(300);
      await page.unroute('**/api.php*', bkr);
    }
    if (kat && kat.off) {
      await page.evaluate(() => { const d = document.querySelector('#ag-bkl-card details.ag-more2'); if (d) d.open = true; }); await page.waitForTimeout(200);
      const ad = await page.evaluate(() => { const b = document.querySelector('#ag-bkl-card details.ag-more2 .ag-chip[data-k^="CSF_BLOCKLIST:"][data-v="1"]:not([disabled])'); if (!b) return ''; b.click(); return b.getAttribute('data-k').slice(14); });
      await page.waitForTimeout(400);
      const sb = await page.evaluate(() => ({ bar: !!document.querySelector('.ag-savebar'), open: !!(document.querySelector('#ag-bkl-card details.ag-more2') || {}).open, on: !!document.querySelector('#ag-bkl-card details.ag-more2 .ag-chip.on[data-v="1"]') }));
      await page.click('[data-act="cfgsave"]').catch(() => {}); await page.waitForSelector('.ag-modal', { timeout: 5000 }).catch(() => {});
      const mt = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); return m ? m.innerText.replace(/\s+/g, ' ') : ''; });
      check('blok listesi: Açık çipi taslağa yazar (Kaydet çubuğu, katlı bölüm açık kalır); onay penceresi listeyi ve csf -ra\'yı söyler', !!ad && sb.bar && sb.open && sb.on && mt.indexOf(ad) >= 0 && /csf -ra/.test(mt), ad + ' ' + JSON.stringify(sb) + ' ' + mt.slice(0, 260));
      const cancel = await page.$('.ag-modal [data-act="cancel"], .ag-modal .ag-btn:not(.ag-btn-primary)');
      if (cancel) await tik(page, '.ag-modal [data-act="cancel"], .ag-modal .ag-btn:not(.ag-btn-primary)'); else await page.keyboard.press('Escape');
      await page.waitForTimeout(300); await page.click('[data-act="cfgdiscard"]').catch(() => {}); await page.waitForTimeout(300);
    }
    // birleşik servis dosyası 1.15.120'den beri Ayarlar'da (listenin nasıl işlediği); Sağlayıcılar'daki İzinli servisler kartında seçeneği yok
    const sxp = await page.evaluate(() => !!document.querySelector('[data-k="SVC_EXPORT"], [data-k="SVC_EXPORT_RELOAD"]'));
    check('birleşik servis dosyası seçenekleri Sağlayıcılar sekmesinde yok (Ayarlar → Kaynaklar ve yenileme)', !sxp, 'Sağlayıcılar\'da SVC_EXPORT');
    // sonraki denetimler Ayarlar'da sürer
    await page.click('.ag-tabs [data-tab="settings"]'); await page.waitForSelector('.ag-setnav [data-s]', { timeout: 20000 }).catch(() => {}); await sakin(page);
    // birleşik servis dosyası (1.15.120): Ayarlar → Kaynaklar ve yenileme → İzinli servis listeleri kartı; test makinesinde izinli servisler
    // kapalı → açınca "Sağlayıcılar'da kapalı" notu; yeniden yükleme seçeneği dosya kapalıyken soluk; Vazgeç ile taslak atılır
    if (await tik(page, '.ag-setnav [data-s="src"]')) await sakin(page);
    const sxc = '.ag-card:has([data-k="SVC_EXPORT"])';
    // bölüm ayarlar sunucudan gelince çizilir: sabit 500 ms, istek kuyrukta gecikince kartı bulamıyordu ([null,null], 2026-11-25 iki koşu)
    await page.waitForSelector(sxc, { timeout: 20000 }).catch(async () => console.log('  [tanı] birleşik dosya kartı 20 sn\'de çizilmedi · istekler: ' + apiSon(6)));
    const sx0 = await page.evaluate((q) => { const c = document.querySelector(q); return c ? { rl: !!c.querySelector('.ag-bagli.off [data-k="SVC_EXPORT_RELOAD"]'), ref: !!c.querySelector('[data-k="SVC_REFRESH_DAYS"]') } : null; }, sxc);
    await page.click(sxc + ' [data-act="cfgchip"][data-k="SVC_EXPORT"][data-v="1"]').catch(() => {}); await page.waitForTimeout(400);
    const sx1 = await page.evaluate((q) => { const c = document.querySelector(q); return c ? { rl: !!c.querySelector('.ag-bagli:not(.off) [data-k="SVC_EXPORT_RELOAD"]'), yol: /services-all\.txt/.test(c.innerText), not: /restartsrv_httpd --graceful/.test(c.innerText), nosvc: /(Sağlayıcılar sekmesinde devre dışı|off on the Providers tab)/.test(c.innerText) } : null; }, sxc);
    check('Ayarlar: birleşik servis dosyası izinli servis listelerinin kartında (yenileme ayarlarıyla; açınca yeniden yükleme seçeneği etkin, dosya yolu, izinli servisler kapalı notu)', !!sx0 && sx0.rl && sx0.ref && !!sx1 && sx1.rl && sx1.yol && sx1.not && sx1.nosvc, JSON.stringify([sx0, sx1]));
    for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'svc-birlesik', w); await shot('svc-birlesik-' + w); }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click('[data-act="cfgdiscard"]').catch(() => {}); await page.waitForTimeout(400);
  }
  {
    if (await tik(page, '.ag-setnav [data-s="thr"]')) await sakin(page);
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
      // eşik düşürülünce etkisi panelin tahmini değil: deneme turuna yönlendirir (önce "yaklaşık N blok daha banlanırdı"; tur izin /
      // kapsama yüzünden bir kısmını banlamazdı). Taslak sonra geri alınır
      if (v0 > 2) {
        await page.click('[data-act="numstep"][data-k="THRESHOLD_24"][data-d="-1"]'); await page.waitForTimeout(200);
        const hi = await page.evaluate(() => { const f = document.querySelector('#ag-f-THRESHOLD_24'); const w = f && f.closest('.ag-field'); const i = w && w.querySelector('.ag-field-i'); return i ? i.textContent : ''; });
        const tryBtn = await page.$('[data-act="cfgtry"]');
        check('Ayarlar: blok eşiği düşünce tahmini sayı yok, deneme turuna yönlendirir', /Kaydetmeden önce dene|Try before saving/.test(hi) && !/yaklaşık|about \d/.test(hi) && !!tryBtn, hi.slice(0, 90));
        await page.click('[data-act="numstep"][data-k="THRESHOLD_24"][data-d="1"]'); await page.waitForTimeout(200);
      }
    } else check('Ayarlar: sayı kutusu var', false, '#ag-f-THRESHOLD_24 yok');
  }
  {
    // Bildirim: olay × kanal tablosu — 5 olay (1.15.4: Kontrol edilecekler bulguları) × 2 kanal; hücre tıklanınca kaydet çubuğu çıkar, geri tıklanınca taslak temiz; telefonda sığar
    if (await tik(page, '.ag-setnav [data-s="notify"]')) await sakin(page);
    // 1.15.120: 6 olay (birleşik servis dosyası sorunları); her satırda iki kanal hücresi
    const cells = await page.$$('.ag-evm .ag-chk');
    const evRows = await page.$$eval('.ag-evm tbody tr', r => r.length).catch(() => 0);
    check('Bildirim: olay × kanal tablosu 6 olay × 2 kanal', evRows === 6 && cells.length === 12, evRows + ' satır, ' + cells.length + ' hücre');
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
  await page.click('.ag-tabs [data-tab="overview"]'); await sakin(page);
  {
    // Son tur ipucu: durum verisinin alındığı saat (ss:dd:ss); geri sayım kutusu var
    const tip = await page.$eval('#ag-last', b => b.parentElement.getAttribute('title') || '').catch(() => '');
    check('Son tur ipucunda veri saati var', /\d{1,2}:\d\d:\d\d/.test(tip), tip);
  }
  // Terimler penceresi
  const terms = await page.$('[data-act="terms"]');
  if (terms) { await tik(page, '[data-act="terms"]'); await page.waitForTimeout(600); check('Terimler penceresi açılıyor', await page.$('.ag-terms') !== null); const no = await page.$('[data-m="no"], [data-m="ok"]'); if (no) await tik(page, '[data-m="no"], [data-m="ok"]'); await page.waitForTimeout(400); }
  // Kontrol edilecekler satırları: IP kartı ve menü
  let ipBanSinandi = false;
  // liste çizilmeden satır toplanmaz: Ayarlar'dan dönüşte liste yeniden çizilirken 0 satır sayılıp ban altında ihlal denetimleri
  // "yok" diye düşüyordu (2026-11-24, dört koşunun birinde). Enjekte satır her koşuda var → onu bekle
  await page.waitForSelector('.ag-item[data-row="198.51.100.200"] .ag-tr-r', { timeout: 20000 }).catch(async () => console.log('  [tanı] Kontrol edilecekler 20 sn\'de çizilmedi · sekme ' +
    await page.evaluate(() => { const a = document.querySelector('.ag-tabs .on, .ag-tabs [aria-selected="true"], .ag-tabs .active'); return (a ? a.getAttribute('data-tab') || a.textContent.trim() : '?') +
      ' · Kaydet çubuğu ' + !!document.querySelector('.ag-savebar') + ' · satır ' + document.querySelectorAll('.ag-item[data-row]').length; }) + await taniDurum(page, Date.now())));
  const rows =await page.evaluate(() => Array.from(document.querySelectorAll('.ag-item[data-row] .ag-tr-r')).map(r => ({
    cidr: r.closest('.ag-item').getAttribute('data-row'), ip: (r.querySelector('.ag-cidr') || {}).getAttribute ? r.querySelector('.ag-cidr').getAttribute('data-ip') : '' })));
  console.log(`  Kontrol edilecekler: ${rows.length} satır`);
  // ban altında ihlal: kendi satırı rozetiyle ve notuyla (kapatan ban); başka türden satırda (şüpheli ağ) ikinci rozet + not, açılan IP
  // listesinde eklenen IP'ler aynı rozetle. Satır = adres: aynı adrese ikinci satır açılmaz
  {
    const ub = await page.evaluate(() => {
      const row = c => document.querySelector(`.ag-item[data-row="${c}"]`), tx = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
      const a = row('198.51.100.200'), b = row('198.18.0.0/16');
      return { a: a ? tx(a.querySelector('.ag-td-state')) + ' | ' + tx(a.querySelector('.ag-tr-note')) : 'yok',
        b: b ? tx(b.querySelector('.ag-td-state')) + ' | ' + tx(b.querySelector('.ag-ub-l')) : 'yok',
        nb: document.querySelectorAll('.ag-item[data-row="198.18.0.0/16"]').length };
    });
    check('ban altında ihlal satırı: rozet ve not (kapatan: kiralık liste AWS, kapattığı Web; sebepler: CSF yeniden yüklenmesi + kiralık liste yalnız yeni bağlantı, CDN arkasındaki site ve "other" çevrilmiş)',
      /^(Ban altında ihlal|Violation under a ban) \| .*AWS · (kapalı|closed): Web.*(CSF yeniden yüklendi|CSF was reloaded).*(kiralık liste kuralı yalnız yeni|rented-server rule cuts new).*(CDN arkasında: www\.site-c\.example \(başka adres\)|behind a CDN: www\.site-c\.example \(another address\))/.test(ub.a), ub.a);
    check('ban altında ihlal eki: şüpheli ağ satırının Durum sütununda ikinci rozet, notta açıklaması (2 IP, kısmi ban), tek satır', /^(Şüpheli ağ|Suspicious network) ?(Ban altında ihlal|Violation under a ban) \| (Ban altında ihlal|Violation under a ban): 2 IP/.test(ub.b) && ub.nb === 1, ub.b + ' · satır ' + ub.nb);
    // tek kural (rvStates): satırın bütün durumları Durum sütununda rozet; not bölümü yalnız açıklama — rozet taşımaz
    const np = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-tbl .ag-tr-note [data-st], .ag-tbl .ag-tr-note .ag-pill')).map(e => e.textContent.trim()).join(', '));
    check('durum standardı: Kontrol edilecekler satırlarının not bölümünde rozet yok (durumlar Durum sütununda)', np === '', np);
    const tg = await page.$('.ag-item[data-row="198.18.0.0/16"] .ag-td-why [data-act="toggle"]');
    if (tg) {
      await tik(page, '.ag-item[data-row="198.18.0.0/16"] .ag-td-why [data-act="toggle"]'); await page.waitForTimeout(400);
      const ipr = await page.evaluate(() => { const rs = Array.from(document.querySelectorAll('.ag-item[data-row="198.18.0.0/16"] .ag-ip-t tbody tr'));
        return rs.length + ' satır, rozetli ' + rs.filter(r => /Ban altında ihlal|Violation under a ban/.test(r.textContent)).length; });
      check('ban altında ihlal eki: IP listesinde 5 + 2 IP, eklenen 2 IP rozetli', ipr === '7 satır, rozetli 2', ipr);
      const tg2 = await page.$('.ag-item[data-row="198.18.0.0/16"] .ag-td-why [data-act="toggle"]'); if (tg2) { await tik(page, '.ag-item[data-row="198.18.0.0/16"] .ag-td-why [data-act="toggle"]'); await page.waitForTimeout(300); }
    } else check('ban altında ihlal eki: IP listesi açılır', false, 'aç/kapa bağlantısı yok');
  }
  for (const r of rows) {
    const before = errs.length;
    const el = await page.$(`.ag-item[data-row="${r.cidr}"] .ag-cidr`);
    if (!el) continue;
    await tik(page, `.ag-item[data-row="${r.cidr}"] .ag-cidr`);
    await page.waitForFunction(() => { const d = document.querySelector('.ag-drawer'); return d && d.innerText.length > 40 && !d.querySelector('.ag-spin'); }, null, { timeout: 20000 }).catch(function () {});
    // aralık satırı (/16, /24…) aralık kartını açar: başlık hemen gelir, gövde motorun cevabıyla (ölçüldü: ~2 sn) — karar satırı
    // çizilene kadar beklenir (önce Kontrol edilecekler'de aralık satırı olan test verisi yoktu, gövde beklenmeden denetleniyordu)
    if (/\//.test(r.cidr)) await page.waitForSelector('.ag-drawer .ag-verdict', { timeout: 30000 }).catch(function () {});
    await page.waitForTimeout(300);
    const txt = await page.evaluate(() => { const d = document.querySelector('.ag-drawer'); return d ? d.innerText : ''; });
    if (process.env.AG_TANI && /\//.test(r.cidr)) console.log('  [tanı] ' + r.cidr + ' ' + await page.evaluate(() => { const d = document.querySelector('.ag-drawer'); return d ? 'spin=' + !!d.querySelector('.ag-spin') + ' html=' + d.innerHTML.length + ' :: ' + d.innerText.replace(/\s+/g, ' ').slice(0, 400) : 'kart yok'; }));
    check(`IP kartı açılıyor: ${r.cidr}`, errs.length === before && txt.length > 40, errs.slice(before).join(' | '));
    await kartKurallari(page, r.cidr);
    // durum standardı: satırın birden çok durumu varsa IP kartı da hepsini gösterir (şüpheli ağ + ban altında ihlal)
    if (r.cidr === '198.18.0.0/16') check('durum standardı: IP kartı satırın ek durumunu da gösterir (ban altında ihlal rozeti ve açıklaması)',
      /(Ban altında ihlal|Violation under a ban)[\s\S]*(Ban altında ihlal|Violation under a ban): 2 IP/.test(txt), txt.replace(/\s+/g, ' ').slice(0, 300));
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
      await tik(page, `.ag-item[data-row="${r.cidr}"] [data-act="menu"]`); await page.waitForTimeout(400);
      const acts = await page.evaluate(c => Array.from(document.querySelectorAll(`.ag-item[data-row="${c}"] .ag-menu [data-act]`)).map(b => b.getAttribute('data-act')), r.cidr);
      check(`menüde Sustur var: ${r.cidr}`, acts.includes('ignore'), acts.join(','));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
  }
  // AbuseIPDB aralık sorgusu (1.15.116): test makinesinde anahtar yok → aralık kartı cevabına anahtar bilgisi (abk) eklenir, blok
  // sorgusunun cevabı taklit edilir (14 adres: 12'si görünür, "hepsini göster"). Kart açılınca sorgu GİTMEZ; düğmeyle bir kez
  if (await page.$('#ag-lk-ip')) {
    const ABR = []; for (let i = 1; i <= 14; i++) ABR.push({ ip: '198.51.100.' + i, r: 30 - i, s: i === 3 ? 100 : 40, l: '2026-11-2' + (i % 9) + 'T08:00:00+00:00', cc: 'US' });
    ABR.sort((a, b) => b.s - a.s || b.r - a.r);
    let abCalls = 0;
    const abr = async route => {
      const pd = route.request().postData() || '';
      if (/^a=abuse_block/.test(pd)) { abCalls++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, abuse: { net: '198.51.100.0/24', n: 14, mx: 100, ips: ABR, t: Math.floor(Date.now() / 1000) - 5 } }) }); }
      if (/^a=inside/.test(pd)) {
        let r; try { r = await route.fetch(); } catch (e) { return; }
        let j = null; try { j = await r.json(); } catch (e) { return route.fulfill({ response: r }); }
        if (j && j.ok) { j.abk = true; j.abt = 3; }
        return route.fulfill({ status: r.status(), contentType: 'application/json', body: JSON.stringify(j) });
      }
      return route.fallback();
    };
    await page.route('**/api.php', abr);
    await page.fill('#ag-lk-ip', '198.51.100.0/24'); await page.press('#ag-lk-ip', 'Enter');
    await page.waitForSelector('.ag-drawer .ag-verdict', { timeout: 30000 }).catch(() => {});
    // aralık kartında da IP kartıyla aynı Etkisini ölç bölümü (anahtar aralığın kendisi)
    check('aralık kartı: Etkisini ölç bölümü (anahtar net:aralık, IP kartıyla aynı bileşen)', !!(await page.$('.ag-drawer [data-impbox="net:198.51.100.0/24"] [data-act="asnimpact"]')));
    const q0 = await page.evaluate(() => !!document.querySelector('.ag-drawer #ag-ab-blk [data-dr="abq"]'));
    check('AbuseIPDB aralık: kart açılınca sorgu gitmez, "AbuseIPDB\'de sor" düğmesi var', q0 && abCalls === 0, 'düğme ' + q0 + ', istek ' + abCalls);
    if (q0) {
      await page.click('.ag-drawer [data-dr="abq"]');
      await page.waitForSelector('.ag-drawer .ag-ab-t', { timeout: 10000 }).catch(() => {});
      const ab = await page.evaluate(() => { const b = document.querySelector('.ag-drawer #ag-ab-blk'); if (!b) return null;
        const rows = Array.from(b.querySelectorAll('.ag-ab-t tbody tr')).filter(r => !r.hidden);
        return { n: rows.length, first: rows[0] ? rows[0].cells[0].textContent.trim() : '', link: !!(rows[0] && rows[0].querySelector('[data-ip]')), all: !!b.querySelector('[data-dr="aball"]'), txt: b.innerText.split('\n')[0] }; });
      check('AbuseIPDB aralık: düğmeyle tek istek; özet, puana göre ilk 12 adres, IP kartına bağlı, "hepsini göster"', !!ab && abCalls === 1 && ab.n === 12 && ab.first === '198.51.100.3' && ab.link && ab.all && /14/.test(ab.txt) && /100\/100/.test(ab.txt), JSON.stringify(ab) + ' istek ' + abCalls);
      await page.click('.ag-drawer [data-dr="aball"]').catch(() => {}); await page.waitForTimeout(200);
      const n2 = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-drawer .ag-ab-t tbody tr')).filter(r => !r.hidden).length);
      check('AbuseIPDB aralık: "hepsini göster" 14 adres', n2 === 14, String(n2));
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'aralik-abuse', w); await shot('aralik-abuse-' + w);
        // puan rozeti tek satır ("100/ 100" diye bölünmez; ilk sürümde 390 px'te bölünüyordu)
        const bol = await page.evaluate(() => Array.from(document.querySelectorAll('.ag-drawer .ag-ab-t .ag-pill')).filter(p => p.getClientRects().length > 1 || p.getBoundingClientRect().height > 26).map(p => p.textContent));
        check(`AbuseIPDB aralık: puan rozeti bölünmez (${w} px)`, bol.length === 0, bol.slice(0, 4).join(' | '));
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.ag-drawer'), null, { timeout: 5000 }).catch(() => {});
    await page.fill('#ag-lk-ip', '198.51.0.0/16'); await page.press('#ag-lk-ip', 'Enter');
    await page.waitForSelector('.ag-drawer .ag-verdict', { timeout: 30000 }).catch(() => {});
    const w16 = await page.evaluate(() => { const b = document.querySelector('.ag-drawer #ag-ab-blk'); return b ? { btn: !!b.querySelector('[data-dr="abq"]'), t: b.innerText } : null; });
    check('AbuseIPDB aralık: /24\'ten geniş aralıkta düğme yok, standart planın sınırını söyler', !!w16 && !w16.btn && /\/24/.test(w16.t) && abCalls === 1, JSON.stringify(w16));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.ag-drawer'), null, { timeout: 5000 }).catch(() => {});
    await page.unroute('**/api.php', abr);
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
      const rows = Array.from(d.querySelectorAll('.ag-lv-t tbody tr')).map(tr => ({ l: tr.cells[0].textContent.trim(), c: !!tr.cells[1].querySelector('[data-ip]'), b: Array.from(tr.querySelectorAll('[data-act]')).map(b => b.getAttribute('data-act')).join(',') }));
      return { sec, rows, eski: /Bloğun durumu|Bu IP'yi kapsayan banlar/.test(d.innerText), th: d.querySelectorAll('.ag-lv-t thead th').length }; });
    const r24 = kd && kd.rows.filter(r => r.l === 'Blok')[0], r16 = kd && kd.rows.filter(r => r.l === 'Ağ')[0];
    check('IP kartı düzeni: Bu IP · Üst seviyeler · Kim; tabloda Blok ve Ağ satırı, aralık tıklanır, Bloğu / Ağı banla kendi satırında; eski bölümler yok',
      !!kd && kd.sec[0] === 'Bu IP' && kd.sec.indexOf('Üst seviyeler') > 0 && kd.sec.indexOf('Kim') > kd.sec.indexOf('Üst seviyeler') && kd.th === 3 &&
      !!r24 && r24.c && r24.b === 'ban24' && !!r16 && r16.c && r16.b === 'ban16' && !kd.eski, JSON.stringify(kd));
    // /16'dan geniş duyurulan aralık (/12) da banlanabilir: satırı ağın altında, kendi düğmesiyle (önce düğme yoktu; kullanıcı sordu)
    const rpw = kd && kd.rows.filter(r => r.l === 'Duyurulan aralık')[0];
    check('IP kartı: /16\'dan geniş duyurulan aralık satırında ban düğmesi (banpfx)', !!rpw && rpw.c && rpw.b === 'banpfx', JSON.stringify(rpw));
    // düğmenin açtığı pencere aynı aralığı söyler (1.15.88 ilk hâlinde "198.48.0.0/12.0/24 … bloktaki 256 adres" diyordu; canlıda görüldü).
    // Onaylanmaz, Vazgeç
    if (rpw) {
      await page.click('.ag-drawer .ag-lv-t [data-act="banpfx"]'); await page.waitForSelector('.ag-modal', { timeout: 15000 }).catch(() => {});
      const mt = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); return m ? m.innerText : ''; });
      check('IP kartı: /12 ban penceresi aralığın kendisini söyler (/24 değil, birkaç ağın tamamı)', /198\.48\.0\.0\/12 /.test(mt) && !/\/12\.0\/24|256/.test(mt) && /16 ağ|16 whole/.test(mt), mt.slice(0, 160));
      await tik(page, '.ag-modal [data-m="no"]'); await page.waitForTimeout(400);
    }
    // telefonlar 320–390 arası (büyük yazı boyutu da dar genişlik gibi davranır): kart her birinde yatay kaymamalı
    for (const w of [1280, 390, 360, 320]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'ip-karti', w); }
    await page.setViewportSize({ width: 1280, height: 900 });
    // IP kartında Etkisini ölç (1.15.129): sağlayıcıdaki aynı ölçüm, anahtar net:IP/32; yalnız tıklanınca, kart açık kalır, sonuç kartın
    // kutusunda; metinler adresin diliyle (sağlayıcı / liste sözü ve "Her şey ile banlarsanız" sorusu yok). Cevap taklit
    {
      const imr = async route => { const pd = route.request().postData() || '';
        if (!/^a=asn_impact/.test(pd) || !/asn=net%3A/.test(pd) || /states=/.test(pd)) return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, total: 4, ips: 1, ok2xx: 3, areq: 0, aips: 0, codes: { 200: 3, 404: 1 },
          ocodes: { 200: 3, 404: 1 }, posts: [], bots: [], sites: [['shop.test', 3, 0, '', '']], fails: [['404 · shop.test · GET /.env', 1, 0, '', '198.51.100.77']], afails: [],
          cloud: { web: false, lists: '', req: 0, ips: 0 }, cdn: { req: 0 }, crawl: { bots: [] }, after: { web: 0, since: 0, req: 0 },
          open: { req: 4, ips: 1, ok: 3, codes: { 200: 3, 404: 1 }, last: '', pt: { 443: 4 }, top: [['198.51.100.77', 4, 3, 'shop.test · GET /', '']] }, ban: '' }) }); };
      await page.route('**/api.php', imr);
      const kb = await page.$('.ag-drawer [data-impbox="net:198.51.100.77/32"] [data-act="asnimpact"]');
      check('IP kartı: Etkisini ölç bölümü (anahtar net:IP/32, yalnız tıklanınca)', !!kb);
      if (kb) {
        await tik(page, '.ag-drawer [data-impbox="net:198.51.100.77/32"] [data-act="asnimpact"]');
        await page.waitForSelector('.ag-drawer [data-impbox] .ag-im-lead', { timeout: 10000 }).catch(() => {});
        const ki = await page.evaluate(() => { const b = document.querySelector('.ag-drawer [data-impbox]'); return { kart: !!document.querySelector('.ag-drawer'), t: b ? b.innerText.replace(/\s+/g, ' ') : '' }; });
        check('IP kartı Etkisini ölç: kart açık kalır, sonuç kartta; adresin metinleri (sağlayıcı / liste / "Her şey" yok)', ki.kart && /bu adresten|this address/.test(ki.t) && /198\.51\.100\.77/.test(ki.t) && !/sağlayıcı|provider|listenin|Her şey|Everything/i.test(ki.t), ki.t.slice(0, 300));
        for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'ip-etki', w); await shot('ip-etki-' + w); }
        await page.setViewportSize({ width: 1280, height: 900 });
        await tik(page, '.ag-drawer [data-impbox] [data-act="asnimpact"][data-again]').catch(() => {});   // yeniden ölç: kart yine açık
        await page.waitForTimeout(600);
        check('IP kartı Etkisini ölç: Yeniden ölç kartı kapatmaz', !!(await page.$('.ag-drawer [data-impbox]')));
      }
      await page.unroute('**/api.php', imr);
    }
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
      await tik(page, '.ag-drawer [data-dr="allow1"]'); await page.waitForSelector('.ag-modal #ag-al-note', { timeout: 8000 }).catch(() => {});
      const am = await page.evaluate(() => { const m = document.querySelector('.ag-modal'); if (!m) return null;
        const n = m.querySelector('#ag-al-note'), ok = m.querySelector('[data-m="ok"]');
        n.value = 'a#b'; n.dispatchEvent(new Event('input', { bubbles: true })); const bad = ok.disabled;
        n.value = 'ofis'; n.dispatchEvent(new Event('input', { bubbles: true }));
        return { sure: Array.from(m.querySelectorAll('[data-ttl]')).map(b => b.textContent.trim()), bad, ok: !ok.disabled, d: (m.querySelector('#ag-ttl-d') || {}).textContent || '' }; });
      check('izin penceresi: 5 süre (ilki süresiz), açıklama, geçersiz notta onay kapalı, geçerlide açık', !!am && am.sure.length === 5 && /^(Süresiz|No end)$/.test(am.sure[0]) && am.bad && am.ok && am.d.length > 20, JSON.stringify(am));
      for (const w of [1280, 390]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); await layoutChecks(page, 'ip-izin', w); }
      await page.setViewportSize({ width: 1280, height: 900 });
      const akA = Date.now();
      await page.click('.ag-modal [data-ttl="3600"]'); await page.click('.ag-modal [data-m="ok"]');
      const akT0 = Date.now();
      await page.waitForSelector('.ag-drawer [data-dr="unallow1"]', { timeout: 60000 }).catch(() => {});
      const ak = await page.evaluate(() => { const d = document.querySelector('.ag-drawer'); return d ? { un: !!d.querySelector('[data-dr="unallow1"]'), txt: d.innerText,
        spin: !!d.querySelector('.ag-spin'), n: document.querySelectorAll('.ag-drawer').length, modal: (document.querySelector('.ag-modal') || {}).innerText || '' } : null; });
      const akOk = !!ak && ak.un && /csf\.tempallow/.test(ak.txt) && /(kaldı|left)/.test(ak.txt);
      // eylemden sonra yalnız açık kaynak ayrıntısı yeniden istenir (en çok bir --src-ips); önce önbellekteki bütün kaynaklar isteniyordu
      // (4 istek ~25 sn, kartın sorgusu arkalarında 48 sn'de gelmedi)
      const akSrc = API_LOG.filter(q => q._t0 >= akA && /^a=src_ips/.test(q.postData() || '')).length;
      check('eylemden sonra yalnız açık kaynak ayrıntısı yeniden istenir (en çok 1 src_ips)', akSrc <= 1, akSrc + ' istek');
      check('izin: onaydan sonra kart "İzni kaldır" ve geçici iznin kalan süresini gösterir', akOk, (ak ? ak.txt.slice(0, 400) : '') + (akOk ? '' : await taniDurum(page, akT0)));
      if (ak && ak.un) {
        await page.click('.ag-drawer [data-dr="unallow1"]'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
        const unT0 = Date.now();
        await page.click('.ag-modal [data-m="ok"]');
        await page.waitForSelector('.ag-drawer [data-dr="allow1"]', { timeout: 60000 }).catch(() => {});
        const unOk = !!(await page.$('.ag-drawer [data-dr="allow1"]'));
        check('izin: İzni kaldır sonrası kart yeniden "İzin ver…" gösterir', unOk, unOk ? '' : await taniDurum(page, unT0));
      }
      // eylemden sonra kart sayfanın durumunu BEKLEMEDEN yenilenir (canlıda: ban bildirimi geldi, kart ~8 sn "açık" demeye devam etti), bekleme
      // kutusu kartın ÜSTÜNDE görünür (önce kartın arkasında kalıyordu: kart açıkken ekran boş bekliyordu) ve yenilenen karttaki bir sonraki
      // düğme beklemez (kartın verisi eylemden sonra alındı). Durum cevabı bilerek 8 sn, eylem 2 sn geciktirilir
      if (await page.$('.ag-drawer [data-dr="allow1"]')) {
        const yav = async route => { const pd = route.request().postData() || '';
          if (/^a=status(&|$)/.test(pd)) await new Promise(r => setTimeout(r, 8000));
          else if (/(^|&)name=allow1(&|$)/.test(pd)) await new Promise(r => setTimeout(r, 2000));
          return route.fallback(); };
        await page.route('**/api.php', yav);
        await tik(page, '.ag-drawer [data-dr="allow1"]'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
        const evCevap = page.waitForResponse(r => /(^|&)name=allow1(&|$)/.test(r.request().postData() || ''), { timeout: 60000 }).catch(() => null);
        await page.click('.ag-modal [data-ttl="3600"]'); await page.click('.ag-modal [data-m="ok"]');
        const yT0 = Date.now(); await page.waitForTimeout(700);
        const ust = await page.evaluate(() => { const w = document.getElementById('ag-wait-l'), e = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
          return { var: !!w, ustte: !!(w && e && w.contains(e)), kart: !!document.querySelector('.ag-drawer'), en: e ? e.className : '' }; });
        check('eylem sürerken bekleme kutusu açık kartın üstünde görünür', ust.var && ust.ustte && ust.kart, JSON.stringify(ust));
        await evCevap; const yA = Date.now();
        const stCevap = page.waitForResponse(r => /^a=status(&|$)/.test(r.request().postData() || ''), { timeout: 60000 }).catch(() => null);
        await page.waitForSelector('.ag-drawer [data-dr="unallow1"]', { timeout: 7000 }).catch(() => {});
        const yC = Date.now(), kartTaze = !!(await page.$('.ag-drawer [data-dr="unallow1"]'));
        check('eylemden sonra kart sayfanın durumunu beklemeden yenilenir (durum 8 sn gecikmeli)', kartTaze && yC - yA < 7000,
          'eylem ' + (yA - yT0) + ' ms, kart ' + (yC - yA) + ' ms sonra' + (kartTaze ? '' : await taniDurum(page, yT0)));
        if (kartTaze) {                          // durum hâlâ beklenirken karttaki sonraki düğme pencereyi açar, "biraz bekleyin" demez
          const tn = (await page.evaluate(() => (window.__agToasts || []).length));
          await page.click('.ag-drawer [data-dr="unallow1"]'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 4000 }).catch(() => {});
          const pen = !!(await page.$('.ag-modal [data-m="ok"]')), bek = await page.evaluate(n => (window.__agToasts || []).slice(n).join(' / '), tn);
          check('yenilenen karttaki sonraki düğme beklemez (kartın verisi eylemden sonra alındı)', pen && !/(Güncel durum alınıyor|Fetching the current status)/.test(bek), (pen ? 'pencere açıldı' : 'pencere yok') + ' · ' + bek);
          if (pen) { await page.click('.ag-modal [data-m="ok"]'); }
        }
        await stCevap; await page.unroute('**/api.php', yav);
        await page.waitForSelector('.ag-drawer [data-dr="allow1"]', { timeout: 60000 }).catch(() => {});
        if (!(await page.$('.ag-drawer [data-dr="allow1"]')) && await page.$('.ag-drawer [data-dr="unallow1"]')) {   // geri al
          await page.click('.ag-drawer [data-dr="unallow1"]'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
          await page.click('.ag-modal [data-m="ok"]'); await page.waitForSelector('.ag-drawer [data-dr="allow1"]', { timeout: 60000 }).catch(() => {});
        }
        await sakin(page);
      }
      // kart kapatıldıktan sonra biten eylem kartı yeniden açmaz (canlıda: arka arkaya IP'lere 1 sa izin verirken bir önceki IP'nin kartı
      // yenisinin üstüne geliyordu — istek sunucuda sürerken kart kapatılmış, cevap gelince eski kart açılıyordu). İstek bilerek geciktirilir
      if (await page.$('.ag-drawer [data-dr="allow1"]')) {
        const gec = async route => { if (/(^|&)name=allow1(&|$)/.test(route.request().postData() || '')) await new Promise(r => setTimeout(r, 2500)); return route.fallback(); };
        await page.route('**/api.php', gec);
        await page.click('.ag-drawer [data-dr="allow1"]'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
        const cevap = page.waitForResponse(r => /(^|&)name=allow1(&|$)/.test(r.request().postData() || ''), { timeout: 60000 }).catch(() => null);
        await page.click('.ag-modal [data-ttl="3600"]'); await page.click('.ag-modal [data-m="ok"]');
        await page.waitForTimeout(300);
        await page.evaluate(() => { const x = document.querySelector('.ag-drawer [data-dr="x"]'); if (x) x.click(); });
        // kart eylem cevabından hemen sonra, ardından durum yenilemesinden sonra yeniden çizilir (1.15.129'a kadar yalnız yenilemeden sonra):
        // ikisini de bekler. İlk sürüm yalnız eylem cevabını bekliyordu; eski panelle de geçti, hatayı yakalamıyordu
        const yenile = cevap.then(() => page.waitForResponse(r => /^a=status(&|$)/.test(r.request().postData() || ''), { timeout: 60000 }).catch(() => null));
        await cevap; await yenile; await page.waitForTimeout(2000);
        check('izin: kart kapatıldıktan sonra biten izin, kartı yeniden açmaz', !(await page.$('.ag-drawer')));
        await page.unroute('**/api.php', gec);
        // geri al: kartı aç, izni kaldır (sonraki adımlar izinsiz IP bekler)
        await page.fill('#ag-lk-ip', '198.51.100.77'); await page.press('#ag-lk-ip', 'Enter');
        await page.waitForSelector('.ag-drawer [data-dr="unallow1"]', { timeout: 60000 }).catch(() => {});
        if (await page.$('.ag-drawer [data-dr="unallow1"]')) {
          await page.click('.ag-drawer [data-dr="unallow1"]'); await page.waitForSelector('.ag-modal [data-m="ok"]', { timeout: 8000 }).catch(() => {});
          await page.click('.ag-modal [data-m="ok"]');
          await page.waitForSelector('.ag-drawer [data-dr="allow1"]', { timeout: 60000 }).catch(() => {});
        }
      }
    }
    // Süreli aralık banı (gerçek CSF): Bloğu banla penceresinde süre yalnız "Her şey"de; süre seçilince açıklama, kapsananlar kaldırılmaz;
    // 1 sa ile onay → kartın Blok satırı kalan süreyi gösterir → Aktif banlar satırı "elle · süre", ⋯ → Banı kaldır (yazarak)
    const b24 = await page.$('.ag-drawer .ag-lv-t [data-act="ban24"]');
    if (b24) {
      await tik(page, '.ag-drawer .ag-lv-t [data-act="ban24"]'); await page.waitForSelector('.ag-modal #ag-ttl', { timeout: 30000 }).catch(() => {});
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
      check('aralık banı: Aktif banlar satırı "elle · kalan süre", menüde Banı değiştir yok', /^(elle|manual) · \d/.test(pill), pill);
      if (gm) {
        await tik(page, `.ag-item[data-row="${gr}"] [data-act="menu"]`); await page.waitForTimeout(400);
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
      await tik(page, '.ag-menu [data-act="rewatch"]'); await page.waitForTimeout(500);
      await tik(page, '.ag-modal [data-m="ok"]');
      await page.waitForTimeout(6000);
      const left = await page.evaluate(p => { const r = Array.from(document.querySelectorAll('.ag-item[data-row]')).filter(x => x.getAttribute('data-row') === p + '.0/24')[0]; return r ? r.innerText : ''; }, pfx);
      check(`İzlemeyi yeniden başlat: ${pfx}.0/24 satırı duruyor`, left.length > 0, left.slice(0, 60).replace(/\n/g, ' '));
    }
  } else console.log('  (izlenen blok yok: izlemeyi yeniden başlat denenmedi)');
  // Deneme turu: gerçek motor kuru çalışır; pencere özetle açılmalı (ham çıktı açılır bölümde)
  const dryBtn = await page.$('[data-act="dry"]');
  if (dryBtn) {
    await tik(page, '[data-act="dry"]');
    await page.waitForFunction(() => document.querySelector('.ag-modal .ag-dry'), null, { timeout: 90000 }).catch(function () {});
    const dry = await page.evaluate(() => { const d = document.querySelector('.ag-modal .ag-dry'); return d ? { sum: d.querySelectorAll('.ag-dry-s').length, raw: !!d.querySelector('.ag-dry-raw pre') } : null; });
    check('Deneme turu penceresi özetle açılıyor (ham çıktı ayrı)', !!dry && dry.sum > 0 && dry.raw, JSON.stringify(dry));
    await shot('deneme-turu');
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  }
  // C4 (1.15.131): yeniden çizimde tıklanan öğe ekranda aynı yerde kalır, üstteki içerik uzasa da (önce kaydırma değeri geri konuyordu,
  // telefonda ölçüm / yenileme sonrası bakılan yer kayboluyordu). Üstteki başlığı yalnız 30 gün seçiliyken 300 px uzatan kural eklenir,
  // 30 gün çipi tıklanır: çip yerinden oynamamalı (eski panelde 300 px aşağı kayar)
  await page.click('.ag-tabs [data-tab="overview"]'); await sakin(page);
  const konum = await page.evaluate(async () => {
    const st = document.createElement('style'); st.id = 'c4-test'; st.textContent = '.ag-wrap:has(.ag-period .ag-chip.on[data-d="30"]) .ag-head { margin-bottom: 300px; }'; document.head.appendChild(st);
    const c7 = document.querySelector('.ag-period [data-d="7"]'); if (c7 && !c7.classList.contains('on')) { c7.click(); await new Promise(r => setTimeout(r, 300)); }
    const ch = document.querySelector('.ag-period [data-d="30"]'); if (!ch) return null;
    window.scrollTo(0, 0); const y0 = ch.getBoundingClientRect().top; window.scrollTo(0, Math.max(0, y0 - 150));
    const t0 = ch.getBoundingClientRect().top; ch.click(); await new Promise(r => setTimeout(r, 400));
    const t1 = document.querySelector('.ag-period [data-d="30"]').getBoundingClientRect().top;
    document.querySelector('.ag-period [data-d="7"]').click(); await new Promise(r => setTimeout(r, 300)); st.remove();
    return { t0: Math.round(t0), t1: Math.round(t1) };
  });
  check('C4: yeniden çizimde tıklanan öğe yerinde kalır (üstteki içerik uzasa da)', !!konum && Math.abs(konum.t1 - konum.t0) <= 2, JSON.stringify(konum));
  // sekmeye eski veriyle dönüş: yeni durum gelene kadar salt okuyan eylem (menü) çalışır, durum değiştiren (Sustur) bildirimle bekler.
  // Önce bütün eylemler kapanıyordu; durum isteği sunucuda 5-7 sn sürünce kullanıcı sayfayı donmuş sanıyordu
  await page.click('.ag-tabs [data-tab="overview"]'); await sakin(page);
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
  // önceki denetimin durum isteği 3 sn geciktirildi ve o süre ağa çıkmadığı için sakin onu görmez: bitmeden başlarsak yeni panel o
  // isteği paylaşır (doğru davranış) ve aşağıdaki sayım 0 çıkardı
  await page.waitForTimeout(3500); await sakin(page);
  // dönüşte tek durum isteği: arka arkaya iki "görünür" olayı süren isteği paylaşır (canlıda ikisi de ~11 sn'lik iki istek açıyordu)
  const cift = await page.evaluate(async () => {
    const od = Date.now; Date.now = () => od() + 120000;
    let n = 0; const of = window.fetch;
    window.fetch = (u, o) => { if (o && /^a=status(&|$)/.test(String(o.body || ''))) { n++; return new Promise(r => setTimeout(() => r(of(u, o)), 1500)); } return of(u, o); };
    document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 40));
    document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 40));
    const k = n; await new Promise(r => setTimeout(r, 2500)); Date.now = od; window.fetch = of; return k;
  });
  check('sekmeye dönüş: arka arkaya iki görünürlük olayı tek durum isteği açar', cift === 1, cift + ' istek');
  await sakin(page);
  // tek ağ hatası uyarı değil (telefon tarayıcısı arka plandaki sekmenin bağlantısını keser): yeniden denenir, uyarı yalnız art arda
  // ikinci hatada. fail = kaç durum isteği ağ hatasıyla düşsün
  const agHata = async (fail) => page.evaluate(async (fail) => {
    const od = Date.now; Date.now = () => od() + 120000;
    let n = 0; const of = window.fetch;
    window.fetch = (u, o) => { if (o && /^a=status(&|$)/.test(String(o.body || ''))) { n++; if (n <= fail) return Promise.reject(new TypeError('Failed to fetch')); } return of(u, o); };
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 400));
    const w0 = !!document.querySelector('.ag-conn');
    await new Promise(r => setTimeout(r, 3000));
    const w1 = !!document.querySelector('.ag-conn'), k = n; Date.now = od; window.fetch = of; return { w0, w1, n: k };
  }, fail);
  const h1 = await agHata(1);
  check('tek ağ hatası: uyarı çıkmaz, durum 2 sn sonra yeniden istenir', !h1.w0 && !h1.w1 && h1.n >= 2, JSON.stringify(h1));
  await sakin(page);
  const h2 = await agHata(2);
  check('art arda iki ağ hatası: "Sunucuya ulaşılamıyor" uyarısı çıkar', !h2.w0 && h2.w1 && h2.n >= 2, JSON.stringify(h2));
  // uyarıyı kaldır: yeni durum gelsin
  await page.evaluate(() => { const od = Date.now; Date.now = () => od() + 120000; document.dispatchEvent(new Event('visibilitychange')); setTimeout(() => { Date.now = od; }, 200); });
  await page.waitForFunction(() => !document.querySelector('.ag-conn'), null, { timeout: 30000 }).catch(() => {});
  check('ağ hatası sonrası ilk başarılı durumda uyarı kalkar', !(await page.$('.ag-conn')));
  await sakin(page);
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
      return { em: t ? (t.querySelector('em.cm .ag-stlink') || {}).textContent : null, modal: !!document.querySelector('.ag-modal') }; });
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
    // kutudan açılan pencere tıklanan kutunun HEMEN altında (1.15.133; önce bütün kutuların altındaydı, telefonda sayfanın sonuna kaydırılıyordu)
    const edPos = awsT ? await page.$eval(`${G} .ag-tile:has(.ag-tile-m b:text-is("${awsT}"))`, tl => {
      const x = tl.nextElementSibling, ed = x && x.querySelector('.ag-urled');
      if (!ed) return { ok: false, why: 'kutunun ardında düzenleyici yok' };
      const a = tl.getBoundingClientRect(), b = ed.getBoundingClientRect();
      return { ok: b.top >= a.bottom - 1 && b.top - a.bottom < 40, gap: Math.round(b.top - a.bottom) };
    }).catch(e => ({ ok: false, why: String(e).slice(0, 80) })) : { ok: false, why: 'AWS kutusu yok' };
    check('kutunun adres düzenleyicisi tıklanan kutunun hemen altında açılır', edPos.ok, JSON.stringify(edPos));
    if (awsT) { await tik(page, `${G} .ag-tile:has(.ag-tile-m b:text-is("${awsT}")) .ag-tile-rm`); await page.waitForTimeout(300); }
    // izinli servisler: hazır kutuya kendi kaynağınız, hazır alt kaynak silinir ve geri gelir
    const goo = (await names(SG)).find(t => /Google/.test(t)) || '';
    if (goo) {
      await tik(page, `${SG} .ag-tile:has(.ag-tile-m b:text-is("${goo}")) .ag-tile-ed`); await page.waitForTimeout(300);
      await tik(page, '[data-act="srcadd"][data-v="svc|google"]'); await addForm('ek', '203.0.113.10');
      const s1 = await chips(SG, goo);
      check('izinli servis: hazır kutuya kendi kaynağınız çip olarak eklenir', !!s1 && s1.includes('ek'), JSON.stringify(s1));
      const sub = s1 && s1.find(x => x !== 'ek');
      // adres düzenleyicisinin her satırı da kaldırılabilir (çipteki × ile aynı eylem; 1.15.132'ye kadar yalnız çipte vardı)
      const edRm = await page.$$eval('.ag-urled-r[data-src]', R => R.map(r => !!r.querySelector('[data-act="srcrm"]')));
      check('izinli servis: adres düzenleyicisinde her kaynak satırının kendi kaldırma düğmesi var', edRm.length > 1 && edRm.every(Boolean), JSON.stringify(edRm));
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
  rolRapor();
  await browser.close();
  console.log(`Arayüz: ${N} denetim, ${F} beklenmeyen`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.log('  ✗ HATA: ' + e.message + (errs.length ? ' · sayfa hataları: ' + errs.slice(0, 3).join(' | ') : '')); process.exit(1); });
