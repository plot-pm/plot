## Implementation brief — every-loop-ending-has-a-supervisor-rule (wave 3: Endings that ask a person)

- **Plan (canonical):** `docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `infra/an-unrepaired-ending-asks-a-person` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issues #1274, #1288, #1281

Wave 1 (#1371) built `endingAction` and wave 2 (#1384) moved `corrections-spent`, `turn-limit` and the after-prompt `holding-work` into it. This is the last wave of the plan. Nothing waits on it.

### What to build

Five endings have no supervisor action today: `unstarted`, `run-limit`, `checks-unanswered`, `spend-limit` and `blocked`. `endingAction` (`packages/domain/src/rules/ending-action.ts`) answers `leave` for each, so a desk that ended this way sits claimed until a person finds it on the board. The plan's table gives all five the action `needs-a-person`.

The second half is the write. `applyFreshAgentDecisions` escalates today with `desk.sealDeclaration(worktree, branch, 'blocked')` (`entry/registryd.ts`, the `decision.escalate` branch). A declaration is not a question: `questionEscalation` (`rules/question-escalation.ts`) lists desks that carry a `PLOT-BLOCKED.md` marker. Replace the declaration write with `desk.writeBlockedMarker(worktree, text)` (`ports/desk.ts`), where the text names the ending and its `detail`. The existing escalation path (WAITING ON YOU, then `Notify command` as the question ages) then carries it. Add no second notification path.

Build, in this order:

1. **The `needs-a-person` rows.** Add the five endings to `endingAction`. `checks-unanswered` carries a `detail` (`no-answer` or `tip-moved`) that the marker text must name, so the readings need the ending's `detail`. Keep the verdict type and the existing readings' shape; add one field.
2. **A pure composer for the marker text** next to the rule, in the family of `holdingWorkAnswer`. It names the ending, the branch and the `detail`, and says what a person decides. Pure: no disk read.
3. **The registry tick writes the marker** for every `needs-a-person` verdict, including the two wave 2 left on `sealDeclaration` (`corrections-spent`, `turn-limit`, and a second `holding-work`). One desk gets one verdict per tick.
4. **Population.** The five endings are not in the `freshAgentCandidateTrees` / `nothingDoneCandidateTrees` filter. Decide whether the new decisions join that step or run as a third one, and say which in the commit message.

### Settled decisions — do not re-derive them

- **The marker, not the declaration.** `supervise` already answers `needs-a-person` for a `blocked` declaration, but `questionEscalation` reads markers, and the declaration is invisible to WAITING ON YOU. Measured on the plan's motivation: #1288 sat `stalled` on the board with nothing escalating. Do not write both; one write is the contract.
- **`writeBlockedMarker` is no-overwrite.** An existing marker is a question already asked. The rule's `escalate` guard (`verdict === 'needs-a-person' && !escalated`) stops the next tick repeating the write; keep it, and do not rely on the no-overwrite alone.
- **`unstarted` asks a person because the invocation is broken.** A fresh agent would run the same command. Do not add a fresh-agent row for it.
- **`spend-limit` and `run-limit` go to a person directly.** A fresh session reads the same spend or count (`ending.ts`). Do not give them the fresh-session allowance.
- **`limited`, `spent`, `unregistered`, `bound`, `quiet` and `unreadable` stay `leave`.** They are the plan's two open questions; answering them is out of scope. Test that each still answers `leave`.
- **A manifest-named desk answers `leave` for every ending**, as in waves 1 and 2.
- **Absent is not false.** A missing ending answers `leave`; a missing `detail` composes a marker that says no detail was recorded, not an empty one.
- **Pure rule, tick performs.** `endingAction` reads no disk. A restarted supervisor reaches the same action from the same files.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation would pass without them:

- One `endingAction` test per new row, plus the `leave` rows above: catches a default arm that swallows a new ending.
- `checks-unanswered` with `no-answer` and with `tip-moved` compose different marker text: catches a composer that drops `detail`.
- The tick test for `unstarted` asserts that the marker file exists and that `questionEscalation` lists the desk. Asserting only the verdict passes with the old `sealDeclaration` write.
- `corrections-spent` after its fresh session writes a marker, not a declaration: catches wave 2's write left in place.
- A second tick writes nothing new: catches a lost `escalated` guard.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice needs no shell, so add none. Add a changeset for `@plot-pm/board` if the tick changes (see `## Versioning`; description first, `bumps:` block last).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ending-action.ts` and its tests, the escalation write in `packages/board/src/server/entry/registryd.ts`, and the marker composer. It does not touch `agent-loop.ts`, `fresh-agent*.ts` (deleted in wave 2) or `question-escalation.ts`. No other slice of this plan is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.
