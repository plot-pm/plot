## Implementation brief — bitbucket-parity-and-app-identities (wave 1: Wave 1)

- **Plan (canonical):** docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md on main
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1861 merged
- **Branch:** `bug/merge-names-what-it-did` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR, per the plan's `Review: pr` answer

This branch is Wave 1 of a single-wave plan — the other four branches
(`bug/bitbucket-pages-read-complete`, `feature/bitbucket-commit-status-parity`,
`bug/writer-app-push-uses-only-the-app`, `bug/app-identities-refuse-by-name`)
run concurrently, not after this one. Nothing here blocks or is blocked by
them, but two slices (4 and 5) touch neighbours of the same two files this
slice does not touch — see Scope guard.

### What to build

Closes issues #1533 and #1556 — both live findings against `main` at
`c40ac9e96`, confirmed still open when this plan was triaged:

1. **An uppercase sha passes validation and then refuses for the wrong
   reason.** `packages/board/src/server/entry/main.ts:148` validates the sha
   with `/^[0-9a-f]{40}$/i` — case-insensitive, so `ABCD…` passes. It is
   handed unchanged to `mergeAt` (`main.ts:39`), which calls the domain's
   `merge()` in `packages/domain/src/workflows/merge.ts`. There, line 96
   compares `input.sha !== pr.headSha` — case-sensitive, against a lowercase
   `headSha` the host adapter returns — so an uppercase sha that names the
   *same* commit the host sees refuses as `'head-moved'`
   (`merge.ts:96`: *"the head of PR #N is `<headSha>`; the caller read
   `<sha>`. Re-read the checks for the new head."*). That message is false:
   the head did not move: the caller typed it in a different case. Fix by
   lowercasing the sha before the compare — at the CLI boundary
   (`main.ts`) or inside `merge()` itself, whichever keeps the domain the
   single place that owns the comparison per the Layering Rule.

2. **The `unaskable` detail text claims something the code does not check.**
   `packages/board/src/server/entry/merge.ts:30` (TSDoc) and the `unaskable`
   branches in `packages/domain/src/workflows/merge.ts:87,93,107` say *"Absent
   is not green"* — but the actual failure here is a **failed read**
   (`lookup.ok` or `reading.ok` is `false`), not an **absent** reading (a
   lookup that succeeded and returned nothing). Those are different facts:
   an absent PR state is a host that answered "I don't have one"; a failed
   read is a host that could not be asked at all. The plan's correction is
   literal: change the message to *"A failed read is not an absent
   reading."* Apply it everywhere this detail string is built in
   `merge.ts`, not just once — grep for `unaskable` in both files.

3. **The domain TSDoc at `merge.ts:70-73` (board package) names adapter
   facts.** `@param pr` currently says `plot-host.sh` sets `checksSha` to
   `headRefOid` — that is an implementation detail of one adapter, not a
   domain-level contract. Per **The Layering Rule** (CLAUDE.md) — *"the
   domain owns the port… it does not import an adapter"* — rewrite this
   TSDoc to say only what the *port* promises (a PR's `checksSha` and
   `headSha` fields exist and mean X), and drop the script/adapter name.

4. **The merge answer does not say when a merge went through unpinned.**
   `main.ts:18-20`'s `MergeResult` success variant is
   `{ merged: true; pr; sha; defaultBranchRead }` — there is no field
   recording whether `canPinMerge` (`host-pin.ts`) returned `false` for this
   merge. On Bitbucket, `hostPinsMerges('bitbucket')` is always `false`
   (`host-pin.ts:11`), so `main.ts:57` runs the merge with no
   `--match-head` and the JSON answer looks identical to a pinned merge.
   Add an `unpinned: boolean` (or similarly named) field to the success
   variant of `MergeResult`, set it from the same `canPinMerge` call
   `main.ts:57` already makes, and have the CLI output surface it in the
   JSON line. This is a type change, not a new mechanism — `canPinMerge`
   already exists and already answers the question; nothing new is computed,
   the answer is just currently discarded after deciding whether to pass
   `--match-head`.

5. **The controller-gate refusal text does not name Bitbucket.**
   `packages/domain/src/rules/controller-gate.ts:177-185`
   (`unpinnedMergeRefusal`) is generic: it tells the caller to use the
   controller or add the pin flag, but never says *why* an unpinned
   Bitbucket merge is different — that `gh` is a GitHub CLI and has no
   command for a Bitbucket repository at all, so the person with
   `gh pr merge --match-head-commit` still red in their shell history has
   no path forward on this host without reading further. Add one line
   naming that: on a Bitbucket repo, `gh` is not the tool — the merge goes
   through `plot-host.sh pr-merge`, unpinned, because Bitbucket's API gives
   no way to pin. `UNPINNABLE_NOTE` (`controller-gate.ts:199-200`) already
   carries half this fact for the allowed-unpinned path; this is the
   refused-path's turn to say it.

6. **`skills/plot-sprint/SKILL_new.md` is a stray stale copy, not a
   second file with a purpose.** Confirmed via `git log --follow`: it is
   the `plot-sprint` `SKILL.md` frozen at v1.3.0 (current is v1.5.2) —
   `diff skills/plot-sprint/SKILL.md skills/plot-sprint/SKILL_new.md` shows
   it is missing the `setSprintState` controller rule, the false-positive
   check's current rationale, and the reference-parsing table current
   `SKILL.md` carries. It tracks no distinct purpose. Delete it.

### Decisions already settled — do not re-derive them

**Case-fold at the comparison, not by rejecting uppercase input.** The
obvious alternative — tightening `main.ts:148`'s regex to
`/^[0-9a-f]{40}$/` (reject uppercase outright) — was not what the plan
asked for and would just move the bad UX earlier (a usage error instead of
a wrong refusal reason) without fixing the real defect, which is the
case-sensitive compare downstream. Lowercase before compare; don't narrow
the input.

**This is a correctness fix inside an existing mechanism, not a redesign.**
`canPinMerge`/`hostPinsMerges` (`host-pin.ts`) already exists and is
already called at the right place (`main.ts:57`); item 4 above only wires
its existing answer into the output type. Do not invent a second way to
ask whether a host pins merges.

**`merge()`'s refusal reasons are a closed union** (`MergeRefusal` in
`merge.ts:9-15`: `'unaskable' | 'head-moved' | 'checks-unbound' | …`).
Fixing the uppercase-sha bug must not produce a new refusal kind for "sha
case mismatch" — a same-commit uppercase sha should merge successfully,
not refuse under a different, more honest name. The fix is that it stops
refusing at all for that input, not that it refuses more precisely.

### Done when

The plan's `## Done when` is implicit in its changelog line for this
slice: *"The board-free merge names the right refusal reason for an
uppercase sha and says when a merge was not pinned."* Concretely:

- A merge attempt with the PR's head sha typed in uppercase succeeds (does
  not refuse as `head-moved`) when the host's head matches case-insensitively.
- The `unaskable` detail string reads "A failed read is not an absent
  reading" everywhere it appears in `merge.ts`, not just in one branch —
  a test that asserts only the first occurrence would pass while the
  TSDoc or a second branch still says the old text.
- `merge.ts`'s domain-port TSDoc (board package, lines ~70-73) names no
  script or adapter.
- The merge JSON answer carries a field saying whether this merge was
  unpinned, and it is `true` specifically on a Bitbucket-backed merge
  (`canPinMerge` returning `false`), not just present-and-always-false.
- `controller-gate.ts`'s unpinned-merge refusal text states that `gh` has
  no place on a Bitbucket repository.
- `skills/plot-sprint/SKILL_new.md` no longer exists, and `SKILL.md` is
  unaffected.
- Add or extend the unit test for `merge.ts`'s domain workflow with a
  same-commit-different-case case — this is the test a naive fix (e.g.
  lowercasing only at the CLI boundary but not in a second caller of
  `merge()`) would still fail, catching regressions at the layer that
  actually owns the comparison.

Plus the repo's standing gates: run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — the related `vitest` and `tsc` for
`packages/domain` and `packages/board` will cover the files this slice
touches. The suites in the `CI suites` config key (`pnpm run test:e2e`,
`test:contracts`, `test:board`, domain coverage, `test/reconcile`) run in
CI on every PR; do not run them locally as a matter of course — a failure
there comes back as a correction.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh`'s
shell-growth ratchet does not apply here.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — the controller resolves the plan, title and
body from this branch's entry in the plan automatically. When the PR is
created, append `→ #<number>` to this branch's line in the plan's
`## Slices` → `### Wave 1` section. Push the first real commit as soon as
it exists — this slice runs as part of a 5-branch wave and a late push
reads as unstarted on the fleet pulse.

### Scope guard

This branch owns:

- `packages/board/src/server/entry/merge.ts` and `main.ts` (the merge CLI
  path and `MergeResult` type)
- `packages/domain/src/workflows/merge.ts` (the `merge()` rule, its
  refusal reasons and messages)
- `packages/domain/src/rules/controller-gate.ts` (the unpinned-merge
  refusal text only — do not touch the rest of the gate)
- `skills/plot-sprint/SKILL_new.md` (deletion)

**Do not touch**, even though they are nearby: `packages/board/src/server/entry/host-pin.ts`
(read `canPinMerge` from here, don't edit it — it already does what this
slice needs) and anything under `skills/plot-sprint/` besides the stray
file.

Other Wave-1 branches hold, per the plan and verified against the current
`main` tree:

- `bug/bitbucket-pages-read-complete` — `plot-host.sh` and
  `packages/domain/src/adapters/host/listing-paging.ts` (paging rule only)
- `feature/bitbucket-commit-status-parity` — `plot-host.sh`'s
  `STATE_MAP`/`_bb_wr` parsing and `skills/plot/scripts/README.md`'s
  `commit-status` row
- `bug/writer-app-push-uses-only-the-app` — `plot-push-writer-app.mjs`,
  `plot-merger-token.mjs`, `plot-push-main.sh`, `pushmain.test.mjs`
- `bug/app-identities-refuse-by-name` — `plot-github-app.mjs`,
  `plot-commit-status.mjs`, `plot-host.sh` (repo-lookup naming only),
  `docs/review-status-rollout.md`, `approve*.test.mjs`

None of those overlap this slice's files. The plan's own Notes flag that
slices 4 and 5 may collide with each other (both touch
`plot-push-writer-app.mjs`/`plot-github-app.mjs` neighbours) — that is not
this branch's concern; `/plot-reslice` owns it if it happens.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
