/**
 * tiny_farm 타일 인덱스 SSoT.
 *
 * 이 시트는 12x11 격자가 완전히 규칙적이다. 행이 작물 종류, 열이 상태다.
 * 그래서 인덱스를 표로 나열하지 않고 공식으로 계산한다. 열 의미를 한 번만 정의하면
 * 작물이 6종이든 나중에 늘든 코드가 바뀌지 않는다.
 *
 * 측정으로 검증한 내용 (tmp/tile-audit/verify_grid.py):
 * - 열 4->5->6 알파 커버리지가 6개 행 전부 단조 증가한다. 자랄수록 픽셀이 늘어난다.
 * - 열 7 은 6개 행 전부 초록 픽셀 비율이 정확히 0.00 이다. 초록을 완전히 잃은 = 시든 상태.
 * - 열 9 커버리지는 6개 행 전부 204, 열 10 은 전부 160 이다. 동일 프레임에 내용물 색만
 *   다르다는 뜻이라 씨앗 용기가 맞다.
 * - 열 8 커버리지는 130~200 으로 행마다 다르다. 수확물 실물이라 모양이 달라서 그렇다.
 * - 흙 타일 커버리지는 256(완전 불투명)이다. 스프라이트가 아니라 지형 타일이다.
 *
 * 자동으로 알 수 없는 것은 작물 이름뿐이다. 아래 CROPS 배열이 그 부분이고, 눈으로 보고
 * 붙였다. 매핑을 의심하게 되면 tools/tile_contact_sheet.py 로 컨택트 시트를 다시 만들어
 * 대조하면 된다.
 */

import { SHEETS } from "./sheets";

const FARM_COLS = SHEETS.farm.cols;

/** 열 = 작물 상태. 행과 조합해 인덱스를 만든다. */
const COLUMN = {
  /** 성장 1단계 (새싹) */
  growth1: 4,
  /** 성장 2단계 */
  growth2: 5,
  /** 성장 3단계 (익음, 수확 가능) */
  growth3: 6,
  /** 시든 상태 */
  withered: 7,
  /** 수확물 아이콘 */
  produce: 8,
  /** 씨앗 봉지 */
  seedSack: 9,
  /** 씨앗 봉투 */
  seedPacket: 10,
  /** 수확 상자 */
  crate: 11,
} as const;

/** 성장 단계 열을 자란 순서대로 나열한 것. 단계 수는 이 배열 길이가 결정한다. */
const GROWTH_COLUMNS = [COLUMN.growth1, COLUMN.growth2, COLUMN.growth3] as const;

export const GROWTH_STAGE_COUNT = GROWTH_COLUMNS.length;

/**
 * 작물 종류. 배열 인덱스가 곧 타일시트의 행 번호다. 순서를 바꾸면 저장된 데이터의
 * 작물이 뒤바뀌므로 뒤에 추가만 하고 중간에 끼워넣지 않는다.
 */
export const CROPS = [
  { id: "carrot", label: "당근", reward: 3 },
  { id: "turnip", label: "순무", reward: 4 },
  { id: "corn", label: "옥수수", reward: 5 },
  { id: "tomato", label: "토마토", reward: 5 },
  { id: "cabbage", label: "양배추", reward: 6 },
  { id: "wheat", label: "밀", reward: 4 },
] as const;

export type CropIndex = number;

export const CROP_COUNT = CROPS.length;

function tileIndex(cropRow: CropIndex, column: number): number {
  if (cropRow < 0 || cropRow >= CROP_COUNT) {
    throw new Error(`작물 행 범위 초과: ${cropRow}`);
  }
  return cropRow * FARM_COLS + column;
}

/**
 * 성장 단계 스프라이트. stage 는 1부터 GROWTH_STAGE_COUNT 까지다.
 * stage 0 은 "심은 직후 아직 안 보이는 상태"로 취급하고 호출하지 않는다.
 */
export function growthTile(cropRow: CropIndex, stage: number): number {
  const column = GROWTH_COLUMNS[stage - 1];
  if (column === undefined) {
    throw new Error(`성장 단계 범위 초과: ${stage} (1..${GROWTH_STAGE_COUNT})`);
  }
  return tileIndex(cropRow, column);
}

export function witheredTile(cropRow: CropIndex): number {
  return tileIndex(cropRow, COLUMN.withered);
}

export function produceTile(cropRow: CropIndex): number {
  return tileIndex(cropRow, COLUMN.produce);
}

export function seedSackTile(cropRow: CropIndex): number {
  return tileIndex(cropRow, COLUMN.seedSack);
}

export function crateTile(cropRow: CropIndex): number {
  return tileIndex(cropRow, COLUMN.crate);
}

/**
 * 밭 지형 타일.
 *
 * 확대해서 확인한 구조(tools/tile_zoom.py):
 * - 0, 1 은 그 자체로 완결된 1칸짜리 둥근 밭이다. 조합용 조각이 아니다.
 * - 12/24/36 이 밝은 이랑의 위/중간/아래, 13/25/37 이 어두운 이랑의 위/중간/아래다.
 *
 * 처음에 0,1 을 위쪽 조각으로 착각해서 2x2 로 붙였더니 이어지지 않고 덩어리 네 개로
 * 보였다. 이랑은 세로로만 이어지므로, 2x2 구획은 밝은 이랑과 어두운 이랑을 나란히 세워
 * 만든다. 색이 번갈아 나오는 게 실제 밭의 두둑처럼 보인다.
 */
export const SOIL = {
  furrowLightTop: 12,
  furrowLightMiddle: 24,
  furrowLightBottom: 36,
  furrowDarkTop: 13,
  furrowDarkMiddle: 25,
  furrowDarkBottom: 37,
  /** 1칸으로 끝나는 둥근 밭. 좁은 자리에 쓴다 */
  single: 0,
} as const;

/**
 * 헛간. 3칸 폭, 4칸 높이로 위에서 아래로 쌓는다.
 *
 * 처음에 지붕 두 줄에 문 한 줄만 올렸더니 지붕이 문 위에 바로 얹혀서 건물로 보이지 않았다.
 * 지붕과 문 사이에 X 보강재가 있는 벽 줄이 들어가야 형태가 잡힌다.
 */
/**
 * 헛간.
 *
 * 시트에서 이 물건이 어떻게 조립되는지가 그대로 드러난다(tools/sheet_view.py 로 확인).
 * 시트 열 6~8, 행 7~10 에 3x4 벽 블록이 붙어 있고, 열 9~11 의 같은 행에 3x4 지붕 블록이
 * 붙어 있다. 각 블록을 시트에 놓인 순서 그대로 쌓고, 지붕을 벽 위에 겹치면 된다.
 *
 * 지붕 아래끝(117~119)은 가운데가 아래로 파인 모양이고 그 아래가 비어 있다. 그래서
 * 벽을 먼저 깔아두면 그 틈으로 X 보강재가 있는 벽 윗줄이 비쳐 지붕과 벽이 만나는 부분이
 * 생긴다. 지붕만 쌓으면 그 자리에 풀이 보여 건물이 떠 있는 것처럼 된다.
 *
 * 처음에 벽 줄 순서를 뒤섞고 지붕을 얇게 깎아서 건물로 보이지 않았다.
 */
export const BARN = {
  /**
   * 지붕 블록. 네 줄 전체를 써야 한다.
   *
   * 아래 두 줄(117~119, 129~131)이 가운데를 V 자로 파낸 모양이다. 그 V 가 건물 정면의
   * 삼각 게이블이 드러나는 자리다. 지붕을 세 줄로 자르면 V 가 얕아져서 X 보강재가 통째로
   * 노출되고, 헛간이 아니라 책장처럼 보인다.
   */
  roof: [
    [93, 94, 95],
    [105, 106, 107],
    [117, 118, 119],
    [129, 130, 131],
  ],
  /**
   * 벽. 지붕의 V 안으로 비칠 X 게이블, 벽 한 줄, 가운데 문 한 줄이다.
   *
   * 126/127/128 은 한 줄이 아니라 문과 창의 세 가지 대안이다. 세 개를 나란히 놓으면
   * 헛간에 문이 셋 달린 꼴이 된다. 가운데에 하나만 놓고 좌우는 벽으로 채운다.
   * 102~104(판벽)는 층이 하나 더 있는 큰 건물용이라 쓰지 않는다.
   */
  walls: [
    [90, 91, 92],
    [114, 115, 116],
    [114, 127, 116],
  ],
} as const;

/** 헛간이 차지하는 칸. 지붕 4줄과 벽 3줄이 두 줄 겹친다 */
export const BARN_SIZE = { cols: 3, rows: 5 } as const;
/** 벽 블록이 시작하는 줄. 지붕의 V 가 시작하는 위치다 */
export const BARN_WALL_OFFSET = 2;

/**
 * 위아래 두 칸이 한 쌍인 나무들. 시트에서도 위아래로 붙어 있다.
 * 아랫부분만 놓으면 위가 잘린 나무가 되고, 윗부분만 놓으면 공중에 뜬 수관이 된다.
 */
export const TREE_PAIRS = {
  /** 침엽수 */
  pine: { top: 3, bottom: 15 },
  /** 잎이 없는 마른 나무 */
  deadTall: { top: 2, bottom: 14 },
  /** 잎이 없는 낮은 마른 나무 */
  deadShort: { top: 26, bottom: 38 },
} as const;

/**
 * 한 칸으로 완결된 장식. 시트 문맥에서 정체를 확인한 것만 남겼다.
 *
 * 뺀 것과 이유:
 * - 80 잡초 새싹, 81 흙에 심긴 모종은 작물처럼 보인다. 밭이 아닌 곳에 두면 작물이
 *   엉뚱한 데 자란 것처럼 된다.
 * - 79 는 정체가 모호해서 지붕 조각처럼 보인다는 지적을 받았다.
 * - 84 갈퀴, 86 망치, 87 도끼, 88 낫은 도구다. 풀밭이나 밭에 흩어놓으면 버려진 물건처럼
 *   보이고, 흙 위에 놓아도 딱히 농장답지 않았다.
 * - 2 와 14, 26 과 38 은 낱개가 아니라 마른 나무 쌍이다. TREE_PAIRS 로 옮겼다.
 */
export const DECOR = {
  /** 한 칸으로 완결된 작은 침엽수 */
  pineSmall: 27,
  /** 둥근 관목 */
  bush: 39,
  /** 열매 관목 */
  berryBush: 78,
  /** 작은 돌 두 개 */
  stones: 77,
  /** 큰 돌무더기 */
  rocks: 89,
  /** 해바라기. 심어놓은 것처럼 보이므로 밭 가장자리에만 둔다 */
  sunflower: 83,
  farmerFront: 108,
  farmerHat: 109,
  sheep: 120,
  cow: 121,
  chicken: 122,
} as const;

/** 헛간 앞마당에 두는 살림살이. 한 칸짜리만 */
export const YARD_PROPS = {
  troughEmpty: 72,
  troughWater: 73,
  haySack: 74,
  barrel: 75,
  crate: 76,
  hayBale: 85,
  hayBlock: 96,
  hayPile: 125,
} as const;

/**
 * 두 칸 폭 물건. 시트에서 좌우로 붙어 있다.
 * 한 칸만 놓으면 반쪽이 되므로 항상 짝으로 그린다.
 */
export const WIDE_PROPS = {
  /** 나무 여물통 */
  troughWood: [98, 99],
  /** 금속 여물통 */
  troughMetal: [100, 101],
  /** 물이 담긴 여물통 */
  troughWater: [110, 111],
  /** 사료가 담긴 여물통 */
  troughFeed: [112, 113],
} as const;
