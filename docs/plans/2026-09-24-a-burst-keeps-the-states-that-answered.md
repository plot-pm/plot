# A burst keeps the states that answered

> On Bitbucket, `pr-list` asks once per state, and a burst refusal partway through discards the rows the earlier states already answered with. Every branch then reads from local evidence alone and none is offered to `--next`. **The first draft named a mechanism that a five-line experiment disproved; this plan states the symptom and rules that mechanism out.**

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #970
- **Rounds:** 1

## Changelog

- A burst refusal partway through Bitbucket's per-state `pr-list` keeps the states that already answered, reporting exit 7 (partial) instead of exit 6. Measured on a Bitbucket repository at Plot 2.20.0 with 28 branches in one call: the scan reported `secondary`, every branch fell back to local evidence, and none was offered to `--next` — including branches whose PR state had already arrived.

Board impact: none directly. The scan's verdict reaches the board's fleet payload, so a `secondary` where `partial` is correct renders more branches as unreadable than the host actually refused.

## Motivation

**The rule this needs is already written in the file, as settled design.** `plot-host.sh:808-809`:

> a failure propagates — `pr_list_call` exits — and `pr_list_states` classifies the state as failed, which reaches the caller as **a partial answer (exit 7) when other states answered**, or as the failure's own code when none did. One vocabulary.

So the intended behaviour is not in dispute and this plan proposes no new one. **It reports that a documented contract has a hole**, which CLAUDE.md names as the finding to file rather than work around.

## Design

### WITHDRAW THIS PLAN — the fix shipped in v2.19.0, six days before the issue

**`988dac2cb` — *"The arm reports the states that answered"* (#951), merged 2026-09-18, released in v2.19.0.** The plan's own title in different words, and the juror found it.

The phase stays `Draft` because **no command writes `Rejected`** — `plot-state-gate.sh` refused the edit and named the gap: the lifecycle is Draft → Approved → Delivered → Released. That refusal is correct and is itself a finding, recorded in the Notes.

### The behaviour this plans already works

A panel juror drove the real functions with a stub `bb` answering `open` and refusing `merged`/`declined` with a secondary-limit message. **The estate produces every outcome this plan's Done-when asked for, today, on `main`:**

| shape | measured on main | this plan's Done-when |
|---|---|---|
| burst after one state answered | **exit 7**, row kept, missing states named | exit 7, rows parsed, state named |
| burst on every state | **exit 6**, no rows | exit 6 |

There is nothing to build.

### Why the draft was wrong

It claimed `die6`'s `exit 6` kills the process before `pr_list_states` reaches its `_ok > 0` test. Three independent disproofs:

1. **`exit` inside `$(...)` kills only the subshell.** A five-line experiment: the loop continued, `ok=2 failed=1`, script exit 0. And **`plot-host.sh:379` is `set -uo pipefail` with no `-e`**, so a non-zero subshell status escalates nowhere — the loop survives by construction, not by luck.
2. **`die6` is never called.** `pr_list_failed` (`:517-530`) is the real path.
3. **The file says the property three times** — `:558-565`, `:610-617`, `:955-960`, each describing the exact mechanism the draft claimed was broken.

**The draft quoted the header at `:808-809` and missed the two headers that answer it.** That is the process error, and it is the same one this repository's tickets keep surfacing: a mechanism inferred from partial reading and written as settled.

### What is still unexplained, and belongs to the issue

The reported symptom is real — a Bitbucket estate saw `secondary` with rows discarded. **This code path cannot produce it**, so the cause is elsewhere and unfound. Candidates nobody has read yet: whether the Bitbucket arm reaches `pr_list_states` at all, and what `plot-fleet-scan.sh` does with a 7 it does receive.

**#970 needs re-checking against 2.19.0+ rather than planning.** The issue reports Plot 2.20.0, which contains `988dac2cb`. Either the reporting estate runs something older, or the symptom has a cause this path cannot produce — and that question is answered by asking the reporter, not by building anything.

## Slices

### A burst returns to the loop that can report it (Branch: bug/a-burst-returns-to-its-loop)

- `bug/a-burst-returns-to-its-loop` — read whether the Bitbucket `pr-list` arm reaches `pr_list_states` and record the answer in the plan before changing anything; where it does not, route it through the loop rather than giving it a second copy; tests for burst-after-one-state, burst-on-the-first-state, and the unchanged GitHub single-call path

## Notes

- Reported from a Bitbucket repository with 28 branches in one `pr-list`. **Not reproducible here**: this estate is on GitHub, which answers `--state all` in one call, so the loop that leaks has no second iteration to be refused on.
- **The first draft claimed the fix was control flow, not classification, and that claim is withdrawn.** It rested on `die6`'s `exit 6` killing the process; `die6` is never called, `pr_list_failed` is the real path, `exit` inside `$(...)` kills only the subshell, and `plot-host.sh:610-617` states that property explicitly. A five-line experiment disproved it in one command.
- **A LIFECYCLE GAP, found by trying to use it:** `plot-state-gate.sh` refuses `Draft → Rejected` because no command writes `Rejected` — the lifecycle is Draft → Approved → Delivered → Released. The gate's own message says to file that rather than work around it, so the plan stays Draft and this is the filing. `/plot-reject` exists as a skill; nothing writes the phase it implies.
- **That is the error this repository keeps finding in its own tickets, committed here.** A mechanism inferred from reading and written as settled — the same shape the 969, 968 and 966 panels each corrected. The correction is kept in the Design section rather than deleted, because a plan that quietly drops a wrong diagnosis teaches nothing.
