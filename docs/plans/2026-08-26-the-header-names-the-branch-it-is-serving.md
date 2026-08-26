# The header names the branch it is serving

> The Agents tab's *Master Agent* row shows the branch the board is serving,
> instead of rendering nothing where a fact belongs.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- The Master Agent row names the branch again. `masterAgentBranch` returns empty
  inside the running server while its own derivation returns the branch when run
  standalone.

## Motivation

Reported by a reader on 2026-08-26: *"I wonder why the master agent's branch is
not shown?"*

`/api/fleet` reports `masterAgentBranch: ""`. It should report
`bug/a-head-counts-its-own-waves` — the branch the main checkout is on.

### Every step works in isolation

Measured 2026-08-26, running the server's own code standalone from the board's
own cwd:

```
git worktree list  → first line is the main checkout      ✓
/^(\S+)\s/ on it   → /Users/jwloka/Quatico/…/plot          ✓
git branch --show-current there → bug/a-head-counts…       ✓
```

And the surrounding facts:

- `PLOT_REPO_ROOT` unset, so `repoRoot` is the server's cwd — the directory the
  derivation was tested in
- the cache TTL is 5 s, far too short to explain a persistent empty
- the artifact is fresh and contains the call (`masterAgentBranch:hw(e.repoRoot)`)
- **a clean restart did not change it**

So the function returns empty *inside the process* and non-empty outside it, and
the difference has not been found. **That is the plan: find it.**

### What was ruled out, so nobody repeats it

- **Staleness** — a clean restart still reports `""`
- **A stale cache** — 5 s TTL
- **`PLOT_REPO_ROOT` pointing elsewhere** — unset
- **A stale artifact** — rebuilt, no diff, call present
- **The regex** — tested against the real `git worktree list` output
- **A detached board worktree** — it WAS detached, which is a real and separate
  problem now fixed (the worktree tracks `origin/main` as `board-main`), and
  fixing it did not fix this

## Design

### Instrument before theorising

Five hypotheses were tested and eliminated by measurement. The sixth will not be
found by reading either — the next step is to make the running server say what
it sees: log `repoRoot`, the first line of `git worktree list`, the regex match,
and the `git branch --show-current` result, once, at startup.

**Do not fix it before it is reproduced.** A change that makes the value appear
without explaining why it was empty is a change nobody can trust — and this
field has a nearby precedent for that: `tiny-garden shares the parent .git`,
where `git branch --show-current` returned the suite's own branch rather than
the fixture's.

### A hypothesis worth testing first

The board runs under `node --watch`, which spawns a **child** process. If the
child's cwd or environment differs from the parent's — or if `execFileSync`
inherits something unexpected — the derivation could see a different repo than
the shell does. That is testable from the instrumentation above and is the
cheapest thing to check.

### The empty value must not be silent either way

Whatever the cause, an empty branch is currently indistinguishable from *the
board did not look*. This is the story's own subject: a blank that reads as a
fact. Where the branch genuinely cannot be determined, the row should say so.

## Waves

### Found (Branch: bug/the-header-names-its-branch)

Instrument the derivation, reproduce the empty value inside the server, fix the
cause, and say in this plan what it was.

## Done when

1. **The cause is named in this plan.** Not "it works now" — what differed
   between the process and the shell.
2. The Agents tab's Master Agent row shows the branch the main checkout is on.
3. **A detached main checkout still renders something honest** — the row says
   the branch could not be determined rather than rendering blank. Absent is not
   a fact.
4. A regression test covers the derivation at the level the bug lives at — if it
   is process-level, a unit test over the pure function will not catch it, and
   the test must reach further.
5. `pnpm run test:board` green; artifact rebuilt and committed.

## Notes

### Time spent before writing this

Roughly twenty minutes of live debugging, mid-sprint, with five hypotheses
eliminated and none confirmed. Recorded because the next person should start
from the instrumentation rather than re-running those five.
