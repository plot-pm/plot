## Implementation brief — the-host-adapter-counts-what-it-spends (wave Counting what is spent)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/the-host-adapter-counts-what-it-spends` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 3 of nine, and the first that writes. The two slices it needs are merged: `bug/a-connector-answers-for-its-limit` as #608 gave `packages/domain/src/entities/limit.ts` its `LimitBasis` (`actual` | `predicted` | `unknown`), `LimitReading`, `actualLimit`, `predictedLimit`, `unknownLimit` and `correctForRefusal`; `bug/a-budget-belongs-to-the-computer` as #621 gave `packages/domain/src/entities/budget.ts` its `BudgetKey`, `BudgetEntry`, `encodeEntry`, `decodeEntry`, `entryOf`, `sameBudget`, `withinLineCap` and `MAX_LINE_BYTES = 512`, plus the `BudgetRecord` port at `packages/domain/src/ports/budget.ts` with `location()`, `append()`, `lines()` and `truncate()`, and its adapter at `packages/domain/src/adapters/budget/budget-file.ts`. **Consume all of it. The format, the key, the location and the line cap are settled — this slice makes calls arrive in the record.**

Six slices wait behind this one, and one branch outside the plan waits with them: `feature/the-domain-forgets-the-vendor-list` is annotated to wait on slice 7, `bug/the-budget-knows-which-bucket-it-spent`.

### What to build

`plot-host.sh` appends every host call to the record, lock-free, and can read back a recent spend rate.

The plan states the deliverables exactly: *"a number every component can see, the append format (which must tolerate concurrent writers without a lock), and the answer to where the file lives when two worktrees share one account."* The last two are already answered by #621 — `encodeEntry`/`MAX_LINE_BYTES` for the format, `budgetFile` and `PLOT_BUDGET_HOME` for the location — so the work is the append at each call site and the read-back.

**No behaviour change beyond the record.** No throttling, no backoff, no cadence change. A call that succeeds today succeeds identically with a line appended.

### The decisions the plan settles — do not re-derive them

**The rate-limit contract belongs to the CONNECTOR kind, and this is the connector.** `CLAUDE.md`'s Layering Rule draws the distinction and measures it: *"a connector reaches a remote service: it has an account, credentials, a rate limit, a transport choice. Every other adapter reaches the local machine, where none of those exist."* Measured 2026-09-01, of nine adapters exactly one is a connector — `host` shells to `plot-host.sh` and its `gh`/`bb`/`jen`/`jira` calls, while `refs`, `processes`, `plan-store` and `performer` shell to scripts that make **zero** remote calls. So *what did you spend* is asked of `Host` and of nothing else, and a filesystem port must not be made to implement it.

**Lock-free, and the line cap is why.** #621 settled append-only with a stated cap because *"concurrent `O_APPEND` is atomic only below `PIPE_BUF`"*. `withinLineCap` and `MAX_LINE_BYTES = 512` at `packages/domain/src/entities/budget.ts:159,78` are that guarantee. An entry that would exceed the cap must not be silently truncated into a line another reader will mis-parse — decide what it does instead and state it.

**A connector that reports no limit records `unknown`, never `free`.** #621 settled this and `unknownLimit` at `packages/domain/src/entities/limit.ts:120` is the constructor. Absence of a reading is not a reading of zero cost.

**The record is outside any checkout.** Two GitHub checkouts on one machine share one account, and a per-checkout `.plot/state/` would each read a full 5000. `BUDGET_HOME_ENV` at `packages/domain/src/adapters/budget/budget-file.ts:26` is the override; do not add a second way to locate the file.

**Keyed by `(connector, account, bucket)`.** `BudgetKeySchema` at `packages/domain/src/entities/budget.ts:24` holds it, and `sameBudget` at `:230` compares it. **The connector is a string the record does not validate** — the plan gives the reason: *"`Tracker` already names `linear` without an adapter, and a third closed enum is an edit that gets forgotten when GitLab arrives."*

**The bucket is named by a later slice, and this one must not pre-empt it.** `bug/the-budget-knows-which-bucket-it-spent` is slice 7 and owns reading `X-RateLimit-Resource` from response headers. This slice records what it can already know; it does not add header parsing, and it does not fix `graphql_budget_spent()` at `skills/plot/scripts/plot-host.sh:583` — that is named in slice 7's line.

**The window and the pruning are #621's, and `truncate()` is their interface.** A reader consumes only lines newer than the connector's reset window and truncates what it has proven dead — *"the one write that is not an append, at most once per reset."* Use the port; do not invent a second pruning path.

### Out of scope

Named slices this must not reach into: **slice 4** `bug/the-board-refresh-divides-by-its-peers` (deriving `PR_REFRESH_MS` from the rate — this slice makes the rate readable and stops there); **slice 5** `bug/a-secondary-limit-is-not-a-spent-quota` (`host_failure_kind()` at `plot-host.sh:267` returns `throttled` for every match of one regex, and the plan is explicit that *"there is none to discard — this slice makes it, rather than surfacing it"*, so leave that regex alone); **slice 6** `bug/one-router-chooses-the-path`; **slice 7** the bucket naming and `graphql_budget_spent`; **slice 8** the reset wait; **slice 9** the concurrency bound.

**Do not widen `HostBackend`.** `packages/domain/src/ports/host.ts:7` declares `HostBackend = 'github' | 'bitbucket'` and `packages/domain/src/adapters/host/host-shell.ts:200` throws `plot-host: unrecognised backend`. `CLAUDE.md` records that closed list as a known defect with its own plan (`one-account-has-one-budget` is cited there) — but widening it is not this slice's line, and `feature/the-domain-forgets-the-vendor-list` is the branch that owns it.

### Done when

- **Every host call appends one entry**, and a call that fails appends one too — a refusal costs quota and a record that omits it under-counts exactly when the count matters most.
- **Concurrent writers do not corrupt a line.** Assert it with real concurrency rather than by argument: several appenders at once, then every line decodes with `decodeEntry`. `MAX_LINE_BYTES` is the guarantee, so a test that never approaches it has not tested the guarantee.
- **An entry that would exceed the line cap is handled deliberately** and the behaviour is stated — not truncated into something `decodeEntry` will mis-read.
- **The spend rate is readable from the record**, over the connector's own window rather than the whole file. A rate derived over the whole file approaches zero, which #621 measured: *"~1,160 lines an hour, 15 MB a week."*
- **A connector with no limit reading records `unknown`**, and a reader can tell that apart from a recorded zero.
- **Two worktrees sharing one account write to one record** — the case the location exists for, asserted rather than assumed.
- **No behaviour change beyond the record**: a test that ran green before this slice runs green after, with the same number of host calls.
- **Prove each test is discriminating.** Make an append silently drop and confirm a test fails. Three inert mutations were caught in this repo on 2026-09-01; a passing test against unchanged behaviour proves nothing.

### Repo gates

Node 24 (`nvm use`; `pnpm` crashes on Node 26). Run `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck` and `pnpm build:board`.

**The root `pnpm run typecheck` is board-only.** It is `pnpm --filter @plot-pm/board typecheck`, so a change under `packages/domain/` also needs `cd packages/domain && npx tsc --noEmit`. That package additionally has `pnpm run test:corpus` on its own vitest config, which is **not** part of `test:board`.

**The domain package carries per-directory coverage ratchets** (`packages/domain/vitest.config.ts`). This slice's directory is `src/adapters/host/**`, floored at **58% lines, 10% branches, 30% functions, 52% statements** (`:150`) — the lowest floors in the file, so a new connector operation without tests drops below them easily. The pure side of the domain is gated at 100%, so anything added under `src/entities/` or `src/rules/` needs full coverage.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers into sandbox repositories, and two agents running it here produced 53 concurrent `node --test` processes and a board that could not answer a request in 25 seconds.

### Changeset

One changeset, **description FIRST and the `bumps:` block LAST** — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships. Name `plot` and `@plot-pm/domain`. Run `./scripts/check-changeset-packages.sh` before pushing; it refuses a description shorter than 20 characters.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher reads it as a claim and the anchored one does not, and it cost a red main on 2026-09-01.
