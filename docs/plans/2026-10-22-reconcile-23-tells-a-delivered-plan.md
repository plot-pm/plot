# Reconcile §23 tells a Delivered plan to release when no released status is configured

> Section 23 of `plot-reconcile-scan.sh` prints "release the plan to close it through the tracker" for every non-Released plan with an open issue, including when the project declares no `Tracker released status`.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2326
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2335 merged
- **Started:** 2026-10-22, Jan Wloka, `bug/reconcile-23-tells-a-delivered-plan`
- **Delivered:** 2026-10-22

## Changelog

- `/plot-reconcile` section 23 no longer tells a Delivered plan on a Jira tracker to release when the project declares no `Tracker released status`. For that plan it names the cause: no released status is configured, so a release does not move the Jira issue. On a GitHub tracker a release closes the issue, so a Delivered plan there keeps the release hint.

<!-- Board impact: none. The change touches one reconcile scan section and its printed text. The plan format, the template and the docs/plans layout stay as they are. -->

## Motivation

On ewz-kus-portal (main `da789acff`, read-only field test round 7, after #2283), section 23 prints `decide: release the plan to close it through the tracker, close it by hand, or record why it stays open` for two Delivered plans: `ewzkus-3874-zevvy-odata-adapter` and `ewzkus-3878-contractpast-nachladen`. ewz declares no `Tracker released status`, so a release does not move the issue. The hint offers a repair that cannot work.

`plot-reconcile-scan.sh` (lines 3138-3139 at the time of the report) branches on the phase first: `[ "$oi_phase" != released ]` prints the release hint without reading `oi_released_status`. Only the Released arm below it checks that variable. #2283 fixed the Released arm and left this one.

## Design

### Approach

The condition follows how the tracker records a release, not the key alone:

- **Jira:** a Jira issue receives only a status word (`tracker-jira.ts:279`), so with no `Tracker released status` a release does not move it.
- **GitHub:** `githubPlanStateWrite` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:78`) adds `issue-close` for the `released` phase and never reads `Tracker released status`, so a release closes the issue.

In the non-Released arm, print the new cause only when `oi_scheme` is `jira` and `oi_released_status` is empty (the section reads `oi_scheme` already, `plot-reconcile-scan.sh:3149`): no `Tracker released status` is configured, so releasing the plan would not move the Jira issue — close it by hand, or record why it stays open. Every other case keeps the current release hint, including a GitHub tracker with no key.

The existing guard test `test/reconcile/scan.test.mjs:4551-4564` (GitHub host stub, no key, asserts the release hint, comment "DELIVERED KEEPS TODAY'S HINT") stays unchanged. The sibling plan `2026-10-21-reconcile-23-tells-a-released-plan.md:38` made that choice for GitHub on purpose. The section's header comment names the new Jira case.

### Open Questions

- [x] Should the two arms share one helper for the "no released status" wording, or keep two literal strings next to each other as they are today? Resolved in `bug/reconcile-23-tells-a-delivered-plan`: one arm, with `oi_again` carrying the one word (`again` for Released, empty for Delivered) that differs — the net-zero route the shell gate requires.

## Slices

### Hint

- `bug/reconcile-23-tells-a-delivered-plan` — non-Released arm of section 23 reads `oi_released_status`; a Jira-scheme fixture in `test/reconcile/scan.test.mjs` covers a Delivered plan with and without the key; the GitHub guard test at `:4551-4564` stays as it is → #2342

## Notes

- Sibling plan: `2026-10-21-reconcile-23-tells-a-released-plan.md` (#2283) fixed the Released arm.
- Definition of Done: docs/definition-of-done.md
