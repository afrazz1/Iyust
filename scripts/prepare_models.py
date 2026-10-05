"""Prepare all GLBs for deployment; original uploads remain in Git history.

Runs inside the disposable GitHub Actions checkout. For a local model, use
resize_textures.py with separate input and output paths instead.
"""
import os
from pathlib import Path
import tempfile
from resize_textures import optimize


def main():
    for path in sorted((Path(__file__).resolve().parents[1] / 'models').rglob('*.glb')):
        original = path.read_bytes()
        result, report = optimize(original)
        if result != original:
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp:
                temporary = Path(temp.name)
                temp.write(result)
            try:
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
        print(f'{path.name}: {len(original)} -> {len(result)} bytes; '
              f'{sum(r["before"] != r["after"] for r in report)} textures resized')


if __name__ == '__main__':
    main()
