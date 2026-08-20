# Brief — feature/design-is-a-phase

Wave 1 of `docs/plans/2026-08-20-design-is-work-not-an-absence.md`
("The phase exists"). Read the plan first; it settled the *why* and you should
not re-derive it.

## What this branch does

`plot-plan-meta.sh` learns a seventh phase, `design`, and reports its
`Design:` transition record alongside `Approved:` / `Delivered:` / `Released:`.

**Contract-level and purely additive.** Nothing else in this branch. The gates
(`plot-approve.sh`, `plot-phase-gate.sh`) and the board column are waves 2 and
3 — do not touch them, do not "prepare" them.

## Why the phase exists at all

A plan in Design is not a plan nobody started. It is a plan that *cannot yet be
handed to development* because it needs a spec, a spike or a tracer bullet
first. Today the board infers Design from `approved && !started`, which conflates
"design work is outstanding" with "nobody has picked it up" — two states with
opposite meanings for whoever reads the board. The phase makes the distinction
explicit and recordable.

## The two places to change

Both patterns are already in the file; follow them rather than inventing shapes.

1. **Normalisation** — `skills/plot/scripts/plot-plan-meta.sh:184`:

       if (t ~ /^(draft|approved|delivered|released|rejected|superseded)$/) return t

   `design` joins that alternation. Note line 185 maps `ready-for-review` and
   `in-review` onto `approved`; `design` needs no such alias — it is its own
   phase, not a synonym.

2. **The transition record** — mirror `approved`/`delivered`/`released` exactly.
   Each has an `fm_*` (front matter) and a `canon_*` (`## Status` line) variable,
   declared around lines 228-233, resolved with the same
   `strip_placeholder((fm_x != "") ? fm_x : canon_x)` precedence at ~269, and
   emitted as `x_raw`. Add `design_raw` the same way. Keep front matter winning
   over `## Status`, as the others do.

   Update the header comment block (lines 41-115) and the phase list at 48-49.

## Non-negotiable: the parser contract

`test/reconcile/parser.test.mjs` **must pass unedited.** This is the same
discipline the `changelog` field kept (PR #252) and the reason that field was
safe to add. If a existing test fails, the change is wrong — do not edit the test
to make it green.

Also update the error-path JSON at line 156: it enumerates every field, so a new
`design_raw` belongs there too, or a caller reading a missing file gets a
different shape than one reading a real plan.

## Tests to add

In `test/reconcile/parser.test.mjs`, following the file's existing style:

- a plan with `**Phase:** Design` parses as phase `design`
- its `Design:` record is reported in `design_raw`
- a plan with no `Design:` line reports it empty and is otherwise unchanged
- the six existing phases are byte-identical — assert on a fixture that already
  exists rather than writing a new one
- front matter `design:` outranks a `## Status` `Design:` line, as the other
  records do

## Definition of Done

- `pnpm test`, `pnpm run test:reconcile` and `pnpm run test:board` green
- `parser.test.mjs` unedited except for added cases
- a changeset with a `bumps:` block — `plot: minor` (new capability, additive)
- no version edited by hand

## If something is not anticipated here

Implement what you can and report the discovery. Do not widen the scope into
waves 2 or 3, and do not change what a phase *means* to any consumer — this
branch teaches the parser a word, nothing more.
