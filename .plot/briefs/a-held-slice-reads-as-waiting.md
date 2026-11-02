## Implementation brief — a-slice-held-by-an-open (wave 2: Slice reading)

- **Plan (canonical):** docs/plans/2026-11-02-a-slice-held-by-an-open.md on main
- **Approved:** 2026-11-02, Jan Wloka, plan-PR #3050 merged
- **Branch:** `feature/a-held-slice-reads-as-waiting` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR, per plan's `Review: pr`

Wave 1 (`feature/dispatch-refuses-a-plan-with-nothing-startable`, PR #3051)
merged 2026-11-02. It landed `sliceHold` and `dispatchReading` in
`packages/domain/src/rules/verdict.ts` and
`packages/domain/src/rules/auto-dispatch.ts`, and the controller refusal in
`startDispatch`/`POST /api/implement`. This wave depends on `sliceHold` and
builds nothing it did not already land — the dependency is merged, so this
branch is unblocked.

### What to build

A board-side slice reading: `sliceRowReading` (a new pure module
`packages/board/src/app/lib/agent-rows/slice-reading.ts`) that maps the
already-landed `sliceHold(verdict, branches)` to the slice row's word, note,
tone and dispatch gate. Today `SliceRow` computes all four straight from
`group.verdict` alone (`packages/board/src/app/lib/agent-rows/rows.tsx:1122`
tone, `:1163` note, `:1469` `SliceActions`, plus the sole-slice menu gate
around `:937`), and `tupleFromSlice`
(`packages/board/src/app/lib/tuple-row.ts:1546`) prints the verdict word
into slot 5. Neither reads the branch-level `state`/`startability` wave 1
already exposes, so a slice held by an open `waits:` still reads `eligible`
with *approved — nobody has taken it*, offers a dispatch, and the dispatch
starts a brief run that cannot succeed — the cost this plan measured:
`plot-dispatch-command.mjs` burned two 5-minute `IMPLEMENT_TIMEOUT_MS` brief
runs before a third run read the unmerged wait and wrote nothing (Motivation,
plan line 39).

`sliceRowReading` closes that gap at the board consumer, not by changing the
pulse, the scan, or the `/api/fleet` schema.

### Decisions the plan settles — do not re-derive them

**Why the board derives this, rather than the scan emitting a new verdict.**
A new `SliceVerdictSchema` member would make every reader on an older bundle
reject the whole pulse, break `corpus/eligible.corpus.test.ts`, and collide
with PR #3048's edits to the walk. The pulse and `/api/fleet` schema stay
exactly as they are — `sliceRowReading` is pure board-side derivation over
fields the row already carries (`state`, `startability`).

**Why `sliceHold` lives in the domain and this wave only consumes it.**
Wave 1 already built and tested `sliceHold`/`dispatchReading` so both the
board reading and the controller refusal read one function and cannot
disagree — that is why the plan ordered the refusal first even though it
ships second in file order. Do not reimplement the hold logic here; call
`sliceHold(group.verdict, branches)` where `branches` map each row's
`state` and `startability` into `HoldBranch` (`verdict.ts:78`).

**The held-vs-not-held cases are enumerated in the plan, not invented here.**
See "Decisions on the cases" in the plan (lines 59–69) — in particular: one
held branch plus one `open` branch is **not** held (the slice stays
`eligible`, dispatch takes only the open branch); one `claimed`/`wip` branch
plus one `waiting` branch is **not** held (`startabilityVerdict` already
answers `someone-is-on-it`, and that slice's wrong "nobody has taken it" note
is a separate, out-of-scope defect — do not fix it here). A `blocked` hold
outranks a `waiting` hold for tone only (`you` vs `time`); the slot-5 WORD is
`waiting` for both, because slice verdict `blocked` already means "an
earlier slice has to land first" and reuses that word.

**The held note is the branch's own note, not a new one.** `classify`
already produces the correct per-branch sentence (`fleet.ts:4772-4794`):
`waits for <list>` or `waits for <list>, which has no pull request`. When
several branches are held, join with `; `. Do not write a new sentence.

**Readers that do not change.** `/api/attention`, auto-dispatch's count,
the counts at `fleet.ts:1160`/`board.ts:1333`, and `classify`/`waitingOnFor`
already answer correctly and are out of scope (plan Notes). Resist the urge
to "finish the job" on `nextWork`, `firstBrieflessBranch`, or
`skippedPlans` — each can read `sliceHold` in a follow-up plan, not this one.

### Done when

The plan's `## Done when`-equivalent is the test table (plan lines 77–119).
Pull out the assertions a naive port would miss:

- The held arm must precede the grouped-count arm in `SliceRow`, so a
  **multi-branch** held slice still reads `waiting` rather than falling
  through to a count-style word.
- `sliceRowReading` for an `open` + `waiting` slice must still answer word
  `eligible`, note `approved — nobody has taken it`, tone `you`,
  `dispatch: true` — the not-held path is pinned by its own test row, not
  just the held path.
- The existing browser test
  `packages/board/test/integration/slice-head-says-its-verdict.browser.test.ts:145`
  must keep passing unmodified — the decisions moved out of `SliceRow` into
  `slice-reading.ts`, they did not change behaviour for the eligible+open
  case. No new browser test is needed or wanted; this is a unit-level
  derivation.
- New case in `packages/board/test/unit/a-slice-with-no-work-waits-in-not-started.test.ts`
  for the held branch row itself (`startability: null`, `briefWriter`
  absent) — this was wave 1's surface, confirm it still holds rather than
  re-testing it.
- `packages/board/test/unit/slice-reading.test.ts` is a new file: cover held
  `waiting`, held `blocked`, `open`+`waiting` not-held, and
  `blocked`/`unapproved` slice verdicts unchanged (test table rows at plan
  lines 111–114).
- `tuple-row.test.ts`: held slice → slot 5 reads `waiting` (plan line 115).

Plus the repo's gates: no bundle diff committed (`board-server.mjs` is
generated — do not hand-edit or commit a rebuild), the changeset, and no
shell touched by this wave (it's board/domain TypeScript only, so
`scripts/check-shell-lines.sh` is not in play). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — the suites named in the `CI suites` config key run in
CI; don't run the full e2e suite locally (see CLAUDE.md Testing section).

### Bookkeeping

Open the PR through the controller once there's a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it
exists. When the PR is created, append `→ #<number>` to this branch's line
under `### Slice reading` in `docs/plans/2026-11-02-a-slice-held-by-an-open.md`.

### Scope guard

This branch owns:
- `packages/board/src/app/lib/agent-rows/slice-reading.ts` (new)
- `packages/board/src/app/lib/agent-rows/rows.tsx` (`SliceRow`'s tone/note/
  `SliceActions`/sole-slice-menu reads)
- `packages/board/src/app/lib/tuple-row.ts` (`tupleFromSlice`, slot 5)
- `packages/board/test/unit/slice-reading.test.ts` (new),
  `tuple-row.test.ts`, `a-slice-with-no-work-waits-in-not-started.test.ts`

It does not own, and must not edit: `packages/domain/src/rules/verdict.ts`
or `auto-dispatch.ts` (wave 1, already merged), the pulse schema, `/api/fleet`,
the scan, or `plan-walk-assembly.ts` (PR #3048's territory — this plan was
designed specifically to not collide with it).

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
