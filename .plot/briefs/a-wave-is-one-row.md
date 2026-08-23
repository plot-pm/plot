## Implementation brief — the-wave-is-a-thing-the-board-can-hold (wave 2: One row)

- **Plan (canonical):** `docs/plans/2026-08-23-the-wave-is-a-thing-the-board-can-hold.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `bug/a-wave-is-one-row` (base: `main`)
- **Ends as:** one PR to `main`

**This is the pivot of the 2.9.0 sprint.** Wave 1 (`feature/the-classifier-is-total`,
PR #334) merged and recorded the baseline. Waves 3 and 4 — six branches across
three plans — are blocked until this lands.

### What to build

**A wave renders as exactly one row, in exactly one section.**

Two clauses, at two levels, and keeping them apart is what makes this
implementable:

> **A plan may appear in several sections — but only as ONE row per section.**
> **A wave may appear in only ONE section — as one row.**

The plan clause **already holds and must keep holding**: 43 `(plan, section)`
pairs render today and 4 plans span more than one section, each with a single
head where it appears. A plan legitimately has work in several states.

### The decisions the plan settles — do not re-derive them

**A wave is where its UNFINISHED work is.** A wave with any unmerged branch is
not done, whatever its merged branches say. `every-section-has-one-subject /
Inverted` — one branch merged, one open — goes to NOT STARTED, and DONE does not
claim it.

**A wave's section is a function of its VERDICT and its plan's PHASE, and of
nothing else.** The verdict already aggregates every branch; consulting an
individual branch's `state` is exactly what places a wave twice.

**The measurement, and it decides the cost question:**

```
waves rendering as >1 row:   14 of 82
rows they occupy:            38  →  14
board total:                106  →  82   (-23%)
```

**13 of those 14 are internally uniform** — every branch in one state, one group
— so their extra rows are pure repetition. The 14th (`Inverted`) is the mixed
case and the whole problem in miniature.

**The collapsed row must not buy density with accuracy.** It now speaks for
several branches, so it states the count and says when they disagree. A row
reading plain `merged` for a half-open wave is the same lie in fewer rows.

**A plan with six genuine waves in one section still renders six rows**
(`working-shows-the-agent` / done). **The rule removes repetition, never waves.**

### Done when

The plan's `## Done when` is the specification. Beyond it:

- Rendered wave rows equal distinct `(plan, wave)` pairs. The live board has 14
  waves in 38 rows, so this **fails loudly today**.
- `Inverted` appears **once**, in NOT STARTED.
- **A plan still renders one head per section it has work in.** Assert on the 4
  plans that span sections: each keeps a head in each. This is the clause an
  over-eager reading of *one row* would break, collapsing a plan into one section
  and hiding the rest.
- A collapsed row states its branch count and any disagreement.
- **Wave 1's xfails move.** `every wave has EXACTLY ONE section` asserts 81/82
  today; this makes it 82/82 and **the test will fail until you raise the
  number** — in this commit, deliberately. Same for `eligible => no branch
  merged` (19/20 → 20/20).

Plus the repo's gates: `nvm use` (Node 24), `pnpm run test:board` green,
`pnpm build:board` with the artifact committed, a changeset, `trash` not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line on `main` when the PR exists.
**Push your first real commit as soon as it exists, and run every test in the
FOREGROUND** — three workers stalled today by ending a turn awaiting a
notification that a `-p` run never receives.

### Scope guard

You own the wave-to-section placement and the collapsed row. **Not** the `Wave`
contract type (wave 3, `feature/the-contract-carries-a-wave`), **not** DONE's
membership filter (wave 4).

`AgentList.tsx` is held by several in-flight branches — keep the diff minimal.

**Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.**
Never `git add -A` in this worktree.
