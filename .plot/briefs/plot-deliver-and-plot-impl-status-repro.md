## Implementation brief — plot-deliver-and-plot-impl-status (wave 1: Reproduction)

- **Plan (canonical):** docs/plans/2026-10-24-plot-deliver-and-plot-impl-status.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2489 merged
- **Branch:** `bug/plot-deliver-and-plot-impl-status-repro` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review, `plot-review` app required on `main`)

Wave 2 (`bug/plot-deliver-and-plot-impl-status`, Resolution) waits on this branch: it turns the failing test below green. This branch ships the test and nothing else.

### What to build

One failing test that reproduces #2158: a plan in a repository whose `Git host` is Bitbucket, `Impl: other repo`, with slice lines `→ owner/repo#N` that name merged PRs in a GitHub repository. With host CLIs stubbed, `plot-impl-status.sh <slug>` must list the PR (today it prints `{"prs": []}`) and the deliver script must accept the slice (today it refuses `cannot deliver: 2 branch(es) not merged`).

The cause is measured, not guessed: `skills/plot/scripts/plot-impl-status.sh:320` calls `plot-host.sh pr-state "$NUM" --repo "$REPO"`. `plot-host.sh` picks ONE backend per checkout (`$PLOT_HOST`, else the `Git host` key); `--repo` only passes `-R <repo>` to the `gh` arm or the repository argument to the `bb` arm. A GitHub reference on a Bitbucket checkout therefore reaches `bb`, finds no PR, and degrades to `state NONE`. Lines 322 and 334 call `pr-state` with no `--repo` at all.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **The test pins behaviour, not the mechanism.** The plan leaves open whether Resolution uses a `## Plot Config` key or a `host:` prefix on the reference. The test must not name either. It stubs `gh` and `bb`, runs the scripts on a Bitbucket checkout, and asserts the outcome. A test that encodes the config key or the prefix decides an open question in the wrong slice. If the stubs cannot express "this repository lives on GitHub" without one of the two, report that instead of picking.
- **Stub the host CLIs, never `plot-host.sh`.** A stub of `plot-host.sh` hides the very backend selection under test, and `scripts/check-host-cli-callers.sh` keeps `gh`/`bb` calls out of every other script.
- **The stubs must make the backends disagree.** The `bb` stub answers *no such PR* for the reference and the `gh` stub answers *merged*. A fixture where both answer alike passes with the bug in place (see the memory *Mutation fixtures must make the arms disagree*).
- **An unreachable host is `unknown`, not `not merged`** (plan, Design › Approach). The repro does not test it; Resolution does. Do not assert `NONE` as the correct answer for a missing CLI.
- **Absent is not false.** Read the exit code, not the emptiness of the output.

### Done when

The plan lists one deliverable for this wave: a failing test. So:

- The test fails on `main` for the cause above, and the failure message names the reference and the host it was sent to. Show the failing output in the PR body.
- It fails for the right reason: temporarily route the stub so both arms agree, and confirm the test then passes. Restore the stub afterwards, from git.
- The failing test does not break the suite: mark it as an expected failure in the form the repo's `node --test` files already use (`todo`), so CI stays green until Resolution removes the marker. Check how `test/reconcile/*.test.mjs` does this before choosing a form.
- The test lives under `test/reconcile/` and runs private `TMPDIR`/`HOME` like its neighbours. It clears `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` in its `run()` (both leak from worker env into sandbox tests).

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI. Run the whole `test/reconcile/*gate*.test.mjs` set, not only your file.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This wave adds no shell, so it needs no payment.

A changeset is not needed for a test-only change; check `./scripts/check-changeset-packages.sh` if you add one.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. Append `→ #<number>` to this branch's line under `### Reproduction` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns one new file under `test/reconcile/`, plus fixtures it needs. It touches no script under `skills/`, no `packages/`, and not the plan's Design.

In flight: `bug/plot-deliver-and-plot-impl-status` (Resolution) holds `plot-host.sh`, `plot-impl-status.sh`, the deliver script and the reconcile scan. Leave all four alone.

The plan's Open Questions are unresolved (config key or prefix; the full list of callers; the `host.ts` port shape; the PR index's keys). They belong to Resolution and review. If you find something the plan did not anticipate, report it rather than improvising outside scope.
