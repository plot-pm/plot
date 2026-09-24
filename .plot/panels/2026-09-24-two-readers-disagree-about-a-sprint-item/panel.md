# Panel moderation — two-readers-disagree-about-a-sprint-item

**Reconciliation: `unanimous amend` — estate, contracts.**

**Both jurors verified by execution rather than reading** — the standard a sibling panel set the same day, by rejecting a plan whose mechanism a five-line experiment disproved. Applied here, the plan's claims survived.

## What execution confirmed

The estate juror reproduced the disagreement on a scratch sprint rather than taking the plan's word:

```
plot-sprint-state.sh bare Committed   → exit 1, "names no Must"
plot-sprint-release.sh bare           → 2 must items, both "state":"open"
```

And measured the dedup trap exactly: **1 of 3 as shipped, 2 of 3 with the bracket made optional, 1 of 8 for eight bare Musts.** The plan's warning — that a test asserting only *"it commits"* passes over a still-broken parser — is correct, and the 1-of-8 figure is worse than the plan's own example suggested.

**No test covers a bare item.** All 15 relevant fixtures are `- [ ] [slug]`, and `sprint-members.test.ts:45` bakes the bracket into its own oracle. The parsers' suites could never have caught this.

## The amendment: the plan's title undercounts

The Open Question asked whether the board shares the parser. **It does not — it holds a third.** `board.ts:1148`:

```js
const SPRINT_MEMBER_LINE = /^- \[( |x)\] \[([^\]]+)\]/;
```

Verified by the moderator. Same mandatory bracket, own tier table, own dedup. **Three readers of one file format**, two of which drop bare items.

**A fix landing in the transition alone would be green and wrong**: the board would still drop them, and the corpus pair as first scoped never asks the third reader.

## Two non-blocking notes the moderator keeps

- `sprintMembers` already filters empty slugs, so nothing leaks downstream today — the defect is invisibility, not corruption.
- **The replacement dedup key must not be the item text.** Two identical bare lines would collapse and reproduce the defect in miniature. Now in the slice.

## The disposition

**Amend before building.** Every claim the plan makes survived execution. What changes: the slice covers both regexes, the corpus pair compares all three readers, the dedup key is constrained, and the Done-when adds the board rendering a bare-item sprint's members.
