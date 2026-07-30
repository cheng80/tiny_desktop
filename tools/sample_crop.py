#!/usr/bin/env python3
"""샘플 이미지의 일부를 확대하고 16px 격자를 얹어 보여준다.

Kenney 팩의 Sample.png 는 제작자가 의도한 조합을 보여주는 유일한 근거다. 나무가 한 칸인지
두 칸인지, 헛간이 몇 칸인지, 울타리를 어떻게 잇는지를 여기서 읽는다. 타일을 낱개로 확대해
보는 것만으로는 조합 규칙을 알 수 없다.

격자를 얹는 이유는 어느 칸이 한 타일인지 세기 위함이다. 샘플이 16px 격자에 정렬돼 있다면
격자선이 타일 경계와 맞는다.

사용법:
    python3 tools/sample_crop.py assets/tiny_farm/Sample.png 330 20 170 220 \
        --scale 5 --out tmp/sample_barn.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

TILE = 16


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("x", type=int)
    parser.add_argument("y", type=int)
    parser.add_argument("width", type=int)
    parser.add_argument("height", type=int)
    parser.add_argument("--scale", type=int, default=5)
    parser.add_argument("--offset-x", type=int, default=0, help="격자 시작 보정")
    parser.add_argument("--offset-y", type=int, default=0)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGBA")
    box = (args.x, args.y, args.x + args.width, args.y + args.height)
    crop = image.crop(box)
    big = crop.resize((args.width * args.scale, args.height * args.scale), Image.NEAREST)

    draw = ImageDraw.Draw(big)
    # 격자선. 자른 위치 기준이 아니라 원본 좌표 기준으로 그려야 타일 경계와 맞는다.
    start_x = (-(args.x + args.offset_x)) % TILE
    start_y = (-(args.y + args.offset_y)) % TILE
    for step in range(start_x, args.width + 1, TILE):
        line = step * args.scale
        draw.line([(line, 0), (line, big.height)], fill=(255, 0, 128, 170))
    for step in range(start_y, args.height + 1, TILE):
        line = step * args.scale
        draw.line([(0, line), (big.width, line)], fill=(255, 0, 128, 170))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    big.save(args.out)
    print(f"{args.source} {box} -> {args.out} {big.size} grid_start=({start_x},{start_y})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
