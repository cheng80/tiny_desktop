# Focus Farm 구현 체크리스트

마지막 갱신: 2026-07-30 20:0x (위치 실기 성공, 로그인 항목 권한 처리 추가 반영)

이 문서를 구현 완료 여부의 단일 기준으로 사용한다. 빌드 성공이나 API 호출 성공만으로는 완료 처리하지 않으며, 각 항목의 코드·자동 검증·macOS 실기 증거가 모두 확인된 뒤에만 `[x]`로 바꾼다.

## 현재 상태

요약: **코드 구현은 전부 완료**. 자동 검증과 위치 실기까지 통과했고, 남은 것은 최신 코드로 릴리스 1회 재빌드 + 로그인 항목·초기화·미니 실기 3건이다.

- 자동 검증: `verify_exit=0`, TypeScript·Vite·Cargo·preview HTTP·18개 스크린샷 시나리오 통과
- 장식 시각 검증: 메인 0·1·2·8, 미니 0·2 모두 통과
- 위치 실기 성공: 실제 프롬프트 표시 → 허용 → 설정 패널 `위치 권한: 허용`, 메인 헤더 `맑음 26° · 0.0mm`
- 실제 Open-Meteo 캐시 확인: `tiny-farm-weather` = `temperatureC 26.3`, `sourceTime 2026-07-30T19:30`, `weatherCode 0`. 좌표는 저장되지 않음
- 코드 감사 결함 4건 수정 완료: LaunchAgent lint 선행·구조 검증, `bootout` 실패 전파, 초기화 저장 직렬화, 백업 복구
- 로그인 실행은 TCC 권한이 아님을 실기로 확인하고, launchd `disabled` 플래그 처리와 `로그인 항목` 버튼을 추가함
- 마지막 릴리스 빌드(19:39:33)는 로그인 항목 변경 이전 코드다. 최종 재빌드가 남아 있다

### 남은 작업

1. 최신 코드로 `npm run tauri -- build --bundles app` 1회 재빌드
2. 로그인 시 실행 실기: 토글 ON → plist·`launchctl print`·`print-disabled` 일치 → 앱 종료 후 재실행 → 토글 동기화 → OFF 확인
3. 농장 초기화 실기: 트레이 초기화 취소(불변) / 확인(백업+새 농장)
4. 미니 실기: 같은 날씨 snapshot 표시와 `열기` 후 메인 복귀
5. 임시 진단 파일·중복 프로세스 정리 후 증거 표 마감

## 진행 원칙

- 작업 직후 해당 체크박스와 아래 증거 표를 함께 갱신한다.
- OS 기능은 TCC 또는 LaunchAgent의 실제 상태까지 확인한다.
- 좌표는 메모리에서만 사용하고 파일·설정·로그에 기록하지 않는다.
- 실패하면 원인을 수정한 뒤 같은 검증을 다시 실행한다.
- 개발 서버 `http://127.0.0.1:5174`는 전 작업 중 유지한다.

## 1. 확인된 기준선

- [x] Open-Meteo 현재 날씨 필드와 응답 검증을 구현했다.
- [x] 15분 갱신, 5분 재시도, 최대 6시간 stale 캐시를 구현했다.
- [x] 메인 창이 날씨를 소유하고 미니 창에 snapshot으로 전달한다.
- [x] 7종 픽셀 날씨 아이콘과 비·눈·뇌우 장면 효과를 구현했다.
- [x] 위치 거부·offline stale·맑음·비·눈을 포함한 브라우저 시나리오가 통과했다.
- [x] 최종 `npm run verify`에서 TypeScript·Vite·Cargo·preview·18개 스크린샷 검증이 통과했다.
- [x] 릴리스 앱과 번들 Info.plist의 두 위치 설명 문자열을 확인했다.
- [x] 릴리스 WKWebView `navigator.geolocation`이 28초 이상 TCC 위치 요청을 만들지 않는 실패를 실기로 확인했다.
- [x] 로그인 실행 활성화 전 앱 확인창과 설정 스키마를 구현했다.
- [x] 미니 클릭 통과 기능을 완전히 제거했다.
- [x] ImageGen Codex OAuth 경로를 `design.md`에 기록했다.

> 위 기준선은 아래 미완료된 macOS 실기 항목의 완료를 의미하지 않는다.

## 2-A. 위치 권한 UI와 나중 허용 반영

### 구현

- [x] 권한 미결정 상태에서 `requestLocation`을 즉시 호출해 프롬프트가 바로 철회되던 결함을 수정했다.
- [x] 프롬프트 응답을 기다리도록 네이티브 timeout을 25초, Rust 수신을 28초로 늘렸다.
- [x] CoreLocation 권한 변경 감시자를 추가하고 허용 시 `tiny-farm://location-authorization`을 보낸다.
- [x] 프런트가 이 신호로 즉시 날씨를 강제 갱신한다. 거부 상태의 무한 대기를 해제한다.
- [x] 설정 패널에 `위치 권한` 상태를 표시한다(허용·거부·제한·미결정·시스템 꺼짐·요청 중).
- [x] 설정 패널에 `권한 요청` 버튼을 추가해 앱 안에서 다시 요청한다.
- [x] 설정 패널에 `시스템 설정` 버튼을 추가해 위치 서비스 창을 연다.
- [x] 설정 패널을 열 때와 권한 변경 시 상태를 다시 읽는다.
- [x] 패널 높이를 늘려 새 항목이 닫기 버튼과 겹치지 않는다.

### 실기

- [x] 새 릴리스에서 실제 macOS 위치 프롬프트가 표시되고 문구가 올바르다: "'Tiny Farm'이(가) 사용자의 현재 위치를 사용하려고 합니다".
- [x] 프롬프트가 즉시 사라지지 않고 응답을 기다린다(로그: `Showing #AuthPrompt` 후 25초 유지).
- [x] Tiny Farm이 시스템 설정 위치 서비스 목록에 등록된다.
- [x] 허용 후 앱이 실제 날씨로 갱신된다: 헤더 `맑음 26° · 0.0mm`.
- [x] 설정 패널의 상태 표시가 실제 권한과 일치한다: `위치 권한: 허용`.

> macOS는 위치 프롬프트를 보호된 시스템 대화상자로 처리해 자동 클릭을 차단한다(`permission_denied`). 허용 클릭은 사용자가 직접 해야 한다.

## 2. macOS 현재 위치와 실제 날씨

### 구현

- [x] CoreLocation one-shot 네이티브 브리지를 추가했다.
- [x] 메인 스레드에서 `CLLocationManager`를 생성하고 delegate를 요청 종료까지 유지한다.
- [x] 권한 미결정·허용·거부·제한·오류·12초 timeout을 구분한다.
- [x] 성공·실패·timeout 경쟁에서도 콜백을 정확히 한 번만 완료한다.
- [x] 네이티브 브리지를 ARC로 컴파일하고 CoreLocation/Foundation framework를 링크한다.
- [x] Tauri `request_current_location` 명령을 등록하고 메인 창만 호출 가능하게 한다.
- [x] Tauri는 네이티브 명령, 일반 브라우저/Playwright는 `navigator.geolocation`을 사용한다.
- [x] 네이티브 거부 결과를 `WeatherLocationError(denied: true)`로 변환한다.
- [x] 좌표를 디스크·설정·로그에 저장하지 않는다.
- [x] 기존 요청 중복 방지·토글 취소·재시도·stale 동작을 유지한다.
- [x] 최종 번들에 두 위치 사용 설명 문자열을 유지한다.

### 자동 검증

- [x] 브라우저 geolocation 성공·거부 fixture가 계속 통과한다.
- [x] 네이티브 성공·거부·오류 변환 경로를 독립 코드 감사했다.
- [x] TypeScript와 Rust 검사가 통과했다.

### macOS 릴리스 실기

- [x] 권한 미결정 상태에서 Tiny Farm의 실제 위치 권한 프롬프트가 나타난다.
- [x] 프롬프트의 사용 설명 문구가 올바르다: "현재 위치의 날씨를 농장에 표시하기 위해 위치가 필요합니다".
- [x] 권한 요청 경로를 OS 로그로 확인한다: `locationd`의 `Showing #AuthPrompt` + `CoreLocationAgent` 전달.
  - 참고: CoreLocation은 `tccd`의 `kTCCServiceLocation`이 아니라 `locationd` 경로로 권한을 처리한다. 확인 기준을 로그 실측에 맞춰 수정했다.
- [x] 실제 Open-Meteo 응답이 캐시에 저장된다: `temperatureC 26.3`, `sourceTime 2026-07-30T19:30`.
- [x] 메인에 실제 아이콘·날씨·온도·강수량이 표시된다: `맑음 26° · 0.0mm`.
- [x] 미니에 같은 snapshot과 강수 효과가 표시된다. (사용자 실기 확인)
- [x] 미니 `열기` 후 메인만 다시 표시된다. (사용자 실기 확인)
- [x] 권한 거부/시스템 위치 서비스 OFF 시 앱은 계속 실행되고 `위치 권한 필요`를 표시한다.
- [x] 캐시 유효 구간에서 stale 규칙이 동작한다: 자동 시나리오 `12-offline-stale` 통과.

## 3-B. 로그인 항목 목록 노출 (SMAppService 전환)

확인된 결함: 자체 LaunchAgent 는 실행 프로그램이 `/usr/bin/open` 이라 macOS 백그라운드 항목 관리가 Apple 시스템 바이너리로 귀속시켰다. 실행 등록은 되지만 시스템 설정 로그인 항목 목록에 앱이 나타나지 않았다.

- [x] macOS 13+ 에서 `SMAppService.mainAppService` 로 앱 자신을 등록한다.
- [x] 상태를 정식 API 기준으로 판정한다(`enabled`/`requiresApproval`/`notRegistered`).
- [x] 사용자가 시스템 설정에서 끈 경우 `requiresApproval` 을 꺼진 상태로 보고하고 승인 안내를 낸다.
- [x] 정식 API 로 전환할 때 과거 LaunchAgent plist 를 정리한다.
- [x] macOS 12 이하는 기존 LaunchAgent 방식으로 되돌아간다.
- [x] `mechanism` 필드로 어떤 방식인지 프런트에 알린다.
- [x] 실기: 목록에 `Tiny Farm.app 응용 프로그램` 표시 확인, 앱 로그 `serviceManagement register enabled=true`, plist 없음. (2026-07-30 22:11)

## 3-A. 로그인 실행 권한 처리 (TCC 아님)

확인 사실: macOS 15.7.7에서 로그인 실행은 TCC 권한 대상이 아니라 프롬프트가 없다. 실제 차단 요소는 launchd 사용자별 `disabled` 플래그이며, 시스템 설정 > 일반 > 로그인 항목에서 사용자가 끈다. 형식은 `launchctl print-disabled gui/<uid>`의 `"label" => disabled|enabled`다.

- [x] `launchctl print-disabled`로 사용자가 끈 상태를 읽어 `userDisabled`로 보고한다.
- [x] 파일이 있고 경로가 맞아도 `userDisabled`면 켜진 상태로 취급하지 않는다.
- [x] 활성화 시 `launchctl enable`로 사용자가 끈 플래그를 먼저 해제한 뒤 bootstrap한다.
- [x] 설정 패널에 `로그인 항목` 버튼을 추가해 해당 시스템 설정 창을 연다.
- [x] 실패 안내에 로그인 실행은 허용 창이 없고 로그인 항목에서 관리된다는 설명을 넣는다.
- [x] 실기: 토글 ON 후 plist·`launchctl print`·`print-disabled`가 일치한다. (2026-07-30 21:48)
  - plist: `Label=app.tinyfarm.widget`, `ProgramArguments=[/usr/bin/open, -g, /Applications/Tiny Farm.app]`, `RunAtLoad=1`
  - `launchctl print gui/501/app.tinyfarm.widget` 등록 확인, `print-disabled` 항목 없음
  - 앱 로그: `enable ok enabled=true loaded=true`, 끄기도 `disable ok`
- [x] 실기: 자체 점검(`TINY_FARM_SELFTEST=autostart`)으로 UI 없이 enable/disable 전 과정 검증.
- [x] 실기: 끄기 → `serviceManagement unregister enabled=false`, 다시 켜기 → `register enabled=true` 및 목록 재등록 확인. (2026-07-30 23:20)
- [x] 실기: 로그인 항목에서 끄면 앱 토글이 꺼진 상태로 동기화된다. (사용자 확인)
- [x] 실기: 재로그인 시 자동 실행된다. (사용자 확인)

## 3. 로그인 시 실행

### 구현

- [x] 기존 plugin이 plist 존재만 확인하고 현재 세션에 bootstrap하지 않는 실패 원인을 확인했다.
- [x] `enable()`/`disable()` 직후 실제 등록 상태가 요청값과 일치하는지 검증한다.
- [x] 불일치 시 설정 저장을 취소하고 토글을 원래 값으로 유지한다.
- [x] 오류 안내에 실제 실패와 macOS 확인 경로를 표시한다.
- [x] 시작 시 실제 OS 상태를 설정과 동기화한다.
- [x] plugin을 검증 가능한 Rust LaunchAgent 구현으로 교체했다.
- [x] 앱 경로의 공백과 특수문자를 XML escape한다.
- [x] 최종 plist 교체 전에 `plutil -lint`를 통과시킨다.
- [x] `Label`과 `ProgramArguments[0..2]`를 문자열 포함이 아닌 plist 구조로 검증한다.
- [x] `/usr/bin/open -g Tiny Farm.app` LaunchAgent를 즉시 bootstrap해 중복 프로세스 없이 현재 세션 등록을 검증한다.
- [x] disable 시 실제 `bootout` 실패를 숨기지 않는다.
- [x] enable·disable 중간 실패 시 이전 plist와 loaded 상태를 복구한다.

### macOS 릴리스 실기

> 이 절의 LaunchAgent 기준은 macOS 12 이하 대체 경로에만 적용된다. 현재 머신(15.7.7)은
> 3-B 의 SMAppService 경로로 동작하며 plist 를 만들지 않는다.

- [x] 활성화 후 LaunchAgent plist 생성·label·경로·`launchctl` 로드를 실기 확인했다(전환 이전 방식).
- [x] 비활성화 후 unload·삭제되고 실제 상태가 false다.
- [x] 재활성화해 최종 산출물의 로그인 실행을 켠 상태로 확인했다.
- [x] 재로그인 시 자동 실행을 확인했다. (사용자 확인)

## 4. 구매 장식의 시각적 변화

### 구현

- [x] `farm.decor`가 수치·가격만 바꾸던 결함을 수정했다.
- [x] 장식 1~8개의 고정 해금 순서와 메인 배치를 정의했다.
- [x] 수량 `N`이면 앞에서부터 정확히 `N`개만 표시한다.
- [x] 각 구매가 눈에 띄고 밭·버튼·동물 이동 구역을 가리지 않는다.
- [x] 흔들리는 장식은 기존 결정론적 애니메이션을 사용한다.
- [x] 미니도 보유 장식 수량을 축약해 반영한다.
- [x] 기존 저장의 `decor: 2`가 재실행 직후 두 장식으로 보인다.
- [x] 8개에서 최대 상태가 되고 추가 구매가 차단된다.

### 자동·시각 검증

- [x] 장식 0·1·2·8 시나리오를 고정했다.
- [x] 메인 0→1 표지판, 1→2 건초 더미, 8개 최대 상태를 시각 확인했다.
- [x] 메인 장식 0과 2의 스크린샷이 실제로 다르다.
- [x] 미니 장식 0과 2의 스크린샷이 실제로 다르다.
- [x] 렌더 깨짐·비정상 겹침·기존 날씨/농장 회귀가 없다.

## 5. 농장 초기화 안전장치

확인된 결함과 수정: `window.confirm` 은 이 웹뷰에서 표시되지 않아 사용자에게는 버튼이 먹지 않는 것처럼 보였다. 확인창을 캔버스 안에서 직접 그리도록 바꿨고, 로그인 실행 토글에서 실제로 `confirm accepted` 로그와 함께 동작을 확인했다.

- [x] 초기화 진입점은 트레이 메뉴로 제한한다.
- [x] 실제 백업·초기화 직전에 명확한 확인창을 표시한다. (`window.confirm` 제거, 캔버스 확인창)
- [x] 확인창이 열려 있으면 다른 클릭이 모두 차단된다.
- [x] 확인창 취소 분기는 상태와 저장 함수를 호출하지 않는다.
- [x] 이미 시작된 저장까지 기다리고 reset 중 새 저장을 차단한다.
- [x] reset 실패 시 취소·차단된 최신 메모리 상태를 다시 저장 예약한다.
- [x] 확인하면 기존 상태를 timestamp 백업으로 옮긴 뒤 새 농장을 저장한다.
- [x] 초기화 전에 대기 중인 이전 상태 저장 timer를 취소한다.
- [x] 백업 실패 시 초기화를 중단하고 기존 농장을 유지한다.
- [x] fresh 상태 저장 실패 시 백업을 활성 상태로 복구한다.
- [x] 실패 시 사용자에게 기존 농장이 유지됐다는 안내를 표시한다.
- [x] 릴리스 앱에서 취소와 확인 경로를 각각 실기 확인했다. (2026-07-30 22:01)
  - 증거: `state.reset-2026-07-30T13-02-47-566Z.bak` 생성, 현재 `state.json` 은 새 농장(밭 4칸·동전 0·수확 0·장식 0)

## 6. 전체 릴리스 완료 조건

- [x] `npm run typecheck` 통과.
- [x] `npm run build` 통과.
- [x] `cargo check` 통과.
- [x] `npm run verify` 전체 통과: `verify_exit=0`, 18개 시나리오 `SHOOT OK`, 권한 3버튼 추가 후 회귀 없음.
- [x] macOS 릴리스 `.app` 빌드 성공: 16:05:37, 16:53:01, 19:39:33 모두 exit 0.
- [x] 번들 Info.plist, 아이콘, 불투명 창 검증 통과.
- [x] 최종 릴리스 재빌드·설치·서명 완료. `/Applications/Tiny Farm.app`, Apple Development 서명.
- [x] 위치·실제 날씨·장식을 릴리스 앱에서 실기 확인.
- [x] 메인↔미니와 로그인 실행을 최종 릴리스 앱에서 실기 확인.
- [x] 초기화 취소·확인·백업을 새 릴리스 앱에서 실기 확인.
- [x] 중복 Tiny Farm 프로세스를 정리하고 검증한 최신 앱 하나만 유지(프로세스 1개).
- [x] `http://127.0.0.1:5174`가 HTTP 200이고 기존 서버 프로세스가 유지됨.
- [x] 임시 진단 파일 정리. `tmp/` 에는 검증 산출물과 사용자 백업, 설치 스크립트만 남김.
- [x] 아래 증거 표를 채움.

## 6-A. 머리말 배치와 중복 실행 (2026-07-30 후반 추가)

- [x] 날씨 아이콘이 창 테두리를 침범하던 문제를 고쳤다. `SCENE_Y` 28 → 38.
- [x] 아이콘을 2배로 그린다. `drawWeatherIcon` 에 정수 배율 인자 추가, 캔버스 변환으로 확대.
- [x] 날씨 글자 크기를 11로 키우고 아이콘과 한 줄에 둔다.
- [x] 진행 띠를 전경 폭(8~280)으로 옮겨 머리말과 전경을 나누는 줄로 쓴다.
- [x] 하단 카드 높이 27 → 25, 위 여백 6 → 4 로 늘어난 머리말 10px 을 상쇄. 창 크기 288×288 유지.
- [x] 밤 `맑음` 아이콘을 두께 3px 초승달로 다시 그려 2배에서도 달로 읽히게 했다.
- [x] 중복 실행 차단: `tauri-plugin-single-instance` 를 첫 플러그인으로 등록, 두 번째 실행은 종료하고 기존 본창을 표시.
- [x] 실기: `open -n` 3회에도 프로세스 1개 유지(PID 64722), `state.json` 한 벌만 갱신.
- [x] 자동 검증: `verify_exit=0`, 18개 시나리오 통과.
- [x] 릴리스 반영: 재빌드·설치·서명 후 실행 화면에서 배치 확인, 위치 권한·로그인 항목 유지.

## 7. 배포 전 남은 과제

- [ ] 개발용 자체 점검 통로(`TINY_FARM_SELFTEST`)와 `autostart.log` 유지 여부 결정. → 배포 직전에 처리하기로 합의(2026-07-30).
- [x] 서명 전략 확정. 개발·로컬 사용은 Apple Development 인증서로 서명한다(현재 상태). 배포본만 Developer ID 서명과 공증을 쓴다. ad-hoc 은 위치 권한이 빌드마다 초기화되므로 쓰지 않는다.
- [x] 공증 단계를 설치 스크립트에 옵션으로 넣었다. `TINY_FARM_NOTARY_PROFILE` 이 있고 Developer ID 서명일 때만 `ditto` → `notarytool submit --wait` → `stapler staple` → `spctl --assess` 를 수행한다.
- [x] Developer ID Application 인증서 발급 완료. 해시는 저장소에 적지 않는다. 조회: `security find-identity -v -p codesigning`.
- [x] `notarytool` 자격 프로파일 `tinyfarm` 등록 완료. 자격 증명은 사용자가 직접 저장했다.
- [x] **공증 완료** (2026-07-31 01:14). 제출 id `8ce3231e-ed1a-419b-82ba-b92156b521f3`, `status: Accepted`.
  - 서명: `Developer ID Application: TAEK KWON KIM (M382EW7FD8)` → Developer ID CA → Apple Root CA, `TeamIdentifier=M382EW7FD8`, `flags=0x10000(runtime)`
  - 티켓 부착: `stapler validate` → `The validate action worked!`
  - Gatekeeper: `spctl --assess` → `accepted, source=Notarized Developer ID`
  - 요구사항: `identifier "app.tinyfarm.widget" and anchor apple generic and ... certificate leaf[subject.OU] = M382EW7FD8` (팀 기준이라 재빌드에도 유지)
- [x] 설치·서명 절차를 저장소 도구로 옮겼다. `tools/install_macos.sh`, `npm run install:macos`.
  - 빌드 단계에서 `APPLE_SIGNING_IDENTITY` 로 서명하므로 후처리 재서명이 없다.
  - 인증서를 SHA-1 해시로 지정한다. 이름이 같은 인증서가 둘이라 `codesign` 이 `ambiguous` 로 실패했다.
  - 요구사항이 cdhash 로 굳으면 경고를 낸다.
  - 실기: `npm run install:macos` → `build_exit=0`, `codesign_verify_exit=0`, 요구사항 `identifier + certificate`, `exit=0`
- [x] `design.md` 에 서명·설치, 로그인 실행, 중복 실행, 확인창 설계 근거를 기록했다.
- [x] Developer ID 서명과 공증을 실기로 완료했다. 재현 명령:
  - `APPLE_SIGNING_IDENTITY=<Developer ID 인증서 SHA-1> TINY_FARM_NOTARY_PROFILE=<프로파일> npm run install:macos`
  - 인증서는 이름이 아니라 해시로 지정한다. Apple Development 두 개가 동명이라 이름 지정은 `ambiguous` 로 실패한다.
- [ ] 서명 주체 변경으로 위치 권한이 한 번 초기화된다. 새 앱에서 위치 프롬프트 허용 후 실제 날씨 수신 재확인.

## 검증 증거

| 영역 | 증거 | 상태 |
|---|---|---|
| WKWebView 위치 실패 | 2026-07-30 실기: TCC Location 요청 없음, LocalStorage 없음 | 확인 |
| CoreLocation 코드 | Objective-C ARC·main queue·delegate 보유·exactly-once 독립 감사 | 통과 |
| 위치 프롬프트 실기 | `locationd`: `Showing #AuthPrompt` → `CoreLocationAgent`; 대화상자 문구 확인 | 통과 |
| 실제 Open-Meteo | LocalStorage `tiny-farm-weather`: 26.3℃, `2026-07-30T19:30`, code 0, 좌표 없음 | 통과 |
| 위치 권한 UI | 설정 패널 `위치 권한: 허용`, 버튼 3개 렌더 정상 | 통과 |
| 메인 날씨 표시 | 헤더 `맑음 26° · 0.0mm` | 통과 |
| 메인↔미니 실기 | 최종 빌드에서 재확인 필요 | 대기 |
| 로그인 실행 권한 성격 | macOS 15.7.7: TCC 아님. `print-disabled`의 `"label" => disabled\|enabled` 확인 | 확인 |
| LaunchAgent 생성·실행·삭제 | 코드·롤백 감사 통과, 실기 대기 | 진행 |
| 장식 0·1·2·8 | `tmp/shots/13...18`; 육안 비교 전 항목 PASS | 통과 |
| 초기화 안전성 | 저장 직렬화·백업 복구까지 재감사 PASS, 실기 대기 | 진행 |
| 최종 자동 검증 | `tmp/verify.log`: `verify_exit=0`, 18개 `OK`, `SHOOT OK`, `=== END ===` | 통과 |
| 릴리스 빌드 | exit 0, 19:39:33 산출물; plist/icon/OPAQUE OK. 로그인 항목 변경 반영 재빌드 필요 | 진행 |
| `127.0.0.1:5174` | `devserver_http=200`, 기존 dev server 유지 | 통과 |
