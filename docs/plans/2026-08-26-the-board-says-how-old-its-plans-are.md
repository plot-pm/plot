# The board says how old its plans are

> The fleet view reads `origin/main`; the plan cards read the working tree. One
> board, two ages, and nothing says so.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- The board reports how far behind its checkout is, so a plan card cannot
  silently disagree with the fleet rows beside it.

## Motivation

### Measured 2026-08-26, twice in one session

The board worktree fell **33 commits** behind `main`, was pulled forward, and
had accumulated **23 more** within the same working session.

While it was behind, the board rendered:

```
PLAN  a-closed-sprint-says-what-it-achieved   Phase: Draft   Approved: (empty)
```

for a plan that read `Phase: Approved` with a filled `Approved:` record on main
and in the very worktree the panel named. The Agents tab said *"plan not
approved yet — still in review"* about four plans approved minutes earlier.

**Nothing on the board said it was reading old files.** The rows were confident
and wrong, which is the failure this sprint's story is named for.

### The two halves have different sources

This is not slow refresh. The board has **two sources of truth with different
freshness**, and only one of them is refreshed by anything:

| what | source | current? |
|---|---|---|
| fleet rows, waves, verdicts | `plot-fleet-scan.sh` reading **`origin/$MAIN`** | yes — it fetches |
| plan cards, phase, records | `collectPlanFiles()` → `path.join(repoRoot, planDir)`, a **filesystem read** | only if someone pulled |

`board.ts:126` walks the working tree. `plot-fleet-scan.sh` derives from a git
ref it refreshes itself. So a stale checkout produces a board whose wave rows
are correct and whose plan cards are days old — **disagreeing with each other on
one screen**.

### Nothing pulls the worktree

```
"board": "node --watch skills/plot/scripts/board/board-server.mjs"
```

`pnpm board` starts a server. It does not fetch, does not pull, and does not
check. The worktree tracks `origin/main` (`board-main`), so `git status` would
say *behind by N* — and nobody runs `git status` on a directory they only ever
serve from.

**Every push widens the gap** while the board keeps answering.

### Why a phase is the worst field to be stale about

A stale `Phase: Draft` is not a cosmetic lag. It is the field every lifecycle
decision reads: whether a plan can be dispatched, whether a wave is startable,
whether `/plot-approve` will refuse. An operator reading *"still in review"*
about an approved plan concludes the approval failed and re-runs it.

Measured this session: that reading was acted on — the board was restarted, the
approval was re-verified against main, and the cause turned out to be a
directory nobody had pulled.

## Design

### Report the age; do not fix it silently

The board says how far behind its checkout is, and stops there.

**An auto-pull was considered and rejected.** A server that pulls is a server
that can move a checkout out from under a worker: `plot-board/` is a real
worktree on a real branch, and `node --watch` restarts on file changes — so a
pull mid-session restarts the server (which is exactly what produced the hung
modal in [[a-dead-fetch-is-not-a-slow-one]]). Reporting is honest and cannot
break anything; pulling is a write nobody asked for.

### What "behind" means, precisely

`git rev-list --count HEAD..origin/<main>` against the **already-fetched** ref.
The board must NOT fetch on the request path — that is host latency on a 5 s
cadence, the cost `a-stale-ref-outranks-the-host` was built to avoid. The fleet
scan already fetches on its own timer; read what it left behind.

So the number may itself be slightly stale, and that is acceptable: it is a
lower bound on the drift, and a lower bound above zero is the whole signal.

### A detached HEAD is a different answer, not zero

The board worktree was found **detached** earlier in its history, and a detached
checkout has no upstream to be behind. That must read as *cannot say* — never as
*up to date*. Same rule `plot-board-probe.sh` applies to `auth`: an
unrecognisable state degrades to unknown, never to fine.

### Not chosen: read plans from `origin/main` like the scan does

Tempting, and it would remove the disagreement at its root. Rejected for this
plan's scope: the board renders plan files as documents (`/plan/<file>`), edits
are expected to be visible immediately during authoring, and reading a ref would
make an unpushed local edit invisible on the board that is showing it. That is a
larger design change than reporting an age, and it trades one surprise for
another.

Worth revisiting if the disagreement recurs after this lands.

## Waves

### Aged (Branch: bug/the-board-says-how-old-its-plans-are)

The board reports its checkout's distance from `origin/<main>`, and says
*cannot say* where there is no upstream to measure against.

## Done when

1. **A board serving a checkout N commits behind says so**, with N. Asserted at
   N > 0 against a fixture, not against this repo's live state.
2. **A current checkout says nothing** — no badge, no banner. A permanent
   ornament reading "0 behind" is noise, and the signal must be the exception.
3. **A detached HEAD reads *cannot say*, not *up to date*.** This is the
   assertion a naive implementation fails: `rev-list HEAD..origin/main` on a
   detached checkout can return 0 and read as current.
4. **No fetch joins the request path.** Asserted by the existing no-network
   test; the count comes from the ref the scan already refreshed.
5. **The board does not pull.** It reports; it never writes to the checkout.
6. `pnpm run test:board`, `pnpm run typecheck` green.

## Notes

### It was misdiagnosed twice before it was measured

Both times the symptom was read as refresh lag — first as the ~18 s scan
cadence, then as a slow first pulse. Neither was true: the files on disk were
old, and no amount of waiting would have changed them.

What made it hard to see is that **the board was half right**. The fleet rows
were correct and current, so the board did not look broken; it looked like one
field was wrong. A wholly stale board would have been obvious.

### The same shape, a fourth time today

`a-degraded-scan-says-why`, `the-adapter-checks-the-cli-it-got` and
`the-header-names-the-branch-it-is-serving` all turn on the same thing: **a
failure given the same value as a legitimate answer.** A stale phase is not a
failed read — it is a successful read of the wrong file, and it produces a
plausible lifecycle state nobody can tell from a true one.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Is the stale plan card refresh lag or something else?",
      "a": "Neither — the board has two sources: the scan reads origin/main and refreshes itself, while board.ts:126 reads the working tree, which nothing pulls",
      "category": "technical"
    },
    {
      "q": "Should the board pull itself current?",
      "a": "No — it is a real worktree under node --watch, so a pull restarts the server mid-session; report the age instead",
      "category": "tradeOffs"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": false, "architecture": true, "implementation": true },
    "domain": false,
    "ux": { "happyPath": true, "edgeCases": true, "errors": true, "accessibility": false },
    "nonFunctional": { "security": false, "performance": true, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
