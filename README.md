# 도전미션 별풍선 TOP5 (SoopScope 연동, 멀티 스트리머)

SOOP 도전미션을 진행 중인 **아무 스트리머나** 주소창의 `?bj=` 또는 `?nick=` 파라미터만 바꿔서 조회할 수 있는 TOP5 화면입니다. SoopScope(비공식 사이트)가 이미 집계해둔 데이터를 서버가 대신 받아와 보여줍니다.

- SOOP 공식 OAuth/Chat SDK를 **전혀 사용하지 않습니다.**
- 스트리머 계정 로그인도 필요 없습니다.
- 특정 스트리머로 고정되어 있지 않습니다. 같은 서버 하나로 스트리머마다 다른 주소를 나눠주면 됩니다.
- SQLite/DB, 테스트 후원, 초기화, 운영자 로그인 같은 기능은 이전 버전에서 모두 제거했습니다. (이전 버전들은 `backup/` 폴더에 그대로 보관되어 있습니다)
- 화면에는 **목표 진행률 카드**(반투명 글래스 스타일)와 **TOP5 순위표**, 이 두 영역만 있습니다. 진행 중 미션 개수/별도의 총 별풍선/마지막 갱신 시각은 표시하지 않습니다.
- 목표 별풍선 개수는 스트리머마다 다를 수 있어서 `?goal=` 파라미터로 받습니다. (없거나 숫자가 아니거나 0 이하면 기본값 300,000) 목표를 달성하면 바가 초록색으로 바뀌고 "🎉 N개 목표 달성!" 문구로 바뀝니다.

---

## 1. 설치 방법

### 요구 사항
- Node.js 18 이상 (내장 `fetch`를 사용합니다. 별도 설치 패키지 없이 SoopScope를 호출합니다)

### 설치 순서
```bash
cd soop-challenge-leaderboard
npm install
cp .env.example .env
```

`.env`에는 포트 번호와 캐시 유지 시간(`CACHE_TTL_MS`, 기본 30초)만 있습니다. 스트리머는 `.env`가 아니라 **주소창 파라미터**로 지정합니다.

---

## 2. 실행 방법

```bash
npm start
```

```
서버가 실행되었습니다: http://localhost:3000
```

브라우저에서 아래처럼 접속하면 그 스트리머의 TOP5 화면이 보입니다.

```
http://localhost:3000/broadcast.html?bj=whiteone325&goal=300000
http://localhost:3000/broadcast.html?bj=katollia&goal=500000
http://localhost:3000/broadcast.html?nick=닉네임
```

- `bj` = SoopScope/SOOP의 **아이디(bjId)** 로 찾습니다. (예시의 `whiteone325` 같은 영문 아이디)
- `nick` = **닉네임(bjNick)** 으로 찾습니다. `bj`와 `nick`을 둘 다 넣으면 `bj`가 우선됩니다.
- `goal` = 목표 별풍선 개수입니다. 생략하거나 숫자가 아니거나 0 이하면 기본값 300,000이 적용됩니다.
- 파라미터를 아예 안 넣으면 화면에 "스트리머를 지정해주세요" 안내가 뜹니다.

---

## 3. 프로젝트 구조

```
soop-challenge-leaderboard/
├── server.js           # SoopScope API 조회 + bj/nick별 캐시 + API 제공
├── package.json          # 패키지 정보 (express, dotenv만 사용)
├── .env.example           # 환경변수 예시
├── .gitignore              # Git에 올리지 않을 파일 목록
├── README.md                # 지금 보고 있는 문서
├── backup/                   # 이전 버전들 전체 백업 (SOOP OAuth/Chat SDK/SQLite 버전, 단일 스트리머 고정 버전 등)
└── public/
    ├── index.html              # /broadcast.html로 즉시 리다이렉트
    ├── broadcast.html           # TOP5 화면 (OBS용, 투명 배경)
    ├── app.js                    # ?bj=/?nick= 읽기 + 화면 렌더링 + 주기적 갱신
    └── style.css                  # 디자인 (1~3위 특별 표시 포함)
```

### API

| 메서드 | 주소 | 설명 |
|---|---|---|
| GET | `/api/mission?bj=아이디` 또는 `?nick=닉네임` | 그 스트리머의 현재 상태 조회 (`hasMission`, `bjId`, `bjNick`, `missionCount`, `totalStars`, `topRanking`, `updatedAt`, `cached`) |

`bj`/`nick` 둘 다 없으면 400, SoopScope 조회 자체가 실패하고 캐시된 이전 값도 없으면 502를 반환합니다.

`topRanking`은 최대 5개, 각 항목은 `{ rank, nickname, stars }`만 담습니다. (그 스트리머의 진행 중인 모든 미션을 합산한 결과)

---

## 4. 동작 방식 (조회 흐름)

1. 브라우저(`app.js`)가 주소창의 `?bj=` 또는 `?nick=` 값을 그대로 서버 API(`/api/mission?bj=...`)에 전달합니다. 서버는 이 값별로 완전히 독립적으로 동작합니다. (같은 서버로 여러 스트리머를 동시에 조회해도 서로 섞이지 않습니다)
2. 서버는 먼저 **캐시**를 확인합니다. 같은 `bj`/`nick`을 `CACHE_TTL_MS`(기본 30초) 안에 다시 요청받으면, SoopScope를 다시 부르지 않고 저장해둔 결과를 그대로 돌려줍니다. (같은 스트리머를 동시에 여러 명이 요청해도 SoopScope 호출은 한 번만 나갑니다)
3. 캐시가 없거나 만료됐으면 새로 조회합니다.
   - **목록 조회**: `GET https://soopscope.com/api/challenge?status=active&sort=recent&limit=50&offset=0&q=<bj 또는 nick>`
   - `bj`가 있으면 `bjId`가 정확히 일치하는 것만, `nick`이 있으면 `bjNick`이 정확히 일치하는 것만, `status`가 `active`인 것을 **전부** 남깁니다. (첫 번째 것만 쓰지 않습니다)
4. **전체 별풍선 총합**은 목록 응답에 이미 있는 각 미션의 `totalStars`를 더해서 계산합니다. (아래 5번이 일부 실패해도 총합은 정확합니다)
5. 남은 모든 미션에 대해 `GET https://soopscope.com/api/challenge/{missionKey}`를 **`Promise.all`로 동시에(병렬)** 호출합니다. 특정 미션 조회가 실패하면 그 미션만 건너뛰고 나머지는 계속 집계합니다.
6. 성공한 미션들의 `allDonors`를 전부 모아서, **같은 `nickname`의 `stars`를 합산**합니다.
7. 합산 결과를 `stars` 내림차순으로 정렬해서 TOP5만 `{rank, nickname, stars}`로 저장하고 캐시에 담아둡니다.
8. 진행 중인 미션이 하나도 없으면 화면에 "현재 진행 중인 도전미션이 없습니다"를 표시합니다.
9. SoopScope 호출이 실패하면(네트워크 오류, 403 등) **이전에 성공했던 캐시가 있으면 그것을 그대로 유지**해서 돌려줍니다. 화면 값은 갱신되지 않습니다.
10. 브라우저는 `POLL_INTERVAL_MS`(기본 15초, `app.js` 상단 상수)마다 다시 조회합니다. 직전에 그린 내용과 완전히 같으면 화면을 다시 그리지 않습니다.
11. SoopScope 요청에는 `User-Agent`만 지정합니다. Cookie나 Authorization은 전혀 보내지 않으며, 그래도 정상 응답합니다.

---

## 5. OBS 사용법

1. OBS에서 **소스 추가 → 브라우저** 선택
2. URL에 아래처럼 넣습니다.
   ```
   https://도메인/broadcast.html?bj=whiteone325&goal=300000
   ```
   (로컬 테스트라면 `https://도메인` 대신 `http://localhost:3000`)
3. 스트리머가 여러 명이면, **소스마다 `bj`와 `goal` 값만 바꿔서** 여러 개 추가하면 됩니다. 서버는 하나만 켜둬도 됩니다.
   ```
   https://도메인/broadcast.html?bj=streamerA&goal=300000
   https://도메인/broadcast.html?bj=streamerB&goal=500000
   ```
4. 배경이 투명하게 만들어져 있어서, 방송 화면 위에 그대로 겹쳐 보여줄 수 있습니다. 크기/위치는 OBS의 브라우저 소스 크기 조절로 맞추세요.
5. 화면은 15초 간격으로 자동 새로고침되며, OBS를 껐다 켜도 서버 쪽 캐시(최대 30초) 덕분에 곧바로 최근 값을 보여줍니다.

---

## 6. 테스트 방법

SoopScope에는 이미 실제로 진행 중인 도전미션들이 있기 때문에, 실제로 활동 중인 아무 스트리머로도 바로 테스트할 수 있습니다.

1. `https://soopscope.com/challenge` 페이지에서 현재 진행 중(active)인 미션의 스트리머 아이디/닉네임을 하나 확인합니다.
2. `npm start` 후 `http://localhost:3000/broadcast.html?bj=<확인한 아이디>&goal=300000` 접속 → 목표 진행률 카드와 TOP5가 뜨는지 확인
3. 같은 스트리머를 `?nick=<닉네임>`으로도 접속해서 똑같은 결과가 나오는지 확인
4. `goal` 값을 바꿔가며(`goal=1000`처럼 낮게, `goal=abc`처럼 잘못된 값, `goal` 생략) 접속해서 퍼센트/막대/남은 수량이 그에 맞게 바뀌는지, 잘못된 값일 땐 300,000으로 대체되는지 확인
5. 서로 다른 두 스트리머 주소를 각각 다른 탭으로 열어서, 결과가 섞이지 않고 각자 독립적으로 나오는지 확인
6. `curl http://localhost:3000/api/mission?bj=<아이디>`를 연속으로 두 번 호출해서, 두 번째 응답의 `"cached":true`와 `updatedAt`이 첫 번째와 같은지 확인 (30초 캐시 동작 확인)
7. 파라미터 없이 `http://localhost:3000/broadcast.html` 접속 → "스트리머를 지정해주세요" 안내가 뜨는지 확인
8. 존재하지 않는 아이디로 접속 → "현재 진행 중인 도전미션이 없습니다" 문구가 뜨는지 확인

> 실제로 서로 다른 두 스트리머(`bj=katollia`, `bj=elixxir`)를 동시에 조회해 각자 다른 결과(미션 개수, 총 별풍선, TOP5)가 독립적으로 나오는 것과, 같은 `bj`를 연속 호출했을 때 두 번째 응답이 `cached:true`로 돌아오는 것을 curl로 직접 확인했습니다.

### API 직접 확인
```bash
curl "http://localhost:3000/api/mission?bj=whiteone325"
```

---

## 7. 이전 버전(백업)

`backup/` 폴더에 이전 버전들이 그대로 들어있습니다.
- SOOP OAuth/Chat SDK 연결, SQLite 누적 저장, 운영자 설정 화면(`settings.html`), 테스트 후원/초기화 기능이 있던 버전
- `.env`의 `TARGET_BJ_NICKNAME`으로 스트리머 한 명만 고정해서 보여주던 버전

나중에 다른 방식으로 되돌리고 싶다면 `backup/` 안의 파일들을 참고하세요.
