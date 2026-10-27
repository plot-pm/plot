# Juror verdict — rootcause

Lens: rootcause. I reproduced each defect in a fixture repository under my scratchpad (`rootcause-fx/`, bare `origin.git` plus a clone, removed with `trash` afterwards) by running the shipped bundle `pmain/skills/plot/scripts/board/plot-reap.mjs --dry-run` and `plot_worker_state` from `pmain/skills/plot/scripts/plot-worker-state.sh`. Line numbers cite `pmain` (`4a1b8a5fa`).

Position: amend

## Summary

All three defects reproduce. Two of the three causes the plan names are wrong or incomplete, and the real causes point to smaller fixes than the plan describes. One part of the approach (#2714 "removes the desk and its refs") contradicts an existing rule and the issue text, and would delete a ref the estate deliberately keeps.

## 1. The problem

### #2697 — reused pid reads as a live worker

**Reproduced (ran).** Fixture: three detached desks, each with `.plot-worker.pid` naming a live unrelated `sleep 600`.

| desk | records | `plot_worker_state` (ran) | reaper `--dry-run` (ran) |
|---|---|---|---|
| d1 | pid file only, no manifest, no wrapper file | `running` | `worker alive (pid 43826)` |
| d2 | manifest `startedAt` 2 h BEFORE the process started, wrapper file present | `finished` (after the 30 s grace; `running` inside it) | `worker alive (pid 43826)` |
| d3 | manifest `startedAt` AFTER the process started (reuse detectable) | `ended` | `worker alive (pid 43826)` |

**The plan's cause is incomplete.** The plan says "the liveness test asks only whether the recorded pid exists". The primary reading does more (read): `plot_worker_state` compares the manifest `startedAt` (`plot-worker-state.sh:301-336`, called at `:1243`) and asks for an agent descendant when a wrapper file exists (`:992-1034`). The d2 and d3 rows show the shell answering correctly while the reaper still keeps the desk. The cause the reaper adds is its own fallback:

- `packages/board/src/server/entry/reap.ts:312-319` (`deskWorkerPid`): when `processWorkerPid` answers `''` (shell said `finished`/`ended`/`none`), it re-asks `deskLoopAlive` over the manifest's `pid` and `wrapperPid` with `pidAliveEverywhere` (`packages/fleet/src/shared/desk-loop.ts:39-46`), which is `process.kill(pid, 0)` only. `deskLoopAlive` documents that it accepts a recycled pid (`packages/domain/src/rules/desk-loop-alive.ts:68-72`), because its first caller (continue) prefers a false *alive*. The reaper borrowed that direction without the identity check. This overrides a correct `ended` from the shell (d3).

Two further causes with the same shape (read):

- The bare `.plot-worker.pid` fallback (`plot-worker-state.sh:1213-1219`) skips every identity check when no manifest names the desk and no wrapper file exists (d1). Most desks on this machine have no manifest: 8 desk directories against 2 manifests in `.plot/agents` (ran `ls`).
- `plot_pid_is_current` is a lower bound only: `proc_epoch >= manifest_epoch - 3` (`:335`). A pid reused AFTER launch — the #2697 incident, where the reusing process started about 20 minutes before the run — passes it. Only the agent-descendant check caught d2, and only after the 30 s grace and only because a wrapper file existed.

**Other sites with the same cause (read):**

- `packages/fleet/src/shared/registry.ts:151-169` `deskPidAlive` (`kill -0` on `.plot-worker.pid`) feeds `rowState` (`:140-142`), which turns a shell `finished` into `running`. This is why the issue says "the board shows the same desk as worked on". The plan names only the reaper.
- `reap.ts:1043` (`runDirtyKind`) uses the same `deskWorkerPid`, so a dirty tree is attributed to a dead worker.
- `desk-loop.ts:82-89` `readDeskLoop` (continue path) — deliberately reuse-tolerant; out of scope, but a shared identity rule must not change its direction.

**An identity mechanism already exists (read):** `ProcessSighting` and `isRecorded` in `packages/domain/src/rules/implement-lock.ts:34-65`, copied in `continue-lock.ts:26-35`: a pid matches only when the process now holding it started within 3 s of the recorded start time. This is an equality window, not a lower bound. It needs the process's own start time recorded when the pid is written; the manifest's `startedAt` is the dispatch stamp, not a per-pid start time.

### #2705 — local-only empty claim branch

**Reproduced (ran).** Fixture: three local-only branches, each one empty `plot: claim …` commit, no origin ref.

| branch | `deferred:` annotation lives in | reaper `--dry-run` (ran) |
|---|---|---|
| `bug/active-claim` | a plan linked from `docs/plans/active/` | `would … abandoned claim (plan says deferred/moved)` |
| `bug/absorbed-claim` | a Released plan, linked only from `delivered/` | `keep … needs judgment` |
| `bug/unannotated-claim` | nowhere | `keep … needs judgment` |

**The plan's cause is wrong.** The plan and the issue frame this as "no controller removes the branch" and offer `plot-dispatch.sh --release` as a home. A controller already removes it: `runClaimKind` (`reap.ts:963-1023`) calls `ctx.trees.deleteBranch` for an empty claim whose plan line says `deferred:`/`moved:`. It failed on the two measured branches because `claimDisposition` (`reap.ts:941-961`) reads only the **Active index** (`activeDir`, resolved at `:1096-1098`). Both measured branches carry `<!-- deferred: moved to a-row-is-a-tuple … -->` at `docs/plans/2026-08-20-waiting-on-you-says-what-kind-of-waiting.md:361-362` (read), and that plan is Released, so the reaper never sees the annotation. The fix is to read the annotation from every plan, not to add a new kind or teach `--release` local refs.

`--release` is the wrong home (read): `plot-dispatch.sh:2186-2190` defines a claim as an origin ref or a manifest, and its scope is the remote lock. Adding local-ref deletion there costs shell lines under `check-shell-lines.sh` and moves a decision into shell, against "Reduce shell, grow the domain".

`claimDisposition` is also a plan-annotation parser written in a board entry with `line.includes(...)` (`reap.ts:957-959`). `plot-release-refs.sh:195-201,371-372` reads the same `deferred` flag from the plan parser. That is two readers of one annotation; the fix should use the parser's `deferred` field.

### #2714 — deferred slice, closed PR, pushed head

**Reproduced (ran).** Fixture desk on `feature/deferred-slice`: one real commit pushed to origin, head equal to `origin/feature/deferred-slice`, `deferred:` annotation in an active plan, untracked `PLOT-BLOCKED.md`, dead worker pid. The reaper keeps it with `PLOT-BLOCKED marker — needs a person`; the local-branch kind keeps it with `unlanded work — no merged PR`.

**The plan names half the cause.** Two refusals hold the desk, not one: `blocked-marker` (`reapable.ts:122-124`) and `no-merged-pr` (`:131-133`). The marker refuses because `markerRecordsWork` is true whenever the branch holds file-changing commits against `origin/<default>` (`reap.ts:657-667`), even when every such commit is on the remote. The plan's Approach 3 changes only the merge reading.

## 2. The approach against the code

- **#2697.** The fix sits in two places the plan does not name: remove or guard the `deskLoopAlive` fallback in `reap.ts:312-319`, and fix `rowState`/`deskPidAlive` in `registry.ts`. The domain reading should reuse `ProcessSighting`/`isRecorded` (extracted from the two lock rules, not copied a third time). It needs a per-pid start time recorded beside `pid` and `wrapperPid` when they are written; the slice must say which writer records it. Answering Open Question 1: start time against a recorded per-pid start, with the existing 3 s skew. Command-line matching is weaker: a relaunched loop has the same command line.
- **#2705.** Read `deferred`/`moved` from every plan through the plan parser. No new rule kind is needed; `firstClaimRefusal` already returns null for `abandoned`. Answering Open Question 2: the reap entry, which already deletes.
- **#2714.** The reaper already reads plan annotations (`claimDisposition`), so "slug-blind" is not a new breach. The rule needs a `givenUp` reading on `TreeReadings` and a marker exemption when `givenUp` and `unpushed` is `[]`. `unpushedCommits` (`reap.ts:349-375`) already measures pushed-ness for an unmerged branch, so no new git reading is needed. The marker text must be saved to `.plot/state/refusals.tsv` before removal, as `reap.ts:745-760` already does for `refused-empty`.
- **Corpus sentence is moot.** The plan says the corpus covers rules `plot-reap.sh` duplicates. `plot-reap.sh` is a 13-line launcher (read) and duplicates nothing. The duplicate that matters is `plot_pid_is_current` in `plot-worker-state.sh` against any new domain pid-identity rule. That pair needs a corpus test, or the shell side must call the domain.

## 3. Safety

- **Ref deletion (blocking).** Approach 3 says "the reap entry removes the desk and its refs". `refDeletionProblems` puts `given-up` first precisely so that no merge state overturns it (`reapable.ts:213-221,235-237`), and `plot-release-refs.sh:326` prints "a given-up branch keeps its ref". Issue #2714 says "The work stays on the remote branch." Deleting the remote ref destroys the only copy of four commits of deferred work (`one-pr-reader-per-machine-and.md:197`), which `git worktree add` cannot restore. The slice must remove the checkout only. It must never touch `origin/<branch>`. Open Question 3 is already answered by existing code; the plan must state it.
- **Closed is not terminal.** A closed PR can be reopened, and Bitbucket reports `DECLINED` (normalised in `bitbucket-pr-reading.ts:88`) and `SUPERSEDED` (not normalised; read). The reap stays safe only because removing a checkout whose head is on the remote is reversible. So the gate must be `givenUp && unpushed == [] && dirty == '' && no open PR`. The closed-PR reading adds nothing once those hold and could be dropped. If it is kept, `unreachable` must keep the desk.
- **Pid identity direction.** A wrong *not-alive* reaps a live desk. Any new identity reading must answer *alive* when the start time cannot be read (`isRecorded` already does: `alive === null` and `startedAt === null` both hold). A manifest whose `pid` is rewritten for a new agent pass without a matching start time would read as reused and reap a working desk. The slice must prove the start time is recorded at every pid write.
- **#2705.** Deleting an empty claim commit loses no content. If the fix also removes unannotated local-only claims (the issue's wider option), it races a dispatch that has made its local claim commit but not yet pushed. Keep the annotation gate, or add `ORPHANED_CLAIM_AGE_MS` and a no-desk/no-manifest check.

## 4. Slices, Changelog, acceptance

The three slices are independent and each ships an observable change in `plot-reap.sh --dry-run` output. Order does not matter. The plan states no acceptance per slice beyond "one test". Each needs a failing-today test, and my fixtures give them:

- #2697: a desk whose manifest pid is live but started after `startedAt` + skew, and one where the shell reads `ended`; today both print `worker alive`. Add a board row test for `rowState`.
- #2705: an empty local claim annotated `deferred:` in a plan linked only from `delivered/`; today `keep … needs judgment`, expected `would`.
- #2714: the desk above; today `keep … PLOT-BLOCKED marker`; expected reapable with the marker text saved, and `origin/<branch>` still present after `--yes`.

The Changelog line says "a controller removes each leftover desk or claim ref". After the amendment it must say the remote ref of a deferred branch stays.

## 5. New defects

- `check-shell-lines.sh`: a `--release` change adds shell lines; the reap-entry route adds none.
- Bash 3.2: no new shell is needed if the work stays in TS.
- Layering: `claimDisposition` parsing in a board entry is existing domain logic outside the domain; this plan touches it and should move it.
- Adopting repos: reading every plan (not only Active) must use the configured `Plan directory`, not a hard-coded path.
- Bitbucket: `SUPERSEDED` is not mapped to `CLOSED`.

## Amendments

1. **#2697 cause:** name `reap.ts:312-319` (`deskWorkerPid` falling back to `deskLoopAlive` with `kill -0`), the bare `.plot-worker.pid` path (`plot-worker-state.sh:1213-1219`), and the lower-bound-only `plot_pid_is_current` (`:335`) as the causes. Add `registry.ts` `deskPidAlive`/`rowState` and `reap.ts:1043` to the scope.
2. **#2697 mechanism:** extract and reuse `ProcessSighting`/`isRecorded` (`implement-lock.ts`, `continue-lock.ts`). Record each pid's own start time where `pid`/`wrapperPid` are written. Unreadable means alive. Name the corpus pair with `plot_pid_is_current`, or retire the shell copy.
3. **#2705 cause:** replace "no controller removes it" with the measured cause: `claimDisposition` reads only the Active index, so a `deferred:` line in a Released plan is invisible. Fix in the reap entry by reading every plan through the plan parser. Drop the `--release` option.
4. **#2714 scope:** remove "and its refs". Only the checkout (and at most the local branch ref) is removed; `origin/<branch>` stays, consistent with `refDeletionProblems`' `given-up` and `plot-release-refs.sh:326`. Update the Changelog line to match.
5. **#2714 rule:** name both refusals (`blocked-marker` and `no-merged-pr`). Gate on `givenUp && unpushed == [] && no uncommitted work && no open PR`, and keep the desk on any `unknown`/`unreachable`. Save the marker text to `refusals.tsv` before removal.
6. **Corpus sentence:** delete the `plot-reap.sh` duplicate claim; it is a launcher.
7. **Acceptance:** add one failing-today test per slice, as listed in section 4.
