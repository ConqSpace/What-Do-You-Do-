// A player's message: what one player says at the table in one go, the way people write in an
// online session. Any mix, in the order written:
//
//   talk  plain text: the player talking as themselves ("야 시벨 또 정면이야? ㅋㅋ",
//         "로발트가 누워 있나요?", "지식 굴림 할게요")
//   say   "quoted": the character's words, heard by everyone in the scene
//   act   a line starting with @: what the character tries. Intent only; how it goes is the
//         GM's. One a message (the GM trims a second one)
//
// Stored as { type: 'player', from, parts: [{ k: 'talk'|'say'|'act', text }], move?, ask?,
// check?, chat? }: move is a move the player named, check the move the GM put it to (with
// `was` when the GM changed the player's), chat marks a reaction (lib/talk.mjs). Older saves
// hold `declare` (say/action/move/answer/line), `ooc` (talk) and `talk` (speech) lines; partsOf
// reads them all the same way.

import { str } from './parse.mjs';

const QUOTE = /["“”「『]([^"“”」』]+)["“”」』]/g;
const AT = /[@＠]/;
// A piece between quotes that is only punctuation ("…", ".") is no part of its own.
const filler = (s) => !/[\p{L}\p{N}]/u.test(s);

// Splits text at quotes: [{ k: 'say' | 'text', text }].
function quotes(text) {
  const out = [];
  let i = 0;
  for (const m of text.matchAll(QUOTE)) {
    if (m.index > i) out.push({ k: 'text', text: text.slice(i, m.index) });
    out.push({ k: 'say', text: m[1].trim() });
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push({ k: 'text', text: text.slice(i) });
  return out.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text && (p.k === 'say' || !filler(p.text)));
}

// "[방어] 오 든든하다 ㅋㅋ\n“시벨, 내 뒤로!” @방패를 치켜듭니다" → { parts, move }.
// A leading [액션] names a move (the composer's move chips). On a line, what follows @ is the
// action up to its first quote; quotes are speech; text after the speech is talk again.
export function parsePost(text) {
  let move = '';
  let s = String(text || '');
  const tag = s.match(/^\s*\[([^\]]{1,30})\]\s*/);
  if (tag) { move = tag[1].trim(); s = s.slice(tag[0].length); }
  const parts = [];
  let line = 0;
  const push = (k, t) => {
    const last = parts[parts.length - 1];
    // Talk on one line stays one part; a new line starts a new one (see `line` below).
    if (k === 'talk' && last?.k === 'talk' && last.line === line) last.text = `${last.text} ${t}`;
    else parts.push({ k, text: t, line });
  };
  for (const raw of s.split('\n')) {
    line++;
    const at = raw.search(AT);
    const before = at < 0 ? raw : raw.slice(0, at);
    for (const p of quotes(before)) push(p.k === 'say' ? 'say' : 'talk', p.text);
    if (at < 0) continue;
    let acted = false;
    for (const p of quotes(raw.slice(at + 1))) {
      if (p.k === 'say') push('say', p.text);
      else if (!acted) { push('act', p.text.replace(AT, '').trim()); acted = true; }
      else push('talk', p.text);
    }
  }
  return { parts: parts.filter((p) => p.text).map(({ k, text: t }) => ({ k, text: t })), move };
}

// The parts of any player line, old or new.
export function partsOf(m) {
  if (!m) return [];
  if (m.type === 'player' || Array.isArray(m.parts)) return m.parts || [];
  if (m.type === 'declare') {
    return [
      m.answer && { k: 'talk', text: m.answer, answer: true },
      m.line && { k: 'talk', text: m.line },
      m.say && { k: 'say', text: m.say },
      m.action && { k: 'act', text: m.action },
    ].filter(Boolean);
  }
  if (m.type === 'ooc') return [{ k: 'talk', text: m.text }];
  if (m.type === 'talk') return [{ k: 'say', text: m.text }];
  return [];
}

export const isPost = (m) => ['player', 'declare', 'ooc', 'talk'].includes(m?.type);
export const textOf = (m, k) => partsOf(m).filter((p) => p.k === k).map((p) => p.text).join(' ');
export const hasAct = (m) => partsOf(m).some((p) => p.k === 'act');

// An AI player's reply ({talk, say, act, move, ask, answer}, older {say, action, line}) as a
// message's parts. Quotes a model leaves in its action move to speech.
export function partsFromReply(obj) {
  const parts = [];
  const answer = str(obj.answer, 200);
  if (answer) parts.push({ k: 'talk', text: answer, answer: true });
  const talk = str(obj.talk, 300);
  if (talk) parts.push({ k: 'talk', text: talk });
  const ask = str(obj.ask, 200);
  if (ask) parts.push({ k: 'talk', text: ask, ask: true });
  const say = str(obj.say, 300).replace(/^["“”'‘’「]+|["“”'‘’」]+$/g, '').trim();
  if (say) parts.push({ k: 'say', text: say });
  const act = (str(obj.act, 300) || str(obj.action, 300) || (parts.length ? '' : str(obj.line, 300))).replace(/^[@＠]\s*/, '');
  if (act) {
    // "@…" so the action is read as one even when the model wrote no @.
    for (const p of parsePost(`@${act}`).parts) parts.push(p);
  }
  return { parts, ask: !!ask };
}
