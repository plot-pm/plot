## Implementation brief — a-sprint-shows-its-dates (slice: The timebox is read)

- **Plan (canonical):** `docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/a-sprint-shows-its-dates` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

**The last of four slices.** #728, #735 and #743 merged; this one unblocks the plan's delivery — `/plot-deliver` refuses today naming this branch alone.

## What this delivers

`Start:` and `End:` reach the board's sprint card.

**THEY ARE PARSED NOWHERE TODAY.** Verified 2026-09-06: `plot-sprint-release.sh` reads neither, and no consumer exists anywhere. Every sprint file carries two fields **nothing has ever read** — `docs/sprints/2026-W34-the-board-tells-the-truth.md:8` writes both, as does every sibling.

**A field written by every author and read by nobody is either the card's missing axis or dead weight**, and this slice settles which by reading it.

## What to build

**PARSE, CARRY, RENDER.** The fields are `- **Start:** YYYY-MM-DD` and `- **End:** YYYY-MM-DD` in a sprint file's `## Status` block — the same shape as `Release:` and `Phase:`, which are already parsed. Follow whatever reads those rather than inventing a second sprint parser.

**A SPRINT PAST ITS `End:` MUST BE VISIBLY DIFFERENT FROM ONE INSIDE ITS BOX.** That is the Done-when's second half and the reason the fields are worth reading at all — a timebox nobody can see has passed is a timebox that is not doing its job.

**REPORT, NEVER CLOSE.** Closing a sprint is the team's word, and #743 already settled this for the release side: *"the scan reports a non-Closed sprint whose declared release has shipped, and closes none of them."* An elapsed `End:` is the same kind of fact.

**A MISSING OR MALFORMED DATE IS NOT A FAILURE.** Sprint files are written by hand and some predate the fields. An absent `Start:` renders as absent; it does not blank the card, and it does not throw.

## What this is not

**`end` SPLITTING INTO PLANNED AND ACTUAL IS NOT THIS SLICE.** The design doc raises it and notes *"one file already needs it"* — a second date is a format change. **Read the one that exists.**

## Done when

- a sprint card shows its timebox
- a sprint whose `End:` has passed is visibly distinguishable from one whose has not
- a sprint file with no dates, or a malformed one, renders without error
- nothing is closed, and no sprint file is written
- `pnpm test`, `pnpm run test:reconcile` and `pnpm run test:board` pass

## Do not

- **Do not add a second date field.** Planned-versus-actual is a format change and a different slice.
- **Do not close or advance a sprint.** Report only.
- **Do not write a second sprint parser.** `Phase:` and `Release:` are already read from the same block.
- **Do not fail on a missing date.** Hand-written files predate these fields.
- **Do not decide a view state in `.tsx`.** CLAUDE.md's rule: *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."* Whether a sprint is past its end is a domain question; the card renders the answer.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc` if you touch it.
