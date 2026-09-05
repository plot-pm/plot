## Implementation brief — the-fleet-changes-hands (slice: The fleet changes hands)

- **Plan (canonical):** `docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md` on `main`
- **Design:** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md`
- **Branch:** `feature/the-fleet-changes-hands` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 of five, and the only one the others wait on: three of the four remaining slices name commands this one creates.

## What this delivers

Two things in one branch, and they are one branch for a reason given below.

**`/plot-fleet` becomes `/plot-pulse`.** The read-only pulse keeps every behaviour it has — the scan, the report, the advice, the pulse line — and changes its name to the word it has always printed.

**`/plot-fleet` returns as fleet control**, taking `--start`, `--stop` and `--status` over `plot-registryd`.

## Why one branch and not two

Split, the rename lands first and `/plot-fleet` does not exist until the second branch merges — however long that takes. An alias would be worse than the gap, because it would answer the OLD behaviour to somebody asking for the new one. Changing the name's meaning in a single commit avoids both. The cost is one review covering two subjects, which is the smaller price.

## The rename

**22 live command references across 13 files.** Measured 2026-09-05:

```
skills/plot-fleet/SKILL.md                 3
skills/plot-fleet/README.md                2
skills/plot-dispatch/SKILL.md              4
skills/plot/scripts/plot-fleet-scan.sh     4   (header comments)
README.md                                  3
CLAUDE.md                                  2
skills/plot-implement/SKILL.md             2
skills/plot-reconcile/SKILL.md             1
skills/plot/intro-to-using-plot.md         1
skills/plot/scripts/plot-dispatch.sh       1
skills/plot/templates/plan.md              1
skills/plot-dispatch/README.md             1
packages/domain/src/workflows/implement.ts 1
```

**`plot-fleet-scan.sh` DOES NOT MOVE.** The scan reads the fleet and that name stays right. It accounts for most of the 284 files a naive `grep plot-fleet` reports, which is why the real number is 22.

**The pulse line is untouched.** `--log-pulse` is written by the SCAN, not by the command, so the log is unaffected by any of this.

**97 files of historical prose under `docs/` are left alone.** Plans, sprints and stories citing `/plot-fleet` are records of what was true when written. Rewriting them destroys `git blame` for a word — the same rule the `## Slices` migration applied to delivered plans.

## The runtime command

**It probes before it acts, and refuses rather than repairs.** Four refusals, each a measurement:

| refusal | why |
|---|---|
| no `plot-registryd.mjs` | nothing to start; point at `pnpm build:board` |
| `node` is not the pinned major | **the unit bakes `$NODE` in permanently.** Measured 2026-09-05: `command -v node` on the operator's machine answers 26.7.0 against a repo pinned to 24 |
| platform is neither launchd nor systemd | there is no unit to fill |
| a unit with that label is already loaded | launchd keys by label; a second repo needs a distinct one |

**`--once` is the gate.** The supervisor decides and performs nothing, so one tick against the live estate is free and proves the thing works before any unit is installed.

**`--start` brings up the supervisor AND the agents**, because a supervisor with no agents does nothing. The agent count is `Starting an agent`'s slice; until it lands, `--start` starts the supervisor and says how many agents it would have started.

**`--stop` IS AN ORCHESTRATION, NOT A SECOND STOP RULE.** It calls `plot-dispatch.sh --stop <branch>` once per dispatched agent, waits, and only then unloads the supervisor.

That is what dissolves the apparent conflict with dispatch's own refusal — *"Refusing to guess — stopping the wrong worker discards its work"* (`plot-dispatch.sh:950`). Naming each branch in turn is not guessing: the fleet knows which agents it has.

**It reports each branch as it goes.** A fleet stop is the slowest thing the command does, and a silent wait cannot be told from a hang:

```
/plot-fleet --stop
  stopping 3 agents, then the supervisor
  feature/a  signalled ... exited (2.1s)
  feature/b  signalled ... exited (0.4s), 4 uncommitted files kept
  feature/c  signalled ... still running after 30s — kept, see below
  supervisor unloaded
  1 agent did not exit: feature/c (pid 4471). Its desk and claim stand.
```

Each wait is bounded; past the bound the branch is reported as still running and the run carries on. **The supervisor goes LAST** — it is what would notice a desk falling idle, and a stop that fails partway should leave a watcher over what remains.

**Each agent keeps its desk and claim**, because `plot-dispatch --stop` keeps them. `--stop` ends processes and decides nothing about disk; what may be removed is `plot-reap.sh`'s question.

**`--status` answers about processes, not work.** Is the supervisor alive, how many agents, how long idle — with pids. What the slices are doing is `/plot-pulse`'s question.

## The install, verified by hand on 2026-09-05

This exact sequence worked and is what the command should automate:

```bash
nvm use                                    # the pinned major, not $PATH's
REPO_ROOT="$(git rev-parse --show-toplevel)"
NODE="$(command -v node)"
REGISTRYD="$REPO_ROOT/skills/plot/scripts/board/plot-registryd.mjs"

mkdir -p "$REPO_ROOT/.plot/logs" ~/Library/LaunchAgents
sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__NODE__|$NODE|g" -e "s|__REGISTRYD__|$REGISTRYD|g" \
    "$REPO_ROOT/skills/plot/units/com.plot-pm.registryd.plist" \
    > ~/Library/LaunchAgents/com.plot-pm.registryd.plist

launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.plot-pm.registryd.plist
```

Two checks worth keeping: `grep -c '__[A-Z_]*__'` on the filled plist must be **0**, and `plutil -lint` must answer OK. Both were run and both passed.

## Testing

**CI is `ubuntu-latest` only, so the launchd path can never run there** — and that is the path an operator on macOS uses. So:

- **CI asserts the units FILL and PARSE**: no `__PLACEHOLDER__` survives, the plist is valid, the systemd unit is well-formed. That is a real, failing check on Linux.
- **The systemd path can be loaded for real** in CI.
- **Actually loading the plist stays manual**, named as such in the release test list.

`pnpm test` validates that every skill parses and every `bumps:` names a real directory, so a missed rename fails CI.

## Done when

- `/plot-pulse` reports what `/plot-fleet` reported — same scan, same advice, same pulse line
- `/plot-fleet --start` installs and loads the unit on macOS and Linux
- `--status` answers whether the supervisor is alive **without starting it**
- `--stop` stops every dispatched agent through `plot-dispatch --stop`, reports each branch as it goes, waits with a bound, then unloads the supervisor
- each of the four refusals is reachable and names its repair
- `grep -rn 'plot-fleet' skills/ packages/*/src CLAUDE.md README.md` returns only `plot-fleet-scan` matches and the new command's own files
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not rename `plot-fleet-scan.sh`.**
- **Do not rewrite `/plot-fleet` mentions under `docs/`.**
- **Do not leave an alias** — the name is being reused, so an alias answering the old behaviour is worse than an error.
- **Do not run `pnpm run test:e2e`** locally. It dispatches real workers into sandbox repositories; CI is its gate.
- **Do not give `/plot-pulse` any of the runtime flags.** Its contract is that it derives and does not spawn.
