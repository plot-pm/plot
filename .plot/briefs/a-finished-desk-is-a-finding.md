## Implementation brief — reconcile-is-a-controller-action (wave 3: Sweeping)

- **Plan (canonical):** `docs/plans/2026-09-09-reconcile-is-a-controller-action.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #860 merged
- **Branch:** `feature/a-finished-desk-is-a-finding` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention; Definition of Done is `docs/definition-of-done.md`

**It waits on `feature/reconcile-is-a-controller-action` (→ #877), and that wait is satisfied — but only in the domain.** That slice defined `DriftFinding`, `DriftKind` (including `'worktree'`), `deskFindings()` and the `plot-reconcile.mjs` bundle. **Rebase onto `main` first and check #877 has merged** before starting; the types this slice extends are its types.

### What to build

**The shell must supply `isDispatchTree`, and an unrecognisable desk must become visible.**

The concrete failure, re-measured on this estate 2026-09-10: **12 worktrees, and the reaper accounts for 5.** `plot-reap.sh --dry-run` reports `reapable=4 kept=1`. The other seven are skipped by `plot-reap.sh:384`:

```sh
if [ ! -f "$wt/.plot-worker.pid" ]; then
  case "$wt" in *"/plot-wt-"*) ;; *) continue ;; esac
fi
```

A tree matching neither test hits `continue` — **not reaped, not kept, not counted, not named.** The failure is safe and silent, and silence is what a reconciliation pass exists to remove.

**One of those seven is the case this slice exists for, and it is live right now:**

`.worktrees/feature-one-monitor-watches-the-slice` — under the configured `Worktree root`, named exactly as `plot-dispatch.sh` names a branch desk, holding **5 commits ahead of `origin/main`**, a clean tree, a `PLOT-BLOCKED.md` marker, and **no PR** (`plot-pr-state.sh` answers `{"found": false}`). It carries no `.plot-worker.pid` and does not match `plot-wt-`, so nothing reports it. That is a blocked agent's finished work, invisible to the tool whose job is to find it.

The other six are genuinely **not** desks: four `/tmp/` baseline and scratchpad checkouts, plus this repo's own main worktree. **They must stay silent.**

Read the plan for the full argument. This is orientation.

### The decisions the plan and #877 settle — do not re-derive them

**`DriftKind` already has `'worktree'`, and `deskFindings()` already emits both desk findings.** Read `packages/domain/src/workflows/reconcile.ts` before writing anything: the reapable finding (`repair: git worktree remove <path>`) and the needs-a-person finding (`repair: ''`) both exist, gated by `NEEDS_A_PERSON` = `{uncommitted-changes, blocked-marker, on-default-branch}`. **Adding a second worktree finding kind, or a second desk loop, is the duplication this slice must not create.**

**The entry already parses the field.** `packages/board/src/server/entry/reconcile.ts:231` reads `isDispatchTree: evidence.isDispatchTree === true`, and its docstring states the direction: *absent reads as false, because a tree this cannot place is outside the reaper's population.* No schema change is needed on the way in.

**So the gap is exactly two things**, and grep proves the first: `isDispatchTree` appears in **`reap.ts` and the entry only** — no shell script computes it. (1) The shell measures it and passes it in. (2) An unclassifiable tree becomes a finding, which needs a **new** `DriftKind` — `'worktree'` means *a desk `reap()` judged*, and an unclassified tree is by definition one `reap()` never saw.

**`isDispatchTree: false` means silence, not a finding — and the two populations are one measurement apart.** `reap.ts:136` is `if (!evidence.isDispatchTree) continue;`, and its comment states why: *"a hand-made worktree is outside this workflow's population rather than a tree that failed a test."* A person's tree must never produce a finding telling them to remove it. The distinction to hold:

- **not a desk** → silence (the four `/tmp/` trees)
- **might be a desk and I cannot tell** → a finding, reported as unclassified
- **a desk** → `reap()` judges it, unchanged

**`test -d "$wt/.plot"` does not work, and it is worth knowing before you try it.** `.plot/` is tracked in the repo, so **every** worktree has one — measured: both `/tmp/` baselines carry it. It classifies all four non-desks as desks. No manifest names the unrecognised tree either, so `.plot/agents/` cannot separate them. The signals that do discriminate are the path against `Worktree root` plus dispatch's own naming (`$wt_root/${wt_prefix}free-<id>` for a free desk, `<branch-with-dashes>` for a branch desk — `plot-dispatch.sh:198`, `:1582`) and the claim ref.

**The recognition test stays exactly as strict. Only the silence goes.** The plan is explicit: widening recognition trades a safe refusal for a wider blast radius, while reporting the refusal costs nothing. So an unrecognised tree is reported as unclassified — **never promoted to reapable**, and never handed a `git worktree remove`.

**No `case` statement decides it.** The shell measures and the rule judges. That split is why the current bug is untestable: the live decision sits in shell where no test reaches it, shadowing a typed field declared for the same question. Fixing the `case` in place is the move this slice refuses — it is the whole reason the plan exists rather than a one-line patch.

**Reconcile performs nothing, at any scope, with no `--yes`.** Findings name commands and run none.

**Carried over unchanged:** *did this land* is `mergedAt` via `plot-pr-merged.sh` — never a PR's `state` (a merged PR reports `CLOSED`), never ancestry (squash-merge leaves a branch ahead of `main` forever). An unreachable host answers *not merged*, so silence is never permission. An absent reading is `false`, not unknown.

### Done when

The plan's `## Slices` → **Sweeping** assertions are the specification. Lifted here because a naive implementation passes without them:

- **An unrecognised tree is REPORTED, never silently skipped.** The regression this slice fixes. A test whose fixture holds a tree with no pid file and a non-`plot-wt-` path must see a finding — catches a change that measures `isDispatchTree` but leaves `continue` in place, which looks correct and reports nothing.
- **A hand-made worktree is still skipped entirely.** Fixture: a tree outside `Worktree root`. Zero findings. Catches an over-broad `isDispatchTree` that turns a person's checkout into a removal instruction — the failure mode that is worse than today's silence.
- **Unclassified is not reapable.** The finding carries no `git worktree remove`. Catches the shortcut of reporting by widening recognition.
- **The reaper's verdicts are unchanged.** Measured before this change: `reapable=4 kept=1` on 12 worktrees, and 6 of 12 recognised. The same numbers after. Catches an `isDispatchTree` that silently re-populates the reaper.
- **A dirty desk whose agent died reports NEEDS A PERSON, never free**, with `repair: ''`. Already held by `NEEDS_A_PERSON`; assert it survives.
- **A desk with a live worker is not reported at all.** A finding nobody can act on is noise.
- **The conditions come from `reap()`** — no second copy of any condition.
- **The finding names the desk path**, because the repair is per-directory.

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm test
pnpm run test:contracts      # NOT test:reconcile — renamed by sibling slice #874
pnpm run test:board          # rebuilds the board artifact + runs its tests
pnpm run typecheck
```

**Do not run `pnpm run test:e2e`** — it is CI's gate, not a local one.

**`pnpm build:board` is a root script** and the bundle is a committed artifact: `skills/plot/scripts/board/plot-reconcile.mjs` must be rebuilt and committed with any domain change, or a merged fix stays invisible. On a conflict in a board artifact, take **either** side, rebuild, commit — never read the diff (`-merge` in `.gitattributes`).

**A changeset is required.** Description FIRST, `bumps:` block LAST, and name the plan:

```markdown
---
'plot': patch
---

The description, which is what the changelog publishes.

<!--
plan: docs/plans/2026-09-09-reconcile-is-a-controller-action.md
bumps:
  skills:
    plot-reconcile: patch
-->
```

**Arrow functions** in `packages/domain/**`, and in any function you write or rewrite anywhere. **Factual TSDoc** — what it does, its parameters, its return, how it fails. The reasoning goes in the plan and the commit message, not the comment block.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

Then append `→ #<number>` to this branch's line in the plan's `## Branches` section, under `### Sweeping`.

**Push the first real commit as soon as it exists.** A stalled worker with unpushed work is indistinguishable from success — and it is the exact failure this slice reports on.

### Scope guard

**This branch owns:**

- `packages/domain/src/workflows/reconcile.ts` — the new unclassified `DriftKind` and its finding
- `packages/board/src/server/entry/reconcile.ts` — parsing the unclassified readings, if the shape grows
- `skills/plot/scripts/plot-reap.sh` — measuring `isDispatchTree` instead of deciding in the `case`
- `skills/plot/scripts/plot-reconcile-scan.sh` — taking the desk readings
- `packages/domain/test/workflows-reconcile.test.ts`, `test/reconcile/` — the tests
- `skills/plot-reconcile/SKILL.md`, `CLAUDE.md` — the helper-table line, if behaviour changes

**Other branches in flight, verified 2026-09-10:** six recognised desks hold `infra/the-test-suite-says-what-it-tests` (the sibling slice #874, which renamed `test:reconcile` → `test:contracts`), `bug/the-board-says-the-fleet-is-stopped`, `feature/an-adopting-repo-installs-its-gates`, `feature/an-installed-gate-fires-once`, `feature/the-working-header-separates-doing-from-reading`, and one detached. The overlap risk is `plot-reconcile-scan.sh` and `CLAUDE.md`, which many branches touch — rebase before opening the PR.

**`.worktrees/feature-one-monitor-watches-the-slice` is a live measurement subject, not yours to clean up.** It holds 5 unpushed commits and a `PLOT-BLOCKED.md`. Leave it exactly as it is: it is the fixture that proves the bug, and removing it destroys work no PR carries.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
