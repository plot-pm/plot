# Brief: feature/api-attention-says-what-needs-you

Implement wave 2 (**Ask**) of
`docs/plans/2026-08-18-the-board-answers-agents.md`.

Read the plan first, **including the `### Amendment 2026-08-18` section** —
the scope changed after approval and the amendment is the specification, not
the original branch line.

## What to build

`GET /api/attention` — one call, four lists:

```
{
  "needsAgent": [{branch, verdict: "abandoned", action: "restart"}],
  "needsHuman": [{pr: 207, verdict: "ci-approval", action: "approve run"}],
  "waiting":    [{branch, verdict: "question", marker: "TODO(you)"}],
  "claimable":  [{branch, plan, wave, brief}]
}
```

## Why this replaces `/api/next`

Measured during the session that amended the plan: an operator ran a shell
guard beside the board for an afternoon and it gathered **nothing the board did
not already have**. `/api/fleet` rows already carry `state`, `group`, `note`,
`pr`, `localDirty`, `localAhead`, `stuck`, `blockedBy`, `waitingOn`, plus the
worker's pid and liveness.

The guard's entire value was three lines of **judgement** over that data. So
the endpoint's job is not to expose more facts — it is to answer *what should I
do*, which the read path is deliberately silent about today.

`/api/next` answered only "what should I start?". The harder questions the
session produced were "what needs rescuing?" and "what is waiting on me?".

## The verdicts are already implemented

Since 2026-08-18, `skills/plot/scripts/plot-worker-state.sh` distinguishes
eight states including `waiting` (a `TODO(you)`/`TODO(human)` marker in the
tree) and `stalled` (uncommitted work, no PR). **Consume that, do not
re-derive it** — two things computing verdicts from one dataset is exactly the
duplication PR #218 was written to remove, and a structural test asserts the
liveness check exists once.

## Do not

- **Do not make it write.** `/api/attention` is read-only. The write endpoints
  are wave 3 (`feature/api-claim-and-transition`) and carry their own loopback
  gate. Keeping this wave read-only preserves the split the repo rests on.
- **Do not invent a verdict the scan cannot support.** Every entry must trace
  to a fact `plot-fleet-scan.sh` or `plot-worker-state.sh` already reports. A
  verdict the board guessed is the defect this repo spent a day removing.
- **Do not let a cold cache read as an empty answer.** A pulse that has not
  landed and a fleet with nothing to report must not render identically —
  `2026-08-18-not-yet-asked-is-not-nothing` shipped exactly this rule for the
  board's own rows, and it applies here.

## An open point you must answer

The plan flags it: should `claimable` accept a capability hint (e.g. "shell
only", "no network")? Decide, implement or explicitly defer, and **say which
and why** in the PR.

## Definition of Done

- `GET /api/attention` returns the four lists, each entry traceable to an
  existing scan fact
- A worker in each of `abandoned`, `waiting` and `working` lands in the right
  list — driven from one fixture, as the worker-state tests are
- An empty fleet returns four empty lists, and a **cold cache** is
  distinguishable from that
- `pnpm run test:board` and `pnpm run typecheck` pass
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**; concurrent runs were measured producing false
  timeout failures
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
