// 간이 d20: six modifiers on a 4-point budget, d20 + modifier against a DC.

import { die } from '../dice.mjs';
import { str } from '../parse.mjs';

const STATS = ['근력', '민첩', '체력', '지능', '감각', '매력'];
const MIN = -1, MAX = 3, BUDGET = 4;
const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
const clampStat = (v) => Math.max(MIN, Math.min(MAX, Math.round(Number(v) || 0)));
const clampDc = (v) => Math.max(5, Math.min(30, Math.round(Number(v) || 12)));
const LABEL = { critical: '대성공', success: '성공', failure: '실패', fumble: '대실패' };
const TIER = { critical: 'crit', success: 'good', failure: 'bad', fumble: 'fumble' };

// Bring any stat block into range and onto the point budget. Over budget: shave the
// highest first. Under budget: raise the lowest first.
export function normalizeStats(input = {}) {
  const s = {};
  for (const k of STATS) s[k] = clampStat(input[k]);
  let sum = STATS.reduce((a, k) => a + s[k], 0);
  while (sum > BUDGET) {
    const k = STATS.reduce((best, x) => (s[x] > s[best] ? x : best), STATS[0]);
    s[k]--; sum--;
  }
  while (sum < BUDGET) {
    const k = STATS.reduce((best, x) => (s[x] < s[best] ? x : best), STATS[0]);
    s[k]++; sum++;
  }
  return s;
}

// d20 + modifier against a DC. adv: 'advantage' | 'disadvantage' | null.
export function abilityCheck({ mod = 0, dc = 12, adv } = {}) {
  dc = clampDc(dc);
  const a = die(20);
  const b = adv === 'advantage' || adv === 'disadvantage' ? die(20) : null;
  const natural = b === null ? a : adv === 'advantage' ? Math.max(a, b) : Math.min(a, b);
  const total = natural + mod;
  let outcome;
  if (natural === 20) outcome = 'critical';
  else if (natural === 1) outcome = 'fumble';
  else outcome = total >= dc ? 'success' : 'failure';
  return { dice: b === null ? [a] : [a, b], natural, mod, total, dc, adv: b === null ? null : adv, outcome };
}

const advText = (adv) => (adv === 'advantage' ? ', 유리' : adv === 'disadvantage' ? ', 불리' : '');

export default {
  id: 'd20',
  label: '간이 d20',
  gmName: 'GM',
  STATS,

  meta() {
    return {
      id: 'd20', label: '간이 d20', gmName: 'GM', playerName: '플레이어',
      // The rule card on the new-campaign screen (see the selection-card-copy skill).
      icon: '🎲', tags: ['d20', '아무 장르'],
      intro: ['판타지든 사이버펑크든, 떠오른 이야기를 바로 시작합니다.', '규칙은 가볍게, 이야기는 마음껏.'],
      signature: { name: '대성공과 대실패', text: '주사위 하나로 성패를 가려요. 20이 나오면 기대보다 훨씬 잘 되고, 1이 나오면 오히려 일이 나빠져요. 휘두른 칼이 부러지는 것처럼요.' },
      stats: STATS, statKind: 'mod', statDefaults: [1, 1, 1, 0, 1, 0], statMin: MIN, statMax: MAX, budget: BUDGET };
  },

  rulesText: `## 규칙 (간이 d20)
- 능력치 6개: ${STATS.join('·')}. 각각 보정치 ${MIN}~+${MAX}.
- 판정: d20 + 보정치 ≥ 난이도(DC)면 성공. DC 기준: 쉬움 8 / 보통 12 / 어려움 15 / 매우 어려움 18 / 거의 불가능 22.
- 자연 20은 대성공(기대 이상의 결과), 자연 1은 대실패(일이 꼬인다).
- 유리(advantage)·불리(disadvantage): d20을 두 번 굴려 높은/낮은 쪽.
- HP = 10 + 체력×2. 피해: 가벼움 1d4, 보통 1d6~1d8, 치명 2d6 이상. HP 0이면 쓰러진다(죽음은 이야기상 의미 있을 때만).
- 주사위는 테이블 서버가 굴린다. 누구도 결과를 지어내지 않는다.`,

  gmPrinciples: `- 결과가 뻔하거나, 실패해도 이야기가 재미없어지면 굴리지 말고 바로 결과를 서술해. 판정은 위험이나 불확실성이 있을 때만.
- 실패는 막다른 길이 아니라 새로운 문제·대가·전개로 이어지게(fail forward).`,

  playerPrinciples: '- 행동은 "시도"로 선언해. 결과는 GM과 주사위가 정해. ("자물쇠를 따 본다" O / "자물쇠를 따서 문을 연다" X)',

  characterTask() {
    return {
      rules: `- 능력치 보정치는 ${MIN}~+${MAX}, 여섯 개 합이 정확히 ${BUDGET}.
- 소지품은 3~5개, 캐릭터다운 걸로.`,
      shape: `{
  "name": "이름",
  "concept": "한 줄 콘셉트 (예: 빚에 쫓기는 몰락 귀족 검사)",
  "appearance": "외모 한두 문장",
  "personality": "성격과 말투",
  "background": "배경과 이번 모험에 낀 이유 (2~3문장)",
  "stats": {${STATS.map((s) => `"${s}": 0`).join(', ')}},
  "items": ["소지품"],
  "note": "(선택) 개인 메모에 적어 둘 캐릭터 비밀이나 목표"
}`,
    };
  },

  makeCharacter(raw) {
    const stats = normalizeStats(raw.stats || {});
    return { stats, maxHp: 10 + 2 * stats.체력 };
  },

  sheetLine(ch) {
    return `HP ${ch.hp}/${ch.maxHp} | ${STATS.map((s) => `${s}${sg(ch.stats?.[s] ?? 0)}`).join(' ')}`;
  },

  sheetView(ch) {
    return {
      badges: [],
      stats: STATS.map((s) => ({ label: s, value: sg(ch.stats?.[s] ?? 0) })),
      tracks: [{ label: 'HP', value: ch.hp, max: ch.maxHp }],
      lists: [],
    };
  },

  checkGuide: '- 불확실하고 위험한 행동만 판정(checks)에 넣어. 적의 공격이 PC에게 맞는지 애매하면 PC가 피하는 판정(민첩 등)으로 처리해.',
  checkSchema: `{"who": "캐릭터 키", "stat": "${STATS.join('|')}", "dc": 12, "adv": "advantage|disadvantage|null", "why": "무엇을 판정하는지 짧게"}`,

  normalizeCheck(x) {
    const stat = STATS.find((s) => String(x.stat || '').includes(s)) || '감각';
    const adv = ['advantage', 'disadvantage'].includes(x.adv) ? x.adv : null;
    return { stat, dc: clampDc(x.dc), adv, why: str(x.why, 120) };
  },

  checkLabel(p) { return `${p.stat} 판정 (DC ${p.dc}${advText(p.adv)})`; },

  // /check 카엘 민첩 15 [유리|불리]
  commandCheck(words) {
    const [stat, dc, adv] = words;
    if (!STATS.includes(stat)) return `능력치는 ${STATS.join(', ')} 중 하나 (예: /check 카엘 민첩 15 유리)`;
    return { stat, dc: clampDc(dc), adv: adv === '유리' ? 'advantage' : adv === '불리' ? 'disadvantage' : null, why: '' };
  },

  resolveCheck(check, ch) {
    const r = abilityCheck({ mod: ch?.stats?.[check.stat] ?? 0, dc: check.dc, adv: check.adv });
    return {
      ...r,
      stat: check.stat,
      title: `${check.stat} 판정${advText(r.adv)}`,
      target: `DC ${r.dc}`,
      label: LABEL[r.outcome],
      tier: TIER[r.outcome],
    };
  },

  followUp() { return null; },
  applyChoice() {},

  rollText(r, name) {
    const dice = r.dice.length > 1 ? `[${r.dice.join(',')}]→${r.natural}` : `${r.natural}`;
    return `🎲 ${name} ${r.stat} 판정 (DC ${r.dc}${advText(r.adv)}): d20 ${dice} ${sg(r.mod)} = ${r.total} → ${r.label}${r.why ? ` (${r.why})` : ''}`;
  },

  effectSchema: '',
  applyEffect() { return []; },
  armor() { return 0; },
  onDown() { return null; },

  mock: {
    character() {
      const stats = Object.fromEntries(STATS.map((s) => [s, 0]));
      for (let i = 0; i < BUDGET; i++) stats[STATS[Math.floor(Math.random() * STATS.length)]]++;
      return { stats };
    },
    check() {
      return { stat: STATS[Math.floor(Math.random() * STATS.length)], dc: [8, 12, 12, 15, 18][Math.floor(Math.random() * 5)], adv: null };
    },
  },
};
