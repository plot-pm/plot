# Brief — bug/a-held-branch-is-not-idle

**URGENT: the board is currently useless to its operator.** It reports
`WORKING: none — nothing to do, just look` while four agents edit files in four
worktrees, and offers three of their branches as *"eligible — nobody has taken
it"*. Fix the two defects below and nothing else.

Governing plan: `docs/plans/2026-08-20-a-held-branch-says-who-holds-it.md`.
This branch covers findings 1 and 2 of it (the scan fact and what the board
says). **Do not** touch the link finding or the dispatch gate — separate
branches.

## The diagnosis is already done. Verify it, then fix it.

Two compounding bugs make a working agent invisible.

### Bug 1 — `local_ahead_of` returns 0 for a branch that was never pushed

`skills/plot/scripts/plot-fleet-scan.sh:1232`:

    git rev-list --count "refs/remotes/origin/$1..refs/heads/$1"

For a never-pushed branch `refs/remotes/origin/<branch>` does not exist, so
`rev-list` exits non-zero and the function returns `0`. Reproduced:

    $ git rev-parse --verify -q refs/remotes/origin/feature/design-is-a-phase
    (nothing — no such ref)
    $ git rev-list --count refs/remotes/origin/feature/design-is-a-phase..refs/heads/feature/design-is-a-phase
    fatal: ambiguous argument ... unknown revision

The `else` branch's comment says *"No local ref, no upstream, or an unreadable
ref database. Not observed → not reported."* That reasoning is right for an
unreadable database and wrong for **no upstream**: a local branch with no remote
ref is not unobserved, it is entirely unpushed, and every one of its commits is
ahead. Distinguish the cases:

- local ref missing, or ref database unreadable → `0`, unchanged.
- local ref present, **no** `origin/<branch>` → count against the *default
  branch* (`refs/remotes/origin/<main>`), because every commit since main is
  unpushed. Use the main name the script already resolves; do not hardcode.
- both refs present → today's count, byte-identical.

Keep returning a bare integer on stdout — callers parse it as a number.

### Bug 2 — the board only counts a dirty tree as working

`packages/board/src/server/fleet.ts:2194`:

    if (localDirty || localLocked) {
      return workingLocally(localDirty, 0, localLocked);
    }

The comment above it says `local_ahead` is *deliberately* excluded, because
"unpushed commits are finished work sitting still; they earn the unpushed mark,
not a claim that someone is at the keyboard."

**That reasoning holds for a branch with a ref and fails for one without.** This
arm is the `open` case — git has no ref for the branch at all. Here unpushed
commits are not "finished work sitting still", they are *the only evidence the
branch exists*. A worktree holding commits nobody else can see is held, and the
alternative reading the board currently prints is *"nobody has taken it"*, which
sends a second agent onto finished work.

So in **this arm only**, `localAhead > 0` must also mean working. `localAhead` is
already plumbed to this point — see `localAhead: b.local_ahead` at `:1331` and
its use at `:2471` / `:2500`. Pass the real value instead of the hardcoded `0`,
so `workingLocally` can render *"N commits not pushed locally"*, which it already
does correctly.

**Do not change the `local_ahead` exclusion at `:2471` or `:2500`.** Those arms
describe branches that DO have a ref, where the original reasoning still applies.
Only the no-ref arm changes.

## What the board must say afterwards

- A worktree with commits and a clean tree → **WORKING**, noting the unpushed
  commits. Not `eligible — nobody has taken it`.
- A dirty worktree → WORKING, exactly as today.
- A branch with no worktree and no ref → unchanged, genuinely not started.

Verified reality to test against, measured 2026-08-20:

| worktree | dirty | ahead | must read |
|---|---|---|---|
| `reconcile-advisory` | 0 | 1 | working |
| `row-verdict` | 0 | 1 | working |
| `design-is-a-phase` | 2 | 0 | working (dirty, as today) |

## Tests

- `plot-fleet-scan.sh`: a branch with a local ref and no remote ref reports its
  full commit count, not 0; a branch with both refs is unchanged; a branch with
  no local ref still reports 0. Add to `test/reconcile/fleet.test.mjs`.
- `fleet.ts`: in the no-ref arm, `localAhead > 0` with a clean tree groups
  `working` and notes the unpushed commits; `localAhead === 0` with a clean tree
  is unchanged; a dirty tree is unchanged; the arms at `:2471`/`:2500` are
  unchanged. Add to `packages/board/test/unit/fleet.test.ts`.

## Definition of Done

- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green
- `pnpm build:board` run in THIS worktree, artifact committed
- a changeset with a `bumps:` block — `@plot-pm/board: patch` and `plot: patch`
- use `trash`, not `rm`

## Hazards

- Several suites are running in sibling worktrees. If a board test fails,
  re-run that file alone before believing it — contention starves tests rather
  than breaking them. Wait on your own PID, never `pgrep` by name.
- Do not touch sibling worktrees: `plot-wt-row-verdict`,
  `plot-wt-design-is-a-phase`, `plot-wt-reconcile-advisory`,
  `plot-wt-no-ref-join`.
