# The no-ref arm asks once too

> Four optimisations landed and the scan still overruns its budget: 49.6 s
> against 30 s. Fifteen host calls remain, and this plan asserted they were
> merged-and-deleted branches whose cost grew with every merge. Measured
> 2026-08-20, they are not: they are branches a plan names and nobody has
> pushed. Merged branches already cost nothing. The diagnosis is inverted and
> recorded here as such, because the shape of the growth was the whole argument.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Delivered:** 2026-08-20 by jwloka — PR #255; the only branch this plan had
- **Released:** 2026-08-22, v2.7.0

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

Measured 2026-08-20 with a `gh` stub counting invocations: **16 host calls — 15
`pr view` and one `pr list`.** Total scan time 34.7 s against a 30 s budget.

### What the fifteen calls actually are

This plan's first draft said the fifteen were branches merged with
`--delete-branch`, and therefore that **the scan gets slower the more the team
ships.** That was wrong in both halves, and the correction is the finding:

| Branch class | refs | in `pr list --state all` | host calls today |
|---|---|---|---|
| merged, ref deleted | 0 | **yes, `MERGED`** | **zero** |
| planned, never pushed | 0 | **no PR exists** | **one each** |

Verified two ways on this repo, 2026-08-20:

- `feature/the-plan-meta-reports-a-changelog`, `feature/a-sprint-proposes-its-work`
  and `feature/the-scan-derives-its-plan-list` — the exact case the draft called
  broken — each have 0 refs, appear in the list as `#252`/`#253`/`#254` `MERGED`,
  and are asked about **zero** times.
- Every one of the fifteen branches that *is* asked about has 0 refs **and no PR
  at all.** The intersection of {asked} and {named by the arrived list} is empty.

So the cost scales with **planned-not-started** work, not with completed work.
Shipping a branch makes it free; planning one costs a call until someone pushes
it. Fifteen is high today because this plan estate has fifteen branches sitting
in approved plans, unstarted.

### Why the draft's fix was already implemented

The draft blamed `merged_by_host` for passing `--ask` unconditionally. It does —
and it does not matter: `host_pr_state` reads the per-branch cache at
`plot-fleet-scan.sh:571-574`, **before** it ever looks at `$ask`. A branch the
join answered returns from cache and costs nothing either way. Row 1 of the
draft's own table is main's current behaviour.

That ordering is load-bearing and was undocumented. A refactor moving the `--ask`
test above the cache read would silently restore one call per terminal branch per
pulse, with no test to catch it.

### Bitbucket, which is where the residue still hurts

One `bb` call was measured at **~10 s** on 2026-08-18 and the figure is recorded
in `plot-host.sh:271`. Against GitHub's 461 ms per `gh pr view`:

| | per call | 15 calls |
|---|---|---|
| GitHub | 461 ms | 6.9 s |
| Bitbucket | ~10 000 ms | **150 s** |

A 22× multiplier, and 150 s is five times the whole budget. The residue is real
even though its cause is not the one this plan named — but it shrinks as the
fleet works, rather than growing forever, and that changes what is worth doing
about it.

## Design

### What this plan can honestly land

Nothing behavioural. The property it wanted is already true, so the deliverable
is the test that pins it — and the reason, written down where the ordering lives.

### What would remove the fifteen, and why it is not done here

Only one thing: treating an arrived list's silence about a branch as evidence
that no PR exists. That is `an-outage-is-not-an-answer` inverted. It may be
defensible — the `.list-arrived` marker already separates *the list arrived and
did not name it* from *the list never arrived*, which is exactly the distinction
such a change would rest on. But it is a decision about what counts as evidence,
and it belongs to an interrogated plan rather than to a brief that forbade it in
three places.

### Why not simply raise the timeout

Considered and rejected, and the correction does not revive it. A budget fitted
to a cost that moves with the plan estate is a budget that fails whenever
planning runs ahead of implementation — which is the normal state of a fleet.

### Open Points

- [ ] Should the list's silence about an unjoined branch, on a list that
      demonstrably arrived, count as evidence of no PR? This is the real
      question behind the residue and needs its own plan.
- [ ] Should the terminal cache move into the script, so a board restart stops
      paying the full round? It would need a file, and a cache on disk is a
      record rather than a derivation — the reason `c363f3ef` kept it in memory.
- [ ] Does `plot-host.sh` want a `pr-list --state all` fast path for Bitbucket,
      where `all` fans out to three calls?

## Why the branch shipped a test and no fix

The measurement that dissolved this plan's premise, recorded here rather than in
an HTML comment on a branch line, because it is the finding:

**The cache read at `plot-fleet-scan.sh:571-574` precedes the `--ask` arm.** So a
merged-and-deleted branch that the joined list already names costs **zero** host
calls — the defect this plan set out to fix did not exist. What shipped as #255
is the regression test that pins the ordering, and nothing else.

The inverted diagnosis is the reason the plan is kept rather than deleted: the
*shape of the growth* — cost rising with every merge — was the whole argument for
the fix, and it was the wrong shape. The fifteen remaining calls are branches a
plan names and nobody has pushed, which grows with **planning**, not with
merging, and needs a different fix.

## Waves

### Implementation (Branch: bug/the-no-ref-arm-reads-the-join, PR: #255)
- → #255 — the regression test only: a merged-and-deleted branch that the arrived list names costs zero `pr-state` calls, asserted by counting invocations of a stubbed host. No behaviour change.

## Notes

Prompted by an operator asking whether the optimisations were already in — they
were — and then whether Bitbucket would be worse. It is, by 22×.

The draft's headline was *"the scan gets slower as the team ships more."* It is
the opposite: shipping is what makes a branch free. The mistake was assuming
`refs=0` implied *was merged*, because that is how this repo retires branches —
but `refs=0` has a second and here larger cause, *never pushed*. Both classes
are the same git shape and only the list tells them apart.

Caught by the implementing agent, which measured the branch set before editing
and refused a brief it had disproved. That refusal is the reason this file says
something true.
