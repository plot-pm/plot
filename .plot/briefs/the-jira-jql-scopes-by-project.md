## Implementation brief — jira-inbox-is-instance-wide-the (slice 1: Scoped)

- **Plan (canonical):** `docs/plans/2026-09-09-jira-inbox-is-instance-wide-the.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #854 merged
- **Branch:** `feature/the-jira-jql-scopes-by-project` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention
- **Answers:** GitHub issue #850

**THIS SLICE LANDS BEFORE `every-issue-renders-as-open-issue` (#856).** That
plan's Reading slice edits the `jq` projection twenty lines below the line you
change. Yours is one line and self-contained; theirs rebases onto you. Do not
touch the projection.

### What to build

A `tracker_projects()` helper reading a new `Ticket prefixes` config key, and
`issue-list`'s default JQL gaining `AND project IN (…)` when it answers
non-empty.

The concrete failure, from a real instance: one reporter's board showed twelve
issues, eleven belonging to this repository across three projects and one —
*"Upgrade Java 8 → Java 11"* — belonging to **a different customer entirely**.

`plot-host.sh:3025` is the whole cause:

```sh
jql="${PLOT_JIRA_JQL:-assignee = currentUser() AND resolution = EMPTY ORDER BY created DESC}"
```

`assignee = currentUser()` scopes by person. `resolution = EMPTY` scopes by
state. **Nothing scopes by repository.**

### The decisions the plan settles — do not re-derive them

**The absent-key case is load-bearing, not a courtesy.** Key absent → today's
query, byte-identical. A default that started filtering on an undeclared key
would empty every existing board's inbox on upgrade — which is a *worse* failure
than the one being fixed, because it looks like *no tickets* rather than like
*the wrong tickets*.

**Precedence: `PLOT_JIRA_JQL` still wins over both.** Teams already worked
around this bug with their own JQL; an override that stopped overriding would
break exactly the people who noticed the problem first.

**The key holds a LIST, and the probe's single prefix only seeds it.**
`plot-detect-repo.sh:97` takes `head -1`, and `TicketProposal.prefix` is
`string | null`. On the reported repository that answers `PROJ-B`. **Filtering
on that alone would be a second defect wearing the fix's clothes** — it shows 3
of 12 issues and hides the PROJ-A and PROJ-C work that genuinely belongs, under
a heading claiming nobody has planned these tickets. A repository mapping to
several Jira projects is the normal case, not the exception.

**The name was challenged and kept.** `Ticket prefixes` beat `Jira projects`
(puts a vendor in a config key, severs the word the probe already uses) and
`Tracker projects` (generalises over a set of one). **The docstring is a
deliverable, not a nicety**: `Branch prefixes` is an unrelated structural key
holding `idea/, feature/, bug/`, the two sit adjacent in every adopting repo's
config, and only the docstring keeps them apart.

**This is the estate's first list-valued key with a consumer.**
`Implementation home` is documented as taking a list and nothing splits one
(grepped 2026-09-09). So the parsing is yours to state, not to inherit.

**Not chosen: asking Jira which projects the user can see.** That answer is
instance-wide too — it is the same list that produced the bug — and costs a
second API call on a path whose exit-code semantics (3 vs 4 vs empty) this repo
has already argued carefully.

**Not chosen: `project = currentProject()`.** No such JQL function exists. Jira
has no notion of the repository the board serves; that mapping lives only in
this repository's config, which is why a key is the fix.

**Rules carried over:** not being able to ask is not an empty answer. The arm's
exit-code split (3 = config error, 4 = cannot ask, empty list = no tickets)
stays exactly as it is.

### Done when

The plan's slice assertions are the specification:

- With the key set, the JQL carries `project IN (PROJ-A, PROJ-B)` and returns
  that repository's issues.
- **With the key absent, the JQL is byte-identical to today's.** This is the
  upgrade-safety property, and the assertion that fails if the clause is
  appended unconditionally.
- `PLOT_JIRA_JQL` still wins with the key set.
- The key splits on commas with surrounding whitespace tolerated — `PROJ-A,
  PROJ-B` and `PROJ-A,PROJ-B` reach the same query.
- A key holding one prefix produces a valid one-element `IN` clause, because
  that is what adoption's seed writes.

Each exists because a naive implementation passes without it: the byte-identical
assertion catches an unconditional append, and the one-element assertion catches
a join that emits `IN (PROJ-A,)`.

Plus the repo gates: `nvm use` (Node 24 — `pnpm` crashes on 26), then
`corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`.
Add a changeset (`'plot': minor`, description FIRST, `bumps:` block LAST, with a
`plan:` line naming this plan). **Do not run `pnpm run test:e2e`** — CI's gate.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Slices` section on `main` — check `git branch --show-current` is `main`
before that edit. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` — the `jql=` line at `:3025`
and a new `tracker_projects()` helper beside `tracker_scheme()` /
`tracker_base_url()` (`:1345`) — plus the `Ticket prefixes` docstring in
`plot-config.sh` and the key's entry in this repo's own config docs.

**Do not touch:** the `jq` projection at `:3041`–`:3047` (that is #856's Reading
slice), `IssueRowSchema`, `fleet.ts`, or the `Issue` entity. **Do not implement
the adoption proposal** — that is this plan's second slice
(`feature/adoption-proposes-the-ticket-prefixes`), and it waits on you.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
