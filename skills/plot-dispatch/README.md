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

## What is in flight, and why it is only half a comparison

Before creating a worktree, dispatch prints which other branches already hold
which files:

```
would dispatch feature/agent-view-phase-ui → …
  in flight: bug/board-shows-staleness holds App.tsx, AgentList.tsx
```

Waves are a **within-plan** ordering; collisions are **across plans**, and no
plan can declare them alone. On 2026-08-16 `plot-fleet-scan.sh --next`
correctly offered a branch whose file another plan's agent had open, twice
within an hour, and both times a human supplied the missing check by hand from
five commands.

**Local refs and worktrees, not the remote.** This is the one place the
refs-are-truth principle bends, and the reason is measured: the collision that
blocked a dispatch that evening lived in an **unpushed commit** — committed,
clean worktree, the remote ref holding only the claim. Uncommitted work is
invisible to refs entirely. Worktrees share one ref database, so `git rev-parse`
answers from the main repo for a branch checked out elsewhere; `git worktree
list` plus `git status` supplies the rest. That is sound rather than a violation
because dispatch is inherently machine-specific — it creates the worktrees here,
and a check that ignored what this machine knows would be blind exactly where it
acts.

Each branch is diffed against **its own merge-base**, not `origin/<main>`. A
rebased branch is not behind main, and diffing against the tip would attribute
every commit it picked up from main to the branch itself — on a busy day, the
whole repo.

`skills/plot/scripts/board/board-server.mjs` is excluded. Every board branch
rebuilds it, so including it would make every board pair look like a collision:
precisely the noise `.gitattributes -merge` exists to remove.

### Two designs that were tried on paper and killed by measurement

Both look like the obvious answer, so they are recorded here rather than merely
avoided.

**`git merge-tree` cannot answer this question.** It compares two *existing*
commits, and dispatch **creates** the candidate branch — at check time it is
identical to the default branch, so the comparison reports *clean* for every
candidate, forever. A check that always passes is worse than no check: it turns
a known gap into a false assurance. `merge-tree` still earns its place where
both commits exist — a re-dispatch (`reused`) and `plot-merge-queue`, which
keeps that job.

**A `Touches:` field per branch would fire on nearly every pair.** The real
scope guards in existing briefs are `packages/board/**`,
`packages/board/src/app/**` and `plot-fleet-scan.sh` — the first *contains* the
second, so two branches that ran in parallel without touching one another would
read as colliding. Three of four briefs use `**` globs, so the false positive is
the normal case, not the corner. It would also rest on an unverified
self-declaration: estimated while planning, never checked against what the
branch writes, and phrased broadly enough not to be a nuisance — which is what
makes it useless. A comparison is only as good as its weaker half.

So dispatch reports the **measured side only** and **refuses nothing**. An
earlier draft skipped colliding candidates; that only makes sense with a
prediction worth trusting, and a skip built on this measurement alone would have
blocked pairs that ran fine. `plot-dispatch` stays a tool that reports rather
than a gate that judges — scripts collect and report, skills interpret.

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

The work-in-flight tests each pin something a weaker implementation gets wrong.
Files held in an **unpushed commit** are reported (one reading `origin/*`
reports nothing and passes every looser test); files held **uncommitted** are
reported (no ref carries them, so this fails against any ref-only
implementation, including a correct local-refs one); **nothing** is reported
when nothing is held; dispatch **still starts everything**; and the report is
byte-identical whether or not the plan declares the candidate's files, which is
the assertion both rejected designs fail.

Two of these fixtures are shaped deliberately, because the obvious version
passes for the wrong reason:

- The **silence** test carries a bare claim — a branch that exists and holds
  nothing. Without it no branch reaches the empty-files check at all, and an
  implementation printing `holds (nothing)` for every claimed branch stays
  green. That is exactly the noise being guarded against.
- The **self-exclusion** test prepares the candidate's branch locally and never
  claims it on the remote. A claimed branch is not eligible, so `--next` would
  return nothing, the loop would never run, and the assertion would pass
  without the report being reached.

Both were found by mutating the script and checking the tests went red — a
green test proves nothing until it has been seen to fail.

## Known gaps

- No `--attach` / `--kill` for inspecting or stopping a running worker; a human
  reads `.plot-worker.log` and uses the pid file by hand.
- Worker liveness is not checked — a crashed worker looks identical to a
  working one until the reaper (Stage 4) ages its claim.
- Worktree removal after a merged branch is manual (`/plot-reconcile` suggests
  it; nothing runs it).
