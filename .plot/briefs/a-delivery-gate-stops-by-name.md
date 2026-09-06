## Implementation brief — a-delivery-gate-stops-by-name (slice: The gate names what it gates on)

- **Plan (canonical):** `docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `infra/a-delivery-gate-stops-by-name` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of four, and it leads because the plan adds two scan sections and the marker is positional.

## The defect

**`/plot-deliver`'s gate stops at a line number.** `plot-deliver/SKILL.md:318` and `:331`:

```sh
sed -n '/^== 7\./q;p' /tmp/plot-deliver-gate.txt | grep "YYYY-MM-DD-<slug>.md"
```

**Its meaning is *stop before the first non-blocking section*.** Its expression is `== 7.`, and the scan's own comment (`:1097`) says the number is load-bearing:

> *"Sections 1-6 keep their numbers, so /plot-deliver's gate marker still stops before the first non-blocking section: what used to be section 7 (index drift, non-blocking) is now this section (uncut slices, non-blocking), and the blocking set stays 1-6."*

**Those two agree today by maintenance, not by construction.** The scan has been renumbered at least twice and each time somebody had to notice.

## And the documented count is already wrong

**`CLAUDE.md:150` says "twelve sections". The scan emits thirteen** — `rounds_drift=` joined the footer without the description following. Verified 2026-09-06.

That is the drift arriving in the place a reader trusts, which is what this slice is about.

## What to build

**A gate that selects the blocking sections without depending on their number.**

The blocking set is **sections 1–6**, and section 5 (`attention=`) is what actually gates — CLAUDE.md says so: *"Section 5 (`attention=`) is what gates; section 7 (`index_drift=`) is convenience and gates nothing."*

**How it names them is the slice's decision.** A marker line the scan emits between blocking and non-blocking, a footer key, an explicit list of section titles — each has a different cost when a section is added. **Say which and why in the code**, because the next author renumbering the scan is the person who needs it.

**`/plot-deliver` must refuse and permit exactly what it does today.** This is a mechanism change, not a policy one. A plan that delivers now must deliver after; one that is refused now must still be refused.

## CLAUDE.md's count comes with it

Thirteen, not twelve, and the section-13 description (`rounds_drift=`) joins the table. A slice fixing a positional marker that leaves the count wrong has fixed half the problem.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

**The test that matters: adding a section before the current 7 must not change what the gate blocks on.** That is the property the `sed` lacks, so it is the one to assert.

## Done when

- the gate selects the blocking sections without depending on their number
- `/plot-deliver` refuses and permits exactly what it does today
- adding a section does not change what it gates on, asserted by a test
- `CLAUDE.md`'s section count matches the scan, and section 13 is described
- the gates above pass

## Do not

- **Do not change what blocks.** Sections 1–6 block, section 5 is the count that gates; this slice changes how they are found, not which they are.
- **Do not renumber the scan.** The marker is the defect, not the numbering.
- **Do not add the sprint sections here.** They are slices 2 and 3, and they are why this one leads.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
