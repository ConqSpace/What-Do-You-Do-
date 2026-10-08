// Table UI: one SSE stream (init → msg / update / state), a handful of POSTs.
// Mobile first: avatar strip, log, composer; the story panel is a drawer, rolls and
// choices come up in a bottom sheet, a character sheet is a full page.

import { initBuilder, renderBuilder, builderNeeded, openBuilder } from './builder.js';
import { STORIES, STORY_ROWS, STARTS, LENGTH } from './stories.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// Old d20 rolls (before rule modules) carried only `outcome`.
const OUTCOME = { critical: '대성공', success: '성공', failure: '실패', fumble: '대실패' };
const OLD_TIER = { critical: 'crit', success: 'good', failure: 'bad', fumble: 'fumble' };
const PHASE = { setup: '준비 전', prep: '캠페인 준비 중', declare: '차례', resolve: '판정 중', roll: '주사위 · 선택', 'gm-wait': 'GM 서술 대기', ended: '종료' };
const STATUS = { thinking: '생각 중', done: '✓ 했음', waiting: '차례 대기', rolling: '굴릴 차례', choosing: '고르는 중', down: '쓰러짐', dead: '사망', idle: '' };
const DICE = { d20: 'd20', dw: '2d6', coc7: 'd100' };
// [label, premise, tone, genre (a key of RANDOM)]: the d20 gallery until it has written stories.
const PRESETS = [
  ['판타지', '국경 마을에서 사람들이 하나둘 사라지는 정통 판타지 모험', '어둡지만 희망이 남아 있게', 'fantasy'],
  ['코즈믹 호러', '1920년대 안개 낀 항구 도시, 바다에서 건져 올린 이상한 조각상과 연쇄 실종 사건', '진지하고 음산하게', 'horror'],
  ['던전 크롤', '고블린 떼가 점령한 드워프 폐광에서 사라진 대장장이를 구출하라', '거칠고 박진감 있게', 'dungeon'],
  ['사이버펑크', '2089년 네오서울, 거대 기업의 데이터를 훔치는 의뢰를 받은 해커와 용병들', '네온 아래 냉소적이고 건조하게', 'cyberpunk'],
  ['무협', '강호를 뒤흔든 비급이 사라졌다. 정파와 사파가 모두 노리는 객잔에서 벌어지는 이야기', '호쾌하고 비장하게', 'wuxia'],
  ['학원 미스터리', '폐교 직전의 고등학교, 밤마다 불이 켜지는 옛 음악실의 비밀을 파헤치는 학생들', '아련하고 오싹하게', 'school'],
];
// The 🎲 button: premise = "<setting>에서 <incident>", plus a tone, from genres that suit the rules.
const RANDOM = {
  fantasy: {
    rules: ['d20', 'dw'],
    settings: ['국경 마을', '몰락한 왕도의 뒷골목', '거대한 고목 위의 엘프 도시', '얼어붙은 북방 요새', '순례자들이 모이는 사막 수도원', '강을 따라 떠도는 상단 행렬'],
    incidents: ['사람들이 하나둘 사라진다', '죽은 왕의 인장이 다시 쓰이기 시작했다', '밤마다 봉인된 탑의 종이 저절로 울린다', '용을 잡았다는 영웅이 거짓말쟁이라는 소문이 돈다', '어느 날부터 마법이 듣지 않는다', '성물을 옮기던 호위대가 흔적도 없이 사라졌다'],
    tones: ['어둡지만 희망이 남아 있게', '웅장하고 서사적으로', '가볍고 유쾌하게', '쓸쓸하고 서정적으로'],
  },
  dungeon: {
    rules: ['d20', 'dw'],
    settings: ['고블린이 점령한 드워프 폐광', '물에 잠긴 고대 신전', '살아 움직이는 미궁', '무너진 마법사의 탑 지하', '거대 벌레가 판 땅굴'],
    incidents: ['사라진 대장장이를 구해 와야 한다', '보물을 노린 다른 모험가 일행이 한발 먼저 들어갔다', '가장 깊은 곳의 무언가가 깨어나고 있다', '입구가 무너져 다른 출구를 찾아야 한다', '마을을 덮친 저주의 근원이 잠들어 있다'],
    tones: ['거칠고 박진감 있게', '긴장감 넘치고 위태롭게', '유쾌한 보물 사냥처럼'],
  },
  horror: {
    rules: ['d20', 'coc7'],
    settings: ['1920년대 안개 낀 항구 도시', '뉴잉글랜드의 외딴 어촌', '폐쇄를 앞둔 정신병원', '사막 한가운데의 발굴 현장', '대학 도서관의 금서 서고', '눈에 갇힌 산장'],
    incidents: ['어부의 그물에 걸려 올라온 조각상 이후로 실종이 이어진다', '죽은 줄 알았던 교수에게서 편지가 왔다', '사람들이 모두 같은 꿈을 꾸기 시작했다', '아무도 읽을 수 없는 문자가 벽에 떠오른다', '조사단 전원과 같은 날 연락이 끊겼다', '해마다 같은 날 한 명씩 사라진다'],
    tones: ['진지하고 음산하게', '서서히 조여 오는 공포로', '건조한 탐정물처럼', '광기가 스며들게'],
  },
  cyberpunk: {
    rules: ['d20'],
    settings: ['2089년 네오서울', '해수면이 차오른 수상 도시', '기업이 통치하는 궤도 정거장', '불법 의체 시장이 열리는 지하 상가'],
    incidents: ['거대 기업의 데이터를 훔치는 의뢰가 들어왔다', '기억을 사고파는 브로커가 살해당했다', '도시 관리 AI가 시민 기록을 조금씩 지우고 있다', '의뢰인이 이미 죽은 사람이라는 사실이 드러났다'],
    tones: ['네온 아래 냉소적이고 건조하게', '빠르고 스타일리시하게', '우울한 누아르처럼'],
  },
  wuxia: {
    rules: ['d20'],
    settings: ['정파와 사파가 모두 드나드는 객잔', '안개에 싸인 무림 명문의 산문', '황궁과 강호 사이의 국경 관문', '대운하를 오가는 상선'],
    incidents: ['강호를 뒤흔든 비급이 사라졌다', '무림맹주가 독살당했다', '은거 고수의 제자를 자처하는 자들이 나타났다', '십 년 전 멸문당한 가문의 생존자가 돌아왔다'],
    tones: ['호쾌하고 비장하게', '의리와 배신이 얽히게', '유쾌한 협객극처럼'],
  },
  school: {
    rules: ['d20', 'coc7'],
    settings: ['폐교 직전의 고등학교', '산골의 기숙학교', '축제를 앞둔 대학 캠퍼스'],
    incidents: ['밤마다 옛 음악실에 불이 켜진다', '졸업 앨범에 없는 학생이 교실에 앉아 있다', '학교 괴담이 하나씩 실제로 일어난다', '사라진 선배의 일기장이 발견됐다'],
    tones: ['아련하고 오싹하게', '풋풋하지만 서늘하게', '긴장감 있는 추리물처럼'],
  },
};
const any = (a) => a[Math.floor(Math.random() * a.length)];
function randomStory(rules, current) {
  const genres = Object.entries(RANDOM).filter(([, g]) => g.rules.includes(rules));
  for (let i = 0; i < 10; i++) {
    const [genre, g] = any(genres.length ? genres : Object.entries(RANDOM));
    const premise = `${any(g.settings)}에서 ${any(g.incidents)}`;
    if (premise !== current) return { premise, tone: any(g.tones), genre };
  }
}
const NAME_KEY = 'wdyd.userName';
const loadName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const saveName = (v) => { try { localStorage.setItem(NAME_KEY, v); } catch {} };
const ICON = {
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>',
};
const mobile = () => matchMedia('(max-width: 899px)').matches;

let state = null;
let log = [];
let secretsOpen = false;
let sheetKey = null; // character shown on the sheet page
let actionKey = ''; // what the action sheet currently shows (keeps selections across redraws)
let sheetMin = false; // phone: the sheet folded to one line
// How fast new text is revealed (the header button cycles through).
const PACE_LABEL = { slow: '느리게', normal: '보통', fast: '빠르게', off: '즉시' };
const PACE_NEXT = { slow: 'normal', normal: 'fast', fast: 'off', off: 'slow' };
// How often the AI players react to what happens at the table; the header button cycles.
const CHATTER_LABEL = { normal: '리액션 보통', low: '리액션 적게', off: '리액션 끔' };
const CHATTER_NEXT = { normal: 'low', low: 'off', off: 'normal' };
const CHATTER_SHORT = { normal: '리액션', low: '리액션↓', off: '리액션✕' }; // a phone's header is narrow
const chars = () => state?.characters || {};
const camp = () => state?.campaign;

// ---------------------------------------------------------------------------
// API

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) toast(j.error || '요청 실패');
  return j;
}

function toast(text) {
  const b = $('#banner');
  b.textContent = text;
  b.className = 'banner info';
  b.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(renderBanner, 3500);
}

// ---------------------------------------------------------------------------
// SSE

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('init', (e) => {
    const d = JSON.parse(e.data);
    state = d.state;
    log = d.log;
    renderAll();
    if (!camp()) openSetup();
  });
  es.addEventListener('state', (e) => {
    state = JSON.parse(e.data);
    renderState();
  });
  es.addEventListener('update', (e) => {
    const m = JSON.parse(e.data);
    const i = log.findIndex((x) => x.id === m.id);
    if (i >= 0) log[i] = m;
    // Still waiting to be shown: it will be shown as it is now.
    const q = showQueue.findIndex((x) => x.id === m.id);
    if (q >= 0) showQueue[q] = m;
    const html = msgHtml(m, false);
    if (html) $(`#log [data-id="${m.id}"]`)?.replaceWith(htmlToNode(html));
  });
  // A new campaign (from this page, another one, or the API): the old log goes.
  es.addEventListener('campaign', () => {
    log = [];
    renderLog();
  });
  es.addEventListener('msg', (e) => {
    const m = JSON.parse(e.data);
    log.push(m);
    enqueue(m);
  });
  es.onerror = () => { $('#phasePill').textContent = '연결 끊김… 다시 연결 중'; };
}

// ---------------------------------------------------------------------------
// Helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const gmName = () => camp()?.gmName || 'GM';

function seatOf(key) { return state?.seats?.find((s) => s.key === key); }
function colorOf(key) {
  const s = seatOf(key);
  if (!s || s.backend === 'human') return '#8a6a2a';
  return state.backends[s.backend]?.color || '#5e5e66';
}
function charName(key) {
  if (key === 'gm') return gmName();
  if (key === 'user' && !chars().user) return camp()?.userName || '방장';
  return chars()[key]?.name || seatOf(key)?.label || key;
}
// The AI GM's face follows its temper (깐깐하게 / 너그럽게); a human GM keeps the letters.
const gmPortrait = (style) => `/img/gm-${style === 'easy' ? 'easy' : 'strict'}.webp`;
const aiGm = () => !!seatOf('gm') && seatOf('gm').backend !== 'human';
// The face, zoomed in from the half-length picture.
const face = (style, cls = '') => `<span class="face${cls ? ` ${cls}` : ''}" style="background-image:url(${gmPortrait(style)})" aria-hidden="true"></span>`;

function avatar(key) {
  if (key === 'gm' && aiGm()) return face(camp()?.gmStyle, 'avatar gm');
  const label = key === 'gm' ? gmName().slice(0, 2) : (charName(key) || '?').slice(0, 1);
  return `<span class="avatar${key === 'gm' ? ' gm' : ''}" style="background:${colorOf(key)}" aria-hidden="true">${esc(label)}</span>`;
}
// What a move does (Dungeon World), or null.
function moveInfo(name) {
  return (name && state?.rulesets?.[camp()?.rules]?.moveInfo?.[name]) || null;
}
// An NPC's color comes from its name, so each one looks the same every time it speaks.
function npcColor(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) % 360;
  return `hsl(${h} 38% 42%)`;
}
function tracksOf(ch) {
  return ch.sheet?.tracks || [{ label: 'HP', value: ch.hp, max: ch.maxHp }];
}
function bar(t) {
  const pct = Math.max(0, Math.min(100, Math.round((t.value / Math.max(1, t.max)) * 100)));
  return `<span class="bar${t.kind ? ` ${t.kind}` : ''}${!t.kind && pct <= 30 ? ' low' : ''}"><i style="width:${pct}%"></i></span>`;
}
function htmlToNode(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

// ---------------------------------------------------------------------------
// Log

function rollHtml(m, fresh) {
  const r = m.roll;
  if (r.kind !== 'check') {
    return `<div class="msg" data-id="${m.id}"><div class="roll free${fresh ? ' fresh' : ''}"><b>${esc(charName(r.who))}</b> ${esc(r.expr)} <span class="muted">${esc(r.detail)}</span> <span class="die">${r.total}</span></div></div>`;
  }
  const tier = r.tier || OLD_TIER[r.outcome] || 'good';
  const title = r.title || `${r.stat} 판정`;
  const label = r.label || OUTCOME[r.outcome] || '';
  // A move with a description (Dungeon World): the card shows its name and the result; what
  // the move does and what each result means are in the tooltip on the name.
  const info = moveInfo(r.move);
  const target = info ? '' : r.target || (r.dc ? `DC ${r.dc}` : '');
  const dice = r.dice.map((d) => `<span class="die">${d}</span>`).join('');
  const nums = r.mod === undefined
    ? `${dice}<span class="muted">${esc(target)}</span>`
    : `${dice}<span class="muted">${sign(r.mod)} =</span><span class="total">${r.total}</span>${target ? `<span class="muted">${esc(target)}</span>` : ''}`;
  const name = info ? `<span class="tipped" tabindex="0" data-tip-move="${esc(r.move)}" data-tier="${tier}">${esc(title)}</span>` : esc(title);
  const lines = [];
  // What the roll was for, as the GM said before it (success gets this, no more and no less).
  if (r.stake) lines.push(`<div class="rolltext stake"><span class="muted">걸린 것</span> ${esc(r.stake)}</div>`);
  if (r.text && !info) lines.push(`<div class="rolltext">${esc(r.text)}${r.after ? ` <span class="muted">(${esc(r.after)})</span>` : ''}</div>`);
  if (r.diceNote) lines.push(`<div class="rolltext muted">${esc(r.diceNote)}</div>`);
  if (r.selfDamage) lines.push(`<div class="rolltext">받은 피해 <b>${r.selfDamage.total}</b></div>`);
  if (r.damage) lines.push(`<div class="rolltext">피해 ${esc(r.damage.expr)} = <b>${r.damage.total}</b>${r.damage.target ? ` → ${esc(r.damage.target)}` : ''}</div>`);
  if (r.pendingChoice) lines.push('<div class="rolltext muted">선택을 기다리는 중…</div>');
  if (r.chosen?.length) lines.push(`<div class="rolltext">✔ ${r.chosen.map(esc).join(' / ')}</div>`);
  if (r.notes?.length) lines.push(`<div class="rolltext muted">${r.notes.map(esc).join(' · ')}</div>`);
  return `<div class="msg${m.of ? ' attached' : ''}${r.who === 'user' ? ' mine' : ''}" data-id="${m.id}"${m.of ? ` data-of="${m.of}"` : ''}><section class="roll tier-${r.house || tier}${r.who === 'user' ? ' mine' : ''}${fresh ? ' fresh' : ''}" aria-label="판정">
    <div class="rollhead"><span class="who"><b>${esc(charName(r.who))}</b> · ${name}</span><span class="rollnums">${nums}</span><span class="res">${esc(label)}</span></div>${lines.join('')}</section></div>`;
}

// Whispers reach only their target; the ledger's change notes are the GM's. Spectators,
// a human GM and anyone peeking at secrets see both.
function hiddenFromMe(m) {
  if (!m.to) return false;
  if (secretsOpen) return false;
  if (m.ledger || m.to === 'gm') return true;
  return camp()?.userRole === 'player' && m.to !== 'user';
}

// A player's message, old or new, as parts (see lib/post.mjs): talk, say, act.
function partsOf(m) {
  if (m.type === 'player') return m.parts || [];
  if (m.type === 'declare') {
    return [m.answer && { k: 'talk', text: m.answer, answer: true }, m.line && { k: 'talk', text: m.line },
      m.say && { k: 'say', text: m.say }, m.action && { k: 'act', text: m.action }].filter(Boolean);
  }
  return m.type === 'ooc' ? [{ k: 'talk', text: m.text }] : [{ k: 'say', text: m.text }];
}

function moveTag(name) {
  return moveInfo(name) ? `<span class="move tipped" tabindex="0" data-tip-move="${esc(name)}">${esc(name)}</span>` : `<span class="move">${esc(name)}</span>`;
}

// One bubble a message, whatever it mixes: the player's own words as plain text, the
// character's "speech" in bold, the @action on a line of its own. Only a message the GM put to
// a check wears the gold border, with the move it was rolled as (and the one the player named,
// when the GM changed it); its roll card goes right under it.
function postHtml(m) {
  const me = m.from === 'user';
  const label = me ? '나' : seatOf(m.from)?.label || '';
  const who = me ? `${esc(charName(m.from))} · 나` : `<b>${esc(charName(m.from))}</b>${label ? ` · ${esc(label)}` : ''}`;
  const ck = m.check;
  const tag = ck ? `<div class="checktag">${ck.was ? `<s>${esc(ck.was)}</s><span class="muted">→</span>` : ''}${moveTag(ck.move)}</div>`
    : m.move ? `<div class="named"><span class="muted">부른 액션</span> ${moveTag(m.move)}</div>` : '';
  const body = partsOf(m).map((p) => (p.k === 'say' ? `<div class="say rv">${esc(p.text)}</div>`
    : p.k === 'act' ? `<div class="act"><span class="at" aria-hidden="true">@</span><span class="rv">${esc(p.text)}</span></div>`
      : `<div class="talk">${p.answer ? '<span class="muted">답</span> ' : ''}<span class="rv">${esc(p.text)}</span></div>`)).join('');
  return `<div class="msg post${me ? ' me' : ''}${ck ? ' checked' : ''}${m.chat ? ' chatter' : ''}" data-id="${m.id}">${avatar(m.from)}<div class="bubble">
    <div class="who">${who}</div>${tag}${body}</div></div>`;
}

function msgHtml(m, fresh) {
  if (hiddenFromMe(m)) return '';
  switch (m.type) {
    case 'whisper':
      return `<div class="msg whisper"><span class="tag">귓속말 → ${esc(m.to === 'user' ? '나' : charName(m.to))}</span> ${esc(m.text)}</div>`;
    case 'narration':
      if (m.cont) return `<article class="msg narration cont"><span class="rv">${esc(m.text)}</span></article>`;
      return `<article class="msg narration"><span class="tag">${aiGm() ? `${face(camp()?.gmStyle)}` : ''}${esc(gmName())}${seatOf('gm') ? ` · ${esc(seatOf('gm').label)}` : ''}</span><span class="rv">${esc(m.text)}</span></article>`;
    // An NPC's line, voiced by the GM but heard from the NPC.
    case 'npc':
      return `<div class="msg npc"><span class="avatar npc" style="background:${npcColor(m.name)}" aria-hidden="true">${esc((m.name || '?').slice(0, 1))}</span><div class="bubble">
        <div class="who"><b>${esc(m.name)}</b> · NPC</div><div class="say rv">${esc(m.text)}</div>
      </div></div>`;
    case 'scene': {
      const [title, ...rest] = m.text.split(' — ');
      // The title marks the change; the place itself is told by the narration that follows
      // (and kept in the scene tab).
      return `<div class="msg scene" title="${esc(rest.join(' — '))}">${esc(title)}</div>`;
    }
    // A player's message; older saves' declarations, OOC lines and party talk look the same.
    case 'player': case 'declare': case 'ooc': case 'talk':
      return postHtml(m);
    case 'roll':
      return rollHtml(m, fresh);
    default: {
      // "도윤의 선택: …" is already on the roll card (✔ …); the line is for the GM's log.
      if (m.choice) return '';
      // A character's bonds: one line, opened on demand.
      if (m.bonds || m.text?.startsWith('🤝 ')) {
        const [head, ...rest] = m.text.split('\n');
        return `<details class="msg system bonds"><summary>${esc(head)} <span class="muted">${rest.length}개</span></summary><div>${esc(rest.join('\n'))}</div></details>`;
      }
      // Someone falling, coming to, or the whole party down: said louder than the rest.
      const cls = m.ledger ? ' ledger' : m.down === 'up' ? ' rise' : m.down || m.wipe ? ' fall' : m.effect ? ' effect' : m.from === 'gm' ? ` intro${m.cont ? ' cont' : ''}` : m.clue ? ' clue' : '';
      return `<div class="msg system${cls}">${m.from === 'gm' && !m.effect && !m.ledger ? `<span class="rv">${esc(m.text)}</span>` : esc(m.text)}</div>`;
    }
  }
}

// Where a roll card goes: right under the message it answers (after any card already there).
function attachPoint(box, of) {
  let el = box.querySelector(`[data-id="${of}"]`);
  if (!el) return null;
  while (el.nextElementSibling?.dataset.of === String(of)) el = el.nextElementSibling;
  return el;
}

function appendMsg(m, fresh) {
  const box = $('#log');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  box.querySelector('.empty')?.remove();
  const html = msgHtml(m, fresh);
  if (!html) return null;
  const at = m.of && attachPoint(box, m.of);
  if (at) at.insertAdjacentHTML('afterend', html);
  else box.insertAdjacentHTML('beforeend', html);
  if (near || m.from === 'user') box.scrollTop = box.scrollHeight;
  return at ? at.nextElementSibling : box.lastElementChild;
}

// The log in reading order: each roll card right after the message it answers.
function readingOrder(list) {
  const ids = new Set(list.map((m) => m.id));
  const under = new Map();
  for (const m of list) if (m.of && ids.has(m.of)) under.set(m.of, [...(under.get(m.of) || []), m]);
  const out = [];
  for (const m of list) {
    if (m.of && ids.has(m.of)) continue;
    out.push(m, ...(under.get(m.id) || []));
  }
  return out;
}

// New messages are shown one after another: each waits until the text before it has been
// revealed. The server never waits for people to read; the page keeps the pace, and the
// models may run ahead of it ("▶▶ 빨리 감기" catches up).
const showQueue = [];
let shown = null; // what is being shown now: { finish() }
let skipping = false;
let showGen = 0; // bumps when the log is redrawn; a reveal from before stops there

function enqueue(m) {
  if (m.from === 'user') skipAhead(); // your own words: what came before is shown at once
  showQueue.push(m);
  if (!shown) showNext();
  renderTurnbar();
}

function showNext() {
  shown = null;
  const gen = showGen;
  const next = () => { if (gen === showGen) showNext(); };
  while (showQueue.length) {
    // A beat between one bubble or box and the next. The next sentence of the same narration
    // joins the box above without one (sentence ends already pause); an NPC line in between
    // is a bubble of its own and gets its beat.
    const up = showQueue[0];
    const joins = up.cont && up.type === lastShownType && up.type !== 'npc';
    const wait = restUntil - Date.now();
    if (!skipping && wait > 0 && !joins && up.from !== 'user') {
      const t = setTimeout(next, wait);
      shown = { finish() { clearTimeout(t); next(); } };
      break;
    }
    const m = showQueue.shift();
    const node = appendMsg(m, true);
    if (node) lastShownType = m.type;
    if (!node || skipping || m.from === 'user') continue;
    shown = reveal(node, next);
    if (shown) break;
    // A roll card gets a moment to land before what follows.
    if (m.type === 'roll' && REVEAL_MS[camp()?.pace]) {
      const t = setTimeout(next, 600);
      shown = { finish() { clearTimeout(t); next(); } };
      break;
    }
  }
  renderTurnbar();
}

function skipAhead() {
  skipping = true;
  if (shown) shown.finish();
  else showNext();
  skipping = false;
}

// The text of a message sits dim first, so the eye can read ahead, and each 어절 brightens in
// turn, a little longer at a comma or a sentence's end. The pace is the campaign's (header
// button); "즉시" or reduced motion shows it at once. Returns { finish } or null.
const REVEAL_MS = { slow: 55, normal: 34, fast: 22 }; // per character
const BEAT_MS = { slow: 800, normal: 500, fast: 300 }; // the rest after a speech is revealed
let restUntil = 0;
let lastShownType = '';
function reveal(node, done) {
  const ms = REVEAL_MS[camp()?.pace];
  const parts = [...node.querySelectorAll('.rv')];
  if (!ms || !parts.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const words = [];
  for (const el of parts) {
    // Split on spaces only; line breaks stay with their 어절 (the text is pre-wrap).
    el.innerHTML = el.textContent.split(/( +)/).map((t) => (/^ +$/.test(t) || !t ? esc(t) : `<span class="w">${esc(t)}</span>`)).join('');
    el.classList.add('dim');
    words.push(...el.querySelectorAll('.w'));
  }
  let timer = null, i = 0, over = false;
  const r = {
    finish() {
      if (over) return;
      over = true;
      clearTimeout(timer);
      for (const el of parts) el.classList.replace('dim', 'lit');
      restUntil = Date.now() + (BEAT_MS[camp()?.pace] || 0);
      done();
    },
  };
  const step = () => {
    const w = words[i++];
    if (!w) return r.finish();
    w.classList.add('on');
    const t = w.textContent;
    timer = setTimeout(step, ms * t.length * 0.9 + 60 + (/[.!?…]["”']?$/.test(t) ? 260 : /,$/.test(t) ? 140 : 0));
  };
  timer = setTimeout(step, 120);
  return r;
}

function renderLog() {
  const box = $('#log');
  // Drawing the whole log shows everything; nothing is left waiting to be revealed.
  showGen++;
  showQueue.length = 0;
  shown = null;
  if (!camp()) {
    box.innerHTML = '<div class="empty"><h2>What Do You Do?</h2><p>AI GM과 AI 플레이어들이 함께하는 TRPG 테이블.<br>새 캠페인으로 시작하세요.</p><button id="emptyNew">새 캠페인</button></div>';
    $('#emptyNew').onclick = openSetup;
    return;
  }
  box.innerHTML = readingOrder(log).map((m) => msgHtml(m, false)).join('');
  box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------------------
// Party, story, sheets

function renderParty() {
  const box = $('#party');
  if (!camp()) { box.innerHTML = ''; return; }
  box.innerHTML = state.seats.map((s) => {
    const st = `st-${s.status}`;
    const status = `<span class="status">${STATUS[s.status] || ''}</span>`;
    if (s.key === 'gm') {
      return `<button class="seat gm ${st}" data-seat="gm" aria-label="${esc(gmName())} ${esc(s.label)}: 이야기 보기">${avatar('gm')}
        <span class="info"><span class="name">${esc(gmName())}</span><span class="sub">${esc(s.label)}</span></span>${status}</button>`;
    }
    const ch = chars()[s.key];
    if (!ch) {
      return `<button class="seat ${st}" data-seat="${s.key}" disabled>${avatar(s.key)}<span class="info"><span class="name">만드는 중…</span><span class="sub">${esc(s.label)}</span></span>${status}</button>`;
    }
    const tracks = tracksOf(ch).filter((t) => t.label === 'HP' || t.kind === 'san');
    const me = s.key === 'user' ? ' (나)' : '';
    return `<button class="seat ${st}" data-seat="${s.key}" aria-label="${esc(ch.name)} 시트 열기">${avatar(s.key)}
      <span class="info"><span class="name${me ? ' me-tag' : ''}">${esc(ch.name)}${me}</span><span class="sub">${esc(s.label)}</span><span class="concept">${esc(ch.concept)}</span></span>
      ${status}
      <span class="bars">${tracks.map(bar).join('')}<span class="hptext">${tracks.map((t) => `${esc(t.label)} ${t.value}/${t.max}`).join(' · ')}</span>
      ${ch.conditions?.length ? `<span class="conds">${ch.conditions.map((x) => `<span>${esc(x)}</span>`).join('')}</span>` : ''}</span>
    </button>`;
  }).join('');
}

// Ledger facts in plain words, grouped (인물(브론, 대장장이) → 인물: "브론 — 대장장이").
// Clues have their own notebook, and the clue-path bookkeeping is the GM's.
const FACT_GROUPS = [
  ['인물', '인물', ([a, b]) => [a, b]], ['장소', '장소', ([a, b]) => [a, b]], ['물건', '물건', ([a, b]) => [a, b]],
  ['위치', '어디에 있나', ([a, b]) => [a, `${b}에 있다`]], ['소유', '누가 가졌나', ([a, b]) => [b, `${a}이(가) 가졌다`]],
  ['상태', '상태', ([a, b]) => [a, b]], ['사망', '상태', ([a]) => [a, '죽었다']], ['관계', '관계', ([a, b, r]) => [`${a} ↔ ${b}`, r]],
  ['목표', '목표', ([a, b]) => [a, b]], ['비밀', '비밀', ([a, b]) => [a, b]], ['사건', '일어난 일', ([, b]) => [b]],
  ['진실', '알게 된 진실', ([a]) => [a]], ['시계', '다가오는 위협', ([a], f) => [a, `${f.value}/${f.max}`]],
];
function factGroups(list) {
  const out = new Map();
  for (const [p, group, say] of FACT_GROUPS) {
    for (const f of list.filter((x) => x.p === p)) {
      const [head, rest] = say(f.args, f);
      if (!out.has(group)) out.set(group, []);
      out.get(group).push(rest ? `<b>${esc(head)}</b> — ${esc(rest)}` : esc(head));
    }
  }
  return [...out];
}

function renderStory() {
  const c = camp();
  const box = $('#tab-scene');
  if (!c) { box.innerHTML = '<p class="muted">캠페인이 없어요.</p>'; return; }
  // Clues are 단서(이름, 내용) facts the viewer's side knows (plus the old notebook list).
  const known = c.knownFacts || [];
  const clues = [...(c.clues || []), ...known.filter((t) => t.startsWith('단서(')).map((t) => t.slice(3, -1).replace(', ', ' — '))];
  const facts = factGroups(c.knownList || []);
  box.innerHTML = `
    <p class="storyhead">${esc(c.title || '준비 중')}</p>
    <p class="muted">${esc(c.rulesLabel || '')} · ${esc(c.premise)}${c.tone ? ` · ${esc(c.tone)}` : ''}</p>
    ${c.pitch ? `<div class="pre">${esc(c.pitch)}</div>` : ''}
    ${c.scene?.title ? `<h3>${esc(c.scene.title)}</h3><p>${esc(c.scene.description)}</p>` : ''}
    ${clues.length ? `<h3>단서 수첩</h3><ul class="clues">${clues.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${facts.length ? `<h3>${c.userRole === 'player' ? '내 캐릭터가 아는 사실' : '모두가 아는 사실'}</h3>${facts.map(([name, items]) => `<div class="factgroup"><h4>${esc(name)}</h4><ul class="facts plain">${items.map((t) => `<li><span>${t}</span></li>`).join('')}</ul></div>`).join('')}` : ''}
    ${c.foes?.length ? `<h3>적</h3>${c.foes.map((f) => `<div class="foe"><div><b>${esc(f.name)}</b>${f.boss ? ` <span class="bossbadge">보스${f.down ? ' · 쓰러짐' : ''}</span>` : ''} <span class="muted">${[f.armor ? `갑옷 ${f.armor}` : '', f.damage ? `피해 ${esc(f.damage)}` : '', f.attack ? `공격 ${f.attack}` : '', f.dodge ? `회피 ${f.dodge}` : ''].filter(Boolean).join(' · ')}</span></div>
      ${f.boss ? (f.note ? `<div class="muted">${esc(f.note)}</div>` : '') : `${bar({ value: f.hp, max: f.maxHp })}<div class="muted">HP ${f.hp} / ${f.maxHp}${f.note ? ` · ${esc(f.note)}` : ''}</div>`}</div>`).join('')}` : ''}
    ${c.summary ? `<h3>지금까지의 이야기</h3><div class="pre">${esc(c.summary)}</div>` : ''}
    <h3>진행</h3><p>라운드 ${c.round}</p>
    ${c.userRole !== 'gm' ? `<h3>마스터 성향</h3>${stylePick(c.gmStyle || 'strict')}` : ''}`;
}

// The AI GM's temper (lib/prompts.mjs GM_STYLES) as a pick-one card: the name, what tells them apart at a
// glance, who they are at the table (two lines), and what they do before a roll. `short` is the story panel's line.
const GM_STYLE = {
  strict: {
    label: '깐깐하게', tag: '물어보고 굴림',
    intro: ['자리, 장비, 꼬인 일까지 다 기억하는 사람이에요.', '없던 밧줄을 꺼내면 "그거 언제 챙겼어요?" 해요.'],
    sig: { name: '굴리기 전에 한 번 묻기', text: '부른 액션을 바꾸거나 "베고 숨는다"에서 베기만 굴릴 거면, 주사위 전에 먼저 물어봐요.' },
    short: '허구를 꼼꼼히 따져요. 부른 액션을 바꾸거나 말한 것보다 적게 굴릴 땐 먼저 물어봐요.',
  },
  easy: {
    label: '너그럽게', tag: '바로 굴림',
    intro: ['웬만하면 "좋아요, 해 봐요" 하는 사람이에요.', '"주머니에 밧줄 있었죠?" 하면 있었던 걸로 해요.'],
    sig: { name: '말한 그대로 한 번에', text: '부른 액션 그대로, "베고 숨는다"면 둘 다 걸고 한 번에 굴려요. 따로 묻지 않아요.' },
    short: '웬만하면 하게 해 줘요. 말한 걸 통째로 한 판정에 걸고, 묻지 않고 바로 굴려요.',
  },
};
// Mid-game switch (story panel): a compact pair of face cards and what the current one means.
function stylePick(cur) {
  return `<div class="stylepick" role="radiogroup" aria-label="마스터 성향">${Object.entries(GM_STYLE).map(([k, s]) => `<button type="button" data-gmstyle="${k}" role="radio" aria-checked="${cur === k}" class="${cur === k ? 'on' : ''}">${face(k)}<span><b>${s.label}</b><small>${s.tag}</small></span></button>`).join('')}</div>
    <p class="muted">${esc(GM_STYLE[cur]?.short || '')}</p>`;
}

function sheetHtml(ch, full) {
  const sh = ch.sheet || { badges: [], stats: Object.entries(ch.stats || {}).map(([label, v]) => ({ label, value: sign(v) })), lists: [], tracks: [] };
  const tracks = tracksOf(ch);
  const lore = [['외모', ch.appearance], ['성격', ch.personality], ['배경', ch.background]].filter(([, v]) => v);
  return `<section class="sheetcard${full ? ' plain' : ''}${ch.down ? ` fallen ${ch.down}` : ''}">
    <div class="ident">${avatar(ch.key)}<div><div class="nm">${esc(ch.name)}</div><div class="cp">${esc(ch.concept)} · ${esc(seatOf(ch.key)?.label || '')}</div></div></div>
    <div class="tracks">${tracks.map((t) => `<div class="track${t.kind ? ` ${t.kind}` : ''}"><span>${esc(t.label)}</span><b>${t.value}<small> / ${t.max}</small></b>${t.label === 'HP' ? bar(t) : ''}</div>`).join('')}</div>
    ${ch.conditions?.length ? `<div class="conds">${ch.conditions.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
    ${sh.badges.length ? `<div class="badges">${sh.badges.map((b) => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
    <div class="statgrid${sh.stats.length === 8 ? ' eight' : ''}">${sh.stats.map((s) => `<div class="${s.warn ? 'warn' : ''}">${esc(s.label)}<b>${esc(s.value)}</b>${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</div>`).join('')}</div>
    ${sh.lists.map((l) => `<div class="sublist"><h4>${esc(l.title)}</h4><ul>${l.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}
    ${ch.items?.length ? `<div class="sublist"><h4>소지품</h4><ul>${ch.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}
    ${lore.length ? `<div class="lore">${lore.map(([k, v]) => `<div><b>${k}</b> ${esc(v)}</div>`).join('')}</div>` : ''}
  </section>`;
}

function renderSheets() {
  const list = Object.values(chars());
  $('#tab-sheets').innerHTML = list.length ? list.map((ch) => sheetHtml(ch, false)).join('') : '<p class="muted">아직 캐릭터가 없어요.</p>';
  if (sheetKey) {
    const ch = chars()[sheetKey];
    if (!ch) { closeSheet(); return; }
    $('#sheetBody').innerHTML = sheetHtml(ch, true);
    $('#sheetRules').textContent = camp()?.rulesLabel || '';
  }
}

function openSheet(key) {
  if (!chars()[key]) return;
  sheetKey = key;
  renderSheets();
  $('#sheetPage').hidden = false;
  $('#sheetBack').focus();
}
function closeSheet() {
  sheetKey = null;
  $('#sheetPage').hidden = true;
}

async function renderSecrets() {
  const box = $('#secretsBody');
  if (!secretsOpen) { box.innerHTML = ''; $('#peekBtn').textContent = '엿보기'; return; }
  $('#peekBtn').textContent = '가리기';
  const s = await fetch('/api/secrets').then((r) => r.json());
  const groups = {};
  for (const f of s.facts || []) (groups[f.p] ??= []).push(f);
  const table = Object.entries(groups).map(([p, fs]) => `<div class="factgroup"><h4>${esc(p)}</h4><ul class="facts">${fs.map((f) => `<li><span>${esc(f.text)}</span><span class="who ${f.known === '비밀' ? 'secret' : f.known === '모두' ? 'all' : 'some'}">${esc(f.known)}</span></li>`).join('')}</ul></div>`).join('');
  const graph = (s.conclusions || []).map((a) => {
    const state = a.deducible ? 'deducible' : a.blocked ? 'blocked' : 'progress';
    const word = { deducible: '추론 가능', blocked: '막힘', progress: '진행 중' }[state];
    const seg = (n, cls) => Array.from({ length: n }, () => `<i class="${cls}"></i>`).join('');
    return `<section class="concl ${state}">
      <div class="ch"><b>${esc(a.name)}</b><span class="badge">${word}</span></div>
      <div class="ct">${esc(a.text)}</div>
      <div class="meter" aria-label="확보 ${a.known}, 열림 ${a.open}, 소실 ${a.lost}">${seg(a.known, 'known')}${seg(a.open, 'open')}${seg(a.lost + a.missing, 'lost')}</div>
      <div class="muted">확보 ${a.known} · 열림 ${a.open}${a.lost ? ` · 소실 ${a.lost}` : ''} / 필요 ${a.need}${a.thin ? ' · 근거가 3개 미만' : ''}</div>
      <ul class="cluepath">${a.support.map((c) => `<li class="${c.status}"><span class="dot" aria-hidden="true"></span><div><b>${esc(c.clue)}</b> <span class="st">${{ known: '확보', open: '열림', lost: '소실', missing: '장부에 없음' }[c.status]}${c.who.length ? ` · ${c.who.map(esc).join(', ')}` : ''}</span>
        ${c.text ? `<div class="muted">${esc(c.text)}</div>` : ''}${c.sources.length ? `<div class="src">← ${c.sources.map(esc).join(', ')}</div>` : ''}</div></li>`).join('')}</ul>
    </section>`;
  }).join('');
  const bosses = (s.bosses || []).map((b) => `<section class="concl${b.down ? ' deducible' : ''}"><div class="ch"><b>${esc(b.name)}</b><span class="badge">${b.down ? '쓰러짐' : `${b.phase}단계`}</span></div>
    <div class="meter" aria-label="진행 ${b.progress}/${b.clock}">${Array.from({ length: b.clock }, (_, i) => `<i class="${i < b.progress ? 'known' : ''}"></i>`).join('')}</div>
    <div class="muted">진행 ${b.progress} / ${b.clock}</div></section>`).join('');
  box.innerHTML = (bosses ? `<h3>보스 진행</h3>${bosses}` : '') + (graph ? `<h3>단서 그래프</h3>${graph}` : '')
    + `<h3>진실 표 (사실 장부)</h3>${table || '<p class="muted">아직 비어 있어요.</p>'}`
    + (s.rules?.length ? `<h3>규칙</h3><ul class="rules">${s.rules.map((r) => `<li class="${r.fired.length ? 'fired' : ''}">
        <div class="rh"><b>${esc(r.name)}</b>${r.ending ? '<span class="who secret">결말</span>' : ''}${r.repeat ? '<span class="who">반복</span>' : ''}<span class="who ${r.fired.length ? 'all' : ''}">${r.fired.length ? `발동 · 라운드 ${r.fired.join(', ')}` : '대기'}</span></div>
        <div class="conds-list">${r.conds.map((t) => `<span class="${t.ok ? 'ok' : ''}">${t.ok ? '✓' : '✗'} ${esc(t.text)}${t.now !== undefined ? ` (지금 ${t.now})` : ''}</span>`).join('')}</div>
        ${r.then.length ? `<div class="muted">→ ${r.then.map(esc).join(' / ')}</div>` : ''}${r.note ? `<div class="muted">${esc(r.note)}</div>` : ''}</li>`).join('')}</ul>` : '')
    + (s.rejected?.length ? `<h3>거절된 변경</h3><ul class="facts">${s.rejected.map((r) => `<li><span>${esc(r.op)}</span><span class="who secret">${esc(r.why)}</span></li>`).join('')}</ul>` : '')
    + `<h3>${esc(gmName())} 비밀 메모</h3><div class="pre">${esc(s.gmNotes || '(비어 있음)')}</div>`
    + Object.entries(s.notes || {}).map(([k, n]) => `<h3>${esc(charName(k))}의 메모</h3><div class="pre">${esc(n || '(비어 있음)')}</div>`).join('');
}

// Drawer (story panel on narrow screens)
function openDrawer(tab) {
  if (tab) selectTab(tab);
  document.body.classList.add('drawer-open');
  $('#scrim').hidden = false;
}
function closeDrawer() {
  document.body.classList.remove('drawer-open');
  $('#scrim').hidden = true;
}
function selectTab(tab) {
  $$('#tabs button').forEach((x) => { x.classList.toggle('on', x.dataset.tab === tab); x.setAttribute('aria-selected', x.dataset.tab === tab); });
  $$('.tabbody').forEach((x) => { x.hidden = x.id !== `tab-${tab}`; });
  if (tab === 'secrets') renderSecrets();
}

// ---------------------------------------------------------------------------
// Header, banner, turn line, action sheet, composer

function renderHeader() {
  const c = camp();
  $('#campaignTitle').textContent = c ? (c.title || '캠페인 준비 중') : 'What Do You Do?';
  let sub = '';
  if (c) {
    sub = PHASE[state.phase] || '';
    if (c.round > 0 && !['prep', 'ended'].includes(state.phase)) sub = `라운드 ${c.round} · ${sub}`;
    sub = `${c.rulesLabel} · ${sub}`;
    if (c.paused) sub = `멈춤 · ${sub}`;
  }
  $('#phasePill').textContent = sub;
  const pace = $('#paceBtn');
  pace.hidden = !c;
  pace.textContent = PACE_LABEL[c?.pace] || '보통';
  pace.title = `글이 나오는 속도: ${PACE_LABEL[c?.pace] || '보통'} (누르면 바뀜)`;
  const chat = $('#chatterBtn');
  chat.hidden = !c;
  chat.textContent = (mobile() ? CHATTER_SHORT : CHATTER_LABEL)[c?.chatter || 'normal'];
  chat.title = 'AI 플레이어가 테이블에서 벌어진 일에 반응하는 정도: 보통 · 적게 · 끔 (누르면 바뀜)';
  // Off: the AI players' reactions already in the log are folded away too.
  document.body.classList.toggle('chatter-off', c?.chatter === 'off');
  const pb = $('#pauseBtn');
  pb.hidden = !c || state.phase === 'ended';
  pb.innerHTML = c?.paused ? ICON.play : ICON.pause;
  pb.setAttribute('aria-label', c?.paused ? '재개' : '멈춤');
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#16141b';
}

function renderBanner() {
  const c = camp();
  const b = $('#banner');
  if (c?.error) { b.textContent = `⚠ ${c.error}`; b.className = 'banner'; b.hidden = false; return; }
  const onlyDemo = state && Object.entries(state.available || {}).every(([k, v]) => k === 'mock' || !v);
  if (onlyDemo) { b.textContent = '연결된 AI CLI가 없어서 데모봇이 모든 자리를 맡고 있어요.'; b.className = 'banner info'; b.hidden = false; return; }
  b.hidden = true;
}

function renderTurnbar() {
  const c = camp();
  const bar = $('#turnbar');
  let html = '';
  const behind = !!shown || showQueue.length > 0;
  const skip = behind ? '<button type="button" class="ghost" data-skip>▶▶ 빨리 감기</button>' : '';
  if (c?.paused) {
    html = `<span class="grow">멈춤 상태예요.</span>${skip}<button type="button" data-resume>재개</button>`;
  } else if (c && builderNeeded()) {
    html = '<span class="grow">내 캐릭터를 만들 차례예요. 다 만들 때까지 테이블이 기다려요.</span><button type="button" data-build>캐릭터 만들기</button>';
  } else if (c && state.phase !== 'ended') {
    const thinking = state.seats.filter((s) => s.status === 'thinking').map((s) => (s.key === 'gm' ? gmName() : charName(s.key)));
    const myTurn = state.phase === 'declare' && seatOf('user')?.status === 'waiting';
    const parts = [];
    if (myTurn && !thinking.length) parts.push(`<b>${esc(charName('user'))}</b>, 어떻게 하시겠습니까?`);
    else if (myTurn) parts.push('먼저 써도 돼요');
    if (thinking.length) parts.push(`${thinking.map(esc).join(', ')} 생각 중…`);
    if (state.phase === 'gm-wait') parts.push(c.wipe ? '일행이 모두 쓰러졌어요. 다음 서술로 이야기를 닫아 주세요.' : 'GM(당신)의 서술을 기다려요. 보내면 다음 라운드가 시작돼요.');
    // A fallen character: the human stays at the table, watching and talking.
    const down = c.userRole === 'player' && chars().user?.down;
    if (down === 'dead') parts.unshift(`☠ <b>${esc(charName('user'))}</b>은(는) 죽었어요. 테이블에 남아 지켜보며 말은 할 수 있어요.`);
    else if (down) parts.unshift(`💤 <b>${esc(charName('user'))}</b>은(는) 쓰러져 있어요. 누가 치료해 주면 다시 차례가 와요.`);
    // The page is still revealing what came in: offer to catch up.
    if (parts.length || behind) html = `<span class="grow">${parts.join(' · ')}</span>${myTurn ? '<button type="button" class="ghost" data-pass>넘기기</button>' : ''}${skip}`;
  }
  bar.innerHTML = html;
  bar.hidden = !html;
}

function rollOf(rid) {
  return log.find((m) => m.roll?.rid === rid)?.roll;
}

function renderActionSheet() {
  const c = camp();
  const sheet = $('#actionSheet');
  // Death's offer shows once the GM has named its price.
  const choices = (c?.pendingChoices || []).filter((p) => p.who === 'user' && p.priced !== false);
  const checks = state?.phase === 'roll' ? c?.pendingChecks || [] : [];
  const key = c && !c.paused ? [...choices.map((p) => `c${p.id}`), ...checks.map((p) => `r${p.id}`)].join(',') : '';
  if (key === actionKey) { placeSheet(); return; }
  actionKey = key;
  sheetMin = false;
  if (!key) {
    sheet.hidden = true;
    sheet.innerHTML = '';
    placeSheet();
    return;
  }
  if (choices.length) {
    const p = choices[0];
    const r = rollOf(p.rid);
    const multi = p.count > 1;
    sheet.innerHTML = `<div class="sheetchoice" data-choice="${p.id}" data-count="${p.count}">
      ${r ? `<div class="rollbody">${r.dice.map((d) => `<span class="die">${d}</span>`).join('')}<div><div class="muted">${esc(r.title || '')}${r.mod !== undefined ? ` · ${sign(r.mod)} = ${r.total}` : ''}</div><h3>${esc(r.label || '')}</h3></div></div>` : ''}
      <p class="lead">${esc(p.prompt)}</p>
      <div class="opts" role="group" aria-label="선택지">${p.options.map((o, i) => `<button type="button" class="opt${multi ? ' multi' : ''}" data-i="${i}" aria-pressed="false">${esc(o)}</button>`).join('')}</div>
      ${p.textFor >= 0 ? `<label class="choiceText" data-for="${p.textFor}" hidden>${esc(p.textLabel || '')}<textarea rows="2" maxlength="200"></textarea></label>` : ''}
      <div class="sheetactions"><button type="button" data-confirm="${p.id}" disabled>${multi ? `${p.count}개 고르기` : '고르기'}</button></div>
    </div>`;
  } else {
    const dice = DICE[c.rules] || '주사위';
    sheet.innerHTML = checks.map((p) => `<div>
      <h3>판정 차례예요</h3>
      ${p.stake ? `<p class="lead"><span class="muted">걸린 것</span> ${esc(p.stake)}</p>` : p.why ? `<p class="lead">${esc(p.why)}</p>` : ''}
      <div class="chips meta"><span>${esc(p.label || p.move || p.skill || p.stat || '')}</span>${p.difficulty && p.difficulty !== 'regular' ? `<span>${p.difficulty === 'hard' ? '어려움' : '극단'}</span>` : ''}${p.bonus ? `<span>보너스 ${p.bonus}</span>` : ''}${p.penalty ? `<span>페널티 ${p.penalty}</span>` : ''}${p.push_risk ? `<span>밀어붙였다 실패하면: ${esc(p.push_risk)}</span>` : ''}</div>
      <button type="button" class="rollcta" data-roll="${p.id}" style="width:100%">${dice} 굴리기</button>
    </div>`).join('') + (state.campaign.turn === 'user' ? '<button type="button" class="ghost retract" data-retract style="width:100%">다르게 할래요</button>' : '');
  }
  sheet.insertAdjacentHTML('afterbegin', `<div class="minline">${choices.length ? '고를 차례예요' : '판정 차례예요'} · 탭해서 열기</div>`);
  sheet.hidden = false;
  placeSheet();
}

function placeSheet() {
  const sheet = $('#actionSheet');
  const open = !sheet.hidden;
  sheet.classList.toggle('min', open && sheetMin && mobile());
  $('#sheetScrim').hidden = !(open && !sheetMin && mobile());
}

function renderComposer() {
  const c = camp();
  const role = c?.userRole;
  $('#composer').hidden = !c;
  if (!c) return;
  // One input: the player's own words, "speech" and @action in any mix (lib/post.mjs). A fallen
  // character can't act; the human can still talk at the table.
  const fallen = role === 'player' && chars().user?.down;
  const acts = role === 'player' && !fallen;
  const dw = c.rules === 'dw';
  const gmPh = `장면 서술 · NPC: "대사" · ${c.rules === 'dw' ? '/check 아본 위험 돌파 민첩성' : c.rules === 'coc7' ? '/check 오필리아 관찰력 어려움' : '/check 카엘 민첩 15'}`;
  $('#input').placeholder = role === 'gm' ? gmPh : role !== 'player' ? '테이블에 한마디' : fallen ? `말은 할 수 있어요 (${fallen === 'dead' ? '죽어서' : '쓰러져서'} 행동은 못 해요)` : '말하듯 쓰기 · “대사” · @행동';
  $('#atBtn').hidden = !acts;
  const moves = dw && acts ? state.rulesets?.dw?.moves || [] : [];
  $('#moveChips').innerHTML = moves.map((m) => `<button type="button" data-move="${esc(m.name)}" data-tip-move="${esc(m.name)}">${esc(m.name)}</button>`).join('');
  $('#moveChips').hidden = !moves.length;
}

function renderState() {
  document.body.dataset.rules = camp()?.rules || '';
  renderHeader();
  renderBanner();
  renderParty();
  renderStory();
  renderSheets();
  renderTurnbar();
  renderActionSheet();
  renderComposer();
  if (secretsOpen && !$('#tab-secrets').hidden) renderSecrets();
  renderBuilder();
}

function renderAll() {
  actionKey = null;
  renderState();
  renderLog();
}

// ---------------------------------------------------------------------------
// Setup wizard

const STEP_NAME = { rules: '룰 고르기', role: '자리 고르기', style: '성향 고르기', story: '이야기 정하기', seats: '자리 배치' };
let step = 0;
let setupRules = 'dw';
let storyGenre = null; // genre of the premise when it came from a story or the 🎲 (the builder's d20 cards follow it)
let storyPick = null; // story id, or 'gm' / 'random' / 'custom'
let rolled = null; // the 🎲 story on screen
let heroMore = false; // the picked story's questions and first scene: folded until asked for, then kept open
let storyExtra = {}; // what only the GM gets from the picked story (front, questions, opening question)
const form = () => $('#setupForm');
const ruleMeta = () => state?.rulesets?.[setupRules] || state?.rulesets?.d20;
const role = () => new FormData(form()).get('userRole');
// A human GM has no AI temper to pick, so they skip that page.
const steps = () => ['rules', 'role', ...(role() === 'gm' ? [] : ['style']), 'story', 'seats'];

function openSetup() {
  const avail = state?.available || {};
  const names = { claude: 'Claude', codex: 'ChatGPT', grok: 'Grok', agy: 'Gemini', mock: '데모봇' };
  const real = ['claude', 'codex', 'grok', 'agy'].filter((k) => avail[k]);
  const opts = (sel, allowNone) => (allowNone ? '<option value="">비움</option>' : '')
    + Object.keys(names).filter((k) => avail[k]).map((k) => `<option value="${k}"${k === sel ? ' selected' : ''}>${names[k]}</option>`).join('');
  $('#gmSelect').innerHTML = opts(real[0] || 'mock', false);
  const defaults = real.length ? ['codex', 'grok', 'agy', 'claude'].filter((k) => avail[k]).slice(0, 3) : ['mock', 'mock', 'mock'];
  $('#playerSelects').innerHTML = [0, 1, 2, 3].map((i) => `<select data-player="${i}" aria-label="AI 플레이어 ${i + 1}">${opts(defaults[i] || '', true)}</select>`).join('');
  $('#availNote').textContent = real.length
    ? `찾은 CLI: ${real.map((k) => names[k]).join(', ')}. 한 AI가 GM과 플레이어를 같이 맡아도 돼요(매번 따로 불려요).`
    : 'AI CLI를 찾지 못해서 데모봇만 쓸 수 있어요.';
  form().userName.value = loadName() || form().userName.value;
  // A rule system marked hidden is left off this screen (its campaigns still run).
  const rs = Object.values(state?.rulesets || {}).filter((r) => !r.hidden);
  if (camp()?.rules) setupRules = camp().rules;
  if (!rs.some((r) => r.id === setupRules)) setupRules = rs.find((r) => r.id === 'dw')?.id || rs[0]?.id || 'd20';
  $('#rulesSeg').innerHTML = '<legend class="sr">룰 시스템</legend>' + rs.map((r) => `<label class="rulecard"><input type="radio" name="rules" value="${r.id}"${r.id === setupRules ? ' checked' : ''}>
    <span class="rc pcard"><span class="ph"><span class="rn">${r.icon || ''} ${esc(r.label)}</span><span class="pn">${esc((r.tags || []).join(' · '))}</span></span>
    ${(r.intro || []).map((l, i) => `<span class="rd${i ? ' rd2' : ''}">${esc(l)}</span>`).join('')}
    ${r.signature ? `<span class="sig"><b>${esc(r.signature.name)}</b><span>${esc(r.signature.text)}</span></span>` : ''}</span></label>`).join('');
  // The GM's temper: big portrait cards (character-select style), the picked one's details below.
  const pick = camp()?.gmStyle || 'strict';
  $('#styleCards').innerHTML = '<legend class="sr">마스터 성향</legend>' + Object.entries(GM_STYLE).map(([k, s]) => `<label class="gmcard"><input type="radio" name="gmStyle" value="${k}"${k === pick ? ' checked' : ''}>
    <span class="gmart" style="background-image:url(${gmPortrait(k)})" aria-hidden="true"></span>
    <span class="gmname"><b>${esc(s.label)}</b><span>${esc(s.tag)}</span></span></label>`).join('');
  renderStyleDetail();
  Object.keys(GM_STYLE).forEach((k) => { new Image().src = gmPortrait(k); }); // loaded before that page opens
  step = 0;
  storyPick = null;
  renderRuleLabels();
  updateRole();
  showStep();
  $('#setupCancel').hidden = !camp();
  $('#setup').showModal();
}

function showStep() {
  const list = steps();
  step = Math.min(step, list.length - 1);
  const cur = list[step];
  $$('.step').forEach((s) => { s.hidden = s.dataset.step !== cur; });
  if (cur === 'story') renderStories();
  $('#stepBar').innerHTML = list.map((_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('');
  $('#stepCount').textContent = `${step + 1} / ${list.length}`;
  $('#stepBack').hidden = step === 0;
  const last = step === list.length - 1;
  $('#stepNext').textContent = last ? (role() === 'player' ? '시작 · 캐릭터 만들기' : '시작') : `다음 · ${STEP_NAME[list[step + 1]]}`;
  $('.dlgbody').scrollTop = 0;
}

function stepOk() {
  const cur = steps()[step];
  const f = new FormData(form());
  if (cur === 'story' && role() === 'gm' && !String(f.get('premise') || '').trim()) { toast('직접 GM을 보니 이야기를 하나 고르거나 전제를 적어 주세요'); $('#storyEdit').open = true; $('#premise').focus(); return false; }
  if (cur === 'seats' && role() !== 'player' && !$$('[data-player]').some((s) => s.value)) { toast('AI 플레이어를 한 명 이상 골라 주세요'); return false; }
  return true;
}

// Seat names follow the rules (CoC: 키퍼 / 탐사자).
function renderRuleLabels() {
  setupRules = new FormData(form()).get('rules') || setupRules;
  const m = ruleMeta();
  if (!m) return;
  $('#setup').dataset.rules = setupRules;
  $$('[data-role-label="player"]').forEach((x) => { x.textContent = m.playerName || '플레이어'; });
  $$('[data-role-label="gm"]').forEach((x) => { x.textContent = m.gmName || 'GM'; });
  $('#gmLabel').textContent = m.gmName || 'GM';
  const gm = m.gmName || 'GM';
  $('#styleQ').textContent = `어떤 ${gm}${/[가-힣]$/.test(gm) ? '가' : '이'} 좋을까요?`;
  renderHouseRules();
}

// House rules the chosen rule system offers (Dungeon World: 풀다이스 · 대실패).
function renderHouseRules() {
  const list = ruleMeta()?.houseRules || [];
  $('#houseBox').innerHTML = list.length ? `<h3 class="sub">하우스 룰</h3>${list.map((h) => `<label class="house"><input type="checkbox" name="house_${h.id}"${h.on ? ' checked' : ''}>
    <span><b>${esc(h.label)}</b><span class="muted">${esc(h.text)}</span></span></label>`).join('')}` : '';
}

function renderStyleDetail() {
  const s = GM_STYLE[new FormData(form()).get('gmStyle')] || GM_STYLE.strict;
  $('#styleDetail').innerHTML = `<div class="pcard on"><span class="rn">${esc(s.label)}</span>${s.intro.map((l, i) => `<span class="rd${i ? ' rd2' : ''}">${esc(l)}</span>`).join('')}
    <span class="sig"><b>${esc(s.sig.name)}</b><span>${esc(s.sig.text)}</span></span></div>`;
}

function updateRole() {
  $('#gmBox').hidden = role() === 'gm';
}

// ---------------------------------------------------------------------------
// Story gallery (Netflix style): the picked story large on top, poster tiles in rows below.
// Its first scene is where the GM starts (there are no episodes, so it isn't called 1화).
// Picking fills the premise, tone, first scene and length the GM gets; "직접 고치기" edits them.

function storiesFor(rules) {
  if (STORIES[rules]) return STORIES[rules];
  return PRESETS.map(([label, premise, tone, genre], i) => ({ id: `preset-${i}`, icon: '📖', row: 'genres', genre, title: label, kind: label,
    situation: premise, tone, length: 'short' })).filter((x) => RANDOM[x.genre]?.rules.includes(rules));
}

function renderStories() {
  const list = storiesFor(setupRules);
  if (!storyPick || (!STARTS.some((x) => x.id === storyPick) && !list.some((x) => x.id === storyPick))) {
    pickStory(list.length ? any(list).id : 'gm');
  }
  const starts = STARTS.filter((x) => !(x.id === 'gm' && role() === 'gm'));
  const rows = [['start', '시작 방식', starts], ...Object.entries({ ...STORY_ROWS, genres: '장르별 이야기' })
    .map(([k, name]) => [k, name, list.filter((x) => x.row === k)]).filter(([, , xs]) => xs.length)];
  $('#storyRows').innerHTML = rows.map(([k, name, xs]) => `<section class="srow"><h3 class="sub">${esc(name)}</h3><div class="stiles">${xs.map((x) => `<button type="button" class="stile r-${k}${x.id === storyPick ? ' on' : ''}" data-story="${x.id}" aria-pressed="${x.id === storyPick}">
    <span class="si" aria-hidden="true">${x.icon}</span><span class="st">${esc(x.title)}</span></button>`).join('')}</div></section>`).join('');
  renderHero();
}

function renderHero() {
  const st = storiesFor(setupRules).find((x) => x.id === storyPick);
  const start = STARTS.find((x) => x.id === storyPick);
  const x = st || (storyPick === 'random' && rolled) || start;
  const meta = st ? [st.kind, LENGTH[st.length], st.beginner ? '처음이라면 추천' : ''] : storyPick === 'random' ? ['즉석 조합', LENGTH.short] : [];
  const situation = storyPick === 'random' ? rolled?.premise : x.situation;
  $('#storyHero').innerHTML = `<div class="shart r-${st ? st.row : 'start'}" aria-hidden="true">${(st || start).icon}</div>
    <div class="shtext"><div class="shtitle">${esc(st ? st.title : start.title)}</div>
    ${meta.length ? `<div class="shmeta">${meta.filter(Boolean).map((m, i) => `<span class="${i === 2 ? 'brec' : ''}">${esc(m)}</span>`).join('')}</div>` : ''}
    ${st?.tags ? `<div class="shtags">${st.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    <p class="shsyn">${esc(situation || '')}</p>
    ${st?.questions || st?.scene ? `<details class="shmore"${heroMore ? ' open' : ''}><summary><span class="c">${[st.questions ? '이야기가 답할 질문' : '', st.scene ? '첫 장면' : ''].filter(Boolean).join(' · ')} 보기</span><span class="o">접기</span></summary>
    ${st.questions ? `<div class="shq"><b>이야기가 답할 질문</b><ul>${st.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    ${st.scene ? `<div class="shep"><b>첫 장면 · ${esc(st.scene.title)}</b><span>${esc(st.scene.text)}</span>${st.scene.ask ? `<span class="shask">${esc(ruleMeta()?.gmName || 'GM')}${/[가-힣]$/.test(ruleMeta()?.gmName || 'GM') ? '가' : '이'} 먼저 물을 것: "${esc(st.scene.ask)}"</span>` : ''}</div>` : ''}</details>` : ''}
    ${storyPick === 'random' ? '<div class="bchips"><button type="button" class="bchip dice" data-reroll>🎲 다시 뽑기</button></div>' : ''}
    ${storyPick === 'custom' ? '<p class="muted">아래 "직접 고치기"에 전제를 적어 주세요.</p>' : ''}</div>`;
}

function pickStory(id) {
  storyPick = id;
  const f = form();
  const set = (o) => { f.premise.value = o.premise || ''; f.tone.value = o.tone || ''; f.opening.value = o.opening || ''; $('#storyLength').value = o.length ?? 'short'; $('#storyTitle').value = o.title || ''; };
  const st = storiesFor(setupRules).find((x) => x.id === id);
  // A Dungeon World story also hands the GM its front, its questions and what to ask first.
  storyExtra = st?.front ? { front: st.front, questions: st.questions, openingAsk: st.scene?.ask } : {};
  if (st) {
    set({ premise: st.situation, tone: st.tone, opening: st.scene?.text, length: st.length, title: st.scene ? st.title : '' });
    storyGenre = st.genre;
  } else if (id === 'random') {
    rolled = randomStory(setupRules, f.premise.value);
    set({ premise: rolled.premise, tone: rolled.tone, length: 'short' });
    storyGenre = rolled.genre;
  } else {
    set({ length: '' });
    storyGenre = null;
    if (id === 'custom') { $('#storyLength').value = 'short'; $('#storyEdit').open = true; }
  }
}

// A player's character is made in the character builder once the campaign starts.
function submitSetup() {
  const f = new FormData(form());
  const players = $$('[data-player]').map((s) => s.value).filter(Boolean);
  saveName(String(f.get('userName') || '').trim());
  api('/api/campaign', {
    rules: f.get('rules'), premise: f.get('premise'), tone: f.get('tone'),
    title: f.get('storyTitle'), opening: f.get('opening'), length: f.get('storyLength'), gmOnly: f.get('gmOnly'), ...storyExtra,
    userName: f.get('userName'), userRole: role(), gm: f.get('gm'), players,
    house: Object.fromEntries((ruleMeta()?.houseRules || []).map((h) => [h.id, f.get(`house_${h.id}`) === 'on'])),
    gmStyle: f.get('gmStyle') || 'strict',
  });
  secretsOpen = false;
  log = [];
  $('#log').innerHTML = '';
  closeSheet();
  closeDrawer();
  $('#setup').close();
}

// ---------------------------------------------------------------------------
// Events

$('#newBtn').onclick = openSetup;
$('#newBtn2').onclick = () => { closeDrawer(); openSetup(); };
$('#menuBtn').onclick = () => openDrawer();
$('#storyBtn').onclick = () => openDrawer('scene');
$('#closeSide').onclick = closeDrawer;
$('#scrim').onclick = closeDrawer;
$('#sheetBack').onclick = closeSheet;
$('#pauseBtn').onclick = () => api('/api/pause', { paused: !camp()?.paused });
$('#paceBtn').onclick = () => api('/api/pace', { pace: PACE_NEXT[camp()?.pace] || 'normal' });
$('#chatterBtn').onclick = () => api('/api/chatter', { level: CHATTER_NEXT[camp()?.chatter] || 'low' });
$('#setupCancel').onclick = () => $('#setup').close();
$('#stepBack').onclick = () => { step = Math.max(0, step - 1); showStep(); };
$('#stepNext').onclick = () => {
  if (!stepOk()) return;
  if (step === steps().length - 1) submitSetup();
  else { step++; showStep(); }
};
form().addEventListener('submit', (e) => e.preventDefault());
form().addEventListener('change', (e) => {
  if (e.target.name === 'userRole') { updateRole(); showStep(); }
  if (e.target.name === 'rules') renderRuleLabels();
  if (e.target.name === 'gmStyle') renderStyleDetail();
});
$('#storyRows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-story]');
  if (!b) return;
  pickStory(b.dataset.story);
  renderStories();
});
$('#storyHero').addEventListener('toggle', (e) => { if (e.target.matches('.shmore')) heroMore = e.target.open; }, true);
$('#storyHero').addEventListener('click', (e) => {
  if (!e.target.closest('[data-reroll]')) return;
  pickStory('random');
  renderHero();
});
// A premise typed by hand has no known genre, and the story's title no longer fits it.
$('#premise').addEventListener('input', () => { storyGenre = null; $('#storyTitle').value = ''; });

$('#party').addEventListener('click', (e) => {
  const s = e.target.closest('[data-seat]');
  if (!s) return;
  if (s.dataset.seat === 'gm') openDrawer('scene');
  else openSheet(s.dataset.seat);
});
$('#tab-scene').addEventListener('click', (e) => {
  const b = e.target.closest('[data-gmstyle]');
  if (b) api('/api/gmstyle', { style: b.dataset.gmstyle });
});
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) selectTab(b.dataset.tab);
});
$('#peekBtn').onclick = () => { secretsOpen = !secretsOpen; renderSecrets(); renderLog(); };

$('#turnbar').addEventListener('click', (e) => {
  if (e.target.closest('[data-pass]')) api('/api/pass');
  if (e.target.closest('[data-resume]')) api('/api/pause', { paused: false });
  if (e.target.closest('[data-build]')) openBuilder();
  if (e.target.closest('[data-skip]')) skipAhead();
});

$('#sheetScrim').onclick = () => { sheetMin = true; placeSheet(); };
$('#actionSheet').addEventListener('click', (e) => {
  if (sheetMin && mobile()) { sheetMin = false; placeSheet(); return; }
  const roll = e.target.closest('[data-roll]');
  if (roll) { roll.disabled = true; api('/api/roll', { id: roll.dataset.roll }); return; }
  // Seen what's at stake and changed their mind: the roll is taken back, the turn stays theirs.
  const back = e.target.closest('[data-retract]');
  if (back) { back.disabled = true; api('/api/retract'); return; }
  const opt = e.target.closest('.opt');
  if (opt) {
    const box = opt.closest('[data-choice]');
    const count = Number(box.dataset.count);
    if (count === 1) box.querySelectorAll('.opt.on').forEach((x) => { if (x !== opt) x.classList.remove('on'); });
    opt.classList.toggle('on');
    const on = [...box.querySelectorAll('.opt.on')];
    // Picking past the limit drops the earliest pick.
    if (on.length > count) on.find((x) => x !== opt).classList.remove('on');
    box.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-pressed', x.classList.contains('on')));
    box.querySelector('[data-confirm]').disabled = box.querySelectorAll('.opt.on').length !== count;
    const t = box.querySelector('.choiceText');
    if (t) {
      t.hidden = !box.querySelector(`.opt.on[data-i="${t.dataset.for}"]`);
      if (!t.hidden) t.querySelector('textarea').focus();
    }
    return;
  }
  const ok = e.target.closest('[data-confirm]');
  if (ok) {
    const box = ok.closest('[data-choice]');
    ok.disabled = true;
    api('/api/choose', { id: ok.dataset.confirm, picks: [...box.querySelectorAll('.opt.on')].map((x) => Number(x.dataset.i)), text: box.querySelector('.choiceText textarea')?.value || '' });
  }
});

// "@" starts an action line (a phone keyboard hides @ a layer down).
$('#atBtn').addEventListener('click', () => {
  const input = $('#input');
  const v = input.value.replace(/[ \t]+$/, '');
  if (!/(^|\n)[@＠][^\n]*$/.test(v)) input.value = `${v}${v && !v.endsWith('\n') ? '\n' : ''}@`;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  autosize();
});
$('#moveChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-move]');
  if (!b) return;
  const input = $('#input');
  input.value = `[${b.dataset.move}] ${input.value.replace(/^\s*\[[^\]]*\]\s*/, '')}`;
  input.focus();
  autosize();
});
function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight + 2, 140)}px`;
}
$('#input').addEventListener('input', autosize);
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#input').value.trim();
  if (!text) return;
  const r = await api('/api/post', { text });
  if (r.ok) { $('#input').value = ''; autosize(); }
});
$('#input').addEventListener('keydown', (e) => {
  // Enter sends on a keyboard; on a phone the return key makes a new line.
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mobile()) { e.preventDefault(); $('#composer').requestSubmit(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#sheetPage').hidden) closeSheet();
  else if (document.body.classList.contains('drawer-open')) closeDrawer();
});
matchMedia('(max-width: 899px)').addEventListener('change', placeSheet);

// ---------------------------------------------------------------------------
// Move tooltips: a move's name says only its name. What it does shows on hover (mouse),
// on a long press (touch), or on focus (keyboard).

const tip = Object.assign(document.createElement('div'), { id: 'tip', role: 'tooltip', hidden: true });
document.body.append(tip);
let tipFor = null, tipTimer = null, tipPress = null, tipSwallowClick = false;

function moveTipHtml(name, tier) {
  const info = moveInfo(name);
  if (!info) return '';
  const row = (t, k, text) => (text ? `<div class="tiprow${tier === t ? ' hit' : ''}"><b>${k}</b><span>${esc(text)}</span></div>` : '');
  const stat = info.stat && !['없음', '인연'].includes(info.stat) ? ` <span class="muted">${esc(info.stat)}</span>` : info.stat === '인연' ? ' <span class="muted">+인연</span>' : '';
  return `<div class="tiphead"><b>${esc(name)}</b>${stat}</div>
    ${info.when ? `<div class="tipwhen">${esc(info.when)}</div>` : ''}
    ${row('good', '10+', info.strong)}${row('mixed', '7~9', info.weak)}${row('bad', '6-', info.miss)}
    ${info.after ? `<div class="tipwhen">${esc(info.after)}</div>` : ''}`;
}

function showTip(el) {
  const html = moveTipHtml(el.dataset.tipMove, el.dataset.tier);
  if (!html) return;
  tip.innerHTML = html;
  tip.hidden = false;
  tipFor = el;
  const r = el.getBoundingClientRect();
  const w = Math.min(320, innerWidth - 32);
  tip.style.width = `${w}px`;
  tip.style.left = `${Math.max(16, Math.min(r.left, innerWidth - w - 16))}px`;
  const h = tip.offsetHeight;
  tip.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
}
function hideTip() {
  clearTimeout(tipTimer);
  tip.hidden = true;
  tipFor = null;
}

document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest('[data-tip-move]');
  if (!el || el === tipFor) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(el), 250);
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest('[data-tip-move]');
  if (el && !el.contains(e.relatedTarget)) hideTip();
});
// Touch: hold for a moment. Lifting or sliding away before then is an ordinary tap or scroll.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  tipSwallowClick = false; // a long press that ended without a click leaves nothing to swallow
  const el = e.target.closest('[data-tip-move]');
  if (!el) { if (!tip.contains(e.target)) hideTip(); return; }
  clearTimeout(tipTimer);
  tipPress = { x: e.clientX, y: e.clientY };
  tipTimer = setTimeout(() => { tipPress = null; tipSwallowClick = true; showTip(el); }, 450);
});
document.addEventListener('pointermove', (e) => {
  if (!tipPress || Math.hypot(e.clientX - tipPress.x, e.clientY - tipPress.y) < 10) return;
  clearTimeout(tipTimer);
  tipPress = null;
});
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, (e) => { if (e.pointerType !== 'mouse' && tipPress) { clearTimeout(tipTimer); tipPress = null; } });
}
// The tap that ends a long press doesn't also press the button under it (a move chip).
document.addEventListener('click', (e) => {
  if (!tipSwallowClick) return;
  tipSwallowClick = false;
  e.preventDefault();
  e.stopPropagation();
}, true);
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-tip-move]')) e.preventDefault(); });
document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-tip-move]'); if (el) showTip(el); });
document.addEventListener('focusout', (e) => { if (e.target.closest?.('[data-tip-move]')) hideTip(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
$('#log').addEventListener('scroll', () => { if (!tip.hidden) hideTip(); }, { passive: true });

initBuilder({ $, esc, toast, api, sheetHtml, state: () => state, genre: () => storyGenre, rerender: renderState });
connect();
