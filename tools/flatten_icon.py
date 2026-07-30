#!/usr/bin/env python3
"""알파가 없는 아이콘 사본을 만든다.

왜 필요한가: macOS 앱 번들 아이콘은 투명한 모서리를 갖는 게 정상이다(둥근 모서리를
개발자가 직접 그린다). 반면 App Store 에 올리는 1024x1024 마케팅 아이콘은 알파 채널이
있으면 반려된다. 그래서 같은 그림의 불투명 사본을 따로 둔다.

투명한 부분은 그림 안에서 가장 많이 쓰인 밝은 배경색으로 채운다. 임의의 흰색으로 채우면
배지 테두리 밖에 흰 테가 생겨 어색하다.

사용법:
    python3 tools/flatten_icon.py assets/app-icon.png --out assets/app-icon-opaque.png
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from PIL import Image


def pick_fill(image: Image.Image) -> tuple[int, int, int]:
    """불투명 픽셀 중 가장 밝은 쪽의 최빈색을 고른다. 배지 바탕색이 잡힌다."""
    counter: Counter[tuple[int, int, int]] = Counter()
    for r, g, b, a in image.getdata():
        if a < 250:
            continue
        # 밝은 색만 후보로 둔다. 그림의 주요 색(빨강 헛간, 초록 지붕)이 뽑히면 안 된다.
        if r + g + b < 600:
            continue
        counter[(r, g, b)] += 1
    if not counter:
        return (255, 255, 255)
    return counter.most_common(1)[0][0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--fill",
        default=None,
        help="채울 색을 #rrggbb 로 직접 지정한다. 생략하면 그림에서 고른다",
    )
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGBA")

    if args.fill:
        raw = args.fill.lstrip("#")
        fill = (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16))
    else:
        fill = pick_fill(image)
    print(f"채울 색: #{fill[0]:02x}{fill[1]:02x}{fill[2]:02x}")

    flat = Image.new("RGB", image.size, fill)
    flat.paste(image, (0, 0), image)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    flat.save(args.out)
    print(f"저장: {args.out} ({flat.mode}, 알파 없음)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
