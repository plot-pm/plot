## Implementation brief — reconcile-scan-sections-7-20-24 (wave: Scan sections)

- **Plan (canonical):** [docs/plans/active/reconcile-scan-sections-7-20-24.md](../../docs/plans/active/reconcile-scan-sections-7-20-24.md) on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2506 merged
- **Branch:** `bug/reconcile-scan-sections-22-24` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `Plan PRs: required` — plan-PR review already happened; this PR gets its own review on merge

This branch waits on `bug/reconcile-scan-sections-1-and-7` (PR #2709), which is **merged**. Nothing else in the wave blocks it.

### What to build

Fix the eleven findings issue #2479 assigns to `plot-reconcile-scan.sh` sections 22–24b plus the two findings against `skills/plot-reconcile/SKILL.md`. All eleven are confirmed still present on `main` at the time this brief was written — none were touched by the merged sections-1-and-7 slice, which edited a disjoint region of the same file.

Three groups:

1. **Section 23 (open-issue check) calls `issue-view` once per plan·key pair with no de-duplication, though the comment at `plot-reconcile-scan.sh:2975` and the changeset for #2308 both claim once per distinct key.** A plan naming the same key twice (directly and via a duplicate `ticket:` fallback) re-asks the host for it.
2. **Four comments in section 23 describe behaviour the code no longer has:**
   - `plot-reconcile-scan.sh:2987` — "read the Jira-only branch below already made per key" names a branch that does not exist in this section's current shape.
   - `plot-reconcile-scan.sh:3062` (nearby, in the key-resolution comment) — "the first Jira-shaped `issues[]` entry wins" is false: the jq keeps `$issues` whole (every matching entry), not just the first.
   - `plot-reconcile-scan.sh:3064` area — the anchored key regex (`^[A-Z][A-Z0-9]*-[0-9]+$`) is stricter than the unanchored `JIRA_KEY` pattern it claims to mirror; grep for `JIRA_KEY` in the codebase before changing either side; it currently returns nothing in this script, so "mirrors" may itself be the stale claim.
   - `plot-reconcile-scan.sh:3212` — the printed note says an issue "assigned to someone else reads as closed here," but the `assignee = currentUser() AND resolution = EMPTY` JQL also excludes *unassigned* open issues, which the note never names.
3. **24b's rewrite hint is actively wrong for one of its two causes.** `plot-reconcile-scan.sh:~3281` tells the reader to "give this wave a `(Branch: %s)` heading" — but the whole point of 24b is that the wave in question **already has** a `Branch:` heading; the list item it's complaining about just names a different branch than the one that heading claims. The fix must distinguish "no heading at all" from "a heading claims a different branch" and word the repair accordingly.

Also: `skills/plot-reconcile/SKILL.md:184` doesn't mention the `unread_heading_items` counter / section 24b at all (confirm — the live file may already cover this if an adjacent slice landed first; check before writing new prose). `SKILL.md:215`'s section 23 description — "one open-issues list with membership and a printed window" — is stale: section 23 is per-key `issue-view`, not a windowed list. Grep the live file for "window" and "membership" before assuming the exact wording; re-verify both before patching, the referenced line numbers will have drifted since #2479 was filed and the file may partially already read correctly.

### Decisions already settled — do not re-derive them

- **Per-key, never per-plan, and never windowed.** `issue-view <key>` is the only call section 23 makes, once per *distinct key* across the whole sweep — not once per plan, and never through `issue-list`'s bounded page (`gh issue list` defaults to 30 rows; a 2026-10-21 measurement on ewz-kus-portal found an open issue at row 201+ reading as closed under a windowed read). De-duplication must survive that constraint: collapsing `oi_claims` by key before the `issue-view` loop, not by skipping a plan whose key repeats.
- **Three outcomes, never collapsed:** exit 0 is an answer; exit 4 means "this host has no tracker to ask" (printed once, not per key); any other non-zero is that one key's lookup failing, reported unchecked for that key alone. Fixing de-duplication must not merge these three cases — a de-duplicated key still needs its own exit-code branch if the first lookup for it fails.
- **Read the claims on a dedicated file descriptor (`<&3` / `3<<<`).** This is a measured fix already in the code, not something to touch: a nested `while read` inside a loop fed by `<<<` drains the *outer* loop's stdin, and a 3-finding fixture silently reported none before this was added. Keep the `3<<<` pattern when restructuring the per-key loop for de-duplication.
- **Absence is never evidence of "closed."** The host answering nothing for a key (outside the window, assignee mismatch, whatever) must read as "not evaluated," never as "clean." This governs the unassigned-exclusion wording fix in point 3 above — the fix is to state the gap accurately, not to make the check broader.
- **The section reports, it never gates.** Every output here stays out of `attention=` and below the `== blocking sections end ==` marker. Nothing in this slice moves that boundary.

### Done when

The plan's `## Done when` is implicit in its per-finding checklist (see the plan's Design → Findings by slice, "Scan sections 22–24b and the skill doc"); treat issue #2479's per-line findings list as the literal spec — each line it assigns to this slice's files is one item to close.

Lift these assertions, which exist because a naive fix passes without them:

- A test proving the de-duplication actually happens — e.g. a plan or pair of plans naming the same key twice, asserting `issue-view` is called exactly once for it (a call-counting shim, not just a correct final report — the finding is about call count, and a test that only checks the printed line can pass while still double-calling).
- A test for the 24b hint that distinguishes the two repair paths: a wave with no `Branch:` heading at all, vs. a wave whose heading claims a different branch than the orphaned list item names. Both must print a repair that is actually correct for that case.
- Per `CLAUDE.md`'s rule for this repo: "mutation-test it against the old code before the PR" for every message/count fix — confirm each fixture actually fails under the pre-fix code, not just passes under the post-fix code.
- Comments you rewrite must state current behaviour, never history ("used to…", "per the brief…", "resliced…") — this is a repo-wide rule, and it's the direct cause of three of the four comment findings above.

Plus: `scripts/check-shell-lines.sh` ratchets shipped shell lines against the merge base — a net-positive diff in `plot-reconcile-scan.sh` fails CI with no override. If the de-duplication logic needs new lines, look for a redundant line to cut in this slice's own region first (section 23's per-key loop has some already-dense one-liner style to match, not to expand). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests and typecheck for whatever you've actually changed. The suites in `CI suites` (`pnpm run test:e2e`, `pnpm run test:contracts`, `pnpm run test:board`, the domain vitest run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR; do not run the full set locally as a matter of course — `test:e2e` especially is CI's gate, not a local one (see `CLAUDE.md` § Testing).

### Bookkeeping

Open the PR through the controller once the branch exists and carries a commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not use `gh pr create` — it takes the title from the last commit subject, which this repo's commit convention (`plot-<command>: <description>` or `bug: <description>`) does not intend as a PR title.

When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → "Scan sections" heading:

```
- `bug/reconcile-scan-sections-22-24` — section 23 one read per key, accurate notes, section 24b repair hint, `SKILL.md` for sections 23 and 24b → #<number>
```

Push the first real commit as soon as it exists — a branch with nothing but a `PLOT-BLOCKED` marker is not bookkeeping-complete.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-reconcile-scan.sh` — sections 22 (its shared parse feeding 23), 23, 24, 24a, 24b only. Do not touch section 7 (lines ~1500s) or section 1 (lines ~1050s) — those were `bug/reconcile-scan-sections-1-and-7`'s territory and are already merged via #2709.
- `test/reconcile/scan.test.mjs` — the section-23 tests near the old line numbers 5026 and 5345 (precedence and `PLOT_ISSUE_LIMIT` comment fixes), plus any new de-duplication test.
- `skills/plot-reconcile/SKILL.md` — the section-23 and 24b descriptive prose only.

Other wave branches in this plan: `bug/reconcile-config-and-plan-meta` (merged → #2575, touched `plot-config.sh` and `plot-plan-meta.sh`, not this file), `bug/reconcile-corpus-and-scan-tests` (status unknown at brief time — check `gh pr list --head bug/reconcile-corpus-and-scan-tests` before touching any corpus test file; it owns `branch-state-waits-open-pr.corpus.test.ts`, `merge-subject-bitbucket.corpus.test.ts`, `slice-chain.corpus.test.ts`, and `scan-double-link.test.mjs` — none of which this slice should edit), `bug/reconcile-scan-sections-1-and-7` (merged, #2709, disjoint region of the same file this slice edits — rebase onto current `main` rather than assuming no conflict).

If you find a finding in issue #2479 that doesn't match what's on `main` — because an earlier slice already incidentally fixed it, or the line has drifted into different wording — report it rather than silently skipping or silently "fixing" something already correct.
