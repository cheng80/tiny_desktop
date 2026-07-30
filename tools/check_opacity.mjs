/**
 * 캔버스가 완전히 불투명한지 검사한다.
 *
 * 왜 필요한가: macOS 에서 투명 창을 쓰려면 Tauri 의 macos-private-api 를 켜야 하고,
 * 그러면 App Store 심사를 통과할 수 없다. 우리 화면은 패널을 창 전체에 꽉 채워 그리므로
 * 투명한 픽셀이 하나도 없을 수 있다. 그렇다면 투명 창 설정 자체가 불필요하고, 그것만
 * 끄면 App Store 경로가 열린다.
 *
 * 추측으로 끄면 창 모서리에 검은 구멍이 생길 수 있으니 픽셀로 확인한다.
 *
 * 사용법:
 *   node tools/check_opacity.mjs
 */

import { chromium } from "playwright";

const BASE_URL = process.env.SHOOT_URL ?? "http://localhost:4173/";

const PAGES = [
  { name: "main", path: "", viewport: { width: 576, height: 576 } },
  { name: "mini", path: "mini.html", viewport: { width: 224, height: 152 } },
];

async function measure(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      return { error: "canvas 없음" };
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return { error: "2d 컨텍스트 없음" };
    }
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let minAlpha = 255;
    let transparentPixels = 0;
    for (let index = 3; index < data.length; index += 4) {
      const alpha = data[index];
      if (alpha < minAlpha) {
        minAlpha = alpha;
      }
      if (alpha < 255) {
        transparentPixels += 1;
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      total: data.length / 4,
      minAlpha,
      transparentPixels,
    };
  });
}

async function main() {
  const browser = await chromium.launch();
  let opaque = true;

  for (const target of PAGES) {
    const context = await browser.newContext({
      viewport: target.viewport,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}${target.path}`, { waitUntil: "load" });
    // 시트 로딩과 첫 프레임을 기다린다.
    await page.waitForTimeout(1500);

    const result = await measure(page);
    if (result.error) {
      console.log(`${target.name}: 측정 실패 - ${result.error}`);
      opaque = false;
    } else {
      const ratio = ((result.transparentPixels / result.total) * 100).toFixed(3);
      console.log(
        `${target.name}: ${result.width}x${result.height} minAlpha=${result.minAlpha} ` +
          `투명픽셀=${result.transparentPixels}/${result.total} (${ratio}%)`,
      );
      if (result.minAlpha < 255) {
        opaque = false;
      }
    }
    await context.close();
  }

  await browser.close();
  console.log(
    opaque
      ? "OPAQUE OK - 투명 창 설정이 필요 없다"
      : "TRANSPARENT NEEDED - 투명 창 설정을 유지해야 한다",
  );
}

await main();
