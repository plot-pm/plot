# Panel moderation — a-burst-keeps-the-states-that-answered

**Reconciliation: `unanimous reject` — estate, evidence.** The first reject of the session, and **both jurors reached it by running the code.**

## The plan proposed a fix for behaviour that already works

The estate juror drove the verbatim functions with a stub `bb` answering `open` and refusing `merged`/`declined` with a secondary-limit message, and measured all three shapes on `main`:

| shape | measured | the plan's Done-when |
|---|---|---|
| burst after one state answered | **exit 7**, row kept, missing states named | exit 7, rows parsed, state named |
| burst on every state | **exit 6**, no rows | exit 6 |

**Those are the plan's own acceptance criteria, passing today.**

## And the fix already shipped

`988dac2cb` — *"The arm reports the states that answered"* (#951) — merged 2026-09-18, released in **v2.19.0**, six days before the issue was filed. The plan's own title in different words. Verified by the moderator: the commit exists and `git tag --contains` places it in v2.19.0.

Seven existing tests cover the proposed slice.

## The draft's mechanism, disproved three ways

1. **`exit` inside `$(...)` kills only the subshell.** A five-line experiment settles it without a host — bash semantics, not Bitbucket's behaviour: the loop continued, `ok=2 failed=1`, script exit 0.
2. **`die6` is never called.** `grep` returns its definition at `:427` and two comments; the burst path is `pr_list_failed` at `:517-530`.
3. **The file states the property three times** — `:558-565`, `:610-617`, `:955-960` — each describing precisely the mechanism the draft claimed was broken.

**The draft quoted `:808-809` and missed the two headers that answer it.**

## A second, independent disproof

The evidence juror ran its own structural mimic and named the reason the first did not: **`plot-host.sh:379` is `set -uo pipefail` — no `-e`**, verified by the moderator. A non-zero subshell status escalates nowhere, so the loop survives **by construction rather than by luck**.

**Two jurors, two experiments, one answer.**

## What the moderator adds

**This is the error the session has been correcting in other people's tickets, committed in its own plan.** The 969, 968 and 966 panels each caught a mechanism inferred from partial reading; this one was written that way from the start and reached a commit message before a juror ran the code.

**The reject is not a rejection of the report.** #970's symptom is real, this path cannot produce it, and the issue names Plot 2.20.0 — which contains the fix. That is a question for the reporter, not a plan.

## The disposition

**Withdrawn, and the phase stays `Draft`.** `plot-state-gate.sh` refused `Draft → Rejected` because no command writes `Rejected` — a missing transition the gate's own message says to file rather than route around, now recorded in the plan's Notes.
