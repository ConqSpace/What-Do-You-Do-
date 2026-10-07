// The table: a round-based state machine around the GM seat and the player seats. The
// round is the same for every rule system; lib/rules/<id>.mjs decides sheets, checks and
// what a roll means.
//
//   prep     GM designs the world → every player makes a character → (rule-specific extra
//            step, e.g. Dungeon World bonds) → GM opens the first scene
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

const PLAYER_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5'];
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
        userRole: c.userRole, userName: c.userName, round: c.round, targetRounds: c.targetRounds,
        scene: c.scene, summary: c.summary, paused: !!c.paused, error: c.error || null,
        spotlight: c.spotlight || null, foes: c.foes,
        pendingChecks: c.pendingChecks || [], pendingChoices: c.pendingChoices || [],
        prepStep: c.prep?.step || null,
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
  //        gm: backend, players: [backend...], userChar: {...} | {hint} | null, targetRounds}
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
      title: '',
      premise: str(opts.premise, 1500) || '평범한 마을에 이상한 일이 벌어지기 시작한 판타지 모험',
      tone: str(opts.tone, 200),
      userRole,
      userName: str(opts.userName, 30) || this.cfg.userName || '방장',
      gm: userRole === 'gm' ? null : { key: 'gm', backend: pickBackend(opts.gm), model: this.cfg.gmModel?.[pickBackend(opts.gm)] },
      seats: players.map((b, i) => ({ key: PLAYER_KEYS[i], backend: pickBackend(b) })),
      targetRounds: Math.max(4, Math.min(60, Number(opts.targetRounds) || this.cfg.targetRounds || 12)),
      window: this.cfg.historyWindow || 40,
      phase: 'prep',
      prep: { step: userRole === 'gm' ? 'chars' : 'world', bonded: {} },
      round: 0,
      scene: { title: '', description: '' },
      pitch: '', characterHint: '', summary: '', gmNotes: '',
      characters: {},
      foes: [],
      declared: {}, order: [], spotlight: null,
      resolve: null, pendingChecks: [], pendingChoices: [],
      roundsSinceUser: 0,
      paused: false, error: null,
      log: [], nextId: 1,
    };
    if (userRole === 'gm') {
      c.title = c.premise.slice(0, 40);
      c.pitch = c.premise;
    }
    const uc = opts.userChar;
    if (userRole === 'player' && uc && str(uc.name)) {
      c.characters.user = this.makeCharacter(uc, 'user');
      c.prep.bonded.user = true; // the human writes their own bonds (or none)
    } else if (userRole === 'player') {
      c.userCharHint = str(uc?.hint, 300);
    }
    this.system(`새 캠페인을 준비합니다 (${this.R.label}). 전제: ${c.premise}`);
    this.store.saveNow(c);
    this.changed();
    this.pump();
    return c;
  }

  makeCharacter(raw, key) {
    const rule = this.R.makeCharacter(raw);
    return {
      key,
      name: str(raw.name, 40) || '이름 없는 모험가',
      concept: str(raw.concept, 120),
      appearance: str(raw.appearance ?? raw.look, 300),
      personality: str(raw.personality, 300),
      background: str(raw.background, 600),
      items: strList(raw.items, 8),
      conditions: [],
      notes: str(raw.note, 1500),
      ...rule,
      hp: rule.maxHp,
    };
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
        c.title = str(obj.title, 80) || '이름 없는 모험';
        c.pitch = str(obj.pitch, 2000);
        c.characterHint = str(obj.character_hint, 500);
        c.gmNotes = str(obj.gm_notes, 6000);
        c.scene = { title: str(obj.scene?.title, 80), description: str(obj.scene?.description, 800) };
        this.post({ type: 'system', from: 'gm', text: `📜 ${c.title}\n\n${c.pitch}` });
        c.prep.step = 'chars';
      });
      return;
    }
    if (step === 'chars') {
      const missing = P.playerKeys(c).filter((k) => !c.characters[k]);
      if (!missing.length) {
        if (this.busy.size) return;
        c.prep.step = this.R.bondsTask ? 'bonds' : 'ready';
        this.changed();
        this.pumpPrep();
        return;
      }
      // One at a time: each player sees who the party already has and picks a different
      // role (in parallel two AIs happily both pick the fighter).
      if (missing.some((k) => this.busy.has(k))) return;
      for (const k of missing.slice(0, 1)) {
        const forUser = k === 'user';
        // The human's character (if they asked for one) is made by the GM's backend.
        const seat = forUser ? { key: 'maker', backend: c.gm?.backend || c.seats[0]?.backend || 'mock' } : this.seatFor(k);
        this.start(k, 'character', async (live) => {
          const brief = forUser ? P.gmBrief(c) : P.playerBrief(c, k);
          const taken = Object.values(c.characters).map((ch) => ch.name);
          const { obj, detail } = await this.callJson(seat, 'character', brief, P.characterTurn(c, k, { forUser, hint: c.userCharHint }),
            { key: k, label: P.seatLabel(c, k), premise: c.premise, taken });
          if (!live()) return;
          if (!obj) {
            this.backends.log?.(k, `character FAIL: ${detail}`);
            c.characters[k] = this.makeCharacter({ name: `${P.seatLabel(c, k)}의 모험가`, concept: '떠돌이 모험가' }, k);
          } else {
            c.characters[k] = this.makeCharacter(obj, k);
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
          const { obj } = await this.callJson(seat, 'bonds', brief, P.bondsTurn(c, k), { others });
          if (!live()) return;
          c.prep.bonded[k] = true;
          const ch = c.characters[k];
          const bonds = (Array.isArray(obj?.bonds) ? obj.bonds : []).map((b) => ({ with: this.resolveWho(b?.with) || str(b?.with, 40), text: str(b?.text, 200) })).filter((b) => b.text).slice(0, 4);
          if (!bonds.length) return;
          ch.bonds = bonds;
          this.post({ type: 'system', from: k, text: `🤝 ${ch.name}의 유대\n${bonds.map((b) => `· ${b.text}`).join('\n')}` });
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
        const { obj, detail } = await this.callJson(c.gm, 'opening', P.gmBrief(c), P.openingTurn(c),
          { names: P.playerKeys(c).map((k) => c.characters[k]?.name), scene: c.scene });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'opening', detail);
        if (c.scene.title) this.post({ type: 'scene', from: 'gm', text: `${c.scene.title} — ${c.scene.description}`, title: c.scene.title });
        this.post({ type: 'narration', from: 'gm', text: str(obj.narration, 6000) || '모험이 시작됩니다.' });
        this.applyFoes(obj.foes);
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
      const say = str(obj.say, 600), action = str(obj.action, 800), move = str(obj.move, 40);
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
        const decls = c.log.filter((m) => m.round === c.round && m.type === 'declare').map((m) => ({ key: m.from, name: P.charName(c, m.from), text: m.action || m.say }));
        const { obj, detail } = await this.callJson(c.gm, 'adjudicate', P.gmBrief(c), P.adjudicateTurn(c),
          { decls, round: c.round, targetRounds: c.targetRounds, characters: c.characters, foes: c.foes });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'adjudicate', detail);
        this.applyFoes(obj.foes);
        const checks = this.validChecks(obj.checks);
        if (!checks.length) return this.finishRound(obj);
        const pre = str(obj.narration, 1000);
        if (pre) this.post({ type: 'narration', from: 'gm', text: pre });
        for (const ch of checks) {
          if (ch.who === 'user') c.pendingChecks.push({ id: newId(), ...ch });
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
          { results: r.results, round: c.round, targetRounds: c.targetRounds, characters: c.characters, foes: c.foes });
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
        this.applyChoice(p, picks);
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

  applyChoice(p, picks) {
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
    this.R.applyChoice(roll, chosen, c.characters[p.who]);
    roll.pendingChoice = false;
    // The posted roll message holds this same roll object; redraw it with the picks.
    const msg = c.log.find((m) => m.roll?.rid === roll.rid);
    if (msg) this.emit('update', msg);
    this.applyRollDamage(roll);
    this.system(`${P.charName(c, p.who)}의 선택: ${(roll.chosen || []).join(' / ')}`, { choice: true, rid: roll.rid });
    this.changed();
  }

  // A damage-dealing roll hits the foe it named.
  applyRollDamage(roll) {
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
        cur.hp = num(f.hp, 0, 999, cur.hp);
        cur.maxHp = Math.max(cur.maxHp, cur.hp);
        cur.armor = num(f.armor, 0, 10, cur.armor);
        if (str(f.damage)) cur.damage = str(f.damage, 20);
        if (str(f.note)) cur.note = str(f.note, 120);
      } else {
        const hp = num(f.hp, 1, 999, 6);
        c.foes.push({ name, hp, maxHp: hp, armor: num(f.armor, 0, 10, 0), damage: str(f.damage, 20), note: str(f.note, 120) });
      }
    }
    if (c.foes.length > 12) c.foes.splice(0, c.foes.length - 12);
  }

  finishRound(obj) {
    const c = this.c;
    this.post({ type: 'narration', from: 'gm', text: str(obj.narration, 6000) || '…' });
    this.applyEffects(obj.effects);
    this.applyFoes(obj.foes);
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

  userChoose(id, picks) {
    const c = this.c;
    const p = c?.pendingChoices?.find((x) => x.id === id && x.who === 'user');
    if (!p) return '고를 선택지가 없어요';
    const valid = [...new Set((picks || []).map(Number))].filter((i) => i >= 0 && i < p.options.length);
    if (valid.length !== p.count) return `정확히 ${p.count}개를 골라 주세요`;
    this.applyChoice(p, valid);
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
// Text without quotes is all action; a leading [무브] tags the move the player is going for.
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
