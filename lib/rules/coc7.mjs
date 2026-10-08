// 크툴루의 부름 7판 호환 룰: d100 ≤ skill, success levels (regular / hard / extreme),
// bonus and penalty dice, sanity, Luck, pushed rolls, opposed rolls and combat.
//
// Call of Cthulhu is a trademark of Chaosium Inc. This is an unofficial fan implementation
// of the game's mechanics; no rulebook text is reproduced. Skill names and the wording of
// every prompt are our own.

import { die, rollDice, parseDice } from '../dice.mjs';
import { str, strList } from '../parse.mjs';

const CHARS = ['근력', '건강', '크기', '민첩', '외모', '지능', '정신', '교육'];
const ROLL_3D6 = ['근력', '건강', '민첩', '외모', '정신']; // 3d6×5; the rest (2d6+6)×5

// Starting values. 회피 and 언어(모국어) depend on the character (민첩/2, 교육).
const SKILLS = {
  '회계': 5, '인류학': 1, '감정': 5, '고고학': 1, '예술/공예': 5, '매혹': 15, '오르기': 20, '신용': 0,
  '크툴루 신화': 0, '변장': 5, '회피': 0, '자동차 운전': 20, '전기 수리': 10, '말재주': 5,
  '근접전(격투)': 25, '사격(권총)': 20, '사격(소총/산탄총)': 25, '응급처치': 30, '역사': 5, '위협': 15,
  '도약': 20, '언어(외국어)': 1, '언어(모국어)': 0, '법률': 5, '도서관 이용': 20, '듣기': 20,
  '열쇠공': 1, '기계 수리': 10, '의학': 1, '자연': 10, '항법': 10, '오컬트': 5, '중장비 조작': 1,
  '설득': 10, '조종': 1, '정신분석': 1, '심리학': 10, '승마': 5, '과학': 1, '손재주': 10,
  '관찰력': 25, '은밀행동': 20, '생존술': 10, '수영': 20, '투척': 20, '추적': 10,
};
const SKILL_NAMES = Object.keys(SKILLS);
const ALIASES = {
  격투: '근접전(격투)', 근접전: '근접전(격투)', 주먹: '근접전(격투)', 맨손: '근접전(격투)', 권총: '사격(권총)', 소총: '사격(소총/산탄총)',
  산탄총: '사격(소총/산탄총)', 엽총: '사격(소총/산탄총)', 사격: '사격(권총)', 탐지: '관찰력', 발견: '관찰력', 눈치: '심리학', 잠입: '은밀행동',
  아이디어: '지능', 지식: '교육', 운전: '자동차 운전', 외국어: '언어(외국어)', 모국어: '언어(모국어)', 도서관: '도서관 이용',
  신화: '크툴루 신화', 근력: '근력', 힘: '근력', 체력: '건강', 크툴루: '크툴루 신화', 응급: '응급처치', 자물쇠: '열쇠공',
};
const OCCUPATIONS = ['사립탐정', '기자', '의사', '간호사', '대학 교수', '골동품상', '경찰관', '작가', '사서', '군인', '예술가', '부랑자', '변호사', '성직자', '고고학자'];

const DIFF = { regular: 2, hard: 3, extreme: 4 };
const DIFF_LABEL = { regular: '보통', hard: '어려움', extreme: '극단' };
const RANK = { fumble: 0, fail: 1, regular: 2, hard: 3, extreme: 4, critical: 5 };
const LEVEL_LABEL = { critical: '대성공', extreme: '극단 성공', hard: '어려운 성공', regular: '보통 성공', fail: '실패', fumble: '대실패' };

const clamp = (v, lo, hi, d = lo) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// d100 with bonus/penalty dice (they cancel). One units die, 1 + n tens dice; 00+0 = 100.
export function d100({ bonus = 0, penalty = 0 } = {}) {
  const net = Math.max(-2, Math.min(2, (bonus || 0) - (penalty || 0)));
  const units = die(10) - 1;
  const tens = Array.from({ length: 1 + Math.abs(net) }, () => (die(10) - 1) * 10);
  const vals = tens.map((t) => (t + units === 0 ? 100 : t + units));
  const value = net === 0 ? vals[0] : net > 0 ? Math.min(...vals) : Math.max(...vals);
  return { value, tens, units, net };
}

export function levelOf(roll, skill) {
  if (roll === 1) return 'critical';
  if (skill < 50 ? roll >= 96 : roll === 100) return 'fumble';
  if (roll <= Math.floor(skill / 5)) return 'extreme';
  if (roll <= Math.floor(skill / 2)) return 'hard';
  if (roll <= skill) return 'regular';
  return 'fail';
}

const threshold = (skill, difficulty) => (difficulty === 'extreme' ? Math.floor(skill / 5) : difficulty === 'hard' ? Math.floor(skill / 2) : skill);

function maxOf(expr) {
  const terms = parseDice(expr);
  if (!terms) return 0;
  return terms.reduce((a, t) => a + t.sign * (t.flat !== undefined ? t.flat : (t.keep ? t.keep.n : t.count) * t.sides), 0);
}

export function dbBuild(strSiz) {
  if (strSiz <= 64) return { db: '-2', build: -2 };
  if (strSiz <= 84) return { db: '-1', build: -1 };
  if (strSiz <= 124) return { db: '0', build: 0 };
  if (strSiz <= 164) return { db: '1d4', build: 1 };
  if (strSiz <= 204) return { db: '1d6', build: 2 };
  return { db: '2d6', build: 3 };
}

const withDb = (expr, db) => (db === '0' ? expr : db.startsWith('-') ? `${expr}${db}` : `${expr}+${db}`);

function findSkill(text) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t) return null;
  const all = [...SKILL_NAMES, ...CHARS];
  const exact = all.find((n) => n.replace(/\s+/g, '') === t);
  if (exact) return exact;
  for (const [a, n] of Object.entries(ALIASES)) if (t.includes(a)) return n;
  return all.find((n) => t.includes(n.replace(/\s+/g, '')) || n.replace(/\s+/g, '').includes(t)) || null;
}

function skillValue(ch, name) {
  if (CHARS.includes(name)) return ch.chars?.[name] ?? 50;
  if (ch.skills?.[name] !== undefined) return ch.skills[name];
  return SKILLS[name] ?? 5;
}

function baseOf(name, chars) {
  if (name === '회피') return Math.floor((chars.민첩 || 50) / 2);
  if (name === '언어(모국어)') return chars.교육 || 50;
  return SKILLS[name] ?? 1;
}

// "응급처치 60, 의학 50" or {응급처치: 60}
function parseSkills(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  const out = {};
  for (const part of String(v || '').split(/[,\n·]/)) {
    const m = part.trim().match(/^(.+?)\s*(\d{1,2})\s*%?$/);
    if (m) out[m[1].trim()] = Number(m[2]);
  }
  return out;
}

// One characteristic, or 행운: 3d6×5 or (2d6+6)×5.
function rollOne(name) {
  if (name === '행운' || ROLL_3D6.includes(name)) return rollDice('3d6').total * 5;
  return CHARS.includes(name) ? (rollDice('2d6').total + 6) * 5 : null;
}

function rollChars() {
  return { chars: Object.fromEntries(CHARS.map((c) => [c, rollOne(c)])), luck: rollOne('행운') };
}

function normWeapon(w) {
  const name = str(w?.name, 40);
  if (!name) return null;
  const skill = findSkill(w.skill || name) || '근접전(격투)';
  const damage = parseDice(w.damage) ? String(w.damage).replace(/\s+/g, '') : '1d6';
  return { name, skill, damage, impale: w.impale === true, melee: skill === '근접전(격투)' };
}

function weaponFor(ch, check) {
  const ws = ch.weapons || [];
  const byName = check.weapon && ws.find((w) => w.name.includes(check.weapon) || check.weapon.includes(w.name));
  if (byName) return byName;
  const bySkill = check.skill && ws.find((w) => w.skill === check.skill);
  if (bySkill) return bySkill;
  return { name: '맨손', skill: '근접전(격투)', damage: '1d3', impale: false, melee: true };
}

function rollDamage(weapon, ch, extreme) {
  const db = weapon.melee ? ch.db || '0' : '0';
  const expr = withDb(weapon.damage, db);
  if (!extreme) {
    const r = rollDice(expr);
    return { expr, total: Math.max(0, r.total), detail: r.detail };
  }
  // Extreme success: maximum damage; impaling weapons add a second damage roll.
  let total = maxOf(weapon.damage) + (db === '0' ? 0 : db.startsWith('-') ? Number(db) : maxOf(db));
  let detail = `최대 ${total}`;
  if (weapon.impale) {
    const extra = rollDice(weapon.damage);
    total += extra.total;
    detail += ` + 관통 ${extra.total}`;
  }
  return { expr, total: Math.max(0, total), detail, extreme: true };
}

function skillRoll(value, { bonus, penalty } = {}) {
  const r = d100({ bonus, penalty });
  return { ...r, level: levelOf(r.value, value) };
}

function diceNote(r) {
  if (!r.net) return '';
  return `${r.net > 0 ? '보너스' : '페널티'} ${Math.abs(r.net)} · 십의 자리 [${r.tens.join(', ')}] · 일의 자리 ${r.units}`;
}

const tierOf = (level, pass) => (level === 'critical' ? 'crit' : level === 'fumble' ? 'fumble' : pass ? 'good' : 'bad');

function foeOf(ctx, name) {
  const n = String(name || '').trim();
  const foes = ctx?.foes || [];
  return foes.find((f) => f.name === n) || foes.find((f) => n && (f.name.includes(n) || n.includes(f.name))) || null;
}

function tick(ch, skill, pass) {
  if (!pass || CHARS.includes(skill) || skill === '크툴루 신화') return;
  ch.ticks ??= [];
  if (!ch.ticks.includes(skill)) ch.ticks.push(skill);
}

export default {
  id: 'coc7',
  label: '크툴루의 부름 7판',
  gmName: '키퍼',
  STATS: CHARS,
  SKILLS,

  meta() {
    return {
      id: 'coc7', label: '크툴루의 부름 7판', gmName: '키퍼', playerName: '탐사자',
      // Not offered on the new-campaign screen for now (we are finishing Dungeon World
      // first). The rules still run, and campaigns already made with them still load.
      hidden: true,
      // The rule card on the new-campaign screen (see the selection-card-copy skill).
      icon: '🐙', tags: ['d100', '1920년대'],
      intro: ['평범한 사람들이 감당 못 할 진실을 파헤칩니다.', '살아남아도 제정신으로 돌아온다는 보장은 없습니다.'],
      signature: { name: '이성', text: '끔찍한 것을 볼 때마다 정신이 깎여 나갑니다.' },
      stats: CHARS, statKind: 'percent', statMin: 15, statMax: 90,
      statDefaults: [50, 60, 55, 65, 55, 70, 60, 70],
      fields: [
        { name: 'occupation', label: '직업', options: OCCUPATIONS, free: true, placeholder: '간호사' },
        { name: 'skills', label: '기능 (쉼표로, 기본값보다 올린 것만)', placeholder: '응급처치 60, 의학 50, 관찰력 55, 심리학 45, 신용 30' },
      ],
    };
  },

  rulesText: `## 규칙 (크툴루의 부름 7판 호환)
- 특성치 8개(${CHARS.join('·')})와 기능은 0~99의 백분율. 판정은 d100을 굴려 그 값 이하면 성공.
- 성공 등급: 값 이하 = 보통 성공, 절반 이하 = 어려운 성공, 1/5 이하 = 극단 성공, 01 = 대성공. 실패, 그리고 96~100(값이 50 이상이면 100만) = 대실패.
- 키퍼가 난이도(보통/어려움/극단)를 정하면 그 등급 이상이어야 성공. 유리하면 보너스 주사위, 불리하면 페널티 주사위(십의 자리를 하나 더 굴려 좋은/나쁜 쪽).
- 실패한 기능 판정은 한 번 "밀어붙일" 수 있다(무엇을 다르게 하는지 말하고 다시 굴림). 밀어붙인 판정이 또 실패하면 훨씬 나쁜 일이 생긴다. 대신 행운을 써서 모자란 만큼 깎아 성공시킬 수도 있다(밀어붙인 판정·이성·행운 판정에는 못 씀).
- 이성(SAN): 끔찍한 것을 보면 이성 판정. 성공/실패에 따라 "0/1d6"처럼 정해진 만큼 잃는다. 한 번에 5 이상 잃으면 지능 판정에 성공할 때 일시적 광기. 하루 동안 이성의 1/5 이상을 잃으면 무기한 광기. 0이면 영구 광기.
- 전투: 공격은 기능 판정, 상대는 회피하거나 반격한다(높은 등급이 이김. 회피는 동점이면 회피 쪽, 반격은 동점이면 공격 쪽). 총기는 회피·반격 없이 난이도만. 근접 피해에는 피해 보너스가 붙고, 극단 성공이면 최대 피해(관통 무기는 한 번 더).
- 한 번에 최대 HP의 절반 이상 피해 = 중상. HP 0이면 중상이면 빈사, 아니면 기절.
- 주사위는 테이블 서버가 굴린다. 키퍼도 탐사자도 결과를 지어내지 않는다.`,

  gmPrinciples: `- 너는 키퍼야. 조사와 공포가 중심이다. 핵심 단서는 판정 실패로 영영 막히게 두지 마. 실패하면 단서를 늦게, 대가를 치르고, 위험과 함께 얻게 해.
- 판정을 요청할 땐 난이도(regular/hard/extreme)를 정하고, 상황이 유리·불리하면 bonus/penalty 주사위를 붙여.
- 기능 판정에는 "push_risk"에 '밀어붙였다 또 실패하면 생길 일'을 미리 정해 둬. 밀어붙인 판정이 실패하면 그 대가를 반드시, 크게 치르게.
- 공포는 서서히. 괴물은 처음부터 다 보여 주지 말고 흔적·소리·냄새·징조로 조여 와. 진짜 마주했을 때 이성 판정(type "sanity", loss 예: 시체 "0/1d3", 끔찍한 괴물 "1/1d6"~"1d4/1d10", 고대의 존재 "1d10/1d100").
- 탐사자는 영웅이 아니다. 전투는 치명적이고, 도망·계획·준비가 보상받게 해.
- 탐사자가 얻은 단서는 사실 장부에 단서(이름, 내용)로, 알게 된 탐사자에게 to를 붙여 적어(그 탐사자의 단서 수첩에 쌓인다).
- 적·괴물은 foes에 HP·갑옷·피해(예 "1d6+1d4")·attack(공격 기능 %)·dodge(회피 %)로 등록해.
- 탐사자가 공격하면 type "attack" (target 적 이름, 적의 대응 response: "dodge" | "fight_back" | 총기는 "none"). 적이 탐사자를 공격하면 type "defend" (vs 적 이름, 탐사자의 대응 response: 선언에 맞게 "dodge" 또는 "fight_back", 선언이 없으면 "dodge"). 피해는 서버가 굴려 적용한다.
- 사회적 대결(설득 대 심리학 등)은 type "opposed" (vs_name, vs_skill, vs_value).
- 시나리오가 끝나 탐사자들이 숨을 돌리면 effects에 "development": true(성장 체크한 기능을 굴려 올림), 하룻밤이 지나면 "new_day": true.`,

  playerPrinciples: `- 너는 탐사자, 평범한 사람이야. 조사하고, 질문하고, 기록을 뒤지고, 위험하면 도망치는 것도 좋은 선택이야.
- 행동은 "시도"로 선언해. 결과는 키퍼와 주사위가 정해.
- 판정에 실패하면 행운을 쓰거나 밀어붙일지 고를 기회가 와. 밀어붙이면 무엇을 다르게 하는지 분명히 말해.
- 공포 앞에서 캐릭터답게 반응해(겁먹고, 부정하고, 집착하고).`,

  prerollCharacter() { return rollChars(); },
  rollOne,

  characterTask(c, { preroll } = {}) {
    const ch = preroll?.chars;
    const budget = ch ? ch.교육 * 4 + ch.지능 * 2 : '교육×4 + 지능×2';
    return {
      rules: `- 시대와 배경에 맞는 직업을 골라 (예: ${OCCUPATIONS.slice(0, 8).join(', ')}).
${ch ? `- 특성치는 서버가 굴려 정했어: ${CHARS.map((k) => `${k} ${ch[k]}`).join(', ')} / 행운 ${preroll.luck}. 이 값에 어울리는 인물로 만들어.\n` : ''}- 기능: 직업과 개인 관심사에 맞게 기본값보다 올린 기능만 적어. 올린 양의 합은 최대 ${budget} 포인트(넘으면 서버가 줄임), 기능 하나는 최대 80. 크툴루 신화는 0. 신용(재산)도 포함해.
- 기본값 예: 관찰력 25, 듣기 20, 도서관 이용 20, 심리학 10, 설득 10, 응급처치 30, 근접전(격투) 25, 사격(권총) 20, 회피 = 민첩의 절반.
- 무기는 있으면 적어(없으면 맨손). 1920년대라면 권총 "1d10", 산탄총 "4d6", 칼 "1d4"(관통), 몽둥이 "1d6".`,
      shape: `{
  "name": "이름",
  "occupation": "직업",
  "concept": "한 줄 콘셉트 (예: 사라진 오빠를 찾는 항만 병원 간호사)",
  "appearance": "외모",
  "personality": "성격과 말투",
  "background": "배경과 이 사건에 얽힌 이유 (2~3문장)",
  "skills": {"응급처치": 60, "관찰력": 55, "신용": 30},
  "weapons": [{"name": "무기 이름", "skill": "사격(권총)", "damage": "1d10", "impale": true}],
  "items": ["소지품"],
  "note": "(선택) 개인 메모에 적어 둘 비밀이나 목표"
}`,
    };
  },

  makeCharacter(raw, { preroll } = {}) {
    const given = raw.characteristics || raw.stats;
    let chars, luck;
    if (given && CHARS.some((k) => given[k] !== undefined)) {
      chars = Object.fromEntries(CHARS.map((k) => [k, clamp(given[k], 15, 90, 50)]));
      luck = raw.luck !== undefined ? clamp(raw.luck, 15, 90, 50) : rollDice('3d6').total * 5;
    } else {
      const r = preroll || rollChars();
      chars = r.chars;
      luck = r.luck;
    }
    // Skills: start from base values, add what the player raised, keep the total in budget.
    const wanted = parseSkills(raw.skills);
    const raised = {};
    for (const [k, v] of Object.entries(wanted)) {
      const name = findSkill(k);
      if (!name || CHARS.includes(name) || name === '크툴루 신화') continue;
      const base = baseOf(name, chars);
      const val = clamp(v, base, 80, base);
      if (val > base) raised[name] = val - base;
    }
    const budget = chars.교육 * 4 + chars.지능 * 2;
    const spent = Object.values(raised).reduce((a, b) => a + b, 0);
    const scale = spent > budget ? budget / spent : 1;
    const skills = {};
    for (const n of SKILL_NAMES) skills[n] = baseOf(n, chars) + Math.floor((raised[n] || 0) * scale);
    const { db, build } = dbBuild(chars.근력 + chars.크기);
    const mov = chars.민첩 < chars.크기 && chars.근력 < chars.크기 ? 7 : chars.민첩 > chars.크기 && chars.근력 > chars.크기 ? 9 : 8;
    return {
      occupation: str(raw.occupation, 40) || pick(OCCUPATIONS),
      concept: str(raw.concept, 120) || str(raw.occupation, 40),
      chars, skills, luck,
      maxHp: Math.max(1, Math.floor((chars.건강 + chars.크기) / 10)),
      mp: Math.floor(chars.정신 / 5),
      san: chars.정신, sanMax: 99, sanDayStart: chars.정신, sanToday: 0,
      db, build, mov, armor: 0,
      weapons: (Array.isArray(raw.weapons) ? raw.weapons : []).map(normWeapon).filter(Boolean).slice(0, 4),
      ticks: [],
    };
  },

  raisedSkills(ch) {
    return SKILL_NAMES.filter((n) => ch.skills?.[n] > baseOf(n, ch.chars || {}) || (n === '크툴루 신화' && ch.skills?.[n] > 0))
      .sort((a, b) => ch.skills[b] - ch.skills[a]);
  },

  sheetLine(ch, { full } = {}) {
    const top = this.raisedSkills(ch).slice(0, full ? 14 : 8).map((n) => `${n} ${ch.skills[n]}`).join(', ');
    let line = `${ch.occupation} | HP ${ch.hp}/${ch.maxHp} | 이성 ${ch.san}/${ch.sanMax}${ch.sanToday ? ` (오늘 -${ch.sanToday})` : ''} | 마력 ${ch.mp} | 행운 ${ch.luck} | ${CHARS.map((k) => `${k}${ch.chars[k]}`).join(' ')} | 회피 ${ch.skills.회피}`;
    if (top) line += `\n    기능: ${top}`;
    if (ch.weapons?.length) line += `\n    무기: ${ch.weapons.map((w) => `${w.name}(${w.skill} ${skillValue(ch, w.skill)}, ${withDb(w.damage, w.melee ? ch.db : '0')})`).join(', ')}`;
    return line;
  },

  sheetView(ch) {
    const raised = this.raisedSkills(ch);
    const ticks = ch.ticks || [];
    return {
      badges: [ch.occupation, `피해 보너스 ${ch.db}`, `체구 ${ch.build}`, `이동 ${ch.mov}`, `회피 ${ch.skills.회피}`],
      stats: CHARS.map((k) => ({ label: k, value: String(ch.chars[k]), sub: `${Math.floor(ch.chars[k] / 2)} · ${Math.floor(ch.chars[k] / 5)}` })),
      tracks: [
        { label: 'HP', value: ch.hp, max: ch.maxHp },
        { label: '이성', value: ch.san, max: ch.sanMax, kind: 'san' },
        { label: '마력', value: ch.mp, max: Math.floor(ch.chars.정신 / 5) },
        { label: '행운', value: ch.luck, max: 99, kind: 'luck' },
      ],
      lists: [
        { title: '기능 (보통 · 어려운 · 극단)', items: raised.map((n) => `${n} ${ch.skills[n]} (${Math.floor(ch.skills[n] / 2)} · ${Math.floor(ch.skills[n] / 5)})${ticks.includes(n) ? ' ✓' : ''}`) },
        { title: '무기', items: (ch.weapons || []).map((w) => `${w.name} · ${w.skill} ${skillValue(ch, w.skill)} · ${withDb(w.damage, w.melee ? ch.db : '0')}${w.impale ? ' · 관통' : ''}`) },
      ].filter((l) => l.items.length),
    };
  },

  checkGuide: `- 결과가 불확실하고 의미 있을 때만 판정해. 단순한 조사는 판정 없이 단서를 줘도 돼.
- type: "skill"(기능·특성치), "sanity"(이성), "luck"(행운), "attack"(탐사자의 공격), "defend"(적의 공격에 대한 탐사자의 대응), "opposed"(사회적 대결 등).
- skill은 기능 이름이나 특성치 이름(아이디어=지능, 지식=교육). difficulty는 "regular" | "hard" | "extreme".
- 공격(attack)은 target에 foes의 적 이름, response에 적의 대응. 적이 탐사자를 공격하면 defend(vs = 적 이름).`,
  checkSchema: `{"who": "캐릭터 키", "type": "skill", "skill": "관찰력", "difficulty": "regular", "bonus": 0, "penalty": 0, "push_risk": "밀어붙였다 실패하면 생길 일", "against": "(선택) 보스를 상대하는 행동이면 그 보스 이름", "why": "짧게"},
    {"who": "캐릭터 키", "type": "sanity", "loss": "0/1d6", "why": "무엇을 봤는지"},
    {"who": "캐릭터 키", "type": "attack", "skill": "근접전(격투)", "weapon": "(선택) 무기 이름", "target": "적 이름", "response": "dodge|fight_back|none"},
    {"who": "캐릭터 키", "type": "defend", "vs": "적 이름", "response": "dodge|fight_back"},
    {"who": "캐릭터 키", "type": "opposed", "skill": "설득", "vs_name": "상대", "vs_skill": "심리학", "vs_value": 50}`,

  foeSchema: '"foes": [{"name": "적 이름", "hp": 12, "armor": 0, "damage": "1d6+1d4", "attack": 45, "dodge": 20, "note": "짧은 특징", "remove": false}]',

  normalizeCheck(x, ch) {
    const type = ['skill', 'sanity', 'luck', 'attack', 'defend', 'opposed'].includes(x.type) ? x.type
      : /이성|san/i.test(String(x.skill || '')) ? 'sanity' : /^행운/.test(String(x.skill || '')) ? 'luck' : 'skill';
    const difficulty = ['regular', 'hard', 'extreme'].includes(x.difficulty) ? x.difficulty
      : /극단/.test(String(x.difficulty || '')) ? 'extreme' : /어려/.test(String(x.difficulty || '')) ? 'hard' : 'regular';
    const bonus = clamp(x.bonus, 0, 2, 0), penalty = clamp(x.penalty, 0, 2, 0);
    if (type === 'sanity') {
      const loss = String(x.loss || '0/1d4').replace(/\s+/g, '');
      const [a, b] = loss.split('/');
      const ok = (e) => /^\d+$/.test(e || '') || !!parseDice(e);
      return { type, loss: ok(a) && ok(b) ? `${a}/${b}` : '0/1d4' };
    }
    if (type === 'luck') return { type, difficulty, bonus, penalty };
    if (type === 'defend') {
      return { type, vs: str(x.vs || x.target, 60), response: x.response === 'fight_back' ? 'fight_back' : 'dodge' };
    }
    if (type === 'attack') {
      const weapon = str(x.weapon, 40);
      const w = ch ? weaponFor(ch, { weapon, skill: findSkill(x.skill) }) : null;
      return {
        type, skill: findSkill(x.skill) || w?.skill || '근접전(격투)', weapon: weapon || w?.name || '', target: str(x.target, 60),
        response: ['dodge', 'fight_back', 'none'].includes(x.response) ? x.response : 'dodge', difficulty, bonus, penalty,
      };
    }
    if (type === 'opposed') {
      return { type, skill: findSkill(x.skill) || '설득', vs_name: str(x.vs_name, 40) || '상대', vs_skill: str(x.vs_skill, 30) || '심리학', vs_value: clamp(x.vs_value, 1, 99, 50), bonus, penalty };
    }
    const risk = str(x.push_risk, 200).replace(/^(\(?\s*밀어붙였다(가)?\s*(또\s*)?실패하면\s*[:：)]?\s*)+/, '');
    return { type: 'skill', skill: findSkill(x.skill) || '관찰력', difficulty, bonus, penalty, push_risk: risk.slice(0, 160) };
  },

  checkLabel(p) {
    if (p.type === 'sanity') return `이성 판정 (${p.loss})`;
    if (p.type === 'luck') return '행운 판정';
    if (p.type === 'defend') return `${p.vs}의 공격에 ${p.response === 'fight_back' ? '반격' : '회피'}`;
    if (p.type === 'attack') return `${p.target || '적'} 공격 (${p.skill})`;
    if (p.type === 'opposed') return `${p.skill} 대 ${p.vs_name}의 ${p.vs_skill}`;
    return `${p.skill}${p.difficulty !== 'regular' ? ` (${DIFF_LABEL[p.difficulty]})` : ''}${p.bonus ? ` 보너스 ${p.bonus}` : ''}${p.penalty ? ` 페널티 ${p.penalty}` : ''}`;
  },

  // /check 오필리아 관찰력 [어려움|극단] [보너스|페널티]  ·  /check 오필리아 이성 1/1d6  ·  /check 오필리아 행운
  commandCheck(words, ch) {
    const text = words.join(' ');
    if (/^이성/.test(text)) return this.normalizeCheck({ type: 'sanity', loss: words[1] }, ch);
    if (/^행운/.test(text)) return this.normalizeCheck({ type: 'luck' }, ch);
    const skill = findSkill(words[0]);
    if (!skill) return '기능을 못 찾았어요. 예: /check 오필리아 관찰력 어려움 보너스, /check 오필리아 이성 1/1d6, /check 오필리아 행운';
    return this.normalizeCheck({
      skill, difficulty: /극단/.test(text) ? 'extreme' : /어려/.test(text) ? 'hard' : 'regular',
      bonus: /보너스/.test(text) ? 1 : 0, penalty: /페널티/.test(text) ? 1 : 0,
    }, ch);
  },

  resolveCheck(check, ch, ctx = {}) {
    switch (check.type) {
      case 'sanity': return this.sanity(check, ch);
      case 'luck': {
        const r = skillRoll(ch.luck, check);
        const pass = RANK[r.level] >= DIFF[check.difficulty || 'regular'];
        return { type: 'luck', dice: [r.value], total: r.value, target: `≤ ${ch.luck}`, title: '행운 판정', label: LEVEL_LABEL[r.level], tier: tierOf(r.level, pass), level: r.level, pass, diceNote: diceNote(r) };
      }
      case 'attack': return this.attack(check, ch, ctx);
      case 'defend': return this.defend(check, ch, ctx);
      case 'opposed': return this.opposed(check, ch);
      default: return this.skill(check, ch);
    }
  },

  skill(check, ch) {
    const value = skillValue(ch, check.skill);
    const r = skillRoll(value, check);
    const pass = RANK[r.level] >= DIFF[check.difficulty];
    tick(ch, check.skill, pass);
    const need = threshold(value, check.difficulty);
    return {
      type: 'skill', skill: check.skill, value, difficulty: check.difficulty, bonus: check.bonus, penalty: check.penalty,
      pushed: !!check.pushed, pushRisk: check.push_risk || '',
      dice: [r.value], total: r.value, level: r.level, pass,
      title: `${check.skill} ${value}${check.difficulty !== 'regular' ? ` · ${DIFF_LABEL[check.difficulty]}` : ''}${check.pushed ? ' · 밀어붙임' : ''}`,
      target: `≤ ${need}`,
      label: `${LEVEL_LABEL[r.level]}${!pass && RANK[r.level] >= 2 ? ` (${DIFF_LABEL[check.difficulty]}엔 부족)` : ''}`,
      tier: tierOf(r.level, pass), diceNote: diceNote(r),
      text: check.pushed && !pass ? '밀어붙인 판정 실패: 키퍼가 큰 대가를 치르게 한다' : '',
    };
  },

  sanity(check, ch) {
    const [okLoss, failLoss] = check.loss.split('/');
    const before = ch.san;
    const r = skillRoll(before);
    const pass = RANK[r.level] >= 2;
    const expr = pass ? okLoss : failLoss;
    const loss = r.level === 'fumble' ? (/^\d+$/.test(failLoss) ? Number(failLoss) : maxOf(failLoss)) : /^\d+$/.test(expr) ? Number(expr) : Math.max(0, rollDice(expr).total);
    ch.san = Math.max(0, ch.san - loss);
    ch.sanToday = (ch.sanToday || 0) + loss;
    const notes = [];
    if (loss >= 5 && ch.san > 0) {
      const idea = d100().value;
      if (idea <= ch.chars.지능) {
        if (!ch.conditions.includes('일시적 광기')) ch.conditions.push('일시적 광기');
        notes.push(`지능 판정 ${idea} ≤ ${ch.chars.지능}: 진실을 깨달아 일시적 광기`);
      } else {
        notes.push(`지능 판정 ${idea} > ${ch.chars.지능}: 충격을 억눌렀다`);
      }
    }
    if (ch.sanToday >= Math.floor((ch.sanDayStart || before) / 5) && ch.san > 0 && !ch.conditions.includes('무기한 광기')) {
      ch.conditions.push('무기한 광기');
      notes.push('오늘 잃은 이성이 1/5을 넘어 무기한 광기');
    }
    if (ch.san === 0 && !ch.conditions.includes('영구 광기')) { ch.conditions.push('영구 광기'); notes.push('이성 0: 영구 광기'); }
    return {
      type: 'sanity', dice: [r.value], total: r.value, level: r.level, pass, loss,
      title: `이성 판정 (${check.loss})`, target: `≤ ${before}`,
      label: pass ? '성공' : r.level === 'fumble' ? '대실패' : '실패', tier: tierOf(r.level, pass),
      text: `이성 ${before} → ${ch.san} (-${loss})`, notes,
    };
  },

  attack(check, ch, ctx) {
    const weapon = weaponFor(ch, check);
    const skill = check.skill || weapon.skill;
    const value = skillValue(ch, skill);
    const r = skillRoll(value, check);
    const foe = foeOf(ctx, check.target);
    const name = foe?.name || check.target || '상대';
    const res = { type: 'attack', skill, value, weapon: weapon.name, dice: [r.value], total: r.value, level: r.level, target: `≤ ${value}`, diceNote: diceNote(r), notes: [] };
    let win = false, foeWins = false;
    if (check.response === 'none' || !foe) {
      win = RANK[r.level] >= DIFF[check.difficulty || 'regular'];
    } else {
      const defVal = check.response === 'fight_back' ? foe.attack ?? 40 : foe.dodge ?? 20;
      const d = skillRoll(defVal);
      res.notes.push(`${name}의 ${check.response === 'fight_back' ? '반격' : '회피'} ${defVal}: ${d.value} → ${LEVEL_LABEL[d.level]}`);
      const a = RANK[r.level] >= 2 ? RANK[r.level] : 0, b = RANK[d.level] >= 2 ? RANK[d.level] : 0;
      if (check.response === 'fight_back') { win = a > 0 && a >= b; foeWins = b > 0 && b > a; } else { win = a > 0 && a > b; }
    }
    tick(ch, skill, win);
    if (win) {
      const dmg = rollDamage(weapon, ch, RANK[r.level] >= RANK.extreme);
      res.damage = { expr: dmg.expr, total: dmg.total, detail: dmg.detail, target: name };
    } else if (foeWins) {
      const dmg = rollDice(foe.damage || '1d6') || { total: 3 };
      res.selfDamage = { expr: foe.damage || '1d6', total: Math.max(0, dmg.total) };
      res.notes.push(`${name}의 반격이 먹혔다: 피해 ${res.selfDamage.total}`);
    }
    return {
      ...res,
      title: `${name} 공격 · ${weapon.name} (${skill} ${value})`,
      label: win ? `명중${RANK[r.level] >= RANK.extreme ? ' · 극단' : ''}` : r.level === 'fumble' ? '대실패' : '빗나감',
      tier: win ? (r.level === 'critical' ? 'crit' : 'good') : r.level === 'fumble' ? 'fumble' : 'bad',
      pass: win,
    };
  },

  defend(check, ch, ctx) {
    const foe = foeOf(ctx, check.vs) || { name: check.vs || '적', attack: 40, damage: '1d6' };
    const atkVal = foe.attack ?? 40;
    const atk = skillRoll(atkVal);
    const skill = check.response === 'fight_back' ? '근접전(격투)' : '회피';
    const value = skillValue(ch, skill);
    const r = skillRoll(value);
    const a = RANK[atk.level] >= 2 ? RANK[atk.level] : 0, b = RANK[r.level] >= 2 ? RANK[r.level] : 0;
    // Dodge wins ties; fighting back loses them.
    const foeHits = check.response === 'fight_back' ? a > 0 && a >= b : a > 0 && a > b;
    const pcHits = check.response === 'fight_back' && b > 0 && b > a;
    tick(ch, skill, b > 0 && !foeHits);
    const res = {
      type: 'defend', skill, value, dice: [r.value], total: r.value, level: r.level, target: `≤ ${value}`,
      title: `${foe.name}의 공격 · ${check.response === 'fight_back' ? '반격' : '회피'} (${skill} ${value})`,
      notes: [`${foe.name}의 공격 ${atkVal}: ${atk.value} → ${LEVEL_LABEL[atk.level]}`],
      pass: !foeHits,
    };
    if (foeHits) {
      const extreme = RANK[atk.level] >= RANK.extreme;
      const total = extreme ? maxOf(foe.damage || '1d6') : Math.max(0, (rollDice(foe.damage || '1d6') || { total: 3 }).total);
      res.selfDamage = { expr: foe.damage || '1d6', total };
      res.label = extreme ? '맞았다 · 극단' : '맞았다';
      res.tier = 'bad';
    } else if (pcHits) {
      const dmg = rollDamage(weaponFor(ch, { skill: '근접전(격투)' }), ch, RANK[r.level] >= RANK.extreme);
      res.damage = { expr: dmg.expr, total: dmg.total, detail: dmg.detail, target: foe.name };
      res.label = '반격 성공';
      res.tier = r.level === 'critical' ? 'crit' : 'good';
    } else {
      res.label = a === 0 ? '빗나갔다' : '피했다';
      res.tier = 'good';
    }
    return res;
  },

  opposed(check, ch) {
    const value = skillValue(ch, check.skill);
    const r = skillRoll(value, check);
    const o = skillRoll(check.vs_value);
    const a = RANK[r.level] >= 2 ? RANK[r.level] : 0, b = RANK[o.level] >= 2 ? RANK[o.level] : 0;
    const win = a > 0 && (a > b || (a === b && value > check.vs_value));
    const lose = b > 0 && (b > a || (a === b && value < check.vs_value));
    tick(ch, check.skill, win);
    return {
      type: 'opposed', skill: check.skill, value, dice: [r.value], total: r.value, level: r.level, target: `≤ ${value}`,
      title: `${check.skill} ${value} 대 ${check.vs_name}의 ${check.vs_skill} ${check.vs_value}`,
      notes: [`${check.vs_name}: ${o.value} → ${LEVEL_LABEL[o.level]}`], diceNote: diceNote(r),
      label: win ? `이김 (${LEVEL_LABEL[r.level]})` : lose ? `짐 (${LEVEL_LABEL[r.level]})` : '팽팽함',
      tier: win ? (r.level === 'critical' ? 'crit' : 'good') : r.level === 'fumble' ? 'fumble' : lose ? 'bad' : 'mixed',
      pass: win,
    };
  },

  // After a failed (not fumbled, not pushed) skill roll: spend Luck, push, or accept.
  followUp(roll, ch) {
    if (roll.type !== 'skill' || roll.pass || roll.pushed || roll.level === 'fumble') return null;
    const opts = [], keys = [];
    const cost = roll.total - threshold(roll.value, roll.difficulty);
    if (cost > 0 && cost <= (ch.luck || 0)) {
      opts.push(`행운 ${cost} 써서 성공시킨다 (행운 ${ch.luck} → ${ch.luck - cost})`);
      keys.push('luck');
    }
    opts.push(`밀어붙여 다시 굴린다${roll.pushRisk ? ` (또 실패하면: ${roll.pushRisk})` : ' (또 실패하면 큰 대가)'}`);
    keys.push('push');
    opts.push('실패를 받아들인다');
    keys.push('accept');
    roll.followKeys = keys;
    roll.luckCost = cost;
    return {
      prompt: `${roll.skill} 판정 실패 (${roll.total} > ${threshold(roll.value, roll.difficulty)}). 어떻게 할까요?`,
      options: opts, count: 1, textFor: keys.indexOf('push'), textLabel: '무엇을 다르게 해서 다시 시도하나요?',
    };
  },

  applyChoice(roll, picks, ch, { text } = {}) {
    const key = roll.followKeys?.[picks[0]] || 'accept';
    if (key === 'luck') {
      ch.luck = Math.max(0, ch.luck - roll.luckCost);
      roll.pass = true;
      roll.tier = 'good';
      roll.label = `행운 ${roll.luckCost}로 성공`;
      roll.chosen = [`행운 ${roll.luckCost} 사용 (남은 행운 ${ch.luck})`];
      return null;
    }
    if (key === 'push') {
      const why = str(text, 200) || '방법을 바꿔 다시 시도한다';
      roll.chosen = [`밀어붙이기: ${why}`];
      return { reroll: { type: 'skill', skill: roll.skill, difficulty: roll.difficulty, bonus: roll.bonus, penalty: roll.penalty, pushed: true, push_risk: roll.pushRisk, why } };
    }
    roll.chosen = ['실패를 받아들였다'];
    return null;
  },

  rollText(r, name) {
    let s = `🎲 ${name} · ${r.title}: d100 = ${r.total} (${r.target}) → ${r.label}`;
    if (r.diceNote) s += ` [${r.diceNote}]`;
    if (r.text) s += ` — ${r.text}`;
    if (r.damage) s += ` | 피해 ${r.damage.expr} = ${r.damage.total}${r.damage.detail?.startsWith('최대') ? ` (${r.damage.detail})` : ''} → ${r.damage.target}${r.damage.result ? ` (${r.damage.result})` : ''}`;
    if (r.selfDamage) s += ` | ${name}이(가) 받은 피해 ${r.selfDamage.total}`;
    if (r.notes?.length) s += ` | ${r.notes.join(', ')}`;
    if (r.chosen?.length) s += ` | 선택: ${r.chosen.join(' / ')}`;
    if (r.pushRisk && !r.pass) s += ` | 밀어붙였다 실패하면: ${r.pushRisk}`;
    if (r.why) s += ` (${r.why})`;
    return s;
  },

  effectSchema: '"san": 0, "luck": 0, "mp": 0, "mythos": 0, "new_day": false, "development": false',

  applyEffect(e, ch) {
    const bits = [];
    const san = clamp(e.san, -100, 20, 0);
    if (san) { const b = ch.san; ch.san = Math.max(0, Math.min(ch.sanMax, ch.san + san)); if (san < 0) ch.sanToday += -san; bits.push(`이성 ${b}→${ch.san}`); }
    const luck = clamp(e.luck, -99, 99, 0);
    if (luck) { const b = ch.luck; ch.luck = Math.max(0, Math.min(99, ch.luck + luck)); bits.push(`행운 ${b}→${ch.luck}`); }
    const mp = clamp(e.mp, -30, 30, 0);
    if (mp) { const b = ch.mp; ch.mp = Math.max(0, Math.min(Math.floor(ch.chars.정신 / 5), ch.mp + mp)); bits.push(`마력 ${b}→${ch.mp}`); }
    const mythos = clamp(e.mythos, 0, 20, 0);
    if (mythos) {
      ch.skills['크툴루 신화'] = Math.min(99, (ch.skills['크툴루 신화'] || 0) + mythos);
      ch.sanMax = 99 - ch.skills['크툴루 신화'];
      ch.san = Math.min(ch.san, ch.sanMax);
      bits.push(`크툴루 신화 +${mythos} (최대 이성 ${ch.sanMax})`);
    }
    if (e.new_day === true) { ch.sanDayStart = ch.san; ch.sanToday = 0; bits.push('새 날'); }
    if (e.development === true && ch.ticks?.length) {
      // Development: roll over the skill (or 96+) to improve it by 1d10.
      for (const n of ch.ticks) {
        const r = d100().value;
        if (r > ch.skills[n] || r > 95) {
          const gain = die(10);
          ch.skills[n] = Math.min(99, ch.skills[n] + gain);
          bits.push(`${n} +${gain}`);
        }
      }
      ch.ticks = [];
      if (!bits.some((b) => /\+\d+$/.test(b))) bits.push('성장 없음');
    }
    return bits;
  },

  armor(ch) { return ch.armor || 0; },

  onDamage(ch, dmg) {
    if (dmg >= Math.ceil(ch.maxHp / 2) && !ch.conditions.includes('중상')) {
      ch.conditions.push('중상');
      return ['중상'];
    }
    return [];
  },

  onDown(ch) {
    const c = ch.conditions.includes('중상') ? '빈사' : '기절';
    if (!ch.conditions.includes(c)) ch.conditions.push(c);
    return null;
  },

  mock: {
    character() {
      const occupation = pick(OCCUPATIONS);
      const sk = {};
      for (const n of [...SKILL_NAMES].sort(() => Math.random() - 0.5).slice(0, 6)) sk[n] = 40 + Math.floor(Math.random() * 30);
      sk.신용 = 30;
      return { occupation, skills: sk, weapons: Math.random() < 0.5 ? [{ name: '38구경 리볼버', skill: '사격(권총)', damage: '1d10', impale: true }] : [] };
    },
    check(decl, ctx) {
      const foe = ctx?.foes?.[0]?.name;
      const r = Math.random();
      if (foe && r < 0.25) return { type: 'attack', skill: '근접전(격투)', target: foe, response: pick(['dodge', 'fight_back']) };
      if (foe && r < 0.4) return { type: 'defend', vs: foe, response: 'dodge' };
      if (r < 0.55) return { type: 'sanity', loss: pick(['0/1d3', '1/1d6']) };
      return { type: 'skill', skill: pick(['관찰력', '듣기', '도서관 이용', '심리학', '은밀행동']), difficulty: pick(['regular', 'regular', 'hard']), push_risk: '소리를 들킨다' };
    },
  },
};
