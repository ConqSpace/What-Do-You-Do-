import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULESETS } from '../lib/rules/index.mjs';
import { ARCHETYPES } from '../public/archetypes.js';
import { builderInfo } from '../lib/builder.mjs';

// The genres of the premise 🎲 (RANDOM in public/app.js).
const GENRES = ['fantasy', 'dungeon', 'horror', 'cyberpunk', 'wuxia', 'school'];

test('every rule system has ready-made characters with unique ids and names to pick from', () => {
  const ids = new Set();
  for (const id of Object.keys(RULESETS)) {
    const list = ARCHETYPES[id];
    assert.ok(list?.length >= 4, `${id}: enough cards to deal a second hand`);
    for (const a of list) {
      assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
      ids.add(a.id);
      assert.ok(a.icon && a.title && a.concept && a.background, a.id);
      assert.ok((a.items?.length >= 2 || a.gear) && a.names.length >= 2, a.id);
    }
  }
});

test('Dungeon World cards keep their class, alignment and scores, and pick gear the class offers', () => {
  const meta = RULESETS.dw.meta();
  const classes = builderInfo('dw').classes;
  for (const a of ARCHETYPES.dw) {
    const groups = classes.find((c) => c.name === a.class).gear.groups;
    assert.equal(a.gear.length, groups.length, `${a.id}: one pick list per gear group`);
    a.gear.forEach((picks, gi) => {
      assert.equal(picks.length, groups[gi].pick, `${a.id}: ${groups[gi].label}`);
      assert.ok(picks.every((i) => groups[gi].options[i]), `${a.id}: ${groups[gi].label}`);
    });
    assert.ok(classes.find((c) => c.name === a.class).alignments.some((x) => x.name === a.alignment), `${a.id}: ${a.alignment}`);
    assert.deepEqual(Object.values(a.scores).sort((x, y) => y - x), meta.scores, `${a.id} uses each score once`);
    assert.deepEqual(Object.keys(a.scores).sort(), [...meta.stats].sort(), a.id);
    const ch = RULESETS.dw.makeCharacter(a);
    assert.equal(ch.class, a.class, a.id);
    assert.equal(ch.alignment, a.alignment, a.id);
    assert.deepEqual(ch.scores, a.scores, a.id);
  }
});

test('d20 cards are already on the point budget, and every genre has a full hand', () => {
  const meta = RULESETS.d20.meta();
  for (const a of ARCHETYPES.d20) {
    assert.ok(GENRES.includes(a.genre), `${a.id}: genre ${a.genre}`);
    assert.deepEqual(Object.keys(a.stats).sort(), [...meta.stats].sort(), a.id);
    assert.deepEqual(RULESETS.d20.makeCharacter(a).stats, a.stats, `${a.id} is unchanged by normalizing`);
  }
  for (const g of GENRES) assert.ok(ARCHETYPES.d20.filter((a) => a.genre === g).length >= 3, g);
});

test('Call of Cthulhu cards keep their characteristics, skills and weapons', () => {
  const coc = RULESETS.coc7;
  for (const a of ARCHETYPES.coc7) {
    assert.ok(coc.meta().fields[0].options.includes(a.occupation), `${a.id}: occupation ${a.occupation}`);
    const ch = coc.makeCharacter(a);
    assert.deepEqual(ch.chars, a.stats, a.id);
    for (const part of a.skills.split(',')) {
      const [, name, v] = part.trim().match(/^(.+?)\s+(\d+)$/);
      assert.ok(name in coc.SKILLS, `${a.id}: skill ${name}`);
      assert.equal(ch.skills[name], Number(v), `${a.id}: ${name} within the skill budget`);
    }
    assert.equal(ch.weapons.length, a.weapons?.length || 0, a.id);
  }
});
