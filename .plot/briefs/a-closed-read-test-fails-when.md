## Implementation brief — a-closed-read-test-fails-when

- **Plan (canonical):** docs/plans/2026-10-25-a-closed-read-test-fails-when.md on main
- **Approved:** 2026-10-25, Jan Wloka, plan-PR #2675 merged
- **Branch:** `bug/a-closed-read-test-fails-when` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (plot-review app, required on main)

One slice, one branch. Nothing waits on it and it waits on nothing.

### What to build

`packages/board/test/unit/the-closed-read-keeps-and-backs-off.test.ts:357` asserts `expect(fleet).not.toContain('u8')` on the whole serialised `/api/fleet` payload. `u8` is the URL of the closed row seeded at `:352`. The payload also holds `registry.directory`, a path under the `mkdtempSync(... 'plot-closed-read-')` directory created at `:66`. The six random suffix characters contain `u8` in about 1 run in 770, and the assertion then fails with no closed row in the payload. CI run 40151459641 failed `board-integration` this way on docs-only PR #2670: `"registry":{"directory":"/tmp/plot-run.z6o1uF/plot-closed-read-u8NJjd/.plot/agents"…}` with `"issues":[]`.

The plan is canonical; this brief is orientation.

### Settled decisions

**Seed a URL no temp path can contain, and keep the whole-payload assertion.** Change the closed row's `url: 'u8'` to `https://example.invalid/closed-row-8` and assert on that string. This is the plan's option 2. The whole-payload guard stays because it also catches a closed row leaking into a field the test does not name; parsing and checking named fields (option 1) would lose that. `mkdtemp` suffixes are `[A-Za-z0-9]{6}` and the prefix is fixed, so a string with `:`, `/` and `.invalid` cannot occur in the suffix.

**The title assertion `closed eight` stays unchanged.** It is not a short token and no temp path contains a space.

**Scope of the sweep is measured: one site.** `grep -rn "not.toContain(" packages/board/test` finds four hits. Three assert on arrays or a single field (`worker-log.test.ts:212`, `unplanned-issues.test.ts:45`, `board-reads-the-issue-index.test.ts:106`) and none runs against a whole payload built from a `mkdtemp` path. The plan's open question therefore resolves to "fix this one, file no follow-up". Re-run the grep and say so in the PR body.

### Done when

The plan has no `## Done when` list; its Slice line is the specification. Add this check, which a naive fix would pass without: the seeded row's URL must appear in the fixture, so the assertion can fail. Mutate to prove it — temporarily make the closed row leak into the payload and confirm `not.toContain` on the new URL fails — then restore from git.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI. Test-only change: no changeset is needed unless `scripts/check-changeset-packages.sh` demands one; no bundle is committed (`scripts/check-no-bundle-diff.sh`). The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not in play.

Any function you write is an arrow. Never run board tests while the operator's board is open on this machine; `test:board` runs in a private `TMPDIR`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to the branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owns: `packages/board/test/unit/the-closed-read-keeps-and-backs-off.test.ts`. No other branch of this plan exists. If another test shows the same failure mode, report it rather than widening the slice.
