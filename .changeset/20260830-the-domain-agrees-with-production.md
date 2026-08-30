---
'plot': minor
---

The corpus test tier: `@plot-pm/domain`'s adapters are proven to read what
production reads, against this repository's real estate.

It compares **readings, not verdicts**, and that is the honest comparison for
an adapter. There is no second implementation of the rules to disagree with —
the board imports the domain's, so a rule with one implementation cannot
disagree with itself. An adapter that drops a field, or reads `state` where
production reads `mergedAt`, absolutely can, and would otherwise surface as a
domain that is correct about the wrong facts.

Two comparisons, both over the live estate: the `PlanStore` adapter against
`plot-plan-meta.sh` over every plan, field by field and slice by slice, and the
`Refs` adapter against `plot-fleet-scan.sh`'s pulse. Measured 2026-08-30 on 172
plans — the plan quoted 158 and its brief 170, because the number is a
measurement rather than a constant — **zero disagreements**.

**Two fields are live samples and cannot be compared for equality across the
two invocations this tier needs.** `changed_ago_seconds` is `now` minus a
commit time; two scans 30 s apart agreed on every verdict, state, claim and
branch and differed here by exactly the elapsed time. `worker_activity` is a
0.4-second CPU delta over a live process tree, and the comparison *causes* the
difference it would measure — the observed pid is the suite's own worker loop,
whose subtree burns CPU while production's scan runs and then blocks while the
adapter's does. Both are compared for what does not move: the elapsed count
against a tolerance, the activity cue against its enum. The `worker` state they
qualify is not exempt.

Both suites also assert the direction an adapter cannot fail by itself: every
key the wire emits is either mapped or written down as deliberately uncarried.
A port narrower than the wire on purpose and an adapter that forgot a field
look identical from inside the adapter, so a field production grows arrives as
a question rather than as silence.

**It runs as its own CI job, parallel to `validate`.** The tier spawns the
fleet scan twice and the parser over every plan; `validate` already carries a
15-minute browser step inside a 25-minute ceiling. Separated, the two signals
stay readable — a red `validate` means the board, a red corpus job means the
adapters and production disagree — and running per PR rather than nightly is
what makes "a disagreement fails CI" a gate rather than a report.

On a disagreement the adapter is **not** adjusted to match. Which side is wrong
is judgement, and the failure prints the field, the plan and both readings so a
person can decide.
