---
"@plot-pm/board": patch
---

fix(@plot-pm/board): the sprint control names its state

The sprint filter control now clearly communicates what it does:

- Added "Sprint only" label beside the toggle checkbox, so readers know what
  turning it on means without having to try it
- Added "Sprint:" prefix before the sprint name, identifying the kind of thing
  the line names
- Changed "→ <version>" to "target <version>" to clarify the release is where
  the sprint is going, not where it has been — answering the question "2.9.0
  is already released, right?" that the bare arrow prompted

<!--
bumps:
  skills: {}
-->
