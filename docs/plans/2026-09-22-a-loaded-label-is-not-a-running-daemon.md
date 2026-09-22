# A loaded label is not a running daemon

> `plot-fleetctl.sh --status` reports `supervisor: running` while no supervisor process exists, so a fleet that has stopped handing over work looks healthy and an operator watches an empty board.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

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

`--status` asks launchd whether the label is loaded. **A loaded label and a running process are different facts**, and launchd reports the label even when the process it names has exited — the third column of `launchctl list` was `-` on both occasions, which is launchd saying *no pid*.

`KeepAlive: true` is set in the unit and did not restart it, which is its own finding: the daemon exits in a way launchd treats as final, with an empty `registryd.err` and exit status 0.

**The consequence is the worst kind of wrong answer.** A status command exists to be believed when something is broken, and this one is confidently wrong in exactly that case. An operator who runs it sees `running`, looks elsewhere, and the queue stays unserved.

### What the reading should be

**Ask the process table**, which is what every other liveness question in this estate does:

```sh
ps ax -o command= | grep -c '[r]egistryd.mjs'
```

`plot-boardctl.sh` already holds the pattern for this exact problem on the board side: it requires **two facts to agree** — the recorded pid and the port's listener — and names every disagreement rather than guessing. The supervisor has no port, so the pair is the label and the process.

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

## Slices

### The status asks the process table (Branch: bug/the-status-asks-the-process-table)

- `bug/the-status-asks-the-process-table` — `--status` reads the label AND the process, reports `loaded, not running` as its own answer with the two-command repair, exits 1 there, and prints the last tick's age as supporting evidence. Tests pin all three rows and that the command still starts nothing

## Notes

- **Why the daemon dies is NOT in this plan and is the more important question.** Two occurrences, roughly hourly, empty `registryd.err`, exit status 0, `KeepAlive: true` not restarting it. That needs its own measurement — a daemon exiting cleanly under KeepAlive is launchd saying it *asked* to stop. This plan makes the failure visible; it does not stop it.
- The first occurrence is recorded in `2026-09-22-a-free-agent-is-not-a-finished-one.md`, whose own investigation it derailed.
