# Reconcile §23 tells a Delivered plan to release when no released status is configured

> Section 23 of `plot-reconcile-scan.sh` prints "release the plan to close it through the tracker" for every non-Released plan with an open issue, including when the project declares no `Tracker released status`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2326
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-reconcile` section 23 no longer tells a Delivered plan to release when the project declares no `Tracker released status`. For that plan it names the cause: no released status is configured, so a release does not move the issue.

<!-- Board impact: none. The change touches one reconcile scan section and its printed text. The plan format, the template and the docs/plans layout stay as they are. -->

## Motivation

On ewz-kus-portal (main `da789acff`, read-only field test round 7, after #2283), section 23 prints `decide: release the plan to close it through the tracker, close it by hand, or record why it stays open` for two Delivered plans: `ewzkus-3874-zevvy-odata-adapter` and `ewzkus-3878-contractpast-nachladen`. ewz declares no `Tracker released status`, so a release does not move the issue. The hint offers a repair that cannot work.

`plot-reconcile-scan.sh` (lines 3138-3139 at the time of the report) branches on the phase first: `[ "$oi_phase" != released ]` prints the release hint without reading `oi_released_status`. Only the Released arm below it checks that variable. #2283 fixed the Released arm and left this one.

## Design

### Approach

Check `oi_released_status` in the non-Released arm. When it is empty, print the same cause the Released arm prints, worded for a plan that has not yet been released: no `Tracker released status` is configured, so releasing the plan would not move the issue — close it by hand, or record why it stays open. When it is set, keep the current release hint.

Both arms then name the missing configuration when `Tracker released status` is empty.

### Open Questions

- [ ] Should the two arms share one helper for the "no released status" wording, or keep two literal strings next to each other as they are today?

## Slices

### Hint

- `bug/reconcile-23-tells-a-delivered-plan` — non-Released arm of section 23 reads `oi_released_status`; a test in `test/reconcile/scan.test.mjs` covers a Delivered plan with and without the key

## Notes

- Sibling plan: `2026-10-21-reconcile-23-tells-a-released-plan.md` (#2283) fixed the Released arm.
- Definition of Done: docs/definition-of-done.md
