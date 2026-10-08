// Down and out: the fallen skip their turns, the ledger knows who fell, Death bargains over
// a 황천길 7–9, and a party that is all down gets one closing narration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backends } from '../lib/backends.mjs';
import { Store } from '../lib/store.mjs';
import { Engine } from '../lib/engine.mjs';
import { setRng } from '../lib/dice.mjs';
import { Ledger } from '../lib/facts.mjs';
import { downOf } from '../lib/down.mjs';
import { adjudicateTurn } from '../lib/prompts.mjs';

const scripted = (seq) => (sides) => (seq.length ? seq.shift() : 1 + Math.floor(Math.random() * sides));

function table(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdyd-'));
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

// A Dungeon World table stopped after the GM's world, with the party set by hand and the
// first round under way.
async function dwTable(party, opts = {}) {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: party.filter(([k]) => k !== 'user').map(() => 'mock'), ...opts });
  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  const c = engine.c;
  for (const [k, name, cls] of party) c.characters[k] ??= engine.makeCharacter({ name, class: cls }, k);
  c.prep = null;
  c.phase = 'declare';
  c.round = 1;
  c.order = party.map(([k]) => k);
  c.acted = {};
  c.declared = {};
  c.turn = null;
  c.foes = [];
  return { engine, c };
}

// Drops a character to 0 HP with the 황천길 dice given.
function drop(engine, who, dice) {
  setRng(scripted([...dice]));
  engine.applyEffects([{ who, hp: -99 }]);
  setRng(null);
}

const fact = (c, p, args) => new Ledger(c.facts).list.find((f) => f.p === p && f.args.join('|') === args.join('|'));

test('the fallen take no turns: left out of the order, skipped mid-round, never asked to declare, back once healed', async () => {
  const { engine, c } = await dwTable([['p1', '하르', '전사'], ['p2', '미라', '도적'], ['p3', '탄', '마법사']]);
  drop(engine, 'p2', [5, 5]); // 황천길 10+: alive, out cold
  assert.equal(downOf(c.characters.p2), 'out');
  assert.equal(engine.seatStatus('p2'), 'down');
  assert.ok(c.log.some((m) => m.down === 'out' && /미라가 쓰러졌습니다/.test(m.text)));

  engine.beginRound(null);
  assert.ok(!c.order.includes('p2'), 'not in the round');
  engine.beginRound(['p2']);
  assert.deepEqual([...c.order].sort(), ['p1', 'p3'], 'a spotlight on only the fallen falls back to everyone');

  // The GM is told who is down, and not offered them as next.
  c.resolve = { stage: 'adjudicate', who: c.order[0], results: [] };
  const turn = adjudicateTurn(c);
  assert.match(turn, /## 쓰러진 캐릭터[^\n]*\n- 미라: 쓰러짐/);
  assert.doesNotMatch(turn.match(/"next": [^\n]*/)?.[0] || '', /p2/);
  c.resolve = null;

  // Dropping mid-round ends that character's round.
  c.acted = {};
  c.order = ['p1', 'p3'];
  drop(engine, 'p3', [5, 6]);
  assert.equal(c.acted.p3, true);
  assert.equal(engine.nextActor(), 'p1');

  // Rounds go on with the one left standing; the fallen are never asked.
  const asked = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind === 'declare') {
      asked.push(seat.key);
      if (asked.length >= 3) engine.setPaused(true);
      return { ok: true, text: '{"action": "앞으로 나아갈게요"}' };
    }
    if (kind === 'adjudicate') return { ok: true, text: JSON.stringify({ checks: [], narration: '바람이 붑니다.' }) };
    return orig(seat, kind, brief, t, ctx);
  };
  c.turn = null;
  engine.setPaused(false);
  await until(() => c.paused && engine.busy.size === 0);
  assert.ok(asked.length >= 3);
  assert.deepEqual([...new Set(asked)], ['p1']);

  // Healed above 0 HP: awake, out of the ledger's 쓰러짐, back in the next round.
  engine.applyEffects([{ who: 'p2', hp: 4 }]);
  assert.equal(downOf(c.characters.p2), null);
  assert.ok(!c.characters.p2.conditions.includes('쓰러짐'));
  assert.ok(c.log.some((m) => m.down === 'up' && /미라가 깨어났습니다/.test(m.text)));
  engine.beginRound(null);
  assert.ok(c.order.includes('p2'));
  assert.ok(!c.order.includes('p3'));
  engine.backends.chat = orig;
});

test('the ledger knows who fell: 사망 and 쓰러짐 for everyone to see, so an ending rule can fire on a lost friend', async () => {
  const { engine, c } = await dwTable([['p1', '하르', '전사'], ['p2', '미라', '도적'], ['p3', '탄', '마법사']]);
  // A boss stands: its veto is for bosses only.
  engine.applyFoes([{ name: '잿심장', boss: true }]);
  engine.applyFacts({ rules: { add: [{ name: '동료를 잃은 결말', when: ['사망(?누구)'], ending: true }] } });

  drop(engine, 'p3', [5, 5]);
  assert.equal(fact(c, '상태', ['탄', '쓰러짐'])?.known, 'all');
  assert.ok(!new Ledger(c.facts).triggered.some((t) => t.ending), 'unconscious is not dead');

  drop(engine, 'p2', [1, 2]); // 황천길 6-
  assert.equal(downOf(c.characters.p2), 'dead');
  assert.equal(fact(c, '사망', ['미라'])?.known, 'all');
  assert.ok(!fact(c, '상태', ['미라', '쓰러짐']), 'dead, not unconscious');
  assert.ok(!c.characters.p2.conditions.includes('쓰러짐'));
  assert.ok(new Ledger(c.facts).triggered.some((t) => t.rule === '동료를 잃은 결말' && t.ending));
  assert.ok(!(c.facts.rejected || []).length, 'nothing refused');
  assert.ok(c.log.some((m) => m.down === 'dead' && /미라가 숨을 거뒀습니다/.test(m.text)));

  // Healing the unconscious one takes 쓰러짐 back out of the ledger.
  engine.applyEffects([{ who: 'p3', hp: 3 }]);
  assert.ok(!fact(c, '상태', ['탄', '쓰러짐']));

  // A death the GM writes into the ledger (even as its secret) goes onto the sheet, for all to know.
  engine.applyFacts({ facts: { assert: ['사망(하르)'] } });
  assert.ok(c.characters.p1.conditions.includes('사망'));
  assert.equal(engine.canAct('p1'), false);
  assert.equal(fact(c, '사망', ['하르']).known, 'all');
  // And it can't be taken back.
  engine.applyFacts({ facts: { retract: ['사망(하르)'] } });
  assert.ok(fact(c, '사망', ['하르']));
});

test('a wipe: with everyone down the GM gets one closing narration, and the story ends past a standing boss', async () => {
  const { engine, c } = await dwTable([['p1', '하르', '전사'], ['p2', '미라', '도적']]);
  engine.applyFoes([{ name: '잿심장', boss: true }]);
  drop(engine, 'p1', [5, 5]);
  assert.ok(!c.wipe);
  drop(engine, 'p2', [6, 4]);
  assert.ok(c.wipe);
  assert.ok(c.log.some((m) => m.wipe && /일행이 모두 쓰러졌습니다/.test(m.text)));

  const calls = [];
  let wipeTurn = '';
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    calls.push(kind);
    if (kind === 'wipe') {
      wipeTurn = t;
      // No "end": the closing narration ends it anyway.
      return { ok: true, text: JSON.stringify({ narration: '불의 거인이 쓰러진 일행을 내려다봅니다. 산은 다시 조용해집니다.' }) };
    }
    return orig(seat, kind, brief, t, ctx);
  };
  engine.setPaused(false);
  await until(() => c.phase === 'ended');
  assert.deepEqual(calls, ['wipe'], 'nobody declares; the GM closes');
  assert.match(wipeTurn, /일행 전멸/);
  assert.match(wipeTurn, /보스가 아직 서 있어도/);
  assert.ok(!engine.findFoe('잿심장').down, 'the boss still stands');
  assert.ok(c.log.some((m) => m.type === 'narration' && /산은 다시 조용해집니다/.test(m.text)));
  assert.match(c.log.at(-1).text, /막을 내렸습니다/);
  engine.backends.chat = orig;
});

test("Death's bargain for an AI player: the GM names the price first, the table waits, and refusing it is death", async () => {
  const { engine, c } = await dwTable([['p1', '하르', '전사'], ['p2', '미라', '도적']]);
  drop(engine, 'p2', [3, 4]); // 황천길 7
  const [p] = c.pendingChoices;
  assert.ok(p.bargain && p.priced === false);
  assert.ok(c.characters.p2.conditions.includes('사신과의 거래'));
  assert.equal(engine.seatStatus('p2'), 'choosing');

  const calls = [];
  let bargainTurn = '', chooseTurn = '';
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    calls.push(kind);
    if (kind === 'bargain') {
      bargainTurn = t;
      return { ok: true, text: JSON.stringify({ narration: '촛불이 꺼집니다.\n사신: "기억 하나를 다오."', price: '가장 아끼는 기억 하나', accept: '숨이 돌아옵니다.', refuse: '미라는 사신을 따라 걸어갑니다.' }) };
    }
    if (kind === 'choose') { chooseTurn = t; return { ok: true, text: '{"choices": [1]}' }; }
    if (kind === 'declare') { engine.setPaused(true); return { ok: true, text: '{"pass": true}' }; }
    return orig(seat, kind, brief, t, ctx);
  };
  engine.setPaused(false);
  await until(() => !c.pendingChoices.length && engine.busy.size === 0);
  engine.setPaused(true);
  assert.deepEqual(calls.slice(0, 2), ['bargain', 'choose'], 'the offer and the answer come before anyone else moves');
  assert.match(bargainTurn, /사신의 거래/);
  assert.match(chooseTurn, /0\. 받아들인다: 가장 아끼는 기억 하나\n\s+1\. 거부한다/);
  assert.ok(c.log.some((m) => m.type === 'npc' && m.name === '사신'), "Death's offer is heard from Death");
  assert.ok(c.log.some((m) => m.type === 'narration' && m.text === '미라는 사신을 따라 걸어갑니다.'));
  assert.ok(!c.log.some((m) => m.text === '숨이 돌아옵니다.'), 'only the outcome picked is told');
  assert.equal(downOf(c.characters.p2), 'dead');
  assert.ok(!c.characters.p2.conditions.includes('사신과의 거래'));
  assert.equal(fact(c, '사망', ['미라'])?.known, 'all');
  const roll = c.log.find((m) => m.roll?.move === '황천길').roll;
  assert.deepEqual([roll.pendingChoice, roll.chosen], [false, ['거부한다: 저편으로 떠난다']]);
  engine.backends.chat = orig;
});

test("Death's bargain for the human: the buttons come once it is priced, taking it leaves a debt, and a fallen human still talks", async () => {
  const engine = table();
  engine.newCampaign({
    rules: 'dw', premise: '던전', userRole: 'player', players: ['mock'],
    userChar: { name: '아린', class: '성기사', scores: { 근력: 15, 민첩성: 8, 체력: 16, 지능: 9, 지혜: 13, 매력: 12 } },
  });
  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  const c = engine.c;
  c.characters.p1 ??= engine.makeCharacter({ name: '하르', class: '전사' }, 'p1');
  Object.assign(c, { prep: null, phase: 'declare', round: 1, order: ['user', 'p1'], acted: {}, declared: {}, turn: null });

  drop(engine, 'user', [4, 4]);
  const [p] = c.pendingChoices;
  assert.match(engine.userChoose(p.id, [0]), /아직 거래를/);

  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => (kind === 'bargain'
    ? { ok: true, text: JSON.stringify({ narration: '사신: "네 이름 하나면 된다."', price: '사신이 부르면 대답한다', accept: '아린의 가슴이 다시 오르내립니다.', refuse: '아린은 눈을 감습니다.' }) }
    : orig(seat, kind, brief, t, ctx));
  engine.setPaused(false);
  await until(() => p.priced && engine.busy.size === 0);
  // The table waits on the human's answer; the page never sees the outcomes written ahead.
  assert.equal(c.phase, 'declare');
  assert.equal(c.turn, null);
  const shown = engine.view().campaign.pendingChoices[0];
  assert.deepEqual(shown.options, ['받아들인다: 사신이 부르면 대답한다', '거부한다: 저편으로 떠난다']);
  assert.ok(!('accept' in shown) && !('refuse' in shown));

  engine.setPaused(true);
  assert.equal(engine.userChoose(p.id, [0]), null);
  const ch = c.characters.user;
  assert.ok(ch.conditions.includes('사신의 빚') && ch.conditions.includes('쓰러짐'));
  assert.equal(downOf(ch), 'out', 'alive, stabilized, still out cold');
  assert.equal(fact(c, '사건', ['아린의 사신 거래', '대가: 사신이 부르면 대답한다'])?.known, 'all');
  assert.ok(c.log.some((m) => m.type === 'narration' && m.text === '아린의 가슴이 다시 오르내립니다.'));

  // Out cold: no declaring, but the seat stays at the table.
  assert.equal(engine.seatStatus('user'), 'down');
  assert.match(engine.userPost('declare', '일어날게요'), /쓰러져/);
  assert.equal(engine.userPost('ooc', '다들 힘내요'), null);

  // Dead: said plainly, and still welcome to chat.
  engine.applyFacts({ facts: { assert: ['사망(아린)'] } });
  assert.equal(engine.seatStatus('user'), 'dead');
  assert.equal(engine.view().characters.user.down, 'dead');
  assert.match(engine.userPost('declare', '일어날게요'), /죽어서/);
  assert.equal(engine.userPost('ooc', '저는 구경할게요'), null);
  engine.backends.chat = orig;
});

test('other rule systems: CoC 기절 and d20 쓰러짐 keep the fallen out until healed, with the same facts', async () => {
  for (const rules of ['coc7', 'd20']) {
    const engine = table();
    engine.newCampaign({ rules, premise: 'x', userRole: 'spectator', players: ['mock', 'mock'] });
    engine.setPaused(true);
    await until(() => engine.busy.size === 0);
    const c = engine.c;
    for (const [k, name] of [['p1', '오필리아'], ['p2', '하워드']]) c.characters[k] ??= engine.makeCharacter({ name }, k);
    Object.assign(c, { prep: null, phase: 'declare', round: 1, order: ['p1', 'p2'], acted: {}, declared: {} });
    const name = c.characters.p1.name;
    engine.applyEffects([{ who: 'p1', hp: -99 }]);
    assert.equal(downOf(c.characters.p1), 'out', rules);
    if (rules === 'coc7') assert.ok(c.characters.p1.conditions.some((x) => ['기절', '빈사'].includes(x)));
    assert.ok(!c.pendingChoices.length, 'no bargain outside Dungeon World');
    assert.equal(fact(c, '상태', [name, '쓰러짐'])?.known, 'all');
    assert.equal(engine.nextActor(), 'p2');
    engine.applyEffects([{ who: 'p1', hp: 2 }]);
    assert.equal(downOf(c.characters.p1), null, rules);
    assert.ok(!c.characters.p1.conditions.some((x) => ['기절', '빈사', '쓰러짐'].includes(x)));
    assert.ok(!fact(c, '상태', [name, '쓰러짐']));
  }
});

test("a human GM's table: a wipe is announced and the GM's next narration closes the story", async () => {
  const engine = table();
  engine.newCampaign({ premise: '내가 GM', userRole: 'gm', players: ['mock'] });
  await until(() => engine.c.phase === 'gm-wait');
  const c = engine.c;
  assert.equal(engine.userPost('declare', '동굴 입구입니다.'), null);
  await until(() => c.phase === 'gm-wait' && c.round === 1);
  engine.userPost('declare', '/hp p1 -99');
  assert.ok(c.wipe);
  assert.match(c.log.filter((m) => m.wipe).at(-1).text, /다음 서술로 이야기를 닫아/);
  assert.equal(engine.userPost('declare', '동굴은 다시 어둠에 잠깁니다.'), null);
  assert.equal(c.phase, 'ended');
});
