## Implementation brief — the-board-answers-where-the-browser-asks (slice: One plan is one card)

- **Plan (canonical):** `docs/plans/2026-09-11-the-board-answers-where-the-browser-asks.md` on `main`
- **Approved:** 2026-09-11, jwloka, in-session
- **Branch:** `bug/one-plan-is-one-card` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review

The plan's other slice, *The board answers on both families*, **merged as #894** and is on `main` already. The two are independent by the plan's own statement: that one changed the bind address in `index.ts`, this one changes plan discovery in `board.ts`. Nothing waits on this slice and it waits on nothing.

### What to build

A plan that is **in the working tree, pushed to its own idea branch, and absent from `main`** renders as **two cards** on the board. Both readings enter the staging loop and both reach `readPlanMeta`, so one plan becomes two.

Pass the already-computed `localOnlyPaths` set into the staging site and skip a path the working-tree reader has already supplied.

The three facts, verified on `main` at 2026-09-12 — note the real path is `packages/board/src/server/board.ts`, which the plan shortens to `board.ts`:

- `board.ts:1750` builds `localOnlyPaths` from `planSources.filter((src) => src.local)`.
- `board.ts:1805` stages `collectBranchPlans(...)` — **and never consults that set.**
- `board.ts:2012` is `localOnlyPaths`'s only reader, and it only sets `card.notPushed`.

The one exclusion that does exist lives in `readBranchPlans` at `:794` (`if (onDefault.has(relPath) || seen.has(relPath)) continue;`) and compares against `origin/<default>` plus other branch plans. Neither population contains a local-only path, which is precisely why it does not fire here. The rule is right; it is applied against two of the three sources.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Both sources stay legitimate. Do not remove either reading.** A plan may exist only in the working tree, and a plan may exist only on a branch. Deleting either arm hides a real plan. What is missing is that the second reader does not know what the first supplied — so this is a **join**, not a precedence rule.

**Fix at the staging site, not inside the walk — and the reason is the cache.** `collectBranchPlans` memoises into `branchPlanCache` keyed on `repoRoot` plus the branch tip SHAs (`board.ts:827-853`). The working tree can change without any SHA moving. So filtering inside `collectBranchPlans` or `readBranchPlans` would write a working-tree-dependent answer into a cache whose key tracks refs only, and it would then be served stale in exactly the direction that reintroduces the duplicate. The staging loop at `:1805` runs per build and holds `localOnlyPaths` in scope; the collector does not. That is the whole argument for the location.

**`readPlanMarkdown` at `:2277` is the second `collectBranchPlans` caller and is OUT OF SCOPE.** It resolves one filename and `return`s the first match, so it cannot emit a duplicate card. Do not "fix" it for symmetry — measured, it has no defect to fix.

**Sprints do not have this bug — the plan's open question is answered, do not re-measure it.** The plan asked for one check before implementing; it was taken on 2026-09-12. `prefixedBranches` has exactly **one** caller in the file, `collectBranchPlans:834`. `collectSprints` (`:1277`) and the story merge (`:1591`) each read **two** sources — a ref and the working tree — and already de-duplicate one-directionally with the ref winning. The duplicate needs the **third** source, prefixed branches, which only the plan path reads. So there is nothing to fix for sprints and no companion change belongs in this PR.

**The wildcard/bind question belongs to the merged slice.** `HOST`, `index.ts` and the same-origin write gate are #894's territory and are already on `main`. This branch touches neither.

**Rules carried over unchanged from the surrounding code:**

- **A card's `path` must stay the repo-relative path, never a staging temp path.** `canonicalPath` exists for this and `discovery.test.mjs:~195` asserts `!card.path.includes(os.tmpdir())`. Whatever you skip, do not disturb that mapping.
- **The staging block's `catch` is deliberately silent and must stay additive.** A repo with no git, no origin, or no readable refs contributes no branch plans and must behave exactly as before (`:1826-1830`).
- **Numbering comes off the shared `canonicalPath.size` counter** so ref plans and branch plans cannot collide on a basename. If you skip a plan, do not leave the counter in a state where two staged files share a directory.

### Done when

The plan's `## Done when` list is the specification. The plan states its assertions in the slice body rather than a separate list, so they are lifted here.

- **A plan in the working tree, pushed to its idea branch, and absent from `main` renders exactly ONE card.** This is the assertion that exists because nothing else catches it — see the fixture note below.
- The three existing discovery behaviours still hold: a Draft plan on an idea branch still appears (the Discovery column must not go empty), a plan only on a branch still appears, and a card's `path` is still the repo-relative path.

**The fixture must keep the copy the suite deletes — this is the crux.** `discovery.test.mjs:117-118` and `:127` each check out `main` and then `fs.rmSync` the working-tree copy, with the comment *"Remove the working-tree copies the branch checkout left behind, so the filesystem walk genuinely cannot see this plan. Without this the test would pass through the OLD code path and prove nothing."* Every fixture does this, so **no existing test can ever see this bug**. The nearby `produces no duplicate cards` test at `:198` is a near-miss worth understanding: its assertion (`deepEqual` on a sorted 3-slug list) *would* catch a duplicate, but its input is blind because the copy is always removed. So the new case is not a new assertion style — it is the same assertion fed the one input nobody supplied. Check out the idea branch, push it, **leave the file in place**, return to `main`, and assert one card.

**On `rmTree` vs `fs.rmSync` — the plan's instruction, sharpened by reading the gate.** CI's ratchet (`ci.yml:545`) greps `fs\.rmSync\s*\([^)]*recursive` under `packages/board/test` with `allowed=1`, and `allowed=1` is `rmTree`'s own implementation. `ci.yml:537` states a **non-recursive** `fs.rmSync` is deliberately **not** in the population — 13 such single-file calls already stand in these tests. So: removing one file with `fs.rmSync(p, { force: true })` is fine and matches the neighbours; removing a **directory tree** uses `rmTree` from `test/helpers.mjs`, already imported at `discovery.test.mjs:19`. Do not add a recursive `fs.rmSync` — it is a ratchet, and one new site fails the build.

Plus the repo's gates:

```bash
nvm use                    # Node 24 — pnpm crashes on 26
pnpm run test:board        # rebuilds the board artifact + runs its tests
pnpm run typecheck
pnpm test                  # skills parse
```

- **`pnpm run build:board` and commit the rebuilt artifact.** The plan's own board-impact note says so: `<!-- Board impact: both slices are the board. Rebuild the artifact. -->`. A merged fix that leaves the artifact stale is invisible to a running board and reads exactly like the fix not working.
- **Do NOT run `pnpm run test:e2e` locally.** It is CI's gate; it dispatches real workers and has taken this machine down.
- **Add a changeset** — `'@plot-pm/board': patch`, description first. A `packages/board` change uses package frontmatter and **no** `bumps:` skills block. `.changeset/` may already hold siblings' files; add yours and touch none of theirs.

### Bookkeeping

- **Push the first real commit as soon as it exists.** Unpushed work is invisible to the fleet: no claim exists, and the branch reads as eligible to a dispatcher.
- **Open the PR through the controller, from the branch:**

  ```bash
  skills/plot/scripts/plot-open-pr.sh            # or --draft while work moves
  ```

  It reads which plan names the branch and titles the PR from the plan's own slice heading. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which here is routinely `plot: build the board artifact`.
- **When the PR exists, annotate the plan's slice heading.** This plan uses the **inline** form, not a trailing arrow — match the merged sibling exactly:

  ```
  ### One plan is one card (Branch: bug/one-plan-is-one-card, PR: #NNN)
  ```

  A trailing `→ #N` on this plan parses as `prs=[]`. Make that edit on `main` (a detached scratch worktree on `origin/main` is the safe route — do not touch the shared main worktree), never as a commit on this branch.

### Scope guard

**This branch owns:**

- `packages/board/src/server/board.ts` — the staging site at `~:1805` and whatever argument threading the join needs
- `packages/board/test/discovery.test.mjs` — the new fixture and its assertion
- `skills/plot/scripts/board/board-server.mjs` — generated; rebuilt, never hand-edited
- one new file under `.changeset/`

**Out of scope, named above:** `readPlanMarkdown` (`:2277`), `collectSprints` (`:1277`), the story merge (`:1591`), and anything touching `HOST` or `index.ts`.

**Other branches in flight, verified 2026-09-12:** only `changeset-release/main` (Changesets' own release PR) and `plot/deliver-one-cap-holds-across-boards` (a bookkeeping delivery). **Neither touches `board.ts` or `discovery.test.mjs`** — no collision is predicted. The sibling slice `bug/the-board-answers-on-both-loopback-families` merged as #894 and its ref is gone; this branch cuts from a `main` that already carries it.

**On a conflict in `board-server.mjs`:** do not read the diff. It is generated output marked `-merge` in `.gitattributes`. Take either side, run `pnpm run build:board`, commit the result. Never phrase it as "take ours" — *ours* inverts between merge and rebase.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
