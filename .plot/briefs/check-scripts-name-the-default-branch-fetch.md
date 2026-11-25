## Implementation brief — shell-scripts-refuse-a-second-mode-and-name-the-fetch (wave 3: Fetch Hints)

- **Plan (canonical):** docs/plans/2026-11-21-shell-scripts-refuse-a-second-mode-and-name-the-fetch.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3612 merged
- **Branch:** `bug/check-scripts-name-the-default-branch-fetch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This branch waits on nothing and nothing waits on it. The plan's other two slices (`bug/boardctl-and-dispatch-refuse-a-second-mode`, #3628; `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts`, #3728) touch `skills/plot/scripts/` and `test/reconcile/{boardctl,dispatch,fleetctl}.test.mjs`. This slice touches `scripts/` and three other test files, so the file sets are disjoint.

### What to build

Three CI launchers pick a base ref for a merge-base comparison and fail badly when that ref is absent from the clone. `scripts/check-sprint-members.sh:9` runs `git merge-base "${1:-origin/main}" HEAD` under `set -euo pipefail`, so a missing `refs/remotes/origin/main` prints git's own error and exits non-zero with no ref name and no fetch command. It also ignores `refs/remotes/origin/HEAD`. `scripts/check-shell-lines.sh` and `scripts/check-decision-count.sh` already refuse a missing ref, but both hard-code `main` in the fetch command (`check-shell-lines.sh:140`, `check-decision-count.sh:211`), so a `sprint/*` base or a repository whose `origin/HEAD` names another branch gets advice for the wrong branch. The `pr` growth hint at `check-shell-lines.sh:118` prints `git fetch --no-tags origin <branch>`, which updates `refs/remotes/origin/<branch>` only where `remote.origin.fetch` maps that branch. All three run unattended in every desk through the `**` entry of `Local checks`, so an agent that reads a wrong or missing hint cannot tell a missing ref from a defect in its own change.

The change: add `scripts/lib-default-ref.sh` with two functions, `default_ref` and `fetch_hint <ref>`, and source it from all three scripts the way `check-bundle-attributes.sh:34-35` sources `lib-declared-bundles.sh`. `check-decision-count.sh` already sources `lib-declared-bundles.sh` through `$here` (`:65-66`), so add the second source line beside it. Delete the two private copies of `default_ref` (`check-shell-lines.sh:87-91`, `check-decision-count.sh:72-76`). The plan is canonical; this brief is orientation. Line numbers above were read on `origin/main` `20c615410` and match the plan's within a few lines.

### The decisions the plan settles — do not re-derive them

**`fetch_hint` prints the explicit refspec, never the short form.** `git fetch --no-tags origin <b>:refs/remotes/origin/<b>`. The short form `git fetch origin <b>` writes `refs/remotes/origin/<b>` only when `remote.origin.fetch` maps that branch, so a single-branch or narrowed clone fetches the commit and leaves the ref stale. The plan chose the form that works with any refspec.

**`fetch_hint` prints nothing for a ref that is not `origin/<b>` or `refs/remotes/origin/<b>`.** A SHA, `HEAD~1` and a local branch have nothing to fetch. The trap: strip `refs/remotes/` then `origin/` unconditionally and a local branch `main` reduces to `main`, which prints a hint for a ref that is not remote-tracking. Print the hint only where the `origin/` prefix was actually present. `refs/remotes/upstream/x` also prints nothing.

**Where the hint is empty, the refusal names what to pass instead.** The refusal text is `<script>: <ref> is absent, so there is no base to compare with.` followed by ` Run: <fetch_hint>` where the hint is not empty, and by ` Pass a remote-tracking ref such as origin/<branch>, or a commit this clone holds.` where it is empty. One wording for all three scripts. `check-sprint-members.sh` prefixes it with `::error::` because CI renders that as an annotation.

**`check-sprint-members.sh` stays a launcher.** It resolves a ref as `${1:-$(default_ref)}`, verifies `<ref>^{commit}` before `git merge-base`, and decides nothing about members. An absent ref exits 1 with the refusal. A `git merge-base` that answers nothing exits 1 with `::error::check-sprint-members: no merge base between HEAD and <ref>`. Keep `exec node "$bundle" check --base "$base"` as the last line. The script runs git as `git -C "$root"`; `default_ref` and the new verify must read the same repository, so run them with `-C "$root"` too or the fixture tests in a temp directory will read the wrong clone.

**`push` mode of `check-shell-lines.sh` prints no hint, as today.** The hint guard `[ "$1" = pr ]` at `:118` is the only thing keeping a fetch line off `main` pushes, and no test holds it today (`test/reconcile/shell-lines.test.mjs:159-167` does not assert the hint's absence). That is why the plan adds a `no git fetch` assertion to the `push` growth test.

**`scripts/*.sh` is not counted by `check-shell-lines.sh`.** This slice changes only `scripts/`, which the gate reports apart under `--per-file`, so it pays no shell lines and ships no changeset (no `skills/` change). Do not add a `.changeset/*.md`.

**Rules carried over unchanged.** An absent ref is a refusal that names the ref, never an empty answer read as "no base" (absent is not false). Read the exit code, not whether stdout is empty. A missing `refs/remotes/origin/HEAD` falls back to `refs/remotes/origin/main` exactly as the two private copies do today.

### Done when

The plan's `## Slices` entry and `### Approach` Slice 3 section are the specification. Lift these assertions, each one because a naive implementation passes without it:

- **`sprint-members-gate.test.mjs`, absent base.** With `refs/remotes/origin/main` deleted the gate exits 1 and names `origin/main` and `git fetch --no-tags origin main:refs/remotes/origin/main`. Catches an implementation that prints git's raw error or the short fetch form. The fixture copies the launcher at `:44`; it must also copy `scripts/lib-default-ref.sh` or every case fails for the wrong reason.
- **`origin/HEAD` is read.** With `origin/HEAD` pointing at `origin/trunk`, set to the `sprint` commit, and no argument, the gate exits 0 where it exits 1 against `main` (compare `:93-97`). Catches a launcher that still reads the literal `origin/main`. An explicit argument still wins (the case at `:78`).
- **No merge base.** An unrelated history names `no merge base`.
- **SHA argument.** An absent SHA argument names the SHA, prints no `git fetch`, and names `Pass a remote-tracking ref`. Catches the unconditional-strip trap above.
- **`shell-lines.test.mjs`.** The `pr` growth test at `:86` tightens to `main:refs/remotes/origin/main`, because the current pattern also matches the new form and would pass on the old one. The `push` growth test at `:159` asserts the output holds no `git fetch`. `pr origin/sprint/x` with that ref absent names `sprint/x:refs/remotes/origin/sprint/x`. `pr <sha>` with growing shell prints no `git fetch`.
- **`decision-count.test.mjs`.** `pr origin/sprint/x` absent names `sprint/x:refs/remotes/origin/sprint/x`; `pr` with `origin/main` absent names `main:refs/remotes/origin/main`; `pr <absent sha>` prints no `git fetch`.

Mutation-test the new assertions before you trust them: delete the `[ "$1" = pr ]` guard and confirm the `push` test fails; make `fetch_hint` strip unconditionally and confirm the SHA and local-branch tests fail. Commit before mutating.

Plus the repo's gates. `scripts/check-bash32-syntax.sh` runs over `scripts/`, so write bash 3.2 (no `mapfile`, no `${var,,}`, no associative arrays). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI and a failure there comes back as a correction. List no full suite. Run the whole `test/reconcile/*.test.mjs` files you touched by test name where a whole-file run stalls, and read the summary, not the exit code. No changeset and no bundle diff.

### Bookkeeping

When the PR is created, open it with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`, then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `scripts/lib-default-ref.sh` (new), `scripts/check-sprint-members.sh`, `scripts/check-shell-lines.sh`, `scripts/check-decision-count.sh`, `test/reconcile/sprint-members-gate.test.mjs`, `test/reconcile/shell-lines.test.mjs` and `test/reconcile/decision-count.test.mjs`. Also read `test/reconcile/ci-tiers.test.mjs` and `ci-selection-jobs.test.mjs`: both name these scripts, so confirm neither breaks on a new `lib-*.sh`. Do not touch `skills/plot/scripts/` (slices 1 and 2 own it), `.github/workflows/ci.yml` (the three call sites already pass `origin/$GITHUB_BASE_REF`) or `scripts/lib-declared-bundles.sh`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
