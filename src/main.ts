/**
 * 본창 진입점. 부트스트랩, 렌더 루프, 입력, 창 관리.
 *
 * 본창은 농장 상태의 유일한 소유자다. 숨겨져 있어도 웹뷰는 살아 있으므로 계산과 저장을
 * 계속하고, 렌더만 멈춘다. 미니 위젯은 여기서 보내는 스냅샷을 받아 그리기만 한다.
 *
 * 루프는 requestAnimationFrame 을 돌리되 목표 간격에 못 미치면 그리지 않고 넘긴다.
 * 상시 띄워두는 위젯이 60fps 로 도는 건 배터리에 무례하다. 12fps 면 동물이 걷고 바람이
 * 부는 정도의 움직임에는 충분하다.
 */

import { DECOR } from "./assets/farmTiles";
import { loadAllSheets, type SheetRegistry } from "./assets/sheets";
import { CONFIG } from "./core/config";
import {
  buyAnimal,
  buyDecor,
  buyPlot,
  buyStorage,
  sellStorage,
  settle,
  tapPlot,
} from "./core/farm";
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  type Settings,
} from "./core/settings";
import { createInitialState, loadState, resetState, saveNow, scheduleSave } from "./core/store";
import type { AppState } from "./core/types";
import {
  disabledWeather,
  fetchCurrentWeather,
  loadCachedWeather,
  requestCoordinates,
  saveCachedWeather,
  WeatherLocationError,
  WEATHER_REFRESH_MS,
  WEATHER_RETRY_MS,
  type MiniSnapshot,
  type WeatherState,
} from "./core/weather";
import {
  cssSize,
  setupViewport,
  toViewPoint,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  type ViewScale,
  type Viewport,
} from "./render/canvas";
import { createCritters, updateCritters, type Critter } from "./render/critters";
import { daylight } from "./render/daylight";
import { loadUiFont } from "./render/font";
import {
  CHICKEN_RUNS,
  DRAG_ZONE,
  FOOTER,
  HEADER,
  hitTest,
  PASTURE,
  PLOT_RECTS,
  WALKWAYS,
} from "./render/layout";
import { MINI_HEIGHT as MINI_VIEW_HEIGHT, MINI_WIDTH as MINI_VIEW_WIDTH } from "./render/mini";
import { buttonStates, critterKindsFor, drawScene, PEOPLE_KINDS } from "./render/scene";
import {
  drawConfirm,
  drawSettings,
  hitConfirm,
  hitSettings,
  type ConfirmView,
  type LocationPermissionStatus,
  type LocationPermissionView,
} from "./render/settingsPanel";

const FRAME_INTERVAL_MS = 1000 / CONFIG.targetFps;
/** 미니에 상태를 보내는 간격. 초 단위 표시라 이 정도면 충분하다 */
const SNAPSHOT_INTERVAL_MS = 1000;
/** 돌아온 직후 알림을 얼마나 띄워둘지 */
const WELCOME_NOTICE_MS = 20_000;

const MAIN = "main";
const MINI = "mini";

let state: AppState = createInitialState(Date.now());
let settings: Settings = defaultSettings();
let viewport: Viewport | null = null;
let sheets: SheetRegistry | null = null;
let critters: Critter[] = [];
let settingsOpen = false;
let locationPermission: LocationPermissionView | null = null;

/** 캔버스 안 확인창. `window.confirm` 대신 쓴다. */
interface PendingConfirm {
  readonly view: ConfirmView;
  readonly accept: () => void;
}
let pendingConfirm: PendingConfirm | null = null;
let foldingMain = false;
let weather: WeatherState = disabledWeather();
let weatherNextAttemptAt = 0;
let weatherInFlight = false;
let weatherGeneration = 0;

/** 애니메이션용 단조 시간. 벽시계를 쓰면 시계 조정 때 움직임이 튄다 */
let animMs = 0;
let lastFrameAt = 0;
let lastSnapshotAt = 0;
let welcomeUntil = 0;
let running = false;

function hasTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeCommand<T = void>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T | undefined> {
  if (!hasTauri()) {
    return undefined;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function emitEvent(name: string, payload: unknown): Promise<void> {
  if (!hasTauri()) {
    return;
  }
  const { emit } = await import("@tauri-apps/api/event");
  await emit(name, payload);
}

function stopWeather(): void {
  weatherGeneration += 1;
  weatherInFlight = false;
  weatherNextAttemptAt = Number.POSITIVE_INFINITY;
  weather = disabledWeather();
}

/**
 * 위치 권한이 사라졌을 때 지난 값을 즉시 버린다.
 *
 * 다음 갱신 주기를 기다리면 그때까지 옛 날씨가 지금 날씨처럼 보인다. 진행 중이던 요청도
 * 세대를 올려 무효로 만든다. 재시도는 걸지 않는다. 허용되면 감시자가 알려 주고 그때 받는다.
 */
function dropWeatherForLostPermission(): void {
  weatherGeneration += 1;
  weatherInFlight = false;
  weatherNextAttemptAt = Number.POSITIVE_INFINITY;
  weather = { status: "denied", observation: null };
}

/**
 * 설정 패널에 보여줄 위치 권한 상태를 네이티브에서 읽는다.
 *
 * 권한을 앱이 직접 켤 수는 없다. 그래서 상태를 정확히 보여주고, 다시 요청하거나 시스템
 * 설정으로 보내는 두 경로만 제공한다.
 */
async function syncLocationPermission(): Promise<void> {
  if (!hasTauri()) {
    locationPermission = {
      servicesEnabled: true,
      status: "unsupported",
      requesting: locationPermission?.requesting === true,
    };
    return;
  }
  try {
    const result = await invokeCommand<{ servicesEnabled: boolean; status: string }>(
      "get_location_permission",
    );
    if (result === undefined) {
      return;
    }
    locationPermission = {
      servicesEnabled: result.servicesEnabled,
      status: result.status as LocationPermissionStatus,
      requesting: locationPermission?.requesting === true,
    };
  } catch (error) {
    console.error("위치 권한 상태 확인 실패", error);
  }
}

/** 설정의 `권한 요청` 버튼. 거부 상태에서 멈춘 재시도까지 함께 되살린다. */
async function requestLocationPermission(): Promise<void> {
  if (locationPermission?.requesting === true) {
    return;
  }
  locationPermission = {
    servicesEnabled: locationPermission?.servicesEnabled ?? true,
    status: locationPermission?.status ?? "unknown",
    requesting: true,
  };
  try {
    await refreshWeather(true);
  } finally {
    locationPermission = {
      servicesEnabled: locationPermission?.servicesEnabled ?? true,
      status: locationPermission?.status ?? "unknown",
      requesting: false,
    };
    await syncLocationPermission();
  }
}

async function refreshWeather(force: boolean = false): Promise<void> {
  const now = Date.now();
  if (!settings.weatherEnabled || weatherInFlight || (!force && now < weatherNextAttemptAt)) {
    return;
  }

  const generation = ++weatherGeneration;
  weatherInFlight = true;
  weather = { status: "locating", observation: weather.observation };
  try {
    const coordinates = await requestCoordinates();
    if (generation !== weatherGeneration || !settings.weatherEnabled) return;
    weather = { status: "loading", observation: weather.observation };
    const observation = await fetchCurrentWeather(coordinates);
    if (generation !== weatherGeneration || !settings.weatherEnabled) return;
    weather = { status: "ready", observation };
    saveCachedWeather(observation);
    weatherNextAttemptAt = observation.fetchedAt + WEATHER_REFRESH_MS;
  } catch (error) {
    if (generation !== weatherGeneration || !settings.weatherEnabled) return;
    const denied = error instanceof WeatherLocationError && error.denied;
    // 프롬프트 응답 대기 중이면 재시도를 걸지 않는다. 재시도마다 권한 창이 다시 떠서
    // 사용자를 계속 방해한다. 허용하면 네이티브 감시자가 알려 주고 그때 다시 받는다.
    const pending = error instanceof WeatherLocationError && error.pending;
    // 권한이 없으면 지난 값을 아예 쓰지 않는다. 아이콘과 온도가 같이 나오면 지금 날씨처럼
    // 보여서, 권한이 필요하다는 안내가 묻힌다. 캐시는 지우지 않으므로 허용 직후 바로 쓰인다.
    weather = {
      status: denied || pending ? "denied" : weather.observation === null ? "error" : "stale",
      observation: denied || pending ? null : weather.observation,
    };
    weatherNextAttemptAt =
      denied || pending ? Number.POSITIVE_INFINITY : now + WEATHER_RETRY_MS;
    if (!denied && !pending) console.warn("날씨 갱신 실패", error);
  } finally {
    if (generation === weatherGeneration) weatherInFlight = false;
  }
}

function commit(next: AppState): void {
  state = next;
  scheduleSave(state);
}

/**
 * 목초지의 동물과 흙길의 사람을 한 배열로 만든다.
 *
 * 사람은 구역을 하나씩 맡는다. 동물과 같은 목초지에 두면 우리에 갇힌 꼴이 되고, 한 구역에
 * 여럿을 넣으면 서로 겹친다.
 */
function buildCritters(): Critter[] {
  // 보유 동물 중 닭만 최대 두 마리까지 우리 밖으로 뺀다. 복제하지 않으므로 생산량과
  // 화면의 총 동물 수는 그대로다. 구역을 하나씩 맡겨 두 닭이 한곳에 겹치지 않게 한다.
  const pastureKinds = [...critterKindsFor(state.farm.animals)];
  const chickens = CHICKEN_RUNS.flatMap((area, index) => {
    const chickenIndex = pastureKinds.indexOf(DECOR.chicken);
    if (chickenIndex < 0) {
      return [];
    }
    const [chicken] = pastureKinds.splice(chickenIndex, 1);
    return createCritters(area, [chicken!], 21 + index);
  });
  const animals = createCritters(PASTURE, pastureKinds);
  const people = WALKWAYS.flatMap((area, index) =>
    createCritters(area, [PEOPLE_KINDS[index % PEOPLE_KINDS.length]!], 31 + index),
  );
  return [...animals, ...chickens, ...people];
}

/**
 * 보유 동물 수와 화면의 동물 수를 맞춘다.
 *
 * 동물과 사람 상태는 저장하지 않는 겉모습이라 수가 바뀔 때 새로 만든다. 위치가
 * 초기화되지만 방금 산 동물이 목초지 어딘가에 나타나는 것이라 이상하지 않다.
 */
function syncCritters(): void {
  if (critters.length === state.farm.animals + WALKWAYS.length) {
    return;
  }
  critters = buildCritters();
}

/**
 * 설정을 저장하고 창에 반영한다.
 *
 * 바뀐 항목만 골라 적용하지 않고 매번 전부 적용한다. 모두 멱등한 조작이고, 시작할 때와
 * 사용자가 바꿀 때가 같은 경로를 타야 "저장은 됐는데 창에는 안 먹었다" 같은 상태가
 * 생기지 않는다.
 */
async function applySettings(next: Settings): Promise<boolean> {
  // 자동 실행은 OS 등록이 성공한 뒤에만 설정값을 바꾼다.
  if (next.autostart !== settings.autostart && !(await applyAutostart(next.autostart))) {
    return false;
  }

  const weatherChanged = next.weatherEnabled !== settings.weatherEnabled;
  settings = next;
  try {
    await saveSettings(next);
  } catch (error) {
    console.error("설정 저장 실패", error);
  }

  const canvas = viewport?.canvas;
  if (canvas) {
    viewport = setupViewport(canvas, next.scale);
  }

  const size = cssSize(next.scale);
  await invokeCommand("set_window_size", {
    label: MAIN,
    width: size.width,
    height: size.height,
  });
  // 미니는 논리 해상도가 달라서 크기를 직접 계산해 알려준다.
  await invokeCommand("set_window_size", {
    label: MINI,
    width: MINI_VIEW_WIDTH * next.scale,
    height: MINI_VIEW_HEIGHT * next.scale,
  });
  await emitEvent("tiny-farm://scale", next.scale);

  await invokeCommand("set_always_on_top", { label: MAIN, value: next.mainAlwaysOnTop });
  await invokeCommand("set_always_on_top", { label: MINI, value: next.miniAlwaysOnTop });
  if (!next.miniEnabled) {
    await invokeCommand("hide_window", { label: MINI });
  }
  if (weatherChanged) {
    if (next.weatherEnabled) {
      weather = loadCachedWeather(Date.now());
      weatherNextAttemptAt = 0;
      void refreshWeather(true);
    } else {
      stopWeather();
    }
  }
  return true;
}

interface AutostartStatus {
  readonly enabled: boolean;
  readonly fileExists: boolean;
  readonly pathMatches: boolean;
  readonly loaded: boolean;
  /** 사용자가 시스템 설정 > 일반 > 로그인 항목에서 끈 상태 */
  readonly userDisabled: boolean;
  /** serviceManagement | launchAgent */
  readonly mechanism: string;
  readonly plistPath: string;
}

/** 로그인 시 자동 실행. 실제 LaunchAgent 상태가 일치한 뒤에만 설정을 바꾼다. */
async function applyAutostart(enabled: boolean): Promise<boolean> {
  if (!hasTauri()) {
    return true;
  }
  try {
    const actual = await invokeCommand<AutostartStatus>("set_autostart", { enabled });
    if (
      actual === undefined ||
      actual.enabled !== enabled ||
      (enabled && !actual.loaded) ||
      (!enabled && actual.loaded)
    ) {
      throw new Error(`LaunchAgent 상태 불일치: ${JSON.stringify(actual)}`);
    }
    return true;
  } catch (error) {
    console.error("자동 실행 설정 실패", error);
    // 원인을 사용자가 옮겨 적지 않아도 알 수 있게 실제 오류를 그대로 보여 준다.
    // 같은 내용이 앱 데이터 폴더의 autostart.log 에도 남는다.
    window.alert(
      "로그인 시 실행을 실제 macOS LaunchAgent에 등록하지 못했습니다.\n\n" +
      `원인: ${String(error)}\n\n` +
      "로그인 시 실행은 위치처럼 허용 창이 뜨지 않고, 시스템 설정 > 일반 > 로그인 항목에서 관리됩니다.\n" +
      "설정의 `로그인 항목` 버튼으로 그 창을 열어 Tiny Farm이 꺼져 있는지 확인해 주세요.",
    );
    return false;
  }
}

/** macOS LaunchAgent의 실제 파일·앱 경로 상태를 저장 설정에 반영한다. */
async function syncAutostartSetting(current: Settings): Promise<Settings> {
  if (!hasTauri()) {
    return current;
  }
  try {
    const actual = await invokeCommand<AutostartStatus>("get_autostart_status");
    if (actual === undefined) {
      return current;
    }
    const effective = actual.enabled && actual.loaded;
    if (effective === current.autostart) {
      return current;
    }
    const synced = { ...current, autostart: effective };
    await saveSettings(synced);
    return synced;
  } catch (error) {
    console.error("자동 실행 상태 확인 실패", error);
    return current;
  }
}

async function startWindowDrag(): Promise<void> {
  if (!hasTauri()) {
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

/** 메인창을 미니 위젯으로 접는다. 미니를 꺼뒀다면 트레이로만 숨긴다 */
async function foldMain(): Promise<void> {
  if (foldingMain) {
    return;
  }
  foldingMain = true;
  settingsOpen = false;
  try {
    if (settings.miniEnabled) {
      await invokeCommand("show_window", { label: MINI });
    } else {
      await invokeCommand("hide_window", { label: MAIN });
    }
  } catch (error) {
    console.error("메인 창 접기 실패", error);
  } finally {
    foldingMain = false;
  }
}

function onPointerDown(event: PointerEvent): void {
  if (!viewport || event.button !== 0) {
    return;
  }
  const point = toViewPoint(viewport.canvas, event.clientX, event.clientY);

  // 확인창이 열려 있으면 다른 어떤 것도 눌리지 않는다. 실수 방지가 목적이다.
  if (pendingConfirm !== null) {
    const action = hitConfirm(point.x, point.y);
    if (action.kind === "cancel") {
      pendingConfirm = null;
    } else if (action.kind === "accept") {
      const accept = pendingConfirm.accept;
      pendingConfirm = null;
      accept();
    }
    return;
  }

  // 설정 패널이 열려 있어도 접기 버튼은 즉시 동작한다.
  if (hitTest(HEADER.fold, point.x, point.y)) {
    void foldMain();
    return;
  }

  if (settingsOpen) {
    const action = hitSettings(point.x, point.y);
    if (action === null) {
      // 패널 밖을 누르면 닫는다.
      settingsOpen = false;
      return;
    }
    switch (action.kind) {
      case "close":
        settingsOpen = false;
        return;
      case "toggle": {
        const value = !settings[action.key];
        void invokeCommand("log_ui", {
          line: `toggle ${action.key} -> ${value}`,
        }).catch(() => undefined);
        if (action.key === "autostart" && value) {
          pendingConfirm = {
            view: {
              title: "로그인 시 실행",
              lines: [
                "로그인할 때 Tiny Farm을 자동으로 실행할까요?",
                "시스템 설정 > 일반 > 로그인 항목에서 끌 수 있습니다.",
              ],
            },
            accept: () => {
              void invokeCommand("log_ui", { line: "autostart confirm accepted" }).catch(
                () => undefined,
              );
              void applySettings({ ...settings, autostart: true });
            },
          };
          return;
        }
        void applySettings({ ...settings, [action.key]: value });
        return;
      }
      case "scale":
        void applySettings({ ...settings, scale: action.value });
        return;
      case "requestLocation":
        void requestLocationPermission();
        return;
      case "openLocationSettings":
        void invokeCommand("open_location_settings").catch((error) => {
          console.error("위치 서비스 설정 열기 실패", error);
        });
        return;
      case "openLoginItemsSettings":
        void invokeCommand("open_login_items_settings").catch((error) => {
          console.error("로그인 항목 설정 열기 실패", error);
        });
        return;
      case "consumed":
        return;
    }
  }

  if (hitTest(HEADER.gear, point.x, point.y)) {
    settingsOpen = true;
    void syncLocationPermission();
    return;
  }

  // 열려 있는 밭만 판정한다. 아직 못 산 자리를 눌러도 아무 일이 없어야 한다.
  for (let index = 0; index < state.farm.plotCount; index += 1) {
    if (hitTest(PLOT_RECTS[index]!, point.x, point.y)) {
      commit({ ...state, farm: tapPlot(state.farm, index) });
      return;
    }
  }

  const buttons = buttonStates(state);
  // 순서는 layout.FOOTER.buttons 와 scene.buttonStates 와 반드시 같아야 한다.
  const actions = [sellStorage, buyPlot, buyStorage, buyAnimal, buyDecor];
  for (let index = 0; index < FOOTER.buttons.length; index += 1) {
    if (!hitTest(FOOTER.buttons[index]!, point.x, point.y)) {
      continue;
    }
    if (buttons[index]?.enabled) {
      commit({ ...state, farm: actions[index]!(state.farm) });
      syncCritters();
    }
    return;
  }

  if (hitTest(DRAG_ZONE, point.x, point.y)) {
    void startWindowDrag();
  }
}

/**
 * 한 프레임. 농장 시계를 진행시키고 화면을 그린다.
 *
 * settle 은 매 프레임 불러도 안전하다. 마지막 정산 시각과의 차이만 더하므로 호출 빈도와
 * 결과가 무관하다.
 */
function renderFrame(timestamp: number): void {
  requestAnimationFrame(renderFrame);

  const wallNow = Date.now();
  const sinceLastFrame = timestamp - lastFrameAt;

  // 숨어 있어도 농장 시간은 흘러야 하고 미니에도 계속 보내야 한다.
  const settled = settle(state.farm, wallNow);
  if (settled.storage !== state.farm.storage || settled.plots !== state.farm.plots) {
    commit({ ...state, farm: settled });
  } else {
    state = { ...state, farm: settled };
  }

  if (settings.miniEnabled && wallNow - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotAt = wallNow;
    const snapshot: MiniSnapshot = { state, weather };
    void emitEvent("tiny-farm://snapshot", JSON.stringify(snapshot));
  }

  if (settings.weatherEnabled && wallNow >= weatherNextAttemptAt) {
    void refreshWeather();
  }

  if (!running || !viewport || !sheets || sinceLastFrame < FRAME_INTERVAL_MS) {
    return;
  }
  lastFrameAt = timestamp;
  animMs += sinceLastFrame;

  updateCritters(critters, animMs, sinceLastFrame);

  const showWelcome = wallNow < welcomeUntil;
  const viewState: AppState = showWelcome
    ? state
    : { ...state, farm: { ...state.farm, lastSettleHarvests: 0 } };

  drawScene(viewport.context, sheets, viewState, {
    wallNow,
    animMs,
    critters,
    light: daylight(new Date(wallNow)),
    weather,
    settingsOpen,
  });

  if (pendingConfirm !== null) {
    drawConfirm(viewport.context, sheets, pendingConfirm.view);
  } else if (settingsOpen) {
    drawSettings(viewport.context, sheets, settings, locationPermission);
  }
}

function setRunning(next: boolean): void {
  if (running === next) {
    return;
  }
  running = next;
  if (running) {
    // 멈춰 있던 시간이 애니메이션에 한꺼번에 더해지지 않도록 기준을 다시 잡는다.
    lastFrameAt = performance.now();
  } else {
    void saveNow(state).catch((error) => {
      console.error("숨을 때 저장 실패", error);
    });
  }
}

async function registerEvents(canvas: HTMLCanvasElement): Promise<void> {
  canvas.addEventListener("pointerdown", onPointerDown);
  // 우클릭 메뉴는 픽셀 UI 위에 뜨면 어색하고 쓸 일도 없다.
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  // 창이 숨거나 다른 데스크톱으로 넘어갈 때만 렌더를 멈춘다. 포커스로 판단하면 안 된다.
  // 이 위젯은 다른 앱을 쓰는 동안 곁눈으로 보는 물건이라, 포커스가 없는 게 정상이다.
  document.addEventListener("visibilitychange", () => {
    setRunning(document.visibilityState === "visible");
  });
  window.addEventListener("beforeunload", () => {
    void saveNow(state);
  });

  if (!hasTauri()) {
    return;
  }
  const { listen } = await import("@tauri-apps/api/event");

  // 트레이의 초기화 메뉴는 이벤트만 보낸다. 저장 형식을 아는 쪽이 여기라서 실제
  // 백업과 초기화는 본창이 처리한다. 확인 전에는 상태나 저장 파일을 전혀 건드리지 않는다.
  await listen("tiny-farm://reset", () => {
    // 확인창은 캔버스 안에 직접 그린다. `window.confirm` 은 이 웹뷰에서 뜨지 않는 경우가
    // 있어 사용자에게는 아무 반응 없는 것처럼 보였다.
    pendingConfirm = {
      view: {
        title: "농장 초기화",
        lines: [
          "현재 농장을 백업한 뒤 처음 상태로 돌아갑니다.",
          "실수로 실행되지 않도록 한 번 더 확인합니다.",
        ],
      },
      accept: () => {
        void resetState(Date.now())
          .then((fresh) => {
            state = fresh;
            critters = buildCritters();
            welcomeUntil = 0;
            settingsOpen = false;
          })
          .catch((error) => {
            console.error("초기화 실패", error);
            window.alert("농장 백업 또는 초기화에 실패했습니다. 기존 농장은 그대로 유지됩니다.");
          });
      },
    };
  });

  // 위치 권한을 나중에 허용한 경우. 거부 상태는 재시도를 멈추므로 이 신호로 즉시 다시 받는다.
  await listen<boolean>("tiny-farm://location-authorization", (event) => {
    void syncLocationPermission();
    if (event.payload === true) {
      void refreshWeather(true);
      return;
    }
    // 사용자가 시스템 설정에서 끈 경우다. 화면에서 바로 지운다.
    if (settings.weatherEnabled) {
      dropWeatherForLostPermission();
    }
  });

  // 본창을 닫으면 Rust 가 종료 대신 숨김으로 바꾸고 이 이벤트를 보낸다.
  // 미니로 넘길지는 설정을 아는 이쪽에서 정한다.
  await listen("tiny-farm://main-hidden", () => {
    settingsOpen = false;
    // 접기 버튼과 같은 규칙을 쓴다. 본창이 어떤 경로로 사라져도 결과가 같아야 한다.
    if (settings.miniEnabled) {
      void invokeCommand("show_window", { label: MINI });
    }
  });
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (!canvas) {
    throw new Error("#stage 캔버스를 찾을 수 없다");
  }

  const now = Date.now();
  const [loadedSheets, loadedState, loadedSettings] = await Promise.all([
    loadAllSheets(),
    loadState(now),
    loadSettings(),
    loadUiFont(),
  ]);
  sheets = loadedSheets;
  settings = await syncAutostartSetting(loadedSettings);
  weather = settings.weatherEnabled ? loadCachedWeather(now) : disabledWeather();
  weatherNextAttemptAt =
    weather.observation === null ? now : weather.observation.fetchedAt + WEATHER_REFRESH_MS;

  // 캐시를 먼저 그리기 전에 권한을 확인한다. 권한이 없는데 지난 값을 띄우면 지금 날씨로
  // 오해하게 되고, 다음 갱신 주기까지 그대로 남는다.
  if (settings.weatherEnabled) {
    await syncLocationPermission();
    const permission = locationPermission;
    if (
      permission !== null &&
      permission.status !== "unsupported" &&
      (!permission.servicesEnabled || permission.status !== "authorized")
    ) {
      dropWeatherForLostPermission();
      // 미결정이면 첫 실행이므로 한 번은 요청해 프롬프트를 띄운다.
      if (permission.status === "notDetermined" && permission.servicesEnabled) {
        weatherNextAttemptAt = now;
      }
    }
  }
  state = { ...loadedState, farm: settle(loadedState.farm, now) };

  viewport = setupViewport(canvas, settings.scale as ViewScale);

  // 저장된 설정을 창에 그대로 반영한다.
  await applySettings(settings);

  if ((state.farm.lastSettleHarvests ?? 0) > 0) {
    welcomeUntil = now + WELCOME_NOTICE_MS;
  }
  // 첫 정산 결과는 저장해 둔다. 바로 닫아도 진행이 남는다.
  scheduleSave(state);

  critters = buildCritters();

  await registerEvents(canvas);
  if (settings.weatherEnabled) {
    void refreshWeather();
  }

  running = document.visibilityState === "visible";
  lastFrameAt = performance.now();
  requestAnimationFrame(renderFrame);
}

void main().catch((error) => {
  console.error("초기화 실패", error);
  document.body.textContent = `초기화 실패: ${String(error)}`;
});

// 개발 중 창 크기를 확인할 때 쓰라고 논리 해상도를 노출한다.
Object.assign(globalThis, { TINY_FARM_VIEW: { width: VIEW_WIDTH, height: VIEW_HEIGHT } });
