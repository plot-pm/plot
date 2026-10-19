## Implementation brief — a-desk-waits-for-ci-on (wave 2: Reading)

- **Plan (canonical):** docs/plans/2026-10-19-a-desk-waits-for-ci-on.md on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2110 merged
- **Branch:** `bug/a-desk-merges-main-when-its-pr-conflicts` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

Wave 1 (`bug/a-no-answer-question-names-mergeability`, #2123) shipped first and is
already merged (`96f4b518f`) — the mergeability reading this slice needs already
exists. This slice does not wait on anything further; nothing in it is blocked.

### What to build

A desk whose PR cannot be built — the host starts no `pull_request` run for a
merge ref that conflicts — currently waits the full `Checks wait` (3600s) doing
nothing, then ends `checks-unanswered` and asks a person. Wave 1 made that
question name the mergeability; this slice stops the wait from starting at all
when the cause is already visible. Two desks burned an hour each this way on
2026-10-19 (PR #2104, `mergeable: CONFLICTING`; PR #2068) before wave 1 shipped.

Build the behavior change: when the checks wait is about to start and the PR's
mergeability reads `conflicting`, don't enter the wait — resume the agent with a
correction telling it to merge the default branch into the slice and push.
`mergeable` and `unknown` are unaffected; they enter the wait exactly as today.

### The decisions this plan settles — do not re-derive them

**The reading already exists; do not add a new one.** Wave 1 added
`AgentLoopReadings.mergeable: Mergeability | null` (`packages/domain/src/workflows/agent-loop.ts:226`)
and wired it end-to-end in `packages/fleet/src/server/entry/worker-loop.ts`:
`WaitClock.mergeable` (`:134`), read once from `pr.mergeable` at
`clock.mergeable = pr.mergeable` (`:952`) — the exact moment the wait is about to
start, right after `pushed`/`prOpen` are confirmed `true` and just before
`clock.since = Date.now()` begins the clock — then threaded into every return
of `readPass` alongside `pr: prNumber` (`:963`, `:987`). **This closes the plan's
first open question** ("does the loop read `mergeable` from a PR state it
already fetches… or does that read need a new field" — it needed one, and wave 1
added it). Your change reads `clock.mergeable` / the freshly-assigned
`pr.mergeable` at that same site in `worker-loop.ts` — it does not touch
`AgentLoopReadings`'s shape and does not add a second place that reads
mergeability.

**Where to intervene: before `clock.since = Date.now()`, not inside `ciWait`.**
`ciWait` (`packages/domain/src/workflows/agent-loop.ts:895`) only ever sees
`readings.checks`, which does not exist yet at the moment mergeability is first
known — `checks` is computed later, inside the wait, from `checksFromRuns`.
Entering the wait at all (starting `clock.since`, later computing `checks` from
`checksFromRuns`) is pointless when the host already said it will build nothing.
The correct branch point is in `worker-loop.ts`'s `readPass`, at the same `if
(!pushed || !prOpen)` guard's sibling — right after `pr.mergeable` is read
(`:952`) and before the clock starts. On `pr.mergeable === 'conflicting'`,
return an `agent-resume` write there (or a reading shape `agentLoop`'s caller
turns into one) instead of falling through to `clock.since = Date.now()`. Do
not add a `conflicting` case to `ciWait`'s switch — that switch is keyed on
`ChecksFromRuns`, which has no slot for "never entered the wait," and
`ciWait`'s own doc comment (`:877-879`) says the switch has a case for every
`ChecksFromRuns` value and no `default`, so a value that means something
different does not belong there.

**Follow the `agent-resume` precedent already in the file, not a new shape.**
Two existing call sites build exactly this write: `droppedTurn`
(`agent-loop.ts:841`) resumes with a correction built by a dedicated function,
`backgroundDropCorrection(line)`; `checksHandBack` (`:878`) resumes with a
correction the caller assembled into `readings.correctionText`. Add a sibling
builder — e.g. `conflictingMergeCorrection(branch)` in a new or existing rules
file — that returns the text telling the agent to merge the default branch into
`branch` and push, and wire its `agent-resume` write the same way
`droppedTurn`'s is wired: `resumeId: readings.resumeId` (the general resume id,
not `checksResumeId`, since this fires before the checks wait's own resume
tracking starts). Where exactly this decision point lives — purely inside
`worker-loop.ts`'s `readPass`/`WaitClock` handling (cheapest, no `agentLoop`
change), or as a new row `agentLoop` decides from a reading — is this slice's
call; the precedent above favors keeping `agentLoop`'s pure, state-free
decision table (its own doc comment: "NO STATE IS CARRIED BETWEEN PASSES") as
the place that DECIDES, and `readPass` as the place that READS and hands the
decision a clean `AgentLoopReadings` row it can switch on cleanly — e.g. a new
value on `AgentLoopReadings` such as `mergeConflictAtEntry: boolean`, checked by
`agentLoop` before it calls `ciWait` at all, rather than inlining the resume
logic into `readPass` itself and bypassing `agentLoop`'s table. Either shape
must leave `ciWait`'s switch and its five existing cases untouched.

**The correction's own content follows CLAUDE.md's board-artifact rule — don't
let the agent commit a rebuild.** The plan's Design section says the correction
"restores generated bundles from the merge base against `origin/main` and does
not commit a rebuild." CLAUDE.md § Testing, "On a conflict in `board-server.mjs`"
names the exact procedure and the exact command the gate's refusal prints — the
correction text this slice writes should tell the agent to run that procedure
(merge main, restore the generated paths from the merge base rather than taking
either side, never commit a rebuilt bundle) rather than leaving the agent to
improvise a merge resolution strategy. Quote or closely paraphrase that section
in the correction text; don't invent new wording for an already-settled
procedure.

**A second `conflicting` reading after a clean merge is a real conflict, not a
retry target — this is the plan's second open question, and it is still open.**
The plan flags: "How often does a desk see `conflicting` after it merged the
default branch once? … the loop needs a bound so it hands that case to a person
instead of looping." Decide this before writing code, don't guess a number.
The repo's existing pattern for exactly this shape is `correctionBudget`
(`AgentLoopReadings.correctionBudget` / `correctionAttempts`, CLAUDE.md's
`Correction budget` config key, default 2) — a failed build is handed back to
the agent at most that many times before a person is asked. A merge-conflict
correction handed back unboundedly repeats the #1274-shaped failure mode this
estate has already paid for once (a claim stuck because a loop kept retrying
instead of ending). Reuse `correctionBudget`/`correctionAttempts` for this
retry if the shapes line up, rather than inventing a second counter — check
whether a conflicting-merge resume should consume the same budget a failed
build does, or needs its own counter, and say which in the PR description if
the plan's open question still isn't fully closed by your implementation.

**`unknown` is not evidence of anything — leave it alone.** GitHub computes
mergeability lazily; `unknown` must enter the wait exactly as today. Only
`mergeable === 'conflicting'` short-circuits.

### Done when

The plan names no `## Done when` list directly; its Changelog states the
outcome: "a desk whose PR conflicts with the default branch merges the default
branch before it waits for CI, instead of waiting `Checks wait` for a build
that cannot start." For this slice specifically:

- A pass where the checks wait is about to start (`pushed && prOpen`) and
  `pr.mergeable === 'conflicting'` never sets `clock.since` / never reaches
  `checksFromRuns` — a test asserting the wait's clock does not start, not only
  that a correction text contains certain words.
- The agent is resumed (not ended, not blocked) with a correction naming the
  merge-main-and-push instruction, including the restore-from-merge-base
  wording for a board-artifact conflict.
- `mergeable === 'mergeable'` and `mergeable === 'unknown'` both leave the wait
  entirely unchanged from before this slice — a regression test for each,
  since a bug here would silently stop every desk's CI wait rather than just
  the conflicting ones.
- A second consecutive `conflicting` reading after the correction was already
  applied once ends the slice for a person (bounded retry), rather than
  resuming forever — matching the plan's second open question. Name the bound
  chosen (reused `correctionBudget`, or a new one) in the PR description.
- `ciWait`'s five existing cases (`null`, `'none'`, `'tip-moved'`, `'no-answer'`,
  `'wait'`, `'settled'`) and their tests are unchanged — this slice's new
  decision point sits strictly before `ciWait` is called.

Plus: `scripts/check-shell-lines.sh` only matters if this slice touches a `.sh`
file under `skills/` — it should not, since `plot-worker-loop.mjs` is the built
bundle of `worker-loop.ts` and is regenerated, not hand-edited. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run
what it prints — it names the tests for the files you changed, the related
`vitest`/`tsc` for `packages/domain` and `packages/fleet`, and the gate tests.
The suites in the `CI suites` config key run in CI on every PR; don't run them
locally as a matter of course (CLAUDE.md § Testing, `test:e2e`).

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh
```

Never `gh pr create` directly. When the PR exists, append `→ #<number>` to this
branch's line under the plan's `## Slices` → `### Reading` heading.

### Scope guard

This branch owns:
- `packages/fleet/src/server/entry/worker-loop.ts` (`readPass`, `WaitClock`,
  the new pre-wait branch point)
- `packages/domain/src/workflows/agent-loop.ts` (only if the branch point moves
  into `agentLoop`'s own decision table rather than staying in `readPass` —
  see "where to intervene" above) — if touched, add no case to `ciWait`'s
  switch
- A new rules file (or an addition to an existing small one, following
  `background-drop.ts`'s shape) for the merge-main correction text builder
- New/updated tests wherever `readPass`/`worker-loop.ts`'s checks-wait entry is
  tested, and in `packages/domain/test/workflows-agent-loop.test.ts` if the
  decision point moves into `agentLoop`

Wave 1 (`bug/a-no-answer-question-names-mergeability`, merged) already owns and
has finished: `needsPersonMarker`'s `checks-unanswered` arm, and the
`mergeable` field on `AgentLoopReadings`/`WaitClock`/`readPass`. Don't re-touch
those; read them.

If you find something the plan did not anticipate, report it rather than
improvising outside scope — in particular, say explicitly in the PR description
which of the two open questions above (the correction-text wording, and the
retry bound after a repeat conflict) you resolved and how, since the plan
leaves both open as of this brief.
