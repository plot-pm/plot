# Implementation brief — the-domain-owns-the-agent-lifecycle (Declaring)

- **Plan (canonical):** `docs/plans/2026-09-03-the-domain-owns-the-agent-lifecycle.md` on main
- **Approved:** 2026-09-03, Jan Wloka, pr (#676) — 3 rounds of interrogation
- **Branch:** `feature/an-agent-declares-what-it-is` (base: `main`)
- **Ends as:** one PR to main
- **Runs first.** Five slices follow and all of them read this record.

### What to build

The record that declares an agent: **its location, its fields, and what it
refuses.** Plus one consumer, so it cannot ship as a record nobody reads.

### The decisions the plan settles — do not re-derive them

**An agent today has a receipt, not an identity.** Every field of `AgentEntry`
(`packages/board/src/server/registry.ts:105`) describes a RUN — `session`,
`resumeId`, `attempts`, `branch`, `worktree`, `command`, `startedAt`, `pid`,
`previousPid`, `relaunches`, `state`. None describes an agent. That is the gap
this record fills, and it is why the record must carry **no run fact**: a
declaration holding `pid` or `branch` would be a second copy of the manifest,
which is the exact duplication being removed.

**Capability, not skill.** This repo already uses *skill* for `skills/plot/*`
and states *"skills interpret and adapt; scripts collect and report"*
(`CLAUDE.md:162`). Two meanings for one word in a repo with a vocabulary
section is how `Wave`/`Slice` drifted — measured 2026-09-03, the board still
carries **1,794 uses of "wave" against 225 of "slice"** while the domain is
21:234 the other way. Do not add to that.

**The consumer is the PROMPT, and the seam is not where round 2 thought.**
Three facts, all measured 2026-09-03:

- `Worker command` (`CLAUDE.md:32`) is `plot-worker-loop.sh` — **the loop, not
  a harness.**
- The real invocation is `.plot/worker-prompt.sh:6`, where `claude -p`, the
  model and the entire instruction string are **one fused line**.
- `prompt_file` is hardcoded at `plot-worker-loop.sh:526`: **one prompt per
  repo, not one per agent.**

So the first consumer is the prompt's **resolution** — the loop asks which
prompt this agent runs, instead of assuming the repo's one. **A branch with no
declaration keeps `.plot/worker-prompt.sh`**, so nothing on the estate changes
until a declaration exists.

**Where it lives is an Open Question, and it is yours to close.**
`.plot/agents/` holds transient manifests that `drop.ts:258` unlinks; a
permanent, human-authored record there mixes two lifetimes. Decide, and say why
in the PR.

### Done when

- The record parses, and **a test asserts it carries no run fact** — the
  property that keeps it from becoming a second manifest.
- **`plot-worker-loop.sh` resolves its prompt through the declaration**, and a
  branch without one still runs `.plot/worker-prompt.sh` unchanged. Assert both
  arms: the estate today has zero declarations, so the fallback is the path
  every existing worker takes.
- The location is chosen and the reason is stated.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run typecheck`, `pnpm build:board`, a changeset. **Do NOT run
`pnpm run test:e2e` locally** — CI owns it.

**Domain package rules apply** (`CLAUDE.md` › The Domain Package): arrow
functions, factual TSDoc that says what an export does rather than narrating
the decision, and the layering rule — controller → domain → port ← adapter →
script.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's bullet under
`### Declaring` — this plan uses `## Branches` bullets, so the **trailing
arrow** is correct, not the `(Branch: x, PR: #N)` heading form. Push the first
real commit as soon as it exists.

### Scope guard

This branch owns the record and the prompt resolution. It does **not** own:
the task-state rule (slice 2), the registry's state enum (slice 3), the ending
channel (slice 4), `--session-id` (slice 5), or the context reading (slice 6).

**It does not schedule.** Declaring agents makes *choosing* one possible and
does not perform it; `hasRoomToDispatch` (`packages/domain/src/entities/machine.ts:99`)
is a boolean about headroom, not a choice among candidates. If you find the
record needs a field only a matcher could justify, say so in the PR rather than
adding the matcher.
