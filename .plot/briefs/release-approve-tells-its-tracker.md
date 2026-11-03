## Implementation brief — a-release-through-release-approve-leaves (wave: Tracker step)

- **Plan (canonical):** [docs/plans/2026-11-03-a-release-through-release-approve-leaves.md](../../docs/plans/2026-11-03-a-release-through-release-approve-leaves.md) on `main`
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3071 merged
- **Branch:** `bug/release-approve-tells-its-tracker` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — `plot-review` app required on `main`

This branch has no dependency on its sibling slice `bug/release-finish-refuses-another-sprint` (→ #3079, same plan, `## Slices` heading "Release finish refuses another sprint"). The two touch different concerns — that one adds a refusal inside `releaseFinish`'s decision, this one extracts a side effect that runs after the decision — but both edit `release-finish.ts`, so a late-landing change to either is worth a glance at the other's diff before merge, not a blocking wait.

### What to build

`finishRelease` (`packages/board/src/server/entry/release-finish.ts:104`) books plans as Released and pushes, but never calls the tracker. The only place that tells a tracker about a released plan today is `runRelease` (`packages/board/src/server/entry/deliver.ts:921-1016`), the per-plan `plot-deliver.mjs --release` path. Release v2.30.0 went through `finishRelease` on 2026-11-03 and booked 24 plans with zero tracker calls — all 24 issues sat open with no `plan:released` label until a person fixed it by hand (plan Motivation section).

The fix: extract the tracker step out of `runRelease` into a new shared module, `packages/board/src/server/entry/release-tracker.ts`, and call it from both `runRelease` and `finishRelease`, once, after each one's final push lands and before cleanup.

### The decisions the plan settles — do not re-derive them

**The new module carries no entry guard, and that is why it is new rather than imported directly.** `deliver.ts:1021` has `if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) { ... }` — importing `deliver.ts` from `release-finish.ts` would run the deliver entry point inside `release-approve`. `release-finish.ts:35-36`'s comment about not importing `sprint-transition.ts` is the same hazard, already named once in this file. `release-tracker.ts` is a plain module: both `deliver.ts` and `release-finish.ts` import it, neither imports the other.

**The step takes its ports as parameters — `Scripts`, `PlanStore`, `scriptDir` — never constructs `scriptsShell` itself.** This is what makes it testable with fakes, matching how everything else in both entry files is wired. `FinishContext` (`release-finish.ts:12-30`) gains a `scriptDir` field; `main.ts:227` already resolves `opts.scriptsDir` for the sibling ports (`refsRemoteGit`, `buildShell`, `treesGit` all take it at lines 141/152/234) — add the same field when constructing `FinishContext`.

**One temp copy per plan, named after the plan — not the single shared path `deliver.ts:925` uses.** `runRelease` keeps exactly one booked plan at a time (`plot-release-plan-${process.pid}.md`), because it only ever books one. `finishRelease` can book several in one run (every unstruck Must/Should/Could item of the active sprint), so the shared step needs a path per plan or a second call for the same PID will stomp the first plan's temp copy before its tracker calls finish. Run plans one after another — the plan explicitly scopes out any concurrency question here.

**Read sibling plans from the post-push tree (`tmpwt`), after the push, before `cleanup()` removes the worktree — never from `ctx.repoRoot`.** `deliver.ts:937-943`'s comment is the authoritative reason: `tmpwt` holds `origin/<main>` as of the moment this release's booking branch was cut (i.e., after every release that landed before it in the same sweep), while the main checkout holds whatever was last fetched, unrelated to release ordering. This is the exact bug `shared-issue-reads-the-post-push-tree.test.ts` guards against, and `finishRelease` already has the right-shaped `tmpwt` available at `release-finish.ts:276-298` — read it there, before `cleanup()` at line 297.

**The skip-list computation is the existing one, unchanged — reuse `siblingLinesOf`, `unfinishedIssuesOf`, `parsePlanSiblingLine`, `releaseIssueDecisions`.** All already exist in `deliver.ts` (`siblingLinesOf` at `:192-207`; the others imported from `@plot-pm/domain/rules/issue-status` at `:25`). Move `siblingLinesOf` into the new module (it is a private helper, not exported, so nothing else needs updating), and import `unfinishedIssuesOf`/`parsePlanSiblingLine`/`releaseIssueDecisions`/`releaseIssueSummary`/`trackerReportOf` from the domain into the new module the same way `deliver.ts` does today.

**A shared issue stays open through the sibling read — and `finishRelease` can book several plans sharing one issue in a single run.** `deliver.ts:930-935`'s comment is about one released plan vs. unfinished siblings outside the booking; under `finishRelease`, two plans *inside the same booked batch* can also name the same issue. Read every sibling once per finish run (not once per plan in the batch), and treat every *other* booked plan in the same run as "finished" for the purposes of `unfinishedIssuesOf`, the same way `deliver.ts` already treats the released plan itself as finished (it is excluded via `excludeFile`). The plan's test ("A shared issue stays open through the sibling read") names the shape: plans A and B booked together, plan C left Delivered outside the sprint, all three naming `#999` — A and B both get `--skip-issue 999` (because C is still unfinished), but with no C, neither A nor B passes a skip flag (each already-booked sibling no longer counts as "unfinished" against the other).

**Tracker failure never changes the caller's exit code, and the step continues to the next plan.** `deliver.ts:972-976`'s `trackerReportOf` pattern is the one to reuse — a `plot-plan-state.sh` failure on one plan prints `tracker=failed <issue>` for that plan and the loop moves on to the next booked plan. A `Refused` thrown inside the step for one plan (e.g. a failed temp-copy write) counts as that one plan's failure; it must not propagate up into `finishRelease`'s own `catch` at `release-finish.ts:299-305`, whose warning text says nothing was pushed — which would be false once the push already landed.

**`finishRelease` ends with one summary line in the shape `summary: issues closed=<N> left-open=<M> (<reasons>)`**, aggregated across every plan the run booked — not one line per plan. This is the line step 5b of `skills/plot-release/SKILL.md` is meant to read (per the Documents section); match `deliver.ts:1014`'s existing `issueSummary`/`reasons` construction.

**`release-scope-mismatch` is not this slice's concern.** The sibling slice adds that refusal inside `releaseFinish` itself, before any write; if it lands first, the tracker step simply never runs for a refused call, same as today. Do not add scope-mismatch handling here.

### Done when

The plan's `## Tests` section is the specification. In order:

- One `plot-plan-state.sh` call per booked plan, each shaped `[<copy>, '--phase', 'released', '--plan-link', <rel>, '--version', <tag>, ...]`, whose temp file reads `State: Released` — whether or not the plan names an `Issue:`. Today, through `finishRelease`, the count is 0.
- A rejected push makes no tracker call at all (`tracker=skipped`); a rejected-then-accepted push makes exactly N calls, never 2N — this is the reason the step must run once over the *final* booked list, not once per `commitAndPush` reapply attempt.
- The shared-issue-stays-open fixture above (A, B booked together naming `#999`, C Delivered-but-not-booked also naming `#999`): A and B both skip; remove C and neither skips.
- A tracker failure on the first plan prints `tracker=failed <issue>` for that plan, continues, and the second plan's write still happens; the overall finish still returns 0.
- A domain-level unit test for the scope-mismatch refusal lives in `packages/domain/test/workflows-release-finish.test.ts` — that test belongs to the sibling slice, not this one, but if it lands first expect that file to already have new cases; don't revert them.

Existing tests that must stay green, unchanged in intent:
- `packages/board/test/unit/release-finish-real-repo.test.ts` — its `:235` "a second run writes nothing" case, restated: no new commit, no tracker call. Its `sprint()`/`startSprint()` fixtures may gain a `Release:` line if the sibling slice lands first; that is not this slice's edit to make.
- `packages/board/test/unit/shared-issue-reads-the-post-push-tree.test.ts` and `packages/board/test/unit/deliver-plan-state.test.ts` — the regression guard for the extraction. Both stub `plot-plan-state.sh`/`plot-issue-status.sh` through the scripts port; neither reaches a built bundle or a real host.
- `test/reconcile/release-tells-the-tracker.test.mjs` stays green unchanged.

Plus: the repo's gates — no committed `board-server.mjs` diff, a changeset naming `plot` with a `plot-release` bump (see Documents section below), and the usual TypeScript/domain gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; it maps changed paths (`packages/board/**`, `packages/domain/**`) to the right suites. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` is unlikely to matter here — this slice is pure TypeScript — but if any `.sh` file changes incidentally, growth is paid for in the same change.

### Documents

Update alongside the code, per the plan's `## Design > Documents` section:
- `skills/plot-release/SKILL.md` step 5b and its Model Guidance row: say that `release-approve` now tells the tracker for each plan it books, and that `plot-deliver.mjs --release <tag> <slug>` repairs a missed write per plan.
- `CLAUDE.md`, the `release-approve` sentence in *The Master Agent Uses The Controllers*: name the tracker step. (If the sibling slice already added the `release-scope-mismatch` refusal sentence there, add the tracker-step sentence alongside it, then run `./scripts/check-agents-md.sh --write`.)
- Plan `docs/plans/2026-11-01-an-issue-shows-its-plan-s.md` (#2997): its *What already works* line claims release writes `plan:released` (`deliver.ts:969`) — true only for `runRelease` until this slice lands. Add a line to its `## Notes` recording the correction and naming this plan.
- A changeset for `plot` with a `plot-release` bump (patch or minor — this is new behavior for `release-approve`, so minor is the better fit per the plan's own Versioning rules in `CLAUDE.md`).

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`bug/release-approve-tells-its-tracker` under `### Tracker step`).

### Scope guard

This branch owns: the new `packages/board/src/server/entry/release-tracker.ts` module, the edits to `deliver.ts` and `release-finish.ts` that call it (including `FinishContext`'s new `scriptDir` field and `main.ts`'s wiring of it), and the doc/changeset updates listed above.

It does not own: the `release-scope-mismatch` refusal inside `releaseFinish` or any change to `FinishSprint`'s shape (both `bug/release-finish-refuses-another-sprint`, → #3079); the per-issue decision rules in `rules/issue-status.ts` (unchanged, only re-imported from a new call site); and `plot-issue-status.sh` / `plot-plan-state.sh` themselves (unchanged — this slice is a caller, not a rewrite of the tracker scripts).

The sibling branch shares two files with this one (`release-finish.ts`, possibly `CLAUDE.md`). Check its current diff before opening this PR, and flag — rather than silently resolve — any overlap in the `## Status` or `CLAUDE.md` sections both touch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
