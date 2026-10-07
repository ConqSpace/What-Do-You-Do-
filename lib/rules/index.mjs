// Rule systems. The engine runs the same round for every system (declare → the GM asks
// for checks → the server rolls → optional follow-up choices → the GM narrates); a rule
// module decides everything system-specific:
//
//   id, label, gmName                 'dw', '던전 월드', 'GM'
//   meta()                            what the setup screen needs (stats, classes, defaults)
//   rulesText / gmPrinciples / playerPrinciples          prompt sections
//   characterTask(c, ctx)             instructions + JSON shape for making a character
//   makeCharacter(raw)                → rule fields of a sheet ({stats, maxHp, ...})
//   sheetLine(ch, opts)               one-line sheet for prompts
//   sheetView(ch)                     generic sheet for the UI {badges, stats, tracks, lists}
//   checkGuide, checkSchema           how the GM asks for a check, and its JSON shape
//   normalizeCheck(x)                 model JSON → check (without who) or null
//   commandCheck(words)               human GM "/check <name> ..." words → check or error string
//   resolveCheck(check, ch, ctx)      → roll {title, dice, mod, total, label, tier, ...}; may
//                                     update the sheet (XP, forward bonuses, hold)
//   followUp(roll)                    → null | {prompt, options, count}: choices after a roll
//   applyChoice(roll, picks, ch)      apply the chosen option indices
//   rollText(roll, name)              one line for prompts
//   effectSchema, applyEffect(e, ch)  rule-specific effect fields → change notes
//   armor(ch)                         armor against "damage" effects
//   onDown(ch)                        roll when HP drops to 0 (or null)
//   bondsTask(c, key) (optional)      extra prep step after every character exists
//   mock: {character(ctx), check(decl)}   the demo bot's version of the above
//
// A roll's tier drives the colors in the UI: crit | good | mixed | bad | fumble.

import d20 from './d20.mjs';
import dw from './dw.mjs';

export const RULESETS = { d20, dw };

export function rulesetOf(c) {
  return RULESETS[c?.rules] || d20;
}

export const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
