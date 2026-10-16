## Implementation brief — bitbucket-parity-and-app-identities (wave 1: slice 5 of 5)

- **Plan (canonical):** docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1861 merged
- **Branch:** `bug/app-identities-refuse-by-name` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` required check, per `docs/review-status-rollout.md`

This branch runs in the same wave as four siblings (`bug/merge-names-what-it-did`, `bug/bitbucket-pages-read-complete`, `feature/bitbucket-commit-status-parity`, `bug/writer-app-push-uses-only-the-app`). None of the five waits on another — the plan's `## Design` names the wave as one flat set, no sub-waves. The nearest-by-content sibling is `bug/writer-app-push-uses-only-the-app` (slice 4): it edits `plot-push-writer-app.mjs` and `plot-push-main.sh`, both neighbours of the `plot-github-app.mjs` module this branch also touches. See Scope guard.

### What to build

Five independent findings from issues #1824 and #1827, all on the GitHub-App identity path (`plot-github-app.mjs`, `plot-commit-status.mjs`, `plot-host.sh`), plus one test-fixture cleanup and one changeset-text fix. None is a redesign — each is a named defect with a one-line fix:

1. **`resolveApp`'s `absent` flag is wrong on a failed config read.** `plot-github-app.mjs:50` sets `absent: !declared` — `declared` is the trimmed stdout of `plot-config.sh get <key> ''`, so a `plot-config.sh` crash (non-zero exit, stderr noise, whatever) and a genuinely undeclared key both produce an empty string and both read as `absent: true`. The caller (`plot-commit-status.mjs`'s `reviewApp()`, and `plot-merger-token.mjs`) uses `absent` to choose between "refuse by name" and "fall back to the ambient identity" — a crashed read should refuse by name, not silently fall back as if nobody had configured the key at all. Fix: capture `plot-config.sh`'s exit code via `run()` (currently `run()` at line 25-31 swallows it into `''` on *any* throw — a non-zero exit and "command not found" are indistinguishable from "printed nothing"). `absent` must be true only on exit 0 with empty stdout.

2. **`plot-commit-status.mjs` signs a JWT it never uses.** Lines 63-68: `jwt = appJwt(app)` is assigned and then never read — `installationToken(app, repo)` at line 70 mints its own JWT internally (`plot-github-app.mjs:97`). The first signing is pure waste (an RSA-SHA256 sign is not free) and dead code that looks load-bearing. Delete the unused `jwt`/`try` block; keep the `--check` early exit at line 60, which already proves the key is readable without signing anything.

3. **`plot-host.sh`'s repo lookup failure has no name.** `plot-host.sh:5303` runs `gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null` and pipes whatever comes out (including empty, on failure) straight into `plot-commit-status.mjs --repo`. That script's only check is `if (!repo) refuse(3, 'could not resolve owner/repo from the current checkout')` (`plot-commit-status.mjs:61`) — true but uninformative: it doesn't say `gh repo view` was the call that failed, so a caller debugging a stuck commit-status write has to go re-derive that themselves. Same shape at `plot-host.sh:3895` for `pr-merge`'s `merger_repo`. Name the failing command in the refusal text (either have `plot-host.sh` check `gh repo view`'s own exit code before invoking the Node helper, or pass enough context that the Node-side refusal can say "gh repo view returned nothing").

4. **`docs/review-status-rollout.md` step 4 doesn't check the push actor.** The Writer App section's step 4 (around line 180) says to "confirm the commit is authored by the App's bot identity" — but doesn't tell the operator which field to check or how a maintainer's own push would look different. Tighten it to name the concrete check (commit author / `git log -1 --format='%an <%ae>'` showing the App's bot identity, e.g. `plot-writer[bot]`, not the maintainer's own name) so the verification step is actually executable, not just aspirational.

5. **Real exit codes in the changeset.** The changeset for this slice must state the setup this introduces (which `## Plot Config` keys are now checked more strictly) and the real exit codes callers will see — 4 for a malformed/unreadable key, nothing new from this slice's own fix (the `absent` detection correction doesn't change externally-visible exit codes, only which refusal path is taken for a crash vs. a true absence). Don't let the changeset imply a new exit code exists if testing shows only the choice between 4 and 5 changed.

### Decisions this plan settles — do not re-derive them

**`absent` must come from exit 0 with empty output, nothing else (plan's "Slice 5 rule").** The naive fix is "treat any falsy `declared` as absent" — that's the current, wrong behavior. The correct fix distinguishes "the script ran and printed nothing" from "the script could not run." `run()` at `plot-github-app.mjs:25-31` currently discards `execFileSync`'s exit code entirely inside its `catch`; preserve or re-derive that signal rather than adding a second, parallel way to ask "did this fail" elsewhere.

**Do not touch `plot-push-writer-app.mjs`, `plot-push-main.sh`, or `pushmain.test.mjs`.** Those are slice 4's files (exit-code passthrough for the Writer App push, credential-helper hardening). This slice only touches the shared `plot-github-app.mjs` module and the commit-status / pr-merge call sites. If a fix here would require editing a slice-4 file, stop and report it rather than reaching across — the plan's own Notes section flags this exact collision risk between slices 4 and 5.

**The `approve*.test.mjs` fixture consolidation is a refactor with no behavior change.** Confirmed by reading the six files: `test/reconcile/approve.test.mjs`, `approve-entry.test.mjs`, and `approve-in-session.test.mjs` each define their own `makeRepo` function (different signatures: `(planBody, files)`, `(planBody, host)`, `(planBody)`); `approve-batch.test.mjs`, `approve-record-outside-comments.test.mjs`, and `approve-takes-effect.test.mjs` inline the equivalent `mkdtemp` + `git init` + stub-dir setup without naming it `makeRepo` at all. All six build the same shape: a scratch repo directory, a stub-command dir on `PATH`, and a plan file written into it. Move this to one shared helper (new file under `test/reconcile/`, or an existing shared-helpers module if one already exists — check before creating a new one) that the six tests import. This is NOT a behavior change: each test's assertions and fixture *content* stay exactly as they are; only the *construction* code is deduplicated. A diff that changes what any test asserts is out of scope here — flag it instead of folding it in.

**Rules carried over unchanged, worth restating because this slice's whole shape is "stop treating absent as a safe default":**
- **Absent is not false.** This is the same invariant issue #1827 names for `resolveApp`, and it's the same invariant the repo's layering docs state for the PR index (`## Layering Rule` / `## A Decision Reads The Index` in `CLAUDE.md`): a failed read is never silently folded into "the thing isn't there." Read the exit code, not the emptiness of the output.
- **No credential leaves the process except in a request header.** Both `plot-github-app.mjs` and `plot-commit-status.mjs` carry this invariant in their file-header comments already — the JWT and installation token never touch argv, a file, or a log line. Nothing in this slice's fixes should change that; if a fix for finding #3 (naming the failed repo lookup) is tempted to log the `gh repo view` command's raw output for debugging, don't — name the failure, not the credential-adjacent context around it (there's no credential in a repo-name lookup, but keep the discipline).

### Done when

The plan's `## Done when` is implicit in its per-issue table (`## Motivation`) and the slice's own listed findings — each of the five items above must no longer reproduce:

- A `plot-config.sh get 'Review app' ''` call that fails (non-zero exit) is distinguishable, in `resolveApp`'s return value, from a `## Plot Config` section that simply has no `Review app` key. Write or extend a test that stubs a failing `plot-config.sh` and asserts `absent: false` (it must refuse by name, not fall back).
- `plot-commit-status.mjs` no longer calls `appJwt` before `installationToken` — grep for `appJwt` in that file should show zero call sites (the import can go too, if nothing else in the file needs it).
- The refusal text from a failed `gh repo view` names the lookup, for both `commit-status` and `pr-merge` call sites in `plot-host.sh`.
- `docs/review-status-rollout.md` step 4's verification instruction names a concrete field/command, not just "confirm... is authored by."
- The six `approve*.test.mjs` files all construct their sandbox fixture through one shared helper, and `pnpm test` / the affected `node --test` files still pass with no assertion changes.
- The changeset names the exit codes a caller actually sees after this fix (4 vs. 5, not inventing a new code).

Plus the repo's standing gates: no `State:` line hand-edited (none should be touched by this slice), and the shell-line ratchet — `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. If fix #3 (naming the failed repo lookup) adds lines to `plot-host.sh`, either trim shell elsewhere in the same change or move the logic into the Node helper instead, which doesn't count against the ratchet.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests and typecheck for the files this branch actually touches. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR; don't run them locally as a matter of course — a failure there comes back as a correction.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the wave heading as title, the plan and this brief in the body. Push the first real commit as soon as it exists — don't wait for all five findings to be done before the first push.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `bug/app-identities-refuse-by-name` line under `### Wave 1`).

### Scope guard

**This branch owns:** `skills/plot/scripts/plot-github-app.mjs`, `skills/plot/scripts/plot-commit-status.mjs`, the commit-status and pr-merge repo-lookup lines in `skills/plot/scripts/plot-host.sh` (around lines 3895 and 5303), `docs/review-status-rollout.md`, the six `test/reconcile/approve*.test.mjs` fixtures, and this slice's changeset.

**Read but not edited:** `skills/plot/scripts/plot-merger-token.mjs` (imports `resolveApp`/`installationToken` from `plot-github-app.mjs` — the `absent`-flag fix changes its behavior too, so re-check its exit-4-vs-5 branching after the fix, but the file itself needs no structural edit unless testing shows otherwise).

**Siblings in flight, verified at brief-writing time (2026-10-16):**
- `bug/merge-names-what-it-did` (slice 1) — `packages/board/src/server/entry/merge.ts`, the gate's refusal text, `skills/plot-sprint/SKILL_new.md`. No file overlap with this branch.
- `bug/bitbucket-pages-read-complete` (slice 2) — `plot-host.sh`'s Bitbucket paging logic and `adapters/host/listing-paging.ts`. Touches `plot-host.sh` but a different case (`pr-list`/`issue-list` paging, not `commit-status`/`pr-merge`) — low collision risk, but both branches land in the same large shell file, so expect a merge conflict in `plot-host.sh` even without a logic collision.
- `feature/bitbucket-commit-status-parity` (slice 3) — `plot-bitbucket-commit-status.mjs`, `STATE_MAP`, and the `commit-status` row in `skills/plot/scripts/README.md`. This is the Bitbucket arm of the same `commit-status` op this branch's GitHub arm lives under (`plot-host.sh:5288-5304`) — same case statement, different backend branch. Expect a `plot-host.sh` merge conflict here too; resolve by keeping both backends' lines, not by picking one side.
- `bug/writer-app-push-uses-only-the-app` (slice 4) — `plot-push-writer-app.mjs`, `plot-merger-token.mjs`, `plot-push-main.sh`, `pushmain.test.mjs`. Named by the plan's own Notes as the collision risk with this slice: both touch `plot-github-app.mjs` neighbours. If `/plot-reslice` hasn't already ordered them, the first of the two to merge should expect the second to rebase.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
