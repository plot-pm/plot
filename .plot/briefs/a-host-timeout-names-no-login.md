## Implementation brief — a-pr-refresh-reads-the-history-once-a-day (slice 3: A host timeout names no login)

- **Plan (canonical):** `docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-host-timeout-names-no-login` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; issue #1087

Slice 3 of 3. It waits on nothing. Slice 1 (`bug/a-delta-keeps-the-store-whole`, #1180) and slice 2 (`bug/the-full-read-asks-verdicts-of-open-prs-only`, #1203) are merged. This branch touches only the failure kinds in `skills/plot/scripts/plot-host.sh` and its test.

### What to build

#1087 reports that the board's rich PR listing sometimes ends in a GitHub GraphQL 504, and that the banner then tells the reader to run `gh auth login`. A server-side timeout is not a login problem, so the advice sends a reader to a command that does nothing.

The cause is in `host_failure_kind` (`plot-host.sh:524`). It knows three words: `secondary`, `throttled` and `failed`. A 504 matches neither limit pattern, so it is `failed`. `pr_list_failed` (`plot-host.sh:590`) treats `failed` as the one kind a command fixes and calls `host_repair`, which prints `If it is not logged in: gh auth login`.

Build two changes, both in `plot-host.sh`:

- **`host_failure_kind` answers `timeout`.** A fourth word, for a server-side timeout: the text `HTTP 502`, `HTTP 503`, `HTTP 504`, and GitHub's *couldn't respond to your request in time*. Match case-insensitively with `LC_ALL=C grep -qiE`, as the two arms above it do. Update the function's `→ throttled|secondary|failed` comment and its header to say four answers.
- **`pr_list_failed` gains a `timeout` arm.** It prints `plot-host: pr-list: host timed out — ${err:-…}` on stderr, then one line saying the server took too long, nothing is wrong with the login, and the next refresh asks again. It names no `auth login` and calls no `host_repair`. It exits 3, exactly as the generic path does.

### The decisions the plan settles — do not re-derive them

**Exit 3 stays.** The exit codes are a closed vocabulary (`plot-host.sh:655-668`): 6 is a burst refusal, 5 is throttled, 4 is no such capability, 7 is a partial answer, 3 is everything else. A new code for `timeout` would change every caller that branches on `rc`, and `plot-fleet-scan.sh:675` reads the code directly. The word in the message separates the cases, the way `host_failure_kind`'s own header says it does for `throttled` and `failed`.

**The split falls one way only.** An unrecognised error is never given the more specific name. `timeout` tells a reader *wait, nothing is wrong with you*, and that advice is wrong for a refused credential. So the patterns anchor on the HTTP status word: `HTTP 50[234]`, not a bare `\b504\b`, which would match a run id or a line count. The existing test `host: pr-list names any OTHER failure plainly` (`test/reconcile/host.test.mjs:3859`) feeds `error connecting to api.github.com: 503 Service Unavailable` and expects code 3 and no `throttled`. That text has no `HTTP` before the status, so it stays `failed`. That test must stay green unchanged. If it fails, the pattern is too wide.

**The order is part of the rule.** Test `secondary` first, then `throttled`, then `timeout`, then `failed`. A rate-limit message that also carries a 5xx status must stay `throttled`, because patience until the reset is the right advice for it. Put the `timeout` arm after both limit arms.

**No retry, no new exit code, no new script.** The plan's *What this does NOT do* section rules out an immediate retry: it doubles the cost of a request that already ran too long. Slice 1's fallback already answers a delta after a failed full read.

**The board needs no change.** `host-notes.ts:370` prints `PR data unavailable (${fleet.prError})` from the adapter's own sentence, and a grep of `packages/board/src` and `packages/domain/src` finds no `auth login` string. Do not add a client-side classification. A second reader of the failure text is a second implementation free to drift from `host_failure_kind`.

**Rules carried over from the host adapter:**

- **Read the exit code, not the emptiness.** A failed `pr-list` prints nothing on stdout and exits non-zero. The new arm keeps that.
- **The connector names its own repair.** Only `host_repair` names a login command, and only for the one kind a command fixes. The `timeout` arm names none.
- **Every host call goes through `plot-host.sh`.** `scripts/check-host-cli-callers.sh` gates this. Add no `gh` or `bb` call anywhere else.
- **Scripts keep the shell's comment idiom.** Match the surrounding header style in `plot-host.sh`: state the measurement or the failure that justifies each arm.

### Done when

The plan's `## Done when` list is the specification, and the line this slice owns is: *A 504 from `pr-list` prints `host timed out` and no login advice.*

The tests the plan names, in `test/reconcile/host.test.mjs`, beside the `throttled` tests at `:3850-3866`. Build them from `makeStubs({ ghFail: … })` and `runAllowFail` as those do:

- A stubbed `gh` failing with `HTTP 504: We couldn't respond to your request in time` exits 3, prints `host timed out`, and does not print `auth login`.
- A stubbed `bb` failing with `HTTP 503` does the same. Find how the bitbucket tests stub the failure (`bbFail`, as at `:3837`) and set `PLOT_HOST: 'bitbucket'`.
- A rate-limit text is still `throttled` (exit 5), which the existing test at `:3853` already asserts. Add one more case whose text carries both a rate-limit phrase and `HTTP 504`, and assert exit 5.

Assertions that exist because a naive implementation would pass without them:

- **No `auth login` in stderr, on both backends.** A test that checks only the words `host timed out` passes if the arm prints the word and then falls through to `host_repair`.
- **Exit 3, not 5 or 6.** A test that checks only the message passes if the arm reuses a limit's exit code, which makes a caller wait for a reset that never comes.
- **The unrecognised-failure test stays green and unchanged.** It is the guard that `timeout` did not widen to every failure.

Plus the repo's gates, on Node 24 (`nvm use`):

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do **not** run `pnpm run test:e2e` locally.
- Add a changeset in `.changeset/`: frontmatter `'plot': patch`, the description first, and a `bumps:` block last that names `skills: plot: patch` (`plot-host.sh` lives under `skills/plot/`). The description states the measured behaviour: a 504 from `pr-list` now reads *host timed out* with no login advice. Copy the format from a sibling file in `.changeset/` or from `git log`, and touch none of the siblings'.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. When the PR exists, add `, PR: #<number>` inside the parentheses of this slice's heading in the plan's `## Slices` section, as slices 1 and 2 do. The PR body names issue #1087.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` (`host_failure_kind`, `pr_list_failed`) and `test/reconcile/host.test.mjs`, plus its changeset.

Other branches in flight, read from the plan at dispatch: none. Slices 1 and 2 of this plan are merged. Other plans may touch `plot-host.sh`, so rebase before pushing. If the `pr-list` code near `host_failure_kind` has moved, grep for the function names, not the line numbers above.

If you find something the plan did not anticipate, report it rather than improvising outside scope. In particular, `issue-list` and the other host ops that call `host_repair` on a 5xx are out of scope: the plan names `pr-list` only.
