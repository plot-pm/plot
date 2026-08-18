# Brief: bug/one-worker-state-not-two

Implement **wave 1 (One implementation)** of
`docs/plans/2026-08-18-finished-is-not-a-verdict.md`.

Read it first. **This wave changes no behaviour.** It collapses a duplicate so
that wave 2 can extend one implementation instead of two.

## The duplicate

The same worker-state logic exists twice:

| Where | What |
|---|---|
| `plot-dispatch.sh:136` | `worker_state()` — echoes `running <pid>` / `finished <pid>` / `ended <pid> (status unknown)` / `failed <pid> (exit N)` / `no worker` |
| `plot-fleet-scan.sh` (~line 444) | an inline copy — `printf`s tab-separated `running\t<pid>\t` / `finished\t<pid>\t0` / `ended` / `failed` / `none` / `elsewhere` |

Both read `$wt/.plot-worker.pid`, both reject pid `0` and non-numeric values
with the same comment about `kill -0 0` signalling the whole process group,
both `kill -0` for liveness, and both map `.plot-worker.exit` the same way.

They agree today. Wave 2 adds a seventh state, and adding it to one and not the
other would make two consumers report different verdicts about the same worker —
worse than either being wrong alone, because whichever a reader consults first
wins.

## What to build

**One source of truth, consumed by both.** The shape is yours to choose; the
plan does not prescribe one. Two obvious options:

- the scan sources `plot-dispatch.sh` and calls `worker_state()`
- the logic moves to a third script both source

Weigh them and say which you chose and why. Note that they differ in more than
style: sourcing `plot-dispatch.sh` pulls in everything else that file defines,
which may or may not be acceptable.

**The two call sites want different output shapes** — `plot-dispatch.sh`'s
prose (`running 1234`) and the scan's tab-separated fields (`running\t1234\t`).
That difference is real and must survive: `--status` prints one, the JSON
consumes the other. One computation, two renderings.

## Do not

- **Do not add `stalled`, the `TODO` marker check, or the temp-file filter.**
  Those are wave 2 and belong in the merged implementation. A wave that both
  merges and extends cannot be reviewed for either.
- **Do not rename the six states or change their meanings.** `running`,
  `finished`, `failed`, `ended`, `none`, `elsewhere` stay exactly as they are.
- **Do not touch `plot-fleet-scan.sh` beyond the worker-state block.** Two other
  branches hold that file right now — merge detection (~558/621) and plan
  enumeration (~121/134/270). Your change is the block around line 444.

## Definition of Done

- One implementation; the other call site consumes it
- A test driving **both** consumers from one fixture and asserting they agree
  across all six states — that agreement is the whole point of this wave
- `plot-dispatch.sh --status` output is byte-identical to before for each state
- `plot-fleet-scan.sh --json` worker fields are byte-identical to before
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**; concurrent runs were measured producing false
  timeout failures that do not reproduce serially
- A changeset with a `bumps:` block

## Platform note

CI runs Linux; you are probably on macOS. Two faults were caught this way today:
`stat -f` does not fail cleanly on GNU (it prints to stdout and *then* exits 1),
and `/usr/bin:/bin` is not an isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
