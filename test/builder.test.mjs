import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builderInfo, QUICK_FIRE, POINT_BUY } from '../lib/builder.mjs';
import { RULESETS } from '../lib/rules/index.mjs';
import { parseDice } from '../lib/dice.mjs';

test('Dungeon World builder: every class has recommended scores, gear, looks and alignments', () => {
  const b = builderInfo('dw');
  assert.equal(b.classes.length, Object.keys(RULESETS.dw.CLASSES).length);
  const meta = RULESETS.dw.meta();
  for (const c of b.classes) {
    assert.deepEqual(Object.values(c.scores).sort((x, y) => y - x), meta.scores, `${c.name} uses each score once`);
    assert.ok(c.play && c.gear.groups.length, c.name);
    for (const g of c.gear.groups) assert.ok(g.options.length >= g.pick, `${c.name}: ${g.label}`);
    assert.ok(Object.values(c.looks).every((l) => l.length >= 2), c.name);
    assert.ok(c.names.length >= 5 && c.bonds.length >= 3, c.name);
    for (const a of c.alignments) assert.ok(meta.fields[1].options.includes(a.name), `${c.name}: ${a.name}`);
    assert.ok(c.moves.length, c.name);
  }
  assert.ok(b.stats.every((s) => s.help));
});

test('Call of Cthulhu builder: occupations use real skills, gear weapons parse', () => {
  const b = builderInfo('coc7');
  const occs = RULESETS.coc7.meta().fields[0].options;
  assert.deepEqual(b.occupations.map((o) => o.name).sort(), [...occs].sort());
  for (const o of b.occupations) {
    assert.equal(o.skills.length, 8, o.name);
    for (const s of o.skills) assert.ok(s in b.skills, `${o.name}: ${s}`);
    assert.ok(o.credit[0] <= o.credit[1] && o.keys.every((k) => RULESETS.coc7.STATS.includes(k)), o.name);
  }
  for (const s of b.personal) assert.ok(s in b.skills, s);
  for (const w of b.gear.weapons) assert.ok(parseDice(w.damage) && w.skill in b.skills, w.name);
  assert.equal(QUICK_FIRE.length, b.chars.length);
  assert.ok(QUICK_FIRE.reduce((a, v) => a + v, 0) <= POINT_BUY);
});

test('d20 builder: stat help and the point budget', () => {
  const b = builderInfo('d20');
  assert.equal(b.stats.length, 6);
  assert.equal(b.budget, 4);
  assert.ok(b.backstory.every((q) => q.chips.length));
});
