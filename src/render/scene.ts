/**
 * 본창 화면 구성.
 *
 * 세 층이다. 위쪽 머리글(시계, 현황, 성장 게이지), 가운데 농장 전경, 아래 버튼과 현황.
 * 전경의 정적인 부분은 farmscape.ts 가, 좌표는 layout.ts 가 갖고 있다. 이 파일은
 * 그것들을 순서대로 겹치고 상태에 따라 달라지는 것만 그린다.
 *
 * 그리는 순서가 곧 깊이다. 바닥과 흙 -> 밭과 작물 -> 동물 -> 숲과 건물과 소품 순이라
 * 동물이 울타리 뒤로 지나가고 작물이 나무에 가린다.
 */

import { DECOR, growthTile, SOIL } from "../assets/farmTiles";
import { TILE_SIZE, type SheetRegistry } from "../assets/sheets";
import { COLORS, NINE_SLICE_INSET, PANEL, ROUND_BUTTON } from "../assets/uiTiles";
import {
  growthStage,
  isRipe,
  isStorageFull,
  nextAnimalPrice,
  nextDecorPrice,
  nextHarvestProgress,
  nextPlotPrice,
  nextStoragePrice,
  ripeCount,
} from "../core/farm";
import type { AppState } from "../core/types";
import type { WeatherState } from "../core/weather";
import type { Critter } from "./critters";
import type { Daylight } from "./daylight";
import { drawNineSlice, drawTile, drawTileFlipped, fillRect } from "./draw";
import { drawFarmscapeBase, drawFarmscapeOverlay } from "./farmscape";
import { drawText, drawTextCentered } from "./font";
import {
  FOOTER,
  HEADER,
  PLOT_RECTS,
  SCENE_RECT,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type Rect,
} from "./layout";
import { bob, cloudShadows, fireflies, smoke, sparkles, wind } from "./motion";
import { drawWeatherIcon, drawWeatherParticles, weatherText } from "./weather";

export { CHICKEN_RUNS, DRAG_ZONE, FOOTER, HEADER, PASTURE, PLOT_RECTS, hitTest } from "./layout";

/** 동물 스프라이트 후보. 보유 수만큼 순환해서 배정한다 */
const CRITTER_POOL = [DECOR.sheep, DECOR.cow, DECOR.chicken] as const;

export function critterKindsFor(count: number): number[] {
  return Array.from(
    { length: Math.max(0, count) },
    (_, index) => CRITTER_POOL[index % CRITTER_POOL.length]!,
  );
}

/**
 * 농장에 사는 사람 둘. 흙길을 따라 오간다.
 *
 * 세워둔 장식이 아니라 움직이는 쪽이 낫다. 정지 스프라이트라도 위치가 바뀌고 방향이
 * 뒤집히고 1px 흔들리면 걸어다니는 것으로 읽힌다. 사람이 오가면 농장이 돌아가는 느낌이
 * 생기고, 이 위젯의 목적이 그거다.
 */
export const PEOPLE_KINDS = [DECOR.farmerHat, DECOR.farmerFront] as const;

function drawPlots(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  state: AppState,
  animMs: number,
): void {
  const { farm } = state;

  for (let index = 0; index < farm.plotCount; index += 1) {
    const rect = PLOT_RECTS[index]!;

    // 이랑 색을 번갈아 쓴다. 나란히 붙은 밭이 두둑처럼 보이게 하는 장치다.
    const light = index % 2 === 0;
    drawTile(
      context,
      sheets.farm,
      light ? SOIL.furrowLightTop : SOIL.furrowDarkTop,
      rect.x,
      rect.y,
    );
    drawTile(
      context,
      sheets.farm,
      light ? SOIL.furrowLightBottom : SOIL.furrowDarkBottom,
      rect.x,
      rect.y + TILE_SIZE,
    );

    const plot = farm.plots[index] ?? null;
    if (plot === null) {
      continue;
    }
    const stage = growthStage(plot, farm.farmTimeMs);
    if (stage <= 0) {
      continue;
    }

    // 작물은 이랑 가운데에 얹는다. 이랑이 두 칸 높이라 아래쪽으로 반 칸 내린다.
    const sway = wind(animMs, index * 1.3);
    drawTile(
      context,
      sheets.farm,
      growthTile(plot.crop, stage),
      rect.x + sway,
      rect.y + TILE_SIZE / 2,
    );
  }
}

function drawCritters(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  critters: readonly Critter[],
  animMs: number,
): void {
  for (const critter of critters) {
    const hop = bob(animMs, critter.phase);
    const x = Math.round(critter.x);
    const y = Math.round(critter.y) + hop;
    if (critter.facing < 0) {
      drawTileFlipped(context, sheets.farm, critter.kind, x, y);
    } else {
      drawTile(context, sheets.farm, critter.kind, x, y);
    }
  }
}

function drawAtmosphere(
  context: CanvasRenderingContext2D,
  animMs: number,
  light: Daylight,
  weather: WeatherState,
): void {
  context.save();
  // 전경 밖으로 새지 않게 자른다.
  context.beginPath();
  context.rect(SCENE_RECT.x, SCENE_RECT.y, SCENE_RECT.width, SCENE_RECT.height);
  context.clip();

  // 구름 그림자. 사각형으로 그리면 회색 판이 지나가는 것처럼 보이므로 타원으로 그린다.
  context.fillStyle = "#1d2b1a";
  for (const shadow of cloudShadows(animMs, SCENE_RECT, 3)) {
    context.globalAlpha = shadow.alpha;
    context.beginPath();
    context.ellipse(
      shadow.x + shadow.width / 2,
      shadow.y + shadow.height / 2,
      shadow.width / 2,
      shadow.height / 2,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;

  // 헛간 지붕에서 오르는 연기
  context.fillStyle = "#e8e2d4";
  for (const puff of smoke(animMs, SCENE_RECT.x + 2 * TILE_SIZE + 7, SCENE_RECT.y + 2)) {
    context.globalAlpha = puff.alpha;
    context.fillRect(puff.x, puff.y, puff.size, puff.size);
  }
  context.globalAlpha = 1;

  const dots = light.isNight
    ? fireflies(animMs, SCENE_RECT, 9)
    : sparkles(animMs, SCENE_RECT, 5);
  context.fillStyle = light.isNight ? "#d8f06a" : "#ffe38a";
  for (const dot of dots) {
    context.globalAlpha = dot.alpha;
    context.fillRect(dot.x, dot.y, 1, 1);
  }
  context.globalAlpha = 1;

  // 강수도 시간대 색을 함께 받도록 daylight multiply 직전에 그린다.
  drawWeatherParticles(context, weather, animMs, SCENE_RECT);

  if (light.tint !== null) {
    // multiply 로 타일 색을 눌러 시간대를 만든다. 색을 덮어쓰지 않아 픽셀아트 톤이 남는다.
    context.globalCompositeOperation = "multiply";
    context.fillStyle = light.tint;
    context.fillRect(SCENE_RECT.x, SCENE_RECT.y, SCENE_RECT.width, SCENE_RECT.height);
    context.globalCompositeOperation = "source-over";
  }

  context.restore();
}

/** 수확 가능 표시. 시간대 보정 뒤에 그려서 밤에도 눈에 띈다 */
function drawRipeMarkers(
  context: CanvasRenderingContext2D,
  state: AppState,
  animMs: number,
): void {
  const { farm } = state;
  for (let index = 0; index < farm.plotCount; index += 1) {
    if (!isRipe(farm.plots[index] ?? null, farm.farmTimeMs)) {
      continue;
    }
    const rect = PLOT_RECTS[index]!;
    const lift = bob(animMs, index * 2.1);
    drawText(context, "!", rect.x + 6, rect.y - 4 + lift, {
      color: COLORS.gold,
      scale: 1,
    });
  }
}

/** 전경 테두리. 풀밭이 패널 위에 그냥 얹힌 것처럼 보이지 않게 감싼다 */
function drawSceneFrame(context: CanvasRenderingContext2D): void {
  const { x, y, width, height } = SCENE_RECT;
  fillRect(context, { x: x - 1, y: y - 1, width: width + 2, height: 1 }, COLORS.sceneEdge);
  fillRect(context, { x: x - 1, y: y + height, width: width + 2, height: 1 }, COLORS.sceneEdge);
  fillRect(context, { x: x - 1, y, width: 1, height }, COLORS.sceneEdge);
  fillRect(context, { x: x + width, y, width: 1, height }, COLORS.sceneEdge);
}

function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function statusText(state: AppState, date: Date): string {
  const { farm } = state;
  if (farm.lastSettleHarvests !== undefined && farm.lastSettleHarvests > 0) {
    return `돌아온 동안 ${farm.lastSettleHarvests}회 수확했어요`;
  }
  if (isStorageFull(farm)) {
    return "저장고 가득 · 판매하면 다시 자라요";
  }
  const ripe = ripeCount(farm);
  if (ripe > 0) {
    return `수확 가능한 밭 ${ripe}칸`;
  }
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일 · 자라는 중`;
}

/**
 * 다음 수확까지의 진행을 보여주는 얇은 띠.
 *
 * 작물 그림만으로도 단계는 알 수 있지만 20분에 한 번만 바뀐다. 이 띠는 계속 차오르므로
 * 뭔가 자라고 있다는 신호가 끊기지 않는다.
 */
function drawGrowthBar(context: CanvasRenderingContext2D, state: AppState): void {
  const bar = HEADER.bar;
  fillRect(
    context,
    { x: bar.x - 1, y: bar.y - 1, width: bar.width + 2, height: bar.height + 2 },
    COLORS.sceneEdge,
  );
  fillRect(context, bar, COLORS.trackEmpty);

  const progress = nextHarvestProgress(state.farm);
  if (progress > 0) {
    fillRect(context, { ...bar, width: Math.round(bar.width * progress) }, COLORS.cropFill);
  }
}

export interface ButtonState {
  /** 무엇을 누르는지. 첫 줄에 크게 표시한다 */
  readonly title: string;
  /** 현재 수량과 가격/최대 상태. 둘째 줄에 크게 표시한다 */
  readonly detail: string;
  readonly enabled: boolean;
}

/** 확장 대상의 현재 수량과 다음 가격을 두 줄로 분리한다 */
function priceButton(
  name: string,
  owned: number,
  unit: string,
  price: number | null,
  coins: number,
): ButtonState {
  if (price === null) {
    return { title: `${name} ${owned}${unit}`, detail: "최대", enabled: false };
  }
  return {
    title: `${name} ${owned}${unit} +`,
    detail: `${price} 동전`,
    enabled: coins >= price,
  };
}

/** 버튼 문구와 활성 여부. 그리기와 클릭 처리가 같은 판단을 쓰도록 여기서 정한다 */
export function buttonStates(state: AppState): readonly ButtonState[] {
  const { farm } = state;
  return [
    {
      title: "모두 판매",
      detail: farm.storage > 0 ? `작물 ${farm.storage}개` : "저장고 비었음",
      enabled: farm.storage > 0,
    },
    priceButton("밭", farm.plotCount, "칸", nextPlotPrice(farm), farm.coins),
    priceButton("저장고", farm.storageCapacity, "칸", nextStoragePrice(farm), farm.coins),
    priceButton("동물", farm.animals, "마리", nextAnimalPrice(farm), farm.coins),
    priceButton("장식", farm.decor, "개", nextDecorPrice(farm), farm.coins),
  ];
}

function drawButton(
  context: CanvasRenderingContext2D,
  rect: Rect,
  button: ButtonState,
): void {
  // 두 줄의 2배 글자가 테두리에 닿지 않도록 1px 픽셀 카드로 그린다.
  fillRect(context, rect, COLORS.sceneEdge);
  fillRect(
    context,
    { x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 },
    COLORS.inkLight,
  );
  const color = button.enabled ? COLORS.ink : COLORS.inkMuted;
  // 카드 높이를 25 로 줄였으므로 두 줄을 각각 1px 씩 위로 당긴다.
  drawTextCentered(context, button.title, rect.x + Math.floor(rect.width / 2), rect.y + 2, {
    color,
    size: 9,
  });
  drawTextCentered(context, button.detail, rect.x + Math.floor(rect.width / 2), rect.y + 13, {
    color,
    size: 8,
  });
}

function drawFooterOverview(context: CanvasRenderingContext2D, state: AppState): void {
  const items = [
    `동전 ${state.farm.coins}`,
    `저장 ${state.farm.storage}/${state.farm.storageCapacity}`,
  ];
  FOOTER.overview.forEach((rect, index) => {
    drawTextCentered(context, items[index]!, rect.x + Math.floor(rect.width / 2), rect.y, {
      color: COLORS.ink,
      size: 11,
    });
  });
}

export interface Frame {
  /** Date.now(). 시계와 낮밤에 쓴다 */
  readonly wallNow: number;
  /** 애니메이션용 단조 증가 시간 */
  readonly animMs: number;
  readonly critters: readonly Critter[];
  readonly light: Daylight;
  readonly weather: WeatherState;
  /** 설정 패널이 열려 있는지 */
  readonly settingsOpen: boolean;
}

export function drawScene(
  context: CanvasRenderingContext2D,
  sheets: SheetRegistry,
  state: AppState,
  frame: Frame,
): void {
  context.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  // 패널 타일의 모서리 픽셀이 비어 있어서, 먼저 테두리색으로 창 전체를 칠해 메운다.
  // 투명 픽셀이 하나라도 남으면 macOS 에서 투명 창 설정이 필요해지고, 그건 private API 라
  // App Store 심사를 통과할 수 없다. 자세한 이유는 COLORS.panelEdge 주석에 적었다.
  fillRect(context, { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT }, COLORS.panelEdge);

  drawNineSlice(
    context,
    sheets.ui,
    PANEL.wood,
    { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT },
    NINE_SLICE_INSET,
  );

  const date = new Date(frame.wallNow);
  drawText(context, formatClock(date), HEADER.clock.x, HEADER.clock.y, {
    color: COLORS.ink,
    scale: HEADER.clock.scale,
  });
  const currentWeather = frame.weather.observation;
  const headerText = weatherText(frame.weather) || statusText(state, date);
  if (currentWeather !== null) {
    const icon = HEADER.weatherIcon;
    drawWeatherIcon(context, currentWeather, icon.x, icon.y, icon.scale);
  }
  const statusAt = currentWeather === null ? HEADER.statusWithoutIcon : HEADER.status;
  drawText(context, headerText, statusAt.x, statusAt.y, {
    color: currentWeather === null ? COLORS.inkMuted : COLORS.ink,
    size: 11,
  });
  drawGrowthBar(context, state);
  drawTile(context, sheets.ui, ROUND_BUTTON.idle, HEADER.fold.x, HEADER.fold.y);
  // 프레임 없는 창이라 macOS 최소화 버튼이 없다. 짧은 선으로 미니 전환을 표시한다.
  fillRect(
    context,
    { x: HEADER.fold.x + 5, y: HEADER.fold.y + 8, width: 6, height: 1 },
    COLORS.ink,
  );
  drawTile(
    context,
    sheets.ui,
    frame.settingsOpen ? ROUND_BUTTON.active : ROUND_BUTTON.idle,
    HEADER.gear.x,
    HEADER.gear.y,
  );
  // 원형 버튼 타일만으로는 접기 버튼과 구분되지 않는다. 중앙 링과 네 방향 톱니를
  // 픽셀로 직접 그려 작은 크기에서도 옵션 버튼임을 바로 알아보게 한다.
  const gear = HEADER.gear;
  const gearParts: readonly Rect[] = [
    { x: gear.x + 7, y: gear.y + 3, width: 2, height: 2 },
    { x: gear.x + 7, y: gear.y + 11, width: 2, height: 2 },
    { x: gear.x + 3, y: gear.y + 7, width: 2, height: 2 },
    { x: gear.x + 11, y: gear.y + 7, width: 2, height: 2 },
    { x: gear.x + 5, y: gear.y + 5, width: 6, height: 6 },
  ];
  gearParts.forEach((part) => fillRect(context, part, COLORS.ink));
  fillRect(
    context,
    { x: gear.x + 7, y: gear.y + 7, width: 2, height: 2 },
    frame.settingsOpen ? COLORS.gold : COLORS.inkLight,
  );

  drawFarmscapeBase(context, sheets);
  drawPlots(context, sheets, state, frame.animMs);
  drawCritters(context, sheets, frame.critters, frame.animMs);
  drawFarmscapeOverlay(context, sheets, frame.animMs, state.farm.decor);
  drawAtmosphere(context, frame.animMs, frame.light, frame.weather);
  drawRipeMarkers(context, state, frame.animMs);
  drawSceneFrame(context);

  drawFooterOverview(context, state);

  const buttons = buttonStates(state);
  FOOTER.buttons.forEach((rect, index) => {
    const button = buttons[index];
    if (button) {
      drawButton(context, rect, button);
    }
  });
}


