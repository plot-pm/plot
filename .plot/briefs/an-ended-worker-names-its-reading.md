## Implementation brief — an-ended-worker-names-its-reading (wave Saying what happened)

- **Plan (canonical):** `docs/plans/2026-09-01-an-idle-agent-is-not-a-stalled-one.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `bug/an-ended-worker-names-its-reading` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session, per the plan's `Review:` field

The plan's third and last wave, and it owns **only the message and the row**. Wave 1 merged as #649 and measured the estate. Wave 2 (`bug/the-loop-reads-the-agents-own-stream`) owns the end-condition swap and has committed `skills/plot/scripts/plot-transcript-quiet.sh` — sourced, not run, answering `plot_transcript_quiet_seconds <worktree>` with a number of seconds, the word `unavailable`, or exit 2. **Do not change any end condition here.** If wave 2 has not merged when you start, read its branch for the vocabulary you are naming.

### What to build

The log line and the board row tell three endings apart. Today two of them print one sentence and the third has never had one.

### The three readings, and what each says about the work on the desk

`plot-worker-loop.sh:546` is the site. Its `case "$_ended_by"` has two arms today:

| reading | set by | what it says about the desk |
|---|---|---|
| **the bound expired** | `_on_alarm()` at `plot-worker-loop.sh:381` | only that time passed. The floor fires when the monitor itself went silent, so nobody knows what state the desk is in. |
| **the agent went quiet** | `_on_monitor()` at `:392` | the agent measurably stopped — alive, committed, no CPU, tree unchanged across two passes. The worktree holds finished-looking work worth rescuing. |
| **nobody could tell** | new with wave 2 | no transcript can be read, so no reading distinguishes thinking from stuck. `Worker bound` ended it and the reason is an absence, not a measurement. |

**An operator triages those differently**, which is the whole argument — the existing comment at `plot-worker-loop.sh:540` already says so for the first two. The third is new: `unavailable` is a first-class answer in wave 2's contract, *"never failed and never zero"*, and an ending that reports it as a bound expiry hides that the reading was never available.

### The decisions the plan settles — do not re-derive them

**This wave changes no behaviour, only what is said.** The plan's Branches section gives it one line: *"the log line and the board row distinguish the bound expired, the agent went quiet, and nobody could tell."* Wave 2 owns the swap; wave 1 owned the measurement.

**`unavailable` is a word, not a number and not an error.** Settled by `the-registry-supervises-its-agents` and restated in `plot-transcript-quiet.sh`: a capability the adopting project does not provide is unavailable. A caller reading it as *"quiet for 0 seconds"* reports every unreadable agent healthy; one reading it as an error refuses to run where Plot's contract says it should degrade.

**The board must be rebuilt.** The plan's Changelog states board impact is real. Run `pnpm build:board` and commit the artifacts.

### A correction to the plan's own Changelog, which you should verify before acting on it

The Changelog says *"the `idle` state is one of the eight `plot-worker-state.sh` answers the board renders."* **Measured 2026-09-02: it is not.** `WorkerStateSchema` at `packages/domain/src/entities/fleet.ts:89` holds `running`, `finished`, `failed`, `ended`, `none`, `elsewhere`, `waiting`, `stalled` — `idle` is absent. `idle` is a `WorkerActivity` **cue** at `fleet.ts:121` (`'working' | 'idle' | ''`), and its own docblock at `:98` states the distinction deliberately: *"A CUE, NOT A STATE… This tells the first from the last WITHOUT promoting `idle` to a sixth `worker` state."*

That changes what the board half of this wave touches. The row does not carry an `idle` state to rename; it carries an activity cue whose meaning shifts once nothing ends a worker on it. **Find the render site before deciding what to change** — `packages/board/src/app/components/TupleRow.tsx` holds the activity marks track, and I did not verify which component turns the cue into what a reader sees. Say in the PR what you found.

### The open question this wave may settle

The plan asks: *"Does the WorkerMonitor keep publishing `idle` once nothing ends a worker on it? A finding nobody acts on is the crowding this board keeps removing, but `idle` beside a live pid may still be worth showing."* Settle it or leave it explicitly open with a reason. `plot-worker-monitor.sh:413` is where the finding is published.

### Done when

- The log line names which of the three readings ended the worker, and the three are distinguishable to a reader who knows none of this history.
- **A worker ended where no transcript could be read says so**, rather than reporting a bound expiry — that reading did not exist before wave 2 and has no message today.
- The board row's meaning matches what the reading now means, and the artifact is rebuilt.
- The plan's open question about publishing `idle` is settled or explicitly deferred with a reason.

### You are exposed to the bug you are fixing

The idle rule has ended **fourteen desks across two days**, including both earlier waves' own workers — wave 2's three times. It fires within minutes of dispatch.

**A kill takes uncommitted work and leaves commits alone.** Commit early and often, and label an unfinished commit as unfinished in its message. Wave 2 did exactly that: `plot: read an agent's transcript quiet (unfinished)`, clean tree, nothing lost.

`PLOT_MONITOR_ENDS_WORKER=0` disables the kill for one dispatch — `plot-worker-loop.sh:106`. It was used on wave 2 after its third kill. Note in the PR if you use it.

### Gates

```
nvm use                        # Node 24, per .nvmrc
pnpm test
pnpm run test:reconcile
pnpm run test:board
pnpm run typecheck             # board only — see below
cd packages/domain && npx tsc --noEmit
pnpm build:board               # the plan states board impact is real
```

**`pnpm run typecheck` is board-only.** It is `pnpm --filter @plot-pm/board typecheck` and never reaches `packages/domain`, whose own tsconfig typechecks its tests. That package also has `pnpm run test:corpus` on a separate vitest config, which `test:board` does not run.

**Do not run `pnpm run test:e2e`.** It is CI's gate. It dispatches real workers into sandbox repositories and has taken this machine down.

### Changeset

Description FIRST, `bumps:` block LAST — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note.
