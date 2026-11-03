# Panel: a-release-through-release-approve-leaves

Round 1 of the Draft plan `docs/plans/2026-11-03-a-release-through-release-approve-leaves.md` (issue #3066, plan PR #3071). Four jurors: testability, layering, safety, seams.

## Gate

Each verdict passed `plot-panel.mjs check Position "proceed,amend,reject" <lens>`, and the four outputs went to `plot-panel.mjs reconcile`:

```
committed	testability	amend
committed	layering	amend
committed	safety	amend
committed	seams	amend
---
unanimous	amend	layering,safety,seams,testability
```

Result: **unanimous amend**, four of four.

## Agreement

All four jurors find the defect real and the first-run fix right: `finishRelease` (`release-finish.ts:104`) makes no tracker call, and `runRelease` (`deliver.ts:921-1016`) holds the only tracker step. Verified on origin/main `a518552f1`.

- **The `already-released` repair has no plan list** (layering F2, safety 1, seams 1, testability 5a). The first finish removes the sprint's active entry (`release-finish.ts:248-258`); `git ls-tree origin/main docs/sprints/active/` prints nothing, so a re-run reads an empty scope. Verified.
- **The shared step cannot live in `deliver.ts`** (layering F1, seams 2). `deliver.ts:1021` carries an entry guard and `release-finish.ts:35-36` records the same hazard. Verified.
- **`FinishContext` has no `scriptDir`** and the real-repo tests use the real `scriptsShell` (`release-finish-real-repo.test.ts:79`) (testability 3, layering F5, seams 8). Verified.
- **A rejected push skips the tracker**, as `deliver.ts:913-918` does (all four). Verified.
- **No tracker pre-read** (layering F4, safety 2, seams rubric 5): `ports/tracker.ts` permits only the read `planStateWrite` documents.
- **The tracker failure rule is unstated** (testability 4, safety 4, seams rubric 4). `runRelease` returns 0 and prints `tracker=failed`. Verified at `deliver.ts:1013-1016`.

## Disagreements

- **Whether to keep the repair in `release-approve`.** Testability and layering amend it to select plans by their `Released:` record naming the tag. Safety asks whether it belongs there at all and names `plot-deliver.mjs --release` as the per-plan repair that exists today. Seams agrees with the `Released:`-record scope. Decided: no repair through `release-approve` (decision 3).
- **The next-sprint hazard.** Safety alone finds that a re-run on the merged v2.30.0 release PR, once `follow-ups-2-30-1` is active, books that sprint's Delivered plans under v2.30.0; seams finds the same re-run refuses `plan-unbookable` while that sprint holds no Delivered plan. Both are true for different scope states. Verified: the version comes from `origin/main:package.json` (`release-finish.ts:123-135`), and the sprint files carry `Release:` (`2026-W44-delivery-loop.md` reads 2.30.0, `2026-W45-follow-ups-2-30-1.md` reads 2.30.1). Decided: refuse `release-scope-mismatch` (decision 4).
- **The measurement.** The plan said 4 issues. Safety counted 25 plans and 25 issues; seams counted 24 plans from `7c1317c9e` naming 24 issues. Both are right: the 25th plan (#2978) was booked per plan in `c24a65b74`. Verified: 25 plans hold `Released: 2026-11-03, v2.30.0`, and `gh issue view` on all 25 issues reads CLOSED with `plan:released` after the hand repair.

## Decisions

The master agent took these on the person's standing instruction to keep the fleet moving.

1. Scope: the first run only. The step runs once per booked plan after the final push and before `cleanup()`; a rejected push prints `tracker=skipped`.
2. The shared step lives in a new module with no entry guard, `entry/release-tracker.ts`, imported by `deliver.ts` and `release-finish.ts`. It takes Scripts, PlanStore and `scriptDir` as parameters, keeps one temp path per plan, and reads siblings once per finish from the booked tree.
3. No repair through `release-approve`. A re-run answers `already-released` and writes nothing. `plot-deliver.mjs --release <tag> <slug>` is the repair route, documented in `skills/plot-release/SKILL.md` step 5b; it repaired all v2.30.0 issues on 2026-11-03.
4. A finish refuses `release-scope-mismatch` before any write when the active sprint's `Release:` does not name this tag.
5. Tracker failure: exit 0, one `tracker=failed <issue>` line per failed plan, and the next plan still runs.
6. Plans outside the sprint stay out of scope: a named limit, #2927 finding 2, tracked in #3069.
7. Reopened issues: the first-run write closes; no repair re-closes, because no automatic repair exists.

## Amendments applied

- Motivation and Notes restate the measurement with its time and the hand repair.
- Changelog says "tells the tracker" (seams 6) and names the new refusal; the repair claim is removed.
- Open Questions are closed by the decisions above; the `issues.json` question is dropped (testability 7).
- A test list, each failing before the change: one released write per booked plan; rejected push makes no tracker call; a shared issue stays open through the sibling read; a tracker failure continues and prints the line; a scope mismatch refuses before any write.
- `release-finish-real-repo.test.ts` stubs both tracker scripts in every test, and `:235` is restated as "a second run writes nothing".
- The three `runRelease` tests are named as the regression guard for the extraction.
- Line range corrected to `deliver.ts:921-1016`.
- Documents: SKILL.md step 5b and its Model Guidance row, the CLAUDE.md `release-approve` sentence, a Notes line in plan #2997 correcting its `deliver.ts:969` claim, and a changeset.
- Slices: two, the refusal first so the tracker step never ships without it.
- Follow-up, not a slice: `/plot-reconcile` reads only closed issues of Released plans (`rules/released-labels.ts:71`), so an open one is invisible to it (seams 5).

## Not adopted

- A domain rule `plansReleasedAt` and a repair arm ahead of `plan-unbookable` (layering 2-3, seams 1, testability 1): moot under decision 3.
- A finish line naming the Delivered plans outside the scope (seams 4): left to #3069.
- A test that `release-finish.ts` imports nothing with an entry guard (seams rubric 6): the slice names the module; no gate is added in this plan.
