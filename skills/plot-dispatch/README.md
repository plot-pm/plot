# plot-dispatch — developer notes

Worktree fan-out for wave-structured plans. `SKILL.md` is the agent-facing
instruction; this file is why it looks the way it does.

Design plan: `docs/plans/2026-08-14-parallel-agent-fleet.md` (Stage 3).

## The only script in the fleet that writes

`plot-fleet-scan.sh` and `plot-reconcile-scan.sh` are strictly read-only.
`plot-dispatch.sh` creates worktrees, pushes claim refs, and starts processes.
Everything it writes is therefore either **idempotent or refused**:

| Write | Safety |
|-------|--------|
| Claim ref push | Rejected if the branch exists — that rejection *is* the lock |
| Worktree creation | Existing worktrees are adopted, never duplicated |
| Worker start | Only with an explicit `Worker command` in Plot Config |
| Deletion | Never. Cleanup belongs to `/plot-reconcile` |

A dispatcher that dies halfway through a fan-out is safe to re-run. The
idempotence test holds that line.

## Eligibility is not decided here

The wave arithmetic lives in `plot-fleet-scan.sh`. Dispatch asks and acts on the
answer. Keeping the rule in exactly one place is why a blocked wave cannot be
fanned out by accident — there is no second implementation to drift.

## Two query modes, and why both exist

- **`--next`** — one branch, for a worker about to claim it. Pull semantics: the
  answer changes as claims land, so a list computed up front would go stale
  mid-fan-out.
- **`--list-eligible`** — every claimable branch. Only for `--dry-run`, which
  changes nothing and therefore *cannot* go stale.

The first draft parsed the human report with awk to get the list. That was
wrong for the same reason the footer contract exists: no consumer should ever
parse the prose. `--list-eligible` was added instead.

Note the dry-run trap this avoids: looping `--next` without claiming returns the
same branch forever, because nothing is ever taken.

## Worktree layout

Worktrees are **siblings** of the repo (`../plot-wt-<suffix>`), never nested. A
worktree inside the repo shows up in its own `git status` and in every glob.

Plot was already written for this world — `plot/SKILL.md` has always said
"never check out `main` locally... essential for worktree-based workflows" —
but nothing created worktrees until now. The safety discipline predated the
feature by a long way.

## Detached workers

Workers are started with `nohup`, detached, one per worktree, logging to
`.plot-worker.log` with the pid in `.plot-worker.pid`.

Detached was a deliberate choice over Task-style subagents of the dispatching
session. It settles three things at once:

1. The fleet **outlives the dispatching session** — close the laptop, work
   continues. Subagents would die with their parent.
2. `/plot-dispatch` is a **command, not a session**. It starts processes and
   returns.
3. **The reaper becomes load-bearing.** Detached processes die without telling
   anyone, so `/plot-reconcile` must be able to spot an abandoned claim. That
   is Stage 4, and it is not optional.

The command itself is configuration (`Worker command`), because "how do I run
an agent headless" is a per-project, per-tool answer that Plot must not
hardcode (Principle 5). Without the key, worktrees are prepared and the human
starts them — a useful mode in its own right.

## Why fan-out is human-paced

Monitoring is mechanical; committing to N parallel agents is a decision with
real cost — tokens, and N PRs someone must review. The Pacing model in the
manifesto already sorts steps this way, and fan-out sits with approval and
release, not with the automatable transitions.

Hence: `--dry-run` first, ask for a count, `--max` to honour it. The skill
deliberately does not default to "all eligible".

## Workers never merge

The `Worker command` must tell the agent to open a PR and stop. Concurrent
merges invalidate each other's bases, and the DoD gate — the one property whose
failure is invisible in git — is applied per-PR by an agent seeing one PR at a
time. Merge authority stays with the human until Stage 5 provides an ordered,
conflict-checked merge queue.

## Tests

`test/reconcile/dispatch.test.mjs` — a throwaway repo with a local bare origin
and a three-branch plan (one deferred). Asserts: dry-run creates nothing,
fan-out produces one worktree per eligible branch with each ref pushed,
re-running does not duplicate, and running outside a repo is refused.

## Known gaps

- No `--attach` / `--kill` for inspecting or stopping a running worker; a human
  reads `.plot-worker.log` and uses the pid file by hand.
- Worker liveness is not checked — a crashed worker looks identical to a
  working one until the reaper (Stage 4) ages its claim.
- Worktree removal after a merged branch is manual (`/plot-reconcile` suggests
  it; nothing runs it).
