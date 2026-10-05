import importlib.util
import io
from pathlib import Path
import unittest
from PIL import Image

spec = importlib.util.spec_from_file_location('resize_textures', Path(__file__).parents[1] / 'scripts/resize_textures.py')
resize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resize)


def fixture(dimensions, kind='PNG'):
    binary, images, views = bytearray(), [], []
    for width, height in dimensions:
        buffer = io.BytesIO()
        Image.new('RGBA' if kind == 'PNG' else 'RGB', (width, height), (30, 80, 120, 128) if kind == 'PNG' else (30, 80, 120)).save(buffer, kind)
        content = buffer.getvalue()
        images.append({'bufferView': len(views), 'mimeType': 'image/png' if kind == 'PNG' else 'image/jpeg'})
        views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(content)})
        binary.extend(content); binary.extend(b'\0' * (-len(binary) % 4))
    geometry = b'geometry-draco-bytes-do-not-change'
    views.append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(geometry)})
    binary.extend(geometry)
    return resize.pack_glb({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(binary)}], 'bufferViews': views, 'images': images}, bytes(binary))


def view_bytes(document, binary, index):
    view = document['bufferViews'][index]
    start = view.get('byteOffset', 0)
    return binary[start:start + view['byteLength']]


class ResizeTests(unittest.TestCase):
    def test_limits_aspect_alpha_small_images_and_geometry(self):
        original = fixture([(4096, 2048), (64, 32), (2048, 2048), (1024, 4096)])
        result, report = resize.optimize(original)
        before, old_bin = resize.read_glb(original)
        after, new_bin = resize.read_glb(result)
        self.assertEqual([tuple(r['after']) for r in report], [(2048, 1024), (64, 32), (2048, 2048), (512, 2048)])
        for index in (1, 2, 4):
            self.assertEqual(view_bytes(before, old_bin, index), view_bytes(after, new_bin, index))
        with Image.open(io.BytesIO(view_bytes(after, new_bin, 0))) as image:
            self.assertEqual(image.mode, 'RGBA')
            self.assertEqual(image.getpixel((0, 0))[3], 128)
        self.assertTrue(all(v['byteOffset'] % 4 == 0 for v in after['bufferViews']))
        self.assertEqual(resize.optimize(result)[0], result)

    def test_small_file_is_byte_identical(self):
        original = fixture([(64, 64), (2048, 1024)], 'JPEG')
        self.assertEqual(resize.optimize(original)[0], original)

    def test_jpeg_preserves_geometry_alignment(self):
        original = fixture([(4096, 1024), (2048, 4096)], 'JPEG')
        result, _ = resize.optimize(original)
        before, old_bin = resize.read_glb(original)
        after, new_bin = resize.read_glb(result)
        self.assertTrue(all(v['byteOffset'] % 4 == 0 for v in after['bufferViews']))
        self.assertEqual(view_bytes(before, old_bin, 2), view_bytes(after, new_bin, 2))

    def test_bad_input_and_unsupported_format_fail_explicitly(self):
        with self.assertRaises(ValueError):
            resize.optimize(b'not a GLB')
        doc, binary = resize.read_glb(fixture([(32, 32)]))
        doc['images'][0]['mimeType'] = 'image/ktx2'
        with self.assertRaisesRegex(ValueError, 'KTX2'):
            resize.optimize(resize.pack_glb(doc, binary))


if __name__ == '__main__':
    unittest.main()
