---
'plot': patch
---

The fixer, the main-repair role and the unblocker load their role files through one loader, `roleFilesAt`: it fetches the default branch, reads the definition and settings from `origin/<default>`, and takes `maxTurns` from the definition. A failed fetch refuses `default-branch-unfetched` and writes nothing, so a dirty main checkout or a stale local `origin/<default>` no longer changes the role file a run starts from. `MAIN_REPAIR_MAX_TURNS` is removed; `main-repair.md` already declares `maxTurns: 80`.

<!--
plan: docs/plans/2026-11-03-who-may-approve-a-release-and.md
bumps:
  skills:
    plot: patch
-->
