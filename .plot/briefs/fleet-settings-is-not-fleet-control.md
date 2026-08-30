# Implementation brief — the-controller-answers-every-asker (slice 1: Naming)

- **Plan (canonical):** `docs/plans/2026-08-30-the-controller-answers-every-asker.md` on main
- **Branch:** `feature/fleet-settings-is-not-fleet-control` (base: `main`)
- **Ends as:** one PR to main
- **Runs first of four.** Nothing depends on it except the word it frees.

### What to build

Rename `fleet-controls` to `fleet-settings` — the module, its tests, and every
import. Measured 2026-08-30, **14 files**:

```
src/server/fleet-controls.ts          src/contract/schema.ts
src/server/fleet.ts                   src/server/index.ts
src/server/auto-dispatch.ts           src/app/components/FleetControls.tsx
src/app/components/AgentList.tsx      test/fleet-controls.test.mjs
test/unit/schema.test.ts              test/write-gate.test.mjs
test/unit/auto-dispatch.test.ts       test/unit/auto-dispatch-spawn.test.ts
test/integration/fleet-controls.browser.test.ts
test/integration/tuple-row.browser.test.ts
```

The React component `FleetControls.tsx` is a **control surface** and keeps its
name — it is the thing an operator clicks. What moves is the server module that
holds the settings behind it. Use judgement per identifier; the plan's target is
the module name and the word `controllers/`.

### The decisions the plan settles — do not re-derive them

**Why a rename gets its own slice.** *"A pure rename is the one thing a reviewer
can check completely."* Folded into the Asking slice, the same diff would carry
a rename **and** a new layer, and neither could be read without the other.

**Why now rather than later.** Running it after the controller exists means
renaming files the other slices just created.

### Done when

The plan's list: no module named `fleet-controls` remains; `pnpm test:board`
passes **unedited**; the name `controllers/` is free.

**"Unedited" is the assertion that carries this slice** — a rename that needed a
test changed is not a rename. If a test needs a real edit, that is a finding to
report, not to absorb.

Plus: `pnpm run typecheck`, the board artifact rebuilt (`pnpm build:board`), a
changeset with a `'@plot-pm/board': patch` frontmatter (not a `bumps:` block —
this is the board package, not a skill).

### Scope guard

The rename and nothing else. No controller, no route change, no behaviour.
`schema.ts` and the browser tests are in the list because they mention the
name — that is the only reason they are touched.

Anything you find that wants fixing goes in the PR description, not the diff.
