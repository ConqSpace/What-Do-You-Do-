// Dungeon World: 2d6 + stat, 10+ / 7–9 / 6-. The GM never rolls; players' fiction
// triggers moves, a miss marks XP and lets the GM make a move.
//
// Move and class summaries are our own Korean wording of the Dungeon World SRD by Sage
// LaTorra and Adam Koebel, used under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).

import { die, rollDice } from '../dice.mjs';
import { str, strList } from '../parse.mjs';

const STATS = ['근력', '민첩', '체력', '지능', '지혜', '매력'];
const SCORES = [16, 15, 13, 12, 9, 8];
const DEBILITY = { 근력: '쇠약', 민첩: '떨림', 체력: '병약', 지능: '멍함', 지혜: '혼란', 매력: '흉터' };
const DEBILITIES = Object.values(DEBILITY);
const ALIGNMENTS = ['선', '법', '중립', '혼돈', '악'];
const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);

export function modOf(score) {
  if (score <= 3) return -3;
  if (score <= 5) return -2;
  if (score <= 8) return -1;
  if (score <= 12) return 0;
  if (score <= 15) return 1;
  if (score <= 17) return 2;
  return 3;
}

// Moves the GM can call. stat: fixed stat, null = the GM picks (위험에 맞서기),
// '유대' = bonds with the target, '없음' = no stat. choose: options after the roll
// ({strong, weak} = how many to pick). dmg on an option changes the damage roll.
const MOVES = {
  '난타전': { stat: '근력', damage: true, when: '근접에서 적을 공격할 때',
    strong: '피해를 주고 반격을 피한다 (원하면 +1d6 피해 대신 반격을 받는다)', weak: '피해를 주지만 적도 반격한다' },
  '일제 사격': { stat: '민첩', damage: true, when: '원거리에서 조준해 쏠 때',
    strong: '명중, 피해를 준다', weak: '명중하지만 하나를 고른다',
    choose: { weak: 1, options: [{ text: '위험한 위치로 몸을 드러낸다' }, { text: '탄약을 1 소모한다' }, { text: '피해 -1d6', dmg: '-1d6' }] } },
  '위험에 맞서기': { stat: null, when: '닥쳐오는 위험을 무릅쓰고 행동할 때 (어떻게 맞서느냐로 능력치를 고른다)',
    strong: '해낸다. 위협은 현실이 되지 않는다', weak: '비틀거리거나 머뭇거린다. GM이 더 나쁜 결과, 거래, 곤란한 선택을 제시한다' },
  '수호하기': { stat: '체력', hold: { strong: 3, weak: 1 }, when: '사람·물건·장소를 공격에서 지킬 때',
    strong: '홀드 3', weak: '홀드 1',
    after: '홀드 1을 써서: 공격을 자신에게 돌린다 / 공격의 효과·피해를 절반으로 / 공격자에게 빈틈 → 동료 +1 전진 / 레벨만큼 피해' },
  '지식 더듬기': { stat: '지능', when: '쌓아 둔 지식을 떠올릴 때',
    strong: 'GM이 흥미롭고 유용한 사실을 알려 준다', weak: '흥미로운 사실을 알려 준다. 쓸모 있게 만드는 건 네 몫' },
  '상황 파악': { stat: '지혜', when: '상황이나 사람을 면밀히 살필 때',
    strong: '질문 3개', weak: '질문 1개', after: '답에 따라 행동하면 +1 전진',
    choose: { strong: 3, weak: 1, options: [{ text: '방금 여기서 무슨 일이 있었나?' }, { text: '곧 무슨 일이 일어나려 하나?' },
      { text: '무엇을 조심해야 하나?' }, { text: '여기서 내게 쓸모 있거나 값진 것은?' }, { text: '여기서 진짜 주도권을 쥔 건 누구인가?' },
      { text: '겉보기와 다른 것은 무엇인가?' }] } },
  '담판': { stat: '매력', when: '쥔 약점(레버리지)으로 상대를 움직이려 할 때',
    strong: '약속만으로 들어준다', weak: '지금 당장 확실한 보장을 요구한다' },
  '돕기/방해하기': { stat: '유대', when: '다른 PC의 판정을 돕거나 방해할 때 (대상과의 유대 수만큼 더한다)',
    strong: '대상의 판정에 +1 (방해면 -2)', weak: '대상에게 +1/-2, 하지만 너도 위험·대가에 노출된다' },
  '마지막 숨': { stat: '없음', when: 'HP 0으로 쓰러졌을 때 (서버가 자동으로 굴린다)',
    strong: '죽음의 문턱에서 돌아온다', weak: '죽음이 거래를 제안한다. 받아들이면 살고, 거절하면 죽는다', miss: '죽음을 맞는다' },
};

const CLASSES = {
  전사: { hp: 10, damage: 'd10', armor: 1, passives: ['갑주: 갑옷의 불편함을 무시한다', '특제 무기: 오랜 세월 함께한 자기만의 무기'],
    moves: { '굽히거나 부수기': { stat: '근력', when: '순수한 힘으로 장애물을 부수거나 비틀 때', strong: '셋 고른다', weak: '둘 고른다',
      choose: { strong: 3, weak: 2, options: [{ text: '오래 걸리지 않는다' }, { text: '값진 것이 망가지지 않는다' }, { text: '요란한 소리가 나지 않는다' }, { text: '나중에 쉽게 되돌릴 수 있다' }] } } } },
  성기사: { hp: 10, damage: 'd10', armor: 2, passives: ['갑주: 갑옷의 불편함을 무시한다', '나는 맹세한다: 퀘스트를 선언하면 축복과 맹세를 받는다'],
    moves: { '안수': { stat: '매력', when: '맨손으로 상처 입은 이를 만지며 기도할 때', strong: '1d8 회복하거나 질병 하나를 치료한다', weak: '치료하지만 그 피해·질병이 네게 옮겨 온다' } } },
  레인저: { hp: 8, damage: 'd8', armor: 1, passives: ['동물 동료: 충직한 짐승이 함께 다닌다'],
    moves: {
      '사냥과 추적': { stat: '지혜', when: '흔적을 쫓을 때', strong: '흔적을 따라가고, 그 흔적에 대해 하나를 더 알아낸다', weak: '흔적이 끊기거나 바뀔 때까지 따라간다' },
      '겨냥 사격': { stat: '민첩', damage: true, when: '방심한 적의 특정 부위를 노려 쏠 때', strong: '노린 부위에 명중, 피해와 그 부위의 효과', weak: '명중하지만 효과가 덜하거나 대가가 따른다' } } },
  도둑: { hp: 6, damage: 'd8', armor: 1, passives: ['독 다루기: 독을 다루는 데 익숙하다'],
    moves: {
      '함정 전문가': { stat: '민첩', hold: { strong: 3, weak: 1 }, when: '위험한 곳을 살펴볼 때', strong: '홀드 3', weak: '홀드 1', after: '홀드 1로 GM에게 함정이 있는지, 무엇이 작동시키는지, 작동하면 무슨 일이 생기는지 묻는다' },
      '도둑질 기술': { stat: '민첩', when: '자물쇠를 따거나 소매치기하거나 함정을 해제할 때', strong: '해낸다', weak: '해내지만 GM이 의심·위험·대가 중 하나를 제시한다' },
      '기습 공격': { stat: '민첩', damage: true, when: '방심한 적을 근접에서 기습할 때', strong: '둘 고른다', weak: '하나 고른다',
        choose: { strong: 2, weak: 1, options: [{ text: '갑옷을 무시한다', ignoreArmor: true }, { text: '+1d6 피해', dmg: '+1d6' }, { text: '동료에게 빈틈 (+1 전진)' }, { text: '적의 갑옷을 영구히 1 줄인다' }] } } } },
  마법사: { hp: 4, damage: 'd4', armor: 0, passives: ['마법책: 주문을 적어 둔 책', '의식: 마법이 깃든 장소에서 의식을 치를 수 있다'],
    moves: {
      '주문 시전': { stat: '지능', when: '준비한 주문을 펼칠 때', strong: '주문이 발동한다', weak: '발동하지만 하나 고른다',
        choose: { weak: 1, options: [{ text: '위험에 노출된다' }, { text: '주문이 흔들려 다음 시전에 -1' }, { text: '주문을 잊어 오늘은 다시 못 쓴다' }] } },
      '마법 식별': { stat: '지능', when: '마법 물건이나 현상을 살필 때', strong: '그것이 무엇이고 무엇을 하는지 안다', weak: '흥미로운 사실 하나를 안다' } } },
  사제: { hp: 8, damage: 'd6', armor: 1, passives: ['신과의 교감: 기도로 주문을 받는다'],
    moves: {
      '주문 시전': { stat: '지혜', when: '신이 내린 주문을 펼칠 때', strong: '주문이 발동한다', weak: '발동하지만 하나 고른다',
        choose: { weak: 1, options: [{ text: '위험에 노출된다' }, { text: '신과의 거리 탓에 다음 시전에 -1' }, { text: '그 주문을 오늘은 다시 못 쓴다' }] } },
      '언데드 퇴치': { stat: '지혜', when: '성표를 들고 신을 부를 때', strong: '언데드가 다가오지 못하고, 지능 없는 것들은 달아난다', weak: '언데드가 다가오지 못한다' } } },
  드루이드: { hp: 6, damage: 'd6', armor: 0, passives: ['자연의 말: 짐승·정령과 통한다', '태생지: 자신이 태어난 땅의 기운을 지닌다'],
    moves: { '변신': { stat: '지혜', hold: { strong: 3, weak: 2 }, when: '동물의 모습으로 변할 때', strong: '홀드 3', weak: '홀드 2', after: '홀드 1로 그 동물다운 행동을 한다' } } },
  음유시인: { hp: 6, damage: 'd6', armor: 0, passives: ['구전 지식: 오래된 노래와 이야기에 밝다', '여관의 환대: 어느 마을에서든 환영받는다'],
    moves: { '비술 공연': { stat: '매력', when: '동료를 위해 노래·연주로 마법을 엮을 때', strong: '하나 고른다', weak: '하나 고른다, 하지만 원치 않는 이목을 끈다',
      choose: { strong: 1, weak: 1, options: [{ text: '동료 1d8 회복' }, { text: '동료의 다음 공격 +1d4 피해' }, { text: '가벼운 마법·홀림에서 풀어 준다' }, { text: '동료의 다음 방어에 +2 갑옷' }] } } } },
};
const CLASS_NAMES = Object.keys(CLASSES);

function moveDef(name, cls) {
  return MOVES[name] || CLASSES[cls]?.moves?.[name] || null;
}

function findMove(text, cls) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t) return null;
  const names = [...Object.keys(MOVES), ...Object.keys(CLASSES[cls]?.moves || {})];
  return names.find((n) => n.replace(/\s+/g, '') === t)
    || names.find((n) => t.includes(n.replace(/\s+/g, '')) || n.replace(/\s+/g, '').includes(t))
    || null;
}

const statOf = (s) => STATS.find((x) => String(s || '').includes(x)) || null;

export function effMod(ch, stat) {
  const base = modOf(ch?.scores?.[stat] ?? 10);
  return base - ((ch?.debilities || []).includes(DEBILITY[stat]) ? 1 : 0);
}

// Scores must be a permutation of 16 15 13 12 9 8. Anything else: rank the given
// numbers (missing = 0) and hand out the array in that order.
export function normalizeScores(input = {}) {
  const given = STATS.map((s) => Number(input?.[s]) || 0);
  const sorted = [...given].sort((a, b) => b - a);
  if (sorted.join() === SCORES.join()) return Object.fromEntries(STATS.map((s, i) => [s, given[i]]));
  const order = STATS.map((s, i) => i).sort((a, b) => given[b] - given[a] || a - b);
  const out = {};
  order.forEach((idx, rank) => { out[STATS[idx]] = SCORES[rank]; });
  return Object.fromEntries(STATS.map((s) => [s, out[s]]));
}

function bondsWith(ch, target, ctx) {
  if (!target) return 0;
  const t = String(target).trim();
  const other = ctx?.characters?.[t];
  const names = other ? [t, other.name] : [t];
  return (ch.bonds || []).filter((b) => names.some((n) => n && (b.with === n || String(b.with).includes(n) || String(b.text).includes(n)))).length;
}

const TIER_LABEL = { good: '강한 성공', mixed: '부분 성공', bad: '실패' };

function damageExpr(d) { return /^\d*d\d+/.test(d) ? d : `1${d}`; }

export default {
  id: 'dw',
  label: '던전 월드',
  gmName: 'GM',
  STATS,
  CLASSES,
  MOVES,

  meta() {
    return {
      id: 'dw', label: '던전 월드', stats: STATS, statKind: 'score', scores: SCORES,
      statDefaults: [16, 13, 15, 8, 12, 9],
      fields: [{ name: 'class', label: '클래스', options: CLASS_NAMES }, { name: 'alignment', label: '성향', options: ALIGNMENTS }],
      moves: Object.entries(MOVES).filter(([n]) => n !== '마지막 숨').map(([n, m]) => ({ name: n, stat: m.stat })),
    };
  },

  rulesText: `## 규칙 (던전 월드)
- 능력치 6개: ${STATS.join('·')}. 점수 16·15·13·12·9·8을 하나씩 나눠 가진다. 보정치: 16~17 +2, 13~15 +1, 9~12 0, 6~8 -1.
- 무브: 캐릭터의 행동이 무브의 조건에 맞으면 2d6 + 능력치 보정치를 굴린다. 10+ 강한 성공 / 7–9 부분 성공(대가·곤란한 선택) / 6- 실패(GM이 무브를 하고, 굴린 사람은 경험치 +1).
- 약화 상태(${DEBILITIES.join('·')})는 해당 능력치 판정에 -1. 전진(forward)은 다음 판정 한 번에, 지속(ongoing)은 계속 더해진다. 홀드는 무브가 주는 쓸 수 있는 횟수.
- HP = 클래스 기본값 + 체력 점수. 피해는 주사위로(클래스 피해 주사위, 괴물 피해 주사위), 갑옷만큼 줄어든다. HP 0이면 쓰러져 "마지막 숨"을 굴린다.
- 주사위는 테이블 서버가 굴린다. GM은 절대 굴리지 않고, 누구도 결과를 지어내지 않는다.

## 기본 무브
${Object.entries(MOVES).map(([n, m]) => `- ${n} (${m.stat || '상황에 맞는 능력치'}): ${m.when}. 10+ ${m.strong} / 7–9 ${m.weak}${m.after ? ` (${m.after})` : ''}`).join('\n')}`,

  gmPrinciples: `- GM의 의제: 세계를 환상적으로 그려라 / 캐릭터들의 삶을 모험으로 채워라 / 무슨 일이 일어날지 보려고 플레이하라(결말을 미리 정해 두지 마).
- 판정을 일으키는 건 허구다. 캐릭터의 행동이 무브의 조건에 맞을 때만 그 무브로 판정을 요청하고, 아니면 그냥 결과를 서술해.
- 10+는 원하는 걸 준다. 7–9는 얻되 대가·곤란한 선택·더 나쁜 결과가 붙는다. 6-는 네가 GM 무브를 한다.
- GM 무브: 다가오는 위협의 징조 보이기 / 피해 주기 / 자원 소모시키기 / 무브의 대가를 현실로 / 곤란한 선택 강요 / 클래스의 약점 찌르기 / 대가를 걸고 기회 주기 / 위치를 바꾸기 / 나쁜 소식 전하기 / "어떻게 하겠어?"라고 묻기.
- 강한 무브(즉시 피해 같은)는 6-가 나왔거나 플레이어가 기회를 넘겼을 때만. 평소엔 부드러운 무브로 위협을 먼저 보여 줘.
- 플레이어에게 질문하고 그 답을 세계에 써라. 서술 끝에 특정 캐릭터에게 질문을 던져도 좋다 ("아린, 너희 기사단은 이 문장을 뭐라고 불렀지?").
- 무브 이름을 대사처럼 말하지 말고 허구로 보여 줘. 단 판정 요청(checks)에는 무브 이름을 정확히 써.
- 적은 foes에 이름·HP·갑옷·피해 주사위로 등록해 둬(괴물 HP: 약함 3, 보통 6~10, 강함 12~16). PC의 피해 무브는 서버가 클래스 피해 주사위를 굴려 target 적에게 자동으로 깎는다.
- 적이 PC에게 피해를 주면 effects에 "damage": "d8"처럼 피해 주사위를 적어(서버가 굴리고 갑옷만큼 뺀다). 갑옷을 뚫는 공격은 "ignore_armor": true.`,

  playerPrinciples: `- 행동은 허구로, "시도"로 선언해. 결과는 GM과 주사위가 정해. ("자물쇠를 따 본다" O / "자물쇠를 따서 문을 연다" X)
- 무브 이름을 외칠 필요는 없지만, 노리는 무브가 있으면 "move"에 적어 둬도 좋아. 판정할지는 GM이 정해.
- 다른 PC를 돕거나(돕기/방해하기) 유대에 걸린 감정을 연기하면 이야기가 살아나.`,

  characterTask() {
    return {
      rules: `- 클래스는 ${CLASS_NAMES.join(' / ')} 중 하나. 동료와 겹치지 않으면 좋아.
- 능력치 점수 16·15·13·12·9·8을 여섯 능력치에 하나씩 배정해 (클래스의 주 능력치에 높은 점수).
- 성향은 ${ALIGNMENTS.join(' / ')} 중 하나.
- 소지품은 3~5개, 클래스와 캐릭터다운 걸로.`,
      shape: `{
  "name": "이름",
  "class": "${CLASS_NAMES.join('|')}",
  "concept": "한 줄 콘셉트 (예: 신앙을 잃어 가는 성기사)",
  "alignment": "${ALIGNMENTS.join('|')}",
  "appearance": "외모 (눈·머리·옷차림·몸)",
  "personality": "성격과 말투",
  "background": "배경과 이번 모험에 낀 이유 (2~3문장)",
  "scores": {${STATS.map((s, i) => `"${s}": ${SCORES[i]}`).join(', ')}},
  "items": ["소지품"],
  "note": "(선택) 개인 메모에 적어 둘 캐릭터 비밀이나 목표"
}`,
    };
  },

  makeCharacter(raw) {
    const cls = CLASS_NAMES.find((n) => String(raw.class || '').includes(n)) || CLASS_NAMES[Math.floor(Math.random() * CLASS_NAMES.length)];
    const scores = normalizeScores(raw.scores || raw.stats);
    const c = CLASSES[cls];
    return {
      class: cls,
      concept: str(raw.concept, 120) || cls,
      alignment: ALIGNMENTS.find((a) => String(raw.alignment || '').includes(a)) || '중립',
      level: 1, xp: 0,
      scores,
      stats: Object.fromEntries(STATS.map((s) => [s, modOf(scores[s])])),
      maxHp: c.hp + scores.체력,
      armor: c.armor,
      damage: c.damage,
      debilities: [],
      forward: 0, ongoing: 0, hold: 0,
      bonds: Array.isArray(raw.bonds) ? raw.bonds.map((b) => ({ with: str(b?.with, 40), text: str(b?.text, 200) })).filter((b) => b.text).slice(0, 4) : [],
    };
  },

  sheetLine(ch, { full } = {}) {
    let line = `${ch.class} Lv${ch.level} | HP ${ch.hp}/${ch.maxHp} | 갑옷 ${ch.armor} | 피해 ${ch.damage} | ${STATS.map((s) => `${s}${sg(effMod(ch, s))}`).join(' ')}`;
    if (ch.debilities?.length) line += ` | 약화: ${ch.debilities.join(', ')}`;
    if (ch.forward) line += ` | 전진 ${sg(ch.forward)}`;
    if (ch.ongoing) line += ` | 지속 ${sg(ch.ongoing)}`;
    if (ch.hold) line += ` | 홀드 ${ch.hold}`;
    if (full) {
      const moves = Object.keys(CLASSES[ch.class]?.moves || {});
      if (moves.length) line += `\n    클래스 무브: ${moves.join(', ')}`;
      if (ch.bonds?.length) line += `\n    유대: ${ch.bonds.map((b) => b.text).join(' / ')}`;
    }
    return line;
  },

  sheetView(ch) {
    const cls = CLASSES[ch.class] || {};
    const badges = [`${ch.class} Lv${ch.level}`, `성향 ${ch.alignment}`, `경험치 ${ch.xp}/${ch.level + 7}`, `갑옷 ${ch.armor}`, `피해 ${ch.damage}`];
    if (ch.forward) badges.push(`전진 ${sg(ch.forward)}`);
    if (ch.ongoing) badges.push(`지속 ${sg(ch.ongoing)}`);
    if (ch.hold) badges.push(`홀드 ${ch.hold}`);
    return {
      badges,
      stats: STATS.map((s) => ({ label: s, value: sg(effMod(ch, s)), sub: String(ch.scores?.[s] ?? ''), warn: (ch.debilities || []).includes(DEBILITY[s]) })),
      tracks: [{ label: 'HP', value: ch.hp, max: ch.maxHp }],
      lists: [
        { title: '클래스 무브', items: [...Object.entries(cls.moves || {}).map(([n, m]) => `${n} (${m.stat}): ${m.when}`), ...(cls.passives || [])] },
        { title: '유대', items: (ch.bonds || []).map((b) => b.text) },
        { title: '약화', items: ch.debilities || [] },
      ].filter((l) => l.items.length),
    };
  },

  checkGuide: `- 플레이어의 행동이 무브의 조건에 맞을 때만 checks에 넣어. "move"는 기본 무브 이름이나 그 캐릭터의 클래스 무브 이름을 정확히.
- 위험에 맞서기와 능력치가 정해지지 않은 무브는 어떻게 해내느냐로 "stat"을 골라 (힘으로 버팀=근력, 재빨리 피함=민첩, 견딤=체력, 머리=지능, 정신력·직감=지혜, 말발·존재감=매력).
- 피해를 주는 무브(난타전·일제 사격·겨냥 사격·기습 공격)는 "target"에 foes의 적 이름을. 돕기/방해하기는 "target"에 대상 캐릭터 키를.
- 같은 라운드에 누가 돕기를 성공했다면 그 대상의 판정에 "bonus": 1 (방해면 -2).`,
  checkSchema: `{"who": "캐릭터 키", "move": "무브 이름", "stat": "(위험에 맞서기일 때) ${STATS.join('|')}", "target": "(선택) 적 이름 또는 캐릭터 키", "bonus": 0, "why": "어떤 허구가 무브를 일으켰는지 짧게"}`,

  normalizeCheck(x, ch) {
    const move = findMove(x.move, ch?.class) || '위험에 맞서기';
    const def = moveDef(move, ch?.class);
    const stat = def?.stat || statOf(x.stat) || '민첩';
    const bonus = Math.max(-3, Math.min(3, Math.round(Number(x.bonus) || 0)));
    return { move, stat, target: str(x.target, 60), bonus, why: str(x.why, 120) };
  },

  checkLabel(p) { return `${p.move}${p.stat && !['없음', '유대'].includes(p.stat) ? ` +${p.stat}` : ''}`; },

  // /check 카엘 위험에 맞서기 민첩  ·  /check 카엘 난타전 고블린
  commandCheck(words, ch) {
    const text = words.join(' ');
    const move = findMove(text.split(/\s+/).slice(0, 3).join(' '), ch?.class) || findMove(words[0], ch?.class);
    if (!move) return `무브를 못 찾았어요. 예: /check 카엘 위험에 맞서기 민첩, /check 카엘 난타전 고블린 (무브: ${Object.keys(MOVES).join(', ')})`;
    const rest = text.replace(new RegExp(move.split(/\s*/).join('\\s*')), '').trim().split(/\s+/).filter(Boolean);
    const stat = statOf(rest[0]);
    return this.normalizeCheck({ move, stat, target: stat ? rest.slice(1).join(' ') : rest.join(' ') }, ch);
  },

  resolveCheck(check, ch, ctx = {}) {
    const def = moveDef(check.move, ch?.class) || {};
    const notes = [];
    let mod = 0;
    if (check.stat === '유대') mod = bondsWith(ch, check.target, ctx);
    else if (check.stat !== '없음') mod = effMod(ch, check.stat);
    if (check.move !== '마지막 숨') {
      if (ch.forward) { mod += ch.forward; notes.push(`전진 ${sg(ch.forward)} 사용`); ch.forward = 0; }
      if (ch.ongoing) mod += ch.ongoing;
    }
    mod += check.bonus || 0;
    const dice = [die(6), die(6)];
    const total = dice[0] + dice[1] + mod;
    const tier = total >= 10 ? 'good' : total >= 7 ? 'mixed' : 'bad';
    if (tier === 'bad' && check.move !== '마지막 숨') { ch.xp = (ch.xp || 0) + 1; notes.push('경험치 +1'); }
    if (def.hold && tier !== 'bad') {
      const n = tier === 'good' ? def.hold.strong : def.hold.weak;
      ch.hold = (ch.hold || 0) + n;
      notes.push(`홀드 +${n}`);
    }
    let damage = null;
    if (def.damage && tier !== 'bad') {
      const r = rollDice(damageExpr(ch.damage || 'd6'));
      damage = { expr: damageExpr(ch.damage || 'd6'), detail: r.detail, total: r.total, target: check.target || '' };
    }
    const text = tier === 'good' ? def.strong : tier === 'mixed' ? def.weak : (def.miss || 'GM이 무브를 한다');
    const statLabel = check.stat === '없음' ? '' : check.stat === '유대' ? ` +유대(${mod - (check.bonus || 0)})` : ` +${check.stat}`;
    return {
      move: check.move, stat: check.stat, dice, mod, total, tier,
      title: `${check.move}${statLabel}${check.bonus ? ` (${sg(check.bonus)})` : ''}`,
      target: '10+ / 7–9 / 6-',
      label: TIER_LABEL[tier],
      text: text || '',
      after: tier !== 'bad' ? def.after || '' : '',
      damage, notes,
    };
  },

  followUp(roll, ch) {
    const def = moveDef(roll.move, ch?.class);
    const ch_ = def?.choose;
    if (!ch_ || roll.tier === 'bad') return null;
    const count = roll.tier === 'good' ? ch_.strong : ch_.weak;
    if (!count) return null;
    return {
      prompt: `${roll.move} · ${roll.label}: ${count}개 고르세요${def.after ? ` (${def.after})` : ''}`,
      options: ch_.options.map((o) => o.text),
      count,
    };
  },

  applyChoice(roll, picks, ch) {
    const def = moveDef(roll.move, ch?.class);
    const opts = def?.choose?.options || [];
    roll.chosen = picks.map((i) => opts[i]?.text).filter(Boolean);
    for (const i of picks) {
      if (opts[i]?.ignoreArmor && roll.damage) roll.damage.ignoreArmor = true;
      const d = opts[i]?.dmg;
      if (!d || !roll.damage) continue;
      const r = rollDice(d.replace(/^[+-]/, ''));
      roll.damage.total = Math.max(0, roll.damage.total + (d.startsWith('-') ? -r.total : r.total));
      roll.damage.detail += ` ${d.startsWith('-') ? '-' : '+'}${r.detail}`;
    }
  },

  rollText(r, name) {
    let s = `🎲 ${name} · ${r.title}: 2d6 [${r.dice.join(',')}] ${sg(r.mod)} = ${r.total} → ${r.label}`;
    if (r.text) s += ` — ${r.text}`;
    if (r.after) s += ` (${r.after})`;
    if (r.damage) s += ` | 피해 ${r.damage.expr} = ${r.damage.total}${r.damage.target ? ` → ${r.damage.target}` : ''}${r.damage.result ? ` (${r.damage.result})` : ''}`;
    if (r.chosen?.length) s += ` | 고른 것: ${r.chosen.join(' / ')}`;
    if (r.notes?.length) s += ` | ${r.notes.join(', ')}`;
    if (r.why) s += ` (${r.why})`;
    return s;
  },

  effectSchema: '"debilities_add": [], "debilities_remove": [], "forward": 0, "ongoing": 0, "hold": 0, "xp": 0, "armor": null',

  applyEffect(e, ch) {
    const bits = [];
    for (const d of strList(e.debilities_add, 6)) {
      const name = DEBILITIES.find((x) => d.includes(x));
      if (name && !ch.debilities.includes(name)) { ch.debilities.push(name); bits.push(`약화 +${name}`); }
    }
    for (const d of strList(e.debilities_remove, 6)) {
      const i = ch.debilities.findIndex((x) => d.includes(x));
      if (i >= 0) { bits.push(`약화 -${ch.debilities[i]}`); ch.debilities.splice(i, 1); }
    }
    const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    const fwd = num(e.forward, -3, 3);
    if (fwd) { ch.forward = num((ch.forward || 0) + fwd, -3, 3); bits.push(`전진 ${sg(fwd)}`); }
    const ong = num(e.ongoing, -3, 3);
    if (ong) { ch.ongoing = num((ch.ongoing || 0) + ong, -3, 3); bits.push(`지속 ${sg(ong)}`); }
    const hold = num(e.hold, -5, 5);
    if (hold) { ch.hold = Math.max(0, (ch.hold || 0) + hold); bits.push(`홀드 ${sg(hold)}`); }
    const xp = num(e.xp, -3, 3);
    if (xp) { ch.xp = Math.max(0, (ch.xp || 0) + xp); bits.push(`경험치 ${sg(xp)}`); }
    if (e.armor !== undefined && e.armor !== null && e.armor !== '') {
      const a = num(e.armor, 0, 5);
      if (a !== ch.armor) { bits.push(`갑옷 ${ch.armor}→${a}`); ch.armor = a; }
    }
    if (ch.xp >= ch.level + 7 && !bits.includes('레벨업 가능')) bits.push('레벨업 가능');
    return bits;
  },

  armor(ch) { return ch.armor || 0; },

  // Last Breath: rolled by the server the moment a character drops to 0 HP.
  onDown(ch) {
    const roll = this.resolveCheck({ move: '마지막 숨', stat: '없음', bonus: 0 }, ch);
    const add = roll.tier === 'good' ? null : roll.tier === 'mixed' ? '죽음과의 거래' : '사망';
    if (add && !ch.conditions.includes(add)) ch.conditions.push(add);
    return roll;
  },

  bondsTask(c, key, { charName, others }) {
    return `## 유대 쓰기
던전 월드에서 유대는 캐릭터들 사이의 감정과 사연이야. 파티가 모두 정해졌으니, 네 캐릭터 ${charName}이(가) 동료들에 대해 품은 유대를 2~3개 써.
동료:
${others.map((o) => `  - [${o.key}] ${o.name} — ${o.concept}`).join('\n')}

예시: "카엘은 내 등을 지켜 준 적이 있다", "미라를 믿을 수 없다", "은하는 이 모험에서 큰 걸 잃게 될 것이다".
유대는 연기의 씨앗이고, 돕기/방해하기 판정에 더해진다.

JSON으로 답해:
{"bonds": [{"with": "동료 키", "text": "유대 문장 (동료 이름을 넣어서)"}]}`;
  },

  mock: {
    character(ctx) {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const shuffled = [...SCORES].sort(() => Math.random() - 0.5);
      return { class: pick(CLASS_NAMES), alignment: pick(ALIGNMENTS), scores: Object.fromEntries(STATS.map((s, i) => [s, shuffled[i]])) };
    },
    check(decl, ctx) {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const move = pick(['위험에 맞서기', '위험에 맞서기', '난타전', '상황 파악', '지식 더듬기', '일제 사격', '수호하기']);
      const foe = ctx?.foes?.[0]?.name;
      return { move, stat: pick(STATS), target: MOVES[move]?.damage ? foe : undefined };
    },
    bonds(ctx) {
      return { bonds: (ctx.others || []).slice(0, 2).map((o) => ({ with: o.key, text: `${o.name}은(는) 내 등을 지켜 준 적이 있다` })) };
    },
  },
};
