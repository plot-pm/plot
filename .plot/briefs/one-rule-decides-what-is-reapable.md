## Implementation brief — a-log-lives-with-its-worktree (slice 3: Deciding)

- **Plan (canonical):** `docs/plans/2026-08-30-a-log-lives-with-its-worktree.md` on `main`
- **Branch:** `infra/one-rule-decides-what-is-reapable` (base: `main`)
- **Ends as:** one PR to `main`

**Waits on nothing.** Independent of the other three slices.

### What to build

`packages/domain/src/rules/reapable.ts` — the rule. `plot-reap.sh` reduced to
gathering readings, calling it, and acting.

### The decisions the plan settles — do not re-derive them

**The rule goes in the domain because deciding is what the domain is for.**
Measured 2026-08-30: 286 lines carrying 26 decision markers, and the five
refusals ARE the reason the script exists. *May this worktree be removed?* is a
lifecycle question of the same family as *is this plan deliverable*, which
already lives in `packages/domain/src/rules/deliverable.ts`.

```
packages/domain/src/rules/reapable.ts   may this worktree go, and why not
skills/plot/scripts/plot-reap.sh        gathers readings, calls it, acts
```

**Five named refusals, never a boolean:**

| refusal | reading |
|---|---|
| a live worker pid | the process table |
| uncommitted changes | the tree |
| a `PLOT-BLOCKED*` marker | the tree |
| sitting on the default branch | the checkout |
| no merged PR | the host |

**The script already prints a reason per worktree** — the rule returns that
reason as a value rather than the script inferring it from which check failed.
**That is what makes them testable**: 100% coverage means each of the five is
triggerable against fixtures, including combinations a real estate will not
produce on demand — a marker and a live pid at once, a host that cannot be
asked.

**`mergedAt`, never `state`, never ancestry.** A merged PR reports `CLOSED`, and
squash-merge leaves a branch ahead of `main` forever. `plot-pr-merged.sh` is the
reading; the rule decides. **An unreachable host answers *not merged*** — silence
is never permission.

**It needs no new ports.** Two refusals read the world, and `Processes` and
`Host` have been on `main` since #530. The rule takes readings and returns a
refusal; who fetches them is the caller's business, which is what keeps it pure.

**THE ASSERTION THAT MAKES THIS SAFE: `--dry-run` output byte-identical before
and after, on the same estate.** The reaper removes checkouts, and its refusals
are the only thing between a cleanup and losing work — **two of them saved
changesets on 2026-08-30**, for PRs #491 and #493 that had merged and whose
changesets existed nowhere else. A rewrite that changes one refusal by accident
is a rewrite that deletes something.

### Done when

The plan's Deciding `Done when`: five named refusals from the rule, each
individually triggerable; `reapable.ts` at **100% coverage**; the script holds
no `if` about whether a worktree may go; `--dry-run` byte-identical.

Repo gates: `pnpm test`, `pnpm run typecheck`, `pnpm run test:reconcile`,
`pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`), changeset. Node 24,
`corepack pnpm`.

**Domain style** (CLAUDE.md § The Domain Package): arrow functions; factual
TSDoc that says what an export does, not why it was decided.

### Scope guard

Owns `reapable.ts` and the script's decision half. **Does not add the log
removal** — that is slice 4, and mixing a rewrite with a new behaviour makes the
byte-identical assertion impossible.
