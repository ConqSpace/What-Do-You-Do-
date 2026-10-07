// Table UI: one SSE stream (init → msg / update / state), a handful of POSTs.
// Mobile first: avatar strip, log, composer; the story panel is a drawer, rolls and
// choices come up in a bottom sheet, a character sheet is a full page.

import { ARCHETYPES } from './archetypes.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// Old d20 rolls (before rule modules) carried only `outcome`.
const OUTCOME = { critical: '대성공', success: '성공', failure: '실패', fumble: '대실패' };
const OLD_TIER = { critical: 'crit', success: 'good', failure: 'bad', fumble: 'fumble' };
const PHASE = { setup: '준비 전', prep: '캠페인 준비 중', declare: '선언', resolve: '판정 중', roll: '주사위 · 선택', 'gm-wait': 'GM 서술 대기', ended: '종료' };
const STATUS = { thinking: '생각 중', done: '✓ 선언', waiting: '차례 대기', rolling: '굴릴 차례', choosing: '고르는 중', idle: '' };
const DICE = { d20: 'd20', dw: '2d6', coc7: 'd100' };
// [label, premise, tone, genre (a key of RANDOM)]
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
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
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
let mode = 'declare';
let lastRole = null;
let secretsOpen = false;
let sheetKey = null; // character shown on the sheet page
let actionKey = ''; // what the action sheet currently shows (keeps selections across redraws)
let sheetMin = false; // phone: the sheet folded to one line
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
    const html = msgHtml(m, false);
    if (html) $(`#log [data-id="${m.id}"]`)?.replaceWith(htmlToNode(html));
  });
  es.addEventListener('msg', (e) => {
    const m = JSON.parse(e.data);
    log.push(m);
    appendMsg(m, true);
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
function avatar(key) {
  const label = key === 'gm' ? gmName().slice(0, 2) : (charName(key) || '?').slice(0, 1);
  return `<span class="avatar${key === 'gm' ? ' gm' : ''}" style="background:${colorOf(key)}" aria-hidden="true">${esc(label)}</span>`;
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
  const target = r.target || (r.dc ? `DC ${r.dc}` : '');
  const dice = r.dice.map((d) => `<span class="die">${d}</span>`).join('');
  const body = r.mod === undefined
    ? `${dice}<span class="muted">${esc(target)}</span>`
    : `${dice}<span class="muted">${sign(r.mod)}</span><span class="muted">=</span><span class="total">${r.total}</span><span class="muted">${esc(target)}</span>`;
  const lines = [];
  if (r.text) lines.push(`<div class="rolltext">${esc(r.text)}${r.after ? ` <span class="muted">(${esc(r.after)})</span>` : ''}</div>`);
  if (r.diceNote) lines.push(`<div class="rolltext muted">${esc(r.diceNote)}</div>`);
  if (r.selfDamage) lines.push(`<div class="rolltext">받은 피해 <b>${r.selfDamage.total}</b></div>`);
  if (r.damage) lines.push(`<div class="rolltext">피해 ${esc(r.damage.expr)} = <b>${r.damage.total}</b>${r.damage.target ? ` → ${esc(r.damage.target)}` : ''}</div>`);
  if (r.pendingChoice) lines.push('<div class="rolltext muted">선택을 기다리는 중…</div>');
  if (r.chosen?.length) lines.push(`<div class="rolltext">✔ ${r.chosen.map(esc).join(' / ')}</div>`);
  if (r.notes?.length) lines.push(`<div class="rolltext muted">${r.notes.map(esc).join(' · ')}</div>`);
  if (r.why) lines.push(`<div class="rolltext muted">${esc(r.why)}</div>`);
  return `<div class="msg" data-id="${m.id}"><section class="roll tier-${tier}${r.who === 'user' ? ' mine' : ''}${fresh ? ' fresh' : ''}" aria-label="판정">
    <div class="rollhead"><span class="who"><b>${esc(charName(r.who))}</b> · ${esc(title)}</span><span class="res">${esc(label)}</span></div>
    <div class="rollbody">${body}</div>${lines.join('')}</section></div>`;
}

// Whispers reach only their target; the ledger's change notes are the GM's. Spectators,
// a human GM and anyone peeking at secrets see both.
function hiddenFromMe(m) {
  if (!m.to) return false;
  if (secretsOpen) return false;
  if (m.ledger) return true;
  return camp()?.userRole === 'player' && m.to !== 'user';
}

function msgHtml(m, fresh) {
  if (hiddenFromMe(m)) return '';
  switch (m.type) {
    case 'whisper':
      return `<div class="msg whisper"><span class="tag">${esc(gmName())}의 귓속말 → ${esc(m.to === 'user' ? '나' : charName(m.to))}</span>${esc(m.text)}</div>`;
    case 'narration':
      return `<article class="msg narration"><span class="tag">${esc(gmName())}${seatOf('gm') ? ` · ${esc(seatOf('gm').label)}` : ''}</span>${esc(m.text)}</article>`;
    case 'scene': {
      const [title, ...rest] = m.text.split(' — ');
      return `<div class="msg scene">${esc(title)}<small>${esc(rest.join(' — '))}</small></div>`;
    }
    case 'declare': {
      const me = m.from === 'user';
      const ch = chars()[m.from];
      const who = me ? `${esc(charName(m.from))}${ch?.concept ? ` · ${esc(ch.concept)}` : ''} · 나` : `<b>${esc(charName(m.from))}</b>${ch?.concept ? ` · ${esc(ch.concept)}` : ''} · ${esc(seatOf(m.from)?.label || '')}`;
      return `<div class="msg declare${me ? ' me' : ''}">${avatar(m.from)}<div class="bubble">
        <div class="who">${who}</div>
        ${m.move ? `<span class="move">[${esc(m.move)}]</span>` : ''}${m.say ? `<div class="say">${esc(m.say)}</div>` : ''}
        ${m.action ? `<div class="act">${esc(m.action)}</div>` : ''}
      </div></div>`;
    }
    case 'ooc':
      return `<div class="msg ooc"><b>${esc(m.from === 'user' ? camp()?.userName || '나' : seatOf(m.from)?.label || m.from)}</b> ${esc(m.text)}</div>`;
    case 'roll':
      return rollHtml(m, fresh);
    default: {
      const cls = m.ledger ? ' ledger' : m.from === 'gm' ? ' intro' : m.effect ? ' effect' : m.clue ? ' clue' : '';
      return `<div class="msg system${cls}">${esc(m.text)}</div>`;
    }
  }
}

function appendMsg(m, fresh) {
  const box = $('#log');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  box.querySelector('.empty')?.remove();
  box.insertAdjacentHTML('beforeend', msgHtml(m, fresh));
  if (near || m.from === 'user') box.scrollTop = box.scrollHeight;
}

function renderLog() {
  const box = $('#log');
  if (!camp()) {
    box.innerHTML = '<div class="empty"><h2>What Do You Do?</h2><p>AI GM과 AI 플레이어들이 함께하는 TRPG 테이블.<br>새 캠페인으로 시작하세요.</p><button id="emptyNew">새 캠페인</button></div>';
    $('#emptyNew').onclick = openSetup;
    return;
  }
  box.innerHTML = log.map((m) => msgHtml(m, false)).join('');
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

function renderStory() {
  const c = camp();
  const box = $('#tab-scene');
  if (!c) { box.innerHTML = '<p class="muted">캠페인이 없어요.</p>'; return; }
  // Clues are 단서(이름, 내용) facts the viewer's side knows (plus the old notebook list).
  const known = c.knownFacts || [];
  const clues = [...(c.clues || []), ...known.filter((t) => t.startsWith('단서(')).map((t) => t.slice(3, -1).replace(', ', ' — '))];
  const facts = known.filter((t) => !t.startsWith('단서('));
  box.innerHTML = `
    <p class="storyhead">${esc(c.title || '준비 중')}</p>
    <p class="muted">${esc(c.rulesLabel || '')} · ${esc(c.premise)}${c.tone ? ` · ${esc(c.tone)}` : ''}</p>
    ${c.pitch ? `<div class="pre">${esc(c.pitch)}</div>` : ''}
    ${c.scene?.title ? `<h3>${esc(c.scene.title)}</h3><p>${esc(c.scene.description)}</p>` : ''}
    ${clues.length ? `<h3>단서 수첩</h3><ul class="clues">${clues.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    ${facts.length ? `<h3>${c.userRole === 'player' ? '내 캐릭터가 아는 사실' : '모두가 아는 사실'}</h3><ul class="facts">${facts.map((t) => `<li><span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
    ${c.foes?.length ? `<h3>적</h3>${c.foes.map((f) => `<div class="foe"><div><b>${esc(f.name)}</b> <span class="muted">${[f.armor ? `갑옷 ${f.armor}` : '', f.damage ? `피해 ${esc(f.damage)}` : '', f.attack ? `공격 ${f.attack}` : '', f.dodge ? `회피 ${f.dodge}` : ''].filter(Boolean).join(' · ')}</span></div>
      ${bar({ value: f.hp, max: f.maxHp })}<div class="muted">HP ${f.hp} / ${f.maxHp}${f.note ? ` · ${esc(f.note)}` : ''}</div></div>`).join('')}` : ''}
    ${c.summary ? `<h3>지금까지의 이야기</h3><div class="pre">${esc(c.summary)}</div>` : ''}
    <h3>진행</h3><p>라운드 ${c.round}</p>`;
}

function sheetHtml(ch, full) {
  const sh = ch.sheet || { badges: [], stats: Object.entries(ch.stats || {}).map(([label, v]) => ({ label, value: sign(v) })), lists: [], tracks: [] };
  const tracks = tracksOf(ch);
  const lore = [['외모', ch.appearance], ['성격', ch.personality], ['배경', ch.background]].filter(([, v]) => v);
  return `<section class="sheetcard${full ? ' plain' : ''}">
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
  box.innerHTML = (graph ? `<h3>단서 그래프</h3>${graph}` : '')
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
  if (c?.paused) {
    html = '<span class="grow">멈춤 상태예요.</span><button type="button" data-resume>재개</button>';
  } else if (c && state.phase !== 'ended') {
    const thinking = state.seats.filter((s) => s.status === 'thinking').map((s) => (s.key === 'gm' ? gmName() : charName(s.key)));
    const myTurn = state.phase === 'declare' && seatOf('user')?.status === 'waiting';
    const parts = [];
    if (myTurn && !thinking.length) parts.push(`<b>${esc(charName('user'))}</b>, 어떻게 하시겠습니까?`);
    else if (myTurn) parts.push('먼저 선언해도 돼요');
    if (thinking.length) parts.push(`${thinking.map(esc).join(', ')} 생각 중…`);
    if (state.phase === 'gm-wait') parts.push('GM(당신)의 서술을 기다려요. 보내면 다음 라운드가 시작돼요.');
    if (parts.length) html = `<span class="grow">${parts.join(' · ')}</span>${myTurn ? '<button type="button" class="ghost" data-pass>넘기기</button>' : ''}`;
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
  const choices = (c?.pendingChoices || []).filter((p) => p.who === 'user');
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
      ${p.why ? `<p class="lead">${esc(p.why)}</p>` : ''}
      <div class="chips meta"><span>${esc(p.label || p.move || p.skill || p.stat || '')}</span>${p.difficulty && p.difficulty !== 'regular' ? `<span>${p.difficulty === 'hard' ? '어려움' : '극단'}</span>` : ''}${p.bonus ? `<span>보너스 ${p.bonus}</span>` : ''}${p.penalty ? `<span>페널티 ${p.penalty}</span>` : ''}${p.push_risk ? `<span>밀어붙였다 실패하면: ${esc(p.push_risk)}</span>` : ''}</div>
      <button type="button" class="rollcta" data-roll="${p.id}" style="width:100%">${dice} 굴리기</button>
    </div>`).join('');
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
  const ic = role === 'gm' ? '서술' : '선언';
  const modes = role === 'player' || role === 'gm' ? [['declare', ic], ['ooc', '잡담']] : [['ooc', '잡담']];
  // New table or new role: start on the in-character mode when there is one.
  if (role !== lastRole) { mode = modes[0][0]; lastRole = role; }
  if (!modes.some(([m]) => m === mode)) mode = modes[0][0];
  $('#modes').innerHTML = modes.map(([m, l]) => `<button type="button" data-mode="${m}" class="${m === mode ? 'on' : ''}" aria-pressed="${m === mode}" title="${modes.length > 1 ? '눌러서 선언/잡담 바꾸기' : ''}">${l}</button>`).join('');
  const dw = c.rules === 'dw';
  const gmPh = c.rules === 'dw' ? '장면 서술 · /check 카엘 위험에 맞서기 민첩' : c.rules === 'coc7' ? '장면 서술 · /check 오필리아 관찰력 어려움' : '장면 서술 · /check 카엘 민첩 15';
  $('#input').placeholder = mode === 'ooc' ? '테이블 잡담 (플레이어로서)' : role === 'gm' ? gmPh : '“대사” 행동은 그냥 쓰기';
  const moves = dw && role === 'player' && mode === 'declare' ? state.rulesets?.dw?.moves || [] : [];
  $('#moveChips').innerHTML = moves.map((m) => `<button type="button" data-move="${esc(m.name)}">${esc(m.name)}</button>`).join('');
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
}

function renderAll() {
  actionKey = null;
  renderState();
  renderLog();
}

// ---------------------------------------------------------------------------
// Setup wizard

const STEP_NAME = { rules: '룰 고르기', story: '이야기 정하기', char: '캐릭터 만들기', seats: '자리 배치' };
let step = 0;
let setupRules = 'dw';
let storyGenre = null; // genre of the premise when it came from a preset or the 🎲 (d20 cards follow it)
let hand = { key: '', cards: [] }; // the character cards dealt for the current rules and genre
let autoName = ''; // the name a card filled in (replaced when another card is picked)
const form = () => $('#setupForm');
const ruleMeta = () => state?.rulesets?.[setupRules] || state?.rulesets?.d20;
const role = () => new FormData(form()).get('userRole');
const steps = () => ['rules', 'story', role() === 'player' ? 'char' : null, 'seats'].filter(Boolean);

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
  $('#presets').innerHTML = '<button type="button" class="dice" data-random>🎲 무작위</button>'
    + PRESETS.map(([l], i) => `<button type="button" data-preset="${i}">${l}</button>`).join('');
  form().userName.value = loadName() || form().userName.value;
  const rs = Object.values(state?.rulesets || {});
  if (camp()?.rules) setupRules = camp().rules;
  if (!state?.rulesets?.[setupRules]) setupRules = rs[0]?.id || 'd20';
  $('#rulesSeg').innerHTML = '<legend class="sr">룰 시스템</legend>' + rs.map((r) => `<label class="rulecard"><input type="radio" name="rules" value="${r.id}"${r.id === setupRules ? ' checked' : ''}>
    <span class="rc"><span class="rn">${esc(r.label)}</span><span class="rd">${esc(r.blurb || '')}</span><span class="rt">${(r.tags || []).map((t) => `<span>${esc(t)}</span>`).join('')}</span></span></label>`).join('');
  step = 0;
  hand = { key: '', cards: [] };
  renderRuleFields();
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
  if (cur === 'char') dealCards();
  $('#stepBar').innerHTML = list.map((_, i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('');
  $('#stepCount').textContent = `${step + 1} / ${list.length}`;
  $('#stepBack').hidden = step === 0;
  const last = step === list.length - 1;
  $('#stepNext').textContent = last ? '시작' : `다음 · ${STEP_NAME[list[step + 1]]}`;
  $('.dlgbody').scrollTop = 0;
}

function stepOk() {
  const cur = steps()[step];
  const f = new FormData(form());
  if (cur === 'story' && role() === 'gm' && !String(f.get('premise') || '').trim()) { toast('직접 GM을 보니 어떤 이야기인지 한 줄 적어 주세요 (위 예시를 눌러도 돼요)'); $('#premise').focus(); return false; }
  if (cur === 'char' && f.get('arch') !== 'ai' && !String(f.get('charName') || '').trim()) { toast('캐릭터 이름을 적어 주세요 (🎲를 눌러도 돼요)'); $('#charName').focus(); return false; }
  if (cur === 'seats' && role() !== 'player' && !$$('[data-player]').some((s) => s.value)) { toast('AI 플레이어를 한 명 이상 골라 주세요'); return false; }
  return true;
}

// Stat inputs and rule-specific fields (DW class/alignment, CoC occupation/skills).
function renderRuleFields() {
  setupRules = new FormData(form()).get('rules') || setupRules;
  const m = ruleMeta();
  if (!m) return;
  $('#setup').dataset.rules = setupRules;
  $$('[data-role-label="player"]').forEach((x) => { x.textContent = m.playerName || '플레이어'; });
  $$('[data-role-label="gm"]').forEach((x) => { x.textContent = m.gmName || 'GM'; });
  $('#gmLabel').textContent = m.gmName || 'GM';
  $('#statInputs').classList.toggle('eight', m.stats.length === 8);
  if (m.statKind === 'score') {
    $('#statInputs').innerHTML = m.stats.map((s, i) => `<div>${s}<select data-stat="${s}" aria-label="${s}">${m.scores.map((v) => `<option${v === m.statDefaults[i] ? ' selected' : ''}>${v}</option>`).join('')}</select></div>`).join('');
  } else {
    $('#statInputs').innerHTML = m.stats.map((s, i) => `<div>${s}<input type="number" inputmode="numeric" min="${m.statMin}" max="${m.statMax}" value="${m.statDefaults[i]}" data-stat="${s}" aria-label="${s}"></div>`).join('');
  }
  const fields = m.fields || [];
  $('#ruleFields').hidden = !fields.length;
  $('#ruleFields').innerHTML = fields.map((fd) => `<div><label for="rf-${fd.name}">${esc(fd.label)}</label>${fd.options && !fd.free
    ? `<select id="rf-${fd.name}" data-field="${fd.name}">${fd.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
    : `<input id="rf-${fd.name}" data-field="${fd.name}" placeholder="${esc(fd.placeholder || '')}"${fd.options ? ` list="dl-${fd.name}"` : ''}>${fd.options ? `<datalist id="dl-${fd.name}">${fd.options.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}`}</div>`).join('');
  updateBudget();
}

// Character cards: three ready-made characters for the rules (d20: for the premise's
// genre when known), plus "let the GM make one". Picking a card fills the form below.
function archPool() {
  const all = ARCHETYPES[setupRules] || [];
  const same = all.filter((a) => a.genre && a.genre === storyGenre);
  return same.length >= 3 ? same : all;
}

function dealCards(fresh) {
  const key = `${setupRules}/${storyGenre || ''}`;
  if (!fresh && hand.key === key) return;
  const pool = archPool();
  const prev = hand.key === key ? hand.cards : [];
  // A new hand prefers cards not just shown, and characters of different genres.
  const ordered = shuffle(pool).sort((a, b) => prev.includes(a.id) - prev.includes(b.id));
  const cards = [];
  for (const a of ordered) if (cards.length < 3 && !cards.some((c) => c.genre && c.genre === a.genre)) cards.push(a);
  for (const a of ordered) if (cards.length < 3 && !cards.includes(a)) cards.push(a);
  hand = { key, cards: cards.map((a) => a.id) };
  const m = ruleMeta();
  const top = (a) => Object.entries(a.scores || a.stats || {}).sort((x, y) => y[1] - x[1]).slice(0, 2)
    .map(([k, v]) => `${k} ${m?.statKind === 'mod' ? (v >= 0 ? `+${v}` : v) : v}`);
  $('#archCards').innerHTML = '<legend class="sr">캐릭터</legend>' + cards.map((a, i) => `<label class="rulecard"><input type="radio" name="arch" value="${a.id}"${i === 0 ? ' checked' : ''}>
    <span class="rc"><span class="rn">${a.icon} ${esc(a.title)}</span><span class="rd">${esc(a.concept)}</span><span class="rt">${[a.class || a.occupation, ...top(a)].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('')}</span></span></label>`).join('')
    + `<label class="rulecard"><input type="radio" name="arch" value="ai">
    <span class="rc"><span class="rn">🎭 GM에게 맡기기</span><span class="rd">원하는 캐릭터를 한 줄로 적으면 GM이 능력치까지 만들어요.</span></span></label>`;
  applyCard(cards[0]);
  updateRole();
}

const cardOf = (id) => (ARCHETYPES[setupRules] || []).find((a) => a.id === id);

function applyCard(a) {
  if (!a) return;
  const f = form();
  f.charConcept.value = a.concept;
  f.charBackground.value = a.background;
  f.charItems.value = a.items.join(', ');
  const vals = a.scores || a.stats || {};
  $$('[data-stat]').forEach((i) => { if (vals[i.dataset.stat] !== undefined) i.value = vals[i.dataset.stat]; });
  $$('[data-field]').forEach((i) => { if (a[i.dataset.field] !== undefined) i.value = a[i.dataset.field]; });
  const name = f.charName.value.trim();
  if (!name || name === autoName) rollName(a);
  updateBudget();
}

function rollName(a) {
  const names = a?.names || archPool().flatMap((x) => x.names);
  const cur = form().charName.value.trim();
  autoName = any(names.filter((n) => n !== cur).length ? names.filter((n) => n !== cur) : names);
  form().charName.value = autoName;
}

function updateBudget() {
  const m = ruleMeta();
  if (!m) return;
  const vals = $$('[data-stat]').map((i) => Number(i.value || 0));
  const el = $('#statBudget');
  if (m.statKind === 'percent') {
    el.textContent = `(${m.statMin}~${m.statMax})`;
    el.classList.remove('over');
  } else if (m.statKind === 'score') {
    const ok = [...vals].sort((a, b) => b - a).join() === m.scores.join();
    el.textContent = `(${m.scores.join('·')}을 하나씩${ok ? '' : ' · 겹치면 서버가 다시 나눠요'})`;
    el.classList.toggle('over', !ok);
  } else {
    const sum = vals.reduce((a, b) => a + b, 0);
    el.textContent = `(${m.statMin}~+${m.statMax}, 합 ${sum} / ${m.budget}${sum !== m.budget ? ' · 서버가 맞춰 줘요' : ''})`;
    el.classList.toggle('over', sum !== m.budget);
  }
}

function updateRole() {
  $('#gmBox').hidden = role() === 'gm';
  $('#storyNote').hidden = role() === 'gm';
  const ai = new FormData(form()).get('arch') === 'ai';
  $('#charManual').hidden = ai;
  $('#charHintBox').hidden = !ai;
}

function submitSetup() {
  const f = new FormData(form());
  const r = role();
  const players = $$('[data-player]').map((s) => s.value).filter(Boolean);
  let userChar = null;
  if (r === 'player') {
    if (f.get('arch') === 'ai') userChar = { hint: f.get('charHint') };
    else {
      const card = cardOf(f.get('arch'));
      const stats = Object.fromEntries($$('[data-stat]').map((i) => [i.dataset.stat, Number(i.value || 0)]));
      userChar = {
        name: f.get('charName'),
        concept: f.get('charConcept'),
        background: f.get('charBackground'),
        items: String(f.get('charItems') || '').split(',').map((x) => x.trim()).filter(Boolean),
        ...(ruleMeta()?.statKind === 'score' ? { scores: stats } : { stats }),
        ...Object.fromEntries($$('[data-field]').map((i) => [i.dataset.field, i.value])),
        ...(card?.weapons ? { weapons: card.weapons } : {}),
      };
    }
  }
  saveName(String(f.get('userName') || '').trim());
  api('/api/campaign', {
    rules: f.get('rules'), premise: f.get('premise'), tone: f.get('tone'),
    userName: f.get('userName'), userRole: r, gm: f.get('gm'), players, userChar,
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
  if (e.target.name === 'arch') { applyCard(cardOf(e.target.value)); updateRole(); }
  if (e.target.name === 'rules') renderRuleFields();
  if (e.target.dataset.stat) updateBudget();
});
form().addEventListener('input', (e) => { if (e.target.dataset.stat) updateBudget(); });
$('#presets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset], [data-random]');
  if (!b) return;
  const { premise, tone, genre } = b.dataset.preset
    ? { premise: PRESETS[b.dataset.preset][1], tone: PRESETS[b.dataset.preset][2], genre: PRESETS[b.dataset.preset][3] }
    : randomStory(setupRules, form().premise.value);
  form().premise.value = premise;
  form().tone.value = tone;
  storyGenre = genre;
});
// A premise typed by hand has no known genre.
$('#premise').addEventListener('input', () => { storyGenre = null; });
$('#archRoll').onclick = () => dealCards(true);
$('#nameRoll').onclick = () => rollName(cardOf(new FormData(form()).get('arch')));

$('#party').addEventListener('click', (e) => {
  const s = e.target.closest('[data-seat]');
  if (!s) return;
  if (s.dataset.seat === 'gm') openDrawer('scene');
  else openSheet(s.dataset.seat);
});
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) selectTab(b.dataset.tab);
});
$('#peekBtn').onclick = () => { secretsOpen = !secretsOpen; renderSecrets(); renderLog(); };

$('#turnbar').addEventListener('click', (e) => {
  if (e.target.closest('[data-pass]')) api('/api/pass');
  if (e.target.closest('[data-resume]')) api('/api/pause', { paused: false });
});

$('#sheetScrim').onclick = () => { sheetMin = true; placeSheet(); };
$('#actionSheet').addEventListener('click', (e) => {
  if (sheetMin && mobile()) { sheetMin = false; placeSheet(); return; }
  const roll = e.target.closest('[data-roll]');
  if (roll) { roll.disabled = true; api('/api/roll', { id: roll.dataset.roll }); return; }
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

$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  const all = $$('#modes [data-mode]').map((x) => x.dataset.mode);
  // The single visible button on a phone flips between modes.
  mode = b.dataset.mode === mode && all.length > 1 ? all[(all.indexOf(mode) + 1) % all.length] : b.dataset.mode;
  renderComposer();
  $('#input').focus();
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
  const r = await api('/api/post', { mode, text });
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

connect();
