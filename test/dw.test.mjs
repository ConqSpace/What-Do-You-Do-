import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRng } from '../lib/dice.mjs';
import dw, { modOf, normalizeScores, effMod, fillBond } from '../lib/rules/dw.mjs';

const script = (...seq) => setRng(() => { if (!seq.length) throw new Error('out of dice'); return seq.shift(); });
const sheet = (extra = {}, cls = '전사') => ({ name: '아린', conditions: [], items: [], ...dw.makeCharacter({ class: cls, scores: { 근력: 16, 민첩성: 15, 체력: 13, 지능: 12, 지혜: 9, 매력: 8 } }), ...extra });

test('modifiers follow the Dungeon World table', () => {
  assert.deepEqual([3, 5, 8, 9, 12, 13, 15, 16, 17, 18].map(modOf), [-3, -2, -1, 0, 0, 1, 1, 2, 2, 3]);
});

test('scores are always the 16 15 13 12 9 8 array', () => {
  assert.deepEqual(normalizeScores({ 근력: 8, 민첩성: 16, 체력: 15, 지능: 13, 지혜: 12, 매력: 9 }), { 근력: 8, 민첩성: 16, 체력: 15, 지능: 13, 지혜: 12, 매력: 9 });
  const odd = normalizeScores({ 근력: 18, 민첩성: 18, 지혜: 3 });
  assert.deepEqual(Object.values(odd).sort((a, b) => b - a), [16, 15, 13, 12, 9, 8]);
  assert.equal(odd.근력, 16);
  assert.equal(odd.민첩성, 15);
  assert.equal(normalizeScores({ 근력: 8, 민첩: 16, 체력: 15, 지능: 13, 지혜: 12, 매력: 9 }).민첩성, 16, 'old key 민첩 still reads');
});

test('character: class HP, armor, damage die; the builder can set armor from gear', () => {
  const ch = sheet();
  assert.equal(ch.class, '전사');
  assert.equal(ch.maxHp, 10 + 13);
  assert.equal(ch.damage, 'd10');
  assert.equal(ch.armor, 1);
  assert.equal(dw.makeCharacter({ class: '전사', armor: 3 }).armor, 3);
  assert.equal(dw.makeCharacter({ class: '도둑', alignment: '법' }).class, '도적', 'old class names still read');
  assert.equal(dw.makeCharacter({ class: '성기사', alignment: '법' }).alignment, '질서');
});

test('2d6 tiers, XP on a miss, the next-roll bonus is spent once', () => {
  const ch = sheet({ forward: 1 });
  script(5, 3); // 8 + 근력+2 + 1 = 11
  let r = dw.resolveCheck({ move: '위험 돌파', stat: '근력', bonus: 0 }, ch);
  assert.equal(r.total, 11);
  assert.equal(r.tier, 'good');
  assert.equal(ch.forward, 0);
  assert.equal(r.title, '위험 돌파 +근');
  script(2, 3); // 5 + 2 = 7
  r = dw.resolveCheck({ move: '위험 돌파', stat: '근력', bonus: 0 }, ch);
  assert.equal(r.tier, 'mixed');
  script(1, 2); // 3 - 1 (매력 8) = 2
  r = dw.resolveCheck({ move: '협상', stat: '매력', bonus: 0 }, ch);
  assert.equal(r.tier, 'bad');
  assert.equal(ch.xp, 1);
  setRng(null);
});

test('debilities follow the Korean edition: 무기력 lowers +근', () => {
  const ch = sheet();
  assert.equal(effMod(ch, '근력'), 2);
  dw.applyEffect({ debilities_add: ['무기력'] }, ch);
  assert.equal(effMod(ch, '근력'), 1);
  dw.applyEffect({ debilities_add: ['민첩성'] }, ch);
  assert.deepEqual(ch.debilities, ['무기력', '경련'], 'a stat name maps to its debility');
});

test('접근전 rolls the class damage die; 사격 7-9 offers a choice that can cut damage', () => {
  const ch = sheet();
  script(6, 6, 7); // 12+2, damage d10 → 7
  const r = dw.resolveCheck({ move: '접근전', stat: '근력', target: '고블린', bonus: 0 }, ch);
  assert.equal(r.damage.total, 7);
  assert.equal(r.damage.target, '고블린');
  assert.equal(dw.followUp(r, ch), null);

  script(3, 3, 9, 4); // 6 + 민첩성+1 = 7 → mixed, damage 9; then -1d6 = 4
  const v = dw.resolveCheck({ move: '사격', stat: '민첩성', target: '고블린', bonus: 0 }, ch);
  const fu = dw.followUp(v, ch);
  assert.equal(fu.count, 1);
  dw.applyChoice(v, [1], ch);
  assert.deepEqual(v.chosen, ['악조건에서 쏜다: 피해 -1d6']);
  assert.equal(v.damage.total, 5);
  setRng(null);
});

test('암습 deals damage only when that option is picked; 정조준 hurts only on 10+', () => {
  const thief = sheet({}, '도적');
  script(6, 6, 5, 3); // 12 → pick 2; damage d8 → 5, +1d6 → 3
  const r = dw.resolveCheck({ move: '암습', stat: '민첩성', target: '경비병', bonus: 0 }, thief);
  assert.equal(r.damage, null);
  dw.applyChoice(r, [0, 1], thief);
  assert.equal(r.damage.total, 8);
  assert.equal(r.damage.target, '경비병');

  const ranger = sheet({}, '사냥꾼');
  script(3, 3); // 6 + 1 = 7 → mixed, no damage
  assert.equal(dw.resolveCheck({ move: '정조준', stat: '민첩성', target: '오크', bonus: 0 }, ranger).damage, null);
  script(5, 5, 6);
  assert.equal(dw.resolveCheck({ move: '정조준', stat: '민첩성', target: '오크', bonus: 0 }, ranger).damage.total, 6);
  setRng(null);
});

test('상황 파악: 3 questions on 10+, 1 on 7-9; 변신 holds even on a miss', () => {
  const ch = sheet();
  script(6, 5);
  assert.equal(dw.followUp(dw.resolveCheck({ move: '상황 파악', stat: '지혜', bonus: 0 }, ch), ch).count, 3);
  script(4, 4);
  assert.equal(dw.followUp(dw.resolveCheck({ move: '상황 파악', stat: '지혜', bonus: 0 }, ch), ch).count, 1);
  const druid = sheet({}, '드루이드');
  script(1, 1);
  const r = dw.resolveCheck({ move: '변신', stat: '지혜', bonus: 0 }, druid);
  assert.equal(r.tier, 'bad');
  assert.equal(druid.hold, 1);
  assert.match(r.text, /예비 1/);
  setRng(null);
});

test('normalizeCheck: fixed stats, class moves, 위험 돌파 keeps the stat; +민 and 민 read as 민첩성', () => {
  const ch = sheet();
  assert.deepEqual(dw.normalizeCheck({ move: '접근전', stat: '매력' }, ch).stat, '근력');
  assert.equal(dw.normalizeCheck({ move: '위험 돌파', stat: '체력' }, ch).stat, '체력');
  assert.equal(dw.normalizeCheck({ move: '위험 돌파', stat: '+민' }, ch).stat, '민첩성');
  assert.equal(dw.normalizeCheck({ move: '창살을 굽히고 문을 들어올린다' }, ch).move, '창살을 굽히고 문을 들어올린다');
  assert.equal(dw.normalizeCheck({ move: '헛소리' }, ch).move, '위험 돌파');
  const cmd = dw.commandCheck(['위험', '돌파', '민첩성'], ch);
  assert.equal(cmd.move, '위험 돌파');
  assert.equal(cmd.stat, '민첩성');
});

test('협조 또는 방해 adds the number of 인연 with the target', () => {
  const ch = sheet({ bonds: [{ with: 'p2', text: '미라는 내게 목숨빚을 졌다.' }, { with: 'p2', text: '나는 미라를 지키기로 맹세했다.' }] });
  script(3, 3);
  const r = dw.resolveCheck({ move: '협조 또는 방해', stat: '인연', target: 'p2', bonus: 0 }, ch, { characters: { p2: { name: '미라' } } });
  assert.equal(r.mod, 2);
  setRng(null);
});

test('황천길 on going down', () => {
  const ch = sheet();
  script(2, 2);
  const r = dw.onDown(ch);
  assert.equal(r.move, '황천길');
  assert.ok(ch.conditions.includes('사망'));
  assert.equal(ch.xp, 0, 'no XP for 황천길');
  setRng(null);
});

test('인연 blanks take the name with the right particle', () => {
  assert.equal(fillBond('___는 여리다.', '카엘'), '카엘은 여리다.');
  assert.equal(fillBond('나는 ___를 지키기로 맹세했다.', '티나'), '나는 티나를 지키기로 맹세했다.');
  assert.equal(fillBond('___가 던전에서 살아남지 못할까 봐 걱정된다.', '그레고르'), '그레고르가 던전에서 살아남지 못할까 봐 걱정된다.');
  assert.equal(fillBond('___와 나는 같이 꾸미는 일이 있다.', '폭스'), '폭스와 나는 같이 꾸미는 일이 있다.');
  for (const [cls, list] of Object.entries(dw.BONDS)) {
    assert.ok(dw.CLASSES[cls] && list.length >= 3, cls);
    for (const t of list) assert.match(t, /_{3}/, `${cls}: ${t}`);
  }
});

test('a sheet saved with the old words is renamed on load', () => {
  const old = { class: '도둑', alignment: '법', scores: { 근력: 8, 민첩: 16, 체력: 12, 지능: 13, 지혜: 9, 매력: 15 }, debilities: ['쇠약', '떨림'] };
  dw.migrate(old);
  assert.equal(old.class, '도적');
  assert.equal(old.alignment, '질서');
  assert.equal(old.scores.민첩성, 16);
  assert.equal(old.stats.민첩성, 2);
  assert.deepEqual(old.debilities, ['무기력', '경련']);
});
