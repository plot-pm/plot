# A slice nobody worked on reads not started

> The board has no reading for a slice with no work on it, so it guesses. On 2026-09-30 an empty claim sat in DONE as *merged*, a slice with no branch sat in WAITING ON YOU as *commits, no PR ever opened*, and a slice with a live agent sat in DONE because of a PR the agent had closed.

## Status

- **State:** Released
- **Approved:** 2026-09-30, jwloka, in-session
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1090, #1091
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 4
- **Started:** 2026-09-30, jwloka, `bug/a-slice-with-no-work-waits-in-not-started`
- **Delivered:** 2026-09-30
- **Released:** 2026-10-01, v2.22.0

## Changelog

- A claimed branch with no work of its own no longer reads as merged when the host was asked and holds no merged PR for it, a slice whose branch does not exist waits in NOT STARTED, and a slice with a live agent stays in WORKING whatever its PR history.

Board impact: yes. Rows move between sections; no payload field is added or removed.

## Motivation

Three rows measured 2026-09-30:

| Slice | Board | Truth |
|---|---|---|
| `bug/the-suites-own-their-temp-root` | DONE, state `merged`, wave `complete` | A ref pushed at the then-tip of `main`; main has moved on. No commit of its own; `plot-host.sh pr-state` answers `NONE`. |
| `bug/every-state-file-declares-its-bound` | WAITING ON YOU, *commits, no PR ever opened, age unknown* | No ref on `origin`, none locally, none in any worktree; state `blocked`, brief missing. |
| `bug/a-state-sweep-is-one-request` (#1049) | DONE, *PR closed without merging*, green live marker | An agent resumed 40 min earlier and held two file-touching commits; it had opened #1089 from its claim commit and closed it 38 s later. |

A fourth, older case is #1090's own: `bug/the-board-runs-the-artifact-its-repo-built` (#1055) sat in DONE as *delivered / merged* for 20 h with 0 commits, no PR and its plan still `Approved`.

**`merged` is the worst of these.** It settles a wave, so a slice nobody wrote can open the next wave.

## Design

### Slice 1: a slice with no work waits in NOT STARTED, and a live agent keeps WORKING

This slice lands first. Slice 2 turns a zero-ahead ref from `merged` into `open` or `unknown`, and without this slice such a row would fall to the `wip` tail and read *commits, no PR ever opened*.

**Every branch state has an arm.** `classifyGroup` (`packages/board/src/server/fleet.ts:4073`) has arms for `deferred`, `open`, `claimed` and `merged`; every other state falls to the tail commented `// state === 'wip'`, which builds `wipReadings` and asks `quietNote`. `blocked`, `waiting` and `unknown` reach that tail today and read `abandoned`. The tail is guarded on `state === 'wip'`, and the three gain arms, each in NOT STARTED with its own sentence:

| State | Meaning (`branch-state.ts`) | Sentence |
|---|---|---|
| `blocked` | a prerequisite branch the host has never seen a PR for | *waits for `<prerequisite>`, which has no pull request* |
| `waiting` | a prerequisite with a wait that ends | *waits for `<prerequisite>`* |
| `unknown` | the readings do not determine the state | *state unknown — the host's answer is incomplete* |

The prerequisite is the branch the slice's `waits:` annotation names; `blocked` and `waiting` arise only from that annotation. The pulse carries it as `waits_on`, and `classifyGroup` gains it as a new trailing parameter, passed from `rowsFromPulse`. `BLOCKED_NOTE` stays the slice-verdict sentence (*blocked by an earlier slice*) and is not reused for the branch state. A state the classifier does not recognise returns NOT STARTED with *state `<word>` not recognised*, never the `wip` tail. **The three arms sit after the worker block, not before it.** `blocked`, `waiting` and `unknown` reach the worker block today, so a running agent on such a branch reads WORKING; the new arms only replace the `wip` tail those rows fall to when no worker holds them, and a live agent still outranks every branch state. `classifier-is-total.test.ts` adds `blocked`, `waiting` and `unknown` to its `STATES` (`:77`).

**A live agent outranks a closed PR.** `rowsFromPulse` sets `group = closedPr ? 'done' : openGroup` (`fleet.ts:6542-6547`) without reading the worker. While `worker` is `running` or `waiting`, the row stays in `openGroup` and keeps *PR closed without merging* as a second fact in the note, and `rowQuietKind` (`fleet.ts:5257`) receives `closed = null` for that row, so the WORKING row carries no `closed-pr` kind. A closed PR is terminal for the PR, not for the branch.

### Slice 2: zero ahead and behind main is not merged when the host says so

`branchState` (`packages/domain/src/rules/branch-state.ts:262-271`) ends its zero-ahead arm with `return 'merged'` for any ref strictly behind the default branch, without reading `pr` or `hostReach`. The rule becomes a table over every reading the arm receives:

| Reading | Answer |
|---|---|
| `mainTip` null (main unreadable) | `unknown` |
| `pr === 'MERGED'` | `merged` |
| `hostReach` `unasked` (offline, or no git host) | `merged`, as today |
| `hostReach` `throttled`, `secondary` or `failed` (the bundle's `reachFrom` reads the scan's `partial` as `failed`) | `unknown` |
| host asked, `pr` `unreadable` | `unknown` |
| host asked, `pr` `OPEN` | `wip` |
| host asked, `pr` `none` or `CLOSED`, PR list complete | `open` |
| host asked, `pr` `none` or `CLOSED`, PR list not complete | `unknown` |

**`unasked` keeps `merged`.** A repository with no git host, or a scan run `--offline`, has zero-ahead-behind as its only merge signal, and a branch merged by merge commit with its ref kept reads that way. Measured by the round-1 juror: the literal *open without evidence* rule failed 8 of 163 `fleet.test.mjs` tests, one of them `--next` offering the merged `feature/tracer` as the next branch to start; keeping `merged` for `unasked` passed 163 of 163.

**`open` needs a complete PR list.** `host_pr_state` answers `NONE` from a list capped at `PR_LIST_LIMIT` (1000; this repository has 1010 PRs), so a merged PR outside the window reads `NONE`. `BranchReadings` gains `prListComplete`, which the scan fills from `.list-complete` (`plot-fleet-scan.sh:1075-1080`, one path for GitHub and Bitbucket); without it the answer is `unknown`, which holds its wave instead of reopening landed work. It reaches `board/plot-branch-state.mjs` as an eleventh positional field, and the bundle requires exactly 11 after this slice, refusing any other count with exit 2 as it refuses 11 today. The scan is the only caller that sends lines, and the bundle and the scan ship in the same slice, so no 10-field line can arrive. Every path that builds a line carries the field, including the prerequisite refill at `plot-fleet-scan.sh:3923`, which rebuilds the line with `cut -f1-9` plus the prerequisite's word and would otherwise drop it. The corpus's `readingsFor` passes it too.

**On this repository the list is never complete** (1011 PRs against `PR_LIST_LIMIT` 1000), so an empty claim here reads `unknown`, not `open`, until the limit is raised. `unknown` still holds its wave and renders in NOT STARTED, which is what the measured rows need; `merged` was the harm.

`mergeSubjectFound` is not zero-ahead evidence: the scan reports it only on the no-ref arm.

**This reverses a recorded decision, on purpose.** `branch-state.test.ts:306-319` says the arm is *"NOT fixed by answering `open` instead"* and that *"the discriminator is the PR index"*. The host's PR answer, bounded by the list's completeness, is that discriminator. The tests that change, each on purpose:

- `branch-state.test.ts`: the eight cases (six assertion lines) that pin `merged` for this arm are rewritten to the table, with the note at `:306-319` replaced.
- `branch-state.test.ts:188`: a ref behind main whose `waits:` prerequisite has an OPEN PR reads `merged` today; once the zero-ahead arm answers `open`, the wait verdict applies as it does to every `open` branch, and the case reads `waiting`.
- `a-failed-scan-keeps-the-last-sections.test.ts:57` and `:89-92` (the #995 guard) build their `done` row from exactly this reading. The guard's subject is that a failed scan does not move a remembered row to DONE, not the reading; the fixture is rebuilt from a reading that still answers `merged` (`pr: 'MERGED'`), so the guard keeps testing what it tests.

**Who reads the new `open`.** `plot-fleet-scan.sh --next` offers an `open` branch as claimable. The supervisor's queue treats every existing ref as claimed (`registryd-main.ts:534`), so it still does not hand such a slice to an agent until the ref is released. The operator's hold, an empty ref pushed to keep a slice from the queue, therefore still holds against the supervisor, and reads `open` rather than `merged` to a reader and to `--next`.

### What this does NOT do

- **It does not fix the queue.** The supervisor's queue ignores `waits:` (#1100); that stays filed.
- **It does not change `/plot-implement`.** An empty claimed branch with no worker (#1090's first half) is still created; this plan stops it reading as merged.
- **It does not relabel free desks** (#1101).

## Done when

- Slice 1: a `blocked`, `waiting` or `unknown` row with no ref and worker `none` or `elsewhere` classifies to `not-started` with its own sentence naming `waits_on` where it applies, never *commits, no PR ever opened*; the same row with a running worker classifies to `working`; `classifier-is-total.test.ts` covers all eight states; a `wip` row with real commits, no PR and no worker still reads `abandoned`.
- Slice 1: a row with a closed PR and `worker` `running` or `waiting` classifies to its open group with no `closed-pr` quiet kind; with no live worker it stays in DONE as today.
- Slice 2: `branch-state.test.ts` asserts every row of the table, `:188` reads `waiting`, and `test/reconcile/fleet.test.mjs` passes whole, run `--offline` as it is.
- Slice 2: under a host shim answering `NONE` with a complete list, a plan whose second slice is a zero-ahead ref behind main does not complete that slice's wave; with the list incomplete the slice reads `unknown`.
- Slice 2: under the same shim, a zero-ahead ref behind main whose `waits:` prerequisite has MERGED reads `open` through the scan's prerequisite refill path, proving the eleventh field survives `plot-fleet-scan.sh:3923`.
- Slice 2: the corpus test gains fixture readings for every table row and asserts the rule and `board/plot-branch-state.mjs` answer the same state for each, and the bundle refuses a 10-field line with exit 2.
- Slice 2: the #995 guard passes with its rebuilt fixture.
- Slice 2, landing second: the three measured rows, rebuilt as fixtures, land in NOT STARTED, NOT STARTED and WORKING.

## Slices

### No work waits in not started (Branch: bug/a-slice-with-no-work-waits-in-not-started, PR: #1106)

`classifyGroup`'s arms for `blocked`, `waiting` and `unknown` after the worker block, the `waits_on` parameter, the tail guarded on `wip`, `rowsFromPulse`'s closed-PR arm yielding to a live worker, and `classifier-is-total.test.ts`.

### Zero ahead is not merged (Branch: bug/zero-ahead-is-not-merged, PR: #1108)

`branchState`'s zero-ahead table, the `prListComplete` reading, the scan and the bundle carrying it as an eleventh field, the corpus fixtures, the rewritten tests named above, and the three measured rows as fixtures.

## Notes

**Implementation notes from round 4.** Every `BranchReadings` literal gains `prListComplete`: `branch-state.test.ts:25`, the three in the #995 guard, and the corpus `readingsFor`, which can fill it from `readPrList().complete`; update the docs at `entry/branch-state.ts:15` and `:57-72`. The PR list counts as complete only with at least one row (`plot-fleet-scan.sh:1078`), and the refill shim answers `NONE` for the slice and `MERGED` for its prerequisite. The `mainTip` null row reads `unknown` for an unreadable main, not an incomplete host answer; give it its own sentence if the arm can tell them apart.

**Found while recovering the fleet on 2026-09-30.** One of the three rows was made by the operator's own recovery: an empty claim pushed at `origin/main` to keep the queue from handing out slice 2 of #1083 early (#1100), which then read as merged.

**Round 1 (2026-09-30) reordered the slices.** The classifier lands first because the branch-state change alone sends a zero-ahead row to the `wip` tail.
