/**
 * 도움말.
 *
 * 처음 켠 사람이 "이걸 어떻게 하는 건데" 하고 막히지 않게 하는 것이 목적이다. 기능을
 * 빠짐없이 늘어놓지 않는다. 이 앱은 조작이 거의 없는 게 특징이라, 설명이 길어지면
 * 그 특징 자체를 배신한다.
 *
 * 여러 장으로 나눈 이유는 창이 288x288 이라 한 화면에 넣을 수 있는 줄이 적기 때문이다.
 * 좌우 버튼으로 넘기고, 마지막 장에서 닫는다.
 */

import { COLORS, NINE_SLICE_INSET, PANEL } from "../assets/uiTiles";
import { drawNineSlice, fillRect } from "./draw";
import { drawText, drawTextCentered } from "./font";
import { hitTest, SCENE_RECT, type Rect } from "./layout";

export const HELP_RECT: Rect = {
  x: SCENE_RECT.x + 10,
  y: SCENE_RECT.y + 8,
  width: SCENE_RECT.width - 20,
  height: SCENE_RECT.height + 26,
};

interface HelpPage {
  readonly title: string;
  /** 빈 문자열은 한 줄 띄우기로 쓴다 */
  readonly lines: readonly string[];
}

/**
 * 말투는 옆에서 알려주는 사람처럼. 기능 명세가 아니라 "이렇게 놀면 된다"는 안내다.
 * 문장을 짧게 끊는 이유는 픽셀 폰트가 작아서 긴 줄이 읽기 힘들기 때문이다.
 */
const PAGES: readonly HelpPage[] = [
  {
    title: "어떤 앱인가요",
    lines: [
      "화면 한쪽에 두고 그냥 지켜보는 농장입니다.",
      "작물이 자라고 동물이 어슬렁거립니다.",
      "",
      "할 일이 정해져 있지 않습니다.",
      "바쁠 땐 잊고 있어도 농장은 알아서 굴러갑니다.",
      "",
      "생각날 때 한 번 들여다보고,",
      "동전이 모였으면 농장을 조금 넓히는 정도입니다.",
    ],
  },
  {
    title: "밭과 수확",
    lines: [
      "작물은 20분마다 한 단계씩 자랍니다.",
      "다 익으면 밭 위에 표시가 뜹니다.",
      "",
      "익은 밭을 누르면 바로 거둡니다.",
      "그냥 둬도 10분 뒤에 알아서 거둬집니다.",
      "",
      "직접 거둬도 더 주지 않습니다.",
      "앱 앞에 붙어 있어야 이득이면 느긋할 수 없으니까요.",
      "",
      "거둔 작물은 저장고에 쌓입니다.",
    ],
  },
  {
    title: "동전 모으기",
    lines: [
      "아래 모두 판매 버튼을 누르면 저장고를 비우고",
      "동전으로 바꿉니다.",
      "",
      "동물도 동전을 냅니다.",
      "한 시간에 한 번 저장고의 작물을 먹고",
      "그보다 조금 더 벌어다 줍니다.",
      "",
      "동물이 밭보다 많아지면 저장고가 줄어듭니다.",
      "그때가 밭을 늘릴 때입니다.",
    ],
  },
  {
    title: "농장 넓히기",
    lines: [
      "동전이 모이면 아래 카드로 하나씩 늘립니다.",
      "",
      "밭 4칸에서 16칸까지",
      "저장고 20에서 120까지",
      "동물 3마리에서 8마리까지",
      "장식 8개까지",
      "",
      "살수록 값이 오릅니다. 서두를 이유는 없습니다.",
      "장식은 아무 기능이 없습니다. 그냥 예뻐집니다.",
    ],
  },
  {
    title: "날씨와 시간",
    lines: [
      "지금 있는 곳의 실제 날씨가 위에 표시됩니다.",
      "비나 눈이 오면 농장에도 내립니다.",
      "",
      "실제 시각에 따라 낮과 밤이 바뀝니다.",
      "",
      "날씨를 받으려면 위치 권한이 필요합니다.",
      "설정에서 끄면 위치를 묻지 않습니다.",
      "위치는 날씨를 받는 데만 쓰고 저장하지 않습니다.",
    ],
  },
  {
    title: "창 다루기",
    lines: [
      "위쪽 빈 곳을 끌면 창이 움직입니다.",
      "",
      "머리말 오른쪽에 작은 버튼이 셋 있습니다.",
      "물음표는 이 설명, 가운데는 접기, 톱니는 설정.",
      "",
      "접으면 작은 위젯만 남고,",
      "미니에서 열기를 누르면 다시 커집니다.",
      "",
      "닫아도 종료되지 않습니다.",
      "메뉴 막대 아이콘에 남아 시간이 계속 흐릅니다.",
      "완전히 끄려면 거기서 종료를 누릅니다.",
    ],
  },
  {
    title: "오래 비웠다면",
    lines: [
      "앱이 꺼져 있던 동안에도 농장은 자랍니다.",
      "다시 열면 그동안의 몫을 한 번에 정산합니다.",
      "",
      "다만 한 번에 최대 8시간까지만 흐릅니다.",
      "일주일 뒤에 열어도 마찬가지입니다.",
      "돌아왔을 때 감당 못 할 양이 쌓여 있으면",
      "반가운 대신 부담이 되니까요.",
      "",
      "그럼, 편하게 지켜보세요.",
    ],
  },
];

export const HELP_PAGE_COUNT = PAGES.length;

const BUTTON_WIDTH = 56;
const BUTTON_HEIGHT = 13;
const BUTTON_GAP = 8;
const BUTTON_BOTTOM_MARGIN = 10;

function buttonRow(): { readonly prev: Rect; readonly next: Rect } {
  const y = HELP_RECT.y + HELP_RECT.height - BUTTON_HEIGHT - BUTTON_BOTTOM_MARGIN;
  const total = BUTTON_WIDTH * 2 + BUTTON_GAP;
  const startX = HELP_RECT.x + Math.floor((HELP_RECT.width - total) / 2);
  return {
    prev: { x: startX, y, width: BUTTON_WIDTH, height: BUTTON_HEIGHT },
    next: { x: startX + BUTTON_WIDTH + BUTTON_GAP, y, width: BUTTON_WIDTH, height: BUTTON_HEIGHT },
  };
}

export type HelpAction =
  | { readonly kind: "prev" }
  | { readonly kind: "next" }
  | { readonly kind: "close" }
  | { readonly kind: "consumed" };

/** 도움말이 열려 있는 동안에는 이 함수가 모든 클릭을 먼저 가져간다. */
export function hitHelp(x: number, y: number, page: number): HelpAction {
  const { prev, next } = buttonRow();
  if (hitTest(prev, x, y)) {
    // 첫 장에서 왼쪽은 닫기 역할을 한다. 되돌아갈 곳이 없으니 나가는 문이 되는 게 낫다.
    return page === 0 ? { kind: "close" } : { kind: "prev" };
  }
  if (hitTest(next, x, y)) {
    return page >= PAGES.length - 1 ? { kind: "close" } : { kind: "next" };
  }
  return { kind: "consumed" };
}

function drawButton(
  context: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  strong: boolean,
): void {
  fillRect(
    context,
    { x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 },
    COLORS.sceneEdge,
  );
  fillRect(context, rect, strong ? COLORS.gold : COLORS.trackEmpty);
  drawTextCentered(context, label, rect.x + Math.floor(rect.width / 2), rect.y + 3, {
    color: COLORS.ink,
    size: 9,
  });
}

export function drawHelp(
  context: CanvasRenderingContext2D,
  sheets: { ui: Parameters<typeof drawNineSlice>[1] },
  page: number,
): void {
  const index = Math.max(0, Math.min(PAGES.length - 1, page));
  const current = PAGES[index]!;

  context.save();
  context.globalAlpha = 0.6;
  fillRect(context, SCENE_RECT, "#2a1d14");
  context.restore();

  drawNineSlice(context, sheets.ui, PANEL.wood, HELP_RECT, NINE_SLICE_INSET);

  drawTextCentered(
    context,
    current.title,
    HELP_RECT.x + Math.floor(HELP_RECT.width / 2),
    HELP_RECT.y + 6,
    { color: COLORS.ink, size: 11 },
  );

  // 몇 장 중 몇 번째인지 알려 준다. 끝이 보이지 않으면 넘기기를 그만두게 된다.
  drawTextCentered(
    context,
    `${index + 1} / ${PAGES.length}`,
    HELP_RECT.x + Math.floor(HELP_RECT.width / 2),
    HELP_RECT.y + 20,
    { color: COLORS.inkMuted, size: 8 },
  );

  const lineHeight = 12;
  const textTop = HELP_RECT.y + 36;
  current.lines.forEach((line, order) => {
    if (line.length === 0) {
      return;
    }
    drawText(context, line, HELP_RECT.x + 10, textTop + order * lineHeight, {
      color: COLORS.ink,
      size: 9,
    });
  });

  const { prev, next } = buttonRow();
  drawButton(context, prev, index === 0 ? "닫기" : "이전", false);
  drawButton(context, next, index >= PAGES.length - 1 ? "시작" : "다음", true);
}
