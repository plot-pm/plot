## Implementation brief — a-sha-bound-run-reports-the (wave 2: Runs That Ran)

- **Plan (canonical):** `docs/plans/2026-10-20-a-sha-bound-run-reports-the.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2165 merged
- **Branch:** `bug/jenkins-runs-skip-builds-that-did` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** PR review per repo convention (plan `Review: pr`)

This branch waits on `bug/a-sha-bound-run-reports-the` (wave 1): both edit the
one jq program in `jenkins_sha_runs`. Do not start the diff until wave 1 has
merged to `main` — rebase onto it first, so you are editing the program wave 1
left behind rather than the one on `main` today.

### What to build

`runs <branch>` (no sha given) lists every build Jenkins returns, including
`NOT_BUILT` and `ABORTED` results. Neither is a run of the branch's code:
`NOT_BUILT` means Jenkins never started the build (e.g. superseded by a newer
trigger before it ran), and `ABORTED` means a human or a timeout cancelled it
before it finished. A caller reading `runs` to see what actually ran sees
builds that did neither.

Confirmed on `main` today (`test/reconcile/host.test.mjs:3488`, *"runs on
Jenkins reaches jenkins_sha_runs unfiltered, never gh, and returns every build
newest first"*): the test fixtures two builds and asserts both come back,
with no `result` filter anywhere in the chain. The jq program in
`jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1778-1788`) maps every
build in `.builds[]` to a row and, for the no-sha/no-plain-fallback case
(`:1787`, the branch after `elif $plain == ""`), passes all of them through
unfiltered. That is the one place to add the drop.

### Settled decisions — do not re-derive them

- **The fix stays inside `jenkins_sha_runs`.** It is the one place that reads
  `.builds[]` and builds `conclusion` from `.result` (`:1783`). `runs`,
  `run-for-sha` and `runs-for-sha` all go through it (lines ~4547 and ~4628
  after wave 1 lands — re-check the exact line numbers once you rebase, wave 1
  touches this same function). A filter added in a caller would leave the
  other two entry points unfiltered against the same raw data, and would
  duplicate the `result` check at every caller instead of once.
- **The filter applies to `runs` only, not to `run-for-sha`/`runs-for-sha`.**
  The plan's Design §2 scopes this to `runs`; a sha-bound lookup is asking
  "did sha X run", and a caller that pinned a sha already knows the answer it
  wants to see, including a cancelled or not-built state for that exact sha.
  Filter by dropping `NOT_BUILT`/`ABORTED` rows only on the branch-scoped,
  no-sha path — read the `if $sha != "" then … elif $plain == "" then … else
  … end` structure at `:1786-1787` before deciding where the `select`/`map`
  goes; the three arms already diverge for a reason and this change must not
  collapse them into one.
- **Which field to filter on:** `conclusion`, not `.result` directly — the jq
  program already derives `conclusion` from `.result` at `:1783` (`null`
  while building, else `.result`), so filtering on `conclusion` keeps the
  `building` branch's semantics (a build still running has `conclusion: null`
  and must not be mistaken for `NOT_BUILT`/`ABORTED`).
- **Whether `ABORTED` drops is the plan's open question, not yet closed.**
  The plan's Design §2 says *"this decision is open … because `ABORTED` can
  carry a real cancellation signal for a caller"* and lists it again under
  Open Questions. The Changelog entry and the slice line both say `runs` drops
  both `NOT_BUILT` and `ABORTED` — so unless you find a concrete `runs`
  consumer that reads `ABORTED` as a signal (search before assuming: `grep -rn
  "conclusion" packages/ skills/plot/scripts/board/` for anything reading a
  `runs` row), implement the Changelog's stated behavior (drop both) and close
  the open question in the plan with what you found, rather than leaving the
  code and the plan's prose disagreeing.
- **Carried-over rules:** absent is not false — a build whose `result` is
  `null` because it is still `building` is not "not run"; it is in progress,
  and must survive the filter. Read the `conclusion` value, not its absence,
  to decide whether a row is `NOT_BUILT`/`ABORTED`.

### Done when

The plan's slice line is the specification: `runs` omits `NOT_BUILT` and
`ABORTED` builds, with a test per result value. The assertions that exist
because a naive filter passes without them:

- **A fixture with at least one `NOT_BUILT` or `ABORTED` build alongside a
  `SUCCESS`/`FAILURE` build, asserting the former is absent from `runs`'
  output and the latter survives.** The existing test at `:3488` fixtures two
  builds that both survive today (`FAILURE`, `SUCCESS`) — add a sibling test
  rather than mutating that one, since that one is explicitly asserting the
  *unfiltered* historical shape for `run-for-sha`/`runs-for-sha` callers that
  still want every row.
- **A `building: true` row (conclusion `null`) survives the filter.** A filter
  written as `select(.conclusion != null)` would wrongly drop in-progress
  builds; assert one stays.
- **`run-for-sha`/`runs-for-sha` are unaffected.** Extend or add a test
  showing a sha-bound lookup for a `NOT_BUILT`/`ABORTED` build still returns
  that row — the filter must not leak into the sha-scoped arms.
- **Test naming:** the existing fixture helper `jenkinsBuildsFor` and
  `makeJenkinsRestBin` (used throughout `host.test.mjs`, e.g. `:3496-3503`,
  `:3671-3681`) are the established pattern for building the REST stub; reuse
  them rather than writing a third fixture shape.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each
push and run what it prints. The suites in the `CI suites` config key run in
CI, and a failure there comes back as a correction. `host.test.mjs` is slow
under load: run the test names you touched
(`node --test --test-name-pattern=…`), not the whole file in a loop. Add a
changeset (`plot: patch`, description first, `bumps:` block last, `plan:`
line inside the block pointing at this plan).

Name the shell gate: `scripts/check-shell-lines.sh` refuses a PR whose shell
under `skills/` is longer than at its merge base. This branch touches
`plot-host.sh`, a `.sh` file — a `select()` added to the jq program costs a
line or two; if the net grows, pay for it in the same change (remove shell
elsewhere, or move the logic into the domain and ask it through a bundle).
The gate stores no number and grants no exemption.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`).
Append `→ #<number>` to this branch's line in the plan's `## Slices` section
(`docs/plans/2026-10-20-a-sha-bound-run-reports-the.md`, under `### Runs That
Ran`) when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the jq program in `jenkins_sha_runs` in
`skills/plot/scripts/plot-host.sh` (the `runs`-arm filter only), the fixture
and tests in `test/reconcile/host.test.mjs`, the changeset, and the plan's
`ABORTED` open question.

In flight, verified against the plan at dispatch time:

- `bug/a-sha-bound-run-reports-the` (wave 1) — edits the same jq program's
  `.sha` mapping (`map(.sha = (.shas | first // "") | del(.shas, .br))`). This
  branch waits on it and must rebase onto its merged result before editing the
  program, to avoid redoing wave 1's change.
- `2026-10-20-bitbucket-jenkins-pr-list-rows-past` — the plan's Design section
  names this as overlapping in files (`plot-host.sh`) and not in scope. Diff
  against it before merging, even though it is a separate plan.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
