# The artifact drift has a cause

**Finding for** [`docs/plans/2026-08-29-the-artifact-builds-the-same-everywhere.md`](../plans/2026-08-29-the-artifact-builds-the-same-everywhere.md),
Measuring slice. Measured 2026-08-30.

## The finding

**The variable is the source text of identifiers that never reach the artifact.**

`esbuild --minify` chooses its short names by frequency rank, and breaks ties
using a character-frequency table computed over the **whole input**, including
code that dead-code elimination later removes. So a declaration that is stripped
from the output still votes on how the surviving names are ranked. Two symbols
sitting adjacent in that ranking exchange places, and every name derived from
them exchanges with them.

The two values it took, on line 3 of the artifact:

```
Nb=F("^comment|^</[a-zA-Z][\w      ← base
Ib=F("^comment|^</[a-zA-Z][\w      ← after adding one stripped declaration
```

Every difference in that build was an `I`↔`N` exchange — `Nb`→`Ib`, `Na`→`Ia`,
`Ie`→`Ne`, `Np`→`Ip`, `Id`→`Nd`, `Io`→`No`. It swaps in **both** directions
within one build, which is what distinguishes a rank *exchange* from a shift.

This is the same shape the plan recorded on 2026-08-30 (`oj`→`lj`, `Q4`→`tN`)
and on 2026-08-29 (`Dj`→`Mj`, `Lj`→`Gj`): identifier-only churn, **identical
byte size, identical line count.**

## The experiments

Every hash below is `shasum -a 256 skills/plot/scripts/board/board-server.mjs`,
truncated to 16 characters. All builds ran in `/tmp/drift-probe-A`, a detached
worktree of `1ee394fb` with its **own** `node_modules` — not symlinked, which is
the gap the plan flagged in the morning A/B.

### The control

Without this, "identical" means nothing.

```
baseline                                              6a2697e6ed0b85b2
+ console.log("AB_PROBE_CANNOT_BE_ELIDED")            65d073d1e94bd71a   ← moves
  (grep count in artifact: 1 — it survived minification)
restored via `git checkout --`                        6a2697e6ed0b85b2   ← returns
```

### A harness that lied, and how it was caught

A first attempt at the experiments below reported "identical" for every
mutation. The harness invoked `../../node_modules/.bin/vite`, which does not
exist — the binaries live in `packages/board/node_modules/.bin` — and the
`||` guard swallowed it. **A build that never ran reads exactly like a build
that produced the same bytes.** This is the third instance of that failure in
this plan's history, after the suppressed `node build.mjs` and the
minifier-deleted `const x = "probe"` mutants.

Every result below comes from a harness that prints `VITE FAILED` /
`ESBUILD FAILED` and was proven to reproduce `6a2697e6` before use.

### Time is eliminated

The brief's designated experiment: build, wait, build again, touch nothing.

```
t+0s     6a2697e6ed0b85b2
t+90s    6a2697e6ed0b85b2
t+180s   6a2697e6ed0b85b2
```

### Path and modules are eliminated, more strictly than before

Same commit, different path, **own** `node_modules`:

```
.worktrees/infra-the-artifact-drift-has-a-cause   6a2697e6ed0b85b2
/tmp/drift-probe-A                                6a2697e6ed0b85b2
```

### What does move it: a declaration that is stripped

Appended to `packages/domain/src/entities/issue.ts`, a file the board reaches
only transitively:

```
export const DRIFT_PROBE_MARKER = 'drift-probe-marker-survives-minification';

  hash    6a2697e6ed0b85b2  →  1df276dd2aa9cdfb
  size    1,105,920 bytes   →  1,105,920 bytes    (identical)
  lines   264               →  264                (identical)
  grep for the marker in the artifact: 0          ← it never arrived
  32 of 265 lines differ, every difference an I↔N exchange
```

**The marker is absent from the output and the output still changed.** That is
the whole finding in one line.

### The letters are the variable, not the length

Two mutants of identical length and identical structure, differing only in which
letter they repeat:

```
const IIIIIIIIIIIIIIIIIIII = 1; void IIIIIIIIIIIIIIIIIIII;   5889a41dd435b72b
const NNNNNNNNNNNNNNNNNNNN = 1; void NNNNNNNNNNNNNNNNNNNN;   a756ee8b81432728
baseline (neither)                                           6a2697e6ed0b85b2
```

Three distinct hashes, all at 1,105,920 bytes. And the two mutants perturb the
ranking by different amounts, in the predicted directions:

```
+I : 32 differing lines   line 3    Nb=F(…  →  Ib=F(…
+N :  1 differing line    line 239  hN=nd.options  →  h4=nd.options
```

Adding `I`s promotes `I` past `N` and swaps the whole pair. Adding `N`s pushes
`N` the other way, displacing a single name at the bottom of the table.

### A negative that bounds it

```
export const P1 = 1;
export const P2 = 2;      →  6a2697e6ed0b85b2   (unchanged)
```

Two stripped declarations, short names, no effect. The perturbation has to be
large enough to cross a tie. This is why the drift is **intermittent** rather
than constant, and why it survived four days of hypotheses: most commits do not
cross one, and the ones that do look like nothing happened.

## Why this explains what was observed

The plan's open question was:

> Both build stages are path-independent under control. So what differed between
> the two directories on 2026-08-29 — the source they were built from, the
> client input, or the moment they were built?

**The source they were built from** — and the plan called this candidate 1, the
cheapest and likeliest. What it could not explain was why the diff was *two
identifiers* rather than the content change. This is why: the differing source
need not reach the artifact at all. It only needs to shift a character count.

The 23 worktrees in this checkout sit **10 to 131 commits** behind `main`. Every
one of them is a different input to that frequency table, so every one can
produce a different name assignment from byte-identical *board* sources. That is
the circularity the plan describes: main carries one worktree's variant, the next
PR from elsewhere reverts it, and neither branch changed a board source.

It also explains the two real CI failures being **one line and two lines**. A
near-tie crossed by a small margin displaces one or two names, not the whole
table.

## What this does not license

**No remedy is proposed here, and the Fixing branch stays withdrawn.** The slice
was scoped to name the mechanism, and the mechanism now has a name. Choosing
between the options this opens up — pinning esbuild's naming, building the
artifact only in CI, comparing semantically — is a separate decision with its own
trade-offs, two of which the plan already argues against.

**The gate is unchanged and remains correct.** It rejects an artifact that
differs from a fresh build, and in every observed case the artifact genuinely did
differ. The gate is measuring accurately; the build is what varies.

`build.mjs` is not modified. Nothing in it is wrong: no date, no path, no
version reaches the bundle, and its esbuild options are fixed. The variance is
inside the minifier's naming, below the level `build.mjs` controls.

## Reproducing it

```bash
git worktree add --detach /tmp/drift-probe-A HEAD
cd /tmp/drift-probe-A && corepack pnpm install
export PATH="/tmp/drift-probe-A/packages/board/node_modules/.bin:$PATH"
cd packages/board

build() {
  vite build   >/tmp/vite.log 2>&1 || { echo "VITE FAILED";    return 1; }
  node build.mjs >/tmp/esb.log 2>&1 || { echo "ESBUILD FAILED"; return 1; }
}
A=/tmp/drift-probe-A/skills/plot/scripts/board/board-server.mjs

build && shasum -a 256 $A | cut -c1-16     # baseline

printf '\nconst IIIIIIIIIIIIIIIIIIII = 1; void IIIIIIIIIIIIIIIIIIII;\n' \
  >> /tmp/drift-probe-A/packages/domain/src/entities/issue.ts
build && shasum -a 256 $A | cut -c1-16     # moved; size is unchanged

git -C /tmp/drift-probe-A checkout -- packages/domain/src/entities/issue.ts
build && shasum -a 256 $A | cut -c1-16     # back to baseline
```
