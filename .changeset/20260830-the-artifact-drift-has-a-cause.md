---
'plot': patch
---

The board artifact's drift has a measured cause, and it is not `build.mjs`.

**The variable is the source text of identifiers that never reach the artifact.**
`esbuild --minify` breaks frequency-rank ties using a character-frequency table
computed over the whole input, including code that dead-code elimination later
removes. A stripped declaration still votes on how the surviving names rank, two
adjacent symbols exchange places, and every name derived from them follows.

Measured 2026-08-30: appending one stripped `export const DRIFT_PROBE_MARKER`
moved the artifact `6a2697e6` → `1df276dd` at **identical size and line count**,
with the marker absent from the output and every one of the 32 differing lines an
`I`↔`N` exchange. Two mutants of identical length differing only in which letter
they repeat gave three distinct hashes. Two *short* stripped exports moved
nothing — which is why the drift is intermittent rather than constant: a
perturbation has to cross a tie, and most commits do not.

This explains the shape that made the drift hard to see. The differing source
need not reach the artifact at all; it only has to shift a character count. The
23 worktrees in a working checkout sit 10 to 131 commits behind `main`, so each
is a different input to that table and can produce a different name assignment
from byte-identical *board* sources.

Time, path and `node_modules` are eliminated, the last two more strictly than
before — in a detached worktree with its own installed modules rather than
symlinked ones.

No remedy here, and no code change: the plan's Fixing branch stays withdrawn
until a mechanism was named, and naming it is what this slice was scoped to do.
**The gate is unchanged and remains correct** — it rejects artifacts that
genuinely differ from a fresh build. The build is what varies, below the level
`build.mjs` controls.

The finding is committed as `docs/research/2026-08-30-the-artifact-drift-has-a-cause.md`,
with every comparison carrying its control — including an account of a harness
that reported "identical" for every mutation because it invoked a `vite` path
that does not exist and swallowed the error.
