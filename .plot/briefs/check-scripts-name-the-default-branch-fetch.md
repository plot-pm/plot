## Implementation brief — shell-scripts-refuse-a-second-mode-and-name-the-fetch (slice: Fetch Hints)

- **Plan (canonical):** docs/plans/2026-11-21-shell-scripts-refuse-a-second-mode-and-name-the-fetch.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3612 merged
- **Branch:** `bug/check-scripts-name-the-default-branch-fetch` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on nothing. The plan's other two slices (`bug/boardctl-and-dispatch-refuse-a-second-mode`, #3628; `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts`, #3728) touch `skills/plot/scripts/` only. This slice touches `scripts/` and `test/reconcile/` only, so the three do not collide.

### What to build

Fix #3143. Three CI gates run unattended in every desk (they are in the `**` entry of `Local checks`), and each fails on a missing base ref without telling the agent what is missing or what to run.

- `scripts/check-sprint-members.sh:9` runs `git merge-base "${1:-origin/main}" HEAD` under `set -euo pipefail`. With `refs/remotes/origin/main` absent, git prints its own error and the gate exits non-zero with no ref name and no fetch command. It also ignores `refs/remotes/origin/HEAD`.
- `scripts/check-shell-lines.sh:118` prints `git fetch --no-tags origin <branch>` as the `pr` growth hint. That form updates `refs/remotes/origin/<branch>` only when `remote.origin.fetch` maps the branch. The refusal at `:140` uses the explicit refspec but always names `main`, also when the ref is a `sprint/*` base or `origin/HEAD` names another branch.
- `scripts/check-decision-count.sh:211` holds the same refusal word for word, and `:72-76` holds a second copy of `default_ref` (the first is `check-shell-lines.sh:87-91`).

Add `scripts/lib-default-ref.sh` with two functions, sourced the way `check-bundle-attributes.sh:34-35` sources `lib-declared-bundles.sh` (`source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib-…sh"`; `check-decision-count.sh:66` already sources a lib through `$here`):

- `default_ref`: the `refs/remotes/origin/HEAD` target, else `refs/remotes/origin/main`. The two existing copies drop out.
- `fetch_hint <ref>`: strips `refs/remotes/`, then `origin/`. For `origin/<b>` or `refs/remotes/origin/<b>` it prints `git fetch --no-tags origin <b>:refs/remotes/origin/<b>`. For any other ref (a SHA, `HEAD~1`, a local branch) it prints nothing.

Use them in all three scripts:

- **Missing-ref refusal:** `<script>: <ref> is absent, so there is no base to compare with.`, then ` Run: <fetch_hint>` where the hint is non-empty, else ` Pass a remote-tracking ref such as origin/<branch>, or a commit this clone holds.`. This replaces `check-shell-lines.sh:140` and `check-decision-count.sh:211`.
- **`check-sprint-members.sh`:** resolve the ref as `${1:-$(default_ref)}`, verify `<ref>^{commit}` before `git merge-base`. Absent: the refusal above, prefixed `::error::`, exit 1. Where `git merge-base` answers nothing: `::error::check-sprint-members: no merge base between HEAD and <ref>`, exit 1. The script stays a launcher: it resolves a ref and decides nothing about members.
- **`check-shell-lines.sh:118`:** the `pr` growth hint prints `fetch_hint "$4"` and leaves the whole hint line out where `fetch_hint` prints nothing. `push` mode prints no hint, as today.

### The decisions the plan settles — do not re-derive them

**Explicit refspec, never the short form.** `git fetch --no-tags origin <b>` updates `refs/remotes/origin/<b>` only when `remote.origin.fetch` maps the branch (a single-branch or shallow clone in a desk does not). `<b>:refs/remotes/origin/<b>` works with any refspec. A hint that leaves the ref stale reads, to an agent, as a defect in its own change.

**No fetch line for a SHA or a local ref.** A fetch command for a ref that is not a remote-tracking name would be wrong advice. `fetch_hint` prints nothing there and the refusal says what to pass instead. Each script has a test for this.

**`check-decision-count.sh` is in scope.** Operator decision 2026-11-21 (plan Open Questions, checked). Its `:211` refusal and its `:72-76` `default_ref` copy go through the same helper.

**One helper, not three copies.** The helper holds no decision about members, shell lines or decisions. It resolves a ref and names a command.

**`scripts/*.sh` is not counted by the shell-lines gate** (it reports them apart under `--per-file`). This slice changes no file under `skills/`, so it pays no line budget. No changeset: the slice ships no skill change (plan, Changesets).

**Rules carried over unchanged:** read an exit code, never the emptiness of stdout; the `push` mode of `check-shell-lines.sh` must keep printing no hint, and today no test proves it (the `push` growth test at `shell-lines.test.mjs:159-167` does not assert the hint is absent, so a lost `[ "$1" = pr ]` guard prints it on `main` and nothing fails).

### Done when

The plan's `## Done when` / Design slice 3 list is the specification. The assertions a naive implementation passes without:

- `test/reconcile/sprint-members-gate.test.mjs`: the fixture copies the launcher (`:44`), so it must also copy `scripts/lib-default-ref.sh` (without it every case fails with a source error, not the refusal under test).
  - With `refs/remotes/origin/main` deleted: exit 1, output names `origin/main` and `git fetch --no-tags origin main:refs/remotes/origin/main`.
  - With `origin/HEAD` pointing at `origin/trunk` set to the `sprint` commit and no argument: exit 0, where it exits 1 against `main` (`:93-97`). This catches a script that still reads the literal `origin/main`.
  - An explicit argument still wins (the case at `:78`).
  - An unrelated history names `no merge base`.
  - An absent SHA argument names the SHA, prints no `git fetch`, and names `Pass a remote-tracking ref`.
- `test/reconcile/shell-lines.test.mjs`:
  - The `pr` growth test at `:86` tightens to `main:refs/remotes/origin/main` (the current pattern also matches the new form, so tightening is what makes it fail before the fix).
  - The `push` growth test at `:159` asserts the output contains no `git fetch`.
  - `pr origin/sprint/x` with that ref absent names `sprint/x:refs/remotes/origin/sprint/x`.
  - `pr <sha>` growing the shell prints no `git fetch`.
- `test/reconcile/decision-count.test.mjs`: `pr origin/sprint/x` with that ref absent names `sprint/x:refs/remotes/origin/sprint/x`; `pr` with `origin/main` absent names `main:refs/remotes/origin/main`; `pr <absent sha>` prints no `git fetch`.

Write each test and watch it fail for the right reason before the helper exists.

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (it names the three tests above and the `scripts/check-*.sh` gates). The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice touches no `.sh` under `skills/`, so run `./scripts/check-shell-lines.sh pr` once to confirm it reports no growth. Also run `./scripts/check-helper-table.sh` and `./scripts/check-script-names.sh`: a new file in `scripts/` may need to satisfy both. If `check-agents-md.sh` or another gate names the new file, follow its message.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

When the PR is created, append `→ #<number>` to this branch's line under `### Fetch Hints` in the plan's `## Slices` section.

### Scope guard

This branch owns:

- `scripts/lib-default-ref.sh` (new)
- `scripts/check-sprint-members.sh`, `scripts/check-shell-lines.sh`, `scripts/check-decision-count.sh`
- `test/reconcile/sprint-members-gate.test.mjs`, `test/reconcile/shell-lines.test.mjs`, `test/reconcile/decision-count.test.mjs`

Other branches of this plan, verified at dispatch: `bug/boardctl-and-dispatch-refuse-a-second-mode` (#3628) owns `plot-boardctl.sh`, `plot-dispatch.sh` and their tests. `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts` (#3728) owns `plot-fleetctl.sh` and `fleetctl.test.mjs`. No file overlaps.

Out of scope: any change to the gates' counting or decision logic, and any new refusal beyond the missing-ref and no-merge-base cases above. If you find something the plan did not anticipate, report it rather than improvising outside scope.
