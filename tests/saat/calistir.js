// Panelin saatleri sunucu saatiyle (1.15.87): tarayıcı başka saat dilimindeyken de tarih/saat, gün adı ve "Sıradaki tur" sayacı
// sunucunun saatiyle (mail, günlük, csf.deny yorumları, cron ile aynı). ag.js gerçek koduyla yüklenir (durum tablosunun render.js
// düzeni); süreç New York saatinde çalışır, sunucu İstanbul (+03, yaz saati yok) ya da yalnız sabit fark (+05:30) verir.
// Çalıştırma: node tests/saat/calistir.js   (TZ kendisi ayarlanır)
if (process.env.TZ !== 'America/New_York') {
  const r = require('child_process').spawnSync(process.execPath, [__filename], { stdio: 'inherit', env: Object.assign({}, process.env, { TZ: 'America/New_York' }) });
  process.exit(r.status);
}
const fs = require('fs'), path = require('path');
let src = fs.readFileSync(path.join(__dirname, '../../whm/assets/ag.js'), 'utf8');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + `globalThis.__AG = { set: function (s, l) { S = s; LANG = l || 'tr'; CLOCK = s.now - Date.now() / 1000; tzSet(s); },
  stamp: stamp, dayStr: dayStr, nextLeft: nextLeft, fmtDT: fmtDT, at: function (t) { CLOCK = t - Date.now() / 1000; } };\n` + src.slice(tail);
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
globalThis.window = { AG_BOOT: {}, addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el(), documentElement: el(), hidden: true };
globalThis.location = window.location; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'tr' };
globalThis.fetch = () => new Promise(() => {});
const INTERVALS = [], TIMEOUTS = [];
globalThis.setInterval = (f, ms) => { INTERVALS.push({ f, ms }); return 0; };
globalThis.setTimeout = (f, ms) => { TIMEOUTS.push({ f, ms }); return 0; };
globalThis.clearTimeout = () => {};
try { new Function(src)(); } catch (e) { console.error('yükleme hatası:', e.message); process.exit(1); }
const AG = globalThis.__AG;
let N = 0, F = 0;
function check(name, ok, info) { N++; if (!ok) F++; console.log(`  ${ok ? '✓' : '✗'} ${name}${info ? ' → ' + info : ''}`); }

// 2026-11-11 10:40:30 UTC = İstanbul 13:40:30 = New York 05:40:30
const T = Date.UTC(2026, 10, 11, 10, 40, 30) / 1000;
AG.set({ now: T, tz: 'Europe/Istanbul', tzo: 10800, cron_min: '*/15', enabled: true }, 'tr');
check('süreç New York saatinde (test düzeni)', new Date(T * 1000).getHours() === 5, String(new Date(T * 1000).getHours()));
check('saat sunucu saatiyle (İstanbul 13:40, tarayıcı 05:40)', AG.stamp(T) === '11.11 13:40', AG.stamp(T));
check('gün sunucu gününe göre (UTC 22:30 = İstanbul ertesi gün 01:30)', AG.dayStr(Date.UTC(2026, 10, 11, 22, 30) / 1000) === '12 Kas 2026', AG.dayStr(Date.UTC(2026, 10, 11, 22, 30) / 1000));
check('takvim günü metni saat diliminden bağımsız', AG.dayStr('2026-10-05') === '5 Eki 2026', AG.dayStr('2026-10-05'));
check('"Sıradaki tur" cron dakikası sunucu saatiyle (13:40:30 → */15 → 13:45, 270 sn)', AG.nextLeft() === 270, String(AG.nextLeft()));
// yarım saatlik dilim, yalnız sabit fark (ad yok): 10:40:30 UTC + 5:30 = 16:10:30 → */15 → 16:15, 270 sn; tarayıcı saatiyle 05:40 → 300+… olurdu
AG.set({ now: T, tz: '', tzo: 19800, cron_min: '*/15', enabled: true }, 'tr');
check('ad yokken sabit fark (+05:30): 16:10', AG.stamp(T) === '11.11 16:10', AG.stamp(T));
check('ad yokken sayaç sabit farkla (16:10:30 → 16:15, 270 sn)', AG.nextLeft() === 270, String(AG.nextLeft()));
AG.set({ now: T, tz: 'Bilinmeyen/Yer', tzo: 10800, cron_min: '0', enabled: true }, 'tr');
check('tarayıcının tanımadığı ad: sabit farka düşer (13:40)', AG.stamp(T) === '11.11 13:40', AG.stamp(T));
AG.set({ now: T, tz: 'Europe/Istanbul', tzo: 10800, enabled: true }, 'en');
check('İngilizce biçim de sunucu saatiyle', /13:40/.test(AG.stamp(T)), AG.stamp(T));
// Tur anı yoklaması (1.15.155): panelin saniyelik sayacı gerçek nextLeft ile 13:44:55 → 13:45:10 ilerletilir; tikten sonra bir kez,
// 3 sn sonra durum sorulmalı. 1.15.154'e kadar "left === 0" aranıyordu; nextLeft tikte 1'den 900'e atladığı için hiç kurulmuyordu.
const tickIv = INTERVALS.find(x => x.ms === 1000 && /nextLeft\(\)/.test(String(x.f)));
check('saniyelik sayaç bulundu', !!tickIv);
if (tickIv) {
  AG.set({ now: T, tz: 'Europe/Istanbul', tzo: 10800, cron_min: '*/15', cron_interval: 900, enabled: true, running: false }, 'tr');
  document.hidden = false;
  const t0 = Date.UTC(2026, 10, 11, 10, 44, 55) / 1000;   // İstanbul 13:44:55
  const probes = [];
  for (let i = 0; i <= 15; i++) {
    AG.at(t0 + i); const n = TIMEOUTS.length; tickIv.f();
    TIMEOUTS.slice(n).forEach(x => { if (/refresh/.test(String(x.f))) probes.push({ at: i, ms: x.ms }); });
  }
  check('tik geçince bir kez yoklama kurulur (13:45:00, 3 sn sonra)', probes.length === 1 && probes[0].at === 5 && probes[0].ms === 3000, JSON.stringify(probes));
  probes.length = 0; AG.at(t0 + 20); tickIv.f(); document.hidden = true; tickIv.f(); document.hidden = false;
  AG.at(t0 + 300); tickIv.f();
  check('gizli sekmeden dönüşte yanlış tik sayılmaz', TIMEOUTS.filter(x => /refreshNow/.test(String(x.f))).length === 1, String(TIMEOUTS.length));
}
console.log(`Saat: ${N} denetim, ${F} beklenmeyen`);
process.exit(F ? 1 : 0);
