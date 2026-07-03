---
"plot": minor
---

Address remaining points from plot-pm/plot#1:

- **plot-approve** — set project-board status to "In Progress" (not "Ready") when the impl PR is created; approved work is actively being implemented. Add a "Finishing an impl branch" subsection so the agent knows to run `gh pr ready <number>` when work is done. Reviewers filter by PR state, not by chat messages.
- **plot** (dispatcher) — replace the single >7-day "stale drafts" heuristic with two distinct signals: **Completed drafts** (draft PRs with real commits — suggest marking ready) and **Abandoned drafts** (>7 days idle — surface for cleanup).
- **plot-release** — reframe as a participant in the project's release process, not the driver. Step 4 is now "Hand-off to Project Release Process" — version bump, tag, and push belong to the project's release tooling (changesets, CI, or manual), not to plot-release. Summary no longer frames release mechanics as "what remains" for plot to do.

<!--
bumps:
  skills:
    plot-approve: patch
    plot: patch
    plot-release: minor
-->
