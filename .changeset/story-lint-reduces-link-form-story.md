---
"plot": patch
---

`plot-story-lint.sh`'s S5 check now reduces a `Story:` field written as a Markdown link to its text before comparing it against a story's directory slug, matching `reduce_story_link()` in `plot-plan-meta.sh`. Previously a link-form `Story:` field never matched the slug, so S5 silently reported no drift for any plan written that way.

<!--
plan: docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md
bumps:
  skills:
    plot: patch
-->
