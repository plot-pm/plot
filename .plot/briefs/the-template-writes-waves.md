## Implementation brief — waves-name-themselves (wave 2: Written)

- **Plan (canonical):** `docs/plans/2026-08-21-waves-name-themselves.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, plan-PR #306 merged
- **Branch:** `infra/the-template-writes-waves` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 (`infra/the-parser-reads-a-wave-heading`) **landed as #321** — the parser
now reads both spellings. That is what makes this wave safe: anything you write
in the new shape parses today. Wave 3 migrates the 85 existing plans and is not
yours.

### What to build

The plan template and `/plot-idea` write the new shape:

    ## Waves

    ### Removed (Branch: bug/an-agent-is-not-a-machine, PR: #300)
    - `machineProcesses` loses its `origin: 'local'` half. Tests: …

The heading takes the meta — which branch, which PR — and the line keeps the
work. `PR:` is omitted where none exists yet; an absent field is not a claim,
the same rule `Issue:` follows in `## Status`.

### The decisions the plan settles — do not re-derive them

**This wave writes; it does not migrate.** Existing plans keep `## Branches`
until wave 3 moves them, and the parser reads both. Do not touch a plan file.

**Every wave gets a `### ` heading, including a plan with only one.** The
template already says this and the reason stands: a nameless wave renders
`(unnamed)` on the board, where a reader cannot tell *this wave has no name*
from *this field is blank*. A single wave still earns a name — it says what the
wave is FOR, which a branch list does not.

**A branch name in a PARAGRAPH is not a branch.** This is the defect the old
shape invited and it is live: on 2026-08-22 `opus5-longhorizon-hardening`
reported SIX branches in a wave that has five, because a description cited
`docs/model-provenance.md` and the parser read the second path-shaped token as
another branch. `plot-dispatch` would have made a worktree for a markdown file.
The new shape removes the ambiguity by construction — make sure the guidance you
write says so, so the next author does not reintroduce it.

**One specification, not two.** The template's guidance and `/plot-idea`'s
instructions must not each describe the shape independently — that is the drift
`/plot-approve` warns about with its own two entrances.

### Done when

- A plan created by `/plot-idea` carries `## Waves`, and its wave heading names
  the branch (and the PR where one exists).
- `plot-plan-meta.sh` parses what was just written — assert this against the
  real script, not a fixture, since that round trip is the point.
- The template's guidance says a wave heading is required **and why**.
- No skill still instructs a writer to put the branch in the list line.
- **An existing `## Branches` plan is untouched and still parses** — this wave
  changes what gets written, never what exists.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run validate`, `pnpm run test:reconcile`, and a changeset with its
`bumps:` block naming the skills you touch. Never edit skill version fields by
hand. Use `trash`, not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section
on `main` once the PR exists — check `git branch --show-current` is `main`
first. The arrow form is the only one the parser reads.

### Scope guard

You own the plan template (`.plot/templates/plan.md`, and the shipped
`skills/plot/templates/plan.md`), `skills/plot-idea/SKILL.md`, and any skill
prose that tells a writer where the branch goes. You do **not** own
`plot-plan-meta.sh` (wave 1, already landed) or any file under `docs/plans/`
(wave 3).

Two other workers may be running: one in `packages/board/src/app/` on section
headers, one editing plan files under `docs/plans/`. You share files with
neither.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
