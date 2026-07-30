/** WMO 날씨를 Tiny Farm 팔레트의 작은 픽셀 아이콘과 장면 효과로 그린다. */

import { weatherKind, weatherLabel, type WeatherObservation, type WeatherState } from "../core/weather";
import { fillRect, type Rect } from "./draw";

const INK = "#4b3428";
const CLOUD_DARK = "#71808a";
const CLOUD_LIGHT = "#d9e2df";
const SUN = "#f4b73b";
const RAIN = "#72b8df";
const SNOW = "#f4f4e8";

function block(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
  fillRect(context, { x, y, width, height }, color);
}

function drawSun(context: CanvasRenderingContext2D, x: number, y: number, night: boolean): void {
  if (night) {
    // 초승달. 두께 3px 의 호로 그려야 2배로 키워도 달처럼 보인다.
    // 이전에는 오른쪽을 메워서 뭉툭한 덩어리로 보였다.
    const arc: readonly (readonly [number, number, number])[] = [
      [4, 1, 3],
      [3, 2, 3],
      [2, 3, 3],
      [2, 4, 3],
      [2, 5, 3],
      [3, 6, 3],
      [4, 7, 3],
    ];
    for (const [dx, dy, width] of arc) {
      block(context, x + dx, y + dy, width, 1, SUN);
    }
    return;
  }
  block(context, x + 3, y + 2, 4, 5, SUN);
  block(context, x + 2, y + 3, 6, 3, SUN);
  for (const [dx, dy] of [[4, 0], [4, 9], [0, 4], [9, 4]] as const) {
    block(context, x + dx, y + dy, 1, 1, SUN);
  }
}

function drawCloud(context: CanvasRenderingContext2D, x: number, y: number): void {
  block(context, x + 1, y + 5, 9, 3, CLOUD_DARK);
  block(context, x + 3, y + 3, 4, 4, CLOUD_DARK);
  block(context, x + 2, y + 5, 7, 2, CLOUD_LIGHT);
  block(context, x + 4, y + 4, 3, 2, CLOUD_LIGHT);
}

/**
 * 날씨 아이콘. 그림은 12x12 논리 픽셀 안에 들어간다.
 *
 * `scale` 로 정수 배율만 받는다. 캔버스 변환으로 키우므로 픽셀이 흐려지지 않는다.
 * 머리말에서는 2배로 그려야 알아볼 수 있고, 미니에서는 자리가 좁아 1배를 쓴다.
 */
export function drawWeatherIcon(
  context: CanvasRenderingContext2D,
  observation: WeatherObservation,
  x: number,
  y: number,
  scale: number = 1,
): void {
  if (scale === 1) {
    drawWeatherIconAt(context, observation, x, y);
    return;
  }
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  drawWeatherIconAt(context, observation, 0, 0);
  context.restore();
}

function drawWeatherIconAt(
  context: CanvasRenderingContext2D,
  observation: WeatherObservation,
  x: number,
  y: number,
): void {
  const kind = weatherKind(observation.weatherCode);
  const night = !observation.isDay;
  if (kind === "clear") {
    drawSun(context, x + 1, y + 1, night);
    return;
  }
  if (kind === "partly-cloudy") {
    drawSun(context, x + 1, y, night);
    drawCloud(context, x + 2, y + 2);
    return;
  }
  if (kind === "fog") {
    drawCloud(context, x + 1, y);
    block(context, x + 1, y + 9, 9, 1, CLOUD_LIGHT);
    block(context, x + 3, y + 11, 7, 1, CLOUD_DARK);
    return;
  }
  drawCloud(context, x + 1, y);
  if (kind === "rain" || kind === "thunder") {
    block(context, x + 3, y + 9, 1, 2, RAIN);
    block(context, x + 8, y + 9, 1, 2, RAIN);
  }
  if (kind === "snow") {
    for (const dx of [3, 8]) {
      block(context, x + dx, y + 9, 1, 1, SNOW);
      block(context, x + dx - 1, y + 10, 3, 1, SNOW);
    }
  }
  if (kind === "thunder") {
    block(context, x + 6, y + 7, 2, 3, SUN);
    block(context, x + 5, y + 9, 2, 2, SUN);
  }
}

export function weatherText(state: WeatherState): string {
  const observation = state.observation;
  if (observation !== null) {
    const prefix = state.status === "stale" ? "~" : "";
    return `${prefix}${weatherLabel(weatherKind(observation.weatherCode))} ${Math.round(observation.temperatureC)}° · ${observation.precipitationMm.toFixed(1)}mm`;
  }
  switch (state.status) {
    case "disabled": return "";
    case "denied": return "위치 권한 필요";
    case "error": return "날씨 연결 안 됨";
    default: return "날씨 확인 중";
  }
}

export function compactWeatherText(state: WeatherState): string {
  const observation = state.observation;
  if (observation === null) return weatherText(state);
  const prefix = state.status === "stale" ? "~" : "";
  return `${prefix}${weatherLabel(weatherKind(observation.weatherCode))} ${Math.round(observation.temperatureC)}° ${observation.precipitationMm.toFixed(1)}mm`;
}

export function drawWeatherParticles(
  context: CanvasRenderingContext2D,
  state: WeatherState,
  animMs: number,
  rect: Rect,
): void {
  const observation = state.observation;
  if (observation === null) return;
  const kind = weatherKind(observation.weatherCode);
  if (kind !== "rain" && kind !== "snow" && kind !== "thunder") return;

  context.save();
  context.beginPath();
  context.rect(rect.x, rect.y, rect.width, rect.height);
  context.clip();

  if (kind === "snow") {
    const phase = Math.floor(animMs / 140);
    for (let index = 0; index < 26; index += 1) {
      const x = rect.x + ((index * 37 + Math.floor(phase / 3) * (index % 3)) % rect.width);
      const y = rect.y + ((index * 23 + phase) % rect.height);
      block(context, x, y, index % 5 === 0 ? 2 : 1, 1, SNOW);
    }
  } else {
    const phase = Math.floor(animMs / 55);
    for (let index = 0; index < 34; index += 1) {
      const x = rect.x + ((index * 43 + phase) % rect.width);
      const y = rect.y + ((index * 29 + phase * 3) % rect.height);
      block(context, x, y, 1, 3, RAIN);
      if (index % 3 === 0) block(context, x - 1, y + 3, 1, 1, RAIN);
    }
    if (kind === "thunder" && animMs % 4000 < 90) {
      context.globalAlpha = 0.12;
      block(context, rect.x, rect.y, rect.width, rect.height, "#fff4c2");
    }
  }
  context.restore();
}

export function weatherIconInk(): string {
  return INK;
}
