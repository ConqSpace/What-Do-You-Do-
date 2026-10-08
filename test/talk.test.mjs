// Table talk: reactions to notable moments (lib/talk.mjs), and teammates calling each other in
// their declarations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backends } from '../lib/backends.mjs';
import { Store } from '../lib/store.mjs';
import { Engine } from '../lib/engine.mjs';
import { setRng } from '../lib/dice.mjs';
import { adjudicateTurn, calledOut, declareTurn, gmBrief } from '../lib/prompts.mjs';
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

// ---------------------------------------------------------------------------
// At the table

test('no huddle: the first declaration comes right after the opening, with no talk in between', async () => {
  const engine = table();
  const calls = freezeTurns(engine);
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => calls.some((x) => x.kind === 'declare'));
  const firstDeclare = calls.findIndex((x) => x.kind === 'declare');
  assert.equal(calls.slice(0, firstDeclare).filter((x) => x.kind === 'talk').length, 0);
  assert.equal(chats(engine.c).length, 0);
  assert.equal(T.cleanLine('"아니 뭐하냐고"\n두 번째 줄'), '아니 뭐하냐고');
});

test('a teammate called by name hears the latest call on their own turn, until they answer or it grows old', async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  const c = engine.c;
  c.characters.p1 = engine.makeCharacter({ name: '폭스', class: '전사' }, 'p1');
  c.characters.p2 = engine.makeCharacter({ name: '노라', class: '사냥꾼' }, 'p2');
  c.characters.p3 = engine.makeCharacter({ name: '아본', class: '마법사' }, 'p3');
  c.prep = null;
  c.round = 3;
  engine.post({ type: 'declare', from: 'p2', say: '', action: '활을 겨눌게요' });
  engine.post({ type: 'declare', from: 'p3', say: '노라, 뒤를 봐 줘.', action: '주문을 외울게요' });
  engine.post({ type: 'declare', from: 'p1', say: '내가 놈을 붙든다, 노라, 그 틈에 애를 빼!', action: '방패로 밀어붙일게요' });
  assert.equal(calledOut(c, 'p2').from, 'p1', 'only the latest call');
  assert.equal(calledOut(c, 'p1'), null, '폭스 spoke last: nothing since');
  const turn = declareTurn(c, 'p2');
  assert.ok(turn.includes('폭스이(가) 너를 불렀다: "내가 놈을 붙든다, 노라, 그 틈에 애를 빼!"'));
  assert.ok(!turn.includes('너를 불렀다: "노라, 뒤를 봐 줘."'));
  // A name in the player's own words is no call: only what the character says out loud.
  engine.post({ type: 'player', from: 'p3', parts: [{ k: 'talk', text: '노라 활 잘 쏘네 ㅋㅋ' }] });
  assert.equal(calledOut(c, 'p2').from, 'p1');
  engine.post({ type: 'player', from: 'p3', parts: [{ k: 'say', text: '노라, 왼쪽!' }, { k: 'act', text: '지팡이를 듭니다' }], toGm: true });
  assert.equal(calledOut(c, 'p2').said, '노라, 왼쪽!');
  // Once 노라 has answered, it's behind her.
  engine.post({ type: 'player', from: 'p2', parts: [{ k: 'say', text: '알았어, 폭스!' }, { k: 'act', text: '아이를 끌어냅니다' }], toGm: true });
  assert.equal(calledOut(c, 'p2'), null);
  assert.doesNotMatch(declareTurn(c, 'p2'), /너를 불렀다/);
  assert.equal(calledOut(c, 'p1').from, 'p2');
  // A call from two rounds back is stale: the moment has passed.
  c.round = 5;
  assert.equal(calledOut(c, 'p1'), null);
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
  assert.equal(r.type, 'player');
  assert.deepEqual(r.parts.map((p) => p.k), ['talk'], 'a reaction is the player talking');
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
  engine.post({ type: 'player', from: 'p2', parts: [{ k: 'act', text: '앞장섭니다' }], toGm: true });
  release();
  await until(() => !engine.sideBusy.size);
  assert.equal(chats(c, 'react').length, 0);
});

test('table talk never reaches the GM as fiction: reactions stay out, a player\'s own words read as theirs, an older save\'s party talk is speech', async () => {
  const engine = table();
  freezeTurns(engine);
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'player', players: ['mock', 'mock'], userChar: { name: '아린', class: '전사' } });
  await until(() => engine.c.phase === 'declare');
  const c = engine.c;
  engine.post({ type: 'player', from: 'p1', parts: [{ k: 'talk', text: '아니 뭐하냐고 진짜' }], chat: 'react' });
  engine.post({ type: 'player', from: 'p2', parts: [{ k: 'talk', text: '주사위 바꿔라' }], chat: 'reply' });
  engine.post({ type: 'talk', from: 'p2', text: '수문부터 열자, 사슬은 내가', chat: 'huddle' });
  engine.post({ type: 'ooc', from: 'p1', text: '이거 함정 냄새 나는데' });
  engine.userPost('ooc', '잠깐 화장실 다녀올게요');
  const gm = adjudicateTurn(c);
  assert.ok(!gm.includes('아니 뭐하냐고') && !gm.includes('주사위 바꿔라'), 'reactions are table banter, not for the GM');
  const line = (text) => gm.split('\n').find((l) => l.includes(text)) || '';
  assert.match(line('수문부터 열자'), /\] "수문부터 열자/, 'said out loud: speech');
  assert.match(line('이거 함정 냄새'), /\] 이거 함정 냄새/, 'an old OOC line: the player\'s own words');
  assert.match(line('화장실'), /\] 잠깐 화장실/);
  assert.match(gmBrief(c), /나머지 글은 플레이어가 테이블에서 자기로서 하는 말\(캐릭터는 못 듣는다\)/);
  assert.match(gmBrief(c), /NPC는 그 말을 듣지 못하고/);
  // The players hear all of it.
  const p2 = declareTurn(c, 'p2');
  assert.ok(p2.includes('아니 뭐하냐고') && p2.includes('수문부터 열자'));
  // Talk doesn't eat the story's window: forty lines of chatter still leave the scene in view.
  for (let i = 0; i < 40; i++) engine.post({ type: 'player', from: 'p1', parts: [{ k: 'talk', text: `ㅋㅋ ${i}` }], chat: 'react' });
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

test('the demo table talks: a whole campaign with reactions still reaches its end', async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.phase === 'ended', 15000);
  for (const m of chats(engine.c)) {
    assert.ok(['p1', 'p2', 'p3'].includes(m.from), 'only AI players talk on their own');
    assert.equal(m.type, 'player');
    assert.ok(['react', 'reply'].includes(m.chat));
  }
});

test("the human's bold move gets a word from an AI player too", async () => {
  const engine = table();
  const calls = freezeTurns(engine);
  engine.newCampaign({ rules: 'dw', premise: '테스트', userRole: 'player', players: ['mock', 'mock'], userChar: { name: '아린', class: '전사' } });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user');
  const c = engine.c;
  c.characters.user.hp = 2;
  assert.equal(engine.userPost('declare', '"비켜!" @혼자 정면으로 달려듭니다'), null);
  await until(() => chats(c, 'react').length === 1);
  assert.ok(['p1', 'p2'].includes(chats(c, 'react')[0].from));
  assert.match(calls.filter((x) => x.kind === 'talk').at(-1).turn, /HP가 2\/\d+밖에 안 남았는데/);
});

