# A merged release books its plans

> A domain rule names the plans of the newest release that still read Delivered, the Delivery tab shows them as an item for a person, and a "Book as Released" button runs the existing release finish for that version again.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- When a merged release leaves plans at Delivered, the Delivery tab shows an `unbooked` item under You › Unblock that names the version and the plans. Its "Book as Released" button, and `plot-ask.mjs release-finish <version>` with no board, book them and close the release's sprint. Every finish writes its outcome to `.plot/state/release-finish/<version>.json`.

<!-- Board impact: a new Delivery item, a new button and a new route. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

Release PR #3598 (`release: 2.36.0`) merged at 17:24:39 UTC on 2026-11-23 by `app/plot-merger`. Its merge commit `d9d5e9229` carries the tag `v2.36.0`, dated 17:24:37 UTC. The sprint `delivery-ui-polish` names `Release: 2.36.0`. The release finish booked no plan and closed no sprint: `origin/main` holds no `plot: record 2.36.0` commit. On `zio`, which runs the board for this checkout, the desk root holds no `plot-release-approve-3598.log`, so the finish's output is not readable on this machine.

A person repaired it by hand. The commit `1a423e708` closed the sprint at 18:11 UTC. Between 19:17 and 21:01 UTC, 20 commits `plot: release <slug> (v2.36.0)` booked 20 plans one by one: the 9 sprint plans and 11 plans outside the sprint. The release merge removed 74 changesets, and their `plan:` lines name 24 distinct plans.

Reconcile section 6 ("Delivered but already released") found 8 of the 9 sprint plans. It missed `templates-show-named-identifiers` because section 6 skips every plan of Type `docs` or `infra` (`plot-reconcile-scan.sh`, section 6 loop). That plan's slice #3615 is in `v2.36.0`, and a changeset in the release merge names the plan. `releaseFinish` books every type, `docs` and `infra` included, so the two disagree on which plans a release owes.

`finishRelease` (`packages/board/src/server/entry/release-finish.ts`) over `releaseFinish` (`packages/domain/src/workflows/release-finish.ts`) already books every scope plan that has no `Released:` record, closes the sprint, and refuses `already-released` when nothing remains. Running it again is the repair. Three gaps stop a person from doing that: no place shows that a merged release booked nothing, no action runs the finish except `release-approve` with a fresh merge, and the finish reads its scope only from the active sprint index, which is empty once a person closes the sprint by hand.

## Design

### Approach

- **One rule reads the debt.** A new domain rule, `releaseUnbooked(readings)` in `packages/domain/src/rules/release-unbooked.ts`, takes the newest release tag, the sprints, the plans and the changesets the tag's merge removed, all as values. It returns `{ version, plans: slug[], sprintOpen: slug | null }`, or `none` where every scope plan holds its `Released:` record and no sprint naming the version is open. A read that fails answers `unaskable`, never `none`.
- **The scope is every sprint whose `Release:` names the version, active or closed, plus every plan a removed changeset names.** Two sprints name `Release: 2.36.0` today: `triggers-and-connectors` (closed 2026-11-15) and `delivery-ui-polish`. Struck items stay out, as in `releaseFinish`. Only a plan that reads Delivered counts as unbooked; a plan in any other phase is named in a note and not counted, as `releaseFinish` does now. The tag's commit is the release merge, so the changesets come from `git diff <tag>^1 <tag> -- .changeset`, a local read with no host call.
- **The merge-commit test is not enough.** Section 6 asks which tag contains a plan's PR merge. A plan with no PR annotation, and every `docs` or `infra` plan, falls outside that test. The changeset and the sprint name the plans the release owes, whatever the plan's type.
- **fleetd computes it and books nothing.** The release tick (`packages/fleet/src/shared/release-tick.ts`) asks `releaseUnbooked` each pass from local git readings and publishes the answer on the channel as `release unbooked`. It persists no file: the answer is a verdict that git re-derives for free ("Answers, never verdicts"). The rule's caller check stays: `releaseFinish` refuses `unattended` for `fleetd` and every unattended caller.
- **The finish takes a version and accepts a closed sprint.** `releaseFinish` reads its scope through the same scope function as `releaseUnbooked`, so both name the same plans. `release-scope-mismatch` keeps its meaning for an active sprint that names another version. A closed sprint is left closed. `finishRelease` gains a version entry that resolves the merge commit from the tag; the PR entry that `release-approve` uses stays.
- **The Delivery tab shows the debt.** A new You › Unblock reason `unbooked` places one item per unbooked release. Its row reads `unbooked · 2.36.0 · <n> plans`, names the plans, and carries a "Book as Released" button. The placement and the row text are domain properties (`delivery-placement.ts`, `delivery-row-form.ts`).
- **The button runs a controller.** `POST /api/release-finish {"version":"2.36.0"}` runs the version entry in the board's process. The controller gate refuses it from a shell with no receipt escape, as it refuses `POST /api/release`. `plot-ask.mjs release-finish <version>` runs it with no board and refuses under `PLOT_UNATTENDED=1` before it reads anything.
- **No passkey proof.** The passkey binds a merge that cannot be undone to a person. Here the merge is done, and the finish writes only plan records and a sprint close in one revertible commit, as `plot-deliver.mjs --release` already does per plan with a state receipt and no passkey. `releaseFinish` refuses `unattended` and `fleetd`, the gate refuses an agent's HTTP call, and the command refuses `PLOT_UNATTENDED=1`.
- **Every finish leaves a record.** `finishRelease` writes `.plot/state/release-finish/<version>.json` in the state home (`stateHomeFor`) for every outcome: `{ version, at, caller, outcome: 'booked' | 'refused', reason, booked, notes, sprintClosed }`. The desk-root log stays for the run's progress. The `unbooked` row reads the record and shows the last refusal's reason, for example `last finish: sprint-ambiguous`.

### Open Questions

- [ ] `[question-newest-tag-only]` The rule reads only the newest release tag. A plan of an older release that is still Delivered stays invisible. Recommendation: newest tag only; reconcile section 6 still reports older releases.
- [ ] `[question-board-reads-without-fleet]` With no fleetd running, the board gets no `release unbooked` event. Recommendation: the board asks `releaseUnbooked` itself from the same local readings when no fleetd heartbeat is live, as it already does for the PR reader.
- [ ] `[question-two-active-sprints]` `releaseFinish` refuses `sprint-ambiguous` when the active index holds two sprints. With a closed sprint in scope, the refusal applies only to active sprints that name this version. Recommendation: refuse where two open sprints name the version, and ignore an active sprint that names another version.
- [ ] `[question-why-the-finish-booked-nothing]` The 2.36.0 finish output is lost, so the cause is unknown. Recommendation: do not guess it here; the record in slice 3 makes the next occurrence readable.

## Slices

### Reading

- `bug/the-release-reading-names-unbooked-plans` — `releaseUnbooked` and the shared release scope, read by `releaseFinish` and published by fleetd's release tick <!-- builds: releaseUnbooked, the unbooked-release rule --> <!-- tests: releaseUnbooked over the 2.36.0 fixture — two sprints name the version, a docs-type plan named only by a changeset counts as unbooked, a fully booked release answers none, a failed read answers unaskable; releaseFinish books a closed sprint's scope and refuses release-scope-mismatch only for an active sprint naming another version -->

### Repair

- `bug/a-person-books-a-merged-release` — the `unbooked` Delivery reason and row, the "Book as Released" button, `POST /api/release-finish`, `plot-ask.mjs release-finish <version>`, and the controller gate's refusal of the HTTP call from a shell <!-- waits: bug/the-release-reading-names-unbooked-plans --> <!-- builds: the release-finish controller and its board button --> <!-- tests: placement puts an unbooked release under You › Unblock with reason unbooked; the route books a closed sprint's plans and answers already-released on a second call; the command refuses PLOT_UNATTENDED=1; the gate refuses curl POST /api/release-finish -->

### Record

- `bug/the-release-finish-leaves-a-record` — `finishRelease` writes `.plot/state/release-finish/<version>.json` on every outcome, and the `unbooked` row names the last refusal <!-- waits: bug/a-person-books-a-merged-release --> <!-- builds: the release-finish record file and its reader --> <!-- tests: a refused finish writes outcome refused with its reason; a booked finish writes the booked slugs; the row shows last finish: <reason> -->

### Reconcile

- `bug/reconcile-counts-unbooked-docs-plans` — section 6 asks `releaseUnbooked` through a bundle and reports a `docs` or `infra` plan that the newest release scope names and that still reads Delivered <!-- waits: bug/the-release-reading-names-unbooked-plans --> <!-- builds: section 6's release-scope arm --> <!-- tests: a docs-type plan named by a removed changeset of the newest tag is reported; a docs-type plan named by no release stays silent -->

## Notes

Created on 2026-11-24 after the 2.36.0 release booked no plan; the operator asked for the repair path.
