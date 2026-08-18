# Brief: feature/the-worker-log-is-readable

Implement wave **Log** of `docs/plans/2026-08-17-working-shows-the-agent.md`.
Read the plan first, especially section *1. The log travels*.

## Why this needs no new field

The log path is **derived, not carried**: `<worktree>/.plot-worker.log`, and
the board already knows the worktree — `worktrees: [{branch, path}]` is on the
row today (`packages/board/src/contract/schema.ts:247`). So a WORKING row can
offer its log without a single new field crossing the wire.

Nothing serves it yet. The only mention in the board is a comment in
`packages/board/src/server/dispatch.ts:132`.

## What to build

**Served on demand, never pushed with the pulse.** The plan is explicit: a 4 s
pulse carrying every agent's console output is a different product. The row
links; the fetch happens when a person asks.

A new read-only endpoint beside the existing ones in
`packages/board/src/server/index.ts` (see `/api/fleet` at line 131 for the
shape), and a WORKING row that offers it.

**The path is derived on the server, never taken from the request.** A client
supplying a path is a file-read primitive pointed at the whole filesystem. The
request names a **branch**; the server resolves that branch to a worktree it
already knows about from the pulse, and reads `.plot-worker.log` inside it.
A branch with no known worktree is a 404, not a read attempt.

**Bound what is returned.** A worker log grows without limit and a 60 MB
response helps nobody. Return the tail, and say that is what it is — a
truncated log presented as whole is the same defect this board keeps fixing.
Choose the bound and say why in the changeset.

**Absence is not emptiness.** No log file, an unreadable one, and an empty one
are three different answers. Do not collapse them into a blank panel.

## Definition of Done

- A running worker's log is fetchable by branch and rendered from a WORKING row
- The path is derived server-side; no request-supplied path reaches the filesystem
- A branch with no worktree, no log, and an empty log give three distinct,
  stated answers
- The response is bounded and says so when it truncated
- The pulse payload is unchanged — assert this, it is the point of the wave
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not push log content in `/api/fleet` or `/api/board`
- Do not add a log field to the row contract — the worktree path is enough
- Do not build the agent panel (pid, uptime, command in one view); that is the
  sibling branch `feature/the-agent-panel` and it will consume this endpoint
- Do not touch `plot-fleet-scan.sh` or `plot-worker-state.sh`

## Platform note

CI runs Linux; you are probably on macOS. Run the suites one at a time —
concurrent runs were measured producing false timeout failures that do not
reproduce serially.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
