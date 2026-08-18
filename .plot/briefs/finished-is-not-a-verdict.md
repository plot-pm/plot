# Brief: bug/finished-is-not-a-verdict

Implement **wave 2 (The seventh state)** of
`docs/plans/2026-08-18-finished-is-not-a-verdict.md`.

Read it first. Wave 1 merged as PR #218 and is on main: the classification
now lives **once**, in `skills/plot/scripts/plot-worker-state.sh`, sourced
by both `plot-dispatch.sh` and `plot-fleet-scan.sh`. You add the seventh
state to that one file — that is the whole reason wave 1 existed.

## What to build

`stalled` — a worker whose process ended without finishing its task.

The classification order, from the plan, and **the order is load-bearing**:

| Condition | State |
|---|---|
| process alive | `running` |
| an open or merged PR exists | `finished` — the work reached review |
| a `TODO(you)`/`TODO(human)` marker in the worktree | `waiting` |
| uncommitted work or unpushed commits | `stalled` |
| otherwise | `finished` |

- **An open PR outranks everything below it.** Work that reached review has
  left the worker's hands, so leftover local edits mean nothing there.
- **`waiting` outranks `stalled`**, because a marker is the worker saying
  *your turn*. Reporting that as stalled invites a restart into the same
  wait — a loop, not a rescue.
- **The marker is read from the TREE, not the log.** The log records that a
  question was asked; only the marker records that it is still unanswered,
  and only the marker clears when someone writes the answer.
- **Editor leftovers are not work.** `.tmp*`, `.swp`, `.orig`, `.rej`,
  `.bak` are excluded from the dirty count. Keep the exclusion narrow — an
  uncommitted source file is exactly the case this detection exists for.

Note the plan lists two states above the six that wave 1 kept: `waiting`
appears in the order alongside `stalled`. Implement both, or say why not.

## Do not

- **Do not re-inline the classification.** Wave 1's test asserts
  structurally that the liveness check exists once; a second copy fails it.
- **Do not restart anything.** The scan is read-only (Manifesto Principle 1
  — the pulse is derived, nothing is written). A `stalled` row names the
  branch and what is on the floor; the decision to relaunch lives in
  `/plot-dispatch`.
- **Do not touch the reaper.** `plot-reconcile-scan.sh` classifies *empty*
  claims and answers a different question (reap the claim). A stalled
  worker has work worth keeping.

## Two open points the plan leaves to you

Both are flagged in the plan's Open Points. Decide, implement, and **say
which way you went and why** in the PR — do not leave them implicit.

1. Is `TODO(you)` the right marker, or should Plot define one of its own?
   A marker Plot names can be searched reliably; one that emerged from
   workers can drift into `TODO(human)`, `ASK:`, or prose.
2. Should `stalled` carry *what* is on the floor — a count, or the file
   names? The count is cheap; names make the row actionable without a
   second command.

## Delete the prototype

`.dev/scripts/fleet-pulse.sh` is the shell prototype these rules came from,
corrected three times by watching it act. Delete it (**`trash`, not `rm`**)
once this lands: two things computing verdicts from one dataset is how they
drift, which is the defect wave 1 just removed.

## Definition of Done

- `stalled` (and `waiting`, per the order above) in
  `plot-worker-state.sh`, added **once**
- Tests, each driving both consumers from one fixture as wave 1's do: a
  worktree with an open PR and dirty files reads `finished`; one with a
  marker reads `waiting`; one with uncommitted work and no PR reads
  `stalled`; one with only a `.tmp1` reads `finished`
- Wave 1's byte-identical output tests still pass for the six original
  states — this adds states, it does not renumber them
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e`,
  `pnpm run test:board` pass — run the suites **one at a time**; concurrent
  runs were measured producing false timeout failures
- A changeset with a `bumps:` block

## A scan defect you will see, and must NOT fix

`plot-fleet-scan.sh` reports this branch as `blocked by One implementation`
and wave 1's branch as `in progress`, though PR #218 is MERGED (verified:
`plot-host.sh pr-state bug/one-worker-state-not-two` answers `MERGED`, the
ref is gone, no worktree, no claim). The scan reads the plan's `→ #218`
annotation as *someone is working on it* and never asks the host whether
that PR already landed — the second half of the defect PR #216 fixed for
branches with no ref at all.

The operator confirmed the override deliberately. **That defect gets its
own plan; do not fix it here.**

## Platform note

CI runs Linux; you are probably on macOS. Two faults were caught this way:
`stat -f` does not fail cleanly on GNU (it prints to stdout and *then*
exits 1), and `/usr/bin:/bin` is not an isolated PATH because CI ships a
real `gh` there.

If you find something the plan did not anticipate, implement what you can
and **report the discovery** rather than improvising.
