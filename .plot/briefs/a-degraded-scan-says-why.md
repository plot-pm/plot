## Implementation brief — a-degraded-scan-says-why (wave Diagnosis)

- **Plan (canonical):** `docs/plans/2026-08-26-a-degraded-scan-says-why.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `bug/a-degraded-scan-says-why` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. One branch deliberately: the three parts are one function
and its one reporter, and splitting them would ship a scan that knows the
difference and still prints the rows.

### What to build

`/plot-reconcile` tells a failed git-host call apart from an absent CLI, and
suppresses the stale-branch section when PR state could not be established.

The measured incident: a sweep named **nine open-PR branches as orphans**, each
with a command inviting deletion, while reporting *"no git-host CLI available"*
with `bb` installed, authenticated and correct.

### It is TWO bugs, not one — both arms need the fix

Verified at `plot-reconcile-scan.sh:203`:

```sh
# bitbucket arm — TWO 2>/dev/null and a PIPE
if out=$(bb pr list --state open --json 2>/dev/null \
           | jq -r '...' 2>/dev/null) && [ -n "$out" ]; then
```

Under a pipeline `$?` is **jq's**, not `bb`'s. A 429 makes `bb` fail, `jq` reads
empty input and exits **0**, so `[ -n "$out" ]` is the only thing that notices —
and it fires identically for a repo that genuinely has no open PRs.

```sh
# github arm — NO [ -n "$out" ] guard at all
if out=$(gh pr list -R "$slug" --state open --json ... 2>/dev/null); then
```

`gh` exits 1 on failure, so today the `if` catches it. **The gh arm is correct by
luck of exit codes, not by design** — anything making that call exit 0 empty
would set `PR_SOURCE="gh"`, claim the host answered, and print *every* branch as
an orphan. Strictly worse, and silent.

So: **one mechanism in both arms.** Capture stderr, test the CLI's own exit
status rather than the pipeline's (`PIPESTATUS`/`pipefail`, or split the call
from the parse), and let emptiness be a value. Done-when 4 is the assertion that
catches a bitbucket-only fix.

### The decisions the plan settles — do not re-derive them

**Named states, with the CLI's own words beside them.** `pr_source` stays
`absent | failed | gh | bb` because the footer is machine-countable by design and
other tooling greps it; the first stderr line travels as human-readable detail
*beside* the state, not instead of it. Verbatim passthrough was rejected: it
forces every consumer to parse CLI-specific prose, and the two CLIs word the
same failure differently.

**No retry.** A 429 is transient and one retry would rescue the common case —
rejected because a silent retry **hides the rate limit from the person being
throttled**. In the measured incident the operator's own `bb` calls were failing
too; reporting the 429 tells them why, retrying past it does not.

**An empty result is a VALUE, not a failure.** The guard `[ -n "$out" ]` treats
"no open PRs" as "the call did not work" — the same category error one level
down, and Done-when 3 pins it.

**Print no rows when PR state is unknown.** Not a caveat in the header and
confident claims in every row — that shape is what the board work has been
removing. `--no-pr` keeps today's behaviour: a reader who passed that flag asked
for the merge-state view.

### A likely co-cause you should know about

[[the-adapter-checks-the-cli-it-got]] is live right now, and it may be the real
cause of the measured incident: **craftamap's `bb` 0.6.0 has no `--json` at all**
and may be first on PATH, which fails *regardless* of any rate limit and
produces the identical "empty output, exit 0".

**This branch does not need to resolve that** — the fix is the same either way
(read the CLI's own failure instead of inferring from emptiness). But do not
close the plan claiming the 429 was proven to be the cause.

That branch owns `plot-host.sh`; **this one owns `plot-reconcile-scan.sh`**,
which calls `gh`/`bb` directly and is not reached by the adapter's fix.

### Done when

The plan's `## Done when` list is the specification — all nine items. Three
exist because a naive implementation passes without them:

- **Item 3** — a successful call returning zero open PRs reports `gh`/`bb`,
  never degraded.
- **Item 4** — BOTH arms are asserted, not just the measured one.
- **Item 7** — `stale=` reports 0 when the section was not evaluated.

Plus: `pnpm run validate`, `pnpm run test:reconcile`. Node 24 (`nvm use`).
**`pnpm test` is NOT a test run here.** Add a changeset with a `bumps:` block
for `plot`.

Test with PATH-stubbed CLIs: one that exits non-zero with a 429 on stderr, one
that succeeds with an empty list, one that is absent entirely.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, PR
**inside** the heading:

```
### Diagnosis (Branch: bug/a-degraded-scan-says-why, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `load_open_pr_branches` and the section-3 reporter in
`skills/plot/scripts/plot-reconcile-scan.sh`, plus its tests.

**Do not touch `plot-host.sh`** — `bug/the-adapter-checks-the-cli-it-got` is live
in it.

**Do not change what section 3 detects**, only whether it prints on unverified
input. The orphan derivation itself is not the defect.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
