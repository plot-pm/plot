---
"@plot-pm/plot": patch
---

The plan estate moves from `## Branches` to the `## Waves` heading form, where a
wave's branch and pull request live in the heading rather than mixed into the
description prose:

```
old:  - `branch/name` — description → #PR
new:  ### WaveName (Branch: branch/name, PR: #PR)
      - description
```

88 plans migrate. The parser emits identical JSON from both forms — verified
per file before and after, with the single documented exception that an unnamed
wave gains the derived name `Implementation` (18 plans, all Delivered or
Released).

22 plans stay on the old form: the new heading holds ONE branch per wave, and
those carry several. The parser supports both indefinitely, so this is a
migration the estate completes only as those plans are sliced.
