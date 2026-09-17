# The inbox says what it is showing

> The board's Jira inbox narrows by assignee and by project, adoption explains neither, so a correct empty inbox is indistinguishable from a broken one.

## Status

- **State:** Approved
- **Type:** docs
- **Issue:** #928
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-17, jwloka, in-session
- **Started:** 2026-09-17, Jan Wloka, `docs/the-inbox-says-what-it-is-showing`

## Changelog

- `/plot-board-setup` states what the Jira inbox will show and names the one override. Two narrowings apply to the default query and neither appeared in any skill, so an adopter with a healthy setup had no way to tell an empty inbox from a fault.

<!-- Board impact: none to the board itself — the query is unchanged. The
     setup skill gains a step. -->

## Design

**The default query narrows twice** — `plot-host.sh:3376`:

```sh
jql="${PLOT_JIRA_JQL:-assignee = currentUser() AND resolution = EMPTY${scope} ORDER BY created DESC}"
```

By **assignee**, and by **project** through `${scope}`. Measured 2026-09-17 on a
repository tracking in Jira:

| query | result |
|---|---|
| `project = QUAWEB AND statusCategory != Done` | **10+ open tickets** |
| the default, with the assignee clause | **0** |

Credentials verified independently — `GET /rest/api/3/myself` answered 200.
**Nothing was misconfigured. The board answered the question it was asked.**

### The override is documented only where the adopter does not read

`PLOT_JIRA_JQL` appears in shell comments (`plot-host.sh:211`, `:3350`, `:3373`,
`plot-config.sh:111`) and in one CHANGELOG entry. Verified 2026-09-17: **it is
named in no skill and no README.** An adopter reads the setup skill, not the
script the setup skill calls.

### The assignee clause stays, and that is the precedent

[`the-jira-inbox-is-scoped-to-this-repository`](2026-09-09-jira-inbox-is-instance-wide-the.md)
shipped the project narrowing for #850, because an instance-wide inbox listed
another customer's work. **It left the assignee clause alone deliberately**, and
that decision is right: an inbox is a person's queue.

**What changed is that two narrowings now compose**, and the second was added
without adoption ever having explained the first. This plan changes no query and
re-argues no default.

### A step, not a warning

**The step runs after the board is verified**, where the operator is already
reading output about their own setup, and it states the reading rather than
asking a question:

> The inbox shows tickets **assigned to you** and unresolved, scoped to
> `Ticket prefixes`. An empty inbox with open project tickets is the normal
> reading, not a fault. To widen it, set `PLOT_JIRA_JQL` — it overrides the
> whole query.

**It is unconditional.** A step that fires only on an empty inbox would be a
diagnosis, and the reading it explains is true whether the inbox is empty or
not — an operator seeing three tickets deserves to know it is not the project's
whole backlog.

### What this does not do

**It changes no behaviour, byte for byte.** The default query stays exactly as
#850 left it, and this plan's `Done when` pins that.

**It adds no config key.** The environment variable exists and already wins. A
second way to say the same thing is the drift this repo's own skills warn about,
and the reporter named that before it could be proposed.

**It does not document `PLOT_JIRA_JQL`'s syntax.** JQL is Atlassian's, and a
half-copy of it here would go stale. The step names the variable and what it
overrides.

**And it does not make the BOARD say it, which is the better answer and is
deliberately not taken here.** A setup step is read once; the screen is read
every day. The board already distinguishes three inbox states and renders a bare
`none` for this one, while `HOST_ANSWER_HINT`
(`app/lib/agent-rows/host-notes.ts:232`) carries a sentence for each of the
others.

**Its type says the omission was a decision, not an oversight**:

```ts
export const HOST_ANSWER_HINT: Record<Exclude<HostAnswer, 'answered'>, string>
```

`'answered'` is excluded by construction, so a hint for an answered-but-empty
inbox is a change to that type and to every reader of it. **That is a `feature`
plan with its own gates**, and folding it in here would make this one's
`Type: docs` false — a docs plan is live on merge and needs no release, and this
plan's one hard gate exists to keep it that way.

**So it is named and filed separately rather than left implied.** Without saying
so, this report reads as answered by documentation while the screen still says
nothing.

## Slices

### The inbox says what it is showing (Branch: docs/the-inbox-says-what-it-is-showing, PR: #936)

- `docs/the-inbox-says-what-it-is-showing` — add a step to `/plot-board-setup` stating both narrowings and naming `PLOT_JIRA_JQL`, correct the stale `:393-401` paragraph that says no Jira backend exists, and record the unattended shape the skill's sweep requires

**Done when** the setup skill names **both** narrowings — assignee and project —
since naming only the project one leaves the reported symptom unexplained;
`PLOT_JIRA_JQL` is named with what it overrides; the step states that an empty
inbox beside open project tickets is the expected reading; the default query in
`plot-host.sh` is **unchanged**, pinned by asserting the line byte-for-byte; the
step is unconditional rather than fired by an empty inbox; the skill carries its
`PLOT-UNASKED` line, which the estate-wide unattended sweep requires of every
skill; and `pnpm test` passes.

## Notes

**Reported 2026-09-17 by an adopter who had to run the JQL by hand** to find out
their setup was healthy.

**The sibling report is the same feeling and a different screen.**
[#930](2026-09-17-a-credential-is-read-where-a-repo-keeps-it.md) is an inbox
that never runs because the credentials are not found; this is an inbox that
runs correctly and returns nothing.

**An earlier draft said both show one screen. The render path says otherwise** —
a credentials failure drives `issueAnswer: 'failed'` and renders an error line
with a note, while this case is `issueAnswer: 'answered'` with an empty array
and renders `none`. The board already tells them apart; what it does not do is
say WHY the second one is empty, which is the separate plan named above.

**So they stay two plans**, and merging them would drag a docs change into a
release-gated feature.

**A round-1 juror reported a stale sentence in the setup skill. I refused it,
and the refusal was wrong.** Recorded because the error is instructive: the
juror named `:393-401` and I checked `:220` and `:236`, concluded those were
true — they are, they are the `Ticket prefixes` decline rule — and refused a
claim nobody had made. **A refusal that answers the wrong citation is worse than
no refusal**, because it looks like the finding was examined.

The sentence actually reported is stale and inverts the truth:

> `plot-host.sh issue-list` resolves issues through the **Git host** … A
> `Tracker: jira` or `Tracker: linear` is recorded but unread … A Jira backend
> is planned; until then, the inbox will be empty.

`plot-host.sh` carries **39 Jira references** and its own header reads *"JIRA
ANSWERS when `Tracker: jira` is declared"*. The backend landed; the skill still
tells adopters it has not.

**And it is the same failure as this plan's, one step earlier**: an adopter told
their inbox will be empty has an explanation for an empty inbox that is false,
which is strictly worse than having none. **So it is in scope**, and the
implementer is already in that file.

**Type `docs` deliberately.** No code path changes, so the plan is live when
merged and needs no release — the distinction `/plot-deliver` states to a docs
plan's author.
