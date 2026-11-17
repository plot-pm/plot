## Implementation brief — red-hold-reads-the-pr-base (slice: Base readings)

- **Plan (canonical):** docs/plans/2026-11-09-red-hold-reads-the-pr-base.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3323 merged
- **Branch:** `bug/red-hold-base-readings` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** the `plot/review` check on the PR head, per the plan's `Review: pr`

This is slice 3 of 4. `bug/red-hold-index-base` (#3479) and `bug/red-hold-reads-the-pr-base` (#3483, `e2fa8bf18`) have merged. Slice 2 gave the merge paths a reader: `baseBranchFile(repoRoot, base)` (`packages/domain/src/adapters/default-branch/default-branch-file.ts`), `baseBranchRed`, and `base-branch-red` in `merge`, `mergeAt` and `mergeArm`. Nothing writes `.plot/state/base-branches/<base>.json` yet, so no sprint base is held by anything. This slice is the writer. `bug/red-hold-base-repair` waits on this slice.

### What to build

Issue #3322: three reviewed slice PRs into `sprint/desk-probes-and-liveness` stayed held while `main` was red. Slices 1 and 2 stop `main`'s red from holding them. This slice makes a sprint branch's own red hold its own PRs: fleetd keeps one CI reading per `sprint/*` branch on `origin`, in the schema and with the writer that the default branch uses.

Build four things:

- **A combined tip listing in `packages/domain/src/adapters/refs/refs-remote-git.ts`.** A new operation on `refsRemoteGit` (and on the `Refs` port, `ports/refs.ts`, next to `remoteSha` at `:938`) runs one `git ls-remote origin refs/heads/<default> 'refs/heads/sprint/*'` and returns the tip of every ref listed. Match the full ref as `remoteSha` does (`:86-98`): a bare pattern also matches `refs/heads/feature/x`. A failed or timed-out read answers `unknown`, never "no branches".
- **`DefaultBranchWorld.repair` becomes optional** (`packages/fleet/src/shared/default-branch-refresh.ts:76`). Where it is absent, `refreshDefaultBranch` skips `writeRepairRecord` (`:350-352`) and writes no repair record. The base-repair slice supplies the store later.
- **A per-base refresh in fleetd's beat** (`packages/fleet/src/server/entry/registryd-main.ts`, the `defaultBranchWorld` block near `:3372-3395` and `readDefaultBranch` near `:3432-3445`). After the default branch's refresh, refresh each `sprint/*` base through `refreshDefaultBranch` with a world whose `branch()` returns the base, whose `store` is `baseBranchFile(repoRoot, base)`, whose `refs.remoteSha` answers from the combined listing, and which has no `repair`. All asks go through the same `slot`, one base after another, so a base never asks concurrently with the default branch.
- **File removal.** The beat deletes `.plot/state/base-branches/<base>.json` for a base that a successful listing no longer names. A failed or `unknown` listing deletes nothing.

### Decisions the plan settles — do not re-derive them

**Every `sprint/*` branch on `origin` gets a reading; the sprint files and the open PRs' bases do not name the set.** A sprint file may exist only on its own sprint branch: on 2026-11-09 `origin/main`'s `docs/sprints/active/` listed `ship-2-32-0.md` and not `desk-probes-and-liveness.md`. Open-PR bases need the index and give a reading for every stacked feature base, none of which runs CI on push. `localChecksBase` (`rules/local-checks-base.ts:33`) already uses the `sprint/*` convention.

**One file per base, the default branch's file unchanged.** Rejected: a keyed file for all bases — two refreshes would race on one read-fold-write. Rejected: writing a sprint reading into `default-branch.json` — every reader in the plan's table reads it as the default branch's.

**A sprint branch with no sprint PR open has no runs, and that is the normal case.** `ci.yml` runs `pull_request` into `main` and `sprint/**` and `push` into `main` only (`.github/workflows/ci.yml:3-7`). `runsForSha(branch, sha)` matches a run's head branch, so a sprint tip has runs only from the sprint PR into `main`. With none open, the head reads `unknown`, no commit settles, `ancestorsToAsk` asks nothing without a settled commit, and the reading holds nothing. Do not "fix" this by reading runs another way, and do not add a stale hold: a base with no reading holds nothing.

**The staleness rule is `Checks wait`, as for the default branch.** `defaultBranchRed` already holds only a reading whose `askedAt` is within `Checks wait`; fleetd re-asks an unchanged head at least once per half `Checks wait` (`reaskIntervalMs`, `:45`).

### Where the plan's cost model is out of date — read this before writing the beat

The plan's *The cost* and *The census* paragraphs say a beat does one `git ls-remote` that serves the default branch and every sprint base, and that S4 therefore does not move. That described a beat that read the tip on every pass. Since `e7636c02c` (2026-11-15, *the idle PR beat reads the tip and the plans only where they moved*) the beat is `refreshOnChange(defaultBranchWorld, tipMoved, …)` (`default-branch-refresh.ts:388`): an idle pass reads a key from files (`origin/<default>`'s mirror and the index's newest `mergedAt`) and starts **no process**. That commit measured the idle beat at one `git ls-remote`, three `plot-config.sh` and one `plot-plan-meta.sh` per pass, and removed them. A per-beat `ls-remote` for sprint tips would put one process back on every idle pass, and the census gate (S4, compared with the merge base) would fail it. So:

- **Read the combined listing only where the default branch's refresh reads its tip** — the call path that reaches `remoteSha` today — and for the per-base refreshes. An idle pass whose key is unchanged and whose default reading is not due starts no process, and the per-base refreshes follow the same rule.
- **A sprint tip can move while `origin/<default>` does not**, and `tipMoved` does not see it. Two ways to cover it; measure, then choose, and say which in the PR. (a) Add the mirrors of `origin/sprint/*` to the key, but only if that read starts no process — check how `refsGit`'s `listBranches(true)` and `resolve` read (`ref-files-fs.ts` reads loose refs and `packed-refs` from files) and prove it with the census row. (b) Leave the key alone: a sprint tip is then read when the default branch's reading is next due, at most once per half `Checks wait` (30 min here) when `main` is green. Reading (a) is better if it is spawn-free; reading (b) is acceptable and must be named as the bound on how late a red sprint is noticed. If neither fits, report it rather than adding a per-beat process.

### Traps a naive implementation falls into

- **The base world must not set `record`.** `refreshDefaultBranch` calls `world.record?.('defaultBranch', …)` (`:276-300`, `:367`). A base world that passes `recordSnapshot` overwrites the daemon snapshot's default-branch reading with a sprint reading, and the board's status line then shows the sprint's state as `main`'s. Leave `record` unset for every base.
- **A base with no runs warns on every ask.** `unmatchedChecks` (`rules/default-branch.ts:59`) names every declared `Default branch checks` workflow that matches none of the head's runs, and an empty run list matches none. A sprint with no PR open would warn `default-branch check 'CI' matched no run for <sha>` on each ask, and `warnDefaultBranchOnce` (`registryd-main.ts`) drops only an identical consecutive line, so alternating bases would defeat it. Give each base world its own `warn` that drops this line, or one dedup per base; do not silence the default branch's warning.
- **`world.branch()` is the base, and the file guard is the reader's.** `refreshDefaultBranch` reads back `stored.value?.branch === branch` (`:295`); `baseBranchFile` returns `null` for a mismatched `branch` and refuses a write for a base with an empty, `.` or `..` segment (`failed`). A listed ref name that `baseBranchFile` refuses writes nothing and logs once; it must not abort the other bases.
- **One base's failure must not stop the next.** A thrown error or an `'unreadable'` outcome for one base goes to `warn` and the loop continues; the existing `try/catch` in `readDefaultBranch` wraps the whole pass and would otherwise skip every later base.
- **The deleted file's directory.** `base-branches/sprint/x.json` lives under `base-branches/sprint/`; removing the file leaves the directory. Do not remove the directory tree, and never glob-delete: remove the exact paths the listing no longer names, from the files the reader found.
- **The index never says no.** A listing that failed, or answered `unknown`, is not "no sprint branches": it deletes no file and refreshes nothing.

### Done when

The plan's `## Done when` rows with slice *Base readings* are the specification:

- a `default-branch-refresh.test.ts` row: a world for `sprint/x` writes `.plot/state/base-branches/sprint/x.json` with `branch: 'sprint/x'`, and a red reading with no `repair` store writes no repair record;
- a `baseBranchFile` row: a file whose `branch` names another base, and a base with a `..` segment, read as no reading (the reader exists from slice 2; add a write-side row if it has none);
- a beat row: with no `sprint/*` branch, one tip listing and no `runsForSha` beyond the default branch's; with one due sprint base, one added `runsForSha`; the file of a base the listing no longer names is deleted;
- the census gate on the PR: S4 within its tolerance of the merge base.

Add these because a naive implementation passes without them:

- **An idle beat with a sprint branch on `origin` starts no process** — key unchanged, nothing due. Catches the per-beat `ls-remote` the plan's cost model would have written.
- **A base world's `record` is never called, and the default branch's snapshot reading is untouched after a sprint refresh.** Catches the overwrite above.
- **A sprint base with an empty run list calls `warn` with no `matched no run` line.** Catches the warning flood.
- **A listing that fails deletes no file and writes no reading.** Catches `unknown` read as "branch gone".
- **A refresh that throws for one base still refreshes the next.**

Plus the repo's gates: no bundle in the diff (`board-server.mjs` is generated; never commit a rebuild), and a changeset (`'plot': patch`, description first, `bumps:` block last, `plan: docs/plans/2026-11-09-red-hold-reads-the-pr-base.md`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, including the census gate; a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` is not at risk unless you touch a `.sh` file; this slice should touch none. Run the board and fleet typechecks that the local-checks command prints. New functions are arrows (`export const f = (…) => …`), and TSDoc says what an export does, not the history of the decision. No new `spawn` or `execFile` outside `adapters/`: the CI ratchet counts them.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Base readings` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/adapters/refs/refs-remote-git.ts` and the `Refs` port declaration of its new operation, `packages/fleet/src/shared/default-branch-refresh.ts`, the beat in `packages/fleet/src/server/entry/registryd-main.ts`, the matching tests (`default-branch-refresh.test.ts`, the refs adapter tests, the beat's tests and the census rows), and the changeset.

Not this branch: `rules/default-branch.ts`, `rules/slice-pr-next.ts`, `workflows/merge.ts` and `auto-merge.ts` (slice 2, merged), and `plot-ask.mjs`, `rules/repair-pr.ts` and any per-base repair store or `repair` world (slice 4, `bug/red-hold-base-repair`). Fleetd passes no `repair` store for a base in this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
