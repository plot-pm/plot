## Implementation brief — every-loop-ending-has-a-supervisor-rule (wave 3: Endings that ask a person)

- **Plan (canonical):** `docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `infra/an-unrepaired-ending-asks-a-person` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issues #1274, #1288, #1281

Wave 1 (#1371) built `endingAction` and wave 2 (#1384) moved `corrections-spent`, `turn-limit` and the after-prompt `holding-work` into it. Both are on `main`; this is the last wave of the plan. Keep the verdict type and the readings' shape stable: add fields, rename none.

### What to build

Five endings have no rule in `endingAction` today and answer `leave` (`packages/domain/src/rules/ending-action.ts`): `blocked`, `spend-limit`, `unstarted`, `run-limit` and `checks-unanswered`. A desk that ended one of these has no manifest (the exit trap removed it), so `supervise` never sees it, and nothing writes the question where a person looks. The two escalations that exist write a `blocked` declaration instead (`applyFreshAgentDecisions`, the `escalate` branch, `registryd.ts` near line 890), and `questionEscalation` lists a desk only for a `PLOT-BLOCKED.md` marker. A declaration is not a marker, so a slice stopped on a spent run count sits claimed with nobody told.

Build, in this order:

1. **The `needs-a-person` rows.** `endingAction` answers `needs-a-person` for `blocked`, `spend-limit`, `unstarted`, `run-limit` and `checks-unanswered`, on the same `hasManifest` guard as every other row. No `priorFreshSessions` branch: none of the five earns a fresh session.
2. **A marker composer.** A pure function next to the rule that takes the ending reason, the branch and the ending's `detail`, and returns the marker text. It names the reason and the `detail` (for `checks-unanswered`, `no-answer` or `tip-moved`) and says in one sentence what a person decides. The reasons differ in the repair, so the text differs per reason: `unstarted` says the invocation is broken, `run-limit` and `spend-limit` say the slice spent its count or its money, `checks-unanswered` says no build answered. Cover each reason with a test that asserts its own wording.
3. **The tick writes the marker.** Replace the `sealDeclaration(worktree, branch, 'blocked')` call for `needs-a-person` with `Desk.writeBlockedMarker(worktree, text)` (`ports/desk.ts:79`). Apply it to the two verdict sources, the five new endings and the three that already reach `needs-a-person` (`corrections-spent`, `turn-limit`, after-prompt `holding-work`). The readings need two additions: the ending's `detail` and whether the desk already holds a `PLOT-BLOCKED.md`.
4. **`escalated` becomes "a marker exists".** `FreshAgentCandidateReadings.escalated` reads the declaration today (`registryd.ts:705`). The next tick must not repeat the write, and the marker file is what `questionEscalation` reads, so the marker is the right fact. Decide whether the declaration write stays beside it; keep it only if a reader of the declaration on a manifest-less desk needs it (grep for `status === 'blocked'` readers before you decide, and say what you found in the PR).
5. **One population, one verdict.** `freshAgentCandidateTrees` and `nothingDoneCandidateTrees` are the same filter, and both steps now call `endingAction` (`startFreshAgents` and `startNothingDoneReleases` in `registryd-main.ts`). The new endings need an apply step; put the marker write in the step that already holds `Desk`, and assert in a test that one desk gets one verdict and one write per tick.

### Settled decisions — do not re-derive them

- **The marker is the existing escalation path.** `questionEscalation` (`rules/question-escalation.ts`) lists the desk in WAITING ON YOU and notifies through `Notify command` as the marker ages. Build no second path, no new notifier, no new ladder. The plan's Notes say so, and `a-blocked-ending-routes-its-answer` already routed the answer side.
- **`writeBlockedMarker` never overwrites.** Several endings already left a marker: `unstarted` (`agent-loop.ts` ROW 7, near line 650), `corrections-spent` (line 429) and `blocked` where the agent wrote its own. Others leave only a declaration: `run-limit` (line 334), `spend-limit` (line 357), `turn-limit` and `checks-unanswered` (lines 874, 880). So the supervisor write is a no-op for the first group and the one that tells a person for the second. Do not add a check that skips the write for `unstarted` or `blocked`; the port's guard is the guard, and a second guard is a second place to drift.
- **A second marker is not an answer.** A desk that holds a marker answers a repeat tick with no write and no notification. Test the second tick by name: same readings plus the marker, zero writes.
- **`blocked` is "ask a person (unchanged)".** The agent already asked. The row exists so the table is total and `supervise`'s own `blocked` answer and this one agree. Do not rewrite the agent's marker text.
- **`limited`, `spent`, `unregistered`, `bound`, `quiet` and `unreadable` keep answering `leave`.** The plan's Open Questions own them (`limited` restart on reset, `spent` fresh agent). Moving any of them is a design change, not this slice.
- **A manifest-named desk answers `leave` for every ending.** Same reason as waves 1 and 2: the ending and the manifest's removal are not one atomic write.
- **The marker file blocks `releaseClaim`.** `releaseClaim` refuses on a `PLOT-BLOCKED` marker (see `applyNothingDoneDecisions`). That is correct here: a claim a person has been asked about stays until they answer. Do not clear the marker to release.
- Carried-over invariants: absent is not false (a missing ending answers `leave`; an unreadable marker read is "no marker", which at worst repeats a no-overwrite write); read the exit code, not the emptiness; a pure rule reads no disk, so a restarted supervisor reaches the same action from the same files.

### Done when

The plan's `## Done when` list is the specification. Three bullets belong to this branch: one `endingAction` test per `needs-a-person` row, with a manifest-named desk answering `leave`; the registry tick writing a marker for an `unstarted` ending that `questionEscalation` lists; and the old escalation write gone from the tick.

Assertions that exist because a naive implementation passes without them:

- **The marker test calls `questionEscalation` on the marker the tick wrote.** A test that asserts only "`writeBlockedMarker` was called" passes with a file the escalation ladder never lists. Feed the written text and its `askedAt` through the real rule.
- **Each of the five reasons has its own marker wording.** A composer returning one fixed sentence passes a "writes a marker" test and fails the person who needs to know whether to fix a prompt or raise a limit.
- **`checks-unanswered` carries its `detail`.** A marker that drops `no-answer` versus `tip-moved` hides which of two different repairs applies.
- **A `run-limit` desk with only a declaration gets a marker.** This is the case wave 2's `escalated` reading hid: the declaration said `blocked`, so a declaration-based `escalated` suppressed the write and no person was asked. Assert that a desk with a `blocked` declaration and no marker still gets the write.
- **A `corrections-spent` desk that already holds the loop's marker gets no second one.** The no-overwrite port answers, and the test asserts the marker text is unchanged.
- **After-prompt `holding-work`, take-up `holding-work` and the five new reasons in one table-driven test.** A row keyed loosely on `ending` alone either escalates a take-up that should release or leaves a new reason at `leave`.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. New domain code is arrow functions with factual TSDoc (behaviour only, history in the commit message); the domain imports `zod` and nothing else outside `adapters/`. Add a changeset (description first, `bumps:` block last, `plan:` line inside the comment block, never first). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain; the gate has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. When this PR merges, the plan's three slices are all merged and `/plot-deliver every-loop-ending-has-a-supervisor-rule` closes it.

### Scope guard

This branch owns `packages/domain/src/rules/ending-action.ts` and its test (`packages/domain/test/rules-ending-action.test.ts`), `packages/board/src/server/entry/registryd.ts`, `registryd-main.ts` (the marker write and the readings), and `packages/board/test/unit/fresh-agent-tick.test.ts` and `nothing-done-tick.test.ts`. `agent-loop.ts` and `entities/ending.ts` are read-only here: the endings and the markers the loop writes are earlier waves' and are not changed by this one. `question-escalation.ts` is read-only: the marker feeds it, and it changes for nobody.

Branches in flight, verified 2026-10-08 with `git ls-remote --heads origin`: only `changeset-release/main`, which is generated. No other branch of this plan is in flight. Rebase onto `main` before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
