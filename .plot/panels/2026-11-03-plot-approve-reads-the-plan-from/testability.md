# Testability juror: plot-approve-reads-the-plan-from

Position: amend

Lens: the test plan. Read on `origin/main` at `ee678d5c8`.

## Rubric

1. **Fix and sprint goal.** The approach fixes the split for the not-in-checkout shape only. A reader verifies it by one board unit test in which `pr-merge` is called for PR A on `main` and is not called after the fix. That test is buildable (see 6), but the plan does not say which checkout shape it uses, and only one shape reproduces the defect. The fix removes a silent wrong merge, so it moves the sprint toward zero interventions.
2. **Code claims.** The line numbers hold: `approve.ts:441-458` (`remotePlanOf`, `planPrsCarrying` at :453), `plan-pr.ts:174-183`, `plan-pr.ts:205-219`, `approve.ts:934-945`, `needs-design.ts:232`, `needs-design.ts:393-397`, `workflows/approve.ts:325-333`. One claim is incomplete: Design step 1 says both controllers "ask the same rule". `needs-design.ts:225-239` holds its OWN `planPrOf`, not the domain's. Its order differs: `idea/<slug>` wins only when OPEN, then the first carrying open PR, then a CLOSED or MERGED `idea/<slug>`. The domain `planPrOf` (`plan-pr.ts:205-219`) takes `idea/<slug>` in any state. So moving needs-design onto the domain rule also changes which PR it chooses when `idea/<slug>` is CLOSED and a rival is open. The plan does not name that behaviour change, and no test pins it.
3. **What it leaves half-done.** `pr-ambiguous` exists in two workflows: `workflows/approve.ts:331` and the spike workflow at `workflows/approve.ts:508` (tested in `approve-spike.test.ts:133`). The plan names only the first. A new reason also needs a `refusalText` case (`board/src/server/entry/approve.ts:573` holds the `pr-ambiguous` one), the refusal list in `skills/plot-approve/SKILL.md:397`, and a changeset with a skill bump. None is named.
4. **Failure modes.** One mode has no named outcome. When `idea/<slug>` is CLOSED and an open rival carries the plan, the controller reads the plan from the rival today (`remotePlanOf`) and the workflow refuses `pr-closed`. After a reorder the controller reads the plan from the CLOSED head. `openPrsOf` (`approve.ts:342-361`) fetches only open heads, so `holdsCommit`/`showFile` can fail, `readPlanAt` returns undefined, and the refusal becomes "no plan found" or "cannot parse" instead of `pr-closed`. The plan must name the outcome and test it.
5. **Unattended build.** Three Open Questions are unanswered, and the slice test depends on them. "Copies differ" is undefined: blob oid, text, or parsed record fields (`Review:`, phase, slices). A byte change in prose only gives different answers under each choice. An agent must not choose this; the interrogation round must.
6. **Test plan.** See the findings below.

## Findings on the test plan

**F1. The named board test can be built, but only in the default-branch shape, and the plan does not say so.** `findPlanFile` reads the checkout first (`approve.ts:883-888`). Where the checkout holds the plan, `remotePlanOf` never runs, the record comes from the checkout, and the defect does not reproduce. The test must use `planStore: planStoreFixture({ files: {} })`, the shape of `ctxDefaultBranch` (`approve.test.ts:285-292`). The in-checkout shape keeps a split of its own (the checkout copy against the merged head), and the plan neither covers it nor scopes it out.

**F2. `planStoreFixture` cannot parse a copy read from a revision, so the plan's test cannot see two different copies without a wrapper.** `readPlanAt` (`approve.ts:304-317`) writes the text to a fresh `mkdtempSync` path and calls `planStore.readPlan(scratch)`. The fixture's `readPlan` (`plan-store-fixture.ts:79-82`) answers only from records keyed by their fixed `file`, so every remote read returns undefined. No test in `packages/board/test/unit/approve*.ts` drives a successful remote read today. The test needs a `planStore` whose `readPlan` maps the text last written by `writeText` to a record, for example by `Review:` line. The plan must say this, or a Sonnet agent will find that its test refuses "no plan found" on `main` and on the branch, and so proves nothing.

**F3. The rest of the fixture is sufficient.** `hostFixture.prList` returns its `prs` in the order given (`host-fixture.ts:188-189`), so the rival is listed first by listing it first. `prState('idea/<slug>')` finds PR A by `head` (`host-fixture.ts:152-155`). `refsFixture` answers `resolve` from `shas` keyed literally (`<sha>^{commit}` per head), `changedFiles` keyed by the head SHA, `showFile` from `files` keyed `<sha>:<file>`, and `listBlobs` from `trees` (leave `origin/main` empty). `scriptsStub` records the `pr-merge` call and refuses it (`approve.test.ts:28-33`), so "merged PR A" is observable as a recorded `['pr-merge', '<A>', ...]` call. With PR B carrying `Review: pr` and PR A carrying a copy whose slices or `Review:` differ, the test fails on `main` (a `pr-merge` for A is recorded) and passes after the fix (a named refusal, no `pr-merge`, no `commitStatus` write).

**F4. One test is not enough for the stated behaviour.** The Changelog promises two outcomes: differing copies refuse, equal copies proceed. Name a second board test where both copies are equal and the approval merges `idea/<slug>`. Without it, an implementation that refuses whenever a rival exists passes the named test, and that would block the batch shape (`idea/batch-<first-slug>`, `plan-pr.ts:163-165`).

**F5. The plan names no domain test, and the domain pure side is held at 100 %.** `packages/domain/vitest.config.ts:71-72` sets 100 lines, branches, functions and statements on `src/!(adapters)/**`. A new ask or comparison in `rules/plan-pr.ts` and a new reason in `workflows/approve.ts` (and in the spike workflow, if the reason goes there too) fail CI's coverage suite without tests. Name them: `packages/domain/test/rules-plan-pr.test.ts` (named PR with a rival whose copy differs, and one whose copy is equal), `packages/domain/test/workflows-approve.test.ts` beside the `pr-ambiguous` cases at :450-456, and `packages/domain/test/approve-spike.test.ts` if the spike workflow gains the reason.

**F6. needs-design has no controller test, and the plan names none.** No unit test drives `run` in `packages/board/src/server/entry/needs-design.ts`. `needs-design-route.test.ts` tests only the HTTP route, and `plan-actions-needs-design.test.ts` tests only the menu. The plan changes this controller without a test that fails before the change. `run` reads `PLOT_UNATTENDED` and builds its context inside, so a test needs either an exported `perform(ctx, args)` seam like approve's, or a refusal-only test through `run` with stubbed ports. Name which. Also `packages/domain/test/workflows-needs-design.test.ts` must cover any new refusal in `workflows/needs-design.ts`.

## Amendments required

1. Name the checkout shape of the board test: the plan is absent from the checkout (`planStoreFixture({ files: {} })`), as `ctxDefaultBranch` in `approve.test.ts`. State whether the in-checkout split is in scope or left out on purpose.
2. Name the `planStore` wrapper: a `readPlan` that parses, or maps, the text that `readPlanAt` wrote, so two remote copies give two records.
3. Add a second board test: equal copies on two open PRs proceed and merge `idea/<slug>`.
4. Add a board test for `idea/<slug>` CLOSED with an open rival, and name its expected refusal (`pr-closed` today).
5. Name the domain tests (`rules-plan-pr.test.ts`, `workflows-approve.test.ts`, and `approve-spike.test.ts` if the spike workflow changes) that keep `src/!(adapters)/**` at 100 %.
6. Name a needs-design test that fails on `main`, and the seam it uses. State that needs-design moves from its own `planPrOf` (`needs-design.ts:225-239`) to the domain rule, and test the CLOSED-named case where the choice changes.
7. Name the follow-on edits: the `refusalText` case, `skills/plot-approve/SKILL.md:397`, and the changeset.
8. Resolve the three Open Questions before approval, and define "copies differ" (blob oid, text, or parsed fields). The tests in F3 and F4 depend on that definition.

## Decisions that need a person

- The definition of "copies differ", and whether a rival with an equal copy beside `idea/<slug>` stays allowed (Open Questions 1 and 2).
- Whether needs-design may change its PR choice for a CLOSED `idea/<slug>` with an open rival.

## What I ran versus read

Ran: `git fetch origin main`, `gh issue view 3093`, `git show origin/main:<file>` and `git grep` over `approve.ts`, `needs-design.ts`, `plan-pr.ts`, `workflows/approve.ts`, `approve.test.ts`, `refs-fixture.ts`, `plan-store-fixture.ts`, `host-fixture.ts`, `vitest.config.ts`, and the test file list. Ran no test suite. I did not run the proposed test on `main`, so the claim in F3 that it fails on `main` is a reading of the code, not an executed result. F2 is also a reading: no test in `packages/board/test/unit/approve*.ts` reaches a parsed remote copy.
