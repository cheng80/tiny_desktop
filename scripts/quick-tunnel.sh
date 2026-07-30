#!/bin/sh
set -eu

origin="http://127.0.0.1:5173"

command -v cloudflared >/dev/null 2>&1 || {
  echo "cloudflared가 설치되어 있지 않습니다." >&2
  exit 1
}

curl -fsS "$origin" >/dev/null || {
  echo "$origin 서버를 먼저 실행하세요: npm run dev -- --host 127.0.0.1 --port 5174" >&2
  exit 1
}

exec cloudflared tunnel --url "$origin" --http-host-header "127.0.0.1:5174"
