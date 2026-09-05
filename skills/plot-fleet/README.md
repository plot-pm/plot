# plot-fleet — developer notes

Fleet control: the door to `plot-registryd` and the agents it supervises.
`SKILL.md` is the agent-facing instruction; this file is why it looks the way it
does.

Design: [`DESIGN-process.md`](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md).
Plan: `docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md`.

## The name

This skill is **not** the one that held this name until 2026-09-05. That one is
now [`plot-pulse`](../plot-pulse/) — the read-only report over the estate, which
took the word it had always printed.

The name was reused rather than retired, **in one commit**. Split in two, the
rename lands first and `/plot-fleet` does not exist until the second branch
merges. An alias would be worse than the gap, because it would answer the OLD
behaviour to somebody asking for the new one. The cost is one review covering
two subjects, which is the smaller price.

## Split: skill vs script

Per Manifesto Principle 3, *skills interpret and adapt; scripts collect and
report*:

| Layer | Responsibility |
|-------|----------------|
| `skills/plot/scripts/plot-fleetctl.sh` | Every probe, every refusal, the fill, the load, the ordered stop. Deterministic; a small model can run it and read its output. |
| `skills/plot-fleet/SKILL.md` | When to run which verb, how to read a refusal to a person, and whether a stop is wanted at all. |

**The refusals live in the script rather than in this file**, because
CLAUDE.md's *Gates Over Rules* asks the question that decides it: can an agent
answer *"did I check the node version?"* without checking? In prose, yes. In the
script, the run cannot reach `launchctl bootstrap` without passing every probe.

## The four refusals, and why each is a measurement

| Refusal | Measurement |
|---------|-------------|
| no `plot-registryd.mjs` | the unit names an absolute path; a missing artifact makes a unit that fails at load |
| `node` is not the pinned major | 2026-09-05: `command -v node` answered 26.7.0 against `.nvmrc` 24 — the operator's real machine |
| platform is neither launchd nor systemd | there is no unit to fill, and Plot supervising its own supervisor is the regress the OS terminates |
| label already loaded | launchd keys by label; a second checkout loading over the first silently supervises the wrong estate |

**`.nvmrc` is the pin, not `engines`.** Both `package.json` blocks say `>=24`,
which is a floor. The unit needs one exact interpreter, so the comparison is
against the file that names one.

**The fill is verified twice.** `grep -c '__[A-Z_]*__'` on the filled unit must
be `0`, and on macOS `plutil -lint` must answer OK. Both were run by hand on
2026-09-05 during the install this command automates, and both are now gates
that delete the half-filled unit rather than install it.

## Why `--stop` orchestrates rather than signals

There is exactly one rule for stopping an agent: `plot-dispatch.sh --stop
<branch>`. It refuses a bare invocation, and a fleet-level stop that signalled
every worker itself would be a second, laxer rule for the same act — the
one-fact-two-verdicts shape this repository removes wherever it finds it.

Naming each branch in turn is **not** guessing. The fleet knows which agents it
has: the same worktree enumeration `plot-dispatch --status` uses, so the two can
never disagree about the population.

The order is load-bearing. **The supervisor goes last**, because it is what
would notice a desk falling idle; a stop that fails partway then leaves a
watcher over the remainder rather than an unsupervised one.

## The gap the design did not anticipate: free agents have no branch

`plot-dispatch.sh --start` cuts each free agent's desk **detached** at
`origin/<main>` — a free agent has no branch to cut one from. So a running free
agent cannot be named to `plot-dispatch --stop`, which takes a branch and
refuses to guess.

`--stop` therefore **reports them and leaves them running**, rather than
inventing the second stop rule the whole design refuses. The eight-hour `Worker
bound` ends an idle agent on its own, so the population is bounded even when
nobody stops it.

Fixing this properly means teaching `plot-dispatch --stop` to take a worktree or
a pid — which is a change to the one stop rule, and belongs in its own slice
with its own argument about what a desk-shaped stop may destroy.

## `--status` reads the log's mtime for quiet time

Not the process start time. A worker alive six hours mid-prompt is not idle; one
whose log has not moved in six hours is exactly what a person wants named. This
is the same reading `plot-quiet-stretch.sh` takes for a different consumer.

## What this command is not

- **Not the board's door.** That is `/plot-board`. The two systems share a
  machine and no process-tree edge, so neither may become a dependency of the
  other.
- **Not a reaper.** `--stop` ends processes and removes nothing. Desks, claims
  and refs are `plot-reap.sh`'s and `plot-release-refs.sh`'s questions, on their
  own measurements.
- **Not a report over the estate.** `/plot-pulse` answers that, and this command
  never derives a wave state.

## Testing

`test/reconcile/fleetctl.test.mjs` drives the script against fabricated
repositories: each refusal, the fill verification, the stop ordering, and
`--status`'s exit code.

**The launchd path cannot run in CI** — the runner is `ubuntu-latest`, and that
is the path a macOS operator uses. So CI asserts the units **fill and parse**
(no surviving placeholder, valid plist XML, well-formed systemd unit), which is
a real failing check on Linux. Actually loading the plist stays a manual step,
named as such in the release test list.
