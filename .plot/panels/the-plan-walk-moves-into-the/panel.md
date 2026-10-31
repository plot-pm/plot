# Panel moderation: the-plan-walk-moves-into-the

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: testability and layering both timed a cold parse of all 620 plans (0.51 to 0.52 s CPU) and one batched `cat-file --batch` over all 621 plan blobs (0.026 to 0.03 s); all four timed `for-each-ref` and `ls-tree` (under 0.01 s); safety and seams checked that the repository is not shallow and `refs/replace` is empty; testability counted the scan's 51 functions, 19 sections, 4 domain bundles, 31 `test/reconcile/` files and 7 corpus test files that spawn it, and 2208 ratchet lines. No juror ran the scan or a test suite.

## Agreed by all four

1. **The plan switches the wrong call site.** fleetd and the board fallback reach the scan through `scanOnce` (`packages/fleet/src/shared/fleet-scan.ts:717`), which streams `plot-fleet-scan.sh --stream`. `Refs.pulse()` has one caller (`adapters/sprint-scope-ref.ts:103`). A cache in fleetd's memory has no process to live in until `scanOnce` calls the walk in-process, and the plan orders the cache before that.
2. **The Walk slice is not reviewable.** About 3400 of 5438 lines and 40 of 51 functions. The scan already pipes its readings into `plot-merge-subject.mjs` (`:3680`), `plot-branch-state.mjs` (`:4171`), `plot-verdicts.mjs` (`:4640`, `:5095`) and `plot-delta.mjs`, so the cut follows those seams: estate, branch readings, desks, assembly. Each has a byte-comparable oracle.
3. **The parsed-plan cache targets the small cost.** A cold parse of the estate costs 0.52 s of a 28 to 30 s scan. The saving is the removal of per-plan process starts and per-pair git calls; the cache that matters holds ancestry and merge-subject answers.
4. **The Launcher slice is several slices**, and it misses: `--why-nothing`, `--loose`, the host ask under `--offline --next`, the bridge write, the plan-file write under `--log-pulse`, the board's streamed partial rows, `plot-fleetctl.sh`'s recognition of a scan by its argv (`:322`, `:337`, `:426`), and the tests that read the script's text.
5. **No slice has a done-command.** The Notes bullets name none, and none belongs to the Walk slice.
6. **The input table is cited on a deleted branch.** It is on `origin/main`; the plan must copy it into Design and close Open Questions 1 and 4 from it.

## Findings from one lens each

- **Safety:** `plan-store-ref.ts` reads plans through the ref name `origin/main`, calls the parser without `--prefixes`, and returns an empty list for an unreadable tree where the scan falls back to the working tree (`:2716`). In fleetd the walk adds risks the child process did not have: no budget for the whole beat (the per-call timeout is 120 s against a 90 s budget), synchronous calls that could block the event loop and the heartbeat, a bundle that does not reload while `plot-plan-meta.sh` on disk does, and a cache with no bound (665 new plan blobs in 7 days). Equality must be proved over named states in temporary repositories, because the pinned corpus covers one state with no desks.
- **Layering:** the Approach says both "reads through the ports" and "takes readings as values". One shape: pure synchronous stages plus one async gatherer in fleetd that holds the cache in `ScanState`. Three port operations are missing: a batched `containsMany`, one whole-config read, and a plan read or parse by blob oid.
- **Testability:** a `PLOT_SCAN_WALK=shell|domain` switch lets the 31 `test/reconcile/` scan files run against both walks while the duplicate lives. Bitbucket needs its own fixture. A warm no-change beat should cost under 1 s CPU; the plan should bound it at 2 s and measure.
- **Seams:** the walk needs `Host`, `Processes`, `Desk` and `Agents` readings as well, or the controller hands them in. It composes existing rules (`sliceVerdicts`, `waitVerdict`, branch-state, merge-subject, verdicts, `agentState`, `deskState`) and adds no verdict arithmetic. It waits on #2979 slice 3 and must keep #2979 slice 2's scan-attempt record. `plot-worker-state.sh`, `plot-plan-meta.sh` and their corpus pairs stay.

## Where they differ

- **Order.** Safety: walk, launcher without cache (measured), cache. Layering: walk, in-process `scanOnce`, launcher, cache. Seams: in-process `scanOnce` first, cache in or after it, launcher split in four. The amended plan takes: walk in four slices, then `scanOnce` in-process with no cache (measured), then the cache, then the CLI modes, `--log-pulse`, and the shell walk's removal. This satisfies every lens: the cache has a process when it lands, and its gain is measured against a walk that already runs in-process.
- **Approach step 4 (how often fleetd needs a reading).** Testability: give it a slice or remove it. The amended plan folds the measurement into the cache slice's done-condition.

## Shared blind spot

All four judged the walk's equality to the shell walk as the goal. None asked whether every caller still needs everything the shell computes: nine caller modes share one 5438-line walk, and some (`--slice-names`, `--next`) read a small part of it. The assembly slice should record which readings each mode consumes, so a later plan can stop computing what nobody reads.
