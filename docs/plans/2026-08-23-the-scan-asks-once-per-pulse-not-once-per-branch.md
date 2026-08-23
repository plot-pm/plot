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

Every branch that costs a round trip has **no ref and no pull request** —
`bug/loose-checks-the-rollup`, `bug/the-blocking-wave-is-found-wherever-it-is`,
and 26 more. Measured: 28 of the 29 have no `refs/remotes/origin/` entry at all.

**They are branches an approved plan NAMES and nobody has started.** Not claimed
branches — a claim pushes a ref, and these have none. `plot-host.sh pr-state`
answers `{"state":"NONE"}` for each, which is the one state `terminal_learn`
refuses to cache, so they are re-asked on every scan for the life of the plan.

That population only grows: every approved plan adds its unstarted branches to
it, and they stay until somebody dispatches them.

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

**This row is a claim, not yet a measurement, and the plan says so.** A 4-minute
window recorded ~30 `pr-list` + `issue-list` calls inside 10 seconds — roughly
27x the timer rate. That was attributed to four board processes running
concurrently, each with its own timer, staggered: an inference from `ps`, not a
controlled measurement. The `Done when` list therefore carries an assertion that
one isolated board fires each timer at its stated rate. **If it does not, this
table is wrong and the plan has missed a second defect** — which is the outcome
this assertion exists to catch rather than to confirm.

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
unconditionally* — which is what its ONE call site, `merged_by_host`, actually
wants.

### The docstring this contradicts, and why the list wins

`merged_by_host` argues the opposite, and the argument has to be met rather than
ignored:

> THE ONE CALLER THAT MAY ASK PER BRANCH (PR #216). It is reached only from the
> no-ref arm of `branch_state`, for a branch the repo-wide list **may
> legitimately not contain**.

That was right when the join keyed differently. It is no longer: `pr-list`
returns every PR in the repo, so **after a successful list, a branch missing
from it has no PR** — absence is the answer, not the absence of one. Verified
against this repo: 300 PRs returned, 279 with deleted refs, all present in the
list and all answered by the join.

**The bound that makes this true, and it must be asserted.** The list is
authoritative only while it is COMPLETE. `PR_LIST_LIMIT` defaults to 1000 and
this repo has 359 PRs, so there is headroom today — but a truncated list would
make a real PR read `NONE`, which is worse than the cost being fixed. Issue #333
records exactly that failure on Bitbucket, where the join is silently partial
past 50 PRs per state.

So the derivation is licensed by completeness, and completeness is a property
the code must check rather than assume: **if the list came back at the limit, it
may be truncated, and `--ask` must stay live for that scan.** A count equal to
the limit is not evidence of exactly-the-limit PRs; it is evidence of *at least*
the limit, which is not a complete list.

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

### The cadence coupling this leaves behind, stated rather than fixed

The board's timer is 5 s and one scan takes **28 s**, so scans run
back-to-back: the cadence is set by the scan's own duration, not by the timer.

**That inverts the usual relationship between speed and cost.** Every second cut
from the scan buys another scan per hour, and each scan carries the per-branch
calls with it — so optimising the scan for latency, which this repo has done
repeatedly and deliberately (#262, the `rev-list` batching noted in `fleet.ts`),
makes the host traffic strictly worse while every measurement of the change
looks like an improvement.

This plan does not add a floor between scans. It does not need one: once the
per-branch calls are gone, a scan costs ONE `pr-list` however often it runs, and
the coupling becomes harmless rather than merely smaller. **Recorded because the
next person to speed the scan up should know that doing so multiplies whatever
per-branch cost remains** — and because if this fix is ever partially reverted,
the cadence is what turns a small regression into an exhausted budget.

### The second call site: `pr_ready` on the `--loose` path

`merged_by_host` is not the only per-branch caller. **`pr_ready` (line 1540)
calls `plot-host.sh pr-state` directly**, bypassing both the join and the cache:

```sh
pr_ready() {
  local br="$1" js
  js=$("$script_dir/plot-host.sh" pr-state "$br" </dev/null 2>/dev/null) || return 1
  ...
```

It runs only under `--loose`, which is opt-in, off by default, and unused by the
board — so it contributes **nothing** to the measured drain, and every number in
this plan was taken without it. It is in scope anyway, because the Done-when
this plan wants to assert is *zero per-branch host calls*, and an assertion
qualified by a flag is one a later change can slip past.

**Both call sites, one fix, one absolute assertion.**

#### The collision with `loose-checks-what-it-promises`, and how it resolves

That plan (Draft) owns `bug/loose-checks-the-rollup`, whose one-line summary is:

> `pr_ready` reads the check rollup from the scan's existing `pr-list` call and
> accepts only `green`

**That is the same edit to the same function**, reached from a different
motive: it needs the check rollup, which `pr-state` structurally cannot return,
and getting it from the batched `pr-list` removes the per-branch call as a side
effect. Two branches rewriting `pr_ready` would collide at merge.

The resolution is ordering, not duplication:

- **This plan changes `pr_ready`'s SOURCE** — read the state from the same
  cache `prefill_pr_states` fills, no host call.
- **`loose-checks-the-rollup` changes `pr_ready`'s PREDICATE** — accept only a
  green rollup, which requires `pr-list --rich`.

Whichever lands first, the other rebases onto it: the source change does not
decide what counts as ready, and the predicate change does not decide where the
data comes from. **If `loose-checks-the-rollup` lands first, this plan's
`pr_ready` work is already done** and this section becomes a verification rather
than an edit — check the call is gone, keep the assertion, change nothing.

Recorded here so the collision is a known fact at dispatch time rather than a
surprise at merge time, which is what the scope-guard section of a brief exists
for.

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

- **THE STATE MAP IS UNCHANGED.** Run the scan on this repo before and after the
  change and diff the branch→state map: **no branch may change state in either
  direction.** This is a COST change, not a state change, so any difference at
  all is a bug — including the one that looks like an improvement. This is the
  assertion that catches a fix which quietly stops calling the host for a branch
  the host would have answered `MERGED` about.
- An **idle** board makes **no per-branch host call** on a pulse whose `pr-list`
  succeeded — **on the default path and under `--loose` alike**, since both call
  sites are in scope. Asserted by counting invocations with a PATH-stubbed host
  CLI — the technique #228 and #232 both used — not by reading the code. Today
  that number is 28 per scan on this repo (29 calls, of which 1 is the
  `pr-list`). The target is exactly: `pr view` 0, `pr list` 1.
- **The proof is a stubbed single scan, not a timed window.** A test that runs a
  board for N seconds and extrapolates an hourly rate depends on machine speed,
  scan duration and runner load — it would flake in CI and its failures would
  teach nobody anything. One scan under a stubbed `PATH` is deterministic, and
  the per-hour figure follows arithmetically from it.
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
- A **truncated** list does not answer for anybody. With `PR_LIST_LIMIT` forced
  low enough that the list comes back full, `--ask` stays live and a branch whose
  PR exists still resolves to its real state. **This is the assertion that keeps
  the derivation honest**: a list that may be incomplete is not evidence of
  absence, and #333 records this exact failure on Bitbucket.
- **One isolated board fires each 60 s timer at its stated rate.** Measured over
  a 300 s window with no other board process running: at most 6 `pr-list` and 6
  `issue-list` calls. This is not a regression guard on this plan's change — it
  is the check on the *ruled-out* table above, whose burst was explained by
  inference rather than by measurement. A failure here means the timers are
  triggered by something besides their timer, and this plan named the wrong
  scope.
- The terminal cache still serves and still validates against plan and main
  OIDs; this plan does not weaken it and adds nothing to what it remembers.
- `pnpm test`, `pnpm run test:reconcile` and `pnpm run test:board` green.

## Branches

### Derived

<!-- ONE branch for two call sites, deliberately. `merged_by_host` and
     `pr_ready` are the same defect in the same file, and the assertion that
     licenses the change — ZERO per-branch calls — cannot be written for one of
     them alone: a Done-when qualified by a flag is one a later change slips
     past. Splitting them would also put two agents in `plot-fleet-scan.sh`'s
     host path at once, and the second would rebase onto a moved call.
     See the collision note in Design for the ordering against
     `loose-checks-the-rollup`, which edits `pr_ready`'s predicate. -->

- `bug/an-arrived-list-answers-for-the-branches-it-omits` — test `.list-arrived` before the `--ask` host call in `merged_by_host`, and read `pr_ready` from the same cache, so a branch the list omits resolves without a round trip on either path; keep the host call for the case where the list never arrived or came back at the limit

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

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Whose reasoning wins: derive-NONE, or merged_by_host's docstring defending --ask?", "a": "List is authoritative after a successful pr-list; truncation is the bound and must be asserted", "category": "technical"},
    {"q": "Is the 2.4% timer claim proven, or inferred from four concurrent boards?", "a": "Inferred - added a Done-when measuring one isolated board over 300s", "category": "nonFunctional"},
    {"q": "Should the plan address the 5s timer over a 28s scan?", "a": "Stay scoped; record the hazard so a future speed-up does not multiply per-branch cost", "category": "tradeOffs"},
    {"q": "Failure direction: a squash-merged branch outside the list would read open forever", "a": "Safe by construction (NONE cannot claim merged); assert the state map is byte-identical before and after", "category": "technical"},
    {"q": "pr_ready is a second unbatched per-branch call on the --loose path - include it?", "a": "Fix both here, so the zero-calls assertion is absolute; recorded the collision with loose-checks-the-rollup and the rebase ordering", "category": "technical"},
    {"q": "Prove the fix with a stubbed single scan or a timed live window?", "a": "Stubbed single scan - deterministic, CI-safe; per-hour cost follows arithmetically", "category": "nonFunctional"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": false,
    "ux": false,
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
