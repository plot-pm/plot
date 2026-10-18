# Juror: contradiction lens

Position: amend

The plan's diagnosis is correct. The text contradicts itself in three places, and one Open Question contradicts the Design's "config reader" step. Each fix is a small text edit.

## 1. Motivation claims against the code

- #1900: true. `packages/board/src/server/index.ts:1089` prints the ready line inside the first `listen` callback, and `:1092` calls `bindNext` after it. The claim "first listen (`::1`)" holds only when `HOST` is unset (`index.ts:993`: `process.env.HOST ? [HOST] : ['::1', '127.0.0.1']`). The CI and container measurements cannot be checked from the tree.
- #1916, note dropped: true. `ended-desks.ts:35` returns non-broken entries unchanged, and `app/lib/agent-rows/working-agents.ts:85` filters out `ended?.owesPerson === false`. No other consumer reads `ended`.
- #1916, `boundSeconds` null: true (`ended-desks.ts:47`). `fleet.ts:7153` calls `withEndedDesks(entry.agents, placedRows)` with no bound.
- Browser test: true. `row-placement-quiet-and-ended-desk.browser.test.ts:91` sets `ended` by hand.
- Quoted note text: inexact. The domain returns `ended at the wait bound with no slice offered — reaped on the next pass` (`domain/src/rules/ended-desk.ts:93`). The Motivation and the Changelog both leave out the suffix.

## 2. Internal contradictions

- **Board-impact comment vs Design and Notes.** The comment says "both slices change packages/board only". Design §2 says "the placement answer gains the section", which is `packages/domain/src/rules/ended-desk.ts`. Notes say "This plan extends both". The comment is wrong.
- **Changelog vs Open Question 1.** The Changelog promises the row "keeps its row", but no section is decided. The line is acceptable as an outcome, but slice 2 is not buildable until Q1 has an answer, and the plan gives no gate for that apart from prose.
- **Design "config reader" vs Open Question 3.** The only existing `Worker bound` reader is `boundSecondsOf` (`packages/fleet/src/shared/fleet-run.ts:69-72`). It replaces `0` and invalid values with a default. If slice 2 reuses it, a disabled bound prints a bound that was never in force. Q3 cannot be answered "null for 0" while that reader is used.
- **New `section` vs existing `owesPerson`.** If the placement answer gains `section` beside `owesPerson`, two fields say one fact and can disagree. `owesPerson === true` already means Waiting on you. The plan must say that one field replaces the other, or that one derives from the other in the domain.
- **Concurrency note.** "Disjoint files" holds: slice 1 is `index.ts` only, and slice 2 is `ended-desks.ts`, `fleet.ts`, the domain rule, `working-agents.ts`/`AgentList.tsx` and the schema. Concurrency is still blocked in practice, because slice 2 waits on Q1.

## 3. CLAUDE.md consistency

- *Every rendered state is a domain property*: the Design follows it. The section must come from the domain rule, and `working-agents.ts` only filters on it. A precedent exists: `quietPlacement` returns `'done' | 'quiet' | 'waiting-on-you'` (`domain/src/rules/quiet.ts:196`). The new answer should reuse those literals and not coin a word.
- Arrow functions: `brokenAgentRows` is a `function` declaration (`working-agents.ts:80`). A new companion (for example `quietAgentRows`) must be an arrow. If slice 2 rewrites the body of `brokenAgentRows`, it becomes an arrow too.
- Agent/Worker vocabulary: correct. The note describes what the Agent still holds and sits on `AgentEntry`. `Worker bound` is a sanctioned config key.
- Layering: `buildFleet` reads the config server-side and passes a value into `endedDeskPlacement`. That is the readings-as-values shape. No violation.

## 4. Slices: buildable, and "done"

- Slice 1 is buildable: move the `console.log` into `bindNext`'s `address === undefined` branch, and into the first callback when `BIND_ADDRESSES.length === 1`. Its "done" is weak. A test that connects over 127.0.0.1 when the line appears passes on today's code almost always, because the race "has not shown in GitHub CI". The test needs to fail before the fix. Option: assert that both addresses accept a connection on the first poll after the line. Better: delay the extra bind with a test seam, or read the `listening` state of every server when the line prints. Side effect: the `tailscale:` line (`index.ts:1107`) is printed from the first callback, so after the move it can print before the ready line. The code comment at `:1097-1098` ("prints first either way") becomes false.
- Slice 2 is buildable once Q1 has an answer. Its "done" needs a unit test of the domain section answer and a browser test fed by `withEndedDesks` output rather than a hand-set `ended`. The slice says the second part, but it gives no domain test.

## 5. Open Question 1: section

Recommend **Quiet**, as a non-branch agent row: a `quietAgentRows` companion to `brokenAgentRows`, fed by `section === 'quiet'`.
- `quietPlacement` defines Quiet as "needs nobody" and keeps it folded by default (`AgentList.tsx:408`). A desk that waits only for the reaper fits that definition.
- Done is wrong. The released desk's branch row is already `quietKind: 'merged'` → `'done'`, because `merged === true` is a precondition (`ended-desk.ts:85`). Done answers "the branch landed". The desk row answers "a process left a worktree that the reaper takes next". Those are different entities, as `fleet.ts:7150-7152` states: "the entities differ".
- A badge on the plan or branch row is wrong too. It moves an Agent fact onto a branch row, and the note then disappears when Done collapses or the branch row ages out while the desk still exists.

## 6. Open Questions 2 and 3

- Q2: the note lasts as long as the desk exists. Nothing separate needs building: the row comes from the registry entry, and the reaper's removal of the desk is the end. The note's own wording, "reaped on the next pass", already says this. Close the question.
- Q3: yes, `boundSeconds` is `null` for `0`, for non-integers and for a missing key. `agent-loop.ts:478` exits on the free wait only when `boundSeconds > 0`, so a `0` bound cannot have produced this ending. Read the raw key, not `boundSecondsOf`, because that function substitutes a default. Caveat to record: the bound is the config at render time, not at the desk's death.

## 7. Amendments

1. Board-impact comment: replace "both slices change packages/board only" with "slice 1 changes packages/board; slice 2 changes packages/board and `packages/domain/src/rules/ended-desk.ts`".
2. Changelog line 2 and the Motivation quote: use the domain's exact note, "ended after <h> h with no slice offered — reaped on the next pass".
3. Design §2: "`EndedDeskPlacement` gains `section: 'waiting-on-you' | 'quiet'` (the literals of `quietPlacement`); `owesPerson` is removed, or is defined in the domain as `section === 'waiting-on-you'`, so the two cannot disagree."
4. Design §1: "`buildFleet` reads the raw `Worker bound` key; a value that is not a positive integer passes `null`. `boundSecondsOf` is not used, because it substitutes a default."
5. Resolve Q1 → Quiet (non-branch agent row, arrow-function companion to `brokenAgentRows`), Q2 → the desk's lifetime, Q3 → `null`. Tick all three before approval.
6. Slice 1 "done": "a test that fails on the current code: with the extra bind delayed by a seam, the ready line has not printed until 127.0.0.1 accepts; and the `tailscale:` line prints after the ready line."
7. Slice 2 "done": add "a domain unit test for `section` per reading, and a browser test whose `ended` comes from `withEndedDesks`, showing the note under Quiet."
