---
'plot': minor
---

`/challenge-the-plan` writes `- **Rounds:** N` into a plan's `## Status`,
alongside the metadata block it already maintains.

Both writes take the same incremented value in the same step, so the field a
person reads and the state the parser reads cannot disagree by construction.
The write is replace-or-insert-after-`Impl:` and touches nothing else: `##
Status` holds the transition records, which nothing in the repo can reconstruct.

<!--
bumps:
  skills:
    challenge-the-plan: minor
-->
