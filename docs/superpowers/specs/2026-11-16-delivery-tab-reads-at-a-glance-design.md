# Delivery Tab Reads at a Glance

Status: approved by Jan Wloka, 2026-11-16, after a builder check. Decisions by Jan Wloka unless marked as the writer's call.

Builds on [2026-11-08-delivery-tab-design.md](2026-11-08-delivery-tab-design.md) (the placement rule, the columns, the row forms), whose three plans are delivered. That design decided *where* each item shows. This design decides *how* each section reads. Where the two disagree, this one wins, and the disagreements are named under "Changes to the 2026-11-08 design".

## Intent

Developers open the Delivery tab and do not understand what they see, nor where to look for a given fact. The tab shows helpful information in an unhelpful way. Measured on the running board, 2026-11-16 (screenshot `screencapture-localhost-7777-2026-11-16-15_24_27.png`):

- One reason sentence repeats on every row: "a ticket is assigned to you and no plan names it" about 30 times, "a draft plan needs your input" under every slice of a draft plan.
- 30 ticket rows in **You** push the two draft plans that need the developer out of view.
- **Release delivery** lists every merged slice of every plan in Testing, about 40 rows where nothing needs anyone.
- Internals show as content: "5 subjects not placed" with absolute desk paths, "no manifest names this desk" on agents, "PR data 485s ago", and a Machine section reading "none — nothing — a machine is working".
- One column holds "complete", "merged", "waiting on approval" and "2 complete", and no column carries a header.
- Text is abbreviated where the row has room for it (`feature/jenkins-…-queue`, "ends Fri").

## The Four Questions

Within five seconds of opening the tab, a developer answers:

1. What is the status of the release, or of my sprint?
2. Am I the blocker, and for what?
3. How is the fleet doing?
4. Where do I act? (the sections below)

## Page Structure

From top to bottom:

1. **Tab header**: filters, a to-do list, the release or sprint card, the fleet card.
2. **Release delivery** (or **Sprint delivery**, see the toggle).
3. **You**.
4. **Work items**.
5. **Fleet**.
6. **Machine**.
7. **Tickets**.
8. **Footer**.

*The order of sections 2–8 follows today's tab; the writer keeps it.*

### Every section has one shape

- **Section header:** the section's name, its icon, and one line of counts. Each count links to its group in the body. The header summarizes and lists no items.
- **Section body:** only the rows to act on, grouped, under column headers.
- **A group with no rows does not show.** The header's count of 0 says it is empty.

## The "My sprint" Toggle

The existing **This sprint** filter button is renamed **My sprint** (Jan Wloka) and switches the tab between two scopes:

| | Off: the release | On: my sprint |
|---|---|---|
| Means | every team member's sprints together | my fleet's progress |
| Status card | **Release <version>** | **Sprint <name>** |
| Delivery section | **Release delivery · <version>** | **Sprint delivery · <name>** |
| You | everything that waits on me | what waits on me in this sprint |

- **The button is disabled when no sprint is active**, and its tooltip says so.
- The **Tickets** line and the **Fleet** card do not change with the toggle. A ticket with no plan belongs to no sprint, and the fleet is one fleet. *Writer's call.*

## Tab Header

Layout, left to right:

- **To-do list ("You block N things").** One line per thing the developer blocks, verb first (Interrogate, Review, Approve, Release or delete), most urgent on top, each line marked **blocks delivery** or **input** (see You). Every item name is a link. Below the list, one line: "30 tickets assigned to you have no plan · triage". The line stays, and **triage** links to the **Tickets** section.
- **Status card**, switched by the toggle:
  - **Release <version>:** a progress bar in four segments (delivered, at gates, blocked, not started) with counts, the number of people whose sprints form the release, and the release's state. **The [Approve release] button sits on this card.** The release has no row elsewhere on the tab, so the card is its one place. The to-do list carries "Approve release <version>" as a blocks-delivery line that links to the card.
  - **Sprint <name>:** days left as a date ("ends Friday, 20 November"), the release it targets, a progress bar, and progress per MoSCoW tier (Must 5/5 · Should 2/3 · Could 0/2).
- **Fleet card:** idle, working or blocked, with counts (free, working, blocked) and the fleet switches shown **read-only**, linking down to the Fleet section header.

## Release Delivery

The overview of delivery progress, and the **one place a plan's full slice list lives**. It stays outside the placement rule, as the 2026-11-08 design settled.

- **Header:** "<delivered> of <total> slices delivered · <n> at gates · <n> blocked · <n> plans in Testing · <n> in Development".
- **Progress per person** (release scope only): one small card per team member with their sprint and its slice progress bar. *Writer's call*, from "any progress information is also helpful".
- **One row per plan:** Plan · Phase · Slices · Owner.
  - **Slices** shows a **slice strip**: one block per slice, coloured by state (delivered, at a gate, building, not started), and "1 / 5 delivered".
  - The row is collapsed (▸) by default. Opened (▾), it lists every slice in order under three headings:
    - **Done:** ✓ merged, the slice, its PR, and when it merged ("merged 2 days ago").
    - **In flight:** ⟳ at CI, ● building and so on. The slice links to **its row** in Work items, or in You where it needs a person. The row is not repeated here.
    - **To do:** ○ waits, and what it waits for ("after Reads").
- **A slice that has not started** (no branch, no agent) shows **only** in its plan's opened list. It is not a row under Work items.

## You

What waits on the developer. Every row is the developer's, so the section has no BY column.

- **Header:** "<n> block delivery · <n> inputs the fleet waits for · <n> tickets to triage", then the phase strip `Discovery n ─▶ Design n ─▶ Handed to fleet n` from the 2026-11-08 design.
- **Three groups, in this order:**
  1. **Blocks delivery** (red marker): work already in flight stops until the developer acts. Any kind of item: an approval (plan, spike), a PR to review, a slice whose fixer budget is spent, a `PLOT-BLOCKED` question, a conflict that no agent owns.
  2. **Input to the fleet** (blue marker): the fleet cannot start this work without the developer. Any kind of item: a plan in Draft or Design, a PR that needs a decision, a ticket.
  3. **Unblock:** loose ends, each with **Release** and **Delete**. A loose branch, and a closed PR whose branch still exists.
- **Columns:** Kind · Item · Status · Do · Age.
  - **Status** holds the item's state ("Draft · not interrogated", "loose · no plan, nobody works on it"). The reason it is the developer's is the group, not a sentence on the row.
  - **Do** holds the verb with `›`. Unblock rows hold "Release · Delete".
- **A plan row is one row.** It carries a chip with its slice count, a chip with its open-question count, and the first open question with a "+n more" link. Its slices do not show as rows here.
- **Tickets do not show as rows in You.** They are counted in the header and the to-do line, and listed in the **Tickets** section.

## Work Items

Items in flight that do not need the developer.

- **Header:** "<n> at a gate · <n> being built · <n> queued · oldest waits <age>".
- **Groups:** At a gate · Being built · Queued.
- **Columns:** Kind · Item · Where · (group column) · By · Age.

  | Group | Group column | Example |
  |---|---|---|
  | At a gate | **Gates**, as ✓ ⟳ ✗, each linked to its run or review | `CI ✗ validate · review –` |
  | Being built | **Progress** | `4 commits · no PR yet` |
  | Queued | **Waits on** | `no agent assigned`, or the earlier slice |

- **Item** is the plan § slice, linked. **Where** is the PR, with the branch beneath it. **By** is the agent's role chip and name, linked to its Fleet row; a fixer adds its attempt ("1/2").
- **A closed PR or branch no plan names moves to You › Unblock**, not Queued.

## Fleet

One row per agent, agent-centric.

- **Header:** "<n> working · <n> blocked · <n> free · <tokens> tokens today", and on the same line, right-aligned, **the fleet switches**: dispatch · review · verify · design, and the parallel-agents stepper. The switches live here and nowhere else; the tab-header Fleet card shows them read-only.
- **Groups:** Working · Blocked · Free. Free agents collapse into one line ("Free · 3 agents ready: … · show").
- **Columns:** Agent · Role · Acting on · Doing now (Blocked: **Waits on**) · Tokens · Time left.
  - **Role** is a coloured chip: loop, reviewer, fixer, approver, idea, brief, design, verify. A special agent is an ordinary row with its role; no separate list of special agents exists.
  - **Acting on** links to the work item's row (plan § slice, or PR), with its branch beneath.
  - **Doing now** says what the agent does ("writing code · 4 commits", "reviewing head 2d929a6", "fixing CI ✗ validate · attempt 1 of 2"), with the last commit message for a loop agent.
  - **Waits on** names the gate and links to it: `CI ⟳` with its run, review, your answer, a rate limit.
  - **Tokens:** what the agent spent on its current run.
  - **Time left:** time before the agent's bound (`Worker bound` for a loop agent, the fixer's bound for a fixer), with a bar that drains. The bar turns red below 20 % left. *Writer's call: the 20 % threshold.*

## Machine

- **Healthy:** one header line, no body: "● healthy · load 2.1 of 10 cores · GitHub 4,210 / 5,000 left · CI queue 1".
- **Strained:** the dot turns amber or red, and the body lists only the resources that limit the fleet, each with its effect (Resource · Now · Effect), for example "GitHub GraphQL · 0 / 5,000, resets 16:42 · PR reads use REST".
- The text "none — nothing — a machine is working" is removed.

*Writer's call: the whole Machine section, offered and not corrected.*

## Tickets

The target of every **triage** link.

- **Header:** "<n> assigned to you with no plan · <n> more unassigned · show all".
- **Columns:** Kind · Ticket · Do · Age. **Do** is **Plan it ›**.
- The first rows show, then "… n more · show".

*Writer's call: offered and not corrected.*

## Footer

One line for freshness and diagnostics:

- how old the board read is, and how old the PR data is with the time of the next read ("PR data 8 min old · next read in 2 min"), each with a coloured dot;
- the branch and plan counts;
- "<n> desks not placed · details". The list of desk paths moves behind **details**.

*Writer's call: offered and not corrected.*

## Rules for the Whole Tab

- **Every item name is a link**: plans, slices, branches, PRs, tickets, agents, releases, sprints. The targets are the 2026-11-08 design's "Links by Row" table.
- **Every item carries its icon** from the board's one glyph table, `packages/board/src/app/lib/glyphs.ts` (Octicons): ticket, story, plan, slice (`wave`), branch, PR, build, release, sprint, agent. No new icons.
- **Text is never abbreviated while the row has room for it.** A branch name, a date and a duration are written in full ("feature/jenkins-reads-in-process-queue", "ends Friday, 20 November", "merged 2 days ago"). Where a column is too narrow, the text is cut at its end with an ellipsis and the full text shows as a tooltip; it is never cut in the middle.
- **Columns carry headers**, and one column holds one kind of value.
- **Collapsibles exist in three places only:** a plan row in Release delivery, the Free agents line, and "… n more" lines. Groups and sections are always open.
- **Every count, marker, strip segment and summary is a domain property** with a unit test (CLAUDE.md, "Every rendered state is a domain property").

## Changes to the 2026-11-08 Design

- **You's groups** were *Input to the fleet*, *Review a result*, *Unblock*. They are now **Blocks delivery**, **Input to the fleet**, **Unblock**. *Review a result* folds into **Blocks delivery**; Unblock now holds loose ends only, and a slice whose agent died or whose budget is spent moves to **Blocks delivery**.
- **The release row** under Work items › At a gate goes away. The release lives on the tab-header status card with its Approve button.
- **Tickets** were rows under You › Input to the fleet. They are now a count in You and rows in the **Tickets** section.
- **The "This sprint" filter** is renamed **My sprint** and now also switches the status card and the delivery section between release and sprint scope.
- **The fleet switches** move from the Fleet section's body to its header line.

## Calls Made After Review

A builder check read this design on 2026-11-16. Jan Wloka decided the first two points; the writer settled the rest from points already settled above.

- **A sprint has an owner.** Sprint files gain `- **Owner:** <handle>` in their Status block, a handle the `People` config key declares (template `skills/plot/templates/sprint.md`, the sprint parser, the board). **"My sprint"** is the Active sprint the reader owns. **The release's people** are the owners of the sprints that name that release. Where the reader owns several Active sprints, **My sprint** combines them into one scope: the status card shows one progress bar per sprint, and Sprint delivery groups its plans by sprint. A person may own several Active sprints; nothing prevents it, because parallel sessions each run their own. (Jan Wloka) A sprint with no Owner counts toward the release and belongs to nobody's toggle. (Jan Wloka)
- **You always means the reader.** You ignores the Mine filter's three modes and always shows what waits on the person reading the board, which is why it has no BY column. Mine narrows Work items and Release delivery only. (Jan Wloka)
- **One status card per target release.** Where the active sprints name different `Release:` values, the tab header shows one release card per value, each with its own Approve button, and Release delivery shows one block per release. Where no sprint names a release, the card reads "No release targeted" and Release delivery lists every plan approved for delivery. *Writer's call.*
- **Tokens are output tokens.** `rules/slice-tokens.ts` refuses a single summed figure, so the Tokens column and the header's "tokens today" show **output tokens**, labelled as such, with the other counters in the cell's tooltip. Where no reading exists for "today", plan 4 names the gap and shows the per-agent figure only. *Writer's call.*
- **The progress bar has five segments:** delivered, at a gate, being built, blocked, not started. **Blocked** means the slice sits under You › Blocks delivery. The segments add up to the total. The slice strip uses the same five states. *Writer's call.*
- **One scope rule for every section.** The toggle's scope (release or my sprint) applies to the status card, Release delivery, You and Work items alike, so a slice in Release delivery always has its row in Work items or You. Fleet and Tickets stay unscoped. *Writer's call.*
- **A PR blocks delivery; no PR is an input.** A PR sits under **Blocks delivery** when it has an unanswered comment from a person, when its HIGH finding has spent the `Correction budget`, or when the repository does not declare `Auto-review: true`. Otherwise a slice PR is a gate under Work items. "A PR that needs a decision" leaves the Input group. *Writer's call.*
- **Unblock rows carry a third marker, "clean up"** (grey). The to-do list header counts it apart from the others: "You block 1 delivery · the fleet waits for 2 inputs · 2 to clean up". *Writer's call.*

## Approaches

- **A. Evolve the current tab in place.** Keep the placement rule, the row forms (`packages/domain/src/rules/delivery-row-form.ts`) and `AgentList.tsx`. Add the new facts to the domain: the tab-header facts, one summary per section, the input / blocks-delivery marker, the slice strip and a plan's to-do slices. Restyle one section per plan. Every step ships on its own and keeps the browser tests' subjects; it inherits the current component structure.
- **B. A new Delivery view on the card grammar.** New section components read domain facts the way the cards do (`card-facts.ts`), and the old list is swapped out at the end. Cleaner code, but one large change that ships late, with two views side by side until the switch.
- **C. Styling only.** Change only `.tsx` and CSS. Dropped: it breaks the rule that every rendered state is a domain property, so summaries and markers would have no unit test.

**Chosen: A** (Jan Wloka, 2026-11-16).

## The Plans

*Writer's call: one plan per section, in delivery order. Each ships alone.*

1. **Tab header and the toggle.** The sprint `Owner:` field (template, parser, board), the to-do list, the release and sprint card with Approve, the fleet card, the toggle's scope switch and its disabled state, and the section-header pattern every later plan uses.
2. **You.** The three groups and their markers, one row per plan with slice count and open questions, Unblock with Release and Delete for loose branches and closed PRs, tickets out of the rows.
3. **Work items.** Gates as ✓ ⟳ ✗, the per-group column, By with role chips.
4. **Fleet.** Agent rows with roles, Acting on, Doing now, tokens and time left; the switches on the header line.
5. **Release delivery.** One row per plan, the slice strip, the Done / In flight / To do list, progress per person, and the sprint scope.
6. **Machine, Tickets and footer.** The one-line healthy Machine, the Tickets section as triage's target, the footer, and the desks-not-placed details.

## Goals

- A developer answers the four questions within five seconds of opening the tab.
- No reason sentence repeats down a column; the group says why.
- No row needs a developer to know Plot's internals to read it.
- Every work item and every agent still shows once.

## Non-goals

- No change to the placement rule's decisions beyond those listed under "Changes to the 2026-11-08 design".
- No change to how the fleet schedules, reviews, fixes or merges.
- No change to the Discovery and Planning tabs.
- No new reads from a host or tracker. Tokens, bounds and machine load come from readings the board and fleetd already take; where a reading does not exist yet, its plan names it as a gap rather than adding a host call.

## Anti-goals

- A summary that lists items, so a section's header and body say the same thing twice.
- A row that is in two sections at once.
- Abbreviated text in a row that has room for the full text.
- A decision made in a `.tsx` file.
- An icon the glyph table does not hold.

## Constraints

- The layering rule: the domain decides, the board renders.
- Phone width: no horizontal scroll at 320 px. Columns that do not fit stack beneath the item.
- Browser tests prove only what is seen; behaviour is asserted in unit tests.
- Light and dark themes both read.

## Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology (Slice, Agent, Worker).
- Colours, spacing and the exact chip styles, within the board's existing palette.
- How a count link scrolls to and highlights its group.
- How the per-person progress cards wrap on narrow screens.
- Which existing browser tests move to unit tests.

## Mockups

The brainstorm mockups live in `.superpowers/brainstorm/20038-1794839570/content/` on the writer's machine and are not committed: `first-five-seconds-v2.html` (tab header), `section-header.html`, `you-section-v2.html`, `work-items-v1.html`, `fleet-section-v3.html`, `delivery-toggle-icons-v2.html`, `plan-slices.html`, `bottom-of-tab.html`. Where a mockup and this text disagree, this text wins.
