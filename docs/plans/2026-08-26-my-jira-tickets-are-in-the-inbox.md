# My Jira tickets are in the inbox

> A team whose tickets live in Jira opens the board and sees them, so a ticket
> becomes a plan without leaving the board.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

- `plot-host.sh` resolves `issue-list` and `issue-view` through Jira when the
  repo declares `Tracker: jira`, so the board's ticket inbox works for a team
  whose tickets are not GitHub issues.

## Motivation

`Tracker: jira` is a documented `## Plot Config` key. `plot-config.sh` describes
it; grepping the repo for a consumer returns **nothing**. A team can configure
Jira, see the key accepted, and get an empty inbox forever.

The board's ticket inbox is the one section an enterprise team cannot reach any
other way — branches and PRs they can read from Bitbucket, but *which ticket
should become a plan* is the question the board exists to answer.

## Design

### The contract already exists, and it is narrow

`issue-list` emits one JSON object per line: `{number, title, url, createdAt}`.
`issue-view` emits one issue's body. Exit 3 means the host was asked and failed;
exit 4 means it cannot be asked at all. A Jira backend fills that shape and
changes nothing about it.

**`number` is a string for Jira** — `PLOT-412`, not `412`. The field is already
consumed as an opaque identifier for display and for the `Issue:` field; a plan
citing `Issue: PLOT-412` is exactly as valid as one citing `#228`.

### Read-only, like every other issue op

`plot-host.sh`'s two issue operations READ and never write. Plot's record of an
issue is the plan that names it; the tracker is not updated. That rule is
unchanged and this backend must not be the exception that starts writing.

### The plan format does not accept a Jira key yet

**Measured 2026-08-26**: a plan with `- **Issue:** PLOT-412` parses as
`issues=[]`. `plot-plan-meta.sh:349` reads `#N` and nothing else, so the board
would never link a Jira-tracked plan to its ticket, and the inbox could not tell
that a ticket already has a plan — which is the whole point of the inbox.

That makes the parser a **second wave, not an open question**. It is small and
independent: the field accepts `PROJ-123` alongside `#228`, both reported in
`issues`.

### Which CLI

Open. `jira` (ankitpokhrel/jira-cli) and `acli` are candidates, as is the REST
API with a token. The choice belongs to whoever can test against a real
instance — this repo has none.

## Waves

### Keyed (Branch: feature/a-plan-cites-a-jira-key)

`plot-plan-meta.sh` accepts `PROJ-123` in the `Issue:` field alongside `#228`,
reporting both in `issues`. Independent of the backend and a prerequisite for it
being useful.

### Listed (Branch: feature/jira-issues-reach-the-inbox)

`issue-list` and `issue-view` resolve through Jira under `Tracker: jira`,
emitting the existing contract.

## Done when

1. `issue-list` under `Tracker: jira` emits `{number,title,url,createdAt}` lines,
   with `number` as the Jira key.
2. **A GitHub repo is unaffected.** `Tracker: jira` is opt-in; a repo that does
   not declare it resolves exactly as it does today.
3. **An unreachable Jira exits 3, not 4, and not an empty list.** Exit 4 means
   *this backend cannot be asked*; a configured-but-unreachable Jira was asked
   and failed. An empty list would be the fabricated verdict this adapter
   refuses everywhere.
4. `issue-view` returns one issue's body, and writes nothing to Jira.
5. **A plan citing `Issue: PLOT-412` reports it in `issues`**, and one citing
   `#228` still reports `228`. Measured today: the Jira form parses as `[]`.
6. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### Open Points

- [ ] Which CLI or API, and how it authenticates. Needs a real instance.
- [x] Does `Issue:` need to accept `PLOT-412`? **Yes — measured, it parses as
      `[]` today.** Now wave `Keyed` rather than a question.
