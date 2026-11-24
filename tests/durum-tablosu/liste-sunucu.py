#!/usr/bin/env python3
# CSF blok listesi kaynağı taklidi (durum tablosu, blok listesi yoklaması): DİZİN'deki dosyaları düz metin verir, olmayan dosya 404.
#   python3 liste-sunucu.py PORT_DOSYASI SAYAÇ_DOSYASI DİZİN
# Her istek SAYAÇ_DOSYASI'na yolunu yazar (yoklamanın günde bir indirdiği oradan sınanır). Dosya biçimleri 2026-11-24'te indirilen
# gerçek listelerden: Spamhaus "a.b.c.d/n ; SBLnnn" ve ";" yorumları (EDROP'un boş hâli yalnız yorum), düz IP satırları.
import http.server, socketserver, sys, os

PORTF, HITS, DIR = sys.argv[1], sys.argv[2], sys.argv[3]

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def do_GET(self):
        with open(HITS, "a") as f:
            f.write(self.path + "\n")
        p = os.path.join(DIR, os.path.basename(self.path.split("?")[0]))
        if not os.path.isfile(p):
            self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers(); return
        body = open(p, "rb").read()
        self.send_response(200); self.send_header("Content-Type", "text/plain"); self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

srv = S(("127.0.0.1", 0), H)
open(PORTF, "w").write(str(srv.server_address[1]))
srv.serve_forever()
