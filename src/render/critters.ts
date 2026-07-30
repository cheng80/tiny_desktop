/**
 * 돌아다니는 동물.
 *
 * 정지 스프라이트 한 장으로 살아 있게 만드는 방법은 세 개다. 위치를 옮기고, 상하로 1px
 * 흔들고, 진행 방향에 따라 좌우로 반전한다. 이 세 개만으로 걸어다니는 것처럼 보인다.
 *
 * 이 상태는 저장하지 않는다. 순수한 겉모습이라 앱을 다시 열 때 새로 만들면 되고,
 * 저장 스키마를 불필요하게 키우지 않는 게 낫다.
 *
 * 난수는 시드를 받는 자체 생성기를 쓴다. Math.random 을 쓰면 스크린샷이 매번 달라져서
 * 시각 검증을 할 수 없다.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Critter {
  /** farm 시트의 타일 인덱스 */
  readonly kind: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** 논리 픽셀 / 밀리초 */
  readonly speed: number;
  facing: 1 | -1;
  /** 이 시각까지는 멈춰 서 있는다 */
  waitUntil: number;
  /** 개체마다 흔들림 위상을 달리해 동시에 뛰지 않게 한다 */
  readonly phase: number;
  /**
   * 이 개체가 돌아다니는 구역.
   *
   * 목초지 전체를 대상으로 목표를 고르게 하면 여럿이 같은 쪽으로 모여 겹쳐 버린다.
   * 개체마다 세로 띠를 하나씩 맡기면 알아서 흩어져 있으면서도 움직임은 자유롭다.
   */
  readonly area: Rect;
}

/** mulberry32. 짧고 시드를 받으며 분포가 충분히 고르다 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 동물이 차지하는 크기. 타일 하나 */
const CRITTER_SIZE = 16;

function pickTarget(
  random: () => number,
  bounds: Rect,
): { x: number; y: number } {
  return {
    x: bounds.x + random() * Math.max(0, bounds.width - CRITTER_SIZE),
    y: bounds.y + random() * Math.max(0, bounds.height - CRITTER_SIZE),
  };
}

/** 담당 구역을 원래 칸보다 이만큼 넓혀 겹치게 한다. 안 넓히면 움직일 폭이 없다 */
const AREA_SLACK = 1.6;

/**
 * 목초지를 개체 수만큼 2차원 격자로 나눠 각자에게 한 칸씩 맡긴다.
 *
 * 처음에 세로 띠로만 나눴더니 가로로는 흩어져도 세로로는 다 같은 높이에 있어서, 여덟
 * 마리가 한 줄로 겹쳐 보였다. 목초지 비율에 맞춰 가로 세로로 모두 나눠야 흩어진다.
 *
 * 칸을 그대로 쓰면 움직일 폭이 스프라이트 크기밖에 안 남아 제자리걸음이 되므로 칸을
 * 조금 넓혀 서로 겹치게 한다. 시작 위치가 다르기 때문에 겹쳐도 뭉치지 않는다.
 */
function areaFor(bounds: Rect, index: number, count: number): Rect {
  if (count <= 1) {
    return bounds;
  }

  // 목초지가 가로로 길면 가로로 더 많이 나눈다.
  const aspect = bounds.height <= 0 ? 1 : bounds.width / bounds.height;
  const columns = Math.min(count, Math.max(1, Math.round(Math.sqrt(count * aspect))));
  const rows = Math.ceil(count / columns);

  const cellWidth = bounds.width / columns;
  const cellHeight = bounds.height / rows;
  const width = Math.min(bounds.width, Math.max(CRITTER_SIZE * 1.5, cellWidth * AREA_SLACK));
  const height = Math.min(bounds.height, Math.max(CRITTER_SIZE * 1.5, cellHeight * AREA_SLACK));

  const column = index % columns;
  const row = Math.floor(index / columns);
  // 칸 가운데를 기준으로 잡고 목초지 밖으로 나가지 않게 자른다.
  const centerX = bounds.x + (column + 0.5) * cellWidth;
  const centerY = bounds.y + (row + 0.5) * cellHeight;
  const x = Math.min(
    Math.max(bounds.x, centerX - width / 2),
    bounds.x + bounds.width - width,
  );
  const y = Math.min(
    Math.max(bounds.y, centerY - height / 2),
    bounds.y + bounds.height - height,
  );

  return { x, y, width, height };
}

export function createCritters(bounds: Rect, kinds: readonly number[], seed = 1): Critter[] {
  const random = createRandom(seed);
  return kinds.map((kind, index) => {
    const area = areaFor(bounds, index, kinds.length);
    const start = pickTarget(random, area);
    const target = pickTarget(random, area);
    return {
      kind,
      x: start.x,
      y: start.y,
      targetX: target.x,
      targetY: target.y,
      // 종류마다 속도를 조금 달리해 줄지어 움직이지 않게 한다.
      speed: 0.004 + random() * 0.004,
      facing: 1,
      waitUntil: 0,
      phase: index * 1.7 + random() * 3,
      area,
    };
  });
}

/**
 * 한 프레임 진행. 배열을 그 자리에서 고친다.
 * 매 프레임 새 배열을 만들 이유가 없고, 이 값은 저장되지도 공유되지도 않는다.
 */
export function updateCritters(
  critters: Critter[],
  timeMs: number,
  deltaMs: number,
  seed = 1,
): void {
  const random = createRandom(seed + Math.floor(timeMs / 100));

  for (const critter of critters) {
    if (timeMs < critter.waitUntil) {
      continue;
    }

    const dx = critter.targetX - critter.x;
    const dy = critter.targetY - critter.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 1) {
      // 도착. 잠깐 쉬었다가 다음 목표를 고른다. 쉬는 시간이 있어야 부산스럽지 않다.
      const next = pickTarget(random, critter.area);
      critter.targetX = next.x;
      critter.targetY = next.y;
      critter.waitUntil = timeMs + 800 + random() * 4000;
      continue;
    }

    const step = Math.min(distance, critter.speed * deltaMs);
    critter.x += (dx / distance) * step;
    critter.y += (dy / distance) * step;

    // 거의 수직으로 움직일 때는 방향을 바꾸지 않는다. 그러면 제자리에서 깜빡이듯 뒤집힌다.
    if (Math.abs(dx) > 0.4) {
      critter.facing = dx > 0 ? 1 : -1;
    }
  }
}
