/**
 * codex CLI 를 통해 이미지를 만든다. OPENAI_API_KEY 가 필요 없다.
 *
 * 원리는 이 기계에 설치된 sprite-gen 스킬의 codex provider 와 같다. codex 는 image_gen
 * 결과를 파일로 남기지 않고 세션 기록(jsonl)에 base64 로 인라인 저장한다. 그래서
 * 새 codex 세션을 띄워 이미지 하나만 만들게 하고, stdout 에서 thread id 를 뽑아
 * 해당 세션 기록을 찾아 base64 를 직접 디코딩한다. 모델이 말하는 경로는 믿지 않는다.
 *
 * 결정적인 인자들
 * - --sandbox workspace-write : image_gen 이 쓰기 권한 없이는 등록되지 않는다
 * - --add-dir ~/.codex/generated_images : 기본 쓰기 목록에 없어서 빠지면 조용히 실패한다
 * - --skip-git-repo-check : 임시 작업 디렉터리는 git 저장소가 아니다
 * - --ephemeral 금지 : 세션 기록이 디스크에 남아야 우리가 읽을 수 있다
 *
 * 사용법:
 *   node tools/gen_image.mjs --out tmp/icon.png --prompt "..."
 *   node tools/gen_image.mjs --out tmp/icon.png --prompt-file tmp/prompt.txt
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const CODEX_HOME = process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
const GENERATED_DIR = path.join(CODEX_HOME, "generated_images");
const SESSIONS_DIR = path.join(CODEX_HOME, "sessions");

/** codex 버전에 따라 인라인 결과가 실리는 레코드 이름이 다르다. 둘 다 정식 경로다 */
const RESULT_TYPES = new Set(["image_generation_call", "image_generation_end"]);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { out: null, prompt: null, promptFile: null, model: null };
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key === "--out" && value) {
      options.out = value;
      index += 1;
    } else if (key === "--prompt" && value) {
      options.prompt = value;
      index += 1;
    } else if (key === "--prompt-file" && value) {
      options.promptFile = value;
      index += 1;
    } else if (key === "--model" && value) {
      options.model = value;
      index += 1;
    }
  }
  return options;
}

function buildPrompt(userPrompt) {
  return [
    "image_gen 도구를 정확히 1번 호출해서 다음 프롬프트의 이미지 1장만 생성해줘.",
    "파일 저장, 셸 명령, 코드 작성, 경로 보고 전부 금지. 생성만 하고 끝.",
    "",
    "프롬프트:",
    userPrompt,
    "",
  ].join("\n");
}

function runCodex(prompt, workdir, model) {
  const args = [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
    "--color",
    "never",
    "--add-dir",
    GENERATED_DIR,
    "-C",
    workdir,
  ];
  if (model) {
    args.push("--model", model);
  }
  args.push("-");

  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split("\n").slice(-20).join("\n");
        reject(new Error(`codex exec 종료 코드 ${code}\n${tail}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function parseThreadId(stdout) {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      if (event && typeof event === "object" && event.thread_id) {
        return String(event.thread_id);
      }
    } catch {
      // JSON 이 아닌 줄은 넘긴다.
    }
  }
  // 옛 codex 는 평문으로 찍었다.
  const match = stdout.match(/session id: ([0-9a-f-]+)/i);
  return match ? match[1] : null;
}

async function findRollout(threadId) {
  const candidates = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.startsWith("rollout-") && entry.name.includes(threadId)) {
        candidates.push(full);
      }
    }
  }

  await walk(SESSIONS_DIR);
  if (candidates.length === 0) {
    throw new Error(`세션 기록을 찾을 수 없다: ${threadId} (${SESSIONS_DIR})`);
  }

  const withTime = await Promise.all(
    candidates.map(async (file) => ({ file, mtime: (await stat(file)).mtimeMs })),
  );
  withTime.sort((a, b) => b.mtime - a.mtime);
  return withTime[0].file;
}

async function collectInlineResults(rollout) {
  const content = await readFile(rollout, "utf8");
  const results = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const payload = record?.payload ?? {};
    if (!RESULT_TYPES.has(payload.type) || !payload.result) {
      continue;
    }
    if (payload.status !== undefined && payload.status !== "completed") {
      throw new Error(`image_gen 이 status=${payload.status} 로 끝났다: ${rollout}`);
    }
    results.push(payload.result);
  }
  if (results.length === 0) {
    throw new Error(
      `인라인 이미지 결과가 없다: ${rollout}\n` +
        "image_gen 이 호출되지 않았거나 codex 세션 형식이 바뀌었다.",
    );
  }
  return results;
}

function assertPng(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < signature.length) {
    throw new Error("결과가 PNG 로 보이지 않는다 (너무 짧다)");
  }
  for (let index = 0; index < signature.length; index += 1) {
    if (buffer[index] !== signature[index]) {
      throw new Error("결과가 PNG 시그니처와 다르다");
    }
  }
}

export async function generateImage({ prompt, out, model = null }) {
  await mkdir(GENERATED_DIR, { recursive: true });
  const workdir = await mkdtemp(path.join(tmpdir(), "tiny-farm-imagegen-"));

  const stdout = await runCodex(buildPrompt(prompt), workdir, model);
  const threadId = parseThreadId(stdout);
  if (!threadId) {
    throw new Error(
      "codex stdout 에서 thread id 를 찾지 못했다. image_gen 까지 가지 못한 것이다.\n" +
        "`codex login status` 와 --sandbox workspace-write 를 확인하라.",
    );
  }

  const rollout = await findRollout(threadId);
  const results = await collectInlineResults(rollout);
  const buffer = Buffer.from(results[results.length - 1], "base64");
  assertPng(buffer);

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, buffer);
  return { out, threadId, rollout, bytes: buffer.length };
}

async function main() {
  const options = parseArgs();
  if (!options.out) {
    throw new Error("--out 이 필요하다");
  }
  const prompt = options.promptFile
    ? await readFile(options.promptFile, "utf8")
    : options.prompt;
  if (!prompt) {
    throw new Error("--prompt 또는 --prompt-file 이 필요하다");
  }

  const result = await generateImage({ prompt, out: options.out, model: options.model });
  console.log(`생성 완료: ${result.out} (${result.bytes} bytes)`);
  console.log(`thread=${result.threadId}`);
}

// 다른 스크립트가 import 할 수도 있으므로 직접 실행일 때만 돈다.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
