## Implementation brief — a-slice-waits-on-every-branch-it-names (slice 1: Every wait reaches the verdict)

- **Plan (canonical):** `docs/plans/2026-10-02-a-slice-waits-on-every-branch-it-names.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/every-wait-reaches-the-verdict` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

This slice waits on `bug/the-queue-reads-the-scans-order`, which merged as #1247 (`76e774813`). Slice 2, `bug/the-parser-reads-every-wait`, waits on this one and changes the parser, the scan and dispatch.

### What to build

A slice with two prerequisites reads eligible while the first one has not merged (#1153). `plot-plan-meta.sh` keeps only the last `<!-- waits: … -->`, so the domain never sees the other name. This slice makes every domain and board reader take a list of prerequisites. It does not change what the parser emits, so behaviour on `main` stays the same until slice 2 lands. The scan still sends one name, and every reader here accepts that one name as a one-item list.

Concretely: `waitVerdict` and `prerequisiteCleared` take a list of prerequisites; `WaitsReading | null` becomes `readonly WaitsReading[]`; `PlanRecordBranch.waitsOn` and the `waits` hold in `rules/queue.ts` take a list; `FleetBranch.waits_on` becomes an array with a legacy preprocess; the board row sentence names every prerequisite. The plan is canonical. This brief records what the plan does not say and what drifted since it was approved.

### Decisions the plan settles — do not re-derive them

**The field is a list, not `waits_on` plus `waits_on_all`.** A second field keeps `waits_on` as a lossy first value, so every reader nobody migrates still reads one prerequisite and nothing fails to show it. A changed type fails where a reader is not migrated: TypeScript does not compile and the schema refuses.

**`blocked` outranks `waiting`.** Any `none` answers `blocked`, because a typo needs a plan edit and no merge clears it. Otherwise any `unmerged` or `unreachable` answers `waiting`. All `merged` answers `''`. An empty list answers `''`. `prerequisiteCleared` refuses on the first prerequisite that has not cleared, in the plan's order, and names it.

**Absent is not empty.** A branch that declares no wait carries no `waits_on` key on the wire. In the domain the same fact is `[]`. `plot-plan-meta.sh` never emits `[]`, and nothing here may turn an absent field into a declared one.

**The host is asked, never the refs.** `prerequisiteCleared` carries no ref field on purpose. `plot-release-refs.sh` deletes the refs of merged branches, so a rule that reads refs holds a dependent forever because its dependency succeeded. Keep `PrerequisiteReading` free of any ref.

**The pulse is read in both shapes.** `.plot/state/last-pulse.json` persists the old shape. `FleetBranchSchema` reads `"bug/a"` as `["bug/a"]` and `""` as `[]`. A schema with no preprocess refuses the persisted pulse of every running board.

### Drift since the plan was approved — verified on `76e774813`

The plan's file:line references predate #1247 and #1244. Re-find each by name. Measured today:

| The plan says | Now |
|---|---|
| `fleet.ts:4389`, `:5123`, `:6581` | `packages/board/src/server/fleet.ts:4750` (the `waitsOn = ''` parameter), `:5484` (the row sentence), `:7020` (the `b.waits_on` call) |
| `PlanRecordBranch.waitsOn: string` is added by #1100 | It is on `main`: `packages/domain/src/ports/plan-store.ts:77`, mapped at `adapters/plan-store/plan-store-shell.ts:62` as `raw.waits_on ?? ''` |
| the `waits` hold in `rules/queue.ts` | `QueuedBranch.waitsOn` and `waitHeld` at `queue.ts:100-111` and `:277-279`; the hold is built at `:640-660` through `prerequisiteAnswer` (`:564`) |

**Four readers the plan does not name.** Change all four in this slice, or `tsc` stops you and names them:

- `packages/board/src/server/entry/registryd-main.ts:1409` prints the held-list line `    <branch> — waits on <waitsOn> (<waitHeld>)`. A comment above it says the line **is grepped**. With one prerequisite the text stays byte-identical. With several it prints the prerequisites that still hold, joined with `, `, then the one `waitHeld` word. One word is enough: `prerequisiteAnswer` answers `unmerged` or `unreachable` from the single flag `listingWhole`, so it is the same for every prerequisite. A test asserts the exact line.
- `packages/domain/src/workflows/assign.ts:139-140` and `packages/board/src/server/mock-fleet.ts:572` hold `waitsOn: ''` literals. They become `[]`.
- `packages/domain/src/ports/plan-store.ts:77` is the type itself. `plan-store-shell.ts:62` must compile in this slice: write `raw.waits_on ? [raw.waits_on] : []` there. Slice 2 owns the real mapping of the array.
- `packages/domain/corpus/eligible.corpus.test.ts:276` and `branch-state.corpus.test.ts:284`, `:323` read `branch.waits_on` as a string from the parser. Map it to a list in the corpus (`''` to `[]`, a name to `[name]`). On a disagreement the branch stops: do not adjust either side to make the corpus pass (CLAUDE.md, *A Shell Script Asks The Domain*).

**`prerequisiteCleared` has no production caller.** `grep -rn prerequisiteCleared packages/*/src` returns the definition and the `index.ts` export only. Change its signature and its unit tests. Do not add a caller: that is a separate finding, and wiring one here widens the scope.

**Two functions are named `waitVerdict`, and they stay two.** `rules/eligible.ts:213` takes `PrereqAnswer` (`merged | unmerged | none | unreachable`). `rules/branch-state.ts:138` is private and takes `PrReading` (`OPEN | MERGED | CLOSED | none | unreadable`). Both take a list in this slice with the same precedence: `none` or `blocked` first, then waiting, then clear. Do not merge them. The two vocabularies differ, and a merge is a refactor with no behaviour change.

### The entry reads two parallel columns

`packages/board/src/server/entry/branch-state.ts:190-210` reads the scan's tab-separated line: field 9 is the prerequisite name (`-` for none) and field 10 is its PR state (`?` for *not read yet*). The plan says the entry reads "a comma-separated waits column". Field 10 must be a parallel comma-separated list in the same order, because each prerequisite has its own PR state. The scan's producer for that column (`waits_pr_state "$waits_br"`, `plot-fleet-scan.sh:4276-4284`) is slice 2's work. This slice only reads the format.

- One name and one state, which is what the scan sends today, give a one-item list.
- A name list and a state list of different lengths is a defect in the scan. Throw naming the line, as `countFrom` does for a bad count. Do not guess a zip.
- `-` gives `[]`. `?` gives `[]` too, as today (`null` there). The entry also returns `waitsBranch` and a second-column answer on whether a prerequisite is *named but not yet read*. Keep that distinction: the rule's `REPLACEABLE_BY_PREREQUISITE` and the scan's second ask depend on it. Both `-` and `?` give an empty reading list, so the entry must still say which one it saw.

### The board row sentence cannot say "still holds"

The plan says the row names each prerequisite that still holds the slice. The pulse cannot say that. `waits_on` is *the declaration, not the verdict* (the comment at `domain/src/entities/fleet.ts:192-200`): it is present after a prerequisite merged, so a reader learns why a slice became startable. A pulse carries no per-prerequisite answer.

So the sentence names every declared prerequisite: `waits for bug/a and bug/b` (three or more: `bug/a, bug/b and bug/c`). For `blocked`, the existing wording *"which has no pull request"* is wrong with several prerequisites, because only one of them may lack a PR. Write `waits for bug/a and bug/b, one of which has no pull request`. Keep the one-name sentences byte-identical. Say in the PR body that the sentence names declared prerequisites and not only those still holding the slice. Adding a per-prerequisite answer to the pulse is a plan amendment. Report it, and do not build it here.

### Done when

The plan's `## Done when` list is the specification. For this slice that is the `packages/domain` unit tests, the `packages/board` unit test, and the typecheck and coverage gate. The `test/reconcile` and `parser.test.mjs` items belong to slice 2.

Assertions that exist because a naive implementation passes without them:

- **A list of one is not a list of two.** Test `[merged, unmerged]` and `[unmerged, merged]`: a rule that reads only the first or the last element passes one of the two.
- **`blocked` over `waiting` in both orders.** `[unmerged, none]` and `[none, unmerged]` both answer `blocked`. An early `return 'waiting'` in a loop passes the first and fails the second.
- **The queue clears only when every prerequisite is in the merged set.** One merged and one unmerged prerequisite holds as `waits`, and `waitsOn` in the held entry names only the unmerged one.
- **`''` and `"bug/a"` through the schema.** A pulse from before this change must parse. Keep a test that feeds the old shape literally.
- **The held-list line, one name.** Assert the old line byte for byte. The grep that depends on it fails silently otherwise.
- **Row sentence, one prerequisite, unchanged.** Assert the old text for `waiting` and `blocked`.
- **100 % branch coverage** holds for the touched rules, including the empty list and both `-` and `?` in the entry.

Plus: rebuild the bundles with `pnpm build:board` and commit what changes. On a conflict in `board-server.mjs` do not read the diff: take either side and rebuild. Add a changeset for `plot` and `@plot-pm/board`, copying the format of `.changeset/a-closed-pr-carries-no-branch.md`: package frontmatter, the description first, the `plan:` and `bumps:` block last. Files in `.changeset/` that are not yours belong to sibling branches: touch none.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI. A failure there comes back as a correction. Do not run `pnpm run test:e2e`.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Slice 2 waits on this slice's merge.

New functions are arrows. TSDoc states what an export does, its parameters, its result and how it fails. The reasoning goes in the commit message. Add no new use of `Wave` where `Slice` is meant.

### Scope guard

This branch owns:

- `packages/domain/src/rules/eligible.ts`, `rules/branch-state.ts`, `rules/queue.ts`
- `packages/domain/src/transitions/slice.ts`
- `packages/domain/src/entities/fleet.ts`, `ports/plan-store.ts`, `workflows/assign.ts`
- one line in `adapters/plan-store/plan-store-shell.ts` (`:62`)
- `packages/domain/corpus/` (the two files above)
- `packages/board/src/server/entry/branch-state.ts`, `entry/registryd-main.ts`, `fleet.ts`, `mock-fleet.ts`
- tests for each, the rebuilt bundles and one changeset

This branch must not touch `skills/plot/scripts/plot-plan-meta.sh`, `plot-fleet-scan.sh`, `plot-dispatch.sh`, `plot-reconcile-scan.sh` or any test under `test/reconcile/`. Slice 2, `bug/the-parser-reads-every-wait`, owns them. Checked on `76e774813`: no branch in flight diffs against `main` on any file this branch owns.

If you find a reader of `waits_on` or `waitsOn` that neither the plan nor this brief names, report it in the PR body rather than improvising outside scope. A reader found after this slice belongs to slice 2.
