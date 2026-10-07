import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../lib/facts.mjs';

const players = ['p1', 'p2'];
const ctx = { round: 1, players, validWho: (x) => (players.includes(x) ? x : null) };

function scenario() {
  const L = new Ledger({});
  L.apply({ assert: [
    '결론(범인, 말로우가 인부들을 제물로 바친다)',
    '근거(범인, 장부)', '근거(범인, 비늘)', '근거(범인, 케인 증언)',
    '단서(장부, 실종자 모두 야간 하역 인부)', '단서(비늘, 배수구의 은회색 비늘)', '단서(케인 증언, 노래는 돌에서 나온다)',
    '출처(장부, 제7창고)', '출처(비늘, 배수구)', '출처(케인 증언, 녹슨 닻 술집)',
    '결론(장소, 의식은 종바위 동굴에서 열린다)', '근거(장소, 지도)',
  ] }, ctx);
  return L;
}
const of = (L, name) => L.analyzeClues(players).find((a) => a.name === name);

test('statuses: known, open, lost, missing; three-clue rule', () => {
  const L = scenario();
  L.apply({ reveal: [{ fact: '단서(장부)', to: ['p1'] }], assert: ['상태(케인 증언, 소실)'] }, ctx);
  const a = of(L, '범인');
  assert.deepEqual(a.support.map((s) => [s.clue, s.status]), [['장부', 'known'], ['비늘', 'open'], ['케인 증언', 'lost']]);
  assert.deepEqual(a.support[0].who, ['p1']);
  assert.deepEqual(a.support[1].sources, ['배수구']);
  assert.deepEqual([a.known, a.open, a.lost, a.need, a.deducible, a.blocked, a.thin], [1, 1, 1, 2, false, false, false]);
  const b = of(L, '장소');
  assert.equal(b.support[0].status, 'missing');
  assert.equal(b.thin, true);
  assert.equal(b.blocked, true, 'a clue that does not exist is no path');
});

test('deducible with two supporting clues; blocked when what is left cannot reach two', () => {
  const L = scenario();
  L.apply({ reveal: [{ fact: '단서(장부)', to: ['p1'] }, { fact: '단서(비늘)', to: ['p2'] }] }, ctx);
  assert.equal(of(L, '범인').deducible, true, 'two clues between the party is enough');
  const M = scenario();
  M.apply({ assert: ['상태(장부, 소실)', '상태(비늘, 파괴)'] }, ctx);
  assert.equal(of(M, '범인').blocked, true);
  M.apply({ assert: ['단서(일기, 크레인의 일기)', '근거(범인, 일기)', '출처(일기, 박물관)'] }, ctx);
  assert.equal(of(M, '범인').blocked, false, 'a new path reopens it');
});

test('rule conditions on conclusions', () => {
  const L = scenario();
  L.setRules({ add: [
    { name: '진실 폭로', when: ['추론가능(범인)'], ending: true },
    { name: '길이 끊겼다', when: ['막힘(범인)'], note: '새 단서가 필요' },
  ] });
  assert.equal(L.runRules(ctx).length, 0);
  L.apply({ assert: ['상태(장부, 소실)', '상태(비늘, 소실)'] }, ctx);
  assert.deepEqual(L.runRules(ctx).map((f) => f.rule.name), ['길이 끊겼다']);
  const M = scenario();
  M.setRules({ add: [{ name: '진실 폭로', when: ['추론가능(범인)'], ending: true }] });
  M.apply({ reveal: [{ fact: '단서(장부)', to: 'all' }, { fact: '단서(비늘)', to: ['p1'] }] }, ctx);
  assert.equal(M.runRules(ctx)[0].rule.ending, true);
});
