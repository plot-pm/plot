---
"@plot-pm/board": patch
"@plot-pm/domain": patch
---

`approve.ts` no longer guards `throw hostRefusal` behind a `pr-closed`/`pr-absent`/`pr-ambiguous` check that could never be true — the placeholder PR a held host refusal substitutes always reads `state: 'OPEN'`, so `hostRefusal` now falls straight through to the unconditional throw that already covered every other case. `pinUnavailable` and `UNPINNABLE_NOTE` are removed from `controller-gate.ts`: since `hostPinsMerges` narrowed to always return `true` (PR #2067), every unpinned `gh pr merge` or `plot-host.sh pr-merge` already refused unconditionally, so `gate.ts`'s loop no longer reads the backend to decide. `controllerGateOf`'s TSDoc states that current behaviour instead of the pre-#2067 exemption.

<!--
plan: docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md
bumps:
  skills:
    plot: patch
-->
