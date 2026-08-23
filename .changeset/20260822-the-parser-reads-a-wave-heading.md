---
"@plot-pm/board": patch
---

plot: the parser reads a wave heading

`plot-plan-meta.sh` now reads a second spelling of a plan's implementation
section. The old `## Branches` shape puts the branch in the list line, mixing
meta with prose:

    ### Removed
    - `bug/foo` — loses its half → #300

The new `## Waves` shape moves the meta into the `### ` heading, leaving the
line as pure description:

    ### Removed (Branch: bug/foo, PR: #300)
    - loses its half

Both spellings emit **byte-identical** `branches`, `prs` and `waves` arrays —
the property that makes the estate migration provably a re-spelling rather than
a change of meaning. A new-shape fixture and its old-shape twin are asserted
equal across the whole record.

**The parser reads BOTH while the migration runs.** The new shape is what Plot
will write and document, but the old spelling stays readable: a format change
owes its estate a migration that moves 85 files one at a time, and a plan moved
one commit before the parser learns the shape must not read as silently empty.
Measured against the pre-change parser, the new shape yielded `branches: 0`,
`prs: 0`, `waves: 0`, `error: null` — silently, so the fleet scan would print
`(no branches)` and `/plot-deliver`'s branch gate would pass on an empty list.
A migrated plan would not fail; it would disappear.

**A backticked name in a description is no longer a branch.** Under the old
shape a second path-shaped token on a branch line was read as a phantom branch —
on 2026-08-22 a wave of five reported six because a description cited a doc
path. In the new shape the branch is extracted from the heading, anchored to the
`Branch:` label, so a name in prose, in the wave title, or in a trailing
citation cannot masquerade as a branch. The property is delivered, not merely
permitted.

`PR:` is omitted where none exists yet: an absent field contributes nothing to
`prs` — not `""`, not `0` — the same rule `Issue:` follows. A `## Waves`
section whose heading names no branch still opens a wave, so the section is
never silently empty: a consumer can tell "a wave I could not parse" from "no
waves".

Scope: this teaches the parser and its contract tests only. The template still
writes the old shape (wave 2) and no plan file is migrated (wave 3). The
`<!-- claimed: -->` / `<!-- deferred: -->` comments still ride the branch line —
now the heading line that carries the branch — and moving them is a separate
question this wave does not answer.

<!--
bumps:
  skills:
    plot: minor
-->
