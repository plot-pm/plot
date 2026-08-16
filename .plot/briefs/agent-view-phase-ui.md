## Implementation brief — agent-view-phase (wave 2: Display)

- **Plan (canonical):** `docs/plans/2026-08-16-agent-view-phase.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #131 merged (three interrogation rounds)
- **Branch:** `feature/agent-view-phase-ui` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 1 (`feature/fleet-row-phase`) merged as #140 — the fields you render exist
on `main` now. This wave completes the plan.

### What to build

Three display changes in `AgentList.tsx`, all reading data the Data wave
already supplies.

**1. The phase REPLACES the repo cell.** Not a seventh cell: the row already
carries plan, branch, note, PR and age, and wraps on names like
`feature/opus5-hardening-challenge-budget`. The repo is the right thing to give
up — constant in a one-repo board (its own comment says so), rendered nowhere
else in the app, and a column showing the same word on every row is chrome that
never varies. Wider than the repo's `w-16`, which fits 8–9 characters at
`text-xs`: "Development" is 11 and would render "Developm…".

**2. A `deferred` badge, carried BESIDE the state rather than instead of it.**
Today `classify()` returns `{ group: 'not-started', note: 'deferred' }`
unconditionally, so a branch that was started and then shelved reads as *never
begun* and the note displaces whatever else the row had to say. The badge fixes
both halves. Same shape as the `no story` badge on plan cards — mark the thing,
do not bend the state to encode it.

**3. `StartWorkButton` on eligible rows.** It already exists, already
dispatches, already handles the outstanding-click state — it just sits on
`PlanCard` only. Nothing new is built. It takes a `Card`, and a fleet row is not
one: look the card up from the board payload by `planFile`, and **a row whose
plan has no card gets no button** rather than a broken one.

### Four things the plan settles that are easy to get wrong

**The phase is spelled out.** Assert the full word appears. Initials do not
work — Discovery, Design and Development all begin with **D**, and two letters
are no better (`DE` covers Design and Development). `PHASE_LEADERSHIP` cannot
carry it either: 👤 maps to Discovery, Design *and* Endgame, because it encodes
*who leads*, not *which phase*.

**The word travels alone, and that is deliberate.** The contract's *"symbol AND
a word, never as colour alone"* rule exists to stop **colour** being the sole
carrier; a word is already that non-colour channel. Do not invent a second
five-icon vocabulary — it would put two meanings on every phase.

**The cell carries an `sr-only` label.** The list is a `<li>` of `<span>`s — a
visual table with no semantics, so column position conveys nothing to a screen
reader. `plot` reads as a repo by luck; `Development` does not announce itself
as a phase. `title` is what neighbouring cells use (branch at 243, waiting age
at 266) and is the weaker instrument — never shown on touch, read
inconsistently — so it may accompany the label, not replace it.

**The button appears ONLY on `not-started` rows that are `eligible`.** Two
things live in that group: `eligible — nobody has taken it` and `blocked by an
earlier wave`. A button on the second would offer to skip the ordering waves
exist to express — and `plot-dispatch` refuses that branch for the same reason,
so the board would be inviting an action the tool declines. No greyed-out
control on blocked rows either: a button whose usual state is "you cannot"
teaches people to ignore buttons. And never on `working` or `quiet` rows, which
already have a branch and a claim.

### Done when

The plan's `## Done when` list is the specification. Assertions that exist
because the naive test passes without them:

- **A deferred branch reads Design WITH the badge** — not Development (nobody
  is working on it) and not bare Design (indistinguishable from never-started).
  Assert both halves; each alone is the wrong answer.
- **The note is not replaced by the word `deferred`.**
- **A deferred branch never reads WORKING**, even with a commit inside the
  quiet window — assert that a fresh commit does not pull it in.
- **The phase replaces the repo column**, wide enough for "Development", and
  the repo no longer renders in an agent row.
- **The Start button is absent on a `blocked by an earlier wave` row**, and a
  row whose plan has no board card gets no button rather than a broken one.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists** — three agents today finished work that stayed invisible because it
was never pushed.

### Scope guard

`packages/board/src/app/**` and its tests.

Two other branches are in flight (`bug/board-binds-port-zero` on the server
bootstrap, `bug/fleet-sees-unpushed-commits` on the scan) — no source overlap
with yours. Note that `AgentList.tsx` changed on `main` an hour ago (#141 added
staleness reporting), so read the current file rather than assuming. The only
shared surface is the built artifact `board-server.mjs`, which every board
branch rebuilds. On a conflict there, do **not** read the diff: take either
side, run `pnpm build:board`, and continue — which side you take cannot matter,
because the rebuild overwrites it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
