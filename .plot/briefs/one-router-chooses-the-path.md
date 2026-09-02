## Implementation brief — one-router-chooses-the-path (wave One router, reused)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/one-router-chooses-the-path` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 6 of nine, and it consumes the five before it. `bug/a-connector-answers-for-its-limit` gave `packages/domain/src/entities/limit.ts` its `LimitBasis` and `LimitReading`. `bug/a-budget-belongs-to-the-computer` as #621 gave `packages/domain/src/entities/budget.ts` its `BudgetKey` and the `BudgetRecord` port. `bug/the-host-adapter-counts-what-it-spends` as #655 gave `packages/domain/src/rules/budget-record.ts` its `spendRate(lines, key, now)` at `:313`, returning a `SpendRate`. `bug/the-board-refresh-divides-by-its-peers` reads that rate into the cadence. `bug/a-secondary-limit-is-not-a-spent-quota` separates a refusal from a spent quota. **This slice moves a decision; it adds no new capability.**

Three waves wait behind this one, and both waves of `2026-09-01-a-third-connector-costs-one-adapter` wait on slice 7. This chain is the remaining estate.

### What to build

The GitHub adapter chooses REST or GraphQL for itself, in one place, and no caller learns which.

The plan states it: *"the GitHub adapter chooses REST or GraphQL for itself, and no caller learns which… Gather it into one place PER CONNECTOR, not one place for all of them."*

### What decides the route today — measured 2026-09-02, not taken from the plan

**The plan's own count was written before slices 1-3 landed, and it overstates the spread.** Measured on `plot-host.sh` as it stands:

| reading | count | where |
|---|---|---|
| the *"THE ROUTE IS CHOSEN ONCE, HERE"* site | **1** | `:1279`, inside `pr-state`'s `if [ "$be" = "github" ]` arm |
| `graphql_budget_spent` **definition** | 1 | `:596` |
| `graphql_budget_spent` **call sites** | **1** | `:1283` — the other five mentions are comments |
| `PLOT_HOST_FORCE_REST` reads | 2 | `:1283` and the re-entry `is_rate_refusal` drives |
| `case` arms on backend | 5 | `github)` twice, `bitbucket)` three times |

So the situation is narrower than *"14 backend branches consult 3 budgets"*: **exactly one op routes, and exactly one op consults the budget.** State this in the PR rather than repeating the plan's figure — the plan is the intent, the code is the fact, and a reviewer told to expect fourteen sites will look for thirteen that are not there.

**That does not weaken the slice.** The comment at `:1279` says the route is chosen *once, here* — and *here* is the point. It is chosen once **for `pr-state`** and nowhere else, so every other op that could spend a GraphQL call spends it blind. The deliverable is that the choice becomes reachable by every op, not that a scattering is gathered.

### The decisions the plan settles — do not re-derive them

- **One router per CONNECTOR, not one for all of them.** REST-versus-GraphQL is a GitHub distinction. A shared router would force every future adapter to implement a fork that exists for one vendor.
- **The `Host` port does not change.** It already names no transport, and the plan's `### The transport is the connector's business, not the caller's` section settles that the caller must not learn the route.
- **The cheap path stays the default.** `plot-host.sh:1280-1282` records the trade: roughly 186 REST calls against one GraphQL call for a 93-branch scan. This slice must not make REST the default as a side effect of gathering the decision.
- **No new capability.** The plan says the deliverable is *"that eleven paths stop spending blind and the transport stops being the caller's business"* — a move, not a feature.
- **`HostBackend = 'github' | 'bitbucket'` is a known wart** with its own plan (`the-domain-forgets-the-vendor-list`, gated on slice 7). Do not widen it here.

### Out of scope

- Reacting to a refusal — waiting for a reset and retrying is `bug/a-spent-bucket-waits-for-its-reset`, slice 8.
- Naming buckets — `bug/the-budget-knows-which-bucket-it-spent`, slice 7. This slice must not pre-empt bucket naming; `plot-host.sh:1162` already records why.
- Bounding concurrency — `bug/the-budget-bounds-simultaneous-calls`, slice 9.

### Done when

- **Every op consults the router, and no op re-derives the choice.** The plan is explicit that this is *"asserted by there being one implementation, not by review"* — so the test is structural: one function, and a check that no second site decides.
- The cheap path is still the default, and REST is still the exception.
- No caller learns which transport ran.
- A changeset, and the repo gates below.

### You are exposed to a rule that may end you

The idle rule ended twelve desks over two days. `bug/the-loop-reads-the-agents-own-stream` merged as #653 on 2026-09-02 and raised the transcript-quiet gate to 900 s against a measured maximum of 600.8 s, so this is now rare rather than routine.

It is not impossible, and the mitigation is cheap: **commits survive an ending and uncommitted work does not.** Commit early and often, and label an unfinished commit as unfinished in its message. Three workers on 2026-09-02 finished their slice and were ended before opening a PR; every one kept its work because it had committed, and finishing was a verification pass rather than a reconstruction.

### Repo gates

```
nvm use                      # Node 24, per .nvmrc — pnpm crashes on 26
pnpm test                    # skills parse
pnpm run test:reconcile      # plan-format contract
pnpm run test:board          # rebuilds the artifact, then the board suite
pnpm run typecheck           # BOARD ONLY — see below
```

**Do NOT run `pnpm run test:e2e`.** It is CI's gate, never a local one.

**The root `typecheck` covers one package.** It is `pnpm --filter @plot-pm/board typecheck`, so a change touching `packages/domain` also needs `cd packages/domain && npx tsc --noEmit`. That package additionally has `pnpm run test:corpus` on its own vitest config, which `test:board` does not run.

**The domain package has coverage ratchets per adapter directory.** A new port operation without tests fails the build; write the tests with the code.

**Re-vendor a changed shell script.** `packages/board/` vendors scripts from `skills/plot/scripts/`. Wave 3 of the idle plan changed both copies of `plot-transcript-quiet.sh` in one pass; #653 had needed a separate commit for exactly that.

### A caution on line numbers

`plot-host.sh` shifts while work is in flight — `host_failure_kind` moved from `:267` to `:280` inside one session on 2026-09-02. Name the function where both work, and re-read before citing a line.

### The changeset

Description FIRST, `bumps:` block LAST — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.
