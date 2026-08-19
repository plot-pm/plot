# Brief: feature/the-agent-panel

Implement wave **Panel** of `docs/plans/2026-08-17-working-shows-the-agent.md`.
Read the plan first, especially section *3. The agent panel*.

## What the two earlier waves already shipped

This wave is mostly **assembly**. Both sources it needs are merged:

| Source | Where | Shipped |
|---|---|---|
| the log, on demand | `GET /api/worker-log?branch=…` (`index.ts:192`) | #239 |
| the question a worker waits on | the `waiting` row's note | #241 |
| pid | on the row, as the scan read it (`schema.ts` ~759) | earlier |
| worktree path | `worktrees: [{branch, path}]` (`schema.ts:247`) | earlier |
| the command that started it | `plot-config.sh get "Worker command"` | config |

Verified present before this brief was written. **Do not re-derive any of
them** — liveness is decided once, in `plot-worker-state.sh`, and the log
endpoint already resolves branch → worktree server-side.

## What to build

**One view, opened from a WORKING row**: pid, uptime, the command that started
it, branch, worktree, plan, and the live log.

**Model, context in use, and last activity come from the session transcript**
at `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`. Measured readable
2026-08-19: `"model":"claude-opus-5"` on assistant lines, alongside
`usage.cache_read_input_tokens` and `timestamp`.

**Read it defensively, and omit rather than guess.** This is a private format
that may change under the board. When a field is missing or unrecognised, the
panel simply shows less — no error, no placeholder, no last-known value.

The plan accepts this failure mode deliberately and the reasoning is
load-bearing: *a stale model name read from a field that moved would be
believed, while an absent one prompts a look at the transcript.* Checking a
`version` and reporting an unrecognised one buys an error message at the price
of a second thing to keep current, guarding fields that are conveniences rather
than facts anything depends on.

**The log is fetched, never pushed.** `/api/worker-log` exists precisely so the
pulse carries none of it. Do not add log content to `/api/fleet` or `/api/board`
— assert the pulse payload is unchanged.

**Uptime is derived from the pid's start time, not from a stored timestamp.**
A stored one survives the process it describes; when the worker is gone, uptime
is absent rather than frozen.

## Definition of Done

- A WORKING row opens a panel showing pid, uptime, command, branch, worktree, plan
- The log renders live from `/api/worker-log`, fetched on open
- Model / context / last activity render when the transcript is readable
- An unreadable or unrecognised transcript omits those fields silently — assert
  this, it is the wave's main risk
- A row whose worker has exited shows no fabricated uptime
- The pulse payload is unchanged — assert it
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not implement *Answer*, *Machine*, or *Registry* — later waves, and the
  sprint is deliberately read-only. **The panel acts on nothing.**
- Do not add capability fields; nothing records them
- Do not re-derive worker liveness or re-implement the log read
- Do not touch `plot-fleet-scan.sh` or `plot-worker-state.sh`

## Platform and machine notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

**A test must not race what it asserts.** Measured today: a timeout test used a
1 ms budget on a two-file repo, passed on macOS, and failed on CI where the
search finished inside the millisecond. If you assert a timeout, make the work
large enough that no runner can beat the budget.

**Other agents run on this machine.** If `test:board` gives connection-refused
failures, a sibling worktree's board server is the cause. Kill only servers you
started — `pkill -f board-server.mjs` matches every board on the machine
including the operator's, and it killed a live board twice today. Bind `PORT=0`
and record your own pid.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
