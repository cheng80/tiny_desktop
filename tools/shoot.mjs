/**
 * Playwright 로 위젯을 여러 상태와 시각으로 찍는다.
 *
 * macOS 화면 녹화 권한이 막혀 screencapture 가 셸을 멈추게 하므로 데스크톱 창을 직접
 * 찍을 수 없다. 대신 같은 프런트엔드를 정적 서버에서 헤드리스 브라우저로 열어 찍는다.
 * 그리는 코드가 동일하므로 렌더 결과를 검증하는 목적에는 충분하다.
 *
 * 시각과 농장 상태를 주입해야 낮/밤, 빈 밭/익은 밭 같은 경우를 한 번에 볼 수 있다.
 * 그래서 페이지가 시작되기 전에 Date 를 고정하고 localStorage 에 상태를 심는다.
 *
 * 사용법:
 *   node tools/shoot.mjs --out tmp/shots
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const BASE_URL = process.env.SHOOT_URL ?? "http://localhost:4173/";

/** src/core 의 값과 맞춰야 한다. 어긋나면 상태 검증에 걸려 초기화된다 */
const SCHEMA_VERSION = 3;
const PLOT_MAX = 16;
const CROP_COUNT = 6;
const MINUTE = 60_000;
const GROWTH_STAGE_MS = 20 * MINUTE;
const GROWTH_STAGES = 3;

const MAIN_VIEWPORT = { width: 576, height: 576 };
const MINI_VIEWPORT = { width: 224, height: 152 };
const WEATHER_CACHE_KEY = "tiny-farm-weather";

const WEATHER_FIXTURES = {
  clear: { temperature_2m: 24.2, precipitation: 0, rain: 0, snowfall: 0, weather_code: 0, is_day: 1 },
  rain: { temperature_2m: 18.4, precipitation: 2.6, rain: 2.6, snowfall: 0, weather_code: 63, is_day: 1 },
  snow: { temperature_2m: -3.1, precipitation: 1.4, rain: 0, snowfall: 1.1, weather_code: 75, is_day: 0 },
};

function weatherObservation(kind, fetchedAt) {
  const fixture = WEATHER_FIXTURES[kind];
  return {
    fetchedAt,
    sourceTime: new Date(fetchedAt).toISOString(),
    temperatureC: fixture.temperature_2m,
    precipitationMm: fixture.precipitation,
    rainMm: fixture.rain,
    snowfallCm: fixture.snowfall,
    weatherCode: fixture.weather_code,
    isDay: fixture.is_day === 1,
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  let out = "tmp/shots";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--out" && args[index + 1]) {
      out = args[index + 1];
      index += 1;
    }
  }
  return { out };
}

/**
 * 농장 상태를 만든다. stages 는 각 칸의 성장 단계(0~3) 또는 null.
 * plantedAt 은 농장 시계 기준이라, 기준 시각에서 단계만큼 거꾸로 뺀다.
 */
function makeState({
  stages,
  storage = 0,
  capacity = 20,
  coins = 0,
  plotCount,
  animals = 3,
  decor = 0,
}) {
  const farmTimeMs = GROWTH_STAGES * GROWTH_STAGE_MS;
  const plots = new Array(PLOT_MAX).fill(null);
  stages.forEach((stage, index) => {
    if (stage === null) {
      return;
    }
    plots[index] = {
      crop: index % CROP_COUNT,
      plantedAt: farmTimeMs - stage * GROWTH_STAGE_MS,
    };
  });

  return {
    version: SCHEMA_VERSION,
    farm: {
      farmTimeMs,
      lastSeenAt: 0,
      plots,
      plotCount: plotCount ?? stages.length,
      storage,
      storageCapacity: capacity,
      coins,
      nextCrop: 0,
      totalHarvests: storage,
      animals,
      // 사료 시계를 현재로 맞춰 로드 직후 동물이 창고를 비우지 않게 한다.
      lastFeedAt: farmTimeMs,
      decor,
    },
  };
}

const SCENARIOS = [
  {
    name: "01-morning",
    hour: 9,
    view: "main",
    state: makeState({ stages: [1, 2, 0, 3], coins: 12, storage: 4 }),
  },
  {
    name: "02-noon-all-ripe",
    hour: 13,
    view: "main",
    state: makeState({ stages: [3, 3, 3, 3], coins: 80, storage: 12 }),
  },
  {
    name: "03-dusk-rain",
    hour: 18.5,
    view: "main",
    weather: "rain",
    state: makeState({ stages: [2, 1, 3, 2], coins: 30, storage: 7 }),
  },
  {
    name: "04-night-snow",
    hour: 23,
    view: "main",
    weather: "snow",
    state: makeState({ stages: [1, 3, 2, 0], coins: 5, storage: 0 }),
  },
  {
    name: "05-dawn",
    hour: 6.2,
    view: "main",
    state: makeState({ stages: [2, 2, 1, 1], coins: 44, storage: 9 }),
  },
  {
    name: "06-full-farm",
    hour: 11,
    view: "main",
    state: makeState({
      stages: [3, 2, 1, 3, 2, 1, 3, 2, 1, 3, 2, 1, 3, 2, 1, 3],
      plotCount: PLOT_MAX,
      storage: 40,
      capacity: 40,
      coins: 520,
      animals: 8,
      decor: 8,
    }),
  },
  {
    name: "07-barn-full",
    hour: 15,
    view: "main",
    state: makeState({ stages: [3, 3, 3, 3], storage: 20, capacity: 20, coins: 0 }),
  },
  {
    name: "08-settings",
    hour: 10,
    view: "main",
    openSettings: true,
    state: makeState({ stages: [1, 2, 3, 2], coins: 100, storage: 6 }),
  },
  // 도움말은 글이 잘리는지 눈으로 봐야 하므로 일곱 장을 모두 찍는다.
  ...[
    "1-intro",
    "2-harvest",
    "3-coins",
    "4-expand",
    "5-weather",
    "6-window",
    "7-away",
  ].map((label, page) => ({
    name: `${19 + page}-help-${label}`,
    hour: 10,
    view: "main",
    helpPage: page,
    state: makeState({ stages: [1, 2, 3, 2], coins: 100, storage: 6 }),
  })),
  {
    name: "09-mini-day-rain",
    hour: 12,
    view: "mini",
    weather: "rain",
    state: makeState({ stages: [1, 2, 3, 1], coins: 20, storage: 5 }),
  },
  {
    name: "10-mini-night-snow",
    hour: 22,
    view: "mini",
    weather: "snow",
    state: makeState({ stages: [3, 3, 2, 1], coins: 20, storage: 18 }),
  },
  {
    name: "11-location-denied",
    hour: 10,
    view: "main",
    locationDenied: true,
    state: makeState({ stages: [1, 2, 3, 2], coins: 20, storage: 5 }),
  },
  {
    name: "12-offline-stale",
    hour: 16,
    view: "main",
    weather: "clear",
    offline: true,
    state: makeState({ stages: [2, 2, 1, 3], coins: 20, storage: 5 }),
  },
  {
    name: "13-decor-0",
    hour: 11,
    view: "main",
    state: makeState({ stages: [1, 2, 3, 1], coins: 100, storage: 5, decor: 0 }),
  },
  {
    name: "14-decor-1",
    hour: 11,
    view: "main",
    state: makeState({ stages: [1, 2, 3, 1], coins: 100, storage: 5, decor: 1 }),
  },
  {
    name: "15-decor-2",
    hour: 11,
    view: "main",
    state: makeState({ stages: [1, 2, 3, 1], coins: 100, storage: 5, decor: 2 }),
  },
  {
    name: "16-decor-8",
    hour: 11,
    view: "main",
    state: makeState({ stages: [1, 2, 3, 1], coins: 100, storage: 5, decor: 8 }),
  },
  {
    name: "17-mini-decor-0",
    hour: 11,
    view: "mini",
    state: makeState({ stages: [1, 2, 3, 1], coins: 100, storage: 5, decor: 0 }),
  },
  {
    name: "18-mini-decor-2",
    hour: 11,
    view: "mini",
    state: makeState({ stages: [1, 2, 3, 1], coins: 100, storage: 5, decor: 2 }),
  },
];

/**
 * 페이지가 시작되기 전에 Date 를 고정한다. 움직임은 rAF 타임스탬프로 흐르게 두고
 * 시계와 낮밤만 고정하면 스크린샷이 충분히 재현된다.
 */
function freezeDateScript(epochMs) {
  return `
    (() => {
      const fixedNow = ${epochMs};
      const RealDate = Date;
      class FrozenDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(fixedNow);
          } else {
            super(...args);
          }
        }
        static now() {
          return fixedNow;
        }
      }
      globalThis.Date = FrozenDate;
    })();
  `;
}

async function main() {
  const { out } = parseArgs();
  await mkdir(out, { recursive: true });

  const browser = await chromium.launch();
  const results = [];

  for (const scenario of SCENARIOS) {
    const base = new Date(2026, 6, 30, 0, 0, 0, 0);
    const epoch = base.getTime() + scenario.hour * 60 * MINUTE;

    const context = await browser.newContext({
      viewport: scenario.view === "mini" ? MINI_VIEWPORT : MAIN_VIEWPORT,
      deviceScaleFactor: 2,
      timezoneId: "Asia/Seoul",
      geolocation: { latitude: 37.5665, longitude: 126.978 },
      permissions: scenario.locationDenied === true ? [] : ["geolocation"],
    });
    const page = await context.newPage();
    const weatherKind = scenario.weather ?? "clear";
    await page.route("https://api.open-meteo.com/**", async (route) => {
      if (scenario.offline === true) {
        await route.abort("internetdisconnected");
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          current: {
            time: new Date(epoch).toISOString(),
            ...WEATHER_FIXTURES[weatherKind],
          },
        }),
      });
    });

    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !(scenario.offline === true && message.text().includes("ERR_INTERNET_DISCONNECTED"))
      ) {
        errors.push(`console: ${message.text()}`);
      }
    });

    // lastSeenAt 을 고정 시각으로 맞춰 로드 직후 정산이 시간을 더하지 않게 한다.
    const state = structuredClone(scenario.state);
    state.farm.lastSeenAt = epoch;

    const shouldSeedWeather = scenario.view === "mini" || scenario.offline === true;
    const weatherFetchedAt = epoch - (scenario.offline === true ? 20 * MINUTE : 0);
    const weatherCache = shouldSeedWeather
      ? JSON.stringify({ version: 1, observation: weatherObservation(weatherKind, weatherFetchedAt) })
      : null;
    await page.addInitScript(freezeDateScript(epoch));
    await page.addInitScript(
      ([stateKey, stateValue, weatherKey, weatherValue]) => {
        window.localStorage.setItem(stateKey, stateValue);
        if (weatherValue === null) {
          window.localStorage.removeItem(weatherKey);
        } else {
          window.localStorage.setItem(weatherKey, weatherValue);
        }
      },
      ["tiny-farm-state", JSON.stringify(state), WEATHER_CACHE_KEY, weatherCache],
    );

    const url = scenario.view === "mini" ? `${BASE_URL}mini.html` : BASE_URL;
    await page.goto(url, { waitUntil: "load" });
    // 시트 로딩과 몇 프레임을 기다린다.
    await page.waitForTimeout(1200);

    if (scenario.openSettings === true) {
      // 톱니 버튼은 논리 좌표 기준 오른쪽 위. CSS 좌표로 환산해 누른다.
      await page.mouse.click(MAIN_VIEWPORT.width - 28, 26);
      await page.waitForTimeout(400);
    }

    if (typeof scenario.helpPage === "number") {
      // 물음표 버튼은 톱니에서 왼쪽으로 두 칸(논리 40px, CSS 80px) 떨어져 있다.
      await page.mouse.click(MAIN_VIEWPORT.width - 108, 26);
      await page.waitForTimeout(400);
      // `다음`을 눌러 원하는 장까지 넘긴다. 버튼은 패널 아래쪽 가운데 오른쪽.
      for (let step = 0; step < scenario.helpPage; step += 1) {
        await page.mouse.click(MAIN_VIEWPORT.width / 2 + 64, 452);
        await page.waitForTimeout(250);
      }
    }

    const file = path.join(out, `${scenario.name}.png`);
    await page.screenshot({ path: file });
    results.push({ name: scenario.name, file, errors });

    await context.close();
  }

  await browser.close();

  let failed = 0;
  for (const result of results) {
    if (result.errors.length > 0) {
      failed += 1;
      console.log(`${result.name}: 오류 ${result.errors.length}건`);
      for (const error of result.errors.slice(0, 5)) {
        console.log(`  - ${error}`);
      }
    } else {
      console.log(`${result.name}: OK -> ${result.file}`);
    }
  }
  console.log(failed === 0 ? "SHOOT OK" : `SHOOT 실패 ${failed}건`);
}

await main();
