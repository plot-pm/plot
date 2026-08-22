## Implementation brief — a-folded-plan-says-what-it-hides (wave 1: Aggregated)

- **Plan (canonical):** `docs/plans/2026-08-22-a-folded-plan-says-what-it-hides.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, plan-PR #307 merged
- **Branch:** `feature/a-folded-plan-says-what-it-hides` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

The plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

A folded plan head shows its phase and nothing about the branches beneath it,
so a collapsed group gives a reader no reason to open it even when a PR under
it is red. Reported from the live board as *"Wo ist 304?"* — PR 304 was there
the whole time, under a plan row reading `PLAN a-wave-is-a-thing-… (2)
Discovery 0m`, with `checks failing` two rows down inside the fold.

Fold the branches' PR states into one worst-case word on the plan head, beside
the phase, with a count where more than one branch is affected. The plan is
canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Fold INSIDE `PlanRow`, never at its call sites.** This is the one that will
cost you if you get it wrong. `PlanRow` has TWO call sites and they are
asymmetric: the plan-group path folds `group.rows` for `active` and `marked`;
the `planHeads` path — the plan head drawn over WAVE groups — passes neither.
An aggregate computed at the call site the way `marked` is computed would
appear on one kind of plan head and not the other, and a folded wave-grouped
plan is exactly the case this branch exists for. Adding `marked` to one site
and not the other already cost a fix on 2026-08-22 that rendered nothing and
read as a broken predicate. `PlanRow` receives `group`; derive it there.

**Precedence, decided:** `conflicts > failing > pending > none/unknown > green`.
`conflicts` outranks `failing` for the reason `rowKind` already gives it
precedence — no PR resolves a conflict, so the errand is a rebase and it is the
reader's.

**`pending` is included, rendered dimmer** than the two actionable states. A
running build is not an errand, but *a machine is working here* is worth a
folded reader knowing; dimmer marks the difference between *something is
happening* and *do something*.

**The aggregate STAYS when the group is expanded.** A long group scrolls its
head off screen either way, so hiding it removes the fact exactly when the
reader has scrolled past the rows that would restate it. It also keeps the rule
free of expand-dependent behaviour, which is how the change mark already works.

**The phase keeps slot 5 and is never replaced.** `tupleFromPlan` puts the
plan's phase there deliberately — 71 branch rows once printed their plan's
phase, *"a fact about the plan on a row about something else"*, and that defect
must not be re-opened from the other direction.

**Green plans get no badge.** Nothing to act on, and a badge on every row is a
badge nobody reads.

**Do not reach past PR state.** Worker state, staleness and stuck-ness are
separate facts with their own marks. Folding them into one word rebuilds the
one-label-many-states defect the contract names.

**Carried over unchanged:** symbol AND word — the aggregate renders as a WORD in
the tone the single-row plan already uses for that state. Colour alone fails the
same test `StuckCell` records failing.

### Done when

The plan's changelog is the specification. Lift these assertions in particular,
because a naive implementation passes without them:

- A folded plan over a red branch says so **on BOTH plan-head paths** — the
  plan-group one and the `planHeads` one over wave groups. This is the
  asymmetry above; a test on one path only will pass while half the boards stay
  broken.
- `conflicts` wins over `failing` on a plan carrying both.
- `pending` renders in the dimmer tone, not the actionable one.
- The aggregate is still shown when the group is expanded.
- The phase remains in slot 5 and is never replaced.
- A count appears only where more than one branch is affected.
- A folded plan over green branches says only its phase.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm
build:board` committed, and a changeset with its `bumps:` block. Never edit
versions by hand. Use `trash`, not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section
on `main` as soon as the PR exists — check `git branch --show-current` is
`main` before that edit. The arrow form is the only one the parser reads:
`(#307)` parses as nothing. Push the first real commit as soon as it exists,
and again immediately after any rebase.

### Scope guard

This branch owns `packages/board/src/app/components/AgentList.tsx` (the
`PlanRow` fold) and its tests, plus a browser test for the two plan-head paths.
No server change: `AgentRow.pr.state` is already on the wire, which is why this
is a client-side projection and nothing more.

`AgentList.tsx` is the busiest file in this repo and was rewritten twice on
2026-08-22. Rebase before opening the PR. On a conflict in `board-server.mjs`
do NOT read the diff — take either side, run `pnpm build:board`, commit.

Other branches in flight that touch this file: none dispatched at the time of
writing. Verify with `git worktree list` before you start.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
