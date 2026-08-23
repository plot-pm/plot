# Brief — feature/a-broken-agent-needs-you

The **Surfaced** wave of `docs/plans/2026-08-20-every-section-has-one-subject.md`.
Wave 1 (`bug/an-agent-is-not-a-machine-you-wait-on`) merged as #300; read the plan
for the whole grammar before starting.

## The rule this wave implements

WAITING ON YOU is for what needs a **person's decision** — a PR, a branch, a plan,
a release, a build. **An agent appears there only when something is wrong with the
agent**, and its presence is then itself the signal.

| case | reader must |
|---|---|
| **crashed** | read the log, decide restart or abandon |
| **abandoned** | it stopped without finishing and without asking; decide |
| ~~compact context~~ | **out of scope — see below** |

## What exists and what does not

Measured against `WorkerStateSchema`'s eight values:

| case | state |
|---|---|
| abandoned | **`stalled`** — this is what it describes |
| crashed | **`failed`** / **`ended`** |
| compact context | **none — and not detectable** |

**`compact context` is NOT in this wave.** An agent with a full context still
reports `running`, because the condition is in the transcript, not the process.
The registry reads `contextTokens` for it and measured on the live board it arrives
**absent** — this repo's `Worker command` forwards no `--session-id`, so the
transcript join degrades. Do not try to infer it from uptime or token guesses;
that is the open point in the plan and it needs the forward fixed first.

## What to do

A `failed`, `ended` or `stalled` worker puts its row in WAITING ON YOU, with a
note that says which and where to look. Every other worker state keeps it out.

**The note must distinguish the two**: *stopped without finishing* is not
*crashed*, and the reader does different things. Follow the evidence-not-verdict
rule the neighbouring code already applies — say what was observed (an exit code,
a stalled marker), not what it means for the schedule.

**The row must carry where to look**: the log path and the worktree. A reader told
an agent crashed and not told where its log is has been informed, not helped.

## Out of scope

- **WORKING.** A `running` worker and a `waiting` one both stay there. A worker
  that stopped to ask **is working** — its question is the note, and moving it
  would say a person must decide when in fact an agent is mid-task.
- **`compact context`.** See above.
- **Making WORKING agent-centred** — that is wave 3
  (`feature/working-is-about-agents`). Do not start it.
- **The machine section.** #300 settled it: no worker state reaches it. Nothing
  here may put one back.
- **PR, branch or plan rows.** None moves.

## Tests the plan requires

- a `failed` worker appears in WAITING ON YOU
- a `stalled` one appears, and the note **distinguishes** *stopped without
  finishing* from *crashed*
- a **`running`** worker does **not**
- a **`waiting`** worker does **not** — it stopped to ask and is working, with its
  question as the note
- a `finished` one does not
- the row names the log path and the worktree
- no PR, branch or plan row moves
- **no worker state puts a row in WAITING ON A MACHINE** — #300's rule still holds

The last one is a regression guard on the wave before this: the two sections now
have disjoint agent rules and a test should keep them that way.

## While you work

`AgentList.tsx` is being rewritten in parallel by
`bug/one-component-renders-every-row` (~1200 lines deleted), and
`bug/a-section-is-not-a-row` is starting on its section headings. Your work is
mostly in `fleet.ts` — the grouping decision — which neither touches.

- **Push your first real commit as soon as it exists.**
- If you need to change `AgentList.tsx` at all, keep it as small as the note
  requires and rebase after the other two land.

Run the touched test files rather than the full suite.
