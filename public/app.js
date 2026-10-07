// Table UI: one SSE stream (init → msg / state), a handful of POSTs.

const $ = (s) => document.querySelector(s);
const STATS = ['근력', '민첩', '체력', '지능', '감각', '매력'];
const BUDGET = 4;
const OUTCOME = { critical: '대성공', success: '성공', failure: '실패', fumble: '대실패' };
const PHASE = { setup: '준비 전', prep: '캠페인 준비 중', declare: '선언', resolve: 'GM 판정 중', roll: '주사위!', 'gm-wait': 'GM 서술 대기', ended: '종료' };
const PRESETS = [
  ['🏰 판타지', '국경 마을에서 사람들이 하나둘 사라지는 정통 판타지 모험'],
  ['🐙 코즈믹 호러', '1920년대 안개 낀 항구 도시, 바다에서 건져 올린 이상한 조각상과 연쇄 실종 사건'],
  ['🌃 사이버펑크', '2089년 네오서울, 거대 기업의 데이터를 훔치는 의뢰를 받은 해커와 용병들'],
  ['⚔ 무협', '강호를 뒤흔든 비급이 사라졌다. 정파와 사파가 모두 노리는 객잔에서 벌어지는 이야기'],
  ['🏫 학원 미스터리', '폐교 직전의 고등학교, 밤마다 불이 켜지는 옛 음악실의 비밀을 파헤치는 학생들'],
  ['🚀 스페이스 오페라', '고장 난 화물선을 타고 은하 변두리를 떠도는 승무원들, 화물칸에서 무언가 깨어난다'],
];

let state = null;
const chars = () => state?.characters || {};
let log = [];
let mode = 'declare';
let secretsOpen = false;
let lastRole = null;

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
  toast.t = setTimeout(() => { renderBanner(); }, 3500);
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
    if (!state.campaign) openSetup();
  });
  es.addEventListener('state', (e) => {
    state = JSON.parse(e.data);
    renderState();
  });
  es.addEventListener('msg', (e) => {
    const m = JSON.parse(e.data);
    log.push(m);
    appendMsg(m, true);
  });
  es.onerror = () => { $('#phasePill').textContent = '연결 끊김… 다시 연결 중'; };
}

// ---------------------------------------------------------------------------
// Rendering helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

function seatOf(key) { return state?.seats?.find((s) => s.key === key); }
function colorOf(key) {
  const s = seatOf(key);
  if (!s || s.backend === 'human') return '#c58d2c';
  return state.backends[s.backend]?.color || '#777';
}
function charName(key) {
  if (key === 'gm') return 'GM';
  if (key === 'user' && !chars().user) return state?.campaign?.userName || '방장';
  return chars()[key]?.name || seatOf(key)?.label || key;
}
function avatar(key) {
  const label = key === 'gm' ? 'GM' : (charName(key) || '?').slice(0, 1);
  return `<div class="avatar" style="background:${colorOf(key)}">${esc(label)}</div>`;
}

// ---------------------------------------------------------------------------
// Log

function msgHtml(m, fresh) {
  switch (m.type) {
    case 'narration':
      return `<div class="msg narration"><span class="tag">GM</span>${esc(m.text)}</div>`;
    case 'scene': {
      const [title, ...rest] = m.text.split(' — ');
      return `<div class="msg scene">📍 ${esc(title)}<small>${esc(rest.join(' — '))}</small></div>`;
    }
    case 'declare': {
      const me = m.from === 'user' ? ' me' : '';
      return `<div class="msg declare${me}">${avatar(m.from)}<div class="bubble">
        <div class="who"><b>${esc(charName(m.from))}</b> · ${esc(seatOf(m.from)?.label || '')}</div>
        ${m.say ? `<div class="say">${esc(m.say)}</div>` : ''}
        ${m.action ? `<div class="act">${esc(m.action)}</div>` : ''}
      </div></div>`;
    }
    case 'ooc':
      return `<div class="msg ooc">💬 <b>${esc(seatOf(m.from)?.label || m.from)}</b> ${esc(m.text)}</div>`;
    case 'roll': {
      const r = m.roll;
      if (r.kind === 'check') {
        const dice = r.dice.length > 1 ? `<span class="muted">[${r.dice.join(', ')}]</span>` : '';
        const adv = r.adv === 'advantage' ? ' 유리' : r.adv === 'disadvantage' ? ' 불리' : '';
        return `<div class="msg"><div class="roll ${r.outcome}${fresh ? ' fresh' : ''}">🎲 <b>${esc(charName(r.who))}</b> ${esc(r.stat)}${adv}
          <span class="d20">${r.natural}</span>${dice} ${sign(r.mod)} = <b>${r.total}</b> <span class="muted">vs DC ${r.dc}</span>
          <span class="res">${OUTCOME[r.outcome]}</span>${r.why ? `<span class="muted">· ${esc(r.why)}</span>` : ''}</div></div>`;
      }
      return `<div class="msg"><div class="roll${fresh ? ' fresh' : ''}">🎲 <b>${esc(charName(r.who))}</b> ${esc(r.expr)} <span class="muted">${esc(r.detail)}</span> = <span class="d20">${r.total}</span></div></div>`;
    }
    default: {
      const intro = m.from === 'gm' ? ' intro' : '';
      return `<div class="msg system${m.effect ? ' effect' : ''}${intro}">${esc(m.text)}</div>`;
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
  if (!state?.campaign) {
    box.innerHTML = `<div class="empty"><h2>🎲 What Do You Do?</h2><p>AI GM과 AI 플레이어들이 함께하는 TRPG 테이블.<br>오른쪽 위 <b>＋ 새 캠페인</b>으로 시작하세요.</p></div>`;
    return;
  }
  box.innerHTML = log.map((m) => msgHtml(m, false)).join('');
  box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------------------
// State

const STATUS = { thinking: '생각 중', done: '✓ 선언', waiting: '차례 대기', rolling: '🎲 굴릴 차례', idle: '' };

function renderParty() {
  const box = $('#party');
  if (!state?.campaign) { box.innerHTML = ''; return; }
  box.innerHTML = state.seats.map((s) => {
    const ch = chars()[s.key];
    const status = `<div class="status ${s.status}">${STATUS[s.status] || ''}</div>`;
    if (s.key === 'gm') {
      return `<div class="seat gm">${status}<div class="who">${avatar('gm')}<div><div class="name">게임 마스터</div><div class="sub">${esc(s.label)}</div></div></div></div>`;
    }
    if (!ch) return `<div class="seat">${status}<div class="who">${avatar(s.key)}<div><div class="name">캐릭터 만드는 중…</div><div class="sub">${esc(s.label)}</div></div></div></div>`;
    const pct = Math.round((ch.hp / ch.maxHp) * 100);
    return `<div class="seat">${status}
      <div class="who">${avatar(s.key)}<div><div class="name">${esc(ch.name)}</div><div class="sub">${esc(s.label)}</div></div></div>
      <div class="concept">${esc(ch.concept)}</div>
      <div class="hp${pct <= 30 ? ' low' : ''}"><i style="width:${pct}%"></i></div>
      <div class="hptext">HP ${ch.hp} / ${ch.maxHp}</div>
      ${ch.conditions?.length ? `<div class="conds">${ch.conditions.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

function renderScene() {
  const c = state?.campaign;
  const box = $('#tab-scene');
  if (!c) { box.innerHTML = '<p class="muted">캠페인이 없어요.</p>'; return; }
  box.innerHTML = `
    <h3>${esc(c.title || '준비 중')}</h3>
    <p class="muted">${esc(c.premise)}${c.tone ? ` · ${esc(c.tone)}` : ''}</p>
    ${c.pitch ? `<div class="pre">${esc(c.pitch)}</div>` : ''}
    ${c.scene?.title ? `<h3>📍 ${esc(c.scene.title)}</h3><p>${esc(c.scene.description)}</p>` : ''}
    ${c.summary ? `<h3>지금까지의 이야기</h3><div class="pre">${esc(c.summary)}</div>` : ''}
    <h3>진행</h3><p>라운드 ${c.round} / 목표 ${c.targetRounds}</p>`;
}

function renderSheets() {
  const box = $('#tab-sheets');
  const list = Object.values(chars());
  if (!list.length) { box.innerHTML = '<p class="muted">아직 캐릭터가 없어요.</p>'; return; }
  box.innerHTML = list.map((ch) => `<div class="sheet">
    <h4>${esc(ch.name)} <span class="muted">· ${esc(seatOf(ch.key)?.label || '')}</span></h4>
    <div class="muted">${esc(ch.concept)}</div>
    <div class="statgrid">${STATS.map((s) => `<div>${s}<b>${sign(ch.stats[s])}</b></div>`).join('')}</div>
    <div>HP ${ch.hp} / ${ch.maxHp}${ch.conditions.length ? ` · ${ch.conditions.map(esc).join(', ')}` : ''}</div>
    ${ch.items.length ? `<div>🎒 ${ch.items.map(esc).join(', ')}</div>` : ''}
    ${ch.appearance ? `<div class="muted">외모: ${esc(ch.appearance)}</div>` : ''}
    ${ch.personality ? `<div class="muted">성격: ${esc(ch.personality)}</div>` : ''}
    ${ch.background ? `<div class="muted">배경: ${esc(ch.background)}</div>` : ''}
  </div>`).join('');
}

async function renderSecrets() {
  const box = $('#secretsBody');
  if (!secretsOpen) { box.innerHTML = ''; $('#peekBtn').textContent = '👁 엿보기'; return; }
  $('#peekBtn').textContent = '🙈 가리기';
  const s = await fetch('/api/secrets').then((r) => r.json());
  box.innerHTML = `<h3>GM 비밀 메모</h3><div class="pre">${esc(s.gmNotes || '(비어 있음)')}</div>`
    + Object.entries(s.notes || {}).map(([k, n]) => `<h3>${esc(charName(k))}의 메모</h3><div class="pre">${esc(n || '(비어 있음)')}</div>`).join('');
}

function renderBanner() {
  const c = state?.campaign;
  const b = $('#banner');
  if (c?.error) { b.textContent = `⚠ ${c.error}`; b.className = 'banner'; b.hidden = false; return; }
  const onlyDemo = state && Object.entries(state.available || {}).every(([k, v]) => k === 'mock' || !v);
  if (onlyDemo) { b.textContent = '연결된 AI CLI가 없어서 데모봇이 모든 자리를 맡고 있어요. README의 설치 안내를 참고하세요.'; b.className = 'banner info'; b.hidden = false; return; }
  b.hidden = true;
}

function renderTurnbar() {
  const c = state?.campaign;
  const bar = $('#turnbar');
  const parts = [];
  if (c && !c.paused) {
    if (state.phase === 'roll' && c.pendingChecks.length) {
      parts.push('🎲 판정이에요!');
      for (const p of c.pendingChecks) {
        parts.push(`<button data-roll="${p.id}">${esc(p.stat)} 판정 (DC ${p.dc}${p.adv === 'advantage' ? ', 유리' : p.adv === 'disadvantage' ? ', 불리' : ''}) 굴리기</button>`);
        if (p.why) parts.push(`<span class="muted">${esc(p.why)}</span>`);
      }
    } else if (state.phase === 'declare' && seatOf('user')?.status === 'waiting') {
      const thinking = state.seats.some((s) => s.status === 'thinking');
      parts.push(thinking ? '다른 플레이어가 선언하는 중이에요. 먼저 선언해도 돼요.' : `<span><b>${esc(charName('user'))}</b>, 어떻게 하시겠습니까?</span>`);
    } else if (state.phase === 'gm-wait') {
      parts.push('GM(당신)의 서술을 기다리고 있어요. 보내면 다음 라운드가 시작돼요.');
    }
  }
  if (c?.paused) parts.push('⏸ 멈춤 상태예요.');
  bar.innerHTML = parts.join(' ');
  bar.hidden = !parts.length;
}

function renderComposer() {
  const c = state?.campaign;
  const role = c?.userRole;
  const modes = $('#modes');
  modes.innerHTML = role === 'gm'
    ? '<button type="button" data-mode="declare">📜 서술</button><button type="button" data-mode="ooc">💬 잡담</button>'
    : role === 'player'
      ? '<button type="button" data-mode="declare">🗡 선언</button><button type="button" data-mode="ooc">💬 잡담</button>'
      : '<button type="button" data-mode="ooc">💬 잡담</button>';
  // New table or new role: start on the in-character mode when there is one.
  if (role !== lastRole) { mode = role === 'player' || role === 'gm' ? 'declare' : 'ooc'; lastRole = role; }
  modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  if (!modes.querySelector('.on')) { mode = modes.querySelector('button').dataset.mode; modes.querySelector('button').classList.add('on'); }
  $('#passBtn').hidden = role !== 'player';
  $('#passBtn').disabled = !(state?.phase === 'declare' && seatOf('user')?.status === 'waiting');
  const ph = { declare: role === 'gm' ? '장면을 서술하세요 · /check 카엘 민첩 15 · /hp 카엘 -3' : '"대사는 따옴표로" 행동은 그냥 쓰기 · /r 2d6+1 로 주사위', ooc: '테이블 잡담 (캐릭터가 아닌 플레이어로서)' };
  $('#input').placeholder = ph[mode];
  $('#composer').style.display = c ? '' : 'none';
}

function renderHeader() {
  const c = state?.campaign;
  $('#campaignTitle').textContent = c ? (c.title || '캠페인 준비 중') : '테이블이 비어 있어요';
  let pill = PHASE[state?.phase] || '';
  if (c && c.round > 0 && !['prep', 'ended'].includes(state.phase)) pill = `라운드 ${c.round} · ${pill}`;
  if (c?.paused) pill = `⏸ ${pill}`;
  $('#phasePill').textContent = c ? pill : '';
  const pb = $('#pauseBtn');
  pb.hidden = !c || state.phase === 'ended';
  pb.textContent = c?.paused ? '▶ 재개' : '⏸ 멈춤';
}

function renderState() {
  renderHeader();
  renderBanner();
  renderParty();
  renderScene();
  renderSheets();
  renderTurnbar();
  renderComposer();
}

function renderAll() {
  renderState();
  renderLog();
}

// ---------------------------------------------------------------------------
// Setup dialog

function openSetup() {
  const dlg = $('#setup');
  const avail = state?.available || {};
  const names = { claude: 'Claude', codex: 'ChatGPT', grok: 'Grok', agy: 'Gemini', mock: '데모봇' };
  const real = ['claude', 'codex', 'grok', 'agy'].filter((k) => avail[k]);
  const opts = (sel, allowNone) => (allowNone ? '<option value="">— 비움 —</option>' : '')
    + Object.keys(names).filter((k) => avail[k]).map((k) => `<option value="${k}"${k === sel ? ' selected' : ''}>${names[k]}</option>`).join('');
  const gmDefault = real[0] || 'mock';
  $('#gmSelect').innerHTML = opts(gmDefault, false);
  const defaults = real.length ? ['codex', 'grok', 'agy', 'claude'].filter((k) => avail[k]).slice(0, 3) : ['mock', 'mock', 'mock'];
  $('#playerSelects').innerHTML = [0, 1, 2, 3].map((i) => `<select data-player="${i}">${opts(defaults[i] || '', true)}</select>`).join('');
  $('#availNote').textContent = real.length
    ? `찾은 CLI: ${real.map((k) => names[k]).join(', ')}. 한 AI가 GM과 플레이어를 동시에 맡아도 돼요 (매번 따로 호출됩니다).`
    : 'AI CLI를 찾지 못해서 데모봇만 쓸 수 있어요.';
  $('#presets').innerHTML = PRESETS.map(([l, p]) => `<button type="button" data-premise="${esc(p)}">${l}</button>`).join('');
  $('#statInputs').innerHTML = STATS.map((s, i) => `<div>${s}<input type="number" min="-1" max="3" value="${[1, 1, 1, 0, 1, 0][i]}" data-stat="${s}"></div>`).join('');
  updateBudget();
  updateRole();
  $('#setupCancel').hidden = !state?.campaign;
  dlg.showModal();
}

function updateBudget() {
  const sum = [...document.querySelectorAll('[data-stat]')].reduce((a, i) => a + Number(i.value || 0), 0);
  const el = $('#statBudget');
  el.textContent = `(보정치 -1~+3, 합 ${sum} / ${BUDGET}${sum !== BUDGET ? ' — 서버가 맞춰 줘요' : ''})`;
  el.classList.toggle('over', sum !== BUDGET);
}

function updateRole() {
  const role = new FormData($('#setupForm')).get('userRole');
  $('#charBox').hidden = role !== 'player';
  $('#gmBox').hidden = role === 'gm';
  const ai = $('#setupForm').aiChar.checked;
  $('#charManual').hidden = ai;
  $('#charHintBox').hidden = !ai;
}

function submitSetup(e) {
  e.preventDefault();
  const f = new FormData($('#setupForm'));
  const role = f.get('userRole');
  const players = [...document.querySelectorAll('[data-player]')].map((s) => s.value).filter(Boolean);
  if (!players.length && role !== 'player') { toast('AI 플레이어를 한 명 이상 골라 주세요'); return; }
  let userChar = null;
  if (role === 'player') {
    if (f.get('aiChar')) userChar = { hint: f.get('charHint') };
    else {
      if (!String(f.get('charName')).trim()) { toast('캐릭터 이름을 적어 주세요 (또는 AI에게 맡기기)'); return; }
      userChar = {
        name: f.get('charName'),
        concept: f.get('charConcept'),
        background: f.get('charBackground'),
        stats: Object.fromEntries([...document.querySelectorAll('[data-stat]')].map((i) => [i.dataset.stat, Number(i.value || 0)])),
        items: String(f.get('charItems') || '').split(',').map((x) => x.trim()).filter(Boolean),
      };
    }
  }
  api('/api/campaign', {
    premise: f.get('premise'), tone: f.get('tone'), targetRounds: Number(f.get('targetRounds')),
    userName: f.get('userName'), userRole: role, gm: f.get('gm'), players, userChar,
  });
  secretsOpen = false;
  log = [];
  $('#log').innerHTML = '';
  $('#setup').close();
}

// ---------------------------------------------------------------------------
// Events

$('#newBtn').onclick = () => openSetup();
$('#setupCancel').onclick = () => $('#setup').close();
$('#setupForm').addEventListener('submit', submitSetup);
$('#setupForm').addEventListener('change', (e) => { if (e.target.name === 'userRole' || e.target.name === 'aiChar') updateRole(); });
$('#setupForm').addEventListener('input', (e) => { if (e.target.dataset.stat) updateBudget(); });
$('#presets').addEventListener('click', (e) => {
  const p = e.target.closest('[data-premise]');
  if (p) $('#setupForm').premise.value = p.dataset.premise;
});
$('#pauseBtn').onclick = () => api('/api/pause', { paused: !state?.campaign?.paused });
$('#passBtn').onclick = () => api('/api/pass');
$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  mode = b.dataset.mode;
  renderComposer();
  $('#input').focus();
});
$('#turnbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-roll]');
  if (b) { b.disabled = true; api('/api/roll', { id: b.dataset.roll }); }
});
$('#composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#input').value.trim();
  if (!text) return;
  const r = await api('/api/post', { mode, text });
  if (r.ok) $('#input').value = '';
});
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tabbody').forEach((x) => { x.hidden = x.id !== `tab-${b.dataset.tab}`; });
  if (b.dataset.tab === 'secrets') renderSecrets();
});
$('#peekBtn').onclick = () => { secretsOpen = !secretsOpen; renderSecrets(); };

connect();
