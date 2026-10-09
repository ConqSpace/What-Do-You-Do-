// Prompts for the GM seat and the player seats. Every call is self-contained, like
// ai-chatroom: a brief (system prompt) plus this turn's context, answered with one JSON
// object. The GM sees its secret notes; players only see what their characters could know
// and their own private notes. Everything rule-specific comes from the campaign's rule
// module (lib/rules/).

import { BACKENDS } from './backends.mjs';
import { rulesetOf } from './rules/index.mjs';
import { fixJosa } from './parse.mjs';
import { Ledger, FACT_GUIDE, FACTS_FIELD, RULES_FIELD } from './facts.mjs';
import { downBlock } from './down.mjs';
import { partsOf } from './post.mjs';

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

// A boss's phase on its hidden clock: 1, then 2 from 3/8, 3 from 6/8 (scaled to its size).
export function bossMarks(b) {
  return [Math.round((b.clock * 3) / 8), Math.round((b.clock * 6) / 8)];
}
export function bossPhase(b) {
  return 1 + bossMarks(b).filter((m) => b.progress >= m).length;
}

// A boss shows no numbers to anyone at the table; the GM's own clock is in bossBlock.
function foesBlock(c) {
  let s = '';
  if (c.foes?.length) {
    s += `\n\n## 적\n${c.foes.map((f) => (f.boss
      ? `  - ${f.name} (보스${f.down ? ', 쓰러짐' : ''})${f.damage ? ` · 피해 ${f.damage}` : ''}${f.note ? ` · ${f.note}` : ''}`
      : `  - ${f.name}: HP ${f.hp}/${f.maxHp}${f.armor ? ` · 갑옷 ${f.armor}` : ''}${f.damage ? ` · 피해 ${f.damage}` : ''}${f.attack ? ` · 공격 ${f.attack}` : ''}${f.dodge ? ` · 회피 ${f.dodge}` : ''}${f.note ? ` · ${f.note}` : ''}`)).join('\n')}`;
  }
  if (c.clues?.length) s += `\n\n## 단서 수첩 (모두가 앎)\n${c.clues.map((t) => `  - ${t}`).join('\n')}`;
  return s;
}

export function rollText(c, r) {
  const name = charName(c, r.who);
  if (r.kind === 'check') return rulesetOf(c).rollText(r, name);
  return `🎲 ${name}: ${r.expr} = ${r.detail} = ${r.total}${r.why ? ` (${r.why})` : ''}`;
}

// How a player's message reads in a prompt (see POST_NOTATION): "speech", @action, the rest
// the player's own words; then the move they named and the one the GM put it to.
function postLine(c, m, selfKey, tag) {
  const who = m.from === 'user' && !c.characters.user ? seatLabel(c, 'user') : charName(c, m.from);
  const bits = partsOf(m).map((p) => (p.k === 'say' ? `"${p.text}"` : p.k === 'act' ? `@${p.text}` : p.answer ? `(질문에 답) ${p.text}` : p.text));
  const tags = [];
  if (m.move) tags.push(`부른 액션: ${m.move}`);
  if (m.check) tags.push(`판정: ${m.check.was ? `${m.check.was} → ` : ''}${m.check.move}`);
  return `[${tag} ${who}${m.from === selfKey ? ' (너)' : ''}] ${bits.join(' / ') || '(아무 말 없음)'}${tags.length ? ` {${tags.join(' · ')}}` : ''}`;
}

// Read by the GM and the players alike.
// A playtest note from the person running the table, added to the GM's next story turn.
export const directorNote = (text) => `## 방장 지시 (최우선)
테이블 밖에서 이 게임을 운영하는 방장이 직접 내린 연출 지시다. 이번 응답에서 무엇보다 먼저 따른다. 플레이어들은 이 지시를 모른다: 지시가 있었다는 티를 내지 말고, 이야기 속 일로 자연스럽게 풀어라.
${text}`;

export const POST_NOTATION = `플레이어의 메시지는 세 가지가 섞인다: "따옴표" 안은 캐릭터가 소리 내어 한 말(그 자리의 모두가 듣는다), @로 시작하는 건 캐릭터가 하려는 행동(의도일 뿐, 결과는 마스터가 정한다), 나머지 글은 플레이어가 테이블에서 자기로서 하는 말(캐릭터는 못 듣는다).`;

// selfKey: the player whose prompt this is (null = the GM). Whispers to other players and
// the GM's own ledger notes never reach a player. The AI players' reactions to each other
// are table banter, not the GM's business: they stay out of the GM's log.
export function formatLog(c, msgs, selfKey) {
  // The setup line carries the premise as given to the GM; players hear the GM's own introduction.
  const shown = (m) => !m.ledger && !(selfKey && m.setup) && (!m.to || !selfKey || m.to === selfKey) && (selfKey || !['react', 'reply'].includes(m.chat));
  return joinBeats(msgs.filter(shown)).map((m) => {
    const tag = `#${m.id}`;
    switch (m.type) {
      case 'whisper': return selfKey ? `[${tag} ${rulesetOf(c).gmName}의 귓속말 (너만 앎)] ${m.text}` : `[${tag} 귓속말 → ${charName(c, m.to)}] ${m.text}`;
      case 'narration': return `[${tag} ${rulesetOf(c).gmName} 서술]\n${m.text}`;
      case 'npc': return `[${tag} NPC ${m.name}] "${m.text}"`;
      case 'system': return m.clue ? `[${tag} 단서] ${m.text.replace(/^🔎 단서: /, '')}` : `[${tag} 진행] ${m.text}`;
      case 'scene': return `[${tag} 장면 전환] ${m.text}`;
      // A player's message; older saves' declarations, OOC lines and party talk read the same.
      case 'player': case 'declare': case 'ooc': case 'talk': return postLine(c, m, selfKey, tag);
      case 'roll': return `[${tag}] ${rollText(c, m.roll)}`;
      default: return `[${tag} 진행] ${m.text}`;
    }
  }).join('\n');
}

// The last n messages, counting the beats of one GM speech as one. The AI players' table
// talk rides along without counting, so it never pushes the story out of the window.
const recent = (c, n) => {
  const log = c.log;
  let i = log.length;
  while (i > 0 && n > 0) if (!log[--i].cont && !log[i].chat) n--;
  return log.slice(i);
};

// Beats of one GM speech read as one block in prompts.
const joinBeats = (msgs) => msgs.reduce((out, m) => {
  const last = out[out.length - 1];
  if (m.cont && m.type !== 'npc' && last && last.type === m.type && last.from === m.from) out[out.length - 1] = { ...last, text: `${last.text} ${m.text}` };
  else out.push(m);
  return out;
}, []);

function sceneBlock(c) {
  const parts = [];
  if (c.summary) parts.push(`## 지금까지의 이야기\n${c.summary}`);
  if (c.scene?.title) parts.push(`## 현재 장면: ${c.scene.title}\n${c.scene.description || ''}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// GM

// The house rules this campaign plays with, as lines under the rules.
function houseText(c) {
  const t = rulesetOf(c).houseText || {};
  const on = Object.keys(t).filter((k) => c.house?.[k]);
  return on.map((k) => `\n- 하우스 룰: ${t[k]}`).join('');
}

export function gmBrief(c) {
  const R = rulesetOf(c);
  return `너는 TRPG 테이블 "What Do You Do?"의 게임 마스터(${R.gmName})야. 룰은 ${R.label}. 이 테이블에서 너는 ${seatLabel(c, 'gm')}이고, 플레이어들은 사람 한 명과 여러 AI야.
모든 출력은 한국어로 해.

## 캠페인
- 전제: ${c.premise || '(아직 없음. 세계를 설계하며 네가 정한다)'}
${c.tone ? `- 분위기: ${c.tone}\n` : ''}${c.gmOnly ? `- 너만 아는 설정 (플레이어에게 그대로 말하지 말고 플레이로 드러나게 해): ${c.gmOnly}\n` : ''}- 테이블 주인(방장): ${c.userName}${c.userRole === 'player' ? ' — 플레이어로 참가' : ' — 관전 중'}

${R.rulesText}${houseText(c)}

## GM 원칙
- 세계와 NPC와 결과를 맡는다. 플레이어 캐릭터(PC)의 대사·생각·행동은 절대 대신 정하지 마. PC가 선언한 것의 "결과"만 서술해.
${R.gmPrinciples}
- 사람이 소리 내어 읽어 주는 걸 듣는다고 생각하고 써. 마스터의 말은 짧다. 한 차례의 결과 서술은 1~3문장, 대개 한두 문장(150자 안팎)이면 충분하다. 한 번에 다 보여 주지 말고 다음 서술로 남겨.
  · 한 문장에 주어 하나, 일 하나. "~자, ~고, ~며"로 여러 사람의 움직임을 한 문장에 잇지 마.
  · 눈에 보이고 귀에 들리는 것을 쉬운 말로. 꾸밈말과 비유는 한 서술에 하나면 된다.
  · 플레이어가 방금 선언한 행동을 다시 말하지 마. 그 행동이 낳은 결과부터 써.
- 마스터로서 하는 말은 테이블의 플레이어들에게 들려주는 말이다. 서술, 소개(pitch), 귓속말, 질문 모두 "~니다/~습니다"체로 해. ("화살 한 대가 하르간의 발치에 박힙니다." / "엘라, 어떻게 하시겠습니까?") 소설처럼 "~다"로 끝내지 마.
- NPC의 말은 서술 문장 안에 넣지 마. 줄을 바꿔 \`이름: "대사"\` 한 줄로 따로 쓰면, 화면에 그 NPC의 말풍선으로 나간다. 한 줄에 대사 하나, 1~2문장. 한 차례에 NPC 대사는 많아야 두 줄.
- NPC 이름은 짧고 서로 헷갈리지 않게 지어. 같은 무리여도 "가운데·왼쪽 고블린"처럼 위치로 가르지 말고, 눈에 띄는 특징으로 이름을 붙여(뾰족귀, 애꾸, 쇠사슬). 한 번 붙인 이름은 바꾸지 마.
- NPC 대사만은 "~니다"체가 아니라 그 인물의 말투로 해. 겁먹은 고블린은 더듬고 짧게, 늙은 촌장은 느릿한 하게체, 거만한 귀족은 하대로. 인물마다 말투를 정하면 끝까지 지켜.
  예: 피 묻은 손잡이가 놈의 허리춤에서 흔들립니다.\\n뾰족귀: "내, 내려가! 산, 우리 거!"\\n어떻게 하시겠습니까?
- ${POST_NOTATION}
  · 따옴표 안의 말에는 NPC가 반응한다. @행동은 캐릭터의 시도로 해석해 결과를 그린다.
  · 따옴표도 @도 없는 글은 플레이어의 말이다. NPC는 그 말을 듣지 못하고, 세계에서 일어난 일도 아니다. 다만 차례인 플레이어의 말은 대개 너에게 하는 말이다: 질문("로발트가 누워 있나요?"), 하려는 것("매직 미사일로 주의를 돌려 볼게요"), 액션 요청("지식 굴림 할게요"). 그렇게 받아.
  · 네가 던진 질문에 플레이어가 답했으면(질문에 답) 그 답을 세계의 사실로 받아들여 써.
${FICTION_TEXT[c.gmStyle] || FICTION_TEXT.strict}
- 테이블은 한 명씩 돈다. 차례인 플레이어가 행동하면 그 결과만 서술하고, 서술 끝에서 다음 캐릭터에게 이름을 불러 직접 물어("엘라, 어떻게 하시겠습니까?" / "로발트는 뭘 하죠?"). 다음 사람은 앞사람의 결과를 보고 움직인다.
- 스포트라이트를 고르게 나눠. 방금 결과로 위험해진 사람이나 최근에 조용했던 캐릭터에게 넘겨.
- 비밀 메모(gm_notes)에 숨겨진 진실, NPC 동기, 단서, 시계(위협이 다가오는 정도), 다음 전개 아이디어를 적어 두고 일관성을 지켜. 메모는 플레이어에게 안 보여.
- 이야기의 길이는 정해져 있지 않다. 결말은 결말 조건이 성립하거나 캐릭터들이 이야기의 핵심 갈등을 매듭지었을 때 온다. 라운드 수를 이유로 서두르거나 마무리하지 마.
- 장면은 다르다. 한 장면은 몇 라운드 안에 매듭짓고 다음 장면으로 자른다. 한자리에서 문제를 계속 덧쌓으면 이야기가 멈춘다.
- 응답은 JSON 객체 하나만. 코드블록이나 설명을 붙이지 마.

${STYLE_TEXT[c.gmStyle] || STYLE_TEXT.strict}

${FACT_GUIDE}`;
}

// The GM's view of each boss's clock, with what the GM must show this turn.
function bossBlock(c) {
  const bosses = (c.foes || []).filter((f) => f.boss);
  if (!bosses.length) return '';
  const lines = bosses.map((b) => {
    if (b.down) return `- ${b.name}: 쓰러짐`;
    const [m2, m3] = bossMarks(b);
    const now = b.news === 'down' ? '\n  ⚡ 진행이 다 찼다. 이번 서술에서 보스를 쓰러뜨려라.'
      : b.news === 'phase' ? `\n  ⚡ 방금 ${bossPhase(b)}단계로 넘어갔다. 이번 서술에서 보스가 달라지는 모습을 보여 줘(새 약점, 새 공격 방식).` : '';
    return `- ${b.name}: 진행 ${b.progress}/${b.clock} · ${bossPhase(b)}단계 (2단계 ${m2}칸, 3단계 ${m3}칸, 쓰러짐 ${b.clock}칸)${now}`;
  });
  const dry = c.bossDry >= 4 && bosses.some((b) => !b.down)
    ? `\n⚠ 보스 진행 없이 판정이 ${c.bossDry}번 지났다. 플레이어가 보스를 상대하는 행동이었다면 checks에 "against"를 꼭 적어.` : '';
  return `\n\n## 보스 진행 (서버가 센다. 플레이어는 모른다. 숫자로 말하지 말고 서술로 보여 줘)\n${lines.join('\n')}${dry}`;
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

// How long a scene may run before the GM is told to close it: past `push` rounds every result
// should move toward the scene's end, at `cut` the scene ends this turn. In play, three goblin
// scouts at a mine mouth took ten rounds, each miss heaping a new trouble on the same spot.
// A short story is three or four scenes, so its scenes close sooner.
export const SCENE_ROUNDS = { short: { push: 2, cut: 4 }, long: { push: 5, cut: 8 } };
const SCENE_DEFAULT = { push: 4, cut: 6 };

export function sceneAge(c) {
  return Math.max(0, (c.round || 0) - (c.sceneSince || 0));
}

function scenePace(c) {
  if (!c.scene?.title) return '';
  const { push, cut } = SCENE_ROUNDS[c.length] || SCENE_DEFAULT;
  const age = sceneAge(c);
  if (age >= cut) return `\n\n## ⚠ 장면 길이: "${c.scene.title}" ${age}라운드째, 너무 길다
- 이번 결과로 이 장면을 끝내. 장면의 일을 매듭짓거나(적이 달아나거나 무너진다, 찾던 걸 손에 넣는다) 일행을 다음 장소로 보내고, scene에 다음 장면을 적어.
- 판정이 걸려 있으면 그 결과가 성공이든 실패든 장면을 끝내는 쪽으로 서술해. 실패면 나쁜 쪽으로 끝난다(쫓겨 들어간다, 갈라진다, 놓친다).`;
  if (age >= push) return `\n\n## 장면 길이: "${c.scene.title}" ${age}라운드째
- 이 장면은 할 만큼 했다. 결과마다 매듭 쪽으로 몰아라: 성공은 장면의 목표에 성큼 다가가게 하고, 실패도 일행을 다음 국면으로 떠민다(더 깊이 끌려간다, 쫓긴다, 숨긴 게 드러난다).
- 이 자리에 새 적이나 새 장애물을 더 얹지 마. 장면이 끝나면 scene에 다음 장면을 적어.`;
  return '';
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
진행: 라운드 ${c.round}${L.list.filter((f) => f.p === '시계').map((f) => ` · 시계(${f.args[0]}) ${f.value}/${f.max}`).join('')}. 위협이 진행됐으면 시계를 올려라.${scenePace(c)}${rejected.length ? `\n\n## 지난번에 거절된 장부 변경 (고쳐서 다시 제안해)\n${rejected.map((r) => `- ${r.op} — ${r.why}`).join('\n')}` : ''}

## 비밀 메모 (너만 봄)
${c.gmNotes || '(비어 있음)'}

## 파티
${partyBlock(c, null, { full: true })}${downBlock(c)}${foesBlock(c)}${bossBlock(c)}

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
  short: '짧은 모험. 한 번 앉아서 끝낼 크기다. 장면 3~4개 안에 결말에 닿게 짜. 위협 시계는 4칸 이하로 두고, 결말 조건은 큰 진전 한두 번이면 닿을 만큼 가깝게 걸어 둬. 중간 목표나 반전을 따로 두지 마.',
  long: '긴 모험. 여러 번에 걸쳐 할 크기다. 중간 목표와 반전을 두고, 결말 조건을 멀리 걸어 둬.',
};

export function worldbuildTurn(c) {
  return `새 캠페인을 준비할 차례야. 전제를 바탕으로 세계·사건·첫 장면을 설계해.
${c.premise ? `전제: ${c.premise}` : `전제: (비어 있음) 방장이 너에게 맡겼다. ${rulesetOf(c).label}에 어울리는 전제를 네가 정해. 뻔한 설정보다 구체적이고 끌리는 갈고리가 하나 있게.`}
${c.tone ? `분위기: ${c.tone}` : '분위기: (비어 있음) 전제에 어울리는 분위기를 네가 정해.'}
${c.title ? `제목: ${c.title} (이미 정해졌다. 그대로 써.)\n` : ''}${c.opening ? `첫 장면: ${c.opening}\n이 장면에서 이야기를 시작해. scene은 이 장면이어야 한다.\n` : ''}${c.length ? `이야기 규모: ${LENGTH_HINT[c.length]}\n` : ''}플레이어 수: ${playerKeys(c).length}명

${frontText(c)}위협 시계의 단계별 트리거와, ${c.length === 'short' ? '좋은 결말 하나와 나쁜 결말 하나를' : '서로 다른 결말 조건(좋은·나쁜) 둘 이상을'} rules로 걸어 둬. 규칙의 조건과 결과는 facts에 쓰는 이름(인물·물건·시계 이름)과 정확히 같아야 한다.
이야기의 길이는 정해져 있지 않다. 위협 시계는 이야기 속에서 위협이 진행될 때(실패, 흘려보낸 시간, 무시한 징조) 올라가고, 결말은 결말 조건이 성립할 때 온다.
보스가 있는 이야기라면: 보스는 HP가 없고 서버가 세는 진행 시계(파티 인원에 맞춘 칸 수, 3/8·6/8 지점에서 단계가 바뀜)가 다 차야 쓰러진다. 장부에 보스 진행용 시계를 따로 만들지 마. 단계 전환은 서버가 알려 준다. 단계마다 다른 공략(약점과 그걸 드러내는 방법)을 gm_notes에 적어 두고, 보스를 이기는 결말은 상태(보스 이름, 쓰러짐)을 조건으로 걸어.

JSON으로 답해:
{
${c.premise ? '' : '  "premise": "네가 정한 전제 (한두 문장)",\n'}${c.tone ? '' : '  "tone": "네가 정한 분위기 (짧게)",\n'}  "title": "캠페인 제목",
  "pitch": "플레이어에게 들려주는 소개 (3~5문장, ~니다체. 배경, 분위기, 캐릭터들이 모인 이유)",
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

const FOES_FIELD = '"foes": [{"name": "적 이름", "hp": 10, "armor": 1, "damage": "d6", "note": "짧은 특징", "remove": false}, {"name": "(보스일 때) 보스 이름", "boss": true, "damage": "d10", "note": "짧은 특징"}]';

export function openingTurn(c) {
  return `${gmContext(c)}

## 지금 할 일
캐릭터가 모두 정해졌어. 첫 장면을 열어.${c.opening ? ` 첫 장면은 이미 정해졌다: ${c.opening}` : ''}${c.openingAsk ? ` 서술 끝에 플레이어들에게 이 질문을 던지고, 그 대답을 세계에 써: "${c.openingAsk}"` : ''} 장소를 묘사하고, 캐릭터들이 왜 여기 있는지 자연스럽게 엮고, 곧바로 무언가 일이 벌어지게 해. 끝은 플레이어들이 행동을 고를 수 있게 열어 둬.
보스가 이미 나와 있으면 foes에 보스로 올려:
${BOSS_GUIDE}

JSON으로 답해:
{
  "narration": "오프닝 서술 (4~5문장, 300자 안팎)",
  "foes": [{"name": "(선택) 이미 등장한 적", "hp": 6, "armor": 1, "damage": "d6", "note": "짧은 특징"}, {"name": "(보스일 때) 보스 이름", "boss": true, "damage": "d10", "note": "짧은 특징"}],
  ${FACTS_FIELD},
  ${RULES_FIELD},
  "gm_notes": "(선택) 비밀 메모를 고쳐 쓸 거면 전체 새 버전",
  "spotlight": ["(선택) 다음에 주로 행동할 캐릭터 키. 비우면 전원"]
}`;
}

// Characters whose turn hasn't come yet this round (not counting the one being resolved).
function turnsLeft(c) {
  return (c.order || []).filter((k) => !c.acted?.[k] && k !== c.resolve?.who);
}

function turnGuide(c, left) {
  if (left.length) return `- 결과를 서술하면 차례를 넘겨. 아직 차례가 안 온 캐릭터: ${left.map((k) => `[${k}] ${charName(c, k)}`).join(', ')}. 그중 한 명의 키를 next에 적고, 서술 끝에서 그 캐릭터에게 직접 물어.`;
  return `- 이번이 라운드 ${c.round}의 마지막 차례다. 서술 끝은 모두에게 열어 두고, 다음 라운드에 주목할 캐릭터가 있으면 spotlight에 적어.`;
}

// May the GM answer this player's turn with a short answer that keeps the turn? Twice a turn
// at most, and an easy GM never on a turn where the player did something and asked nothing:
// in play it held to ask "근력이요, 민첩이요? 그래도 하시겠습니까?" five times in ten rounds.
export function canHold(c, who) {
  if ((c.holds?.[who] || 0) >= 2) return false;
  return !(c.gmStyle === 'easy' && c.resolve?.acting);
}

function resolveSchema(c, withChecks, first = '') {
  const R = rulesetOf(c);
  const left = turnsLeft(c);
  const who = c.resolve?.who;
  const hold = withChecks && who && canHold(c, who);
  const ask = withChecks && who && c.gmStyle !== 'easy' && (c.asks?.[who] || 0) < MAX_ASKS;
  // Every check says what's at stake; a trimmed one is asked about before the roll.
  const stake = c.gmStyle === 'easy' ? '걸린 것 한 문장: 성공하면 무엇이 되는가 (플레이어가 말한 그대로)' : '걸린 것 한 문장: 성공하면 무엇을 얻고, 그걸로 안 되는 건 무엇인가';
  const check = R.checkSchema.replace(/}\s*$/, `, "stake": "${stake}"${ask ? ', "trimmed": false' : ''}}`);
  const extra = R.effectSchema ? `, ${R.effectSchema}` : '';
  const more = R.extraSchema ? `\n  ${R.extraSchema},` : '';
  return `{
${first}${withChecks ? `  "checks": [${check}],
  "narration": "판정이 있으면 빈 문자열 (굴리기 전 서술은 하지 않는다). 판정이 없으면 결과 서술 (1~3문장)${hold ? '. hold면 짧은 대답 (한두 문장, 넘길 거면 빈 문자열)' : ''}",
${hold ? '  "hold": false,\n' : ''}${ask ? '  "confirm": "(trimmed이거나 부른 액션을 바꿀 때) 굴리기 전에 플레이어에게 할 말",\n' : ''}` : `  "narration": "판정 결과를 반영한 결과 서술 (1~3문장, 150자 안팎)",
`}  "effects": [{"who": "캐릭터 키", "hp": 0, "damage": "(선택) 피해 주사위 예: d6", "ignore_armor": false, "items_add": [], "items_remove": [], "conditions_add": [], "conditions_remove": []${extra}}],
  ${R.foeSchema || FOES_FIELD},${more}
  ${FACTS_FIELD},
  ${RULES_FIELD},
  "scene": {"title": "장면이 바뀌었을 때만", "description": "새 장면 요약"},
  "summary": "(선택) '지금까지의 이야기'를 갱신할 때 전체 새 버전 (5~10문장)",
  "gm_notes": "(선택) 비밀 메모를 고쳐 쓸 때 전체 새 버전",
${left.length ? `  "next": "다음 차례 캐릭터 키 (${left.join(', ')} 중 하나)${withChecks ? '. 판정이 없을 때만' : ''}",` : '  "spotlight": ["(선택) 다음 라운드에 행동할 캐릭터 키. 비우면 전원"],'}
  "end": false
}`;
}

const BOSS_GUIDE = `- 보스(이야기의 큰 적)에는 HP가 없다. foes에 "boss": true로 올려. 서버가 숨겨진 진행 시계를 센다(칸 수는 파티 인원에 맞춰 서버가 정한다). 장부에 보스 진행용 시계나 "쓰러짐"으로 이어지는 규칙을 따로 만들지 마.
  · 보스를 상대하는 판정이면 무엇이든(약점 찾기, 장치 쓰기, 빈틈 만들기, 직접 공격) checks에 "against": 보스 이름을 적어. 10+면 2칸, 7~9면 1칸, 6-면 0칸이 차고, 6-이면 보스가 움직인다. 칸은 주사위만 채운다.
  · 시계가 3/8, 6/8 지점에 닿으면 단계가 바뀐다고 서버가 알려 준다. 그때 보스가 달라지는 모습(새 약점, 새 공격 방식)을 서술해. 젤다의 보스처럼 단계마다 다른 공략을 준비해 둬(gm_notes).
  · 시계가 다 차기 전에는 보스를 쓰러뜨리거나 치우거나 이야기를 끝낼 수 없다. 다 차면 그 서술에서 쓰러뜨려라. 그러면 서버가 장부에 상태(보스 이름, 쓰러짐)을 넣는다. 결말 규칙의 조건으로 써.
  · 보스가 얼마나 남았는지 숫자로 말하지 마. 금이 가고, 숨이 거칠어지고, 움직임이 바뀌는 것으로 보여 줘.`;

const EFFECT_GUIDE = `- effects: hp는 회복(+)이나 정해진 숫자 변화, damage는 서버가 굴릴 피해 주사위(갑옷만큼 감소). 바뀐 게 없으면 빈 배열.
- foes: 새로 나타난 적은 추가, 바뀐 적은 같은 이름으로 다시 적고, 사라지거나 쓰러진 적은 "remove": true. 바뀐 게 없으면 생략.
${BOSS_GUIDE}`;

// Questions the GM may ask before a roll in one turn (a changed move, less put to the dice).
export const MAX_ASKS = 3;

// The GM's temper (c.gmStyle): 'strict' minds the fiction and asks before rolling less than
// was said; 'easy' lets the players have it and puts what they said to the dice whole. Either
// way, what's at stake is said before the roll and not cut after it.
export const GM_STYLES = ['strict', 'easy'];
const STYLE_TEXT = {
  strict: `## 마스터 성향: 깐깐하게
- 허구를 꼼꼼히 따진다: 위치, 가진 것, 앞서 생긴 곤경. 안 되는 건 안 된다고 말하고, 되게 하는 판정부터 시킨다.
- 플레이어가 말한 것보다 작게 걸거나 부른 액션을 바꾸면 굴리기 전에 묻는다.
- 플레이어가 세계에 사실을 덧붙이면("망치는 갈고리에 걸려 있어요") 받지 않는다. 세계는 네가 정한다.`,
  easy: `## 마스터 성향: 너그럽게
- 플레이어 편에 서서 웬만하면 하게 해 준다. 플레이어가 부른 액션은 아주 엉뚱하지 않으면 그대로 받는다.
- 행동이 둘이거나 결과까지 적었어도 그럴듯하면 한 판정에 통째로 건다. 묻지 않고 바로 굴린다.
- 한 행동은 한 판정이다. 달려가서 차면 접근전 한 번이지, 다가가는 판정과 차는 판정 둘이 아니다. 가는 길의 위험(날아드는 화살, 무너지는 자갈)은 7~9의 대가나 6-의 네 무브로 돌려준다.
- 능력치가 애매하면 플레이어가 말한 방식에 맞는 걸 네가 골라 굴린다. "어느 쪽으로 하시겠습니까?", "그래도 하시겠습니까?"라고 되묻지 않는다.
- 위치나 소지품은 대충 넘어간다. 조금 멀거나 하나쯤 없는 건 서술로 메워 준다. 정말 불가능한 것만 막는다.
- 플레이어가 덧붙인 작은 사실("망치는 갈고리에 걸려 있어요")은 이야기를 깨지 않으면 받아들여 세계에 쓴다.
- 그래도 주사위는 주사위다. 7~9에는 대가를, 6-에는 네 무브를.`,
};
const EASY_STAKES = `- 너그럽게: 플레이어가 말한 것을 될 수 있는 한 통째로 건다. 행동이 둘이면 한 판정에 묶고, 결과까지 적었으면 그 결과를 걸린 것으로 받는다(성공하면 그렇게 된다). 멀리 있는 적을 치겠다면 다가가는 것까지 그 판정에 넣는다. 정말 불가능할 때만 가능한 데까지 걸고, 그때는 stake에 분명히 쓴다. 묻지 않는다.
- stake에 "그건 이 판정에 들어가지 않는다", "그다음 일이다"를 쓰지 마. 성공하면 플레이어가 하려던 일이 된다.
- 부른 액션이 딱 맞지 않아도 비슷하면 그대로 받는다. 바꿔야 하면 그냥 바꿔 굴린다.
`;

// How the GM holds the fiction to what was declared. A strict GM rolls what gets the character
// there first; an easy one folds the distance and the trouble in the way into the one roll.
const FICTION_TEXT = {
  strict: `- 허구를 따져라. 선언한 행동이 지금의 위치·상태·가진 것으로 가능한지 먼저 본다. 앞서 생긴 곤경(갇힘, 막힌 길, 잃은 무기, 쓰러짐)은 그걸 넘는 행동과 판정 없이 풀어 주지 마.
  · 닿을 수 없는 곳의 일을 선언하면(웅덩이 너머 동료를 지키겠다, 무기를 잃었는데 베겠다), 그 일 대신 장애를 넘는 판정을 요청해. 성공해야 원래 하려던 일에 다가간다. 결과 서술에서 원래 행동까지 덤으로 이뤄지게 하지 마.
  · 플레이어에게 친절한 것보다 세계가 일관된 게 먼저다. 그래야 실패와 위험에 무게가 생긴다.
  · 장면이 구역으로 나뉘면(돌턱, 돌다리, 수문 앞) PC와 적의 위치를 장부에 위치(이름, 구역)으로 적어 두고, 움직이면 고쳐. 서버가 이 위치로 방어·접근전처럼 곁에 있어야 하는 액션을 검사한다.`,
  easy: `- 허구는 지킨다. 잃은 무기, 쓰러진 동료, 막힌 길은 공짜로 풀리지 않는다.
  · 다만 거리와 앞을 막은 위험은 하려는 행동의 판정 하나에 접어 넣는다. 화살을 뚫고 달려가 베겠다면 접근전 한 번이다. 성공하면 거기까지 가서 벤 것이고, 가는 길의 위험은 7~9의 대가나 6-의 네 무브로 돌려준다.
  · 장면이 구역으로 나뉘면(돌턱, 돌다리, 수문 앞) PC와 적의 위치를 장부에 위치(이름, 구역)으로 적어 두고, 움직이면 고쳐.`,
};

// What the GM may do with what the player said on their turn.
function turnTask(c, who) {
  const more = canHold(c, who);
  const spent = (c.holds?.[who] || 0) >= 2;
  return `- 처리는 셋 중 하나다.
  1. 판정: 하려는 행동(@행동, 또는 플레이어가 말로 밝힌 것)이 액션의 조건에 맞으면 checks에 넣는다. 플레이어가 액션을 불렀으면(부른 액션, "지식 굴림 할게요") 허구에 맞을 때 그대로 받고, 안 맞으면 맞는 액션으로 바꾼다(서버가 "부른 액션 → 네 액션"으로 보여 준다). 안 불렀으면 네가 고른다.
  2. 판정 없이 결과: 그냥 되는 일이거나 액션이 아닌 일이면 결과를 1~3문장으로 서술하고 차례를 넘긴다.
  ${more ? `3. 짧은 대답("hold": true): 플레이어가 행동하기 전에 물었으면(무엇이 보이나, 누가 어디 있나) 한두 문장으로 답한다. 따옴표로 NPC에게 말만 걸었으면 NPC가 한마디 받는다. 행동 없이 한 말이 그냥 테이블 수다면 narration을 비운다. 차례는 그대로고 같은 플레이어가 이어서 한다. 질문이 곧 액션의 조건이면("둥지 쪽에 뭐가 보여요?" → 상황 파악) hold 대신 판정을 요청해도 된다.`
    : spent ? '3. (이번 차례엔 이미 두 번 답했다. hold 하지 말고 판정이나 결과로 매듭지어.)' : '3. (플레이어가 행동을 선언했고 묻지 않았다. 되묻지 말고 판정이나 결과로 매듭지어.)'}
- 판정마다 "stake"에 걸린 것을 한 문장으로 써: ${c.gmStyle === 'easy' ? '성공하면 무엇이 되는지' : '성공하면 무엇을 얻는지, 그걸로 안 되는 건 무엇인지'}. 굴리기 전에 플레이어에게 보인다. 10+가 나오면 이걸 깎지 말고 그대로 준다. 굴린 뒤에 걸린 것을 줄이면 테이블에서 싸움이 난다.
${c.gmStyle === 'easy' ? EASY_STAKES : (c.asks?.[who] || 0) < MAX_ASKS ? `- 플레이어가 말한 것보다 작게 걸면 "trimmed": true로 표시하고, "confirm"에 굴리기 전에 할 말을 써: 무엇만 판정하는지, 왜, 어떤 액션·능력치로 굴리는지, 그래도 하겠냐고. 서버는 굴리지 않고 이 말을 전한 뒤 플레이어의 답을 기다린다.
  · 행동이 둘 이상이면 하나만 건다. ("목을 베는 건 건너간 다음이에요. 먼저 끊긴 틈을 뛰어넘는 거고, 위험 돌파 민첩이에요. 할래요?")
  · 결과까지 적었으면("놈을 쓰러뜨립니다", "돌멩이 하나 건드리지 않고 다가갑니다") 의도만 건다. ("단검 한 번으로 쓰러뜨리진 못해요. 등 틈에 박는 데까지고, 접근전 근력이에요. 할래요?")
  · 닿지 않는 곳의 일이면 거기까지 가는 것부터 건다.
- 플레이어가 부른 액션을 다른 액션으로 바꿀 때도 굴리기 전에 묻는다. checks에는 네가 고른 액션을, "confirm"에는 왜 그 액션이 아닌지, 무엇으로 굴리는지, 그래도 하겠냐고. (예: "거인이 이미 몸을 돌렸어요. 암습이 아니라 접근전이고, 근력으로 굴리게 됩니다. 하실 건가요?")
` : '- (이번 차례엔 이미 여러 번 물었다. 더 묻지 말고 걸린 것을 stake에 분명히 써서 굴려.)\n'}${c.offered?.[who] ? `- 방금 굴리기 전에 물었다(${c.offered[who]}). 플레이어가 받아들였으면 그대로 굴리고, 행동을 바꿨으면 새 행동을 처리해.\n` : ''}${c.rules === 'dw' ? '- 처지가 불리하면(넘어진 채, 맨발로 얼음 위) "bonus": -1, 유리하면 +1.\n' : ''}`;
}

export function adjudicateTurn(c) {
  const R = rulesetOf(c);
  const who = c.resolve?.who;
  const left = turnsLeft(c);
  const summaryDue = !left.length && c.round > 0 && c.round % 4 === 0;
  return `${gmContext(c)}

## 지금 할 일 (라운드 ${c.round}, ${who ? `[${who}] ${charName(c, who)}의 차례` : '모두 지켜봄'})
${who ? `${charName(c, who)}의 플레이어가 차례에 한 말이 위 기록 맨 아래에 있어. 이 플레이어 하나만 처리해. 다른 캐릭터의 일은 이미 결과가 나왔거나 아직 차례가 오지 않았다.` : '이번 라운드에는 모두 지켜보기만 했다. 네 무브로 상황을 움직여.'}
${who ? turnTask(c, who) : ''}${who ? R.turnMoves?.(c.characters[who]) || '' : ''}${c.gmStyle === 'easy'
    ? '- 판정을 고를 때: 거리나 앞을 막은 위험은 하려는 행동의 판정 하나에 접어 넣어. 다가가는 판정과 치는 판정으로 나누지 마. 가는 길의 위험은 7~9의 대가다.'
    : '- 판정을 고르기 전에: 이 캐릭터가 지금 그 행동을 할 수 있는 위치·상태인가? 앞서 생긴 곤경이 가로막고 있으면, 하려던 행동 대신 그걸 넘는 판정부터.'}
${R.checkGuide}
- 판정이 있으면 서버가 주사위를 굴리고(필요하면 플레이어가 선택지까지 고른 뒤) 결과를 주며 다시 물어볼 테니, 이번엔 결과를 서술하지 마.
- 판정이 필요 없으면 checks를 빈 배열로 두고 결과까지 서술해.
${turnGuide(c, left)}
- 캐릭터 키는 대괄호 안의 값(user, p1, p2 …)을 써.
${EFFECT_GUIDE}${summaryDue ? '\n- 이번엔 summary(지금까지의 이야기)를 꼭 갱신해.' : ''}
- 이야기가 결말에 닿았으면 "end": true와 함께 에필로그를 서술해.

JSON으로 답해:
${resolveSchema(c, true)}`;
}

// A miss (6-) is the GM's chance to make things worse, not "it didn't work" plus damage; a
// partial hit (7–9) gets a real cost. The GM names the move it made (master_move), and the
// last few are shown so it doesn't reach for damage every time.
function outcomeGuide(c, results) {
  const R = rulesetOf(c);
  const what = (r) => `${charName(c, r.who)}의 ${r.move || r.skill || r.stat || '판정'}`;
  const misses = results.filter((r) => r.tier === 'bad' || r.tier === 'fumble');
  const partial = results.filter((r) => r.tier === 'mixed');
  const out = [];
  if (misses.length) {
    const moves = R.missMoves ? '마스터 액션' : '나쁜 전개';
    out.push(`## 실패 처리: ${misses.map(what).join(', ')}
- "시도가 안 됐다, 그리고 피해"로 끝내지 마. 실패는 이야기를 앞으로 미는 기회다. ${moves} 하나를 골라 상황을 바꿔라: 시도는 반쯤 되거나 엉뚱하게 되고, 그 대가로 새 문제가 생긴다.${R.missMoves ? `\n- 마스터 액션: ${R.missMoves.join(' / ')}` : '\n- 예: 새 위협이 나타난다, 가진 것을 잃는다, 동료와 갈라진다, 곤란한 선택을 강요받는다, 위치가 나빠진다, 나쁜 소식을 듣는다.'}
- 피해는 그중 하나일 뿐이다. 피해를 준다면 상황이 바뀌는 것과 함께 줘(밀려나 위치가 바뀐다, 장비가 녹는다, 동료와 갈라진다).
- 새 문제는 이야기를 앞으로 민다: 더 깊이 끌려 들어간다, 쫓긴다, 숨긴 게 드러난다, 시간이 줄어든다. 같은 자리에 졸개나 장애물을 하나 더 얹어 장면을 늘이지 마.
- 서술 끝의 질문에 새로 생긴 문제를 구체적으로 걸어. 다음 차례가 남았으면 그 캐릭터에게, 없으면 몰린 캐릭터에게. ("나리, 도윤의 발목까지 쇳물이 차오르고 기둥이 그쪽으로 기웁니다. 어떻게 하시겠습니까?")${c.masterMoves?.length ? `\n- 최근에 쓴 것: ${c.masterMoves.slice(-3).join(', ')}. 같은 걸 연달아 쓰지 마.` : ''}
- 고른 것을 master_move에 적어.`);
  }
  const minions = results.filter((r) => r.minion);
  if (minions.length) {
    out.push(`## 잔챙이 처리: ${minions.map((r) => `${r.minion}(${what(r)})`).join(', ')}
- 이 판정으로 끝났다. 그 자리에서 죽거나, 비명을 지르며 달아나거나, 무기를 내던지고 항복해 협조한다. 어울리는 걸 골라. 상처 입은 채 버티게 하지 마.
- 끝나는 순간을 찰지게: 몸이 어떻게 꺾이고, 무엇을 떨어뜨리고, 무슨 소리를 내는지. 남은 놈들이 어떻게 반응하는지도 한 마디.${minions.some((r) => r.tier === 'mixed') ? '\n- 부분 성공의 대가는 이 잔챙이를 살려 두는 게 아니라 다른 데서 와야 한다.' : ''}`);
  }
  if (partial.length) {
    out.push(`## 부분 성공 처리: ${partial.map(what).join(', ')}
- 원하는 건 얻는다. 하지만 대가, 곤란한 선택, 더 나쁜 결과 중 하나를 실제로 붙여. 그냥 성공한 것처럼 서술하지 마.
- 그 곤란은 다른 캐릭터에게 넘기기 좋다. 다음 차례가 남았으면 그 곤란에 맞설 캐릭터를 next로 골라 서술 끝에 물어. ("티크가 엉덩방아를 찧고, 와이번이 그쪽으로 날아듭니다. 로발트는 뭘 하죠?")`);
  }
  return out.length ? `\n${out.join('\n\n')}\n` : '';
}

// The GM asked for a move from where the character can't make it: it answers again.
export function reachRetry(turn, out) {
  return `${turn}

## 서버가 받지 않은 판정 (지금 위치에서는 할 수 없다)
${out.map((x) => `- ${x}`).join('\n')}
먼저 그곳으로 가는 판정(가로막은 것을 넘는 판정, 던전 월드라면 위험 돌파)을 요청하거나, 다른 판정이나 결과 서술로 다시 답해. 장부의 위치가 틀렸다면 facts로 위치를 고쳐도 된다.`;
}

// An easy GM held an acting player's turn to ask a question: it answers again.
export function holdRetry(turn, asked) {
  return `${turn}

## 서버가 받지 않은 되묻기
${asked ? `- 네가 하려던 말: ${str1(asked)}\n` : ''}- 플레이어는 행동을 선언했고 묻지 않았다. 너그러운 마스터는 되묻지 않는다. 플레이어가 말한 방식에 맞는 액션과 능력치를 네가 골라 checks에 넣거나, 판정이 필요 없으면 결과를 서술해. "hold"는 쓰지 마.`;
}

const str1 = (x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

export function resultsTurn(c, results) {
  const missed = results.some((r) => r.tier === 'bad' || r.tier === 'fumble');
  return `${gmContext(c)}

## 판정 결과 (서버가 굴림)
${results.map((r) => `- ${rollText(c, r)}${r.stake ? ` · 걸린 것: ${r.stake}` : ''}`).join('\n')}
${outcomeGuide(c, results)}
## 지금 할 일
위 판정 결과를 그대로 반영해 ${c.resolve?.who ? `${charName(c, c.resolve.who)}의 차례` : `라운드 ${c.round}`}의 결과를 서술해. 결과 등급이 말하는 대로(성공은 원하는 걸, 부분 성공은 대가와 함께, 실패는 네 무브로, 풀다이스는 기대 이상으로, 대실패는 특히 나쁘게).${results.some((r) => r.stake) ? ' 걸린 것은 굴리기 전에 플레이어에게 보였다. 성공이면 걸린 것을 깎지 말고 다 주고, 부분 성공이면 걸린 것은 얻되 대가를 붙여. 굴린 뒤에 걸린 것을 줄이지 마.' : ''} 플레이어가 고른 선택지나 질문이 있으면 서술 안에서 반드시 반영하고 답해. 판정을 다시 요청하지 마.
${turnGuide(c, turnsLeft(c))}${!turnsLeft(c).length && c.round > 0 && c.round % 4 === 0 ? '\n- 이번엔 summary(지금까지의 이야기)를 꼭 갱신해.' : ''}
${EFFECT_GUIDE}

JSON으로 답해:
${resolveSchema(c, false, missed ? `  "master_move": "6-에 대해 고른 ${rulesetOf(c).missMoves ? '마스터 액션' : '나쁜 전개'} (한 마디)",\n` : '')}`;
}

// 황천길 7~9: the GM names Death's price and writes both outcomes now, so the player's
// pick needs no second call.
export function bargainTurn(c, who) {
  const name = charName(c, who);
  return `${gmContext(c)}

## 지금 할 일: 사신의 거래
${name}이(가) 황천길에서 7~9를 굴렸다. 사신이 거래를 내민다. 받아들이면 ${name}은(는) 목숨을 건져 안정된다(의식은 없고, 치료받아 HP가 0을 넘으면 깨어난다). 대가는 나중에 반드시 치른다. 거부하면 저편으로 떠난다. 고르는 건 ${name}의 플레이어다.
- 대가는 허구 속의 무언가로: 지켜야 할 약속, 잃을 것, 언젠가 해야 할 일. 무게는 있되 지금 당장 이야기를 끝내지 않는 것. (예: 다음 보름에 사신의 심부름을 한 번 한다 / 가장 아끼는 기억 하나를 내놓는다)
- narration: 사신이 나타나 거래를 내미는 장면 (2~3문장, ~니다체). 사신의 말은 줄을 바꿔 \`사신: "대사"\` 한 줄로. 고른 결과는 아직 쓰지 마.
- accept, refuse: 받아들였을 때와 거부했을 때 이어질 서술 (각 1~2문장, ~니다체). 플레이어가 고르면 그중 하나가 그대로 나간다.
- 받아들이면 대가는 장부에 남는다. 나중에 그 값을 받아 내.

JSON으로 답해:
{"narration": "", "price": "대가 한 줄 (30자 안팎, 플레이어가 누를 버튼에 그대로 나간다)", "accept": "", "refuse": ""}`;
}

// Every player character is down or dead: one closing narration, then the story ends.
export function wipeTurn(c) {
  return `${gmContext(c)}

## 지금 할 일: 일행 전멸
플레이어 캐릭터가 모두 쓰러지거나 죽었다. 더 행동할 사람이 없다. 이번 서술이 이 이야기의 마지막이다.
- 나쁜 결말로 이야기를 닫는 에필로그를 서술해 (4~6문장, ~니다체). 쓰러진 일행이 어떻게 되는지, 위협이 세계에 무엇을 남기는지. 갑자기 나타난 구원으로 일행을 살려 내지 마.
- 보스가 아직 서 있어도, 결말 규칙이 발동하지 않았어도 괜찮다. 이 서술로 이야기가 끝난다.

JSON으로 답해:
{"narration": "에필로그", "summary": "(선택) '지금까지의 이야기' 마지막 버전", "end": true}`;
}

// ---------------------------------------------------------------------------
// Players

export function playerBrief(c, key) {
  const R = rulesetOf(c);
  const seat = c.seats.find((s) => s.key === key);
  const me = BACKENDS[seat?.backend] || { label: key, maker: '' };
  return `너는 TRPG 테이블 "What Do You Do?"의 플레이어야. 룰은 ${R.label}. 이 테이블에서 너는 ${me.label}(${me.maker})이고, 네 캐릭터 키는 [${key}].
GM은 ${seatLabel(c, 'gm')}, 테이블 주인은 ${c.userName}(사람)이야. 모든 출력은 한국어로 해.

${R.rulesText}${houseText(c)}

## 플레이어 원칙
- 너는 네 캐릭터 하나만 연기해. 다른 PC의 대사나 행동을 정하지 말고, 세계나 NPC의 반응도 지어내지 마. 그건 GM 몫이야.
${R.playerPrinciples}
- 캐릭터의 성격·말투·목표를 지키되, 이야기가 앞으로 가게 적극적으로 움직여. 가끔은 위험을 감수하는 게 재밌어.
- 테이블은 한 명씩 돈다. GM이 네게 물으면 네 차례다. 앞사람의 선언과 그 결과가 기록에 있으니 이어 받아 움직여. 앞사람이 이미 한 질문이나 행동을 똑같이 되풀이하지 마.
- 다른 PC와 엮이는 행동(돕기, 말 걸기, 의견 충돌)도 좋아.
- ${POST_NOTATION} 동료가 따옴표로 한 말은 네 캐릭터도 들었어. 작전은 따로 회의하지 않고 움직이며 외쳐서 맞춘다.
- 기억해야 할 건 note_add로 개인 메모에 적어. 메모는 너만 봐. 매 턴 이전 대화를 기억하지 못하니 메모가 네 기억이야.
- 응답은 JSON 객체 하나만. 코드블록이나 설명을 붙이지 마.`;
}

export function characterTurn(c, key, { hint, forUser, preroll, nameIdeas = [] } = {}) {
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
- 이름은 부르기 쉬운 한 단어. 성은 붙이지 마. 동료와 첫 글자가 겹치지 않게.${nameIdeas.length ? `\n- 이름 후보: ${nameIdeas.join(', ')}. 이 중 하나를 쓰거나 이런 느낌으로 지어.` : ''}${c.avoidNames?.length ? `\n- 쓰지 말 이름(최근 판에서 썼다): ${c.avoidNames.join(', ')}` : ''}
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

// The latest message in which a teammate called this character by name out loud, since its own
// last one and no older than last round; null if none (the call's words are in .said). Only the
// latest: shown every call at once, players answered them all in one breath, and every line
// became a roll call.
export function calledOut(c, key) {
  const name = c.characters[key]?.name;
  if (!name) return null;
  for (let i = c.log.length - 1; i >= 0; i--) {
    const m = c.log[i];
    if (!['declare', 'player'].includes(m.type) || m.chat) continue;
    if (m.from === key || m.round < c.round - 1) return null;
    const said = partsOf(m).filter((p) => p.k === 'say').map((p) => p.text).join(' ');
    if (said.includes(name)) return { ...m, said };
  }
  return null;
}

// What a player may do on their turn besides acting: ask the GM first. A veteran calls the move
// they want; a beginner says what the character does and lets the GM name it.
const SKILL = {
  veteran: (gm) => `너는 이 룰에 익숙한 플레이어다. 노리는 액션이 있으면 "move"에 이름을 적어(또는 talk에 "접근전 할게요"처럼). 행동에 딱 맞는 액션을 불러: 네 직업 액션(위 파티의 "직업 액션")과 기본 액션을 먼저 떠올리고, 위험 돌파는 그중 맞는 게 없을 때만. 네 캐릭터가 잘하는 방식(높은 능력치)으로 풀 길을 찾아. 판정할지, 어떤 액션인지는 결국 ${gm} 몫이다.`,
  beginner: (gm) => `너는 이 룰이 아직 낯선 플레이어다. 액션 이름은 잘 모른다. @행동으로 캐릭터가 무엇을 하려는지만 말하고, 무엇을 굴릴지는 ${gm}에게 맡겨. 궁금하면 talk로 물어봐도 된다("이거 뭐 굴려요?").`,
};
const skillOf = (c, key) => c.seats.find((s) => s.key === key)?.skill || 'veteran';

export function declareTurn(c, key) {
  const ch = c.characters[key];
  const veteran = skillOf(c, key) !== 'beginner';
  const moveField = c.rules === 'dw' && veteran ? ', "move": ""' : '';
  const gm = rulesetOf(c).gmName;
  const gmSubj = fixJosa(`${gm}이`, [gm]); // 마스터가 · 키퍼가 · GM이
  // A story's opening question ("브론은 어떤 사람인가요?") until this player has answered it.
  const answered = c.log.some((m) => m.from === key && (m.answer || (m.type === 'player' && m.parts?.some((p) => p.answer))));
  const ask = c.openingAsk && !answered
    ? `\n${gmSubj} 처음에 모두에게 물은 질문에 너는 아직 답하지 않았다: "${c.openingAsk}" 이번에 answer로 꼭 답해.` : '';
  const called = calledOut(c, key);
  const heard = called
    ? `\n${charName(c, called.from)}이(가) 너를 불렀다: "${called.said}" 따르든, 거절하든, 되묻든 네 차례에 받아. 그새 상황이 바뀌어 할 말이 없으면 그냥 움직여도 된다.` : '';
  // Twice the GM answered without the turn moving on: time to act.
  const held = c.offered?.[key]
    ? `\n${gmSubj} 굴리기 전에 물었다(기록 맨 아래): 무엇을 무엇으로 굴리는지. 그대로 하겠으면 talk로 "네, 할게요"처럼 답하고, 싫으면 다른 행동(act)을 해.`
    : (c.holds?.[key] || 0) >= 1 ? `\n${gmSubj} 방금 네 말에 답했다. 이제 행동해(act).` : '';
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
네 차례다. ${gmSubj} ${ch?.name}에게 묻는다: 지금 무엇을 하나? 방금 일어난 일(기록 맨 아래)에 이어서, 온라인 세션에 메시지를 쓰는 플레이어처럼 써.${ask}${heard}${held}
${SKILL[veteran ? 'veteran' : 'beginner'](gm)}
메시지는 아래 칸들로 나눠 적어. 아무 조합이나 되고, 하나만 써도 된다. 빈 칸은 빈 문자열.
- act: 캐릭터가 하려는 행동 하나. 화면에 "@행동"으로 나간다. 한 문장, 30자 안팎, "~합니다/~해 봅니다".
  의도만 써. 어떻게 됐는지는 ${gmSubj} 정한다. ("자물쇠를 따 봅니다" O / "자물쇠를 따서 문을 엽니다" X / "돌멩이 하나 건드리지 않고 다가갑니다" X)
  한 번에 행동은 하나다. 둘을 잇지 마("다가가서 알을 집어 듭니다" X).
  예: 방패를 치켜들고 시벨 앞을 막아섭니다 / 바위 틈에서 둥지 쪽을 슬쩍 내다봅니다 / 와이번에게 매직 미사일을 쏩니다
- say: 캐릭터가 소리 내어 하는 말. 캐릭터 말투로, 따옴표 없이, 한 문장, 40자 안팎. 어울릴 때만. 대개는 빈 문자열이거나 NPC나 상황에 하는 말, 혼잣말이다.
  동료의 손이 꼭 필요할 때만 이름을 불러 한 가지를 부탁해. 매번 동료를 부르지 마.
  예: 영감, 위 좀 봐요. 저거 떨어지면 꼬치구이예요. / 망치 내려놔. 그건 브론 거다.
- talk: 플레이어인 네가 테이블에서 하는 말. 친구들과 게임하듯 짧게. 캐릭터는 못 듣는다. 굳이 없어도 된다.
  예: 어미가 없을 때 빨리 가는 게 좋겠어요. / 아 이거 냄새가 나는데 ㅋㅋ
- ask: 행동하기 전에 ${gm}에게 묻고 싶은 것(장면에 대해, 무엇이 보이는지, 누가 어디 있는지). 물으면 act는 비워. ${gmSubj} 답하면 다시 네 차례가 온다. 꼭 필요할 때만.
  예: 로발트가 누워 있나요? / 둥지 쪽에 뭐가 보여요?
- answer: ${gmSubj} 너에게(또는 모두에게) 던진 질문 중 네가 아직 답하지 않은 게 있으면, 플레이어로서 짧게 답해(한두 문장). 네 답은 세계의 사실이 된다.
  예: (브론은 어떤 사람인가요?) 제 첫 도끼를 벼려 준 분이에요. 아직 그 값을 못 치렀어요.
- 소설처럼 쓰지 마. 장면·몸짓 묘사와 결과는 ${gm} 몫이다.
- 이번 라운드에 할 게 정말 없으면 "pass": true

JSON으로 답해:
{"talk": "", "say": "", "act": ""${moveField}, "ask": "", "answer": "", "note_add": "", "pass": false}`;
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

// ---------------------------------------------------------------------------
// Table talk (lib/talk.mjs): one line between declarations, a short call with a short brief.

export function talkBrief(c, key) {
  const R = rulesetOf(c);
  const seat = c.seats.find((s) => s.key === key);
  const me = BACKENDS[seat?.backend] || { label: key, maker: '' };
  const ch = c.characters[key];
  return `너는 TRPG 테이블 "What Do You Do?"에 앉은 플레이어야. 이 테이블에서 너는 ${me.label}(${me.maker})이고, 네 캐릭터는 [${key}] ${ch?.name} — ${ch?.concept || '?'}${ch?.personality ? ` (성격: ${ch.personality})` : ''}.
룰은 ${R.label}, ${fixJosa(`${R.gmName}은`, [R.gmName])} ${seatLabel(c, 'gm')}, 테이블 주인은 ${c.userName}(사람)이야. 모든 출력은 한국어로 해.
지금은 네 차례가 아니라, 테이블에서 오가는 말을 한 줄 하는 짧은 호출이야.
- 플레이어인 너의 말(OOC)이야. 친구끼리 게임하듯 반말로 짧게. 캐릭터는 이 말을 듣지 못해.
- 결과를 정하거나 지난 결과를 바꾸지 마. 세계, NPC, 다른 캐릭터의 말과 행동을 지어내지 마. 그건 ${R.gmName} 몫이야.
- 앞사람이 한 말을 되풀이하지 말고 이어 받아.
- 응답은 JSON 객체 하나만. 코드블록이나 설명을 붙이지 마.`;
}

// What just happened at the table, as the reacting player hears it.
function eventText(c, key, ev) {
  const who = (k) => (k === key ? `너의 캐릭터 ${charName(c, k)}` : charName(c, k));
  switch (ev.kind) {
    case 'fumble': return `${rollText(c, ev.roll)}\n${who(ev.who)}의 대실패다.`;
    case 'crit': return `${rollText(c, ev.roll)}\n${who(ev.who)}의 ${ev.roll?.house === 'crit' ? '풀다이스' : '대성공'}다.`;
    case 'streak': return `${rollText(c, ev.roll)}\n${who(ev.who)}이(가) ${ev.n}번 연달아 실패했다.`;
    case 'hurt': return `${who(ev.who)}의 판정이 실패했고, 그 바람에 ${who(ev.victim)}이(가) 다쳤다 (HP ${ev.before}→${ev.after}).`;
    case 'bold': return `${who(ev.who)}: ${[ev.say && `"${ev.say}"`, ev.action && `@${ev.action}`].filter(Boolean).join(' ')}\n${ev.why}.`;
    case 'user': return `${seatLabel(c, 'user')}이(가) 테이블에 말했다: ${ev.text}`;
    default: return '';
  }
}

export function reactTurn(c, key, ev) {
  const about = ev.who && ev.who !== key && c.characters[ev.who] ? ev.who : null;
  const bond = about && (c.characters[key]?.bonds || []).find((b) => b.with === about || b.with === c.characters[about].name || String(b.text || '').includes(c.characters[about].name));
  const task = ev.back
    ? `${ev.back.from}이(가) 너에게 한마디 했다: "${ev.back.line}"\n지금 할 일: 받아쳐. 플레이어로서 한 줄.`
    : ev.kind === 'user'
      ? `지금 할 일: ${c.userName}의 말에 플레이어로서 대답해. 물음이면 네 생각으로 답하고, 작전 얘기면 거들거나 반대해.`
      : '지금 할 일: 테이블에 앉은 플레이어로서 한마디 해.';
  return `## 최근 진행
${formatLog(c, recent(c, 10), key) || '(아직 없음)'}

## 방금 테이블에서
${eventText(c, key, ev)}

## ${task}
- 플레이어인 너의 말이다(OOC). 캐릭터 말투가 아니라 친구들과 게임하며 하는 반말로, 한 줄 25자 안팎.
  예: 아니 뭐하냐고 / 주사위 바꿔라 진짜 / 와 풀다이스 미쳤다 / 야 나 맞았잖아 / 손이 미끄러졌다고 ㅋㅋ
- 판정과 서술은 이미 끝났다. 결과를 바꾸거나, 세계나 다른 캐릭터의 일을 지어내지 마.${bond ? `\n- 네 캐릭터와 ${charName(c, about)}은(는) 인연이 있다: "${bond.text}". 놀려도 그 사이답게.` : ''}
- 굳이 할 말이 없으면 빈 문자열.

JSON으로 답해:
{"line": ""}`;
}
