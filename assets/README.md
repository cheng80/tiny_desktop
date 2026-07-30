# 원본 자원

이 폴더는 저장소에 포함되지 않는다. 재배포가 허용되지 않는 파일이 섞여 있고, 타일 원본
수백 개를 저장소에 넣을 이유도 없다. 빌드에 실제로 쓰이는 파일만 `public/`에 두고
그중 폰트는 각자 내려받아 배치한다.

## 폰트: PF스타더스트 3.0

- 출처: https://m.blog.naver.com/campanula913/221366697603
- 저작권: 피나타(campanula913@naver.com)
- 사용 조건: 상업적 사용과 앱 임베딩은 허용, 폰트 수정·파일 재배포·판매는 금지

재배포가 금지되어 있어 저장소에 두지 않는다. 내려받은 뒤 아래 경로에 놓는다.

```
public/fonts/pf-stardust.ttf
```

파일이 없어도 앱은 실행된다. 이때는 시스템 sans-serif로 그려지고 픽셀 글꼴 느낌만
사라진다. 콘솔에 경고가 한 번 남는다.

## 타일 시트

앱이 읽는 시트는 `public/tiles/`에 있고 저장소에 포함된다. 세 파일 모두 Kenney 팩의
`tilemap_packed.png`를 그대로 쓴다.

- `public/tiles/farm.png` — Kenney Tiny Farm
- `public/tiles/town.png` — Kenney Tiny Town
- `public/tiles/ui.png` — Kenney UI Pack Pixel Adventure

원본 팩(개별 타일, 미리보기, 라이선스 문서)은 아래에서 받는다. 라이선스는 CC0다.

- https://kenney.nl/assets/tiny-farm
- https://kenney.nl/assets/tiny-town
- https://kenney.nl/assets/ui-pack-pixel-adventure

원본 팩은 `tools/` 안의 타일 조사 도구(`decode_sample.py`, `sample_crop.py`,
`tile_contact_sheet.py` 등)를 쓸 때만 필요하다. 앱 빌드에는 필요하지 않다.

## 앱 아이콘

`assets/app-icon.png`가 확정 원본이고, `npm run icons`가 `src-tauri/icons/`의 모든
크기를 다시 만든다. 생성된 아이콘은 저장소에 포함되므로 원본이 없어도 빌드된다.
