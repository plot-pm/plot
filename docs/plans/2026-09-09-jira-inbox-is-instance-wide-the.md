# The Jira inbox is scoped to this repository

> The default JQL scopes by person and by resolution and by nothing else, so a board serving one repository lists every unresolved ticket assigned to its reader across the whole Jira instance — including another customer's product.

## Status

- **State:** Delivered
- **Type:** feature
- **Issue:** #850
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #854 merged
- **Started:** 2026-09-09, Jan Wloka, `feature/the-jira-jql-scopes-by-project`
- **Started:** 2026-09-09, Jan Wloka, `feature/adoption-proposes-the-ticket-prefixes`
- **Delivered:** 2026-09-10

## Changelog

- A repository that declares its Jira project keys gets an inbox holding only its own tickets. `plot-host.sh issue-list` adds `project IN (…)` to the default JQL from a new `Ticket prefixes` config key; a repository that declares none keeps today's instance-wide query, and `PLOT_JIRA_JQL` still wins over both. `/plot-init` and `/plot-board-setup` propose the key, seeded from the prefix the probe measured.

Board impact: yes. The inbox is a board section, and this changes which issues reach it.

## Motivation

**Reported from a real instance, and the cause is one line.** `plot-host.sh:3025`:

```sh
jql="${PLOT_JIRA_JQL:-assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC}"
```

`assignee = currentUser()` scopes by person. `resolution = EMPTY` scopes by state. Nothing scopes by repository, and there is no third clause. One reporter's board showed twelve issues, eleven belonging to this repository across three projects and one — *"Upgrade Java 8 -> Java 11"* — belonging to a different customer entirely.

**The scale of the defect is a property of the reader, not of the repository.** A person who works on one product sees a correct inbox by accident. A person who works across many customers sees a personal to-do list wearing a repository's clothes, and the more projects they touch, the less the board's inbox has to do with the board. Nothing on the board says the list is unscoped, so a foreign ticket reads as work waiting here.

### This is the default, not a missing capability

`PLOT_JIRA_JQL` already overrides the query, so any team can scope its own inbox today. What is wrong is the value every new adopter gets. A capability nobody knows to reach for does not answer a default that misleads.

### The inbox is the one section this costs

`fleet.ts` defines the inbox as *open tracker issues no plan references*. Every other board section derives from this repository's own git state — branches, PRs, plans — so the inbox is the only place a fact about somebody else's product can appear at all. `my-jira-tickets-are-in-the-inbox` built this section precisely because *which ticket should become a plan* is the question the board exists to answer; an unscoped list answers it with tickets that can never become a plan here.

## Design

### Approach

**A `Ticket prefixes` config key holding a list, read by `issue-list` and by nothing else.**

- key present → `AND project IN (<keys>)` is added to the default JQL
- key absent → today's query, unchanged
- `PLOT_JIRA_JQL` set → wins over both, exactly as now

The absent case is load-bearing rather than a courtesy. Existing boards work today by the reader's own JQL or by accident of a single-project instance; a default that started filtering on an undeclared key would empty those inboxes silently on upgrade, which is a worse failure than the one being fixed because it looks like *no tickets* rather than like *the wrong tickets*.

### The key holds a list, and the obvious seed reports one

**Measured 2026-09-09.** `plot-detect-repo.sh:97` reads the log, counts prefixes, and takes `head -1`:

```sh
ticket_line=$(git log --format=%s -"$SUBJECT_SAMPLE" … | sort | uniq -c | sort -rn | head -1)
ticket=$(printf '%s' "$ticket_line" | awk '{ print $2 }')
```

`proposeTicket` (`stack.ts:341`) carries that shape forward — `TicketProposal.prefix` is `string | null`, one prefix or none. On the reported repository the probe answers `PROJ-B`.

**Filtering on that alone would be a second defect wearing the fix's clothes.** It shows 3 of the 12 issues and hides the PROJ-A and PROJ-C work that genuinely belongs here — and it hides it under a heading saying nobody has planned these tickets, which is the same lie the current defect tells with the projects reversed. A repository mapping to several Jira projects is normal: one product split into a customer-facing project, a legacy project and a release project.

So the detected prefix **seeds** a list and never constitutes one:

```markdown
- **Ticket prefixes:** PROJ-A, PROJ-B, PROJ-C
```

### The estate has the precedent one key over, and it is recent

`the-ci-key-carries-its-instance` settled this shape yesterday: a config value carries more than one fact, a helper splits it, and callers ask the helper rather than matching the raw value. `tracker_scheme()` / `tracker_base_url()` (`plot-host.sh:1475`) are the same pair for `Tracker:`. This key is simpler than either — it holds one kind of thing, several times — so the split is a comma rather than a scheme.

**`Implementation home` is documented as taking a list and has no reader that splits one** (`plot-config.sh:94`; grepped 2026-09-09, the only other hit is a comment in `plot-dispatch.sh`). So this is the estate's first list-valued key with a consumer, and the parsing is the plan's to state rather than to inherit.

### A project key is not a branch prefix

They coincide on the reported repository and they are not the same thing. `Ticket prefixes` is documented as **Jira project keys** — what `project IN (…)` takes — so the JQL is exact and no mapping step exists. The name is close to `Branch prefixes`, which is an unrelated structural key holding `idea/, feature/, bug/`, and the docstring must say so where somebody reads the two together.

**The name was challenged and kept, 2026-09-09.** Two alternatives were weighed and both cost more than the ambiguity they remove. `Jira projects` names exactly what the JQL takes and can never be read as a branch prefix — but it puts a vendor in the config key and severs the word it shares with the probe, whose `TicketProposal.prefix` is what seeds the value. `Tracker projects` is vendor-neutral and pairs with `Tracker:` — but no second tracker has project scoping today, so it generalises over a set of one. **`Ticket prefixes` keeps adoption's vocabulary in one word from probe to key**, and the collision with `Branch prefixes` is answered by a docstring rather than by a rename. That docstring is a slice deliverable, not a nicety: the two keys will sit adjacent in every adopting repo's config.

The probe's reading is a *commit-subject* prefix, which is why it seeds rather than answers: it is evidence that a key exists, not proof of which keys the JQL needs.

### Adoption proposes it, seeded and confirmed

`/plot-init` and `/plot-board-setup` are where `Git host` and `Tracker` are already proposed, and `trackerKey` (`adoption.ts:216`) already consumes `input.proposal.ticket.prefix`. Its own docstring carries the argument this key needs — *"a confirmed `jira` with no URL is written WITH its gap named rather than withheld"*. A single measured prefix is a one-element proposal with a named gap; the person adds the rest.

**The propose/collect seam holds.** The probe reports prefixes and their counts; whether they constitute a key list is the rule's decision, exactly as `proposeTicket`'s threshold moved out of an `awk '$1 >= 2'` in the collector.

### Not chosen: inferring the projects from the tracker

Jira can be asked which projects the user can see, and that answer is instance-wide too — it is the same list that produced the bug. It also costs a second API call on a path whose failure modes this repo has already argued carefully (exit 3 versus exit 4 versus an empty list), for a fact a person can state in one line.

### Not chosen: scoping by `project = currentProject()`

No such JQL function exists. Jira has no notion of the repository the board is serving; the mapping lives only in this repository's config, which is why the key is the fix.

### Open Questions

- [ ] **Does the probe report the other prefixes it already counted?** It computes the full `uniq -c` list and discards all but the first. Widening `ticket_prefix` to a list would let adoption propose all three at once — but it changes `StackReadings` and `TicketProposal`, which `trackerKey` reads. Worth doing in this plan or worth its own; the first slice does not depend on it.
- [ ] **What does a repository with two Jira instances declare?** The same question `the-ci-key-carries-its-instance` left open for Jenkins. One `Tracker:` value carries one base URL, so project keys from two instances have nowhere to go. Out of scope here; recorded so the two open points can be answered together.

## Slices

**THIS PLAN COLLIDES WITH `every-issue-renders-as-open-issue` (#849), and this plan lands FIRST.** Both edit `plot-host.sh`'s `issue-list` Jira arm: the Scoped slice below rewrites the `jql=` line at `:3025`, and #849's Reading slice adds a field to the request and a key to the `jq` projection twenty lines below. This one goes first because its change is one line and self-contained, while #849's touches the projection this query feeds — so #849 rebases onto this rather than the other way round. Neither plan mentioned the other until both were challenged together.

### Scoped

- `feature/the-jira-jql-scopes-by-project` — a `tracker_projects()` helper reading `Ticket prefixes`, and `issue-list`'s default JQL gaining `AND project IN (…)` when it answers non-empty. → #858 <!-- builds: tracker_projects, the helper reading a repository's Jira project keys -->

  **Asserted: with the key set, the JQL carries `project IN (PROJ-A, PROJ-B)`** and the issues returned are that repository's. **Asserted: with the key absent, the JQL is byte-identical to today's** — this is the upgrade-safety property, and it is the assertion that fails if the clause is appended unconditionally. **Asserted: `PLOT_JIRA_JQL` still wins** with the key set, since an override that stopped overriding would break the teams who already worked around this. **Asserted: the key is split on commas with surrounding whitespace tolerated** — `PROJ-A, PROJ-B` and `PROJ-A,PROJ-B` reach the same query. **Asserted: a key holding one prefix produces a valid one-element `IN` clause**, because that is what adoption's seed writes.

### Proposed

- `feature/adoption-proposes-the-ticket-prefixes` — `/plot-init` and `/plot-board-setup` propose `Ticket prefixes`, seeded from the measured prefix and confirmed by a person. → #870 <!-- builds: proposeTicketPrefixes, the rule deciding what key list adoption writes -->

  **Asserted: a measured prefix proposes a one-element list with its gap named**, not a silent complete answer. **Asserted: no measured prefix proposes nothing** — the key is omitted rather than written empty, since an empty key must not read as *this repository has no projects* and trigger the absent-key path with a claim attached. **Asserted: the proposal is a proposal** — declining it writes no key, and the inbox stays instance-wide, which is today's behaviour and a legitimate choice.

## Notes

Written 2026-09-09 from issue #850. Every claim the issue makes about the code was re-measured before the plan was written, and all of them held: the JQL at `plot-host.sh:3025`, the `head -1` at `plot-detect-repo.sh:97`, and `TicketProposal.prefix` as `string | null`. The issue's warning about the obvious seed is the most valuable thing in it — a fix that filtered on the single detected prefix would have shipped, looked correct on a single-project repository, and hidden two thirds of the reporter's real work.

The deliverable search found no existing `tracker_projects` and no existing prefix-list proposal; the near hits are `Branch prefixes` (an unrelated structural key) and `projectSlug` (a transcript path helper).
