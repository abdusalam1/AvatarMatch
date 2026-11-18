"""打包发布：把仓库打成 dist/AvatarMatch-v<版本>.zip（排除运行时产物）。

用法：python docs/tools/pack-release.py [版本号]
"""
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

EXCLUDE_DIRS = {
    '.git', '.match-webview-profile', 'dist', 'docs/frames', 'docs/frames-tmp',
    '__pycache__', '.bridge-profile', 'node_modules', '.pytest_cache', '_notes',
}
EXCLUDE_SUFFIX = {'.pyc', '.log', '.mp4', '.zip', '.DS_Store'}
EXCLUDE_FILES = {'.bridge-room', 'avatar-cache.json'}


def should_skip(rel: Path) -> bool:
    posix = rel.as_posix()
    if posix.startswith('docs/frames/'):
        return True
    parts = rel.parts
    if any(part in EXCLUDE_DIRS for part in parts[:-1]):
        return True
    if rel.name in EXCLUDE_FILES or rel.name in EXCLUDE_DIRS:
        return True
    return rel.suffix.lower() in EXCLUDE_SUFFIX


def main():
    version = sys.argv[1] if len(sys.argv) > 1 else '1.0.0'
    name = f'AvatarMatch-v{version}'
    out_dir = ROOT / 'dist'
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f'{name}.zip'
    if out.exists():
        out.unlink()

    count = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted(ROOT.rglob('*')):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT)
            if should_skip(rel):
                continue
            zf.write(path, f'{name}/{rel.as_posix()}')
            count += 1

    size = out.stat().st_size / 1024 / 1024
    print(f'WROTE {out}  ({count} files, {size:.1f} MB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
