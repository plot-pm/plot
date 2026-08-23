## Implementation brief — waves-name-themselves (wave 1: Parsed)

- **Plan (canonical):** `docs/plans/2026-08-21-waves-name-themselves.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, plan-PR #306 merged
- **Branch:** `infra/the-parser-reads-a-wave-heading` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

**This wave must land before either of the other two.** Wave 2 makes the
template write the new shape; wave 3 migrates 85 plan files. Both are unsafe
until the parser reads the new spelling — see below, this is the plan's central
hazard and the reason the order is load-bearing.

### What to build

Teach `plot-plan-meta.sh` a second spelling of the implementation section:

    ## Waves

    ### Removed (Branch: bug/an-agent-is-not-a-machine, PR: #300)
    - `machineProcesses` loses its `origin: 'local'` half. Tests: …

The heading takes the meta — which branch, which PR — and the line keeps the
work. It must emit **exactly the JSON it emits today**: same `branches`, same
`prs`, same `waves` arrays, from either spelling.

`PR:` is omitted where none exists yet; an absent field is not a claim, the same
rule `Issue:` follows in `## Status`.

### The decisions the plan settles — do not re-derive them

**Read BOTH spellings. `## Branches` does not stop parsing.** This is the
hazard the interrogation found and it is not negotiable. Measured 2026-08-22
against today's parser, the new shape yields:

    branches: 0   prs: 0   waves: 0   error: null

Silently — and the consumers inherit the silence rather than catching it. The
fleet scan prints `(no branches)` and moves on (`plot-fleet-scan.sh:2645`);
`/plot-deliver`'s unaccounted-branches gate checks an empty list and passes. A
plan migrated one commit before the parser learns the shape does not fail, it
**disappears**. Keeping the old spelling readable is what makes the migration
reversible per file.

That does not contradict the plan's *one shape* decision: that decision governs
what Plot **writes and documents**, never what a parser tolerates while 85 files
are being moved.

**A backticked name in a PARAGRAPH is not a branch.** This is the defect the old
shape invited, and it is live: on 2026-08-22 `opus5-longhorizon-hardening`
reported SIX branches in a wave that has five, because a branch line's
description cited `docs/model-provenance.md` and the parser read the second
path-shaped token as another branch. `plot-dispatch` would have created a
worktree for a markdown file. Under the new shape the branch comes from the
HEADING, so a name in prose cannot be mistaken for one — make sure your
implementation actually delivers that property rather than only permitting it.

**Do not move the `<!-- claimed: -->` and `<!-- deferred: -->` comments.** They
are meta too, but they are written by TOOLS rather than by hand, and relocating
them is a separate question this plan does not answer.

**Carried over unchanged:** absent is not a guess. A heading with no `PR:` emits
no PR — not an empty string, not a zero.

### Done when

The plan's changelog is the specification. Lift these in particular, because a
naive implementation passes without them:

- **A new-shape plan and its old-shape twin produce byte-identical JSON.** This
  is the property that makes wave 3's migration provably a re-spelling, and it
  is the test the whole plan rests on.
- `## Branches` still parses exactly as before — run the existing contract tests
  unchanged and add the new ones beside them.
- A heading with no `PR:` yields no PR rather than an empty string.
- A backticked branch name in a paragraph is NOT returned as a branch.
- `## Waves` with a heading the parser cannot read reports something, rather
  than silently yielding zero branches.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:reconcile` (this is the suite that owns the parser contract),
`pnpm run test:board`, `pnpm run typecheck`, and a changeset with its `bumps:`
block. Never edit versions by hand. Use `trash`, not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section
on `main` as soon as the PR exists — check `git branch --show-current` is `main`
first. The arrow form is the only one the parser reads: `(#306)` parses as
nothing, which is a defect this very plan exists to remove.

### Scope guard

This branch owns `skills/plot/scripts/plot-plan-meta.sh` and
`test/reconcile/parser.test.mjs`. It does NOT touch the template, any other
skill, or a single plan file — those are waves 2 and 3.

Two workers are running as this is written, both in `packages/board/` on
`AgentList.tsx`. You share no files with either. Do not edit board code.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
