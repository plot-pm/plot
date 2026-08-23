## Implementation brief — the-registry-names-a-live-agent (wave: Stamped)

- **Plan (canonical):** `docs/plans/2026-08-23-the-registry-names-a-live-agent.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session (four interrogation rounds)
- **Branch:** `bug/the-registry-names-a-live-agent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention

Single wave, single branch. **`bug/a-marker-is-a-file-not-a-mention` is in
flight and should land first** — it fixes the classifier whose answers your
Fix B will start collecting. Nothing here depends on it; if it has merged,
rebase onto it, and if not, ignore it. Do not touch its files.

### What to build

Three fixes to the agent registry, each measured. The plan is canonical; this
says which alternatives are already dead.

### The decisions the plan settles — do not re-derive them

**Fix A — the launch stamp must UPDATE, not only fill.** `plot-dispatch.sh`
writes `"pid": ""` and the detached wrapper fills it with `awk` matching the
literal placeholder line. It therefore fires **once per manifest, forever**; a
relaunch in the same worktree leaves the previous pid in place.

**THE PATH THAT MATTERS IS NOT THE DISPATCHER'S.** `/api/continue` — the board's
*Continue with an answer* button — spawns directly (`continue.ts:521`) and writes
`.plot-worker.pid` itself (line 544). It never runs `plot-dispatch.sh`. A fix to
the `awk` alone would not fire on the path that produced the reported defect.
`/api/continue` already holds both pids (it returns `pid` and `previousPid` to
the client, reading the previous from the pulse) and writes neither.

So: **one contract, two implementations** — `pid`, `startedAt`, `previousPid`,
`relaunches`. `continue.ts` calls a TypeScript helper; the dispatcher's detached
`sh -c` cannot reach one and keeps inline `awk` against the same fields. **A test
asserts both paths produce an identical manifest.** That is what holds two
implementations to one contract — the `plot-worker-state.sh` pattern, adopted
after five of six states drifted while duplicated.

Persist `previousPid`/`relaunches` rather than only overwriting: a branch
restarted three times is a signal nothing on the board can express today.

**Writes are atomic and deliberately UNLOCKED.** Temp file + rename in both
writers, as the dispatcher already does. `relaunches` is a read-modify-write and
takes no lock: a lost increment costs an inaccurate diagnostic count, a torn
manifest costs the entry. Do not add a lock — that trade was made explicitly.

**Fix B — the pid gates a question whose answer never uses it.**
`refreshStates` (`registry.ts:259`) filters `e.pid !== '' && e.worktree !== ''`,
but `bashLiveness` passes the **worktree path** and `plot_worker_state` reads
`$wt/.plot-worker.pid` for itself. Drop the pid from the filter; keep
`worktree !== ''`. Measured: 9 of 22 entries name a worktree that exists and are
skipped anyway.

**There is NO pid-recycling bug.** An earlier draft claimed `kill -0` on a stale
manifest pid could report a stranger as `running`. **False** — the manifest pid
never reaches a liveness check. It came from `registry.ts:12`, whose docstring
says *"the pid answers `kill -0`"*. **Correct that docstring**; a comment that
misdescribes its own function already produced one wrong plan. Do not implement
a launch-time sentinel — with the recycling claim dead there is nothing for it
to defend.

**Fix C — absence of a manifest is not evidence of absence of an agent.**
28 worktrees, 22 manifests. Round 4 measured what the six are: **3 are real
dispatches from 08-20** (worker logs, pid files, from the boundary where
manifests began), **1 is `plot` itself** — the main repo — and **2 are scratch
dirs**. **None has a live worker**, so this rescues no invisible live agent
today; it prevents a class. Say so rather than overselling it.

The argument that holds: the registry cannot tell *why* a manifest is absent —
pre-registry dispatch, deleted by hand, made outside the dispatcher, a failed
write — and only one of those means no agent was ever here. Three of the six
carry positive evidence a worker ran.

**Two exclusions, without which this adds noise rows to the section it exists to
make truthful:**
- the **main repo** is not an agent (`git worktree list` includes it);
- a worktree with **no branch** is not an agent row (detached or unreadable).

**A synthesized entry must not invent what it does not have:** `session` is `''`
(it is the transcript's name, minted at launch — `AgentEntrySchema` needs a
default for it), `command` and `startedAt` are `''` (a start time guessed from
mtime would read as a launch record and be false), transcript fields absent per
the existing *costs fields, not entries* rule. **A manifest wins** where one
names the worktree; nothing is synthesized for that path.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a naive implementation would pass without them:

- **`/api/continue` updates the manifest** — asserted against that route, not
  only the dispatcher. A dispatcher-only fix passes every dispatcher assertion
  and leaves the reported bug.
- **Both writers produce an identical manifest** for the same inputs.
- **`relaunches` increments across TWO relaunches** — catches an implementation
  that sets `previousPid` correctly but never counts.
- **A pid-less manifest with a live worktree is classified** — this is Fix B,
  and a stamp-only fix leaves all nine `unknown`.
- **The main repo and a branchless worktree do not render as agents.**
- A **first** dispatch is byte-identical to today.
- An entry with **no worktree** still lists as `unknown` — the contract, even
  with no instance in this repo today.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. When the PR is created, append
`→ #<number>` to this branch's line in the plan's `## Branches` section **on
main** — verify `git branch --show-current` is `main` before that edit.

### Scope guard

You own `packages/board/src/server/registry.ts`,
`packages/board/src/server/continue.ts` (the manifest write only — do not
redesign the route), `skills/plot/scripts/plot-dispatch.sh` (the stamp only),
`packages/board/src/contract/schema.ts` (the `session` default and the two new
fields), and their tests.

`bug/a-marker-is-a-file-not-a-mention` is live in
`skills/plot/scripts/plot-worker-state.sh` and
`packages/board/src/server/worker-question.ts`. **Do not touch either.** You
read `plot-worker-state.sh` through `bashLiveness`; that is a call, not an edit.

**Do not change the registry's empty PR fact.** It passes `''` because it must
not be behind anything that can fail. That is deliberate and is not in scope.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
