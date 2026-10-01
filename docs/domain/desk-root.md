# Desk root
The directory under which Plot creates dispatch worktrees and writes its action records.
- Layer: Domain
- Concept status: implemented

## Terms

- **Desk** — a dispatch worktree: the checkout one agent works in, created by `/plot-dispatch` and removed by `plot-reap.sh` once its work has landed.
- **Action record** — the files a board action writes for one run: `plot-<kind>-<id>.log`, `.state` and `.prompt.md`.

## The rule

`deskRoot` takes the configured `Worktree root` value and the repository's main checkout, and answers one path:

| Configured | Answer |
|---|---|
| absent or empty | `<repo>/.worktrees` |
| absolute | that path |
| relative | resolved against `<repo>` |

The answer carries no trailing slash, so a composed desk path never doubles the separator. An empty value is the absent row and never a relative path `""`: a repository that declares the key with no value has configured nothing.

The rule is string work. It reaches no filesystem and the directory it names need not exist — a first dispatch is entitled to create it. It composes with string operations rather than `node:path`, because outside `adapters/` the domain may import `zod` and nothing else.

## The repository root is the main checkout

Every caller resolves the repository as `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`, with `--show-toplevel` as the fallback only where git cannot answer. Inside a desk, `--show-toplevel` answers that desk, so a default of `.worktrees` would resolve `<desk>/.worktrees` and place every tree under a root nothing else reads. `plot-reap.sh` recorded that failure on 2026-09-10, when every tree read as unplaceable.

## The default

The default is `.worktrees` inside the repository. `/plot-init` writes `Worktree root: .worktrees` for every new adopter (`composeAdoption`), and `plot-board-probe.sh` and `plot-quiet-stretch.sh` both assumed it already.

A default of the checkout's parent writes `plot-wt-*` worktrees and `plot-<kind>-*` records into a directory the repository does not own — on a developer machine, the folder holding all their checkouts. Measured 2026-10-01: nine sites computed this rule and two of them already disagreed.

## The ignore line

A desk root inside the repository must not appear as untracked files. `deskRootPlacement` answers whether the root lies inside the repository and names its repository-relative exclude line. The caller that creates the directory appends that line to the common git directory's `info/exclude` when the path is not already ignored. The shell helper asks `git check-ignore`; the board reads `.gitignore` and `info/exclude` directly, because a read route reaches it and a read route spawns nothing. Git reads `info/exclude` from the common directory only, so a linked worktree's private gitdir is the wrong place. The write is idempotent.

## Existing desks

Desks created under the old default stay where they are. Every reader that asks *which worktree holds this branch* asks `git worktree list`, so a desk in the parent keeps working until it is reaped; `plot-reap.sh` keeps its legacy `plot-wt-` path recognition for exactly that population.
