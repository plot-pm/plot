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

### What #232 actually fixed, and what it left

`plot-fleet-scan.sh` resolves state through `host_pr_state` (line 567), which
reads a per-invocation cache, and falls through to a live
`plot-host.sh pr-state` **only on the `--ask` arm** (line 578). The join added
by #232 pre-fills that cache from one `pr-list`, so a branch **with a ref** is
answered locally and costs nothing.

The surviving cost is the population the join cannot serve: a branch whose
**ref is gone** — squash-merged, or never pushed — has nothing to join against
and reaches `--ask`. The scan's own docstring names this precisely:

> After #232 the ONLY per-branch host cost left is the no-ref `--ask` arm that
> PR #216 put there — and that arm IS the terminal population.

That reasoning was correct when it was written. It no longer holds, and the
plan must be honest about which half broke.

### The two reasons the terminal cache does not cover it

A cross-pulse cache (`PLOT_TERMINAL_CACHE`) exists for exactly this arm: the
board holds the map in memory and hands it to the next scan. It is well built
and it is not the defect. It simply cannot cover the measured traffic, for two
independent reasons.

**1. It caches only settled answers, by design.** `terminal_learn` refuses
anything but `MERGED|CLOSED`:

> `MERGED` and `CLOSED` are settled; `OPEN` and `NONE` are not, because both can
> change without anything local moving.

That is right, and it means a repo whose no-ref branches are mostly *absent*
(`NONE`) or *open* pays full price on every pulse forever. **`NONE` is the
common case here**: a branch line in a plan that nobody has pushed yet has no
ref and no PR, and there are many.

**2. Any merge to the default branch discards the whole map.**
`terminal_cached` validates each entry against `TERMINAL_MAIN_OID`, and a moved
tip invalidates every entry at once. So during active merging — the period when
call volume is highest — the hit rate approaches zero. That is also correct as a
derivation rule; it is simply not a rate-limit defence.

**Neither behaviour is wrong.** The cache is doing what it says. The gap is that
nothing else covers the `NONE` and `OPEN` no-ref branches, and they are the
majority of the population by the measurement above.

### What is NOT claimed

- **Not the board's cadence.** `PR_REFRESH_MS` (60 s) correctly throttles
  `fleet.ts`'s own `refreshPrs`. The traffic measured here is the scan's, spawned
  on the 5 s pulse, and is not governed by that timer. This is #228's *shape*
  defect, not #226's *cadence* defect — the same split those two issues drew.
- **Not caused by merge activity.** Measured against an idle board. (An earlier
  reading in session blamed the operator's own merging; that was wrong — merges
  go through `gh api` (REST), which sat at 4995/5000 untouched while GraphQL
  drained. Recorded because the wrong cause was stated to the operator before it
  was measured.)
- **Not a Bitbucket regression.** #333 tracks the separate Bitbucket
  partial-join defect past 50 PRs per state. This plan must not silently fix or
  break that; see Open Questions.

## Design

### The fix: the join must answer for branches with no ref

The scan already fetches every PR for the repo in `prefill_pr_states`
(line 467). The join it builds is keyed by branch **ref**, so a PR whose head
ref is deleted contributes nothing. But the `pr-list` response still *names* the
head branch of every PR it returns, including merged ones whose ref is gone.

**So the answer for the no-ref population is already in the response the scan
already pays for.** It is being discarded rather than being unavailable.

The change is to key the pre-fill by the PR's head-branch **name** as reported by
the host, independent of whether a local or remote ref exists for it. A branch
that appears in the list is then answered locally whatever its ref state; only a
branch appearing **nowhere in the list** remains unanswered.

### `NONE` becomes derivable, and that is the larger half

Once the list is known to have arrived, a branch absent from it has **no PR at
all** — which is `NONE`, derived, with no host call. The scan already has the
machinery to state this: `.list-arrived` exists precisely to distinguish *the
answer is no* from *the question was never asked*, and `host_pr_state`'s
non-`--ask` arm already returns `NONE` on that basis.

The `--ask` arm should therefore become **unreachable in the ordinary case**:
after a successful `pr-list`, every branch is either in the list (answered) or
absent from it (`NONE`). That is the property to assert.

### What must remain, and why it is not an exception

`--ask` must stay for the case where the list **did not arrive** — a host error,
a timeout, a backend that cannot answer. Absent is not false: a scan that could
not fetch the list must not report every branch as `NONE`, because that would
render a whole fleet as *no PR* during an outage. `.list-arrived` already gates
this correctly and the gate does not move.

**The failure direction is unchanged:** where the list is unavailable, the scan
degrades to asking, exactly as today. This plan removes calls on the *success*
path only.

### Not chosen: raise `PR_REFRESH_MS` or throttle the scan

Rejected. Both reduce the *frequency* of a wasteful shape without removing it,
which is the fix #228 explicitly separated from its own:

> This is a different defect from #226: that one is about the board's *cadence*,
> this one about the scan's *shape*. Fixing the cadence alone still leaves a
> scan that cannot finish.

A slower wrong loop also makes the board staler, paying in freshness for a
problem that has a free fix.

### Not chosen: persist the cache to disk across pulses

Rejected — it contradicts Manifesto Principle 1, and the scan's own docstring
already refuses it:

> A file would be a second source of truth about a repo whose only source of
> truth is git, and a restart must re-derive everything.

The fix above needs no persistence: it derives more from a response already
being fetched within a single pulse.

### Not chosen: widen the terminal cache to `OPEN`/`NONE`

Tempting, and wrong. Those states genuinely change without anything local
moving, so caching them across pulses would make the board report merged work as
open — the class of staleness the board exists to eliminate. The cache's
refusal is a correctness property, not a missed optimisation.

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

- An **idle** board makes **no per-branch host call** on a pulse where
  `pr-list` succeeded. Asserted by counting invocations with a PATH-stubbed host
  CLI — the technique #228 and #232 both used — not by reading the code.
- A branch whose **ref is deleted** but whose PR is in the list resolves to its
  real state (`MERGED`/`CLOSED`) from the join, with no `pr view`. This is the
  population the current join misses; a fix that only speeds up ref-having
  branches passes every other assertion here.
- A branch **absent from a successfully-fetched list** resolves to `NONE`
  without a host call.
- When `pr-list` **fails**, behaviour is unchanged: the scan falls back to
  asking, and no branch is reported `NONE` on the strength of a list that never
  arrived. Asserted directly with a stubbed failing host — this is the
  absent-is-not-false invariant and the one an optimisation is most likely to
  break.
- The terminal cache still serves and still validates against plan and main
  OIDs; this plan does not weaken it.
- `pnpm test`, `pnpm run test:reconcile` and `pnpm run test:board` green.

## Branches

### Joined

- `bug/the-scan-joins-by-name-not-by-ref` — key the pre-fill by the head-branch name the host reports, derive `NONE` for branches absent from an arrived list, and assert zero per-branch calls on the success path with a stubbed CLI

## Notes

Found 2026-08-23 by measuring, after the operator challenged an unmeasured
claim. The session had told them the GraphQL exhaustion came from its own merge
activity; the operator asked why the limit was hit again *"if it were already in
place"* — meaning #232's join — and asked for a measurement. The measurement
refuted the session's explanation and confirmed the operator's instinct that the
board was over-fetching.

The reason this survived is worth keeping. #232's docstring reasons correctly
from a measurement — *"the ONLY per-branch host cost left is the no-ref `--ask`
arm … and that arm IS the terminal population"* — and then a cache was built for
exactly that population. Both steps were right when taken. What changed is the
repo: 14 branches became 99, and the no-ref population stopped being mostly
terminal. **A confident comment that records the measurement behind it is what
made this diagnosable at all** — the same shape as
`the-blocking-wave-is-found-wherever-it-is`, where a careful docstring reasoned
from a premise the layout no longer held.
