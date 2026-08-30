# Implementation brief — the-registry-owns-what-it-started (Recording)

- **Plan (canonical):** `docs/plans/2026-08-30-the-registry-owns-what-it-started.md` on main
- **Branch:** `feature/a-manifest-names-every-process` (base: `main`)
- **Ends as:** one PR to main
- **Independent of the other two slices.**

### What to build

The manifest records the processes the registry spawned, not one of them.
Measured on a live dispatch, 2026-08-30:

```
plot-dispatch.sh  (7357)
  └── wrapper     (7358)               ← in no manifest
        ├── WorkerMonitor       (7364) ← in no manifest
        ├── AgentMonitor        (7365) ← in no manifest
        └── plot-worker-loop.sh (7366) ← "pid": "7366"
```

The estate held **1 manifest, 76 monitor processes, 0 of them nameable from the
registry**. `DESIGN-agent.md` gives the registry *no worktree is left behind*;
the same sentence is owed for processes, and nothing can find one to reap.

### Fix the wrapper pid FIRST — the existing record is wrong

**`.plot-worker.wrapper.pid` names the dispatcher, not the wrapper.** Three of
three live workers on 2026-08-30:

```
wrapper.pid=7357    agent's real ppid=7358
wrapper.pid=71953   71954
wrapper.pid=92947   92949
```

**One pair of parentheses** (`plot-dispatch.sh:626`):

```sh
… >"$log" 2>&1 </dev/null & echo $! >"$wt/.plot-worker.wrapper.pid" )
```

`echo $!` runs **inside** the enclosing `( … ) &`, so it reports that subshell's
last background pid rather than the `nohup sh -c` within. Reproduce it in three
seconds:

```
( sleep 30 & echo "innen: $!" ) & echo "aussen: $!"
  aussen: 85674
  innen:  85675
```

**The intent is documented** at `:484` — *"The wrapper's own pid is KEPT …
because the wrapper is what writes `.plot-worker.exit`."* The comment says what
the file is for; the line writes something else.

**Do it as its own commit with its own assertion**, before extending anything.
Correcting it changes what an existing file means, and a process group built on
a wrong wrapper would signal `plot-dispatch.sh` while the wrapper and its
monitors carry on.

### The decisions the plan settles — do not re-derive them

- **the registry writes the group**, because the registry is what spawned them
- **written at spawn**, never discovered later by scanning `ps` for a pattern —
  pattern-matching processes is how `plot-reap.sh:162` came to recognise no
  worktree at all
- **an old manifest without the field stays readable**, and reports the group as
  **unknown rather than empty**. *Absent is not none* — the rule this contract
  follows everywhere, and `registry.ts` already states it for the pid.

**The shape is deliberately open.** A list, a process-group id, or named fields
are all workable; which survives depends on what a reap rule needs. Pick one and
say why in the PR.

**Note what the registry does NOT treat the manifest pid as.** `registry.ts:16`:
*"The manifest pid is a display fact a reader can go check, not an input"* —
liveness comes from `$wt/.plot-worker.pid` via `plot-worker-state.sh`, because a
manifest can go stale. **If your group is to be reapable rather than merely
displayable, say in the PR what makes it trustworthy** — the worktree already
carries pid files, and that may be the better home.

### Done when

The plan's list:

- `.plot-worker.wrapper.pid` names the agent's actual parent, **asserted against
  a live dispatch** (three of three were wrong)
- a dispatched agent's manifest names its wrapper and both monitors as well as
  its own pid
- a manifest written before this change **still parses**, reporting the group as
  unknown rather than empty
- the board renders unchanged
- the field is written **at spawn**, asserted by killing the agent and finding
  the group still recorded

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm test:board`, `pnpm run test:e2e`
(with `env -u PLOT_UNATTENDED`), artifact rebuilt, changeset.

### Scope guard

Recording only. **Reaping is explicitly not here** — naming the processes makes
reaping possible; deciding when a monitor must die belongs to
`two-monitors-watch-the-agent`, whose `Ending` slice is in flight and has one
path recorded as unexplained.

Shipping the field without a sweep is a complete step: the registry stops lying
about what it started.
