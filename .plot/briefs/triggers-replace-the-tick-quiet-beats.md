## Implementation brief — triggers-replace-the-tick (wave 2: quiet beats)

- **Plan (canonical):** docs/plans/2026-11-10-triggers-replace-the-tick.md on `sprint/triggers-and-connectors`
- **Approved:** 2026-11-11, jwloka, plan-PR #3387 merged
- **Branch:** `feature/triggers-replace-the-tick-quiet-beats` (base: `sprint/triggers-and-connectors`)
- **Ends as:** one PR to `sprint/triggers-and-connectors`
- **Review of the code:** PR review per the repository's convention (`Review: pr`)

Wave 1 (`fleet-size`, `deadlines`, `watches`) and `safety-net` are merged on the sprint branch. This slice is the last open branch of wave 2; wave 3 (`scan`) waits on it, wave 4 (`tick`) on that.

### What to build

A beat that starts no process. Three callers still start one process per beat on an idle fleetd (direct children per pass, recorded on macOS at `38411b761`, GitHub fixture, 3 desks): `bash plot-host.sh spend-rate` (1 to 3 per pass), `node plot-state-sync.mjs --forward` (every twelfth beat) and `node plot-merger-token.mjs --check` (once per process lifetime today). The slice removes all three from an idle beat:

- **`spend-rate` through the `Budget` port.** Callers: `fleet-scan.ts:326`, `pr-refresh.ts:715`, `registryd-main.ts:504`, each through `scripts.hostSaid(['spend-rate'])`. The file adapter `packages/domain/src/adapters/budget/budget-file.ts` answers the same rate in-process from `budget.tsv`. Add a corpus row in `packages/domain/corpus/` that holds the adapter's rate to `plot-host.sh spend-rate`.
- **State sync follows the refs.** `stateSyncTick` (`packages/fleet/src/shared/state-sync-tick.ts`) runs `plot-state-sync.mjs --forward` every twelfth beat. It runs on a refs change that moves the state branch or the default branch, and on the safety net. An idle beat runs it zero times.
- **The Merger App check runs once per process and before a merge.** `packages/domain/src/adapters/merger-app/merger-app-shell.ts` calls `plot-merger-token.mjs --check`. The plan adds one more trigger: a change of the key file's directory.
- **Census row P9** in `packages/fleet/test/census/census-rows.ts` and in the *Retired and added rows* table of `docs/process-census.md`: an idle fleetd pass starts no `plot-host.sh spend-rate`, `plot-state-sync.mjs` or `plot-merger-token.mjs`. Target zero; `greenBy` names plan `triggers-replace-the-tick`, slice `Quiet beats`; `green: true`.

Expected S4 move: 3 to 5 direct children per pass fewer. S5 and S6 unchanged or lower.

### Settled decisions — do not re-derive them

- **The PR and issue readers keep their in-process timers.** They buy host answers, and an answer that differs is a trigger. Do not move them.
- **No new Phase 8 trigger code here.** The pending set, `changeOf` and the watches landed in the `watches` slice. This slice reads the refs change those produce; it arms no watch of its own. A `registryd-main.ts` hunk that arms a watch belongs to another slice.
- **A budget corpus row, not an agreement claim by assertion.** The `Budget` file adapter and the shell answer the same question by two implementations; per CLAUDE.md *A Shell Script Asks The Domain*, a declared duplicate joins the corpus tier and the test fails when the pair drifts. On a disagreement the branch stops; do not adjust either side to pass.
- **Per-agent-per-pass shell must not grow.** `scripts/check-shell-lines.sh pr` ratchets shell line count against the merge base. This slice should remove shell, not add it.
- **The census gate stays green.** Every count the slice does not target stays within 10 % + 2 of its merge base. P9 is a zero row and is green when it merges.
- **A destructive action still re-asks its evidence.** The Merger App check before a merge is kept; only the idle-beat run is removed.

Carried over unchanged: absent is not false (a missing budget file answers `unmeasured`/no rate, never zero spend); read the exit code, not the emptiness.

### Done when

The plan's `## Done when` rows for *Quiet beats* are the specification:

- The beat readers start nothing on an idle beat: census P9 reads 0 on the GitHub fixtures, and a corpus row holds the `Budget` port's rate to `plot-host.sh spend-rate`.
- State sync follows the refs: a refs change that moves the state branch runs `plot-state-sync.mjs --forward` once; an idle beat runs it zero times.

Assertions a naive implementation would pass without:

- A test that an idle beat run twelve times still runs state sync zero times. It catches a leftover every-twelfth-beat counter.
- A test that a refs change moving neither the state branch nor the default branch runs state sync zero times. It catches a trigger wired to every refs change.
- A test that the Merger App check runs before a merge even when it ran at start. It catches an over-cached check.
- A budget corpus row with a rotated or empty ledger. It catches an adapter that agrees only on the happy path.

Plus: no built board bundle in the diff (`scripts/check-no-bundle-diff.sh`), a changeset with the description first and `bumps:` last, and `plot-local-checks.mjs`: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; when the slice touches a `.sh` file, pay for growth in the same change, by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/fleet/src/shared/state-sync-tick.ts`, the `spend-rate` callers named above, `packages/domain/src/adapters/merger-app/merger-app-shell.ts`, `packages/domain/src/adapters/budget/`, one corpus file under `packages/domain/corpus/`, `packages/fleet/test/census/census-rows.ts` and `docs/process-census.md`.

In flight: `feature/triggers-replace-the-tick-scan` (wave 3, waits on this slice) owns the scan's pending-set drain, the fetch leaving the walk, the heartbeat on every beat and `lateLoops`; `feature/triggers-replace-the-tick-tick` (wave 4) owns the supervision wait and the census pass end. `bitbucket-and-jira-read-in-process` slices share `registryd-main.ts` and the budget connectors; rebase on the sprint branch before opening the PR.

The remote ref `feature/triggers-replace-the-tick-quiet-beats` already exists at `03332587c` with commits past the sprint head, so an agent has already claimed it. The agent that takes this brief resumes that branch and does not re-create it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
