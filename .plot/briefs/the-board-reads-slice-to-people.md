# Implementation brief — the-board-says-slice (Saying it)

- **Plan (canonical):** `docs/plans/2026-09-03-the-board-says-slice.md` on main
- **Branch:** `infra/the-board-reads-slice-to-people` (base: `main`)
- **Ends as:** one PR to main
- **Runs first**, and delivers the entire user-facing benefit on its own. The two slices after it are code hygiene.

### What to build

Every **user-visible string and comment** in `packages/board/src` that says *wave* where it means *slice*. **No identifier changes** — not one — so the diff reviews as prose and `git blame` moves for text only.

### The failure this fixes, verbatim

`packages/board/src/app/lib/agent-rows/stuck.ts`:

```
:145  case 'unsliced-wave': return 'wave not sliced';
:218  ' — a wave is carried out in one branch, so this plan needs slicing'
```

**The verdict is right and the sentence contradicts the spec.** A Slice holds exactly one branch; a Wave *"spans plans"* and is supposed to hold many (`DESIGN-slice.md`, `entities/wave.ts:22`). Read literally, `:218` says a wave must hold one branch — the opposite of what a wave is. An operator learning the model from the board learns it backwards, and the author of the plan this warning fired on had already made that exact mistake.

Other strings measured 2026-09-03: `"3 waves"`, `"a plan with no subheadings is one wave"`, `"how many of my waves are not here"`, `"prepare the whole wave"`.

### The decisions the plan settles — do not re-derive them

**The board's `Wave` IS a Slice, and this is measured rather than argued.** `contract/schema.ts:1659` defines `{ plan, name, branches }` — *"WHICH PLAN this wave belongs to"*, named by *"its `### ` heading in the plan file"*. Belonging to one plan and named by a heading is the definition of a Slice. **58 waves on this estate, every one holding exactly one branch** — not one has ever held the many that would make it a cohort.

**The domain's `Wave` is the one correct use in the repo** (`entities/wave.ts:22`) and is not touched by any slice of this plan. If you find a board string that genuinely means *the fleet's cohort across plans*, leave it and say so in the PR — that is the one exception, and it is worth more than a silent rename.

**`branches` stays plural.** The array is what lets the board DETECT an over-full slice; the warning above exists because it can. Nothing here makes it singular.

### Done when

- **A two-branch heading produces a message that names a slice.** Assert the rendered text, not the enum — the failure was the sentence, and a test on `'unsliced-wave'` would pass while the prose stayed wrong.
- No identifier changed: `git diff` shows no `WaveRow`, `waveGroupsFor`, `WaveSchema` rename. That is slice 2's work and keeping it out is what makes this one reviewable.
- The four other strings above no longer teach the wrong model.

Plus the repo's gates: `pnpm test`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board` with the artifact committed, and a changeset. **Do NOT run `pnpm run test:e2e` locally** — CI owns it.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's bullet under `### Saying it` — this plan uses `## Branches` bullets, so the **trailing arrow**, not the heading form. Push the first real commit as soon as it exists.

### Scope guard

Strings and comments only. **Not** the type (slice 2), **not** `data-wave-row` or the tests that bind to it (slice 3). If a string is embedded in an identifier you would have to rename to change it, leave it for slice 2 and note it.
