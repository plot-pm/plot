# Correctness lens: github-reads-in-process

Juror: correctness lens. Read whole: the plan, the story (Target Shape, Phases 5–6, Decisions), `CLAUDE.md`. Checked against `skills/plot/scripts/plot-host.sh`, `packages/domain/src/rules/{scan-listing,listing-page}.ts`, `packages/domain/src/ports/{host,slots}.ts`, `packages/fleet/src/shared/{pr-refresh,fleet-scan}.ts` in this worktree.

Position: amend

## Open Questions

1. **GraphQL or REST for the deltas.** Keep GraphQL in this plan, as recommended. One recorded request for both transports is what makes the corpus valid, and a REST delta needs its own projection and its own corpus. The condition: a GraphQL secondary refusal from the in-process client must reach the same backoff as a shell refusal (finding 3 below). Without that, GraphQL in-process repeats the 2026-11-08/09 secondary-limit episode with no shell exit 6 to slow it.
2. **Which identity reads.** Agree: no `Reader app` in this plan, `GH_TOKEN`/`GITHUB_TOKEN` where no person is signed in. This is the precedence `gh` already applies, so both transports read as one identity. The budget key must still match: `budget_account` (`plot-host.sh:3513-3534`) takes `PLOT_BUDGET_ACCOUNT` first, then the first `user:` line in `${GH_CONFIG_DIR:-~/.config/gh}/hosts.yml`, then `unknown`. It does not look at `GH_TOKEN`. The TypeScript client must apply the same rule, not ask `/user`. Declare it as a duplicate with a corpus row (finding 4).
3. **Rollback switch.** Keep `PLOT_HOST_TRANSPORT=shell` until `triggers-replace-the-tick` is delivered, as recommended. Add one line to fleetd's status and heartbeat that names the transport in use. A forgotten switch otherwise looks like a census regression with no cause in the code.
4. **The merged listing's `--limit 500`.** No change in this plan, as recommended. It makes the multi-page walk the common case for the full read (5 requests at `GH_PAGE_ROWS` 100, `listing-page.ts:99`), so finding 1 applies to it first.

## Leftovers

- GraphQL vs REST: handled as Open Question 1. Change needed: finding 3.
- Identity with no person signed in: handled as Open Question 2. Change needed: finding 4.
- Rollback switch lifetime: handled as Open Question 3. Change needed: name the transport in status.
- Merged `--limit 500`: handled as Open Question 4. Change needed: finding 1.

## Findings

**1. A walk that fails mid-way reads as whole.** The plan's completeness rule is "whole when the row count is below the limit" (`pr_list_report_truncation`, `plot-host.sh:3322-3327`). That rule is safe for `gh` only because `gh pr list` is all-or-nothing: a failure on page 3 fails the whole call (`pr_list_call`, `:921`, exits non-zero with no rows). An in-process walk that returns the rows of pages 1–2 after page 3 refuses has fewer rows than the limit, and the rule then calls it `whole`. `foldScanListing` accepts it, `mergedBranches` takes it as its merged set, and the PR index can be marked `complete`. Nothing fails. Change: the client answers `failed` (no rows) on any page error, and `whole` only where the last page reports `pageInfo.hasNextPage: false` and the total is below the limit. Add a Done-when row: "a walk refused on page k of n answers `failed`, never `whole` and never `partial`".

**2. A `CI: jenkins` repository on GitHub loses its Jenkins checks.** The GitHub `pr-list` arm overlays Jenkins colours when `ci_scheme` answers `jenkins` (`plot-host.sh:4586-4600`, `:4738-4775`), and takes `--bound-shas` from `pr-refresh.ts:1438-1439` for that arm. The plan's cutover (Slice 5) picks the in-process read when `Host.backend()` answers `github`. A GitHub + Jenkins repository then gets GitHub's `statusCheckRollup` (often empty) in place of the Jenkins reading, and `checks` turns `none` for every row. Change: Slice 5 picks the in-process read only when the backend is `github` AND `CI` is not `jenkins`; a census or adapter row proves the Jenkins repository keeps the shell route until Phase 7 moves Jenkins.

**3. The in-process refusal does not reach the backoff.** The fleet reacts to a refusal by its message text: `pr-refresh.ts:1457` throws `said.said`, and `hostReaction` (`pr-refresh.ts:488`) runs `refusalKind(message)` and `rateLimitBackoffMs(message)` over that text. The shell supplies text those parsers know (`pr_list_failed`, `plot-host.sh:869-900`). The plan maps a `403`/`429` to `Host.observe('secondary')`, but `observe` acts only on `throttled` and holds its correction for the session (`ports/host.ts:376-392`, `host-shell.ts:486`). So an in-process secondary refusal yields `hostReaction(...) === null`, the refresh keeps its ordinary cadence, and it hits the limit again. Change: the Seam slice gives `PrListing`'s failed answer a typed kind (`secondary`, `throttled`, `timeout`, `auth`, `failed`) and the host's wait (`Retry-After`, `X-RateLimit-Reset`), and the callers pass these to `reactionTo` directly. The issue read and the default-branch re-ask do the same. Add a Done-when row: "an in-process `403` secondary refusal sets the same `backoffUntil` as the shell's exit 6 with the same message".

**4. The account key is a duplicate the plan does not declare.** The ledger groups by account, and `spend-rate`, which fleetd still runs through `plot-host.sh` (`pr-refresh.ts:701`, `fleet-scan.ts:317`, `registryd-main.ts:486`), reads the ledger under the shell's `budget_account`. If the client writes under a different string (for example a login from `/user`), its spend goes to a second account. Then the cadence and `prConcurrencyBound` read only the shell's share. Change: add `rules/budget-account.ts` (override, `GH_CONFIG_DIR`, first `user:`, `unknown`) with a corpus row against `budget_account`. Or take the account from the `spend-rate` answer that fleetd already reads.

**5. `actual` lines change the shell's own behaviour.** Today `gh pr list` records basis `unknown` for `graphql` (`budget_reading`, `plot-host.sh:3610-3619`). The client records `actual` with the real remaining value. Two shell rules read that value: `graphql_budget_spent` (`:2391`), which sends `pr-state` and other ops to REST at remaining 0, and `host_concurrency_bound` (`:3818`), which turns a slot bound on (5000 × 4 / 3600 = 5 slots). Both changes are correct, but no test covers them. Change: Slice 2 states this, and adds one contract row: an `actual` `graphql` line with remaining 0, written by the client, routes `pr-state` to REST.

**6. One question takes two slots.** `withHostSlot` (`pr-refresh.ts:804`) already claims a slot for each `pr-list` question. The plan has the client take one more slot per request. fleetd then holds two slots for one question, and with 5 slots, three concurrent walks fill the account. Change: the client claims the slot, and `withHostSlot` stops wrapping `prListing`. Or the reverse, but only one of them claims.

**7. Corpus fixture coverage.** The corpus compares the client with `gh`'s own GraphQL-to-`--json` flattening, which no file in this repository holds. The recordings must therefore contain each shape that the flattening touches: a `CheckRun` and a `StatusContext`, `ACTION_REQUIRED`, a `plot/review` context (`plotReview`, `:4790`), `mergeable: UNKNOWN`, a draft, a merged row, a listing of more than 100 rows, and a `--since` search answer. Record the `gh` version in each fixture, because a `gh` upgrade can change the query that the fixture represents.

**8. Host for GitHub Enterprise.** The client defaults to `api.github.com`, and `gh auth token` with no `--hostname` returns the github.com token. A GHE origin then fails with `auth` on every read. This failure is loud, but it is avoidable. Change: derive the API host from the `origin` remote, as `gh` does, and call `gh auth token --hostname <host>`.

**9. Census gap, not a correctness fault.** `spend-rate` still starts `plot-host.sh` on each scan pass and each PR refresh (finding 4 sites). The Done-when row for S4 names only `pr-list`, `issue-list` and `runs-for-sha`, so it can pass while the S4 target stays out of reach. Name `spend-rate` in the Motivation table, either as moved here (a `BudgetRecord` read) or as left for a named plan.

## Checked and found sound

- The OPEN-row refusal (`foldScanListing`, `scan-listing.ts:292-300`) reads rows and verdicts only, so it carries over unchanged.
- `--rich-open` order and the absent values (`plot-host.sh:4620-4655`) are named in Slice 3.
- `updated:>` is exclusive, and the 60 s overlap belongs to the caller. Both are stated.
- Two writers of the PR index: the cutover keeps `ReaderLock` and `writePrStore` unchanged, and adds no writer.
- Ledger appends: `BudgetRecord` is the same `O_APPEND` file with the same 512-byte line cap as the shell's ledger.

## The change that matters most

Finding 1. Define "whole" for the in-process walk by `hasNextPage` and an all-or-nothing walk, not by row count alone. Every other partial-answer contract in the plan depends on this definition, and today's rule is safe only because of a `gh` property that the new transport does not have.
