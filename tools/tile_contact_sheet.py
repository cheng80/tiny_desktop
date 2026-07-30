#!/usr/bin/env python3
"""타일시트를 슬라이스해서 인덱스 라벨이 붙은 컨택트 시트를 만든다.

타일 인덱스를 코드에 상수로 박기 전에 눈으로 확인하는 용도. 매핑을 바꿀 일이 생기면
이 스크립트를 다시 돌려 인덱스를 재검증한다.

사용법:
    python3 tools/tile_contact_sheet.py public/tiles/ui.png 23 7 --out tmp/ui_contact.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

TILE_DEFAULT = 16


def build_contact_sheet(
    sheet: Image.Image,
    *,
    tile: int,
    cols: int,
    rows: int,
    scale: int,
) -> Image.Image:
    pad = 12
    label_h = 10
    cell_w = tile * scale + pad
    cell_h = tile * scale + pad + label_h

    # 투명 영역을 구분하기 위해 어두운 배경 위에 합성한다.
    contact = Image.new("RGBA", (cols * cell_w, rows * cell_h), (40, 44, 52, 255))
    draw = ImageDraw.Draw(contact)

    for row in range(rows):
        for col in range(cols):
            index = row * cols + col
            box = (col * tile, row * tile, (col + 1) * tile, (row + 1) * tile)
            big = sheet.crop(box).resize((tile * scale, tile * scale), Image.NEAREST)
            x = col * cell_w + pad // 2
            y = row * cell_h + pad // 2
            contact.alpha_composite(big, (x, y))
            draw.text((x, y + tile * scale + 1), str(index), fill=(255, 220, 120, 255))

    return contact


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path, help="타일시트 PNG 경로 (간격 없는 packed 버전)")
    parser.add_argument("cols", type=int, help="가로 타일 수")
    parser.add_argument("rows", type=int, help="세로 타일 수")
    parser.add_argument("--tile", type=int, default=TILE_DEFAULT, help="타일 한 변 픽셀")
    parser.add_argument("--scale", type=int, default=4, help="확대 배율")
    parser.add_argument("--out", type=Path, required=True, help="출력 PNG 경로")
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    expected = (args.cols * args.tile, args.rows * args.tile)
    if sheet.size != expected:
        print(f"경고: 시트 크기 {sheet.size} 가 예상 {expected} 와 다르다")

    contact = build_contact_sheet(
        sheet, tile=args.tile, cols=args.cols, rows=args.rows, scale=args.scale
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    contact.save(args.out)
    print(f"sheet={args.sheet} {sheet.size} -> contact={args.out} {contact.size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
