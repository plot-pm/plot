# Implementation brief — a-working-agent-is-not-a-hung-one (Reading)

- **Plan (canonical):** `docs/plans/2026-08-30-a-working-agent-is-not-a-hung-one.md` on main
- **Branch:** `bug/the-loop-reads-the-monitor` (base: `main`)
- **Ends as:** one PR to main
- **Runs first.** The Hopping slice cannot be proven while the timer still kills
  every agent before it reaches a second slice.

### What to build

`plot-worker-loop.sh` ends the prompt when the **WorkerMonitor reports `idle`**,
not after N wall-clock seconds.

The two lines this is about (`plot-worker-loop.sh:248-260`):

```sh
while true; do
  if ! run_bounded; then
    echo "… exceeded the ${WORKER_BOUND_SECONDS}s bound … — ending worker without hopping" >&2
    exit 124
  fi
  next_branch=$("$script_dir/plot-fleet-scan.sh" --next "$PLOT_SLUG" …) || break
```

Line 254 kills; line 260 would hop. **No worker has ever reached line 260.**

### Why, measured

**2026-08-30: seven workers exited 124, every one with 3-6 commits.** Not one
was hung. Five lost a *different* last step to the kill — three the PR, two the
changeset, one the artifact rebuild — each recovered by hand, each found by
reading worktrees rather than by anything reporting it.

**The work was finished every time.** What the bound takes is the last five
minutes, because bookkeeping sits at the end of a brief.

### The decisions the plan settles — do not re-derive them

**The risk the bound was built for is real and stays.**
`a-hung-child-does-not-hold-the-loop` (2026-08-25): *"a hung agent has left the
worktree in a state nobody measured"*, so the loop must not wait forever. **You
are replacing the reading, not removing the protection.**

**The replacement shipped 2026-08-30 in #538.** `plot-worker-monitor.sh` reports
`idle` on **four** conditions together:

- the pid is alive
- its subtree burned no CPU across two consecutive samples
- the tree did not change between them
- commits already exist on the branch

**The extra conditions are not caution.** A worker waiting on a long model
response has the same zero CPU delta as one whose agent has vanished; the three
stalls measured that day had each already committed and then gone quiet.

**An agent with NO commits is never `idle`** — that is the monitor's middle row,
and calling it a stall is what teaches an operator to ignore the word. Do not
"improve" this.

**The timer stays as a floor, and stops being the verdict.** A monitor can die:
that is the subject of `two-monitors-watch-the-agent`, which has one termination
path recorded as unexplained and a leak that ran 152 orphans on this machine.
Removing the last resort while its replacement's lifetime is unsettled trades a
wrong answer for no answer. **A working day, not an hour** — and say in the PR
what value you chose and why.

### Done when

The plan's list, and the first is the point of the slice:

- an agent that **commits every few minutes for over an hour is never ended**
- an agent whose subtree goes quiet **with commits on the branch** is ended
  within two monitor intervals
- an agent that has committed **nothing** is not ended, however quiet
- the loop's message says **which reading** ended it

**The regression to lock:** a genuinely hung agent still ends. That is the
2026-08-25 property, and a test must fail if this slice loses it. **Write it
before the change** — it is the assertion most likely to be quietly weakened by
the very edit that makes the other three pass.

**How to test without waiting an hour:** the monitor's interval is
configurable, and the loop reads its findings from a file. Drive both with a
stubbed monitor writing findings on demand; a test that needs real time is a
test nobody runs.

Plus: `pnpm test`, `pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`),
changeset with a `bumps: skills:` block naming what you touched.

### Scope guard

The loop's ending condition. **Not** the monitor's sampling (#538 owns it), not
the monitor's lifetime (`bug/a-monitor-ends-with-its-agent`, in flight), not the
hop itself (the next slice).

**`Worker bound: 0` already disables the watchdog entirely**
(`plot-worker-loop.sh:216`). The escape exists; this slice is about the default
being wrong, not about adding a way out.
