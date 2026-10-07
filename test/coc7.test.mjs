import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setRng } from '../lib/dice.mjs';
import coc, { d100, levelOf, dbBuild } from '../lib/rules/coc7.mjs';

// die(10) returns 1..10; the d100 code maps it to 0..9 (units) and 0..90 (tens).
afterEach(() => setRng(null));

const script = (...seq) => setRng(() => { if (!seq.length) throw new Error('out of dice'); return seq.shift(); });
const D = (n) => (n % 10) + 1; // a die(10) face that yields digit n
const roll = (value) => [D(value % 10), D(Math.floor((value % 100) / 10))]; // units first, then tens
const make = () => ({
  name: '오필리아', conditions: [], items: [],
  ...coc.makeCharacter({ characteristics: { 근력: 45, 건강: 60, 크기: 50, 민첩: 70, 외모: 60, 지능: 75, 정신: 65, 교육: 70 }, luck: 55,
    occupation: '간호사', skills: '응급처치 60, 관찰력 55, 근접전(격투) 40', weapons: [{ name: '칼', skill: '근접전', damage: '1d4', impale: true }] }),
});

test('success levels and fumbles', () => {
  assert.equal(levelOf(1, 40), 'critical');
  assert.equal(levelOf(8, 40), 'extreme');
  assert.equal(levelOf(20, 40), 'hard');
  assert.equal(levelOf(40, 40), 'regular');
  assert.equal(levelOf(41, 40), 'fail');
  assert.equal(levelOf(96, 40), 'fumble');
  assert.equal(levelOf(96, 60), 'fail');
  assert.equal(levelOf(100, 60), 'fumble');
});

test('d100: 00+0 is 100, bonus takes the lower tens, penalty the higher', () => {
  script(D(0), D(0));
  assert.equal(d100().value, 100);
  script(D(3), D(7), D(1)); // units 3, tens 70 and 10
  assert.equal(d100({ bonus: 1 }).value, 13);
  script(D(3), D(7), D(1));
  assert.equal(d100({ penalty: 1 }).value, 73);
  script(D(3), D(7));
  assert.equal(d100({ bonus: 1, penalty: 1 }).value, 73, 'they cancel');
  setRng(null);
});

test('character: derived values, skill budget, damage bonus', () => {
  const ch = make();
  assert.equal(ch.maxHp, 11);
  assert.equal(ch.san, 65);
  assert.equal(ch.mp, 13);
  assert.equal(ch.skills.회피, 35);
  assert.equal(ch.skills['언어(모국어)'], 70);
  assert.equal(ch.skills.응급처치, 60);
  assert.equal(ch.db, '0');
  assert.deepEqual(dbBuild(170), { db: '1d6', build: 2 });
  const greedy = coc.makeCharacter({ characteristics: { 지능: 50, 교육: 50 }, skills: Object.fromEntries(Object.keys(coc.SKILLS).map((k) => [k, 80])) });
  const spent = Object.keys(coc.SKILLS).reduce((a, k) => a + greedy.skills[k], 0) - Object.keys(coc.SKILLS).reduce((a, k) => a + coc.makeCharacter({ characteristics: { 지능: 50, 교육: 50 } }).skills[k], 0);
  assert.ok(spent <= 50 * 4 + 50 * 2, `budget kept (${spent})`);
  assert.equal(greedy.skills['크툴루 신화'], 0);
});

test('skill check with difficulty, then luck or push', () => {
  const ch = make();
  script(...roll(41));
  const r = coc.resolveCheck(coc.normalizeCheck({ skill: '응급처치', difficulty: 'hard', push_risk: '경비가 깬다' }, ch), ch);
  assert.equal(r.level, 'regular');
  assert.equal(r.pass, false, 'regular is not enough for hard');
  const fu = coc.followUp(r, ch);
  assert.match(fu.options[0], /행운 11/);
  coc.applyChoice(r, [0], ch, {});
  assert.equal(ch.luck, 44);
  assert.equal(r.pass, true);

  ch.luck = 10;
  script(...roll(77));
  const r2 = coc.resolveCheck(coc.normalizeCheck({ skill: '관찰력' }, ch), ch);
  const fu2 = coc.followUp(r2, ch);
  assert.equal(fu2.options.length, 2, 'costs 22 Luck, only 10 left: push or accept');
  setRng(null);
});

test('push returns a reroll; a pushed roll gets no follow-up', () => {
  const ch = make();
  script(...roll(90));
  const r = coc.resolveCheck(coc.normalizeCheck({ skill: '관찰력' }, ch), ch);
  const fu = coc.followUp(r, ch);
  const push = fu.options.findIndex((o) => o.startsWith('밀어붙'));
  const res = coc.applyChoice(r, [push], ch, { text: '등불을 바짝 대고 다시 본다' });
  assert.equal(res.reroll.pushed, true);
  script(...roll(88));
  const again = coc.resolveCheck(res.reroll, ch);
  assert.equal(again.pass, false);
  assert.equal(coc.followUp(again, ch), null);
  setRng(null);
});

test('sanity: loss, INT roll for temporary insanity, daily limit', () => {
  const ch = make();
  script(...roll(80), 6, ...roll(30)); // fail SAN 65, lose 1d6=6, INT roll 30 ≤ 75
  const r = coc.resolveCheck(coc.normalizeCheck({ type: 'sanity', loss: '1/1d6' }, ch), ch);
  assert.equal(r.loss, 6);
  assert.equal(ch.san, 59);
  assert.ok(ch.conditions.includes('일시적 광기'));
  script(...roll(90), 8, ...roll(90)); // fail, lose 8 → INT roll 90 > 75: suppressed
  coc.resolveCheck(coc.normalizeCheck({ type: 'sanity', loss: '0/1d10' }, ch), ch);
  assert.ok(ch.conditions.includes('무기한 광기'), '14 lost today ≥ 65/5');
  setRng(null);
});

test('combat: dodge wins ties, fight back loses them, extreme damage maxes out', () => {
  const ch = make();
  const ctx = { foes: [{ name: '구울', hp: 13, armor: 0, damage: '1d6+1d4', attack: 40, dodge: 20 }] };
  // attack vs dodge: both regular → dodge wins
  script(...roll(35), ...roll(15));
  let r = coc.resolveCheck(coc.normalizeCheck({ type: 'attack', skill: '근접전', target: '구울', response: 'dodge' }, ch), ch, ctx);
  assert.equal(r.pass, false);
  // extreme success with an impaling knife vs a failed dodge: max 1d4 (4) + second roll 3
  script(...roll(5), ...roll(60), 3);
  r = coc.resolveCheck(coc.normalizeCheck({ type: 'attack', skill: '근접전', weapon: '칼', target: '구울', response: 'dodge' }, ch), ch, ctx);
  assert.equal(r.pass, true);
  assert.equal(r.damage.total, 7);
  // defend by fighting back: tie → the ghoul hits; selfDamage rolled
  script(...roll(30), ...roll(30), 4, 2);
  r = coc.resolveCheck(coc.normalizeCheck({ type: 'defend', vs: '구울', response: 'fight_back' }, ch), ch, ctx);
  assert.equal(r.selfDamage.total, 6);
  // dodge, both regular: dodge wins
  script(...roll(30), ...roll(30));
  r = coc.resolveCheck(coc.normalizeCheck({ type: 'defend', vs: '구울', response: 'dodge' }, ch), ch, ctx);
  assert.equal(r.selfDamage, undefined);
  setRng(null);
});

test('major wound and dying', () => {
  const ch = make();
  assert.deepEqual(coc.onDamage(ch, 6), ['중상']);
  ch.hp = 0;
  coc.onDown(ch);
  assert.ok(ch.conditions.includes('빈사'));
});

test('development raises ticked skills', () => {
  const ch = make();
  script(...roll(70));
  coc.resolveCheck(coc.normalizeCheck({ skill: '듣기' }, ch), ch); // 70 > 20: fail, no tick
  script(...roll(10));
  coc.resolveCheck(coc.normalizeCheck({ skill: '듣기' }, ch), ch); // success → tick
  assert.deepEqual(ch.ticks, ['듣기']);
  script(...roll(50), 7);
  const bits = coc.applyEffect({ development: true }, ch);
  assert.equal(ch.skills.듣기, 27);
  assert.ok(bits.includes('듣기 +7'));
  setRng(null);
});

test('aliases and commands', () => {
  const ch = make();
  assert.equal(coc.normalizeCheck({ skill: '아이디어' }, ch).skill, '지능');
  assert.equal(coc.normalizeCheck({ skill: '권총' }, ch).skill, '사격(권총)');
  assert.equal(coc.commandCheck(['관찰력', '어려움', '보너스'], ch).difficulty, 'hard');
  assert.equal(coc.commandCheck(['이성', '1/1d6'], ch).type, 'sanity');
});

test('push_risk does not repeat the label the prompt already adds', () => {
  const ch = make();
  assert.equal(coc.normalizeCheck({ skill: '설득', push_risk: '밀어붙였다 실패하면: 밀어붙였다 실패하면: 노라가 뛰어든다' }, ch).push_risk, '노라가 뛰어든다');
});
