# The outer boundary is a port

> The layering rule says scripts may only be called from an adapter. **Nine board-server files name a Plot script directly**, and the spawn ratchet cannot see them: a script reached through a helper is one spawn line however many scripts flow through it.

## Status

- **State:** Approved
- **Type:** infra
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #787 merged
- **Started:** 2026-09-07, Jan Wloka, `infra/a-script-is-named-in-an-adapter`

## Changelog

- Every external dependency is reached through a port named for the domain concept it holds and shaped as the DDD pattern it is — repository, service, factory or aggregate — and a gate names the ones that are not.

## Motivation

**Measured 2026-09-07, in `packages/board/src` outside `adapters/`:**

| dependency | sites |
|---|---|
| filesystem (`readFileSync`, `writeFileSync`, `existsSync`, …) | **132** |
| executables (`spawn`, `execFile`) | **19** |
| network (`fetch`, `createServer`) | **2** |
| files naming a `plot-*.sh` directly | **7** |

**THE DOMAIN IS ALREADY CLEAN.** Zero real I/O calls in `packages/domain/src` outside `adapters/` — the purity gate holds, and it holds by import (`from 'node:…'`), which is the right check for that boundary. **The breach is entirely in the board.**

**AND THE EXISTING RATCHET CANNOT SEE THE WORST OF IT.** `ci.yml:259` counts spawn *sites*: 19 against `allowed=28`, so it reads healthy. But `registry.ts:318` declares `const WORKER_STATE_SCRIPT = 'plot-worker-state.sh'` and passes it to a helper that spawns `sh`. **The syscall names `sh`; the dependency is a Plot script.** One spawn line, any number of scripts.

Seven files do this: `auto-deliver.ts` (three scripts), `registry.ts` (two), `dispatch.ts`, `approve.ts`, `fleet.ts`, `resolver.ts`, `supervisor-reading.ts`.

**THE LAST OF THOSE SHIPPED TODAY.** `supervisor-reading.ts` was written this session to answer *is a supervisor loaded*, and it shells to `plot-fleetctl.sh` from the server. **The plan that demanded the reading come from `--status` put the call in the wrong layer**, and nothing refused it — which is the argument for the gate rather than for more care.

**FIVE PORTS ALREADY COVER MOST OF THIS GROUND.** `scripts` (11 ops), `trees` (11), `refs` (22), `processes` (4), `plan-store` (4), and **20 board files already import the domain**. So this is a migration against existing seams, not a design exercise.

**WHAT HAS NO PORT IS THE FILESYSTEM.** `trees` answers *worktree* questions — `list`, `isClean`, `markers`, `dirtyPaths`. Reading a manifest, writing a pidfile, checking a marker's existence: 132 calls with no port between them and `node:fs`.

**AND THE FILES ARE NOT GENERIC — EACH IS A CONCEPT THE DOMAIN MOSTLY ALREADY HAS.** The paths the board spells out, counted 2026-09-07:

| artefact | sites | the concept | in the domain? |
|---|---|---|---|
| `PLOT-BLOCKED*` | 21 | the question an agent asked a person | `entities/agent.ts` |
| `.plot-worker.pid` / `.log` | 6 | the worker's process record | **no entity** |
| `.plot-worker.exit` | 2 | the ending | `entities/ending.ts` |
| `.plot/agents/*.json` | 2 | the agent manifest | `entities/agent.ts` |
| `last-pulse.json` | 4 | the pulse | `entities/pulse.ts` |
| `.plot/state/*` | — | run state | **no entity** |

**SO A FILESYSTEM PORT IS THE WRONG ABSTRACTION FOR MOST OF THIS.** A port with `read(path)` and `write(path, bytes)` moves 132 calls behind an interface and names nothing: the board would still spell `PLOT-BLOCKED` and `.plot-worker.pid`, just one layer down. **The path is the leak, not the syscall.**

**EACH ARTEFACT IS A CONCEPT, AND MOST ARE NAMED ALREADY.** What is missing is not a file API — it is that `Agent`, `Ending` and `Pulse` have no way to be *stored and retrieved*, so every caller reconstructs the path. **A concept whose persistence nobody owns is spelled by everybody.**

## The four shapes exist and none is named

**Settled in [DESIGN-tactics.md](../stories/the-master-agent-holds-the-fleet/DESIGN-tactics.md), written with this plan.** `Repository`, `Factory` and `Aggregate` appear **zero times** in `packages/domain/src`, and all four shapes are in use: `plan-store` is a repository, `host` and `tracker` are services, `prCreate` and `trees.add` are factories, `Plan` owns `Slice[]` as an aggregate.

**The design names them; this plan adopts them.** What matters here is the consequence the design records: **`scripts` mixes all four** — `planMeta` (a repository read), `config` (settings), `host` (a service call), `start` (a process launch) — so a caller holding it can reach anything, and nothing at a call site says which boundary was crossed.

**That is how the counts above accumulated behind a gate that reads healthy.**

## What this is not

**Not a rewrite of the board.** 132 fs sites do not move in one slice, and a plan that says they do is a wish. The gate lands first and the migration is a ratchet, exactly as the spawn count was.

**Not a claim that the current code is wrong to work.** It works. What is missing is anything that stops the number growing — and it grew today, by one file, written by someone who had just read the rule.

**Not a new purity gate for the board.** The domain's rule is *import nothing but zod*; the board's cannot be, because the board is where adapters are wired. The board's rule is narrower: **name no external dependency that a port already answers.**

## Slices

### The script gate names what the spawn ratchet cannot (Branch: infra/a-script-is-named-in-an-adapter)

A gate refuses a `plot-*.sh` literal outside `packages/domain/src/adapters/`.

**IT GREPS FOR THE NAME, NOT THE CALL.** That is the whole point: the spawn ratchet watches syscalls and this watches dependencies. A script named in a constant, passed to a helper, spawned as an argument to `sh` is invisible to one and obvious to the other.

**IT IS A RATCHET, NOT A REFUSAL.** Seven files hold one today. The allowance starts at seven and may only fall — the shape `ci.yml:259` and `check-state-declarations.sh` both use, and the reason both work.

**THE ERROR NAMES THE PORT.** *"`plot-worker-state.sh` is named in `registry.ts`; the `processes` port answers this."* A gate that says only *you crossed a line* leaves the reader to find the seam.

**Done when** a gate counts `plot-*.sh` literals outside `adapters/`, fails when the count grows, starts at the measured seven, and its error names the port that already answers each script.

### The agent gets a repository (Branch: feature/the-agent-gets-a-repository) <!-- waits: feature/an-agent-state-has-one-deriver -->

The artefacts the board reads become ports named for **the concept**, not for the file.

**NOT A FILESYSTEM PORT.** `read(path)` / `write(path, bytes)` would move 132 calls and name nothing — the board would still spell `PLOT-BLOCKED` one layer down. **`plan-store` is the model already in the estate**: four operations about *plans*, not about files, and no caller composes a path.

**ONE CONCEPT IN THIS SLICE, AND THE REST FOLLOW ITS SHAPE.** `Agent` is the candidate: 21 of the sites are its `PLOT-BLOCKED` marker and 2 more its manifest, it has an entity already, and `registry.ts` — the file that reaches two scripts and reconstructs both paths — is its principal caller.

**THE OPERATIONS ARE THE CONCEPT'S OWN QUESTIONS.** *Does this agent hold a question for a person?* *What did the registry write about it?* Not `existsSync` and `readFileSync` with a marker name in the argument.

**WHAT HAS NO ENTITY GETS ONE, AND ONLY THEN.** The worker's pid and log have no domain concept — round 1 of `an-agent-state-has-one-deriver` already found `Worker` living only as eight words in a shell script. **An entity arrives when a port needs one**, which is the rule that cut `GitHost` from the ports plan; here the port does need it.

**THE PATH IS THE LEAK AND THE ADAPTER IS WHERE IT LIVES.** After this slice exactly one file knows that an agent's question is a file called `PLOT-BLOCKED.md` in a desk.

**IT IS A REPOSITORY, AND CALLING IT ONE IS PART OF THE SLICE.** `plan-store` is the working example and is named for its storage rather than its pattern. **An `AgentRepository` returns whole `Agent`s by identity** — its question, its manifest, its process record — and nothing else composes a path.

**WHETHER `Agent` IS AN AGGREGATE ROOT IS A REAL QUESTION AND THIS SLICE ANSWERS IT.** An agent has a desk, a worker, a question and an ending. If those are loaded and written together they are one aggregate and the repository returns the root; if the board legitimately reads a marker without the manifest, they are not. **Decide by measuring the callers, not by preference**, and say which in the PR.

**Done when** an `AgentRepository` returns whole agents by identity, its adapter is the only place an agent's paths appear, the aggregate boundary is stated with the callers that justify it, one caller is migrated, and a ratchet counts the artefacts still spelled outside `adapters/`.

## Notes

### Why the spawn ratchet passing is the finding — 2026-09-07

`ci.yml:259` reads **19 of 28** and looks healthy. It is measuring honestly and answering a different question: *how many places call a process*, not *how many dependencies cross the boundary*.

**A helper is enough to make one invisible to the other.** `registry.ts` spawns `sh` once and reaches two Plot scripts through it. That is not evasion — it is a sensible helper — and it means a count of syscalls can fall while the number of crossings rises.

**The measurement that matters is the name, and nothing counts names today.**

### The file this plan was written from — 2026-09-07

`supervisor-reading.ts` shells to `plot-fleetctl.sh` from the board server. **It was written this session**, hours after its own plan quoted the layering rule, by an author who had just read *"scripts can only be called from an adapter implementation."*

**That is the case for a gate stated as plainly as it can be.** The rule was known, recent, and quoted in the plan — and the violation shipped anyway.

### Why a concept per dependency, and not one port per API — 2026-09-07

Three generic ports would satisfy the letter of the layering rule: a `Files`, a `Processes`, a `Network`. **All three would leave the domain no better off**, because the thing that leaks is not the syscall — it is the knowledge of *what is stored where*.

`registry.ts` reconstructs the path to `plot-worker-state.sh` and to a `.plot/agents/*.json`. Behind a `Files` port it would still reconstruct both, one layer down, and a reader would still learn what an agent manifest is called by reading a controller.

**The estate already proves the alternative works.** `plan-store` has four operations, none of them a file verb, and **no caller composes a plan's path**. `trees` answers `markers` and `dirtyPaths` rather than `readdir` and `stat`. `refs` carries 22 operations about branches and none about `git`.

**So the test for each new port is the same one those pass:** can a caller use it without knowing where the thing lives? A `Files` port fails that by construction; a port named for `Agent` cannot.

**And it is cohesive in the direction that matters.** Once an agent's question, its manifest, its process record and its ending are one concept's port, a rule can ask *what does this agent owe* without four callers each knowing a different filename — which is the same argument `an-agent-state-has-one-deriver` makes about its eight states, arriving from the storage side.

### Why the patterns are named rather than introduced — 2026-09-07

The argument lives in [DESIGN-tactics.md](../stories/the-master-agent-holds-the-fleet/DESIGN-tactics.md) and is not repeated here. The part this plan depends on is its test for a port:

> **Can a caller use it without knowing where the thing lives?**

`plan-store` passes — nothing outside it composes a plan's path. **A `Files` port with `read(path)` fails by construction**, which is why this plan proposes a repository for a concept rather than a wrapper for an API.
