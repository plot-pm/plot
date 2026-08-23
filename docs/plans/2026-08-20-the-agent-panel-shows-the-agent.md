# The agent panel shows the agent

> The panel headed `Agent bug/the-scan-walks-history-in-one-call` reported
> `PID 58282`, `STATE running`, `CONTEXT 114k tokens` and an empty log. PID
> 58282 is `plot-dispatch.sh` — the dispatcher, not the agent. The real worker
> was pid 5501. Every number on the panel was read correctly from the wrong
> process, which is why nothing about it looked broken.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — six findings measured on the live board; PID 58282 was the dispatcher, the agent was 5501
- **Delivered:** 2026-08-22, jwloka, PRs #268, #276, #277, #279, #281, #285
- **Released:** 2026-08-22, v2.7.0
- **Started:** 2026-08-20, Jan Wloka, `bug/the-panel-names-the-working-process`
- **Started:** 2026-08-20, Jan Wloka, `bug/the-button-claims-only-what-it-knows`
- **Started:** 2026-08-20, Jan Wloka, `bug/the-overlay-keeps-its-place`
- **Started:** 2026-08-20, Jan Wloka, `bug/the-panel-facts-are-destinations`
- **Started:** 2026-08-20, Jan Wloka, `bug/the-log-is-live-and-its-path-is-copyable`
- **Started:** 2026-08-20, Jan Wloka, `bug/the-command-can-be-read-in-full`

## Problem

Four findings, all measured on the live board 2026-08-20 while four workers ran.

### 1. The PID is the dispatcher's, and the log is therefore always empty

`.plot-worker.pid` holds the pid of the `sh -c` wrapper that `plot-dispatch.sh`
backgrounds — and on this machine it held **58282**, which `ps` reports as
`plot-dispatch.sh --max 1 …`. The agent doing the work was **5501**,
`claude -p "You are implementing the branch …"`.

Measured across every live worktree, `.plot-worker.log` is **0 bytes in all
four**, while the agents have been running for minutes and one reports 114k
tokens of context. The redirect in `plot-dispatch.sh:765` is correct
(`>"$log" 2>&1`), so the output is not being lost on the way to the file — it is
that `claude -p` writes its transcript elsewhere and emits nothing on stdout
until it exits.

So the panel is **honest and useless**: *"The log is empty — the worker has
started and written nothing yet"* is true of the file and false about the agent.

The panel must show the process that is doing the work, and read the output that
process actually produces. Where `claude -p` genuinely writes nothing until
exit, the panel must say *that* rather than imply silence means idleness — the
same rule the fleet scan follows for a host it cannot reach.

### 2. `no change — see log` is wrong, and the path it offers expires

`StartWorkButton` watches `waveSummary.claimed` — the count of
`refs/plot/claims/*` on origin. Measured: **zero such refs exist**, because
dispatch books work by pushing a `plot/start-<slug>` branch carrying a
`Started:` record instead. The dispatcher log for the click showed
`dispatched=1 started=1` and a worker pid.

So the button reports *no change* about a dispatch that prepared a worktree,
pushed a booking and started an agent. Its own comment documents this failure
mode for `card.started` and fixes it by switching to `claimed` — the same bug,
one field along.

**And the recourse it offers expires.** The path is rendered in transient
component state: when the row moves, the pulse re-renders, or the reader
navigates, the only pointer to that log is gone. A message that says *see log*
and then destroys the reference is worse than no message, because it stops the
reader looking for a durable route.

### 3. The overlay scrolls the page behind it

`WorkerLogModal` sets `overflow-hidden` on its own panel and nothing on the
body, so a wheel event that reaches the backdrop scrolls the fleet list behind
the open panel. Closing it leaves the reader somewhere else than where they
opened it.

### 4. `COMMAND` is truncated with no way to see the rest

The panel renders the worker command on one clipped line ending `Read .p…`. The
full value is ~1,400 characters — the entire brief the agent was given, which is
the single most useful fact on the panel when an agent misbehaves, because it is
the specification it was handed.

Measured: the visible portion stops inside the word `.plot/briefs/`, so the
reader cannot even see which brief was named. There is no expand, no wrap, no
copy — the information is present in the DOM and unreachable in the UI.

### 5. The log path in the footer is inert, and the live view has nothing to be live about

The panel already polls: `LOG_POLL_MS = 3_000`, and its own comment records why
that belongs in the panel rather than the pulse — a log is fetched while someone
is looking at it and not at all otherwise. **The liveness is built.** What is
missing is anything to show, which is finding 1: the file it polls is the wrapper's
empty stdout rather than the agent's output.

Separately, the path along the panel's foot —
`/Users/jwloka/…/plot-wt-…/.plot-worker.log` — is plain text. It is the one
value on the panel that names something outside the browser, and it offers
neither navigation nor Copy.

A `file://` link cannot work: a browser refuses to navigate from
`http://localhost` to `file://`, which is presumably why it was printed as text.
So the footer gets **Copy path**, and the live rendering above it is what makes
the path rarely needed — the reason to leave the browser should be wanting the
log in an editor, not the panel failing to show it.

### 6. The facts are text where they could be destinations

`BRANCH`, `PLAN` and `WORKTREE` are rendered as plain strings. The board already
knows what each of them is: the plan has a card, the branch has a row, and the
worktree path is the one thing here that leaves the browser. A reader who opens
the panel to understand an agent then has to find each of those by hand.

## Design

### The panel reads the process it names

The pid recorded must be the agent's, not the wrapper's. `plot-worker-state.sh`
is already the ONE answer to "is a worker running in this worktree" and answers
eight states; this is a question about WHICH process, which it can carry.

Where the agent writes nothing until exit, the panel says so explicitly:
*"claude -p writes its transcript on exit — nothing to show until then"* is a
fact about the tool. *"The worker has written nothing yet"* is a guess about the
worker that happens to be false.

### The button claims only what it knows

It knows it dispatched and that the next pulse re-derives from git. It does not
know the agent started. So the transient message says the first
— *"Agent work will show up shortly"* — and nothing more, and the row moving to
WORKING is the confirmation.

A failure needs a home that outlives the click, and the `...` menu is that home:
pull rather than push, available for as long as the row exists, costing nothing
until opened. A **Status** entry there renders the dispatcher log the way
`WorkerLogModal` already renders the worker log, through the same
`/api/worker-log` shape.

**Not a `file://` link.** A browser will not navigate from `http://localhost` to
`file://`, which is presumably why the original printed bare text. The board
already serves file contents over HTTP — the log is rendered in the panel, and a
**Copy path** control covers wanting it in an editor.

### Linked, where a link has a destination

| Field | Becomes |
|---|---|
| `BRANCH` | scrolls to and highlights that row |
| `PLAN` | opens the plan card |
| `WORKTREE` | **Copy path** — it leaves the browser, so a link would lie |

The rule is the one this board already applies to a dead PR link: an affordance
that cannot navigate must not look like one.

### Open Points

- [ ] Does `claude -p` have a streaming mode the dispatcher could use, so the
      log fills as the agent works? If so the panel's whole premise improves;
      if not, the honest message stands and this is a limit rather than a bug.
- [ ] Should the panel poll `.plot-worker.exit` and show the exit code the
      moment it lands? It is the one fact that says the run finished.

## Branches

### Reads
- `bug/the-panel-names-the-working-process` — `.plot-worker.pid` records the agent's pid rather than the wrapper's, and the panel reads the output that process produces. Where the tool writes nothing until exit, the panel says that rather than implying the worker is idle. Tests: a running agent's pid is not the dispatcher's; an empty log under a live agent renders the tool's behaviour, not a claim about the worker; a finished run shows its exit code. → #268

### Says
- `bug/the-button-claims-only-what-it-knows` — the transient message becomes *"Agent work will show up shortly"*, and a `Status` entry in the `...` menu renders the dispatcher log durably. Tests: a successful dispatch shows no failure message; the row moves to WORKING on the next pulse; the Status entry is present whenever a dispatcher log exists; no log path is rendered as transient-only text. (#276)
- `bug/the-overlay-keeps-its-place` — the open panel locks background scroll and restores position on close. Tests: a wheel event over the backdrop does not move the list behind it; the scroll position after close equals the position before open. (#277)
- `bug/the-panel-facts-are-destinations` — `BRANCH` and `PLAN` navigate, `WORKTREE` offers Copy path. Tests: clicking BRANCH reveals that row; clicking PLAN opens its card; WORKTREE is not rendered as a link. (#281)
- `bug/the-log-is-live-and-its-path-is-copyable` — the footer path offers Copy, and the polling that already exists renders the agent's real output (see `the-panel-names-the-working-process`, which supplies it). Tests: the footer is not rendered as a link; Copy yields the exact path; an appended line appears within one poll interval without reopening the panel. (#279)
- `bug/the-command-can-be-read-in-full` — `COMMAND` expands to its full text and offers Copy. Tests: the collapsed form shows one line; expanding reveals the whole command including the brief path; Copy yields the exact string the worker was launched with, not the truncated render. → #285

## Notes

All six are one shape, and it is the shape this estate keeps producing: **the
UI states something it cannot back up.** The panel asserts a PID it read from
the wrong process, the button asserts *no change* about work that started, the
overlay asserts modality it does not enforce, and three fields assert
information without offering the thing they name.

The PID finding is the one worth remembering. Nothing on that panel looked
wrong — `PID 58282`, `STATE running`, `UPTIME 7m` are all correctly read and
correctly rendered. They are simply about `plot-dispatch.sh`. A panel can be
accurate in every field and still describe the wrong subject, and no amount of
per-field validation catches it.
