## Implementation brief — one-account-has-one-budget (slice: Asking the connector)

- **Plan (canonical):** `docs/plans/2026-09-01-one-account-has-one-budget.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session (4 rounds of interrogation)
- **Branch:** `bug/a-connector-answers-for-its-limit` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

First of nine, and eight wait on it. **The record cannot be shaped before it is known
what a connector can answer**, so this slice settles that and nothing else.

### What to build

One `Host` port op: *what is this connector's limit, and how well do you know it?* The
answer carries a value and a tag.

- **`actual`** — the connector has a rate-limit API or sends limit headers, and this is what
  it said. GitHub's `X-RateLimit-Limit` / `Remaining` / `Resource`.
- **`predicted`** — it has neither, so the adapter supplies a value from experience. Jenkins
  has no limit to report.

### The decisions the plan settles — do not re-derive them

**The ADAPTER answers, not a table in Plot and not a probe at setup.** A connector nobody has
written an adapter for cannot be called at all, so it has no budget to get wrong. This is what
makes GitLab and Trello cost nothing to add — and it is why there is no cold-start question to
answer.

**A `predicted` value is corrected by the session that disproves it.** A `throttled` refusal —
`plot-host.sh:245` already classifies stderr — is evidence the prediction was wrong, and it
updates for the rest of the session. **This is the piece a static default cannot have:** a
number shipped in Plot is stale the moment a vendor changes it; a number corrected by the
refusal it caused cannot be.

**`actual | predicted` is ORTHOGONAL to `PortResult`.** `answered | failed | unaskable` says
whether the question could be put; the tag says how the answer was come by. **A `predicted`
limit is `answered`** — the adapter is not failing, it is telling the truth about what it
knows. Do not model it as a failure.

**Use the vocabulary that exists.** `StateSourceSchema` (`entities/identity.ts:40`) is
`stated | derived | foreign | measured`, and `stateFailureMode` names how each goes wrong —
*"`measured`: decaying instantly"*. A limit reading is the same idea one level down: `actual`
decays, `predicted` is wrong until something proves it. Name the pair in that spirit rather
than inventing a second vocabulary.

**A connector is a kind of adapter.** Of nine adapters, exactly one is a connector: `host`
shells to `plot-host.sh` and its 11 `gh`/`bb`/`jen`/`jira` calls, while `refs`, `processes`,
`plan-store` and `performer` shell to scripts making **zero**. The rate-limit contract belongs
to the connector kind — a filesystem port must not be made to implement it. Recorded in
CLAUDE.md's layering rule.

**Do not touch the transport.** Whether a question goes REST or GraphQL is the adapter's
private business and belongs to `bug/one-router-chooses-the-path`. This slice asks about
limits, not routes.

### Done when

- The port op exists, and **`Host` still names no transport, no account and no bucket** — that
  is the property letting a connector hide all three, and what makes adding GitLab an adapter
  change rather than a domain change.
- GitHub's `actual` implementation reads the response headers of a call **that was going to
  happen anyway** — not `gh api rate_limit`, which was measured today reporting
  `graphql 5000/5000, used 0` while a real call's header said `Remaining 4854, Used 146`. **146
  calls spent, reported as zero, in a quiet moment.** That endpoint has never been able to
  answer this.
- One `predicted` implementation, and a test that a `throttled` observation updates it.
- **A connector with no limit records `unknown`, never `free`.** The repo has twice shipped a
  collapse of *cannot answer* into a value; do not make it three.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  changeset (`'plot': patch` and `'@plot-pm/domain': patch`, description first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

**Make the correction test discriminating.** Assert that a prediction proven wrong actually
changes — feed a `throttled` and confirm the value moves. A test that only checks the tag is
`predicted` passes against a value that never learns anything.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** the port op, its GitHub and one `predicted` implementation, and the
session-correction rule.

**It does not own** where the budget record lives (`bug/a-budget-belongs-to-the-computer`),
what gets appended (`bug/the-host-adapter-counts-what-it-spends`), the transport choice, the
cadence, or the reaction to a refusal. **Eight other slices are waiting; resist starting them.**

**In flight, 2026-09-01:** `feature/the-scan-reads-a-fleet-reading` (a `FleetPulse` →
`FleetReading` rename across ~207 sites — **touches `packages/domain/` broadly**, expect a
rebase), `feature/a-monitor-is-a-pure-rule`, `feature/a-worker-declares-what-it-finished`,
`feature/the-refusals-are-domain-rules`, `docs/a-machine-has-an-identity`.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
