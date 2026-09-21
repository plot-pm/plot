# The index holds what the host said

> A board that asks every question every time cannot be current. This is the index that remembers the answers, the delta call that refreshes it, and the rule that decides what to ask.

**Status:** design, 2026-09-21. Every number below was measured on this estate; none is assumed.

## The problem, measured

```
REFRESH_MS = 5_000          the board asks every 5 seconds
plot-fleet-scan.sh  32_105 ms   deriving the answer takes 32
```

**The board cannot be current by construction.** What an operator sees as *"almost always stale"* is the design, not a defect.

Where the 32 seconds go, measured by wrapping every call the scan makes:

| | ms | share |
|---|---|---|
| **one** `gh pr list --state all` | **30 744** | **96%** |
| `plot-host.sh backend` | 56 | |
| everything else — git, parsing, 306 plans | 1 305 | 4% |

**It is already bundled.** The 32 `plot-host.sh` references are 5 call sites and a run makes 2 calls. *Batch the requests* is not available as a fix, and that rules out the first architecture anyone proposes.

### The cost is per FIELD, not per call

`gh pr list --state all --limit 1000`, 933 pull requests:

| fields | ms |
|---|---|
| `number,title,state,headRefName,isDraft,url` | **5 417** |
| `number,statusCheckRollup` | **18 842** |
| `number,reviewDecision` | **14 373** |
| `number,mergeStateStatus` | 8 946 |
| `number,mergeable` | 6 522 |

Bitbucket says the same in its own words (`quatico/quaweb-website`, 902 PRs): `OPEN` 764 ms, **`MERGED` 6 931 ms**, `DECLINED` 1 568 ms. `--rich` — the Jenkins join — costs ~1 100 ms of 11 713 and is **not** the bottleneck.

**The expensive data is the data that rarely changes.** A merged PR stays merged; the board pays 6.9 s a refresh to re-learn it. `statusCheckRollup` changes while CI runs — for 2 of 933 rows.

## The measurement that decides the design

Both hosts filter by update time **server-side**, so the expensive fields are computed only for the matches:

| query | ms | rows |
|---|---|---|
| `gh pr list --json <all 10 fields>` | **29 811** | 933 |
| `gh pr list --search 'updated:>2026-09-20' --json <all 10>` | **943** | 3 |
| `gh pr list --search 'updated:>2026-09-14' --json <all 10>` | 2 339 | 35 |
| `bb api '?q=updated_on>=2026-09-14'` | 2 983 | 43 |

**Factor 32 on GitHub, with every expensive field included.** This is why the answer is an index plus a delta refresh rather than a cache in front of the same call: the call itself gets cheap when it stops asking about history.

## The index

**One file per connector per repository**, beside the pulse the board already writes:

```
.plot/state/index/<connector>.json
```

`.plot/state/` is machine-local and gitignored — `plot-boardctl.sh:83`'s reason: an index travelling in a commit would describe another machine's account.

```jsonc
{
  "v": 1,
  "connector": "github",
  "repo": "plot-pm/plot",
  "account": "jwloka",
  "watermark": "2026-09-21T18:42:11Z",   // the newest updatedAt SEEN, never `now`
  "full": "2026-09-14T09:00:00Z",        // when the last whole-history read ran
  "prs": {
    "954": {
      "number": 954, "head": "bug/...", "state": "MERGED",
      "updatedAt": "2026-09-21T12:03:44Z",
      "mergeCommit": "aadfeef6...",
      "checks": null,                     // absent, not false — see below
      "asOf": "2026-09-21T12:04:01Z"
    }
  }
}
```

**Keyed by PR number, not by branch.** A branch may carry several PRs over its life and the join already re-derives `byHead` in memory; keying by branch would make the index lose the older one, which is exactly the `--limit 1` defect `plot-pr-merged.sh` records.

**`watermark` is the newest `updatedAt` the host RETURNED, never the local clock.** Clock skew between this machine and the host would otherwise open a window in which a change is never seen: a PR updated at 18:42:10 host-time, read by a client whose clock says 18:42:12, is excluded forever by the next `updated:>18:42:12`. Taking the watermark from the data cannot skew.

**A field the host did not answer is absent, not false.** The three-valued reading this estate already insists on — `plot-board-probe.sh`'s `ok`/`failed`/`unknown`, and `an-unasked-host-is-not-an-absent-pr` for exactly this shape. An index that wrote `checks: false` for an unasked field would manufacture the verdict that plan exists to remove.

## What must be asked, and what must not

**The rule is the state, and it is not a heuristic.** A PR's state says whether it can change again:

| state | can it change? | refresh |
|---|---|---|
| `MERGED` | **no** — terminal | never re-asked |
| `CLOSED` (not merged) | reopenable, rare | delta only |
| `OPEN` / `DRAFT` | yes | delta, and `checks` on its own timer |

This is the same rule `plot-fleet-scan.sh` already applies with `PLOT_TERMINAL_CACHE` — *"a branch in a terminal state is asked about once"* — and the index is that cache made durable rather than a new idea.

**The delta query is what determines what changed; we do not compute it.** That is the design's centre: the host is the only thing that knows, and it answers in one filtered call.

```
gh   pr list --state all --search "updated:>$watermark" --json <fields>
bb   api "…/pullrequests?q=updated_on>=$watermark"
jira JQL "… AND updated >= '$watermark'"
jen  not indexed — `jen job list` is 14 ms
```

**Jenkins stays unindexed and that is a measurement, not an omission.** 14 ms is below the cost of deciding whether to look.

## The lifecycle

```
        ┌─ cold ─────────────────────────────────────────┐
        │  no index, or `v` unrecognised                 │
        │  → ONE full read, all fields, write watermark  │
        └───────────────┬────────────────────────────────┘
                        ↓
        ┌─ warm ────────────────────────────────────────┐
        │  delta since watermark, merge, advance it     │
        │  → 943 ms on this estate                      │
        └───────────────┬───────────────────────────────┘
                        ↓
        ┌─ suspect ─────────────────────────────────────┐
        │  a delta FAILED, or `full` is older than the  │
        │  reconcile window → full read, then warm      │
        └───────────────────────────────────────────────┘
```

**A failed delta never advances the watermark.** The window stays open and the next refresh re-asks it — the one direction an index may fail in, because a skipped window is a change nobody ever sees again.

**A periodic full read is required, not optional.** A delta cannot see a **deletion**, and `updated_on` is the host's word: a PR force-pushed without a metadata change, or a host that back-dates, would sit stale forever. The full read is the correction, and its cost is known — 30 s, once a day, off the request path.

**The index is a DERIVATION, never a record.** Deleting it must cost only time. Nothing may read it as the source of a lifecycle fact: `plot-pr-merged.sh` stays the one answer to *did this land*, and it may consult the index only where a miss falls through to the host.

## What changes at the call sites

Today `prefill_pr_states` makes one call and uses it whole. After:

```
read index  →  ask delta  →  merge  →  serve
   ~5 ms        ~943 ms      ~5 ms
```

**The board's own refresh stops waiting on the host at all.** The delta runs on its own timer — `PR_REFRESH_MS` already exists and is 60 s — and the 5 s render reads the index. That is what removes the structural staleness: the render path becomes local.

**`PR_REQUESTS_PER_REFRESH` must follow.** The declared cost is how `prRefreshMsFor` stretches the cadence; a delta is one request where the listing was three, and under-declaring is the failure that file names.

## What this does not fix

**A cold start still costs 30 s.** The index removes repetition, not the first read.

**An estate with 933 PRs updated today gains nothing** — the delta is the full read. The saving is proportional to how much of the history is quiet, which here is 930 of 933.

**It does not make the scan fast**; it makes the scan's expensive half *asynchronous*. Git remains 1 305 ms and is untouched.

## What is still open

1. **Where the index is read** — `plot-fleet-scan.sh` (shell, hot path) or the board (TypeScript, one reader). `docs/shell-and-domain.md` §1 decides it on frequency, and the scan runs per operator command while the board runs per refresh. **This needs deciding before anything is built.**
2. **Whether `checks` belongs in the index at all.** It is 18 842 ms of GitHub's cost and the most volatile field. A separate, shorter timer over OPEN rows only may be the shape — measured at 2 open PRs here.
3. **The full-read cadence.** Daily is a guess; the honest input is how often a delta misses something, which only running it will say.
