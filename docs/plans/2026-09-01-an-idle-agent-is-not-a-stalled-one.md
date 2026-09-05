# An idle agent is not a stalled one

> `idle` is a 0.4 s CPU sample of a subtree that spends most of its life waiting on a model. Seven desks were killed mid-work by a reading that cannot tell thinking from stuck.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Started:** 2026-09-02, Jan Wloka, `bug/a-thinking-agent-has-a-quiet-stretch`
- **Started:** 2026-09-02, Jan Wloka, `bug/the-loop-reads-the-agents-own-stream`
- **Started:** 2026-09-02, Jan Wloka, `bug/an-ended-worker-names-its-reading`
- **Delivered:** 2026-09-02
- **Released:** 2026-09-05, 2.13.0

## Changelog

- A dispatched agent waiting on a model response is no longer ended as stalled: the loop's end condition reads something an agent at work cannot fake, so a slow answer costs time rather than the work.

Board impact: real. The `idle` state is one of the eight `plot-worker-state.sh` answers the board renders, and a `WAITING ON YOU` row that meant *"the monitor ended it"* changes meaning. Rebuild the artifact (`pnpm build:board`).

## Motivation

**Measured 2026-09-01, and again 2026-09-02.** Seven desks carried `reported idle on` when this plan was written; three more were killed on 2026-09-02 within minutes of dispatch — `bug/the-host-adapter-counts-what-it-spends`, `feature/an-agent-remembers-its-session` and `feature/dispatch-refuses-a-waiting-slice` — each holding uncommitted work including new test files, which makes ten. The rule now ends workers faster than they finish.

Every one of the original seven held real commits when it was ended, and five had to be finished by hand:

```
a-budget-belongs-to-the-computer            5 commits, clean     → #621
a-report-can-open-the-pr                    5 commits, clean     → #624
one-eligibility-rule-decides                2 commits, 5 dirty   → #590
the-ports-read-activity-and-trees           5 commits, clean     → #625
the-gates-read-what-was-left-behind         2 commits, 1 dirty   → no PR
one-place-reaches-a-script                  8 commits, 1 dirty   → #619
the-plan-tab-tests-serve-their-own-state    4 commits, 1 dirty   → #585
```

`feature/the-gates-read-what-was-left-behind` is the clearest case. It was dispatched with a brief and **ended 11 seconds later**, holding 2 commits and a changeset it had not finished writing:

```
the agent pid 24604 is alive but its subtree burned no CPU across two
consecutive passes ~30s apart, the tree is unchanged between them, and
the branch already carries commits
plot-worker-loop: ... ending worker without hopping
```

**The reading is a 0.4 second sample.** `plot_worker_activity` (`plot-worker-state.sh:494`) reads the subtree's CPU clock, sleeps `PLOT_ACTIVITY_INTERVAL` — **0.4 s** by default (`plot-worker-state.sh:493`) — reads it again, and calls the subtree `idle` when the two are equal. The monitor requires two such readings 30 s apart before publishing, and `plot-worker-loop.sh` then kills the worker.

**An agent at work is idle by this definition for most of its life.** A `claude -p` session spends its time waiting on a model response, and a process waiting on a socket burns no CPU. So a zero is the expected reading, not the anomalous one, and two zeros 30 s apart says only that the agent was waiting twice.

**The tree condition does not save it.** `monitor_tree_fingerprint` covers HEAD plus the filtered `git status`, so an agent that is *reading* — the whole first phase of every brief — changes nothing on disk and commits nothing. It reads as a stall by every condition the rule applies.

### What this corrects

Eight desks rescued earlier the same evening were recorded as `exit 124` `Worker bound` expiries, and that reading is wrong. The bound is 8 hours; these died in minutes. Their own monitor ended them, which is why every one of them held commits and no PR — a shape that was attributed to a timeout and is actually this rule firing.

## Design

### The end condition must read something an agent at work cannot produce

`idle` answers *is this process consuming CPU right now?* The loop needs *has this agent stopped making progress?* Those differ in exactly the case that matters, and no sampling interval closes the gap: a slow model response is indistinguishable from a dead one by CPU alone.

Three candidate readings, and what each costs:

| Reading | Detects a real stall | False positive on a thinking agent |
|---|---|---|
| subtree CPU over 0.4 s | sometimes | **usually** |
| subtree CPU over a long window | sometimes | less often, never no |
| **no output on the agent's own stream** | yes | no, while the stream is live |

**The third is the only one that reads the agent rather than the machine.** A `claude -p` session writes to its transcript as it works; a session that has produced nothing for a long interval has genuinely stopped, whatever its CPU clock says. `plot_session_id` already asserts a transcript id and the board already joins on it, so the reading has a source.

**It is not free.** The transcript exists only where the adopting project's `.plot/worker-prompt.sh` passes `--session-id`, which Plot cannot require — `the-registry-supervises-its-agents` settled that the contract is split across that boundary and that a missing transcript makes the capability **unavailable** rather than failed. So the fallback matters as much as the reading.

### The fallback is the bound, and that is the honest answer

Where no transcript can be read, there is no reading that distinguishes thinking from stuck, and the plan should say so rather than invent one. `Worker bound` then ends the worker, which is what it is for. The cost is stated: a genuinely stuck agent holds a desk for up to 8 hours.

**That cost is smaller than the one measured.** A stuck agent costs one desk and one slot. This rule cost seven desks' work, five of them needing a person, and a fleet whose crashes were attributed to the wrong cause for a whole evening.

### Not chosen: widen the sample

Any interval still guesses, and the failure is not a short window — it is that CPU does not answer the question. A wider sample makes the false positive rarer without making it wrong less often, and a rule that fires once a week is harder to diagnose than one that fires every hour.

### Not chosen: require more consecutive idle passes

Cheapest to write and wrong in the same way. Three zeros are three readings of a waiting process. It also delays a real stall by an interval per pass, so it trades the false positive for a slower true positive without removing either.

### Not chosen: keep the kill and let a supervisor undo it

`the-registry-supervises-its-agents` would resume a killed agent with a correction, which sounds like it absorbs this. It does not: resume needs the transcript this plan needs, and an agent ended mid-edit leaves the uncommitted state its successor inherits — the plan's own `perform-fs.ts` case, *"239 lines committed UNVERIFIED"*, is what a rescue of a rescue produces. Not killing a working agent is strictly better than killing and recovering it.

### What already shipped, and why it is not the fix

`PLOT_MONITOR_ENDS_WORKER=0` (#631) is a seam, not an answer. It removes the kill and leaves the reading published, so an operator can protect a fleet tonight. It defaults to today's behaviour deliberately: changing a kill's default under a running fleet is a second failure, and the reading deserves an argued replacement rather than a flag flip.

### Open Questions

- [ ] What interval counts as *no output* on a live transcript? Measure a real session's quietest stretch first — a threshold below it kills working agents exactly as today's does.
- [ ] Does the WorkerMonitor keep publishing `idle` once nothing ends a worker on it? A finding nobody acts on is the crowding this board keeps removing, but `idle` beside a live pid may still be worth showing.
- [ ] Should `elsewhere` agents be readable this way at all? A transcript is a local file, so a machine cannot read another machine's agent — the same boundary `the-registry-supervises-its-agents` settled as per-checkout.

## Slices

### Measuring what a working agent looks like

- `bug/a-thinking-agent-has-a-quiet-stretch` — sample a real dispatched session's transcript and CPU clock together, and record the longest quiet stretch of an agent that finished successfully. The threshold every later slice needs, measured rather than chosen. No production change.

### Reading the agent instead of the machine

- `bug/the-loop-reads-the-agents-own-stream` — the end condition reads transcript quiet rather than subtree CPU, with the measured threshold, and reports itself **unavailable** where no transcript exists. The fallback is `Worker bound`. (#653)

### Saying what happened

- `bug/an-ended-worker-names-its-reading` — the log line and the board row distinguish *the bound expired*, *the agent went quiet*, and *nobody could tell*. Three readings mean three different things about the work on the desk, and today two of them print the same sentence.

## Done when

- **A dispatched agent that only reads for ten minutes is not ended** — asserted against a real session, since the whole defect is that a synthetic agent burning CPU passes today's rule and a real one does not.
- A genuinely stopped agent is still ended, and the reading that ended it is named in the log.
- **Where the adopter's prompt passes no `--session-id`, the loop says the reading is unavailable and falls back to the bound** — asserted against a prompt file that deliberately omits the flag, because that is the configuration Plot cannot control.
- `PLOT_MONITOR_ENDS_WORKER` is gone, or documented as the escape it became. A seam kept past its replacement is a second implementation.
- The seven desks in Motivation are re-read against the new condition, and each is either correctly quiet or correctly ended.
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

## Notes

**Found while dispatching four briefed branches.** One died 11 seconds in, and its log named the cause plainly. The seven-desk count came from `grep -l 'reported idle on' .worktrees/*/.plot-worker.log`, which is why it is a floor rather than a total — a reaped worktree takes its log with it.

**The rule was right to exist.** `CLAUDE.md` records why, describing `plot-worker-state.sh`: *"every worker exits 0, so the exit code cannot say whether the work is done."* Something has to notice a worker that stopped, and inferring it from a process ending was already known to be wrong. This plan does not remove the question; it changes what is sampled to answer it.

## What the measurement found, and what it changes

**Measured 2026-09-02 by `bug/a-thinking-agent-has-a-quiet-stretch`**, over 23 dispatched sessions in 21 worktrees, 7,547 quiet stretches:

```
Longest quiet         600.8s
p50 / p90 / p99       0s / 2.6s / 15.6s
Over the 30s window   37 stretches, in 9 of 23 sessions
```

**Nine of 23 sessions cross the window the rule kills on.** The rule needs two consecutive quiet passes, and 39% of sessions offer it more than one chance.

**The split overturns this plan's own hypothesis.** The Design argues the false positive comes from an agent *thinking* — waiting on a model response. The data says that is the minority case:

| waiting on | stretches ≥ 30s | longest |
|---|---|---|
| the model (thinking) | **9** | 109.6s |
| **its own command** | **28** | **600.8s** |

**Three quarters of the dangerous quiet is an agent waiting on a subprocess it started.** The ten-minute stretches are `pnpm run test:reconcile`, `pnpm run test:board`, `npx vitest run`, `gh pr checks --watch`. Those burn CPU heavily — in a child the sampler does not attribute to the agent's subtree.

That matters for wave 2. A transcript-quiet reading fixes the thinking case and **leaves the larger one unfixed**: an agent waiting ten minutes on its own test suite writes nothing to its transcript either. The reading must either attribute a child's CPU to the agent that spawned it, or treat *an outstanding subprocess* as evidence of work, or both. Reading the transcript alone would still kill 28 of the 37.

**The measurement includes its own author.** `bug-a-thinking-agent-has-a-quiet-stretch` appears in its own data at 40.1s with 2 stretches over the window, and the rule ended that worker while it was writing this tool. Nothing was lost — the brief told it to commit early and it had, three times.

**`PLOT_QS_HOME` has no default.** Running `plot-quiet-stretch.mjs` without it reports `0 sessions across 21 worktrees` rather than failing, which is a silent wrong answer. Set `PLOT_QS_HOME="$HOME"` and `PLOT_QS_WORKTREES` to the worktree root, or fix the default before the next slice relies on it.
