## Implementation brief — tickets-follow-the-delivery-loop (wave 1: Comment renderer)

- **Plan (canonical):** docs/plans/2026-10-29-tickets-follow-the-delivery-loop.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2916 merged
- **Branch:** `feature/the-plan-comment-renders-records` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** the `plot/review` ruleset on `main`; one full review per PR

Waves 2 (`feature/merged-slices-update-the-comment`) and 3 (`feature/jira-moves-at-approve`) wait on the merge of this branch. Wave 2 calls the renderer this branch builds.

### What to build

Today every phase write replaces the plan issue's Plot comment with two lines: the marker `<!-- plot:plan-link -->` and `Plan <phase>: <link>` (`planStateComment`, `packages/domain/src/adapters/tracker/tracker-plan-state.ts:44-47`). Any line a sibling plan adds, the next phase write erases. The issue shows nothing between Approved and Delivered. Two concurrent writers on an issue with no marked comment both posted a comment (`plot-host.sh:5755-5757`), and later writes edit only the first match.

Build one domain renderer, `packages/domain/src/rules/plan-issue-comment.ts`. It takes readings as values (phase, link, version, slice progress, HIGH tickets) and returns the body: the phase line, the slice-progress line, one link per HIGH ticket, nothing else. `planStateComment` and `PLAN_STATE_MARKER` move from the adapter into it; the adapter keeps the host steps and renders nothing. `run` in `packages/board/src/server/entry/plan-state.ts:162` reads the progress and ticket records itself, as it reads the plan through `planMeta`, so the five callers (`/plot-idea`, `approve.ts:1174`, `deliver.ts:546`, `deliver.ts:955`, `/plot-release`) keep their arguments. `PlanStateWrite` (`packages/domain/src/ports/tracker.ts:95`) gains the progress and the tickets, and the port's "four facts" text (`:219-227`) changes with it.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **One renderer owns the comment.** #2903 and #2904 write records only and call no comment write. Without that, each write erases the others' lines.
- **No progress and no tickets gives a body byte-identical to today's.** Existing comments must not churn. Pin it with a test against the current two-line body.
- **The comment carries the progress line and HIGH ticket links, and nothing else.** Unblocker answers go into the slice PR body (#2901). There is no size cut and no answer-record read.
- **D6: the ticket record lives in `.plot/state/` under the common git dir of the fleet's machine.** A write on a machine without it keeps the comment's existing ticket lines and changes only the phase line. That needs one read of the marked comment's body; the port names it as its single read-back, and its "no rule reads the plan comment back" sentence gains that one exception.
- **Every write is level-triggered.** Compute the owed body, compare its hash with the last body written for that issue (recorded in `.plot/state/`), and write only on a difference. A repeated tick writes nothing.
- **One writer per issue holds a per-issue lock around lookup and post.** The panel reproduced two posted comments against a fake `gh` with concurrent writers; the test must do the same and assert one comment.
- **A progress write is comment-only.** `issue-label` on a delivered issue issued `--add-label plan:approved --remove-label plan:delivered` in the panel's run. A comment-only write sets no label.
- **A plan with no `Issue:` gets nothing.** `planStateWrites` returns nothing for it; add no other target.
- **Slice progress itself (`sliceProgress`) is wave 2's.** This branch accepts the value as input and renders it; it does not compute it.
- **No unattended lift.** `plot-plan-state.sh`, `plot-plan-state.mjs` and `plot-issue-status.sh` read no `PLOT_UNATTENDED`; do not add one.
- Carried-over invariants: absent is not false (a missing record means keep the existing lines, not render none); read the exit code, not the emptiness; the Jira connector answers `unaskable`/`no-target` today, leave it so.
- Open question left open: the revert ticket record (#2904). The renderer reads a revert ticket only once #2904 names its record.

### Done when

The plan's `## Changelog` list is the specification for the whole plan; this branch owns the renderer, the record reads and the level-triggered locked write. Assertions that exist because a naive implementation would pass without them:

- Body with no progress and no tickets equals today's body byte for byte — catches a renderer that adds a trailing newline or reorders the marker.
- A Delivered and a Released write keep the progress line and the ticket links — catches the renderer being called with phase-only arguments.
- A write on a machine with no ticket record keeps the comment's existing ticket lines — catches reading "no record" as "no tickets".
- Two concurrent writers on an issue with no marked comment leave one comment — catches a lock around the post only.
- A second identical write issues no host call — catches a hash compared after the write.
- `packages/domain` coverage stays at 100 %.

Plus: add a changeset (description first, `bumps:` block last; `plan:` line inside the block). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: if you touch a `.sh` file, remove shell elsewhere in the same change or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;` or `&&` does not pay. It stores no number and has no override. Layering: the controller calls the domain, the domain owns the port, only an adapter reaches `plot-host.sh`; the new rule imports `zod` at most. New functions are arrows. TSDoc states what an export does, not its history. Do not commit a rebuilt `board-server.mjs`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/plan-issue-comment.ts` (new), `packages/domain/src/adapters/tracker/tracker-plan-state.ts`, `packages/domain/src/ports/tracker.ts` (`PlanStateWrite` and its text), `packages/board/src/server/entry/plan-state.ts`, and their tests. It does not touch `rules/deliverable.ts` or `approve.ts` (waves 2 and 3), or `tracker-jira.ts`. Plans #2903 (`feature/an-unfixed-high-is-ticketed`) and #2904 own the ticket records; do not write them here, and expect them to read the renderer's input type.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
