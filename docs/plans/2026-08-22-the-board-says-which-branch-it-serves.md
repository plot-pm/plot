# The board says which branch it serves

> With 22 worktrees on this machine, the board renders whichever artifact it was started from — and never says which. A stale-looking board and a broken board are indistinguishable.

## Status

- **Phase:** Released
- **Type:** feature
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `feature/the-board-says-which-branch-it-serves`
- **Delivered:** 2026-08-23
- **Released:** 2026-08-26, 2.9.0

## Approval

- **Assignee:** Jan Wloka

## Changelog

- The board header names the branch it is serving from, so a board opened against one worktree is no longer mistaken for a stale or broken board.

<!-- Board impact: board-only. Adds one field to `serverInfo` (packages/board/src/server/server-info.ts)
     and one element to the header (src/app/App.tsx). No plan-format, helper-script or
     docs/plans-layout change. Rebuild the artifact (pnpm build:board). -->

## Motivation

`pnpm board` serves the built artifact from the worktree it was started in. This
repo currently has **22 worktrees**, and a dispatched fleet routinely adds more.
Nothing on the page says which one is being served.

The failure this produces is not hypothetical and is recorded in this session's
own notes:

> **Board renders the checked-out branch** — old design after a branch switch is
> the artifact, not a regression; check `git branch --show-current` first.

The shape of the mistake: a reader opens the board, sees a layout or a behaviour
they know was changed, and concludes the change did not work. The change did
work — in a different worktree. Every symptom of *my fix is not live* and *I am
looking at another branch* is identical, and the page offers nothing to tell them
apart.

**This is orientation, not status.** The value is stable, changes rarely, and is
not something a reader acts on — so it belongs in the header beside the repo's
identity, not in a section that means work is in flight.

### What this is NOT

**Not the master agent's branch.** Those are two different facts and conflating
them is the trap this plan exists to avoid:

1. *Which branch the board is serving from* — `git branch --show-current` in the
   server's cwd. Always available, no new data source. **This plan.**
2. *Which branch the master agent is working on* — not recorded anywhere. The
   agent registry (`.plot/agents/`) holds **dispatched workers only**; measured
   2026-08-22, all 12 manifests are workers with their own worktrees, and
   `plot-dispatch.sh` is the sole writer. A session nobody dispatched has no
   manifest.

(2) additionally has no stable answer: `AgentEntry`'s own docstring records that
*"a branch is what an agent is working on, never what it is"*, and the master
agent switches branches constantly, so its `branch` would frequently and
correctly be `''`. It is a separate plan and should follow
`the-registry-knows-which-agents-live`, which is in flight.

## Design

### Approach

**Server:** `serverInfo()` already assembles the facts about the serving process
(port, board command, repo root). Add the branch there — one `git branch
--show-current` at startup, in the server's cwd.

**Client:** one element in the existing `<header>` in `App.tsx`, beside the
`Plot` title.

### The empty value is a real answer

`git branch --show-current` prints nothing on a **detached HEAD**, which is the
normal state for several worktrees here (`git worktree list` shows four detached
right now). Absent is not false — this repo's standing invariant.

So the field is `string`, `''` means *detached or unreadable*, and the header
renders **nothing** in that case rather than an empty chip or the word `unknown`.
A chip that sometimes says nothing teaches a reader to stop looking at it.

Do not fabricate a fallback: printing the short SHA instead would answer a
question nobody asked and would read as a branch name to anyone skimming.

### Read once at startup, not per request

The board process serves one worktree for its whole life — it cannot change
branch under itself, because `--watch` restarts the process on a rebuild rather
than re-checking out. So this is startup state, exactly like the port.

Re-reading it per request would put a `git` fork on a request path this repo has
spent measured effort keeping git-free (see `plot-fleet-scan.sh`'s cost work and
the note that the board's host consumers are PR and issue only).

### Not a status, and not coloured

`statusTone` is reserved for the two values a reader **acts on**. A branch name
is neither a problem nor a completion; it is context. Render it in the header's
muted secondary style — the same weight as other orienting text — so it does not
compete with the row states beneath it.

### Open Questions

- [ ] Should it also name the **repo root path** when the branch is `main`? Two
      worktrees can both be on `main` (this machine has one at
      `/Users/jwloka/…/plot` and detached copies elsewhere), so the branch alone
      is not always unique. Decide from whether the ambiguity is real in
      practice, not from completeness — a path in the header costs a lot of
      width, which the name-track work shows is already scarce.

## Done when

- The header names the branch the server was started on, asserted in a test that
  starts the board in a worktree with a known branch and reads the rendered text.
- A **detached HEAD** renders no branch element at all — asserted as absence, not
  as an empty string. A test that only checks the happy path passes an
  implementation that prints `unknown` forever.
- No `git` call is added to a per-request path; the branch is read once at
  startup. Assert by construction (where the value is computed), not by timing.
- `pnpm build:board` run and the artifact committed; `pnpm run test:board` green.

## Slices


### Named (Branch: feature/the-board-says-which-branch-it-serves, PR: #337)
- add the branch to `serverInfo`, render it in the header, and prove the detached case renders nothing

## Notes

Asked for as *"showing the master agent's branch name"*. The investigation found
the registry cannot answer that — it records dispatched workers only — and that
the question actually worth answering first is which worktree the board is
serving, which needs no new data source and fixes a confusion this session hit
directly.

The stronger form is deliberately deferred rather than dropped: see *What this is
NOT* above.
