// Rule systems. The engine runs the same round for every system (declare → the GM asks
// for checks → the server rolls → optional follow-up choices → the GM narrates); a rule
// module decides everything system-specific:
//
//   id, label, gmName                 'dw', '던전 월드', 'GM'
//   meta()                            what the setup screen needs (stats, classes, defaults)
//   rulesText / gmPrinciples / playerPrinciples          prompt sections
//   characterTask(c, ctx)             instructions + JSON shape for making a character
//   prerollCharacter() (optional)     server-rolled values the player builds around (CoC)
//   makeCharacter(raw, {preroll})     → rule fields of a sheet ({stats, maxHp, ...})
//   sheetLine(ch, opts)               one-line sheet for prompts
//   sheetView(ch)                     generic sheet for the UI {badges, stats, tracks, lists}
//   checkGuide, checkSchema           how the GM asks for a check, and its JSON shape
//   normalizeCheck(x, ch)             model JSON → check (without who) or null
//   checkLabel(check)                 button text for a check the human rolls
//   commandCheck(words)               human GM "/check <name> ..." words → check or error string
//   resolveCheck(check, ch, ctx)      → roll {title, dice, mod, total, label, tier, ...}; may
//                                     update the sheet (XP, forward bonuses, hold)
//   followUp(roll, ch)                → null | {prompt, options, count, textFor?, textLabel?, bargain?}
//                                     (bargain: Death's deal; the GM prices it before the player picks)
//   applyChoice(roll, picks, ch, {text})  apply the picks; may return {reroll: check} (a push)
//                                     or {bargain: 'accept' | 'refuse'}
//   rollText(roll, name)              one line for prompts
//   effectSchema, applyEffect(e, ch)  rule-specific effect fields → change notes
//   foeSchema, extraSchema, clues     optional extra JSON fields for the GM (CoC: foe skills, clues)
//   armor(ch)                         armor against "damage" effects
//   onDamage(ch, dmg) (optional)      → notes when a character takes damage (CoC major wound)
//   onDown(ch)                        roll when HP drops to 0 (or null); followUp sees it too.
//                                     Who is down, and what that means for turns, is lib/down.mjs
//   bondsTask(c, key) (optional)      extra prep step after every character exists
//   mock: {character(ctx), check(decl)}   the demo bot's version of the above
//
// A roll's tier drives the colors in the UI: crit | good | mixed | bad | fumble. A roll may
// carry damage {expr, total, target} (dealt to a foe) or selfDamage {total} (taken).

import d20 from './d20.mjs';
import dw from './dw.mjs';
import coc7 from './coc7.mjs';

export const RULESETS = { d20, dw, coc7 };

export function rulesetOf(c) {
  return RULESETS[c?.rules] || d20;
}

export const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
