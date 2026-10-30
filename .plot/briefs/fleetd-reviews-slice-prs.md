## Implementation brief — fleetd-reviews-every-slice-pr-in (wave 5: Review start)

- **Plan (canonical):** [docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md](../../docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2917 merged
- **Branch:** `feature/fleetd-reviews-slice-prs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the PR (same gate every other slice here merges under)

This is the last of five waves. All four prior branches
(`feature/a-review-opens-no-issue` #2928, `feature/the-index-records-the-review`
#2939, `feature/the-scope-is-read-from-git` #2948,
`feature/the-review-run-is-locked` #2955) are merged into `main` — verified via
`plot-pr-merged.sh` immediately before writing this brief. Nothing waits on
this wave inside the plan itself, but three sibling plans are blocked on it:
#2902 (`feature/fleetd-merges-one-at-a-time`), #2903
(`feature/fleetd-starts-the-fixer`) and #2907
(`feature/fleetd-prepares-the-release`). #2901, #2903 and #2906 read `deskDead`
from this slice specifically.

### What to build

Only a master agent runs `plot-review` today, by hand, from a watcher script
that dies with the session — from 2026-10-16 to 2026-10-29 that watcher was
the only thing keeping reviews flowing, and no PR gets reviewed once it ends.
This slice gives fleetd the decision and the means to act on it:

1. **`packages/domain/src/rules/slice-pr-next.ts`** (new file) — exports
   `slicePrNext(readings: SlicePrReadings): SlicePrStep`, a pure function that
   reads one open PR's row plus sibling readings and answers exactly one of:
   `none`, `review`, `write-status`, `merge`, `hold`, `fixer`, `ticket`. See
   the plan's *Next-step rule* section for the full input record and step
   union — do not re-derive either, they are specified field-by-field there.
2. **`packages/domain/src/rules/desk-dead.ts`** (new file) — exports
   `deskDead(readings)`, answering `{ dead: true }` or
   `{ dead: false, why: 'live' | 'waiting' | 'elsewhere' | 'unread' }`.
3. **`startReview`** — a new adapter export, `startReview(pr, head, opts)` in
   `adapters/review-start/review-start-node.ts`, over the existing `Detached`
   port.
4. **State files**: `.plot/state/review-in-flight.json` (one live entry per
   PR+head, read by `reviewRunLive`) and `.plot/state/review-starts.json`
   (per-head `{ pr, head, count, lastAt }`, surviving a fleetd restart).
5. **`Auto-review`** config key (default `false`), gating the whole arm.
6. The CLAUDE.md *Index paragraph* (quoted verbatim in the plan, directly
   above *Decisions*) — add it to *A Decision Reads The Index* on this
   branch.

### Decisions the plan settles — do not re-derive them

**`deskDead` parallels `agentState`, it does not wrap it.** `agentState`
(`rules/agent-state.ts:62-136`) is the existing eight-state cascade reading
`worktreeHere`, `pidRecorded`, `liveness`, `exit` and `task` readings, with
`elsewhere`/`waiting`-shaped states already in its vocabulary. `deskDead`
answers a narrower question — alive-enough-to-trust vs not — over the *same*
kind of readings, not by calling `agentState` and mapping its output: the
plan calls this "the same values... and answers" deliberately, so build it as
a sibling pure function, not a shim. A `PLOT-BLOCKED` marker reads `waiting`
(not dead); a worktree on another machine reads `elsewhere` (not dead); a
failed read reads `unread` (holds, not dead) — these three only make sense
read directly off the readings, the way `agentState` already does.

**`startReview` reuses `detachedNode()` — it adds no new spawn site.** The
`Detached` port (`ports/detached.ts`) and its one adapter
(`adapters/detached/detached-node.ts`, `detachedNode()`) already wrap
`child_process.spawn` with `detached: true` + `unref()`, writing output to a
log file. `startReview` calls `detached.node(reviewScript, args, cwd,
logFile)` exactly like any other detached-process caller — it is not a new
`spawn`/`execFile` call and does not move the CI spawn-ratchet count
(`ci.yml` *One place reaches a process*, currently 11 against its own
`allowed`). If an implementation ends up calling `spawn` directly here
instead of going through `Detached`, that is the bug to catch, not a
tradeoff.

**The four index fields this slice reads already exist — don't add them
again.** `the-index-records-the-review` (merged, PR #2939) already added
`plotReview`, `plotReviewSha`, `plotReviewAt`, `ciChecks` to `PrIndexRow` at
`PR_INDEX_VERSION = 6` (`entities/pr-index.ts`). This slice is a *reader* of
those fields through the review arm's precondition list in the plan's
*Next-step rule* §7 ("The review arm"), not a second writer. The index never
answers `plotReview: 'none'` — a missing field means "not asked", answered
`absent` only means "asked, nothing found" — carry that distinction through
every arm that branches on it.

**`sprintScope` already exists — call it, don't reimplement scope
resolution.** `the-scope-is-read-from-git` (merged, PR #2948) built
`sprintScope(input)` in `rules/sprint-scope.ts`, answering
`{ read: 'scope', sprint, slugs, branches }` or `{ read: 'none', why }`. The
guard arm (step 1 of the composition order) reads this answer directly; no
new scope logic belongs in `slice-pr-next.ts`.

**The review-run lock and verdict file already exist — this slice is the
first caller of the verdict, not the writer.** `the-review-run-is-locked`
(merged, PR #2955) made `reviewPr` take the per-PR-per-SHA lock, write
`plot/review=pending` with a run id, and write the verdict file at
`reviews/<pr>-<sha>.md`. `reviewVerdict()` (`rules/review-verdict.ts`) parses
that file. Step 3 of the composition order ("Re-status") reads a verdict via
this function and answers `write-status` when the index doesn't yet reflect
it — it never writes the verdict file itself.

**`auto-verify.ts` is the direct template for the start-budget decision, not
just a vague precedent.** `packages/fleet/src/shared/auto-verify.ts` defines
`AUTO_VERIFY_KEY`, an `AutoVerifyConfig` interface and a pure
`autoVerify(config)` predicate fed by `readConfig(opts, key, fallback)`
(`shared/config-reader.ts`); the domain's `verifyStart`
(`rules/auto-verify.ts:162`) is a pure refusal cascade over an input record,
exactly the shape `review-starts.json`'s budget check needs. Mirror this
file-for-file: an `AUTO_REVIEW_KEY = 'Auto-review'` constant, a config
interface, and a pure predicate — do not invent a second config-reading
mechanism.

**Composition order is fixed, and the ordering principle is load-bearing.**
The plan gives eight numbered arms (Guard → Review run → Re-status → Fixer
in flight → HIGH → CI red → Review → Merge) and states the reason directly:
*"an arm that writes or holds on the current head comes before an arm that
starts new work on it."* This slice builds the guard, review-run, re-status
and review arms (1, 2, 3, 7); arms 4-6 and 8 are optional fields in the input
record until their owning plans (#2902, #2903) land — but `slicePrNext`
itself must already compose in the full eight-step order today, reading
`none` wherever a not-yet-built field would be checked. Building only four
arms and leaving the other four as a later patch to the composition function
is the wrong shape; the union and the order are the deliverable, not just
the four arms this slice owns.

**The per-head start budget is three strikes with specific backoffs, not a
simple counter.** First start free, second waits 15 min after the first,
third waits 60 min after the second; past three, `budget-spent` and the head
is left as the last run left it. #2899's idle-slice rule is the only
human-facing signal for a head stuck there — this slice writes no run-log
line of its own.

### Done when

The plan's `## Done when` is implicit in its *Slices* entry for this wave —
treat the bullet list there (`slicePrNext`, `deskDead`, `startReview`, the
in-flight and start-count files) plus its test list as the spec:

- Domain table test of the arms with readings-as-values fixtures: `null`
  store → `none`; row present but no `plotReview` field → `none`; green CI on
  head + `plotReview: 'absent'` → `review`; `plotReview` naming an older SHA
  → `review`; a live `reviewRun` → hold; a stale `pending` past
  `reviewBoundMs` → `review`; budget spent → `none`; red default branch →
  review still proceeds (only merge holds on a red main, never review); a
  verdict file with no matching index status → `write-status`.
- A precedence test: a live fixer mark on an otherwise-green new head must
  hold, not review — this is the test that actually exercises "an arm that
  writes on the current head comes before one that starts new work."
- `deskDead` unit: a `PLOT-BLOCKED` marker → `waiting`; a worktree on another
  machine → `elsewhere`; a failed read → `unread`.
- Fleet unit: two ticks over one in-flight entry start exactly one review
  (not two); a simulated fleetd restart preserves the start count already in
  `review-starts.json`.
- The CI spawn ratchet (*One place reaches a process*) must not grow outside
  `adapters/` — confirms `startReview` went through `Detached` rather than a
  direct `spawn`.

Plus the repo's standing gates: build artifacts, changeset, platform
constraints. For tests, run `node ../plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints; the suites named under `CI suites`
in `## Plot Config` run in CI, and a failure there comes back as a
correction. Don't run a full suite locally on your own initiative.

`scripts/check-shell-lines.sh` ratchets the shipped shell under `skills/`
against this branch's merge base. This slice is almost entirely
`packages/domain` and `packages/fleet` TypeScript — if it ends up touching a
`.sh` file (e.g. wiring `plot-review.mjs` invocation), any growth there must
be paid for by removing an equal number of shell lines elsewhere in the same
change; the gate stores no number and grants no exemption.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Push the first real commit as soon as it exists — an empty claimed branch
with no commits for hours is what `/plot-pulse` flags as stalled. When the
PR is created, append `→ #<number>` to this branch's line in the plan's
`## Slices` section (`feature/fleetd-reviews-slice-prs` under "Review
start").

### Scope guard

This branch owns `packages/domain/src/rules/slice-pr-next.ts`,
`packages/domain/src/rules/desk-dead.ts`,
`packages/domain/src/adapters/review-start/review-start-node.ts`, the
`Auto-review` config wiring in `packages/fleet/src/shared/` (new file,
sibling to `auto-verify.ts`), and the CLAUDE.md *Index paragraph* addition.

Other branches in this plan are already merged into `main` and do not
conflict — this is the only branch still open. Outside this plan, #2902,
#2903, #2904 and #2907 are declared as waiting on this branch rather than
running concurrently with it, so there is no live sibling to collide with at
write time. If you find a PR open against one of those slugs already, treat
that as the plan's siblings jumping ahead of their stated wait and report it
rather than coordinating around it silently.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
