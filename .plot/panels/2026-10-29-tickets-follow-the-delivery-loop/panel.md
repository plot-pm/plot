# Panel moderation: tickets-follow-the-delivery-loop

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: domain `tracker-plan-state`, `issue-status`, `deliverable` (65–109 tests green); esbuild and vitest probes printing `planStateComment` bodies per phase, `issueStatusWrites` and Jira's plan-state answer; safety ran the real `plot-host.sh` against a fake `gh` for the label step and for two concurrent `issue-comment` writers.

## Agreed by all four

1. **One comment, four writers.** The `<!-- plot:plan-link -->` comment is edited in place and rebuilt whole on each write (`plot-host.sh:5745`, `tracker-plan-state.ts:44-47`). This plan, #2903 (ticket line), #2901 (answers list) and #2904 (revert ticket) all write it, and each write erases the others. This plan owns one renderer and the size cut; the siblings write records only. #2901 and #2904 join this plan's Needs.
2. **Every later phase write erases the new lines.** Executed: the Delivered body is exactly two lines, marker and `Plan delivered: <link>`. The five callers (`approve.ts:1174`, `deliver.ts:546,955`, release) pass only phase and link. The renderer reads the records for every phase, inside `entry/plan-state.ts` / `plot-plan-state.mjs`, and the rendering moves from the adapter into one domain function (layering: "every rendered state is a domain property").
3. **The count is a domain rule over the pulse, triggered by the index.** Next to `landedBranches` / `allSlicesMerged` in `rules/deliverable.ts`; not per-branch `plot-pr-merged.sh` (a host call each, and a script called from TypeScript). Trigger on the index's `pr merged` finding (`rules/index-findings.ts:105`), so a person's merge counts and slice 1 no longer waits on #2902. Say whether the total counts slices or branches and whether deferred ones count. New domain rules need full coverage (the package fails below 100 %).
4. **Jira gets two of the three points today, and none of the comment.** `plot-issue-status.sh` is called only from `deliver.ts:531,944`; nothing writes `Tracker approved status` at approve. Jira answers `no-target` to every plan-state write and `unaskable` to a comment (`tracker-jira.ts:293-300`). Slice 3's real job is wiring the approve caller; a per-merge Jira transition is beyond the design and can move a ticket backwards.

## Safety findings the others did not execute

- **A progress write can move a delivered issue backwards.** Executed: `githubPlanStateWrite` re-labels before it comments (`tracker-plan-state.ts:74-78`), and on an issue carrying `plan:delivered` it issued `--add-label plan:approved --remove-label plan:delivered`. Auto-deliver runs detached, so a late progress write for the last slice lands after Delivered. The progress write touches only the comment, and only while the plan reads `approved`.
- **Two concurrent writers on an issue with no marked comment both POST** (`plot-host.sh:5755-5757`), leaving two marked comments. Make the write level-triggered with a hash of the last body written.

## Disagreement for the person

- **Where the records live.** The ticket and answer records under `.plot/state/` exist on one machine, and the tracker port forbids reading the comment back (`ports/tracker.ts:225`). A deliver or release run on another machine rebuilds the comment without them and erases the lists (layering, safety, seams). Layering carries it as an open question; safety asks for "records every machine can read". The options are: accept that one machine (the fleet's) is the source and other machines' writes keep the existing lines untouched; or record them in git, which costs a commit per answer and per ticket.

## Smaller amendments

- Widening `PlanStateWrite` beyond the port's "four facts" (`ports/tracker.ts:219-227`) is a deliverable; name it (layering).
- `plot-issue-status.sh:44-46` reads status words in shell and is not a launcher; move those reads into the bundle before adding a word (layering).
- The plan needs no fleetd caller identity: `plot-plan-state` reads no `PLOT_UNATTENDED` (seams, safety).

## Shared blind spot

All four designed the comment as the place a person looks. None checked whether anyone reads it: the board already shows a plan's slices and PRs, and a comment of 99 truncated answers is a log, not a status. The size cut decides what a reader loses; nobody proposed which entries to keep.
