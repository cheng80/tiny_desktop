/**
 * 설정 패널.
 *
 * 별도 창을 만들지 않는다. 창이 셋이 되면 어느 창을 닫아야 앱이 사라지는지 헷갈리고,
 * 트레이 메뉴도 복잡해진다. 본창 전경 위에 겹쳐 그리고 캔버스 좌표로 눌린 곳을 판정한다.
 */

import { COLORS, NINE_SLICE_INSET, PANEL } from "../assets/uiTiles";
import type { Settings } from "../core/settings";
import { SCALE_OPTIONS, type ViewScale } from "./canvas";
import { drawNineSlice, fillRect } from "./draw";
import { drawText, drawTextCentered } from "./font";
import { hitTest, SCENE_RECT, VIEW_HEIGHT, VIEW_WIDTH, type Rect } from "./layout";

/**
 * 패널은 전경 안쪽에 여백을 두고 놓는다.
 *
 * 위치 권한 항목을 넣으면서 전경 아래로 조금 더 내려온다. 권한 상태와 세 버튼을 한 줄에
 * 밀어 넣으면 글자가 서로 붙어 읽기 어렵다.
 *
 * 높이를 한 번 더 늘렸다. 이전에는 닫기 버튼이 아래 테두리에 붙어 눌러도 되는지 헷갈렸다.
 */
export const PANEL_RECT: Rect = {
  x: SCENE_RECT.x + 10,
  y: SCENE_RECT.y + 8,
  width: SCENE_RECT.width - 20,
  height: SCENE_RECT.height + 26,
};

/** 닫기 버튼 아래로 남길 여백. 이보다 좁으면 버튼이 테두리에 붙어 보인다 */
const CLOSE_BOTTOM_MARGIN = 10;

type ToggleKey =
  | "mainAlwaysOnTop"
  | "miniEnabled"
  | "miniAlwaysOnTop"
  | "weatherEnabled"
  | "autostart";

interface ToggleRow {
  readonly kind: "toggle";
  readonly key: ToggleKey;
  readonly label: string;
}

interface ScaleRow {
  readonly kind: "scale";
  readonly label: string;
}

interface LocationStatusRow {
  readonly kind: "locationStatus";
  readonly label: string;
}

interface LocationActionsRow {
  readonly kind: "locationActions";
  readonly label: string;
}

type Row = ToggleRow | ScaleRow | LocationStatusRow | LocationActionsRow;

const ROWS: readonly Row[] = [
  { kind: "scale", label: "화면 크기" },
  { kind: "toggle", key: "mainAlwaysOnTop", label: "본창 항상 위" },
  { kind: "toggle", key: "miniEnabled", label: "미니 위젯 사용" },
  { kind: "toggle", key: "miniAlwaysOnTop", label: "미니 항상 위" },
  { kind: "toggle", key: "weatherEnabled", label: "현재 위치 날씨" },
  { kind: "toggle", key: "autostart", label: "로그인 시 실행" },
  { kind: "locationStatus", label: "위치 권한" },
  { kind: "locationActions", label: "" },
];

/** 설정 패널이 보여줄 위치 권한 상태. main 창이 네이티브에서 읽어 넘긴다. */
export type LocationPermissionStatus =
  | "notDetermined"
  | "restricted"
  | "denied"
  | "authorized"
  | "unsupported"
  | "unknown";

export interface LocationPermissionView {
  readonly servicesEnabled: boolean;
  readonly status: LocationPermissionStatus;
  /** 권한 요청이 진행 중인지. 진행 중에는 버튼을 눌러도 중복 요청하지 않는다. */
  readonly requesting: boolean;
}

export function locationPermissionText(view: LocationPermissionView | null): string {
  if (view === null) {
    return "확인 중";
  }
  if (view.requesting) {
    return "요청 중";
  }
  if (view.status === "unsupported") {
    return "지원 안 함";
  }
  if (!view.servicesEnabled) {
    return "시스템 꺼짐";
  }
  switch (view.status) {
    case "authorized":
      return "허용";
    case "denied":
      return "거부";
    case "restricted":
      return "제한";
    case "notDetermined":
      return "미결정";
    default:
      return "알 수 없음";
  }
}

const TITLE_HEIGHT = 14;
const ROW_HEIGHT = 16;
const PAD = 8;
const TOGGLE_WIDTH = 30;
const TOGGLE_HEIGHT = 9;
const SCALE_BUTTON_WIDTH = 24;
const SCALE_BUTTON_GAP = 4;

function rowRect(index: number): Rect {
  return {
    x: PANEL_RECT.x + PAD,
    y: PANEL_RECT.y + PAD + TITLE_HEIGHT + index * ROW_HEIGHT,
    width: PANEL_RECT.width - PAD * 2,
    height: ROW_HEIGHT,
  };
}

/** ON / OFF 글자가 들어갈 폭. 토글을 이만큼 왼쪽으로 당겨야 패널 밖으로 안 밀린다 */
const TOGGLE_LABEL_WIDTH = 20;

function toggleRect(index: number): Rect {
  const row = rowRect(index);
  return {
    x: row.x + row.width - TOGGLE_WIDTH - TOGGLE_LABEL_WIDTH,
    y: row.y + Math.floor((ROW_HEIGHT - TOGGLE_HEIGHT) / 2),
    width: TOGGLE_WIDTH,
    height: TOGGLE_HEIGHT,
  };
}

function scaleButtonRect(index: number, optionIndex: number): Rect {
  const row = rowRect(index);
  const total =
    SCALE_OPTIONS.length * SCALE_BUTTON_WIDTH + (SCALE_OPTIONS.length - 1) * SCALE_BUTTON_GAP;
  const startX = row.x + row.width - total;
  return {
    x: startX + optionIndex * (SCALE_BUTTON_WIDTH + SCALE_BUTTON_GAP),
    y: row.y + 3,
    width: SCALE_BUTTON_WIDTH,
    height: 10,
  };
}

const LOCATION_ACTION_GAP = 4;
const LOCATION_ACTION_COUNT = 3;

/**
 * 권한 관련 버튼 세 개. 위치 권한 재요청, 위치 서비스 창, 로그인 항목 창.
 *
 * 로그인 시 실행은 위치처럼 허용 창이 뜨지 않는다. 대신 사용자가 로그인 항목에서 끌 수
 * 있어서, 그 창으로 바로 갈 경로가 필요하다.
 */
function locationActionRect(index: number, slot: 0 | 1 | 2): Rect {
  const row = rowRect(index);
  const width = Math.floor(
    (row.width - LOCATION_ACTION_GAP * (LOCATION_ACTION_COUNT - 1)) / LOCATION_ACTION_COUNT,
  );
  return {
    x: row.x + slot * (width + LOCATION_ACTION_GAP),
    y: row.y + 2,
    width,
    height: 11,
  };
}

/** 닫기 버튼은 패널 아래쪽 가운데. 아래 테두리와 여백을 둔다 */
export function closeButtonRect(): Rect {
  const width = 56;
  const height = 13;
  return {
    x: PANEL_RECT.x + Math.floor((PANEL_RECT.width - width) / 2),
    y: PANEL_RECT.y + PANEL_RECT.height - height - CLOSE_BOTTOM_MARGIN,
    width,
    height,
  };
}

/**
 * 캔버스 안에서 그리는 확인창.
 *
 * `window.confirm` 을 쓰지 않는다. 데스크톱 웹뷰에서 이 대화상자가 뜨지 않거나 즉시
 * 거짓을 돌려주는 경우가 있어, 사용자에게는 버튼이 먹지 않는 것처럼 보였다. 우리가
 * 직접 그리면 동작이 화면과 항상 일치하고 스크린샷으로 검증할 수 있다.
 */
export interface ConfirmView {
  readonly title: string;
  readonly lines: readonly string[];
}

const CONFIRM_WIDTH = 210;
const CONFIRM_HEIGHT = 74;

export function confirmRect(): Rect {
  return {
    x: Math.floor((VIEW_WIDTH - CONFIRM_WIDTH) / 2),
    y: Math.floor((VIEW_HEIGHT - CONFIRM_HEIGHT) / 2) - 10,
    width: CONFIRM_WIDTH,
    height: CONFIRM_HEIGHT,
  };
}

function confirmButtonRect(slot: 0 | 1): Rect {
  const box = confirmRect();
  const width = 76;
  const gap = 10;
  const totalWidth = width * 2 + gap;
  const startX = box.x + Math.floor((box.width - totalWidth) / 2);
  return {
    x: slot === 0 ? startX : startX + width + gap,
    y: box.y + box.height - 20,
    width,
    height: 13,
  };
}

export type ConfirmAction = { readonly kind: "accept" | "cancel" | "consumed" };

/** 확인창이 열려 있는 동안에는 이 함수가 모든 클릭을 먼저 가져간다. */
export function hitConfirm(x: number, y: number): ConfirmAction {
  if (hitTest(confirmButtonRect(0), x, y)) {
    return { kind: "cancel" };
  }
  if (hitTest(confirmButtonRect(1), x, y)) {
    return { kind: "accept" };
  }
  return { kind: "consumed" };
}

export function drawConfirm(
  context: CanvasRenderingContext2D,
  sheets: { ui: Parameters<typeof drawNineSlice>[1] },
  view: ConfirmView,
): void {
  context.save();
  context.globalAlpha = 0.6;
  fillRect(context, { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT }, "#2a1d14");
  context.restore();

  const box = confirmRect();
  drawNineSlice(context, sheets.ui, PANEL.wood, box, NINE_SLICE_INSET);
  drawTextCentered(context, view.title, box.x + Math.floor(box.width / 2), box.y + 6, {
    color: COLORS.ink,
    size: 9,
  });
  view.lines.forEach((line, index) => {
    drawTextCentered(context, line, box.x + Math.floor(box.width / 2), box.y + 20 + index * 10, {
      color: COLORS.ink,
      size: 8,
    });
  });

  const cancel = confirmButtonRect(0);
  const accept = confirmButtonRect(1);
  fillRect(
    context,
    { x: cancel.x - 1, y: cancel.y - 1, width: cancel.width + 2, height: cancel.height + 2 },
    COLORS.sceneEdge,
  );
  fillRect(context, cancel, COLORS.trackEmpty);
  drawTextCentered(context, "취소", cancel.x + Math.floor(cancel.width / 2), cancel.y + 3, {
    color: COLORS.ink,
    size: 8,
  });
  fillRect(
    context,
    { x: accept.x - 1, y: accept.y - 1, width: accept.width + 2, height: accept.height + 2 },
    COLORS.sceneEdge,
  );
  fillRect(context, accept, COLORS.gold);
  drawTextCentered(context, "확인", accept.x + Math.floor(accept.width / 2), accept.y + 3, {
    color: COLORS.ink,
    size: 8,
  });
}

export type SettingsAction =
  | { readonly kind: "toggle"; readonly key: ToggleKey }
  | { readonly kind: "scale"; readonly value: ViewScale }
  | { readonly kind: "requestLocation" }
  | { readonly kind: "openLocationSettings" }
  | { readonly kind: "openLoginItemsSettings" }
  | { readonly kind: "close" }
  | { readonly kind: "consumed" };

/**
 * 패널 안에서 눌린 것을 해석한다.
 *
 * 패널 안이면 아무것도 안 눌렸어도 consumed 를 낸다. 그러지 않으면 패널 위를 눌렀을 때
 * 뒤에 있는 밭이 반응한다.
 */
export function hitSettings(x: number, y: number): SettingsAction | null {
  if (!hitTest(PANEL_RECT, x, y)) {
    return null;
  }
  if (hitTest(closeButtonRect(), x, y)) {
    return { kind: "close" };
  }

  for (let index = 0; index < ROWS.length; index += 1) {
    const row = ROWS[index]!;
    if (row.kind === "toggle") {
      if (hitTest(toggleRect(index), x, y)) {
        return { kind: "toggle", key: row.key };
      }
      continue;
    }
    if (row.kind === "locationStatus") {
      continue;
    }
    if (row.kind === "locationActions") {
      if (hitTest(locationActionRect(index, 0), x, y)) {
        return { kind: "requestLocation" };
      }
      if (hitTest(locationActionRect(index, 1), x, y)) {
        return { kind: "openLocationSettings" };
      }
      if (hitTest(locationActionRect(index, 2), x, y)) {
        return { kind: "openLoginItemsSettings" };
      }
      continue;
    }
    for (let option = 0; option < SCALE_OPTIONS.length; option += 1) {
      if (hitTest(scaleButtonRect(index, option), x, y)) {
        return { kind: "scale", value: SCALE_OPTIONS[option]! };
      }
    }
  }

  return { kind: "consumed" };
}

function drawToggle(context: CanvasRenderingContext2D, rect: Rect, on: boolean): void {
  fillRect(
    context,
    { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 },
    COLORS.sceneEdge,
  );
  fillRect(context, rect, on ? COLORS.cropFill : COLORS.trackEmpty);
  // 손잡이를 좌우로 옮겨 켜짐/꺼짐을 색 말고도 알 수 있게 한다.
  const knobWidth = 12;
  fillRect(
    context,
    {
      x: on ? rect.x + rect.width - knobWidth : rect.x,
      y: rect.y,
      width: knobWidth,
      height: rect.height,
    },
    COLORS.inkLight,
  );
  drawText(context, on ? "켜짐" : "꺼짐", rect.x + rect.width + 4, rect.y + 1, {
    color: COLORS.ink,
    size: 8,
  });
}

function drawSmallButton(
  context: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  enabled: boolean,
): void {
  fillRect(
    context,
    { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 },
    COLORS.sceneEdge,
  );
  fillRect(context, rect, enabled ? COLORS.gold : COLORS.trackEmpty);
  drawTextCentered(context, label, rect.x + Math.floor(rect.width / 2), rect.y + 2, {
    color: COLORS.ink,
    size: 8,
  });
}

export function drawSettings(
  context: CanvasRenderingContext2D,
  sheets: { ui: Parameters<typeof drawNineSlice>[1] },
  settings: Settings,
  location: LocationPermissionView | null = null,
): void {
  // 뒤의 농장을 살짝 눌러 패널이 앞으로 나오게 한다.
  context.save();
  context.globalAlpha = 0.55;
  fillRect(context, SCENE_RECT, "#2a1d14");
  context.restore();

  drawNineSlice(context, sheets.ui, PANEL.wood, PANEL_RECT, NINE_SLICE_INSET);

  const title = "설정";
  drawTextCentered(
    context,
    title,
    PANEL_RECT.x + Math.floor(PANEL_RECT.width / 2),
    PANEL_RECT.y + 5,
    { color: COLORS.ink, size: 10 },
  );

  ROWS.forEach((row, index) => {
    const rect = rowRect(index);
    drawText(context, row.label, rect.x, rect.y + 4, { color: COLORS.ink, size: 8 });

    if (row.kind === "toggle") {
      drawToggle(context, toggleRect(index), settings[row.key]);
      return;
    }

    if (row.kind === "locationStatus") {
      const text = locationPermissionText(location);
      drawText(context, text, rect.x + rect.width - 58, rect.y + 4, {
        color: location !== null && location.status === "authorized" ? COLORS.ink : COLORS.gold,
        size: 8,
      });
      return;
    }

    if (row.kind === "locationActions") {
      const requesting = location?.requesting === true;
      drawSmallButton(context, locationActionRect(index, 0), "권한 요청", !requesting);
      drawSmallButton(context, locationActionRect(index, 1), "위치 설정", true);
      drawSmallButton(context, locationActionRect(index, 2), "로그인 항목", true);
      return;
    }

    SCALE_OPTIONS.forEach((option, optionIndex) => {
      const button = scaleButtonRect(index, optionIndex);
      const selected = settings.scale === option;
      fillRect(
        context,
        { x: button.x - 1, y: button.y - 1, width: button.width + 2, height: button.height + 2 },
        COLORS.sceneEdge,
      );
      fillRect(context, button, selected ? COLORS.gold : COLORS.trackEmpty);
      const label = `${option}배`;
      drawTextCentered(
        context,
        label,
        button.x + Math.floor(button.width / 2),
        button.y + 1,
        { color: COLORS.ink, size: 8 },
      );
    });
  });

  const close = closeButtonRect();
  fillRect(
    context,
    { x: close.x - 1, y: close.y - 1, width: close.width + 2, height: close.height + 2 },
    COLORS.sceneEdge,
  );
  fillRect(context, close, COLORS.inkLight);
  const closeLabel = "닫기";
  drawTextCentered(
    context,
    closeLabel,
    close.x + Math.floor(close.width / 2),
    close.y + 3,
    { color: COLORS.ink, size: 9 },
  );
}
