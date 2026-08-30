---
'plot': patch
---

`plot-impl-status.sh` reads a `## Slices` heading.

It parsed `## Branches` and `## Waves` only, so a plan written in the spelling
`DESIGN-slice.md` settles on yielded **no branches at all** — and the caller saw
`{"error": "No branches found in plan"}` for a plan with five.

Measured 2026-08-30 against `the-domain-runs-the-workflows-in-a-sandbox`: before,
an error; after, both merged PRs with their states.

**Only one script had this defect.** Of the seven that mention the headings, six
delegate to `plot-plan-meta.sh` and inherit its handling; this one parses the
section itself, which is why it needed the same arm `plot-deliver.sh` got in
#529. One `sed` range covers both spellings, for the reason the parser gives:
the section's shape is identical whichever word heads it, and a second range
would be a second implementation of a re-spelling.
