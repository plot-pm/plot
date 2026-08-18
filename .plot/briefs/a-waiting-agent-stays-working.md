# Brief: feature/a-waiting-agent-stays-working

Implement wave **Asking** of `docs/plans/2026-08-17-working-shows-the-agent.md`.
Read the plan first — especially section *2. A stopped-to-ask agent stays in
WORKING*, which records why this branch is smaller than the plan's first draft.

## What is already true

`waiting` **exists and is populated**. PR #219 shipped it on 2026-08-18:
`plot-worker-state.sh` answers `waiting` for a worker that left a
`TODO(you)`/`TODO(human)` marker in the tree, and the scan reports it.

The plan originally proposed a fifth state, `asking`, read from the *log's*
shape. That state is **withdrawn** — do not build it. The reason is recorded
in the plan and is worth carrying: the log records that a question *was
asked*; the marker records that it is still *unanswered*, and only the marker
clears when someone writes the answer.

So this branch adds **no state and no new source**. It changes one verdict.

## The defect

`packages/board/src/server/fleet.ts:1642`:

```ts
if (worker === 'waiting') {
  return { group: 'waiting-on-you', note: 'worker is waiting on an answer from you' };
}
```

A waiting agent is still an agent. Sending it to WAITING ON YOU takes it out
of the section that answers *who is working?*, and the operator counting
agents in WORKING undercounts every one that stopped to ask.

## What to build

**A `waiting` worker stays in WORKING, annotated with what it waits on.**

Place it with the `running` arm — the comment block above line 1620 explains
why `running` sits where it does, and the same reasoning applies here: a
worker's own state outranks reasoning from commit age. Keep the existing
ordering guarantee that `waiting` is tested **before** `stalled`; the comment
at 1634-1641 records the measurement behind it (two restarts into one wait).

**The note must say what it waits on, not merely that it waits.** The marker
text is the honest source. If it cannot be read, say so — an unreadable marker
is *waiting, reason unavailable*, never a fabricated question.

**Do not change what outranks this.** The PR arm ~120 lines above still wins:
a PR with conflicts or failing checks is a person's errand even while an agent
waits. That precedence is deliberate and tested.

## Definition of Done

- A `waiting` worker is in WORKING, not WAITING ON YOU
- Its row says what it waits on; an unreadable marker degrades to a stated
  unknown rather than a guess
- A `finished` worker with a PR still goes to WAITING ON YOU — unchanged
- A `stalled` worker still goes to WAITING ON YOU — unchanged, and still
  ranked below `waiting`
- `pnpm run test:board` green, `pnpm run typecheck` green
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Do not

- Do not add an `asking` state, or read the worker log to detect a question
- Do not touch `plot-worker-state.sh` or `plot-fleet-scan.sh` — `waiting` is
  already correct there; this is a board-side verdict change
- Do not build the agent panel or log serving; those are sibling branches

## Platform note

CI runs Linux; you are probably on macOS. Run the suites one at a time —
concurrent runs were measured producing false timeout failures that do not
reproduce serially.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
