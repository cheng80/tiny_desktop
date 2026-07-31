# Tiny Farm

느긋하게 지켜보는 macOS 픽셀 농장 데스크테리어 위젯.

작물이 자라고 동물이 돌아다니는 작은 농장을 화면 한쪽에 띄워 둔다. 지금 있는 곳의 실제
날씨가 농장에 반영되고, 비가 오면 화면에도 비가 내린다. 조작할 것은 거의 없다. 밭을 눌러
수확하거나 그냥 두면 알아서 수확된다.

## 무엇이 들어 있나

- 본창과 미니 위젯. 본창을 접으면 작은 위젯으로 바뀌고, 트레이에 상주한다.
- Open-Meteo 실시간 날씨. 아이콘, 온도, 강수량을 표시하고 비·눈·뇌우는 장면에도 나타난다.
- 방치형 농장. 앱이 꺼져 있던 시간도 정산한다. 다만 한 번에 최대 8시간까지만 흐른다.
- 밭, 창고, 동물, 장식 확장. 장식은 8개까지 늘고 전경에 하나씩 나타난다.
- 낮과 밤. 실제 시각에 따라 화면 색이 바뀐다.

## 설치

macOS 전용이다. Rust와 Node.js가 필요하다.

```bash
npm install
npm run install:macos
```

`install:macos`가 빌드, 서명, `/Applications` 설치, LaunchServices 등록, 서명 검증,
실행까지 한 번에 한다.

기본은 universal 빌드다. Apple Silicon과 인텔 맥 모두에서 실행된다. 두 아키텍처를 모두
컴파일하므로 시간이 두 배쯤 걸리고, 끝나면 `lipo`로 실제로 둘 다 들어갔는지 확인한다.
빌드 결과가 한쪽만 담고 있으면 인텔 맥에서 실행되지 않고 그 사실을 배포 후에야 알게 된다.

x86_64 타깃이 없으면 먼저 추가한다.

```bash
rustup target add x86_64-apple-darwin
```

개발 중 빠르게 돌려볼 때는 현재 아키텍처만 빌드한다.

```bash
TINY_FARM_TARGET=native npm run install:macos
```

### 서명이 왜 필요한가

서명 없이 빌드하면 macOS가 매 빌드마다 이 앱을 다른 앱으로 취급해 위치 권한이 초기화된다.
ad-hoc 서명은 앱을 식별하는 조건이 바이너리 해시 하나로 굳기 때문이다. 인증서로 서명하면
식별 조건이 팀과 번들 ID 기준이 되어 재빌드해도 권한이 유지된다.

인증서는 아래 순서로 고른다.

1. `APPLE_SIGNING_IDENTITY` 환경 변수
2. 키체인의 첫 `Apple Development` 인증서
3. 둘 다 없으면 ad-hoc으로 진행하고 경고를 남긴다

인증서는 이름이 아니라 SHA-1 해시로 지정한다. 이름이 같은 인증서가 여러 개면 `codesign`이
`ambiguous`로 실패한다. 해시는 이렇게 찾는다.

```bash
security find-identity -v -p codesigning
```

### 배포용 빌드

Developer ID로 서명하고 공증까지 하려면 자격 증명을 먼저 키체인에 저장한다.

```bash
xcrun notarytool store-credentials <프로파일> \
  --apple-id <애플 계정> --team-id <팀 ID> --password <앱 암호>
```

그다음 한 줄로 서명, 설치, 공증까지 진행한다.

```bash
APPLE_SIGNING_IDENTITY=<Developer ID 인증서 SHA-1> \
TINY_FARM_NOTARY_PROFILE=<프로파일> npm run install:macos
```

공증은 조건이 맞을 때만 실행된다. 프로파일이 없거나 Developer ID 서명이 아니면 이유를
남기고 건너뛴다.

인증서 발급부터 공증까지의 준비 과정, 무엇이 바뀌면 macOS가 다른 앱으로 취급하는지,
인증서 만료 시 대응은 [docs/macos-signing.md](docs/macos-signing.md)에 정리했다.

## 폰트

픽셀 글꼴 PF스타더스트 3.0을 쓴다. 파일 재배포가 금지된 폰트라 저장소에 포함하지 않는다.
[출처](https://m.blog.naver.com/campanula913/221366697603)에서 받아 아래 경로에 둔다.

```
public/fonts/pf-stardust.ttf
```

없어도 앱은 실행된다. 이때는 시스템 글꼴로 그려지고 픽셀 느낌만 사라진다. 자세한 내용은
[assets/README.md](assets/README.md)에 있다.

## 개발

```bash
npm run dev        # 브라우저에서 개발 서버
npm run tauri dev  # 네이티브 앱으로 개발
npm run verify     # 타입, 빌드, cargo, 정적 서버, 18개 시나리오 스크린샷
```

`verify`는 결과를 `tmp/verify.log`에, 스크린샷을 `tmp/shots/`에 남긴다. 표준출력이 아니라
파일에 남기는 이유는 환경에 따라 셸 출력이 유실되는 경우가 있어서다.

## 권한

### 위치

현재 위치의 날씨를 받기 위해 필요하다. 좌표는 Open-Meteo 요청에만 쓰고 저장하지 않는다.
날씨를 끄면 위치를 요청하지 않는다.

WKWebView의 `navigator.geolocation`은 이 앱에서 macOS 위치 프롬프트까지 도달하지 않는다.
그래서 CoreLocation을 직접 호출하는 네이티브 경로를 쓴다.

권한이 없으면 지난 날씨를 보여주지 않고 `위치 권한 필요`만 표시한다. 지난 값과 아이콘을
함께 띄우면 지금 날씨로 오해하기 때문이다. 나중에 허용하면 즉시 다시 받는다.

### 로그인 시 실행

허용 창이 뜨지 않는다. macOS 13 이상은 정식 API로 앱을 등록하므로 시스템 설정 > 일반 >
로그인 항목 목록에 `Tiny Farm`으로 나타나고, 거기서 끌 수 있다.

## 저장 위치

```
~/Library/Application Support/app.tinyfarm.widget/
  state.json      농장 상태
  settings.json   설정
```

트레이 메뉴의 `농장 초기화 (백업 후)`는 확인창을 거치고, 기존 농장을 timestamp 백업으로
옮기는 데 성공한 뒤에만 새 농장을 만든다. 백업이 실패하면 초기화를 중단한다.

## 트레이 메뉴

`농장 열기`, `미니 위젯 보이기`, `모두 숨기기`, `농장 초기화 (백업 후)`, `종료`.

본창에는 macOS 창 버튼이 없다. 창을 감추는 것은 헤더의 접기 버튼과 이 메뉴로 한다.

## 도움말

헤더 오른쪽 물음표 버튼을 누르면 일곱 장짜리 안내가 캔버스 위에 열린다. 앱이 무엇인지,
수확과 판매, 확장, 날씨와 권한, 창 다루기, 오래 비웠을 때의 정산을 차례로 설명한다.

읽는 동안 뒤쪽 클릭은 막는다. 설명을 보다가 밭이 눌리면 의도치 않은 수확이 일어난다.

## 농장 규칙

숫자는 모두 [src/core/config.ts](src/core/config.ts)에 모여 있다.

| 항목 | 값 |
|---|---|
| 성장 단계 시간 | 20분 |
| 자동 수확 유예 | 10분 |
| 오프라인 정산 상한 | 8시간 |
| 밭 | 4칸 시작, 16칸까지 |
| 창고 | 20 시작, 120까지 |
| 동물 | 3마리 시작, 8마리까지, 1시간마다 사료 |
| 장식 | 8개까지 |

직접 수확과 자동 수확의 보상은 같다. 직접 하는 쪽에 보너스를 주면 앱 앞에 붙어 있어야
이득이 되고, 그건 느긋함의 반대다.

## 구조

```
src/            프런트엔드. 캔버스 렌더와 농장 규칙
  assets/       타일 좌표 상수
  core/         농장 규칙, 저장, 설정, 날씨
  render/       캔버스 렌더러
src-tauri/      Rust. 창 관리, 트레이, 파일 저장
  src/location.m    CoreLocation 브리지
  src/loginitem.m   SMAppService 로그인 항목 등록
tools/          검증, 설치, 아이콘 생성 스크립트
public/tiles/   앱이 읽는 타일 시트
docs/           서명과 공증 준비 문서
.kiro/specs/    설계 문서와 구현 체크리스트
```

창은 투명하지 않다. 투명 창은 macOS private API가 필요해 App Store 심사를 통과할 수 없다.
대신 창 전체를 불투명하게 그리고, `tools/check_opacity.mjs`가 투명 픽셀이 0개인지 검사한다.

## 자원

타일은 [Kenney](https://kenney.nl)의 Tiny Farm, Tiny Town, UI Pack Pixel Adventure를 쓴다.
라이선스는 CC0다. 앱이 읽는 시트는 `public/tiles/`에 포함되어 있고, 원본 팩은 저장소에
두지 않는다. 받는 방법은 [assets/README.md](assets/README.md)에 있다.

## 설계 기록

주요 결정과 그 이유는 [.kiro/specs/focus-farm/design.md](.kiro/specs/focus-farm/design.md)에
정리했다. 왜 CoreLocation을 직접 부르는지, 왜 `window.confirm`을 쓰지 않는지, 왜 로그인
항목을 정식 API로 옮겼는지 같은 내용이다.
