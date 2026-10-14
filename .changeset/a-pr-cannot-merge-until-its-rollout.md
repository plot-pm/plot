---
'plot': patch
---

The plan-PR merge in `approve.ts` and the ladder's micro-PR fallback in `ladder.ts` each write `plot/review` success on the PR they are about to merge, before the merge call — the two PR kinds that previously merged with no review status. `plot-host.sh` gains a read-only `pr-review <number>` op (GitHub only; Bitbucket exits 4) that returns a PR's head SHA, its newest `plot/review` status and whether a `review-bypass:` comment exists. `/plot-reconcile`'s new "20a. Review bypass" section prints the answer of `board/plot-review-bypass.mjs`, which asks the `reviewBypasses` domain rule: a PR merged after the `Review required since` config date with no passing `plot/review` and no `review-bypass:` comment is reported, a PR whose host read failed is named as unread, and with no key the section reports nothing and says so. The section reports and never gates.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->
