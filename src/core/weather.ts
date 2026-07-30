/** Open-Meteo 현재 날씨와 위치 권한을 다루는 순수 데이터 계층. */

import type { AppState } from "./types";

export const WEATHER_REFRESH_MS = 15 * 60_000;
export const WEATHER_RETRY_MS = 5 * 60_000;
export const WEATHER_STALE_MS = 6 * 60 * 60_000;
const WEATHER_CACHE_KEY = "tiny-farm-weather";
const WEATHER_CACHE_VERSION = 1;

export type WeatherKind = "clear" | "partly-cloudy" | "cloudy" | "fog" | "rain" | "snow" | "thunder";
export type WeatherStatus = "disabled" | "locating" | "loading" | "ready" | "stale" | "denied" | "error";

export interface WeatherObservation {
  readonly fetchedAt: number;
  readonly sourceTime: string;
  readonly temperatureC: number;
  readonly precipitationMm: number;
  readonly rainMm: number;
  readonly snowfallCm: number;
  readonly weatherCode: number;
  readonly isDay: boolean;
}

export interface WeatherState {
  readonly status: WeatherStatus;
  readonly observation: WeatherObservation | null;
}

export interface MiniSnapshot {
  readonly state: AppState;
  readonly weather: WeatherState;
}

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export class WeatherLocationError extends Error {
  /**
   * `pending` 은 권한 프롬프트가 떠 있고 아직 답을 받지 못한 상태다.
   * 이때 자동 재시도를 걸면 프롬프트가 반복해서 뜨므로 호출자가 재시도를 멈춰야 한다.
   */
  constructor(
    readonly denied: boolean,
    message: string,
    readonly pending: boolean = false,
  ) {
    super(message);
    this.name = "WeatherLocationError";
  }
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Open-Meteo ${name} 값이 올바르지 않다`);
  }
  return value;
}

export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95 && code <= 99) return "thunder";
  return "rain";
}

export function weatherLabel(kind: WeatherKind): string {
  switch (kind) {
    case "clear": return "맑음";
    case "partly-cloudy": return "구름 조금";
    case "cloudy": return "흐림";
    case "fog": return "안개";
    case "rain": return "비";
    case "snow": return "눈";
    case "thunder": return "뇌우";
  }
}

export function disabledWeather(): WeatherState {
  return { status: "disabled", observation: null };
}

export function loadCachedWeather(now: number): WeatherState {
  try {
    const raw = window.localStorage.getItem(WEATHER_CACHE_KEY);
    if (raw === null) return { status: "locating", observation: null };
    const parsed = JSON.parse(raw) as { version?: unknown; observation?: unknown };
    if (parsed.version !== WEATHER_CACHE_VERSION || typeof parsed.observation !== "object" || parsed.observation === null) {
      return { status: "locating", observation: null };
    }
    const item = parsed.observation as Record<string, unknown>;
    const observation: WeatherObservation = {
      fetchedAt: finite(item["fetchedAt"], "fetchedAt"),
      sourceTime: typeof item["sourceTime"] === "string" ? item["sourceTime"] : "",
      temperatureC: finite(item["temperatureC"], "temperatureC"),
      precipitationMm: finite(item["precipitationMm"], "precipitationMm"),
      rainMm: finite(item["rainMm"], "rainMm"),
      snowfallCm: finite(item["snowfallCm"], "snowfallCm"),
      weatherCode: finite(item["weatherCode"], "weatherCode"),
      isDay: item["isDay"] === true,
    };
    const age = now - observation.fetchedAt;
    if (age < 0 || age > WEATHER_STALE_MS) return { status: "locating", observation: null };
    return { status: age <= WEATHER_REFRESH_MS ? "ready" : "stale", observation };
  } catch (error) {
    console.warn("날씨 캐시를 읽지 못했다", error);
    return { status: "locating", observation: null };
  }
}

export function saveCachedWeather(observation: WeatherObservation): void {
  try {
    window.localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify({ version: WEATHER_CACHE_VERSION, observation }),
    );
  } catch (error) {
    console.warn("날씨 캐시를 저장하지 못했다", error);
  }
}

function hasTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

type NativeLocationOutcome =
  | { readonly status: "ready"; readonly latitude: number; readonly longitude: number }
  | { readonly status: "denied"; readonly message: string }
  | { readonly status: "pending"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

async function requestNativeCoordinates(): Promise<Coordinates> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const outcome = await invoke<NativeLocationOutcome>("request_current_location");
    if (outcome.status === "denied") {
      throw new WeatherLocationError(true, outcome.message);
    }
    if (outcome.status === "pending") {
      throw new WeatherLocationError(false, outcome.message, true);
    }
    if (outcome.status === "error") {
      throw new WeatherLocationError(false, outcome.message);
    }
    if (!Number.isFinite(outcome.latitude) || !Number.isFinite(outcome.longitude)) {
      throw new WeatherLocationError(false, "macOS가 올바르지 않은 위치를 반환했다");
    }
    return { latitude: outcome.latitude, longitude: outcome.longitude };
  } catch (error) {
    if (error instanceof WeatherLocationError) throw error;
    throw new WeatherLocationError(false, String(error));
  }
}

function requestBrowserCoordinates(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new WeatherLocationError(false, "이 환경은 위치 서비스를 지원하지 않는다"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      (error) => reject(new WeatherLocationError(error.code === error.PERMISSION_DENIED, error.message)),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 6 * 60 * 60_000 },
    );
  });
}

export function requestCoordinates(): Promise<Coordinates> {
  return hasTauriRuntime() ? requestNativeCoordinates() : requestBrowserCoordinates();
}

export async function fetchCurrentWeather(
  coordinates: Coordinates,
  now: number = Date.now(),
): Promise<WeatherObservation> {
  const params = new URLSearchParams({
    latitude: coordinates.latitude.toFixed(5),
    longitude: coordinates.longitude.toFixed(5),
    current: "temperature_2m,precipitation,rain,snowfall,weather_code,is_day",
    timezone: "auto",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const data = (await response.json()) as { current?: unknown };
  if (typeof data.current !== "object" || data.current === null) {
    throw new Error("Open-Meteo current 응답이 없다");
  }
  const current = data.current as Record<string, unknown>;
  const isDay = finite(current["is_day"], "is_day");
  return {
    fetchedAt: now,
    sourceTime: typeof current["time"] === "string" ? current["time"] : "",
    temperatureC: finite(current["temperature_2m"], "temperature_2m"),
    precipitationMm: finite(current["precipitation"], "precipitation"),
    rainMm: finite(current["rain"], "rain"),
    snowfallCm: finite(current["snowfall"], "snowfall"),
    weatherCode: Math.round(finite(current["weather_code"], "weather_code")),
    isDay: isDay === 1,
  };
}
