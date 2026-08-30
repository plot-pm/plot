## Implementation brief — two-monitors-watch-the-agent (slice 5: Attention)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on `main`
- **Branch:** `feature/the-findings-reach-attention` (base: `main`)
- **Ends as:** one PR to `main`

Needs slice 4.

### What to build

The findings travel to the board and become attention entries.

### The decisions the plan settles — do not re-derive them

**This is a payload field and a render, not a protocol.** Measured 2026-08-30:
`attention.ts` derives from `AgentRow` — `readingFor(row)` and `isClaimable(row)`
both take a row. So the findings must reach **the row**, and attention derives
from there exactly as it already does for `worker_activity`, which `schema.ts`
documents as *"forwarded onto the row unchanged"*.

**It was split from the channel slice for that reason.** A protocol between
processes and a payload field are different work with different proofs; proving
one says nothing about the other.

**An entry must say which monitor found it.** A WorkerMonitor `idle` and an
AgentMonitor finding call for different responses — one may be a process to
look at, the other a debt to discharge — and an entry that flattens them makes
the reader re-derive which.

**Clearing is a derivation, not an event.** An `owes a review` entry disappears
because the finding stopped holding, not because something marked it done. The
monitor republishes on change; the row reflects the current answer.

### Done when

The plan's Attention `Done when`: an `owes a review` branch appears on the
attention surface, the entry names the branch and what to do, it clears when the
PR is opened, and a WorkerMonitor `idle` finding is distinguishable from an
AgentMonitor one in the entry itself.

**A board browser test needs the built artifact** — run `pnpm build:board`
first, or a stale artifact fails reassuringly. Board changesets use package
frontmatter (`'@plot-pm/board': patch`), not a `bumps:` block.

Repo gates: `pnpm test`, `pnpm run test:board`, `pnpm build:board`, changeset.
Node 24, `corepack pnpm`.

### Scope guard

Owns the payload field, its schema entry, and the attention derivation. Not the
socket, not any action.
