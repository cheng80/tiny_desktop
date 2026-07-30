/**
 * 낮밤 사이클.
 *
 * 농장 시계가 아니라 사용자의 실제 로컬 시간을 따른다. 책상에 띄워두는 위젯이라
 * 화면의 밝기가 창밖과 맞아야 자연스럽다. 성장은 농장 시계, 조명은 벽시계로 나누는 게
 * 헷갈릴 수 있지만, 둘의 목적이 다르다. 성장은 시계 조작에 흔들리면 안 되고, 조명은
 * 오히려 시계를 그대로 따라야 한다.
 *
 * 구현은 시각별 키프레임 사이 보간이다. 전경 위에 multiply 로 얹어서 타일 색을 눌러준다.
 */

interface Keyframe {
  /** 0..24 시각 */
  readonly hour: number;
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  /** 0 이면 원본 그대로 */
  readonly strength: number;
}

/**
 * 자정에서 시작해 자정으로 끝난다. 첫/마지막 키프레임의 색이 같아야 하루가 이어진다.
 * 낮 구간(8~16시)은 strength 0 이라 타일 원색이 그대로 나온다.
 */
const KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, red: 36, green: 58, blue: 152, strength: 0.64 },
  { hour: 4.5, red: 40, green: 62, blue: 150, strength: 0.58 },
  { hour: 6, red: 150, green: 110, blue: 130, strength: 0.34 },
  { hour: 7.5, red: 255, green: 190, blue: 140, strength: 0.16 },
  { hour: 9, red: 255, green: 255, blue: 255, strength: 0 },
  { hour: 16.5, red: 255, green: 255, blue: 255, strength: 0 },
  { hour: 18, red: 255, green: 176, blue: 120, strength: 0.2 },
  { hour: 19.5, red: 130, green: 95, blue: 135, strength: 0.45 },
  { hour: 21, red: 40, green: 62, blue: 150, strength: 0.6 },
  { hour: 24, red: 36, green: 58, blue: 152, strength: 0.64 },
];

export interface Daylight {
  /** multiply 로 얹을 색. strength 가 0 이면 null */
  readonly tint: string | null;
  /** 반딧불을 띄울 만큼 어두운지 */
  readonly isNight: boolean;
  /** 0..24. 디버깅과 테스트용 */
  readonly hour: number;
}

function lerp(from: number, to: number, ratio: number): number {
  return from + (to - from) * ratio;
}

/** 로컬 시각을 0..24 실수로 바꾼다 */
export function hourOfDay(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

export function daylight(date: Date): Daylight {
  const hour = hourOfDay(date);

  let previous = KEYFRAMES[0]!;
  let next = KEYFRAMES[KEYFRAMES.length - 1]!;
  for (let index = 0; index < KEYFRAMES.length - 1; index += 1) {
    const current = KEYFRAMES[index]!;
    const following = KEYFRAMES[index + 1]!;
    if (hour >= current.hour && hour <= following.hour) {
      previous = current;
      next = following;
      break;
    }
  }

  const span = next.hour - previous.hour;
  const ratio = span <= 0 ? 0 : (hour - previous.hour) / span;

  const strength = lerp(previous.strength, next.strength, ratio);
  if (strength <= 0.005) {
    return { tint: null, isNight: false, hour };
  }

  const red = Math.round(lerp(previous.red, next.red, ratio));
  const green = Math.round(lerp(previous.green, next.green, ratio));
  const blue = Math.round(lerp(previous.blue, next.blue, ratio));

  return {
    // multiply 로 곱하므로 흰색에서 목표색 쪽으로 strength 만큼 당긴 색을 만든다.
    tint: `rgb(${Math.round(lerp(255, red, strength))}, ${Math.round(
      lerp(255, green, strength),
    )}, ${Math.round(lerp(255, blue, strength))})`,
    isNight: strength > 0.4,
    hour,
  };
}
