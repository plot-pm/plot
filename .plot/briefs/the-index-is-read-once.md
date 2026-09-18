## Implementation brief — the-index-is-read-once (wave: The index is read once)

- **Plan (canonical):** `docs/plans/2026-09-17-the-index-is-read-once.md` on `main`
- **Approved:** 2026-09-18, jwloka, in-session
- **Branch:** `bug/the-index-is-read-once` (base: `main`)
- **Ends as:** one PR to `main`

Read the plan. It carries measurements you do not need to retake, and four
correctness rules a panel found by building fixtures. **Those four are the
work** — the speedup falls out of any correct implementation.

### What to build

`plot-reconcile-scan.sh:681` answers *does a symlink in this index point at this
plan?* by walking the whole directory and forking `readlink` + `sed` per link.
It is called twice per plan at `:712-713`. Over 297 plans and 366 links that is
**over 130,000 forks per sweep**.

Resolve both index directories **once per run**, before the plan loop, and
answer `in_active`/`in_delivered` from that with **no per-plan fork** — including
`basename` at `:711`, which is 297 forks the loop also pays. Use `${f##*/}`.

`ls -l "$dir"/*.md` is one fork for a directory and was measured at 0.081–0.529 s
for all 366 links, against 13.7 s for 366 separate `readlink` forks.

### THREE walkers, not one

A Done-when phrased around the *function* would leave two behind:

| site | what it walks | forks |
|---|---|---|
| `:681` (`symlinked_from`) | both dirs, per plan | >130,000 |
| `:1102` (section 4) | `active/`, inline `readlink \| sed` | ~170 |
| `:844` (section 5, dangling) | both dirs | ~366 |

Serve all three from the one index, **or say in the PR why a site cannot be**.

### Four rules the panel established — each needs a fixture test

1. **`*.md` IS A FILTER.** `symlinked_from` globs `"$1"/*.md`, so a link whose
   NAME does not end `.md` is invisible whatever it points at. A bare
   `ls -l "$dir"` applies no filter and answers *linked* where the current code
   answers *not linked* — changing `index_drift=` and, where the phase
   disagrees, emitting a **new section 1 drift row** naming a non-index path.
   `docs/plans/active/` holds `.omc`, so the directories are demonstrably not
   curated. Fixture: a non-`.md` link to a plan.
2. **FIRST match wins.** The function returns the first glob match and stops.
   Three plans here carry two links each — `a-refused-dispatch-asks-for-a-brief`,
   `an-idle-agent-is-not-a-stalled-one`, `the-board-says-slice`. Build the index
   first-wins (`[ -n "${IDX[$t]:-}" ] || IDX[$t]=$l`), never last-wins. All three
   are `delivered` with links in `delivered/` and therefore **not in drift**, so
   a byte-identity diff would pass while the index was wrong. Fixture: two links
   to one plan.
3. **The LINK PATH is printed, not a boolean.** Section 1's `fix:` names the link
   file. An index keyed only by target loses *which link*.
4. **`ls -l` over two directories prints structure**: two headers, two `total 0`
   lines, a blank separator — 371 lines for 366 links. Keying on `*" -> "*` skips
   all five naturally, but **which directory a link came from must then come from
   the header**, not the line. The two indexes answer different questions.

### What must not change

`in_active`/`in_delivered` feed section 1 (phase/symlink drift, **above**
`== blocking sections end ==`, what `/plot-deliver` step 7b greps) and section 9
(`index_drift=`, convenience). **Section 5 is NOT a consumer** — its dangling
loop at `:844` reads the directories itself.

Diff a full sweep before and after: sections 1, 4, 9 byte-identical.

### Counts: re-measure, do not trust these

297 plans, 85 `active/` links, 281 `delivered/`, all resolving, zero dangling —
**measured 2026-09-17 and already stale by two within the day.** Take your own
on the day and pin those.

### Repo gates

`nvm use` first (pnpm crashes on Node 26). `pnpm run test:contracts` must pass.
Add a changeset. **Do not run `pnpm run test:e2e`** — that is CI's gate.
