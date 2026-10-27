# Juror: rootcause

Position: amend

## Method

I fed hook JSON on stdin to the shipped bundle `pmain/skills/plot/scripts/board/plot-gate.mjs --all`, from a fresh temp git repository (not a linked worktree, with `.plot/state/` present, no receipts, `PLOT_UNATTENDED` unset). Exit 2 means refused. The probe script and the 28-command list are in `scratchpad/rc-rootcause/`. I also read `ci-suite.ts`, `controller-gate.ts`, `gate.ts` and `ci-suite.test.ts` in `pmain` (origin/main, 4a1b8a5fa).

Side observation, **ran**: the live plugin gate (2.28.1) refused my own first probe call, because its command line held the test strings as arguments to `node`. That is the same defect hitting a juror: a command that only names a gated script in data is refused.

## 1. The problem

**Ran.** The issue's exact command exits 2 with `plot-dispatch.sh is a controller-owned action`. The glob form `grep -rn x skills/plot/scripts/*.sh` exits 0. The account in the plan is correct.

**Ran.** Every one of these is refused today (exit 2): `grep -n x …/plot-dispatch.sh`, `head -5 …/plot-approve.sh`, `wc -l …/plot-deliver.sh`, `diff …/plot-approve.sh /dev/null`, `git show HEAD:…/plot-dispatch.sh`, `git log -p -- …/plot-deliver.sh`, `git diff main -- …/plot-deliver.sh`, `[ -x …/plot-dispatch.sh ]`, `tail -f …/plot-dispatch.sh`, `grep -n x …/board/plot-deliver.mjs`. `cat …/plot-dispatch.sh` and a reader-only `for` loop pass.

**Read.** The cause the plan names is the real one and the only one. `isReadSegment` (`ci-suite.ts:302-308`) accepts `ls`, `cat` and `git grep`; `controllerInvocation` (`ci-suite.ts:208-220`) skips only those segments. A grep for other reader carve-outs (`=== 'cat'`, `'ls', 'cat'`) over `packages/domain/src` and `packages/board/src` finds `ci-suite.ts:306` alone. `plot-controller-gate.sh` is a 19-line launcher with no logic of its own, so no shell duplicate needs the same fix. The line citations hold: `READERS` at :60, `controllerInvocation` at :208, `isReadSegment` at :302, `unpinnedProgram` at `controller-gate.ts:241` (its `isReadSegment` call is :242).

**Ran — scope outside the plan's set.** `sed -n 1,20p …/plot-dispatch.sh`, `rg -n x …/plot-dispatch.sh` and `awk 1 …/plot-dispatch.sh` are refused too. `sed -n` is the issue's own example. `rg` is a common agent read. The plan leaves all three out; that is acceptable (`awk` can `system()`, `sed` can `e`/`w`), but the plan should state that they stay refused, so the acceptance does not drift.

## 2. The approach against the code

The fix sits in the right layer: a domain rule, one function, no adapter, no shell. `isReader` (`ci-suite.ts:68-73`) already exists and computes exactly the set the plan wants (`READERS` plus `git diff|show|log|grep`, via `programWords`). The simplest change is to make `isReadSegment` call it rather than to hold a second list.

**But the plan's design is not safe as written — see 3.** `withoutDataLists` (`ci-suite.ts:94`) does not trust `isReader` alone: it also refuses a body that holds `$(`, a backtick, `<(` or `>(`. `isReadSegment` must carry the same condition. The plan leaves that as Open Question 2; the code answers it, and the answer is "close it".

**Read — the merge-pin claim is slightly wrong.** The plan says "a `grep` whose text names `gh pr merge` stops counting as an unpinned merge". **Ran:** `grep -n 'gh pr merge' README.md` already passes (exit 0), because `unpinnedMerges` strips quotes first and the `gh` arm needs `gh` as the program word. The real merge false positive is the `plot-host` arm, which matches any segment that names `plot-host.sh` and contains `pr-merge`: **ran** `grep pr-merge skills/plot/scripts/plot-host.sh` → exit 2, `a merge must be pinned to the head that was reviewed`. The widening fixes that one. The plan's test should use it.

## 3. Safety

**Ran — the widening opens a bypass that is closed today.** These three are refused today and would pass after the plan, because the reader program would mark the whole segment as a read while the shell still runs the substitution:

- `diff <(skills/plot/scripts/plot-dispatch.sh x) /dev/null` → exit 2 today
- `grep x <(skills/plot/scripts/plot-dispatch.sh y)` → exit 2 today
- ``wc -l `skills/plot/scripts/plot-deliver.sh x` `` → exit 2 today

**Read:** `grep x "$(plot-dispatch.sh y)"` is in the same class. `controllerInvocation` does not strip quotes, and `wordBasename` drops the `"$(` prefix, so today the name is found and refused; after the widening, the `grep` program skips the segment.

**Ran — the hole already exists for `cat`:** `cat $(skills/plot/scripts/plot-approve.sh x)` and `cat <(skills/plot/scripts/plot-approve.sh x)` exit 0 today. So the plan's Open Question 2 is real, and the plan would extend that hole from 2 programs to 15.

The merge arm is not exposed the same way: **read** `unpinnedMerges` (`controller-gate.ts:270-284`) falls back to `readShell` when the segment reading finds nothing, and `readShell` yields the simple command inside `<( )` / `$( )`. `controllerInvocation` has no such fallback. So the controller arm, the one that gates dispatch, approve and deliver, is the one the widening weakens.

Nothing in the change removes, releases, delivers or merges anything; the only failure direction is a refusal that no longer fires. The runs the issue names stay refused: **ran** `bash …/plot-dispatch.sh x`, `xargs …/plot-dispatch.sh` and `grep -l x f | xargs …/plot-dispatch.sh` all exit 2, and `xargs`/`bash` are not in `READERS`, so the widening does not touch them. `find` is not in `READERS` and stays out.

## 4. Slices, Changelog and acceptance

One slice, one observable result. It is right-sized. The acceptance fails on today's code: **ran** — the issue's `grep -n` and `head -5` cases both exit 2 today, so a `toBeNull()` test fails before the change. The Changelog line names the reader set and the runs that stay refused. It does not name substitution, which is the part a reader of the release note needs to trust the gate.

The `controllerInvocation` TSDoc (`ci-suite.ts:166-205`) and the `unpinnedMerges` TSDoc (`controller-gate.ts:262`) both say "`ls`, `cat` or `git grep`". The slice must update them; the plan does not say so.

## 5. New defects

- `check-shell-lines.sh`: zero cost; the change is TypeScript only (**read**).
- Layering: domain rule, consumed by `gate.ts` and the merge arm (**read**). No port or adapter change.
- Bash 3.2, Bitbucket vs GitHub: not touched. The `plot-host` merge arm is backend-neutral, and its false positive is fixed for both hosts.
- Project-agnostic: script basenames are Plot's own; no adopting-repo name enters.
- Bundles: `plot-gate.mjs` is generated and rebuilt by main; the PR must carry no bundle diff (`check-no-bundle-diff.sh`).
- Refusal wording, minor, **ran**: `grep -n x …/board/plot-deliver.mjs` is refused naming `plot-deliver.sh`. Not this plan's defect; it disappears once the grep is a read.

## Amendments

1. **Close the substitution hole in the same slice.** A segment is a read only when its program is a reader AND no word holds `$(`, a backtick, `<(` or `>(` — the same test `withoutDataLists` applies at `ci-suite.ts:94`. Resolve Open Question 2 that way, for every reader including `cat` and `ls`.
2. **Add run cases to the acceptance that pass after a naive widening:** `diff <(…/plot-dispatch.sh x) /dev/null`, `grep x <(…/plot-dispatch.sh y)`, ``wc -l `…/plot-deliver.sh x` ``, `grep x "$(…/plot-dispatch.sh y)"` and `cat $(…/plot-approve.sh x)` all read as their action. The last one fails on today's code too, so it pins the closed hole.
3. **Reuse `isReader`** (`ci-suite.ts:68`) inside `isReadSegment` rather than a second list, so the loop-body and segment readings cannot drift again.
4. **Fix the merge-pin example:** the false positive the change removes is `grep pr-merge skills/plot/scripts/plot-host.sh` (refused today), not a quoted `gh pr merge` (passes today). Test that command.
5. **State that `sed`, `awk` and `rg` stay refused** (Open Question 1 closed), and list them as acceptance rows that still read as a run, so a later widening is a decision, not a drift.
6. **Update both TSDoc blocks** that name "`ls`, `cat` or `git grep`" (`ci-suite.ts` above `controllerInvocation` and `isReadSegment`; `controller-gate.ts` above `unpinnedMerges`).
