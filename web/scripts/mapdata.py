#!/usr/bin/env python3
"""Build web/src/db/world.json — coastlines and land borders for the QSO map.

Source: Natural Earth (public domain), https://github.com/nvkelso/natural-earth-vector:
1:10m inside Europe (the VHF-contest area), 1:50m for the rest of the world.
Lines (coastline, boundary_lines_land), not country polygons, so each border is
stored once.

Output: {"coast": [...], "border": [...]}; each line is a flat integer list in
0.01° units, delta-encoded: [lon0, lat0, dlon1, dlat1, dlon2, dlat2, ...].

Usage: python3 web/scripts/mapdata.py [cache-dir]
(missing files are downloaded into the cache dir, default: a temp dir).
"""
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
OUT = Path(__file__).resolve().parent.parent / 'src' / 'db' / 'world.json'
EUROPE = (-32.0, 50.0, 27.0, 73.0)  # west, east, south, north — 1:10m inside
Q = 100  # 0.01° ≈ 1 km


def load(cache, name):
    path = cache / f'{name}.geojson'
    if not path.exists():
        with urllib.request.urlopen(BASE + path.name) as r:
            path.write_bytes(r.read())
    return json.loads(path.read_text(encoding='utf-8'))


def lines(geojson):
    for f in geojson['features']:
        g = f['geometry']
        if g['type'] == 'LineString':
            yield g['coordinates']
        elif g['type'] == 'MultiLineString':
            yield from g['coordinates']


def inside(x, y):
    w, e, s, n = EUROPE
    return w <= x <= e and s <= y <= n


def split(line, keep):
    """Parts of a line whose points pass keep(); a part keeps one point beyond each
    end so the 1:10m and 1:50m pieces meet at the box edge."""
    out, cur = [], []
    for i, (x, y) in enumerate(line):
        if keep(x, y):
            if not cur and i > 0:
                cur.append(line[i - 1])
            cur.append((x, y))
        elif cur:
            cur.append((x, y))
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [p for p in out if len(p) > 1]


def encode(line):
    pts = []
    for x, y in line:
        p = (round(x * Q), round(y * Q))
        if not pts or p != pts[-1]:
            pts.append(p)
    if len(pts) < 2:
        return None
    flat = [pts[0][0], pts[0][1]]
    for a, b in zip(pts, pts[1:]):
        flat += [b[0] - a[0], b[1] - a[1]]
    return flat


def layer(cache, kind):
    parts = []
    for line in lines(load(cache, f'ne_10m_{kind}')):
        parts += split(line, inside)
    for line in lines(load(cache, f'ne_50m_{kind}')):
        parts += split(line, lambda x, y: not inside(x, y))
    return [e for e in map(encode, parts) if e]


def main():
    cache = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp())
    data = {'coast': layer(cache, 'coastline'), 'border': layer(cache, 'admin_0_boundary_lines_land')}
    text = json.dumps(data, separators=(',', ':'))
    OUT.write_text(text + '\n', encoding='utf-8')
    points = sum(len(l) // 2 for k in data for l in data[k])
    print(f'{OUT}: {points} points, {len(text) // 1024} KB')


if __name__ == '__main__':
    main()
