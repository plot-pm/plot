## Implementation brief — a-lifecycle-micro-pr-merged-past (wave 4: Identities (build))

- **Plan (canonical):** docs/plans/2026-10-15-a-lifecycle-micro-pr-merged-past.md on main
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1738 merged
- **Branch:** `infra/a-lifecycle-micro-pr-merged-past-identities-build` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (one full review, CI green, no HIGH finding)

Wave 1 (`…-retry`) merged as #1795 and wave 2 (`…-pin`) as #1809; both preconditions this slice needs are on main today — `pr-merge` refuses an unpinned GitHub merge (`plot-host.sh:3886`) and `ladder.ts` runs the bounded commit/push retry with no micro-PR fallback. Issue: #1737.

### What to build

This is the `### Identities` slice over again. #1816 — the PR for `infra/a-lifecycle-micro-pr-merged-past-identities` — merged on 2026-10-16 carrying **0 additions and 0 deletions** (`gh pr view 1816` confirms it; verify again before you start in case something landed between then and now). It carried only the branch's claim commit. The plan's own `Rejected:` record names this: "the writer and merger identities were never built." Nothing of the mechanism below exists on `main` — grep confirms no `Writer app` / `Merger app` key anywhere in `CLAUDE.md` or the scripts, and no `infra/…-identities*` branch remains on the remote.

Two credentials with one job each, both read from Plot Config keys the way `Review app` is (`<app id> <key path>`, relative path resolves against the repository root — in practice use an absolute path, `~` is not expanded):

- **Writer App:** lifecycle pushes to the default branch (`skills/plot/scripts/plot-push-main.sh`, called from `packages/board/src/server/entry/ladder.ts:176`, and from `/plot-approve` and `/plot-deliver`) authenticate with the writer App's installation token. The App is on the ruleset bypass list with `Contents: write` only. It never merges.
- **Merger App:** every `plot-host.sh pr-merge` on GitHub runs with the merger App's installation token. The App is NOT on the bypass list, with `Contents: write` and `Pull requests: write`. A merge by it passes only when `validate` and `plot/review` are green on the pinned head.

The failure this closes: #1730 merged four seconds after it opened with no `validate` run and no `plot/review` status, because the merge ran as the maintainer's account, which holds `bypass_mode: always`. The retry slice removed the ladder's micro-PR and the pin slice made `pr-merge` refuse an unpinned merge. Neither changes WHO merges, so a pinned merge by the maintainer's token still bypasses the checks. This slice changes that — still, because the prior attempt shipped no code.

The docs give the person's setup steps for both Apps (extend `docs/review-status-rollout.md` or add a sibling doc, and link it from `skills/plot/scripts/README.md`'s rows). The merger stays off the bypass list in every instruction.

### Decisions the plan settles — do not re-derive them

- **Two identities, no combined one.** A credential holding both jobs would sit on the bypass list and could merge past the gate. Do not offer a single-App option, a `--admin` flag, or a fallback that merges as the signed-in `gh` user when the merger key is absent.
- **The merger is a third App**, not the review App (`plot-review`, `Commit statuses: write`, app id 5317669) and not `plot-board-builder` (key only in Actions secrets, on the bypass list). Its key lives under `~/.config/plot/` and a Plot Config key names it, as `Review app` does. Its merges show as `<app>[bot]`.
- **No credential leaves its process except in a request header.** `plot-commit-status.mjs`'s header comment states it: the JWT and the installation token travel through `fetch`, never a child's argv (`ps` shows every local user), a file, stderr or a log. A `git push` with the token in the remote URL or `-c http.extraheader=…` on the command line breaks this; pass it through the environment or an askpass helper that reads it. Measure with `ps` in a test, not by reading the code.
- **Absent key refuses by name, never degrades.** `plot-commit-status.mjs` exits 4 naming the key when `Review app` is absent or unreadable (`reviewApp()` in that file). The two new keys do the same, and a write or a merge with no credential does not fall back to the maintainer's identity. A silent fallback re-opens #1737.
- **Bitbucket is untouched.** `pr-merge` there keeps its exit 4 on a pin (`plot-host.sh:3892`) and its own `bb` path. A `Merger app` key is a GitHub concern.
- **Break-glass is unchanged.** The maintainer's admin merge with a `review-bypass: <reason>` comment stays, and `/plot-reconcile` reports it. Do not build tooling for it.
- **Reuse the exchange.** The RS256 JWT → `GET /repos/{owner}/{repo}/installation` → `POST /app/installations/{id}/access_tokens` flow already exists in `plot-commit-status.mjs` (`appJwt`, the installation-token call, and `call()`). Extract it once and call it three times (review, writer, merger) rather than copying it. Read that file first — it is short and already carries the comments explaining each step.

Carried-over rules: absent is not false (a missing key is a refusal, not "no bypass needed"); read exit codes, not output emptiness; every `pr-merge` caller already passes `--match-head` since #1809, so this slice adds no pin work.

### Done when

The plan's `## Slices` line for this branch is the specification. Assertions that exist because a naive implementation passes without them:

- A lifecycle push with the writer key absent exits non-zero and the stub `git` records **no push**. An exit-code check alone passes an implementation that pushes with the ambient identity first.
- A `pr-merge` on GitHub with the merger key absent exits non-zero and the stub `gh` records **no call**; with the key present the stub `gh` sees the installation token in its environment and not in its argv.
- Neither token appears in any child's argv, in stderr, or in a log line (capture all three in the test).
- A configuration naming one App id for both keys is refused. Two jobs on one credential is the case the plan forbids.
- Existing tests that stub `gh pr merge` keep passing with the stubbed credential path; the ones that call `pr-merge` for real in a sandbox clear the new keys explicitly.

Plus: a changeset (`plot` patch with a `bumps:` block for each skill you touch, description first and `bumps:` last; `@plot-pm/board` patch if `ladder.ts` or `merge.ts` changes). Do not commit the board artifact (`scripts/check-no-bundle-diff.sh`). `scripts/check-shell-lines.sh` refuses growth in shipped shell against the merge base: write the token exchange in the Node helper and keep `plot-host.sh` and `plot-push-main.sh` additions small, or remove shell elsewhere in the same change. The gate stores no number and has no override. A new script gets a row in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `### Identities (build)` in the plan. Push the first real commit as soon as it exists — #1816 shipped only a claim commit for over a day; do not repeat that. The person creates the two Apps and records the keys in `## Plot Config`; this branch ships the code and the docs, and does not create Apps or edit this repo's own Plot Config values for keys whose Apps do not exist yet.

### Scope guard

This branch owns the credential exchange helper, the Plot Config key reads for `Writer app` and `Merger app`, the token wiring in `plot-push-main.sh` / `plot-host.sh pr-merge` / the ladder's push, their tests, and the setup docs.

Not here: the push retry (`…-retry`, merged), the pin (`…-pin`, merged), the review status itself (`plot-commit-status.mjs` behaviour stays; only the shared exchange moves). No other branch of this plan is in flight — the plain `infra/…-identities` branch is closed out by the `Rejected:` record and this wave replaces it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
