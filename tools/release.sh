#!/bin/bash
# 릴리스 빌드. 저장소 루트에서 실행한다:
#   bash tools/release.sh          .app 만 만든다 (기본)
#   bash tools/release.sh dmg      .dmg 까지 만든다
#
# 기본을 .app 으로 둔 이유: DMG 번들링은 Finder 를 AppleScript 로 제어하는 단계가 있어서
# 자동화 권한이 없는 환경에서 응답 없이 멈춘다. 실행에 필요한 건 .app 하나다.
set -o pipefail

out=tmp/release.log
mkdir -p tmp
: > "$out"

bundles="app"
if [ "$1" = "dmg" ]; then
  bundles="app,dmg"
fi

echo "=== tauri build (bundles=$bundles) ===" >> "$out"
npx tauri build --bundles "$bundles" >> "$out" 2>&1
echo "build_exit=$?" >> "$out"

echo "=== 산출물 ===" >> "$out"
find src-tauri/target/release/bundle -maxdepth 2 \( -name "*.app" -o -name "*.dmg" \) >> "$out" 2>&1

echo "=== END ===" >> "$out"
