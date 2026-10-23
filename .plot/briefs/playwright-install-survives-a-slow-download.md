## Implementation brief — ci-board-integration-fails-when-the

- **Plan (canonical):** docs/plans/2026-10-23-ci-board-integration-fails-when-the.md on main
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2362 merged
- **Branch:** `infra/playwright-install-survives-a-slow-download` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** plot-review (GitHub App), required since 2026-10-15

### What to build

Edit `.github/workflows/ci.yml`'s `board-integration` job: key the `Cache the
Playwright browser` step on the resolved Playwright version instead of on
`packages/board/package.json`, and give `Install Playwright browser` a bound
that survives a cold or slow run plus one retry.

The cause is settled — don't re-derive it. Pulled directly from the three
failed runs named in the plan's Motivation (`gh run view <id> --json jobs`
against runs `39827563096`, `39813209366`, `39806767896`, all 2026-10-22):

```
Cache the Playwright browser: success, 3-5s  (a cache HIT every time)
Install Playwright browser:   failure, ~3:13 elapsed
```

The install step's own log shows why a cache hit still times out:
`playwright install --with-deps chromium` runs `apt-get` for system packages
on every invocation regardless of the `~/.cache/ms-playwright` cache state.
In all three failures `apt-get` was mid-download against
`azure.archive.ubuntu.com` — 25.9 MB of packages, several `Get:` lines each
taking 20-40+ seconds — when the 3-minute bound cut it off. This is the
plan's cause **#2** ("the cache covers the browser binary and not the OS
packages, so a slow Ubuntu mirror costs time on a cache hit too"), not #1
(cache-key churn) or #3 (bound too low for a legitimately cold run — there
was no cold run in any of the three: the cache hit every time).

That changes the fix's shape from what the plan's bullet list implies: the
browser cache is not the thing that was stale, so re-keying it (plan line 39)
removes a theoretical future failure mode but **does not touch the measured
one**. The measured one needs the install step itself to stop re-running
`apt-get` on a cache hit — split the install per the plan's third bullet:
on a cache hit, `playwright install-deps chromium` alone (browser already
present, skip the browser fetch and the deps that are already satisfied by
whatever base image state produced the hit); on a miss, the full
`install --with-deps`. Do both edits — keying the cache correctly is still
right per the plan's reasoning about `package.json` churn — but the retry
and the install split are what fixes the four cited failures, not the key
alone.

### The decisions the plan settles — do not re-derive them

**Keep the retry inside the step, not a job-level rerun.** GitHub Actions has
no built-in step retry; the plan says "the slice keeps the retry mechanism
the repository already uses, if one exists, and adds no third-party action
for it." Grepped: this repo has no step-retry action anywhere in
`.github/workflows/`— the one `retry` hits in `ci.yml` (`git-retry.test.mjs`,
around line 1195) are Node-level retries around `fs.rmSync` in board/fleet
tests, an unrelated mechanism for an unrelated failure class. So "the
mechanism the repo already uses" resolves to **none exists** — write the
retry as a shell loop inside the `run:` block (e.g. `for i in 1 2; do … &&
break; done`) rather than reaching for a marketplace action, consistent with
the plan's "adds no third-party action" constraint.

**The job-level timeout is the binding constraint on how big the retry bound
can be, and it's tighter than it looks.** `board-integration` itself carries
`timeout-minutes: 15` (ci.yml:333, split out 2026-10-20 per #2121, measured
median 542.5s / p95 600s / max 606s before the split). Checkout + pnpm
install + board build + cache step cost about a minute before the install
step starts (measured: job `startedAt` to install-step `startedAt` was ~45s
in all three failed runs). The `Board integration tests` step after it is
measured at 4-8 minutes normally, up to 15 on its own bound. Two retry
attempts at ~5 minutes each is 10 minutes — added to the ~1 minute of setup
before it, that's 11 minutes before the test step even starts, leaving as
little as 4 minutes for a step the repo's own comment says runs 4-8 minutes
green. **A straightforward "raise the single bound and add a retry at the
same bound" will intermittently blow the 15-minute job ceiling on a slow but
otherwise-fine run.** Either keep both attempts well under 5 minutes each
(the comment already measures ~90s cold — a 2-3 minute bound per attempt
still covers a 2x-slow cold install with margin), or raise
`board-integration`'s own `timeout-minutes` alongside the step retry. The
plan's second open question ("does a retry stay inside the job's
timeout-minutes?") is this calculation — it does not, under the
5-minutes-per-attempt framing the plan's prose used as an example, so pick
a bound that does and say so in the PR description with the arithmetic above.

**Don't touch the 3-minute bound's *reasoning*, only its value.** The comment
above the step (ci.yml:391-396) documents a real, distinct failure mode: a
connection that never completes, measured past 10 minutes eleven times in
one day before the bound existed. A retry must not remove that protection —
each individual attempt still needs a tight-enough bound that a truly hung
connection fails fast and gets retried, rather than one long attempt that
silently absorbs the hang. Keep per-attempt bounds short; let the retry count
cover the legitimate slow-but-progressing case the three measured failures
show.

**The `restore-keys` prefix matters for the version-keyed cache.** The
existing cache already has `restore-keys: playwright-${{ runner.os }}-` as a
fallback. Re-keying on the resolved Playwright version
(`pnpm --filter @plot-pm/board exec playwright --version`) should keep that
prefix fallback — it's what lets a Playwright version bump still restore
*something* (the OS-level `apt` cache state, if the action's cache format
makes that meaningful) rather than starting from nothing, same rationale the
current comment gives for having a fallback at all.

### Done when

The plan's `## Done when` is informal in this plan (see Design/Open
Questions — there is no literal `## Done when` heading). Treat these as
the specification, derived from the Motivation and Design sections:

- The cache step's `key` hashes the resolved Playwright version, not
  `packages/board/package.json`.
- The install step runs `install-deps` only on a cache hit and the full
  `install --with-deps` on a miss.
- The install step retries once on timeout or failure, at a per-attempt
  bound that still fails fast on a genuinely hung connection (keep the
  existing comment's reasoning, adjust only the number).
- The total retried-install time plus the rest of the job fits inside
  `board-integration`'s `timeout-minutes: 15` with real margin for the
  `Board integration tests` step's normal 4-8 minute runtime — name the
  arithmetic in the PR body since this is exactly where a plausible-looking
  fix can still blow the job bound (see above).
- No new third-party action introduced for the retry.

Plus the repo's standing gates: no `State:` line hand-edited (none expected
here — this plan has no further transition this branch triggers), changeset
only if this touches a versioned package (it does not — `.github/workflows/`
is unversioned infra, so **no changeset**), and
`scripts/check-shell-lines.sh` is irrelevant here too since no `.sh` file
under `skills/` changes.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints. A CI workflow file matches no path pattern in this
repo's `Local checks` config (all patterns are under `test/`, `packages/`,
or `**` script gates), so expect the generic `**` gates to run and nothing
package-specific. The suites under `CI suites` run in CI on the PR itself —
do not run `pnpm run test:e2e` locally (it dispatches real workers into
sandbox repos and is CI's job, not a local one).

### Bookkeeping

Open the PR through the controller once the branch has a commit:

```bash
skills/plot/scripts/plot-open-pr.sh
```

It reads the plan, titles the PR from the `### Install step` wave heading,
and bodies it with the plan and this brief. Do not use `gh pr create`.

When the PR exists, append `→ #<number>` to this branch's line in the
plan's `## Slices` section (`docs/plans/2026-10-23-ci-board-integration-fails-when-the.md`,
the `infra/playwright-install-survives-a-slow-download` line). No project
board is configured in this repo's `## Plot Config`, so skip the "Ready"
status step.

Push the first real commit as soon as it exists — a branch with nothing but
a `PLOT-BLOCKED` marker is what `plot-open-pr.sh` specifically refuses.

### Scope guard

This branch owns `.github/workflows/ci.yml` only — specifically the
`Cache the Playwright browser` and `Install Playwright browser` steps inside
the `board-integration` job (and `board-integration`'s own `timeout-minutes`
if that needs to move per the arithmetic above). The plan's Changelog note
says board impact is none; this is infra-only.

This plan has one slice total (`### Install step`, the only branch), so
there is no sibling branch in flight for this plan to collide with. Check
`/plot-pulse` before starting in case an unrelated plan is touching the same
workflow file concurrently — `git log --oneline -- .github/workflows/ci.yml`
is the cheap local check if `/plot-pulse` isn't available.

If you find the cause doesn't match what's documented above once you look
at the file yourself (e.g. the workflow has changed since this brief was
written), report that rather than silently implementing against a stale
reading — the measurement above is from runs on 2026-10-22, and the file on
`main` is the current truth.
