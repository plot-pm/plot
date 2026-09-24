# A burst keeps the states that answered

> On Bitbucket, `pr-list` asks once per state. A burst refusal on the second call discards the first call's rows: `die6` exits the process, so the per-state loop's own *"partial answer when other states answered"* rule never runs. Every branch then reads from local evidence alone and none is offered to `--next`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #970

## Changelog

- A burst refusal partway through Bitbucket's per-state `pr-list` keeps the states that already answered, reporting exit 7 (partial) instead of exit 6. Measured on a Bitbucket repository at Plot 2.20.0 with 28 branches in one call: the scan reported `secondary`, every branch fell back to local evidence, and none was offered to `--next` — including branches whose PR state had already arrived.

Board impact: none directly. The scan's verdict reaches the board's fleet payload, so a `secondary` where `partial` is correct renders more branches as unreadable than the host actually refused.

## Motivation

**The rule this needs is already written in the file, as settled design.** `plot-host.sh:808-809`:

> a failure propagates — `pr_list_call` exits — and `pr_list_states` classifies the state as failed, which reaches the caller as **a partial answer (exit 7) when other states answered**, or as the failure's own code when none did. One vocabulary.

So the intended behaviour is not in dispute and this plan proposes no new one. **It reports that a documented contract has a hole**, which CLAUDE.md names as the finding to file rather than work around.

## Design

### Where the contract leaks

`pr_list_states` implements the rule correctly (`plot-host.sh:998-1005`):

```bash
if [ "$_ok" -eq 0 ]; then
  …
  return "$_first_rc"
fi
…
return "$PR_LIST_PARTIAL_RC"
```

`_ok > 0` returns 7. **That code never runs for a burst.**

`die6` (`:427`) is `echo … >&2; exit 6` — it terminates the **process**, not the call. The per-state loop is inside that process, so a burst on the second state kills the script with the first state's rows in hand and the `_ok` test unreached.

**So the classification is right and the control flow bypasses it.** Two functions in one file disagreeing about whether a refusal is fatal.

### Why the asymmetry was invisible

GitHub takes `--state all` in one call: a burst there genuinely means no rows arrived, and exit 6 is exactly right. Bitbucket has no `all` state (`:808`), so the same refusal can land after one or two states have answered.

**The state is keyed to WHICH error rather than to HOW MUCH ARRIVED** — and for every path except this one those coincide.

### The scan is correct and must not change

`plot-fleet-scan.sh:753` routes on the exit code and its comment states the assumption plainly: *"every other non-zero rc sets a verdict and returns BEFORE `$js` is read, because there is nothing to read."* That is true of what it is given. Feed it 7 and `partial` already does the right thing (`:637-649`):

> The rows that arrived are real and are parsed; what is missing is a whole state… Reporting `failed` would throw away rows that arrived and make every branch `unknown`, which is not startable — the right refusal about the wrong thing.

**That paragraph already describes the correct handling of this case.** The fix belongs in the adapter, and the scan needs no change — which is also the safer blast radius.

### The shape of the fix

Make a burst inside the per-state loop **return** rather than exit, so `pr_list_states` reaches its own decision:

- a burst with **no state answered** → exit 6 unchanged, because nothing arrived
- a burst with **one or more states answered** → exit 7, rows kept, the missing state named

`die6`'s reasoning survives intact: the two limits still recover differently and still carry their own codes. What changes is that a burst stops being fatal to a loop that knows how to report a partial answer.

### What this does NOT do

- **It does not retry.** `die6`'s comment is explicit — *"whether to wait is the caller's decision, and this adapter reports rather than reacts."* A burst clears in seconds and a retry here would hide the signal the caller needs.
- **It does not change exit 5.** A spent quota is a different ceiling and stays fatal in the same way.
- **It does not change the scan.** `partial` already exists and already does the right thing.
- **It does not make exit 6 mean two things.** No state answered still gives 6; the code keeps one meaning.

### Open Questions

- [ ] **Does exit 5 need the same treatment?** A spent quota mid-loop leaves the same rows in hand. The argument against is that a quota does not clear in seconds, so a partial answer would be followed by nothing — but that is a reason to report differently, not to discard rows. Worth deciding before this lands, and deliberately not assumed here.

### Done when

- A burst refusal on a state after at least one has answered exits **7**, and the rows that arrived are parsed.
- **A burst with no state answered still exits 6** — the regression this must not cause.
- The missing state is named in the message, as `pr_list_states` already does for its partial path.
- A GitHub `--state all` burst still exits 6 unchanged.

## Slices

### A burst returns to the loop that can report it (Branch: bug/a-burst-returns-to-its-loop)

- `bug/a-burst-returns-to-its-loop` — a burst inside the per-state loop returns rather than exiting, so `pr_list_states` reaches its `_ok > 0` decision and answers 7 with the rows it holds; tests for burst-after-one-state, burst-on-the-first-state, and the unchanged GitHub single-call path

## Notes

- Reported from a Bitbucket repository with 28 branches in one `pr-list`. **Not reproducible here**: this estate is on GitHub, which answers `--state all` in one call, so the loop that leaks has no second iteration to be refused on.
- The plan's one real finding beyond the issue: the issue proposes *"let the Bitbucket arm report exit 7"*, which reads as new behaviour. It is not — `pr_list_states` already computes exactly that and `die6`'s `exit` prevents it from being reached. **The fix is control flow, not classification**, and that is a smaller and safer change than the issue implies.
