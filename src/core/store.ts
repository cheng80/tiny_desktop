/**
 * 상태 영속화.
 *
 * localStorage 대신 파일에 쓴다. 웹뷰 저장소는 위치가 불투명해서 백업하거나 다른 기기로
 * 옮길 수 없고, 웹뷰 데이터가 초기화되면 같이 날아간다. 실제 JSON 파일이면 사용자가
 * 열어보고 복사할 수 있다. 저장 위치는 Rust 쪽이 정한다.
 *
 * 읽기에 실패했을 때 그냥 초기화하지 않고 기존 파일을 백업으로 옮기는 게 중요하다.
 * 방치형은 시간이 쌓인 결과가 전부라, 잘못 버리면 되돌릴 방법이 없다.
 *
 * Tauri 없이 `npm run dev` 로 브라우저에서 열어볼 때도 동작해야 하므로 그때는
 * localStorage 로 떨어진다. 개발용 경로다.
 */

import { CROP_COUNT } from "../assets/farmTiles";
import { CONFIG } from "./config";
import { createFarmState } from "./farm";
import { SCHEMA_VERSION, type AppState } from "./types";

const DEV_STORAGE_KEY = "tiny-farm-state";
const SAVE_DEBOUNCE_MS = 500;

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function createInitialState(now: number): AppState {
  return {
    version: SCHEMA_VERSION,
    farm: createFarmState(now),
  };
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * 읽어온 값이 기대하는 모양인지 확인한다. 사용자가 손으로 고칠 수 있는 파일이라
 * 깨진 값이 들어와도 앱이 죽지 않아야 한다.
 */
function validate(raw: unknown): AppState | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const candidate = raw as Partial<AppState>;
  if (candidate.version !== SCHEMA_VERSION) {
    return null;
  }
  const farm = candidate.farm;
  if (typeof farm !== "object" || farm === null) {
    return null;
  }

  if (!isNonNegativeInteger(farm.storage) || !isNonNegativeInteger(farm.coins)) {
    return null;
  }
  if (!isNonNegativeInteger(farm.totalHarvests)) {
    return null;
  }
  if (
    !Number.isInteger(farm.animals) ||
    farm.animals < 0 ||
    farm.animals > CONFIG.animalCountMax
  ) {
    return null;
  }
  if (!Number.isInteger(farm.decor) || farm.decor < 0 || farm.decor > CONFIG.decorCountMax) {
    return null;
  }
  if (typeof farm.lastFeedAt !== "number" || !Number.isFinite(farm.lastFeedAt)) {
    return null;
  }
  if (typeof farm.farmTimeMs !== "number" || !Number.isFinite(farm.farmTimeMs)) {
    return null;
  }
  if (typeof farm.lastSeenAt !== "number" || !Number.isFinite(farm.lastSeenAt)) {
    return null;
  }
  if (
    !Number.isInteger(farm.plotCount) ||
    farm.plotCount < 1 ||
    farm.plotCount > CONFIG.plotCountMax
  ) {
    return null;
  }
  if (
    !Number.isInteger(farm.storageCapacity) ||
    farm.storageCapacity < 1 ||
    farm.storageCapacity > CONFIG.storageCapacityMax
  ) {
    return null;
  }
  if (!Number.isInteger(farm.nextCrop) || farm.nextCrop < 0 || farm.nextCrop >= CROP_COUNT) {
    return null;
  }
  if (!Array.isArray(farm.plots) || farm.plots.length !== CONFIG.plotCountMax) {
    return null;
  }
  for (const plot of farm.plots) {
    if (plot === null) {
      continue;
    }
    if (typeof plot !== "object") {
      return null;
    }
    const cropValid = Number.isInteger(plot.crop) && plot.crop >= 0 && plot.crop < CROP_COUNT;
    const plantedValid = typeof plot.plantedAt === "number" && Number.isFinite(plot.plantedAt);
    if (!cropValid || !plantedValid) {
      return null;
    }
  }

  return candidate as AppState;
}

async function readRaw(): Promise<string | null> {
  if (!hasTauri()) {
    return window.localStorage.getItem(DEV_STORAGE_KEY);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("load_state");
}

async function writeRaw(payload: string): Promise<void> {
  if (!hasTauri()) {
    window.localStorage.setItem(DEV_STORAGE_KEY, payload);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_state", { payload });
}

/**
 * 기존 저장본을 백업으로 옮긴다. 버릴 상황에서도 원본을 남기기 위한 것이다.
 * 반환값은 백업 경로이고, 옮길 파일이 없었으면 null 이다.
 */
async function archiveRaw(suffix: string): Promise<string | null> {
  if (!hasTauri()) {
    const existing = window.localStorage.getItem(DEV_STORAGE_KEY);
    if (existing === null) {
      return null;
    }
    const key = `${DEV_STORAGE_KEY}.${suffix}`;
    window.localStorage.setItem(key, existing);
    window.localStorage.removeItem(DEV_STORAGE_KEY);
    return key;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("archive_state", { suffix });
}

/** 기존 농장을 백업하고 fresh 상태 저장 실패 시 원본을 복구한다. */
async function resetRaw(suffix: string, payload: string): Promise<string | null> {
  if (!hasTauri()) {
    const existing = window.localStorage.getItem(DEV_STORAGE_KEY);
    const backup = existing === null ? null : `${DEV_STORAGE_KEY}.${suffix}`;
    if (existing !== null && backup !== null) {
      window.localStorage.setItem(backup, existing);
    }
    // 기존 key를 먼저 지우지 않으므로 setItem 실패 시 기존 농장이 그대로 남는다.
    window.localStorage.setItem(DEV_STORAGE_KEY, payload);
    return backup;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("reset_state", { suffix, payload });
}

function timestampSuffix(now: number): string {
  // 파일명에 쓰므로 콜론을 뺀다.
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

export async function loadState(now: number): Promise<AppState> {
  let raw: string | null = null;
  try {
    raw = await readRaw();
  } catch (error) {
    console.error("상태 읽기 실패, 새로 시작한다", error);
    return createInitialState(now);
  }

  if (raw === null) {
    return createInitialState(now);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("상태 파싱 실패", error);
    parsed = null;
  }

  const validated = parsed === null ? null : validate(parsed);
  if (validated !== null) {
    return validated;
  }

  // 버리기 전에 원본을 남긴다. 스키마가 올라갔을 때 손으로 옮겨올 수 있어야 한다.
  const version =
    typeof parsed === "object" && parsed !== null && "version" in parsed
      ? String((parsed as { version: unknown }).version)
      : "unknown";
  try {
    const backup = await archiveRaw(`v${version}-${timestampSuffix(now)}`);
    console.warn(`저장본이 현재 스키마와 맞지 않아 초기화한다. 백업: ${backup ?? "없음"}`);
  } catch (error) {
    console.error("백업 실패, 그래도 초기화한다", error);
  }
  return createInitialState(now);
}

let pendingTimer: number | null = null;
let pendingState: AppState | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let resetInProgress = false;
let deferredState: AppState | null = null;

/** state.json 쓰기를 직렬화해 reset과 일반 저장이 서로 추월하지 못하게 한다. */
function enqueueWrite(payload: string): Promise<void> {
  const operation = writeQueue.then(() => writeRaw(payload));
  // 다음 쓰기는 앞 쓰기의 성공 여부와 무관하게 실행하되, 호출자에게는 현재 실패를 전달한다.
  writeQueue = operation.catch(() => undefined);
  return operation;
}

/** 사용자가 확인한 초기화. 진행 중 저장을 모두 마친 뒤 백업+fresh 저장을 한 작업으로 수행한다. */
export async function resetState(now: number): Promise<AppState> {
  if (resetInProgress) {
    throw new Error("농장 초기화가 이미 진행 중입니다.");
  }
  resetInProgress = true;
  deferredState = pendingState;

  if (pendingTimer !== null) {
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingState = null;
  let completed = false;

  try {
    // 이미 시작된 이전 상태 저장이 끝나야 그 결과까지 포함한 state.json을 백업할 수 있다.
    await writeQueue;
    const fresh = createInitialState(now);
    const backup = await resetRaw(
      `reset-${timestampSuffix(now)}`,
      JSON.stringify(fresh),
    );
    console.info(`농장을 초기화했다. 백업: ${backup ?? "없음"}`);
    completed = true;
    return fresh;
  } finally {
    resetInProgress = false;
    const retryState = deferredState;
    deferredState = null;
    // 실패한 reset이 취소한 최신 메모리 변경은 다시 예약해 종료 시 유실되지 않게 한다.
    if (!completed && retryState !== null) {
      scheduleSave(retryState);
    }
  }
}

/** 연속 변경마다 파일을 쓰지 않도록 잠깐 모아서 저장한다 */
export function scheduleSave(state: AppState): void {
  if (resetInProgress) {
    deferredState = state;
    return;
  }
  pendingState = state;
  if (pendingTimer !== null) {
    return;
  }
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    const snapshot = pendingState;
    pendingState = null;
    if (snapshot === null || resetInProgress) {
      if (snapshot !== null) {
        deferredState = snapshot;
      }
      return;
    }
    void enqueueWrite(JSON.stringify(snapshot)).catch((error) => {
      console.error("상태 저장 실패", error);
    });
  }, SAVE_DEBOUNCE_MS);
}

/** 창이 닫히거나 숨을 때처럼 즉시 저장해야 하는 경우 */
export async function saveNow(state: AppState): Promise<void> {
  if (pendingTimer !== null) {
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
    pendingState = null;
  }
  if (resetInProgress) {
    deferredState = state;
    await writeQueue;
    return;
  }
  await enqueueWrite(JSON.stringify(state));
}
