# Evidence lens — a-burst-keeps-the-states-that-answered

Position: reject

## The crux claim is false, and bash decides it

The plan's Design section rests on one sentence (`:40-42`):

> `_ok > 0` returns 7. **That code never runs for a burst.** … `die6` … terminates the **process**, not the call.

It does not. `pr_list_call` is invoked as `_raw="$(pr_list_call …)"` — a command substitution, i.e. a subshell — so `exit 6` kills the subshell and the loop continues. `plot-host.sh:379` sets `set -uo pipefail` with **no `-e`**, so nothing escalates it.

### Experiment 1 — structural mimic (bash 5.3.15, darwin24.6.0)

```
--- run ---
  OK: state=open payload=rows-for-open
  LOOP SAW: state=merged rc=6 (loop still alive)
  OK: state=declined payload=rows-for-declined
  answered 2 of 3; missing: merged -> return 7
pr_list_states returned: 7
script reached the end
```

### Experiment 2 — the REAL `pr_list_states`, extracted unmodified from `plot-host.sh`, with a stub host that emits `"You have exceeded a secondary rate limit"` on state `MERGED`:

```
=== calling real pr_list_states ===
"OPEN"
plot-host: pr-list: host refused a burst — You have exceeded a secondary rate limit
"DECLINED"
plot-host: pr-list: answered 2 of 3 states; missing: MERGED
=== returned: 7 ===
```

**Exit 7, rows kept, missing state named — today, with no change.** That is verbatim the plan's entire "Done when" list.

### The only way the plan's claim holds is with `set -e`, which this file does not use

```
#!/usr/bin/env bash
set -eu   # ← NOT plot-host.sh
OK open -> rows-open
exit: 6
```

So the plan's mechanism is real bash behaviour — of a *different script*. It was inferred from reading `exit 6` and not executed.

## The behaviour the plan proposes to build is already built, documented, and green

`plot-host.sh:961` deliberately captures `_rc=$?` instead of propagating, and its own header states why (`:611-618`): *"the `exit` inside `pr_list_failed` leaves only that subshell … the subshell's exit code is captured and classified instead."* The plan quotes `:808-809` as the *intended* contract while `:611` describes the *implemented* one, three hundred lines closer to the code.

Two tests in `test/reconcile/host.test.mjs` assert exactly the plan's Done-when, against the real adapter:

- `:1038` "keeps the states that answered when one fails, and exits partial" — asserts rows `[300, 358]` survive, status is `PARTIAL_RC`, and is explicitly not 3/4/5/6.
- `:1074` "where NO state answers keeps the code it has today, by kind" — asserts `'You have exceeded a secondary rate limit'` on every state still exits **6**, the plan's named regression.

Both run green now:

```
✔ host: pr-list keeps the states that answered when one fails, and exits partial
✔ host: pr-list where NO state answers keeps the code it has today, by kind
ℹ pass 2  ℹ fail 0
```

`:4935` and `:4957` cover the same pair on the **sweep** path (7 with rows, 3 on total refusal). The plan's slice would implement a behaviour whose own regression tests already exist and pass. The one slice has nothing to change.

## What actually discards the rows — the plan's diagnosis is wrong

`bb_branch_sweep` (`:820`) is the mechanism, and the plan never mentions it. A `--branch` sweep queries **per branch per state** — the reported estate's 28 branches × 3 states = 84 REST calls. `bb_branch_sweep:860` is explicit: **"A BRANCH THAT FAILS ENDS THE STATE"** — one refused branch query `return`s and takes the whole state with it. A burst is a *concurrency* ceiling, so it does not politely hit one state: it hits whichever call is in flight, and on a sustained 84-call burst it hits all three.

### Experiment 3 — real `pr_list_states` over a sweep stub, burst on branch 4 of every state:

```
=== burst on branch 4 of EVERY state (sweep path) ===
plot-host: pr-list: host refused a burst — You have exceeded a secondary rate limit   (×3)
plot-host: pr-list: no state answered; this is not a partial answer
rc=6
```

`HOST_VERDICT=secondary`, every branch falls back to local evidence, none offered to `--next` — **the reported symptom, reproduced exactly, with `_ok > 0` reached and correctly evaluating to 0.** The classification did run; it was right about what it was given. Twenty-seven branches whose queries had already answered were discarded by `bb_branch_sweep`'s state-level `return`, one layer below where the plan is looking.

The real question is therefore *should a partially-answered sweep keep its branches?* — a question about the sweep's granularity and its `.list-complete` completeness contract, deliberately settled conservatively at `:860` and `:900-914`. That is a much larger and riskier change than "control flow, not classification", and the plan's closing claim that its fix is "smaller and safer than the issue implies" is the opposite of true: the plan is smaller than the defect.

## Honesty about measurement

`Notes` says **"Not reproducible here"** and names the GitHub asymmetry — that part is honest and creditable. But the Changelog writes *"Measured on a Bitbucket repository at Plot 2.20.0 with 28 branches in one call"* without attributing it to the reporter, and the Design section then states `die6`'s process-kill as settled fact with a line number. That is the repository's named recurring error: a mechanism inferred from reading and written as observed. One 15-line bash script — runnable on this GitHub estate, needing no host — disproves it.

## Exit 5

The Open Question is moot as posed: exit 5 needs no treatment for the same reason exit 6 needs none — `die5` is also inside the substitution, `pr_list_states` already classifies it, and `host.test.mjs:1079` pins `'API rate limit exceeded'` at 5 on total refusal while `:1042` uses that exact text as the partial case. The split was never arbitrary; there is no split. On the *sweep* path, exit 5 and exit 6 are again identical — both end the state at `:860` — so whatever is decided there must cover both, and a plan treating them differently would be inventing a distinction the code does not make.

## What to do instead

Re-diagnose against `bb_branch_sweep`, and report `plot-host.sh:808-809`'s comment as the actual defect found: it describes propagation semantics that `:611-618` contradicts, twenty lines of the file apart. That documentation conflict is what misled this plan, and fixing it is real and cheap.
