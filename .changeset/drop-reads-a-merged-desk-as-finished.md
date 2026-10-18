---
'plot': patch
---

`/api/registry/drop` no longer refuses a desk whose branch already merged and whose worker has already exited (#1564). `classifyState` (`packages/board/src/server/drop.ts`) used to call the injected liveness resolver directly and only re-derive a `finished` answer; a `waiting` answer was returned as-is, so a merged desk with no running worker still read "cannot drop a waiting worker — the agent is still running." `classifyState` now reads the PR index the same way `refreshStates` (`packages/fleet/src/shared/registry.ts`) already does, and applies the existing `deskBranchMerged`/`mergedDeskState` rules (`packages/domain/src/rules/merged-desk.ts`) to promote a `waiting` answer to `finished` once the branch has a MERGED row and the worker pid is dead. A reader that throws or answers null leaves `waiting` standing — never read as "confirmed not merged." Separately (#1784), `registry.ts`'s `defaultLiveness`/`defaultPrIndex` TSDoc blocks are reordered onto the functions they actually describe, with no behavior change, and a redundant test in `clean-wait-end.test.ts` is trimmed — both halves of its "full path" assertion were already covered individually by `workflows-agent-loop.test.ts` and `reapable.test.ts`.

<!--
plan: docs/plans/2026-10-17-desk-markers-and-the-reaper.md
bumps:
  skills:
    plot: patch
-->
