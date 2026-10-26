---
'plot': patch
---

Tests and documentation for the Bitbucket Jenkins bind (plan `bitbucket-pr-rows-run-per-row`, wave 4, #2481): a new `test/reconcile/bitbucket-mergeable.test.mjs` assertion counts `git merge-tree` calls directly rather than inferring from working-tree state, so the MERGED-rows fast path is proven rather than assumed; two new `test/reconcile/host.test.mjs` tests trace the `--bound-shas` wiring from `pr-refresh.ts` through `plot-host.sh` to the rotation rule, and cover a named row whose Jenkins ask fails under `--state all`. Corrects a stale `skills/plot/scripts/README.md` claim (`bind` reads an unbuilt head as `unknown`, not `pending`), documents `jenkins_bind_rows`'s all-rows-unknown fallback when the `rows` bundle itself fails, splits two long `jq` chains in `plot-host.sh` onto multiple lines, and narrows `packages/board/src/server/entry/jenkins-pr-checks.ts`'s blank-line filter to the one verb (`bind`) that needs it instead of applying it ahead of every verb's fixed-index stdin parsing.

<!--
plan: docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md
bumps:
  skills:
    plot: patch
-->
