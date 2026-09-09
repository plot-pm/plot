# Finding — wave 2 (Proving) could not run: wave 1 never started

Recorded 2026-09-09 by the worker on `feature/an-installed-gate-fires-once`.
Plan: `docs/plans/2026-09-09-an-adopting-repo-installs-its-gates.md`.

**No product code, changeset or test was written.** The blocking question is in
`PLOT-BLOCKED.md` at the root of this branch. This file holds the measurements
that are worth keeping whichever way that question is answered.

## 1. Wave 1's branch is a claim-only ref

`plot-install-hooks.sh` exists nowhere on the estate — only in two briefs and
the plan, as prose. `skills/plot/scripts/` holds `plot-install-commit-record.sh`
and `plot-install-prompt.sh`, and no hooks installer.

| reading | value |
|---|---|
| `origin/feature/an-adopting-repo-installs-its-gates` | `4501cbf5` |
| `origin/main` | `43cb0a5d` |
| commits on the branch not in main | 0 |
| files changed vs main | 0 |
| PR | `{"number":0,"state":"NONE"}` |
| tip subject | `plot: approve a-plan-row-shows-its-phase` (unrelated, already in main) |
| worktree | none |

The tip is an ancestor of `main`; with no PR that means it never diverged.

## 2. The route question the plan gates on is still unmeasured

The plan's `## Design` makes wave 1's first act a measurement:

> **`PreToolUse` from a repository's own `.claude/settings.json` is unverified,
> and this plan will not assume it.** [...] If the route does not work, the
> installer has nothing to install.

That measurement has not been taken by anyone. It is the plan's own gate on
whether the installer should exist at all, and it belongs to wave 1.

**A scratch repo cannot answer it.** Driving the gate script proves the *script*
refuses; whether *Claude Code* loads a repo-relative `PreToolUse` from
`.claude/settings.json` is a property of the running tool, not of the script.
This branch's brief draws the same line. Answering it needs a live Claude Code
session with a settings file registered — an operator's measurement.

## 3. The gate's refusal contract is sound, and verified

`node --test test/reconcile/state-gate.test.mjs` → **22 pass, 0 fail** on this
tree. Exit 2 with the owning command on stderr, as the brief documents. So the
thing wave 2 would verify does work when invoked directly; what is missing is
the install whose success it would prove.

## 4. A hazard for whoever builds `--verify`: the scratch repo needs a config section

Measured here by getting it wrong first. `plot-state-gate.sh` resolves its plan
directory through `plot-config.sh get "Plan directory"`, which reads the
`## Plot Config` section of the repo it runs in. A scratch repo without that
section does not recognise its own plan files as plans, so the gate sees no
transition and **exits 0 in silence** — byte-identical to a gate that is absent,
which is the exact ambiguity the plan's second slice exists to defeat.

A verification building a scratch repo must therefore seed:

- a `## Plot Config` section carrying `Plan directory`
- a plan file with the `## Status` / `- **State:** <word>` shape the parser reads
- a committed HEAD version **and** a staged change of the `State:` value

`test/reconcile/state-gate.test.mjs`'s `repo()` helper already gets all three
right and is the shape to copy. Anything short of it returns 0 and proves
nothing — which would ship the bug the slice exists to fix.
