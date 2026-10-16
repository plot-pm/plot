## Implementation brief — bitbucket-parity-and-app-identities (wave 1: slice 4 of 5)

- **Plan (canonical):** docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1861 merged
- **Branch:** `bug/writer-app-push-uses-only-the-app` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` required check, per `docs/review-status-rollout.md`

This branch runs in the same wave as four siblings (`bug/merge-names-what-it-did`, `bug/bitbucket-pages-read-complete`, `feature/bitbucket-commit-status-parity`, `bug/app-identities-refuse-by-name`). None of the five waits on another — the plan's `## Design` names the wave as one flat set, no sub-waves. The nearest-by-content sibling is `bug/app-identities-refuse-by-name` (slice 5): it edits `plot-github-app.mjs`, a neighbour of the `plot-push-writer-app.mjs` / `plot-merger-token.mjs` files this branch touches. See Scope guard.

### What to build

Five Writer App push findings from issue #1824, all on the same push path (`plot-push-writer-app.mjs` → `plot-push-main.sh` → `ladder.ts`'s `commitAndPush`). None is a redesign — each is a named defect with a scoped fix:

1. **The push must use the App token only — no credential helper as a second source.** `plot-push-writer-app.mjs:76` already runs `git push origin <branch>:<default>` with `GIT_ASKPASS` set to the one-shot askpass script and `GIT_TERMINAL_PROMPT=0`. Confirm (and if missing, add) `-c credential.helper=` on that `spawnSync` call so a configured credential helper on the host machine cannot supply a second, ambient credential alongside — or instead of — the App's installation token. The plan's own rule (`## Design` → "Slice 4 rule"): *"A credential helper must not be a second source for the App push… the askpass token is the only credential and the origin URL does not matter."*

2. **The token directory must be removed on every exit path, not just the happy one.** `plot-push-writer-app.mjs:62-84` already wraps the push in `try { … } finally { fs.rmSync(dir, …) }` — verify this holds for every `refuse()` call too. Look closely: `refuse()` (line 33-36) calls `process.exit(code)` directly, which bypasses a `finally` block if the token directory was created before a later refusal. Trace each `refuse()` call site against where `dir` is created (line 62) — the three refusals before line 62 (`usage`, absent config, malformed/unreadable key) never created a directory, so they're already safe; confirm no refusal path *after* line 62 exists that could exit without hitting the `finally`.

3. **Exit 3 and exit 4 must pass through `classify` unexamined in `plot-push-main.sh`.** Today (`plot-push-main.sh:104-106`) the shell only branches on exit 5 (`[ "$code" = 5 ]` → fall back to ambient push); any other non-zero code from `plot-push-writer-app.mjs` (3: couldn't resolve repo/mint token: 4: malformed/unreadable key) falls through to `classify "$code" "$err"` at line 108, which treats any non-zero as `rejected` (line 54: `[ "$code" -ne 0 ] && { printf 'rejected'; return; }`). The plan's rule: *"`plot-push-main.sh` passes exit 3 and 4 through before `classify`, so the ladder in `ladder.ts` stops retrying a refusal."* Check whether `classify`'s blanket `rejected` for 3/4 is itself the problem — `ladder.ts`'s `commitAndPush` (packages/board/src/server/entry/ladder.ts:180-203) retries on any non-`pushed` outcome up to `DEFAULT_ATTEMPTS` (5) with a 2-10s jittered wait between each. A malformed key (exit 4) or an unresolvable repo (exit 3) will never succeed on retry — they are refusals, not transient rejections — so retrying them 5 times burns ~20-40s for a guaranteed-identical failure. The fix is naming these as a distinct, non-retried outcome (not `rejected`) that the shell reports distinctly and the ladder gives up on immediately rather than looping. Decide the exact mechanism (a new `classify` outcome word, or `plot-push-main.sh` exiting with 3/4 itself rather than folding into 1) by reading how `ladder.ts:180` discriminates `pushOut.code === 0` today — whatever you choose must give the ladder a way to tell "don't retry this" from "retry this."

4. **An invalid PEM must be caught, not thrown as an unhandled exception.** Both `plot-push-writer-app.mjs:29` and `plot-merger-token.mjs:24` import `installationToken`/`resolveApp` from `plot-github-app.mjs`. `resolveApp` (plot-github-app.mjs:45-62) checks only that the key *file* is readable (`fs.accessSync`), never that its *contents* parse as a valid PEM. The first point anything tries to use the key is `appJwt` (plot-github-app.mjs:67-71): `createSign('RSA-SHA256').update(input).sign(fs.readFileSync(keyPath))` — `createSign(...).sign()` throws a raw Node crypto error (not a Plot refusal) on a malformed key, which `installationToken`'s `await` surfaces as an unhandled rejection in the caller (`plot-push-writer-app.mjs:59` and `plot-merger-token.mjs:50` have no try/catch around that call). Wrap the `appJwt` call (inside `installationToken`, so both callers get the fix once) in a try/catch that turns a thrown sign error into the same `{ token: undefined, error: "..." }` shape `installationToken` already returns for its own two failure branches — naming the App id and that the key failed to sign, not raw Node error text. This keeps `plot-merger-token.mjs`'s existing exit-3 path (`if (!token) refuse(3, error)`) as the single place both callers land on a bad key, post-token-exchange.

5. **The `pushmain.test.mjs` exit-code assertion is too loose.** Line 235: `assert.notEqual(r.code, 0)` after a declared, readable key fails at the token exchange (`App 999001 has no installation on example/repo`). That assertion passes for *any* non-zero code, including a code this slice's finding #3 fix might change. Tighten it to the specific exit code the App-exchange failure actually produces (3, per `plot-push-writer-app.mjs:60`'s `refuse(3, error)` on `!token`) so a future regression that silently shifts the exit code is caught here instead of passing unnoticed.

### Decisions this plan settles — do not re-derive them

**The askpass-file mechanism is already correct and is not in scope to redesign.** `plot-push-writer-app.mjs:62-84`'s private-temp-directory-plus-mode-0600-file approach is the *existing*, working no-credential-in-argv design (see the file's own header comment, lines 16-22). This slice's finding #1 is about closing one additional leak (a credential helper as a second, uncontrolled source) — not about replacing the askpass approach itself.

**`refuse()`'s direct `process.exit()` is deliberate, and the `finally` gap (finding #2) is about ORDER, not about removing `process.exit`.** The three `refuse()` calls before `dir` is created (lines 39, 42, 43) are already safe because there is nothing to clean up yet. Do not restructure `refuse()` into something that returns instead of exiting — that would be a wider behavior change than this finding asks for. Confirm the ordering is safe as-is, or move the directory creation later / add an explicit cleanup only if a genuine gap is found.

**A credential helper check belongs on the `spawnSync` call, not as a separate pre-flight step.** `-c credential.helper=` is a `git` config override scoped to that one invocation — it doesn't require reading or clearing the user's global/repo git config first. Don't add a step that inspects or mutates `git config --global credential.helper`; override it for this one call only, the same way `env` already scopes `GIT_ASKPASS` to this one call.

**Rules carried over unchanged, worth restating because this slice's whole shape is "only one credential, and only one caller reads it":**
- **No credential leaves the process except in a request header, or for git, through `GIT_ASKPASS`.** Both `plot-push-writer-app.mjs` and `plot-github-app.mjs` carry this invariant in their file-header comments already. Nothing in this slice's fixes — including the try/catch for finding #4 — should log the token, the key path's contents, or raw request/response bodies; name the failure, not the credential-adjacent material around it.
- **Absent is not false; a crashed read is not the same as a declared-absent key.** This is `bug/app-identities-refuse-by-name`'s (slice 5) whole scope, not this slice's — `resolveApp`'s `absent` flag is slice 5's fix. Don't duplicate that fix here even though `plot-push-writer-app.mjs:41` calls `resolveApp` too; its exit-5 ("Writer app not configured") and exit-4 ("malformed/unreadable key") branches are already correct given what `resolveApp` returns today, and will keep working once slice 5 lands separately.

### Done when

The plan's `## Changelog` line for this slice: *"The Writer App push uses the App token only, removes its token file on every exit, and reports exit 3 and 4 by name."* Each of the five findings above must no longer reproduce:

- `plot-push-writer-app.mjs`'s `git push` invocation includes `-c credential.helper=` (or equivalent), and a test proves a configured credential helper is not consulted during the App push.
- Every exit path that created the token directory removes it — including a `refuse()` called after `dir` exists, if one is found or added.
- `plot-push-main.sh --classify` (or whatever mechanism you choose for finding #3) gives `ladder.ts`'s `commitAndPush` a way to stop retrying on exit 3 or 4 rather than looping through all 5 attempts. Extend `test/reconcile/pushmain.test.mjs`'s `--classify` tests to cover the new outcome, the same way the existing `clean`/`bypassed`/`unknown`/`rejected` cases are tested.
- A malformed PEM fed through `installationToken` (either caller) resolves to `{ token: undefined, error }` naming the App id, not an unhandled rejection — test by feeding `appJwt` a non-PEM string the way `pushmain.test.mjs:259`'s existing malformed-key test already does for the *pre-exchange* `resolveApp` check (this is the *post*-exchange case: a file that reads fine but whose contents don't sign).
- `pushmain.test.mjs:235`'s `assert.notEqual(r.code, 0)` becomes `assert.equal(r.code, 3)` (or the correct code once finding #3's mechanism is decided — re-verify this number against whatever that fix produces).

Plus the repo's standing gates: no `State:` line hand-edited (none should be touched by this slice), and the shell-line ratchet — `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. If finding #3's fix adds lines to `plot-push-main.sh`, either trim shell elsewhere in the same change or move the logic into `plot-push-writer-app.mjs` (already Node, not counted against the ratchet).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests and typecheck for the files this branch actually touches. The suites in the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR; don't run them locally as a matter of course — a failure there comes back as a correction.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads which plan names this branch and opens the PR with the wave heading as title, the plan and this brief in the body. Push the first real commit as soon as it exists — don't wait for all five findings to be done before the first push.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (the `bug/writer-app-push-uses-only-the-app` line under `### Wave 1`).

### Scope guard

**This branch owns:** `skills/plot/scripts/plot-push-writer-app.mjs`, `skills/plot/scripts/plot-push-main.sh`, `test/reconcile/pushmain.test.mjs`, and `skills/plot/scripts/plot-merger-token.mjs`'s call site for finding #4 (the `installationToken` try/catch itself lives in `plot-github-app.mjs`, read but not edited here — see below), plus this slice's changeset.

**Read but not edited:** `skills/plot/scripts/plot-github-app.mjs` — finding #4's fix (catching a sign error inside `installationToken`) touches this file, which is also slice 5's primary file. Since the fix is a single try/catch around one call inside a function slice 5 does not otherwise change (slice 5 edits `resolveApp` and `run()`, not `installationToken`/`appJwt`), make the edit here and flag it explicitly in the PR description as a narrow, named addition to a file slice 5 also owns — if `/plot-reslice` has not already ordered the two branches, expect whichever merges second to rebase past a small diff in this file, not a logic collision.

**Siblings in flight, verified at brief-writing time (2026-10-16):**
- `bug/merge-names-what-it-did` (slice 1) — `packages/board/src/server/entry/merge.ts`, the gate's refusal text, `skills/plot-sprint/SKILL_new.md`. No file overlap with this branch.
- `bug/bitbucket-pages-read-complete` (slice 2) — `plot-host.sh`'s Bitbucket paging logic and `adapters/host/listing-paging.ts`. No file overlap with this branch.
- `feature/bitbucket-commit-status-parity` (slice 3) — `plot-bitbucket-commit-status.mjs`, `STATE_MAP`, and the `commit-status` row in `skills/plot/scripts/README.md`. No file overlap with this branch.
- `bug/app-identities-refuse-by-name` (slice 5) — `plot-github-app.mjs`, `plot-commit-status.mjs`, `plot-host.sh`'s commit-status/pr-merge repo-lookup lines, `docs/review-status-rollout.md`, the six `approve*.test.mjs` fixtures. Named by the plan's own Notes as the collision risk with this slice: both touch `plot-github-app.mjs` neighbours. Slice 5's brief already names this same risk from its side and explicitly tells slice 5 NOT to touch this branch's three files — the one exception is finding #4 above, which this branch's own brief now carries into `plot-github-app.mjs` itself. If `/plot-reslice` hasn't already ordered the two, the first of the two to merge should expect the second to rebase.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
