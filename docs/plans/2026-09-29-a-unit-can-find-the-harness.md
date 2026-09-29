# A unit can find the harness

> Both units set a PATH and both comments name the same three binaries — *git, gh and node*. Neither names `claude`, which on this machine lives in `~/.local/bin`. A supervisor-started worker exits 127 before it writes a line, and that is indistinguishable from a worker that started and did nothing.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1068
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, jwloka, `bug/a-unit-can-find-the-harness`

## Changelog

- A supervisor-started worker finds its harness, or refuses with the reason instead of exiting 127 three times.

Board impact: none. This is the unit and the prompt template.

## Motivation

Reported 2026-09-29 alongside #1067: a supervisor-started worker exited **127 three times** — `claude` not on PATH. The operator worked around it in their own `.plot/worker-prompt.sh`.

### Both units have the gap, and both say why they should not

`units/com.plot-pm.registryd.plist:50-53`:

```xml
<!-- git, gh and node must be findable: launchd gives a job a minimal PATH
     and none of the three is on it. Add homebrew's prefix for your arch. -->
<key>PATH</key>
<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
```

`units/plot-registryd.service:38-39` says the same thing for systemd, with the same three binaries and the same omission.

**The comment enumerates what a job needs and `claude` is not in the list** — yet `templates/worker-prompt.sh:136` is `harness="${PLOT_HARNESS:-claude}"`, so the harness is exactly what a dispatched worker runs.

### TWO SYMPTOMS, NOT ONE, AND THE macOS ONE IS NOT `exit 127`

An earlier draft asked whether the unit's PATH **contains** `~/.local/bin`. The question is whether it **resolves the name**, and it does:

```
$ env -i PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin sh -c 'command -v claude'
/opt/homebrew/bin/claude

/opt/homebrew/bin/claude   2.1.231   <- what a supervisor-started worker runs
~/.local/bin/claude        2.1.282   <- what the operator's shell runs
```

**On this machine a supervisor-started worker does not fail. It silently runs a 51-version-stale binary.** That is a quieter defect than the reported one and nothing detects it.

| unit | PATH | symptom |
|---|---|---|
| launchd (`:53`) | carries `/opt/homebrew/bin` | **version skew** — resolves a cask install, misses `~/.local/bin` |
| systemd (`:39`) | **no Homebrew prefix at all** | **hard 127** — Linux `claude` installs to `~/.local/bin` |

**The mechanism is shared and the exposure is not.** An earlier draft asserted one gap and would have written one changeset sentence for two failures.

### THE REFUSAL ALREADY EXISTS, and an earlier draft proposed building it again

`plot-worker-loop.sh:2008-2021`, landed `85eaa80c` on **2026-09-06** — three weeks before the report:

- **`PLOT-BLOCKED` is written** (`:2018`), and its text names the exit code, the attempt count, and the repair: *"fix the invocation in the prompt file, then restart this agent with `/plot-dispatch --restart`"*
- **an ending record** with `reason: unstarted`, `actor: agent` (`:2016`)
- **exit 1**, so `plot-worker-state.sh` answers `failed` rather than `none`
- **three attempts is `START_ATTEMPT_BUDGET`** (`:359`) — the designed bound, logged each time, not a symptom

**And the binary is named by the shell itself:**

```
$ PATH=/usr/bin:/bin bash -c '. "$1"' _ .plot/worker-prompt.sh
.plot/worker-prompt.sh: line 2: claude: command not found
```

`$harness` is the command word, so bash's diagnostic names it and it lands in `.plot-worker.log` — which the marker tells the operator to read.

**Under test:** `test/reconcile/second-slice.test.mjs:353-391` asserts the marker, the reason, the actor, the exit code and the kept claim. It passes.

**So the half an earlier draft called *"the part that matters more"* is shipped**, and it said *"three exits at 127 is the current behaviour and the refusal replaces it"* — which would have had an implementer rebuild a tested path.

## Design

### The rule, narrowed after round 1

**The harness is RESOLVED at install time and baked into the unit, the way `__NODE__` already is.**

An earlier draft proposed a PATH list plus a refusal. The refusal exists (above), and **a PATH list is the wrong instrument** — this machine proves it: two installs, two versions, and which one wins depends on ordering that no list records a reason for.

`plot-fleetctl.sh:744` already bakes `__NODE__` from an absolute resolution at install time. **Resolve `claude` the same way**, honouring `PLOT_HARNESS`, and the unit carries a path rather than a search.

**That is what the issue asked** — *"a `command -v` probe at install time and a declared value beat a guessed list at run time"* — and an earlier draft declined it by reading the probe precedent backwards. `plot-board-probe.sh:288` is `cli_installed() { command -v "$1" …}`: it probes **because** a binary's location has several right answers while its name has one.

### An installed unit does not update itself

**This is the same caveat #1051 and #1053 carry.** A unit is filled at install time, so an operator on an existing fleet keeps their old PATH until `--stop` then `--start`. The plan adds no other upgrade path, and the slice must say so in the changeset — a PATH fix nobody re-installs is a fix nobody gets.

### What this does NOT do

- **It does not probe for the harness at install time.** `plot-board-probe.sh` is the precedent for probing, and it answers a question with several right answers; this one has a name the template already holds.
- **It does not change `PLOT_HARNESS`.** An operator naming their own harness is served by the same refusal.
- **It does not add a retry.** Three exits at 127 is the current behaviour and the refusal replaces it — retrying a missing binary cannot help.
- **It does not touch the supervisor's own PATH needs**, which are `node` and already satisfied.

## Done when

- **`--start` resolves the harness and bakes it into the unit**, asserted by reading the filled unit — following `plot-fleetctl.sh:744`'s `__NODE__`, with `PLOT_HARNESS` honoured.
- **`--start` refuses when the harness cannot be resolved at all**, naming it, the way the node refusal already does. A unit that bakes in a path that does not exist fails later and quietly.
- **Both comments name the harness.** They enumerate *git, gh and node* and that list is what went stale.
- **A worker that CAN find its harness is unchanged**, asserted.
- **The changeset says an installed unit needs `--stop` then `--start`** — a baked value is not updated by pulling, the same caveat #1051 and #1053 carry.
- **The template half is recorded as undeliverable to existing adopters.** `plot-install-prompt.sh` never overwrites (`:8-10`, `:67`, verified: `--check` answers `current`), so a template change reaches only a fresh `/plot-init` — **including the reporter, whose own file carries their workaround.**

**Removed from an earlier draft:** the refusal bullets. `plot-worker-loop.sh:2008-2021` writes the marker, the ending record and exit 1, and `test/reconcile/second-slice.test.mjs:353-391` asserts all of it. If a gap remains it is a fixture variation on a passing test, not a feature.

## Slices

### A unit can find the harness (Branch: bug/a-unit-can-find-the-harness, PR: #1075)

Resolve the harness at install time and bake it into both units, following `__NODE__`, and refuse at `--start` when it cannot be resolved.

## Notes

**Reported by an operator who had already fixed it locally.** Their workaround lives in their own `.plot/worker-prompt.sh`, which `plot-install-prompt.sh` never overwrites — so their fleet works and every other adopting project hits the same wall.

**The units' comment is the tell.** It names three binaries and was written before the harness was a variable; `templates/worker-prompt.sh:136` made it one and nothing went back to the list. This is the shape `#1053` records for systemd unit names: a list maintained by hand beside a value that moved.


### Round 1, 2026-09-29

One juror, **amend**, **executed** — it verified all five hops of the launchd → harness chain, ran the existing test, and probed the unit's PATH directly.

**Two corrections, and both change what gets built:**

1. **The refusal shipped on 2026-09-06** (`85eaa80c`, `plot-worker-loop.sh:2008-2021`) with a passing test. An earlier draft called it *"the part that matters more"*, made it the first `Done when`, and told the implementer *"the refusal replaces it"* — which would have rebuilt a tested path.
2. **The macOS symptom is not `exit 127`.** The unit's PATH resolves `/opt/homebrew/bin/claude` at **2.1.231** against the shell's **2.1.282** — a supervisor-started worker here runs a 51-version-stale binary silently. The Linux unit has no Homebrew prefix at all and does hit 127. **Two symptoms, one mechanism.**

**So the fix changed shape:** from a PATH list to an install-time resolution baked in like `__NODE__` — which is what the issue asked for and what an earlier draft declined by reading `plot-board-probe.sh`'s precedent backwards.

**The chain survived every hop**, which is worth recording: no `sh -lc`, no `EnvironmentFile`, no profile read anywhere between launchd and the harness, and `run-script.ts:70` inherits rather than replaces the environment.