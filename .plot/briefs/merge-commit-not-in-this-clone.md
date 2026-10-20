## Implementation brief — merge-commit-not-in-this-clone

- **Plan (canonical):** `docs/plans/2026-10-20-merge-commit-not-in-this-clone.md` on `main`
- **Approved:** 2026-10-20, Jan Wloka, plan-PR #2191 merged
- **Branch:** `bug/merge-commit-not-in-this-clone` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The plan has one slice and no wave ordering. Nothing waits on this branch and it waits on nothing.

### What to build

`plot-reconcile-scan.sh` section 6 (*delivered, shipped but plan not released*) prints `inspect: git fetch --tags origin, then re-run` for a merge commit the clone does not hold (`skills/plot/scripts/plot-reconcile-scan.sh:3401`, guarded by `git cat-file -e "${sha}^{commit}"` at `:3400`). Measured 2026-10-20 against ewz-kus-portal (Bitbucket): PRs #3488, #3489 and #3490 each reported `merge commit … not in this clone`; after a fresh fetch, `git cat-file -t a528921d88dd` still failed, and the clone is not shallow. The advice sends the operator to a command that changes nothing.

The finding must be true or absent. Where a fetch can bring the commit, it keeps `git fetch --tags origin`. Where it cannot, it says why the commit is unreachable and prints no fetch advice. The plan's `## Design` is deliberately undecided; its two open facts are yours to measure first.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Measure before choosing the fix.** The plan lists three open questions and decides none: which ref carries the Bitbucket merge commit (a pull-request ref outside the default refspec, or a hash the host later rewrote or dropped), whether the same advice appears elsewhere, and whether one wording or one per population is needed. Answer the first against a real Bitbucket merge if you can reach one; if you cannot, say so in the PR rather than guess a refspec. A refspec addition that is not proven to fetch the commit is the same false advice, one layer down.

**Three populations reach `:3400`** (comment at `:3391-3397`): `--no-fetch` with PRs on, a merge commit outside the local refspec or a shallow clone, and a PR merged outside the host's merge button. The scan tells `--no-fetch` (`do_fetch`, `:293`) and a shallow clone (`git rev-parse --is-shallow-repository`) apart from the rest with no host call. A fetch helps the first and the shallow case only.

**Absent is not false, and cannot resolve is not nothing wrong.** The `cat-file -e` branch exists so that "cannot tell" never looks like "not released yet" (the 2026-09-18 defect in the comment above it). Keep the finding visible and keep it counted in `n_unrel`; changing its wording must not drop it or let it fall through to the `continue` that means *genuinely not released*.

**The host answers what landed.** `sha` comes from `plot-host.sh pr-state` `.mergeCommit` (`:3361`). Do not replace that with an ancestry or `git log` reading (`CLAUDE.md` › One Answer To "Did This Land"); if you add a git call that decides anything, `scripts/check-ancestry-decisions.sh` wants its kind declared.

**One host caller.** Any new host question goes through `plot-host.sh`; `scripts/check-host-cli-callers.sh` fails on a direct `gh` or `bb` call.

### Done when

The plan has no `## Done when` list yet, so the changelog line is the specification: `plot-reconcile` no longer advises a fetch that cannot bring the merge commit; it either finds the commit after the advised fetch or names why the commit is unreachable. Add a `## Done when` list to the plan with the measured answers to its open questions. The assertions that exist because a naive implementation passes without them:

- **A fixture where the commit stays absent after a fetch.** `test/reconcile/scan.test.mjs:4059` asserts `/not in this clone → cannot resolve/`; a test that only keeps that line green passes with the false advice intact. Assert the finding prints no `git fetch --tags origin` where a fetch cannot help.
- **A fixture where a fetch does help** (`--no-fetch`, or a shallow clone) and still prints `git fetch --tags origin`. This catches the over-correction that deletes the advice everywhere.
- **The finding stays counted and visible** for every population: it appears in section 6 output and moves `n_unrel`.
- **Sibling grep:** `git grep -n "fetch --tags origin" -- skills packages test` returned one site on 2026-10-20 (`:3401`). Re-run it; the plan's second open question asks.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-reconcile-scan.sh`, so a net line increase is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

Add one changeset for `plot` and `plot-reconcile`, description first and `bumps:` last (`CLAUDE.md` › Versioning). Do not commit a generated bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this slice's line in the plan's `## Slices` section.

### Scope guard

This branch owns the section 6 finding in `skills/plot/scripts/plot-reconcile-scan.sh`, its tests in `test/reconcile/scan.test.mjs`, the `plot-reconcile` skill text if it quotes the advice, and the plan file. It touches no board code, no domain package and no other scan section. Other plans in flight on 2026-10-20 (`plot-pr-merged-sh-asks-gh`, `plot-on-a-bitbucket-repository-lists`, `bitbucket-jenkins-a-pr-list-row`) touch the host adapter and the Bitbucket list path; if you need to change those, report it rather than improvising.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
