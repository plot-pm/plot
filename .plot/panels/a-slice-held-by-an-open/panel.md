# Panel: a-slice-held-by-an-open

- **Plan:** `docs/plans/2026-11-02-a-slice-held-by-an-open.md` (plan PR #3050, issue #3049)
- **Round:** 1
- **Jurors:** layering, safety, testability, seams
- **Outcome:** unanimous `amend`. The plan is amended in the same commit as this file.

## Positions

| Juror | Position | What it looked at | What it ran |
|---|---|---|---|
| layering | amend | `verdict.ts`, `eligible.ts`, `auto-dispatch.ts`, `dispatch-command.ts`, `implement.ts`, `fleet.ts`, `rows.tsx`, `sections.ts`, `row-identity.ts`, `menus.tsx`, `attention.ts` on `origin/main` | Executed `startabilityVerdict` under Node 26 from a `git show origin/main:` copy: `waiting` returns `needs-brief` (brief missing) and `start-work` (brief present). The only juror that executed code. |
| safety | amend | `entities/fleet.ts`, `plan-walk-assembly.ts`, `eligible.ts`, `fleet-state-file.ts`, `auto-dispatch.ts`, `plot-fleet-scan.sh`, `fleet.ts`, the live pulse | `jq` over `.plot/state/last-pulse.json` (`"state":"waiting","held":false`); `git show origin/main:` reads. No code executed. |
| testability | amend | `tuple-row.ts`, `rows.tsx`, `dispatch-command.ts` and its tests, `implement-run.ts`, `a-slice-with-no-work-waits-in-not-started.test.ts`, `eligible.corpus.test.ts`, the browser test at `slice-head-says-its-verdict.browser.test.ts:145` | `jq` over the pulse; `git grep` on `origin/main` for each reader. No code executed. |
| seams | amend | `verdict.ts`, `row-identity.ts`, `sections.ts`, `AgentList.tsx`, `dispatch-command.ts`, `implement.ts`, the open PR #3048 | `gh pr view 3048 --json files`, `git grep "verdict !== 'eligible'"`, `jq` over the pulse. No code executed. |

## Shared findings

1. **The wrong rule is `startabilityVerdict`** (`packages/domain/src/rules/verdict.ts:48-71`). Layering and seams named it; it never tests `waiting` or `blocked`, so a held branch gets `needs-brief` or `start-work`, which feed `fleet.ts:6523`, `:6705`, `row-identity.ts:116,135`, `menus.tsx:554,565` and `rows.tsx:1648`. Safety and testability reached the same defect from the slice side. The amended plan fixes this rule first.
2. **The held fact is the branch `state`, not the pulse field `held`.** All four jurors found that the pulse `held` is a worktree-lock boolean (`entities/fleet.ts:337`) and reads `false` on the evidence branch. The amended plan removes every instruction to read `held` and adds a test with `held: true` on an open branch.
3. **No pulse, `SliceVerdictSchema`, `/api/fleet` or scan change.** All four answered Open Question 2 with "derive at the consumer". A new verdict word breaks older readers of the strict enum (`entities/fleet.ts:102`), the corpus pair, and collides with PR #3048.
4. **The row stays in *Not started*.** All four showed that `classify` (`fleet.ts:4782-4794`) already places a waiting branch there, that `a-slice-with-no-work-waits-in-not-started.test.ts` pins it, and that `sections.ts:108` does not decide this row. The amended plan drops the move and drops `sections.ts`.
5. **The controller refusal belongs in `startDispatch`, once, and only on positive evidence.** All four found that `briefBranchFromPulse` already returns `null` for this plan and that `startDispatch` ignores it, and that `null` also means "no pulse". The amended plan adds `dispatchReading` with four kinds and refuses only `held`.
6. **`POST /api/implement` has the same path** (`implement.ts:255`). Three jurors named it (layering, testability, seams). The amended plan covers it with the same answer.
7. **The open-plus-held slice stays `eligible`.** All four answered Open Question 1 the same way.
8. **The `waits:` between the two slices is not needed.** Testability and seams required its removal; layering and safety offered one slice or controller first.
9. **The plan needs a test table.** Testability required it; layering, safety and seams listed the cases.

## Disagreements and resolutions

- **Where the slice reading is computed.** Testability required a server-side field on `AgentRow`, filled in `rowsFromPulse`, so the client can name `waits_on`. Seams required a client-side derivation, because a row field edits `contract/schema.ts` and `fleet.ts`, which the Fleet index slice also edits. Layering allowed either. **Resolved for the client**: `/api/fleet` stays unchanged, as point 3 requires, and the slice note reuses the held branch row's own server note, so the client needs no `waits_on`. The decision moves out of `.tsx` into `slice-reading.ts`, which meets testability's requirement for a unit test without a browser.
- **Tone of a `blocked` hold.** Layering kept tone `time` for both; safety, testability and seams required `you` for `blocked`. **Resolved for `you`**: a `blocked` wait names a branch with no pull request, and only a plan edit clears it, so it needs a person. The branch row keeps its tone `time` (`fleet.ts:3452`) because this plan does not change the server classifier.
- **Slot-5 word for a `blocked` hold.** Safety proposed the reason words `slice-waiting` and `slice-blocked`; testability required that the word `blocked` not appear at slice level, because the slice verdict `blocked` already means "an earlier slice has to land first". **Resolved for one word `waiting`** in slot 5, with the difference carried by the note and the tone.
- **Refusal reason word.** Safety required `slice-waiting` and `slice-blocked`; layering, testability and seams proposed `nothing-startable`. **Resolved for one reason `nothing-startable`**: the `DispatchStart` union gains one member, and the detail carries the `classify` sentence, which names the no-pull-request case.
- **Which predicate the slice reading builds on.** Layering required the branch `startability` value; testability and safety required `dispatchable`/`startableBranches`. **Resolved for both, with an agreement test**: `sliceHold` reads `startabilityVerdict` (the value the board ships), `dispatchReading` reads `startableBranches` first and calls `sliceHold` for the hold, and one fixture asserts that the two agree. A ref-held open branch answers `no-branch` (today's behaviour), never `held`.
- **`unknown` state.** Only layering required `startabilityVerdict` to answer `null` for `unknown`. **Not taken**: no other juror raised it, no measured cost comes from it, and `classify` already words it. It is listed in the plan's Notes.
- **Slice split.** Layering and safety offered one branch; testability and seams required controller first or no `waits:`. **Resolved for two slices, controller first**: the refusal stops the measured cost and carries the domain functions; the board slice follows by wave order, so no `waits:` annotation is needed.
- **Optional items** (`nextWork`, `firstBrieflessBranch`, `skippedPlans`, the fleet log lines, the claimed-plus-waiting note): each juror listed some; none starts a run. **Deferred** to a follow-up and named in the plan's Notes.

## Shared blind spot

No juror ran the controller or the board against a fixture: one juror executed a domain function, and three read code and the live pulse. The claims about `startDispatch`, `/api/implement` and the slice row rest on reading. The live evidence also disappears when PR #3048 merges, so the amended plan requires a fixture copied from the 2026-11-02 pulse row. No juror checked how the slice row reads a held slice whose branch rows are folded behind a grouped count (`groupedCount`); the amended plan states that the held arm precedes the grouped-count arm, and the review of the board slice checks it.
