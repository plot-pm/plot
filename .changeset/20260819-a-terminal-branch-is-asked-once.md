---
"plot": minor
---

A terminal branch is asked once

A merged branch stays merged. Measured on this repo 2026-08-19, after the
`pr-list` join (#232) landed: 26 of 54 branches are terminal — merged or
deferred — so nearly half the scan asked, every 5 s, about facts that cannot
change.

**What the join left behind, measured in a sandbox before any of this was
written.** Two branch shapes, at two sizes:

| Branch shape | 3 branches | 9 branches | scales? |
|---|---|---|---|
| merged, ref kept | 1 `pr-list` | 1 `pr-list` | no |
| squash-merged, ref deleted | 3 `pr-state` | 9 `pr-state` | **yes, 1:1** |

So after the join the only per-branch host cost left is the no-ref `--ask` arm
PR #216 put there — and that arm *is* the terminal population: a branch whose
ref is gone and whose merge already landed. The cache lands exactly there and
nowhere else, which is why **a live branch cannot be cached even by accident**:
a live branch has a ref and never reaches the call. The invariant is structural
rather than a check that could be forgotten.

**The cache is a derivation, not a record, and that distinction is the whole
design.** Git is consulted on *every* pass; only the host round trip is skipped.
The asymmetry is the point — git is local and cheap, the host is remote and
metered — and a cache that also skipped git would be a record of the past rather
than a derivation of the present, which Manifesto Principle 1 rules out.

So an entry carries the *evidence* that made the branch terminal —
`branch, state, plan-oid, main-oid` — and every pass asks git whether it still
holds. A reappeared ref is not served and not even reached, because a branch
name is reusable: merge `bug/flaky`, delete it, push it again, and serving the
first attempt's `merged` would settle a wave and open the next one on work that
has not landed. An edited plan invalidates its branches, because a plan is an
*input* to the derivation and not just a list of names — `deferred:`
annotations, wave membership and the plan's phase all decide what an answer
means. It is content-addressed by blob hash, so an edit is caught without
trusting a timestamp, and hashed once per plan rather than once per branch.

**Only a decided answer is terminal.** `-` means the question could not be
answered, and caching it would freeze one bad afternoon into every later pulse —
the 2026-08-17 outage multiplied by the life of the board rather than by the
branch count. `MERGED` and `CLOSED` are settled; `OPEN` and `NONE` are not.

**The board holds the map because the board is the only long-lived process.**
The scan is spawned fresh every pulse, so nothing inside it can span two — an
in-memory map in the scan would die before the pulse that could use it. The scan
receives the map in the *environment* and reports the map the next pulse should
hold on *stderr*, leaving stdout byte-identical to a run with no cache at all. A
served entry re-reports itself, so what arrives back is the whole map rather than
a delta the board would have to merge; merging would let an entry no scan
re-derived survive on nothing but its own age.

**It never touches disk and never outlives a process.** No file, no `.plot/`
state — a restart re-derives everything, and the map is adopted only on a scan
that succeeded, so a pulse killed at the 30 s timeout does not install the
partial map it had reached.

<!--
bumps:
  skills:
    plot: minor
    plot-fleet: patch
-->
