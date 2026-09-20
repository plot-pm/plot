# One exit code, one answer

> `exit 7` means *partial answer, keep the rows* on one adapter path and *total refusal, discard them* on the other, because a rule taught to `hostSaid` was never taught to the host port.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The host port reports a partial PR list as partial rather than as a refusal. A Bitbucket board stops discarding the pull requests the host already returned.

<!-- Board impact: the host port gains a variant the domain already models; the
     board reads it. No plan format, no template, no layout. -->

## Design

**Measured on a live Bitbucket board, 2026-09-20.** Seven PRs on screen, all
reading *no PR ever opened*, while the host had three open — #358, #405, #445.
The board's `prAgeSeconds` was `null`: it had **never** completed a PR refresh.

### The two paths disagree about the same number

`plot-host.sh` exits **7** for a partial `pr-list` — some states answered, some
did not. Two adapters read that code and only one was taught:

| reader | exit 7 means | rows |
|---|---|---|
| `scripts-shell.ts:100` `hostSaid` | `{ answer: 'partial', stdout, said }` | **kept** |
| `host-shell.ts` `record()` | `refusalKindOfExit(7)` → `'failed'` | **discarded** |

`refusalKindOfExit` knows `EXIT_QUOTA = 5` and `EXIT_SECONDARY = 6` and returns
`'failed'` for everything else. Seven was added to the shell and to `hostSaid`
by `a-partial-page-is-not-an-outage` (#951) and **not** to the port.

### The domain already models this correctly

`ports/scripts.ts` carries `partial` as a proper variant, with its own argument
for why:

> *"`partial` CARRIES BOTH, AND THAT IS WHY IT IS A VARIANT RATHER THAN A FLAG …
> Adding `said?` to `answered` would have let every caller keep reading it as
> whole, which is the asymmetry this union exists to prevent."*

**So the concept is right and the enforcement is not.** What lives in the domain
is the *shape* of an answer; what decides which shape a run produces is a
number, mapped in two adapters independently. `ports/host.ts` has no `partial`
at all — `PortResult` is answer-or-refusal.

### Two exits, one rule, and only one knows it

The same split exists inside the shell. `pr_list_states` classifies correctly:

```bash
[ "$_ok" -eq 0 ] && return "$_first_rc"   # nothing answered — a real outage
return "$PR_LIST_PARTIAL_RC"              # some answered — partial
```

But `plot-host.sh` carries **20 `die` calls** (17 `die`, 3 `die3`), and `die`
runs `exit 1`. An `exit` ends the script, so the collector never runs, `_ok` is
never read, and the classification **does not happen**. Rows already printed go
out with a code that says total refusal, and nobody decided that.

**This is the `plot-state-gate.sh` pattern:** a rule a path can walk past is a
rule, not a gate. Here the path is an `exit`.

### What was refuted on the way

Recorded because each cost a probe and none is the cause: a shimmed `bb` on the
board's `PATH` (the shim directory is empty), the adapter timing out (27 s
against a 120 s budget), `maxBuffer` (19 KB against 10 MB), concurrency (three
simultaneous `pr-list` calls all exit 0 with 66 rows), shared temp files (each
invocation is its own process with its own `$$`), a version mismatch between
bundle and shell (both carry `PR_LIST_PARTIAL_RC`), and a missing `exit 7`
(the shell exits with the variable, not the literal — my grep was wrong).

**The instrumented board settled it.** A probe on `hostSaid` showed
`code=1 out=3` for one call, while the same command by hand gave exit 0 with 66
rows — because the board has **two** `pr-list` sites and they are different
calls: `hostSaid(["pr-list","--rich","--state","all",…])` and the port's
`prList(state, limit)`, which asks **one state**. Three rows is the `open`
state. The port's path never reaches `hostSaid`, which is why the probe on it
stayed silent while `PRTHROW` fired.

### What this is NOT

**Not a change to the outage vocabulary.** Exits 3, 5 and 6 keep their meanings
and a run where nothing answered still refuses.

**Not a second implementation of the rule.** The point is the opposite: one
answer to *what does this exit code mean*, asked once.

## Slices

### The port answers partial (Branch: bug/the-port-answers-partial)

- `bug/the-port-answers-partial` — `host-shell.ts` reads exit 7 as a partial answer, keeping the rows and the sentence, and the exit-to-answer mapping is stated once

**Done when** `record()` treats exit 7 as an answer that carries rows **and** a
sentence rather than a refusal, pinned by a test with a PATH-stubbed `bb` that
fails one state; `refusalKindOfExit(7)` no longer returns `'failed'`, pinned;
the exit-to-meaning mapping is defined **in one place** that both
`scripts-shell.ts` and `host-shell.ts` read, so a future code cannot be taught
to one adapter and not the other — that single definition is the slice's point
and a test asserts both adapters agree for every code they know; `prList`'s
caller (`registryd-main.ts:436`) still refuses on a total outage, pinned;
exits 3, 5 and 6 are **byte-identical** in behaviour, pinned per code; and
`pnpm run test:contracts` passes.

### A failed state returns rather than exits (Branch: bug/a-failed-state-returns-rather-than-exits)

- `bug/a-failed-state-returns-rather-than-exits` — a `pr-list` state failure reaches the collector instead of ending the script, so the partial rule cannot be bypassed

**Done when** no failure inside the `pr-list` state loop can end the script
before `pr_list_states` classifies it, pinned by a test that a `die` path
reached mid-loop still yields 7 when an earlier state answered; a failure with
**no** state answered still exits with the kind it has today, pinned per kind;
the change is scoped to the `pr-list` path and the other 19 `die` sites are
**untouched**, since each ends an operation that printed nothing and the wider
change is a different plan; and `pnpm run test:contracts` passes.

## Notes

**This is a defect in my own merged work.** `a-partial-page-is-not-an-outage`
shipped the shell half, the `HostAnswer` variant and the `hostSaid` mapping, and
left the host port reading the same number the old way. The panel that reviewed
it asked about callers and I answered for `plot-fleet-scan.sh`, which was the
caller the issue named — not for the port.

**The failure is silent in the log.** The board writes nothing when this throws:
five lines in its log, all about auto-deliver. Diagnosing it required patching
the shipped bundle. Whether a swallowed host refusal should reach the board's
log is a question this plan does not answer and somebody should.

**One trigger is still unmeasured**: what makes the port's `prList` call fail on
this repository at all. The rows it returns are correct; something after them
exits non-zero. That question is narrower than this plan and does not change it
— whatever the trigger, the answer must not be *discard the rows*.
