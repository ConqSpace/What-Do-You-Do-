// Stories for the new-campaign gallery, Netflix style: a poster tile per story, and the
// picked one shown large above the rows.
//
// Dungeon World stories are written the way its rulebook prepares a game (첫 세션, 국면):
// no plot, only a situation, the questions play will answer, a first scene that drops the
// party into trouble with a question for the players, and a front for the GM. See the
// selection-card-copy skill. They are kept few and small: one sitting, one danger.
//   situation  what is going on (also the premise the GM gets); nothing that will happen
//   questions  이야기가 답할 질문: the front's stakes questions; nobody knows the answers yet
//   scene      the first scene the GM starts in: { title, text, ask } (ask = what the GM asks first)
//   front      GM only: one danger { name, type, motive, portents (in order), doom { text, type } },
//              cast, blank (left undecided on purpose)
//   length     how big a story to design; the story still ends only when it ends
//   genre      a key of RANDOM in app.js (the builder's d20 cards follow it)
//   row        which row of the gallery the tile sits in

export const STORY_ROWS = { story: '이야기' };

export const STORIES = {
  dw: [
    { id: 'dw-dwarfmine', icon: '⛏', row: 'story', genre: 'dungeon', title: '드워프 폐광', kind: '던전', length: 'short', beginner: true,
      situation: '고블린 떼가 대장장이를 끌고 드워프 폐광으로 사라졌다. 고블린들도 뭔가에 쫓기는 눈치다.',
      questions: ['대장장이를 살려 데려올 수 있을까?', '고블린들은 무엇에게서 도망치나?'],
      scene: { title: '갱도 입구의 정찰병', text: '갱도 입구, 고블린 정찰병 셋이 활을 겨눈다. 하나가 대장장이의 망치를 들고 있다.', ask: '대장장이는 여러분에게 어떤 사람인가요?' },
      tags: ['거친', '구출'], tone: '거칠고 박진감 있게',
      front: {
        dangers: [
          { name: '깊은 곳에서 깨어난 것', type: '고대의 저주', motive: '깨어나 퍼진다',
            portents: ['고블린들이 미쳐 날뛴다', '봉인이 깨진다'], doom: { text: '산 아래 마을까지 어둠이 번진다', type: '파괴' } },
        ],
        cast: ['대장장이 브론', '고블린 족장 스크랄'],
        blank: '깨어난 것의 정체',
      } },
    { id: 'dw-belltower', icon: '🔔', row: 'story', genre: 'fantasy', title: '잿빛 종탑의 비밀', kind: '판타지', length: 'short',
      situation: '국경 마을에서 밤마다 종이 울리고, 다음 날이면 누군가 사라진다. 영주는 별일 아니라고만 한다.',
      questions: ['사라진 사람들은 어디로 갔나?', '영주는 무엇을 감추고 있나?'],
      scene: { title: '울리는 종', text: '한밤중 종이 울린다. 맨발의 아이가 종탑 쪽으로 걸어간다.', ask: '그 아이를 본 건 누구인가요? 아는 아이인가요?' },
      tags: ['으스스한', '조사'], tone: '어둡지만 희망이 남아 있게',
      front: {
        dangers: [
          { name: '종탑 아래의 부름', type: '저주받은 장소', motive: '사람을 끌어들인다',
            portents: ['아이들이 같은 꿈을 꾼다', '종이 낮에도 울린다'], doom: { text: '마을 사람 모두가 종탑 아래로 걸어 들어간다', type: '파괴' } },
        ],
        cast: ['영주 하르덴', '종지기 노인 오브'],
        blank: '종탑 아래에 무엇이 있는지',
      } },
    { id: 'dw-dragonhero', icon: '🐲', row: 'story', genre: 'fantasy', title: '용을 잡은 영웅', kind: '판타지', length: 'short',
      situation: '용을 잡았다는 영웅 덕에 마을은 사흘째 잔치 중이다. 그런데 오늘 아침, 죽었다던 용이 마을 위를 날아갔다.',
      questions: ['영웅의 거짓말은 들통날까?', '마을은 용과 싸울까, 거래할까?'],
      scene: { title: '지붕 위의 용', text: '잔치 한복판, 여관 지붕에 용이 내려앉는다. 영웅이 여러분의 발목에 매달린다.', ask: '영웅은 왜 하필 여러분에게 매달리나요?' },
      tags: ['유쾌한', '소동극'], tone: '가볍고 유쾌하게',
      front: {
        dangers: [
          { name: '은비늘 용', type: '용', motive: '알을 지킨다',
            portents: ['영웅을 내놓으라고 한다', '마을에 불을 뿜는다'], doom: { text: '마을이 잿더미가 된다', type: '파괴' } },
        ],
        cast: ['영웅 보리스', '여관 주인 마르타'],
        blank: '용의 알을 누가 가져갔는지',
      } },
  ],
};

// The first row: ways to start that are not a written story.
export const STARTS = [
  { id: 'gm', icon: '🎭', title: '마스터에게 맡기기',
    situation: '어떤 모험일지는 시작해 봐야 안다. 마스터가 일행에 맞춰 세계와 사건을 짠다. 첫 장면부터 하나씩 알아 가면 된다.' },
  { id: 'random', icon: '🎲', title: '아무거나',
    situation: '장소와 사건과 분위기를 그 자리에서 뽑는다. 누를 때마다 다른 이야기가 나온다. 마음에 들 때까지 뽑아도 된다.' },
  { id: 'custom', icon: '✍', title: '우리만의 이야기',
    situation: '머릿속에 있던 모험을 한 줄로 적는다. 마스터가 거기에 사람과 사건을 채운다. 첫 장면을 정해 두면 거기서 시작한다.' },
];

export const LENGTH = { short: '짧은 모험', long: '긴 모험' };

// The rulebook's kinds of danger and doom, for checking the fronts.
export const DANGER_TYPES = ['사교', '종교 조직', '부패한 정부', '당파', '신', '마왕', '천사의 집단', '언데드의 왕', '힘에 미친 마법사', '고대의 저주', '용',
  '야만족', '괴물 떼', '언데드 떼', '부정한 땅', '어둠의 문', '힘이 서린 곳', '저주받은 장소'];
export const DOOM_TYPES = ['압제', '질병', '파괴', '찬탈', '궁핍', '혼돈의 득세'];
