# Delivery Tab Design

Status: approved by Jan Wloka, 2026-11-08, after a builder check. Decisions by Jan Wloka unless marked as the writer's call.

## Intent

The Delivery tab is where a developer escorts the fleet while it delivers a release. The ticket, story and plan cards share one grammar since one-card-grammar (`packages/domain/src/entities/card-facts.ts`). The Delivery tab does not, and developers who open it get more information than they can read.

Measured on the running board, 2026-11-08:

- One section list holds five row kinds: PLAN, SLICE, RELEASE, PR and AGENT. Each kind has its own columns.
- Section titles disagree with their rows. An agent row reads "waiting on you" under **Working**. Two idle desks reading "no manifest names this desk" sit under **Waiting on you**.
- Internals show as content: "4 manifests, 26 synthesized", "worker running (pid 99253)", "1 hidden by filter", and a three-line slicing sentence.
- A rate-limit banner from the tracker sits between rows of a work section.

The cause is structural. `GROUPS` in `packages/board/src/app/lib/agent-rows/sections.ts` sorts rows by "what it asks of you", while rows reach a section by the state of one branch or one process. Work and actors share one list.

## The Four Subjects

The board knows four subjects. Each gets one section.

| Section | Subject | The question it answers |
|---|---|---|
| **You** | the human | Which input does the fleet need from me, and what is the state of what I gave it? |
| **Work items** | the work in scope | Which items are held at a gate, in progress, or not started? |
| **Fleet** | the supervised agents | Which agents work, which are free, which are blocked, and on what? |
| **Machine** | what the fleet runs on | Can the machine and its services carry the fleet now? |

**Release delivery** replaces today's **Done** section (see below).

### Scope

The work items are the plans and slices of the **active sprints**. Where no sprint is active, the work items are every plan approved for delivery. The scope comes from the sprint, so the "hidden by Sprint only" counters leave the section headers.

## The Placement Rule

**Every work item and every agent shows once.** Every other section that refers to it shows a link to that place.

- **A work item shows in the section where a person must act on it first.** Where no person must act, it shows under **Work items**.
- **An agent shows under Fleet** and names the work item it acts on.
- **The link runs both ways.** A work item names the agent that acts on it ("fixer f3a1 retries CI"), and the agent row links to the work item. *Writer's call.*

Example, settled 2026-11-08: a sprint slice whose CI failed, while a fixer retries it. The slice shows under **Work items** as held at the CI gate. The fixer shows under **Fleet** as working on that slice. The slice reaches **You** only when the fleet cannot continue (see below).

## Who Is Me

Settled 2026-11-08:

- **You follows the board's Mine filter** (`mine-filter.ts`, its three modes). An item that needs another person shows under **Work items**, with that person in the BY column, so every item still shows once.
- **A person's tracker identity comes from the `People` config key**, extended per person, for example `jwloka = Jan Wloka <jira:jan.wloka@quatico.com>`. The handle is the GitHub login. The tracker port gains the reads it does not model today: the assignee, the GitHub milestone and the Jira fix version (`tracker-github.ts:158` names milestones as not modelled).

## Section Content

### You

A work item moves here when a person must act. Three groups say why it is mine (settled 2026-11-08): **Input to the fleet** (the fleet cannot start without me), **Review a result** (the fleet produced something I must check: a PR, a delivered plan to test, a release to approve), and **Unblock** (the fleet is stuck until I act). The rule names each case:

- a ticket assigned to me that has no plan;
- a plan of mine in Draft or Design: its rounds, its open questions, and whether an agent works on it now;
- an approval the lifecycle needs from a person (plan, spike, release);
- a `PLOT-BLOCKED` marker on a desk;
- a slice whose fixer budget is spent (`Correction budget`) or whose gate the fleet cannot pass alone;
- a merge conflict that no agent is assigned to.

Each row shows the action first: what to do, then which item.

The section header carries a **phase strip** for the developer's input (settled 2026-11-08): `Discovery n ─▶ Design n ─▶ Handed to fleet n`. Discovery counts my tickets and stories that no plan answers; Design counts my plans in Draft or Design; Handed to fleet counts my approved plans, which show under **Work items**. Each count links to its items. Rows carry no phase chip.

## Workflow Phases

The phases come from the `Workflow phases` config key. The tab shows them as two strips and never as a column (settled 2026-11-08): the section already implies the phase of most rows, so a column repeats it.

- The **You** strip, above.
- The **release strip** on the Release delivery line: `Design n ─▶ Development n ─▶ Testing n ─▶ Released n`, counting the plans in the release's scope. Each count links to its plans.

### Work items

Three groups, in this order (settled 2026-11-08):

1. **At a gate:** CI running or failed, review pending or carrying a HIGH, merge waiting for the default branch to turn green. The row names the gate and the agent that acts on it, if any.
2. **Being built:** an agent works on the slice and no gate holds it.
3. **Queued:** approved, and it cannot start yet or no agent has taken it. A slice that waits on an earlier slice names that slice.

A PR or branch that no plan names (a release PR, a sprint branch, a PR opened by hand) sits in the group of its state, with `PR` or `branch` as its KIND.

Delivered items leave this section for Release delivery.

### Tickets and loose ends

Settled 2026-11-08:

- **Input to the fleet lists every ticket assigned to me** that no plan answers. The **Sprint** filter button narrows it to the tickets planned for the sprint's target release.
- **A ticket is planned for a release** when the tracker says so: on GitHub, a milestone whose name is the release version; on Jira, a fix version whose name is the release version. The read goes through the tracker connector (CLAUDE.md, "The Layering Rule"), so both trackers answer one question.
- A ticket that a plan answers shows through that plan and never on its own.

- A ticket that work in this sprint opened carries the mark "opened by sprint". Nothing records that lineage today, so the board records it where sprint work opens a ticket (a review finding, a fixer, a person through the board).
- A PR or branch that no plan names and that nobody acts on shows under **You › Unblock** with its actions: release, delete, plan it. Release and delete run through controllers (CLAUDE.md, "The Master Agent Uses The Controllers"); a missing controller is part of the work.
- The release line counts the release's tickets: closed, planned, and untriaged.

### Fleet

One row per agent: loop agents and special agents (reviewer, fixer, approver, idea, brief and implement runs). Each row shows what the agent acts on (a link), its state (working, free, blocked, stopped) and for how long. A blocked agent names what blocks it ("blocked: CI failed on #3205").

The section header carries the counts: working, blocked, free. It also carries **every switch that decides what the fleet does by itself**, together (settled 2026-11-08): auto-dispatch, auto-review, auto-verify and auto-design, beside the parallel-agents control. Auto-dispatch leaves the *Not started* header, where it sits today. Where a switch is off, the group it holds back says so in its own header with a link to the action, for example `Queued (3) · auto-dispatch off · start ›`. *Writer's call.* A switch writes its config key through a controller, never by hand.

### Machine

One line while the machine is healthy: load, free capacity for agents, and the state of the service limits (GitHub REST and GraphQL, tracker). The line expands to rows when something holds the fleet back: high load, a spent rate limit, a stopped supervisor. Banners that sit between work rows today (the tracker's rate limit) move here.

### Release delivery

The section is scoped to the **target release**, not to one sprint. Where two sprints name the same `Release:`, it counts both.

- **Collapsed by default:** one progress line, for example "2.32.0: 12 of 18 slices delivered · 3 held at gates · 1 blocked". Each number links to the place where those items show.
- **Expanded:** a second header line names the sprints that feed the release and their state. Below it, two groups:
  - **Ready for testing**, grouped by plan (settled 2026-11-08). The plan's header line shows "n of m delivered" and its `Done when` list, because `Done when` belongs to the plan and not to a slice. A delivered slice shows only here, as a full row under its plan: the slice name, the PR and the merge date. A plan's slices that are not delivered show as link lines under its delivered ones, so a tester sees what can be tested now and what follows. A plan with every slice delivered starts collapsed; a plan with some slices delivered starts expanded. *Writer's call.*
  - **Still in flight:** every other slice in scope, as a link line (name, "→ held at gate", "→ waits on you", "→ in progress"). *Writer's call.*
- **`new` marks a slice whose plan joined a sprint after the sprint started.** *Writer's call.*

Placement in the tab: the collapsed line is the first line of the tab, above **You**. *Writer's call:* it answers "where does delivery stand" in one line before any detail.

## Columns

**You**, **Work items** and **Fleet** share one set of columns, in one order (settled 2026-11-08). A column holds the same kind of value in every section, and its cell holds a value, not a sentence.

| Column | Holds | Links to |
|---|---|---|
| **KIND** | ticket, plan, slice, PR, branch, release; for an agent its role: loop, fixer, reviewer, approver, idea, brief | — |
| **ITEM** | the thing itself | its home: the plan opened at the slice, the ticket, the PR, the agent's panel |
| **WHERE** | where the code lives; for an agent, the work item it acts on | the branch, then the PR once one exists; for an agent, the work item's row |
| **STATUS** | the state in a few words, gates as ✓ ⟳ ✗ with a run number; under **You** the reason it is mine | the evidence: the CI run, the review, the agent's question, the slice it waits on |
| **DO** | under **You** only: one verb with `›` | the action |
| **BY** | who acts: an agent, a fixer, a person, another session; for an agent, who started it | the actor's row under **Fleet**, or the person |
| **AGE** | time in this state | — |

### Links by Row

Settled 2026-11-08: an open slice links to its plan, a slice in progress to its plan and branch, and a stuck slice to its plan, branch and build or PR. The full table, the writer's extension of that rule:

| Row | ITEM | WHERE | STATUS | BY |
|---|---|---|---|---|
| slice, queued | plan § slice | — | the slice it waits on | — |
| slice, being built | plan § slice | branch | — | agent row |
| slice, at a gate | plan § slice | branch · PR | CI run or review | fixer or reviewer row |
| slice, stuck | plan § slice | branch · PR | failed build log, or the agent's question | agent row |
| PR with no plan | PR | branch | CI run or review | agent row, if any |
| ticket | ticket | — | the sprint item that opened it | — |
| plan, input | plan | plan PR | open questions, or the spike PR | person |
| plan, Testing | plan § Done when | — | merged PRs | person |
| release | release PR | release branch | review and CI | reviewer row |
| branch, loose end | branch on the host | compare with the default branch | last commit | — |
| agent | agent panel | the work item's row | its question or its log | fleetd or person |

## Groups

- **You:** *Input to the fleet* (with the phase strip), *Review a result*, *Unblock*. The group answers why the row is mine.
- **Work items:** *At a gate*, *Being built*, *Queued*. The group answers why the item is not delivered yet. A PR or branch that no plan names sits in the group of its state, with `PR` or `branch` as its KIND; there is no *Unplanned* group.
- **Fleet:** *Working*, *Blocked*, *Free*. The group answers what the agent does now. **An agent is blocked when it waits on any gate**: CI, review, the machine, a rate limit, or a person (settled 2026-11-08). Its STATUS names the gate, for example `CI ⟳ #3234` or `your answer`, and links to it. Free agents collapse into one line. The KIND column names special agents, so no separate list of them exists.

## Row Forms

Every row is a one-line form of the card grammar's five facets (`identity`, `lineage`, `progress`, `next`, `ownership`). Two forms exist:

- **Work item row:** what it is, how far it is, what is wrong, what to do next.
- **Agent row:** what it acts on, its state, for how long.

Internals (pids, manifest counts, synthesized rows, desk paths, raw branch names beyond the one link) move behind the row's details popover. Absence is not content: a row shows no chip for a fact nobody asked, as one-card-grammar settled for cards.

## Approaches

- **A. Re-sort the existing tab.** A domain rule places each row into one of the four sections, and the current row components stay with fewer columns. Cheapest; the tests mostly carry over. The row kinds keep different shapes, so the overload goes only half away.
- **B. The placement rule plus row forms from the card grammar.** The rule as in A, and every row is a one-line form of the shared `<Card>`. It replaces most of `rows.tsx` (2,959 lines), and the Delivery tab then speaks the language of the other tabs.
- **C. A new layout.** An inbox bar for **You**, a main column for work items, a sidebar for fleet and machine. Clearest at a glance, hardest at phone width, and it sits on top of A or B.

**Chosen: B, as two plans** (settled 2026-11-08); the confirmed extras add a third (see The Plans). C can follow if one column still reads as crowded once the noise is gone.

## Calls Made After Review

The writer settled these after the builder check; each follows from a settled point above.

- **With `Auto-review: true`, a slice PR is a gate, not a review for a person.** It sits under **Work items › At a gate**. **You › Review a result** holds what a person must check: a release to approve, a delivered plan to test, and a PR in a repository without auto-review. A HIGH finding moves to **You › Unblock** when the `Correction budget` is spent.
- **Release delivery is an overview, outside the placement rule.** A slice is delivered when its PR merged; a plan is in Testing when its phase is Delivered. The `test` row under **You** links into Ready for testing.
- **One release line per target release.** Where active sprints name different `Release:` values, each gets its line. With no release target, the release line is hidden.
- **A slice whose agent died** (today's *Quiet*) shows under **You › Unblock** with a restart action (`plot-restart-command.mjs`).
- **A red default branch, a rate limit and a stopped supervisor** show under **Machine**. The agents they hold show as blocked by them, and the slices as held at that gate.

## The Plans

*Writer's call after review: the confirmed extras add a third plan.*

1. **Placement.** A domain rule decides the section of every work item and every agent, and the links between them, from readings as values (CLAUDE.md, "The Layering Rule"). The tab renders the five sections (Release delivery, You, Work items, Fleet, Machine) with today's row components. This plan alone fixes the rows that sit in the wrong section.
2. **Row forms.** The one-line work-item and agent forms over `CardFacts`, the columns and links above, the details popover for internals, and the removal of the row code they replace.
3. **Tickets and loose ends.** The `People` identity extension, the tracker reads (assignee, milestone, fix version) into the issue index, the "opened by sprint" lineage, the ticket counts on the release line, and the release and delete controllers for loose ends.

## Goals

- A developer answers the four questions within five seconds of opening the tab.
- Every work item and every agent shows once.
- Every rendered state is a domain property with a unit test (CLAUDE.md, "Every rendered state is a domain property").

## Non-goals

- No change to how the fleet schedules, reviews, fixes or merges.
- No new data sources outside plan 3. Plans 1 and 2 read what the board reads today: the pulse, the PR index, `issues.json`, the agent registry and the machine readings. Plan 3 adds the ticket's assignee and release to the issue index (never a second read) and records the "opened by sprint" lineage.
- No change to the Tickets, Stories and Plans tabs.

## Anti-goals

- A section that hides an item without saying so. A count of hidden items stays where a filter hides something; the sprint scope is not such a filter.
- A row that is in two sections at once.
- A decision made in a `.tsx` file.

## Constraints

- The layering rule: the domain decides, the board renders.
- `GROUP_ORDER` in `fleet.ts` and `GROUPS` in `sections.ts` must agree today; the new rule replaces both with one order.
- Phone width: no horizontal scroll at 320 px.
- Browser tests prove only what is seen; behaviour is asserted in unit tests.

## Left to the Builder

- The names of the domain rule and its types, within the domain package's terminology (Slice, Agent, Worker).
- The order of groups inside **You**.
- How a link scrolls to and highlights its target.
- Which existing browser tests move to unit tests.
