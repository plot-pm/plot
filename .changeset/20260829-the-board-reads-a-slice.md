---
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

The board reads a slice.

The board's call sites move from `plan.waves` to `plan.slices`, and the
compatibility aliases slice 1 left behind are removed. One vocabulary, one
entity.

**The aliases were a bridge with an end date, and this is the end date.** They
existed so the domain's rename could land without touching the board's call
sites in the same diff — the schema change and the call-site churn reviewed as
distinct claims. Both have now landed. Leaving one behind would mean two names
for one entity, which is the defect the rename removes.

**`tsc` named the work, not a grep.** Deleting the downward alias — the
`.transform((plan) => ({ ...plan, waves: plan.slices }))` on `FleetPlanSchema` —
is what made the compiler enumerate every site that had not moved: **21 property
accesses across 6 server files** (`fleet.ts`, `auto-dispatch.ts`, `board.ts`,
`agent-panel.ts`, `worker-log.ts`, `worker-question.ts`), plus 5 type references
to `WaveVerdict`/`WaveVerdictSchema` in the contract and two client modules. A
grep would have been the wrong instrument: `schema.ts` alone carries ~200
occurrences of "wave", nearly all of them either prose or the board's own
`WaveSchema`.

**Three fields spelled `waves` survive, and each is a different entity.** Only
the first was ever this branch's:

- `FleetPlanSchema`'s outbound alias — **removed.** Its slices are slices.
- `summary.waves` — **kept.** A counter in the wire format `plot-fleet-scan.sh`
  still emits; renaming it here would break parsing against an unchanged scan.
- `PlanMetaSchema.waves` — **kept.** A different producer (`plot-plan-meta.sh`)
  with its own wire format.

**The inbound tolerance stays.** The `z.preprocess` that rewrites an incoming
`waves` key to `slices` is untouched, so a new board still reads an old scan.
The producer emitting the new name is step 2 of the migration, with its own
timing decision, and a branch that edited the emitter would have widened past
its plan. Removing the outbound alias while keeping the inbound one is the whole
safety argument: two mechanisms in one file, and only one of them belonged here.

**The board's own `WaveSchema` keeps its name.** It is a genuinely different
entity — the derived per-`(plan, wave)` render state the board builds for
itself, not the domain's slice — and renaming it belongs to whoever builds the
real fleet cohort.

**What proves it:** `pnpm run typecheck` clean; the board suite passing with no
test edited beyond the renames. Two domain tests moved: one readout of
`p.plans[0].waves[0]` became `.slices[0]` — a rename — and the test asserting
the alias was *inverted into a regression lock* asserting its absence, since the
behaviour it guarded is the behaviour this change removes. The board's `.mjs`
fixtures still feed `waves:` as scan input, untouched, which is what keeps them
proof that the inbound compatibility survived.
