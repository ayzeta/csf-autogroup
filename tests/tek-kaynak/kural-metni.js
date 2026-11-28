// P4 kural metni bekçisinin sözlük kısmı (tek-kaynak'a da konacak): TR ve EN değerlerinde kısa kural kalıpları yalnız rule_* anahtarlarında.
// Yasak kalıplar: "kapalı: {N}" / "closed|blocked: {N}" (kural öneki + yer tutucu), "banı: her şey" (iki noktalı "her şey"),
// "port listesi ({N})", "yalnız {N} kapalı", "kapalı: her şey".
const fs = require('fs');
let src = fs.readFileSync(process.argv[2], 'utf8');
const tail = src.lastIndexOf('})();');
src = src.slice(0, tail) + 'globalThis.__D = DICT;\n' + src.slice(tail);
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'length' ? 0 : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
globalThis.window = { AG_BOOT: {}, addEventListener() {}, location: { search: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.document = { getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, createElement: el, body: el(), documentElement: el(), hidden: true };
globalThis.location = window.location; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = { language: 'tr' };
globalThis.fetch = () => new Promise(() => {});
globalThis.setInterval = () => 0; globalThis.setTimeout = () => 0; globalThis.clearTimeout = () => {};
new Function(src)();
const D = globalThis.__D;
const BAD = [
  /\bkapalı: \{\d\}/i, /\b(closed|blocked): \{\d\}/i, /banı: (her şey|everything)\b/i, /\bban: everything\b/i,
  /port listesi \(\{\d\}\)/, /port list \(\{\d\}\)/, /yalnız \{\d\} kapalı/, /only \{\d\} (blocked|closed)/i,
  /kapalı: her şey/, /(blocked|closed): everything/i,
  /· (her şey|everything)$/i, /yalnız port listesi\b/i, /port list only\b/i,
];
let n = 0;
for (const L of ['tr', 'en']) for (const [k, v] of Object.entries(D[L])) {
  if (/^rule_(svc|all|exc|none)$/.test(k) || typeof v !== 'string') continue;
  const b = BAD.find(r => r.test(v));
  if (b) { n++; console.log(`${L} ${k}: ${v}  [${b}]`); }
}
console.log(n ? `${n} eski kural kalıbı` : 'sözlükte eski kural kalıbı yok');
process.exit(n ? 1 : 0);
