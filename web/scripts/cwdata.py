#!/usr/bin/env python3
"""Publish the CW decoder's downloads: the DeepCW models (github.com/e04/deepcw-engine,
MIT) and the ONNX runtime's wasm, which the app fetches only when the decoder is turned
on. They stay out of web/dist, which the APK and the iOS bundle are built from.

Output (into --out), names as in src/core/cw/assets.json:
  model_narrow-<hash>.onnx, model-<hash>.onnx      checked against the pinned sha256
  ort-wasm-simd-threaded-<version>.wasm            from node_modules/onnxruntime-web
  LICENSE.txt                                      where the files come from

When the model source is down, the published copies (--mirror) are used; they are
checked against the same hashes.

Usage: python3 web/scripts/cwdata.py --out DIR [--mirror https://kqso.ok1cdj.com/cw/]
"""
import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
ASSETS = json.loads((WEB / 'src/core/cw/assets.json').read_text())
ORT = WEB / 'node_modules/onnxruntime-web'


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'kQSO cwdata'})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def model(spec, mirror):
    urls = [ASSETS['source'] + spec['source']] + ([mirror + spec['file']] if mirror else [])
    for url in urls:
        try:
            data = fetch(url)
        except OSError as e:
            print(f'{url}: {e}', file=sys.stderr)
            continue
        if hashlib.sha256(data).hexdigest() == spec['sha256']:
            return data
        print(f'{url}: sha256 mismatch', file=sys.stderr)
    sys.exit(f'{spec["file"]}: no source with the pinned hash')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--mirror', help='published cw/ to fall back on')
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    for spec in ASSETS['models'].values():
        (out / spec['file']).write_bytes(model(spec, args.mirror))
        print(f'{spec["file"]}: {spec["bytes"]} B')

    version = json.loads((ORT / 'package.json').read_text())['version']
    wasm = f'ort-wasm-simd-threaded-{version}.wasm'
    shutil.copyfile(ORT / 'dist/ort-wasm-simd-threaded.wasm', out / wasm)
    print(f'{wasm}: {(out / wasm).stat().st_size} B')

    (out / 'LICENSE.txt').write_text(
        'CW decoder files for kQSO, downloaded by the app when the decoder is turned on.\n\n'
        f'model*.onnx: DeepCW by e04, MIT License, {ASSETS["source"]}\n'
        f'{wasm}: ONNX Runtime Web {version}, Microsoft, MIT License, https://github.com/microsoft/onnxruntime\n'
    )


if __name__ == '__main__':
    main()
