## Implementation brief — reconcile-23-tells-a-released-plan

- **Plan (canonical):** `docs/plans/2026-10-21-reconcile-23-tells-a-released-plan.md` on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2287 merged
- **Branch:** `bug/reconcile-23-tells-a-released-plan` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

### What to build

Section 23 of `skills/plot/scripts/plot-reconcile-scan.sh` (the `decide:` line prints at `:3145`, the open-issue window read starts at `:3100`) currently does two things wrong, both measured against a real repository (ewz-kus-portal, main `b33d3ee22`, field test round 6, issue #2283):

1. **Wrong hint for a Released plan.** The `decide:` line at `:3145` is one fixed sentence for every phase: `release the plan to close it through the tracker, close it by hand, or record why it stays open`. For five plans that were already Released (EWZKUS-3845, 3871, 3877, 3874, 3876), this told the reader to release a plan that is already at its terminal phase — and the project declares no `Tracker released status`, so even releasing it again would not close the issue. The line must branch on `oi_phase` (already read per claim, in the `C\t<file>\t<phase>\t<issues>` tuples from `oi_claims`) and on whether `Tracker released status` is configured (read the same way `plot-issue-status.sh:38` already does, via `plot-config.sh get "Tracker released status" ''`):
   - `delivered` → unchanged: today's hint.
   - `released`, no `Tracker released status` declared → say the tracker has no released status configured, so a release does not move the issue.
   - `released`, status declared, issue still open → say the issue waits in a tracker status Plot does not own, and name the declared status.

2. **A 200-row window can hide an open issue.** The `:3100` loop reads `issue-list --paged --limit $ISSUE_LIMIT` (default 200, `PLOT_ISSUE_LIMIT`) and intersects that list against the keys the finished plans name (`oi_claims` → `oi_open`, the `grep -x -F -f` membership test at `:3135`). An open issue past row 200 is absent from `oi_open` and reads as closed — wrong, not unknown. Replace the window-and-intersect with a direct per-key lookup: for each key a finished plan names, ask `plot-host.sh issue-view <key>` and read that issue's own state, rather than asking for a page of everything and testing membership.

### Decisions the plan settles — do not re-derive them

**`issue-view` already answers for a closed issue on every backend — the plan's first open question is answered, not open.** The header at `plot-host.sh:384` calls it "ONE open issue", but that is stale/aspirational prose, not the implementation: `gh issue view <n> --json number,title,body,url` (GitHub, `:5146`) returns any issue regardless of state and fails only when the number does not exist; `bb issue view <n>` (Bitbucket, `:5176`) renders a `<STATE> • …` line for open *or* closed issues and fails only on a bad lookup; Jira's arm (`:5129`) hits `GET /rest/api/2/issue/<key>` directly and only 404s when the key truly does not exist (`jira_check` turns that into exit 3). So `issue-view` is already state-agnostic — do not add a state-aware read to `plot-host.sh`. The one real gap: fix the comment at `:384` from "ONE open issue" to "ONE issue, any state" while touching this file, since the next reader will hit the same false question.

**No batched read exists or is needed — one `issue-view` call per key is the design, not a shortcut taken under time pressure.** The plan's second open question asks whether 8 keys (ewz-kus-portal's count) justifies a batch. There is no batched "read these N keys" op on any of the three backends' `issue-view` arm — only `issue-list`, which is exactly the window-limited call being removed. A per-key loop costs N host calls where N is the count of *distinct* keys named by delivered-or-released plans — on this repo that count is small and bounded by how many plans finish, not by how many issues the tracker holds, so it does not re-introduce the window problem it is replacing. If a future repository's finished-plan count makes this expensive, that is a new measurement to make then, not a speculative batch to build now.

**`plot-issue-status.sh` / `issueStatusWrites` do not answer "what state is this issue in now" — they decide what to *write*, not what to *read*.** The plan's third open question asks whether `plot-issue-status.sh` already answers this so section 23 could reuse it. It does not: `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts:46`) takes a plan's phase and the three configured status *words* and returns which word to write — it has no tracker read in it at all, and `plot-issue-status.sh` is a write-only script (its own header: "writes nothing [that fails] ... closes nothing, creates nothing, comments nothing"). What *is* reusable from that file is the **config-reading pattern** — `plot-config.sh get "Tracker released status" ''` (`plot-issue-status.sh:38`) is the exact call section 23 needs for decision 1. Reuse that line's shape; do not reuse the script or the domain rule, which answer a different question.

**Keep the existing error discipline unchanged.** Section 23 already separates "not evaluated — this host cannot be asked" (exit 4, a configuration fact) from "not evaluated — the tracker question failed" (any other exit, a real failure) for the removed window call (`:3100-3104`). The per-key `issue-view` loop must preserve the same split per key: exit 4 from `issue-view` means this backend cannot be asked (print once, as today, not per key); any other non-zero exit for one key is that key's own lookup failing and must be reported as "unchecked" for that key specifically — never silently dropped and never read as "closed". `test/reconcile/scan.test.mjs:4612` and `:4638` are the two existing tests proving this split for the window read; the per-key version needs its own pair.

**The `--no-pr` / `--offline` contract is unchanged and still gates the whole section.** `test/reconcile/scan.test.mjs:4664` ("section 23 never asks the tracker under --no-pr") must still pass: zero host calls when offline, with the existing note naming how many finished plans went unchecked (read from `oi_plans`, already computed from `oi_claims` before any host call — nothing here changes that count).

**Jira's per-key path (`:4948` onward) is a precedent to extend, not a parallel system to rebuild.** Section 23 already has a Jira-specific branch reading one key at a time via `issue-view` for the "declared tracker has no project list" case (tests at `:4948`–`:5107`). The new per-key design generalizes that existing Jira branch to GitHub and Bitbucket too, rather than adding a fourth shape. Read those tests before writing new ones — they are the closest existing example of "ask this adapter about one key and read its current state," which is the core of this change.

### Done when

The plan's `## Done when` is its Slices section and Changelog — there is no separate `## Done when` heading in this plan, so the two Changelog lines are the spec:

- `/plot-reconcile` section 23 no longer tells a Released plan to release. For a Released plan whose issue is still open, it names the cause (no `Tracker released status` configured, or the issue sits in a status Plot does not own).
- Section 23 asks the tracker about the issues the plans name, not a window of open issues — an open issue past the 200th row is found.

Lift these assertions specifically, because a naive pass over the existing 18 section-23 tests would miss them:

- A test with a **Released** plan naming an open issue, `Tracker released status` **undeclared**, asserts the new "no released status configured" sentence — not today's "release the plan" sentence.
- A test with a **Released** plan naming an open issue, `Tracker released status` **declared** (e.g. `Done`) and the issue's tracker status is something else (e.g. `In Review`), asserts the new sentence names that declared status.
- A test with the issue sitting at row 201+ of a 250-issue open list (or any count exceeding a small `PLOT_ISSUE_LIMIT` override) still reports it as open — proving the per-key lookup, not a reader relying on a bigger window.
- `test/reconcile/scan.test.mjs:4689` ("section 23 warns when the tracker returned a full window") and its `window: the … limit …` note (`:4719`) are tied to the old list-based read. Decide explicitly whether this test and its note survive: if the per-key design removes `issue-list` from this section entirely, the window note has nothing left to report and the test should be replaced with one for the per-key behavior above — do not leave a now-untestable note in the printed output, and do not leave a stale test silently passing for the wrong reason.
- `test/reconcile/scan.test.mjs:4729` ("section 23 sits below the marker and stays out of the delivery gate") must keep passing unchanged — this rewrite touches what section 23 asks and prints, never where it sits or whether it blocks.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related tests and typecheck for whatever this branch touches. The suites in the `CI suites` config key run in CI on every PR; do not run `test:e2e` locally. Add a changeset (description first, `bumps:` block last, per `CLAUDE.md` § Versioning) — this is a `patch` to `plot` and likely a `patch` bump to no skill directly, since the change is inside `plot-reconcile-scan.sh` rather than a skill's `SKILL.md`.

Name the shell gate explicitly: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This change replaces a list-and-intersect block with a per-key loop — if the new code is longer than what it replaces, pay for the growth by removing shell elsewhere in the same change, or by moving the decision logic (phase × config → sentence) into the domain package and calling it through a bundle rather than writing it as more bash. Given `packages/domain/src/rules/issue-status.ts` already holds the sibling "phase × config → write" rule, a parallel "phase × config → sentence" rule there (read-only, no I/O) is the natural home if the line budget is tight — but that is a design call for whoever picks this up, not a decision already made; the plan does not ask for a domain rule and the Slices section names shell tests (`test/reconcile/`) as the only deliverable.

### Bookkeeping

Open the PR through the controller once the first commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Do not run `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-21-reconcile-23-tells-a-released-plan.md:52`).

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` (section 23 only — lines roughly `:3095`–`:3165`; do not touch other numbered sections), its tests in `test/reconcile/scan.test.mjs` (the section-23 block, `:4545`–`:5150`+), and optionally the one-line comment fix at `plot-host.sh:384` and a new domain rule file under `packages/domain/src/rules/` if the shell-line budget calls for it. No other branch is in flight against this plan — it is a single-slice, single-wave plan (`## Slices` names exactly one branch under "Hint and lookup"). If the shell-line gate forces touching `packages/domain/src/`, that package's arrow-function and TSDoc rules in `CLAUDE.md` apply to anything new written there.

If you find something the plan did not anticipate — e.g. `issue-view` turning out to fail in some backend/state combination not covered above — report it rather than improvising a workaround outside this scope.
