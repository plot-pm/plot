# @plot-pm/domain

## 0.1.1

### Patch Changes

- [#524](https://github.com/plot-pm/plot/pull/524) [`21b23fd`](https://github.com/plot-pm/plot/commit/21b23fda470c2789f8e356f75fb5092c5d31d230) Thanks [@jwloka](https://github.com/jwloka)! - A transition is one value, and it checks its own gate.

  `plan.approve()`, `plan.deliver()` and `plan.release()` land in
  `@plot-pm/domain` as `src/transitions/plan.ts` — the package's first
  _transitions_, after its entities and its first rule. Each returns
  `Decision | Refusal` and **returns what should be written rather than writing
  it**: the domain reaches no disk, no host and no process, and the purity gate
  stays empty.

  **A phase and its record are one value, because the pairing came apart in
  practice.** The measured defect: a phase flip written without its record made a
  delivered plan invisible to the scan, which reported zero. Today that pairing
  is a rule four call sites must remember. `Decision` makes it structural —
  `phase` and `record` are both required and `readonly` on a single object, and
  the only way to obtain one is through a transition. **A phase without its
  record does not typecheck**, which is what the plan asked for: impossible in
  the type, not merely untested.

  **The refusals are `plot-approve.sh`'s and `plot-deliver.sh`'s, and they are
  named.** Those scripts already refuse on the phase and on the review channel
  before writing anything, and say which refusal fired. The _mechanical_ ones
  move here as a `RefusalReason` a caller branches on rather than matching prose:
  `phase-terminal`, `phase-too-early`, `phase-wrong`, `phase-unreadable`,
  `review-human`, `review-unrecognised`, `version-missing`,
  `precondition-unmet`.

  **What could not move is the PR check, and it is not faked.** It needs a host,
  so it arrives as a supplied `Precondition` reading — `{ name, met, detail }`.
  The adapter reads the host; the domain decides. That keeps the refusal
  expressible without the domain reaching for it, and it is the same shape the
  branch-merge check needs for `deliver()`.

  **`approvable()` stays callable alone, and `approve()` does not trust it.** The
  board's Approve button must know whether to _offer_ an action before anyone
  takes it, but a caller that checked is indistinguishable from one that did not,
  so the transition re-checks. The separation is deliberate and narrow: the two
  are not collapsed, and neither assumes the other ran.

  **The idempotent cases survive the move.** `approved` is not a refusal for
  `approve()`, nor `delivered` for `deliver()` — those are the half-states the
  shell scripts exist to _repair_, where the phase is flipped and the record is
  still missing. `alreadyRecorded` tells a repair from a no-op, so a caller can
  report "nothing to do" without re-deriving it.

  **41 cases, one per refusal, named for it** — so a refusal that stops firing
  fails loudly rather than silently widening what is allowed. Coverage of the
  package is **100% of 261 statements, 144 branches and 69 functions**, with the
  threshold failing the build when unmet.

  The three house rules hold: the new file adds **zero** occurrences of the
  counted vocabulary misuse, declares no `function`, and carries factual TSDoc —
  what each export does, its parameters, its return, its failure modes. The
  reasoning is in the commit message, dated and findable with `git log -S`.

- [#523](https://github.com/plot-pm/plot/pull/523) [`2fe3209`](https://github.com/plot-pm/plot/commit/2fe3209d6c6286cb28c6d4af0e066c512e4c4d18) Thanks [@jwloka](https://github.com/jwloka)! - One deliver rule, and it decides in the domain.

  The deliverable measurement leaves `packages/board/src/server/board.ts` for
  `@plot-pm/domain` as `src/rules/deliverable.ts`. It is the first _rule_ in a
  package that until now held only entities — the entity graph moved first
  because a rule with nowhere to stand had to wait for one.

  **It is named `allSlicesMerged`, because that is what it asks.**
  `DESIGN-slice.md` settled on 2026-08-28 that a Slice holds exactly one branch
  and belongs to one plan, while a Wave is the fleet's cross-plan cohort, formed
  at dispatch and persisted nowhere. This rule walks one plan's slices. The old
  name said Wave and meant Slice, and an earlier attempt (**PR [#511](https://github.com/plot-pm/plot/issues/511)**) moved the
  same logic under it and was closed rather than merged for exactly that reason:
  merging it would have grown the defect, and `Entities` and `Transitions` would
  have been built on top of it.

  **The board keeps compiling, and no board test was edited.** `board.ts`
  re-exports the domain rule under the name its two external call sites still use
  (`deliver.ts`, `auto-deliver.ts`), marked in one line as temporary; renaming
  those sites is a separable change. Its own internal call site in `planStatus`
  reads the domain name directly, because a re-export is a module binding and not
  a local one — `tsc` named that site, which a grep would not have.

  **The board's four existing suites are what prove the behaviour survived.**
  `merged-waves-reach-testing.test.ts`, `auto-deliver.test.ts`,
  `deliver-route.test.ts` and `plan-status.test.ts` — 81 tests — pass unedited
  through the re-export. They could not have moved: they build fixtures with
  `PlanMetaSchema.parse`, the board's plan contract, which the domain neither has
  nor may import.

  **14 new cases cover the rule at the domain boundary**, reading it through the
  narrow `{ file }` it declares, and meeting the package's 100% threshold on 16
  of 16 branches. The gate fails the build when unmet, so the coverage is a
  measurement rather than a claim.

  **The parameter is `PlanFile`, not `PlanMeta`.** The old signature claimed a
  dependency on thirty fields — phase, sprint, story, assignee, PR numbers,
  transition records — to read one. The domain could not import that type in any
  case; the module resolver refuses, which is the point of the boundary.
  Structural typing keeps the narrowing free, so no call site casts.

  **The three house rules hold, and the vocabulary gate's `allowed=` is not
  raised.** The new file adds zero occurrences of the counted misuse (the count
  stays at 10 against an allowed 12), declares no `function`, and carries factual
  TSDoc: what each export does, its parameters, its return, its failure modes.
  The reasoning [#511](https://github.com/plot-pm/plot/issues/511) kept in 109 lines of comment above 28 lines of code is in
  the commit message instead, where it is dated and `git log -S` finds it —
  including the two measurements worth keeping, the 2026-08-27 timeout read as a
  negative and the 2026-08-20 plan with no merged slice that read as delivered.

- [#521](https://github.com/plot-pm/plot/pull/521) [`6b2e53d`](https://github.com/plot-pm/plot/commit/6b2e53d0d49c65781a8e28d932a8e59e3659ddf3) Thanks [@jwloka](https://github.com/jwloka)! - The board reads a slice.

  The board's call sites move from `plan.waves` to `plan.slices`, and the
  compatibility aliases slice 1 left behind are removed. One vocabulary, one
  entity.

  **The aliases were a bridge with an end date, and this is the end date.** They
  existed so the domain's rename could land without touching the board's call
  sites in the same diff — the schema change and the call-site churn reviewed as
  distinct claims. Both have now landed. Leaving one behind would mean two names
  for one entity, which is the defect the rename removes.

  **`tsc` named the work, not a grep.** Deleting the downward alias — the
  `.transform((plan) => ({ ...plan, waves: plan.slices }))` on `FleetPlanSchema` —
  is what made the compiler enumerate every site that had not moved: **21 property
  accesses across 6 server files** (`fleet.ts`, `auto-dispatch.ts`, `board.ts`,
  `agent-panel.ts`, `worker-log.ts`, `worker-question.ts`), plus 5 type references
  to `WaveVerdict`/`WaveVerdictSchema` in the contract and two client modules. A
  grep would have been the wrong instrument: `schema.ts` alone carries ~200
  occurrences of "wave", nearly all of them either prose or the board's own
  `WaveSchema`.

  **Three fields spelled `waves` survive, and each is a different entity.** Only
  the first was ever this branch's:

  - `FleetPlanSchema`'s outbound alias — **removed.** Its slices are slices.
  - `summary.waves` — **kept.** A counter in the wire format `plot-fleet-scan.sh`
    still emits; renaming it here would break parsing against an unchanged scan.
  - `PlanMetaSchema.waves` — **kept.** A different producer (`plot-plan-meta.sh`)
    with its own wire format.

  **The inbound tolerance stays.** The `z.preprocess` that rewrites an incoming
  `waves` key to `slices` is untouched, so a new board still reads an old scan.
  The producer emitting the new name is step 2 of the migration, with its own
  timing decision, and a branch that edited the emitter would have widened past
  its plan. Removing the outbound alias while keeping the inbound one is the whole
  safety argument: two mechanisms in one file, and only one of them belonged here.

  **The board's own `WaveSchema` keeps its name.** It is a genuinely different
  entity — the derived per-`(plan, wave)` render state the board builds for
  itself, not the domain's slice — and renaming it belongs to whoever builds the
  real fleet cohort.

  **What proves it:** `pnpm run typecheck` clean; the board suite passing with no
  test edited beyond the renames. Two domain tests moved: one readout of
  `p.plans[0].waves[0]` became `.slices[0]` — a rename — and the test asserting
  the alias was _inverted into a regression lock_ asserting its absence, since the
  behaviour it guarded is the behaviour this change removes. The board's `.mjs`
  fixtures still feed `waves:` as scan input, untouched, which is what keeps them
  proof that the inbound compatibility survived.

- [#513](https://github.com/plot-pm/plot/pull/513) [`8584af5`](https://github.com/plot-pm/plot/commit/8584af5ce19f4f46d00d2e05c53e6d6dd017450e) Thanks [@jwloka](https://github.com/jwloka)! - The domain names a Slice a Slice.

  `FleetWaveSchema` → `FleetSliceSchema`, `WaveVerdictSchema` →
  `SliceVerdictSchema`, and `FleetPlanSchema.waves` → `.slices`, inside
  `@plot-pm/domain`.

  **The name was occupied by the wrong tenant.** `DESIGN-slice.md` settled the
  vocabulary on 2026-08-28, and by every property the object in code is a Slice:
  it holds `branches[]` and belongs to exactly one plan. A **Wave** is the fleet's
  cohort — slices drawn from several plans, sized by the agents available,
  assembled at dispatch and persisted nowhere. That entity does not exist in code
  yet, and building it was awkward while its name was taken. The domain now
  reserves it, in a comment that says what it will hold.

  **The wire accepts both spellings.** `plot-fleet-scan.sh` is a separate process
  that ships separately and still emits `"waves"` — the version skew this repo
  already got wrong across v2.5.0–v2.11.0. So the schema reads `slices` when
  present and falls back to `waves`, normalizing to `slices`. A new board works
  against an old scan. The producer emitting the new name is step 2 of the
  migration and has its own timing decision; the scan is deliberately untouched
  here.

  **The board keeps compiling, unedited.** Old names remain as re-exports
  (`SliceVerdictSchema as WaveVerdictSchema`, `FleetSliceSchema as
FleetWaveSchema`), and the parsed plan carries `waves` as a deprecated alias of
  the same array. Both are a bridge with an end date: the branch that moves the
  board's 44 call sites removes them, and `tsc` is what will name any site left
  behind. Without the alias the rename breaks 37 call sites across 6 server files
  — a diff this change is specified not to make, so that the schema change and the
  call-site churn can be reviewed as distinct claims.

  `FleetPulseSchema` stays a plain `z.object`, because the board reads
  `FleetPulseSchema.shape.summary` and a preprocessed schema exposes no `.shape`.
  `summary.waves` likewise keeps its wire name: the summary is a tally the board
  BUILDS as well as parses, so its counter moves with those producers.

  **What proves it:** a pulse in either spelling parses to the same object,
  asserted on both inputs rather than on one plus a claim about the other. The
  domain's 100% coverage gate holds over the package's first real branches — nine
  of them, including both arms of the fallback and the non-object guard. The
  vocabulary gate drops from 34 occurrences to 14, every survivor either the
  comment reserving the name or the compatibility path itself.

- [#509](https://github.com/plot-pm/plot/pull/509) [`aeb512b`](https://github.com/plot-pm/plot/commit/aeb512b5ad7df9627c9030acdc5061fbfd37f35a) Thanks [@jwloka](https://github.com/jwloka)! - Plot's entity graph moves out of the board into `@plot-pm/domain`.

  `FleetBranch`, `FleetWave`, `FleetPlan` and `FleetPulse` — with the four enums
  they are built from (`BranchState`, `WaveVerdict`, `WorkerState`,
  `WorkerActivity`) — leave `contract/schema.ts` for a new workspace package.
  **547 lines, byte-for-byte**: the diff is the move and nothing else.

  **They were never the board's.** A `FleetPulse` is `plans[] → waves[] →
branches[]` — Plan, Wave and Branch, already assembled, and assembled since the
  pulse first had a schema. They were invisible as entities because they carry
  transport names in a file called `contract/`. The work was not to build a
  domain but to move the one that already existed somewhere it can be depended
  on.

  **A move, not a copy.** An earlier draft proposed building fresh entities
  _beside_ the pulse types and proving agreement with a corpus test. That creates
  a third implementation of shapes that already exist twice, and then needs a
  later plan to remove it. A move creates no duplication, so there is no window in
  which two answers exist — and a corpus test would compare a thing to itself.

  **A package rather than a directory, and the boundary is the whole reason.**
  `contract/schema.ts` was already a pure domain layer — measured: one import
  (`zod`), no disk, no process, no network — so `src/domain/` inside the board
  would satisfy the same grep today. What it would not do is make the dependency
  direction _enforceable_: a directory can import `../server/fleet.js`, and
  eventually something will. A package cannot — the module resolver refuses, with
  no grep to run and no reviewer to notice. A gate rather than a rule, which is
  this repo's own doctrine.

  **The board re-exports what it moved**, so all 53 importers keep their import
  paths unchanged and the review reads as the move it is. Collapsing those
  re-exports would touch 53 files for no behaviour change; it is a later,
  separable decision.

  **Nothing ships differently.** `@plot-pm/domain` is `private: true`. The board
  declares zero runtime dependencies and bundles zod into its 1 MB artifact, so a
  workspace package bundles identically — the published board is byte-for-byte
  unaffected by where the domain lives. Publishing would only create a public API
  Plot then owes compatibility to.

  **What proves it: the board's existing tests, passing unedited.** No test was
  edited. Both builds were exercised, because a workspace package that resolves
  for one can still fail the other — the server bundles through esbuild, the
  client inlines to a single file through vite, and a green server build is not
  evidence about the artifact the browser loads.

  **Coverage arrives as a gate, not a report.** `@vitest/coverage-v8` is wired
  for the domain package alone at a 100% threshold that **fails the build** when
  unmet — verified by making it fail, not assumed. 100% is defensible here and
  nowhere else in this repo: the board spawns processes, binds ports and drives a
  browser, and a threshold it structurally cannot meet is one that gets lowered
  until it means nothing. The purity boundary leaves the domain no such excuse, so
  an uncovered line is a line nobody specified.

- [#515](https://github.com/plot-pm/plot/pull/515) [`b04f19c`](https://github.com/plot-pm/plot/commit/b04f19cd4c2f2099796a881f6cf031a7a299784b) Thanks [@jwloka](https://github.com/jwloka)! - The ten entities the pulse does not carry become domain types.

  PR, Build, Release, Worktree, Agent, Machine, Issue, Story, Sprint and Person —
  each with the identity kind and state source its spec records — plus
  `PortResult<T>` and the fleet's cross-plan cohort.

  **`PortResult<T>` has three outcomes, never two.** `{ ok: true, value }`,
  `{ ok: false, why: 'failed' }` and `{ ok: false, why: 'unaskable' }`: a host
  that is down is not a host that cannot be asked, and the estate has paid for
  the two-outcome version repeatedly — a `--no-fetch` scan reading 43 merged
  branches as open, `state: CLOSED` on a merged PR. As a union rather than a
  discipline, a reader that forgets the third outcome fails to compile.

  **The two vocabularies are named once.** Three identity kinds, each with its own
  failure — a slug collides, a natural key inherits the source's lie, a minted
  identity fails by nobody minting it (0 manifests against 13 worktrees). Four
  state sources, each going wrong differently: STATED is wrong, DERIVED is stale,
  FOREIGN disagrees, MEASURED decays instantly.

  **Constructors refuse rather than guess.** `resolvePerson` takes its directory
  as an argument and leaves an undeclared spelling unresolved; `measureMachine`
  derives headroom from the spawn cost, so a reading claiming `clear` at 286 ms
  cannot be built; `scoreItem` lets the plan estate outrank a sprint checkbox in
  one direction only; `buildConclusion` answers null while a run is in progress,
  because a build that has not finished has no conclusion.

  **The fleet's cohort has no constructor**, because nothing forms one: it is
  assembled at dispatch and persisted nowhere. A type with no way to build one is
  the honest shape for an entity with no source of truth.

  Coverage is 100% of statements, branches, functions and lines across
  `src/entities/`, enforced by the threshold already in the vitest config — 61
  branches, where the first slice covered 8 statements and 0.
