/**
 * 앱 아이콘을 만들고 Tauri 가 쓰는 모든 크기로 변환한다.
 *
 * 이미지 생성은 codex CLI 의 OAuth 경로를 쓴다(tools/gen_image.mjs). OPENAI_API_KEY 가
 * 필요 없다. 변환은 Tauri CLI 의 icon 명령이 한다. icns, ico, 각종 png 를 한 번에 만든다.
 *
 * 사용법:
 *   node tools/make_icons.mjs              아이콘 생성 후 변환까지
 *   node tools/make_icons.mjs --skip-gen   이미 만들어 둔 원본으로 변환만
 */

import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

import { generateImage } from "./gen_image.mjs";

const SOURCE_PNG = "tmp/icon-source.png";

/**
 * 프롬프트는 구체적으로 쓴다. 픽셀아트 톤이 앱 화면과 맞아야 하고, 아이콘은 작게
 * 보이므로 요소를 줄여야 한다. 글자는 넣지 않는다. 작은 크기에서 뭉개지기만 한다.
 */
const PROMPT = [
  "Use case: logo-brand",
  "Asset type: macOS application icon for a pixel-art idle farm desktop widget",
  "Primary request: a cozy pixel-art farm icon centered on a rounded square badge",
  "Subject: a small red barn with a green gabled roof, two rows of green crop sprouts in front of it, one tiny tree at the left edge",
  "Style/medium: 16-bit pixel art, chunky visible pixels, thick dark outlines, flat shading, drawn on a coarse pixel grid",
  "Composition/framing: front-facing, centered, generous padding inside the badge, readable when scaled down to 32x32",
  "Lighting/mood: bright midday, calm and warm",
  "Color palette: grass green #84c669, soil orange #eaa56c, barn red #c14b3a, roof green #4e974c, cream #fdf3d8",
  "Constraints: keep it simple enough to stay legible at 32 pixels; no gradients; no photorealism",
  "Avoid: text, letters, numbers, watermark, logos, drop shadows outside the badge, more than one building",
].join("\n");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} 종료 코드 ${code}`));
      }
    });
  });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const skipGen = process.argv.includes("--skip-gen");
  await mkdir(path.dirname(SOURCE_PNG), { recursive: true });

  if (!skipGen) {
    console.log("아이콘 원본 생성 중. codex 세션을 띄우므로 시간이 걸린다.");
    const result = await generateImage({ prompt: PROMPT, out: SOURCE_PNG });
    console.log(`원본: ${result.out} (${result.bytes} bytes)`);
  } else if (!(await exists(SOURCE_PNG))) {
    throw new Error(`--skip-gen 인데 원본이 없다: ${SOURCE_PNG}`);
  }

  console.log("Tauri 아이콘 세트로 변환 중");
  await run("npx", ["tauri", "icon", SOURCE_PNG]);
  console.log("완료. src-tauri/icons 를 확인하라");
}

await main();
