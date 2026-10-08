// Table talk: reactions to notable moments and huddles before a round (lib/talk.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backends } from '../lib/backends.mjs';
import { Store } from '../lib/store.mjs';
import { Engine } from '../lib/engine.mjs';
import { setRng } from '../lib/dice.mjs';
import { adjudicateTurn, declareTurn, gmBrief } from '../lib/prompts.mjs';
import * as T from '../lib/talk.mjs';

function table(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdyd-talk-'));
  const cfg = { demo: true, mockDelayMs: 0, maxInFlight: 3, historyWindow: 40, declareMode: 'sequential', waitForUser: true, autoPauseRounds: 0, ...extra };
  return new Engine({ backends: new Backends(root, cfg), store: new Store(root), cfg });
}

async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => {});

// The table stops at its first declaration (the call never returns); table talk still runs.
function freezeTurns(engine, onTalk) {
  const calls = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, turn, ctx) => {
    calls.push({ seat: seat.key, kind, turn, ctx });
    if (['declare', 'adjudicate', 'results'].includes(kind)) return never();
    if (kind === 'talk' && onTalk) await onTalk(ctx, turn);
    return orig(seat, kind, brief, turn, ctx);
  };
  return calls;
}

const chats = (c, kind) => c.log.filter((m) => m.chat && (!kind || m.chat === kind));

// ---------------------------------------------------------------------------
// When and who

const roll = (who, tier, extra = {}) => ({ type: 'roll', roll: { kind: 'check', who, tier, ...extra } });

test('a 대실패 or 풀다이스 is always worth a word; misses in a row are, more so the third', () => {
  assert.deepEqual(T.rollEvent([], { kind: 'check', who: 'p1', tier: 'bad', house: 'fumble' }), { kind: 'fumble', who: 'p1', strong: true });
  assert.equal(T.rollEvent([], { kind: 'check', who: 'p1', tier: 'fumble' }).kind, 'fumble'); // d20 · CoC
  assert.equal(T.rollEvent([], { kind: 'check', who: 'p1', tier: 'good', house: 'crit' }).kind, 'crit');
  assert.equal(T.rollEvent([], { kind: 'free', who: 'p1', tier: 'fumble' }), null, 'a free roll is nothing');
  assert.equal(T.rollEvent([roll('p1', 'bad')], { kind: 'check', who: 'p1', tier: 'bad' }), null, 'one miss is just a miss');
  // Someone else's rolls in between don't break a streak; a success does.
  const two = [roll('p1', 'bad'), roll('p2', 'good'), roll('p1', 'bad')];
  assert.deepEqual(T.rollEvent(two, two[2].roll), { kind: 'streak', who: 'p1', n: 2, strong: false });
  const three = [roll('p1', 'bad'), ...two];
  assert.equal(T.rollEvent(three, three[3].roll).strong, true);
  const broken = [roll('p1', 'bad'), roll('p1', 'good'), roll('p1', 'bad')];
  assert.equal(T.rollEvent(broken, broken[2].roll), null);
});

test('a bold declaration: moving on a sliver of HP, or going straight at the boss', () => {
  const ch = { key: 'p1', hp: 2, maxHp: 10 };
  assert.equal(T.declareEvent(ch, { action: '정면으로 달려들게요' }).kind, 'bold');
  assert.equal(T.declareEvent({ ...ch, hp: 8 }, { action: '정면으로 달려들게요' }), null);
  assert.equal(T.declareEvent({ ...ch, hp: 8 }, { action: '수문지기한테 덤빌게요' }, [{ name: '수문지기' }]).kind, 'bold');
  assert.equal(T.declareEvent({ ...ch, hp: 8 }, { action: '수문지기한테 덤빌게요' }, [{ name: '수문지기', down: true }]), null);
  assert.equal(T.declareEvent(ch, { say: '가자!', action: '' }), null, 'talk alone is no move');
});

test('reactions are rate-limited: one a turn, a gap before weaker moments, a cooldown per player', () => {
  const tune = T.TUNING.normal;
  const t = {};
  assert.ok(T.mayReact(t, { strong: false }, 5, tune));
  t.reactedTurn = t.lastReactTurn = 5;
  assert.ok(!T.mayReact(t, { strong: true }, 5, tune), 'one reaction a turn, whatever happens');
  assert.ok(T.mayReact(t, { strong: true }, 6, tune), 'a 대실패 next turn still gets its word');
  assert.ok(!T.mayReact(t, { strong: false }, 6, tune), 'a weaker moment waits out the gap');
  assert.ok(T.mayReact(t, { strong: false }, 7, tune));
  assert.ok(!T.mayReact({}, { strong: false }, 9, T.TUNING.low), 'turned down: only the big moments');
  assert.ok(!T.mayReact({}, { strong: true }, 9, T.TUNING.off), 'off: nothing');

  const chars = { p1: { name: '메놀리르' }, p2: { name: '브론', bonds: [{ with: 'p1', text: '메놀리르는 내 목숨을 구했다' }] }, p3: { name: '세라' }, p4: { name: '루카' } };
  const base = { candidates: ['p1', 'p2', 'p3', 'p4'], about: 'p1', chars, turnNo: 10, cooldown: 2, rand: () => 0.99 };
  assert.equal(T.pickReactor(base), 'p2', 'the one with a bond to the roller');
  assert.equal(T.pickReactor({ ...base, prefer: 'p4' }), 'p4', 'the teammate who got hurt speaks first');
  assert.equal(T.pickReactor({ ...base, lastBy: { p2: 9 } }), 'p4', 'p2 just spoke: someone else');
  assert.equal(T.pickReactor({ ...base, candidates: ['p1'] }), null, 'never the roller about their own roll');
  // A bond written the other way round counts too.
  assert.ok(T.bonded({ a: { name: '가', bonds: [{ with: '나', text: '' }] }, b: { name: '나' } }, 'b', 'a'));
});

test('huddles: a new scene or a changed boss always calls one; the GM\'s open question only after quiet rounds', () => {
  const tune = T.TUNING.normal;
  assert.equal(T.huddleReason({ pending: [{ kind: 'scene', title: '수문' }], round: 3, lastRound: 2, tune }).kind, 'scene');
  assert.equal(T.huddleReason({ pending: [{ kind: 'boss', name: '수문지기' }], round: 3, lastRound: 2, tune }).kind, 'boss');
  assert.equal(T.huddleReason({ open: true, round: 3, lastRound: 2, tune }), null, 'too soon after the last');
  assert.equal(T.huddleReason({ open: true, round: 4, lastRound: 2, tune }).kind, 'open');
  assert.equal(T.huddleReason({ pending: [{ kind: 'setback', who: 'p2' }], open: true, round: 4, lastRound: 2, tune }).kind, 'setback');
  assert.equal(T.huddleReason({ open: true, round: 9, tune: T.TUNING.low }), null, 'turned down: not for a question');
  assert.equal(T.huddleReason({ pending: [{ kind: 'scene' }], round: 9, tune: T.TUNING.off }), null);
  assert.equal(T.huddleReason({ pending: [{ kind: 'scene' }], round: 9, lastRound: 8, tune: T.TUNING.low }), null, 'turned down: scenes wait their turn too');
  assert.equal(T.huddleReason({ pending: [{ kind: 'boss' }], round: 9, lastRound: 8, tune: T.TUNING.low }).kind, 'boss');

  assert.ok(T.asksEveryone('횃불이 꺼집니다. 어떻게 하시겠습니까?', ['브론']));
  assert.ok(T.asksEveryone('브론, 여러분 모두 어떻게 하시겠습니까?', ['브론']));
  assert.ok(!T.asksEveryone('횃불이 꺼집니다. 브론, 어떻게 하시겠습니까?', ['브론']), 'a question to one character');
  assert.ok(!T.asksEveryone('횃불이 꺼집니다.', ['브론']));

  // Two to four lines; one AI player alone talks once (to the human).
  assert.deepEqual([0, 1, 2, 3, 5].map((n) => T.huddleSize(n, tune)), [0, 1, 3, 4, 4]);
  assert.equal(T.huddleSize(4, T.TUNING.low), 2);
  // Whoever it's about goes first; nobody speaks twice in a row.
  const h = { first: 'p2', spoken: [] };
  assert.equal(T.nextSpeaker(h, ['p1', 'p2', 'p3']), 'p2');
  assert.equal(T.nextSpeaker({ ...h, spoken: ['p2'] }, ['p1', 'p2', 'p3']), 'p1');
  assert.equal(T.nextSpeaker({ ...h, spoken: ['p2', 'p1', 'p3'] }, ['p1', 'p2', 'p3']), 'p1');
  assert.equal(T.nextSpeaker({ spoken: ['p1'] }, ['p1']), null);
  assert.equal(T.cleanLine('"아니 뭐하냐고"\n두 번째 줄'), '아니 뭐하냐고');
});

// ---------------------------------------------------------------------------
// At the table

test('the first scene opens with a bounded huddle before anyone declares, and the declaration hears the plan', async () => {
  const engine = table();
  const calls = freezeTurns(engine);
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => calls.some((x) => x.kind === 'declare'));
  const c = engine.c;
  const huddle = chats(c, 'huddle');
  assert.equal(huddle.length, 4, 'three AI players: four lines');
  const firstDeclare = calls.findIndex((x) => x.kind === 'declare');
  assert.ok(calls.slice(0, firstDeclare).filter((x) => x.kind === 'talk').length >= 4, 'the huddle comes before the first declaration');
  for (let i = 1; i < huddle.length; i++) assert.notEqual(huddle[i].from, huddle[i - 1].from, 'nobody twice in a row');
  for (const m of huddle) {
    assert.ok(['p1', 'p2', 'p3'].includes(m.from));
    assert.ok(['ooc', 'talk'].includes(m.type));
    assert.equal(m.round, 1);
  }
  // Each speaker heard the line before (the huddle prompt carries the log), and the side calls
  // ran apart from the seats' own working folders.
  const talks = calls.filter((x) => x.kind === 'talk');
  assert.ok(talks.every((x) => x.seat.endsWith('-talk')));
  assert.ok(talks[1].turn.includes(huddle[0].text));
  assert.equal(c.huddle, null);
  assert.match(calls[firstDeclare].turn, /동료들과 나눈 이야기가 기록에 있다/);
  assert.ok(calls[firstDeclare].turn.includes(huddle[huddle.length - 1].text));
});

test('a 대실패 gets one line from another player, the roller may answer once, and a second one that turn gets none', async () => {
  const engine = table();
  const calls = freezeTurns(engine);
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => calls.some((x) => x.kind === 'declare'));
  const c = engine.c;
  const [check] = engine.validChecks([{ who: 'p1', move: '위험 돌파', stat: '민첩성' }]);
  setRng(() => 1);
  try { engine.rollCheck(check); } finally { setRng(null); }
  assert.equal(c.log.at(-1).roll.house, 'fumble');
  await until(() => chats(c, 'react').length === 1);
  await until(() => !engine.sideBusy.size);
  const [r] = chats(c, 'react');
  assert.notEqual(r.from, 'p1', 'never the roller');
  assert.equal(r.type, 'ooc');
  const replies = chats(c, 'reply');
  assert.ok(replies.length <= 1);
  if (replies.length) assert.equal(replies[0].from, 'p1', 'only the roller answers back');
  // The reacting player was told what happened, in plain words.
  assert.match(calls.filter((x) => x.kind === 'talk').at(-1 - replies.length).turn, /대실패다/);

  setRng(() => 1);
  try { engine.rollCheck(check); } finally { setRng(null); }
  await sleep(30);
  assert.equal(chats(c, 'react').length, 1, 'one reaction a turn');
});

test('a reaction that comes back after the next declaration is dropped', async () => {
  const engine = table();
  let release;
  const calls = freezeTurns(engine, (ctx) => (ctx.event === 'fumble' ? new Promise((r) => { release = r; }) : null));
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock'] });
  await until(() => calls.some((x) => x.kind === 'declare'));
  const c = engine.c;
  const [check] = engine.validChecks([{ who: 'p1', move: '위험 돌파', stat: '민첩성' }]);
  setRng(() => 1);
  try { engine.rollCheck(check); } finally { setRng(null); }
  await until(() => release);
  engine.post({ type: 'declare', from: 'p2', say: '', action: '앞장설게요' });
  release();
  await until(() => !engine.sideBusy.size);
  assert.equal(chats(c, 'react').length, 0);
});

test('the human joins a huddle with an OOC line: one more line, and the next speaker answers it', async () => {
  const engine = table();
  const gates = [];
  const calls = freezeTurns(engine, (ctx) => (ctx.event === 'huddle' ? new Promise((r) => gates.push(r)) : null));
  engine.newCampaign({
    rules: 'dw', premise: '테스트', userRole: 'player', players: ['mock', 'mock'],
    userChar: { name: '아린', class: '전사', concept: '견습 기사' },
  });
  await until(() => engine.c.huddle && gates.length === 1);
  const c = engine.c;
  assert.equal(c.huddle.max, 3);
  assert.equal(engine.view().campaign.huddle, true);
  assert.equal(engine.userPost('ooc', '저 노인 믿어도 돼?'), null);
  assert.equal(c.huddle.max, 4, 'one more line to answer the human');
  gates.shift()();
  await until(() => gates.length === 1);
  const asked = calls.filter((x) => x.kind === 'talk').at(-1);
  assert.match(asked.turn, /이 회의에 한 말이 있다/);
  assert.ok(asked.turn.includes('저 노인 믿어도 돼?'));
  while (c.huddle) { gates.shift()?.(); await sleep(5); }
  assert.equal(chats(c, 'huddle').length, 4);
  // The human isn't waited on in the huddle: the round goes on (here it's the human's turn).
  assert.equal(c.phase, 'declare');
  assert.equal(c.turn, 'user');
});

test('a huddle is bounded in time: slow players are cut off and the round goes on', async () => {
  const engine = table({ huddleSec: 0.05 });
  const calls = freezeTurns(engine, (ctx) => (ctx.event === 'huddle' ? never() : null));
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock'] });
  await until(() => calls.some((x) => x.kind === 'declare'), 3000);
  assert.equal(engine.c.huddle, null);
  assert.equal(chats(engine.c, 'huddle').length, 0);
});

test('OOC never reaches the GM as fiction: banter stays out, huddle lines and the human\'s are labeled', async () => {
  const engine = table();
  freezeTurns(engine);
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'player', players: ['mock', 'mock'], userChar: { name: '아린', class: '전사' } });
  await until(() => engine.c.phase === 'declare' && !engine.c.huddle);
  const c = engine.c;
  engine.post({ type: 'ooc', from: 'p1', text: '아니 뭐하냐고 진짜', chat: 'react' });
  engine.post({ type: 'ooc', from: 'p2', text: '주사위 바꿔라', chat: 'reply' });
  engine.post({ type: 'talk', from: 'p2', text: '수문부터 열자, 사슬은 내가', chat: 'huddle' });
  engine.post({ type: 'ooc', from: 'p1', text: '이거 함정 냄새 나는데', chat: 'huddle' });
  engine.userPost('ooc', '잠깐 화장실 다녀올게요');
  const gm = adjudicateTurn(c);
  assert.ok(!gm.includes('아니 뭐하냐고') && !gm.includes('주사위 바꿔라'), 'reactions are banter, not for the GM');
  const line = (text) => gm.split('\n').find((l) => l.includes(text)) || '';
  assert.match(line('수문부터 열자'), /동료들에게 한 말\] "/);
  assert.match(line('이거 함정 냄새'), /테이블 잡담\(OOC\), 캐릭터가 한 말 아님\]/);
  assert.match(line('화장실'), /테이블 잡담\(OOC\), 캐릭터가 한 말 아님\]/);
  assert.match(gmBrief(c), /테이블 잡담\(OOC\)은 플레이어끼리 하는 말이다. 캐릭터는 못 듣고/);
  // The players hear all of it.
  const p2 = declareTurn(c, 'p2');
  assert.ok(p2.includes('아니 뭐하냐고') && p2.includes('수문부터 열자'));
  assert.match(p2, /의 플레이어\) · 테이블 잡담\(OOC\)\] 이거 함정/);
  // Talk doesn't eat the story's window: forty lines of chatter still leave the scene in view.
  for (let i = 0; i < 40; i++) engine.post({ type: 'ooc', from: 'p1', text: `잡담 ${i}`, chat: 'react' });
  assert.ok(declareTurn(c, 'p2').includes('수문부터 열자'));
});

test('table talk can be turned down or off; off makes no calls at all', async () => {
  const engine = table({ chatter: 'off' });
  const calls = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = (seat, kind, ...rest) => { calls.push(kind); return orig(seat, kind, ...rest); };
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.phase === 'ended', 10000);
  assert.ok(!calls.includes('talk'));
  assert.equal(chats(engine.c).length, 0);
  assert.equal(engine.view().campaign.chatter, 'off');
  assert.equal(engine.setChatter('loud'), '모르는 설정이에요');
  assert.equal(engine.setChatter('low'), null);
  assert.equal(engine.view().campaign.chatter, 'low');
});

test('the demo table talks: a whole campaign with reactions and huddles still reaches its end', async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.phase === 'ended', 15000);
  const c = engine.c;
  assert.ok(chats(c, 'huddle').length >= 2);
  for (const m of chats(c)) {
    assert.ok(['p1', 'p2', 'p3'].includes(m.from), 'only AI players talk on their own');
    assert.ok(['ooc', 'talk'].includes(m.type));
  }
  // Per round, a huddle never runs past its size.
  const byRound = {};
  for (const m of chats(c, 'huddle')) byRound[m.round] = (byRound[m.round] || 0) + 1;
  assert.ok(Object.values(byRound).every((n) => n <= 4));
});

test("the human's bold move gets a word from an AI player too", async () => {
  const engine = table();
  const calls = freezeTurns(engine);
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'player', players: ['mock', 'mock'], userChar: { name: '아린', class: '전사' } });
  await until(() => engine.c.phase === 'declare' && !engine.c.huddle && engine.c.turn === 'user');
  const c = engine.c;
  c.characters.user.hp = 2;
  assert.equal(engine.userPost('declare', '"비켜!" 혼자 정면으로 달려들게요'), null);
  await until(() => chats(c, 'react').length === 1);
  assert.ok(['p1', 'p2'].includes(chats(c, 'react')[0].from));
  assert.match(calls.filter((x) => x.kind === 'talk').at(-1).turn, /HP가 2\/\d+밖에 안 남았는데/);
});

test('a huddle ends early once someone has nothing to add; a player whose call fails is just skipped', async () => {
  const engine = table();
  const replies = [{ line: '종탑부터 가자.' }, null, { line: '' }];
  let asked = 0;
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, turn, ctx) => {
    if (['declare', 'adjudicate', 'results'].includes(kind)) return never();
    if (kind === 'talk' && ctx.event === 'huddle') {
      const r = replies[Math.min(ctx.n, 2)];
      asked++;
      return r ? { ok: true, text: JSON.stringify(r) } : { ok: false, text: '', detail: '402' };
    }
    return orig(seat, kind, brief, turn, ctx);
  };
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.phase === 'declare' && engine.busy.has(engine.c.turn));
  assert.equal(chats(engine.c, 'huddle').length, 1);
  assert.equal(asked, 4, 'the first line, the failed call (tried twice), and the empty one that closed it');
});
