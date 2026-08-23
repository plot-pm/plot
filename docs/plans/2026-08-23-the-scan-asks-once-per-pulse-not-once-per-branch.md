# The scan asks once per pulse, not once per branch

> An idle board spends 3700 GitHub calls an hour and exhausts a 5000/hour GraphQL budget in ~81 minutes. 96% of them are the per-branch `pr view` that #228 was filed to remove — surviving on the one arm the join left behind.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** #228
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- An open board no longer exhausts the git host's hourly API budget while idle: branch PR state is resolved from the one repo-wide list the scan already fetches, instead of one request per branch per pulse.

<!-- Board impact: touches skills/plot/scripts/plot-fleet-scan.sh (the join and
     the terminal cache) and possibly packages/board/src/server/fleet.ts (the
     cache handoff). Rebuild the artifact if fleet.ts changes. -->

## Motivation

Measured on this repo, 2026-08-23, with a PATH-stubbed `gh` counting every
invocation against an **idle** board — no merges, no dispatches, nobody
clicking:

```
129 calls / 105 s  =  ~3700 calls/hour   (budget 5000/hour → exhausted in ~81 min)
  124  pr view   (per-branch)
    3  pr list   (whole-repo)
    1  issue list
    1  api rate_limit
```

**96% of the traffic is the per-branch call.** That is the N+1 shape issue #228
was filed about — *"Fleet scan asks the host once per branch: 39 Bitbucket
requests for 14 branches"* — reappearing on GitHub, where #228 predicted it
would stay invisible:

> **Why it is invisible on GitHub.** `gh pr view` is one request and fast, so N
> lookups stay under the timeout — the loop is wasteful there too, just not
> fatally.

It is now fatal on GitHub too, for a reason #228 could not have seen: this repo
went from 14 branches to **99**, and the board polls every 5 s.

### And the cost multiplies per board

Measured the same evening: **six board servers were running at once** on this
machine — one per worktree an operator or a test had left open, each respawned by
`node --watch`. Each spawns its own scan on its own 5 s timer, and each scan
re-asks the same ~99 branches, because the cache that would have prevented it is
per-invocation.

The whole 5000-call GraphQL budget went in roughly **90 minutes** of ordinary
work, and the session could not query PR state to finish merging — the tooling
took the budget the operator needed. REST sat untouched at 4999/5000 throughout,
which is what identifies the drain as the scan (GraphQL, via `gh pr *`) rather
than as merge activity (REST, via `gh api`).

**This is not a separate defect and must not become a separate plan.** Six boards
is a symptom of a development machine, not of a bug; the reason six boards can
exhaust a budget is the per-branch call, and removing it makes the board's cost
per pulse independent of the branch count. A fix aimed at "run fewer boards"
would leave a single board exhausting the budget in ~81 minutes, which is the
measured starting point.

### The branches that cost a call have NO PR AT ALL

Measured by stubbing `PATH` and running ONE scan to completion, 2026-08-23:

```
one scan: 28 s, 29 calls
  28  pr view   (per-branch)
   1  pr list   (whole-repo)

of the 28 branches asked:  0 appear in the pr-list response
                          28 appear nowhere in it
```

Every branch that costs a round trip is one with **no pull request** —
`bug/loose-checks-the-rollup`, `bug/the-blocking-wave-is-found-wherever-it-is`,
and 26 more. They are claimed branches nobody has opened a PR for.

**The scan pays a network round trip to re-learn that a branch still has no PR,
once per branch, every scan, forever.** Nothing about that answer can change
without the `pr-list` response changing too.

### What #232 already does, correctly

`prefill_pr_states` (line 467) fetches every PR for the repo in ONE call and
caches `branch → state` for each. **It keys on the head-branch NAME the host
reports, not on any local ref** — verified against this repo: of 300 PRs, 279
have a deleted head ref, and `pr-list` names the head branch for all 279.

So the ref-deleted population — the one #232's docstring names as the remaining
per-branch cost — is already served from the cache and costs nothing:

```
PRs in pr-list:                    300
  head ref deleted:                279   ← all cached, zero calls
branches asked per scan:            28   ← none of them in the list at all
```

**This plan therefore does NOT re-key the join.** An earlier draft proposed
exactly that, before `prefill_pr_states` had been read closely enough; the
measurement above refuted it. Recorded rather than deleted, because the wrong
fix is the plausible one and the next reader will reach for it too.

### Why the terminal cache cannot help either

The cross-pulse cache (`PLOT_TERMINAL_CACHE`) is well built and is not the
defect. `terminal_learn` refuses anything but `MERGED|CLOSED`:

> `MERGED` and `CLOSED` are settled; `OPEN` and `NONE` are not, because both can
> change without anything local moving.

That is correct, and it is why the cache is silent here: **every branch being
asked answers `NONE`**, the state the cache deliberately does not keep. Widening
it to `NONE` would be wrong for the stated reason — a branch acquires a PR
without anything local moving.

The answer is not to remember `NONE` across pulses. It is to **derive** it
within a pulse, from the list the scan already has.

### What is NOT the cause — the two candidates ruled out

Both were checked before this plan blamed the scan:

| source | rate, one board | can it exhaust 5000/hr? |
|---|---|---|
| scan's per-branch `pr view` | **~3,600/hr** | **yes, in ~78 min** |
| scan's own `pr list` | 129/hr | no |
| `refreshPrs` (60 s timer) | 60/hr | no |
| `issue-list` (60 s timer) | 60/hr | no |

The two timers total **120/hr — 2.4% of the budget.** They are correctly
throttled and are not worth touching. `refreshPrs` in particular is the fix
from #226 working exactly as designed.

### The per-board multiplier, measured

Four board processes were running simultaneously on this machine, from four
different worktrees — started by test runs and `node --watch` supervisors that
restart them. Each holds its own state and scans independently:

```
1 board  ≈  3,850 calls/hour   →  budget gone in ~78 min
4 boards ≈ 15,400 calls/hour   →  budget gone in ~19 min
```

The board's own `entry.running` guard (fleet.ts:1710) correctly prevents
overlapping scans **within** a process; it cannot see the other three.

**Several boards is a symptom of a development machine, not a bug, and this plan
does not propose limiting it.** The reason four boards can exhaust a budget is
the per-branch call: remove it and a board's cost stops scaling with the branch
count, so four boards cost four times a number that is no longer large.

## Design

### The fix: an arrived list makes `NONE` derivable

The machinery already exists and is simply not consulted in the right order.
`prefill_pr_states` writes a `.list-arrived` marker on success, and
`host_pr_state`'s NON-`--ask` arm already reads it:

```sh
if [ -n "$HOST_STATE_CACHE" ] && [ -f "$HOST_STATE_CACHE/.list-arrived" ]; then
  printf '%s' 'NONE'      # the list came, this branch is not in it → no PR
else
  printf '%s' '-'         # the list never came → the question was not answered
fi
```

That is exactly the right reasoning — and the `--ask` arm returns **above** it,
so a caller passing `--ask` never reaches it. The change is to test
`.list-arrived` FIRST: with the list in hand, a cache miss is already the
answer, and asking the host cannot improve on it.

`--ask` then means *ask if nobody could otherwise tell me*, rather than *ask
unconditionally* — which is what its two call sites (lines 736, 755) actually
want.

### What must remain, and why it is not an exception

`--ask` must still reach the host when the list did **not** arrive. Absent is
not false: a scan whose `pr-list` failed must not report every branch as `NONE`,
which would render an entire fleet as *no PR* during an outage. `.list-arrived`
already draws that line and the line does not move.

**The failure direction is unchanged.** This removes calls on the SUCCESS path
only; every degradation path behaves exactly as it does today.

### Why this is safe for the case `--ask` was added for

PR #216 added the `--ask` arm for branches with no ref, whose state the join
could not supply. That gap is closed: the join keys by name and serves them
(279 of 300 here). What is left in `--ask` is the population the join answers
with silence — and after a successful list, silence IS the answer.

### Not chosen: raise `PR_REFRESH_MS` or throttle the scan

Rejected, and #228 drew the distinction this plan keeps:

> This is a different defect from #226: that one is about the board's *cadence*,
> this one about the scan's *shape*. Fixing the cadence alone still leaves a
> scan that cannot finish.

Throttling also makes the board staler, paying in freshness for a problem that
has a free fix. And the arithmetic says it would not even work: the two
correctly-throttled timers are 2.4% of the budget.

### Not chosen: cache `NONE` across pulses

Rejected — a branch acquires a PR without anything local moving, so a remembered
`NONE` would show merged work as unstarted. That is the staleness the board
exists to eliminate, and `terminal_learn`'s refusal is a correctness property
rather than a missed optimisation.

The fix above needs no memory: it derives the answer inside the pulse that
fetched the list.

### Open Questions

- [ ] Does `pr-list` report the head-branch name for a PR whose head **ref has
      been deleted**? The fix rests on this. Verify against a squash-merged,
      ref-deleted PR on GitHub **and** Bitbucket before implementing — if GitHub
      answers and Bitbucket does not, the two backends need different treatment
      and that must be stated, not averaged.
- [ ] Interaction with #333 (Bitbucket's join is silently partial past 50 PRs
      per state). Keying by name does not fix a truncated list, and a branch
      missing from a truncated list would now be reported `NONE` rather than
      asked — turning a *slow* answer into a *wrong* one. **This is the one way
      this plan could make things worse and it must be settled before
      implementation**, not discovered after.
- [ ] Should the scan report its own host-call count on the pulse line? The
      defect survived #232 for months because nothing made the cost visible. A
      counter would make a regression assertable rather than measurable only by
      stubbing `PATH`.

## Done when

- An **idle** board makes **no per-branch host call** on a pulse whose `pr-list`
  succeeded. Asserted by counting invocations with a PATH-stubbed host CLI — the
  technique #228 and #232 both used — not by reading the code. Today that number
  is 28 per scan on this repo.
- A branch **absent from a successfully-fetched list** resolves to `NONE` with no
  host call, on the `--ask` path as well as the plain one. This is the defect;
  assert it directly.
- A branch **in** the list still resolves to its real state from the join,
  including one whose head ref is deleted. A fix that broke this would trade one
  N+1 for another.
- When `pr-list` **fails**, `--ask` still reaches the host and no branch is
  reported `NONE`. Asserted with a stubbed failing host — this is the
  absent-is-not-false invariant and the one an optimisation is most likely to
  break. **A test suite that only covers the success path passes an
  implementation that reports an entire fleet as having no PRs during an
  outage.**
- The terminal cache still serves and still validates against plan and main
  OIDs; this plan does not weaken it and adds nothing to what it remembers.
- `pnpm test`, `pnpm run test:reconcile` and `pnpm run test:board` green.

## Branches

### Derived

- `bug/an-arrived-list-answers-for-the-branches-it-omits` — test `.list-arrived` before the `--ask` host call, so a branch the list omits resolves to `NONE` without a round trip; keep the host call for the case where the list never arrived

## Notes

Found 2026-08-23 by measuring, after the operator challenged an unmeasured
claim — twice, and was right both times.

**The first claim was that the operator's own merging drained GraphQL.** The
measurement refuted it: merges go through `gh api` (REST), which sat at
4995/5000 untouched while GraphQL emptied. The asymmetry is what identifies the
scan as the source.

**The second claim was that the join needed re-keying from ref to name.** This
plan said so in its first draft. Reading `prefill_pr_states` properly showed it
already keys by name and already serves all 279 ref-deleted PRs; a stubbed scan
then showed that every branch still being asked appears **nowhere** in the list,
because it has no PR at all. The fix is one order-of-tests change, not a re-key.

The operator's third question — *are we sure this is the only cause?* — produced
the ruled-out table above. The answer is that the per-branch call is 96.5% of
one board's traffic and the two timers are 2.4%, but that a board's cost
multiplies per process and four were running.

**Why this survived #232.** That change's docstring reasons correctly from its
own measurement — *"the ONLY per-branch host cost left is the no-ref `--ask`
arm"* — and a cross-pulse cache was then built for exactly that population. Both
steps were right when taken. What changed is the estate: the repo grew a
population of *claimed but never opened* branches, which is neither ref-deleted
nor PR-bearing, and which no part of the design anticipated.

That a confident comment recorded the measurement behind it is what made this
diagnosable at all — the same shape as
`the-blocking-wave-is-found-wherever-it-is`, where a careful docstring reasoned
from a premise the layout no longer held.
