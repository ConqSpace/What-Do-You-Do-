// The table: a round-based state machine around the GM seat and the player seats.
//
//   prep     GM designs the world → every player makes a character → GM opens the first scene
//   declare  each player declares what their character tries (AIs in turn, the human any time)
//   resolve  GM decides which actions need checks → server rolls → GM narrates the results
//   roll     (only when the human's character has a check) waiting for the human to roll
//   gm-wait  (only when the human is the GM) waiting for the human's narration
//   ended    the GM closed the story
//
// Model calls never block the server: pump() starts whatever the current phase needs and
// every finished call calls pump() again.

import crypto from 'node:crypto';
import { BACKENDS } from './backends.mjs';
import { extractJson, str, strList } from './parse.mjs';
import { STATS, abilityCheck, rollDice, normalizeStats, maxHpFor, clampDc } from './dice.mjs';
import * as P from './prompts.mjs';

const PLAYER_KEYS = ['p1', 'p2', 'p3', 'p4', 'p5'];
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export class Engine {
  constructor({ backends, store, cfg, emit = () => {} }) {
    this.backends = backends;
    this.store = store;
    this.cfg = cfg;
    this.emit = emit;
    this.busy = new Map(); // seat key → kind of call in flight
    this.gen = 0; // bumps on a new campaign so late replies from the old one are dropped
    this.c = store.load();
    if (this.c && !['ended', 'setup'].includes(this.c.phase)) {
      // A restart interrupted whatever was running; resume paused so nothing fires unasked.
      this.c.paused = true;
    }
  }

  // -------------------------------------------------------------------------
  // Views

  seatStatus(key) {
    const c = this.c;
    if (this.busy.has(key)) return 'thinking';
    if (key === 'gm') {
      if (!c.gm) return c.phase === 'gm-wait' ? 'waiting' : 'idle';
      return 'idle';
    }
    if (c.phase === 'declare') {
      if (c.declared[key]) return 'done';
      if (this.inSpotlight(key)) return 'waiting';
    }
    if (c.phase === 'roll' && c.pendingChecks?.some((p) => p.who === key)) return 'rolling';
    return 'idle';
  }

  view() {
    const c = this.c;
    if (!c) return { phase: 'setup', campaign: null, available: this.backends.available() };
    const characters = {};
    for (const [k, ch] of Object.entries(c.characters)) {
      const { notes, ...pub } = ch; // private notes stay off the public view
      characters[k] = { ...pub, hasNotes: !!notes };
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
      campaign: {
        id: c.id, title: c.title, premise: c.premise, tone: c.tone, pitch: c.pitch,
        userRole: c.userRole, userName: c.userName, round: c.round, targetRounds: c.targetRounds,
        scene: c.scene, summary: c.summary, paused: !!c.paused, error: c.error || null,
        spotlight: c.spotlight || null, pendingChecks: c.pendingChecks || [],
        prepStep: c.prep?.step || null,
      },
      seats,
      characters,
      backends: Object.fromEntries(Object.entries(BACKENDS).map(([k, b]) => [k, { label: b.label, color: b.color }])),
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

  system(text) { return this.post({ type: 'system', from: 'system', text }); }

  // -------------------------------------------------------------------------
  // Campaign setup

  // opts: {premise, tone, userRole: 'player'|'spectator'|'gm', userName, gm: backend,
  //        players: [backend...], userChar: {...} | {hint} | null, targetRounds}
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
      version: 1,
      id: `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`,
      createdAt: Date.now(),
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
      prep: { step: userRole === 'gm' ? 'chars' : 'world' },
      round: 0,
      scene: { title: '', description: '' },
      pitch: '', characterHint: '', summary: '', gmNotes: '',
      characters: {},
      declared: {}, order: [], spotlight: null,
      resolve: null, pendingChecks: [],
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
    } else if (userRole === 'player') {
      c.userCharHint = str(uc?.hint, 300);
    }
    this.system(`새 캠페인을 준비합니다. 전제: ${c.premise}`);
    this.store.saveNow(c);
    this.changed();
    this.pump();
    return c;
  }

  makeCharacter(raw, key) {
    const stats = normalizeStats(raw.stats || {});
    const maxHp = maxHpFor(stats);
    return {
      key,
      name: str(raw.name, 40) || `이름 없는 모험가`,
      concept: str(raw.concept, 120),
      appearance: str(raw.appearance, 300),
      personality: str(raw.personality, 300),
      background: str(raw.background, 600),
      stats, maxHp, hp: maxHp,
      items: strList(raw.items, 8),
      conditions: [],
      notes: str(raw.note, 1500),
    };
  }

  // -------------------------------------------------------------------------
  // Model calls

  seatFor(key) {
    const c = this.c;
    if (key === 'gm') return c.gm;
    return c.seats.find((s) => s.key === key);
  }

  // Runs one call for a seat in the background. fn(gen) does the work; its result is
  // dropped if a new campaign started meanwhile.
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
    if (c.phase === 'prep') this.pumpPrep();
    else if (c.phase === 'declare') this.pumpDeclare();
    else if (c.phase === 'resolve') this.pumpResolve();
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
        if (c.userRole === 'gm') {
          c.phase = 'gm-wait';
          c.round = 0;
          this.system('캐릭터가 모두 준비됐어요. GM(당신)이 첫 장면을 서술해 주세요.');
          this.changed();
          return;
        }
        c.prep.step = 'opening';
        this.changed();
        this.pumpPrep();
        return;
      }
      const max = this.cfg.maxInFlight || 3;
      for (const k of missing) {
        if (this.busy.size >= max) break;
        if (this.busy.has(k)) continue;
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
    if (step === 'opening') {
      this.start('gm', 'opening', async (live) => {
        const { obj, detail } = await this.callJson(c.gm, 'opening', P.gmBrief(c), P.openingTurn(c),
          { names: P.playerKeys(c).map((k) => c.characters[k]?.name), scene: c.scene });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'opening', detail);
        if (c.scene.title) this.post({ type: 'scene', from: 'gm', text: `${c.scene.title} — ${c.scene.description}`, title: c.scene.title });
        this.post({ type: 'narration', from: 'gm', text: str(obj.narration, 6000) || '모험이 시작됩니다.' });
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
      const say = str(obj.say, 600), action = str(obj.action, 800);
      if (obj.pass === true || (!say && !action)) {
        this.post({ type: 'system', from: k, text: `${ch.name}은(는) 이번 라운드를 지켜본다.` });
      } else {
        this.post({ type: 'declare', from: k, say, action });
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
          { decls, round: c.round, targetRounds: c.targetRounds, characters: c.characters });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'adjudicate', detail);
        const checks = this.validChecks(obj.checks);
        if (!checks.length) return this.finishRound(obj);
        const pre = str(obj.narration, 1000);
        if (pre) this.post({ type: 'narration', from: 'gm', text: pre });
        for (const ch of checks) {
          if (ch.who === 'user') c.pendingChecks.push({ id: crypto.randomBytes(4).toString('hex'), ...ch });
          else r.results.push(this.rollCheck(ch));
        }
        if (c.pendingChecks.length) {
          c.phase = 'roll';
          this.system(`🎲 ${c.characters.user?.name || c.userName}, 주사위를 굴려 주세요!`);
        } else {
          r.stage = 'results';
        }
      });
      return;
    }
    if (r.stage === 'results') {
      this.start('gm', 'results', async (live) => {
        const { obj, detail } = await this.callJson(c.gm, 'results', P.gmBrief(c), P.resultsTurn(c, r.results),
          { results: r.results, round: c.round, targetRounds: c.targetRounds, characters: c.characters });
        if (!live()) return;
        if (!obj) return this.fail('gm', 'results', detail);
        this.finishRound(obj);
      });
    }
  }

  validChecks(list) {
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      const who = this.resolveWho(x?.who);
      if (!who || !this.c.characters[who]) continue;
      const stat = STATS.find((s) => String(x.stat || '').includes(s)) || '감각';
      const adv = ['advantage', 'disadvantage'].includes(x.adv) ? x.adv : null;
      out.push({ who, stat, dc: clampDc(x.dc), adv, why: str(x.why, 120) });
      if (out.length >= 8) break;
    }
    return out;
  }

  rollCheck(ch) {
    const sheet = this.c.characters[ch.who];
    const res = abilityCheck({ mod: sheet?.stats?.[ch.stat] ?? 0, dc: ch.dc, adv: ch.adv });
    const roll = { kind: 'check', who: ch.who, stat: ch.stat, why: ch.why, ...res };
    this.post({ type: 'roll', from: ch.who, roll });
    return roll;
  }

  finishRound(obj) {
    const c = this.c;
    this.post({ type: 'narration', from: 'gm', text: str(obj.narration, 6000) || '…' });
    this.applyEffects(obj.effects);
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
      const dhp = Math.max(-30, Math.min(30, Math.round(Number(e.hp) || 0)));
      if (dhp) {
        const before = ch.hp;
        ch.hp = Math.max(0, Math.min(ch.maxHp, ch.hp + dhp));
        bits.push(`HP ${before}→${ch.hp}`);
        if (ch.hp === 0 && !ch.conditions.includes('쓰러짐')) ch.conditions.push('쓰러짐');
        if (ch.hp > 0) ch.conditions = ch.conditions.filter((x) => x !== '쓰러짐');
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
      ch.items = ch.items.slice(-15);
      if (bits.length) this.post({ type: 'system', from: k, effect: true, text: `${ch.name}: ${bits.join(' · ')}` });
    }
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
    const { say, action } = splitDeclaration(text);
    const round = c.phase === 'declare' ? c.round : c.round + 1;
    this.post({ type: 'declare', from: 'user', say, action, round });
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
    if (!c.pendingChecks.length) {
      c.phase = 'resolve';
      c.resolve.stage = 'results';
    }
    this.changed();
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

  // Slash commands. Anyone: /r 2d6+1. Human GM: /check, /hp, /scene, /end.
  command(text) {
    const c = this.c;
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd.toLowerCase()) {
      case 'r': case 'roll': case '굴림': {
        const r = rollDice(arg || '1d20');
        if (!r) return '주사위 식을 못 읽었어요 (예: /r 2d6+1, /r 4d6kh3)';
        const who = c.characters.user ? 'user' : 'gm';
        this.post({ type: 'roll', from: who, roll: { kind: 'free', who, ...r } });
        return null;
      }
      case 'check': case '판정': {
        if (c.userRole !== 'gm') return '/check는 GM만 쓸 수 있어요';
        const [who, stat, dc, adv] = rest;
        const k = this.resolveWho(who);
        if (!k) return `캐릭터를 못 찾았어요: ${who}`;
        const s = STATS.find((x) => x === stat);
        if (!s) return `능력치는 ${STATS.join(', ')} 중 하나`;
        this.rollCheck({ who: k, stat: s, dc: clampDc(dc), adv: adv === '유리' ? 'advantage' : adv === '불리' ? 'disadvantage' : null, why: '' });
        return null;
      }
      case 'hp': {
        if (c.userRole !== 'gm') return '/hp는 GM만 쓸 수 있어요';
        this.applyEffects([{ who: rest[0], hp: Number(rest[1]) }]);
        this.changed();
        return null;
      }
      case 'scene': case '장면': {
        if (c.userRole !== 'gm') return '/scene은 GM만 쓸 수 있어요';
        const [title, description = ''] = arg.split('|').map((x) => x.trim());
        c.scene = { title, description };
        this.post({ type: 'scene', from: 'gm', text: `${title} — ${description}`, title });
        this.changed();
        return null;
      }
      case 'end': case '끝': {
        if (c.userRole !== 'gm') return '/end는 GM만 쓸 수 있어요';
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

// '"여기서 기다려." 카엘은 문을 살핀다' → say + action. Text without quotes is all action.
export function splitDeclaration(text) {
  const quotes = [...text.matchAll(/["“”「『]([^"“”」』]+)["“”」』]/g)];
  if (!quotes.length) return { say: '', action: text.trim() };
  const say = quotes.map((m) => m[1].trim()).join(' ');
  const action = text.replace(/["“”「『][^"“”」』]+["“”」』]/g, ' ').replace(/\s+/g, ' ').trim();
  return { say, action };
}
