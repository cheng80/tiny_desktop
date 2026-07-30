/**
 * 정적 전경. 풀, 흙, 숲, 헛간, 울타리, 소품.
 *
 * 조합 규칙은 전부 시트 자체에서 읽었다(tools/sheet_view.py). Kenney 시트는 여러 칸으로
 * 이뤄진 물건을 시트 안에서도 붙여서 배치한다. 나무는 위아래로, 건물은 사각 블록으로,
 * 여물통은 좌우로 모여 있다. 여백 없이 확대해 보면 어느 칸들이 한 물건인지 그대로 보인다.
 *
 * 낱개로 떼어 확대해 보는 것만으로는 이걸 알 수 없어서 같은 실수를 여러 번 했다.
 * - 나무를 아랫부분만 놓아 수관이 잘려 있었다
 * - 헛간 벽 줄 순서를 뒤섞고 지붕을 얇게 깎아 건물로 보이지 않았다
 * - 울타리 위아래 모서리에 같은 조각을 써서 세로변이 끊겼다
 * - 정체를 모르는 타일을 장식으로 써서 지붕 조각이 풀밭에 떨어져 있었다
 *
 * 그래서 지금은 시트 문맥에서 정체를 확인한 타일만 쓴다.
 *
 * 배치는 손으로 짰고 샘플 이미지의 구성을 따랐다. 왼쪽 위에 헛간과 앞마당, 오른쪽 위에
 * 울타리로 둘러싼 목초지, 가운데 아래에 이랑이 붙은 밭 두 덩이, 바깥을 숲이 두른다.
 */

import {
  BARN,
  BARN_SIZE,
  BARN_WALL_OFFSET,
  DECOR,
  TREE_PAIRS,
  WIDE_PROPS,
  YARD_PROPS,
} from "../assets/farmTiles";
import { type SheetRegistry } from "../assets/sheets";
import {
  FENCE,
  FLORA,
  GROUND,
  PROPS,
  TREE_PAIRS as TOWN_TREE_PAIRS,
} from "../assets/townTiles";
import { drawTile } from "./draw";
import {
  BARN_AT,
  DIRT_RECTS,
  PEN,
  SCENE_COLS,
  SCENE_ROWS,
  sceneX,
  sceneY,
} from "./layout";
import { wind } from "./motion";

type SheetName = "farm" | "town";

interface Placement {
  readonly sheet: SheetName;
  readonly tile: number;
  readonly col: number;
  readonly row: number;
  /** 바람에 흔들리는지 */
  readonly sways?: boolean;
}

/** 위아래 두 칸이 한 쌍인 나무. 지정한 칸과 그 아래 칸을 차지한다 */
interface TreePlacement {
  readonly sheet: SheetName;
  readonly top: number;
  readonly bottom: number;
}

/** 좌우 두 칸이 한 쌍인 물건 */
interface WidePlacement {
  readonly sheet: SheetName;
  readonly tiles: readonly number[];
  readonly col: number;
  readonly row: number;
}

/**
 * 흙 3x3 오토타일. 바깥 잔디와 닿는 변에 맞는 조각을 고른다.
 * 중앙 25 는 시트에서 완전 단색으로 확인된 순수 흙이다.
 */
const DIRT_TILES: readonly (readonly number[])[] = [
  [12, 13, 14],
  [24, 25, 26],
  [36, 37, 38],
];

/** 숲에 섞어 쓰는 나무 쌍. 종류를 섞어야 벽지처럼 보이지 않는다 */
const TREE_POOL: readonly TreePlacement[] = [
  { sheet: "farm", ...TREE_PAIRS.pine },
  { sheet: "town", ...TOWN_TREE_PAIRS.green },
  { sheet: "farm", ...TREE_PAIRS.pine },
  { sheet: "town", ...TOWN_TREE_PAIRS.autumn },
  { sheet: "farm", ...TREE_PAIRS.pine },
];

/**
 * 나무 쌍을 놓을 자리. 각 칸과 그 아래 칸을 함께 차지한다.
 *
 * 위쪽 두 줄이 숲 테두리다. 헛간이 0행부터 서므로 헛간 열(1~3)은 비운다.
 */
const TREE_ANCHORS: readonly { col: number; row: number }[] = [
  // 위쪽 숲 테두리
  { col: 0, row: 0 },
  { col: 4, row: 0 },
  { col: 5, row: 0 },
  { col: 6, row: 0 },
  { col: 7, row: 0 },
  { col: 8, row: 0 },
  { col: 9, row: 0 },
  { col: 10, row: 0 },
  { col: 11, row: 0 },
  { col: 12, row: 0 },
  { col: 13, row: 0 },
  { col: 14, row: 0 },
  { col: 15, row: 0 },
  { col: 16, row: 0 },
  // 왼쪽 기둥
  { col: 0, row: 2 },
  { col: 0, row: 4 },
  { col: 0, row: 9 },
  // 오른쪽 기둥
  { col: 16, row: 2 },
  { col: 16, row: 4 },
  { col: 16, row: 6 },
  { col: 16, row: 9 },
  { col: 15, row: 2 },
];

/** 마른 나무. 종류를 섞어 숲이 단조롭지 않게 한다 */
const DEAD_TREE_ANCHORS: readonly { col: number; row: number; pair: keyof typeof TREE_PAIRS }[] = [
  { col: 5, row: 2, pair: "deadTall" },
  { col: 15, row: 8, pair: "deadShort" },
];

/**
 * 좌우 두 칸 물건. 목초지 안에 물이 담긴 여물통을 놓는다.
 * 한 칸짜리 물통(72/73)도 있지만 두 칸짜리가 우리 안에 더 자연스럽다.
 */
const WIDE_PLACEMENTS: readonly WidePlacement[] = [
  { sheet: "farm", tiles: WIDE_PROPS.troughWater, col: 9, row: 5 },
];

/**
 * 한 칸 소품. 밭 자리와 겹치지 않게 골랐다.
 *
 * 소품은 밭보다 위에 그려지므로 겹치면 이랑을 덮는다. 밭 자리는 두 칸 높이라 아래 칸까지
 * 피해야 한다. 살림살이는 헛간 앞마당 흙 위에만, 돌과 관목은 풀밭에만 둔다.
 */
const PROP_PLACEMENTS: readonly Placement[] = [
  // 헛간 앞마당. 흙 위.
  // 농부는 여기 세워두지 않는다. 걸어다니는 쪽으로 옮겼다(scene.PEOPLE_KINDS).
  { sheet: "farm", tile: YARD_PROPS.crate, col: 5, row: 5 },
  { sheet: "farm", tile: YARD_PROPS.haySack, col: 6, row: 5 },
  { sheet: "farm", tile: YARD_PROPS.barrel, col: 4, row: 5 },
  // 헛간과 목초지 사이 풀밭
  { sheet: "farm", tile: DECOR.stones, col: 4, row: 4 },
  { sheet: "farm", tile: DECOR.bush, col: 6, row: 3, sways: true },
  { sheet: "farm", tile: DECOR.pineSmall, col: 6, row: 2, sways: true },
  // 목초지 밖 오른쪽
  { sheet: "town", tile: PROPS.beehive, col: 15, row: 5 },
  { sheet: "town", tile: FLORA.bushRound, col: 15, row: 4, sways: true },
  // 왼쪽 여백
  { sheet: "town", tile: FLORA.bushRound, col: 0, row: 6, sways: true },
  { sheet: "town", tile: FLORA.mushrooms, col: 0, row: 8 },
  // 밭 사이 길가. 해바라기는 밭에 붙은 자리에만
  { sheet: "farm", tile: DECOR.sunflower, col: 7, row: 7, sways: true },
  { sheet: "farm", tile: DECOR.sunflower, col: 12, row: 7, sways: true },
  { sheet: "town", tile: FLORA.bushRound, col: 7, row: 9, sways: true },
  { sheet: "farm", tile: DECOR.berryBush, col: 12, row: 9, sways: true },
  // 오른쪽 아래
  { sheet: "farm", tile: DECOR.rocks, col: 14, row: 10 },
  { sheet: "farm", tile: DECOR.stones, col: 13, row: 8 },
  { sheet: "town", tile: FLORA.bushRound, col: 14, row: 7, sways: true },
];

/**
 * 장식을 살 때마다 앞에서부터 하나씩 나타난다. 순서가 곧 배치다.
 *
 * 배치를 사용자가 정하게 하면 위젯이 편집기가 된다. 그건 느긋하게 지켜보는 물건의
 * 성격과 맞지 않는다. 대신 놓이는 자리를 미리 손으로 골라 어디에 생겨도 구도가 깨지지
 * 않게 했다.
 */
const DECOR_UNLOCKS: readonly Placement[] = [
  // 첫 두 개는 밭과 목초지 사이 중앙에 둬 구매 직후 바로 알아볼 수 있게 한다.
  { sheet: "town", tile: FENCE.sign, col: 7, row: 8 },
  { sheet: "farm", tile: YARD_PROPS.hayBale, col: 7, row: 10 },
  { sheet: "farm", tile: DECOR.sunflower, col: 13, row: 7, sways: true },
  { sheet: "town", tile: FLORA.mushrooms, col: 13, row: 10 },
  { sheet: "farm", tile: DECOR.pineSmall, col: 4, row: 2, sways: true },
  { sheet: "town", tile: FLORA.bushRound, col: 0, row: 7, sways: true },
  { sheet: "farm", tile: DECOR.rocks, col: 15, row: 10 },
  { sheet: "farm", tile: DECOR.berryBush, col: 6, row: 4, sways: true },
];

function sheetOf(sheets: SheetRegistry, name: SheetName) {
  return name === "farm" ? sheets.farm : sheets.town;
}

function drawGround(context: CanvasRenderingContext2D, sheets: SheetRegistry): void {
  for (let row = 0; row < SCENE_ROWS; row += 1) {
    for (let col = 0; col < SCENE_COLS; col += 1) {
      // 좌표로 정하므로 매 프레임 같은 자리에 온다. 무작위로 하면 화면이 지글거린다.
      const tile = (col * 3 + row * 7) % 9 === 0 ? GROUND.grassTuft : GROUND.grassPlain;
      drawTile(context, sheets.town, tile, sceneX(col), sceneY(row));
    }
  }
}

/** 흙 칸 여부를 미리 계산해 둔다. 이웃을 봐야 경계 타일을 고를 수 있다 */
const dirtGrid: boolean[][] = Array.from({ length: SCENE_ROWS }, () =>
  Array.from({ length: SCENE_COLS }, () => false),
);
for (const rect of DIRT_RECTS) {
  for (let row = rect.row; row < rect.row + rect.rows; row += 1) {
    for (let col = rect.col; col < rect.col + rect.cols; col += 1) {
      if (row >= 0 && row < SCENE_ROWS && col >= 0 && col < SCENE_COLS) {
        dirtGrid[row]![col] = true;
      }
    }
  }
}

function isDirt(col: number, row: number): boolean {
  return dirtGrid[row]?.[col] ?? false;
}

function drawDirt(context: CanvasRenderingContext2D, sheets: SheetRegistry): void {
  for (let row = 0; row < SCENE_ROWS; row += 1) {
    for (let col = 0; col < SCENE_COLS; col += 1) {
      if (!isDirt(col, row)) {
        continue;
      }
      // 잔디와 닿는 변에 맞는 조각을 고른다. 양쪽이 다 열려 있으면 위/왼쪽 기준으로 둔다.
      const openTop = !isDirt(col, row - 1);
      const openBottom = !isDirt(col, row + 1);
      const openLeft = !isDirt(col - 1, row);
      const openRight = !isDirt(col + 1, row);

      const tileRow = openTop ? 0 : openBottom ? 2 : 1;
      const tileCol = openLeft ? 0 : openRight ? 2 : 1;
      const tile = DIRT_TILES[tileRow]![tileCol]!;
      drawTile(context, sheets.town, tile, sceneX(col), sceneY(row));
    }
  }
}

/**
 * 나무. 한 그루가 위아래 두 칸이다.
 *
 * 아래 칸을 먼저 그리고 위 칸을 나중에 그린다. 수관이 줄기 위로 조금 넘어오는 타일이 있어
 * 순서가 뒤바뀌면 경계에 선이 보인다. 흔들림도 두 칸을 같은 값으로 밀어야 나무가 찢어지지
 * 않는다.
 */
function drawTreePair(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  pair: TreePlacement,
  col: number,
  row: number,
  sway: number,
): void {
  const sheet = sheetOf(sheets, pair.sheet);
  drawTile(context, sheet, pair.bottom, sceneX(col) + sway, sceneY(row + 1));
  drawTile(context, sheet, pair.top, sceneX(col) + sway, sceneY(row));
}

function drawTrees(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  animMs: number,
): void {
  TREE_ANCHORS.forEach((anchor, index) => {
    const pair = TREE_POOL[(anchor.col * 5 + anchor.row * 3 + index) % TREE_POOL.length]!;
    const sway = wind(animMs, anchor.col * 0.7 + anchor.row * 1.3);
    drawTreePair(context, sheets, pair, anchor.col, anchor.row, sway);
  });

  DEAD_TREE_ANCHORS.forEach((anchor) => {
    const pair = TREE_PAIRS[anchor.pair];
    const sway = wind(animMs, anchor.col * 1.1);
    drawTreePair(
      context,
      sheets,
      { sheet: "farm", top: pair.top, bottom: pair.bottom },
      anchor.col,
      anchor.row,
      sway,
    );
  });
}

/**
 * 헛간. 벽 블록을 먼저 깔고 지붕 블록을 겹친다. 둘 다 시트에 놓인 순서 그대로 쌓는다.
 * 자세한 근거는 farmTiles.ts 의 BARN 주석에 있다.
 */
function drawBarn(context: CanvasRenderingContext2D, sheets: SheetRegistry): void {
  const { col, row } = BARN_AT;

  BARN.walls.forEach((tiles, offset) => {
    tiles.forEach((tile, colOffset) => {
      drawTile(
        context,
        sheets.farm,
        tile,
        sceneX(col + colOffset),
        sceneY(row + BARN_WALL_OFFSET + offset),
      );
    });
  });

  BARN.roof.forEach((tiles, offset) => {
    tiles.forEach((tile, colOffset) => {
      drawTile(context, sheets.farm, tile, sceneX(col + colOffset), sceneY(row + offset));
    });
  });
}

/**
 * 사각으로 둘러친 울타리.
 *
 * 위쪽 모서리와 아래쪽 모서리에 서로 다른 조각을 쓴다. 조각마다 기둥이 위로 이어지는지
 * 아래로 이어지는지가 다르기 때문이다. 자세한 근거는 FENCE 주석에 있다.
 */
function drawPen(context: CanvasRenderingContext2D, sheets: SheetRegistry): void {
  const lastCol = PEN.col + PEN.cols - 1;
  const lastRow = PEN.row + PEN.rows - 1;

  for (let col = PEN.col; col <= lastCol; col += 1) {
    const isFirst = col === PEN.col;
    const isLast = col === lastCol;
    const top = isFirst ? FENCE.topLeft : isLast ? FENCE.topRight : FENCE.rail;
    const bottom = isFirst ? FENCE.bottomLeft : isLast ? FENCE.bottomRight : FENCE.rail;
    drawTile(context, sheets.town, top, sceneX(col), sceneY(PEN.row));
    drawTile(context, sheets.town, bottom, sceneX(col), sceneY(lastRow));
  }

  // 좌우 세로변. 위아래가 채워진 조각이라 이어 붙여도 끊기지 않는다.
  for (let row = PEN.row + 1; row < lastRow; row += 1) {
    drawTile(context, sheets.town, FENCE.vertical, sceneX(PEN.col), sceneY(row));
    drawTile(context, sheets.town, FENCE.vertical, sceneX(lastCol), sceneY(row));
  }
}

function drawWideProps(context: CanvasRenderingContext2D, sheets: SheetRegistry): void {
  for (const item of WIDE_PLACEMENTS) {
    const sheet = sheetOf(sheets, item.sheet);
    item.tiles.forEach((tile, offset) => {
      drawTile(context, sheet, tile, sceneX(item.col + offset), sceneY(item.row));
    });
  }
}

function drawPlacements(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  animMs: number,
  placements: readonly Placement[],
  phaseOffset = 0,
): void {
  placements.forEach((prop, index) => {
    const sway = prop.sways === true ? wind(animMs, (index + phaseOffset) * 0.9) : 0;
    drawTile(
      context,
      sheetOf(sheets, prop.sheet),
      prop.tile,
      sceneX(prop.col) + sway,
      sceneY(prop.row),
    );
  });
}

/** 살 수 있는 장식의 최대 수 */
export const DECOR_MAX = DECOR_UNLOCKS.length;

/** 헛간이 차지하는 칸. 배치를 검사할 때 쓴다 */
export { BARN_SIZE };

/** 밭과 동물보다 아래에 오는 층 전체 */
export function drawFarmscapeBase(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
): void {
  drawGround(context, sheets);
  drawDirt(context, sheets);
}

/** 밭과 동물보다 위에 오는 층. 나무와 소품이 앞을 가려 깊이가 생긴다 */
export function drawFarmscapeOverlay(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  animMs: number,
  decorCount: number,
): void {
  drawTrees(context, sheets, animMs);
  drawBarn(context, sheets);
  drawPen(context, sheets);
  drawWideProps(context, sheets);
  drawPlacements(context, sheets, animMs, PROP_PLACEMENTS);
  drawPlacements(
    context,
    sheets,
    animMs,
    DECOR_UNLOCKS.slice(0, Math.max(0, Math.min(DECOR_MAX, decorCount))),
    PROP_PLACEMENTS.length,
  );
}
