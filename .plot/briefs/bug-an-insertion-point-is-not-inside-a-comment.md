## Implementation brief — a-record-is-written-where-it-can-be-read (wave 1: An insertion point is not inside a comment)

- **Plan (canonical):** `docs/plans/2026-09-25-a-record-is-written-where-it-can-be-read.md` on `main`
- **Approved:** 2026-09-25, Jan Wloka, in-session after panel
- **Branch:** `bug/an-insertion-point-is-not-inside-a-comment` (base: `main`; claimed 2026-09-25 by ref push at `origin/main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review; CI is the authority)
- **Issue:** #981

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

Two record writers insert into `## Status` after the last list item and do not know about HTML comments. The shipped template ends `## Status` with a commented block that contains two list-shaped placeholder lines (`- **Approved:** <date>, …` and `- **Started:** <date>, …`), so the writers put the record inside the comment. `plot-plan-meta.sh` correctly ignores commented content and answers `approved_raw: ""` / `started_raw: []`. The write reports success and the record is invisible.

This estate has **38 swallowed `Started:` records across 10 plans**, all written by `append_started_line` in `skills/plot/scripts/plot-dispatch.sh:3026-3078`. `append_approved_line` in `skills/plot/scripts/plot-approve.sh:409-435` has the same shape and was reproduced against the shipped template on 2026-09-25.

The fix is one line per writer, copied from `skills/plot/scripts/plot-deliver.sh:327-330`, placed **before** the placeholder-slot arm in the scan loop:

```awk
        # An HTML comment ends the writable region. Checked BEFORE the
        # placeholder arms so a commented-out `- **Approved:**` template line
        # is never mistaken for the slot to fill.
        if (lines[i] ~ /<!--/) break
```

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Guard the writer; do not move the placeholders out of the comment (plan option B).** A bare `- **Approved:** <date>, <who>, <channel>` outside the comment parses as a real record whose text is `<date>, <who>, <channel>`. The empty-slot arm matches only `**Approved:**` followed by nothing, so the placeholder is not an empty slot either. B trades an invisible record for a false one. Do not edit either template.

**`break`, not depth-tracking.** Depth-tracking would put a record *after* a comment that sits before the live items; 12 plans on this estate have that shape. `break` keeps the record above the first comment. The deciding argument is consistency: three copies of one guard must not differ, and the `plot-deliver.sh` copy already has a test (`19b60430a`, #597, 2026-09-01).

**`Delivered:` needs nothing, and `Released:` is out of scope.** `plot-deliver.sh:330` already carries the guard. `skills/plot-release/SKILL.md` writes `Released:` by hand with no awk, so it has no insertion point to guard. This answers the plan's open question: deliver has its own copy, which is already fixed; release has no copy.

**Do not touch `plot-plan-meta.sh`.** It is right to ignore commented content.

**A consequence of the shipped rule the plan does not state — measured on the shipped template at dispatch.** `skills/plot/templates/plan.md:9-14` puts inline placeholders on list items: `- **Story:** <!-- optional … -->`, and the same on `Sprint:`, `Issue:`, `Review:`, `Impl:` and `Rounds:`. `/<!--/` matches those lines, so on a plan that keeps any of them unfilled the scan stops at the FIRST such line, and the record is inserted after the last list item above it (typically `Type:`). The record is outside every comment and parses. It is merely higher in the block than the placeholder. `plot-deliver.sh` already behaves this way. **Keep the rule verbatim.** A line-anchored variant (`/^[ \t]*<!--/`) would fix the position, but it would make the three copies differ. If you think the position matters, report it in the PR as a finding for all three writers together. Do not change one copy on your own.

**The idempotency guards are part of the defect's reach, and repairing old records is out of scope.** `append_started_line` returns 0 early when `grep` finds a `- **Started:** … \`<branch>\`` line anywhere in the file (`:3042-3043`), **including inside the comment**. A plan that already holds a swallowed record therefore never gets a readable one on re-dispatch. This fix stops new losses. It does not repair the 38 existing records and does not change that grep. Name this in the PR body as a follow-up and leave it alone. (`plot-approve.sh` gates on the parsed `approved_raw`, which is empty for a swallowed record, so a re-run writes a readable record once the guard is in.)

**Rules this repo keeps re-learning:**
- Assert the round trip: write, then ask `plot-plan-meta.sh`. Never assert a line number, and never re-implement either side in the test. The model test's header explains why.
- Run the real write path, not a dry run. `plot-deliver.sh --dry-run` never called the writer, so a dry-run test cannot see this defect.
- The plan-less path must stay byte-identical. A plan whose `## Status` has no `<!--` produces exactly the bytes it produced before.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **The shipped template, end to end** (`skills/plot/templates/plan.md`, not a hand-written fixture): approve → `plot-plan-meta.sh` reports a non-empty `approved_raw`. A hand-written Status block without the inline `<!--` placeholders would never exercise the stop-at-`Story:` behaviour above.
- **The same for `Started:` through `append_started_line`**: after the write, `started_raw` contains the branch. This writer caused all 38 measured losses; a fix to `plot-approve.sh` alone passes every approve test and leaves the real defect in place.
- **No comment → byte-for-byte unchanged**, for both writers, compared against the output before the change.
- **A comment AFTER the live items**: the record lands with the live items, and the comment block is unchanged.
- **The placeholder-slot arm still wins** when an empty `- **Approved:**` / `- **Started:**` slot sits above any comment. The guard must be checked before the slot arm (the deliver copy's order), and the slot must still be found when it precedes the comment.

Model the tests on `test/reconcile/deliver-record-outside-comments.test.mjs`: a sandbox repo plus a bare remote, the real script, and a read back with `plot-plan-meta.sh`. The neighbouring files `test/reconcile/approve.test.mjs` and `test/reconcile/dispatch.test.mjs` show how each script is driven in a sandbox. If sourcing the function alone is cheaper than driving the whole dispatch, a test may extract the function, but the assertion is still the parser's answer.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`. Do not run `test:e2e` locally. Add a changeset for `'plot': patch` with the description FIRST and a `bumps:` block last (`plot-approve: patch`, `plot-dispatch: patch`) plus `plan: docs/plans/2026-09-25-a-record-is-written-where-it-can-be-read.md`. Run `./scripts/check-changeset-packages.sh`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work is still moving). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the branch line under `## Slices` in the plan on `main`. This plan annotates the PR inside the heading (`(Branch: …, PR: #N)`), and `plot-plan-meta.sh` parses that form.
- The PR body references `Fixes #981` only if the maintainer wants the issue closed on merge. Otherwise it names #981 without the keyword; `/plot-deliver` owns the issue status.

### Tooling note

The plugin's `plot-controller-gate.sh` PreToolUse hook refuses ANY Bash command whose text names `plot-deliver.sh` or `plot-dispatch.sh`. That includes read-only `sed` and `git diff -- <path>`, which it blocked twice during this dispatch. Use the Read/Edit tools, a directory pathspec (`-- skills/plot/scripts/`), or a glob for reads. The tests invoke the scripts from inside `node`, which the hook does not see. Report the false positive; do not use `--unowned-action` to read a file.

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-approve.sh` — `append_approved_line` only
- `skills/plot/scripts/plot-dispatch.sh` — `append_started_line` only
- new tests under `test/reconcile/`
- one `.changeset/*.md`

It does not touch the templates, `plot-plan-meta.sh`, `plot-deliver.sh`, the release skill, or any existing swallowed record in `docs/plans/`.

Other branches in flight, verified at dispatch (2026-09-25) against every remote ref: `feature/one-monitor-watches-the-slice` changes the same dispatch script, but only in `start_worker` (lines 752-845), not the writer at line 3026. Its last push was 3 weeks ago. No other remote branch touches `plot-approve.sh`, the dispatch script, or either template.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
