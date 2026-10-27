# Panel round 1 — moderation

Subject: `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md` (plan PR #2758, issue #2757, tickets #2697, #2705, #2714).

Gate: `plot-panel.mjs check Position proceed,amend,reject` committed all four files. Reconcile: `unanimous amend rootcause,code,safety,tests`.

## What each juror looked at

- **rootcause** ran the shipped `plot-reap.mjs --dry-run` and `plot_worker_state` against a fixture repository with a bare origin, and reproduced all three defects: three pid-reuse desks, three local-only claim branches, and one deferred desk with a pushed head.
- **code** ran `plot_pid_is_current` against a freshly started `sleep` with an old `startedAt` (answer: current), and read the reap entry, the sweep and reap rules, the dispatch script and the plan store.
- **safety** ran nothing but greps and `gh issue view`; every claim is read from the code. It traced each destructive path (`worktree remove --force`, `branch -D`, remote ref deletion).
- **tests** ran one `node -e` check of `process.kill(1, 0)`, and read the existing reap and sweep tests whose fixtures encode today's behaviour.

## Agreed by all four

1. **The three defects are real.** rootcause reproduced all three; the others confirmed them from the code.
2. **The #2697 cause in the plan is incomplete.** A start-time check exists (`plot-worker-state.sh:301-337`), and the reaper discards its answer: `deskWorkerPid` (`reap.ts:312-319`) falls back to `deskLoopAlive` with `pidAliveEverywhere`, which is `kill -0` only (`desk-loop.ts:39-46`). `desk-loop-alive.ts:66-72` accepts a recycled pid on purpose for its continue callers.
3. **`deskLoopAlive` keeps its direction.** `continueOnDesk` and `readDeskLoop` prefer a false *alive*, because a false *not-alive* starts a second loop (#1294). The fix gives the reaper its own reading and does not change this rule.
4. **An unreadable start time reads as alive in the reaper.** A wrong *not-alive* removes a live desk with `worktree remove --force`.
5. **#2714 never deletes the remote ref.** The plan's "removes the desk and its refs" contradicts the issue ("The work stays on the remote branch") and `refDeletionProblems`, which refuses `given-up` first (`reapable.ts:235-254`). The Changelog line over-claims for the same reason.
6. **#2714 has two refusals, not one.** `blocked-marker` refuses because `markerRecordsWork` counts file-changing commits against `origin/<default>` (`reap.ts:653-667`), pushed or not. `no-merged-pr` refuses second. The plan names only the merge reading.
7. **"Head on the remote" is the existing `unpushed` reading** (`reap.ts:349-376`), not a new git reading and never ancestry.
8. **The #2705 removal belongs to the reap entry, not `plot-dispatch.sh --release`.** `runClaimKind` already calls `deleteBranch` (`reap.ts:1009`); a `--release` change costs shell lines under `check-shell-lines.sh`.
9. **The corpus sentence is wrong.** `plot-reap.sh` is a 13-line launcher and duplicates nothing. The real pair is `plot_pid_is_current` and `agentState` (`corpus/agent-state.corpus.test.ts`).
10. **"Each slice adds one test" is not acceptance.** Each slice needs a test that fails on `4a1b8a5fa` and opposite arms that keep the neighbouring live case.

## Disagreements

**1. The #2705 cause and fix.** rootcause measured the cause: `claimDisposition` (`reap.ts:942-961`) reads only `docs/plans/active/`, and both reported branches carry `<!-- deferred: … -->` in a Released plan (`2026-08-20-waiting-on-you-says-what-kind-of-waiting.md:361-362`, confirmed on main). Its fix reads the annotation from every plan through the plan parser and adds no new rule kind. code, safety and tests treat the branch as "local-only and unannotated" and add readings (`remoteRef`, `checkedOut`, `namedByManifest`) so that any local-only empty claim becomes sweepable. That wider rule races a dispatch between its local claim commit and its push (`agent-loop.ts:723`, `auto-design.ts:734-741`), which all three then guard with more readings. The evidence supports rootcause: the narrower fix removes both measured branches and keeps the annotation gate that makes deletion safe today.

**2. The #2697 anchor for the start-time comparison.** code, safety and rootcause agree that a real reuse starts *after* the worker launched, so today's one-sided check (`started >= startedAt - 3 s`, `:335-337`) passes it (code ran this). They want an equality window against a start time recorded for each pid, reusing `isRecorded` (`implement-lock.ts:34-65`) or `continue-lock.ts`. tests proposes the manifest's `startedAt` against `ps -o lstart`, and an opposite arm in which a process started one hour *after* `startedAt` "still reads alive". That arm pins the #2697 defect as correct behaviour. The evidence supports the three: manifest `startedAt` is the dispatch stamp (dispatch script `:476-490`), not the process's start, and a two-sided check against it reads a slow-starting real worker or a live `wrapperPid` as reused (safety, `manifest-stamp.ts:50,87-92`). tests' future-`startedAt` fixture still has value: it fails today through the `kill -0` fallback alone.

**3. #2714: the local branch.** code removes the checkout, the manifest and the local branch. rootcause allows "at most the local branch ref". safety keeps the local branch: it is the only local copy of the commits when the tracking ref is stale, and kind 2 deletes local branches only when merged. Keeping it leaves the kind-2 row `unlanded work — no merged PR` in every report, which is the second `keep` line in #2714. So the choice is between a clean report and a local safety net. Deleting the local branch is safe only when `unpushed` is `[]` against a freshly fetched `origin/<branch>`.

**4. #2714: the closed-unmerged PR condition.** rootcause and code drop it: with `givenUp`, a clean tree and nothing unpushed, removing the checkout loses nothing whatever the PR state, and the condition needs a host reading `MergeReading` lacks. safety and tests keep it and add "no open PR" (`RefReadings.openPr`), so a resumed slice with a new open PR keeps its desk. Both sides need the open-PR keep arm; the dispute is only whether *closed unmerged* must also be read. Dropping it removes a host call and the Bitbucket `DECLINED`/`SUPERSEDED` mapping; safety's open-PR case holds either way.

**5. #2714: `deferred:` versus `moved:`.** code reuses `givenUp`, which admits both. safety admits only `deferred:`, because a `moved:` slice may continue on the same branch under another plan. See the blind spot: the text does not separate the two meanings.

**6. Scope beyond the reaper.** rootcause and code add `registry.ts` `deskPidAlive`/`rowState` and the shell's second reader (`plot-worker-state.sh:1443`) to #2697, because the board shows the same desk as worked on. safety and tests scope the change to the reaper, or require each other caller to accept the new direction. tests adds one assertion that `--stop` does not signal a reused pid.

## Shared blind spot

All four treat the annotation word as the meaning. safety excludes `moved:`; code reuses `givenUp`; rootcause reads `deferred:` from every plan. On main, 8 of 43 `<!-- deferred: … -->` annotations say "moved to" another plan, and the two branches #2705 reports are among them (`deferred: moved to a-row-is-a-tuple … absorbed by …`). Only 7 annotations use `<!-- moved: … -->`. So safety's rule "only `deferred:` qualifies" admits exactly the moved slices it means to exclude, and rootcause's "read every plan" reads a slice that moved and may continue on the same branch as given up. The claim kind tolerates this, because it deletes only wholly empty claims. The #2714 desk kind does not: it removes a checkout. The plan must say which reading decides "given up" (the plan parser's slice field, the receiving plan's own line, or the annotation word), and #2714 must keep a desk whose branch an active plan still schedules.

## Named amendments for the plan

1. Correct the file map: #2697 in `reap.ts:278-319`, `plot-worker-state.sh:301-338,1213-1219,1443` and `rules/agent-state.ts`; #2705 in `rules/sweepable.ts` and `claimDisposition`; only #2714 in `rules/reapable.ts`.
2. Restate the #2697 cause: the one-sided start-time check, the bare `.plot-worker.pid` path, and the `kill -0` fallback in `deskWorkerPid`.
3. #2697 mechanism: an equality window against a start time recorded for each pid at each pid write, as one exported domain rule extracted from `implement-lock.ts`/`continue-lock.ts`. A pid with no recorded start keeps `kill -0`. An unreadable start reads alive. `deskLoopAlive` stays unchanged. Change shell and `agentState` together under the agent-state corpus, or retire the shell copy.
4. Decide disagreement 6: reaper only, or also `rowState` and `--stop`.
5. #2705: state the measured cause (`claimDisposition` reads only the Active index) and read the annotation from every plan through the plan parser and the configured `Plan directory`. Drop the `--release` option. If the wider local-only rule is kept, add the manifest, checkout, fetch and age guards.
6. #2714: remove the checkout and its manifest; never the remote ref. Decide disagreement 3 for the local branch. Save the marker text to `refusals.tsv`. Count `markerRecordsWork` against `origin/<branch>`. Lift only `blocked-marker` and `no-merged-pr`.
7. #2714: decide disagreement 4; in either case, keep the desk on an open PR, an unreachable host, a live worker, a dirty path besides the marker, and an unpushed commit.
8. Define "given up" against the blind spot above, and keep a desk whose branch an active plan still schedules.
9. Fix the Changelog line: the remote ref of a deferred branch stays.
10. Replace the corpus sentence with `corpus/agent-state.corpus.test.ts`.
11. Per-slice acceptance: a failing-today test and its opposite arms. Name `sweep.test.mjs:294-308`, whose fixture changes (push the claim) rather than its assertion, and the report-text tests `quiet-kinds-render.browser.test.ts:159` and `sweep.test.mjs:305` if wording changes.
