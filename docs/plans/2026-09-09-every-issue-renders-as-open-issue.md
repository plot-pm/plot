# Every issue renders as open

> Four Jira tickets sitting in *Internal Approving*, *In Progress* and
> *Reviewing* all render `open` on the board, because the read path never asks
> for a status and the renderer supplies the word from a literal.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #849
- **Story:** the-board-is-blank-where-it-matters
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #856 merged
- **Started:** 2026-09-09, Jan Wloka, `feature/an-issue-carries-its-status`
- **Started:** 2026-09-09, Jan Wloka, `feature/an-issue-key-is-a-string`

## Changelog

- The board shows a tracker issue's real status, so a Jira inbox distinguishes
  a ticket nobody has started from one sitting in review — and a Jira ticket
  now leaves the inbox once a plan answers it, where its key was compared
  against a number and never matched.

<!-- Board impact: yes, and it is most of the change. The plan touches
     plot-host.sh's issue-list projection, the Issue entity, the tracker port's
     two reads, three connectors, IssueRowSchema and tupleFromIssue. The board
     artifact must be rebuilt (pnpm build:board). -->

## Motivation

Reported in #849 against Plot 2.14.0. With `Tracker: jira <base-url>`, every
row in the board's inbox reads `open`. The reporter measured four issues from
one instance:

| Issue | `status.name` | `statusCategory.name` |
| --- | --- | --- |
| A-1 | Internal Approving | In Progress |
| B-1 | Internal Approving | In Progress |
| C-1 | In Progress | In Progress |
| D-1 | Reviewing | In Progress |

**None of the four is in a *To Do* category.** Every one is in flight, and the
board says nothing about that. Twelve tickets render `open` twelve times.

### The word is a literal, and its justification is backend-specific

`open` is not a mis-mapped status. `tuple-row.ts:1096` writes it directly, and
states why:

> `open`, and it is the only status an UNPLANNED issue has: the tracker reports
> open issues and this list is filtered to the ones no plan references. A closed
> one is not here to have a status.

**That reasoning is true for GitHub and false for Jira**, and the difference is
what makes this a defect rather than a preference. The GitHub arm shells out to
`gh issue list --state open` (`plot-host.sh:3081`), so every row it returns
really is open and `open` is a fact. The Jira arm's default JQL is
`assignee = currentUser() AND resolution = EMPTY` (`plot-host.sh:3036`) —
**unresolved**, which is a far wider set than *not started*. Jira returns a
workflow-rich list and the board collapses it to one word.

The evidence table is the proof: *unresolved* held four tickets, and not one of
them was in the state `open` claims.

The Bitbucket arm makes the same loss a third way. It parses a state badge out
of each row — `NEW`/`OPEN`/`RESOLVED`/… at `plot-host.sh:3110` — and discards it
to recover the title. The fact is read and thrown away.

### Nothing downstream has anywhere to put it

`plot-host.sh` requests `fields=summary,created` and projects four keys
(`:3048`, `:3056`). `issue-view` is the same shape (`fields=summary,description`).
The one op naming a status, `issue-status`, is the tracker port's single
**write**. There is no read path for an issue's status anywhere.

### And the same read path lies about the issue's identity

**Measured 2026-09-09, while this plan was challenged.** The Open Question
below asked whether `IssueRowSchema.number` was lying. It is, and the
consequence is larger than a wrong type.

The Jira arm projects the KEY as the number, and says so:

```sh
# `number` is the Jira KEY (PROJ-123), a string — #447 taught the parser to
# read that form.
number: .key,
```

Every consumer downstream declares an integer:

| layer | declaration |
|---|---|
| `schema.ts:2970` | `number: z.number()` |
| `fleet.ts:2259` | `{ number: number; … }[]` |
| `fleet.ts:2171` | `Promise<Set<number> \| null>` |

**TypeScript cannot catch it** because the shell's JSON is `JSON.parse(line) as
{ number: number; … }` — a cast, not a parse. So `"PROJ-123"` travels through
four typed layers unchallenged.

**The load-bearing consequence is at `fleet.ts:2286`:**

```ts
.filter((i) => !referenced.has(i.number))
```

That is the *"drop issues a plan already references"* rule — the one that makes
the inbox an inbox rather than a list. It is a `Set` membership test between a
`Set<number>` built from plan metadata and a string from Jira, so **it never
matches**. Proven end to end:

```
$ cat /tmp/plan.md
- **Issue:** PROJ-123
$ plot-plan-meta.sh /tmp/plan.md | jq .issues
[]
```

The parser reads only the `#N` form, so a plan answering `PROJ-123` records no
issue at all — and even if it did, the number/string comparison would fail.

**So a Jira ticket never drains from the inbox.** Write the plan, deliver it,
release it: the ticket sits there. That is a different defect from the status
literal and it lives in the same four lines, which is why it is folded in here
rather than filed alone.

## Design

### The decision this plan must make first

**`entities/issue.ts:25` refuses this field in writing:**

> Tracker state — status, assignee, labels, priority — is deliberately absent:
> Plot never writes to the tracker, so a mirrored field is wrong between
> refreshes and wrong forever after an outage.

**That refusal is a recorded decision, and this plan reverses part of it.** Say
so rather than route around it: adding `status` without engaging this sentence
would leave two documents disagreeing, and the next reader could not tell which
one was current.

The argument for reversing it, narrowly:

- **The stated risk is staleness, and it is real** — a status read at 10:00 is
  wrong at 10:05 if somebody moves the ticket. But this is true of every field
  the entity already carries. `title` is mirrored and can be edited in Jira;
  `createdAt` is the only immutable one. The inbox is re-fetched on a timer, so
  the field ages exactly as far as the list does.
- **The refusal's real subject is a WRITE-BACK loop**, not a read. The sentence
  sits beside *"Plot never writes to the tracker"*, and the danger it names —
  a mirrored copy that outlives what it mirrors — belongs to a field Plot might
  later reconcile. A status Plot reads, renders and never stores is not that.
- **`assignee`, `labels` and `priority` stay refused.** This plan widens the
  entity by one field with a named reader, and the sentence is amended to say
  which fact is carried and why, rather than deleted.

**Settled 2026-09-09: the reader accepted the widening, narrowly.** `status`
and `statusCategory` are carried; `assignee`, `labels` and `priority` stay
refused, and the entity's sentence is amended to name which fact is carried and
why rather than deleted. The alternative was named and rejected — rendering
nothing rather than a wrong word is smaller and also closes #849, but it loses
the distinction the reporter asked for: an inbox that cannot tell a ticket
nobody has started from one sitting in review.

### The identity type is the same question one field over

`number` is the issue's identity, and the entity's own docstring already states
the rule the read path breaks: *"Identity: a natural key — an opaque string,
which fails by the source lying."* **An opaque string.** The entity says so and
every consumer declares an integer.

So this is not a new decision, it is the existing one applied. `number` becomes
a string end to end, and `referencedIssues` a `Set<string>`:

- **A GitHub number stringifies losslessly.** `123` and `"123"` name the same
  issue, and the `Set` compares equal once both sides are strings.
- **A Jira key has no integer form at all.** `PROJ-123` cannot be coerced, which
  is why the current type is unfixable in the other direction — narrowing Jira
  to an integer would mean inventing an identity the tracker does not use.
- **The parser moves with it.** `plot-plan-meta.sh` reads only `#N` today, so a
  plan answering `Issue: PROJ-123` records nothing. Both halves must change
  together or the filter still never matches.

**Not chosen: coercing at the boundary.** `Number(i.number)` in `fleet.ts` would
satisfy the type and produce `NaN` for every Jira key — a filter that never
matches, which is exactly today's behaviour with a cast in front of it.

### Two fields, not one

`#849` proposes carrying both `status.name` and `statusCategory.name`, and the
reasoning holds:

- **`status.name` is per-workflow and may be localised.** *Internal Approving*
  is one instance's word. A board grouping on the raw name fragments across
  projects.
- **`statusCategory.name` is a stable three-value vocabulary** — `To Do` /
  `In Progress` / `Done` — which a board can group and colour on.

So the name is what a person **reads** and the category is what the board
**decides** on. Both are carried; neither substitutes for the other.

### Keeping the contract uniform across backends

A `status` key that only Jira populates makes a Jira-only field, which is what
the tracker port exists to prevent. Each backend answers both:

| Backend | `status` | `statusCategory` | Source |
| --- | --- | --- | --- |
| GitHub | `open` | `To Do` | `gh issue list --state open` — the current literal, now sourced |
| Jira | `.fields.status.name` | `.fields.status.statusCategory.name` | one added field in the existing request |
| Bitbucket | the parsed badge | mapped from the badge | already parsed at `:3110`, currently discarded |

GitHub's `To Do` is the honest category for a list filtered to open issues, and
it makes the current behaviour a *derived* answer rather than an assumed one.

### Open Questions

- [x] **Does the reader accept widening the `Issue` entity at all?** —
      *answered 2026-09-09: yes, narrowly.* `status` and `statusCategory` only;
      `assignee`, `labels` and `priority` stay refused, and the entity's
      sentence is amended rather than deleted.
- [x] **`IssueRowSchema.number` is `z.number()` while Jira sends a key
      string.** — *answered 2026-09-09: it is lying, and the cost is larger
      than a type.* Measured: `referencedIssues` builds a `Set<number>` and
      `fleet.ts:2286` tests a Jira string against it, so no Jira ticket ever
      drains from the inbox. Folded into this plan as the Identity slice rather
      than filed alone, because it lives in the same four lines as the status
      literal and the entity is this plan's subject.
- [ ] **Does Bitbucket's badge map cleanly onto the three categories?**
      `NEW`/`OPEN` → To Do and `RESOLVED`/`CLOSED` → Done are clear;
      `ON HOLD`, `INVALID`, `DUPLICATE`, `WONTFIX` are not obviously any of the
      three. A slice may decide `statusCategory: ''` is the honest answer there.
- [ ] **Does anything sort or filter on the status literal today?** If the
      inbox's ordering assumes one value, three values may change the section's
      shape.

## Slices

**THIS PLAN COLLIDES WITH `jira-inbox-is-instance-wide-the` (#850), and the
order is stated rather than left to whoever rebases second.** Both edit
`plot-host.sh`'s `issue-list` Jira arm: #850's first slice rewrites the `jql=`
line at `:3025`, and this plan's Reading slice adds a field to the request and
a key to the `jq` projection twenty lines below it. **#850 lands first** — its
change is one line and self-contained, while this plan's touches the projection
that #850's query feeds. A slice here rebases onto #850 rather than racing it.

### Reading

The fact reaches the domain. Both reads gain the two keys across all three
backends, and the entity carries them.

- `feature/an-issue-carries-its-status` <!-- builds: Issue.status and Issue.statusCategory, the tracker read path's status fields --> — add `status` to the Jira request and projection, source GitHub's from `--state`, map Bitbucket's parsed badge, and widen `Issue` + `RawIssue` with `status` and `statusCategory` — amending the entity's *deliberately absent* sentence to name what is carried and why. → #857

### Identity

The issue's own key survives the trip. **It names no `waits:`, and that is the
ordering**: this slice and Reading touch the same four lines but different
fields, so neither is a prerequisite for the other and both are eligible at
once. Whichever lands first, the other rebases.

- `feature/an-issue-key-is-a-string` <!-- builds: the Issue identity type across the parser, the schema, the row and the referenced-issue set --> — `number` becomes a string end to end: `IssueRowSchema.number`, `fleet.ts`'s two local types, and `referencedIssues`' `Set<number>` → `Set<string>`; and `plot-plan-meta.sh` learns to read a `Issue: PROJ-123` key beside the `#N` form it already reads.

  **Asserted: a plan naming `Issue: PROJ-123` parses as `issues: ["PROJ-123"]`** — measured `[]` today, which is half the defect. **Asserted: a Jira ticket answered by a plan LEAVES the inbox** — the whole point, and the assertion a type-only change would pass without. **Asserted: a GitHub issue still drains** — `#849` in a plan against `849` from the host, both strings, still equal; this is the regression the change could most easily cause. **Asserted: no consumer coerces** — `grep` finds no `Number(` on the issue path, since a coercion satisfies the type and reproduces the bug.

### Rendering

The board shows it. Depends on Reading: there is nothing to render until the
payload carries it.

- `feature/the-inbox-shows-a-real-status` <!-- builds: the inbox row status cell, read from the issue rather than assumed --> — carry the two fields through `IssueRowSchema` and the fleet payload, and replace `tupleFromIssue`'s `status: 'open'` literal with the issue's own status, rewriting the justification comment that made the literal defensible.

## Notes

- **Written unattended** from issue #849 via `/plot-idea`. Nothing was written
  to the tracker: no comment, no label, no state change. The `Issue: #849`
  field above is the only link, and it points one way.
- **Stops at Draft deliberately.** Whether to reverse the entity's recorded
  refusal is the reader's decision, and approving this plan would make it for
  them.
- **Every claim in Motivation was verified against `origin/main`**, not taken
  from the issue: `plot-host.sh:3048` (the two-field request), `:3056` (the
  four-key projection), `:3036` (the JQL), `:3081` (GitHub's `--state open`),
  `:3110` (the discarded Bitbucket badge), `tuple-row.ts:1096` (the literal),
  `entities/issue.ts:25` (the refusal), `schema.ts:2958` (the row's five
  fields). The issue's report holds; the entity's stated refusal is the part
  it did not mention.
- **The deliverable search found no existing status field** on the tracker read
  path — only the existing plumbing and `issue-status`, which is the write.
- Predecessors, all Released: `my-jira-tickets-are-in-the-inbox` (2026-08-26),
  `my-bitbucket-issues-are-in-the-inbox` (2026-08-26),
  `an-issue-is-a-signal-the-board-can-see` (2026-08-18). This plan sits on top
  of all three rather than competing with them.
- Definition of Done: docs/definition-of-done.md
