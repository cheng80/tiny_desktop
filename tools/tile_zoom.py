#!/usr/bin/env python3
"""특정 타일 인덱스만 크게 확대해 나란히 보여준다.

9-슬라이스 모서리 두께나 프로그레스바 조각 구성처럼 픽셀 단위로 확인해야 하는 것을
가늠할 때 쓴다. 격자선을 4px 간격으로 겹쳐 그려 모서리 위치를 셀 수 있게 한다.

사용법:
    python3 tools/tile_zoom.py public/tiles/ui.png 23 --indices 10 12 83 84 85 --out tmp/zoom.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

TILE_DEFAULT = 16


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path)
    parser.add_argument("cols", type=int, help="시트 가로 타일 수")
    parser.add_argument("--indices", type=int, nargs="+", required=True)
    parser.add_argument("--tile", type=int, default=TILE_DEFAULT)
    parser.add_argument("--scale", type=int, default=12)
    parser.add_argument("--grid", type=int, default=4, help="격자선 간격(원본 픽셀)")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    tile = args.tile
    scale = args.scale
    pad = 16
    label_h = 12
    cell = tile * scale

    width = len(args.indices) * (cell + pad) + pad
    height = cell + pad * 2 + label_h
    out = Image.new("RGBA", (width, height), (30, 33, 40, 255))
    draw = ImageDraw.Draw(out)

    for slot, index in enumerate(args.indices):
        col = index % args.cols
        row = index // args.cols
        box = (col * tile, row * tile, (col + 1) * tile, (row + 1) * tile)
        big = sheet.crop(box).resize((cell, cell), Image.NEAREST)
        x = pad + slot * (cell + pad)
        y = pad
        out.alpha_composite(big, (x, y))

        # 원본 픽셀 좌표를 셀 수 있도록 격자선을 얹는다.
        for step in range(0, tile + 1, args.grid):
            line = step * scale
            draw.line([(x + line, y), (x + line, y + cell)], fill=(255, 255, 255, 70))
            draw.line([(x, y + line), (x + cell, y + line)], fill=(255, 255, 255, 70))

        draw.text((x, y + cell + 2), f"idx {index}", fill=(255, 220, 120, 255))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.out)
    print(f"zoom={args.out} {out.size} indices={args.indices} grid={args.grid}px")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
