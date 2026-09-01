## Implementation brief — the-registry-supervises-its-agents (slice: Declaring)

- **Plan (canonical):** `docs/plans/2026-08-31-the-registry-supervises-its-agents.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/a-worker-declares-what-it-finished` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

First of five. `Judging` reads what this defines; `Supervising` is **deferred on a
measurement** and must not be started. Nothing consumes the envelope in this slice — it is the
contract and its parser, settled before three components read it.

### What to build

A worker writes `.plot-worker.envelope.json` in its worktree when a **branch** is finished; the
domain gains a typed parse; and the rule that **absence means incomplete**.

```json
{ "branch": "feature/x", "status": "ok",
  "artifacts": ["packages/domain/src/rules/reap.ts"],
  "pr": 571, "summary": "one sentence" }
```

### The decisions the plan settles — do not re-derive them

**ONE ENVELOPE PER BRANCH, NOT PER WORKER.** A worker HOPS: `plot-worker-loop.sh:114`
increments `wavesCount` while *"the `session` and `pid` stay fixed"*, so one worker may finish
branches A and B before dying on C. A single end-of-life envelope would then be **absent**, and
A and B — genuinely finished, PRs open — would read as incomplete. **That is the exact failure
this plan exists to fix, reproduced one level up.**

**Absence is load-bearing, and it means incomplete — whatever the exit code says.** A worker
killed by `Worker bound` never gets to write one. Every worker exits 0, so the exit code cannot
distinguish finished from killed; the envelope's presence can.

**Two values, `ok` and `blocked`, and a third would be wrong.** *Blocked* is an agent reporting
it cannot proceed — information, and different from silence. A `failed` value would duplicate
what the gates in `Judging` already decide.

**It joins an existing family.** `.plot-worker.exit`, `.plot-worker.pid`, `.plot-worker.log`,
`.plot-worker.monitor.*.jsonl` are already the convention; match it rather than inventing a
location.

**Readings as values.** The parse belongs in `packages/domain/`, taking the file's text and
returning a typed result — not reading the disk itself. Arrow functions; a Zod schema beside
the other entities.

### Done when

- The envelope is written **when a branch finishes**, not when the worker exits — assert the
  hopping case directly: two branches finished by one session leave two envelopes.
- **A missing envelope parses as incomplete, and an unreadable one does NOT parse as
  complete.** `PortResult`-style: *cannot answer* is not *no*. This repo has twice shipped a
  collapse of those two, and the plan names it as the load-bearing case.
- A `blocked` envelope is distinguishable from absence in the type, not by convention.
- Nothing consumes it yet — **resist wiring it into the board or the reaper.** The contract
  settling first is the point of the slice.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  changeset (`'plot': patch` and `'@plot-pm/domain': patch`, description first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

**Make the absence test discriminating.** Delete an envelope a test just wrote and confirm the
verdict flips to incomplete. A parser that returns *incomplete* for everything passes an
absence test while proving nothing — three inert mutations were caught here on 2026-09-01.

### What this slice must NOT do

**Do not start `feature/the-registry-supervises-its-agents`.** That slice is deferred on a
measurement the plan states as a gate on itself: Declaring and Judging ship first and make
stranded desks visible; the daemon may start only once that visibility has run a week against
the real estate **and** the count of desks stranded, reported, and still unattended is measured
non-zero. *"If a visible desk gets attended to, the daemon is machinery for a problem that
reporting already solved."*

**Do not touch the `claude -p` invocation.** `.plot/worker-prompt.sh` belongs to the adopting
project — Plot cannot assume the harness is `claude` and must not quietly require a flag.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** the envelope's write in `plot-worker-loop.sh`, its schema and parser in
`packages/domain/`, and their tests.

**It does not own** the gates (`Judging`), the session id (`Remembering`), or the daemon
(`Supervising`, deferred).

**In flight, 2026-09-01:** `feature/the-scan-reads-a-fleet-reading` (a `FleetPulse` →
`FleetReading` rename across ~207 sites — **it touches `packages/domain/` broadly**, so expect
a rebase), `feature/a-monitor-is-a-pure-rule` (a new domain rule),
`feature/the-refusals-are-domain-rules` (`plot-dispatch.sh`), `docs/a-machine-has-an-identity`.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
