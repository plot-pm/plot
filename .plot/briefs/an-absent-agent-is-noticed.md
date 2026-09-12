## Implementation brief — a-failed-gate-becomes-a-correction (slice: An absent agent is noticed)

- **Plan (canonical):** `docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/an-absent-agent-is-noticed` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention

This is the first of the plan's three slices and it waits on nothing. The other two — `feature/a-failed-gate-becomes-a-correction` (the correction file and the attempt budget) and `feature/a-marker-names-its-writer` — are unstarted and hold no refs. Nothing waits on this slice either: the correction slice consumes CI's verdict, not this reading. They are independent, and the plan says so.

### What to build

`plot-worker-state.sh` reports `running` for a desk whose agent is dead.

Measured 2026-09-11, in one session: **four agents** ended mid-slice. None failed a build, none wrote a `PLOT-BLOCKED` marker, and every one reported `running` in `plot-fleetctl.sh --status` with a plausible quiet time. Three left **8 commits and 9 uncommitted files** on their desks, each with an unstaged `.changeset/` file — the last thing written before pushing. Every one was one step from done, and all three would have been reaped as abandoned.

The cause is at `plot-worker-state.sh:684`. The recorded pid is the **loop shell**, and `kill -0` on it succeeds for the full `Worker bound` (28800 s) whether or not an agent is still running inside it: a dead worker's tree holds only `sleep 28800` and `sleep 5`. A live agent has a `claude` process descended from that shell, with CPU accruing.

So: teach the liveness reading to distinguish *the wrapper is alive* from *the agent is alive*, route the second case to the states that already exist for it, and hand the desk to a new agent without touching the tree.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The subtree walker already exists. Do not write a second one.** `plot_worker_cpu_centis` (`plot-worker-state.sh:442`) takes one `ps -o pid=,ppid=,time= -ax` snapshot and walks the ppid graph in awk. Its own docstring already argues this slice's premise: *"Measured across the fleet 2026-08-25: 9 of 11 loop shells sat at 0.01s CPU over hours while their `claude` child held 1.5+ minutes. So the shell's own CPU distinguishes nothing; the DESCENDANT tree is the only place a working worker differs from a dead one."* The reason it forks nothing per node is a measured one — the board polls the scan every 5 s. A `pgrep -P` recursion here would fork a process per descendant on that cadence.

**This slice was explicitly deferred by the slice that built that walker.** `plot-worker-state.sh:512` reads: *"Item 7 of the plan: a worker with no live child is `stalled`/`unknown` by the existing rules, untouched here."* That door was left open on purpose. You are walking through it — not reopening a settled question.

**CPU growth is the activity cue and is NOT the liveness reading.** `plot_worker_activity` (`:520`) samples the subtree's CPU twice across `PLOT_ACTIVITY_INTERVAL` (0.4 s) and answers `working` / `idle` / `""`. It is documented as *"A CUE, NOT A STATE"*, it is only ever read beside an established `running`, and it deliberately answers `""` rather than a false `idle` when there is nothing to measure. **Do not reuse it to decide liveness.** An agent blocked on a network read is `idle` and alive; the question here is existence, not motion — *is there a `claude` in the subtree at all*, which is a set-membership test over the same snapshot, not a delta.

**`liveness` is already the field, and it is already three-valued.** `plot_worker_readings` (`:788`) prints `here⇥pid⇥liveness⇥exit⇥blocked⇥dirty⇥unpushed`, and `liveness` is `live` / `stale` / `dead` (`:826–830`). `stale` is the precedent that matters: it already means *the pid exists but is not our worker* (a reused pid, caught via the manifest's `startedAt`). "The wrapper exists but the agent is gone" is the same kind of fact and belongs in the same field. Adding a fourth value is a four-site change the compiler walks you through; branching privately inside `plot_worker_state` at `:684` is not, and would put the reading somewhere the rule cannot see it.

**The rule decides; the shell reads.** The domain consumes `liveness` at `packages/domain/src/rules/agent-state.ts:119–120` — `'live' → running`, `'stale' → ended` — from readings passed as values, with no I/O. Per the layering rule, the new reading is collected in shell and judged in the rule. Do not decide the state in bash.

**A new `liveness` word silently becomes `dead` if you forget the parser.** `packages/board/src/server/entry/agent-state.ts:82` reads `liveness === 'live' ? 'live' : liveness === 'stale' ? 'stale' : 'dead'`. Emit a fourth word from the shell without extending that ternary and every desk carrying it reads `dead`, with no error raised anywhere — a live fleet reported as wholly dead. Change the producer, the parser, the `PidLiveness` type and the rule in one commit.

**`agentState` and `plot_worker_state` are a DECLARED duplicate pair, and the corpus test holds them.** `packages/domain/corpus/agent-state.corpus.test.ts` runs both over every desk on this machine and compares. Its own words: *"NEITHER SIDE IS AUTHORITATIVE. The test says they agree. On a disagreement the branch stops; adjusting either side to make this pass is the one move forbidden, because it cements a production bug behind a green test."* Changing the shell alone turns it red. Both sides move together, or the branch stops — that is the contract in `docs/shell-and-domain.md`, not a suggestion.

**Reuse `--restart`'s guards; do not write a second, laxer set.** The plan is explicit, and the order is load-bearing — **the PR is asked FIRST, before the state word** (`plot-dispatch.sh:1281`), then a live pid (`:1296`), then a `PLOT-BLOCKED` marker (`:1306`). The measurement behind that order: five of five `failed` worktrees on this estate held a PR, four open and one merged. `plot-worker-state.sh` refines `finished` by the tree but deliberately does **not** refine `failed`, `ended` or `none` — so a gate written on the state word alone would have restarted all five and discarded exactly what the `finished` refusal protects. Any of the three refuses the hand-over, and the desk then waits for a person.

**The desk is inherited untouched. Nothing cleans, resets or stashes.** `plot-dispatch.sh:1327` states it: a `stalled` worktree holds uncommitted work — that is what `stalled` *means* — and a measured stall here left 324 finished lines on the floor. This slice reaps nothing. The four desks measured on 2026-09-11 held work one step from done, so a sweep that deleted on this reading would have destroyed it.

**This slice reverses `--restart`'s stated rule, deliberately.** That verb refuses to auto-select a branch because *"replacing a stopped worker rather than reviewing, reaping or abandoning its work is a person's call."* The measurement that overrides it: four agents stopped, three held finished work, and every one sat untouched until a person read `ps`. The call was the operator's and the operator was not looking. Reverse the auto-selection, keep the guards.

**Rules carried over unchanged, because this estate keeps re-learning them:**

- **Absent is not false.** A pid with no measurable subtree yields *no cue*, never a false negative (`:508`). A failure to observe is not evidence of something to see.
- **Read the exit code, not the emptiness** (`:714`). An unreadable record licenses no verdict.
- **A marker is a file, not a string a file contains** (`:53`). A contents grep matched 28 tracked files on `main` — every brief documenting the feature included — so every pristine worktree read `waiting`. This brief is one of those files. Glob for the filename.
- **`elsewhere` is the caller's answer**, decided before this function is reached. A reading about which machine holds the worktree does not belong inside it.

### Done when

The plan's `## Done when` list is the specification. Beyond it, these are the assertions that exist *because a naive implementation would pass without them*:

- **A desk whose wrapper lives and whose `claude` is gone does not read `running`.** The defect itself. A test that only proves a dead wrapper reads `ended` passes on today's code.
- **A desk with a live `claude` grandchild still reads `running`.** The false-positive arm. Without it, "always report absent" passes every test above and takes the fleet down.
- **A `claude` two levels down counts.** The loop forks `claude`, which forks its own tools. A test with the process as a direct child passes on a `pgrep -P`-depth-1 implementation that fails in production — which is the real shape.
- **The hand-over refuses a branch with an open PR, then a live pid, then a marker — in that order.** Assert the PR refusal against a desk whose state word is `failed`; that is the case the ordering exists for and the one a state-word gate gets wrong.
- **The desk's uncommitted files survive the hand-over.** Count them before and after.
- **An unrecognised `liveness` word does not silently read as `dead`** (`entry/agent-state.ts:82`).
- **The corpus test agrees on every desk on this machine** — `packages/domain/corpus/agent-state.corpus.test.ts`. If it disagrees, stop and report; do not adjust either side to make it pass.

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm test                    # skills parse
pnpm run test:contracts      # helper estate + CI gates
pnpm run test:board          # rebuilds the artifact, then runs its tests
pnpm run typecheck
```

Add a `.changeset/` entry — description FIRST, `bumps:` block LAST, and the package is `plot` (a `packages/domain` or `packages/board` change uses `'@plot-pm/board': patch` instead; this slice touches both sides, so name what you actually changed). Optionally add `plan: docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md` in the same block. Run `./scripts/check-changeset-packages.sh`.

**Do not run `pnpm run test:e2e`.** It is CI's gate. It dispatches real workers into sandbox repos; two agents running it once produced 53 concurrent `node --test` processes and load average 8.69 on the machine the board also lives on.

The board artifact is generated and marked `-merge`: on a conflict in `board-server.mjs`, take either side, run `pnpm build:board`, commit the result. Never phrase it as "take ours".

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's slice heading — *An absent agent is noticed* — not from `git log -1`. Measured 2026-09-08: three slice PRs opened by hand each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

**When the PR exists, annotate the plan's slice heading in place:**

```
### An absent agent is noticed (Branch: feature/an-absent-agent-is-noticed, PR: #N)
```

This plan uses the `(Branch: …)` heading form. The annotation goes **inside the heading** — a trailing `→ #N` on a line below parses as `prs=[]` and the delivery gate will not see it.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-worker-state.sh` — the liveness reading and the `liveness` field
- `packages/domain/src/rules/agent-state.ts` and the `PidLiveness` type — the fourth case
- `packages/board/src/server/entry/agent-state.ts` — the readings parser
- the hand-over path in `skills/plot/scripts/plot-dispatch.sh` — reusing `--restart`'s guards, adding no second set
- `test/reconcile/workerstate.test.mjs` and the corpus test's expectations

Neither sibling slice is started and neither holds a ref, so nothing collides today. Watch the boundary anyway: `a-marker-names-its-writer` will add fields to the `PLOT-BLOCKED` marker, which this slice *reads* as a refusal condition but must not reformat. Leave the marker's contents alone.

`plot-worker-state.sh` is **sourced by five scripts**, one of them `plot-worker-loop.sh` — the agent's own loop, running unattended per agent for the length of a slice. A regression here stops the fleet rather than one branch. Keep the file sourcing-safe: it must define functions and do nothing else on load.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
