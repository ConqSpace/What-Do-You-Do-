// The table: a round-based state machine around the GM seat and the player seats. The
// round is the same for every rule system; lib/rules/<id>.mjs decides sheets, checks and
// what a roll means.
//
//   prep     GM designs the world → every player makes a character (the human builds
//            theirs page by page meanwhile, see "Character builder") → (rule-specific
//            extra step, e.g. Dungeon World bonds) → GM opens the first scene
//   declare  the player whose turn it is (c.turn) says something at the table: talk, the
//            character's "speech", an @action, in any mix (lib/post.mjs); the next one hears it.
//            Whatever they say on their turn goes to the GM; talk off their turn doesn't
//   resolve  GM decides the move (takes the one the player named, changes it, picks one, or
//            none) → server rolls → GM narrates how it went and hands the turn to someone
//            who hasn't gone yet (next). A question, or words that are no move, get a short
//            answer and the same player goes on (hold, twice a turn at most). When everyone has
//            gone, a new round starts. The fallen take no turns; with everyone down, the GM
//            gives one closing narration instead (see "Down and out")
//   roll     waiting on players after the rolls: the human rolling their own check, or anyone
//            picking options a roll gave them (Dungeon World 7–9 and the like)
//   gm-wait  (only when the human is the GM) every AI player declared; waiting for the
//            human's narration
//   ended    the GM closed the story
//
// Model calls never block the server: pump() starts whatever the current phase needs and
// every finished call calls pump() again.

import crypto from 'node:crypto';
import { BACKENDS } from './backends.mjs';
import { extractJson, fixJosa, str, strList } from './parse.mjs';
import { splitBeats, splitSpeech } from './beats.mjs';
import { rollDice } from './dice.mjs';
import { RULESETS, rulesetOf } from './rules/index.mjs';
import * as P from './prompts.mjs';
import { Ledger, formatFact, knows } from './facts.mjs';
import { QUICK_FIRE, POINT_BUY, builderInfo } from './builder.mjs';
import { DOWN_MARKS, downOf, factName } from './down.mjs';
import { ARCHETYPES } from '../public/archetypes.js';
import * as T from './talk.mjs';
import { parsePost, partsFromReply, isPost, textOf, hasAct } from './post.mjs';

const PLAYER_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5'];
const SKILLS = ['veteran', 'beginner'];

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
// How fast the page reveals new text; 'off' shows it at once.
const PACES = ['slow', 'normal', 'fast', 'off'];
const newId = () => crypto.randomBytes(4).toString('hex');
// The house rules a campaign plays with: those the rule system offers, as picked (or their default).
function houseOf(rules, picked = {}) {
  return Object.fromEntries((RULESETS[rules].meta().houseRules || []).map((h) => [h.id, picked?.[h.id] === undefined ? !!h.on : !!picked[h.id]]));
}

export class Engine {
  constructor({ backends, store, cfg, emit = () => {} }) {
    this.backends = backends;
    this.store = store;
    this.cfg = cfg;
    this.emit = emit;
    this.busy = new Map(); // seat key → kind of call in flight
    this.sideBusy = new Map(); // table talk in flight (lib/talk.mjs), apart from the turn's calls
    this.gen = 0; // bumps on a new campaign so late replies from the old one are dropped
    this.c = store.load();
    if (this.c) {
      this.c.rules ??= 'd20';
      this.c.foes ??= [];
      this.c.pendingChoices ??= [];
      this.c.clues ??= [];
      this.c.facts ??= {};
      // Saved before turns went one at a time: the round's order had no place for the human.
      this.c.acted ??= {};
      if (this.c.outbox?.length) { this.c.log.push(...this.c.outbox); delete this.c.outbox; }
      this.c.order ??= [];
      if (this.c.userRole === 'player' && this.c.round > 0 && !this.c.order.includes('user')) this.c.order.push('user');
      // Dungeon World's 10+ was once called 강한 성공; tables say 성공.
      for (const m of this.c.log || []) if (m.roll?.label === '강한 성공') m.roll.label = '성공';
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
    const down = downOf(c.characters[key]);
    if (down) return c.pendingChoices?.some((p) => p.who === key) ? 'choosing' : down === 'dead' ? 'dead' : 'down';
    if (c.phase === 'declare') {
      // A human GM's table: everyone declares, then the GM narrates. Otherwise one at a time.
      if (!c.gm) {
        if (c.declared[key]) return 'done';
        if (this.inSpotlight(key)) return 'waiting';
      } else {
        if (c.acted?.[key]) return 'done';
        if (c.turn === key) return 'waiting';
      }
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
      characters[k] = { ...pub, hasNotes: !!notes, sheet: R.sheetView(ch), down: downOf(ch) };
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
        rules: c.rules, rulesLabel: R.label, gmName: R.gmName, house: c.house || {},
        userRole: c.userRole, userName: c.userName, round: c.round,
        scene: c.scene, summary: c.summary, paused: !!c.paused, error: c.error || null,
        spotlight: c.spotlight || null, turn: c.turn || null,
        // A boss's clock is the GM's: the table learns how the fight goes from the narration.
        foes: c.foes.map(({ progress, clock, news, ...f }) => (c.userRole === 'gm' && f.boss ? { ...f, progress, clock } : f)), clues: c.clues || [],
        // What the human's side of the table knows: their character's facts as a player,
        // the public ones otherwise. The whole ledger is behind /api/secrets.
        knownFacts: this.ledger().list.filter((f) => (c.userRole === 'player' ? knows(f, 'user') : f.known === 'all')).map((f) => formatFact(f)),
        // The same facts as data, for the scene tab to say in plain words.
        knownList: this.ledger().list.filter((f) => (c.userRole === 'player' ? knows(f, 'user') : f.known === 'all')).map(({ p, args, value, max }) => ({ p, args, value, max })),
        // Death's two outcomes are written ahead; the table hears only the one picked.
        pendingChecks: c.pendingChecks || [], pendingChoices: (c.pendingChoices || []).map(({ accept, refuse, ...p }) => p),
        wipe: !!c.wipe,
        prepStep: c.prep?.step || null,
        pace: this.pace(),
        chatter: this.talkLevel(),
        gmStyle: c.gmStyle || 'strict',
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
      bosses: this.bosses().map((b) => ({ name: b.name, progress: b.progress, clock: b.clock, phase: P.bossPhase(b), down: !!b.down })),
    };
  }

  logTail(n = 400) { return this.c ? this.c.log.slice(-n) : []; }

  changed() {
    if (!this.c) return;
    this.store.saveSoon(this.c);
    this.emit('state', this.view());
  }

  // Messages go out at once; the page shows them in order at the reader's pace (see the
  // reveal queue in public/app.js), so the models never wait on people reading.
  post(m) {
    const c = this.c;
    const msg = { id: c.nextId++, ts: Date.now(), round: c.round, ...m };
    c.log.push(msg);
    if (c.log.length > 5000) c.log.splice(0, c.log.length - 5000);
    this.emit('msg', msg);
    this.store.saveSoon(c);
    return msg;
  }

  // The AI GM's narration and introductions come a sentence or two at a time, and an NPC's
  // lines (`이름: "대사"`) come from that NPC. A human GM's text is split by speaker only.
  gmSay(m, beats = true) {
    let n = 0;
    const cont = () => (n++ && beats ? { cont: true } : {});
    for (const s of splitSpeech(m.text)) {
      if (s.npc) this.post({ type: 'npc', from: 'gm', name: s.npc, text: s.say, ...cont() });
      else for (const text of beats ? splitBeats(s.text) : [s.text]) this.post({ ...m, text, ...cont() });
    }
  }

  // How fast the page reveals new text (the campaign's choice, or config.readPace).
  pace() {
    const p = this.c?.pace || this.cfg.readPace;
    return PACES.includes(p) ? p : 'normal';
  }

  setPace(p) {
    if (!this.c) return '캠페인이 없어요';
    if (!PACES.includes(p)) return '모르는 속도예요';
    this.c.pace = p;
    this.changed();
    return null;
  }

  system(text, extra = {}) { return this.post({ type: 'system', from: 'system', text, ...extra }); }

  // -------------------------------------------------------------------------
  // Campaign setup

  // opts: {rules: 'd20'|'dw', premise, tone, userRole: 'player'|'spectator'|'gm', userName,
  //        title, opening (the first scene to start in), length: 'short'|'long' (from a story card),
  //        front, questions, openingAsk (a Dungeon World story's front, stakes questions, and
  //        the question the GM asks first),
  //        gm: backend, players: [backend...], skills: ['veteran'|'beginner' …] (per AI seat),
  //        userChar: {...} | {hint} | null}
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
    this.sideBusy.clear();
    this.gen++;
    const c = this.c = {
      version: 2,
      id: `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt: Date.now(),
      rules: RULESETS[opts.rules] ? opts.rules : 'd20',
      house: houseOf(RULESETS[opts.rules] ? opts.rules : 'd20', opts.house),
      // The AI GM's temper: 'strict' (minds the fiction, asks before rolling less than was said)
      // or 'easy' (lets the players have it). See GM_STYLES in lib/prompts.mjs.
      gmStyle: P.GM_STYLES.includes(opts.gmStyle) ? opts.gmStyle : 'strict',
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
      // Names the last few tables used: the AI players are asked to pick others.
      avoidNames: (this.store.recentNames?.() || []).slice(0, 16),
      // What only the GM is told (a custom story's twist, a boss's secret …).
      gmOnly: str(opts.gmOnly, 1500),
      userRole,
      userName: str(opts.userName, 30) || this.cfg.userName || '방장',
      gm: userRole === 'gm' ? null : { key: 'gm', backend: pickBackend(opts.gm), model: this.cfg.gmModel?.[pickBackend(opts.gm)] },
      // How well each AI player knows the rules: a veteran names moves, a beginner says what
      // the character does and leaves the move to the GM. Alternating unless given.
      seats: players.map((b, i) => ({ key: PLAYER_KEYS[i], backend: pickBackend(b), skill: SKILLS.includes(opts.skills?.[i]) ? opts.skills[i] : i % 2 ? 'beginner' : 'veteran' })),
      window: this.cfg.historyWindow || 40,
      phase: 'prep',
      prep: { step: userRole === 'gm' ? 'chars' : 'world', bonded: {}, rolls: {} },
      round: 0,
      scene: { title: '', description: '' },
      pitch: '', characterHint: '', summary: '', gmNotes: '',
      characters: {},
      foes: [], clues: [], facts: {},
      declared: {}, acted: {}, order: [], turn: null, spotlight: null,
      turnNo: 0, // turns resolved so far: table talk is rate-limited by turn
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
    // Every open page starts its log over, however the campaign was started (message ids
    // start from 1 again).
    this.emit('campaign', { id: c.id });
    this.system(`새 캠페인을 준비합니다 (${this.R.label}). ${c.premise ? `전제: ${c.premise}` : '전제는 GM이 정합니다.'}`, { setup: true });
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
      if (c.phase === 'declare') c.declared[key] = c.acted[key] = true;
    }
    this.backends.log?.(key, `FAIL ${kind}: ${detail}`);
  }

  // -------------------------------------------------------------------------
  // The pump

  pump() {
    const c = this.c;
    if (!c || c.paused) return;
    this.pumpChoices();
    // Death's offer, and the answer to it, come before anyone else moves.
    if (this.pumpBargain()) return;
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
        this.gmSay({ type: 'system', from: 'gm', text: `📜 ${c.title}\n\n${c.pitch}` });
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
          const { obj, detail } = await this.callJson(seat, 'character', brief, P.characterTurn(c, k, { forUser, hint: c.userCharHint, preroll, nameIdeas: this.nameIdeas(taken) }),
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
          const names = others.map((o) => o.name);
          const bonds = (Array.isArray(obj?.bonds) ? obj.bonds : []).map((b) => ({ with: this.resolveWho(b?.with) || str(b?.with, 40), text: fixJosa(str(b?.text, 200), names) })).filter((b) => b.text).slice(0, 4);
          if (!bonds.length) return;
          ch.bonds = bonds;
          this.post({ type: 'system', from: k, bonds: true, text: `🤝 ${ch.name}의 인연\n${bonds.map((b) => `· ${b.text}`).join('\n')}` });
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
        const narration = str(obj.narration, 6000) || '모험이 시작됩니다.';
        this.gmSay({ type: 'narration', from: 'gm', text: narration });
        this.applyFoes(obj.foes);
        this.ledger().ack(pending);
        this.applyFacts(obj);
        if (obj.gm_notes) c.gmNotes = str(obj.gm_notes, 6000);
        c.prep = null;
        this.beginRound(this.validKeys(obj.spotlight));
      });
    }
  }

  // A few names to pick from: the Dungeon World classes' name lists (짧은 것만), minus the
  // party's and the recent tables'. Other rule systems have no list.
  nameIdeas(taken = [], n = 6) {
    if (this.c.rules !== 'dw') return [];
    const skip = new Set([...taken, ...(this.c.avoidNames || [])]);
    const pool = [...new Set(builderInfo('dw').classes.flatMap((cl) => cl.names || []))].filter((x) => x.length <= 4 && !skip.has(x));
    for (let i = pool.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, n);
  }

  validKeys(list) {
    const keys = P.playerKeys(this.c);
    const out = (Array.isArray(list) ? list : []).map((x) => this.resolveWho(x)).filter((k) => k && keys.includes(k));
    return out.length ? [...new Set(out)] : null;
  }

  // Checks the ledger's positions rule out: a move that needs its target close (방어, 접근전 …)
  // with the two in different places. A position the ledger doesn't know stops nothing.
  outOfReach(checks) {
    const reach = this.R.reach || [];
    const L = this.ledger();
    const where = (name) => L.list.find((f) => f.p === '위치' && f.args[0] === name)?.args[1] || null;
    const out = [];
    for (const ch of checks) {
      if (!reach.includes(ch.move) || !ch.target) continue;
      const me = P.charName(this.c, ch.who);
      const key = this.resolveWho(ch.target);
      const them = key ? P.charName(this.c, key) : this.findFoe(ch.target)?.name || ch.target;
      const a = where(me), b = where(them);
      if (a && b && a !== b) out.push(`${me}의 ${ch.move} (대상 ${them}): ${me}은(는) ${a}, ${them}은(는) ${b}에 있다. ${ch.move}은(는) 대상과 같은 곳에서만 할 수 있다.`);
    }
    return out;
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
    // Nobody down takes a turn; a spotlight on only the fallen falls back to everyone.
    spotlight = spotlight?.filter((k) => this.canAct(k));
    c.spotlight = spotlight?.length ? spotlight : null;
    c.declared = {}; // declared this round
    c.acted = {}; // their turn is over (resolved or passed)
    c.resolved = 0; // turns the GM resolved this round
    c.turn = null; // whose turn it is (an AI GM's table)
    // Who acts this round, in order: the spotlight as the GM listed it, or everyone with
    // the first seat moving round by round. The GM may hand the turn to anyone left (next).
    const keys = P.playerKeys(c);
    const s = (c.round - 1) % Math.max(1, keys.length);
    c.order = c.spotlight || [...keys.slice(s), ...keys.slice(0, s)].filter((k) => this.canAct(k));
    c.resolve = null;
    c.pendingChecks = [];
    // A human GM's round is one turn to table talk (an AI GM's turns are counted in endTurn).
    if (!c.gm) c.turnNo = (c.turnNo || 0) + 1;
    c.holds = {}; // short answers that kept a turn (holdTurn)
    c.offered = {}; // checks the GM asked about before rolling (offerChange)
    c.asks = {};
    // The human may have acted early while the GM was still talking.
    if (c.log.some((m) => m.from === 'user' && m.round === c.round && (m.type === 'declare' || (m.type === 'player' && m.toGm)))) c.declared.user = true;
    if (c.gm) this.runRules();
    if (c.userRole === 'spectator' && this.cfg.autoPauseRounds > 0 && c.roundsSinceUser >= this.cfg.autoPauseRounds) {
      c.paused = true;
      this.system(`${c.roundsSinceUser}라운드 동안 방장이 조용해서 테이블을 잠시 멈췄어요. ▶ 재개로 이어 갑니다.`);
    }
    this.changed();
    this.pump();
  }

  // One at a time, the way a Dungeon World table goes: the GM turns to a player, they say
  // what they do, it is rolled and narrated, and the GM turns to the next. Each one sees
  // what came of the last.
  pumpDeclare() {
    const c = this.c;
    if (!c.gm) return this.pumpDeclareAll();
    // Everyone is down: the GM closes the story instead of handing out turns.
    this.checkWipe();
    if (c.wipe) {
      c.phase = 'resolve';
      c.resolve = { stage: 'wipe', who: null, results: [] };
      this.changed();
      this.pump();
      return;
    }
    const prev = c.turn;
    if (!c.turn || c.acted[c.turn] || !this.canAct(c.turn)) c.turn = this.nextActor();
    const k = c.turn;
    if (k !== prev) this.changed();
    if (!k) return this.endRound();
    if (c.declared[k]) {
      c.phase = 'resolve';
      c.resolve = { stage: 'adjudicate', who: k, results: [] };
      this.changed();
      this.pump();
      return;
    }
    if (k === 'user') {
      if (this.cfg.waitForUser !== false) return; // the UI shows "your turn"
      c.acted.user = true;
      return this.pumpDeclare();
    }
    if (!this.busy.has(k)) this.startDeclare(k);
  }

  // Whoever is left this round; the human goes next if they already spoke up.
  nextActor() {
    const c = this.c;
    const left = c.order.filter((k) => !c.acted[k] && this.canAct(k));
    return left.find((k) => k === 'user' && c.declared.user) || left[0] || null;
  }

  // Down (unconscious) or dead characters take no turns.
  canAct(k) { return !downOf(this.c.characters[k]); }

  // Everyone has had their turn. If nobody did anything, the GM moves the story on first.
  endRound() {
    const c = this.c;
    if (!c.resolved) {
      c.phase = 'resolve';
      c.resolve = { stage: 'adjudicate', who: null, results: [] };
      this.changed();
      this.pump();
      return;
    }
    if (c.userRole === 'spectator') c.roundsSinceUser++;
    const spot = c.nextSpotlight || null;
    c.nextSpotlight = null;
    this.beginRound(spot);
  }

  // A human GM's table: the AI players declare one after another, then the GM narrates.
  pumpDeclareAll() {
    const c = this.c;
    const pending = c.order.filter((k) => k !== 'user' && !c.declared[k] && this.canAct(k));
    const aiBusy = c.seats.some((s) => this.busy.has(s.key));
    if (pending.length) {
      if (this.cfg.declareMode === 'parallel') {
        const max = this.cfg.maxInFlight || 3;
        for (const k of pending) if (!this.busy.has(k) && this.busy.size < max) this.startDeclare(k);
      } else if (!aiBusy) {
        this.startDeclare(pending[0]);
      }
      return;
    }
    if (aiBusy) return;
    c.phase = 'gm-wait';
    this.changed();
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
      // Talk, speech and one action, in the player's format (lib/post.mjs). A beginner names
      // no move; whatever a veteran names, in the move field or in their talk, is kept.
      const { parts, ask } = partsFromReply(obj);
      const pass = obj.pass === true || !parts.length;
      if (pass) {
        this.post({ type: 'system', from: k, text: `${ch.name}은(는) 이번 라운드를 지켜본다.` });
      } else {
        const move = this.namedMove({ parts, move: str(obj.move, 40) }, ch);
        const msg = this.post({ type: 'player', from: k, parts, ...(move ? { move } : {}), ...(ask ? { ask: true } : {}), toGm: true });
        this.boldEvent(k, msg);
      }
      if (c.phase === 'declare' && c.round === round) {
        c.declared[k] = true;
        if (pass) c.acted[k] = true;
      }
    });
  }

  pumpResolve() {
    const c = this.c;
    const r = c.resolve;
    if (r.stage === 'adjudicate') {
      this.start('gm', 'adjudicate', async (live) => {
        r.pendingRules = this.ledger().triggered.map((t) => t.id);
        r.seen = c.nextId - 1; // what the GM was shown; anything said after waits for the next call
        const decls = this.turnPosts(r.who).map((m) => ({ key: m.from, name: P.charName(c, m.from), text: [textOf(m, 'talk'), textOf(m, 'say') && `"${textOf(m, 'say')}"`, textOf(m, 'act') && `@${textOf(m, 'act')}`].filter(Boolean).join(' '), ask: !!m.ask || /\?\s*$/.test(textOf(m, 'talk')) }));
        const ctx = { decls, round: c.round, ending: this.ledger().triggered.some((t) => t.ending), characters: c.characters, foes: c.foes };
        const brief = P.gmBrief(c), turn = P.adjudicateTurn(c);
        let { obj, detail } = await this.callJson(c.gm, 'adjudicate', brief, turn, ctx);
        if (!live()) return;
        if (!obj) return this.fail('gm', 'adjudicate', detail);
        let checks = this.validChecks(obj.checks);
        // A move that needs its target close (defend, melee) from where the character isn't,
        // by the ledger's positions: the GM answers once more, told why. If it insists, it goes.
        // A strict GM only: an easy one fills small gaps in position with narration.
        const out = c.gmStyle === 'easy' ? [] : this.outOfReach(checks);
        if (out.length) {
          this.post({ type: 'system', from: 'gm', to: 'gm', text: `⛔ 위치 때문에 받지 않은 판정\n${out.join('\n')}` });
          const again = await this.callJson(c.gm, 'adjudicate', brief, P.reachRetry(turn, out), ctx);
          if (!live()) return;
          if (again.obj) { obj = again.obj; checks = this.validChecks(obj.checks); }
        }
        // No roll: a short answer that keeps the turn, or the turn's result (applied once by endTurn).
        if (!checks.length && obj.hold === true && r.who && (c.holds?.[r.who] || 0) < 2) return this.holdTurn(obj);
        if (!checks.length) return this.endTurn(obj);
        // The GM changed the move the player named, or put less to the dice than they said: at
        // a table the GM says so before the roll ("이건 접근전인데요? 근력으로 굴리게 됩니다.
        // 하실 건가요?") and the player takes it or not. Rolling first and cutting the story
        // down after is what starts fights.
        const ask = c.gmStyle !== 'easy' && (c.asks?.[r.who] || 0) < P.MAX_ASKS && (this.moveChange(checks, r) || this.trimmedCheck(checks, r));
        if (ask) return this.offerChange(obj, ask);
        this.markChecks(checks, r);
        this.applyFoes(obj.foes);
        this.addClues(obj.clues_add);
        this.applyFacts(obj);
        // No narration before the roll: it only retold the declaration. The dice speak next.
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
        this.endTurn(obj);
      });
    }
    if (r.stage === 'wipe') {
      this.start('gm', 'wipe', async (live) => {
        const { obj, detail } = await this.callJson(c.gm, 'wipe', P.gmBrief(c), P.wipeTurn(c), { round: c.round, characters: c.characters });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'wipe', detail);
        this.endTurn(obj);
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
      if (p.who === 'user' || this.busy.has(p.who) || p.priced === false) continue;
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

  // The move a declaration goes for, as the rule system names it ("" if it names none).
  moveName(text, ch) {
    if (!text || !this.R.moveName) return text || '';
    return this.R.moveName(text, ch) || '';
  }

  // The move a player named: a move chip ([방어]), a veteran's move field, or in their own
  // words ("지식 굴림 할게요").
  namedMove(m, ch) {
    return this.moveName(m.move, ch) || this.R.moveIn?.(textOf(m, 'talk'), ch) || '';
  }

  // What this player said for the GM on their turn that the GM hasn't answered yet.
  turnPosts(who) {
    const c = this.c;
    const after = c.heard?.[who] ?? 0;
    return c.log.filter((m) => m.from === who && m.round === c.round && m.id > after && !m.chat && (m.type === 'declare' || (m.type === 'player' && m.toGm)));
  }

  // This round's messages from a player: what the GM's checks go on.
  roundPosts(who) {
    const c = this.c;
    return c.log.filter((m) => m.from === who && m.round === c.round && isPost(m) && !m.chat);
  }

  // A check on the player whose turn it is, as another move than the one they named; null if
  // none, or if the GM already asked about this one and the player went on.
  moveChange(checks, r) {
    const c = this.c;
    const ck = checks.find((x) => x.who === r.who);
    // The move named on the message the check goes on: the latest action ("네, 할게요" after
    // the GM's question is no new action).
    const posts = this.roundPosts(r.who).filter((m) => m.toGm || m.type === 'declare');
    const named = (posts.filter(hasAct).at(-1) || posts.at(-1))?.move;
    const move = ck && (ck.move || ck.skill || ck.stat);
    if (!named || !move || move === named || c.offered?.[r.who] === move) return null;
    return { who: r.who, named, move, check: ck };
  }

  // A check the GM marked trimmed, for the player whose turn it is, not asked about yet.
  trimmedCheck(checks, r) {
    const ck = checks.find((x) => x.who === r.who && x.trimmed);
    const move = ck && (ck.move || ck.skill || ck.stat);
    if (!move || this.c.offered?.[r.who] === move) return null;
    return { who: r.who, move, check: ck };
  }

  // The GM's question goes out instead of the roll and the turn stays: the player takes the
  // roll as offered ("네, 할게요") or does something else. The same move isn't asked twice.
  offerChange(obj, { who, named, move, check }) {
    const c = this.c;
    const mod = check.stat ? c.characters[who]?.stats?.[check.stat] : undefined;
    const how = check.stat && check.stat !== move ? `${check.stat}${Number.isFinite(mod) ? `(${mod >= 0 ? '+' : ''}${mod})` : ''} 판정이 됩니다` : '판정이 됩니다';
    const batchim = (w) => { const k = w.charCodeAt(w.length - 1) - 0xac00; return k >= 0 && k < 11172 && k % 28 !== 0; };
    const fallback = named
      ? `${fixJosa(`${named}이`, [named])} 아니라 ${move}${batchim(move) ? '이에요' : '예요'}. ${how}.`
      : `${check.stake ? `이번 판정에 걸린 건 여기까지예요: ${check.stake.replace(/[.。]\s*$/, '')}. ` : ''}${move}, ${how}.`;
    const text = str(obj.confirm, 400) || str(obj.ask_change, 400) || `${fallback} 그래도 하시겠어요?`;
    (c.offered ??= {})[who] = move;
    (c.asks ??= {})[who] = (c.asks[who] || 0) + 1;
    return this.holdTurn({ narration: text }, { ask: true });
  }

  // The GM put these checks to messages: each roll goes under the message it answers, and the
  // message shows the move (and the one the player named, when the GM changed it).
  markChecks(checks, r) {
    const c = this.c;
    for (const ch of checks) {
      const posts = this.roundPosts(ch.who).filter((m) => ch.who !== r.who || m.toGm || m.type === 'declare');
      const m = posts.filter(hasAct).at(-1) || posts.at(-1);
      if (!m) continue;
      // The card goes under the last thing they said: after a question about the move and their
      // "네, 할게요", not above it.
      ch.of = posts.at(-1).id;
      if (m.check) continue; // a second check on the same message just rolls under it
      const move = ch.move || ch.skill || ch.stat || '';
      m.check = { move, ...(m.move && move && m.move !== move ? { was: m.move } : {}), ...(ch.stake ? { stake: ch.stake } : {}) };
      this.emit('update', m);
    }
  }

  // A question, or words that are no move: the GM answers in a sentence or two (or lets it
  // pass) and the same player goes on. Anything they said meanwhile is up next.
  holdTurn(obj, { ask = false } = {}) {
    const c = this.c;
    const r = c.resolve;
    const who = r.who;
    const narration = str(obj.narration, 2000);
    if (narration) this.gmSay({ type: 'narration', from: 'gm', text: narration });
    this.applyFoes(obj.foes);
    this.applyFacts(obj);
    if (str(obj.gm_notes)) c.gmNotes = str(obj.gm_notes, 6000);
    // A question before a roll has its own count (offerChange), so it is never skipped.
    if (!ask) (c.holds ??= {})[who] = (c.holds[who] || 0) + 1;
    (c.heard ??= {})[who] = r.seen;
    c.resolve = null;
    c.phase = 'declare';
    c.declared[who] = this.turnPosts(who).length > 0;
    this.changed();
    this.pump();
  }

  // Going at it on a sliver of HP, or straight at the boss: worth a word from the table.
  boldEvent(k, msg) {
    const say = textOf(msg, 'say'), action = textOf(msg, 'act');
    const ev = T.declareEvent(this.c.characters[k], { say, action }, this.bosses());
    if (ev) this.react({ ...ev, say, action }, msg.id);
  }

  validChecks(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      const who = this.resolveWho(x?.who);
      // The dead roll nothing. The unconscious may still be asked (CoC's CON roll to hang on).
      if (!who || !this.c.characters[who] || downOf(this.c.characters[who]) === 'dead') continue;
      const check = this.R.normalizeCheck(x, this.c.characters[who]);
      if (!check) continue;
      // A check aimed at a boss (named in against, or the boss as a damage move's target)
      // moves the boss's hidden clock instead of hurting it.
      const boss = this.livingBoss(x.against) || this.livingBoss(check.target);
      // stake: what a hit gets (and doesn't), told before the roll. trimmed: the GM put less to
      // the dice than the player said (one of two actions, the intent of a result, a first step).
      const stake = str(x.stake, 140), trimmed = x.trimmed === true;
      out.push({ who, why: str(x.why, 40), ...check, ...(boss ? { against: boss.name } : {}), ...(stake ? { stake } : {}), ...(trimmed ? { trimmed } : {}) });
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
    const res = this.R.resolveCheck(check, sheet, { characters: c.characters, foes: c.foes, house: c.house || {} });
    const roll = { kind: 'check', rid: newId(), who: check.who, why: check.why, ...res, ...(check.stake ? { stake: check.stake } : {}) };
    // Bosses have no HP to roll damage against: the roll moves their clock instead.
    if (check.against) delete roll.damage;
    const fu = this.R.followUp(roll, sheet);
    if (fu) {
      roll.pendingChoice = true;
      c.pendingChoices.push({ id: newId(), rid: roll.rid, who: check.who, ...fu });
    }
    const msg = this.post({ type: 'roll', from: check.who, roll, ...(check.of ? { of: check.of } : {}) });
    this.onRoll(roll, msg.id);
    if (!fu) this.applyRollDamage(roll);
    this.advanceBoss(check.against, roll);
    return roll;
  }

  // -------------------------------------------------------------------------
  // Bosses: no HP, a hidden progress clock the server keeps. Only rolls aimed at the boss
  // fill it (10+ two segments, 7–9 one, a 풀다이스 three). The GM decides how the fight
  // looks; the server decides when it turns (a new phase at 3/8 and 6/8) and when it ends.

  bosses() { return (this.c?.foes || []).filter((f) => f.boss); }
  livingBoss(name) {
    const f = this.findFoe(name);
    return f?.boss && !f.down ? f : null;
  }

  advanceBoss(name, roll) {
    const c = this.c;
    const boss = this.livingBoss(name);
    if (!boss) {
      // Rolls go by without touching a boss that is still standing: the GM may be forgetting
      // to aim them (see the GM's boss block).
      if (this.bosses().some((f) => !f.down)) c.bossDry = (c.bossDry || 0) + 1;
      return;
    }
    c.bossDry = 0;
    const ticks = { crit: 3, good: 2, mixed: 1 }[roll.house === 'crit' ? 'crit' : roll.tier] || 0;
    const phase = P.bossPhase(boss);
    boss.progress = Math.min(boss.clock, boss.progress + ticks);
    if (boss.progress >= boss.clock) boss.news = 'down';
    else if (P.bossPhase(boss) > phase) boss.news = 'phase';
  }

  // After the GM's narration: a boss whose clock filled is down (a fact rules can end on).
  settleBosses() {
    for (const b of this.bosses()) {
      if (b.news === 'down' && !b.down) { b.down = true; this.foeDown(b); }
      b.news = null;
    }
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
    // Death's deal reads as the price the GM named.
    if (p.bargain) roll.chosen = [p.options[chosen[0]]];
    roll.pendingChoice = false;
    // The posted roll message holds this same roll object; redraw it with the picks.
    const msg = c.log.find((m) => m.roll?.rid === roll.rid);
    if (msg) this.emit('update', msg);
    this.applyRollDamage(roll);
    this.system(`${P.charName(c, p.who)}의 선택: ${(roll.chosen || []).join(' / ')}`, { choice: true, rid: roll.rid });
    if (p.bargain) this.settleBargain(p, res?.bargain === 'accept');
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
    if (!foe || foe.boss || foe.hp === 0) return;
    const dealt = Math.max(0, d.total - (d.ignoreArmor ? 0 : foe.armor || 0));
    const before = foe.hp;
    foe.hp = Math.max(0, foe.hp - dealt);
    d.result = `${foe.name} HP ${before}→${foe.hp}${foe.armor && !d.ignoreArmor ? ` (갑옷 ${foe.armor})` : ''}${foe.hp === 0 ? ', 쓰러짐' : ''}`;
    this.system(`⚔ ${d.result}`, { effect: true });
    if (foe.hp === 0) this.foeDown(foe);
  }

  // A fallen foe is a fact, so rules can end the story on it: 상태(보스, 쓰러짐).
  foeDown(foe) {
    this.applyFacts({ facts: { assert: [{ fact: `상태(${foe.name.replace(/[(),]/g, ' ')}, 쓰러짐)`, to: 'all' }] } });
  }

  // A boss falls only when its clock fills: a fact saying it fell (사망(보스), 상태(보스,
  // 쓰러짐) …) is refused until then, whether the GM asserts it or a rule does.
  bossVeto(f) {
    const b = this.livingBoss(f.args[0]);
    if (!b || b.name !== f.args[0]) return null;
    const fell = f.p === '사망' || (f.p === '상태' && /쓰러|죽|패배|파괴|소멸|잠들|무너/.test(f.args[1] || ''));
    return fell ? `${b.name}은(는) 보스다. 진행 시계가 다 차야 쓰러진다` : null;
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
      const num = (v, lo, hi, d) => (v === undefined || v === null || v === '' ? d : Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))));
      // A boss keeps its clock: the GM can describe it anew, never move or remove it by hand.
      if (cur?.boss || (!cur && f.boss === true)) {
        // Its clock filled this turn and the GM clears it away in the same reply: it fell.
        if (cur && f.remove === true && cur.news === 'down' && !cur.down) { cur.down = true; cur.news = null; this.foeDown(cur); }
        if (cur && f.remove === true && !cur.down) {
          this.post({ type: 'system', from: 'gm', to: 'gm', text: `⚠ ${cur.name}은(는) 보스라 진행 시계가 다 차기 전에는 치울 수 없다.` });
          continue;
        }
        if (cur && f.remove === true) { c.foes = c.foes.filter((x) => x !== cur); continue; }
        if (cur) {
          if (str(f.damage)) cur.damage = str(f.damage, 20);
          if (str(f.note)) cur.note = str(f.note, 120);
        } else {
          // The clock is sized to the party (four segments a player, 8 to 24), not by the GM.
          const clock = Math.max(8, Math.min(24, 4 * P.playerKeys(c).length));
          c.foes.push({ name, boss: true, clock, progress: 0, damage: str(f.damage, 20), note: str(f.note, 120) });
        }
        continue;
      }
      if (f.remove === true) {
        if (cur) c.foes = c.foes.filter((x) => x !== cur);
        continue;
      }
      if (cur) {
        if (f.attack !== undefined) cur.attack = num(f.attack, 1, 99, cur.attack);
        if (f.dodge !== undefined) cur.dodge = num(f.dodge, 1, 99, cur.dodge);
        const was = cur.hp;
        cur.hp = num(f.hp, 0, 999, cur.hp);
        if (was > 0 && cur.hp === 0) this.foeDown(cur);
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
    return { round: c.round, players, validWho, veto: (f) => this.bossVeto(f) };
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
    this.syncDown(); // the GM may have written a death into the ledger
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
    if (fired.length) this.syncDown();
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


  // The GM narrated how one player's turn came out. Hand the turn on, or end the round.
  endTurn(obj) {
    const c = this.c;
    const who = c.resolve?.who;
    // An ending the rules called for (the GM was told this turn) may close the story, and
    // so does the closing narration after a wipe, whatever still stands.
    const endingCalled = this.ledger().triggered.some((t) => t.ending);
    const closing = c.resolve?.stage === 'wipe';
    const narration = str(obj.narration, 6000) || '…';
    this.gmSay({ type: 'narration', from: 'gm', text: narration });
    // The rule firings the GM was shown are narrated now.
    if (c.resolve?.pendingRules) this.ledger().ack(c.resolve.pendingRules);
    const hurt = this.applyEffects(obj.effects);
    this.onHurt(c.resolve?.results || [], hurt);
    this.applyFoes(obj.foes);
    this.addClues(obj.clues_add);
    this.applyFacts(obj);
    if (obj.scene?.title && str(obj.scene.title, 80) !== c.scene.title) {
      c.scene = { title: str(obj.scene.title, 80), description: str(obj.scene.description, 800) };
      this.post({ type: 'scene', from: 'gm', text: `${c.scene.title} — ${c.scene.description}`, title: c.scene.title });
    }
    if (str(obj.summary)) c.summary = str(obj.summary, 3000);
    if (str(obj.gm_notes)) c.gmNotes = str(obj.gm_notes, 6000);
    this.settleBosses();
    const move = str(obj.master_move, 40);
    if (move) c.masterMoves = [...(c.masterMoves || []), move].slice(-4);
    // who: null when nobody acted (or a round resolved all at once in an older save).
    if (who) {
      c.acted[who] = true;
      (c.heard ??= {})[who] = c.resolve?.seen ?? c.nextId - 1;
      if (c.holds) c.holds[who] = 0;
      if (c.offered) delete c.offered[who];
      if (c.asks) c.asks[who] = 0;
    }
    else for (const k of Object.keys(c.declared)) c.acted[k] = true;
    c.resolved = (c.resolved || 0) + 1;
    c.turnNo = (c.turnNo || 0) + 1;
    c.resolve = null;
    c.pendingChecks = [];
    // The story doesn't end on the GM's word while a boss still stands, unless an ending
    // rule called for it (the party lost, the mountain fell …).
    const standing = this.bosses().filter((b) => !b.down);
    if (closing) return this.endStory();
    if (obj.end === true && standing.length && !endingCalled && !this.ledger().triggered.some((t) => t.ending)) {
      this.post({ type: 'system', from: 'gm', to: 'gm', text: `⚠ ${standing.map((b) => b.name).join(', ')}이(가) 아직 쓰러지지 않아 이야기를 끝낼 수 없다. 진행 시계가 다 차야 쓰러진다.` });
    } else if (obj.end === true) {
      return this.endStory();
    }
    const left = c.order.filter((k) => !c.acted[k] && this.canAct(k));
    if (!left.length) {
      c.nextSpotlight = this.validKeys(obj.spotlight);
      return this.endRound();
    }
    const next = this.resolveWho(obj.next);
    c.turn = left.includes(next) ? next : null;
    c.phase = 'declare';
    this.changed();
    this.pump();
  }

  // One GM reply's effects are posted as one line ("그레타: HP 25→21 · 에다: 다음 판정 +1"),
  // not a line per character.
  // Returns who lost HP: [{ key, before, after }].
  applyEffects(list) {
    const c = this.c;
    const lines = [];
    const hurt = [];
    const flush = () => { if (lines.length) this.post({ type: 'system', from: 'gm', effect: true, text: lines.splice(0).join('  ·  ') }); };
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
      if (ch.hp < before) {
        bits.push(...(this.R.onDamage?.(ch, before - ch.hp) || []));
        hurt.push({ key: k, before, after: ch.hp });
      }
      ch.items = ch.items.slice(-15);
      if (bits.length) lines.push(`${ch.name}: ${bits.join(', ')}`);
      // Healed above 0: they come to. A death stays.
      if (ch.hp > 0 && ch.hp > before) ch.conditions = ch.conditions.filter((x) => !DOWN_MARKS.includes(x));
      if (ch.hp === 0 && before > 0 && !ch.conditions.includes('사망')) { flush(); this.down(k); }
    }
    flush();
    this.syncDown();
    return hurt;
  }

  // A character dropped to 0 HP. Dungeon World rolls Last Breath right away; its 7–9 opens
  // Death's bargain, which the GM prices before the player answers (pumpBargain).
  down(k) {
    const c = this.c;
    const ch = c.characters[k];
    if (!ch.conditions.includes('쓰러짐')) ch.conditions.push('쓰러짐');
    const res = this.R.onDown(ch);
    if (!res) return;
    const roll = { kind: 'check', rid: newId(), who: k, ...res };
    const fu = this.R.followUp(roll, ch);
    let p = null;
    if (fu) {
      roll.pendingChoice = true;
      p = { id: newId(), rid: roll.rid, who: k, ...fu, ...(fu.bargain ? { priced: false } : {}) };
      c.pendingChoices.push(p);
    }
    this.onRoll(roll, this.post({ type: 'roll', from: k, roll }).id);
    // A human GM names the price in their own narration.
    if (p?.bargain && !c.gm) {
      this.priceBargain(p, {});
      this.system(`💀 사신이 ${ch.name}에게 거래를 내밉니다. GM(당신)이 서술로 대가를 정해 주세요.`);
    }
  }

  // -------------------------------------------------------------------------
  // Reactions: lib/talk.mjs decides when and who; these run the calls and post the lines.
  // A line is an ordinary player message (talk only), marked with `chat`: 'react' / 'reply'
  // (kept from the GM). Planning happens in the players' own messages on their turns, each
  // one's speech heard by the next. (Older saves hold `ooc` lines for these, and `talk`
  // lines said to the party before a round's first declaration.)

  talkLevel() {
    const l = this.c?.chatter || this.cfg.chatter;
    return T.LEVELS.includes(l) ? l : 'normal';
  }

  setGmStyle(style) {
    if (!this.c) return '캠페인이 없어요';
    if (!P.GM_STYLES.includes(style)) return '모르는 성향이에요';
    this.c.gmStyle = style;
    this.changed();
    return null;
  }

  setChatter(level) {
    if (!this.c) return '캠페인이 없어요';
    if (!T.LEVELS.includes(level)) return '모르는 설정이에요';
    this.c.chatter = level;
    this.changed();
    return null;
  }

  talk() { return (this.c.talk ??= { lastBy: {} }); }
  tune() { return T.TUNING[this.talkLevel()] || null; } // null: table talk is off
  aiPlayers() { return this.c.seats.map((s) => s.key).filter((k) => this.c.characters[k]); }

  // A side call for one player's line. It never holds the turn: its own key keeps it out of
  // `busy`, and gives the CLI its own working folder (a declaration may be using the seat's).
  side(key, kind, fn) {
    const sk = `${key}-talk`;
    const seat = this.seatFor(key);
    if (!seat || this.sideBusy.has(sk)) return false;
    const gen = this.gen;
    this.sideBusy.set(sk, kind);
    Promise.resolve()
      .then(() => fn({ ...seat, key: sk }, () => gen === this.gen))
      .catch((e) => this.backends.log?.(sk, `FAIL ${kind}: ${e?.stack || e}`))
      .finally(() => {
        if (gen !== this.gen) return;
        this.sideBusy.delete(sk);
      });
    return true;
  }

  // { line }, with line '' when the player had nothing to say; null when the call failed.
  async talkLine(seat, key, turn, ctx) {
    const { obj } = await this.callJson(seat, 'talk', P.talkBrief(this.c, key), turn, { key, name: this.c.characters[key]?.name, ...ctx });
    return obj ? { line: T.cleanLine(obj.line) } : null;
  }

  // The line came too late to make sense: someone has acted since.
  staleTalk(after) {
    const c = this.c;
    return c.phase === 'ended' || c.log.some((m) => m.id > after && (m.type === 'declare' || (m.type === 'player' && !m.chat && hasAct(m))));
  }

  talkInFlight(...kinds) { return [...this.sideBusy.values()].some((v) => kinds.includes(v)); }

  // A notable moment: another AI player says one line about it, and the one it is about may
  // answer back once. `after` is the message it is about.
  react(ev, after) {
    const c = this.c;
    const tune = this.tune();
    if (!tune || c.paused || this.talkInFlight('react', 'reply')) return;
    const t = this.talk();
    const turnNo = c.turnNo || 0;
    if (!T.mayReact(t, ev, turnNo, tune)) return;
    const k = T.pickReactor({ candidates: this.aiPlayers(), about: ev.who, prefer: ev.prefer, chars: c.characters, lastBy: t.lastBy, turnNo, cooldown: tune.cooldown });
    if (!k) return;
    t.reactedTurn = t.lastReactTurn = turnNo;
    t.lastBy[k] = turnNo;
    this.side(k, 'react', async (seat, live) => {
      const r = await this.talkLine(seat, k, P.reactTurn(c, k, ev), { event: ev.kind });
      if (!live() || !r?.line || this.staleTalk(after)) return;
      this.post({ type: 'player', from: k, parts: [{ k: 'talk', text: r.line }], chat: 'react' });
      const who = ev.who;
      if (!who || who === k || !this.seatFor(who) || Math.random() >= tune.answerBack) return;
      this.side(who, 'reply', async (seat2, live2) => {
        const back = { from: `${P.seatLabel(c, k)}(${c.characters[k]?.name}의 플레이어)`, line: r.line };
        const r2 = await this.talkLine(seat2, who, P.reactTurn(c, who, { ...ev, back }), { event: 'back' });
        if (live2() && r2?.line && !this.staleTalk(after)) this.post({ type: 'player', from: who, parts: [{ k: 'talk', text: r2.line }], chat: 'reply' });
      });
    });
  }

  onRoll(roll, id) {
    const ev = T.rollEvent(this.c.log, roll);
    if (ev) this.react({ ...ev, roll }, id);
  }

  // After a GM reply's effects: a miss that hurt a teammate, who gets the first word.
  onHurt(results, hurt) {
    const c = this.c;
    const miss = results.find((r) => r.tier === 'bad' || r.tier === 'fumble');
    const hit = miss && hurt.find((h) => h.key !== miss.who);
    if (hit) this.react({ kind: 'hurt', who: miss.who, victim: hit.key, prefer: hit.key, before: hit.before, after: hit.after, strong: true }, c.nextId - 1);
  }

  // The human's talk off their turn: one AI player answers, not more often than every 15 seconds.
  userTalk(msg) {
    const c = this.c;
    if (!this.tune() || ['prep', 'ended'].includes(c.phase) || c.paused) return;
    const t = this.talk();
    if (this.talkInFlight('user') || Date.now() - (t.lastUserReply || 0) < 15000) return;
    const ai = this.aiPlayers();
    const text = [textOf(msg, 'talk'), textOf(msg, 'say') && `"${textOf(msg, 'say')}"`].filter(Boolean).join(' ');
    const k = ai.find((x) => text.includes(c.characters[x].name))
      || T.pickReactor({ candidates: ai, about: c.characters.user ? 'user' : null, chars: c.characters, turnNo: 0, cooldown: 0 });
    if (!k) return;
    t.lastUserReply = Date.now();
    this.side(k, 'user', async (seat, live) => {
      const r = await this.talkLine(seat, k, P.reactTurn(c, k, { kind: 'user', text }), { event: 'user' });
      // An answer to the human is worth posting even if a declaration came in meanwhile.
      if (live() && r?.line && c.phase !== 'ended') this.post({ type: 'player', from: k, parts: [{ k: 'talk', text: r.line }], chat: 'reply' });
    });
  }

  // -------------------------------------------------------------------------
  // Down and out (see lib/down.mjs): turns skip the fallen, the ledger knows who fell, Death
  // bargains over a 황천길 7–9, and a party that is all down gets one closing narration.

  // The GM writes Death's offer and both outcomes in one reply.
  pumpBargain() {
    const c = this.c;
    const open = c.pendingChoices.filter((p) => p.bargain);
    if (!open.length || c.phase === 'ended') return false;
    const p = open.find((x) => x.priced === false);
    if (p && c.gm) {
      this.start('gm', 'bargain', async (live) => {
        const { obj, detail } = await this.callJson(c.gm, 'bargain', P.gmBrief(c), P.bargainTurn(c, p.who), { name: P.charName(c, p.who) });
        if (!live() || !c.pendingChoices.includes(p)) return;
        if (!obj) return this.fail('gm', 'bargain', detail);
        this.gmSay({ type: 'narration', from: 'gm', text: str(obj.narration, 2000) || '차가운 손이 어깨에 얹힙니다.\n사신: "아직은 아니다. 대신 값을 치러라."' });
        this.priceBargain(p, obj);
      });
    }
    return true;
  }

  priceBargain(p, obj) {
    const price = str(obj.price, 80).replace(/[()]/g, ' ').trim() || '사신이 정한 대가 (마스터가 나중에 밝힌다)';
    Object.assign(p, {
      price, accept: str(obj.accept, 600), refuse: str(obj.refuse, 600), priced: true,
      options: [`받아들인다: ${price}`, '거부한다: 저편으로 떠난다'],
    });
    this.changed();
  }

  // The player answered: the GM's matching outcome is told, and a deal taken is a debt in the
  // ledger (the price comes due later).
  settleBargain(p, accept) {
    const ch = this.c.characters[p.who];
    const text = accept ? p.accept : p.refuse;
    if (text) this.gmSay({ type: 'narration', from: 'gm', text });
    if (accept) this.serverFacts({ assert: [{ fact: `사건(${factName(ch.name)}의 사신 거래, 대가: ${p.price})`, to: 'all' }] });
    this.syncDown();
  }

  // Facts the server records itself (who fell, a deal struck): applied like the GM's, but
  // without touching the GM's list of refused changes.
  serverFacts(ops) {
    const { applied, rejected, learned } = this.ledger().apply(ops, this.ruleCtx());
    this.ledgerNote(applied, rejected);
    this.clueNotices(learned);
    this.runRules();
  }

  // Keeps the ledger in step with the sheets: 사망(이름) for the dead, 상태(이름, 쓰러짐)
  // while unconscious (gone once they come to), all known to everyone. A death the GM or a
  // rule wrote into the ledger goes onto the sheet. The fallen lose the rest of their round.
  syncDown() {
    const c = this.c;
    if (!c || this.syncing) return;
    this.syncing = true;
    try {
      const L = this.ledger();
      const find = (p, args) => L.list.find((f) => f.p === p && f.args.join('|') === args.join('|'));
      const assert = [], retract = [];
      for (const k of P.playerKeys(c)) {
        const ch = c.characters[k];
        if (!ch) continue;
        const n = factName(ch.name);
        if (find('사망', [n]) && !ch.conditions.includes('사망')) ch.conditions.push('사망');
        const d = downOf(ch);
        // Dead says it all: no 쓰러짐 beside it.
        if (d === 'dead') ch.conditions = ch.conditions.filter((x) => !DOWN_MARKS.includes(x));
        const dead = find('사망', [n]), out = find('상태', [n, '쓰러짐']);
        if (d === 'dead' && dead?.known !== 'all') assert.push({ fact: `사망(${n})`, to: 'all' });
        if (d === 'out' && out?.known !== 'all') assert.push({ fact: `상태(${n}, 쓰러짐)`, to: 'all' });
        if (d !== 'out' && out) retract.push(`상태(${n}, 쓰러짐)`);
        if (d && c.acted && c.order?.includes(k)) c.acted[k] = true;
        if ((ch.down || null) !== d) {
          const line = d === 'dead' ? `☠ ${ch.name}이 숨을 거뒀습니다.` : d === 'out' ? `💤 ${ch.name}이 쓰러졌습니다. 치료받기 전에는 움직일 수 없어요.` : ch.down === 'out' ? `✚ ${ch.name}이 깨어났습니다.` : '';
          if (line && c.phase !== 'prep') this.system(fixJosa(line, [ch.name]), { down: d || 'up', who: k });
          ch.down = d;
        }
      }
      if (assert.length || retract.length) this.serverFacts({ assert, retract });
      this.checkWipe();
    } finally {
      this.syncing = false;
    }
  }

  // Every player character down or dead (once Death has had its say): the party is wiped.
  // An AI GM gets one closing narration (pumpDeclare); a human GM's next narration ends it.
  checkWipe() {
    const c = this.c;
    if (!c || ['prep', 'ended'].includes(c.phase)) return;
    const keys = P.playerKeys(c).filter((k) => c.characters[k]);
    const all = keys.length > 0 && keys.every((k) => downOf(c.characters[k]));
    if (!all) { if (c.wipe && c.resolve?.stage !== 'wipe') c.wipe = false; return; }
    if (c.wipe || c.pendingChoices.some((p) => p.bargain)) return;
    c.wipe = true;
    this.system(`💀 일행이 모두 쓰러졌습니다. 더 움직일 사람이 없어요.${c.gm ? '' : ' GM(당신)의 다음 서술로 이야기를 닫아 주세요.'}`, { wipe: true });
  }

  endStory() {
    const c = this.c;
    c.phase = 'ended';
    // An offer from Death the story ended before answering is moot.
    for (const p of c.pendingChoices.filter((x) => x.bargain)) {
      const roll = this.rollById(p.rid);
      if (roll) roll.pendingChoice = false;
    }
    c.pendingChoices = c.pendingChoices.filter((x) => !x.bargain);
    this.system('🏁 이야기가 막을 내렸습니다. 수고하셨어요!');
    this.changed();
  }

  // -------------------------------------------------------------------------
  // The human at the table

  // One message from the human, in the player's format (lib/post.mjs). A human GM's text is
  // narration. (mode is from older pages: 'ooc' there meant talk.) Returns an error string or null.
  userPost(mode, text) {
    const c = this.c;
    if (!c) return '캠페인이 없어요';
    text = str(text, 2000);
    if (!text) return '내용이 비었어요';
    c.roundsSinceUser = 0;
    if (text.startsWith('/')) return this.command(text);
    const talkOnly = () => {
      const msg = this.post({ type: 'player', from: 'user', parts: [{ k: 'talk', text }] });
      this.userTalk(msg);
      return null;
    };
    if (mode === 'ooc') return talkOnly();
    if (c.userRole === 'gm') {
      if (c.phase === 'prep') return '캐릭터를 만드는 중이에요';
      this.gmSay({ type: 'narration', from: 'gm', text }, false);
      // After a wipe the GM's narration is the closing one.
      if (c.wipe && c.phase !== 'ended') this.endStory();
      if (c.phase !== 'ended') this.beginRound(null);
      return null;
    }
    // A spectator, or a table still being set up: talk.
    const ch = c.characters.user;
    if (c.userRole !== 'player' || !ch || ['prep', 'ended'].includes(c.phase)) return talkOnly();
    const { parts, move: named } = parsePost(text);
    if (!parts.length) return '내용이 비었어요';
    const acting = parts.some((p) => p.k === 'act');
    const down = downOf(ch);
    if (down && acting) return down === 'dead' ? '캐릭터가 죽어서 행동은 할 수 없어요. 말은 계속할 수 있어요.' : '캐릭터가 쓰러져 있어서 행동은 할 수 없어요. 말은 할 수 있어요. 누가 치료해 주면 다시 움직여요.';
    const move = this.namedMove({ parts, move: named }, ch);
    // On their turn, whatever they say goes to the GM (a question, an action, a move called,
    // or words the GM lets pass). Off it, an @action goes first when their turn comes (or
    // next round, if their turn is over); talk and speech are just said.
    const inRound = ['declare', 'resolve', 'roll'].includes(c.phase) && c.order.includes('user') && !c.acted.user && !down;
    const mine = inRound && c.phase === 'declare' && c.turn === 'user';
    const early = !mine && acting && !down && !!c.gm;
    const now = mine || (early && inRound && !c.declared.user);
    const round = early && !now ? c.round + 1 : c.round;
    const toGm = mine || early;
    const msg = this.post({ type: 'player', from: 'user', parts, ...(move ? { move } : {}), ...(toGm ? { toGm: true } : {}), round });
    if (now) c.declared.user = true;
    if (acting) this.boldEvent('user', msg);
    else if (!toGm) this.userTalk(msg);
    this.changed();
    this.pump();
    return null;
  }

  userPass() {
    const c = this.c;
    if (c?.phase !== 'declare' || c.userRole !== 'player' || c.turn !== 'user') return '지금은 넘길 차례가 아니에요';
    c.declared.user = c.acted.user = true;
    this.system(`${c.characters.user?.name || c.userName}은(는) 이번 라운드를 지켜본다.`);
    this.changed();
    this.pump();
    return null;
  }

  // "다르게 할래요": the human takes back their roll before rolling it, having seen what's at
  // stake. The turn is theirs again; what they say next goes to the GM.
  userRetract() {
    const c = this.c;
    const r = c?.resolve;
    if (c?.phase !== 'roll' || !r || r.who !== 'user' || !c.pendingChecks.length) return '물릴 판정이 없어요';
    if (r.results.length || c.pendingChecks.some((p) => p.who !== 'user')) return '이미 다른 판정이 굴러가서 물릴 수 없어요';
    for (const m of this.roundPosts('user')) if (m.check) { delete m.check; this.emit('update', m); }
    c.pendingChecks = [];
    (c.heard ??= {}).user = r.seen;
    c.resolve = null;
    c.phase = 'declare';
    c.declared.user = false;
    const name = c.characters.user?.name || c.userName;
    this.system(fixJosa(`${name}은 판정을 무르고 다시 생각합니다.`, [name]));
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
    if (p.priced === false) return '사신이 아직 거래를 내밀지 않았어요';
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
        this.endStory();
        return null;
      }
      default:
        return `모르는 명령이에요: /${cmd}`;
    }
  }
}

