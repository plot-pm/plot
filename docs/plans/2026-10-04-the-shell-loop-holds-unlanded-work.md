# The shell loop holds unlanded work

> When a prompt ends with uncommitted or unpushed work, the shell worker loop ends with the reason `holding-work` and keeps the desk, instead of going free and leaving the work on a desk nobody owns.

## Status

- **State:** Approved
- **Type:** infra
- **Issue:** #1246
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-04, jwloka, in-session
- **Started:** 2026-10-04, jwloka, `infra/the-shell-loop-holds-unlanded-work`

## Changelog

- An agent whose prompt ends with uncommitted or unpushed work ends its loop with the reason `holding-work` and keeps the desk. It no longer goes free and leaves the work on a desk nobody owns (#1246).

<!-- Board impact: none to the plan format, the template or the docs/plans layout. The board reads the ending file it reads today; `holding-work` is one more value of `EndingReasonSchema`, which the board's schema imports from the domain. -->

## Motivation

On 2026-10-03 and 2026-10-04 an agent ended its prompt turn while it waited on a background job. The loop found the desk held by uncommitted work, cut a new desk for the next slice and went on, with 14 files left behind (#1246). It happened twice: `the-queue-reads-the-scans-order` and `the-parser-reads-every-wait`. Each time a person found the work by hand, on a desk that no agent and no manifest named.

This was slice 1 of `the-worker-loop-runs-in-js`. Four panel rounds on that plan found that this slice changes only the shell loop, depends on no other slice, and fixes a failure measured twice. In round 4, three of four jurors supported shipping it as its own plan, so that a small fix does not wait for a seven-slice approval. The operator agreed on 2026-10-04.

## Design

### Approach

**The loop asks the rule the estate already has.** After a prompt exits `ran` and the agent wrote no `PLOT-BLOCKED` marker, the shell loop asks `desk_reset_refusal` about its own desk. That is the shell side of `resetRefusals` (`rules/reapable.ts`), and `corpus/desk-reset.corpus.test.ts` pairs the two. On `uncommitted-changes` or `unpushed-commits` the loop:
- writes the ending `holding-work`, actor `agent`, with `desk_hold_reason`'s phrase as the detail;
- exits 0;
- does not hop to a new desk.

Any other answer leaves today's path unchanged. `desk_hold_reason` stays whole: the new ending's detail uses the same two arms that the hop's log line uses, and their tests stay as they are.

**The ending vocabulary grows by one.** `EndingReasonSchema` (`entities/ending.ts`) gains `holding-work`, and `ending.test.ts` grows with it. `endingIsAttributable` (`transitions/agent.ts`) admits actor `agent` for it, beside `unstarted`, `limited` and `unregistered`, because the agent's own loop observed the desk and stopped, and no watcher did. The refusal's sentence names the four. The doc comment on actor `agent` says "failed to start" today, and it is rewritten to cover an ending the agent's loop records about its own desk.

**What happens to the desk next.** This plan changes no rule that reads the desk.
- `deskState` reads the desk as `holding-work`, and `deskLifecycle` names a person for it, as it does today for any desk with unlanded work and no live worker.
- `supervise` reads no ending. The agent wrote no `blocked` declaration, so `supervise` answers `correct`: `gateFailures` names the dirty tree or the unpushed commits, and the correction tells the agent to land them, within `MAX_ATTEMPTS`. A spent budget answers `needs-a-person`.
- Today no performer carries out the supervisor's `agent-resume`, so in practice the desk waits for the person `deskLifecycle` names.

Either way the work stays on its desk and stays named.

**Exit 0, not 124.** The dispatch wrapper turns exit 0 into a `clear` line and a non-zero exit into `gone`, and the board reads `gone` as "restart it". The loop stopped on purpose and said why, so exit 0 is the true answer, and the ending file carries the reason.

**Each ending is also appended where the reaper does not reach.** `write_ending` appends each ending it writes as one JSON line to `.plot/state/endings.jsonl` in the main checkout. The main checkout is the first entry of `git worktree list`, the reading the loop already takes. Today `plot-reap.sh` removes a desk's ending file with the desk, and each loop end overwrites it. So no window of past endings can be counted. `the-worker-loop-runs-in-js` counts its shell baseline from this file. The append is best effort: a failed append is logged once and changes no ending and no exit code.

**The shell ratchet.** `scripts/check-shell-lines.sh` refuses a change that grows the shipped shell, and it allows no override. The PR runs `scripts/check-shell-lines.sh pr`, and it names each line it removes to pay for the ending, the exit and the append. If the PR cannot find those lines, the slice stops and reports. The gate is not widened.

**Tests.** `test/reconcile/` gains cases where a prompt exits `ran`:
- uncommitted changes and no marker: the ending is `holding-work`, the exit is 0, no new desk is cut, and the original desk keeps its files;
- unpushed commits and no marker: the same;
- an agent-written marker on a dirty desk: today's path, unchanged;
- a clean, pushed desk: today's path, unchanged;
- each ending adds one line to `endings.jsonl`, and a missing main checkout changes no exit code.

The domain side has `ending.test.ts` for the new value and an `endingIsAttributable` case for actor `agent`. The brief names the existing tests that read the hop's log line, checked against the code on the day.

### Open Questions

- [ ] Where does the agent's turn-ending rule live? #1246 has two halves. This plan takes the first: the loop must not go free on unlanded work. The second is that the worker prompt must say a turn ends only when work is pushed or blocked. It may be its own plan.

## Slices

### The shell loop holds unlanded work

- `infra/the-shell-loop-holds-unlanded-work` — the shell loop ends with `holding-work`, exit 0, when `desk_reset_refusal` holds its own desk for unlanded work, and `write_ending` appends each ending to `.plot/state/endings.jsonl`; no net shell growth <!-- builds: the holding-work ending in the shell loop --> → #1271

## Notes

- 2026-10-04, direction from jwloka: split out of `the-worker-loop-runs-in-js` (slice 1 there) after its round 4; Type infra, reviewed in-session, own branches, as that plan recorded.
- The four panel rounds of `the-worker-loop-runs-in-js` questioned this slice as part of that plan: `.plot/panels/2026-10-04-the-worker-loop-runs-in-js/round1.md` to `round4.md`. Their slice-1 findings are answered here: the `desk_hold_reason` arms stay (round 3), the CI-wait tip reading moved to the JS loop (round 4), and `supervise`'s answer for this desk is stated (round 4).
