## Implementation brief — agent-view-phase (wave 1: Data)

- **Plan (canonical):** `docs/plans/2026-08-16-agent-view-phase.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #131 merged (three interrogation rounds)
- **Branch:** `feature/fleet-row-phase` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### Scope: wave 1 only

The plan has two waves and this is the first. `feature/agent-view-phase-ui`
(the display wave) is **blocked until this merges** — it asserts against fields
you introduce, and a UI test written first would assert against a shape that
does not exist. Do not build it here.

Read the plan in full. Every decision in it was argued or measured, several
against alternatives that were tried and rejected.

### What to build

Three things, all in `plot-fleet-scan.sh` and `packages/board/src/server/`:

**1. A phase per row, derived from the PAIR.** Not from the plan file alone —
that produces rows that contradict themselves, and the repo contains the
example: `opus5-longhorizon-hardening` is `Phase: Approved` with zero
`Started:` records while six of its branches carry real commits. The mapping
table is in the plan; `toBoardPhase` stays the single definition and gains no
second implementation.

**2. The pulse also reads recently delivered plans.** Today it reads
`docs/plans/active/` only, so a plan leaves the view the instant it is
delivered — taking every branch with it, which is why DONE showed one branch
where five delivered plans named eight.

**3. A draft PR's failing CI must say so.** `fleet.ts:768` asks `pr.draft`
before anything reads checks, so a green draft and a red one render the
identical note. Keep the draft framing and the `waiting-on-you` group; let the
checks speak inside it.

### Five things settled in interrogation that are easy to get wrong

**git wins over an ABSENT record — not over a recorded decision.** The
asymmetry is deliberate. A missing `Started:` line is nobody having written
something down, and a commit outranks it. A commit landing under a plan already
marked `delivered` does **not** pull the row back to Development: that
contradicts a decision a human recorded. Endgame stays; the age shows the
commit. The symmetric implementation passes every other test in the list, so
this needs its own.

**Rolling 24 h, not the calendar day.** A plan delivered at 23:50 must not
vanish at 00:00 mid-session. 24 is also the number this repo already uses
(`Claim stale after`).

**Filter before you parse.** Measured: 57 ms per plan through
`plot-plan-meta.sh`, 14 delivered plans, against a scan that runs 500–1050 ms.
Parsing all of them to discard 13 would roughly double the pulse, and that cost
grows with the archive. Use the delivered symlink's mtime as a pre-filter; the
`Delivered:` record still decides. The pre-filter may **over-admit and pay a
parse, never exclude** — on a fresh clone every file shares one mtime and
everything is admitted, which is correct and merely slow, once.

**No date, no row.** `docs/plans/delivered/reconcile-scan-accuracy.md` is in the
delivered index today with an empty `Delivered:` record. It must not appear —
otherwise it is the one row that can never age out of DONE. Same rule the
waiting age already follows.

**`deferred` is a return, not a pause.** It sends the row back a phase AND
carries a badge saying why, and it can never read WORKING even with a fresh
commit. Today `classify()` returns `{ group: 'not-started', note: 'deferred' }`
unconditionally, which displaces whatever else the row had to say — the badge
carries that fact, the note keeps its own.

### Done when

The plan's `## Done when` list is the specification — work through it literally.
Several assertions there exist because a naive test passes without them; the
plan says which and why.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff, and a rebuild elsewhere leaves
yours stale — that cost a diagnosis three times in this repo); a changeset is
present; bash 3.2 only (macOS), so no `declare -A`.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. And **push early** — a previous agent on
this plan's sibling finished three commits without pushing, and the work was
invisible to everyone, including to the merge-queue check that gates the next
plan.

### Scope guard

`skills/plot/scripts/plot-fleet-scan.sh`, `packages/board/**` and their tests.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
