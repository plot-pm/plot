---
'plot': patch
---

`plot-deliver.sh` (601 lines) becomes an 8-line launcher: it resolves `board/plot-deliver.mjs` and `exec`s it, passing arguments and the exit code through, and exits 2 with slice 3's missing-bundle message when the bundle is absent. The mechanical half of delivering and releasing a plan — the booking worktree, the `State:`/`Delivered:`/`Released:` writes, the index symlink, the sprint tick, and the push-or-micro-PR ladder — now runs as a JS entry over the refs, host, plan-store, scripts and trees ports, the ranking's confirmed first operator-command script (`the-shell-is-inventoried`). `controllerInvocation` reads a direct call to the bundle as the same `deliver`/`release` action as the launcher, so an agent cannot walk around the controller gate by skipping the `.sh`. Four new domain rules back the entry (`release-tag`, `plan-record-edit`, `sprint-tick`, `index-symlink`), each with unit tests, and two new port operations (`Trees.addBranch`/`removeWithBranch`, `Refs.tagsContaining`/`tagDate`). The entry writes its own state and action receipts rather than sourcing `plot-state-receipt.sh` — no shell survives after the launcher `exec`s it — held to the shell's format by `corpus/state-receipt.corpus.test.ts`, a declared duplicate per `a-shell-script-asks-the-domain`. `scripts/check-shell-lines.sh` falls from 15,493 to 14,900 lines; `check-script-names.sh`'s allowance rises from 12 to 14 for the entry's two out-of-scope shell dependencies (`plot-push-main.sh`, `plot-issue-status.sh`).

<!--
plan: docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md
bumps:
  skills:
    plot-deliver: patch
    plot-release: patch
-->
