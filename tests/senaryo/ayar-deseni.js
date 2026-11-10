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
// kiralık liste başına kip (CLOUD_MODES): panelin deseni + "svc::" ve geçersiz port aralığı reddi (motorun cfg_check'iyle aynı)
const cmLine = s.slice(s.indexOf('var cmSv'), s.indexOf('\n', s.indexOf('var cmSv')));
const cm = (() => { eval(cmLine); return { test: (x) => cmRe.test(x) && !/=svc::$/.test(x) }; })();
T.push([cm, 'aws=exc:web:', true], [cm, 'azure=svc:web,ssh:8080,30000-35000', true], [cm, 'gcp=all::', true], [cm, 'x-kendi--alt=svc::2222', true],
  [cm, 'aws=svc::443/udp', true], [cm, 'aws=exc:web:53/udp,30000-30100/udp,8080/tcp', true], [cm, 'aws=svc::443/xyz', false],
  [cm, 'aws=svc:smtp,mread:', true], [cm, 'aws=exc:web,ssh,ftp,cp,smtp,mread,min,sync,dns:', true],
  [cm, 'aws=svc::', false], [cm, 'aws=hepsi::', false], [cm, 'aws=svc:mout:', false], [cm, 'aws=svc:web:80:90', false]);
cm.source = 'CLOUD_MODES';
let f = 0;
// tek tanım bekçisi: panelin CLOUD_MODES servis kümesi ve sayısı motorun cfg_check'iyle aynı (1.15.71'e kadar panelde smtp/mread yoktu)
{ const mf = require('path').join(require('path').dirname(process.argv[2]), '../../csf_autogroup.sh'), ms = require('fs').readFileSync(mf, 'utf8');
  const mm = /CLOUD_MODES\)[^\n]*\n[^\n]*sv='(\([a-z|]+\))'[^\n]*\n[^\n]*\(,\$sv\)\{0,(\d+)\}/.exec(ms), pm = /var cmSv = '(\([a-z|]+\))'.*?\{0,(\d+)\}/.exec(cmLine);
  if (!mm || !pm || mm[1] !== pm[1] || mm[2] !== pm[2]) { f++; console.log('✗ CLOUD_MODES servis kümesi motor', mm && mm.slice(1), 'panel', pm && pm.slice(1)); } }
for (const [re, v, want] of T) { const ok = re.test(v); if (ok !== want) { f++; console.log('✗', re.source.slice(0, 40), v, '→', ok); } }
console.log(`düzenli ifade: ${T.length} örnek, ${f} beklenmeyen`);
