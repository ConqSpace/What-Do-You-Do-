// Character builder: the human player's character, one decision per page, on a full page
// of its own. It opens when a player campaign starts (the GM designs the world and the AI
// players make their characters meanwhile) and stays until the character is done. Every
// page explains what its choice does in play and starts on a recommended choice, so "다음"
// alone gets a beginner to the end. The draft lives on the server (a reload continues
// where it left off); dice the rules roll (CoC characteristics) are rolled by the server.

import { ARCHETYPES } from './archetypes.js';

// Who the character is comes out of the choices (Dungeon World has no "concept" at all):
// the name right after the class or occupation, the one-line introduction near the end,
// drafted from what was picked. d20 has no classes, so its concept comes first instead.
const PAGES = {
  dw: ['start', 'class', 'name', 'look', 'stats', 'moves', 'alignment', 'gear', 'intro', 'bonds', 'review'],
  coc7: ['start', 'chars', 'occupation', 'name', 'occSkills', 'personal', 'backstory', 'gear', 'intro', 'party', 'review'],
  d20: ['start', 'concept', 'name', 'stats', 'look', 'items', 'backstory', 'party', 'review'],
};
const TITLE = {
  start: '시작', class: '직업', stats: '능력치', moves: '핵심 액션', gear: '장비', look: '외모 · 성격', alignment: '가치관',
  name: '이름', intro: '소개', bonds: '인연', party: '동료', review: '확인', chars: '특성치', occupation: '직업', occSkills: '직업 기능',
  personal: '관심 기능', backstory: '배경', concept: '콘셉트', items: '소지품',
};
// Which character fields each page decides (what "나머지는 GM에게" keeps).
const FIELDS = {
  class: ['class'], stats: ['scores', 'stats'], gear: ['items', 'weapons', 'armor'], look: ['appearance', 'personality'],
  alignment: ['alignment', 'background'], name: ['name'], intro: ['concept'], bonds: ['bonds'], chars: ['method', 'card', 'stats'],
  occupation: ['occupation'], occSkills: ['skills'], personal: ['skills'], backstory: ['background', 'personality'],
  concept: ['concept'], items: ['items'], party: ['background'],
};
const RELATIONS = ['처음 보는 사이', '오랜 친구', '서로 빚이 있다', '왠지 믿음이 안 간다', '같은 일로 얽혀 있다', '예전에 함께 일했다'];
const D20_DEFAULT = { 근력: 1, 민첩: 1, 체력: 1, 지능: 0, 감각: 1, 매력: 0 };

let ctx = null; // helpers from app.js: $, esc, toast, api, state(), sheetHtml, genre()
let info = null; // GET /api/builder for the campaign's rules
let infoRules = '';
let d = null; // the draft
let cid = ''; // campaign the draft belongs to
let shown = false;
let dismissed = false; // the player went back to the table for a while
let rollsSeen = '';
let saveTimer = null;

const camp = () => ctx.state()?.campaign;
const rules = () => camp()?.rules || 'd20';
const pages = () => PAGES[rules()] || PAGES.d20;
const esc = (s) => ctx.esc(s);
const any = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(([, x]) => x);
const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
// The rules' name for the GM (마스터, 키퍼) with its subject particle: 마스터가, GM이.
const gm = () => camp()?.gmName || 'GM';
const iga = (w) => `${w}${/[가-힣]$/.test(w) && eul(w) === '를' ? '가' : '이'}`;
const gmGa = () => iga(gm());
const others = () => Object.values(ctx.state()?.characters || {}).filter((c) => c.key !== 'user');
const cards = () => ARCHETYPES[rules()] || [];
const cardOf = (id) => cards().find((a) => a.id === id);
const classOf = () => info?.classes?.find((c) => c.name === d.class);
const occOf = () => info?.occupations?.find((o) => o.name === d.occupation);

export function initBuilder(helpers) {
  ctx = helpers;
  const $ = ctx.$;
  $('#buildMain').addEventListener('click', onClick);
  $('#buildMain').addEventListener('input', onInput);
  $('#buildMain').addEventListener('change', onChange);
  $('#buildBack').onclick = () => { dismissed = true; hide(); ctx.rerender(); };
  $('#buildPrev').onclick = () => go(-1);
  $('#buildNext').onclick = next;
  $('#buildRest').onclick = delegateRest;
  // Wide screens show the world, party and preview beside the page; phones fold them into one line.
  const narrow = matchMedia('(max-width: 899px)');
  $('#buildSide').open = !narrow.matches;
  narrow.addEventListener('change', () => { $('#buildSide').open = !narrow.matches; });
}

// The table needs the human's character and the player has not finished it.
export const builderNeeded = () => !!camp()?.builder;

export function openBuilder() {
  dismissed = false;
  renderBuilder();
}

// Called on every state from the server.
export function renderBuilder() {
  const c = camp();
  if (!c?.builder) { if (shown) hide(); return; }
  if (c.id !== cid) {
    cid = c.id;
    dismissed = false;
    d = c.builder.draft?.cid === c.id ? c.builder.draft : { cid: c.id, page: 'start', visited: [], answers: {}, relations: {}, touched: {} };
  }
  if (dismissed) return;
  if (infoRules !== c.rules) {
    infoRules = c.rules;
    info = null;
    fetch(`/api/builder?rules=${encodeURIComponent(c.rules)}`).then((r) => r.json()).then((j) => { info = j; renderPage(); });
  }
  if (!shown) {
    shown = true;
    ctx.$('#buildPage').hidden = false;
    renderPage();
  }
  // Server rolls arrive with the state: redraw the characteristics page.
  const rolls = JSON.stringify(c.builder.rolls || {});
  if (rolls !== rollsSeen) { rollsSeen = rolls; if (d.page === 'chars' || d.page === 'occupation') renderPage(); }
  renderSide();
}

function hide() {
  shown = false;
  ctx.$('#buildPage').hidden = true;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ctx.api('/api/builder/draft', { draft: d }), 500);
}

// ---------------------------------------------------------------------------
// Draft helpers

function get(path) { return path.split('.').reduce((o, k) => o?.[k], d); }
function set(path, v) {
  const keys = path.split('.');
  let o = d;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = v;
}

// CoC characteristics as they stand: server rolls, or the page's quick-fire / point buy / card values.
function chars() {
  if (d.method === 'roll' || !d.method) return { ...(camp()?.builder?.rolls || {}) };
  return { ...(d.stats || {}), 행운: camp()?.builder?.rolls?.행운 };
}
function skillBase(name, ch = chars()) {
  if (name === '회피') return Math.floor((ch.민첩 || 50) / 2);
  if (name === '언어(모국어)') return ch.교육 || 50;
  return info?.skills?.[name] ?? 1;
}
const spent = (pool) => Object.values(d[pool] || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const skillValue = (name) => skillBase(name) + (Number(d.occ?.[name]) || 0) + (Number(d.personal?.[name]) || 0);

function names() {
  // Dungeon World: the class's own name list from the Korean edition.
  if (rules() === 'dw') return classOf()?.names || info?.classes?.flatMap((c) => c.names) || cards().flatMap((a) => a.names);
  if (rules() !== 'd20') return cards().flatMap((a) => a.names);
  const g = ctx.genre();
  const same = cards().filter((a) => a.genre === g);
  return (same.length ? same : cards()).flatMap((a) => a.names);
}
function rollName() {
  const pool = names().filter((n) => n !== d.name);
  d.name = any(pool.length ? pool : names());
}

// Recommended values for a page, filled in only where the draft has none yet.
function init(page) {
  const r = rules();
  if (r === 'dw' && page !== 'start' && !d.class) setClass('전사');
  if (page === 'stats' && r === 'd20') d.stats ??= { ...D20_DEFAULT };
  if (page === 'look' && r === 'dw' && classOf()) d.look ??= Object.fromEntries(Object.entries(classOf().looks).map(([g, l]) => [g, l[0]]));
  if (page === 'alignment' && r === 'dw' && classOf()) d.alignment ??= classOf().alignments[0].name;
  if (page === 'gear' && r === 'dw' && classOf()) {
    d.gearPick ??= defaultGear(classOf());
  }
  if (page === 'gear' && r === 'coc7') d.items ??= ['손전등', '수첩과 연필'];
  if (page === 'chars') d.method ??= 'roll';
  if (page === 'occupation' && !d.occupation && info) setOccupation(recommended()[0]);
  if (page === 'occSkills' && !d.occ && occOf()) recommendOcc();
  if (page === 'personal' && !d.personal) recommendPersonal();
  if (page === 'name' && !d.name) rollName();
  if (page === 'intro' && (!d.concept || d.concept === d.introAuto)) d.concept = d.introAuto = introDraft();
  if (page === 'bonds' && !d.bonds) d.bonds = others().length ? [{ with: others()[0].key, tpl: 0 }] : [];
}

const defaultGear = (c) => c.gear.groups.map((g) => [...Array(g.pick).keys()]);

// A Dungeon World class's chosen gear: what it carries and the armor it gives.
function dwGear() {
  const c = classOf();
  if (!c) return { items: [], armor: 0 };
  const picks = d.gearPick || defaultGear(c);
  const chosen = c.gear.groups.flatMap((g, gi) => (picks[gi] || []).map((oi) => g.options[oi]).filter(Boolean));
  const armor = Math.max(c.gear.armor || 0, ...chosen.map((o) => o.armor || 0)) + chosen.filter((o) => o.shield).length;
  return { items: [...c.gear.always, ...chosen.flatMap((o) => o.items || [o.name])], armor };
}

function setClass(name) {
  const c = info?.classes?.find((x) => x.name === name);
  if (!c) return;
  const changed = d.class !== name;
  d.class = name;
  if (!changed) return;
  // A new class brings its own recommendations unless the player already chose those.
  if (!d.touched.stats) d.scores = { ...c.scores };
  if (!d.touched.gear) d.gearPick = defaultGear(c);
  if (!d.touched.look) d.look = Object.fromEntries(Object.entries(c.looks).map(([g, l]) => [g, l[0]]));
  if (!d.touched.alignment || !c.alignments.some((a) => a.name === d.alignment)) d.alignment = c.alignments[0].name;
}

function recommended() {
  const ch = chars();
  return [...(info?.occupations || [])]
    .map((o) => ({ o, score: o.keys.reduce((a, k) => a + (ch[k] || 50), 0) }))
    .sort((a, b) => b.score - a.score).map((x) => x.o.name);
}
function setOccupation(name) {
  if (d.occupation === name) return;
  d.occupation = name;
  if (!d.touched.occSkills) d.occ = null;
}
function recommendOcc() {
  const o = occOf();
  if (!o) return;
  const credit = Math.min(o.credit[1], o.credit[0] + 10);
  d.occ = { 신용: credit };
  spread('occ', o.skills, (chars().교육 || 50) * 4 - credit);
}
function recommendPersonal() {
  d.personal = {};
  spread('personal', ['관찰력', '듣기', '회피', '도서관 이용'], (chars().지능 || 50) * 2);
}
// Hand out points five at a time, round the skills, until the budget or every skill's cap runs out.
function spread(pool, skills, budget) {
  for (const n of skills) d[pool][n] = 0;
  let left = budget;
  while (left >= 5) {
    let gave = false;
    for (const n of skills) {
      if (left < 5) break;
      if (clampPoints(pool, n, d[pool][n] + 5) > d[pool][n]) { d[pool][n] += 5; left -= 5; gave = true; }
    }
    if (!gave) break;
  }
}

// Fill every page from a ready-made card.
function applyCard(a) {
  const r = rules();
  d.card = a.id;
  d.concept = a.concept;
  d.background = a.background;
  d.name = any(a.names);
  d.touched = { stats: true, gear: true, occSkills: true };
  if (r === 'dw') {
    d.class = a.class; d.alignment = a.alignment; d.scores = { ...a.scores };
    d.gearPick = a.gear.map((x) => [...x]);
    d.look = null;
  } else if (r === 'coc7') {
    d.occupation = a.occupation; d.method = 'card'; d.stats = { ...a.stats };
    d.items = [...a.items]; d.weapons = (a.weapons || []).map((w) => ({ ...w }));
    d.occ = {}; d.personal = {};
    const own = new Set([...(info?.occupations?.find((o) => o.name === a.occupation)?.skills || []), '신용']);
    for (const part of a.skills.split(',')) {
      const [, n, v] = part.trim().match(/^(.+?)\s+(\d+)$/) || [];
      if (!n) continue;
      const raise = Math.max(0, Number(v) - skillBase(n, a.stats));
      (own.has(n) ? d.occ : d.personal)[n] = raise;
    }
  } else {
    d.stats = { ...a.stats }; d.items = [...a.items];
  }
  for (const p of pages()) init(p);
  d.visited = [...pages()];
}

// The character as the server takes it (only the decided pages when `only` is given).
function character(only) {
  const r = rules();
  const ans = (keys) => keys.map((k) => (d.answers[k] ? `${k}: ${d.answers[k]}` : '')).filter(Boolean);
  const rel = others().filter((o) => d.relations[o.key]).map((o) => `${o.name}과(와)는 ${d.relations[o.key]}`);
  const custom = String(d.customItems || '').split(',').map((x) => x.trim()).filter(Boolean);
  const out = { name: d.name, concept: d.concept };
  if (r === 'dw') {
    const look = Object.values(d.look || {});
    Object.assign(out, {
      class: d.class, alignment: d.alignment, scores: d.scores,
      items: [...dwGear().items, ...custom], armor: dwGear().armor,
      appearance: [...look, d.lookText].filter(Boolean).join(', '),
      personality: [...(d.personality || []), d.personalityText].filter(Boolean).join(', '),
      background: d.background || '',
      bonds: (d.bonds || []).map((b) => ({ with: b.with, text: bondText(b) })).filter((b) => b.text),
    });
    out.concept ||= d.class;
  } else if (r === 'coc7') {
    const skills = {};
    for (const n of new Set([...Object.keys(d.occ || {}), ...Object.keys(d.personal || {})])) {
      if (skillValue(n) > skillBase(n)) skills[n] = skillValue(n);
    }
    Object.assign(out, {
      occupation: d.occupation, method: d.method || 'roll', card: d.card, skills,
      items: [...(d.items || []), ...custom], weapons: d.weapons || [],
      personality: d.answers.특징 || '',
      background: [...ans(['신념', '소중한 사람', '의미 있는 장소', '소중한 물건']), d.background, ...rel].filter(Boolean).join(' / '),
    });
    if (d.method === 'quick' || d.method === 'point') out.stats = d.stats;
    out.concept ||= d.occupation;
  } else {
    Object.assign(out, {
      stats: d.stats, items: [...(d.items || []), ...custom],
      appearance: [...(d.looks || []), d.lookText].filter(Boolean).join(', '),
      personality: [...(d.personality || []), d.personalityText].filter(Boolean).join(', '),
      background: [...ans(['이유', '잃을 수 없는 것', '비밀']), d.background, ...rel].filter(Boolean).join(' / '),
    });
  }
  if (!only) return out;
  const keep = new Set(['method', 'card', ...d.visited.flatMap((p) => FIELDS[p] || [])]);
  return Object.fromEntries(Object.entries(out).filter(([k, v]) => keep.has(k) && v !== undefined && v !== ''));
}

function bondText(b) {
  const tpl = classOf()?.bonds?.[b.tpl];
  if (b.text) return b.text;
  const who = others().find((o) => o.key === b.with);
  if (!tpl || !who) return '';
  // The blank's particle follows the name: 카엘은 / 티나는, 카엘을 / 티나를 …
  const pair = { 는: '은', 를: '을', 가: '이', 와: '과' };
  return tpl.replace(/_{3,}(는|를|가|와)?/, (_, p) => `${who.name}${p ? (eul(who.name) === '을' ? pair[p] : p) : ''}`);
}

// ---------------------------------------------------------------------------
// Navigation

function show(page) {
  d.page = page;
  if (!d.visited.includes(page)) d.visited.push(page);
  init(page);
  renderPage();
  save();
  ctx.$('#buildMain').scrollTop = 0;
  ctx.$('#buildMain').focus({ preventScroll: true });
}

function go(step) {
  const list = pages();
  const i = list.indexOf(d.page) + step;
  if (i >= 0 && i < list.length) show(list[i]);
}

async function next() {
  const page = d.page;
  if (page === 'start') {
    if (!d.start) return ctx.toast('시작 방식을 골라 주세요');
    if (d.start === 'ai') return finish({ delegate: true, hint: d.hint || '', char: {} });
  }
  if (page === 'chars') {
    if (d.method === 'point') {
      const sum = Object.values(d.stats || {}).reduce((a, v) => a + (Number(v) || 0), 0);
      if (sum !== info.pointBuy) return ctx.toast(`특성치 합이 ${info.pointBuy}이 되게 맞춰 주세요 (지금 ${sum})`);
    }
    if ((d.method || 'roll') === 'roll') await rollMissing();
  }
  if (page === 'name' && !String(d.name || '').trim()) return ctx.toast('이름을 정해 주세요 (🎲를 눌러도 돼요)');
  if (page === 'review') return finish({ char: character() });
  go(1);
}

async function rollMissing() {
  const have = camp()?.builder?.rolls || {};
  for (const k of [...info.chars.map((c) => c.name), '행운']) if (have[k] === undefined) await ctx.api('/api/builder/roll', { name: k });
}

function delegateRest() {
  if (!confirm(`지금까지 고른 것은 그대로 두고, 나머지는 ${gmGa()} 채워 캐릭터를 완성해요. 맡길까요?`)) return;
  finish({ delegate: true, char: character(true) });
}

async function finish(body) {
  clearTimeout(saveTimer);
  const r = await ctx.api('/api/builder/finish', body);
  if (r.ok) hide();
}

// ---------------------------------------------------------------------------
// Events

function onClick(e) {
  const t = e.target.closest('button, [data-pick]');
  if (!t) return;
  const { pick, toggle, fill, act } = t.dataset;
  const val = t.dataset.val;
  if (pick) {
    if (pick === 'start') {
      const a = cardOf(val);
      if (a) applyCard(a);
      else if (d.card) d = { cid: d.cid, page: 'start', hand: d.hand, visited: ['start'], answers: {}, relations: {}, touched: {} };
      d.start = val;
    } else if (pick === 'class') { setClass(val); }
    else if (pick === 'conceptCard') { conceptCard(val); }
    else if (pick === 'occupation') { setOccupation(val); }
    else if (pick === 'method') { d.method = val; if (val !== 'roll' && val !== 'card') d.stats = defaultsFor(val); d.card = null; d.occ = null; d.personal = null; }
    else { set(pick, val); if (t.dataset.touch) d.touched[t.dataset.touch] = true; }
    return redraw();
  }
  if (toggle) {
    const list = get(toggle) || [];
    const max = Number(t.dataset.max || 99);
    const isObj = t.dataset.obj;
    const item = isObj ? JSON.parse(t.dataset.obj) : val;
    const key = isObj ? item.name : val;
    const at = list.findIndex((x) => (isObj ? x.name : x) === key);
    if (at >= 0) list.splice(at, 1);
    else if (list.length >= max) return ctx.toast(`${max}개까지 고를 수 있어요`);
    else list.push(item);
    set(toggle, list);
    if (t.dataset.touch) d.touched[t.dataset.touch] = true;
    return redraw();
  }
  if (fill) { set(fill, val); return redraw(); }
  switch (act) {
    case 'deal': d.hand = null; if (cardOf(d.start)) d.start = null; return redraw();
    case 'review': d.visited = [...new Set([...d.visited, ...pages()])]; return show('review');
    case 'go': return show(t.dataset.page);
    case 'name': rollName(); d.namePool = null; return redraw();
    case 'intro': d.concept = d.introAuto = introDraft(); return redraw();
    case 'gear': {
      const g = classOf().gear.groups[Number(t.dataset.g)];
      const oi = Number(t.dataset.o);
      d.gearPick ??= defaultGear(classOf());
      const cur = d.gearPick[t.dataset.g] ||= [];
      if (cur.includes(oi)) { if (g.pick > 1) cur.splice(cur.indexOf(oi), 1); }
      else if (g.pick === 1) cur.splice(0, cur.length, oi);
      else if (cur.length < g.pick) cur.push(oi);
      else return ctx.toast(`${g.pick}개까지 고를 수 있어요`);
      d.touched.gear = true;
      return redraw();
    }
    case 'roll': return ctx.api('/api/builder/roll', { name: t.dataset.name });
    case 'rollAll': return rollMissing();
    case 'recommend':
      if (d.page === 'stats' && rules() === 'dw') { d.scores = { ...classOf().scores }; d.touched.stats = false; }
      if (d.page === 'stats' && rules() === 'd20') d.stats = { ...D20_DEFAULT };
      if (d.page === 'occSkills') recommendOcc();
      if (d.page === 'personal') recommendPersonal();
      return redraw();
    case 'step': {
      const pool = t.dataset.pool;
      const name = t.dataset.skill;
      d[pool] ??= {};
      d[pool][name] = clampPoints(pool, name, (Number(d[pool][name]) || 0) + Number(t.dataset.step));
      d.touched[pool === 'occ' ? 'occSkills' : 'personal'] = true;
      return redraw();
    }
    case 'bondAdd':
      d.bonds ??= [];
      if (d.bonds.length < 3 && others().length) d.bonds.push({ with: others()[Math.min(d.bonds.length, others().length - 1)].key, tpl: d.bonds.length % classOf().bonds.length });
      return redraw();
    case 'bondDel': d.bonds.splice(Number(t.dataset.i), 1); return redraw();
    default:
  }
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.bind) {
    set(t.dataset.bind, t.value);
    if (t.dataset.touch) d.touched[t.dataset.touch] = true;
    renderSide();
    save();
  }
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.score) return swapValue('scores', t.dataset.score, Number(t.value));
  if (t.dataset.quick) return swapValue('stats', t.dataset.quick, Number(t.value));
  if (t.dataset.stat) {
    d.stats[t.dataset.stat] = Math.round(Number(t.value) || 0);
    d.touched.stats = true;
    return redraw();
  }
  if (t.dataset.pool) {
    d[t.dataset.pool] ??= {};
    d[t.dataset.pool][t.dataset.skill] = clampPoints(t.dataset.pool, t.dataset.skill, Number(t.value) || 0);
    return redraw();
  }
  if (t.dataset.addSkill && t.value) {
    d.personal ??= {};
    d.personal[t.value] ??= 0;
    return redraw();
  }
  if (t.dataset.bond !== undefined) {
    const b = d.bonds[Number(t.dataset.bond)];
    b[t.dataset.part] = t.dataset.part === 'tpl' ? Number(t.value) : t.value;
    b.text = '';
    return redraw();
  }
}

// One of each value (DW scores, CoC quick-fire): picking a taken value swaps the two.
function swapValue(key, stat, v) {
  const vals = d[key];
  const other = Object.keys(vals).find((k) => k !== stat && vals[k] === v);
  if (other) vals[other] = vals[stat];
  vals[stat] = v;
  d.touched.stats = true;
  redraw();
}

function clampPoints(pool, name, v) {
  const budget = pool === 'occ' ? (chars().교육 || 50) * 4 : (chars().지능 || 50) * 2;
  const room = budget - spent(pool) + (Number(d[pool]?.[name]) || 0);
  const cap = 80 - skillBase(name) - (Number((pool === 'occ' ? d.personal : d.occ)?.[name]) || 0);
  return Math.max(0, Math.min(v, room, cap));
}

// Starting values for the quick-fire and point-buy methods (point buy: an even split in fives).
function defaultsFor(method) {
  const keys = info.chars.map((c) => c.name);
  if (method === 'quick') return Object.fromEntries(keys.map((k, i) => [k, [...info.quick].sort((a, b) => b - a)[i]]));
  const base = Math.floor(info.pointBuy / keys.length / 5) * 5;
  let extra = info.pointBuy - base * keys.length;
  return Object.fromEntries(keys.map((k) => { const add = Math.min(5, extra); extra -= add; return [k, base + add]; }));
}

function redraw() {
  renderPage();
  save();
}

// ---------------------------------------------------------------------------
// Pages

const head = (q, help) => `<h2 class="q">${esc(q)}</h2>${help ? `<p class="muted">${help}</p>` : ''}`;
const chip = (attrs, label, on) => `<button type="button" class="bchip${on ? ' on' : ''}" aria-pressed="${!!on}" ${attrs}>${esc(label)}</button>`;
const chipsRow = (html) => `<div class="bchips">${html}</div>`;
// A choice card in the Slay the Spire shape (see the selection-card-copy skill): name and
// a few numbers, two lines in the world's voice, one signature ability in its own box.
// Phones show line 2 and the signature only on the picked card.
const pcard = ({ attrs, title, nums, intro = [], sig, on }) => `<button type="button" class="bcard pcard${on ? ' on' : ''}" aria-pressed="${!!on}" ${attrs}>
  <span class="ph"><span class="rn">${title}</span>${nums ? `<span class="pn">${esc(nums)}</span>` : ''}</span>
  ${intro[0] ? `<span class="rd">${esc(intro[0])}</span>` : ''}${intro[1] ? `<span class="rd rd2">${esc(intro[1])}</span>` : ''}
  ${sig ? `<span class="sig"><b>${esc(sig.name)}</b><span>${esc(sig.text)}</span></span>` : ''}</button>`;
const card = (attrs, title, desc, tags, on, extra = '') => `<button type="button" class="bcard${on ? ' on' : ''}" aria-pressed="${!!on}" ${attrs}>
  <span class="rn">${title}</span>${desc ? `<span class="rd">${esc(desc)}</span>` : ''}${tags?.length ? `<span class="rt">${tags.map((x) => `<span>${esc(x)}</span>`).join('')}</span>` : ''}${extra}</button>`;
const field = (label, bind, value, ph, { area, touch } = {}) => `<label class="bfield">${esc(label)}${area
  ? `<textarea rows="3" data-bind="${bind}"${touch ? ` data-touch="${touch}"` : ''} placeholder="${esc(ph || '')}">${esc(value || '')}</textarea>`
  : `<input data-bind="${bind}"${touch ? ` data-touch="${touch}"` : ''} value="${esc(value || '')}" placeholder="${esc(ph || '')}">`}</label>`;
const question = (key, q, chips) => `<div class="bq"><h3 class="sub">${esc(q)}</h3>${chipsRow(chips.map((c) => chip(`data-fill="answers.${key}" data-val="${esc(c)}"`, c, d.answers[key] === c)).join(''))}
  <input data-bind="answers.${key}" value="${esc(d.answers[key] || '')}" placeholder="직접 쓰기"></div>`;

const PAGE = {
  start() {
    const all = cards();
    const g = ctx.genre();
    const pool = rules() === 'd20' && all.filter((a) => a.genre === g).length >= 3 ? all.filter((a) => a.genre === g) : all;
    if (!d.hand || d.hand.some((id) => !cardOf(id))) {
      const prev = d.hand || [];
      const ordered = shuffle(pool).sort((a, b) => prev.includes(a.id) - prev.includes(b.id));
      const hand = [];
      for (const a of ordered) if (hand.length < 3 && !hand.some((x) => x.genre && x.genre === a.genre)) hand.push(a);
      for (const a of ordered) if (hand.length < 3 && !hand.includes(a)) hand.push(a);
      d.hand = hand.map((a) => a.id);
    }
    return head('어떻게 만들까요?', '처음이라면 빠른 시작 카드를 골라 보세요. 나중에 페이지를 넘기며 하나씩 고칠 수 있어요.')
      + '<h3 class="sub">빠른 시작</h3>'
      + `<div class="bcards">${d.hand.map(cardOf).map((a) => pcard({ attrs: `data-pick="start" data-val="${a.id}"`, title: `${a.icon} ${esc(a.title)}`,
        nums: quickNums(a), intro: a.intro, sig: quickSig(a), on: d.start === a.id })).join('')}</div>`
      + `<div class="bchips"><button type="button" class="bchip dice" data-act="deal">🎲 다른 카드</button>${cardOf(d.start) ? '<button type="button" class="bchip" data-act="review">이대로 확인으로 →</button>' : ''}</div>`
      + '<h3 class="sub">직접</h3><div class="bcards">'
      + card('data-pick="start" data-val="scratch"', '✍ 처음부터 만들기', `${pages().length - 2}단계로 하나씩 골라요. 단계마다 추천값이 있어서 "다음"만 눌러도 돼요.`, [], d.start === 'scratch')
      + card('data-pick="start" data-val="ai"', `🎭 ${gm()}에게 맡기기`, `원하는 캐릭터를 한 줄로 적으면 ${gmGa()} 다 만들어요.`, [], d.start === 'ai')
      + '</div>'
      + (d.start === 'ai' ? field('원하는 캐릭터 (선택)', 'hint', d.hint, '예: 겁 많은 견습 마법사') : '');
  },

  class() {
    return head('어떤 직업으로 할까요?', '직업은 캐릭터가 잘하는 일과, 처음부터 쓸 수 있는 특별한 액션을 정해요. 일행끼리는 서로 다른 직업을 골라요.')
      + `<div class="bcards">${info.classes.map((c) => pcard({ attrs: `data-pick="class" data-val="${esc(c.name)}"`, title: `${c.icon} ${esc(c.name)}`,
        nums: `HP ${c.hp}+체력 · 피해 ${c.damage}`, intro: c.intro, sig: c.signature, on: d.class === c.name })).join('')}</div>`;
  },

  stats() {
    if (rules() === 'dw') {
      const c = classOf();
      return head('능력치를 나눠 볼까요?', `16·15·13·12·9·8을 하나씩 나눠 가져요. 이미 쓴 값을 고르면 서로 바뀌어요. 가장 재미있어 보이는 액션에 쓰는 능력치에 16을 주세요. 판정은 2d6 + 능력수정치예요.`)
        + `<div class="brows">${info.stats.map((s) => {
          const v = d.scores[s.name];
          return `<div class="brow"><div class="bl"><b>${s.name}</b> <span class="mod">${sg(modOf(v))}</span><small>${esc(s.help)}</small></div>
            <select data-score="${s.name}" aria-label="${s.name}">${info.scores.map((x) => `<option${x === v ? ' selected' : ''}>${x}</option>`).join('')}</select></div>`;
        }).join('')}</div>`
        + `<div class="bchips"><button type="button" class="bchip" data-act="recommend">${esc(c?.name || '')} 추천 배치로</button></div>`;
    }
    const sum = Object.values(d.stats).reduce((a, v) => a + v, 0);
    return head('능력치를 정해 볼까요?', `각 능력치는 ${info.min}~+${info.max}, 합이 ${info.budget}이 되게 나눠요. 판정은 d20 + 보정치예요.`)
      + `<div class="brows">${info.stats.map((s) => `<div class="brow"><div class="bl"><b>${s.name}</b><small>${esc(s.help)}</small></div>
          <select data-stat="${s.name}" aria-label="${s.name}">${[-1, 0, 1, 2, 3].map((x) => `<option value="${x}"${x === d.stats[s.name] ? ' selected' : ''}>${sg(x)}</option>`).join('')}</select></div>`).join('')}</div>`
      + `<p class="${sum === info.budget ? 'muted' : 'over'}">합 ${sum} / ${info.budget}${sum !== info.budget ? ' · 맞지 않으면 서버가 맞춰 줘요' : ''}</p>`
      + '<div class="bchips"><button type="button" class="bchip" data-act="recommend">고르게 나누기</button></div>';
  },

  moves() {
    const c = classOf();
    const abbr = { 근력: '+근', 민첩성: '+민', 체력: '+체', 지능: '+지', 지혜: '+혜', 매력: '+매' };
    return head(`${c.name}의 핵심 액션`, '액션은 특별한 행동이에요. 이름을 외칠 필요는 없고, 이야기 속에서 그 행동을 하면 마스터가 판정을 불러요. 여기서는 읽어만 보세요.')
      + `<div class="bmoves">${c.moves.map((m) => `<div class="bmove"><b>${esc(m.name)}</b>${m.stat ? ` <span class="muted">· ${esc(abbr[m.stat] || m.stat)} 판정</span>` : ''}
        <div>${esc(m.when)}</div><div class="muted">10+ ${esc(m.strong)}${m.weak ? ` · 7~9 ${esc(m.weak)}` : ''}</div></div>`).join('')}</div>`
      + `<h3 class="sub">판정 없이 갖는 것</h3><ul class="blist">${c.passives.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
      + `<h3 class="sub">누구나 쓰는 기본 액션</h3><p class="muted">${info.basicMoves.map(esc).join(' · ')}</p>`;
  },

  gear() {
    const custom = field('직접 추가 (쉼표로)', 'customItems', d.customItems, '예: 낡은 지도, 은화 주머니');
    if (rules() === 'dw') {
      const c = classOf();
      const picks = d.gearPick || defaultGear(c);
      return head('무엇을 챙길까요?', `${esc(iga(c.name))} 처음 갖고 시작하는 장비예요. 묶음마다 정해진 개수만큼 골라요. 보호구가 장갑을 정해요 (지금 장갑 ${dwGear().armor}).`)
        + (c.gear.always.length ? `<p class="muted">기본으로 가진 것: ${c.gear.always.map(esc).join(', ')}</p>` : '')
        + c.gear.groups.map((g, gi) => `<h3 class="sub">${esc(g.label)}${g.pick > 1 ? ` (${g.pick}개)` : ''}</h3>`
          + chipsRow(g.options.map((o, oi) => chip(`data-act="gear" data-g="${gi}" data-o="${oi}"`, `${o.name}${o.armor ? ` · 장갑 ${o.armor}` : o.shield ? ' · 장갑 +1' : ''}`, picks[gi]?.includes(oi))).join(''))).join('')
        + custom;
    }
    if (rules() === 'coc7') {
      const weapons = [...info.gear.weapons, ...(d.weapons || []).filter((w) => !info.gear.weapons.some((x) => x.name === w.name))];
      const items = [...new Set([...info.gear.items, ...(d.items || [])])];
      return head('무엇을 들고 다니나요?', '1920년대 탐사자의 소지품이에요. 총은 위험할 때 도움이 되지만, 괴물에게는 잘 안 듣기도 해요.')
        + `<h3 class="sub">소지품</h3>${chipsRow(items.map((x) => chip(`data-toggle="items" data-val="${esc(x)}" data-max="8"`, x, d.items?.includes(x))).join(''))}`
        + `<h3 class="sub">무기 (선택, 2개까지)</h3>${chipsRow(weapons.map((w) => chip(`data-toggle="weapons" data-obj="${esc(JSON.stringify(w))}" data-max="2"`, `${w.name} · ${w.damage}`, d.weapons?.some((x) => x.name === w.name))).join(''))}`
        + custom;
    }
    return '';
  },

  items() {
    const g = ctx.genre();
    const same = cards().filter((a) => !g || a.genre === g);
    const pool = [...new Set([...(same.length ? same : cards()).flatMap((a) => a.items), ...(d.items || [])])].slice(0, 24);
    return head('무엇을 챙길까요?', '소지품은 이야기 속에서 할 수 있는 일을 넓혀 줘요. 6개까지 골라요.')
      + chipsRow(pool.map((x) => chip(`data-toggle="items" data-val="${esc(x)}" data-max="6"`, x, d.items?.includes(x))).join(''))
      + field('직접 추가 (쉼표로)', 'customItems', d.customItems, '예: 낡은 지도, 은화 주머니');
  },

  look() {
    const pers = chipsRow(info.personality.map((p) => chip(`data-toggle="personality" data-val="${esc(p)}" data-max="2"`, p, d.personality?.includes(p))).join(''));
    if (rules() === 'dw') {
      const c = classOf();
      return head('어떻게 생겼나요?', '각 줄에서 하나씩 골라요. GM과 다른 플레이어가 장면을 그릴 때 써요.')
        + Object.entries(c.looks).map(([g, list]) => `<h3 class="sub">${esc(g)}</h3>${chipsRow(list.map((x) => chip(`data-pick="look.${g}" data-val="${esc(x)}" data-touch="look"`, x, d.look?.[g] === x)).join(''))}`).join('')
        + field('외모 더 적기 (선택)', 'lookText', d.lookText, '예: 왼쪽 눈썹에 흉터')
        + `<h3 class="sub">성격 (2개까지)</h3>${pers}` + field('성격 더 적기 (선택)', 'personalityText', d.personalityText, '예: 칭찬을 들으면 귀가 빨개진다');
    }
    return head('어떤 사람인가요?', '외모와 성격은 AI들이 캐릭터를 대할 때 참고해요.')
      + `<h3 class="sub">외모 (3개까지)</h3>${chipsRow(info.looks.map((x) => chip(`data-toggle="looks" data-val="${esc(x)}" data-max="3"`, x, d.looks?.includes(x))).join(''))}`
      + field('외모 더 적기 (선택)', 'lookText', d.lookText, '예: 늘 빨간 목도리를 두른다')
      + `<h3 class="sub">성격 (2개까지)</h3>${pers}` + field('성격 더 적기 (선택)', 'personalityText', d.personalityText, '예: 위기일수록 농담이 는다');
  },

  alignment() {
    const c = classOf();
    return head('가치관을 골라 주세요', '가치관은 캐릭터의 도덕관과 인생관이에요. 고른 가치관대로 행동하면 세션이 끝날 때 경험치를 얻어요. 직업마다 고를 수 있는 가치관이 달라요.')
      + `<div class="bcards">${c.alignments.map((a) => card(`data-pick="alignment" data-val="${a.name}" data-touch="alignment"`, esc(a.name), a.motive, [], d.alignment === a.name)).join('')}</div>`
      + field('배경 (선택)', 'background', d.background, '어디서 왔고, 무엇을 겪었나요?', { area: true });
  },

  concept() {
    const g = ctx.genre();
    const same = cards().filter((a) => !g || a.genre === g);
    return head('어떤 인물인가요?', '한 줄 콘셉트가 캐릭터의 중심이에요. 예시를 누르면 어울리는 능력치와 소지품도 함께 채워져요.')
      + chipsRow((same.length ? same : cards()).map((a) => chip(`data-pick="conceptCard" data-val="${a.id}"`, `${a.icon} ${a.concept}`, d.concept === a.concept)).join(''))
      + field('콘셉트', 'concept', d.concept, '예: 빚에 쫓기는 몰락 귀족 검사');
  },

  chars() {
    const m = d.method || 'roll';
    const ch = chars();
    const seg = [['roll', '🎲 굴리기'], ['quick', '빠른 배분'], ['point', `포인트 ${info.pointBuy}`]];
    const segHtml = `<div class="bseg">${seg.map(([k, l]) => chip(`data-pick="method" data-val="${k}"`, l, m === k)).join('')}</div>`;
    const note = {
      roll: '원작 방식이에요. 특성치마다 주사위를 굴리고, 결과는 다시 굴릴 수 없어요.',
      quick: `선택 규칙: ${info.quick.join('·')}을 하나씩 나눠 가져요. 이미 쓴 값을 고르면 서로 바뀌어요.`,
      point: `선택 규칙: 합이 ${info.pointBuy}이 되게 나눠요 (각 15~90).`,
      card: '빠른 시작 카드의 값이에요. 직접 정하려면 위에서 방식을 고르세요.',
    }[m];
    const rows = info.chars.map((c) => {
      const v = ch[c.name];
      let ctl;
      if (m === 'roll') ctl = v === undefined ? `<button type="button" class="broll" data-act="roll" data-name="${c.name}">${esc(c.dice)} 굴리기</button>` : `<b class="bval">${v}</b>`;
      else if (m === 'quick') ctl = `<select data-quick="${c.name}" aria-label="${c.name}">${[...new Set(info.quick)].map((x) => `<option${x === v ? ' selected' : ''}>${x}</option>`).join('')}</select>`;
      else if (m === 'point') ctl = `<input type="number" min="15" max="90" step="5" data-stat="${c.name}" value="${v}" aria-label="${c.name}">`;
      else ctl = `<b class="bval">${v}</b>`;
      return `<div class="brow"><div class="bl"><b>${c.name}</b>${v !== undefined ? ` <span class="mod">어려움 ${Math.floor(v / 2)} · 극단 ${Math.floor(v / 5)}</span>` : ''}<small>${esc(c.help)}</small></div>${ctl}</div>`;
    }).join('');
    const luck = ch.행운;
    const sum = info.chars.reduce((a, c) => a + (Number(ch[c.name]) || 0), 0);
    const all = info.chars.every((c) => ch[c.name] !== undefined);
    return head('특성치를 정해요', '특성치는 0~99의 백분율이에요. 판정은 d100을 굴려 그 값 이하면 성공이에요.')
      + (m === 'card' ? `<p class="muted">${note}</p>${segHtml}` : `${segHtml}<p class="muted">${note}</p>`)
      + `<div class="brows">${rows}
        <div class="brow"><div class="bl"><b>행운</b><small>${esc(info.luck.help)} · 서버가 굴려요</small></div>${luck === undefined ? `<button type="button" class="broll" data-act="roll" data-name="행운">${esc(info.luck.dice)} 굴리기</button>` : `<b class="bval">${luck}</b>`}</div></div>`
      + (m === 'roll' && !all ? '<div class="bchips"><button type="button" class="bchip dice" data-act="rollAll">🎲 남은 것 모두 굴리기</button></div>' : '')
      + (m === 'point' ? `<p class="${sum === info.pointBuy ? 'muted' : 'over'}">합 ${sum} / ${info.pointBuy}</p>` : '')
      + (all ? `<div class="bderived">HP ${Math.floor(((ch.건강 || 0) + (ch.크기 || 0)) / 10)} · 이성 ${ch.정신} · 마력 ${Math.floor(ch.정신 / 5)} · 회피 기본 ${Math.floor(ch.민첩 / 2)} · 직업 기능 ${ch.교육 * 4}점 · 관심 기능 ${ch.지능 * 2}점</div>` : '');
  },

  occupation() {
    const rec = recommended().slice(0, 3);
    return head('직업이 무엇인가요?', '직업은 잘하는 기능 8개와 재산(신용)의 범위를 정해요. 특성치에 어울리는 직업에 "추천"이 붙어요.')
      + `<div class="bcards">${info.occupations.map((o) => pcard({ attrs: `data-pick="occupation" data-val="${esc(o.name)}"`,
        title: `${o.icon} ${esc(o.name)}${rec.includes(o.name) ? ' <span class="brec">추천</span>' : ''}`,
        nums: `신용 ${o.credit[0]}~${o.credit[1]}`, intro: o.intro, sig: o.signature, on: d.occupation === o.name })).join('')}</div>`;
  },

  occSkills() {
    const o = occOf();
    const budget = (chars().교육 || 50) * 4;
    return head('직업 기능에 포인트를 나눠요', `교육×4 = ${budget}점을 ${esc(o.name)}의 기능과 신용에 나눠요. 기능 하나는 80까지예요.`)
      + `<p class="${spent('occ') > budget ? 'over' : 'muted'}">쓴 포인트 ${spent('occ')} / ${budget}</p>`
      + `<div class="brows">${[...o.skills, '신용'].map((n) => skillRow('occ', n, n === '신용' ? `범위 ${o.credit[0]}~${o.credit[1]}` : '')).join('')}</div>`
      + '<div class="bchips"><button type="button" class="bchip" data-act="recommend">추천대로 나누기</button></div>';
  },

  personal() {
    const budget = (chars().지능 || 50) * 2;
    const list = [...new Set([...info.personal, ...Object.keys(d.personal || {})])];
    const rest = Object.keys(info.skills).filter((n) => !list.includes(n) && n !== '크툴루 신화' && n !== '신용');
    return head('개인적으로 관심 있는 기능', `지능×2 = ${budget}점을 아무 기능에나 나눠요. 직업과 상관없는 취미나 특기예요.`)
      + `<p class="${spent('personal') > budget ? 'over' : 'muted'}">쓴 포인트 ${spent('personal')} / ${budget}</p>`
      + `<div class="brows">${list.map((n) => skillRow('personal', n)).join('')}</div>`
      + `<label class="bfield">다른 기능 더하기<select data-add-skill="1"><option value="">골라 주세요</option>${rest.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>`
      + '<div class="bchips"><button type="button" class="bchip" data-act="recommend">추천대로 나누기</button></div>';
  },

  backstory() {
    return head('어떤 사람인가요?', `배경은 이야기의 재료예요. ${gmGa()} 이걸 엮어 장면을 만들어요. 비워 둬도 괜찮아요.`)
      + info.backstory.map((q) => question(q.key, q.q, q.chips)).join('')
      + field('더 적고 싶은 배경 (선택)', 'background', d.background, '어디서 왔고, 무엇을 겪었나요?', { area: true });
  },

  name() {
    const pool = d.namePool ??= shuffle(names()).slice(0, 6);
    return head('이름을 지어 주세요', `AI 동료들과 ${gmGa()} 이 이름으로 부를 거예요.`)
      + `<label class="bfield">이름<span class="namebox"><input data-bind="name" value="${esc(d.name || '')}" placeholder="카엘"><button type="button" class="dice" data-act="name" aria-label="무작위 이름">🎲</button></span></label>`
      + chipsRow(pool.map((n) => chip(`data-pick="name" data-val="${esc(n)}"`, n, d.name === n)).join(''));
  },

  intro() {
    return head(`${d.name || '캐릭터'}${eul(d.name || '캐릭터')} 소개해 주세요`, '테이블에 처음 인사하는 한 줄이에요. 동료 목록과 AI들의 프롬프트에 이름 옆에 붙어요. 지금까지 고른 것으로 초안을 만들어 뒀으니 그대로 써도, 고쳐도 돼요.')
      + `<label class="bfield">${esc(d.name || '')} ·<input data-bind="concept" value="${esc(d.concept || '')}" placeholder="${esc(introDraft())}"></label>`
      + '<div class="bchips"><button type="button" class="bchip" data-act="intro">초안 다시 만들기</button></div>';
  },

  bonds() {
    const os = others();
    if (!os.length) return head('동료와의 인연', '동료가 아직 만들어지는 중이에요. 건너뛰어도 되고, 잠시 뒤 돌아와도 돼요.');
    return head('동료와의 인연', `${esc(classOf().name)}의 인연 문장에 동료 이름을 넣어요. 하나만 정해도 되지만 많을수록 유리해요. 같은 동료가 여러 번 나와도 돼요. 인연 수만큼 그 동료를 협조 또는 방해할 때 더해져요.`)
      + (d.bonds || []).map((b, i) => `<div class="bbond">
        <select data-bond="${i}" data-part="with" aria-label="동료">${os.map((o) => `<option value="${o.key}"${o.key === b.with ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        <select data-bond="${i}" data-part="tpl" aria-label="인연">${classOf().bonds.map((t, j) => `<option value="${j}"${j === b.tpl ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <input data-bind="bonds.${i}.text" value="${esc(bondText(b))}" aria-label="인연 문장">
        <button type="button" class="ghost" data-act="bondDel" data-i="${i}" aria-label="인연 지우기">✕</button></div>`).join('')
      + ((d.bonds || []).length < 3 ? '<div class="bchips"><button type="button" class="bchip" data-act="bondAdd">＋ 인연 더하기</button></div>' : '');
  },

  party() {
    const os = others();
    if (!os.length) return head('동료와의 관계', '동료가 아직 만들어지는 중이에요. 건너뛰어도 되고, 잠시 뒤 돌아와도 돼요.');
    return head('동료와의 관계', '이미 아는 사이라면 이야기가 더 빨리 엮여요. 비워 둬도 괜찮아요.')
      + os.map((o) => `<div class="bq"><h3 class="sub">${esc(o.name)} <span class="muted">${esc(o.concept)}</span></h3>
        ${chipsRow(RELATIONS.map((r) => chip(`data-fill="relations.${o.key}" data-val="${esc(r)}"`, r, d.relations[o.key] === r)).join(''))}
        <input data-bind="relations.${o.key}" value="${esc(d.relations[o.key] || '')}" placeholder="직접 쓰기"></div>`).join('');
  },

  review() {
    const list = pages().filter((p) => p !== 'start' && p !== 'review');
    return head('이대로 시작할까요?', '고치고 싶은 단계를 누르면 그 페이지로 가요.')
      + `<div class="bpreview">${previewHtml()}</div>`
      + chipsRow(list.map((p) => `<button type="button" class="bchip" data-act="go" data-page="${p}">${TITLE[p]} 고치기</button>`).join(''));
  },
};

// A quick-start card's numbers and signature: what its class or occupation gives (d20 cards
// carry their own signature).
function quickNums(a) {
  if (a.class) {
    const c = info.classes.find((x) => x.name === a.class);
    return `${a.class} · HP ${c ? c.hp + a.scores.체력 : '?'}`;
  }
  if (a.occupation) return `${a.occupation} · HP ${Math.floor((a.stats.건강 + a.stats.크기) / 10)} · 이성 ${a.stats.정신}`;
  return `HP ${10 + 2 * (a.stats?.체력 || 0)}`;
}
function quickSig(a) {
  if (a.signature) return a.signature;
  if (a.class) return info.classes.find((x) => x.name === a.class)?.signature;
  return info.occupations?.find((x) => x.name === a.occupation)?.signature;
}

function skillRow(pool, n, note = '') {
  const pts = Number(d[pool]?.[n]) || 0;
  return `<div class="brow skill"><div class="bl"><b>${esc(n)}</b> <span class="mod">${skillValue(n)}</span><small>기본 ${skillBase(n)}${note ? ` · ${esc(note)}` : ''}</small></div>
    <span class="bstep"><button type="button" class="ghost" data-act="step" data-pool="${pool}" data-skill="${esc(n)}" data-step="-5" aria-label="${esc(n)} 5 내리기">−</button>
    <input type="number" min="0" step="5" data-pool="${pool}" data-skill="${esc(n)}" value="${pts}" aria-label="${esc(n)} 포인트">
    <button type="button" class="ghost" data-act="step" data-pool="${pool}" data-skill="${esc(n)}" data-step="5" aria-label="${esc(n)} 5 올리기">+</button></span></div>`;
}

function modOf(score) {
  if (score <= 8) return -1;
  if (score <= 12) return 0;
  if (score <= 15) return 1;
  return 2;
}

// Korean object particle for a word: 을 after a final consonant, 를 otherwise.
function eul(word) {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 ? '을' : '를';
}

// A one-line introduction from the picks so far, e.g. "냉엄한 눈의 전사".
function introDraft() {
  if (rules() === 'dw') {
    const eyes = d.look?.눈;
    return `${eyes ? `${eyes}의 ` : ''}${d.class || '모험가'}`;
  }
  if (rules() === 'coc7') {
    const thing = d.answers['소중한 물건'];
    return `${thing ? `${thing}${eul(thing)} 늘 지닌 ` : ''}${d.occupation || '탐사자'}`;
  }
  return d.concept || '';
}

// A d20 concept example also brings its stats and items (unless the player set those).
function conceptCard(id) {
  const a = cardOf(id);
  if (!a) return;
  d.concept = a.concept;
  if (!d.touched.stats) d.stats = { ...a.stats };
  if (!d.touched.items) d.items = [...a.items];
  d.background ||= a.background;
}

// ---------------------------------------------------------------------------
// Render

function renderPage() {
  const $ = ctx.$;
  if (!d) return;
  const list = pages();
  if (!list.includes(d.page)) d.page = 'start';
  const i = list.indexOf(d.page);
  $('#buildBar').innerHTML = list.map((_, j) => `<span class="${j <= i ? 'on' : ''}"></span>`).join('');
  $('#buildCount').textContent = `${i + 1} / ${list.length}`;
  $('#buildStep').textContent = TITLE[d.page];
  $('#buildPrev').hidden = i === 0;
  const last = d.page === 'review';
  $('#buildNext').textContent = last ? '완성 · 테이블로' : d.page === 'start' && d.start === 'ai' ? `${gm()}에게 맡기기` : `다음 · ${TITLE[list[i + 1]]}`;
  $('#buildRest').textContent = `나머지는 ${gm()}에게`;
  $('#buildRest').hidden = d.page === 'start' || last || !!d.card;
  if (!info) { $('#buildMain').innerHTML = '<p class="muted">불러오는 중…</p>'; return; }
  if (d.page !== 'start') init(d.page);
  $('#buildMain').innerHTML = `<div class="bpage">${PAGE[d.page]()}</div>`;
  renderSide();
}

function previewHtml() {
  const r = rules();
  const ch = character();
  const sheet = { badges: [], stats: [], lists: [], tracks: [] };
  if (r === 'dw') {
    const c = classOf();
    sheet.badges = [ch.class, ch.alignment && `가치관 ${ch.alignment}`, c && `피해 ${c.damage}`, c && `장갑 ${dwGear().armor}`].filter(Boolean);
    if (c && d.scores) {
      sheet.tracks = [{ label: 'HP', value: c.hp + d.scores.체력, max: c.hp + d.scores.체력 }];
      sheet.stats = info.stats.map((s) => ({ label: s.name, value: sg(modOf(d.scores[s.name])), sub: String(d.scores[s.name]) }));
    }
    if (ch.bonds?.length) sheet.lists.push({ title: '인연', items: ch.bonds.map((b) => b.text) });
  } else if (r === 'coc7') {
    const c = chars();
    sheet.badges = [ch.occupation].filter(Boolean);
    if (c.건강 && c.크기) sheet.tracks.push({ label: 'HP', value: Math.floor((c.건강 + c.크기) / 10), max: Math.floor((c.건강 + c.크기) / 10) });
    if (c.정신) sheet.tracks.push({ label: '이성', value: c.정신, max: 99, kind: 'san' });
    if (c.행운) sheet.tracks.push({ label: '행운', value: c.행운, max: 99 });
    sheet.stats = (info?.chars || []).map((x) => ({ label: x.name, value: c[x.name] ?? '?' }));
    const top = Object.entries(ch.skills || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) sheet.lists.push({ title: '기능', items: top.map(([n, v]) => `${n} ${v}`) });
    if (ch.weapons?.length) sheet.lists.push({ title: '무기', items: ch.weapons.map((w) => `${w.name} (${w.damage})`) });
  } else if (d.stats) {
    sheet.tracks = [{ label: 'HP', value: 10 + 2 * (d.stats.체력 || 0), max: 10 + 2 * (d.stats.체력 || 0) }];
    sheet.stats = info.stats.map((s) => ({ label: s.name, value: sg(d.stats[s.name] ?? 0) }));
  }
  return ctx.sheetHtml({ key: 'user', name: ch.name || '이름 없음', concept: ch.concept || '', sheet, items: ch.items, appearance: ch.appearance, personality: ch.personality, background: ch.background, conditions: [] }, true);
}

function renderSide() {
  const $ = ctx.$;
  const c = camp();
  if (!c || !d) return;
  const os = Object.values(ctx.state().characters || {}).filter((x) => x.key !== 'user');
  const waiting = (ctx.state().seats || []).filter((s) => s.key !== 'gm' && s.key !== 'user' && !ctx.state().characters?.[s.key]).length;
  $('#buildMini').innerHTML = `<span>${esc(d.name || '내 캐릭터')}</span><span class="muted">${esc(c.title || '세계를 만드는 중…')} · 동료 ${os.length}${waiting ? ` (+${waiting})` : ''}</span>`;
  $('#buildSideBody').innerHTML = `
    <section class="bworld"><h3>${esc(c.title || `${gmGa()} 세계를 만드는 중…`)}</h3>
      ${c.pitch ? `<p>${esc(c.pitch)}</p>` : `<p class="muted">${esc(c.premise || `전제는 ${gmGa()} 정해요.`)}</p>`}
      ${c.characterHint ? `<p class="bhint">어울리는 인물: ${esc(c.characterHint)}</p>` : ''}</section>
    <section><h3>동료</h3>${os.length || waiting ? `<ul class="blist">${os.map((o) => `<li><b>${esc(o.name)}</b> <span class="muted">${esc(o.class || o.occupation || '')} · ${esc(o.concept)}</span></li>`).join('')}${waiting ? `<li class="muted">${waiting}명 만드는 중…</li>` : ''}</ul>` : '<p class="muted">혼자 모험해요.</p>'}</section>
    ${d.page !== 'review' && info ? `<section><h3>미리보기</h3>${previewHtml()}</section>` : ''}`;
}
