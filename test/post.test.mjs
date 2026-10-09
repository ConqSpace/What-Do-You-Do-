// A player's message (lib/post.mjs): talk, "speech" and one @action in one go, and what the
// GM does with it on the player's turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backends } from '../lib/backends.mjs';
import { Store } from '../lib/store.mjs';
import { Engine } from '../lib/engine.mjs';
import { parsePost, partsOf, partsFromReply } from '../lib/post.mjs';
import { moveIn } from '../lib/rules/dw.mjs';
import * as P from '../lib/prompts.mjs';

function table(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wdyd-post-'));
  const cfg = { demo: true, mockDelayMs: 0, maxInFlight: 3, historyWindow: 40, declareMode: 'sequential', waitForUser: true, autoPauseRounds: 0, ...extra };
  return new Engine({ backends: new Backends(root, cfg), store: new Store(root), cfg });
}
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
// The demo bot answers at once, so a moment that passes (a round's "acted" marks) can come
// and go between two polls of until(). Stop the table the moment it gets there instead.
async function stopAt(engine, when) {
  if (engine.c && when(engine.c)) { engine.c.paused = true; return; }
  const changed = engine.changed;
  engine.changed = function () {
    if (this.c && when(this.c)) { this.c.paused = true; delete this.changed; }
    return changed.call(this);
  };
  await until(() => engine.c?.paused && when(engine.c));
}
const kinds = (text) => parsePost(text).parts.map((p) => `${p.k}:${p.text}`);

test('a message reads like a table log: own words, "speech", @action, in the order written', () => {
  assert.deepEqual(kinds('오 모르간 든든하다 ㅋㅋ\n@방패 뒤에 숨습니다'), ['talk:오 모르간 든든하다 ㅋㅋ', 'act:방패 뒤에 숨습니다']);
  assert.deepEqual(kinds('“시벨, 내 뒤로!”\n@방패를 치켜들고 시벨 앞을 막아섭니다'), ['say:시벨, 내 뒤로!', 'act:방패를 치켜들고 시벨 앞을 막아섭니다']);
  assert.deepEqual(kinds('시선 돌릴게요. “이쪽이다, 쇳덩이!”'), ['talk:시선 돌릴게요.', 'say:이쪽이다, 쇳덩이!']);
  // @ mid-line, a full-width ＠, speech inside the action line, words after the speech.
  assert.deepEqual(kinds('로발트: 뭐라고? 알에서 빛이 난다고? @와이번 알 가까이 갑니다.'), ['talk:로발트: 뭐라고? 알에서 빛이 난다고?', 'act:와이번 알 가까이 갑니다.']);
  assert.deepEqual(kinds('＠그림자에서 그림자로 다가갑니다'), ['act:그림자에서 그림자로 다가갑니다']);
  assert.deepEqual(kinds('@콧방귀를 뀌며 "이 나이쯤 되면 모르는게 없지." 지식 굴림 할게요'), ['act:콧방귀를 뀌며', 'say:이 나이쯤 되면 모르는게 없지.', 'talk:지식 굴림 할게요']);
  assert.deepEqual(kinds('"누구냐!"'), ['say:누구냐!']);
  assert.deepEqual(parsePost('[방어] @막아섭니다').move, '방어', 'a move chip');
  // Older saves read the same way.
  assert.deepEqual(partsOf({ type: 'declare', say: '비켜!', action: '달려들게요' }).map((p) => p.k), ['say', 'act']);
  assert.deepEqual(partsOf({ type: 'ooc', text: 'ㅋㅋ' }), [{ k: 'talk', text: 'ㅋㅋ' }]);
  // A model's reply: quotes left in the action are speech.
  assert.deepEqual(partsFromReply({ act: '"비켜!" 방패로 밀어붙입니다' }).parts.map((p) => p.k), ['say', 'act']);
  assert.equal(partsFromReply({ ask: '로발트가 누워 있나요?' }).ask, true);
});

test('a move named in passing is heard; plain words name none', () => {
  assert.equal(moveIn('지식 굴림 할게요', '마법사'), '지식 더듬기');
  assert.equal(moveIn('난투 할게요', '전사'), '접근전');
  assert.equal(moveIn('위기돌파 굴릴게요', '도적'), '위험 돌파');
  assert.equal(moveIn('방어구가 녹았어', '전사'), null);
  assert.equal(moveIn('와이번에게 매직 미사일을 써서 주의를 돌려 볼게요', '마법사'), null);
});

test("the human's turn: a question gets a short answer and the turn stays; banter passes quietly; the GM's move goes on the message, the roll under it", async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '와이번 둥지', userRole: 'player', players: ['mock'], userChar: { name: '티크', class: '도적' } });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user' && engine.busy.size === 0);
  const c = engine.c;
  const seen = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind !== 'adjudicate') return orig(seat, kind, brief, t, ctx);
    seen.push({ decls: ctx.decls, turn: t });
    if (seen.length === 1) return { ok: true, text: JSON.stringify({ hold: true, narration: '로발트는 일어서 있습니다.' }) };
    if (seen.length === 2) return { ok: true, text: JSON.stringify({ hold: true, narration: '' }) };
    return { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '위험 돌파', stat: '민첩성' }] }) };
  };
  const settled = (n) => () => seen.length === n && engine.busy.size === 0 && c.phase === 'declare';

  assert.equal(engine.userPost('declare', '로발트가 누워 있나요?'), null);
  await until(settled(1));
  assert.equal(c.turn, 'user', 'a question keeps the turn');
  assert.ok(c.log.some((m) => m.type === 'narration' && m.text === '로발트는 일어서 있습니다.'));
  assert.ok(seen[0].decls[0].ask);
  assert.match(seen[0].turn, /짧은 대답\("hold": true\)/);
  assert.match(seen[0].turn, /"hold": false/);
  assert.match(seen[0].turn, /티크\(도적\)의 직업 액션[^\n]*\n[^]*프로의 솜씨 \(\+민\): 자물쇠를 따거나/, 'the class moves, where the move is decided');

  const n = c.log.length;
  engine.userPost('declare', 'ㅋㅋ 영감 신발 어디 갔어');
  await until(settled(2));
  assert.equal(c.log.length, n + 1, 'the GM let it pass without a word');
  assert.deepEqual(seen[1].decls.map((d) => d.text), ['ㅋㅋ 영감 신발 어디 갔어'], 'the GM sees only what it has not answered');
  assert.equal(c.turn, 'user');

  engine.userPost('declare', '[접근전] "영감, 달려요!" @알을 끌어안고 입구로 달립니다');
  await until(settled(3));
  assert.match(seen[2].turn, /이미 두 번 답했다/, 'no third hold');
  assert.match(c.log.at(-1).text, /^접근전이 아니라 위험 돌파예요\. 민첩성\(\+\d\) 판정이 됩니다\. 그래도 하시겠어요\?$/, 'a changed move is still asked about');
  engine.userPost('declare', '네');
  await until(() => c.phase === 'roll');
  const msg = c.log.findLast((m) => m.type === 'player' && m.from === 'user' && m.parts.some((p) => p.k === 'act'));
  assert.equal(msg.move, '접근전');
  assert.deepEqual(msg.check, { move: '위험 돌파', was: '접근전' }, 'the GM changed the move');
  assert.match(P.formatLog(c, [msg], null), /\{부른 액션: 접근전 · 판정: 접근전 → 위험 돌파\}/);
  engine.backends.chat = orig;
  engine.userRollCheck(c.pendingChecks[0].id);
  const roll = c.log.findLast((m) => m.type === 'roll');
  assert.equal(roll.of, c.log.findLast((m) => m.type === 'player' && m.from === 'user').id, 'the roll goes under what they said last');
  await stopAt(engine, (c) => c.acted.user);
  await until(() => engine.busy.size === 0);

  // Off their turn, talk is just said; an @action waits for the next round.
  const calls = [];
  engine.backends.chat = async (seat, kind, ...rest) => { calls.push(kind); return orig(seat, kind, ...rest); };
  engine.userPost('declare', '다들 조심해');
  assert.ok(!c.log.at(-1).toGm);
  engine.userPost('declare', '@입구 쪽을 살핍니다');
  // Next round if their turn is over; first in line if a new round has begun meanwhile.
  assert.ok(c.log.at(-1).toGm && (c.log.at(-1).round === c.round + 1 || c.declared.user));
  assert.ok(!calls.includes('adjudicate'));
});

test('when the GM changes the move a player named, it asks first and rolls only once the player takes it', async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '용광로', userRole: 'player', players: ['mock'], userChar: { name: '오비드', class: '도적', scores: { 근력: 8, 민첩성: 16, 체력: 13, 지능: 15, 지혜: 9, 매력: 12 } } });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user' && engine.busy.size === 0);
  const c = engine.c;
  const seen = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind !== 'adjudicate') return orig(seat, kind, brief, t, ctx);
    seen.push(t);
    const ask = seen.length === 1 ? '거인이 이미 몸을 돌렸어요. 암습이 아니라 접근전이고, 근력으로 굴리게 됩니다. 하실 건가요?' : '';
    return { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '접근전', target: '거인' }], ask_change: ask }) };
  };
  engine.userPost('declare', '[암습] @거인 등의 틈에 단검을 찔러 넣습니다');
  await until(() => seen.length === 1 && engine.busy.size === 0 && c.phase === 'declare');
  assert.match(seen[0], /"confirm": "/);
  assert.ok(!c.log.some((m) => m.type === 'roll' && m.from === 'user'), 'no roll yet');
  assert.equal(c.log.at(-1).text, '거인이 이미 몸을 돌렸어요. 암습이 아니라 접근전이고, 근력으로 굴리게 됩니다. 하실 건가요?');
  assert.equal(c.turn, 'user');
  assert.equal(c.offered.user, '접근전');

  engine.userPost('declare', '네, 그래도 할게요');
  await until(() => c.phase === 'roll');
  assert.match(seen[1], /방금 굴리기 전에 물었다\(접근전\)/);
  const act = c.log.find((m) => m.type === 'player' && m.parts.some((p) => p.k === 'act'));
  assert.deepEqual(act.check, { move: '접근전', was: '암습' }, 'the gold border goes on the action, not on "네"');
  assert.equal(c.pendingChecks[0].of, c.log.findLast((m) => m.type === 'player' && m.from === 'user').id, 'the card goes under "네", in reading order');
  engine.setPaused(true);

  // No words from the GM: the server asks in plain words.
  const e2 = table();
  e2.newCampaign({ rules: 'dw', premise: '용광로', userRole: 'player', players: ['mock'], userChar: { name: '오비드', class: '도적', scores: { 근력: 8, 민첩성: 16, 체력: 13, 지능: 15, 지혜: 9, 매력: 12 } } });
  await until(() => e2.c.phase === 'declare' && e2.c.turn === 'user' && e2.busy.size === 0);
  const o2 = e2.backends.chat.bind(e2.backends);
  e2.backends.chat = async (seat, kind, ...rest) => (kind === 'adjudicate'
    ? { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '위험 돌파', stat: '근력' }] }) } : o2(seat, kind, ...rest));
  e2.userPost('declare', '[방어] @거인에게 돌진합니다');
  await until(() => e2.busy.size === 0 && e2.c.offered?.user);
  assert.equal(e2.c.log.at(-1).text, '방어가 아니라 위험 돌파예요. 근력(-1) 판정이 됩니다. 그래도 하시겠어요?');
  // A new action that names no move: whatever the GM picks is no change to ask about.
  e2.backends.chat = async (seat, kind, ...rest) => (kind === 'adjudicate'
    ? { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '프로의 솜씨' }] }) } : o2(seat, kind, ...rest));
  e2.userPost('declare', '아 그럼 안 할래요 @사슬 자물쇠를 따 봅니다');
  await until(() => e2.c.phase === 'roll');
  assert.deepEqual(e2.c.log.findLast((m) => m.type === 'player').check, { move: '프로의 솜씨' });
  e2.setPaused(true);
});

test('less put to the dice than the player said: the stake is told and asked about before the roll, and the human may take the roll back', async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '용광로', userRole: 'player', players: ['mock'], userChar: { name: '티크', class: '도적' } });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user' && engine.busy.size === 0);
  const c = engine.c;
  const seen = [];
  const stake = '끊긴 틈을 넘어 단상 끝에 닿는다. 목과 사슬은 그다음 일';
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind !== 'adjudicate') return orig(seat, kind, brief, t, ctx);
    seen.push(t);
    return { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '위험 돌파', stat: '민첩성', stake, trimmed: true }], confirm: seen.length === 1 ? '목을 베는 건 건너간 다음이에요. 먼저 끊긴 틈을 뛰어넘는 거고, 위험 돌파 민첩이에요. 할래요?' : '' }) };
  };
  engine.userPost('declare', '@다리를 건너 거인 목을 베고 사슬까지 끊습니다');
  await until(() => seen.length === 1 && engine.busy.size === 0 && c.phase === 'declare');
  assert.match(seen[0], /"stake": "걸린 것 한 문장/);
  assert.match(seen[0], /"trimmed": false/);
  assert.match(seen[0], /굴린 뒤에 걸린 것을 줄이면 테이블에서 싸움이 난다/);
  assert.equal(c.log.at(-1).text, '목을 베는 건 건너간 다음이에요. 먼저 끊긴 틈을 뛰어넘는 거고, 위험 돌파 민첩이에요. 할래요?');
  assert.ok(!c.pendingChecks.length && c.turn === 'user', 'asked, not rolled');

  engine.userPost('declare', '네');
  await until(() => c.phase === 'roll');
  assert.equal(c.pendingChecks[0].stake, stake, 'the roll sheet shows what is at stake');
  const act = c.log.find((m) => m.type === 'player' && m.parts.some((p) => p.k === 'act'));
  assert.equal(act.check.stake, stake);

  // "다르게 할래요": the roll is taken back and the turn is theirs again.
  engine.setPaused(true);
  assert.equal(engine.userRetract(), null);
  assert.equal(c.phase, 'declare');
  assert.equal(c.pendingChecks.length, 0);
  assert.equal(act.check, undefined);
  assert.match(c.log.at(-1).text, /판정을 무르고 다시 생각합니다/);
  assert.match(c.log.at(-1).text, /^티크는 /);
  assert.match(engine.userRetract(), /물릴 판정이 없어요/);

  // Narrating the roll, the GM is held to the stake.
  const turn = P.resultsTurn(c, [{ kind: 'check', who: 'user', move: '위험 돌파', stat: '민첩성', dice: [5, 5], mod: 2, total: 12, tier: 'good', label: '성공', stake }]);
  assert.match(turn, /걸린 것: 끊긴 틈을 넘어 단상 끝에 닿는다/);
  assert.match(turn, /성공이면 걸린 것을 깎지 말고 다 주고/);
});

test("an easy GM puts what was said to the dice whole and rolls without asking; the GM's temper can change mid-game", async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '용광로', userRole: 'player', players: ['mock'], userChar: { name: '티크', class: '도적' }, gmStyle: 'easy' });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user' && engine.busy.size === 0);
  const c = engine.c;
  assert.equal(engine.view().campaign.gmStyle, 'easy');
  assert.match(P.gmBrief(c), /마스터 성향: 너그럽게/);
  const seen = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind !== 'adjudicate') return orig(seat, kind, brief, t, ctx);
    seen.push(t);
    return { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '위험 돌파', stat: '민첩성', stake: '틈을 넘어 거인 목을 벤다', trimmed: true }], confirm: '정말요?' }) };
  };
  engine.userPost('declare', '[암습] @다리를 건너 거인 목을 벱니다');
  await until(() => c.phase === 'roll');
  assert.match(seen[0], /너그럽게: 플레이어가 말한 것을 될 수 있는 한 통째로 건다/);
  assert.doesNotMatch(seen[0], /"confirm"|"trimmed"/, 'nothing to ask with');
  assert.ok(!c.log.some((m) => m.text === '정말요?'), 'no question before the roll');
  assert.deepEqual(c.log.findLast((m) => m.type === 'player').check, { move: '위험 돌파', was: '암습', stake: '틈을 넘어 거인 목을 벤다' });
  engine.setPaused(true);

  assert.equal(engine.setGmStyle('strict'), null);
  assert.match(P.gmBrief(c), /마스터 성향: 깐깐하게/);
  assert.equal(engine.setGmStyle('lazy'), '모르는 성향이에요');
  engine.newCampaign({ rules: 'dw', premise: 'x', userRole: 'spectator', players: ['mock'] });
  engine.setPaused(true);
  assert.equal(engine.c.gmStyle, 'strict', 'strict unless picked');
});

test("an easy GM: one action is one roll, and it doesn't hold an acting player's turn to ask", async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '폐광', userRole: 'player', players: ['mock'], userChar: { name: '흑수염', class: '도적' }, gmStyle: 'easy' });
  await until(() => engine.c.phase === 'declare' && engine.c.turn === 'user' && engine.busy.size === 0);
  const c = engine.c;
  const brief = P.gmBrief(c);
  assert.match(brief, /거리와 앞을 막은 위험은 하려는 행동의 판정 하나에 접어 넣는다/);
  assert.doesNotMatch(brief, /장애를 넘는 판정을 요청해/, 'the strict reach rule is not in an easy brief');
  const seen = [];
  const orig = engine.backends.chat.bind(engine.backends);
  engine.backends.chat = async (seat, kind, b, t, ctx) => {
    if (kind !== 'adjudicate') return orig(seat, kind, b, t, ctx);
    seen.push(t);
    if (seen.length === 1) return { ok: true, text: JSON.stringify({ hold: true, narration: '근력이요, 민첩이요? 어느 쪽으로 하시겠습니까?' }) };
    return { ok: true, text: JSON.stringify({ checks: [{ who: 'user', move: '접근전', target: '뾰족귀', stake: '화살을 뚫고 달려가 뾰족귀를 걷어찬다' }] }) };
  };
  engine.userPost('declare', '@화살을 뚫고 달려가 뾰족귀를 발로 찬다');
  await until(() => c.phase === 'roll');
  assert.doesNotMatch(seen[0], /"hold": false|짧은 대답\("hold": true\)/, 'no hold offered to a player who acted');
  assert.match(seen[0], /행동을 선언했고 묻지 않았다/);
  assert.match(seen[0], /다가가는 판정과 치는 판정으로 나누지 마/);
  assert.match(seen[0], /"stake": "걸린 것 한 문장: 성공하면 무엇이 되는가/);
  assert.match(seen[1], /서버가 받지 않은 되묻기[^]*근력이요, 민첩이요/, 'the stray question goes back to the GM');
  assert.ok(!c.log.some((m) => /어느 쪽으로 하시겠습니까/.test(m.text || '')), 'the question never reached the table');
  assert.equal(c.pendingChecks[0].move, '접근전');
  engine.backends.chat = orig;
  engine.setPaused(true);

  // A strict GM keeps the reach rule and may still hold to answer.
  engine.setGmStyle('strict');
  assert.match(P.gmBrief(c), /장애를 넘는 판정을 요청해/);
});

test('a scene that runs long: the GM is pushed to close it, then told to cut; a new scene starts the count again', () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '폐광', userRole: 'spectator', players: ['mock'], length: 'short' });
  engine.setPaused(true);
  const c = engine.c;
  c.scene = { title: '입구 비탈의 화살', description: '' };
  const turn = () => P.adjudicateTurn(c);
  c.round = 2;
  assert.doesNotMatch(turn(), /장면 길이/);
  c.round = SCENE.short.push;
  assert.match(turn(), /장면 길이: "입구 비탈의 화살" 3라운드째\n- 이 장면은 할 만큼 했다/);
  c.round = SCENE.short.cut;
  assert.match(turn(), /⚠ 장면 길이: "입구 비탈의 화살" 5라운드째, 너무 길다/);
  assert.match(P.resultsTurn(c, []), /이번 결과로 이 장면을 끝내/, 'the narration is told too');
  c.resolve = { who: null, results: [] };
  engine.endTurn({ narration: '일행은 갱도 안으로 들어섭니다.', scene: { title: '굽은 갱도', description: '칠흑' } });
  assert.equal(c.sceneSince, SCENE.short.cut);
  assert.ok(P.sceneAge(c) <= 1, 'counted from the new scene');
  assert.doesNotMatch(turn(), /장면 길이/);
});

const SCENE = P.SCENE_ROUNDS;

test('AI players: a veteran names moves, a beginner leaves them to the GM; a move in their own words counts', async () => {
  const engine = table();
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock', 'mock'] });
  engine.setPaused(true);
  await until(() => engine.busy.size === 0);
  const c = engine.c;
  assert.deepEqual(c.seats.map((s) => s.skill), ['veteran', 'beginner'], 'alternating by default');
  c.characters.p1 = engine.makeCharacter({ name: '하르', class: '마법사' }, 'p1');
  c.characters.p2 = engine.makeCharacter({ name: '미르', class: '도적' }, 'p2');
  assert.match(P.declareTurn(c, 'p1'), /"move": ""/);
  assert.match(P.declareTurn(c, 'p1'), /"act": ""/);
  assert.doesNotMatch(P.declareTurn(c, 'p2'), /"move"/);
  assert.match(P.declareTurn(c, 'p2'), /이 룰이 아직 낯선/);
  engine.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock'], skills: ['beginner'] });
  engine.setPaused(true);
  assert.equal(engine.c.seats[0].skill, 'beginner');

  const e2 = table();
  const orig = e2.backends.chat.bind(e2.backends);
  e2.backends.chat = async (seat, kind, brief, t, ctx) => {
    if (kind === 'declare') { e2.setPaused(true); return { ok: true, text: JSON.stringify({ talk: '지식 굴림 할게요', act: '책에서 본 걸 떠올립니다' }) }; }
    return orig(seat, kind, brief, t, ctx);
  };
  e2.newCampaign({ rules: 'dw', premise: '던전', userRole: 'spectator', players: ['mock'] });
  await until(() => e2.c.paused && e2.busy.size === 0);
  const m = e2.c.log.find((x) => x.type === 'player');
  assert.equal(m.move, '지식 더듬기');
  assert.ok(m.toGm);
});
