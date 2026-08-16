## Implementation brief — board-tells-the-truth (wave 1: Truth)

- **Plan (canonical):** `docs/plans/2026-08-16-board-tells-the-truth.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #138 merged (two interrogation rounds)
- **Branch:** `bug/board-shows-staleness` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### Scope: wave 1 only

`bug/board-binds-port-zero` (the Ports wave) is **not yours**. It is a separate
branch and is deliberately held back — see the ordering note at the end.

Read the plan in full. It went through two interrogation rounds and several of
its decisions were reached by discarding the obvious answer.

### What to build

**A failed fetch marks the payload stale, visibly, in the Agents tab.** Today
the tab has *no rendering at all* for `fleet.error` after the first successful
scan: `AgentList` consults it only to choose the pre-first-scan message
(line 326). `App.tsx:383` does show "Failed to load board" — but that branch
renders the **Board**, so the sibling tab reports an outage the Agents tab
keeps hiding.

Three things change together:

1. **The stale state is visible** in the tab that owns it.
2. **The countdown stops** rather than clamping at 0. `scanNextInSeconds −
   tick` currently counts down to zero and sits there, which reads as *about to
   refresh* — the opposite of the truth.
3. **The ages stop advancing.** `ageSeconds + tick` (line 451) currently keeps
   ageing against a scan that is not happening.

### Four decisions the plan settles — do not re-derive them

**The FIRST failed fetch is enough.** No two-strikes rule. The outcomes are
asymmetric: a hiccup that briefly reads *last heard 4s ago* costs nothing and
self-corrects on the next poll; a dead server looking normal for two intervals
costs a misdiagnosis — which is exactly what it cost on 2026-08-16.

**It recovers by itself.** A successful fetch clears the stale state and the
clock resumes. No reload, no user confirmation — the polling never stopped, and
with a first-failure threshold a "stale until reload" rule would strand the
view constantly.

**The first-load failure keeps its own message.** `!fleet.ready &&
!fleet.error` already renders *"Waiting for the first fleet scan…"*. That is a
different statement from *"this data is old"*: one has never had an answer, the
other no longer trusts the one it has. Do not merge them — an empty view must
not claim staleness it cannot have.

**Degrade, do not hide.** The last payload stays on screen. It is still the
best information available; what changes is the confidence around it.

The rule being fixed is already written in the file at line 313: *"a counter
ticking toward a refresh that is not coming is exactly the false statement the
countdowns exist to remove."* It was implemented for a **closed tab** and
misses a **dead server**.

### Done when

The plan's `## Done when` list is the specification — work through it literally.
Four assertions there exist because the naive test passes without them:

- Assert on **one** failure — a two-strikes implementation passes a test
  written against two.
- Assert the **recovery**, not only the failure: a stale flag that is never
  cleared passes every test that only checks it gets set.
- Assert the ages **freeze** — a test that only checks the banner passes with
  the clock still running underneath it.
- Assert the first-load message is **still distinct**.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run
validate` all pass; `pnpm build:board` run **in your own worktree** and the
artifact committed (CI gates on no-diff); a changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon
as it exists** — an agent on a sibling plan finished three commits without
pushing and the work was invisible to everyone, including to the checks that
gate the next dispatch.

### Scope guard

`packages/board/src/app/**` and its tests.

**Ordering:** the sibling wave `bug/board-binds-port-zero` is held back on
purpose. Source overlap between the two is zero, but both must rebuild and
commit `skills/plot/scripts/board/board-server.mjs`, a minified bundle where
concurrent rebuilds collide unresolvably. The same constraint applies to
`agent-view-phase`, in flight now. Rebuild the artifact, but expect to rebase
onto whatever landed first.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
