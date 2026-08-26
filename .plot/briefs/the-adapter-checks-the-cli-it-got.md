## Implementation brief — the-adapter-checks-the-cli-it-got (wave Checked)

- **Plan (canonical):** `docs/plans/2026-08-26-the-adapter-checks-the-cli-it-got.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `bug/the-adapter-checks-the-cli-it-got` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. **It blocks `the-pr-list-join-is-silently`** — truncation
detection is meaningless while the adapter may be reaching nothing at all.

### What to build

`plot-host.sh` establishes that the `bb` on PATH supports the flags it is about
to pass, and says so when it does not — instead of every Bitbucket PR list
reading as an empty one.

### TWO TOOLS SHARE THE NAME — this is the whole point

Not a broken install. Measured 2026-08-26:

```
/opt/homebrew/bin/bb          craftamap/bb, a Go binary, 0.6.0 — NO --json
/Users/jwloka/.local/bin/bb   a WRAPPER (shell) running Quatico's bb from the
                              plugin cache; keeps craftamap's as a documented fallback
```

Their version numbers are **unrelated number lines**. craftamap 0.6.0 is not
"older than" Quatico 1.0.0; they are different products.

`plot-host.sh:509` passes `--json`. Against craftamap that is
`Error: unknown flag: --json`, swallowed by `2>/dev/null`, and `jq` exits 0 on
empty input — so the op returns nothing and every Bitbucket PR list reads as
*this repo has no PRs*.

Worse: under a 429 craftamap 0.6.0 **panics with SIGSEGV**. A segfaulting CLI
behind `2>/dev/null` is indistinguishable from a quiet one.

### The capability is a MOVING TARGET — that is why a version floor will not do

On one machine, on one day, `bb` meant three capability sets:

| where | version | `--json` | `checks` |
|---|---|---|---|
| plugin **cache** (what PATH bb ran) | 1.0.0 | yes | **no** |
| plugin **marketplace** after update | 1.9.0 | `--json <fields>` | **yes** |
| craftamap fallback | 0.6.0 | **no** | no |

The cache was 133 commits behind its marketplace. Done-when 4b is exactly this:
**check the capability, never the version.**

### The decisions the plan settles — do not re-derive them

**Establish capability once per run, not per call** (Done-when 5). Five call
sites must not become five probes.

**Not chosen: pass `--json` and inspect the failure text.** `bb` writes errors to
**stdout**, so the parse would have to tell an error from data on one stream —
the trap `my-bitbucket-issues-are-in-the-inbox` documents. Asking the binary what
it is costs one call and answers definitively.

**Not chosen: a minimum version floor.** The capability is per-flag and the
"versions" name two products; a floor would refuse a `bb` that is old but
adequate.

**Stop discarding stderr.** `2>/dev/null` on a call whose failure mode is
*silence* converts every error into a wrong answer.

### Two facts that are settled and must not be "fixed"

**`mergeable` is permanently unavailable on Bitbucket.** Measured by
`agent-skills` against six open PRs: REST v2 exposes no such field,
`merge_commit` is null while open, `links.merge` rejects token auth. So
`mergeable:"unknown"` at `plot-host.sh:510` is **correct and stays**. Only
`checks:"unknown"` is stale.

**`checks` costs one API call PER PR on Bitbucket** (bb 1.9.0's own help says
so), while it is free on GitHub's GraphQL. Do not add it to a bulk path here.

### Done when

The plan's `## Done when` list is the specification — all six items plus 4b.
Three exist because a naive implementation passes without them:

- **Item 3** — the reason names WHICH `bb` answered. Two products share the
  name; a version number alone does not identify one.
- **Item 4** — a segfault is a failure, not `[]`.
- **Item 4b** — the check is per-capability, not per-version.

Plus: `pnpm run validate`, `pnpm run test:reconcile`. Node 24 (`nvm use`).
**`pnpm test` is NOT a test run here.** Add a changeset with a `bumps:` block
for `plot`.

**You cannot rely on a real `bb`.** Test with PATH-stubbed binaries — one that
rejects `--json`, one that accepts it, one that exits non-zero, one that
segfaults. That is the technique the existing host tests already use.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, PR
**inside** the heading:

```
### Checked (Branch: bug/the-adapter-checks-the-cli-it-got, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit.

### Scope guard

This branch owns the `bb` capability handling in
`skills/plot/scripts/plot-host.sh` and its tests.

**Do not touch `plot-reconcile-scan.sh`** — it calls `bb` directly and is
`a-degraded-scan-says-why`'s branch, live right now in that same failure class.

**Do not implement truncation detection** — that is
`the-pr-list-join-is-silently`, which waits on this.

**Do not change the issue ops' three-outcome contract** (#449) or the Jenkins
arm (#450); both landed today in this file.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
