## Implementation brief — the-board-refresh-divides-by-its-peers (wave Dividing the cadence)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/the-board-refresh-divides-by-its-peers` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 4 of nine, and the one the plan is named for. Three slices are merged or landing and this consumes all of them: `bug/a-connector-answers-for-its-limit` gave `packages/domain/src/entities/limit.ts` its `LimitBasis` (`actual` | `predicted` | `unknown`) and `LimitReading`; `bug/a-budget-belongs-to-the-computer` as #621 gave `packages/domain/src/entities/budget.ts` its `BudgetKey` (`connector`, `account`, `bucket` — `:24`), `BudgetEntry`, `encodeEntry`/`decodeEntry` and `MAX_LINE_BYTES = 512`, plus the `BudgetRecord` port at `packages/domain/src/ports/budget.ts` with `location()`, `append()`, `lines()` and `truncate()` and its adapter at `packages/domain/src/adapters/budget/budget-file.ts`; `bug/the-host-adapter-counts-what-it-spends` as #655 gave `packages/domain/src/rules/budget-record.ts` its `spendRate(lines, key, now)` returning a `SpendRate` — and that function is this slice's input. **Read the rate; do not re-derive it.**

Five slices wait behind this one, and both waves of `2026-09-01-a-third-connector-costs-one-adapter` wait on slice 7 (`bug/the-budget-knows-which-bucket-it-spent`), which waits behind this chain. This is the remaining estate.

### What to build

`fleet.ts` derives its PR-refresh interval from the observed spend rate as well as the per-refresh cost, so N boards spend what one board spends.

The plan states it exactly: *"`fleet.ts` derives `PR_REFRESH_MS` from the observed spend rate as well as the per-refresh cost, so N boards spend what one board spends. No peer counting: the rate is read from the record, which also captures the operator's own `gh` calls and a worker's scans."*

Today `prRefreshMsFor(backend)` at `packages/board/src/server/fleet.ts:1390` is `PR_REFRESH_MS * prRequestsPerRefresh(backend)` — cost put back into the cadence, and correct for one board. The account-level term is missing. A second board doubles what the account spends, because neither board can see the other.

### The decisions the plan settles — do not re-derive them

**The cadence divides, it does not double.** `docs/plans/2026-09-01-one-account-has-one-budget.md:546` states the property this branch exists for: *"when two boards are spending, each refreshes half as often, and the pair still spends 60 requests an hour."* A second board must reduce what each board spends, not increase what the account spends.

**No peer counting, and the plan gives the reason.** The rate is read from the record rather than from a headcount, *"because they also append"* — the operator's own `gh` calls and a dispatched worker's scans spend the same budget. `:169` counts the population: eleven scripts, the board, and a person at a terminal. **A count of scripts would have missed the board; a count of boards would miss the terminal.** So the input is `spendRate(...).perHour`, never a process count.

**The cadence divides on OBSERVED SPEND, never on a refusal.** `:566` settles this and rejects the obvious alternative: *"reacting to an error by halving would compound with the division already happening and drift the cadence down with nothing to bring it back."* A `throttled` is slice 8's input and updates the connector's prediction; it is not an input here. **Do not add a backoff to this slice.**

**`perHour` is `number | null`, and null is an absent rate rather than a zero one.** `spendRate` and its `SpendRate` arrive with #655 — `packages/domain/src/rules/budget-record.ts` holds `windowStart`, `withinWindow`, `readWindow` and `survivors` on main today, and #655 adds `windowSpend`, `latest`, `SpendRate` and `spendRate` to the same file. Read the file after that lands rather than these line numbers. Its docblock states: *"One line, or several written inside one millisecond, gives nothing to divide by — and a rate invented there would be the dishonest cadence input the record exists to remove. A caller dividing by this must read the null, not coerce it."* An absent rate must leave the cadence exactly where it is today.

**The GitHub board must be unchanged when it is alone.** `fleet.ts:1381` records the same discipline for the cost multiplier — *"A GitHub board is unchanged. The multiplier is 1 there… The uncommon case must not slow the common one down."* One board on a quiet account must return exactly `PR_REFRESH_MS`, so a test asserting today's 60 s keeps passing.

**The divisor is derived, never written down.** `feature/a-subscriber-names-its-divisor` merged as #636 and `boardDivisors()` at `fleet.ts:2507` reads `12` off `divisorFor(base, PR_REFRESH_MS)` rather than stating it. Whatever this slice adds must keep that property: if the interval stretches, the subscriber's divisor follows from it and no literal is edited.

**The rate-limit contract belongs to the connector kind.** `CLAUDE.md`'s Layering Rule: of nine adapters exactly one is a connector, and *"a filesystem port must not be made to implement"* rate-limit behaviour. The board reads the record through `BudgetRecord`; it does not ask `Host` how fast the account is going.

**Every rendered state is a domain property.** `CLAUDE.md` settles that a view state computed in a component can only be tested by rendering it. If the banner or a row shows the stretched cadence or the spender count, the decision belongs in the domain and the component reads it.

### Out of scope

Named slices this must not reach into: **slice 5** `bug/a-secondary-limit-is-not-a-spent-quota` (the banner's wording and the spender count it names — this slice changes the cadence, not the message); **slice 6** `bug/one-router-chooses-the-path`; **slice 7** `bug/the-budget-knows-which-bucket-it-spent` (reading `X-RateLimit-Resource`, and `graphql_budget_spent()` at `skills/plot/scripts/plot-host.sh`); **slice 8** `bug/a-spent-bucket-waits-for-its-reset` (the reaction to a refusal, which the plan explicitly keeps out of the cadence); **slice 9** `bug/the-budget-bounds-simultaneous-calls`.

### Done when

- **Two boards running for an hour spend no more host requests than one board does** — the plan's only real claim, counted from the budget record and stated in the changeset.
- **A third board changes that number by nothing.**
- **One board on a quiet account refreshes exactly as it does today.** `prRefreshMsFor('github')` returns `PR_REFRESH_MS`; the existing arithmetic tests keep their numbers.
- **An absent rate (`perHour === null`) leaves the cadence unchanged**, asserted rather than assumed — a record with one line must not stretch or collapse the interval.
- **The divisor still follows from the interval.** `boardDivisors()` derives it; assert the wired cadence rather than grepping for a number.
- **The stretch is bounded**, and the bound is stated. A rate read during a burst must not push the interval somewhere the board never recovers from; say what the ceiling is and why.
- **Prove each test is discriminating.** Make the division inert and confirm a test fails. Three inert mutations were caught in this repo on 2026-09-01; a passing test against unchanged behaviour proves nothing.

### You are exposed to a rule that may end you

The idle rule ended twelve desks across 2026-09-01 and 2026-09-02. `bug/the-loop-reads-the-agents-own-stream` merged as #653 today and raised the transcript-quiet gate to 900 s against a measured 600.8 s maximum, so this should now be rare. It is not impossible: **commits survive a kill and uncommitted work does not.** Commit early and often, and label an unfinished commit as unfinished in its message. Wave 1 of that plan did exactly that and lost nothing; wave 2 made two commits it never pushed, and they were recovered by hand.

### Repo gates

Node 24 (`nvm use`; `pnpm` crashes on Node 26). Run `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck` and `pnpm build:board`.

**The root `pnpm run typecheck` is board-only.** It is `pnpm --filter @plot-pm/board typecheck`, so a change under `packages/domain/` also needs `cd packages/domain && npx tsc --noEmit`. That package additionally has `pnpm run test:corpus` on its own vitest config, which is **not** part of `test:board`.

**The domain package carries per-directory coverage ratchets** (`packages/domain/vitest.config.ts`). The pure side — `src/entities/` and `src/rules/` — is gated at 100%, so anything added there needs full coverage.

**If it changes a shell script vendored into the board package, re-vendor it.** #653 needed a separate commit for exactly that.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers into sandbox repositories, and two agents running it here produced 53 concurrent `node --test` processes and a board that could not answer a request in 25 seconds.

### Changeset

One changeset, **description FIRST and the `bumps:` block LAST** — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships. Name `@plot-pm/board`, and `@plot-pm/domain` if the domain changes. Run `./scripts/check-changeset-packages.sh` before pushing; it refuses a description shorter than 20 characters.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher reads it as a claim and the anchored one does not, and it cost a red main on 2026-09-01.
