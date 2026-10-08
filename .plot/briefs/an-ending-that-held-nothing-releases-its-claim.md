## Implementation brief — every-loop-ending-has-a-supervisor-rule (wave 1: Endings that release the claim)

- **Plan (canonical):** `docs/plans/2026-10-07-every-loop-ending-has-a-supervisor-rule.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `infra/an-ending-that-held-nothing-releases-its-claim` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

This is the first of three waves. Wave 2 (`infra/held-work-gets-a-fresh-agent`) and wave 3 (`infra/an-unrepaired-ending-asks-a-person`) add the other rows of `endingAction` and wait on this branch. The branch it waited on, `bug/a-claim-has-a-release-controller`, merged as #1363, so `releaseClaim` exists.

### What to build

Two endings leave a slice claimed with nobody working on it.

- **#1274, measured 2026-10-04.** An agent took up `infra/the-loop-has-a-workflow`, pushed the claim, and its turn ended on `Loaded.` with no file changed. The loop sealed the slice and went free. The claim ref stayed on origin, so the queue skipped the slice.
- **#1281.** When the desk holds unlanded work at take-up, the `holding-work` ending names the newly assigned branch (`agent-loop.ts:453-457`). `supervise` then charges a correction to a slice that never started.

The branch adds four things:

1. **The `nothing-done` ending reason** in `EndingReasonSchema` (`packages/domain/src/entities/ending.ts:120`), documented in the same comment block as the other reasons. Its actor is `agent`, as for `unstarted` and `holding-work`.
2. **The `agentLoop` change.** A turn that exits `ran` with no commit beyond the claim, no open PR and no marker ends `nothing-done` and does not seal. The take-up `holding-work` ending names the desk's own branch instead of `branch`.
3. **`endingAction(readings)`** in `packages/domain/src/rules/ending-action.ts`. It is pure and reads no disk. It takes the desk's ending reason, the branch the ending names, whether a manifest already names the desk, the count of fresh sessions the slice already had, and whether the branch holds a commit beyond its claim or an open PR. It answers one of `release-claim`, `start-fresh`, `needs-a-person`, `leave`. This branch builds the type, the `leave` default and the `release-claim` rows. The `start-fresh` and `needs-a-person` rows are waves 2 and 3, but declare all four answers now so those waves add rows and change no signature.
4. **The registry tick** (`packages/board/src/server/entry/registryd.ts`, beside `freshAgentDecisions` at `:730`) reads the desks' endings, asks `endingAction`, and calls `releaseClaim` for a `release-claim` answer. It goes through `ClaimRelease` (`packages/domain/src/ports/claim-release.ts`) and the existing `release-claim.ts` controller code, not through `plot-dispatch.sh --release` directly.

Take-up `holding-work` answers `release-claim` for the NEW assignment's branch and names the desk's own branch in the ending. The new assignment's claim was pushed, or was about to be, for a slice the desk never started.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**`readings.pushed` cannot detect a turn that did nothing.** Row 12a (`agent-loop.ts:630-646`) reads `pushed` from `ports.refs.remoteHead(branch) === 'present'` (`entry/worker-loop.ts:777`). The claim push already put the branch on the remote, so a claim-only branch reads `pushed: true`, `prOpen: false` and seals as `no PR open, no checks wait`. That is #1274 exactly. Do not fix it by reading `pushed` harder. Add a new reading, whether the branch holds a commit beyond its claim, and have the port answer it from git (`ahead of the claim commit`, the same measurement the desk already uses to count unpushed commits at `entry/worker-loop.ts:595`).

**Only the claim-only arm changes.** A branch with real commits and no PR keeps sealing as it does today (`readings.pushed ? 'no PR open…'`). Those commits are work a person can find. Releasing that claim would delete a ref other work depends on, and `releaseClaim` refuses `pr-open` and the script refuses file-changing remote commits anyway. Add a test that a branch with a commit beyond the claim and no PR still seals.

**The supervisor releases the claim, not the loop.** The loop ends with a reason and exits; the registry tick acts. The loop does not call `releaseClaim`, because the loop cannot tell a live peer from itself and `releaseClaim` refuses `agent-live` from the manifests' desk. The tick releases after the manifest is gone.

**`releaseClaim` refuses for four reasons the shell enforces** (a live worker pid, a file-changing remote commit, unpushed or dirty desk work, a `PLOT-BLOCKED` marker). A refusal is a 409 with the script's own sentence, and what the controller refuses does not happen. The tick logs the sentence and leaves the desk. It does not retry past the refusal, does not delete the ref by hand, and does not call `plot-dispatch.sh` itself.

**A desk that a manifest names answers `leave` for every ending**, as `freshAgentAfterCorrections` does today (`rules/fresh-agent.ts:20`): the ending and the manifest removal are not one atomic write in the shell, so a tick that acts on an ending while a start is in flight would act on a desk about to be live. Test it for every reason, not for one.

**Absent is not false.** A missing or unreadable ending file answers `leave`. A missing commit-beyond-claim reading, because the git call failed, answers `leave` for `nothing-done` and is not read as `false`: releasing a claim on a failed read is the destructive direction. This is the same rule that makes `priorFreshSessions` read `0` rather than refuse.

**Do not touch the fresh-agent rules in this branch.** `freshAgentAfterCorrections` and `freshAgentAfterTurnLimit` stay, with their one caller at `registryd.ts:739`. Wave 2 moves them into `endingAction` and deletes them. Moving them here makes this branch collide with wave 2 and breaks the plan's one-slice-per-ending-group split.

**The `corrections-spent` and `turn-limit` table rows are not yours.** Declaring the answer type is; implementing those rows is wave 2.

**No second notification path.** Nothing in this branch notifies. `needs-a-person` writes a marker that `questionEscalation` lists, and that is wave 3.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation passes without them:

- **`agentLoop`, claim-only branch.** A turn that exits `ran` with the branch at the claim commit, no PR and no marker ends `nothing-done` and writes no seal. A naive change that edits only the seal note passes the existing row-12a test and still seals; the test must assert the absence of the `seal` write and the presence of the `loop-end` write with reason `nothing-done`.
- **`agentLoop`, branch with real commits and no PR.** It still seals. This catches an implementation that replaces `!readings.pushed || !readings.prOpen` wholesale.
- **`agentLoop`, take-up refused for unlanded work.** The ending names the desk's own branch and not the assigned `branch`. The fixture must give the two branches different names, or the test passes on the old code.
- **`endingAction`.** One test per row this branch implements. A manifest-named desk answers `leave` for every reason in `EndingReasonSchema`, iterated over `EndingReasonSchema.options` so a reason added later cannot slip past it.
- **The registry tick.** A `nothing-done` ending releases the claim ref through `ClaimRelease`. A refused release leaves the desk and the ref and logs the sentence. A desk with a manifest releases nothing.
- **Corpus and exhaustiveness.** Anything that switches over `EndingReason` (`registry.ts`, the board's ending text, `plot-worker-loop.mjs` consumers) gains the new reason. Run `rg "'holding-work'" packages skills --glob '!node_modules'` and read each hit. A corpus floor that reads `> 20` is a bug, not your failure: fix it to `> 0` and say so.

Plus:

- **Local checks.** Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and do not run `pnpm run test:e2e`.
- **Domain typecheck.** `cd packages/domain && npx tsc --noEmit`. The root typecheck covers the board only.
- **Board artifact.** `skills/plot/scripts/board/plot-worker-loop.mjs` is generated output. Run `pnpm build:board` to test locally and restore the generated paths before you push (`scripts/check-no-bundle-diff.sh`). On a conflict in a generated file, follow `docs/definition-of-done.md › Resolving a board artifact conflict`.
- **Changeset.** One file in `.changeset/` with the description FIRST (20 characters or more) and the `plan:` line and `bumps:` block LAST. Package `@plot-pm/board` (or `plot`), never another name. Run `./scripts/check-changeset-packages.sh`.
- **Style.** Every function you write is an arrow. TSDoc states what an export does, its parameters, its return and its failure, and does not narrate the decision. Terminology follows `DESIGN-agent.md`: the actor is an Agent, "worker" names only the process. Add no new `Wave` where `Slice` is meant.
- **Shell.** The slice touches no `.sh` file. If you find you must edit one, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Pay for growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.
- **Layering.** The registry tick calls the domain. It never spawns, and it adds no `spawn`/`execFile` site (the CI ratchet counts them, `allowed=28`).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`.
- Do not edit `State:` in the plan by hand. `/plot-deliver` owns it.

### Scope guard

This branch owns:

- `packages/domain/src/entities/ending.ts`
- `packages/domain/src/rules/ending-action.ts` (new) and its test
- `packages/domain/src/workflows/agent-loop.ts` and `packages/domain/test/workflows-agent-loop.test.ts`
- `packages/board/src/server/entry/worker-loop.ts` (the new reading) and `packages/board/src/server/entry/registryd.ts` (the tick), with their tests
- the changeset

It does not own `rules/fresh-agent.ts`, `rules/fresh-agent-turn-limit.ts`, `questionEscalation` or any notifier. Those belong to waves 2 and 3, which wait on this branch.

The registry files are also touched by other in-flight work. Run `git fetch origin main` and read `git log origin/main -- packages/board/src/server/entry/registryd.ts` before the first edit, and rebase before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The plan's open questions (`limited`, `spent` and the other `leave` reasons) are a person's to answer: leave those reasons at `leave`.
