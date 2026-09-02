## Implementation brief — the-budget-knows-which-bucket-it-spent (wave Budgeting each bucket by name)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `bug/the-budget-knows-which-bucket-it-spent` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 7 of nine, and **the slice the rest of the estate waits on.** Two waves of this plan follow it, and BOTH waves of `2026-09-01-a-third-connector-costs-one-adapter` are gated on it — `feature/the-domain-forgets-the-vendor-list` carries `<!-- waits: bug/the-budget-knows-which-bucket-it-spent -->` on its branch line, which `plot-plan-meta.sh` parses and the scan turns into a `waiting` verdict. Landing this releases four branches.

It consumes the six before it: `packages/domain/src/entities/limit.ts` (`LimitReading`, `LimitBasis`), `packages/domain/src/entities/budget.ts` (`BudgetKey`, already keyed by `connector`, `account`, `bucket`), `packages/domain/src/rules/budget-record.ts` (`spendRate` at `:313`), the cadence division of slice 4, the refusal distinction of slice 5, and the router of slice 6.

### What to build

The budget record is read and written **by bucket name**, taken from the response headers of calls that were going to happen anyway — not from `gh api rate_limit`.

The plan states it: *"the record from slice 1 is keyed by bucket (`core`, `graphql`, and whatever `X-RateLimit-Resource` names), read from the response headers of calls that were going to happen rather than from `gh api rate_limit`, which was measured reporting 5000 while the headers reported 0."*

### The gate that reports safety it cannot see

`graphql_budget_spent()` at `skills/plot/scripts/plot-host.sh:596` asks `gh api rate_limit` and reads `.resources.graphql.remaining`. Its own docblock argues the call is free — *"measured 2026-08-27: three consecutive readings, all used=0"* — and that is true and beside the point.

**Measured 2026-09-01:** a polling burst tripped GitHub's secondary limit on GraphQL while both buckets read `5000/5000`. The gate was therefore false, the cheap path was chosen, and every `gh pr` call returned `API rate limit already exceeded`. REST answered normally throughout. The estate's whole reap stalled: 18 worktrees read `rule could not be asked` and every one was kept. `plot-host.sh:509-521` records it.

The plan names the principle: **a gate that cannot see the condition it gates on is worse than no gate, because it reports safety.** Fixing `graphql_budget_spent` is part of this slice, not a follow-up.

### Where the truth lives instead

`X-RateLimit-Resource`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` on the response of a call the adapter was making anyway. Three properties follow:

- **The reading is free** — no extra request, so the objection that justified `rate_limit` does not apply.
- **The reading is current** — it describes the call that just happened, not a separate endpoint's view of it.
- **The bucket names itself.** `X-RateLimit-Resource` says `core` or `graphql`; a connector nobody has written an adapter for will say a third thing. `BudgetKey` already carries the bucket as an unvalidated string for exactly this reason — do not close it into an enum.

### The decisions the plan settles — do not re-derive them

- **The bucket is the connector's own word, unvalidated.** `packages/domain/src/entities/limit.ts` states it: *"A closed set here is the edit that gets forgotten when GitLab arrives."*
- **Headers, not `gh api rate_limit`.** Done-when: *"`graphql_budget_spent()` returns true when the headers say the bucket is spent, asserted against a response whose `X-RateLimit-Remaining` is 0 — not against `gh api rate_limit`, which reported 5000 at that moment three times running."*
- **A spent bucket does not stop the other.** Done-when: *"A spent GraphQL bucket does not stop a REST call, and vice versa — the two are budgeted by name, so the board keeps answering from the bucket that has 4990 left instead of pausing on the one that has 0."*
- **`unknown` is never `free`.** Slice 1 settled that a connector reporting no limit records `unknown`. A missing header is not an empty bucket and not a full one.
- **The rate-limit contract belongs to the connector kind.** CLAUDE.md: `host` is the ONE connector of nine adapters. Do not push bucket vocabulary onto a filesystem port.

### Out of scope

- **Reacting** to a spent bucket — waiting for the reset is `bug/a-spent-bucket-waits-for-its-reset`, slice 8, and the plan says it *"needs the bucket naming from this slice to know which reaction applies."* This slice makes the reaction possible; it does not perform it.
- Bounding concurrency — slice 9.
- Widening `HostBackend` — that is `the-domain-forgets-the-vendor-list`, which waits on this slice.

### Done when

- The record is keyed and read by bucket name, from response headers.
- `graphql_budget_spent()` answers from the headers, asserted against a response whose `X-RateLimit-Remaining` is 0.
- A spent GraphQL bucket does not stop a REST call, and the reverse.
- A missing or unparseable header reads `unknown`, never `free`.
- A changeset, and the repo gates below.

### You are exposed to a rule that may end you

The idle rule ended twelve desks over two days. `bug/the-loop-reads-the-agents-own-stream` merged as #653 on 2026-09-02 and raised the transcript-quiet gate to 900 s against a measured maximum of 600.8 s, so this is now rare.

**Commits survive an ending and uncommitted work does not.** Commit early and often, and label an unfinished commit as unfinished. Three workers on 2026-09-02 finished their slice and were ended before opening a PR; each kept its work because it had committed, and finishing was a verification pass rather than a reconstruction.

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

**The domain package has coverage ratchets per adapter directory.** A new port operation without tests fails the build.

**Re-vendor a changed shell script.** `packages/board/` vendors scripts from `skills/plot/scripts/`.

### A caution on line numbers

`plot-host.sh` shifts while work is in flight — `host_failure_kind` moved from `:267` to `:280` inside one session on 2026-09-02. Name the function where both work, and re-read before citing a line.

### The changeset

Description FIRST, `bumps:` block LAST — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.
