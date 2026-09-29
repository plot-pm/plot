## Implementation brief — a-slice-starts-its-own-conversation

- **Plan (canonical):** `docs/plans/2026-09-29-a-slice-starts-its-own-conversation.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-slice-starts-its-own-conversation` (base: `main`, claimed at `b3d50c3c`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review + CI)
- **Issue:** #1067

Single-slice plan: nothing waits on this branch and it waits on nothing. #1068 (launchd's PATH lacks `~/.local/bin`, `exit 127`) is a separate defect and stays out of this branch.

### What to build

On `ewz-leg`, a desk handed a second slice resumed the first slice's session. The 3.7 MB transcript was silent for 2 770 s while it reloaded, the WorkerMonitor reported `idle` at 900 s, and the loop ended the worker with `exit 124`. `--restart` minted a fresh id and the worker then ran normally.

Cause: `session_handle()` (`skills/plot/scripts/plot-worker-loop.sh:716`) returns the manifest's `resumeId`, and `session_flag()` (`:744`) picks `--resume` whenever a transcript for that handle exists. `update_manifest_on_hop` (`:301`) carries the same handle across every hop. Neither asks which branch.

Build: in the hop, mint a fresh handle when the branch changes, and keep the handle when the branch is the same. Then make the board join the current slice's transcript, and fix or correctly file the idle rule. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The decision goes in `update_manifest_on_hop`.** It is the one writer of `resumeId`, and its only caller is the hop at `:2310`. `session_handle` and `session_flag` are read once per prompt at `:1657-1659` and have no branch to compare. Round 1 upheld this location.

**TRAP — the plan's comparand is wrong. Compare against `$PLOT_BRANCH`, not the manifest.** The plan says *"the manifest holds the old one"*. At hop time it does not. The sequence is: `clear_manifest_branch` (`:2129`) writes `branch: ""`; the registry's `assignSlice` writes the NEW branch into the manifest; `assigned_branch` (`:616`, polled at `:2211`) reads that value back as `next_branch`. So when `update_manifest_on_hop` runs, `manifest.branch === $2` on every hop, and a comparison against it never mints. The previous branch survives only in `$PLOT_BRANCH`, which the loop re-exports at `:2317`, after the hop. Pass the old branch in (for example a fifth argument, or mint at the call site and hand the result in as `$4`). A test that seeds the manifest with the old branch and then calls the function passes and proves nothing. Drive the test through the real clear → assign → hop sequence, or assert on the manifest as the loop leaves it.

**Mint the id with `plot_session_id` (`plot-dispatch.sh:404`), not a new generator.** It lowercases `uuidgen` output because the runtime writes lowercase transcript filenames and the board joins on exact string equality. It is defined in dispatch and is not sourced by the loop. Move it to a shared sourced file, or source it; do not copy it.

**`session` cannot simply follow the hop.** `session` is the manifest's filename (`plot-dispatch.sh:1449`, `$manifest_dir/$session.json`), Drop's key, the React key for agent rows, the rendered agent name, and `assignSlice`'s first argument (the plan's table lists nine sites). Rewriting it renames the agent. The expected answer is to move the board's transcript join (`packages/board/src/server/registry.ts:787-788`) to `resumeId`, falling back to `session` where `resumeId` is empty, and to leave `session` alone. The PR must state which it chose. `registry.ts:234-238` says *"Nothing may assume the two agree"*; the change must keep that true rather than make them agree.

**A correction resumes into `resumeId`** (`packages/board/src/server/resume.ts:47`, `packages/domain/src/rules/resume.ts`). After a mint and before the new slice's first prompt, no transcript exists for the new id, so `resumeAvailability` answers unavailable. That is the correct answer: it says there is no conversation to correct yet. Do not "fix" it by resuming the old slice's conversation.

**`attempts` stays fixed.** The node one-liner round-trips every field it does not name. Keep that shape; do not rebuild the object.

**An empty handle still leaves `resumeId` alone** (`:305-308`). A failed mint must not blank the field.

**The idle rule is an independent defect, not fixed by this change.** `plot-transcript-quiet.sh:27-40` reads the newest mtime across the desk directory and deliberately declines a session id. A fresh handle writes a new file in the same directory, and nothing writes while the new conversation loads. Either fix it or file an issue on those grounds. Do not file it as *"rarer now"*.

**Establish the commits, or drop the claim.** `reset_desk` detaches to `origin/<main>` at `:928` before it cuts or attaches the branch, and `monitor_has_commits` (`plot-worker-monitor.sh:419`) counts only file-touching commits since `origin/HEAD`, so the empty claim does not count. Two live possibilities: the reset fell through to the create path at `:2227`, or the branch already carried pushed work. State which in the PR, with the evidence, or state that it cannot be established from what the operator reported.

**Rules carried over:** absent is not false (a missing transcript is not a missing conversation); read the exit code, not the emptiness; `--resume` with a blank value opens an interactive picker and hangs a `-p` run (`:733-736`), so the flag and the value must never disagree.

### Done when

The plan's `## Done when` list is the specification. The assertions that a naive implementation passes without:

- **Different branch → new handle, across TWO hops**, read from the manifest as the loop leaves it. This catches the comparand trap above: a comparison against `manifest.branch` passes a one-hop unit test that seeds the old branch, and never fires in the loop.
- **Same branch → same handle.** This catches an implementation that always mints.
- **The first prompt after a hop carries `--session-id` with the new id, not `--resume`.** This is the measured failure: 2 770 s of reload against a 900 s window.
- **The board renders `model`, `contextTokens` and `lastActivity` from the CURRENT slice's transcript** after a hop. With the join left on `session`, the row reads a dead session and nothing surfaces it.
- **`attempts` and an unnamed manifest field survive a hop.**
- **Update the existing tests that encode the overturned decision:** `test/reconcile/second-slice.test.mjs:283-288` asserts `after.resumeId === SESSION` after a hop. That assertion is the decision this plan overturns; rewrite it, and keep one test that discriminates. Check `test/reconcile/free-window.test.mjs:261` and `declaration-hop.test.mjs` too.
- **Update the `:271-284` comment block**, which argues for one conversation per agent. State current behaviour; the history goes in the commit message.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (rebuilds `board-server.mjs`; commit the rebuilt artifact), `pnpm run typecheck`. Do not run `test:e2e` locally. Add a changeset with the description first and the `bumps:` block last (`plot` for the loop, `@plot-pm/board` for the registry join); `plan:` may name the plan file.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` inside the slice heading in the plan's `## Slices` section: `(Branch: bug/a-slice-starts-its-own-conversation, PR: #<number>)`.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-worker-loop.sh` (the hop and its comment block)
- `skills/plot/scripts/plot-dispatch.sh` only to move `plot_session_id` to a shared file
- `packages/board/src/server/registry.ts` (the transcript join) and the rebuilt `skills/plot/scripts/board/*.mjs` artifacts
- `skills/plot/scripts/plot-transcript-quiet.sh` / `plot-worker-monitor.sh` only if the idle rule is fixed here rather than filed
- tests under `test/reconcile/` and `packages/board/test/`

Verified at dispatch: no other remote branch changes `plot-worker-loop.sh`, `plot-worker-monitor.sh`, `plot-transcript-quiet.sh`, `registry.ts`, `transcript.ts` or `second-slice.test.mjs`. `bug/a-daemon-spends-within-its-means` holds `registryd.ts` / `registryd-main.ts` / `fleet.ts`, and both branches rebuild the board artifact. On an artifact conflict, take either side and run `pnpm build:board`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
