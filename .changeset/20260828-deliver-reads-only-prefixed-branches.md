---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

`plot-deliver.sh` reads a branch line only when the name carries a branch
prefix.

Its branch extraction matched any backticked identifier on a `- ` list item, so
a `## Changelog` bullet mentioning one was read as a branch of the plan. The
merge check then refused delivery over a branch that does not exist and never
will.

Measured 2026-08-27 — four fully-merged plans undeliverable, each blocked by a
word from its own changelog:

| plan | the "branch" it refused over |
|---|---|
| the-plan-the-board-holds | `impl` |
| loose-checks-what-it-promises | `pr_ready` |
| the-worktrees-live-in-one-place | `--migrate` |
| a-ticket-becomes-a-plan-or-a-story | `/api/story` |

The prefixes come from the `Branch prefixes` config key, the same derivation
`plot-fleet-scan.sh:187` uses, so a project with its own prefixes is read
correctly and one declaring none falls back to Plot's defaults. Both dialects
get the test — `## Branches` list items and `## Waves` headings alike.

This is the delivery-side twin of the rule
`a-citation-is-not-a-claim` establishes for the parser: **a claim is a list item
that starts with a branch**, not any backticked name in prose.
