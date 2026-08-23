## Implementation brief — an-interrogation-leaves-a-record (wave 2: Recorded)

- **Plan (canonical):** `docs/plans/2026-08-22-an-interrogation-leaves-a-record.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `docs/the-six-say-they-were-challenged` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 (`bug/the-skill-records-its-rounds`) landed as **#323** — the skill now
writes the block going forward. This wave back-fills what happened before it,
and does not depend on it.

### What to build

Six plans were interrogated on 2026-08-22 and record nothing. Each gets a
`CHALLENGE-THE-PLAN-METADATA` block with `round: 1` and an empty
`questionHistory`.

The six, all on `main`:

    the-plan-is-the-wave
    waves-name-themselves
    a-folded-plan-says-what-it-hides
    done-means-delivered
    a-wave-is-one-branch
    a-dispatch-hands-over-a-brief

Verify each against the file before writing: every one carries a paragraph
beginning **"Interrogated 2026-08-22"** in its `## Notes`. If a plan does not,
do not give it a block — say so in the PR instead.

### The decisions the plan settles — do not re-derive them

**`questionHistory` stays EMPTY, and the plan says why.** The rounds happened in
a session; the questions and answers cannot be reconstructed from prose after
the fact. Writing a plausible history would be inventing a record — the same
defect as an invented version in a transition record. Leave it `[]` and note in
each block that the history was not reconstructable.

**`round: 1`, not more.** Each of the six had exactly one round. Two —
`a-dispatch-hands-over-a-brief` and `the-plan-is-the-wave` — carry a second
round recorded in prose; check before assuming, and if you find a second
interrogation, record `2`.

**Two plans are deliberately NOT in the list**
(`an-approved-plan-offers-its-two-starts`, `approval-hands-the-work-to-agents`).
They were interrogated too, and their plans reached `main` after this branch was
cut — the plan names them as pending rather than blocking on them. Do not chase
them.

**`rounds` must stay ABSENT for every other plan.** The field is optional and
never defaulted to zero: *"0 rounds reads as interrogated and found nothing; a
missing block means nobody has looked."* Adding a block to a plan that was not
interrogated would be the same lie in the other direction.

### Done when

- Each of the six reports `rounds: 1` through `plot-plan-meta.sh`.
- **No other plan's JSON changes at all** — this is the property that makes a
  hand-written block safe in bulk. Diff every plan's parser output before and
  after; the 24 plans that already carry counts must be untouched.
- A plan whose block you added reports the same `branches`, `prs` and `waves`
  as before — the block is metadata and must not disturb parsing.
- The blocks are valid to the parser's own reader: a malformed one reports the
  round as absent, which would silently undo the work.

Plus: `nvm use` (Node 24), `pnpm run test:reconcile` (the suite that owns the
parser contract), and a changeset. Use `trash`, not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section
on `main` once the PR exists — `git branch --show-current` must be `main` first.

### Scope guard

You own six files under `docs/plans/`, and nothing else. Not the skill (wave 1,
landed), not the parser, not the board.

Two other workers may be running: one on the plan template and `/plot-idea`, one
in `packages/board/src/app/`. Neither touches `docs/plans/` — but note the
template worker's plan (wave 3 of `waves-name-themselves`) will eventually
rewrite every plan file, so keep your diff to the metadata blocks alone and it
will merge cleanly.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
