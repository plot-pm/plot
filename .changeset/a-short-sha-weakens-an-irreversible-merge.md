---
"@plot-pm/board": patch
---

`sameCommit` (`packages/domain/src/rules/same-commit.ts`) now takes a caller-set floor, defaulting to 7, instead of a single fixed one. `merge()` (`packages/domain/src/workflows/merge.ts`) takes that floor as a plain `minHexLen: number` on its input and holds no host name; `mergeAt` (`packages/board/src/server/entry/merge.ts`) reads the host backend and raises the floor to 40 when it is `github`, since GitHub's `headRefOid` is always a full 40-character sha, closing the collision window a 7-character prefix left open at `plot-ask.mjs merge <pr> <sha>`'s CLI boundary (which accepts any 7–40 char hex). Bitbucket keeps the 7+ default, since its `headSha` can legitimately be shorter, and its own shell-side re-read-and-match in `plot-host.sh` is unchanged. The duplicate, floor-less `sameCommit` in `verification-record.ts` is removed in favor of the canonical rule at its default floor — a plan's delivery commit is immune to squash-merge rewriting, so this was a lower-risk comparison than the live-PR-head one `merge()` makes, but it shared the same unbounded-prefix weakness and had no reason to keep its own copy. `approve.ts`'s merge and status-post paths already used full-length shas and needed no change.

<!--
plan: docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md
bumps:
  skills:
    plot: patch
-->
