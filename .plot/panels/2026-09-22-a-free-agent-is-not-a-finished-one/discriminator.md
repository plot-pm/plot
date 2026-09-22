# Discriminator lens — a free agent is not a finished one

Position: reject

The plan rests on one sentence: *"The manifest's `branch` is the discriminator. A free agent has `branch: ""` by construction."* I attacked that sentence and it does not hold. `branch: ""` is **reachable for at least four non-free populations**, the estate already writes it deliberately at the moment a slice FINISHES, and `plot-worker-state.sh` cannot read the field at the point the plan wants it read without contradicting a rule the same file already states. The reading is not a discriminator; it is an ambiguity with the same two-meanings shape the plan's own §"The reading, and why it is wrong for this population" accuses the current code of.

---

## 1. Does the stated problem exist?

**Partly — the symptom is real, the diagnosis is not verified.**

Real, in the code: `plot-worker-state.sh:830-860` establishes `kill -0`, then asks `plot_worker_agent_alive`, and the root is excluded exactly as the plan quotes. A free agent's loop has no `claude` descendant by construction — `plot-worker-loop.sh` sleeps 60 s at a time reading `assigned_branch` (`:650`). So a live free agent CAN read `finished`. That much I verified.

Not verified: that this is why the board showed nothing. The plan's own §"The blockage was a DEAD SUPERVISOR" records that the author got the diagnosis wrong **twice**, that `/api/fleet agents: 0` was measured against a daemon whose last tick was the previous day and whose log was 131 MB, and that `--status` lies about liveness. A reading taken while the supervisor was dead is not evidence about the state word. The plan never re-measures `agents: 0` after the repair. So the `finished` reading is real and its causal link to the reported symptom is asserted, not measured.

## 2. Is this the smallest fix?

No — and more to the point, the proposed fix is not a fix, because the discriminator is unsound. See §5 for the nearer mechanism that already exists.

## 3. What I could not verify — and what I DISPROVED

### 3a. `branch: ""` is written for a FINISHED agent, on purpose, by the loop itself

`plot-worker-loop.sh:323-362`, `clear_manifest_branch`, exists precisely to write `branch: ""` — and its call site is `:2163`, immediately after `seal_declaration` (`:2142`) and `record_slice_spend`. The comment at `:2150` is explicit:

> `# THE AGENT IS NOW FREE, so the manifest stops naming a slice`

The plan's own table says `branch: "" + no claude child` ⇒ **free**. But the loop writes `branch: ""` at the exact moment a slice finished, and a worker that finishes its LAST branch exits with the manifest cleared — the file's own comment at `:343`:

> *"A worker that finishes its last branch exits with the manifest cleared and the exit trap removes the file"*

There is a window between `clear_manifest_branch` and the exit trap in which the manifest reads `branch: ""` and the process is dying or dead. The plan's rule reads that as `free`. **That is the plan's own "What must not break" clause broken by the plan's own discriminator** — it promises *"A dispatched agent with no `claude` child still reads `finished`"*, and an agent that just finished its last slice is exactly that agent, now carrying `branch: ""`.

### 3b. `rules/free.ts` says a free agent CAN name a branch — the plan's discriminator would call it not-free

`packages/domain/src/rules/free.ts:64`:

```ts
export const isAgentFree = (reading: AgentReading): boolean => {
  if (reading.state !== 'running') return false;
  return reading.branch === '' || reading.sliceHasMerged;
};
```

Two disagreements with the plan, in opposite directions:

- **`sliceHasMerged` makes a branch-naming agent free.** `whyNotFree`'s docstring records this was already got wrong once: *"a running agent whose slice has LANDED is free and still names a branch, so a `branch !== ''` arm read *holds feature/x* about an agent the rule had just called available."* The plan proposes writing that exact refuted `branch !== ''` arm into the shell.
- **`state !== 'running'` makes an empty-branch agent NOT free.** The domain requires liveness first. The plan's shell arm fires on `branch == "" && loop alive`, where "alive" is `kill -0` on the loop shell — which `plot-worker-state.sh:830` itself says is *"a precondition for this question, never the answer to it."*

So the estate holds **two rules that disagree**, in a repo whose CLAUDE.md requires a declared corpus pair for exactly this. The plan names neither `free.ts`, `isAgentFree`, nor `agentAvailability`.

### 3c. The live manifest CONTRADICTS the plan's measurement table

The plan's evidence block reads:

```
manifest   a0583977-….json   branch: ""   pid 1794
desk       free-1146d4ff
```

Read today, the same manifest on the same desk:

```
$ grep branch .plot/agents/a0583977-f1ff-4ba9-9c06-3545bc61aa29.json
  "branch": "feature/the-store-holds-what-the-host-said",
  "worktree": ".worktrees/free-1146d4ff",
  "pid": "1794",
```

The agent the plan measured as permanently free **took work**. Its own §"The blockage" section prints the tick handing that very branch to that very session id. So the `branch: ""` the plan measured was the transient pre-hand-over window, not a stable population — and the agent left it without any code change. A rule built on a value observed once in a window that closed on its own is not built on a discriminator.

### 3d. A SYNTHESIZED entry carries `branch: ''` for a detached desk

`packages/board/src/server/registry.ts:774` — `branch: wt.branch` — sourced from `gitWorktrees` (`:901-928`), where the parser's own comment at `:925` reads:

> *"`detached` and every other porcelain key leave `branch` as ''"*

Every `--start` desk is cut **detached at `origin/<main>`** (`plot-dispatch.sh:2045`, `:2078`). Measured on this checkout right now: `/private/tmp/plot-baseline-aa80`, `free-04517165`, `free-096be20a` — all detached, all synthesizing `branch: ''`, none of them necessarily a live free agent. `/private/tmp/plot-baseline-aa80` is a hand-made A/B baseline worktree, not a Plot agent at all. The plan's rule would read it as `free`.

### 3e. `plot-worker-state.sh` is handed a WORKTREE, not a manifest — and reading the branch there contradicts the file's own gate

`plot_worker_state` takes `$1=worktree $2=pr-fact` (`:736`). It reaches a manifest only through `plot_manifest_for_worktree`, matching on the `worktree` field — and the file states at `:848` that gating on the manifest was **already tried and rejected**:

> *"the one genuinely orphaned desk on this machine carries NO manifest — the registry it was written to has moved — and gating on one defeated the detection for exactly the population this exists to serve."*

Both fallback paths make the plan's reading unaskable rather than false:
- the `.plot-worker.pid` fallback (`:790`) runs when the manifest has no usable pid — there is no branch to read;
- a hand-started loop has no manifest at all, and `clear_manifest_branch` itself returns 0 in that case (`:352`).

`bashLiveness` hands the resolver a worktree path and nothing else (`registry.ts:16-18`). The branch is simply not an input at that seam.

## 4. What breaks if this ships as written

1. **A finished agent reads `free`.** §3a. The plan's own non-regression promise fails on the commonest end-of-work path.
2. **A dead free agent reads `free`.** The `branch == ""` arm fires on the loop shell answering `kill -0`, which the file says is never the answer. A free agent whose `claude` died still reads free forever, up to `Worker bound: 28800` — the 8-hour window the plan means to make visible becomes 8 hours of a zombie advertised as available.
3. **A hand-made worktree reads `free`.** §3d. `/private/tmp/plot-baseline-aa80` on this machine.
4. **Two `free` words with different meanings.** `agentAvailability` (`tuple-row.ts:960`) already renders the string `'free'` from `isAgentFree`. The plan adds a ninth **process state** also spelled `free` with a different definition. `KNOWN_STATES` (`registry.ts:47-55`) is derived from the contract enum, so a shell printing an unlisted word degrades to `unknown` — the board loses the row rather than gaining it — and adding it to the enum makes `agentAvailability` able to disagree with the state word on the same row. The plan's "new word" argument weighs `free` against `running` and `waiting` and never notices `free` is taken.
5. **The CLAUDE.md layering rule is inverted.** The plan puts the discriminator in a shell script while `rules/free.ts` holds it in the domain with a refuted `branch !== ''` arm documented in its own TSDoc. This is the *"a rule exists and nothing calls it"* defect the repo says to report, answered by writing a third implementation.

## 5. The nearer mechanism the plan ignored

`isAgentFree` / `whyNotFree` in `packages/domain/src/rules/free.ts`, reached by `agentAvailability` and by `queue-reading.ts`'s `stateOf` (`:250`). That rule already answers *is this agent available*, already handles the merged-slice case the plan's table gets wrong, already refuses a non-running agent, and already renders the word `free` on the board. `queue-reading.ts:226` even sources `sliceHasMerged` for exactly this.

The honest defect is narrower than the plan's: **`stateOf` asks `world.workerAlive(entry.worktree)`**, which routes to `plot-worker-state.sh`, which answers `finished` for a live free loop. So the shell's `finished` poisons the domain rule that would otherwise be right. The fix belongs where the process reading is wrong — the `plot_worker_agent_alive` arm for a desk whose loop is alive and has never had a `claude` child — and it needs a discriminator that is a **measurement of the process**, not a re-reading of a manifest field that four other things write.

`.plot-worker.wrapper.pid` (`:848`) is the existing precedent for "what proves a worker really ran here", and the free/dispatched split wants something of that kind: a launch-time fact the free-agent path writes and the dispatched path does not. The plan never considers one.

## The one thing the plan gets right, and it should survive

The root-exclusion analysis (§"The reading, and why it is wrong for this population") is correct and well-argued: *absent is not false*, a free agent's missing `claude` child is its normal state, and the code reads one of two meanings. Keep that. Replace the discriminator.

## What would move me

- A measurement, with the supervisor alive, showing a free agent stable at `branch: ""` for longer than the hand-over window, and a statement of what distinguishes it from the `clear_manifest_branch` window at `:2163`.
- A declared corpus pair against `isAgentFree`, per `docs/shell-and-domain.md`, or a plan that calls the domain rule instead of duplicating it.
- A different word, since `free` is taken by `agentAvailability`.
