# Round 1 — skeptic who measures

**Executed:** a detached worktree at `origin/main` `5da3e923`, `pnpm install`, and a scratch vitest file (`packages/board/test/unit/zz-juror-1150.test.ts`, removed with the worktree). It called `rowsFromPulse` for `bug/the-rule-names-a-usage-limit` with quiet = 30. An agents list `{session:'334b3492…', state:'running', branch}` was prepared, but `rowsFromPulse` has no parameter that takes it.

| reading | group | note | startability |
|---|---|---|---|
| open, worker `elsewhere` | not-started | `eligible — nobody has taken it` | start-work |
| empty claim 3 min, `elsewhere` | not-started | `claimed elsewhere · …` | someone-is-on-it |
| empty claim 45 min, `elsewhere` | **waiting-on-you** | `claimed, no work committed — claimed 45 min ago · claimed elsewhere` | someone-is-on-it |
| empty claim 3 min, worker `running` | working | `worker running (pid 42)` | someone-is-on-it |

The defect reproduces. For a claimed row the text `approved — nobody has taken it` comes from the client: `startableNote` blanks the note for `someone-is-on-it` (`rows.tsx:1521`), and `rows.tsx:1092` then prints the verdict sentence.

Position: amend

## 1. Does it fix the issue?

Only inside the 30-minute quiet window. Past the window, a held empty claim with no local worker goes to WAITING ON YOU as an orphan (row 3). `withHandOver` never moves a `waiting-on-you` row, so the issue's case "held claim, whatever its commits" stays wrong, and now it is wrong with a stronger claim: *nobody holds this*.

## 2. Code claims (all true on origin/main)

- `fleet.ts:4096` `function classifyGroup(`
- `fleet.ts:4787` `if (verdict === 'eligible') return { group: 'not-started', note: ELIGIBLE_NOTE };`
- `fleet.ts:5053-5054` `if (ageMinutes !== null && ageMinutes <= quietMinutes) { return { group: 'not-started', note: unstarted };`
- `fleet.ts:3214` `entry.agents = registryResult.entries;`
- `fleet.ts:7790` `? rowsFromPulse(entry.pulse, entry.ages, …`
- `EXPECTED_TESTS = 536` at `stubbed-tests-start-no-board.test.ts:621`.

One claim is false. "The form WORKING already prints" is not true: `handed to agent` and `not taken up` occur nowhere in `packages/board/src`.

## 3. Tests

- The `handedTo` and `withHandOver` unit tests target new symbols, so they fail today and pass after the fix.
- The browser test does not discriminate. A stubbed browser test serves a ready-made payload. If its row carries `group: 'not-started'`, the client renders it in NOT STARTED after the fix too, because `withHandOver` runs on the server. If the stub carries `group: 'working'`, the test passes today. The plan must name a server path that runs `withHandOver`, or must drop the claim that the browser test proves the fix.

## 4. Gaps an implementer must guess

- **startability.** "Every other field stays" leaves an `open` row moved to WORKING with `startability: 'start-work'`, and `isStartable` and the menus read that field. Specify `someone-is-on-it` for a moved row.
- **The orphan arm.** Decide whether a `claimed` row in `waiting-on-you` with an orphan note moves when `handedTo` answers.
- **Ordering with #1161.** `a-draft-slice-waits-on-its-approval` takes rows out of `not-started`. The combined behaviour is fine, but name it in a test.

## Required changes

1. Extend `withHandOver` to the orphaned-claim row (`state === 'claimed'`, `group: 'waiting-on-you'`, from the arm at `fleet.ts:5059-5089`) when `handedTo` answers a session. Add a unit case at age greater than the quiet window.
2. Set `startability: 'someone-is-on-it'` on every row that `withHandOver` moves, and assert it.
3. Make the browser test discriminating: drive the real server rule (for example an integration test over `buildBoard` with a stubbed registry), or reword "Done when" so the browser test only proves the render.
4. Remove the false "the form WORKING already prints" claim, and state the note format as new.
