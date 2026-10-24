#!/usr/bin/env python3
"""Build the bundled VHF callsign set (src/db/vkv.tsv) from the public EDI logs
of the Czech VHF contests at https://vkvzavody.crk.cz/.

Every accepted log of every round that ended within --years is read. A log is
one sighting of each (call, locator, band) it worked, plus its own PCall at
PWWLo. A pair counts once it is seen in enough different logs (--min), which
drops the typos: 144 MHz (C) 5, 432 MHz (E) 3, the higher bands 2 by default. A station's
own log counts on its own: it was there on that band.

Steps (each page and log is kept in the cache dir, so a rerun only downloads
what is new):
  /                                                  rounds (id_round, end date)
  index.php?page=results&filter=ok&id_round=N        the round's log ids
  index.php?page=log_details&id_round=N&log=M        the log's file name
  logs_000NN/accepted/<file>.edi                     the log

Only PCall, PWWLo, PBand and the QSO records are read; the logs' headers carry
addresses and phone numbers, so the cache (kQSO/.cache/vkvdb by default) is
git-ignored.

Output: '# kQSO callsign DB | set=vkv | version=2 | updated=YYYYMMDD | ...',
then CALL<TAB>LOC<TAB>LAST<TAB>COUNT<TAB>QRV rows sorted by call. QRV are the
band letters (as in Tučňák) the call passed the threshold on, e.g. CEG.

Run about twice a year (it downloads thousands of logs), commit the TSV.

The server is slow and shared: requests are spaced by --delay and a run stops
after --budget requests, so the download goes in parts (rerun until nothing is
left; without --out it only downloads).

Usage: python3 web/scripts/vkvdb.py [--out web/src/db/vkv.tsv] [--budget N] [--limit N]
"""
import argparse
import re
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

BASE = 'https://vkvzavody.crk.cz/'
AGENT = 'kQSO-vkvdb (ok1cdj; https://kqso.ok1cdj.com)'

# PBand as the logs write it → band letter, the same as Tučňák's bandchar (its C_W
# file has them in the QRV column): C 144, E 432, G 1296, ... The app maps them
# to ADIF bands.
BANDS = {
    '50': 'A', '70': 'B', '144': 'C', '145': 'C', '432': 'E', '435': 'E',
    '1.3': 'G', '1296': 'G', '2.3': 'H', '2320': 'H', '3.4': 'I', '3400': 'I',
    '5.7': 'J', '5760': 'J', '10': 'K', '10368': 'K', '24': 'L', '24048': 'L',
    '47': 'M', '47088': 'M', '76': 'N', '76032': 'N', '120': 'O', '122': 'O',
    '134': 'P', '142': 'P', '241': 'Q', '248': 'Q',
}

CALL = re.compile(r'^(?=.*\d)[A-Z0-9]+(/[A-Z0-9]+)*$')
WWL = re.compile(r'^[A-R]{2}\d{2}[A-X]{2}$')


def band(pband):
    """'145 MHz', '1,3 GHz', '10 GHz', '1296' → band letter, or None."""
    m = re.match(r'\s*([\d.,]+)\s*(MHZ|GHZ)?', pband.upper())
    if not m:
        return None
    num = m.group(1).replace(',', '.')
    if m.group(2) != 'GHZ':
        return BANDS.get(num.split('.')[0])
    return BANDS.get(num.rstrip('0').rstrip('.') if '.' in num else num)


def decode(raw):
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return raw.decode('cp1250', errors='replace')


def parse_edi(text):
    """→ (pcall, pwwl, band, [(call, wwl, yyyymmdd)]). Dupes and bad fields are skipped."""
    head, qsos, section = {}, [], ''
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith('['):
            section = line[1:].split(';')[0].split(']')[0].upper()
            continue
        if section == 'QSORECORDS':
            f = line.split(';')
            if len(f) < 10:
                continue
            if len(f) > 14 and f[14].strip().upper() == 'D':
                continue
            call, wwl, d = f[2].strip().upper(), f[9].strip().upper(), f[0].strip()
            if CALL.match(call) and WWL.match(wwl) and re.match(r'^\d{6}$', d):
                qsos.append((call, wwl, '20' + d))
        elif '=' in line:
            k, _, v = line.partition('=')
            head[k.strip().upper()] = v.strip()
    return head.get('PCALL', '').upper(), head.get('PWWLO', '').upper(), band(head.get('PBAND', '')), qsos


def tally(logs):
    """logs: [(pcall, pwwl, band, qsos, end_yyyymmdd)] → {(call, wwl, band): [logs seen in, last, sent a log]}."""
    seen = defaultdict(lambda: [0, '', False])
    for pcall, pwwl, b, qsos, end in logs:
        if not b:
            continue
        pairs = {(c, w): d for c, w, d in qsos}
        if CALL.match(pcall) and WWL.match(pwwl):
            pairs[(pcall, pwwl)] = max(pairs.get((pcall, pwwl), ''), end)
        for (c, w), d in pairs.items():
            s = seen[(c, w, b)]
            s[0] += 1
            s[1] = max(s[1], d)
            s[2] = s[2] or c == pcall
    return seen


def build(seen, mins):
    """Keep the pairs over the threshold or from the call's own log; one entry per call → {call: (loc, last, count, bands)}."""
    per = defaultdict(list)
    for (c, w, b), (n, last, own) in seen.items():
        if own or n >= mins.get(b, mins['default']):
            per[c].append((w, b, n, last))
    out = {}
    for c, rows in per.items():
        loc_last, loc_n = defaultdict(str), defaultdict(int)
        for w, b, n, last in rows:
            loc_last[w] = max(loc_last[w], last)
            loc_n[w] += n
        loc = max(loc_last, key=lambda w: (loc_last[w], loc_n[w]))
        bands = sorted({b for _, b, _, _ in rows})
        out[c] = (loc, max(loc_last.values()), sum(n for _, _, n, _ in rows), bands)
    return out


def tsv(entries, header):
    rows = [f'{c}\t{loc}\t{last}\t{n}\t{"".join(b)}' for c, (loc, last, n, b) in sorted(entries.items())]
    return '\n'.join([header, *rows]) + '\n'


class Budget(Exception):
    """The run's --budget of requests is used up."""


class Site:
    def __init__(self, cache, delay, budget):
        self.cache, self.delay, self.budget = cache, delay, budget

    def get(self, path, fresh=False):
        """GET BASE+path, cached under its path. fresh: download again while the budget lasts.
        Raises Budget when out of requests and not cached."""
        f = self.file(path)
        if f.exists() and (not fresh or self.budget <= 0):
            return f.read_bytes()
        if self.budget <= 0:
            raise Budget
        self.budget -= 1
        time.sleep(self.delay)
        req = urllib.request.Request(BASE + path, headers={'User-Agent': AGENT})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        f.write_bytes(data)
        return data

    def file(self, path):
        return self.cache / re.sub(r'[^A-Za-z0-9._-]', '_', path or 'index')

    def rounds(self):
        """[(id, name, end date)], newest first. The front page is fetched fresh (new rounds appear)."""
        page = decode(self.get('', fresh=True))
        out = []
        for rid, label in re.findall(r"for='(\d+)_\d+_radio'>([^<]+:[^<]+)<", page):
            m = re.search(r'^(.*): .* - (\d+)\.(\d+)\.(\d{4})', label.strip())
            if m:
                out.append((int(rid), m.group(1), date(int(m.group(4)), int(m.group(3)), int(m.group(2)))))
        return out

    def log_ids(self, rid, end):
        """The round's log ids. Missing (still being evaluated) → []. A round that ended in the
        last 60 days is fetched again (more logs may come), and a page without logs isn't kept."""
        path = f'index.php?page=results&filter=ok&id_round={rid}'
        try:
            page = decode(self.get(path, fresh=(date.today() - end).days < 60))
        except OSError as e:
            print(f'  round {rid}: {e}', file=sys.stderr)
            return []
        ids = sorted({int(x) for x in re.findall(rf'page=log_details&id_round={rid}&log=(\d+)', page)})
        if not ids:
            self.file(path).unlink(missing_ok=True)
        return ids

    def edi(self, rid, lid):
        """The log's EDI text (via its details page), or None."""
        try:
            det = decode(self.get(f'index.php?page=log_details&id_round={rid}&log={lid}'))
            m = re.search(r"href='(logs_\d+/accepted/[^']+\.edi)'", det, re.I)
            return decode(self.get(m.group(1))) if m else None
        except OSError as e:
            print(f'  log {rid}/{lid}: {e}', file=sys.stderr)
            return None


def parse_mins(s):
    mins = {'default': 2}
    for part in s.split(','):
        k, _, v = part.partition('=')
        mins[k.strip()] = int(v)
    return mins


def selftest():
    a = 'PCall=OK1AAA\nPWWLo=JN79AA\nPBand=145 MHz\n[QSORecords;3]\n' \
        '260704;1429;OK1DT;1;59;001;59;004;;JN79AL;85;;N;N;\n' \
        '260704;1430;OK1DT;1;59;002;59;005;;JN79AL;85;;N;N;D\n' \
        '260704;1431;OK1XYZ;1;59;003;59;006;;JN79AL;85;;N;N;\n'
    p = parse_edi(a)
    assert p[:3] == ('OK1AAA', 'JN79AA', 'C') and len(p[3]) == 2, p
    assert band('1,3 GHz') == 'G' and band('435 MHz') == 'E' and band('10 GHz') == 'K'
    assert band('24 GHz') == 'L' and band('1296') == 'G' and band('120 GHz') == 'O' and band('99 GHz') is None
    b = 'PCall=OK2BBB\nPWWLo=JN89AA\nPBand=1,3 GHz\n[QSORecords;1]\n260705;0900;OK1DT;1;59;1;59;1;;JN79AL;1;;;;\n'
    logs = [(*parse_edi(a), '20260705')] * 5 + [(*parse_edi(b), '20260705')] * 2
    out = build(tally(logs), {'C': 5, 'default': 2})
    assert out['OK1DT'] == ('JN79AL', '20260705', 7, ['C', 'G']), out['OK1DT']
    assert 'OK1XYZ' in out and out['OK1AAA'][3] == ['C'] and out['OK2BBB'][3] == ['G']
    out = build(tally(logs[:4] + logs[5:]), {'C': 5, 'default': 2})
    assert out['OK1DT'][3] == ['G'] and 'OK1XYZ' not in out, out
    assert build(tally(logs[5:6]), {'default': 2})['OK2BBB'][3] == ['G']  # own log alone is enough
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', type=Path)
    ap.add_argument('--cache', type=Path, default=Path(__file__).resolve().parents[2] / '.cache' / 'vkvdb')
    ap.add_argument('--years', type=float, default=2)
    ap.add_argument('--rounds', help='comma separated round ids instead of --years')
    ap.add_argument('--delay', type=float, default=3, help='seconds between requests (the server is slow)')
    ap.add_argument('--budget', type=int, default=300, help='max requests this run; rerun to continue')
    ap.add_argument('--limit', type=int, help='at most this many logs per round')
    ap.add_argument('--min', default='C=5,E=3,default=2', help='logs needed per band letter')
    ap.add_argument('--selftest', action='store_true')
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    args.cache.mkdir(parents=True, exist_ok=True)
    site = Site(args.cache, args.delay, args.budget)
    rounds = site.rounds()
    if args.rounds:
        want = {int(x) for x in args.rounds.split(',')}
        rounds = [r for r in rounds if r[0] in want]
    else:
        since = date.today() - timedelta(days=round(args.years * 365.25))
        rounds = [r for r in rounds if since <= r[2] <= date.today()]
    logs, nrounds, missing = [], 0, 0
    for rid, name, end in rounds:
        try:
            ids = site.log_ids(rid, end)[: args.limit]
        except Budget:
            missing += 1
            continue
        have = 0
        for lid in ids:
            try:
                text = site.edi(rid, lid)
            except Budget:
                missing += 1
                continue
            if text:
                logs.append((*parse_edi(text), end.strftime('%Y%m%d')))
                have += 1
        print(f'{rid:4} {end} {name}: {have}/{len(ids)} logs', file=sys.stderr)
        nrounds += bool(have)
    if missing:
        print(f'budget used up, {missing} logs/rounds left — run again to continue', file=sys.stderr)
    if not args.out:
        return
    seen = tally(logs)
    entries = build(seen, parse_mins(args.min))
    header = (f'# kQSO callsign DB | set=vkv | version=2 | updated={date.today():%Y%m%d}'
              f' | source=vkvzavody.crk.cz | rounds={nrounds} | logs={len(logs)}')
    args.out.write_text(tsv(entries, header), encoding='utf-8')
    per_band = defaultdict(int)
    for _, _, _, bands in entries.values():
        for b in bands:
            per_band[b] += 1
    print(f'{nrounds} rounds, {len(logs)} logs, {sum(len(q) for *_, q, _ in logs)} QSOs, '
          f'{len({c for c, _, _ in seen})} calls seen, {len(entries)} kept', file=sys.stderr)
    print('  ' + ', '.join(f'{b} {n}' for b, n in sorted(per_band.items())), file=sys.stderr)


if __name__ == '__main__':
    main()
