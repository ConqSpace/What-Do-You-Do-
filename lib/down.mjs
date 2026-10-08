// Who is out of the fight. Every rule system ends up in one of two places: dead for good
// (사망), or unconscious until someone heals them above 0 HP (HP 0, 쓰러짐, CoC's 기절 and
// 빈사). Neither takes turns; the engine keeps the ledger in step (사망(이름) and
// 상태(이름, 쓰러짐), known to all) so rules can end the story on them.

// Marks the server puts on (and clears from) a sheet when HP hits 0 or comes back.
export const DOWN_MARKS = ['쓰러짐', '기절', '빈사'];

// 'dead' | 'out' | null
export function downOf(ch) {
  if (!ch) return null;
  if (ch.conditions?.includes('사망')) return 'dead';
  if (ch.hp <= 0 || ch.conditions?.some((x) => DOWN_MARKS.includes(x))) return 'out';
  return null;
}

// Fact arguments can't hold the ledger's own punctuation.
export const factName = (name) => String(name).replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();

// The GM's list of who can't act, and why.
export function downBlock(c) {
  const lines = Object.values(c.characters || {}).map((ch) => {
    const d = downOf(ch);
    if (d === 'dead') return `- ${ch.name}: 사망. 다시는 차례가 오지 않는다.`;
    if (d !== 'out') return null;
    const deal = ch.conditions.includes('사신과의 거래') ? ' 사신의 거래를 기다리는 중.' : '';
    return `- ${ch.name}: 쓰러짐(의식 없음, HP ${ch.hp}).${deal} 누가 치료해 HP가 0을 넘어야 깨어나 다시 차례가 온다.`;
  }).filter(Boolean);
  if (!lines.length) return '';
  return `\n\n## 쓰러진 캐릭터 (차례가 오지 않는다. next·spotlight에 넣지 말고, 이들의 행동을 서술하지 마)\n${lines.join('\n')}`;
}
