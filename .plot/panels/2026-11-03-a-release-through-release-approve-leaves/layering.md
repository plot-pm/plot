# Layering juror: a release through release-approve leaves its issues at plan:delivered

Position: amend

## Summary

The defect is real and the direction is right: `finishRelease` must run the tracker step that `runRelease` runs. The plan leaves three layering decisions to the building agent, and two of them have a wrong default that an unattended Sonnet agent is likely to take. First, the obvious extraction target (`deliver.ts`) cannot be imported into `release-finish.ts` without running the deliver entry inside `plot-ask.mjs`. Second, the `already-released` repair arm has no plan list to work from, because the scope comes from the active sprint, and the finish removes that sprint from the active index. Third, the plan says "the controller calls the domain", but the decision of *which plans the tracker owes* sits in no domain function today, and the plan does not name one.

## Findings

### F1. The shared helper cannot live in `deliver.ts` (HIGH)

- `deliver.ts:1021` carries an entry guard: `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)`.
- `release-finish.ts:32-36` records the same hazard for `sprint-transition.ts`: "Not imported from `sprint-transition.ts`: that module runs its own entry when bundled into `plot-ask.mjs`."
- `release-finish.ts` is bundled into `plot-ask.mjs` through `main.ts:19,227`. If `release-finish.ts` imports anything from `deliver.ts`, the bundled `deliver.ts` guard compares the bundle's `import.meta.url` with `argv[1]`, and `plot-ask.mjs release-approve` then runs the deliver entry as well.
- The slice text says "extract the tracker step from `runRelease`". It does not say where the extracted function goes. The nearest move for an agent is an `export` in `deliver.ts`. No gate catches this: `release-finish-real-repo.test.ts` runs source, not the bundle.

### F2. The `already-released` repair arm finds no plans (HIGH)

- `finishRelease` builds the scope from the only sprint in `docs/sprints/active/` (`release-finish.ts:176-201`). The domain reads `scope` "empty unless exactly one sprint is active" (`workflows/release-finish.ts:58`).
- The first finish closes that sprint and removes its active index entry in the same commit (`release-finish.ts:248-258`). Commit `7c1317c9e` removed `docs/sprints/active/delivery-loop.md`. `git ls-tree origin/main docs/sprints/active/` lists nothing today.
- So a second `release-approve` for v2.30.0 reads `sprints = []`, `scope = []`, and refuses `already-released` with an empty scope (`workflows/release-finish.ts:160-161`). The refusal carries no plan list, and `booked` stays `[]` (`release-finish.ts:171`). "Run the same step before it returns 0" then runs it over zero plans, and the 24 plans of v2.30.0 stay unrepaired. The changelog line "repairs a tracker write that an earlier run missed" is false under the design as written.
- When a later sprint becomes active, the re-run reads that sprint's undelivered plans and refuses `plan-unbookable` before the repair arm, so the repair never runs.
- The repair arm must select plans by their `Released:` record naming the tag (for example `Released: 2026-11-03, v2.30.0`), read from the flat plan directory on the fetched default branch. It must not select them by sprint membership.
- The version comes from `origin/<default>`'s `package.json` (`release-finish.ts:123-135`). Today it reads `2.30.0`. After the next release, a repair for v2.30.0 through `release-approve` cannot address v2.30.0 any more. The plan does not say so.

### F3. Which plans the tracker owes is a decision, and no domain function makes it (MEDIUM)

- The per-issue decisions already live in the domain: `releaseIssueDecisions`, `unfinishedIssuesOf`, `parsePlanSiblingLine`, `releaseIssueSummary`, `trackerReportOf` (`packages/domain/src/rules/issue-status.ts:130-230, 294`). That part is correctly layered.
- The plan-level choice is not in the domain: "the plans this finish booked" on a fresh run, and "the plans whose `Released:` record names this tag" on a repair run. `ReleaseFinishDetail` (`workflows/release-finish.ts:83-90`) carries `booked` slugs and nothing else. The `already-released` refusal carries only a sentence.
- If the entry computes the repair list itself, that puts the "No domain-specific code or behaviour lives outside the domain" breach into a new file. Under the "Every rendered state is a domain property" rule, the entry also cannot then be tested without a repository.

### F4. The tracker step reaches the tracker through a launcher, not the port (LOW, accept)

- `runRelease` calls `ctx.scripts.awaited('plot-plan-state.sh', …)` (`deliver.ts:978-988`). `plot-plan-state.sh` is a launcher that `exec`s `board/plot-plan-state.mjs`, and that bundle calls `Tracker.planStateWrite` (`plan-state.ts:180`). So the path is entry → Scripts adapter → bash launcher → node entry → Tracker port.
- This obeys the layering rule, because a script is reached only through the Scripts adapter. In-process, a call to `Tracker.planStateWrite` would cost one node start less per plan, but `plan-state.ts` also has an entry guard (`plan-state.ts:290`), so F1 rules out a direct import of its `run`. The plan's "the tracker writes go through the existing scripts adapter" is the right choice for this slice. Do not reach for the Tracker port here.
- Idempotence holds: `githubPlanStateWrite` skips the label and comment where the body hash matches, and still closes on every `released` call (`tracker-plan-state.ts`, doc block above `githubPlanStateWrite`). So the plan's open question 1 has an answer already: repair every plan the arm selects, and do not add a tracker read. A pre-write read would be a second read beside the one `planStateWrite` documents, and the port's doc forbids that ("no Plot code reads either back except the one read").

### F5. The helper needs adapters for the booked tree, and `FinishContext` has no way to supply them (MEDIUM)

- `runRelease` builds `planStoreShell` and `scriptsShell` over `tmpwt` in the entry (`deliver.ts:943-944`), and so it needs `ctx.scriptDir`. `FinishContext` (`release-finish.ts:12-30`) has no `scriptDir` and no adapter factory.
- `release-finish-real-repo.test.ts:79` wires a real `scriptsShell`. If the tracker step runs through that, the test calls the real `plot-plan-state.sh` and the real tracker. That either reaches GitHub or fails. The plan's "test one `released` write per booked plan" therefore needs an injected `Scripts` fake that records `awaited` calls.
- The shared helper must take its Scripts and PlanStore for the booked tree as parameters, or take a factory `(root) => { planStore, scripts }`. It must not construct `scriptsShell` itself. `main.ts:227-237` supplies the real factory.

### F6. Booked tree, sibling read, and order with cleanup (LOW)

- In `finishRelease`, `cleanup()` removes `tmpwt` immediately after the push (`release-finish.ts:296-297`). The step must run between the push and `cleanup()`, as `runRelease` does (`deliver.ts:921-950`). On the `already-released` arm, `tmpwt` holds `origin/<default>` and `cleanup()` runs at `:269`, so the step must go before that line.
- Every plan this finish books reads `released` in the booked tree. So one sibling read over the whole plan directory serves all plans: `unfinishedIssuesOf` already excludes `released` records. N per-plan `planMeta` batches over the full directory are not needed.
- Open question 2 (push rejected) has an answer that follows from the existing code: `runRelease` prints `tracker=skipped` on a rejected push (`deliver.ts:913-918`). The finish must do the same. This is not a question for a person.

### F7. Claims checked

- `deliver.ts:925-1012`: the tracker step spans 921-1015 on origin/main. The range is close enough to find.
- `release-finish.ts:104` is `finishRelease`; `:267` is the `already-released` branch. True.
- "`finishRelease` makes no tracker call": true. It has no `plot-issue-status.sh` and no `plot-plan-state.sh` call.
- "`/plot-reconcile` reports and closes nothing": true. The plan omits that `plot-released-labels.mjs` (`released-labels.ts`) exists, a one-off `--yes` backfill that labels closed issues named by Released plans. It neither closes issues nor posts a comment, so it does not replace this fix. It does select issues by plan phase and not by sprint, which supports F2's selection rule.

## Required amendments

1. Name the module: the shared step lives in a new entry-free module, for example `packages/board/src/server/entry/release-tracker.ts`, with no `import.meta.url` guard. `deliver.ts` and `release-finish.ts` both import it. Neither imports the other. State the reason with the `release-finish.ts:32-36` precedent.
2. Put the plan-selection decision in the domain. Extend `ReleaseFinishDetail` with the plan files the tracker owes on a fresh finish. Add a pure rule (for example `plansReleasedAt(records, version)`) that selects every plan whose `Released:` record names the tag. The repair arm runs on that rule's answer over the flat plan directory of the fetched default branch, not over the sprint scope. The repair also runs where the active index holds no sprint.
3. Fix the repair ordering: the repair arm must run before `plan-unbookable` can stop it when an unrelated later sprint is active, or the plan must state that repair runs only while the active index holds no other sprint. A person decides which (see below).
4. Give the helper its booked-tree adapters as parameters, or as a factory on `FinishContext`, and wire the real ones in `main.ts`. The new test injects a `Scripts` fake that records each `awaited('plot-plan-state.sh', [file, '--phase', 'released', …, '--version', tag])` call, and asserts one call per selected plan. The test also covers the repair arm on a repository with an empty `docs/sprints/active/`. That test fails on origin/main, because the arm finds zero plans there.
5. Close open questions 1 and 2 in the plan text: repair every selected plan with no tracker pre-read (F4), and skip the tracker on a rejected push with `tracker=skipped` (F6).
6. Run the step before `cleanup()` on both arms, and read siblings once per finish (F6).

## Decisions for a person

- Does a repair for an older release need a path that does not depend on `package.json` holding that version? Examples are a `--version` argument on `release-approve`, or a separate `plot-ask.mjs release-tell <tag>`. As written, the repair can address only the current version, and only until the next release merges.
- When an unrelated sprint is active, does `release-approve` on an old merged release PR skip `plan-unbookable` and go straight to repair (amendment 3)? This changes the finish's refusal order, and a person should choose it.

## Ran versus read

- Ran (read-only): `git show origin/main:` on `deliver.ts`, `release-finish.ts`, `main.ts`, `plan-state.ts`, `released-labels.ts`, `domain/src/workflows/release-finish.ts`, `domain/src/workflows/release-approve.ts`, `domain/src/rules/issue-status.ts`, `domain/src/ports/tracker.ts`, `domain/src/adapters/tracker/tracker-plan-state.ts`, `skills/plot/scripts/plot-plan-state.sh`, `scripts/check-entry-exit.sh`, `release-finish-real-repo.test.ts`. Also ran `git ls-tree origin/main docs/sprints/active/` (empty), `git show 7c1317c9e --stat`, `git grep` for callers of the issue-status rules and `planStateWrite`, and `gh issue view 3066`.
- Not run: no test suite, no build, no bundle inspection. I did not execute F1 against a built `plot-ask.mjs`. The evidence for F1 is the guard at `deliver.ts:1021` and the recorded precedent at `release-finish.ts:32-36`.
