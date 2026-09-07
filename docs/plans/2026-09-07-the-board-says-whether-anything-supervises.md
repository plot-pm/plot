# The board says whether anything supervises

> The board renders agents and never says whether a supervisor is watching them. Six workers ran 23–25 hours past an 8-hour bound with the supervisor down, all six spent, and the board showed six healthy rows.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #765 merged
- **Started:** 2026-09-07, Jan Wloka, `feature/the-board-says-whether-anything-supervises`
- **Delivered:** 2026-09-07

## Changelog

- The board reports whether a supervisor is running, so an unsupervised fleet is visible rather than indistinguishable from a supervised one.

<!-- Board impact: this IS the board impact. It adds one server-side reading
     and one rendered state; no plan-format or helper-script change. -->

## Motivation

**Measured 2026-09-07.** `plot-fleetctl.sh --status` reported `supervisor=down` with **six workers running**. Every one was spent: PR merged, tree clean, `PLOT-BLOCKED.md` written, and the process still burning — two of them **over 25 hours**, against a `Worker bound` of 28800 s (8 h).

**The board showed none of that.** `/api/board` has no supervisor field: `grep -rln supervisor packages/board/src` names six files, **all under `server/`**, and zero under `app/` or `contract/`. So the board rendered six agent rows that looked exactly like six healthy ones.

**THE SUPERVISOR IS WHAT MAKES A SPENT DESK RECOVERABLE.** `plot-registryd` reaps a finished desk, marks a spent one with `PLOT-BLOCKED`, and frees the agent. With it down, every one of those things stops happening and **nothing on the board changes**. The fleet degrades into a set of processes nobody is collecting, and the only way to learn it is to run a shell command in a terminal.

**IT WAS DOWN BECAUSE `--start` REFUSED, AND THE REFUSAL SAID "0".** The fill verifier ran `grep -c '__[A-Z_]*__' … || echo 0`; `grep -c` prints its count **and exits 1** on no match, so `left` became `"0\n0"`, never equal to `"0"`. Every `--start` deleted a correctly filled unit and refused with *"0 placeholder(s) survived the fill"* — the message stating success and the branch treating it as failure. Fixed in `5d935226`.

**That bug is fixed and this plan is not about it.** It is about the six hours between the supervisor dying and a person noticing, during which the board — the thing a person actually looks at — reported nothing wrong.

## What this is not

**Not a control.** `/plot-fleet --start` and `--stop` own the supervisor's lifecycle, and `DESIGN-process.md` §1 makes the board and fleet control independent systems that share a machine. This plan **reads**; it adds no button that starts a daemon.

**Not a health check on the supervisor's decisions.** Whether a tick decided well is `--once`'s question. This answers only *is anything supervising these agents*.

**Not a second status rule.** `plot-fleetctl.sh --status` already answers it and exits 0/1. The board should ask that, not re-derive it — one rule, two readers.

**Not agent-row state.** An agent's own state (`running`, `finished`, `stalled`) is already rendered and is correct. The missing fact is about the FLEET, not any row in it, so it does not belong on a row.

## Slices

### The board reads the supervisor (Branch: feature/the-board-says-whether-anything-supervises, PR: #770)

`/api/board` carries a supervisor reading, and the board renders it where a person watching agents will see it.

**THE READING COMES FROM THE ONE RULE.** `plot-fleetctl.sh --status` exits 0 when the supervisor is loaded and 1 when it is not; the board asks that rather than checking a pidfile or a process name. A second implementation would drift, and it would drift toward *looks fine* — the direction that cannot be noticed.

**IT IS A DOMAIN PROPERTY, NOT A COMPONENT'S JUDGEMENT.** Per the layering rule, *"every rendered state is a domain property"*: the reading is `up` / `down` / `unknown`, and which of the three a fleet is in is decided in the domain and asserted in a unit test. **`unknown` is first-class** — a board that cannot ask must not render *down*, because that is an alarm nobody can act on, and it must not render *up*, because that is the failure this plan exists to remove.

**THE PROMINENCE FOLLOWS THE CONSEQUENCE.** `down` with **zero** agents is a quiet fact — nothing is being neglected. `down` with **one or more** agents running is the measured failure and reads as a warning, because every one of those agents is now unreapable. The count is already on the board; the rule combines them.

**IT COSTS ONE READING PER PULSE AND NO HOST CALL.** The status is a launchctl/systemctl query against the local machine — no network, no rate limit, no `gh`. It is an adapter, not a connector.

**Done when** the board reports whether a supervisor is running, `unknown` renders as neither up nor down, a `down` reading with live agents is visibly a warning while `down` with none is not, the reading comes from `plot-fleetctl.sh --status` rather than a second rule, and the state is asserted in a unit test without a browser.

## Notes

### Why this was not caught by the fleet's own tooling — 2026-09-07

`--status` reported it correctly, immediately, and in plain words. **Nobody ran it for six hours**, because the board was open and the board looked fine.

That is the whole argument. A fact available on demand in a terminal is not the same fact as one visible on the surface a person already watches — and the gap between them is exactly as long as the interval between somebody deciding to check.

### The six, for the record — 2026-09-07

| branch | ran | PR | desk |
|---|---|---|---|
| `bug/the-repair-knows-every-bundle` | 23 h | #738 merged | clean, `PLOT-BLOCKED` |
| `bug/a-sprint-names-a-shipped-release` | 25 h | #743 merged | clean, `PLOT-BLOCKED` |
| `bug/the-default-branch-repairs-itself` | 23 h | #748 merged | clean, `PLOT-BLOCKED` |
| `feature/one-monitor-watches-the-slice` | 25 h | #741 merged | clean, `PLOT-BLOCKED` |
| `docs/a-spec-says-how-to-count` | 25 h | #742 merged | clean, `PLOT-BLOCKED` |
| `feature/a-plan-names-its-deliverable` | 23 h | #744 merged | **live prompt, left running** |

**Five were idling in `sleep 60`** waiting for an assignment no supervisor would ever hand them. The sixth had picked up new work 31 minutes earlier and was left alone — which is the distinction a supervisor makes every tick and a person had to make by reading `pgrep -P` output six times.
