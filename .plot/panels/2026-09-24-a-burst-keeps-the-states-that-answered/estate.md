# Estate lens — a-burst-keeps-the-states-that-answered

Position: reject

## The central claim is false, and I refuted it by running the code

The plan says (`:40-44`): *"`_ok > 0` returns 7. **That code never runs for a burst.** … `die6` … terminates the **process**, not the call."*

It does not. `pr_list_call` runs inside a **command substitution**, and the loop already captures its exit code:

`skills/plot/scripts/plot-host.sh:961`
```
_raw="$(pr_list_call "$@" --state "$_s" --json 2>"$_tmp")"; _rc=$?
```

`exit 6` inside `die6`/`pr_list_failed` leaves **only that subshell**. `_rc` becomes 6, the loop `continue`s (`:978`), and `_ok`/`_failed` are tallied exactly as designed.

**This is not inference — the file says so twice and I executed it.**

- `:558-565` (`pr_list_call` header): *"EVERY CALL SITE MUST WRITE `|| exit $?`, AND IT IS NOT OPTIONAL. This is invoked as `_raw="$(pr_list_call …)"` — a COMMAND SUBSTITUTION, which is a subshell — so the `exit` inside `die5`/`die3` leaves that subshell only."*
- `:610-617` (`pr_list_states` header): *"WHY THE LOOP CANNOT KEEP `|| exit $?` … Collecting across states means the first failure can no longer end the run, so the subshell's exit code is captured and classified instead."*
- `:955-960` (inline in the loop): *"THE SUBSHELL'S CODE IS THE ONLY CHANNEL OUT, so it is captured rather than propagated. `pr_list_failed` runs INSIDE the substitution…"*

The plan quotes the header at `:808-809` but appears not to have read the two headers that describe precisely the mechanism it claims is broken.

## Executed proof

I extracted the verbatim functions into a harness and drove a stub `bb` that answers `open` and refuses `merged`/`declined` with `You have exceeded a secondary rate limit`:

```
[{"id":1}]                                            <- the row that arrived, on stdout
plot-host: pr-list: host refused a burst — …
plot-host: pr-list: answered 1 of 3 states; missing: merged, declined
RC=7
```

All three burst shapes, today, on `main`:

| shape | measured | plan's "Done when" |
|---|---|---|
| burst after one state answered | **exit 7**, row kept, missing states named | exit 7, rows parsed, state named |
| burst on every state | **exit 6**, no rows | exit 6 |
| single-state burst | **exit 6** | (GitHub single-call equivalent) exit 6 |

**Every one of the plan's four "Done when" criteria (`:82-85`) already holds on `main`.** There is nothing to build.

## The work already landed, and it landed before the reported version

`git log -S PR_LIST_PARTIAL_RC -- skills/plot/scripts/plot-host.sh` → one commit: **`988dac2cb` "The arm reports the states that answered (#951)"**, 2026-09-18.

Its message states the exact fix this plan proposes: *"Until now the first failure left the script through `|| exit $?` — after the earlier states' rows were already on stdout… The three states are now collected. Some answered and some did not exits 7."* It cites #912 and the `quaweb-website` operator's nine mislabelled branches.

**`v2.20.0` was tagged 2026-09-23 — five days after `988dac2cb`.** The plan's changelog (`:13`) reports the defect *"Measured on a Bitbucket repository at Plot 2.20.0"*. That version **contains** the fix. Either the reporting repository was not actually on 2.20.0, or the observed `secondary` verdict has a different cause — and the plan asserts neither.

## Tests already exist, including the exact three the plan proposes to write

The plan's slice promises *"tests for burst-after-one-state, burst-on-the-first-state, and the unchanged GitHub single-call path"* (`:91`). All three are in `test/reconcile/host.test.mjs`, from the same commit:

- `:1079-1102` — `pr-list where NO state answers keeps the code it has today, by kind`, which drives `'You have exceeded a secondary rate limit'` and asserts **`status === 6`** plus `notEqual(status, PARTIAL_RC)`.
- `:1104-1116` — `a single-state pr-list that fails is a failure, never a partial answer`.
- `:1060-1063` — asserts the partial code collides with none of `[3,4,5,6]`.
- `:4934-4955` — `a refused sweep is distinguishable from an empty one`: **`status === 7`**, one surviving row, `missing: merged` on stderr.
- `:4957-4971` — `a totally refused sweep keeps the failure code, never the partial one`.
- `:4987` — `a burst refusal keeps its own exit code through the sweep` (`status === 6`).
- `test/reconcile/fleet.test.mjs:5210,5322` — the scan side, feeding `exit 7` + `answered 2 of 3 states`.

## What the plan got right (and it does not save it)

Verified, all correct:

- `die6` at `:427` is exactly `die6() { echo "plot-host: $*" >&2; exit 6; }`.
- The `:808-809` comment exists and says what is quoted, word for word.
- `plot-fleet-scan.sh:753` routes `rc == 7` → `HOST_VERDICT=partial`, and `:634-635` maps exit 6 → `secondary`. The `:637-649` paragraph about `partial` is quoted accurately.
- The Bitbucket/GitHub asymmetry is real: `plot-host.sh:600` states *"GitHub takes `--state all` in a single call and can never reach this shape"*, and `:3190`, `:3265` confirm the GitHub arm passes `--state all`.
- The scan needs no change. Correct — but for the reason that it already receives 7.

Correct premises, correct target behaviour, **wrong diagnosis of the gap, and no gap.**

## What would actually discard the rows, if the report is real

I could not reproduce the reported symptom, and neither could the plan (`:95`, *"Not reproducible here"*). Candidates the plan never examines, any of which would produce `secondary` with rows in hand:

1. **The reporting repo is below `988dac2cb`.** Most likely. A vendored/cloned `skills/` copy does not move with the plugin version, and the plan's own version claim is inconsistent with the tag dates.
2. **The transport discards a non-zero rc's stdout.** The #951 message names this as the original mechanism (*"which the transport then discarded on the non-zero code"*). If a caller other than `plot-fleet-scan.sh:740-753` reads `pr-list` without the `rc == 7` arm, rows arrive and are dropped **outside** `plot-host.sh`. This is the one place a live defect could still be, and it is in a layer the plan declares out of scope.
3. **A burst on the per-branch sweep inside a single state.** `:803-809` is explicit that a refused branch fails the whole state. With `--branch` sweeps, one burst can void a state that would otherwise have answered — widening the blast radius of a single refusal. That is a real design consequence, distinct from the plan's claim, and untouched by it.

## Verdict

**Reject.** The behaviour the plan specifies is the behaviour `main` has. Implementing the slice means editing a loop whose control flow is already correct, guarded by seven tests that already assert the outcomes the plan lists as "Done when" — the likely result is a no-op diff or a regression in the `_ok == 0` path.

CLAUDE.md's own rule applies in the opposite direction from the one the plan invokes: *"Verify a plan against main before implementing"* and *"Measure before implementing a Plot optimisation — a sibling wave may have already removed the cost the brief targets."* Here the sibling wave is #951 and it merged six days before this plan was drafted.

**The right next action is to re-measure on the reporting repository**: get `git log -1 -- skills/plot/scripts/plot-host.sh` from it, and if it contains `988dac2cb`, capture the raw `plot-host.sh pr-list` exit code there. If it exits 7 and the scan still says `secondary`, the defect is in the caller and needs a different plan. If it exits 6 with rows in hand, I am wrong and I want to see that transcript.

The Open Question about exit 5 (`:78`) is worth keeping — but it needs no fix either, since `_first_rc` already carries 5 through the identical path.
