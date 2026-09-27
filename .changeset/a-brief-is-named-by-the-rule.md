---
'plot': minor
---

A commit that adds or renames a hand-off brief to `.plot/briefs/<prefix>-<slug>.md` is refused by a new `PreToolUse` gate, `plot-brief-name-gate.sh`, which names the path the readers compute and the `git mv` that reaches it. A slice is no longer held on `no-brief` by a file that is present and unread. `/plot-implement` step 4 now states the rule the readers use: the branch name after its last `/`, not the branch name with `/` flattened to `-`.

<!--
plan: docs/plans/2026-09-26-a-brief-is-named-by-the-rule.md
bumps:
  skills:
    plot: minor
    plot-implement: patch
-->
