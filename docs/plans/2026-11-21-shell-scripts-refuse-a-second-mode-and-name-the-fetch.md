# Shell scripts refuse a second mode and name the fetch

> `plot-boardctl.sh` and `plot-dispatch.sh` refuse two different mode flags, `plot-fleetctl.sh --restart` reads the bundle checkout and the main checkout, and the default-branch check scripts name the missing ref and print a fetch command that works with any refspec.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3138, #3367, #3143
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-boardctl.sh` refuses two different mode flags in one call (for example `--start --stop`) with exit 1 before it acts, and names both flags. The same flag twice still passes.
- `plot-dispatch.sh` refuses two different mode flags in one call (for example `--start --stop`) with exit 1 before it acts, and names both flags. A branch or a count after its flag still works.
- `plot-fleetctl.sh --restart` reports the commit of the Plot checkout that holds the supervisor bundle, not the commit of the repository it runs in.
- `plot-fleetctl.sh --restart` run from a linked worktree restarts this repository's supervisor instead of refusing with "serves ANOTHER checkout".
- `scripts/check-sprint-members.sh` refuses by name when the default-branch ref is absent, prints the fetch command, and reads the default branch from `refs/remotes/origin/HEAD` when it is set.
- `scripts/check-shell-lines.sh` prints its fetch hints in the explicit `<branch>:refs/remotes/origin/<branch>` form, for the branch it compared with.

<!-- Board impact: none. No slice changes the plan format, the plan template, the docs/plans layout or a board bundle's contract. Slices 1 and 2 change shell scripts under skills/plot/scripts/; slice 3 changes scripts/ only. -->

## Motivation

**#3138, last mode flag wins.** On origin/main `b21961602`:

- `skills/plot/scripts/plot-boardctl.sh:243-245`: `--status`, `--start` and `--stop` each assign `mode=`. The script acts on the final value at `:285` (status), `:346` (start) and `:487` (stop), so `plot-boardctl.sh --start --stop` stops the board and reports nothing about the first flag.
- `skills/plot/scripts/plot-dispatch.sh:278` sets the default `mode=dispatch`. `--status` (`:297`), `--migrate` (`:298`), `--stop` (`:303`), `--restart` (`:308`), `--release` (`:314`) and `--start` (`:320`) each assign `mode=` again, so `--start --stop` runs the stop arm. `plot-fleetctl.sh --stop` calls the stop arm per desk, so a mixed call signals a running agent.
- Plan `2026-11-04-a-second-mode-flag-in-plot` (Released) fixed the same defect in `plot-fleetctl.sh` only (commit `997eb0f64`). Its one-arm refusal at `plot-fleetctl.sh:746-751` is the model: one case arm for every mode flag, a test `[ -z "$mode" ] || [ "$mode" = "${1#--}" ]`, then `mode=${1#--}`.

**#3367, `--restart` reads the wrong checkouts.** Found in the review of #3340 (merged as `1398783ac`):

- **M1.** `plot-fleetctl.sh:1120` (the `restartPlan` call) and `:1141` (the `restarted` call) pass `git -C "$repo_root" rev-parse --short HEAD`. `$repo_root` is the repository the command runs in. The bundle lives under `$plot_root` (`:140`, `"$script_dir/../../.."`). In a consumer repository the report names the consumer's HEAD, and in a linked worktree it names the worktree's HEAD. The domain already labels the value "the bundle checkout's short commit" and prints `unknown` for an empty one (`packages/domain/src/rules/fleetctl-start.ts:73,115,205`). The tests miss the defect because `sandbox()` puts the scripts inside the sandbox root, so `$plot_root` equals `$repo_root`.
- **M2.** `plot-fleetctl.sh:1102` calls `old_label_refuses "${mode/restart/stop}"` with no root argument, so `old_label_action` compares the loaded job against `$repo_root` (`:592`). The supervisor serves the main checkout, so from a desk or scratch worktree the rule answers `another` and `--restart` refuses. `--stop` passes `stop_root=$(plot_repo_root)` for this reason (`:1280-1281`, documented at `:585`).

**#3143, no fetch advice, or advice that can leave the ref stale.** `check-sprint-members.sh` and `check-shell-lines.sh pr` are in the `**` entry of `Local checks`, so the worker loop runs them unattended in every desk. An agent that reads a raw git error cannot tell a missing ref from a defect in its change.

- `scripts/check-sprint-members.sh:9` runs `git merge-base "${1:-origin/main}" HEAD` under `set -euo pipefail`. With `refs/remotes/origin/main` absent, git prints its own error and the gate exits non-zero with no Plot message, no ref name and no fetch command. It reads the literal `origin/main` and ignores `refs/remotes/origin/HEAD`.
- `scripts/check-shell-lines.sh:118`, the `pr` growth hint, prints `git fetch --no-tags origin <branch>`. That form updates `refs/remotes/origin/<branch>` only when `remote.origin.fetch` maps the branch. The missing-ref refusal at `:140` uses the explicit form, but always names `main`, also when the ref is a `sprint/*` base passed as the second argument or when `origin/HEAD` names another branch (`default_ref`, `:87-91`).
- `test/reconcile/shell-lines.test.mjs:81-91` asserts the hint in `pr` mode only. The `push` growth test at `:159-167` does not assert that the hint is absent, so a lost `[ "$1" = pr ]` guard prints the hint on `main` and no test fails.

## Design

### Approach

**Shell line budget.** `scripts/check-shell-lines.sh` counts every `.sh` file under `skills/` (`count_rev`, `:76-83`) and refuses growth against the merge base. Slices 1 and 2 change files under `skills/plot/scripts/`, so each slice runs `./scripts/check-shell-lines.sh pr` before its push and pays any growth inside the same change. Slice 3 changes only `scripts/*.sh`, which the gate does not count (it reports them apart under `--per-file`).

**Slice 1, one mode arm in `plot-boardctl.sh` and `plot-dispatch.sh`:**

- `plot-boardctl.sh`: replace the three arms at `:243-245` with one arm `--status|--start|--stop)` that refuses a different earlier mode and then sets `mode=${1#--}`. The refusal reads `plot-boardctl: --<first> and --<second> are different modes; give one; nothing was done` on stderr and exits 1, the wording of `plot-fleetctl.sh:750`. Measured with the gate's own counter: the three arms count 9, the fleetctl-shaped arm counts 9, and the form `mode=${mode:-${1#--}}; [ "$mode" = "${1#--}" ] || { …; exit 1; } ;;` on one line counts 8. Net change: 0 or −1.
- `plot-dispatch.sh`: the default mode is `dispatch` and no `--dispatch` flag exists, so `mode` still equal to `dispatch` means "no mode flag yet". Each of the six mode arms refuses where `mode` is neither `dispatch` nor its own word. Merge the six arms into one arm, as `plot-fleetctl.sh:749-755` does: the refusal, `mode=${1#--}`, then one `case "$1:${2:-}"` that consumes a `*/*` branch after `--stop`, `--restart` or `--release` and a bare number after `--start`. A pre-case guard added on its own counts 8 more commands. The merged arm must pay for itself: replace `stop_branch`, `restart_branch` and `release_branch` with one variable where the arms that read them allow it, or remove an equal number of lines elsewhere in `plot-dispatch.sh`. Net change: ≤ 0, measured with `check-shell-lines.sh pr`.
- Both refusals run inside the argument loop, before the first side effect. The same flag twice passes. `--start 3`, `--stop feature/x`, `--restart feature/x` and `--release feature/x` keep their values; `--start --dry-run` keeps `--dry-run` as a flag.
- **Tests,** in the style of `test/reconcile/fleetctl.test.mjs:790-857`:
  - `test/reconcile/boardctl.test.mjs`: `--start --stop` exits 1, names `--start and --stop are different modes`, and starts and stops nothing; `--stop --status` names both; `--status --status` passes; `--status --port N` passes.
  - `test/reconcile/dispatch.test.mjs`: `--start --stop` exits 1, names both flags, and signals no agent (a fixture desk with a live stub process survives); `--stop feature/x --restart feature/x` names both; `--stop feature/x --stop feature/x` passes the parser; `--start 3 --dry-run` keeps the count and the dry run; `--status` alone and the default dispatch with no mode flag behave as before.

**Slice 2, `--restart` reads the bundle checkout and the main checkout:**

- **M1.** At `plot-fleetctl.sh:1120` and `:1141`, read the commit with `git -C "$plot_root" rev-parse --short HEAD 2>/dev/null`. Where `$plot_root` is not a git checkout (a plugin cache with no `.git`), the value is empty and the domain prints `unknown`; no domain change.
- **M2.** At `:1102`, pass the main checkout: `old_label_refuses "${mode/restart/stop}" "$(plot_repo_root)"`, the root `--stop` reads at `:1280`. The line also serves `--start` with the `start` verb, which refuses a loaded unit whatever checkout it serves; the existing `--start` refusal tests must stay green unchanged, and the builder keeps `$repo_root` for `--start` only if one of them fails.
- **Shell line budget:** both changes replace an argument on an existing line. Net change: 0.
- **Tests** in `test/reconcile/fleetctl.test.mjs`, beside the `--restart` block at `:3846-3998`:
  - `--restart` in `consumerSandbox` (`:2612`) reports `bundle commit:` equal to the plugin checkout's short HEAD and different from the consumer's HEAD. The same assertion for `--restart --dry-run`.
  - `--restart` run from a linked worktree of the sandbox repository restarts the supervisor (the pid changes) and does not print `serves ANOTHER checkout`.
  - `--restart` where the bundle checkout has no `.git` reports `bundle commit:  unknown`.

**Slice 3, the default-branch check scripts name the fetch:**

- `scripts/check-sprint-members.sh`: resolve the ref as `${1:-<origin/HEAD target, else refs/remotes/origin/main>}`, the rule `default_ref` in `check-shell-lines.sh:87-91` holds. Verify `<ref>^{commit}` before `git merge-base`. Where it is absent, print `::error::check-sprint-members: <ref> is absent, so there is no base to compare with. Run: git fetch --no-tags origin <branch>:refs/remotes/origin/<branch>` and exit 1. Where `git merge-base` answers nothing, print `::error::check-sprint-members: no merge base between HEAD and <ref>` and exit 1. The script stays a launcher: it resolves a ref and decides nothing about members.
- `scripts/check-shell-lines.sh`: the growth hint at `:118` prints `git fetch --no-tags origin <b>:refs/remotes/origin/<b>`, where `<b>` is the branch it already derives from the compared ref. The missing-ref refusal at `:140` derives `<b>` from `$ref` the same way, in place of the literal `main`. One shared helper may print the command for both lines.
- **Tests:**
  - `test/reconcile/sprint-members-gate.test.mjs`: with `refs/remotes/origin/main` deleted, the gate exits 1 and names `origin/main` and `git fetch --no-tags origin main:refs/remotes/origin/main`; with `origin/HEAD` pointing at `origin/trunk` and no `origin/main`, the gate compares with `origin/trunk`; an explicit argument still wins (the existing case at `:78`); an unrelated history names `no merge base`.
  - `test/reconcile/shell-lines.test.mjs`: the `pr` growth test at `:81` asserts `git fetch --no-tags origin main:refs/remotes/origin/main`; the `push` growth test at `:159` asserts that the output contains no `git fetch`; `pr origin/sprint/x` with that ref absent names `sprint/x:refs/remotes/origin/sprint/x`.

**Layering.** No slice adds a decision to the shell. Slices 1 and 2 correct argument handling and arguments passed to existing bundles; slice 3 changes CI launchers under `scripts/`. No rendered state changes.

**Changesets.** Slices 1 and 2 change `skills/plot/scripts/`, so each adds a `.changeset/*.md` for `'plot': patch` with a `bumps: skills: plot: patch` block last. Slice 3 changes `scripts/` only and ships no skill change.

### Open Questions

- [ ] `scripts/check-decision-count.sh:211` holds the same missing-ref refusal with the literal `main`, and `:72` holds a second copy of `default_ref`. Should slice 3 correct it too, or does it stay out of this plan?

## Slices

### Mode Flags

- `bug/boardctl-and-dispatch-refuse-a-second-mode` — one mode arm in `plot-boardctl.sh` and `plot-dispatch.sh` that refuses two different mode flags before the first side effect, at no shell line growth, with the boardctl and dispatch contract tests <!-- builds: second-mode refusal in plot-boardctl.sh and plot-dispatch.sh -->

### Restart Roots

- `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts` — `--restart` reads the bundle commit from `$plot_root` and compares the loaded job against `plot_repo_root`, with the `consumerSandbox`, linked-worktree and no-`.git` contract tests <!-- builds: plot-fleetctl --restart bundle commit and owner root -->

### Fetch Hints

- `bug/check-scripts-name-the-default-branch-fetch` — `check-sprint-members.sh` names an absent ref and reads `origin/HEAD`, `check-shell-lines.sh` prints both fetch hints in the explicit refspec form for the compared branch, and the tests assert the hint in `pr` mode and its absence in `push` mode <!-- builds: named default-ref refusal in check-sprint-members.sh -->

## Notes

- Created 2026-11-21 from triage of #3138, #3367 and #3143. Every file:line above was re-read on origin/main `b21961602`. The three slices touch disjoint files and wait on nothing.
- `plot-deliverable-search.sh` found no existing deliverable for any slice. "different modes refusal" and "second mode flag" matched only unrelated `mode` lines; `old_label_refuses` matched only `plot-fleetctl.sh` (`:606`, `:1102`, `:1281`); "default branch fetch hint" and `default_ref` found the copies in `scripts/check-shell-lines.sh:87,139` and `scripts/check-decision-count.sh:72,210-211`, which the open question names.
- Already fixed and left out: the same defect in `plot-fleetctl.sh`, by `997eb0f64` (plan `2026-11-04-a-second-mode-flag-in-plot`, Released). The six LOW points from the review of #3340 stay in that review comment, as #3367 says.
- Line numbers that moved since the issues were filed: #3138 cited `plot-dispatch.sh:281` and `:310-333` on `fbf670eaf`; they are `:278` and `:297-324` now. #3143 cited `check-sprint-members.sh:8` and the missing-ref line at `check-shell-lines.sh:138`; they are `:9` and `:140` now.
