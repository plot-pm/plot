## Implementation brief — the-budget-is-spent-where-it-is-needed (wave: Fallen back)

- **Plan (canonical):** `docs/plans/2026-08-22-the-budget-is-spent-where-it-is-needed.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/the-fallback-asks-the-other-budget` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

**Wave 3 of 3.** `Measured` shipped as **#485**; `Watched`
(`feature/the-board-refreshes-what-is-watched`) precedes this wave. The two
share no files — yours is `plot-host.sh`, theirs is
`packages/board/src/server/fleet.ts` — and cannot collide.

### What to build

`plot-host.sh` answers through `gh api` (REST) when the GraphQL budget is
exhausted. GitHub meters GraphQL and REST separately, so a spent GraphQL bucket
leaves a full REST one — and `host_pr_state --ask` is the per-branch path that
can use it. The adapter is the only place that talks to the host, so every
caller inherits the fallback.

#485 already landed the op that makes this decidable: **`plot-host.sh
rate-limit`** reports both budgets, with `unknown` (never `zero`) when the host
cannot be asked. Read it; do not rebuild it.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**BE HONEST ABOUT WHAT THIS BUYS — the plan is, and the PR should be.** Measured
2026-08-27, minutes after `gh` began refusing with *"API rate limit already
exceeded for user ID 870334"*:

```
graphql: 5000/5000  used=0  reset_in=3599s
core:    5000/5000  used=0  reset_in=3599s
```

**Both budgets full, nothing spent.** That refusal was GitHub's **secondary**
limit — concurrent-request throttling, eight workers against a cap of seven.
`rate_limit` does not report it and cannot.

So **a pre-flight check on `remaining` would have read 5000 available at the
exact moment every call was refused.** What this wave buys is a second path when
one bucket is *genuinely* gone — a real state a long-running board reaches. What
it does not buy is immunity from throttling. Do not frame the PR as fixing the
outage this repo had; that needs backing off on the 403 itself, which is a
separate change the plan names and does not schedule here.

**`unknown` is not `zero`.** Zero means spent; a caller reading "cannot ask" as
"exhausted" takes the expensive path forever. #485 pinned this with a test —
inherit the rule, do not weaken it.

**The cheap path stays the default.** A listed test. Without it, change 1
silently makes every scan 186 REST calls — the fallback must be the exception,
taken only when GraphQL is actually spent.

**Both paths produce the same vocabulary.** A caller must not be able to tell
which route answered, or the adapter's contract forks in two.

**GitHub only, stated rather than discovered.** Bitbucket has a single budget,
no second to fall back to, and `bb` reports no rate information at all. Issue
#228 was filed from a Bitbucket repo, so a reader will reasonably expect that
backend covered — **Bitbucket is unaffected is a listed test**, not an omission.

**`plot-host.sh` is the ONE place that talks to the host CLI.** Do not add a
`gh` call anywhere else.

### Done when

The plan's `## Done when` list is the specification. This wave's items:

- **With the GraphQL budget at zero, the board still renders PR state** —
  proven by a test that **stubs an exhausted GraphQL response and asserts the
  REST path answered**, not merely that no error was thrown.
- **The REST fallback is NOT taken while GraphQL has budget.** The assertion a
  naive implementation passes without: a change that always uses REST satisfies
  the first item and makes every scan far more expensive.
- **The two paths produce the same vocabulary.**
- **Bitbucket is unaffected.**

`test/reconcile/host.test.mjs` is the file, and it already has the harness you
need: `makeStubs({ ghJson, ghFail })` writes PATH-stubbed `gh`/`bb` executables
that record argv and emit canned JSON, and `runAllowFail` returns code/stdout/
stderr separately. #485's four `rate-limit` tests at the end of that file are
the closest model.

Plus the repo's gates: `pnpm run validate`, `pnpm test`,
`pnpm run test:reconcile` green; a changeset with a `bumps:` block naming
`plot` (a `skills/plot/` change, NOT package frontmatter); Node 24 (`nvm use`,
and `corepack pnpm` — homebrew pnpm runs its own node and crashes); `trash`
rather than `rm`.

Run `test:e2e` with `env -u PLOT_UNATTENDED` if you run it — that variable in
the ambient environment trips a control test.

**Known-flaky, not yours:** `test/reconcile/dispatch.test.mjs` fails 5 tests
with `ETIMEDOUT` (~33 s each) under parallel load, identically on `main`. It
passes 71/71 run alone. Baseline before believing a failure there.

### Bookkeeping

When the PR is created, annotate this branch's line in the plan's `## Branches`
section on main with a trailing `→ #N`. **This plan uses the Branches dialect**
— the arrow form, NOT the `(Branch: x, PR: #N)` heading form. Check
`git branch --show-current` is main first, or use a detached scratch worktree
(`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` and
`test/reconcile/host.test.mjs`.

Nothing else in flight touches `plot-host.sh`. Rebase onto current main before
you start — #485 landed there and is what you build on.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
