// Long GM text is said a sentence or two at a time, the way a GM talks at the table, not
// read out as one block. splitBeats() cuts it into those beats.

const END = /[.!?…。]/;
const CLOSE = /["”’』」)\]]/;

// Sentences of one paragraph. A full stop inside a quote doesn't end the sentence;
// the closing quote does ("…멈춰." 그가 말했다).
function sentences(p) {
  const out = [];
  let start = 0, inQuote = false;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '“') inQuote = true;
    else if (ch === '”') inQuote = false;
    else if (ch === '"') inQuote = !inQuote;
    if (inQuote || !/\s/.test(p[i + 1] || '')) continue;
    let j = i;
    while (j > start && CLOSE.test(p[j])) j--;
    if (!END.test(p[j])) continue;
    out.push(p.slice(start, i + 1).trim());
    start = i + 1;
  }
  const rest = p.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// Beats of at most two sentences and about `max` characters. A paragraph break always
// starts a new beat; a short heading line ("📜 드워프 폐광") rides along with the beat after it.
export function splitBeats(text, max = 110) {
  text = String(text || '').trim();
  if (text.length <= max) return text ? [text] : [];
  const beats = [];
  let head = '';
  for (const p of text.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
    const ss = sentences(p);
    if (ss.length === 1 && p.length < 40 && !END.test(p.replace(new RegExp(`${CLOSE.source}+$`), '').slice(-1))) {
      head = head ? `${head}\n${p}` : p;
      continue;
    }
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      beats.push((head ? `${head}\n` : '') + cur.join(' '));
      head = '';
      cur = [];
    };
    for (const s of ss) {
      if (cur.length && (cur.length >= 2 || cur.join(' ').length + s.length + 1 > max)) flush();
      cur.push(s);
    }
    flush();
  }
  if (head) beats.push(head);
  return beats;
}

// The GM writes an NPC's words on a line of their own, `뾰족귀: "내려가! 산, 우리 거!"`, so
// the table hears them from that NPC, not from the GM. splitSpeech() cuts GM text into
// narration pieces and NPC lines, in order. Words after the closing quote go back to narration.
const SPEAKER = /^\s*\**([^\s"“”'‘’:：*\[\]][^"“”:：*\n]{0,19}?)\**\s*[:：]\s*(["“「『])/;
const CLOSER = { '"': '"', '“': '”', '「': '」', '『': '』' };

export function splitSpeech(text) {
  const out = [];
  let narr = [];
  const flush = () => { const t = narr.join('\n').trim(); if (t) out.push({ text: t }); narr = []; };
  for (const line of String(text || '').split('\n')) {
    const m = line.match(SPEAKER);
    // "그가 말했다: …" is narration, not a speaker.
    if (!m || /[다요]$/.test(m[1].trim())) { narr.push(line); continue; }
    const rest = line.slice(m[0].length);
    const end = rest.lastIndexOf(CLOSER[m[2]] === '"' ? '"' : CLOSER[m[2]]);
    const say = (end >= 0 ? rest.slice(0, end) : rest).trim();
    if (!say) { narr.push(line); continue; }
    flush();
    out.push({ npc: m[1].trim(), say });
    if (end >= 0 && rest.slice(end + 1).trim()) narr.push(rest.slice(end + 1).trim());
  }
  flush();
  return out;
}
