# Quiet is not one state

> QUIET is the classifier's fallthrough, so it holds 26 rows that are three different things: a closed PR is a decision, a claim-only branch is an orphaned claim, and six months of commits with no PR is abandoned work. Each needs a different act, and the board offers one word for all of them.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-03, Jan Wloka, in-session
- **Started:** 2026-09-03, Jan Wloka, `feature/quiet-holds-one-kind-of-row`
- **Started:** 2026-09-04, Jan Wloka, `feature/the-board-reads-the-quiet-kinds`
- **Delivered:** 2026-09-04

## Changelog

- The board tells a closed PR from an abandoned branch from an unworked claim, instead of filing all three under QUIET with a commit age. A declined PR reads as declined rather than as silence — and stays visible, because its branch is still on the estate.

Board impact: yes, and it is the whole change. `classifyGroup` in `packages/board/src/server/fleet.ts` decides the section and `prState` decides the closed case; the rendered states must come out as domain properties, per the Layering Rule.

## Motivation

**QUIET is the fallthrough.** The last pair of lines in `classifyGroup` (`packages/board/src/server/fleet.ts`) is:

```ts
if (ageMinutes === null) return { group: 'quiet', note: 'pushed work, age unknown' };
return { group: 'quiet', note: `no commit for ${humanAge(ageMinutes)}` };
```

Anything the classifier cannot place lands there, described by commit age — because age is the only fact left when nothing else matched. **Age is not a state.** *"No commit for 126 days"* is equally true of work somebody rejected, work somebody abandoned, and work nobody started.

### Measured 2026-09-03, this estate

| What the row is | Count | What the board says | What it should say |
|---|---|---|---|
| a **closed** PR, never merged | **17** | `closed`, in QUIET | nothing — it left the board |
| a **claim-only** branch: one `plot: claim` commit and no work | **2** | *in progress* | an orphaned claim |
| **abandoned**: real commits, no PR ever | **6** | *in progress* | abandoned, and for how long |

**A closed PR is a decision, not silence.** Somebody looked at #53, #51, #363, #527, #654 and said no. Those 17 rows fill QUIET and bury the eight that need a person.

**"In progress" is inferred from a ref existing.** No agent is on any of them — this estate ran 0 live workers while the board showed seven rows *in progress*. The code already knows better: `fleet.ts:2582` says *"in progress cannot answer that."*

**It is the same defect this repo fixed once tonight.** `a-withdrawn-plan-says-so` (#669) found a row asserting *"plan not approved yet — still in review"* about a plan whose author had withdrawn it in writing. A state inferred from structure rather than read from evidence — and the same in both places.

**The sweep cannot help.** `plot-reap.sh` refuses six of these correctly: they hold unlanded work. This is a display problem sitting on top of a real one, and the display is what a person acts through.

## Design

### Approach

**Every state named here is a domain property**, per the Layering Rule: *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."* The rule decides; `classifyGroup` reads it; a browser test proves the badge shows it.

**A closed PR is its own kind, and it stays visible.** Round 1 measured the population and the first draft was wrong about it: #53, #363 and #654 all still have **live refs**. The branch exists; only the PR was declined. So "leaving the board" would hide something that is still on the estate, still holds a worktree slot, and is still findable by everything except the surface a person acts through.

**And it is NOT decided in `classifyGroup`.** That function states the rule twice: *"NO `CLOSED` ARM HERE… the `byHead` map is open-only, so a closed PR never arrives — an arm for it would be dead code."* It even records the mistake being made: *"I wrote one on 2026-08-21 before reading that line; `prState` is where the closed case belongs, and it is handled there."*

`prState` already answers `closed` and already says *"CLOSED OUTRANKS EVERY CHECK."* **The machinery exists; only the reading of it is missing.** The rule in slice 1 therefore takes `prState` as one of its readings, and `classifyGroup` gains no closed arm — which is the same conclusion the code reached a fortnight ago.

**A claim-only branch is an orphaned claim.** `packages/domain/src/rules/sweepable.ts` already names the kind — `ClaimRefReadings`, `isSweepableClaim`, `'not-an-empty-claim'` — and `plot-reap.sh` already sweeps it. **The board must use the word the sweep uses**, so a reader who sees one on the board finds it again in the sweep's output rather than meeting two names for one thing.

**Abandoned work says so, and says how long.** Real commits, no PR, nobody on it. It is the one kind here that genuinely needs a person: revive it, or drop it. It earns its own placement rather than a shared silence.

**QUIET keeps only what it means:** a branch nobody is on, that nothing else describes. If the fallthrough still catches a population after this, that population has a name nobody has found yet — and the fallthrough should say *unclassified* rather than borrow a word.

### Open Questions

- [x] **Does a closed PR leave, or move to DONE?** *Answered round 1: neither.* It becomes its own kind and stays visible, because the branch is still there — measured, three of three sampled still have live refs. DONE would read a declined branch as an equal outcome to a merged one; leaving would hide a thing that still exists.
- [ ] **Where does abandoned work belong?** It needs a decision, which argues WAITING ON YOU. But 6 rows of months-old work would sit permanently beside things that need an answer today, and a section that never empties stops being read.
- [ ] **What reopens a closed PR's row?** If the host reopens it, the branch is live again. The board polls PR state, so this is a matter of not caching the disappearance rather than new machinery — but it should be stated.

## Slices

### Telling them apart

- `feature/quiet-holds-one-kind-of-row` — a domain rule that classifies a branch nobody is on: `closed-pr`, `orphaned-claim`, `abandoned`, `quiet`. Readings as values, arrow functions, unit-tested without a browser. It decides only; nothing renders yet, and `classifyGroup` is untouched. → #681

### Reading it on the board

- `feature/the-board-reads-the-quiet-kinds` — the two readers call the rule instead of falling through to an age note. **`classifyGroup` for the branch kinds; `prState` for the closed one** — round 1 established that `classifyGroup` cannot see a closed PR at all, because its `byHead` map is open-only and the function says so twice. An orphaned claim and abandoned work each get their placement and their sentence; a declined PR reads as declined and **stays visible**, because its branch is still on the estate. One browser test per kind proves the badge shows what the rule decided — the rendering, not the deciding. → #683

## Notes

**This plan came from a question about a screenshot.** Asked *"what's the problem with this?"* about the QUIET list, the answer needed three measurements, and the first two attempts at them were wrong: a `grep -vc` returning `0` for *zero non-claim commits* was read as the wrong branch, giving `claim-only: 0` against a branch that plainly was one. The numbers above are from the corrected count.

**The withdrawn-plan fix is the precedent and the warning.** #669 changed the sentence and deliberately left the group — *"The GROUP is untouched"* — which was the wrong call: the group is the part that asks a person for something, and a withdrawn plan's branch still sits in WAITING ON YOU today. **This plan must move rows, not only relabel them**, or it repeats that error at larger scale.

**What is NOT in scope.** The agent lifecycle (`an-agent-holds-one-desk`), the sweep's behaviour (`plot-reap.sh` already refuses these correctly), and the `Slice`/`Wave` naming defect.
