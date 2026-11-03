# Safety juror: board-files-rows-in-the-wrong

Position: amend

All line numbers refer to `origin/main` at `ee678d5c8`.

## Summary

The defect is real, and the issue describes it correctly. The plan does not name the code that produces `group` (`classifyGroup` in `packages/board/src/server/fleet.ts`), the code that renders WORKING (`AgentList.tsx`), or the three server consumers that read `group` after classification. The approach as written has four safety problems. First, a claimed row moved to `group: 'working'` renders in no section. Second, it can hide a double hand-out. Third, it can take a dead claim off the action list. Fourth, it removes the one menu item an abandoned row has. Each problem has a narrow fix, so the verdict is amend, not reject.

## Findings

### F1. A row in `group: 'working'` without a registry agent renders in no section (HIGH)

- WORKING renders registry entries only, not branch rows. `AgentList.tsx:1572-1600` renders `workingRows.map(...)` from `workingAgentRows(ownAgents, rowByBranch)` (`AgentList.tsx:530`, `working-agents.ts:40-54`). That function filters to live registry states and then joins a branch row where one exists.
- Every other section filters `r.group === key` (`AgentList.tsx:1149`). A branch row whose `group` is `working` and that no live registry entry names is therefore drawn nowhere.
- The issue's case is exactly this shape. The registry reads `0 manifests, 6 synthesized`, and WORKING lists nothing. So the plan's move ("Claimed without a manifest … gets its own visible state in WORKING") takes the row out of NOT STARTED and draws it nowhere. The rubric asks whether a row can end up in no section, and here it can.
- `sectionCount` counts WORKING by `registry: workingRows.length` (`AgentList.tsx:1171-1178`, `plan-level-row.tsx:131`). The header number also misses the row. Open question 1 touches this point but does not name the render path.
- The plan lists only `sections.ts` and `tuple-row.ts` as touched files. Neither file places a row into WORKING.

### F2. Moving claimed rows ahead of `withHandOver` hides a double hand-out (HIGH)

- `withHandOver` (`fleet.ts:6018-6036`, called at `fleet.ts:7823`) rewrites a row only when `row.group === 'not-started'` or the row is an orphaned claim. It sends a row with two live sessions to WAITING ON YOU with the note `handed to N agents at once`. The docstring at `fleet.ts:6000-6010` calls this "a fault for a person, not a no-op".
- Suppose `classifyGroup` returns `working` for a fresh claimed row, which is the plan's "claimed, nobody watching". Then `withHandOver` returns the row unchanged at `fleet.ts:6023`. The two-agents fault (#1039, #1152) then never reaches WAITING ON YOU for a claimed branch. The single-agent arm also stops writing `HANDED_NOTE`.
- The plan does not mention `withHandOver`.

### F3. "Claimed without a manifest" as written also covers a dead claim, which today asks a person (HIGH)

- The claimed arm has two outcomes (`fleet.ts:4718-4771`). A fresh claim (`ageMinutes <= quietMinutes`) goes to `not-started` with the note `claimed, no known worker`. A stale claim with no local activity goes to `waiting-on-you` as an orphaned claim (`claimed, no work committed — claimed N ago`). `quietPlacement` holds that second placement in `quiet.ts:196-206`, and `domain/test/quiet.test.ts:214` pins it.
- The plan's sentence is "A claimed branch with no manifest or live process confirming a worker gets its own visible state in WORKING". Read literally, it moves the orphaned claim too. That takes a dead claim off the operator's action list and puts it in a section whose rows `isLive` animates as live (`stuck.ts:32-34`, "membership IS the statement"). The rubric asks whether a dead claim can be masked, and here it can.
- The plan's own rationale ("a dead claim stays distinguishable from a live one") needs this boundary stated. It does not state it.

### F4. Moving `abandoned` to QUIET removes the row's only menu item, and §19 covers fewer branches than the board does (MEDIUM)

- The plan says "The cleanup decision stays available from the row's menu". On main, `offersOpen` returns true only for `group === 'waiting-on-you'` (`menus.tsx:120-122`), and the comment at `menus.tsx:642-647` calls that scope load-bearing. A branch row offers no drop or delete item. An abandoned row moved to QUIET with no PR and no run therefore loses its Open item and probably its whole menu. The claim is false after the change unless `offersOpen` changes too.
- `/plot-reconcile` §19 ("Unclaimed work", `plot-reconcile-scan.sh:204`, `:2394-2412`) reports a branch "that no plan names and no open PR carries". The board's `abandoned` kind (`quiet.ts:149`: real commits, `prState === 'none'`) also fires for a branch a plan DOES name, such as a slice branch of an approved plan with commits, no PR and no worker. That branch has no other reporter. Moving it to QUIET removes the only signal that a slice's committed work sits unreviewed.

### F5. The plan misstates the domain rule it relies on (MEDIUM)

- The plan says "The quiet rule already returns `abandoned` … The section assignment honours it." In fact `quietPlacement` deliberately maps `abandoned` to `waiting-on-you` (`quiet.ts:186-206`). `classifyGroup` reads that mapping at `fleet.ts:4889`, and the comment at `fleet.ts:4855-4859` justifies it ("revive it, or drop it"). The move reverses a domain rule. It does not merely honour one.
- At least four tests pin the current answer and must change with it: `packages/domain/test/quiet.test.ts:214`, `packages/board/test/unit/a-quiet-row-lands-in-quiet.test.ts:33`, `a-landed-branch-leaves-waiting.test.ts:99` and `an-idle-branch-says-how-long.test.ts:149`.
- The fresh-claim placement reverses a delivered decision as well. Commit `ce27834f9` (#362, `every-section-has-one-subject` slice Inverted) moved agentless claims out of WORKING. The plan file at `docs/plans/2026-08-20-every-section-has-one-subject.md:220-232` records the reason: "no agent at all sitting in the section for agents". The plan names neither reversal. An unattended agent that meets these comments and tests will either stop or "fix" the tests to pass. CLAUDE.md forbids the second move.

### F6. Slice and plan placement can disagree with the row (LOW)

- `deriveSlices` sets `Slice.section` to `complete ? 'done' : 'not-started'` (`fleet.ts:3655`). If the claimed row leaves NOT STARTED, the plan head and slice can still count in NOT STARTED with no row under them. That is the issue's "1 slice" line with nothing beneath it. Open question 3 names this risk but leaves it to the agent.

### Automation that reads `group` (checked, no hidden consumer)

- `packages/fleet/src` and `packages/domain/src` read no row `group`. A grep for `.group`, `waiting-on-you` and `not-started` finds only domain rules that produce placements. fleetd, auto-dispatch, reap and the notify path do not read the section. The issue's worry that auto-dispatch "might pick up" a NOT STARTED row is a reader-perception risk, not an automation risk. Dispatch decides from claims and verdicts.
- `attention.ts` reads `group` only for `done` (`attention.ts:122`). Its `abandoned` verdict (`attention.ts:236`, `:249`) comes from `row.worker` (`failed` or `ended`), not from the quiet kind. The plan's guess that it "likely stays" is correct, and the change does not touch it.
- Board consumers of `group` that change behaviour with the move: `withHandOver` (F2), `waitingOnFor` (`fleet.ts:3462`, `not-started` only), `quietKindFor` (`fleet.ts:5063`, keeps the label in QUIET, so the move is fine), `offersOpen` (F4), `showsWorkerLog` (`menus.tsx:69`, which would offer a worker log for a row with no process) and `isLive` (`stuck.ts:33`), plus `isStartable` (`row-identity.ts:78`, only narrows).
- No skill reads the row `group` mechanically.

## Required amendments

1. Name the real files: `packages/board/src/server/fleet.ts` (`classifyGroup` claimed arm `:4718-4771`, the wip tail `:4889`, `withHandOver` `:6018`), `packages/domain/src/rules/quiet.ts` (`quietPlacement`), `packages/board/src/app/components/AgentList.tsx` (WORKING render and `sectionCount`) and `packages/board/src/app/lib/agent-rows/menus.tsx` (`offersOpen`, `showsWorkerLog`).
2. Scope the claim move to the FRESH claim only (`ageMinutes <= quietMinutes`, today's `not-started` arm). State that a stale, orphaned claim stays in WAITING ON YOU. Add a test that a claim past the quiet window with no local activity still reads `waiting-on-you`.
3. Choose a placement for the fresh agentless claim that renders. Either (a) add a WORKING sub-list for branch rows with `group === 'working'` and no joined registry entry, using its own wording and with `isLive` false for it, or (b) keep the row in NOT STARTED with a label that does not contradict the section, for example `claimed — starting`. Option (b) needs no new render path and keeps the #362 decision. Add a test that every row of a pulse renders in exactly one section, including a `working` row with no registry entry.
4. Keep `withHandOver` able to see the moved row. Either run it on `group === 'working' && state === 'claimed' && worker` not live, or move the claim placement after it. Add a test that a fresh claimed row with two live sessions still reads WAITING ON YOU with `handed to 2 agents at once`.
5. For `abandoned`, change `quietPlacement` in the domain and say so. Restrict the move to branches no plan names, which is §19's population, and keep a plan-named abandoned slice branch in WAITING ON YOU. Alternatively, record that a person accepts that loss. Update the four pinned tests listed in F5 and name each one in the plan.
6. Make the menu claim true. Extend `offersOpen` to a QUIET row of kind `abandoned`, or drop the sentence from Motivation.
7. Record in the plan that it supersedes the placements decided by #362 (`every-section-has-one-subject` Inverted) and by `quietPlacement`. The fleet agent then reads the reversal as intended and does not take it for a test to repair.

## Decisions for a person

- Does an agentless fresh claim belong in WORKING, which reverses #362's "WORKING is about agents", or in NOT STARTED with a non-contradicting label? This is a section-semantics decision, and an unattended agent should not make it.
- May a plan-named abandoned slice branch leave WAITING ON YOU, given that no other reporter covers it?

## What I ran versus read

- Ran: `git fetch`, `git show origin/main:<file>`, `git grep` over `packages/`, `skills/` and the tests, `git log -S` for the origin of both placements, and `gh issue view 3096`. I ran no test, build, board, fleet or host write.
- Read: the plan, the issue, `fleet.ts` (classify claimed and wip arms, `withHandOver`, `waitingOnFor`, `quietKindFor`, `GROUP_ORDER`), `quiet.ts`, `sections.ts`, `working-agents.ts`, `AgentList.tsx` (WORKING render), `menus.tsx`, `stuck.ts`, `attention.ts`, `every-section-has-one-subject.md` and `plot-reconcile-scan.sh` §19 headers.
- Not verified by execution: the exact rendering of a `group: 'working'` row with no registry entry. F1 rests on reading `AgentList.tsx:1149` and `:1572-1600`, not on a rendered board.
