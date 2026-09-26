---
'plot': patch
---

A wave says which of two questions its word answered. `plot-fleet-scan.sh` printed a wave `eligible` and, in the same run, `eligible=0` in its footer while both offer paths answered nothing — reported 2026-09-25 from a Bitbucket estate at 2.20.0 (#994) with one eligible wave, eleven branches and `--next` silent at an exit code the caller reads as success. Nothing was lying: the body word answers *are this wave's prerequisites met?* and the footer key and the offer paths answer *can a branch here be claimed now?*, and a wave being worked on satisfies the first and not the second. Reproduced on the GitHub estate while this was built — three waves read `eligible` against `claimable=1`. Both computations were already correct, so the fix is naming. The footer gains `claimable=` and keeps `eligible=` beside it with the same value, because three tests and `skills/plot-pulse/SKILL.md` read it. The body's wave line gains ` — someone-is-on-it` where its prerequisites are met and every branch is claimed or in progress, which is `StartabilityVerdictSchema`'s word for exactly those two states; `unknown` is excluded by naming them positively, so a host that could not be asked never reads as somebody else's work. The suffix is prose in the human body only — `FleetWaveSchema.verdict` is a strict enum, so `--json`, `--stream` and the outlook carry the verdict unchanged. `--list-eligible` now says on stderr which silence a reader is looking at, every candidate taken or no eligible wave holding one, while stdout stays a bare branch list because `plot-dispatch.sh` pipes it through `sort -u` and dispatches every line. `--next` is untouched: its exit-1 contract is shipped, documented and tested twice.

<!--
plan: docs/plans/2026-09-25-one-word-answers-two-questions-about-a-wave.md
bumps:
  skills:
    plot-pulse: patch
-->
