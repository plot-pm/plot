---
"plot": minor
---

plot-reconcile: an unlinked plan is not orphaned any more

`plot-reconcile-scan.sh` section 5 called a plan with no symlink in `active/` or
`delivered/` **orphaned**, and counted it as `attention`. That was accurate when
it was written, and it is not any more.

**Nothing about the report was wrong. It expired.** Until the phase grouping
became derived from plan content (#254), the index directories *were* the query
path — `plot-fleet-scan.sh` globbed `active/`, so a plan with no symlink was
genuinely unreachable: invisible to every unscoped pulse, absent from the board,
undispatchable. *Orphaned* was the right word for that, and the fix command was
worth interrupting a person for. Once the scan enumerates the plan directory and
groups by declared phase, the same plan is visible everywhere that decides
anything, and only `ls docs/plans/active/` misses it.

So the severity drops to **convenience**, in a new section:

```
== 7. Index drift (convenience — nothing depends on these) ==
  2026-08-19-a-plan.md — phase 'Approved', no symlink in docs/plans/active/ or docs/plans/delivered/ (browsing only)
    optional: ln -s ../2026-08-19-a-plan.md docs/plans/active/a-plan.md
```

A separate section rather than a softer line inside section 5, because that
count is load-bearing: `/plot-deliver`'s delivery-landed gate and the `/plot`
hygiene line both read `attention=` from the footer. A section mixing *worth a
glance* with *needs a decision* would leave every reader of that number to
re-derive the split from the body — which is what a machine-countable footer
exists to avoid. The footer gains `index_drift=N`; the command reads `optional:`
where section 1's read `fix:`.

**A dangling symlink keeps its severity, and until now had none at all.** A link
pointing at nothing is a broken pointer — `cat active/foo.md` fails, a
bookmarked path 404s — and no amount of deriving makes that harmless. It was
reported *nowhere* before: the loop walks plans and asks "does a link point at
me", so a link whose target no longer exists matched no plan and was silently
skipped. The check ran in the one direction that cannot see it. It is now
reported in section 5, with no `fix:` command: repointing the link at a renamed
plan and removing a link whose plan is gone are different remedies, and the
script cannot tell which applies without knowing why the target vanished.

**A file with no `Phase:` field is not a plan — a disagreement between two
scripts, settled.** #254 decided the rule for the fleet scan: a `.md` file whose
phase parses as `NONE` never claimed to be a plan, so the pulse does not
enumerate it. Measured in this repo, the two such files are a worker report and
an open-questions note. This script called the same file *a plan needing
attention*. Two consumers of one directory answering opposite is the exact shape
of the invisible-plan incident this plan exists to close, so the split is closed
rather than left for a reader to find.

Settled in #254's direction, because the alternative puts the format contract in
two places: `plot-plan-meta.sh` is the contract (Principle 3), "is this a plan"
is its answer, and a maintenance sweep answering differently would be a second
implementation free to drift from the first. The file is not silently dropped —
the visibility the old line bought was real — it moves to section 7 as `not a
plan (decision log / note?)`. What changes is the claim, and that it no longer
inflates a gating count.

`UNKNOWN` stays in section 5 for the same reason it stays a plan in the fleet
scan: a declared-but-unrecognised phase *is* a plan with a bad field.

**Measured before and after, on this repo:** `attention=1` before, and the one
entry was `2026-08-18-the-repair-exists-report.md — no phase field` — not an
unlinked plan at all. After: `attention=0 index_drift=1`, same file, stated as
what it is.

**`/plot-deliver`'s gate needed one change, and it was not optional.** Step 7b
greps the scan output for the delivered plan's basename and hard-stops on any
match in a plan-finding line. Section 7 is a new plan-finding section, so a plan
delivered without a symlink would have matched it and tripped the gate — a false
stop, and precisely the failure this change removes elsewhere. The gate now
slices the report at section 7 (`sed -n '/^== 7\./q;p'`) before grepping, so the
sections that mean *defect* still block and the convenience section never does.

<!--
bumps:
  skills:
    plot: minor
    plot-reconcile: minor
    plot-deliver: patch
-->
