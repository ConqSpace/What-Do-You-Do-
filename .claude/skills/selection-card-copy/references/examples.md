# Worked examples

## Dungeon World 직업 (the set the user approved)

| 직업 | 소개 (두 줄) | 대표 능력 |
|---|---|---|
| 🗡 전사 | 갑옷과 칼 한 자루로 버텨 온 싸움꾼입니다. 먼지가 걷히면 서 있는 것은 언제나 당신입니다. | **고유병기**: 이름이나 다름없는 자기만의 무기. 형태와 특징을 직접 정합니다. |
| 🛡 성기사 | 신의 권위를 등에 업은 기사입니다. 맹세한 임무는 무슨 일이 있어도 끝까지 해냅니다. | **안수치료**: 손을 얹고 기도하면 상처를 치유하거나 병을 고칩니다. |
| 🏹 사냥꾼 | 숲과 들판을 집 삼아 사는 추적자입니다. 한번 쫓기 시작한 자취는 놓치지 않습니다. | **동물 친구**: 충직한 동물이 곁에서 함께 싸우고, 살피고, 지켜 줍니다. |
| 🗝 도적 | 자물쇠와 덫과 독을 다루는 뒷골목의 전문가입니다. 정면 승부는 바보들이나 하는 일입니다. | **암습**: 방심한 적을 노리면 큰 피해를 주고 유리한 상황을 만듭니다. |
| ✨ 마법사 | 금지된 지식에 손댄 학자입니다. 가장 약하지만, 세상을 가장 크게 바꿀 수 있습니다. | **마법 의식**: 힘이 서린 곳에서라면 무엇이든 시도할 수 있습니다. |
| ☀ 사제 | 신의 목소리를 전하는 자입니다. 일행이 쓰러지지 않게 끝까지 붙잡아 줍니다. | **언데드 퇴치**: 성표를 들면 언데드가 다가오지 못하고 달아납니다. |
| 🌿 드루이드 | 대지의 신령이 길러 낸 자식입니다. 짐승의 모습으로 결연된 땅을 누빕니다. | **변신**: 결연된 땅의 짐승으로 변해 그 몸의 능력을 씁니다. |
| 🎻 음유시인 | 노래 한 곡이면 어디서든 환영받는 이야기꾼입니다. 전설의 끝을 직접 보려고 길을 나섰습니다. | **마법의 곡조**: 노래로 동료를 치유하거나 다음 일격을 강하게 합니다. |

Why the signatures: each is the one starting 액션 no other class shares. 사제 could have taken 주문 시전, but 마법사 has a 주문 시전 too; 언데드 퇴치 is the cleric's alone.

## Weak drafts and the fix

**Role words instead of a person**
- Before: "갑옷과 칼솜씨만 믿고 위험 속에 뛰어든다. 일행의 벽이다."
- Problem: one line does both jobs; "일행의 벽" is a role label (tank), and there is no signature ability, so the card can't say what this class does that others don't.
- After: the 전사 row above.

**Line 2 repeats line 1**
- Before: "숲에 사는 사냥꾼입니다. 숲에서 사냥을 하며 살아갑니다."
- After: "숲과 들판을 집 삼아 사는 추적자입니다. 한번 쫓기 시작한 자취는 놓치지 않습니다."

**Signature that isn't in the rules**
- Before: 도적 · "그림자 걸음: 아무도 모르게 움직입니다." (sounds right, but no such 액션 exists; the player will look for it on the sheet and not find it)
- After: 도적 · "암습: 방심한 적을 노리면 큰 피해를 주고 유리한 상황을 만듭니다."

**Full move text in the box**
- Before: "안수치료: 환자와 피부 접촉을 하고 그 건강을 위해 기도하면 +매 판정. 10+ 1d8 치유 또는 질병 치료, 7~9 피해나 질병이 옮아 옴."
- After: "안수치료: 손을 얹고 기도하면 상처를 치유하거나 병을 고칩니다." (the 핵심 액션 page has the rest)

## Rule system cards (the shape for a whole game)

A rule card sells the kind of story, not the dice. The dice go in the numbers.

- Before: "영웅 판타지. 행동이 액션을 일으키고, 2d6+능력수정치로 10+ 성공 · 7~9 대가 있는 성공 · 6- 마스터의 반격."
- Problem: it explains how to roll. Nobody reads a probability table and thinks "와 해보고 싶다".
- After:

```
🐉 던전 월드                                   2d6 · 직업 8종
던전에 뛰어들어 괴물과 맞서는 영웅들의 이야기입니다.
주사위가 빗나가도 이야기는 멈추지 않고 더 위험해집니다.
┌ 부분 성공 (7~9)
└ 원하는 걸 얻지만, 무엇을 내줄지 골라야 합니다.
```

The signature is the one rule players remember after the session (DW's 7~9, d20's natural 20 and 1, Call of Cthulhu's 이성), told as what it does to the story.

## Call of Cthulhu 직업 (how the shape carries over)

```
🔍 사립탐정                                    신용 9~30
의뢰비보다 진실이 궁금한 사람입니다.
돌아오지 않는 실종자가 요즘 너무 많습니다.
┌ 관찰력 · 심리학
└ 남들이 놓친 흔적과, 사람이 숨기는 것을 봅니다.
```

The signature for an occupation is its pair of defining skills from `COC_OCCUPATIONS[...].skills`, named exactly as the skills are named, with one line on what they let the investigator do.
