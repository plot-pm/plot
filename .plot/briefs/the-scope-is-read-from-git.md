## Implementation brief — fleetd-reviews-every-slice-pr-in (wave 3: Sprint scope)

- **Plan (canonical):** [docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md](../../docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md) on `main`
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2917 merged
- **Branch:** `feature/the-scope-is-read-from-git` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status on the PR (required on `main` since 2026-10-15)

Wave 1 (`feature/a-review-opens-no-issue`, PR #2928) and wave 2
(`feature/the-index-records-the-review`, PR #2939) are both merged. This wave
does not depend on either wave's code — it is independent work on the sprint
scope reader. One wave waits on it: `feature/fleetd-reviews-slice-prs` reads
`sprintScope`'s answer as the `scope` field of its `SlicePrReadings` input
(plan line 103) and the guard arm's `scope.branches` membership test (plan
line 127).

### What to build

Today nothing in `packages/fleet` or `packages/domain` knows which PRs fleetd
is allowed to review or merge. `plot-sprint-release.sh` answers a *related*
but different question — a sprint's own release readiness, read from the
working tree — and nothing reads the active sprint to produce a branch
allowlist. Build `sprintScope(input)` in the domain: a pure function that
answers `{ read: 'scope', sprint, slugs, branches }` or `{ read: 'none', why
}`, reading the active sprint file's **text as git has it on
`origin/<default>`**, not the working tree. An adapter supplies that text. The
scope is what step 1 of `slicePrNext`'s composition order (plan line 127)
filters every PR against before any other arm runs — a PR on a branch not in
`scope.branches` gets `none` and nothing reviews or merges it.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The scope moves with a person's commit, never with a state file** (D3,
plan line 152). `sprintScope` is re-derived on every read from
`refs/remotes/origin/<default>` as fleetd's last fetch left it — there is no
cached scope anywhere, and this slice writes no state file for it. A `sprint:
scope change` commit on the default branch is the only thing that moves what
fleetd will review; editing a person's local checkout does nothing until it
lands there.

**Read via `Refs.showFile`, never the working tree.** `showFile(ref, path)`
(`packages/domain/src/ports/refs.ts:452`) reads a file's content at a ref
without checking it out — this is the one call the adapter needs for the
sprint file itself. Resolve which file to read with `Refs.listBlobs(ref,
dir)` (`refs.ts:384`) over the `Sprint directory` config's `active/` subdirectory
(`docs/sprints/active/`, per this repo's `## Plot Config` — read the key,
never hardcode the path) — do not `git show <ref>:<dir>` and parse a tree
listing by hand; `listBlobs` already returns the paths. **Zero or two+ blobs
under `active/` is itself the `none` case** (`why: 'no-active-sprint'` /
`'multiple-active-sprints'`), mirroring the shell rule at
`plot-sprint-release.sh:4-5,179` — this is the one place in the codebase that
rule exists today, and this slice is porting it into the domain, not
inventing a new threshold.

**`sprintFrom` moves into the domain, beside `sprintMembers`.** It lives
today at `packages/board/src/server/entry/sprint-transition.ts:162`, takes
`(content: string, slug: string)` and returns a `Sprint` with `state` carried
through UNPARSED (the board file's own TSDoc: *"the state is stated in the
file, so it can be wrong"* — keep that property, don't add validation).
Move it to `packages/domain/src/entities/sprint.ts` next to `sprintMembers`
(`sprint.ts:150`). The board's existing callers (`sprint-transition.ts:231`
and any other importer — grep `sprintFrom` under `packages/board`) switch to
importing it from the domain; **the board keeps every behavior**, this is a
relocation, not a rewrite. `parseSprintContent` (`board.ts:1597`, the board's
own card parser) and `sprintReleaseFactsShell` (`adapters/sprint-release.ts:18`,
the release collector reading the working tree) are NOT touched and gain no
third parser — the plan is explicit that this move adds no new parse path.

**Struck items are not already filtered out, and this is the trap.**
`itemsFrom`'s `MEMBER_LINE` regex (`sprint-transition.ts:89`,
`^- \[( |x)\] (?:(?:~~)?\[([a-z0-9][a-z0-9-]*)\]\s*)?(.*)$`) matches the
optional `~~` and **discards it** — the resulting `SprintItem` (`{tier,
checked, plan, text}`) carries no `struck` field. Run `sprintMembers` on an
item list straight from `itemsFrom` today and a struck `~~[slug]~~` slug
comes back exactly like an unstruck one. The plan's slice line says "struck
item out" (line 188) and D3 says "struck items drop out" (line 152) — neither
is true of the existing parse yet. This slice must either (a) add a `struck:
boolean` field to `SprintItem` and thread it through `itemsFrom`'s push at
`sprint-transition.ts:143`, or (b) have `sprintScope` re-scan the raw sprint
text itself for struck slugs and subtract them from `sprintMembers`'s
output. Whichever shape, write a test with a struck item mixed among
unstruck ones and assert it is absent from `scope.slugs` — the naive move
(call `sprintFrom` + `sprintMembers` unchanged) passes every existing test
and still includes struck slugs, because no existing test on `itemsFrom`
or `sprintMembers` checks for this.

**Zero or two+ active sprints both answer `none`, with a distinguishing
`why`.** This is the same rule `plot-sprint-release.sh:179` already enforces
(`[ "${#act[@]}" -eq 0 ]` → "no active sprint", and multiple matches earlier
at `:4-5`'s doc comment) — port the threshold, not a new one. A sprint with
zero unstruck items (every Must/Should/Could item struck, or none at all)
also answers `none` — not an empty-but-valid scope. `#2907`'s "every scope
plan is Delivered" check (plan line 91) depends on `none` reading as "hold",
never as a vacuously-satisfied empty scope — get the discriminated union
wrong here (e.g. `{ read: 'scope', sprint, slugs: [], branches: [] }` for a
zero-sprint case) and that distinction silently breaks downstream.

**The branch map goes through the fleet pulse, not a second lookup.** A PR's
branch maps to a scope plan via `FleetReading.plans[].slices[].branches[].branch`
(`packages/domain/src/entities/fleet.ts:773`, reached through `PlanSchema.slices`
at `fleet.ts:721` and `PlanSliceSchema.branches` at `fleet.ts:660`) — filtered
to plans whose slug is in `slugs`. A branch that no scope plan's pulse entry
names is not in scope, full stop; do not independently derive a branch name
from a plan slug (e.g. by convention or by reading the plan file's `##
Slices` section again) — the pulse is the one source already walked for this,
and a plan can rename or re-slice its branches between pulses.

**The adapter test needs a temp git repo whose local checkout lags the named
ref** (plan line 188) — this is not an incidental nice-to-have, it is the
test that proves the "never the working tree" property actually holds. Build
a fixture: a bare-ish temp repo, commit a sprint file, then mutate the
*working tree's* copy of that file (or just don't check it out at all) and
assert `sprintScope` still reads the committed ref's content. A test that
only checks out the branch and reads normally would pass even if the adapter
accidentally used `readFileSync` on the working tree.

### Done when

The plan's slice line (184) is the specification: `sprintScope` and its
discriminated answer; the git adapter that reads the active sprint from
`origin/<default>`; `sprintFrom` moved into the domain; the branch map
through the pulse.

Tests the naive implementation would pass without:

- **Domain unit over sprint texts:** a struck item (`~~[slug]~~`) is absent
  from `scope.slugs` while an unstruck sibling in the same file is present —
  this is the one most likely to be silently skipped (see above). Zero active
  sprints → `none`. One active sprint with items → `scope`. Two active
  sprints → `none`. A sprint with every item struck (so zero unstruck) →
  `none`, not an empty `scope`. A branch that no scope plan's pulse entry
  names is absent from `scope.branches` even though its plan's slug IS in
  `scope.slugs` (i.e., the plan is in scope but this particular branch isn't,
  because the pulse doesn't carry it — e.g. a not-yet-dispatched slice).
- **One adapter test on a temp git repo whose local checkout lags the named
  ref** (plan line 188, see above) — proves the read goes through git, not
  the filesystem.
- **A regression test that the board's existing `sprintFrom` callers still
  pass** after the move — re-run (or re-point) whatever test currently covers
  `sprint-transition.ts:162`'s behavior against the relocated domain export,
  so the move is provably behavior-preserving.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — it resolves which tests and
typechecks apply to the files this branch touches. The suites in the `CI
suites` config key run in CI on every PR; do not run them locally as a matter
of course (`test:e2e` dispatches real workers into sandbox repos and is CI's
gate, not a local one — CLAUDE.md § Testing). List no full suite in your own
PR description. Run `nvm use` first (Node 24).

This branch touches no `.sh` file, so `scripts/check-shell-lines.sh` does not
apply — if a push ends up touching one (e.g. to read the `Sprint directory`
config key from shell for a corpus comparison), growth is paid for in the
same change: remove shell elsewhere, or keep the logic entirely in the
domain and ask it through a bundle.

New functions are arrows (`export const sprintScope = (...) => ...`) per
`packages/domain/src/**`'s style. TSDoc states what each function does, its
parameters, return and failure modes; the reasoning for *why* goes in the
commit message, not the doc comment.

### Bookkeeping

Open the PR through the controller once the branch has its first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create` directly. Once the PR exists, append `→ #<number>`
to this branch's line under the "Sprint scope" heading in the plan's `##
Slices` section (plan line 188).

### Scope guard

This branch owns: `packages/domain/src/entities/sprint.ts` (the relocated
`sprintFrom`, and whatever `SprintItem`/struck-flag change this slice needs),
a new `packages/domain/src/rules/sprint-scope.ts` (or similarly named file)
for `sprintScope`, a new adapter under `packages/domain/src/adapters/` that
reads the sprint text via `Refs.showFile`/`Refs.listBlobs`, and the board's
`sprint-transition.ts` import line(s) that switch to the relocated
`sprintFrom` (no behavior change there).

Sibling branches in the same plan and what they hold — do not touch their
territory:
- `feature/a-review-opens-no-issue` (merged, PR #2928) — `review.ts`'s
  `reviewIssue` and the findings comment.
- `feature/the-index-records-the-review` (merged, PR #2939) — `pr-index.ts`,
  `pr-refresh.ts`, the GitHub-rollup jq extraction in `plot-host.sh`.
- `feature/the-review-run-is-locked` — the `reviewPr` lock, run-id, and
  `Host.prReview` widening. Independent of this wave; also edits `review.ts`.
- `feature/fleetd-reviews-slice-prs` — `rules/slice-pr-next.ts`, `deskDead`,
  `startReview`. **The consumer of this wave's `sprintScope` output** (plan
  lines 103, 127). Blocked on this branch merging.

If you find something the plan did not anticipate — e.g. the `Sprint
directory` config resolves to something unexpected, or the pulse's branch
list is shaped differently than `fleet.ts:773` suggests — report it rather
than improvising outside scope.
