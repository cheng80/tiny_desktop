/**
 * 타일 그리기 원시 함수들.
 *
 * 좌표는 모두 논리 픽셀이고 정수로 맞춘다. 소수 좌표로 drawImage 를 호출하면
 * imageSmoothingEnabled 를 꺼도 경계에 반투명 줄이 생긴다.
 */

import { TILE_SIZE, type LoadedSheet } from "../assets/sheets";
import { NINE_SLICE_INSET } from "../assets/uiTiles";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 시트에서 타일 하나를 원본 크기로 그린다. */
export function drawTile(
  context: CanvasRenderingContext2D,
  sheet: LoadedSheet,
  index: number,
  x: number,
  y: number,
): void {
  const total = sheet.meta.cols * sheet.meta.rows;
  if (index < 0 || index >= total) {
    throw new Error(`타일 인덱스 범위 초과: ${index} (0..${total - 1})`);
  }
  const sx = (index % sheet.meta.cols) * TILE_SIZE;
  const sy = Math.floor(index / sheet.meta.cols) * TILE_SIZE;
  context.drawImage(
    sheet.image,
    sx,
    sy,
    TILE_SIZE,
    TILE_SIZE,
    Math.round(x),
    Math.round(y),
    TILE_SIZE,
    TILE_SIZE,
  );
}

/**
 * 좌우를 뒤집어 그린다. 정지 스프라이트 한 장에서 두 방향을 얻는 방법이다.
 * Kenney 팩에는 방향별 그림이 없어서 이게 없으면 동물이 늘 같은 쪽만 본다.
 */
export function drawTileFlipped(
  context: CanvasRenderingContext2D,
  sheet: LoadedSheet,
  index: number,
  x: number,
  y: number,
): void {
  const sx = (index % sheet.meta.cols) * TILE_SIZE;
  const sy = Math.floor(index / sheet.meta.cols) * TILE_SIZE;
  context.save();
  // 그릴 위치의 오른쪽 끝으로 원점을 옮긴 뒤 x 축을 뒤집는다.
  context.translate(Math.round(x) + TILE_SIZE, Math.round(y));
  context.scale(-1, 1);
  context.drawImage(sheet.image, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
  context.restore();
}

/** 타일의 일부 영역만 잘라 임의 크기로 늘려 그린다. 9-슬라이스 내부에서 쓴다. */
function drawTilePart(
  context: CanvasRenderingContext2D,
  sheet: LoadedSheet,
  index: number,
  part: Rect,
  dest: Rect,
): void {
  if (dest.width <= 0 || dest.height <= 0) {
    return;
  }
  const tileX = (index % sheet.meta.cols) * TILE_SIZE;
  const tileY = Math.floor(index / sheet.meta.cols) * TILE_SIZE;
  context.drawImage(
    sheet.image,
    tileX + part.x,
    tileY + part.y,
    part.width,
    part.height,
    Math.round(dest.x),
    Math.round(dest.y),
    Math.round(dest.width),
    Math.round(dest.height),
  );
}

/**
 * 16x16 패널 타일을 9-슬라이스로 늘려 임의 크기 패널을 만든다.
 * 모서리는 원본 크기를 유지하고 변과 중앙만 늘어난다.
 */
export function drawNineSlice(
  context: CanvasRenderingContext2D,
  sheet: LoadedSheet,
  index: number,
  rect: Rect,
  inset: number = NINE_SLICE_INSET,
): void {
  const minSize = inset * 2;
  if (rect.width < minSize || rect.height < minSize) {
    throw new Error(
      `9-슬라이스 최소 크기 미달: ${rect.width}x${rect.height}, 최소 ${minSize}x${minSize}`,
    );
  }

  const inner = TILE_SIZE - inset * 2;
  const midWidth = rect.width - inset * 2;
  const midHeight = rect.height - inset * 2;

  const columns = [
    { src: 0, srcSize: inset, dest: rect.x, destSize: inset },
    { src: inset, srcSize: inner, dest: rect.x + inset, destSize: midWidth },
    {
      src: TILE_SIZE - inset,
      srcSize: inset,
      dest: rect.x + rect.width - inset,
      destSize: inset,
    },
  ];
  const rows = [
    { src: 0, srcSize: inset, dest: rect.y, destSize: inset },
    { src: inset, srcSize: inner, dest: rect.y + inset, destSize: midHeight },
    {
      src: TILE_SIZE - inset,
      srcSize: inset,
      dest: rect.y + rect.height - inset,
      destSize: inset,
    },
  ];

  for (const row of rows) {
    for (const column of columns) {
      drawTilePart(
        context,
        sheet,
        index,
        { x: column.src, y: row.src, width: column.srcSize, height: row.srcSize },
        {
          x: column.dest,
          y: row.dest,
          width: column.destSize,
          height: row.destSize,
        },
      );
    }
  }
}

/**
 * 가로 3-슬라이스. 좌우 캡은 원본 폭을 유지하고 가운데만 늘어난다.
 * 높이는 타일 높이로 고정한다.
 */
export function drawThreeSliceHorizontal(
  context: CanvasRenderingContext2D,
  sheet: LoadedSheet,
  tiles: { left: number; middle: number; right: number },
  x: number,
  y: number,
  width: number,
  cap: number = 4,
): void {
  if (width < cap * 2) {
    throw new Error(`3-슬라이스 최소 폭 미달: ${width}, 최소 ${cap * 2}`);
  }
  const midWidth = width - cap * 2;

  drawTilePart(
    context,
    sheet,
    tiles.left,
    { x: 0, y: 0, width: cap, height: TILE_SIZE },
    { x, y, width: cap, height: TILE_SIZE },
  );
  drawTilePart(
    context,
    sheet,
    tiles.middle,
    { x: cap, y: 0, width: TILE_SIZE - cap * 2, height: TILE_SIZE },
    { x: x + cap, y, width: midWidth, height: TILE_SIZE },
  );
  drawTilePart(
    context,
    sheet,
    tiles.right,
    { x: TILE_SIZE - cap, y: 0, width: cap, height: TILE_SIZE },
    { x: x + cap + midWidth, y, width: cap, height: TILE_SIZE },
  );
}

/** 단색 사각형. 게이지 내부처럼 타일로 채우기 어려운 곳에 쓴다. */
export function fillRect(
  context: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
): void {
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  context.fillStyle = color;
  context.fillRect(
    Math.round(rect.x),
    Math.round(rect.y),
    Math.round(rect.width),
    Math.round(rect.height),
  );
}
