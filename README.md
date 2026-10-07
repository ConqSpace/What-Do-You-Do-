# What Do You Do? 🎲

**AI GM과 AI 플레이어들이 한 테이블에 둘러앉는 LLM TRPG 시뮬레이터.**
Claude · ChatGPT · Grok · Gemini가 GM이나 플레이어 자리에 앉아 세계를 만들고, 캐릭터를 연기하고, 주사위를 굴린다. 나는 플레이어로 끼어도 되고, 관전만 해도 되고, 직접 GM을 봐도 된다.

> [Moris-kr/ai-chatroom](https://github.com/Moris-kr/ai-chatroom)(AI 단톡방)에서 영감을 받았다.
> 그쪽이 "네 AI가 상주하는 단톡방"이라면, 이쪽은 "네 AI가 둘러앉은 TRPG 테이블"이다.
> 로그인된 CLI를 헤드리스로 부르는 방식(API 키 없음), 매 턴 독립 프롬프트 + JSON 응답, 각자 개인 메모로 기억하는 구조를 그대로 따른다.

- **API 키를 쓰지 않는다.** 내 PC에 로그인된 각 회사 CLI(`claude`, `codex`, `grok`, `agy`)를 부른다. 없는 CLI는 자리에 앉지 못할 뿐이다.
- **CLI가 하나도 없어도 돌아간다.** 내장 "데모봇"이 모든 자리를 맡아 흐름을 체험할 수 있다.
- **룰을 고른다.** 간이 d20, 던전 월드(2d6 무브). 크툴루의 부름 7판은 준비 중.
- **주사위는 서버가 굴린다.** 모델은 판정을 "요청"만 하고, 결과를 지어내지 못한다.
- Node.js 22 하나로 돈다. npm 설치할 것 없음.

## 빠른 시작

```bash
git clone https://github.com/ConqSpace/What-Do-You-Do-.git
cd What-Do-You-Do-
./start.sh            # Windows: start.bat   (또는 node server.mjs)
```

브라우저에서 `http://localhost:8420` → **＋ 새 캠페인** → 전제를 고르고 시작.

CLI 없이 흐름만 보고 싶으면 `npm run demo` (모든 자리를 데모봇이 맡는다).

### 필요한 것

| 필요 | 설명 |
|---|---|
| **Node.js 22 이상** | 서버 |
| 자리에 앉힐 AI의 CLI (있는 것만) | 각 회사 구독으로 로그인해서 쓴다. 설치·로그인 방법은 [ai-chatroom README](https://github.com/Moris-kr/ai-chatroom#필요한-것) 표와 같다 |

| AI | CLI | 로그인 |
|---|---|---|
| Claude | Claude Code `claude` | `claude auth login` |
| ChatGPT | Codex CLI `codex` | `codex login` |
| Grok | Grok Build `grok` | `grok login` |
| Gemini | Antigravity CLI `agy` | `agy` 한 번 실행 |

## 테이블이 굴러가는 방식

```
캠페인 준비   GM: 세계·비밀·첫 장면 설계 → 플레이어들: 각자 캐릭터 시트 작성 → GM: 오프닝 서술
   ↓
라운드 반복   ① 선언  플레이어들이 차례로 대사·행동 선언 (AI는 앞사람 선언을 보고 맞춰 움직인다)
              ② 판정  GM이 위험한 행동만 골라 판정 요청 → 서버가 d20 + 보정치 vs DC로 굴림
              ③ 결과  GM이 주사위 결과대로 서술, HP·소지품·상태·장면 갱신
   ↓
결말          GM이 목표 라운드 즈음 클라이맥스로 이끌고 에필로그로 닫는다
```

- **GM 비밀 메모**: GM은 숨겨진 진실, NPC 동기, 단서, 위협 시계를 비밀 메모에 적어 두고 매 턴 본다. 플레이어에게는 안 보인다.
- **플레이어 개인 메모**: 매 호출은 독립적이라, AI 플레이어는 기억할 것을 스스로 메모에 적는다(캐릭터의 비밀이나 목표 포함).
- **지금까지의 이야기**: GM이 몇 라운드마다 줄거리 요약을 갱신해서, 오래된 기록이 프롬프트 창(최근 40줄) 밖으로 밀려나도 흐름이 이어진다.
- **스포트라이트**: GM이 다음 라운드에 누가 행동할지 좁힐 수 있다(혼자 정찰 나간 캐릭터 등).

### 룰

| 룰 | 판정 | 캐릭터 | 특징 |
|---|---|---|---|
| **간이 d20** | d20 + 보정치 ≥ DC. 자연 20 대성공, 자연 1 대실패, 유리·불리 | 능력치 6개, 보정치 -1~+3, 합 4 | 어느 장르든 가볍게 |
| **던전 월드** | 무브: 2d6 + 능력치 → 10+ 강한 성공 / 7–9 부분 성공 / 6- 실패(GM 무브, 경험치 +1) | 클래스 8종, 점수 16·15·13·12·9·8, 클래스 HP·피해 주사위·갑옷 | 유대, 약화, 전진·홀드, 7–9 선택지, 마지막 숨 |

던전 월드에서는:
- 캐릭터를 만든 뒤 **유대 단계**가 있다. AI 플레이어들이 서로에 대한 유대를 쓰고, 돕기/방해하기 판정에 유대 수가 더해진다.
- GM은 **절대 굴리지 않는다**. 플레이어의 허구가 무브를 일으키면 GM이 무브 이름으로 판정을 요청하고, 6-에서 GM 무브를 한다.
- **7–9 선택지**(일제 사격, 상황 파악의 질문, 기습 공격 등)는 사람은 버튼으로, AI는 따로 한 번 더 불려서 고른다. GM은 고른 내용을 보고 서술한다.
- **적**은 GM이 HP·갑옷·피해 주사위로 등록한다. 피해 무브가 성공하면 서버가 클래스 피해 주사위를 굴려 갑옷만큼 빼고 적 HP를 깎는다. 적이 주는 피해도 GM은 주사위 식만 적고 서버가 굴린다.
- HP가 0이 되면 서버가 바로 **마지막 숨**을 굴린다.
- 입력창 위 무브 버튼을 누르면 `[상황 파악]`처럼 노리는 무브가 선언에 붙는다(판정할지는 GM이 정한다).

### 내 자리

| 역할 | 하는 일 |
|---|---|
| **플레이어** | 내 캐릭터로 선언한다. `"대사는 따옴표로" 행동은 그냥` 쓰면 대사와 행동이 나뉜다. 내 판정은 직접 🎲 버튼으로 굴린다. GM은 내 선언을 기다린다(넘기기 가능) |
| **관전** | AI들끼리 굴러간다. 잡담(OOC)으로 끼어들 수 있다. 오래 조용하면 자동으로 멈춘다 |
| **GM** | 내 입력이 곧 서술이고, 보내면 AI 플레이어들이 선언한다. `/check 이름 능력치 DC [유리\|불리]` (던전 월드: `/check 이름 무브 [능력치\|대상]`), `/hp 이름 -3`, `/dmg 이름 d8`, `/foe 이름 HP 갑옷 피해`, `/scene 제목 \| 설명`, `/end` |

누구나 `/r 2d6+1`, `/r 4d6kh3`로 자유 주사위를 굴릴 수 있다. 오른쪽 **비밀** 탭에서 GM 메모와 AI 메모를 엿볼 수 있다(스포일러 주의).

## 설정 (`config.json`)

`config.example.json`을 `config.json`으로 복사해서 고친다. 없으면 기본값으로 돈다.

| 키 | 기본값 | 설명 |
|---|---|---|
| `port` | 8420 | |
| `userName` | 방장 | AI들이 부르는 내 이름 (캠페인마다 바꿀 수 있다) |
| `demo` | false | true면 모든 자리를 데모봇이 맡는다 (`WDYD_DEMO=1`도 같음) |
| `declareMode` | sequential | `sequential`: AI 플레이어가 한 명씩 선언(서로 반응) / `parallel`: 동시에(빠름) |
| `waitForUser` | true | 플레이어로 참가했을 때 GM이 내 선언을 기다릴지 |
| `targetRounds` | 12 | GM이 결말을 향해 페이스를 맞추는 기준 |
| `autoPauseRounds` | 8 | 관전 중 이 라운드 동안 말이 없으면 멈춤 (0이면 안 멈춤) |
| `historyWindow` | 40 | 매 프롬프트가 보는 최근 기록 줄 수 |
| `turnTimeoutSec` | 150 | 호출 한 번 제한 시간 |
| `bins` | `{}` | CLI 경로 직접 지정: `{"claude": "...", "codex": "..."}` |
| `backends.<id>.model` / `effort` | 아래 | 각 AI의 모델 |
| `gmModel.<id>` | `{}` | GM 자리일 때만 쓸 모델. 예: `{"claude": "opus"}` |

기본 모델 이름은 ai-chatroom 기준(2026년 9월)을 따른다: Claude `sonnet`, ChatGPT `gpt-6-sol`, Grok `grok-4.7`, Gemini `gemini-3.8-flash-medium`. 내 계정에서 되는 이름으로 바꾸면 된다.

## 안전장치

- AI는 도구를 못 쓴다. CLI 호출 플래그는 ai-chatroom과 같다(Claude 도구 0개·MCP 끔, Codex 읽기 전용 샌드박스·셸 끔, Grok 도구 전부 제외 + dontAsk, agy 빈 임시 폴더).
- 각 자리는 `data/cwd/<자리>/` 빈 폴더에서 돈다.
- 서버는 `127.0.0.1`에만 열린다. 다른 사이트에서 오는 POST는 막는다.
- 캠페인 기록은 `data/campaign.json`에만 저장된다. 새 캠페인을 시작하면 이전 것은 `data/archive/`로 옮겨진다. 호출 기록은 `data/logs/`.

## 구조

| 파일 | 역할 |
|---|---|
| `server.mjs` | HTTP + SSE 서버, 설정, API |
| `lib/engine.mjs` | 테이블 상태 기계: 준비 → 선언 → 판정 → 선택 → 결과, 효과·적 적용, 사람 입력과 명령 |
| `lib/rules/` | 룰 모듈: `d20.mjs`(간이 d20), `dw.mjs`(던전 월드). 시트, 판정, 선택지, 프롬프트 조각. 인터페이스는 `index.mjs` 맨 위 |
| `lib/prompts.mjs` | GM·플레이어 프롬프트 뼈대와 JSON 응답 형식 |
| `lib/backends.mjs` | CLI 어댑터(claude, codex, grok, agy), CLI 찾기 |
| `lib/mock.mjs` | 데모봇 |
| `lib/dice.mjs` | 주사위 식 파싱과 굴림 |
| `lib/parse.mjs`, `lib/store.mjs` | 응답 JSON 추출, 캠페인 저장 |
| `public/` | 웹 화면 |
| `test/` | `npm test` — 주사위, 파싱, 던전 월드 규칙, 데모봇으로 캠페인 전체 진행 |

## 앞으로 해 볼 것

- 전투 전용 흐름(이니셔티브, 적 HP 추적)
- 캠페인 이어 하기 / 불러오기, 세션 기록 내보내기
- 캐릭터 초상화·장면 삽화 생성 (ai-chatroom의 이미지 생성 경로 활용)
- 크툴루의 부름 7판 대응 (d100, 이성, 밀어붙이기·행운)
- 모바일 화면 (목업 완료)
- 영어·일본어

## License

[MIT](LICENSE)

던전 월드의 무브·클래스 요약은 Sage LaTorra와 Adam Koebel의 [Dungeon World SRD](https://www.dungeonworldsrd.com/)를 한국어로 옮겨 줄인 것으로, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)을 따른다.
