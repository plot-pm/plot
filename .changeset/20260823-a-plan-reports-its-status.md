---
"@plot-pm/board": minor
---

board: a plan reports a derived `status` beside its `phase`

Every entity on the board carries a measured status except the plan, which
carries only `phase` — the decision a human writes. So the measurement *"every
wave of this plan has landed"* has had nowhere to live and has been squeezed
into `phase`, the one field that must never be derived. A new `status` field on
the plan card gives that measurement a name.

`status` is one of seven values — `draft`, `open`, `approved`, `in-progress`,
`deliverable`, `delivered`, `released` — derived every scan and stored nowhere,
exactly like a wave's `verdict`. `planStatus` composes it from the plan file
(phase, review channel, `Started:` count) and the pulse (merge state, claim
refs):

- `draft`/`open` split on the plan's own PR: a `Review: pr` plan under review is
  `open`, an in-session plan is `draft` and reaches `approved` without ever
  passing through `open` — it has no plan PR to observe.
- `approved`/`in-progress` split on whether anyone picked the plan up: a
  `Started:` record OR a claim ref means `in-progress`.
- `deliverable` is the value that earns the field — every non-deferred branch
  merged while the phase is still `approved`. It is the queue a person delivers
  from, and what DONE holds and the plan row's `Deliver` action appears on.

The card's `deliverable` bit and the auto-bump into Testing now read
`status === 'deliverable'`, so the affordance, the column bump and the reported
status agree by construction rather than by three separate re-derivations of
*is this plan done?*.

`phase` is untouched — same values, same file, same writers, same release gate.
Nothing new is written to disk: `plot-plan-meta.sh` is unchanged, its output
carries no `status` key, and no plan file gains a field. `status: deliverable`
never satisfies a gate — a release is a decision, and gating it on a measurement
would let work ship that nobody signed off.
