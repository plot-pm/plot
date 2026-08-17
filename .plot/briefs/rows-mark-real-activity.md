## Implementation brief — activity-shows-itself, wave 1 (Truth)

- **Plan (canonical):** `docs/plans/2026-08-17-activity-shows-itself.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #179 merged (two interrogation rounds)
- **Branch:** `feature/rows-mark-real-activity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The row's activity marker stops reporting **group membership** and starts
reporting **observed activity**.

This wave changes *what the marker knows*, not how it looks. The
prominent rendering is wave 2 (`feature/activity-marker-glows`); the
group heading is wave 3; the unpushed mark is wave 4. **Do not build
them.**

### The measurement

A request arrived to make activity more visible. The measurement redirected
it — `AgentList.tsx`, the whole of `isLive`:

```ts
export function isLive(row: AgentRow): boolean {
  return row.group === 'working';
}
```

That is not *something is happening here*. It is *this row is in the
WORKING group* — and a row sits there for **hours** while an agent works,
while an agent has crashed, or while it waits on a human. Nothing
measures the end. Six rows carried it during the session that reported
this.

Meanwhile the contract carries three activity fields and **not one
reaches any component**:

| Field | Question it answers |
|---|---|
| `local_dirty` | someone is editing |
| `local_ahead` | finished work nobody else can see |
| `local_locked` | a write is in progress **this instant** |

`local_locked` reads `.git/index.lock`. It was fought for the same day in
`board-survives-its-agents`, whose whole argument was that a locked
worktree must become **its own signal rather than silence** — and it
lands in the contract and stops there. Producing a signal and never
rendering it is a quieter version of the defect that plan fixed.

### Five decisions the plan settles — do not re-derive them

**A row is active when `local_locked || local_dirty`.** Someone is
writing, or has written and not committed.

**`local_ahead` is NOT activity here.** Unpushed commits are finished
work sitting still. It gets its own static mark in **wave 4** — do not
add it, and do not OR it into the activity predicate. A row that nobody
has touched for hours but that holds one unpushed commit must **not**
read as active.

**Absent is not false.** All three are `.default(false)` in the contract,
and a scan that could not observe a worktree reports absence rather than
cleanliness — the rule `scan-reports-a-locked-worktree` established. A
row whose signals are unknown is **not marked active**; it is marked
nothing.

**A seen lock echoes for a few seconds.** Measured tension:
`.git/index.lock` lives from a fraction of a second to a few seconds, and
`FLEET_POLL_MS` is **4 s** — so most locks are born and die *between* two
pulses and are never seen. The sharpest signal the board has is the one
it most often misses.

So a lock, once **seen**, holds the marker a few seconds past the pulse
that reported it. This is a deliberate exception to a rule the board
otherwise keeps, and it is bounded by three constraints:

- **It never contradicts a later observation.** A pulse showing
  `local_dirty` keeps the marker for its own reason; a pulse showing
  neither lets the echo expire and does not extend it.
- **A lock never resurrects.** The echo starts when a lock is *seen*,
  never when one is inferred; two lockless pulses produce nothing.
- **It is a marker, not a state.** The row's note keeps reporting what
  the last pulse actually found. The echo makes a real event visible; it
  never makes a claim the note would contradict.

**The marker means "here, on this machine", and must say so.** Measured —
`fleet.ts:702`, on `local_dirty`, with the same note on `local_ahead`:

> *"it is true only on the machine doing the looking, and false is what
> every branch elsewhere reports."*

An agent on another machine produces **no dirty signal here, ever**. Its
branch is not idle; it is unobservable from this checkout. So the marker
carries the limit in its `title` / accessible description — *"a write is
in progress in this checkout"* — because a reader who takes an unmarked
row for an idle one has been misled by a marker that was technically
correct. `ABSENT IS NOT FALSE`; the strongest licensed statement is
**unknown, never nobody**.

Do **not** add a remote-visible signal (ref movement between pulses). It
answers a different question with a different meaning and was explicitly
rejected for this plan.

### Done when

- **A NEW predicate reads `local_locked || local_dirty`.** Assert a
  WORKING row with neither signal carries no activity mark, and a row
  outside WORKING with a signal does.

  **`isLive` and `LiveDot` stay exactly as they are** — corrected
  2026-08-17. The first version of this brief asked for the marker to
  stop reading `group === 'working'` *and* for `[data-live-dot]` to
  render unchanged; `isLive` is what gates `LiveDot`
  (`AgentList.tsx:1201`), so those cannot both hold. The plan's own
  marker table settles it: `[data-live-dot]` (*in the WORKING group*,
  hours) and the activity mark (*someone is writing here*) are **two
  marks with two meanings**, and *no mark may be implemented by modifying
  another*. So this wave adds `isActive` beside `isLive`, with its own
  minimally-rendered element — wave 2 makes it a glowing bar.
- **`local_ahead` alone does not mark a row active.** The pairing: an
  implementation OR-ing all three passes every positive assertion above
  and marks finished-but-unpushed work as motion.
- **Unknown signals leave a row unmarked** — and never crash. All three
  are `.default(false)`, and a scan that could not observe reports
  absence.
- **A seen lock keeps the marker for a few seconds.** Assert it survives
  a pulse in which the lock is already gone — otherwise the signal
  `scan-reports-a-locked-worktree` produced never renders at all.
- **The echo is bounded and never resurrects.** Assert it expires without
  a further lock, and that two lockless pulses produce no marker.
- **A later observation is never contradicted.** Assert the note keeps
  reporting what the last pulse found while an echo runs.
- **The marker names its own limit** in its accessible description.
- **`[data-change-mark]` and `[data-live-dot]` are untouched.** Assert
  both render exactly as before.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset
is present with its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as
soon as it exists**, and **push again immediately after any rebase** — a
rebase left unpushed reads from outside exactly like an agent that
stopped, and cost PR #177 half an hour of dead CI today.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` (the predicate and its
marker) and its tests.

**Do NOT change the rendering beyond what the predicate requires** — the
glowing static bar is wave 2. If the existing dot keeps its current
appearance while reading the new predicate, that is the correct outcome
for this wave.

**Do NOT touch `[data-change-mark]`** (#180's full-row amber wash) or
`[data-live-dot]`'s appearance. #180 ships a test —
*"leaves the LIVE DOT alone — two marks, two meanings"* — which is the
precedent and the standard: no mark may be implemented by modifying
another.

**The fields exist on the SCAN document, not on the row — a carrier is
required.** Corrected 2026-08-17 after this brief's first version got it
wrong. Measured: `local_dirty`, `local_locked` and `local_ahead` live on
`FleetBranchSchema`; `rowsFromPulse` passes them to `classify()`
(`fleet.ts:1224-1238`) and then **drops them**. `AgentRowSchema` carries
none of the three, and `AgentRow` is what the component receives.

So add the two activity fields to `AgentRowSchema` **additively**
(`.boolean().default(false)`, absent-is-not-false preserved) and pass
them through in `rowsFromPulse`. That is the minimum this wave's
Done-when requires.

**Do NOT touch `classify()`, the grouping, the scan, or
`FleetBranchSchema`.** The carrier is the only server-side change.

**Do NOT add the group-heading marker** (wave 3) or the unpushed mark
(wave 4).

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom, no React Testing
Library. Recent waves put their decisions in **exported pure functions**
and asserted those, using browser tests only for what genuinely needs a
page. The predicate and the echo both reduce to functions over (signals,
time) and should follow that pattern.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

On 2026-08-17 a branch failed CI because a sibling had added one contract
field and a whole-object `toEqual` against a hand-written fixture did not
know about it — `merge-tree` compares lines, not expectations. Prefer
asserting the fields you care about over the whole object.

**CI note:** this repo saw CI fail today on a markdown-only branch because
Playwright's CDN returned `403 — this service is not available in your
location` while installing a browser. If `validate` fails in a step you
did not touch, check whether it passes locally before assuming you caused
it — and say so in your report rather than working around it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
