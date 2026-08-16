## Implementation brief — board-ui-polish

- **Plan (canonical):** `docs/plans/2026-08-16-board-ui-polish.md` — **on this
  branch**, not on `main`. The plan rides the work branch (`Impl: same branch`).
- **Approved:** 2026-08-16, jwloka, in-session
- **Branch:** `feature/board-ui-polish` (base: `main`, already current)
- **Ends as:** **one PR** carrying plan *and* code — do not open a separate
  plan PR, and do not merge anything yourself.
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

Read `docs/plans/2026-08-16-board-ui-polish.md` in full first. It was walked
through in session and several decisions reversed an earlier draft — the
reasons are written down, and each one has a test behind it in *Done when*.

Four changes to the Agents tab, all in `packages/board/**`:

1. **Both footer ages gain a countdown** — `scanned 1s ago · next in 3s` and
   `PR data 74s ago · next in 46s`.
2. **Rows group by plan inside each waiting-group**, `DONE` included.
3. **Every link goes where its text says** — branch name → the branch on the
   host, `PR #<n>` → the pull request. `green` stays plain text.
4. **Clicking a plan opens `PlanModal` in place**, and the modal gains a
   "Show in board" button that lands on the highlighted card.

### The four traps, each of which has a test

**Do not guess the PR interval.** The payload has `prAgeSeconds` and no
interval; `PR_REFRESH_MS` is 60 s with backoff to 120 s. A client assuming 60 s
counts to zero and sits there through a backoff — rendering *"I don't know"* as
*"any moment now"*. Add the optional field, and when it is **absent show no PR
countdown at all**.

**Do not derive the branch URL from the PR URL.** It only works for rows that
have a PR, and `not-started` / `quiet` / claims are exactly where "go look at
the branch" is most useful. Read `git remote get-url origin` once per board
read — not per row — and pick the host's branch form (`/tree/` on GitHub,
`/branch/` on Bitbucket). An unrecognised origin means **plain text**, never a
guessed URL shape.

**A merged branch gets no branch link.** Its remote page is gone. This file
already has the rule — a missing address means plain text rather than an
invented one — follow it.

**The story filter alone is not the feature.** `plot-board` has nine plans, so
filtering still leaves the reader scanning a column. The button must also put
`?plan=<slug>` in the URL (same `writeList`-style sync the story/sprint filters
use) and scroll the matching card into view with a highlight ring. A `?plan=`
matching nothing is **ignored** — render the board normally rather than an
empty filtered column, which reads as "this story has no plans".

### Done when

The plan's *Done when* list is the specification — work through it literally.
It names the assertions that matter, including several that a naive test would
pass vacuously (e.g. asserting the branch link and the PR link have *different*
targets: today they are the same one on the wrong word, so "a link exists"
proves nothing).

Plus:

- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
  `pnpm run validate` all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff, and
  a missing rebuild fails the build. **Build in THIS worktree**; a rebuild
  elsewhere leaves this one stale and the failure looks exactly like a broken
  feature.
- A changeset is present.

### Scope guard

`packages/board/**` and the built artifact only. Do not touch
`skills/plot/scripts/*.sh` — the branch-URL work reads the git remote from the
board's own server code, not by changing a helper script. If you find something
the plan did not anticipate, report it rather than improvising outside scope.

### Verify by running, not by reading

Start the built board and look at the Agents tab before you call it done —
today a rebuild in the wrong worktree made a working feature look broken, and
only running it exposed that. The plan's claims are all observable: the
countdowns tick, the groups have plan sub-headings, the links point where their
text says, the button lands on a highlighted card.
