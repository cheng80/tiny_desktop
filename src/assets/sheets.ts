/**
 * 타일시트 메타 정보와 로더.
 *
 * 시트는 모두 Kenney CC0 팩에서 가져온 "packed" 버전(타일 사이 여백 0px)이다.
 * 여백이 있는 tilemap.png 를 쓰면 인덱스 계산에 1px 보정이 끼어들어 실수가 나므로
 * packed 만 쓴다. 크기는 tools/tile_contact_sheet.py 로 검증했다.
 */

export const TILE_SIZE = 16;

export interface SheetMeta {
  /** public/ 기준 경로 */
  readonly url: string;
  /** 가로 타일 수 */
  readonly cols: number;
  /** 세로 타일 수 */
  readonly rows: number;
}

export const SHEETS = {
  /** Kenney Tiny Farm. 192x176 = 12x11 타일 */
  farm: { url: "/tiles/farm.png", cols: 12, rows: 11 },
  /** Kenney Tiny Town. 192x176 = 12x11 타일 */
  town: { url: "/tiles/town.png", cols: 12, rows: 11 },
  /** Kenney UI Pack Pixel Adventure, Small tiles / Thin outline. 368x112 = 23x7 타일 */
  ui: { url: "/tiles/ui.png", cols: 23, rows: 7 },
} as const satisfies Record<string, SheetMeta>;

export type SheetName = keyof typeof SHEETS;

export interface LoadedSheet {
  readonly meta: SheetMeta;
  readonly image: ImageBitmap;
}

export type SheetRegistry = Readonly<Record<SheetName, LoadedSheet>>;

async function loadSheet(meta: SheetMeta): Promise<LoadedSheet> {
  const response = await fetch(meta.url);
  if (!response.ok) {
    throw new Error(`타일시트 로드 실패: ${meta.url} (HTTP ${response.status})`);
  }
  const blob = await response.blob();
  // createImageBitmap 은 디코딩을 미리 끝내므로 첫 프레임에서 빈 화면이 뜨지 않는다.
  const image = await createImageBitmap(blob);

  const expectedWidth = meta.cols * TILE_SIZE;
  const expectedHeight = meta.rows * TILE_SIZE;
  if (image.width !== expectedWidth || image.height !== expectedHeight) {
    throw new Error(
      `타일시트 크기 불일치: ${meta.url} 는 ${expectedWidth}x${expectedHeight} 여야 하는데 ` +
        `${image.width}x${image.height} 이다`,
    );
  }

  return { meta, image };
}

/** 모든 시트를 병렬로 읽는다. 하나라도 실패하면 예외를 던진다. */
export async function loadAllSheets(): Promise<SheetRegistry> {
  const names = Object.keys(SHEETS) as SheetName[];
  const loaded = await Promise.all(names.map((name) => loadSheet(SHEETS[name])));

  const registry = {} as Record<SheetName, LoadedSheet>;
  names.forEach((name, index) => {
    registry[name] = loaded[index]!;
  });
  return registry;
}
