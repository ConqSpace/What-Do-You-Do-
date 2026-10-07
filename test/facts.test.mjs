import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, parseFact, formatFact, knows } from '../lib/facts.mjs';

const who = (x) => (['p1', 'p2', 'user'].includes(x) ? x : null);

test('parse and format, the last argument keeps commas', () => {
  assert.deepEqual(parseFact('위치(노라,  제3부두)'), { p: '위치', args: ['노라', '제3부두'] });
  assert.deepEqual(parseFact('비밀(말로우, 계약했다, 바다 밑 존재와)'), { p: '비밀', args: ['말로우', '계약했다, 바다 밑 존재와'] });
  assert.equal(formatFact(parseFact('시계(의식) = 2/6')), '시계(의식) = 2/6');
  assert.equal(parseFact('그냥 문장'), null);
});

test('unknown predicates, wrong arity and missing facts are refused with a reason', () => {
  const L = new Ledger({});
  const { rejected } = L.apply({ assert: ['날씨(맑음)', '위치(노라)'], retract: ['위치(없는사람, 어딘가)'], reveal: [{ fact: 'f99', to: 'all' }] });
  assert.equal(rejected.length, 4);
  const why = (op) => rejected.find((r) => r.op.includes(op)).why;
  assert.match(why('날씨'), /모르는 술어/);
  assert.match(why('위치(노라)'), /인자 개수/);
  assert.match(why('없는사람'), /없는 사실/);
  assert.match(why('f99'), /없는 사실/);
});

test('location and ownership are unique: a new fact replaces the old one', () => {
  const L = new Ledger({});
  L.apply({ assert: ['위치(노라, 제3부두)', '소유(헨리, 장부)'] });
  const { applied } = L.apply({ assert: ['위치(노라, 제3창고)', '소유(에드나, 장부)'] });
  assert.deepEqual(L.list.filter((f) => f.p === '위치').map(formatFact), ['위치(노라, 제3창고)']);
  assert.deepEqual(L.list.filter((f) => f.p === '소유').map(formatFact), ['소유(에드나, 장부)']);
  assert.ok(applied.some((a) => a.startsWith('~ 위치(노라, 제3부두)')));
});

test('clocks update in place and stop at their max', () => {
  const L = new Ledger({});
  L.apply({ assert: ['시계(의식) = 2/6'] });
  L.apply({ assert: ['시계(의식) = 9'] });
  const c = L.list.find((f) => f.p === '시계');
  assert.equal(c.value, 6);
  assert.equal(c.max, 6);
});

test('death is permanent', () => {
  const L = new Ledger({});
  L.apply({ assert: ['사망(톰)'] });
  const { rejected } = L.apply({ retract: ['사망(톰)'] });
  assert.match(rejected[0].why, /되돌릴 수 없/);
});

test('visibility: secret by default, told to some, revealed, only ever widened', () => {
  const L = new Ledger({});
  L.apply({ assert: ['비밀(말로우, 계약)', { fact: '단서(비늘, 은회색 비늘)', to: ['p1', '아무개'] }, { fact: '장소(부두, 제3부두)', to: 'all' }] }, { validWho: who });
  assert.deepEqual(L.visibleTo('p1').map((f) => f.p).sort(), ['단서', '장소']);
  assert.deepEqual(L.visibleTo('p2').map((f) => f.p), ['장소']);
  assert.equal(L.visibleTo('gm').length, 3);
  L.apply({ reveal: [{ fact: '단서(비늘, 은회색 비늘)', to: ['p2'] }] }, { validWho: who });
  assert.ok(knows(L.find('단서(비늘, 은회색 비늘)'), 'p2'));
  assert.ok(knows(L.find('단서(비늘, 은회색 비늘)'), 'p1'), 'p1 still knows');
  L.apply({ assert: [{ fact: '단서(비늘, 은회색 비늘)', to: 'all' }] }, { validWho: who });
  assert.equal(L.find('f2').known, 'all');
});
