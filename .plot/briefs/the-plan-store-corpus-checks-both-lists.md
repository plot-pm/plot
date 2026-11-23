## Implementation brief — board-readings-take-the-domain-answer (wave 4: Spike corpus)

- **Plan (canonical):** `docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/the-plan-store-corpus-checks-both-lists` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Waves 1 to 3 touch other files (sprint annotation, `AgentRow.planState`, the spike card). This wave reads none of what they build, so it does not wait on them.

### What to build

`packages/domain/corpus/plan-store.corpus.test.ts` is meant to fail when the wire and the port disagree about a plan's fields. It does not compare a key that sits on both `FIELDS` and `KNOWN_UNCARRIED`, because its only list check (`:285`) fails a wire key on neither list. Measured on `origin/main` `b21961602`: `spike_approved_raw` is on `KNOWN_UNCARRIED` (`:80`) with the comment *"no PlanStore reader decides on it"*, while `planOf` maps it to `spikeApprovedRaw` (`plan-store-shell.ts:175`) and `sliceReadingsOf` decides on it (`rules/slice-readings.ts:26`). `design_raw` and `verified_raw` are in the same state: `planOf` maps both (`designRaw`, `verifiedRaw`) and the corpus never compares them. This is issue #3122's corpus item.

The fix makes the adapter's own behaviour the source of the key list. The test calls `planOf` on a `Proxy` whose `get` records each property name read and answers `undefined`. The recorded set is the wire keys the adapter reads. Three new list checks then hold the lists against it. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The key list comes from the adapter's behaviour, not from a second table.** The `FIELDS` comment (`:33-39`) bans a derived table: a derivation would encode the same snake-to-camel rule as the adapter and agree with it by construction. A recording `Proxy` derives nothing; it observes which keys `planOf` reads. Do not write a regex over `plan-store-shell.ts` and do not build the list from `Object.keys` of a fixture.

**Three keys move to `FIELDS`, and their `KNOWN_UNCARRIED` entries and comments go:** `['spikeApprovedRaw', 'spike_approved_raw']`, `['designRaw', 'design_raw']`, `['verifiedRaw', 'verified_raw']`. Each is a plain string copy, so the existing per-field comparison (`:165`, `:216`) covers it. Check that `PlanRecord` declares all three first; `planOf` already sets them.

**Five keys `planOf` reads do not move, and each needs a reason and its own test on a new named list `COMPARED_APART`:**

- `issues` — numbers on the wire, strings on the port. One test compares `issues.map(String)`.
- `rounds` — present only where the wire carries a number. One test compares presence and value.
- `error` — present only on a parse failure. One test with an unparseable plan fixture.
- `slices` and `waves` — the slice list, already compared through `WIRE_SLICES` (`:101`). `planOf` reads both: `slicesOf` takes `raw.slices` and falls back to `LEGACY_SLICES_KEY = 'waves'` (`plan-store-shell.ts:124`, `:136-140`). With a proxy answering `undefined`, both reads happen. If the proxy records a key the plan does not name, do not silently add it to a list: report it.

**`FIELDS` stays written out.** Do not replace it with a derivation to make the new check shorter.

**Rules carried over, unchanged:**

- On a comparison disagreement the branch stops (*A Shell Script Asks The Domain*, `CLAUDE.md`). Adjusting either side to make the comparison pass is the one move forbidden.
- Absent is not false: `rounds` and `error` are absent keys, not zeros. Test presence, not truthiness.
- A function you write is an arrow, in a test too. Declarations in the diff are a review finding; no gate catches them outside `packages/domain/src/`.

### Done when

The plan's slice-4 bullets are the specification. The three list checks are:

- (a) Every key the proxy records is on `FIELDS` or `COMPARED_APART`. This catches a key `planOf` starts reading that no list names.
- (b) No key is on two of `FIELDS`, `COMPARED_APART` and `KNOWN_UNCARRIED`. This catches the exact defect measured above, a key on both `FIELDS` and `KNOWN_UNCARRIED`, which the old check at `:285` passes.
- (c) Every `KNOWN_UNCARRIED` key is one the proxy did not record. This catches a stale entry for a key `planOf` does read.

Plus a negative proof that each check can fail: run each one once against a deliberately broken list (for example `spike_approved_raw` back on `KNOWN_UNCARRIED`) and confirm it names the key. Do not commit the broken list. A list check that passes with an empty recording is vacuous, so assert the recorded set is non-empty.

Plus the repo gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints before each push. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. The change touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Add one changeset, description first and `bumps:` last; a test-only change takes `'plot': patch`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, write its number into this slice's heading in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns:

- `packages/domain/corpus/plan-store.corpus.test.ts`
- one `.changeset/*.md`

It reads `packages/domain/src/adapters/plan-store/plan-store-shell.ts` and does not edit it. If a key cannot be tested without editing `planOf`, report it.

Other branches of the plan are in flight on other files: `bug/an-approval-with-no-pr-writes-no-pr-key`, `bug/a-delivery-row-carries-its-plan-state` and `bug/the-spike-card-names-its-reason` touch the sprint annotation, `delivery-readings.ts` and the spike card, not this corpus. The last commit on this corpus file is `28627d3db` (the synthetic unread branch item); the corpus fixture there stays as it is.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
