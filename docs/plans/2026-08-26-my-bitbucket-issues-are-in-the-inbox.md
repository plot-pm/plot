# My Bitbucket issues are in the inbox

> A team whose tickets are Bitbucket issues sees them in the board's inbox,
> instead of an empty section that reads as *you have no tickets*.

## Status

- **Phase:** Released
- **Type:** feature
- **Sprint:** the-board-serves-an-enterprise-stack
- **Issue:** <!-- optional -->
- **Story:** the-board-is-blank-where-it-matters
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** 2026-08-28
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-26, Jan Wloka, `feature/a-bitbucket-issue-is-a-ticket`

## Changelog

- `issue-list` and `issue-view` answer for Bitbucket instead of exiting 4, so a
  team whose tickets live there gets the board's inbox.

## Motivation

Both issue operations exit 4 on Bitbucket, with a message that **is now false**:

> `plot-host.sh:603` — *"bitbucket has no issue listing (bb exposes none)"*
> `plot-host.sh:638` — *"bitbucket has no issue read (bb exposes none)"*

**Measured 2026-08-26 against the installed CLI:**

```
$ bb --version
bb version 0.6.0

$ bb issue --help
Available Commands:
  list        List and filter issues in this repository
  view        View a issue
  create · update · delete · comment
```

`bb` gained issue support. The refusal was correct when written — a statement
about the CLI's surface at that time — and it is now simply out of date, so a
Bitbucket team with its tracker enabled sees an empty inbox because Plot stopped
asking a year of releases ago.

### The real constraint is the output format, not the capability

`bb issue list` exposes `--state` and `--repository` and **no `--json`**. So the
contract — `{number, title, url, createdAt}` per line — must be filled by parsing
text.

That is a different and smaller problem than the plan originally faced, and it
has a known shape in this repo: a parse of someone else's output format, which
silently mis-reads when the format changes.

## Design

### Parse the text, and pin the version it was written against

Parse `bb issue list`'s output, and **assert the `bb` version the parse targets**.
A format change then fails loudly instead of mis-reading a column.

This is the same discipline the sibling plan `the-pr-list-join-is-silently`
arrived at for the page cap: a constant that is right today and silently wrong
after an upstream release is the dangerous kind. There, the fix was to compare
against the requested limit rather than hardcode 50; here, the parse cannot avoid
depending on a format, so it declares the dependency instead.

**The REST API was considered and rejected for now.** It gives structured output
and no version coupling — the Jira plan chose it for exactly that — but Jira has
no CLI in this repo while Bitbucket does, already installed and already
authenticated for every other operation. A second auth path beside `bb`'s, for
one operation, is not worth avoiding one parse.

### Exit 4 must still exist, but the exit code cannot decide it

A repo whose Bitbucket **issue tracker is disabled** genuinely cannot be asked.
That is not an empty list, and turning it into one would make the board assert a
team has no tickets — the failure this story is named for.

So the refusal narrows rather than disappears: exit 4 when the tracker is off,
exit 3 when it is on and the call failed, and the contract otherwise.

**`bb`'s own exit code cannot make that split.** Measured 2026-08-26: every
failure exits **1**, including *"Are you sure this is a bitbucket repo?"*. So the
adapter matches `bb`'s error TEXT to choose exit 4, and **defaults to exit 3
whenever it does not recognise the wording**.

That default is the whole safety of the scheme. Exit 4 means *this host cannot
be asked* and the board renders a section that stays silent; exit 3 means *the
call failed* and the board says so. Guessing 4 from an unrecognised message
would convert a broken call into a confident "you have no tickets" — the exact
failure the story is named for. Guessing 3 merely reports an error, so the
unrecognised case must fall that way.

The version pin (above) is what keeps this honest rather than fragile: the text
match is declared against `bb 0.6.0`, and a version it does not recognise fails
loudly instead of matching wording that may have moved.

### Three traps in `bb`'s output that the GitHub arm's shape would walk into

Measured against `bb 0.6.0` on 2026-08-26. Each one is invisible while it works:

- **`bb` writes its errors to STDOUT, colour-coded**, not to stderr. The GitHub
  arm redirects stderr to a temp file and treats stdout as data; copying that
  shape would parse an ANSI-escaped error message as an issue title.
- **`bb issue list` has no `--limit`.** The GitHub arm passes `--limit` straight
  through to the CLI. Bitbucket has nowhere to put it, so the adapter must
  honour the caller's limit itself, after parsing. Silently dropping it breaks
  the contract for a caller that asked for a bound.
- **`bb issue view` prints no URL and no `createdAt`.** `--web` opens a browser
  rather than printing one. The contract needs `url`, so it is constructed from
  the repo slug and the issue number — a second thing the version pin covers.

### The request budget stops being free, and this branch owns that

`fleet.ts:108` documents the Bitbucket refresh cost and counts **only**
`pr-list`, justified by an explicit claim:

> *"on Bitbucket both cost ZERO requests: `bb` exposes no issue listing
> (`plot-host.sh` exits 4 before touching the network)"*

This plan makes that false. The moment `issue-list` reaches the network,
`PR_REQUESTS_PER_REFRESH.bitbucket = 3` under-counts every refresh.

The stake is already measured and on record in that same comment: a board left
open a working day made ~1400 Bitbucket requests and hit `HTTP 429 — Rate limit
for this resource has been exceeded` **account-wide**, with every `bb` call from
the operator's own shell failing too.

So the constant and its comment are updated by **this** branch. A branch that
makes calls real owns their cost; deferring it would ship a board whose
documented request budget is knowably wrong, against a limit that has already
been hit once.

## Slices

### Asked (Branch: feature/a-bitbucket-issue-is-a-ticket, PR: #449)

`issue-list` and `issue-view` answer for Bitbucket through `bb issue list` and
`bb issue view`, parsing their text output, pinning the `bb` version, keeping
exit 4 for a repo whose tracker is disabled, and updating the fleet's Bitbucket
request budget to count the calls that are now real.

## Done when

1. **`issue-list` emits the existing contract for Bitbucket** —
   `{number,title,url,createdAt}` per line, the same shape GitHub produces.
2. **The parse pins the `bb` version it was written against**, and a version it
   does not recognise fails loudly rather than mis-reading columns. Measured
   against `bb 0.6.0`.
3. **A repo whose issue tracker is DISABLED still exits 4.** That case is still
   *cannot be asked*, and turning it into an empty list would make the board
   assert a team has no tickets.
4. **A call that fails on an enabled tracker exits 3**, not 4 and not `[]`. Three
   distinct answers, because a consumer must be able to tell them apart.
5. **An UNRECOGNISED `bb` error exits 3, never 4.** This is the assertion a
   naive implementation passes without: mapping any failure to 4 satisfies
   item 3 and turns every broken call into a confident "no tickets".
6. **`bb`'s error text on STDOUT is never parsed as an issue.** `bb` prints
   errors to stdout, so a stdout-is-data implementation emits an ANSI-escaped
   error as a title and item 1 still passes.
7. **`issue-list --limit N` returns at most N.** `bb issue list` has no
   `--limit`, so the adapter truncates after parsing; passing the flag through
   is not available and dropping it silently breaks the caller's bound.
8. **The two stale messages are gone.** `plot-host.sh:603` and `:638` claim
   *"bb exposes none"*, which is false as of `bb` 0.6.0.
9. **The fleet's Bitbucket request budget counts the issue calls**, and
   `fleet.ts:108`'s "cost ZERO requests" comment no longer says something
   untrue. The measured 429 is why this rides with the change rather than after.
10. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.
## Approval

- **Assignee:** Jan Wloka

## Notes

### Interrogated 2026-08-26

One round. Moved from Must to Should in the sprint: a plan whose own first
Done-when is *establish whether this is possible*, and which says it may
correctly deliver nothing, is not what a Must reads like. Most Bitbucket teams
track in Jira and never enable the issue tracker, in which case the Jira plan is
the one that serves them. The measurement is still worth doing — it retires a
refusal that has stood since the adapter was written.

### It nearly closed as "the refusal was right"

Round 1 framed this plan as possibly delivering nothing: its first Done-when was
a measurement of whether `bb` could list issues at all, and it was demoted from
Must to Should on the strength of that.

**Round 2 ran the measurement in thirty seconds and it came back the other way.**
`bb` 0.6.0 has `issue list` and `issue view`. The plan's whole premise — and the
adapter's message — was inherited from a claim nobody had re-tested.

That is why it is back to Must: the demotion argued it might be moot, and it is
not. A Bitbucket team with its tracker on is blocked today by a refusal that
stopped being true.

The lesson is small and repeatable: **a plan that opens with "establish whether
X is possible" should run that check during interrogation, not during
implementation.** It cost half a minute and changed the tier, the premise, the
design and the Done-when list.

### Interrogated again 2026-08-26

Round two, and it falsified the plan.

`bb --version` and `bb issue --help` showed `list` and `view` both present, so
`plot-host.sh:603` and `:638` are stale rather than principled. The real
constraint turned out to be narrower: `bb issue list` has no `--json`, so the
contract must be filled by parsing text — and the parse pins the `bb` version it
targets, so an upstream format change fails loudly rather than mis-reading a
column. Same discipline the sibling plan reached for the 50-PR page cap.

The REST API was considered and rejected here, unlike in the Jira plan: Jira has
no CLI in this repo, Bitbucket has one already installed and authenticated for
every other operation, and a second auth path for one operation is not worth
avoiding one parse.

Exit 4 narrows rather than disappears — a repo with its tracker DISABLED still
cannot be asked, and that is not an empty list.

### Interrogated a third time 2026-08-26

Round three read `bb`'s own help output and the adapter's consumers rather than
re-reasoning about them, and found three measurements that change the
implementation and one that changes its scope.

**`bb` reports failure on stdout, colour-coded, and exits 1 for everything** —
including *"Are you sure this is a bitbucket repo?"*. Two consequences: the
GitHub arm's stdout-is-data shape would parse an error message as an issue
title, and the exit code cannot separate *tracker disabled* from *call failed*.
The adapter therefore matches `bb`'s error text and **defaults to exit 3 when it
does not recognise the wording** — guessing 4 would turn a broken call into a
confident "you have no tickets", which is the failure the story is named for.

**`bb issue list` has no `--limit` and `bb issue view` prints no URL or
`createdAt`**, so the adapter honours the caller's limit itself and constructs
the URL. Both are things the version pin now covers.

**And the calls stop being free.** `fleet.ts:108` counts only `pr-list` for
Bitbucket, on the stated grounds that `issue-list` *"costs ZERO requests"* by
exiting 4 before the network. That comment becomes false here. It was kept in
scope rather than deferred: the same comment records a measured account-wide
`HTTP 429` from a board left open one working day, so shipping a knowingly wrong
budget against an already-hit limit is not a follow-up.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {
      "q": "Is this a Must?",
      "a": "No \u2014 demoted to Should; it may correctly deliver nothing and the Jira plan serves the same population",
      "category": "tradeOffs"
    },
    {
      "q": "Can bb list issues at all?",
      "a": "YES \u2014 bb 0.6.0 has issue list and issue view; the adapter's 'bb exposes none' is stale",
      "category": "technical"
    },
    {
      "q": "No --json flag \u2014 parse text or use the REST API?",
      "a": "Parse the text and pin the bb version; Bitbucket already has an installed, authenticated CLI, unlike Jira",
      "category": "technical"
    },
    {
      "q": "Does the tier change now the premise is dead?",
      "a": "Back to Must \u2014 the demotion argued it might be moot, and it is not",
      "category": "tradeOffs"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": false
    },
    "domain": false,
    "ux": {
      "happyPath": false,
      "edgeCases": false,
      "errors": false,
      "accessibility": false
    },
    "nonFunctional": {
      "security": false,
      "performance": true,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
