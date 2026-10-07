// Dice: parsing "2d6+1"-style expressions and ability checks. Every roll happens on the
// server (crypto RNG), never inside a model, so nobody at the table can fudge a result.

import crypto from 'node:crypto';

export const STATS = ['근력', '민첩', '체력', '지능', '감각', '매력'];
export const STAT_MIN = -1;
export const STAT_MAX = 3;
export const STAT_BUDGET = 4; // sum of the six modifiers for a starting character

// DC ladder the GM is told to use.
export const DC = { 쉬움: 8, 보통: 12, 어려움: 15, '매우 어려움': 18, '거의 불가능': 22 };

let rng = (sides) => crypto.randomInt(1, sides + 1);
// Tests swap the RNG for a scripted one.
export function setRng(fn) { rng = fn || ((sides) => crypto.randomInt(1, sides + 1)); }

export function die(sides) { return rng(sides); }

const TERM = /([+-]?)\s*(?:(\d*)d(\d+)(?:(kh|kl)(\d+))?|(\d+))/gi;

// "2d6+1", "d20", "4d6kh3", "1d8 + 2 - 1". Returns null on anything else.
export function parseDice(expr) {
  const src = String(expr || '').trim().toLowerCase().replace(/\s*([+-])\s*/g, '$1');
  if (!src || src.length > 40 || /\s/.test(src)) return null;
  const terms = [];
  let consumed = 0;
  TERM.lastIndex = 0;
  for (let m; (m = TERM.exec(src));) {
    if (m.index !== consumed) return null;
    if (!m[1] && terms.length) return null; // "2d6 3" without an operator
    consumed = m.index + m[0].length;
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] !== undefined) {
      terms.push({ sign, flat: Number(m[6]) });
    } else {
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      if (count < 1 || count > 50 || sides < 2 || sides > 1000) return null;
      const keep = m[4] ? { mode: m[4], n: Math.min(Number(m[5]), count) } : null;
      if (keep && keep.n < 1) return null;
      terms.push({ sign, count, sides, keep });
    }
    if (terms.length > 10) return null;
  }
  if (consumed !== src.length || !terms.length) return null;
  return terms;
}

export function rollDice(expr) {
  const terms = parseDice(expr);
  if (!terms) return null;
  let total = 0;
  const parts = [];
  for (const t of terms) {
    const op = t.sign < 0 ? '-' : (parts.length ? '+' : '');
    if (t.flat !== undefined) {
      total += t.sign * t.flat;
      parts.push(`${op}${t.flat}`);
      continue;
    }
    const rolls = Array.from({ length: t.count }, () => rng(t.sides));
    let kept = rolls;
    if (t.keep) {
      const sorted = [...rolls].sort((a, b) => (t.keep.mode === 'kh' ? b - a : a - b));
      kept = sorted.slice(0, t.keep.n);
    }
    const sum = kept.reduce((a, b) => a + b, 0);
    total += t.sign * sum;
    parts.push(`${op}[${rolls.join(',')}]${t.keep ? `${t.keep.mode}${t.keep.n}` : ''}`);
  }
  return { expr: String(expr).trim(), total, detail: parts.join(' ') };
}

export const clampStat = (v) => Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(Number(v) || 0)));
export const clampDc = (v) => Math.max(5, Math.min(30, Math.round(Number(v) || 12)));

// d20 + modifier against a DC. adv: 'advantage' | 'disadvantage' | undefined.
export function abilityCheck({ mod = 0, dc = 12, adv } = {}) {
  dc = clampDc(dc);
  const a = rng(20);
  const b = adv === 'advantage' || adv === 'disadvantage' ? rng(20) : null;
  const natural = b === null ? a : adv === 'advantage' ? Math.max(a, b) : Math.min(a, b);
  const total = natural + mod;
  let outcome;
  if (natural === 20) outcome = 'critical';
  else if (natural === 1) outcome = 'fumble';
  else outcome = total >= dc ? 'success' : 'failure';
  return { dice: b === null ? [a] : [a, b], natural, mod, total, dc, adv: b === null ? null : adv, outcome };
}

export const OUTCOME_LABEL = { critical: '대성공', success: '성공', failure: '실패', fumble: '대실패' };

// Bring any stat block into range and onto the point budget. Missing stats count as 0.
// Over budget: shave the highest stats first. Under budget: raise the lowest first.
export function normalizeStats(input = {}) {
  const s = {};
  for (const k of STATS) s[k] = clampStat(input[k]);
  let sum = STATS.reduce((a, k) => a + s[k], 0);
  while (sum > STAT_BUDGET) {
    const k = STATS.reduce((best, x) => (s[x] > s[best] ? x : best), STATS[0]);
    s[k]--; sum--;
  }
  while (sum < STAT_BUDGET) {
    const k = STATS.reduce((best, x) => (s[x] < s[best] ? x : best), STATS[0]);
    s[k]++; sum++;
  }
  return s;
}

export const maxHpFor = (stats) => 10 + 2 * (stats?.체력 || 0);
