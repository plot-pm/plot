# Seams juror: the-plan-walk-moves-into-the

Position: amend

## Summary

The plan takes the #2979 panel's rules and caller list correctly, and its Approach step 3 already sorts the 19 inputs. Three seams are wrong or missing. First, fleetd does not reach the scan through `Refs.pulse()`: it calls `scanOnce`, which streams `plot-fleet-scan.sh --stream` through the `Scripts` port (`packages/fleet/src/shared/fleet-scan.ts:717`). A cache "in fleetd's memory" therefore has no caller until `scanOnce` calls the walk in-process, and no slice says so. Second, the walk needs more ports than `PlanStore`, `Refs` and `Trees`, and most of its verdict arithmetic already exists as domain rules that the shell calls today; the plan names none of them. Third, the caller list omits three modes, two writes, and one ordering dependency on #2979 slice 3.

## What I executed and what I only read

Executed (read-only), on the worktree at `380c5136d` and on `origin/main` at `2a29f8130`: `git show` of the #2979 panel files and the approved plan; `git grep` for every caller of the scan in `skills/`, `scripts/` and `packages/*/src`, and for every corpus file that reaches it; `grep` over the scan's flag parser (`:276-312`), its sourced files (`:259`, `:261`, `:327`) and its calls into domain bundles; `wc -l` of the scan (5438); a timed `git for-each-ref` and `git ls-tree -r origin/main -- docs/plans` in the main checkout (both 0.00 s real at load 7.87; 454 refs, 1244 tree entries); `git rev-parse --is-shallow-repository` (false); `git for-each-ref refs/replace` (0); a loop over unfinished plans on `origin/main` that mention the scan (only #2979); `gh pr list --state open` (only #2981 and the release PR). I ran no scan, no test, no fleet or board command.

Only read: `packages/domain/src/ports/refs.ts:391-400`, `packages/domain/src/ports/trees.ts`, `packages/board/src/server/entry/ask.ts:111-138`, `skills/plot/scripts/plot-fleetctl.sh:310-345` and `:415-432`, `packages/domain/corpus/production.ts`, `scripts/check-shell-lines.sh`, and the export lists of `rules/eligible.ts`, `rules/pulse.ts`, `rules/verdict.ts`, `rules/agent-state.ts`, `rules/desk-lifecycle.ts`.

## 1. Motivation

- The measurements hold. The scan is 5438 lines. `origin/main` holds 1244 entries under `docs/plans` today (the plan says "about 1240"). Both change-detection reads took 0.00 s at load 7.87, so "under 0.2 s" is conservative.
- The shallow and `refs/replace` guards cost nothing on this estate: the repository is not shallow and `refs/replace` is empty. The guards still matter for an adopting repository with a shallow CI clone.
- The input table is cited on "branch `idea/the-fleet-scan-re-reads-what`". That branch no longer exists on the remote (`git ls-remote` returns nothing). The file is on `origin/main` at `.plot/panels/the-fleet-scan-re-reads-what/safety.md`. Amend the citation.

## 2. Approach: the seams

### fleetd does not call `Refs.pulse()`

`Refs.pulse()` has one production caller, `adapters/sprint-scope-ref.ts:103`. fleetd calls `scanOnce`, which runs `world.scripts.stream(FLEET_SCAN, ['--stream'], …)` with `PLOT_TERMINAL_CACHE`, `PLOT_PR_LISTING` and `PLOT_SCAN_RECORD` (`fleet-scan.ts:717-735`). The board fallback calls the same `scanOnce` with `record: false`. So:

- The Launcher slice ("`Refs.pulse()` calls the domain") changes the sprint-scope reading and leaves fleetd spawning the shell.
- If the launcher `exec`s a node bundle, fleetd still starts a fresh process each beat, and an in-memory cache dies with it. The cache pays only when `scanOnce` calls the walk in-process.
- The Cache slice waits on the Walk slice, and the Walk slice has no production caller. The cache therefore has no process to live in until the Launcher slice, which comes after it.

Amendment: name `scanOnce` (`fleet-scan.ts:717`) as the caller that moves first, in-process, and put the cache in the same slice or after it. Say whether the board fallback also runs in-process; if it does, it holds a second cache or runs cold, and the plan must say which.

### The walk needs more ports, and reuses rules that exist

`Trees` in this repository is the worktree port (`ports/trees.ts:14`: `list`, `forBranch`, `isClean`, `markers`, `quietSeconds`), not git trees. Plan blobs and modes come from `Refs` (`listBlobs`, `readBlobs`, `entriesAt`). The walk also reads inputs that none of the three named ports answers:

- the PR listing and per-branch `pr-state` for callers with no carried listing (the shell calls `plot-host.sh pr-list` at `:1067`, `:1084` and `pr-state` at `:1380`): the `Host` port;
- worker pid, `.plot-worker.exit`, registry entries and the process table (safety rows 16 to 18): the `Processes`, `Desk` and `Agents` ports;
- `remote.origin.url` and the host backend (safety row 11).

Amend Approach step 1 to name every port, or to state that the controller reads these as values and hands them in, as the layering note in `CLAUDE.md` describes.

The shell already asks the domain for most of its verdicts: `plot-merge-subject.mjs` (`:3680`), `plot-branch-state.mjs` (`:4171`) and `plot-verdicts.mjs` (`:4640`, and `outlook` at `:5095`). The domain also holds `sliceVerdicts` and `waitVerdict` (`rules/eligible.ts:157`, `:257`), `agentState` (`rules/agent-state.ts:136`), `deskState` (`rules/desk-lifecycle.ts:157`), `scan-listing.ts`, and the `FleetReading` shape that `rules/pulse.ts` reads. Amend the Walk slice to say it composes these rules and adds no verdict arithmetic of its own. The new code is the enumeration and the reading, and the corpus pair then compares only that.

### Callers and outputs the list omits

The plan's list matches the #2979 seams table. The flag parser (`plot-fleet-scan.sh:276-312`) has more:

- `--why-nothing` (`:295`), which borrows `--next`'s population;
- `--loose` (`:282`);
- `--offline`/`--no-fetch` (`:281`), whose contract is narrower than its name: `--offline --next` still asks the host (`:549-562`). A walk that reads `--offline` as "no host" changes `--next`'s answer.

The scan also writes, and a launcher must keep each write or move it with its owner:

- the bridge `.plot/state/last-pulse.json` on `--stream` (unless `PLOT_SCAN_RECORD=0`) and on `--log-pulse` (`:216-227`, `:288`, `:307`);
- one pulse line appended to each reported plan's `## Notes` under `--log-pulse` (`:34`). That is a write to a tracked plan file.

`plot-ask.mjs board` and `fleet` reach the scan through the board's refresh (`entry/ask.ts:132-136`), so they inherit whatever the board fallback does.

`plot-fleetctl.sh` recognises a scan by a `bash` argv whose path ends in `plot-fleet-scan.sh` (`:337`, `:426`). An in-process walk produces no such process, and a launcher that `exec`s `node` produces a node argv that the recogniser classifies as nothing. Amend the Launcher slice to say what `plot-fleetctl.sh --status` and `--stop` show for a scan after the change, and to update `:337` and `:426` with it.

### Sourced shell stays

The scan sources `plot-worker-state.sh` (`:259`), `plot-tmp.sh` (`:261`) and `plot-default-branch.sh` (`:327`). `plot-worker-state.sh` is also sourced by `plot-dispatch.sh`, `plot-fleetctl.sh` and `plot-quiet-stretch.sh`, so it does not move with the walk. Its domain twin `agentState` is already held equal by `agent-state`, `desk-waits-free` and `tree-reading` corpus pairs. The plan should say these three pairs stay, and that `plot-plan-meta.sh` stays as the `plan-store` pair's shell side while `plot-dispatch.sh` still calls it.

### Ordering with #2979

#2979 slice 3 (`feature/the-subject-walk-skips-settled-plans`) may change the scan's output for settled plans: its done-condition holds the byte comparison only "for every plan that is not settled". The Walk slice's corpus pair compares against that output. Amend: add `<!-- waits: feature/the-subject-walk-skips-settled-plans -->` to the Walk slice, and take that slice's recorded reader list as the walk's settled-plan rule.

#2979 slice 2 (`feature/a-fleetd-whose-scans-start-owns-the-scan`) records when each scan attempt starts and ends. An in-process walk must keep writing that record, or `fleetOwnsScan` reads every in-process beat as "no scan started" and hands the scan to the board. The Launcher slice must name this.

No other unfinished plan or open PR touches the scan.

### Bitbucket and offline

The plan says neither word. On Bitbucket the merge-subject form differs (`Merged in <branch> (pull request #N)`), and the shell's own listing path serves every caller that has no carried listing. The corpus runs with no host token (`corpus/no-host-token.ts`), so no corpus pair proves the Bitbucket listing path. Amend the Walk slice to require the pinned-clone comparison on a Bitbucket-form fixture for merge subjects (as `merge-subject-bitbucket.corpus.test.ts` does for the reconcile scan), and the Launcher slice to name which component reads the listing for `--next`, `--list-eligible` and `--json` on each host. fleetd's TypeScript listing (`readGithubListing`, `readBitbucketListing`) is the obvious candidate.

## 3. Slices

- Walk: can ship and be reviewed alone as a domain workflow plus a corpus pair. It has no done-command. Proposed: `pnpm --filter @plot-pm/domain exec vitest run corpus/plan-walk.corpus.test.ts`, which compares the walk's reading with `plot-fleet-scan.sh --offline --json`, both normalised with `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'`, on one pinned clone (the #2979 normaliser).
- Cache: as ordered, it ships a cache with no process to hold it. Merge it into a slice that also moves `scanOnce` in-process, or order it after that.
- Launcher: too large for one review. It changes `Refs.pulse()`, `scanOnce`, the board fallback, nine shell modes, two writes, `plot-fleetctl.sh` recognition and eight corpus files. Split it: (a) fleetd and the board fallback in-process; (b) `--json`, `--next`, `--list-eligible`, `--why-nothing`, `--slice-names` and `<slug>` through one node entry; (c) `--log-pulse` and its writes; (d) the shell walk removed and the corpus pairs retired.
- The Notes hold three done-conditions and none is a command. Attach each to a slice with its command.

## 4. What would break, and how we would know

- fleetd keeps spawning the shell after the Launcher slice, and the CPU does not drop. Proof: a test over `scanOnce` with a `Scripts` fake that fails on any `plot-fleet-scan.sh` call.
- `fleetOwnsScan` hands the scan to the board on every in-process beat. Proof: `pnpm --filter @plot-pm/domain exec vitest run test/scan-owner.test.ts` with an in-process attempt record.
- `--offline --next` stops asking the host and hands out a branch whose PR merged. Proof: the existing `eligible` corpus pair run under `--offline --next`.
- `/plot-pulse` stops writing the bridge or the plan's pulse line. Proof: a test of `--log-pulse` that reads `last-pulse.json` and the plan's `## Notes` after one run.
- `plot-fleetctl.sh --stop` leaves a scan running. Proof: the fleetctl contract test that classifies process argv, extended with the new argv.

## 5. Open Questions

- Q1 (which inputs stay every beat): answerable now, and Approach step 3 already answers it. Rows 1 and 11 to 19 of the safety table are every beat; rows 2 to 5, 7, 9 and 10 take an oid key; row 6 (plans that exist only on a prefix branch) is recomputed whenever any prefix ref moves; row 8 (`waits:` edges) is safe because verdicts are derived over all readings. Close the question and copy the table into the plan.
- Q2 (duplicate for one release, or same sprint): answerable in part. The duplicate must live as long as any caller mode still runs the shell walk, because the corpus pair is the only proof the two agree. With the Launcher split above, the shell walk lives until slice (d), and the release boundary does not matter.
- Q3 (line count): not answerable until the Launcher's scope is fixed, but a target exists: `plot-approve.sh` is a 12-line launcher. The scan cannot reach that while it keeps `--log-pulse`'s plan writes in shell. Name the target as "a launcher of the size of `plot-approve.sh`" and record the measured number in slice (d).
- Q4 (which corpus files retire): answerable now. Eight test files reach the scan: `branch-state`, `branch-state-waits`, `branch-state-waits-open-pr`, `eligible`, `finished-estate`, `refs`, `scan-listing` and `tracked-branches`, through `production.ts`'s `readFleetScan`, `readListEligible` and `readSliceNames`. The plan's "eight" is right only if `finished-estate` is one of them, and the #2979 seams table listed `production.ts` instead. When the shell walk becomes a launcher to the domain walk, each pair compares the domain with itself. So every one of the eight retires by name in slice (d), and the walk's own pair (Walk slice) carries the comparison while both walks exist. `scan-listing` and `tracked-branches` compare fleetd's listing against the shell's; they retire only if the shell's listing code goes, and stay otherwise.

## 6. Amendments before approval

1. Name `scanOnce` (`fleet-scan.ts:717`) as the caller that moves in-process first. Put the cache in or after that slice. Say what the board fallback does with the cache.
2. Name every port the walk reads (`Host`, `Processes`, `Desk`, `Agents` beside `PlanStore`, `Refs`, `Trees`), or state that the controller hands those readings in as values.
3. State that the walk composes `sliceVerdicts`, `waitVerdict`, the branch-state, merge-subject and verdicts rules, `agentState` and `deskState`, and adds no verdict arithmetic.
4. Add `--why-nothing`, `--loose`, the `--offline --next` host ask, the bridge write and the `--log-pulse` plan write to the caller contract. Say what `plot-fleetctl.sh` recognises after the change.
5. Add `<!-- waits: feature/the-subject-walk-skips-settled-plans -->` to the Walk slice. Require the in-process walk to keep #2979 slice 2's scan-attempt record.
6. Split the Launcher slice into the four parts in section 3. Give each slice a done-command.
7. Cover Bitbucket: a Bitbucket-form merge-subject fixture in the Walk slice's pair, and a named listing reader per host for non-fleetd callers.
8. State that `plot-worker-state.sh`, `plot-plan-meta.sh` and their corpus pairs stay.
9. Cite the input table on `origin/main`, not on the deleted idea branch. Close Q1 and Q4 with the answers above.
