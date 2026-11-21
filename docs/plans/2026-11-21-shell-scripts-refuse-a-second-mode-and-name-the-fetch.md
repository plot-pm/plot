# Shell scripts refuse a second mode and name the fetch

> `plot-boardctl.sh` and `plot-dispatch.sh` refuse two different mode flags, `plot-fleetctl.sh --restart` reads the loaded unit's checkout and the main checkout, and the three default-branch check scripts name the missing ref and print a fetch command that works with any refspec.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3138, #3367, #3143
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3612 merged
- **Started:** 2026-11-21, Jan Wloka, `bug/boardctl-and-dispatch-refuse-a-second-mode`
- **Started:** 2026-11-21, Jan Wloka, `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts`

## Changelog

- `plot-boardctl.sh` refuses two different mode flags in one call (for example `--start --stop`) with exit 1 before it acts, and names both flags. The same flag twice still passes.
- `plot-dispatch.sh` refuses two different mode flags in one call (for example `--start --stop`) with exit 1 before it acts, and names both flags. It also refuses one branch flag given twice with two different branches (`--stop feature/a --stop feature/b`). A branch or a count after its flag still works.
- `plot-fleetctl.sh --restart` reports the commit of the checkout that holds the bundle the loaded supervisor runs. Where that directory is not the top level of its own git checkout, it reports `unknown`.
- `plot-fleetctl.sh --restart` run from a linked worktree restarts this repository's supervisor instead of refusing with "serves ANOTHER checkout". `--start` from a linked worktree compares against the main checkout too.
- `scripts/check-sprint-members.sh` refuses by name when its base ref is absent, prints the fetch command, and reads the default branch from `refs/remotes/origin/HEAD` when it is set.
- `scripts/check-shell-lines.sh` and `scripts/check-decision-count.sh` print their fetch hints in the explicit `<branch>:refs/remotes/origin/<branch>` form, for the branch they compared with. For a base that is not a remote-tracking ref, they print no fetch command.

<!-- Board impact: none. No slice changes the plan format, the plan template, the docs/plans layout or a board bundle's contract. Slices 1 and 2 change shell scripts under skills/plot/scripts/; slice 3 changes scripts/ only. -->

## Motivation

**#3138, last mode flag wins.** On origin/main `b21961602` (unchanged at `f062c1912` for every file below):

- `skills/plot/scripts/plot-boardctl.sh:243-245`: `--status`, `--start` and `--stop` each assign `mode=`. The script acts on the final value at `:285` (status), `:346` (start) and `:487` (stop), so `plot-boardctl.sh --start --stop` stops the board and reports nothing about the first flag.
- `skills/plot/scripts/plot-dispatch.sh:278` sets the default `mode=dispatch`. `--status` (`:297`), `--migrate` (`:298`), `--stop` (`:303`), `--restart` (`:308`), `--release` (`:314`) and `--start` (`:320`) each assign `mode=` again, so `--start --stop` runs the stop arm. `plot-fleetctl.sh --stop` calls the stop arm per desk, so a mixed call signals a running agent.
- The same harm one level down: `--stop feature/a --stop feature/b` passes the parser, sets `stop_branch` twice (`:303`) and stops only `feature/b`. `--restart` (`:308`) and `--release` (`:314`) behave the same way.
- Plan `2026-11-04-a-second-mode-flag-in-plot` (Released) fixed the mode defect in `plot-fleetctl.sh` only (commit `997eb0f64`). Its one-arm refusal at `plot-fleetctl.sh:749-755` is the model: one case arm for every mode flag, a test `[ -z "$mode" ] || [ "$mode" = "${1#--}" ]`, then `mode=${1#--}`.

**#3367, `--restart` reads the wrong checkouts.** Found in the review of #3340 (merged as `1398783ac`):

- **M1.** `plot-fleetctl.sh:1120` (the `restartPlan` call) and `:1141` (the `restarted` call) pass `git -C "$repo_root" rev-parse --short HEAD`. `$repo_root` is the repository the command runs in. The program the unit runs is the `fleetd` bundle path that `--start` recorded (`:136`), and the reload at `:1131-1136` re-runs that recorded program, not the invoked script's copy. In a consumer repository the report names the consumer's HEAD, and in a linked worktree it names the worktree's HEAD. The domain labels the value "the bundle checkout's short commit" and prints `unknown` for an empty one (`packages/domain/src/rules/fleetctl-start.ts:73,115,205`). The tests miss the defect because `sandbox()` puts the scripts inside the sandbox root, so every candidate root is the same directory.
- **M2.** `plot-fleetctl.sh:1102` calls `old_label_refuses "${mode/restart/stop}"` with no root argument, so `old_label_action` compares the loaded job against `$repo_root` (`:592`). The supervisor serves the main checkout, so from a desk or scratch worktree the rule answers `another` and `--restart` refuses. `--stop` passes `stop_root=$(plot_repo_root)` for this reason (`:1280-1281`, documented at `:585`).

**#3143, no fetch advice, or advice that can leave the ref stale.** `check-sprint-members.sh`, `check-shell-lines.sh pr` and `check-decision-count.sh pr` are in the `**` entry of `Local checks`, so the worker loop runs them unattended in every desk. CI calls all three with `origin/$GITHUB_BASE_REF` (`.github/workflows/ci.yml:1652,1861,1871`). An agent that reads a raw git error, or a fetch hint for the wrong branch, cannot tell a missing ref from a defect in its change.

- `scripts/check-sprint-members.sh:9` runs `git merge-base "${1:-origin/main}" HEAD` under `set -euo pipefail`. With `refs/remotes/origin/main` absent, git prints its own error and the gate exits non-zero with no Plot message, no ref name and no fetch command. It reads the literal `origin/main` and ignores `refs/remotes/origin/HEAD`.
- `scripts/check-shell-lines.sh:118`, the `pr` growth hint, prints `git fetch --no-tags origin <branch>`. That form updates `refs/remotes/origin/<branch>` only when `remote.origin.fetch` maps the branch. The missing-ref refusal at `:140` uses the explicit form, but always names `main`, also when the ref is a `sprint/*` base passed as the second argument or when `origin/HEAD` names another branch (`default_ref`, `:87-91`).
- `scripts/check-decision-count.sh:211` holds the same missing-ref refusal word for word, with the literal `main`, and `:72-76` holds a second copy of `default_ref`.
- `test/reconcile/shell-lines.test.mjs:81-91` asserts the hint in `pr` mode only. The `push` growth test at `:159-167` does not assert that the hint is absent, so a lost `[ "$1" = pr ]` guard prints the hint on `main` and no test fails.

## Design

### Approach

**Shell line budget.** `scripts/check-shell-lines.sh` counts every `.sh` file under `skills/` (`count_rev`, `:76-83`) and refuses growth against the merge base. Slices 1 and 2 change files under `skills/plot/scripts/`, so each slice runs `./scripts/check-shell-lines.sh pr` before its push and pays any growth inside the same change. Slice 3 changes only `scripts/*.sh`, which the gate does not count (it reports them apart under `--per-file`). Every count below is measured with the gate's own `COUNT_AWK` on a candidate form.

**Slice 1, one mode arm in `plot-boardctl.sh` and `plot-dispatch.sh`:**

- `plot-boardctl.sh`: replace the three arms at `:243-245` with one arm `--status|--start|--stop)` that refuses a different earlier mode and then sets `mode=${1#--}`. The refusal reads `plot-boardctl: --<first> and --<second> are different modes; give one; nothing was done` on stderr and exits 1, the wording of `plot-fleetctl.sh:750`. The three arms count 9, the fleetctl-shaped arm counts 9, and the form `mode=${mode:-${1#--}}; [ "$mode" = "${1#--}" ] || { …; exit 1; } ;;` on one line counts 8. Net change: 0 or −1.
- `plot-dispatch.sh`: the default mode is `dispatch` and no `--dispatch` flag exists, so `mode` still equal to `dispatch` means "no mode flag yet". Merge the six arms at `:297-324` into one arm, as `plot-fleetctl.sh:749-755` does: the mode refusal against `dispatch` and the arm's own word, `mode=${1#--}`, then one `case "$1:${2:-}"` that consumes a `*/*` branch after `--stop`, `--restart` or `--release` and a bare number after `--start`.
- **The branch refusal.** Replace `stop_branch`, `restart_branch` and `release_branch` (`:279-281`) with one `mode_branch`. Only one mode can now hold, so one variable serves all three, and its 21 readers (for example `:1557-1623`, `:1634-1640`, `:1661-1667`) change their name only. Where `mode_branch` already holds a different branch, the arm refuses: `plot-dispatch: --stop feature/a and --stop feature/b name different branches; give one; nothing was done`, exit 1. The same branch twice passes.
- **Budget for `plot-dispatch.sh`:** the current six arms count 38. The merged arm with both refusals counts 27, and the three variable lines become one. Net change: about −13.
- Both refusals run inside the argument loop, before the first side effect. `--start 3`, `--stop feature/x`, `--restart feature/x` and `--release feature/x` keep their values; `--start --dry-run` keeps `--dry-run` as a flag. No caller in `packages/` passes two mode flags (`performer-shell.ts:102`, `claim-release-shell.ts:21`, `supervisor-reading.ts:152`, `release.ts:222` each pass one), so no board or fleet path meets the new refusals.
- **Tests,** in the style of `test/reconcile/fleetctl.test.mjs:782-857`:
  - `test/reconcile/boardctl.test.mjs`: `--start --stop` exits 1, names `--start and --stop are different modes`, and starts and stops nothing; `--stop --status` names both; `--status --status` passes; `--status --port N` passes.
  - `test/reconcile/dispatch.test.mjs`: `--start --stop` exits 1, names both flags, and signals no agent. The fixture desk must be one that a bare `--stop` reaches today (the slug precondition at `:391` passes it), so the survival assertion fails before the fix. `--stop feature/x --restart feature/x` names both modes. `--stop feature/a --stop feature/b` exits 1, names both branches and stops neither. `--stop feature/x --stop feature/x` passes the parser. `--start 3 --dry-run` keeps the count and the dry run (beside `runDetached(['--start', '--dry-run'], …)` at `:4092`). `--status` alone and the default dispatch with no mode flag behave as before.

**Slice 2, `--restart` reads the unit's checkout and the main checkout:**

- **M1, the commit source.** Before `:1120`, read the checkout of the program the loaded unit runs: `unit_root=$(supervisor_bundle_path); unit_root=${unit_root%/skills/plot/scripts/board/*}`. `supervisor_bundle_path` (`:230-237`) already reads the `.mjs` path from the loaded job's argv (launchd `arguments = {…}`, systemd `ExecStart`), and `--start` writes `$script_dir/board/plot-fleetd.mjs` there (`:136`). Both calls at `:1120` and `:1141` then pass `"$(GIT_CEILING_DIRECTORIES="${unit_root%/*}" git -C "$unit_root" rev-parse --short HEAD 2>/dev/null)"`. The ceiling stops git at the checkout's parent, so a plugin directory with no `.git` inside a git-tracked parent (a `~/.claude` kept in git, or a plugin vendored in the consumer) answers empty, and the domain prints `unknown`; it never reports the parent's HEAD. An unreadable bundle path leaves `unit_root` empty or a non-directory, and the commit is empty too. A linked worktree's `.git` file still resolves. `--restart --dry-run` reads the same unit before the reload; `restarted` reads it after the reload, which re-runs the same recorded program. No domain change.
- **M2, the owner root.** At `:1102`, pass the main checkout: `old_label_refuses "${mode/restart/stop}" "$(plot_repo_root)"`, the root `--stop` reads at `:1280`. The line also serves `--start` with the `start` verb, and the change applies to both modes with no fallback. On an unloaded unit `old_label_action` returns before it asks (`:593`); on a loaded unit `start` refuses whatever checkout it serves, so only the refusal text changes for a run from a linked worktree: `serving THIS repository` in place of `serving ANOTHER checkout` (`packages/board/src/server/entry/old-label.ts:121,123`).
- **Budget for `plot-fleetctl.sh`:** the `unit_root` line counts 2. The two call lines keep their count (the `:1120` line counts 3 before and after), and the `:1102` argument counts 0. Net change: +2. The slice pays the 2 lines inside `plot-fleetctl.sh`, for example by folding the two `git … rev-parse` arguments into one `unit_commit` value read once, or by removing two commands elsewhere in the file, measured with `check-shell-lines.sh pr`.
- **Tests** in `test/reconcile/fleetctl.test.mjs`, beside the `--restart` block at `:3846-3998`. The `restartEnv` stub (`:3878`) prints a `working directory` and no `arguments = {…}` block; the M1 tests extend it to print the bundle path the way the stub at `:2211-2237` does.
  - **A plugin checkout.** In `consumerSandbox` (`:2612-2644`), `git init` the plugin directory `box/plugin-cache/plot/9.9.9` and commit once. `--restart` reports `bundle commit: <plugin short HEAD>` (one space, `restarted` at `fleetctl-start.ts:205`) and not the consumer's HEAD. `--restart --dry-run` reports `bundle commit:  <plugin short HEAD>` (two spaces, `restartPlan` at `:115`).
  - **No `.git`.** An unmodified `consumerSandbox` (plugin with no `.git`) reports `bundle commit: unknown` for `--restart` and `bundle commit:  unknown` for `--restart --dry-run`. A second case places the plugin directory, still with no `.git`, inside a `git init`-ed parent and asserts the same `unknown`.
  - **A worktree ahead of main.** A linked worktree of the sandbox repository carries one commit that main does not. The main checkout's `ctl` runs with `cwd` set to the worktree (the worktree holds no `skills/`, `fleetctl.test.mjs:155-161`). The unit's bundle path names the main checkout. `--restart` restarts the supervisor (the pid changes), does not print `serves ANOTHER checkout`, and reports `bundle commit:` equal to the main checkout's short HEAD, not the worktree's.
  - **`--start` from a worktree.** With a loaded unit that serves the main checkout, `--start` run from the same linked worktree exits 1 and prints `is already loaded, serving THIS repository`.

**Slice 3, the default-branch check scripts name the fetch:**

- **One shared helper.** Add `scripts/lib-default-ref.sh`, sourced the way `check-bundle-attributes.sh:34-35` sources `lib-declared-bundles.sh`. It holds `default_ref` (the `origin/HEAD` target, else `refs/remotes/origin/main`) and `fetch_hint <ref>`. `fetch_hint` strips `refs/remotes/` and then `origin/`; where the ref was `origin/<b>` or `refs/remotes/origin/<b>`, it prints `git fetch --no-tags origin <b>:refs/remotes/origin/<b>`. For any other ref (a SHA, `HEAD~1`, a local branch) it prints nothing. `check-shell-lines.sh:87-91` and `check-decision-count.sh:72-76` drop their own copies of `default_ref`.
- **The missing-ref refusal**, in all three scripts: `<script>: <ref> is absent, so there is no base to compare with.`, followed by ` Run: <fetch_hint>` where the hint is not empty, and by ` Pass a remote-tracking ref such as origin/<branch>, or a commit this clone holds.` where it is empty. This replaces `check-shell-lines.sh:140` and `check-decision-count.sh:211`.
- `scripts/check-sprint-members.sh`: resolve the ref as `${1:-$(default_ref)}` and verify `<ref>^{commit}` before `git merge-base`. Absent: the refusal above, prefixed with `::error::`, exit 1. Where `git merge-base` answers nothing: `::error::check-sprint-members: no merge base between HEAD and <ref>`, exit 1. The script stays a launcher: it resolves a ref and decides nothing about members.
- `scripts/check-shell-lines.sh:118`: the `pr` growth hint prints `fetch_hint "$4"`, and the whole hint line is left out where `fetch_hint` prints nothing. `push` mode prints no hint, as today.
- **Tests:**
  - `test/reconcile/sprint-members-gate.test.mjs`: the fixture copies the launcher (`:44`), so it also copies `scripts/lib-default-ref.sh`. With `refs/remotes/origin/main` deleted, the gate exits 1 and names `origin/main` and `git fetch --no-tags origin main:refs/remotes/origin/main`. With `origin/HEAD` pointing at `origin/trunk`, set to the `sprint` commit, and no argument, the gate exits 0 where it exits 1 against `main` (`:93-97`). An explicit argument still wins (the case at `:78`). An unrelated history names `no merge base`. An absent SHA argument names the SHA, prints no `git fetch`, and names `Pass a remote-tracking ref`.
  - `test/reconcile/shell-lines.test.mjs`: the `pr` growth test at `:86` tightens to `main:refs/remotes/origin/main` (the current pattern also matches the new form). The `push` growth test at `:159` asserts that the output contains no `git fetch`. `pr origin/sprint/x` with that ref absent names `sprint/x:refs/remotes/origin/sprint/x`. `pr <sha>` growing the shell prints no `git fetch`.
  - `test/reconcile/decision-count.test.mjs`: `pr origin/sprint/x` with that ref absent names `sprint/x:refs/remotes/origin/sprint/x`; `pr` with `origin/main` absent names `main:refs/remotes/origin/main`; `pr <absent sha>` prints no `git fetch`.

**Layering.** No slice adds a decision to the shell. Slices 1 and 2 correct argument handling and arguments passed to existing bundles; slice 3 changes CI launchers under `scripts/`. No rendered state changes.

**Changesets.** Slices 1 and 2 change `skills/plot/scripts/`, so each adds a `.changeset/*.md` for `'plot': patch` with a `bumps: skills: plot: patch` block last. Slice 3 changes `scripts/` only and ships no skill change.

### Open Questions

- [x] Slice 3 includes `scripts/check-decision-count.sh` (the `:211` refusal and the `:72-76` copy of `default_ref`). Operator decision, 2026-11-21.

## Slices

### Mode Flags

- `bug/boardctl-and-dispatch-refuse-a-second-mode` — one mode arm in `plot-boardctl.sh` and `plot-dispatch.sh` that refuses two different mode flags, and in `plot-dispatch.sh` one `mode_branch` that refuses a second, different branch, before the first side effect and with fewer shell lines, with the boardctl and dispatch contract tests <!-- builds: second-mode refusal in plot-boardctl.sh and plot-dispatch.sh --> → #3628

### Restart Roots

- `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts` — `--restart` reads the bundle commit from the loaded unit's own checkout under a git ceiling, and `--restart` and `--start` compare the loaded job against `plot_repo_root`, with the plugin-checkout, no-`.git`, worktree-ahead and `--start`-from-worktree contract tests <!-- builds: plot-fleetctl --restart bundle commit and owner root -->

### Fetch Hints

- `bug/check-scripts-name-the-default-branch-fetch` — `scripts/lib-default-ref.sh` with `default_ref` and `fetch_hint`, used by `check-sprint-members.sh`, `check-shell-lines.sh` and `check-decision-count.sh` for a named missing-ref refusal and an explicit-refspec hint, with no fetch line for a SHA or a local ref, and the tests for all three <!-- builds: lib-default-ref.sh, the shared default-ref and fetch-hint helper -->

## Notes

- Created 2026-11-21 from triage of #3138, #3367 and #3143. Every file:line above was re-read on origin/main `b21961602`; `git log b21961602..f062c1912` over the changed scripts and tests is empty. The three slices touch disjoint files and wait on nothing.
- `plot-deliverable-search.sh` found no existing deliverable for any slice. "different modes refusal" and "second mode flag" matched only unrelated `mode` lines; `old_label_refuses` matched only `plot-fleetctl.sh` (`:606`, `:1102`, `:1281`); "default branch fetch hint" and `default_ref` found the two copies in `scripts/check-shell-lines.sh:87,139` and `scripts/check-decision-count.sh:72,210-211`, which slice 3 replaces with one helper.
- Already fixed and left out: the mode defect in `plot-fleetctl.sh`, by `997eb0f64` (plan `2026-11-04-a-second-mode-flag-in-plot`, Released). The six LOW points from the review of #3340 stay in that review comment, as #3367 says.
- Out of scope: a supervisor started from a linked worktree. `--start` fills the unit with `$repo_root` (`plot-fleetctl.sh:1124`), so such a unit serves the worktree, and after M2 a `--restart` from that worktree reads `another` and refuses. #3367 does not cover it.
- Out of scope: `plot-fleetctl.sh:1103` (`start-default`) still compares against `$repo_root`. It asks about the default label's unit, a different unit from `$LABEL`, and #3367 does not name it.
- Line numbers that moved since the issues were filed: #3138 cited `plot-dispatch.sh:281` and `:310-333` on `fbf670eaf`; they are `:278` and `:297-324` now. #3143 cited `check-sprint-members.sh:8` and the missing-ref line at `check-shell-lines.sh:138`; they are `:9` and `:140` now.
- **Panel round 1** (estate, testability, user; all `amend`, none `reject`; verdicts in `.plot/panels/2026-11-21-shell-scripts-refuse-a-second-mode-and-name-the-fetch/`, not committed). Each finding and where the plan answers it:
  - estate 1, user 1: `git -C "$plot_root"` walks up to a git parent, and `$plot_root` is the invoked script's checkout, not the unit's. Slice 2 M1 reads the unit's bundle path under `GIT_CEILING_DIRECTORIES` and prices the +2 lines.
  - estate 2, testability 1: `consumerSandbox` has no plugin `.git`. Slice 2 tests `git init` the plugin directory and keep an unmodified no-`.git` case, plus a git-parent case.
  - estate 3: `check-decision-count.sh:211` and `:72-76`. Slice 3 includes them through `scripts/lib-default-ref.sh`, and the open question is checked as the operator's decision.
  - estate 4, testability 3: two spacings of `bundle commit:`. Slice 2 tests name the one-space `restarted` form and the two-space dry-run form.
  - estate 5, testability 4: M2 also changes `--start`. The fallback is dropped, the refusal-text change is stated, a `--start`-from-worktree test is added, and the worktree-started supervisor and `:1103` are named out of scope above.
  - estate 6: the model arm is at `plot-fleetctl.sh:749-755`. Corrected in Motivation.
  - estate 7: no overlapping plan or PR. No change.
  - estate 8: the dispatch branch readers. Slice 1 lists them (21 lines, rename only) and measures the budget.
  - testability 2, user 1: the worktree half of M1. The worktree test carries one commit ahead of main and asserts the main checkout's commit.
  - testability 5, user 4: a SHA or local-ref argument. `fetch_hint` prints nothing for it, the refusal names what to pass, and each script has a test.
  - testability 6: the dispatch survival assertion must reach the desk. Slice 1 names the precondition at `:391`.
  - user 2: `--stop feature/a --stop feature/b`. Slice 1 refuses it with a test, inside the budget.
  - user 3: no caller passes two mode flags. Stated in slice 1 for the callers in `packages/`. Shell callers under `skills/` are not checked: the controller gate refused a shell read that names the script. The builder greps them before the push.
  - user 5: the refusal wording matches `plot-fleetctl.sh:750`. No change.
