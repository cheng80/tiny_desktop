/**
 * 조율 가능한 숫자를 한곳에 모은다.
 *
 * 방치형은 숫자가 리듬을 만든다. 성장이 빠르면 지루하고 느리면 죽은 화면이 된다.
 * 나중에 감을 잡고 손볼 곳이 흩어져 있으면 안 되므로 전부 여기에 둔다.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const CONFIG = {
  /** 작물이 한 단계 자라는 데 걸리는 농장 시간 */
  growthStageMs: 20 * MINUTE,

  /**
   * 다 익은 뒤 자동 수확까지의 유예. 보고 있으면 직접 수확할 여유를 준다.
   * 직접 수확과 자동 수확의 보상은 같다. 직접 하는 쪽에 보너스를 주면 앱 앞에
   * 붙어 있어야 이득이 되고, 그건 느긋함의 반대다.
   */
  ripeGraceMs: 10 * MINUTE,

  /**
   * 앱이 꺼져 있던 시간을 한 번에 정산할 상한. 일주일 뒤에 열어도 이 이상은
   * 흐르지 않는다. 창고 용량과 함께 걸려서 돌아왔을 때의 양이 압도되지 않게 한다.
   */
  offlineCapMs: 8 * HOUR,

  /** 밭 */
  plotCountStart: 4,
  /** 전경에 마련한 밭 자리 수와 같아야 한다. layout.ts 의 PLOT_SLOTS 길이 */
  plotCountMax: 16,
  /** n번째 밭을 살 때의 값. 살수록 비싸진다 */
  plotPriceBase: 40,
  plotPriceStep: 25,

  /** 창고 */
  storageCapacityStart: 20,
  storageCapacityMax: 120,
  storageCapacityStep: 20,
  storagePriceBase: 30,
  storagePriceStep: 20,

  /**
   * 동물.
   *
   * 동물은 창고의 작물을 먹고 코인을 낸다. 잉여 작물의 두 번째 배출구다. 직접 파는 것보다
   * 코인이 조금 더 나와야 살 이유가 생긴다. 사료 간격은 밭 하나의 생산 속도(1시간에 1개)와
   * 맞춰서, 동물 수가 밭 수를 넘으면 창고가 줄어들게 했다. 그게 확장 순서를 만든다.
   */
  animalCountStart: 3,
  animalCountMax: 8,
  animalPriceBase: 60,
  animalPriceStep: 40,
  animalFeedMs: 60 * MINUTE,
  animalYield: 8,

  /**
   * 장식. 기능이 없고 전경만 채운다. 순수한 코인 배출구이자 꾸미는 재미다.
   * 배치는 미리 정해둔 순서로 하나씩 늘어난다. 배치 UI 를 만들면 위젯이 편집기가 된다.
   */
  decorCountMax: 8,
  decorPriceBase: 25,
  decorPriceStep: 15,

  /** 렌더 */
  targetFps: 12,

  /** 정산 루프 안전장치. 시계가 크게 튀어도 무한 루프에 빠지지 않게 한다 */
  settleMaxIterations: 10_000,
} as const;

/** 작물이 다 익기까지 걸리는 농장 시간. 성장 단계 수에 따라 파생된다 */
export function fullGrowthMs(stageCount: number): number {
  return CONFIG.growthStageMs * stageCount;
}

/** 다음 밭 한 칸의 값. 이미 가진 칸 수를 넣는다 */
export function plotPrice(currentCount: number): number {
  const step = Math.max(0, currentCount - CONFIG.plotCountStart);
  return CONFIG.plotPriceBase + step * CONFIG.plotPriceStep;
}

/** 다음 창고 확장의 값. 현재 용량을 넣는다 */
export function storagePrice(currentCapacity: number): number {
  const step = Math.max(
    0,
    Math.round((currentCapacity - CONFIG.storageCapacityStart) / CONFIG.storageCapacityStep),
  );
  return CONFIG.storagePriceBase + step * CONFIG.storagePriceStep;
}

/** 다음 동물의 값 */
export function animalPrice(currentCount: number): number {
  const step = Math.max(0, currentCount - CONFIG.animalCountStart);
  return CONFIG.animalPriceBase + step * CONFIG.animalPriceStep;
}

/** 다음 장식의 값 */
export function decorPrice(currentCount: number): number {
  return CONFIG.decorPriceBase + Math.max(0, currentCount) * CONFIG.decorPriceStep;
}
