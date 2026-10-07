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
  engine.newCampaign({ premise: '테스트 모험', userRole: 'spectator', players: ['mock', 'mock', 'mock'], targetRounds: 4 });
  await until(() => engine.c.phase === 'ended', 10000);
  const c = engine.c;
  assert.equal(Object.keys(c.characters).length, 3);
  assert.ok(c.round >= 4);
  assert.ok(c.log.some((m) => m.type === 'narration'));
  assert.ok(c.log.some((m) => m.type === 'declare'));
  for (const ch of Object.values(c.characters)) assert.ok(ch.hp >= 0 && ch.hp <= ch.maxHp);
  const v = engine.view();
  assert.ok(!('notes' in v.characters.p1), 'private notes stay out of the public view');
});

test('human player: GM waits for the declaration and the human rolls their own checks', async () => {
  const { engine } = table();
  engine.newCampaign({
    premise: '테스트', userRole: 'player', players: ['mock', 'mock'], targetRounds: 30,
    userChar: { name: '아린', concept: '견습 기사', stats: { 근력: 3, 민첩: 3 }, items: ['검'] },
  });
  assert.equal(engine.c.characters.user.name, '아린');
  await until(() => engine.c.phase === 'declare' && engine.c.declared.p1 && engine.c.declared.p2);
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
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock', 'mock', 'mock'], targetRounds: 5 });
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
    rules: 'dw', premise: '던전', userRole: 'player', players: ['mock'], targetRounds: 30,
    userChar: { name: '아린', class: '성기사', scores: { 근력: 15, 민첩: 8, 체력: 16, 지능: 9, 지혜: 13, 매력: 12 } },
  });
  await until(() => engine.c.phase === 'declare' && engine.c.declared.p1);
  const c = engine.c;
  assert.equal(c.characters.user.maxHp, 10 + 16);
  assert.ok(c.foes.length, 'opening registered a foe');

  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, ...rest) => (kind === 'adjudicate'
    ? { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '상황 파악' }, { who: 'p1', move: '난타전', target: '종탑의 그림자' }] }) }
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
  assert.ok(c.log.some((m) => m.choice && m.text.includes('무엇을 조심해야 하나?')));

  setRng(scripted([1, 1]));
  engine.applyEffects([{ who: 'user', hp: -99 }]);
  setRng(null);
  assert.equal(c.characters.user.hp, 0);
  const lb = c.log.filter((m) => m.type === 'roll').at(-1);
  assert.equal(lb.roll.move, '마지막 숨');
  assert.ok(c.characters.user.conditions.includes('사망'));
  engine.setPaused(true);
});

test('call of cthulhu: spectator campaign with combat, sanity and clues runs to the end', async () => {
  const { engine } = table();
  engine.newCampaign({ rules: 'coc7', premise: '항구 도시 실종 사건', userRole: 'spectator', players: ['mock', 'mock'], targetRounds: 6 });
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
    rules: 'coc7', premise: 'x', userRole: 'player', players: ['mock'], targetRounds: 30,
    userChar: { name: '오필리아', occupation: '간호사', stats: { 근력: 45, 건강: 60, 크기: 50, 민첩: 70, 외모: 60, 지능: 75, 정신: 65, 교육: 70 }, skills: '응급처치 60' },
  });
  await until(() => engine.c.phase === 'declare' && engine.c.declared.p1);
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
  engine.newCampaign({ premise: '장부 테스트', userRole: 'spectator', players: ['mock', 'mock'], targetRounds: 30 });
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
  engine.newCampaign({ premise: '단서 테스트', userRole: 'spectator', players: ['mock', 'mock'], targetRounds: 30 });
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
  engine.newCampaign({ premise: '규칙 테스트', userRole: 'spectator', players: ['mock'], targetRounds: 30 });
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
  engine.finishRound({ narration: '탑이 무너진다.', end: true });
  assert.equal(c.phase, 'ended');
  assert.equal(new Ledger(c.facts).triggered.length, 0, 'narrated, cleared');
  assert.ok(engine.secrets().rules.find((r) => r.name === '파국').fired.length);
});

test('clue paths: the GM sees each conclusion\'s paths and is warned once when one closes', async () => {
  const { engine } = table();
  engine.newCampaign({ premise: '단서 경로', userRole: 'spectator', players: ['mock', 'mock'], targetRounds: 30 });
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
