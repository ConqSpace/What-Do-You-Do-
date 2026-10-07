// Full campaigns against the demo bot: no CLI, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backends } from '../lib/backends.mjs';
import { Store } from '../lib/store.mjs';
import { Engine } from '../lib/engine.mjs';

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
