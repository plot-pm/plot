---
"plot": minor
---

A sprint can name the release it is working toward, and `/plot-release` reads it as a gate

`Release:` is a new optional field in the sprint format. When present,
`/plot-release` refuses to cut past an unfinished **Must Have** and names every
one; `--ignore-sprint` is the named escape, and using it writes the version, the
date and the open items into the sprint's `## Notes`. Unfinished **Should Haves**
prompt instead of blocking — no flag, because the confirmation is the record that
a person looked. **Could Haves** neither block nor prompt. Under
`PLOT_UNATTENDED=1` the prompt degrades to a warning while the Must-Have gate
still refuses.

`/plot-sprint close` reports the release state and never refuses on it: a timebox
whose release slipped still ends.

A sprint with no `Release:` behaves exactly as before.

New helper: `plot-sprint-release.sh` reports a sprint's target and per-item
states as JSON and decides nothing.

<!--
bumps:
  skills:
    plot: minor
    plot-release: minor
    plot-sprint: minor
-->
