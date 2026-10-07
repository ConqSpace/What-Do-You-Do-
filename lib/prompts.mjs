// Prompts for the GM seat and the player seats. Every call is self-contained, like
// ai-chatroom: a brief (system prompt) plus this turn's context, answered with one JSON
// object. The GM sees its secret notes; players only see what their characters could know
// and their own private notes.

import { STATS, STAT_BUDGET, STAT_MIN, STAT_MAX, OUTCOME_LABEL } from './dice.mjs';
import { BACKENDS } from './backends.mjs';

const RULES = `## 규칙 (간이 d20)
- 능력치 6개: ${STATS.join('·')}. 각각 보정치 ${STAT_MIN}~+${STAT_MAX}.
- 판정: d20 + 보정치 ≥ 난이도(DC)면 성공. DC 기준: 쉬움 8 / 보통 12 / 어려움 15 / 매우 어려움 18 / 거의 불가능 22.
- 자연 20은 대성공(기대 이상의 결과), 자연 1은 대실패(일이 꼬인다).
- 유리(advantage)·불리(disadvantage): d20을 두 번 굴려 높은/낮은 쪽.
- HP = 10 + 체력×2. 피해: 가벼움 1~3, 보통 4~6, 치명 7~10. HP 0이면 쓰러진다(죽음은 이야기상 의미 있을 때만).
- 주사위는 테이블 서버가 굴린다. 누구도 결과를 지어내지 않는다.`;

export function seatLabel(c, key) {
  if (key === 'user') return `${c.userName}(사람)`;
  if (key === 'gm') return c.gm ? `${BACKENDS[c.gm.backend]?.label || c.gm.backend}` : `${c.userName}(사람)`;
  const s = c.seats.find((x) => x.key === key);
  return s ? (BACKENDS[s.backend]?.label || s.backend) : key;
}

export function charName(c, key) {
  if (key === 'gm') return 'GM';
  return c.characters[key]?.name || seatLabel(c, key);
}

const mod = (n) => (n >= 0 ? `+${n}` : `${n}`);

function sheetLine(ch, { full = false } = {}) {
  const stats = STATS.map((s) => `${s}${mod(ch.stats?.[s] ?? 0)}`).join(' ');
  let line = `${ch.name} — ${ch.concept || '?'} | HP ${ch.hp}/${ch.maxHp} | ${stats}`;
  if (ch.conditions?.length) line += ` | 상태: ${ch.conditions.join(', ')}`;
  if (ch.items?.length) line += ` | 소지품: ${ch.items.join(', ')}`;
  if (full) {
    if (ch.appearance) line += `\n    외모: ${ch.appearance}`;
    if (ch.personality) line += `\n    성격: ${ch.personality}`;
    if (ch.background) line += `\n    배경: ${ch.background}`;
  } else if (ch.appearance) line += `\n    외모: ${ch.appearance}`;
  return line;
}

export function partyBlock(c, selfKey, opts = {}) {
  const keys = playerKeys(c);
  if (!keys.length) return '(아직 캐릭터 없음)';
  return keys.map((k) => {
    const ch = c.characters[k];
    if (!ch) return `  - [${k}] (캐릭터 만드는 중) — 플레이어: ${seatLabel(c, k)}`;
    const you = k === selfKey ? ' ← 너' : '';
    return `  - [${k}] ${sheetLine(ch, { full: opts.full || k === selfKey })}\n    플레이어: ${seatLabel(c, k)}${you}`;
  }).join('\n');
}

export function playerKeys(c) {
  const keys = c.seats.map((s) => s.key);
  if (c.userRole === 'player') keys.unshift('user');
  return keys;
}

function rollText(c, r) {
  const who = charName(c, r.who);
  if (r.kind === 'check') {
    const dice = r.dice.length > 1 ? `[${r.dice.join(',')}]→${r.natural}` : `${r.natural}`;
    const adv = r.adv === 'advantage' ? ', 유리' : r.adv === 'disadvantage' ? ', 불리' : '';
    return `🎲 ${who} ${r.stat} 판정 (DC ${r.dc}${adv}): d20 ${dice} ${mod(r.mod)} = ${r.total} → ${OUTCOME_LABEL[r.outcome]}${r.why ? ` (${r.why})` : ''}`;
  }
  return `🎲 ${who}: ${r.expr} = ${r.detail} = ${r.total}${r.why ? ` (${r.why})` : ''}`;
}

export function formatLog(c, msgs, selfKey) {
  return msgs.map((m) => {
    const tag = `#${m.id}`;
    switch (m.type) {
      case 'narration': return `[${tag} GM 서술]\n${m.text}`;
      case 'scene': return `[${tag} 장면 전환] ${m.text}`;
      case 'declare': {
        const me = m.from === selfKey ? ' (너)' : '';
        const parts = [];
        if (m.say) parts.push(`"${m.say}"`);
        if (m.action) parts.push(`행동: ${m.action}`);
        return `[${tag} ${charName(c, m.from)}${me}] ${parts.join(' / ') || '(아무것도 하지 않는다)'}`;
      }
      case 'ooc': return `[${tag} ${seatLabel(c, m.from)} · 테이블 잡담(OOC)] ${m.text}`;
      case 'roll': return `[${tag}] ${rollText(c, m.roll)}`;
      default: return `[${tag} 진행] ${m.text}`;
    }
  }).join('\n');
}

function recent(c, n) {
  return c.log.slice(-n);
}

function sceneBlock(c) {
  const parts = [];
  if (c.summary) parts.push(`## 지금까지의 이야기\n${c.summary}`);
  if (c.scene?.title) parts.push(`## 현재 장면: ${c.scene.title}\n${c.scene.description || ''}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// GM

export function gmBrief(c) {
  return `너는 TRPG 테이블 "What Do You Do?"의 게임 마스터(GM)야. 이 테이블에서 너는 ${seatLabel(c, 'gm')}이고, 플레이어들은 사람 한 명과 여러 AI야.
모든 출력은 한국어로 해.

## 캠페인
- 전제: ${c.premise}
${c.tone ? `- 분위기: ${c.tone}\n` : ''}- 테이블 주인(방장): ${c.userName}${c.userRole === 'player' ? ' — 플레이어로 참가' : ' — 관전 중'}

${RULES}

## GM 원칙
- 세계와 NPC와 결과를 맡는다. 플레이어 캐릭터(PC)의 대사·생각·행동은 절대 대신 정하지 마. PC가 선언한 것의 "결과"만 서술해.
- 결과가 뻔하거나, 실패해도 이야기가 재미없어지면 굴리지 말고 바로 결과를 서술해. 판정은 위험이나 불확실성이 있을 때만.
- 실패는 막다른 길이 아니라 새로운 문제·대가·전개로 이어지게(fail forward).
- 서술은 감각적이고 구체적으로, 3~8문장. NPC 대사는 따옴표로 서술 안에 넣어.
- 매 서술 끝은 상황을 열어 둔 채 끝내. 플레이어가 선택할 거리를 남기고, 필요하면 "어떻게 하시겠습니까?"처럼 물어.
- 스포트라이트를 고르게 나눠. 최근에 조용했던 캐릭터에게 기회를 줘.
- 비밀 메모(gm_notes)에 숨겨진 진실, NPC 동기, 단서, 시계(위협이 다가오는 정도), 다음 전개 아이디어를 적어 두고 일관성을 지켜. 메모는 플레이어에게 안 보여.
- 캠페인은 대략 ${c.targetRounds}라운드 안팎에서 클라이맥스와 결말에 닿도록 페이스를 조절해.
- 응답은 JSON 객체 하나만. 코드블록이나 설명을 붙이지 마.`;
}

function gmContext(c) {
  return `${sceneBlock(c)}

## 비밀 메모 (너만 봄)
${c.gmNotes || '(비어 있음)'}

## 파티
${partyBlock(c, null, { full: true })}

## 최근 진행 (라운드 ${c.round})
${formatLog(c, recent(c, c.window), null) || '(아직 없음)'}`;
}

export function worldbuildTurn(c) {
  return `새 캠페인을 준비할 차례야. 전제를 바탕으로 세계·사건·첫 장면을 설계해.
전제: ${c.premise}
${c.tone ? `분위기: ${c.tone}\n` : ''}플레이어 수: ${playerKeys(c).length}명

JSON으로 답해:
{
  "title": "캠페인 제목",
  "pitch": "플레이어에게 공개하는 소개 (3~5문장. 배경, 분위기, 캐릭터들이 모인 이유)",
  "character_hint": "캐릭터를 만들 때 참고할 점 (어떤 인물이 어울리는지, 한두 문장)",
  "gm_notes": "비밀 메모: 숨겨진 진실, 주요 NPC와 동기, 단서 3개 이상, 위협과 그 진행, 예상 클라이맥스",
  "scene": {"title": "첫 장면 이름", "description": "장소와 상황 요약 (2~3문장)"}
}`;
}

export function openingTurn(c) {
  return `${gmContext(c)}

## 지금 할 일
캐릭터가 모두 정해졌어. 첫 장면을 열어. 장소를 묘사하고, 캐릭터들이 왜 여기 있는지 자연스럽게 엮고, 곧바로 무언가 일이 벌어지게 해. 끝은 플레이어들이 행동을 고를 수 있게 열어 둬.

JSON으로 답해:
{
  "narration": "오프닝 서술 (5~10문장)",
  "gm_notes": "(선택) 비밀 메모를 고쳐 쓸 거면 전체 새 버전",
  "spotlight": ["(선택) 다음에 주로 행동할 캐릭터 키. 비우면 전원"]
}`;
}

function resolveSchema(withChecks) {
  return `{
${withChecks ? `  "checks": [{"who": "캐릭터 키", "stat": "${STATS.join('|')}", "dc": 12, "adv": "advantage|disadvantage|null", "why": "무엇을 판정하는지 짧게"}],
  "narration": "판정이 있으면: 굴리기 직전의 짧은 긴장 묘사(1~2문장)만. 판정이 없으면: 결과 서술 전체",
` : `  "narration": "판정 결과를 반영한 결과 서술 (3~8문장). 대성공·대실패는 확실히 티 나게",
`}  "effects": [{"who": "캐릭터 키", "hp": -3, "items_add": [], "items_remove": [], "conditions_add": [], "conditions_remove": []}],
  "scene": {"title": "장면이 바뀌었을 때만", "description": "새 장면 요약"},
  "summary": "(선택) '지금까지의 이야기'를 갱신할 때 전체 새 버전 (5~10문장)",
  "gm_notes": "(선택) 비밀 메모를 고쳐 쓸 때 전체 새 버전",
  "spotlight": ["(선택) 다음 라운드에 행동할 캐릭터 키. 비우면 전원"],
  "end": false
}`;
}

export function adjudicateTurn(c) {
  const keys = c.spotlight?.length ? c.spotlight : playerKeys(c);
  const summaryDue = c.round > 0 && c.round % 4 === 0;
  return `${gmContext(c)}

## 지금 할 일 (라운드 ${c.round} 처리)
이번 라운드의 플레이어 선언이 위 기록에 있어 (행동할 캐릭터: ${keys.map((k) => `[${k}] ${charName(c, k)}`).join(', ')}).
- 불확실하고 위험한 행동만 판정(checks)에 넣어. 판정이 있으면 서버가 주사위를 굴린 뒤 결과를 주고 다시 물어볼 테니, 이번엔 결과를 서술하지 마.
- 판정이 하나도 필요 없으면 checks를 빈 배열로 두고 결과까지 서술해.
- 적이나 위협이 있으면 그 움직임도 서술에 넣어. 적의 공격이 PC에게 맞는지 애매하면 PC가 피하는 판정(민첩 등)으로 처리해.
- 캐릭터 키는 대괄호 안의 값(user, p1, p2 …)을 써.${summaryDue ? '\n- 이번엔 summary(지금까지의 이야기)를 꼭 갱신해.' : ''}
- 이야기가 결말에 닿았으면 "end": true와 함께 에필로그를 서술해.

JSON으로 답해:
${resolveSchema(true)}`;
}

export function resultsTurn(c, results) {
  return `${gmContext(c)}

## 판정 결과 (서버가 굴림)
${results.map((r) => `- ${rollText(c, r)}`).join('\n')}

## 지금 할 일
위 판정 결과를 그대로 반영해 라운드 ${c.round}의 결과를 서술해. 성공은 원하는 걸 얻고, 실패는 대가나 새 문제를 낳아. 판정을 다시 요청하지 마.

JSON으로 답해:
${resolveSchema(false)}`;
}

// ---------------------------------------------------------------------------
// Players

export function playerBrief(c, key) {
  const seat = c.seats.find((s) => s.key === key);
  const me = BACKENDS[seat?.backend] || { label: key, maker: '' };
  return `너는 TRPG 테이블 "What Do You Do?"의 플레이어야. 이 테이블에서 너는 ${me.label}(${me.maker})이고, 네 캐릭터 키는 [${key}].
GM은 ${seatLabel(c, 'gm')}, 테이블 주인은 ${c.userName}(사람)이야. 모든 출력은 한국어로 해.

${RULES}

## 플레이어 원칙
- 너는 네 캐릭터 하나만 연기해. 다른 PC의 대사나 행동을 정하지 말고, 세계나 NPC의 반응도 지어내지 마. 그건 GM 몫이야.
- 행동은 "시도"로 선언해. 결과는 GM과 주사위가 정해. ("자물쇠를 따 본다" O / "자물쇠를 따서 문을 연다" X)
- 캐릭터의 성격·말투·목표를 지키되, 이야기가 앞으로 가게 적극적으로 움직여. 가끔은 위험을 감수하는 게 재밌어.
- 다른 PC와 엮이는 행동(돕기, 말 걸기, 의견 충돌)도 좋아. 같은 라운드에 먼저 선언한 사람의 행동을 보고 맞춰도 돼.
- 테이블 잡담(ooc)은 플레이어로서 하는 말이야. 가끔, 짧게만.
- 기억해야 할 건 note_add로 개인 메모에 적어. 메모는 너만 봐. 매 턴 이전 대화를 기억하지 못하니 메모가 네 기억이야.
- 응답은 JSON 객체 하나만. 코드블록이나 설명을 붙이지 마.`;
}

export function characterTurn(c, key, { hint, forUser } = {}) {
  const who = forUser ? `${c.userName}(사람 플레이어)의 캐릭터를 대신 만들어 줘.${hint ? ` 요청: ${hint}` : ''}` : '네 캐릭터를 만들 차례야. 이 캠페인에서 연기하고 싶은 인물을 자유롭게 정해.';
  const others = playerKeys(c).filter((k) => k !== key && c.characters[k]);
  return `## 캠페인: ${c.title}
${c.pitch}
${c.characterHint ? `\n캐릭터 참고: ${c.characterHint}\n` : ''}
${others.length ? `## 이미 정해진 동료\n${others.map((k) => `  - ${sheetLine(c.characters[k])}`).join('\n')}\n` : ''}
## 지금 할 일
${who}
- 동료와 겹치지 않는 역할이면 좋아.
- 능력치 보정치는 ${STAT_MIN}~+${STAT_MAX}, 여섯 개 합이 정확히 ${STAT_BUDGET}.
- 소지품은 3~5개, 캐릭터다운 걸로.

JSON으로 답해:
{
  "name": "이름",
  "concept": "한 줄 콘셉트 (예: 빚에 쫓기는 몰락 귀족 검사)",
  "appearance": "외모 한두 문장",
  "personality": "성격과 말투",
  "background": "배경과 이번 모험에 낀 이유 (2~3문장)",
  "stats": {${STATS.map((s) => `"${s}": 0`).join(', ')}},
  "items": ["소지품"],
  "note": "(선택) 개인 메모에 적어 둘 캐릭터 비밀이나 목표"
}`;
}

export function declareTurn(c, key) {
  const ch = c.characters[key];
  const spot = c.spotlight?.length ? c.spotlight : null;
  return `${sceneBlock(c)}

## 파티
${partyBlock(c, key)}

## 네 개인 메모 (너만 봄)
${ch?.notes || '(비어 있음)'}

## 최근 진행 (라운드 ${c.round})
${formatLog(c, recent(c, c.window), key) || '(아직 없음)'}

## 지금 할 일
네 캐릭터 ${ch?.name}(으)로 이번 라운드에 무엇을 할지 선언해.${spot ? ` (GM이 이번에 주목하는 캐릭터: ${spot.map((k) => charName(c, k)).join(', ')})` : ''}
- say: 캐릭터의 대사 (없으면 빈 문자열)
- action: 캐릭터가 시도하는 행동, 3인칭 한두 문장 (예: "카엘은 벽의 문양을 손끝으로 더듬는다")
- 이번 라운드에 할 게 정말 없으면 "pass": true

JSON으로 답해:
{"say": "", "action": "", "ooc": "", "note_add": "", "pass": false}`;
}

export { rollText };
