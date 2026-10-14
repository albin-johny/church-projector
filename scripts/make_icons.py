#!/usr/bin/env python3
"""Generates the PWA icons (original design: a white "V" over a thin line on a dark tile).
No third-party libraries. Run:  python3 scripts/make_icons.py   -> writes icons/*.png
"""
import math, os, struct, zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
BG = (17, 18, 20)
FG = (245, 245, 245)
DIM = (150, 150, 150)
SS = 3  # supersampling per axis


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size, rounded):
    s = size
    # V: two strokes meeting at the bottom; thin bar beneath. Kept inside the 80% safe zone.
    top, bottom = 0.27 * s, 0.66 * s
    left, right, mid = 0.28 * s, 0.72 * s, 0.5 * s
    w = 0.085 * s
    bar_y, bar_l, bar_r, bar_w = 0.76 * s, 0.34 * s, 0.66 * s, 0.03 * s
    radius = 0.22 * s
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    inside = True
                    if rounded:
                        cx = min(max(px, radius), s - radius)
                        cy = min(max(py, radius), s - radius)
                        inside = math.hypot(px - cx, py - cy) <= radius
                    if not inside:
                        continue
                    col = BG
                    if (seg_dist(px, py, left, top, mid, bottom) <= w / 2 or
                            seg_dist(px, py, right, top, mid, bottom) <= w / 2):
                        col = FG
                    elif seg_dist(px, py, bar_l, bar_y, bar_r, bar_y) <= bar_w / 2:
                        col = DIM
                    r += col[0]; g += col[1]; b += col[2]; a += 255
            n = SS * SS
            row += bytes((r // n, g // n, b // n, a // n)) if a else b'\x00\x00\x00\x00'
        rows.append(bytes([0]) + bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    return png


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, size, rounded in [
        ('icon-192.png', 192, True),
        ('icon-512.png', 512, True),
        ('icon-maskable-512.png', 512, False),   # full-bleed; the OS applies its own mask
        ('apple-touch-icon.png', 180, False),    # iOS rounds the corners itself
    ]:
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(render(size, rounded))
        print('wrote', name)
