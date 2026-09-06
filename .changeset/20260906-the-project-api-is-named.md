---
'plot': patch
---

The board updater's `gh` calls are exempted from the host-CLI gate on a reason
recorded in the script itself, and pinned by two tests. `plot-update-board.sh`
asks the GitHub Projects v2 API — `project view`, `item-add`, `field-list`,
`item-edit` — which `plot-host.sh` answers nothing about. It is the `tracker`
port's GitHub connector's write arm, resolved at `tracker-github.ts:62` and run
from `:72` and nowhere else, so it is already behind a port and that port is not
`host`. Routing it under `plot-host.sh issue-status` would put both vendors'
tokens in one place: that op is the same port's Jira connector and exits 4 for
any other scheme, because the two write through different APIs under different
credentials.

The exemption says what would change it — a second vendor's project board
needing the same four operations, whereupon the abstraction belongs on the
`tracker` port beside `statusWrite` rather than on `plot-host.sh`. The gate's
entry previously argued that project ops "belong in their own plan", which
predates the port split and named no exit condition.

Two tests in `test/reconcile/host-cli-gate.test.mjs` assert the facts the
exemption is made of: the script names the gate, the port and what would change
the decision, and every `gh` call in it is a `gh project` call. A `gh pr` or
`gh issue` line appearing there asks something the adapter does answer, and
would otherwise be covered by the exemption by accident.

<!--
plan: docs/plans/2026-09-06-the-last-two-callers-ask-the-adapter.md
bumps:
  skills:
    plot: patch
-->
