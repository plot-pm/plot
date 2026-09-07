## Implementation brief — finished-with-is-one-rule (slice: Asking one rule)

- **Plan (canonical):** `docs/plans/2026-09-05-a-desk-is-finished-with-once.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/finished-with-is-one-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR
- **The plan carries two interrogation rounds.** Read its Notes and its Open Questions before writing code — round 2 settled the shape and the reason.

Slice 1 of two, and it leads two other pieces of work: slice 2 (`the-ref-deleter-asks-the-rule`) and `bug/the-reaper-reads-prunable`, which carries a `waits:` annotation pointing here.

## What this delivers

`finishedWith(readings)` in `packages/domain/src/rules/reapable.ts` — one rule stating every condition both scripts apply, so the reaper and the ref-deleter cannot disagree about whether a desk is finished with.

## The two scripts already disagree, and by more than the plan first said

Verified 2026-09-06 by reading both:

| condition | `plot-reap.sh` | `plot-release-refs.sh` |
|---|---|---|
| no merged PR | ✓ | ✓ |
| default branch | ✓ | ✓ |
| live worker pid | ✓ | **absent** |
| uncommitted changes | ✓ | **absent** |
| `PLOT-BLOCKED` marker | ✓ | **absent** |
| open PR (`pr_open`) | **absent** | ✓ |
| `deferred:` / `moved:` | **absent** | ✓ |
| checked out anywhere | **absent** | ✓ |

**And one of them deletes something no `git worktree add` can bring back.**

## `unknown` is a return value, not an error

**THIS IS THE ROUND-2 FINDING AND IT SHAPES EVERYTHING.** Measured: **22 of 32 remote branches have no worktree — 69%**, the majority case. And **four of the reaper's five conditions need that tree** — live pid, uncommitted, `PLOT-BLOCKED`, what is checked out. Only `no merged PR` survives without one.

So on 69% of the estate the rule is asked four questions it cannot answer, for the irreversible operation. **Two shapes were rejected:**

- **a boolean** invents an answer;
- **refusing on silence** — the estate's rule for an unreachable host — would block deletion on 69% of branches and make the ref-deleter useless exactly where it is needed.

**So each condition answers `true`, `false`, or `unknown`, and the caller decides.** The reaper reads unaskable-because-no-tree as *nothing to reap*; the ref-deleter reads it as *no evidence against deletion*, which is its behaviour today.

## Neither script gains the other's guards

**THE RULE STATES EVERY CONDITION; EACH CALLER DECLARES WHICH IT ASKS AND WHY.** The defect is that the difference is **invisible**, not that it is wrong.

`plot-release-refs.sh:30` says a fold *"would silently widen a licence that was written narrow on purpose."* **A rule that changed either script's behaviour would be doing exactly that under a refactor's name.**

**And the scoping asymmetry is deliberate and stays.** `plot-release-refs.sh:33`: ref deletion is scoped to one plan where the reaper is slug-blind, because a removed checkout is re-creatable and a deleted ref is not — *"the blast radius is bounded by the plan file."*

## This slice does not touch either script

`plot-reap.sh` and `plot-release-refs.sh` are unchanged. Slice 2 rewires the ref-deleter; nothing rewires the reaper in this plan.

**`rules/reapable.ts` already exists** — 122 lines, and `plot-reap.sh` already reads it through an inline `node` block. **Read it first**: part of this may be there, and the reaper is the worked example the ref-deleter should copy.

## Done when

- `finishedWith(readings)` states every condition both scripts apply
- each condition answers `true`, `false` or `unknown`
- **asserted:** an open PR keeps a ref and does **not** keep a checkout
- **asserted:** a live worker pid keeps a checkout and says **nothing** about a ref
- a reading that cannot be taken answers `unknown` rather than refusing
- neither script's behaviour changes, and neither script is edited
- `pnpm test`, `pnpm run test:reconcile` and the domain typecheck pass

## Do not

- **Do not give either script the other's guards.** That is the widening `plot-release-refs.sh:30` warns about.
- **Do not return a boolean per condition.** 69% of branches cannot answer four of them.
- **Do not refuse on `unknown`.** It would disable the ref-deleter on the majority of the estate.
- **Do not collapse the scoping difference.** Plan-scoped versus slug-blind is the blast-radius argument.
- **Do not edit `plot-reap.sh` or `plot-release-refs.sh`.**
- **Do not use `function` declarations** in the domain package.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json`.
