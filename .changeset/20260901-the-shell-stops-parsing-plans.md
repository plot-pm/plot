---
'plot': minor
---

`plot-deliver.sh` asks for a deliverability verdict instead of deciding one.

The delivery gate re-implemented the plan format — a `sed` range over three
heading spellings, a prefix regex, and two greps for the deferred annotation.
That parse now comes from `plot-plan-meta.sh`, and the verdict itself from a
domain controller reached through `plot-ask.mjs`, so the rule lives in one
place and the shell asks rather than decides.

Every bug the old block had was a bug of being second: a `## Slices` plan
parsed to zero branches, so the gate passed by finding nothing to check
(2026-08-30); a `## Changelog` bullet was read as a branch, so four merged
plans refused to deliver (2026-08-27); and a fenced example was read as the
branches section — measured 2026-09-01 as the only disagreement between the two
parsers across all 188 plans in this repo, and the one the contract read
correctly.

<!--
bumps:
  skills:
    plot-deliver: minor
-->
