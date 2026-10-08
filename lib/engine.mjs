// The table: a round-based state machine around the GM seat and the player seats. The
// round is the same for every rule system; lib/rules/<id>.mjs decides sheets, checks and
// what a roll means.
//
//   prep     GM designs the world → every player makes a character (the human builds
//            theirs page by page meanwhile, see "Character builder") → (rule-specific
//            extra step, e.g. Dungeon World bonds) → GM opens the first scene
//   declare  each player declares what their character tries (AIs in turn, the human any time)
//   resolve  GM decides which actions need checks → server rolls → GM narrates the results
//   roll     waiting on players after the rolls: the human rolling their own check, or anyone
//            picking options a roll gave them (Dungeon World 7–9 and the like)
//   gm-wait  (only when the human is the GM) waiting for the human's narration
//   ended    the GM closed the story
//
// Model calls never block the server: pump() starts whatever the current phase needs and
// every finished call calls pump() again.

import crypto from 'node:crypto';
import { BACKENDS } from './backends.mjs';
import { extractJson, str, strList } from './parse.mjs';
import { rollDice } from './dice.mjs';
import { RULESETS, rulesetOf } from './rules/index.mjs';
import * as P from './prompts.mjs';
import { Ledger, formatFact, knows } from './facts.mjs';
import { QUICK_FIRE, POINT_BUY } from './builder.mjs';
import { ARCHETYPES } from '../public/archetypes.js';

const PLAYER_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5'];

// A Dungeon World story's front, as the gallery sends it: what the GM prepares instead of a
// plot (dangers with their portents and doom, the cast, what is left blank on purpose).
function cleanFront(f) {
  if (!f || typeof f !== 'object') return null;
  const dangers = (Array.isArray(f.dangers) ? f.dangers : []).slice(0, 3).map((d) => ({
    name: str(d?.name, 60), type: str(d?.type, 30), motive: str(d?.motive, 80),
    portents: strList(d?.portents, 5, 120),
    doom: { text: str(d?.doom?.text, 160), type: str(d?.doom?.type, 20) },
  })).filter((d) => d.name);
  if (!dangers.length) return null;
  return { dangers, cast: strList(f.cast, 8), blank: str(f.blank, 160), clock: str(f.clock, 120) };
}
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const newId = () => crypto.randomBytes(4).toString('hex');

export class Engine {
  constructor({ backends, store, cfg, emit = () => {} }) {
    this.backends = backends;
    this.store = store;
    this.cfg = cfg;
    this.emit = emit;
    this.busy = new Map(); // seat key → kind of call in flight
    this.gen = 0; // bumps on a new campaign so late replies from the old one are dropped
    this.c = store.load();
    if (this.c) {
      this.c.rules ??= 'd20';
      this.c.foes ??= [];
      this.c.pendingChoices ??= [];
      this.c.clues ??= [];
      this.c.facts ??= {};
      for (const ch of Object.values(this.c.characters || {})) this.R.migrate?.(ch);
      // A restart interrupted whatever was running; resume paused so nothing fires unasked.
      if (!['ended', 'setup'].includes(this.c.phase)) this.c.paused = true;
    }
  }

  get R() { return rulesetOf(this.c); }

  // -------------------------------------------------------------------------
  // Views

  seatStatus(key) {
    const c = this.c;
    if (this.busy.has(key)) return 'thinking';
    if (key === 'gm') return !c.gm && c.phase === 'gm-wait' ? 'waiting' : 'idle';
    if (c.phase === 'declare') {
      if (c.declared[key]) return 'done';
      if (this.inSpotlight(key)) return 'waiting';
    }
    if (c.pendingChecks?.some((p) => p.who === key)) return 'rolling';
    if (c.pendingChoices?.some((p) => p.who === key)) return 'choosing';
    return 'idle';
  }

  view() {
    const c = this.c;
    const rulesets = Object.fromEntries(Object.entries(RULESETS).map(([k, r]) => [k, r.meta()]));
    const backends = Object.fromEntries(Object.entries(BACKENDS).map(([k, b]) => [k, { label: b.label, color: b.color }]));
    if (!c) return { phase: 'setup', campaign: null, available: this.backends.available(), rulesets, backends };
    const R = this.R;
    const characters = {};
    for (const [k, ch] of Object.entries(c.characters)) {
      const { notes, ...pub } = ch; // private notes stay off the public view
      characters[k] = { ...pub, hasNotes: !!notes, sheet: R.sheetView(ch) };
    }
    const seats = [
      { key: 'gm', backend: c.gm?.backend || 'human', label: P.seatLabel(c, 'gm'), status: this.seatStatus('gm') },
      ...P.playerKeys(c).map((k) => {
        const s = c.seats.find((x) => x.key === k);
        return { key: k, backend: s?.backend || 'human', label: P.seatLabel(c, k), status: this.seatStatus(k) };
      }),
    ];
    return {
      phase: c.phase,
      available: this.backends.available(),
      rulesets,
      campaign: {
        id: c.id, title: c.title, premise: c.premise, tone: c.tone, pitch: c.pitch,
        rules: c.rules, rulesLabel: R.label, gmName: R.gmName,
        userRole: c.userRole, userName: c.userName, round: c.round,
        scene: c.scene, summary: c.summary, paused: !!c.paused, error: c.error || null,
        spotlight: c.spotlight || null, foes: c.foes, clues: c.clues || [],
        // What the human's side of the table knows: their character's facts as a player,
        // the public ones otherwise. The whole ledger is behind /api/secrets.
        knownFacts: this.ledger().list.filter((f) => (c.userRole === 'player' ? knows(f, 'user') : f.known === 'all')).map((f) => formatFact(f)),
        pendingChecks: c.pendingChecks || [], pendingChoices: c.pendingChoices || [],
        prepStep: c.prep?.step || null,
        characterHint: c.characterHint || '',
        // The human's character builder: server-rolled characteristics and the saved draft.
        builder: this.builderState() ? { rolls: c.prep.builder.rolls, draft: c.prep.builder.draft } : null,
      },
      seats,
      characters,
      backends,
    };
  }

  secrets() {
    const c = this.c;
    if (!c) return {};
    return {
      gmNotes: c.gmNotes || '',
      facts: this.ledger().list.map((f) => ({ id: f.id, text: formatFact(f), p: f.p, known: f.known === 'all' ? '모두' : f.known === 'gm' ? '비밀' : f.known.map((k) => P.charName(c, k)).join(', ') })),
      rejected: c.facts?.rejected || [],
      rules: this.ledger().rules.map((r) => ({
        id: r.id, name: r.name, then: r.then, ending: r.ending, repeat: r.repeat, note: r.note,
        conds: this.ledger().condTruth(r, this.ruleCtx()),
        fired: Object.values(r.fired || {}),
      })),
      triggered: this.ledger().triggered.map((t) => ({ rule: t.rule, ending: t.ending, round: t.round, note: t.note })),
      conclusions: this.ledger().analyzeClues(P.playerKeys(c)).map((a) => ({
        ...a, support: a.support.map((x) => ({ ...x, who: x.who.map((k) => P.charName(c, k)) })),
      })),
      notes: Object.fromEntries(Object.entries(c.characters).map(([k, ch]) => [k, ch.notes || ''])),
    };
  }

  logTail(n = 400) { return this.c ? this.c.log.slice(-n) : []; }

  changed() {
    if (!this.c) return;
    this.store.saveSoon(this.c);
    this.emit('state', this.view());
  }

  post(m) {
    const c = this.c;
    const msg = { id: c.nextId++, ts: Date.now(), round: c.round, ...m };
    c.log.push(msg);
    if (c.log.length > 5000) c.log.splice(0, c.log.length - 5000);
    this.emit('msg', msg);
    this.store.saveSoon(c);
    return msg;
  }

  system(text, extra = {}) { return this.post({ type: 'system', from: 'system', text, ...extra }); }

  // -------------------------------------------------------------------------
  // Campaign setup

  // opts: {rules: 'd20'|'dw', premise, tone, userRole: 'player'|'spectator'|'gm', userName,
  //        title, opening (the first scene to start in), length: 'short'|'long' (from a story card),
  //        front, questions, openingAsk (a Dungeon World story's front, stakes questions, and
  //        the question the GM asks first),
  //        gm: backend, players: [backend...], userChar: {...} | {hint} | null}
  // A player with no userChar builds one in the character builder.
  newCampaign(opts = {}) {
    const avail = this.backends.available();
    const fallback = Object.keys(BACKENDS).find((b) => b !== 'mock' && avail[b]) || 'mock';
    const pickBackend = (b) => (b && BACKENDS[b] && avail[b] ? b : fallback);
    const userRole = ['player', 'spectator', 'gm'].includes(opts.userRole) ? opts.userRole : 'player';
    const players = (Array.isArray(opts.players) ? opts.players : []).slice(0, PLAYER_KEYS.length);
    if (!players.length && userRole !== 'player') players.push(fallback);
    if (this.c) this.store.archive(this.c);
    for (const k of this.busy.keys()) this.busy.delete(k);
    this.gen++;
    const c = this.c = {
      version: 2,
      id: `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt: Date.now(),
      rules: RULESETS[opts.rules] ? opts.rules : 'd20',
      // A story picked from the gallery brings its title, first scene and size.
      title: str(opts.title, 80),
      opening: str(opts.opening, 400),
      length: ['short', 'long'].includes(opts.length) ? opts.length : '',
      front: cleanFront(opts.front),
      questions: strList(opts.questions, 3, 120),
      openingAsk: str(opts.openingAsk, 160),
      // Blank premise/tone: the AI GM makes them up while designing the world.
      premise: str(opts.premise, 1500) || (userRole === 'gm' ? '평범한 마을에 이상한 일이 벌어지기 시작한 판타지 모험' : ''),
      tone: str(opts.tone, 200),
      userRole,
      userName: str(opts.userName, 30) || this.cfg.userName || '방장',
      gm: userRole === 'gm' ? null : { key: 'gm', backend: pickBackend(opts.gm), model: this.cfg.gmModel?.[pickBackend(opts.gm)] },
      seats: players.map((b, i) => ({ key: PLAYER_KEYS[i], backend: pickBackend(b) })),
      window: this.cfg.historyWindow || 40,
      phase: 'prep',
      prep: { step: userRole === 'gm' ? 'chars' : 'world', bonded: {}, rolls: {} },
      round: 0,
      scene: { title: '', description: '' },
      pitch: '', characterHint: '', summary: '', gmNotes: '',
      characters: {},
      foes: [], clues: [], facts: {},
      declared: {}, order: [], spotlight: null,
      resolve: null, pendingChecks: [], pendingChoices: [],
      roundsSinceUser: 0,
      paused: false, error: null,
      log: [], nextId: 1,
    };
    if (userRole === 'gm') {
      c.title ||= c.premise.slice(0, 40);
      c.pitch = c.premise;
    }
    const uc = opts.userChar;
    if (userRole === 'player' && uc && str(uc.name)) {
      c.characters.user = this.makeCharacter(uc, 'user');
      c.prep.bonded.user = true; // the human writes their own bonds (or none)
    } else if (userRole === 'player' && uc) {
      c.userCharHint = str(uc.hint, 300);
    } else if (userRole === 'player') {
      c.prep.builder = { draft: null, rolls: {} };
    }
    this.system(`새 캠페인을 준비합니다 (${this.R.label}). ${c.premise ? `전제: ${c.premise}` : '전제는 GM이 정합니다.'}`);
    this.store.saveNow(c);
    this.changed();
    this.pump();
    return c;
  }

  makeCharacter(raw, key, preroll) {
    const rule = this.R.makeCharacter(raw, { preroll });
    return {
      key,
      name: str(raw.name, 40) || '이름 없는 모험가',
      concept: str(raw.concept, 120),
      appearance: str(raw.appearance ?? raw.look, 300),
      personality: str(raw.personality, 300),
      background: str(raw.background, 600),
      items: strList(raw.items, 12),
      conditions: [],
      notes: str(raw.note, 1500),
      ...rule,
      hp: rule.maxHp,
    };
  }

  // -------------------------------------------------------------------------
  // Character builder: the human player's character, page by page, while the GM designs
  // the world and the AI players make theirs. The page saves its draft here (so a reload
  // picks up where it left off), asks the server to roll dice the rules roll (CoC
  // characteristics), and finishes with the character, or with what it has so far and a
  // request for the GM's backend to make the rest.

  builderState() {
    const b = this.c?.prep?.builder;
    return b && !b.delegated && !this.c.characters.user ? b : null;
  }

  builderSave(draft) {
    const b = this.builderState();
    if (!b) return '지금은 캐릭터를 만들 수 없어요';
    if (JSON.stringify(draft ?? null).length > 20000) return '초안이 너무 커요';
    b.draft = draft ?? null;
    this.store.saveSoon(this.c); // no broadcast: the page that sent it already has it
    return null;
  }

  builderRoll(name) {
    const b = this.builderState();
    if (!b) return '지금은 캐릭터를 만들 수 없어요';
    if (!this.R.rollOne) return '이 룰은 특성치를 굴리지 않아요';
    if (b.rolls[name] !== undefined) return '이미 굴렸어요';
    const v = this.R.rollOne(name);
    if (v === null) return '없는 특성치예요';
    b.rolls[name] = v;
    this.changed();
    return null;
  }

  // Characteristics for rules that roll them (CoC): the server's rolls (missing ones rolled
  // now), the quick-fire values / point buy, or a ready-made card's. Luck is always rolled.
  builderChars(b, raw) {
    const R = this.R;
    const luck = b.rolls.행운 ??= R.rollOne('행운');
    const card = raw.method === 'card' && ARCHETYPES[this.c.rules]?.find((a) => a.id === raw.card);
    if (card) return { chars: { ...card.stats }, luck };
    if (raw.method === 'quick' || raw.method === 'point') {
      const vals = R.STATS.map((k) => Math.round(Number(raw.stats?.[k])));
      const ok = raw.method === 'quick'
        ? [...vals].sort((x, y) => x - y).join() === [...QUICK_FIRE].sort((x, y) => x - y).join()
        : vals.every((v) => v >= 15 && v <= 90) && vals.reduce((a, v) => a + v, 0) === POINT_BUY;
      if (!ok) return { err: raw.method === 'quick' ? '빠른 배분 값을 하나씩 써 주세요' : `특성치 합이 ${POINT_BUY}이어야 해요` };
      return { chars: Object.fromEntries(R.STATS.map((k, i) => [k, vals[i]])), luck };
    }
    for (const k of R.STATS) b.rolls[k] ??= R.rollOne(k);
    return { chars: Object.fromEntries(R.STATS.map((k) => [k, b.rolls[k]])), luck };
  }

  builderFinish({ char, delegate, hint } = {}) {
    const c = this.c;
    const b = this.builderState();
    if (!b) return '지금은 캐릭터를 만들 수 없어요';
    const raw = char && typeof char === 'object' ? { ...char } : {};
    delete raw.luck;
    let rolled = null;
    if (this.R.rollOne) {
      rolled = this.builderChars(b, raw);
      if (rolled.err) return rolled.err;
      delete raw.stats;
    }
    if (delegate) {
      b.delegated = true;
      b.partial = raw;
      if (rolled) c.prep.rolls.user = { chars: rolled.chars, luck: rolled.luck };
      const chosen = Object.keys(raw).length ? `이미 정한 것(그대로 두고 나머지를 채워): ${JSON.stringify(raw).slice(0, 1500)}` : '';
      c.userCharHint = [str(hint, 300), chosen].filter(Boolean).join('\n');
      this.changed();
      this.pump();
      return null;
    }
    if (!str(raw.name)) return '이름을 정해 주세요';
    if (rolled) Object.assign(raw, { stats: rolled.chars, luck: rolled.luck });
    const ch = c.characters.user = this.makeCharacter(raw, 'user');
    c.prep.bonded.user = true;
    this.post({ type: 'system', from: 'user', text: `🧾 ${ch.name} — ${ch.concept} (플레이어: ${c.userName})` });
    if (ch.bonds?.length) this.post({ type: 'system', from: 'user', text: `🤝 ${ch.name}의 인연\n${ch.bonds.map((x) => `· ${x.text}`).join('\n')}` });
    this.changed();
    this.pump();
    return null;
  }

  // -------------------------------------------------------------------------
  // Model calls

  seatFor(key) {
    const c = this.c;
    if (key === 'gm') return c.gm;
    return c.seats.find((s) => s.key === key);
  }

  // Runs one call for a seat in the background. fn(live) does the work; live() turns
  // false if a new campaign started meanwhile, and the result is dropped.
  start(key, kind, fn) {
    if (this.busy.has(key)) return;
    const gen = this.gen;
    this.busy.set(key, kind);
    this.changed();
    Promise.resolve()
      .then(() => fn(() => gen === this.gen))
      .catch((e) => { if (gen === this.gen) this.fail(key, kind, String(e?.stack || e)); })
      .finally(() => {
        if (gen !== this.gen) return;
        this.busy.delete(key);
        this.changed();
        this.pump();
      });
  }

  async callJson(seat, kind, brief, turn, ctx) {
    let detail = '';
    ctx = { rules: this.c.rules, ...ctx };
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = attempt ? `${turn}\n\n(지난 응답을 읽지 못했어. 다른 말 없이 JSON 객체 하나만 출력해.)` : turn;
      const r = await this.backends.chat(seat, kind, brief, t, ctx);
      if (!r.ok) { detail = r.detail; continue; }
      const obj = extractJson(r.text);
      if (obj) return { obj };
      detail = `JSON 아님: ${r.text.slice(0, 200)}`;
    }
    return { obj: null, detail };
  }

  fail(key, kind, detail) {
    const c = this.c;
    if (kind === 'character') {
      c.characters[key] ??= this.makeCharacter({ name: `${P.seatLabel(c, key)}의 모험가`, concept: '떠돌이 모험가' }, key);
    } else if (kind === 'bonds') {
      c.prep.bonded[key] = true;
    } else if (kind === 'choose') {
      // Out of patience: the server picks the first options.
      const p = c.pendingChoices.find((x) => x.who === key);
      if (p) this.applyChoice(p, [...Array(p.count).keys()]);
    } else if (key === 'gm') {
      c.error = `GM 호출 실패 (${kind}): ${detail.slice(0, 300)}`;
      c.paused = true;
      this.system('GM이 응답하지 못했어요. 잠시 후 ▶ 재개를 누르면 다시 시도합니다.');
    } else {
      this.system(`${P.charName(c, key)}의 플레이어가 응답하지 못해 이번 라운드를 넘깁니다.`);
      if (c.phase === 'declare') c.declared[key] = true;
    }
    this.backends.log?.(key, `FAIL ${kind}: ${detail}`);
  }

  // -------------------------------------------------------------------------
  // The pump

  pump() {
    const c = this.c;
    if (!c || c.paused) return;
    this.pumpChoices();
    if (c.phase === 'prep') this.pumpPrep();
    else if (c.phase === 'declare') this.pumpDeclare();
    else if (c.phase === 'resolve') this.pumpResolve();
    else if (c.phase === 'roll') this.pumpRoll();
  }

  pumpPrep() {
    const c = this.c;
    const step = c.prep.step;
    if (step === 'world') {
      this.start('gm', 'worldbuild', async (live) => {
        const { obj, detail } = await this.callJson(c.gm, 'worldbuild', P.gmBrief(c), P.worldbuildTurn(c), { premise: c.premise, players: P.playerKeys(c).length });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'worldbuild', detail);
        if (!c.premise) c.premise = str(obj.premise, 1500) || str(obj.title, 80) || '이름 없는 모험';
        if (!c.tone) c.tone = str(obj.tone, 200);
        c.title ||= str(obj.title, 80) || '이름 없는 모험';
        c.pitch = str(obj.pitch, 2000);
        c.characterHint = str(obj.character_hint, 500);
        c.gmNotes = str(obj.gm_notes, 6000);
        this.applyFacts({ facts: { assert: Array.isArray(obj.facts) ? obj.facts : obj.facts?.assert || [] }, rules: Array.isArray(obj.rules) ? obj.rules : obj.rules?.add ? obj.rules : undefined });
        c.scene = { title: str(obj.scene?.title, 80), description: str(obj.scene?.description, 800) };
        this.post({ type: 'system', from: 'gm', text: `📜 ${c.title}\n\n${c.pitch}` });
        c.prep.step = 'chars';
      });
      return;
    }
    if (step === 'chars') {
      const missing = P.playerKeys(c).filter((k) => !c.characters[k]);
      // The human still in the builder: the others go on, then everyone waits for them.
      const todo = missing.filter((k) => !(k === 'user' && this.builderState()));
      if (!missing.length) {
        if (this.busy.size) return;
        c.prep.step = this.R.bondsTask ? 'bonds' : 'ready';
        this.changed();
        this.pumpPrep();
        return;
      }
      // One at a time: each player sees who the party already has and picks a different
      // role (in parallel two AIs happily both pick the fighter).
      if (todo.some((k) => this.busy.has(k))) return;
      for (const k of todo.slice(0, 1)) {
        const forUser = k === 'user';
        // The human's character (if they asked for one) is made by the GM's backend.
        const seat = forUser ? { key: 'maker', backend: c.gm?.backend || c.seats[0]?.backend || 'mock' } : this.seatFor(k);
        // Rule systems that roll characteristics (CoC) roll them first; the player builds
        // the character around the numbers.
        c.prep.rolls ??= {};
        const preroll = c.prep.rolls[k] ??= this.R.prerollCharacter?.() || null;
        this.start(k, 'character', async (live) => {
          const brief = forUser ? P.gmBrief(c) : P.playerBrief(c, k);
          const taken = Object.values(c.characters).map((ch) => ch.name);
          const { obj, detail } = await this.callJson(seat, 'character', brief, P.characterTurn(c, k, { forUser, hint: c.userCharHint, preroll }),
            { key: k, label: P.seatLabel(c, k), premise: c.premise, taken });
          if (!live()) return;
          // What the human already chose in the builder stays as they chose it.
          const chosen = forUser ? c.prep.builder?.partial || {} : {};
          if (!obj) {
            this.backends.log?.(k, `character FAIL: ${detail}`);
            c.characters[k] = this.makeCharacter({ name: `${P.seatLabel(c, k)}의 모험가`, concept: '떠돌이 모험가', ...chosen }, k, preroll);
          } else {
            c.characters[k] = this.makeCharacter({ ...obj, ...chosen }, k, preroll);
          }
          const ch = c.characters[k];
          this.post({ type: 'system', from: k, text: `🧾 ${ch.name} — ${ch.concept} (플레이어: ${P.seatLabel(c, k)})` });
        });
      }
      return;
    }
    if (step === 'bonds') {
      // Every AI-played character (and an AI-made character for the human) writes bonds
      // toward the rest of the party.
      const todo = P.playerKeys(c).filter((k) => !c.prep.bonded[k]);
      if (!todo.length) {
        if (this.busy.size) return;
        c.prep.step = 'ready';
        this.changed();
        this.pumpPrep();
        return;
      }
      const max = this.cfg.maxInFlight || 3;
      for (const k of todo) {
        if (this.busy.size >= max) break;
        if (this.busy.has(k)) continue;
        const seat = k === 'user' ? { key: 'maker', backend: c.gm?.backend || c.seats[0]?.backend || 'mock' } : this.seatFor(k);
        this.start(k, 'bonds', async (live) => {
          const others = P.playerKeys(c).filter((x) => x !== k).map((x) => ({ key: x, name: c.characters[x]?.name }));
          const brief = k === 'user' ? P.gmBrief(c) : P.playerBrief(c, k);
          const { obj } = await this.callJson(seat, 'bonds', brief, P.bondsTurn(c, k), { others, class: c.characters[k]?.class });
          if (!live()) return;
          c.prep.bonded[k] = true;
          const ch = c.characters[k];
          const bonds = (Array.isArray(obj?.bonds) ? obj.bonds : []).map((b) => ({ with: this.resolveWho(b?.with) || str(b?.with, 40), text: str(b?.text, 200) })).filter((b) => b.text).slice(0, 4);
          if (!bonds.length) return;
          ch.bonds = bonds;
          this.post({ type: 'system', from: k, text: `🤝 ${ch.name}의 인연\n${bonds.map((b) => `· ${b.text}`).join('\n')}` });
        });
      }
      return;
    }
    if (step === 'ready') {
      if (c.userRole === 'gm') {
        c.phase = 'gm-wait';
        c.prep = null;
        this.system('캐릭터가 모두 준비됐어요. GM(당신)이 첫 장면을 서술해 주세요.');
        this.changed();
        return;
      }
      c.prep.step = 'opening';
      this.pumpPrep();
      return;
    }
    if (step === 'opening') {
      this.start('gm', 'opening', async (live) => {
        const pending = this.ledger().triggered.map((t) => t.id);
        const { obj, detail } = await this.callJson(c.gm, 'opening', P.gmBrief(c), P.openingTurn(c),
          { names: P.playerKeys(c).map((k) => c.characters[k]?.name), scene: c.scene });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'opening', detail);
        if (c.scene.title) this.post({ type: 'scene', from: 'gm', text: `${c.scene.title} — ${c.scene.description}`, title: c.scene.title });
        this.post({ type: 'narration', from: 'gm', text: str(obj.narration, 6000) || '모험이 시작됩니다.' });
        this.applyFoes(obj.foes);
        this.ledger().ack(pending);
        this.applyFacts(obj);
        if (obj.gm_notes) c.gmNotes = str(obj.gm_notes, 6000);
        c.prep = null;
        this.beginRound(this.validKeys(obj.spotlight));
      });
    }
  }

  validKeys(list) {
    const keys = P.playerKeys(this.c);
    const out = (Array.isArray(list) ? list : []).map((x) => this.resolveWho(x)).filter((k) => k && keys.includes(k));
    return out.length ? [...new Set(out)] : null;
  }

  // Character key from a key or a character name.
  resolveWho(x) {
    const c = this.c;
    const s = String(x ?? '').trim().replace(/^\[|\]$/g, '');
    if (!s) return null;
    if (c.characters[s]) return s;
    const lower = s.toLowerCase();
    for (const [k, ch] of Object.entries(c.characters)) {
      const n = ch.name.toLowerCase();
      if (n === lower || n.split(/\s+/)[0] === lower || lower.includes(n)) return k;
    }
    return null;
  }

  inSpotlight(key) {
    const s = this.c.spotlight;
    return !s?.length || s.includes(key);
  }

  beginRound(spotlight) {
    const c = this.c;
    c.round++;
    c.phase = 'declare';
    c.spotlight = spotlight || null;
    c.declared = {};
    c.order = shuffle(c.seats.map((s) => s.key));
    c.resolve = null;
    c.pendingChecks = [];
    // The human may have declared early while the GM was still talking.
    if (c.log.some((m) => m.type === 'declare' && m.from === 'user' && m.round === c.round)) c.declared.user = true;
    if (c.gm) this.runRules();
    if (c.userRole === 'spectator' && this.cfg.autoPauseRounds > 0 && c.roundsSinceUser >= this.cfg.autoPauseRounds) {
      c.paused = true;
      this.system(`${c.roundsSinceUser}라운드 동안 방장이 조용해서 테이블을 잠시 멈췄어요. ▶ 재개로 이어 갑니다.`);
    }
    this.changed();
    this.pump();
  }

  pumpDeclare() {
    const c = this.c;
    const keys = P.playerKeys(c).filter((k) => this.inSpotlight(k));
    const pendingAi = c.order.filter((k) => keys.includes(k) && !c.declared[k]);
    const aiBusy = c.seats.some((s) => this.busy.has(s.key));
    if (pendingAi.length) {
      if (this.cfg.declareMode === 'parallel') {
        const max = this.cfg.maxInFlight || 3;
        for (const k of pendingAi) if (!this.busy.has(k) && this.busy.size < max) this.startDeclare(k);
      } else if (!aiBusy) {
        this.startDeclare(pendingAi[0]);
      }
      return;
    }
    if (aiBusy) return;
    const userTurn = c.userRole === 'player' && keys.includes('user') && !c.declared.user && this.cfg.waitForUser !== false;
    if (userTurn) return; // the UI shows "your turn"
    if (c.userRole === 'gm') {
      c.phase = 'gm-wait';
      this.changed();
      return;
    }
    c.phase = 'resolve';
    c.resolve = { stage: 'adjudicate', results: [] };
    this.changed();
    this.pump();
  }

  startDeclare(k) {
    const c = this.c;
    const round = c.round;
    this.start(k, 'declare', async (live) => {
      const ch = c.characters[k];
      const { obj, detail } = await this.callJson(this.seatFor(k), 'declare', P.playerBrief(c, k), P.declareTurn(c, k),
        { name: ch?.name, concept: ch?.concept, round, scene: c.scene?.title });
      if (!live()) return;
      if (!obj) return this.fail(k, 'declare', detail);
      const note = str(obj.note_add, 500);
      if (note) ch.notes = `${ch.notes ? `${ch.notes}\n` : ''}- ${note}`.slice(-3000);
      const ooc = str(obj.ooc, 300);
      if (ooc) this.post({ type: 'ooc', from: k, text: ooc });
      // Models sometimes quote the line themselves; the log adds its own quotes.
      const say = str(obj.say, 600).replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim(), action = str(obj.action, 800), move = str(obj.move, 40);
      if (obj.pass === true || (!say && !action)) {
        this.post({ type: 'system', from: k, text: `${ch.name}은(는) 이번 라운드를 지켜본다.` });
      } else {
        this.post({ type: 'declare', from: k, say, action, ...(move ? { move } : {}) });
      }
      if (c.phase === 'declare' && c.round === round) c.declared[k] = true;
    });
  }

  pumpResolve() {
    const c = this.c;
    const r = c.resolve;
    if (r.stage === 'adjudicate') {
      this.start('gm', 'adjudicate', async (live) => {
        r.pendingRules = this.ledger().triggered.map((t) => t.id);
        const decls = c.log.filter((m) => m.round === c.round && m.type === 'declare').map((m) => ({ key: m.from, name: P.charName(c, m.from), text: m.action || m.say }));
        const { obj, detail } = await this.callJson(c.gm, 'adjudicate', P.gmBrief(c), P.adjudicateTurn(c),
          { decls, round: c.round, ending: this.ledger().triggered.some((t) => t.ending), characters: c.characters, foes: c.foes });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'adjudicate', detail);
        this.applyFoes(obj.foes);
        this.addClues(obj.clues_add);
        this.applyFacts(obj);
        const checks = this.validChecks(obj.checks);
        if (!checks.length) return this.finishRound(obj);
        const pre = str(obj.narration, 1000);
        if (pre) this.post({ type: 'narration', from: 'gm', text: pre });
        for (const ch of checks) {
          if (ch.who === 'user') c.pendingChecks.push({ id: newId(), label: this.R.checkLabel?.(ch) || '', ...ch });
          else r.results.push(this.rollCheck(ch));
        }
        c.phase = 'roll';
        if (c.pendingChecks.length) this.system(`🎲 ${c.characters.user?.name || c.userName}, 주사위를 굴려 주세요!`);
      });
      return;
    }
    if (r.stage === 'results') {
      this.start('gm', 'results', async (live) => {
        const { obj, detail } = await this.callJson(c.gm, 'results', P.gmBrief(c), P.resultsTurn(c, r.results),
          { results: r.results, round: c.round, ending: this.ledger().triggered.some((t) => t.ending), characters: c.characters, foes: c.foes });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'results', detail);
        this.finishRound(obj);
      });
    }
  }

  // Phase 'roll': wait for the human's rolls and everyone's choices, then go narrate.
  pumpRoll() {
    const c = this.c;
    if (c.pendingChecks.length || c.pendingChoices.length) return;
    c.phase = 'resolve';
    c.resolve.stage = 'results';
    this.changed();
    this.pump();
  }

  // AI players pick their post-roll options. Runs in any phase (a human GM's /check can
  // leave an AI a choice too).
  pumpChoices() {
    const c = this.c;
    for (const p of c.pendingChoices) {
      if (p.who === 'user' || this.busy.has(p.who)) continue;
      const seat = this.seatFor(p.who);
      if (!seat) continue;
      this.start(p.who, 'choose', async (live) => {
        const roll = this.rollById(p.rid);
        const { obj } = await this.callJson(seat, 'choose', P.playerBrief(c, p.who), P.chooseTurn(c, p.who, p, roll),
          { count: p.count, options: p.options });
        if (!live() || !c.pendingChoices.includes(p)) return;
        const picks = Array.isArray(obj?.choices) ? obj.choices : [];
        this.applyChoice(p, picks, str(obj?.reason, 200));
        const note = str(obj?.note_add, 500);
        const ch = c.characters[p.who];
        if (note && ch) ch.notes = `${ch.notes ? `${ch.notes}\n` : ''}- ${note}`.slice(-3000);
      });
    }
  }

  validChecks(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      const who = this.resolveWho(x?.who);
      if (!who || !this.c.characters[who]) continue;
      const check = this.R.normalizeCheck(x, this.c.characters[who]);
      if (!check) continue;
      out.push({ who, why: str(x.why, 120), ...check });
      if (out.length >= 8) break;
    }
    return out;
  }

  rollById(rid) {
    return this.c.resolve?.results.find((r) => r.rid === rid) || this.c.log.find((m) => m.roll?.rid === rid)?.roll || null;
  }

  // Rolls one check, posts it, and queues a choice when the roll grants one.
  rollCheck(check) {
    const c = this.c;
    const sheet = c.characters[check.who];
    const res = this.R.resolveCheck(check, sheet, { characters: c.characters, foes: c.foes });
    const roll = { kind: 'check', rid: newId(), who: check.who, why: check.why, ...res };
    const fu = this.R.followUp(roll, sheet);
    if (fu) {
      roll.pendingChoice = true;
      c.pendingChoices.push({ id: newId(), rid: roll.rid, who: check.who, ...fu });
    }
    this.post({ type: 'roll', from: check.who, roll });
    if (!fu) this.applyRollDamage(roll);
    return roll;
  }

  applyChoice(p, picks, text = '') {
    const c = this.c;
    const valid = [...new Set((picks || []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < p.options.length))];
    const chosen = valid.slice(0, p.count);
    while (chosen.length < p.count) {
      const next = p.options.findIndex((_, i) => !chosen.includes(i));
      if (next < 0) break;
      chosen.push(next);
    }
    const roll = this.rollById(p.rid);
    c.pendingChoices = c.pendingChoices.filter((x) => x !== p);
    if (!roll) return;
    const res = this.R.applyChoice(roll, chosen, c.characters[p.who], { text });
    roll.pendingChoice = false;
    // The posted roll message holds this same roll object; redraw it with the picks.
    const msg = c.log.find((m) => m.roll?.rid === roll.rid);
    if (msg) this.emit('update', msg);
    this.applyRollDamage(roll);
    this.system(`${P.charName(c, p.who)}의 선택: ${(roll.chosen || []).join(' / ')}`, { choice: true, rid: roll.rid });
    // A pushed roll: roll again right away; it joins this round's results.
    if (res?.reroll) {
      const again = this.rollCheck({ who: p.who, ...res.reroll });
      if (c.resolve?.results && c.phase !== 'declare') c.resolve.results.push(again);
    }
    this.changed();
  }

  // A damage-dealing roll hits the foe it named; a roll the character lost (CoC combat)
  // hurts the roller.
  applyRollDamage(roll) {
    const self = roll.selfDamage;
    if (self && !self.applied) {
      self.applied = true;
      this.applyEffects([{ who: roll.who, damage: self.total, ignore_armor: true }]);
    }
    const d = roll.damage;
    if (!d || d.applied) return;
    d.applied = true;
    const foe = this.findFoe(d.target);
    if (!foe || foe.hp === 0) return;
    const dealt = Math.max(0, d.total - (d.ignoreArmor ? 0 : foe.armor || 0));
    const before = foe.hp;
    foe.hp = Math.max(0, foe.hp - dealt);
    d.result = `${foe.name} HP ${before}→${foe.hp}${foe.armor && !d.ignoreArmor ? ` (갑옷 ${foe.armor})` : ''}${foe.hp === 0 ? ', 쓰러짐' : ''}`;
    this.system(`⚔ ${d.result}`, { effect: true });
  }

  findFoe(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    const foes = this.c.foes;
    return foes.find((f) => f.name === n) || foes.find((f) => f.name.includes(n) || n.includes(f.name)) || null;
  }

  applyFoes(list) {
    const c = this.c;
    for (const f of Array.isArray(list) ? list.slice(0, 12) : []) {
      const name = str(f?.name, 60);
      if (!name || name.startsWith('(선택)')) continue;
      const cur = this.findFoe(name);
      if (f.remove === true) {
        if (cur) c.foes = c.foes.filter((x) => x !== cur);
        continue;
      }
      const num = (v, lo, hi, d) => (v === undefined || v === null || v === '' ? d : Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))));
      if (cur) {
        if (f.attack !== undefined) cur.attack = num(f.attack, 1, 99, cur.attack);
        if (f.dodge !== undefined) cur.dodge = num(f.dodge, 1, 99, cur.dodge);
        cur.hp = num(f.hp, 0, 999, cur.hp);
        cur.maxHp = Math.max(cur.maxHp, cur.hp);
        cur.armor = num(f.armor, 0, 10, cur.armor);
        if (str(f.damage)) cur.damage = str(f.damage, 20);
        if (str(f.note)) cur.note = str(f.note, 120);
      } else {
        const hp = num(f.hp, 1, 999, 6);
        const foe = { name, hp, maxHp: hp, armor: num(f.armor, 0, 10, 0), damage: str(f.damage, 20), note: str(f.note, 120) };
        if (f.attack !== undefined) foe.attack = num(f.attack, 1, 99, 40);
        if (f.dodge !== undefined) foe.dodge = num(f.dodge, 1, 99, 20);
        c.foes.push(foe);
      }
    }
    if (c.foes.length > 12) c.foes.splice(0, c.foes.length - 12);
  }

  addClues(list) {
    const c = this.c;
    c.clues ??= [];
    for (const t of strList(list, 6, 200)) {
      if (t.startsWith('(선택)') || c.clues.includes(t)) continue;
      c.clues.push(t);
      this.system(`🔎 단서: ${t}`, { clue: true });
    }
  }

  ledger() {
    this.c.facts ??= {};
    return new Ledger(this.c.facts);
  }

  // The GM's proposed ledger changes and whispers. Refused changes stay in the ledger's
  // `rejected` list; the GM's next prompt shows them with the reason.
  ruleCtx() {
    const c = this.c;
    const players = P.playerKeys(c);
    const validWho = (x) => { const k = this.resolveWho(x) || (players.includes(x) ? x : null); return k && players.includes(k) ? k : null; };
    return { round: c.round, players, validWho };
  }

  // The GM's proposed ledger changes, rules and whispers; then the rules run. Refused
  // changes are kept for the GM's next prompt with the reason.
  applyFacts(obj) {
    const L = this.ledger();
    const ctx = this.ruleCtx();
    const notes = [], refused = [];
    if (obj?.facts) {
      const { applied, rejected, learned } = L.apply(obj.facts, ctx);
      notes.push(...applied);
      refused.push(...rejected);
      this.clueNotices(learned);
    }
    if (obj?.rules) {
      const r = Array.isArray(obj.rules) ? { add: obj.rules } : obj.rules;
      const { added, rejected } = L.setRules({ add: r.add, remove: r.remove });
      notes.push(...added);
      refused.push(...rejected);
    }
    if (obj?.facts || obj?.rules) L.setRejected(refused);
    this.ledgerNote(notes, refused);
    this.runRules();
    for (const w of Array.isArray(obj?.whispers) ? obj.whispers.slice(0, 6) : []) {
      const to = ctx.validWho(w?.to);
      const text = str(w?.text, 1000);
      if (to && text) this.post({ type: 'whisper', from: 'gm', to, text });
    }
  }

  // Fire whatever rules now hold. Each firing is a note for the GM's next turn.
  runRules() {
    const fired = this.ledger().runRules(this.ruleCtx());
    for (const f of fired) {
      this.ledgerNote([`⚡ 규칙 발동: ${f.rule.name}${f.rule.ending ? ' (결말 조건)' : ''}${f.note ? ` — ${f.note}` : ''}`, ...f.applied], f.rejected);
      this.clueNotices(f.learned);
    }
    this.checkCluePaths();
    return fired;
  }

  // A core conclusion the players can no longer reach: tell the GM once (the GM prompt
  // keeps showing it until a new path opens).
  checkCluePaths() {
    const s = this.c.facts;
    s.blockedWarned ??= [];
    const analysis = this.ledger().analyzeClues(P.playerKeys(this.c));
    for (const a of analysis) {
      if (a.blocked && !s.blockedWarned.includes(a.name)) {
        s.blockedWarned.push(a.name);
        this.ledgerNote([`⚠ 결론 "${a.name}"에 이르는 길이 막혔다 (확보 ${a.known}, 열림 ${a.open}, 필요 ${a.need}). 새 단서로 길을 열어야 한다.`]);
      }
      if (!a.blocked) s.blockedWarned = s.blockedWarned.filter((n) => n !== a.name);
    }
  }

  ledgerNote(applied, rejected = []) {
    if (!applied.length && !rejected.length) return;
    const text = [applied.length ? `📒 사실 장부\n${applied.join('\n')}` : '', rejected.length ? `거절됨\n${rejected.map((r) => `${r.op} — ${r.why}`).join('\n')}` : ''].filter(Boolean).join('\n');
    this.post({ type: 'system', from: 'gm', to: 'gm', ledger: true, text });
  }

  // A clue someone just learned: a notice only they (or everyone) can see.
  clueNotices(learned = []) {
    for (const { fact, who } of learned.filter((l) => l.fact.p === '단서')) {
      const text = `🔎 단서: ${fact.args.join(' — ')}`;
      if (who === 'all') this.system(text, { clue: true });
      else for (const k of who) this.system(text, { clue: true, to: k });
    }
  }


  finishRound(obj) {
    const c = this.c;
    this.post({ type: 'narration', from: 'gm', text: str(obj.narration, 6000) || '…' });
    // The rule firings the GM was shown are narrated now.
    if (c.resolve?.pendingRules) this.ledger().ack(c.resolve.pendingRules);
    this.applyEffects(obj.effects);
    this.applyFoes(obj.foes);
    this.addClues(obj.clues_add);
    this.applyFacts(obj);
    if (obj.scene?.title && str(obj.scene.title, 80) !== c.scene.title) {
      c.scene = { title: str(obj.scene.title, 80), description: str(obj.scene.description, 800) };
      this.post({ type: 'scene', from: 'gm', text: `${c.scene.title} — ${c.scene.description}`, title: c.scene.title });
    }
    if (str(obj.summary)) c.summary = str(obj.summary, 3000);
    if (str(obj.gm_notes)) c.gmNotes = str(obj.gm_notes, 6000);
    if (c.userRole === 'spectator') c.roundsSinceUser++;
    if (obj.end === true) {
      c.phase = 'ended';
      c.resolve = null;
      this.system('🏁 이야기가 막을 내렸습니다. 수고하셨어요!');
      this.changed();
      return;
    }
    this.beginRound(this.validKeys(obj.spotlight));
  }

  applyEffects(list) {
    const c = this.c;
    for (const e of Array.isArray(list) ? list.slice(0, 12) : []) {
      const k = this.resolveWho(e?.who);
      const ch = k && c.characters[k];
      if (!ch) continue;
      const bits = [];
      const before = ch.hp;
      let dhp = Math.max(-30, Math.min(30, Math.round(Number(e.hp) || 0)));
      if (e.damage !== undefined && e.damage !== null && e.damage !== '' && e.damage !== 0) {
        const r = typeof e.damage === 'number' ? { total: e.damage, detail: String(e.damage) } : rollDice(String(e.damage));
        if (r) {
          const armor = e.ignore_armor ? 0 : this.R.armor(ch);
          const dmg = Math.max(0, Math.min(50, r.total) - armor);
          dhp -= dmg;
          bits.push(`피해 ${typeof e.damage === 'number' ? e.damage : `${e.damage}=${r.total}`}${armor ? ` -갑옷 ${armor}` : ''}`);
        }
      }
      if (dhp) {
        ch.hp = Math.max(0, Math.min(ch.maxHp, ch.hp + dhp));
        bits.push(`HP ${before}→${ch.hp}`);
      }
      for (const it of strList(e.items_add, 5)) { ch.items.push(it); bits.push(`+${it}`); }
      for (const it of strList(e.items_remove, 5)) {
        const i = ch.items.findIndex((x) => x === it || x.includes(it) || it.includes(x));
        if (i >= 0) { bits.push(`-${ch.items[i]}`); ch.items.splice(i, 1); }
      }
      for (const s of strList(e.conditions_add, 5)) if (!ch.conditions.includes(s)) { ch.conditions.push(s); bits.push(`상태 +${s}`); }
      for (const s of strList(e.conditions_remove, 5)) {
        const i = ch.conditions.indexOf(s);
        if (i >= 0) { ch.conditions.splice(i, 1); bits.push(`상태 -${s}`); }
      }
      bits.push(...this.R.applyEffect(e, ch));
      if (ch.hp < before) bits.push(...(this.R.onDamage?.(ch, before - ch.hp) || []));
      ch.items = ch.items.slice(-15);
      if (bits.length) this.post({ type: 'system', from: k, effect: true, text: `${ch.name}: ${bits.join(' · ')}` });
      if (ch.hp > 0) ch.conditions = ch.conditions.filter((x) => x !== '쓰러짐');
      if (ch.hp === 0 && before > 0) this.down(k);
    }
  }

  // A character dropped to 0 HP. Dungeon World rolls Last Breath right away.
  down(k) {
    const ch = this.c.characters[k];
    if (!ch.conditions.includes('쓰러짐')) ch.conditions.push('쓰러짐');
    const res = this.R.onDown(ch);
    if (res) this.post({ type: 'roll', from: k, roll: { kind: 'check', rid: newId(), who: k, ...res } });
  }

  // -------------------------------------------------------------------------
  // The human at the table

  // mode: 'declare' (in character) | 'ooc' | 'narration' (human GM). Returns an error string or null.
  userPost(mode, text) {
    const c = this.c;
    if (!c) return '캠페인이 없어요';
    text = str(text, 2000);
    if (!text) return '내용이 비었어요';
    c.roundsSinceUser = 0;
    if (text.startsWith('/')) return this.command(text);
    if (mode === 'ooc') {
      this.post({ type: 'ooc', from: 'user', text });
      return null;
    }
    if (c.userRole === 'gm' && (mode === 'narration' || mode === 'declare')) {
      if (c.phase === 'prep') return '캐릭터를 만드는 중이에요';
      this.post({ type: 'narration', from: 'gm', text });
      if (c.phase !== 'ended') this.beginRound(null);
      return null;
    }
    if (c.userRole !== 'player' || !c.characters.user) return '플레이어로 참가하지 않았어요 (잡담만 가능)';
    const { say, action, move } = splitDeclaration(text);
    const round = c.phase === 'declare' ? c.round : c.round + 1;
    this.post({ type: 'declare', from: 'user', say, action, ...(move ? { move } : {}), round });
    if (c.phase === 'declare') c.declared.user = true;
    this.changed();
    this.pump();
    return null;
  }

  userPass() {
    const c = this.c;
    if (c?.phase !== 'declare' || c.userRole !== 'player') return '지금은 넘길 차례가 아니에요';
    c.declared.user = true;
    this.system(`${c.characters.user?.name || c.userName}은(는) 이번 라운드를 지켜본다.`);
    this.changed();
    this.pump();
    return null;
  }

  userRollCheck(id) {
    const c = this.c;
    const i = c?.pendingChecks?.findIndex((p) => p.id === id) ?? -1;
    if (i < 0) return '굴릴 판정이 없어요';
    const [ch] = c.pendingChecks.splice(i, 1);
    c.resolve.results.push(this.rollCheck(ch));
    this.changed();
    this.pump();
    return null;
  }

  userChoose(id, picks, text = '') {
    const c = this.c;
    const p = c?.pendingChoices?.find((x) => x.id === id && x.who === 'user');
    if (!p) return '고를 선택지가 없어요';
    const valid = [...new Set((picks || []).map(Number))].filter((i) => i >= 0 && i < p.options.length);
    if (valid.length !== p.count) return `정확히 ${p.count}개를 골라 주세요`;
    this.applyChoice(p, valid, str(text, 200));
    this.pump();
    return null;
  }

  setPaused(paused) {
    const c = this.c;
    if (!c) return;
    c.paused = !!paused;
    if (!paused) c.error = null;
    this.changed();
    this.pump();
  }

  // Slash commands. Anyone: /r 2d6+1. Human GM: /check, /hp, /dmg, /foe, /scene, /end.
  command(text) {
    const c = this.c;
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    const gmOnly = () => (c.userRole !== 'gm' ? `/${cmd}는 GM만 쓸 수 있어요` : null);
    switch (cmd.toLowerCase()) {
      case 'r': case 'roll': case '굴림': {
        const r = rollDice(arg || (c.rules === 'dw' ? '2d6' : '1d20'));
        if (!r) return '주사위 식을 못 읽었어요 (예: /r 2d6+1, /r 4d6kh3)';
        const who = c.characters.user ? 'user' : 'gm';
        this.post({ type: 'roll', from: who, roll: { kind: 'free', who, ...r } });
        return null;
      }
      case 'check': case '판정': {
        if (gmOnly()) return gmOnly();
        const k = this.resolveWho(rest[0]);
        if (!k) return `캐릭터를 못 찾았어요: ${rest[0] || ''}`;
        const check = this.R.commandCheck(rest.slice(1), c.characters[k]);
        if (typeof check === 'string') return check;
        this.rollCheck({ who: k, why: '', ...check });
        this.changed();
        this.pump();
        return null;
      }
      case 'hp': {
        if (gmOnly()) return gmOnly();
        this.applyEffects([{ who: rest[0], hp: Number(rest[1]) }]);
        this.changed();
        return null;
      }
      case 'dmg': case '피해': {
        if (gmOnly()) return gmOnly();
        if (!this.resolveWho(rest[0])) return `캐릭터를 못 찾았어요: ${rest[0] || ''}`;
        if (!rollDice(rest[1] || '')) return '예: /dmg 카엘 d8';
        this.applyEffects([{ who: rest[0], damage: rest[1], ignore_armor: rest[2] === '관통' }]);
        this.changed();
        return null;
      }
      case 'foe': case '적': {
        if (gmOnly()) return gmOnly();
        const [name, hp, armor, damage] = rest;
        if (!name) return '예: /foe 고블린 6 1 d6  ·  /foe 고블린 제거';
        this.applyFoes([hp === '제거' ? { name, remove: true } : { name, hp, armor, damage }]);
        this.changed();
        return null;
      }
      case 'scene': case '장면': {
        if (gmOnly()) return gmOnly();
        const [title, description = ''] = arg.split('|').map((x) => x.trim());
        c.scene = { title, description };
        this.post({ type: 'scene', from: 'gm', text: `${title} — ${description}`, title });
        this.changed();
        return null;
      }
      case 'end': case '끝': {
        if (gmOnly()) return gmOnly();
        c.phase = 'ended';
        this.system('🏁 이야기가 막을 내렸습니다. 수고하셨어요!');
        this.changed();
        return null;
      }
      default:
        return `모르는 명령이에요: /${cmd}`;
    }
  }
}

// '[상황 파악] "여기서 기다려." 카엘은 문을 살핀다' → move + say + action.
// Text without quotes is all action; a leading [액션] tags the move the player is going for.
export function splitDeclaration(text) {
  let move = '';
  const tag = text.match(/^\s*\[([^\]]{1,30})\]\s*/);
  if (tag) { move = tag[1].trim(); text = text.slice(tag[0].length); }
  const quotes = [...text.matchAll(/["“”「『]([^"“”」』]+)["“”」』]/g)];
  if (!quotes.length) return { say: '', action: text.trim(), move };
  const say = quotes.map((m) => m[1].trim()).join(' ');
  const action = text.replace(/["“”「『][^"“”」』]+["“”」』]/g, ' ').replace(/\s+/g, ' ').trim();
  return { say, action, move };
}
