# The worker loop asks the domain

> `plot-worker-loop.sh` is 1,832 lines, reaches the domain **zero times**, and decides whether a desk may be reset from three conditions the domain already answers under another name.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #789 merged
- **Started:** 2026-09-07, Jan Wloka, `bug/the-worker-loop-asks-the-domain`
- **Delivered:** 2026-09-08
- **Released:** 2026-09-08, 2.15.0

## Changelog

- The agent's loop asks the domain whether its desk may be reset, so the condition is decided where the reaper's is.

## Motivation

**Measured 2026-09-07**, asking whether any state-changing decision lives outside the domain.

**The mock signal is healthy and says the boundary mostly holds.** One file in the whole estate uses `vi.mock`; **118 use fixtures**. Expensive mock testing is the symptom of logic tangled with I/O, and this estate does not have it — the domain takes readings as values and its adapters have fixture twins.

**Adapters are clean.** The three with the most branching — `slots-file.ts` (20), `refs-git.ts` (14), `scripts-shell.ts` (13) — branch on `ESRCH`, `EPERM`, unparseable numbers and empty overrides. **Errno and parse guards, which is exactly an adapter's work.** None decides a business condition.

**Most shell scripts are transport or reporting.** `plot-host.sh` has 3,063 lines and zero domain calls, and every predicate in it — `is_rate_refusal`, `is_lookup_miss`, `host_miss_or_fail` — classifies a **transport** outcome. That is a connector's own job.

**`plot-worker-loop.sh` IS THE EXCEPTION.** 1,832 lines, **zero domain calls**, 26 functions, and one of them decides policy:

```sh
desk_is_resettable() {
  [ -n "$wt" ] && [ -d "$wt" ] || return 1
  [ -n "$(plot_worker_dirty "$wt")" ] && return 1
  if ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' …
  return 0
}
```

**Not dirty, not ahead of upstream, tree exists** — *may this desk be thrown away?* **`rules/reapable.ts` answers that question**, with `uncommittedChanges`, `liveWorker`, `blockedMarker`, `merge` and `vanished`.

**AND THE TWO OVERLAP WITHOUT MATCHING, WHICH IS WORSE THAN A COPY.** The loop asks three conditions; the rule asks five. A desk carrying a `PLOT-BLOCKED` marker is **not reapable** by the rule and **is resettable** by the loop, because the loop never looks. Two answers to *is this desk finished with*, and the more destructive one — the loop resets the agent's own tree — checks less.

**THE LOOP RUNS UNATTENDED, PER AGENT, ON EVERY PASS.** That is the code with the fewest readers and the most authority over an agent's work.

## What this is not

**Not a rewrite of the loop.** 1,832 lines of process handling, trap management and bounded waits stay. **One function moves.**

**Not a claim that the adapters or the other scripts are wrong.** They were measured and they are right: adapters guard errno, `plot-host.sh` classifies transport, `plot-reconcile-scan.sh` reports.

**Not the `plot-worker-state.sh` duplication.** That is [`an-agent-state-has-one-deriver`](2026-09-07-an-agent-state-has-one-deriver.md), and it concerns eight *readings*. This is one *decision*, and the two are separate.

## Slices

### The loop asks whether the desk is finished with (Branch: bug/the-worker-loop-asks-the-domain) <!-- waits: infra/a-shell-script-asks-the-domain -->

`desk_is_resettable` asks `finishedWith` instead of deciding.

**THE RULE ALREADY TAKES READINGS AS VALUES.** `finishedWith(readings)` needs no port and performs no I/O; the loop keeps gathering exactly what it gathers now.

**THE MARKER IS THE MEASURED GAP AND MUST BE IN THE READINGS.** A desk holding an agent's own question to a person is not a desk to reset. The loop does not look today; the rule does.

**IT MUST NOT COST A `node` HOP PER PASS.** [`a-shell-script-asks-the-domain`](2026-09-07-a-shell-script-asks-the-domain.md) settles this, and `docs/shell-and-domain.md` is where the rule now lives: a script running once per operator command calls the domain, one running once per agent per pass duplicates the rule and a corpus comparison holds the pair. **This loop is the second case** — it runs per agent on every pass — so it keeps its own implementation and the comparison is the deliverable. The contract also says where a call goes and how a disagreement reports; this slice uses those rather than restating them.

**THE VERDICT NAMES THE CONDITION THAT REFUSED.** `finishedWith` returns a refusal reason, and the loop logs a bare failure today. A reset refused because of a marker reads differently from one refused because of unpushed commits.

**Done when** the loop's reset condition is `finishedWith`'s, a desk carrying a `PLOT-BLOCKED` marker is never reset, the refusal names its condition, and the measured cost per pass is stated.

## Notes

### What the mock signal actually showed — 2026-09-07

The question came with an indicator: expensive mock testing means logic tangled with I/O. **The estate scores well** — 1 file with `vi.mock`, 118 with fixtures — and that is not luck. `finishedWith(readings)`, `branchState(readings)` and `scoreItem(item, delivered)` take values, so their tests need no mocks at all.

**The signal is silent about this defect, though**, and that is worth recording. `desk_is_resettable` is not tested with mocks because **it is not tested at all** — it is bash inside a loop that CI exercises end to end, where a wrong reset looks like a passing test and a lost desk.

**So the indicator finds tangled code and not absent code.** A decision that never entered the domain leaves no mock behind to notice.
