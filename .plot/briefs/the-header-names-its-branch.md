## Implementation brief — the-header-names-the-branch-it-is-serving (wave Found)

- **Plan (canonical):** `docs/plans/2026-08-26-the-header-names-the-branch-it-is-serving.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `bug/the-header-names-its-branch` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. Nothing waits on it and it waits on nothing.

### THE CAUSE IS FOUND — do not investigate, implement

The plan was written as *"instrument, then theorise"* because the cause had
survived a careful investigation. **It was found during interrogation.** Do not
re-run the elimination; it is all in the plan and all correct and none of it
reaches the defect.

`fleet.ts` calls `require('node:child_process')` **inside an ESM bundle**:

```ts
// mainCheckoutPath, fleet.ts:239
const { execFileSync } = require('node:child_process');
// readMasterAgentBranch, fleet.ts:276
const { execFileSync } = require('node:child_process');
```

The board artifact is ESM. The bundler emits a shim whose fallback throws:

```
Dynamic require of "node:child_process" is not supported
```

Reproduced verbatim against the shipped artifact's own shim. The bare
`catch { branch = '' }` swallows it, and `''` is exactly what the renderer
documents as *detached HEAD* (`AgentList.tsx:628`).

### BOTH call sites, and one of them fails first

`mainCheckoutPath:239` runs **before** `readMasterAgentBranch:276`. It throws,
returns `null`, and then `if (mainPath)` is false — so the second `require` is
never reached at all.

**Fixing only the visible one changes nothing.** That is Done-when 5, and it is
the assertion a naive fix fails.

### The fix, and the thing that hid it

1. Replace both dynamic `require`s with the **static import** the rest of the
   module already uses. A sibling reader three lines away does it correctly —
   the minified artifact shows `zg(...)` (static) beside `yd(...)` (the shim).
2. **Narrow the `catch`.** A bare catch turned a bundling error into a plausible,
   wrong, silent answer, and that is why five correct eliminations could not
   reach a one-line bug. A failure to RUN git must be distinguishable from a
   detached HEAD (Done-when 4).

### Done when

The plan's `## Done when` list is the specification — all six items. Two exist
because a naive fix passes without them:

- **Item 4** — a failure to run git is distinguishable from a detached HEAD.
- **Item 5** — BOTH `require` calls are fixed; they are on one path.

Item 1 is asserted **against the running board**, not only against the function:
the whole defect is that the function behaves differently in-process.

Plus: `pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`); use
`corepack pnpm` if the homebrew one misbehaves. **`pnpm test` is NOT a test run
here** — it is `skills add . --list`.

Add a changeset with `'@plot-pm/board': patch` frontmatter (package frontmatter,
NOT a skills `bumps:` block).

### Verifying it for real

The unit test will pass either way — `require` works under the test runner. The
defect only exists in the **bundle**, so:

```bash
pnpm build:board && node skills/plot/scripts/board/board-server.mjs &
curl -s localhost:<port>/api/fleet | python3 -c 'import json,sys; print(repr(json.load(sys.stdin)["masterAgentBranch"]))'
```

It must print the main checkout's branch, not `''`.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Found (Branch: bug/the-header-names-its-branch, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `mainCheckoutPath` and `readMasterAgentBranch` in
`packages/board/src/server/fleet.ts`, and their tests.

**Do not change the renderer.** `AgentList.tsx:628` correctly shows no row for an
empty branch — that behaviour is right and Done-when 3 pins it.

`fleet.ts` is large and other plans touch it. Keep the diff to these two
functions and the `catch` narrowing.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild**, then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
