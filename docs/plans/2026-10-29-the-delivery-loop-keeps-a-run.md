# The delivery loop keeps a run log and reports stalls

> fleetd records one line per loop step, and a slice that stops moving notifies the person without stopping the loop.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2899
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd writes one line per delivery-loop step to a run log under `.plot/state/`, and sends one notification when a slice stalls. A notification never stops the loop.

<!-- Board impact: none for the plan format, template or docs/plans layout. The run log is a new file under `.plot/state/`; the board does not read it in this plan. How the board shows loop steps is left to a later plan (STORY, Open Points). -->

## Motivation

The story `the-fleet-delivers-a-scope-alone` removes the master agent from delivery. With no person watching, a slice that stops moving is silent: nothing records what the loop did, and nothing tells the person that a slice is stuck. The design (`DESIGN-delivery-loop.md`, section *Stalls*, approved by jwloka on 2026-10-29) requires a run log and a stall notification so that "never stops" does not become "loops silently".

Every later loop plan writes its steps to this log, so this plan has no dependency and comes first.

## Design

### Approach

The design spec binds this plan through its *Decided* and *Calls made* lists. This plan adds no new decision to them.

**Run log.** A file under `.plot/state/` holds one line per loop step with the fields slice, PR, head, step, outcome and time. Its exact file name and line format are left to the builder (spec, *Left to the builder*). A line is an answer fleetd bought or a step it took, so the file follows *A Decision Reads The Index*: a decision may read it, and a tool call writes it.

**Stall rule.** A domain rule in `packages/domain/src/rules/` takes the run log, the config bound and the current time as values, as the domain does for every readings-as-values rule. It answers one of two stalls:

1. A slice with no step for longer than a bound. The bound is a `## Plot Config` key.
2. A slice that spent both fixer attempts on the same finding (the spec's budget of two attempts per PR).

**Notification.** A stall sends one notification through the existing `Notifier` port (`ports/notifier`, already used by `registryd` for escalations). One stall sends one notification, not one per tick. A notification is not a stop: the rule changes no slice state and holds no queue.

**Layering.** Controller calls domain, domain owns the port, an adapter writes the file. The run log write is an adapter operation. No new `spawn` site and no new `plot-*.sh` line: `scripts/check-shell-lines.sh` and the spawn ratchet stay untouched.

### Open Questions

- [ ] Name and key for the bound (`Stall after`, in hours, beside `Claim stale after`?).
- [ ] Does "no step" count from the last run-log line of the slice, or from the PR's last push?
- [ ] How does the rule know "the same finding" before the attempts counter of a later plan exists? This plan may read the finding from the run log line's outcome and leave the attempts file to the fixer plan.
- [ ] Does a notified stall re-notify after the slice moves and stalls again? Proposal: yes, once per stall episode.

## Slices

### Run log

- `feature/the-delivery-loop-keeps-a-run-log` — a run log under `.plot/state/` with one line per loop step: slice, PR, head, step, outcome, time <!-- builds: the delivery-loop run log, a one-line-per-step file under .plot/state/ -->

### Stall rule

- `feature/the-delivery-loop-reports-stalls` — a stall rule over the run log and a config bound, and one notification per stall through the `Notifier` port <!-- builds: stall rule, a domain rule that names a slice with no step past a bound or two spent fixer attempts --> <!-- waits: feature/the-delivery-loop-keeps-a-run-log -->

## Notes

- Created from tracker issue #2899. Only the plan's `Issue:` field links to it; nothing was written to the tracker.
- Section named by the issue: *Stalls*.
