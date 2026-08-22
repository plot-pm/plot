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

- The board's Approve action is reachable again: a Draft plan's head offers it
  in WAITING ON YOU, and no branch row pretends to.
- NOT STARTED holds approved plans only — a Draft plan's shelved branch no
  longer appears there.
- An approved plan in NOT STARTED offers Start work, which dispatches it.

<!-- Board impact: the plan format, the template, the helper scripts and the
     docs/plans layout are all untouched. This is board-internal: two predicates
     in AgentList.tsx, one allowlist in fleet.ts, and the tests pinning them. -->

## Motivation

**One path, three breaks.** An operator reads a plan, approves it, and starts
the work. Every step of that is built and none of it connects:

**The branch-row Approve cannot render for any row, ever.** Its predicate is

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
performs the mechanical half, the live board reports
`approve: {"available": true}`, and twelve browser tests in
`approve.browser.test.ts` already walk the arm-then-post interaction. Every one
of them exercises the **card**, which is the split the code names as *one
board, two answers*: the card offers Approve and the row does not.

The row-level control cannot be repaired by narrowing its gate, which is why
this plan deletes it. A branch BLOCKED by an earlier wave is also in
`waiting-on-you` when its plan is Draft — measured, `open/blocked` + `draft` →
`waiting-on-you` — so gating on the section alone would put Approve back on a
row whose available act is not its own. That is the very defect the
`waitingOn === 'you'` clause was added to fix, and repeating it one gate later
is not progress.

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

**Approve belongs to the plan row, and only to it.** `plot-approve.sh` takes a
plan and no branch, the server reports `approve` per plan, and the row that
names the plan is the only honest place for the act. `PlanActions` already
gates on `isDraft(card)` alone and already hangs off the plan head — the
correct rule, correctly placed. What is broken is the OTHER site: `RowActions`
gates on `isDraft(card) && row.waitingOn === 'you'`, and that is unsatisfiable
for a Draft row, because `waitingOnFor` answers only for `not-started` while
`classify` routes every Draft plan to `waiting-on-you`.

So the fix is a removal, not a replacement. The branch-row Approve goes; the
plan-row Approve stays. That also settles a defect the removed clause was
defending against, and it is worth stating because it is the reason not to
simply swap `waitingOn === 'you'` for `group === 'waiting-on-you'`: a branch
BLOCKED by an earlier wave is in `waiting-on-you` too when its plan is Draft
(measured: `open/blocked` + `draft` → `waiting-on-you`), so that swap would put
an Approve button back on a row whose available act is not its own. A row-level
control for a plan-level act has no gate that makes it correct — which is the
argument for deleting it rather than narrowing it.

**The deferred allowlist loses `'draft'` in the same wave.** A Draft plan's
shelved branch reaches NOT STARTED because the deferred path's allowlist names
`'draft'` where the open path's does not. It is a two-line change with no
user-visible effect today — the estate holds no draft-and-deferred branch — so
it rides with the Approve fix rather than spending a branch, a PR and a review
cycle of its own. Its value is the rule, not the row: NOT STARTED promises
*approved — nobody has taken it*, and that must be true by construction rather
than by the luck of no such branch existing. A test pins it while it is cheap.

This overturns a pinned decision and says so. `fleet.test.ts:1122` asserts the
current behaviour, arguing a shelved branch of a plan under review *"waits on a
person twice over — approve the plan, un-shelve the branch"*. That is sound
about the WAIT and wrong about the SECTION: both waits are on the same person
for the same next act, and NOT STARTED promises work that can be taken now,
which a Draft plan's branch cannot — no phase gate would let it start. The row
keeps saying *waiting on you*; it says it in the section that means that. The
test is rewritten with the superseded argument and the reason it was superseded
recorded in its body, so the next reader sees a decision rather than a
flip-flop.

**Start work needs no new code** — it needs approved plans to reach the
section, which is what wave 1 delivers. Wave 2 exists to prove the path end to
end, and builds a control only if the walk finds one missing.

### Open Questions

- [ ] Should an unrecognised plan phase reach NOT STARTED? Today `''` falls
      through by the compatibility rule (*absent is not a guess*) while every
      named-but-unknown phase goes to `done`. This plan leaves both as they are.

## Branches

### Reachable

- `bug/approve-belongs-to-the-plan-row` — delete the branch-row Approve
  (`RowActions`), whose gate is unsatisfiable for a Draft row, and drop
  `'draft'` from the deferred allowlist in `classify` so NOT STARTED holds
  approved plans only. Tests: a Draft plan's head in `waiting-on-you` offers
  Approve; **no branch or wave row offers it**, including one blocked by an
  earlier wave; `draft/deferred` lands in `waiting-on-you` for both verdicts;
  `approved/deferred` is unmoved in `not-started`; `delivered`/`released` stay
  in `done`; a pulse reporting no phase is unchanged. `fleet.test.ts:1122` is
  rewritten, carrying the superseded argument and why it was superseded.

### Started

- `feature/an-approved-plan-offers-start-work` — prove the path end to end:
  approve a Draft plan and confirm its row reaches NOT STARTED carrying a
  working Start work. Tests: a browser test walking Draft → Approve → the row
  appears in NOT STARTED → Start work is offered and dispatches. No new
  control is built unless this walk shows one missing.

## Notes

Found while investigating why the Approve action never appeared, reported
2026-08-22. Each of the three was measured by executing `waitingOnFor` and
`classify` directly rather than by reading them, because two of the three are
guarded by comments that describe behaviour the code no longer has.

Interrogated 2026-08-22 (`/challenge-the-plan`), and the interrogation changed
the shape. The plan first proposed re-gating the branch-row Approve on
`group === 'waiting-on-you'`; probing the code showed that predicate
reintroduces the blocked-row defect its predecessor was written to prevent, and
that `PlanActions` already implements the correct rule on the correct row. So
wave 1 became a **deletion**, not a replacement.

Four decisions recorded: Approve lives only on the plan row; the deferred-
allowlist fix folds into wave 1 rather than earning its own branch, since it is
two lines with no visible effect today; `fleet.test.ts:1122` is rewritten
carrying both arguments rather than quietly flipped; and the end-to-end walk
stays a wave of its own, because a plan claiming a path works is only verified
by walking it.

Two waves, ordered by dependency: approved plans must reach NOT STARTED before
Start work has anything to act on.
