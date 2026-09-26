# Panel — the board updates an index

**Divided: 1 reject, 4 amend.** Every juror committed; none hedged.

| lens | position | evidence |
|---|---|---|
| estate | **reject** | read |
| cost | amend | **executed** — ran the scan, timed it |
| staleness | amend | read |
| layering | amend | read |
| slicing | amend | read |

## The reject is not outvoted, because it refutes the premise

Four jurors said *amend* and one said *reject*, and this is not four-to-one. **Three of the four amends independently found the same thing the reject found**, and reached a milder conclusion about it.

**`publishPartial` already accumulates, server-side, since PR #242.** `fleet.ts:3242`:

```
const spoken = new Set(arrived.map((p) => p.file));
const plans = [...previous.filter((p) => !spoken.has(p.file)), ...arrived];
```

Its own comment states this plan's motivation, four months earlier: *"Plans this scan has spoken about win; plans it has not reached yet stay as they were."*

Verified against source by the moderator. The plan's central claim — *"a row absent from one arrival is erased"* — is false: `setFleet` does replace, but what it replaces with has already been composed over the previous answer. **A client-side index would be a second accumulator over an already-accumulated stream.**

The estate lens called that fatal; staleness and slicing called it an amendment. The estate lens is right about the consequence: if the accumulation exists, the first slice builds a duplicate merge rule, and the plan's diagnosis of the observed symptom is unexplained rather than fixed.

## A second false claim, found independently by two lenses

The plan states `complete` has **zero readers** in the client. `AgentList.tsx:2206` reads it:

```
{!fleet.complete && ' so far'}
```

Both the estate and slicing lenses found this, and slicing noted it is in the very file slice 1 must edit. The moderator's error is identifiable: the grep was for `pulseComplete`, the wire field is `complete`, and a payload dump showing `complete: bool True` was in hand and not connected.

## The cost argument does not survive measurement

**This is the only juror that executed rather than read**, and it is the one that refuted the plan's justification.

| consumer | plan's count | measured |
|---|---|---|
| `plot-fleet-scan.sh` | 15 | **6**, two of them `backend` probes |
| `plot-reconcile-scan.sh` | 15 | **2** executable |
| `plot-impl-status.sh` | 7 | **4** |

The plan's numbers were `grep -c plot-host.sh` — mostly comments and operator-advice strings. And the surviving calls are **already bundled**: reconcile makes one `pr-list` up front and tests set membership; the fleet scan's per-branch `pr-state` is short-circuited to zero calls when the list is known complete.

**The ~37 s rollup figure is the pre-fix number**, taken from #1005's own commit message. #1005 merged 2026-09-26 12:08 — about four hours before the plan cited it as live evidence.

## What no lens disputed

The observed symptom was real: two live agents' slices were absent from the board while WORKING showed both agents. **No juror explained it**, and with `publishPartial` established, the plan's explanation is withdrawn without a replacement. That is the open question this panel produced.

## Findings that would survive any redesign

- **`branch` is not a unique key** (staleness, measured). Two rows share a branch across plans; a last-write-wins map collapses them and the survivor carries the other plan's `plan`, `planFile`, `wave`, `sprint` and `section`. A row attributed to the wrong plan is worse than a stale one, because nothing about it looks held.
- **Git cannot invalidate every entry** (staleness). `localDirty` has no git question that refutes it. The correcting signal *is* the payload that omits the row — the signal this plan teaches the board to ignore.
- **An action does not know what the plan says it knows** (slicing). A 202 from `deliver` does not mean the plan moved; `approve.ts:199-206` shows the endpoint's answer is narrower than the plan assumes.
- **Slices 1 and 2 cannot land independently** (slicing). There is no context in this app, so slice 2's prop-threading touches every file slice 1 touches.

## The shared blind spot

**Four of five jurors read and did not run.** The one that executed is the one that overturned the plan's justification. The plan's own numbers came from `grep -c` rather than from counting call sites, and four lenses reproduced that reading without testing it.

## Recommendation

**Reject the plan as written.** Not amend: the diagnosis, the justification and two supporting claims are each independently false, and what is left is a symptom with no explanation. The findings above are worth keeping for whatever replaces it — beginning with reproducing the vanishing rows against a board that already accumulates.
