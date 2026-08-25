---
"@plot-pm/board": patch
---

board: a ready PR asks for you

A non-draft PR with green checks now reaches WAITING ON YOU even when its worker
is still running. Previously `prAsksNobody` returned true for any green PR,
leaving three ready green PRs (#389/#390/#391) reviewable but invisible while
their workers continued.

The fix distinguishes draft state from check state:
- **Draft PRs ask nobody** — the author is still working, stay in WORKING
- **Pending PRs ask nobody** — CI is running, no person can review yet
- **Green non-draft PRs ask for review** — the work is done, needs a reviewer

The 2026-08-17 fix added `green || pending` to keep a draft green PR in WORKING.
That was correct for drafts but one notch too wide for ready PRs, which were
silently filtered from the review queue.

Wave Ready from plan `the-working-section-shows-every-worker`.

<!--
bumps:
  skills:
    plot: patch
-->
