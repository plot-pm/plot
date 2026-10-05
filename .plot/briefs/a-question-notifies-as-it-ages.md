## Implementation brief — an-unanswered-question-escalates (wave 2: A question notifies as it ages)

- **Plan (canonical):** `docs/plans/2026-10-05-an-unanswered-question-escalates.md` on `main`
- **Approved:** 2026-10-05, jwloka, in-session
- **Branch:** `feature/a-question-notifies-as-it-ages` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention. The PR is reviewed as code, and CI is the authority for e2e.

This slice waits on wave 1, which merged as `c9f8c807e` (#1287). It builds on the marker reading wave 1 added (`markerReading` in `packages/board/src/server/worker-question.ts`, `{ firstLine, askedAt }`). Nothing waits on this slice.

### What to build

The notification half of the plan: the registry tick tells a person when a desk's unanswered question passes each configured age, once per age, whatever the agent's loop is doing.

The failure, measured 2026-10-05: the agent on slice 2 of `the-worker-loop-runs-in-js` wrote a question at 13:36 and nobody answered it until 18:20, with auto-dispatch on. `registryd.log` counted `person=0` on all 10,521 ticks. `supervise` (`rules/supervision.ts:269`) answers `leave` for any agent whose loop process is alive before it reads anything else, and a loop that went free after the question stays alive. Nothing in the estate read a question's age or notified anyone.

The parts:

- **`questionEscalation(readings)`** in `packages/domain/src/rules/question-escalation.ts`. Pure and synchronous. It takes the marker's presence and age, the configured ages, and the rungs already recorded for this marker. It returns the highest rung the age has reached and whether that rung is new. Rungs are `listed` (age 0) and `notified-1`, `notified-2`, … (one per configured age).
- **A `Notifier` port** in `packages/domain/src/ports/notifier.ts`: one operation, `notify(message)`, returning a `PortResult`. No runtime code in the port file.
- **Two adapters.** A command adapter that runs the project's `Notify command` with the message in an environment variable, and `notifierNone`, which answers `unaskable` for a repository that declares no command. Add a fixture adapter beside them, as every other port has one.
- **Two Plot Config keys.** `Question escalation`: a comma-separated list of durations, default `15m, 1h, 4h`; an empty value disables notification and keeps the board listing. `Notify command`: the command the adapter runs. Parse the list in the domain, not in the entry point.
- **A `notify` write from the registry tick.** In `packages/board/src/server/entry/registryd.ts`, after `supervise`, call `questionEscalation` for every desk that holds a marker, and add a `notify` write for each new rung to the tick's decision. Apply it where the other writes are applied.
- **`.plot/state/escalations.tsv`** in the main checkout: one appended line per reached rung — desk path, marker modification time, rung, the time, and `sent`, `unaskable` or `failed <code>`. The tick reads the lines for the desks it sees.

The plan is canonical. This is orientation.

### Decisions the plan settles — do not re-derive them

**The marker is the reading, not the loop.** The rule reads the desk's marker and its modification time, and never the loop's process state. A live free loop, a dead loop and an ended loop give the same answer. Do not put the call inside the `supervise` arm for `needs-a-person`: that arm is reached only for agents whose loop is gone or that declared `blocked`, and the 2026-10-05 case was a live loop. The call is per desk with a marker, after `supervise`, for every verdict including `leave`.

**The age is the marker file's modification time.** Not the worker's last commit and not the desk's idle time (memory: *Commit idle time is not liveness*). A new marker has a new modification time and starts again at `listed`.

**The supervisor's own marker write must not reset the age.** `writeBlockedMarker` in `adapters/desk/desk-fs.ts:92` is no-overwrite: an existing marker is a question already asked, so its modification time holds. A change that rewrote the marker on each tick would reset the age every minute, and no rung past `listed` would ever fire. Keep the no-overwrite behaviour, and assert it in a test that spans two ticks.

**One record, because a notification sent twice is the failure.** The tick is stateless today (`registryd.ts:176-189`: "no journal, no lock file"), and that stays true for every decision except this one. The file is append-only and machine-local. A missing or unreadable file reads as "no rung reached", which can notify once more and never stays silent. The other direction, a read that wrongly says a rung is recorded, would swallow a notification, so an unparseable line is ignored rather than trusted.

**The message reaches the command through the environment, never through shell source.** A branch name and a question's first line are text from an agent. Interpolating them into `sh -c` runs whatever an agent wrote. The adapter passes the message in one environment variable and runs the command with the configured string as the program, as `Worker command` is run. Test it with a message holding `$(touch …)`, a backtick and a `;`, and assert the file does not exist.

**A failed command is recorded with its exit code and retried at the next rung, not on every tick.** Retrying each minute turns one broken webhook into 60 failures an hour, each of which may reach a person.

**No `Notify command` gives `unaskable`, and the rung is recorded as not delivered.** The board listing is then the only escalation. `unaskable` is a stated answer; it is never mapped to `sent`. This is the same rule the tracker port follows (CLAUDE.md › The Layering Rule: a silent success reports a notification reaching somebody while nothing left the machine).

**The domain takes readings as values.** `questionEscalation(readings)` imports no port and awaits nothing. The entry point reads the marker, the config and the TSV, passes values in, and sends what comes back to the port. The purity gate refuses a domain import of anything but `zod` outside `adapters/` (`ci.yml:186`).

**What this slice does not do.** It does not release a slice whose question stays unanswered, and it does not answer one. Releasing a claim has no controller (#1276). Both are open questions in the plan; leave them open. It does not change `supervise`, `gates.ts`, or the board's placement rule from wave 1.

**Rules carried over unchanged.** Absent is not false: a missing TSV is "no rung reached", a missing marker is "no question", and neither is an error. Read the exit code, not the emptiness. A function you write is an arrow (`export const f = (…) => …`), in the board too; the unit is the function. A TSDoc block states what an export does, its parameters, its return and how it fails, and keeps the history of the decision out. `Worker` is the process and `Agent` the actor; no new code says `Wave` where it means `Slice`.

### Done when

The plan's slice 2 line is the specification: `questionEscalation`, the `Notifier` port and its command adapter, the `Question escalation` and `Notify command` keys, the `notify` write from the registry tick, and `.plot/state/escalations.tsv`.

Assertions that exist because a naive implementation passes without them:

- **A live free loop with a marker produces a `notify` write at the first age.** This is the 2026-10-05 case. A call placed inside the `needs-a-person` arm passes every other tick test and misses this one.
- **The same tick input with the rung recorded produces no write.** This is the once-per-age rule. An implementation that notifies whenever age ≥ threshold passes the first assertion and sends a message every minute.
- **A tick that crosses two ages at once reports the highest rung and sends one message.** A desk first seen at age 70m with ages `15m, 1h, 4h` gets `notified-2`, not two notifications.
- **A new modification time starts again at `listed`**, and the old marker's recorded rungs do not suppress the new marker's. Key the record on desk path **and** modification time.
- **An empty `Question escalation` gives `listed` only**, and a malformed list (`15m, soon`) falls back to the default or to `listed` only; pick one, state it in the TSDoc, and test it. It never throws and never notifies at age 0.
- **`notifierNone` records `unaskable`**, and the next tick does not retry that rung. Without it a repository with no command writes a TSV line every minute.
- **A failed command records `failed <code>` with a non-zero code** (use 7, so the assertion cannot pass on an empty string) and the next tick does not resend the same rung.
- **A message holding shell metacharacters runs nothing** (the environment-variable test above).
- **A missing, empty and truncated `escalations.tsv` each read as "no rung reached"** without throwing, and the tick still completes (a tick that cannot read reports; it does not throw, `registryd.ts:176-189`).
- **No `listed` notification.** `listed` is the board's rung; the adapter is never called for it.

Mutations worth checking before you push, each of which must fail a test: threshold `>` changed to `>=` at the exact age, the recorded-rung lookup replaced by `false`, the key reduced to the desk path alone.

Plus the repo gates. Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints: the tests that name a changed file, `vitest related` and the typecheck of the board and the domain, the gate tests and the `scripts/check-*.sh` gates. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e`. Never run board tests while the operator's board is open on this machine. The root typecheck skips the domain package: run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` too.

A new port and its adapters are exported through `packages/domain/src/index.ts` and `adapters/index.ts`; the purity gate and the *One place reaches a process* ratchet (`ci.yml:259`, `allowed=28`) apply. The command adapter lives under `adapters/`, so its `spawn` is not counted; a `spawn` in the entry point is, and raises the number the gate fails on.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. The two new config keys are documented in the header comment of `skills/plot/scripts/plot-config.sh`, which is shell: a comment line there counts. Document the keys where the board's settings docs live instead, or remove an equal number of lines elsewhere in the same change. The gate stores no number and has no override. Do not add a `.sh` file; the rule is in the domain and the tick is TypeScript.

Add a changeset with package `@plot-pm/board`, description first, and `plan: docs/plans/2026-10-05-an-unanswered-question-escalates.md` in the trailing comment block. Copy the format from `.changeset/a-question-is-listed-as-waiting-on-you.md`. `./scripts/check-changeset-packages.sh` refuses a description under 20 characters and a `bumps:` block written first. Do not commit a rebuilt `board-server.mjs`; `scripts/check-no-bundle-diff.sh` refuses a PR that carries one, and `main` builds its own.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the `feature/a-question-notifies-as-it-ages` line under `## Slices` in the plan, on `main`.
- The PR body states the issue it addresses: #1283.
- This repository's own `## Plot Config` in `CLAUDE.md` gets neither key from this slice. A repository that sets `Notify command` is a person's decision.

### Scope guard

This branch owns:
- `packages/domain/src/rules/question-escalation.ts` and its test
- `packages/domain/src/ports/notifier.ts`, a new `adapters/notifier/` directory (command, none, fixture), and their exports in `index.ts` and `adapters/index.ts`
- the tick's escalation call and the `notify` write, in `packages/board/src/server/entry/registryd.ts` and `registryd-main.ts`, and the read and append of `.plot/state/escalations.tsv`
- the two config keys' parsing and defaults
- the changeset

It does not touch:
- `rules/supervision.ts`, `rules/gates.ts` and `workflows/supervise.ts`: `supervise` is read, not changed
- `packages/board/src/server/fleet.ts`, `worker-question.ts` and the board app: wave 1's, merged
- `skills/plot/scripts/**` other than the comment lines above, and `plot-worker-state.sh`

**Collision, verified 2026-10-05 against the open PRs.** Three PRs are in flight, and two touch this slice's files:
- #1291 (`feature/a-spent-correction-budget-gets-a-fresh-agent`) changes `registryd.ts`, `registryd-main.ts`, `supervisor.ts`, `loop-writes.ts` and `adapters/index.ts`. Expect a conflict in the tick. Rebase on `main` after it merges, and keep both calls: its fresh-agent decision and your escalation read the same tick input.
- #1293 (`infra/an-agent-run-is-a-port`) changes `adapters/index.ts`, `index.ts`, `workflows/decision.ts` and `entities/ending.ts`. A new write kind in `decision.ts` is the likely overlap; add yours as a new line rather than reordering the union.
- #1292 (`infra/the-loop-runs-in-one-process`) changes `adapters/index.ts` and `ports/processes.ts`, `ports/trees.ts`. Export lines in the index files merge by hand.
- #1278 is the release PR and touches no source.

On a conflict in `board-server.mjs`, do not read the diff and do not commit the rebuild: restore the generated path from the merge base against `origin/main`, the command the gate's refusal prints.

If you find something the plan did not anticipate, report it with `PLOT-BLOCKED` rather than improvising outside scope.
