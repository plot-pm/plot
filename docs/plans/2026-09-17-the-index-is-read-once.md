# The index is read once

> The reconcile scan resolves every index symlink in one pass instead of re-walking both index directories for each of 295 plans.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches

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
directories:

```
lrwxr-xr-x@ 1 jwloka staff 49 Aug 28 22:08 a-board-names-the-repo-it-serves.md -> ../2026-08-28-a-board-names-the-repo-it-serves.md
```

Measured: **0.081 s for all 363 links.** The per-plan lookup then uses shell
parameter expansion and forks nothing — including `${f##*/}` in place of
`basename`, which is 295 forks the current loop also pays.

`find … -exec readlink {} +` is likewise one fork and **is not usable**: it
prints targets without their links, and section 1 needs the link path to print
its `fix:` command.

### What this must not change

**The three answers this function feeds.** `:712-713` set `in_active` and
`in_delivered`, which decide section 1's phase/symlink drift, section 5's
dangling-link attention finding, and section 9's index-drift convenience count.
All three must report byte-identically before and after — the hit counts
(83 and 277) are the pin.

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

### The index is read once (Branch: bug/the-index-is-read-once)

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

**The 38 ms per fork is this machine under this load**, not a constant. On an
idle machine a fork is nearer 2 ms and the current code would take about 4
minutes rather than 80. The fork *count* is what the fix removes, and it is the
same number on any machine.
