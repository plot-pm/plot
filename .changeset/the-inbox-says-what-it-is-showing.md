---
'plot': patch
---

`/plot-board-setup` states what the Jira inbox will show and names the one override. The default query narrows twice — by assignee and by project — and adoption explained neither, so an operator had no way to tell a correct empty inbox from a broken one. Measured 2026-09-17 on a repository tracking in Jira, `project = QUAWEB AND statusCategory != Done` returned 10+ open tickets while the default returned 0, with credentials verified independently at `GET /rest/api/3/myself` → 200; nothing was misconfigured and the reporter had to run the JQL by hand to find that out. Step 4d states both narrowings, names `PLOT_JIRA_JQL` as the whole-query override, and prints unconditionally rather than firing on an empty inbox, because the reading is true either way. The same step's stale neighbour is corrected: the skill told adopters a `Tracker: jira` was "recorded but unread" and the inbox "will be empty", while `plot-host.sh` dispatches Jira first on `tracker_scheme` and its header reads "JIRA ANSWERS when `Tracker: jira` is declared" — a false explanation for an empty inbox is strictly worse than none, and it was this plan's own failure one step earlier. The derivation rule beneath it carried the same assumption and would have fired a warning on `jira`, so it is corrected with the prose. The default query is unchanged, byte for byte.

<!--
plan: docs/plans/2026-09-17-the-inbox-says-what-it-is-showing.md
bumps:
  skills:
    plot-board-setup: patch
-->
