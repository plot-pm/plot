## Implementation brief — a-hold-names-the-landing-nobody-could-answer (wave 1: A held slice names the unanswered landing)

- **Plan (canonical):** `docs/plans/2026-10-01-a-hold-names-the-landing-nobody-could-answer.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-held-slice-names-the-unanswered-landing` (base: `main`)
- **Ends as:** one PR to `main`, opened with `../plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (CI plus a reviewer)

The slice waited on `bug/the-queue-reads-the-merge-subject`. That branch merged (`9cc747652`), so `main` already holds the `readQueue` it changed. Nothing waits on this slice.

### What to build

Under HTTP 429 on Bitbucket, the supervisor held 36 slices `not-claimable`, among them slices whose earlier waves had merged days before. The tick line did not name the 429 (#1094). Today the first unsettled slice of a plan reads `merge-unknown`, and **every later slice of the same plan reads `not-claimable`**. A looping tick skips estate-scoped holds, so the slice an operator waits for appears only as a count.

Two changes, on top of the code that exists:

1. A new hold `prior-unknown`: an earlier slice of the same plan holds a branch whose landing the host could not answer this pass. It is `queue`-scoped, so a looping tick names its branches under `KEPT_HOLD_NAMES`.
2. A `merged-set=` field on the tick line: `whole`, `partial(<kind>)` or `unaskable(<kind>)`, where `<kind>` is `HostRefusal.kind` (`throttled`, `secondary`, `failed`).

Where the pieces live now (the plan's line numbers have drifted; re-find them):

- `packages/domain/src/rules/queue.ts`: `QueueHold`, `QUEUE_HOLDS`, `QueuedSlice`, `QueueReadings`, `whyNotReady`. Add `behindUnknownLanding(slices)` here.
- `packages/board/src/server/queue-reading.ts`: `readQueue` builds the slices from `queueOfPlan`, then takes `landed` per slice. `MergedListing` (`{ merged, whole }`) is the listing's type.
- `packages/board/src/server/entry/registryd-main.ts`: `mergedBranches` (about line 645) sets `whole` from `host.lastRefusal() === null` and returns an empty set when `prList` fails. `HOLD_SCOPE` is at about line 1279, `KEPT_HOLD_NAMES` after it.
- `packages/board/src/server/entry/registryd.ts`: `tickLine` prints the hold counts from `QUEUE_HOLDS`; `handOver: Decision<AssignDetail>` carries what the queue read.

### Settled decisions — do not re-derive them

- **Holding stays.** `queue-reading.test.ts` pins *"SILENCE MUST NOT PROMOTE WORK"*. Only the word and the tick line change. Do not make a later slice claimable on an `unknown` predecessor.
- **No host-free answer for an unsettled branch.** A refless branch the listing did not name is either unstarted or a squash merge whose ref was deleted, and git cannot tell them apart on a squash estate. The PR index never says no (CLAUDE.md, *A Decision Reads The Index*). #1139 settled the merge-commit case; the rest stays held.
- **No new host call.** The `unknown` answers are the ones the pass already took. The queue-reading test counts host calls and the count must not move.
- **The decision is a domain rule.** `behindUnknownLanding` is a pure function in `rules/queue.ts`: per plan, in plan order, every later slice that is not claimable while an earlier slice carries `landed: 'unknown'`. Write it as an arrow function with factual TSDoc, not a narrated history. `readQueue` sets `QueuedSlice.priorUnknown` from it and decides nothing itself.
- **`whyNotReady` order:** `landed` (`already-merged`), `unknown` (`merge-unknown`), ready (`null`), then `priorUnknown` (`prior-unknown`), then `not-claimable`, then `no-brief`. A claimable later slice is never `prior-unknown`: it keeps its own `landed` question.
- **The field is constant.** `tickLine` prints `merged-set=` on every tick that read a queue, `whole` included, and omits it where no queue was read (the rule the `handed=` fields already follow). A missing key then means a version difference. The `QUEUE_HOLDS` loop prints `prior-unknown=` for free once the hold is in the list; check the stale "All six keys" comment there and the one above `QUEUE_HOLDS`.
- **Listing state travels beside the slices.** Extend `MergedListing` with the refusal kind and `QueueReadings` with the state; `mergedBranches` reads `host.lastRefusal()` for the kind. `partial` is "answered and left a refusal"; `unaskable` is "`prList` failed".
- **`HOLD_SCOPE` is a `Record<QueueHold, …>`.** A missing key fails the build, which is the point: add `'prior-unknown': 'queue'` there.
- **Out of scope:** the board row still reads `eligible` for such a slice (the plan's Open Point), and the scan's `--next` is untouched.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation passes without them:

- Slice 1 `unknown` and slice 2 `prior-unknown` in a two-slice plan, **and** the same world with slice 1 `not-landed` leaving slice 2 `not-claimable`. A change that relabels every `not-claimable` as `prior-unknown` passes the first test alone.
- A second plan is not marked by the first plan's `unknown`. A per-estate flag passes every single-plan test.
- A later claimable slice is never marked.
- `merged-set=partial(throttled)` and `merged-set=unaskable(failed)` come from two different listing outcomes. One test per outcome; a hardcoded `whole` passes the other two.
- A looping tick names a `prior-unknown` branch (it is `queue`-scoped, so it is not skipped).

Plus: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and the domain 100 % branch-coverage gate for `behindUnknownLanding`. Run `nvm use` first (Node 24; pnpm crashes on 26). Do not run `test:e2e` locally. `registryd-main.test.ts` and the board unit suites are heavy: bound `--test-concurrency` and re-run a failing file alone before believing it.

A changeset naming `@plot-pm/board` (package frontmatter, no `bumps:` block) and `plot` (with a `bumps:` block, description first). Copy the format from a recent file in `.changeset/`. The `plot` bump covers the tick-line change a skill reader sees.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this slice's heading in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/queue.ts`, `packages/board/src/server/queue-reading.ts`, `packages/board/src/server/entry/registryd.ts`, `packages/board/src/server/entry/registryd-main.ts`, their tests, and one changeset. Checked against `origin/main` at dispatch: no remote branch carries changes to these four files. If a required change falls outside them, report it rather than improvising.
