# Round 2 verdict: contradiction lens

Position: amend

Ran nothing. I did not run the scan or a test. I read the code at HEAD only.

## Round 1 findings checked

- CONFIRMED: an unchecked box over a Delivered plan means `done` elsewhere. `plot-sprint-release.sh:60-79` states the rule in its comment ("bookkeeping lag... So it reads `done`"). `deliver.ts:248` ticks the box. `/plot-sprint close` step 2a (`skills/plot-sprint/SKILL.md:542-560`) ticks every unchecked box whose plan is `delivered` or `released`. Option 1 keeps a state no other command keeps.
- CONFIRMED: "any HTML comment" collides with `<!-- pr: #N, branch: x -->` (`sprint-annotation.ts:44-55`). The collision is wider than round 1 said. Step 2a writes a second comment, `<!-- reconciled: <phase> -->`, on every ticked item (`SKILL.md:553-554`). Any "any comment" rule reads that comment too, so an author who unticks a reconciled item gets a silent kept-open.
- CONFIRMED: section 17 skips Closed sprints (`plot-reconcile-scan.sh:2230`) and does its own tag lookup (`:2235-2238`). The plan's claim that `plot-sprint-release.sh` knows whether the release shipped is false. The existing section 17 also makes the opposite point: for a shipped release it says "a person closes it: the tag says the train left, not that the work is done". The repo already decided that a tag proves no completion.
- CONFIRMED: the duplicated domain rule. `reconcile.ts:125-130` holds `staleTally`, and `reconcile.ts:328` emits `sprint-tally-stale`. The plan's "the board reads neither" is wrong. The scan and the domain rule form a second implementation of one rule with no corpus test named in the plan (CLAUDE.md "A Shell Script Asks The Domain").

## Missed in round 1

- The scan numbers two sections "13". `:113` and `:1835` are "Stale sprint tally". `:1986` is "Stale interrogation rounds". The plan says "section 13" and "both header comments". It must name the header comment at `:113` (index list) and `:1809` (section comment, which is headed "11."), and not touch `:1986`. The `:1809` heading says "11. Stale sprint tally", so the plan's "section 13" matches the echo at `:1835` only.
- The plan's Reproduction says the item stays unchecked "until the release is cut" ("…, released"). That contradicts the settled estate reading: the box is a fact about the sprint's promise, and the sprint close (step 2a) ticks it on `delivered`. If a sprint item must stay open until release, the repo has a gap in close step 2a and `scoreItem`, which this plan does not address. Option 2 (drop the hint) plus a fix to the sprint-item wording in the consumer's sprint is the only option that does not contradict these.
- The Review `pr` and `Rounds: 1` fields are unchanged, and the Open Points list holds seven unresolved items. No Open Point records a decision.

## What blocks approval

Open Question 1 is undecided, and the plan recommends option 1, which contradicts `scoreItem` (`done`), close step 2a and `deliver.ts:248`. The plan must choose option 2, or choose option 1 and state which of those three changes with it.

## Changes before approval

1. Choose option 2: the hint stops naming an annotation. Rewrite the Changelog and the slice to that one outcome, and drop "if chosen".
2. If option 1 stays, require a named `open: <reason>` field inside the item's existing comment, an offset of removed shell lines, and a corpus test pairing `staleTally` with section 13.
3. Name `reconcile.ts:125-130` and `:328`, and the header comment at `:113`.
4. Remove "Related: #3489" or mark it as the consumer's number.
