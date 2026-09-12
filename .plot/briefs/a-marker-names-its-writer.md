## Implementation brief — a-failed-gate-becomes-a-correction (wave 3: A marker names its writer)

- **Plan (canonical):** `docs/plans/2026-09-12-a-failed-gate-becomes-a-correction.md` on `main`
- **Approved:** 2026-09-12, jwloka, in-session
- **Branch:** `feature/a-marker-names-its-writer` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

This wave is **independent of both siblings** — a marker gains a field whether or not corrections exist. Wave 1 (`feature/an-absent-agent-is-noticed`) merged as **#900**; wave 2 (`feature/a-failed-gate-becomes-a-correction`) is claimed and in flight. Do not wait for wave 2 and do not implement any of it. Wave 2's own brief defers the marker's field set to this branch by name — *"If you find yourself wanting the writer's identity in the marker, that is the sibling's work"* — so this branch owns that field set and wave 2 will not be editing it.

### What to build

**A `PLOT-BLOCKED` marker carries no writer identity, and a marker written by one branch's worker into another's tree made a finished branch read as blocked.** Measured 2026-08-20 in `plot-wt-bug-the-timeout-test-does-not-race-the-clock`: a marker appeared reading *"Wrong worktree - need reassignment from bug/the-timeout-test-does-not-race-the-clock to bug/the-timeout-report-drops-what-it-cannot-measure"* — written by the OTHER branch's worker, into that tree, mid-session. The fleet scan reads the marker from the TREE, so the tree's own finished branch read as awaiting a person, and the only way to tell was a human reading the prose and recognising a branch name that was not theirs.

That was tolerable when markers were rare and written at the end. Wave 2 makes the fleet write more of them, so the ambiguity gets worse exactly as the volume rises — which is why this slice sits in this plan rather than in its own.

Build: **every `PLOT-BLOCKED` marker names the branch and the agent that wrote it.** There are TWO writers, and they are in different states of repair — see the next section, because treating them as one change is the way this slice goes wrong.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**There are two marker writers, and only one of them is missing the branch.** Find both before editing either:

- `skills/plot/scripts/plot-worker-loop.sh:423` — `write_blocked_marker`, called once at `:1682`. Its text names the branch already (`` the worker prompt for `${PLOT_BRANCH:-?}` ``) but names **no agent**.
- `packages/domain/src/workflows/supervise.ts:245` — `stopNotice`, the supervisor's marker body. It names the branch already (`` the agent on `${supervision.branch}` ``) and also names **no agent**.

So "name the branch" is largely already true and "name the agent" is the real change. A brief-reader who assumes both fields are missing everywhere rewrites two strings that are already correct and produces a diff that says nothing.

**`QUESTION_MAX = 120`, and it is the constraint that shapes this slice.** `packages/domain/src/adapters/agents/agents-fs.ts:40` caps the marker's rendered question; `firstMarkerLine` (`:125`) takes the **first non-empty line**, strips leading comment syntax, and truncates with an ellipsis at 120 characters. The loop's current marker head is **357 characters once expanded** (measured 2026-09-12) — it already truncates on the board today, to the first 119 plus an ellipsis. Prepending `branch=… agent=…` to that first line would push the actual question out of the 120 entirely, so the identity **goes on its own line, below the question**, or the field arrives by destroying the thing it annotates. Measure the rendered first line; do not reason about it.

**The agent's identity is its session id, not a name.** `packages/domain/src/entities/agent.ts:70` — *"The session id the dispatcher minted — the identity, and the transcript's name."* Not the branch, the worktree or the pid: `:66` states each of those changes while the agent lives. `$PLOT_SESSION_ID` is the loop's copy of it.

**An absent identity reads as unknown, never as a fabricated one.** `$PLOT_AGENT` may be unset — `plot-worker-loop.sh:920` states *"`$PLOT_AGENT` unset"* is a supported shape, a hand-started loop has no dispatcher, and `session_handle` (`:563`) returns non-zero when there is no handle to print. A marker that invents an identity for an agent that declared none is worse than one with no field, because the next foreign-marker incident would be debugged against a name nobody minted. `identityWasDeclared` (`entities/agent.ts:174`) is the estate's existing word for this distinction — `manifest` versus inferred.

**The supervisor's writer needs a new READING, not just a new string.** `Supervision` (`rules/supervision.ts:131`) carries `branch`, `worktree`, `failures`, `correction`, `resume`, `nextAttempts` — and **no session**. `SupervisionReadings` (`:31`) carries none either. So naming the agent in `stopNotice` means threading the session through the rule, which is the actual work of this half; an implementer who only edits the template string will find nothing to interpolate. Add it as a reading, because the session is measured of the agent rather than derived from the verdict.

**The marker is never overwritten, and that guard stays.** `write_blocked_marker:427` returns early on an existing file, and its comment gives the reason: *"A marker already in the tree is an agent's own question to a person, and replacing it with Plot's would answer a question nobody asked."* This means the new fields reach **new** markers only — a marker already standing keeps its old shape, and that is correct, not a migration gap. Do not add a rewrite pass.

**The marker is a `PLOT-BLOCKED*` FILE and matched BY FILENAME, never by contents.** `agents-fs.ts:145` states the rule and the defect it fixes: a grep for the token matched a brief or a CLAUDE.md that merely documented it and surfaced the mention as a worker's question. Whatever field syntax you choose, it must not make the file's *contents* the thing a reader matches on. Root only — `readMarkers` mirrors `plot_worker_blocked` and matching at depth would re-admit looseness the board removed deliberately.

**A field a reader must parse is a second contract.** The marker's body is read by a **person** — `supervise.ts:233` says so outright, *"read by a person rather than by an agent"*. The board's only machine read is `firstMarkerLine`, which takes one line and does not parse fields. Prefer a shape a person reads correctly at a glance over one a parser reads exactly; if you do add a parseable form, say in the code what reads it, because a field nothing reads is the defect `plot-board-probe.sh`'s `node_ok` already recorded on this estate.

**Rules carried over unchanged:** absent is not false — no `$PLOT_AGENT` means *undeclared*, not *no agent*. Read the exit code, not the emptiness: `session_handle` signals absence by returning non-zero, so `PLOT_SESSION_ID=""` after it is a real value and not a failure to check. And a marker you did not write is not yours to answer — the rule this whole slice exists to make mechanical.

### Done when

The plan's `## Slices` entry for this wave is the specification: branch and agent on every `PLOT-BLOCKED` marker.

Then lift these, which exist because a naive implementation would pass without them:

- **The rendered first line still carries the question after the field is added.** Assert against `firstMarkerLine` at `QUESTION_MAX`, not against the file's raw text. Catches putting the identity on the first line, where the 120-character cap silently deletes the question the marker exists to ask — the defect this slice is most likely to ship.
- **Both writers name the agent.** Catches editing `write_blocked_marker` and leaving `stopNotice` alone, or the reverse. Two writers, one property.
- **A marker written with no declared agent says so, and names no session.** Catches interpolating an empty `$PLOT_SESSION_ID` into a field that then reads as an agent called nothing.
- **An existing marker is not rewritten when a second block fires.** Catches "fixing" the no-overwrite guard to migrate old markers.
- **A `PLOT-BLOCKED` mention inside a brief or a doc is still not a marker.** Catches a field syntax that tempts a contents-based match.

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm test                    # skills parse
pnpm run test:contracts      # helper estate + CI gates
pnpm run test:board          # rebuilds the artifact, then its tests
pnpm run typecheck
```

`pnpm run test:e2e` is **CI's gate, not a local one** — do not run it. A changeset is required: `'plot': patch` with a `bumps:` block for the skills touched, description FIRST and `bumps:` LAST. A `packages/domain` or `packages/board` change instead uses `'@plot-pm/board': patch` with no bumps block. If you touch `packages/domain/**`, new functions are **arrows**, and the unit is the function, not the file — passing through a declaration does not make it yours to convert.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading. Measured 2026-09-08: three slice PRs opened with `gh pr create` each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append the number to this branch's line in the plan's `## Branches` section on `main`. **This plan annotates inside the wave heading** — `(Branch: feature/a-marker-names-its-writer, PR: #N)` — matching its two siblings; a trailing `→ #N` on a heading line parses as `prs=[]`.

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-worker-loop.sh` — `write_blocked_marker` and its one call site, and nothing else in that file
- `packages/domain/src/workflows/supervise.ts` — `stopNotice`
- `packages/domain/src/rules/supervision.ts` — the session reading, if that is how you thread it
- the new or extended tests
- `.changeset/`

**Do not touch** the correction path, the attempt budget, the build monitor, or `plot-build-monitor.sh` — that is wave 2 (`feature/a-failed-gate-becomes-a-correction`), in flight now. It edits `plot-worker-loop.sh` too, so **expect a conflict in that file** and keep your diff to the marker function and its call site; a wider edit turns a two-hunk conflict into a rebase nobody can review. Wave 2's brief already states it will not touch the marker's field set.

Other branches in flight, verified at dispatch: `feature/a-failed-gate-becomes-a-correction` (wave 2, overlaps in `plot-worker-loop.sh` only) and `changeset-release/main` (the bot's release PR). `.changeset/` holds siblings' changesets — add your own, touch none.

If you find something the plan did not anticipate, report it rather than improvising outside scope. Two of the plan's Open Questions are deliberately unanswered and are **not** yours to settle: whether a correction counts against `Worker bound`, and whether a repo-gate failure uses the same path as a CI failure.
