"""Pack MagicaVoxel .vox files into one compact JSON the office viewer loads: for each model its size, the colours it
uses and its voxels (x, y, z, colour index) as base64. Only the first model of each file is kept, with its palette;
materials, transforms and cameras are dropped. Standard library only.

    python vox_bundle.py SOURCE_DIR OUT.json [--skip PATTERN ...]

The model name is its path under SOURCE_DIR without the extension, with forward slashes."""
import argparse
import base64
import json
import struct
from pathlib import Path


def read_vox(data):
    """(size, [(x, y, z, colour index)], palette of 256 '#rrggbb') of the first model; MagicaVoxel's z is up"""
    if data[:4] != b'VOX ':
        raise ValueError('not a .vox file')
    size, voxels, palette = None, None, None
    i = 20                                              # 'VOX ' + version, then the MAIN chunk header; children follow
    while i + 12 <= len(data):
        cid = data[i:i + 4]
        n, m = struct.unpack('<ii', data[i + 4:i + 12])
        body = data[i + 12:i + 12 + n]
        if cid == b'SIZE' and size is None:
            size = struct.unpack('<iii', body[:12])
        elif cid == b'XYZI' and voxels is None:
            count = struct.unpack('<i', body[:4])[0]
            voxels = [tuple(body[4 + 4 * k:8 + 4 * k]) for k in range(count)]
        elif cid == b'RGBA':
            palette = ['#%02x%02x%02x' % tuple(body[4 * k:4 * k + 3]) for k in range(256)]
        i += 12 + n + m
    if size is None or voxels is None:
        raise ValueError('no model in the file')
    return size, voxels, palette or ['#9e9e9e'] * 256


def pack(size, voxels, palette):
    used = sorted({c for *_, c in voxels})
    index = {c: k for k, c in enumerate(used)}
    raw = bytes(b for x, y, z, c in voxels for b in (x, y, z, index[c]))
    return {'s': list(size), 'p': [palette[c - 1] for c in used], 'v': base64.b64encode(raw).decode('ascii')}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('source')
    ap.add_argument('out')
    ap.add_argument('--skip', nargs='*', default=[], help='skip files whose path contains any of these')
    a = ap.parse_args()
    src = Path(a.source)
    models = {}
    for p in sorted(src.rglob('*.vox')):
        rel = p.relative_to(src).with_suffix('').as_posix()
        if any(s in rel for s in a.skip):
            continue
        models[rel] = pack(*read_vox(p.read_bytes()))
    Path(a.out).write_text(json.dumps(models, separators=(',', ':')), encoding='utf-8')
    print(f'{len(models)} models -> {a.out} ({Path(a.out).stat().st_size // 1024} KB)')


def _prova():
    """a two-voxel model survives the round trip"""
    pal = b''.join(bytes([k, k, k, 255]) for k in range(256))
    chunk = lambda cid, body: cid + struct.pack('<ii', len(body), 0) + body
    kids = chunk(b'SIZE', struct.pack('<iii', 2, 1, 1)) + chunk(b'XYZI', struct.pack('<i', 2) + bytes([0, 0, 0, 5, 1, 0, 0, 9])) + chunk(b'RGBA', pal)
    data = b'VOX ' + struct.pack('<i', 150) + b'MAIN' + struct.pack('<ii', 0, len(kids)) + kids
    size, vox, palette = read_vox(data)
    assert size == (2, 1, 1) and vox == [(0, 0, 0, 5), (1, 0, 0, 9)] and palette[4] == '#040404'
    m = pack(size, vox, palette)
    assert m['p'] == ['#040404', '#080808'] and base64.b64decode(m['v']) == bytes([0, 0, 0, 0, 1, 0, 0, 1])


if __name__ == '__main__':
    _prova()
    main()
