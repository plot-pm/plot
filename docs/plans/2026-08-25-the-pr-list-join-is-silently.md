# Bitbucket: the PR-list join is silently partial past 50 PRs per state

> Detect when Bitbucket's fixed page cap truncates the PR list and fall back to per-branch lookups for branches the join cannot answer.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** #333
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Rounds:** 2

## Changelog

- `plot-fleet-scan.sh` detects a truncated Bitbucket PR list and falls back to per-branch lookups for unresolved branches, so a branch whose PR is beyond page 50 no longer reads as "no PR"

## Motivation

`plot-fleet-scan.sh`'s `prefill_pr_states` asks `plot-host.sh pr-list --state all --limit 1000` once and joins locally. On GitHub the limit is honoured. On Bitbucket the limit is **dropped**: `bb pr list` has no `--limit` flag, so the adapter drops it (with a stderr warning) and returns the fixed page size of 50 PRs per state.

Past 50 PRs in any state, the join sees a partial set. A branch whose PR is not on the page joins to nothing and reads as **no PR** — the same fabricated verdict the scan refuses everywhere else:

> Joining against the newest 30 would silently lose 191 PRs — every older merged branch reading as "no PR", which is the fabricated verdict this scan refuses everywhere else.

The failure is quiet: a stderr line the board never surfaces, then wrong rows.

This is **not** the N+1 issue fixed in #228 (v2.7.0). That was the **shape** — N branches × 3 states. This is the **completeness** of the one list the fix now depends on. The join made the scan correct-and-fast on Bitbucket while making it newly sensitive to a page cap that did not matter when every branch was asked about individually.

Severity is low today (this repo is GitHub; the measured Bitbucket repo had 9 branches) and rises with PR count.

## Design

### Approach

Detect that the host's answer is **possibly truncated**, and repair it where the
truncation happens — inside `plot-host.sh pr-list` — so that `pr-list` either
returns a complete set or says it could not.

**Option A — Page until exhausted:** `bb pr list` exposes no cursor; paging would
require guessing at offsets or reverse-engineering undocumented behaviour.
Measured against `bb` 1.0.0: the only flags are `--state`, `--json`,
`--repository`, `--web`. Rejected on a measurement, not a guess.

**Option B — Signal truncation, each caller falls back:** `pr-list` reports a
`truncated` flag and every consumer implements its own repair. Rejected once the
second consumer was found (below): the same fallback would exist twice, in bash
and in TypeScript, free to drift. A rule enforced in two languages is a rule that
will disagree with itself.

**Option C — Surface truncation only:** make the stderr warning visible on the
board. Does not fix the wrong rows. Rejected as a solution; kept as a supplement,
because a fallback that ran should be visible.

**Option D — Repair inside the adapter.** Chosen. `pr-list` detects a possibly
truncated page and resolves the gap itself, so no caller needs to know that
Bitbucket has pages.

### There are two consumers, not one

The original design split the invariant across two files: `plot-host.sh` would
report `truncated`, and `plot-fleet-scan.sh` would act on it. That was written
when the scan looked like the only consumer.

It is not. `packages/board/src/server/fleet.ts:1552` calls
`plot-host.sh pr-list --rich` on its own PR timer, independently of the scan's
`prefill_pr_states` (`plot-fleet-scan.sh:474`). Both join a bulk list locally;
both are exposed to the same page cap.

`plot-host.sh` is documented as **the ONE place that talks to the host CLI**, and
truncation is a property of *how the host answered*, not of what a caller asked
for. So the repair belongs there — the same argument that put the CLI capability
check there in `the-adapter-checks-the-cli-it-got` (#460).

**The cost, stated plainly:** the adapter starts issuing N+1 calls on its own
initiative, which is a real change to what "adapter" means in this codebase.
That is accepted because the alternative is the same fallback implemented twice
in two languages. It is bounded (below), and it fires only on a host that
truncates — never on GitHub.

**Implementation:**

1. **`plot-host.sh pr-list`** compares each state's result count against the
   **requested limit**; a page as full as it could be is possibly truncated.
2. On a possibly-truncated state it resolves the gap itself, then emits the
   completed set. Where it cannot, it emits what it has **plus** a
   `truncated` marker — absent is not false, and a partial answer must never
   be served as a whole one.
3. Callers are unchanged. `plot-fleet-scan.sh` and `fleet.ts` keep joining a
   bulk list; neither learns that Bitbucket has pages.
4. The fallback is reported (stderr, and the pulse) so an operator can see that
   it ran and why.

### Open Questions

- [x] Does `bb pr list` have any pagination mechanism we could use instead of falling back to per-branch? **No.** Measured 2026-08-26 against `bb` 1.0.0: `bb pr list` exposes only `--state`, `--json`, `--repository` and `--web`. No cursor, no offset, no limit. Option A is closed.
- [x] Should the fallback apply to all unresolved branches or only plausible ones?
      **Only branches with commits.** Answered 2026-08-26 from the code rather
      than by preference: `plot-fleet-scan.sh` already separates `wip` (real
      unlanded commits) from `claimed` (an empty claim marker beyond main), and
      that derivation is free — no host call. A `claimed` branch that joined to
      nothing almost certainly has no PR, so asking about it spends a round trip
      to learn nothing. See *Bounding the fallback* below.

### Bounding the fallback, now that the adapter cannot see `wip`

The fallback asks the host per branch, which is the N+1 the join was built to
remove — so it must be bounded.

Round two bounded it with a fact the SCAN has: only a `wip` branch (real
unlanded commits) gets a per-branch lookup, never a `claimed` one (an empty
marker), because a branch with no commits has no PR to find. That derivation is
free and needs no host call.

**Moving the repair into the adapter takes that fact away.** `plot-host.sh` is
handed no branch list and holds no notion of `wip` — it answers questions about
the host, not about this repo's refs. The bound has to come from something the
adapter can see.

What it can see is **the gap itself**: the PR numbers missing from a truncated
page. `bb` numbers PRs monotonically, so a page returning ids 836 → 787 against
a repo whose newest PR is 836 states exactly which range it did not answer for.
The adapter resolves that range, not a branch list.

**This bounds the cost by what was actually lost**, which is the same principle
as before from the other side: round two bounded by the work, this bounds by the
gap. A cap of *N lookups* would still be arbitrary and would still drop the
N+1st silently — the quiet incompleteness this plan exists to remove.

**Open, and it is the real question of this round:** whether resolving that
range is affordable. At ~780 missing PRs on the measured repo it is plainly not,
one call at a time. See *Done when* item 3 — a repair that costs 780 round trips
has not fixed the failure, it has moved it into latency.

### Truncation is detected, not hardcoded

The obvious detector is `count == 50`, `bb` 1.0.0's page size. It fails in the
direction that matters: if a future `bb` returns 100, a 100-PR state reports
complete when it is truncated — **the original bug, restored silently**.

So the comparison is against the **requested limit**, not a constant: a page that
comes back as full as it could be is possibly truncated, whatever the number. It
misfires benignly when a state holds exactly the limit (says truncated when
complete, costing a few lookups) and cannot misfire in the dangerous direction.

## Waves

### Complete (Branch: feature/the-pr-list-join-is-silently)

`plot-host.sh pr-list` detects a possibly-truncated page by comparing each
state's count against the requested limit, resolves the gap itself, and marks
the result `truncated` where it cannot — so both consumers keep joining a bulk
list without knowing the host paginates.

## Done when

1. **A state returning exactly the requested limit is treated as possibly
   truncated.** Asserted against the *requested limit*, never the constant 50:
   a future `bb` page size must not make a truncated list report complete, which
   is this plan's own defect restored.
2. **A branch whose PR is beyond the first page resolves to that PR, not to
   "no PR".** The measured failure, and the one assertion that fails on every
   fix that only reports the problem.
3. **The repair is bounded, and the bound is stated in the plan before it is
   built.** ~780 missing PRs on the measured repo cannot be resolved one call at
   a time; a fix whose cost scales with the gap has moved the failure into
   latency rather than removing it.
4. **Where the gap cannot be closed, the result is marked `truncated` and the
   caller can tell.** Absent is not false: a partial list must never be served
   as a whole one, which is the failure mode this plan is named for.
5. **Neither consumer changes.** `plot-fleet-scan.sh:474` and `fleet.ts:1552`
   keep their current calls; asserted by both being untouched in the diff.
6. **GitHub is unaffected — no extra host call on a host that honours
   `--limit`.** Asserted by call count, because a fallback that fires on the
   common path is a regression for every GitHub user.
7. **The fallback says it ran.** An operator seeing slow pulses must be able to
   find out why without reading the source.
8. `pnpm run validate` and `pnpm run test:reconcile` green.

## Notes

- Found 2026-08-23 while confirming #228 on plot 2.7.0
- Related: #228 (the N+1 fix this depends on)

### Brought onto main 2026-08-26

Written 2026-08-25 on `idea/the-pr-list-join-is-silently` and left as **PR #408**,
never approved. The sprint `the-board-serves-an-enterprise-stack` names it a
Should Have, and a sprint cannot name a plan its own repo cannot resolve — the
reconcile scan reports that as drift, correctly.

So the file is brought over unchanged in substance, with `Sprint:` and `Story:`
filled and `Review:` moved from `pr` to `in-session`: the PR route was the
original intent, but the content is now reviewed in the sprint rather than in a
PR that has sat unmerged for a day. **#408 should be closed as superseded** once
this lands, not merged — merging it would add a second copy of this file.

Its two Open Questions are unchanged and still open.

### Interrogated 2026-08-26

One round, and both of the original open questions moved.

The fallback's scope was answered from the code: the scan already computes
`wip` vs `claimed`, so plausibility is free and the fallback is bounded by the
work rather than by an arbitrary cap.

The truncation detector was changed from `count == 50` to a comparison against
the requested limit. The constant fails silently in the dangerous direction — a
future `bb` page size would make a truncated list report complete, which is this
plan's own defect restored.

Pagination stays open, and the design is deliberately correct either way: if
`bb` gains a cursor, the fallback becomes unnecessary rather than wrong.

### Interrogated 2026-08-27 — the repair moves into the adapter

Round three found a **second consumer**, which the first two rounds had no
reason to look for: `packages/board/src/server/fleet.ts:1552` calls
`plot-host.sh pr-list --rich` on the board's own PR timer, independently of
`plot-fleet-scan.sh:474`. Both join a bulk list locally; both are exposed to the
same page cap.

That retires the original two-file design. Reporting `truncated` from the
adapter and repairing in the scan would have left the board joining a partial
list exactly as before — and repairing in both callers would put one fallback in
bash and another in TypeScript, free to drift.

So the repair moves to where the truncation happens. `plot-host.sh` is the ONE
place that talks to the host CLI, and a page cap is a property of how the host
answered, not of what a caller asked for. Same argument that put the CLI
capability check there in `the-adapter-checks-the-cli-it-got` (#460).

**It costs something and the plan now says so:** the adapter begins issuing N+1
calls on its own initiative, which changes what "adapter" means here. Accepted,
because the alternative is the same rule enforced twice in two languages.

**It also took away round two's bound.** That round bounded the fallback to
`wip` branches — real unlanded commits — using a derivation the SCAN has for
free. The adapter has no branch list and no notion of `wip`; it answers questions
about the host, not about this repo's refs. The bound is re-derived from what the
adapter *can* see: the gap itself, the id range a truncated page did not cover.

Whether closing a ~780-PR gap is affordable at all is the open question this
round hands to the next, and `Done when` item 3 states it as a gate rather than
leaving it to implementation.

The plan also gained the two structural pieces it had been missing since it was
brought onto main: a `## Done when` section (there was none — nothing stated what
correct meant) and a named wave in place of a flat `### Implementation`.


<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {
      "q": "Fallback for all unresolved branches or only plausible ones?",
      "a": "Only wip branches \u2014 the scan already distinguishes them from claimed, free",
      "category": "technical"
    },
    {
      "q": "Is count==50 a safe truncation detector?",
      "a": "No \u2014 compare against the requested limit; the constant fails silently in the dangerous direction",
      "category": "technical"
    },
    {
      "q": "Scope: the scan only, or both pr-list consumers?",
      "a": "Fix it in the adapter \u2014 fleet.ts:1552 is a second consumer; one repair, both callers benefit",
      "category": "technical"
    },
    {
      "q": "Structure: no Done when, flat Branches rather than Waves?",
      "a": "Added Done when (8 assertions) and converted to one named wave, Complete",
      "category": "technical"
    },
    {
      "q": "Does the ~94% measured loss change its sprint tier?",
      "a": "Raised to Must Have \u2014 a wrong-answer rate that high on a supported host is correctness, not a stretch goal",
      "category": "tradeOffs"
    }
  ],
  "deferredItems": [
    {
      "q": "Is resolving a ~780-PR gap affordable, or does the repair just move the failure into latency?",
      "category": "nonFunctional",
      "context": "Bounding the fallback / Done when item 3"
    }
  ],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": true
    },
    "domain": false,
    "ux": {
      "happyPath": false,
      "edgeCases": false,
      "errors": false,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": true,
      "scalability": true
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

### Interrogated again 2026-08-26 — the cap is measured now, and it is worse

Round two set out to verify the page cap the whole design keys off, because the
plan and `plot-host.sh:494` both attribute *50* to **bb 1.0.0** while the `bb`
first on this machine's PATH is **0.6.0**.

**The cap is real. Measured against `quatico/quaweb-website` with `bb` 1.0.0:**

```
merged PRs returned : 50          ids 836 → 787
open                : 4
newest PR in repo   : #836
```

Fifty exactly, and the repo's PR numbering reaches 836 — so roughly **780 older
merged PRs are invisible to the join**. Every branch older than #787 joins to
nothing and reads as *no PR*.

**That overturns this plan's own severity estimate.** It said *"Severity is low
today (this repo is GitHub; the measured Bitbucket repo had 9 branches) and
rises with PR count."* On a real client repo the loss is ~94% of merged PRs,
not a tail case. The threshold was crossed long ago and nobody saw it, because
the failure is a quiet empty join.

**Pagination is closed as an option:** `bb pr list` has no cursor, offset or
limit flag in 1.0.0 — only `--state`, `--json`, `--repository`, `--web`. Option
A was rejected on a guess and is now rejected on a measurement.

### It uncovered a separate, larger defect

Measuring required running `bb` by hand, which is how the two-binary shadowing
surfaced: homebrew's **0.6.0 has no `--json` flag at all** and sits ahead of
1.0.0 on PATH, so `plot-host.sh`'s `bb pr list --json` returns *nothing* rather
than a truncated page.

That is written up separately as [[the-adapter-checks-the-cli-it-got]] — it is a
different bug (no answer at all, versus a partial one), and this plan's
truncation detection is meaningless until the adapter is actually reaching a
capable binary. **That plan should land first.**
