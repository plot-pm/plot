# My Bitbucket issues are in the inbox

> A team whose tickets are Bitbucket issues sees them in the board's inbox,
> instead of an empty section that reads as *you have no tickets*.

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

### Exit 4 must still exist, for the case that is still true

A repo whose Bitbucket **issue tracker is disabled** genuinely cannot be asked.
That is not an empty list, and turning it into one would make the board assert a
team has no tickets — the failure this story is named for.

So the refusal narrows rather than disappears: exit 4 when the tracker is off,
exit 3 when it is on and the call failed, and the contract otherwise.

## Waves

### Asked (Branch: feature/a-bitbucket-issue-is-a-ticket)

`issue-list` and `issue-view` answer for Bitbucket through `bb issue list` and
`bb issue view`, parsing their text output, pinning the `bb` version, and keeping
exit 4 for a repo whose tracker is disabled.

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
5. **The two stale messages are gone.** `plot-host.sh:603` and `:638` claim
   *"bb exposes none"*, which is false as of `bb` 0.6.0.
6. `pnpm test`, `pnpm run test:reconcile` green.

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

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
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
