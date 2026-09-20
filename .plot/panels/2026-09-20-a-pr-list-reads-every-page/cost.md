# Cost — juror verdict

Position: amend
cost: amend

Subject: `docs/plans/2026-09-20-a-pr-list-reads-every-page.md`
Lens: the cost — what 1 call → 18 does to the budget, the rate limit and the board's cadence, and whether the plan survives it.

**Amend, not reject.** The defect is real, the measurement reproduces, and the plan's core claim survives contact — I re-ran it and got `size=886 pagelen=50 values=50 next=YES`. But the plan's one cost paragraph ("What paging costs, and why it is still worth it") is wrong in the direction that matters, and it disclaims the consequence rather than measuring it. Two findings are hard: the cadence arithmetic turns a 4-minute board into a **21-minute** one, and a **targeted query exists** that answers the join's exact question in ONE call — which I measured returning `size=1` for a real branch. The second finding makes the 18-page walk the wrong shape, not merely an expensive one.

---

## 1. The board refreshes every 21 minutes, and the plan's disclaimer does not hold

The plan's escape hatch, lines 67-71:

> **This plan does not decide the board's refresh strategy.** Whether a board asks for every merged page on every tick is a cadence question […] This one makes the complete list *available*; it does not make it mandatory on every timer.

**It does make it mandatory, because the cadence is derived and not configured.** `fleet.ts:1679-1682` states this as the design:

> DERIVED, NOT CONFIGURED, and the plan's open point is answered that way on purpose: a configured cadence is a second number that must be kept true, and this one follows from a fact the adapter already states.

The fact the adapter states is `PR_REQUESTS_PER_REFRESH`, a **hardcoded literal** at `fleet.ts:184-193`, read through `prRequestsPerRefresh` (`fleet.ts:1909-1912`):

```ts
export function prRequestsPerRefresh(backend: string): number {
  const cost = PR_REQUESTS_PER_REFRESH[backend];
  return cost && cost > 0 ? cost : 1;
}
```

There is **no per-call, per-repository or per-state path into that number**. It is keyed on the backend string alone. So after this plan lands, a Bitbucket board making 20 requests per refresh is still *declared* to make 4, and `prRefreshMsFor` stretches for 4. The plan cannot leave the cadence alone: it either under-declares the cost — which `fleet.ts:176-179` names as the exact failure the table exists to prevent —

> an under-counted cost under-stretches the cadence, and an under-stretched cadence against an already-hit limit is the failure this measurement exists to prevent

— or the constant is corrected, and then the interval follows mechanically. Computed against the real rule (`refreshIntervalMs`, quiet account, stretch 1):

| | cost | interval | refreshes/hr | requests/hr |
|---|---|---|---|---|
| bitbucket today | 4 | **240 s (4.0 min)** | 15.0 | 60 |
| bitbucket, merged paged | 21 | **1260 s (21.0 min)** | 2.86 | 60 |

**A 21-minute board.** And this is the *quiet-account* case. On a busy account `targetStretch` returns `MAX_CADENCE_STRETCH = 8` (`cadence.ts:32`), so the worst case moves from 32 minutes to **168 minutes — 2.8 hours** between PR refreshes.

The plan says (line 58) *"the alternative is a list that is 94% incomplete."* That is a false dichotomy, and finding 3 is the third option. But taken on its own terms, the trade it actually makes is: a complete list that is up to 21 minutes stale, replacing a 94%-incomplete one that is 4 minutes stale. The plan does not state this trade, and `fleet.ts:1692-1695` shows the author of the cadence stating exactly this kind of trade when they made a much smaller one (*"up to four minutes old instead of one"*).

## 2. The rate-limit headroom is spent, and the account-wide 429 is closer than the plan's silence implies

The plan never uses the words *rate limit*. `fleet.ts:171-178` does, about this account:

> A board left open a working day made ~1400 Bitbucket requests just watching, and reached `HTTP 429 — Rate limit for this resource has been exceeded` account-wide, with every `bb` call from the operator's own shell failing too.

The hourly total stays 60 **only if the constant is corrected**. Correct it and the budget holds but the board is the one in finding 1. Leave it at 4 and the arithmetic is: 15 refreshes/hour × 20 requests = **300 requests/hour**, 2400 in an eight-hour day — **1.7× the ~1400 that took this account down**. That is the under-stretch `fleet.ts:176` forbids, reached by exactly the route it warns about.

I could not find a third option in the existing code. `host_concurrency_bound` does not help — the sibling juror measured Bitbucket's `basis` as `unknown`, so nothing throttles — and `bb_paginate` (finding 4) has no rate awareness at all.

## 3. The strongest finding: a targeted query answers the join's question in ONE call, and I measured it

**The board's join is keyed by head branch**, not by PR. `fleet.ts:2522` and `:2534-2537`:

```ts
if (pr.head && pr.state === 'OPEN') map.set(pr.head, pr);
…
if (pr.head) {
  const held = byHead.get(pr.head);
  if (!held || prOutranks(pr, held)) byHead.set(pr.head, pr);
}
```

Every one of the 886 rows that does not match a branch the board is tracking is **discarded on arrival**. The plan pages 886 PRs so that ~7 of them survive the join.

`bb pr list` has no branch filter — I checked `--help`, which offers only `--state` and `--author`. But the REST endpoint the plan has just opened up does, through the same `q=` form `bb_pr_list_query` already builds for `--author` (`bb:445-474`). **Measured just now on `quaweb-website`:**

```
$ bb api "/repositories/quatico/quaweb-website/pullrequests?q=state%3D%22MERGED%22%20AND%20source.branch.name%3D%22feature/ki-anwendungen-unter-angebote%22&pagelen=50"
  size:    1
  values:  1
  ids:     [902]
  heads:   ["feature/ki-anwendungen-unter-angebote"]
```

One call. Exact. Complete. `size=1`, no `next`, nothing to page. A control against a branch with no merged PR returned `size: 0` with HTTP 200 — an honest absence, not a failure, which is precisely the distinction `plot-fleet-scan.sh:846` is quoted in the plan's own Done-when for protecting:

> Deriving absence from a partial list would report a real PR as having none — strictly worse

**A per-branch query derives absence from a complete answer about that branch.** It satisfies the plan's stated goal — no fabricated *no PR ever opened* — at a cost proportional to the branches the board tracks rather than to the repository's history. On this repo that is 7 calls against 18, and it does not grow as the PR count grows, which is the growth curve #333 says it is worried about.

The honest counter is that a repo with 60 tracked branches would pay 60 calls where paging pays 18 — so the shapes cross over. **That is a comparison the plan must make and does not.** It measured one number (886) and never measured the other side (branches). Neither shape is obviously right; picking one without the second number is what I am refusing.

## 4. `pagelen=50` is not a free choice, and `bb`'s own paginator caps at 10 pages

Two mechanical facts the plan states without checking.

**Bitbucket refuses 100.** Measured:

```
$ bb api "…/pullrequests?state=MERGED&pagelen=100"
error: HTTP 400 — Invalid pagelen
```

So 50 is at or near the ceiling and 18 pages is a floor, not an artefact of a conservative choice. This *supports* the plan's page count — I looked for a cheaper page size and there is not one. It also removes the easiest amendment.

**`bb`'s own paginator would silently truncate at page 10.** `bb:201-232`:

```bash
  local page=0

  while [[ -n "$url" && "$page" -lt 10 ]]; do
```

At `pagelen=50` that is a hard ceiling of **500 rows — 386 short of the 886 the plan is trying to reach** — and the loop simply exits, returning a short array with no error and no marker. The plan's chosen route (`bb api`) goes through `cmd_api`, not `bb_paginate`, so the adapter must implement its own walk and the cap does not apply. **But the plan never says this**, and its Done-when — *"the walk terminates on an empty `next` and cannot loop"* — reads equally well as a description of `bb_paginate`, which terminates and cannot loop and is also wrong. An implementer reaching for the helper that already exists gets 500 of 886 and a green test. **The Done-when must name `bb api` explicitly and pin that the walk is not `bb_paginate`.**

## 5. `PR_LIMIT = 1000` is already ignored, and the plan inherits an unanswered question

`fleet.ts` sets `PR_LIMIT = 1000` and documents it as a real ceiling. On the Bitbucket arm it is discarded with a warning, `plot-host.sh:3205-3206`:

```bash
      if [ -n "$limit" ]; then
        echo "plot-host: bitbucket ignores --limit $limit; bb returns a fixed page (50 at 1.0.0)" >&2
      fi
```

Once the adapter can page, `--limit` becomes *answerable* on Bitbucket for the first time — and the board is asking for 1000, which at `pagelen=50` is **20 pages, not 18**, and rises with the repo. The plan scopes itself to "page until `next` is empty" and never asks whether the caller's bound should stop the walk. Honouring `--limit 1000` is both cheaper and what the caller asked for; `issue-list` already does exactly this on the same backend (`plot-host.sh:3719-3722`, *"Honour the caller's --limit HERE"*). **Silently walking past a bound the caller stated is a third behaviour, and the plan picks it by omission.**

---

## What I could not refute

- **The defect and its severity.** 886 vs 50 reproduced exactly. 836 invisible merged PRs is real and the plan is right that #333 under-estimated it.
- **The 403 diagnosis.** The missing leading slash is a genuine finding and the plan is right to reopen the question its predecessor closed.
- **The `merged`-only framing.** `open` is 3 rows and `declined` 13 — both one page. The plan is right that only `merged` is large, and right that `open` is what a board reads most.
- **`pagelen=50` as the ceiling.** I went looking for a cheaper page size to defuse finding 1 and Bitbucket refused 100.

## What would move me to proceed

Any one of:

1. **The per-branch count.** Measure how many distinct branches the board joins against on a real Bitbucket estate. If it is materially below 18, finding 3 is the plan and the walk is not.
2. **The cadence stated and accepted.** If the walk is right, say in the plan that `PR_REQUESTS_PER_REFRESH.bitbucket` becomes ~21 and a Bitbucket board refreshes every **21 minutes** (168 at the ceiling) — and have someone accept that. `fleet.ts:1692` shows the house style for exactly this disclosure.
3. **Decouple the walk from the timer.** The plan's own instinct — *"it does not make it mandatory on every timer"* — is right and currently unimplementable, because the cost table is a per-backend literal. Make `merged` a rarely-refreshed state (it is near-static; a merged PR does not un-merge) and the complete list costs 18 calls an hour rather than 18 per refresh. This is the same shape the concurrency juror proposed and it composes with the 240 s stretch instead of against it.

## What would move me to reject

Landing the walk while leaving `PR_REQUESTS_PER_REFRESH.bitbucket = 4`. That is 300 requests/hour against an account measured going down at ~1400/day, with the under-count being precisely the failure `fleet.ts:176-179` was written into the file to prevent.
