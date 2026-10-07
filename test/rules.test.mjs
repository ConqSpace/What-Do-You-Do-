import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, parseCond, formatFact } from '../lib/facts.mjs';

const ctx = (round = 1) => ({ round, players: ['p1', 'p2'], validWho: (x) => (['p1', 'p2'].includes(x) ? x : null) });
const has = (L, text) => L.list.some((f) => formatFact(f) === text);

test('conditions parse', () => {
  assert.deepEqual(parseCond('시계(의식) >= 6'), { kind: 'clock', name: '의식', op: '>=', n: 6, neg: false });
  assert.deepEqual(parseCond('not 사망(노라)'), { kind: 'fact', p: '사망', args: ['노라'], neg: true });
  assert.equal(parseCond('라운드 > 3').kind, 'round');
  assert.equal(parseCond('안다(누군가, 단서(장부))').kind, 'knows');
  assert.equal(parseCond('날씨(비)'), null);
  assert.equal(parseCond('아무 말'), null);
});

test('a clock trigger fires once, chains into the next rule, and relative clocks add up', () => {
  const L = new Ledger({});
  L.apply({ assert: ['시계(의식) = 4/6'] });
  L.setRules({ add: [
    { name: '의식 시작', when: ['시계(의식) >= 6'], then: ['사건(의식, 종바위에서 의식이 시작된다)'] },
    { name: '부름', when: ['사건(의식)'], then: ['상태(노라, 홀림)'], note: '노라가 바다로 걷는다' },
  ] });
  assert.equal(L.runRules(ctx()).length, 0);
  L.apply({ assert: ['시계(의식) = +2'] });
  const fired = L.runRules(ctx());
  assert.deepEqual(fired.map((f) => f.rule.name), ['의식 시작', '부름']);
  assert.ok(has(L, '상태(노라, 홀림)'));
  assert.equal(L.triggered.length, 2);
  assert.equal(L.runRules(ctx(2)).length, 0, 'fires once');
});

test('variables bind across conditions and fill the result; negation filters', () => {
  const L = new Ledger({});
  L.apply({ assert: ['위치(톰, 동굴)', '위치(노라, 동굴)', '위치(샘, 부두)', '사망(톰)'] });
  L.setRules({ add: [{ name: '동굴의 산 자', when: ['위치(?누구, 동굴)', 'not 사망(?누구)'], then: ['상태(?누구, 홀림)'] }] });
  L.runRules(ctx());
  assert.ok(has(L, '상태(노라, 홀림)'));
  assert.ok(!has(L, '상태(톰, 홀림)'));
  assert.ok(!has(L, '상태(샘, 홀림)'));
});

test('repeat rules fire once per round; "-" retracts', () => {
  const L = new Ledger({});
  L.apply({ assert: ['시계(밤) = 0/10', '상태(부두, 조용함)'] });
  L.setRules({ add: [{ name: '밤이 깊어 간다', when: ['라운드 >= 1'], then: ['시계(밤) = +1', '-상태(부두, 조용함)'], repeat: true }] });
  L.runRules(ctx(1));
  L.runRules(ctx(1));
  assert.equal(L.clockValue('밤'), 1, 'once in round 1');
  L.runRules(ctx(2));
  assert.equal(L.clockValue('밤'), 2);
  assert.ok(!has(L, '상태(부두, 조용함)'));
});

test('knowledge conditions: someone, everyone, a variable', () => {
  const L = new Ledger({});
  L.apply({ assert: [{ fact: '단서(장부, 실종자 명단)', to: ['p1'] }] }, ctx());
  L.setRules({ add: [
    { name: '누군가 앎', when: ['안다(누군가, 단서(장부))'], note: '말로우가 눈치챈다' },
    { name: '모두 앎', when: ['안다(모두, 단서(장부))'], note: '다 같이 안다' },
    { name: '표적', when: ['안다(?pc, 단서(장부))'], then: ['상태(?pc, 미행당함)'] },
  ] });
  assert.deepEqual(L.runRules(ctx()).map((f) => f.rule.name).sort(), ['누군가 앎', '표적']);
  assert.ok(has(L, '상태(p1, 미행당함)'));
  L.apply({ reveal: [{ fact: '단서(장부)', to: 'all' }] }, ctx());
  assert.ok(L.runRules(ctx()).some((f) => f.rule.name === '모두 앎'));
});

test('bad rules are refused with a reason; condition truth is reported', () => {
  const L = new Ledger({});
  const { rejected } = L.setRules({ add: [
    { name: '변수 누락', when: ['사망(노라)'], then: ['상태(?누구, 슬픔)'] },
    { name: '모르는 조건', when: ['날씨(비)'], then: ['사건(비, 비가 온다)'] },
    { name: '할 일 없음', when: ['사망(노라)'] },
    { when: ['사망(노라)'], then: ['사건(x, y)'] },
  ] });
  assert.equal(rejected.length, 4);
  assert.match(rejected[0].why, /묶이지 않았/);
  assert.match(rejected[1].why, /조건을 못 읽/);
  L.apply({ assert: ['시계(의식) = 2/6'] });
  L.setRules({ add: [{ name: '결말', when: ['시계(의식) >= 6', 'not 사망(노라)'], ending: true }] });
  assert.deepEqual(L.condTruth(L.rules[0], ctx()).map((t) => [t.ok, t.now]), [[false, 2], [true, undefined]]);
});

test('a periodic rule: every other round', () => {
  const L = new Ledger({});
  L.apply({ assert: ['시계(의식) = 0/6'] });
  L.setRules({ add: [{ name: '시간이 흐른다', when: ['라운드 % 2 == 0'], then: ['시계(의식) = +1'], repeat: true }] });
  L.runRules(ctx(0));
  assert.equal(L.clockValue('의식'), 0, 'nothing during prep (round 0)');
  for (let r = 1; r <= 6; r++) L.runRules(ctx(r));
  assert.equal(L.clockValue('의식'), 3);
});
