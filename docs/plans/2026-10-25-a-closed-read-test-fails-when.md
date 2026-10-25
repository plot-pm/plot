# A closed-read test fails when its temp directory name contains u8

> `the-closed-read-keeps-and-backs-off.test.ts` asserts that the `/api/fleet` payload does not contain the substring `u8`, and the payload also holds a random temp path that can contain `u8`.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2674
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-25, Jan Wloka, plan-PR #2675 merged
- **Started:** 2026-10-25, Jan Wloka, `bug/a-closed-read-test-fails-when`

## Changelog

- No user-facing change. The closed-read board test no longer fails when its random fixture directory name contains `u8`.

<!-- Board impact: none. Test-only change in packages/board/test/unit. -->

## Motivation

`packages/board/test/unit/the-closed-read-keeps-and-backs-off.test.ts:357` asserts `expect(fleet).not.toContain('u8')`. `u8` is the URL of the closed row the test seeds at `:352`. The serialised `/api/fleet` payload also holds `registry.directory`, a path under the directory that `fs.mkdtempSync(... 'plot-closed-read-')` creates at `:66`. The six random characters of that name can contain `u8`, and the assertion then fails with no closed row in the payload.

CI run 40151459641 on plan PR #2670 (docs only) failed `board-integration` with `"registry":{"directory":"/tmp/plot-run.z6o1uF/plot-closed-read-u8NJjd/.plot/agents", …}` and `"issues":[]`. `validate` failed only because `board-integration` failed.

A random six-character suffix contains a given two-character substring in about 5 positions out of 62², so the test fails roughly once in 770 runs.

## Design

### Approach

Assert on the fields that would carry a closed row, not on the whole serialised payload. Either of two shapes meets this:

1. Parse the `buildFleet` result and check the issue and waiting fields for the closed row's title and URL.
2. Seed a closed-row URL that no temp path can contain, for example `https://example.invalid/closed-row-8`, and keep the whole-payload assertion.

Option 2 is the smaller diff and keeps the whole-payload guard, which also catches a closed row leaking into a field the test does not name. Option 1 states the intent more directly. The implementation picks one. The `closed eight` title assertion stays as is.

The same file's other substring assertions get the same check: any `not.toContain` against a short token on the whole payload has the same failure mode.

### Open Questions

- [ ] Should the fix cover the other board tests that assert `not.toContain` on a whole payload built from a `mkdtemp` fixture? The implementation greps for them and fixes those in the same slice if the count is small, otherwise it files a follow-up.

## Slices

### Make the assertion independent of the temp path

- `bug/a-closed-read-test-fails-when` — replace the `u8` URL with one no temp path can contain, or assert on the issue and waiting fields only

## Notes

- Source: https://github.com/plot-pm/plot/issues/2674. Created from the tracker issue; nothing is written back to the tracker.
