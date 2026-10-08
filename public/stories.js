// Stories for the new-campaign gallery, Netflix style: a poster tile per story, and the
// picked one shown large above the rows. The copy follows the selection-card-copy skill's
// story branch: a four-sentence synopsis (who goes in, why, the turn, what is at stake), the
// first scene (where the GM starts; it ends on a hook), tags that mix mood and what you do.
// There are no episodes here, so nothing is called "1화".
//   premise / tone / scene.text / length go to the GM (scene.text = the opening to start in,
//   length = how big a story to design; the story still ends only when it ends)
//   genre: a key of RANDOM in app.js (the builder's d20 cards follow it)
//   row: which row of the gallery the tile sits in

export const STORY_ROWS = { kingdom: '마을과 왕국', dungeon: '던전 속으로' };

export const STORIES = {
  dw: [
    { id: 'dw-belltower', icon: '🔔', row: 'kingdom', genre: 'fantasy', title: '잿빛 종탑의 비밀', kind: '판타지', length: 'short', beginner: true,
      synopsis: '밤마다 종이 울리고, 다음 날이면 누군가 사라지는 국경 마을. 모험가들이 그 까닭을 알아보러 마을에 온다. 하지만 영주는 아무것도 말해 주지 않고, 주민들은 뭔가 숨기는 눈치다. 종탑에 오르기 전에, 누구를 믿을지 정해야 한다.',
      scene: { title: '주인 없는 신발', text: '첫날 밤, 종이 울린다. 아침이 되자 종탑 아래 남은 건 작은 신발 한 짝. 신발 주인은 어디로 갔을까.' },
      tags: ['으스스한', '수수께끼', '조사', '대화'],
      premise: '밤마다 종이 울리고 사람이 하나씩 사라지는 국경 마을. 영주는 아무것도 말하지 않고 주민들은 뭔가 숨긴다.',
      tone: '어둡지만 희망이 남아 있게' },
    { id: 'dw-funeral', icon: '👑', row: 'kingdom', genre: 'fantasy', title: '왕관 없는 장례식', kind: '판타지', length: 'long',
      synopsis: '늙은 왕의 장례식 날, 왕관이 사라진다. 왕위를 노리는 세 사람이 저마다 모험가들에게 왕관을 찾아 달라고 부탁한다. 하지만 셋 다 아는 걸 전부 말하지는 않는다. 왕관을 누구에게 건네느냐에 따라 이 나라의 앞날이 달라진다.',
      scene: { title: '낯선 반지', text: '관을 덮기 직전, 왕의 손가락에서 처음 보는 반지가 눈에 띈다. 왕비는 그런 반지를 본 적이 없다고 한다.' },
      tags: ['숨 막히는', '음모', '협상', '추리'],
      premise: '늙은 왕의 장례식 날 왕관이 사라지고, 왕위를 노리는 세 사람이 저마다 모험가들에게 왕관을 찾아 달라고 한다.',
      tone: '숨 막히는 궁정 음모극처럼' },
    { id: 'dw-walkingwood', icon: '🌲', row: 'kingdom', genre: 'fantasy', title: '걷는 숲', kind: '판타지', length: 'short', beginner: true,
      synopsis: '마을을 둘러싼 숲이 밤마다 한 걸음씩 다가온다. 이대로라면 이레 뒤에는 마을이 숲에 묻힌다. 모험가들은 숲이 왜 움직이는지 알아내야 한다. 베어 낼지 달랠지는 그다음 문제다.',
      scene: { title: '우물가의 참나무', text: '아침에 나와 보니 우물 옆에 참나무 한 그루가 서 있다. 어젯밤까지는 없던 나무다. 껍질에 누군가의 이름이 새겨져 있다.' },
      tags: ['기묘한', '서늘한', '탐험', '시간 제한'],
      premise: '마을을 둘러싼 숲이 밤마다 한 걸음씩 다가와, 이레 뒤면 마을이 숲에 묻힌다. 숲이 왜 움직이는지 알아내야 한다.',
      tone: '기묘하고 서늘하게' },
    { id: 'dw-dragonhero', icon: '🐲', row: 'kingdom', genre: 'fantasy', title: '용을 잡은 영웅', kind: '판타지', length: 'short', beginner: true,
      synopsis: '용을 잡았다는 영웅 덕분에 마을은 사흘째 잔치 중이다. 그런데 오늘 아침, 죽었다던 그 용이 마을 위를 날아간다. 영웅은 모험가들에게 몰래 도와 달라고 매달린다. 거짓말을 덮어 줄지, 마을에 털어놓을지는 모험가들 마음이다.',
      scene: { title: '잔칫상 위의 그림자', text: '잔치가 한창일 때 하늘이 갑자기 어두워진다. 모두가 고개를 드는 사이, 영웅은 조용히 식탁 밑으로 들어간다.' },
      tags: ['유쾌한', '소동극', '대화', '액션'],
      premise: '용을 잡았다는 영웅을 위한 잔치가 한창인데, 죽었다던 그 용이 마을 위를 날아간다. 영웅은 모험가들에게 몰래 도움을 청한다.',
      tone: '가볍고 유쾌하게' },
    { id: 'dw-dwarfmine', icon: '⛏', row: 'dungeon', genre: 'dungeon', title: '드워프 폐광', kind: '던전', length: 'short', beginner: true,
      synopsis: '고블린 떼가 마을 대장장이를 폐광으로 끌고 갔다. 모험가들은 그를 데려오려고 어두운 갱도로 내려간다. 그런데 깊은 곳에서 고블린들이 오히려 도망쳐 나온다. 대장장이를 구하려면 고블린들이 뭘 피해 달아나는지부터 알아야 한다.',
      scene: { title: '걸려 있는 망치', text: '갱도 입구 기둥에 대장장이의 망치가 걸려 있다. 누가 일부러 걸어 둔 것 같다. 안쪽에서 쇠 두드리는 소리가 희미하게 들린다.' },
      tags: ['거친', '던전', '전투', '구출'],
      premise: '고블린 떼가 마을 대장장이를 드워프 폐광으로 끌고 갔다. 그런데 갱도 깊은 곳에서 고블린들이 무언가를 피해 도망쳐 나온다.',
      tone: '거칠고 박진감 있게' },
    { id: 'dw-sunkentemple', icon: '🌊', row: 'dungeon', genre: 'dungeon', title: '가라앉은 신전', kind: '던전', length: 'short',
      synopsis: '백 년 만에 바닷물이 크게 빠지자, 바다 밑에 잠겨 있던 신전이 드러난다. 물이 다시 차기까지 남은 시간은 반나절. 깊이 들어갈수록 보물은 커지지만, 돌아올 길도 그만큼 멀어진다. 게다가 누군가 이미 먼저 들어가 있다.',
      scene: { title: '아직 타는 횃불', text: '젖은 계단을 내려가자 벽에 횃불 하나가 타고 있다. 꽂은 지 얼마 안 된 횃불이다. 발밑으로 물이 조금씩 차오른다.' },
      tags: ['긴박한', '탐험', '함정', '시간 제한'],
      premise: '백 년 만의 썰물로 바다 밑 신전이 드러났다. 물이 다시 차기까지 반나절이고, 누군가 이미 먼저 들어가 있다.',
      tone: '긴장감 넘치고 위태롭게' },
    { id: 'dw-lastmap', icon: '🧭', row: 'dungeon', genre: 'dungeon', title: '마지막 지도', kind: '던전', length: 'long',
      synopsis: '이름난 탐험가가 아무도 가 본 적 없는 던전의 지도를 남기고 죽었다. 그 지도를 손에 넣은 날부터, 모험가들은 쫓기는 신세가 된다. 다른 모험가 무리, 현상금 사냥꾼, 탐험가의 옛 동료까지 모두 같은 지도를 노린다. 누구보다 먼저 던전에 닿아야 한다.',
      scene: { title: '지도 반쪽', text: '여관 주인이 지도를 팔겠다며 모험가들을 부른다. 약속한 방에 가 보니 주인은 쓰러져 있고, 손에는 찢어진 지도 반쪽만 남아 있다.' },
      tags: ['흥미진진한', '활극', '여행', '경쟁'],
      premise: '이름난 탐험가가 남긴 미지의 던전 지도를 두고 모험가 무리, 현상금 사냥꾼, 탐험가의 옛 동료가 경주를 벌인다.',
      tone: '모험 활극처럼 경쾌하게' },
  ],
};

// The first row: ways to start that are not a written story.
export const STARTS = [
  { id: 'gm', icon: '🎭', title: '마스터에게 맡기기',
    synopsis: '어떤 모험일지는 시작해 봐야 안다. 마스터가 일행에 맞춰 세계와 사건을 짠다. 첫 장면부터 하나씩 알아 가면 된다.' },
  { id: 'random', icon: '🎲', title: '아무거나',
    synopsis: '장소와 사건과 분위기를 그 자리에서 뽑는다. 누를 때마다 다른 이야기가 나온다. 마음에 들 때까지 뽑아도 된다.' },
  { id: 'custom', icon: '✍', title: '우리만의 이야기',
    synopsis: '머릿속에 있던 모험을 한 줄로 적는다. 마스터가 거기에 사람과 사건을 채운다. 첫 장면을 정해 두면 거기서 시작한다.' },
];

export const LENGTH = { short: '짧은 모험', long: '긴 모험' };
