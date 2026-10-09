// The playtest director's note: read by the GM on its next story turn, then gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backends } from '../lib/backends.mjs';
import { Store } from '../lib/store.mjs';
import { Engine } from '../lib/engine.mjs';

async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("a director's note rides on the GM's next story turn only, and the table never sees it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdyd-director-'));
  const cfg = { demo: true, mockDelayMs: 0, maxInFlight: 3, historyWindow: 40, declareMode: 'sequential', waitForUser: true, autoPauseRounds: 0 };
  const engine = new Engine({ backends: new Backends(root, cfg), store: new Store(root), cfg });
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'player', players: ['mock'], userChar: { name: '흑수염', class: '도적' } });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user' && engine.busy.size === 0);

  const turns = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, turn, ctx) => { turns.push({ seat: seat.key, kind, turn }); return orig(seat, kind, brief, turn, ctx); };

  assert.equal(engine.direct('입구는 끝내고 소굴로 넘겨'), null);
  assert.equal(engine.direct('흑수염에게 치료약을 하나 줘'), null);
  assert.equal(engine.c.director, '입구는 끝내고 소굴로 넘겨\n흑수염에게 치료약을 하나 줘', 'notes add up until read');
  assert.doesNotMatch(JSON.stringify(engine.view()), /소굴로 넘겨/, 'not in the view');

  engine.userPost('declare', '@문을 엽니다');
  await until(() => turns.some((t) => t.seat === 'gm') && !engine.c.director);
  const first = turns.find((t) => t.seat === 'gm');
  assert.match(first.turn, /## 방장 지시 \(최우선\)[^]*입구는 끝내고 소굴로 넘겨\n흑수염에게 치료약을 하나 줘$/);
  assert.ok(!engine.c.log.some((m) => /소굴로 넘겨/.test(m.text || '')), 'not in the log');

  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  await engine.callJson(engine.c.gm, 'results', '', '다음 차례', {});
  assert.doesNotMatch(turns.at(-1).turn, /방장 지시/, 'spent after one read');
  assert.ok(turns.filter((t) => t.seat !== 'gm').every((t) => !/방장 지시/.test(t.turn)), 'players never get it');

  assert.equal(engine.direct('하나 더'), null);
  assert.equal(engine.direct(''), null);
  assert.equal(engine.c.director, '', 'an empty note clears');
  engine.setPaused(true);
});
