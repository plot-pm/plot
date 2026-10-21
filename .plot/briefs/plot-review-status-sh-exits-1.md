## Implementation brief — plot-review-status-sh-exits-1 (wave 1: Fix)

- **Plan (canonical):** `docs/plans/2026-10-21-plot-review-status-sh-exits-1.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2297 merged
- **Branch:** `bug/plot-review-status-sh-exits-1` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the only wave. Nothing waits on it and it waits on nothing.

### What to build

`plot-review-status.sh <sprint-slug>` exits 1 with empty stdout on every sprint file that holds a line without a `[slug]`. Measured by the ewz field test, round 6: `kafka-gp-sync` on ewz-kus-portal and `the-board-tells-the-truth` in this repository both fail. `/plot-sprint` status therefore receives no review-freshness data.

The cause is one line. `skills/plot/scripts/plot-review-status.sh:32` reads `ITEM_SLUG=$(echo "$line" | grep -oE '\[([a-z0-9-]+)\]' | head -1 | tr -d '[]')`. On a line with no slug, `grep` exits 1, `pipefail` carries that status out of the substitution, and `set -e` ends the script before `[ -z "$ITEM_SLUG" ] && continue` at `:33` runs. Add `|| true` to the substitution, as `ANNOTATION` at `:36` already does. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The output format does not change.** The plan records *Board impact: none*. Do not touch the JSON shape `{items: [...]}` or the fields of an item.

**Do not delete `set -euo pipefail`.** The guard goes on the one pipeline that is allowed to find nothing. Dropping `pipefail` hides real failures in the `jq` call at `:62`.

**Audit the other pipelines, and report what you find rather than widening the change.** The `PR`, `BRANCH`, `REVIEWED_AT` and `REVIEW_SHA` lines at `:40-43` end in `|| echo ""` and already tolerate a missing field. `HEAD_SHA` at `:49` ends in `|| echo ""`. The plan's open question — whether another helper reads sprint lines with the same unguarded pipeline — is for you to answer from `grep -n "grep -oE" skills/plot/scripts/*.sh`. `plot-impl-status.sh:123` already documents this exact failure and guards it. A second unguarded caller in a different script goes in the PR description, not into this diff.

**Rule carried over: absent is not false, and a pipeline's exit code is not its emptiness.** `grep` with no match is a normal answer, not an error.

### Done when

The plan's `## Slices` entry is the specification: the slug extraction tolerates a non-match, and a contract test under `test/reconcile/` runs the script on a sprint file mixing plan items, plain items and annotated items, asserting exit 0 and the expected JSON.

Lift these assertions, because a naive test passes without them:

- **A plain item with no `[slug]` sits between two plan items.** A file with the plain line last also passes while the bug stays, since the loop has finished reading. It must sit before at least one item that should appear in the output.
- **An item with a slug and no annotation is skipped, and an annotated one is listed.** This catches a fix that replaces `continue` logic with a broader skip.
- **The test must fail on `main` before the fix.** Run it against the unfixed script and read the exit code 1 first. Mutation-test it: remove the `|| true` and confirm the test goes red.
- **Run the script from a sandbox directory with its own `docs/sprints/`.** The script reads `docs/sprints/*-<slug>.md` relative to the cwd and calls `git ls-remote origin`, so give the sandbox no `origin` branch to find; an annotated line with `branch:` then reads `branch-not-found` and `needs_review: true`.
- **Clear `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` in the test's environment.** Worker env leaks into sandbox tests (a known failure on this estate).

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. The fix adds no line: `|| true` goes on an existing line. If you add a line to a `.sh` file, remove an equal number elsewhere in the same change. The gate stores no number and has no override.

New test code uses arrow functions, not `function` declarations. Add a `.changeset/*.md` for package `plot` with the description first and the `bumps:` block last (`plot-sprint: patch` if the skill text changes, otherwise only the package line).

Run `./scripts/check-helper-table.sh` if you touch the helper README. Do not edit `skills/plot/scripts/board/board-server.mjs`; the change does not need a board build.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-review-status.sh`, one new test file under `test/reconcile/`, and one changeset. It touches no other script, no `packages/`, and no plan or sprint file other than the `→ #<number>` annotation.

Branches in flight that touch nearby files: none known for `plot-review-status.sh` — verify with `git log origin/main -3 -- skills/plot/scripts/plot-review-status.sh` before you start. If you find something the plan did not anticipate, report it rather than improvising outside scope.
