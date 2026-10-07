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
  assert.deepEqual(splitDeclaration('"여기서 기다려." 카엘은 문을 살핀다'), { say: '여기서 기다려.', action: '카엘은 문을 살핀다' });
  assert.deepEqual(splitDeclaration('문을 연다'), { say: '', action: '문을 연다' });
  assert.deepEqual(splitDeclaration('“누구냐!”'), { say: '누구냐!', action: '' });
});
