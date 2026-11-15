---
'plot': patch
---

A person can name a repair PR for a red default branch after fleetd's own repairs are spent. `plot-ask.mjs repair-pr` and the merge's repair admission now read an `exhausted` repair record as an open episode while the default branch is still red on its first red commit. Before, both refused it as closed, so main stayed red with no controller left to end the episode.
