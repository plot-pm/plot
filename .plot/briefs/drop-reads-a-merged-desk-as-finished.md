## Implementation brief — desk-markers-and-the-reaper (wave: Drop)

- **Plan (canonical):** `docs/plans/2026-10-17-desk-markers-and-the-reaper.md` on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1976 merged
- **Branch:** `bug/drop-reads-a-merged-desk-as-finished` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review (no project board configured)

This is the fourth of the plan's four slices. The other three — Reaper, Fresh agent, Needs a person — touch different files and carry no declared order against this one.

### What to build

Issue #1564: the board's `/api/registry/drop` route can refuse to drop a desk whose work already merged. `handleDrop`'s `classifyState` (`packages/board/src/server/drop.ts:158-181`) calls the injected `liveness()` resolver directly and only re-derives the answer when the shell says `finished` (via `rowState`, line 176). It never re-derives a `waiting` answer. Compare `packages/fleet/src/shared/registry.ts:999-1047` (`refreshStates`), which is the correct reference: for a `waiting` answer it reads the PR index once and calls `mergedDeskState` (`packages/domain/src/rules/merged-desk.ts:47`) to promote the desk to `finished` when its branch has a MERGED row and its worker pid is not alive. `classifyState` skips this promotion entirely, so a desk whose branch merged — and whose worker already exited — still classifies as `waiting`. `LIVE_STATES` (`packages/board/src/contract/schema.ts:3625`, `{running, waiting}`) then refuses the drop with "cannot drop a waiting worker — the agent is still running," even though nothing is running and the work is already on `main`.

Issue #1784 (two findings from PR #1748's review): (1) a TSDoc placement defect — `packages/fleet/src/shared/registry.ts:1081-1087` carries a doc block describing `defaultPrIndex` positioned above `defaultLiveness` (line 1104, which has no doc of its own); the two functions' comments are swapped/misplaced. (2) a possibly-weak "full path" test: `packages/domain/test/clean-wait-end.test.ts`'s first `describe` block (lines 52-66, "a free loop that ends at the wait bound — the full path") may assert nothing beyond what `agent-loop.test.ts` and `reapable.test.ts` already assert individually. Check before touching it.

### Decisions the plan settles — do not re-derive them

**`mergedDeskState` already exists and is already correct.** Slice 1 (Reaper) and this slice route callers to the existing rule rather than writing a new one — the plan's Design section says so explicitly ("`deskLoopAlive` ... and `mergedDeskState` ... already exist, so slices 1 and 4 route callers to them rather than add rules"). Do not touch `packages/domain/src/rules/merged-desk.ts` unless a reproduction proves its logic itself is wrong — nothing found so far suggests that; the defect is `drop.ts` never calling it, not the rule misbehaving.

**Reproduce before fixing.** The plan's Design section requires each slice to first reproduce its issues' findings on main with a failing test, because the issue verdicts date from `c40ac9e96` (2026-10-16) and main has moved since. Write a test against `classifyState`/`handleDrop` that sets up a `waiting`-answering liveness stub with a merged PR-index row and a dead pid, and confirm it currently returns `dropped: false` with the "still running" reason before changing any source. If a finding no longer reproduces, record that in this slice's notes (append to the plan's `## Slices` entry or a dedicated notes line) rather than writing a fix for it.

**The fix is a call-site fix, not a new abstraction.** `classifyState` already has everything `refreshStates` has: a `LivenessResolver`, a `PidLiveness`, and (via `DropOptions`) enough to construct a `PrIndexReader`. The minimal change threads a PR-index reader into `classifyState` (or `handleDrop`) and applies `deskBranchMerged` + `mergedDeskState` to a `waiting` answer the same way `refreshStates` does — read the index once, read the pid only when the branch is merged, and let any throw leave the shell's `waiting` answer standing (never invent a promotion from a failed read). Do not duplicate `refreshStates`'s batching logic; `classifyState` handles one entry, so the single-entry shape in `merged-desk.ts` applies directly without `refreshStates`'s `Promise.all` batching.

**`defaultPrIndex`'s construction is already right; only extract it for reuse if `drop.ts` needs the same reader shape.** `registry.ts:1096-1102` builds a `PrIndexReader` from `hostShell(...).backend()` and `prIndexFile(...).read(backend.value)`, defaulting to `null` on any failure — the same "absent is not false, a missing store means ask the host" contract this repo keeps elsewhere. `DropOptions` has `repoRoot` (from `BuildBoardOptions`) but currently no `scriptsDir` or PR-index reader field; decide whether to add an optional injected reader (test seam, matching the `liveness`/`pidAlive` pattern already on `DropOptions`) or export and reuse `defaultPrIndex` from `registry.ts`. Prefer the injected-reader-on-`DropOptions` shape — it matches how `liveness` and `pidAlive` are already threaded through this file, and keeps `drop.ts` free of a direct dependency on `registry.ts`'s private `defaultPrIndex`.

**The doc-placement fix for #1784 finding 1 is purely textual.** Move the TSDoc currently sitting above `defaultLiveness` (packages/fleet/src/shared/registry.ts:1081-1087, "The default liveness resolver, or a no-op...") so it documents `defaultLiveness` itself, and move the block below it (1088-1095, "The default PR index reader...") so it documents `defaultPrIndex`. No behavior changes; verify with a diff that only comment text moved.

**Absent is not false — read the exit code, not the emptiness, carried over from the rest of this plan.** `deskBranchMerged` returns `false` for a missing store, an empty branch, or a missing row — never a basis for concluding "known not merged." Keep that distinction in the new call site: a read that throws or returns `null` must leave `waiting` standing, exactly as `refreshStates` does, rather than being read as "confirmed not merged."

### Done when

The plan's `## Done when` is implicit in its per-slice issue list; this slice is done when:
- A new test on `classifyState`/`handleDrop` reproduces #1564 failing on main (a `waiting`-answering desk with a merged PR-index row and dead pid refuses to drop), then passes after the fix.
- The existing `packages/board/test/unit/drop.test.ts` suite still passes, including its live-worker refusal case (`waiting` with no merged row must still refuse — the fix only promotes a *merged* `waiting` desk, never every `waiting` desk).
- The `defaultLiveness`/`defaultPrIndex` doc swap in `registry.ts` is corrected with no behavior change.
- `clean-wait-end.test.ts`'s "full path" describe block (lines 52-66) is checked against `agent-loop.test.ts` and `reapable.test.ts` for redundancy; if it asserts nothing new, note that in the slice and either trim or justify keeping it — do not silently leave #1784's open question unanswered.
- The plan's open question "Which of the ten findings still reproduce on main?" gets its answer recorded for this slice's two issues (#1564, #1784) before or alongside the fix — in the plan's Open Questions section or this slice's own notes.

Plus: the repo's gates — no generated board bundle in the diff (`scripts/check-no-bundle-diff.sh`), any changeset this slice needs (likely a `plot` patch changeset describing the drop fix, per `## Versioning` in CLAUDE.md), and the domain package's arrow-function-only rule for any new/rewritten function body in `packages/domain/src/`. For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it names the tests that touch your changed files, the related `@plot-pm/domain`/`@plot-pm/board` suites and typecheck, and the shell/doc gates. The suites in `CI suites` (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, `test/reconcile/*.test.mjs`) run in CI on the PR; do not run them locally as a matter of course — `test:e2e` especially is CI's gate, not a local one.

Name the shell gate explicitly: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. This slice is pure TypeScript/test work with no `.sh` touch expected — if that changes, growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once the branch exists and holds a commit: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `### Drop` subheading). Push the first real commit as soon as it exists, so the branch is not claimed-and-silent.

### Scope guard

This branch owns `packages/board/src/server/drop.ts` (`classifyState`, `DropOptions`, `handleDrop`) and, if the doc-swap fix is bundled here rather than left for whoever touches `registry.ts` next, the two misplaced comment blocks at `packages/fleet/src/shared/registry.ts:1081-1095`. It may also touch `clean-wait-end.test.ts` to address or document #1784's second finding, and whatever test file covers `drop.ts` today (`packages/board/test/unit/drop.test.ts`).

The plan's other three branches touch different files entirely, confirmed by their own briefs: `bug/the-reaper-reads-the-desk-loop-and-the-root-marker` (reaper/`--stop`/marker-root-match in the reaper's own call sites), `bug/a-fresh-agent-prompt-describes-no-question` (`continuation.ts`, `worker-loop.ts`, and a narrow slice of `registryd.ts`'s fresh-agent decision path), `bug/the-ending-ask-record-stays-bounded` (`registryd.ts`'s escalation/notify path and `ending-ask-record-file.ts`). Both sibling briefs independently record this branch as touching "different files entirely" / "a different call site entirely" — no overlap is expected, but verify at dispatch time rather than assuming it holds.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
