// Dice: parsing and rolling "2d6+1"-style expressions. Every roll happens on the server
// (crypto RNG), never inside a model, so nobody at the table can fudge a result. Rule
// systems (lib/rules/) build their checks on top of die() and rollDice().

import crypto from 'node:crypto';

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
