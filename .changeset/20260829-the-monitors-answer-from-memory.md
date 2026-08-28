---
'@plot-pm/board': patch
---

Three monitors that answer from memory when nothing moved.

Wave 1 established *what changed*; this establishes *what may therefore be
reused*. A `--json --offline` scan on this repo spawns **121 git processes**
(traced 2026-08-29), and **88 of them — 42 `rev-list`, 37 `hash-object`, 9
`git -C status` — are three per-item loops** over the three things that grow.
The board runs one such scan every 5 seconds.

`BranchMonitor`, `PlanMonitor` and `WorktreeManager` hold the last answer and
recompute only what a signal invalidates. On a quiet pulse those 88 spawns
become **2** — the cost of asking whether anything moved.

**They are derivations, not records.** `PLOT_TERMINAL_CACHE` set the rule this
obeys: *"git is re-consulted every pass and the entry is discarded the moment it
disagrees."* A cache checked against a cheap fact every pass is a derivation; one
that is trusted is a record. Nothing is written to disk, so a restarted board
re-derives everything on its first pulse.

Three properties are pinned by tests that a mutation proved were needed:

- **A moved ref invalidates exactly its branch** — but a moved `origin/<main>`
  invalidates every count, because the range's left endpoint changed and every
  count in the set genuinely did.
- **A short batch reply is discarded whole.** `hash-object --stdin-paths`
  answers positionally, so a partial reply would key one plan's cached branch
  answers to another plan's revision.
- **A worktree status has a maximum age.** The set-level signal deliberately
  cannot see dirtiness — that is what `status` reports, so it cannot also be the
  signal deciding whether to ask — and time is the only bound left.

Verified against this repository rather than a fixture: 37 plans and 67 branch
rows, with every cached ahead-count and plan oid equal to what git answers
directly, and the scan's own output byte-identical across runs apart from two
wall-clock age fields.

One defect found and fixed in wave 1's signal along the way: it keyed plan files
on `mtimeMs`, a float carrying sub-millisecond noise that does not round-trip, so
two reads of an untouched file could compare unequal and discard the entry for
nothing. It now uses the exact `mtimeNs`.
