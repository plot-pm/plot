# Layering juror: the-plan-walk-moves-into-the

Position: amend

## Summary

The direction is right, and the plan already takes the #2979 layering amendments (walk over `PlanStore`, `Refs`, `Trees`; cache in fleetd's memory; no cached `unknown`; parser in the key; launcher with a corpus-declared duplicate). Four layering defects remain. The plan switches the wrong call site: fleetd and the board reach the scan through `scanOnce`, not through `Refs.pulse()`. The Approach says both "reads through the ports" and "takes readings as values", and these are two different shapes. The parsed-plan cache targets a cost of about 0.6 s out of 28 to 30 s. And the launcher slice misses the streaming board, the process recognition in `plot-fleetctl.sh`, and about five tests that read the script's text.

## What I executed and what I only read

Executed (read-only, at load 8 to 9): `git ls-tree -r origin/main -- docs/plans` with a mode count (621 `100644`, 623 `120000`); one `git cat-file --batch` over all 621 plan blobs (7 395 996 bytes, 0.026 s); one over the 623 link blobs (0.019 s); `git rev-parse origin/main:docs/plans` and the two index subtrees (0.006 s); `git for-each-ref` (454 refs, 0.007 s); one `plot-plan-meta.sh` run over the 620 working-tree plans (`/usr/bin/time -p`: real 0.66, user 0.51, sys 0.04). Greps over `packages/domain/src` for workflows that import ports or await, adapters that import workflows, callers of `.pulse()`, callers of `plot-fleet-scan`, the corpus files that spawn the scan, and the tests that read the script's text.

Read only: the plan; the #2979 `layering.md` and `panel.md` on `origin/main`; `ports/refs.ts`, `ports/plan-store.ts`, `ports/trees.ts`; `adapters/refs/refs-git.ts:358,549-554`; `adapters/plan-store/plan-store-ref.ts:44-125`; `adapters/sprint-scope-ref.ts:90-110`; `packages/fleet/src/shared/fleet-scan.ts:62-150,715-745`; `packages/fleet/src/shared/config-reader.ts`; `packages/board/src/server/fleet.ts:2815-2845`; `plot-fleetctl.sh:260-340,426`; `skills/plot/scripts/README.md` launcher rows. I ran no scan, no test, no board and no fleet command.

## 1. Motivation

It holds. The scan is 5438 lines (`wc -l`). The cheap change-detection claim is stronger than the plan says: the whole snapshot (refs, plan tree oid, every plan blob and every link blob) reads in under 0.06 s here. The 19-input table the Motivation cites now lives on `origin/main` at `.plot/panels/the-fleet-scan-re-reads-what/safety.md`, not on the idea branch; fix the pointer.

## 2. Approach, through the layering lens

**2.1 The switch point is `scanOnce`, not `Refs.pulse()`.** `Refs.pulse()` has one production caller, `adapters/sprint-scope-ref.ts:103`. fleetd (`fleet-clock.ts:148`) and the board fallback (`board/src/server/fleet.ts:2823`) both call `scanOnce`, which runs `scripts.stream('plot-fleet-scan.sh', ['--stream'])` at `fleet-scan.ts:717`. A cache held in fleetd's `ScanState` reaches the walk only when `scanOnce` calls the walk in-process. If `scanOnce` keeps spawning the launcher, the cache has to cross a process boundary by env, as `PLOT_TERMINAL_CACHE` does, and a parse cache over 7.4 MB of plan text cannot travel that way. Amend Approach 1 to say: `scanOnce` (the controller) calls the domain walk in-process and holds the cache in `ScanState`; the launcher serves every other caller, cold.

**2.2 `Refs.pulse()` must leave the port, not call the domain.** An adapter that calls a domain workflow, which in turn reads through `Refs`, `PlanStore` and `Trees`, puts a workflow inside an adapter and makes the refs adapter construct two other adapters. No adapter imports a workflow today (grep: the two hits are a constant and the `decision`/`rendering` types). Remove `pulse()` from `ports/refs.ts:400` and `refs-git.ts:549`; `sprint-scope-ref.ts` takes the `FleetReading` as a value from its caller, or its caller calls the walk.

**2.3 Pick one shape for the walk.** "A domain workflow reads through the ports" is the `merge.ts` shape (imports six ports, awaits). "The workflow takes readings as values" is the `reap` shape. Both exist: five workflows import ports and await (`merge`, `release-approve`, `slice-spend`, `repair-pr`, `run-limits`), so the CLAUDE.md line "no rule or workflow imports a port or awaits anything" is already false. The walk's reads are staged: the snapshot decides which plans to parse, the parsed plans decide which commit pairs to ask about, and the answers decide the verdicts. Name the stages as pure synchronous functions (`questionsFor(snapshot, plans)` and `readingFrom(readings)`), and one async gatherer that asks the ports for each stage's questions. The cache belongs to the gatherer (in `ScanState`) and is never visible to the pure stages. This keeps every verdict a function of values, which is what Approach 3's "verdicts stay a function of all readings" needs.

**2.4 The walk composes the rules that already exist.** The scan already asks three domain bundles: `board/plot-verdicts.mjs` (2 sites), `board/plot-branch-state.mjs` (1, once per plan), `board/plot-merge-subject.mjs` (1). Their entries are `packages/board/src/server/entry/{verdicts,branch-state,merge-subject}.ts`. The walk must call those rules directly and must not re-derive them. The declared duplicate is then only the shell's gathering glue, which keeps the corpus comparison small and honest. State this in Approach 1.

**2.5 The parsed-plan cache buys about 2 % of the cost.** Measured here: reading every plan blob costs 0.026 s, and parsing all 620 plans in one `plot-plan-meta.sh` pass costs 0.51 s user. Against 28 to 30 s CPU per scan, the parse cache saves at most 0.6 s and adds two key parts (parser version, Plot Config digest) that each need their own source of truth. The expensive answers are the ancestry pairs and the merge subjects (#2979 testability: 15.6 s and 297 pairs). Drop the parsed-plan cache, or make it conditional on a measurement taken after the walk moves. Keep the ancestry and merge-commit caches.

**2.6 Port operations the snapshot and caches need.** The snapshot needs no new operation: `Refs.refState`/`refStateSync` give ref-to-oid pairs (`refs.ts:507,519`), `Refs.resolve('origin/main:docs/plans')` gives the tree oid, and `Refs.listBlobs` gives each entry's mode and blob oid (`refs.ts:415`). A symlink's blob oid changes exactly when its target changes, so the snapshot keys link targets by blob oid and reads a target through `readBlobs` only when that oid moved. Three operations are missing:

- A plan read by blob oid. `PlanStore.readPlans` takes paths and returns records with no oid (`plan-store.ts:136`); `plan-store-ref.ts` lists, stages to a temp dir and parses in one call. A cache keyed by oid needs `readPlansAt(blobs: {sha, path}[])` that returns records keyed by sha. Only needed if 2.5's cache survives.
- A batched containment read. `Refs.contains` answers one pair per call (`refs.ts:701`), so a cold beat or a moved `main` still costs one spawn per pair. A `containsMany(pairs)` in `refs-git.ts` is the operation the ancestry cache needs to pay off on a miss.
- One whole Plot Config read. `PlanStore.config(key)` and fleet's `readConfig` spawn `plot-config.sh` once per key. A "Plot Config digest" needs the section text in one read, through `PlanStore.readText` plus a declared pure parser, or a new `configSection()` operation. Name which.

**2.7 The board streams partial plans.** The board's `onLine` handler (`board/src/server/fleet.ts:2828-2840`) merges each streamed `plan` line and publishes a partial pulse. An in-process walk must keep a per-plan callback, or the board loses its partial rows. The board also runs `scanOnce` inside its HTTP server; a synchronous walk there blocks requests for as long as it runs. State that the board fallback keeps a child process (the launcher), or measure the walk's synchronous CPU before it runs in the board.

## 3. Slices

The cut has the right three parts, but the order and the done-conditions need work.

- `Walk` is one slice for a 5438-line script. Cut it at the stage boundaries from 2.3, or at least name the gatherer and the pure stages as separate reviewable commits. Its done-condition: the new corpus file (name it) passes over a pinned estate.
- `Cache` waits on `Walk` and `Launcher` waits on `Cache`. The launcher depends on the walk, not on the cache, and 2.5 shows the cache is the part most likely to be cut. Reorder to Walk, then `scanOnce` in-process (fleetd only), then Launcher, then Cache, with the cache slice gated on Approach 4's measurement.
- Approach 4 (how often fleetd needs a fresh reading) has no slice. Give it one, or move it to Notes as a measurement with a named command.
- The three "Done when" lines in Notes belong to the plan, not to any slice. Give each slice one command.

## 4. What would break, and how we would know

- `plot-fleetctl.sh` recognises a scan by the token `plot-fleet-scan.sh` in its argv (`:322`, `:337`, `:426`). A launcher that `exec`s node replaces argv, so `--status` stops counting scans, and an in-process fleetd walk leaves no scan process at all. The 2026-09-29 measurement in its header (17 scans from boards, unseen) is what that block exists for. Test: `test/reconcile/fleetctl.test.mjs` with a launcher-started scan.
- Tests that read the script's text break when the text becomes a launcher: `fleetdelivered.test.mjs` (lifts a function by regex, `plot-fleet-scan.sh:1641`), `fleet.test.mjs`, `restart.test.mjs:470`, `workerstate.test.mjs`, and `fleetsubject.test.mjs`, which asserts the scan's debug text (`subject_predates_plan=1`, `merge_detect=none`). About 40 test files name the scan. The launcher slice must list each and say whether it moves to the domain walk or retires.
- `scripts/check-ancestry-decisions.sh`: the scan's `plot-ancestry: evidence` declarations disappear with the walk; the TypeScript `contains` caller must keep its declaration.
- Board partial rows: the `streaming-scan.test.ts` unit test over `onLine` fails if the in-process path drops per-plan lines.

## 5. Open Questions

1. **Every beat or oid key.** From the layering side: desks, worker processes, markers, `PLOT_PR_LISTING`, `PLOT_TERMINAL_CACHE`, `now`, the Plot Config and the fetch result are read every beat, as the plan says. Plan blobs and link blobs are keyed by blob oid, but the parse need not be cached (2.5). Ancestry is keyed by the commit pair, and a merge commit's subject and files by its oid. The safety table on `origin/main` gives the rule per input.
2. **Duplicate for a release, or same sprint.** The corpus rule allows a declared duplicate for as long as a test holds it, so the release boundary is not the constraint. The shell line ratchet is: the duplicate cannot grow. Keep the shell walk as the oracle until the launcher slice, and retire the corpus pairs by name in that same PR.
3. **Line count.** The repo's launchers are 12 to 13 lines (`plot-approve.sh`, `plot-record-pr.sh`, `plot-sprint-release-gate.sh`). A scan launcher that keeps nine caller modes by passing arguments through needs no more. If it needs more, the extra lines are a mode the bundle does not yet own.
4. **The eight corpus files.** By grep: `branch-state`, `branch-state-waits`, `branch-state-waits-open-pr`, `eligible`, `finished-estate` (indirect, through `production.ts:84 readFleetScan`), `refs`, `scan-listing`, `tracked-branches`. Each compares a domain rule against the scan's output. Once the scan is the domain walk, each comparison is domain against domain and proves nothing, so all eight retire by name in the launcher slice, and the one new walk-against-shell corpus file retires with them.

## 6. Amendments before approval

1. Approach 1: replace "`Refs.pulse()` stops spawning the scan" with "`scanOnce` calls the domain walk in-process; `Refs.pulse()` is removed from the port, and `sprint-scope-ref.ts` takes the reading as a value."
2. Approach 1: name the walk's shape as staged pure synchronous functions plus one async gatherer, and state that the cache belongs to the gatherer in `ScanState`.
3. Approach 1: state that the walk composes the existing `verdicts`, `branch-state` and `merge-subject` rules and re-implements none.
4. Approach 2: drop the parsed-plan cache, or gate it on a measurement after the walk; cite the 0.51 s parse and 0.026 s read.
5. Approach 2: name the port operations: `containsMany` on `Refs`, one whole-config read, and (only with the parse cache) a plan read by blob oid.
6. Approach 3: state that the board fallback keeps streaming per-plan lines and does not run a synchronous walk on its server thread.
7. Launcher slice: list `plot-fleetctl.sh` process recognition and the five text-reading tests, and say how each survives.
8. Slices: reorder to Walk, in-process `scanOnce`, Launcher, Cache; add a slice or a command for Approach 4; give every slice one done-condition command.
9. Motivation: point the 19-input table at `origin/main:.plot/panels/the-fleet-scan-re-reads-what/safety.md`.
