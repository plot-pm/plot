# Every loop ending has a supervisor rule

> One domain rule maps each way an agent's loop ends to one supervisor action: release the claim, start a fresh agent, or ask a person. No ending leaves a slice claimed with nobody working on it.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:** the-release-train-fixes-what-it-found
- **Issue:** #1274, #1288, #1281
- **Story:** the-supervisor-delivers-the-approved-scope
- **Review:** in-session
- **Impl:** own branches

## Motivation

Under auto-dispatch the supervisor owns every stop in an approved plan (story `the-supervisor-delivers-the-approved-scope`). Three endings measured this week have no rule, and each one left a slice claimed with nobody working on it:

- **A turn that did nothing seals as finished (#1274).** On 2026-10-04 an agent took up `infra/the-loop-has-a-workflow`, pushed the claim, and its turn ended on `Loaded.` with no file changed. The loop sealed the slice and went free. The claim ref stayed, so the queue skipped the slice. In the JS loop, row 12a (`packages/domain/src/workflows/agent-loop.ts:633-645`) seals a turn that pushed nothing beyond the claim and opened no PR, with no ending reason.
- **Held work waits for nobody (#1288).** On 2026-10-05 an agent ended `holding-work` with 8 changed files and no marker. The board showed `stalled`, no agent took the slice up again, and nothing escalated. A master session committed the work by hand. `freshAgentAfterCorrections` (`packages/domain/src/rules/fresh-agent.ts:94`) acts only on `corrections-spent`.
- **A take-up ending names the wrong branch (#1281).** When the desk holds unlanded work at take-up, the `holding-work` ending names the newly assigned branch (`agent-loop.ts:453-457`). `supervise` then charges a correction to a slice that never started.

Today the supervisor's answers to endings are spread over three rules: `supervise` reads a `blocked` declaration, `freshAgentAfterCorrections` reads `corrections-spent`, and `rules/fresh-agent-turn-limit.ts` reads `turn-limit`. `packages/board/src/server/entry/registryd.ts:717` composes the last two. An ending that none of them names gets no action.

## Design

### Approach

**One rule decides the action for every ending.** `endingAction(readings)` in `packages/domain/src/rules/ending-action.ts` takes the desk's ending reason, the branch the ending names, whether a manifest already names the desk, the count of fresh sessions the slice already had, and whether the branch holds a commit beyond its claim or an open PR. It answers one of four actions:

| Ending | Today | Action | Slice |
|---|---|---|---|
| a turn that sealed with no commit beyond the claim, no PR and no marker | sealed as finished, claim kept (#1274) | release the claim | 1 |
| `holding-work` at take-up | names the new branch (#1281) | name the desk's own branch; release the new assignment's claim | 1 |
| `holding-work` after a prompt | no rule (#1288) | a fresh agent told to commit, check and push the held work; a second `holding-work` asks a person | 2 |
| `corrections-spent` | `freshAgentAfterCorrections` | a fresh agent once, then a person (unchanged, moved into the rule) | 2 |
| `turn-limit` | `rules/fresh-agent-turn-limit.ts` | a fresh agent once, then a person (unchanged, moved into the rule) | 2 |
| `blocked` | `supervise` answers `needs-a-person` | ask a person (unchanged) | 3 |
| `spend-limit` | to a person directly | ask a person (unchanged) | 3 |
| `unstarted` | no rule | ask a person: the invocation is broken | 3 |
| `run-limit` | no rule | ask a person: the slice spent its count | 3 |
| `checks-unanswered` | no rule | ask a person, with the `detail` (`no-answer` or `tip-moved`) | 3 |

Every other reason answers `leave`, and the open questions below name them. A desk that a manifest already names answers `leave` for every ending, as `freshAgentAfterCorrections` does today, because something already acts on it.

**A turn that did nothing gets an ending of its own.** Row 12a of `agentLoop` seals a turn only when the branch holds a commit beyond the claim. A turn with no such commit, no PR and no marker ends with the new reason `nothing-done`, and the supervisor releases the claim through `releaseClaim`, the domain workflow that `the-release-train-fixes-what-it-found` slice 9 builds. Slice 1 therefore waits on that branch.

**"Ask a person" uses the path a question already uses.** The supervisor writes a `PLOT-BLOCKED.md` marker on the desk that names the ending and its `detail`. `questionEscalation` (from `an-unanswered-question-escalates`) then lists the desk in WAITING ON YOU and notifies through `Notify command` as the question ages. No second escalation path exists.

**The rule is pure.** It reads no disk, as `supervise` and `freshAgentAfterCorrections` read none, so a restarted supervisor reaches the same action from the same files. The registry tick takes the readings and performs the action.

### Open Questions

- [ ] `limited`: the work stays on the desk and a `--restart` after the limit lifts resumes it. Should the supervisor restart the desk when the limit's reset time passes, or ask a person?
- [ ] `spent`, `unregistered`, `bound`, `quiet` and `unreadable`: each answers `leave` in this plan. Should `spent` (the context ran out) get a fresh agent as `turn-limit` does?

## Slices

### Endings that release the claim

- `infra/an-ending-that-held-nothing-releases-its-claim` <!-- waits: bug/a-claim-has-a-release-controller --> — the `nothing-done` ending reason, the take-up `holding-work` that names the desk's own branch, `endingAction` with its `release-claim` rows, and the registry tick that calls `releaseClaim` <!-- builds: endingAction, the supervisor's rule per ending -->

### Endings that get a fresh agent

- `infra/held-work-gets-a-fresh-agent` — the `holding-work` row with its commit-check-push answer, and `corrections-spent` and `turn-limit` moved from their two rules into `endingAction` <!-- builds: the fresh-agent rows of endingAction -->

### Endings that ask a person

- `infra/an-unrepaired-ending-asks-a-person` — the `needs-a-person` rows, and the supervisor's marker that hands them to `questionEscalation` <!-- builds: the ask-a-person rows of endingAction -->

## Done when

Each test below fails on `origin/main` (`a778bda0d`) today:

- `endingAction`: one test per row of the table answers the action in the table; a desk a manifest names answers `leave` for every ending; a second fresh session for `holding-work`, `corrections-spent` or `turn-limit` answers `needs-a-person`.
- `agentLoop`: a turn that exits `ran` with no commit beyond the claim, no PR and no marker ends `nothing-done` and does not seal; a take-up refused for unlanded work names the desk's own branch.
- The registry tick: a `nothing-done` ending releases the claim ref; a `holding-work` ending starts one fresh agent whose answer names the held files; an `unstarted` ending writes a marker that `questionEscalation` lists.
- `freshAgentAfterCorrections` and the turn-limit rule have no callers left, and their tests pass against `endingAction`.
- `node skills/plot/scripts/board/plot-local-checks.mjs` and the commands it prints pass on each branch.

## Notes

- 2026-10-07, direction from jwloka: every loop ending gets one supervisor action from a table, either release the claim, a fresh agent, or ask a person, with one slice per ending group; Type infra; reviewed in-session; own branches.
- Slice 1 waits on `bug/a-claim-has-a-release-controller`, slice 9 of `the-release-train-fixes-what-it-found`. The slices of this plan run in heading order, as every plan's slices do (`packages/domain/src/rules/eligible.ts:131-134`).
- Deliverable search, 2026-10-07:
  - Slice 1: no `endingAction`, `nothing-done` or equivalent rule. `rules/desk-lifecycle.ts:175` already answers `holding-work` for a desk's lifecycle; it reads the desk, not the ending, and stays.
  - Slice 2: `freshAgentAfterCorrections` (`rules/fresh-agent.ts`, one caller at `entry/registryd.ts:739`) and `rules/fresh-agent-turn-limit.ts:46` are the two rules this slice folds in. `registryd.ts:717` composes them today with one shared count.
  - Slice 3: `questionEscalation` and the `Notifier` port from `an-unanswered-question-escalates` carry the escalation; this slice adds no notification path.
