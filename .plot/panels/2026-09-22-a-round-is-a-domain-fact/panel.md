# Panel moderation — a round is a domain fact

**Subject:** `docs/plans/2026-09-22-a-round-is-a-domain-fact.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `unanimous` — `amend=rule,caller`. **2 of 2 gated. Nobody said proceed or reject.**

| Lens | Evidence | Position |
|---|---|---|
| rule | **Measured every plan carrying a `Rounds:` field — 112 of them** | amend |
| caller | **Counted all 41 panel subjects and classified the four the plan cites** | amend |

## What survives: the gap is real, verified three ways

| claim | verdict |
|---|---|
| `grep rounds packages/domain/src` returns nothing relevant | **TRUE** — 3 hits, all coincidental ("on the grounds", "backgrounds", "Rounds to the nearest beat") |
| `plot-plan-meta.sh` parses it | **TRUE** — `:242-250` documents it, `:657-665` resolves it, three sources with a stated precedence |
| `PlanCard.tsx` renders it | **TRUE** — `roundsBadgeText:226`, rendered `:412`, carried on both `PlanMeta` and `Card` |

**The domain genuinely has no idea what a round is.** A field that is parsed and rendered with no rule behind it is the shape this estate has removed elsewhere, and the plan identifies it correctly.

## Why it is amended: the evidence inverts, and two refusals do not survive contact

### 1 · "Four panels, four skipped writes" is one day, and the day says the opposite

Measured across the estate:

```
41 panel subject directories
35 of 41 subjects carry a Rounds: field        — 85%
the field's base rate across 268 plans         — 27.6%
```

**Panel subjects write the field at three times the estate's base rate.** The premise that prose does not get followed is contradicted by the population the plan is about.

**And the four cited are misclassified.** Every one was a **delivery** panel, gating on `supported|refuted`:

| subject | panel kind | the plan's own rule |
|---|---|---|
| `a-free-agent-is-not-a-finished-one` | delivery | a round here is meaningless |
| `a-loaded-label-is-not-a-running-daemon` | delivery | meaningless |
| `a-waiting-loop-has-not-finished` | delivery | meaningless |
| `a-failed-tick-must-not-end-the-daemon` | delivery | meaningless |

So the honest reading of that day is **over-counting delivery rounds, not under-counting draft ones** — three got an increment they should not have had, and the one that correctly got none did so on a stated reason that was false.

**The transition as specified would count all four.**

### 2 · `no-moderation` cannot be checked by a filesystem-free transition

This is the plan's headline — *"the one that earns the controller"* — and it is architecturally broken as written. The plan says the transition reaches no filesystem (correct, that is the domain's rule) and then hands it *"the moderation PATH"*. **A path is not an existence check.**

The estate already has the mechanism: `transitions/plan.ts:76-84` defines `Precondition` for exactly this — *"A fact a transition needs but cannot measure — supplied by an adapter"* — producing `precondition-unmet`. `recordRound` must take `moderationPresent: boolean` and the shell must do the `test -f`.

**That is mechanical, and it costs the plan its argument.** Once the check is a caller-supplied reading, the refusal catches *"called with no moderation"* and never *"never called"* — which is the failure the plan was written about.

### 3 · `phase-terminal` contradicts the plan two sections later

96 of 112 plans carrying a round are `Released`, and 8 are `Rejected`. The plan says a Released plan cannot gain a round, then says *"a rejected plan keeps its round beside its rejection."* If the refusal keys on terminality it refuses those 8; if it hardcodes `Released` it is not the rule its name claims.

### 4 · `zero-rounds` is unreachable as specified

The transition increments, so it can only produce ≥1. The refusal can only fire on a caller passing an explicit count — which the plan's signature does not admit. Pick one.

### 5 · The caller that works is already working

`challenge-the-plan/SKILL.md:371-377` specifies the write in *more* mechanical detail than this plan specifies the transition, and `:333` already names the direct-invocation caller the plan presents as unanticipated. **Slice 2 replaces a working, precise instruction to serve a caller that does not follow prose** — and swapping "write the field" for "call the controller" is not more enforced.

## The author's error, and it is the same shape as this morning's

**I measured one day's four panels and wrote it as a property of the practice.** The juror counted 41. This is the rejected plan's error repeated: there it was one desk standing for three, here one day standing for the estate. Both times the first move a juror made was to widen the sample, and both times that reversed the conclusion.

## What the moderation recommends

**Amend, and the amendment may be smaller than the plan.**

1. **Re-derive the premise or drop it.** 85% is not a failing practice. If the real defect is delivery panels incrementing a draft-only counter, that is a different plan with a different fix.
2. **Take `moderationPresent` as a reading**, via the existing `Precondition` mechanism. Say plainly what the refusal then catches.
3. **Name the exact refused phase set** and reconcile it with the Rejected carve-out.
4. **Make `zero-rounds` reachable or delete it.**
5. **Consider the cross-reference first.** `/plot-panel` step 5 never points at `challenge-the-plan:333`, which already states the rule. One line may be the whole fix, and the caller juror raises deriving the count from the panel directories that exist — no transition at all.

**Nothing is approved and nothing is dispatched.** The plan is Approved and this panel moves no phase; its slice stays unbuilt pending the amendments.
