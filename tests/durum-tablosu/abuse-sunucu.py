#!/usr/bin/env python3
# AbuseIPDB check uç taklidi (durum tablosu): cevaplar gerçek API'nin cevapları (2026-11-23, lin.ayzeta.net'te ölçüldü; 158.101.136.233).
#   python3 abuse-sunucu.py PORT_DOSYASI SAYAÇ_DOSYASI GEÇERLİ_ANAHTAR
# Geçerli anahtarla /check?ipAddress=… → 200 ve ölçülen data nesnesi (ipAddress istekteki); başka anahtarla → 401 ve ölçülen hata.
# Her istek SAYAÇ_DOSYASI'na bir satır ("ip anahtar_doğru_mu") yazar: önbelleğin istek göndermediği oradan sınanır.
import http.server, socketserver, sys, urllib.parse

OK = ('{"data":{"ipAddress":"%s","isPublic":true,"ipVersion":4,"isWhitelisted":false,"abuseConfidenceScore":100,"countryCode":"JP",'
      '"usageType":"Data Center\\/Web Hosting\\/Transit","isp":"Oracle Public Cloud","domain":"oracleemaildelivery.com","hostnames":[],'
      '"isTor":false,"totalReports":426,"numDistinctUsers":231,"lastReportedAt":"2026-11-23T17:56:20+00:00"}}')
ERR = ('{\n"errors": [\n{\n"detail": "Authentication failed. Your API key is either missing, incorrect, or revoked. Note: The APIv2 key differs '
       'from the APIv1 key.",\n"status": 401\n}\n]\n}')
PORTF, HITS, KEY = sys.argv[1], sys.argv[2], sys.argv[3]

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        ip = (q.get("ipAddress") or [""])[0]
        good = self.headers.get("Key") == KEY and self.headers.get("Accept") == "application/json"
        with open(HITS, "a") as f:
            f.write("%s %s\n" % (ip, "ok" if good else "bad"))
        body = (OK % ip if good else ERR).encode()
        self.send_response(200 if good else 401)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

srv = S(("127.0.0.1", 0), H)
open(PORTF, "w").write(str(srv.server_address[1]))
srv.serve_forever()
