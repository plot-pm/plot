## Implementation brief — the-parser-reads-the-field-plot-writes (wave: The parser reads the field Plot writes)

- **Plan (canonical):** `docs/plans/2026-09-17-the-parser-reads-the-field-plot-writes.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `bug/the-parser-reads-the-field-plot-writes` (base: `main`)
- **Ends as:** one PR to `main`

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

`plot-plan-meta.sh:443` gives front matter precedence, and no lifecycle script
writes front matter — so on a plan carrying both, every transition Plot performs
is invisible. Invert the precedence for the phase fields: a canonical
`State:`/`Phase:` wins where both exist.

`phase_alt` keeps carrying the loser, so the disagreement stays visible.

### One test breaks and it is deliberate

`test/reconcile/parser.test.mjs:582` is the **only** both-shapes artifact in the
repository and exists to pin the precedence you are inverting. Measured: 96 pass,
1 fail, and it is that one.

**Update it, do not delete it** — move its `format` assertion and rewrite its
comment to state the new rule. Deleting removes the pin instead of moving it.

**Only `format` moves.** `design_raw` stays front-matter-wins, because `Design:`
is not a field any lifecycle script writes. **The precedence moves for the fields
Plot owns, not for every field.**

### The gate that proves it

The estate-wide *"292 plans byte-identical"* clause is a **regression lock, not
evidence** — zero plans here carry both shapes, so it is satisfied by doing
nothing.

The clause that proves the fix runs the real writer and an independent reader:
approve a both-shapes plan, then `plot-fleet-scan.sh` answers `eligible=1`.
**Perform the approval; do not edit a fixture into the answer.**

### Repo gates

`pnpm run test:contracts`.
