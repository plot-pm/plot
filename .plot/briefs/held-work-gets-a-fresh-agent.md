## Implementation brief — every-loop-ending-has-a-supervisor-rule (wave 2: Endings that get a fresh agent)

- **Plan (canonical):** `docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `infra/held-work-gets-a-fresh-agent` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issues #1274, #1288, #1281

Wave 1 (`infra/an-ending-that-held-nothing-releases-its-claim`, #1371) merged on 2026-10-08 and built `endingAction`. Wave 3 (`infra/an-unrepaired-ending-asks-a-person`) waits on this branch and adds the `needs-a-person` rows for the other endings, so keep the verdict type and the readings' shape stable.

### What to build

On 2026-10-05 an agent ended `holding-work` with 8 changed files and no marker (#1288). The board showed `stalled`, no agent took the slice up again, and nothing escalated. A master session committed the work by hand. `endingAction` (`packages/domain/src/rules/ending-action.ts`) answers `leave` for that ending today, because only the take-up arm of `holding-work` has a row. The supervisor's two other fresh-agent answers still live in two separate rules, `freshAgentAfterCorrections` (`rules/fresh-agent.ts:94`) and `freshAgentAfterTurnLimit` (`rules/fresh-agent-turn-limit.ts:46`), which `freshAgentDecisions` composes at `entry/registryd.ts:733`.

Build, in this order:

1. **The `holding-work` row.** A `holding-work` ending with an empty `refusedAssignment` (or one equal to the ending's branch) is the after-prompt arm. `endingAction` answers `start-fresh` while `priorFreshSessions` is 0, and `needs-a-person` from the second. The take-up arm (`takeUpRefused`) keeps answering `release-claim`. Add a composer in the same family as `freshAgentTurnLimitAnswer` that tells the fresh agent to commit, check and push the held work, and names the held files.
2. **Move `corrections-spent` and `turn-limit` into `endingAction`.** Same readings, same answers (`start-fresh` once, then `needs-a-person`). Move the answer composers (`freshAgentAnswer`, `freshAgentTurnLimitAnswer`) next to the rule or keep them where they are and import them. Either way the verdict comes from one function.
3. **The registry tick calls `endingAction` for all of it.** `freshAgentDecisions` stops calling the two old rules and `nothingDoneDecisions` stops passing a hard-coded `priorFreshSessions: 0` (`registryd.ts`, near line 1035). Both steps read one population (`freshAgentCandidateTrees` and `nothingDoneCandidateTrees` are the same filter), so decide whether they become one step or stay two. Whichever you pick, one desk gets one verdict per tick.
4. **Delete the two old rules.** `freshAgentAfterCorrections` and `freshAgentAfterTurnLimit` have no caller afterwards, and their tests (`packages/domain/test/fresh-agent.test.ts`, `fresh-agent-turn-limit.test.ts`) pass against `endingAction`.

### Settled decisions — do not re-derive them

- **The held files come from a live read of the desk, not from the ending.** The after-prompt `holding-work` detail reads `the desk holds unlanded work: <refusal>` (`agent-loop.ts:667`), where the refusal is a kind such as `unpushed-commits` and no path. `Trees.dirtyPaths(path)` (`packages/domain/src/ports/trees.ts:99`) returns the paths. The tick reads it and hands the list to the composer as a value. The composer is pure and reads no disk. An unreadable result gives an answer that says the files could not be listed; it does not give an empty list, because absent is not false.
- **One fresh session per slice, whichever ending asked first.** `priorFreshSessions` counts rows in `.plot/state/fresh-agents.tsv`, and `freshAgentAfterTurnLimit` documents the same sharing. A slice that spent its fresh session on `corrections-spent` gets `needs-a-person` for a later `holding-work`. Test the cross-ending case by name.
- **A manifest-named desk answers `leave` for every ending**, as in wave 1 and as `freshAgentAfterCorrections` does. The ending and the manifest's removal are not one atomic write, and a second start would run two agents in one worktree.
- **`needs-a-person` keeps today's write in this wave.** The tick calls `sealDeclaration(worktree, branch, 'blocked')` for `corrections-spent` and `turn-limit` (`applyFreshAgentDecisions`, the `escalate` branch). Wave 3 replaces that with a `PLOT-BLOCKED.md` marker. Do not build the marker here, and do not change the `escalate` condition (`verdict === 'needs-a-person' && !escalated`), which stops the next tick repeating the write.
- **The take-up arm is not touched.** `release-claim` for a refused assignment, and `endingReleaseBranch` naming the refused assignment, are wave 1's and have tests. Moving the after-prompt arm must not make an empty `refusedAssignment` look like a take-up: assert both arms in one test.
- **Do not widen the answer table.** `blocked`, `spend-limit`, `unstarted`, `run-limit`, `checks-unanswered` and the open-question reasons (`limited`, `spent`, `unregistered`, `bound`, `quiet`, `unreadable`) keep answering `leave` in this wave. Wave 3 adds the first five; the plan's Open Questions own the rest.
- Carried-over invariants: absent is not false (a missing or unreadable ending answers `leave`, a failed count reads as zero sessions, never as "already had one"); read the exit code, not the emptiness; a pure rule reads no disk, so a restarted supervisor reaches the same action from the same files.

### Done when

The plan's `## Done when` list is the specification. Three bullets belong to this branch: the `endingAction` table rows for `holding-work` after a prompt, `corrections-spent` and `turn-limit`, with a second fresh session answering `needs-a-person`; the registry tick starting one fresh agent whose answer names the held files for a `holding-work` ending; and the two old rules having no callers left, with their tests passing against `endingAction`.

Assertions that exist because a naive implementation passes without them:

- **After-prompt `holding-work` versus take-up `holding-work`, one test, two readings.** A row keyed on `ending === 'holding-work'` alone either releases a live desk's own claim or starts a fresh agent on a slice that never started.
- **The fresh agent's answer contains each held path.** A composer that returns fixed text passes a "starts a fresh agent" test and fails #1288's actual complaint, that nobody told the next agent what was held.
- **`corrections-spent` then `holding-work` answers `needs-a-person`.** Per-ending counters would pass every single-ending test.
- **A desk a manifest names answers `leave` for all three new rows.**
- **The tick calls the rule once per desk.** A test with a `turn-limit` desk asserts exactly one `start` and one record row, because two steps over one population can double-act if the merge is half done.
- **The old rules are gone, not just unused.** `grep` for `freshAgentAfterCorrections` and `freshAgentAfterTurnLimit` in `packages/` returns nothing outside the changeset text.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. New domain code is arrow functions with factual TSDoc (behaviour only, history in the commit message); the domain imports `zod` and nothing else outside `adapters/`. Add a changeset (description first, `bumps:` block last, `plan:` line inside the comment block, never first). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain; the gate has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ending-action.ts`, `rules/fresh-agent.ts`, `rules/fresh-agent-turn-limit.ts` and their tests, `packages/board/src/server/entry/registryd.ts`, `registryd-main.ts` (the two tick steps), and `packages/board/test/unit/fresh-agent-tick.test.ts`. `agent-loop.ts` and `entities/ending.ts` are read-only here: the endings they write are wave 1's and are not changed by this wave. The marker write for `needs-a-person` belongs to wave 3.

Branches in flight, verified 2026-10-08 with `git ls-remote --heads origin`: `bug/a-stopped-loop-keeps-its-manifest`, `bug/local-checks-find-tests-in-a-temp-worktree` and `bug/the-loop-resumes-a-continuation`, none named by this plan. Check each one's diff against `registryd.ts`, `registryd-main.ts` and `fresh-agent*.ts` before the PR, and rebase onto `main`. No other branch of this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
