## Implementation brief — one-review-issue-per-pr-a (wave: Sprint goal from the template)

- **Plan (canonical):** docs/plans/2026-10-17-one-review-issue-per-pr-a.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1955 merged
- **Branch:** `bug/sprint-goal-reads-template` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `Review: pr` — standard PR review

This branch has no dependency on the plan's other two slices
(`bug/plot-review-one-issue-per-pr`, `bug/monitors-end-waits-for-pid`) and no
slice waits on it. All three may run concurrently; they touch disjoint files
(see Scope guard).

### What to build

A sprint written from the shipped template (`skills/plot/templates/sprint.md`)
serves an empty goal to the board. `2026-W42-bitbucket-jira-and-jenkins-work-with-the-board`
showed exactly this until someone hand-added a bold line in `4396b16af`.

Root cause: `parseSprintContent` (`packages/board/src/server/board.ts:1438-1441`)
extracts the goal by matching the first **bold** line inside `## Sprint Goal`:

```js
const goalMatch = goalBody.match(/^\*\*(.+?)\*\*/m);
```

But `skills/plot/templates/sprint.md` writes that section as plain text —
`<expanded goal description>` — with no bold line. So every sprint cut from
the template parses to `goal: ''` until a human manually bolds a line.

Fix the parser, not the template (see settled decision below): add a fallback
that reads the first non-empty line of the `## Sprint Goal` body when no bold
line matches.

### The decisions the plan settles — do not re-derive them

**Parser fallback, not template change.** The plan's Open Points list this as
an explicit either/or and picks the parser (`## Design > Approach`, #1883):
"the parser also reads the first non-empty line of `## Sprint Goal` when no
bold line exists, so existing sprints written from the template start serving
a goal with no edit. The template stays as it is." Changing the template
instead would only fix *future* sprints — every sprint already cut from the
old template (including any mid-flight ones) would still parse to `''` until
someone finds and edits it by hand. The parser fix covers both old and new
files with one change. Do not also edit `skills/plot/templates/sprint.md`.

**Fallback order matters.** Try the bold-line match first; only fall back to
"first non-empty line" when that match is absent. A sprint that *does* have a
bold headline (hand-written or already fixed) must keep using it — the
fallback is for the templated case only, not a replacement extraction
strategy.

**Test against the shipped template, not a synthetic fixture.** The plan
requires: "A test parses a sprint written from the shipped template and
asserts a non-empty goal." Read `skills/plot/templates/sprint.md` itself (or
a copy of its exact `## Sprint Goal` shape) into the test rather than hand-
rolling a fixture string — a hand-rolled fixture can drift from the real
template and pass while the real template still fails, which is the failure
mode `4396b16af`'s manual fix was papering over.

### Done when

The plan's `## Done when` is implicit in its Design section for this slice: a
sprint cut from the shipped template serves a non-empty `goal` through
`parseSprintContent`, with no edit to the sprint file and no edit to the
template.

Concretely:
- `parseSprintContent` (or the function it delegates to) gains the first-
  non-empty-line fallback, gated on the bold-line match returning empty.
- A unit test loads `skills/plot/templates/sprint.md`'s `## Sprint Goal`
  shape (templated placeholder text, not bolded) and asserts
  `parseSprintContent(...).goal !== ''`.
- A second case keeps asserting the existing bold-line behavior still wins
  when present — don't let the fallback regress the already-working path.
- `skills/plot/templates/sprint.md` is untouched.

Plus the repo's gates: no generated board bundle in the diff
(`scripts/check-no-bundle-diff.sh`), and a changeset bumping `plot` (this
touches `packages/board/src/server/board.ts`, which also needs
`@plot-pm/board` bumped per `scripts/check-changeset-packages.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints — it resolves the related `vitest` run and
`tsc --noEmit` for `packages/board/**` from your changed files. The suites in
the `CI suites` config key (`pnpm run test:board`, etc.) run in CI on every
PR; don't run the full board or e2e suite locally as a matter of course (see
CLAUDE.md `## Testing` — `test:e2e` is CI's gate, not a local one). A local
checks failure comes back as a correction.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not
apply.

### Bookkeeping

Open the PR through the controller once the branch is pushed, never
`gh pr create` by hand:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads this plan's `## Slices` entry for `bug/sprint-goal-reads-template`,
titles the PR from that slice's wave heading ("Sprint goal from the
template"), and links the plan and this brief in the body.

Push the first real commit as soon as it exists — don't hold a finished diff
unpushed.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section (under "### Sprint goal from the template").

### Scope guard

**Owns:** `packages/board/src/server/board.ts` (the `parseSprintContent`
function and its goal-extraction logic only — do not touch unrelated parsing
in the same file) and a new/extended unit test under
`packages/board/test/unit/` (likely alongside `sprint-item-readers.test.ts`
or a new `sprint-goal.test.ts`).

**Does not own:** `skills/plot/templates/sprint.md` (explicitly left alone —
see settled decision above).

**Siblings in flight on this plan** (verify at dispatch time via
`git ls-remote --heads origin`, not assumed — none existed as of this brief):
- `bug/plot-review-one-issue-per-pr` — touches `packages/board/src/server/entry/review.ts`
  and the tracker port; no overlap with `board.ts`'s sprint parsing.
- `bug/monitors-end-waits-for-pid` — touches `test/e2e/monitors-end.test.mjs`
  and `skills/plot/scripts/plot-worker-loop.sh`; no overlap.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
