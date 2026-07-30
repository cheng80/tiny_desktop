/**
 * 창 전체와 전경의 좌표.
 *
 * 고정 크기 위젯이라 좌표를 전부 상수로 둔다. 그리기와 클릭 판정이 같은 값을 봐야 하므로
 * 한 파일에 모은다.
 *
 * 세로로 길던 배치를 가로로 바꿨다. 이유는 구도다. 밭과 헛간과 목초지와 숲이 한 화면에
 * 같이 들어가야 농장으로 보이는데, 세로 10x9 칸에서는 어느 하나를 넣으면 다른 게 빠졌다.
 * 참고한 Kenney 샘플 이미지도 가로 구도다.
 *
 * 배치를 한 번 크게 고쳤다. 나무가 위아래 두 칸 한 쌍이고 헛간이 다섯 칸 높이라는 것을
 * 뒤늦게 확인했기 때문이다. 위에서 아래로 숲 - 건물과 목초지 - 앞마당 - 밭 순서로 층을
 * 나눠서, 각 요소가 제 높이를 온전히 차지하게 했다.
 */

import { TILE_SIZE } from "../assets/sheets";

/** 전경 타일 격자 */
export const SCENE_COLS = 17;
export const SCENE_ROWS = 11;

export const SCENE_X = 8;
/**
 * 전경 시작 y. 곧 머리말 높이다.
 *
 * 28 이었을 때는 날씨 아이콘이 창 테두리를 넘어갔고 글자도 시계 옆에 눌려 보였다.
 * 38 로 넓혀 아이콘을 2배로 키우고 진행 띠까지 한 층에 담는다. 늘어난 10px 은 아래쪽
 * 버튼 영역에서 되돌려 창 전체 높이는 그대로 둔다.
 */
export const SCENE_Y = 38;
export const SCENE_WIDTH = SCENE_COLS * TILE_SIZE;
export const SCENE_HEIGHT = SCENE_ROWS * TILE_SIZE;

/** 논리 해상도. 전경 크기에서 역산한다 */
export const VIEW_WIDTH = SCENE_X * 2 + SCENE_WIDTH;
export const VIEW_HEIGHT = 288;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const SCENE_RECT: Rect = {
  x: SCENE_X,
  y: SCENE_Y,
  width: SCENE_WIDTH,
  height: SCENE_HEIGHT,
};

export function sceneX(col: number): number {
  return SCENE_X + col * TILE_SIZE;
}

export function sceneY(row: number): number {
  return SCENE_Y + row * TILE_SIZE;
}

/**
 * 헛간 왼쪽 위 칸. 크기는 farmTiles.BARN_SIZE 가 갖고 있다(3칸 폭 6칸 높이).
 *
 * 시트의 벽 블록과 지붕 블록을 그대로 쌓으면 6칸이 된다. 임의로 줄이면 건물이 안 된다.
 * 문이 5행에 오므로 그 앞줄인 6행이 앞마당이 된다.
 */
export const BARN_AT = { col: 1, row: 0 } as const;

/**
 * 목초지를 둘러싼 울타리. 테두리를 포함한 범위이고 동물은 안쪽만 돌아다닌다.
 *
 * 처음에 안쪽을 5x2 칸으로 잡았더니 동물을 최대치까지 사면 여덟 마리가 한 덩어리로
 * 뭉쳤다. 개체마다 담당 구역을 나눠도 구역 폭이 스프라이트보다 좁아지면 겹친다.
 * 안쪽을 6x3 칸으로 넓혀 여덟 마리가 흩어질 자리를 만들었다.
 */
export const PEN = { col: 7, row: 2, cols: 8, rows: 5 } as const;

export const PASTURE: Rect = {
  x: sceneX(PEN.col + 1),
  y: sceneY(PEN.row + 1),
  width: (PEN.cols - 2) * TILE_SIZE,
  height: (PEN.rows - 2) * TILE_SIZE,
};

/**
 * 사람이 오가는 길. 한 사람이 한 구역을 맡는다.
 *
 * 동물과 섞어서 목초지에 두지 않는다. 농부가 우리 안에 갇혀 있으면 이상하고, 흙길을
 * 따라 오가는 편이 농장이 돌아가는 것처럼 보인다. 구역을 나눠 둬야 둘이 겹치지 않는다.
 */
export const WALKWAYS: readonly Rect[] = [
  // 헛간 문 앞 앞마당. 좌우로 오간다
  { x: sceneX(1), y: sceneY(6), width: TILE_SIZE * 6, height: TILE_SIZE },
  // 밭 사이로 내려가는 길. 위아래로 오간다
  { x: sceneX(5), y: sceneY(7), width: TILE_SIZE * 2, height: TILE_SIZE * 4 },
];

/**
 * 닭이 우리 밖에서 돌아다니는 구역. 각 구역에는 한 마리만 둔다.
 *
 * 첫 구역은 헛간 옆 작업 마당, 둘째는 밭 오른쪽 풀밭이다. 밭이나 우리 경계를 하나의 큰
 * 사각형으로 가로지르게 하지 않아 작물 위를 걷거나 울타리를 통과하는 모습이 나오지 않는다.
 */
export const CHICKEN_RUNS: readonly Rect[] = [
  // 밭 사이 세로 흙길의 왼쪽·오른쪽 차선을 한 마리씩 맡긴다. 폭이 정확히 한 타일이라
  // 목표점 사이를 직선으로 이동해도 양옆 밭에 들어가지 않고, 위쪽 상자와도 한 줄 떨어진다.
  { x: sceneX(5), y: sceneY(7), width: TILE_SIZE, height: TILE_SIZE * 4 },
  { x: sceneX(6), y: sceneY(7), width: TILE_SIZE, height: TILE_SIZE * 4 },
];

/**
 * 흙 영역. 여러 사각형을 합집합으로 보고 경계 타일을 자동으로 고른다.
 * 사각형을 따로 그리면 붙어 있는 두 영역 사이에 잔디 띠가 생겨 길이 끊긴다.
 *
 * 헛간 문 바로 앞이 앞마당이고, 거기서 아래로 길이 내려가 밭 사이를 지난다.
 */
export const DIRT_RECTS: readonly { col: number; row: number; cols: number; rows: number }[] = [
  // 헛간 문 앞 앞마당
  { col: 1, row: 6, cols: 6, rows: 1 },
  // 헛간 옆 작업 공간
  { col: 4, row: 5, cols: 3, rows: 1 },
  // 밭 사이로 내려가는 길
  { col: 5, row: 7, cols: 2, rows: 4 },
];

/**
 * 밭 자리. 한 칸 폭, 두 칸 높이의 이랑 하나가 한 자리다.
 *
 * 순서가 중요하다. 앞에서부터 열리므로 처음 네 자리가 서로 붙어 있어야 시작할 때부터
 * 밭 블록으로 보인다. 낱개로 흩어져 있으면 밭이 아니라 화분처럼 보인다.
 *
 * 자리는 절대 움직이지 않는다. 밭을 살 때마다 배치가 바뀌면 익숙해질 수 없다.
 */
export const PLOT_SLOTS: readonly { col: number; row: number }[] = [
  // 오른쪽 밭 위줄
  { col: 8, row: 7 },
  { col: 9, row: 7 },
  { col: 10, row: 7 },
  { col: 11, row: 7 },
  // 오른쪽 밭 아래줄
  { col: 8, row: 9 },
  { col: 9, row: 9 },
  { col: 10, row: 9 },
  { col: 11, row: 9 },
  // 왼쪽 밭 위줄
  { col: 1, row: 7 },
  { col: 2, row: 7 },
  { col: 3, row: 7 },
  { col: 4, row: 7 },
  // 왼쪽 밭 아래줄
  { col: 1, row: 9 },
  { col: 2, row: 9 },
  { col: 3, row: 9 },
  { col: 4, row: 9 },
];

export const PLOT_RECTS: readonly Rect[] = PLOT_SLOTS.map((slot) => ({
  x: sceneX(slot.col),
  y: sceneY(slot.row),
  width: TILE_SIZE,
  height: TILE_SIZE * 2,
}));

/**
 * 하단 정보와 구매 카드는 3+2 배열. 폭보다 글자 크기를 우선한다.
 *
 * 카드 높이를 27 에서 25 로, 위쪽 여백을 6 에서 4 로 줄였다. 버튼 안에 두 줄이 그대로
 * 들어가면서 머리말에 필요한 10px 을 넘겨줄 수 있다.
 */
const FOOTER_GAP = 4;
const BUTTON_HEIGHT = 25;
const NARROW_BUTTON_WIDTH = Math.floor((SCENE_WIDTH - FOOTER_GAP * 2) / 3);
const WIDE_BUTTON_WIDTH = Math.floor((SCENE_WIDTH - FOOTER_GAP) / 2);
const FOOTER_TOP = SCENE_Y + SCENE_HEIGHT + 4;
const FIRST_BUTTON_Y = FOOTER_TOP + 12;
const SECOND_BUTTON_Y = FIRST_BUTTON_Y + BUTTON_HEIGHT + FOOTER_GAP;

/** 날씨 아이콘 한 변. 논리 픽셀 12칸 그림을 2배로 그린다 */
const WEATHER_ICON_SCALE = 2;
const WEATHER_ICON_SIZE = 12 * WEATHER_ICON_SCALE;
const HEADER_CONTENT_X = SCENE_X + 72;

/**
 * 시계 왼쪽, 날씨와 진행 띠 가운데, 접기와 설정 버튼 오른쪽.
 *
 * 아이콘과 글자를 같은 줄에 두고 진행 띠를 그 아래로 내린다. 이전에는 셋을 한 줄에
 * 밀어 넣어 아이콘이 테두리를 침범했다.
 */
export const HEADER = {
  clock: { x: SCENE_X, y: 6, scale: 3 },
  weatherIcon: {
    x: HEADER_CONTENT_X,
    y: 3,
    scale: WEATHER_ICON_SCALE,
    size: WEATHER_ICON_SIZE,
  },
  /** 날씨 글자. 아이콘이 없으면 같은 자리에서 시작한다 */
  status: { x: HEADER_CONTENT_X + WEATHER_ICON_SIZE + 4, y: 9 },
  statusWithoutIcon: { x: HEADER_CONTENT_X, y: 9 },
  /**
   * 진행 띠는 전경과 같은 폭으로 아래층에 깐다.
   * 글자 옆에 짧게 두면 잘린 것처럼 보여서 머리말과 전경을 나누는 줄로 쓴다.
   */
  bar: { x: SCENE_X, y: 30, width: SCENE_WIDTH, height: 4 } as Rect,
  /** 도움말. 접기·설정과 같은 줄 왼쪽에 둔다 */
  help: { x: VIEW_WIDTH - 62, y: 8, width: TILE_SIZE, height: TILE_SIZE } as Rect,
  fold: { x: VIEW_WIDTH - 42, y: 8, width: TILE_SIZE, height: TILE_SIZE } as Rect,
  gear: { x: VIEW_WIDTH - 22, y: 8, width: TILE_SIZE, height: TILE_SIZE } as Rect,
} as const;

export const FOOTER = {
  /** 항상 확인할 핵심 상태. 누적 수확량은 조작에 필요하지 않아 화면에서 뺀다 */
  overview: [
    { x: SCENE_X, y: FOOTER_TOP, width: WIDE_BUTTON_WIDTH, height: 10 },
    {
      x: SCENE_X + WIDE_BUTTON_WIDTH + FOOTER_GAP,
      y: FOOTER_TOP,
      width: WIDE_BUTTON_WIDTH,
      height: 10,
    },
  ] as readonly Rect[],
  /** 순서는 판매, 밭, 저장고, 동물, 장식. main.ts의 actions와 같아야 한다 */
  buttons: [
    { x: SCENE_X, y: FIRST_BUTTON_Y, width: NARROW_BUTTON_WIDTH, height: BUTTON_HEIGHT },
    {
      x: SCENE_X + NARROW_BUTTON_WIDTH + FOOTER_GAP,
      y: FIRST_BUTTON_Y,
      width: NARROW_BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
    },
    {
      x: SCENE_X + (NARROW_BUTTON_WIDTH + FOOTER_GAP) * 2,
      y: FIRST_BUTTON_Y,
      width: NARROW_BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
    },
    { x: SCENE_X, y: SECOND_BUTTON_Y, width: WIDE_BUTTON_WIDTH, height: BUTTON_HEIGHT },
    {
      x: SCENE_X + WIDE_BUTTON_WIDTH + FOOTER_GAP,
      y: SECOND_BUTTON_Y,
      width: WIDE_BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
    },
  ] as readonly Rect[],
} as const;

/** 누르면 창이 끌리는 영역. 도움말·접기·톱니 버튼은 제외한다 */
export const DRAG_ZONE: Rect = { x: 0, y: 0, width: HEADER.help.x - 2, height: SCENE_Y - 2 };

export function hitTest(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
