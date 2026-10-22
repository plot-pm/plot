# Delivery reads the delivered plan and survives concurrent pushes

> A delivery reads plans from the ref it pushed to, at a path that survives a non-canonical repo root, and lifecycle writes to the default branch queue instead of rejecting each other.

## Status

- **State:** Released
- **Type:** bug
- **Issue:** #1838
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1971 merged
- **Started:** 2026-10-17, Jan Wloka, `bug/deliver-ref-read-canonical-path`
- **Started:** 2026-10-18, Jan Wloka, `bug/default-branch-writes-take-turns`
- **Delivered:** 2026-10-18
- **Released:** 2026-10-22, v2.28.0

## Changelog

- The delivery-landed gate in `/plot-deliver` reads the plan from `origin/<default>`, so a plan delivered by the push that just landed no longer reports `merged_not_delivered`.
- Lifecycle writes to the default branch (`release`, `approve`, `deliver`) take turns, so a caller that starts several together gets all of them landed instead of `push=rejected`.
- `POST /api/deliver` finds an `active/` plan at the pulse ref when the repo root is not canonical.

<!-- Board impact: the deliver route and the write queue change board server code; main rebuilds the shipped bundles after each merge. No change to the plan format, the plan template or the docs/plans layout. -->

## Motivation

Tracking issue #1838 groups three open issues from a triage against main at c40ac9e96 (2026-10-16). Each one is a delivery path that reads or writes the default branch at the wrong moment.

- **#1340** — `plot-deliver.sh` pushes through `plot-push-main.sh` and leaves the local checkout one commit behind. `plot-reconcile-scan.sh` runs `git fetch` (`:323`) and then reads plans from the working tree, so the first gate run after a delivery sees the pre-delivery plan and prints `merged_not_delivered=1`. Observed twice on 2026-10-06 (Bitbucket, default branch `develop`). `skills/plot-deliver/SKILL.md:487` states the opposite.
- **#1349** — `/api/release` and `/api/approve` start their scripts in the background and return at once. Measured 2026-10-07: `/api/release` for 4 plans ended 4 of 4 `push=rejected`; `/api/approve` for 6 plans ended 3 `push=rejected`, 1 `bypassed`, 1 `micro-pr`, 1 refused. A sequential re-run landed all of them.
- **#1355** — `phaseAtRef` (`packages/board/src/deliver.ts:223`) builds the ref path with `path.relative(opts.repoRoot, file)`, while `file` is a `realpathSync` result. With a non-canonical root (macOS `os.tmpdir()`), the path starts `../../private/var/...`, `git show origin/main:<path>` fails and the phase falls back to the working tree. No test sends an `active/` symlink together with a `read_ref`. Review findings on #1350 also list two LOW items: `pulseNaming` and `planBody` in `deliver-route.test.ts` are `function` declarations, and the changeset description is hard-wrapped over 6 lines.

## Design

### Approach

Three independent fixes, one slice each. Each is a bug fix with a reproducing test first.

1. **#1355, the ref path.** Build the path as `path.join(planDir, path.basename(file))`, or take `path.relative` against `realpathSync(repoRoot)` as `board.ts:446` does. Add the combined test (active symlink + `read_ref`, repo under a symlinked temp root). Convert `pulseNaming` and `planBody` to arrows and unwrap the changeset description.
2. **#1340, the scan source.** Pick one of the three fixes the issue names: the scan reads plan files from `origin/<default>` with `git show` (same source as its merged-PR checks); `plot-deliver.sh` fast-forwards the local default branch after a clean push; or step 7b runs `git pull --ff-only` first. The first is the only one that does not depend on the checkout being on the default branch. Correct `SKILL.md:487` whichever is chosen. Test: deliver on a checkout on the default branch, run the scan without pulling, and assert the plan is absent above the blocking-sections marker.
3. **#1349, the write queue.** Serialise default-branch writes with a lock the push step (`plot-push-main.sh`) takes, so every caller is covered, including a no-board `plot-deliver.mjs` call. A second write waits up to 120 s. A waiter past the bound refuses and names the holder's pid and action.

### Open Questions

- [x] #1340: which of the three fixes? Option (a), the `origin/<default>` ref read, because it is the only one that does not depend on the checkout sitting on the default branch. The read only runs for plans already in the Approved phase (section 2's existing guard), not every plan in `docs/plans/`; measured 2026-10-18 on this repo (3 Approved plans), 20 iterations of `git show origin/main:<path>` piped through `plot-plan-meta.sh` and `jq` cost 1.16 s combined user+sys CPU, ~58 ms per call. Against the scan's own measured `--offline` cost of 279.9 s (`SKILL.md:501`), the added cost at this repo's current Approved count (well under 1 s total) is negligible.
- [x] #1349: queue in the board routes or lock in `plot-push-main.sh`? What is the wait bound, and what does a waiter report when the bound passes? Decided 2026-10-17 by Jan Wloka: a lock inside `plot-push-main.sh` covers every caller, the wait bound is 120 s, and a waiter past the bound refuses and names the holder's pid and action, because a queue in the board routes leaves a no-board `plot-deliver.mjs` call racing.
- [x] Do slices 1 and 2 share the ref-read code, so that #1340 reuses the path fix from #1355? No — recorded as parallel, not shared. #1355 fixes `phaseAtRef` in `packages/board/src/server/deliver.ts` (TypeScript, reads one known plan file at a known ref); #1340 is a shell script reading every Approved-phase plan file in `docs/plans/` in one scan pass. Same class of bug (read at a pushed ref, not the working tree), different language and different cardinality — there is no code to literally share across the shell/TypeScript boundary.

## Slices

### Ref path

- `bug/deliver-ref-read-canonical-path` — #1355: canonical path for the ref read, combined test, arrow helpers, unwrapped changeset → #1989

### Scan source

- `bug/scan-reads-plans-at-the-fetched-ref` — #1340: the delivery-landed gate reads the delivered plan, with the test and the `SKILL.md` correction → #2017

### Write queue

- `bug/default-branch-writes-take-turns` — #1349: serialise default-branch lifecycle writes with a lock in `plot-push-main.sh`, a 120 s wait bound and a refusal that names the holder → #2039

## Notes

- Created unattended from #1838. The overlap with `2026-10-01-delivery-reads-the-last-finished-scan` and `2026-10-07-delivery-reads-one-source` (both delivered) is deliberate: #1340 and #1355 are residue of that work.
- Deliverable search found nothing by these names.
- 2026-10-17: open questions decided by Jan Wloka: #1349 takes a lock in `plot-push-main.sh` with a 120 s wait bound and a refusal that names the holder.
