## Implementation brief — a-pr-list-reads-every-page

- **Plan (canonical):** `docs/plans/2026-09-20-a-pr-list-reads-every-page.md` on `main`
- **Approved:** 2026-09-20, jwloka, in-session
- **Branch:** `bug/a-branch-asks-about-its-own-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Sole slice of a single-wave plan. Nothing waits on it and it waits on nothing.

### What to build

The Bitbucket `pr-list` arm gains a **per-branch PR query** through the REST endpoint's `q=` filter, replacing the bulk listing that the board's join then discards 99% of.

The failure this fixes, measured 2026-09-20 on `quaweb-website`: the repository holds **886 merged PRs** and `bb pr list` returns **50**. The other 836 are invisible to the join at `fleet.ts:2522`/`:2534`, which indexes by `pr.head` and drops every row whose head is not a tracked branch. Those 836 resolve to *no PR ever opened* — the fabricated verdict `plot-fleet-scan.sh:876` rules against by name. An operator on that repository saw branches labelled `commits, no PR ever opened` that had live PRs.

The endpoint answers exactly, in one call:

```
$ bb api "/repositories/quatico/quaweb-website/pullrequests?q=state%3D%22MERGED%22%20AND%20source.branch.name%3D%22feature/ki-anwendungen-unter-angebote%22&pagelen=50"
  size: 1 | values: 1 | ids: 902
```

PR 902 is one of the 836 a listing cannot reach. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Do not page the list.** An earlier version of this plan walked `next` through all 18 merged pages and was refuted twice, both times by measurement. `fleet.ts:184` hardcodes `bitbucket: 4` requests per refresh and `prRefreshMsFor` stretches the interval by that cost so hourly spend stays 60. Paging makes the cost ~21, and the interval follows mechanically: **240 s → 1260 s**, and on a busy account `MAX_CADENCE_STRETCH = 8` takes the worst case to **2.8 hours**. Under-declaring the cost instead is the failure `fleet.ts:176` names by name. And the growth curve is backwards: paging costs scale with PR history — the very thing whose growth makes #333 worse — while a per-branch query costs what the board tracks and is constant in PR count.

**`pagelen=100` is refused by Bitbucket (HTTP 400).** 50 is the ceiling, so 18 pages was a floor rather than a conservative estimate. There is no cheaper paging shape to find.

**`bb`'s own paginator caps at 10 pages** (`bb:203`) — 500 rows at `pagelen=50`, 386 short of 886, **exiting with no error and no marker**. Do not reach for that helper.

**The leading slash is load-bearing.** `bb api` concatenates `"${BB_API}${path}"`, so omitting it yields `…/2.0repositories/…` and an **HTTP 403 that reads like a scope problem**. A previous plan was rejected for inferring exactly that from exactly this symptom. Pin it.

**The `--rich` envelope was the plan's decisive risk and it resolved in the plan's favour** — the adapter lens confirmed REST carries what the arm emits. The field set the jq program must produce is unchanged (`plot-host.sh:3247`): `number, title, state, head, draft, checks, mergeable, review, url, failing_checks`, with `state` mapping `DECLINED → CLOSED` and `head` from `.source.branch.name`. If a field turns out to be unavailable, **scope down to the plain list and say which field you dropped** — never drop one silently.

**Rules carried over unchanged.** An absent answer is not a false one: `size: 0` is an **honest absence** and must stay distinguishable from a refused call. Read the exit code, never the emptiness — `plot-fleet-scan.sh:891` records that a host exiting 0 while printing nothing once read as *"this repo has no PRs"*, which is the same outage-renders-a-fleet-unstarted failure from the other side.

### The mechanism moved since the plan was written

**Read `pr_list_states` (`plot-host.sh:555-640`) before you start.** PR #951 landed 2026-09-18 — after the plan's Design section was written — and restructured the arm this slice edits. `bb pr list` has no `all` state, so the arm now loops three states (open, merged, declined), collects them, and exits `PR_LIST_PARTIAL_RC` (7) when some answered and some did not, with the survivors' rows on stdout. `pr_list_report_truncation` is called **per state** from inside that loop.

The plan's *decision* is unaffected — #951 changed how the arm calls, not whether to page. What changed is the function you will open. The plan describes the pre-#951 shape.

### The completeness signal

**This is the requirement a working fix still fails without, and the plan states it one step too strongly.** Settle it before writing code.

**Two markers, two questions, and only one is at risk.** Both are written by `plot-fleet-scan.sh` from its own parsed row count; `plot-host.sh` neither writes them nor knows they exist.

- `.list-arrived` (`:872`) — *did the host answer at all?* Written unconditionally once the list is parsed.
- `.list-complete` (`:901`) — *was that answer whole?* Written only when `0 < rows < PR_LIST_LIMIT`.

**What `.list-complete` licenses is a shortcut, not the answer.** At `:974`, a `--ask` caller whose branch missed the join resolves to `NONE` **without a host call**. Drop the marker and control falls through to `:981`, which asks `pr-state` for that branch and gets a correct answer at the cost of one call. Two call sites pass `--ask` (`:1151`, `:1217`); two do not (`:1171`, `:3311`) and those key on `.list-arrived`, which this slice does not touch.

**So the plan's "every branch resolves to `-`" is the wrong failure.** `-` is `:1001`, the no-`--ask` path, reached only when `.list-arrived` is missing. Losing `.list-complete` degrades **cost**, not correctness — it re-introduces the per-branch N+1 that `#216` removed. Real, worth pinning, and not the catastrophe the plan describes. Do not write a fix that defends against the wrong one.

**The question changes shape rather than becoming unanswerable.** `0 < rows < PR_LIST_LIMIT` reads completeness off a single page's size. A per-branch sweep has no page: each query returns 0 or 1, and `size: 0` is already an exact answer for that branch. Completeness becomes a property of **the sweep** — *every tracked branch was asked and each answered* — which is a stronger claim than the page heuristic ever made, and one the arm can state rather than infer.

**Name the mechanism that carries it, and pin it.** Whatever you choose, the constraint is that a partial sweep must not write the marker: if any branch's query failed, the survivors are still valid answers but absence is no longer derivable. `pr_list_states` already models exactly this — it exits `PR_LIST_PARTIAL_RC` (7) when some states answered and some did not, with the survivors on stdout. A sweep that reuses that vocabulary keeps one rule where there would otherwise be two.

### Done when

The plan's `## Done when` list is the specification. Lifted from it, the assertions that exist **because a naive implementation passes without them**:

- **A branch whose merged PR is older than the first page is found.** PR 902 on `feature/ki-anwendungen-unter-angebote` is the measured case. Catches a fix that only widens the page.
- **The request path carries its leading slash, pinned.** Catches the 403-that-reads-as-a-scope-error, which has already misled one plan.
- **An honest absence is distinguishable from a failure**, pinned with *both* a 200/`size: 0` and a refused call. One without the other passes a fix that reads every outage as "no PR".
- **`.list-complete` is still written when it should be**, pinned. Without this assertion the guard silently stops licensing `NONE`, every unjoined branch pays a `pr-state` call, and the N+1 that #216 removed returns invisibly — a cost regression with no symptom a reader would report.
- **Host calls are proportional to tracked branches, not PR history** — stated with both measured numbers (11 branches, 886 merged PRs). Catches a fix that is correct and still scales with the wrong quantity.
- **`PR_REQUESTS_PER_REFRESH` matches what the arm now makes**, so the cadence stretches for the truth rather than for 4.
- **`pr_list_report_truncation`'s behaviour is unchanged and `host.test.mjs:3060` passes unedited**, while its comment's now-falsified premise (*"cannot report a total or a cursor"*) is corrected. The rule **"THE DETECTOR IS AGAINST THE REQUESTED LIMIT, NEVER THE CONSTANT 50"** stands. It has zero consumers, so its over-firing costs nothing — do not "fix" it.
- **The GitHub arm is untouched, pinned.**

Plus the repo's gates: `pnpm run test:contracts` passes, and `nvm use` first (Node 24 — pnpm crashes on 26). `test:e2e` is CI's gate, not a local one; do not run it.

### Bookkeeping

Open the PR through the controller — **never `gh pr create`**, which takes its title from the last commit subject:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists. A changeset is required: `'plot': patch`, description **first**, `bumps:` block **last**.

### Scope guard

This branch owns the Bitbucket arm of `skills/plot/scripts/plot-host.sh`, the completeness handshake in `skills/plot/scripts/plot-fleet-scan.sh`, `PR_REQUESTS_PER_REFRESH` in `packages/board/src/server/fleet.ts`, and their tests in `test/reconcile/host.test.mjs`.

No other branch is in flight on this plan — it is a single-wave, single-branch plan. The ref does not exist yet: `git ls-remote --heads origin bug/a-branch-asks-about-its-own-pr` is empty as of 2026-09-20, so **the first push is the claim** and nothing has taken it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
