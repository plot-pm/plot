---
'@plot-pm/board': patch
---

Delivery-tab links show the board's Octicon for what they point to again. The icon sits before the link text: plan, slice, branch, PR, ticket, release, agent, build, worktree or an external page. This covers Release delivery plan names, the slice and PR on an opened plan line, the plan owner, the to-do list's lines and its triage link, the release card title, Tickets rows and their "Plan it", the cell links in the Fleet and Work items rows, the agent and acts-on link lines, and the Master Agent branch. The domain's `linkIconKind` maps a link's target to its icon kind, and the to-do list carries each line's kind.
