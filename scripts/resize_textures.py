"""Resize embedded GLB textures without decoding/recompressing geometry.

Usage: python scripts/resize_textures.py input.glb output.glb [--max-size 2048]
Requires Pillow. JPEG, PNG and WebP are supported; small images stay byte-identical.
"""
import argparse
import io
import json
import os
from pathlib import Path
import struct
import tempfile

from PIL import Image


def read_glb(data):
    if len(data) < 20 or struct.unpack_from('<4sII', data) != (b'glTF', 2, len(data)):
        raise ValueError('Expected a complete glTF 2.0 GLB file')
    chunks, offset = [], 12
    while offset < len(data):
        length, kind = struct.unpack_from('<II', data, offset)
        offset += 8
        if length % 4 or offset + length > len(data):
            raise ValueError('Invalid GLB chunk')
        chunks.append((kind, data[offset:offset + length]))
        offset += length
    if [c[0] for c in chunks] != [0x4E4F534A, 0x004E4942]:
        raise ValueError('Expected JSON and BIN chunks only')
    document = json.loads(chunks[0][1])
    buffers = document.get('buffers', [])
    if len(buffers) != 1 or 'uri' in buffers[0]:
        raise ValueError('Use a GLB with one embedded buffer')
    if buffers[0]['byteLength'] > len(chunks[1][1]):
        raise ValueError('Incomplete binary buffer')
    return document, chunks[1][1][:buffers[0]['byteLength']]


def pack_glb(document, binary):
    doc = json.dumps(document, ensure_ascii=False, separators=(',', ':')).encode()
    doc += b' ' * (-len(doc) % 4)
    binary += b'\0' * (-len(binary) % 4)
    return (struct.pack('<4sII', b'glTF', 2, 28 + len(doc) + len(binary))
            + struct.pack('<II', len(doc), 0x4E4F534A) + doc
            + struct.pack('<II', len(binary), 0x004E4942) + binary)


def optimize(data, limit=2048):
    if limit < 1:
        raise ValueError('Maximum texture size must be positive')
    document, binary = read_glb(data)
    views = document.get('bufferViews', [])
    for view in views:
        if view.get('buffer') != 0 or view.get('byteOffset', 0) + view['byteLength'] > len(binary):
            raise ValueError('Invalid bufferView bounds')
    replacements, report = {}, []
    formats = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP'}
    for index, image in enumerate(document.get('images', [])):
        if 'bufferView' not in image or image.get('mimeType') not in {*formats, 'image/ktx2'}:
            raise ValueError(f'Image {index}: embed JPEG/PNG/WebP before optimizing; KTX2 needs a BasisU toolchain')
        view_index = image['bufferView']
        view = views[view_index]
        start, length = view.get('byteOffset', 0), view['byteLength']
        original = binary[start:start + length]
        if image['mimeType'] == 'image/ktx2':
            if len(original) < 28 or original[:12] != b'\xabKTX 20\xbb\r\n\x1a\n':
                raise ValueError('Invalid KTX2 header')
            width, height = struct.unpack_from('<II', original, 20)
            if max(width, height) > limit:
                raise ValueError(f'Image {index}: resize before KTX2/BasisU export (maximum {limit})')
            report.append({'image': index, 'before': (width, height), 'after': (width, height),
                           'bytes_before': length, 'bytes_after': length})
            continue
        with Image.open(io.BytesIO(original)) as texture:
            before = texture.size
            after = before
            if max(before) > limit:
                texture.thumbnail((limit, limit), Image.Resampling.LANCZOS)
                after = texture.size
                output = io.BytesIO()
                kind = formats[image['mimeType']]
                options = {'quality': 90, 'subsampling': 0} if kind == 'JPEG' else {'lossless': True} if kind == 'WEBP' else {}
                texture.save(output, kind, **options)
                replacements[view_index] = output.getvalue()
        report.append({'image': index, 'before': before, 'after': after,
                       'bytes_before': length, 'bytes_after': len(replacements.get(view_index, original))})
    if not replacements:
        return data, report

    # Replace only image ranges. Preserve all other BIN bytes, including Draco data.
    ranges = sorted((views[i].get('byteOffset', 0), views[i]['byteLength'], i, content)
                    for i, content in replacements.items())
    for start, length, index, _ in ranges:
        for other_index, view in enumerate(views):
            other_start = view.get('byteOffset', 0)
            if other_index != index and max(start, other_start) < min(start + length, other_start + view['byteLength']):
                raise ValueError('Overlapping image bufferViews are not supported')
    chunks, end, changes = [], 0, []
    for start, length, index, content in ranges:
        chunks.extend((binary[end:start], content, b'\0' * ((length - len(content)) % 4)))
        changes.append((start, length, len(content) + ((length - len(content)) % 4) - length, index))
        end = start + length
    chunks.append(binary[end:])
    updated = b''.join(chunks)

    def shifted(offset):
        return offset + sum(delta for start, length, delta, _ in changes if start + length <= offset)

    # Buffer-addressed extension payloads (e.g. meshopt) also need new offsets.
    def relocate_extensions(value):
        if isinstance(value, dict):
            if value.get('buffer') == 0 and 'byteOffset' in value:
                start, length = value['byteOffset'], value.get('byteLength', 0)
                if any(max(start, a) < min(start + length, a + n) for a, n, _, _ in changes):
                    raise ValueError('Extension payload overlaps an image')
                value['byteOffset'] = shifted(start)
            for child in value.values():
                relocate_extensions(child)
        elif isinstance(value, list):
            for child in value:
                relocate_extensions(child)

    for index, view in enumerate(views):
        relocate_extensions(view.get('extensions', {}))
        view['byteOffset'] = shifted(view.get('byteOffset', 0))
        if index in replacements:
            view['byteLength'] = len(replacements[index])
    document['buffers'][0]['byteLength'] = len(updated)
    return pack_glb(document, updated), report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--max-size', type=int, default=2048)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error('Use a different output path to keep the source model intact')
    try:
        source = args.source.read_bytes()
        result, report = optimize(source, args.max_size)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=args.output.parent, delete=False) as temp:
            temporary = Path(temp.name)
            temp.write(result)
        try:
            os.replace(temporary, args.output)
        finally:
            temporary.unlink(missing_ok=True)
        print(json.dumps({'before_bytes': len(source), 'after_bytes': len(result), 'textures': report}, indent=2))
    except (ValueError, OSError, KeyError, IndexError, struct.error) as error:
        parser.exit(1, f'Cannot optimize model: {error}\n')


if __name__ == '__main__':
    main()
