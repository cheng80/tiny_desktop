/**
 * Tiny Farm 텍스트 렌더러.
 *
 * PF스타더스트 3.0은 한글과 영문을 함께 지원하는 픽셀 폰트다. 원본 TTF를 수정하거나
 * 다른 형식으로 변환하지 않고 FontFace로 앱에 직접 등록한다. 별도 이름을 쓰는 이유는
 * 운영체제에 같은 폰트가 설치되어 있어도 반드시 앱에 포함된 파일을 쓰게 하기 위해서다.
 *
 * 출처: https://m.blog.naver.com/campanula913/221366697603
 * 저작권: 피나타(campanula913@naver.com)
 * 사용 조건: 상업적 사용 및 앱 임베딩 허용, 폰트 수정·파일 재배포·판매 금지.
 *
 * 파일 재배포가 금지되어 있어 폰트를 저장소에 두지 않는다. 그래서 정적 import 대신
 * 실행 시점에 `public/fonts/`에서 읽는다. 파일이 없으면 시스템 폰트로 물러난다.
 * 없을 때 앱이 죽으면 폰트를 못 구한 사람은 아예 실행할 수 없다.
 *
 * 폰트를 넣는 방법은 `assets/README.md`에 적었다.
 */

export const UI_FONT_FAMILY = "Tiny Farm PF Stardust";

/** public/ 아래 파일은 빌드 결과의 루트로 그대로 복사된다. */
const UI_FONT_URL = "/fonts/pf-stardust.ttf";
const FONT_PROBE = "한글 ABC 123";

let fontLoadPromise: Promise<void> | null = null;
let measurementContext: CanvasRenderingContext2D | null = null;

/**
 * 본창과 미니창의 첫 프레임 전에 호출한다.
 * 여러 초기화 경로가 동시에 요청해도 한 번만 읽는다.
 */
export function loadUiFont(): Promise<void> {
  if (fontLoadPromise !== null) {
    return fontLoadPromise;
  }

  fontLoadPromise = (async () => {
    if (typeof FontFace === "undefined" || document.fonts === undefined) {
      console.warn("이 환경은 웹폰트 로딩을 지원하지 않는다. 시스템 폰트로 그린다");
      return;
    }

    try {
      const face = new FontFace(UI_FONT_FAMILY, `url("${UI_FONT_URL}")`, {
        style: "normal",
        weight: "400",
      });
      const loaded = await face.load();
      document.fonts.add(loaded);
      await document.fonts.load(`16px "${UI_FONT_FAMILY}"`, FONT_PROBE);
      await document.fonts.ready;

      if (!document.fonts.check(`16px "${UI_FONT_FAMILY}"`, FONT_PROBE)) {
        throw new Error("등록은 됐지만 글리프를 쓸 수 없다");
      }
    } catch (error) {
      // 폰트가 없어도 앱은 떠야 한다. fontDeclaration 의 sans-serif 로 물러난다.
      console.warn(
        `${UI_FONT_URL} 를 불러오지 못해 시스템 폰트로 그린다. ` +
          "픽셀 글꼴을 쓰려면 assets/README.md 를 참고해 폰트를 넣는다.",
        error,
      );
    }
  })();

  return fontLoadPromise;
}

export interface TextStyle {
  readonly color: string;
  /** 기존 호출부와 호환되는 단계. 1=8px, 2=11px, 3=16px */
  readonly scale?: number;
  /** 한글 UI처럼 정확한 크기가 필요할 때 쓰는 논리 픽셀 단위 글꼴 크기 */
  readonly size?: number;
  /** 글자 사이 추가 간격. 기본은 폰트 자체 자간을 따른다 */
  readonly spacing?: number;
}

type MeasureStyle = Pick<TextStyle, "scale" | "size" | "spacing">;

function sizeForScale(scale: number): number {
  if (scale <= 1) {
    return 8;
  }
  if (scale === 2) {
    return 11;
  }
  if (scale === 3) {
    return 16;
  }
  return Math.max(8, Math.round(scale * 5.5));
}

function fontSize(style: MeasureStyle): number {
  return style.size ?? sizeForScale(style.scale ?? 1);
}

function fontDeclaration(size: number): string {
  return `400 ${size}px "${UI_FONT_FAMILY}", sans-serif`;
}

function prepareContext(context: CanvasRenderingContext2D, size: number): void {
  context.font = fontDeclaration(size);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function getMeasurementContext(): CanvasRenderingContext2D {
  if (measurementContext !== null) {
    return measurementContext;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("폰트 측정용 2D 컨텍스트를 만들 수 없다");
  }
  measurementContext = context;
  return context;
}

function characters(text: string): readonly string[] {
  return Array.from(text);
}

function measuredWidth(
  context: CanvasRenderingContext2D,
  text: string,
  style: MeasureStyle,
): number {
  if (text.length === 0) {
    return 0;
  }

  const size = fontSize(style);
  const spacing = style.spacing ?? 0;
  prepareContext(context, size);

  if (spacing === 0) {
    return context.measureText(text).width;
  }

  const glyphs = characters(text);
  const glyphWidth = glyphs.reduce(
    (total, character) => total + context.measureText(character).width,
    0,
  );
  return glyphWidth + Math.max(0, glyphs.length - 1) * spacing;
}

/** 렌더 없이 폭만 잰다. 가운데 정렬과 카드 안쪽 맞춤에 쓴다. */
export function measureText(text: string, style: MeasureStyle): number {
  return Math.ceil(measuredWidth(getMeasurementContext(), text, style));
}

export function textHeight(scale: number = 1): number {
  return sizeForScale(scale);
}

/**
 * 좌상단 기준으로 텍스트를 그린다.
 * Canvas의 top 기준은 브라우저별 차이가 있어 같은 폰트의 고정 표본 높이로 baseline을 맞춘다.
 */
export function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  if (text.length === 0) {
    return;
  }

  const size = fontSize(style);
  const spacing = style.spacing ?? 0;
  context.save();
  prepareContext(context, size);
  context.fillStyle = style.color;

  const probe = context.measureText(FONT_PROBE);
  const ascent = Math.ceil(probe.actualBoundingBoxAscent || size * 0.8);
  const baseline = Math.round(y) + ascent;
  let cursor = Math.round(x);

  if (spacing === 0) {
    context.fillText(text, cursor, baseline);
  } else {
    for (const character of characters(text)) {
      context.fillText(character, cursor, baseline);
      cursor += Math.ceil(context.measureText(character).width) + spacing;
    }
  }

  context.restore();
}

/** 지정한 구간 안에서 가로 가운데 정렬로 그린다. */
export function drawTextCentered(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  style: TextStyle,
): void {
  const width = measuredWidth(context, text, style);
  drawText(context, text, centerX - Math.floor(width / 2), y, style);
}
