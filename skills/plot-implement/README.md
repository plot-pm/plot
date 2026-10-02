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
  re-asking mechanics. It is written to `.plot/briefs/<branch>.md` and
  committed: a brief that lives only in the dispatching session's
  scrollback dies with that session, and an agent that is resumed or
  replaced then needs a human to reconstruct it.
- **The brief is interpretation, not extraction**, which is why its step
  is Frontier tier. Summarising the plan adds nothing for a reader who
  can open the plan; what the brief adds is the decisions already
  *settled* — each with the alternative it rejected and the measurement
  that killed it. Measured on this repo: the original 8-line template was
  never used, and every brief written by hand ran 111–127 lines, the
  difference being rejected alternatives rather than padding. Without
  them three agents in one session would have rebuilt mechanisms the plan
  had already disproved, because a plan's reasoning reads as background
  rather than as a warning aimed at the implementer.
- **`--brief-only` stops at the brief.** The flag runs the preflight, the
  brief and the `Started:` record, and skips step 3 completely: no
  checkout, no claim push, no worktree. It is what the board asks for on
  every dispatch (`composeImplementPrompt` in
  `packages/board/src/server/implement.ts`), because the claim belongs to
  the agent that takes the slice up rather than to the step that prepares
  it. Measured 2026-10-01: a claim this step pushed was worked by nobody —
  `claimedBranches` reads every remote branch as claimed, so the queue
  dropped three slices and they sat with no worker until a person released
  their refs; the leftover worktree then blocked the agent the branch was
  finally handed to (#1151). Run by a person without the flag, step 3 is
  unchanged: that claim is legitimate, it belongs to the session that
  pushed it, and a supervisor never works it.
- Reads the plan's recorded `Review:`/`Impl:` answers via
  `plot-plan-meta.sh`; never re-decides them.
- Requires phase `approved`; refuses Draft with a pointer to
  `/plot-approve`.
- Doubles as the resume entry point: re-running on a started plan re-runs
  the preflight and re-orients instead of re-creating.

## Development

Validated by end-to-end lifecycle runs (see `skills/plot/README.md`);
plan parsing is covered by `test/reconcile/`.
