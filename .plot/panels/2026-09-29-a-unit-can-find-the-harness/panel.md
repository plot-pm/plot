# Panel — a unit can find the harness (#1068)

Subject: `docs/plans/2026-09-29-a-unit-can-find-the-harness.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |

**Two findings, and both change what gets built.**

## THE REFUSAL SHIPPED THREE WEEKS AGO

The plan called it *"the part that matters more"* and made it the first `Done when`. It is `plot-worker-loop.sh:2008-2021`, landed `85eaa80c` on **2026-09-06**:

- `PLOT-BLOCKED` written at `:2018`, naming the exit code, the attempt count and the repair
- an ending record, `reason: unstarted`, `actor: agent` (`:2016`)
- exit 1, so `plot-worker-state.sh` answers `failed`
- three attempts is `START_ATTEMPT_BUDGET` (`:359`) — the designed bound, not a symptom

**And the binary is named by bash itself** — `$harness` is the command word, so `claude: command not found` lands in `.plot-worker.log`, which the marker tells the operator to read.

`test/reconcile/second-slice.test.mjs:353-391` asserts all of it and passes.

The plan wrote *"three exits at 127 is the current behaviour and the refusal replaces it"* — which would have had an implementer rebuild a tested path.

## THE macOS SYMPTOM IS NOT `exit 127`

The plan asked whether the unit's PATH **contains** `~/.local/bin`. The question is whether it **resolves the name**. Verified by the moderator:

```
$ env -i PATH=/opt/homebrew/bin:… sh -c 'command -v claude'
/opt/homebrew/bin/claude

/opt/homebrew/bin/claude   2.1.231   <- the supervisor-started worker
~/.local/bin/claude        2.1.282   <- the operator's shell
```

**A supervisor-started worker here does not fail — it silently runs a 51-version-stale binary.** Quieter than the reported defect, and nothing detects it.

| unit | symptom |
|---|---|
| launchd | **version skew** — resolves a cask install |
| systemd | **hard 127** — no Homebrew prefix at all, and Linux installs to `~/.local/bin` |

**One mechanism, two exposures.** The plan asserted one gap and would have written one changeset sentence.

## THE PROBE PRECEDENT WAS READ BACKWARDS

The plan declined probing because `plot-board-probe.sh` *"answers a question with several right answers"*. `:288` is `cli_installed() { command -v "$1" …}` — it probes **because** a location has several right answers while a name has one. This machine is the proof.

`plot-fleetctl.sh:744` already bakes `__NODE__` from an install-time resolution. Same file, same shape, same reason — and it is what the issue asked for.

## THE TEMPLATE HALF REACHES NO EXISTING ADOPTER

`plot-install-prompt.sh` never overwrites (`:8-10`, `:67`; `--check` answers `current`). So a template change reaches only a fresh `/plot-init` — **including the reporter**, whose own file carries their workaround. The plan noted the file is never overwritten and drew the opposite conclusion.

## The chain survived every hop

Worth recording, because a broken hop would have moved everything: no `sh -lc`, no `EnvironmentFile`, no profile read between launchd and the harness, and `run-script.ts:70` inherits rather than replaces the environment.

## Amendments folded in

1. The refusal work deleted, with the shipped code and its test cited.
2. The two symptoms stated separately, with the measured versions.
3. The rule narrowed to an install-time resolution baked in like `__NODE__`.
4. A `--start` refusal added for an unresolvable harness.
5. The template half recorded as undeliverable to existing adopters.
