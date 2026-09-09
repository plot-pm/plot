## Implementation brief — every-issue-renders-as-open-issue (Reading slice)

- **Plan (canonical):** `docs/plans/2026-09-09-every-issue-renders-as-open-issue.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #856 merged
- **Branch:** `feature/an-issue-carries-its-status` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention
- **Answers:** GitHub issue #849 (in part)

**Rebase onto `feature/the-jira-jql-scopes-by-project` (#850) once it lands** —
it rewrites the `jql=` line at `plot-host.sh:3025`, twenty lines above the
projection you edit. The Rendering slice waits on YOU: there is nothing to
render until the payload carries the fields.

Independent of the Identity slice (`feature/an-issue-key-is-a-string`), which
changes `number`'s type in the same projection. Whichever lands first, the other
rebases.

### What to build

`status` and `statusCategory` reach the domain from all three backends, and the
`Issue` entity carries them.

The concrete failure, from a real instance: four Jira tickets, none of them in a
*To Do* category, all rendering `open`:

| Issue | `status.name` | `statusCategory.name` |
| --- | --- | --- |
| A-1 | Internal Approving | In Progress |
| B-1 | Internal Approving | In Progress |
| C-1 | In Progress | In Progress |
| D-1 | Reviewing | In Progress |

Twelve tickets render `open` twelve times. There is **no read path for an
issue's status anywhere** — `plot-host.sh` requests `fields=summary,created` and
projects four keys. The one op naming a status, `issue-status`, is the tracker
port's single **write**.

### The decisions the plan settles — do not re-derive them

**The entity's recorded refusal is being reversed, narrowly, and the reader
approved it.** `entities/issue.ts` says:

> Tracker state — status, assignee, labels, priority — is deliberately absent:
> Plot never writes to the tracker, so a mirrored field is wrong between
> refreshes and wrong forever after an outage.

**Amend that sentence to name which fact is carried and why. Do not delete it,
and do not add `assignee`, `labels` or `priority`** — they stay refused. The
argument that licensed this one: the refusal's real subject is a write-back
loop, not a read, and `title` is already mirrored and equally mutable.

**Two fields, not one, and neither substitutes for the other.**
`status.name` is per-workflow and may be localised — *Internal Approving* is one
instance's word, and a board grouping on it fragments across projects.
`statusCategory.name` is a stable three-value vocabulary (`To Do` /
`In Progress` / `Done`). **The name is what a person reads; the category is what
the board decides on.**

**Every backend answers both — a Jira-only field is what the tracker port
exists to prevent:**

| Backend | `status` | `statusCategory` | Source |
| --- | --- | --- | --- |
| GitHub | `open` | `To Do` | `gh issue list --state open` — today's literal, now *sourced* |
| Jira | `.fields.status.name` | `.fields.status.statusCategory.name` | one added field in the existing request |
| Bitbucket | the parsed badge | mapped from the badge | already parsed at `:3110` and **currently discarded** |

GitHub's `To Do` makes the current behaviour a *derived* answer rather than an
assumed one. Bitbucket's badge is read today and thrown away to recover the
title — the fact is already there.

**`ON HOLD`, `INVALID`, `DUPLICATE`, `WONTFIX` have no obvious category.**
The plan leaves this open and says `statusCategory: ''` may be the honest
answer. Empty is a legitimate outcome; **inventing a category is not.**

**Rules carried over:** absent is not false, and an unreachable connector is not
an empty one. The arm's exit-code split (3 = config error, 4 = cannot ask,
empty list = no tickets) is unchanged.

### Done when

- All three backends populate `status` and `statusCategory`; none returns a
  Jira-only shape.
- The `Issue` entity and `RawIssue` carry both fields, with the *deliberately
  absent* sentence amended rather than removed.
- `assignee`, `labels` and `priority` remain absent — assert this, since the
  easy over-reach is adding the whole Jira `fields` block.
- GitHub's `To Do` is derived from `--state open`, not hardcoded a second time.

**Do not change the rendering.** `tupleFromIssue`'s `status: 'open'` literal
stays until the Rendering slice — this slice makes the fact available, and a
half-landed change that renders from a field nothing populates is worse than
either end alone.

Plus the repo gates: `nvm use` (Node 24 — `pnpm` crashes on 26), then
`corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`,
`corepack pnpm run test:board`, `corepack pnpm run typecheck`, and
`corepack pnpm run build:board` with the artifact committed. Add a changeset
(`'plot': minor` plus `'@plot-pm/board': patch`, description FIRST, `bumps:`
block LAST, with a `plan:` line). **Do not run `pnpm run test:e2e`** — CI's gate.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Slices` section on `main` — check `git branch --show-current` is `main`
before that edit. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the read path: `plot-host.sh`'s `issue-list` request and
projection for all three backends, `packages/domain/src/entities/issue.ts`, and
`RawIssue`.

**Do not touch:** `number`'s type (the Identity slice), the `jql=` line (#850),
`IssueRowSchema`, `tupleFromIssue`, or anything in the board's renderer.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
