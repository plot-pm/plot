# Juror verdict — root cause

Plan: `docs/plans/2026-10-26-implement-leaves-its-brief-and-plan.md` (head `f891832aa`). Code cited from `p2726-main` at `46dd1e5dd`.

Position: amend

## Summary

The plan fixes a symptom, and part of its causal account is wrong. The evidence names a different cause. The board process and the fleetd process are older than the gate they run under. The main-checkout gate comes from the plugin, and every agent session loads it fresh. The gate refuses the run because the spawner, which runs an older bundle, does not set the marker that would allow the commit. The agent then improvises. The copies in the main checkout are the agent's own first writes, and are not copies made after the push. fleetd does not read briefs from the main checkout, so a fast-forward does not decide what fleetd sees.

## 1. The problem

### What writes the files into the main checkout

- **Read (transcript `e4166d74…jsonl`, the `8a714dee7` run):** at 20:02:49Z the agent writes `.plot/briefs/fleet-start-probes-worker-writes.md` and the plan into `/Users/jwloka/Quatico/Agentic-Tools/plot` with the Write tool. At 20:02:54Z it runs `git add … && git commit` there. `plot-main-checkout-gate` refuses. Only then does the agent cut a temporary worktree, `cp` the two files into it, commit and push. At 20:05:21Z it tries `git restore` and `git merge --ff-only` in the main checkout, and the gate refuses again. The leftovers are the original writes, and the gate blocks the cleanup.
- **Read (transcript `eb9ba0b7…jsonl`, the `d315381c6` run):** the same order. The Write happens at 17:21:56Z, then `git stash -u; git merge --ff-only; git stash pop` is refused at 17:23:00Z, then the agent commits in `/tmp/plot-brief-scratch` and pushes.
- **Read (transcript `5b38eb8f…jsonl`, the `cc5c7a1d5` run):** the gate refuses `git pull --ff-only` at 19:39:14Z. After that the agent writes the brief by heredoc straight into a temporary worktree and leaves nothing in the main checkout. The untracked `.plot/briefs/fleetd-holds-the-pr-index-lock.md` that the issue names for this occurrence is a different slice's brief. This run did not write it, and I did not trace where it came from.

### Why the gate refused a run that is designed to be allowed

- **Read:** `implement-run.ts:617` sets `PLOT_MAIN_CHECKOUT_WRITER=1` for the implement run, and `brief-ask.ts:163` sets it for fleetd's brief ask. `gatesMainCheckout` (`main-checkout-write.ts`) allows a run that carries the marker. On current code the agent may commit in the main checkout. The skill (`skills/plot-implement/SKILL.md` step 4) relies on that permission.
- **Ran (`ps`, `lsof`):** the board on port 7777 is pid 23604, started 2026-10-20 09:33. fleetd is pid 8692, started 2026-10-17 17:15. Neither runs under `node --watch` (the parent of both is launchd).
- **Ran (`git show`):** the board bundle that was current when the board started (`275a8704e`, 2026-10-20) spawns implement with `env:{PLOT_UNATTENDED:"1",PLOT_PLAN_SLUG,…PLOT_BRIEF_BRANCH}`, and `PLOT_MAIN_CHECKOUT_WRITER` occurs 0 times. The fleetd bundle at its start (`286e0483a`, 2026-10-17) has the brief prompt and 0 occurrences of the marker. The marker arrived in `da7097509` (#2317, 2026-10-22).
- **Ran:** the installed plugin `~/.claude/plugins/cache/plot-marketplace/plot/2.28.1` holds the gate that checks the marker (`plot-gate.mjs`: `e.PLOT_UNATTENDED==="1"&&e[ok]!=="1"`), and `plot-gates.sh` runs it on every Bash call.
- **Conclusion:** the spawner and the gate are from different versions. The spawner is a long-lived process with a stale bundle. The gate is fresh. The agent gets `PLOT_UNATTENDED=1` without the marker, so its designed commit is refused. The memory entry "The board does not reload its bundle" names this mechanism. The plan names neither the version gap nor the processes.

### Why nothing updates the main checkout, and whether fleetd needs it

- **Read:** fleetd decides `no-brief` from the ref, not the checkout. `registryd-main.ts:768-779` reads `refs.fileExistsSync(\`origin/${base}\`, '.plot/briefs/<suffix>.md')`. The dispatch shell's `brief_present` (`plot-dispatch.sh:546-552`) reads `git cat-file -s origin/$MAIN:.plot/briefs/…`. The auto-dispatch log line says *"no brief on origin/main"*.
- **Ran (`git reflog refs/remotes/origin/main`):** the agents' pushes updated the shared remote-tracking ref at once: `cc5c7a1d5` "update by push" at 20:40:22, and `8a714dee7` at 21:05:17. A worktree push writes the shared ref, so fleetd saw each brief without a fast-forward.
- **Ran (grep of `fleetd.log` and `fleetd.log.1`):** every `held on no-brief` entry in the window names `bug/fleet-start-probes-worker-writes`, and none names `nothing-done-asks-pr-state-only-where-it-decides` or `pr-reader-lock-elects-one-writer`. The `no-brief=1` that the issue attributes to the `cc5c7a1d5` slice belongs to a slice whose brief did not exist until 21:05. At that time `nothing-done…` shows as `held on no-free-agent` and is then handed over. The issue's claim that the slice was held until an operator fast-forwarded the checkout does not hold.
- **Answer to "is the main checkout the right place for fleetd to read briefs":** fleetd already does not read from it. The plan's option 3 describes the current code, and its Board-impact comment ("the board reads briefs from the main checkout through fleetd") is wrong.

What the incident does cost: a dirty main checkout that blocks the operator's own `git pull`/`merge --ff-only`. In the `d315` case, an autostash conflict followed. That harm is real. It reaches the operator, not fleetd.

## 2. The approach against the code

- The plan leaves the choice open between three designs, and it gives no owner. Root cause narrows the choice:
  - **Option 3 is already done** (see above). It fixes nothing.
  - **Option 2** (fast-forward the main checkout after the push) treats the symptom. It also adds a new writer to the operator's checkout. That writer moves files the board and worker loops run from (memory: "Fast-forwarding main restarts worker loops"; "The board does not reload its bundle"). It does not stop the stray writes, because under version skew the controller that would run the fast-forward is the stale one.
  - **Option 1** (write nowhere but a disposable worktree) removes the cause class. The `--brief-only` run never needs the main checkout. The gate's own refusal text recommends this route ("route it through a disposable worktree the way plot-dispatch.sh books its Started record"), and `write_started_record` already does it. With option 1, the marker `PLOT_MAIN_CHECKOUT_WRITER` is no longer needed for implement and brief runs. A stale spawner can then not produce the failure, and #2162's backstop `restoreCheckedOutBranch` (`implement-run.ts:597`) has nothing to restore.
- The plan does not name the version-skew defect, and it needs its own remedy. A spawner older than the gate fails silently in this way for every role that depends on the marker: deliver, reslice, story and brief-ask, not only implement. A durable fix lets the gate or the spawner detect the gap. For example, the gate could name the marker's absence together with the spawner's bundle version. Or the board and fleetd could refuse to spawn a marker-dependent role when their bundle predates the running plugin's gate. The plan must at least record this as an open defect and say who restarts the processes.
- The plan's sentence *"the gate that blocks the agent's git writes is the reason the copy exists, so the repair must not route around it"* is right in spirit. It reads the gate refusal as intended behaviour, but here the refusal is the defect. On current code the implement run is meant to pass.
- `implement-run.ts:485-488` claims "the agent process writes no uncommitted change of its own here, by the `main-checkout` gate's own contract". The transcripts show that this is false under skew, so the comment needs correcting with the fix.

## 3. Safety

- Option 2 (fast-forward the operator's main checkout) can run while the board and worker loops execute bundles from that tree. It moves `skills/plot/scripts/**` under them. A fast-forward refuses with uncommitted local changes in the paths it touches, so it does not discard work. But "refuse and name the files" leaves the current incident shape, a dirty checkout that blocks the fast-forward, unrepaired. "Skip silently" violates the user's rule against degrading silently.
- The `d315` agent ran `git stash -u` in the operator's checkout (refused). Memory says "Never stash in a shared Plot worktree". The current skill text gives an unattended agent no route other than improvising, and the next improvisation may not be gated. Option 1 removes the reason to improvise.
- Option 1 writes only inside a `mktemp` worktree and never touches the operator's tree, branch or index.

## 4. Slices, Changelog and acceptance

- The one slice's acceptance is "fleetd reads the brief on its next tick". That is true today (ran: reflog plus fleetd log), so the acceptance cannot fail, and it proves nothing.
- The Changelog line promises "fleetd reads the new brief … without an operator step", which already holds. The observable change worth shipping is that `/api/implement --brief-only` leaves `git status` of the main checkout unchanged, even when the spawner's bundle predates the gate. That is checkable in a unit test with a fixture repo: run the brief path with `PLOT_UNATTENDED=1` and no marker, then assert a clean `git status --porcelain`.

## 5. Defects the plan misses

- **Version skew:** no detection, and no named owner for restarting long-lived board and fleetd processes after a plugin update. This is the root cause of all three runs.
- **The issue's evidence is partly wrong:** the `cc5c7a1d5` untracked file and the `no-brief=1` attribution. The plan copies both into Motivation. Correct them before approval.
- **Scope:** the same marker gap affects every marker-dependent role (`deliver.ts`, `reslice.ts`, `story.ts`, `auto-deliver.ts`, `brief-ask.ts`, `continuation.ts` reference the marker). The plan covers only implement.
- **Skill text:** `skills/plot-implement/SKILL.md` step 4 says to write the brief "where the plan lives" and commit, and its disposable-worktree route is only the recovery path. Option 1 means making that route the primary path under `--brief-only`. That is a skill change with a version bump and a Model Guidance check, and the plan does not list it.
- **Shell budget:** if any part lands in `plot-dispatch.sh` or another shell helper, `check-shell-lines.sh` requires an offsetting removal. Option 1 in TypeScript or skill prose avoids that.
- **Project-agnostic:** option 1 depends on `git worktree` only. It is Bitbucket-neutral. The push step goes through the existing `plot-push-main` route, which already handles both hosts.

## Named changes required before approval

1. Rewrite Motivation from the evidence: the version gap between the long-lived board and fleetd and the fresh plugin gate. Drop the claim that fleetd reads briefs from the main checkout, and correct the `cc5c7a1d5` evidence.
2. Settle the design on option 1. A `--brief-only` run writes and commits only in a disposable worktree, and the main checkout stays byte-for-byte unchanged. Drop option 3 because the code already does it. Drop option 2 because it adds a writer to the operator's checkout while the board runs from it.
3. Add a slice, or a named follow-up issue, for detecting skew between a spawner and the gate across all marker-dependent roles.
4. Replace the acceptance with one that can fail today: a clean `git status --porcelain` in the main checkout after a brief-only run with `PLOT_UNATTENDED=1` and no writer marker.
