# The board watches the machine it runs on

## Status

- **Phase:** Delivered
- **Type:** feature
- **Sprint:** working-shows-the-agent
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-19, Jan Wloka, plan-PR #203 merged
- **Started:** 2026-08-19, Jan Wloka, `feature/the-worker-log-is-readable`
- **Delivered:** 2026-08-22, jwloka, PRs #239, #241, #244, #246, #270, #295
- **Released:**
- **Started:** 2026-08-19, Jan Wloka, `feature/a-waiting-agent-stays-working`
- **Started:** 2026-08-19, Jan Wloka, `feature/the-agent-panel`
- **Started:** 2026-08-19, Jan Wloka, `feature/continue-with-an-answer`
- **Started:** 2026-08-20, Jan Wloka, `feature/an-agent-outlives-its-branch`

## Approval

- **Assignee:** jwloka

## Problem

An agent stopped to ask a question, and the board sent it to WAITING ON
YOU with the note *worker finished — review it*. The row said:

```
Design  working-rows-show-their-…  feature/the-line-flashes-on-any-written-update
        worker finished — review it                                        7m
        unpushed work   2 commits only this machine can see
```

Three statements that cannot all be acted on. There was nothing to
review: no PR, no pushed branch, two local commits — and a log ending in
a direct question to the reader, with three options weighed and a request
to choose.

### The section boundary the incident exposed

**WAITING ON YOU is for results.** Branches, PRs, CI status, failures —
things a person inspects and decides about. Everything in it can be acted
on by looking at the git host.

**WORKING is for agents.** An agent that has stopped to ask something is
still an agent mid-run: its worktree is live, its context is intact, and
the thing that unblocks it is an answer rather than a review. Moving it to
WAITING ON YOU files it under the wrong verb, and it arrives there
carrying none of what that section is built to show.

### The measurement

`worker: finished` means one thing only: **the process exited 0.** Two
situations produce it and want opposite responses:

| Exit 0 because | The reader should |
|---|---|
| the work is done | review the PR |
| the agent asked and stopped | answer it |

The board cannot tell them apart, and the difference is in the log — which
the board never reads. This is the same absence-means-two-things defect
this repo has removed nine times; here it decides which SECTION a row
lands in.

### The same gap, one section along

The section boundary above holds for a second pair, and the two are one
rule rather than two defects.

**WAITING ON A MACHINE says *nothing — CI will finish*.** It describes a
STATE — nobody is blocked, a machine is working — and it is filled from
exactly one source: `pr.checks === 'pending'` on the git host. So a local
`vitest` run, a local build, a local scan is a machine working that the
board cannot show, while it sits in the very repository that run is
happening in.

| Machine is working | Board shows it |
|---|---|
| CI on the host | yes — once `mergeable` has been computed |
| a test run in this checkout | **no** |
| a build in a worktree | **no** |

Both sections are named correctly and filled too narrowly, and the shared
cause is one sentence: **the board reports what happens on the HOST, not
what happens on the machine it is running on.** `worker: running` was
sealed inside the `claimed` arm for the same shape of reason — a correct
rule with too small a scope.

This plan therefore covers both. The unit is not *the agent* and not *CI*;
it is **an observable process on this machine**, reported in whichever
section describes its state.

#### A branch is not a row

The unit above has a consequence the two sections do not yet state, and
one row per branch cannot express it. Measured 2026-08-18 while merging
`bug/one-worker-state-not-two`:

```
guard: working=0                  <- the agent had exited, cleanly
PR #218 OPEN, validate pending    <- a machine was working
```

Exit 0, branch pushed, PR open, CI still running. The row belonged to
**neither** section: not WORKING, because no agent held it; not WAITING ON
YOU, because the checks had not landed. And earlier the same afternoon the
inverse: an agent watching its own CI, which a one-row rule must file in
one section while both were true.

Both disappear once the row stops being the branch:

| Section | Lists | An entry is |
|---|---|---|
| WORKING | **agents** | *this agent is on `bug/x`* |
| WAITING ON A MACHINE | **processes** | *CI is running for `bug/x`* |

The same branch appearing in both is not duplication — the entities
differ. *Who is working?* is answered by an agent; *what am I waiting on?*
by a process. A branch is what rows mention, never what they are.

So an agent watching its own CI moves nowhere: it stays in WORKING because
it is an agent, and its CI appears in WAITING ON A MACHINE because it is a
running process. No section changes hands, and no field carries two
meanings. Each row names its branch, so two rows never read as one repeated.

#### An agent that holds nothing is still an agent

A WORKING row therefore ends when the **agent** ends — not when its work
does. An agent may have paused, may be waiting on an answer, or may be
free and ready for the next branch. Idleness is a property of an agent,
never a condition of its existence.

That last state is the one Plot cannot currently express, and the reason is
structural rather than missing detail: **Plot's agents are anchored to
branches.** A worker is started *for* a branch, holds *its* claim, and
everything recorded about it is written into that worktree —
`.plot-worker.pid`, `.plot-worker.log`, `.plot-worker.exit`
(`plot-dispatch.sh:717-722`). No worktree, no agent.

A free agent has no worktree in which its pid could live, so it is not
merely undisplayed — it does not exist as an entity. Showing capacity
requires an identity that outlives the work, which nothing writes today.

**So the dispatcher records one.** At launch it already knows the identity,
the command, the branch and the time; it writes them into the worktree
where only that branch can see them. A small manifest under `.plot/agents/`
— identity, command, started-at, session id, and the branch when it holds
one — makes the agent a thing the board can list, including with the branch
field empty. Everything in it is a fact the dispatcher has in hand.

#### The runtime already keeps half of it

Measured 2026-08-18. Claude Code writes a transcript per session at
`~/.claude/projects/<cwd-with-slashes-as-dashes>/<sessionId>.jsonl`, and
every assistant line in it carries what this plan wrote off as unrecorded:

| Field | Value observed |
|---|---|
| `model` | `claude-opus-5` |
| `usage.cache_read_input_tokens` | `156838` — context in use |
| `timestamp` | per line, so last activity is a read |
| `cwd`, `gitBranch`, `version`, `sessionId` | per line |

The path is derivable, and the session id is already on the worker's own
command line: `plot-dispatch.sh` launches through the configured `Worker
command`, and the runtime is invoked with `--session-id`.

That splits the registry rather than replacing it:

- **the manifest records the LINK** — which agent belongs to which branch,
  started when, under which session id. Nothing else knows this, because
  the runtime does not know Plot exists.
- **the transcript reports the STATE** — model, context, last activity.
  Live and self-updating, which a launch-time manifest could never be:
  context use changes with every reply.

It also reaches the state that motivated all of this. A session whose
`gitBranch` is the default and which holds no claim is an agent holding no
work — *waiting*, read rather than invented.

**Two limits, and the plan must respect both.** The format is private and
undocumented, and each line names the version that wrote it (`2.1.233`
when measured), so the board reads it defensively and omits fields it does
not recognise instead of guessing. And it is per-machine, exactly like
`.plot-worker.pid`: an agent on another host stays invisible, which this
wave does not solve and must not appear to.

This is the plan's largest wave and it is deliberately separable: the
sections split, the log, and `asking` are all reads of data that already
exists. The manifest is the one place a new fact is written — and it is
smaller than it first looked, because the runtime keeps the rest. Until it
lands, `waiting` stays honestly absent rather than faked from a worktree
that isn't there.

### What is already observable

| Fact | Where |
|---|---|
| pid | `worker_pid`, in the contract |
| exit code | `.plot-worker.exit` |
| **the log** | `<worktree>/.plot-worker.log` — deterministic path, never read |
| **model, context, last activity** | the session transcript — measured, see below |
| which agent holds which branch | **nowhere** |
| capabilities | **nowhere** |

The log is 3 KB of the agent's own account of its run, sitting on disk
next to data the board already reads. The dispatcher even prints its path
and its last line (`plot-dispatch.sh:168-170`) — into a log nobody reads
either.

> This table read *model, context, capabilities — nowhere* until
> 2026-08-18, when it was checked instead of assumed. Three of the four
> are written per assistant line in the session transcript; only
> capabilities, and the Plot-side link between agent and branch, are
> genuinely unrecorded. The corrected reading is in *The runtime already
> keeps half of it* above, and it makes the manifest wave smaller rather
> than larger.

### What is NOT observable, and must not be pretended

`claude -p` is a one-way process: **no stdin after launch.** So:

- **Answering an agent is starting a new one**, with the brief, the answer
  and what already landed as its prompt — never the previous transcript
  (see section 4, which this line was corrected against on 2026-08-19).
  That is *continuation*, not *dialogue*, and the UI must not blur them.
- **Capabilities cannot be shown**, because nothing records them — unlike
  model and context, which are one file read away.
- **What Plot knows about its own agents is Plot's to record.** The
  runtime keeps no notion of a branch claim or a plan, so the link between
  an agent and the work it holds exists only if the dispatcher writes it.

## Design

Four waves. The first three are reads of data that already exists; the
fourth is the one write, and it is deliberately last.

### 1. The log travels

The worker's log path is derived, not carried: `<worktree>/.plot-worker.log`,
and the board already knows the worktree. A row in WORKING can therefore
offer its log without a single new field crossing the wire.

Served on demand rather than pushed with every pulse — a 4 s pulse
carrying every agent's console output is a different product. The row
links; the panel fetches.

### 2. A stopped-to-ask agent stays in WORKING

This section proposed a fifth state, `asking`, detected from the **log's**
shape — the last output ending in a question. **That state is withdrawn**, and
what replaces it shipped on 2026-08-18 in PR #219 while this plan sat in
review.

`plot-worker-state.sh` now answers `waiting` for a worker that left a
`TODO(you)`/`TODO(human)` marker **in the tree**, and the reason it reads the
tree rather than the log is the argument this section was missing:

> The log records that a question *was asked*; the marker records that it is
> still *unanswered*, and only the marker clears when someone writes the
> answer.

Measured on the same day: a restarted worker found its own question already
answered in the commit above it and carried on without asking again. A
log-shaped detection would have shown it as still asking.

So two states for one situation, one of them reading the source that cannot
expire — the wrong one. **What survives from this section is its section rule,
not its state:** a `waiting` row keeps its place in WORKING with an
annotation, because it has not stopped being an agent. That rule is still
unbuilt and is what the branch below now carries.

### 3. The agent panel

What the board can honestly show about a run:

| Shown | Source |
|---|---|
| the log, live-tailed | the file |
| pid, uptime | the scan |
| the command that started it | `Worker command` config |
| branch, worktree, plan | the row |
| model, context in use, last activity | the session transcript |

The last row was measured, not assumed — see *The runtime already keeps
half of it* above. It is shown **only when the transcript is readable and
its fields are recognised**: a private format may change under the board,
and a panel that invents a model is worse than one that omits it.

**Omission is the whole failure mode, and it is accepted deliberately.** When
the format changes, those fields disappear with no explanation — the panel
simply shows less. That is the cheaper wrong answer: a stale model name read
from a field that moved would be believed, while an absent one prompts a look
at the transcript. The alternative, checking a `version` and reporting an
unrecognised one, buys an error message at the price of a second thing to keep
current, and the fields it guards are conveniences rather than facts anything
depends on.

Capabilities remain out of scope. Nothing records them, and unlike model
and context they are not one file read away.

### 4. Answering — a continuation, named as one

The one write. Given an answer, start a fresh worker in the same worktree.

**Its prompt is the brief plus the answer plus what already landed — not the
previous transcript.** A transcript from a worker that ran an hour can be
six-figure tokens, and handing it over fills the new worker's context before it
begins. The brief is the specification and has not changed; the answer is the
new fact; and what the previous run committed is already in git, which the
worker reads anyway and which cannot go stale the way a copied transcript can.

So the prompt says: here is your brief, here is the answer to your question,
and you have already committed X. That is smaller, current, and re-derivable —
the same reason plans reference tickets rather than mirroring them.

Named *Continue with an answer* rather than *Reply*, because the agent
that asked is gone: what continues is the work, not the conversation. A
UI that implies otherwise would promise a channel that does not exist.

## Branches

The waves are ordered so that **every one of them is useful alone**, and the
registry — the only wave that writes a new fact — is last.

The alternative was to build it first, since an agent identity that outlives a
branch would give the panel a key better than the worktree path. It is rejected
on delivery rather than on design: the three read-only waves each answer a
question an operator has today, and the registry answers one nobody can ask
until agents can be listed without work. Building the foundation first would
mean a longer wait before the first row improves, in exchange for less rework
in a wave whose shape the earlier ones are likely to change.



### Log

- `feature/the-worker-log-is-readable` — the board serves a worker's log → #239
  on demand from its deterministic path; a WORKING row offers it — PR #239

### Asking

- `feature/a-waiting-agent-stays-working` — a worker whose state is `waiting` → #241
  (PR #219, merged) keeps its place in WORKING with an annotation rather than
  moving to WAITING ON YOU. The state exists and is populated; what is missing
  is the board treating it as an agent rather than as a result. Tests: a
  `waiting` worker is in WORKING, not WAITING ON YOU; its row says what it
  waits on; a `finished` worker with a PR still goes to WAITING ON YOU — PR #241

### Panel

- `feature/the-agent-panel` — pid, uptime, command, branch and the live → #244
  log in one view, opened from the row — PR #244

### Answer

- `feature/continue-with-an-answer` — a continuation run in the same → #246
  worktree, prompted with the brief, the answer, and what already landed —
  never the previous run's transcript — PR #246

### Machine

- `feature/a-local-run-is-a-machine-working` — a process this board can → #270
  see running in its own checkout puts its row in WAITING ON A MACHINE,
  with the same evidence-not-verdict rule: *a test run is in progress
  here*, never *it will be done in three minutes*. The section is keyed on
  the process, not on the holder: a branch whose agent has exited while
  its checks still run is listed here rather than nowhere, and an agent
  watching its own CI is listed in both sections at once — once as an
  agent, once as a process — because the two sections list different
  things

### Registry

- `feature/an-agent-outlives-its-branch` — the dispatcher writes a → #295
  manifest under `.plot/agents/` at launch (identity, command, started-at,
  session id, and the branch while it holds one), and the board reads
  model, context and last activity from the session transcript that
  manifest points at. Together they make an agent something the board can
  list with no branch at all, which is what `waiting` requires. Defensive
  by construction: an unreadable or unrecognised transcript omits its
  fields rather than guessing them.

  > **NOT DELIVERED. PR #282 merged and carried only its claim commit.**
  > Verified 2026-08-20: `packages/board/src/server/registry.ts` exists in no
  > commit in this repository — not on main, not in the reflog, not as a dangling
  > object. `plot-dispatch.sh` writes no manifest and `FleetSchema` has no
  > `agents` field. `.plot/agents/` does not exist and `/api/board` carries no
  > `agents` key.
  >
  > The PR body describes the work in full and cites test counts
  > (`registry.test.ts (9)`, `dispatch.test.mjs 62/62`, `1392/1392`) for code that
  > was never committed. The worker pushed its claim, wrote the PR text, and
  > committed nothing else. The merge was approved on "green and conflict-free" —
  > green because the diff was empty.
  >
  > **The wave is re-opened below.** Nothing is recoverable; it is rebuilt from
  > this description, which is intact and was interrogated.

### What an agent IS — settled 2026-08-20

The operator's framing, and it raises the wave's stakes: **an agent survives a
wave and takes over another once done.** So an agent is not a property of a
branch — it is a process with a **model** and a **name**, the way Claude Code
itself presents one.

Everything the board knows about agents today is keyed on the **worktree**:
`.plot-worker.pid` lives inside it, and the transcript directory is derived from
its path. An agent that finishes branch A and picks up branch B changes worktree
and loses every identity the board holds. That is precisely why the manifest is
keyed on the session id and not on the branch.

**The identity already exists on disk and nothing reads it.** Measured
2026-08-20, for one worktree:

| | |
|---|---|
| session | `f30b27a3-1bdc-4392-afcb-5d46ad90513d` |
| transcript | **868 lines, 1,111 KB** |
| `.plot-worker.log` | **3,332 bytes** — and 0 bytes on another live worker |
| what the panel shows | `pid=22516`, for a process that exited hours earlier |

The transcript is 300× the log, the session id is both its filename and a
first-class `sessionId` field inside it, and subagents appear alongside as
`agent-<short>.jsonl` — so the identity is hierarchical too. Sessions accumulate
per worktree (measured 1 to 8), so "the agent" is the newest non-`agent-`
transcript, which is exactly the guess the manifest exists to eliminate.

**The three facts an agent row owes**, by this reading:

| | from | survives the branch |
|---|---|---|
| **name** — the session id, shortened for display | the manifest, minted at launch | yes |
| **model** | the transcript | yes |
| **pid** | `ps` | **no** — it is a fact about the process, not the agent |

The pid keeps its place as a live-process fact and stops being asked to identify
a run it has outlived.

### Subagents already carry a parent, measured

Claude shows the conversation of its in-session agents, and the files that back
that are already on disk: **492 `agent-*.jsonl` transcripts** across this repo's
worktrees, measured 2026-08-20. Each first line carries the relationship
explicitly — nothing is inferred:

| field | value in the one read |
|---|---|
| `agentId` | `a8a325d` — its own identity |
| `sessionId` | `b148d00d-…` — **the parent run that spawned it** |
| `isSidechain` | `true` — the runtime's own marker for "I am a subagent" |
| `gitBranch`, `cwd` | what it was working on |

So a registry entry keyed on `session` can find its subagents by filtering
`agent-*.jsonl` in the same directory on `sessionId`. The hierarchy is a **read**,
not a derivation.

`transcriptFile` deliberately skips `agent-` files when guessing the newest,
because a subagent's transcript answers about the wrong process — correct for the
guess, and it is also why the exact-id join matters: the parent is found by name,
the children by their parent's name.

**Not in this wave.** The wave lists agents the dispatcher launched; a subagent
was launched by an agent, and the dispatcher writes no manifest for it. Recorded
as the open point below, because the data exists and the question is only whether
a subagent earns a row or is detail behind its parent.

### An expert agent is a role, not a new mechanism

The operator asked how to have test, Jenkins and UI experts. Measured: **106 agent
definitions** already exist under `~/.claude/agents/` — `engineering-devops-automator`,
`design-ui-designer`, `testing-accessibility-auditor`,
`engineering-incident-response-commander` — each with a name, a description and a
declared stance.

And the runtime already supports continuing one run: `claude --resume <session-id>`,
with `--fork-session` to branch it. What it does not support is *joining* a live
session, and it should not — two processes writing one transcript is a conflict.

So what Plot lacks is **not an agent catalogue and not a spawning mechanism**. It
lacks a place to write down which role a branch wants. `Worker command` is already
per-repo configurable (Principle 5), so a role is one field:

| today | with roles |
|---|---|
| one `Worker command` for every branch | the command takes a role argument |
| the role is nowhere declared | `<!-- role: test -->` on the branch's plan line |
| an agent is an anonymous process | the manifest carries `role` beside `session` |

The manifest is where `role` belongs — it is launch-time knowledge exactly like
branch and command.

**`role` is where this starts, and it is knowingly not sufficient.** Settled
2026-08-20. Measured against the 106 definitions: only **5 declare a model** and
**12 declare tools** — the other 94 are stance alone, a name, a description and a
`vibe`. So a role name picks a *personality* and settles neither of the two things
a wave actually needs:

| what a wave needs | does `role` give it |
|---|---|
| **which stance** — how the agent approaches the work | yes, this is what a role is |
| **which model** — cost against capability | **no**, 5 of 106 say |
| **which tools** — what it may touch | **no**, 12 of 106 say |

A UI expert on Haiku and a UI expert on Opus are the same `role` and are not the
same agent. A test expert allowed to write under `packages/` is a different agent
from one that may only read. Both distinctions matter to a dispatch and neither is
in a role name.

Starting with `role` anyway, for a reason that is not laziness: **the manifest can
carry a field the dispatcher does not yet use, but it cannot carry one nobody has
named.** A role is the coarsest useful cut and the one the 106 definitions already
express, so it is what a plan line can declare today. Model and tools follow when
something reads them — and when they do, they belong beside `role` in the same
manifest rather than in a second mechanism.

What must NOT happen in the meantime is the failure mode this repo has a rule
against: a `role` field that is written, rendered, and changes nothing. If the
dispatcher does not forward it to the runtime, the manifest records a fact about
an intention rather than about a launch, and that is the one thing the manifest is
built to never do.

## Done when

- **A WORKING row can show its worker's log**, without the pulse carrying
  it. Assert the log arrives on demand and that a 4 s pulse is unchanged
  in size.
- **An agent that stopped to ask STAYS in WORKING.** Assert the measured
  case: exit 0, no PR, unpushed commits, and `plot-worker-state.sh` reporting
  `waiting`. The pairing that matters: a rule keyed only on the exit code puts
  it in WAITING ON YOU, which is where this plan starts. **The detection is no
  longer this plan's** — #219 built it, reading the tree rather than the log —
  so what is asserted here is the section, not the state.
- **A finished agent still goes to WAITING ON YOU.** Assert exit 0 with a
  pushed branch and an open PR — the state `asking` must not swallow the
  ordinary completion.
- **The annotation is EVIDENCE, never a verdict.** Assert it states what was
  observed — the marker exists and names the question — and does not claim the
  agent needs anything. Principle 3: the scan collects, the human concludes.
- **The panel shows only what is recorded.** Assert the model and context
  fields are populated from a real transcript, and that an unreadable or
  unrecognised one leaves them absent rather than guessed — both
  directions, because the format is private and may change.
- **A capability is never claimed.** Assert no field names one: nothing
  records them, and this wave does not change that.
- **Answering starts a NEW run and says so.** Assert the control is named
  as a continuation and that the previous pid is not reused.
- **The continuation prompt carries the brief, not the transcript.** Assert it
  contains the brief and the answer and names what already landed, and that it
  does not embed the previous run's transcript — a worker that ran an hour
  produces one large enough to fill the next one's context before it starts.
- **A row can be in WORKING and have unpushed work at once**, and say
  both — the marks already established are untouched.
- **A local run puts its row in WAITING ON A MACHINE.** Assert a process
  observable in this checkout, with no CI pending on the host — the case
  the section's own name already describes and cannot currently show.
- **It reports the observation, never a forecast.** Assert the row says
  what is running and does not name a remaining time: nothing measures
  when a local run ends, and a countdown nobody can honour is the shape
  this repo removes rather than adds.
- **A HOST-side pending check still lands there too.** Assert the
  existing path is unchanged — this widens the section, it does not
  replace what fills it.
- **A branch whose agent has exited while its checks still run is not
  homeless.** Assert the measured case: exit 0, branch pushed, PR open,
  checks pending, no worker alive — it is listed in WAITING ON A MACHINE.
  The pairing that matters: a rule keyed on the holder lists it nowhere,
  which is where this case was found.
- **An agent watching its own CI appears in BOTH sections.** Assert one
  live worker with a pending check yields an agent entry in WORKING and a
  process entry in WAITING ON A MACHINE, each naming the branch. A pending
  check must never evict a live agent from WORKING — the entities differ,
  and were only ever one row.
- **A WORKING entry ends with its AGENT, not with its work.** Assert a live
  worker whose branch has merged and whose checks have landed is still
  listed, and that it disappears when the process does.
- **An agent holding no branch is listed.** Assert an agent with no claim
  appears with an empty branch field rather than being omitted — the state
  the manifest exists for, and the one no worktree can express.
- **The manifest records only what the dispatcher has in hand.** Assert
  every field traces to launch-time knowledge (identity, command,
  started-at, session id, branch) and that none is inferred.
- **A missing or unreadable transcript costs fields, not entries.** Assert
  an agent whose transcript is absent or in an unrecognised format is still
  listed, with model and context absent rather than guessed.

### "No worker has written a log" is right, and incomplete

Measured 2026-08-20 for the two worktrees showing it: **no `.plot-worker.*` file
of any kind**, and **no claim ref on origin** for either branch. `plot-dispatch.sh`
redirects the log unconditionally at launch, so an absent log means `start_worker`
never ran — and an absent claim ref means no dispatch happened at all. Both
worktrees were made by hand.

The sentence is therefore accurate and carefully worded: it says *no worker has
written a log*, not *the log is missing*. What it withholds is the consequence —
that nothing is running and nothing will start on its own. A reader takes it as
"the log has not appeared yet".

Recorded here rather than fixed: it belongs with `bug/the-row-shows-what-it-withholds`,
which is the branch already open on exactly this question.

## Notes

`plot-dispatch.sh:168-170` already prints the log path and its last line.
The information has been one read away since the dispatcher shipped.
