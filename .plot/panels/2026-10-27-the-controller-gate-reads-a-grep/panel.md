# Panel round 1 — moderation

Subject: `docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md` (plan PR #2759, issue #2706).

Gate: `plot-panel.mjs check Position proceed,amend,reject` committed all four files. Reconcile: `unanimous amend rootcause,code,safety,tests`.

## What each juror looked at

- **rootcause** ran 28 command shapes through the shipped `plot-gate.mjs --all` with hook JSON on stdin, in a fresh temp repository. The live plugin gate also refused the juror's own probe, which held gated names only as data.
- **code** ran `controllerInvocation` and `unpinnedMerges` from an esbuild bundle of `ci-suite.ts` and `controller-gate.ts`, and read every caller of `isReadSegment`.
- **safety** ran 60 command shapes through two copies of `ci-suite.ts`, today and widened as the plan says, and ran git in a throwaway repo to confirm that `GIT_EXTERNAL_DIFF`, `--ext-diff` and `git grep -O` run a program.
- **tests** read the existing tests that the change inverts, and named the mutations the acceptance must kill.

## Agreed by all four

1. **The account is right.** `isReadSegment` (`ci-suite.ts:302-308`) admits `ls`, `cat` and `git grep` only, while `READERS` (`:60`) and `GIT_READERS` (`:65`) name more. `grep -n x …/plot-dispatch.sh` and `head -5 …/plot-approve.sh` read as `dispatch` and `approve` today (ran by all four).
2. **Reuse `isReader` (`ci-suite.ts:68`)**, not a third list.
3. **The widening as written opens a bypass, and the plan's tests cannot see it.** `withoutDataLists` widens only when no word holds `$(`, a backtick, `<(` or `>(` (`ci-suite.ts:99-105`). `isReader` alone lacks that guard, and `controllerInvocation` has no `readShell` fallback. After the naive widening, `grep x $(…/plot-dispatch.sh s)`, ``wc -c `…/plot-dispatch.sh s` ``, `diff <(…/plot-dispatch.sh s) f` and `[ -n "$(…/plot-deliver.sh s)" ]` all read as no action (ran by safety and rootcause). Every reader segment must refuse a substitution, which also closes the existing `cat $(…)` hole and answers Open Question 2.
4. **The merge-pin example is wrong.** `grep 'gh pr merge' x.md` already passes today. The false positive the change removes is `grep -n pr-merge skills/plot/scripts/plot-host.sh` (and `git log -S pr-merge -- …/plot-host.sh`), refused today as an unpinned `plot-host` merge (ran by code and safety).
5. **Existing tests invert.** `test/reconcile/controller-gate.test.mjs:808-818` and `ci-suite.test.ts:206-209` assert that `grep` refuses; the `grep` half flips and the `sed` half stays. The TSDoc at `ci-suite.ts:186`, `:301` and `controller-gate.ts:261` changes too.
6. **`sed`, `awk` and `rg` stay refused** (Open Question 1), `find … -exec` stays a run (Open Question 4). One slice, domain TypeScript only, no shell lines.

## Disagreements

**How far to close the bypasses.** All four close the substitution hole. They differ on three more shapes, each measured to run a gated script after the widening:

- **Assignment prefix and git run options.** code and safety: `GIT_EXTERNAL_DIFF=…/plot-dispatch.sh git diff` runs the script with no flag (ran), and `git show --output=…` overwrites one. Today no reader in the carve-out takes an environment program; `git diff|show|log` are new and each can run a program. A reader segment with a leading assignment, or with `--ext-diff`, `--output`, `-O`, `--textconv`, is not a read. rootcause and tests do not name this.
- **A reader piped into a shell or `xargs`.** safety only: `grep . …/plot-dispatch.sh | bash -s s` and `cat …/plot-dispatch.sh | bash -s s` (the second passes today). The downstream `bash -s` names no script.
- **A reader redirected to a file.** safety only: `head -n 9999 …/plot-dispatch.sh > /tmp/d.sh; bash /tmp/d.sh` is a copy, which `cp` already refuses.

tests would record the remaining holes as known, with rows asserting today's answer, or a follow-up issue. safety would close the pipe and assignment cases in this slice. The assignment case is the strongest: it is a new class the widening creates, while the pipe and redirect cases already pass today through `cat`.

## Shared blind spot

Every juror judged the gate as a security boundary against a command that hides a gated script. The gate's job in CLAUDE.md is narrower: it keeps the master agent on the controllers, and the agent it binds is not adversarial. No juror weighed the cost on the other side: each guard turns a read back into a refusal for an honest agent, which is the defect #2706 reports. The plan should state which side a doubtful shape falls on and why.

## Named amendments for the plan

1. `isReadSegment` delegates to `isReader`.
2. A reader segment holding `$(`, a backtick, `<(` or `>(` is a run, reusing the guard at `ci-suite.ts:99-105`; tests for `grep`, `wc`, `diff`, `[` and the existing `cat $(…)` hole.
3. Resolve the disagreement above for assignment prefixes, git run options, shell pipes and file redirects: closed in this slice with tests, or recorded as known holes with tests that pin today's answer.
4. Replace the merge-pin fixture with `grep -n pr-merge …/plot-host.sh` → `[]`.
5. Name the inverted tests and the TSDoc sites.
6. Close the four Open Questions as above; name the reads that stay refused (`sed`, `awk`, `rg`, `git -C . grep`, a gated name in quoted text) as out of scope.
7. State the mutations the acceptance kills.
