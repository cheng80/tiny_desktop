/**
 * 농장 상태 로직.
 *
 * 성장은 이벤트가 아니라 시간이다. 예전 설계는 집중 세션을 끝낼 때만 한 단계씩 자랐고,
 * 그 사이 25분은 화면이 완전히 멈춰 있었다. 지금은 농장 시계가 흐르면 자라고, 앱이
 * 꺼져 있던 동안도 정산해서 채운다.
 *
 * settle() 하나가 오프라인 정산과 실행 중 진행을 모두 처리한다. 경로를 둘로 나누면
 * 오프라인에서만 나는 버그가 생기는데, 그게 제일 잡기 어려운 종류다.
 *
 * 실패 상태는 없다. 시들지 않고, 안 돌봐서 손해 보는 일도 없다. 방치를 벌하면
 * 방치형이 아니라 숙제가 된다.
 */

import { CROP_COUNT, CROPS, GROWTH_STAGE_COUNT } from "../assets/farmTiles";
import {
  animalPrice,
  CONFIG,
  decorPrice,
  plotPrice,
  storagePrice,
} from "./config";
import type { FarmState, Plot } from "./types";

/** 작물이 다 익는 농장 시간 */
const FULL_GROWTH_MS = CONFIG.growthStageMs * GROWTH_STAGE_COUNT;

export function createFarmState(now: number): FarmState {
  const plots: (Plot | null)[] = Array.from({ length: CONFIG.plotCountMax }, () => null);

  // 첫 실행에 빈 밭만 보이면 볼 게 없다. 열린 칸에 미리 심어두고 시작한다.
  for (let index = 0; index < CONFIG.plotCountStart; index += 1) {
    plots[index] = { crop: index % CROP_COUNT, plantedAt: 0 };
  }

  return {
    farmTimeMs: 0,
    lastSeenAt: now,
    plots,
    plotCount: CONFIG.plotCountStart,
    storage: 0,
    storageCapacity: CONFIG.storageCapacityStart,
    coins: 0,
    nextCrop: CONFIG.plotCountStart % CROP_COUNT,
    totalHarvests: 0,
    animals: CONFIG.animalCountStart,
    lastFeedAt: 0,
    decor: 0,
  };
}

/** 다 익는 시각(농장 시계 기준) */
export function ripeAt(plot: Plot): number {
  return plot.plantedAt + FULL_GROWTH_MS;
}

/** 자동 수확 시각(농장 시계 기준) */
export function autoHarvestAt(plot: Plot): number {
  return ripeAt(plot) + CONFIG.ripeGraceMs;
}

/** 0 = 아직 안 보임, 1..GROWTH_STAGE_COUNT = 성장 단계 */
export function growthStage(plot: Plot, farmTime: number): number {
  const elapsed = farmTime - plot.plantedAt;
  if (elapsed <= 0) {
    return 0;
  }
  return Math.min(GROWTH_STAGE_COUNT, Math.floor(elapsed / CONFIG.growthStageMs));
}

export function isRipe(plot: Plot | null, farmTime: number): boolean {
  return plot !== null && farmTime >= ripeAt(plot);
}

/** 현재 단계에서 다음 단계까지의 진행률 0..1. 익었으면 1 */
export function stageProgress(plot: Plot, farmTime: number): number {
  if (farmTime >= ripeAt(plot)) {
    return 1;
  }
  const elapsed = Math.max(0, farmTime - plot.plantedAt);
  return (elapsed % CONFIG.growthStageMs) / CONFIG.growthStageMs;
}

export function isStorageFull(farm: FarmState): boolean {
  return farm.storage >= farm.storageCapacity;
}

/**
 * 농장 시계를 현재까지 진행시키고, 그동안 일어난 자동 수확을 순서대로 처리한다.
 *
 * 벽시계 차이를 0 과 오프라인 상한 사이로 자르는 게 핵심이다. 시계를 뒤로 돌리면
 * 0 이 되어 시간이 멈추고(음수 경과로 상태가 깨지는 것을 막는다), 앞으로 크게 돌리면
 * 상한에 걸린다.
 *
 * 자동 수확을 밭 순서가 아니라 시각 순서로 처리하는 이유는 창고 용량이 공유 자원이기
 * 때문이다. 순서를 섞으면 어느 밭이 마지막 한 칸을 차지하는지가 달라진다.
 */
export function settle(farm: FarmState, now: number): FarmState {
  const delta = Math.min(Math.max(0, now - farm.lastSeenAt), CONFIG.offlineCapMs);
  const targetTime = farm.farmTimeMs + delta;

  let plots = farm.plots;
  let cloned = false;
  let storage = farm.storage;
  let coins = farm.coins;
  let totalHarvests = farm.totalHarvests;
  let nextCrop = farm.nextCrop;
  let lastFeedAt = farm.lastFeedAt;
  let settledHarvests = 0;

  for (let guard = 0; guard < CONFIG.settleMaxIterations; guard += 1) {
    // 사건은 두 종류다. 밭의 자동 수확과 동물의 사료 시각.
    // 둘을 시각 순서로 처리해야 결과가 맞는다. 수확이 먼저면 그 작물을 동물이 먹을 수 있고,
    // 사료가 먼저면 못 먹는다. 창고가 공유 자원이라 순서가 결과를 바꾼다.
    let bestTime = Number.POSITIVE_INFINITY;
    let harvestIndex = -1;

    if (storage < farm.storageCapacity) {
      for (let index = 0; index < farm.plotCount; index += 1) {
        const plot = plots[index];
        if (!plot) {
          continue;
        }
        const time = autoHarvestAt(plot);
        if (time <= targetTime && time < bestTime) {
          bestTime = time;
          harvestIndex = index;
        }
      }
    }

    let feedTime = Number.POSITIVE_INFINITY;
    if (farm.animals > 0) {
      const candidate = lastFeedAt + CONFIG.animalFeedMs;
      if (candidate <= targetTime) {
        feedTime = candidate;
      }
    }

    // 사료가 더 이르면 사료를 먼저 처리한다. 같으면 수확을 먼저 해서 갓 나온 작물을 먹인다.
    if (feedTime < bestTime) {
      lastFeedAt = feedTime;
      const eaten = Math.min(farm.animals, storage);
      storage -= eaten;
      coins += eaten * CONFIG.animalYield;
      continue;
    }

    if (harvestIndex < 0) {
      break;
    }

    if (!cloned) {
      plots = [...plots];
      cloned = true;
    }
    // 수확한 그 시각에 곧바로 다시 심는다. 그래야 자리를 비운 시간이 통째로 버려지지 않는다.
    plots[harvestIndex] = { crop: nextCrop, plantedAt: bestTime };
    nextCrop = (nextCrop + 1) % CROP_COUNT;
    storage += 1;
    totalHarvests += 1;
    settledHarvests += 1;
  }

  // 동물이 없으면 사료 시계가 뒤처진 채로 남는다. 나중에 동물을 사자마자 몰아서
  // 먹는 일이 생기지 않게 현재로 끌어올린다.
  if (farm.animals === 0) {
    lastFeedAt = targetTime;
  }

  return {
    ...farm,
    plots,
    storage,
    coins,
    totalHarvests,
    nextCrop,
    lastFeedAt,
    farmTimeMs: targetTime,
    lastSeenAt: now,
    lastSettleHarvests: settledHarvests,
  };
}

/** 빈 칸에 심는다. 이미 뭔가 있으면 그대로 둔다 */
export function plant(farm: FarmState, index: number): FarmState {
  if (index < 0 || index >= farm.plotCount || farm.plots[index]) {
    return farm;
  }
  const plots = [...farm.plots];
  plots[index] = { crop: farm.nextCrop, plantedAt: farm.farmTimeMs };
  return { ...farm, plots, nextCrop: (farm.nextCrop + 1) % CROP_COUNT };
}

/** 직접 수확. 창고가 차 있으면 아무 일도 없다 */
export function harvest(farm: FarmState, index: number): FarmState {
  const plot = farm.plots[index] ?? null;
  if (!isRipe(plot, farm.farmTimeMs) || isStorageFull(farm)) {
    return farm;
  }
  const plots = [...farm.plots];
  // 수확하면 바로 다음 작물이 들어간다. 빈 칸으로 두면 매번 심어줘야 해서 의무가 된다.
  plots[index] = { crop: farm.nextCrop, plantedAt: farm.farmTimeMs };
  return {
    ...farm,
    plots,
    nextCrop: (farm.nextCrop + 1) % CROP_COUNT,
    storage: farm.storage + 1,
    totalHarvests: farm.totalHarvests + 1,
  };
}

/** 밭을 눌렀을 때. 익었으면 수확, 비었으면 심기, 그 외에는 아무 일 없음 */
export function tapPlot(farm: FarmState, index: number): FarmState {
  if (index < 0 || index >= farm.plotCount) {
    return farm;
  }
  const plot = farm.plots[index] ?? null;
  if (plot === null) {
    return plant(farm, index);
  }
  if (isRipe(plot, farm.farmTimeMs)) {
    return harvest(farm, index);
  }
  return farm;
}

/**
 * 창고를 비워 코인으로 바꾼다. 작물별 값이 다르지만 창고에 종류를 따로 담지 않으므로
 * 평균값으로 정산한다. 종류별 재고까지 관리하게 만들면 화면에 표가 필요해지고,
 * 그건 이 위젯의 크기와 성격에 맞지 않는다.
 */
const AVERAGE_REWARD = Math.round(
  CROPS.reduce((sum, crop) => sum + crop.reward, 0) / CROPS.length,
);

export function sellStorage(farm: FarmState): FarmState {
  if (farm.storage <= 0) {
    return farm;
  }
  return {
    ...farm,
    coins: farm.coins + farm.storage * AVERAGE_REWARD,
    storage: 0,
  };
}

export function nextPlotPrice(farm: FarmState): number | null {
  if (farm.plotCount >= CONFIG.plotCountMax) {
    return null;
  }
  return plotPrice(farm.plotCount);
}

export function buyPlot(farm: FarmState): FarmState {
  const price = nextPlotPrice(farm);
  if (price === null || farm.coins < price) {
    return farm;
  }
  const plots = [...farm.plots];
  // 새 칸은 바로 심어준다. 빈 칸으로 열어두면 사고 나서 또 눌러야 한다.
  plots[farm.plotCount] = { crop: farm.nextCrop, plantedAt: farm.farmTimeMs };
  return {
    ...farm,
    plots,
    plotCount: farm.plotCount + 1,
    nextCrop: (farm.nextCrop + 1) % CROP_COUNT,
    coins: farm.coins - price,
  };
}

export function nextStoragePrice(farm: FarmState): number | null {
  if (farm.storageCapacity >= CONFIG.storageCapacityMax) {
    return null;
  }
  return storagePrice(farm.storageCapacity);
}

export function buyStorage(farm: FarmState): FarmState {
  const price = nextStoragePrice(farm);
  if (price === null || farm.coins < price) {
    return farm;
  }
  return {
    ...farm,
    storageCapacity: farm.storageCapacity + CONFIG.storageCapacityStep,
    coins: farm.coins - price,
  };
}

/**
 * 다음 수확까지의 진행률 0..1.
 *
 * 단계 진행률의 최대값을 쓰면 익은 칸이 하나만 있어도 늘 100% 로 보여 아무 정보가 없다.
 * 아직 안 익은 칸 중 가장 먼저 익을 칸을 기준으로 잰다. 이미 다 익었으면 1 이다.
 */
export function nextHarvestProgress(farm: FarmState): number {
  let bestRemaining = Number.POSITIVE_INFINITY;
  let hasPlanted = false;

  for (let index = 0; index < farm.plotCount; index += 1) {
    const plot = farm.plots[index] ?? null;
    if (plot === null) {
      continue;
    }
    hasPlanted = true;
    const remaining = ripeAt(plot) - farm.farmTimeMs;
    if (remaining > 0 && remaining < bestRemaining) {
      bestRemaining = remaining;
    }
  }

  if (!hasPlanted) {
    return 0;
  }
  if (bestRemaining === Number.POSITIVE_INFINITY) {
    return 1;
  }
  return Math.min(1, Math.max(0, 1 - bestRemaining / FULL_GROWTH_MS));
}

export function nextAnimalPrice(farm: FarmState): number | null {
  if (farm.animals >= CONFIG.animalCountMax) {
    return null;
  }
  return animalPrice(farm.animals);
}

export function buyAnimal(farm: FarmState): FarmState {
  const price = nextAnimalPrice(farm);
  if (price === null || farm.coins < price) {
    return farm;
  }
  return { ...farm, animals: farm.animals + 1, coins: farm.coins - price };
}

export function nextDecorPrice(farm: FarmState): number | null {
  if (farm.decor >= CONFIG.decorCountMax) {
    return null;
  }
  return decorPrice(farm.decor);
}

export function buyDecor(farm: FarmState): FarmState {
  const price = nextDecorPrice(farm);
  if (price === null || farm.coins < price) {
    return farm;
  }
  return { ...farm, decor: farm.decor + 1, coins: farm.coins - price };
}

/** 수확 대기 중인 칸 수 */
export function ripeCount(farm: FarmState): number {
  let count = 0;
  for (let index = 0; index < farm.plotCount; index += 1) {
    if (isRipe(farm.plots[index] ?? null, farm.farmTimeMs)) {
      count += 1;
    }
  }
  return count;
}
