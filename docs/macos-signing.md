# macOS 서명·공증 준비

이 문서는 세 가지를 한 번에 만족시키는 준비 과정을 정리한다.

1. 재빌드해도 macOS가 같은 앱으로 인식한다. 위치 권한과 로그인 항목 설정이 유지된다.
2. Developer ID Application 인증서로 서명한다.
3. Apple 공증을 통과해 다른 맥에서 경고 없이 열린다.

준비는 한 번만 한다. 그다음부터는 명령 한 줄로 끝난다.

## 왜 "매번 같은 앱"이 문제인가

macOS는 앱을 경로나 이름으로 식별하지 않는다. 서명에 박힌 **Designated Requirement**(이하 DR)로
식별한다. 위치 권한을 관리하는 `locationd`와 TCC 데이터베이스도 이 DR을 키로 권한을 저장한다.

서명 없이 빌드하면 Tauri 산출물은 ad-hoc(linker-signed)이 되고, DR이 바이너리 해시 하나로 굳는다.

```
designated => cdhash H"a1b2c3..."
```

코드가 한 줄만 바뀌어도 해시가 달라지므로 macOS는 완전히 다른 앱으로 본다. 그래서 재빌드마다
위치 권한이 초기화된다. 이 프로젝트에서 실제로 겪은 문제다.

인증서로 서명하면 DR이 번들 ID와 팀 기준으로 바뀐다.

```
designated => identifier "app.tinyfarm.widget" and anchor apple generic
  and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */
  and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */
  and certificate leaf[subject.OU] = <팀ID>
```

해시가 사라지고 번들 ID와 팀 ID만 남는다. 코드가 바뀌어도 이 조건은 그대로이므로 권한이 유지된다.

여기에 조건이 하나 더 붙는다. 앱이 `/Applications`에 있고 LaunchServices에 등록되어 있어야 한다.
빌드 폴더에서 그냥 실행하면 `locationd` 로그에 `LaunchServices does not have an application record`가
남고, 위치 요청 주체가 앱으로 해석되지 않는다. 설치 스크립트가 `lsregister`를 부르는 이유다.

## 한 번만 하는 준비

### 1. Apple Developer Program 가입

Developer ID 인증서는 유료 프로그램(연 $99) 회원만 발급받을 수 있다. 무료 계정으로는
Apple Development 인증서까지만 만들 수 있고, 그것으로는 공증이 불가능하다.

Apple Development 인증서만 있어도 "매번 같은 앱" 목표는 달성된다. 내 맥에서만 쓸 거라면
1번 목표까지만 하고 멈춰도 된다. 다른 사람에게 줄 때 공증이 필요하다.

### 2. Developer ID Application 인증서 발급

Xcode에서 만드는 쪽이 간단하다. CSR 파일을 직접 다룰 필요가 없다.

```
Xcode > Settings > Accounts > (계정 선택) > Manage Certificates > + > Developer ID Application
```

조직 계정이면 Account Holder 권한이 있는 사람만 이 인증서를 만들 수 있다. 개인 계정은 본인이
Account Holder다.

만들면 비밀키가 이 맥의 로그인 키체인에 들어간다. **이 비밀키가 곧 신원이다.** 다른 맥에서도
서명하려면 키체인 접근 앱에서 `.p12`로 내보내 옮긴다. 잃어버리면 재발급밖에 없다.

### 3. 인증서 해시 확인

```bash
security find-identity -v -p codesigning
```

```
1) 7477FC...AF6D "Apple Development: NAME (XXXXXXXXXX)"
2) C90202...1369 "Apple Development: NAME (XXXXXXXXXX)"
3) A47FEF...1D2D "Developer ID Application: NAME (M382EW7FD8)"
```

앞의 40자리 SHA-1 해시를 쓴다. **이름이 아니라 해시로 지정한다.** 이름이 같은 인증서가 둘 이상이면
`codesign`이 `ambiguous`로 실패한다. 위 목록에서 1번과 2번이 이름이 같은데, 이 프로젝트가 실제로
그 오류를 겪었고 그래서 해시 방식으로 바꿨다.

### 4. 앱 전용 암호 만들기

공증에는 Apple 계정 암호를 쓰지 않는다. 앱 전용 암호를 따로 만든다.

```
appleid.apple.com > 로그인 및 보안 > 앱 암호 > 새 암호 생성
```

`xxxx-xxxx-xxxx-xxxx` 형태의 문자열이 나온다. 이 창을 닫으면 다시 볼 수 없다. 다음 단계에서
바로 쓴다.

### 5. notarytool 자격 증명을 키체인에 저장

```bash
xcrun notarytool store-credentials <프로파일이름> \
  --apple-id <애플 계정 이메일> \
  --team-id <팀 ID> \
  --password <앱 전용 암호>
```

`<프로파일이름>`은 아무 이름이나 된다. 이 저장소는 `tinyfarm`을 쓴다. 팀 ID는 3번 목록의
`Developer ID Application: NAME (M382EW7FD8)`에서 괄호 안 값이다.

성공하면 이렇게 답한다.

```
Success. Credentials validated.
Credentials saved to Keychain.
```

이제 앱 암호는 키체인에만 있다. 명령줄이나 파일에 다시 적지 않는다. 셸 히스토리에 남은 것이
찜찜하면 `~/.zsh_history`에서 지운다.

### 6. 빌드 도구

인텔 맥까지 커버하는 universal 빌드가 기본이다. x86_64 타깃이 없으면 추가한다.

```bash
rustup target add x86_64-apple-darwin
xcode-select --install   # Xcode Command Line Tools. 이미 있으면 그냥 넘어간다
```

### 7. Info.plist 사용 설명

위치를 요청하는 앱은 사용 이유를 Info.plist에 적어야 한다. 없으면 프롬프트가 뜨지 않고 요청이
조용히 거부된다. 이 저장소는 [src-tauri/Info.plist](../src-tauri/Info.plist)에 이미 넣어 두었다.

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>현재 위치의 날씨를 농장에 표시하기 위해 위치가 필요합니다.</string>
```

## 매번 하는 일

```bash
APPLE_SIGNING_IDENTITY=<Developer ID 인증서 SHA-1> \
TINY_FARM_NOTARY_PROFILE=tinyfarm \
npm run install:macos
```

[tools/install_macos.sh](../tools/install_macos.sh)가 순서대로 이렇게 한다.

1. 인증서 결정. 환경 변수가 없으면 키체인의 첫 `Apple Development`로 대체하고 경고를 남긴다.
2. 실행 중인 앱 종료. 실행 중 번들을 덮어쓰면 서명이 깨진다.
3. universal 빌드. Tauri가 빌드 단계에서 서명하므로 뒤에 재서명하지 않는다.
4. `/Applications` 설치와 `lsregister` 등록.
5. 서명 검증. DR이 `cdhash`로 굳었으면 경고한다.
6. `lipo`로 두 아키텍처가 실제로 들어갔는지 확인.
7. 공증. `ditto`로 zip을 만들어 `notarytool submit --wait` → `stapler staple` → `spctl` 검증.
8. 앱 실행과 프로세스 수 확인.

공증은 조건이 맞을 때만 돈다. 프로파일이 없거나 서명 주체가 Developer ID가 아니면 이유를 남기고
건너뛴다. Apple Development 인증서로는 공증할 수 없다.

`notarytool`이 디렉터리를 받지 않아 zip 단계가 필요하다. 일반 `zip` 대신 `ditto -c -k --keepParent`를
쓰는 이유는 심볼릭 링크와 번들 구조를 그대로 보존해야 하기 때문이다.

로그는 `tmp/install_macos.log`에 남는다.

## 성공했는지 확인하는 방법

로그 마지막에 이 네 줄이 있어야 한다.

```
OK: universal 바이너리다. 인텔 맥에서도 실행된다.
OK: 인증서 기반 요구사항이다. 재빌드해도 위치 권한이 유지된다.
  status: Accepted
source=Notarized Developer ID
```

직접 확인하려면 이렇게 한다.

| 확인할 것 | 명령 | 기대 결과 |
|---|---|---|
| 서명 주체 | `codesign -dvvv "/Applications/Tiny Farm.app"` | `Authority=Developer ID Application: ...` |
| 앱 식별 조건 | `codesign -d --requirements - "/Applications/Tiny Farm.app"` | `identifier ... certificate leaf[subject.OU]` |
| 아키텍처 | `lipo -archs "/Applications/Tiny Farm.app/Contents/MacOS/app"` | `x86_64 arm64` |
| 공증 통과 | `spctl --assess --type execute --verbose=2 "/Applications/Tiny Farm.app"` | `accepted`, `source=Notarized Developer ID` |
| 스테이플 | `xcrun stapler validate "/Applications/Tiny Farm.app"` | `The validate action worked!` |

`requirements` 출력에 `cdhash`가 보이면 실패다. 인증서 없이 빌드된 것이므로 재빌드마다 권한이
초기화된다.

`codesign -dvvv` 출력에서 두 줄을 더 볼 수 있다.

```
CodeDirectory v=20500 size=80511 flags=0x10000(runtime) ...
Timestamp=Jul 31, 2026 at 2:52:56 AM
```

`flags`의 `runtime`이 Hardened Runtime이다. Apple이 공증 조건으로 요구하며, Tauri가 서명할 때
붙여 준다. `Timestamp`는 Apple 타임스탬프 서버가 박아 준 시각이고, 이것이 있어서 인증서가
만료된 뒤에도 기존 서명이 유효하게 남는다.

## 무엇이 바뀌면 다른 앱이 되는가

| 바뀌는 것 | 권한 유지 | 이유 |
|---|---|---|
| 소스 코드 | 유지 | DR에 해시가 없다 |
| 버전 번호 | 유지 | DR과 무관 |
| Apple Development → Developer ID | 유지 | 팀 ID(OU)가 같으면 조건이 같다 |
| 인증서 만료 후 같은 팀으로 재발급 | 유지 | 위와 같다 |
| 번들 ID(`identifier`) | **초기화** | DR의 `identifier` 조건이 달라진다 |
| 팀 ID(다른 계정으로 서명) | **초기화** | DR의 `subject.OU`가 달라진다 |
| 인증서를 빼고 ad-hoc으로 되돌림 | **초기화** | DR이 `cdhash`로 굳는다 |
| 앱을 `/Applications` 밖으로 옮김 | 요청 실패 | LaunchServices 앱 레코드가 없다 |

정리하면 번들 ID와 팀 ID만 지키면 된다. 둘은 [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json)의
`identifier`와 서명 인증서가 결정한다.

## 인증서 만료와 갱신

만료일은 이렇게 확인한다.

```bash
security find-certificate -a -c "Developer ID Application: <이름> (<팀ID>)" -p \
  | openssl x509 -noout -subject -enddate
```

**만료와 취소는 다르다.** 서명할 때 Apple 타임스탬프가 박히므로 인증서가 만료돼도 이미 서명·공증한
앱은 계속 유효하다. 새로 서명만 못 한다. 반면 취소(Revoke)하면 그 인증서로 서명한 앱이 Gatekeeper에서
거부될 수 있다.

그래서 **Developer ID 인증서는 Revoke 하지 않는다.** 비밀키가 유출된 경우가 예외다. Xcode의
Manage Certificates 창에 회색으로 `Not in Keychain`이라 표시되는 항목은 만료가 아니라 이 맥에
비밀키가 없다는 뜻이고, 서명에 쓰이지 않으니 그냥 둬도 된다. 그 창에는 삭제 기능이 없다.
목록에서 없애려면 developer.apple.com에서 Revoke해야 하는데, 위 이유로 권하지 않는다.

갱신은 같은 팀으로 새 인증서를 만들면 된다. 팀 ID가 그대로이므로 DR이 같고 권한도 유지된다.
새 해시만 `APPLE_SIGNING_IDENTITY`에 넣어 준다.

## 비밀 정보 취급

저장소에 들어가면 안 되는 것들이다. `.gitignore`가 이미 막고 있다.

- 앱 전용 암호. 키체인 프로파일에만 둔다.
- 인증서 파일(`*.p12`, `*.cer`, `*.key`, `*.pem`)과 프로비저닝 프로파일.
- 인증서 SHA-1 해시. 비밀은 아니지만 맥마다 다르므로 문서에 적으면 남의 환경에서 틀린다.
  필요할 때 `security find-identity`로 찾는다.

## 문제 해결

**`error: ambiguous (matches multiple identities)`**
이름이 같은 인증서가 둘 이상이다. 이름 대신 SHA-1 해시를 `APPLE_SIGNING_IDENTITY`에 넣는다.

**`requirement=... cdhash ...`**
서명 없이 빌드됐다. `APPLE_SIGNING_IDENTITY`가 비었거나 키체인이 잠겨 있다.
`security find-identity -v -p codesigning`이 신원을 찾는지 먼저 확인한다.

**`공증 생략: Developer ID 서명이 아니다`**
Apple Development 인증서로 서명했다. 공증은 Developer ID만 가능하다.

**`Warn skipping app notarization, no APPLE_ID & APPLE_PASSWORD ...`**
Tauri 자체 공증 기능이 건너뛴다는 안내다. 무시해도 된다. 이 저장소는 Tauri에 맡기지 않고
빌드 뒤 `notarytool`로 직접 공증한다.

**`주의: universal 을 요청했는데 아키텍처가 arm64 다`**
`rustup target add x86_64-apple-darwin`이 빠졌다. 이 상태로 배포하면 인텔 맥에서 실행되지 않고
그 사실을 배포 후에 알게 된다.

**공증이 `Invalid`로 끝난다**
로그를 받아 원인을 본다.

```bash
xcrun notarytool log <제출ID> --keychain-profile tinyfarm
```

제출 ID는 `tmp/install_macos.log`의 `id:` 줄에 있다.

**위치 권한이 그래도 초기화된다**
DR이 인증서 기반인지, 앱이 `/Applications`에 있는지 확인한다. 그다음 실제로 어떻게 저장됐는지 본다.
아래 명령은 이 앱 항목만 지워 프롬프트를 처음부터 다시 받는다.

```bash
tccutil reset Location app.tinyfarm.widget
```

## 관련 문서

- [README.md](../README.md) 설치와 개발
- [.kiro/specs/focus-farm/design.md](../.kiro/specs/focus-farm/design.md) 설계 결정과 이유
