# Brief: feature/the-scan-sees-a-repairable-conflict

Implement wave 1 of
`docs/plans/2026-08-18-the-repair-exists-but-nothing-calls-it.md`.

Read it first. **This wave is read-only** — it adds detection, not repair.

## The bug

`skills/plot/scripts/plot-resolve-artifact.sh` exists, works, and is documented
in CLAUDE.md as *"the ONE automatic write"*. **Nothing ever calls it.**

Measured 2026-08-18, merging five bug branches after a release: three PRs hit
the same conflict, in the same generated file, with the same resolution — take
either side, `pnpm build:board`, commit. All three were resolved by hand, one at
a time, while the script sat in the repo doing precisely that.

The conflict recurs by arithmetic, not accident: `board-server.mjs` is a build
artifact committed to the repo, so **any two branches touching
`packages/board/**` collide there**, whether or not their real changes overlap.

## What to build

`plot-fleet-scan.sh` reports, per branch:

- `conflict:artifact` — the conflict set is **exactly** the generated artifact
- `conflict:manual` — anything else, **naming the files**

Derived with `git merge-tree` against `origin/main`. **No worktree is touched,
nothing is written** (Manifesto Principle 1 — the pulse is derived).

## Do not

- **Do not repair anything.** The pulse-side repair is wave 2
  (`feature/the-pulse-repairs-the-artifact`) and is not yours.
- **Do not widen `conflict:artifact` beyond an exact match.** A conflict set of
  the artifact *plus one source file* is `conflict:manual`. The narrowness is
  the whole licence: the automation downstream is permitted only because the
  choice cannot matter, and that stops being true the moment a source file is
  in the set. Verified in a prototype: PR #57 was correctly identified as
  needing a human, naming `.gitignore`, `MANIFESTO.md` and two SKILL files.
- **Do not hardcode the path if the plan's open point says otherwise.** Plot is
  project-agnostic (Principle 5); the plan flags whether `board-server.mjs` is
  special-cased or configured via a `## Plot Config` key. Decide and say why.

## Definition of Done

- A branch conflicting **only** in the artifact reports `conflict:artifact`
- One conflicting in the artifact **and** a source file reports
  `conflict:manual`, naming both
- A cleanly mergeable branch reports neither
- The scan writes nothing in every case — assert it
- The detection costs no host call and no worktree checkout
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e`,
  `pnpm run test:board` pass — run the suites **one at a time**
- A changeset with a `bumps:` block

## Coordination

`bug/the-scan-joins-one-pr-list` is also in `plot-fleet-scan.sh`, changing
`host_pr_state()` and its call sites. Yours is new detection beside the
existing branch-state logic. Expect a rebase; keep your diff narrow.

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way: `stat -f`
does not fail cleanly on GNU, and `/usr/bin:/bin` is not an isolated PATH
because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
