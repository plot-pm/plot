## Implementation brief — a-changeset-says-what-changed (slice 2: Parsing)

- **Plan (canonical):** `docs/plans/2026-08-30-a-changeset-says-what-changed.md` on `main`
- **Branch:** `bug/a-plan-may-mention-a-comment-marker` (base: `main`)
- **Ends as:** one PR to `main`

Independent of slice 1 — different file, different risk.

### What to build

`plot-plan-meta.sh` stops treating an HTML comment-open marker as a comment when
it appears **inside a fenced code block or inline code**.

### The decisions the plan settles — do not re-derive them

**This is the same family as the changeset defect, one layer up**: something
that looks like data is read as syntax. Changesets publishes the first line
whatever it is; the plan parser treats the marker as a comment wherever it is.

**Measured on the plan that carries this slice.** Writing the marker in its
one-line summary — inside backticks, where Markdown renders it as a literal —
made the entire file parse as `format: none`: no phase, no type, no slices. A
plan about a mishandled comment, defeated by a mishandled comment. The workaround
in that plan is to *describe* the marker rather than print it, which is a
concession, not a fix.

**The risk here is not the changeset's risk.** Slice 1 adds a rule nothing
depends on yet. **This changes the parser every component reads plans through** —
`plot-fleet-scan.sh`, `plot-deliver.sh`, `plot-dispatch.sh`, the board. A mistake
is not a bad changeset; it is a fleet that cannot see its plans.

**So the assertion that carries this slice is a corpus comparison**: every plan
in `docs/plans/` parses **identically** before and after. Not "the tests pass" —
the parser's contract is the whole plan estate, and only the estate can prove it
held.

**A genuine HTML comment must still be skipped.** The Status block is full of
them — `- **Issue:** <!-- optional -->` — and a parser that stopped honouring
those would break every plan in the opposite direction.

**Beware the awk region.** `plot-plan-meta.sh`'s awk program is single-quoted in
shell: **an apostrophe anywhere in it closes the quote early** and produces
syntax errors that look nothing like the cause. Never write `awk's` in a comment
there; this repo has already lost time to it.

### Done when

The plan's Parsing `Done when`:

- a plan whose summary contains a backticked comment marker parses with its
  phase, type and slices intact
- a plan with a genuine HTML comment still has it skipped
- **every plan in `docs/plans/` parses identically before and after** — capture
  the parser's JSON for all of them on `main`, run again after, and diff

Repo gates: `pnpm test`, `pnpm run test:reconcile` (the plan-format contract
tests), changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns `plot-plan-meta.sh`'s comment handling and its contract tests. **Does not
touch the changeset rule** — that is slice 1. Does not rewrite the plan that
worked around this defect; the workaround can be removed once the parser is
fixed, in whichever change wants that plan's prose tidied.
