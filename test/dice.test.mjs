import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDice, rollDice, setRng } from '../lib/dice.mjs';
import { abilityCheck, normalizeStats } from '../lib/rules/d20.mjs';
import d20 from '../lib/rules/d20.mjs';

test('parseDice accepts common expressions and rejects junk', () => {
  for (const ok of ['d20', '2d6+1', '4d6kh3', '1d8 + 2 - 1', '3', '2d10kl1']) assert.ok(parseDice(ok), ok);
  for (const bad of ['', 'abc', '2d', 'd1', '2d6 3', '100d6', '2d6+', 'd20; rm -rf', '4d6kh0']) assert.equal(parseDice(bad), null, bad);
});

test('rollDice totals with scripted dice', () => {
  const seq = [3, 4, 6, 1, 5, 2];
  setRng(() => seq.shift());
  assert.equal(rollDice('2d6+1').total, 8);
  assert.equal(rollDice('4d6kh3').total, 6 + 5 + 2); // [6,1,5,2] keep highest 3
  setRng(null);
});

test('d20 abilityCheck outcomes, crits and advantage', () => {
  setRng(() => 20);
  assert.equal(abilityCheck({ mod: -1, dc: 30 }).outcome, 'critical');
  setRng(() => 1);
  assert.equal(abilityCheck({ mod: 3, dc: 2 }).outcome, 'fumble');
  const seq = [5, 17];
  setRng(() => seq.shift());
  const adv = abilityCheck({ mod: 2, dc: 15, adv: 'advantage' });
  assert.deepEqual([adv.natural, adv.total, adv.outcome], [17, 19, 'success']);
  const seq2 = [5, 17];
  setRng(() => seq2.shift());
  assert.equal(abilityCheck({ mod: 2, dc: 15, adv: 'disadvantage' }).outcome, 'failure');
  setRng(null);
});

test('d20 normalizeStats clamps and hits the budget', () => {
  for (const input of [{}, { 근력: 9, 민첩: 9, 체력: 9 }, { 근력: -5 }, { 지능: 3, 감각: 1 }]) {
    const s = normalizeStats(input);
    assert.equal(d20.STATS.reduce((a, k) => a + s[k], 0), 4);
    for (const k of d20.STATS) assert.ok(s[k] >= -1 && s[k] <= 3);
  }
  assert.deepEqual(normalizeStats({ 지능: 3, 감각: 1 }), { 근력: 0, 민첩: 0, 체력: 0, 지능: 3, 감각: 1, 매력: 0 });
});
