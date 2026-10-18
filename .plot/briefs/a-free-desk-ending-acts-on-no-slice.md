## Implementation brief — a-fresh-agent-after-a-wait (wave 2: Supervisor endings)

- **Plan (canonical):** docs/plans/2026-10-17-a-fresh-agent-after-a-wait.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1954 merged
- **Branch:** `bug/a-free-desk-ending-acts-on-no-slice` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan `## Status` → Review: pr)

Wave 1, `bug/the-registry-reads-branch-line-waits`, is merged (PR #1987). This
wave is the next eligible one; wave 3, `bug/fleetd-at-agents-zero-after-a-wait`,
waits on this wave landing (document order per the plan's Design › Approach:
"the start follows the guard because each new free agent becomes a later
exit-124 desk that #1917 can turn into a `start-fresh` session").

### What to build

A supervisor tick can currently answer `start-fresh` or `release-claim` for a
desk whose worker ended `unreadable` — even when that desk never held a
slice at all, because its free wait simply ran past `Worker bound`. That is
issue #1917. The fix is in `endingAction` (`packages/domain/src/rules/ending-action.ts:287-315`,
specifically the `isBoundEnding` branch at lines 302-306), which decides
purely from `readings.ending === 'unreadable'` and whether the branch holds
work beyond its claim — it has no way to tell "this desk was never assigned
a slice" from "this desk was mid-slice and got killed". The plan's fix reads
that distinction from the desk's own records via `freeWaitEnded(ending, exit)`
(`packages/domain/src/rules/ended-desk.ts:64-68`, already shipped and already
used by `endedDeskPlacement` for the board's *Waiting on you* placement) and
the sealed slice's `ok` declaration (`packages/domain/src/workflows/agent-loop.ts:374-383`).
When either says the desk ended a free wait, `endingAction` must answer
`leave` for that ending — never `start-fresh`, never `release-claim`.

### The decisions the plan settles — do not re-derive them

**Why the desk's own records, not a manifest or another live loop.** A claim
is a ref with empty commits and names no agent (`rules/claim.ts:15`); a
holder is a live manifest, and the manifest is gone by the time this rule
runs (`ending-action.ts:8-10` — see `hasManifest`'s own doc: "a desk the tick
is about to start is not a desk with no manifest"). So nothing live is left
to ask. The panel's three other candidates — `otherHolders`, ROW 2 writing
its own ending, or the claim ref's tip / last manifest — were considered and
rejected for the same reason: by the time the tick reads this, the manifest
that would answer the question is already gone. `dirtyTreeReading`
(`ending-action.ts:791`, precedent cited directly in the plan) is the model:
an unanswerable read must answer the non-destructive side, never
`release-claim` or `start-fresh`.

**An unanswerable reading answers `leave`, full stop.** This mirrors every
other "absent is not false" rule already in `endingAction`'s doc comment
(commitBeyondClaim/prOpen/dirtyTree/prMerged all take the non-destructive arm
on `'unanswerable'`). If `freeWaitEnded` cannot be read, or the `ok`
declaration cannot be read, that is `leave`, not a fallthrough into the
existing `isBoundEnding` logic.

**If the measurement says `freeWaitEnded` can't separate a free-wait end from
a mid-slice 124** — the plan names this as an open question (plan's Open
Questions, first bullet) — **the named fallback is NOT to add a new reading
the controller fetches.** It is to have `agentLoop` ROW 2
(`packages/domain/src/workflows/agent-loop.ts:473-484`) write its own ending
for a free end with a branch checked out, so `killedWorkerEnding` returns
`null` for it instead of synthesizing `unreadable`. Measure first (write the
unmerged test cases, see if they pass against current code); only move to
this fallback if the first approach is proven to not distinguish the cases.

**The controller passes the reading as a value — no host or remote call.**
`registryd.ts` (`killedWorkerEndings`, around line 764, and the call site
around line 973) must pass whatever `freeWaitEnded`/`ok`-declaration reading
it already has sitting in its tick state. Do not add a fetch.

**ROW 2's comment is wrong and must be corrected.** `agent-loop.ts:473-475`'s
comment — *"No slice was ever held, so there is nothing to attribute an
ending to"* — is false for a desk that still has its last slice checked out
when the free wait ends (the desk's tree still names the branch it was last
on, even though no *new* slice was assigned). State what the desk actually
holds instead.

**`endedDeskPlacement` needs a placement that names this desk**, not an
empty-note row under *Waiting on you*. Check `packages/board/src/server/ended-desks.ts:40`
and `packages/domain/src/rules/ended-desk.ts:81-94` for how placement already
reads `freeWaitEnded` for the clean case — a desk that falls into this slice's
new `leave`-for-unreadable-free-wait path needs an equivalent placement, not
silence.

### Done when

The plan's own Done when (Slices › Supervisor endings) is the specification:

- `packages/domain/test/clean-wait-end.test.ts` gains the unmerged cases
  beside the already-present merged one: open PR, commit beyond the claim,
  nothing beyond the claim. Each must FAIL on current `origin/main` reading
  `start-fresh` or `release-claim` before the fix, and pass answering `leave`
  after it. (The existing file at lines 1-95 has `mergedDesk`/`endingReadings`
  builders already shaped for this — extend them, don't rebuild them.)
- An unanswerable reading (can't tell if the desk's wait was free) answers
  `leave`.
- The controller (`registryd.ts`) passes the reading with no host call —
  verify by grep, not just by reading the diff: no new `spawn`/`execFile`/host
  call appears on this path.
- `endedDeskPlacement` gives this desk's case a placement that names it,
  not an empty-note *Waiting on you* row.
- ROW 2's comment in `agent-loop.ts` states what the desk holds, not that it
  held nothing.

Plus: the repo's gates — any changeset this slice needs, `scripts/check-shell-lines.sh`
if any `.sh` file changes (it doesn't look like this slice should touch shell
at all — if it does, growth must be paid for in the same change). For tests,
run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints. The suites in `CI suites` (plot's `## Plot Config`)
run in CI on every PR; do not run the full e2e suite locally.

### Bookkeeping

Open the PR through the controller once there's a real commit:
`../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). When it
exists, append `→ #<number>` to this branch's line under the plan's
`## Slices` → `### Supervisor endings` heading. Push the first real commit as
soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/ending-action.ts`,
`packages/domain/src/workflows/agent-loop.ts` (ROW 2 comment only),
`packages/domain/test/clean-wait-end.test.ts`, and whatever in
`packages/fleet/src/server/entry/registryd.ts` / `packages/board/src/server/ended-desks.ts`
/ `packages/domain/src/rules/ended-desk.ts` the placement fix touches.

Sibling branches in this plan: `bug/the-registry-reads-branch-line-waits`
(merged, PR #1987 — `packages/fleet/test/unit/queue-reading.test.ts` and the
registry's `waits:` parsing, already landed, no overlap) and
`bug/fleetd-at-agents-zero-after-a-wait` (not yet started, touches `scaleUp`
in `packages/domain/src/workflows/assign.ts` and
`packages/fleet/test/unit/registryd-tick.test.ts` / `packages/domain/test/queue.test.ts`
— waits on this branch landing first, no file overlap expected).

Five fleet desks are live in sibling worktrees on other branches of other
plans (`bug/jenkins-runs-history`, `bug/released-desk-keeps-its-note`,
`bug/the-reaper-reads-the-desk-loop-and-the-root-marker`,
`bug/the-implement-lock-covers-its-start`) — none touch this plan's files, so
no reserved overlap there either.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
