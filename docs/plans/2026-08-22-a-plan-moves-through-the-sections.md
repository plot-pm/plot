# A plan moves through the sections

> Approve it in WAITING ON YOU, and it appears in NOT STARTED where Start work
> takes it — three gaps in one path, none of which can be crossed today.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** working-shows-the-agent
- **Story:** plot-planning-model
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board's Approve action is reachable again: a Draft plan's row offers it
  in WAITING ON YOU, where the plan actually sits.
- NOT STARTED holds approved plans only — a Draft plan's shelved branch no
  longer appears there.
- An approved plan in NOT STARTED offers Start work, which dispatches it.

<!-- Board impact: the plan format, the template, the helper scripts and the
     docs/plans layout are all untouched. This is board-internal: two predicates
     in AgentList.tsx, one allowlist in fleet.ts, and the tests pinning them. -->

## Motivation

**One path, three breaks.** An operator reads a plan, approves it, and starts
the work. Every step of that is built and none of it connects:

The **Approve button cannot render for any row, ever**. Its predicate is

    canApprove = card && approve && isDraft(card) && row.waitingOn === 'you'

and `waitingOnFor` returns non-null only for `group === 'not-started'`, while
`classify` sends every Draft plan to `waiting-on-you`. The two conditions are
mutually exclusive by construction. Measured by execution rather than reading:

| group | `waitingOnFor(…, 'open', 'eligible', 'draft')` |
|---|---|
| `not-started` | `'click'` |
| `waiting-on-you` | `null` |
| every other | `null` |

`'you'` is returned for exactly one input — `not-started` + `deferred`, a
shelved branch — so the button additionally needs a Draft plan whose row is in
a section Draft plans are routed out of. The comment beside the predicate still
explains `'you'` as *"a Draft plan's FIRST wave"*, which was true until
`waitingOnFor` deleted that arm; its own comment there reads **"THE DRAFT ARM
IS GONE"**. The predicate was written against the old routing and never
followed it.

Nothing is missing behind the button: `/api/approve` exists, `plot-approve.sh`
performs the mechanical half, and the live board reports
`approve: {"available": true}`.

**NOT STARTED admits unapproved plans.** The section's own hint reads
*"approved — nobody has taken it"*, and its `open` path honours that. The
`deferred` path does not — line 2590's allowlist names `'draft'` explicitly:

    if (planPhase !== '' && planPhase !== 'approved' && planPhase !== 'draft')

so a Draft plan's shelved branch falls through to `not-started`, noted `last
commit 1 hour ago`. Measured:

    draft/deferred/eligible  -> not-started
    draft/deferred/blocked   -> not-started

**And with no plans arriving there, Start work has nothing to act on.** The
control exists on the eligible wave row and its `'click'` path already works;
it is unreachable for the same reason the section is empty of approved plans.

## Design

### Approach

**Approve keys on the section, not on `waitingOn`.** The row's placement is
already the answer: a Draft plan lands in `waiting-on-you` precisely because a
person must act on it. So the predicate becomes *the card is Draft and the row
is in `waiting-on-you`* — a fact that is true, rather than one that cannot be.
`waitingOn` stays what it is: an answer about NOT STARTED rows, which is the
one section it is derived for.

**The Draft allowlist loses `'draft'`, and the deferred path follows the open
path.** This overturns a pinned decision and says so: `fleet.test.ts:1122`
asserts the current behaviour, arguing a shelved branch of a plan under review
*"waits on a person twice over — approve the plan, un-shelve the branch"*.
That reasoning is sound about the WAIT and wrong about the SECTION. Both waits
are on the same person for the same next act, and NOT STARTED promises
work that can be taken now, which a Draft plan's branch cannot — no phase gate
would let it start. The row keeps saying *waiting on you*; it says it in the
section that means that. The test is rewritten with this reasoning recorded,
not deleted.

**Start work needs no new code** — it needs approved plans to reach the
section, which is what the first two waves deliver. The wave exists to prove
the path end to end rather than to build a control.

The estate has **no** draft-and-deferred branch today, so the middle change
alters nothing currently on screen. That makes it a safe moment to correct it
and a poor one to trust a screenshot: it needs a test, not a look.

### Open Questions

- [ ] Should an unrecognised plan phase reach NOT STARTED? Today `''` falls
      through by the compatibility rule (*absent is not a guess*) while every
      named-but-unknown phase goes to `done`. This plan leaves both as they are.

## Branches

### Reachable

- `bug/approve-is-reachable-from-waiting-on-you` — `canApprove` keys on the
  row's section rather than on a `waitingOn` value that cannot occur for a
  Draft row; the stale comment is corrected to describe the routing that
  exists. Tests: a Draft plan's row in `waiting-on-you` offers Approve; a
  non-Draft row in the same section does not; a Draft row offers it whether or
  not `waitingOn` is null; clicking it posts to `/api/approve`; the button is
  absent when `approve.available` is false.

### Approved only

- `bug/not-started-holds-approved-plans-only` — the deferred path stops
  admitting `draft`, matching the open path. Tests: `draft/deferred` lands in
  `waiting-on-you` for both verdicts; `approved/deferred` is unmoved in
  `not-started`; `delivered`/`released` stay in `done`; a pulse reporting no
  phase is unchanged. `fleet.test.ts:1122` is rewritten, with the superseded
  argument and the reason it is superseded recorded in the test body.

### Started

- `feature/an-approved-plan-offers-start-work` — prove the path end to end:
  approve a Draft plan and confirm its row reaches NOT STARTED carrying a
  working Start work. Tests: a browser test walking Draft → Approve → the row
  appears in NOT STARTED → Start work is offered and dispatches. No new
  control is built unless this test shows one missing.

## Notes

Found while investigating why the Approve action never appeared, reported
2026-08-22. Each of the three was measured by executing `waitingOnFor` and
`classify` directly rather than by reading them, because two of the three are
guarded by comments that describe behaviour the code no longer has.

The three are one path and one wave each, ordered by dependency: Approve must
work before a plan can reach NOT STARTED, and NOT STARTED must hold approved
plans before Start work has anything to act on. A flat list would let all
three start at once and let the third finish first, proving nothing.
