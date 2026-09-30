## Implementation brief — a-plan-row-names-its-ticket

- **Plan (canonical):** `docs/plans/2026-09-30-a-plan-row-names-its-ticket.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session
- **Branch:** `feature/a-plan-row-names-its-ticket` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

One slice, one wave. Nothing waits on it and it waits on nothing.

### What to build

A plan that answers a tracker issue (`- **Issue:** #1104`) shows only its slug on the board. The ticket row it replaced printed `1104: <title>`, so after the plan exists the key is on the board nowhere. The plan row's name label becomes `1104: <slug>`, `1090, 1091: <slug>` or `EWZKUS-3430: <slug>`, in the form `tupleFromIssue` already uses (`packages/board/src/app/lib/tuple-row.ts:1193`).

The chain is parser → `PlanMetaSchema` → `Card` / `DraftPlan` → `tupleFromPlan` → two callers. The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The parser changes nothing.** `plot-plan-meta.sh` already emits `issues[]`: `#1089` → `[1089]` (a number), `EWZKUS-3430` → `["EWZKUS-3430"]` (a string, only under a `jira`/`linear` tracker). Do not touch the script.

**The key is lost in `PlanMetaSchema`, not in the builders.** `readPlanMeta` (`packages/board/src/server/board.ts:1121`) parses each line through `PlanMetaSchema` (`packages/board/src/contract/schema.ts:61`), and zod strips the unknown `issues` key. A fix that adds the field to `CardSchema` only compiles and always yields `[]`. `PlanMetaSchema` gains `issues: z.array(z.union([z.number(), z.string()])).default([])`.

**The payload holds strings.** `CardSchema` (`schema.ts:396`) and `DraftPlanSchema` (`schema.ts:3842`) gain `issues: z.array(z.string()).default([])`. The card builder (`board.ts:~2007`) and `draftPlanOf` (`board.ts:2278`) copy with `.map(String)`, so `1089` arrives as `"1089"`. The row prints the key as the ticket row prints it, with no `#`.

**The client reads `?? []`.** The board client casts the payload and never parses it, so zod's `.default([])` does not apply in the browser. An older server sends no `issues` field. Each read in `rows.tsx:612` and `draft-plan-row.tsx:24` uses `?? []`.

**The label is decided in `tupleFromPlan`, not in a component.** `PlanRowFacts` gains `issues`, and `tupleFromPlan` (`tuple-row.ts:1269`) builds `${issues.join(', ')}: ${plan}` where the list is non-empty. That keeps the label a unit-testable property (CLAUDE.md, "Every rendered state is a domain property"). The prefix is inside the plan link, and the link still opens the plan.

**No tracker link.** A per-key URL needs the tracker's URL form, which the plan row does not have. Out of scope.

**Style.** `tupleFromPlan` is an existing `function` declaration. Passing through it does not license converting it. A new helper you write is an arrow.

### Done when

The plan's `## Done when` list is the specification. The assertions that catch a naive implementation:

- `issues: ["1089"]`, a **string** — catches a builder that forwards the parser's number.
- The Jira fixture (`Tracker: jira …` in the fixture's `CLAUDE.md`, served with `PLOT_REPO_ROOT`) — catches a test that only ever sees GitHub numbers.
- The **Draft** plan row prints its prefix — catches the second caller being forgotten.
- A card with **no** `issues` field renders the slug alone and throws nothing — catches a missing `?? []`.
- `packages/board/test/unit/draft-plan-row.test.ts:27` compares the whole draft entry with `toEqual`; add `issues: []` there.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run typecheck`, `pnpm run test:board` (browser tests load the built artifact, so run `pnpm build:board` first and commit the rebuilt `skills/plot/scripts/board/board-server.mjs`). Do not run `test:e2e` locally. Add a changeset with `'@plot-pm/board': patch` frontmatter and the plan's changelog line as its description; add `plan: docs/plans/2026-09-30-a-plan-row-names-its-ticket.md` in a trailing comment block.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `PR: #<number>` inside this slice's heading in the plan's `## Slices` section: `(Branch: feature/a-plan-row-names-its-ticket, PR: #<number>)`. Make that edit on `main`, not on this branch.

### Scope guard

This branch owns:

- `packages/board/src/contract/schema.ts` (three fields)
- `packages/board/src/server/board.ts` (card builder, `draftPlanOf`)
- `packages/board/src/app/lib/tuple-row.ts` (`PlanRowFacts`, `tupleFromPlan`)
- `packages/board/src/app/lib/agent-rows/rows.tsx`, `packages/board/src/app/lib/agent-rows/draft-plan-row.tsx`
- tests under `packages/board/test/`, the rebuilt board artifact, one changeset

Other branches in flight at dispatch (2026-09-30): `bug/a-fleet-agent-starts-without-the-operators-plugins`, `bug/every-state-file-declares-its-bound`, `bug/scripts-share-one-temp-helper`, `bug/the-suites-own-their-temp-root`. None of them touches the files above. All four can conflict on `board-server.mjs`: take either side, run `pnpm build:board`, and commit.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
