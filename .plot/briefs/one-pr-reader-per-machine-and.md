## Implementation brief — one-pr-reader-per-machine-and

- **Plan (canonical):** `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` on main
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Branch:** `feature/one-pr-reader-per-machine-and` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What the plan still leaves open — read this before coding

The plan is `Approved`, but its own `## Design` section has not settled on one
approach. It lists **four candidate proposals** and **five open questions**,
none struck off, and the plan carries no `## Done when` list at all. It went
Draft → Approved in one plan-PR with no recorded Design round that narrowed
the four to one.

The slice this brief hands off is named for proposal 1 — *"one reader per
machine and host account"* — and the branch name says the same thing, so that
is the approach to build. **But the brief cannot manufacture the plan's
missing decisions on the open questions below; where the plan is silent, say
so in the PR rather than picking silently:**

- Whether the cache lives under `~/.cache/plot/<host>/<account>/<repo>` (the
  issue's proposal) or extends the existing PR index at
  `.plot/state/index` under the common git dir (the plan asks explicitly
  which).
- How a reader elects itself and what happens when the lock holder dies —
  the plan asks, it does not answer.
- Whether this applies to GitHub too or is Bitbucket-only.

If any of these turns out to need a real design call beyond "follow the
nearest existing pattern" (named below), that is a correction to raise, not a
default to assume.

### Measured problem (for orientation — the plan's `## Motivation` is canonical)

Measured 2026-10-23 on one machine (issue #2386): 44 spenders on one Bitbucket
account — two boards and about 38 Claude processes, each listing PRs on its
own interval. Bursts return HTTP 429 while the account's own budget record
shows little spent, because the budget counts spend, it does not schedule it.

### The decisions already settled elsewhere — do not re-derive them

**`plot-budget.sh` (`skills/plot/scripts/plot-budget.sh`) measures; it does
not schedule.** Its record shape is literally `(connector, account, bucket)`
— one append-only line `b1 <connector> <account> <bucket> <at-ms> <spent>
<limit> <remaining> <reset-ms> <basis>`, lock-free via `O_APPEND` under
`PIPE_BUF`, rotated by rename. There is no jitter logic anywhere in the repo
for host-call scheduling (`grep -rn jitter` across `skills/` and `packages/`
turns up only git-push retry jitter in `packages/board/src/server/entry/
ladder.ts:29` and unrelated scheduler-jitter tests). **This plan is what adds
scheduling; nothing to extend exists yet.**

**`fleetOwnsPrs` is the nearest existing version of "one reader, everyone else
reads the cache" — and it only works while a fleet runs.**
`packages/board/src/server/fleet.ts:2234` checks a fleet-state bridge file and
`readPrsFromStore` (`fleet.ts:2244`) then serves PR rows from
`prStoreFor(opts.repoRoot).read(backend)` without asking the host. Per
`maybeRefreshPrs` (`fleet.ts:2308`): fleet running → read store; fleet absent
→ `refreshPrs` asks the host directly into an **in-memory overlay**, never the
real store ("the store stays the fleet's to write"). This is per-repository,
not per-machine, and it is gated entirely on a fleet supervisor existing. A
board or session with no fleet running — the 44-spender case in the issue —
always asks the host itself today. **The new mechanism is this same shape
generalized to "no fleet required" and "per machine+account, not
per-repository."**

**The PR index already has a port/adapter pair, and `PR_INDEX_VERSION` is a
hard version gate, not a soft one.** Entity: `packages/domain/src/entities/
pr-index.ts`; `PR_INDEX_VERSION = 5` is a zod literal, so an unversioned or
wrong-version store fails the parse rather than being read partially (CLAUDE.md:
*the index never says no* — a parse failure means "ask the host", never "no
PRs"). `foldPrIndex` (`packages/domain/src/rules/pr-index.ts:146`) has exactly
one caller, `writePrStore` in `packages/fleet/src/shared/pr-refresh.ts:1313` —
confirmed single writer. **The row schema carries no ETag or conditional-request
field today** (`PrIndexRowSchema`, lines 30-90) — adding one is a schema bump,
which per `PR_INDEX_VERSION` is a hard version increment, not an additive
change a reader can ignore.

**No conditional-request (ETag) support exists anywhere to build on.**
`grep -rn "ETag\|If-None-Match"` across `packages/domain/src` and
`skills/plot/scripts` returns zero hits. Bitbucket PR listing goes through
REST (`plot-host.sh:226` references `bb_window_listing`). **Proposal 4 (ETags)
needs its own measurement spike before it is buildable — do not assume
Bitbucket's PR-listing endpoint honors `If-None-Match` without checking.**
That measurement is explicitly out of scope for this slice unless the open
questions above make it load-bearing.

**A reusable lock pattern already exists — reuse its shape, don't invent a
new one.** `skills/plot/scripts/plot-push-lock.mjs` is a directory-based lock
under the **common git dir** (`git rev-parse --path-format=absolute
--git-common-dir`), using `mkdir` atomicity (no `flock` on macOS). The owner
file holds `pid\tat-ms\taction`; staleness is "dead pid OR alive but older
than `PLOT_PUSH_LOCK_STALE_S`" (default 600s), and a stale lock is renamed
before removal so only one breaker ever moves a given directory. This is the
pattern a "one locked reader per host account" implementation should copy,
not `plot-budget.sh`'s own lock (that one only guards its rotation rename, far
narrower than a read/write exclusion lock).

**Layering: this is not a third connector.** `host` and `tracker` are the
only two connectors in this repo (CLAUDE.md: a connector reaches a *remote
service* with an account, credentials, a rate limit, a transport). The new
shared-reader mechanism sits in front of the existing `host` connector as a
cache/lock concern, not as a connector of its own. `packages/domain/src/
ports/pr-index.ts` already separates the port (no decision) from
`foldPrIndex` (the domain rule); the new "which process reads, which process
asks the host" decision belongs in `packages/domain/src/rules/` the same way,
consuming a port that exposes lock-acquire/release and cache-read/write —
mirroring the existing `ports/pr-index.ts` / `adapters/pr-index/
pr-index-file.ts` split rather than reaching into `host-shell.ts` directly.

### Done when

The plan has no `## Done when` list — it was approved with open design
questions still unresolved (see above), so there is no checklist to lift
assertions from. Treat the following as the floor, and raise anything beyond
it as a correction if the open questions force a bigger decision:

- Exactly one process per `(machine, host, account)` asks the host for PR
  listings; every other board and session on that machine reads the shared
  cache instead.
- A missing or stale lock-holder is detected and a new reader elects itself —
  name the staleness window chosen and why, the way `plot-push-lock.mjs`
  names `PLOT_PUSH_LOCK_STALE_S`.
- A test proves the specific regression: two concurrent readers asking for
  the same `(host, account, repo)` result in exactly one host call, not two.
- The domain/port/adapter split holds: no domain code imports an adapter, no
  adapter is a bare script call from outside `adapters/`.

Plus the repo's gates: build artifacts stay out of the diff
(`scripts/check-no-bundle-diff.sh`), a changeset per
`## Versioning` in CLAUDE.md, and platform constraints (`nvm use` — Node 24,
pnpm crashes on Node 26).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints — the tests and typecheck for whatever
package the change touches. The suites in the `CI suites` config key
(`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, the
reconcile test glob) run in CI on every PR; do not run them locally as a
matter of course, and a failure there comes back as a correction, not
something to pre-empt by running the full suite yourself.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under
`skills/` is longer than at its merge base. If this slice adds a `.sh` file
(e.g. a new lock script alongside `plot-push-lock.mjs`), that growth is paid
for in the same change — remove shell elsewhere, or put the rule in the
domain and reach it through a bundle, per *A Shell Script Asks The Domain* in
CLAUDE.md. The gate stores no number and grants no override.

### Bookkeeping

Open the PR through the controller, never `gh pr create` directly:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads which plan names the branch and opens the PR with the plan and this
brief in the body. Push the first real commit as soon as it exists — fifteen
branches once sat with finished work nobody could see because no PR was
raised at all.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section.

### Scope guard

This branch owns: the new lock/cache mechanism and its port/adapter pair
(wherever in `packages/domain/src/{ports,adapters,rules}/` the implementation
lands), plus whatever in `packages/board/src/server/fleet.ts` and
`packages/fleet/src/shared/pr-refresh.ts` changes to read through it instead
of (or in addition to) the existing fleet-only path.

**No other branch is in flight against this plan** — it has exactly one
slice, so there is no sibling to collide with. Verify this is still true at
dispatch time (`/plot-pulse`) in case a correction splits the slice later.

If the open design questions above turn out to need more than "follow the
nearest existing pattern," report that rather than improvising a design call
the plan never made.
