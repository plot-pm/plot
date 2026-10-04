# A hold names the landing nobody could answer

> When the host cannot say whether a plan's earlier slice landed, the supervisor holds every later slice of that plan as `not-claimable`, the word for "the plan's ordering blocks this". The tick line does not say that the host refused.

## Status

- **State:** Released
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1094
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `bug/a-held-slice-names-the-unanswered-landing`
- **Delivered:** 2026-10-02
- **Released:** 2026-10-04, v2.23.0

## Changelog

- A slice held because an earlier slice's landing could not be asked reads `prior-unknown` on the supervisor's tick, and the tick names it, where it read `not-claimable` before.
- The tick line says how the merged listing answered: `merged-set=whole`, `merged-set=partial(<kind>)` or `merged-set=unaskable(<kind>)`, where `<kind>` is the host's refusal (`throttled`, `secondary` or `failed`).

## Motivation

#1094 was filed from a Bitbucket estate on Plot 2.21.0: under HTTP 429 the supervisor held 36 slices `not-claimable`, among them slices whose earlier waves had merged days before, and nothing on the tick line named the 429.

**What has changed since, and what has not.** Measured on `origin/main` (`19f662d1`), 2026-10-01:

- **The listing failure is no longer read as "nothing merged".** `mergedBranches` returns `{ merged, whole: false }` when `prList` fails or leaves a refusal (`packages/board/src/server/entry/registryd-main.ts:587`, `:591`), and `readQueue` then asks known PR numbers through `landedWithoutListing` (#1143, `packages/board/src/server/queue-reading.ts:239-241`).
- **The first unsettled slice is labelled correctly.** Its branch is claimable and briefed, so `readQueue` asks `world.queuedHasLanded` (`queue-reading.ts:253-256`); under 429 that answers `unknown`, and `whyNotReady` returns `merge-unknown` (`packages/domain/src/rules/queue.ts:207`).
- **Every later slice of the same plan is still labelled `not-claimable`.** `queueOfPlan` counts a refless branch the listing did not name as outstanding (`queue-reading.ts:144-145`), `sliceVerdicts` makes every later slice not `eligible`, the entry carries `claimable: false` (`queue-reading.ts:160`), `readQueue` sets `landed: 'not-landed'` for it (`queue-reading.ts:256`), and `whyNotReady` falls through to `not-claimable` (`queue.ts:209`). The 2.22.1 comment on #1094 measured exactly this: the first wave held `merge-unknown`, the only unmerged later slice held `not-claimable`, and the board reported `eligible: 0` while a free agent waited.
- **`not-claimable` is the one hold a looping tick does not name.** `HOLD_SCOPE` marks it `estate` (`registryd-main.ts:1203-1209`) and the looping report skips estate holds (`registryd-main.ts:1301`), so the slice an operator is waiting for appears only as a count.
- **The tick line carries no field for the listing.** `tickLine` prints the hold counts (`packages/board/src/server/entry/registryd.ts:358`) and nothing about whether the merged set was whole.

**What #1139 changes and what it leaves.** `a-merge-subject-proves-a-landing-the-host-cannot` (approved, in flight) proves a merged-and-deleted branch from its merge subject, so on a merge-commit estate the earlier slice settles without the host and the later slice becomes claimable. It leaves two cases where the earlier slice stays unsettled: a squash or rebase merge with no subject, and a branch that has not merged. Its own plan says the host-free answer for an unstarted branch "belongs to #1094" (`docs/plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md`, Open Points). This plan takes the label and the tick line, not that answer: see *What this does NOT do*.

**Holding stays.** `queue-reading.test.ts:117` pins *"SILENCE MUST NOT PROMOTE WORK"*, and #1094 asks for no change of direction. Only the word and the tick line change.

## Design

### The hold

A new `QueueHold`, `prior-unknown`: *an earlier slice of this plan holds a branch whose landing the host could not answer this pass.* It sits after `merge-unknown` in `QUEUE_HOLDS` and is `queue`-scoped in `HOLD_SCOPE`, so a looping tick names its branches under the existing `KEPT_HOLD_NAMES` cap of 12.

**The decision is a domain rule.** `rules/queue.ts` gains `behindUnknownLanding(slices)`: given one plan's queued slices in plan order with their slice index and `landed` answer, it returns the branches of every later slice that is not claimable while an earlier slice carries a `landed: 'unknown'` branch. `QueuedSlice` gains `priorUnknown: boolean`, and `whyNotReady` tests it in the not-ready branch:

| Reading | Answer |
|---|---|
| `landed: 'landed'` | `already-merged` (unchanged) |
| `landed: 'unknown'` | `merge-unknown` (unchanged) |
| ready | `null` (unchanged) |
| not claimable, `priorUnknown` | `prior-unknown` |
| not claimable | `not-claimable` (unchanged) |
| claimable, no brief | `no-brief` (unchanged) |

`readQueue` builds the slices as today, then asks `behindUnknownLanding` per plan and sets `priorUnknown`. It asks the host nothing new: the `unknown` answers are the ones this pass already took.

### The tick line

`readQueue` returns the listing's state beside the slices: `whole`, `partial` (the listing answered and left a refusal) or `unaskable` (the listing failed), with the refusal's `kind` from `HostRefusal` (`packages/domain/src/ports/host.ts:74-79`). `tickLine` prints `merged-set=<state>` on every tick that read a queue, `merged-set=whole` included, so the field is constant and a missing key is a version difference, the rule `QUEUE_HOLDS` already follows.

### What this does NOT do

- **It gives no host-free answer for an unsettled branch.** A refless branch the listing did not name is either unstarted or a squash merge whose ref was deleted, and git cannot tell the two apart on a squash estate. The PR index never says no (CLAUDE.md, *A Decision Reads The Index*). #1139 settles the merge-commit case; the rest stays held, as `queue-reading.test.ts:117` requires.
- **It does not change the board or the scan.** The board asks the host for each slice and shows `eligible`; the scan's `--next` reads its terminal cache. Two components answering differently under 429 is #1094's second observation, and it is not repaired here.
- **It does not change how often the host is asked.** No new call.

## Slices

### A held slice names the unanswered landing (Branch: bug/a-held-slice-names-the-unanswered-landing, PR: #1197) <!-- waits: bug/the-queue-reads-the-merge-subject -->

`prior-unknown` in `QueueHold`, `QUEUE_HOLDS` and `HOLD_SCOPE`; `behindUnknownLanding` and `QueuedSlice.priorUnknown` in `packages/domain/src/rules/queue.ts`; the call in `readQueue`; the listing state on `QueueReadings` and `merged-set=` in `tickLine`. It waits on #1139's second slice because both change `readQueue` at `queue-reading.ts:237-258`. <!-- builds: behindUnknownLanding, the prior-unknown hold -->

Tests:

- `packages/domain/test` unit cases for `behindUnknownLanding`: an earlier `unknown` marks every later non-claimable slice; an earlier `not-landed` marks none; a later claimable slice is never marked; a second plan is not marked by the first plan's answer. 100 % branch coverage holds.
- `whyNotReady` cases for `prior-unknown` and for `not-claimable` without `priorUnknown`.
- `packages/board/test/unit/queue-reading.test.ts`: a world whose listing fails and whose `queuedHasLanded` answers `unknown` for slice 1 of a two-slice plan holds slice 1 `merge-unknown` and slice 2 `prior-unknown`; the same world with slice 1 answering `not-landed` holds slice 2 `not-claimable`.
- `packages/board/test/unit/registryd-tick.test.ts` and `registryd-main.test.ts`: the summary line carries `prior-unknown=` (the existing `QUEUE_HOLDS` loop at `registryd-main.test.ts:538` covers it) and `merged-set=whole`, `merged-set=partial(throttled)` and `merged-set=unaskable(failed)` for the three listing outcomes; a looping tick names a `prior-unknown` branch.

## Done when

- On a fixture estate whose listing fails, a two-slice plan's second slice reads `prior-unknown`, not `not-claimable`, and a looping tick names it.
- `tickLine` prints `merged-set=` on every tick that read a queue, and the three states have tests.
- No new host call: the queue-reading test counts host calls and the count is unchanged.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass. A changeset names `@plot-pm/board` and `plot`.

## Open Points

- [ ] The board's row for a slice the supervisor holds `prior-unknown` still reads `eligible`, because the board asks the host itself. A person reading both sees two answers until the board reads the supervisor's hold. Not in this plan.

## Notes

Filed from a Bitbucket estate on 2026-09-30; its 2.22.1 comment narrowed it to the later slice's label. Written 2026-10-01 after #1139 and #1143, which settle the landing question where a merge subject or a known PR number exists.
