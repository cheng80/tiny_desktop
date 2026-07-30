/**
 * 미니 위젯 렌더러.
 *
 * 본창을 닫아도 농장이 곁에 남아 있게 하는 게 목적이다. Codex Pet 처럼 작게 떠 있고,
 * 상단 조작줄에서 창을 옮기거나 본창을 연다.
 *
 * 상태를 계산하지 않는다. 본창이 보내주는 스냅샷을 받아 그리기만 한다. 두 창이 각자
 * 농장 시계를 굴리면 시간이 두 번 흘러버린다. 움직임(바람, 동물, 낮밤)은 시간만으로
 * 정해지는 순수 함수라 스냅샷 없이도 계속 살아 있다.
 */

import { DECOR, growthTile, SOIL, TREE_PAIRS, YARD_PROPS } from "../assets/farmTiles";
import { TILE_SIZE, type SheetRegistry } from "../assets/sheets";
import { FENCE, FLORA, GROUND, PROPS, TREE_PAIRS as TOWN_TREE_PAIRS } from "../assets/townTiles";
import { COLORS } from "../assets/uiTiles";
import { growthStage, isRipe, nextHarvestProgress, ripeCount } from "../core/farm";
import type { AppState } from "../core/types";
import type { WeatherState } from "../core/weather";
import type { Critter } from "./critters";
import type { Daylight } from "./daylight";
import { drawTile, drawTileFlipped, fillRect, type Rect } from "./draw";
import { drawText, drawTextCentered } from "./font";
import { bob, wind } from "./motion";
import { compactWeatherText, drawWeatherIcon, drawWeatherParticles } from "./weather";

/** 미니 논리 해상도. 상단 조작줄 12px + 전경 7x3칸 + 정보줄 16px */
export const MINI_COLS = 7;
export const MINI_ROWS = 3;
export const MINI_WIDTH = MINI_COLS * TILE_SIZE;
const MINI_CONTROLS_HEIGHT = 12;
const MINI_SCENE_Y = MINI_CONTROLS_HEIGHT;
const MINI_INFO_HEIGHT = 16;
const MINI_INFO_Y = MINI_SCENE_Y + MINI_ROWS * TILE_SIZE;
export const MINI_HEIGHT = MINI_INFO_Y + MINI_INFO_HEIGHT;

/** 제목 표시줄처럼 한곳에 모은 이동·열기·닫기 영역 */
export const MINI_DRAG_ZONE: Rect = {
  x: 0,
  y: 0,
  width: 60,
  height: MINI_CONTROLS_HEIGHT,
};
export const MINI_OPEN_ZONE: Rect = {
  x: MINI_DRAG_ZONE.width,
  y: 0,
  width: 40,
  height: MINI_CONTROLS_HEIGHT,
};
export const MINI_CLOSE_ZONE: Rect = {
  x: MINI_OPEN_ZONE.x + MINI_OPEN_ZONE.width,
  y: 0,
  width: MINI_WIDTH - MINI_OPEN_ZONE.x - MINI_OPEN_ZONE.width,
  height: MINI_CONTROLS_HEIGHT,
};

const MINI_SCENE: Rect = {
  x: 0,
  y: MINI_SCENE_Y,
  width: MINI_WIDTH,
  height: MINI_ROWS * TILE_SIZE,
};

/** 미니에 보여줄 밭 자리. 본창의 앞쪽 세 자리를 대표로 쓴다 */
const MINI_PLOT_COLS = [2, 3, 4] as const;
const MINI_PLOT_ROW = 1;

/** 동물이 돌아다니는 범위. 맨 윗줄만 쓴다 */
export const MINI_PASTURE: Rect = {
  x: TILE_SIZE,
  y: MINI_SCENE_Y,
  width: TILE_SIZE * 5,
  height: TILE_SIZE,
};

/**
 * 좌우 여백을 메우는 나무 쌍. 위아래 두 칸이 한 그루다.
 * 아래 칸을 먼저 그려야 수관이 줄기 위로 자연스럽게 얹힌다.
 */
const MINI_TREES: readonly { sheet: "farm" | "town"; top: number; bottom: number; col: number }[] =
  [
    { sheet: "farm", top: TREE_PAIRS.pine.top, bottom: TREE_PAIRS.pine.bottom, col: 0 },
    { sheet: "town", top: TOWN_TREE_PAIRS.green.top, bottom: TOWN_TREE_PAIRS.green.bottom, col: 6 },
  ];

/** 구매 수량만큼 순서대로 나타나는 미니 장식. 밭(2~4열)은 비운다. */
const MINI_DECOR: readonly {
  sheet: "farm" | "town";
  tile: number;
  col: number;
  row: number;
  sways?: boolean;
}[] = [
  { sheet: "farm", tile: YARD_PROPS.hayBale, col: 1, row: 2 },
  { sheet: "town", tile: FENCE.sign, col: 5, row: 2 },
  { sheet: "farm", tile: DECOR.sunflower, col: 1, row: 1, sways: true },
  { sheet: "town", tile: PROPS.beehive, col: 5, row: 1 },
  { sheet: "farm", tile: DECOR.bush, col: 0, row: 2, sways: true },
  { sheet: "town", tile: PROPS.barrel, col: 6, row: 2 },
  { sheet: "farm", tile: DECOR.rocks, col: 1, row: 0 },
  { sheet: "town", tile: FLORA.mushrooms, col: 5, row: 0 },
];

function miniX(col: number): number {
  return col * TILE_SIZE;
}

function miniY(row: number): number {
  return MINI_SCENE_Y + row * TILE_SIZE;
}

export interface MiniFrame {
  readonly wallNow: number;
  readonly animMs: number;
  readonly critters: readonly Critter[];
  readonly light: Daylight;
  readonly weather: WeatherState;
}

export function drawMini(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  state: AppState | null,
  frame: MiniFrame,
): void {
  context.clearRect(0, 0, MINI_WIDTH, MINI_HEIGHT);

  // 바닥
  for (let row = 0; row < MINI_ROWS; row += 1) {
    for (let col = 0; col < MINI_COLS; col += 1) {
      const tile = (col + row * 3) % 5 === 0 ? GROUND.grassTuft : GROUND.grassPlain;
      drawTile(context, sheets.town, tile, miniX(col), miniY(row));
    }
  }

  // 밭 세 줄. 상태가 아직 안 왔으면 흙만 보여준다.
  MINI_PLOT_COLS.forEach((col, index) => {
    const x = miniX(col);
    const y = miniY(MINI_PLOT_ROW);
    const light = index % 2 === 0;
    drawTile(context, sheets.farm, light ? SOIL.furrowLightTop : SOIL.furrowDarkTop, x, y);
    drawTile(
      context,
      sheets.farm,
      light ? SOIL.furrowLightBottom : SOIL.furrowDarkBottom,
      x,
      y + TILE_SIZE,
    );

    const plot = state?.farm.plots[index] ?? null;
    if (plot === null || state === null) {
      return;
    }
    const stage = growthStage(plot, state.farm.farmTimeMs);
    if (stage <= 0) {
      return;
    }
    const sway = wind(frame.animMs, index * 1.3);
    drawTile(
      context,
      sheets.farm,
      growthTile(plot.crop, stage),
      x + sway,
      y + TILE_SIZE / 2,
    );
    if (isRipe(plot, state.farm.farmTimeMs)) {
      drawText(context, "!", x + 6, y - 4 + bob(frame.animMs, index * 2.1), {
        color: COLORS.gold,
        scale: 1,
      });
    }
  });

  // 동물
  for (const critter of frame.critters) {
    const y = Math.round(critter.y) + bob(frame.animMs, critter.phase);
    const x = Math.round(critter.x);
    if (critter.facing < 0) {
      drawTileFlipped(context, sheets.farm, critter.kind, x, y);
    } else {
      drawTile(context, sheets.farm, critter.kind, x, y);
    }
  }

  // 좌우 끝에 나무와 소품을 둬서 화면이 잘린 게 아니라 한 장면처럼 보이게 한다.
  // 가로 울타리를 깔았더니 밭 아래쪽을 덮어버려서 뺐다. 좁은 화면에서는 소품이 낫다.
  MINI_TREES.forEach((tree, index) => {
    const sheet = tree.sheet === "farm" ? sheets.farm : sheets.town;
    const sway = wind(frame.animMs, index * 1.1);
    drawTile(context, sheet, tree.bottom, miniX(tree.col) + sway, miniY(1));
    drawTile(context, sheet, tree.top, miniX(tree.col) + sway, miniY(0));
  });
  MINI_DECOR
    .slice(0, Math.max(0, Math.min(MINI_DECOR.length, state?.farm.decor ?? 0)))
    .forEach((item, index) => {
      const sheet = item.sheet === "farm" ? sheets.farm : sheets.town;
      const sway = item.sways === true ? wind(frame.animMs, index * 0.8) : 0;
      drawTile(context, sheet, item.tile, miniX(item.col) + sway, miniY(item.row));
    });

  const currentWeather = frame.weather.observation;
  if (currentWeather !== null) {
    drawWeatherIcon(context, currentWeather, MINI_SCENE.x + 2, MINI_SCENE.y + 2);
  }
  drawWeatherParticles(context, frame.weather, frame.animMs, MINI_SCENE);

  // 시간대 보정
  if (frame.light.tint !== null) {
    context.save();
    context.beginPath();
    context.rect(MINI_SCENE.x, MINI_SCENE.y, MINI_SCENE.width, MINI_SCENE.height);
    context.clip();
    context.globalCompositeOperation = "multiply";
    context.fillStyle = frame.light.tint;
    context.fillRect(MINI_SCENE.x, MINI_SCENE.y, MINI_SCENE.width, MINI_SCENE.height);
    context.restore();
  }

  // 정보줄
  fillRect(
    context,
    { x: 0, y: MINI_INFO_Y, width: MINI_WIDTH, height: MINI_INFO_HEIGHT },
    "#3b2a1e",
  );

  const bar: Rect = { x: 3, y: MINI_INFO_Y + 3, width: MINI_WIDTH - 6, height: 4 };
  fillRect(context, bar, COLORS.trackEmpty);
  if (state !== null) {
    const progress = nextHarvestProgress(state.farm);
    if (progress > 0) {
      fillRect(context, { ...bar, width: Math.round(bar.width * progress) }, COLORS.cropFill);
    }
  }

  const clock = new Date(frame.wallNow);
  const weatherLabel = compactWeatherText(frame.weather);
  const label =
    weatherLabel ||
    (state === null
      ? "불러오는 중"
      : `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}  익음 ${ripeCount(state.farm)}  저장 ${state.farm.storage}`);
  drawTextCentered(context, label, Math.floor(MINI_WIDTH / 2), MINI_INFO_Y + 8, {
    color: COLORS.inkLight,
    size: 7,
  });

  // 이동·열기·닫기를 상단 한 줄에 모아 일반 창의 제목 표시줄처럼 보이게 한다.
  fillRect(context, MINI_DRAG_ZONE, COLORS.sceneEdge);
  fillRect(context, MINI_OPEN_ZONE, COLORS.gold);
  fillRect(context, MINI_CLOSE_ZONE, COLORS.panelEdge);
  for (const x of [MINI_OPEN_ZONE.x, MINI_CLOSE_ZONE.x]) {
    fillRect(context, { x, y: 0, width: 1, height: MINI_CONTROLS_HEIGHT }, COLORS.panelEdge);
  }
  for (const offset of [3, 5, 7]) {
    fillRect(
      context,
      { x: MINI_DRAG_ZONE.x + 6, y: offset, width: 7, height: 1 },
      COLORS.inkLight,
    );
  }
  drawTextCentered(context, "이동", MINI_DRAG_ZONE.x + 39, 2, {
    color: COLORS.inkLight,
    size: 7,
  });
  drawTextCentered(
    context,
    "열기",
    MINI_OPEN_ZONE.x + Math.floor(MINI_OPEN_ZONE.width / 2),
    2,
    { color: COLORS.ink, size: 7 },
  );
  drawTextCentered(
    context,
    "X",
    MINI_CLOSE_ZONE.x + Math.floor(MINI_CLOSE_ZONE.width / 2),
    2,
    { color: COLORS.inkLight, size: 7 },
  );
}
