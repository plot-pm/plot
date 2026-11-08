## Implementation brief — state-branch (Write slice, spike: the `State branch` key and the state-branch push)

- **Plan (canonical):** `docs/plans/2026-11-07-state-branch.md` on `main`
- **Approved:** the plan is in Design. `Spike approved: 2026-11-08, jwloka, plan-PR #3231 merged, feature/state-branch-write` licenses this branch and no other
- **Branch:** `feature/state-branch-write` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This branch is the spike. `feature/state-branch-read` and `feature/state-branch-sync` do not start while the plan is in Design: only the spike is approved. They wait for `/plot-approve state-branch`. The Read slice builds on the key and the state ref this branch creates, and the Sync slice builds on both.

### What to build

A repository that declares `- **State branch:** plot/state` in `## Plot Config` gets every lifecycle record pushed to that branch instead of the default branch, as a fast-forward with no pull request. A repository that declares no key behaves exactly as today. The failure it removes, measured 2026-11-07 over 17 Bitbucket repositories: 4 forbid every push to the default branch and 7 allow only named people or the CI account, so an agent running as anyone else gets a rejected push, and since #1737 removed the micro-PR fallback a push rejected five times leaves no record at all.

The Write slice delivers:

1. The `State branch` key, read with `plot-config.sh get "State branch" ""`. Empty means today's behaviour.
2. One resolution of the write target, from the key. Where the key is set, a write cuts its booking from `origin/<state>` (from `origin/<default>` when the state branch does not exist yet, which creates it), merges `origin/<default>` into it, applies the write, and pushes to `origin/<state>` as a fast-forward under the existing push lock.
3. The off-ladder pushes follow the same target: `write_started_record` in the dispatch script (which already calls `plot-push-main.sh`), and the plain `git push` steps in `skills/plot-reject/SKILL.md`, `skills/plot-sprint/SKILL.md`, the RC push in `skills/plot-release/SKILL.md` and the direct flow of `skills/plot-idea/SKILL.md`.
4. A test that feeds every delete path a declared state branch and asserts that none deletes it.
5. The state gate's squash receipt (D14) and the non-branch ref (D16).
6. Proof on a sandbox repository with a protected default branch (D8).

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Every write moves, not a subset (decided 2026-11-07, Max Albrecht).** A split by record kind makes every reader merge per field. The merge of a plan PR is not a write of this kind: the plan's content is reviewed through its PR as before, and only the record of that approval moves.

**The state branch, not a bypass identity.** A bypass identity steps over the rule the owner wrote: `push-main-bypass` (2026-08-16) measured eight approvals that landed past a rule requiring a pull request. It also redeploys every record where a merge to the default branch deploys. Do not add an identity-based route.

**A forward-merge conflict refuses the write (D3).** The write names the conflicting file, writes no record, and exits non-zero. No writer resolves a conflict by rule.

**One push lock per repository, unchanged (D15).** `plot-push-lock.mjs` serializes the write and fleetd's later forward sync. In a repository that declares the key, Plot pushes the state ref and nothing else, so a lock per target would have the same contenders. A rejected push retries under today's five-attempt loop.

**The `push=` vocabulary stays** (`clean|bypassed|unknown|rejected|locked|refused`). The status line names the branch it pushed, so a reader can tell a state-branch push from a default-branch one.

**The key may name any full ref (D16).** `plot/state` or any `refs/heads/` name is a branch. A value outside `refs/heads/` (for example `refs/plot/state`) is written, read and forward-merged the same way, because `git push <remote> HEAD:<ref>` and `git show <ref>:<path>` take any ref. The sync PR belongs to the Sync slice and does not exist for a non-branch ref.

**The gate accepts a squash of the state tip (D14).** `plot-state-gate.sh` is a launcher over `stateTransitionOf` and `stateTransitionRefusal` in `packages/domain/src/rules/state-transition.ts`. Where the key is declared, it accepts one commit whose tree equals the state ref's tip tree and whose message names that tip's SHA. A plain merge commit, and any other local commit that changes a `State:` line, stays refused. The rule belongs in the domain. Do not decide it in the script.

**The name `recordRef` is taken for the Read slice (D17).** It answers which ref holds a plan's records. This slice resolves the write target and does not add a reader. If you need a name for the target, use a different one and do not pre-empt `recordRef`.

**No sweep deletes a `plot/*` branch by pattern today.** Measured 2026-11-07 on `origin/main` at `f3a7c01e5`: `plot-reconcile-scan.sh` enumerates only the declared `Branch prefixes`; `plot-release-refs.sh` deletes only slice branches a delivered plan names (`git push origin --delete`); the dispatch script deletes only the local `plot/start-<slug>`. That is a rule, so this slice adds the gate (deliverable 4). `Branch prefixes` must never gain `plot/`.

### Where the plan's description and the code disagree — read before you build

The plan says the eight `commitAndPush` calls in the seven ladder entries *"follow with no change of their own"* and that `plot-push-main.sh` *"cuts the booking worktree"*. The code does neither, checked 2026-11-08:

- Each entry cuts its own booking worktree from `origin/<main>`. `packages/board/src/server/entry/brief-book.ts:161` is `ctx.trees.addBranch(tmpwt, bookbr, `origin/${main}`)`. The other entries (`approve.ts:1275`, `deliver.ts:468` and `:917`, `needs-design.ts:480`, `record-pr.ts:129`, `release-finish.ts:310`, `verify.ts:786`) call `commitAndPush` the same way.
- `commitAndPush` (`packages/board/src/server/entry/ladder.ts:239`) fetches `origin/<main>` and resets the booking branch to it on every retry (`:283`, `:288`), then calls `plot-push-main.sh <bookbr> <main>` (`:310`). `plot-push-main.sh` receives a branch already cut and runs `git push origin "$branch:$default"` (`:132`); the Writer App path takes the same two names.

So the helper alone cannot move the target: a write cut from `origin/<default>` and pushed to `origin/<state>` is not a fast-forward of the state branch. The target must reach three places: the entry's cut, the ladder's re-cut, and the push. Resolve it in ONE place that all three call, and put the rule in the domain (`packages/domain/src/rules/`) with a script or entry asking it. Do not copy the resolution into each entry. If the cleanest cut turns out to differ from this reading, record what you found in the plan's `## Notes` and say so in the PR; do not work around it silently.

The Writer App path (`plot-push-writer-app.mjs`) pushes `<branch>:<default>` on a GitHub origin. Decide, with a test, whether it pushes the state ref there. This repository declares the Writer App and no `State branch`, so the proof for this path is a test, not this repository.

### Done when

The plan has no `## Done when` section; the slice line is the specification. Treat each clause of it as a requirement:

- The `State branch` key is read and an absent key changes nothing. Assert it: with no key, a pre-existing test of the push path passes unchanged. `test/reconcile/pushmain.test.mjs` is the contract test for `plot-push-main.sh` and holds the `clean` and `rejected` cases against a real bare origin; extend it rather than starting a second file.
- Contract test (D8): a bare origin whose pre-receive hook rejects every push to the default branch. Approve, start and deliver land on the state branch, and the test counts **zero** default-branch pushes. The count is the assertion a naive implementation fails: a write that falls back to the default branch on any error still lands its record and still reads as success.
- The state branch stays a descendant of the default branch after a write: assert that `origin/<default>` is an ancestor of `origin/<state>` after each write. This catches a write cut from a stale state tip.
- A write with no state branch on the origin yet creates it from the default branch.
- A forward-merge conflict on a plan file refuses, names the file and leaves `origin/<state>` unmoved.
- Delete-path test: every delete path (`plot-release-refs.sh`, the dispatch script's local deletion, `plot-reconcile-scan.sh`'s deletion candidates and `plot-reap.sh`) is fed a declared state branch and none deletes it. Mutate one path to delete it and see the test fail before you trust it.
- Squash receipt and non-branch ref (D14, D16), each with a test that fails against today's gate and push.
- The protected-sandbox proof of D8's second half goes in CI's e2e. **Do not run `pnpm run test:e2e` locally.** CI runs it, and a local run starts real workers and starves the machine.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

This slice touches shell. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. Pay for growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. It stores no number and has no override. The decision of which ref a write targets is a rule, and the plan's own direction (domain, then adapter) points the same way.

Also:

- A changeset in `.changeset/` with the description FIRST and the `bumps:` block LAST, naming `plot` or `@plot-pm/board` and each skill whose `SKILL.md` you change. Run `./scripts/check-changeset-packages.sh`.
- Do not commit generated bundles. `board-server.mjs` and the `skills/plot/scripts/board/*.mjs` bundles are rebuilt by `main`; `scripts/check-no-bundle-diff.sh` refuses a PR that carries them. Build locally to test, then restore the generated paths before you push.
- A changed `SKILL.md` keeps its `## Model Guidance` table in sync and its `README.md`. A new script gets a row in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`), and a changed one updates its row.
- New domain code is arrow functions with factual TSDoc, no decision history in comments. Where a new function sits in a board file or a test, it is an arrow too.
- `packages/domain/src/` imports `zod` and nothing else outside `adapters/`; a controller does not spawn. Reach `git` and scripts through the existing ports (`ctx.trees`, `ctx.scripts`).
- Absent is not false: a missing, unreadable or empty key means *no state branch*, never *refuse*. An unresolvable state ref on the origin means *create it from the default branch*, and a failed `ls-remote` means *cannot tell* — read the exit code, not the emptiness.

### Bookkeeping

- When you open the PR, call `plot-open-pr.sh`. Do not run `gh pr create`.
- Append `→ #<number>` to the `feature/state-branch-write` line in the plan's `## Slices`, and push the first real commit as soon as it exists.
- Do not edit any `State:` line. `plot-state-gate.sh` refuses it, and the phase moves only through `/plot-approve`.
- Add a line to the plan's `## Notes` for anything the plan did not anticipate, including the cut described above.

### Scope guard

This branch owns: `skills/plot/scripts/plot-push-main.sh`, `plot-push-writer-app.mjs` (if the test says so), `plot-config.sh` and its key list, the dispatch script's `write_started_record`, the entries under `packages/board/src/server/entry/` that call `commitAndPush`, `ladder.ts`, the new domain rule and its tests, `plot-state-gate`'s rule in `packages/domain/src/rules/state-transition.ts`, the push steps in the four skills named above, and the new tests under `test/reconcile/` and `packages/domain/`.

Not this branch: any reader of plan state (the board's plan list, the reconcile scan's `phase_at_main_ref`, dispatch's `gate_ref`, `/plot-pulse`) — `feature/state-branch-read` owns them, and a repository that declares the key reads stale phases until it lands; that is expected and is why the key stays undeclared here. Not this branch either: fleetd's forward sync, the sync PR and its path gate (`feature/state-branch-sync`), and `plot-init` / `plot-board-setup` (`feature/state-branch-setup`). Verified 2026-11-08: no `plot/state` ref and no `feature/state-branch-*` ref exists on the origin, and no commit has touched `plot-push-main.sh`, `plot-state-gate.sh`, `plot-config.sh` or `ladder.ts` since the plan was written.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
