#!/usr/bin/env python3
"""샘플 이미지를 타일 인덱스 지도로 역디코딩한다.

지금까지 조합을 눈으로 추측해서 여러 번 틀렸다. 샘플 이미지는 제작자가 의도한 조합의
유일한 근거이므로, 눈으로 대조하지 말고 픽셀을 맞춰서 어느 타일을 썼는지 알아낸다.

방법
1. 샘플이 몇 배로 확대돼 있는지 찾는다. 확대는 최근접 보간이라 s x s 블록이 모두 단색이면
   s 배 확대다. 그 배율로 되돌려 원본 해상도를 복원한다.
2. 시트의 모든 타일을 풀색 위에 합성해 바이트열 -> (시트, 인덱스) 사전을 만든다.
   샘플의 스프라이트는 풀 위에 얹혀 있으므로 이렇게 해야 맞는다.
3. 타일 격자의 시작 위치를 모르므로 16x16 안에서 모든 오프셋을 시도해 가장 많이 맞는
   위치를 고른다.
4. 맞은 칸은 인덱스로, 못 맞은 칸은 ? 로 지도를 출력한다. 두 스프라이트가 겹친 칸은
   합성 결과가 사전에 없으므로 ? 가 된다.

사용법:
    python3 tools/decode_sample.py assets/tiny_farm/Sample.png \\
        --sheet farm=public/tiles/farm.png --sheet town=public/tiles/town.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

TILE = 16
GRASS = (132, 198, 105, 255)


def detect_scale(image: Image.Image, candidates: tuple[int, ...] = (1, 2, 3, 4)) -> int:
    """확대 배율을 찾는다. s x s 블록이 거의 모두 단색인 가장 큰 s 를 고른다."""
    pixels = image.load()
    width, height = image.size
    best = 1
    for scale in candidates:
        if scale == 1:
            continue
        if width % scale or height % scale:
            continue
        uniform = 0
        total = 0
        # 전수 검사는 느리므로 격자로 표본을 뜬다.
        for y in range(0, height - scale + 1, scale * 7):
            for x in range(0, width - scale + 1, scale * 7):
                total += 1
                first = pixels[x, y]
                if all(
                    pixels[x + dx, y + dy] == first
                    for dy in range(scale)
                    for dx in range(scale)
                ):
                    uniform += 1
        if total and uniform / total > 0.97:
            best = scale
    return best


def downscale(image: Image.Image, scale: int) -> Image.Image:
    if scale == 1:
        return image
    width, height = image.size
    out = Image.new("RGBA", (width // scale, height // scale))
    source = image.load()
    target = out.load()
    for y in range(out.height):
        for x in range(out.width):
            target[x, y] = source[x * scale, y * scale]
    return out


def build_lookup(sheets: dict[str, Image.Image]) -> dict[bytes, str]:
    """풀색 위에 합성한 타일 바이트열 -> "시트:인덱스" 사전"""
    lookup: dict[bytes, str] = {}
    for name, sheet in sheets.items():
        cols = sheet.width // TILE
        rows = sheet.height // TILE
        for index in range(cols * rows):
            col = index % cols
            row = index // cols
            tile = sheet.crop((col * TILE, row * TILE, (col + 1) * TILE, (row + 1) * TILE))
            plate = Image.new("RGBA", (TILE, TILE), GRASS)
            plate.alpha_composite(tile)
            key = plate.convert("RGB").tobytes()
            # 같은 그림이 두 시트에 있으면 먼저 등록된 쪽을 남긴다.
            lookup.setdefault(key, f"{name}:{index}")
    return lookup


def score_offset(
    image: Image.Image, lookup: dict[bytes, str], offset_x: int, offset_y: int
) -> int:
    matched = 0
    for y in range(offset_y, image.height - TILE + 1, TILE):
        for x in range(offset_x, image.width - TILE + 1, TILE):
            block = image.crop((x, y, x + TILE, y + TILE)).convert("RGB").tobytes()
            if block in lookup:
                matched += 1
    return matched


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", type=Path)
    parser.add_argument(
        "--sheet",
        action="append",
        required=True,
        help="이름=경로 형식. 여러 번 줄 수 있다",
    )
    parser.add_argument("--out", type=Path, default=None, help="지도를 저장할 텍스트 파일")
    args = parser.parse_args()

    sheets: dict[str, Image.Image] = {}
    for spec in args.sheet:
        name, _, path = spec.partition("=")
        sheets[name] = Image.open(path).convert("RGBA")

    sample = Image.open(args.sample).convert("RGBA")
    scale = detect_scale(sample)
    print(f"샘플 {sample.size}, 감지된 확대 배율 = {scale}")
    base = downscale(sample, scale)
    print(f"복원 해상도 = {base.size} ({base.width / TILE:.1f} x {base.height / TILE:.1f} 타일)")

    lookup = build_lookup(sheets)
    print(f"사전 크기 = {len(lookup)} 개 타일")

    best = (0, 0, -1)
    for offset_y in range(TILE):
        for offset_x in range(TILE):
            matched = score_offset(base, lookup, offset_x, offset_y)
            if matched > best[2]:
                best = (offset_x, offset_y, matched)
    offset_x, offset_y, matched = best
    cols = (base.width - offset_x) // TILE
    rows = (base.height - offset_y) // TILE
    total = cols * rows
    print(f"격자 오프셋 = ({offset_x},{offset_y}), 일치 {matched}/{total} ({matched / total:.1%})")

    lines: list[str] = []
    for row in range(rows):
        cells: list[str] = []
        for col in range(cols):
            x = offset_x + col * TILE
            y = offset_y + row * TILE
            block = base.crop((x, y, x + TILE, y + TILE)).convert("RGB").tobytes()
            cells.append(lookup.get(block, "?"))
        lines.append(f"r{row:02d} " + " ".join(f"{cell:>9}" for cell in cells))

    header = "    " + " ".join(f"{f'c{col:02d}':>9}" for col in range(cols))
    text = "\n".join([header, *lines])
    print(text)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            f"sample={args.sample} scale={scale} offset=({offset_x},{offset_y}) "
            f"match={matched}/{total}\n{text}\n",
            encoding="utf-8",
        )
        print(f"\n저장: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
