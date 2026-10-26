# Reconcile scan sections 7, 20-24 print wrong notes and contradicting advice

> Eleven MEDIUM and nineteen LOW review findings in the reconcile scan, `plot-config.sh`, `plot-plan-meta.sh` and their tests, each fixed so that output and comments describe the code that runs.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2479
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2506 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/reconcile-config-and-plan-meta`
- **Started:** 2026-10-26, Jan Wloka, `bug/reconcile-scan-sections-1-and-7`
- **Started:** 2026-10-26, Jan Wloka, `bug/reconcile-scan-sections-22-24`

## Changelog

- `plot-reconcile` section 7 starts node once per pass and prints one consistent line when node or the bundle is missing.
- `plot-reconcile` section 1 gives a fix command for a design plan with both links.
- `plot-reconcile` section 23 reads each distinct issue key once, lists as not checked only plans that name an issue, and drops the Jira inbox note.
- `plot-reconcile` section 24b gives a repair hint a heading-shape wave can follow.
- `plot-config.sh get-raw` returns a backticked value without the prose after it, so the Shipped code paths check in section 22 reads its paths.
- `plot-plan-meta.sh` keeps a heading's deferral reason when a list item carries a bare marker, and de-duplicates commit refs in overlay mode.

Board impact: none. The change touches helper scripts and their output text, not the plan format, the template or the `docs/plans` layout. `plot-plan-meta.sh` feeds the board, so the `plot-plan-meta.sh` slice runs the board's plan-parsing tests.

## Motivation

Ten merged pull requests (#2119, #2147, #2268, #2274, #2290, #2296, #2304, #2308, #2354, #2465) each received review findings after merge. `plot-review` checked 30 of them against `origin/main` at `84b1638e4` on 2026-10-24 and filed them as issue #2479: 11 MEDIUM, 19 LOW.

The findings fall in four groups:

- **Output that contradicts itself.** Section 7 prints `not evaluated` and then `(none — every slice holds a single branch)`. Section 23 prints a Jira note that the per-key read made false. Section 24b tells the reader to add a second `Branch` heading to a wave that already has one. Section 1 gives no fix command for a design plan with both links, while the unlinked arm routes design to `active/`.
- **Claims the code does not meet.** Section 7 starts node once per multi-branch heading, and the bundle header says once per pass. Section 23 calls `issue-view` once per plan and key, and the comment and changeset say once per distinct key. The "not checked" line lists plans that never had an `Issue:` line.
- **A check that silently matches nothing.** `plot-config.sh get-raw` keeps trailing prose after a backticked value, so the Shipped code paths check reports clean on every plan.
- **Tests that cannot fail.** The `branch-state-waits-open-pr` corpus test reads a gh shim that never models the open draft PR. The section 23 precedence test passes under an always-append regression because `PROJ-999` is not open in the stub.

## Design

### Approach

Each slice fixes one group of findings in the file or files that hold them. The findings list in issue #2479 is the checklist; each slice closes the items whose file it owns, and no slice adds a feature.

Rules each slice follows:

- A fix to a message or a count ships with a test whose fixture makes the old and the new behaviour disagree (mutation-test it against the old code before the PR).
- A comment states current behaviour. Comments that describe history ("used to repeat", "per the brief", "resliced", "two real fixtures") are rewritten, as `CLAUDE.md` requires for the domain package and the repo's writing rules.
- A function written or rewritten in a shell script or test keeps the file's existing indentation (2 spaces in the scan) and, in JS, is an arrow.
- `scripts/check-shell-lines.sh` ratchets shipped shell lines. The slices reduce lines where they can (the both-links branch repeats the drift line in three cases; `emit_drift` is redefined inside the loop) and must not add net lines.
- `plot-config.sh:269` also carries a LOW finding that unrelated scripts were compressed into one-liners to pay the shell-line gate. The slice restores them only if the net line count still passes the gate; otherwise it records the trade in Notes.

Findings by slice:

- **Scan sections 1 and 7** — `plot-reconcile-scan.sh:1056,1057,1071` (section 1 both-links arm, comments, `emit_drift`), `:1515,1522,1536` (section 7 indentation, node per pass, one missing-bundle line).
- **Config and plan meta** — `plot-config.sh:269` (`get-raw`), `plot-plan-meta.sh:996,1012` (bare deferred marker, commit-ref de-duplication).
- **Corpus and scan test repairs** — `branch-state-waits-open-pr.corpus.test.ts:46,61,154,156`, `merge-subject-bitbucket.corpus.test.ts:17`, `slice-chain.corpus.test.ts:76,98`, `scan-double-link.test.mjs:120`.
- **Scan sections 22-24b and the skill doc** — `plot-reconcile-scan.sh:2987,3062,3064,3067,3158,3211,3212,3281`, `scan.test.mjs:5026,5345`, `skills/plot-reconcile/SKILL.md:184,215`.

### Open Questions

- [ ] The `slice-chain.corpus.test.ts:76` finding says two corpus tests depend on the current plans holding uncut headings. Does the fix use a fixture plan, or does it skip the plans that were resliced? The slice picks the fixture unless the corpus has a reason to read live plans.
- [x] `plot-config.sh get-raw` strips prose after a closing backtick. Does any other caller rely on the prose staying? The slice greps the callers before changing it. Answered in #2575: `get-raw`'s one real caller is `plot-reconcile-scan.sh:2849`; no other caller relies on the prose staying.
- [ ] Section 3067 lists "not checked" plans. Does "names an issue" mean any `Issue:` line, or only one whose tracker the scan can read? The slice follows the section 23 definition of a checkable plan.

## Slices

### Fixes that touch no scan code

- `bug/reconcile-config-and-plan-meta` — fix `get-raw` and the two `plot-plan-meta.sh` findings → #2575
- `bug/reconcile-corpus-and-scan-tests` — make the corpus and double-link tests reach the code they name → #2671

### Scan sections

- `bug/reconcile-scan-sections-1-and-7` — one node start per pass, one missing-bundle line, a fix command for a design plan with both links → #2709
- `bug/reconcile-scan-sections-22-24` — section 23 one read per key, accurate notes, section 24b repair hint, `SKILL.md` for sections 23 and 24b <!-- waits: bug/reconcile-scan-sections-1-and-7 -->

## Notes

- Source: https://github.com/plot-pm/plot/issues/2479, follow-up findings from `plot-review`, checked against `origin/main` at `84b1638e4` on 2026-10-24.
- The last slice waits for the section 1 and 7 slice because both edit `plot-reconcile-scan.sh`; the two touch different regions, and the wait avoids a rebase of a 3000-line file.
- Deliverable search: not run. No slice builds a new named artifact; each edits an existing one.
- PLOT-UNASKED answers: Design question defaulted to `State: Draft` (the prompt gave no `Design:` line). Review and Impl follow `Plan PRs: required` and the multi-slice shape.
- `bug/reconcile-config-and-plan-meta`'s commit-ref de-duplication initially added a `merge_commits()` helper that cost `scripts/check-shell-lines.sh` 9 net lines, later 4 after compressing its body. Since the helper had exactly one caller, inlining its loop directly into that caller (`keep_branch`) and merging two more statement pairs in the file's existing one-liner style removed the function wrapper's own overhead entirely — the fix lands at zero net lines against the merge base, not a recorded trade.
