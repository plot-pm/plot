# The command is readable

> Two findings from reading the agent panel #285 shipped. The COMMAND field
> expands — that half works — but collapsed it clips one line mid-path, and
> expanded it runs fifteen unbroken lines that squeeze the log to a strip and
> break words mid-syllable: `.plot/brief` / `s/${PLOT_BRANCH…`, `im` /
> `mediately`, `5` / `03`.
>
> And the panel names the agent by **pid**, which is meaningless once the process
> exits — while a real, stable identity already exists on disk and nobody reads
> it.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — the defect was measured from a screenshot after the first reading of it was wrong; scope narrowed to the sizing branch
- **Started:** 2026-08-20, Jan Wloka, `bug/the-command-has-a-size`

## Problem

### Collapsed clips where the reader is looking

`commandFirstLine` (`AgentPanelFacts.tsx:21`) collapses whitespace to one line and
the cell truncates it. Measured on the live panel, the clip lands inside
`Read .plot/brief…` — **before the brief's path**, which is the first thing a
reader opening this panel wants.

One line is the panel's default and right for a pid or a model name. This value is
~1,400 characters.

### Expanded has the opposite failure

`whitespace-pre-wrap break-all` renders the whole string with no bound. Measured:
**fifteen lines**, and `break-all` splits at the character rather than the word,
so the text arrives hyphen-less mid-word. Below it the log pane is compressed to a
single strip — the panel's other half is pushed out by the half that expanded.

Both states are the same mistake in opposite directions: **the field has no
size**. It is either one line or all of them.

### The agent has an identity and the panel shows a pid

`AgentPanel` carries `pid`, and a pid is only meaningful while the process lives.
Measured 2026-08-20: the panel showed `pid=22516` for a worker that had exited
hours earlier — a number that identifies nothing and cannot be looked up.

A stable identity exists. Claude writes a session transcript per worktree at
`~/.claude/projects/<slugified-worktree-path>/<session-id>.jsonl`, and the
session id is both the filename and a first-class `sessionId` field inside. For
the branch measured:

| | |
|---|---|
| session | `f30b27a3-1bdc-4392-afcb-5d46ad90513d` |
| transcript | **868 lines, 1,111 KB** |
| `.plot-worker.log` | **3,332 bytes** |

The transcript is 300× the log, and the panel points at neither — it points at a
dead pid. Subagents appear alongside as `agent-<short>.jsonl`, so the identity is
hierarchical where the run spawned helpers.

**Sessions accumulate per worktree** — measured 1 to 8 per branch — so "the
agent" is the *newest non-`agent-` transcript*, not the only one. A worktree that
never ran a worker has none, which is the honest absence the panel should show
rather than a pid of nothing.

## Design

### The command gets a size: three lines, then scroll

| State | Today | Becomes |
|---|---|---|
| collapsed | 1 line, clipped mid-path | **3 lines**, wrapped at word boundaries |
| expanded | all 15 lines, unbounded | **scrollable**, bounded so the log keeps its pane |

Three rather than one because three reaches past `Read .plot/briefs/…` to the
first full instruction, which is where a reader stops needing more. Three rather
than five because the log below is the other half of this panel and a fact that
takes half the frame is not a fact any more.

**`break-words`, not `break-all`.** `break-all` exists for strings with no spaces;
this command has spaces throughout, and breaking at characters inside them makes
readable text unreadable. The one genuinely unbreakable token —
`.plot/briefs/${PLOT_BRANCH##*/}.md` — is short enough to wrap whole.

**Copy still yields the original string**, unchanged and untouched by this: the
wave that shipped it made that its contract, and a bounded render is exactly the
case where the copied bytes must not follow the rendering.

### The panel names the session, and keeps the pid

Not either/or. They answer different questions:

| Field | Answers | Lives as long as |
|---|---|---|
| `pid` | *which process, right now* — for `kill`, for `ps` | the process |
| `session` | *which run was this* — for the transcript | forever |

So the panel shows both, and the **session is the one that reads as the name**.
The pid keeps its place as a live-process fact and stops being asked to identify a
run it has outlived.

**The session id links to its transcript** the way the worktree path is copyable:
a `file://` link the browser will not follow, so it is a **copy** affordance, not
a link — the rule `CopyFact` already applies to the worktree path.

**Where no session exists, the panel says so.** A worktree with no transcript is
one no worker ever ran in, which is a real state — two such branches were measured
today — and the `an-outage-is-not-an-answer` rule makes it a stated absence rather
than a blank.

### What must not change

- **No new host calls, and no new spawns.** The session id is a directory listing
  on the local filesystem; the panel already reads the worktree path it derives
  from.
- **The transcript is not parsed.** This wave names and locates it. Rendering its
  contents is a much larger question — the log pane exists and shows
  `.plot-worker.log`; whether it should show the transcript instead is recorded
  below, not decided here.
- **Copy semantics.** Copy yields originals, never renders.

### Open Points

- [ ] Should the log pane read the **transcript** rather than `.plot-worker.log`?
      Measured 1,111 KB against 3,332 bytes, and the log is often 0 bytes while
      the agent is demonstrably working. It is the more useful source and a much
      bigger change — a jsonl event stream is not a log file.
- [ ] Does a subagent (`agent-<short>.jsonl`) deserve its own row, or is it detail
      behind the parent session?

## Branches

Only the sizing branch. **The identity half moved** to the Registry wave of
`2026-08-17-working-shows-the-agent.md`, which is approved and was re-opened on
2026-08-20 after PR #282 turned out to have merged only its claim commit. That
wave already keys an agent on its session id *because* the id survives the branch
— which is the operator's requirement, not a second design.

### Sized
- `bug/the-command-has-a-size` (PR #294) — three wrapped lines collapsed, scrollable when expanded, words broken at word boundaries. Tests: collapsed renders three lines and includes the brief's path; expanded is bounded and scrolls rather than growing; the log pane keeps its height in both states; `break-all` is gone and a long space-separated command wraps at spaces; **Copy still yields the original string in both states**; an empty command renders nothing.

## What moved, and why

`feature/the-panel-names-the-session` is not listed here. The Registry wave writes
`.plot/agents/<session>.json` at launch and joins each manifest to its transcript
**by exact session id**, which is strictly better than this plan's proposal of
"the newest non-`agent-` transcript in the worktree's directory" — that is a
guess, and the manifest exists to remove it.

The measurements above stay, because that wave needs them: the 868-line transcript
against a 3,332-byte log, the pid shown for a process gone for hours, the 1-to-8
sessions per worktree that make "newest" a guess.

## Notes

Reported by the operator reading the panel: *"the command is abreviated, show 3
lines and allow to expand and scroll"*, then *"can you show the agent's name /
id"*, then — on being told expansion was broken — *"Show more expands already"*.

**That correction is worth recording.** The first reading of this defect claimed
expansion did not work at all, inferred from `CommandFact`'s code rather than from
the panel. It does work; the defect is that neither state has a size. A screenshot
settled in one second what reading the source got wrong — the same lesson as the
scan-timeout finding earlier today, where a plausible reading of a comment
described something the measurement contradicted.

The identity finding answers an open point in `a-row-is-a-tuple`: *"Do agents get
a stable `@Dev-Agent` identity, or is the name derived from the branch it holds?"*
**Neither.** They have a real identity already, written to disk on every run, and
nothing reads it.
