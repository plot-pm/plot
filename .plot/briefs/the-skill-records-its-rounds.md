## Implementation brief — an-interrogation-leaves-a-record (wave 1: Written)

- **Plan (canonical):** `docs/plans/2026-08-22-an-interrogation-leaves-a-record.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `bug/the-skill-records-its-rounds` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Wave 2 (`docs/the-six-say-they-were-challenged`) back-fills six existing plans
by hand and does not wait on this — but this wave is what stops the count
lapsing again.

### What to build

`challenge-the-plan/SKILL.md` writes a `CHALLENGE-THE-PLAN-METADATA` block into
the plan file after each round, so `plot-plan-meta.sh` can report `rounds` and
the board can render its badge.

Everything downstream already exists and works:

    plot-plan-meta.sh   parses the block, omits `rounds` when absent
    PlanMetaSchema      carries it, deliberately optional
    PlanCard.tsx:288    renders `1 round` / `N rounds` as a neutral badge

What is missing is only the writer. Measured 2026-08-22: 24 of 90 plans report a
count, **every one written between 08-15 and 08-17**, none since — and on the
live board all 24 badges sit in **Released**, none in any open column. The badge
is visible only where it can no longer inform a decision.

### The decisions the plan settles — do not re-derive them

**The block's shape is specified, not open.** `/plot:challenge-the-plan` — the
slash COMMAND — documents it in full: `round`, `questionHistory`,
`deferredItems`, `categoriesCovered`, wrapped in
`<!-- CHALLENGE-THE-PLAN-METADATA … END-CHALLENGE-THE-PLAN-METADATA -->`. Take
that shape as given. `plot-plan-meta.sh` already parses it and 24 plans prove it.

**The skill is not missing the CONCEPT of a round — only the write.** It says
*round* nine times and is structured as a loop over them (*"4 questions per
round"*, *"Round 2+: Adaptive Deepening"*, *"After each round, append new
deferred items"*). So this is a write step inside a loop that exists, not a new
mechanism. Put it where the loop already ends.

**One specification, two entrances.** The command and the skill must not both
carry the block's description — that is the drift `/plot-approve` warns about
with its own two entrances. The skill is where the work happens, so the skill
carries the instruction and the command points at it.

**Write the block even when a round finds nothing.** That is the case the
optional field exists to distinguish: `0 rounds` means *interrogated and found
nothing*, absent means *nobody looked*, and the contract is explicit that these
"want opposite reactions from a reader". A round that changes no decision must
still increment, or a plan reads as unexamined for having survived scrutiny.

**Do NOT touch `plot-plan-meta.sh`.** It reads the block correctly today. A
parser change here would be fixing the half that works.

**Do NOT default `rounds` to 0 anywhere.** Absent and zero must stay different
all the way through.

### Done when

The plan's changelog is the specification. Lift these in particular, because a
naive implementation passes without them:

- A plan interrogated once reports `rounds: 1` through `plot-plan-meta.sh`.
- A **second** round reports `2` — it updates the existing block rather than
  appending a second one or replacing it with a fresh `round: 1`.
- A round that changes no decision still increments the count.
- A plan with no block still **omits the key entirely** rather than reporting 0.
- A malformed block is reported as absent, which is the parser's existing
  behaviour and must not regress.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run validate`, `pnpm run test:reconcile`, and a changeset with its
`bumps:` block naming `challenge-the-plan`. Never edit skill version fields by
hand. Use `trash`, not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section
on `main` as soon as the PR exists — check `git branch --show-current` is `main`
first. The arrow form is the only one the parser reads.

### Scope guard

This branch owns `skills/challenge-the-plan/SKILL.md` and the slash-command file
that currently duplicates the specification. It does NOT touch
`plot-plan-meta.sh`, the board, or any plan file — the back-fill is wave 2.

Two workers are running as this is written: one in `packages/board/` on
`AgentList.tsx` and `fleet.ts`, one on `plot-plan-meta.sh` and
`test/reconcile/parser.test.mjs`. **You share no files with either — and note
the second is editing the very parser you must not touch.** Stay in
`skills/challenge-the-plan/`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
