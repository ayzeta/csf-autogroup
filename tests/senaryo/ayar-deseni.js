// Panelin ayar doğrulaması (ag.js cfgErrors): kaynak satırlarının isteğe bağlı süzgeç ve sayfa bağlantısı alanları. Bir kez kaçış
// katmanı yüzünden "\|" yazılmış ve süzgeçli her satır reddedilmişti. Kullanım: node ayar-deseni.js whm/assets/ag.js
const s = require('fs').readFileSync(process.argv[2], 'utf8');
const pick = (start) => { const i = s.indexOf(start); const j = s.indexOf('.test(x)', i); return eval(s.slice(i + 'return !'.length, j)); };
const clx = pick('return !/^[a-z0-9-]{1,60}\\|https:');
const svx = pick('return !/^[A-Za-z0-9._-]{1,60}\\|(https:');
const url = pick('return !/^[a-z0-9-]{1,40}\\|https:');
const T = [
  [clx, 'hetzner|https://ornek.com/liste.txt', true],
  [clx, 'aws2--eu|https://ip-ranges.amazonaws.com/ip-ranges.json|j:service=EC2&region=eu-north-1', true],
  [clx, 'az|https://www.microsoft.com/en-us/download/details.aspx?id=56519|j:name=AzureCloud|download.microsoft.com/*ServiceTags_Public_*.json', true],
  [clx, 'x|https://a.com/b|-|download.microsoft.com/*.json', true],
  [clx, 'x|https://a.com/b|j:a=b|a]b', false],
  [svx, 'ofis|203.0.113.10', true],
  [svx, 'do|https://digitalocean.com/geo/google.csv|t:%2CUS%2C', true],
  [svx, 'ofis|203.0.113.10|j:a=b', false],
  [url, 'aws|https://ip-ranges.amazonaws.com/ip-ranges.json|j:service=EC2', true],
  [url, 'azure|https://www.microsoft.com/en-us/download/details.aspx?id=56519|-|-', true],
];
let f = 0; for (const [re, v, want] of T) { const ok = re.test(v); if (ok !== want) { f++; console.log('✗', re.source.slice(0, 40), v, '→', ok); } }
console.log(`düzenli ifade: ${T.length} örnek, ${f} beklenmeyen`);
