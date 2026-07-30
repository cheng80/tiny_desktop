/**
 * 사용자 설정.
 *
 * 농장 상태와 다른 파일에 저장한다. 성격이 다르기 때문이다. 농장은 쌓인 시간이라 잃으면
 * 되돌릴 수 없고, 설정은 언제든 다시 고르면 된다. 농장을 초기화할 때 설정까지 날리는 것도
 * 이상하다. 스키마 검증에 실패했을 때의 처리도 달라야 한다. 농장은 백업을 남기고,
 * 설정은 그냥 기본값으로 돌아가면 된다.
 */

import { DEFAULT_SCALE, isViewScale, type ViewScale } from "../render/canvas";

export const SETTINGS_VERSION = 1;

export interface Settings {
  version: number;
  /** 논리 픽셀 하나를 화면 픽셀 몇 개로 키울지 */
  scale: ViewScale;
  mainAlwaysOnTop: boolean;
  /**
   * 미니 위젯을 쓸지.
   *
   * 본창을 감추는 모든 경로가 이 값 하나를 본다. 접기 버튼과 창 닫기 요청이 서로 다르게
   * 동작하면 예측할 수 없다. 이전에는 닫기 전용 설정이 따로 있었지만, 본창에는 macOS 창
   * 버튼이 없어서 닫기 경로가 사실상 쓰이지 않았고 접기 버튼은 그 설정을 무시했다.
   */
  miniEnabled: boolean;
  miniAlwaysOnTop: boolean;
  /** 현재 위치를 사용해 실시간 날씨를 표시할지 */
  weatherEnabled: boolean;
  /** 로그인할 때 자동으로 실행할지 */
  autostart: boolean;
}

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    scale: DEFAULT_SCALE,
    mainAlwaysOnTop: true,
    miniEnabled: true,
    miniAlwaysOnTop: true,
    weatherEnabled: true,
    autostart: false,
  };
}

function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const DEV_KEY = "tiny-farm-settings";

/**
 * 알 수 없는 값이 섞여 있어도 항목별로 기본값으로 되돌린다. 설정 하나가 깨졌다고
 * 전부 초기화하면 사용자가 다시 다 고르게 된다. 이전 버전의 폐기된 키도 여기서 무시된다.
 */
function merge(raw: unknown): Settings {
  const base = defaultSettings();
  if (typeof raw !== "object" || raw === null) {
    return base;
  }
  const candidate = raw as Record<string, unknown>;

  const scale = candidate["scale"];
  if (isViewScale(scale)) {
    base.scale = scale;
  }
  // 폐기된 `miniOnClose` 는 여기 없으므로 이전 저장본에 남아 있어도 그대로 무시된다.
  for (const key of [
    "mainAlwaysOnTop",
    "miniEnabled",
    "miniAlwaysOnTop",
    "weatherEnabled",
    "autostart",
  ] as const) {
    const value = candidate[key];
    if (typeof value === "boolean") {
      base[key] = value;
    }
  }
  return base;
}

export async function loadSettings(): Promise<Settings> {
  try {
    if (!hasTauri()) {
      const raw = window.localStorage.getItem(DEV_KEY);
      return raw === null ? defaultSettings() : merge(JSON.parse(raw));
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string | null>("load_settings");
    return raw === null ? defaultSettings() : merge(JSON.parse(raw));
  } catch (error) {
    console.error("설정 읽기 실패, 기본값을 쓴다", error);
    return defaultSettings();
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const payload = JSON.stringify(settings);
  if (!hasTauri()) {
    window.localStorage.setItem(DEV_KEY, payload);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_settings", { payload });
}
