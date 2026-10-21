## Implementation brief — fleet-work-leaves-the-main-checkout (wave 2: Fix)

- **Plan (canonical):** docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2312 merged
- **Branch:** `bug/main-checkout-stays-clean` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan PR review)

Waits on `bug/main-checkout-writers-measured` (PR #2315, merged into `main` as `c5169e961`). Nothing else is queued behind this branch.

### What to build

The observed failure (issue #2311, 2026-10-21 23:44 CEST): the operator's main checkout held 22 dirty tracked files and 10 untracked scratch files nobody wrote by hand, plus a `HEAD` that had moved without its working tree catching up — the board then showed delivered plans as "in progress" because it reads that checkout.

**Wave 1 already answered "which script did it" — and the answer is none of them.** Every named candidate (`plot_repo_root`'s resolution, `plot-push-main.sh`, `ladder.ts`'s `resetBranch`, `plot-dispatch.sh`'s Started-record booking, `plot-open-pr.sh`) was reproduced in a sandbox and cleared; each writes only inside its own disposable worktree. The actual cause was an **interactive session** (the PR #2302/#2310 work) hand-editing the main checkout directly — manual `sed`/`cp` scratch files beside the real one, and manual `git commit`/`git reset` bookkeeping run against the checkout instead of a disposable worktree. See `test/reconcile/main-checkout-writers.test.mjs` for the full evidence trail; do not re-derive it.

This wave is therefore **not a bug fix at a specific call site** — there is no faulty line to patch. It is a **guard against a human (or an agent acting like one) writing to the main checkout by hand**, plus the gate that proves the guard holds. The plan's own two open questions are exactly this wave's design scope:

1. Should a command that finds the main checkout dirty refuse, or route the work into a disposable worktree (the pattern `plot-dispatch.sh` already uses for its own bookkeeping branch)?
2. Should the board warn when its checkout is dirty or behind `origin/main`?

Both are undecided — make the call here, and record it as a settled decision in the PR, not as a question carried forward again.

### Decisions already settled — do not re-derive them

**No script under `skills/plot/scripts/` needs a write-target fix.** `test/reconcile/main-checkout-writers.test.mjs` proves this for all five candidates named in the plan's Design section, each against a real sandboxed git estate (bare origin + clone + worktree), not by reading source alone. Re-litigating "maybe it really was `plot-push-main.sh`" wastes the first hour; the sandbox run is the evidence and it already exists.

**`plot_repo_root` (in `plot-desk-root.sh`) correctly resolves to the MAIN checkout from anywhere, including from inside a desk worktree — that is by design, not the defect.** It answers `git rev-parse --show-toplevel`'s physical parent of `--git-common-dir`, and every caller that needs "where do I, a desk, write" goes through `plot_desk_root` instead, which answers the worktree, not the checkout. The mechanism was proved sound (`"plot_repo_root resolution alone"` test); what remains to guard against is some future caller using `plot_repo_root`'s answer as a write target when it meant `plot_desk_root`'s.

**The reflog pattern that broke `HEAD`** (`plot: append PR #2302 …`, `plot: append PR #2310 …`, `reset: moving to HEAD~1`, the same commit again) **matches no Plot script's commit message convention** — Plot's own bookkeeping commits never reset and recommit the same change. It matches a person running `git commit` / `git reset` directly against the checkout while following the exact "append `→ #<number>`" instruction this very skill (`/plot-implement` step 4) gives by hand. **The guard this wave adds must therefore constrain humans and agents acting unattended in the main checkout, not just scripts** — a script-only gate would pass the actual incident.

### Done when

The plan's `## Design` → step 4 names the shape: *"A contract test runs the fleet commands against a sandbox repository and asserts that the main checkout's `git status --porcelain` is empty and `HEAD` matches its tree afterwards."* `test/reconcile/main-checkout-writers.test.mjs` already proves this for the five candidates wave 1 covered (per-script `assertCleanAndConsistent`, asserting both `git status --porcelain` is empty AND `git diff HEAD --quiet` exits 0 — both halves matter, because the two defects have different symptoms and one assertion alone passes the other's failure).

What wave 2 must still prove, beyond what wave 1 already covers:

- Whatever guard you add (refuse-when-dirty, or route-to-disposable-worktree) has its own sandboxed test proving the guard actually fires — not just that the previously-named scripts are clean.
- If you choose the board-warning design (open question 2), the warning is a domain property per `CLAUDE.md`'s *Every rendered state is a domain property* rule — testable without a browser, not a decision made in `.tsx`.
- Record your answers to the plan's two open questions as resolved (check both boxes), the way wave 1 resolved its own two.

Plus: the repo's gates — a changeset bumping `plot` (and any touched skill under `bumps:`), and no committed `board-server.mjs` diff if the board changes (restore generated paths before pushing; see `CLAUDE.md` → *On a conflict in `board-server.mjs`*). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` from the repo root before each push and run what it prints; the suites in `CI suites` run in CI only — list no full suite here, and do not run `test:e2e` locally (CI's gate, not a local one).

### Bookkeeping

Open the PR through the controller once real work exists: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create` by hand. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section, in a plan-file commit — not a hand-edited `State:` field; `plot-state-gate.sh` only permits that write from the commands that own it, and a plain commit appending the PR number to the Slices line is unaffected by that gate. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the fix mechanism (wherever you land it: `skills/plot/scripts/`, `packages/domain/`, or a new contract test) and the sandboxed contract test proving it. It does not own:
- `test/reconcile/main-checkout-writers.test.mjs` itself, beyond adding new tests alongside the existing ones — the existing tests in that file are wave 1's evidence and must keep passing unmodified.
- Any of the five already-cleared scripts' write-target logic — none of them needs a code change; re-touching one without a new failing test is scope creep.
- `packages/board/src/server/entry/ladder.ts` beyond what the new design requires — it was already proven clean by `ladder-real-repo.test.ts` in `packages/board`.

No sibling branch is in flight for this plan — wave 1 (`bug/main-checkout-writers-measured`) already merged. If you find the main checkout's dirty/behind state needs a mechanism this plan did not anticipate (e.g. a pre-commit hook, a `CLAUDE.md` rule vs. a gate per *Gates Over Rules*), report it rather than improvising silently outside the plan's two named questions.
