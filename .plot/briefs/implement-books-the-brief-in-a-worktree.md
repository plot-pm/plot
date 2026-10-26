## Implementation brief — implement-leaves-its-brief-and-plan (wave 1: Brief Booking)

- **Plan (canonical):** `docs/plans/2026-10-26-implement-leaves-its-brief-and-plan.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2726 merged
- **Branch:** `bug/implement-books-the-brief-in-a-worktree` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** pull request, per the plan's `Review: pr`

Wave 2 (`bug/fleetd-plan-store-reads-the-ref`) waits on this branch. It touches `registryd-main.ts`, which two other desks also edit; do not touch that file here.

### What to build

A `--brief-only` implement run writes the brief and the `Started:` record into the operator's main checkout, and three runs on 2026-10-26 (`d315381c6`, `8a714dee7`, `cc5c7a1d5`'s predecessor `8f06bd8fc`) left byte-identical leftovers there that made `git merge --ff-only origin/main` refuse. After this change the run books both files only in a disposable worktree cut from a freshly fetched `origin/<default>`: commit, push, remove. The main checkout's `git status --porcelain`, `HEAD` and branch are identical before and after.

Build it as code, not prose. A JS entry point under `skills/plot/scripts/board/` takes the slug, the branch and the brief text and runs entry → domain → port → adapter:

- The domain decides what to write: the brief path from the branch suffix (`feature/x` gives `.plot/briefs/x.md`), the `Started:` line, and "a brief already on `origin/<default>` is success, write no second commit".
- The `Trees` port already carries `fetch`, `add`, `stage`, `commit`, `push` and `removeOnly` (`packages/domain/src/ports/trees.ts:276,490,506,520,579,393`). Use them. The push keeps the lock and Writer App mechanics of `plot-push-main.sh` behind an adapter.
- Model the sequence on `write_started_record` in `skills/plot/scripts/plot-dispatch.sh` (about `:3406-3498`): `git worktree add` from `origin/<default>`, commit, push, `git worktree remove`. Read it; do not call or edit it (the controller gate refuses commands that name that script).

Then:

- `skills/plot-implement/SKILL.md` steps 4 and 5 make the entry point the primary path under `--brief-only`. The agent writes the brief text to a scratch file outside the repository and calls the entry point. Rewrite the paragraph at about `:129-135` ("runs this skill's agent directly in the operator's main checkout"). Update the Model Guidance rows for steps 4 and 5 (step 5 under `--brief-only` is one call, not a commit). Bump the skill version (minor) through the changeset.
- `packages/fleet/src/shared/implement-run.ts`: remove `[MAIN_CHECKOUT_WRITER_ENV]: '1'` (`:617`) and its comment. `startImplement` always prompts `--brief-only` (`:115-116`) and sets `BRIEF_ONLY_ENV`, so every run it starts is a brief run. The other roles that set the marker (`deliver.ts:649`, `reslice.ts:473`, `story.ts:514`, `auto-deliver.ts:272`, `brief-ask.ts:163`) keep it.
- `restoreCheckedOutBranch` (`:633`) stays as a backstop. Correct its docstring (`:485-488`), which claims the agent "writes no uncommitted change of its own here, by the `main-checkout` gate's own contract"; the three runs above disprove that under skew. The end handler also compares the main checkout's `git status --porcelain` before and after the run and logs the paths the run added, by name. It removes nothing.
- A row for the new bundle in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`).

### Decisions the plan settles — do not re-derive them

- **No fast-forward of the operator's checkout after the push.** It adds a writer under the running board, fleetd and worker loops: `git merge --ff-only` moves whatever branch is checked out, and the board keeps serving its old bundle while its children run new scripts. The operator answered this on 2026-10-26.
- **Reading briefs from the ref is not the fix.** `briefPresent` (`registryd-main.ts:768-779`) and `brief_present` (`plot-dispatch.sh:548`) already read `origin/<default>`. Every `held on no-brief` line in the window was correct.
- **No new shell.** `scripts/check-shell-lines.sh` ratchets shipped shell against the merge base and stores no number; the booking is a JS bundle.
- **No `git reset`, ever.** The main-checkout gate refuses a mixed reset; the fresh-fetch worktree is the first path, so no write starts from a stale `HEAD` and no recovery is needed (agrees with #2630). A rejected push is recovered by re-fetching and re-cutting a worktree (#2162 keeps the branch restore).
- **The marker removal turns the rule into a gate for git calls only.** The gate does not see a file written by the agent's Write tool, so the fixture test must cover the Write path rather than rely on the gate.
- **Carried invariants:** a missing or unreadable ref means "ask", never "none"; read exit codes, not emptiness; a brief already on `origin/<default>` is success, so a second run writes no second commit.

### Done when

The plan's `Brief Booking` slice line is the specification. Lift these, each of which a naive implementation would pass without:

- The fixture repo test runs the entry point with `PLOT_UNATTENDED=1` and **no** `PLOT_MAIN_CHECKOUT_WRITER`, with the main checkout **behind** `origin` and an **untracked operator file** present. It asserts `git status --porcelain`, `HEAD` and branch are unchanged and `origin/<default>` holds the brief. A fixture with a clean, current checkout passes with the old behaviour too (catches: the stale-checkout and dirty-checkout cases that actually failed).
- A second call for a brief already on `origin/<default>` writes no second commit (catches: duplicate `Started:` lines).
- The disposable worktree is removed on success and on a rejected push (catches: leaked entries; the owned-run wrapper fails a run on a leaked `TMPDIR` entry).
- Mutation-test the main-checkout assertion: write into the checkout in the entry point and see the test fail before you trust it.

Plus: a changeset (package `plot`, `plot-implement: minor`, description first and `bumps:` block last); `./scripts/check-helper-table.sh`, `./scripts/check-changeset-packages.sh`, `./scripts/check-shell-lines.sh`, and the spawn ratchet *One place reaches a process* (git goes through the `Trees` adapter). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI. Do not run `test:e2e` locally. Do not commit the rebuilt `board-server.mjs` or any generated bundle (`scripts/check-no-bundle-diff.sh`). A new function you write is an arrow.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/board/` (new entry point), the domain rule and adapter for the booking, `skills/plot-implement/`, `packages/fleet/src/shared/implement-run.ts`, `skills/plot/scripts/README.md`, a changeset. In flight elsewhere (verified 2026-10-26 from the desks' diffs): `nothing-done-asks-pr-state-only-where-it-decides`, `fleetd-holds-the-pr-index-lock` and `a-bitbucket-listing-reads-every-page` all edit `registryd-main.ts` and `pr-refresh.ts`; `fleet-start-probes-worker-writes` edits `packages/board/build.mjs`, `bundles.generated.ts` and `adapters/index.ts` — expect a trivial conflict at `adapters/index.ts` if you export a new adapter there. Open question 4 of the plan (`brief-ask.ts` using the same booking) is not in this slice; leave `brief-ask.ts` alone.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
