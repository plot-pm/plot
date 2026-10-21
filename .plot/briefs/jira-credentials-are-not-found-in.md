## Implementation brief — jira-credentials-are-not-found-in

- **Plan (canonical):** `docs/plans/2026-10-21-jira-credentials-are-not-found-in.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2253 merged
- **Branch:** `bug/jira-credentials-are-not-found-in` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

Three readers resolve "the `.env` file for this checkout" the same wrong way:
`git rev-parse --show-toplevel`, which in a worktree returns the **worktree**,
not the main checkout. `.env` is untracked, so it exists only in the main
checkout — every fleet desk and every scratch worktree under `Worktree root`
has none of its own. Measured 2026-10-21 on ewz-kus-portal, plot main
`be96cdfe4`, read-only: `issue-list` run from a worktree refused with exit 3
naming `JIRA_EMAIL`/`JIRA_API_TOKEN`, and listed EWZKUS tickets once `.env` was
copied into the worktree by hand.

The three readers:

- `jira_load_env_file` (`skills/plot/scripts/plot-host.sh:2743`) — Jira.
- the Jenkins branch inline in `jenkins_rest_credential`
  (`skills/plot/scripts/plot-host.sh:1726-1728`) — builds the `.env` path
  inline rather than calling a shared helper.
  `JENKINS_USER`/`JENKINS_API_TOKEN`.
- `loadEnvFile` (`skills/plot/scripts/plot-bitbucket-commit-status.mjs:80`) —
  `BITBUCKET_REVIEW_USER`/`BITBUCKET_REVIEW_APP_PASSWORD`.

Add a fallback: when the worktree root holds no readable `.env`, read `.env`
from the main checkout — the parent of `git rev-parse --git-common-dir`.
Verified in this repo: from `.worktrees/free-1c18194f`,
`--git-common-dir` prints `/Users/.../plot/.git` (not a relative `.git`), so
`dirname` of it is the main checkout root directly — no extra resolution
needed. The worktree's own `.env` wins where it exists; only its absence
triggers the fallback read.

### The decisions the plan settles — do not re-derive them

**One resolver per language, not three fixes.** The shell side already has
two near-duplicate lookups (`jira_load_env_file`'s four-line block and
`jenkins_rest_credential`'s inline one-liner) — factor both into one shell
function, e.g. `plot_env_file()`, that returns the path to use (worktree
`.env` if readable, else main-checkout `.env`, else empty) and have both
callers use it. The `.mjs` side gets its own equivalent of the same resolver
(JS can't share the shell function); `loadEnvFile`'s `repoRoot()` helper is
where that resolution belongs. Do not write three independent fallbacks that
happen to agree today and drift tomorrow.

**Every existing rule on these readers stays, unchanged by this fix:**
environment variables win outright and the file is never opened when both are
already set; both values or neither (`[ -n "$email" ] && [ -n "$token" ]`,
same shape in JS); no upward walk past the main checkout — the fallback is
exactly one more location, not a search; the value is never printed, only the
source; and the exit-3/exit-4 refusal is unchanged when **neither** file (not
even the main checkout's) has both variables. This fix only adds a second
place to look, not a new precedence rule or a laxer validation.

**Name which file answered.** The existing stderr lines ("`JIRA_EMAIL and
JIRA_API_TOKEN read from .env`") need to distinguish a worktree `.env` from a
main-checkout one, so an operator debugging a stale-credential 401 can tell
which file was actually read — e.g. "read from .env" vs "read from the main
checkout's .env". Follow the existing wording style in each file rather than
inventing new vocabulary.

**The plan's open question on `--git-common-dir` is settled for the common
case, not for every case.** Verified here only for a standard `git worktree
add` checkout (this repo's own `.worktrees/*`). The plan explicitly asks: does
a bare clone, or a separate-git-dir checkout where `--git-common-dir` doesn't
end in `.git`, give the right parent? **Do not guess past what the fix can
verify** — if `--git-common-dir` fails, is empty, or its parent directory
doesn't exist/isn't a readable `.env` candidate, fall through to "no main
checkout `.env`" and keep the existing refusal. Never invent a path.

**Layering: shell on the adapter side of the host port.** No domain rule
changes. No new script is added (an inline helper inside `plot-host.sh` and
inside `plot-bitbucket-commit-status.mjs`), so `skills/plot/scripts/README.md`
gains no new row.

### Done when

The plan's `## Done when` is implicit in its Notes section — tests belong in
`test/reconcile/host.test.mjs` (Jira, Jenkins) and
`test/reconcile/host-commit-status.test.mjs` (Bitbucket review), each proving
three cases:

1. A worktree with no `.env` and a main checkout with one reads the **main**
   file.
2. A worktree `.env` wins over the main checkout's when both exist.
3. Neither file having both variables still gives the refusal (exit 3 for
   Jira, exit 4 for Bitbucket review — check the Jenkins path's existing exit
   code and keep it).

`host-commit-status.test.mjs:300`'s `bbSandbox` already shows the fixture
shape (`scratch()` root, `.env` written via `withEnv.dotenv`, PATH-stubbed
`bin/`) — extend it to create a second `git worktree add` off that same
scratch repo and run the script with cwd inside the worktree, `.env` only in
the scratch root. Mirror that shape for the Jira/Jenkins cases in
`host.test.mjs`. **Run the whole reconcile glob, not only these two files** —
the plan's Notes line says so explicitly, and other tests may share fixtures
these touch.

Plus: `scripts/check-shell-lines.sh` ratchets the shipped shell's line count
against its merge base — if the shared shell resolver grows the line count,
pay for it by removing an equal number of lines elsewhere in
`skills/plot/scripts/` in the same change (factoring two near-duplicate
lookups into one function should net-shrink rather than grow). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints; the suites in `CI suites` (`## Plot Config`) run in CI on
every PR — a failure there comes back as a correction, not a reason to skip
the local checks.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Push the first real commit as soon as it exists. When the PR is created,
append `→ #<number>` to this branch's line in the plan's `## Slices` section
(`docs/plans/2026-10-21-jira-credentials-are-not-found-in.md`).

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-host.sh` — `jira_load_env_file`,
  `jenkins_rest_credential`, and any new shared resolver function.
- `skills/plot/scripts/plot-bitbucket-commit-status.mjs` — `loadEnvFile`,
  `repoRoot`.
- `test/reconcile/host.test.mjs`, `test/reconcile/host-commit-status.test.mjs`
  — new fixture cases.

No other branch is in flight against this plan — it is a single-slice plan
with one branch in its one wave. If you find something the plan did not
anticipate (e.g. a fourth `.env` reader, or a checkout shape where
`--git-common-dir`'s parent is wrong), report it rather than improvising
outside scope.
