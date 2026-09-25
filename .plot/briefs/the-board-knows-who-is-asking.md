## Implementation brief — the-board-shows-me-only-my-work (wave 1: The board knows who is asking)

- **Plan (canonical):** `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `feature/the-board-knows-who-is-asking` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention
- **Issue:** #967

Waves 2 (`feature/a-row-says-whose-it-is`) and 3 (`feature/the-board-filters-to-my-work`) wait on this branch. Wave 2's `isMine(row, identity)` takes the identity this branch puts in the payload, so the field's shape is a contract wave 2 builds on.

### What to build

The board has no current-user concept. Nothing in `packages/board/src` or `packages/domain/src` answers *who is reading*. #967 measured the cost on a four-contributor estate: 18 rows in WAITING ON YOU, 2 actionable, and 9 of 11 open PRs owned by other people.

This branch adds the reading, and no filtering and no control:

1. **One new op on `skills/plot/scripts/plot-host.sh`** that exposes what `budget_account()` (`:2573`) already computes. The plan does not name the op. `account` matches the function and the budget vocabulary.
2. **The answer in the board payload, with git's `user.email` beside it.** Both identities travel, because they spell one person two ways (`jwloka` from the host, `jan.wloka@quatico.com` from git) and the plan leaves open which one a row matches.
3. **Tests that prove the reading** before anything depends on it.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**Expose `budget_account`. Do not write a second identity reading.** The function reads `gh`'s `hosts.yml` (a file read, no request) and caches through `PLOT_BUDGET_ACCOUNT`. Its comment gives the reason `gh api user` is wrong: it *"would answer authoritatively and cost one request against the very bucket this is counting."* The board asks on its timer, so a request per ask is the same cost multiplied. No CLI op reaches the function today. Its four callers are all internal to the budget machinery (`:1626`, `:2706`, `:2913`, `:4646`; the plan lists three, and the fourth, `spend-rate`, is also internal).

**Identity is a reading, so an adapter supplies it. It is not a `## Plot Config` key.** A config key is a second copy of a fact the host already holds, and it goes stale silently. The route follows the layering rule: `plot-host.sh` op → a new method on the `Host` port (`packages/domain/src/ports/host.ts`) → `host-shell.ts` implements it with the same `ask([...])` shape as `backend` (`:280`) and `prList` (`:352`) → `host-fixture.ts` gains the method too, or every fixture-backed test fails to typecheck.

**`git config user.email` also goes through an adapter.** Do not add a `spawn`/`execFile` in `packages/board/src/server/`. CI's *One place reaches a process* ratchet (`ci.yml`) fails when the count of direct spawn sites outside `adapters/` grows. `serverInfo` already asks `Trees.currentBranch` through the trees adapter (`server-info.ts:53-95`, `trees-git.ts`), so git's email belongs on a git-facing adapter the same way.

**The payload home is `ServerInfoSchema` (`packages/board/src/contract/schema.ts:984`), or a sibling of it.** Identity is a fact about the machine that serves the board, like `branch`, `repo` and `ci`. It is not plan data. Take the existing precedent for the shape: every field is `.default('')`, so an older server yields no element rather than a broken header. The `BoardSchema` default at `:1050` and the placeholder at `server/board.ts:2147` both list every `ServerInfo` field and need the new one. `serverInfo()` (`server-info.ts:174`) already asks its readings in one `Promise.all`, and the new readings join it.

**Absent is `''`, never the literal `unknown`.** `budget_account` prints `unknown` when it cannot read the account, which is correct for grouping budget lines. For identity, the string `unknown` is a login that matches nothing and reads as a name. The adapter maps `unknown` to `''`. Read the op's exit code, not the emptiness of stdout. The rule wave 2 carries is *a row with no determinable owner is shown*, and it needs an honest empty value to test on.

**`PLOT_BUDGET_ACCOUNT` overrides the answer.** `budget_account`'s first line returns the variable when it is set. Keep that for the new op. Tests can use it to pin the answer without a real `hosts.yml`, and `GH_CONFIG_DIR` is the second seam for the GitHub arm.

**`localStorage`, the checkbox and `isMine` are not this branch.** They are waves 2 and 3. Nothing here filters, and no component renders the identity unless a test needs a visible proof.

### A finding the plan did not anticipate — resolve it on this branch

**On Bitbucket, `budget_account` does not answer the user.** Its Bitbucket arm takes the owner segment of `remote.origin.url`, which is the WORKSPACE. On a team workspace such as #967's, every contributor gets the same answer, and that answer matches no PR author. The function's own comment says so: it is *"the free approximation and is the half of the key that groups correctly"*, which is right for a budget key and wrong for an identity. `bb_identify` (`:1923`) does not help. It identifies which `bb` binary is installed (`craftamap/…` or `quatico/…`), not who is signed in.

Resolve it inside the new op without changing what `budget_account` returns to its budget callers:

- Measure whether the installed `bb` offers a user reading that costs no API request (a config file, as `gh` has). If one exists, the op uses it on Bitbucket.
- If none exists, the op answers `''` (unknown) on Bitbucket. **Never the workspace.** The git email still travels beside it, so the board keeps one identity.
- Say which case you found in the PR body. The plan claimed the Bitbucket arm answers who the user is, and wave 2's fixture for #967's estate depends on the answer.

### Done when

The plan's `## Done when` list specifies the whole feature. For this slice, the reading is proved with nothing depending on it:

- The new op prints the GitHub login from `hosts.yml` and exits 0. A contract test pins this with `GH_CONFIG_DIR` pointing at a fixture file. **It catches** an implementation that calls `gh api user`, because that path ignores the fixture.
- An unreadable `hosts.yml` answers `''` through the adapter, not `unknown`. **It catches** a payload that carries `unknown` as a login.
- On Bitbucket, the op does not answer the remote's owner segment. A test with a remote of `git@bitbucket.org:someteam/repo.git` asserts the answer is not `someteam`. **It catches** a straight re-export of `budget_account`, which the plan's own wording invites.
- `/api/board` carries both identities in the payload, defaulting to `''`. **It catches** a schema field that parses in the server and never reaches the client.
- The existing callers of `budget_account` receive the same values as before. **It catches** a fix for the Bitbucket finding made inside the shared function.

Plus the repo gates:

```bash
nvm use                     # Node 24; pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:contracts
pnpm run test:board         # rebuilds the board artifact first
pnpm run typecheck
./scripts/check-host-cli-callers.sh
./scripts/check-changeset-packages.sh
```

- Do not run `pnpm run test:e2e` locally. CI runs it.
- Commit the rebuilt `skills/plot/scripts/board/board-server.mjs`. On a conflict in it, take either side and run `pnpm build:board`.
- Add a changeset. The description goes first and the `bumps:` block goes last. Name the plan on a `plan:` line in the same block. This touches `plot-host.sh` (skill `plot`) and `packages/board` (`@plot-pm/board`).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- No project board is configured, so there is no board status to set.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh` (the new op only)
- `packages/domain/src/ports/host.ts`, `packages/domain/src/adapters/host/host-shell.ts`, `host-fixture.ts`
- the git-facing adapter that answers `user.email`
- `packages/board/src/contract/schema.ts` (`ServerInfoSchema` and the defaults that list its fields)
- `packages/board/src/server/server-info.ts`, `server/board.ts` (the placeholder)
- tests for the above, the rebuilt board artifact, one changeset

Other branches in flight, checked 2026-09-24 against every remote ref: only `feature/one-monitor-watches-the-slice` touches one of these files. It edits `schema.ts` at `:3035` (`ProcessGroupSchema`), far from `ServerInfoSchema` at `:984`, and it has no PR. No other branch touches `plot-host.sh`, the host port or adapter, or `server-info.ts`.

Re-checked 2026-09-25 on resume: `bug/the-readers-agree-about-an-item` also edits `schema.ts`, at `:702` (`ColumnSchema`), far from `ServerInfoSchema`. `main` gained `cb0be55c4` in `plot-host.sh` (the `default-branch` op) since approval, so rebase the claim branch onto current `main` before the first commit. No other branch touches `plot-host.sh`, the host port or adapter, or `server-info.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
