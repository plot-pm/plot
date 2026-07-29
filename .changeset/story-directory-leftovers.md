---
"plot": patch
---

story-tracking, plot: two leftover `docs/stories/` hardcodes in instructions

v1.8.0 made the story directory configurable, but two places still stated the
old default as fact rather than offering it as a default:

- `STORY-template.md` told the author to move an archived story to
  `docs/stories/archived/` — wrong in any repo that declares a different
  `Story directory`, which is now the whole point of the key.
- The `plot` hub skill described stories as living at `docs/stories/{slug}/`.

Both now name `<story directory>/` and point at the key. No behaviour change;
the default itself is unchanged.

<!--
bumps:
  skills:
    plot: patch
    story-tracking: patch
-->
