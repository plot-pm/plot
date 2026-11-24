## Implementation brief — a-merged-release-books-its-plans (wave 3: Record)

- **Plan (canonical):** docs/plans/2026-11-24-a-merged-release-books-its-plans.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3702 merged
- **Branch:** `bug/the-release-finish-leaves-a-record` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`plot/review` on the PR)

Both waits have merged: `bug/the-release-reading-names-unbooked-plans` (#3703) and `bug/a-person-books-a-merged-release` (#3704). This slice is free to start. Wave 4, `bug/reconcile-counts-unbooked-docs-plans`, waits on #3703 only and does not wait on this slice.

### What to build

On 2026-11-23 release PR #3598 (`release: 2.36.0`) merged and the finish booked no plan. Nobody can say why: the desk root held no `plot-release-approve-3598.log`, so the finish's output did not survive. A person then booked 20 plans by hand. A finish that leaves nothing readable repeats that. After #3704 the Delivery tab shows an `unbooked` row and a "Book as Released" button, and a refused click shows its reason only in the browser until the page reloads.

Write one record per finish outcome and let the `unbooked` row read it.

- **The file** is `.plot/state/release-finish/<version>.json` under the state home (`stateHomeFor(opts)` in `packages/board/src/server/state-home.ts`). `<version>` is the tag spelling `vN.N.N` that `releaseVersionArg` returns and that `ReleaseUnbooked.version` carries (`rules/release-unbooked.ts:29`), so the row looks the file up by the string it already holds. Do not write a second spelling.
- **The shape** is `{ v: 1, version, at, caller, outcome: 'booked' | 'refused' | 'already-released', reason, booked, notes, sprintClosed }`. `caller` is the `Caller` the finish ran as. `reason` is the refusal's reason, or `''` where the finish did not refuse. `at` is an ISO-8601 instant. `sprintClosed` is the closed sprint's slug, or `null`.
- **Follow the repair record's shape.** `repairRecordFile` (`packages/domain/src/adapters/repair-record/repair-record-file.ts`) is the model: a port in `packages/domain/src/ports/`, an `encode`/`decode` pair in `entities/` that reads another `v` or unparseable text as `null`, a file adapter that writes a temp file and `rename`s it, and an `...In(answer)` helper in `state-home.ts` that returns a store whose reads fail where the home is unread. A new `validVersion` check must refuse a version that is not `vN.N.N` before it builds a path, as `validBase` does for a base name.
- **Write at the entries, not in `finishTail` alone.** `finishReleaseOfPr` and `finishReleaseVersion` (`packages/board/src/server/entry/release-finish.ts`) each refuse before they reach `finishTail`: `unaskable`, `default-branch-unfetched`, `version-unread`, `version-invalid`. Wrap the outcome once, where `FinishOutcome` is already one union (`finishExitCode` is the precedent), so every path that returns an outcome writes. `version-invalid` has no valid version and writes nothing. `version-unread` has no version either and writes nothing.
- **A failed write never changes the outcome.** The record is a note about the finish. A write that fails prints one line through `warn` and the finish still returns its own outcome and exit code.
- **The row reads the last record.** Add `lastFinish` to `ReleaseUnbookedShown` (`packages/board/src/contract/schema.ts:4387`) as `{ at, outcome, reason } | null`, filled where `releaseUnbookedFor` answers (`release-unbooked-reading.ts`). `unbookedReleaseRow` (`rules/delivery-row-form.ts:1033`) gains a `lastFinish` line: `last finish: <reason>` for a refusal and no line for a booked outcome or no record. The wording and the null case are decided in the domain, not in `UnbookedRelease.tsx`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **The record is not a verdict.** CLAUDE.md "Answers, never verdicts" forbids a persisted verdict, and the plan's own `releaseUnbooked` is not persisted for that reason. This file holds what happened at one instant: a refusal's reason and the plans a push booked. Git cannot re-derive either, because a refused finish writes nothing to git. Nothing may read it to decide whether the release owes plans: `releaseUnbooked` keeps reading git. The row only shows the last reason beside the debt. A test must show that deleting the file changes no placement, only the missing line.
- **A booked record never hides the row.** `unbooked` placement reads `releaseUnbooked`, never the record. Measured 2026-11-23: the finish for 2.36.0 left the plans Delivered with no trace. A record that said `booked` while a plan still read Delivered would repeat that failure with a green label. The row line therefore shows a refusal reason only.
- **Not the desk-root log.** The log under the desk root records one run's progress and is lost with the desk. The plan keeps it for progress and adds this file for the outcome. Do not move progress into the record.
- **Not the `.plot/state/` file of the release PR.** Every finish by version has no PR number, and `plot-ask.mjs release-finish <version>` is the repair path the 2.36.0 case needs. The key is the version.
- **One file per version, replaced whole.** A second finish for the same version overwrites the first. Keeping a history is not in the plan, and the commit log holds the bookings.
- **Absent is not false.** A missing file reads as `null` (no record), never as `booked` or `refused`. A file that fails to read is a `failed` port result and the row shows no line. An unparseable or other-`v` file reads as `null`.
- **Local to the machine.** The state home is local, as the repair record is. A finish on another machine leaves a record there, and this machine's row shows no line for it. That is the stated limit, and the plan does not widen it.
- **Do not add a passkey or a second caller check.** Wave 2 settled `releaseFinish` refusing `unattended` and `fleetd`. This slice only records the outcome of what that rule decided.
- **Write every new function as an arrow**, and keep TSDoc factual: what the export does, its parameters, its return, how it fails. History goes in the commit message.
- **Do not import `sprint-transition.ts`** into the entry. It runs its own entry when bundled into `plot-ask.mjs` (see the comment in `entry/release-finish.ts`).

### Done when

The plan's `## Slices` entry for "Record" is the specification: a refused finish writes `outcome: refused` with its reason; a booked finish writes the booked slugs; the row shows `last finish: <reason>`. Each test must fail on `origin/main` before your change. Check that, not only that it passes after.

- Domain test for the record's encode and decode: a round trip, another `v` reads as `null`, unparseable text reads as `null`, and `validVersion` refuses `../x`, `2.36.0` without the `v`, and an empty string.
- File adapter test over a temp directory: a missing file answers `null`, a write then a read round-trips, and a leftover temp file does not read as a record.
- `packages/board/test/unit/release-finish-real-repo.test.ts` or a new neighbour: a finish refused with `tag-absent` writes `refused` and `tag-absent`; a finish that books writes `booked` with the slugs and the closed sprint; a second finish answers `already-released` and replaces the file. Use a real state home, not a stub store, for at least the booked case.
- A refusal before `finishTail` (`default-branch-unfetched`) also leaves a record.
- `delivery-row-form.test.ts`: `unbookedReleaseRow` with `lastFinish` of a refusal gives `last finish: sprint-ambiguous`; with `null` and with a `booked` outcome gives no line.
- `release-unbooked-reading.test.ts`: the shown answer carries `lastFinish` read from the file, and a failed read gives `null`.
- `UnbookedRelease` browser test: one test proves the line is seen. The decision is a domain property.

Naive-pass traps, and what each test catches:

- A write placed only in `finishTail` passes every booked and sprint refusal and misses `default-branch-unfetched` and `unaskable`. The early-refusal test catches it.
- A test with a stub store passes when the real adapter writes to the wrong directory. The real-state-home case catches it.
- A row that reads the record to decide placement passes the happy path and hides a debt after a `booked` record. The delete-the-file placement test catches it.
- A fixture that writes the record after the push and fails the whole finish on a write error passes until the state home is unread. The failed-write test must assert the outcome and exit code are unchanged.

Plus: add a changeset for `plot` (description first, `bumps:` block last, `plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md` inside the block). The plan's own text and `skills/plot-release/SKILL.md` name the finish: check whether step 5b should say the finish leaves a record, and update that step and its Model Guidance row if it does. If you edit `CLAUDE.md`, run `./scripts/check-agents-md.sh --write`; the `release-finish` paragraph there is wave 2's, so check what is there before you change it. Do not commit `board-server.mjs` or other generated bundles (`scripts/check-no-bundle-diff.sh`).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` should not move; if you add one, the growth is paid for in the same change by removing shell elsewhere or asking the domain through a bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: the new port, entity and file adapter for the release-finish record under `packages/domain/src/`, their tests, `packages/board/src/server/entry/release-finish.ts`, `packages/board/src/server/state-home.ts`, `packages/board/src/server/release-unbooked-reading.ts`, the `ReleaseUnbookedShownSchema` in `packages/board/src/contract/schema.ts`, `packages/domain/src/rules/delivery-row-form.ts` (`unbookedReleaseRow` only), `packages/board/src/app/components/UnbookedRelease.tsx`, one changeset, and `skills/plot-release/SKILL.md` step 5b if it changes.

In flight and not owned: `bug/reconcile-counts-unbooked-docs-plans` (wave 4) touches `plot-reconcile-scan.sh` section 6 and a bundle, not the finish, the row or the schema. Check `gh pr list` at the start for any PR that touches `release-finish.ts` or `delivery-row-form.ts`, and report a collision rather than resolving it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
