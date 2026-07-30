#!/usr/bin/env python3
"""아이콘의 둥근 배지 밖 여백을 투명하게 만든다.

생성된 아이콘은 둥근 사각형 배지 안에 그림이 있고 그 밖은 단색 크림색이다. 그대로 두면
macOS Dock 에서 네모난 크림 여백이 보인다. 네 모서리에서 플러드필을 시작해 배지의 어두운
테두리에 닿을 때까지만 지운다. 배지 안쪽 색은 건드리지 않는다.

색 비교에 허용 오차를 둔다. 생성된 이미지는 완전한 단색이 아니라 1~2 정도 흔들린다.

사용법:
    python3 tools/trim_icon_corners.py tmp/icon-source.png --out tmp/icon-trimmed.png
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image

DEFAULT_TOLERANCE = 26


def color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--tolerance", type=int, default=DEFAULT_TOLERANCE)
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGBA")
    width, height = image.size
    pixels = image.load()

    # 네 모서리 색을 배경으로 본다. 서로 다르면 배지가 모서리까지 차 있다는 뜻이라 중단한다.
    corners = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    corner_colors = [pixels[x, y][:3] for x, y in corners]
    reference = corner_colors[0]
    for color in corner_colors[1:]:
        if color_distance(reference, color) > args.tolerance:
            print(f"모서리 색이 서로 다르다({corner_colors}). 지우지 않고 그대로 복사한다")
            image.save(args.out)
            return 0

    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque(corners)
    for x, y in corners:
        visited[y * width + x] = 1

    cleared = 0
    while queue:
        x, y = queue.popleft()
        current = pixels[x, y]
        if color_distance(current[:3], reference) > args.tolerance:
            continue
        pixels[x, y] = (current[0], current[1], current[2], 0)
        cleared += 1

        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if nx < 0 or ny < 0 or nx >= width or ny >= height:
                continue
            index = ny * width + nx
            if visited[index]:
                continue
            visited[index] = 1
            queue.append((nx, ny))

    total = width * height
    print(f"배경 제거: {cleared}/{total} px ({cleared / total * 100:.1f}%)")
    if cleared == 0:
        print("경고: 지운 픽셀이 없다. 허용 오차를 올려보라")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.out)
    print(f"저장: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
