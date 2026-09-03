# Quiet is not one state

> QUIET is the classifier's fallthrough, so it holds 26 rows that are three different things: a closed PR is a decision, a claim-only branch is an orphaned claim, and six months of commits with no PR is abandoned work. Each needs a different act, and the board offers one word for all of them.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-03, Jan Wloka, in-session

## Changelog

- The board tells a closed PR from an abandoned branch from an unworked claim, instead of filing all three under QUIET with a commit age. A closed PR leaves the board, because somebody already decided.

Board impact: yes, and it is the whole change. `classifyGroup` in `packages/board/src/server/fleet.ts` decides the section; the rendered states must come out as domain properties, per the Layering Rule.

## Motivation

**QUIET is the fallthrough.** `fleet.ts:4392-4393` is the last pair of lines in `classifyGroup`:

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

**A closed PR leaves the board.** It is `done` — the decision was taken, and a decision is not a thing to look at. It stays reachable through the plan it belongs to and through the host, which is where a reversal would be argued.

**A claim-only branch is an orphaned claim.** `packages/domain/src/rules/sweepable.ts` already names the kind — `ClaimRefReadings`, `isSweepableClaim`, `'not-an-empty-claim'` — and `plot-reap.sh` already sweeps it. **The board must use the word the sweep uses**, so a reader who sees one on the board finds it again in the sweep's output rather than meeting two names for one thing.

**Abandoned work says so, and says how long.** Real commits, no PR, nobody on it. It is the one kind here that genuinely needs a person: revive it, or drop it. It earns its own placement rather than a shared silence.

**QUIET keeps only what it means:** a branch nobody is on, that nothing else describes. If the fallthrough still catches a population after this, that population has a name nobody has found yet — and the fallthrough should say *unclassified* rather than borrow a word.

### Open Questions

- [ ] **Does a closed PR leave, or move to DONE?** Leaving is cleaner and loses the audit trail from the board's own surface; DONE keeps it visible and costs a row. The estate has 17, and DONE already holds delivered work — a rejected branch beside a merged one may read as an equal outcome when it is not.
- [ ] **Where does abandoned work belong?** It needs a decision, which argues WAITING ON YOU. But 6 rows of months-old work would sit permanently beside things that need an answer today, and a section that never empties stops being read.
- [ ] **What reopens a closed PR's row?** If the host reopens it, the branch is live again. The board polls PR state, so this is a matter of not caching the disappearance rather than new machinery — but it should be stated.

## Branches

### Telling them apart

- `feature/quiet-holds-one-kind-of-row` — a domain rule that classifies a branch nobody is on: `closed-pr`, `orphaned-claim`, `abandoned`, `quiet`. Readings as values, arrow functions, unit-tested without a browser. It decides only; nothing renders yet, and `classifyGroup` is untouched.

### Reading it on the board

- `feature/the-board-reads-the-quiet-kinds` — `classifyGroup` calls the rule instead of falling through to an age note. A closed PR leaves; an orphaned claim and abandoned work each get their placement and their sentence. One browser test per kind proves the badge shows what the rule decided — the rendering, not the deciding.

## Notes

**This plan came from a question about a screenshot.** Asked *"what's the problem with this?"* about the QUIET list, the answer needed three measurements, and the first two attempts at them were wrong: a `grep -vc` returning `0` for *zero non-claim commits* was read as the wrong branch, giving `claim-only: 0` against a branch that plainly was one. The numbers above are from the corrected count.

**The withdrawn-plan fix is the precedent and the warning.** #669 changed the sentence and deliberately left the group — *"The GROUP is untouched"* — which was the wrong call: the group is the part that asks a person for something, and a withdrawn plan's branch still sits in WAITING ON YOU today. **This plan must move rows, not only relabel them**, or it repeats that error at larger scale.

**What is NOT in scope.** The agent lifecycle (`an-agent-holds-one-desk`), the sweep's behaviour (`plot-reap.sh` already refuses these correctly), and the `Slice`/`Wave` naming defect.
