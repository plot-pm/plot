# A spend line names its caller

> The ledger records ten fields per host call and none of them is *who asked*. So 2 497 Bitbucket requests an hour are attributable to nothing, and two plans in one week blamed a process contributing 4%.

## Status

- **State:** Rejected
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1069
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- Each host-call record names the component that made it, so a saturated account can be attributed instead of guessed at.

Board impact: the board reads the ledger for its cadence. This adds a field and changes no reading.

## Motivation

Measured twice independently on 2026-09-29, `~/.plot/state/budget.tsv`, last 60 minutes:

```
total            2825 req/hr
  bitbucket api  2497   88%
  github graphql  284   10%
  jenkins          42
  github core       2
```

And the consequence, live from `/api/fleet`: a **511 s** board interval against a 60 s baseline — a stretch of **8.52** against `MAX_CADENCE_STRETCH = 8`. The board is pinned past its ceiling by traffic that is not the board's.

### The ledger cannot say whose it is

A line carries ten fields:

```
b1  github  jwloka  graphql  1790694088036  1  -  -  -  unknown
```

Schema version, connector, account, endpoint class, timestamp, cost, three limit fields, basis. **Nothing names the caller** — not the process, not the repository, not the command.

### What that cost, twice, this week

- **#1059** blamed unbundled per-branch supervisor calls. An instrumented tick refuted it: **2 calls**, gated on `claimable && briefPresent`.
- **#1065** blamed the supervisor's missing backoff. It is **~8% of the account**, and stretching it would have removed 5% of a load it did not create while pinning hand-overs at eight minutes permanently.

**Both plans reached a panel with a diagnosis, and both were wrong about who spends.** Each took a juror an hour to refute by instrumenting a process. A caller field answers it with `sort | uniq -c`.

## Design

### The rule

**Every spend line names the component that made the call.**

The writer already knows: `plot-host.sh` is the one place that talks to a host CLI, and it is invoked by a named script or a named adapter. What it does not yet do is write that down.

### The field is a LABEL, and the account field is not — the difference is settled

`plot-host.sh:2387-2391` states why the **account** field is a match key rather than a label:

> it STAYS PER-ACCOUNT DISTINGUISHABLE, because the field is a MATCH KEY and not a label: `plot-budget.sh:250` is `if ($2 != want_c || $3 != want_a) next` … a CONSTANT redaction would merge their rate windows

**A caller field is the opposite: nothing matches on it.** `plot-budget.sh` filters on connector and account; the cadence rule sums a window. So a caller may be a plain string, needs no hash, and **must not become a match key** — the moment something filters on it, a missing or wrong value starts changing a rate rather than annotating one.

### Where the value comes from

**The slice decides between two, and both are available:**

1. **The caller declares it** — an environment variable `plot-host.sh` reads, set by each invoking script. Explicit, and wrong wherever somebody forgets.
2. **The process derives it** — the parent's name, or `$0` of the invoking script. No cooperation needed, and it says `bash` on a machine where that is all it can see.

**Neither is free and the slice states which it took.** The estate's precedent is (1): `PLOT_SCRIPTS_DIR`, `PLOT_MANIFEST_FILE` and `PLOT_UNATTENDED` are all caller-declared.

### A ten-field line becomes eleven, and something reads it

`plot-budget.sh` parses positionally (`:250` indexes `$2`, `$3`). **Appending is the safe end**, and the schema version field `b1` exists for exactly this — the slice says whether it bumps.

### What this does NOT do

- **It does not throttle anything.** This is attribution. Whether the 2 497/hr is legitimate is the question it makes answerable, not one it answers.
- **It does not change the cadence rule.** `boardSharePerHour`, `othersPerHour` and `cadenceStretch` sum a window and keep summing it.
- **It does not redact.** A caller is a component name, not a credential — unlike the account field, which `:2377` hashes for a reason.
- **It does not add a host call.** The ledger is local and already written on every call and every refusal.

## Done when

- **A spend line names its caller**, asserted for at least the board, the supervisor, and a shell script's direct call.
- **`plot-budget.sh` and the cadence rule read the same totals as before**, asserted — an attribution field that changes a rate is a defect, not a feature.
- **The 88% is attributed** and the number recorded in the PR. That is the measurement this plan exists to make possible, and a slice that ships the field without taking the reading has not finished.
- **An unknown caller is written as unknown**, not omitted and not guessed. A missing value must not shift a line into the wrong column.
- **The schema decision is stated** — appended field, and whether `b1` becomes `b2`.

## Slices

### A spend line names its caller (Branch: infra/a-spend-line-names-its-caller)

Add a caller field to the ledger line, populate it from the invoking component, and take the attribution reading on this estate.

## Notes

**This is not a performance plan.** 2 497 req/hr may be entirely correct for two boards polling an estate with 900+ PRs. The defect is that nobody can tell, and that two plans in one week guessed wrong in the same direction — toward the component that was easiest to read rather than the one that was spending.

**The ledger has been measured before and changed at the source.** `plot-host.sh:2393` — *"AT THE SOURCE rather than at `budget.tsv`, because fixing the one known writer leaves the next to inherit the defect"* — is the precedent for where this field is written.

**Its siblings, both narrowed by panels after blaming the wrong process:** [`a-tick-asks-the-host-once`](2026-09-29-a-tick-asks-the-host-once.md) (#1059) and [`a-daemon-spends-within-its-means`](2026-09-29-a-daemon-spends-within-its-means.md) (#1065). Neither is this plan's dependency, and this plan is what would have shortened both.


## Rejected, 2026-09-29

One juror, **reject**, **executed**. Moderation: `.plot/panels/2026-09-29-a-spend-line-names-its-caller/panel.md`.

**The ledger already names the spender, and this plan aggregated the field away before declaring it absent.**

`plot-host.sh:2679-2685` defines the Bitbucket account as the workspace parsed from `remote.origin.url`:

> The remote's owner is the free approximation and is the half of the key that groups correctly: two checkouts of one workspace share a budget.

Re-run with the account kept rather than summed — same file, same window:

```
bitbucket/quatico/api     2205     <- the 88%
github/jwloka/graphql      771
bitbucket/plot-pm/api      240     <- this repository
```

**The 88% is the `quatico` workspace. This repository is `plot-pm`.** The `Done when` bullet *"The 88% is attributed"* was satisfiable with one `awk` over the existing file, at zero cost — and issue #1069 asked for exactly that breakdown, which this plan skipped.

**The stated consequence was also backwards.** `spendRateFor` (`fleet.ts:1870`) shells `spend-rate` with no arguments, which resolves to **this** connector and account: measured `github/jwloka`, **969/hr**. The Bitbucket `quatico` traffic is filtered out at `plot-budget.sh:250` and was never in the board's window. So *"the board is pinned by traffic that is not the board's"* is false — it is pinned by ~900 GitHub calls an hour under this user's own account.

**And appending a field would break every reader.** `plot-budget.sh:248` is `if (NF != 10 || $1 != "b1") { unreadable++; next }` — an arity gate, not positional parsing. An eleventh field makes every new line **unreadable**, not merely ignored.

**Attribution and rate are different questions.** Neither #1059 nor #1065 turned on *who*: the first needed calls-per-tick, which the ledger cannot express because it has no tick boundary; the second needed *does throttling help*, which a share cannot answer.

**#1069 is rephrased, not closed.** The 88% is real and it is another checkout saturating a shared Bitbucket account — a finding worth owning, and not the cause of this board's stretch.