---
'@plot-pm/board': minor
---

`OwnedRow` gains a `ticket` arm matched by `ticketOwnership`: a GitHub or Bitbucket assignee is compared to the reader's host login as a PR author is, a Jira assignee only resolves through a declared `jira:` spelling, and an empty assignee list is `unknown`. `ticketSourceOf` derives the vendor-neutral `TicketSource` (`host-login` or `tracker-account` with a `People` prefix) from the resolved `IssueSource`, the git-host backend and the listers the tracker adapters declare. `People` spellings accept a `<tracker>:<account>` prefix (for example `jira:jan.wloka@quatico.com`) to declare a tracker account for a handle.

<!--
plan: docs/plans/2026-10-12-the-board-has-three-tabs.md
bumps:
  skills:
    plot: patch
-->
