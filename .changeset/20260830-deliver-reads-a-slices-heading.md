---
'plot': patch
---

`plot-deliver.sh` reads a `## Slices` heading.

The plan format has three spellings for one section — `## Branches`,
`## Waves`, and `## Slices`, which `DESIGN-slice.md` settles on.
`plot-plan-meta.sh` has read all three since the migration began;
`plot-deliver.sh` read only the first two.

**The failure had no symptom.** A `## Slices` plan parsed to an EMPTY branch
list — not an error, just nothing — so the delivery gate that exists to refuse a
plan with unmerged branches would have passed it silently. Measured 2026-08-30:
two approved plans were in that state, one already dispatched with five slices
in flight.

Verified 0 branches before, 5 after, on a real plan. The regression test drives
the script's own sed range rather than re-implementing it, and removing the new
arm turns two of its four tests red.
