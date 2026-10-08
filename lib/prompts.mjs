// Prompts for the GM seat and the player seats. Every call is self-contained, like
// ai-chatroom: a brief (system prompt) plus this turn's context, answered with one JSON
// object. The GM sees its secret notes; players only see what their characters could know
// and their own private notes. Everything rule-specific comes from the campaign's rule
// module (lib/rules/).

import { BACKENDS } from './backends.mjs';
import { rulesetOf } from './rules/index.mjs';
import { Ledger, FACT_GUIDE, FACTS_FIELD, RULES_FIELD } from './facts.mjs';

const ledgerOf = (c) => new Ledger(c.facts ??= {});

export function seatLabel(c, key) {
  if (key === 'user') return `${c.userName}(사람)`;
  if (key === 'gm') return c.gm ? `${BACKENDS[c.gm.backend]?.label || c.gm.backend}` : `${c.userName}(사람)`;
  const s = c.seats.find((x) => x.key === key);
  return s ? (BACKENDS[s.backend]?.label || s.backend) : key;
}

export function charName(c, key) {
  if (key === 'gm') return rulesetOf(c).gmName;
  return c.characters[key]?.name || seatLabel(c, key);
}

function sheetLine(c, ch, { full = false } = {}) {
  let line = `${ch.name} — ${ch.concept || '?'} | ${rulesetOf(c).sheetLine(ch, { full })}`;
  if (ch.conditions?.length) line += ` | 상태: ${ch.conditions.join(', ')}`;
  if (ch.items?.length) line += ` | 소지품: ${ch.items.join(', ')}`;
  if (ch.appearance) line += `\n    외모: ${ch.appearance}`;
  if (full) {
    if (ch.personality) line += `\n    성격: ${ch.personality}`;
    if (ch.background) line += `\n    배경: ${ch.background}`;
  }
  return line;
}

export function partyBlock(c, selfKey, opts = {}) {
  const keys = playerKeys(c);
  if (!keys.length) return '(아직 캐릭터 없음)';
  return keys.map((k) => {
    const ch = c.characters[k];
    if (!ch) return `  - [${k}] (캐릭터 만드는 중) — 플레이어: ${seatLabel(c, k)}`;
    const you = k === selfKey ? ' ← 너' : '';
    return `  - [${k}] ${sheetLine(c, ch, { full: opts.full || k === selfKey })}\n    플레이어: ${seatLabel(c, k)}${you}`;
  }).join('\n');
}

export function playerKeys(c) {
  const keys = c.seats.map((s) => s.key);
  if (c.userRole === 'player') keys.unshift('user');
  return keys;
}

function foesBlock(c) {
  let s = '';
  if (c.foes?.length) {
    s += `\n\n## 적\n${c.foes.map((f) => `  - ${f.name}: HP ${f.hp}/${f.maxHp}${f.armor ? ` · 갑옷 ${f.armor}` : ''}${f.damage ? ` · 피해 ${f.damage}` : ''}${f.attack ? ` · 공격 ${f.attack}` : ''}${f.dodge ? ` · 회피 ${f.dodge}` : ''}${f.note ? ` · ${f.note}` : ''}`).join('\n')}`;
  }
  if (c.clues?.length) s += `\n\n## 단서 수첩 (모두가 앎)\n${c.clues.map((t) => `  - ${t}`).join('\n')}`;
  return s;
}

export function rollText(c, r) {
  const name = charName(c, r.who);
  if (r.kind === 'check') return rulesetOf(c).rollText(r, name);
  return `🎲 ${name}: ${r.expr} = ${r.detail} = ${r.total}${r.why ? ` (${r.why})` : ''}`;
}

// selfKey: the player whose prompt this is (null = the GM). Whispers to other players and
// the GM's own ledger notes never reach a player.
export function formatLog(c, msgs, selfKey) {
  return msgs.filter((m) => !m.ledger && (!m.to || !selfKey || m.to === selfKey)).map((m) => {
    const tag = `#${m.id}`;
    switch (m.type) {
      case 'whisper': return selfKey ? `[${tag} ${rulesetOf(c).gmName}의 귓속말 (너만 앎)] ${m.text}` : `[${tag} 귓속말 → ${charName(c, m.to)}] ${m.text}`;
      case 'narration': return `[${tag} ${rulesetOf(c).gmName} 서술]\n${m.text}`;
      case 'system': return m.clue ? `[${tag} 단서] ${m.text.replace(/^🔎 단서: /, '')}` : `[${tag} 진행] ${m.text}`;
      case 'scene': return `[${tag} 장면 전환] ${m.text}`;
      case 'declare': {
        const me = m.from === selfKey ? ' (너)' : '';
        const parts = [];
        if (m.move) parts.push(`노리는 액션: ${m.move}`);
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

const recent = (c, n) => c.log.slice(-n);

function sceneBlock(c) {
  const parts = [];
  if (c.summary) parts.push(`## 지금까지의 이야기\n${c.summary}`);
  if (c.scene?.title) parts.push(`## 현재 장면: ${c.scene.title}\n${c.scene.description || ''}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// GM

export function gmBrief(c) {
  const R = rulesetOf(c);
  return `너는 TRPG 테이블 "What Do You Do?"의 게임 마스터(${R.gmName})야. 룰은 ${R.label}. 이 테이블에서 너는 ${seatLabel(c, 'gm')}이고, 플레이어들은 사람 한 명과 여러 AI야.
모든 출력은 한국어로 해.

## 캠페인
- 전제: ${c.premise || '(아직 없음. 세계를 설계하며 네가 정한다)'}
${c.tone ? `- 분위기: ${c.tone}\n` : ''}- 테이블 주인(방장): ${c.userName}${c.userRole === 'player' ? ' — 플레이어로 참가' : ' — 관전 중'}

${R.rulesText}

## GM 원칙
- 세계와 NPC와 결과를 맡는다. 플레이어 캐릭터(PC)의 대사·생각·행동은 절대 대신 정하지 마. PC가 선언한 것의 "결과"만 서술해.
${R.gmPrinciples}
- 서술은 감각적이고 구체적으로, 3~8문장. NPC 대사는 따옴표로 서술 안에 넣어.
- 매 서술 끝은 상황을 열어 둔 채 끝내. 플레이어가 선택할 거리를 남기고, 필요하면 "어떻게 하시겠습니까?"처럼 물어.
- 스포트라이트를 고르게 나눠. 최근에 조용했던 캐릭터에게 기회를 줘.
- 비밀 메모(gm_notes)에 숨겨진 진실, NPC 동기, 단서, 시계(위협이 다가오는 정도), 다음 전개 아이디어를 적어 두고 일관성을 지켜. 메모는 플레이어에게 안 보여.
- 이야기의 길이는 정해져 있지 않다. 결말은 결말 조건이 성립하거나 캐릭터들이 이야기의 핵심 갈등을 매듭지었을 때 온다. 라운드 수를 이유로 서두르거나 마무리하지 마.
- 응답은 JSON 객체 하나만. 코드블록이나 설명을 붙이지 마.

${FACT_GUIDE}`;
}

const MARK = { known: '●', open: '○', lost: '✕', missing: '?' };
const STATUS_WORD = { known: '확보', open: '열림', lost: '소실', missing: '장부에 없음' };

function cluePaths(c, L, players) {
  return L.analyzeClues(players).map((a) => {
    const head = `[결론] ${a.name} (${a.text}): 확보 ${a.known} · 열림 ${a.open}${a.lost ? ` · 소실 ${a.lost}` : ''} / 필요 ${a.need} → ${a.deducible ? '추론 가능' : a.blocked ? '막힘' : '진행 중'}`;
    const lines = a.support.map((s) => `  ${MARK[s.status]} ${s.clue} ${STATUS_WORD[s.status]}${s.who.length ? `: ${s.who.map((k) => charName(c, k)).join(', ')}` : ''}${s.sources.length ? ` ← ${s.sources.join(', ')}` : ''}`);
    const warn = [];
    if (a.blocked) warn.push('  ⚠ 막혔다. 새 단서를 만들어 근거(...)로 잇고 출처(...)를 정해 길을 다시 열어라.');
    if (a.thin) warn.push(`  ⚠ 근거 단서가 ${a.support.length}개뿐이다. 3개 이상 깔아 둬.`);
    if (a.missing) warn.push(`  ⚠ 근거에 적힌 단서 ${a.support.filter((s) => s.status === 'missing').map((s) => s.clue).join(', ')}가 장부에 없다. 단서(이름, 내용)로 정의해.`);
    return [head, ...lines, ...warn].join('\n');
  }).join('\n');
}

function gmContext(c) {
  const L = ledgerOf(c);
  const rejected = L.s.rejected || [];
  const players = playerKeys(c);
  const ctx = { round: c.round, players, validWho: (x) => (players.includes(x) ? x : players.find((k) => c.characters[k]?.name === x) || null) };
  const rules = L.rules.map((r) => {
    const truth = L.condTruth(r, ctx).map((t) => `${t.ok ? '✓' : '✗'} ${t.text}${t.now !== undefined ? ` (지금 ${t.now})` : ''}`).join(' ∧ ');
    const fired = Object.values(r.fired || {});
    const status = fired.length ? `발동됨(라운드 ${fired.join(', ')})${r.repeat ? ', 반복' : ''}` : '대기';
    return `[r${r.id}] ${r.ending ? '[결말] ' : ''}${r.name}: ${truth}${r.then.length ? ` → ${r.then.join(' / ')}` : ''} {${status}}`;
  });
  const fresh = L.triggered;
  const endings = fresh.filter((t) => t.ending);
  return `${sceneBlock(c)}
${fresh.length ? `
## ⚡ 방금 발동한 규칙 (이번 서술에 반드시 반영해)
${fresh.map((t) => `- ${t.rule}${t.ending ? ' [결말 조건 충족]' : ''}${t.note ? `: ${t.note}` : ''}${t.changes?.length ? ` (장부: ${t.changes.join(', ')})` : ''}`).join('\n')}${endings.length ? `\n결말 조건 "${endings.map((t) => t.rule).join(', ')}"이(가) 성립했어. 이번 결과 서술에서 그 결말로 이야기를 맺고 "end": true로 끝내.` : ''}
` : ''}
## 사실 장부 ({모두}=모두 앎, {비밀}=너만 앎, {이름}=그 캐릭터가 앎)
${L.lines(L.list, { withIds: true, withKnown: true, names: (k) => charName(c, k) }).join('\n') || '(비어 있음)'}

## 단서 경로 (결론별: 확보=플레이어가 앎, 열림=아직 얻을 수 있음, 소실=막힘)
${cluePaths(c, L, players) || '(없음. 핵심 결론과 그 근거 단서 셋 이상을 장부에 깔아 둬: 결론(...), 근거(...), 단서(...), 출처(...))'}

## 규칙 (✓ 지금 성립 / ✗ 아직)
${rules.join('\n') || '(없음. 위협 시계의 단계와 결말 조건을 rules로 걸어 둬)'}
진행: 라운드 ${c.round}${L.list.filter((f) => f.p === '시계').map((f) => ` · 시계(${f.args[0]}) ${f.value}/${f.max}`).join('')}. 위협이 진행됐으면 시계를 올려라.${rejected.length ? `\n\n## 지난번에 거절된 장부 변경 (고쳐서 다시 제안해)\n${rejected.map((r) => `- ${r.op} — ${r.why}`).join('\n')}` : ''}

## 비밀 메모 (너만 봄)
${c.gmNotes || '(비어 있음)'}

## 파티
${partyBlock(c, null, { full: true })}${foesBlock(c)}

## 최근 진행 (라운드 ${c.round})
${formatLog(c, recent(c, c.window), null) || '(아직 없음)'}`;
}

// A story's front (Dungeon World's 국면): the GM gets dangers, not a plot.
function frontText(c) {
  const f = c.front;
  if (!f && !c.questions?.length) return '';
  const lines = ['## 국면 (줄거리가 아니라 위험요소다. 플레이어에게 그대로 말하지 말고, 플레이로 드러나게 해)'];
  for (const d of f?.dangers || []) {
    lines.push(`- 위험요소: ${d.name} (${d.type}${d.motive ? ` · 동기: ${d.motive}` : ''})`);
    if (d.portents.length) lines.push(`  흉조(내버려 두면 이 순서로 벌어진다): ${d.portents.join(' → ')}`);
    if (d.doom.text) lines.push(`  재앙: ${d.doom.text}${d.doom.type ? ` (${d.doom.type})` : ''}`);
  }
  if (f?.clock) lines.push(`- 시간: ${f.clock}`);
  if (f?.cast?.length) lines.push(`- 등장인물: ${f.cast.join(', ')}`);
  if (f?.blank) lines.push(`- 빈칸(정하지 마. 플레이하며 정한다): ${f.blank}`);
  if (c.questions?.length) lines.push(`- 이야기가 답할 질문(답을 미리 정하지 마. gm_notes에 적어 두고 플레이로 알아낸다): ${c.questions.join(' / ')}`);
  if (f?.dangers?.length) lines.push('위험요소마다 위협 시계를 하나씩 두고, 흉조를 시계 단계마다 일어나는 사건으로, 재앙을 그 시계가 다 찼을 때의 나쁜 결말 규칙으로 걸어. 좋은 결말은 위험요소가 막히거나 풀리는 조건으로 걸어. 빈칸은 facts에도 정하지 마.');
  return `${lines.join('\n')}\n\n`;
}

// How big a story to design. It is a hint for the ending conditions, never a round limit.
const LENGTH_HINT = {
  short: '짧은 모험. 한 번 앉아서 끝낼 만한 크기다. 결말 조건을 몇 번의 큰 진전으로 닿을 만큼 가깝게 걸어 둬.',
  long: '긴 모험. 여러 번에 걸쳐 할 크기다. 중간 목표와 반전을 두고, 결말 조건을 멀리 걸어 둬.',
};

export function worldbuildTurn(c) {
  return `새 캠페인을 준비할 차례야. 전제를 바탕으로 세계·사건·첫 장면을 설계해.
${c.premise ? `전제: ${c.premise}` : `전제: (비어 있음) 방장이 너에게 맡겼다. ${rulesetOf(c).label}에 어울리는 전제를 네가 정해. 뻔한 설정보다 구체적이고 끌리는 갈고리가 하나 있게.`}
${c.tone ? `분위기: ${c.tone}` : '분위기: (비어 있음) 전제에 어울리는 분위기를 네가 정해.'}
${c.title ? `제목: ${c.title} (이미 정해졌다. 그대로 써.)\n` : ''}${c.opening ? `첫 장면: ${c.opening}\n이 장면에서 이야기를 시작해. scene은 이 장면이어야 한다.\n` : ''}${c.length ? `이야기 규모: ${LENGTH_HINT[c.length]}\n` : ''}플레이어 수: ${playerKeys(c).length}명

${frontText(c)}위협 시계의 단계별 트리거와, 서로 다른 결말 조건(좋은·나쁜) 둘 이상을 rules로 걸어 둬. 규칙의 조건과 결과는 facts에 쓰는 이름(인물·물건·시계 이름)과 정확히 같아야 한다.
이야기의 길이는 정해져 있지 않다. 위협 시계는 이야기 속에서 위협이 진행될 때(실패, 흘려보낸 시간, 무시한 징조) 올라가고, 결말은 결말 조건이 성립할 때 온다.

JSON으로 답해:
{
${c.premise ? '' : '  "premise": "네가 정한 전제 (한두 문장)",\n'}${c.tone ? '' : '  "tone": "네가 정한 분위기 (짧게)",\n'}  "title": "캠페인 제목",
  "pitch": "플레이어에게 공개하는 소개 (3~5문장. 배경, 분위기, 캐릭터들이 모인 이유)",
  "character_hint": "캐릭터를 만들 때 참고할 점 (어떤 인물이 어울리는지, 한두 문장)",
  "rules": [
    {"name": "새 실종자", "when": ["시계(의식) >= 3"], "then": ["사건(실종, 또 한 명이 사라진다)"], "note": "누구를 사라지게 할지는 네가 정해"},
    {"name": "의식 시작", "when": ["시계(의식) >= 6"], "then": ["사건(의식, 의식이 시작된다)"]},
    {"name": "결말: 봉인", "when": ["상태(검은 조각상, 바다에 가라앉음)", "not 사망(노라)"], "ending": true, "note": "좋은 결말"},
    {"name": "결말: 진실 폭로", "when": ["추론가능(범인)", "사건(폭로)"], "ending": true, "note": "진실을 밝혀낸 결말"},
    {"name": "결말: 바다의 부름", "when": ["사건(의식)", "not 상태(검은 조각상, 바다에 가라앉음)"], "ending": true, "note": "나쁜 결말"}
  ],
  "facts": ["핵심 결론 1~3개와 결론마다 근거 단서 3개 이상, 단서마다 출처를 꼭 포함해: 결론(범인, 말로우가 인부들을 제물로 바친다), 근거(범인, 장부), 단서(장부, 실종자 모두 야간 하역 인부), 출처(장부, 제7창고) …", "사실 장부의 첫 사실들 (12~30개): 주요 인물·장소·물건, 숨은 진실과 비밀, 단서 3개 이상, 인물의 목표와 관계, 위협 시계. 예: 인물(말로우, 해운업자), 비밀(말로우, 바다 밑 존재와 계약), 단서(장부, 실종자 모두 야간 하역 인부), 시계(의식) = 0/6"],
  "gm_notes": "장부에 담기 어려운 것만: 연출 아이디어, 분위기, 예상 클라이맥스",
  "scene": {"title": "첫 장면 이름", "description": "장소와 상황 요약 (2~3문장)"}
}`;
}

const FOES_FIELD = '"foes": [{"name": "적 이름", "hp": 6, "armor": 1, "damage": "d6", "note": "짧은 특징", "remove": false}]';

export function openingTurn(c) {
  return `${gmContext(c)}

## 지금 할 일
캐릭터가 모두 정해졌어. 첫 장면을 열어.${c.opening ? ` 첫 장면은 이미 정해졌다: ${c.opening}` : ''}${c.openingAsk ? ` 서술 끝에 플레이어들에게 이 질문을 던지고, 그 대답을 세계에 써: "${c.openingAsk}"` : ''} 장소를 묘사하고, 캐릭터들이 왜 여기 있는지 자연스럽게 엮고, 곧바로 무언가 일이 벌어지게 해. 끝은 플레이어들이 행동을 고를 수 있게 열어 둬.

JSON으로 답해:
{
  "narration": "오프닝 서술 (5~10문장)",
  "foes": [{"name": "(선택) 이미 등장한 적", "hp": 6, "armor": 1, "damage": "d6", "note": "짧은 특징"}],
  ${FACTS_FIELD},
  ${RULES_FIELD},
  "gm_notes": "(선택) 비밀 메모를 고쳐 쓸 거면 전체 새 버전",
  "spotlight": ["(선택) 다음에 주로 행동할 캐릭터 키. 비우면 전원"]
}`;
}

function resolveSchema(c, withChecks) {
  const R = rulesetOf(c);
  const extra = R.effectSchema ? `, ${R.effectSchema}` : '';
  const more = R.extraSchema ? `\n  ${R.extraSchema},` : '';
  return `{
${withChecks ? `  "checks": [${R.checkSchema}],
  "narration": "판정이 있으면: 굴리기 직전의 짧은 긴장 묘사(1~2문장)만. 판정이 없으면: 결과 서술 전체",
` : `  "narration": "판정 결과를 반영한 결과 서술 (3~8문장)",
`}  "effects": [{"who": "캐릭터 키", "hp": 0, "damage": "(선택) 피해 주사위 예: d6", "ignore_armor": false, "items_add": [], "items_remove": [], "conditions_add": [], "conditions_remove": []${extra}}],
  ${R.foeSchema || FOES_FIELD},${more}
  ${FACTS_FIELD},
  ${RULES_FIELD},
  "scene": {"title": "장면이 바뀌었을 때만", "description": "새 장면 요약"},
  "summary": "(선택) '지금까지의 이야기'를 갱신할 때 전체 새 버전 (5~10문장)",
  "gm_notes": "(선택) 비밀 메모를 고쳐 쓸 때 전체 새 버전",
  "spotlight": ["(선택) 다음 라운드에 행동할 캐릭터 키. 비우면 전원"],
  "end": false
}`;
}

const EFFECT_GUIDE = `- effects: hp는 회복(+)이나 정해진 숫자 변화, damage는 서버가 굴릴 피해 주사위(갑옷만큼 감소). 바뀐 게 없으면 빈 배열.
- foes: 새로 나타난 적은 추가, 바뀐 적은 같은 이름으로 다시 적고, 사라지거나 쓰러진 적은 "remove": true. 바뀐 게 없으면 생략.`;

export function adjudicateTurn(c) {
  const R = rulesetOf(c);
  const keys = c.spotlight?.length ? c.spotlight : playerKeys(c);
  const summaryDue = c.round > 0 && c.round % 4 === 0;
  return `${gmContext(c)}

## 지금 할 일 (라운드 ${c.round} 처리)
이번 라운드의 플레이어 선언이 위 기록에 있어 (행동할 캐릭터: ${keys.map((k) => `[${k}] ${charName(c, k)}`).join(', ')}).
${R.checkGuide}
- 판정이 있으면 서버가 주사위를 굴리고(필요하면 플레이어가 선택지까지 고른 뒤) 결과를 주며 다시 물어볼 테니, 이번엔 결과를 서술하지 마.
- 판정이 하나도 필요 없으면 checks를 빈 배열로 두고 결과까지 서술해.
- 캐릭터 키는 대괄호 안의 값(user, p1, p2 …)을 써.
${EFFECT_GUIDE}${summaryDue ? '\n- 이번엔 summary(지금까지의 이야기)를 꼭 갱신해.' : ''}
- 이야기가 결말에 닿았으면 "end": true와 함께 에필로그를 서술해.

JSON으로 답해:
${resolveSchema(c, true)}`;
}

export function resultsTurn(c, results) {
  return `${gmContext(c)}

## 판정 결과 (서버가 굴림)
${results.map((r) => `- ${rollText(c, r)}`).join('\n')}

## 지금 할 일
위 판정 결과를 그대로 반영해 라운드 ${c.round}의 결과를 서술해. 결과 등급이 말하는 대로(성공은 원하는 걸, 부분 성공은 대가와 함께, 실패는 네 무브로). 플레이어가 고른 선택지나 질문이 있으면 서술 안에서 반드시 반영하고 답해. 판정을 다시 요청하지 마.
${EFFECT_GUIDE}

JSON으로 답해:
${resolveSchema(c, false)}`;
}

// ---------------------------------------------------------------------------
// Players

export function playerBrief(c, key) {
  const R = rulesetOf(c);
  const seat = c.seats.find((s) => s.key === key);
  const me = BACKENDS[seat?.backend] || { label: key, maker: '' };
  return `너는 TRPG 테이블 "What Do You Do?"의 플레이어야. 룰은 ${R.label}. 이 테이블에서 너는 ${me.label}(${me.maker})이고, 네 캐릭터 키는 [${key}].
GM은 ${seatLabel(c, 'gm')}, 테이블 주인은 ${c.userName}(사람)이야. 모든 출력은 한국어로 해.

${R.rulesText}

## 플레이어 원칙
- 너는 네 캐릭터 하나만 연기해. 다른 PC의 대사나 행동을 정하지 말고, 세계나 NPC의 반응도 지어내지 마. 그건 GM 몫이야.
${R.playerPrinciples}
- 캐릭터의 성격·말투·목표를 지키되, 이야기가 앞으로 가게 적극적으로 움직여. 가끔은 위험을 감수하는 게 재밌어.
- 다른 PC와 엮이는 행동(돕기, 말 걸기, 의견 충돌)도 좋아. 같은 라운드에 먼저 선언한 사람의 행동을 보고 맞춰도 돼.
- 테이블 잡담(ooc)은 플레이어로서 하는 말이야. 가끔, 짧게만.
- 기억해야 할 건 note_add로 개인 메모에 적어. 메모는 너만 봐. 매 턴 이전 대화를 기억하지 못하니 메모가 네 기억이야.
- 응답은 JSON 객체 하나만. 코드블록이나 설명을 붙이지 마.`;
}

export function characterTurn(c, key, { hint, forUser, preroll } = {}) {
  const task = rulesetOf(c).characterTask(c, { key, forUser, preroll });
  const who = forUser ? `${c.userName}(사람 플레이어)의 캐릭터를 대신 만들어 줘.${hint ? ` 요청: ${hint}` : ''}` : '네 캐릭터를 만들 차례야. 이 캠페인에서 연기하고 싶은 인물을 자유롭게 정해.';
  const others = playerKeys(c).filter((k) => k !== key && c.characters[k]);
  return `## 캠페인: ${c.title}
${c.pitch}
${c.characterHint ? `\n캐릭터 참고: ${c.characterHint}\n` : ''}
${others.length ? `## 이미 정해진 동료\n${others.map((k) => `  - ${sheetLine(c, c.characters[k])}`).join('\n')}\n` : ''}
## 지금 할 일
${who}
- 동료와 겹치지 않는 역할이면 좋아.
${task.rules}

JSON으로 답해:
${task.shape}`;
}

export function bondsTurn(c, key) {
  const ch = c.characters[key];
  const others = playerKeys(c).filter((k) => k !== key && c.characters[k]).map((k) => ({ key: k, name: c.characters[k].name, concept: c.characters[k].concept }));
  return `## 캠페인: ${c.title}
${c.pitch}

## 파티
${partyBlock(c, key)}

${rulesetOf(c).bondsTask(c, key, { charName: ch.name, others })}`;
}

function knownBlock(c, key) {
  const L = ledgerOf(c);
  return L.lines(L.visibleTo(key)).join('\n') || '(아직 없음)';
}

export function declareTurn(c, key) {
  const ch = c.characters[key];
  const spot = c.spotlight?.length ? c.spotlight : null;
  const moveField = c.rules === 'dw' ? ', "move": "(선택) 노리는 액션"' : '';
  return `${sceneBlock(c)}

## 파티
${partyBlock(c, key)}${foesBlock(c)}

## 네 개인 메모 (너만 봄)
${ch?.notes || '(비어 있음)'}

## 네 캐릭터가 아는 사실
${knownBlock(c, key)}

## 최근 진행 (라운드 ${c.round})
${formatLog(c, recent(c, c.window), key) || '(아직 없음)'}

## 지금 할 일
네 캐릭터 ${ch?.name}(으)로 이번 라운드에 무엇을 할지 선언해.${spot ? ` (GM이 이번에 주목하는 캐릭터: ${spot.map((k) => charName(c, k)).join(', ')})` : ''}
- say: 캐릭터의 대사 (없으면 빈 문자열)
- action: 캐릭터가 시도하는 행동, 3인칭 한두 문장 (예: "카엘은 벽의 문양을 손끝으로 더듬는다")
- 이번 라운드에 할 게 정말 없으면 "pass": true

JSON으로 답해:
{"say": "", "action": ""${moveField}, "ooc": "", "note_add": "", "pass": false}`;
}

// A roll left this player a choice (e.g. Dungeon World 7–9 options).
export function chooseTurn(c, key, choice, roll) {
  return `${sceneBlock(c)}

## 파티
${partyBlock(c, key)}${foesBlock(c)}

## 최근 진행
${formatLog(c, recent(c, 12), key)}

## 네 캐릭터가 아는 사실
${knownBlock(c, key)}

## 방금 네 판정
${rollText(c, roll)}

## 지금 할 일
${choice.prompt}
${choice.options.map((o, i) => `  ${i}. ${o}`).join('\n')}

정확히 ${choice.count}개를 번호로 골라. 캐릭터와 상황에 맞게.${choice.textFor >= 0 ? `\n${choice.textFor}번을 고르면 "reason"에 ${choice.textLabel || '이유'}를 캐릭터 행동으로 한 문장 적어.` : ''}
JSON으로 답해:
{"choices": [0], "reason": "", "note_add": ""}`;
}
