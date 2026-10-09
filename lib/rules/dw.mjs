// Dungeon World: 2d6 + stat, 10+ / 7–9 / 6-. The 마스터 never rolls; the players' fiction
// triggers 액션 (moves), a miss marks XP and lets the 마스터 make a move.
//
// Terms and lists (직업, 액션 names, 가치관, 인연, 약화, 예비 …) follow 던전월드 한국어 공개판
// (Sage LaTorra and Adam Koebel; Korean translation by 김성일, 도서출판 초여명), and the move
// summaries are our own shorter wording of it. Both the original and the Korean edition are
// CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).

import { die, rollDice } from '../dice.mjs';
import { str, strList } from '../parse.mjs';

const STATS = ['근력', '민첩성', '체력', '지능', '지혜', '매력'];
// +근 +민 +체 +지 +혜 +매: how the Korean edition writes "roll +STAT".
const ABBR = { 근: '근력', 민: '민첩성', 체: '체력', 지: '지능', 혜: '지혜', 매: '매력', 민첩: '민첩성' };
const SCORES = [16, 15, 13, 12, 9, 8];
const DEBILITY = { 근력: '무기력', 민첩성: '경련', 체력: '쇠약', 지능: '얼떨떨', 지혜: '당황', 매력: '흉터' };
const DEBILITIES = Object.values(DEBILITY);
const ALIGNMENTS = ['선', '질서', '중립', '혼돈', '악'];
const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
const short = (stat) => `+${Object.keys(ABBR).find((k) => ABBR[k] === stat && k.length === 1) || stat}`;

export function modOf(score) {
  if (score <= 3) return -3;
  if (score <= 5) return -2;
  if (score <= 8) return -1;
  if (score <= 12) return 0;
  if (score <= 15) return 1;
  if (score <= 17) return 2;
  return 3;
}

// 액션 the 마스터 can call. stat: fixed stat, null = depends on how (위험 돌파), '인연' = bonds
// with the target, '없음' = no stat. hold: 예비 by result. damage: true = on a hit,
// 'strong' = only on 10+. choose: options after the roll ({strong, weak} = how many);
// an option's dmg changes the damage roll, deal: true deals damage the move did not.
const MOVES = {
  '접근전': { stat: '근력', damage: true, when: '근거리에서 적을 공격할 때',
    strong: '피해를 주고 상대의 공격은 피한다 (원하면 빈틈을 보이는 대신 피해 +1d6)', weak: '피해를 주지만 상대의 공격도 받는다' },
  '사격': { stat: '민첩성', damage: true, when: '멀리서 적을 겨누고 쏠 때',
    strong: '깔끔하게 명중해 피해를 준다', weak: '명중하지만 하나를 고른다',
    choose: { weak: 1, options: [{ text: '쏘려고 움직이다 곤경에 처한다 (마스터가 정한다)' }, { text: '악조건에서 쏜다: 피해 -1d6', dmg: '-1d6' }, { text: '여러 발을 쏜다: 발수 -1' }] } },
  '위험 돌파': { stat: null, when: '닥친 위험을 감수하고 행동하거나 재난에 대처할 때 (힘 +근 / 날램 +민 / 버팀 +체 / 재치 +지 / 의지 +혜 / 사교 +매)',
    strong: '해낸다. 위협은 현실이 되지 않는다', weak: '해내지만 마스터가 더 나쁜 결과, 거래, 곤란한 선택을 내민다' },
  '방어': { stat: '체력', hold: { strong: 3, weak: 1 }, when: '사람·물건·장소를 공격에서 지킬 때',
    strong: '예비 3', weak: '예비 1',
    after: '공격이 오면 예비 1씩: 대신 공격받는다 / 피해·효과를 반으로 / 공격자에게 빈틈, 우리 편 다음 판정 +1 / 레벨만큼 공격자에게 피해. 대상에게서 떨어지면 예비를 잃는다' },
  '지식 더듬기': { stat: '지능', when: '그간 쌓은 지식을 떠올릴 때',
    strong: '마스터가 지금 쓸모 있는 흥미로운 사실을 알려 준다', weak: '흥미로운 사실을 알려 준다. 쓸모 있게 만드는 건 캐릭터의 몫',
    after: '마스터가 그 지식을 언제 어떻게 배웠는지 물을 수 있다' },
  '상황 파악': { stat: '지혜', when: '상황이나 사람을 세심히 살필 때',
    strong: '셋 골라 묻는다', weak: '하나 골라 묻는다', after: '대답을 믿고 행동하면 다음 판정 +1',
    choose: { strong: 3, weak: 1, options: [{ text: '여기서 최근에 무슨 일이 있었나?' }, { text: '무슨 일이 일어나려 하나?' },
      { text: '무엇을 주의해야 하나?' }, { text: '여기서 내게 유용하거나 값진 것은?' }, { text: '이 상황을 장악한 건 누구인가?' },
      { text: '여기서 겉보기와 다른 것은?' }] } },
  '협상': { stat: '매력', when: '상대가 원하거나 꺼리는 것을 쥐고, 그걸 대가로 무언가를 시킬 때',
    strong: '약속만 받고 시키는 대로 한다', weak: '약속을 보장할 무언가를 요구한다' },
  '협조 또는 방해': { stat: '인연', when: '인연이 있는 동료를 돕거나 방해할 때 (그 동료에 대한 인연 수만큼 더한다)',
    strong: '상대의 다음 판정에 +1 또는 -2', weak: '+1 또는 -2를 주지만 자신도 위험·대가·보복을 당한다' },
  '황천길': { stat: '없음', when: 'HP 0으로 쓰러져 죽어 갈 때 (서버가 보너스 없이 2d6을 굴린다)',
    strong: '죽음을 면한다. 의식은 없지만 목숨은 붙어 있다', weak: '사신이 거래를 제안한다. 받아들이면 안정되고, 거부하면 저편으로 떠난다', miss: '운명이 정해졌다. 곧 죽음을 맞는다' },
};

const ARMOR_PASSIVE = '갑옷을 옷처럼: 갑옷의 불편 태그를 무시한다';
const CAST = (fade) => ({ weak: 1, options: [{ text: '곤란한 상황에 처하거나 원치 않는 주의를 끈다 (마스터가 정한다)' }, { text: fade }, { text: '그 주문을 잃는다. 다시 준비할 때까지 쓸 수 없다' }] });

// 직업: base HP (+체력 점수), damage die, armor with the usual starting gear, starting 액션.
const CLASSES = {
  전사: { hp: 10, damage: 'd10', armor: 1,
    passives: [ARMOR_PASSIVE, '고유병기: 이름이나 다름없는 자기만의 무기. 형태·거리·특징 둘·생김새를 정한다'],
    moves: { '창살을 굽히고 문을 들어올린다': { stat: '근력', when: '순전히 힘으로 물건을 부수거나 들어 올릴 때', strong: '셋 고른다', weak: '둘 고른다',
      choose: { strong: 3, weak: 2, options: [{ text: '오래 걸리지 않는다' }, { text: '주변의 값진 것이 상하지 않는다' }, { text: '큰 소리가 나지 않는다' }, { text: '나중에 어렵지 않게 되돌릴 수 있다' }] } } } },
  성기사: { hp: 10, damage: 'd10', armor: 2,
    passives: [ARMOR_PASSIVE, '신성한 임무: 기도하고 임무를 맹세하면 축복을 둘까지 받고, 마스터가 정한 맹세를 지켜야 한다'],
    moves: {
      '안수치료': { stat: '매력', when: '환자의 맨살에 손을 얹고 그를 위해 기도할 때', strong: '1d8 피해를 치유하거나 질병 하나를 고친다', weak: '낫게 하지만 그 피해나 질병이 내게 옮아 온다' },
      '내가 법이다': { stat: '매력', when: '신이 내린 권위를 내세워 NPC에게 명령할 때', strong: '상대가 따르거나, 물러나 도망치거나, 덤빈다(상대가 고른다). 그리고 그 상대에 대한 다음 판정 +1',
        weak: '상대가 따르거나, 물러나 도망치거나, 덤빈다(상대가 고른다)', miss: '상대는 하고 싶은 대로 하고, 그 상대에 대한 다음 판정 -1' } } },
  사냥꾼: { hp: 8, damage: 'd8', armor: 1,
    passives: ['동물 친구: 충직한 동물 하나가 함께 다닌다 (사나움·교활함·장갑·본능, 특성·훈련·약점)', '명령: 동물 친구가 훈련대로 움직이면 그 수치가 피해·판정·장갑에 더해진다'],
    moves: {
      '사냥과 추적': { stat: '지혜', when: '사람이나 짐승이 남긴 자취를 따라갈 때', strong: '방향이 크게 바뀐 곳까지 쫓아가고, 대상에 관한 유용한 정보나 자취가 끊긴 이유를 알아낸다', weak: '대상이 방향이나 이동 방식을 크게 바꾼 곳까지 쫓아간다' },
      '정조준': { stat: '민첩성', damage: 'strong', when: '방어할 수 없거나 기습당한 적의 머리·팔·다리를 멀리서 노릴 때', strong: '노린 부위의 효과(머리: 휘청 / 팔: 들고 있던 걸 떨어뜨림 / 다리: 느려짐)에 피해까지', weak: '노린 부위의 효과만 (피해 없음)' } } },
  도적: { hp: 6, damage: 'd8', armor: 1,
    passives: ['희박한 도덕관념: 누가 가치관을 탐지하면 거짓으로 보여 줘도 된다', '독의 기술: 고른 독 하나를 3회분 갖고 시작하고, 안전하게 다루며 직접 만들 수 있다'],
    moves: {
      '덫 전문가': { stat: '민첩성', hold: { strong: 3, weak: 1 }, when: '위험한 곳을 잠시 살필 때', strong: '예비 3', weak: '예비 1', after: '그곳을 지나며 예비 1씩: 덫이 있나, 어떻게 발동하나 / 발동하면 어떻게 되나 / 그 밖에 숨겨진 것이 있나' },
      '프로의 솜씨': { stat: '민첩성', when: '자물쇠를 따거나 덫을 해제할 때', strong: '아무 문제 없이 해낸다', weak: '해내지만 마스터가 의심·위험·대가 중 둘을 내민다' },
      '암습': { stat: '민첩성', when: '방어할 수 없거나 기습당한 적을 근거리 무기로 칠 때 (피해 대신 판정)', strong: '둘 고른다', weak: '하나 고른다',
        choose: { strong: 2, weak: 1, options: [{ text: '근거리 전투에 말려들지 않는다' }, { text: '통상 피해 +1d6을 준다', deal: true, dmg: '+1d6' }, { text: '유리한 상황: 나나 그걸 이용하는 우리 편의 다음 판정 +1' }, { text: '상대의 장갑 -1 (수리할 때까지)' }] } } } },
  마법사: { hp: 4, damage: 'd4', armor: 0,
    passives: ['주문서: 간편주문 전부와 1레벨 주문 셋이 적혀 있다', '주문 준비: 1시간 정독하면 레벨+1까지의 주문을 준비한다', '주문 방어: 지속 중인 주문을 끊어 받는 피해를 그 주문 레벨만큼 줄인다', '마법 의식: 힘이 서린 곳에서 원하는 효과를 만든다. 마스터가 조건을 1~4개 내민다'],
    moves: { '주문 시전': { stat: '지능', when: '준비한 주문을 쓸 때', strong: '부작용 없이 시전된다', weak: '시전되지만 하나 고른다', choose: CAST('현실이 흔들린다: 다시 준비할 때까지 주문 시전 -1') } } },
  사제: { hp: 8, damage: 'd6', armor: 1,
    passives: ['신: 모시는 신의 이름과 관장 영역, 핵심 교리를 정한다', '탄원: 교리대로 탄원하면 신의 영역에 관한 지식이나 도움을 받는다', '예배: 1시간 예배하면 레벨+1까지의 주문을 받는다'],
    moves: {
      '언데드 퇴치': { stat: '지혜', when: '성표를 높이 들고 신의 보호를 청할 때', strong: '언데드가 닿지 못하고, 지성 있는 것은 잠시 넋을 잃고 지성 없는 것은 달아난다', weak: '기도하는 동안 언데드가 닿는 거리까지 오지 못한다' },
      '주문 시전': { stat: '지혜', when: '신에게 받은 주문을 쓸 때', strong: '부작용 없이 시전된다', weak: '시전되지만 하나 고른다', choose: CAST('신과 멀어진다: 다시 예배할 때까지 주문 시전 -1') } } },
  드루이드: { hp: 6, damage: 'd6', armor: 1,
    passives: ['대지의 아들/딸: 결연된 땅을 정하고 그 땅의 짐승으로 변신할 수 있다. 몸에 그 땅의 증표가 있다', '자연의 보살핌: 먹거나 마시지 않아도 산다', '신령어: 결연된 땅이나 연구한 동물의 말을 알아듣는다', '본질의 연구: 어느 동물의 신령을 묵상하면 그 동물로도 변신할 수 있다'],
    moves: { '변신': { stat: '지혜', hold: { strong: 3, weak: 2, miss: 1 }, when: '신령들에게 부탁해 모습을 바꿀 때', strong: '예비 3', weak: '예비 2', miss: '예비 1, 하지만 마스터가 정한 일이 벌어진다',
      after: '예비 1로 마스터가 제시한 그 모습의 액션을 판정 없이 한다. 예비가 다 떨어지면 원래 모습으로 돌아온다' } } },
  음유시인: { hp: 6, damage: 'd6', armor: 0,
    passives: ['시인의 학식: 분야를 하나 정한다. 그 분야의 중요한 것을 처음 보면 마스터에게 하나 묻는다', '진솔한 대화: 솔직하게 이야기하면 서로 정해진 질문 하나씩을 묻고 사실대로 답한다', '추억의 거리: 전에 가 본 곳에 돌아오면 그사이 바뀐 것을 마스터가 알려 준다'],
    moves: { '마법의 곡조': { stat: '매력', when: '음악으로 마법을 엮어 우리 편 하나를 도울 때', strong: '고른 효과가 일어난다', weak: '효과는 일어나지만 원치 않는 주의를 끌거나 다른 대상에게도 퍼진다',
      choose: { strong: 1, weak: 1, options: [{ text: '1d8 피해 치유' }, { text: '다음에 주는 피해 +1d4' }, { text: '정신에 걸린 마법 하나 해제' }, { text: '다음에 누가 협조하면 +1 대신 +2' }] } } } },
};
const CLASS_NAMES = Object.keys(CLASSES);

// 인연 sentences each class starts with (the blank is another player character).
const BONDS = {
  전사: ['자기가 인정하건 아니건, ___는 내게 목숨빚을 졌다.', '나는 ___를 지키기로 맹세했다.', '___가 던전에서 살아남지 못할까 봐 걱정된다.', '___는 여리다. 하지만 내가 강하게 만들어 주리라.'],
  성기사: ['___는 행동거지를 고치지 않으면 영혼이 위험해질 것이다!', '___는 나와 어깨를 나란히 하고 싸웠다. 완전히 믿을 만하다.', '___의 신앙은 존중하지만, 언젠가 참된 길을 찾았으면 좋겠다.', '___는 용감하다. 내가 배울 점이 많다.'],
  사냥꾼: ['___는 전에 내 길안내를 받았으니 내게 빚을 진 셈이다.', '___는 자연의 친구이니 나도 친구가 되겠다.', '___는 자연을 존중하지 않으니 내 존중도 받지 못한다.', '___는 야외에서 사는 법을 모르니 내가 가르쳐야겠다.'],
  도적: ['___에게서 무언가를 훔쳤다.', '일이 꼬이면 ___가 나를 도와줄 것이다.', '___는 내가 저지른 범죄의 증거를 갖고 있다.', '___와 나는 같이 꾸미는 일이 있다.'],
  마법사: ['내가 예언하건대, ___는 다가올 미래에 중요한 역할을 할 것이다!', '___는 내게 중요한 비밀을 감추고 있다.', '___는 세상을 몰라도 너무 모른다. 내가 아는 건 다 가르쳐야겠다.'],
  사제: ['___는 내가 모시는 신을 모독했다. 믿을 수 없는 자다.', '___는 선량하고 신심이 깊다. 절대적으로 믿을 만하다.', '___는 늘 위험에 처해 있다. 내가 지켜 주어야겠다.', '___를 우리 종교로 개종시키는 중이다.'],
  드루이드: ['___는 먹는 자보다 먹히는 자의 냄새가 난다.', '___의 뒤에 큰 위험이 따른다고 신령들이 일러 주었다.', '나는 ___에게 대지의 비밀 의식을 보여 주었다.', '___와 나는 서로의 피를 맛보아 엮인 사이다.'],
  음유시인: ['___와는 전에도 함께 모험한 적이 있다.', '___에 관한 노래를 만나기 훨씬 전부터 불렀다.', '나는 ___를 자주 골탕 먹인다.', '나는 ___의 모험을 시로 기록하는 중이다.', '___는 내게 비밀 하나를 털어놓았다.', '___는 나를 믿지 않는다. 그럴 만한 이유도 있다.'],
};

// Fill a 인연 blank with a name and fix the particle after it (는/은, 를/을, 가/이, 와/과).
export function fillBond(tpl, name) {
  const code = String(name).charCodeAt(String(name).length - 1) - 0xac00;
  const batchim = code >= 0 && code < 11172 && code % 28 !== 0;
  const pair = { 는: '은', 를: '을', 가: '이', 와: '과' };
  return String(tpl).replace(/_{3,}(는|를|가|와)?/, (_, p) => `${name}${p ? (batchim ? pair[p] : p) : ''}`);
}

// Older saves used other words: map them onto the Korean edition's.
const OLD_CLASS = { 레인저: '사냥꾼', 도둑: '도적' };
const OLD_DEBILITY = { 쇠약: '무기력', 떨림: '경련', 병약: '쇠약', 멍함: '얼떨떨', 혼란: '당황' };

function moveDef(name, cls) {
  return MOVES[name] || CLASSES[cls]?.moves?.[name] || null;
}

// What tables call the moves: 위기 돌파 for 위험 돌파, 난투 for 접근전 …
const ALIAS = { 위기돌파: '위험 돌파', 난투: '접근전', 근접전: '접근전', 지식: '지식 더듬기', 상황판단: '상황 파악', 교섭: '협상', 협조: '협조 또는 방해', 방해: '협조 또는 방해' };

function findMove(text, cls) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t) return null;
  if (ALIAS[t]) return ALIAS[t];
  const names = [...Object.keys(MOVES), ...Object.keys(CLASSES[cls]?.moves || {})];
  return names.find((n) => n.replace(/\s+/g, '') === t)
    || names.find((n) => t.includes(n.replace(/\s+/g, '')) || n.replace(/\s+/g, '').includes(t))
    || null;
}

// "민첩성", "+민", "민" → 민첩성
function statOf(s) {
  const t = String(s || '').replace(/^\+/, '').trim();
  return STATS.find((x) => t.includes(x)) || ABBR[t] || ABBR[t.slice(0, 1)] || null;
}

const classOf = (s) => CLASS_NAMES.find((n) => String(s || '').includes(n)) || OLD_CLASS[Object.keys(OLD_CLASS).find((n) => String(s || '').includes(n))] || null;

// A move named in passing in a player's own words: "지식 굴림 할게요", "난투 할게요",
// "위기돌파 굴릴게요". Only with a word that asks for a roll, so "방어구가 녹았어" names nothing.
export function moveIn(text, cls) {
  const t = String(text || '').replace(/s+/g, '');
  if (!/(굴림|굴릴|굴려|굴리|판정|할게|할래|할께|갈게|쓸게|써볼)/.test(t)) return null;
  const names = [...Object.keys(MOVES), ...Object.keys(CLASSES[cls]?.moves || {})].map((n) => [n.replace(/s+/g, ''), n]);
  const all = [...names, ...Object.entries(ALIAS)].sort((a, b) => b[0].length - a[0].length);
  const hit = all.find(([k]) => t.includes(k));
  return hit ? hit[1] : null;
}

export function effMod(ch, stat) {
  const base = modOf(ch?.scores?.[stat] ?? 10);
  return base - ((ch?.debilities || []).includes(DEBILITY[stat]) ? 1 : 0);
}

// Scores must be a permutation of 16 15 13 12 9 8. Anything else: rank the given
// numbers (missing = 0) and hand out the array in that order.
export function normalizeScores(input = {}) {
  const given = STATS.map((s) => Number(input?.[s] ?? (s === '민첩성' ? input?.민첩 : undefined)) || 0);
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

// What tables call the results (the rulebook only says 10+ / 7~9 / 6-).
const TIER_LABEL = { good: '성공', mixed: '부분 성공', bad: '실패' };
// A foe that falls to one of a PC's hits is a minion (잔챙이): DW's damage dice (d8, d10) put
// HP 6 goblins down in one or two, and the table spent ten rounds on three scouts.
const MINION_BELOW = 10;

// The 마스터 액션 (GM moves) a 6- calls for.
const MASTER_MOVES = ['괴물·위험요소의 액션 쓰기', '다가오는 위협의 징조 보이기', '피해 주기', '자원 소모시키기', '액션을 역이용하기',
  '일행 갈라놓기', '대가를 걸고 기회 주기', '직업의 약점 찌르기', '나쁜 소식 전하기', '곤란한 선택 강요', '위치를 바꾸기'];
// House rule (fullDice, chosen per campaign): double sixes are 풀다이스 and double ones 대실패,
// whatever the modifiers.
const HOUSE_LABEL = { crit: '풀다이스', fumble: '대실패' };

function damageExpr(d) { return /^\d*d\d+/.test(d) ? d : `1${d}`; }

export default {
  id: 'dw',
  label: '던전 월드',
  gmName: '마스터',
  STATS,
  CLASSES,
  MOVES,
  BONDS,
  ALIGNMENTS,

  meta() {
    return {
      id: 'dw', label: '던전 월드', gmName: '마스터', playerName: '플레이어',
      // The rule card on the new-campaign screen (see the selection-card-copy skill).
      icon: '🐉', tags: ['2d6', '직업 8종'],
      intro: ['던전에 뛰어들어 괴물과 맞서는 영웅들의 이야기입니다.', '주사위가 빗나가도 이야기는 멈추지 않고 더 위험해집니다.'],
      signature: { name: '성공, 그런데…', text: '성공과 실패 사이에 "해냈지만 대가가 따르는" 결과가 자주 나와요. 자물쇠는 열었는데 경비가 그 소리를 들은 것처럼요.' },
      stats: STATS, statKind: 'score', scores: SCORES,
      statDefaults: [16, 13, 15, 8, 12, 9],
      fields: [{ name: 'class', label: '직업', options: CLASS_NAMES }, { name: 'alignment', label: '가치관', options: ALIGNMENTS }],
      moves: Object.entries(MOVES).filter(([n]) => n !== '황천길').map(([n, m]) => ({ name: n, stat: m.stat })),
      // Optional rules the new-campaign screen offers; on: checked by default.
      houseRules: [{ id: 'fullDice', label: '풀다이스 · 대실패', text: '주사위가 6·6이면 합과 관계없이 성공, 1·1이면 합과 관계없이 실패예요.', on: true }],
      // What each move (basic and every class's) does, for the tooltip on a move's name.
      moveInfo: Object.fromEntries([...Object.entries(MOVES), ...Object.values(CLASSES).flatMap((c) => Object.entries(c.moves || {}))]
        .map(([n, m]) => [n, { stat: m.stat, when: m.when, strong: m.strong, weak: m.weak, miss: m.miss || '마스터가 액션을 한다 (경험치 +1)', after: m.after || '' }])),
    };
  },

  // The house rules in force, as the models read them.
  houseText: {
    fullDice: '주사위 둘이 모두 6이면 풀다이스(합과 관계없이 성공, 기대 이상으로 잘 된다), 모두 1이면 대실패(합과 관계없이 실패, 특히 나쁘게 꼬인다).',
  },

  // A move a player names in passing ("위험 돌파 (사교 +매) 또는 협상") → the move's name.
  moveName(text, ch) {
    return findMove(text, ch?.class);
  },
  // … or in a player's own words ("지식 굴림 할게요").
  moveIn(text, ch) {
    return moveIn(text, ch?.class);
  },

  rulesText: `## 규칙 (던전 월드, 용어는 한국어 공개판)
- 능력치 6개: ${STATS.join('·')}. 16·15·13·12·9·8을 하나씩 나눠 가진다. 능력수정치(+근 +민 +체 +지 +혜 +매): 16~17 +2, 13~15 +1, 9~12 0, 6~8 -1.
- 액션: 캐릭터의 행동이 액션의 조건에 맞으면 2d6 + 능력수정치로 판정한다. 10+ 성공 / 7~9 부분 성공(대가·곤란한 선택) / 6- 실패(마스터가 액션을 하고, 굴린 사람은 경험치 +1).
- 약화(${STATS.map((s) => `${DEBILITY[s]} ${short(s)}`).join(', ')})는 그 능력치 판정에 -1. "다음 판정 +1"은 한 번만, "계속 +1"은 조건이 끝날 때까지 더해진다. 예비는 액션이 주는, 나중에 쓰는 점수다.
- HP = 직업 기본값 + 체력. 피해는 주사위로(직업의 기본 피해, 괴물의 피해) 굴리고 장갑만큼 줄어든다. HP 0이면 쓰러져 "황천길"을 굴린다.
- 인연: 동료에 대한 인연 문장의 수가 그 동료에 대한 인연 수치다. 협조 또는 방해 판정에 더해진다.
- 주사위는 테이블 서버가 굴린다. 마스터는 절대 굴리지 않고, 누구도 결과를 지어내지 않는다.

## 기본 액션
${Object.entries(MOVES).map(([n, m]) => `- ${n} (${m.stat ? (STATS.includes(m.stat) ? short(m.stat) : m.stat) : '하는 방식에 맞는 능력치'}): ${m.when}. 10+ ${m.strong} / 7~9 ${m.weak}${m.after ? ` (${m.after})` : ''}`).join('\n')}`,

  gmPrinciples: `- 너는 마스터야. 마스터의 의제: 세계를 환상적으로 그려라 / 캐릭터들의 삶을 모험으로 채워라 / 무슨 일이 일어날지 보려고 플레이하라(결말을 미리 정해 두지 마).
- 판정을 일으키는 건 허구다. 캐릭터의 행동이 액션의 조건에 맞을 때만 그 액션으로 판정을 요청하고, 아니면 그냥 결과를 서술해.
- 하려면 실제로 해야 한다. 방어는 지키는 대상 곁에 있어야, 접근전은 손이 닿아야, 사격은 쏠 수 있는 자리와 화살이 있어야 일어난다. 그 조건을 따로 굴릴지, 행동의 판정에 접어 넣을지는 아래 마스터 성향을 따른다.
- 10+는 원하는 걸 준다. 7~9는 얻되 대가·곤란한 선택·더 나쁜 결과가 붙는다. 6-는 네가 마스터 액션을 한다.
- 마스터 액션: ${MASTER_MOVES.join(' / ')}. 액션을 한 뒤에는 "어떻게 하시겠습니까?"라고 물어.
- 강한 액션(즉시 피해 같은)은 6-가 나왔거나 플레이어가 기회를 넘겼을 때만. 평소엔 부드러운 액션으로 위협을 먼저 보여 줘.
- 플레이어에게 질문하고 그 답을 세계에 써라. 서술 끝에 특정 캐릭터에게 질문을 던져도 좋다 ("아본, 그 로브는 어느 세계에서 온 것입니까?"). 묻는 건 그 캐릭터 자신에 대해서만. 플레이어가 처음 보는 NPC나 사건을 아는 것처럼 묻지 말고, 그런 건 네가 먼저 알려 줘.
- 액션 이름을 대사처럼 말하지 말고 허구로 보여 줘. 단 판정 요청(checks)에는 액션 이름을 정확히 써.
- 지도를 그리되 빈칸을 남겨라. 정해 둔 정답, 해법, 장면 순서는 없다. 숨겨진 진실과 빈칸은 플레이 중에 플레이어의 행동과 판정 결과를 보고 그 자리에서 정한다.
  · 플레이어가 판을 바꾸려는 계획을 내면("버팀목을 무너뜨려 가둔다", "족장과 손잡고 깊은 곳의 그것을 막는다") 네 메모에 없던 길이어도 그게 해법이다. 받아들여 판정을 걸고, 성공하면 그 계획대로 판이 바뀐다. 메모의 흐름으로 되돌리지 마.
  · 판정 없는 행동은 한 대로 된다. 플레이어가 찾지 않은 단서나 정보를 행동마다 끼워 넣지 마.
  · 플레이어가 어떤 방법으로든 위험요소를 막거나 풀어냈으면 facts에 상태(위험요소 이름, 막힘)을 적어. 좋은 결말이 그걸로 걸려 있다.
- 잔챙이(고블린 졸개, 쥐 떼, 산적 졸개. 이름을 붙인 졸개나 졸개 무리의 우두머리도)는 foes에 올리지 마. 서버는 HP ${MINION_BELOW} 미만의 적을 받지 않는다.
  · 잔챙이는 PC의 판정 하나가 성공하면(7~9도) 끝난다. 그 자리에서 죽거나, 비명을 지르며 달아나거나, 무기를 내던지고 항복해 협조한다(길 안내, 아는 걸 털어놓기, 동료를 배신하기). 팔에 화살을 맞고 웅크리거나 상처 입은 채 버티게 하지 마. 공격이 아니어도(걷어차기, 위협, 흥정) 잔챙이를 상대로 한 판정이 성공하면 마찬가지다.
  · 끝나는 순간을 찰지게 그려라: 몸이 어떻게 꺾이고, 무엇을 떨어뜨리고, 무슨 소리를 내는지. 그리고 남은 놈들이 어떻게 반응하는지(겁에 질려 흩어진다, 무기를 버린다, 우두머리를 부른다).
  · 7~9의 대가는 그 잔챙이를 살려 두는 게 아니다. 다른 데서 온다: 다른 놈의 화살, 무너지는 발판, 떨어뜨린 무기, 흘려보낸 시간.
- 한 번에 안 쓰러지는 강적만 foes에 이름·HP·장갑·피해 주사위로 올려(HP: 보통 ${MINION_BELOW}~12, 강함 14~18). PC의 피해 액션은 서버가 직업의 기본 피해를 굴려 target 적에게 자동으로 깎는다. 이야기의 큰 적은 보스로 올린다(아래 보스 규칙).
- 적이 PC에게 피해를 주면 effects에 "damage": "d8"처럼 피해 주사위를 적어(서버가 굴리고 장갑만큼 뺀다). 장갑을 뚫는 공격은 "ignore_armor": true.`,

  missMoves: MASTER_MOVES,
  // The truth is decided in play, not laid out as clue paths in advance (see CLUE_GUIDE).
  cluePaths: false,
  // Moves whose success is something learned; any other success changes the situation.
  infoMoves: ['상황 파악', '지식 더듬기'],
  // Foes weaker than this are minions: kept off the foe list, down to one successful hit.
  minionBelow: MINION_BELOW,
  // Moves that need their target close: the server checks them against the ledger's 위치 facts.
  reach: ['방어', '접근전', '암습'],

  playerPrinciples: `- 행동은 허구로, "시도"로 선언해. 결과는 마스터와 주사위가 정해. ("자물쇠를 따 본다" O / "자물쇠를 따서 문을 연다" X)
- 액션 이름을 외칠 필요는 없다. 판정할지, 어떤 액션인지는 마스터가 정해.
- 동료를 돕거나 막거나(협조 또는 방해), 인연에 걸린 감정을 연기하면 이야기가 살아나.`,

  characterTask() {
    return {
      rules: `- 직업은 ${CLASS_NAMES.join(' / ')} 중 하나. 동료와 겹치면 안 돼.
- 능력치 16·15·13·12·9·8을 여섯 능력치에 하나씩 배정해 (직업의 액션에 쓰는 능력치에 높은 값).
- 가치관은 ${ALIGNMENTS.join(' / ')} 중 하나.
- 소지품은 3~5개, 직업과 캐릭터다운 걸로.`,
      shape: `{
  "name": "이름",
  "class": "${CLASS_NAMES.join('|')}",
  "concept": "한 줄 소개 (예: 신앙을 잃어 가는 성기사)",
  "alignment": "${ALIGNMENTS.join('|')}",
  "appearance": "외모 (눈·머리·옷·몸)",
  "personality": "성격과 말투",
  "background": "배경과 이번 모험에 낀 이유 (2~3문장)",
  "scores": {${STATS.map((s, i) => `"${s}": ${SCORES[i]}`).join(', ')}},
  "items": ["소지품"],
  "note": "(선택) 개인 메모에 적어 둘 캐릭터 비밀이나 목표"
}`,
    };
  },

  makeCharacter(raw) {
    const cls = classOf(raw.class) || CLASS_NAMES[Math.floor(Math.random() * CLASS_NAMES.length)];
    const scores = normalizeScores(raw.scores || raw.stats);
    const c = CLASSES[cls];
    const align = String(raw.alignment || '').replace('법', '질서');
    const armor = Number(raw.armor);
    return {
      class: cls,
      concept: str(raw.concept, 120) || cls,
      alignment: ALIGNMENTS.find((a) => align.includes(a)) || '중립',
      level: 1, xp: 0,
      scores,
      stats: Object.fromEntries(STATS.map((s) => [s, modOf(scores[s])])),
      maxHp: c.hp + scores.체력,
      // The builder sends the armor its chosen gear gives; otherwise the class's usual.
      armor: Number.isFinite(armor) && raw.armor !== null && raw.armor !== '' ? Math.max(0, Math.min(4, Math.round(armor))) : c.armor,
      damage: c.damage,
      debilities: [],
      forward: 0, ongoing: 0, hold: 0,
      bonds: Array.isArray(raw.bonds) ? raw.bonds.map((b) => ({ with: str(b?.with, 40), text: str(b?.text, 200) })).filter((b) => b.text).slice(0, 6) : [],
    };
  },

  // A sheet saved before the Korean-edition terms: rename class, stat, alignment, debilities.
  migrate(ch) {
    if (ch.scores?.민첩 !== undefined) {
      ch.scores = normalizeScores(ch.scores);
      ch.stats = Object.fromEntries(STATS.map((s) => [s, modOf(ch.scores[s])]));
      ch.debilities = (ch.debilities || []).map((x) => OLD_DEBILITY[x] || x);
    }
    ch.class = classOf(ch.class) || ch.class;
    if (ch.alignment === '법') ch.alignment = '질서';
  },

  sheetLine(ch, { full } = {}) {
    let line = `${ch.class} Lv${ch.level} | HP ${ch.hp}/${ch.maxHp} | 장갑 ${ch.armor} | 피해 ${ch.damage} | ${STATS.map((s) => `${s}${sg(effMod(ch, s))}`).join(' ')}`;
    if (ch.debilities?.length) line += ` | 약화: ${ch.debilities.join(', ')}`;
    if (ch.forward) line += ` | 다음 판정 ${sg(ch.forward)}`;
    if (ch.ongoing) line += ` | 계속 ${sg(ch.ongoing)}`;
    if (ch.hold) line += ` | 예비 ${ch.hold}`;
    if (full) {
      const moves = Object.keys(CLASSES[ch.class]?.moves || {});
      if (moves.length) line += `\n    직업 액션: ${moves.join(', ')}`;
      if (ch.bonds?.length) line += `\n    인연: ${ch.bonds.map((b) => b.text).join(' / ')}`;
    }
    return line;
  },

  sheetView(ch) {
    const cls = CLASSES[ch.class] || {};
    const badges = [`${ch.class} Lv${ch.level}`, `가치관 ${ch.alignment}`, `경험치 ${ch.xp}/${ch.level + 7}`, `장갑 ${ch.armor}`, `피해 ${ch.damage}`];
    if (ch.forward) badges.push(`다음 판정 ${sg(ch.forward)}`);
    if (ch.ongoing) badges.push(`계속 ${sg(ch.ongoing)}`);
    if (ch.hold) badges.push(`예비 ${ch.hold}`);
    return {
      badges,
      stats: STATS.map((s) => ({ label: s, value: sg(effMod(ch, s)), sub: String(ch.scores?.[s] ?? ''), warn: (ch.debilities || []).includes(DEBILITY[s]) })),
      tracks: [{ label: 'HP', value: ch.hp, max: ch.maxHp }],
      lists: [
        { title: '직업 액션', items: [...Object.entries(cls.moves || {}).map(([n, m]) => `${n} (${short(m.stat)}): ${m.when}`), ...(cls.passives || [])] },
        { title: '인연', items: (ch.bonds || []).map((b) => b.text) },
        { title: '약화', items: ch.debilities || [] },
      ].filter((l) => l.items.length),
    };
  },

  checkGuide: `- 플레이어의 행동이 액션의 조건에 맞을 때만 checks에 넣어. "move"는 기본 액션 이름이나 그 캐릭터의 직업 액션 이름을 정확히.
- 위험 돌파는 다른 액션이 맞지 않을 때 쓴다. 먼저 맞는 액션을 찾아: 적을 치면 접근전·사격, 누굴 지키면 방어, 살피면 상황 파악, 기억을 떠올리면 지식 더듬기, 쥔 것으로 흥정하면 협상, 동료를 도우면 협조 또는 방해, 직업 액션의 조건에 맞으면 그 액션.
- 위험 돌파처럼 능력치가 정해지지 않은 액션은 캐릭터가 실제로 하는 방식으로 "stat"을 골라 (힘으로 밀어붙임=근력, 날래게 피함=민첩성, 몸으로 버팀=체력, 재치=지능, 의지력=지혜, 매력과 사교술=매력). 플레이어가 고른 방식을 바꿔 약한 능력치로 굴리게 하지 마.
- 피해를 주는 액션(접근전·사격·정조준·암습)은 "target"에 맞는 적의 이름을. foes에 없는 잔챙이도 이름(뾰족귀, 고블린 궁수)을 적어. 서버가 잔챙이로 처리한다. 협조 또는 방해는 "target"에 대상 캐릭터 키를.
- 같은 라운드에 누가 협조에 성공했다면 그 대상의 판정에 "bonus": 1 (방해면 -2).`,
  checkSchema: `{"who": "캐릭터 키", "move": "액션 이름", "stat": "(위험 돌파일 때) ${STATS.join('|')}", "target": "(선택) 적 이름 또는 캐릭터 키", "bonus": 0, "against": "(선택) 보스를 상대하는 행동이면 그 보스 이름", "why": "10자 안팎 꼬리표 (예: 망치 뺏기)"}`,

  normalizeCheck(x, ch) {
    const move = findMove(x.move, ch?.class) || '위험 돌파';
    const def = moveDef(move, ch?.class);
    const stat = def?.stat || statOf(x.stat) || '민첩성';
    const bonus = Math.max(-3, Math.min(3, Math.round(Number(x.bonus) || 0)));
    return { move, stat, target: str(x.target, 60), bonus, why: str(x.why, 40) };
  },

  // The acting character's class moves, put where the GM decides the move: tucked into the
  // party sheet, they lost to 위험 돌파 (a 도적 picking a lock rolled 위험 돌파, not 프로의 솜씨).
  turnMoves(ch) {
    const moves = Object.entries(CLASSES[ch?.class]?.moves || {});
    if (!moves.length) return '';
    return `- ${ch.name}(${ch.class})의 직업 액션. 하려는 행동이 이 조건에 맞으면 위험 돌파가 아니라 이 액션이다:\n${moves.map(([n, m]) => `  · ${n} (${short(m.stat)}): ${m.when}`).join('\n')}\n`;
  },

  checkLabel(p) { return `${p.move}${p.stat && !['없음', '인연'].includes(p.stat) ? ` ${short(p.stat)}` : ''}`; },

  // /check 아본 위험 돌파 민첩성  ·  /check 그레고르 접근전 고블린
  commandCheck(words, ch) {
    const text = words.join(' ');
    const move = findMove(text.split(/\s+/).slice(0, 3).join(' '), ch?.class) || findMove(words[0], ch?.class);
    if (!move) return `액션을 못 찾았어요. 예: /check 아본 위험 돌파 민첩성, /check 그레고르 접근전 고블린 (액션: ${Object.keys(MOVES).join(', ')})`;
    const rest = text.replace(new RegExp(move.split(/\s*/).join('\\s*')), '').trim().split(/\s+/).filter(Boolean);
    const stat = statOf(rest[0]);
    return this.normalizeCheck({ move, stat, target: stat ? rest.slice(1).join(' ') : rest.join(' ') }, ch);
  },

  resolveCheck(check, ch, ctx = {}) {
    const def = moveDef(check.move, ch?.class) || {};
    const notes = [];
    let mod = 0;
    if (check.stat === '인연') mod = bondsWith(ch, check.target, ctx);
    else if (check.stat !== '없음') mod = effMod(ch, check.stat);
    if (check.move !== '황천길') {
      if (ch.forward) { mod += ch.forward; notes.push(`다음 판정 ${sg(ch.forward)} 사용`); ch.forward = 0; }
      if (ch.ongoing) mod += ch.ongoing;
    }
    mod += check.bonus || 0;
    const dice = [die(6), die(6)];
    const total = dice[0] + dice[1] + mod;
    const house = !ctx.house?.fullDice ? null : dice[0] === 6 && dice[1] === 6 ? 'crit' : dice[0] === 1 && dice[1] === 1 ? 'fumble' : null;
    const tier = house === 'crit' ? 'good' : house === 'fumble' ? 'bad' : total >= 10 ? 'good' : total >= 7 ? 'mixed' : 'bad';
    if (tier === 'bad' && check.move !== '황천길') { ch.xp = (ch.xp || 0) + 1; notes.push('경험치 +1'); }
    const held = def.hold?.[tier === 'good' ? 'strong' : tier === 'mixed' ? 'weak' : 'miss'];
    if (held) {
      ch.hold = (ch.hold || 0) + held;
      notes.push(`예비 +${held}`);
    }
    let damage = null;
    if ((def.damage === true && tier !== 'bad') || (def.damage === 'strong' && tier === 'good')) damage = rollDamage(ch, check.target);
    const text = tier === 'good' ? def.strong : tier === 'mixed' ? def.weak : (def.miss || '마스터가 액션을 한다');
    const statLabel = check.stat === '없음' ? '' : check.stat === '인연' ? ` +인연(${mod - (check.bonus || 0)})` : ` ${short(check.stat)}`;
    return {
      move: check.move, stat: check.stat, dice, mod, total, tier,
      title: `${check.move}${statLabel}${check.bonus ? ` (${sg(check.bonus)})` : ''}`,
      target: '10+ / 7~9 / 6-',
      label: HOUSE_LABEL[house] || TIER_LABEL[tier],
      ...(house ? { house } : {}),
      text: text || '',
      after: tier !== 'bad' ? def.after || '' : '',
      aim: check.target || '',
      damage, notes,
    };
  },

  followUp(roll, ch) {
    // 황천길 7~9: Death's bargain. The 마스터 names the price before the player sees it (the
    // engine fills in the options); 0 takes the deal, 1 refuses it.
    if (roll.move === '황천길') {
      return roll.tier === 'mixed' ? { prompt: '사신이 거래를 내밉니다. 받아들이면 목숨은 건지지만 대가를 치러야 해요. 거부하면 저편으로 떠납니다.', options: ['받아들인다', '거부한다'], count: 1, bargain: true } : null;
    }
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
    // Taking Death's deal: alive, still out cold, and owing. Refusing it: gone.
    if (roll.move === '황천길') {
      const accept = picks[0] === 0;
      ch.conditions = ch.conditions.filter((x) => x !== '사신과의 거래');
      ch.conditions.push(accept ? '사신의 빚' : '사망');
      roll.chosen = [accept ? '거래를 받아들인다' : '거래를 거부한다'];
      return { bargain: accept ? 'accept' : 'refuse' };
    }
    const def = moveDef(roll.move, ch?.class);
    const opts = def?.choose?.options || [];
    roll.chosen = picks.map((i) => opts[i]?.text).filter(Boolean);
    for (const i of picks) {
      const o = opts[i];
      if (o?.deal && !roll.damage) roll.damage = rollDamage(ch, roll.aim);
      if (o?.ignoreArmor && roll.damage) roll.damage.ignoreArmor = true;
      const d = o?.dmg;
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
    const debility = (d) => DEBILITIES.find((x) => d.includes(x)) || DEBILITY[statOf(d)] || null;
    for (const d of strList(e.debilities_add, 6)) {
      const name = debility(d);
      if (name && !ch.debilities.includes(name)) { ch.debilities.push(name); bits.push(`약화 +${name}`); }
    }
    for (const d of strList(e.debilities_remove, 6)) {
      const name = debility(d);
      const i = ch.debilities.indexOf(name);
      if (i >= 0) { bits.push(`약화 -${name}`); ch.debilities.splice(i, 1); }
    }
    const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    const fwd = num(e.forward, -3, 3);
    if (fwd) { ch.forward = num((ch.forward || 0) + fwd, -3, 3); bits.push(`다음 판정 ${sg(fwd)}`); }
    const ong = num(e.ongoing, -3, 3);
    if (ong) { ch.ongoing = num((ch.ongoing || 0) + ong, -3, 3); bits.push(`계속 ${sg(ong)}`); }
    const hold = num(e.hold, -5, 5);
    if (hold) { ch.hold = Math.max(0, (ch.hold || 0) + hold); bits.push(`예비 ${sg(hold)}`); }
    const xp = num(e.xp, -3, 3);
    if (xp) { ch.xp = Math.max(0, (ch.xp || 0) + xp); bits.push(`경험치 ${sg(xp)}`); }
    if (e.armor !== undefined && e.armor !== null && e.armor !== '') {
      const a = num(e.armor, 0, 5);
      if (a !== ch.armor) { bits.push(`장갑 ${ch.armor}→${a}`); ch.armor = a; }
    }
    if (ch.xp >= ch.level + 7 && !bits.includes('레벨업 가능')) bits.push('레벨업 가능');
    return bits;
  },

  armor(ch) { return ch.armor || 0; },

  // 황천길: rolled by the server the moment a character drops to 0 HP.
  onDown(ch) {
    const roll = this.resolveCheck({ move: '황천길', stat: '없음', bonus: 0 }, ch);
    const add = roll.tier === 'good' ? null : roll.tier === 'mixed' ? '사신과의 거래' : '사망';
    if (add && !ch.conditions.includes(add)) ch.conditions.push(add);
    return roll;
  },

  bondsTask(c, key, { charName, others }) {
    const ch = c.characters?.[key];
    const tpls = BONDS[ch?.class] || [];
    return `## 인연 정하기
던전 월드에서 인연은 동료에 대한 감정과 사연이야. 파티가 모두 정해졌으니, 네 캐릭터 ${charName}의 인연을 2~3개 정해.
동료:
${others.map((o) => `  - [${o.key}] ${o.name} — ${o.concept}`).join('\n')}

${tpls.length ? `${ch.class}의 인연 문장 (빈칸에 동료 이름만 넣어. 사연을 덧붙여 문장을 늘이지 마. 한 문장, 40자 안팎):\n${tpls.map((t) => `  - ${t}`).join('\n')}\n` : ''}
인연은 연기의 씨앗이고, 협조 또는 방해 판정에 더해진다.

JSON으로 답해:
{"bonds": [{"with": "동료 키", "text": "인연 문장 (동료 이름을 넣어서)"}]}`;
  },

  mock: {
    character(ctx) {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const shuffled = [...SCORES].sort(() => Math.random() - 0.5);
      return { class: pick(CLASS_NAMES), alignment: pick(ALIGNMENTS), scores: Object.fromEntries(STATS.map((s, i) => [s, shuffled[i]])) };
    },
    check(decl, ctx) {
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const move = pick(['위험 돌파', '위험 돌파', '접근전', '상황 파악', '지식 더듬기', '사격', '방어']);
      const foe = ctx?.foes?.[0]?.name;
      return { move, stat: pick(STATS), target: MOVES[move]?.damage ? foe : undefined };
    },
    bonds(ctx) {
      const tpls = BONDS[ctx.class] || BONDS.전사;
      return { bonds: (ctx.others || []).slice(0, 2).map((o, i) => ({ with: o.key, text: fillBond(tpls[i % tpls.length], o.name) })) };
    },
  },
};

function rollDamage(ch, target) {
  const expr = damageExpr(ch?.damage || 'd6');
  const r = rollDice(expr);
  return { expr, detail: r.detail, total: r.total, target: target || '' };
}
