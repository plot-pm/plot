---
'plot': patch
---

`controllerInvocation(command)` (`packages/domain/src/rules/ci-suite.ts`) decides which of `plot-dispatch.sh`, `plot-approve.sh` or `plot-deliver.sh` a command RUNS — as opposed to reads or mentions — replacing the whitespace-token loop in `plot-controller-gate.sh` that could not be unit tested and that refused `ls skills/plot/scripts/*.sh` and two read-only `git grep` commands on 2026-10-03 (#1245). `plot-controller-gate.sh` now asks it through its own bundle (`plot-controller-invocation.mjs`), after a per-word prefilter and the desk exemption, both unchanged in position relative to each other; a command that passes the prefilter and gets no answer from the bundle is refused rather than allowed. `plot-deliver.sh --release` answers the rule's fourth value, `release`, rather than `deliver`. `start-command.ts`'s `loopWord` is folded onto the same basename reading via the new `commandRunsScript` export, with no change to any answer `start-command.test.ts` pins.

<!--
plan: docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md
-->
