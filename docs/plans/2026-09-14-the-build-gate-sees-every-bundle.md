# The build gate sees every bundle

> The artifact freshness gate diffs one of 24 bundles, and a slice PR links the plan by the worker's absolute desk path.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** an-agent-is-declared-and-corrected
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-14, jwloka, in-session
- **Started:** 2026-09-14, Jan Wloka, `bug/the-build-gate-sees-every-bundle`

## Changelog

- The board artifact freshness check now fails on any stale bundle rather than only `board-server.mjs`, and names the files it found.
- A slice PR links the plan by its repository path rather than the worker desk's absolute path, so the link resolves on the git host.

<!-- Board impact: none. Neither change touches board source, the plan format,
     the template or the docs/plans layout. CI changes: the freshness step's
     diff path widens. -->

## Design

Two defects found on 2026-09-14 while delivering
[`a-merge-commit-carried-work`](2026-09-14-a-merge-commit-carried-work.md). Both
are cases of a component reporting less than it measured, and both live on the
fleet's own path, which is why review never caught them.

### The freshness gate checks one file and the build writes 24

`ci.yml:857` runs `pnpm run build:board`, then diffs exactly one path:

```
git diff --quiet -- skills/plot/scripts/board/board-server.mjs
```

**`skills/plot/scripts/board/` holds 24 bundles**, and a domain change restales
every one that includes it. Measured on PR #908: editing
`adapters/refs/refs-git.ts` restaled **three** — `board-server.mjs`,
`plot-ask.mjs` and `plot-registryd.mjs` — and CI named only the first, so the
first repair attempt would have failed again on the next run.

**IT IS A GATE DEFECT, NOT A MESSAGE DEFECT.** Proved by mutation 2026-09-14:
append a line to `plot-ask.mjs` and the current check **passes**, while a check
over the directory catches it and names the file. A stale bundle that is not
`board-server.mjs` can reach main today, and `skills/plot/scripts/board/` is
what every skill and shell script executes.

**The fix is the directory, and it costs no false positives**: measured on a
clean main, `pnpm run build:board` rewrites **nothing**, and with one bundle
dirtied it writes only inside `skills/plot/scripts/board/`. So the build's own
output set and the gate's diff path become the same set.

**The error must name what it found rather than a constant.** The current string
hardcodes `board-server.mjs` — that is the half that made the three-bundle case
cost two runs — so it prints `git diff --name-only` over the directory instead.

### A slice PR links the plan by the worker's desk path

PR #908's body opened as:

```
Slice of [a-merge-commit-carried-work](/Users/jwloka/…/.worktrees/free-9e72e356/docs/plans/…md)
```

A dead link for every reader on the git host. The `Brief:` line beside it was
correctly repo-relative, and that disagreement inside one body is the tell.

**The rule is not at fault.** `rules/slice-pr.ts:161` renders `readings.planFile`
verbatim, which is right: a rule that rewrote a caller's path would be inventing
a repository root it cannot see. The absolute path arrives from the caller.

**`plot-open-pr.sh:88` is the origin**, and it is deliberate:

```bash
case "$plan_dir" in /*) ;; *) plan_dir="$repo_root/$plan_dir" ;; esac
```

That line exists so the glob on `:99` works from any directory, and it must
stay. What travels onward is `meta.file`, which is then absolute — harmless in
a checkout at the repo root, and the desk's own path inside a worktree. So this
reproduces **only for fleet-opened PRs**, which is why it went unseen.

**So the path is relativised where it is USED, not where it is globbed.**
`plan_file` has exactly two consumers — `basename` on `:121`, which is
indifferent, and `PLOT_FILE` on `:191`, which is the PR body. Stripping the
`$repo_root/` prefix for the second leaves the glob untouched. Verified: the
strip yields `docs/plans/2026-09-14-….md`, and `basename … | sed` still yields
the same slug.

**A plan outside the repository keeps its absolute path.** The strip is a
prefix removal, so a path that does not start with `$repo_root/` is unchanged —
a link that cannot be made repo-relative is better absolute than wrong.

## Slices

### The build gate sees every bundle (Branch: bug/the-build-gate-sees-every-bundle, PR: #909)

- `bug/the-build-gate-sees-every-bundle` — widen the freshness diff in `.github/workflows/ci.yml` to `skills/plot/scripts/board/` and print the stale filenames it found, and relativise `plan_file` against `$repo_root` where `plot-open-pr.sh` passes it as `PLOT_FILE`

**Done when** appending a line to `plot-ask.mjs` makes the freshness step fail
and the error names `plot-ask.mjs`; a clean checkout still passes it; the glob
on `plot-open-pr.sh:99` still resolves and `plan_slug` is unchanged; a PR body
built from a worktree desk carries `docs/plans/…` rather than an absolute path;
and `pnpm run test:contracts` passes.

## Notes

**Both were found by the fleet delivering a plan, not by review.** The gate
defect needed a domain change that several bundles include; the link defect
needs a PR opened from a worktree. Neither shape occurs when a person works in
the repository root, which is the population review sees.

**Neither blocked the delivery**, and that is why they are worth fixing now
rather than urgently: a stale non-named bundle reaches main silently, and a dead
link sits in a durable artifact nobody re-reads.
