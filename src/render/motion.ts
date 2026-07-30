/**
 * 움직임을 만드는 순수 함수들.
 *
 * Kenney 팩에는 애니메이션 프레임이 없다. 스프라이트마다 정지 그림 한 장뿐이다. 그래서
 * 프레임을 넘기는 방식이 아니라 위치와 오프셋을 흔드는 방식으로 움직임을 만든다.
 * 1px 만 움직여도 픽셀아트에서는 충분히 살아 있어 보인다.
 *
 * 여기 있는 함수는 모두 시간만 받아 결과를 내는 순수 함수다. 상태를 들고 있지 않으므로
 * 앱을 껐다 켜도 흐름이 튀지 않고, 같은 시각이면 항상 같은 그림이 나와서 스크린샷으로
 * 검증할 수 있다.
 */

/** 정수 시드에서 0..1 사이 값을 만든다. 위치를 흩뿌릴 때 쓴다 */
function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 바람. -1, 0, 1 중 하나를 낸다.
 * 소수 오프셋을 쓰면 타일 경계가 흐려지므로 정수로 반올림한다.
 */
export function wind(timeMs: number, phase: number): number {
  return Math.round(Math.sin(timeMs / 1400 + phase));
}

/** 위아래로 살짝 뛰는 느낌. 0 또는 -1 */
export function bob(timeMs: number, phase: number): number {
  return Math.sin(timeMs / 320 + phase) > 0.4 ? -1 : 0;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CloudShadow {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: number;
}

/**
 * 밭 위를 지나가는 구름 그림자. 구름 자체는 그리지 않는다. 하늘이 안 보이는
 * 내려다보는 시점이라 그림자만 있는 게 자연스럽고, 화면도 덜 시끄럽다.
 */
export function cloudShadows(timeMs: number, area: Rect, count = 2): CloudShadow[] {
  // 사각형으로 그리면 구름이 아니라 회색 판이 지나가는 것처럼 보인다. 호출하는 쪽에서
  // 타원으로 그리도록 중심과 반지름을 계산할 수 있게 폭/높이를 함께 준다.
  const shadows: CloudShadow[] = [];
  for (let index = 0; index < count; index += 1) {
    const width = 34 + Math.round(hash01(index * 7 + 1) * 26);
    const height = 12 + Math.round(hash01(index * 11 + 3) * 8);
    // 구름마다 속도가 달라야 겹쳐 보이지 않는다.
    const speed = 0.0035 + hash01(index * 13 + 5) * 0.0025;
    const span = area.width + width * 2;
    const drift = (timeMs * speed + hash01(index * 17 + 7) * span) % span;
    shadows.push({
      x: Math.round(area.x - width + drift),
      y: Math.round(area.y + hash01(index * 19 + 9) * (area.height - height)),
      width,
      height,
      alpha: 0.1,
    });
  }
  return shadows;
}

export interface Dot {
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
}

/**
 * 밤에 떠다니는 반딧불. 1px 점이라 부담이 없다.
 * 각 점은 자기 속도로 8자에 가까운 경로를 돈다.
 */
export function fireflies(timeMs: number, area: Rect, count = 7): Dot[] {
  const dots: Dot[] = [];
  for (let index = 0; index < count; index += 1) {
    const seedX = hash01(index * 3 + 1);
    const seedY = hash01(index * 5 + 2);
    const speed = 0.00035 + seedX * 0.0004;
    const x = area.x + (0.5 + 0.45 * Math.sin(timeMs * speed + index)) * area.width;
    const y = area.y + (0.5 + 0.4 * Math.sin(timeMs * speed * 1.7 + index * 2)) * area.height;
    // 밝기가 오르내려야 반짝이는 것처럼 보인다.
    const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(timeMs / 700 + index * 1.3 + seedY * 6));
    dots.push({ x: Math.round(x), y: Math.round(y), alpha: pulse });
  }
  return dots;
}

/** 낮에 밭 위로 뜨는 작은 반짝임. 샘플 이미지의 노란 반짝임과 같은 역할 */
export function sparkles(timeMs: number, area: Rect, count = 4): Dot[] {
  const dots: Dot[] = [];
  for (let index = 0; index < count; index += 1) {
    // 3초 주기로 자리를 바꾸며 켜졌다 꺼진다.
    const slot = Math.floor(timeMs / 3000) + index * 31;
    const x = area.x + Math.floor(hash01(slot * 2 + 1) * area.width);
    const y = area.y + Math.floor(hash01(slot * 3 + 2) * area.height);
    const phase = (timeMs % 3000) / 3000;
    const alpha = Math.sin(phase * Math.PI);
    if (alpha > 0.05) {
      dots.push({ x, y, alpha });
    }
  }
  return dots;
}

export interface Puff {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly alpha: number;
}

/** 헛간 굴뚝 연기. 위로 올라가며 커지고 흐려진다 */
export function smoke(timeMs: number, originX: number, originY: number, count = 3): Puff[] {
  const puffs: Puff[] = [];
  const cycleMs = 2600;
  for (let index = 0; index < count; index += 1) {
    const offset = (index / count) * cycleMs;
    const life = ((timeMs + offset) % cycleMs) / cycleMs;
    const drift = Math.sin(life * 3 + index) * 2;
    puffs.push({
      x: Math.round(originX + drift),
      y: Math.round(originY - life * 12),
      size: 1 + Math.round(life * 2),
      alpha: (1 - life) * 0.35,
    });
  }
  return puffs;
}
