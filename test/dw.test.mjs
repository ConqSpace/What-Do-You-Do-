import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRng } from '../lib/dice.mjs';
import dw, { modOf, normalizeScores, effMod } from '../lib/rules/dw.mjs';

const script = (...seq) => setRng(() => { if (!seq.length) throw new Error('out of dice'); return seq.shift(); });
const sheet = (extra = {}) => ({ name: '아린', conditions: [], items: [], ...dw.makeCharacter({ class: '전사', scores: { 근력: 16, 민첩: 15, 체력: 13, 지능: 12, 지혜: 9, 매력: 8 } }), ...extra });

test('modifiers follow the Dungeon World table', () => {
  assert.deepEqual([3, 5, 8, 9, 12, 13, 15, 16, 17, 18].map(modOf), [-3, -2, -1, 0, 0, 1, 1, 2, 2, 3]);
});

test('scores are always the 16 15 13 12 9 8 array', () => {
  assert.deepEqual(normalizeScores({ 근력: 8, 민첩: 16, 체력: 15, 지능: 13, 지혜: 12, 매력: 9 }), { 근력: 8, 민첩: 16, 체력: 15, 지능: 13, 지혜: 12, 매력: 9 });
  const odd = normalizeScores({ 근력: 18, 민첩: 18, 지혜: 3 });
  assert.deepEqual(Object.values(odd).sort((a, b) => b - a), [16, 15, 13, 12, 9, 8]);
  assert.equal(odd.근력, 16);
  assert.equal(odd.민첩, 15);
});

test('character: class HP, armor, damage die', () => {
  const ch = sheet();
  assert.equal(ch.class, '전사');
  assert.equal(ch.maxHp, 10 + 13);
  assert.equal(ch.damage, 'd10');
  assert.equal(ch.armor, 1);
});

test('2d6 tiers, XP on a miss, forward is spent once', () => {
  const ch = sheet({ forward: 1 });
  script(5, 3); // 8 + 근력+2 + forward 1 = 11
  let r = dw.resolveCheck({ move: '위험에 맞서기', stat: '근력', bonus: 0 }, ch);
  assert.equal(r.total, 11);
  assert.equal(r.tier, 'good');
  assert.equal(ch.forward, 0);
  script(2, 3); // 5 + 2 = 7
  r = dw.resolveCheck({ move: '위험에 맞서기', stat: '근력', bonus: 0 }, ch);
  assert.equal(r.tier, 'mixed');
  script(1, 2); // 3 - 1 (매력 8) = 2
  r = dw.resolveCheck({ move: '담판', stat: '매력', bonus: 0 }, ch);
  assert.equal(r.tier, 'bad');
  assert.equal(ch.xp, 1);
  setRng(null);
});

test('debility lowers the modifier', () => {
  const ch = sheet();
  assert.equal(effMod(ch, '근력'), 2);
  dw.applyEffect({ debilities_add: ['쇠약'] }, ch);
  assert.equal(effMod(ch, '근력'), 1);
});

test('hack and slash rolls the class damage die; volley 7-9 offers a choice that can cut damage', () => {
  const ch = sheet();
  script(6, 6, 7); // 12+2, damage d10 → 7
  const r = dw.resolveCheck({ move: '난타전', stat: '근력', target: '고블린', bonus: 0 }, ch);
  assert.equal(r.damage.total, 7);
  assert.equal(r.damage.target, '고블린');
  assert.equal(dw.followUp(r, ch), null);

  script(3, 3, 9, 4); // 6 + 민첩+1 = 7 → mixed, damage 9; then -1d6 = 4
  const v = dw.resolveCheck({ move: '일제 사격', stat: '민첩', target: '고블린', bonus: 0 }, ch);
  const fu = dw.followUp(v, ch);
  assert.equal(fu.count, 1);
  dw.applyChoice(v, [2], ch);
  assert.deepEqual(v.chosen, ['피해 -1d6']);
  assert.equal(v.damage.total, 5);
  setRng(null);
});

test('discern realities: 3 questions on 10+, 1 on 7-9', () => {
  const ch = sheet();
  script(6, 5);
  assert.equal(dw.followUp(dw.resolveCheck({ move: '상황 파악', stat: '지혜', bonus: 0 }, ch), ch).count, 3);
  script(4, 4);
  assert.equal(dw.followUp(dw.resolveCheck({ move: '상황 파악', stat: '지혜', bonus: 0 }, ch), ch).count, 1);
  setRng(null);
});

test('normalizeCheck: fixed stats, class moves, defy danger keeps the GM stat', () => {
  const ch = sheet();
  assert.deepEqual(dw.normalizeCheck({ move: '난타전', stat: '매력' }, ch).stat, '근력');
  assert.equal(dw.normalizeCheck({ move: '위험에 맞서기', stat: '체력' }, ch).stat, '체력');
  assert.equal(dw.normalizeCheck({ move: '굽히거나 부수기' }, ch).move, '굽히거나 부수기');
  assert.equal(dw.normalizeCheck({ move: '헛소리' }, ch).move, '위험에 맞서기');
  const cmd = dw.commandCheck(['위험에', '맞서기', '민첩'], ch);
  assert.equal(cmd.move, '위험에 맞서기');
  assert.equal(cmd.stat, '민첩');
});

test('aid adds the number of bonds with the target', () => {
  const ch = sheet({ bonds: [{ with: 'p2', text: '미라는 내 등을 지켜 주었다' }, { with: 'p2', text: '미라를 믿을 수 없다' }] });
  script(3, 3);
  const r = dw.resolveCheck({ move: '돕기/방해하기', stat: '유대', target: 'p2', bonus: 0 }, ch, { characters: { p2: { name: '미라' } } });
  assert.equal(r.mod, 2);
  setRng(null);
});

test('last breath on going down', () => {
  const ch = sheet();
  script(2, 2);
  const r = dw.onDown(ch);
  assert.equal(r.move, '마지막 숨');
  assert.ok(ch.conditions.includes('사망'));
  assert.equal(ch.xp, 0, 'no XP for last breath');
  setRng(null);
});
