## Implementation brief — an-agent-remembers-its-session (wave Remembering)

- **Plan (canonical):** `docs/plans/2026-08-31-the-registry-supervises-its-agents.md` on main
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/an-agent-remembers-its-session` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** in-session, per the plan's `Review:` field

The plan's third wave. `Declaring` landed as **#609** — `packages/domain/src/entities/declaration.ts` holds `DECLARATION_FILENAME` (line 9), `DeclarationStatusSchema` (line 18), `DeclarationSchema` (line 31) and the four-outcome `DeclarationReading` (line 75). `Judging` landed as **#629** — `packages/domain/src/rules/gates.ts` holds the `Gate` type (line 87), the five gates, `ALL_GATES` (line 214), `gateFailures` (line 234) and `passesGates` (line 246). **Consume both.** This slice makes a correction deliverable; the two waves after it are gated on a measurement and are not yours.

### What to build

The resume path's three parts, and nothing that supervises:

- **Export `PLOT_SESSION_ID`** to the worker — already done at `plot-dispatch.sh:617`, so verify and test it rather than adding it.
- **Document the `--session-id` the adopter's prompt file must pass**, since Plot does not own that invocation.
- **Add `resumeId` and `attempts` to the manifest**, and **detect whether resume is available at all** by looking for the transcript.

### The decisions the plan settles — do not re-derive them

**PLOT DOES NOT OWN THE INVOCATION, AND AN EARLIER DRAFT ASSUMED IT DID.** The `claude -p` call lives in `.plot/worker-prompt.sh`, which **belongs to the adopting project**. Plot cannot add `--output-format stream-json` to it, cannot assume the harness is `claude`, and must not quietly require either. The contract is split across that boundary and the plan draws it:

```
Plot           → PLOT_SESSION_ID in the worker's environment
adopter's file → claude -p "…" --session-id "$PLOT_SESSION_ID"
Plot           → checks whether a transcript for that id exists
```

**THE CHECK IS THE GATE, NOT THE DOCUMENTATION.** If no transcript appears for the asserted id, the adopter did not pass it or uses another harness, and **resume is simply unavailable** — fall back to a fresh worker with the gate failures written into its brief. The plan is explicit about why: *"A resume path that silently did nothing would be worse than not having one, because a supervisor would report a correction it never delivered."*

**THE CHECK ALREADY EXISTS AND ANSWERS EXACTLY THIS.** `transcriptFile(dir, sessionId)` (`packages/board/src/server/transcript.ts:77`) joins on `${sessionId}.jsonl` and returns `null` when that file is absent — its own docblock says *"A session id, when the caller has one, is exact and needs none of that guessing."* Use it; do not write a second matcher. `transcriptDir` (line 58) resolves the directory from a cwd.

**PLOT ASSERTS AN ID RATHER THAN CAPTURING ONE.** `plot_session_id` (`plot-dispatch.sh:236`) generates a UUID in the shape the runtime uses for its transcript filename, and the board joins on exact string equality. It is a guess that works only if the prompt passes it through — which is why the transcript check is the gate.

**`session` AND `resumeId` ARE TWO FIELDS, NOT ONE.** `session` is the transcript join key and **stays fixed across branch hops**, by design. The resume handle is a different identity with a different lifetime, and the plan states the consequence plainly: whether it should follow a hop *"cannot even be asked if one field carries both meanings."* They will usually hold the same value; **do not assume they always do**, and do not collapse them.

**`attempts` IS DISTINCT FROM `relaunches`, AND `relaunches` ALREADY EXISTS.** `plot-dispatch.sh:632` increments `relaunches` on an operator-initiated `--restart` — a human's record. `attempts` is the supervisor's own bound, `relaunch IF attempts < MAX_ATTEMPTS (default 2)`. Two counters, two meanings; merging them would let a person's restart consume the daemon's budget.

**THE MANIFEST IS WRITTEN BY `awk` INSIDE A SINGLE-QUOTED `sh -c`.** `plot-dispatch.sh:277` prints `"session"`, and the relaunch path rewrites `"relaunches"` through `awk` at lines 632–655. New fields join that machinery. Note the quoting depth before editing: the wrapper body is single-quoted and the `awk` program is nested inside it.

**THIS SLICE SUPERVISES NOTHING.** The `Supervising` wave is deferred behind a measurement gate that the plan turns on its own history — *"this plan is about to build a daemon on the belief that Declaring and Judging will not be enough. That belief is untested."* Build the resume capability and prove it; do not build a tick, a bound, or a daemon.

### Done when

- **A `--resume` with a correction continues the same conversation** — same session id, and the second attempt does not redo work the first attempt did. Assert both halves.
- **When the adopter's prompt does not pass `--session-id`, resume reports itself unavailable and a fresh worker starts with the failures in its brief** — asserted against a prompt file that **deliberately omits the flag**, because that is the configuration Plot cannot control and therefore the one most likely to be wrong in the field.
- `resumeId` and `attempts` appear in the manifest and survive a branch hop the way the plan requires — `session` stays fixed; state what `resumeId` does and assert it.
- `attempts` does not increment on an operator `--restart`, and `relaunches` does not increment on a supervisor retry. Assert them separately.
- A gate failure message is **legible as a prompt** — checked by reading one, not by asserting a substring.

### Repo gates

Node 24 (`nvm use`). `pnpm test`, `pnpm run test:reconcile`, `pnpm run typecheck`. Run `pnpm run test:board` — the manifest is read by `packages/board/src/server/registry.ts`, so a new field reaches the board.

**The root `pnpm run typecheck` is board-only** — it is `pnpm --filter @plot-pm/board typecheck` and never reaches `packages/domain`, whose own tsconfig typechecks its tests. A change touching the domain package also needs `cd packages/domain && npx tsc --noEmit`. Measured 2026-09-02: a test passed the root script and failed CI on `TS2339`.

**Do not run `pnpm run test:e2e`** — it is CI's gate, it dispatches real workers, and two concurrent local runs took this machine to load average 8.69.

### Changeset

`'plot': minor` — new capability, not a fix. **Description first**, `bumps:` block last: Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide differential fails.

### Scope guard

**This branch owns** the session export and its documentation, the two new manifest fields in `skills/plot/scripts/plot-dispatch.sh`, the resume-availability check, and their tests.

**It does not own** the envelope's contract (#609, landed), the gates (#629, landed), the daemon (`Supervising`, deferred behind a measurement), or the launchd/systemd unit (`Watching`, deferred behind that).

Report anything the plan did not anticipate rather than improvising outside scope.
