# An unanswered question escalates while it waits

> A desk whose agent asked a question is listed in WAITING ON YOU with the question and its age, and the supervisor tells a person again as the question gets older, until somebody answers it.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #1283, #1250
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-05, jwloka, in-session

## Changelog

- A slice whose agent wrote a `PLOT-BLOCKED.md` question is listed in WAITING ON YOU with its branch, the question's first line and how long it has waited, whether the agent's loop is still alive, went free, or ended.
- The fleet supervisor notifies a person when an unanswered question passes each age in `Question escalation` (default `15m, 1h, 4h`), once per age, through the command in `Notify command`. A repository that declares no `Notify command` gets the board listing only.

<!-- Board impact: the board's placement of a desk that holds a PLOT-BLOCKED marker changes from WORKING (or "worker crashed") to WAITING ON YOU. The fleet payload gains the question's age. No change to the plan format, the template or the docs/plans layout. Two new Plot Config keys, `Question escalation` and `Notify command`. -->

## Motivation

On 2026-10-05 the agent on slice 2 of `the-worker-loop-runs-in-js` wrote a `PLOT-BLOCKED.md` question at 13:36. Nobody answered it until 18:20, and the delivery of the plan stopped for that time with auto-dispatch on. The question was visible in one place only: the agent row under WORKING read "waiting on you · idle 4h".

Measured the same day, nothing in the estate could have escalated it:

- **The supervisor never read it.** `registryd.log` counted `person=0` on all 10,521 ticks. `supervise` (`rules/supervision.ts:269`) answers `leave` for any agent whose loop process is alive, before it reads anything else, and a loop that went free after the question stays alive. A marker without a `blocked` declaration gives `correct`, never `needs-a-person` (`supervision.ts:277`, `gates.ts:185`).
- **No code reads a question's age.** The marker readings (`supervisor.ts:369`, `registryd-main.ts:813`) return names only.
- **No notification mechanism exists.** There is no notify port, no adapter and no Plot Config key for one.
- **The board files a question as work.** `fleet.ts:5166-5172` places a `waiting` worker under WORKING. A loop that ended on its wait bound reads "worker crashed — exited 124" (#1250).

`the-worker-loop-runs-in-js` makes every JS-loop ending that waits for a person write a `blocked` declaration, so `supervise` answers `needs-a-person` for it. That answers who must act, but not how long it has waited or who was told. It also takes effect only when the JS loop runs. This plan escalates from the marker on the desk, which exists whichever loop wrote it.

## Design

### Approach

**The marker is the reading, not the loop.** A desk that holds `PLOT-BLOCKED.md` at its root holds an unanswered question. The question's age is the marker file's modification time. The rules below read the desk and the marker, and never the loop's process state, so a live free loop, a dead loop and an ended loop give the same answer. When the JS loop's `blocked` declaration exists, it is a second reading of the same fact and changes no answer here.

**One domain rule decides the rung.** `questionEscalation(readings)` in `packages/domain/src/rules/question-escalation.ts` takes the marker's presence and age, the configured ages, and the rungs already recorded for this marker. It returns the highest rung the age has reached and whether that rung is new:

| Rung | Reached at | What happens |
|---|---|---|
| `listed` | age 0 | The board lists the desk in WAITING ON YOU. |
| `notified-1`, `notified-2`, ... | each age in `Question escalation` | One notification per age, worded with the branch, the question's first line and the age. |

A rung is reported as new only once per marker. A new marker (a new modification time) starts again at `listed`. The rule is pure and synchronous, and its tests need no clock and no file.

**The board reads the same rule.** The fleet payload carries `question: { firstLine, askedAt } | null` per desk row, from the marker. The placement rule sends every row with a question to WAITING ON YOU, before the worker-state arms in `fleet.ts:5160-5316`. So `running`, `waiting`, `failed` and `finished` with a marker all read "waiting on you: <first line>, asked <age> ago", and the exit code of an ended loop stays as evidence on the row. The decision is a domain property, and a unit test asserts it without a browser. One browser test proves the row renders in WAITING ON YOU.

**The supervisor tick calls the rule for every desk, not every agent.** The registry tick (`entry/registryd.ts`) already reads the manifests and the unclaimed trees. After `supervise`, it calls `questionEscalation` for each desk with a marker, whatever `supervise` answered for that agent. A `leave` for a live loop therefore no longer hides the desk's question. A new notification becomes a `notify` write on the tick's decision.

**Notification is a port with a configured command.** A `Notifier` port in `packages/domain/src/ports/notifier.ts` has one operation, `notify(message)`. Its adapter runs the project's `Notify command` (a Plot Config key, like `Worker command`) with the message in an environment variable, never interpolated into shell source. A repository that declares no `Notify command` gets `notifierNone`, which answers `unaskable`. Then the rung is recorded as not delivered, and the board listing is the only escalation. A failed command is recorded with its exit code and is retried at the next rung, not on every tick.

**The tick records which rungs it reached.** The registry tick is stateless today ("no journal, no lock file", `registryd.ts:176-189`). Escalation needs one record, because a notification sent twice is the failure this rule exists to prevent. Each reached rung is appended as one line to `.plot/state/escalations.tsv` in the main checkout: desk path, marker modification time, rung, the time, and `sent`, `unaskable` or `failed <code>`. The tick reads the lines for the desks it sees. The file is append-only and machine-local, and a missing or unreadable file reads as "no rung reached", which can notify once more but never stays silent.

**`Question escalation` sets the ages.** A Plot Config key with a comma-separated list of durations, default `15m, 1h, 4h`. An empty value disables notification and keeps the board listing.

**What this plan does not do.** It does not release a slice whose question stays unanswered, and it does not answer a question. Releasing a claim has no controller yet (#1276), and an answer is a person's. Both are open questions below.

**Tests.**
- `questionEscalation`: no marker gives no rung; age 0 gives `listed`; each configured age gives its rung once; a recorded rung is not new again; a new modification time starts again; an empty `Question escalation` gives `listed` only.
- The placement rule: a row with a question goes to WAITING ON YOU for each worker state (`running`, `waiting`, `failed`, `finished`), and keeps the exit code on a `failed` row.
- The tick: a live free loop with a marker produces a `notify` write at the first age; the same tick input with the rung recorded produces none; `notifierNone` records `unaskable`.
- The adapter: the message reaches the command through the environment, and a message holding shell metacharacters runs nothing.

### Open Questions

- [ ] Should the last rung release the slice so other work can proceed? It needs a controller that releases a claim (#1276), and it decides what happens to the agent's unlanded work.
- [ ] Should the master agent session be a notification target of its own, or is `Notify command` enough (a desktop notification, a Slack webhook, a push service)?

## Slices

### A question is listed as waiting on you

- `feature/a-question-is-listed-as-waiting-on-you` — the desk's marker and its age as a reading, the `question` field in the fleet payload, and the placement rule that sends a desk with a question to WAITING ON YOU for every worker state <!-- builds: the question reading and the WAITING ON YOU placement -->

### A question notifies as it ages

- `feature/a-question-notifies-as-it-ages` — `questionEscalation`, the `Notifier` port and its command adapter, the `Question escalation` and `Notify command` keys, the `notify` write from the registry tick, and `.plot/state/escalations.tsv` <!-- builds: questionEscalation, the Notifier port -->

## Notes

- 2026-10-05, direction from jwloka: "This would have been a supervisors job to escalate the longer the blocked question is not answered." The escalation reads the desk's marker and needs no shell change, so it does not wait for `the-worker-loop-runs-in-js` to move the loop out of the shell. Type feature, reviewed in-session, own branches.
- #1250's shell half (the loop keeping the slice instead of going free) is left to `the-worker-loop-runs-in-js`, which already makes a waiting ending write a `blocked` declaration. This plan answers its board half: an ended loop with a marker reads as waiting, not crashed.
