# The budget is spent where it is needed

> GraphQL sits at 0/5000 while REST sits untouched at 4999/5000. The board asks the host the same questions about branches nobody is working on as about the one branch that just moved.

## Status

- **Phase:** Released
- **Type:** feature
- **Sprint:** <!-- optional -->
- **Issue:** #228
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** 2026-08-28, Jan Wloka, `feature/the-fallback-asks-the-other-budget`
- **Delivered:** 2026-08-28
- **Released:** 2026-08-28, 2.11.0

## Changelog

- The board and the fleet scan spend the host budget on the branches a reader is actually watching, and fall back to the untouched REST budget when the GraphQL one is gone — so a spent budget degrades the view instead of emptying it.

<!-- Board impact: touches skills/plot/scripts/plot-host.sh (the one place that
     talks to the host CLI), plot-fleet-scan.sh's fallback path, and the board's
     refresh cadence in packages/board/src/server/fleet.ts. Rebuild the artifact. -->

## Motivation

Measured 2026-08-22 on this repo:

```
core     4999/5000
graphql     0/5000
```

**Two separate budgets, one exhausted and one untouched.** `gh pr list` and
`gh pr view` spend GraphQL; `gh api` spends REST. Every host question Plot asks
goes through the GraphQL bucket, so the board reports *rate limited* while 4999
REST requests sit unused. Creating PR #331 by `gh api` succeeded during the
outage — the budget was there the whole time.

### What is already fixed, and must not be re-done

**The fleet scan already batches.** `plot-fleet-scan.sh:474` calls
`pr-list --state all --limit` once and joins locally, with its own measurement
in the comment (*one pr-list (all) → 1107 ms*). Issue #228's shape-fix —
"one `pr-list` returns every PR; the scan needs a local join, not N lookups" —
**landed for the scan's main path.** What remains is `host_pr_state --ask`
(line 567), the per-branch fallback for branches the join could not answer.

**The backoff already exists and works.** `a-rate-limit-is-not-an-outage`
(Released, #271/#272/#283/#284) routes every host consumer through
`rateLimitBackoffMs`, fetches the real reset time, and says *rate limit* rather
than *outage*. That plan's thesis was explicitly that a rate limit is not an
outage — **it never promised to reduce consumption**, and it does not. This
plan is the consumption half; do not re-litigate the reporting half.

So the remaining spend is: the scan's per-branch fallback, the board's periodic
refresh over every branch regardless of interest, and the fact that all of it is
on one of two budgets.

## Design

### The measurement that shapes this plan

**REST cannot simply replace GraphQL, and the naive migration is worse.**
Measured against this repo:

| Question | GraphQL | REST |
|---|---|---|
| List PRs + `statusCheckRollup` + `mergeable` | **1 call** | not available on the list endpoint |
| `mergeable_state` on a list | — | **`null`** — GitHub computes it lazily |
| Full data per PR | — | **2 calls** (`/pulls/{n}` + `/commits/{sha}/check-runs`) |

For 93 branches: **1 GraphQL call vs ~186 REST calls.** A blanket "use REST
whenever possible" trades one cheap call for a hundred and eighty, and loses the
check rollup on the way. That is the tempting fix and it is wrong.

**Therefore REST is a FALLBACK, not the default.** It is what answers when the
GraphQL budget is gone — a degraded, more expensive path that is still far
better than an empty board, because the REST budget is sitting there unspent.

### Four changes, in order of MEASURED value

**1. A secondary-limit refusal backs off instead of failing.** The measured
failure (above): `gh` refuses while both budgets read full, because the limit is
on concurrency rather than count. The 403 is the signal, and it needs no
pre-flight check to read. This is first because it is the only change with a
failure behind it in this repo.

**2. The scan's fallback asks REST when GraphQL is spent.** `host_pr_state --ask`
is the per-branch path. When the GraphQL budget is exhausted, the same question
answered through `gh api` costs a REST request Plot is not otherwise using. The
adapter is the only place that talks to the host, so this lives in
`plot-host.sh` and every caller inherits it.

**3. The board refreshes what a reader is watching.** Today's refresh treats
every branch alike. A branch whose PR is **merged** or whose plan is
**delivered** cannot change in a way anyone is waiting for; a branch in WORKING
or WAITING ON YOU can. `PLOT_TERMINAL_CACHE` already applies exactly this
reasoning to terminal states in the scan — this extends the idea to the board's
own cadence rather than inventing a second mechanism.

**4. The two budgets are visible.** The board reports *rate limited* without
saying which budget. A reader with 4999 REST requests available and 0 GraphQL is
told only that the host is unavailable, which is what sent this investigation
looking for a fix that had already shipped.

### GitHub only, stated rather than discovered

Changes 1, 2 and 4 are GitHub-specific. Bitbucket has a single budget, so there
is no second one to fall back to and no pair to distinguish; `bb` also reports no
rate information for change 4 to surface.

Written here rather than left implicit, because #228 was filed from a Bitbucket
repo and a reader will reasonably expect that backend covered. Change 3 (refresh
what is watched) is backend-agnostic and does apply there.

### What this plan deliberately does NOT do

**It does not lower the refresh frequency across the board.** That reduces spend
proportionally and makes the board staler for everyone, and staleness is the
defect the board exists to remove. Spending less per pass beats passing less
often — the same argument `plot-fleet-scan.sh` already won when it batched.

**It does not add a second cache.** `PLOT_TERMINAL_CACHE` exists and is a
derivation that git can invalidate. A second, differently-shaped cache is how
two sources of truth start.

### Open Questions

- [x] Does `gh api graphql` report remaining budget cheaply enough to check
      before spending? **Yes — the check is free.** Measured 2026-08-27: three
      consecutive `gh api rate_limit` readings all returned 5000 with `used=0`,
      at 0.34 s each. It consumes neither bucket.
- [x] Does the fallback degrade on Bitbucket, or is `bb` out of scope?
      **GitHub only, and the plan now says so.** Bitbucket has one budget and no
      second to fall back to, so change 1 is meaningless there. Measured the same
      day: `plot-host.sh` exposes no rate or budget op at all, on either backend
      — change 3 is new surface, not an extension of something Bitbucket lacks.

### The failure this repo actually had was NOT exhaustion

Measured 2026-08-27, minutes after `gh` began refusing with *"API rate limit
already exceeded for user ID 870334"*:

```
graphql: 5000/5000  used=0  reset_in=3599s
core:    5000/5000  used=0  reset_in=3599s
```

**Both budgets full, nothing spent.** The refusal was GitHub's **secondary**
limit — concurrent-request throttling — triggered by eight workers polling at
once against a cap of seven. `rate_limit` does not report it, and cannot: it
describes the primary buckets only.

**So a pre-flight check on `remaining` would have read 5000 available at the
exact moment every call was being refused.** Change 1 as originally framed —
*check before spending* — does not prevent the failure this repo has actually
experienced.

That does not retire the change; it re-prices it. What the REST fallback buys is
a second path when one bucket is genuinely gone, which is a real state a long-
running board can reach. What it does not buy is immunity from throttling.

**The change this measurement calls for is a fourth one: back off on the refusal
itself.** A 403 naming a secondary limit is the signal — it arrives at the moment
of failure, needs no pre-flight, and is the only one that describes what actually
happened here. Ordered first below, because it is the only change with a measured
failure behind it.

## Done when

- With the GraphQL budget at zero, the board still renders PR state — proven by
  a test that stubs an exhausted GraphQL response and asserts the REST path
  answered, not merely that no error was thrown.
- The REST fallback is **not** taken while GraphQL has budget. A test asserts the
  cheap path is still the default; otherwise change 1 silently makes every scan
  186 calls.
- A merged PR is not re-asked about on the board's ordinary cadence, asserted by
  counting host invocations across two passes (the technique #228 used: a
  PATH-stubbed CLI that counts).
- The rate-limit notice names **which** budget is spent and what remains on the
  other.
- `pnpm test`, `pnpm run test:board`, artifact rebuilt and committed.

## Branches

### Measured

- `feature/the-host-says-which-budget-it-spent` — the adapter reports remaining GraphQL and REST budget, and the rate-limit notice names which one is gone. Tests: a spent GraphQL budget with REST available is reported as such; both spent reads differently; a host that cannot answer says unknown rather than zero → #485

### Watched

- `feature/the-board-refreshes-what-is-watched` — the board's cadence skips branches whose state cannot change for a waiting reader. Tests: a merged PR is not re-asked across two passes, counted with a stubbed CLI; a WORKING branch is asked every pass; the skip is re-derived from git each pass and never persists a verdict → #494

### Fallen back

- `feature/the-fallback-asks-the-other-budget` — `plot-host.sh` answers through `gh api` when the GraphQL budget is exhausted. Tests: the REST path is taken only when GraphQL is spent; the cheap path stays the default; the two paths produce the same vocabulary; Bitbucket is unaffected

## Notes

Asked as *"how can we prevent the rate limit — only update what we're working
on, use REST, cache more?"* All three levers were real; the investigation
changed their ranking.

The REST idea looked like the biggest win and is the most dangerous of the
three: it is right that the budget is untouched and wrong that REST is a
substitute, because the list endpoint returns `mergeable_state: null` and no
check rollup. Measured on PR #331 — full data needs two REST calls per PR, so
93 branches cost ~186 requests against GraphQL's one. It earns its place as the
fallback that makes a spent budget survivable, not as the default.

"Cache more" turned out to be partly built (`PLOT_TERMINAL_CACHE`), and
"only update what we're working on" is the one with the most headroom left.

### Interrogated 2026-08-27

Both open questions answered by measurement, and the first one re-priced the
plan's headline change.

**The budget check is free** — three `gh api rate_limit` readings, `used=0`,
0.34 s each. So the question as posed has a clean yes.

**But exhaustion is not the failure this repo has had.** Minutes after `gh`
started refusing calls today, both buckets read `5000/5000` with `used=0`. The
refusal was GitHub's SECONDARY limit — concurrency, not count — from eight
workers polling against a cap of seven. `rate_limit` cannot report it. A
pre-flight check would have shown 5000 available while every call was being
refused.

That added a fourth change and moved it to the front: **back off on the 403
itself**, which arrives at the moment of failure and is the only signal that
describes what happened. The REST fallback keeps its place — a genuinely spent
bucket is a real state — but it is no longer sold as protection against the
throttling this repo actually met.

**Scope is now stated: GitHub only** for three of the four changes. Bitbucket has
one budget, so there is nothing to fall back to and no pair to name, and
`plot-host.sh` exposes no rate op on either backend. Worth saying out loud
because #228 was filed from a Bitbucket repo.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Is the GraphQL budget check free, and does it prevent the failure we had?", "a": "Free (used=0, 0.34s) \u2014 but both buckets were FULL during today's refusal; it was a secondary/concurrency limit rate_limit cannot report. Added a back-off change and ordered it first", "category": "nonFunctional"},
    {"q": "Does the fallback degrade on Bitbucket, or is bb out of scope?", "a": "GitHub only, stated in the plan \u2014 Bitbucket has one budget and plot-host.sh exposes no rate op on either backend", "category": "technical"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": false,
    "ux": {"happyPath": false, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
