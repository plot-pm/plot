## Implementation brief — an-interrogation-records-itself (slice: Recording)

- **Plan (canonical):** `docs/plans/2026-09-01-an-interrogation-records-itself.md` on `main`
- **Branch:** `docs/an-interrogation-writes-its-round` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

First of two. `bug/a-questioned-plan-says-how-often` adds the scan report and can follow.

### READ THIS BEFORE OPENING THE SKILL

**The skill already writes the field, and writes it correctly.** `skills/challenge-the-plan/SKILL.md`
Phase 5b step 3 says *"write `- **Rounds:** N` to `## Status`"*, specifies
replace-or-insert-immediately-after-`Impl:`, and warns that a greedy match there would destroy
the `Approved:` / `Started:` / `Delivered:` records. **Do not rewrite that instruction.** It is
careful, and its care is load-bearing.

**The gap is one sentence, not a mechanism.** Nothing in it addresses the interrogator who is
*not* running the skill — and that is the path that leaves no trace. Five plans were
interrogated across nine rounds on 2026-09-01 and every one reported `rounds: undefined`.

### What to build

Two documentation changes and no code.

1. **One sentence in the skill**: the round is owed by anyone who interrogates a plan, whether
   or not this skill did the interrogating. Place it beside Phase 5b's existing instruction.
2. **`Rounds:` in the plan-format documentation**, where `Phase:` and `Review:` are described.
   `plot-plan-meta.sh` reads it from three sources — `## Status` first, YAML front matter
   second, the `CHALLENGE-THE-PLAN-METADATA` block last — and **only the docs are silent**,
   which is why a hand interrogation does not know the field exists.

### The decisions the plan settles — do not re-derive them

**`rounds: 0` and *absent* are different, and must stay different.** `PlanCard.tsx:284` renders
no badge for either, and states why: *"No badge where the plan records no interrogation:
silence, not a zero."* A plan nobody has questioned is honestly unquestioned; a plan that
records zero has said something. **A change that turns absence into `0` breaks the property the
badge exists for.**

**Rejected: inferring rounds from git history.** Bookkeeping commits, PR annotations and phase
flips all touch a plan, so a commit count over-counts; an interrogation whose findings land in
one commit under-counts. **A round is a judgement about what happened, not a diff count.**

**Rejected: requiring the skill.** That trades a missing record for a missing interrogation.
The direct path tests a plan's claims against the code — which is where every finding of
2026-09-01 came from — and question-generation does not do that.

### Done when

- A plan carrying only a `## Status` `Rounds:` line parses and the board shows the badge —
  asserted, since that is the source a hand interrogation writes.
- **A plan with no `Rounds:` line still reports `undefined`, not `0`**, and renders no badge.
  Assert both halves; the second is the one a careless fix breaks.
- The skill's Phase 5b instruction is **unchanged except for the added sentence** — diff it and
  check.
- `pnpm test` (skills parse), `pnpm run test:reconcile`, changeset (`'plot': patch` with a
  `bumps:` block naming `challenge-the-plan`, description first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** `skills/challenge-the-plan/SKILL.md` (one sentence) and the plan-format
documentation for `Rounds:`.

**It does not own** the scan report (`bug/a-questioned-plan-says-how-often`),
`plot-plan-meta.sh`'s parsing (it already works), or `PlanCard.tsx` (it already renders).

**In flight, 2026-09-01:** several branches across `packages/domain/` and `skills/plot/`; this
slice touches neither.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
