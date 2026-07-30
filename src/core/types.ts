/**
 * 저장되는 상태의 타입 정의.
 *
 * 파일로 남는 구조라 필드를 함부로 바꾸면 기존 저장본을 못 읽는다. SCHEMA_VERSION 을
 * 같이 저장하고, 버전이 다르면 store.ts 에서 마이그레이션하거나 백업을 남기고 초기화한다.
 *
 * 핵심 설계는 농장 내부 시계(farmTimeMs)다. 성장을 벽시계로 직접 재면 두 가지가 깨진다.
 * 시스템 시계를 뒤로 돌리면 경과 시간이 음수가 되고, 앞으로 돌리면 무한히 자란다.
 * 그래서 벽시계는 "지난 실행 이후 얼마나 흘렀나"를 재는 데만 쓰고, 그 값을 0과
 * 오프라인 상한 사이로 자른 뒤 농장 시계에 더한다. 작물의 심은 시각도 농장 시계
 * 기준이라 상태가 시스템 시계와 무관하게 일관된다.
 */

import type { CropIndex } from "../assets/farmTiles";

export const SCHEMA_VERSION = 3;

/**
 * 밭 한 칸. 비어 있으면 null 이다.
 *
 * 성장 단계, 익은 시각, 자동 수확 시각은 저장하지 않는다. plantedAt 하나에서 전부
 * 계산되기 때문이다. 파생 가능한 값을 저장하면 둘이 어긋날 수 있고, 어긋난 상태를
 * 고치는 코드가 또 필요해진다.
 */
export interface Plot {
  crop: CropIndex;
  /** 심은 시각. 농장 시계 기준 밀리초 */
  plantedAt: number;
}

export interface FarmState {
  /** 농장 내부 시계. 단조 증가만 한다 */
  farmTimeMs: number;
  /** 마지막으로 정산한 벽시계 시각(epoch ms) */
  lastSeenAt: number;

  /** 길이는 항상 CONFIG.plotCountMax. 그중 앞의 plotCount 개만 열려 있다 */
  plots: (Plot | null)[];
  plotCount: number;

  /** 수확해서 쌓인 작물 수 */
  storage: number;
  storageCapacity: number;

  coins: number;
  /** 다음에 심을 작물. 심을 때마다 순환한다 */
  nextCrop: CropIndex;
  totalHarvests: number;

  /** 목초지에서 돌아다니는 동물 수. 창고 작물을 먹고 코인을 낸다 */
  animals: number;
  /** 마지막으로 사료를 준 시각. 농장 시계 기준 */
  lastFeedAt: number;
  /** 사둔 장식 수. 전경에 미리 정해둔 순서로 하나씩 나타난다 */
  decor: number;

  /** 이번 실행에서 정산으로 들어온 수확 수. 돌아왔을 때 알려주는 용도라 저장하지 않는다 */
  lastSettleHarvests?: number;
}

export interface AppState {
  version: number;
  farm: FarmState;
}
