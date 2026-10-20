## Implementation brief — validate-runs-at-86-of-its (wave Report: a-timeout-reads-as-a-timeout)

- **Plan (canonical):** `docs/plans/2026-10-19-validate-runs-at-86-of-its.md` on main
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2124 merged
- **Branch:** `infra/a-timeout-reads-as-a-timeout` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

`infra/validate-step-budget` (#2141) is already merged. It split `validate`'s
two slowest steps into their own jobs (`board-integration`,
`helper-contracts`), wired back via `needs:` edges since the branch ruleset
(24412719) names only `validate` and `plot/review` as required contexts, and
brought `validate`'s own p95 to 25.0 % of its 1500 s cap. It also measured 30
runs and **closed all three of the plan's Open Questions** — read them in
`docs/plans/2026-10-19-validate-runs-at-86-of-its.md` before starting, because
they answer this slice's central design question and change what "What to
build" below would otherwise leave open.

### What to build

GitHub reports a job that reaches its `timeout-minutes` cap with the same
conclusion word as a job someone cancelled on purpose: `cancelled`. Plot reads
that word in two places and both currently treat it as *no answer, keep
waiting* rather than as a settled failure:

- `skills/plot/scripts/plot-host.sh:4651` — the `run-for-sha` op fetches
  per-job detail (`gh run view --json jobs`) only when the top-level
  conclusion is `failure` or `cancelled`, to tell a real failure from a run
  `runWasNotAcquired` (no runner ever picked it up, #1295).
- `packages/domain/src/rules/checks-verdict.ts:137` — `SETTLED_CONCLUSIONS`
  lists only `['success', 'failure', 'action_required']`. A `cancelled` run
  never reaches `settled` in `checksFromRuns` (line 209); it stays `wait` until
  `Checks wait` elapses, then reports `no-answer` (line 224). `buildFindingFor`
  (line 266) documents this gap explicitly at lines 252–259: *"the loop's own
  call site never reaches a `timed_out` or `cancelled` run through
  `buildFindingFor` — `checksFromRuns` keeps it at `wait`/`no-answer` instead.
  A documented gap, not ported here."*

The slice closes that gap: a `validate` run that hit its 25-minute cap must
read as a **timeout finding**, not silently fall through to `no-answer` after
burning the full `Checks wait` bound (3600s) for an answer that already
existed. The desk and `plot-ask.mjs merge` then act on that word instead of
treating the run as unanswerable.

### The decisions the plan settles — do not re-derive them

**`cancelled` is not one thing, and the existing split must survive.**
`runWasNotAcquired` (checks-verdict.ts:158) already separates a real failure
from a host outage by reading `jobs[].conclusion` and `jobs[].steps` — a run
where every failed/cancelled job ran 0 steps is "never acquired," not a code
failure. A job that reached its own `timeout-minutes` is the **third** case:
conclusion `cancelled`, but `steps > 0` (it ran until the clock, not before the
clock). The new logic must not collapse this into either existing bucket —
specifically it must not make `runWasNotAcquired` return `true` for a run that
actually ran its steps and then was cut off.

**Absent `jobs` never reads as "no steps" (#1295) — this still applies.** A
run whose conclusion was not `failure`/`cancelled` carries no `jobs` field at
all, never an empty array. Any new code reading job data for a timeout
determination inherits this invariant; do not default a missing `jobs` to "0
steps, so not-acquired."

**The plan's Open Questions are answered — read the per-step fingerprint off
`steps[].conclusion`, no workflow change needed.** Wave 1 measured all 4
`cancelled` runs in a 30-run sample and found one consistent shape: every step
up to the one running when the cap fired reads `success` or `skipped`
(pre-dispatch-guard steps), the step that was running when time ran out reads
`cancelled` itself, and every step after it reads `skipped`. That fingerprint
— **at least one `success` step followed by exactly one `cancelled` step,
itself followed only by `skipped` steps** — is what this slice reads to call a
run a timeout. `gh run view --json jobs` (already fetched at
`plot-host.sh:4651` for every `failure`/`cancelled` top-level conclusion)
already returns `steps[].conclusion`; no new API call and no `ci.yml` change
is required.

**A concurrency-superseded run is the one case the sample could not supply —
verify it, do not just trust the inference.** None of the 30 sampled runs was
a push-superseded cancellation, so wave 1 could only reason about the
difference: GitHub cancels a superseded run before any step starts, so every
step should read `skipped` with none `success` and none `cancelled`. Confirm
this against a real superseded run (force one by pushing twice in quick
succession to the same branch) before relying on "zero non-skipped steps ⇒
supersession, not timeout" as the third branch of the classification. If the
two cases are genuinely indistinguishable in the data, that is new
information the plan did not have and should be reported rather than guessed
past.

**`gh run view --json jobs` is already the one extra call paid for
`cancelled`/`failure` (plot-host.sh:4647-4651) — reuse it, don't add a
second.** The comment there is explicit that this call exists "only for a
concluded failure," and the job the second wave adds (bounding the slow step)
will not change that call's shape. Read `startedAt`/elapsed timing from the
same `gh run view` response rather than issuing another API call per run.

### Done when

The plan's `## Done when` is implicit in its Design section (no separate
checklist in the plan) — treat these as its specification:

- A `validate` run that reaches `timeout-minutes: 25` produces a distinct
  finding/word from both a genuine test failure and a manually-cancelled run,
  readable by `checks-verdict.ts` and `plot-host.sh` alike.
- `checksFromRuns` reaches `settled` for a timed-out run rather than idling to
  `no-answer` at the `Checks wait` bound — the whole point is to stop paying
  3600 seconds of wait for an answer GitHub already gave at second ~1500.
  Write the assertion that would catch the plan's own motivating bug: a run
  with top-level conclusion `cancelled`, whose `jobs[].steps[].conclusion`
  fingerprint is "one or more `success`, then exactly one `cancelled`, then
  the rest `skipped`" (the shape wave 1 measured across all 4 sampled
  timeouts), is read as a timeout — not as `not-acquired` and not as
  `no-answer`.
  - This is the test a naive "treat all `cancelled` as settled" patch would
    pass without catching: that patch would also mark a genuinely
    never-acquired host-outage run as `settled`/failed, which is the bug
    `runWasNotAcquired` exists to prevent. The new test must include a
    not-acquired fixture (0-step failed/cancelled jobs, `runWasNotAcquired`
    still `true`) and a supersession fixture (every step `skipped`, none
    `success` or `cancelled`) and assert both still read as unsettled/
    no-answer or not-acquired, never as a timeout.
- The desk and `plot-ask.mjs merge` surface the timeout distinctly (e.g. in
  correction text or a merge refusal reason) rather than reporting a plain
  "build failed" or sitting on `no-answer`.

Plus the repo's gates: no bundle diff if `board-server.mjs` is untouched,
`scripts/check-ancestry-decisions.sh` if any new code reads commit/run
ancestry (it should not — this is conclusion-word reading, not ancestry), and
a changeset if the behavior change is user-visible (it is — `bumps: plot:
patch` at minimum, since this is a bug-fix-shaped change to existing CI
reading, not a new section).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` (resolved from this
skill's directory) before each push and run what it prints. The suites in
`CI suites` (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain
vitest coverage run, `test/reconcile/*.test.mjs`) run in CI on every PR — do
not run them locally as a matter of course (`test:e2e` especially: it is CI's
gate, not a local one, and dispatches real workers into sandbox repos). A
failure there comes back as a correction.

Name the shell gate explicitly if this slice touches `plot-host.sh`:
`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows
past its merge base. The plan's substance here is small (reading one existing
API response differently), so prefer keeping the shell-side change minimal and
putting any new decision logic in `checks-verdict.ts` (the domain), which has
no such ratchet and is where `runWasNotAcquired`-style logic already lives.

### Bookkeeping

Open the PR through the controller, never `gh pr create` directly:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan naming this branch and titles the PR from the "Report" wave
heading. When the PR exists, append `→ #<number>` to this branch's line in
`docs/plans/2026-10-19-validate-runs-at-86-of-its.md`'s `## Slices` section.
Push the first real commit as soon as it exists — do not hold commits locally
across the whole slice.

### Scope guard

This branch owns: `packages/domain/src/rules/checks-verdict.ts` and
`packages/domain/src/rules/checks-verdict.test.ts` (or sibling test file),
`skills/plot/scripts/plot-host.sh` (the `run-for-sha` op only, around line
4651), and any desk/`plot-ask.mjs merge` surface that reports the build
finding word.

`infra/validate-step-budget` (#2141, merged) already owns and finished its
`.github/workflows/ci.yml` changes — the two split jobs and their `needs:`
edges. This slice reads their *output* (job/step conclusions via the API) and
should not need to touch `ci.yml` at all, per the Open Questions answer above.
If the supersession-vs-timeout verification turns up a case the
`steps[].conclusion` fingerprint cannot resolve, that is new information the
plan did not have — report it rather than reaching into `ci.yml` to add a
workaround.
