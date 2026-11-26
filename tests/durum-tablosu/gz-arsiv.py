#!/usr/bin/env python3
# cPanel site günlüğü arşivi taklidi: her parça ayrı gzip üyesi, başlık sunucuda ölçülen biçimde (2026-11-26, lin):
# 1f 8b 08 00 <zaman damgası, 4 bayt LE> 00 03 — bayrak 0, sıkıştırma baytı 0, işletim sistemi 3 (Unix); zaman damgası parçanın
# yazıldığı an. Kullanım: gz-arsiv.py ÇIKIŞ ZAMAN:SATIR_DOSYASI [ZAMAN:SATIR_DOSYASI …]
# SATIR_DOSYASI "@sahte" ile biterse parça sıkıştırmasız (deflate saklı blok) yazılır ve içine sahte başlıklar eklenir: biri farklı
# bayrakla (1a), biri doğru imza ama ilk parçadan eski zaman damgasıyla — sıkıştırılmış veride rastgele çıkan adayların taklidi.
import struct, sys, zlib
out = open(sys.argv[1], 'wb')
for spec in sys.argv[2:]:
    mt, path = spec.split(':', 1)
    fake = path.endswith('@sahte')
    data = open(path[:-6] if fake else path, 'rb').read()
    if fake:
        # sahte başlıklar geçerli bir günlük satırının istek yolunda (ölçülen sağlayıcının dışındaki adres): düz metin yine günlük satırı
        ts = data.split(b'[', 1)[1].split(b']', 1)[0]
        data = data + b'198.51.100.200 - - [' + ts + b'] "GET /' + b'\x1f\x8b\x08\x1a\x40\x01\xf6\x77\x11\xfb' + b'/' + \
            b'\x1f\x8b\x08\x00' + struct.pack('<I', 1000) + b'\x00\x03' + b' HTTP/1.1" 404 0 "-" "x"\n'
        c = zlib.compressobj(0, zlib.DEFLATED, -15)
    else:
        c = zlib.compressobj(6, zlib.DEFLATED, -15)
    body = c.compress(data) + c.flush()
    out.write(b'\x1f\x8b\x08\x00' + struct.pack('<I', int(mt)) + b'\x00\x03' + body + struct.pack('<II', zlib.crc32(data) & 0xffffffff, len(data) & 0xffffffff))
out.close()
