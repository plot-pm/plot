## Implementation brief — two-monitors-watch-the-agent (slice 3: Watching the agent)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on `main`
- **Branch:** `feature/the-agent-monitor-reads-the-desk` (base: `main`)
- **Ends as:** one PR to `main`

Needs `feature/every-worker-is-born-monitored`.

### What to build

Four findings, read from the desk and the host on a slow cadence (~5 min):

| finding | measurement |
|---|---|
| **owes a review** | tree clean, commits ahead of the default branch, no PR |
| **owes a gate** | commits ahead, and a repo gate the branch does not satisfy |
| **owes an answer** | a `PLOT-BLOCKED*` marker in the tree |
| **holds unlanded work** | uncommitted or unpushed changes in the tree |

Build on `plot-worker-state.sh` and `plot-pr-merged.sh`.

### The decisions the plan settles — do not re-derive them

**A finding names the SLICE, not the agent.** An agent takes one unit and then
another — *"slice merged ─► agent and desk are FREE for the next unit"*
([DESIGN-agent.md](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-agent.md)),
which is why `branch` is optional on an agent. By the time a finding is read the
agent may be three commits into its next slice, and the debt belongs to a branch
it left. Name the agent only as *who was at that desk when it happened*.

**The debt outlives the agent's attention, and that is the point.** The monitor
does not have to catch the moment work finishes: the debt persists until a PR
exists, so a finding one interval late is as good as one on time.

**`owes a gate` starts with the changeset and stops there.** Measured
2026-08-30: `feature/the-workflows-decide-without-acting` had commits, a clean
tree and no marker — and no changeset, so it would have landed red, and every
other finding said nothing. **A gate belongs here only if it can be answered
from the worktree alone**, in the time this monitor already spends. *"Is there a
new `.changeset/*.md`"* qualifies; *"do the tests pass"* does not, and asking it
would turn a five-minute sample into a build. **Running CI to predict CI is a
second CI.**

**Five minutes is a host budget, not caution.** These findings need a PR lookup,
and this repository has measured what happens when host questions ride a fast
loop. Against a stall that lasted 50 minutes it is still 45 minutes earlier than
a person asking.

**`prMerged` reads `mergedAt`**, never `state` (a merged PR reports `CLOSED`)
and never ancestry (squash-merge leaves a branch ahead of main forever).

### Done when

The plan's Watching-the-agent `Done when`. Each finding individually triggerable
in a test; `owes a review` fires on a branch with commits and no PR and does NOT
fire once a PR exists; publishes on change with `finding`, `since`, `evidence`,
`measuredAt`; **and it writes nothing at all** — publishing is its only output.

**Unit against mocked ports**, including a host that refuses — that is what
makes `unaskable` testable without a broken host, and it is why the sprint's
goal says unit AND mock. One e2e in `test/e2e/`.

Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns the AgentMonitor's sampling. Not the channel (slice 4), not attention
(slice 5), and no action of any kind.
