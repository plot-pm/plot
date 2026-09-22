# A loaded label is not a running daemon

> `plot-fleetctl.sh --status` reports `supervisor: running` while no supervisor process exists, so a fleet that has stopped handing over work looks healthy and an operator watches an empty board.

> **AMENDED AFTER PANEL, 2026-09-22. The defect is real and reproduced; three facts in the evidence were wrong and are corrected below.** The reading lens verified the symptom and refuted the mechanism. Most seriously, **the label that was measured was a LEAKED TEST UNIT** — `com.plot-pm.registryd.test-start-interrupted-25315`, pointing at a temp repo, `runs = 43`, alongside **103 leaked test directories**. It had taken the production label, so this repository's own supervisor could never load. That is a separate defect and is recorded in the Notes. The symptom this plan fixes stands; its evidence did not describe production.

## Status

- **State:** Delivered
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-22, jwloka, in-session
- **Rounds:** 2
- **Started:** 2026-09-22, jwloka, `bug/the-status-asks-the-process-table`
- **Delivered:** 2026-09-22

## Changelog

- `--status` reports whether the supervisor PROCESS is alive rather than whether its launchd label is loaded. A dead daemon under a loaded label read as running, so dispatched slices sat in the queue and an operator was told the fleet was healthy twice while it handed over nothing.

Board impact: none directly; the board reads the registry, not this command. What changes is what an operator is told when the fleet stops working.

## Design

### Measured twice in ninety minutes

2026-09-22, both occasions on this estate:

| | first | second |
|---|---|---|
| `--status` said | `supervisor: running` | `supervisor: running` |
| `ps` for `registryd.mjs` | **nothing** | **nothing** |
| last tick in its log | **previous day, 15:52** | **09:15, 88 minutes earlier** |
| `launchctl list` | label loaded, status `-` | label loaded, status `-` |

**The first repair was `--stop`, rotate a 131 MB log, `--start`.** That worked and suggested the log size was the cause. **The second occurrence refutes it: the log was 8 KB.** So the daemon dies for some other reason, roughly hourly, and the log was a coincidence.

### The reading, and why it is wrong

`--status` asks launchd whether the label is loaded. **A loaded label and a running process are different facts**, and launchd reports the label even when the process it names has exited — `launchctl list`'s **first** column is the pid, and it read `-` on both occasions, which is launchd saying *no pid*. (The columns are `pid | last-exit | label`; an earlier draft of this plan called the `-` the third column and that was wrong.)

**`KeepAlive: true` DOES restart it**, and the first draft of this plan said the opposite. Measured by the panel: `runs` counted 38 → 39 → 40 in roughly forty seconds. So the deaths were a **throttled crash loop** — launchd restarting a daemon that kept exiting — and not launchd declining to act. That makes the status defect worse rather than better: a label whose daemon is crash-looping reports `running` at every moment between restarts, which is most of them.

**The consequence is the worst kind of wrong answer.** A status command exists to be believed when something is broken, and this one is confidently wrong in exactly that case. An operator who runs it sees `running`, looks elsewhere, and the queue stays unserved.

### What the reading should be

**Ask `supervisor_pid`**, which already exists in `plot-fleetctl.sh`, is already called in the arm being changed, and is **scoped to the label**. The panel refused `ps | grep` for two reasons worth keeping: a sibling agent's command line can flip it, and it silently regresses the systemd arm, where `is-active` already answers correctly.

**The `plot-boardctl.sh` precedent is withdrawn.** Read correctly, its `--status` reports three facts and reconciles none — the two-facts-must-agree rule is `--stop`'s. What it actually argues for is **reporting both readings on separate lines** rather than folding them into one verdict, which is the shape this slice should take.

**Three answers, not two:**

| label | process | answer |
|---|---|---|
| loaded | alive | `running` |
| loaded | **absent** | **`loaded, not running`** — and say `--stop` then `--start` repairs it |
| not loaded | — | `not loaded` |

**The middle row is the whole plan.** It is reachable, it is what an operator hits, and today it is indistinguishable from the first.

### What must not break

**Exit codes keep their meaning.** `--status` exits 0 when the supervisor is loaded and 1 when it is not, and a caller gates on that. A dead process under a loaded label must **exit 1**, because the question a caller asks is *can I rely on it*, and the answer there is no.

**`--status` starts nothing.** That is the rule it already holds — *"a status that started what it was asked about could never report an absence"* — and the repair belongs in the message rather than in the command.

**The tick age is evidence, not the verdict.** A log's mtime says when it last wrote, and a busy daemon between ticks has not written for up to 60 s. Report the age; do not derive liveness from it.

### `install=` must move with it

`fleet_install_state` returns `running` for any loaded label, and `supervisorState` maps what it is handed.

**Decided: `install=` gains the third value.** Accepting `install=running` beside `exit 1` would put the same contradiction one field deeper — a caller reading `install=running` while the command exits 1 has to know which to believe, which is the defect this plan exists to remove. `supervisorState` gains the matching arm in the same slice, so the board does not render the new state as plain `down`.

## Slices

### The status asks the process table (Branch: bug/the-status-asks-the-process-table, PR: #960)

- `bug/the-status-asks-the-process-table` — `--status` reads the label AND asks `supervisor_pid` (not `ps | grep`, which a sibling's command line can flip and which regresses the systemd arm), reports both readings on separate lines, answers `loaded, not running` with the two-command repair, exits 1 there, and prints the last tick's age as evidence rather than as the verdict. `install=` gains the third value and `supervisorState` gains the matching arm, both in this slice. **All three rows are tested on CI**, through the seam `fleetctl.test.mjs:392-398` already uses: `fleet_install_state` is driven with `platform` and `supervisor_loaded` stubbed, *"which is what makes the launchd arm reachable on CI's `ubuntu-latest`"*. An earlier draft scoped the promise away on the premise that the arm was unexercisable there; the panel measured that false and the seam is the reason

## Notes

- **Why the daemon dies has its own plan and is already fixed**: `2026-09-22-a-failed-tick-must-not-end-the-daemon.md`, merged the same day. The supervisor's loop had no `catch`. This plan reports the symptom; that one removed a cause. The Notes' earlier claim that the cause *"needs its own measurement"* is stale — the measurement happened in the branch next to it.
- **A LEAKED TEST UNIT HELD THE PRODUCTION LABEL, and that is a separate defect worth its own plan.** Measured 2026-09-22: `com.plot-pm.registryd` was bound to a plist under `/private/var/folders/.../plot-fleetctl-start-interrupted-tk8DCK/`, with **103 such directories** on this machine. launchd keys by label, so the repository's own supervisor could not load while a test's sandbox held it — the fourth refusal `plot-fleetctl.sh` already names, reached from a direction nobody expected. The leaked unit was booted out by hand; `fleetctl.test.mjs` should not be able to leave one behind.
- The first occurrence is recorded in `2026-09-22-a-free-agent-is-not-a-finished-one.md`, whose own investigation it derailed.
