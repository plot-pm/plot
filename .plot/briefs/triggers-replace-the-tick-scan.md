## Implementation brief — triggers-replace-the-tick (wave 3: scan)

- **Plan (canonical):** docs/plans/2026-11-10-triggers-replace-the-tick.md on `sprint/triggers-and-connectors`
- **Approved:** 2026-11-11, jwloka, plan-PR #3387 merged
- **Branch:** `feature/triggers-replace-the-tick-scan` (base: `sprint/triggers-and-connectors`)
- **Ends as:** one PR to `sprint/triggers-and-connectors`
- **Review of the code:** PR review per the repository's convention (`Review: pr`)

Wave 3 holds this one branch. It waits on every wave 1 and wave 2 branch: `fleet-size`, `deadlines`, `watches` (`watches` and `deadlines` are merged on the sprint branch as #3396 and #3395), `safety-net` and `quiet-beats`. Wave 4 (`tick`) waits on this slice. When the sprint branch lacks `safety-net` or `quiet-beats`, stop and report; do not start.

### What to build

A scan that starts only when a trigger names work. Today `walkOnce` runs `git fetch --prune` on every 5 s scan (`packages/fleet/src/shared/fleet-scan.ts:793`) and the scan re-reads every reading on every beat. Measured at `38411b761` (GitHub, 3 desks, 5 open PRs): 214 to 216 direct children per idle pass, 5 scans per 120 s census pass, 24 scans per 120 s wall time. The `watches` slice already arms the watch set and keeps the pending set (`packages/fleet/src/shared/watch-set.ts`: `pending()`, `drain()`); the scan still runs on every beat and clears the set. This slice makes the set the scan's input:

- **The scan runs only on** a non-empty pending set, a degraded watch (`armed() < wanted()`), or a due safety net. A beat with none of the three starts nothing.
- **A scan re-reads only the readings the set names** (`StaleReading`, from `staleReadings`) and reuses the held ones. A desk commit re-reads that desk's status and no other desk's.
- **The fetch leaves the walk.** `git fetch --prune` runs on a `remote` change and on the safety net. The listing read raises `remote` when its answer names a new default-branch head, a newly merged PR, or a branch that appeared or went away. A claim pushed from another machine with no PR appears within one safety-net interval; `refs-remote-git.ts:79` still refuses a second claim push.
- **The heartbeat is written on every 5 s fleet beat,** also on a beat that starts no scan, in place of the 10 s `FLEETD_HEARTBEAT_MS` timer (`packages/fleet/src/shared/fleetd-heartbeat.ts:132`). It is a file write from an in-process timer and starts no process.
- **`lateLoops` reads `scan` and `tick` by the heartbeat's age** (`packages/domain/src/rules/fleetd-live.ts:85-89`): late when `beatAt` is older than the loop's bound, not when the last finished pass is. The bound stays 180 s for `scan` and 300 s for `tick`, so a dead fleetd still reads late within today's bound.
- **Census row P8** in `packages/fleet/test/census/census-rows.ts` and in the *Retired and added rows* table of `docs/process-census.md`: an idle fleetd pass starts no `git fetch`. Target zero; `greenBy` names plan `triggers-replace-the-tick`, slice `Scan on trigger`; `green: true`.

Record the slice's S4, S5 and S6 figures in the PR and in the story's Measures table (`docs/stories/nothing-changed-nothing-runs/`). The plan states no number for them before this slice measures it.

### Settled decisions — do not re-derive them

- **The pending set drains on the next 5 s beat, not on the event** (Open Question 6, decided 2026-11-10). Latency stays at today's 5 s, the scan keeps its in-flight guard (`fleet-clock.ts`) and its 90 s budget, and a rebase that writes many refs costs one scan. A debounce on the event was rejected for that reason.
- **A refs change also names `plans`; fleetd arms no watch on the plan, sprint or story directories** (Open Question 1). The walk reads plans from `origin/<main>` (`fleet-scan.ts:841`), not from the checkout, so a directory watch there would start a scan on every operator edit that no reading takes.
- **The heartbeat's age decides late, not the last finished pass** (Open Question 5). Keeping `lateLoops` on the last pass would read an idle scan as late after 180 s, send the board back to `plot-fleetctl.sh --status` and turn census S3 from 0.
- **A degraded watch goes back to a read on every beat.** `watchesArmed` stays below `watchesWanted` so readers see it (Open Question 3 only fixes what `--interval` means; that belongs to `tick`).
- **Self-caused events are filtered by content, never by a time window.** The `watches` slice holds this; do not add a window. A real change inside it would go missing.
- **The index never says no.** A missing held reading means read it, not "unchanged". A scan that cannot tell which readings a change names reads all of them.
- **A scan that throws keeps its held readings** and leaves the named readings pending, so the next beat retries them. Do not drop a drained set on a failed scan.
- **Do not touch the supervision tick's wait.** The tick still sleeps on `args.intervalMs` until the `tick` slice. The census pass still ends on `reportTick`.
- **Rules stay pure.** Decisions go in `packages/domain/src/rules/` as arrow functions over readings as values; `registryd-main.ts` and `packages/fleet/src/shared/` compose and call, and decide nothing (Layering Rule). New code says Slice where it means Slice.

### Done when

The plan's `## Done when` rows for *Scan on trigger* are the specification:

- An idle pass fetches nothing: census P8 reads 0 on every fixture; a listing answer that names a new default-branch head runs one fetch, and a CI change runs none.
- A change reads only what it names: a desk commit re-reads that desk's status and no other desk's; census S5 and S6 read below their merge base, and the slice records both figures.
- An idle board keeps trusting fleetd: census S3 and S7 read 0.
- A quiet fleetd reads live: on `clockManual`, fleetd starts no scan for 10 minutes and writes a heartbeat on every 5 s beat; `fleetdLiveness` reads `live` and `lateLoops` names no loop throughout.
- A dead fleetd reads late within the bound: `lateLoops` rows where a heartbeat whose `beatAt` is older than 180 s names `scan` and one 179 s old names none.
- A claim from another machine appears: a claim ref pushed to the remote with no PR appears in the snapshot after one safety-net pass.

Assertions a naive implementation would pass without:

- A test that an idle beat run 120 times starts no scan and no `git fetch`. It catches a leftover unconditional scan or a fetch that only moved.
- A test that a `remote` change from a CI-only answer runs no fetch. It catches a `remote` change raised on every listing read.
- A test that a scan which throws leaves its named readings pending. It catches a drain-then-read order.
- A test with one watch degraded: the scan still runs on every beat while `armed() < wanted()`. It catches a trigger-only scan that goes silent where the watch cannot be armed.
- A test that a beat which starts no scan still writes the heartbeat with a newer `beatAt`. It catches a heartbeat that stays on the scan's path.
- A `lateLoops` row with a fresh `beatAt` and a `lastPassAt` older than 180 s names no loop. It catches the old rule kept beside the new one.

Plus: no built board bundle in the diff (`scripts/check-no-bundle-diff.sh`), a changeset with the description first and `bumps:` last, and `plot-local-checks.mjs`: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; when the slice touches a `.sh` file, pay for growth in the same change, by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: the scan's walk and drain in `packages/fleet/src/shared/fleet-scan.ts` and `fleet-clock.ts`, the heartbeat writer `packages/fleet/src/shared/fleetd-heartbeat.ts`, `packages/domain/src/rules/fleetd-live.ts` and its tests, the use of `watch-set.ts`'s `drain()` by the scan, `packages/fleet/test/census/census-rows.ts` and `docs/process-census.md` (row P8), and the story's Measures table.

In flight: `feature/triggers-replace-the-tick-quiet-beats` (wave 2) owns `spend-rate`, state sync, the Merger App check and census row P9; `feature/triggers-replace-the-tick-safety-net` (wave 2) owns `missedChanges`, the 10-minute full read and census row S8; `feature/triggers-replace-the-tick-tick` (wave 4) owns the supervision wait and the census pass end. The `bitbucket-and-jira-read-in-process` slices share `fleet-scan.ts` and the listing read: rebase on the sprint branch before opening the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
