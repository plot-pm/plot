# Brief — bug/the-panel-names-the-working-process

Wave 1 of `docs/plans/2026-08-20-the-agent-panel-shows-the-agent.md`. The other
five branches wait on this one: fixing the pid is what gives the live log
something to show, so do **not** widen into them.

## The measurement, already taken

The Agent panel for `bug/the-scan-walks-history-in-one-call` reported:

    PID 58282   STATE running   UPTIME 7m   CONTEXT 114k tokens
    The log is empty — the worker has started and written nothing yet.

`ps -p 58282` reports **`plot-dispatch.sh --max 1 …`** — the dispatcher. The
agent was **5501**, a `claude -p "You are implementing the branch …"` process.

`.plot-worker.log` is **0 bytes in all four live worktrees** while their agents
have been running for minutes.

## Where it comes from

`plot-dispatch.sh:764-766` backgrounds a wrapper and records **its** pid:

    ( cd "$wt" && … nohup sh -c '( '"$cmd"' ); rc=$?; …' \
        >"$log" 2>&1 </dev/null & echo $! >"$wt/.plot-worker.pid" )

`$!` is the `sh -c` wrapper. The redirect is correct — output written to stdout
would land in the file. It is empty because `claude -p` writes its transcript
elsewhere and emits nothing on stdout until it exits.

So two facts are wrong on the panel and one message is misleading:

1. the pid names the wrapper, not the agent
2. the polled log is the wrapper's stdout, which stays empty by construction
3. *"the worker has started and written nothing yet"* is true of the FILE and
   false about the AGENT

## Scope

- **Record the agent's pid.** The wrapper knows its own child. Prefer having the
  wrapper write the pid after launching, over guessing from a process tree —
  a `pgrep` by command string is the failure this repo has already recorded
  (`wait on your own PID, not a process name`).
- **Keep the wrapper's pid too if it is still needed** for exit detection —
  `.plot-worker.exit` is written by the wrapper and that must keep working.
  Two pids with two names beats one pid with the wrong meaning.
- **`plot-worker-state.sh` is the ONE answer** to "is a worker running in this
  worktree" and is *sourced*, not run, by both `plot-dispatch.sh` and
  `plot-fleet-scan.sh`. If the pid's meaning changes, it changes there.
- **The empty-log message states the tool's behaviour**, not a claim about the
  worker: something like *"claude -p writes its transcript on exit — nothing to
  show until then"*. An absence of output is not evidence of an idle agent, the
  same rule the fleet scan applies to a host it cannot reach.

## Explicitly out of scope

The footer Copy path, the COMMAND expander, the overlay scroll lock, the linked
BRANCH/PLAN, and the Start-work button's message. Each is its own branch on this
plan.

## If `claude -p` can stream

The plan's first open point: if there is a flag that makes it emit progress on
stdout, the log fills as the agent works and the panel's premise improves. Report
what you find either way — if there is none, the honest message stands and that
is a limit worth recording rather than a bug.

## Definition of Done

- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green
- `pnpm build:board` in THIS worktree, artifact committed
- changeset with a `bumps:` block — `plot: patch`, `@plot-pm/board: patch`
- `trash`, not `rm`

## Hazards

- **Use node 22:** `nvm use 22.17.1` — the default node crashes pnpm here.
- A failing board test should be re-run alone before you believe it; contention
  starves tests rather than breaking them. Wait on your own PID, never `pgrep`
  by name.
- Do not touch sibling worktrees; several are held by other agents.
