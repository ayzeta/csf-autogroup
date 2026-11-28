// DURUM ADI bekçisi (P4, 1.15.159): aynı kapatan kaydı için tablo hücresi (stText) ile rozet (impState) aynı sözü yazar ve kural metni
// eski biçimde değildir. Önce hücre "aralık banı (X)", rozet "aralık banlı"; hücre "geçici banlı", rozet "geçici banlı · 5 sa kaldı"
// yazıyordu. ag.js gerçek koduyla yüklenir (tests/saat düzeni). Kullanım: node durum-adi.js [ag.js]
const fs = require('fs'), path = require('path');
let src = fs.readFileSync(process.argv[2] || path.join(__dirname, '../../whm/assets/ag.js'), 'utf8');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + `globalThis.__AG = { set: function (s) { S = s; LANG = 'tr'; CLOCK = 0; }, stText: stText, impState: impState };\n` + src.slice(tail);
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
globalThis.window = { AG_BOOT: {}, addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el(), documentElement: el(), hidden: true };
globalThis.location = window.location; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'tr' };
globalThis.fetch = () => new Promise(() => {});
globalThis.setInterval = () => 0; globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => {};
try { new Function(src)(); } catch (e) { console.log('DÜŞTÜ: ag.js yüklenemedi: ' + e.message); process.exit(1); }
const AG = globalThis.__AG;
AG.set({ svcp: { web: '80,443', ssh: '22', smtp: '25,465,587', mread: '110,143,993,995', ftp: '21', cp: '2082,2083,2086,2087,2095,2096', dns: '53' },
  svcpu: { web: '443', dns: '53' }, dports: ['80,443', '443'], cron_min: '*/15' });
const end = Math.round(Date.now() / 1000) + 5 * 3600;
const K = [
  { t: 'ip', a: '198.51.100.7', m: 'all' }, { t: 'cidr', a: '198.51.100.0/24', m: 'all' },
  { t: 'temp', a: '198.51.100.7', m: 'all', end }, { t: 'temp', a: '198.51.100.0/24', m: 'all', end },
  { t: 'temp', a: '198.51.100.7', m: 'ports', tcp: '22', end }, { t: 'port', a: '198.51.100.7', m: 'ports', tcp: '80,443', udp: '443', own: 1 },
  { t: 'port', a: '198.51.0.0/16', m: 'ports', tcp: '22' }, { t: 'asn', a: 'AS64500', m: 'all' }, { t: 'asn', a: 'AS64500', m: 'ports' },
  { t: 'cc', a: 'FR', m: 'ports' }, { t: 'cl', a: 'aws', m: 'ports', tcp: '443', udp: '443' }, { t: 'bk', a: 'SPAMDROP', m: 'all' },
  { t: 'imu', a: '198.51.100.7', m: 'all' },
];
const plain = h => String(h).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
const ESKI = [/\(\d+\.\d+\.\d+\.\d+\/\d+\)/, /aralık banlı$/, /: her şey$/, /yalnız port listesi/, /kiralık liste \(/, / · TCP \d/, /,\s*$/];
let F = 0;
for (const k of K) {
  const v = { e: k.m === 'all' && k.t !== 'port' ? 'ban' : 'part', k: [k] };
  const a = plain(AG.stText(v)), b = plain(AG.impState(v));
  const eski = ESKI.find(r => r.test(a) || r.test(b));
  if (a !== b || !a || eski) { F++; console.log(`  ✗ ${k.t}${k.m ? ' ' + k.m : ''}: hücre "${a}" · rozet "${b}"${eski ? ' · eski kalıp ' + eski : ''}`); }
  else console.log(`  ✓ ${k.t}${k.m ? ' ' + k.m : ''}: "${a}"`);
}
console.log(F ? `DÜŞTÜ: durum adı ${F} kayıtta hücre ile rozet farklı` : `GEÇTİ: durum adı ${K.length} kapatan türünde hücre = rozet`);
process.exit(F ? 1 : 0);
