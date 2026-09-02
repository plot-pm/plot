## Implementation brief — a-secondary-limit-is-not-a-spent-quota (wave Telling the two limits apart)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/a-secondary-limit-is-not-a-spent-quota` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 5 of nine. Four slices are merged or running and this consumes them: `bug/a-connector-answers-for-its-limit` gave `packages/domain/src/entities/limit.ts` its `LimitBasis` (`actual` | `predicted` | `unknown`) and `LimitReading`; `bug/a-budget-belongs-to-the-computer` as #621 gave `packages/domain/src/entities/budget.ts` its `BudgetKey`, `BudgetEntry` and the `BudgetRecord` port; `bug/the-host-adapter-counts-what-it-spends` as #655 gave `packages/domain/src/rules/budget-record.ts` its `spendRate(lines, key, now)` (`:313`) returning a `SpendRate`, built from `readWindow` (`:104`) and `windowSpend` (`:219`); `bug/the-board-refresh-divides-by-its-peers` is slice 4 and owns the cadence. **The banner needs the reading, and `SpendRate` is where it comes from.**

Four slices wait behind this one, and slice 7 (`bug/the-budget-knows-which-bucket-it-spent`) also releases both waves of `2026-09-01-a-third-connector-costs-one-adapter`.

### What to build

The banner names which limit was hit, prints a reset time only when it received one, and when the cause is local contention says how many spenders it found.

The plan states it at `docs/plans/2026-09-01-one-account-has-one-budget.md:664`, and adds the correction that matters: **`plot-host.sh` does NOT already distinguish them, and an earlier draft of this line said it did.** So this slice MAKES the distinction rather than surfacing one that exists.

### The two failures, and the evidence that they are two

**2026-08-27 — a secondary limit with the quota untouched.** Eight workers against a cap of seven produced a 403 naming abuse detection while `gh api rate_limit` read 5000/5000 on both buckets. The plan records this at `:69` and also records what that evidence does and does not support: the 403 stands as independent evidence, while the bucket reading beside it came from an endpoint later measured to be wrong.

**2026-09-01 — a refusal with 97% of the bucket left.** `gh pr view` refused with *"API rate limit already exceeded"* while the same account's GraphQL headers read **4854 of 5000 remaining, 146 used**. The plan draws the conclusion at `:107`: *"A bucket with 97 % left does not refuse on quota. So both causes are real — an exhausted bucket AND a limit that fires on burst concurrency — and the aggregate view cannot tell them apart, which is exactly why the banner must name which one it hit."*

**They recover differently, which is why the distinction is not cosmetic.** From the plan's table at `:566` — a spent quota recovers at the reset, minutes away, and the honest reaction is to stop until then and say when; a secondary limit clears in seconds and the reaction is to retry shortly and lower concurrency. **Halving the cadence suits neither**, and the plan rejects it explicitly.

### The distinction is conflated in TWO places, and both are one regex

**The shell.** `skills/plot/scripts/plot-host.sh:280` declares `host_failure_kind() { # $1=stderr text → throttled|failed`, and `:268` matches one regex — `rate limit|ratelimit|too many requests|\b429\b|secondary rate|abuse detection|exceeded a secondary` — returning `throttled` at `:269` for every one of them. *"API rate limit exceeded"* and *"You have exceeded a secondary rate limit"* both come back `throttled`.

**The board.** `packages/board/src/app/lib/agent-rows/host-notes.ts:257` is `return /rate limit/i.test(error) ? 'rate-limited' : 'unreachable';` — a second conflation, mirroring the first. `prNote` at `:306` then prints one wording for both, including a reset time it may not have received.

**So the board is not discarding a distinction; there is none to discard.** Verified 2026-09-02 by reading both lines. This slice makes it at the source and carries it through.

### The decisions the plan settles — do not re-derive them

**The banner never prints a reset time it did not receive.** Today `prNote` at `host-notes.ts:306` prints `service returns in ~${when}` from `fleet.prNextInSeconds` whatever the failure was. On a secondary limit that number is wrong and the advice it implies — wait — is the opposite of what helps.

**When the cause is local contention, the banner says how many spenders it found.** The plan at `:607`: *"When the cause is *this machine's own spenders*, the banner should say so and name how many, because the fix is closing a board rather than waiting for GitHub."* The count comes from the record, not from a process headcount — `:169` records that the spenders are eleven scripts, the board, and a person at a terminal, so any headcount misses someone.

**A `throttled` corrects the connector's prediction, and that is where it belongs.** The plan at `:566`: *"For a connector answering `predicted`, a `throttled` is the evidence that its value was wrong, and the correction belongs there rather than in the cadence."*

**The cadence is not touched by this slice.** `:566` is explicit that division happens on observed spend and never on a refusal, because *"reacting to an error by halving would compound with the division already happening and drift the cadence down with nothing to bring it back."*

**Every rendered state is a domain property.** `CLAUDE.md` settles that a view state computed in a component can only be tested by rendering it, and that 42 of this repo's 43 browser tests once started a full board server for that reason. The choice of *which* wording the banner uses is a decision about a reading, so it belongs in the domain and `host-notes.ts` reads the answer.

### Out of scope

**Slice 6** `bug/one-router-chooses-the-path` — the REST/GraphQL routing decision. **Slice 7** `bug/the-budget-knows-which-bucket-it-spent` — reading `X-RateLimit-Resource` from response headers, and fixing `graphql_budget_spent()`; this slice must not add header parsing. **Slice 8** `bug/a-spent-bucket-waits-for-its-reset` — the *reaction* to a refusal, which the plan keeps out of this slice and which needs slice 7's bucket naming to know which reaction applies. **Slice 9** `bug/the-budget-bounds-simultaneous-calls` — the concurrency cap.

**This slice classifies and reports. It does not wait, retry, back off or change the cadence.**

### Done when

- **The two failures are distinguishable at the source.** `host_failure_kind` answers more than `throttled|failed`, and the new answer survives the trip to the board.
- **The banner never prints a reset time it did not receive** — the plan's Done-when, asserted against a secondary-limit refusal that carries no reset.
- **When the limit is local, the banner says how many spenders were found**, and the number comes from the record rather than a headcount.
- **A quota refusal still reads as one.** The existing wording for a spent bucket keeps working; this slice adds a case rather than replacing the one that is right.
- **`prNote`'s wording stays the contract with the reader.** `host-notes.ts:304` says *"Exported for test — the wording is the contract"*; assert the new wording the same way.
- **Prove each test is discriminating.** Make the classification collapse back to one answer and confirm a test fails. Three inert mutations were caught in this repo on 2026-09-01; a passing test against unchanged behaviour proves nothing.

### You are exposed to a rule that may end you

The idle rule ended twelve desks across 2026-09-01 and 2026-09-02. `bug/the-loop-reads-the-agents-own-stream` merged as #653 on 2026-09-02 and raised the transcript-quiet gate to 900 s against a measured maximum of 600.8 s, so this should now be rare. It is not impossible: **commits survive a kill and uncommitted work does not.** Commit early and often, and label an unfinished commit as unfinished in its message.

### Repo gates

Node 24 (`nvm use`; `pnpm` crashes on Node 26). Run `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck` and `pnpm build:board`.

**The root `pnpm run typecheck` is board-only.** It is `pnpm --filter @plot-pm/board typecheck`, so a change under `packages/domain/` also needs `cd packages/domain && npx tsc --noEmit`. That package additionally has `pnpm run test:corpus` on its own vitest config, which is **not** part of `test:board`.

**The domain package carries per-directory coverage ratchets** (`packages/domain/vitest.config.ts`); `src/entities/` and `src/rules/` are gated at 100%.

**If it changes a shell script vendored into the board package, re-vendor it** — #653 needed a separate commit for exactly that.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers into sandbox repositories, and two agents running it here produced 53 concurrent `node --test` processes and a board that could not answer a request in 25 seconds.

### Changeset

One changeset, **description FIRST and the `bumps:` block LAST** — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships. Name `plot` and `@plot-pm/board`, plus `@plot-pm/domain` if the domain changes. Run `./scripts/check-changeset-packages.sh` before pushing; it refuses a description shorter than 20 characters.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher reads it as a claim and the anchored one does not, and it cost a red main on 2026-09-01.
