## Implementation brief — one-cap-holds-across-boards (wave 1: The dispatch-to-visible window is observable across boards)

- **Plan (canonical):** `docs/plans/2026-09-11-one-cap-holds-across-boards.md` on `main`
- **Approved:** 2026-09-11, Jan Wloka, plan-PR #887 merged
- **Branch:** `bug/one-cap-holds-across-boards` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

This is the plan's only branch. Nothing waits on it and it waits on nothing.

### What to build

Make a branch that one board has just dispatched count against the cap on a **second** board, before that board's next pulse decides. Today it does not, and the fleet reaches `2 × parallelAgents` between two boards on one repository.

The registry half already works. `fleet.ts:2928` sets `entry.agents = readAgentRegistryWithInfo(...)`, so both boards count live agents from the **shared** registry directory, and `liveAgentCount` is a pure function of that reading — `parallelAgents − live` is the same number whoever asks. Re-verified 2026-09-11; the plan's first draft misdiagnosed this and the correction stands.

The gap is the window between *dispatched* and *visible*. `plot-dispatch.sh` is spawned detached, so a branch dispatched on one pulse shows neither manifest nor claim ref on the next. `auto-dispatch.ts:304` names the consequence in the field's own docstring — *"counting only the registry would dispatch it a second time and reach 2N"* — and covers it with `inFlight`. That set is `entry.autoInFlight`, and `fleet.ts:567` says what is wrong with it for this purpose, in its own words: **"IN MEMORY AND NOWHERE ELSE."** One board's in-flight set is invisible to the other, so the guard that prevents 2N on a single board prevents nothing between two.

The plan is canonical; this brief orients and records what is already settled.

### The decisions the plan settles — do not re-derive them

**DO NOT RE-ADD A CLAIM REF AT DISPATCH.** This is the plan's hardest constraint and it is stated as a prohibition because the mechanism is otherwise the obvious one. A ref pushed at dispatch would make the branch visible to every board immediately — and `plot-dispatch.sh:2570` records that the hand-over **stopped** pushing one when dispatch became a hand-over to the registry. Verified 2026-09-11: `grep -n 'git push' skills/plot/scripts/plot-dispatch.sh` returns **one** line, and it is `plot-push-main.sh` in an unrelated path. No claim ref is pushed anywhere. If the chosen mechanism starts to look like a claim ref, that is the signal to re-open `the-registry-queues-a-brief` rather than to proceed here.

**The cost of that removal is already recorded, so do not re-measure it.** Same passage: *"two runs left two identical `Started:` records in one plan"* (measured 2026-09-04). The `Started:` guard at `plot-dispatch.sh:2565` is what absorbs it now, by matching the branch name rather than the date.

**`pruneInFlight`'s expiry is already weaker than its own comments say — and that is where "must expire" gets its teeth.** `auto-dispatch.ts:717` retires a mark when the pulse confirms the branch *claimed, merged, gone, or held by a live registry entry*. Its inline comment reads *"the claim ref this dispatch pushes has not appeared"*, and `runAutoDispatch`'s docstring says dispatch *"creates a worktree and pushes a claim"*. **Both are stale relative to the script** — measured above, dispatch pushes nothing. So of the four retirement paths, the claimed-ref one cannot fire, and what survives is a live registry entry or the branch leaving the startable set. Expiry is therefore not new work bolted on; it is repairing a retirement path that already lost a condition. Fix the comments while you are in there.

**A persisted mark has a working precedent in the same directory, and it is not a guess.** The plan's candidate table lists three mechanisms as equals. One of them is already built for a sibling fact: `fleet-settings.ts` shares the cap's **value** across boards through exactly the mechanism candidate #1 proposes.

- `fleetSettingsPath()` → `.plot/state/fleet-controls.json` (`fleet-settings.ts:109`), machine-local, beside the state receipts.
- `readFleetSettings` is read **fresh on every call**, uncached, and its docstring states the property this slice needs: *"that is what makes 'a second board process reads the same values' true: neither process holds authoritative state in memory; both read this file, and the file is the shared answer."*
- `writeFleetSettings` writes temp-plus-`rename`, with **the pid in the temp name**, because *"two board processes on one repo cannot hand each other a torn file"* and *"two writers must not collide on one temp path."*

This does not decide the mechanism for you — the plan leaves that open deliberately, and the open question says *decide during implementation against a real two-board run*. It does mean the persisted-mark option arrives with its concurrency discipline already written and proven, and that a reader-fallback rule and an atomic-write rule exist to copy rather than invent. Weigh it against the other two on that basis.

**An unreadable shared record must start NOTHING.** The plan's Notes settle the failure direction, and it is the one that matters: the tempting fallback is *count what I can see*, which reproduces the bug exactly — a board that cannot read the shared record concludes it is alone and spends the whole budget. Same call `plot-pr-merged.sh` makes: an unreachable host answers *not merged*, so silence is never permission. Note this is the **opposite** direction from `readFleetSettings`, which falls back to defaults on an unreadable file: that fallback is safe because a cap is a number, and this one is not because absence would read as an empty fleet. Copy the mechanism, not that rule.

**Over-marking is the safe direction; under-marking is the bug.** `runAutoDispatch:761` already states it: the script may start fewer than marked, and *"over-marking would only make the board briefly more conservative, never less."* Any new state inherits that asymmetry — when in doubt, hold the mark.

**Rules carried over from the surrounding code** — invariants this estate keeps re-learning:

- **`liveAgentCount` and `liveAgentBranches` must not diverge** (`auto-dispatch.ts:131`, an explicit MUST). The count is the decision and the names are the explanation; a divergence makes the refusal describe a different fleet than the one counted. The plan's `Done when` repeats this.
- **A live agent always occupies a slot, even on a merged branch.** Measured 2026-08-25: eleven workers on merged branches sat at zero CPU for up to ten hours and none counted against the cap. Do not reintroduce "liveness takes two facts."
- **`liveAgentCount` and `freeAgentCount` are two questions, not one.** *Does this agent consume a machine?* protects the cap; *can this agent take a slice?* protects against waiting for a free slot. A landed-branch agent is occupied and free at once. Merging them reintroduces the defect above.
- **`planAutoDispatch` is PURE** — no spawn, no disk, no clock (`auto-dispatch.ts` docstring). It takes **readings as values**: `machine`, `liveCount`, `agents`, `inFlight`, `missingBriefs` are all injected, and `missingBriefs` is injected specifically *"so `planAutoDispatch` stays pure."* Whatever carries the cross-board fact, **read it in the caller and hand it in as a value.** A `readFileSync` inside this function is the one shape to avoid; it is also what makes the cap testable over repeated calls without a live fleet.
- **Absent is not false.** `machine` absent means the question was not asked, which dispatches. `agents` absent means no free agent rather than an error. Follow the same convention for any new input.
- **The layering rule.** A controller calls the domain; only an adapter reaches the world. If the mechanism needs the filesystem, the read belongs where `readFleetSettings` and `readMachine` already are, not inside the rule.

### Done when

The plan's `## Done when` list is the specification. Lifting the assertions that exist *because a naive implementation would pass without them*:

- **Two boards, seconds apart, together start no more than `parallelAgents`.** The whole point. An implementation that shares the live count and not the in-flight set passes every single-board test and fails this.
- **One board alone is unchanged** — the number it starts and the number it shows are what they are today. This catches a fix that buys cross-board safety by making one board more conservative than it was.
- **The in-flight fact expires.** A board that dies mid-dispatch must not hold budget indefinitely. This is the failure the fix trades into, and the assertion is what keeps the trade honest.
- **No claim ref at dispatch.** `grep -n 'git push' skills/plot/scripts/plot-dispatch.sh` must still return only the `plot-push-main.sh` line.
- **`liveAgentBranches` stays consistent with `liveAgentCount`.**

On testing: the registry half needs no two-board test and already has passing ones. **The in-flight half is about time, not readings** — *was this branch dispatched by anyone, recently enough that no ref yet shows it?* — so its test must simulate two deciders against one shared state. `packages/board/test/unit/auto-dispatch.test.ts` already asserts the cap across **repeated pulses** with `inFlight` threaded between them (see the `feature/z`, `feature/y` cases around line 312, and the comment at line 289 about an implementation that *"reaches 2N, 3N…"*). Two deciders is the same shape with two callers over one store; extend that file rather than starting a new harness.

Plus the repo's gates: `nvm use` first (**pnpm crashes on Node 26**), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. `pnpm run test:board` rebuilds the artifact — commit `skills/plot/scripts/board/board-server.mjs` when it changes. **Do not run `pnpm run test:e2e`**; it is CI's gate, not a local one. Add a changeset: `'@plot-pm/board': patch` with the description first (`.changeset/` is often empty in a fresh worktree — copy the format from git history).

### Bookkeeping

- Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still moving). **Do not run `gh pr create`** — it takes the title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/board/src/server/auto-dispatch.ts` — `pruneInFlight`, `planAutoDispatch`'s inputs, the stale claim-ref comments.
- `packages/board/src/server/fleet.ts` — `autoInFlight`'s declaration (~line 571) and the `maybeAutoDispatch` call site (~line 2928).
- Whatever new store the mechanism needs, if any — modelled on `fleet-settings.ts`, not inside the pure rule.
- `packages/board/test/unit/auto-dispatch.test.ts`.

**Out of scope, named in the plan's "What this is not":** the cap's value and its Agents-tab control (`parallelAgents` stays what a person sets — this changes who counts against it); the dispatch lock (`matchQueue` already holds one-slice-one-agent); anything cross-machine (one repository, one machine).

Also out of scope: `plot-dispatch.sh`'s hand-over contract. Candidate #3 in the plan's table — making the registry entry appear synchronously — would change what the script guarantees on return. That is not forbidden, but it is the one candidate whose blast radius reaches outside this branch's files, so choose it only deliberately and say so in the PR.

Nothing else in flight touches these files: the branch does not exist yet on the remote, and the plan is the only one naming it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
