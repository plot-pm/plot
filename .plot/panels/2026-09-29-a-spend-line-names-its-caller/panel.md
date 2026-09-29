# Panel — a spend line names its caller (#1069)

Subject: `docs/plans/2026-09-29-a-spend-line-names-its-caller.md`
Round 1, 2026-09-29. One juror, both commitments gated. One host call.

| Juror | Position | Evidence |
|---|---|---|
| consequence | **reject** | executed |

**REJECT. The ledger already names the spender, and the plan aggregated the field away before declaring it absent.**

## THE ACCOUNT FIELD IS THE REPOSITORY

`plot-host.sh:2679-2685` — the Bitbucket account is the workspace parsed from `remote.origin.url`:

> The remote's owner is the free approximation and is the half of the key that groups correctly: two checkouts of one workspace share a budget.

Re-measured by the moderator with the account kept rather than summed:

```
bitbucket/quatico/api     2205     <- the 88%
github/jwloka/graphql      771
bitbucket/plot-pm/api      240     <- this repository
```

**The 88% is the `quatico` workspace; this repository is `plot-pm`.** The plan's motivation table collapsed the account column, printed `bitbucket api 2497 88%` as one row, then concluded nothing could attribute it. **The attribution was in the field it dropped.**

Issue #1069 asked for exactly this — *"whether it is one estate or several … a per-repo breakdown"* — and the plan skipped it. The `Done when` bullet *"The 88% is attributed"* was satisfiable today with one `awk`, at zero cost.

## THE CAUSAL CLAIM IS BACKWARDS

`spendRateFor` (`fleet.ts:1870`) shells `spend-rate` with **no arguments**, which resolves to this connector and account. Verified live:

```
{"connector": "github", "account": "jwloka", "perHour": 969.59}
```

**The Bitbucket `quatico` traffic is filtered out at `plot-budget.sh:250` and was never in this board's window.** So *"the board is pinned past its ceiling by traffic that is not the board's"* is false — it is pinned by ~900 GitHub calls an hour under this user's own account.

Same defect as the previous plan by this author: **a consequence stated exactly backwards.**

## APPENDING WOULD BREAK EVERY READER

The plan said `plot-budget.sh` parses positionally and *"appending is the safe end"*. `:248` is:

```awk
if (NF != 10 || $1 != "b1") { unreadable++; next }
```

**An arity gate.** An eleventh field makes every new line **unreadable**, not ignored — in a 43 MB file three readers consume.

## ATTRIBUTION AND RATE ARE DIFFERENT QUESTIONS

The plan claimed the field would have shortened #1059 and #1065. Neither turned on *who*:

- **#1059** needed **calls per tick**. The ledger has no tick boundary, so the instrumentation was still required.
- **#1065** needed *does throttling help*, which a share cannot answer.

## Disposition

- **Plan → Rejected.** The instrument exists and the proposed one would break the readers.
- **#1069 → rephrased.** The 88% is real: another checkout saturating a **shared Bitbucket account**. That is worth owning — and it is not the cause of this board's stretch, which is this user's own GitHub traffic.

## What the juror could not settle

Whether 2 205 req/hr is *correct* for the `quatico` workspace. The breakdown says whose it is, not whether it should be that large.
