---
"plot": minor
---

`/plot-board-setup` now warns when writing a `Tracker` key that no backend reads
yet.

When a user configures `Tracker: jira`, the board looks configured and behaves
unconfigured — the inbox shows nothing because `plot-host.sh issue-list` routes
through the **Git host** (`github` or `bitbucket`), not through a separate
tracker system. The reasonable conclusion is *I set it up wrong*. The warning
stops that: it says plainly that the key was recorded but no backend reads it
yet, so the inbox will be empty until the Jira backend lands.

The check **derives** rather than hardcodes which trackers are unread. The
backends that `plot-host.sh issue-list` can ask are exactly those that match its
`if [ "$be" = "github" ]; then … else …` shape: `github` and `bitbucket`. Any
other `Tracker` value is unread today. When a new backend lands — `jira`,
`linear`, etc. — the warning must stop firing for it.

This is the motivating failure of the "setup tells me what it found" plan:
honest configuration that silently produces nothing is the worst kind of setup
failure.

<!--
bumps:
  skills:
    plot-board-setup: minor
-->
