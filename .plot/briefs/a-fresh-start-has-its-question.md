## Implementation brief — every-loop-ending-has-a-supervisor-rule (wave 2b: Endings that get a fresh agent)

- **Plan (canonical):** `docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `infra/a-fresh-start-has-its-question` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issues #1274, #1288, #1281

This branch fixes the HIGH post-merge finding on #1384 (`infra/held-work-gets-a-fresh-agent`, merged 2026-10-08). It sits between wave 2 and wave 3 in the plan's `## Slices`. `infra/an-unrepaired-ending-asks-a-person` (wave 3) is already claimed and edits `registryd.ts` and `registryd-main.ts`, so this branch stays small and rebases cleanly under it: keep the verdict type and the readings' shape stable.

### What to build

#1384 made `endingAction` answer `start-fresh` for `holding-work` after a prompt and for `turn-limit`. The registry then starts the fresh agent through `startFreshSession` (`entry/registryd-main.ts:1391`), which calls `continueOnDesk` (`server/continue.ts:812`). `continueOnDesk` reads `markerIn(worktree)` first and refuses `no-question` when the desk holds no `PLOT-BLOCKED*` file (`continue.ts:823-830`). Those two endings leave no marker: ROW 9b ends `turn-limit` with a declaration only (`agent-loop.ts:680-682`) and ROW 11 ends `holding-work` with none (`agent-loop.ts:731-733`). Only `corrections-spent` writes a marker (`agent-loop.ts:427`). So for two of the three `start-fresh` endings, every tick registers the agent, is refused, deregisters it, and starts nothing. The slice stays held with nobody working it, which is the failure #1288 reported.

The refusal reached no test. `fresh-agent-tick.test.ts` injects `continueDesk` everywhere, and the one test that returns `no-question` (line 632) returns it from a stub to check the deregistration.

Build, in this order:

1. **A failing test first, through the real `continueOnDesk`.** Build a desk with no marker, a manifest that names it, and a `Worker command` that exits at once. Call `startFreshSession` with `continueDesk: continueOnDesk` and assert `started`. On `origin/main` it answers `refused` with reason `no-question`. Model the fixture on the real-path tests in `test/unit/continue-route.test.ts`; do not inject the workflow.
2. **The precondition depends on the caller.** `POST /api/continue` keeps refusing `no-question`: a person answers a question, and with none there is nothing to answer. The supervisor's fresh start has no question to answer; its `answer` is the supervisor's own instruction. Add an explicit input on `DeskContinuationInput` that `startFreshSession` sets and the route never sets, and skip the marker check only when it is set. Do not infer it from `fresh: true`: `fresh` says "new conversation", not "no question".
3. **The prompt stops claiming a question.** `composeContinuation` (`continue.ts:257`) always opens "A previous worker on this branch stopped to ask a question … The question has been answered below" and closes "The blocked marker that stopped the previous run is still in this tree. It is yours to delete". Both are false for a markerless desk, and a fresh agent told to delete a marker that does not exist looks for one. Give the no-question case its own opening and closing; keep the `corrections-spent` wording byte-for-byte, because that desk still has a marker. `question: ''` already skips the question section (`continue.ts:283`).
4. **`continueTarget` keeps its order.** `continueOnDesk` passes `question: true` to `continueTarget` with a comment saying the route refused `no-question` above (`continue.ts:864-868`). That comment becomes false for the supervisor path. Update it; do not change `rules/continue-target.ts`, whose first check (`no-question`) stays the rule for every other caller.

### Settled decisions — do not re-derive them

- **Do not write a marker to make the start pass.** A marker makes the desk `waiting`: `questionEscalation` lists it in WAITING ON YOU and notifies a person for a slice the supervisor is already handling, and `releaseClaim` refuses a desk holding one. Wave 3 writes a marker for exactly one purpose, asking a person; a marker written here would be indistinguishable from that.
- **Do not make the loop write a marker at `turn-limit` or `holding-work`.** `agent-loop.ts` ROW 9b and ROW 11 are wave 1's and wave 2's, they say in a comment why ROW 11 writes no declaration (`supervise` answers `correct`), and a marker there turns two supervisor-owned endings into questions for a person.
- **The route is not loosened.** `continue-route.test.ts` and `continue-control.test.ts` assert `no-question` for a markerless worktree; those tests pass unchanged. A person's "Continue with an answer" on a desk with no question stays a refusal.
- **The order inside `startFreshSession` stays.** Register, the workflow's checks, `beforeStart` (the record row), spawn. A refusal after the registration deregisters (`startFreshSession`, tested at `fresh-agent-tick.test.ts:628`). Removing the false refusal must not move the record row earlier than the checks that remain.
- **The fresh agent's `answer` is unchanged.** `freshAgentTurnLimitAnswer` and the held-work composer already say what to do; this branch changes how the start reaches the agent, not what it says.
- Carried-over invariants: absent is not false (a missing marker is "no question", never "already answered"); read the exit code, not the emptiness; a pure rule reads no disk, so the marker read stays in `continueOnDesk` and not in `endingAction`.

### Done when

The plan's `## Done when` list is the specification. The bullet that belongs to this branch is the registry tick starting one fresh agent for a `holding-work` ending; this branch makes it true on a real desk instead of a stubbed workflow.

Assertions that exist because a naive implementation passes without them:

- **The test runs the real `continueOnDesk`.** A test that injects `continueDesk` passes on `origin/main` today and proves nothing. Run the new test against `origin/main` first and confirm it fails with `no-question`, then against the fix.
- **A `turn-limit` desk and a `holding-work` desk each start.** Two endings, two desks, both markerless. A fix that special-cases one ending passes a single-ending test.
- **The prompt for a markerless start contains no sentence about a previous question or a marker to delete.** Assert on the composed text; a fix that only skips the check starts an agent told to delete a file that is not there.
- **The prompt for a `corrections-spent` desk is unchanged.** Assert the existing text, so item 3 cannot rewrite the marker case.
- **The route still refuses.** `POST /api/continue` on a markerless worktree answers 409 `no-question`; the explicit input is unreachable from the request body. A fix that reads the flag from the JSON passes the supervisor test and lets any caller skip the check.
- **A refused start still deregisters.** The existing test at line 628 keeps passing, so the registration cleanup is not lost in the move.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. New code in the board's files you write or rewrite is arrow functions, with factual TSDoc (behaviour only, history in the commit message); `composeContinuation` is a declaration you are passing through, so leave its form. Add a changeset (description first, `bumps:` block last, `plan:` line inside the comment block, never first). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain; the gate has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/continue.ts` (the marker precondition, `composeContinuation`'s wording for a markerless start, and `DeskContinuationInput`), the call in `startFreshSession` (`packages/board/src/server/entry/registryd-main.ts`, near line 1418), and the tests `packages/board/test/unit/continue.test.ts`, `continue-route.test.ts` and `fresh-agent-tick.test.ts`. `agent-loop.ts`, `entities/ending.ts`, `rules/ending-action.ts` and `rules/continue-target.ts` are read-only here.

Branches in flight, verified 2026-10-08 with `git ls-remote --heads origin`: `infra/an-unrepaired-ending-asks-a-person` (wave 3 of this plan; its brief owns `registryd.ts`, `registryd-main.ts`'s tick steps and `fresh-agent-tick.test.ts`, so the overlap is `registryd-main.ts` and that test file, in different regions) and `bug/the-sweep-counts-a-moved-claim-once` (not named by this plan; check its diff against `continue.ts` and `registryd-main.ts` before the PR). Rebase onto `main` before the PR, and expect wave 3 to rebase onto this branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
