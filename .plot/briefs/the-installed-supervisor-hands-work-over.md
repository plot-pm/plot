## Implementation brief — the-installed-supervisor-hands-work-over (slice: The unit passes the flag)

- **Plan (canonical):** `docs/plans/2026-09-07-the-installed-supervisor-hands-work-over.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/the-installed-supervisor-hands-work-over` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

One slice, **two defects in the same two files.** Read the plan's Notes — it carries four disproved hypotheses and the measurement that settled the second defect.

## Defect 1 — the units omit `--start-agents`

`packages/board/src/server/entry/registryd-main.ts:719`:

```ts
if (args.startAgents) await startAgents(report, performer, write, warn);
```

`startAgents` walks `report.handOver.writes` and calls `performer.assignSlice` for each `agent-assign` item (`:609-611`). **Without the flag that loop never runs** — the hand-over is computed, counted into `handed=`, and discarded.

Both shipped units name `__NODE__ __REGISTRYD__` and nothing else:

- `skills/plot/units/com.plot-pm.registryd.plist:22-26`
- `skills/plot/units/plot-registryd.service:41`

**Measured 2026-09-07:** `handed=2` for three consecutive ticks while both free agents' manifests read `branch: ""` and had been quiet **3,067 seconds**.

**BOTH UNITS, NOT ONE.** A fleet that assigns on macOS and not on Linux is a defect reproducing on half the installations.

## Defect 2 — `ProcessType: Background` gets the daemon evicted

`com.plot-pm.registryd.plist:72-73`. **Six evictions in one session**, every one under load — caught at load 43.68 by a 15 s watcher, never below 13. `runs = 1`, `last exit code = (never exited)`, `registryd.err` **0 bytes** each time: removed by the system, not crashed.

**THE BOARD IS THE CONTROL AND IT NEVER DIED.** `node --watch board-server.mjs` ran **2 days 12 hours unbroken** through all six, same machine, same load. Two long-lived Node processes in one repo; only the one declaring `Background` is taken.

**THE EXISTING COMMENT IS RIGHT AND ITS CONCLUSION IS NOT.** Both units say:

> *"The daemon is idle 94% of a 60 s interval and shares a machine with the workers it supervises; it must never be what makes a worker slow."*

That reasoning holds. **But it argues for scheduling priority, not eviction eligibility** — and `ProcessType: Background` buys both. Split the two rather than trading them: `Adaptive` keeps the job schedulable, and `Nice` can carry the politeness the comment asks for.

**DO NOT CHANGE THE SYSTEMD UNIT'S PRIORITY.** `Nice=10` and `IOSchedulingClass=idle` (`:63-64`) are priority alone and evict nothing. **That the two platforms disagreed only in the field that matters is the argument** — say so in the plist comment, and leave the service file's priority as it is.

## Four things this must get right

**THE TEST READS THE TEMPLATE, NOT THE PARSER.** `argsFrom` parses `--start-agents` correctly and always did — that is not where this broke. What went unread for the life of the feature is the **unit file**. `test/reconcile/fleetctl.test.mjs` is the home; **no test reads the templates today**, which is exactly why.

**Assert three things per template:** the flag is present, the launchd unit does not declare `ProcessType: Background`, and the systemd unit still carries its `Nice`.

**THE FILL PATH IS UNCHANGED.** `plot-fleetctl.sh` already checks for surviving `__PLACEHOLDER__`s and runs `plutil -lint`. Adding an argument changes what is filled, not how it is verified — do not touch that logic.

**AN INSTALLED UNIT DOES NOT UPDATE ITSELF.** The plist is filled once and baked, the same property that makes a wrong `node` permanent. **Say how an existing installation picks this up** — `/plot-fleet --stop` then `--start` re-fills it — and put that sentence in `skills/plot-fleet/SKILL.md`, because an operator whose fleet has this defect reads the skill, not the plan.

## Verification

- **The end-to-end one:** dispatch a slice, and it reaches a free agent's manifest **without a hand write**. That is the defect, and nothing short of it proves the fix.
- `pnpm run test:reconcile` — the new template assertions live there.
- `plot-fleetctl.sh --start --dry-run` still reports what it would fill.
- The plist still passes `plutil -lint` after the edit.

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:reconcile
```

**Do NOT run `pnpm run test:e2e`.** CI's gate, not a local one.

**Do not `--stop` a running fleet to test this.** Three agents are working as this is written; ending them is a person's call. Test with `--dry-run` and by reading the filled file.

## Done when

Both shipped units start the daemon with `--start-agents`; a test asserts each template carries it; the launchd unit no longer declares `ProcessType: Background` while keeping its scheduling politeness; the systemd unit is unchanged in that respect and the plist says why; a dispatched slice reaches a free agent's manifest without a hand write; and `/plot-fleet` says how an already-installed unit picks the change up.
