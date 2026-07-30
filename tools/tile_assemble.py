#!/usr/bin/env python3
"""타일 인덱스 격자를 실제로 조립해 확대해서 보여준다.

조합 규칙은 타일을 낱개로 확대해 봐도 알 수 없다. 나무가 위아래 두 칸 한 쌍인지, 헛간이
몇 칸인지는 붙여봐야 안다. 샘플 이미지는 1:1 축척이 아니라 격자를 대조하기 어려우므로,
후보 조합을 직접 조립해 판정한다.

풀색 배경 위에 올린다. 스프라이트는 배경 위에서 어떻게 읽히는지가 중요하고, 어두운
배경에서는 테두리만 보여 판단을 잘못하게 된다.

여러 후보를 한 장에 나란히 놓을 수 있다. 후보는 `;` 로 행을 나누고 `,` 로 칸을 나눈다.
빈 칸은 `.` 로 둔다.

사용법:
    python3 tools/tile_assemble.py public/tiles/farm.png 12 \\
        --grid "93,94,95;105,106,107;117,118,119;129,130,131" \\
        --grid "90,91,92;102,103,104;114,115,116;126,127,128" \\
        --scale 6 --out tmp/asm_barn.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

TILE = 16
GRASS = (132, 198, 105, 255)


def parse_grid(spec: str) -> list[list[int | None]]:
    rows: list[list[int | None]] = []
    for row in spec.split(";"):
        cells: list[int | None] = []
        for cell in row.split(","):
            text = cell.strip()
            cells.append(None if text in {"", "."} else int(text))
        rows.append(cells)
    return rows


def crop_tile(sheet: Image.Image, cols: int, index: int) -> Image.Image:
    col = index % cols
    row = index // cols
    return sheet.crop((col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE))


def render(
    sheet: Image.Image,
    cols: int,
    grid: list[list[int | None]],
    scale: int,
    pad: int,
) -> Image.Image:
    grid_cols = max(len(row) for row in grid)
    grid_rows = len(grid)
    width = grid_cols * TILE + pad * 2
    height = grid_rows * TILE + pad * 2

    canvas = Image.new("RGBA", (width, height), GRASS)
    for row_index, row in enumerate(grid):
        for col_index, index in enumerate(row):
            if index is None:
                continue
            tile = crop_tile(sheet, cols, index)
            canvas.alpha_composite(tile, (pad + col_index * TILE, pad + row_index * TILE))

    return canvas.resize((width * scale, height * scale), Image.NEAREST)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sheet", type=Path)
    parser.add_argument("cols", type=int, help="시트 가로 타일 수")
    parser.add_argument("--grid", action="append", required=True, help="후보 조합")
    parser.add_argument("--label", action="append", default=None, help="후보 이름")
    parser.add_argument("--scale", type=int, default=6)
    parser.add_argument("--pad", type=int, default=1, help="조합 주변 풀 여백(타일 아님, 픽셀)")
    parser.add_argument(
        "--stack",
        action="store_true",
        help="여러 grid 를 나란히 놓지 않고 순서대로 겹쳐 그린다. 건물처럼 층이 있는 조합에 쓴다",
    )
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")

    if args.stack:
        # 뒤 층부터 순서대로 같은 캔버스에 겹친다. 지붕 아래로 벽이 비쳐 보이는 구조를 확인한다.
        grids = [parse_grid(spec) for spec in args.grid]
        grid_cols = max(len(row) for grid in grids for row in grid)
        grid_rows = max(len(grid) for grid in grids)
        merged: list[list[int | None]] = [[None] * grid_cols for _ in range(grid_rows)]
        panel = render(sheet, args.cols, merged, args.scale, args.pad)
        base = Image.new("RGBA", (panel.width, panel.height), (0, 0, 0, 0))
        base.alpha_composite(panel)
        for grid in grids:
            layer = render(sheet, args.cols, grid, args.scale, args.pad)
            # render 는 풀색 배경을 깔므로, 겹칠 때는 배경이 아래 층을 지운다.
            # 그래서 배경 없이 다시 조립한다.
            transparent = Image.new(
                "RGBA",
                (grid_cols * TILE + args.pad * 2, grid_rows * TILE + args.pad * 2),
                (0, 0, 0, 0),
            )
            for row_index, row in enumerate(grid):
                for col_index, index in enumerate(row):
                    if index is None:
                        continue
                    transparent.alpha_composite(
                        crop_tile(sheet, args.cols, index),
                        (args.pad + col_index * TILE, args.pad + row_index * TILE),
                    )
            base.alpha_composite(
                transparent.resize((layer.width, layer.height), Image.NEAREST)
            )
        panels = [base]
    else:
        panels = [
            render(sheet, args.cols, parse_grid(spec), args.scale, args.pad)
            for spec in args.grid
        ]

    gap = 24
    label_height = 14
    total_width = sum(panel.width for panel in panels) + gap * (len(panels) + 1)
    total_height = max(panel.height for panel in panels) + gap + label_height

    out = Image.new("RGBA", (total_width, total_height), (30, 33, 40, 255))
    draw = ImageDraw.Draw(out)

    cursor = gap
    for index, panel in enumerate(panels):
        out.alpha_composite(panel, (cursor, gap // 2))
        label = (
            args.label[index]
            if args.label and index < len(args.label)
            else args.grid[index][:40]
        )
        draw.text((cursor, panel.height + gap // 2 + 2), label, fill=(255, 220, 120, 255))
        cursor += panel.width + gap

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.out)
    print(f"{args.out} {out.size} 후보 {len(panels)}개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
