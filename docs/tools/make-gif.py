"""把 capture-frames.mjs 抓的 PNG 序列合成 GIF（Pillow）。

用法：python docs/tools/make-gif.py docs/frames docs/screenshots/demo.gif [宽度] [fps] [颜色数]
"""
import sys
from pathlib import Path

from PIL import Image

def main():
    if len(sys.argv) < 3:
        print('用法: python docs/tools/make-gif.py <frames_dir> <out.gif> [width] [fps]')
        return 2
    frames_dir = Path(sys.argv[1])
    out = Path(sys.argv[2])
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 720
    fps = int(sys.argv[4]) if len(sys.argv) > 4 else 14
    colors = int(sys.argv[5]) if len(sys.argv) > 5 else 64

    files = sorted(frames_dir.glob('frame-*.png'))
    if not files:
        print('没有帧：', frames_dir)
        return 1

    images = []
    for path in files:
        img = Image.open(path).convert('RGB')
        height = round(img.height * width / img.width)
        images.append(img.resize((width, height), Image.LANCZOS))

    # 统一调色板，避免逐帧自适应导致闪烁
    palette = images[len(images) // 2].quantize(colors=colors, method=Image.MEDIANCUT)
    frames = [img.quantize(palette=palette, dither=Image.NONE) for img in images]

    out.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / fps),
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f'WROTE {out} {len(frames)} frames {out.stat().st_size / 1024:.0f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
