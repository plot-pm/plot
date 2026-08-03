# plot-implement

Spoke command of the Plot workflow: start (or resume) implementation of
an approved plan.

## Why a separate command

Before Plot 2, `/plot-approve` merged the plan **and** fanned out
implementation branches in one step — a remnant of plot's all-async
origin, where approval and pickup were the same moment. Under human
pacing they are two events, often days apart. Splitting them gives the
gap a home: the staleness preflight checks the plan's assumptions against
what moved since approval, and the `Started:` record makes
approved-but-idle vs in-progress a first-class, board-visible
distinction.

## Contract

- **Prepares and records; never implements.** The output is a hand-off
  brief (branch, base, how it ends, done-criteria, plan link) that any
  implementing session — with or without plot — can start from without
  re-asking mechanics.
- Reads the plan's recorded `Review:`/`Impl:` answers via
  `plot-plan-meta.sh`; never re-decides them.
- Requires phase `approved`; refuses Draft with a pointer to
  `/plot-approve`.
- Doubles as the resume entry point: re-running on a started plan re-runs
  the preflight and re-orients instead of re-creating.

## Development

Validated by end-to-end lifecycle runs (see `skills/plot/README.md`);
plan parsing is covered by `test/reconcile/`.
