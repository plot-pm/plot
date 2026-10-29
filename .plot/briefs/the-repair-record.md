## Implementation brief — a-red-default-branch-is-repaired (wave: Repair record)

- **Plan (canonical):** `docs/plans/2026-10-29-a-red-default-branch-is-repaired.md` on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2910 merged
- **Branch:** `feature/the-repair-record` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's first wave. It waits on nothing. `feature/merge-admits-the-repair-pr` waits on #2902; `feature/fleetd-starts-main-repair` and `feature/a-red-main-is-reverted` wait on the role agents, `startReview` and the ticket writer. This slice builds the pure state they all read.

### What to build

A repair record, written by `packages/fleet/src/shared/default-branch-refresh.ts` at the change from a green settled reading to a red one, and `redMainStep(readings, input)`, the domain rule that reads it. Today nothing acts on a red main, and the facts a repair needs are lost: `advanceSettled` (`rules/default-branch.ts:110`) replaces the green settled reading with the red one, so the last green SHA is gone; `headSince` resets on every new head; `askedAt` moves on every answer.

The slice delivers:

- The record under `.plot/state/` (common git dir): last green SHA, first red SHA, `redSince`, candidate commits between them, re-run state, the one repair attempt, repair PR, revert PR. Lifecycle `idle → rerun → repairing → reverting → done | exhausted`, with `// plot-state: lifecycle` and a rule under `packages/domain/src/transitions/` so `scripts/check-state-declarations.sh` passes.
- The write in BOTH red arms of the refresh (`advanceSettled` and `settleBehindHead`), while `previous.settled` still names the green commit (`carried = previous?.settled`, around `:210`). With no previous reading the record has no last green SHA and the step notifies.
- `redMainStep` answering `none | hold | await-rerun | start-repair | await-repair | revert | close-prs | exhausted`. It spawns nothing and awaits nothing.
- The breaking-commit picker: pure, over first-parent commits after the last green SHA up to the first red SHA.
- A `Main repair bound` parser (seconds, default 3600) beside `checksWaitMsOf` (`rules/default-branch.ts:229`).

This slice adds no port operation, no agent start and no PR action; those belong to the later slices.

### Decisions the plan settles — do not re-derive them

**The record is a separate file; `default-branch.json` is not touched.** Its schema is `.strict()` (`entities/default-branch.ts:73`) and `decodeDefaultBranch` turns a parse failure into `null`, which holds nothing. An added field or a version bump makes every older reader (the board, `plot-ask.mjs merge`) lift the hold on a red main. Keep it at `v: 1`, no new field.

**The rule pins the episode, not one SHA.** Measured over 3365 `ci.yml` runs: in 28 of 38 episodes longer than 60 min main carried more than one red SHA (up to 35), because `build-bundles.yml` pushes `plot: build the board artifact` within a median 28 s of a PR merge. An episode is open while no green has settled since the record was written and the settled SHA descends from the record's red SHA (first-parent ancestry, declared `# plot-ancestry: evidence`). A moved red SHA in the same episode still answers `revert` or `await-repair`, never `close-prs`; `close-prs` answers a settled green only.

**`revert` uses the strict age, not `defaultBranchRed`.** `hold`, `await-rerun` and `start-repair` use `defaultBranchRed(reading, now, checksWaitMs)` (`:262`). `revert` uses `defaultBranchAgeMs` (`:241`), the age `merge()` uses: a stale reading never reverts. `revert` also needs `headSha === settled.sha`, an open episode, and `now - redSince >= Main repair bound`. A revert that merged with main still red answers `exhausted`: one episode reverts once.

**`redSince` is when fleetd first observed the settled red**, not a CI completion time, so a fleetd that was down at the change still gets the whole bound.

**The picker's window is fixed at the two recorded SHAs** and never reads the moving settled SHA. It answers a PR number only when exactly one candidate is a PR merge the host reads `MERGED`, the host `mergeCommit` (`Host.prMergeCommit`, `ports/host.ts:260`) equals the candidate SHA, that candidate is settled red on its own runs, and it changes, adds or removes no `State:` line. It parses squash subjects (`Title (#N)`) as well as the two forms `mergedBySubject` reads (`rules/merge-subject.ts:88`). Everything else is `unknown`; `unknown` never reverts. Rejected: reverting any `(#N)` commit — 3 of 134 are direct pushes by a person; of 1273 first-parent commits since 2026-10-20, 970 are direct pushes, mostly lifecycle records, and reverting one runs a lifecycle step backwards.

**Re-run before agent, re-run before revert.** 214 of 306 red episodes in 31 days turned green across a docs/`.plot/`/`*.md`/`.changeset/`-only diff; 16 re-runs of a red SHA turned green, 1 stayed red. `redMainStep` answers `await-rerun` until the first re-run settles; a green re-run answers `none`. (The re-run port operation itself is slice 3's.)

**Write the record before any re-run, agent start or push**, so a crash or a second tick on one machine starts no second repair.

Carried-over invariants: absent is not false (a missing, other-branch or other-version reading holds nothing); `.plot/state/default-branch.json` holds a verdict only because the next green and the `Checks wait` age bound it — the record is not a second verdict cache, it holds facts fleetd observed.

### Done when

The plan's `## Done when` list, if present, plus the plan's tests for this slice:

- A domain table test of `redMainStep`: stale red never reverts; a pending head blocks the revert; a moved red SHA in the same episode still answers `revert`; a settled green answers `close-prs`; a pending re-run answers `await-rerun`; a green re-run answers `none`; red with no record; a merged revert with main still red answers `exhausted`. Each row must make the arms disagree — a fixture where two answers coincide proves nothing.
- A fleet unit test of the refresh writing the record in both arms and with no previous reading.
- A picker table test: one PR merge, none, a direct push, `(#N)` with `mergeCommit` not equal to the SHA, two PR merges, a squash subject, a plan file added or removed.
- A parser test for `Main repair bound`.

Plus: a changeset (`plot` or `@plot-pm/board`, description first, `bumps:` block last); `packages/domain` code is arrow functions with factual TSDoc and no history narration; no import outside `zod` in the domain outside `adapters/`; `redMainStep` takes readings as values.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file.

### Bookkeeping

When the PR is opened (`skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`), append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/default-branch.ts` (parser), a new rule file for `redMainStep` and the picker, a new entity and transition rule for the record, `packages/fleet/src/shared/default-branch-refresh.ts` and its tests, and the changeset. It must not edit `workflows/merge.ts`, `rules/queue.ts`, `ports/host.ts`, `plot-host.sh` or `.claude/agents/` — the merge exception is `feature/merge-admits-the-repair-pr`, the ports are slices 3 and 4, the role definition is #2898's. No sibling branch of this plan is in flight (none exists on origin at dispatch).

If you find something the plan did not anticipate, report it rather than improvising outside scope. The open question in the plan (whether the fleet scan reports `bug/main-repair-*` branches as unplanned) is slice 3's to measure.
