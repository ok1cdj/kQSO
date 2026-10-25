#!/usr/bin/env python3
"""Build the offline reference tiles: SOTA, POTA, WWFF, GMA, TOTA and BOTA references
that are valid today, split by Maidenhead field (JO, JN, ...).

Sources (downloaded into the cache dir unless already there):
  SOTA  https://storage.sota.org.uk/summitslist.csv
  POTA  https://pota.app/all_parks_ext.csv
  WWFF  https://wwff.co/wwff-data/wwff_directory.csv
  GMA   https://www.gma.rocks/download/summits.csv
  TOTA  https://wwtota.com/apidata/get_rozhledny.php
  BOTA  https://api.wwbota.org/bunkers/?format=CSV

Output (into --out):
  <FIELD>.tsv   '# kQSO refs | field=JO | updated=YYYY-MM-DD', then
                KIND<TAB>REF<TAB>LAT<TAB>LON<TAB>NAME rows sorted by kind and ref
  index.json    {"updated": ..., "fields": {"JO": {"count": n, "bytes": n}}}
  LICENSE.txt   where the data comes from

The field comes from the coordinates, not from the locator a source gives.

Usage: python3 web/scripts/refdata.py --out DIR [--cache DIR]
"""
import argparse
import csv
import html
import io
import json
import re
import tempfile
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

SOURCES = {
    'sota': 'https://storage.sota.org.uk/summitslist.csv',
    'pota': 'https://pota.app/all_parks_ext.csv',
    'wwff': 'https://wwff.co/wwff-data/wwff_directory.csv',
    'gma': 'https://www.gma.rocks/download/summits.csv',
    'tota': 'https://wwtota.com/apidata/get_rozhledny.php',
    'bota': 'https://api.wwbota.org/bunkers/?format=CSV',
}
EXT = {'tota': 'json'}
NAME_MAX = 40

LICENSE = """\
kQSO offline references, rebuilt weekly from the programs' own lists.

SOTA  Summits on the Air, https://www.sota.org.uk/ (summitslist.csv)
POTA  Parks on the Air, https://pota.app/ (all_parks_ext.csv)
WWFF  World Wide Flora & Fauna, https://wwff.co/ (wwff_directory.csv)
GMA   GMA Outdoor Activities, DL0QW, https://www.gma.rocks/ (summits.csv)
TOTA  Towers on the Air, https://wwtota.com/
BOTA  Worldwide Bunkers on the Air (WWBOTA, OKBOTA), https://wwbota.net/

Only references valid on the date in each file are included; names are
shortened. The programs' lists are authoritative. Check them before an
activation, and check park boundaries (POTA, WWFF) on the spot.

The GMA references here are derived from the GMA list and are licensed,
like it, under CC BY-SA 2.0 DE: https://creativecommons.org/licenses/by-sa/2.0/de/

Any program that wants its data corrected or removed here: write to
ondra@ok1cdj.com and it will be done with the next weekly rebuild.
"""


def fetch(cache, kind):
    path = cache / f'{kind}.{EXT.get(kind, "csv")}'
    if not path.exists():
        req = urllib.request.Request(SOURCES[kind], headers={'User-Agent': 'kQSO refdata'})
        with urllib.request.urlopen(req, timeout=120) as r:
            path.write_bytes(r.read())
    return path.read_text(encoding='utf-8-sig')


def rows(text, skip=0):
    """CSV rows as dicts; skip drops title lines before the header."""
    f = io.StringIO(text, newline='')
    for _ in range(skip):
        f.readline()
    return csv.DictReader(f)


def day(s, fmt):
    """A date, or None for empty / placeholder values like 0000-00-00."""
    s = (s or '').strip()
    if not s or s.startswith('0000'):
        return None
    try:
        return datetime.strptime(s, fmt).date()
    except ValueError:
        return None


def valid(today, start, end):
    return (start is None or start <= today) and (end is None or today <= end)


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def sota(text, today):
    for r in rows(text, skip=1):
        if valid(today, day(r['ValidFrom'], '%d/%m/%Y'), day(r['ValidTo'], '%d/%m/%Y')):
            yield r['SummitCode'], r['Latitude'], r['Longitude'], r['SummitName']


def pota(text, today):
    for r in rows(text):
        if r['active'] == '1':
            yield r['reference'], r['latitude'], r['longitude'], r['name']


def wwff(text, today):
    for r in rows(text):
        if r['status'] == 'active' and valid(today, day(r['validFrom'], '%Y-%m-%d'), day(r['validTo'], '%Y-%m-%d')):
            yield r['reference'], r['latitude'], r['longitude'], r['name']


def gma(text, today):
    for r in rows(text, skip=1):
        if r['deleted'] == '0' and valid(today, day(r['valid from'], '%Y%m%d'), day(r['valid to'], '%Y%m%d')):
            yield r['Reference'], r['Latitude'], r['Longitude'], r['Name']


def tota(text, today):
    for r in json.loads(text):
        if valid(today, day(r.get('platna_od'), '%Y-%m-%d'), day(r.get('platna_do'), '%Y-%m-%d')):
            yield r['ref'], r['lat'], r['lon'], r['nazev']


def bota(text, today):
    # WWBOTA lists only current bunkers (Scheme,DXCC,Reference,Name,Type,Lat,Long,Locator).
    for r in rows(text):
        yield r['Reference'], r['Lat'], r['Long'], r['Name']


READERS = {'sota': sota, 'pota': pota, 'wwff': wwff, 'gma': gma, 'tota': tota, 'bota': bota}


def field(lat, lon):
    x = min(max(lon + 180, 0), 360 - 1e-9)
    y = min(max(lat + 90, 0), 180 - 1e-9)
    return chr(65 + int(x // 20)) + chr(65 + int(y // 10))


def unmojibake(s):
    """UTF-8 read as cp1252, maybe twice (GMA: 'Ð¥Ð°Ð½' for 'Хан', 'BarrosÃƒÂ£'). Kept only
    when it gives Latin, Greek, Cyrillic or punctuation (’ –): Sámi 'ášš' is valid UTF-8
    too, as Ogham, and Slovak 'Úš' as Arabic."""
    for _ in range(2):
        try:
            fixed = s.encode('cp1252').decode('utf-8')
        except UnicodeError:
            break
        if fixed == s or any(0x52F < ord(ch) < 0x2000 or ord(ch) > 0x20CF for ch in fixed):
            break
        s = fixed
    return s


def clean(s):
    s = unmojibake(html.unescape(s or '')).replace('\u00ad', '')
    s = ' '.join(re.sub(r'<[^<>]*(>|$)', ' ', s).split())  # GMA: 'Děvín <Devin>'
    return s if len(s) <= NAME_MAX else s[:NAME_MAX - 1].rstrip() + '…'


def mirror(base, out):
    """Copy the published tiles as they are (deploy, when a source is down)."""
    def get(name):
        req = urllib.request.Request(base + name, headers={'User-Agent': 'kQSO refdata'})
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()
    out.mkdir(parents=True, exist_ok=True)
    index = get('index.json')
    for f in json.loads(index)['fields']:
        (out / f'{f}.tsv').write_bytes(get(f'{f}.tsv'))
    (out / 'LICENSE.txt').write_bytes(get('LICENSE.txt'))
    (out / 'index.json').write_bytes(index)
    print(f'mirrored {len(json.loads(index)["fields"])} fields from {base} -> {out}')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', required=True, type=Path)
    ap.add_argument('--cache', type=Path)
    ap.add_argument('--mirror', metavar='URL', help='copy the tiles published at URL instead of building them')
    args = ap.parse_args()
    if args.mirror:
        return mirror(args.mirror, args.out)
    cache = args.cache or Path(tempfile.mkdtemp())
    cache.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)
    today = date.today()

    tiles = defaultdict(dict)  # field -> {(KIND, REF): row}
    counts, dropped = Counter(), Counter()
    for kind, read in READERS.items():
        for ref, lat, lon, name in read(fetch(cache, kind), today):
            lat, lon, ref = num(lat), num(lon), (ref or '').strip().upper()
            if not ref or lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180) \
                    or (lat == 0 and lon == 0):
                dropped[kind] += 1
                continue
            key = (kind.upper(), ref)
            tiles[field(lat, lon)][key] = f'{key[0]}\t{ref}\t{lat:.4f}\t{lon:.4f}\t{clean(name)}'
            counts[kind] += 1

    index = {'updated': today.isoformat(), 'fields': {}}
    for f in sorted(tiles):
        body = '\n'.join(tiles[f][k] for k in sorted(tiles[f]))
        data = f'# kQSO refs | field={f} | updated={today.isoformat()}\n{body}\n'.encode('utf-8')
        (args.out / f'{f}.tsv').write_bytes(data)
        index['fields'][f] = {'count': len(tiles[f]), 'bytes': len(data)}
    (args.out / 'index.json').write_text(json.dumps(index, separators=(',', ':')) + '\n', encoding='utf-8')
    (args.out / 'LICENSE.txt').write_text(LICENSE, encoding='utf-8')

    for kind in READERS:
        print(f'{kind.upper():5} {counts[kind]:7}  (dropped {dropped[kind]}: no coordinates)')
    total = sum(v['bytes'] for v in index['fields'].values())
    print(f'total {sum(counts.values())} refs, {len(tiles)} fields, {total // 1024} KB -> {args.out}')


if __name__ == '__main__':
    main()
