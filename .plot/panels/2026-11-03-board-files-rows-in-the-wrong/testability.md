# Testability juror: board-files-rows-in-the-wrong

Position: amend

The plan names the right defect and the right shape of fix (one mapping, one invariant test). As written, the invariant test is ill-typed for case 2, too narrow for case 1, and the plan names no fixture, no test file, and none of the about ten existing assertions that pin the current behaviour. An unattended agent can make the plan's named test pass while one of the two reported rows stays wrong.

## Findings

### 1. The invariant test, as worded, cannot catch case 2

The plan says "Every startability label maps to the allowed sections only: `someone-is-on-it` never to `not-started`, and `abandoned` never to `waiting-on-you`". `abandoned` is not a startability label. `StartabilityVerdict` has four values (`start-work`, `needs-brief`, `waiting-on-approval`, `someone-is-on-it`; `packages/domain/src/rules/verdict.ts:56`, `packages/board/src/server/fleet.ts:3523-3526`). `abandoned` is a `QuietKind` (`packages/domain/src/rules/quiet.ts:149`). The three reported abandoned rows are `state: wip`, so their startability is `someone-is-on-it` and their group is `waiting-on-you`. A test over startability × section passes on main for case 2. Only a separate `QuietKind` × section assertion fails on main for case 2.

### 2. The case-1 invariant reaches more arms than the plan redesigns

`someone-is-on-it` is returned for every `wip` and `claimed` row (`verdict.ts:56`). On main, at least these arms put such a row in `not-started` with no running worker:

- fresh `claimed`, `fleet.ts:4723-4724` (`claimed, no known worker`) — the reported case;
- fresh `wip`, `fleet.ts:4845-4846` (`last commit N ago`), pinned by `packages/board/test/unit/fleet.test.ts:289` and `:300`;
- `localActivity` for a claimed or wip branch with local work, `fleet.ts:5209-5228` (four `not-started` returns);
- test fixtures that carry the combination on purpose, e.g. `packages/board/test/unit/not-started-plans.test.ts:306` (a blocked wave's `wip` row with `someone-is-on-it` in not-started).

So a total invariant test ("`someone-is-on-it` never in `not-started`") fails on main for the reported row, and also for fresh `wip` and local-activity rows the plan does not mention. The plan must say whether those rows also move to WORKING ("claimed, nobody watching" generalised to "taken, nobody watching") or whether the invariant is scoped to `state === 'claimed'`. Without that decision, the agent either widens scope silently or writes a narrowed test that does not express the plan's one-line goal.

### 3. The plan reverses two settled, tested rules without naming them

- `classifyGroup`'s own comment at `fleet.ts:4706-4709`: "WORKING IS ABOUT AGENTS, NOT BRANCHES. A claimed branch with no known worker is NOT STARTED … See `every-section-has-one-subject`, slice Inverted." The same rule is stated in `fleet.test.ts:284-285` and `localActivity`'s doc.
- `quietPlacement` (`quiet.ts:196-210`) maps `abandoned` to `waiting-on-you` on purpose (#1758, commit `53a010f69`), and `quietNeedsPerson` (`quiet.ts:219`) derives from it. The plan's "The quiet rule already returns `abandoned` … The section assignment honours it" reads as if the section ignores the quiet rule. It does not: `classifyGroup` calls `quietPlacement` at `fleet.ts:4889`, and the domain rule itself answers `waiting-on-you`. The fix is a change to `quietPlacement`, not a new caller of it.

`quietNeedsPerson` has consumers in `fleet.ts` (comments at `:4738`, `:6452`, `:7249`, `:7284`). Changing `quietPlacement` changes `quietNeedsPerson` for `abandoned`, and the plan must say whether that is intended.

### 4. Existing assertions that must change (none named in the plan)

Each pins the current behaviour and fails after a correct fix. The plan should list them so the change reads as a deliberate update, which is the convention `classifier-is-total.test.ts`'s header asks for.

Case 2 (abandoned → QUIET):

- `packages/domain/test/quiet.test.ts:214-216` — "keeps abandoned and orphaned-claim in waiting-on-you";
- `packages/domain/test/quiet.test.ts:182-184`, `:201` — `quietNeedsPerson` true for abandoned;
- `packages/board/test/unit/a-quiet-row-lands-in-quiet.test.ts:33-36` — "keeps an abandoned row in waiting-on-you";
- `packages/board/test/unit/fleet.test.ts:291`, `:300`, `:308`; `packages/board/test/unit/an-idle-branch-says-how-long.test.ts:149`; `packages/board/test/unit/branch-with-work-is-seen.test.ts:140`, `:162` — stale wip → `waiting-on-you` (read each; some may be orphaned-claim, which the plan does not move);
- `packages/board/test/unit/classifier-is-total.test.ts:351` — "a stale wip branch with no PR is ABANDONED" (the note is fine; check its section assertion).

Case 1 (claimed → WORKING):

- `packages/board/test/unit/fleet.test.ts:289` (fresh wip → not-started) if the scope widens per finding 2;
- `packages/board/test/unit/classifier-is-total.test.ts:296-301` — "NOT STARTED ⇒ state open" currently holds, and stays true only if fresh claimed/wip leave not-started;
- `packages/board/test/integration/claimed-slice-says-someone-is-on-it.browser.test.ts` and `a-handed-slice-reads-as-taken.browser.test.ts` — both render claimed rows with `someone is on it`; read whether they fix the section.

Browser tests that stay green and prove nothing: `packages/board/test/integration/row-placement-quiet-and-ended-desk.browser.test.ts:101-114` fixes `group: 'waiting-on-you'` for an `abandoned` row in the payload and asserts it renders there. A server-side fix leaves this test green, because the fixture carries the old answer. The plan should require the fixture to change to `group: 'quiet'` and the assertion to flip, so one browser test shows the new placement.

### 5. No reading fixture for "claimed, no manifest, no process"

The plan does not name one. The reported combination has these load-bearing readings, and each one changes which arm answers:

- `state: 'claimed'`, `ageMinutes` inside `quietMinutes` (5 min; past the window the orphaned-claim arm at `fleet.ts:4729-4767` answers `waiting-on-you` instead);
- `worker: 'none'` (a hand-started worker leaves no pid; `running` already goes to WORKING at `:4587`);
- no `AgentEntry` in the registry naming the branch (else `withHandOver`, `fleet.ts:6016-6033`, already moves it to WORKING with `HANDED_NOTE`);
- `planPhase: 'design'` with an approved spike — the measured plan was in Design. Without `approvedSpike`, `draftPlacement` (`fleet.ts:4717-4721`) sends the row to `waiting-on-you` and the test exercises a different arm.

The manifest reading is not an input of `classify`; it enters only in `withHandOver`. So the invariant and the case-1 test must assert on `withHandOver(rowsFromPulse(…), agents)` output, not on `classify` alone, or "no manifest" is not a reading the test controls.

### 6. Where the test lives, and the domain coverage gate

- The plan puts the mapping in `packages/domain` as an arrow. `packages/domain/vitest.config.ts` holds `src/!(adapters)/**/*.ts` at 100% lines, branches, functions and statements. A `{ section, label }` mapping over claim × manifest × process × PR × quiet kind must have a unit test that reaches every arm, or CI's `vitest run --coverage` fails. The plan should name the test file (for example `packages/domain/test/row-placement.test.ts`) and say it enumerates the full cross product, as `classifier-is-total.test.ts` already does for `classify`.
- `packages/board/test/unit/classifier-is-total.test.ts` already enumerates every `BranchState` × verdict × worker × phase. It is the natural place for the board-level invariant (`classify` → `withHandOver` → assert no `someone-is-on-it` in `not-started`, no `quietKind: 'abandoned'` in `waiting-on-you`). The plan should name it.
- Open question 2 (server `group` versus client `rowsBySection`) decides where the tests go and whether `/api/fleet` changes. The issue measured the wrong answer in `/api/fleet` (`"group": "waiting-on-you"`). A client-only fix leaves the API wrong and leaves `classify` tests unchanged. This is not a question the implementing agent should settle; the plan should answer it (server, through `classifyGroup`/`quietPlacement`/`withHandOver`).

### 7. Fail-before, pass-after

- Case 1, with the fixture of finding 5 and an assertion on `withHandOver(rowsFromPulse(…))`: fails on main (group `not-started`, startability `someone-is-on-it`), passes after. Holds.
- Case 2, as the plan words it (startability × section): passes on main. Does not hold. With a `QuietKind` × section assertion: fails on main at `quiet.ts:208` and `fleet.ts:4889`, passes after. Holds only after amendment 1.

## Required amendments

1. Split the invariant into two typed assertions: `StartabilityVerdict` × `WaitingGroup` (`someone-is-on-it` ∉ `not-started`) and `QuietKind` × `WaitingGroup` (`abandoned` ∉ `waiting-on-you`). Assert both over the full cross product, on the output of `withHandOver(rowsFromPulse(…), agents)`, in `classifier-is-total.test.ts` or a named sibling.
2. Decide the scope of case 1: either every `wip`/`claimed` row with no running worker and no handed agent leaves NOT STARTED (fresh wip and the `localActivity` arms too), or the invariant is scoped to `state === 'claimed'` and the plan says so.
3. Name the case-1 fixture: `claimed`, age 5 inside the quiet window, `worker: 'none'`, no registry entry for the branch, plan phase `design` with an approved spike. Add a second fixture with an approved plan, so the test does not depend on the spike arm alone.
4. State that the change edits `quietPlacement` (`quiet.ts:196`) and therefore `quietNeedsPerson`, and say what each `quietNeedsPerson` consumer in `fleet.ts` does afterwards.
5. List the existing assertions in finding 4 as deliberate updates, and require `row-placement-quiet-and-ended-desk.browser.test.ts:101-114` to change its fixture to `group: 'quiet'` and assert the row under Quiet.
6. Answer open question 2 in the plan: the server `group` changes, so `/api/fleet` stops reporting the contradiction the issue measured.
7. Name the domain test file and say it covers every arm of the new mapping, so the 100% gate is met by design rather than by luck.

## Decisions for a person

- Reversing #1758 (`abandoned` stays in WAITING ON YOU) and the `every-section-has-one-subject` rule (claimed with no known worker is NOT STARTED). The issue author asks for both; the plan should record that the reversal is intended.
- Whether the orphaned claim (`claimed`, past the window, `fleet.ts:4729-4767`) also moves, since it is a "claimed, nobody watching" row by the plan's own definition and today sits in WAITING ON YOU.
- Whether "claimed, nobody watching" counts in WORKING's header number (plan open question 1).

## What I ran versus read

Ran (read-only): `git fetch origin main`, `gh issue view 3096`, `gh pr view 3098`, `grep`/`sed` over `packages/board/src/server/fleet.ts`, `packages/board/src/server/attention.ts`, `packages/board/src/app/lib/agent-rows/{sections,row-identity}.ts`, `packages/domain/src/rules/{quiet,verdict}.ts`, `packages/domain/vitest.config.ts`, and the test files named above; `git log` on `a-quiet-row-lands-in-quiet.test.ts`.

Only read, not executed: no test suite ran, per the brief. Fail-before claims in finding 7 come from reading the arms and the existing assertions, not from a run. The worktree branch has no code diff against `origin/main`, so line numbers hold for main.

Verified true in the plan: `quiet.ts:149` returns `abandoned`; `attention.ts:236` is the `abandoned` verdict for a failed worker; `sections.ts` notes a slice with two possible sections (`sliceSection`).
