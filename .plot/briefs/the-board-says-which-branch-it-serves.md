## Implementation brief — the-board-says-which-branch-it-serves (wave: Named)

- **Plan:** `docs/plans/2026-08-22-the-board-says-which-branch-it-serves.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `feature/the-board-says-which-branch-it-serves` (base: `main`)
- **Ends as:** one PR to `main`

Independent — nothing blocks you, you block nothing, and no other in-flight
branch touches `App.tsx` or `server-info.ts`.

### What to build

**The board header names the branch it is serving from.**

`pnpm board` serves the artifact built in whichever worktree it was started in.
This repo has **22+ worktrees**. A reader who opens the board, sees a layout they
know was changed, and concludes the fix did not work is looking at another
branch's artifact — and the page offers nothing to tell those two apart.

### The decisions the plan settles — do not re-derive them

**`serverInfo()` is where it goes**, beside the port and the board command. One
`git branch --show-current` in the server's cwd.

**Read ONCE at startup, never per request.** The process serves one worktree for
its whole life. A `git` fork on a request path is what this repo spent measured
effort removing.

**A detached HEAD renders NOTHING.** `--show-current` prints empty for a detached
worktree — several here are. `''` means *detached or unreadable*, and the header
shows no element rather than an empty chip or the word `unknown`. **Do not
fabricate a short SHA**: it answers a question nobody asked and reads as a branch
name to anyone skimming.

**Not coloured.** `statusTone` is for the two values a reader acts on. A branch
name is context — muted secondary weight, so it does not compete with the row
states below.

### Done when

The plan's `## Done when` is the specification. Beyond it:

- A **detached HEAD** renders no branch element — asserted as **absence**. A
  happy-path-only test passes an implementation that prints `unknown` forever.
- No `git` call on a per-request path — assert by construction, not by timing.

Plus: `nvm use` (Node 24), `pnpm run test:board` green, `pnpm build:board` with
the artifact committed, a changeset, `trash` not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line on `main` when the PR exists. **Push
your first commit as soon as it exists, and run every test in the FOREGROUND** —
several workers stalled today awaiting a notification a `-p` run never receives.

### Scope guard

`App.tsx` and `server-info.ts`. **Not** the master agent's branch — that is a
different fact with no data source today, and the plan's *What this is NOT*
section explains why. Do not build it.

**Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.**
