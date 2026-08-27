---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

`plot-impl-status.sh` reads the `## Waves` dialect, not only `## Branches`.

A plan states its branches either as `## Branches` list items or as `## Waves`
headings of the form `### Name (Branch: x, PR: #N)`. This helper read only the
first. Measured on this estate: **126 plans use Waves, 27 use Branches** — so
the majority dialect resolved to no branch lines at all.

The consequence was not a visible error. `plot-deliver.sh` calls this helper and
swallows a failure into `{"prs":[]}`, then finds no PR for any branch — so every
branch of every Waves plan read *not merged*. Four fully-merged plans were
refused delivery on 2026-08-27, the message naming branches whose PRs had landed
the day before. Absent read as false, in a gate.

Both annotation forms are now read: a trailing `→ #N` on a Branches line, and
`PR: #N` inside a Waves heading. The two branch sets are unioned rather than
chosen between, so a plan mid-reslice carrying both sections reports every
branch it names.
