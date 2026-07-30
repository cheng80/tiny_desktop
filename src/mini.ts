/**
 * 미니 위젯 진입점.
 *
 * 상태를 계산하지 않는다. 본창이 이벤트로 보내주는 스냅샷을 받아 그린다. Rust 쪽에서도
 * 본창이 아닌 창의 쓰기 명령을 거부하므로, 읽기 전용은 규약이 아니라 구조로 보장된다.
 *
 * 농장 장면은 보기 전용이다. 위 `이동` 손잡이로 창을 옮기고 `열기` 버튼으로 본창을
 * 연다. 같은 조작줄의 X는 미니만 숨긴다.
 */

import { loadAllSheets, type SheetRegistry } from "./assets/sheets";
import { CONFIG } from "./core/config";
import { loadSettings } from "./core/settings";
import { loadState } from "./core/store";
import type { AppState } from "./core/types";
import {
  disabledWeather,
  loadCachedWeather,
  type MiniSnapshot,
  type WeatherState,
} from "./core/weather";
import { setupViewport, type ViewScale, type Viewport } from "./render/canvas";
import { createCritters, updateCritters, type Critter } from "./render/critters";
import { daylight } from "./render/daylight";
import { loadUiFont } from "./render/font";
import { hitTest } from "./render/layout";
import {
  drawMini,
  MINI_CLOSE_ZONE as CLOSE_ZONE,
  MINI_DRAG_ZONE,
  MINI_HEIGHT,
  MINI_OPEN_ZONE,
  MINI_PASTURE,
  MINI_WIDTH,
} from "./render/mini";

const FRAME_INTERVAL_MS = 1000 / CONFIG.targetFps;

let viewport: Viewport | null = null;
let sheets: SheetRegistry | null = null;
let critters: Critter[] = [];
let snapshot: AppState | null = null;
let weather: WeatherState = disabledWeather();
let animMs = 0;
let lastFrameAt = 0;
let running = true;
let openingMain = false;

function hasTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeCommand(command: string, args: Record<string, unknown>): Promise<void> {
  if (!hasTauri()) {
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(command, args);
}

function miniPoint(event: PointerEvent): { x: number; y: number } | null {
  if (!viewport) {
    return null;
  }
  const rect = viewport.canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * MINI_WIDTH),
    y: Math.floor(((event.clientY - rect.top) / rect.height) * MINI_HEIGHT),
  };
}

async function openMain(): Promise<void> {
  if (openingMain) {
    return;
  }
  openingMain = true;
  try {
    // 네이티브 전환 명령이 메인을 보이기 전에 미니를 숨긴다.
    await invokeCommand("show_window", { label: "main" });
  } catch (error) {
    console.error("본창 열기 실패", error);
  } finally {
    openingMain = false;
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }
  const point = miniPoint(event);
  if (point === null) {
    return;
  }

  if (hitTest(CLOSE_ZONE, point.x, point.y)) {
    void invokeCommand("hide_window", { label: "mini" });
    return;
  }

  if (hitTest(MINI_DRAG_ZONE, point.x, point.y)) {
    void startWindowDrag();
    return;
  }

  if (hitTest(MINI_OPEN_ZONE, point.x, point.y)) {
    void openMain();
  }
  // 농장 장면과 정보줄은 보기 전용이다. 잘못 눌러도 미니가 사라지지 않는다.
}

function onPointerMove(event: PointerEvent): void {
  const point = miniPoint(event);
  if (!viewport || point === null) {
    return;
  }
  viewport.canvas.style.cursor = hitTest(MINI_DRAG_ZONE, point.x, point.y)
    ? "grab"
    : hitTest(MINI_OPEN_ZONE, point.x, point.y) || hitTest(CLOSE_ZONE, point.x, point.y)
      ? "pointer"
      : "default";
}

async function startWindowDrag(): Promise<void> {
  if (!hasTauri()) {
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

function renderFrame(timestamp: number): void {
  requestAnimationFrame(renderFrame);
  if (!running || !viewport || !sheets) {
    return;
  }
  const since = timestamp - lastFrameAt;
  if (since < FRAME_INTERVAL_MS) {
    return;
  }
  lastFrameAt = timestamp;
  animMs += since;

  updateCritters(critters, animMs, since, 7);

  const wallNow = Date.now();
  drawMini(viewport.context, sheets, snapshot, {
    wallNow,
    animMs,
    critters,
    light: daylight(new Date(wallNow)),
    weather,
  });
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (!canvas) {
    throw new Error("#stage 캔버스를 찾을 수 없다");
  }

  const [settings, loadedSheets, initial] = await Promise.all([
    loadSettings(),
    loadAllSheets(),
    // 첫 스냅샷이 오기 전에도 뭔가 보여야 한다. 저장본을 직접 한 번 읽는다. 읽기만 하고
    // 정산은 하지 않는다. 농장 시계를 굴리는 건 본창의 일이다.
    loadState(Date.now()),
    loadUiFont(),
  ]);
  viewport = setupViewport(canvas, settings.scale as ViewScale, MINI_WIDTH, MINI_HEIGHT);
  sheets = loadedSheets;
  snapshot = initial;
  weather = settings.weatherEnabled ? loadCachedWeather(Date.now()) : disabledWeather();
  // 미니는 동물 한 마리만 둔다. 좁은 화면에 여럿이 있으면 부산스럽다.
  critters = createCritters(MINI_PASTURE, [121], 7);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", () => {
    canvas.style.cursor = "default";
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("visibilitychange", () => {
    running = document.visibilityState === "visible";
    if (running) {
      lastFrameAt = performance.now();
    }
  });

  if (hasTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("tiny-farm://snapshot", (event) => {
      try {
        const parsed = JSON.parse(event.payload) as MiniSnapshot | AppState;
        if ("state" in parsed && "weather" in parsed) {
          snapshot = parsed.state;
          weather = parsed.weather;
        } else {
          // 이전 버전 본창과 함께 실행되는 동안에도 농장 화면은 유지한다.
          snapshot = parsed;
        }
      } catch (error) {
        console.error("스냅샷 파싱 실패", error);
      }
    });
    // 배율이 바뀌면 미니도 같이 바뀐다.
    await listen<number>("tiny-farm://scale", (event) => {
      if (!viewport) {
        return;
      }
      viewport = setupViewport(canvas, event.payload as ViewScale, MINI_WIDTH, MINI_HEIGHT);
    });
  }

  lastFrameAt = performance.now();
  requestAnimationFrame(renderFrame);
}

void main().catch((error) => {
  console.error("미니 초기화 실패", error);
  document.body.textContent = `미니 초기화 실패: ${String(error)}`;
});
