## Implementation brief — the-ci-key-carries-its-instance (slice 1: Splitting the value)

- **Plan (canonical):** `docs/plans/2026-09-09-the-ci-key-carries-its-instance.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #852 merged
- **Branch:** `bug/the-ci-key-splits-into-scheme-and-instance` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention

Slice 2 (`bug/the-ci-callers-match-the-scheme`) moves the four call sites onto
the function this slice writes and deletes `ci_backend()`. **It waits on this
one.** Write the functions; do not touch the callers.

### What to build

`ci_scheme()` and `ci_instance()` in `skills/plot/scripts/plot-host.sh`, beside
the existing `ci_backend()` (`:548`), shaped after the tracker's pair
(`tracker_scheme()` / `tracker_base_url()`, `:1340`).

The concrete failure: `ci_backend()` returns the **whole** `CI:` value
lowercased, and every caller matches it against a bare word. Measured
2026-09-09 by running the arm:

```
PLOT_CI='Jenkins at `jenkins-ci-ewz…`'  ->  basis=unknown, limit=null
PLOT_CI=jenkins                          ->  basis=predicted, limit=60
```

Only the bare word works and **no real repo writes it**. `ewz` declares
`` CI: Jenkins at `jenkins-ci-ewz…` ``; another declares
`CI: Jenkins pipelines in .build/pipelines/…`.

`ci_backend()` stays in place in THIS slice — slice 2 deletes it. Adding the
two functions beside it keeps this slice green on its own.

### The decisions the plan settles — do not re-derive them

**`ci_instance()` extracts a HOST, not a remainder.** The naive split
(everything after token 1) was measured against all three real values and
fails on every one: `at jenkins-ci-ewz… (Bitbucket PRs…`,
`pipelines in .build/pipelines/ …`, `(e.g. continuous-build…)`. None is a host
`jen -I` can use. `Tracker:` gets away with the naive split because its value
is `jira https://acme.atlassian.net` — a scheme and a URL. **`CI:` is prose.**

So: the first backticked span, or the first token that looks like a hostname or
URL, and **empty when there is none**. An empty instance is honest —
`Jenkins (e.g. continuous-build…)` names no instance, and pretending otherwise
hands `jen -I` a sentence.

**Backticks are stripped; a scheme is NOT normalised on.** `ewz` writes a bare
host in backticks, the probe used a full `https://` URL, and `jen -I` accepts
either. Inventing a canonical form breaks whichever caller passes the other one.

**`Jenkins instance` WINS over `CI:` prose — the precedence is not the
tracker's.** `tracker_base_url()` lets `$PLOT_JIRA_BASE_URL` win because both
carry the same shape. Here the override carries **more** than the prose can
express: `jenkins_instance()` (`:665`) returns `<slug>/<job/path>`, and the
container path is a fact **no file in a repository states** (`stack.ts:98` calls
the host *"the SLUG half"*). `jenkins_build_map()` degrades a slug-only value to
root-scope listing, where its own comment says *"every branch reads `none`"*.
`quaweb` is nested — `job/quaweb/job/release` — so a `CI:`-derived slug alone
renders an empty board for the exact repo this sprint serves.

**Order: `Jenkins instance` key → `$JENKINS_INSTANCE` → `ci_instance()`.**
The prose is the fallback, never the primary.

**`Jenkins instance` is NOT a dead key.** A first draft of the plan said so and
it was false: `the-probe-reads-the-ci-system` merged its whole adoption path —
`plot-detect-repo.sh:137` reads the host, `stack.ts:176` holds
`CiInstanceProposal`, `plot-config.sh:102` documents it. No repo sets it because
the feature landed last week.

**`PLOT_CI` is a PRODUCTION contract.** `ci_backend()`'s comment calls it
*"overrides for tests"* and that is wrong: `build-actions.ts:39` passes
`buildReads({ context, system: SYSTEM }, { PLOT_CI: SYSTEM })` as the dispatch
contract the arm reads. `ci_scheme()` keeps the same precedence — env first,
then the `CI` key — and **splits `PLOT_CI` the same way**, so a connector's bare
`SYSTEM` word and a person's prose reach one comparison. Correct that docstring
while you are there.

**Rules carried over:** absent is not false — an empty instance means *this
value names none*, never *no Jenkins*. And read the exit code, not the
emptiness.

### Done when

The plan's slice-1 assertions are the specification:

- `ci_scheme()` returns `jenkins` for **all four** spellings — the bare word,
  `` Jenkins at `host` ``, `Jenkins pipelines in …`, `Jenkins (e.g. …)`.
- `ci_instance()` returns a host or nothing, **never a fragment of prose** —
  `` Jenkins at `jenkins-ci-ewz…` `` yields the host, `Jenkins (e.g. …)` yields
  empty, and neither yields `at jenkins-ci-ewz…`.
- The `Jenkins instance` key wins over `CI:` prose when both are set, and
  `$JENKINS_INSTANCE` wins over the prose too.
- `PLOT_CI` is split like the config value.

Each of these exists because a naive implementation passes without it: the
four-spelling assertion catches a `= "jenkins"` test that only ever saw this
repo's own value, and the "never a fragment" assertion catches the naive split
that reads plausible and returns a sentence.

**The regression surface already exists and is NOT to be edited.**
`test/reconcile/host.test.mjs` sets `PLOT_CI` in **11 places**;
`packages/domain/test/host-shell.test.ts` and `build-shell.test.ts` cover the
same ops. They pin the bare-word contract, so they prove this change preserves
behaviour for the spelling that already worked. **A slice that has to rewrite
them has changed the contract rather than the parsing — that is the signal to
stop and report, not a step to take.**

Plus the repo gates: `nvm use` (Node 24 — `pnpm` crashes on 26), then
`corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`.
Add a changeset (`'plot': patch`, description FIRST, `bumps:` block LAST).
**Do not run `pnpm run test:e2e`** — that is CI's gate.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section on `main`. Push the first real commit as soon as it
exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` — the `ci_backend()`
neighbourhood (`:543`–`:560`) only.

**Do not touch:** the four call sites (`:2417`, `:2692`, `:2794`, `:3336`),
`ci_backend()` itself, `packages/domain/src/entities/budget.ts`, or the test
files named above. All of those belong to slice 2.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
