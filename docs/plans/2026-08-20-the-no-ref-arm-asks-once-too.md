# The no-ref arm asks once too

> Four optimisations landed and the scan still overruns its budget: 49.6 s
> against 30 s. All fifteen remaining host calls come from one arm that was
> deliberately left alone — the branch with no ref — on the assumption that
> absent branches are few. Every branch merged with `--delete-branch` joins
> them, so the scan's cost now grows with the work completed.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

The board still shows *"Last scan failed: timed out after 30000ms"* after every
optimisation in `the-index-is-derived` and `the-scan-asks-once-not-once-per-branch`
was delivered.

### The four fixes are in, and they are not enough

| Landed | Commit |
|---|---|
| one joined `pr-list` instead of N lookups | `0386bcb` |
| the board renders what has arrived | `5c2cf58f` |
| a terminal branch is asked once | `c363f3ef` |
| the cadence knows what a refresh costs | `8e2b2830` |

Measured 2026-08-20 with a `gh` stub counting invocations: **15 host calls, all
of them `pr view` — one per branch.** Total scan time **49.6 s** against a 30 s
budget.

### The arm that was left alone, and why the reason expired

`#232` replaced the per-branch `host_pr_state()` loop with one repo-wide
`pr-list`, and left exactly one caller able to ask per branch. The script says so
where it happens:

> *"THE ONE CALLER THAT MAY ASK PER BRANCH (PR #216). It is reached only from
> the no-ref arm of `branch_state`, for a branch the repo-wide list may
> legitimately not contain, and its cost is therefore bounded by ABSENT branches
> rather than by all of them."*

The bound is real and the assumption underneath it is not: **absent branches are
not few.** This repo merges with `--delete-branch`, so every finished branch
loses its ref and enters that arm. Fifteen of them today, and the number rises
with each merge.

**The cost now scales with completed work.** A scan gets slower the more the team
ships, which is the opposite of the intended shape.

### Why the terminal cache does not cover it

`c363f3ef` caches terminal answers so a merged branch is asked once. It works —
and it lives in the **board process**, not in the script. Every board restart
pays the full round again, and `pnpm board` runs under `node --watch`, so a
rebuild restarts it. On GitHub that is 6.9 s once per restart. On Bitbucket it is
not.

### Bitbucket, which is where this becomes fatal

One `bb` call was measured at **~10 s** on 2026-08-18 and the figure is recorded
in `plot-host.sh:271`. Against GitHub's 461 ms per `gh pr view`, measured today:

| | per call | 15 calls |
|---|---|---|
| GitHub | 461 ms | **6.9 s** |
| Bitbucket | ~10 000 ms | **150 s** |

A **22× multiplier**, and 150 s is five times the whole budget — before the scan
does anything else. Issue #228 already measured 27 `bb` calls over 9 branches on
a real Bitbucket repo; this arm is the remaining half of that count.

## Design

### The list already answers the question

**Verified 2026-08-20, and this is what makes the fix cheap:** `pr list --state
all` returns PRs for branches whose refs are gone. Measured against this repo —
#252, #253 and #254 all appear in the list with `MERGED`, while
`git ls-remote --heads` returns **0 refs** for each.

So a branch with no ref does not need its own call. It needs the join it was
excluded from.

### Ask only about what the list could not answer

The arm becomes three cases rather than one:

| Branch has no ref, and… | Cost |
|---|---|
| the joined list names it | **zero** — the answer is already in hand |
| the list arrived and does not name it | one call, as today |
| the list never arrived | unchanged — an outage is not an answer |

The third row is load-bearing and is the rule `an-outage-is-not-an-answer`
established: a failed list must not be read as *no PR exists*. `host_pr_state`
already distinguishes *asked and got nothing* from *could not ask*, via the
`.list-arrived` marker — that distinction is what this change builds on rather
than replaces.

**Expected effect:** fifteen calls become zero on this repo, because every one of
the fifteen is a merged branch the list already carries. What remains is the
genuinely unknown branch — a ref deleted for a PR that was never opened — which
is rare and correctly costs one call.

### Why not simply raise the timeout

Considered and rejected. 30 s against a 5 s pulse is already generous, and a
budget raised to fit a cost that grows with every merge buys weeks, not a fix.
The board's own `the-board-renders-what-has-arrived` exists because the wait is
structural; making the wait longer spends that work.

### Open Points

- [ ] Should the terminal cache move into the script, so a board restart stops
      paying the full round? It would need a file, and a cache on disk is a
      record rather than a derivation — the reason `c363f3ef` kept it in memory.
      The right answer may be that a restart should be cheap enough not to care,
      which is what this plan makes true.
- [ ] Does `plot-host.sh` want a `pr-list --state all` fast path for Bitbucket,
      where `all` fans out to three calls? That is `the-cadence-knows-what-a-refresh-costs`'s
      territory and it made the cadence aware of the cost rather than removing
      it. Removing it is a separate question.

## Branches

- `bug/the-no-ref-arm-reads-the-join` — a branch with no ref is answered from the joined `pr-list` where the list names it, and asked individually only where the list arrived and did not. Tests: a merged-and-deleted branch costs zero host calls when the list carries it, asserted by counting invocations of a stubbed host; a branch absent from an arrived list still costs one call and reads correctly; a list that never arrived leaves the branch reading exactly as it does today, never as "no PR"; the three-way state vocabulary is unchanged per branch.

## Notes

Prompted by an operator asking whether the optimisations were already in — they
were — and then whether Bitbucket would be worse. It is, by 22×, and the
arithmetic is above rather than asserted.

The measurement that matters most is not the total but its shape: **the scan
gets slower as the team ships more.** Every other cost in it is bounded by the
repo's size.
