# Family Chart

가족관계도 정적 사이트. 카드를 그리드 위에 자유롭게 배치하고, A/B 두 관점의 호칭을 한 카드에 같이 저장.

## 구조

```
family-chart/
├── data/family.json        # 공유용 데이터 (단일 source-of-truth, git 커밋)
├── index.html              # 메인 페이지 (편집 + 보기 통합)
├── assets/
│   ├── chart.css
│   └── chart.js            # 보드 렌더링·편집 로직
└── README.md
```

## 핵심 동작

- **초기 상태**: 나(아빠) ↔ 엄마 두 카드.
- **카드 추가**: 카드 위에 마우스를 올리면 사방에 **+** 가 나타남 → 클릭한 방향(위/아래/왼쪽/오른쪽)에 빈 카드 생성.
- **카드 콘텐츠**: 사진 (상단, 클릭해서 첨부) + 호칭 input + 이름 input.
- **A/B 토글**: 헤더 라디오로 두 관점 전환. 각 카드는 `title_a`, `title_b` 두 호칭을 따로 저장 → 라디오 전환 시 보여주는 호칭이 바뀜.
- **저장**: 모든 변경이 `localStorage` 에 즉시 저장. 브라우저 닫았다 열어도 유지.
- **공유**: "JSON 내보내기" → `family.json` 다운로드 → `data/family.json` 덮어쓰기 → `git commit && push`. 가족은 배포된 사이트에서 마지막으로 커밋된 JSON 을 봄.

## 로컬 실행

```bash
cd ~/Documents/github/family-chart
python3 -m http.server 8081
# 브라우저로 http://localhost:8081
```

> 8080 은 다른 프로젝트가 점유 중일 수 있어 8081 사용 권장.

## 데이터 스키마

```json
{
  "perspective": "A",
  "people": [
    {
      "id": "p1",
      "row": 0,
      "col": 0,
      "photo": "",
      "title_a": "나",
      "title_b": "남편",
      "name": "홍길동"
    }
  ]
}
```

- `perspective`: 마지막으로 선택한 라디오 ("A" / "B")
- `people[].id`: 카드 고유 ID (자동 생성)
- `people[].row`, `people[].col`: 그리드 좌표 (정수, 음수 가능)
- `people[].photo`: data URL (base64) 또는 빈 문자열
- `people[].title_a`, `title_b`: A·B 관점에서 본 호칭
- `people[].name`: 이름

## 저장·공유 흐름

1. 브라우저에서 편집 (모든 변경이 localStorage 에 자동 저장)
2. **JSON 내보내기** → `family.json` 다운로드
3. 다운로드 파일로 `data/family.json` 덮어쓰기
4. `git commit -am "가족 업데이트" && git push`
5. 배포된 사이트(GitHub Pages / Cloudflare Pages)에 반영

다른 브라우저·기기에서 보고 싶을 때는 **JSON 불러오기** 로 `family.json` 을 import.
**초기화** 는 localStorage 비우고 시작 카드 2개로 복구.

## 배포

빌드 단계 없음 — 정적 호스팅 어디든 push.

### GitHub Pages
repo Settings → Pages → Source: `main` branch / root

### Cloudflare Pages
New project → Connect GitHub repo → Build command 없음 → Build output `/`

## 향후 개선 아이디어

- A/B 라디오 레이블 커스터마이즈 (예: "아빠 입장" / "엄마 입장")
- 가족 그룹별 색깔 (친가·외가·처가 등)
- 사망자 표시 (회색 처리)
- 카드 드래그&드롭으로 위치 이동
- 형제자매 자동 정렬 (출생일 기준)
- 검색·필터
