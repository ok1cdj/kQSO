#!/usr/bin/env python3
"""Build web/src/db/world110.json — country outlines for the QSO map.

Source: Natural Earth ne_110m_admin_0_countries (public domain),
https://github.com/nvkelso/natural-earth-vector. Output: a JSON array of rings,
each a flat [lon, lat, lon, lat, ...] rounded to 2 decimals (~1 km).

Usage: python3 web/scripts/mapdata.py [path/to/ne_110m_admin_0_countries.geojson]
(without an argument the file is downloaded).
"""
import json
import sys
import urllib.request
from pathlib import Path

URL = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/'
       'geojson/ne_110m_admin_0_countries.geojson')
OUT = Path(__file__).resolve().parent.parent / 'src' / 'db' / 'world110.json'


def load(argv):
    if len(argv) > 1:
        return json.loads(Path(argv[1]).read_text(encoding='utf-8'))
    with urllib.request.urlopen(URL) as r:
        return json.loads(r.read().decode('utf-8'))


def rings(geojson):
    for f in geojson['features']:
        g = f['geometry']
        polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for poly in polys:
            for ring in poly:
                flat = []
                for lon, lat in ring:
                    flat += [round(lon, 2), round(lat, 2)]
                yield flat


def main():
    out = list(rings(load(sys.argv)))
    text = json.dumps(out, separators=(',', ':'))
    OUT.write_text(text + '\n', encoding='utf-8')
    points = sum(len(r) // 2 for r in out)
    print(f'{OUT}: {len(out)} rings, {points} points, {len(text) // 1024} KB')


if __name__ == '__main__':
    main()
