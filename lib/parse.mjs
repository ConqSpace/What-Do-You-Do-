// Pulls the first balanced JSON object out of a model reply. Models wrap JSON in code
// fences, add a sentence before it, or trail off after it; all of that is ignored.

export function extractJson(raw) {
  const text = String(raw || '');
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
        } catch { /* try the next "{" */ }
        break;
      }
    }
  }
  return null;
}

export const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const strList = (v, maxItems = 20, maxLen = 80) =>
  (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [])
    .map((x) => str(typeof x === 'string' ? x : x?.name ?? '', maxLen))
    .filter(Boolean)
    .slice(0, maxItems);

// Korean particles after a name follow its last syllable: 세린을 / 미르를, 도윤이 / 미르가.
// Models filling "___를" with a name often keep the template's particle; this fixes it.
const JOSA = [['을', '를'], ['은', '는'], ['이', '가'], ['과', '와']]; // [after a final consonant, after a vowel]
const hasBatchim = (w) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 !== 0; };
export function fixJosa(text, names) {
  let s = String(text ?? '');
  // Only Hangul names: "GM이" is read 지엠이, which the last letter can't tell.
  for (const n of names.filter((x) => /[가-힣]$/.test(x || ''))) {
    const b = hasBatchim(n);
    const name = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [withB, without] of JOSA) {
      s = s.replace(new RegExp(`${name}${b ? without : withB}(?=[\\s.,!?…]|$)`, 'g'), `${n}${b ? withB : without}`);
    }
  }
  return s;
}
