# Round 1 — domain design and testability

Position: amend

## 1. Fix against #1150

It covers the quiet window only. #1150 asks that a held claim read as taken "whether or not the branch carries a commit beyond the claim". Past `quietMinutes` the `claimed` arm returns `waiting-on-you` with the orphaned-claim note (`fleet.ts:5059-5096`). `withHandOver` moves only `not-started`, so a claim that a running agent holds still reads as orphaned after the window.

## 2. Code claims on origin/main

- `fleet.ts:4787` `if (verdict === 'eligible') return { group: 'not-started', note: ELIGIBLE_NOTE };`: true.
- `fleet.ts:5054` `return { group: 'not-started', note: unstarted };`: true. `unstarted` is `'claimed, no known worker'` unless `elsewhere` is set (`:5036`).
- `fleet.ts:3214` `entry.agents = registryResult.entries;`: true. `:7790` is the only `rowsFromPulse` call site.
- `schema.ts:3537` `session: z.string().default('')`, plus `branch`/`state` at `:3556`/`:3612`: true.
- `rows.tsx:1092` `'approved — nobody has taken it'`: true. `EXPECTED_TESTS = 536` (`:621`): true.
- False: "the form WORKING already prints". `packages/` holds no `handed to agent` string. `RegistryRow` shows `row.note`, so the note reaches WORKING through the join, but the wording is new.

## 3. Tests

The `handedTo` cases and the browser test fail today and pass after the fix. **The board unit test does not lock #1090.** Every "unchanged" case pairs a matching running agent with a group or worker that must not move. No case gives a `not-started` row with no matching agent, or a matching agent that is not `running`. A `withHandOver` that ignores `handedTo` and moves every unworked `not-started` row passes all listed tests.

## 4. Design and unspecified points

- `handedTo` is pure and takes readings as values. That is correct. The section decision stays in board code (`withHandOver`), but a unit test can assert it without a browser. State that the split is deliberate.
- The plan adds no payload field, so the client-cast `undefined` trap does not apply. Keep it that way.
- A `working` row turns on `showsWorkerLog` (`menus.tsx:69`) and `isLive` (`stuck.ts:33`). The plan does not say whether a handed row with no worktree offers "Open worker log".
- The count pin "+1 over origin/main, merge order decides" leaves a one-line conflict for the second merger to guess.

## Required changes

1. Apply the hand-over to a `waiting-on-you` row with `state === 'claimed'` whose branch `handedTo` answers, or justify the exclusion against #1150.
2. Add board unit cases: a `not-started` row with no agent on its branch, and one whose agent is `finished`/`ended`. Both must stay unchanged.
3. Correct "the form WORKING already prints".
4. Say whether a handed row shows the worker-log menu item.
5. Pin `EXPECTED_TESTS` as "the value at rebase + 1": 537 alone, 539 after #1145's +2.
