## Implementation brief — a-plan-that-joins-a-sprint (wave: Approve and deliver)

- **Plan (canonical):** docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3000 merged
- **Branch:** `feature/approve-and-deliver-find-the-sprint-by-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plot-review GitHub App required on main since 2026-10-15)

This branch waits on `feature/sprint-membership-is-one-rule`, which is already merged (PR #3002, now on `main`). It is the only branch this wave needs — the Writer and Gate waves may run in parallel with this one, and the Repair wave waits on this one plus the Writer.

### What to build

`annotateSprint` (`packages/board/src/server/entry/approve.ts:747-771`) and `tickSprint` (`packages/board/src/server/entry/deliver.ts:574-599`) currently pick a sprint file by directory scan and literal substring match on `[slug]` — first file in the sorted directory listing whose text contains the needle, in *any* section of that file (including `### Deferred` or `### Scope Changes`). That is wrong whenever a plan is carried over into a second sprint, or when the sprint directory happens to list a Closed sprint before the Active one alphabetically: `f57425ec0` (2026-10-23) ticked the `### Deferred` line of a Closed sprint while the plan's field correctly named a different, open sprint.

Change both functions to:
1. Read every sprint file in the sprint directory (as `PlanStore.listDir` + `readText` already do) into `{ file, content }[]` shaped as `SprintFile` (`packages/domain/src/rules/sprint-membership.ts:14-19`).
2. Call `sprintOfPlan(slug, sprints)` from `@plot-pm/domain` (exported at `packages/domain/src/index.ts:627`) to get `{ sprint, file } | null`.
3. Edit only that one file — never scan-and-match the first file containing the needle.
4. Drop the empty-field guards: `approve.ts:754` and `deliver.ts:583` currently short-circuit to `'none'` when the plan's `Sprint:` field is empty, even when a sprint file lists the plan. `sprintOfPlan` makes the field irrelevant to this lookup — remove both guards so a plan with an empty field still gets annotated/ticked when some sprint file lists it.
5. `annotateSprintItem` and `tickSprintItem` (`packages/domain/src/rules/sprint-annotation.ts`, `packages/domain/src/rules/sprint-tick.ts`) currently match the first line in the whole file containing `[slug]`, without regard to section — so they can write to a `### Scope Changes` log line or a `### Deferred` line instead of the actual Must/Should/Could member line. Both need to use `memberLineIndex(content, slug)` (`sprint-membership.ts:125`) to locate the line first, and edit only that index. If `memberLineIndex` returns `-1`, the outcome is `'missing'` (annotate) / unchanged (`changed: false`, tick) — same contract as today, just scoped correctly.
6. `deliver.ts:361` currently stages the whole sprint directory; change it to stage the one sprint file `tickSprint` actually wrote (mirroring `approve.ts`'s `stageApproval`, which already stages by file name for exactly this reason — "a leftover `*.tmp`... or an unrelated sprint edit stays unstaged").

### Decisions already settled — do not re-derive them

**Use `unstruckSprintMembers`, not `sprintMembers`.** The plan's Design section and Done-when table name the rule `sprintMembers` throughout (e.g. plan.md:65, :148-154). The merged code (`feature/sprint-membership-is-one-rule`, PR #3002) exports it as `unstruckSprintMembers` (`packages/domain/src/rules/sprint-membership.ts:44`), and the test file already uses that name (`packages/domain/test/sprint-membership.test.ts:3,30,36,66`). This is a naming drift between the plan and what actually landed — do not go looking for a `sprintMembers` export, and do not add one. You will not call `unstruckSprintMembers` directly in this slice anyway; you only need `sprintOfPlan`, which already wraps it.

**`sprintOfPlan`'s tie-breaking is already decided and tested** (membership rule slice, merged): prefers a non-Closed sprint, then the latest `Start:` (placeholder `YYYY-MM-DD` dates sort as `-Infinity`, i.e. lose to any real date), then the file name that sorts last. You do not need to re-implement or second-guess this — call it and trust the `{ sprint, file } | null` it returns.

**The empty-field guard removal is deliberate, not a side effect to avoid.** The plan's whole point (Motivation, "Measured cases") is that `the-commit-gates-match-only-the` was delivered with no `Sprint:` line and got skipped (`tickSprint` returned `'none'`). Removing the guard is required behavior, proven by the Done-when row "Deliver ticks with an empty field."

**`memberLineIndex` only recognizes Must/Should/Could tier lines** (`MUST_SHOULD_COULD` regex at `sprint-membership.ts:114`) — a line under any other `##`/`###` heading, including `### Deferred`, returns no match for that heading and `inTier` stays false. So scoping `annotateSprintItem`/`tickSprintItem` to `memberLineIndex` is also what makes them stop touching Deferred/Scope-Changes lines; you do not need a separate "skip this heading" check.

**Rule carried over from sibling work — absence is not false.** `listed.ok` can be false (e.g. `listDir` failing) and must be handled the same way an empty list is — skip to return `'missing'`/`'none'`, never throw, matching the existing `(listed.ok ? listed.value : [])` pattern already in both functions.

### Done when

The plan's `## Done when` table rows tagged "Approve and deliver" are the specification:

- Deliver ticks the sprint the rule answers, old and new code disagree (`deliver-retry-real-repo.test.ts`, using a fixture built from the W42 / `bugfix-2-28-1` texts at `f57425ec0^`) — this is the regression test for the exact incident in Motivation.
- Deliver ticks with an empty field (`deliver-retry-real-repo.test.ts`) — proves the guard removal.
- Approve annotates with an empty field (`approve.test.ts`).
- Annotation and tick skip a log line (`rules-sprint-annotation.test.ts`, `sprint-tick.test.ts`) — proves `memberLineIndex` scoping, not just substring match.
- Deliver stages one sprint file (`deliver-retry-real-repo.test.ts`) — an unrelated edit in another sprint file must stay unstaged.

Each of these exists because the naive version (keep the directory-scan-and-substring-match, just swap in `sprintOfPlan` for display purposes without changing what gets edited) would still pass a shallow smoke test but miss the actual defects the plan measured.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves related domain/board tests and typechecks for the paths this slice touches. The `CI suites` config key's suites run in CI only; do not run them locally (especially not `test:e2e`, which dispatches real workers and is CI's gate, not a local one). A changeset is needed per the plan's versioning rules (bumps `plot` or `@plot-pm/board` per `check-changeset-packages.sh`).

`scripts/check-shell-lines.sh` only matters if this slice touches a `.sh` file under `skills/` — it does not; this slice is TypeScript only (`approve.ts`, `deliver.ts`, plus the two domain rule files), so the shell-line ratchet does not apply here.

### Bookkeeping

Open the PR through the controller once there is a commit to show:

```bash
../plot/scripts/plot-open-pr.sh          # or --draft while work is still moving
```

Do not run `gh pr create` by hand. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/approve-and-deliver-find-the-sprint-by-rule` row under `### Approve and deliver`).

### Scope guard

This slice owns: `packages/board/src/server/entry/approve.ts` (the `annotateSprint` function and its stage call), `packages/board/src/server/entry/deliver.ts` (the `tickSprint` function and the stage call near `:361`), `packages/domain/src/rules/sprint-annotation.ts`, `packages/domain/src/rules/sprint-tick.ts`, and the four test files named in Done-when (`packages/domain/test/rules-sprint-annotation.test.ts`, `packages/domain/test/sprint-tick.test.ts`, `packages/board/test/unit/approve.test.ts`, `packages/board/test/unit/deliver-retry-real-repo.test.ts`).

Other branches in this plan, verified at dispatch time:
- `feature/sprint-membership-is-one-rule` (Membership rule) — already merged into `main`; this slice is a pure consumer of its exports (`sprintOfPlan`, `memberLineIndex`), no file overlap.
- `feature/a-plan-joins-a-sprint-through-one-command` (Writer) — new files only (`packages/domain/src/transitions/sprint-member.ts`, `packages/board/src/server/entry/sprint-member.ts`, `skills/plot-sprint/SKILL.md`, build wiring); no overlap with this slice's files.
- `feature/a-sprint-member-names-its-sprint` (Gate) — new files only (`packages/domain/src/rules/sprint-member-gate.ts`, `scripts/check-sprint-members.sh`, `.github/workflows/ci.yml`); no overlap.
- `bug/the-delivery-loop-sprint-is-repaired` (Repair) — touches only `docs/sprints/2026-W44-delivery-loop.md`, and waits on this slice plus the Writer; no overlap.

No file collisions are expected with any sibling branch. If you find something the plan did not anticipate, report it rather than improvising outside scope.
