import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORIES, STORY_ROWS, STARTS, LENGTH, DANGER_TYPES, DOOM_TYPES } from '../public/stories.js';

// The premise 🎲's genres (RANDOM in public/app.js).
const GENRES = ['fantasy', 'dungeon', 'horror', 'cyberpunk', 'wuxia', 'school'];
// Stock literary phrases nobody says out loud (see the selection-card-copy skill).
const STIFF = ['입을 닫', '에 다름 아니', '그 어느 때보다', '것은 언제나'];
const sentences = (t) => t.split(/(?<=[.?!])\s+/).filter(Boolean);

test('gallery stories: a situation, questions and a first scene for the players', () => {
  const ids = new Set(STARTS.map((s) => s.id));
  for (const [rules, list] of Object.entries(STORIES)) {
    assert.ok(list.length >= 2 && list.length <= 3, `${rules}: a few stories, not a catalog`);
    for (const s of list) {
      assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
      ids.add(s.id);
      assert.ok(s.icon && s.title && s.kind && s.tone, s.id);
      assert.ok(STORY_ROWS[s.row], `${s.id}: row ${s.row}`);
      assert.ok(GENRES.includes(s.genre), `${s.id}: genre ${s.genre}`);
      assert.ok(LENGTH[s.length], `${s.id}: length ${s.length}`);
      const n = sentences(s.situation).length;
      assert.ok(n <= 2 && s.situation.length <= 80, `${s.id}: the situation is two short sentences (${n}, ${s.situation.length} chars)`);
      assert.equal(s.questions.length, 2, `${s.id}: two questions`);
      for (const q of s.questions) assert.match(q, /\?$/, `${s.id}: "${q}" is a question`);
      assert.ok(s.scene?.title && s.scene.text.length <= 60 && s.scene.ask, `${s.id}: a short first scene with something to ask (${s.scene?.text.length} chars)`);
      assert.equal(s.tags.length, 2, `${s.id}: two tags`);
      for (const t of [s.situation, s.scene.text, s.scene.ask, ...s.questions]) {
        for (const w of STIFF) assert.ok(!t.includes(w), `${s.id}: "${w}"`);
      }
    }
  }
});

// One danger is one threat clock: a story sized for one sitting.
test('Dungeon World stories bring a front, not a plot', () => {
  for (const s of STORIES.dw) {
    const f = s.front;
    assert.equal(f.dangers.length, 1, `${s.id}: one danger`);
    for (const d of f.dangers) {
      assert.ok(DANGER_TYPES.includes(d.type), `${s.id}: ${d.name} is a ${d.type}`);
      assert.ok(d.motive && d.portents.length === 2, `${s.id}: ${d.name} has a motive and two portents`);
      assert.ok(d.doom.text && DOOM_TYPES.includes(d.doom.type), `${s.id}: ${d.name}'s doom`);
    }
    assert.ok(f.cast.length === 2 && f.blank, `${s.id}: two in the cast and something left blank`);
  }
});
