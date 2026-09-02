## Implementation brief — a-spent-bucket-waits-for-its-reset (wave Waiting for the reset)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/a-spent-bucket-waits-for-its-reset` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 8 of nine, and the first slice that makes a caller ACT on a refusal rather than describe one. Slices 1 to 4 are merged and this consumes them: `bug/a-connector-answers-for-its-limit` gave `packages/domain/src/entities/limit.ts` its `LimitReading` with `bucket`, `limit`, `remaining`, `resetAt` and `basis` (`:55-68`); `bug/a-budget-belongs-to-the-computer` as #621 gave `packages/domain/src/entities/budget.ts` its `BudgetKey` and `BudgetEntry`; `bug/the-host-adapter-counts-what-it-spends` as #655 gave `packages/domain/src/rules/budget-record.ts` its `readWindow` (`:106`), `windowSpend` (`:221`), `latest` (`:248`) and `SpendRate` (`:263`); `bug/the-board-refresh-divides-by-its-peers` as #657 owns the cadence and this slice must not touch it. Slice 7 (`bug/the-budget-knows-which-bucket-it-spent`) supplies the bucket naming this slice needs to choose between its two reactions, so **slice 7 lands first**.

One slice waits behind this one, and slice 7 also releases both waves of `2026-09-01-a-third-connector-costs-one-adapter`.

### What to build

Two reactions to a refusal, chosen by which limit was hit, and neither of them touches the cadence.

**On a spent quota** the caller stops until the reset the response header carries, then resumes at its previous cadence. The rate was not the cause, so the rate is not the fix.

**On a secondary limit** the caller retries after seconds and lowers concurrency, never frequency.

The plan states the constraint that binds both: *"The cadence is not touched by either — it divides on observed spend, and a refusal that also halved it would compound with that division and drift downward with nothing to restore it."*

### What exists today, and what does not

**Nothing reacts.** `plot-host.sh` contains no `sleep`, no retry and no backoff — the two matches for those words in the file are comment prose at `:244` and `:258`, not code. A refusal reaches `die5` (`:261`) and the process exits 5.

**`fleet.ts` never reads `throttled`.** Its single occurrence of the word is comment text at `:121`. The board learns nothing from a refusal.

**The reset time is already read, and the plan's own line understates this.** `plot-host.sh:2280` reads `X-RateLimit-Reset` from the response headers beside `X-RateLimit-Limit`, `-Remaining` and `-Resource`, through a case-insensitive `_hv` helper written because *"`gh api -i` prints `X-Ratelimit-Limit` while GitHub documents `X-RateLimit-Limit`, and a case-sensitive match reads a present header as absent"*. `host-shell.ts:176` converts it to epoch **milliseconds**, `limit.ts:65` carries it as `resetAt: number | null`, and `budget-record.ts:51` already prunes on it. **So the reading exists end to end; what is missing is a caller that waits for it.**

**The two limits are not yet distinguished.** `host_failure_kind` (`plot-host.sh:280`) matches one regex — `rate limit|ratelimit|too many requests|\b429\b|secondary rate|abuse detection|exceeded a secondary` — and answers `throttled` for every one of them. Slice 5 makes that distinction; this slice consumes it. **Do not re-derive it here.**

### The decisions the plan settles — do not re-derive them

**The cadence is untouched by a refusal.** It divides on observed spend (slice 4, #657), and a refusal that also lowered it would compound with that division and drift downward with nothing to restore it.

**A spent quota is a wait, not a slowdown.** Stop until `resetAt`, then resume at the previous cadence.

**A secondary limit is a concurrency problem.** Retry after seconds and lower concurrency; leave frequency alone. Slice 9 (`bug/the-budget-bounds-simultaneous-calls`) owns the cap itself, so this slice lowers what that slice will later bound.

**A reset time is connector-side.** CLAUDE.md's ports rule: `host` is the ONE connector of nine adapters, and only a connector answers *what is your limit and how well do you know it*. A filesystem port must not be made to implement any of it.

**A refusal must never read as permission.** The plan's Done-when requires that *"a script whose budget is spent behaves the way its own safety argument requires — `plot-reap.sh` keeps, and nothing silently reads unreachable as permission."* A wait that times out answers *could not ask*, never *nothing to do*.

### Questions the plan leaves open

**Where the wait lives.** The plan says the caller stops; it does not say whether that is a sleep inside `plot-host.sh`, a refusal the caller schedules around, or a domain rule the board consults. `die5` exits 5 today, and a script that sleeps for a reset window blocks a worker for as long as the window lasts. Settle it in the PR body with the reason, and prefer the shape that lets `plot-reap.sh` keep its refusal semantics.

**What a caller does when `resetAt` is null.** `limit.ts:65` permits it, and a connector that reports no reset is the `unknown` basis. The plan does not say. Name the answer rather than defaulting silently.

### Done when

- A spent GraphQL bucket does not stop a REST call, and vice versa — the two are budgeted by name.
- The reaction to a spent quota waits for the reset the header carried, and the cadence after the wait equals the cadence before it.
- The reaction to a secondary limit retries within seconds and lowers concurrency, with frequency unchanged.
- A refusal never reads as permission: a script whose budget is spent behaves the way its own safety argument requires.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, `pnpm test`, changeset.

### You are exposed to a rule that may end you

The idle rule ended twelve desks over two days. `an-idle-agent-is-not-a-stalled-one` **delivered on 2026-09-02**: the transcript-quiet gate is now 900 s against a measured 600.8 s maximum, and an ended worker names which of three readings ended it. So an ending should now be rare. Commits still survive a kill and uncommitted work does not, so commit early and often, and label an unfinished commit as unfinished in its message.

### Repo gates

Run `nvm use` first — Node 24 is pinned in `.nvmrc`, and `pnpm` crashes outright on Node 26.

- `pnpm test`
- `pnpm run test:reconcile`
- `pnpm run test:board`
- `pnpm run typecheck` — **board-only**, since the root script is `pnpm --filter @plot-pm/board typecheck`. A change touching `packages/domain` also needs `cd packages/domain && npx tsc --noEmit`.
- `cd packages/domain && pnpm run test:corpus` — its own vitest config, and **not** part of `test:board`.

**Do not run `pnpm run test:e2e`.** It is CI's gate, not a local one.

**The domain package has coverage ratchets per adapter directory.** A new port operation without tests fails the build.

**If this changes a shell script vendored into the board package, re-vendor it.** #653 needed a separate commit for exactly that.

### The changeset

Description FIRST, `bumps:` block LAST — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.
