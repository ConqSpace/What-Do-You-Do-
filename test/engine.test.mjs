// Full campaigns against the demo bot: no CLI, no network.
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
import { declareTurn, adjudicateTurn } from '../lib/prompts.mjs';

// Scripted dice first, then real ones.
const scripted = (seq) => (sides) => (seq.length ? seq.shift() : 1 + Math.floor(Math.random() * sides));

function table(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdyd-'));
  const cfg = { demo: true, mockDelayMs: 0, maxInFlight: 3, historyWindow: 40, declareMode: 'sequential', waitForUser: true, autoPauseRounds: 0, ...extra };
  const engine = new Engine({ backends: new Backends(root, cfg), store: new Store(root), cfg });
  return { engine, root };
}

async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('spectator campaign runs from prep to the ending', async () => {
  const { engine } = table();
  engine.newCampaign({ premise: '테스트 모험', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.phase === 'ended', 10000);
  const c = engine.c;
  assert.equal(Object.keys(c.characters).length, 3);
  assert.ok(c.round >= 1);
  assert.ok(c.log.some((m) => m.type === 'narration'));
  assert.ok(c.log.some((m) => m.type === 'declare'));
  for (const ch of Object.values(c.characters)) assert.ok(ch.hp >= 0 && ch.hp <= ch.maxHp);
  const v = engine.view();
  assert.ok(!('notes' in v.characters.p1), 'private notes stay out of the public view');
});

test('blank premise and tone: the GM makes them up while designing the world', async () => {
  const { engine } = table();
  let turn = '';
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind === 'worldbuild') turn = t;
    return orig(seat, kind, brief, t, ctx);
  };
  engine.newCampaign({ premise: '  ', userRole: 'spectator', players: ['mock'] });
  assert.equal(engine.c.premise, '');
  await until(() => engine.c.prep?.step !== 'world');
  assert.match(turn, /"premise":/);
  assert.match(turn, /"tone":/);
  assert.ok(engine.c.premise.length > 0);
  assert.ok(engine.c.tone.length > 0);

  // A human GM still needs a premise; with one given, the GM is not asked for it.
  const { engine: e2 } = table();
  e2.newCampaign({ premise: '', userRole: 'gm', players: ['mock'] });
  assert.ok(e2.c.premise.length > 0);
});

test('human player: GM waits for the declaration and the human rolls their own checks', async () => {
  const { engine } = table();
  engine.newCampaign({
    premise: '테스트', userRole: 'player', players: ['mock', 'mock'],
    userChar: { name: '아린', concept: '견습 기사', stats: { 근력: 3, 민첩: 3 }, items: ['검'] },
  });
  assert.equal(engine.c.characters.user.name, '아린');
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(engine.c.phase, 'declare', 'waits for the human');
  assert.equal(engine.seatStatus('user'), 'waiting');

  // Make sure the GM asks the human for a check this round.
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, turn, ctx) => (kind === 'adjudicate'
    ? { ok: true, text: '{"checks":[{"who":"user","stat":"민첩","dc":12,"why":"담 넘기"}],"narration":"숨을 고른다."}' }
    : orig(seat, kind, brief, turn, ctx));
  assert.equal(engine.userPost('declare', '"따라와!" 아린은 담을 넘는다'), null);
  await until(() => engine.c.phase === 'roll');
  const [pending] = engine.c.pendingChecks;
  assert.equal(pending.who, 'user');
  engine.backends.chat = orig;
  assert.equal(engine.userRollCheck(pending.id), null);
  await until(() => engine.c.round === 2 && engine.c.phase === 'declare');
  const roll = engine.c.log.find((m) => m.type === 'roll' && m.from === 'user');
  assert.equal(roll.roll.stat, '민첩');
  assert.equal(roll.roll.mod, engine.c.characters.user.stats.민첩);
  engine.setPaused(true);
});

test('human GM: narration starts rounds, slash commands roll and hurt', async () => {
  const { engine } = table();
  engine.newCampaign({ premise: '내가 GM', userRole: 'gm', players: ['mock', 'mock'] });
  await until(() => engine.c.phase === 'gm-wait');
  assert.equal(engine.userPost('declare', '너희는 어두운 동굴 입구에 서 있다.'), null);
  await until(() => engine.c.phase === 'gm-wait' && engine.c.round === 1);
  const name = engine.c.characters.p1.name;
  assert.equal(engine.userPost('declare', `/check ${name} 감각 12`), null);
  assert.ok(engine.c.log.some((m) => m.type === 'roll' && m.from === 'p1'));
  const before = engine.c.characters.p1.hp;
  engine.userPost('declare', '/hp p1 -3');
  assert.equal(engine.c.characters.p1.hp, before - 3);
  assert.match(engine.userPost('declare', '/check 없는사람 감각 12'), /못 찾/);
});

test('GM failure pauses the table and resume retries', async () => {
  const { engine } = table();
  const orig = engine.backends.chat.bind(engine.backends);
  let fail = true;
  engine.backends.chat = async (seat, kind, ...rest) => (kind === 'worldbuild' && fail ? { ok: false, text: '', detail: 'boom' } : orig(seat, kind, ...rest));
  engine.newCampaign({ premise: 'x', userRole: 'spectator', players: ['mock'] });
  await until(() => engine.c.paused && engine.c.error);
  fail = false;
  engine.setPaused(false);
  await until(() => engine.c.phase === 'declare');
  assert.equal(engine.c.error, null);
  engine.setPaused(true);
});

test('dungeon world: spectator campaign with bonds, foes and moves runs to the end', async () => {
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.phase === 'ended', 10000);
  const c = engine.c;
  for (const ch of Object.values(c.characters)) {
    assert.ok(ch.class && ch.scores && ch.damage, 'dw sheet');
    assert.ok(ch.bonds.length > 0, 'bonds step ran');
  }
  assert.ok(c.log.some((m) => m.type === 'roll' && m.roll.move), 'moves were rolled');
  assert.equal(c.pendingChoices.length, 0);
  assert.ok(engine.view().characters.p1.sheet.stats.length === 6);
});

test('dungeon world: the human picks 7-9 options, damage moves hit foes, 0 HP rolls last breath', async () => {
  const { engine } = table();
  engine.newCampaign({
    rules: 'dw', premise: '던전', userRole: 'player', players: ['mock'],
    userChar: { name: '아린', class: '성기사', scores: { 근력: 15, 민첩성: 8, 체력: 16, 지능: 9, 지혜: 13, 매력: 12 } },
  });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user');
  const c = engine.c;
  assert.equal(c.characters.user.maxHp, 10 + 16);
  assert.ok(c.foes.length, 'opening registered a foe');

  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, ...rest) => (kind === 'adjudicate'
    ? { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '상황 파악' }, { who: 'p1', move: '접근전', target: '종탑의 그림자' }] }) }
    : orig(seat, kind, ...rest));
  setRng(scripted([/* p1 hack&slash: 12+ */ 6, 6, /* damage */ 4, /* user discern: 7 + 지혜+1 = 8 */ 3, 4]));
  engine.userPost('declare', '[상황 파악] 아린은 녀석의 약점을 찾는다');
  await until(() => c.phase === 'roll');
  // p1's hack and slash already hit the foe (12+ → damage d-die = 4)
  assert.ok(c.log.some((m) => m.type === 'system' && m.text.includes('종탑의 그림자 HP')), 'foe took damage');
  const [pc] = c.pendingChecks;
  engine.backends.chat = orig;
  engine.userRollCheck(pc.id);
  const choice = c.pendingChoices.find((p) => p.who === 'user');
  assert.equal(choice.count, 1);
  assert.match(engine.userChoose(choice.id, [0, 1]), /정확히 1개/);
  assert.equal(engine.userChoose(choice.id, [2]), null);
  setRng(null);
  await until(() => c.round === 2 && c.phase === 'declare');
  assert.ok(c.log.some((m) => m.choice && m.text.includes('무엇을 주의해야 하나?')));

  setRng(scripted([1, 1]));
  engine.applyEffects([{ who: 'user', hp: -99 }]);
  setRng(null);
  assert.equal(c.characters.user.hp, 0);
  const lb = c.log.filter((m) => m.type === 'roll').at(-1);
  assert.equal(lb.roll.move, '황천길');
  assert.ok(c.characters.user.conditions.includes('사망'));
  engine.setPaused(true);
});

test('call of cthulhu: spectator campaign with combat, sanity and clues runs to the end', async () => {
  const { engine } = table();
  engine.newCampaign({ rules: 'coc7', premise: '항구 도시 실종 사건', userRole: 'spectator', players: ['mock', 'mock'] });
  await until(() => engine.c.phase === 'ended', 10000);
  const c = engine.c;
  for (const ch of Object.values(c.characters)) {
    assert.ok(ch.chars && ch.skills && ch.san > 0 || ch.conditions.includes('영구 광기'));
    assert.ok(ch.occupation);
  }
  assert.ok(c.log.some((m) => m.type === 'roll' && m.roll.total >= 1 && m.roll.total <= 100));
  assert.equal(c.pendingChoices.length, 0);
});

test('call of cthulhu: the human pushes a failed roll with a reason', async () => {
  const { engine } = table();
  engine.newCampaign({
    rules: 'coc7', premise: 'x', userRole: 'player', players: ['mock'],
    userChar: { name: '오필리아', occupation: '간호사', stats: { 근력: 45, 건강: 60, 크기: 50, 민첩: 70, 외모: 60, 지능: 75, 정신: 65, 교육: 70 }, skills: '응급처치 60' },
  });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user');
  const c = engine.c;
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, ...rest) => (kind === 'adjudicate'
    ? { ok: true, text: JSON.stringify({ checks: [{ who: 'user', type: 'skill', skill: '응급처치', push_risk: '경비가 깨어난다' }] }) }
    : orig(seat, kind, ...rest));
  engine.userPost('declare', '오필리아는 경비의 상처를 지혈한다');
  await until(() => c.phase === 'roll');
  engine.backends.chat = orig;
  const d = (n) => (n % 10) + 1;
  setRng(scripted([d(5), d(9), /* 95: fail */ d(2), d(1) /* push → 12: success */]));
  engine.userRollCheck(c.pendingChecks[0].id);
  const choice = c.pendingChoices.find((p) => p.who === 'user');
  assert.ok(choice, 'a failed skill roll offers luck / push / accept');
  const push = choice.options.findIndex((o) => o.startsWith('밀어붙'));
  assert.equal(engine.userChoose(choice.id, [push], '코트를 찢어 상처를 꽉 묶는다'), null);
  setRng(null);
  const pushed = c.log.filter((m) => m.type === 'roll').at(-1).roll;
  assert.equal(pushed.pushed, true);
  assert.equal(pushed.total, 12);
  assert.equal(pushed.why, '코트를 찢어 상처를 꽉 묶는다');
  await until(() => c.round === 2);
  assert.ok(c.characters.user.ticks.includes('응급처치'));
  engine.setPaused(true);
});

test('fact ledger: secrets and other players\' whispers never reach a player\'s prompt', async () => {
  const { engine } = table();
  engine.newCampaign({ premise: '장부 테스트', userRole: 'spectator', players: ['mock', 'mock'] });
  await until(() => engine.c.phase === 'declare');
  const c = engine.c;
  assert.ok(new Ledger(c.facts).list.some((f) => f.p === '비밀'), 'worldbuild filled the ledger');
  engine.setPaused(true);
  engine.applyFacts({
    facts: { assert: [{ fact: '단서(편지, 영주의 서명이 든 편지)', to: ['p1'] }] },
    whispers: [{ to: 'p1', text: '너만 본다: 창밖의 그림자' }],
  });
  const p1 = declareTurn(c, 'p1');
  const p2 = declareTurn(c, 'p2');
  assert.match(p1, /단서\(편지/);
  assert.match(p1, /창밖의 그림자/);
  assert.doesNotMatch(p2, /단서\(편지/);
  assert.doesNotMatch(p2, /창밖의 그림자/);
  for (const t of [p1, p2]) assert.doesNotMatch(t, /비밀\(영주/, 'secrets stay with the GM');
  const gm = adjudicateTurn(c);
  assert.match(gm, /비밀\(영주, 실종자를 제물로 바친다\) \{비밀\}/);
  assert.match(gm, /귓속말 → /);
  engine.applyFacts({ facts: { assert: ['날씨(비)'] } });
  assert.match(adjudicateTurn(c), /거절된 장부 변경[\s\S]*날씨\(비\)/);
  assert.ok(!engine.view().campaign.knownFacts.some((t) => t.startsWith('비밀')), 'spectator view shows public facts only');
  assert.ok(engine.secrets().facts.length > 5);
});

test('fact ledger: a clue told to one character is announced only to them', async () => {
  const { engine } = table();
  engine.newCampaign({ premise: '단서 테스트', userRole: 'spectator', players: ['mock', 'mock'] });
  await until(() => engine.c.phase === 'declare');
  engine.setPaused(true);
  const c = engine.c;
  engine.applyFacts({ facts: { assert: [{ fact: '단서(비늘, 은회색 비늘)', to: ['p1'] }] } });
  const notice = c.log.filter((m) => m.clue).at(-1);
  assert.equal(notice.to, 'p1');
  assert.match(declareTurn(c, 'p1'), /은회색 비늘/);
  assert.doesNotMatch(declareTurn(c, 'p2'), /은회색 비늘/);
  engine.applyFacts({ facts: { reveal: [{ fact: '단서(비늘, 은회색 비늘)', to: 'all' }] } });
  assert.equal(c.log.filter((m) => m.clue).at(-1).to, undefined, 'revealed to all: a public notice');
  assert.match(declareTurn(c, 'p2'), /은회색 비늘/);
});

test('rules: a firing reaches the GM\'s next prompt, an ending tells the GM to close, narration clears it', async () => {
  const { engine } = table();
  engine.newCampaign({ premise: '규칙 테스트', userRole: 'spectator', players: ['mock'] });
  await until(() => engine.c.phase === 'declare');
  engine.setPaused(true);
  const c = engine.c;
  // The demo bot plays fast and brings its own rules; start this test from a clean slate.
  c.facts.rules = [];
  c.facts.triggered = [];
  engine.applyFacts({
    facts: { assert: ['시계(파국) = 5/6'] },
    rules: { add: [{ name: '파국', when: ['시계(파국) >= 6'], then: ['사건(파국, 탑이 무너진다)'], ending: true, note: '나쁜 결말' }] },
  });
  assert.doesNotMatch(adjudicateTurn(c), /방금 발동한 규칙/);
  assert.match(adjudicateTurn(c), /\[결말\] 파국: ✗ 시계\(파국\) >= 6 \(지금 5\)/);
  engine.applyFacts({ facts: { assert: ['시계(파국) = +1'] } });
  const gm = adjudicateTurn(c);
  assert.match(gm, /방금 발동한 규칙[\s\S]*파국 \[결말 조건 충족\]: 나쁜 결말/);
  assert.match(gm, /"end": true로 끝내/);
  assert.ok(new Ledger(c.facts).list.some((f) => f.p === '사건' && f.args[0] === '파국'));
  c.resolve = { stage: 'results', results: [], pendingRules: new Ledger(c.facts).triggered.map((t) => t.id) };
  engine.endTurn({ narration: '탑이 무너진다.', end: true });
  assert.equal(c.phase, 'ended');
  assert.equal(new Ledger(c.facts).triggered.length, 0, 'narrated, cleared');
  assert.ok(engine.secrets().rules.find((r) => r.name === '파국').fired.length);
});

test('clue paths: the GM sees each conclusion\'s paths and is warned once when one closes', async () => {
  const { engine } = table();
  engine.newCampaign({ premise: '단서 경로', userRole: 'spectator', players: ['mock', 'mock'] });
  await until(() => engine.c.phase === 'declare');
  engine.setPaused(true);
  const c = engine.c;
  c.facts.rules = [];
  engine.applyFacts({ facts: { assert: ['결론(범인, 말로우)', '근거(범인, 장부)', '근거(범인, 비늘)', '단서(장부, 명단)', '단서(비늘, 은회색)', '출처(장부, 제7창고)'] } });
  let gm = adjudicateTurn(c);
  assert.match(gm, /\[결론\] 범인 \(말로우\): 확보 0 · 열림 2 \/ 필요 2 → 진행 중/);
  assert.match(gm, /○ 장부 열림 ← 제7창고/);
  assert.match(gm, /근거 단서가 2개뿐/);
  const warnings = () => c.log.filter((m) => m.ledger && /길이 막혔다/.test(m.text)).length;
  engine.applyFacts({ facts: { assert: ['상태(장부, 소실)'] } });
  assert.equal(warnings(), 1);
  engine.applyFacts({ facts: { assert: ['상태(톰, 실종)'] } });
  assert.equal(warnings(), 1, 'warned once');
  gm = adjudicateTurn(c);
  assert.match(gm, /→ 막힘/);
  assert.match(gm, /⚠ 막혔다/);
  const secret = engine.secrets().conclusions.find((x) => x.name === '범인');
  assert.equal(secret.blocked, true);
  assert.equal(secret.support.find((s) => s.clue === '장부').status, 'lost');
});

test('character builder: the AI players make theirs, then the table waits for the human', async () => {
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'player', players: ['mock', 'mock'] });
  assert.ok(engine.view().campaign.builder, 'no character given: the human builds one');
  await until(() => engine.c.characters.p1 && engine.c.characters.p2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(engine.c.prep.step, 'chars', 'waits for the human');

  assert.equal(engine.builderSave({ page: 3, class: '도적' }), null);
  assert.deepEqual(engine.view().campaign.builder.draft, { page: 3, class: '도적' });
  assert.equal(engine.builderRoll('근력'), '이 룰은 특성치를 굴리지 않아요');
  assert.equal(engine.builderFinish({ char: { class: '도적' } }), '이름을 정해 주세요');
  const scores = { 근력: 8, 민첩성: 16, 체력: 12, 지능: 13, 지혜: 9, 매력: 15 };
  assert.equal(engine.builderFinish({ char: { name: '스패로', class: '도적', scores, bonds: [{ with: 'p1', text: '루나가 나를 도와줄 것이다.' }] } }), null);
  const ch = engine.c.characters.user;
  assert.equal(ch.class, '도적');
  assert.deepEqual(ch.scores, scores);
  assert.equal(ch.bonds[0].text, '루나가 나를 도와줄 것이다.');
  assert.equal(engine.view().campaign.builder, null);
  assert.match(engine.builderSave({}), /만들 수 없어요/);
  await until(() => engine.c.phase === 'declare');
  engine.setPaused(true);
});

test('character builder: the rest left to the GM keeps what the human chose', async () => {
  const { engine } = table();
  let turn = '';
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind === 'character' && seat.key === 'maker') turn = t;
    return orig(seat, kind, brief, t, ctx);
  };
  engine.newCampaign({ premise: '학교 괴담', userRole: 'player', players: ['mock'] });
  assert.equal(engine.builderFinish({ char: { name: '한서진', concept: '괴담을 취재하는 신문부원' }, delegate: true, hint: '겁이 많다' }), null);
  assert.equal(engine.view().campaign.builder, null);
  await until(() => engine.c.characters.user);
  assert.equal(engine.c.characters.user.name, '한서진');
  assert.equal(engine.c.characters.user.concept, '괴담을 취재하는 신문부원');
  assert.match(turn, /겁이 많다/);
  assert.match(turn, /신문부원/);
  engine.setPaused(true);
});

test('character builder: CoC characteristics come from server rolls, or valid quick-fire / point buy', async () => {
  const { engine } = table();
  engine.newCampaign({ rules: 'coc7', premise: 'x', userRole: 'player', players: ['mock'] });
  assert.equal(engine.builderRoll('지능'), null);
  assert.equal(engine.builderRoll('지능'), '이미 굴렸어요');
  assert.equal(engine.builderRoll('마법'), '없는 특성치예요');
  const int = engine.c.prep.builder.rolls.지능;
  assert.ok(int >= 40 && int <= 90);
  assert.equal(engine.view().campaign.builder.rolls.지능, int);

  const all = (v) => Object.fromEntries(['근력', '건강', '크기', '민첩', '외모', '지능', '정신', '교육'].map((k) => [k, v]));
  assert.match(engine.builderFinish({ char: { name: '오필리아', method: 'quick', stats: all(50) } }), /빠른 배분/);
  assert.match(engine.builderFinish({ char: { name: '오필리아', method: 'point', stats: all(50) } }), /460/);
  // The page cannot pick its own numbers: 'roll' uses the server's rolls, luck too.
  assert.equal(engine.builderFinish({ char: { name: '오필리아', occupation: '간호사', method: 'roll', stats: all(90), luck: 99 } }), null);
  const ch = engine.c.characters.user;
  assert.equal(ch.chars.지능, int);
  assert.equal(ch.luck, engine.c.prep.builder.rolls.행운);
  assert.ok(Object.values(ch.chars).every((v) => v >= 15 && v <= 90));
  engine.setPaused(true);

  const { engine: e2 } = table();
  e2.newCampaign({ rules: 'coc7', premise: 'x', userRole: 'player', players: ['mock'] });
  const quick = { 근력: 40, 건강: 50, 크기: 50, 민첩: 50, 외모: 60, 지능: 60, 정신: 70, 교육: 80 };
  assert.equal(e2.builderFinish({ char: { name: '잭', occupation: '사립탐정', method: 'quick', stats: quick } }), null);
  assert.deepEqual(e2.c.characters.user.chars, quick);
  e2.setPaused(true);
});

test('a story from the gallery: its title stays, and the GM gets its first scene and size', async () => {
  const { engine } = table();
  let turn = '';
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind === 'worldbuild') turn = t;
    return orig(seat, kind, brief, t, ctx);
  };
  engine.newCampaign({ rules: 'dw', premise: '종이 울리는 국경 마을', title: '잿빛 종탑의 비밀', opening: '종탑 아래 남은 작은 신발 한 짝', length: 'short', userRole: 'spectator', players: ['mock'] });
  await until(() => engine.c.prep?.step !== 'world');
  assert.match(turn, /첫 장면: 종탑 아래 남은 작은 신발 한 짝/);
  assert.match(turn, /이야기 규모: 짧은 모험/);
  assert.match(turn, /제목: 잿빛 종탑의 비밀/);
  assert.equal(engine.c.title, '잿빛 종탑의 비밀');
  engine.setPaused(true);

  const { engine: e2 } = table();
  e2.newCampaign({ rules: 'dw', premise: 'x', length: 'forever', userRole: 'spectator', players: ['mock'] });
  assert.equal(e2.c.length, '', 'unknown lengths are dropped');
  e2.setPaused(true);
});

test('a Dungeon World story hands the GM its front and the question to open with', async () => {
  const { engine } = table();
  const turns = {};
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    turns[kind] = t;
    return orig(seat, kind, brief, t, ctx);
  };
  engine.newCampaign({
    rules: 'dw', premise: '고블린이 대장장이를 끌고 갔다', userRole: 'spectator', players: ['mock'],
    opening: '고블린 정찰병 셋이 활을 겨눈다', openingAsk: '대장장이는 여러분에게 어떤 사람인가요?',
    questions: ['대장장이는 살아서 돌아올 수 있을까?'],
    front: { dangers: [{ name: '붉은이빨 고블린 부족', type: '괴물 떼', motive: '새 보금자리를 찾는다', portents: ['마을을 습격한다', '마을로 몰려온다'], doom: { text: '마을이 넘어간다', type: '압제' } }, { name: 'x'.repeat(200) }], cast: ['대장장이 브론'], blank: '깨어난 것의 정체' },
  });
  assert.equal(engine.c.front.dangers[1].name.length, 60, 'front text is capped');
  await until(() => turns.opening);
  assert.match(turns.worldbuild, /위험요소: 붉은이빨 고블린 부족 \(괴물 떼 · 동기: 새 보금자리를 찾는다\)/);
  assert.match(turns.worldbuild, /흉조\(내버려 두면 이 순서로 벌어진다\): 마을을 습격한다 → 마을로 몰려온다/);
  assert.match(turns.worldbuild, /빈칸\(정하지 마\. 플레이하며 정한다\): 깨어난 것의 정체/);
  assert.match(turns.worldbuild, /이야기가 답할 질문.*대장장이는 살아서 돌아올 수 있을까\?/);
  assert.match(turns.opening, /이 질문을 던지고.*대장장이는 여러분에게 어떤 사람인가요\?/);
  engine.setPaused(true);

  const { engine: e2 } = table();
  e2.newCampaign({ rules: 'dw', premise: 'x', front: { dangers: [] }, userRole: 'spectator', players: ['mock'] });
  assert.equal(e2.c.front, null, 'a front without dangers is dropped');
  e2.setPaused(true);
});

test("the pace is the page's to keep: messages go out at once, and the campaign remembers the reveal speed", async () => {
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock', 'mock'] });
  await until(() => engine.c.phase === 'declare');
  const c = engine.c;
  await until(() => c.log.some((m) => m.type === 'declare'));
  const d = c.log.find((m) => m.type === 'declare');
  assert.ok(d.action && !d.line, 'AI players declare what they mean to do');
  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  assert.equal(engine.view().campaign.pace, 'normal', 'config.readPace or normal');
  assert.equal(engine.setPace('fast'), null);
  assert.equal(engine.view().campaign.pace, 'fast');
  assert.equal(engine.setPace('warp'), '모르는 속도예요');
  // A long narration doesn't hold back what comes next.
  const n = c.log.length;
  engine.post({ type: 'narration', from: 'gm', text: '가'.repeat(400) });
  engine.setPaused(false);
  await until(() => c.log.length > n + 1);
  engine.setPaused(true);
});

test('effects from one GM reply come as one line', () => {
  const { engine } = table();
  engine.newCampaign({ premise: 'x', userRole: 'player', players: ['mock'], userChar: { name: '아린', stats: {} } });
  engine.c.characters.p1 = engine.makeCharacter({ name: '미라' }, 'p1');
  const before = engine.c.log.length;
  engine.applyEffects([{ who: 'user', hp: -2 }, { who: 'p1', hp: -1 }]);
  const posted = engine.c.log.slice(before).filter((m) => m.effect);
  assert.equal(posted.length, 1);
  assert.match(posted[0].text, /아린: HP .*·.*미라: HP/);
  engine.setPaused(true);
});

test('long GM text comes as short beats, all at once and in order; the GM reads its speech as one', async () => {
  const { splitBeats } = await import('../lib/beats.mjs');
  const pitch = '📜 드워프 폐광\n\n산맥 아래 버려진 광산이 다시 숨을 쉰다. 보름 사이 마을에서 아이 셋이 사라졌다. 촌장은 "밤마다 망치 소리가 난다. 저 안에서." 하고 떨었다. 당신들은 각자의 이유로 이 마을에 모였다.';
  const beats = splitBeats(pitch);
  assert.ok(beats.length >= 2, 'split');
  assert.ok(beats[0].startsWith('📜 드워프 폐광\n'), 'the heading rides with the first beat');
  assert.ok(beats.some((b) => b.includes('"밤마다 망치 소리가 난다. 저 안에서." 하고 떨었다.')), 'a quote is not cut in the middle');
  assert.deepEqual(splitBeats('짧다.'), ['짧다.']);

  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock'] });
  await until(() => engine.c.phase === 'declare');
  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  const c = engine.c, n = c.log.length;
  engine.gmSay({ type: 'narration', from: 'gm', text: `${pitch.split('\n\n')[1]} 광산 입구에는 새 쇠말뚝이 줄지어 박혀 있었다.` });
  engine.post({ type: 'system', from: 'gm', effect: true, text: '그레타: HP 10→8' });
  const out = c.log.slice(n);
  assert.ok(out.length >= 3 && out.slice(1, -1).every((m) => m.cont), 'the beats follow as continuations, at once');
  assert.ok(out.at(-1).effect, 'what came after the speech stays after it');
  const P = await import('../lib/prompts.mjs');
  assert.equal(P.formatLog(c, out, null).split('\n').filter((l) => l.includes('서술]')).length, 1, 'the GM reads its speech as one');
});

test("what a character says and what the player declares stay apart, even when a model mixes them", async () => {
  const { engine } = table();
  const replies = [
    { say: '', action: '"망치 내려놔. 그건 브론 거다." 방패로 밀어붙여서 망치를 빼앗아 볼게요' },
    { line: '"해치지 않을게요." 앞으로 나서 볼게요' },
    { say: '"하르벤, 잠깐만요."', action: '' },
  ];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => (kind === 'declare' && replies.length
    ? { ok: true, text: JSON.stringify(replies.shift()) } : orig(seat, kind, brief, t, ctx));
  engine.cfg.declareMode = 'sequential';
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.log.filter((m) => m.type === 'declare').length >= 3);
  engine.setPaused(true);
  const ds = engine.c.log.filter((m) => m.type === 'declare').slice(0, 3).map(({ say, action }) => ({ say, action }));
  assert.deepEqual(ds, [
    { say: '망치 내려놔. 그건 브론 거다.', action: '방패로 밀어붙여서 망치를 빼앗아 볼게요' },
    { say: '해치지 않을게요.', action: '앞으로 나서 볼게요' },
    { say: '하르벤, 잠깐만요.', action: '' },
  ]);
  const P = await import('../lib/prompts.mjs');
  assert.match(P.formatLog(engine.c, engine.c.log.filter((m) => m.type === 'declare').slice(0, 1), null), /말: "망치 내려놔\. 그건 브론 거다\." \/ 하려는 것: 방패로/);
});

test('an NPC line in GM text is heard from that NPC, not from the GM', async () => {
  const { splitSpeech } = await import('../lib/beats.mjs');
  assert.deepEqual(splitSpeech('바위 위에서 고블린 셋이 시위를 당긴다.\n뾰족귀: "내려가! 산, 우리 거!" 놈이 이를 드러낸다.\n어떻게 하시겠습니까?'), [
    { text: '바위 위에서 고블린 셋이 시위를 당긴다.' },
    { npc: '뾰족귀', say: '내려가! 산, 우리 거!' },
    { text: '놈이 이를 드러낸다.\n어떻게 하시겠습니까?' },
  ]);
  assert.deepEqual(splitSpeech('**여관 주인**: “부탁이 있소.”'), [{ npc: '여관 주인', say: '부탁이 있소.' }]);
  assert.equal(splitSpeech('그가 낮게 말했다: "멈춰."')[0].npc, undefined, 'a sentence ending in 다 is narration');
  assert.equal(splitSpeech('촌장은 "밤마다 망치 소리가 난다." 하고 떨었다.')[0].npc, undefined);

  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock'] });
  await until(() => engine.c.phase === 'declare');
  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  engine.setPace('off');
  const c = engine.c, n = c.log.length;
  engine.gmSay({ type: 'narration', from: 'gm', text: '화살 한 대가 발치에 박힌다.\n뾰족귀: "내려가!"\n가운데 고블린: "산, 우리 거!"\n어떻게 하시겠습니까?' });
  const out = c.log.slice(n);
  assert.deepEqual(out.map((m) => [m.type, m.name || '', m.text]), [
    ['narration', '', '화살 한 대가 발치에 박힌다.'],
    ['npc', '뾰족귀', '내려가!'],
    ['npc', '가운데 고블린', '산, 우리 거!'],
    ['narration', '', '어떻게 하시겠습니까?'],
  ]);
  const P = await import('../lib/prompts.mjs');
  const text = P.formatLog(c, out, 'p1');
  assert.match(text, /NPC 뾰족귀\] "내려가!"/);
  assert.match(text, /NPC 가운데 고블린\] "산, 우리 거!"/, 'two NPCs are not merged');

  // A human GM can voice an NPC the same way.
  engine.c.userRole = 'gm';
  const m = c.log.length;
  engine.userPost('narration', '대장장이: "살려 줘…"');
  assert.equal(c.log[m].type, 'npc');
  assert.equal(c.log[m].name, '대장장이');
  engine.setPaused(true);
});

test('one at a time: each declaration is resolved before the next player speaks, and the GM picks who goes next', async () => {
  const { engine } = table();
  const asked = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    // Stop as round 2 begins (the stubs answer at once, so rounds fly by).
    if (kind === 'declare' && engine.c.round >= 2) engine.setPaused(true);
    if (kind === 'declare') return { ok: true, text: '{"action": "앞으로 나아갈게요"}' };
    if (kind !== 'adjudicate') return orig(seat, kind, brief, t, ctx);
    const c = engine.c;
    asked.push({ who: c.resolve.who, decls: ctx.decls.map((d) => d.key), turn: t });
    // Round 1: after p1, hand the turn to p3 (skipping p2).
    const next = c.round === 1 && c.resolve.who === 'p1' ? 'p3' : undefined;
    return { ok: true, text: JSON.stringify({ checks: [], narration: `${c.resolve.who}의 결과.`, next }) };
  };
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock', 'mock', 'mock'] });
  await until(() => engine.c.paused && engine.busy.size === 0);
  const c = engine.c;
  const r1 =c.log.filter((m) => m.round === 1 && (m.type === 'declare' || m.type === 'narration' || (m.type === 'system' && /지켜본다/.test(m.text))));
  const order = r1.map((m) => (m.type === 'narration' ? 'gm' : m.from));
  const actors = order.filter((k) => k !== 'gm');
  assert.deepEqual(actors, ['p1', 'p3', 'p2'], 'the GM handed the turn from p1 to p3');
  for (let i = 1; i < order.length; i++) if (order[i] !== 'gm' && order[i - 1] !== 'gm') assert.fail(`two players in a row: ${order.join(' ')}`);
  for (const a of asked.filter((x) => x.who)) assert.deepEqual(a.decls, [a.who], 'the GM sees one declaration at a time');
  assert.match(asked[0].turn, /\[p1\] .*의 차례/);
  assert.match(asked[0].turn, /"next": "다음 차례 캐릭터 키 \(p2, p3 중 하나\)/);
  assert.match(asked[2].turn, /마지막 차례/);
  assert.deepEqual(c.order, ['p2', 'p3', 'p1'], 'round 2 starts with the next seat');
});

test('a turn resolved without a roll posts its whispers once, after the narration', async () => {
  const { engine } = table();
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind === 'declare') { engine.setPaused(true); return { ok: true, text: '{"action": "고블린에게 말을 걸게요"}' }; }
    if (kind === 'adjudicate') return { ok: true, text: JSON.stringify({ checks: [], narration: '고블린이 물러섭니다.', whispers: [{ to: 'p1', text: '성표가 차갑게 식습니다.' }] }) };
    return orig(seat, kind, brief, t, ctx);
  };
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock'] });
  await until(() => engine.c.paused && engine.busy.size === 0);
  engine.setPaused(false);
  await until(() => engine.c.log.some((m) => m.type === 'narration' && m.text === '고블린이 물러섭니다.'));
  await until(() => engine.c.paused && engine.busy.size === 0);
  const log = engine.c.log;
  const w = log.filter((m) => m.type === 'whisper' && m.text === '성표가 차갑게 식습니다.');
  assert.equal(w.length, 1);
  assert.ok(log.indexOf(w[0]) > log.findIndex((m) => m.text === '고블린이 물러섭니다.'));
});

test('house rules: the campaign keeps what was picked (or the default), and the prompts say which are on', async () => {
  const P = await import('../lib/prompts.mjs');
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: 'x', userRole: 'spectator', players: ['mock'] });
  engine.setPaused(true);
  assert.deepEqual(engine.c.house, { fullDice: true }, 'on by default');
  assert.match(P.gmBrief(engine.c), /하우스 룰: 주사위 둘이 모두 6이면 풀다이스/);
  engine.newCampaign({ rules: 'dw', premise: 'x', userRole: 'spectator', players: ['mock'], house: { fullDice: false } });
  engine.setPaused(true);
  assert.deepEqual(engine.c.house, { fullDice: false });
  assert.doesNotMatch(P.gmBrief(engine.c), /풀다이스/);
  assert.doesNotMatch(P.playerBrief(engine.c, 'p1'), /풀다이스/);
  engine.newCampaign({ rules: 'd20', premise: 'x', userRole: 'spectator', players: ['mock'], house: { fullDice: true } });
  engine.setPaused(true);
  assert.deepEqual(engine.c.house, {}, 'a rule system without house rules has none');
});

test("a player's answer to the GM's question is kept apart and reaches the GM as one", async () => {
  const P = await import('../lib/prompts.mjs');
  const { engine } = table();
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind === 'declare') { engine.setPaused(true); return { ok: true, text: JSON.stringify({ answer: '제 첫 도끼를 벼려 준 분이에요.', say: '망치 내려놔.', action: '방패로 막아설게요' }) }; }
    return orig(seat, kind, brief, t, ctx);
  };
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock'] });
  await until(() => engine.c.paused && engine.busy.size === 0);
  const d = engine.c.log.find((m) => m.type === 'declare');
  assert.deepEqual([d.answer, d.say, d.action], ['제 첫 도끼를 벼려 준 분이에요.', '망치 내려놔.', '방패로 막아설게요']);
  assert.match(P.formatLog(engine.c, [d], null), /질문에 답: 제 첫 도끼를 벼려 준 분이에요\. \/ 말: "망치 내려놔\."/);
  assert.match(P.declareTurn(engine.c, 'p1'), /"answer": ""/);
  // The scene tab gets the known facts as data, and bonds come flagged so they can fold.
  const v = engine.view().campaign;
  assert.ok(Array.isArray(v.knownList) && v.knownList.every((f) => f.p && Array.isArray(f.args)));
  assert.ok(engine.c.log.filter((m) => m.text?.startsWith('🤝 ')).every((m) => m.bonds));
});

test("the story's opening question is put to each player until they answer it", async () => {
  const P = await import('../lib/prompts.mjs');
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock', 'mock'], openingAsk: '브론은 어떤 사람인가요?' });
  engine.setPaused(true);
  const c = engine.c;
  c.characters.p1 = engine.makeCharacter({ name: '하르', class: '전사' }, 'p1');
  c.characters.p2 = engine.makeCharacter({ name: '미르', class: '도적' }, 'p2');
  assert.match(P.declareTurn(c, 'p1'), /마스터가 처음에 모두에게 물은 질문에 너는 아직 답하지 않았다: "브론은 어떤 사람인가요\?"/);
  assert.match(P.declareTurn(c, 'p1'), /마스터가 하르에게 묻는다/);
  c.log.push({ id: c.nextId++, round: 1, type: 'declare', from: 'p1', answer: '내 칼을 벼려 준 사람', say: '', action: '' });
  assert.doesNotMatch(P.declareTurn(c, 'p1'), /아직 답하지 않았다/);
  assert.match(P.declareTurn(c, 'p2'), /아직 답하지 않았다/);
});

test('a boss has no HP: aimed rolls fill its hidden clock, phases turn at 3 and 6, and only a full clock fells it', async () => {
  const P = await import('../lib/prompts.mjs');
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '보스전', userRole: 'spectator', players: ['mock'] });
  engine.setPaused(true);
  const c = engine.c;
  c.foes = [];
  c.characters.p1 = engine.makeCharacter({ name: '하르', class: '전사', scores: { 근력: 16, 민첩성: 15, 체력: 13, 지능: 12, 지혜: 9, 매력: 8 } }, 'p1');
  engine.applyFoes([{ name: '잿심장', boss: true, clock: 8, hp: 30, damage: 'd10', note: '불의 거인' }]);
  const boss = engine.findFoe('잿심장');
  assert.deepEqual([boss.boss, boss.progress, boss.clock, boss.hp], [true, 0, 8, undefined]);

  const roll = (dice, extra = {}) => {
    setRng(scripted(dice));
    const [check] = engine.validChecks([{ who: 'p1', move: '접근전', target: '잿심장', ...extra }]);
    const r = engine.rollCheck(check);
    setRng(null);
    return r;
  };
  let r = roll([5, 5]); // 10 + 2: 성공 → 2칸; a damage move at the boss rolls no damage
  assert.equal(r.damage, undefined);
  assert.equal(boss.progress, 2);
  assert.ok(!c.log.some((m) => /잿심장 HP/.test(m.text || '')), 'no HP line for a boss');
  roll([3, 3]); // 6 + 2 = 8: 부분 성공 → 1칸, now 3/8: phase 2
  assert.equal(boss.progress, 3);
  assert.equal(boss.news, 'phase');
  assert.match(P.adjudicateTurn(c), /잿심장: 진행 3\/8 · 2단계[\s\S]*방금 2단계로 넘어갔다/);
  assert.doesNotMatch(P.declareTurn(c, 'p1'), /진행 3\/8/, 'players never see the clock');
  assert.match(P.declareTurn(c, 'p1'), /잿심장 \(보스\)/);

  // The GM can't fell it, remove it or end the story while its clock isn't full.
  c.resolve = { stage: 'results', who: 'p1', results: [] };
  engine.endTurn({ narration: '거인이 무너집니다.', facts: { assert: ['상태(잿심장, 쓰러짐)'] }, foes: [{ name: '잿심장', remove: true }], end: true });
  assert.notEqual(c.phase, 'ended');
  assert.ok(engine.findFoe('잿심장') && !boss.down);
  assert.ok(!new Ledger(c.facts).list.some((f) => f.p === '상태' && f.args[1] === '쓰러짐'));
  assert.ok((c.facts.rejected || []).some((x) => /보스다/.test(x.why)));
  assert.equal(boss.news, null, 'the phase was narrated');

  roll([1, 1], { against: '잿심장' }); // 2 + 2 = 4: 실패 → 0칸
  assert.equal(boss.progress, 3);
  roll([6, 6], { against: '잿심장' }); // 풀다이스 → 3칸: 6/8, phase 3
  assert.equal(boss.progress, 6);
  roll([5, 5]); // 성공 → 8/8
  assert.equal(boss.news, 'down');
  assert.match(P.adjudicateTurn(c), /진행이 다 찼다/);
  c.resolve = { stage: 'results', who: 'p1', results: [] };
  engine.endTurn({ narration: '심장이 깨집니다.' });
  assert.ok(boss.down);
  assert.ok(new Ledger(c.facts).list.some((f) => f.p === '상태' && f.args[0] === '잿심장' && f.args[1] === '쓰러짐'), 'its fall is a fact');

  // The table's view carries no clock; the secrets tab does.
  assert.equal(engine.view().campaign.foes[0].progress, undefined);
  assert.deepEqual(engine.secrets().bosses, [{ name: '잿심장', progress: 8, clock: 8, phase: 3, down: true }]);
});

test("rolls that leave a standing boss untouched are counted, and the GM is reminded to aim them", async () => {
  const P = await import('../lib/prompts.mjs');
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '보스전', userRole: 'spectator', players: ['mock'] });
  engine.setPaused(true);
  const c = engine.c;
  c.foes = [];
  c.characters.p1 = engine.makeCharacter({ name: '하르', class: '전사' }, 'p1');
  engine.applyFoes([{ name: '잿심장', boss: true }]);
  for (let i = 0; i < 4; i++) engine.rollCheck(engine.validChecks([{ who: 'p1', move: '위험 돌파', stat: '민첩성' }])[0]);
  assert.equal(c.bossDry, 4);
  assert.match(P.adjudicateTurn(c), /보스 진행 없이 판정이 4번 지났다/);
});

test("the premise goes to the GM, not into the players' log; what is only for the GM stays with the GM", async () => {
  const P = await import('../lib/prompts.mjs');
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '수문과 사슬로 약점을 드러내는 보스전', gmOnly: '심장은 브론의 망치로만 깨진다', userRole: 'spectator', players: ['mock'] });
  engine.setPaused(true);
  const c = engine.c;
  c.characters.p1 = engine.makeCharacter({ name: '하르', class: '전사' }, 'p1');
  assert.doesNotMatch(P.declareTurn(c, 'p1'), /수문과 사슬로/);
  assert.match(P.adjudicateTurn(c), /수문과 사슬로/);
  assert.match(P.gmBrief(c), /너만 아는 설정[^\n]*브론의 망치로만/);
  assert.doesNotMatch(P.playerBrief(c, 'p1') + P.declareTurn(c, 'p1'), /브론의 망치로만/);
});

test("a boss's clock is sized to the party, and a rule can't fell it before the clock fills", async () => {
  const { engine } = table();
  engine.newCampaign({ rules: 'dw', premise: '보스전', userRole: 'spectator', players: ['mock', 'mock', 'mock', 'mock'] });
  engine.setPaused(true);
  const c = engine.c;
  c.foes = [];
  engine.applyFoes([{ name: '녹쇠왕', boss: true, clock: 8 }]);
  const boss = engine.findFoe('녹쇠왕');
  assert.equal(boss.clock, 16, 'four players: 16 segments, whatever the GM wrote');

  // The GM's own clock and a rule that fells the boss when it fills: refused while the boss stands.
  engine.applyFacts({
    facts: { assert: ['시계(녹쇠왕 공략) = 7/8'] },
    rules: { add: [{ name: '쓰러짐', when: ['시계(녹쇠왕 공략) >= 8'], then: ['상태(녹쇠왕, 쓰러짐)'] }, { name: '결말', when: ['상태(녹쇠왕, 쓰러짐)'], ending: true }] },
  });
  engine.applyFacts({ facts: { assert: ['시계(녹쇠왕 공략) = +1'] } });
  const L = new Ledger(c.facts);
  assert.ok(!L.list.some((f) => f.p === '상태' && f.args[0] === '녹쇠왕' && f.args[1] === '쓰러짐'), 'the rule could not fell it');
  assert.ok(!L.triggered.some((t) => t.ending), 'so no ending fired');
  // Once the clock fills, the same fact goes through.
  boss.progress = boss.clock;
  boss.news = 'down';
  engine.settleBosses();
  assert.ok(new Ledger(c.facts).list.some((f) => f.p === '상태' && f.args[0] === '녹쇠왕' && f.args[1] === '쓰러짐'));
  assert.ok(new Ledger(c.facts).triggered.some((t) => t.ending));
});
