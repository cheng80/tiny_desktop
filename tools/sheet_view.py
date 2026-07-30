#!/usr/bin/env python3
"""타일시트를 여백 없이 확대하고 격자와 인덱스를 얹어 보여준다.

이게 조합 규칙을 읽는 가장 확실한 방법이다. Kenney 시트는 여러 칸으로 이뤄진 물건을
시트 안에서도 붙여서 배치한다. 나무는 위아래로, 건물은 사각 블록으로 모여 있다. 그래서
여백 없이 그대로 확대하면 어느 칸들이 한 물건인지 눈에 보인다.

낱개로 떼어 확대하는 컨택트 시트로는 이걸 알 수 없어서, 나무를 반쪽만 쓰고 헛간을 잘못
쌓는 실수를 반복했다.

사용법:
    python3 tools/sheet_view.py public/tiles/farm.png 12 --scale 6 --out tmp/sheet_farm.png
    python3 tools/sheet_view.py public/tiles/farm.png 12 --region 6 7 6 4 --scale 12 \\
        --out tmp/sheet_barn.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

TILE = 16
GRASS = (132, 198, 105, 255)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path)
    parser.add_argument("cols", type=int, help="시트 가로 타일 수")
    parser.add_argument(
        "--region",
        type=int,
        nargs=4,
        metavar=("COL", "ROW", "COLS", "ROWS"),
        default=None,
        help="시트의 일부만 본다",
    )
    parser.add_argument("--scale", type=int, default=6)
    parser.add_argument("--no-grid", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    sheet_cols = args.cols
    sheet_rows = sheet.height // TILE

    if args.region:
        col, row, cols, rows = args.region
    else:
        col, row, cols, rows = 0, 0, sheet_cols, sheet_rows

    # 풀색을 깔아야 투명 부분이 실제 화면처럼 보인다. 어두운 배경에서는 테두리만 도드라진다.
    plate = Image.new("RGBA", (cols * TILE, rows * TILE), GRASS)
    plate.alpha_composite(
        sheet.crop((col * TILE, row * TILE, (col + cols) * TILE, (row + rows) * TILE))
    )

    label_height = 12 if not args.no_grid else 0
    big = plate.resize((cols * TILE * args.scale, rows * TILE * args.scale), Image.NEAREST)
    out = Image.new("RGBA", (big.width, big.height + label_height), (30, 33, 40, 255))
    out.alpha_composite(big, (0, 0))
    draw = ImageDraw.Draw(out)

    if not args.no_grid:
        step = TILE * args.scale
        for index in range(cols + 1):
            x = index * step
            draw.line([(x, 0), (x, big.height)], fill=(255, 0, 128, 120))
        for index in range(rows + 1):
            y = index * step
            draw.line([(0, y), (big.width, y)], fill=(255, 0, 128, 120))
        # 각 칸에 인덱스를 적는다. 조합을 코드로 옮길 때 바로 쓴다.
        for r in range(rows):
            for c in range(cols):
                index = (row + r) * sheet_cols + (col + c)
                draw.text(
                    (c * step + 2, r * step + 2),
                    str(index),
                    fill=(20, 20, 20, 255),
                )
                draw.text(
                    (c * step + 3, r * step + 3),
                    str(index),
                    fill=(255, 240, 160, 255),
                )
        draw.text(
            (2, big.height + 1),
            f"{args.sheet.name} region col={col} row={row} {cols}x{rows}",
            fill=(255, 220, 120, 255),
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.out)
    print(f"{args.out} {out.size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
