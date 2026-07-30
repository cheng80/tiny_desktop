#!/bin/bash
# macOS 설치본을 만든다. 저장소 루트에서 실행한다:
#   bash tools/install_macos.sh
#   APPLE_SIGNING_IDENTITY="Developer ID Application: ..." bash tools/install_macos.sh
#
# 하는 일: 인증서 결정 -> 빌드 -> /Applications 설치 -> LaunchServices 등록 -> 서명 검증.
#
# 왜 이 절차가 필요한가.
#
# 1) 서명 주체가 고정되어야 위치 권한이 유지된다.
#    Tauri 가 그냥 만든 산출물은 ad-hoc(linker-signed) 이라 Designated Requirement 가
#    `cdhash H"..."` 하나로 굳는다. locationd 는 그 조건으로 권한을 저장하므로 코드가 한 줄만
#    바뀌어도 다른 앱으로 취급되어 위치 권한이 초기화된다. 인증서로 서명하면 요구사항이
#    `identifier "app.tinyfarm.widget" and ... certificate leaf[...]` 가 되어 재빌드에도 유지된다.
#
# 2) /Applications 에 두고 LaunchServices 에 등록해야 앱으로 인식된다.
#    빌드 폴더에서 실행하면 locationd 로그에 `LaunchServices does not have an application record`
#    가 남고 클라이언트가 앱으로 해석되지 않는다.
#
# 배포본은 Developer ID 로 서명한 뒤 공증이 필요하다. 이 스크립트는 서명까지만 하고,
# 공증은 아래 주석의 명령을 별도로 실행한다.
#   xcrun notarytool submit "Tiny Farm.zip" --keychain-profile <프로파일> --wait
#   xcrun stapler staple "/Applications/Tiny Farm.app"
set -o pipefail

APP_NAME="Tiny Farm.app"
BUILT="src-tauri/target/release/bundle/macos/$APP_NAME"
INSTALLED="/Applications/$APP_NAME"
BUNDLE_ID="app.tinyfarm.widget"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Support/lsregister
out=tmp/install_macos.log

mkdir -p tmp
: > "$out"

log() {
  echo "$1" | tee -a "$out"
}

# 1) 서명 인증서 결정. 환경 변수를 우선하고, 없으면 키체인의 Apple Development 를 쓴다.
# 이름이 같은 인증서가 여러 개면 codesign 이 `ambiguous` 로 실패한다. 그래서 이름이 아니라
# SHA-1 해시로 지정한다. 해시는 키체인 안에서 유일하다.
identity="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "$identity" ]; then
  identity=$(security find-identity -v -p codesigning 2>/dev/null \
    | awk '/Apple Development/ {print $2; exit}')
  identity_label=$(security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' '/Apple Development/ {print $2; exit}')
else
  identity_label="$identity"
fi

if [ -z "$identity" ]; then
  log "경고: 코드서명 인증서를 찾지 못했다. ad-hoc 으로 빌드한다."
  log "      이 경우 재빌드마다 macOS 위치 권한이 초기화된다."
  log "      해결: Xcode 에서 Apple Development 인증서를 만들거나"
  log "            APPLE_SIGNING_IDENTITY 로 Developer ID 를 지정한다."
else
  log "서명 인증서: ${identity_label:-$identity} ($identity)"
  # Tauri 가 빌드 단계에서 이 인증서로 서명한다. 빌드 후 재서명이 필요 없다.
  export APPLE_SIGNING_IDENTITY="$identity"
fi

# 2) 실행 중인 앱을 먼저 내린다. 실행 중 번들을 덮어쓰면 서명 검증이 깨진다.
if pkill -f "/$APP_NAME/Contents/MacOS/app" >/dev/null 2>&1; then
  log "실행 중이던 앱을 종료했다."
  sleep 1
fi

# 3) 빌드
log "=== tauri build ==="
npx tauri build --bundles app >> "$out" 2>&1
build_exit=$?
log "build_exit=$build_exit"
if [ "$build_exit" -ne 0 ]; then
  log "빌드 실패. 자세한 내용은 $out 을 본다."
  exit 1
fi

if [ ! -d "$BUILT" ]; then
  log "산출물을 찾지 못했다: $BUILT"
  exit 1
fi

# 4) 설치
log "=== /Applications 설치 ==="
rm -rf "$INSTALLED"
if ! cp -R "$BUILT" "$INSTALLED"; then
  log "복사 실패. /Applications 쓰기 권한을 확인한다."
  exit 1
fi

# 5) LaunchServices 등록
"$LSREGISTER" -f "$INSTALLED" >> "$out" 2>&1
log "lsregister_exit=$?"

# 6) 서명 검증. 요구사항이 cdhash 로 굳었으면 위치 권한이 유지되지 않으므로 알려 준다.
log "=== 서명 검증 ==="
codesign --verify --strict --verbose=2 "$INSTALLED" >> "$out" 2>&1
log "codesign_verify_exit=$?"

requirement=$(codesign -d --requirements - "$INSTALLED" 2>/dev/null | tail -1)
log "requirement=$requirement"

authority=$(codesign -dvvv "$INSTALLED" 2>&1 | awk -F= '/^Authority=/ {print $2; exit}')
log "authority=${authority:-none}"

case "$requirement" in
  *"identifier \"$BUNDLE_ID\""*certificate*)
    log "OK: 인증서 기반 요구사항이다. 재빌드해도 위치 권한이 유지된다."
    ;;
  *cdhash*)
    log "주의: 요구사항이 cdhash 로 굳었다. 재빌드마다 위치 권한이 초기화된다."
    log "      APPLE_SIGNING_IDENTITY 를 지정해 다시 실행한다."
    ;;
  *)
    log "주의: 요구사항을 해석하지 못했다. $out 을 확인한다."
    ;;
esac

# 7) 공증. 배포용으로 Developer ID 서명을 했고 키체인 프로파일을 준 경우에만 수행한다.
#
# 준비:
#   Apple Developer Program 가입 후 Developer ID Application 인증서를 발급한다.
#   xcrun notarytool store-credentials <프로파일> --apple-id <계정> --team-id <팀> --password <앱 암호>
#
# 실행:
#   APPLE_SIGNING_IDENTITY="Developer ID Application: ..." \
#   TINY_FARM_NOTARY_PROFILE=<프로파일> npm run install:macos
if [ -n "${TINY_FARM_NOTARY_PROFILE:-}" ]; then
  if printf '%s' "$authority" | grep -q "Developer ID Application"; then
    log "=== 공증 ==="
    zip_path="tmp/Tiny Farm.zip"
    rm -f "$zip_path"
    # notarytool 은 디렉터리를 받지 않는다. ditto 로 번들 구조를 유지한 zip 을 만든다.
    /usr/bin/ditto -c -k --keepParent "$INSTALLED" "$zip_path" >> "$out" 2>&1
    log "ditto_exit=$?"

    xcrun notarytool submit "$zip_path" \
      --keychain-profile "$TINY_FARM_NOTARY_PROFILE" --wait >> "$out" 2>&1
    notary_exit=$?
    log "notarytool_exit=$notary_exit"

    if [ "$notary_exit" -eq 0 ]; then
      xcrun stapler staple "$INSTALLED" >> "$out" 2>&1
      log "stapler_exit=$?"
      spctl --assess --type execute --verbose=2 "$INSTALLED" >> "$out" 2>&1
      log "gatekeeper_assess_exit=$?"
    else
      log "공증 실패. $out 의 notarytool 출력을 확인한다."
    fi
    rm -f "$zip_path"
  else
    log "공증 생략: Developer ID 서명이 아니다 (현재: ${authority:-none})."
    log "        Apple Development 인증서로는 배포 공증을 할 수 없다."
  fi
fi

# 8) 실행. 설치 전에 앱을 종료했으므로 다시 띄워 준다.
#    끄고 싶으면 TINY_FARM_NO_LAUNCH=1 을 준다.
if [ -z "${TINY_FARM_NO_LAUNCH:-}" ]; then
  open "$INSTALLED"
  sleep 5
  running=$(pgrep -f "/$APP_NAME/Contents/MacOS/app" | wc -l | tr -d ' ')
  log "실행 중 프로세스=$running"
  if [ "$running" = "0" ]; then
    log "주의: 앱이 실행되지 않았다. $out 을 확인한다."
  fi
fi

log "=== 설치 완료: $INSTALLED ==="
