## Implementation brief — a-desk-waits-for-ci-on (wave 1: Question)

- **Plan (canonical):** docs/plans/2026-10-19-a-desk-waits-for-ci-on.md on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2110 merged
- **Branch:** `bug/a-no-answer-question-names-mergeability` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch ships first on purpose: the plan's own ordering note says the question
names the cause first, so a desk that still asks a person after wave 2
(`bug/a-desk-merges-main-when-its-pr-conflicts`) tells the reader why. Nothing in
wave 2 depends on this branch merging first, but a reviewer reading only this PR
should know a second branch exists for the loop-side fix.

### What to build

Today, a desk whose PR cannot be built (GitHub never starts a `pull_request`
workflow for a merge ref that conflicts) waits the full `Checks wait` (3600s) and
then writes a `PLOT-BLOCKED` question that gives no reason beyond "nothing from
the build connector." The mergeability that explains it was sitting in the host's
PR state the whole time. Two desks hit this on 2026-10-19 — PR #2104 (`mergeable:
CONFLICTING`) and PR #2068 — each burning an hour before asking a person a
question answerable in the first minute.

This slice is the smaller, read-only half: make the `no-answer` marker text name
the PR's mergeability. The loop behavior change — merging the default branch
before the wait starts on `conflicting` — is wave 2, a separate branch, not this
one's job.

### The decisions this plan settles — do not re-derive them

**Where the composer lives, and its one caller.** `needsPersonMarker`
(`packages/domain/src/rules/ending-action.ts:508`) is the function that turns an
`EndingReason` + `detail` into `PLOT-BLOCKED.md` text. For `checks-unanswered` it
branches on `detail` twice already (`:525-530`): `tip-moved` gets one sentence,
everything else (today, just the literal string `'no-answer'`) gets the "wait
longer / check the build connector / resume without a CI answer" sentence at
`:529-530`. That second branch is the one this slice touches. Its **only**
caller is `markerTextFor` in `packages/fleet/src/server/entry/registryd.ts:962-969`,
which calls `needsPersonMarker(reading.ending, reading.branch, reading.detail)`
inside a `try`/`catch` that returns `''` on throw — so a composer that throws for
an unexpected `detail` shape degrades to no marker text rather than crashing the
tick. Don't go looking for a second call site; there isn't one.

**`detail` is a string the loop composed, not a struct — this closes the plan's
first open question.** `ciWait`'s `no-answer` case
(`packages/domain/src/workflows/agent-loop.ts:889-893`) calls
`end(worktree, branch, 'checks-unanswered', 'agent', 'no-answer', 0, [...])` —
the fifth argument, `'no-answer'`, is the literal `detail` string, unconditional,
with no reading folded in. The `tip-moved` case two lines up
(`:881-887`) already shows the pattern for carrying extra context through
`detail`: it interpolates the branch name straight into the string
(`` `tip-moved: the remote tip of \`${branch}\` is no longer the pushed commit` ``).
Follow that precedent rather than inventing a struct: extend the `no-answer`
`detail` string to carry the mergeability inline, e.g.
`` `no-answer: mergeable=${mergeability}` ``, and change `needsPersonMarker`'s
`:529` branch to parse it back out with `.includes` / a split, the same way
`:526` already tests `detail.includes('tip-moved')`. This is also what the
plan's third open question asks and answers: `detail` carries it, not a new
parameter — the call signature `needsPersonMarker(ending, branch, detail)` does
not change, and neither does `markerTextFor`'s call.

**Where the mergeability reading comes from.** `Mergeability` (`mergeable |
conflicting | unknown`) already exists on `Pr` (`packages/domain/src/entities/pr.ts:21-22,68`),
and the host adapter already emits it (`host-shell.ts:92` per the plan — not
re-verified here, trust the plan's citation). `checksAreEmptyBecauseConflicting`
(`pr.ts:140-141`) is the existing helper that reads `pr.checks === 'none' &&
pr.mergeable === 'conflicting'` — written for the board's "no checks — conflicts"
label (`checks-reading.ts:102,207`, per the plan). **This slice does not need a
new host call or a new reading plumbed into `AgentLoopReadings`** — wave 2 is
where the loop reads mergeability *before* the wait and decides whether to enter
it at all. This slice's job is narrower: once `ciWait` is already in the
`no-answer` case (meaning the wait ran out with `checks === 'none'` for the whole
`Checks wait` duration), the PR's mergeability is still readable from the same
`Pr` the checks reading came from — `readings.checks` on `AgentLoopReadings` is a
`ChecksFromRuns | null` (`:207`), not the `Pr` itself, so find where `ciWait`'s
caller derives `checks: 'none'` and check whether a `Pr`-shaped reading (or at
least a `Mergeability`) already flows alongside it into `AgentLoopReadings`. If
it does not, this slice may need to add one field to `AgentLoopReadings` purely
to read it at the `no-answer` composition point — the plan's own Design section
flags this as unresolved ("does the loop read `mergeable` from a PR state it
already fetches for the checks reading, or does that read need a new field"),
and it is still unresolved as of this brief. Confirm which, by reading
`checks-verdict.ts` and whatever populates `readings.checks` in
`packages/fleet/src/server/entry/registryd.ts` (the file that builds
`AgentLoopReadings` and calls `agentLoop`), before writing code — do not guess.

**`unknown` is not evidence either way.** GitHub computes mergeability lazily, so
a `no-answer` detail carrying `mergeable=unknown` should read the same as one
with no mergeability info at all (today's wording), not imply a conflict that
may not exist. Keep that distinction in the marker text: only `conflicting`
changes the sentence; `unknown` falls through to the existing wording.

### Done when

The plan's `## Done when` list does not exist as a named section — the plan's
Changelog states the two outcomes directly: the `no-answer` question names the
PR's mergeability. For this slice specifically:

- A `checks-unanswered` ending with `detail` carrying a `conflicting` mergeability
  produces `PLOT-BLOCKED` text that says so in the sentence — not a generic
  "check the build connector" that omits a fact the host already gave.
- A `checks-unanswered` ending with `detail` carrying `mergeable` or `unknown`
  still produces the existing wording verbatim — a test that locks today's
  string for the non-conflicting path, so this slice cannot regress the common
  case while fixing the rare one.
- `markerTextFor`'s `try`/`catch` degrade-to-`''` behavior is unchanged — a
  malformed or unexpected `detail` string must not throw past the catch (it
  already won't, since `needsPersonMarker` only reads `detail` with
  `.includes`/string parsing, never JSON-parses it — keep it that way).
- The `tip-moved` branch of `needsPersonMarker` (`:526-528`) is untouched; this
  slice's diff is contained to the `no-answer` arm and whatever upstream reading
  feeds its `detail`.

Plus: `scripts/check-shell-lines.sh` only matters if this slice touches a `.sh`
file under `skills/` — it should not, since the whole change lives in
`packages/domain` and `packages/fleet`. Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run
what it prints — it names the tests for the files you changed, the related
`vitest`/`tsc` for `packages/domain`, and the gate tests. The suites in the
`CI suites` config key run in CI on every PR; don't run them locally as a matter
of course (see CLAUDE.md § Testing on `test:e2e`).

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh
```

Never `gh pr create` directly. When the PR exists, append `→ #<number>` to this
branch's line under the plan's `## Slices` → `### Question` heading.

### Scope guard

This branch owns:
- `packages/domain/src/rules/ending-action.ts` (the `needsPersonMarker`
  `checks-unanswered` arm)
- `packages/domain/src/workflows/agent-loop.ts` (the `ciWait` `no-answer` case's
  `detail` string, and `AgentLoopReadings` only if the mergeability reading
  genuinely isn't already available there)
- Whatever in `packages/fleet/src/server/entry/registryd.ts` builds the
  `AgentLoopReadings` passed into `agentLoop`, if a new field is needed
- New/updated tests in `packages/domain/test/rules-ending-action.test.ts` and
  wherever `agent-loop.ts`'s `ciWait` is tested

The sibling branch `bug/a-desk-merges-main-when-its-pr-conflicts` (wave 2, not
yet dispatched as of this brief) owns the loop's pre-wait mergeability check and
the merge-the-default-branch correction. If both branches end up touching
`AgentLoopReadings` or `ciWait`, that is a known, plan-anticipated overlap — not
a surprise — resolve it as a merge order question at dispatch time, not by one
branch absorbing the other's scope.

If you find something the plan did not anticipate, report it rather than
improvising outside scope — in particular, if `readings.checks` turns out to
already carry a `Pr`-shaped value with `mergeable` on it (making the "new field"
question above moot), say so in the PR description so the plan's open question
can be closed rather than left stale.
