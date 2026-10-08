---
name: selection-card-copy
description: Write or revise the copy on "pick one" cards in What Do You Do? (TRPG character builder), in the Slay the Spire character-select style - name, a few numbers, a two-line in-world introduction, and one signature ability. Use this whenever the task touches text a player reads while choosing something - Dungeon World 직업 cards, Call of Cthulhu 직업 (occupation) cards, d20 concept chips, quick-start/pregen cards in public/archetypes.js, races, backgrounds, or any new rule system's options - even if the user only says "직업 설명 다듬어줘", "카드 문구", "클래스 소개", "선택 화면이 밋밋해", or asks for a subtitle/tagline.
---

# Selection card copy

Players in the character builder pick from cards: a class, an occupation, a ready-made character. A card has a few seconds to answer two questions: *who would I be?* and *what would I get to do that the others can't?* Slay the Spire's character select answers both in four lines, and this app follows that shape.

## The shape

```
{icon} {이름}                         {숫자 한두 개}
{소개 1: 이 사람은 누구인가}
{소개 2: 태도, 각오, 한 방}
┌ {대표 능력 이름}
└ {무엇을 하는지 한 줄}
```

Example (Dungeon World 전사):

```
🗡 전사                         HP 10+체력 · 피해 d10
갑옷과 칼 한 자루로 버텨 온 싸움꾼입니다.
먼지가 걷히면 서 있는 것은 언제나 당신입니다.
┌ 고유병기
└ 이름이나 다름없는 자기만의 무기. 형태와 특징을 직접 정합니다.
```

No separate subtitle or tagline. When asked for one, the answer is usually this shape: the introduction does a subtitle's job better, and the signature ability carries the "what's different" a tagline tries to squeeze in.

## Introduction: two lines in the world's voice

The introduction is spoken from inside the fiction, the way a narrator would introduce the character, not the way a rulebook describes a role.

- **Line 1 says who they are**: a person with a past or a place in the world. "갑옷과 칼 한 자루로 버텨 온 싸움꾼입니다." Not a job description of what they do in combat.
- **Line 2 gives an attitude or a turn**: pride, a habit, a price they pay, what others think of them. "정면 승부는 바보들이나 하는 일입니다." This is the line that makes the card fun; a second line that only restates line 1 is wasted.
- **No game words.** 탱커, 딜러, 힐러, 서포터, HP, 판정, 보정치 belong to the numbers and the signature box, not here. "일행의 벽이다" explains a role; "먼지가 걷히면 서 있는 것은 언제나 당신입니다" shows it.
- **"~입니다" narration**, second person is welcome on line 2 ("당신"). Keep each line under about 30 Korean characters so the card stays two lines on a phone.
- **A card set reads as a set.** Give every card the same rhythm (identity, then turn), similar length, and make sure no two cards lean on the same image or word (two "숲", two "어둠" in a set of eight is one too many).

## Signature: one real ability

The signature box is the reason to pick this card over the next one, so it comes from the actual rules, not from flavor.

- **Pick from the rule module's own options** (for Dungeon World, the class's starting 액션 in `lib/rules/dw.mjs`; for Call of Cthulhu, the occupation's skills in `lib/builder.mjs`). Choose the one no other card has: 전사's 고유병기 over the 갑옷을 옷처럼 a 성기사 also has.
- **Use the rules' exact name** (Dungeon World follows 던전월드 한국어 공개판: 액션, 인연, 예비 …). A player will meet that name again on the sheet and in the log.
- **Effect in one plain line**: what it lets you do, with a number only when the number is the point ("1d8 치유"). Not the full move text; the 핵심 액션 page shows that.
- When a card has no single standout ability (a d20 concept), use the thing the character carries or knows that changes play ("개조 사이버덱: 잠긴 문과 시스템은 대개 열립니다").

## Numbers

One or two, small, top right: only what changes the choice between cards. Dungeon World: `HP 10+체력 · 피해 d10`. Call of Cthulhu occupations: `신용 9~30`. Leave out what every card shares.

## Writing from a source

Names, lists and terms may come straight from the source the rules follow (a CC BY edition, an SRD). Introductions and effect lines are written fresh: read the source's flavor for mood, then write new sentences; don't translate or trim its paragraphs. Ready-made characters in `public/archetypes.js` are our own and can be rewritten freely.

## Where the copy lives

| Card | File | Fields |
|---|---|---|
| Rule system (new-campaign screen) | `lib/rules/<id>.mjs` → `meta()` | `icon`, `tags` (the numbers: dice, genre), `intro` (what stories you'll play), `signature` (the one rule that makes it fun, e.g. 부분 성공 7~9); drawn in `public/app.js` → `openSetup()` |
| Dungeon World 직업 | `lib/builder.mjs` → `DW_CLASSES` | `icon`, `intro: [line1, line2]`, `signature: { name, text }`; numbers come from `lib/rules/dw.mjs` (hp, damage) |
| Call of Cthulhu 직업 | `lib/builder.mjs` → `COC_OCCUPATIONS` | `icon`, `intro`, `signature` (name = two of its `skills`, "관찰력 · 심리학"); `credit` is the number |
| Quick-start cards | `public/archetypes.js` | `title`, `intro`; d20 cards also `signature` (one of their `items`); dw/coc7 cards borrow their class's or occupation's signature |
| Card rendering | `public/builder.js` → `pcard()`, `quickNums()`, `quickSig()` | layout and numbers |

A new kind of choice card gets the same three fields (`icon`, `intro`, `signature`) next to its data and is drawn with `pcard()`, rather than packing everything into one description string. `test/builder.test.mjs` and `test/archetypes.test.mjs` check the shape: two lines of at most 32 characters, signatures that exist in the rules and don't repeat.

## Layout on a phone

A list of eight four-line cards is a long scroll. Unselected cards show the name, numbers and introduction line 1; the selected card opens to both lines and the signature box. Desktop can show everything.

## Before you hand it over

Read the set top to bottom as a player would and check:

- Could a player tell the cards apart with the names covered?
- Does every line 2 add something line 1 didn't?
- Is any game word left in an introduction?
- Is every signature a real option from the rules, named as the rules name it, and different from every other card's?

More worked examples, including weak drafts and how they were fixed: `references/examples.md`.
