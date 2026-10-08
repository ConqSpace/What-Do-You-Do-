// Stories for the new-campaign gallery, Netflix style: a poster tile per story, and the
// picked one shown large above the rows.
//
// Dungeon World stories are written the way its rulebook prepares a game (첫 세션, 국면):
// no plot, only a situation, the questions play will answer, a first scene that drops the
// party into trouble with a question for the players, and a front for the GM. See the
// selection-card-copy skill.
//   situation  what is going on (also the premise the GM gets); nothing that will happen
//   questions  이야기가 답할 질문: the front's stakes questions; nobody knows the answers yet
//   scene      the first scene the GM starts in: { title, text, ask } (ask = what the GM asks first)
//   front      GM only: dangers { name, type, motive, portents (in order), doom { text, type } },
//              cast, blank (left undecided on purpose), clock (a timer that isn't a danger)
//   length     how big a story to design; the story still ends only when it ends
//   genre      a key of RANDOM in app.js (the builder's d20 cards follow it)
//   row        which row of the gallery the tile sits in

export const STORY_ROWS = { kingdom: '마을과 왕국', dungeon: '던전 속으로' };

export const STORIES = {
  dw: [
    { id: 'dw-belltower', icon: '🔔', row: 'kingdom', genre: 'fantasy', title: '잿빛 종탑의 비밀', kind: '판타지', length: 'short', beginner: true,
      situation: '국경 마을에서 밤마다 종이 울린다. 종이 울린 다음 날이면 누군가 사라진다. 영주는 별일 아니라고만 한다.',
      questions: ['사라진 사람들은 어디로 갔나?', '영주는 무엇을 감추고 있나?', '다음 종이 울리기 전에 막을 수 있을까?'],
      scene: { title: '울리는 종', text: '한밤중, 종이 울리기 시작한다. 여관 창밖으로 맨발의 아이가 종탑 쪽으로 걸어간다.', ask: '그 아이를 본 건 누구인가요? 아는 아이인가요?' },
      tags: ['으스스한', '수수께끼', '조사', '대화'], tone: '어둡지만 희망이 남아 있게',
      front: {
        dangers: [
          { name: '종탑 아래의 부름', type: '저주받은 장소', motive: '사람을 끌어들인다',
            portents: ['아이들이 같은 꿈을 꾼다', '영주의 가족이 사라진다', '종이 낮에도 울린다'], doom: { text: '마을 사람 모두가 종탑 아래로 걸어 들어간다', type: '파괴' } },
          { name: '영주 하르덴', type: '부패한 정부', motive: '자기 자리를 지킨다',
            portents: ['외지인을 감시한다', '모험가들을 마을에서 쫓아내려 한다', '주민을 제물로 바친다'], doom: { text: '종탑의 힘을 빌려 마을을 공포로 다스린다', type: '압제' } },
        ],
        cast: ['영주 하르덴', '종지기 노인 오브', '사라진 아이의 어머니 메린'],
        blank: '종탑 아래에 무엇이 있는지',
      } },
    { id: 'dw-funeral', icon: '👑', row: 'kingdom', genre: 'fantasy', title: '왕관 없는 장례식', kind: '판타지', length: 'long',
      situation: '늙은 왕의 장례식 날, 왕관이 사라졌다. 왕위를 노리는 세 사람이 저마다 모험가들을 부른다. 왕관을 찾아오는 사람의 편이 이 나라의 주인이 된다.',
      questions: ['왕관은 누가 가져갔나?', '모험가들은 누구 편에 설까?', '새 왕은 누가 될까?'],
      scene: { title: '멈춰 선 장례 행렬', text: '행렬 한가운데서 누군가 외친다. "왕관이 없다!" 근위병들이 칼을 뽑고 모험가들 쪽으로 몰려온다.', ask: '근위병들은 왜 여러분부터 의심하나요?' },
      tags: ['숨 막히는', '음모', '협상', '추리'], tone: '숨 막히는 궁정 음모극처럼',
      front: {
        dangers: [
          { name: '첫째 왕자 알드릭', type: '당파', motive: '권력자를 포섭한다',
            portents: ['귀족들을 매수한다', '군대를 수도로 부른다', '경쟁자를 반역자로 몬다'], doom: { text: '군대로 왕좌를 차지한다', type: '압제' } },
          { name: '그림자 사제단', type: '사교', motive: '안에서부터 좀먹는다',
            portents: ['왕실 사제가 바뀐다', '같은 반지를 낀 귀족이 늘어난다', '대관식에서 의식이 시작된다'], doom: { text: '누가 왕이 되든 사제단의 꼭두각시가 된다', type: '찬탈' } },
        ],
        cast: ['첫째 왕자 알드릭', '왕비 이졸데', '장군 카스파르', '왕실 사제 모르텐'],
        blank: '왕관을 누가 가져갔는지',
      } },
    { id: 'dw-walkingwood', icon: '🌲', row: 'kingdom', genre: 'fantasy', title: '걷는 숲', kind: '판타지', length: 'short', beginner: true,
      situation: '마을을 둘러싼 숲이 밤마다 한 걸음씩 다가온다. 이대로라면 이레 뒤 마을이 숲에 묻힌다. 마을은 숲을 태우자는 쪽과 달래자는 쪽으로 갈라졌다.',
      questions: ['숲은 왜 움직이기 시작했나?', '숲과 마을이 함께 살 길이 있을까?', '이레가 지나도 마을은 남아 있을까?'],
      scene: { title: '문을 두드리는 가지', text: '새벽, 여관 문을 두드리는 소리. 열어 보니 문 앞까지 나뭇가지가 뻗어 와 있고, 가지 끝에 손수건 한 장이 걸려 있다.', ask: '그 손수건은 누구 것인가요? 어떻게 알아봤나요?' },
      tags: ['기묘한', '서늘한', '탐험', '시간 제한'], tone: '기묘하고 서늘하게',
      front: {
        dangers: [
          { name: '숲의 노한 신령', type: '신', motive: '빼앗긴 것을 되찾는다',
            portents: ['우물이 마른다', '가축이 숲으로 걸어 들어간다', '신령이 아이의 입을 빌려 말한다'], doom: { text: '마을이 숲에 삼켜진다', type: '파괴' } },
          { name: '불을 놓자는 사람들', type: '당파', motive: '마을의 주도권을 쥔다',
            portents: ['기름과 횃불을 모은다', '반대하는 사람을 가둔다', '숲에 불을 놓는다'], doom: { text: '숲과 마을이 함께 불탄다', type: '혼돈의 득세' } },
        ],
        cast: ['촌장 브리그', '나무꾼 우두머리 할데', '약초꾼 노파 엘스'],
        blank: '숲이 빼앗긴 것이 무엇인지',
        clock: '이레: 숲이 마을에 닿기까지',
      } },
    { id: 'dw-dragonhero', icon: '🐲', row: 'kingdom', genre: 'fantasy', title: '용을 잡은 영웅', kind: '판타지', length: 'short', beginner: true,
      situation: '용을 잡았다는 영웅 덕분에 마을은 사흘째 잔치 중이다. 그런데 오늘 아침, 죽었다던 용이 마을 위를 날아갔다. 영웅은 모험가들에게 몰래 도와 달라고 매달린다.',
      questions: ['영웅의 거짓말은 들통날까?', '용은 무엇을 찾으러 왔나?', '마을은 용과 싸울까, 거래할까?'],
      scene: { title: '지붕 위의 용', text: '잔치가 한창일 때 하늘이 어두워지고, 여관 지붕 위로 용이 내려앉는다. 영웅은 식탁 밑으로 들어가 모험가 한 명의 발목을 붙잡는다.', ask: '영웅은 왜 하필 여러분에게 매달리나요?' },
      tags: ['유쾌한', '소동극', '대화', '액션'], tone: '가볍고 유쾌하게',
      front: {
        dangers: [
          { name: '은비늘 용', type: '용', motive: '알을 지킨다',
            portents: ['마을 가축을 낚아챈다', '영웅을 내놓으라고 한다', '마을에 불을 뿜는다'], doom: { text: '마을이 잿더미가 된다', type: '파괴' } },
          { name: '영웅 덕에 한몫 챙긴 사람들', type: '부패한 정부', motive: '지금 가진 것을 지킨다',
            portents: ['영웅 동상을 세운다', '진실을 아는 사람의 입을 막는다', '용 사냥대를 꾸린다'], doom: { text: '거짓말을 지키려다 마을이 용과 전쟁을 벌인다', type: '혼돈의 득세' } },
        ],
        cast: ['영웅 보리스', '촌장 겸 여관 주인 마르타', '떠돌이 행상 핍'],
        blank: '용의 알을 누가 가져갔는지',
      } },
    { id: 'dw-dwarfmine', icon: '⛏', row: 'dungeon', genre: 'dungeon', title: '드워프 폐광', kind: '던전', length: 'short', beginner: true,
      situation: '고블린 떼가 마을 대장장이를 끌고 드워프 폐광으로 사라졌다. 요즘 폐광에서 도망쳐 나오는 고블린이 부쩍 늘었다. 갱도 깊은 곳에서 뭔가 깨어났다는 소문이 돈다.',
      questions: ['대장장이는 살아서 돌아올 수 있을까?', '고블린들은 무엇에게서 도망치고 있나?', '폐광 깊은 곳의 그것을 다시 잠재울 수 있을까?'],
      scene: { title: '갱도 입구의 정찰병', text: '고블린 정찰병 셋이 모험가들에게 활을 겨눈다. 그중 하나가 대장장이의 망치를 들고 있다.', ask: '대장장이는 여러분에게 어떤 사람인가요?' },
      tags: ['거친', '던전', '전투', '구출'], tone: '거칠고 박진감 있게',
      front: {
        dangers: [
          { name: '붉은이빨 고블린 부족', type: '괴물 떼', motive: '새 보금자리를 찾는다',
            portents: ['대장장이에게 무기를 만들게 한다', '마을 외곽을 습격한다', '폐광을 버리고 마을로 몰려온다'], doom: { text: '마을이 고블린 손에 넘어간다', type: '압제' } },
          { name: '깊은 곳에서 깨어난 것', type: '고대의 저주', motive: '깨어나 퍼진다',
            portents: ['갱도가 흔들린다', '고블린들이 미쳐 날뛴다', '봉인이 깨진다'], doom: { text: '산 아래 마을까지 어둠이 번진다', type: '파괴' } },
        ],
        cast: ['대장장이 브론', '고블린 족장 스크랄'],
        blank: '깨어난 것의 정체',
      } },
    { id: 'dw-sunkentemple', icon: '🌊', row: 'dungeon', genre: 'dungeon', title: '가라앉은 신전', kind: '던전', length: 'short',
      situation: '백 년 만에 바닷물이 크게 빠지자, 바다 밑에 잠겨 있던 신전이 드러났다. 물이 다시 차기까지 반나절. 다른 탐험대가 이미 먼저 들어갔다.',
      questions: ['신전 깊은 곳에는 무엇이 잠들어 있나?', '먼저 들어간 탐험대는 적일까, 동료일까?', '물이 차기 전에 빠져나올 수 있을까?'],
      scene: { title: '기어 올라온 짐꾼', text: '젖은 계단을 반쯤 내려갔을 때, 아래에서 비명과 함께 누군가 기어 올라온다. 먼저 들어간 탐험대의 짐꾼이다. "돌아가요, 그게 깨어났어요!"', ask: '짐꾼은 여러분 중 누구를 알아보고 매달리나요?' },
      tags: ['긴박한', '탐험', '함정', '시간 제한'], tone: '긴장감 넘치고 위태롭게',
      front: {
        dangers: [
          { name: '잠든 바다의 신', type: '신', motive: '숭배자를 모은다',
            portents: ['벽화가 빛나기 시작한다', '탐험대원 하나가 신의 목소리를 듣는다', '제단에 피가 흐른다'], doom: { text: '신이 깨어나 해안 마을들이 바다에 잠긴다', type: '파괴' } },
          { name: '바다매 탐험대', type: '당파', motive: '보물을 독차지한다',
            portents: ['갈림길에 덫을 놓는다', '모험가들의 퇴로를 끊는다', '제단의 보물을 들어 올린다'], doom: { text: '탐험대가 신의 힘을 손에 넣는다', type: '압제' } },
        ],
        cast: ['탐험대장 이라', '짐꾼 토미', '신전의 마지막 사제(유령)'],
        blank: '신의 이름과 모습',
        clock: '반나절: 물이 다시 차기까지',
      } },
    { id: 'dw-lastmap', icon: '🧭', row: 'dungeon', genre: 'dungeon', title: '마지막 지도', kind: '던전', length: 'long',
      situation: '이름난 탐험가가 아무도 가 보지 못한 던전의 지도를 남기고 죽었다. 지도는 둘로 찢겨 있고, 반쪽은 모험가들 손에 있다. 나머지 반쪽을 가진 자들이 모험가들을 쫓고 있다.',
      questions: ['나머지 반쪽은 누구 손에 있나?', '탐험가는 정말 사고로 죽었을까?', '누가 먼저 던전에 닿을까?'],
      scene: { title: '불난 여관', text: '한밤중 여관에 불이 난다. 연기 속에서 복면을 쓴 자들이 모험가들의 방문을 부수고 들어온다. "지도 내놔!"', ask: '지도는 지금 누가 갖고 있나요? 어디에 숨겼나요?' },
      tags: ['흥미진진한', '활극', '여행', '경쟁'], tone: '모험 활극처럼 경쾌하게',
      front: {
        dangers: [
          { name: '검은돛 현상금 사냥꾼', type: '당파', motive: '지도를 손에 넣어 팔아넘긴다',
            portents: ['모험가들에게 현상금을 건다', '길목마다 사람을 심는다', '모험가의 지인을 인질로 잡는다'], doom: { text: '던전의 보물이 악당 손에 넘어간다', type: '압제' } },
          { name: '탐험가의 옛 동료 레오나', type: '당파', motive: '던전의 비밀을 독차지한다',
            portents: ['모험가들에게 손을 내민다', '지도를 몰래 베낀다', '던전 입구를 막는다'], doom: { text: '던전 깊은 곳에 갇혀 있던 것이 풀려난다', type: '혼돈의 득세' } },
        ],
        cast: ['죽은 탐험가 오스', '현상금 사냥꾼 두목 가렛', '옛 동료 레오나'],
        blank: '던전에 무엇이 있는지',
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
