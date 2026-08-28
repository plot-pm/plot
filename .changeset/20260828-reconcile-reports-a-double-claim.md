---
'plot': minor
---

<!--
bumps:
  skills:
    plot: minor
    plot-reconcile: patch
-->

The sweep reports a branch claimed by two plans.

`plot-reconcile-scan.sh` had eleven sections and none of them answered *is this
branch listed by more than one plan?* The board answered it — two rows wore an
orange `claimed twice` mark on 2026-08-23 — while the sweep whose whole purpose
is estate faults reported clean. Section 12 closes that gap: every branch
listed by more than one plan, naming both plans and the wave each lists it
under, with a machine-countable `double_claims=` footer entry.

**It reports and never gates.** `/plot-deliver`'s delivery-landed gate and the
`/plot` hygiene line both read `attention=` from the footer, and a double claim
is a shape for a person to resolve, not a branch that cannot move — both plans'
waves can still advance and the branch itself is fine. So it carries its own
counter and leaves `attention=` alone, the same split sections 7, 8, 9 and 10
follow. A test asserts exactly that, against a fixture that HAS a collision:
adding the finding to `attention=` looks like diligence and turns a report into
a gate.

**It is placed last**, so sections 1–11 keep their numbers. `/plot-deliver`'s
gate marker is `sed -n '/^== 7./q;p'` — a hardcoded number meaning *the first
non-blocking section* — and inserting anything below 7 would silently shrink
the delivery gate.

**The anchored matcher is what makes it meaningful.** Before a claim became a
list item that STARTS with the branch, any backticked branch name under
`## Branches` was a claim, so a plan citing another plan's branch to declare a
dependency read as a second claimant. Roughly two in three backticked branch
names in `docs/plans/` are citations rather than claims, so this section built
first would have been a list of false positives. That ordering was the point of
the two waves.

One implementation note worth keeping, because its failure is invisible: the
`jq` here is **slurped**. The parser emits one JSON object per plan, and `jq`
without `-s` evaluates the program once per object. Sections 7 and 8 ask about
a single plan, so per-object evaluation is right for them; this section asks
*across* plans, which cannot be answered one object at a time. Unslurped,
`group_by` groups each plan against itself, every group has length 1, and the
section prints `(none — every branch is claimed by exactly one plan)` on an
estate that has a collision — the same line a clean estate prints. Caught here
only by counting the collisions independently first.

The estate is not clean: `bug/a-filtered-section-says-what-it-hid` is listed by
both `a-count-answers-to-its-section` (wave Withheld) and
`the-filter-does-not-hide-a-worker` (wave Counted), each annotating the same
merged PR #417. That is a true positive of the kind this section exists for —
two plans genuinely listing one branch — and resolving it is a person's call
about what the two plans mean.
