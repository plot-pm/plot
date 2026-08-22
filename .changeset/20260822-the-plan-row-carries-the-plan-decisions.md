---
"@plot-pm/board": patch
---

plot: the plan's acts live on the plan head, and NOT STARTED holds approved plans only

Three breaks in one path — read a plan, approve it, start the work — none of
which connected, all from the same confusion between a PLAN act and a BRANCH
row.

**The branch-row Approve could not render for any row, ever.** Its gate was
`isDraft(card) && row.waitingOn === 'you'`, but `waitingOnFor` returns non-null
only for `group === 'not-started'` while `classify` routes every Draft plan to
`waiting-on-you` — the two clauses excluded each other by construction.
Measured by executing the function rather than reading it: `'you'` is returned
for exactly one input, `not-started` + `deferred`. No narrowing makes a
plan-level act correct on a branch row — a branch BLOCKED by an earlier wave is
in `waiting-on-you` too when its plan is Draft — so the row-level control is
deleted, not re-gated, and Approve lives on the plan head (`PlanActions`, gated
on the card's `isDraft` alone), where it always worked.

**Commission design was worse: self-contradictory.** `canCommissionDesign` read
`waitingOn === 'you' && state === 'open'`, and `'you'` only ever arrives with
`state === 'deferred'` — satisfied by no board-producible input. Deleting its
row twin would have removed the feature outright, because `PlanActions` took no
`commission` prop. The prop is now threaded through (an extension of a chain
already reaching five components), and the plan head offers Commission design
beside Approve — the two answers to one question.

**NOT STARTED admitted Draft plans.** The `deferred` arm of `classify` kept
`'draft'` in its unknown-phase allowlist, so a Draft plan's shelved branch fell
through to `not-started` — the section whose hint reads *approved, nobody has
taken it*, offering work no phase gate would let an agent start. `draft` now
answers on its own line, WAITING ON YOU for both verdicts, exactly as the
`open` arm already answered it. `''` still falls through untouched: absent is
not a phase, and a scan predating the field says nothing about the plan.

The two plan-level acts left the branch menu entirely — `menuState`, `RowActions`
and the prop chain down to them no longer carry them — so the branch row's menu
holds only branch-level acts (Start work, Open/Review, the conflict dispatch,
the reads), which a browser test pins against the emptied-menu regression. A
new browser test exercises the plan HEAD, the render twelve green card tests
never mounted, and it fails against the pre-fix code for the stated reason:
the Commission design item is absent without the prop.

<!--
bumps:
  skills:
    plot: patch
-->

## And a wave said *nobody has taken it* over finished work

Reported from a screenshot: PR #323 rendering `green` beside `approved — nobody
has taken it`. The server was right on every field — the row sat in
`waiting-on-you` with `note: "PR #323 green"` — and the client's fallback chain
was not.

`waveNote` guarded on `soleNote`, which is the sole row's note **with its PR
fact stripped**. Where the note is only that fact — the ordinary shape for a
finished branch — the strip leaves `''`, and empty is falsy, so the chain fell
through to a verdict sentence about starting work that had already been done.

The guard now asks `soleRow`, which says *this wave has one branch and the
branch speaks for it* — the same condition the sibling `waveWaitingOn` ternary
already tested three lines above. The comment beside it had described the
intended behaviour correctly since it was written; only the predicate was wrong.

Every single-branch wave that reaches review hit this, which is the common case
rather than an edge.

