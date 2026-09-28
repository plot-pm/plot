# A row is owned by more than its PR

> *Only my work* hides a row only where ownership answers `theirs`. The rule knows two kinds — `pr` and `agent` — and answers `unknown` for the rest, which `isMine` keeps. So the filter removes other people's PRs and other agents' rows, and nothing else.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1046
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- *Only my work* hides branches, plans and builds that belong to someone else, not just their PRs.

Board impact: the filter starts removing rows. No payload change — the facts it needs are already on the wire.

## Motivation

`packages/domain/src/rules/ownership.ts:77`:

```ts
export const ownership = (row: OwnedRow, reader: Reader): Ownership => {
  switch (row.kind) {
    case 'pr':    return prOwnership(row.author, reader);
    case 'agent': return agentOwnership(row.identity, row.state);
    default:      return 'unknown';
  }
};
```

`isMine` is `ownership(...) !== 'theirs'`, so **`unknown` is kept**. The mapping seals it — `app/lib/agent-rows/mine-filter.ts:86`:

```ts
row.pr ? { kind: 'pr', author: row.pr.author } : { kind: 'other' };
```

**A row without a PR is `other`, always.** Measured: the only three kinds in the row code are `agent`, `pr`, `other`.

Against what the operator asked for:

| population | today |
|---|---|
| my PRs | ✅ by `pr.author` |
| PRs **assigned** to me | ❌ `assignee` never read |
| my branches | ❌ no branch ownership exists |
| plans on main or my branches | ❌ falls through |
| builds of main/develop or my branches | ❌ falls through |

One and a half of five. On a board that is mostly plans and branches, turning the filter on changes almost nothing — which reads as broken.

### The facts are already on the wire

`contract/schema.ts` carries `assignee` (`:70`, `:403`), `branches` (`:71`, `:88`) and `author` (`:310`). Nothing new is fetched; the mapping discards them before the rule sees them.

## Design

### The rule

**A row is classified by whatever ownership fact it carries, and `unknown` stays permissive.**

`unknown` keeping the row is correct and is not the defect — a filter must never hide work it cannot classify. **That is also why the gaps are invisible**, and it means every new kind needs a deliberate answer rather than a default.

### Assigned PRs first, and possibly alone

`prOwnership` reads `author`. `assignee` is in the schema and unread. That is the smallest change, needs no new concept, and covers a population the operator named explicitly.

**The slice may stop there and still be worth shipping.** The rest each need a decision:

- **Branches.** Owned by what — the last committer, the claiming agent's identity, or a naming convention? This estate's branch rows carry no author of their own, so this is a new fact, not an unread one.
- **Plans.** *On main or my branches* means a plan's ownership derives from where its slices live. That is a join the row may not have, and the plan's `assignee` field may be the better answer.
- **Builds.** Same shape as plans: ownership comes from the branch the build ran on.

**Take them in that order and stop where the answer stops being obvious.** A guess encoded here hides rows a person needed.

### What this does NOT do

- **It does not change what `unknown` means.** Widening it to hide would be worse than the bug.
- **It does not add a fact to the payload.** If a population needs one, that is its own plan.
- **It does not change `agentOwnership`.** Agent rows already work.

## Done when

- **A PR assigned to the reader but authored by someone else is kept**, and one assigned to somebody else is hidden — the smallest real win, asserted both ways.
- Every population the slice does **not** classify still answers `unknown` and is **kept**, asserted explicitly so a later reader cannot mistake silence for coverage.
- The PR's description says which of the five populations it covered and which it left, with the reason each was left.
- No new field is added to the payload; the PR names the schema line each fact came from.
- `isMine`'s permissive default is unchanged, asserted by a test naming it.

## Slices

### A row is owned by more than its PR (Branch: bug/a-row-is-owned-by-more-than-its-pr)

Read `assignee` in `prOwnership`, then take branches, plans and builds in order, stopping where ownership stops being obvious.

## Notes

Reported by the operator as *"Only my work seems not to work correctly"*, with the four populations named. Tracing it took two greps — the rule's `switch` and the mapping's ternary — and both are explicit about handling two kinds.

**The permissive default is good design that hid its own gaps.** Nothing failed, nothing logged, and the filter simply did less than its name promises.
