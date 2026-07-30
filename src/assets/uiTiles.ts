/**
 * UI 팩(Small tiles / Thin outline, 23x7) 인덱스 SSoT.
 *
 * 이 시트는 tiny_farm 과 달리 규칙적이지 않다. 버튼, 패널, 게이지가 섞여 있어서
 * 공식으로 뽑을 수 없고 눈으로 골라 상수로 박았다. tools/tile_zoom.py 로 확대해
 * 테두리 두께까지 확인한 결과다.
 *
 * 확인된 것:
 * - 10 = 갈색 테두리 + 크림 내부 패널. 테두리 4px 이라 9-슬라이스 여백이 4다.
 * - 152/153/154 = 가로 3-슬라이스 컨테이너(왼쪽/가운데/오른쪽). 빨간 테두리 3px,
 *   내부는 회청색. 프로그레스바 트랙으로 쓴다.
 * - 49 = 가로로 긴 크림색 버튼. 좌우 테두리가 얇아 가로 3-슬라이스가 된다.
 * - 23/24 = 갈색 원형 버튼. 24 는 가운데가 밝아 눌린/활성 상태로 쓸 수 있다.
 */

/** 9-슬라이스로 늘려 쓸 패널. 여백은 NINE_SLICE_INSET 을 함께 쓴다. */
export const PANEL = {
  /** 갈색 나무틀 + 크림 내부. 농장 톤에 맞는 기본 패널 */
  wood: 10,
  /** 회청색 패널. 보조 영역용 */
  slate: 12,
} as const;

/** PANEL 타일의 테두리 두께(원본 픽셀). 9-슬라이스 모서리 크기다. */
export const NINE_SLICE_INSET = 4;

/** 가로 3-슬라이스 트랙. 왼쪽 캡 / 반복 구간 / 오른쪽 캡. */
export const BAR_TRACK = {
  left: 152,
  middle: 153,
  right: 154,
} as const;

/** BAR_TRACK 내부 여백(원본 픽셀). 이 안쪽을 채워 게이지를 표현한다. */
export const BAR_INSET = { x: 3, y: 3 } as const;

/** 가로 3-슬라이스 버튼. 라벨은 비트맵 폰트로 직접 그린다. */
export const BUTTON = {
  left: 49,
  middle: 49,
  right: 49,
} as const;

/** 원형 아이콘 버튼. */
export const ROUND_BUTTON = {
  idle: 23,
  active: 24,
  close: 25,
} as const;

/**
 * 팩 팔레트에서 뽑은 색. 게이지 내부처럼 타일로 채우기 어려운 곳에 쓴다.
 * 정수 좌표에 단색 사각형으로 칠하면 타일과 구분되지 않는다.
 */
export const COLORS = {
  /** 작물 성장 게이지 채움 */
  cropFill: "#5a9e3c",
  /** 게이지 빈 공간 */
  trackEmpty: "#c9b48f",
  /** 본문 텍스트 */
  ink: "#4a3427",
  /** 흐린 텍스트 */
  inkMuted: "#8a6f5c",
  /** 밝은 텍스트(어두운 배경 위) */
  inkLight: "#fdf3d8",
  /** 코인/강조 */
  gold: "#f2b13c",
  /** 전경 영역 테두리. 풀밭이 패널 위에 그냥 얹힌 것처럼 보이지 않게 감싼다 */
  sceneEdge: "#6b4a35",
  /**
   * 패널 타일의 바깥 테두리색. 시트에서 직접 뽑았다.
   *
   * PANEL.wood 타일은 네 모서리 픽셀이 비어 있어 둥글게 처리돼 있다. 9-슬라이스로 창
   * 전체를 채우면 창에 투명 픽셀 4개가 남고, macOS 에서 투명 창을 쓰려면 private API 를
   * 켜야 해서 App Store 심사를 통과할 수 없게 된다. 창 전체를 이 색으로 먼저 칠해 모서리를
   * 메운다. 모서리 4픽셀이 각지는 대신 배포 경로가 열린다.
   */
  panelEdge: "#6d4b27",
  /** 선택된 밭 강조 */
  selection: "#fdf3d8",
} as const;
