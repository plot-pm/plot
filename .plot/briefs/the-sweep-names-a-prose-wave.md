## Implementation brief — a-split-plan-says-it-is-split (wave: second)

- **Plan (canonical):** `docs/plans/*a-split-plan-says-it-is-split.md` on `main`
- **Branch:** `feature/the-sweep-names-a-prose-wave` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

`plot-plan-meta.sh` reports an **over-long wave name**, and the reconcile sweep
surfaces it — **without failing the parse**.

### The decisions the plan settles — do not re-derive them

**It REPORTS; it does not refuse.** A long wave name is a shape to fix, not a
malformed plan. The parser must keep returning the wave, and the sweep must keep
exiting as it does today.

**Do not touch `attention=`.** That footer count gates `/plot-deliver`'s
delivery-landed check and the `/plot` hygiene line. Adding a cosmetic finding to
it would fail every delivery in this repo. Section 7's comment in
`plot-reconcile-scan.sh` argues the split — read it and follow it. The
unsliced-wave section (#341) is the precedent to copy.

**A file with no `Phase:` is not a plan and is skipped** — `docs/plans/` also
holds decision logs and worker reports. The scan already applies this rule; do
not write a second answer to it.

**Count what the parser counts.** A plan's prose mentions wave and branch names
freely. Use the parser's own notion of a wave heading, never a second regex over
the raw file — `a-citation-is-not-a-claim` (Draft) exists because a looser match
turned a citation into a claim.

### Done when

The plan's `## Done when` is the specification. Plus: `nvm use` (Node 24),
`pnpm test`, `pnpm run test:reconcile`, and a changeset with its `bumps:` block.
**No board rebuild** — you touch no board source. If you find you do, stop and
report it.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `skills/plot/scripts/plot-plan-meta.sh`,
`skills/plot/scripts/plot-reconcile-scan.sh`, and their tests in
`test/reconcile/`.

`plot-plan-meta.sh` is the plan-format contract that five scripts read. Keep the
existing JSON shape intact — add a field, never change one.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
