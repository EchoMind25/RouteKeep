#!/usr/bin/env python3
"""PWA icons (FR-TEC-01) drawn from the placeholder mark in app/icon.svg.

Standard library only: shapes are rasterized with 4x4 supersampling and
written as PNG with zlib. Rerun after the brand stage changes the mark:

    python3 scripts/design/app-icons.py
"""
import struct
import zlib
from pathlib import Path

ACCENT = (0xA8, 0x40, 0x1A)
CREAM = (0xFF, 0xFA, 0xF7)
OUT = Path(__file__).resolve().parents[2] / "public" / "icons"


def coverage(px, py, size, shape):
    """Fraction of a pixel inside `shape`, sampled 4x4."""
    hits = 0
    for sy in range(4):
        for sx in range(4):
            if shape((px + (sx + 0.5) / 4) / size, (py + (sy + 0.5) / 4) / size):
                hits += 1
    return hits / 16


def rounded_square(radius):
    def inside(x, y):
        cx = min(max(x, radius), 1 - radius)
        cy = min(max(y, radius), 1 - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
    return inside


def circle(r):
    return lambda x, y: (x - 0.5) ** 2 + (y - 0.5) ** 2 <= r ** 2


def render(size, maskable):
    # Maskable icons fill the canvas; the safe zone is the middle 80%.
    bg = (lambda x, y: True) if maskable else rounded_square(7 / 32)
    dot = circle((6 / 32) * (0.8 if maskable else 1))
    rows = []
    for y in range(size):
        row = bytearray([0])  # filter: none
        for x in range(size):
            a = coverage(x, y, size, bg)
            d = coverage(x, y, size, dot)
            rgb = [round(ACCENT[i] * (1 - d) + CREAM[i] * d) for i in range(3)]
            row += bytes(rgb + [round(255 * a)])
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, maskable in [("icon-192.png", 192, False), ("icon-512.png", 512, False), ("maskable-512.png", 512, True), ("apple-touch-icon.png", 180, True)]:
        (OUT / name).write_bytes(render(size, maskable))
        print(f"wrote public/icons/{name}")


if __name__ == "__main__":
    main()
