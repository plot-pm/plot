# The delivery loop

**Story:** [the-fleet-delivers-a-scope-alone](STORY-the-fleet-delivers-a-scope-alone.md)
**Status:** approved by jwloka, 2026-10-29

## Intent

A person starts a sprint of approved plans and turns auto-dispatch on. The fleet then carries every plan in that set to Delivered, and prepares the release, with no input from a person and no help from a master agent. The one stop is the release: it is published only when a person approves it.

The reason is cost. On this estate the master agent is the mechanism today, not a fallback. In the session of 2026-10-16 to 2026-10-29 it answered 99 `PLOT-BLOCKED` questions by hand, ran every `plot-review` and every slice merge from a watcher script in its own job directory, and started a fix agent for every HIGH finding and every red PR whose desk was dead or out of corrections. When that session ends, delivery stops.

## Goals

1. **Only the release waits for a person.** Every other stop in an approved plan is handled by fleetd or by an agent fleetd starts.
2. **A HIGH finding is fixed before its PR merges.** A follow-up ticket exists only for a HIGH the fleet could not fix.
3. **Ticket statuses follow the work** without a hand edit: the plan's issue, the sprint item, and the HIGH follow-up tickets.
4. **Every decision is a domain rule that reads recorded state.** An agent does judgement work (a fix, an answer); it never decides what happens next.

## The scope

**The scope is the active sprint's plans, frozen when the sprint starts** (jwloka, 2026-10-29). A plan approved during the run is dispatched as today, but it does not join the scope: it waits for the next sprint's release. The release step fires when every plan in the sprint is Delivered. The sprint names the plans; nothing else defines the boundary.

## Non-goals

- Approving plans, writing plans, or choosing a sprint's scope. The scope is what a person approved.
- Publishing a release without a person's approval.
- Replacing the board. The board shows what the loop did; it is not the loop.

## Anti-goal

**Main goes red and stays red.** A run that delivers every plan but leaves the default branch red has failed. Every merge rule below is shaped by this.

## Constraints

- The layering rule in `CLAUDE.md`: controller → domain → port ← adapter. A loop step is a domain workflow; an agent start is an adapter call.
- *A Decision Reads The Index*: the loop rule selects its next step from the PR index and the default-branch reading. The merge itself still goes through `workflows/merge.ts`, which re-asks the host fresh and merges pinned to the head or refuses (`merge.ts:22`). The index chooses the candidate; the controller confirms it.
- The `plot/review` status is a required check on main (ruleset since 2026-10-15). No fleet merge bypasses the ruleset.
- The shell line ratchet (`scripts/check-shell-lines.sh`): new behaviour goes into TypeScript, not into `plot-*.sh`.
- The controllers stay the only way to act: merge through `workflows/merge.ts` pinned to a head, continue through the `continue` controller, restart through the `restart` controller. The unattended refusals on those controllers change only where this design says so.
- Shipped shell runs under bash 3.2. Agents never join lines to pass a gate and never edit a gate or the CI ratchet.

## What exists today

Measured 2026-10-29 by a read-only recon of `packages/fleet` and `packages/domain`:

| Step | Today |
|---|---|
| Dispatch an approved plan's eligible slices, write a missing brief | **automatic** (`auto-dispatch.ts:159`, `brief-ask.ts`) |
| A desk's red build becomes a correction, budget 2 | **automatic** (`worker-loop.ts:1862`) |
| A spent budget gets one fresh session | **automatic** (`rules/fresh-agent.ts`); a second failure asks a person |
| Deliver a plan whose slices all merged; tick the sprint; write the `delivered` issue label | **automatic** (`auto-deliver.ts:406`, `rules/sprint-tick.ts`) |
| Answer `PLOT-BLOCKED` | **manual**; fleetd only escalates (`escalations.tsv`) |
| Review a slice PR (`plot-review.mjs`) | **manual**; fleetd never calls it, and its `plot/review` status is required, so no slice PR merges without it. It opens one follow-up issue for any finding and comments on it per head (`review.ts:58-66`) |
| Merge a slice PR | **manual** (`plot-ask.mjs merge`); fleetd merges nothing |
| Repair a red main | **none**; `default-branch-red` only holds the queue |
| Restart a dead desk | **manual**; `restart` refuses an unattended caller |
| Close a findings issue | **none**; `plot-review` only comments on it |
| Close a sprint; merge the release PR; release sweep | **manual** |
| Named role agents | **none**; no `.claude/agents/`, no `claude --agent` |

## Approaches

**A — fleetd decides, role agents do the work.** Chosen by jwloka on 2026-10-29. fleetd's tick runs the loop below as domain rules. Where a step needs judgement it starts a named role agent declared in `.claude/agents/`. Every decision is testable and survives any session ending. It costs the most to build.

**B — a supervisor agent session replaces the master agent.** A long-running `claude --agent fleet-master` does what the master agent does today. Fast to build, but every decision lives in a model turn again: untestable, stopped by a context limit or a lost login, and paid for on every tick. Rejected for that reason.

**C — move the master agent's scripts into the repo as shell.** Rejected: it grows the shipped shell against the line ratchet and against *reduce shell, grow the domain*.

## The loop

fleetd evaluates each open slice PR of the scope on every pulse. One rule (`rules/slice-pr-next.ts`, new) reads the PR index row, the review record and the default-branch reading, and answers exactly one next step:

| Reading | Next step |
|---|---|
| CI red, desk alive with corrections left | none; the desk fixes it (today's behaviour) |
| CI red, desk dead or corrections spent | start **fixer** on the PR (attempt n of 2) |
| CI green, no review on this head | start **reviewer** on this head |
| Review on this head has a HIGH, desk alive | write the findings to the desk as a correction; no fixer starts |
| Review on this head has a HIGH, desk dead, fixer attempts left | start **fixer** with the findings |
| Review on this head has a HIGH, attempts spent | open the HIGH ticket; the reviewer then writes `plot/review=success` on this head naming the ticket; merge |
| Review on this head has no HIGH | merge, pinned to the head |
| Default branch red or stale | hold; see *A red main* |
| A merge is in flight and main has not settled since | hold |

**A HIGH that stays turns the check green only through a ticket** (jwloka, 2026-10-29). The ruleset keeps requiring `plot/review` and the fleet gets no bypass rights. `plot/review=success` on a head whose review found a HIGH is written only when that HIGH's ticket exists, and the status description names the ticket, so `plot-reconcile-scan.sh` and a reader can tell an accepted HIGH from a clean review.

**One writer per branch.** A fixer starts only on a PR whose desk has no live worker. While the desk lives, findings reach it as a correction through the existing correction mechanism, so two agents never push to one branch.

**One merge in flight.** After any merge into the default branch — the fleet's or a person's — the next fleet merge waits until the default branch's CI settles on the new head. The mark is derived from the default branch's head and its settled reading, not stored by fleetd. This is the main guard against the anti-goal: two PRs green on an old base can be red together. It costs throughput; a scope of ten slices with a 10-minute main CI adds at most about 100 minutes.

**The review record** is the `plot/review` commit status plus the findings the reviewer writes. The rule reads the status's head SHA, so a new push makes the old review irrelevant without deleting anything.

**Attempts are counted per PR**, not per head, in a state file under `.plot/state/` that the rule reads. Two fixer attempts on HIGH findings, matching the correction budget.

### After a merge

- The plan's issue gets a slice-progress line in Plot's existing comment (`tracker-plan-state.ts` already edits one marked comment in place): *"2 of 3 slices merged"*.
- When all slices merged, auto-deliver runs as today, and with it the `delivered` label and the sprint tick.

### A blocked agent

The **unblocker** role agent answers every `PLOT-BLOCKED` question through the `continue` controller. It reads the question, the desk's branch, its PR, the plan, the brief and the recent CI runs, and writes one answer. The escalation ladder stays, but as a record, not a wait: the question, the answer and who gave it go into the plan issue's Plot comment, so a person can read every answer later.

This reverses one line of the archived story [`the-supervisor-delivers-the-approved-scope`](../archived/the-supervisor-delivers-the-approved-scope/STORY-the-supervisor-delivers-the-approved-scope.md): *"The supervisor escalates a question; it never answers one."* The new rule: the fleet answers, and records the answer where a person looks.

A question the unblocker cannot answer from the estate gets the most reversible answer it can name (for example: "keep the current behaviour and say so in the PR body"), never no answer.

### A dead or stuck desk

When the fresh session from `rules/fresh-agent.ts` has also failed, fleetd starts a fixer on the slice instead of asking a person. A desk that is claimed but has no live worker and no PR is restarted through the `restart` controller; its unattended refusal is lifted for fleetd as the caller, and stays for every other unattended caller.

### A red main

When the default-branch reading turns red after a merge:

1. The queue holds (today's `default-branch-red`).
2. fleetd starts **main-repair** in its own worktree on the default branch, with the failing run and the merge that turned it red. It fixes forward through a PR, which goes through the same loop but jumps the queue.
3. If main is still red after a bound (proposed: 60 minutes, a config key), fleetd opens a revert PR of the merge that turned it red and merges it when its CI is green.
4. The reverted work comes back as a **new slice heading** on the same plan, with its own branch (`plot-host` reads the old PR as merged, and that answer is never overridden). If the plan was already Delivered, it stays Delivered and the revert gets a HIGH-style ticket naming the plan; no lifecycle step runs backwards.

### The release

When every plan in the scope is Delivered, fleetd:

1. finds the changesets release PR, approves its `action_required` CI run, and waits for green;
2. runs the reviewer on it so the `plot/review` status exists;
3. notifies the person: *"Release X.Y.Z is ready: N plans, PR #n, green, reviewed."*

**The person's approval is one action** — a board button or `plot-ask.mjs release-approve <pr>` (new). On that approval the fleet merges the release PR pinned to its head, waits for the publish workflow, records the release in every delivered plan of the scope (`/api/release` sweep), closes their issues (already done at `released` by `tracker-plan-state.ts`), and closes the sprint through `plot-sprint-state.sh`.

## Role agents

Each role is a subagent definition under `.claude/agents/<role>.md`, started as `claude -p --agent <role>` through the **existing** `agent-run` port and `agentRunCommand`, which already start the reviewer. There is one runner; the role name is what changes. The reviewer keeps its charter `.plot/charters/reviewer.json`. A definition carries what is now repeated in every brief by hand:

| Role | Model | Isolation | Writes | Hard rules carried in the definition |
|---|---|---|---|---|
| reviewer | opus | read-only | the review record | charter `.plot/charters/reviewer.json` as today |
| fixer | opus | `worktree` | commits on the PR's branch | never edit gates or the CI ratchet; never join lines; bash 3.2; never commit built bundles; never write "Fixes #N" |
| unblocker | sonnet | read-only | one answer through `continue` | answers from the estate; never answers "wait for a person" |
| main-repair | opus | `worktree` | a fix PR, or nothing | same as fixer; never pushes to main directly |

Hooks in each definition (`PreToolUse`, `Stop`) are the gates for these rules where a grep can tell; the rest stay instructions. `maxTurns` bounds each run. `memory: local` gives each role a memory of what worked under `.claude/agent-memory-local/`, which is git-ignored: no role commits anything that is not its slice's work.

**Unattended callers.** fleetd and the roles it starts call the `continue`, `restart` and `merge` controllers under `PLOT_UNATTENDED=1`. Each controller's unattended refusal is lifted only for a caller that declares itself as fleetd's (an explicit caller identity the controller reads, set by fleetd when it starts the role) and stays for every other unattended caller. `release` stays refused for every unattended caller: only the person's approval action reaches it.

**Plugin agents ignore `hooks` and `permissionMode`** (Claude Code docs), so the definitions live in the repo's `.claude/agents/`, not in the Plot plugin. An adopting project gets them through `/plot-init`.

## Tickets

| Ticket | Who writes it, when |
|---|---|
| The plan's issue | Approved, slice progress, Delivered, Released: `tracker-plan-state.ts`, extended with the progress line |
| A HIGH the fleet could not fix | Opened by fleetd before the merge: `ai-generated`, assigned to the plan's author, linked from the PR; the plan issue's comment names it |
| MEDIUM and LOW findings | **No ticket.** This removes today's behaviour, where `plot-review` opens a follow-up issue for any finding. They go into a comment on the PR. The 22 findings issues open on 2026-10-29 stay open (jwloka) |
| The sprint item | Ticked at delivery (today), sprint closed after the release |
| Jira, where it is the tracker | `plot-issue-status.sh` transitions at the same three points |

## Stalls

"Never stops" must not become "loops silently". fleetd records one line per loop step in a run log. A slice that takes no step for longer than a bound, or spends both fixer attempts on the same finding, notifies the person. **A notification is not a stop**: the loop keeps going, and the person may act or not.

## Decided

- Approach A (jwloka, 2026-10-29).
- Only the release waits for a person (jwloka).
- A HIGH is fixed first; a ticket only if the fix fails (jwloka).
- Ticket statuses update automatically (jwloka).
- The anti-goal is main going red (jwloka).
- The scope is the active sprint, frozen at its start (jwloka).
- An unfixed HIGH passes `plot/review` only through its ticket; no bypass rights (jwloka).
- The open findings issues stay open (jwloka).

## Calls made in this design (check these)

- One merge in flight, counting every merge into main, waiting for main to settle.
- The loop rule selects from the index; the merge controller re-asks the host before it merges.
- A live desk gets HIGH findings as a correction; a fixer starts only on a dead desk.
- A revert comes back as a new slice heading; a Delivered plan stays Delivered.
- Role memory is local and never committed; roles run through the existing `agent-run` port.
- Controllers lift their unattended refusal only for fleetd's declared caller identity; `release` never.
- Two fixer attempts per PR, matching the correction budget.
- After failed attempts the PR merges with the HIGH ticketed, because delivery must not stop.
- MEDIUM and LOW findings get no ticket.
- Red main: fix forward first, revert after 60 minutes.
- The unblocker always answers; every answer is recorded on the plan issue.
- fleetd may approve the release PR's `action_required` CI run and run the reviewer on it before asking the person.
- Role agents live in the repo's `.claude/agents/`, not in the plugin.

## Left to the builder

- The state file shapes for attempts, the merge-in-flight mark and the run log.
- The exact split of the work into plans and slices.
- How the board shows the loop's steps.
