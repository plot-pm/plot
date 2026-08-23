## Implementation brief — the-derivations-leave-the-component (wave: Moved)

- **Plan (canonical):** `docs/plans/2026-08-23-the-derivations-leave-the-component.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session (five interrogation rounds)
- **Branch:** `infra/the-derivations-leave-the-component` (base: `main`)
- **Ends as:** one PR to `main`

Wave 2 (`infra/the-components-leave-the-shell`) is blocked on you and is NOT
yours. You move the derivations only; the components stay where they are.

### What to build

Move the derivations out of `packages/board/src/app/components/AgentList.tsx`
into **eight subject modules** under `packages/board/src/app/lib/agent-rows/`.

**This is a pure move. No function is rewritten, renamed, merged, split, or
re-signatured.** If a helper's shape looks wrong, that is a different plan.

### The decisions the plan settles — do not re-derive them

**Eight modules, by subject** — the plan's table is the specification:
`host-notes` · `collapse` · `waves` · `sections` · `activity` · `stuck` ·
`row-identity` · `actions`. A function goes where its SUBJECT is, not where its
line number was.

**No `misc.ts`.** A first cut of this plan named six modules and left ~1309
lines unaccounted; measuring the remainder found two real subjects
(`sections`, `stuck`) rather than a residue. If something fits none of the
eight, **stop and report it** — do not invent a ninth module to hold one thing,
and do not create a catch-all.

**NO RE-EXPORTS — this is the decision the refactor stands on.** All 14
importing files (13 of them tests) point at the module that owns the function.
A re-export block would leave `AgentList.tsx` naming all 65 symbols and being
edited by every module change: line count down, contention unchanged, which is
the one thing this plan exists to fix.

**`useChangeMarks` stays in `AgentList.tsx`.** It is a hook and belongs with the
components that call it. Do not move it to keep a boundary tidy.

Related trap, measured: the region above line 3009 *looks* to contain JSX and
hooks. Those hits are `<AgentRow` **generic type parameters** (`Pick<AgentRow,
…>`), not markup. `useChangeMarks` is the only genuine React construct up there.

**Docstrings travel with their functions, verbatim.** Several record measured
failures and are the reason the code is shaped as it is — `groupedNote`'s
default asserting *work landed — waiting to be merged* over five live blocked
waves whose branches had never been touched; *"a derivation is a guess with a
rule attached"*. A move that drops or scatters them loses reasoning this repo
has paid for more than once.

**One commit per module.** Eight commits in one PR. The commits are the review
unit — a reviewer reads `git log -p` per module rather than one 3000-line diff.
A commit that touches two modules, or that moves AND edits, is not a move.

### Done when

The plan's `## Done when` is the specification. The assertions that exist
because a naive implementation passes without them:

- **`AgentList.tsx` re-exports nothing** — assert by grep for an `export {`
  block forwarding a moved symbol. Every other assertion here passes with a
  re-export block in place, and so would the whole refactor while changing
  nothing about how branches collide.
- **`pnpm run test:board` green with NO test file edited except its imports.**
  Any change to a test's *expectations* means behaviour moved, and the move is
  then wrong.
- **No module imports another** except where a genuine dependency exists, and
  each such import is named in the PR body. Eight modules that all import each
  other are one module with extra files.
- Every moved function keeps its docstring; the diff shows moves, not rewrites.
- `useChangeMarks` is still in `AgentList.tsx`.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run typecheck`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

State the before/after line counts of `AgentList.tsx` in the PR body.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `AgentList.tsx` (removals only), the new `app/lib/agent-rows/` modules,
and the import lines of the 14 consumers.

**Do not touch the 18 components** beyond deleting the derivations above them
and fixing their imports. `Row`, `WaveRow`, `PlanRow`, the menus and the marks
are wave 2's.

**`AgentList.tsx` is the most contended file in this repo** — all 60 of the last
60 commits touching it touched it. Land promptly and push early; a long-lived
branch here rebases across everything.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
