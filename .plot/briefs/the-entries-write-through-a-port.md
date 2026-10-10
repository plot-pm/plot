## Implementation brief — the-controllers-close-their-review-findings (wave 2: The entries write through a port)

- **Plan (canonical):** [docs/plans/2026-10-10-the-controllers-close-their-review-findings.md](../../docs/plans/2026-10-10-the-controllers-close-their-review-findings.md) on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1498 merged
- **Branch:** `bug/the-entries-write-through-a-port` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Wave 1 (`bug/the-approval-asks-the-domain`) merged as PR #1506. This wave is independent of waves 3 and 4 — nothing here touches `implement-run.ts` or `workflows/merge.ts` — but it is listed second because it, like wave 1, edits `entry/approve.ts`; land it before starting wave 3 or 4 to avoid a stale read of that file.

### What to build

`entry/approve.ts` and `entry/deliver.ts` import `node:fs` directly and write the plan file, `.plot/hold`, and the sprint file with `writeFileSync`/`appendFileSync` — a violation of the Layering Rule's *"an adapter is the only place that reaches the world."* `scripts/check-script-names.sh:142-143` already names the gap: *"`plan-store` reads only."* Confirmed on this branch: `PlanStore` (`packages/domain/src/ports/plan-store.ts`) exposes `readPlan`, `readPlans`, `listPlans`, `config` — four reads, zero writes. The entries also hand-parse `.git` to find the main checkout and the common dir (`commonDirOf` `approve.ts:386`, `mainRootOf` `:401`, `excludeDeskRoot` `:412`), duplicating what `Trees` (`packages/domain/src/ports/trees.ts`) already does with real git commands elsewhere in the same package.

This slice gives `PlanStore` one write operation and gives `Trees` a main-root reading and a desk-root exclusion, then deletes the three hand-rolled `.git`-parsing functions and every direct `node:fs` call these two entries make for plan/hold/sprint files.

### The decisions the plan settles — do not re-derive them

**One write operation on `PlanStore`, not four.** The plan file, the sprint file, and `.plot/hold` are all "a repository-relative file," and `findPlanFile` (`approve.ts:136`, `deliver.ts:171`) and `annotateSprint` (`approve.ts:311`, `deliver.ts:475`) both need a directory listing first. Add one write method plus the listing `PlanStore` is missing — do not add a `writeHold`/`writePlan`/`writeSprint` trio. The plan's own Open Question (still unresolved, see below) is whether `.plot/hold` belongs on this port at all; resolve it before splitting the write into two ports, not after.

**Write atomically: temp file + rename, matching `pr-index-file.ts`.** `packages/domain/src/adapters/pr-index/pr-index-file.ts:140-141` is the precedent already in this package: `writeFile(temp, …)` then `rename(temp, path)`. `rename` on the same filesystem is atomic, so a reader never observes a half-written plan or sprint file. Do not reuse `node:fs` `writeFileSync` inside the new adapter — the whole point of moving the call is that only the adapter may still hold it, and it must hold the safer form the old entry code never had.

**Replace `.git` hand-parsing with `git rev-parse --git-common-dir` and `git check-ignore`, not a rewrite of the existing parser.** `commonDirOf` reads `.git` as a file, extracts `gitdir:`, and reads `commondir` inside it by hand; `mainRootOf` derives the main root from that; `excludeDeskRoot` reads and appends to `info/exclude` by hand, checking membership by reading the file's lines itself. All three are git operations with no adapter — the plan's Design section names the replacement explicitly: `git rev-parse --git-common-dir` for the common dir, `git check-ignore` to test membership before appending to `info/exclude`. Add both to `Trees` rather than inventing a second port — `Trees` already owns every other "ask git about this checkout" operation (`currentBranch`, `userEmail`, `originHead`, `hasRef`), and a main-root reading is the same shape.

**The fetch exemption in `no-network.test.ts` narrows to one method body.** `packages/board/test/unit/no-network.test.ts:94` currently exempts the whole file `trees-git.ts` from the "no `fetch` string" and "no `trees.fetch(` call" checks. The plan requires narrowing this to exempt only `Trees.fetch`'s own method body — confirm this by reading the test's current filter (`s.file !== 'trees-git.ts'`) and tightening it to match only within that one method, so a *new* operation added to `trees-git.ts` that happened to contain the word "fetch" in a comment would not silently pass. This is a test-file change, and getting the regex/AST boundary right is worth time — a too-loose match defeats the gate's purpose.

**The two README rows must state the receipt's scope, not just the operation.** `skills/plot/scripts/README.md:31-32` today says nothing about a completed approval or delivery leaving "a receipt keyed by the plan's path in the caller's checkout" or that the receipt "permits one commit of the same `State:` value on that path" (#1447 L2). This is a documentation-only finding but it is explicitly in scope — don't skip it because it touches no code. It exists because `plot-state-gate.sh` trusts a receipt keyed by path, and an undocumented scope is how a second write slips past the gate unnoticed.

**`sprint-annotation.ts:7`'s TSDoc states current behavior only — delete the history.** Per `CLAUDE.md`'s "Factual API documentation" rule (measured there at a 4:1 comment-to-code ratio repo-wide), rewrite the block to say what the function does and drop anything narrating when a field was added or removed. The existing text already names `status:` as removed — that sentence is exactly what this finding wants gone; a reader five years from now does not need the removal's history, only that `status:` does not exist.

### Done when

The plan's `## Done when` is implicit in its per-finding table (reproduced below) — no explicit `## Done when` heading exists in this plan, so treat each row tagged for this slice as the specification:

- #1447 M1 — `approve.ts:285,292,302,323` and `deliver.ts:363,372,408,482,696` write through the new `PlanStore` write, not `node:fs`.
- #1447 L1 — `commonDirOf`, `mainRootOf`, `excludeDeskRoot` are deleted from `approve.ts`; callers use the new `Trees` operations instead.
- #1447 L2 — the two README rows name the receipt's scope.
- #1447 L3 — `no-network.test.ts:94`'s fetch exemption narrows to one method body.
- #1447 L4 — `sprint-annotation.ts:7` states current behavior only.

Plus, specific assertions a naive port addition would pass without:

- A test that the new `PlanStore` write uses temp-file-then-rename (not a direct write) — assert the write survives a simulated interruption, or at minimum that a temp file briefly exists, the way `pr-index-file.ts`'s own tests likely verify this pattern (check that file's test suite for the pattern to mirror).
- A test that the narrowed `no-network.test.ts` fetch exemption still catches a *new* unexempted `fetch(` call added anywhere else in `trees-git.ts` outside the `Trees.fetch` method body — if the narrowing only tightens the file-level exclusion without actually scoping to the method, the finding isn't fixed, just reworded.
- A test exercising `excludeDeskRoot`'s replacement that proves idempotency: calling it twice with the same line must not duplicate the entry in `info/exclude` (the old code checked this by reading file lines by hand before appending — the replacement via `git check-ignore` must preserve this guarantee, not silently regress to appending every time).

Plus the repo's own gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — this touches `packages/domain/src/**` (tests + `tsc --noEmit`) and `packages/board/src/**` (tests + typecheck), both named in this repo's `## Plot Config`. Add a changeset for `plot` with the description first and the `bumps:` block last, per `CLAUDE.md`'s Versioning section — this is a `patch` unless the new `Trees`/`PlanStore` operations are judged to warrant `minor` for expanded coverage. If this slice touches any `.sh` file, `scripts/check-shell-lines.sh` requires removing an equal number of shell lines elsewhere in the same change — but this slice's work is in `packages/domain` and `packages/board`, so no `.sh` file should need touching; if one does, budget for that trade explicitly.

### Bookkeeping

Open the PR through the controller once the branch exists and holds a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` — the controller reads which plan names the branch and titles the PR from the wave heading, not the last commit subject. Push the first real commit as soon as it exists, and append `→ #<number>` to this branch's line in the plan's `## Slices` section once the PR is created.

### Scope guard

This branch owns: `packages/domain/src/ports/plan-store.ts` and `plan-store-shell.ts`/`plan-store-fixture.ts` (new write + listing op), `packages/domain/src/ports/trees.ts` and `trees-git.ts`/`trees-fixture.ts` (new main-root + exclude ops), `packages/board/src/server/entry/approve.ts` and `entry/deliver.ts` (delete the hand-rolled `.git` parsing and direct `node:fs` writes, call the new port ops instead), `packages/board/test/unit/no-network.test.ts` (narrow the fetch exemption), `packages/domain/src/rules/sprint-annotation.ts` (TSDoc only), `skills/plot/scripts/README.md` (two rows).

Three sibling branches are in flight under the same plan: `bug/the-approval-asks-the-domain` (merged, PR #1506 — also touched `entry/approve.ts`, so rebase onto current `main` before editing that file), `bug/the-implement-lock-lives-on-disk` (fleet/implement-run files — no overlap), `bug/the-merge-reads-what-it-claims` (`entry/merge.ts`, `workflows/merge.ts`, `CLAUDE.md`/`AGENTS.md` line 499 — no overlap). No slice edits `plot-controller-gate.sh` or `rules/ci-suite.ts`; those findings moved to a different plan (`the-gates-are-launchers`) and are out of scope here.

If you find something the plan did not anticipate, report it rather than improvising outside scope — in particular, the plan's own Open Question on `.plot/hold`'s port placement is unresolved; if implementation reveals a reason to decide it one way or the other, surface that rather than picking silently.
