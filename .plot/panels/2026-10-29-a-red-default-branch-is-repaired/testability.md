# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2904 (`gh issue view`), DESIGN-delivery-loop.md, sibling plans #2908 (roles), #2914 (one merge in flight) and #2909 (run log), `packages/domain/src/entities/default-branch.ts`, `rules/default-branch.ts`, `workflows/merge.ts`, `ports/refs.ts`, `ports/host.ts`, `packages/fleet/src/shared/default-branch-refresh.ts`, `registryd-main.ts:2863`, `scripts/check-state-declarations.sh`, and the fixture heads of `domain/test/default-branch.test.ts`, `domain/test/workflows-merge.test.ts` and `fleet/test/unit/default-branch-refresh.test.ts`. Ran: `pnpm install` in the worktree; `vitest run` on `domain/test/default-branch.test.ts`, `workflows-merge.test.ts` and `queue.test.ts` (3 files, 239 passed); `vitest run` on `fleet/test/unit/default-branch-refresh.test.ts` and `queue-reading.test.ts` (2 files, 110 passed). Also ran a scratch vitest probe (`juror-2904-testability/probe.test.ts`) against the domain sources: `advanceSettled`, `ancestorsToAsk`, `merge` and `defaultBranchRed`. Its results are quoted below.

## (a) Problem statement

- The cited facts hold. `registryd-main.ts:2863` reads `'default-branch-red': 'queue'`. `default-branch-refresh.ts` writes `failingRuns`, which is defined in `entities/default-branch.ts`. `queue.ts:583` is the only effect of the red reading on dispatch.
- **"The inputs to a repair exist" overstates the facts.** The plan's rule takes "the merge that turned it red" and measures the bound "from the first red reading that settled". The reading records neither one. `DefaultBranchReadingSchema` (`entities/default-branch.ts`) holds `headSha`, `head`, `settled`, `walked`, `failingRuns`, `headSince`, `askedAt` and `at`. `headSince` is when fleetd first saw the *head*, not the red settled commit. Probe result: `advanceSettled({sha:'G',state:'green'}, 'R', 'red')` returns `{"sha":"R","state":"red"}`, and the last green SHA is gone. So no reader can recover either the breaking merge or the red-since time after the transition. This is the missing cause the rule depends on.
- **A cause is missing: the merge controller refuses every merge while main is red.** `workflows/merge.ts:127-128` returns `default-branch-red` whenever `settled.state === 'red'`. Probe result: a green, ready revert PR with a fresh red reading gives `{"outcome":"refused","reason":"default-branch-red","detail":"main is red on R. A merge now stacks a change on an unproven base."}`. Step 3 sends the revert merge "through `workflows/merge.ts`", and step 2 sends the fix PR "through the same loop". Both would be refused by the controller the plan names. Three tests pin that refusal today: `domain/test/workflows-merge.test.ts:128`, `:165` and `board/test/unit/merge-entry.test.ts:135`. Sibling #2914's `slicePrNext` also maps "Default branch red or stale" to hold (its plan, line 38). "Jumps the queue" therefore needs an explicit exemption in two rules, and the plan names neither.

## (b) Approach

- Step 1 follows the layering rule and "A Decision Reads The Index": a pure rule over values. Good. It is provable only once its inputs exist (see (a)).
- **The merge exemption is a contract change and needs its own decision.** A repair or revert PR must merge while main is red. That needs a reading the controller can check, for example a `repairs: <red sha>` field on the repair record that the controller reads, so that no caller can claim the exemption by naming itself. Without that field, the change either weakens `default-branch-red` for everyone or is not built.
- **No port can make a revert.** `ports/refs.ts` has no commit, revert or push operation. `ports/host.ts` has `prCreate` (`:302`) and `prMergeCommit` (`:260`) but no revert. Slice 3 therefore needs a new adapter operation, and the plan does not name it. This repo squash-merges (`plot-host.sh:124` `pr-merge … [--squash]`), so a slice's landing is a single-parent commit: `git revert <sha>` needs no `-m 1`. A merge-commit host needs `-m 1`. The adapter test must cover both shapes.
- **The repair record is a lifecycle.** Its states run idle → repairing → reverting → done or exhausted. A `z.enum` for it needs `// plot-state: lifecycle <entity>` and a `packages/domain/src/transitions/<entity>.ts` rule, or `scripts/check-state-declarations.sh` fails (lines 33-38 and 147-154). The plan's "shape left to the builder" hides a gated cost.
- **Do not extend `default-branch.json`.** `DEFAULT_BRANCH_VERSION = 1` is a literal, and `decodeDefaultBranch` returns null for another `v`. Null holds nothing, so a v2 file makes `plot-ask.mjs merge` and the board read "no reading" until they are rebuilt. Keep `redSince`, `lastGreenSha` and the culprit in the repair record. fleetd writes them on the green→red transition it observes.
- The rule has no terminal outcome. `hold | start-repair | await-repair | revert | none` cannot express "the revert PR is red too", "no merge can be named (a flaky or infra red, or a direct push)", or "the revert conflicts". Each one loops silently, which the design's *Stalls* section forbids. Add `exhausted` (notify, and start nothing more).

## (c) Slices

- Slice 1 (rule) is right as the first cut. It must also carry the repair-record entity, its transitions rule, and the config parser.
- **Add a slice, or name the work inside slice 2: the controller exemption** in `workflows/merge.ts`, plus the matching arm in #2914's `slicePrNext`. It must merge before slices 2 and 3 can ever merge anything.
- Slice 3 bundles three things with different tiers and owners: the revert PR, a new slice heading on the plan, and a ticket. Split "the reverted work comes back" into its own slice. It writes a plan file on main, which needs a controller (`reslice` exists, HTTP only) or a plan PR. A Delivered plan that gains an unmerged heading is also not dispatched by anything: `auto-dispatch` takes approved plans. The plan does not say who builds the new branch.
- Dependencies beyond #2902: #2908 builds `main-repair.md` (its line 62, `feature/role-agent-definitions`), the role parameter on `agent-run` (its line 58), and the unattended caller identity on `merge` (its line 66). The sibling plan for issue #2900 (PR #2917) supplies `plot/review`, which the ruleset requires on the repair and revert PRs. #2909 supplies the run log that the plan's board-impact line relies on.

## (d) Open questions

1. *`waits:` or issue link?* Use `waits:` on slices 2 and 3 against #2914's `feature/fleetd-merges-one-at-a-time` and #2908's `feature/fleetd-caller-identity`. An issue link stops nothing. This verdict did not check whether `waits:` resolves branches across plans. The plan should state it.
2. *Who adds `main-repair.md`?* #2908 does (its line 62). This plan must not add it, and must wait for it.
3. *Which merge turned main red?* No reader can answer this today, because the last green SHA is lost (probe above). With `lastGreenSha` recorded, `ancestorsToAsk(['H','M3','M2','M1','G'], 'H', {sha:'G',state:'green'}, 5)` returns `['M3','M2','M1']` (probe). Any of the three can be the culprit, and the earliest is not proven. Proposal: ask `runsForSha` per candidate, oldest first. The culprit is the oldest candidate that is settled red. Where no candidate is red on its own (two greens that fail together), revert the whole range newest-first in one PR. This is a domain function over `(line, lastGreen, runsBySha)` and is unit-testable.
4. *A revert that conflicts?* Answer: `exhausted` plus a notification. The design gives conflict resolution to no role, and main-repair "writes a fix PR or nothing".
5. *A stale reading?* Yes. Probe result: `defaultBranchRed` returns `false` at `askedAt` 61 min old with `checksWaitMs` 3600000. In this repo `Checks wait` is 3600 s, the same as the proposed bound. The revert arm must require a fresh red, so a host that has failed for an hour never triggers a revert. This needs a named test case.
- New: what unit does `Main repair bound` take? The plan says "60 minutes". `Checks wait` and `Worker bound` are seconds (CLAUDE.md config). Use seconds (3600) and a `mainRepairBoundMsOf` parser that mirrors `checksWaitMsOf`.
- New: how many fix-forward attempts run before the revert? If the fix PR merges and main is still red, does a second main-repair start inside the bound?

## (e) Tests per slice

Every acceptance criterion below is checkable without a live fleet, a live host or a browser. The anti-goal ("reverted within bound plus one merge round") can only be shown end-to-end as a fleet unit test with a fake clock that drives several ticks. No test in the plan proves it as written.

- **Slice 1, domain unit**, `packages/domain/test/red-main-step.test.ts`. Fixture: the `reading()` helper of `workflows-merge.test.ts:33-43` (settled `{sha, state}`, `askedAt`), plus a repair-record literal and `now`. Table-driven assertions on the returned step:
  - null reading → `none`
  - green settled → `none`
  - red, `askedAt` older than `Checks wait` → `none`, never `revert`
  - red, no record → `start-repair`
  - red, record repairing, `now - redSince < bound` → `await-repair`
  - red, `now - redSince >= bound` → `revert`
  - red, revert in flight → `await-repair`
  - revert PR red, or no culprit → `exhausted`
  - pending head over red settled → still red

  Add culprit tests over a first-parent line, and the `mainRepairBoundMsOf('')`, `('0')` and `('word')` defaults. Add a `transitions/<entity>.test.ts` that refuses `done → repairing`.
- **Merge exemption, domain unit** in `workflows-merge.test.ts`. The repair PR named by the record merges while red. Any other PR still refuses `default-branch-red`: lines 128 and 165 stay green unchanged. Board unit `merge-entry.test.ts:135` stays green.
- **Slice 2, fleet unit**, in the style of `fleet/test/unit/default-branch-refresh.test.ts`: `refsFixture`, `buildFixture`, and an in-memory `DefaultBranchStore` rig at `:36`, plus a fake `AgentRun`. Assertions:
  - The first red tick calls `AgentRun.run` once with `role: 'main-repair'`, the failing run URL and the culprit SHA.
  - The second red tick calls it zero times.
  - The repair record holds the attempt.
  - A green tick clears the record.

  `registryd-tick.test.ts:959` already injects `defaultBranchRed: async () => true` and is the wiring point.
- **Slice 3, fleet unit plus adapter test.** Fleet unit: with a fake host, the first tick past the bound calls `prCreate` once with a revert branch, and the merge goes through `merge` pinned to the head. Adapter: a `node --test` or vitest case on a temp git repo. It squash-lands a commit, calls the new revert operation, and asserts that the tree equals the last-green tree. A second case covers a two-parent merge with `-m 1`, and a conflict case asserts the refusal. The ticket write uses a fake `Tracker`: one `ai-generated` issue that names the plan, only when the plan is Delivered.
- **Re-slice ("work comes back")**: a domain unit test over the plan text. A heading is added and the old slice line is untouched. The gate test `node --test test/reconcile/*gate*.test.mjs` passes with `check-plan-headings.sh`.

## Amendments

1. Correct Motivation: the reading lacks the red-since time, the last green SHA and the culprit. Record them in the repair record at the green→red transition, and do not bump `default-branch.json`.
2. Name the `workflows/merge.ts:127` exemption (and #2914's `slicePrNext` hold) as work, keyed to the repair record, with the tests above. Without it, neither the fix PR nor the revert can merge.
3. Add an `exhausted` outcome (revert red, no culprit, conflict) that notifies, and a fresh-reading precondition on `revert`.
4. Declare the repair record as a `plot-state: lifecycle` with a `transitions/` rule.
5. Name the new revert port operation and its adapter test (squash and merge-commit shapes).
6. Split "the reverted work comes back" out of slice 3, and name the controller that writes the heading and who dispatches it for a Delivered plan.
7. Add `waits:` on #2908 (role definition, agent-run role, caller identity) and #2914, and name #2917 (`plot/review` on repair PRs) and #2909 (run log).
8. Make `Main repair bound` take seconds, with a parser test.
