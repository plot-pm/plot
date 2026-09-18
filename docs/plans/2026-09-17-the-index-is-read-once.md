# The index is read once

> The reconcile scan resolves every index symlink in one pass instead of re-walking both index directories for each of 295 plans.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-18, jwloka, in-session
- **Started:** 2026-09-18, Jan Wloka, `bug/the-index-is-read-once`

## Changelog

- The reconcile sweep reads the `active/` and `delivered/` indexes once per run rather than once per plan. On an estate with 295 plans and 363 index links this removes 130,128 process forks from every sweep.

<!-- Board impact: none. No plan format, no template, no layout change. The
     board does not call this function — `plot-fleet-scan.sh` has no reference
     to `symlinked_from`, verified by grep — so the board's own latency is a
     different question and this plan does not claim it. -->

## Design

`symlinked_from` (`plot-reconcile-scan.sh:681`) answers *does a symlink in this
index point at this plan file?* by walking the whole directory and forking
`readlink` and `sed` for every link it passes:

```bash
symlinked_from() { # $1=index_dir $2=dated_basename
  local l t
  for l in "$1"/*.md; do
    [ -L "$l" ] || continue
    t=$(readlink "$l" 2>/dev/null | sed 's|.*/||')
    [ "$t" = "$2" ] && { echo "$l"; return 0; }
  done
  return 1
}
```

It is called twice per plan, at `:712` and `:713`, inside the loop over every
plan file. That is the whole defect: **a per-plan question is answered by a
per-plan directory walk.**

**And it is not the only walker.** `:1102`, in section 4, inlines the same
`readlink | sed` pair over `active/` — 85 links, 170 forks — without ever calling
`symlinked_from`, so a Done-when phrased around the function would leave it in
place. Section 5's dangling loop at `:844` walks both directories again. **A plan
titled *the index is read once* must serve all three**, or the title is false.

### The cost, counted rather than estimated

Measured on this estate 2026-09-17: **295 plans, 83 `active/` links, 280
`delivered/` links**, of which 83 and 277 respectively resolve to a plan.

Counting the links each lookup examines before it hits — so the early `return 0`
is honoured and the number is not a worst case — gives **130,128 forks per
sweep** (two per examined link). Without the early return the ceiling is
214,170.

### A fork costs 38 ms on a loaded machine, and that is the multiplier

The two halves were timed separately, on this machine at load 14.9 with eight
concurrent fleet scans running:

| work | count | elapsed | per unit |
|---|---|---|---|
| `readlink` forks | 363 | 13.74 s | **37.8 ms** |
| fork-free loop iterations | 295 | 0.0132 s | **0.045 ms** |

**840x.** Every conclusion here follows from that ratio: the fix is not a better
algorithm, it is *fewer processes*. An index built with one fork per link is
still 363 forks and still slow — measured at 22.7 s — so "build an index" is not
the specification. **Stop forking per plan** is.

### The replacement is one fork for the whole run

`ls -l` prints the link and its target together, so one call resolves both
directories. **The real two-directory output carries structure**, and an earlier
draft of this plan showed a single line as if that were the shape:

```
docs/plans/active:
total 0
lrwxr-xr-x@ 1 jwloka staff 49 Aug 28 22:08 a-board-names-the-repo-it-serves.md -> ../2026-08-28-a-board-names-the-repo-it-serves.md
...
docs/plans/delivered:
total 0
lrwxr-xr-x@ 1 jwloka staff 52 Sep  2 16:05 2026-09-01-a-refused-dispatch-asks-for-a-brief.md -> ../2026-09-01-a-refused-dispatch-asks-for-a-brief.md
```

371 lines for 366 links: two directory headers, two `total 0` lines and a blank
separator. A reader keying on `*" -> "*` skips all five naturally, **and which
directory a link came from must then come from the header rather than the line**
— the two indexes answer different questions.

Measured across four runs: **0.081 s, 0.136 s, 0.300 s, 0.529 s** — load-bound
like every other timing here, and the right order of magnitude in all four. The per-plan lookup then uses shell
parameter expansion and forks nothing — including `${f##*/}` in place of
`basename`, which is 295 forks the current loop also pays.

`find … -exec readlink {} +` is likewise one fork and **is not usable**: it
prints targets without their links, and section 1 needs the link path to print
its `fix:` command.

### What this must not change

**The two answers this function feeds.** `:712-713` set `in_active` and
`in_delivered`, which decide section 1's phase/symlink drift and section 9's
index-drift convenience count. Section 1 sits ABOVE `== blocking sections end ==`
and is what `/plot-deliver` step 7b greps, so this is a blocking path.

**Section 5 is NOT a consumer**, and an earlier draft of this plan said it was.
Its dangling-link finding is an independent loop at `:844-853` that reads both
directories itself and never calls `symlinked_from`.

**`*.md` IS A FILTER, and the replacement must keep it.** `symlinked_from`
enumerates `for l in "$1"/*.md`, so a link whose NAME does not end `.md` is
invisible to it whatever it points at. A bare `ls -l <dir>` applies no such
filter and would answer *linked* where the current code answers *not linked* —
changing `index_drift=` and, where the phase disagrees, emitting a **new section
1 drift row** naming a path that is not an index entry. The estate proves the
directories are not curated: `docs/plans/active/` holds `.omc`, a directory.
`ls -l "$dir"/*.md` keeps the filter and stays one fork.

**FIRST match wins.** `symlinked_from` returns the first glob match and stops.
Three plans here carry two links each to one target — `a-refused-dispatch-asks-for-a-brief`,
`an-idle-agent-is-not-a-stalled-one`, `the-board-says-slice` — so an index built
`IDX[target]=link` unconditionally would print a different link path in section
1's `fix:`. All three are `delivered` with links in `delivered/` and therefore
**not in drift**, so a byte-identity diff would pass while the index was wrong.

**The link path is still printed, not just a boolean.** Section 1's remediation
text names the link file. An index keyed only by target basename would answer
*is it linked?* and lose *which link*.

**The link path is still printed, not just a boolean.** Section 1's remediation
text names the link file. An index keyed only by target basename would answer
*is it linked?* and lose *which link*.

**Nothing about the board.** An earlier reading of this defect attributed the
board's 5 s responses and its 90 s pulse timeout to this function. That was
wrong: `symlinked_from` exists only in `plot-reconcile-scan.sh`, and
`plot-fleet-scan.sh` — which is what the board runs — contains no reference to
it. The board's latency has a different cause, measured the same day as eight
concurrent `plot-fleet-scan.sh --offline` processes at load 14.9, and it is not
this plan's to fix.

### Why the measurement had to be derived

Timing the current implementation directly **timed out twice at 120 s**, once on
the full corpus and once on twenty plans. A three-plan run completed at 19.7 s
per plan, which extrapolates to 5,814 s — a number that is true under load 14.9
and useless as a target, because the load is partly this estate's own scans.
The fork count is load-independent and is therefore what this plan states.

## Slices

### The index is read once (Branch: bug/the-index-is-read-once, PR: #948)

- `bug/the-index-is-read-once` — resolve both index directories in one pass before the plan loop, and answer `in_active`/`in_delivered` from it with no per-plan fork

**Done when** both index directories are resolved **once per run**, proven by a
test that counts process creations rather than by timing; the per-plan lookup
forks **zero** times, including the `basename` call at `:711`; `symlinked_from`
has no remaining caller, or is deleted; the sweep reports **83** plans linked
from `active/` and **277** from `delivered/`, the counts measured 2026-09-17;
section 1, section 5's dangling-link finding and section 9's `index_drift=` are
**byte-identical** to the current output on this estate, pinned by diffing a
full sweep before and after; a section 1 finding still prints the **link path**
in its `fix:` command; a dangling link — one whose target does not exist — is
still reported, since `ls -l` shows it and `[ -L ]` accepted it; an index
directory that is absent or empty produces no error and no finding; and
`pnpm run test:contracts` passes.

## Notes

**The benchmark is the deliverable, not the speedup.** Two replacements were
written while drafting this and both were slower than they looked: one forked a
subshell per lookup (53.3 s), one forked per link (22.7 s). Neither is
distinguishable from the fast shape by reading the diff. A Done-when that says
*faster* would have passed on both.

**Amended 2026-09-17 after a three-lens panel** (`.plot/panels/2026-09-17-the-index-is-read-once/`),
unanimous `amend`. Four attacks were tried and withdrawn on measurement — the
domain is not the right home (`reconcile.ts:102` takes `phaseSymlinkDrift` as a
supplied reading), section 1 does block, the sibling `--offline` plan explicitly
disclaims this function, and `git ls-files | cat-file` lost to `ls -l` (0.118 s
against 0.052 s) and answers from the ref where section 1 must report the
working tree. What stood: a second walker at `:1102`, the `*.md` filter, the
first-match rule, and counts already stale by two plans.

**A name containing ` -> ` or a space would break an `ls -l` parse**, and no such
name exists here today. Recorded as the risk that argues for `find -print0` if
one ever does; it is not a live defect and does not gate this plan.

**The 38 ms per fork is this machine under this load**, not a constant. On an
idle machine a fork is nearer 2 ms and the current code would take about 4
minutes rather than 80. The fork *count* is what the fix removes, and it is the
same number on any machine.
