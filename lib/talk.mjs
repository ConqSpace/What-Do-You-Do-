// Table talk: what the AI players say to each other between declarations, the way people
// around a real table do.
//
//   reaction  something notable happens (a 대실패, a 풀다이스, a miss streak, a miss that hurt a
//             teammate, a bold declaration) and another player says one OOC line about it; the
//             roller may answer back once. Side calls: they never hold up the GM or a turn.
//   huddle    a round that calls for a plan (a new scene, a boss that changed, a bad setback,
//             the GM asking everyone) opens with two to four lines between the players before
//             the first declaration. Bounded in lines and in time; the human's OOC during it is
//             read by the next speaker, and nobody waits for the human.
//
// This file decides when and who. lib/engine.mjs runs the calls, lib/prompts.mjs words them.

import { str } from './parse.mjs';

// How chatty the table is: the campaign's choice (header button), or config.chatter.
export const LEVELS = ['normal', 'low', 'off'];

// gap: turns between reactions to weaker moments · cooldown: turns before the same player
// reacts again · answerBack: chance the roller answers · huddleGap: rounds between huddles
// that only the GM's open question calls for · huddleOpen: does that question call one at all
// · huddleLines: most lines in a huddle (before the human joins) · weak: react to weaker moments.
export const TUNING = {
  normal: { gap: 2, cooldown: 2, answerBack: 0.5, huddleGap: 2, huddleOpen: true, huddleLines: 4, weak: true },
  low: { gap: 4, cooldown: 4, answerBack: 0, huddleGap: 4, huddleOpen: false, huddleLines: 2, weak: false },
};

const isMiss = (r) => r.tier === 'bad' || r.tier === 'fumble';

// What a roll that was just posted means to the table, or null. `log` already holds it.
// A 대실패 or 풀다이스 is always worth a word; misses in a row are, more so the third.
export function rollEvent(log, roll) {
  if (roll?.kind !== 'check') return null;
  if (roll.house === 'fumble' || roll.tier === 'fumble') return { kind: 'fumble', who: roll.who, strong: true };
  if (roll.house === 'crit' || roll.tier === 'crit') return { kind: 'crit', who: roll.who, strong: true };
  if (!isMiss(roll)) return null;
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i].roll;
    if (log[i].type !== 'roll' || r?.kind !== 'check' || r.who !== roll.who) continue;
    if (!isMiss(r)) break;
    n++;
  }
  return n >= 2 ? { kind: 'streak', who: roll.who, n, strong: n >= 3 } : null;
}

// A declaration worth a word: going at it on a sliver of HP, or straight at the boss.
export function declareEvent(ch, decl, bosses = []) {
  if (!ch || !decl?.action) return null;
  if (ch.maxHp && ch.hp > 0 && ch.hp <= ch.maxHp / 3) return { kind: 'bold', who: ch.key, why: `HP가 ${ch.hp}/${ch.maxHp}밖에 안 남았는데 움직인다` };
  const text = `${decl.say || ''} ${decl.action}`;
  const boss = bosses.find((b) => !b.down && b.name && text.includes(b.name));
  if (boss) return { kind: 'bold', who: ch.key, why: `${boss.name}에게 정면으로 덤빈다` };
  return null;
}

// One reaction a turn; a weaker moment also waits out the gap since the last one.
export function mayReact(t, ev, turnNo, tune) {
  if (!tune || t.reactedTurn === turnNo) return false;
  if (ev.strong) return true;
  return tune.weak && turnNo - (t.lastReactTurn ?? -99) >= tune.gap;
}

// Do these two characters share a bond (either way)?
export function bonded(chars, a, b) {
  const names = (k) => [k, chars[k]?.name].filter(Boolean);
  const toward = (x, y) => (chars[x]?.bonds || []).some((bd) => names(y).some((n) => bd.with === n || String(bd.text || '').includes(n)));
  return toward(a, b) || toward(b, a);
}

// Who reacts: an AI player other than the one it is about, out of cooldown; the one asked
// for (the teammate who got hurt) first, then someone with a bond to them.
export function pickReactor({ candidates, about, prefer, chars, lastBy = {}, turnNo, cooldown, rand = Math.random }) {
  const ok = candidates.filter((k) => k !== about && (lastBy[k] === undefined || turnNo - lastBy[k] >= cooldown));
  if (!ok.length) return null;
  if (prefer && ok.includes(prefer)) return prefer;
  const close = about ? ok.filter((k) => bonded(chars, k, about)) : [];
  const pool = close.length ? close : ok;
  return pool[Math.floor(rand() * pool.length)];
}

// The GM's last words put the question to everyone ("어떻게 하시겠습니까?" with no name in
// front, or "여러분"), not to one character.
export function asksEveryone(text, names = []) {
  const s = String(text || '').trim();
  const last = s.split(/(?<=[.!?…])\s+|\n+/).filter(Boolean).pop() || '';
  if (!/어떻게\s*하시겠|어떻게\s*할까요|무엇을\s*하시겠/.test(last)) return false;
  return /여러분|모두|다들/.test(last) || !names.some((n) => n && last.includes(n));
}

// Should this round open with a huddle, and why. pending: what happened since the last
// round (a new scene, a boss that changed, a setback). A changed boss always calls for one,
// a new scene too unless the talk is turned down; a setback or the GM's open question only
// after a few quiet rounds.
export function huddleReason({ pending = [], open = false, round, lastRound, tune }) {
  if (!tune) return null;
  const boss = pending.find((p) => p.kind === 'boss');
  if (boss) return boss;
  const quiet = round - (lastRound ?? -99) >= tune.huddleGap;
  const scene = pending.find((p) => p.kind === 'scene');
  if (scene && (tune.huddleOpen || quiet)) return scene;
  if (!quiet) return null;
  const setback = pending.find((p) => p.kind === 'setback');
  if (setback) return setback;
  return open && tune.huddleOpen ? { kind: 'open' } : null;
}

// Lines in a huddle: one more than there are AI speakers (so somebody answers), within the
// level's limit. A single AI player talks only to the human, so once.
export function huddleSize(aiCount, tune) {
  if (aiCount <= 1) return aiCount;
  return Math.max(2, Math.min(tune.huddleLines, aiCount + 1));
}

// The next to speak: whoever the reason is about first, then those who haven't spoken,
// never the same player twice in a row.
export function nextSpeaker(h, ai) {
  const last = h.spoken[h.spoken.length - 1];
  if (!h.spoken.length && h.first && ai.includes(h.first)) return h.first;
  const fresh = ai.filter((k) => !h.spoken.includes(k));
  return (fresh.length ? fresh : ai.filter((k) => k !== last))[0] || null;
}

// One line of talk out of a model's reply: the first line, without quotes around it.
export function cleanLine(x, max = 120) {
  return str(x, 400).split('\n')[0].replace(/^["“”'‘’「]+|["“”'‘’」]+$/g, '').trim().slice(0, max);
}
