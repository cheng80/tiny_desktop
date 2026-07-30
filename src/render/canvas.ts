/**
 * 캔버스 셋업. 픽셀아트가 흐려지거나 픽셀 크기가 들쭉날쭉해지지 않게 만드는 게 목적이다.
 *
 * 세 단계로 나뉜다.
 * - 논리 해상도: 위젯을 설계한 가상 픽셀 격자. 모든 좌표 계산은 이 단위로만 한다.
 * - CSS 크기: 논리 해상도 x 사용자 배율. 창 크기와 맞아야 한다.
 * - 백킹 스토어: CSS 크기 x devicePixelRatio. 레티나에서 선명하게 나오게 한다.
 *
 * devicePixelRatio 를 정수로 반올림하는 이유는, 1.5 같은 값이면 원본 1픽셀이 화면에서
 * 1.5픽셀이 되어 어떤 픽셀은 굵고 어떤 픽셀은 얇아지기 때문이다.
 *
 * 배율은 상수가 아니라 설정값이다. 데스크테리어 용도라 화면 크기에 따라 사용자가 골라야
 * 한다. 2048x1152 논리 해상도 화면에서는 2배가 적당하고, 더 큰 화면에서는 3배가 맞다.
 */

import { VIEW_HEIGHT, VIEW_WIDTH } from "./layout";

export { VIEW_HEIGHT, VIEW_WIDTH };

/** 고를 수 있는 배율. 픽셀아트라 정수만 허용한다 */
export const SCALE_OPTIONS = [1, 2, 3] as const;
export type ViewScale = (typeof SCALE_OPTIONS)[number];

export const DEFAULT_SCALE: ViewScale = 2;

export function isViewScale(value: unknown): value is ViewScale {
  return SCALE_OPTIONS.some((option) => option === value);
}

export function cssSize(scale: ViewScale): { width: number; height: number } {
  return { width: VIEW_WIDTH * scale, height: VIEW_HEIGHT * scale };
}

export interface Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  /** 논리 픽셀 -> 백킹 스토어 픽셀 배율 */
  readonly pixelScale: number;
}

function integerPixelRatio(): number {
  const ratio = globalThis.devicePixelRatio || 1;
  return Math.max(1, Math.round(ratio));
}

/**
 * 캔버스를 논리 좌표계로 맞춘다. 배율이 바뀌면 다시 부르면 된다.
 * 논리 해상도는 창 종류에 따라 다르므로 인자로 받는다.
 */
export function setupViewport(
  canvas: HTMLCanvasElement,
  scale: ViewScale,
  viewWidth: number = VIEW_WIDTH,
  viewHeight: number = VIEW_HEIGHT,
): Viewport {
  const ratio = integerPixelRatio();
  const pixelScale = scale * ratio;

  canvas.width = viewWidth * pixelScale;
  canvas.height = viewHeight * pixelScale;
  canvas.style.width = `${viewWidth * scale}px`;
  canvas.style.height = `${viewHeight * scale}px`;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("2D 컨텍스트를 만들 수 없다");
  }

  // 논리 좌표로 그리면 알아서 확대되게 변환을 고정한다.
  context.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  context.imageSmoothingEnabled = false;

  return { canvas, context, pixelScale };
}

/** 마우스 이벤트 좌표를 논리 픽셀 좌표로 바꾼다 */
export function toViewPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  viewWidth: number = VIEW_WIDTH,
  viewHeight: number = VIEW_HEIGHT,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((clientX - rect.left) / rect.width) * viewWidth),
    y: Math.floor(((clientY - rect.top) / rect.height) * viewHeight),
  };
}
