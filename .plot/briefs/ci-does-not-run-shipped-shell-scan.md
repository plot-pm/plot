## Implementation brief — ci-does-not-run-shipped-shell (wave 1: Static gate)

- **Plan (canonical):** `docs/plans/2026-10-25-ci-does-not-run-shipped-shell.md` on `main`
- **Approved:** 2026-10-25, Jan Wloka, plan-PR #2670 merged
- **Branch:** `bug/ci-does-not-run-shipped-shell-scan` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/ci-does-not-run-shipped-shell-macos`, waits on this branch. It is not part of this slice: add no macOS job here.

### What to build

PR #2659 added `${1^^}` to `bb_query_state` in `skills/plot/scripts/plot-host.sh`. Under `/bin/bash` 3.2.57 the function fails with `bad substitution` and all three Bitbucket PR queries break. CI was green on that head: all four jobs run `ubuntu-latest` with bash 5, and `bash -n` passes because the bad substitution is a run-time error. A reviewer found it by reading (#2660).

Add `scripts/check-bash32-syntax.sh`, a gate that greps the tracked shipped shell for eight bash-4 constructs and fails with `file:line: construct`: `${x^^}`, `${x,,}`, `declare -A`, `mapfile`, `readarray`, `|&`, `&>>`, `${x@Q}`. Model it on `scripts/check-host-cli-callers.sh` (same `cd "${1:-…}"` root argument, same grep-then-filter loop, same `::error::` output), because the mutation test needs to point the gate at a fixture tree.

Register it in three places: a step in `.github/workflows/ci.yml` (the `helper-contracts` job, beside `check-host-cli-callers.sh`, with a comment stating the measurement above), the `**` row of `Local checks` in `CLAUDE.md` (then `./scripts/check-agents-md.sh --write`, because `AGENTS.md` mirrors it), and a mutation test in `test/reconcile/`. The test file name must match `*gate*.test.mjs`, so the `**` local-check row runs it.

### Settled — do not re-derive

- **A static scan, not a bash 3.2 binary.** The Ubuntu jobs have none, and installing one costs more than the grep. The macOS run is wave 2 and catches what grep cannot; this slice catches the eight named constructs in seconds.
- **`bash -n` cannot be the gate.** `/bin/bash -n plot-host.sh` passes on the broken version. Do not substitute it.
- **Comments and quoted prose are not constructs.** Measured on the tree now: `git grep` for the eight patterns returns 6 hits in `*.sh`. Four are comments that say *"no `declare -A`"* (`plot-dispatch.sh:3868`, `plot-fleet-scan.sh:3036` and `:3068`, `plot-reconcile-scan.sh:877`), one is a `sed` false positive (next bullet), and one is real (the bullet after). A gate that flags them is reverted on its first run, which is the lesson in `check-host-cli-callers.sh`'s header. Strip comment lines and trailing `# …` comments before matching.
- **`plot-fleetctl.sh:1144` is a false positive to design around.** `sed -e 's/[][\\|&.*^$]/…'` contains `|&` inside a bracket expression. A bare `grep '|&'` flags it. Match `|&` only where it is a pipe operator (outside quotes), or declare the line. Pick one and test it with this exact line.
- **One real hit exists: `.dev/scripts/bump-skill-versions.sh:25` (`declare -A SKILL_BUMPS=()`).** `.dev/scripts` is a developer tool run by the maintainer and CI, not a shipped helper the operator's machine runs. The plan's open question 4 ("which files count as shipped") is yours to settle: scan `skills/**/*.sh` and `scripts/*.sh`, and say in the gate's header why `.dev/` is out. If you bring `.dev/` in, the gate fails on its own tree, so you would have to rewrite that script — out of scope for this slice.
- **A deliberate use declares itself with an inline marker**, following `check-ancestry-decisions.sh`'s declared kinds. Pick the marker text, state the guard it needs (for example a `BASH_VERSINFO` check), and make the gate refuse a marker on a line that has no guard comment. Zero lines carry the marker today; do not add one to make the tree pass.
- **Carried rules:** absent is not false — a root with no shell files is a failure of the gate (exit 2), not a pass. Read exit codes, not emptiness. No `rm`; the test removes its fixture by the exact name `mkdtempSync` returned, never by glob.

### Done when

The plan's behaviour is the specification: a PR that adds any of the eight constructs to shipped shell fails CI. Then lift the assertions a naive gate would pass without:

- Each of the eight constructs, alone in a fixture, fails the gate with `file:line` and the construct named. One fixture holding all eight proves only that one fired.
- The bash-3.2 equivalents of each pass (`tr '[:lower:]' '[:upper:]'`, a newline-delimited string, a `while read` loop).
- A comment line and a trailing comment that name `declare -A` pass. This is the assertion that stops the gate being reverted.
- `plot-fleetctl.sh:1144`'s `sed` line passes.
- The real defect, vendored: `bb_query_state` as it stood at `5cc5a5743` (introduced `${1^^}`; reachable from `refs/pull/2659/head`, not from `main`, because the PR was squash-merged) fails the gate, and the same function at `d471a21ac` (the fix) passes. Copy the two function bodies into the test as fixture text — a test that runs `git show` on a commit absent from `main` breaks on a fresh clone. A fixture you wrote by hand cannot prove the gate sees the real defect.
- The gate passes on this repository's own tree.
- Mutation-test the gate before believing its tests: commit, delete a pattern from the script, and confirm the matching test fails.

Plus: add the CI step, update `Local checks`, run `./scripts/check-agents-md.sh --write`, and add a changeset (`'plot': patch`, description first, `bumps:` block last; run `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds shell under `scripts/`, not `skills/`, so the ratchet does not count it. If you touch a `.sh` under `skills/`, remove an equal number of lines elsewhere in the same change; the gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `scripts/check-bash32-syntax.sh`, one `test/reconcile/*gate*.test.mjs`, the `ci.yml` step, the `CLAUDE.md` `Local checks` row with its `AGENTS.md` mirror, and one changeset. It does not own the macOS job (wave 2, `bug/ci-does-not-run-shipped-shell-macos`), any edit to a shipped script, or `skills/plot/scripts/README.md` (the gate lives in `scripts/`, so it gets no row there). No other branch of this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
