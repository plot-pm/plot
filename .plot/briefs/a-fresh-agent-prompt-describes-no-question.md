## Implementation brief — desk-markers-and-the-reaper (wave: Fresh agent)

- **Plan (canonical):** [docs/plans/2026-10-17-desk-markers-and-the-reaper.md](../../docs/plans/2026-10-17-desk-markers-and-the-reaper.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1976 merged
- **Branch:** `bug/a-fresh-agent-prompt-describes-no-question` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

`bug/the-reaper-reads-the-desk-loop-and-the-root-marker` goes first in this plan — it is the only slice that can delete work — but holds no file this slice touches, so there is no ordering dependency to wait on.

### What to build

Issue #1843 folds #1389 and #1386 into this slice. **Re-check every finding below against main before changing anything — several of them no longer hold, and the plan requires recording that in its Open Questions before code changes.** The repo has moved substantially since both issues were filed (commit `be2033d1e`, "A dead agent gets a fresh agent," landed the `fresh`/per-ending composed-answer machinery this brief describes below), so most of what #1389 and #1386 describe as missing already exists on `main` at `89f56b3d8`. What follows is this slice's starting map, not a guarantee every item is still open.

**Still open, confirmed by reading `main` at `89f56b3d8`:**

1. **The marker-less fresh-start prompt still describes a marker and a question that are not there (#1389's core finding).** `composeContinuation` (`packages/fleet/src/shared/continuation.ts:204-215`) unconditionally opens with *"A previous worker on this branch stopped to ask a question... The question has been answered below"*, and unconditionally closes (`:257-259`) with *"The blocked marker that stopped the previous run is still in this tree... yours to delete."* Both are true for a marker-driven continuation and false for a `fresh` one: `continueOnDesk` (`:578`) already computes `freshAsked = input.fresh === true && endingAsksFreshStart(ending, branch)` and accepts a desk with `question === ''` on that path, but `composeContinuation` receives `question` as a plain string and branches only on `if (question)` (`:217-219`) for the middle section — the opening and closing paragraphs do not branch at all. A `turn-limit` or `corrections-spent` fresh agent reads a prompt naming a marker and a question that never existed, and may spend a turn looking for either or deleting an unrelated `PLOT-BLOCKED*` file it finds elsewhere in the tree. Fix: thread a `marker: boolean` (or reuse `question !== ''`) into `composeContinuation` and give the opening and closing paragraphs their own marker-less wording — "the previous session ended: `<reason>`" in place of "stopped to ask a question," and no "before you finish" marker paragraph when there is none to clear.

2. **The empty-`PLOT-BLOCKED` case still can't be told apart from no-marker-at-all.** `worker-loop.ts:820-821`: `const markerText = await readMarkerText(worktree); if (markerText !== '') return { ...base, markerWritten: true, markerText };` — an existing-but-empty marker file reads identically to an absent one and falls through to "unlanded work with no marker" (row 11), which can end the loop `holding-work` with a `blocked-marker` refusal. #1386 names the fix as narrow: treat a `blocked-marker` refusal as not after-prompt, so a marker-free fresh start does not then start over that empty marker. Re-derive whether `endingAsksFreshStart`/`isBoundEnding` already route this correctly given the `holding-work` ending alone carries no distinction for "marker was empty" vs "marker was absent" — if the ending reason is the only signal reaching `freshAgentDecisions`, the fix may need a new field on the ending or a dedicated reason rather than a fix at the `worker-loop.ts` read site.

3. **`continueOnDesk`'s docblock still opens by saying marker is required unconditionally.** `continuation.ts:543-561`'s docblock for `continueOnDesk` says *"Starts a new worker on a desk that holds an unanswered `PLOT-BLOCKED` marker"* as its first line, then separately explains the `fresh` exception several paragraphs down. Low-cost fix, but still accurate as of `89f56b3d8` — the first line undersells what the function now does.

**Likely already closed — verify and record in the plan's Open Questions rather than re-fixing:**

- **The `dirtyPaths`/`heldFiles` per-tick read** (#1386's LOW item asking to read it only for `holding-work`): `registryd.ts:696-699`'s own comment now argues the opposite — it is "read for every candidate, though only an after-prompt `holding-work` decision's composed answer uses it — the same way every other field here is a reading taken once per candidate rather than only where the verdict is known to need it." This reads as a deliberate reversal of the original finding, not an oversight. Confirm it is still deliberate (check whether `bound`/`unreadable`/`quiet` also consume `heldFiles` via `dirtyTreeReading` at `:782-791` — they do), and record "no change; the read now feeds two verdicts" rather than re-removing it.
- **`priorFreshSessions`'s TSV read**: also feeds `nothingDoneDecisions` (`registryd.ts:1355`) as the shared allowance across the fresh-agent and nothing-done pipelines — `endingAction`'s own docblock (`ending-action.ts:933-944`) states the count is deliberately shared "so a slice that already spent its one fresh session on one ending gets `needs-a-person` from another rather than a second fresh session." #1386's "drop the read" suggestion is now contradicted by this design; do not drop it.
- **The duplicate test** (#1386's LOW item): `packages/domain/test/rules-ending-action.test.ts:73` ("asks a person on a second after-prompt holding-work ending") and `:93` ("asks a person after corrections-spent then holding-work — the count is shared across endings, not kept per-ending") assert the same verdict but the second one's own comment names the specific per-ending-counter bug it alone catches. These are not exact duplicates; read both before deciding whether to merge them, and if they stay separate, say why in the PR rather than leaving the issue's "duplicate" label unexamined. (Note: the file is `packages/domain/test/rules-ending-action.test.ts`, not `nothing-done-tick.test.ts` as #1386 implies by context — there is no `nothing-done-tick.test.ts` in this repo.)
- **`holdingWorkAnswer`'s TSDoc "argues history"** (#1386's LOW item): reading `ending-action.ts:388-402` now, `holdingWorkAnswer` carries no docblock at all above it — `boundAnswer` immediately below it (`:404-422`) has the substantial one, and it argues interface ("NOT `holdingWorkAnswer`, because the cause differs") rather than history. Check git blame on `holdingWorkAnswer` specifically; the finding may already be moot.

**Decided, not open:** per the plan's Open Questions, #1386's pre-#1371 endings get no one-time sweep — they age out under the reaper's normal rules. Do not write a sweep. If this slice wants the count the plan asks for ("the slice counts how many exist today and records the number"), that is a measurement to run and record in the plan, not code to ship.

### The decisions the plan settles — do not re-derive them

**Each finding gets its own re-check against current main before a fix, and a finding that no longer reproduces is recorded in this slice's notes and closed without a fix.** This is the plan's Design section, not a suggestion — three of the items above are flagged exactly because they read as already-fixed or already-contradicted during brief-writing, and re-deriving a fix for a settled design (the shared `priorFreshSessions` count, the heavier `heldFiles` read) would be new work the plan does not ask for.

**Rules carried over unchanged from `continuation.ts` and `registryd.ts`:** absent is not false — `heldFiles === null` (an unreadable listing) takes the same destructive-avoiding arm as a populated list, never the same arm as empty (`dirtyTreeReading`, `boundAnswer`, `holdingWorkAnswer` all keep `null` and `[]` apart); read the exit code/ok flag, not the emptiness. A refused continuation leaves no prompt file, no appended log, no removed `.plot-worker.exit` — any change to `composeContinuation`'s signature must still compose only after every refusal in `continueOnDesk` has already passed, never before.

**Style:** a helper you write or rewrite is an arrow (`CLAUDE.md`'s Domain Package rule — applies to any new code you author, not only `packages/domain/**`). A neighbouring `function` declaration in `continuation.ts`, `registryd.ts` or `worker-loop.ts` stays untouched; this is a function-level change, not a file-level rewrite. Comments state interface, not history — several existing comments in this area already argue rejected alternatives (`composeContinuation`'s own docblock is a good model); match that shape rather than narrating what changed.

### Done when

The plan's `## Done when` list is absent; its Slices line is the specification, lifted into concrete assertions:

- A `fresh`-started continuation (`turn-limit`, `corrections-spent`, or after-prompt `holding-work`, no marker in the tree) composes a prompt containing neither "stopped to ask a question" nor "blocked marker that stopped the previous run is still in this tree." It must fail on main first — write the test against current `composeContinuation`/`continueOnDesk` and watch it fail, per `superpowers:verification-before-completion`, before changing the composer.
- A marker-driven (non-`fresh`) continuation keeps both paragraphs unchanged — a regression test proving the fix is additive, not a rewrite of the marker-present path.
- Whatever the empty-marker investigation (item 2) concludes: either a test proving a `holding-work` ending from an empty-but-present marker is no longer read as after-prompt-eligible for a repeat fresh start, or a recorded note in the plan saying the finding does not reproduce as described and why.
- For every item moved to "likely already closed," the PR records the re-check's verdict (reproduces / does not reproduce, with the line read) rather than silently dropping it — the plan's Design section requires this regardless of outcome.
- Every new or changed assertion fails on an unmodified `main` before the fix lands — mutate once per test and watch it fail.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This branch touches `packages/fleet/src/shared/continuation.ts` and `packages/fleet/src/server/entry/{registryd,worker-loop}.ts` plus their tests, so expect the fleet-side vitest/typecheck entries and `packages/board/test/unit/continue-route.test.ts` if `composeContinuation`'s signature changes what the route's prompt contains. The suites in the `CI suites` key run in CI on every PR; do not run `pnpm run test:e2e` locally — it is CI's gate, not a local one (`CLAUDE.md` Testing). Add a changeset for `plot` with the description first and the `bumps:` block last — this is a `bug/` branch, so `patch` unless a fix changes an observable contract (a changed prompt body for `fresh` starts arguably is one; say so in the changeset if it reaches that far). `scripts/check-shell-lines.sh` refuses growth of shipped shell; this slice is expected to touch no `.sh` file, and if that changes, remove an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the branch holds a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Fresh agent` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/continuation.ts` (specifically `composeContinuation` and `continueOnDesk`'s marker/fresh handling), `packages/fleet/src/server/entry/worker-loop.ts` (the empty-marker read around line 820), and `packages/fleet/src/server/entry/registryd.ts` only where the re-check in item 2 requires a field change to feed the distinction through to `freshAgentDecisions` — not the `heldFiles`/`priorFreshSessions` machinery itself, which this brief's research found already settled.

The plan's other three slices touch different call sites with no declared order against this one: `bug/the-reaper-reads-the-desk-loop-and-the-root-marker` (reaper, `--stop`, marker-root-only match — different files), `bug/the-ending-ask-record-stays-bounded` (needs-a-person: branch check, PR body grep, ask-record TSV — overlaps `registryd.ts` but a different section, the ask-record path rather than the fresh-agent decision path), and `bug/drop-reads-a-merged-desk-as-finished` (drop/`mergedDeskState` — different call site entirely). Verify at dispatch time whether `bug/the-ending-ask-record-stays-bounded` also touches `registryd.ts`'s fresh-agent readings — if both branches edit the same function, that is a known fact to report, not a surprise at merge time. If you find something the plan did not anticipate, report it rather than improvising outside scope.
