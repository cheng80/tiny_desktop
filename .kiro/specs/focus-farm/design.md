# Focus Farm 설계 기록

## 에셋 원칙

- 농장·마을 그래픽은 기존 Kenney 에셋을 우선 사용한다.
- 작은 UI 및 날씨 아이콘은 런타임 팔레트와 픽셀 그리드에 맞춰 코드로 직접 그린다.
- AI 이미지 생성은 앱/트레이 아이콘처럼 별도 원본이 필요한 경우나 시안 제작에만 사용한다.
- 현재 확정 앱 아이콘 원본의 단일 기준은 `assets/app-icon.png`다.

## API 키 없는 이미지 생성 경로

이미지 생성은 `OPENAI_API_KEY`를 사용하지 않는다. 로컬 Codex 로그인 OAuth와 `codex exec`의 `image_gen` 도구를 사용한다.

구현 기준 파일:

```text
~/.codex/skills/sprite-gen/sprite_gen/gen/codex_provider.py
```

실행 계약:

```text
codex exec \
  --json \
  --sandbox workspace-write \
  --skip-git-repo-check \
  --color never \
  --add-dir ~/.codex/generated_images \
  -C <빈 작업 디렉터리> \
  -
```

중요 조건:

1. `--sandbox workspace-write`가 없으면 `image_gen` 도구가 등록되지 않을 수 있다.
2. `--add-dir ~/.codex/generated_images`가 없으면 이미지 생성 쓰기 경로가 허용되지 않는다.
3. 작업 디렉터리는 Git 저장소일 필요가 없으므로 `--skip-git-repo-check`를 사용한다.
4. 세션 기록에서 결과를 추출해야 하므로 `--ephemeral`을 사용하지 않는다.
5. 입력 프롬프트는 `image_gen`을 정확히 한 번만 호출하고 파일 저장이나 별도 셸 작업을 하지 않도록 제한한다.

## PNG 추출 절차

1. `codex exec --json` 표준 출력에서 `thread.started.thread_id`를 읽는다. 구버전 출력이면 `session id: <uuid>`를 사용한다.
2. 아래 경로에서 해당 ID를 포함하는 최신 rollout을 찾는다.

```text
~/.codex/sessions/**/rollout-*<thread_id>*.jsonl
```

3. JSONL 레코드의 payload type이 다음 중 하나인지 확인한다.

```text
image_generation_call
image_generation_end
```

4. 완료 상태의 `payload.result`를 인라인 base64 PNG로 간주해 디코딩한다.
5. PNG 시그니처와 이미지 유효성을 검증한다. 모델이 출력한 저장 경로는 신뢰하지 않는다.
6. 감사나 디버깅 목적이 없으면 추출 후 해당 rollout을 삭제한다.

가능하면 수동 파싱을 다시 구현하지 않고 `sprite-gen`의 Codex provider 또는 `scripts/generate_sprite_image.py --provider codex`를 사용한다.

## 앱 아이콘 후처리

- 생성 이미지의 둥근 배지 바깥쪽 약 17.5% 영역에서 배경을 flood-fill해 투명화한다.
- 후처리된 확정 원본은 `assets/app-icon.png`에 보존한다.
- Tauri용 전체 크기 아이콘은 저장소의 `npm run icons`로 다시 생성한다.
- 생성 결과는 `src-tauri/icons/`의 PNG, ICNS, ICO 및 플랫폼별 크기로 출력한다.

## 날씨 아이콘

Open-Meteo는 WMO `weather_code`를 제공하고 아이콘 파일은 제공하지 않는다. 날씨 아이콘은 생성 이미지에 의존하지 않고 8×8~12×12 논리 픽셀 도형으로 직접 그린다.

최소 상태 묶음:

- 맑음: 낮에는 해, 밤에는 달
- 구름 조금: 해/달과 구름
- 흐림: 구름
- 안개: 수평 안개선
- 비: 구름과 파란 빗방울
- 눈: 구름과 흰 눈송이
- 뇌우: 구름과 노란 번개

비·눈의 장면 효과는 아이콘과 별개로 결정론적 픽셀 파티클을 사용한다.

헤더 배치는 논리 좌표 기준으로 머리말 높이를 38로 둔다. 아이콘은 12×12 그림을 정수 배율 2로 확대해 24×24로 그린다. 캔버스 변환으로 확대하므로 픽셀이 흐려지지 않는다. 확대 전에는 아이콘이 창 테두리를 넘어갔다. 미니 위젯은 폭이 좁아 1배를 쓴다.

## macOS 서명과 설치

설치는 `npm run install:macos`(`tools/install_macos.sh`) 하나로 한다. 빌드, `/Applications` 설치, LaunchServices 등록, 서명 검증, 실행까지 한 번에 수행한다.

설치 전에 앱을 종료한다. 실행 중인 번들을 덮어쓰면 서명 검증이 깨진다. 그래서 마지막에 다시 실행하고 프로세스 수까지 확인한다. 실행을 원하지 않으면 `TINY_FARM_NO_LAUNCH=1`을 준다.

서명 주체를 고정하는 이유는 위치 권한이다. Tauri가 그대로 만든 산출물은 ad-hoc(linker-signed)이고, 이 경우 Designated Requirement가 `cdhash H"..."` 하나로 굳는다. locationd는 그 조건으로 권한을 저장하므로 코드가 한 줄만 바뀌어도 다른 앱으로 취급되어 매 빌드마다 위치 권한이 초기화된다. 인증서로 서명하면 요구사항이 `identifier "app.tinyfarm.widget" and anchor apple generic and certificate leaf[...]`가 되어 재빌드에도 권한이 유지된다.

인증서는 저장소에 넣지 않는다. 개인 인증서 이름을 설정 파일에 박으면 다른 사람이 빌드할 때 실패한다. 대신 다음 순서로 결정한다.

1. `APPLE_SIGNING_IDENTITY` 환경 변수
2. 키체인의 첫 `Apple Development` 인증서
3. 둘 다 없으면 ad-hoc으로 진행하고, 권한이 초기화된다는 경고를 남긴다

인증서는 이름이 아니라 SHA-1 해시로 지정한다. 이름이 같은 인증서가 여러 개면 `codesign`이 `ambiguous`로 실패한다.

`/Applications`에 설치하는 이유도 권한 때문이다. 빌드 폴더에서 실행하면 locationd 로그에 `LaunchServices does not have an application record`가 남고 클라이언트가 앱으로 해석되지 않아 권한이 안정적으로 귀속되지 않는다.

배포본은 Developer ID로 서명한 뒤 공증이 필요하다. 공증은 설치 스크립트의 선택 단계로 들어가 있다. `TINY_FARM_NOTARY_PROFILE`이 있고 서명 주체가 Developer ID일 때만 실행되고, 그 밖에는 이유를 남기고 건너뛴다.

준비는 두 단계다. Apple Developer Program에 가입해 Developer ID Application 인증서를 발급하고, 자격 증명을 키체인 프로파일로 저장한다.

```
xcrun notarytool store-credentials <프로파일> --apple-id <계정> --team-id <팀> --password <앱 암호>
```

그다음 한 줄로 서명·설치·공증까지 수행한다.

```
APPLE_SIGNING_IDENTITY="Developer ID Application: ..." \
TINY_FARM_NOTARY_PROFILE=<프로파일> npm run install:macos
```

내부 순서는 `ditto -c -k --keepParent`로 번들 구조를 유지한 zip을 만들고, `notarytool submit --wait`, `stapler staple`, `spctl --assess --type execute`로 Gatekeeper 판정까지 확인한다. `notarytool`은 디렉터리를 받지 않으므로 zip 단계가 필요하다.

2026-07-31에 이 경로로 공증을 완료했다. 결과는 `status: Accepted`, `spctl` 판정 `accepted, source=Notarized Developer ID`였다. 인증서는 이름이 아니라 SHA-1 해시로 지정해야 한다. 동명 인증서가 여러 개면 `codesign`이 `ambiguous`로 실패한다.

서명 주체를 개발용에서 배포용으로 바꾸면 macOS가 다른 앱으로 보므로 위치 권한이 한 번 초기화된다. 이후에는 요구사항이 팀 기준(`certificate leaf[subject.OU] = <팀>`)이라 재빌드해도 유지된다.

## 로그인 시 실행

macOS 13 이상은 `SMAppService.mainAppService`로 앱 자신을 등록한다. 그래야 시스템 설정 > 일반 > 로그인 항목 목록에 `Tiny Farm.app`으로 나타나고 사용자가 그 화면에서 끌 수 있다.

직접 만든 LaunchAgent는 대체 경로로만 남긴다. 실행 프로그램이 `/usr/bin/open`이면 macOS 백그라운드 항목 관리가 그 항목을 Apple 시스템 바이너리로 귀속시켜, 실행 등록은 되지만 목록에 앱이 나타나지 않는다. 정식 API로 전환할 때 과거에 만들어 둔 plist는 지운다.

상태 판정은 정식 API 기준이다. 사용자가 시스템 설정에서 끄면 `requiresApproval`이 되는데, 이때는 꺼진 상태로 보고하고 승인이 필요하다고 안내한다.

## 중복 실행

`tauri-plugin-single-instance`를 첫 플러그인으로 등록한다. 두 벌이 돌면 농장 시계가 두 번 흐르고 같은 `state.json`을 서로 덮어써 진행이 유실된다. 두 번째 실행은 즉시 종료되고, 이미 떠 있는 쪽의 본창을 앞으로 가져온다.

## 확인창

`window.confirm`을 쓰지 않는다. 이 웹뷰에서 대화상자가 뜨지 않아 사용자에게는 버튼이 먹지 않는 것처럼 보였고, 코드는 취소로 판단했다. 확인창은 캔버스 안에 직접 그리고, 열려 있는 동안 다른 클릭을 모두 차단한다. 로그인 시 실행과 농장 초기화가 이 경로를 쓴다.

## 도움말

헤더의 물음표 버튼이 일곱 장짜리 안내를 캔버스 위에 띄운다. 확인창과 같은 층에 그리고, 열려 있는 동안 뒤쪽 클릭을 모두 삼킨다. 설명을 읽다가 밭이 눌려 수확이 일어나는 것을 막는다.

여러 장으로 쪼갠 이유는 본창이 288x288 이라 한 화면에 들어가는 줄이 열 줄 남짓이기 때문이다. 스크롤은 픽셀 UI에서 만들기도, 쓰기도 번거롭다. 좌우 버튼으로 넘기고 `n / 7`로 끝이 보이게 했다. 첫 장의 왼쪽 버튼은 `이전`이 갈 곳이 없으므로 `닫기`가 되고, 마지막 장의 오른쪽 버튼은 `시작`이 된다.

글은 기능 목록이 아니라 옆에서 알려주는 말투로 썼다. 이 앱은 할 일이 정해져 있지 않은 것이 특징이라, 조작법만 나열하면 그 특징이 전달되지 않는다. 그래서 "직접 거둬도 더 주지 않는다", "한 번에 최대 여덟 시간까지만 흐른다" 처럼 설계 의도까지 사람 말로 적었다. 안내문에 백틱 같은 코드 표기는 쓰지 않는다. 캔버스에서는 그대로 글자로 찍혀 보인다.

물음표 기호는 픽셀을 직접 찍어 그린다. 9px 글꼴의 `?`는 16px 원형 버튼 안에서 뭉개졌다. 5x7 자리를 버튼 안쪽 4행부터 시작해 위쪽 테두리에 머리가 붙지 않게 했다.

## 미니 전환 설정

본창을 감추는 모든 경로가 `miniEnabled` 하나만 본다. 켜져 있으면 미니로 넘기고, 꺼져 있으면 트레이로만 숨긴다.

이전에는 닫기 전용 설정(`miniOnClose`)이 따로 있었지만 두 가지 이유로 없앴다. 본창은 `decorations: false`라 macOS 창 버튼이 없어서 닫기 경로가 사실상 쓰이지 않았고, 사용자가 실제로 쓰는 헤더의 접기 버튼은 그 설정을 무시했다. 그래서 설정을 껐는데도 접으면 미니가 떠서 동작이 어긋나 보였다.

폐기된 키는 병합 목록에서 빼기만 했다. 설정 병합이 항목별로 기본값을 채우므로 이전 저장본에 값이 남아 있어도 그대로 무시된다.
