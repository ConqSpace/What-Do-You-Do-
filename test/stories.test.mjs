import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORIES, STORY_ROWS, STARTS, LENGTH } from '../public/stories.js';

// The premise 🎲's genres (RANDOM in public/app.js).
const GENRES = ['fantasy', 'dungeon', 'horror', 'cyberpunk', 'wuxia', 'school'];
// Stock literary phrases nobody says out loud (see the selection-card-copy skill).
const STIFF = ['입을 닫', '에 다름 아니', '그 어느 때보다', '것은 언제나'];
const sentences = (t) => t.split(/(?<=[.?!])\s+/).filter(Boolean);

test('gallery stories: the Netflix shape, filled in for the GM', () => {
  const ids = new Set(STARTS.map((s) => s.id));
  for (const [rules, list] of Object.entries(STORIES)) {
    assert.ok(list.length >= 6, `${rules}: enough stories for a gallery`);
    for (const s of list) {
      assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
      ids.add(s.id);
      assert.ok(s.icon && s.title && s.kind, s.id);
      assert.ok(STORY_ROWS[s.row], `${s.id}: row ${s.row}`);
      assert.ok(GENRES.includes(s.genre), `${s.id}: genre ${s.genre}`);
      assert.ok(LENGTH[s.length], `${s.id}: length ${s.length}`);
      const n = sentences(s.synopsis).length;
      assert.ok(n >= 3 && n <= 5 && s.synopsis.length <= 170, `${s.id}: synopsis is 3-5 short sentences (${n}, ${s.synopsis.length} chars)`);
      assert.ok(s.episode?.title && s.episode.text.length <= 100, `${s.id}: first episode`);
      assert.equal(s.tags.length, 4, `${s.id}: four tags`);
      assert.ok(s.premise && s.tone, `${s.id}: what the GM gets`);
      for (const t of [s.synopsis, s.episode.text, s.premise]) {
        for (const w of STIFF) assert.ok(!t.includes(w), `${s.id}: "${w}"`);
      }
    }
  }
});
