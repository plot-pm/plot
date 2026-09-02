## Implementation brief — the-budget-bounds-simultaneous-calls (wave Bounding concurrency)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/the-budget-bounds-simultaneous-calls` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 9 of nine, and the last. **The plan delivers when this lands.** Slices 1 to 4 are merged and this consumes them: `bug/a-connector-answers-for-its-limit` gave `packages/domain/src/entities/limit.ts` its `LimitBasisSchema` of `actual | predicted | unknown` (`:22`) and its `LimitReading` (`:55`); `bug/a-budget-belongs-to-the-computer` as #621 gave `packages/domain/src/entities/budget.ts` its `BudgetKey` (`:24`), `BudgetEntry` (`:40`) and the `MAX_LINE_BYTES` cap of 512 (`:78`); `bug/the-host-adapter-counts-what-it-spends` as #655 gave `packages/domain/src/rules/budget-record.ts` its `readWindow` (`:106`), `windowSpend` (`:221`), `latest` (`:248`) and `SpendRate` (`:263`); `bug/the-board-refresh-divides-by-its-peers` as #657 owns the cadence through `prRefreshMsFor` and **this slice must not touch it**. Slice 5 (`bug/a-secondary-limit-is-not-a-spent-quota`) makes the distinction between a spent quota and a secondary limit, and slice 8 (`bug/a-spent-bucket-waits-for-its-reset`) lowers concurrency on a refusal — **this slice owns the cap that lowering acts on**, so both land first.

Slice 7 also releases both waves of `2026-09-01-a-third-connector-costs-one-adapter`, so this chain is the estate's last work.

### What to build

A cap on in-flight host requests per account, discovered rather than hard-coded.

The plan settles the mechanism in one line: *"The bound starts as the connector's `predicted` value and is corrected by the refusals it causes, the same mechanism the limit itself uses."* So the cap is a reading with a basis, not a constant — and `limit.ts:22` already names the three bases it can carry.

### The failure this bounds, measured

**2026-08-27, this repo's own outage: eight workers against a cap of seven.** `plot-host.sh:277` and `:573` both cite it, and `:574-578` records what the buckets read during it:

```
graphql: 5000/5000  used=0  reset_in=3599s
core:    5000/5000  used=0  reset_in=3599s
```

Both full, nothing spent, every call refused.

**A concurrency bound and a quota budget are different mechanisms, and the incident is why.** A quota is spent over time and is visible in `X-RateLimit-Remaining`; the secondary limit counts calls in flight at one moment and appears in no bucket. `plot-host.sh:579` states the consequence: *"`rate_limit` does not report the secondary limit and cannot, so this gate would have read 5000 available at the exact moment nothing worked."* A budget that only divides a cadence therefore cannot prevent this failure — spacing calls further apart does not reduce how many are simultaneous when several spenders start at once.

**Seven has no independent source.** The plan is explicit: it *"has no independent source — `plot-host.sh:242` and `:514` both cite the one 2026-08-27 incident, where eight failed and seven is the inference."* Those two line numbers have since moved to **`:277` and `:573`**; the citation still holds and the number is still an inference from a single event. **Do not hard-code it.**

### What exists today, and what does not

**Nothing bounds concurrency.** `grep -niE 'semaphore|in-?flight|concurren' skills/plot/scripts/plot-host.sh` returns two matches and both are comment prose (`:276`, `:573`). The domain has none either: the three hits under `packages/domain/src/` are `budget-file.ts:78` about `O_APPEND` atomicity, `agent.ts:97` about the dispatch cap's denominator, and `wave.ts:24` about a wave's ceiling. **No code anywhere limits how many host calls are open at once.**

**The record can already show the bound working.** `budget-record.ts` gives `readWindow` (`:106`), `windowSpend` (`:221`) and `SpendRate` (`:263`) with `spent`, `spanMs` and `perHour`. The plan places this slice last *"because it needs the record from slice 1 and the reporting from slice 3 to show it is working rather than merely quiet"* — so the deliverable includes evidence, not just a cap.

**`SpendRate.perHour` may be null, and a caller must read the null.** `budget-record.ts:270-274`: *"NULL IS AN ABSENT RATE, NEVER A ZERO ONE… A caller dividing by this must read the null, not coerce it."*

### The decisions the plan settles — do not re-derive them

**The bound is discovered, not configured.** It starts at the connector's `predicted` value and is corrected by the refusals it causes — the same correction the limit itself uses, where `plot-host.sh` classifies the stderr and a `predicted` value is corrected by an observed `throttled`.

**The cap is per account, not per process.** The plan's whole name: two boards are two budgets against one cap. The record is keyed by connector, account and bucket (`budget.ts:24`), and the bound belongs at that key.

**It is a connector-side concern.** CLAUDE.md's ports rule: `host` is the ONE connector of nine adapters, and only a connector has an account, credentials, a rate limit and a transport choice. A filesystem port must not be made to implement a concurrency bound.

**The cadence is not this slice's to touch.** Slice 4 (#657) derives it from observed spend through `prRefreshMsFor`, and slice 8 states the constraint both share: a refusal that also lowered the cadence *"would compound with that division and drift downward with nothing to restore it."* This slice lowers concurrency; frequency is left alone.

**Degrade, do not refuse.** The plan's Done-when: *"The 2026-08-27 shape is covered: more spenders than the concurrency cap degrades cadence rather than producing a 403."*

### Questions the plan leaves open

**Where the bound is enforced.** `plot-host.sh` is one process per call, so a cap across simultaneous callers cannot live in a shell variable. The record is the only shared state this plan builds, and it is append-only with a 512-byte line cap. Whether an in-flight count belongs there, in a lock file beside it, or in the board alone is not settled — name the answer in the PR body with its reason.

**What a caller does when it is at the cap.** Waiting, refusing, or queueing are different answers, and `plot-reap.sh` keeps rather than reaps when it cannot ask. The plan's Done-when requires that *"nothing silently reads unreachable as permission"*, so whichever is chosen must not read as *nothing to do*.

**How the correction converges.** *"Corrected by the refusals it causes"* does not say by how much, or whether it recovers upward. State the rule chosen and why, rather than leaving it in the code alone.

### Done when

- The 2026-08-27 shape is covered: more spenders than the concurrency cap degrades cadence rather than producing a 403.
- The cap starts from the connector's `predicted` limit and moves in response to refusals, with no hard-coded seven.
- The record shows the bound working — the evidence is a number from `windowSpend` or `SpendRate`, not silence.
- A caller at the cap never reads as permission: `plot-reap.sh` keeps.
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
