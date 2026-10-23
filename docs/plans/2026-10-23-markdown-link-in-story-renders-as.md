# Board: Markdown link in «Story:» renders as raw source on the card

> A `Story:` value written as a Markdown link reads as the link text, so the card chip, the story lanes and the story filter match the story slug.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2411
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2432 merged
- **Started:** 2026-10-23, Jan Wloka, `bug/markdown-link-in-story-renders-as`

## Changelog

- The board reads a Markdown link in a plan's `Story:` field as its text, so the story chip, the story lanes and the story filter show and match the story slug.

<!-- Board impact: changes how `plot-plan-meta.sh` reads `story`, which the board consumes through `/api/board`. Rebuild the board artifact (pnpm build:board) to test locally; do not commit the bundle. -->

## Motivation

A plan can name its story as a Markdown link, because the link is clickable in the plan file:

    - **Story:** [`EWZKUS-3845-gpsync-abloesen`](../stories/EWZKUS-3845-gpsync-abloesen/STORY-EWZKUS-3845-gpsync-abloesen.md)

`plot-plan-meta.sh` returns the whole string as `story`. `/api/board` carries it unchanged, and the Planning card prints the raw source as the story chip. Several plans in ewz-kus-portal use this form (the EWZKUS-3874 plans). Observed 2026-10-23 on Plot 2.28.0 with Bitbucket. Source: issue #2411.

## Design

### Approach

Reduce the value where it is read, so every consumer sees a slug:

- `skills/plot/scripts/plot-plan-meta.sh` reads `Story:` in two places (the front-matter-style line at 1041 and the canonical Status line at 1156, both through `val_after_colon`). A Markdown link `[text](target)` reduces to `text`, with backticks around the text removed. A plain slug passes through unchanged.
- The target is kept as the link: the open question below decides whether `plot-plan-meta.sh` reports it as a second field or whether the board derives it from the slug.
- `Issue:` values are already reduced to keys; the story reduction follows the same pattern.
- Story lanes and the story filter (`packages/board/src/app/components/Swimlanes.tsx`, `Board.tsx`, `lib/filters.ts`) compare `card.story` to the story slug, so they need no change once `story` holds the slug. A test proves it.

Board impact: the `story` field keeps its type and meaning. Only the value for the link form changes.

### Open Questions

- [ ] Does the board need the link target, or does it resolve the story from the slug? If the slug is enough, the target is dropped.
- [ ] Does the domain package hold a second reader of `Story:` that needs the same reduction? A grep found none in `packages/domain/src`; the implementer confirms it.
- [ ] Which forms count as a link: `[text](target)` only, or also `<target>` and reference-style links?

## Slices

### Story link reduction

- `bug/markdown-link-in-story-renders-as` — reduce a Markdown link in `Story:` to its text in `plot-plan-meta.sh`, with a contract test for the link form, the plain form and an empty value, and a board test that the story filter matches the reduced slug → #2447

## Notes

Created by `/plot-idea` from issue #2411 for the plan to stop at Draft. Nothing is written to the tracker.
