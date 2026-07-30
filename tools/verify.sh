#!/bin/bash
# 전구간 검증. 타입 -> 프런트 빌드 -> Rust -> 정적 서버 -> 스크린샷.
#
# 저장소 루트에서 실행한다:
#   bash tools/verify.sh
#
# 결과는 tmp/verify.log 에 남기고 스크린샷은 tmp/shots 에 떨어진다. 표준출력이 아니라
# 파일로 남기는 이유는, 개발 환경에 따라 셸 출력이 유실되는 경우가 있어서다.
#
# tauri dev 의 vite 서버에 붙지 않고 빌드 산출물을 따로 띄운다. 검증이 다른 프로세스의
# 생존에 의존하면 재현이 안 된다.
set -o pipefail

out=tmp/verify.log
port=4173
mkdir -p tmp
: > "$out"

echo "=== tsc ===" >> "$out"
npx tsc --noEmit >> "$out" 2>&1
echo "tsc_exit=$?" >> "$out"

echo "=== vite build ===" >> "$out"
npx vite build --logLevel warn >> "$out" 2>&1
build_status=$?
echo "vite_exit=$build_status" >> "$out"

echo "=== cargo check ===" >> "$out"
(cd src-tauri && cargo check --message-format short) >> "$out" 2>&1
echo "cargo_exit=$?" >> "$out"

if [ "$build_status" -ne 0 ]; then
  echo "프런트 빌드 실패로 스크린샷 생략" >> "$out"
  echo "=== END ===" >> "$out"
  exit 1
fi

echo "=== preview server ===" >> "$out"
npx vite preview --port "$port" --strictPort > tmp/preview.log 2>&1 &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null' EXIT

# 서버가 응답할 때까지 기다린다. 고정 sleep 보다 확실하다.
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://localhost:$port/"; then
    break
  fi
  sleep 0.5
done
printf 'preview_http=%s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/")" >> "$out"

echo "=== shoot ===" >> "$out"
SHOOT_URL="http://localhost:$port/" node tools/shoot.mjs --out tmp/shots >> "$out" 2>&1
echo "shoot_exit=$?" >> "$out"

kill "$preview_pid" 2>/dev/null
echo "=== END ===" >> "$out"
