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

Both issue operations exit 4 on Bitbucket, with an honest message:
*"bitbucket has no issue listing (bb exposes none)"*.

Exit 4 is the right refusal — **cannot be asked is not empty** — and the adapter
should keep refusing where it genuinely cannot ask. What this plan tests is
whether that is still true: the refusal is a statement about the `bb` CLI's
surface at the time it was written, not about Bitbucket.

## Design

### Establish first whether the refusal still holds

**This plan opens with a measurement, not an implementation.** If `bb` exposes
no issue command and the Bitbucket API's issue tracker is disabled on the repos
in question, then exit 4 is correct and this plan closes having confirmed it —
which is a real outcome, not a failure.

Two things to establish:

1. Does `bb` expose issues in any version? The message says it does not.
2. Is Bitbucket's issue tracker even enabled on a typical enterprise repo? Many
   teams on Bitbucket track in Jira and never turn it on — in which case the
   right answer is the *other* plan in this sprint, and this one is moot.

### If it can be asked, the contract is already fixed

`{number, title, url, createdAt}` per line, exit 3 when asked-and-failed. A
Bitbucket backend fills the shape the GitHub one defines.

### What must not happen

**Exit 4 must not become an empty list.** If Bitbucket cannot be asked, the
answer stays *cannot be asked*. Turning a refusal into `[]` would make the board
assert that a team has no tickets — the failure the story
`the-board-is-blank-where-it-matters` is named for.

## Waves

### Asked (Branch: feature/a-bitbucket-issue-is-a-ticket)

Establish whether Bitbucket issues can be listed at all; if so, `issue-list` and
`issue-view` answer for Bitbucket.

## Done when

1. **The measurement is recorded in this plan** — whether `bb` or the API can
   list issues, and whether the tracker is enabled on a real repo. This is the
   deliverable if the answer is no.
2. If it can be asked: `issue-list` emits the existing contract for Bitbucket.
3. **If it cannot: exit 4 stays, and the message says which was checked.** The
   plan closes as *confirmed unsupported*, with the evidence in it.
4. **No path returns an empty list for an unreachable host.** Exit 3 for asked
   and failed, exit 4 for cannot-ask, and never `[]` for either.
5. `pnpm test`, `pnpm run test:reconcile` green.

## Notes

### Interrogated 2026-08-26

One round. Moved from Must to Should in the sprint: a plan whose own first
Done-when is *establish whether this is possible*, and which says it may
correctly deliver nothing, is not what a Must reads like. Most Bitbucket teams
track in Jira and never enable the issue tracker, in which case the Jira plan is
the one that serves them. The measurement is still worth doing — it retires a
refusal that has stood since the adapter was written.

### This plan may correctly deliver nothing

Recorded deliberately. Its value is in settling a refusal that has stood since
the adapter was written, and an outcome of *the refusal is right, here is the
evidence* retires a question that would otherwise be re-asked. It is the
smallest Must in the sprint for exactly that reason.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Is this a Must?",
      "a": "No \u2014 demoted to Should; it may correctly deliver nothing and the Jira plan serves the same population",
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
