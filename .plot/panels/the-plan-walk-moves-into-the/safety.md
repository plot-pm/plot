# Safety juror: the-plan-walk-moves-into-the

Position: amend

## Summary

The plan carries the key rules of the #2979 safety verdict into its Approach almost word for word: oid reads, no cached `unknown`, parser version and config digest in the key, shallow and `refs/replace` refusal, no cache shared with the dispatch re-check, and "the dirty set bounds reads only". The Notes carry the fixture list and the race test. Three things are still missing. First, the rules are prose in the Approach and in the Notes, and no slice owns them as done-conditions. Second, the existing ports the walk must read through break three of those rules today: they read by ref name, they parse without `--prefixes`, and they answer an unreadable ref as "no plans". Third, moving the walk into fleetd's process creates hazards the shell child did not have: no beat-wide kill, an event loop the walk can block, a bundle that does not reload while the parser script on disk does, and a cache with no bound. The slice order also turns the walk and the cache on in production in the same step. The design is right. The plan needs these amendments before approval.

## What I executed and what I only read

Executed, read-only, on 2026-10-31 at load 7.9 to 8.1:

- In the main checkout: `git rev-parse --is-shallow-repository` gives `false`, and `refs/replace` holds 0 refs. `refs/remotes/origin` holds 11 refs and `refs/heads` holds 58.
- `git ls-tree -r origin/main -- docs/plans` gives 1244 entries, of which 623 are symlinks (mode 120000). The 621 regular blobs hold 7,363,418 bytes.
- `git for-each-ref` over both namespaces and `git ls-tree -r origin/main -- docs/plans` each report 0.00 s real under `/usr/bin/time -p`. Reading all 623 symlink targets through one `git cat-file --batch` costs 0.14 s real. The per-beat snapshot is cheap, as the plan says.
- In the last 24 hours `origin/main` gained 182 commits and 35 merges, and the plans gained 53 distinct new blob oids. In the last 7 days they gained 665 distinct new blob oids.
- `git show origin/main:.plot/panels/the-fleet-scan-re-reads-what/{safety,panel,layering}.md` read. `git ls-tree origin/idea/the-fleet-scan-re-reads-what` fails: the branch the plan cites in its Motivation does not exist. The verdicts are on `origin/main`.
- `wc -l`: `plot-fleet-scan.sh` 5438 lines, `plot-plan-meta.sh` 1504 lines.

Only read: `packages/domain/src/ports/{refs,trees,plan-store}.ts`, `packages/domain/src/adapters/plan-store/plan-store-ref.ts`, `packages/domain/src/adapters/run-script.ts:53,120-195`, `packages/fleet/src/shared/fleet-scan.ts:48,595-790`, `packages/domain/src/entities/fleet.ts:54-135`, `packages/domain/src/rules/branch-state.ts`, `packages/domain/corpus/README.md` and `production.ts`, and the scan at `:2716-2760` and `:3100-3115`. I ran no scan, no test, and no fleet, board or dispatch command.

## 1. Motivation

The motivation holds. The snapshot measurements match mine. One citation is wrong: the 19-input table lives at `.plot/panels/the-fleet-scan-re-reads-what/safety.md` section 2 on `origin/main`, not on branch `idea/the-fleet-scan-re-reads-what`, which does not exist. A slice that "takes the panel's rule for each as given" must be able to find the rule.

## 2. Is the first panel's table carried into slice obligations?

Partly. The plan carries these rules: oid reads (row 2, 5 and section 3.1), no cached `unknown` (3.2), parser version and config digest (row 7, row 12, 3.3), shallow and replace refusal (3.4), every-beat inputs (rows 1, 13 to 18), verdicts over all readings (row 8), and the dispatch guard (section 4). The Notes carry the fixture list and the race test.

The plan leaves out these rules:

- **Row 3:** a ref that `--prune` deletes must count as a change. The snapshot holds "ref oids", and a missing ref has no oid. Name deletion and creation as changes.
- **Row 6:** the set of plans that exist only on a prefix branch depends on every prefix ref and on `REMOTE_REFS` order. A per-blob cache is safe, but the set must be recomputed when any prefix ref moves.
- **Row 9:** the raw merge subject may be cached by oid. Its interpretation may not, because it reads `remote.origin.url` and the host backend (row 11).
- **Row 10:** the commits that added each plan are keyed by the main oid.
- **Row 19:** `last-pulse.json` is an output and never an input to a verdict.
- **Section 3.5:** the scan's within-run blob cache keys by basename. The walk must not inherit it.

The plan also contradicts itself. Approach step 3 already names the every-beat inputs, and Open Question 1 asks again which inputs stay every beat. Close the question: copy the 19 rows into the plan with their rules, and make the Cache slice's done-condition one test per row.

## 3. The ports break three rules today

The plan says the walk reads through `PlanStore`, `Refs` and `Trees`. The adapters that exist do not keep the rules the plan states:

1. **A read by ref name.** `planStoreRef.readPlans` (`plan-store-ref.ts:69-77`) calls `refs.listBlobs(ref, planDir)` again inside every call, with `ref` as the name `origin/main`, and `listPlans` does the same separately. A fetch between the two calls, or between the beat's snapshot and the read, gives a blob from a tree the snapshot did not hold. This is section 3.1 of the first verdict, now inside an adapter. The Walk slice must add a port operation that parses blobs by oid (`readBlobs(oids)` exists at `refs.ts:432`) and takes the snapshot's oids from the caller.
2. **A parse without `--prefixes`.** The scan calls `plot-plan-meta.sh "$@" --prefixes "$PREFIX_RE"` (`plot-fleet-scan.sh:3111`). `planStoreRef` (`:105`) and `planStoreShell` call the parser with no `--prefixes`, so the parser uses its default `idea|feature|bug|docs|infra` (`plot-plan-meta.sh:329`). This repository uses that default, so a corpus test on this repository cannot see the difference. A repository with other prefixes gets a different parse from the walk than from the scan. The Walk slice must pass the configured prefixes, and its fixtures must include a non-default prefix list.
3. **An unreadable ref reads as "no plans".** `planStoreRef` answers `listPlans` with an empty list when `listBlobs` fails (`:62-66`), and `readPlans` drops a missing blob and a parse error without a failure (`:89`, `:110`). The scan does something else: when `origin/<main>` cannot be read it falls back to the working tree (`plot-fleet-scan.sh:2716-2717`, `PLAN_SOURCE=worktree`) and reports `plan_source` in its output (`:5284`). A walk that answers empty emits a pulse with no plans, and the board drops a plan that a finished scan leaves out. The walk must fail the beat, or reproduce the working-tree fallback, never answer empty. A working-tree plan has no tree oid, so the fallback must bypass the cache. Add both cases as fixtures.

## 4. Decisions fleetd and dispatch take from the reading, with a warm cache

- **Start.** `auto-dispatch.ts:140` starts from `startableBranches(pulse, …)`. A stale "prior slice merged" or a stale `open` starts the wrong slice. The main-oid-in-key rule (row 2) and the waits rule (row 8) prevent this, but only if each fixture in the Notes makes the cached and uncached arms disagree when the rule is broken. Each fixture must be mutation-tested: remove the main oid from the key and the test must fail.
- **The dispatch re-check.** `plot-dispatch.sh:3852` runs `--list-eligible` in a new process. After the Launcher slice this process runs the domain walk cold, so it stays independent in data. It is not independent in code: both sides run one walk. That is the same as today, where both run one shell script. The plan must state that the launcher never loads fleetd's cache, and that no file or environment variable carries the cache to the launcher. `PLOT_TERMINAL_CACHE` is the precedent for passing state through the environment, and it must not be extended to the walk cache.
- **Restart and reap.** Worker state, desks and markers are read every beat (step 3). The scan reads worker state through `plot-worker-state.sh`, which it sources (`plot-fleet-scan.sh:259`), and the host through `plot-host.sh` (`:1067`, `:1084`, `:1380`) when no listing is passed. `PlanStore`, `Refs` and `Trees` reach neither the process table nor the host. The Walk slice must name the `Processes`, `Machine` or `Host` ports it reads through, or the walk cannot produce the eight worker states (`entities/fleet.ts:122`).
- **Release a claim.** `real_commits_beyond_main` is main-relative. The main oid in the key keeps it correct.
- **Merge and deliver** do not read the scan. `plot-ask.mjs merge` asks the host again, and delivery reads `mergedAt`. The plan must state this as a constraint the walk keeps: no merge or delivery decision may read the walk's reading.

## 5. A long-lived fleetd

- **Memory.** The plan names no bound and no pruning. The plans gained 665 new blob oids in 7 days. Ancestry pairs are keyed by (main oid, branch oid), and main gained 182 commits in 24 hours, so with 11 remote branches the pair count grows by up to about 2000 a day. A cache that only grows is a leak in a daemon that runs for weeks. Rule to add: after a completed beat, remove every entry whose key the beat's snapshot did not reach (mark and sweep). Report the entry count per kind, and test that a repository state held for N beats keeps the count flat.
- **Restart.** A restart is a cold full walk, which is correct. A cold walk may exceed the beat budget. Store each entry when it is read, not when the beat ends, so that a beat that times out still warms the cache and the next beat converges. Prune only after a completed beat.
- **No beat-wide kill.** Today a scan that overruns is a child process that `FLEET_SCAN_BUDGET_MS` (90 s, `fleet-scan.ts:48`) kills. In fleetd's process nothing kills the walk. Each adapter call has its own timeout, `DEFAULT_TIMEOUT_MS` 120 s (`run-script.ts:53`), which is longer than the scan's budget. A walk that overruns keeps running and overlaps the next beat. The plan must give the walk one beat budget that every adapter call honours (an abort signal), and it must refuse to start a beat while the previous one runs.
- **A blocked event loop.** The ports carry synchronous operations (`refStateSync`, `hashFilesSync`, `commitsSync`, `listSync`). A walk that calls them inside fleetd blocks the PR reader's heartbeat and the lock. A heartbeat that stops hands the scan to the board (`fleetOwnsScan`), and that brings back the concurrent scan the first panel measured. The walk must use only the asynchronous operations, or run off the main thread.

## 6. A fast-forward of main during a run

Today fleetd spawns the shell scan on each beat, so a parser change on main takes effect on the next beat. After the move, the walk and the TypeScript reshaper live in fleetd's bundle, which does not reload until fleetd restarts. `plot-plan-meta.sh` is still a script on disk and changes on the fast-forward. Three consequences follow:

1. The parser-version key must hash the parser as it is on disk, read every beat (`hashFilesSync` exists), together with the bundle's own identity. A version string compiled into the bundle cannot see a changed script.
2. fleetd (old bundle) and the dispatch re-check and board fallback (new bundle from disk) run different walks until fleetd restarts. Their disagreement is safe only in one direction: the re-check may refuse what fleetd offers. State that the re-check is a veto, never a source of starts.
3. The Notes fixture "the parser changes" must cover a change on disk while the bundle stays, not only a change to both.

## 7. A host or git failure during a beat

- A failed `git fetch` is reported every beat (row 1) and caches nothing.
- A failed `listBlobs`, `readBlobs`, `mergeBase` or `merge-tree` call returns a failed `PortResult`. The walk must store no entry for it and must not convert it into an empty or `no` answer (section 3, item 3).
- A failed host listing is not cached either. `fleet-scan.ts:752-760` already merges a partial stream by rule. The walk must keep `terminal:` and `listing:` semantics byte for byte, because fleetd's back-off reads them.

## 8. Can a 5438-line shell walk be proved equal in TypeScript?

Not proved, only tested on named states. A corpus test on this repository proves equality on one estate, at one moment, with the host `unasked` (`corpus/README.md`: no host token), on GitHub, with the default prefixes, with whatever desks happen to exist. It cannot reach Bitbucket, a non-default prefix list, the working-tree fallback, a shallow clone, the `throttled`, `secondary` and `failed` host reaches (`branch-state.ts:34`), or most of the eight worker states and eight branch states (`entities/fleet.ts:54`, `:122`).

What can be proved: equality over a declared state list in the sandbox tier, where each state is built in a temporary repository and both walks run over it with `changed_ago_seconds` removed. Some leaf rules already have their own corpus pairs (`branch-state.corpus.test.ts`, `eligible.corpus.test.ts`), so the Walk slice can compose proven leaves and test the composition. The state list must include at least: every `BranchState` reachable on a branch, each worker state that a fixture desk can produce, each `HostReach`, both backends, the working-tree fallback, a non-default prefix list, a refless branch settled by a merge subject, and a waits edge across plans. A replay harness that records real beats' inputs (snapshot, listing, terminal cache, desk readings) and runs both walks over them adds coverage of states that occur, at no host cost.

## 9. Slices and their order

- **Walk.** Right first. Its done-condition must be one command, for example the sandbox-tier comparison over the state list in section 8 plus the corpus test. It must include the port fixes in section 3.
- **Cache before Launcher is the wrong order for safety.** Production first runs the walk in the Launcher slice. With the current order, the walk and the cache go live in one merge, and a divergence cannot be attributed to one of them. Ship Launcher before Cache, uncached, and measure its CPU against the shell scan. That measurement also answers Approach step 4, which has no slice today. Then ship the Cache with the full-versus-incremental corpus and the race test as its done-condition.
- **Measure.** Step 4 ("how often fleetd needs a fresh reading") has no slice and no done-condition. Give it one, or move it to the Notes as a follow-up.
- Each "Done when" in the Notes must name its slice.

## 10. Open Questions

1. *Which inputs stay every beat?* Answered by the first panel: rows 1 and 11 to 18 every beat, rows 2 to 10 by oid key, row 19 never an input. The plan's step 3 already says so. Close the question and copy the table.
2. *Does the shell walk stay for one release?* From the safety lens: yes. While the shell walk exists, the corpus pair is the only check that the domain walk still agrees with a second implementation. Remove it only after the sandbox state list in section 8 passes and fleetd has run the domain walk for at least one release with the comparison green.
3. *What line count does the scan shrink to?* Cannot be answered yet. It depends on whether `plot-worker-state.sh` stays sourced by other scripts, and on how much of the output rendering moves.
4. *Which of the eight corpus files retire?* The ones that compare a domain rule with a scan field keep their value until the shell walk is removed; after that, each pair has one side left and must retire or become a sandbox-tier test. `production.ts` spawns the scan at `:86`, `:126` and `:486`, so it is the last to change.

## 11. Amendments required before approval

1. Fix the citation: the 19-input table is on `origin/main` at `.plot/panels/the-fleet-scan-re-reads-what/safety.md` section 2. Copy the table into the plan with its rule per row, and add rows 3, 6, 9, 10 and 19 as stated in section 2 above. Close Open Question 1.
2. Make the Cache slice's done-condition one test per row, each mutation-tested so that removing a key component fails it.
3. Add to the Walk slice: a port operation that parses blobs by oid with the configured `--prefixes`; a failure, never an empty list, for an unreadable plan tree, or the working-tree fallback with no caching; and the names of the ports that supply worker state and host reach.
4. Add a cache bound: mark and sweep after each completed beat, entries stored per read, an entry count per kind in the reading.
5. Add one beat budget that every adapter call honours, no overlapping beats, and no synchronous port operation in fleetd's main thread.
6. Key the parser version on the hash of `plot-plan-meta.sh` as it is on disk each beat, plus the bundle identity. State that the dispatch re-check is a veto, and that the launcher never receives fleetd's cache.
7. State that no merge or delivery decision reads the walk's reading.
8. Reorder to Walk, Launcher (uncached, measured), Cache. Give Approach step 4 a slice or move it out. Give each slice one done-command.
9. Name the states the equality proof covers (section 8) and the sandbox harness that builds them; do not rest equality on the corpus test over this repository alone.
