## Implementation brief — status-column-earns-its-width (single wave)

- **Plan (canonical):** `docs/plans/2026-08-17-status-column-earns-its-width.md` on `main`
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #178 merged (two interrogation rounds)
- **Branch:** `feature/status-column-earns-its-width` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

Two changes to the agent row, in this order, as **two separate commits**:

1. The status column grows from `9rem` to `14rem`.
2. A row whose PR status changes marks itself for ~3 s.

They ship together (one branch, one PR) because both live in
`AgentList.tsx` and every board branch rebuilds the artifact — but keep
them as distinct commits so the width can be reverted alone if the
narrower branch column bites.

### The measurement

Reported from a screenshot of WAITING ON YOU:

| Branch | Status | Age |
|---|---|---|
| `feature/opus5-longhorizon-hardening` | `⑂57 conflicts` | `22d` |
| `changeset-release/main` | `⑂116 no checks` | `6m` |
| `feature/card-shows-interrogation-rounds` | `⑂177 conflicts` | `5m` |

**The space is not missing; it is misallocated.** `AgentList.tsx:192`:

```
ROW_TRACKS = 'grid-cols-[6rem_10rem_1fr_9rem_2.5rem_1.25rem]'
              phase  plan  branch status age   menu
```

The branch takes `1fr` — which does not mean *take what you need*, it
means **take everything left over**. So the window's slack collects
between the branch name and the status: the gap in the screenshot belongs
to the branch column and is simply not drawn.

**And a status cannot say when it started.** `⑂57 conflicts 22d` and
`⑂177 conflicts 5m` are the same status meaning opposite things — a
standing decision nobody has taken versus something that broke minutes
ago. Age does not separate them in general: it is the **PR's** age, not
the state's, and a three-week-old PR that broke this morning would read
as `22d` too.

### Verified as still true, minutes before this brief

`ROW_TRACKS` is at `9rem`; `FLEET_POLL_MS = 4_000`; `PR_REFRESH_MS =
60_000`; `PR_BACKOFF_MAX_MS = 120_000`; `AgentList.tsx` and `App.tsx`
untouched since approval. Build on these; if any has moved when you
start, stop and report rather than adapting.

### Seven decisions the plan settles — do not re-derive them

**The status track becomes a fixed `14rem`; the branch keeps `1fr`.**
Two alternatives were considered and rejected, both for the same reason:

- `minmax(9rem, auto)` on the status sizes to content, so the column edge
  wanders between rows — and *every row's status starts at the same x* is
  exactly what #175 was built to establish.
- `max-content` on the branch would size it to the longest name **in that
  section**, so WAITING ON YOU and WORKING would disagree about where the
  branch starts. That is the original defect, one column to the left.

**Below `sm` nothing changes.** `CARD_BELOW_PX = 640`; the row is a
stacked card there and tracks do not apply.

**The watched value is `pr?.state ?? null` — seven possibilities, not
six.** `pr` is `.nullable().default(null)` on the row, and most rows
carry none (`not-started`, `quiet`, every fresh claim). Reading
`row.pr.state` unguarded crashes on exactly those rows. `null → pending`
(a PR just opened) flashes, and so does `pending → null`.

**Never-seen and no-PR are different, and JavaScript will hide that from
you:**

| Ref holds | Means | This pulse |
|---|---|---|
| *(no entry)* | never observed this row | **record silently** |
| `null` | observed, had no PR | a move away from `null` flashes |
| a state | observed with that state | a different state flashes |

Collapsing the first two silences every branch's **first** PR — the most
interesting transition it will ever have. The ref must distinguish
*missing key* from *stored `null`*: `Map.has()` rather than a truthiness
test, or an explicit sentinel.

**~3 seconds, not ~300 ms, and the measurement decides it.** `pr.state`
comes from the **60 s** PR refresh, not the 4 s fleet pulse — and under
rate-limit backoff, 120 s. A transition is a rare event; a 300 ms marker
would be missed almost every time.

**A changed row flashes wherever it now sits, including a new section.**
`pr.state` helps decide the *group* (`fleet.ts:825-841` — `conflicts`
sends a row to WAITING ON YOU, CI running to WAITING ON A MACHINE), so a
change frequently moves the row. One rule, no exceptions: the watched
value changed → that row flashes, at its new location.

**A second change while the marker is lit restarts the timer.** Letting
the first expire un-extended would hide the second change and imply
nothing further happened.

**Ten rows changing means ten markers.** No threshold, no suppression: a
rule that goes quiet exactly when the most changed would make the board
least informative at its most eventful moment.

**The memory is per client, and one value deep.** A ref keyed by the
row's existing identity (`${repo}/${branch}`, `AgentList.tsx:1505`).
Nothing persisted, no contract change, no server change. A reload starts
silent; two tabs flash independently; a backgrounded tab accumulates
nothing — the flash is not a log.

### Done when

The plan's `## Done when` list is the specification. The assertions that
exist because a weaker implementation passes without them:

- **Every row's status cell starts at the same x**, in every section,
  with and without a phase. The pairing: `minmax`/`max-content` shapes
  pass "the status got wider" and fail this.
- **Below 640px nothing changes** — assert the card layout at 375px.
- **The FIRST pulse flashes nothing.** Fires on every page load; a naive
  implementation gets this wrong in the loudest possible way.
- **A row observed with `pr: null` and then given a PR DOES flash**,
  while that same row on first sighting does not. The pairing that
  matters: storing both as "nothing" passes the first-pulse assertion and
  silences every first PR.
- **Both directions flash** — `null → pending` and `pending → null`.
- **A row that changes section still flashes, at its new location.** The
  pairing: an implementation keyed on *position* rather than on row
  identity loses the prior value exactly when the row moves — the most
  common case, since `pr.state` helps decide the group.
- **A second change while lit restarts the marker** — assert it is still
  present past the first change's expiry.
- **Ten simultaneous changes produce ten markers.**
- **A row whose watched value did NOT change does not flash**, even when
  the note and commit count moved.
- **`motion-reduce` keeps the marker and stops the animation.** Both
  halves — hiding the element under `motion-reduce` passes a motion-only
  assertion and loses the information.
- **The marker is `aria-hidden`** and no live region announces it.
- **The marker clears itself** after its duration without another pulse —
  one that needs the next pulse to clear stays lit forever on a board
  that lost its server, which is exactly when nothing is changing.
- **Neither clock changes.** Assert `PR_REFRESH_MS` and `FLEET_POLL_MS`
  are untouched: polling the host harder to sharpen the marker would
  spend the rate limit the backoff protects.
- **Nothing is persisted and no contract field is added.**

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset
is present with its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as
soon as it exists** — and push again the moment you rebase. A rebase that
stays local reads from outside exactly like an agent that stopped: on
2026-08-17 PR #177 sat `CONFLICTING` with no CI for half an hour for that
reason alone.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` and its tests. A small
shared marker component is fine.

**Do NOT touch `LiveDot`** (`AgentList.tsx:506-510`) — the WORKING rows'
pulsing dot means *something is alive, end unknown* and lives for hours;
this marker means *this just changed* and lives for seconds. #176 settled
that distinction; keeping them separate is a requirement, not a
preference.

**Do NOT change either clock, the server, or the contract.** The whole
change is that the client remembers one value.

**Do NOT add a timestamp to the status cell.** *How long has this been
true?* is a real question and deliberately NOT this one; folding both
into one cell would give one label two meanings.

### Notes on this repo

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff** —
the rebuild overwrites whichever side you took.

Vitest runs with `environment: 'node'` — no jsdom, no React Testing
Library. Wave 2 of `acting-buttons` therefore put its decisions in
**exported pure functions** and asserted those, using browser tests only
for what genuinely needs a page. The transition rule here reduces to a
predicate over (prior, current) and should follow that pattern; the
`motion-reduce` and `aria-hidden` assertions want a real page.

On 2026-08-17 a branch failed CI because a sibling had added one contract
field and a whole-object `toEqual` against a hand-written fixture did not
know about it — `merge-tree` compares lines, not expectations. Prefer
asserting the fields you care about over the whole object.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
