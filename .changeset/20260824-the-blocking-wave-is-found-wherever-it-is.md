---
---

<!--
bumps:
  board: patch
-->

# The blocking wave is found wherever it is

`BlockedByMark`'s ⓘ silently did nothing when the blocking wave sat in a
collapsed section — which is where it usually sits, because the blocker is a
finished wave and DONE is folded by default for every reader on every load.

## The cause

Two separate DOM facts made the jump impossible, and both had to be fixed:

1. **A folded section removes its rows from the tree.** A collapsed section
   costs no vertical space by design, so its wave rows are not in the document at
   all — there is nothing for any selector to find.

2. **Only NOT STARTED wrapped its waves in `data-wave-list`.** The jump is
   `[data-wave-list="…"] [data-wave-row="…"]` — a wave row is reachable only
   when it sits under its plan's wave-list `<ul>`. NOT STARTED tagged that
   wrapper; the other sections did not, so a blocker in DONE rendered a
   `data-wave-row` with no `data-wave-list` above it.

## What changed (`AgentList.tsx` only)

The query itself is **unchanged** — one selector, both attributes,
document-wide. The fix is on the two DOM facts it depends on:

1. `BlockedByMark` now reads the blocker wave's own `section` from the payload
   and, before scrolling, **unfolds that one section** (`expandSection` — never
   folds, a no-op where already open, persisted through `writeCollapsed` the
   same as a manual toggle). It then retries across a few animation frames until
   the row mounts, since expanding is a `setState` React commits a frame later.

2. Every section's wave-list `<ul>` now carries `data-wave-list={plan}`, the
   wrapper NOT STARTED already had — so a wave row is a descendant of its
   plan's list in every section, and the query finds it wherever it is.

Where the row still cannot be reached (filtered out, another tab) the mark stays
silent about the jump but keeps naming the wave in its label and panel, so the
reader keeps that answer.
