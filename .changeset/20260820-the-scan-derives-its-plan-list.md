---
"plot": minor
---

plot-fleet-scan: the plan list is derived from phase, not from symlinks

The scan globbed `docs/plans/active/` and appended a glob over
`docs/plans/delivered/`, so two hand-maintained facts decided a plan's fate:
whether it appeared at all, and which group it landed in. Both are copies of
something the plan already states in its own `Phase:` field, and a copy
maintained by hand disagrees with its original the moment somebody forgets.

The failure is silent in the direction that matters. Measured 2026-08-18: an
agent wrote a plan file directly rather than through `/plot-idea`. It parsed
`canonical`, carried `Phase: Approved`, named three branches in two waves and
sat on `origin/main` — and every unscoped scan reported 12 plans without it
while two agents were already working its branches. The scan did not say "one
plan is unindexed"; it said nothing at all, and its footer count was simply
lower than reality. Nothing in the output distinguishes *this plan does not
exist* from *this plan is not indexed*, which is why it was misdiagnosed three
times as a board defect before anyone looked at the index.

So `$PLAN_DIR` is enumerated and each file is grouped by the phase it declares.
A stale link is now inert in both directions, and the second is the one people
forget: an unlinked Approved plan appears, and a link pointing at a delivered
plan cannot resurrect it. A test that only proved the first would pass on an
implementation where `active/` still won — the link would merely be additive.

What counts as a plan had to be decided rather than inherited. The old glob
excluded non-plans by *accident* — nobody had linked them — so enumerating the
directory without a rule trades a list that is wrongly short for one that is
wrongly long. The rule is the parser's own answer: a `.md` file directly in
`$PLAN_DIR` whose `phase` is anything other than `NONE`. Measured in this repo:
64 files, 62 plans, and two notes carrying no `Phase:` field at all.
`UNKNOWN` counts as a plan, deliberately — it means the file declared a phase
whose value the parser did not recognise, and hiding a plan for a misspelling
would rebuild this exact invisibility one level down, where it is harder to see
than a missing symlink was.

`rejected` and `superseded` route to the terminal group alongside `delivered`
and `released`, for the same reason `/plot-deliver` files all four under the
delivered index (issue #33): they are outcomes, not work.

The delivered mtime pre-filter goes with the directory it read, and it was
buying less than it appeared to. It keyed off the `$DELIVERED_DIR` symlink's
mtime, and a fresh checkout stamps every symlink at once — 56 of 56 delivered
links admitted here, so the parse it existed to avoid was already being paid in
full. `delivered_in_window` (the `Delivered:` record) was always the filter that
actually decided, and the pre-filter's own documented contract was that it may
only ever OVER-admit. Removing it takes that contract to its limit.

Cost, measured rather than assumed: 64 plans parse in 371 ms, ~5.8 ms each,
against a full scan this file's own comments record at 500–1050 ms — 18.3 s with
the host round trips. The plan's fixture measurement puts the worst realistic
case at ~300 ms extra for 1000 plans, a scale no Plot repo has reached, behind
the board's 5 s cache.

`active/` is untouched: still written, still read for a NAMED SLUG, which is the
one place its stable undated names are the question rather than a copy of an
answer. Whether it survives as a browsing convenience stays open in the plan.
The output shape is unchanged for every plan that is linked — verified by
diffing `--json` against the previous implementation on this repo, where the
only differing fields were `changed_ago_seconds` and `local_dirty`, both of
which measure the moment the scan ran.

<!--
bumps:
  skills:
    plot: minor
-->
