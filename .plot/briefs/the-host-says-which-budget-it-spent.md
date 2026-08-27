## Implementation brief — the-budget-is-spent-where-it-is-needed (wave: Measured)

- **Plan (canonical):** `docs/plans/2026-08-22-the-budget-is-spent-where-it-is-needed.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/the-host-says-which-budget-it-spent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

**This is wave 1 of 2.** The `Spent well` wave (`the-fallback-asks-the-other-budget`,
`the-board-refreshes-what-is-watched`) is positionally blocked until this merges —
and it is blocked for a real reason, not just ordering: the fallback cannot decide
*which* budget to fall back to until this wave makes the two budgets separately
observable. Build the reporting, not the fallback.

### What to build

`plot-host.sh` is the one place that talks to `gh`/`bb`. When GitHub rate-limits
it, the failure surfaces as an undifferentiated error — but **GraphQL and REST
have separate budgets**, and exhausting one says nothing about the other. This
wave makes the adapter report remaining budget per API, and makes the rate-limit
notice name which one is gone.

The measured shape this comes from: `gh pr create` failing on a GraphQL limit
while `gh api repos/.../pulls` (REST) succeeded immediately. Two budgets, one
error message, no way for a reader to know a second path existed.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**GitHub only, and stated rather than discovered.** Bitbucket has a single
budget: there is no second one to fall back to, no pair to distinguish, and `bb`
reports no rate information to surface. This is written into the plan explicitly
because issue #228 was filed from a Bitbucket repo and a reader will reasonably
expect that backend covered. **Do not invent a Bitbucket equivalent** — make the
`bb` path report `unknown` and leave it.

**`unknown` is not `zero`.** A host that cannot answer the budget question must
report unknown. Zero means *spent*, and a caller that reads "cannot ask" as
"exhausted" will take the expensive fallback path forever. This is the same
distinction `plot-board-probe.sh` already draws for auth (`ok`/`failed`/`unknown`)
and `plot-host.sh` draws with exit 4 for "the host cannot be asked at all" — the
repo has settled this shape twice; match it.

**The adapter reports; it does not decide.** This wave adds no fallback logic and
no routing. It makes the fact observable so wave 2 can act on it. A wave that
also switched paths would make the fallback untestable independently of the
measurement.

**Scope is `plot-host.sh` only.** The board consumes host data through
`refreshPrs`/`refreshIssues` in `fleet.ts`; the scan is git-only and asks the
host nothing. There is no third consumer to update.

### Done when

The plan's `## Done when` list is the specification. The item that belongs to
this wave:

- **The rate-limit notice names which budget is spent and what remains on the
  other.** Not "rate limited" — the whole point is the distinction.

Plus the tests the plan names for this branch: a spent GraphQL budget with REST
available is reported as such; both spent reads differently; a host that cannot
answer says unknown rather than zero.

Plus the repo's gates: `pnpm run validate`, `pnpm test`, `pnpm run test:board`
green; **artifact rebuilt and committed** if anything under `packages/board`
changes (`pnpm build:board` from the repo root); a changeset — this is a
`skills/plot/` change, so a `bumps:` block naming `plot`, NOT package
frontmatter; Node 24 (`nvm use`, and use `corepack pnpm` — a homebrew pnpm runs
its own node and crashes); `trash` rather than `rm`.

### Bookkeeping

When the PR is created, annotate this branch's line in the plan's `## Branches`
section on main. This plan uses the **Branches** dialect, so the form is a
trailing `→ #N` — NOT the `(Branch: x, PR: #N)` heading form the Waves dialect
uses. Check `git branch --show-current` is main before that edit, or use a
detached scratch worktree (`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` and its tests.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
