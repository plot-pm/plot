# An eligible wave can be started

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** #227
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-27, Jan Wloka, `bug/an-eligible-wave-can-be-started`

## Changelog

A wave reads `eligible` only where a dispatch would actually take it; a wave held
by its plan's phase says that instead.

## Motivation

### The measurement

Reported by an operator on 2026-08-27, looking at a plan row: *"how can a plan be
eligible and I cannot start the wave?"*

Measured against the live pulse the same day — every one-wave plan in
`not-started`:

| plan | wave | verdict | plan phase |
|---|---|---|---|
| a-ticket-becomes-a-plan-or-a-story | Routed | eligible | **Draft** |
| a-dead-fetch-is-not-a-slow-one | Bounded | eligible | **Draft** |
| a-reaped-worktree-takes-its-manifest | Cleared | eligible | **Draft** |
| the-board-says-how-old-its-plans-are | Aged | eligible | **Draft** |
| a-stopped-worker-can-be-restarted | Restarted | eligible | **Draft** |
| the-board-reads-the-ref-not-the-checkout | Read | eligible | **Draft** |

**Six of six.** Not an edge case — on that board, *every* wave wearing the word
was unstartable.

### It is wrong in a second direction, measured on a live wave

Re-measured 2026-08-27, after the first six: **seven** one-wave plans now read
`eligible`, and the seventh is not a Draft.

`the-board-reads-the-ref-not-the-checkout` is **Approved**, its branch holds a
ref on origin, and a worker is **running on it** (pid 22266). Its wave reads:

```json
{"plan":"the-board-reads-the-ref-not-the-checkout","name":"Read",
 "verdict":"eligible","section":"not-started","complete":false}
```

So the word is wrong in two directions, not one: it says `eligible` where the
plan is **unapproved** (six cases) and where the work is **already taken and
running** (one case). Both are the same defect — the verdict describes wave
ORDERING, and the reader takes it to describe startability — and a fix that
covers only approval leaves a live counter-example on the board.

### The word answers a different question than the reader asks

`plot-fleet-scan.sh:2821` computes the verdict from wave ORDERING alone:

```bash
elif [ "$prior_ok" -eq 1 ]; then verdict="eligible"
```

`prior_ok` means every non-deferred branch in every earlier wave has merged. The
eligibility computation reads no phase — grepping the scan for a phase test
anywhere near `eligible` or `approv` returns nothing.

`plot-dispatch.sh:424` refuses on exactly the fact the scan never consulted:

```
plot-dispatch: plan '<slug>' is still Draft on <ref> — nothing may be dispatched.
```

So both are correct and they are answering different questions. `eligible` means
*no earlier wave blocks this one*. The reader takes it to mean *I can start
this*. Those coincide only for an approved plan.

### The board already knows, one row up

This is not a fact the board lacks. `packages/board/src/contract/schema.ts:1077`
defines it:

```ts
export const DRAFT_PLAN_NOTE = 'plan not approved yet — still in review';
```

and `fleet.ts:3000` and `:3273` already route a Draft plan's rows to
`waiting-on-you` carrying that note.

**So one row states both truths at once**: its note says the plan is not approved
yet, and its verdict slot says `eligible`. The information needed to reconcile
them is present and simply does not reach the verdict.

### Why it surfaced as a question about badge placement

The operator's first reading was that the badge sat in the wrong place — that
`eligible` belonged to the wave row below rather than the plan row, and should
show only when the group was collapsed.

The placement is deliberate and is not the defect.
`rows.tsx` says so where the verdict renders:

> A ONE-WAVE PLAN shows its sole wave's VERDICT here instead of the PR fold [...]
> The verdict outranks the prFold: `eligible`/`blocked`/`complete` says what to
> do next

and `AgentList.tsx:1298`:

> WAVE ROWS NAME THEIR WAVES, however many waves the plan has. [...] **the
> verdict migrated to the plan row, the name did not.**

A one-wave plan deliberately splits the wave across two rows: the plan row
carries the verdict, the wave row carries the name. That reads as a misplaced
badge, which is why the report was about position. **The word being wrong is
what made its position look wrong.** Moving it would have preserved the defect
in a new location.

## Design

### `eligible` becomes a claim about startability

The verdict a reader acts on must mean *a dispatch would take this*. A wave whose
plan is not approved gets its own word, because the reader's next action differs
completely: approve the plan, not start the work.

`plot-fleet-scan.sh` already reads the plan file — it parses phase for the
terminal grouping — so the fact is in hand at the point the verdict is computed.
No new read, no host call.

### Not chosen: leave the scan alone and fix it in the board

Tempting, since `fleet.ts` already has `DRAFT_PLAN_NOTE` and could suppress the
word client-side. Rejected: `--next` and `plot-dispatch.sh` consume the same
verdict, and a word that means one thing to the board and another to the
dispatcher is the disagreement this plan removes rather than relocates. The scan
is where the verdict is defined, so it is where the definition is fixed.

### Not chosen: call it `blocked`

`blocked` already means *an earlier wave has not landed* — a fact about the
plan's own ordering that resolves by merging work. A Draft plan resolves by a
person approving it. Folding both into one word rebuilds the ambiguity one level
down, and `blocked by Shaped — 1 branch` would become a sentence the row cannot
truthfully complete.

### Not chosen: move the badge to the wave row

The operator's first hypothesis, and the design is against it for a stated
reason: a one-wave plan's wave row is not suppressed, it carries the NAME, and
the verdict was moved up deliberately so the plan row says what to do next.
Moving it back would restore a duplicate verdict and leave the wrong word intact.

### `eligible` means unapproved AND unclaimed

One word, one meaning: **a dispatch would take this**. Both wrongnesses above are
the same defect, and half a fix ships with a visible case it does not fix.

**The claim fact is not derived here.** `a-claimed-branch-is-not-startable`
(Draft) already owns it: its `Seen` wave puts *whether a branch has a ref holding
it* into the pulse, derived by the scan from refs it already walks. Re-deriving
it in this plan would create a second answer to one question — the duplication
this codebase keeps removing.

That makes an ORDERING, stated in the waves below: the approval half depends on
nothing and can ship immediately; the claim half consumes `Seen` and waits for
it.

### The startability PHRASE stays separate

`PlanStartabilitySchema` carries `someone is on it` and its siblings — prose for
a plan row, a different surface from a wave's verdict. This plan changes the
VERDICT and leaves that phrase alone. Where both end up saying a branch is taken,
they are agreeing rather than duplicating: one is a word in a status slot, the
other a sentence on a plan head.

## Waves

### Worded (Branch: bug/an-eligible-wave-can-be-started, PR: #470)

`plot-fleet-scan.sh` distinguishes a wave whose plan is not approved from one a
dispatch would take, and the board renders the distinction in the verdict slot.
Depends on nothing.

### Taken (Branch: bug/an-eligible-wave-is-unclaimed) <!-- deferred: waits on the Seen wave of a-claimed-branch-is-not-startable to publish the git claim fact 2026-08-27 — undefer when that lands -->

The verdict also accounts for a branch already claimed, reading the claim fact
the pulse carries rather than re-deriving it. **Depends on the `Seen` wave of
`a-claimed-branch-is-not-startable`** — on that wave landing, not on its plan
being approved. Until the pulse carries the claim, there is nothing here to
consume.

## Done when

1. **A wave of a Draft plan does not read `eligible`.** Asserted on the measured
   shape — six of six one-wave plans on the live board.
2. **A wave of an approved plan still reads `eligible`.** The ordinary case must
   not regress: a fix that makes every wave unstartable passes item 1.
3. **`--next` does not offer a wave whose plan is unapproved.** The scan's
   verdict and its startability answer must agree, or the board and the
   dispatcher are back to disagreeing through a different field.
4. **`plot-dispatch.sh` is unchanged.** Its phase gate stays the enforcement;
   this plan stops the fleet describing work that gate will refuse.
5. **The word is not `blocked`.** Asserted on the rendered string, because
   reusing `blocked` is the tempting fix and it destroys the distinction that
   word already carries.
6. **The `someone is on it` startability phrase is untouched.** A different
   SURFACE — prose on a plan head, not a verdict word — and out of scope.
6b. **A wave whose branch is claimed and running does not read `eligible`.**
   The measured second case: Approved plan, ref on origin, live worker, wave
   still `eligible`. Belongs to the `Taken` wave.
6c. **The claim fact is READ, not re-derived.** Asserted by the absence of a
   second ref walk: `a-claimed-branch-is-not-startable`'s `Seen` wave publishes
   it, and two answers to one question is the duplication this repo removes.
7. **No host call is added to the scan's path.** The phase is already parsed;
   asserted by the existing no-network test.
8. `pnpm run validate`, `pnpm run test:reconcile`, `pnpm run test:board` green;
   artifact rebuilt and committed.

## Notes

### It resolves ticket #227

Open since 2026-08-19. The ticket reads *"Board showed a plan as eligible that
could not be started"* — the same defect, reported eight days before the
measurement above put six instances of it on one screen.

### The honest-verdict pattern, again

Plot's rule everywhere else is that absent is not false and a partial answer says
so. This is the same rule applied to a verdict: `eligible` was true about wave
ordering and false about startability, and the row had no way to say which it
meant.

The board already held both halves — `DRAFT_PLAN_NOTE` in the note, `eligible` in
the verdict — and printed them side by side without reconciling them. A row that
contradicts itself is the failure this sprint is named for.

### Interrogated 2026-08-27

Two questions; the first widened the plan and the second held its shape.

**The word is wrong in two directions, not one.** Re-measuring turned up a
seventh one-wave plan reading `eligible` — and unlike the first six it is
Approved, claimed on origin, and carrying a live worker (pid 22266). Scoping the
claim case out, as the first draft did, would have shipped the fix with a visible
counter-example still on the board.

So `eligible` now means unapproved AND unclaimed: one word, one meaning, *a
dispatch would take this*.

**That created a dependency rather than a collision.**
`a-claimed-branch-is-not-startable` already owns the claim fact — its `Seen` wave
puts it into the pulse. This plan consumes it instead of re-deriving it, which
splits the work into two waves: `Worded` (approval, depends on nothing, ships
now) and `Taken` (claim, waits for `Seen`).

**`not-started` stays the section.** The heading is about WORK — a wave with no
merged branch has not started, which is true of all seven. The verdict inside the
row is what says whether a reader can act, and that is exactly what this plan
fixes. No section routing changes, which keeps the diff on the word.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "A claimed, running, Approved wave also reads eligible \u2014 widen the scope?", "a": "Widen: eligible means unapproved AND unclaimed; consume the claim fact from a-claimed-branch-is-not-startable's Seen wave rather than re-deriving it", "category": "technical"},
    {"q": "Should unapproved waves stay in not-started?", "a": "Yes \u2014 the section is about work, the verdict about actionability; no section routing changes", "category": "ux"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": true, "edgeCases": true, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

### The cross-plan dependency was a rule, and the fleet ignored it

Recorded 2026-08-27, minutes after `Worded` merged as #470: the fleet reported
`Taken` **eligible** and offered `bug/an-eligible-wave-is-unclaimed` for
dispatch.

The fleet was right and this plan was wrong. Wave ordering is **intra-plan** — a
wave becomes eligible when every earlier wave *of its own plan* has landed, and
`Worded` had. Plot has no mechanism for a wave to depend on another PLAN's wave,
and the dependency was written here in prose: *"Depends on the `Seen` wave of
`a-claimed-branch-is-not-startable`."*

Prose is a rule. The fleet reads `<!-- deferred: -->`, which is a gate. With
auto-dispatch on, a worker would have started on a wave whose input does not
exist.

So `Taken` now carries the annotation, naming what it waits for and how to
release it. The wave is not abandoned — `deferred:` is exactly the reversible
form for *not yet*, and `/plot-reconcile` reads it as deliberate rather than as a
dead worker.

**What it waits for is specific.** The pulse already carries a `claimed` field
(`plot-fleet-scan.sh:3001`, `schema.ts:59`), and it is not this: the contract
calls it *"a REFLECTION of a claim, not the claim itself — a worker takes a
branch by pushing its ref, then writes this annotation for humans and the board.
Where the two disagree, git wins."* `Taken` needs the git fact, which is what
`Seen` publishes.
