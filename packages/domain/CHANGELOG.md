# @plot-pm/domain

## 0.2.0

### Minor Changes

- [#659](https://github.com/plot-pm/plot/pull/659) [`4abc145`](https://github.com/plot-pm/plot/commit/4abc145d95094ffb905a235af2dc560d6ef3ca42) Thanks [@jwloka](https://github.com/jwloka)! - The banner names which limit was hit, and prints a reset only where the reset describes it.

  Two ceilings were reported as one word. `host_failure_kind` matched a single regex and returned `throttled` for every match of it, so _"API rate limit already exceeded"_ and _"You have exceeded a secondary rate limit"_ came back identical; `hostErrorState` mirrored that with `/rate limit/i.test(error)`, and `prNote` printed one wording over both — including `service returns in ~${when}` from `prNextInSeconds`, which describes the primary bucket and nothing else.

  **Both limits were measured here, and they recover minutes apart.** 2026-08-27: eight workers against a cap of seven produced a 403 naming abuse detection. 2026-09-01: `gh pr view` refused with _"API rate limit already exceeded"_ while the same account's GraphQL headers read 4854 of 5000 remaining — a bucket with 97 % left does not refuse on quota. A spent quota returns at the reset, minutes away, and the honest reaction is to stop until then and say when; a secondary limit clears in seconds and the reaction is to retry shortly and run fewer calls at once. One word for both counsels a wait of minutes for a ceiling that has already gone.

  `plot-host.sh` now answers `throttled|secondary|failed` and carries the second out as exit 6 beside exit 5. **The secondary test runs first, and the order is the classification:** GitHub's secondary message contains the phrase _"rate limit"_ too, so a quota test applied first claims every secondary refusal and the distinction is lost at the point it is made.

  **The wording decision lives in the domain**, per the rule that every rendered state is a domain property. `refusalKind` classifies, `resetApplies` says whether the reset describes the limit that refused, and `host-notes.ts` reads the answers rather than deciding.

  **The secondary banner names how many spenders the record found**, because the fix for local contention is closing a board rather than waiting for GitHub. The count comes from the record and never a headcount — the spenders are eleven scripts, the board, and a person at a terminal, so a process count misses the person. `localSpenders` divides the observed rate by `boardSharePerHour`, the same share the cadence already divides by, so the two numbers cannot drift.

  **A refusal still corrects only the prediction it is evidence about.** `correctForRefusal` moves on `throttled` and not on `secondary`: a burst refusal bounds requests at once and says nothing about the hourly ceiling. The concurrency bound is a later slice.

  The cadence is untouched. It divides on observed spend and never on a refusal.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#655](https://github.com/plot-pm/plot/pull/655) [`6fbe6ca`](https://github.com/plot-pm/plot/commit/6fbe6ca25473e09179b56c0ce2fea949a8891ee6) Thanks [@jwloka](https://github.com/jwloka)! - Every host call appends one line to a budget record the whole computer shares,
  and the spend rate is readable back over the connector's own window.

  The number nothing could see before. `plot-host.sh` makes ~40 host CLI calls
  across 14 backend branches and counted none of them, so a component asking
  _what is this account spending_ had one honest answer: ask the host, spending a
  request to find out. Measured 2026-09-01, `gh api rate_limit` reported 5000
  while the response headers on the same account read 0 — so that answer was both
  expensive and wrong.

  **Instrumented by shadowing, not by editing 40 call sites.** `gh`, `bb` and
  `jen` are now shell functions that forward argv untouched, preserve stdout,
  stderr and the exit code, and append afterwards; `command gh` reaches the real
  binary. Forty edits would all have to stay right, and the arm that drifts is the
  one nobody's repo exercises. A wrapper also counts a call site written next
  year. Jira is counted inside `jira_curl` instead, because it is reached through
  `curl` and shadowing `curl` would count every unrelated use of it.

  **A refusal appends a line too.** GitHub debits the request before it decides to
  refuse it, so a record blind to failures reads a throttled account as an idle
  one — under-counting exactly when the count matters most.

  **Lock-free, and the line cap is the guarantee.** Concurrent `O_APPEND` is
  atomic only below `PIPE_BUF`, which `getconf PIPE_BUF /` reports as 512 on this
  fleet's macOS machines rather than the 4096 a reader assuming Linux would take.
  Every line is measured in bytes before it is written, and an over-long one is
  **refused with a message on stderr rather than shortened**: a torn line loses
  the concurrent writer's line as well, so dropping one spend is cheaper than
  corrupting another's. Asserted with real concurrency at lines near the cap, not
  by argument.

  **The record is the computer's, not the checkout's.** Two GitHub checkouts here
  share the account `jwloka`, so a per-checkout `.plot/state/` would let each read
  a full 5000 while the other spent it — the over-spend the record exists to
  prevent, reproduced by storing it in the wrong place. `$PLOT_BUDGET_HOME` is the
  one override, the same variable `budget-file.ts` reads.

  **The rate is derived over the window, never the whole file.** One board at 5 s
  and eleven scripts at 90 s append ~1,160 lines an hour; a rate divided by an
  ever-growing span approaches zero, and a cadence derived from it would relax
  forever. The window starts at the latest reset that has already **passed** — a
  reset still in the future says only that the window has not closed, and
  subtracting an hour from one an hour out lands on `now` and discards every line
  ever written.

  **Absent is never zero, and `unknown` is never free.** A `remaining` of 0 means
  the bucket is spent; `-` means the connector did not say. A connector this
  wrapper holds no reading for records `unknown`, and `headroom()` answers null
  for it by construction — so a caller can tell a recorded zero from an unread
  one. `plot-host.sh spend-rate` reads the record back and asks no host.

  `packages/domain/src/rules/budget-record.ts` is the reader's half — the window
  filter, the per-budget grouping truncation needs, and the rate. The format is
  written twice, in shell and in TypeScript, because the spenders are eleven shell
  scripts and a person at a terminal: starting `node` to record one call would add
  ~40 ms and a runtime dependency to every host call plot makes. A contract test
  decodes real shell output with `decodeEntry` and pins the two together.

  No behaviour change beyond the record: a call that succeeds today succeeds
  identically with a line appended, and `PLOT_BUDGET_OFF=1` disables recording for
  the tests that prove it.

  <!--
  bumps:
    plot: minor
  -->

- [#657](https://github.com/plot-pm/plot/pull/657) [`cb671db`](https://github.com/plot-pm/plot/commit/cb671db30361876fdf0a295e992d40a9769bf9c6) Thanks [@jwloka](https://github.com/jwloka)! - The board's PR refresh interval divides by what the account is observed to be spending, so two boards spend what one board spends. Counted from the budget record over 400 adjustments: one board holds the account at 60 requests an hour, and so do two, three, five and eight — each board reaching an interval of N times the 60 s it refreshes at alone. A third board changes that number by nothing.

  No peer counting. The rate is read from the record every spender appends to, which also carries the operator's own `gh` calls and a dispatched worker's scans; a headcount of boards would miss both. `plot-host.sh spend-rate` supplies it, reads a file and asks no host.

  One board on a quiet account is unchanged and refreshes exactly every 60 s. An absent rate — a record holding one line, or several written inside one millisecond — leaves the cadence where it is rather than collapsing it, and a board already stretched holds position on it rather than walking back: null is no evidence, while a rate that is zero is evidence of an idle account. The stretch is bounded at eight, because the rate is read over a window as short as the gap between two lines and a burst must not push a board somewhere it has stopped spending enough to return from.

- [#629](https://github.com/plot-pm/plot/pull/629) [`654ceed`](https://github.com/plot-pm/plot/commit/654ceed1443fe75e53adcff3a742f539d6448653) Thanks [@jwloka](https://github.com/jwloka)! - Five gates that judge a finished agent by what it left behind: a merged PR, a valid changeset, a clean tree, no `PLOT-BLOCKED` marker, and an annotated plan line. Each is a pure function returning `null` or a failure written to be pasted verbatim into the next attempt's correction prompt. An unreachable host fails the PR gate and says so — silence is never permission.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#633](https://github.com/plot-pm/plot/pull/633) [`b4f314f`](https://github.com/plot-pm/plot/commit/b4f314fc2f8cd6f42d8d7897cd784458cde221c1) Thanks [@jwloka](https://github.com/jwloka)! - Compare the two surfaces that act on an eligibility verdict against the whole plan estate: the board reads the pulse's per-slice `verdict` and renders a row as startable, while `--next` reads `--list-eligible`'s branch list and pushes a claim ref. Both come from one rule in one process, so a disagreement between them is a defect in how the answer is emitted rather than in how it is decided.

### Patch Changes

- [#555](https://github.com/plot-pm/plot/pull/555) [`5818972`](https://github.com/plot-pm/plot/commit/5818972ddaea8734ae364b17d148fc266871ddb3) Thanks [@jwloka](https://github.com/jwloka)! - The domain's adapters are measured rather than excluded, and each threshold names its path and its reason.

  `vitest.config.ts` held one blanket `src/adapters/**` exclusion. Four test files
  were already exercising those adapters into a coverage report nobody could see.
  Lifting the exclusion and running the existing suites — **no new tests** —
  reports the estate as it is:

  ```
                            lines  branches  functions  statements
  whole package             95.31     82.80      89.23       94.00
  src/adapters/run-script  100.00     85.00     100.00      100.00
  src/adapters/machine     100.00     85.71     100.00       93.33
  src/adapters/plan-store  100.00     50.00     100.00       90.91
  src/adapters/trees        89.66     72.22      87.50       87.50
  src/adapters/processes    73.68     58.33      66.67       70.00
  src/adapters/refs         72.73     40.00      75.00       65.52
  src/adapters/host         63.89     12.24      35.29       57.50
  src/adapters/clock        50.00      0.00      33.33       50.00
  ```

  Each of those paths is now its own threshold entry carrying the reason its
  number is not 100 — `clock` sits at a branches floor of **0**, which is the true
  reading stated rather than assumed. Thresholds are the measured figure rounded
  down with roughly five points of margin, because one pinned to today's exact
  reading goes red on the next honest refactor, and a gate that fails on unrelated
  work gets deleted rather than met.

  **The warning the old comment made is preserved:** a threshold that forces
  host-failure and process-death branches to be faked teaches people to fake them.
  These floors are a ratchet, not a target, and they do **not** replace the two
  protections that catch more — the purity-except-adapters grep and the corpus
  tests that compare adapter readings against production's.

  **Why the global numbers are no longer 100:** a vitest glob threshold is
  additive. `resolveThresholds` adds every file to the global map regardless —
  _"Global threshold is for all files, even if they are included by glob
  patterns"_ (vitest 4.1.11) — so a glob cannot exempt a path from the global
  line. The global entry is now the whole-package floor, and the pure side keeps
  its 100% through two explicit globs. It takes two because
  `src/!(adapters)/**/*.ts` matches nothing at the top level of `src`, which would
  have dropped `src/port-result.ts` out of the gate silently.

- [`d8f9ffa`](https://github.com/plot-pm/plot/commit/d8f9ffafb46fb0a2a1d6308d1d2fea4de8b1402a) Thanks [@jwloka](https://github.com/jwloka)! - The `run-script.ts` coverage floor matches the platform that enforces it.

  `runBytes` attaches an EPIPE handler whose execution depends on whether a write
  loses a race against a process exit, and the pipe buffer differs by platform:
  macOS measures 100% functions, the Linux runner 94.44%. The per-file floor was
  set from the macOS reading and so was never reachable in CI, failing main on
  commits that changed only markdown. It now records the reading CI actually takes.

- [#664](https://github.com/plot-pm/plot/pull/664) [`2c4c7e9`](https://github.com/plot-pm/plot/commit/2c4c7e9a9b99c97cc38b428a548d3b1cf8ceef24) Thanks [@jwloka](https://github.com/jwloka)! - `HostBackend` is a string the domain does not validate, so a third git host
  costs an adapter rather than a domain edit.

  The closed enum `'github' | 'bitbucket'` was protecting something real: two
  `fleet.ts` expressions branched on the backend's name to decide whether to pass
  a reset reader, and a word that reached them unnarrowed would have been a
  runtime question where the type asked a compile-time one. Removing the enum
  before those branches existed would have traded a check for nothing.

  [#661](https://github.com/plot-pm/plot/issues/661) landed the header-read budget behind them, and this removes the branches
  themselves. The reset reader asks the connector through `limit()`, which reports
  one reading per bucket with the reset it stated; the soonest future `actual`
  reading is the wait, and a connector that meters nothing answers null — the same
  ceiling a host with no limit API already fell back to, without this having to
  know which host that is. `fetchGraphqlResetMs` goes with them, its `gh api
rate_limit` call being the only thing the vendor branch selected.

  **The refusal moves rather than disappearing.** `host-shell.ts` keeps a `DRIVES`
  list and still fails on a backend it cannot drive, naming the word it could not.
  That list belongs to the adapter because the adapter is the layer that could act
  on it — driving a host means a CLI `plot-host.sh` has been taught, and adding one
  is an edit to that file and the script beside it.

  The domain now names a vendor in exactly two places, both under `adapters/`,
  which is the property `Ports § A connector is a kind of adapter` records as a
  target. `LimitReading.connector` and the `CI` backend already read this way; `Git
host` was the outlier.

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
