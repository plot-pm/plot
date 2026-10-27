# Juror verdict — code lens

Plan: `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md` (PR #2758). Code read at `pmain` = `4a1b8a5fa`.

Position: amend

## Summary

The three observations in the issues are real, and the plan groups them correctly. The plan's account of where each defect lives is wrong for two of three, and its account of the #2697 cause misses the actual defect: the existing start-time check is one-sided and accepts every genuine pid reuse. Two of the plan's open questions are already answered by code or by the issue. Each slice has an existing mechanism to reuse that the plan does not name.

## 1. The problem

**"All three change `rules/reapable.ts`" is false for two of three (read).**

- #2705: the claim rule is `firstClaimRefusal` / `claimSweepProblems` in `packages/domain/src/rules/sweepable.ts:144-174`, not `reapable.ts`. `reap.ts:963-1022` (`runClaimKind`) calls it. The issue's `reap.ts:973` cite is correct (`listBranches(false)` sits at 973; the function starts at 963). The `--release` refusal text sits at the release script's lines 2186-2189, matching the issue's `:2181` within a few lines.
- #2697: the liveness reading is assembled in the board entry, `reap.ts:278-319` (`processWorkerPid`, `deskWorkerPid`), from the shell's `plot_worker_state` and from `deskLoopAlive` (`packages/domain/src/rules/desk-loop-alive.ts:76`). `reapable.ts` only receives `workerPid` as a value (`reapable.ts:113`).
- #2714: `reapable.ts` is the right file (`reapProblems`, `:111-142`).

**#2697: the plan's cause ("asks only whether the recorded pid exists") is incomplete, and the real defect is in an existing check (read + ran).**

- A start-time check already exists. `plot-worker-state.sh:301-338` (`plot_pid_is_current`) compares the process start time with the manifest's `startedAt`, and `:1244-1252` reports `ended` on a mismatch. The domain mirror is `PidLiveness 'stale'` in `packages/domain/src/rules/agent-state.ts:5-31,136`, held by `corpus/agent-state.corpus.test.ts`.
- That check is one-sided: it calls a pid stale only when the process started **before** `startedAt - 3 s` (`:337`). A genuine reuse always starts **after** the worker launched, because the worker held the pid until it died. So the check passes every real reuse. **Ran:** sourcing `plot-worker-state.sh` and calling `plot_pid_is_current <pid of a sleep started now> 2026-10-24T08:00:00Z` returns 0 ("current"). This matches #2697: SAExtensionOrchestrator started on 2026-10-26, after a worker launched before PR #2634 merged on 2026-10-25.
- A second path ignores start time completely. When the shell answers anything but `running`, `deskWorkerPid` (`reap.ts:312-319`) falls through to `deskLoopAlive` over the manifest's `pid` and `wrapperPid`, with `pidAliveEverywhere` (`packages/fleet/src/shared/desk-loop.ts:40-47`, `process.kill(pid, 0)`). `desk-loop-alive.ts:66-70` documents that a recycled pid reads as alive and accepts it, because for `continueOnDesk` a wrong *not-alive* is the worse failure. The reaper borrows that direction, so even a corrected shell `ended` is overridden by `kill -0` here. The refusal text `worker alive (pid N)` (`reap.ts:714`) matches either path.
- Scope: the same one-sided comparison is in `plot-worker-state.sh:1443` (the second reader) and in `agentState`. Both feed the board and `/plot-reconcile`, which #2697 says show the desk as worked on. The plan names only the reaper.

**#2705 (read):** confirmed. `runClaimKind` keeps every empty claim whose plan line lacks `<!-- deferred:`/`<!-- moved:` (`claimDisposition`, `reap.ts:937-961`, reads `docs/plans/active/` only). A branch absorbed by a delivered plan is never in `active/`, so it is always `needs-judgment`. Release exits 0 at the release script's lines 2186-2189 when `origin/<br>` is absent and no manifest names it.

**#2714 (read):** confirmed, and the plan misses one of the two refusals. The desk is kept by `blocked-marker` before `no-merged-pr` ever shows, because `markerRecordsWork` (`reap.ts:654-664`) counts file-changing commits in `origin/<default>..HEAD`. The deferred branch holds 4 pushed commits, so the marker "records work" although nothing is local. The second `keep` line in the issue (`unlanded work — no merged PR`) is the kind-2 local-branch sweep (`reap.ts:870-905`, `firstBranchRefusal` in `sweepable.ts`), not the desk. A fix to `reapProblems` alone leaves the marker refusal in place, and leaves the local branch kept.

## 2. The approach against the code

**#2697.** "State it as a reading in the domain, not a check in the adapter" is right in direction. The slice must:

- Replace the one-sided comparison with an equality-within-skew comparison. Existing precedents are `continue-lock.ts:30-36` (`CONTINUE_LOCK_SKEW_MS`, `Math.abs(...) < 3000`) and `reader-election.ts:37-49`. One exported domain rule should serve agent-state, the reaper and continue-lock instead of a fourth copy.
- Anchor the comparison to a time that equals the process's own start. Manifest `startedAt` does not on first launch: `write_agent_manifest` stamps it when the manifest is written (dispatch script `:476-490`), before the worker starts. Only a relaunch restamps it with the pid (dispatch script `:1605`). A two-sided check against that stamp reads a slow-starting real worker as reused. Measure the gap, or record the process's own `ps -o lstart` at the point where the wrapper writes `pid` (the awk in the dispatch script at `:1576-1606`). The "launch sentinel" option in the plan's open question is the right one. Settle it in the plan.
- Stop `deskWorkerPid` from overriding the shell with `kill -0`. Keep `deskLoopAlive` unchanged for `continueOnDesk` and `readDeskLoop` (`desk-loop.ts:83-90`), whose direction is deliberate. Give the reaper a start-time-aware `alive` instead.
- Change the shell side (`plot-worker-state.sh:337`, `:1443`) together with `agentState`. `corpus/agent-state.corpus.test.ts` holds the pair, and on a disagreement the branch stops. The shell change is a comparison swap, so it costs about zero lines against `check-shell-lines.sh`. A launch-sentinel write in the dispatch script costs lines, and that cost must be paid elsewhere in the same change.

**#2705.** The reaper is the right home, not release. `runClaimKind` already deletes claim refs with `ctx.trees.deleteBranch` (`reap.ts:1009`) behind `firstClaimRefusal`. The slice adds readings to `ClaimRefReadings`: `remoteRef: 'absent' | 'present' | 'unknown'`, `checkedOut`, and `namedByManifest`. A local-only empty claim with no checkout and no manifest becomes sweepable. Putting the removal in release means new lines in a 4220-line shell script under the ratchet, and a second deleter beside the reaper. The plan's open question should be closed this way. Release may print a one-line pointer to `plot-reap.sh --yes` if the shell budget allows it.

**#2714.** Reuse what exists:

- `RefReadings.givenUp` (`reapable.ts:189-195`) already models "plan recorded `deferred:`/`moved:`". `FinishedWithReadings.ahead` / `FinishedWith.unpushedCommits` (`reapable.ts:357-388`, `:486-487`) already model "the desk holds commits its upstream does not". `deskIsResettable` (`:557`) is a precedent: it reads only what the desk holds.
- The deferred reading should come from the plan store (`plan-store-shell.ts:54,79`, `deferred` per slice; `slicesDeferred` in `entities/plan.ts:249`), not a second text grep like `claimDisposition`.
- The closed-unmerged PR condition is not needed for safety. With `givenUp`, a clean tree, `unpushed` empty against `origin/<branch>`, and the marker text saved to `refusals.tsv` (`reap.ts:740-760`), removing the checkout loses nothing, whatever the PR state. Requiring "closed unmerged" adds a host reading that `MergeReading` (`reapable.ts:13`) does not express. It would have to come from `Host.prState` (`ports/host.ts:219`) for both GitHub `CLOSED` and Bitbucket `DECLINED`. Either drop it, or name the port call and the Bitbucket state.
- `markerRecordsWork` must count against the branch's upstream, not `origin/<default>`, when the plan defers the slice. Otherwise the marker refusal stays first.
- Remote ref: the issue answers the plan's open question ("The work stays on the remote branch"), and `refDeletionProblems` puts `given-up` first (`reapable.ts:248-250`), so no controller may delete a deferred branch's remote ref. The plan's "removes the desk and its refs" must say "the checkout, its manifest, and the local branch; never the remote ref".

## 3. Safety

- **#2697, live desk deleted.** A two-sided check against manifest `startedAt` on a first launch reads a real worker as reused, and `reaper --yes` then runs `removeOnly` (`reap.ts:773`) under a live agent. Required: the comparison anchors to a recorded process start, and a start time that cannot be read keeps the desk. Note that `plot_pid_is_current` answers *stale* on an unreadable start (`:296-300`). That is safe for the board's `ended` but unsafe if the reaper adopts it. The reaper must read an unreadable start time as alive, as `continueLockHeld` does.
- **#2697, second loop started.** Changing `deskLoopAlive` itself would let `continueOnDesk` start a second worker beside a live one (#1294). The slice must not change it.
- **#2705, in-flight dispatch.** A dispatch creates the local claim commit and then pushes it. A reaper run between the two deletes the branch and makes the push fail. The local-only reading must exclude a branch younger than a bound, or one a live manifest or worktree names. The remote reading is a remote-tracking ref, which a missing fetch makes stale. The rule should take `unknown` when the reaper did not fetch, and refuse on it.
- **#2714, remote ref.** Covered above. Deleting `origin/feature/one-pr-reader-per-machine-and` destroys 4 commits of deferred work with no merged PR.
- **Ancestry.** The plan cites *One Answer To "Did This Land"*. The file it edits already decides `merge = 'merged'` from `ctx.refs.contains(...)` at `reap.ts:673` and `:870`. That is safe (every commit is reachable from the default branch), but none of the three slices may add a new ancestry-based decision. #2714 needs none: "head on remote" is a commit count against the upstream, not an ancestry verdict.

## 4. Slices against Changelog and acceptance

- Each slice has one observable result, and the three are independent in behaviour. All three edit `reap.ts`. They sit under three wave headings, so they run in order, which avoids conflicts. The order is acceptable. #2697 first is right, because a wrong liveness reading masks the other two on a real desk.
- The plan has no acceptance criteria beyond "each slice adds one test". Each slice needs a named test that fails on `4a1b8a5fa`:
  - #2697: a manifest whose `pid` is held by a process started after the launch record → the reaper does not report `worker alive`. Also a real worker started N s after the manifest stamp → still kept. Use the sentinel pattern from `test/reconcile/reap-agent-liveness.test.mjs`.
  - #2705: a local branch with one empty `plot: claim` commit, no origin ref, no worktree, no manifest → `would`/`deleted`. The same branch checked out, or named by a manifest → kept.
  - #2714: deferred slice, clean desk with root marker only, head equal to `origin/<branch>` → reaped, marker text saved, remote ref present afterwards. The same desk with one unpushed commit → kept.
- The Changelog line is fine. It should not promise "a controller removes each leftover … claim ref" for remote claim refs, which stay with release.

## 5. New defects

- **Corpus.** The plan says the corpus covers "any rule that `plot-reap.sh` or `plot-release-refs.sh` duplicates". `plot-reap.sh` is a 13-line launcher (read) and duplicates nothing. The real declared pair is `plot-worker-state.sh` ↔ `agentState` (`corpus/agent-state.corpus.test.ts`), which #2697 must change on both sides.
- **Arrow functions.** New domain rules go in `packages/domain/src` and must be arrows. The CI gate checks them there.
- **Bash 3.2.** The shell change for #2697 is a comparison on `[ ... ]` integers and stays 3.2-safe. `date -j -u -f` and `date -d` are both used already.
- **Bitbucket.** Only #2714 touches the host, and only if it keeps the closed-PR condition. Then it must read `DECLINED` as well as `CLOSED`.
- **Adopting repos.** Nothing here hardcodes a project. The deferred reading must come from the configured plan directory through the plan store, not from a `docs/plans/active` literal.
- **Board.** "Board impact: none" holds for #2705 and #2714. #2697 changes `agentState`, so board rows that show `running` for a reused pid change to `ended`. That is the fix, but the plan should state it.

## Amendments

1. Correct the file map: #2697 lives in `reap.ts:278-319`, `plot-worker-state.sh:301-338,1244-1252,1443` and `rules/agent-state.ts`. #2705 lives in `rules/sweepable.ts` (`ClaimRefReadings`, `claimSweepProblems`). Only #2714 is `rules/reapable.ts`.
2. Restate the #2697 cause. The start-time check exists but is one-sided (`started >= startedAt - 3 s`) and accepts every real reuse (ran). `deskWorkerPid` then overrides the shell with `kill -0` via `deskLoopAlive`. Fix both, and change shell and `agentState` together under the agent-state corpus.
3. Close the #2697 open question: compare against a recorded process start within a skew (reuse `continue-lock.ts`'s rule as one exported domain rule), not the manifest's first-launch `startedAt`. An unreadable start time keeps the desk in the reaper. Do not change `deskLoopAlive`.
4. Close the #2705 open question: the reaper removes the branch through `firstClaimRefusal` with new readings (remote ref absent, not checked out, no manifest names it, a fetch taken). Release stays unchanged or prints a pointer.
5. Close the #2714 remote-head question: never delete the remote ref (`given-up` refuses in `refDeletionProblems`). Remove only the checkout, the manifest and the local branch, and save the marker text.
6. For #2714, count `markerRecordsWork` and `unpushed` against `origin/<branch>`, and read `deferred` from the plan store. Drop the closed-unmerged PR condition, or name `Host.prState` and Bitbucket `DECLINED`.
7. Add per-slice acceptance tests that fail on `4a1b8a5fa`, including the two "still kept" counter-cases named in section 4.
8. Replace the corpus sentence: name `corpus/agent-state.corpus.test.ts` as the pair #2697 changes.
