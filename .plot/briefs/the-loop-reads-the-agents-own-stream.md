## Implementation brief — the-loop-reads-the-agents-own-stream (wave Reading the agent instead of the machine)

- **Plan (canonical):** `docs/plans/2026-09-01-an-idle-agent-is-not-a-stalled-one.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `bug/the-loop-reads-the-agents-own-stream` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session, per the plan's `Review:` field

**This is the fix.** The rule it replaces has ended eleven dispatched workers across two days, several of them holding uncommitted work including new test files. `Measuring what a working agent looks like` merged as #649 and answers the plan's first Open Question with a number; `Saying what happened` consumes what this slice decides and must not be pre-empted here.

### What to build

The loop's end condition reads **transcript quiet** rather than subtree CPU, with the measured threshold, and reports itself **unavailable** where no transcript exists. The fallback is `Worker bound`.

### The measurement this slice consumes

Wave 1 shipped `skills/plot/scripts/plot-quiet-stretch.sh` and its `.mjs` half. Run it — it is read-only and takes about a minute. Measured 2026-09-02 across 23 sessions in 21 worktrees, 7547 quiet stretches:

```
Longest quiet         600.8s
p50 / p90 / p99       0s / 2.6s / 15.6s
Over the 30s window   37 stretches, in 9 of 23 sessions
```

**Split by what the agent was waiting on:**

| waiting on | n | max | p99 | ≥30 s |
|---|---|---|---|---|
| the model (thinking) | 2772 | 109.6 s | 17.4 s | 9 |
| its own command | 4775 | **600.8 s** | 13.4 s | 28 |

### The threshold question the measurement raises

**The plan's framing is half right, and the data says which half.** Its summary calls `idle` "a 0.4 s CPU sample of a subtree that spends most of its life waiting on a model" — but **28 of the 37 over-window stretches are the agent waiting on its OWN command**, not on the model. The four longest are this repo's own gates: `gh pr checks --watch` at 600.8 s, `pnpm run test:board` at 600.3 s, `pnpm run test:reconcile` at 584.9 s and 575.5 s.

**A transcript is equally quiet in both cases.** So a threshold chosen from the thinking distribution alone — p99 of 17.4 s, max 109.6 s — kills every agent that runs this repo's test suite. **The threshold must clear 600.8 s, or the reading must distinguish a live child process from none.** The plan settles that the reading is transcript quiet and does not settle this number: its first Open Question is *"What interval counts as no output on a live transcript? Measure a real session's quietest stretch first — a threshold below it kills working agents exactly as today's does."* Wave 1 measured it; choosing from it is this slice's work, and the choice belongs in the PR body with the numbers beside it.

### The decisions the plan settles — do not re-derive them

**Read the agent, not the machine.** The plan's Design tabulates three candidate readings and settles the third: *"A `claude -p` session writes to its transcript as it works; a session that has produced nothing for a long interval has genuinely stopped, whatever its CPU clock says."* Subtree CPU over any window stays rejected — *"no sampling interval closes the gap: a slow model response is indistinguishable from a dead one by CPU alone."*

**The fallback is `Worker bound`, and its cost is stated.** Where no transcript can be read, *"there is no reading that distinguishes thinking from stuck, and the plan should say so rather than invent one."* A genuinely stuck agent then holds a desk for up to 8 hours — smaller than the measured cost of the current rule.

**Unavailable is not failed.** `the-registry-supervises-its-agents` settled that a missing transcript makes the capability **unavailable**, and this slice reports it that way rather than as an error.

**Rejected — widen the sample.** *"Any interval still guesses, and the failure is not a short window — it is that CPU does not answer the question."*

**Rejected — require more consecutive idle passes.** *"Three zeros are three readings of a waiting process."* It also delays a real stall by an interval per pass.

**Rejected — keep the kill and let a supervisor undo it.** Resume needs the same transcript, and an agent ended mid-edit leaves uncommitted state its successor inherits. *"Not killing a working agent is strictly better than killing and recovering it."*

**`PLOT_MONITOR_ENDS_WORKER=0` is a seam, not the answer.** It shipped in #631 and defaults to today's behaviour at `plot-worker-loop.sh:106` deliberately — *"changing a kill's default under a running fleet is a second failure"*. This slice replaces the reading; it does not simply flip that default.

### The transcript is reachable here, and the plan's caveat is about a different thing

**`plot_session_id` at `plot-dispatch.sh:252` mints an id, and `plot-worker-loop.sh` never forwards it** — `PLOT_SESSION_ID` appears zero times in that file. `plot-dispatch.sh:513` records why: *"this repo's `Worker command` carries none, so reading one back would mean guessing at the newest file in a directory that holds one to eight of them."*

**Wave 1 does not join by session id at all.** `plot-quiet-stretch.mjs:168` resolves transcripts from the WORKTREE PATH under `~/.claude/projects/<projectSlug>`, and skips `agent-` prefixed files because *"a subagent's transcript is a true statement about the wrong process."* That is why it read 23 sessions on an estate whose `Worker command` passes no `--session-id`.

**So the reading has a source on this estate today**, and the plan's *"transcript exists only where the project passes `--session-id`"* is about the manifest join rather than about finding the file. Reuse wave 1's resolution rather than reintroducing the session-id dependency, and keep the `agent-` filter — a subagent's stream would report the wrong process quiet.

### The current rule, for the sites you will change

| what | where |
|---|---|
| the CPU sampler | `plot-worker-monitor.sh:274` — `monitor_activity()` |
| where `idle` is published | `plot-worker-monitor.sh:413` |
| the 0.4 s sample | `plot-worker-state.sh:493` — `PLOT_ACTIVITY_INTERVAL` |
| the kill | `plot-worker-loop.sh:392` — `_on_monitor()` traps `USR1` |
| the existing seam | `plot-worker-loop.sh:106` — `MONITOR_ENDS_WORKER` |

### Done when

- **A dispatched agent that only reads for ten minutes is not ended** — the plan's own `Done when`, asserted against a real session, *"since the whole defect is that a synthetic agent burning CPU passes today's rule and a real one does not."*
- A genuinely stopped agent is still ended.
- Where no transcript can be read, the capability reports **unavailable** and `Worker bound` is what ends the worker.
- The chosen threshold is justified by wave 1's numbers in the PR body, and clears the 600.8 s an agent running this repo's gates goes quiet for — or the reading distinguishes a live child process from none, and says how.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, changeset.

### You are exposed to the bug you are fixing

The rule this slice replaces is live while you work, and it has ended eleven desks across two days. **Commits survive a kill; uncommitted work does not.** Commit early and often, and label an unfinished commit as unfinished in its message.

**Commit BEFORE you run the gates.** `pnpm run test:board` is a 600 s silence on this estate and `pnpm run test:reconcile` is 585 s — running the repo's own gates is long enough to be read as a stall by the rule you are removing. Wave 1's worker was ended this way and lost nothing, because every line was already committed.

`PLOT_MONITOR_ENDS_WORKER=0` in your environment removes the kill for your own session without changing the default. It is a seam that already shipped; use it if you want, and do not change what it defaults to.

### Repo gates

Node 24 — `nvm use` first. Then `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and `pnpm build:board` because the board artifact is generated and CI gates on it being current.

**`pnpm run typecheck` is board-only** — it is `pnpm --filter @plot-pm/board typecheck` and never reaches `packages/domain`. A change touching the domain package also needs `cd packages/domain && npx tsc --noEmit`, and that package carries `pnpm run test:corpus` on its own vitest config which `pnpm run test:board` does not run.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers, and two agents running it here produced 53 concurrent `node --test` processes.

### The changeset

Description FIRST, `bumps:` block LAST. Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.
