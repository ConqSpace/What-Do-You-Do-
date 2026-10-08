import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../lib/parse.mjs';
import { splitDeclaration } from '../lib/engine.mjs';

test('extractJson finds the object inside chatter and fences', () => {
  assert.deepEqual(extractJson('```json\n{"say": "안녕 {괄호}", "n": 1}\n```'), { say: '안녕 {괄호}', n: 1 });
  assert.deepEqual(extractJson('좋아, 이렇게 할게: {"a": {"b": 2}} 끝'), { a: { b: 2 } });
  assert.deepEqual(extractJson('{bad} 그리고 {"ok": true}'), { ok: true });
  assert.equal(extractJson('JSON 없음'), null);
  assert.equal(extractJson('[1,2]'), null);
});

test('splitDeclaration separates quoted speech from action', () => {
  assert.deepEqual(splitDeclaration('"여기서 기다려." 카엘은 문을 살핀다'), { say: '여기서 기다려.', action: '카엘은 문을 살핀다', move: '' });
  assert.deepEqual(splitDeclaration('[상황 파악] 카엘은 주위를 살핀다'), { say: '', action: '카엘은 주위를 살핀다', move: '상황 파악' });
  assert.deepEqual(splitDeclaration('문을 연다'), { say: '', action: '문을 연다', move: '' });
  assert.deepEqual(splitDeclaration('“누구냐!”'), { say: '누구냐!', action: '', move: '' });
});

test('fixJosa: particles after a name follow its last syllable; other names are left alone', async () => {
  const { fixJosa } = await import('../lib/parse.mjs');
  assert.equal(fixJosa('나는 세린를 지킨다. 도윤가 걱정된다. 미르은 여리다. 하르과 나.', ['세린', '도윤', '미르', '하르']),
    '나는 세린을 지킨다. 도윤이 걱정된다. 미르는 여리다. 하르와 나.');
  assert.equal(fixJosa('미르이다. 도윤이 왔다. 세린아!', ['미르', '도윤', '세린']), '미르이다. 도윤이 왔다. 세린아!', 'not a particle');
  assert.equal(fixJosa('마스터이 묻는다', ['마스터']), '마스터가 묻는다');
  assert.equal(fixJosa('GM이 묻는다', ['GM']), 'GM이 묻는다');
});
