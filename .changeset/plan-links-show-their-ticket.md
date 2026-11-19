---
'@plot-pm/board': patch
---

Every plan link on the board prints the plan's ticket keys before its slug: `#3495 a-quoted-separator-splits-nothing`, `#3489 #2531 approve-and-deliver-run-without-a-board`, or `ABC-123 a-plan` for a Jira key. The Release delivery and sprint delivery tables, the to-do lines, the You and Work items rows, the sprint, story and plan modals all read the label from one domain function, `planLinkLabel`. A plan with no `Issue:` field shows its slug alone, and a malformed key adds nothing.
