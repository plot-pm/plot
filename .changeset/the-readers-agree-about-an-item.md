---
'@plot-pm/board': patch
---

A bare `- [ ] rename the deploy step` under `### Must Have` is a sprint item to every reader of a sprint file. Measured 2026-09-24: one sprint with two such lines read as `2 must items, both open` to `plot-sprint-release.sh` and was refused by the commit gate with `commitment-empty`, *"names no Must"* — the same file, the same lines, opposite answers. Both TypeScript readers required a `[slug]` link after the checkbox; the checkbox now makes the item, the heading makes the tier, and the link is optional metadata, which is the rule the release gate has always applied and `skills/plot-sprint/SKILL.md` documents.

Making the bracket optional was half of it. Both readers deduped on the captured slug, so every bare line keyed on `''` and collided: three lines with two bare kept 2 of 3, and eight bare Musts kept 1 of 8. The key is now the slug where there is one and the line's own position otherwise — never the item text, or two identical bare lines collapse. A slug listed twice still dedupes to its strongest tier, and a sprint with an empty `### Must Have` is still refused.

The board carries each member's text, because an item naming no plan has no slug to render; `collectSprints` no longer flags it with the unknown badge, which means *the sprint names a plan the board cannot find*; and the fleet counts it on its checkbox the way `scoreItem` scores `no-plan-named`, rather than dropping it from the total. A new corpus test declares all three readers as a pair over this estate's 14 sprints and 197 items, naming the two populations it excludes and their counts.

<!--
plan: docs/plans/2026-09-24-two-readers-disagree-about-a-sprint-item.md
-->
