# Brief: feature/a-terminal-branch-is-asked-once

Implement the *Cadence* wave branch of
`docs/plans/2026-08-18-the-scan-asks-once-not-once-per-branch.md`.
Read the plan first. Wave 1 (`bug/the-scan-joins-one-pr-list`, #232) is merged.

## The measurement

Taken on this repo 2026-08-19, after #232 landed:

| Branch state | Count |
|---|---|
| merged | 23 |
| deferred | 3 |
| open | 18 |
| in progress | 10 |
| **terminal (merged + deferred)** | **26 of 54 — 48%** |

The board refreshes every 5 s (`packages/board/src/server/fleet.ts:45`) and a
full scan takes 18.3 s. Nearly half that work asks about facts **that cannot
change**: a merged branch stays merged, a deferred one stays deferred.

(The plan cites 56 of 84 from 2026-08-18. The repo has since been cleaned up;
the ratio held, the absolute numbers did not. Use the numbers above.)

## What to build

**Branches in a terminal state are asked about once and cached; live ones are
re-derived every pulse.**

Terminal means `merged`, `deferred`, and branches of `Released` plans.

**The cache is a derivation, not a record — and that distinction is the whole
design.** It is validated against git on **every** pass and discarded the
moment git contradicts it:

- a merged branch whose ref reappears → re-asked next pulse
- an edited plan → its branches' cached answers invalidated
- a new commit → not terminal, never cached

**Only the host call is skipped.** Git is still consulted every pass; what the
cache saves is the network round-trip, which is the expensive half. A cache
that also skipped git would be a record of the past rather than a derivation of
the present, and Manifesto Principle 1 (git is the database) rules that out.

**The cache never outlives the process.** A restart re-derives everything. No
file, no `.plot/` state — an in-memory map only. A cache that survives a
restart is a second source of truth about a repo whose only source of truth is
git.

## Definition of Done

- A merged branch costs one host call across many pulses
- A merged branch whose ref reappears is re-asked on the next pulse
- An edited plan invalidates its branches' cached answers
- A live branch is never cached — assert this
- The cache never outlives the process; a restart re-derives everything
- A scan with a fully-warm cache returns byte-identical output to a cold one
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not persist the cache to disk in any form
- Do not skip the git validation pass to save more time — that is the line
  between a derivation and a record
- Do not implement partial rendering or per-host refresh cost — those are the
  sibling branches `feature/the-board-renders-what-has-arrived` and
  `bug/the-cadence-knows-what-a-refresh-costs`

## Platform and machine notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

**Other agents are running on this machine.** If `test:board` gives you
connection-refused failures, a sibling worktree's board server is the likely
cause. Kill only servers you started — `pkill -f board-server.mjs` matches
every board on the machine including the operator's, and doing that killed a
live board twice today. Bind `PORT=0` and record your own pid.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
