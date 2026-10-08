// The "데모봇" backend: no model, just canned replies in the shape each call expects.
// It exists so the table can be tried (and tested) without any CLI installed.

import { rulesetOf } from './rules/index.mjs';

const pick = (a) => a[Math.floor(Math.random() * a.length)];

const NAMES = ['카엘', '미라', '도윤', '세라핀', '호크', '루나', '바르크', '이솔', '테오', '은하'];
const CONCEPTS = ['말수 적은 떠돌이 검사', '호기심 많은 견습 마법사', '빚에 쫓기는 도둑', '은퇴를 미룬 노병',
  '신앙을 잃은 사제', '지도를 그리는 탐험가', '노래로 먹고사는 음유시인', '약초에 밝은 사냥꾼'];
const ITEMS = ['낡은 장검', '밧줄 10m', '횃불 3개', '치료 물약', '도둑 도구', '양피지 지도', '은화 주머니', '단검', '류트', '성표'];

// A declaration: what the character says (SAYS) and what the player means to do (ACTIONS).
const ACTIONS = ['문 쪽은 제가 막고 있을게요', '저 발자국 좀 살펴볼게요', '앞장설게요', '저 사람한테 다가가 볼게요',
  '활 꺼내서 겨눠 둘게요', '함정 있는지부터 살펴볼게요', '저놈 놓치기 전에 쫓아갈게요'];
const SAYS = ['너 또 혼자 앞서가지 마.', '다들 따라와요.', '잠깐, 거기 서 보시오. 물어볼 게 있소.', '이거 냄새가 영 안 좋은데.'];

const NARR = ['안개가 짙게 깔린 골목 끝에서 낮은 종소리가 울린다. 누군가 서둘러 문을 닫는 소리가 뒤따른다.',
  '횃불이 흔들리며 벽에 새겨진 오래된 문양을 비춘다. 문양 사이로 가느다란 바람이 새어 나온다.',
  '여관 주인이 목소리를 낮춘다.\n여관 주인: "그 숲에 들어간 사람은 아무도 돌아오지 않았소."',
  '발밑의 돌판이 딸깍 소리를 내며 가라앉는다. 어딘가에서 톱니바퀴가 돌기 시작한다.',
  '멀리서 늑대 울음이 길게 이어지고, 달빛 아래 무언가 커다란 그림자가 지나간다.'];
// Table talk (lib/talk.mjs): the player's own voice (OOC), and the party planning.
const TALK = {
  fumble: ['아니 뭐하냐고', '아 진짜 또?', '주사위 바꿔라 좀', '그걸 거기서 굴리네 ㅋㅋ'],
  crit: ['와 풀다이스 미쳤다', '오 오늘 주사위 좋네', '이게 되네?'],
  streak: ['너 주사위한테 뭐 잘못했냐', '오늘 판정 금지령 내린다', '아 또 실패야?'],
  hurt: ['야 나 맞았잖아', '아니 왜 내가 맞아', '팀킬 그만해 진짜'],
  bold: ['아 저걸 지금 간다고?', '용감한 건지 무모한 건지', '살아서 돌아와라'],
  back: ['손이 미끄러졌다고', '다음엔 된다 진짜', '주사위가 날 싫어해', '봤냐? 이게 실력이다'],
  user: ['ㅇㅇ 나도 그렇게 생각함', '음 그건 좀 위험하지 않아?', '좋아, 그렇게 가자'],
};

const SUCCESS = ['완벽하게 해낸다.', '아슬아슬하지만 성공이다.', '원하던 것을 손에 넣는다.'];
const FAILURE = ['일이 꼬이고 만다.', '실패의 대가로 시간이 흘러 버렸다.', '소리가 너무 컸다. 무언가 이쪽을 돌아본다.'];

export function mockReply(kind, ctx = {}) {
  const R = rulesetOf({ rules: ctx.rules });
  switch (kind) {
    case 'worldbuild':
      return {
        premise: '국경 마을에서 사람들이 하나둘 사라지는 판타지 모험',
        tone: '어둡지만 희망이 남아 있게',
        title: pick(['잿빛 종탑의 비밀', '안개 마을 실종 사건', '잠든 왕의 지하묘지', '별이 떨어진 밤']),
        pitch: `${ctx.premise || '판타지 모험'}. 작은 국경 마을 "회색여울"에서 사흘째 사람들이 사라지고 있다. 영주는 입을 닫았고, 마을 사람들은 밤마다 종탑에서 들리는 소리를 두려워한다. 각자의 이유로 이 마을에 머물게 된 일행은 여관 주인의 부탁을 받는다.`,
        character_hint: '마을 바깥에서 온 이방인이면 좋다. 각자 사라진 사람과 작은 연결고리가 있어도 좋다.',
        gm_notes: '진실: 영주가 지하 묘지의 봉인을 풀기 위해 사람들을 제물로 바치고 있다. 단서: 1) 실종자 모두 종탑 근처에서 마지막으로 목격됨 2) 영주 저택의 진흙 묻은 장화 3) 묘지 문양과 영주 가문 문장이 같음. 시계: 3일 뒤 보름에 봉인이 풀림.',
        facts: [
          '인물(영주, 회색여울의 영주)', '인물(여관 주인, 겁 많은 노인)', '장소(종탑, 마을 북쪽의 낡은 종탑)', '장소(지하 묘지, 종탑 아래)',
          '위치(영주, 영주 저택)', '목표(영주, 보름 전에 봉인을 푼다)', '비밀(영주, 실종자를 제물로 바친다)',
          '단서(목격, 실종자 모두 종탑 근처에서 마지막으로 목격됨)', '단서(장화, 영주 저택의 진흙 묻은 장화)', '단서(문장, 묘지 문양과 영주 가문 문장이 같다)',
          '시계(봉인) = 0/6',
          '결론(영주의 죄, 영주가 봉인을 풀려고 사람들을 제물로 바친다)',
          '근거(영주의 죄, 목격)', '근거(영주의 죄, 장화)', '근거(영주의 죄, 문장)',
          '출처(목격, 여관 단골들)', '출처(장화, 영주 저택)', '출처(문장, 지하 묘지)',
        ],
        rules: [
          { name: '종소리', when: ['시계(봉인) >= 3'], then: ['사건(종소리, 밤마다 종탑에서 종이 울린다)'], note: '마을 사람들이 잠들지 못한다' },
          { name: '결말: 봉인 해제', when: ['시계(봉인) >= 6'], ending: true, note: '나쁜 결말' },
          { name: '결말: 영주의 몰락', when: ['추론가능(영주의 죄)'], ending: true, note: '좋은 결말' },
        ],
        scene: { title: '회색여울 여관', description: '비 내리는 저녁, 난롯불이 타닥거리는 여관. 주인이 일행에게 조심스럽게 다가온다.' },
      };
    case 'character': {
      const name = pick(NAMES.filter((n) => !(ctx.taken || []).some((t) => t.includes(n))).concat(['무명']));
      return {
        ...R.mock.character(ctx),
        name, concept: pick(CONCEPTS),
        appearance: pick(['짧은 흑발에 오래된 흉터', '은빛 머리를 땋아 내린 키 큰 체구', '주근깨 가득한 얼굴에 큼직한 망토']),
        personality: pick(['무뚝뚝하지만 정이 많다', '말이 많고 낙천적이다', '신중하고 의심이 많다']),
        background: '오래전 잃어버린 것을 찾아 떠돌다 이 마을에 닿았다.',
        items: [pick(ITEMS), pick(ITEMS), pick(ITEMS)],
        note: '목표: 이번 일로 큰돈을 벌어 빚을 갚는다.',
      };
    }
    case 'bonds':
      return R.mock.bonds ? R.mock.bonds(ctx) : { bonds: [] };
    case 'talk':
      return { line: pick(TALK[ctx.event] || TALK.user) };
    case 'choose':
      return { choices: [...Array(ctx.options?.length || 0).keys()].sort(() => Math.random() - 0.5).slice(0, ctx.count || 1), reason: '등불을 바짝 대고 천천히 다시 살핀다' };
    case 'opening':
      return { foes: [{ name: '종탑의 그림자', hp: 6, armor: 1, damage: 'd6', note: '젖은 비늘, 긴 팔' }], narration: `${pick(NARR)} ${(ctx.names || []).filter(Boolean).join(', ')}은(는) 같은 탁자에 둘러앉아 있다. 여관 주인이 다가와 낮게 속삭인다.\n여관 주인: "부탁이 있소. 오늘 밤, 종탑에 가 봐 주시겠소?"\n창밖에서 종이 한 번, 울린다. 어떻게 하시겠습니까?` };
    case 'declare':
      if (Math.random() < 0.08) return { pass: true, ooc: '이번엔 지켜볼게요' };
      return { say: Math.random() < 0.5 ? pick(SAYS) : '', action: pick(ACTIONS), note_add: Math.random() < 0.3 ? `라운드 ${ctx.round}: ${ctx.scene || '이곳'}에서 수상한 기척을 느꼈다` : '' };
    case 'adjudicate': {
      const decls = ctx.decls || [];
      const checks = decls.filter(() => Math.random() < 0.6).slice(0, 2).map((d) => ({
        who: d.key, ...R.mock.check(d, ctx), why: (d.text || '').slice(0, 30),
      }));
      if (checks.length) return { checks, narration: '긴장감이 감돈다. 결과는 주사위에 달렸다.' };
      return mockResults({ ...ctx, results: [] });
    }
    case 'results':
      return mockResults(ctx);
    case 'bargain':
      return {
        narration: `차가운 숨결이 ${ctx.name || '쓰러진 이'}의 귓가를 스칩니다. 검은 두건 아래에서 손 하나가 내밀어집니다.\n사신: "아직은 아니다. 대신 값을 치러라."`,
        price: pick(['다음 보름, 사신의 심부름을 한 번 한다', '가장 아끼는 기억 하나를 내놓는다', '언젠가 사신이 부르면 대답한다']),
        accept: '차가운 손이 가슴에 닿았다 떨어집니다. 숨이 돌아옵니다. 눈은 아직 감겨 있습니다.',
        refuse: '사신이 고개를 끄덕이고 돌아섭니다. 그 뒤를 따라 마지막 숨이 빠져나갑니다.',
      };
    case 'wipe':
      return { narration: '마지막 횃불이 꺼집니다. 쓰러진 일행 위로 종소리가 길게 울립니다. 회색여울의 실종자 명단에 이름이 몇 개 더 적힙니다. 이야기는 여기서 막을 내립니다.', end: true };
    default:
      return {};
  }
}

// A hit takes about a third of the target's HP: three bad turns and they are down.
const hurtDie = (maxHp = 10) => pick(maxHp >= 20 ? ['d8', '2d6', 'd10'] : maxHp >= 13 ? ['d6', 'd8'] : ['d4', 'd6']);

function mockResults(ctx) {
  const lines = (ctx.results || []).map((r) => {
    const name = ctx.characters?.[r.who]?.name || r.who;
    const good = r.tier === 'good' || r.tier === 'crit';
    return `${name}: ${good ? pick(SUCCESS) : pick(FAILURE)}`;
  });
  // Misses hurt, and sometimes a partial hit too: often enough to see someone fall.
  const hurt = (ctx.results || []).find((r) => r.tier === 'bad' || r.tier === 'fumble') || (Math.random() < 0.3 && (ctx.results || []).find((r) => r.tier === 'mixed'));
  const end = !!ctx.ending;
  return {
    narration: end ? '종탑의 종이 마지막으로 울리고, 새벽빛이 마을을 덮는다. 사라졌던 이들의 목소리가 멀리서 들려온다. 일행의 이야기는 여기서 막을 내린다.'
      : `${lines.join(' ')} ${pick(NARR)} 어떻게 하시겠습니까?`.trim(),
    effects: hurt ? [{ who: hurt.who, damage: hurtDie(ctx.characters?.[hurt.who]?.maxHp) }] : [],
    scene: Math.random() < 0.15 ? { title: pick(['종탑 아래', '지하 묘지 입구', '영주 저택 정원']), description: '차가운 바람이 부는 새로운 장소.' } : undefined,
    summary: ctx.round % 4 === 0 ? `일행은 회색여울의 실종 사건을 쫓고 있다. 라운드 ${ctx.round}까지 단서를 모았다.` : undefined,
    end,
    facts: {
      // A GM reply comes after every player's turn, so the clock and the clues move slowly.
      assert: [...(Math.random() < 0.4 ? ['시계(봉인) = +1'] : []), ...(Math.random() < 0.2 ? [{ fact: pick(['단서(목격, 실종자 모두 종탑 근처에서 마지막으로 목격됨)', '단서(장화, 영주 저택의 진흙 묻은 장화)']), to: 'all' }] : [])],
      ...(Math.random() < 0.2 ? { retract: ['없는(사실)'] } : {}),
    },
    whispers: Math.random() < 0.3 && ctx.results?.[0] ? [{ to: ctx.results[0].who, text: '너만 눈치챈다: 누군가 창밖에서 이쪽을 보고 있었다.' }] : [],
  };
}
