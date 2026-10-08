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
    assert.ok(c.gear.groups.length, c.name);
    for (const g of c.gear.groups) assert.ok(g.options.length >= g.pick, `${c.name}: ${g.label}`);
    assert.ok(Object.values(c.looks).every((l) => l.length >= 2), c.name);
    assert.ok(c.names.length >= 5 && c.bonds.length >= 3, c.name);
    for (const a of c.alignments) assert.ok(meta.fields[1].options.includes(a.name), `${c.name}: ${a.name}`);
    assert.ok(c.moves.length, c.name);
  }
  assert.ok(b.stats.every((s) => s.help));
});

// Choice cards: two lines that fit a phone, and a signature that is really in the rules.
const twoLines = (intro, who) => {
  assert.equal(intro?.length, 2, who);
  for (const l of intro) assert.ok(l.length <= 32, `${who}: "${l}" is too long for a card line`);
};

test('Dungeon World class cards: a signature only that class has', () => {
  const b = builderInfo('dw');
  const sigs = b.classes.map((c) => c.signature.name);
  assert.equal(new Set(sigs).size, sigs.length);
  for (const c of b.classes) {
    twoLines(c.intro, c.name);
    const own = [...c.moves.map((m) => m.name), ...c.passives.map((p) => p.split(':')[0])];
    assert.ok(own.includes(c.signature.name), `${c.name}: ${c.signature.name}`);
    const others = b.classes.filter((x) => x !== c).flatMap((x) => [...x.moves.map((m) => m.name), ...x.passives.map((p) => p.split(':')[0])]);
    assert.ok(!others.includes(c.signature.name), `${c.name}: another class has ${c.signature.name}`);
  }
});

test('Call of Cthulhu occupation cards: two of its own skills, no two leading with the same one', () => {
  const b = builderInfo('coc7');
  const leads = [];
  for (const o of b.occupations) {
    twoLines(o.intro, o.name);
    const skills = o.signature.name.split(' · ');
    for (const s of skills) assert.ok(o.skills.includes(s), `${o.name}: ${s}`);
    leads.push(skills[0]);
  }
  assert.equal(new Set(leads).size, leads.length);
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
