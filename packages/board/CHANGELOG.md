# @plot-pm/board

## 0.7.0

### Minor Changes

- [#319](https://github.com/plot-pm/plot/pull/319) [`afd725f`](https://github.com/plot-pm/plot/commit/afd725faa527c4aa99e5a7b468be83ef98618a7e) Thanks [@jwloka](https://github.com/jwloka)! - board: a folded plan says what its branches' PRs are doing

  A collapsed plan head showed its phase and nothing about the branches beneath
  it, so a folded group gave a reader no reason to open it even when a PR two rows
  down was red. Reported from the live board as _"Wo ist 304?"_ — PR 304 was
  there the whole time, under a plan row reading `Discovery` with `checks failing`
  inside the fold.

  The plan head now folds its branches' PR states into one worst-case word beside
  the phase, with a count where more than one branch carries it. The plan stays
  canonical; this is orientation.

  Decided and enforced:

  - **Derived inside `PlanRow`, from the `group` it receives — never at a call
    site.** `PlanRow` has two, and they are asymmetric: NOT STARTED folds
    `active`/`marked` at the call site while the `planHeads` path over wave groups
    passes neither. Computing the aggregate the way `marked` is computed would put
    it on one kind of plan head and not the other — the exact shape of a fix on
    2026-08-22 that rendered nothing. A browser test asserts the badge on BOTH
    paths.
  - Precedence `conflicts > failing > pending`, quiet states silent: `green`,
    `none`, `unknown`, `closed` and a PR-less branch earn no word.
  - `pending` is included, rendered in a dimmer tone than the two actionable
    states — _something is happening_ against _do something_.
  - The aggregate STAYS when the group is expanded, unlike the change mark beside
    it: a long group scrolls its head off screen either way.
  - The phase keeps slot 5 and is never replaced — the badge rides beside it via
    `statusExtra`.
  - The word comes from `prStatus`, so a fold of five says the same word a lone
    branch does for that state, colour reinforcing but never carrying it.

  Client-side only: `AgentRow.pr.state` was already on the wire.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#327](https://github.com/plot-pm/plot/pull/327) [`864f8ac`](https://github.com/plot-pm/plot/commit/864f8ac9c1fedf3d3f7e0f47aee902201c740932) Thanks [@jwloka](https://github.com/jwloka)! - plot: the registry knows which agents are alive

  The agent registry now answers _is this agent still running?_ — which nothing
  did before. `plot-dispatch.sh` wrote one manifest per agent recording a **launch**
  (session, branch, worktree, command, startedAt) and nothing updated it after the
  spawn: no pid, no state. Measured 2026-08-22, the gap showed from three
  directions at once — seven worktrees carrying a `.plot-worker.pid` with all seven
  processes dead, seven registry manifests, and two agents actually alive. Three
  numbers, none of them _agents alive now_.

  Each manifest now carries the agent's **pid**, and each registry entry a
  **state** the pulse refreshes. The pid is a launch fact stamped by the wrapper
  the instant it learns its own child — the same value that lands in
  `.plot-worker.pid`, written the same way and for the same reason (the wrapper is
  the one process that knows the agent's pid). The state is decided on every pulse
  by reusing `plot-worker-state.sh` — the fleet's single liveness definition,
  sourced not reimplemented — so an entry whose process is gone reads `finished`
  on the next scan **without anyone deleting the file**. That is the stale-manifest
  cure: four entries outlived their processes because the record could not correct
  itself.

  **One derivation, three consumers.** The state lands on the registry entry
  instead of being recomputed per caller, so the concurrency cap (wave 2), WORKING's
  rows (a later plan) and the stale-manifest problem are all answered by one fact.
  The count of live entries is one filter over the `agents` array — no per-entry
  shell-out, because the cap will ask it every pulse.

  The states are exactly the four `plot-worker-state.sh` distinguishes —
  `running`, `finished`, `waiting`, `stalled` — carried onto the entry unchanged,
  plus the registry's own honest `unknown` for what it cannot decide: an older
  manifest with no pid, an agent between branches with no worktree to look in, or a
  liveness check that could not run. **Absent is not a guess.** A pid of `0` or
  junk reads as absent for the reasons the shell refuses them, and the wire schema
  defaults `pid` to `""` and `state` to `unknown` so a client holding an open page
  across a server upgrade still validates.

  The registry reads liveness from local signals only — it passes an empty PR fact
  to `plot_worker_state`, exactly as that function's contract permits — because the
  registry must not be behind a host call that can fail: an agent invisible during
  an outage is one that gets restarted into work it already holds.

  Scope: this is wave 1 of _approval hands the work to agents_. It teaches the
  registry to answer liveness and nothing more — it does not build the concurrency
  stepper (wave 2) or the auto-dispatch switch (wave 3), and it does not change
  WORKING's rendering.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
  -->

### Patch Changes

- [#308](https://github.com/plot-pm/plot/pull/308) [`a25862c`](https://github.com/plot-pm/plot/commit/a25862c1b15f3b1f45e7b595b406658934246c12) Thanks [@jwloka](https://github.com/jwloka)! - infra: Node 24 everywhere, declared where a tool will read it

  The repo pinned nothing: no `.nvmrc`, no `engines` block, and CI validating on
  **20** while the release workflow built on **24**. So the gate was not testing
  the version that ships, and every fresh shell picked up whatever `nvm` had
  last — which on this machine is **26**, where `pnpm` crashes outright.

  The failure mode is what makes it worth fixing rather than remembering: a
  background job under Node 26 exits having written a zero-byte log, which reads
  exactly like a hung test run. Diagnosing that costs more than the version
  mismatch ever does.

  Now: `.nvmrc` at 24, `engines: { node: ">=24" }` in both `package.json` files
  so a wrong interpreter is refused by the tool rather than discovered later, CI
  raised 20 → 24, and CLAUDE.md's Testing section leads with `nvm use`.

  Verified on 24 before raising CI, running the same steps the workflow does:
  `pnpm test`, `pnpm run validate`, `test:reconcile` (606/606), `test:e2e`
  (15/15), `typecheck` clean.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#321](https://github.com/plot-pm/plot/pull/321) [`d113840`](https://github.com/plot-pm/plot/commit/d1138409938f79cd304d06602a03c17c6ce4b536) Thanks [@jwloka](https://github.com/jwloka)! - plot: the parser reads a wave heading

  `plot-plan-meta.sh` now reads a second spelling of a plan's implementation
  section. The old `## Branches` shape puts the branch in the list line, mixing
  meta with prose:

      ### Removed
      - `bug/foo` — loses its half → [#300](https://github.com/plot-pm/plot/issues/300)

  The new `## Waves` shape moves the meta into the `### ` heading, leaving the
  line as pure description:

      ### Removed (Branch: bug/foo, PR: [#300](https://github.com/plot-pm/plot/issues/300))
      - loses its half

  Both spellings emit **byte-identical** `branches`, `prs` and `waves` arrays —
  the property that makes the estate migration provably a re-spelling rather than
  a change of meaning. A new-shape fixture and its old-shape twin are asserted
  equal across the whole record.

  **The parser reads BOTH while the migration runs.** The new shape is what Plot
  will write and document, but the old spelling stays readable: a format change
  owes its estate a migration that moves 85 files one at a time, and a plan moved
  one commit before the parser learns the shape must not read as silently empty.
  Measured against the pre-change parser, the new shape yielded `branches: 0`,
  `prs: 0`, `waves: 0`, `error: null` — silently, so the fleet scan would print
  `(no branches)` and `/plot-deliver`'s branch gate would pass on an empty list.
  A migrated plan would not fail; it would disappear.

  **A backticked name in a description is no longer a branch.** Under the old
  shape a second path-shaped token on a branch line was read as a phantom branch —
  on 2026-08-22 a wave of five reported six because a description cited a doc
  path. In the new shape the branch is extracted from the heading, anchored to the
  `Branch:` label, so a name in prose, in the wave title, or in a trailing
  citation cannot masquerade as a branch. The property is delivered, not merely
  permitted.

  `PR:` is omitted where none exists yet: an absent field contributes nothing to
  `prs` — not `""`, not `0` — the same rule `Issue:` follows. A `## Waves`
  section whose heading names no branch still opens a wave, so the section is
  never silently empty: a consumer can tell "a wave I could not parse" from "no
  waves".

  Scope: this teaches the parser and its contract tests only. The template still
  writes the old shape (wave 2) and no plan file is migrated (wave 3). The
  `<!-- claimed: -->` / `<!-- deferred: -->` comments still ride the branch line —
  now the heading line that carries the branch — and moving them is a separate
  question this wave does not answer.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#309](https://github.com/plot-pm/plot/pull/309) [`105b2c8`](https://github.com/plot-pm/plot/commit/105b2c84c4e0a473b38d30e4b3ca5c49132a8cb8) Thanks [@jwloka](https://github.com/jwloka)! - plot: the parser reads every documented PR form, and reports the near-miss

  `prs` is the field four gates read — `/plot-deliver`'s merged check,
  `/plot-release`'s version resolution, the sweep's section 6, the fleet scan —
  and until now no test in `parser.test.mjs` took it as its subject. The two
  existing mentions are incidental assertions inside `issues` tests. Six tests
  now pin it, and they found two defects.

  **`→ owner/repo#N` was dropped.** `/plot-deliver` step 4 instructs
  implementers to write it for `Impl: other repo` plans and names it again in
  its split-home clause, but `prs` matched `→ #[0-9]+` only. A split-home plan
  therefore reported `prs: []` beside `impl: other-repo` and `error: null` — a
  delivery gate reading "no PRs" for a plan whose only PR was written exactly as
  documented. No plan in this repo uses the form yet, so the defect was latent
  and would have struck the first adopter. The repo part is matched but not
  retained: callers ask which PRs are the evidence, and `plot-host.sh` resolves
  where each one lives.

  **`→#N` without the space was dropped silently.** The annotation is written by
  hand and that is the obvious slip. Accepting it would widen the contract on a
  guess about intent; dropping it is worse, because _no annotation_ is a claim
  the sweep acts on — it prints "cannot resolve a version" and sends a human to
  add an annotation the plan already carries. It is now reported in a new
  `malformed_prs` field, verbatim, and `prs` stays strict.

  **The strictness itself is now pinned as intended rather than accidental.**
  Plans cite PR numbers constantly as history — this repo's
  `a-plan-row-is-not-a-branch-row` names [#175](https://github.com/plot-pm/plot/issues/175) and [#191](https://github.com/plot-pm/plot/issues/191) in prose as prior art,
  and neither delivered it — so a body scan cannot tell a signal from a
  citation. The tests assert that `([#101](https://github.com/plot-pm/plot/issues/101))`, a bare `[#102](https://github.com/plot-pm/plot/issues/102)` in prose, and an
  arrow outside `## Branches` all contribute nothing.

  Measured additive: every one of the 84 plans in `docs/plans/` was parsed
  through the old and new script and compared on `prs`. Zero differ.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#325](https://github.com/plot-pm/plot/pull/325) [`a20de9b`](https://github.com/plot-pm/plot/commit/a20de9be6c06eb75965330bade2b772c082d9f22) Thanks [@jwloka](https://github.com/jwloka)! - plot: the plan's acts live on the plan head, and NOT STARTED holds approved plans only

  Three breaks in one path — read a plan, approve it, start the work — none of
  which connected, all from the same confusion between a PLAN act and a BRANCH
  row.

  **The branch-row Approve could not render for any row, ever.** Its gate was
  `isDraft(card) && row.waitingOn === 'you'`, but `waitingOnFor` returns non-null
  only for `group === 'not-started'` while `classify` routes every Draft plan to
  `waiting-on-you` — the two clauses excluded each other by construction.
  Measured by executing the function rather than reading it: `'you'` is returned
  for exactly one input, `not-started` + `deferred`. No narrowing makes a
  plan-level act correct on a branch row — a branch BLOCKED by an earlier wave is
  in `waiting-on-you` too when its plan is Draft — so the row-level control is
  deleted, not re-gated, and Approve lives on the plan head (`PlanActions`, gated
  on the card's `isDraft` alone), where it always worked.

  **Commission design was worse: self-contradictory.** `canCommissionDesign` read
  `waitingOn === 'you' && state === 'open'`, and `'you'` only ever arrives with
  `state === 'deferred'` — satisfied by no board-producible input. Deleting its
  row twin would have removed the feature outright, because `PlanActions` took no
  `commission` prop. The prop is now threaded through (an extension of a chain
  already reaching five components), and the plan head offers Commission design
  beside Approve — the two answers to one question.

  **NOT STARTED admitted Draft plans.** The `deferred` arm of `classify` kept
  `'draft'` in its unknown-phase allowlist, so a Draft plan's shelved branch fell
  through to `not-started` — the section whose hint reads _approved, nobody has
  taken it_, offering work no phase gate would let an agent start. `draft` now
  answers on its own line, WAITING ON YOU for both verdicts, exactly as the
  `open` arm already answered it. `''` still falls through untouched: absent is
  not a phase, and a scan predating the field says nothing about the plan.

  The two plan-level acts left the branch menu entirely — `menuState`, `RowActions`
  and the prop chain down to them no longer carry them — so the branch row's menu
  holds only branch-level acts (Start work, Open/Review, the conflict dispatch,
  the reads), which a browser test pins against the emptied-menu regression. A
  new browser test exercises the plan HEAD, the render twelve green card tests
  never mounted, and it fails against the pre-fix code for the stated reason:
  the Commission design item is absent without the prop.

  <!--
  bumps:
    skills:
      plot: patch
  -->

  ## And a wave said _nobody has taken it_ over finished work

  Reported from a screenshot: PR [#323](https://github.com/plot-pm/plot/issues/323) rendering `green` beside `approved — nobody
has taken it`. The server was right on every field — the row sat in
  `waiting-on-you` with `note: "PR [#323](https://github.com/plot-pm/plot/issues/323) green"` — and the client's fallback chain
  was not.

  `waveNote` guarded on `soleNote`, which is the sole row's note **with its PR
  fact stripped**. Where the note is only that fact — the ordinary shape for a
  finished branch — the strip leaves `''`, and empty is falsy, so the chain fell
  through to a verdict sentence about starting work that had already been done.

  The guard now asks `soleRow`, which says _this wave has one branch and the
  branch speaks for it_ — the same condition the sibling `waveWaitingOn` ternary
  already tested three lines above. The comment beside it had described the
  intended behaviour correctly since it was written; only the predicate was wrong.

  Every single-branch wave that reaches review hit this, which is the common case
  rather than an edge.

- [#323](https://github.com/plot-pm/plot/pull/323) [`6436a3a`](https://github.com/plot-pm/plot/commit/6436a3aa105b2c9b406fa47b7369ae5c7cdbfb58) Thanks [@jwloka](https://github.com/jwloka)! - challenge-the-plan: the skill writes the round count it was always read for

  Every layer that surfaces a plan's interrogation count was built —
  `plot-plan-meta.sh` parses `rounds` from the `CHALLENGE-THE-PLAN-METADATA`
  block, `PlanMetaSchema` carries it, `PlanCard.tsx` renders the badge — except
  the one that produces the value. Measured 2026-08-22 across 90 plans: 24 report
  a count, every one written 2026-08-15 to 2026-08-17, none since, and on the live
  board all 24 badges sit in Released — the field is present only where it can no
  longer inform a decision. The count stopped exactly when the work moved from the
  slash command (which specifies the block) to the skill (which never wrote it).

  `challenge-the-plan/SKILL.md` gains **Phase 5b: Record the round** — a
  read-modify-write of the metadata block at the end of every round, including a
  round that changed no decision, because `0 rounds` (interrogated, found nothing)
  and an absent block (nobody looked) are deliberately different and want opposite
  reactions from a reader. The block is updated in place, never appended, since
  the parser reads only the first `"round":` line it finds.

  **One specification, two entrances.** The slash command stops duplicating the
  block's description and points at the skill, where the interrogation happens and
  the block is written — the same drift `/plot-approve` warns about with its own
  two entrances.

  The parser is untouched: it reads the block correctly today and 24 plans prove
  it. `rounds` stays optional and un-defaulted all the way through.

  <!--
  bumps:
    skills:
      challenge-the-plan: minor
  -->

## 0.6.0

### Minor Changes

- [`d1da9ba`](https://github.com/plot-pm/plot/commit/d1da9ba7f61f69384a87d2da885f03bb8e04ebec) Thanks [@jwloka](https://github.com/jwloka)! - board: a plan row is not a branch row, and the grid says so

  A plan row borrowed the branch tracks, and the two then began at the same
  x. Measured on screen before the change: the plan name and the branch
  name below it both started at 222px, so eight sibling plans in NOT
  STARTED read as a nesting rather than as a list.

  The row now has its own proportions — `PLAN_ROW_TRACKS`, four cells for
  the four things it carries: the shared marks column, the name, the wave
  summary and the clock. No phase track (the phase rides in the name cell,
  keeping its `data-phase`), no PR cell, no actions cell. Dispatch is per
  branch and wave, so a control there would have to guess which wave it
  meant, and an empty track to hold nothing is what this row just stopped
  doing.

  Measured after: the plan name begins at 217px and the branch name at
  481px. Branch rows are untouched and still align column-for-column across
  all five sections — `[189,217,309,481,1423,1659,1711]` in every one — the
  property [#175](https://github.com/plot-pm/plot/issues/175) established and this does not spend.

  An unplanned improvement worth naming: plan names are no longer
  truncated. `the-repair-exists-but-n…` in a 10rem branch track is now
  `the-repair-exists-but-nothing-calls-it` in a `1fr` one.

- [#241](https://github.com/plot-pm/plot/pull/241) [`3c07900`](https://github.com/plot-pm/plot/commit/3c07900446e1dc92708f66cf1b81314d43e38664) Thanks [@jwloka](https://github.com/jwloka)! - board: a waiting agent stays in WORKING, annotated with what it waits on

  An agent that stopped to ask a question was sent to WAITING ON YOU. A waiting
  agent is still an agent: its worktree is live, its context is intact, and what
  unblocks it is an ANSWER rather than a review. Filing it under the other verb
  took it out of the section that answers _who is working?_, so an operator
  counting agents in WORKING undercounted every one that had stopped to ask — and
  the row arrived in WAITING ON YOU carrying none of what that section is built to
  show: no PR to open, no checks to read, nothing to inspect on the host.

  **The two sections answer different questions, and that is the whole rule.**
  WAITING ON YOU is for RESULTS — branches, PRs, CI status, failures, things a
  person inspects and decides about on the git host. WORKING is for AGENTS. The
  `waiting` arm now returns `working`, placed beside `running` rather than among
  the stopped states, because those two are the pair that mean _an agent still
  holds this branch_. The comment above `running` is the precedent it follows: a
  worker's own state outranks reasoning from commit age.

  **The note says what it waits ON, not merely that it waits.** _worker is waiting
  on an answer from you_ named a state and withheld the only part a reader could
  act on — they had to open the worktree to learn whether the question was even
  theirs. The row now carries the marker line the scan's verdict was made from:
  _worker waiting on you: PLOT-BLOCKED: which adapter should the fallback use?_

  **An unreadable marker is a stated unknown, never a guess.** The scan already
  found a marker — that is what made the worker `waiting` — so a failed read here
  means this read did not find what that one did, not that nothing was asked. The
  row says _reason unavailable, look in its worktree_ and stays in WORKING. A
  fabricated question would be far worse than a blank: a reader who answers the
  wrong question has done work that clears nothing, and unlike a blank they have
  no signal that they were misled.

  **No new state and no new source.** The `asking` state this wave originally
  proposed is withdrawn, and the reason is worth carrying: the log records that a
  question _was asked_; the marker in the tree records that it is still
  _unanswered_, and only the marker clears when someone writes the answer. A
  restarted worker was measured finding its own question already answered in the
  commit above it and carrying on — a log-shaped detection would have shown it as
  still asking. `waiting` (PR [#219](https://github.com/plot-pm/plot/issues/219)) already reads the tree, and it was already
  correct; this changes one verdict about it.

  **The marker text is read on the SCAN's clock, not the render path.** `classify`
  is a pure function called for every branch on every poll, so a subprocess inside
  it would spawn git synchronously, once per row, every five seconds. The new
  `workerQuestions` runs inside the scan refresh — where every other local fact on
  the row is already read — and only for branches the pulse reports as `waiting`
  with a worktree on this machine. A fleet with no questions in it spawns nothing
  at all. Like `worker-log.ts`, every path segment comes from the pulse's own
  `local_worktree` and none from a caller, and the search is `git grep` rather than
  a recursive one: a worktree holds `node_modules`, and walking it on a 5 s timer
  is not a cost this can carry.

  **The questions are deliberately not bridged across a restart.** Every other
  field in the pulse bridge stays true while the process is gone — a commit's age,
  a plan's approval date — so restoring it labelled with its real age is honest. A
  question is the opposite: it exists precisely until somebody answers it, and the
  answering is often what a `node --watch` restart is FOR. A bridged question would
  name something already resolved inside a fresh-looking row. Absent instead, which
  renders as the stated unknown until the first scan lands.

  **The ordering guarantee survives the move.** `waiting` is still tested before
  `stalled`, and is now further above it than before. A worker that asked a
  question has almost always left the work it was doing uncommitted beside the
  question, so ranking dirtiness first files every such branch under _resume it_
  and invites a restart into the same wait — measured happening twice to one
  branch, the second restart re-running work the first had finished. Asserted
  directly: a `waiting` worker with dirty files lands in WORKING and its note does
  not say _resume it_.

  **What deliberately did not change.** The PR arm still outranks this: a PR with
  conflicts or failing checks is a person's errand even while an agent waits, and
  `waiting` gets no version of the `running` exemption — that exemption exists for
  an agent that opened a PR and kept working, and an agent that has stopped is not
  that. A `finished` worker with a PR still goes to WAITING ON YOU, and a `stalled`
  worker still goes there too. All three are asserted alongside the change.

  One documented claim was retired rather than reworded: _when only `working` is
  populated you can walk away_. It no longer holds, because a populated WORKING
  section may hold one row that wants an answer. That is the honest trade — a rule
  checkable at a glance is worth less than a section whose membership is true.

  A pleasant composition falls out unasked. `showsWorkerLog` gates on WORKING
  membership alone and knows nothing about worker states, so a waiting row now
  gets the log the sibling wave shipped: the reader sees the question on the row
  and can open the reasoning behind it without a second tool. In WAITING ON YOU it
  had neither. Asserted, so neither wave can be undone without noticing.

  The marker pattern is a second copy of the scan's, and that is named rather than
  hidden. Teaching the scan to emit the marker line as a pulse field is the better
  shape and is out of this branch's scope. What drift costs here is a sentence and
  never a section: this pattern never decides `waiting` — the scan does — so a
  spelling it misses degrades one row to _reason unavailable_ while the row stays
  in WORKING. A test asserts the set of spellings, so a divergence is a red test
  rather than a quietly emptier board.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side verdict change only.
  `plot-worker-state.sh` and `plot-fleet-scan.sh` are deliberately untouched —
  `waiting` is already correct in both, and the marker they read is what this
  change explains rather than re-decides. The `/api/fleet` payload gains no field;
  the annotation is composed into the existing `note`.

- [#235](https://github.com/plot-pm/plot/pull/235) [`e056dce`](https://github.com/plot-pm/plot/commit/e056dce58e5b8bd3072546214b5d76b036ee420c) Thanks [@jwloka](https://github.com/jwloka)! - board: `/api/attention` says what needs you, and what needs an agent

  The read path is the most engineered part of this system and it answers exactly
  one question: **what is true**. `/api/fleet` rows already carry `state`,
  `group`, `note`, `pr`, `localDirty`, `localAhead`, `stuck`, `blockedBy`,
  `waitingOn`, plus the worker's pid and liveness. What no endpoint answered was
  **what should I do**.

  Measured 2026-08-18: an operator ran a shell guard beside the board for an
  afternoon and it gathered _nothing the board did not already have_. The board's
  own rows read `worker running (pid 20145)`. The guard's entire value was three
  lines of judgement over that data — is this worker abandoned, waiting on an
  unanswered question, or working — and an agent had to reassemble those three
  lines from four separate reads.

  `GET /api/attention` returns one payload with four lists, split by **who can
  clear it**:

  ```
  needsAgent  work that stopped and needs a machine put back on it
  needsHuman  a click, a look, a review, a rebase
  waiting     a worker holding the door open on an unanswered question
  claimable   branches nobody has taken, and where each brief is
  ```

  **Every verdict traces to a fact the scan already reports**, and each entry
  carries an `evidence` string naming the field it was read from
  (`worker: failed`, `pr.state: none`, `stuck.state: unpushed`) so a caller can
  audit the list against `/api/fleet` without running anything. This endpoint
  adds no facts — it renames existing ones. A verdict the board guessed is the
  defect this repo has spent days removing.

  **Two verdicts the prototype learned the hard way, both ported:**

  _A worker that asked a question is not abandoned._ The guard restarted one
  branch twice while its worker waited on an answer it had asked for; the second
  restart re-ran work the first had finished. `waiting` therefore gets its own
  list rather than a place in `needsAgent` — it is the one state where the wrong
  move actively destroys work, and a list a caller can see and skip is not the
  same as one folded into a general pile.

  _An open PR is not abandonment._ Work that reached review has left the worker's
  hands, so leftover local edits there mean nothing. The classification order is
  load-bearing and is the prototype's: alive → merged → open PR → worker verdict
  → unpushed.

  **A cold cache does not read as an empty fleet.** Four empty lists mean
  _nothing to do_, which invites a caller to stop; four empty lists before any
  scan has landed mean _nothing has been read yet_, which invites it to wait and
  ask again. `ready` separates them, and `readRef` says which world the verdicts
  are about — a verdict is a stronger claim than a fact and needs the provenance
  at least as much.

  **`AgentRow` gains `worker`**, the scan's eight-state verdict forwarded
  verbatim. It was already read by `rowsFromPulse` and dropped, surviving onto
  the row only as prose inside `note` — the exact shape `localDirty` and
  `localLocked` were in before the same forwarding fixed them. `waiting` and
  `stalled` name opposite moves (_answer it_ versus _resume it_), so a consumer
  reduced to matching sentences to tell them apart is one rewording away from
  restarting a worker into the question it asked. Forwarded, never re-derived:
  liveness is decided once, in `plot-worker-state.sh`, and a structural test
  asserts it.

  **Read-only and idempotent.** It names candidates; it reserves nothing and
  starts nothing. Claiming is `/api/claim` and starting is `/api/dispatch`, both
  deliberately separate — an agent asking what is available has not yet committed
  to doing it, and conflating the two would make a survey a mutation. A POST gets
  the server's blanket 405.

  **Open point answered: `claimable` takes no capability hint.** Deferred, on the
  plan's own criterion — _real once more than one kind of worker exists,
  speculative before that_. Every worker in this fleet is the same agent started
  by the same `Worker command`, so a hint would have exactly one value on every
  branch and no consumer able to disagree with it. Adding the field now would
  mean designing a vocabulary (`shell only`, `no network`) against zero measured
  demand and freezing it into a payload before anything could show it wrong;
  adding it later is additive, and this endpoint's whole rule is that a field
  must trace to a fact something already reports.

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content.

- [#251](https://github.com/plot-pm/plot/pull/251) [`380cec9`](https://github.com/plot-pm/plot/commit/380cec93c66ec3094d75f4ff32e14106ef8df581) Thanks [@jwloka](https://github.com/jwloka)! - board: agents change state through validated calls that return what resulted

  The read path is the most engineered part of this system — a 5 s scan cache, a
  60 s PR refresh with backoff, a disk-persisted last-good pulse, staleness
  rendered honestly. The write path was two endpoints, both human-clicked, and an
  agent's whole loop was _read several scripts, guess which applies, edit
  markdown, push, and hope the derived view agrees_. Each step can fail quietly,
  and one did: a hand-written plan parsed correctly, carried the right phase, sat
  on `origin/main`, and was **invisible** to every unscoped scan. Valid and
  unreachable at the same time, with nothing saying so at the moment of writing.

  `POST /api/claim` and `POST /api/transition` close that loop. Each wraps
  machinery that already exists, and each returns the resulting state — which is
  the whole point rather than a nicety. A `200 OK` with no state leaves the caller
  doing exactly what this replaces: asking a second endpoint whether the first one
  landed, and guessing when the answer is stale.

  ## Wrapped, never reimplemented

  `/api/claim` runs `plot-dispatch.sh --no-start --max 1`. The claim stays a **ref
  push whose tip is an empty commit**, and that detail is the entire mechanism:
  two independent claims diverge, so the loser's push is rejected as
  non-fast-forward, and git is the lock. Pushing a branch that merely points at
  `origin/<main>` would not work — the remote already has that commit, both pushes
  succeed, and both callers believe they won. Server-side claim state would put a
  second source of truth beside the repository and break the property that makes
  the fleet restartable: kill anything, and the next pulse re-derives truth from
  git.

  `--no-start` is a flag the script already had. **Claiming is not dispatching**:
  an agent that has committed to doing work has not asked for a second agent to do
  it. `/api/attention` states the same split from the other side — a survey that
  reserved would be a mutation.

  `/api/transition` contains **no phase logic at all**. It runs the spoke's script
  and reports what the script said, so a transition the spoke refuses is refused
  here in the spoke's own words. That is the plan's open question answered:
  wrapping keeps one implementation and inherits its prose, while superseding
  would put the four guardrails in two places and make the API a bypass of the
  lifecycle rather than an interface to it.

  The subtlety that vindicates the choice is one a reimplementation would have
  lost. `Approved → approve` **is not refused**: `plot-approve.sh` treats it as the
  idempotent repair, because a run that finds the phase already flipped still has
  holds to clear and a record that may be missing. It reads like it should be an
  error, and an API writing its own rules would have "helpfully" made it one —
  silently breaking the path the script documents as _run it again is the repair
  for every interruption_. A test now keeps that inherited.

  Both endpoints answer **200 on a refusal**. Losing a claim race is the normal
  outcome of a fleet working correctly, and a guardrail refusal is the lifecycle
  operating as designed; a 4xx would train callers to treat their own healthy
  behaviour as a fault and retry what will be refused identically every time.
  What resulted is in the body, which is the premise.

  ## The loopback boundary is now a gate rather than a sentence

  The plan recorded the trust model as answered — _"loopback is the boundary and
  already in force"_ — and it was not. Verified 2026-08-19: `HOST` was read once
  in `index.ts` and **never checked**. Nothing stopped `HOST=0.0.0.0`, which
  published `/api/dispatch` — an endpoint that spawns detached agents — to every
  interface the machine had. The claim held only while nobody set it, and these
  are the first endpoints that change repository state rather than starting a
  local process.

  The check now lives in the **router**, once, ahead of every write route, and
  that placement is the change rather than an implementation detail. Four handlers
  each carried their own copy, which is what this repo calls a rule: correct
  today, correct tomorrow only if every future write route remembers. A check
  where routes are _dispatched_ is a gate — the next write endpoint inherits it by
  construction, the same argument the blanket 405 makes one branch further down.

  **And the router dispatches from a table, not from a list of paths beside a
  chain of `if`s.** That distinction stopped being academic within hours of being
  written: `/api/idea` landed on the default branch as a sixth write route — it
  writes a plan file and creates a branch — and under the list shape this gate
  started with, it merged cleanly, typechecked, and would have been the one
  ungated write endpoint. A list beside the routes is itself a rule somebody has
  to remember. Deriving **both** the dispatch and the gate from one entry means a
  route that exists is gated, and a route absent from the table is not reachable
  at all. The shape is the claim, exactly as `MARKDOWN_ROUTES` already is.

  The test enumerating the routes has the same weakness, so it reads the router's
  own table back out of the built artifact and asserts the two agree — a new write
  endpoint fails the suite until it is covered.

  The four copies are removed rather than left beside it, and the reason is
  sharper than tidiness. Once the gate grew a named opt-in, a surviving copy would
  have honoured a **different policy**: the opt-in would open `/api/claim` and be
  refused at `/api/dispatch`, so one variable would mean two things depending on
  which route read it. That is precisely the failure `approve.ts` records for
  capability flags. `dispatchAvailability` and its two siblings stay — they answer
  _will this button act_, which is a different question asked at a different time,
  and they remain the source the gate reads so the two cannot disagree about what
  loopback means.

  Loopback is `localhost`, `127.0.0.1`, `::1`. `0.0.0.0` is deliberately excluded:
  it is what the fleet user test uses to read the board over Tailscale, and
  "sitting at the machine that owns the worktrees" stops being true the moment the
  address is reachable from elsewhere. **Reads are untouched** — a phone reading
  this board over Tailscale is the workflow the gate must not break.

  The opt-in is `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand`, and the awkwardness
  is the feature: a flag that reads like a convenience gets set by someone who has
  not thought about it. The **value** is checked, not the variable's presence, so
  `1`, `true` and `yes` — what a person types when guessing — leave the gate shut.
  The refusal names the binding, the boundary, the exact escape, and what the
  escape costs, because a bare 403 sends a developer who bound wide for a reason
  to the source.

  ## What the plan did not anticipate: only one transition is mechanised

  Plot has four phases and three transitions, and exactly **one** has a script.
  `plot-approve.sh` performs `Draft → Approved` as seven writes with no judgement
  in any of them. `Delivered` and `Released` are written by `/plot-deliver` and
  `/plot-release` as _prose an agent applies_ — there is no mechanical entry point
  to wrap.

  So supporting them would have meant writing those guardrails a second time
  beside the ones that already exist, which is the one thing this branch was told
  not to do. They are refused by name with **501**, naming the command that owns
  each: the caller asked for something real and correctly spelled, and a 400 would
  send it to fix a spelling that is right. A refusal that names the owner is a
  smaller failure than a duplicate guardrail that drifts.

  Making them real is a larger change — it means giving deliver and release the
  mechanical halves approve got — and it deserves its own interrogation rather
  than being folded in here.

  ## Testing

  The guardrail tests run the **real** `plot-approve.sh`, not a stub. A stub
  exiting non-zero would prove the wiring and nothing about the property that
  matters — that the API cannot approve a plan the spoke would refuse. Only the
  real script can show that, because the real script is where the rule lives. It
  is safe because those refusals fire from the plan file before any host contact,
  in a fixture repo with no remote: nothing could be merged or pushed even if a
  guardrail had failed to hold. The suites that would reach the host use the stub.

  The load-bearing assertions are the negative ones — a refused request **spawned
  nothing**, and a refused transition **wrote nothing to the plan file**. Every
  other assertion in those suites can pass while the side effect still happened.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. No helper script is
  touched — `plot-dispatch.sh` and `plot-approve.sh` are wrapped exactly as they
  are, which is the point, and `plot-fleet-scan.sh` and `plot-worker-state.sh` are
  deliberately untouched. The `/api/board` and `/api/fleet` payloads are unchanged.

- [#246](https://github.com/plot-pm/plot/pull/246) [`5acc20f`](https://github.com/plot-pm/plot/commit/5acc20f1ad52323e28b535351673980565992c38) Thanks [@jwloka](https://github.com/jwloka)! - board: continue an answered agent — a new run, not a reply

  `claude -p` has no stdin after launch, so the agent that wrote a `PLOT-BLOCKED:`
  marker is gone by the time anyone reads it. `POST /api/continue` starts a NEW
  worker in the same worktree; the control is called **Continue with an answer**
  and every string around it says so, because a _Reply_ would promise a channel
  this system does not have and cannot grow without a different runtime.

  **The prompt is the brief plus the answer plus what already landed — never the
  previous run's transcript.** A worker that ran an hour produces one large enough
  to fill the next one's context before it starts. The brief is the specification
  and has not changed; the answer is the new fact; and what the previous run
  committed is read from `git log main..HEAD` — durable, current, re-derivable, and
  in the tree the worker has checked out anyway. Commits are NAMED, never pasted:
  a diff fills a context window as readily as a transcript does. The test asserts
  the negative directly, because it is the decision the plan's interrogation turned
  on and the kind that decays through a well-meant edit.

  The answer reaches the worktree as a FILE, not as a shell word. `Worker command`
  is a shell fragment run through `sh -c`, so an answer interpolated into it would
  be shell source — one `"; rm -rf ~` from a person unblocking an agent. The prompt
  is written to `.plot-worker.continue.md` and its path travels in
  `PLOT_CONTINUATION`, beside the `PLOT_BRANCH` and `PLOT_WORKTREE` the dispatcher
  already exports. The `.plot-worker.` prefix is deliberate: the marker searches in
  both `plot-worker-state.sh` and `worker-question.ts` exclude it, so a prompt
  quoting the old question is not re-detected as a new one.

  **The stale marker is the new worker's to clear, and the prompt says so.** The
  route could delete it at spawn time; that was rejected. It would put a write to
  the branch's tree in an endpoint whose job is to start a process, and it would
  lie in the window that matters — between the delete and the new worker's first
  commit the branch reads `finished`, which is _review it_, aimed at a human, for
  work not yet done. Worse, a worker that fails to start would leave the branch
  reading finished forever with the question gone. So the marker stands from the
  answer until the continuation has acted on it. The cost is named: a continuation
  whose worker dies before clearing it leaves the branch reading `waiting`, and
  someone may answer twice. That is recoverable by looking; the alternative is
  not, because it shows nothing at all.

  Four refusals rather than one, each naming a different next move: `unknown-branch`,
  `no-worktree`, `no-question` and `no-worker-command`. A branch with no marker
  cannot be continued at all — the precondition is exactly the state the control
  was offered for, and without it a click could start a second agent in a worktree
  that holds a live one.

  The spawning guards are `/api/dispatch`'s, imported rather than rewritten: the
  same-origin check and the bounded body reader exist because this endpoint class
  spawns processes, and a second copy is a second place to forget them. The body
  bound is raised for this route alone and derived from the answer bound, so the
  two cannot drift into rejecting a legal answer as a transport error.

  The plan's `Branches` line said _prompted with the transcript and the answer_ —
  stale since the 2026-08-19 interrogation rewrote section 4. Both copies of that
  sentence are corrected, including the one in _What is NOT observable_ that the
  brief did not name; a decision recorded twice drifts in exactly this way, which
  is what produced this task.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is board-side only. `plot-dispatch.sh` and
  `plot-worker-state.sh` are deliberately untouched — the continuation reuses the
  dispatcher's own launch shape (`sh -c` over `Worker command`, the same
  `PLOT_*` environment, the same `.plot-worker.*` records) rather than teaching
  either script a second mode, and worker liveness stays the scan's single verdict.

- [#244](https://github.com/plot-pm/plot/pull/244) [`83cf7c0`](https://github.com/plot-pm/plot/commit/83cf7c00702d24188f4abe0bc634c11cb717e8ae) Thanks [@jwloka](https://github.com/jwloka)! - board: a WORKING row opens one view of the agent holding it

  Wave _Log_ served the worker's console; this serves the run around it. A WORKING
  row now opens a single panel carrying pid, uptime, the command that started the
  worker, branch, worktree, plan and wave — and, when the runtime's own session
  transcript is readable, the model, the context in use and when the agent last
  spoke. The log is the same live tail as before, now beneath the facts that say
  whose log it is.

  This wave is mostly assembly: every source it reads was already merged or
  already on disk. Nothing re-derives worker liveness, and nothing re-implements
  the log read — `plot-worker-state.sh` decides the first once and
  `/api/worker-log` already does the second. Neither script is touched.

  **A second on-demand route rather than new fields on the row.** The panel wants
  per-agent facts — a pid, a process's age, a transcript's model — and putting
  them on `AgentRow` would ride them out on the 4 s pulse, to every open tab,
  whether or not anyone had a panel open. `GET /api/agent-panel?branch=<branch>`
  follows the pattern `/api/worker-log` established for exactly this reason: the
  row asks, the server assembles. The pulse payload is unchanged, and that is
  asserted rather than intended — `/api/fleet` and `/api/board` are checked for
  the absence of a sentinel model name under any key, and for the absence of
  `uptimeSeconds`.

  The branch is resolved through the same lookup-not-validator boundary the log
  route documents: the request names a branch, and the answer comes from the
  worktrees the pulse itself reported. No request text becomes a path segment, so
  `../../etc/passwd` matches no branch and is answered rather than read.

  **Uptime is a reading, never a memory.** It is derived from the pid via `ps`,
  not from a timestamp stored at launch — because a stored one outlives the
  process it describes, and a row reading _up 4h_ for a worker that died in its
  first minute is worse than a row reading nothing. The same call that measures
  the age establishes there is something to measure: `ps` exits non-zero for a pid
  nobody is running, and the panel then shows no uptime at all. Asserted in both
  directions, including for pid `0` — `kill -0 0` signals the caller's whole
  process group and succeeds, a trap this repo has sprung before.

  **Model, context and last activity are read defensively, and omitted rather than
  guessed.** They come from `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, a
  private, undocumented format belonging to the runtime that may change under the
  board. When a field is missing or unrecognised the panel simply shows less: no
  error, no placeholder, no last-known value. The plan accepts this deliberately
  and the reasoning is load-bearing — _a stale model name read from a field that
  moved would be believed, while an absent one prompts a look at the transcript._
  Checking a `version` and reporting an unrecognised one would buy an error
  message at the price of a second thing to keep current, guarding fields that are
  conveniences rather than facts anything depends on.

  That failure mode is the wave's main risk, so it is asserted from both ends:
  eleven malformed transcript shapes each yield absence, a real transcript yields
  the three values, and the route test confirms the keys are _absent_ from the
  payload rather than null — a client rendering `body.model` gets nothing to
  print. Fields omit independently, so a format that moved `usage` but kept
  `model` still shows the model.

  Three details were measured rather than assumed, and two of them corrected the
  plan:

  - **`model` and `usage` are nested under `message`, not top-level.** The plan's
    summary put `model` at the top level; read there it returns undefined on every
    line — and because absence is silent by design, that would have shipped a
    panel that simply never showed these fields, with nothing anywhere reporting
    a fault. Confirmed 33/33 assistant lines.
  - **A worktree's transcript directory holds `agent-*.jsonl` sidechains** written
    by subagents, and they are routinely the newest files in it. A subagent's
    model and context are a true statement about the wrong process, so they are
    skipped by filename and by the `isSidechain` flag.
  - **The path slug replaces dots as well as slashes.** Worktree directories
    routinely contain dots, and a slug that kept them points at a directory that
    does not exist — which, again, would look exactly like a format change.

  **The scan stops at the first assistant line it finds from the end, even when
  that line yields nothing.** Walking past an unreadable current turn to a
  readable older one would report a superseded model as the agent's current one —
  the stale-value failure, reached by trying harder rather than by giving up. The
  first implementation did precisely that; a test caught it and now pins it.

  The omission rule is structural rather than repeated at each call site: `Fact`
  returns `null` for a value it was not given, so there is no code path that can
  print "—" or "unknown". A zero is still a value — `0s` of uptime is a real
  reading of a process that just started — so the check is for null, undefined and
  empty, never falsiness.

  The menu item reads _Show the agent_ rather than _Read worker log_, because the
  view is now about the agent and the log is one of the things it shows. It stays
  in the menu on WORKING membership, unchanged: the row says what IS, the menu
  says what you can DO, and nothing on the client guesses whether a panel will
  find anything.

  **The panel acts on nothing.** _Answer_, _Machine_ and _Registry_ are later
  waves and this sprint is deliberately read-only; no capability fields are added,
  since nothing records them.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` reads or documents the panel, and no helper script is touched —
  `plot-fleet-scan.sh` and `plot-worker-state.sh` are deliberately untouched,
  since every fact the panel needed was already derivable from what the scan
  reports or readable beside it on disk.

- [#236](https://github.com/plot-pm/plot/pull/236) [`8abac87`](https://github.com/plot-pm/plot/commit/8abac87e5992c963466730d1293084e377bcfdfa) Thanks [@jwloka](https://github.com/jwloka)! - <!--
  bumps:
    skills:
      plot: minor
  -->

  board: an issue is a signal the board can see

  Three issues sat open for hours — [#226](https://github.com/plot-pm/plot/issues/226), [#227](https://github.com/plot-pm/plot/issues/227) and [#228](https://github.com/plot-pm/plot/issues/228) — each written with
  request counts, timings, file paths and line numbers already in place. None
  appeared on the board, because the board reads `docs/plans/` and an issue is
  not a plan. Correct by the old design, and useless: the work existed and
  nothing surfaced it.

  WAITING ON YOU now lists open tracker issues **no plan references**. The
  section is for what needs a human decision, and the decision here is not _fix
  it_ — it is _is this worth a plan?_

  Not a fifth phase. The manifesto keeps issues as the inbox — signals, not
  commitments — and the four phases describe the path of a plan. So this is a row
  that is **not a plan**: `IssueRow` is its own shape rather than an `AgentRow`
  with six empty fields, because every field on that type describes a branch and
  an issue has not entered the lifecycle.

  The row takes the PR row's shape on the same seven tracks, with an issue glyph.
  Three refusals, each removing a fabrication:

  - **the inferred plan name is text, never an anchor** — nothing is behind it
    yet, and a link to a plan that does not exist is the fabrication this board
    keeps removing
  - **the branch column is empty** — a derived name would be indistinguishable
    from a branch nobody has claimed, a row this board already renders and which
    means something else entirely
  - **the number links to the tracker only when the host gave an address**,
    following `PrCell`'s own rule rather than inventing a URL

  `plot-plan-meta.sh` gains `issues`, read from a dedicated `## Status` `Issue:`
  line rather than from a scan of the body for `#NNN`. The plan asked which, and
  a body scan cannot tell a signal from a citation: the plan introducing this
  field cites [#226](https://github.com/plot-pm/plot/issues/226), [#227](https://github.com/plot-pm/plot/issues/227) and [#228](https://github.com/plot-pm/plot/issues/228) as history in its Motivation while naming
  PR [#232](https://github.com/plot-pm/plot/issues/232) two sections later. `prs` already answered the same ambiguity by
  reading only `→ #NNN`.

  `plot-host.sh` gains read-only `issue-list`, and three outcomes stay apart: an
  empty list means the host answered, a non-zero exit with empty stdout means the
  question failed, and exit 4 means the host cannot be asked at all (`bb` exposes
  no issue listing). `issueAnswer` carries that distinction to the client and
  defaults to `unsupported`, so an older server's silence never renders as an
  inbox that is clear — a failed lookup says so in the section rather than
  showing nothing.

  The reference is what makes a row disappear, and it is read from every plan
  file rather than from the fleet pulse: the pulse carries a rolling 24 hours of
  delivered plans, which is the right window for branches and the wrong one for
  decisions. A plan delivered last week is still the decision about its issue.

  Read-only in both directions — no labels, no assignees, no close-on-merge.

- [#249](https://github.com/plot-pm/plot/pull/249) [`e577f74`](https://github.com/plot-pm/plot/commit/e577f74c46416b105c22d4f2e024358a07ef28cd) Thanks [@jwloka](https://github.com/jwloka)! - board: `PLOT_BOARD_REPAIR` turns the repair off without turning the board off

  The artifact repair is the one automatic write in the whole system, and until
  now it was gated on state alone. An operator who wanted to _see_ artifact
  conflicts without the board acting on them had exactly one way to say so:
  stop the board. The design that introduced the repair called this switch
  non-optional, and it was the one piece of that design nobody built.

  **The default is on, and that is the point.** A switch that changes what
  happens merely by existing is a behaviour change wearing a flag. Unset repairs
  exactly as before, and that is asserted rather than reasoned — the assertion
  matters because the failure is silent. Reading unset as _off_ leaves the
  parser's own tests passing while every real board quietly stops writing, which
  from the outside looks identical to a repair that simply never triggered.
  Measured against the mutation: it breaks fifteen assertions, and thirteen of
  them are tests written before this change existed.

  **Only `0` turns it off.** Not `false`, not `no`, not the empty string. An
  operator who means to disable the repair and misspells the value gets a board
  that still repairs — the safe direction, because the default is the tested
  behaviour and this variable's job is to remove it deliberately, never to let a
  typo in an environment remove it by accident.

  **The switch subtracts and never adds.** `PLOT_BOARD_REPAIR=1` on a conflict
  touching source is refused exactly as an unset one is. `isArtifactOnly()`
  refuses any conflict set that is not exactly the artifact, and that refusal is
  what licenses the write at all — the repair is a script rather than an agent
  precisely because judgement's absence _is_ the permission. A variable able to
  overturn that refusal would take the permission with it, so the gate can only
  ever answer _may this process repair_, never _should this branch be repaired_.

  **Turning the write off does not turn the seeing off.** Detection and
  classification are untouched: the row still names the conflict it will not
  repair. An operator who silences the write and thereby loses the report has
  swapped one blindness for another.

  The gate stands **first**, ahead of every fence below it, because those record
  state as they refuse — `inFlight` marks a branch as under repair, `notObserved`
  remembers an input not to retry. A switch consulted after either would leave
  the registries describing a repair the process promised never to start, and the
  branch reported as under repair by a board that never touched it.

  An environment variable rather than a `## Plot Config` key: `plot-config.sh`
  describes the repo, while this is a runtime property of one board process, and
  two boards on one checkout may legitimately disagree about it. Read once at
  startup beside `PLOT_REPO_ROOT` and `PLOT_SCRIPTS_DIR`, never from inside the
  pulse, so a repair started under one answer cannot settle under the other.
  Turning it off takes a restart, which is the honest cost of a board that can be
  trusted to have meant it.

  `repairEnabled` sits on `BuildBoardOptions` rather than on the pulse's own
  options because it describes the process the way `repoRoot` does — and because
  that is what lets it reach `startRepair` down a call chain none of whose
  signatures had to change to admit it.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side runtime switch only. No helper
  script reads `PLOT_BOARD_REPAIR`, no skill prose decides anything from it, and
  `plot-resolve-artifact.sh` is deliberately untouched — the script's own
  refusals are the safety this gate sits above, not something it replaces.

- [#239](https://github.com/plot-pm/plot/pull/239) [`6d16443`](https://github.com/plot-pm/plot/commit/6d16443fad606201e43b07f956c09caf7451a52e) Thanks [@jwloka](https://github.com/jwloka)! - board: a WORKING row serves its worker's log, on demand and bounded

  `worker: finished` means one thing only — the process exited 0 — and two
  situations produce it that want opposite responses: the work is done (review
  the PR), or the agent asked something and stopped (answer it). The difference
  is in the log, which the board could not read. The log path is not a missing
  fact: it is `<worktree>/.plot-worker.log`, and the pulse already reports every
  branch's `local_worktree`. Nothing served it.

  `GET /api/worker-log?branch=<branch>` now does, and a WORKING row offers it
  through its menu.

  **Served on demand, pushed nowhere.** A 4 s pulse carrying every agent's
  console output to every open tab is a different product. The row offers; the
  panel fetches, and only while it is open — closing it unmounts the poller, so a
  board with no panel open fetches no logs at all. Both halves are asserted: the
  pulse payload is tested for the absence of log content under any key, and a
  browser test opens the board, waits, and fails if a single log was fetched
  before anyone asked.

  **The request names a BRANCH; the path is derived server-side.** A request
  carrying a path would be a file-read primitive pointed at the whole filesystem,
  dressed as a board feature. `worktreeForBranch` resolves the branch against the
  worktrees the pulse itself reported and joins a constant filename inside the
  answer, so no request text ever becomes a path segment. This is the same shape
  `/plan/<file>` uses — resolve the name against the board's own collected
  documents — and it is chosen over pattern-validating the branch for the reason
  that route gives: a validator is a rule every future endpoint must remember,
  while an allowlist derived from data the server already holds cannot be
  forgotten. Git also permits nearly anything in a branch name, so a regex here
  would be both weaker and more likely to reject a legitimate branch. A branch
  with no known worktree is a 404, never a read attempt.

  **The bound is 64 KiB, and it bounds the READ rather than the reply.** The
  question a log answers from the board is _what is this agent doing right now_,
  and that answer is always in the last screenful; 64 KiB is roughly 700 lines,
  more than the panel shows and enough to read backwards through a stack trace.
  Scrollback beyond it is a different errand, served by the path the response
  carries — a pager handles a 60 MB log far better than a browser does. The file
  is never loaded and then sliced: `readTail` takes the size from the open
  descriptor and reads only the last 64 KiB, so a 2 GB log costs what a 2 KB one
  does. A bound that still allocates the file it is bounding is not a bound.

  A truncated tail drops its first line, because a byte-offset seek lands mid-line
  and, with any non-ASCII output, mid-character. `truncated` travels as a field
  rather than being inferred: a client comparing `text.length` to `bytes` compares
  UTF-16 code units to bytes and would call a whole log truncated the first time
  an agent printed an emoji. The panel states the truncation and names the full
  size — a tail presented as a whole log is the same defect this board keeps
  removing.

  **Absence is not emptiness — four outcomes, four answers.**

  | Outcome       | What is true                          | The reader's move            |
  | ------------- | ------------------------------------- | ---------------------------- |
  | `no-worktree` | this machine holds no checkout        | ask the machine that took it |
  | `no-log`      | the worktree is here; nothing wrote   | look in the worktree         |
  | `unreadable`  | the file is there and would not open  | fix the permission           |
  | empty log     | a worker started and has said nothing | wait, or check its pid       |

  The empty case is deliberately **not** one of the failure reasons. It is a
  successful read of zero bytes — `ok: true`, `bytes: 0` — and typing it as a miss
  would put a real observation in the same shape as the three non-observations.
  `no-worktree` is the only 404: a worktree with no log is a successful
  observation, and a 404 there would tell the client to stop asking about a row it
  should keep offering. Four distinct sentences are asserted as four, since a
  panel rendering them alike passes every single-case test.

  **The item is in the menu, not on the row**, and the structural gate
  (`a row's actions all live in its menu`) is what settled it — the row says what
  IS, the menu says what you can DO, and a row names its branch, plan and PR, not
  its worker's console. The neighbouring precedent is `Open last run`: a read,
  about a process the row reports on rather than one the row is. Like that item it
  joins `enabled` without a `WillAct` term, because reads are not refused.

  **The item is offered on WORKING membership and answered by the server.** The
  row carries no worktree and no worker state — this wave adds no field to the
  contract — so nothing on the client can know whether a log exists. It does not
  guess. An item conditioned on the log existing would be missing in exactly the
  cases the endpoint was built to tell apart, and a reader cannot tell an absent
  item from an absent log.

  Log content renders as text, never as markup: agent output is arbitrary bytes
  and frequently includes markup the agent was asked to write.

  Two existing assertions changed, both because their premise moved rather than
  their rule. `stuck-rows` asserted a healthy WORKING row renders no menu, on the
  grounds that it had nothing to do; it now has one thing to do. `agents-tab`
  asserted no menu on claimed rows, guarding against offering to dispatch a branch
  somebody already holds — that guarantee is now asserted on every row directly
  (`Start work` is absent) rather than via the menu's absence, which keeps the
  guard on `feature/beans-a`, the row that most needs it.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` reads or documents the Agents tab's menu, and no helper script is
  touched — `plot-fleet-scan.sh` and `plot-worker-state.sh` are deliberately
  untouched, since the log path was already derivable from what the scan reports.
  The `/api/fleet` and `/api/board` payloads are unchanged, which is the point of
  the wave and is asserted rather than intended.

- [#286](https://github.com/plot-pm/plot/pull/286) [`1254e2d`](https://github.com/plot-pm/plot/commit/1254e2da1bbde11845d49627552696d907006065) Thanks [@jwloka](https://github.com/jwloka)! - board: a blocked wave's row names how many branches it waits on

  `blocked by Fold` already named WHICH wave a row waits for. It did not say how
  many branches are left in it, so a reader learned the blocker's name and nothing
  about how close it is to clearing. The row now reads `blocked by Fold —
2 outstanding`: the same sentence, with the number the scan already computes.

  The count is the blocker wave's non-deferred, unmerged branch count — the exact
  predicate `plot-fleet-scan.sh`'s Pass 2 settles a wave on, so the board's number
  and the scan's verdict read one fact rather than two that can drift. The scan
  ships the wave's branch list rather than a count, so the board derives it, which
  is where Manifesto Principle 3 puts the interpretation: the scan collects, the
  board counts.

  `blockedNote()` gains the count as an optional second argument and appends it
  only where the wave is named. An UNNAMED blocker keeps the bare _blocked by an
  earlier wave_: the count answers _how many are left in THAT wave_, and "that
  wave" is only referable once it has a name — a dangling _— 2 outstanding_ on a
  nameless sentence would attach a number to a wave the reader was never given. A
  plan with a single wave cannot be blocked at all (there is no earlier wave to
  wait on), so it is never reached and shows no count.

  `rowsFromPulse` derives the count once per plan, beside the blocker name it
  already resolved — both answer the same reader's question about the same wave,
  and computing them together keeps the name and the number from disagreeing.
  Nothing new reads the prose: `verdict` and `blockedBy` remain the fields a
  consumer reads, and this only sharpens the sentence a person sees.

    <!--
    bumps:
      skills:
    -->

  No skill version bumps: this is a board-side change only. No helper script is
  touched. `blockedNote` gains an optional argument, so every existing caller is
  unchanged and the `/api/fleet` payload keeps its shape — the sentence a row
  carries is longer, not differently typed.

- [#260](https://github.com/plot-pm/plot/pull/260) [`c2dd5f2`](https://github.com/plot-pm/plot/commit/c2dd5f239e7c896a9f907db5f6c06156f7cd37b4) Thanks [@jwloka](https://github.com/jwloka)! - board: a branch row carries its PR link, and a merge no longer erases it

  Reported by the operator looking at the board: the plan name in a row is a
  link, the branch name beside it is inert text. Measured on one `/api/board`
  pulse — a plan row carried `slug, title, type, phase, path, prs, phaseDate,
story, waveSummary`, and a branch row carried `branch, path`. Zero of seven
  branch rows held a `pr` field.

  **The field already existed, and so did the renderer.** `AgentRowSchema.pr` has
  carried `{ number, url, draft, state }` for several releases, `rowsFromPulse`
  already assigned it, and `PrCell` already renders `url` as a link — the same
  component `WAITING ON YOU` uses for `[#240](https://github.com/plot-pm/plot/issues/240)` and `[#57](https://github.com/plot-pm/plot/issues/57)`. Nothing needed inventing,
  which is why the row's emptiness was mistaken for a styling omission twice
  before anyone read the payload.

  What was missing was one filter's second consumer. `refreshPrs` indexes only
  open PRs by head:

  ```
  if (pr.head && pr.state === 'OPEN') map.set(pr.head, pr);
  ```

  That filter is correct for the question it was written for. A merged PR handed
  to `classify` would answer for a branch whose git state has already answered,
  reopening a question the merge closed — the comment above it says so. But the
  same map also decided the row's LINK, and there the filter drops exactly the
  PRs a reader still wants: the finished ones.

  **A PR OUTLIVES ITS BRANCH, and that is the whole case.** Measured on this repo
  2026-08-20: [#252](https://github.com/plot-pm/plot/issues/252), [#253](https://github.com/plot-pm/plot/issues/253) and [#254](https://github.com/plot-pm/plot/issues/254) are `MERGED` with real URLs and their refs
  deleted. The PR page is the only remaining record of that work, and all three
  reached the row as `pr: null`. The link had to survive a deleted ref, and the
  open-only map is precisely where it could not.

  So the two uses are split rather than the filter loosened. `prsByHead` is a
  third index off the same fetch — the precedent `prsByNumber` set and states
  ("one fetch, two indexes") — holding every PR keyed by head. `classify` keeps
  the open-only map and decides the group and the note from it exactly as before;
  `rowsFromPulse` reads the link from the new one, falling back to the open PR so
  every existing caller is unchanged. The two records are the same on an open
  branch and differ only after a merge, which is the case that was losing its
  link.

  **No new host call, and that is the reason the fix is cheap.** The number was
  already in hand: `pr-list --state all` is fetched once on the slow PR timer and
  the merged PRs are already in that answer — the pipeline computed them, used
  them for one decision, and dropped them before shaping the row. All three
  indexes are built from that one response's loop. Asserted structurally rather
  than behaviourally, following `a row's actions all live in its menu` and for its
  stated reason: a second `pr-list` on the row path would sit behind a poll timer
  and a cache, where no unit fixture reaches, while a source scan sees it whether
  or not any test data does. The board polls every 5 s against a metered API, so
  a per-row lookup here is not a small regression.

  `prOutranks` decides which PR a head with several of them yields — a closed
  attempt and its reopened successor. Open outranks finished, because a closed PR
  winning would send a reader to a dead page while the live review sat one number
  away; between two in the same standing the higher number wins. Merged is
  deliberately not ranked above closed: both are finished and neither is more
  current, so the number decides and decides consistently. Until this function
  existed the answer came from the host's listing order, which no adapter
  promises — `gh` sorts by number descending, `bb` documents nothing.

  **One regression this would otherwise have introduced, caught and fixed.**
  `hostCannotReportCi` prints _this host cannot report CI_ when every PR-bearing
  row reads `unknown`. A merged PR reports `mergeable: "unknown"` on GitHub —
  mergeability stops being computed once a branch lands — so merged rows now
  arrive as `unknown` from a host that answers CI perfectly well. Before this
  change they had no `pr` at all and fell out of that tally by accident. Counting
  them would turn a plan of merged branches plus one PR mid-outage into a false
  claim about the host, with the hint's own words ("nobody could look") printed
  under a section that was simply quiet. Merged rows are now excluded by the
  function's own stated rule: a row with nothing to report is not evidence about
  the host either way.

  `/api/attention` needed no change and was checked rather than assumed:
  `readingFor` returns null for `state === 'merged' || group === 'done'` ahead of
  every `row.pr` arm, so a merged row never reaches the PR switch.

  The contract's own wording is corrected too — `AgentRowSchema.pr` read _the open
  PR for this branch_, which was never a decision about the contract so much as
  this cache filter leaking into it.

    <!--
    bumps:
      skills:
    -->

  No skill version bumps: this is a board-side change only. No helper script is
  touched, and `plot-fleet-scan.sh` already resolves each branch's PR to decide
  `merged` — Manifesto Principle 3 keeps the interpretation on the board's side.

- [#275](https://github.com/plot-pm/plot/pull/275) [`3d7b666`](https://github.com/plot-pm/plot/commit/3d7b6660adb59b60025e1f6be6f7f1682db8277f) Thanks [@jwloka](https://github.com/jwloka)! - board: a branch row names its wave, where the plan has more than one

  The Agents tab showed plans and it showed branches, and between them the wave —
  the level that decides ordering — had no line of its own. `row.wave` was on the
  contract and no component read it: the field arrived and stopped.

  The wave name now takes the PHASE cell on a branch row. That column showed the
  plan's phase, which is the same word on every branch of one plan; which wave a
  branch belongs to is the fact that varies row to row, so it is what the column
  is for. No seventh track — the grid keeps its seven columns, and a row naming a
  wave starts its branch cell at the same x as one naming a phase.

  Shown only where the plan divides its work, and the rule is the wave COUNT, not
  the presence of a name. Measured across the estate: no plan divides its work
  without naming the parts (the `### ` heading is the division), so a count above
  one is always a count of named waves — while a plan whose single wave carries a
  name is still one wave, and a caption over a partition of one is noise. Keying
  on presence would label that plan and leave the eleven branches in unnamed
  single-wave plans bare; keying on the count labels exactly the rows where the
  answer to _which slice of this plan?_ is not "all of it".

  The count is PLAN-WIDE, read from the whole fleet rather than one section's rows:
  a plan's branches scatter across sections — one working, one not started — and
  whether the plan has more than one wave is a fact about the plan. `waveCountByPlan`
  and `waveLabel` are pure and pinned in test/unit; the DOM half — the name in
  every section, the two single-wave cases (named AND unnamed), the grid holding
  still — is in test/integration/agents-tab.browser.test.ts.

  Reads `row.wave`, writes nothing to the scan: the scan already emits
  `wave.name || '(unnamed)'` per branch. Manifesto Principle 3 puts the
  interpretation on the board's side of the line.

- [#303](https://github.com/plot-pm/plot/pull/303) [`f0e71b6`](https://github.com/plot-pm/plot/commit/f0e71b661f201b8d0ed4406c270f457c5eff340d) Thanks [@jwloka](https://github.com/jwloka)! - board: a broken agent says what broke and where to look

  The **Surfaced** wave of `2026-08-20-every-section-has-one-subject.md`, after
  `bug/an-agent-is-not-a-machine-you-wait-on` ([#300](https://github.com/plot-pm/plot/issues/300)) settled the machine section.

  WAITING ON YOU is for what needs a **person's decision** — a PR, a branch, a
  plan, a release, a build. An agent has no business there while it works: an agent
  _is_ the worker, and WORKING is the section that says so while also saying _who_.
  **An agent appears here only when something is wrong with the agent**, and its
  presence is then itself the signal.

  **The placement was already right, and that is the finding this wave starts
  from.** Measured before changing anything: `failed`, `ended` and `stalled`
  already return `group: 'waiting-on-you'`, and `running` and `waiting` already
  return `working`. The three broken states were in the right section and said the
  wrong things there — so what this wave changes is the sentence, not the routing.
  The plan's own table anticipated the two representable cases; what it could not
  see from the outside is that both were already representable _and already
  placed_.

  **The notes said what to do, and they are not entitled to.** They read _worker
  failed (exit 127) — restart it_ and _worker stopped with work unfinished —
  resume it_. Both are verdicts about the schedule: whether a crashed agent is
  worth restarting depends on what its log says and on what else is in flight,
  neither of which the classifier can see — and the board restarts nothing in any
  case, since relaunching is `/plot-dispatch`'s to do. Evidence, not verdict, is
  the estate's rule for exactly this (Manifesto Principle 3: scripts collect,
  humans conclude), and it is what `HOST_ANSWER_HINT` and the changed-files modal
  already follow.

  | state     | before                                                | after                                                              |
  | --------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
  | `failed`  | `worker failed (exit 127) — restart it`               | `worker crashed — exited 127 · log: …`                             |
  | `ended`   | `worker ended, exit status unknown`                   | `worker stopped, exit status not recorded · log: …`                |
  | `stalled` | `worker stopped with work unfinished (…) — resume it` | `worker stopped without finishing and without asking (…) · log: …` |

  **Advice still exists, in the surface whose declared job it is.**
  `AttentionItem` carries `action: 'restart it'` beside the `verdict` a consumer
  branches on and the `evidence` it traces to — auditable by construction. So
  _restart it_ is right there and wrong in a note, and `attention.ts` is untouched.
  The two surfaces are not inconsistent; they answer different questions.

  **The two broken kinds must not share a sentence.** _Stopped without finishing_
  is not _crashed_, and the reader does different things with them. A `stalled`
  worker **exited 0** — the process ended normally and the tree says the task did
  not end with it, which is why `stalled` is a TASK state rather than a process
  one — so there is no exit code to report and nothing crashed. _Without asking_ is
  the half that earns the phrase and is not rhetorical: a worker that stopped to
  ask is `waiting` and stays in WORKING, so reaching the stalled arm means the scan
  found no marker. Without that clause a reader cannot tell an abandonment from a
  question they overlooked. `ended` names neither, because the record that would
  settle which is the thing that is missing.

  **The row names where to look.** A reader told an agent crashed and not told
  where its log is has been informed, not helped — they still have to find the
  worktree, which is the errand the row existed to save them. The clause names the
  log _file_ and the worktree: the log is a dotfile, so a reader given only the
  directory runs `ls`, sees nothing, and concludes there is none.

  **The path is never probed first.** Deciding the clause on `existsSync` would
  make one sentence depend on a disk read taken at scan time and rendered later, so
  a log rotated between the two would silently drop the only pointer the row had.
  The clause says _where a log would be_ — true whether or not the file survived —
  and `/api/worker-log` answers _is there one_, which it already does with
  `no-worktree`, `no-log`, unreadable and empty as four distinct outcomes. One
  question, one owner.

  **`classify` takes the worktree path, after `held` deliberately did not.** `held`
  is the authoritative form of `local_worktree` _for the WORKING lift_ — a boolean,
  because a lift must not be decided on a path's mere presence, which is the
  merged-leftover misread it exists to prevent. That argument is about DECIDING,
  and the new parameter decides nothing: it lands in a sentence a person reads. So
  both are right and both are there, and neither derives from the other — a merged
  leftover has a path and earns no lift, while a branch held on another machine has
  no path here at all. `""` is a stated absence and the clause is simply omitted:
  the path is meaningless on any other machine, so a reader elsewhere gets the
  evidence and no location rather than a directory that does not exist where they
  are reading.

  **Nothing in `AgentList.tsx` changed.** The note renders `truncate` with
  `title={note}`, so a longer sentence is clipped visually and whole on hover — and
  the location rides at the end behind the estate's `·` separator, so truncation
  loses the path before it loses the fact. Two other branches are rewriting that
  file in parallel; this wave stayed out of it.

  **The regression guard on [#300](https://github.com/plot-pm/plot/issues/300) is asserted from this side.** The two sections now
  have disjoint agent rules — WAITING ON YOU takes an agent only when it is broken,
  WAITING ON A MACHINE never takes one at all — and this is the wave that gave
  agents a reason to be routed anywhere, so a future change surfacing a broken
  agent by pushing a process entry would re-create [#300](https://github.com/plot-pm/plot/issues/300)'s duplicate exactly. The
  sweep runs over the whole `WorkerState` enum with `local_worktree` set, since that
  is the field this wave newly reads.

  **A negative assertion was disarmed by the rewording, and re-armed.** The
  ordering guarantee _waiting outranks stalled_ — measured causing two restarts of
  one branch, the second re-running work the first had finished — was guarded by
  `expect(note).not.toMatch(/resume it/)`. Rewording the stalled note made that
  pass vacuously against a string nothing composes any more. It now asserts the
  wording the stalled arm actually produces, plus positively that the row carries
  its question.

  **`compact context` is not here and cannot be.** The plan's third broken case is
  undetectable: an agent with a full context still reports `running`, because the
  condition is in the transcript rather than in the process. The registry reads
  `contextTokens` for it and it arrives **absent** — this repo's `Worker command`
  forwards no `--session-id`, so the transcript join degrades. Inferring it from
  uptime or a token guess is what the plan's open point forbids until that forward
  is fixed, and this wave does not.

  **What deliberately did not change.** WORKING keeps `running` and `waiting`,
  including a worker that stopped to ask — its question is its note, and moving it
  would say a person must decide when an agent is mid-task. `finished` stays in
  WAITING ON YOU as a result to review and is not described as broken; review and
  restart are opposite moves. No PR, branch or plan row moves, and a conflicting PR
  still outranks a worker. Making WORKING agent-centred is the next wave.

  `WORKER_LOG_FILENAME` is a second spelling of `worker-log.ts`'s
  `WORKER_LOG_NAME`: that module imports `pulseFor` from `fleet.ts`, so importing
  back would close a cycle. Both describe one `plot-dispatch.sh` constant — the
  shell is the source, and `continue.ts` already spells it a third time inline.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change to one sentence and its
  routing. No helper script composes a row's note, `plot-fleet-scan.sh` is
  untouched — the worker states it reports are unchanged — and the `/api/fleet`
  payload loses no field. What changes is what a broken agent's row _says_, and
  `local_worktree` was already on the pulse.

- [#284](https://github.com/plot-pm/plot/pull/284) [`55d95f2`](https://github.com/plot-pm/plot/commit/55d95f2ccbeac39fe8dfebb6c435ab5b70450444) Thanks [@jwloka](https://github.com/jwloka)! - board: a degraded view says so at the top

  The board's failure notes were scattered — a dead server and a broken scan
  stacked as two banners at the top, a shrink as a third, and the PR-failure note
  sat at the FOOT of the Agents list, below every row it qualified. Two costs
  followed: a reader scanning WAITING ON YOU and WAITING ON A MACHINE met the
  incomplete rows before the sentence saying they were incomplete, and independent
  failures read as unrelated notes rather than as one condition — with a third one
  pushing the work down the page.

  There are now two surfaces answering two questions. A `StatusPanel` at the TOP
  answers _is something wrong?_ — one fixed-size box carrying every status the
  board has to report, most-severe-first (a dead server outranks a broken scan
  outranks a shrink outranks a spent host), newest-first within a severity. It
  names how many it holds (`2 of 3 statuses`) and pages through them, so a third
  problem is one click away rather than off the bottom of the screen. A status that
  arrives while the reader is watching flashes at the top for a few seconds and
  then sorts into place — arrival is worth interrupting for, permanence is not; the
  statuses already present when the panel first mounts are not treated as arrivals.
  The panel disappears entirely when there is nothing to report, because an empty
  status box is a claim the board is watching something and a healthy board is not.

  The view-status line — `74 branches across 23 plans · scanned 4s ago · PR data
16s ago` — stays at the FOOT and is unchanged. It answers a different question,
  _how fresh is what I see?_, and it is always true, which is exactly what
  disqualifies it from a panel whose contract is to vanish.

  The in-section `[data-issue-error]` note is untouched: it points at the exact
  place the missing issue rows would have appeared, which a top panel cannot do.

  Corrected mid-implementation from a first reading that proposed one banner per
  condition in the `UnreachableOverlay` frame — that is one-per-condition wearing a
  different coat, and two problems would still stack two frames.

  Tests: the ordering is pinned as a pure function (severity, tie-break by
  arrival, and the arrival flash); six browser assertions cover the panel end to
  end — two conditions render one panel, it names its count, paging preserves the
  order, a new status flashes then sorts in, the panel is absent when there is
  nothing to report, and the footer line stays at the foot and unchanged.

    <!--
    bumps:
      skills:
    -->

- [#287](https://github.com/plot-pm/plot/pull/287) [`50ef368`](https://github.com/plot-pm/plot/commit/50ef3681fb332ecc2b862af18a6722d1ca9dd9f6) Thanks [@jwloka](https://github.com/jwloka)! - board: a failing check shows its step and its age, and its file list moves to the menu

  `[#266](https://github.com/plot-pm/plot/issues/266)` carried its failure as prose: a wrapped list of six changed files and a
  raw `2026-08-20T03:55:23Z`, in the row. Both facts were right and both were in
  the wrong form — the row dumped what it should have shaped.

  **The changed-file list moves behind the `⋯` menu.** It was the third of three
  evidence lines a `ci-failing` row printed, and it is the one that is unbounded
  and consulted rarely — so every reader scrolled past a paragraph of paths so
  that the occasional reader who wanted them did not have to click. The menu item
  COUNTS rather than lists (_Changed 6 files_), because an item naming the paths
  would put the dump one click away instead of removing it; the count is also what
  a reader uses to decide whether to open it at all. The panel it opens prints the
  paths in the order the host gave them, unsorted and unhighlighted — the contract
  is explicit that nothing maps a failing step to a changed path.

  _EVIDENCE TRAVELS WITH THE STATE_ is unchanged and is what licensed the move:
  the rule is honoured by the evidence being reachable from the row, not by all of
  it being printed in the row. The three facts of a failing check are not equal in
  cost — a step name is four words and often ends the investigation, a path list
  is a paragraph — and the row now spends its width accordingly.

  **The run time renders as an age.** The host reports ISO 8601 and the contract
  keeps it verbatim, which is right for a contract and wrong for a row:
  `2026-08-20T03:55:23Z` makes a reader do date arithmetic to answer the only
  question they asked — _is this fresh_. It reads `failure 2h ago` now, through
  `agoLabel`, the board's existing age dialect rather than a second one. An
  unparseable timestamp omits the age and still reports the run's conclusion,
  rather than rendering `Invalid Date`.

  **No new field, no new route, and no fetch on click.** `changedPaths` was
  already on the row, on the pulse that drew it — so the menu item asks the server
  nothing at all, which makes it the purest read in that menu. The contract is
  untouched: `startedAt` stays ISO 8601 as the host sent it, and the formatting
  happens where formatting belongs.

  The row's two remaining evidence lines still say _unavailable_ where a field is
  empty, and the changed-path line deliberately does not: its absence from the row
  is now the design rather than a missing fact, so a placeholder there would be
  prose of the same width making a weaker — and, where the menu holds the paths —
  false statement.

  A fixture is fixed on the way past: the `ci-failing` browser row carried
  `startedAt: '10:19'`, which no host ever sends. An unparseable stub is why a
  test watching that row could not have failed for the raw timestamp that reached
  the screen.

- [#270](https://github.com/plot-pm/plot/pull/270) [`e32df88`](https://github.com/plot-pm/plot/commit/e32df88a36360a3e8ad5949146618964d6b8dfed) Thanks [@jwloka](https://github.com/jwloka)! - board: WAITING ON A MACHINE is keyed on the process, not on the holder

  The section is named correctly and was filled from exactly one source:
  `pr.checks === 'pending'` on the git host. So it described what happens on the
  HOST while the board sat in the very repository a local run was happening in — a
  `vitest` run, a build, a scan in a worktree is a machine working that the board
  could not show. A correct rule with too small a scope, the same shape
  `worker: running` had when it was sealed inside the `claimed` arm.

  Two measured cases fell through a rule keyed on who HOLDS a branch, and they
  fall in opposite directions:

      exit 0, branch pushed, PR open, validate pending, guard: working=0
        -> NEITHER section. Not WORKING, because no agent held it; not WAITING ON
           YOU, because the checks had not landed.

      one live worker, PR open, checks pending
        -> BOTH, and a single `group` must pick one and be wrong about the other.

  **The row stops being the entity.** WORKING lists AGENTS — _this agent is on
  `bug/x`_ — and WAITING ON A MACHINE lists PROCESSES — _CI is running for
  `bug/x`_. The same branch appearing in both is not duplication: the entities
  differ, and _who is working?_ is a different question from _what am I waiting
  on?_. Each entry names its branch, so two lines never read as one repeated.

  `AgentRowSchema` gains `processes` — a list of `{ origin, evidence, pid }`,
  where `origin` is `host` or `local`. It does NOT decide the section. `group`
  still says where the branch's own row goes, unchanged, and the new field says
  which processes the machine section additionally lists; a row can therefore be in
  WORKING and have a process in WAITING ON A MACHINE at once without either field
  contradicting the other. Folding process liveness into `group` is exactly what
  made the both-sections case a coin toss, so it is not re-folded there — and
  `classify` still returns a single placement, which a test pins.

  **Derived, never collected anew, and that was checked before anything was
  added.** Both entries come from facts the pulse already carries: `worker` and
  `worker_pid` for a local run, `pr.checks` for a host one — both already read by
  `classify` two arguments away. The alternative was to enumerate processes whose
  cwd lies inside a worktree, and it is rejected on two counts: it would collect
  every editor and shell a person happens to have open in a checkout and report
  them as machines working, and it would be a new cost on a scan this repo's own
  comments measure at 18.3 s. The fleet writes a pid where it starts a process;
  that pid IS the observation, and it is the only local process the board can
  honestly claim to see. `plot-fleet-scan.sh` and `plot-worker-state.sh` are
  untouched.

  `running` ONLY, of the eight worker states, and the seven negatives are most of
  the field's meaning. `finished`, `failed` and `ended` are stopped; `waiting` and
  `stalled` describe a TASK rather than a running program; `none` and `elsewhere`
  are stated unknowns — `plot-dispatch` writes a pid only where it started the
  worker itself, so an absent record licenses no claim in either direction.
  Listing any of them would put _a machine is working_ under a branch where none
  is.

  **Evidence, never a forecast** — the rule this plan estate repeats at every
  level, and the one place it is visible to a reader. Each entry says what was
  OBSERVED: _a worker process is running in a local worktree (pid 20145)_, _CI is
  running for PR [#244](https://github.com/plot-pm/plot/issues/244)_. No entry names a remaining time, because nothing measures
  when a local run ends and GitHub publishes no finish time for a queued check.
  The section's empty hint loses its forecast for the same reason: _nothing — CI
  will finish_ predicted an outcome nothing here measures and named the one source
  the section used to have, and it now reads _nothing — a machine is working_.

  The section's sentence is the PROCESS's, not the branch's, and that is what
  defends listing a branch twice. A live worker's `note` is _worker running (pid 20145)_ — a true statement about an AGENT, which the WORKING row already makes.
  Repeating it under WAITING ON A MACHINE would put one line in two sections and
  prove the duplication complaint right, so the row takes a `section` prop and
  composes from `processes` there. Passed in rather than derived from `row.group`,
  because `group` is precisely what cannot answer it: a live worker's group is
  `working` in both places it renders.

  A host-side pending check still lands there through `group`, whether or not any
  process is listed — the first clause of the predicate is the old rule verbatim,
  so a pulse from a scan predating the field renders unchanged. The client reader
  also tolerates the field being absent entirely: the page is a built artifact a
  reader may have open across a restart and `/api/fleet` answers from whichever
  server is running, so reading `.length` off an absent array would take the whole
  board down over a missing convenience field.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. No helper script is
  touched, and the `/api/fleet` payload gains a field rather than changing one —
  an older client's schema strips what it does not know, and an older server's
  payload validates against the new one by the default.

- [#293](https://github.com/plot-pm/plot/pull/293) [`27747b1`](https://github.com/plot-pm/plot/commit/27747b15465a49908f2cb45cce5ee69c3b7ee9e9) Thanks [@jwloka](https://github.com/jwloka)! - board: a row is a tuple — six slots, seven kinds, and the kind is a field

  Every row on this board is one of seven things — a ticket, a plan, a PR, a
  build, an agent, a branch, a release — and each answers the same six questions.
  It carried **23 fields** through **two competing grid definitions**, chosen by
  whether the row was a plan, and which fact reached which column depended on the
  plan's wave count, which a reader cannot see. Five row defects were reported from
  screenshots in one night; they share one cause — **there was no shape that every
  row is**, so each kind grew its own rendering and its own exceptions.

  This lands the shape. It **deletes nothing**: `Row`, `PlanRow` and
  `IssueRowView` keep working, and the wave that replaces them goes last on
  purpose — `AgentList.tsx` took eleven commits on 2026-08-20 alone and conflicted
  on nearly every merge that day, so the collapse goes when no sibling branch is
  open against it.

  **`kind` is a FIELD, set where the row is created.** Deriving it in the renderer
  from `row.pr`, `row.planFile` or the branch name is declined, and the reason is
  the defect this exists to fix: a derivation is a guess with a rule attached, and
  the rule breaks first where two kinds share fields. **A release is a PR** whose
  branch is named `changeset-release/main`, so any renderer-side rule must either
  hardcode that name or misclassify the one row nobody should merge by reflex —
  and that row arrives through the planless loop, where nothing else marks it. The
  four-meanings phase column was also a derivation, from the plan's wave count,
  and it produced four answers in one column. A structural test strips comments
  and asserts the release name is matched in the server and nowhere else.

  **`kind` is what the row is ABOUT, not which object it came from.** Measured
  2026-08-20: of 80 live rows, **67 carry both a branch and a PR** and only 13 a
  branch alone — so the both-case is the normal case and `branch`/`pr` are two
  ROLES one row can be in. A **merge conflict** makes it `branch`, because no PR
  resolves a conflict and the reader has to go rebase; anything else with an open
  PR makes it `pr`, because the fix updates the PR. This costs the design a
  simplification worth stating: `kind` is not a property of a thing, it is a
  judgement about a row, made once where both facts are in hand.

  **Slot 4 is zero-or-more, and that is where the slot count bends.** A branch
  carries no artifact link and a PR carries two — its plan and its branch — so a
  fixed second slot would force a PR to drop one and the reader would lose
  whichever lost. Every named thing is a link and each says WHAT it points at, so
  three links on a PR row do not read as three interchangeable words. All three
  facts were already on the row; what was missing is that only some rendered and
  only one was a link. It also repairs the measured defect that branch rows
  carried **zero of seven** URLs, so a plan name was a link and the branch beside
  it was inert text.

  **Age is one clock — since last change — and the label marks the exception.**
  The schema had already reached half of this and written down the reason: the
  comment on `waitingDays` argues that `22d` (no commits for three weeks) beside
  `22d` (never begun) is why _the row labels it rather than merging it_. The row
  did not. Now a not-started row's approval clock and an agent's two clocks are
  labelled, and nothing else is — the inverse of the phase column, which was
  unlabelled _because_ its meaning varied. An agent gets `27m · idle 4m` because
  an agent does not change, it acts.

  **The contract carries all seven kinds and four render nothing.** A kind with no
  data renders NO ROW, not an empty one. A shape that admits only what exists
  today has to be reopened per kind, which is exactly how three components and two
  grids happened. The agent kind is designed against a registry that does not
  exist yet, and the risk is named rather than discovered later: its name is the
  **session id** the runtime writes as its transcript filename — the identity that
  survives the branch — and the plan's own `@Dev-Agent` example is dropped as a
  placeholder that was never a fact.

  **A release carries only a mark, never an action.** Its menu holds _Open on
  host_ and nothing else; even _show what this would ship_ is declined, because it
  reads harmless and makes the board the place release decisions are prepared,
  which is the first step toward being where they are taken. Enforced rather than
  promised: the kind is handed no menu item and the component invents none.

  **No new host call, and no new field fetched.** Every slot is derivable from what
  the pulse already carries — this is a shaping change. A test asserts the
  projection imports the contract's types and nothing else, and that no `fetch` or
  host adapter appears in it.

  A DOM half is tested in a real browser against a bundled harness, because the
  tuple has no live call site yet and `/api/fleet` therefore cannot reach it. This
  repo has no component-test seat — `environment: 'node'`, no jsdom — and reading
  source is the honest answer for _which utility did this component choose_ but not
  for _is this text visible without hovering_: a regex over JSX would pass on a
  `title` attribute holding the same word. When the collapse wave gives the row a
  call site, those assertions move to the board's own page and the harness goes.

- [#302](https://github.com/plot-pm/plot/pull/302) [`c424bf7`](https://github.com/plot-pm/plot/commit/c424bf79fec2698776b35f9f34b85d19a0a71b6a) Thanks [@jwloka](https://github.com/jwloka)! - board: a section heading is drawn larger than the rows it introduces

  Measured in a rendered board on 2026-08-20, and the defect is worse than it was
  reported. The section `<h2>` was `text-xs` — **12px** — while the row it
  introduces is `text-sm` and its branch name renders **13px**. The strongest
  structural break on the page was not merely equal to the weakest thing inside
  it; it was set _below_ it. The plan `<h3>` under the section was `text-[11px]`,
  smaller still, so the three levels were ordered exactly backwards: heading 11 <
  section 12 < row 13.

  **The report said "the same size"; the screen said "smaller".** The plan's table
  recorded row text at 12px, which is true of a row's _supporting_ cells — the
  kind, the PR state, the age. It is not true of the branch name, which is the
  row's subject and its most prominent text. A fix aimed at clearing 12px would
  have left the heading level with the thing a reader actually scans. This is why
  the sizes were re-measured in the browser rather than taken from the table, and
  why the test asserts against the **largest** size a row draws.

  **This is the second half of a finding whose first half already landed.**
  `bug/the-row-shows-what-it-withholds` ([#290](https://github.com/plot-pm/plot/issues/290)) measured the same shape for
  _spacing_ — 16px between sections against 35px between rows — and fixed it with
  `space-y-8`. It did not touch type size. Spacing separated the sections; size
  now distinguishes them, and the two are independent: either can be undone
  without disturbing the other, which is why both are asserted in one file.

  **The caret comment was right, and about a different property.** The existing
  comment defends `py-1 -my-1` as making the heading a 24px-tall target, noting
  _"the caret is what a reader aims at"_. That reasoning is about the **click
  target** and it holds — the padding is untouched and the button still measures
  at least 24px. The operator's complaint (_"expand / collapse icons still too
  small"_) is about **seeing** the glyph. A control can be easy to hit and hard to
  read; those are separate properties, and only one of them changes here. The test
  measures the button's height as well as the glyph's size, so a later "bigger
  caret" that reached the glyph by trimming the padding fails rather than passes.

  **The same comment's consistency argument is what prevented the hierarchy.**
  _"A board that uses 12px 82 times"_ argues for sameness, and sameness across
  levels is precisely why three of them read as one. Consistency within a level is
  right; most of those 82 occurrences are rows, and the rows do not move.

  **Two sizes for three levels, decided from a rendered board.** The plan left
  open whether the plan heading needs a size of its own between the section's and
  the row's. It does not: that heading sits inside a tinted, outlined box holding
  exactly its own rows, and the container states _inside a section_ more plainly
  than a third type step would. Spending a distinction on a level the layout
  already draws buys nothing. What the heading did need was to stop being the
  smallest text on the page — a label set under the branch names it labels is the
  section's defect one level down — so it moves to 13px, level with those names
  and still below the section.

  **Two of the three changes landed on main while this branch waited, and what
  remains is the third.** This branch proposed `text-sm` (14px) for the section
  `<h2>` and `text-[15px]` for its caret. Before it could merge, `main` answered
  the same defect at `text-base` (16px) for both and darkened the heading colour
  with it. That is what ships: a heading two type steps clear of its rows rather
  than one, and `mb-2` under it either way, because 4px under a 16px line reads
  tighter still than 4px under 12px did. The `w-3` → `w-4` widening of the caret's
  box is on main for the same reason it was proposed here — a box cut for a 13px
  mark clips a larger glyph and can shift its pivot when it rotates.

  **So the surviving change is the plan `<h3>`: `text-[11px]` → `text-[13px]`.**
  Main fixed the section and left the level below it, which was the smallest text
  on the page — a label set under the branch names it labels. It now sits level
  with them.

  **Two hands reached for the same property and differed only on distance.** The
  convergence is worth recording: this branch measured a rendered board and
  concluded the section heading was set below its own rows; main measured the same
  board and concluded the same thing, then moved one step further. Neither fix
  knew about the other. A defect that two independent readings find, and find in
  the same direction, is a defect rather than a preference — and the tests below
  are what keep it fixed, since they assert the _ordering_ of the levels and not
  any of the three numbers proposed for it.

  **What deliberately did not change, each of them measured after the fact.** Row
  height, at 37–38px, which [#290](https://github.com/plot-pm/plot/issues/290) states explicitly and a reader's scan depends on.
  The `space-y-8` section separation, still 32px between sections. The `py-1
-my-1` padding and the 24px floor on the fold target. Nothing in the contract —
  this is CSS, no payload field moved.

  **The heading line is taller, and that is the change rather than a side effect
  of it.** The button grew past its former 24px because the label's line box
  follows its font size. `-my-1` cannot absorb that and was never meant to: it
  cancels the `py-1` beside it, not growth in the content itself. The floor the
  earlier work established is _at least_ 24px and it is still cleared; the rows,
  which are what the density argument protects, are untouched.

  **The tests fail against the old code.** All three sizing assertions were run
  against the pre-fix classes and failed, and all three still pass against main's
  larger step, being comparisons rather than constants; the fold assertion passes on both, being
  a guard rather than a defect-catcher — growing a heading's type is exactly the
  kind of edit that turns a `<button>` into a `<span>` by accident. Each size
  assertion is stated twice over: as a comparison, so re-tuning the scale later
  does not require re-tuning the test, and against the measured number, so the
  comparison cannot be satisfied by a row _shrinking_ to meet a heading that never
  moved — the wrong repair for this finding, and the one that costs the board its
  density.

  **One assertion was rewritten in the rebase, and it was measuring the wrong
  thing.** The row's _"the branch name survives the sentence beside it"_ check read
  `scrollWidth > clientWidth` on the name's outer span. That was correct when a
  name was one span. It is not any more: `BranchLabel` folds a long name in the
  middle — a `truncate` head that gives up width beside a `shrink-0` tail that
  never does — so a clipped head is the _mechanism_, and the outer span overflows
  by design whenever a name is long enough to fold. Measured for
  `feature/give-them-away` in its 81px slot: outer scroll 94 against client 81,
  because the head collapsed to 0px and handed every pixel to a 94px tail that
  clipped nothing at all. The old measure reported a working fold as a crushed
  name, and would have gone on reporting it for every name long enough to need
  one.

  It now asserts on the **tail**: that it clips nothing, that it is non-empty, and
  that it really is the end of the name — because a tail that survives by being
  empty passes the width check and identifies nothing, which is the same defect one
  step along. The clipped head is deliberately left unasserted; it is the give in
  the design, and pinning it would forbid the fold. Verified by mutation: giving
  the tail `min-w-0 truncate` fails the check, so it bites rather than passing on
  the DOM's shape alone.

  This is a cross-branch finding neither branch's CI could see, and main is red
  from it **now**. Measured on 2026-08-21 with both suites run concurrently under
  the same load: main fails two tests (`one-grid`'s `kinds:` assertion and this
  deferral row), this branch fails one — the `kinds:` assertion it inherits. The
  name column became a fixed `12rem` track on main while this test waited, so main
  carries the narrow slot without the corrected measure and has been failing on it
  since. The rebase is what put the two together; the fix travels with it.

  **The heading's padding goes `py-1` → `py-0.5`, and the reason changed twice
  before it was right.** 2px around a 13px label holds the proportion `py-1` held
  around an 11px one; at the new size the tinted band read loose. That is the
  reason it keeps.

  It arrived, though, as a repayment. Growing the type grew each plan heading's
  line box, twice on a page with a group in QUIET and in DONE, and at `py-1` the
  footer test failed at **801.3125px** against a bound of 800. Chasing that 1.3px
  is what exposed the assertion underneath it.

  **The footer assertion was measuring the wrong quantity, and passing for the
  wrong reason.** It compared a document coordinate against a literal `800` — the
  viewport height, restated three lines below where `setViewportSize` had already
  set it. Two independent defects hid in that:

  - **It contradicted itself across platforms.** `main` fails it on CI's Linux at
    802.3125 and passes it on macOS: this page renders ~4px taller there, which no
    change in this branch can control. A test a runner moves as easily as a change
    does reports on the runner. The local A/B that first pinned the failure on this
    branch was itself misled by this — main _does_ fail it, in CI.
  - **It was green over a page that scrolled.** Asked directly, the document runs
    to **813px** in an 800px viewport while the footer bottoms at 797. The footer
    was reachable and the page still scrolled, and the assertion could not tell
    those apart.

  It now asks the footer's own box against `window.innerHeight`, with a stated
  `± 1` for subpixel rounding. Both halves are mutation-verified: a 400px viewport
  fails the _reachable_ half, a 4000px one fails the _back out of reach_ half.

  **That rewrite fixed the instrument and not the failure, which is worth
  recording as the order it happened in.** Read correctly, CI reported `footer
bottom 801.3125 in 800px` — the footer really is past the fold there, by 1.3px,
  and `main` is past it by 2.3px. The platform spread was never a measurement
  artifact: a collapsed board of this size does not fit an 800px viewport on
  Linux, and does on macOS.

  **So the fixture gets headroom instead: 900px.** The viewport is part of what
  this test fixes, not a detail of it. Collapsed, the board needs ~797px on macOS
  and ~802px on CI; expanded, the footer's top is at ~1771px. 900 sits in the
  middle of that window with ~100px of slack on the near side and ~870px on the
  far one, so neither half can flip on a font metric. Absorbing the 1.3px in the
  tolerance was the alternative and was refused: `± 2` would have tuned the
  assertion to the runner, which is the defect this rewrite exists to remove.

  **The 13px is a real defect and it is not this one.** The page wrapper carries
  `min-h-screen` and starts 13px down the document, so it ends 13px past the fold
  by construction on every board. Asserting `scrollHeight <= clientHeight` here
  would fail this test for a layout box nobody can see and no collapse can fix, so
  the test says in a comment why it does not — and the defect gets its own plan,
  `2026-08-21-the-page-is-as-tall-as-the-screen.md`.

    <!--
    bumps:
      skills:
    -->

  No skill version bumps: this is a board-side rendering change only. No helper
  script decides how a section is drawn, `/api/fleet` loses and gains no field,
  and the plan format is untouched.

- [#304](https://github.com/plot-pm/plot/pull/304) [`84a65d4`](https://github.com/plot-pm/plot/commit/84a65d4e175b788203915575de47dcc2d4e75950) Thanks [@jwloka](https://github.com/jwloka)! - board: a wave is a kind, and its status is not a sentence

  The scan has emitted `{name, verdict, branches}` per wave since waves
  existed. The board read the name onto the branch row as a string, dropped
  the verdict onto that same row as a nullable field nothing rendered, and
  then rebuilt the verdict as English in `blockedNote()`. Every piece was
  already on the wire.

  Measured on the mock before the change: a three-wave plan rendered four
  rows all labelled `PLAN`, each naming its **branch** with the wave name as
  a trailing badge, each linking `PLAN fleet-scan-asks-the-host` — directly
  beneath the plan row heading those three rows — each showing `open` where
  the scan had computed `eligible`, `blocked`, `blocked`, and one spelling
  `blocked by Shaped — 1 outstanding` in prose one line below the `Shaped`
  row itself.

  `wave` becomes the eighth kind, with Octicons' `stack` for its glyph. A
  wave row names the wave, carries the scan's verdict as its status, and
  links its **branches** — unprefixed, and with no link to its plan, because
  the plan is the row it is nested under and that placement is the statement.

  The sentence `blocked by Relocated — 1 outstanding` was three facts, and
  each now has a slot: `blocked · 2 left` is the verdict with the wave's own
  count in slot 5, `— blocked by Relocated` is a **reference beside the
  name**, and the count moved to the **Relocated** row, which is the wave it
  counts. A wave holding three others back used to print that count three
  times, each time describing a row the reader had to find by name.

  The reference took three placements to land, each rendered before the next
  was tried. Slot 4 as a link put a pointer **up** among links pointing
  **down**, in a column headed `Related` whose every other kind reads one
  direction. Beside the name it was worse than crowded: `Relocated` rendered
  as `R…` and `Moved` as `M` — the blocker text won the width fight against
  the name, so the row lost the one thing it exists to say. It is now an
  **info mark beside the status**, with the wave in the tooltip and in the
  accessible label: `blocked` is what a reader scans down the column, and
  _which wave_ is a follow-up about one row.

  **What a container states, its children do not repeat.** A row inside a
  wave's fold showed `open`, its own age, a link to the plan two rows up, and
  `blocked by Relocated — 1 outstanding` — four facts already on screen
  above it, all four now suppressed. The status one is worth naming: a first
  attempt suppressed only `state === 'open'`, and counted over the estate
  that guard **never fires** — a child row renders only inside a multi-branch
  unfinished wave, there is exactly one, and all five of its branches are
  `wip`. A rule beat the exception list. (The branch state says nothing about
  startability anyway: inside `blocked` waves its branches are `open` × 9 and
  `wip` × 5; inside `eligible` waves, `open` × 8 and `wip` × 3.)

  A **deferred** branch is not a wave's unbegun work and keeps its own row
  beside the waves — `isUnbegun` already drew that line, and a wave row shows
  the wave's verdict and clock, so a deferred branch folded into one would
  lose the PR and age that appear nowhere else.

  **Counted in waves, not in rows.** `waveSummaryFor` printed
  `${rows.length} wave(s)` — the unit name was right and the number was of
  something else, so this estate's five-branch wave would have reported
  `5 waves` for a plan whose file lists one. `showsWaveFold` had the same
  defect: a fold promising five and revealing one.

  Measured over `last-pulse.json` — 35 plans, 71 waves — to decide whether a
  wave row replaces its branches or sits above them: 57 waves hold one
  branch, 14 hold more, and of those 14 **thirteen are `complete` and one is
  `blocked`**. All 11 `eligible` waves hold exactly one. So one row is the
  common case and the fold is the exception; a wave holding several gets its
  own disclosure, and its branches indent beneath it.

  Also: the link prefixes in slot 4 (`PLAN`, `BRANCH`, `PR`) are now the same
  Octicons that name those kinds in slot 1 — one vocabulary read in two
  columns instead of a word and a glyph for one fact. Slot 2 keeps the row's
  own kind as a **word**, so a row is never iconography alone.

  Two fixture defects surfaced and are fixed: the mock carried four
  `kind: 'plan'` rows, a kind `rowKind` never returns and no pulse has ever
  emitted — it read correctly only while a not-started row stood for its
  plan. And six of the estate's 71 waves have no name, so a nameless wave
  renders `(unnamed)` as text rather than failing: the board is not where a
  plan-authoring convention is enforced.

  ## Two projections had no caller, and three kinds read wrong because of it

  `tupleFromBuild` and `tupleFromAgent` were written, tested, and **called by
  nothing** — a build row and an agent row arrive from the server as
  `AgentRow`s, so both fell through `tupleFromRow`'s branch fallback. Their
  branch became the subject and the row's real subject had nowhere to go.

  Measured on the mock:

  | kind    | was                                                            | now                                           |
  | ------- | -------------------------------------------------------------- | --------------------------------------------- |
  | Build   | `feature/a-build-is-running` · _a sentence_ · `CI running 283` | `CI 283` · PR + branch · `CI running` · `10m` |
  | Agent   | `feature/an-agent-is-working` · `open`                         | branch · plan · **`working`**                 |
  | Release | `240` · branch · `no checks 240`                               | `240` · branch · `no checks`                  |

  `open` on an agent row was the **branch's** state, on a row about the agent
  that took it. Every worker exits 0, so `worker` is the only field that can
  say what an agent is doing — `working`, `waiting on you`, `stalled` — and it
  falls back to the branch state only for `none`/`elsewhere`, where this
  machine has nothing to report.

  **The PR number is out of the status column on every kind.** It rendered
  there as a badge, under a comment arguing correctly that _"the PR is a
  second destination worth reaching rather than a fact to read"_ — which is
  the definition of an artifact link, and slot 4 is where those go. `no checks
240` and `CI running 283` were the cost of having it in the one slot whose
  whole purpose is a single scannable word. `PrGlyph` went with it:
  `TupleLinkView` draws the mark from `KIND_ICON_PATH.pr`, so the shape has
  one definition rather than two.

  Two things went with `PrGlyph` that should not have, and both are corrected:

  The `data-pr-link` hook has no owner any more — `TupleLinkView` stamps the
  hook from the link's own `what`, so the PR is `data-tuple-link="pr"`. One
  browser test asserted on it and was updated; the property it defends is
  unchanged, a shelved branch's PR and age stay reachable.

  **And the accessible name was deleted.** `PrGlyph` carried
  `aria-label="Pull request"` beside the number, so when the PR became an
  artifact link the link's accessible name became the bare `158` — a link that
  tells a screen-reader user nothing about what it opens. Fifteen browser tests
  searched for `link, name: "Pull request 158"` and found nothing, which is
  what a reader using a screen reader would also have found. An earlier draft
  of these notes called this deduplicating a shape: the shape was deduplicated,
  the name was lost.

  `linkLabel` now names every artifact link by what it points at — `Pull
request 158`, `Plan a-row-is-a-tuple`, `Wave Shaped` — which is the two-channel
  rule slot 2 already follows: the word for a screen reader, the icon for a
  sighted one, neither alone. A branch keeps announcing its name without the
  word, because `BranchLabel` folds it into two `aria-hidden` spans and the
  label is all there is left to announce.

  A build's name **should** link to the pipeline run and cannot yet: no run or
  checks URL is on the wire. It renders as text rather than a guessed
  `<repo>/pull/<n>/checks`, by the rule `CardPrSchema` states for the same
  reason — _"the same arithmetic produces a confidently wrong link for GitHub
  Enterprise or a self-hosted Bitbucket."_ Finishing it needs a `checksUrl`
  from the host adapter on the server.

  The blocked-wave reference is a real **hover overlay** with the wave as a
  control, not a `title`: a native tooltip renders plain text, waits a second,
  and cannot hold a link. Clicking the name scrolls to the blocking wave's row
  and flashes it — the row is always a sibling in the same list, so this needs
  none of the cross-section reveal machinery. It opens on hover _and_ focus,
  because a hover-only disclosure holding a control is a control nobody can
  tab to.

  ## A plan awaiting approval is a plan, not a PR

  `rowKind` gained one arm: an `idea/` branch with a PR is a **`plan`**.
  Technically it is a pull request — which is exactly why the mark is needed,
  since without it a plan awaiting APPROVAL renders as one more open PR
  awaiting review, and the two ask for different acts. Merging it is
  `plot-approve.sh`'s job, which takes a plan and no branch.

  **The branch name decides, not the draft flag.** `rowKind` never receives
  `draft` at all, which is the strongest form of that independence — a plan
  PR marked ready for review is still a plan. The mock carries one of each so
  the independence is visible rather than asserted. The detection is a
  convention Plot itself writes (`/plot-idea` names the branch after the
  plan's slug), the same argument the row-building site already makes when it
  recovers the slug from that name.

  `tupleFromRow` gained the matching arm: the plan is the subject, its PR and
  branch are the artifacts — a PR row's split with the roles exchanged.

  ## Three more rows, three more artifacts on the wire and unrendered

  **`fleet.agents` had no consumer.** The scan collected the registry, the
  contract carried it, and the client's only mention was a comment — so an
  agent row had no session id, no worktree and no command, and named its
  branch instead. It now joins on branch: the name is the session id and
  **opens the agent panel** (a `<button>`, since the destination is a local
  overlay and not a URL), and the artifacts are wave, branch, worktree, plan.

  **A PR carries its wave** where its branch belongs to one — `row.wave`, on
  the row all along. Ordered plan → wave → branch, the chain narrowing. Not
  every PR has one: planless PRs (`changeset-release/*`, `idea/*`) reach the
  board through a loop that sets `wave: ''`, so the mock holds both.

  The wave BADGE now renders only where the row does not already link its
  wave — measured as `Inverted` twice on the agent row and `Modelled` twice on
  PR 304. It stays on a branch row, whose artifact slot holds plan and PR but
  not wave, so there it is the wave's only statement.

  ## Two fixes reported from screenshots

  **The ticket kind said `Story`.** A story is a Plot artefact — an umbrella
  over several plans in `docs/stories` — and this row is a host issue no plan
  references. Two different things, one labelled with the other's name.

  **The inferred plan name was in slot 5**, crushing the ticket's status to
  `o…` and reading as though `fleet-scan-asks…` were its condition. It is a
  proposal, not a status; this component's own docstring sketch had always put
  it in the plan column and the collapse moved it without following the
  sketch. Slot 4 now holds it.

  **Marks aligned to the row's centre, not its first line.** With
  `self-stretch` the cell is as tall as the row, so `justify-center` floats the
  mark to the middle of a row that WRAPPED — measured, an agent row at 56px
  with its dot at y=24 while the name sat at y=9. `justify-start` puts it at
  y=11. Two unit tests asserted `justify-center` while their own TITLES said
  _first line_: the two agreed only while rows were one line tall, and the
  titles were right.

  **The mock served no cards**, so every card-gated control was invisible —
  `Start work`, `Approve`, `Commission design`, and the plan row's whole `⋯`
  menu (`[data-plan-actions]` count: 0). An absent control looks exactly like
  a control the code fails to render, which is the same class of defect as the
  four `kind: 'plan'` rows this fixture used to carry.

  **`Start work` went missing with the branch rows** it hung off. It is on the
  ELIGIBLE wave row now: the plan warned that a dispatch control would _"have
  to guess which of the plan's waves it meant"_, and one level down there is
  nothing to guess — `StartWorkButton` takes a `Card` and a dispatch binding,
  never a branch. A blocked wave offers no control at all rather than a
  disabled one.

  **An eligible wave's note reads `you`, not `click`** — the amber _this needs
  a decision_ tone. `waitingTone` gives `click` the ordinary colour on the
  argument that the section would _"shout twice and mean once"_, which holds
  where every row waits on a click; here three verdicts sit side by side and
  one of them can be started.

  ## A release names its version, read from the branch

  `RELEASE 240` named its **PR**. `releaseVersion` tested whether the plan slug
  looked like a version, which is true for no row this board has ever rendered
  — changesets names its branch `changeset-release/<base>`, so the slug carries
  the base and the PR-number fallback fired every time.

  The version is a **fact on the branch**: changesets consumes the
  `.changeset/*.md` files and writes the bumped version into `package.json`
  there. Verified — `origin/changeset-release/main:package.json` reads `2.7.0`
  where `main` reads `2.6.0`. So the server reads it (`releaseVersions`, one
  `git show` per release branch, "" on anything unreadable) and carries it as
  `AgentRow.version`.

  The refusal that shaped the old behaviour stands and is worth keeping
  straight: _deriving_ the version by summing pending changeset bumps is _what
  would this ship_, a question the board must not answer. Reading a file the
  release tool wrote is not deriving a decision.

  ## Status colours came back

  `conflicts`, `green` and `no checks` all rendered the identical grey —
  reported from a screenshot, and a regression from
  `one-component-renders-every-row`, which replaced three row components with
  one grid and kept the WORDS while dropping the tones. The palette is the
  deleted `PrCell`'s verbatim, and so is its rule: **the state is a word and
  colour only reinforces it**, for the two values a reader acts on.

  Keyed on the status WORD rather than on `pr.state`, because slot 5 holds one
  string whatever the kind: a wave's `blocked`, a worker's `failed` and a PR's
  `conflicts` are all _something is wrong here_. `blocked` is deliberately not
  coloured — an earlier wave holding this one back is the system working.

  ## Plan grouping is off in WAITING ON YOU

  `showPlanHeading` measures the right thing — two rows under one plan, so the
  name prints once instead of twice — and it is wrong for this section. Its
  rows are a mixed bag (a PR, a plan under review, a release, a ticket), so
  grouping two of them by a shared plan says _these belong together_ about rows
  whose only relation is a name they each already print in slot 4. The heading
  saved no repetition.

  The other sections keep it, and where it renders its rows are now **indented**
  with a left rule: measured, a headed group's rows sat at the same x as the
  ungrouped ones beside them, so the heading read as no group at all. _Grouping
  means indented_ — the same `ml-6` the wave list carries. On the wrapper rather
  than the group box, which keeps the cross-section column alignment the
  outline's own comment protects.

  ## What a PR with a wave is NOT

  A PR whose branch belongs to a wave **has** a wave; it is not one. Measured:
  39 branches sit in multi-branch waves, so the estate's five-branch
  `Implementation` wave would render five rows all named `Implementation`, each
  claiming to be the same wave with a different CI status — the conflation this
  whole wave removed, reversed. A wave's status is `eligible|blocked|complete`,
  computed by the scan from ordering; a PR's is `green|conflicts|failing`,
  reported by the host from CI. And you merge a PR, while a wave completes when
  its last branch lands.

  Also: the ticket's inferred plan name renders through `TupleLinkView`, so it
  wears the plan glyph like every other named thing in slot 4 — it was the one
  name in the column with no icon. And the fold caret is centred against the
  kind label: measured 3px low, because its 24px hit area (a WCAG 2.2 minimum,
  not up for negotiation) sits against a 14px label, so the box keeps its size
  and moves up by half the difference.

  ## What the real board found that the mock could not

  Five defects, each of which passed its own tests, and every one caught by
  rendering real data rather than a fixture.

  **`rowKind` never returned `build`.** Its docstring said "a build and an agent
  have no row yet" while `classify` was already routing CI-running rows to WAITING
  ON A MACHINE — so that section held a row labelled `PR` with a note reading `CI
is running for PR [#304](https://github.com/plot-pm/plot/issues/304)`. The section knew; the kind did not. `ciRunning` is now a
  fact `rowKind` takes, from the same `pr.checks === 'pending'`.

  **The release version read the plans, which can never contain the release
  branch.** `changeset-release/main` belongs to no plan — that is why it arrives
  through the planless-PR loop — so the list passed to `releaseVersions` could not
  hold its own subject. **The mock hid it**: `version` was set there by hand, so
  the fixture built to expose this shape is why it went unseen. Reading the refs
  instead: `2.7.0`.

  **A wave of one is still a wave.** The `rows.length > 1` threshold came from
  `showsWaveFold`'s reasoning — _a heading over one row saves no repetition_ —
  which answers a different question. A fold is about saving repetition; a KIND is
  about what the row is about. Measured: all 12 waves in WAITING ON YOU hold
  exactly one branch, so the threshold fired only through the mock's hand-made
  two-branch wave.

  **WAITING ON YOU holds two kinds of wait.** `isReviewable` recognised only _the
  work is done, merge it_. A branch whose PLAN is still in review also waits on a
  person — to approve it — and that was 12 of the 14 wave-bearing rows, ungrouped,
  repeating one sentence 13 times.

  **`double-claimed`, a fifth stuck state** — two plans claiming one branch, found
  because the board FLASHED. Two rows for one branch shared a `rowKey`
  (`repo/branch`, no plan), so each pulse one overwrote the other's remembered
  `wave` and lit the change mark for hours on a branch nobody had touched. It is a
  stuck state because nobody can act until a person decides: `plot-dispatch` would
  hand an agent one of two briefs with no way to choose. First among the arms,
  because _order is meaning_ and nothing outranks not knowing whose work a branch
  is.

  ## A plan row heads its waves, and folds

  Where every row in a group is a wave, a PLAN row heads them instead of a text
  `h3` — carrying the phase, the clock and the menu an `h3` cannot. Its clock is
  the freshest of its branches, not the approval clock: measured, `waitingDays:
null` on every row in this section while `ageMinutes` read real values. A plan in
  Discovery with nothing pushed shows no age, which is honest — neither clock runs.

  Collapsed by default where it holds more than one wave. The group is homogeneous
  by construction (a plan's branches move through the lifecycle together), so the
  predicate can demand that every row be wave-grouped rather than handle a mixture.

    <!--
    bumps:
      skills:
        plot: patch
    -->

- [#300](https://github.com/plot-pm/plot/pull/300) [`93a1e41`](https://github.com/plot-pm/plot/commit/93a1e415ca5903a50280ade19899bb21ecb06b98) Thanks [@jwloka](https://github.com/jwloka)! - board: an agent is the machine, so it never appears in WAITING ON A MACHINE

  Measured on the live board 2026-08-20: `bug/one-component-renders-every-row`
  appeared in **WORKING** _and_ in **WAITING ON A MACHINE**, five minutes apart on
  one screen. From `/api/fleet` for that row: `worker: running`, **`pr: None`** —
  no CI, no check, nothing automated anywhere near it. The section was listing the
  agent itself as the machine, and an operator reading _what am I waiting on?_ was
  answered with the name of the thing doing the work.

  **The section answers one question, and an agent is not an answer to it.**
  WAITING ON A MACHINE means _you cannot act; something automated is working_ — a
  check running, a build queued, a run page you refresh and a verdict you read. An
  agent is technically a process, and WORKING is the better sentence for it because
  it says _who_. Given both rows a reader learns nothing from the second and has to
  reconcile two lines describing one branch.

  **The justifying case was two subjects, not one subject twice.** The rule was
  introduced for _"an agent watching its own CI"_, listed once as an agent and once
  as a process, on the argument that the sections list different things. They do —
  which is exactly why the conclusion does not follow. The agent belongs in
  WORKING; the PR whose checks are running belongs in the machine section, and it
  arrives there on its own through `group`. Two rows, two subjects, each named
  once. The original framing put one subject in two sections.

  **A rule keyed on a mechanism when the intent was a situation.** The plan meant
  _an agent watching its own CI_; the code said _a process is running_, and an
  agent is always a process — so the entry fired for every live worker, including
  the ones with nothing pending to wait on. That is the shape this estate keeps
  producing, and the measured row is its clearest instance: the implementation
  could not tell the justifying case from any running worker at all.

  **Two halves removed, in two files.** `machineProcesses` (`fleet.ts`) loses its
  `origin: 'local'` arm, so no worker state writes a process entry. `inMachineSection`
  (`AgentList.tsx`) loses `|| processesOf(row).length > 0`, so membership is the
  server's grouping and nothing added to it. The description was built in the
  first; membership was decided in the second, and it was the second that admitted
  the rows.

  **Membership is `group` alone, rather than `processes` filtered to host entries.**
  Both spellings render identically today, and the difference is where the
  guarantee lives. A predicate that reads `processes` holds _no agent reaches this
  section_ only for as long as `machineProcesses` keeps its promise — a rule in a
  second file, of the kind this repo converts to gates. Reading `group` makes it
  structural: the client cannot admit a row the server did not group, whatever
  `processes` later grows to carry. The field stays on the row and `machineNote`
  still reads it for the section's sentence; this decides MEMBERSHIP, and
  membership has one source.

  **No row is lost, and that was the objection raised against the removal** — _an
  agent that exited while its checks still run would land nowhere._ It lands in the
  section by two paths that never consult a worker: the classifier's
  `pr.checks === 'pending'` arm sets `group: 'waiting-on-machine'`, and the host
  half of `machineProcesses` pushes an entry off the same reading. The local half
  was credited with a case it never covered — the worker there is `finished`, so it
  pushed nothing. Asserted end to end rather than argued.

  **The rule is asserted over the whole enum, not over the states that occur
  today.** `no worker state reaches the machine section` iterates
  `WorkerStateSchema.options` — all eight, `running` through `elsewhere` — at both
  the unit and the pulse level, and pins the enum's size so a ninth state cannot be
  added without this failing. That is what makes it a rule rather than a patch: the
  two states a naive fix would cover are not the claim.

  **`MachineProcessOriginSchema` keeps `local` although nothing writes it.** This is
  a WIRE contract, and the board's page is a built artifact a reader may have open
  across a restart — `/api/fleet` answers from whichever server is running, which
  is the same asymmetry `processesOf` already guards. A narrowed enum would fail to
  parse an older server's payload, trading a stale entry that renders nowhere for a
  blank page. Widening-tolerant, narrowing-cautious.

  **What deliberately did not change.** The CI grouping at `fleet.ts`'s `pending`
  arm is untouched and is now what the section rests entirely on, so it is asserted
  rather than assumed — if it moved, the section would empty and every negative
  above would still pass. The `processes` field stays on the row; only the local
  entry is gone. WORKING is unchanged: it already lists a running worker, and making
  it agent-centred is a later wave and a much larger change. An agent in WAITING ON
  YOU is a later wave too — a crashed agent does not become visible through this
  change, which is correct for now.

  The worker arguments to `machineProcesses` survive the entry they fed,
  underscored rather than dropped. Every caller passes them positionally and the
  suite calls it with spread tuples whose argument positions this file has broken
  once before; churning every call site to delete one `if` would obscure a diff
  that should read as one behaviour removed.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side membership change only. No helper
  script decides which section a row lands in, the `/api/fleet` payload loses no
  field, and `plot-fleet-scan.sh` is untouched — the worker states it reports are
  unchanged, and what changes is only whether one of them is allowed to answer
  _what am I waiting on?_

- [#295](https://github.com/plot-pm/plot/pull/295) [`eb8b599`](https://github.com/plot-pm/plot/commit/eb8b599572e3c86240d6d05cc24f26343a3c5b16) Thanks [@jwloka](https://github.com/jwloka)! - board: an agent outlives its branch

  The dispatcher writes a manifest under `.plot/agents/<session>.json` at launch,
  and the board reads them back joined to their session transcripts. Together they
  make an agent something the board can list **with no branch at all** — the state
  `waiting` requires and no worktree can express.

  **Keyed on the session id, not the branch.** Everything the board knew about an
  agent lived inside a worktree: `.plot-worker.pid` is a file in it, and the
  transcript directory is derived from its path. So an agent that finishes one
  branch and takes another lost every identity the board held. The session id
  survives that.

  **The dispatcher mints the id** and exports it as `PLOT_SESSION_ID`, so a
  `Worker command` can forward it (`claude --session-id "$PLOT_SESSION_ID"`) and
  the runtime's transcript lands where the manifest points. This repo's command
  carries no `--session-id`, so minting keeps it launch-time knowledge rather than
  a guess at the newest file in a directory that held one to eight of them.

  **The manifest records only launch-time facts** — session, branch, worktree,
  command, startedAt. No pid: a pid describes the process, is meaningless once it
  exits, and was measured still being shown for a worker gone for hours. No model
  or context: those belong to the runtime and are read from the transcript.

  **A missing transcript costs fields, not entries.** Model, context and last
  activity are absent; the agent is still listed. The format is the runtime's
  private business and may change.

  <!--
  bumps:
    skills:
      plot-dispatch: minor
  -->

- [#297](https://github.com/plot-pm/plot/pull/297) [`159a0f6`](https://github.com/plot-pm/plot/commit/159a0f634a1c31426db031ee51d228c3996bd6dd) Thanks [@jwloka](https://github.com/jwloka)! - board: an eligible row says whether it can actually be started

  Reported from the live board on 2026-08-19: nine rows reading _eligible —
  nobody has taken it_, and not one of them could be started. Every one was
  missing the brief a worker is told to read first.

  **The wave arithmetic was right, and that is what made the row misleading.**
  `plot-fleet-scan.sh` calls a wave eligible when every non-deferred branch in
  every prior wave is merged, and those branches genuinely were next. The row
  told the truth about waves and stopped there — so it named a state, implied an
  action, and the action did not work: an operator following it runs
  `/plot-dispatch`, which starts a worker that reads `.plot/briefs/<slug>.md`, a
  file that is not there.

  **The fact already existed, in the wrong place.** `ClaimableSchema.briefExists`
  has answered it for `/api/attention` since [#236](https://github.com/plot-pm/plot/issues/236), and `fleet.ts` did not mention
  it once — so an agent asking the API was told and a person reading the row was
  not, because the two answers are built by different code from one repo.
  `AgentRow` now carries `brief`, and the row renders it.

  **Three values, not two, and the third is the point.** The `/api/attention`
  twin is a boolean that returns `false` on any error, which is defensible for a
  caller handed a path either way. It is not defensible on a row: _no brief —
  write one first_ is a claim about the repository, and made on the strength of an
  unreadable `.plot/briefs` it sends a person to write a file that already
  exists. So `BriefState` is `present` / `missing` / `unknown`, and an unreadable
  directory reads as _cannot verify_ — the rule `plot-board-probe.sh` already
  applies to auth and `conflicts_known` to an unexamined branch.

  The order of the two calls is load-bearing rather than an optimisation:
  `existsSync` swallows its error and answers `false` both for _not there_ and for
  _could not look_ — measured, on a readable file inside a `0o000` directory.
  Asking about the directory with a throwing call first is what makes the second
  call's `false` mean the one thing it is allowed to mean. A `.plot/briefs` that
  does not exist at all is `missing`, not `unknown`: a repo that has never had a
  brief written honestly has no such directory, and every branch in it needs one.

  **The phrasing blames the file, never a person.** _nobody has taken it_
  supplies the reason nobody has taken it as if it were an accident of attention —
  an invitation with a missing actor, when what is missing is a document. The row
  now reads `needs a brief · no brief at .plot/briefs/<slug>.md —
/plot-implement writes it`, on its own second line: the shape a stuck row
  already uses, and the one the deferral reason took after two bounded cells were
  measured failing. It names the command rather than offering it — running
  `/plot-implement` is a real write, and whether the board should offer it is an
  Open Point the plan recorded and declined to settle.

  The note beside it still says _eligible_, and stays the ordinary `click`
  colour, because the wave really is open; only the new line is amber, the
  `waitingOn: 'you'` colour, because a missing brief is a person's errand that
  nothing in git will clear. The fact is added beside the verdict rather than
  replacing it — the rule `stuck` follows in keeping a row's group while naming
  what holds it.

  Cost: one `existsSync` per branch per pulse, measured 2026-08-19 on this repo
  at 0.2 ms per pulse for 60 branches, against a scan that takes 14 s. The root
  is passed to `rowsFromPulse` and read on the render clock rather than carried
  on the pulse, so a brief written between two scans shows up on the next pulse
  instead of waiting out the scan's cadence.

    <!--
    bumps:
      skills:
    -->

  No skill version bumps: this is a board-side change only. No helper script is
  touched, and the `/api/fleet` payload gains a field rather than changing one —
  an older client's schema strips what it does not know, and an older server's
  payload validates against the new one by the default, which is `unknown`
  precisely so that a server that never looked is not read as reporting an
  absence.

- [#301](https://github.com/plot-pm/plot/pull/301) [`9088f1d`](https://github.com/plot-pm/plot/commit/9088f1db8816296ae5d4e5ed553a2eca2a74aa66) Thanks [@jwloka](https://github.com/jwloka)! - board: one component renders every row

  `Row`, `PlanRow` and `IssueRowView` are replaced by the tuple row, and
  `ROW_TRACKS` and `PLAN_ROW_TRACKS` collapse into `TUPLE_TRACKS`. Two grids for
  three components becomes one grid for seven kinds.

  The measurement that ordered this wave last: **555 + 149 + 2 lines** across
  three components, and the third — a TICKET — rendered through the tracks of a
  BRANCH, wearing a wave, a worker and a branch it does not have. It wore them
  because there was no third grid to give it, and nobody noticed because two of
  the seven tracks were empty and the rest were filled with another object's
  vocabulary: the kind cell read `Discovery`, a plan PHASE on a row that is not a
  plan and has never entered the lifecycle the word comes from. That is the same
  defect as the four-meanings phase column, at a second site.

  **One component, not a shared grid with three fillers.** Three fill sites is
  exactly how the two grids drifted apart, and keeping them while adding a
  contract keeps the drift possible. What remains at the three call sites are
  ADAPTERS: an adapter answers what only that site knows — the activity marks the
  fleet computes for the whole list at once, the menu the kind offers, the second
  line a stuck branch takes. The six slots are answered once, in `tuple-row.ts`,
  which the unit suite already tests as data. A new kind now costs a projection
  and no rendering at all, which is what the deleted three could never do.

  **The reversal `PLAN_ROW_TRACKS` records is worth stating rather than quietly
  undoing.** Its argument was _a plan row is not a branch row, so it does not
  borrow the branch tracks_ — correct about its own case, and the reason there
  were two grids for what the contract says are seven kinds. The second grid did
  not fix the mismatch it was built for; it moved it. What the two were really
  arguing about was slot CONTENT, which the tuple settles there: a plan's slot 3
  is its name, slot 4 the branch it names one of, slot 5 its PHASE — the object
  that fact belongs to — and slot 6 the approval clock. The nesting that grid was
  drawn to prevent (eight sibling plans reading as a hierarchy because a plan name
  and a branch name both began at 222px) is prevented by slot 2 instead, and more
  directly: the two rows differ by the WORD in the kind slot rather than by an
  indent a reader has to measure.

  It absorbs `feature/the-row-leads-with-its-subject`. With slot 3 holding the
  item name, _which fact leads_ is answered by construction, so what this branch
  does with it is **delete** the per-kind leading logic rather than write a rule
  for it.

  **Two consequences, named rather than discovered later.** On a row whose kind is
  `branch` the PR NUMBER is no longer a link: `tupleFromRow` gives a branch row one
  artifact link, its plan. A row is `branch` precisely when the PR cannot resolve
  it — a merge conflict — so the reader's destination is the branch, which slot 3
  names and links; the PR's CONDITION still reaches slot 5, which is what _a merge
  conflict is still readable on the branch it belongs to_ asks for, and the number
  rides beside it as text. And `planInHeading` is gone rather than kept as a no-op:
  a branch row's plan was a whole TRACK, so a headed group suppressed it, but in
  the tuple the plan is one of slot 4's links and suppressing it there would leave
  a headed group's rows with an empty artifact slot while an unheaded group's
  carried a link.

  **Every DOM hook the three carried moves with the FACT, not with the component.**
  `data-branch` to the branch link wherever it renders, `data-kind` to slot 2,
  `data-phase` to the plan row's slot 5, `data-issue-link` to the ticket adapter's
  name. Twelve test files find rows by those hooks, and rewriting 48 `data-branch`
  assertions onto a `[data-tuple-link="branch"]` text match would trade an exact
  attribute lookup for a substring comparison — on names that share twenty-four
  characters of prefix in this very fleet.

  **The structural gate follows the row into the other file.** The scan that
  proves _a row's actions all live in its menu_ read `AgentList.tsx` alone,
  because every row component lived there; with the rendering one module away it
  would have walked from `Row`, failed to find `TupleRowView`, and reported a clean
  row while every anchor in the estate sat unwatched. That is the failure the
  gate's own docstring warns about — _a scan that matched nothing passes forever
  while gating nothing at all_ — so it now reads both files, and a new test walks
  the tuple from all THREE adapters. Two scanner defects the move exposed:
  `stripComments` handled block comments only, so `TupleLinkView`'s prose about
  the anchor it declines to render was read as markup; and `indexOf('>')` is not
  where a JSX opening tag ends, so the estate's one legitimate anchor was reported
  as a stray.

  **`TUPLE_TRACKS`'s documented arithmetic was wrong, and computing it in a test
  is what found that.** The constant claimed 496px of fixed track needing 580px,
  with 60px clear of the 640px breakpoint. Measured: **508px needing 604px, 36px
  clear.** One uncounted gap — `84` is five gaps plus padding, correct for six
  tracks, and this has seven. No defect shipped, since 604 is still under 640;
  what shipped was a margin a later widening would have been checked against, and
  it is the same off-by-one-gap error `ROW_TRACKS` records making and warns fails
  _in the reassuring direction_.

  Membership is unchanged — which section a row appears in is a separate decision
  — and no host call is added: every slot derives from what the pulse already
  carries.

- [#276](https://github.com/plot-pm/plot/pull/276) [`efd4d86`](https://github.com/plot-pm/plot/commit/efd4d86169d2c9fc5d2d8ac00da43b3565ee07e8) Thanks [@jwloka](https://github.com/jwloka)! - board: the Start work button claims only what it knows

  The button's transient message was _no change — see log_, and it was wrong
  twice over. It asserted a FAILURE the button cannot know happened: a dispatch
  that prepared a worktree, pushed a booking and started an agent leaves
  `waveSummary.claimed` unmoved for longer than the button waits, so the honest
  message on a working dispatch was _no change_. And it offered the recourse as a
  TRANSIENT log path — rendered in component state — that the next re-render, the
  row moving, or a tab switch destroyed, so a reader told to _see log_ found no
  log to see.

  The button now says only what it knows: it dispatched, and the next pulse
  re-derives from git. The message is _Agent work will show up shortly_ and
  nothing more, in a neutral colour rather than an amber warning, and the row
  travelling to WORKING is the confirmation. It still reports a real refusal — a
  non-2xx from `/api/dispatch` — in the server's own words.

  The dispatcher log that _see log_ pointed at now has a home that outlives the
  click: a `Status` entry in the row's `...` menu, present whenever a dispatcher
  log exists for the plan. It reads the log through a new `GET /api/dispatch-log`
  route — the sibling of `/api/worker-log`, one file over: that serves the
  AGENT's console (`.plot-worker.log`), this serves the DISPATCHER's own record
  (`plot-dispatch-<slug>.log`), keyed by slug and rendered in a focused
  `DispatchLogModal` that reuses the worker log's escaping-`<pre>`, truncation
  notice and path footer.

  Presence rides one `stat` per card (`card.hasDispatchLog`), never the log's
  contents: the pulse says a dispatcher log exists and where, and the body travels
  only on demand when a reader opens the entry — the same discipline the worker
  log and the worktree list already keep.

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content.

- [#285](https://github.com/plot-pm/plot/pull/285) [`89a10ff`](https://github.com/plot-pm/plot/commit/89a10ff41eb466305a5798077d7c39a882ef4573) Thanks [@jwloka](https://github.com/jwloka)! - board: the agent panel's COMMAND expands to the whole command and offers Copy

  The panel rendered the worker command on one clipped line ending `Read .p…`.
  The full value is ~1,400 characters — the entire brief the agent was handed,
  which is the single most useful fact on the panel when an agent misbehaves,
  because it is the specification it was given. Measured, the truncation stopped
  inside the word `.plot/briefs/`, so the reader could not even see which brief
  was named. There was no expand, no wrap, no copy: the information was present in
  the DOM and unreachable in the UI.

  **One field, one dedicated control.** The plain `Fact` truncates to a single
  line, which is right for a pid or a model name and wrong only here. So `command`
  alone gets `CommandFact`: collapsed it shows a one-line preview, **Show more**
  opens the whole command wrapped and readable in place, and **Copy** puts the
  command on the clipboard. Every other field keeps the plain `Fact` and its
  truncation.

  **Copy yields the launched command, not the render of it.** The collapsed
  preview replaces the command's newlines and whitespace runs with single spaces
  so it reads as one line — but it is a preview, never the source. Expand renders
  the ORIGINAL string, and Copy writes the ORIGINAL string, byte for byte
  including the newlines the preview removed. A collapse that dropped characters
  would make Copy yield the truncated render, which is the exact defect this
  removes; `commandFirstLine` is therefore lossless by construction (whitespace
  only) and asserted so without a page in `command-fact.test.ts`.

  **The omission rule is kept.** A `command` of `""` — the shape a fleet with no
  `Worker command` configured takes — renders nothing at all: no preview, no Show
  more, no Copy, the same structural absence `Fact` already guarantees. There is
  nothing to expand or copy, so the field simply is not there.

  **Copy degrades rather than throws.** `navigator.clipboard` is absent over plain
  http and in older browsers — the caveat `PlanModal` already names — so a failed
  write is swallowed. The command is in the DOM either way, so a reader on an
  insecure origin can still select the text they can see; the button is the
  convenience path, not the only one.

  The behaviour that only a browser can show — collapsed is one line, Show more
  reveals the brief path the truncation buried, Copy yields the exact string — is
  asserted in `command-copy.browser.test.ts` against the shipped artifact.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side rendering change only. No `.sh`
  helper and no `SKILL.md` is touched — the `/api/agent-panel` payload is unchanged
  and already carried `command`; what changes is how the panel renders the value
  it was already given.

- [#289](https://github.com/plot-pm/plot/pull/289) [`30ce326`](https://github.com/plot-pm/plot/commit/30ce3265596fde3e0180c48098fc94f29d321321) Thanks [@jwloka](https://github.com/jwloka)! - board: the Design column means Design

  `toBoardPhase` maps `design → Design` and reads `approved` as Development
  whether or not a branch has started. The board once manufactured its Design
  column by forking `approved` on `started` — a plan nobody had begun went to
  Design, one with commits to Development — so a column named for an activity was
  populated by the _absence_ of that activity. Waves 1 and 2 made `design` a real
  phase in the parser and the gates; this wave is the board reading it.

  **Approved-but-unstarted is Development, not Design.** It is work waiting for an
  agent, and it belongs beside the Start button that offers it. The measured case
  the plan named — approved-unstarted plans sitting in a column called Design —
  moves out: the `tiny-garden` data test now reads `Design: 0, Development: 2`
  where it read `Design: 2, Development: 0`.

  **`rowPhase` and the board card now agree by construction.** The divergence that
  justified deriving a row's phase from git rather than the plan file — an
  approved plan with stale bookkeeping reading Design on the card and Development
  on the row — cannot occur once approved is Development on both. The `started`
  half `rowPhase` supplied from git no longer moves an approved plan, but it is
  still read and still passed, so the two views compose the one mapping.

  `toBoardPhase`'s second parameter is kept, unread, as `_started`: the plan says
  approved is Development _whether or not_ a branch has started, which presupposes
  the input still exists. It is the seam a future `started`-forking phase would
  use, and the agreement test asserts the two callers stay in step through it.

  **A Design card sorts by its own clock.** `design_raw` joins the board's
  `PlanMeta` schema — the shell parser emitted it since wave 1, but the board's
  Zod schema dropped it as an unknown key, so it was never reachable. `phaseDateOf`
  reads it for the Design column: a plan _in_ Design has a `Design:` date but not
  yet an `Approved:` one, so the two columns cannot share a record, and a Design
  card with no `Design:` line sorts by arrival rather than borrowing approval.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is board-side only. The skills and helper scripts
  are untouched — `plot-plan-meta.sh` already emits `design_raw` and normalises
  the `design` phase (wave 1), and the gates already accept it (wave 2). This wave
  only teaches the board's TypeScript to render what those already produce.

- [#280](https://github.com/plot-pm/plot/pull/280) [`93a8629`](https://github.com/plot-pm/plot/commit/93a86292227139571d2f8b9403d15084a792532e) Thanks [@jwloka](https://github.com/jwloka)! - board: the row action menu fits the kind, and every row in WAITING ON YOU has one

  Two rows of three in WAITING ON YOU carried no `⋯` menu at all: a plain PR
  awaiting review offered nothing the menu recognised, so the reader had no route
  to any action whatever the row led with. The menu now fits each kind, and every
  row has one.

  **Open makes the menu fit every WAITING ON YOU row.** Each row in that section
  gains an Open item — navigation to a fact the row already carries (`openTarget`:
  the PR page, or the branch on the host), so no fetch and no host call. It reads
  _Review_ on a PR row and _Open_ on a bare branch, because opening a PR is
  reviewing it. A green PR awaiting review — the row that measured the defect — now
  has a menu where before it had none. Open is scoped to WAITING ON YOU on purpose:
  a quiet, blocked or done row has an address too but nothing to do, and a `⋯`
  opening a link the row already shows is the empty menu a neighbouring plan
  removed.

  **Per kind, the actions the reader needs:**

  | Kind   | Menu                                                |
  | ------ | --------------------------------------------------- |
  | Ticket | Create plan, Create story, Open on host             |
  | Plan   | Open, Approve, **Commission design**                |
  | PR     | Review, and where checks fail **Show failure**      |
  | Branch | Open, and per cause Resolve conflict / Show failure |

  The ticket's `Create plan` moved out of its bare cell and into the same `⋯` menu
  every other row wears — the row says what IS, the menu says what you can DO,
  brought to the one kind that had not adopted it.

  **Commission design ships the `Design` phase minimally rather than as a
  refusal.** The phase landed in [#259](https://github.com/plot-pm/plot/issues/259) and nothing filled it; a menu entry that only
  explained why it could not act would leave the phase unreachable for longer. So
  the entry spawns a plot agent — through a new `/api/commission`, the twin of
  `/api/idea`, slug-scoped and gated on the same loopback binding — that creates a
  plan in phase `Design` with an empty spec section. The spec/spike/tracer-bullet
  distinction is left to the plan itself; the board does not build three variants.
  It refuses any plan that is not a Draft, in the plan's own phase, exactly as
  Approve is a decision about a Draft.

  **Create story is offered and refuses, with its reason on the control.** A story
  is a person's decision — where it lives, whether it is wanted yet — which
  `story-tracking` settles through questions an unattended agent has nobody to
  answer. There is no `/api/story`, and this is not a gap a later wave fills: the
  act belongs to a terminal, not a click. Offering it and naming why is the honest
  answer; a reader weighing an unplanned issue is choosing between exactly a plan
  and a story, and a menu that dropped one would hide half the decision.

  **No host call is added, on the pulse or on a click.** Every kind is derived from
  data already on the row, and where a detail is not in the pulse the menu links
  out to the host rather than fetching it. `Show failure` opens the run URL the
  scan already carried; where the host gave none (Bitbucket has no run listing) the
  item is simply absent.

  The contract is untouched save one additive server-capability flag,
  `board.commission` — defaulted, so an older server validates and a newer client
  hides the control rather than offering one that 403s. Which fact LEADS a row, the
  `pr.state` → `pr.states` change, the kind label, and the failure-detail reshaping
  are sibling branches and are not touched here.

- [#281](https://github.com/plot-pm/plot/pull/281) [`eef801f`](https://github.com/plot-pm/plot/commit/eef801f2606bb9c7bc80abc73808de70f6b280e8) Thanks [@jwloka](https://github.com/jwloka)! - board: the agent panel's facts are destinations

  `BRANCH`, `PLAN` and `WORKTREE` on the agent panel were plain strings. The
  board already knew what each of them was — the plan has a card, the branch has a
  row, and the worktree path is the one thing on the panel that leaves the browser
  — so a reader who opened the panel to understand an agent had to find each of
  those by hand.

  Now each is what it names:

  - **BRANCH** is a button that closes the panel and scrolls to its fleet row,
    ringed with the same blue the board's highlighted card wears — one arrival
    colour across both tabs. The row gains an `id` (`agent-row-<branch>`) as the
    scroll target, the Agents-tab twin of `#plan-<slug>`. Revealing the same
    branch twice fires again (a nonce), because scrolling is idempotent and a
    second click otherwise lands nowhere.
  - **PLAN** is a button that opens the plan's card, through the same
    `onOpenPlanFile` the row's plan link already uses. `panel.plan` is the plan
    FILE, which is how the board opens a card.
  - **WORKTREE** offers **Copy path**, and is deliberately NOT a link. A browser
    refuses to navigate from `http://localhost` to `file://`, so a link would
    offer a move it then declines — the board's own rule for a dead PR link: an
    affordance that cannot navigate must not look like one.

  The affordance degrades where it has nowhere to go. A panel whose `plan` is ""
  (a plan the board never walked) leaves PLAN as plain text rather than a dead
  button, and the omission rule still runs first — a fact the panel could not read
  is no row at all.

- [#257](https://github.com/plot-pm/plot/pull/257) [`f12b925`](https://github.com/plot-pm/plot/commit/f12b9258dec1f7503965e4c6f571f5313ef7ed63) Thanks [@jwloka](https://github.com/jwloka)! - board: the row carries its wave verdict, and an eligible wave stops claiming to block

  `AgentRowSchema` gains `verdict` — the shape the contract proposed at
  `ELIGIBLE_NOTE` and declined to build, because the two branches that would have
  collided with it were in flight. Both landed, so the stated reason for deferring
  had expired.

  Three verdicts left the scan and two sentences arrived. `ELIGIBLE_NOTE` carried
  `eligible`, `blockedNote()` carried `blocked`, and `complete` had no carrier at
  all: a merged branch of a still-open wave says _merged — wave still open_, which
  is a fact about the branch and silent about the wave. So a consumer wanting the
  verdict had two sentences to match and one case it could not reach — which is
  why the two siblings waiting on this field, `a-branch-row-names-its-wave` and
  `a-blocked-wave-names-its-blocker`, could not have read it out of prose.

  `WaveVerdictSchema` is reused rather than a fourth state added. The row does not
  classify itself here: it repeats what the scan decided about its wave, so a
  fourth value would have to mean something the scan cannot say. The row's own
  questions already have fields — `state` for its git shape, `group` for its
  section, `waitingOn` for what would move it.

  `classify()` returns it beside the note, from one reading of one argument. It
  could have been taken from `wave.verdict` in `rowsFromPulse`, which has the wave
  in hand — that would be a second derivation of one fact, and the field and the
  sentence could then drift apart. The pair leaving one function together is what
  makes them checkable against each other, and the tests check them as a pair.

  The function was split to get there rather than threaded. `classify` has thirty
  `return` sites and the verdict depends on none of the branching, so passing it
  through each one would put thirty chances to forget it where there is one — and
  a forgotten one fails by leaving the field null, indistinguishable from an older
  scan. `classifyGroup` keeps the body verbatim; `classify` adds the field at the
  single exit, with the signature and every argument position unchanged.

  **Two collapses split, and neither was wrong on today's pulses.** That is the
  finding, not an excuse: both agreed with the correct answer by an invariant of
  `plot-fleet-scan.sh` — it clears `prior_ok` at the first incomplete wave, so
  exactly one wave per plan can be `eligible` and it is the first non-complete one
  — which the board neither states nor owns.

  - The blocker search read `plan.waves.find((w) => w.verdict !== 'complete')`,
    so an `eligible` wave and a `blocked` one arrived as one answer. It now looks
    for the eligible wave, falling back to the first unfinished one where none is.
    A blocked wave named as a blocker answers _blocked by which one_ with another
    blocked thing, which the comment above the search explicitly forbids and the
    old predicate permitted. The first-not-nearest property is kept in both arms
    and asserted separately, since a nearest-match implementation passes every
    other test in the block.
  - `classify`'s `open` arm read `verdict !== 'eligible'`, sending `blocked`
    (true), `complete` (false — a finished wave blocks nobody) and an
    unrecognised verdict (unknowable) to one sentence. The blocked case is now
    named. `complete` and the unrecognised keep the same sentence deliberately:
    an `open` branch of a `complete` wave is a contradiction the scan cannot
    produce, so the arm may not invent prose for a row nobody has seen — and the
    row's `verdict` field now says which case actually arrived.

  Additive and defaulted, the rule `issueAnswer` follows: a payload with no
  `verdict` parses and parses to null. Null is also the answer where there is no
  wave — a planless row built from the PR map, and a verdict this board does not
  recognise. That row reaches `classify` with `'eligible'` as a routing value,
  which steers the function into its PR arm; putting it on the row would claim the
  ordering of a plan that does not exist had been satisfied.

  `ELIGIBLE_NOTE`'s comment stops proposing this field, and two neighbouring
  comments stop describing `isStartable` as matching `note === ELIGIBLE_NOTE` — it
  has read `waitingOn` since that field landed. The prediction those comments made
  came true in the same change that replaced them: _blocked by an earlier wave_
  gained the wave's name, so a prose matcher would have gone quiet rather than
  failed.

  `verdict-not-prose.test.ts` makes that a gate instead of a paragraph. It scans
  `src/` for a matcher against either sentence — an equality, a `.includes`, a
  `.test`, a regex literal — and it checks the OPERATION rather than the words,
  because two files legitimately contain them as data: `claim.ts` composes an
  error message ending _blocked by an earlier wave_, and `AgentList.tsx` labels
  the section _approved — nobody has taken it_. Both write prose for a person,
  which is what prose is for; a check that fired on them would ask the board to
  stop explaining itself in order to go green.

  `plot-fleet-scan.sh` is untouched — it already computes every verdict this
  displays, and Manifesto Principle 3 puts the interpretation on the board's side.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. No helper script is
  touched, and the `/api/fleet` payload gains a field rather than changing one —
  an older client's schema strips what it does not know, and an older server's
  payload validates against the new one by the default.

- [#290](https://github.com/plot-pm/plot/pull/290) [`c203ba4`](https://github.com/plot-pm/plot/commit/c203ba4498ceb9302a3774006f7ebd44aac12831) Thanks [@jwloka](https://github.com/jwloka)! - board: the row shows what it withholds

  Five display findings measured on the live board on 2026-08-19, all of one
  shape — a row stating a fact and withholding its consequence. One branch
  rather than five because all five edit `AgentList.tsx`, which conflicted on
  every merge that day.

  **A section break now reads as a bigger break than a row break.** Measured
  before: 16 px between one section's block and the next section's heading,
  against 4 px between that heading and its own block — and rows sit 35–36 px
  apart. So the strongest structural break on the page was drawn with the
  page's weakest signal. The sections now sit in a container of their own at
  `space-y-8`; the page container keeps `space-y-4` for the banners, which are
  notices about the page rather than sections of it. Row height is unchanged.

  **A plan group draws its own edge, so it stops absorbing what follows it.**
  Two issue rows ([#227](https://github.com/plot-pm/plot/issues/227), [#228](https://github.com/plot-pm/plot/issues/228)) rendered beneath a heading reading
  `the-row-says-what-it-knows (5)` and belonged to no plan: they arrive in the
  separate `issues` field and render after the plan's branches, and the layout
  offered no place where the plan's group ended. A headed group is now a boxed
  `rowgroup` — `data-plan-group` — and the rows that follow it in the section
  sit visibly outside it. The count beside the plan name and the rows inside
  the box now agree.

  **The plan row hosts the approval that belongs to a plan.** `ApproveButton`
  existed, the server reported `approve: {available: true}`, the card read
  `phase: Discovery` — and the button rendered inside the `⋯` menu of a
  _branch_ row, which a Draft plan never has, because a Draft branch has
  nothing to start. So a plan whose whole state was _waiting for a person to
  approve it_ offered that person nothing to click. `PLAN_ROW_TRACKS` gains a
  `1.25rem` actions track (the branch row's own width, so the two line up) and
  a one-item menu. Dispatch stays out of it: that argument was about the act
  that needs a branch, and it still holds.

  **A deferred row states the reason its plan recorded.** Two rows read
  `deferred` beside `no commits` and the honest answer — _nothing_ — was
  never given. The sentence had been in the plan file since the branch was
  shelved; `plot-plan-meta.sh` tested only for the annotation's presence.
  `deferred_reason` now travels plan file → `plot-plan-meta.sh` →
  `plot-fleet-scan.sh` → `deferredReason` on the row, and renders in the row
  rather than only in a `title`. A bare `<!-- deferred -->` sets the flag with
  no reason, where before it read as not deferred at all.

  It renders on the row's own second line — the shape a stuck row already uses
  for `conflict / the host reports this branch does not merge`. Two bounded
  cells were tried first and both were measured failing: beside the branch name
  the sentence crushed `bug/the-no-ref-arm-reads-the-join` to `b… ads-the-join`,
  and in the fixed `14rem` note cell `truncate` gave it zero width so it
  rendered as nothing at all. A sentence does not fit a column, and the row's
  primary key is not the thing to spend on it.

  **Every pointer target reaches 24 × 24 px.** Measured before: the fold
  toggle was 5 × 10 px at `font-size: 10px`, the `⋯` menu 12 × 12, the PR and
  issue links 35 × 16 — 37 elements under 24 px in one direction. Each target
  grows by padding the row absorbs, so the glyphs and the row height are
  untouched; the fold caret goes from 10px to 13px (10px was the outlier — the
  board uses 12px 82 times) and the two fold states are now one glyph rotated
  90°, a difference in geometry rather than in typeface.

  <!--
  bumps:
    skills:
      plot: minor
  -->

- [#278](https://github.com/plot-pm/plot/pull/278) [`d4760f3`](https://github.com/plot-pm/plot/commit/d4760f393d51e4cab7984881110e9f8301c9b16b) Thanks [@jwloka](https://github.com/jwloka)! - board: a timed-out scan reports the estate that made it slow

  `Last scan failed: timed out after 90000ms` names the symptom and hides the
  cause. The scan spawns git once per branch per question, and every spawn reads
  the ref database and the worktree list at startup, so a fat estate makes every
  one of them slower — measured on this repo, 44 worktrees cost 56 ms per spawn
  and a 105 s scan, 11 cost 31 ms and 63 s. The operator who sees only the timeout
  cannot know that pruning stale worktrees would nearly halve it.

  Now the timeout carries the estate: `44 worktrees, 54 branches, 56 ms per git
spawn`. Every number is measured, not estimated — the worktree count and the
  branch count are counted, and the per-spawn cost is timed against this repo's
  actual estate with five bare `git rev-parse --git-dir` spawns, the cheapest real
  spawn there is. There is no fabricated spawn total: the board cannot count the
  spawns of a scan it just SIGKILLed, so it reports the branch count it can
  measure and lets the reader see the multiplier.

  The report is a timeout's alone. A scan that failed any other way — a non-zero
  exit, a spawn failure, a missing terminal line — keeps its bare message, because
  the estate does not explain those. And a scan whose estate could not itself be
  measured (a repo mid-rebase, a vanished worktree) keeps the bare timeout rather
  than a half-filled sentence: an absent number is reported as absent, never as
  zero.

  No skill version bumps and `plot-fleet-scan.sh` is untouched: the scan is killed
  at the budget, so it cannot report anything after the fact, and the measurement
  that survives the kill has to be the board's. The `/api/fleet` payload gains no
  field — the estate is appended to the existing `error` string, which the tab
  already renders as `Last scan failed: …`.

    <!--
    bumps:
      skills:
    -->

  The estate report is board-side only. `plot-fleet-scan.sh` is deliberately not
  changed: a SIGKILLed scan cannot append its own diagnosis, so the measurement is
  taken by the board on the failure path, where the scan is already dead. The
  `/api/fleet` schema is unchanged — the estate rides the existing `error` field.

- [#299](https://github.com/plot-pm/plot/pull/299) [`bc3f46f`](https://github.com/plot-pm/plot/commit/bc3f46fd0060bb3a0ddaffbfff4914f6cd29b302) Thanks [@jwloka](https://github.com/jwloka)! - board: the wave and the phase find their owners

  The row's second column read a **wave name**, a **plan phase**, **nothing**, or
  **a plan phase on a ticket** — four meanings in one unlabelled cell, and which
  one arrived depended on how many waves the row's plan had. A reader cannot see a
  plan's wave count, so the cell could not be read at all without knowing
  something the board never printed.

  `a-row-is-a-tuple` ([#293](https://github.com/plot-pm/plot/issues/293)) landed the shape that ends this: slot 2 holds the
  **kind**, always the same sort of word. This is the wave that empties the cell
  first, so no pulse renders a row that has lost a fact and not yet gained its
  replacement.

  **Both occupants moved to the objects they describe.** The plan phase to the
  plan heading, where `PlanRow` already states it once per group — 71 branch rows
  printed their plan's word (36 `Development`, 26 `Endgame`, 9 `Design`), a fact
  about the plan on a row about a branch. The wave beside the **branch name**,
  extending `a-branch-row-names-its-wave` ([#275](https://github.com/plot-pm/plot/issues/275)): it names a slice of the plan
  that THIS branch belongs to, so it belongs next to the branch, where the
  association is positional and needs no rule.

  **The wave's gate is now a property of the row, not of the fleet.** It was
  `waveCount > 1`, computed across every row of the pulse — defended, correctly
  for where the label then sat, as _a caption over a partition of one is noise_:
  the wave shared a cell with the plan phase, so an uninformative wave name
  displaced a different fact. Beside the branch name it displaces nothing, so the
  count has nothing left to arbitrate, and a branch of a plan divided once now
  names its wave instead of showing nothing. What survives of the old gate is the
  half that was never about counting: `(unnamed)` is not a name, and a
  parenthesised non-answer beside a branch name is worse than blank.

  `waveCountByPlan` went with it. It existed to feed that gate and had no other
  reader — the plan row's summary counts the waves in its own group — and an
  exported pure function with only a test to call it is dead code wearing a
  contract. Its assertions are kept as assertions about `waveLabel`, because what
  they were really pinning is which strings mean _no wave to name_.

  **A property the count made impossible now holds.** The label was a function of
  the fleet, so the same branch could name its wave in one render and not the next
  as sibling rows appeared and vanished between polls. It is a function of the row,
  and the same row always answers the same way.

  **A ticket is no longer labelled `Discovery`.** That is a plan phase on a thing
  that is not a plan and has never entered the lifecycle the word comes from — the
  fourth of the column's four meanings, and the one where the mismatch is total.
  It was defended as _not a fifth phase; the first one, worn by something that is
  not a plan yet_, which is coherent and still borrows another object's vocabulary.
  Worse, the sentence that explained it was a **tooltip** — hover-only text doing a
  label's job. The word `Story` says in the cell what the tooltip was explaining.

  **No tooltip is the only place a kind is stated.** The old cell carried
  `title={waveName ? "Wave: …" : "Phase: …"}`, which was the sole place it said
  which of its four facts it held; a single-meaning cell has nothing to
  disambiguate, so the attribute is **gone rather than reworded**, and a test
  asserts its absence. The `columnheader` reads `Kind` where it read `Phase`, and
  the `sr-only` prefix returns below `sm` — where there is no header to name the
  column — and only there.

  **The deferred exception is gone, and what it protected is stronger.** A
  deferred branch was the one row allowed to keep its phase inside a plan group,
  because _bare `Design` is indistinguishable from a branch nobody ever started_.
  Re-read what that test also asserted — `not.toContain('Development')`: what it
  cared about is that the row must not read as actively worked on. The fact that
  discriminates _handed back_ from _never started_ is the **badge**, which stays
  and still carries its reason in its title. With no branch row printing a plan
  phase, that property holds for every row rather than being arranged per row.

  **The relocation is not a wide-viewport rule.** The card form below `sm` drops
  the phase too — it is where a relocation is most tempting to skip, because the
  row is already a stack of everything and one more word looks free, and it is
  exactly where the reader has the least room for a fact about another object.

  **The grid did not move.** The wave badge went into the branch cell — the `1fr`
  track — rather than earning a track of its own, which is the obvious
  implementation and the one that re-opens the defect: an eighth track crosses the
  `CARD_BELOW_PX` arithmetic `ROW_TRACKS` records having already crossed once by
  8 px. A test pins seven tracks and asserts a row with a badge and a row without
  start their branch cell at the same x.

  **One robustness defect found while testing, and it was not hypothetical.**
  `RowKindSchema` declares `.default('branch')`, but that default is applied by Zod
  _on parse_ — and the client does not parse, it casts (`(await res.json()) as
Fleet`). So a payload with no `kind` arrives as `undefined` with TypeScript none
  the wiser, `data-kind={undefined}` omits the attribute entirely, and the cell
  renders blank on every row. An older server on the other end of a poll is the
  case the board already handles for `prNextInSeconds`. `rowKindOf` restates the
  schema's default at the render site; it reads no other field, so it cannot
  reclassify a row the server did label.

  The geometry constant `PHASE_CELL` was renamed `KIND_CELL` with the column's
  meaning. Its own comment warned that a stale `nth()` would keep **passing** while
  measuring a different column — the quietest way for a geometry test to stop
  meaning what it says — and a name that no longer matches its cell is that
  staleness made invisible.

### Patch Changes

- [`2ab1704`](https://github.com/plot-pm/plot/commit/2ab170446a4c272f47c7d21e39607aa91e67f8d2) Thanks [@jwloka](https://github.com/jwloka)! - board: the marks column's comment says what the code does

  `120a9bc` moved the activity marks out of the row's left padding and into
  a grid track of their own, and left the old rationale standing above the
  new code. The doc comment described the `sm:absolute sm:left-0` placement
  as "UNCHANGED, to the character" — directly above the flow-layout string
  that had replaced it. A reader trusting the comment would have learned
  the opposite of what the code does.

  The superseded argument is kept rather than deleted, because it was
  right when it was written and its expiry is the interesting part: six
  columns should not move for a mark most rows never carry, and 2 of 56
  rows carry one. What broke it is the other side of the trade — `left-0`
  is the row's edge and the section's border sits inside it, so a mark wide
  enough to be seen was clipped in half. A clipped mark is not a cheaper
  mark.

  The heading placement's separate reasoning is untouched and still holds:
  `sm:absolute` positions against the nearest positioned ancestor and the
  `<h2>` has none, so reusing the row's string there would not sit the mark
  slightly wrong — it would land it elsewhere on the page entirely.

- [#258](https://github.com/plot-pm/plot/pull/258) [`b8d9c4b`](https://github.com/plot-pm/plot/commit/b8d9c4b9fdda72c41e14ce861f1bd6918c30d0e3) Thanks [@jwloka](https://github.com/jwloka)! - board: a branch held by a local worktree is somebody working, not nobody

  `WORKING` read `none — nothing to do, just look` while four agents edited files
  in four worktrees, and `NOT STARTED` offered three of their branches as
  _eligible — nobody has taken it_. `plot-dispatch.sh --dry-run` then offered two
  already-implemented branches as dispatchable. Neither section was stale: both
  read the wrong evidence.

  **The no-ref arm asked only whether the tree was dirty.** Dirtiness is inverted
  with respect to progress — it is brightest when least has been achieved and goes
  dark the moment a commit lands — so an agent that committed and kept working
  disappeared. Observed live between two pulses: `WORKING` read `(1)`, then
  `none`, and the only change was an agent committing.

  **`local_worktree` was the fact nobody passed.** The scan has collected it since
  the wave that added it and `FleetBranchSchema` parses it at `schema.ts:700`; it
  reached `rowsFromPulse` and stopped there. `classify` never saw it. So the board
  computed _where this branch is checked out_, rendered the path in the row, and
  still concluded nobody had taken the branch.

  `local_ahead` cannot answer this, and the first attempt at this fix proved it
  twice. Broadening the condition to `localAhead > 0` broke two deliberate tests —
  one pinning that `open` plus unpushed commits stays `not-started`, because
  commits without a worktree are a leftover local ref nobody is on. Changing
  `local_ahead_of` to count against the default branch instead broke a third,
  named _a MISSING upstream is detected, not read as zero_: for a branch with no
  `origin/<branch>` ref the comparison fails, and the 0 it reports means **could
  not compare**, not **no commits**. Both tests were right. The commit count is
  blind to exactly the branches in question, and `plot-fleet-scan.sh` is
  unchanged here.

  A worktree exists on purpose, which is why it is the signal that says _held_
  rather than merely _touched_. The note reads `held in a local worktree` when
  nothing more specific is true, and dirtiness still outranks it — somebody
  editing right now is the more specific fact.

  Same one-directional rule as `local_dirty`, `local_ahead` and `local_locked`: it
  may only lift a row out of quiet, never downgrade one. A merged branch with a
  leftover worktree still reads `done`.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#266](https://github.com/plot-pm/plot/pull/266) [`7d3509f`](https://github.com/plot-pm/plot/commit/7d3509fbfe558b8e113a5993bdbdcc60ba3483c8) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet-scan: report `held` — a worktree holds a branch whose tip has not merged

  The board reported `WORKING: none — nothing to do, just look` while four agents
  were editing files in four worktrees, and offered three of their branches as
  _"eligible — nobody has taken it"_. Both halves are correct readings of the wrong
  evidence: `WORKING` inferred activity from an uncommitted diff, `NOT STARTED`
  inferred freedom from an absent claim ref, and a branch held by an agent that had
  committed satisfied both.

  The fact nobody recorded is **who holds this branch**. The scan already had every
  ingredient to answer it: `git worktree list` names the worktree checked out on
  each branch here, and the ancestry walk already computes whether a tip has
  merged. This adds one derived field, `held`, that is the AND of the two:

      held = (a worktree here has the branch checked out) AND (its tip is not merged)

  **Why the AND, and not just `local_worktree`.** The worktree path alone already
  travels on the row, but it also fires on a CLEAN worktree left on a branch whose
  work has _landed_ — a leftover directory, of which there are several on any
  machine that has run a fleet. Lifting that to WORKING is the merged-leftover
  misread. `local_worktree` answers _where is this checked out_; `held` answers _is
  that checkout somebody holding the branch_, and the merged-tip exclusion is the
  whole difference between the two.

  **Additive, never a downgrade.** `held` can only be true where a worktree is
  present, so every branch on every other machine — every detached worker, every
  teammate's laptop, every CI run — reports `held: false` and answers from its refs
  exactly as before. The claim ref stays the primary, cross-machine signal: worktree
  evidence can move a branch from free to held, never the reverse. A claim ref with
  no worktree here still reads `claimed`.

  **It is reported, never fed back into the wave arithmetic.** A wave still settles
  on `merged` alone; a held branch neither completes its own wave nor opens the
  next. Verified: a held, unmerged branch keeps its wave eligible and the next wave
  stays blocked behind it.

  The field defaults to `false` in `FleetBranchSchema`, so a pulse from an older
  scan still validates — absent and "nothing here holds it" are the same statement.
  The board consumers that read it (WORKING, NOT STARTED, and the dispatch gate)
  are separate branches of the governing plan; this branch only produces the fact.

  Tests (`test/reconcile/fleet.test.mjs`): a committed-and-clean worktree reads
  held; a dirty worktree reads held; a clean worktree on a merged branch does not;
  a claim ref with no worktree still reads claimed and not held; a branch with no
  worktree reports held false; holding a branch does not change its wave
  eligibility.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#269](https://github.com/plot-pm/plot/pull/269) [`c50e0d9`](https://github.com/plot-pm/plot/commit/c50e0d98d6591d5920836f8b18e196453445d1c8) Thanks [@jwloka](https://github.com/jwloka)! - board: the issue row's Create plan moves into the `⋯` menu, freeing the age column

  Every row action on the board reaches the reader through the `⋯` menu — except
  _Create plan_ on an issue row, which `IssueRowView` rendered inline. Two costs,
  both visible in one screenshot: the button sat in the `1.25rem` menu track, a
  slot sized for a glyph, so its text overflowed left across the `2.5rem` age cell
  and the issue rows read `1d`/`Create plan` overlapping; and the reader learned
  two grammars, _actions are in the menu, except this one_ — an artefact of the
  `CreatePlanButton` predating the menu, not a decision.

  `one-place-for-what-a-row-can-do` had already settled the rule and moved a
  branch row's four actions behind `⋯`: **the row says what IS, the menu says what
  you can DO.** This finishes the pattern on the row-kind that move did not touch.
  A new `IssueRowActions` component renders the glyph that fits the track and
  floats the action over the grid, so the age column beside it renders alone.

  The button itself is unchanged — its two-step arm, its refusal on a host that
  cannot be asked, its one-POST-per-click guard are all the button's, and moving
  it changed only where it hangs. It keeps its `data-create-plan` hook, so the
  browser tests reach the same control; they open the menu first, which is the one
  behavioural difference. Escape now backs out of both the armed state and the
  menu, since each listens for it and there is no reading in which one should be
  left behind.

  **The gate is a structural test, not the prose.** The existing
  `a row's actions all live in its menu` scan starts at `Row` and never entered
  `IssueRowView`, which is why _Create plan_ survived on the issue row while every
  branch action moved. The scan now has an issue-row arm: it walks `IssueRowView`
  transitively, allows only `data-issue-link` (the tracker number, the one thing
  the row NAMES) inline, and fails naming any other interactive element — verified
  by injecting an inline action back and watching it catch. Without it the next
  issue-row action lands beside the age again.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. No helper script is
  touched and no skill instruction changes — the move is entirely inside
  `AgentList.tsx`. Manifesto Principle 3 keeps the interpretation on the board's
  side.

- [#288](https://github.com/plot-pm/plot/pull/288) [`7425506`](https://github.com/plot-pm/plot/commit/742550633fa1f5c2250479f118b1172ff28d1e45) Thanks [@jwloka](https://github.com/jwloka)! - board: plans of the same age are ordered by name in every remaining section

  The tiebreak `the-order-holds-still` landed for NOT STARTED, applied to the
  sections that share the defect — WAITING ON YOU among them.

  **The finding is that the fix was not finished.** The flicker was found,
  diagnosed, fixed and merged in `sortByWaiting`, and the identical line sat four
  hundred lines away in the same file: `groupByPlan`'s
  `Math.max(...rows.map((r) => r.ageMinutes ?? -1))`, ordering the plan groups of
  the other five sections on a coarse key with no tiebreak behind it. Nobody had
  watched _this_ section reshuffle. A fix is not finished when the reported
  instance stops.

  The mechanism is the one already recorded: age is a coarse key, so pairs of
  rows that share an age compare `0`, and `Array.prototype.sort` — stable since
  ES2019 — faithfully preserves the order the groups arrived in. **The arrival
  order is what is not stable:** it is rebuilt from a fresh scan every four
  seconds, from a Map whose insertion order follows that scan. The plan NAME
  breaks the tie because it is the only field here that cannot change between
  pulses; an age moves by the minute and a row count moves as branches land, and
  both are derived.

  **Fixed in `groupByPlan` rather than scoped to the reported section.** It has
  one call site feeding all six sections, and only NOT STARTED re-sorts its
  output; a tiebreak scoped to WAITING ON YOU would have left the identical
  flicker in WORKING, WAITING ON A MACHINE, QUIET and DONE.

  Not shared with `sortByWaiting`, which keys on `waitingDays` to answer _which
  plan has been ignored longest_ for a section whose rows are not branches. This
  one keys on the branch tip's clock to answer _which plan holds the most urgent
  row_. Two questions, two keys; only the three-line tiebreak is common.

  Age still decides first: a plan holding an older row stays above an
  alphabetically earlier one, plans of unknown age still sort last as a group, and
  the server's row order inside each group is untouched.

  Verified against the pre-fix source: three of the six new tests fail with the
  arrival order they were given, and the three asserting unchanged behaviour pass.
  NOT STARTED's own 23 tests pass unchanged.

- [#274](https://github.com/plot-pm/plot/pull/274) [`2431ec7`](https://github.com/plot-pm/plot/commit/2431ec7fc095203f5497d48d8e3eb785456d4df8) Thanks [@jwloka](https://github.com/jwloka)! - board: WORKING and NOT STARTED read `held`, not the raw worktree path

  [#258](https://github.com/plot-pm/plot/issues/258) taught the board that a worktree holding a branch is somebody working, and
  did it by reading the worktree PATH directly: `classify` lifted a branch out of
  NOT STARTED whenever `local_worktree !== ''`. That path is present on one row it
  should not lift — a clean worktree left on a branch whose work has already
  landed. A squash-merged-and-deleted branch reads `open` here, because its ref is
  gone and the merge is invisible to a plain ancestry walk, so the leftover
  directory read as _somebody working_ rather than as debris.

  [#266](https://github.com/plot-pm/plot/issues/266) added the fact that separates the two: `held` is the worktree path AND an
  unmerged tip — the AND the scan already computes, emitted as one boolean so a
  consumer reads it instead of re-deriving `!merged`. `FleetBranchSchema` has
  carried it since, and until now nothing read it.

  `classify` now reads `held`. The open-arm lift and the `held in a local
worktree` note both key on the boolean, so:

  - an agent that committed and left a clean tree still reads WORKING — `held` is
    true where `local_dirty` and `local_ahead` (a could-not-compare 0 on a branch
    with no upstream) are both blind;
  - a held branch is never offered as _eligible — nobody has taken it_, the
    invitation that sent a second agent at finished work on 2026-08-20;
  - a clean leftover worktree on a merged-but-open branch stays in NOT STARTED,
    because the scan set `held: false` after excluding the merged tip — the
    merged-leftover misread the plan forbids.

  The raw path no longer reaches `classify` at all: it names the worktree's
  location, which the plan modal shows through the pulse's `worktrees` list, and
  naming a place is a different job from deciding a lift. `held` obeys the same
  one-directional rule as every other local signal — it may only lift a branch out
  of quiet, never downgrade an answer, and it is false on every machine that holds
  no worktree for the branch, so the claim ref stays the primary cross-machine
  signal.

- [#294](https://github.com/plot-pm/plot/pull/294) [`3404aee`](https://github.com/plot-pm/plot/commit/3404aee3f8a791d4b5993d8fc90e8d31e699adfc) Thanks [@jwloka](https://github.com/jwloka)! - board: the agent panel's COMMAND field has a size — three lines, then a scroller

  The COMMAND field expanded, which is the half that worked. Neither of its
  states had a **size**, and that is one mistake measured in two opposite
  directions.

  Collapsed it was one truncated line, and the clip landed inside
  `Read .plot/brief…` — **before the brief's path**, which is the first thing a
  reader opening this panel wants. Expanded it was `whitespace-pre-wrap
break-all` with no bound: fifteen unbroken lines, with words split at the
  character rather than the space — `im`/`mediately`, `5`/`03`. Below it the log
  pane was squeezed to a strip, the panel's other half pushed out by the half
  that expanded.

  | State     | Was                      | Is                                      |
  | --------- | ------------------------ | --------------------------------------- |
  | collapsed | 1 line, clipped mid-path | **3 lines**, wrapped at word boundaries |
  | expanded  | all 15 lines, unbounded  | **bounded**, and scrolls                |

  **Three, not one and not five.** Three reaches past `Read .plot/briefs/…` to
  the first full instruction, which is where a reader stops needing more. Five
  would take half the frame, and a fact that takes half the frame is not a fact
  any more — the log below is the other half of this panel.

  **Bounded when expanded, for the same reason from the other side.** The modal
  is a fixed-height column: the facts block is `shrink-0` and the log is
  `flex-1`, so every line this field grows is a line taken from the log.
  Measured against the unfixed build, expanding dropped the log pane from 207px
  to 105px. `max-h` with its own scroller returns that space, so the log keeps
  its pane in both states.

  **`break-words`, not `break-all`.** `break-all` exists for strings with no
  spaces; this command has spaces throughout, and breaking inside them made
  readable text unreadable. Its one genuinely unbreakable token — the
  shell-interpolated brief path — is short enough to wrap whole.

  **Copy still yields the original string, in both states.** That was the
  previous wave's contract, and a bounded render is exactly the case where it
  must hold. It holds structurally rather than by a second code path: the bound
  is applied to the BOX, so the complete command stays in the DOM either way and
  can be selected by hand as well as copied.

  Tests: `command-fact.test.ts` keeps pinning the lossless collapse without a
  page. `command-copy.browser.test.ts` now MEASURES the sizes against the
  shipped artifact — three painted lines collapsed, a scroller rather than growth
  when expanded, the log pane's height in both states, and `word-break` that is
  not `break-all`. Heights are read off the rendered boxes rather than counted in
  the string, because a clamp is a paint-time bound and the full text stays in
  the DOM underneath it by design; `innerText` would report every wrapped line
  and never see the clamp at all. Verified against the unfixed build: exactly
  those four assertions fail there, and the content and Copy assertions — which
  were never broken — still pass.

- [#279](https://github.com/plot-pm/plot/pull/279) [`2c2748c`](https://github.com/plot-pm/plot/commit/2c2748c06a0b92200f0c7cd89bcfff808157f56f) Thanks [@jwloka](https://github.com/jwloka)! - board: the worker-log footer path is copyable, and it is still not a link

  The path along the panel's foot names the one thing here that lives OUTSIDE the
  browser, and it was plain text with no way to take it anywhere. A `file://` link
  cannot fill that gap — a browser refuses to navigate from `http://localhost` to
  `file://`, which is why it was printed as text in the first place — so the
  footer gets **Copy path** beside the value, and the value stays text. The rule
  is the board's own: an affordance that cannot navigate must not look like one.

  Copy yields the exact string the footer shows, byte for byte, for pasting into a
  terminal where a pager reads a 60 MB log far better than a browser can. It tries
  the async Clipboard API and falls back to `execCommand` where that is absent;
  the board runs on `http://localhost`, a secure context that has the API, but the
  fallback keeps the control honest anywhere and costs little.

  The live rendering above it is what makes the path rarely needed, and it is
  already built: the panel polls on `LOG_POLL_MS`, so a line the worker appends
  appears in the open panel within one interval without reopening it. The real
  output that fills it is supplied by `the-panel-names-the-working-process` (the
  Reads branch of this plan); this branch adds the footer's Copy and pins the
  liveness and the not-a-link property as tests, so a well-meant edit cannot turn
  the path back into a bare string or an anchor.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is board-side only. The polling, the log endpoint
  and `plot-worker-state.sh` are untouched — this wave is the footer control plus
  the guards around behaviour the sibling branches already supply.

- [#283](https://github.com/plot-pm/plot/pull/283) [`3bbac72`](https://github.com/plot-pm/plot/commit/3bbac7285a807cc5fd8d530e13291dcd5dde52a3) Thanks [@jwloka](https://github.com/jwloka)! - board: the note distinguishes a spent rate limit from an unreachable host

  Both footer notes reported every host failure the same way — _PR data
  unavailable (…)_ and _Open issues could not be read_ — so a spent GraphQL
  budget read as an outage. Measured 2026-08-20 while the board was live:
  GraphQL 0/5000, resetting in ~8 minutes, rendered as _unavailable_, a word
  that promises no end.

  A rate limit is a THIRD state, not a variant of the outage
  (`2026-08-20-a-rate-limit-is-not-an-outage.md`): partial, temporary, and with
  a known end. `hostErrorState` reads the failure's kind off the same
  `/rate limit/i` signal the backoff already keys on, so the note and the fetch
  cannot disagree about what happened. When the kind is a rate limit the note
  SAYS so and NAMES when service returns — from `prNextInSeconds`, the reset the
  sibling wave taught the fetch to wait for. The issue note stops claiming the
  tracker _could not be read_ for a budget that was refused rather than failed —
  a check it never ran.

  An unreachable host keeps today's wording verbatim: `an-outage-is-not-an-answer`
  holds, and a rate limit collapses into neither `unreachable` nor `unasked`.

- [#267](https://github.com/plot-pm/plot/pull/267) [`fb27edc`](https://github.com/plot-pm/plot/commit/fb27edc525ff89996a54b9662adca6bd3ed38737) Thanks [@jwloka](https://github.com/jwloka)! - board: NOT STARTED plans of the same age are ordered by name

  The section reordered on almost every 4 s pulse. A list of a dozen plans that
  rearranges itself is unreadable: the eye re-finds its place from scratch each
  time, and a row clicked at the moment of a pulse can be a different row than the
  one aimed at.

  **It was not a sorting bug.** `sortByWaiting` compares waiting days, which is a
  coarse key — most plans in this section were approved on the same day, so most
  comparisons return `0`. `Array.prototype.sort` has been stable since ES2019, so
  it faithfully preserved the order the groups arrived in. **The arrival order is
  what is not stable:** it is rebuilt from a fresh scan every pulse, from a Map
  whose insertion order follows that scan. Stability preserved an unstable input.

  The plan NAME breaks the tie, because it is the only field here that cannot
  change between pulses — `planWaitingDays` moves at midnight, row counts move as
  branches land, and both are derived. A name is the plan's identity.

  Age still decides first: a plan that has waited longer stays above an
  alphabetically earlier one, and undated plans still sort last as a group, now
  ordered by name among themselves.

  Verified by mutation: with the tiebreak replaced by `return 0`, two of the three
  new tests fail with the arrival order they were given.

- [#277](https://github.com/plot-pm/plot/pull/277) [`93336a3`](https://github.com/plot-pm/plot/commit/93336a3620295cb376fbc3282e54c88fe2cadc0c) Thanks [@jwloka](https://github.com/jwloka)! - board: the worker-log overlay locks the page and keeps its place

  `WorkerLogModal` set `overflow-hidden` on its own panel and nothing on the body,
  so a wheel that reached the backdrop scrolled the fleet list behind the open
  panel — and closing it left the reader somewhere other than where they opened
  it. The overlay asserted a modality it did not enforce.

  The App scrolls the window (a `min-h-screen` document, no inner scroller), so
  hiding the body's overflow alone would not have been enough: removing the
  scrollbar reflows the layout and displaces the reader on its own. The lock is
  `position: fixed` pinned to the captured `scrollY` instead — a fixed body cannot
  take a wheel, and the exact offset is restored on close. One mechanism covers
  both guarantees the plan names: no background scroll while open, the same place
  on close.

  Two browser assertions, one per guarantee: a wheel over the backdrop does not
  move the page behind it, and the scroll position after close equals the one at
  open. The restore test opens from a small non-zero offset on purpose — the panel
  opens from a row menu at the top of the list, and a large offset would let
  Playwright's scroll-into-view reset the page to 0 before the panel mounts,
  measuring the harness rather than the lock.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is board-side only. The fix lives entirely in
  `WorkerLogModal.tsx` — no helper script, plan format or `docs/plans` layout is
  touched.

- [#268](https://github.com/plot-pm/plot/pull/268) [`86364b8`](https://github.com/plot-pm/plot/commit/86364b8d31cf8e3d5314fd90c187ec1ffa1fb83b) Thanks [@jwloka](https://github.com/jwloka)! - plot: the agent panel names the agent, not the dispatcher

  Wave 1 of _the agent panel shows the agent_. Measured on the live board: the
  panel headed `Agent bug/the-scan-walks-history-in-one-call` reported
  `PID 58282`, `STATE running`, and an empty log — and `ps -p 58282` was
  `plot-dispatch.sh`, the dispatcher. The agent doing the work was a different
  pid entirely. Every field was read correctly off the wrong process.

  `plot-dispatch.sh` recorded `$!` of the backgrounded `sh -c` **wrapper**, which
  is one process removed from the agent the command runs. The fix backgrounds the
  command _inside_ the wrapper so the wrapper can capture its own child's pid and
  write **that** to `.plot-worker.pid` — the wrapper is the one thing that knows
  its child, so a `pgrep` by command string (the failure this repo already
  recorded as _wait on your own PID, not a process name_) is avoided. Because the
  real `Worker command` is a single command, the shell exec's it in place and the
  recorded pid is the agent directly; `ps -p <pid>` now names it.

  The wrapper's own pid is **kept**, under `.plot-worker.wrapper.pid`, because the
  wrapper is what `wait`s on the agent and records the run's exit code in
  `.plot-worker.exit` — that must keep working, and now `--stop` kills the agent
  while the wrapper survives to record the code. Two pids with two names beats one
  pid with the wrong meaning. Everything downstream — the panel's PID, uptime and
  `--status`/scan liveness — reads that one record, so fixing the write fixes them
  all with no schema change.

  The empty-log message stops guessing about the worker. _"The log is empty — the
  worker has started and written nothing yet"_ read the empty FILE as an idle
  AGENT, and that was false: `claude -p` writes its transcript on exit and emits
  nothing on stdout until then, so an empty log is what a _busy_ agent looks like.
  The message now states the tool's behaviour instead — the same rule the fleet
  scan applies to a host it cannot reach: an absence of output is not evidence of
  an absence of work.

  **Open point resolved — `claude -p` can stream.** `--output-format=stream-json`
  (with `--verbose`) emits progress on stdout in realtime, so a log fed by it
  would fill as the agent works. That is out of this branch's scope: the streaming
  flag belongs to the adopting repo's `Worker command`, not to the dispatcher, and
  changing it is a `Worker command` change rather than a Plot one. Recorded here
  as the finding the plan's first open point asked for; the honest empty-log
  message stands for any runner that does not stream.

  **Discovered, not fixed (out of scope):** the board's `/api/continue` endpoint
  (`server/continue.ts`) spawns the same wrapper shape and records the wrapper's
  pid — the identical bug, one component along. It belongs to
  `bug/the-button-claims-only-what-it-knows`, which owns the continuation surface.

  <!--
  bumps:
    skills:
      plot: patch
      plot-dispatch: patch
  -->

  `plot` bumps because `plot-dispatch.sh` and `plot-worker-state.sh` ship in it;
  `plot-dispatch` bumps for the SKILL/README prose that now documents the two-pid
  split. `@plot-pm/board` bumps for the empty-log wording.

- [#263](https://github.com/plot-pm/plot/pull/263) [`f71ae3b`](https://github.com/plot-pm/plot/commit/f71ae3ba2f02892ffd41461d0f1d40208b99e8b0) Thanks [@jwloka](https://github.com/jwloka)! - board: the fleet-scan budget fits the scan it measures

  30 s was right when the scan took ~10 s. After [#262](https://github.com/plot-pm/plot/issues/262) batched the per-plan reads
  the scan is **34-52 s** on this repo — 84 s before that change — so the budget
  sat below the cost and every pulse was killed before its terminal line.

  **The spread is the machine, not the code.** Measured 2026-08-20 with 12
  worktrees and a load average of 8.35: a _bare_ `git` spawn cost **63 ms**
  against 31 ms on a quiet machine, and the same `rev-list` timed 14 ms, 85 ms and
  111 ms on three consecutive runs. 203 spawns at 63 ms is ~13 s of process launch
  before git does any work.

  A fixed budget below the loaded cost fails **intermittently**, which is the worst
  shape it can fail in: 60 correct rows arrived, the scan was killed before it
  could say it had finished, `pulseComplete` stayed false, the banner never
  cleared, and the footer read `60 branches across 20 plans so far`. Every word of
  that was accurate and indistinguishable from a broken board.

  **90 s is headroom over a 34-52 s cost, not cover for a 279 s one.** The raise
  was refused twice earlier while the scan was 279 s, because a budget fitted to a
  9× overrun hides the next regression instead of reporting it. The remaining
  per-branch `rev-list` block — 64 calls, the last unbatched question — is the next
  thing to remove, and this can come back down when it lands.

  Only the fleet-scan call site changes. The generic `run()` default stays at 30 s:
  every other command the board runs is a single host or git call, and those
  finishing in under 30 s is still the right expectation.

- [#291](https://github.com/plot-pm/plot/pull/291) [`868336f`](https://github.com/plot-pm/plot/commit/868336f8fd886427f2df9311df9c0eff9b371a66) Thanks [@jwloka](https://github.com/jwloka)! - board: the timeout report drops what it cannot measure

  The timeout report named a cause and a remedy: `37 worktrees, 22 branches, 80 ms
per git spawn — the scan spawns git per branch, and every spawn reads this estate
at startup; pruning stale worktrees cuts both the count and the per-spawn cost`.
  Acting on it falsified both halves. 26 of the 37 worktrees were pruned; the count
  fell 70 %, the scan still took 97 s, and the figure the report promised would
  fall rose 33 %, to 106 ms.

  The probe could not have measured what its comment claimed. It timed
  `git rev-parse --git-dir`, which prints a path — it reads neither the ref
  database nor the worktree list, so it was timing how long this machine takes to
  start a process, which is why it tracked system load and rose while the estate
  shrank. The same run clocked `git --version`, a call that opens no repository at
  all, at 2,037 ms.

  The diagnosis was wrong at a level no better probe would fix: of a 131 s scan,
  25 s was spent inside git across 96 spawns. 81 % of the time is not in git, so
  neither the number of spawns nor what each spawn reads can explain the timeout.

  So `perSpawnMs` is deleted rather than repaired, along with the causal sentence
  built on it. Attributing spawn cost to an estate needs a second estate to compare
  against and the board has only the one it runs in, which means there is no honest
  version of the number available from here — the fix is removal, not a better
  measurement. The timeout now reads `37 worktrees, 22 branches` and proposes
  nothing: the reader learns the estate is large and the scan did not finish, which
  is true, cheap to observe, and what a timeout report owes.

  The counts stay because they were always measured. So does the rule that made
  this a wrong _sentence_ rather than a fabricated _value_ — `measureEstate` still
  returns `null` rather than a partial object, so a count that could not be read is
  reported as absent and the bare timeout stands. Non-timeout failures still keep
  their bare message. The timeout path is also two git spawns lighter, the five
  probe spawns having gone with the number they fed.

  Naming the plan the scan actually died in would be a real measurement, and
  `--stream` already emits one line per plan, so it is reachable. That is recorded
  as the follow-up: this change's job is to stop asserting a false cause, not to
  find the true one.

    <!--
    bumps:
      skills:
    -->

  Board-side only, and no schema change: the estate rides the existing `error`
  string. `plot-fleet-scan.sh` is untouched for the same reason it was untouched
  when the report was added — a SIGKILLed scan cannot append its own diagnosis. No
  skill bumps: no skill documented the per-spawn figure.

## 0.5.2

### Patch Changes

- [#234](https://github.com/plot-pm/plot/pull/234) [`a06f0d2`](https://github.com/plot-pm/plot/commit/a06f0d26b55ba8a37b23454f499b448e3a388875) Thanks [@jwloka](https://github.com/jwloka)! - board: a deferred row answers to the phase too

  Wave 2 of the same rule, and it exists because the rule had two doors and [#231](https://github.com/plot-pm/plot/issues/231)
  put a guard on one of them.

  Measured on the live board 2026-08-18, minutes after [#231](https://github.com/plot-pm/plot/issues/231) merged:

  ```
  NOT STARTED: 20 rows — 17 open, 3 deferred
    feature/the-pulse-repairs-the-artifact   plan phase: NONE
    feature/a-repaired-row-says-so           plan phase: approved
    feature/plot-sprint-support              plan phase: RELEASED
  ```

  The `open` rows moved as designed — `a-squashed-branch`, `bb-state-vocabulary`
  and `the-gate-reads-what-was-shared`, all Released, left the section. The
  `deferred` rows did not.

  `classify` answers a deferred branch in an arm **above** the one the phase check
  sits in, so those rows reached NOT STARTED by a route that never met the guard.
  Two doors into one room, and a rule guarding one of them is not the rule.

  `feature/plot-sprint-support` is the case in full: annotated `deferred` because
  the branch was **never created** — February's work landed directly on main — and
  its plan has read `Released` since v1.0.0-beta.3, four months ago. The board
  offered it as available work throughout.

  **The phase now answers first for every row in the section, whatever route
  brought it there.**

  ## The narrowing is exactly the terminal phases

  The deferred arm is not removed, and its `'you'` answer is not replaced — it is
  **bounded**:

  | Plan phase   | A deferred branch of it         | Why                                                                                 |
  | ------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
  | Draft        | NOT STARTED, waiting on **you** | not finished — a shelved branch of a plan under review waits on a person twice over |
  | **Approved** | **NOT STARTED, waiting on you** | **unchanged** — somebody shelved it, somebody may un-shelve it                      |
  | Delivered    | DONE                            | the work is done; nothing on the shelf waits for anyone                             |
  | Released     | DONE                            | the plan shipped, and the shelf is part of its history                              |

  `deferred` keeps its meaning _within_ a plan that can still move. It stops being
  a waiting state once the plan is finished.

  The check sits **above** the arm's three exits — a PR, a commit age, no commits
  — rather than beside one of them. Those distinctions refine what a live plan's
  shelf says, and a finished plan has nothing for them to refine.

  An unrecognised phase is placed with its name said aloud, as in the `open` arm
  and by the same allowlist argument. `''` falls through untouched:
  `feature/the-pulse-repairs-the-artifact` rendered `plan phase: NONE` in the same
  measurement, its plan unresolvable from the branch name — and filing that under
  DONE would be the same guess in the opposite direction.

  `waitingOnFor` is unchanged. Its comment said the deferred row was _the one row
  here that a phase check does not account for_; that was true, and was the
  defect. The line is now correct because the route is guarded rather than in
  spite of it, and the function still derives its answer from the group rather
  than repeating the phase test — a second copy of the rule there is the drift its
  shape exists to prevent.

  `FINISHED_PLAN_NOTE` covers both routes with one sentence. A finished plan's
  branch reaches the section as `open` when git has no ref for it and as
  `deferred` when the plan shelved it; the reason is identical either way — the
  work landed elsewhere, so no branch was needed.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content. The `/api/fleet` payload is
  unchanged — this decides differently with data the pulse already carried.

- [#231](https://github.com/plot-pm/plot/pull/231) [`c0ad490`](https://github.com/plot-pm/plot/commit/c0ad4903cc8d099867144bc071d5b74518233a60) Thanks [@jwloka](https://github.com/jwloka)! - board: the plan's phase answers first, in NOT STARTED and in WORKING

  The section groups by **branch state** and never asked the plan's **phase**. A
  branch with no ref reads as "never started" — which is true of a branch nobody
  created and equally true of one deleted at merge four months ago.

  Measured on this board 2026-08-18, ten plans in NOT STARTED:

  ```
  approved   3   ← the only ones /plot-dispatch will start
  draft      7   ← refused with "plan not approved yet"
  released   1   ← plot-sprint-support, shipped in v1.0.0-beta.3
  ```

  Measured again after a plan-hygiene sweep set 39 delivered plans to `Released`
  — **20 rows, ten of them Released**, each offering a merged branch:

  ```
  Released  a-squashed-branch-is-…  bug/a-squashed-branch   eligible — nobody has taken it
  Released  bb-state-vocabulary     bug/bb-state-vocabulary eligible — nobody has taken it
  Released  the-gate-reads-what-w…  bug/the-gate-reads…     eligible — nobody has taken it
  ```

  All three shipped in v2.5.1 the same day. **The board was advertising released
  work as available**, and the sweep did not cause that — it multiplied a defect
  that had been hiding behind a single row.

  The section is now filtered on the plan's phase FIRST:

  | Phase        | May an agent take it?  | Section         |
  | ------------ | ---------------------- | --------------- |
  | Draft        | no — waits on approval | WAITING ON YOU  |
  | **Approved** | **yes**                | **NOT STARTED** |
  | Delivered    | no — work is done      | DONE            |
  | Released     | no — shipped           | DONE            |

  **This is not a rule layered on top of the phase model — it is the phase
  model.** `Approved` is precisely the phase meaning _decided, not yet done_, and
  the only one in which `/plot-dispatch` hands a branch to an agent. Stated as one
  inclusion rather than three exclusions because that is what it is.

  A `Draft` plan moves to WAITING ON YOU and **names what it waits on** —
  approval — rather than offering a branch nobody may claim. A `Delivered` or
  `Released` plan lands in DONE, with a note accounting for the missing ref:
  `plot-sprint-support` has no branch because the change went straight onto main.

  **The phase is read from the plan, never inferred from the branches.** Inferring
  is the defect: a Released plan whose branch has no ref is bit-identical in git
  to an Approved plan nobody has started, and only the plan says which it is.

  **Within `Approved`, nothing changed.** Branch state is still what refines the
  answer there, and an Approved plan with unclaimed branches renders exactly as
  before — the phase is the first question, not a replacement for the second.

  ## WORKING had the same gap, mirrored

  Measured minutes after the case above:

  ```
  WORKING (2)
    Released  not-yet-asked-is-not-not…  bug/a-refresh-that-nev…  uncommitted work in a local worktree
    Released  one-place-for-what-a-ro…   bug/a-rows-actions-live-in-its-menu  uncommitted work in a local worktree
  ```

  Both PRs ([#220](https://github.com/plot-pm/plot/issues/220), [#224](https://github.com/plot-pm/plot/issues/224)) merged and shipped in v2.5.2. **Both workers were dead.**
  What the board read as _someone is working here_ was leftover scratch files —
  `agentlist_temp.tsx`, `.fleet_part1.js` — that the workers wrote after pushing
  and never cleaned up.

  So the rule is not "the phase decides NOT STARTED". The phase answers **first in
  every section**, and the local facts refine within it. Each section asks _what
  would move this forward_, and for a finished plan the answer is _nothing_ — it
  is done. **Local debris is not work.**

  ## The ordering, in two halves

  The split is by whether a phase can honestly say _nothing would move this
  forward_:

  - **Terminal phases (`delivered`, `released`) answer first**, above even the
    local-worktree check. Only _finished_ outranks the sight of somebody typing.
  - **`draft` and an unrecognised phase answer below it.** A plan under review
    whose branch is being edited right now has someone working on it — the review
    is what is outstanding, not the work — and a phase the board cannot read is
    not evidence of anything.
  - **Both sit above the wave verdict.** A wave's ordering is a question about an
    approved plan, and neither of these is one.
  - **Only `open` branches are affected.** A finished plan whose branch carries
    commits, a claim or a PR keeps its git answer — drift between a plan's records
    and its git state is worth seeing rather than smoothing over, the same rule
    `rowPhase` already follows.

  **An allowlist, not a blocklist**, matching `prAsksNobody` in the same file and
  for its reason: a blocklist of finished phases would silently start claiming _an
  agent may take this_ the first time a phase is added. An unrecognised phase
  lands in DONE and names itself, so the plan file is where the reader is sent.

  **A pulse reporting no phase is unchanged.** Absent is not a guess — a scan
  predating the field says nothing about the plan, and reading that as unstartable
  would empty the section wholesale against an older scan.

  Derived, never stored: a plan that becomes Approved changes section on the next
  pulse with nothing to clear and no restart, which is asserted by scanning one
  fixture twice.

  `waitingOnFor`'s draft arm is **deleted** rather than left unreachable. It
  answered `you` for a Draft plan's first wave because those rows used to sit in
  this section; they no longer arrive, so a dead arm there would be a second rule
  asserting they belong — exactly the drift that function's derive-from-the-group
  shape exists to prevent. The concern it answered is answered better by the move:
  a four-wave Draft plan no longer puts four loud rows on the board for one
  pending approval, because it puts none.

  The Start button needed no change, and that is the check that the split is in
  the right place: `isStartable` reads `waitingOn === 'click'`, which is null
  outside `not-started` by construction, so Draft and Released rows lose their
  button without a second rule anywhere.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content. The `/api/fleet` payload is
  unchanged — `phase` has travelled on the pulse since [#140](https://github.com/plot-pm/plot/issues/140), reported and unread;
  this decides with it. No skill documents which section a plan's rows land in.

## 0.5.1

### Patch Changes

- [#224](https://github.com/plot-pm/plot/pull/224) [`5bf408e`](https://github.com/plot-pm/plot/commit/5bf408e478d1bce283e20aaac4fbb21116e34fcf) Thanks [@jwloka](https://github.com/jwloka)! - board: every action a row offers lives in its menu

  Four actions, two homes, and no rule telling them apart. _Open failing run_
  and the conflict dispatch rendered inline in the row; _Start work_ and
  _Approve_ rendered in the `⋯` menu. The split followed the order the four
  were built in, and nothing else.

  Reported while a row showed a CI failure — _why is "Open failing run" not in
  the `⋯` menu?_ The honest answer was that nobody had decided.

  The rule now: **the row says what IS, the menu says what you can DO.** Both
  inline actions moved into the menu as items with their own conditions.
  Navigation to a thing the row NAMES — its plan, its branch, its PR — stays
  inline, because a `cmd`-click on a real link is worth more than a tidier
  line. _Open failing run_ names none of those; it addresses a run, which the
  row reports on rather than is.

  Two measured costs, both gone:

  **The run was reachable only while the row was red.** The link rendered on
  `stuck.state === 'ci-failing'`, so the route to a run existed exactly as long
  as the failure did, and a reader wanting the last run of a green branch had
  no control at all. Its condition is now _a run URL exists_. The label
  followed the condition — a green row offering _Open failing run_ would
  promise a failure that is not there, so the item reads **Open last run** and
  the row's own stuck cell keeps the word _failing_ for when it is true.

  **The menu opened on nothing.** It rendered on every row, dimmed, on a layout
  argument: rendering nothing would leave the right edge ragged and moving as
  the five-second pulse gave and took actions. A later wave answered that — the
  cell has a fixed `1.25rem` track, so the column holds still whether or not a
  button is in it. What remained was a control that lies, measured lying on two
  of six WAITING ON YOU rows. A row with no items now renders no button. **A
  refusal is not an absence**: a row whose act the server declines still shows
  its button and names the reason on it.

  **The stuck cue did not move.** It is state rather than an action — it points
  at something being wrong, and a signal reachable only by opening a menu is
  not a signal. It renders in the row beside the word and the evidence it
  describes.

  Found on the way, and fixed here because the move exposed it: the
  close-on-outside-click listener closed the menu on **capture**, while the
  container that was supposed to stop it did so on React's **bubble** phase. The
  close always won, so React 19 — which delegates to the root — unmounted the
  menu before any handler inside it ran. The run link's click followed its href
  and never fired `onTaken`, leaving the cue animating at an answered request.
  It now hit-tests the target against the menu's own box.

  The rule is a gate rather than a comment: a structural test scans every
  component reachable from the row body, skips the menu, and fails on any `<a>`
  or `<button>` that is not one of the row's three named-thing links. Verified
  by putting the removed link back and watching it fail.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` changed but the generated `board-server.mjs` artifact, which is
  rebuilt output rather than authored skill content, and no skill documents what
  a row's `⋯` menu holds — so no skill's behaviour changed.

- [#219](https://github.com/plot-pm/plot/pull/219) [`a4ecf36`](https://github.com/plot-pm/plot/commit/a4ecf3632db03b9c40f7062a304eabcd742f481e) Thanks [@jwloka](https://github.com/jwloka)! - <!--
        bumps:
          skills:
            plot: minor
            plot-dispatch: minor
            plot-fleet: minor
        -->

  plot: `finished` is not a verdict

  Every worker exits 0 — the one that opened its PR and reported cleanly, the one
  that stopped rather than claim a test run it had not seen, and the one that
  stopped to ask which retry semantics were wanted. Measured across seven
  worktrees during a four-agent fleet run. All three read `finished`, whose
  documented move is _review it_, and two of the three needed an answer instead.

  The process reports how it TERMINATED, never whether the task is DONE. So a
  clean exit is now refined by the tree, which is where the difference lives:

  | Condition                    | State                                  |
  | ---------------------------- | -------------------------------------- |
  | process alive                | `running`                              |
  | an open or merged PR         | `finished` — the work reached review   |
  | a blocked marker in the tree | `waiting` — a person owes it an answer |
  | uncommitted or unpushed work | `stalled` — work on the floor, no PR   |
  | otherwise                    | `finished`                             |

  Added **once**, to `plot-worker-state.sh`, which is the whole reason wave 1
  merged the duplicate first. `failed`, `ended` and `none` are untouched: each
  already says something specific about the process, and none of them is the
  `finished`-means-everything blur this splits.

  `waiting` and `stalled` are as opposite as `failed` and `finished` — _answer it_
  sends a person to a question, _resume it_ sends a worker back to work. A marker
  therefore outranks work on the floor: a worker that stops to ask has almost
  always left its work uncommitted beside the question, and reporting that as
  stalled invites a restart into the same wait. Measured happening twice to one
  branch, the second restart re-running what the first had finished.

  **Plot now names the marker: `PLOT-BLOCKED:`.** `TODO(you)` emerged from workers
  and was documented nowhere, so it could drift into `TODO(human)` — which it
  already had, in the same session — or into `ASK:` or prose, and a marker the
  classifier cannot find is a `waiting` reported as `stalled`. Both emergent
  spellings stay recognised beside the defined one: they exist in trees right now,
  and dropping them would silently regress every worker already running. The
  defined marker is what Plot **asks** for; the emergent ones are what it still
  **accepts**.

  The marker is read from the TREE, never the log. The log records that a question
  _was asked_; only the tree records that it is still _unanswered_, and only the
  tree clears when someone writes the answer.

  **`stalled` carries what is on the floor** — the count and the file names, not
  just a number. The names make the row actionable without a second command,
  which is the point of reporting it at all.

  **The PR fact travels as an argument**, supplied by each caller. The scan caches
  one host reply per branch per run behind its `--offline` gate; `plot-dispatch
--status` asks per branch when a person types it. A lookup inside the classifier
  would fork a `gh` per branch on a scan the board polls every 5 s, or break
  `--offline`'s promise of no network. Unanswerable is never a yes — offline, no
  backend, or a host returning 503 falls through to the local signals and reads
  `stalled`: _go and look_, rather than _stop looking_.

  **Editor leftovers are not work** (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`) —
  a guard restarted a branch over an orphaned `plot-dispatch.sh.tmp1` while its
  worker was making progress. Nor is Plot's own bookkeeping: `.plot-worker.pid`,
  `.plot-worker.exit` and `.plot-worker.log` are untracked files the fleet writes
  into the worktree, and counting them made every tidily-finished worker read
  `stalled`. The exclusion stays narrow otherwise — an uncommitted source file is
  exactly the case this detection exists for.

  Two silent failures were caught while building this, both in the reassuring
  direction and both invisible behind `2>/dev/null`. `git grep --no-index
--untracked` is a fatal error (the flags are mutually exclusive), and `git grep
-qIE <pattern> --untracked` parses `--untracked` as a revision — each exits 128
  having matched nothing, so every waiting worker would have read `stalled`. And
  an unpushed-count fallback against `origin/main` reported every clean branch
  `stalled` in a repo with no remote, because `rev-list --count "..HEAD"` with an
  empty left side counts the whole history from the root. Only the branch's own
  `@{upstream}` answers that question; with no upstream it is unanswerable, and an
  unanswerable question licenses no verdict.

  The board reports both states in `waiting-on-you` with distinct notes — _waiting
  on an answer from you_ versus _stopped with work unfinished — resume it_.

  **Nothing is restarted.** The scan is read-only (Manifesto Principle 1); a
  `stalled` row names the branch and what is on the floor, and the decision to
  relaunch stays in `/plot-dispatch`. The reaper is untouched: it classifies
  _empty_ claims and answers a different question, and a stalled worker has work
  worth keeping.

  The prototype `.dev/scripts/fleet-pulse.sh` — corrected three times by watching
  it act — is deleted. Two things computing verdicts from one dataset is how they
  drift, which is the defect wave 1 removed.

- [#221](https://github.com/plot-pm/plot/pull/221) [`b54bcf3`](https://github.com/plot-pm/plot/commit/b54bcf3cea96c188745f533f0c3fdfd192834101) Thanks [@jwloka](https://github.com/jwloka)! - board: `none` is an observation, so it is only printed where one was made

  `WAITING ON A MACHINE — none` was printed in two opposite situations: after
  the host had answered and reported nothing pending, and before the host had
  been asked at all. They want opposite responses from the reader, and the
  reassuring one was the default.

  Measured 2026-08-18 from two screenshots of one board 22 seconds apart. At
  `PR data 22s ago` the section read `none` and no row carried a status. At
  `PR data 4s ago` the same board reported [#57](https://github.com/plot-pm/plot/issues/57) `conflicts`, [#196](https://github.com/plot-pm/plot/issues/196) `checks
failing` since the previous day, and [#203](https://github.com/plot-pm/plot/issues/203) `CI running`. Nothing changed on
  the host between them. **A branch whose CI had been red overnight presented
  as unremarkable**, and a branch the host reports as unmergeable presented the
  same way. The operator's reading was that the board had lost its state; it
  had not yet fetched it.

  This is the rule `2026-08-17-an-outage-is-not-an-answer` established — a
  failure to observe must not be reported as an observation — at the one
  boundary that plan did not cross. An outage at least produces an error to
  carry. A first fetch that has not happened produces nothing at all, which is
  how it survived a plan written to catch exactly this shape.

  The section now says which clock it was read from. Four states:

  | Situation                  | Shown as                   |
  | -------------------------- | -------------------------- |
  | fetched, something pending | the rows, as today         |
  | fetched, nothing pending   | `none` — unchanged         |
  | not fetched yet            | `not checked yet`          |
  | first fetch failed         | `could not reach the host` |

  **A failed call is its own state, not a fourth spelling of the third.** Both
  mean no host fact is on the board, so one label would have been defensible —
  but `not checked yet` clears itself within seconds and asks the reader for
  nothing, while an outage waits for somebody to read the error. Folding them
  together would re-file a standing fault as a passing one, which is the
  opposite of what `an-outage-is-not-an-answer` was for. The distinction costs
  nothing to compute: `refreshPrs` already leaves `prAt` untouched when the
  call throws, so a null age beside an error is a first fetch that FAILED
  rather than one not yet made — and the footer has read the pair that way all
  along.

  **Header and body, not one or the other.** The header's hint is what a reader
  sees while scanning, and QUIET and DONE prove a header can be the only part
  of a section on screen; the empty-grid cell is what they see after opening
  the section to look for rows. A single site would leave one of those two
  readings unlabelled.

  **A first-load state, not a staleness display.** Once the host has answered,
  every later answer is an answer no matter how old: ordinary ageing is what
  the footer already reports (`PR data 111s ago`), and re-labelling the section
  every 60 s would trade one misreading for a flicker. The age is tested
  against null and never against a threshold.

  The two clocks stay separate, which was the point. `hostAnswer` takes
  `Pick<Fleet, 'prAgeSeconds' | 'prError'>` rather than the whole fleet, so a
  later edit reaching for the git scan's `ageSeconds` is a compile error rather
  than a review comment — the window where rows are git-fresh and host-unfetched
  is not an edge case, it is most of every minute.

        <!--
        bumps:
          skills:
        -->

  No skill version bumps: this is a board-side change only. Nothing under
  `skills/` reads or documents what the Agents tab prints in an empty section,
  and the `/api/fleet` payload is unchanged — every field this distinction is
  drawn from (`prAgeSeconds`, `prError`) was already in the contract and already
  in the footer. Only the rendering conflated them.

- [#222](https://github.com/plot-pm/plot/pull/222) [`8d96491`](https://github.com/plot-pm/plot/commit/8d964916c8d06915c7df0e17bc73f316e4ee10b2) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: the scan prunes what it fetches, so a stale ref stops outranking the host

  A branch squash-merged and deleted at merge reported `in progress` for as
  long as one local ref nobody pruned still pointed at it. Measured
  2026-08-18, minutes after PR [#218](https://github.com/plot-pm/plot/issues/218) merged: the host answered `MERGED`, the
  remote had no such branch, no worktree and no claim remained — and
  `--list-eligible` returned nothing, so wave 2 could not be dispatched at
  all. `git fetch --prune` by hand cleared it and the wave opened
  immediately.

  `git fetch` does not remove remote-tracking refs for branches deleted
  upstream; only `--prune` does, and the scan's fetch did not pass it. So
  every branch merged with `--delete-branch` left one behind on every machine
  that had fetched it, surviving until an operator pruned for unrelated
  reasons — which is what made this look intermittent.

  **The stale ref did not add noise; it disabled the check that would have
  been right.** `branch_state()` picks its arm on the ref's PRESENCE: with
  the ref there the scan takes the ancestry path, which a squash merge breaks
  by construction (the squash commit does not contain the branch tip), so the
  branch fell to `wip` — and the host lookup that would have answered
  `merged` lives in the other arm and was never reached. Under a merge commit
  the ancestry test is true anyway, which is why only squash merges expose
  it; this repo squash-merges by default.

  The fetch at the top of the scan now prunes, on the connection it already
  opens. No new host call and no new logic: the stale ref never exists, the
  no-ref arm is entered, and the host lookup added in [#216](https://github.com/plot-pm/plot/issues/216) answers.

  **The merge lookup did not move.** It is safe only by placement — a branch
  someone _recreated_ has a ref and takes the ancestry path deliberately, so
  hoisting the lookup would report in-flight work as `merged` and open the
  next wave onto work still being done. Pruning is safe precisely because it
  reorders nothing: it makes the local view match the remote, and the
  existing arms then apply as designed.

  One detail is load-bearing and easy to get wrong. **The explicit refspec is
  required.** `git fetch --prune origin <main>` prunes _nothing_ outside
  `<main>`: naming a refspec scopes the prune to that refspec's destination
  namespace. The obvious fix — a bare `--prune` on the narrow fetch the scan
  already made — is therefore a no-op for exactly the branches it exists to
  clear, and it looks correct. Restating the default heads refspec alongside
  `<main>` widens the prune back to the whole mirror, still in one connection.
  A test pins this against git directly, so the refspec is not later read as
  redundant and removed.

  Nothing depended on a stale ref surviving. `local_ahead_of()` reads
  `refs/remotes/origin/<br>..refs/heads/<br>`, and already answers 0 on a
  missing ref by exit code rather than by emptiness — the same answer it
  gives for every branch living on another machine, so the count degrades to
  absent rather than to a wrong number. `local_dirty`, `local_locked` and
  `local_worktree` read the worktree rather than the mirror, so uncommitted
  work stays visible; conflict prediction is gated to `wip|claimed`, which a
  pruned branch is not; and `--prune` removes only remote-tracking refs, so
  no local branch or work is touched.

  `--offline` is decided and stated rather than left to be discovered: it
  skips the fetch, so it cannot prune, and a surviving ref may keep a merged
  branch reading `wip` and hold its wave blocked. That is the honest answer
  for a scan that asked nothing — but the symptom looks nothing like "you
  passed `--offline`", so the footer now says so, and a failed fetch says
  that it failed to prune too.

  <!--
  bumps:
    skills:
      plot-fleet: patch
  -->

## 0.5.0

### Minor Changes

- [#212](https://github.com/plot-pm/plot/pull/212) [`97e6eaa`](https://github.com/plot-pm/plot/commit/97e6eaae0f494af77f96023afcd520ac0c625f64) Thanks [@jwloka](https://github.com/jwloka)! - plot-board: `/api/fleet` names the ref it read

  The read path renders staleness honestly for an eye — "scanned 10s ago" — and
  said nothing equivalent to a machine. The gap has a measured cost. During a live
  two-agent dispatch on 2026-08-18 an operator read current-looking data while
  their local `origin/main` was behind other agents' pushes. Three wrong diagnoses
  followed, including "the fleet endpoint is broken" and "the scan exceeds the
  board's timeout" — neither true. The board was right every time; it simply could
  not say WHICH WORLD it was right about.

  The response now carries three fields:

  - `readRef` — the commit the scan actually read
  - `readRefAge` — how old that read is, in seconds
  - `localHead` — the local checkout, which may differ, and when it differs that
    difference is the whole answer

  **The fallback runs in one direction, and the asymmetry is the design.**
  `plot-fleet-scan.sh` emits only `head` today; a sibling branch adds `read_ref`
  and `local_head` while keeping `head` as an alias for one release. Both shapes
  are tolerated, because the two branches were deliberately made independent — but
  `head` is `git rev-parse --short HEAD`, the local checkout under a name that
  implies more. It is a sound fallback for `localHead`, which is the same fact,
  and an unsound one for `readRef`, which is a different commit whenever the
  operator is not standing on a freshly fetched main.

  So a scan that emits only `head` yields `readRef: null`. Filling it in would
  manufacture the precise false statement the field exists to end — a report
  signed with the name of a commit it never read — silently, on every consumer.
  Null says "the scan did not tell me", and a consumer can act on that. The
  string `unknown` is passed through distinctly: the scan looked and could not
  resolve the ref, which is a different fact from a scan that predates the field.
  Neither reads as a confident claim.

  `readRefAge` is null rather than 0 before any scan lands, following the absent
  value convention `prNextInSeconds` and `mergeable` already set in this file: one
  absent-value shape per field, and an absent value never reads as a confident
  claim. 0 would assert a read that just happened.

  The fallback path is exercised by a test that plants a pulse of each shape
  against a scan that cannot succeed, so what comes back is attributable to the
  fixture rather than to whatever the script happens to emit today.

  <!--
  bumps:
    skills:
  -->

  No skill version bumps: this is a board-side change only. `plot-fleet-scan.sh`
  is deliberately untouched — it belongs to the sibling branch
  `bug/pulse-names-the-ref-it-read` and two more queued behind it — and no skill
  documents the HTTP API, so no skill's behaviour changed.

### Patch Changes

- [#206](https://github.com/plot-pm/plot/pull/206) [`ca45361`](https://github.com/plot-pm/plot/commit/ca45361522f6b41eb034ac4655d11ff18bbf39c3) Thanks [@jwloka](https://github.com/jwloka)! - plot-host: a running check reports pending, not green

  WAITING ON A MACHINE was empty every time it was looked at, and the
  reason was a mistranslation pointing the reassuring way.

  GitHub sends `conclusion: ""` for a check still running — an EMPTY
  STRING, not null — and the reader was `(.conclusion // .state)`. jq's
  `//` substitutes only null and false, so `$c` stayed `""`, matched none
  of the three tests, and fell through to `green`. **A running CI read as
  a passed CI**, permanently rather than occasionally.

  Measured on the release PR while its `validate` job was in progress: the
  adapter said `green`, GitHub's own rollup said `IN_PROGRESS`.

  The field is `status` besides; `state` never existed on a rollup entry,
  so the fallback pointed nowhere even when it fired. Both are corrected at
  all three sites that read the rollup, and the conclusion still wins
  wherever it says anything — a fix that simply preferred `.status` would
  report every finished check by its lifecycle word (`COMPLETED`) and turn
  failures green.

- [#211](https://github.com/plot-pm/plot/pull/211) [`f5560c3`](https://github.com/plot-pm/plot/commit/f5560c389efa20ae4752e56ba893edef0161a9f9) Thanks [@jwloka](https://github.com/jwloka)! - board: a successful scan that describes less says so

  Rows vanished from the Agents tab and returned seconds later — including
  WORKING rows for agents that were demonstrably running — with no error and
  no staleness marker.

  The cache already refuses to let a FAILED refresh overwrite a good result,
  and the comment says why: replacing real state with emptiness because one
  scan failed is what makes a monitoring view untrustworthy. That rule
  carried an unstated assumption underneath it — _any success is
  authoritative_ — and it is false. A scan can exit 0, emit schema-valid
  JSON, and describe fewer plans than the scan before it. Measured in a
  sandbox 2026-08-18: `origin/main` genuinely carried three plans, the scan
  reported two, because it enumerates the working tree rather than the ref it
  names. Nothing treated the smaller answer as suspicious, so it was cached,
  rendered, and replaced by the next full one.

  `pulseShrink` now compares each incoming pulse against the cached one
  before it is accepted, and a loss rides beside the pulse as `shrink` — a
  field distinct from `error`, because the two are opposites in the way that
  matters: `error` means the scan failed and its result was discarded, this
  means the scan SUCCEEDED and its result was kept. The tab marks the view
  instead of swapping it without comment.

  The smaller pulse is deliberately ACCEPTED rather than rejected. Plans
  really do get delivered, and a monitoring view that cannot shrink keeps a
  dead row forever — a different kind of lie. _Degrade, do not hide_, the
  rule the bridge already follows for staleness.

  Two details are load-bearing:

  - **Identities, not counts.** "3 plans became 2" cannot tell an operator
    whether the plan that vanished is one they just delivered or one another
    agent pushed a minute ago. Counts also miss a shape the set difference
    catches: one plan arriving as another leaves nets to zero, so a count
    comparison passes it in silence while a row really did vanish.
  - **Branches are compared even when their plan survives.** A plan that keeps
    its file but loses a wave's branches produces no plan-level difference at
    all — and that is precisely the reported symptom.

  This is the symptom fix, and it is valuable on its own: the cause — the scan
  globbing the working tree instead of the ref it claims to read — is a
  separate branch against `plot-fleet-scan.sh` and is untouched here.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#216](https://github.com/plot-pm/plot/pull/216) [`9988157`](https://github.com/plot-pm/plot/commit/9988157d1b5419b2c5d1672b742576732b2fb413) Thanks [@jwloka](https://github.com/jwloka)! - plot-fleet: a squash-merged branch is merged, not open

  Squash-merge a branch and delete it, and the fleet reported it as `open` — the
  same word it uses for work nobody has started. Two individually reasonable
  facts combined into a wrong answer.

  A branch's state comes from its ref, and `--delete-branch` removes it. And
  `pr-merge` detection walks merge commits, which a squash merge never produces.
  Measured on the merge of PR [#209](https://github.com/plot-pm/plot/issues/209):

  ```
  $ git log -1 --format="%h parents=%p %s" a263711
  a263711 parents=c3b2dda plot: board verification ... ([#209](https://github.com/plot-pm/plot/issues/209))
  ```

  One parent, and a subject naming `[#209](https://github.com/plot-pm/plot/issues/209)` rather than the branch. The exhaustive
  merge-commit walk has nothing to match.

  **It was live in two shapes.** `2026-08-18-plot-board-setup` had both wave-1
  branches merged ([#208](https://github.com/plot-pm/plot/issues/208), [#209](https://github.com/plot-pm/plot/issues/209)) and still read `Scripts — eligible` with `Skill`
  blocked — and a wave that cannot complete blocks its successor permanently, so
  the fan-out `/plot-dispatch` exists to perform could not get past wave 1 under
  this repo's own merge convention. Separately, the board advertised delivered
  work as available: `bb-state-vocabulary` sat under NOT STARTED, "eligible —
  nobody has taken it", while its plan read `Phase: Delivered` and PR [#210](https://github.com/plot-pm/plot/issues/210) was
  `MERGED`. "No ref" defaulted to _start this_ rather than _cannot tell_, which
  is the reassuring direction and therefore the worst one.

  The data was never missing — only not local. When a branch has **no ref**,
  there is nothing left to read locally, so the host is asked: one call per
  absent branch, not per branch, and none at all where refs exist.

  | `pr-state` says           | Branch reads                     |
  | ------------------------- | -------------------------------- |
  | `MERGED`                  | `merged` — the wave can complete |
  | `OPEN` / `CLOSED`         | its existing meaning             |
  | `NONE`, or the call fails | `open`, exactly as before        |

  **The last row is load-bearing.** `plot-host.sh` already separates a lookup
  miss (exit 0, state `NONE`) from a transport failure (non-zero) — the
  distinction it grew on 2026-08-17, when GitHub returned 503 all afternoon and
  every branch read as having no PR. Only an explicit `MERGED` may move a branch
  off `open`, because `merged` settles a wave and opens the next one; an
  unreachable host that manufactured a `merged` would open a wave onto a seam
  that never landed. A test asserts that failure direction, not merely the happy
  path.

  The lookup is placed inside the no-ref arm, which is what keeps the reused-name
  case correct: merge `feature/retry`, delete it, recreate it for a second
  attempt, and the host still answers `MERGED` about the _first_ attempt. A
  recreated branch has a ref, so it never reaches the lookup — pinned by its own
  test.

  **Cost, under a 5-second board poll.** Gated once per run on both a real
  backend and `--offline`/`--no-fetch`, so the ambient pulse the board relies on
  still makes no host calls whatsoever. Answers are cached per branch for the
  length of one scan — on disk rather than in a variable, because `branch_state`
  runs inside a command substitution and a subshell's assignments are discarded
  the moment it closes. The cache directory is created per run and removed on a
  trapped exit, so no answer outlives the scan that fetched it: a stale `merged`
  read from a previous run is exactly the fabricated verdict the failure
  direction forbids. A test asserts the call count — one for the absent branch,
  none for the branch whose ref is still there.

  **One number the plan did not have, and it belongs in the open.** The board
  refreshes every 5 s without `--offline`, so it takes the host path: 720 scans
  an hour. The within-run cache bounds a scan to ONE call per absent branch, but
  across runs the arithmetic is 720 x (absent branches) — ~720 calls/hour for a
  single squash-merged branch, ~3600 for five. `gh pr view --json` is GraphQL, so
  these draw on the same 5000/hour budget this board exhausted on 2026-08-16.

  Measured worst case: 20 absent branches against a host that fails every lookup
  costs 4.1 s per scan versus 1.2 s offline — about 150 ms per absent branch. The
  board's refresh is off the request path, guarded against overlap, and capped at
  30 s, so nothing stalls; the cost is quota, not latency.

  That is bounded by the count of absent branches in ACTIVE plans, which is small
  in practice and shrinks as plans are delivered. It is left as measured rather
  than pre-optimised — the plan's own fallback, matching the PR number in the
  squash subject, is the offline answer worth reaching for if this proves too
  expensive, and it should be chosen against real numbers rather than this
  estimate.

  The cache key is injective rather than a plain slash-to-underscore mapping:
  `feature/a_b/c` and `feature/a/b_c` are both legal refs that collapse to one
  key under the naive form, and the branch asked second would inherit the first's
  answer. A `merged` arriving that way settles a wave on a branch nobody looked
  at — the same fabricated verdict, reached through the cache instead of the
  host. Pinned by a test that fails against the naive mapping.

  <!--
  bumps:
    skills:
      plot-fleet: minor
  -->

  `plot-fleet` minor: the scan gains a source it did not have, and the skill's
  `merge_detect` table documented `open` under a squash/rebase repo as saying
  nothing about whether work merged — now true only when the host cannot be
  asked. Behaviour and documentation both changed; nothing was removed.

## 0.4.0

### Minor Changes

- [#189](https://github.com/plot-pm/plot/pull/189) [`30f7294`](https://github.com/plot-pm/plot/commit/30f7294538e814a565350a59623a6245e6dbadab) Thanks [@jwloka](https://github.com/jwloka)! - The activity mark becomes a glowing bar down the row's left edge — prominent enough to spot from across the board, and **static**.

  **The wave before this one made the mark honest; this one makes it loud.** `isActive` reads `localLocked || localDirty`, so there is finally something true to make prominent — and the order was paid for: a glow over `group === 'working'` would have been _a livelier lie_, which is why the quiet rendering shipped first.

  **It does not animate, and that reverses two-thirds of what was asked for.** The report asked for _pulsing, left-right movement, and a glow_; only the glow is adopted. The plan settled this when two elements on a row animated. Measured on `main` before this branch, there are now **four** — so the argument is stronger rather than weaker:

  | Selector                           | Animation       | Means                   | Lifetime       |
  | ---------------------------------- | --------------- | ----------------------- | -------------- |
  | `[data-live-dot]`                  | `animate-pulse` | in the WORKING group    | hours          |
  | `[data-change-mark]`               | `animate-pulse` | a PR state just changed | ~3 s           |
  | `[data-stuck-cue]`                 | `animate-ping`  | an unanswered request   | until acted on |
  | _(the change-mark's dark variant)_ |                 |                         |                |

  A fifth at a fifth scale competes rather than adds. The ordering principle that settles it: **a fact true for hours has less claim on motion than a fact true for three seconds.** Motion is the scarce channel and the transient marks hold it. Activity is persistent by nature — someone is writing, and will be for a while — so it takes **presence**, with its appearance and disappearance carrying the change. The travelling motion is refused for a second reason of its own: motion that traverses implies a destination, and this has none.

  **A bar rather than a bigger dot**, because the reported problem is spotting it _from a distance_: a vertical stroke at a fixed x reads as a mark down the side of the list, where a dot must be hunted among the row's words. `h-3 w-0.5` becomes `h-5 w-1` — a stroke spanning nearly the row's full height rather than a tick beside it. It also scales to the group heading a later wave adds: a heading can carry the same stroke, where a dot would read as a bullet.

  **The glow is what carries the prominence the motion was asked to carry**, and it is an explicit emerald `shadow-[…]` rather than a step on the neutral shadow scale — those are greys for lifting a surface off the page, and a grey blur around a 4 px bar reads as a smudge rather than a light.

  **`motion-reduce` leaves the mark and its glow completely unchanged**, because nothing here animates. The repo's rule — _keep the mark, stop the movement_ — has no movement to stop, and what it must not do is strip the glow: the glow is the channel that will separate this mark from the unpushed mark a later wave adds (_glow means someone is here_). A reduced-motion rule that removed it would take that distinction with it before it is built.

  **It keeps its left-padding home**, hanging beside `LiveDot` via `sm:absolute`, deliberately outside the six grid tracks so the columns do not move in from the edge on every row in the fleet to reserve room for a mark most rows never carry. Asserted in pixels: a row without the mark renders its columns at the same x as one with it.

  **`aria-hidden`, and the `title` keeps its limit.** Every signal behind the mark is local — `fleet.ts` is explicit that these are _"true only on the machine doing the looking"_ — so an agent on another machine produces no mark here, ever, and that absence means **not visible from here**, never _not happening_. The mark goes on saying _A write is in progress in this checkout_ rather than letting absence speak for itself.

  **`isActive`, the lock echo, and the contract are untouched**, as are `[data-live-dot]`, `[data-change-mark]` and `[data-stuck-cue]`: four marks, four meanings, and no mark implemented by modifying another.

  The claims are pinned in two places, split by what each can actually answer. The class list — no `animate-*`, no `motion-reduce:` variant, an emerald `shadow-[…]`, a bar rather than a dot — is read out of the source in `test/unit/agent-list.test.ts`. What only a page can state moves to a new `test/integration/activity-mark.browser.test.ts`: that the glow is a _computed_ `box-shadow` and not a class Tailwind never emitted, that reduced motion renders the mark byte-identically, and that the six tracks do not move.

  Two of those assertions were written weaker first and strengthened by mutating the implementation to check they went red. `boxShadow !== 'none'` passes on a glow stripped by `motion-reduce:shadow-none`, because Tailwind v4 resolves that to five transparent shadow slots rather than to the literal string `none`; the assertion now names the emerald layers. And a source-reading helper that walked forward from `data-live-dot` landed in the wrong element's class list, because every mark names the other three in its doc comment — it now anchors on the JSX attribute.

  <!--
  bumps:
    skills: {}
  -->

- [#185](https://github.com/plot-pm/plot/pull/185) [`4d6d77c`](https://github.com/plot-pm/plot/commit/4d6d77c4d828e5277a1c39d9dece5d6b919bd776) Thanks [@jwloka](https://github.com/jwloka)! - A stuck branch now says so in its row, names which of the four states it is in, carries the evidence, and — for the two the pulse cannot fix — offers its action on the row with an animated cue.

  **The facts reached the row and stopped.** The previous wave landed the detection and put `stuck` on `AgentRow`; measured on `main`, `AgentList.tsx` rendered zero occurrences of it. Closing that gap is the whole of this change.

  **Four states, four words.** _Stuck_ as one label would be the one-label-many-states defect this board keeps removing: `artifact conflict`, `conflict`, `CI failed` and `unpushed work` differ in the only way that matters, which is what a person does next. `artifact-conflict` and `conflict` in particular are not degrees of one thing — the first has a resolution a rebuild and a CI no-diff gate can prove without anyone reading a diff, and the second does not.

  **Evidence travels with the state, always.** A row that says _stuck_ and makes the reader go find out why has moved the ten minutes of log-reading rather than removed it. A conflict prints its conflicting paths, unpushed work prints its commit count, and a failing check prints three lines — the failing step, the branch's changed paths, and the branch's own recent run history:

  ```
  CI failed — step: Install Playwright browser
  this branch changes docs/plans/a.md
  recent runs: failure at 10:19, success at 10:17
  ```

  Nothing compares those runs and nothing classifies the failure. A heuristic mapping failing steps to changed paths was rejected: that table is unmaintained by construction and goes silently wrong the first time a workflow is restructured (Principle 3). An empty evidence field says _unavailable_ rather than vanishing — `runHistory: []` is _this host has no run listing_, never _this branch has never failed before_.

  **The action goes on the row, not in the three-dot menu**, and that is measured rather than preferred: `RowActions` hides its action behind a menu that only opens if something inside could act, so a row with a waiting action looks identical to a row with none until you click it. A cue nobody finds is not a cue.

  **The cue animates, and this is the one place on this board where motion is right.** A neighbouring wave settled the opposite for the activity mark — _a thing true for hours has less claim on motion than a thing true for three seconds_ — and a stuck branch is neither: it is true **until someone acts**, and the acting is the point. Motion here marks an unanswered request, not a state.

  It is bounded so it cannot become wallpaper:

  - **Only where an action is offered.** `unpushed` is reported in words — the fix is a push, and pushing someone else's judgement is not ours to make. `artifact-conflict` offers nothing in this wave; the repair is a separate one.
  - **It stops when the action is TAKEN**, not when the branch unsticks. The request has been answered; whether the answer worked is what the row's other marks report.
  - **`motion-reduce` keeps the cue and stops the animation.** Both halves — hiding the element would take the marker along with the movement.
  - **Never motion alone and never colour alone.** The action carries a word, the reason reaches the accessible name, and the cue is `aria-hidden`.
  - **A healthy row carries no cue.** A cue on every row makes the stuck ones invisible.

  **Over a non-localhost binding the cue shows and the action refuses, naming the reason.** `/api/dispatch` is localhost-only — _whoever reaches localhost:7777 is sitting at the machine that owns the worktrees_ — so over Tailscale the board is a reading surface. The information is true everywhere, so hiding the cue would let a phone report a healthy fleet while branches sit stuck: a worse lie than an action you cannot take from where you are.

  **A stuck branch keeps its group**, and a row with `stuck: null` renders exactly as before. No row moves, no section is added, and the common case costs nothing.

  **No write path was added and no route was widened.** The conflict action dispatches through the existing guarded `/api/dispatch`, with `plot-dispatch.sh` deciding everything it already decides. There is no rerun route on this server, so a failing check offers a **link to the failing run** rather than a rerun — navigation to where the rerun button already lives, on the host. `[data-live-dot]`, `[data-change-mark]` and `[data-activity-mark]` are untouched: four marks, four meanings, and no mark implemented by modifying another.

  <!--
  bumps:
    skills: {}
  -->

- [#192](https://github.com/plot-pm/plot/pull/192) [`ee3c4c8`](https://github.com/plot-pm/plot/commit/ee3c4c8818ca389cd1ab05f316a4bf175efdf2ea) Thanks [@jwloka](https://github.com/jwloka)! - A green check no longer outranks an unknown merge: `prState` returns `unknown` when the host could not say whether a branch merges, before consulting `checks` at all.

  **Measured, live, from a screenshot.** On 2026-08-17 PR [#57](https://github.com/plot-pm/plot/issues/57) read `green` in the agents row while the host said the branch could not merge:

  ```
  plot-host:  checks="green"   mergeable="conflicting"
  gh:         mergeable=CONFLICTING   mergeStateStatus=DIRTY
  ```

  A branch unmergeable for 22 days wearing the one word a reader acts on without checking. A minute later the same row read `conflicts`, correctly — so the defect is real, intermittent, and repairs itself, which is why nobody reproduced it on request.

  **The fold was right; its input was not.** `prState` handled `conflicting` correctly and had no case for `unknown`, so control fell through to `checks`. GitHub computes mergeability lazily and its API returned `503` at least four times that afternoon; under that load `mergeable` comes back `UNKNOWN` while `statusCheckRollup` — a plain stored field — still answers `green`. The function's own comment already stated the rule it needed — _a new word from a future host must read as cannot say, never as the reassuring end of the range_ — and applied it to `checks` while letting `mergeable` bypass it.

  `conflicting` still outranks everything and the new line sits below it, so a host that knows the branch conflicts still says so. **`checks` is not consulted to break the tie**, and that is the point rather than an omission: the two fields answer different questions, and a green check says nothing about whether a branch merges. Twenty-two days of green on a conflicting branch is the proof.

  **The note now says WHICH fact is missing**, because only one of the two is actionable: _cannot say whether it merges_ sends a reader to check for a rebase, _cannot read the checks_ sends them nowhere but back later. `classify` and `draftNote` carry the same precedence as `prState`, so a row's word and its sentence cannot disagree — a draft whose mergeability could not be read no longer gets the silence that means _not ready for you, but otherwise fine_.

  **A transition into or out of `unknown` does NOT flash the change marker.** With the fix, a 503 turns `green` into `unknown` and the next pulse turns it back — two flashes per row per outage, and there were four outages in one afternoon. `unknown` is a fact about the _observation_, not the world, and the marker reports changes in the world; this is the marker's own rule — _absent is unknown, never a value_ — applied one level up, the same reason it already refuses to flash on a first sighting. The memory carries the last known value across the unreadable pulse rather than storing `unknown`, so `green → unknown → failing` still flashes when `failing` becomes visible: the marker misses the moment, never the fact.

  **Where no PR on the board could be read, the empty WAITING ON A MACHINE section names the host's limit** instead of promising _CI will finish_. Measured: the Bitbucket adapter emits a literal `checks:"unknown", mergeable:"unknown"` on every row because `bb` has no run listing. That is the CLI's limit rather than deferred work, so that section is permanently empty there — and an unexplained empty section reads as _nothing is running_ rather than _this host cannot tell me_. The condition is ALL and not ANY: one unknown row among readable ones is a single PR mid-outage, and an empty board claims nothing at all.

  **One consequence is a real cost and is asserted rather than left to be found.** `stuck.ts` reads `prState`, so a branch whose checks are `failing` while its mergeability is unreadable no longer reports `ci-failing` — it reports nothing until the next readable pulse. That is the correct trade: a stuck verdict derived from a pulse the host could not answer is a guess, and `stuck` is the one field a later wave is licensed to act on. The row still _says_ _cannot say whether it merges_, so nothing is hidden from the reader; only the machine-actionable claim is withheld. Locally-observed evidence — a `merge-tree` conflict, unpushed commits — is unaffected, and asserted so.

  No contract change and no new field: `prState` remains a pure function over the two facts it already received.

  Two test factories omitted `mergeable` and now state it. That is load-bearing rather than cosmetic: unreadable mergeability outranks every `checks` verdict below it, so an omitted field would send every case in those blocks down the new arm and assert nothing about the checks each was named for. One assertion is replaced rather than added — it read `.toMatch(/no checks/)` for `mergeable: 'unknown'`, which encoded the defect.

  <!--
  bumps:
    skills: {}
  -->

- [#199](https://github.com/plot-pm/plot/pull/199) [`07b5f12`](https://github.com/plot-pm/plot/commit/07b5f12dae7b9b2458bd31ac01338346aca91245) Thanks [@jwloka](https://github.com/jwloka)! - A group heading on the Agents tab now carries the same activity mark its rows carry, so a **collapsed** section says whether anything inside it is moving instead of only how many rows are in there.

  **A folded group reported its stock, not its motion.** The heading renders `(4)`, and the comment above it says why that number exists at all: _"a folded header with no number reads as nothing here"_ — it was introduced to separate **absent** from **empty**, not to report change. It is the same shape as the live dot: a count reporting membership where the reader is looking for activity. And this is not hypothetical. **QUIET and DONE start collapsed** by default and the choice is persisted in `localStorage`, so they stay folded across sessions — while QUIET's own comment names its purpose exactly: _"go check whether this died"_. A group whose entire job is to surface possible deaths was folded shut showing a stock count. The rows are **removed from the tree** when folded, not merely hidden, so the heading is the only thing on the page that can say anything about them.

  **Binary, and no second number.** At least one row is active, or none is. `(4, 2 active)` was the alternative and is rejected: `(4)` exists to separate absent from empty, a distinction this board paid for, and a second figure beside it dilutes the one job that number has. The reader opening a group does not need to know whether it is one row or three — they need to know whether opening it is worth it.

  **The strongest pace its rows state, never stronger.** A group holding one written-to row among three merely-claimed ones travels **fast**; a group holding only claimed rows travels **slow** — the same _unknown, never nobody_ ordering every mark on this board keeps. **The pairing that matters:** an implementation returning the weakest pace, or keeping the last row's answer, passes every assertion that only checks _the heading has a mark_ and lets one measured write hide behind three unobserved claims — when that measured row is precisely the reason to open the group. The test puts the written-to row **last**, so an implementation stopping at the first live row it meets fails rather than passing by luck.

  **It reads both entry paths, because a row has two.** `active` is the fleet's answer for the whole list at once — `isActive` in this pulse, or a lock still echoing from a recent one — and `isLive` adds the rows the fleet places in WORKING while observing nothing local. A heading computed from `isActive` alone would go dark for a group whose rows still carry marks, which is the heading disagreeing with the rows beneath it.

  **It cannot disagree with its rows, and that is structural rather than tested.** The heading is `groupPace(rows, active)` computed at render, from the same set the rows are rendered from. No new field, no stored count, nothing to drift — the way a separately-maintained figure would. It reads only the rows it was given: `active` answers for the whole fleet, so a heading asking _is anything in the fleet active_ would light every section on the board from one busy row in one of them.

  **The heading keeps the mark when expanded.** Hiding it on expand was considered — the rows show it themselves, so the heading repeats them — and rejected because the marker would then vanish at the moment of opening, which reads as _it stopped_. A marker that disappears when you look closer is worse than one that repeats itself.

  **The mark gained a placement, not a second design.** Everything it _is_ — the track, the travelling dot, the glow, the two paces, the titles, `aria-hidden` — is shared with the row, because a group heading says what its rows say and must say it in the same marks. Only where it hangs differs, and that difference is load-bearing: the row's placement is `sm:absolute`, which positions against the nearest positioned ancestor, and an `<h2>` **has none**. Reusing the row's class list would not have sat the mark slightly wrong — it would have hung it off whatever ancestor happened to be `relative` and landed it elsewhere on the page, a failure no class-name assertion can see. The two placements are a named table, the row's pinned whole so a shared component gaining a second caller cannot quietly change the first caller's geometry.

  **`aria-hidden` earns its keep twice here.** The mark renders _inside_ the collapse toggle, so without it the button's accessible name would become "quiet (2) a write is in progress in this checkout". The heading's words and the row's note still carry the fact.

  **`(4)` still means what it meant**, and the heading does not grow a second line: asserted against an unmarked section's heading height.

  <!--
  bumps:
    skills: {}
  -->

- [#191](https://github.com/plot-pm/plot/pull/191) [`128cd67`](https://github.com/plot-pm/plot/commit/128cd6703d8094c285be19bac8fccadbeb697ee4) Thanks [@jwloka](https://github.com/jwloka)! - NOT STARTED now counts **plans**: one row per plan, carrying the plan's own clock and a summary of its waves, with the branches folded beneath it and expandable. The section sorts by how long each plan has waited, oldest first.

  **Its rows were never branches.** Measured live on 2026-08-17, every row in that section carried `pr=—` and `age=—` — the branch name came out of the plan's `## Branches` section and no branch was ever created for it. **Six rows for four plans**, with `activity-shows-itself` appearing three times for one waiting plan, the two extra rows carrying nothing the first did not. Compare WAITING ON YOU in the same pulse: four rows, all four with a real PR and a real age. There the branch is the subject because it holds work that exists.

  So this is one row shape carrying two meanings — the defect this board keeps finding, this time not in a field but in the identity of a row.

  **Folded, not summarised away.** The branch names are the plan's own words for what it will do, and a reader who wants them must not have to open the plan file to get them back. They are collapsed by default behind an expander and come back whole. A plan with only one branch beneath it gets **no** expander: a control that reveals a row it already shows is noise.

  **The wave summary is derived from the group's own rows — no contract field was added.** `waveSummary` on the schema lives on the card, and a fleet row knows only its own wave; but the view already holds every row of the plan in this section, so counting them and reading their notes answers _how many, and is the first one startable_. `first eligible` reads the same `isStartable` predicate the row menu does, so the summary cannot promise an action the menu then refuses.

  The limit is recorded rather than hidden: this counts the waves **in this section**. A plan whose first wave already merged has that wave in DONE, so the row reports the remainder — two where the plan file lists three. That is the honest number for the question the section asks, and the plan link on the row carries the full arc.

  **The section's sort was broken, and this fixes it.** The group order came from `Math.max(...rows.map((r) => r.ageMinutes ?? -1))`, and `ageMinutes` is `null` on every row here — so every group scored `-1`, the comparator returned 0 for every pair, and the sort did nothing at all. `plot-sprint-support`, approved 187 days ago, sat wherever insertion order put it, beside a plan from that afternoon. It now sorts by `waitingDays`, **oldest first**, because that is the only clock that ticks in this section. Sorting startable-first was rejected: the startable plans are already marked by their own note, and burying a six-month-old plan under a fresh one hides exactly the drift this section exists to surface. An undated plan sorts last — `-1` would assert a wait nobody measured.

  This is the **group** order and deliberately not the same question as `compareWithinGroup` in the server, which orders the rows _inside_ a group newest-first on the reasoning that six months of availability is evidence nobody wants a branch. That answers _which branch do I pick up_; this answers _which plan has been ignored longest_, which is what a reader scanning section headings asks. The server's row order survives untouched inside each fold.

  **A deferred branch keeps its own row**, with its own PR and its own age, beneath its own plan row. Those branches _were_ started and were then shelved, and the server records what flattening them costs: an earlier version wrote `deferred` as the note, and _"a branch started and then shelved read as never begun, with its age and its PR erased."_ A separate "shelved" section was rejected — it cuts a branch from the plan that explains it.

  **The indicator sits with the plan** on a plan row, and with the branch on a deferred row. Same rule every other section follows — the marker belongs to whatever is waiting — applied to a different subject.

  **The grid tracks do not move.** A plan row is laid on the same `ROW_TRACKS` as a branch row, so every column keeps its x and the section boundary does not break alignment. The plan takes the plan track; the wave summary takes the branch track, which is where a reader looks for _which slice of it_. The PR track is empty on purpose: a plan has no pull request of its own, and inventing one from a branch beneath it would state something no field says.

  **Every other section is unchanged** and still renders branch rows. The six sections stop sharing one row shape, and that is the real cost — but it is the one section whose rows are not the same kind of thing as the others', and forcing them into the shared shape is what produced `pr=—`, `age=—`, and three rows for one plan.

  The inner fold is **not persisted**, unlike the section-level collapse. Folding QUIET is a standing preference about a section a reader has decided not to watch; opening one plan's waves is a momentary question — _what were the three branches again_ — asked and answered. Restoring it on a board reloaded several times an hour would rebuild the crowding the fold removes.

  <!--
  bumps:
    skills: {}
  -->

- [#205](https://github.com/plot-pm/plot/pull/205) [`65a4f6b`](https://github.com/plot-pm/plot/commit/65a4f6bc22db22a52efc2824152a4552a1bdba88) Thanks [@jwloka](https://github.com/jwloka)! - board: NOT STARTED says what each row is waiting for

  Three rows in that section can look identical and mean opposite things:
  one waits on a person, one is free to take, one cannot move until a
  predecessor lands. The notes said so and were invisible until read.

  The waiting-state now travels as a **field** (`waitingOn: you | click |
time`), computed server-side where the wave verdict and the plan phase
  are both in hand — the row carries only its own wave name and could
  never have derived it. The blocking wave travels with it (`blockedBy`),
  so _blocked by an earlier wave_ becomes **blocked by `Truth`**: _by which
  one?_ is the reader's unavoidable next question and it costs one string.

  **Only `needs you` is loud.** `ready to start` keeps the ordinary note
  colour — available, and taking it is optional — and `waiting its turn` is
  quieter still. A section where every row is coloured has coloured
  nothing, and blocked rows outnumber eligible ones two to one in a
  multi-wave plan.

  **A Draft plan colours only its FIRST wave.** The later ones would still
  be blocked the instant the approval landed, so they read as _waiting its
  turn_. This falls out of testing the wave verdict before the phase rather
  than from a special case.

  Nothing animates. Motion marks an unanswered request; a plan drafted
  minutes ago is the ordinary state of a plan just written.

  `isStartable` now reads the field instead of comparing the note against
  `ELIGIBLE_NOTE` — the shape that fails silently, and would have failed
  here, because this same change reworded a neighbouring note. The client
  no longer imports any note constant.

            <!--
            bumps:
              skills:
                plot: patch
            -->

- [#182](https://github.com/plot-pm/plot/pull/182) [`07eeceb`](https://github.com/plot-pm/plot/commit/07eecebe6b1d915e1d05fe8d35391c1bbb02f903) Thanks [@jwloka](https://github.com/jwloka)! - A row on the Agents tab now marks itself when something is actually being written to it, rather than when it happens to sit in the WORKING group.

  **The dot was not too quiet; it was too uninformed.** `isLive` was the whole of `row.group === 'working'` — which is an _address_, not a pulse. A row keeps that address for **hours**: while an agent works, while an agent has crashed, and while it waits on a human. Nothing measures the end. Six rows carried the claim simultaneously during the session that reported this, and making it louder would only have amplified a statement the board cannot support.

  Meanwhile the scan already produced the answer and threw it away. `local_dirty`, `local_locked` and `local_ahead` have been in the contract since [#167](https://github.com/plot-pm/plot/issues/167) — `local_locked` reads `.git/index.lock` and was fought for the same day in `board-survives-its-agents`, on the argument that a locked worktree must become **its own signal rather than silence**. All three reached `classify()` inside `rowsFromPulse` and were dropped there. Producing a signal and never rendering it is a quieter version of the defect that plan fixed.

  **A row is active when `local_locked || local_dirty`** — someone is writing, or has written and not committed. `local_ahead` is deliberately **not** part of it: unpushed commits are finished work sitting _still_, a real condition with a real remedy (push it) and no motion behind it. An implementation OR-ing all three passes every positive assertion this change makes and reports a branch nobody has touched for hours as though someone were typing into it. It earns a static mark of its own in a later wave.

  **A seen lock echoes for 6 s.** Measured tension: `.git/index.lock` lives from a fraction of a second to a few seconds, and `FLEET_POLL_MS` is 4 s — so most locks are born and die _between_ two pulses, and the sharpest signal the board has is the one it most often misses. Six seconds is longer than one poll (so a seen lock survives the next pulse, which is the entire point) and shorter than two (so it always clears). This is the one place the board lets a marker outlive its fact, and it is bounded by three rules, each with its own test: the echo **only ever adds**, so a pulse finding nothing neither clears it early nor extends it; a lock **never resurrects**, because the echo starts only where a lock was _seen_; and it is **a marker, not a state** — the row's note goes on reporting whatever the last pulse actually found, and each echo clears itself on its own timer rather than waiting for a pulse, which is what keeps a board whose server died from sitting lit.

  **Absent is not false.** Both fields are `.default(false)`, and a scan that could not observe a worktree reports absence rather than cleanliness. So `false` yields **no mark** — never a mark reading _idle_. The strongest statement licensed here is _unknown, never nobody_.

  **The marker names its own limit**, because a technically-correct marker can still mislead. Every signal behind it is local — `fleet.ts` is explicit that `local_dirty` is _"true only on the machine doing the looking, and false is what every branch elsewhere reports"_ — so an agent on another machine produces **no mark here, ever**. Its branch is not idle; it is unobservable from this checkout. The marker says _a write is in progress in this checkout_ rather than letting absence speak for itself.

  **No existing mark was modified.** `isLive` and `[data-live-dot]` are untouched and still mean _in the WORKING group_; `[data-change-mark]` keeps its full-row amber wash. Three marks, three meanings — the standard [#180](https://github.com/plot-pm/plot/issues/180) set when it shipped beside the dot rather than over it, and a row can carry all three at once. The activity mark is rendered minimally here on purpose: it reads the right thing before it is made prominent, because a glow over `group === 'working'` would have been a livelier lie.

  The two fields had to be **forwarded onto `AgentRow`** to reach a component at all — they existed only on `FleetBranchSchema`, the raw scan document. Additive, both `.default(false)`, forwarded rather than re-derived so the group and the marker always answer from one reading of one scan. `classify()`, grouping and the scan itself are unchanged.

  <!--
  bumps:
    skills: {}
  -->

- [#180](https://github.com/plot-pm/plot/pull/180) [`3f4179f`](https://github.com/plot-pm/plot/commit/3f4179f1620d9e25f8cdcb77ac6fae0e3569d165) Thanks [@jwloka](https://github.com/jwloka)! - The Agents tab's status column now has room for what it holds, and a row marks itself for about three seconds when its PR status changes.

  **The space was not missing; it was misallocated.** `ROW_TRACKS` gave the branch `1fr` and the status `9rem` — and `1fr` does not mean _take what you need_, it means take everything left over. So on a wide window every spare pixel collected between the branch name and the status cell as a gap that belongs to the branch column and draws nothing, while `⑂116 no checks` was the widest thing 144px could render. The status track is now a fixed `14rem` and the branch keeps `1fr`: 80px comes back from a gap that displayed nothing, and every column edge stays where it was.

  Two wider-looking shapes were rejected for the same reason. `minmax(9rem, auto)` on the status sizes it to content, so its edge wanders between rows; `max-content` on the branch sizes it to the longest name _in that section_, so two groups disagree about where the branch starts. Either gives back at one column what fixed tracks establish at all of them. The honest cost is that a narrow-but-not-mobile window elides the branch sooner — middle elision keeps both ends and `title` keeps the whole name. Below 640px nothing changes; the row is a stacked card there and tracks do not apply.

  **And a status could say what is true, but not what just changed.** `⑂57 conflicts 22d` and `⑂177 conflicts 5m` are the same status meaning opposite things — a standing decision nobody has taken versus something that broke minutes ago — and Age does not separate them in general, because it is the _PR's_ age and not the _state's_. A three-week-old PR that broke this morning still reads `22d`.

  So a row whose watched value changes now tints itself for ~3s. The watched value is `pr?.state ?? null`: **seven possibilities, not six**, because `pr` is nullable and most rows carry none. `null → pending` (a PR opening, often the most interesting transition a branch has) marks, and so does `pending → null`.

  **Three seconds, and the measurement decides it.** `pr.state` comes from the 60s PR refresh, not the 4s fleet pulse — and 120s under rate-limit backoff. A transition is a _rare_ event, so a 300ms flash calibrated for something frequent would be missed nearly every time.

  The memory distinguishes a **missing key** from a stored **`null`**: _never observed_ and _observed with no PR_ look alike in JavaScript and mean opposite things, and collapsing them passes the first-pulse assertion while silencing every branch's first PR forever. The first pulse after a load or restart therefore marks nothing, and a row returning after absence starts silent.

  A changed row marks itself **wherever it now sits, including a new section** — `pr.state` helps decide the group, so the changes worth marking are frequently the ones that move the row. A second change while lit **restarts** the timer rather than letting the first expire and imply nothing further happened. Ten rows changing means ten marks: no threshold, no suppression.

  Under `motion-reduce` the mark **stays** and only the animation stops; it is `aria-hidden` with no live region, because the cell's text already changed and a reader reaches it by reading the row. The `LiveDot` on WORKING rows is untouched — _something is alive, end unknown_ and _this just changed_ are two meanings that keep two marks.

  **The memory is per client and one value deep.** Nothing is persisted, no contract field is added, and neither clock moves: a reload starts silent, two tabs mark independently, and a backgrounded tab accumulates nothing. The marker is not a log.

  <!--
  bumps:
    skills: {}
  -->

- [#205](https://github.com/plot-pm/plot/pull/205) [`120a9bc`](https://github.com/plot-pm/plot/commit/120a9bc42344ba4b27737fc0e246cce6ce4e6db8) Thanks [@jwloka](https://github.com/jwloka)! - board: the Agents tab can approve, and the marks get a column

  **Approve was unreachable from a row.** `board.approve` has existed since
  `board-becomes-operable` and reached the CARDS only — `Board.tsx` and
  `Swimlanes.tsx` pass it to `PlanCard`, the Agents tab was never given it.
  So a plan PR sitting green and ready showed a dimmed three-dot menu on
  its row while the same plan's card offered the button: one board, two
  answers about the same act.

  Three layers were in the way, and fixing one alone would have changed
  nothing:

  - `App.tsx` never passed `approve` to the tab
  - the menu's gate read `canStart && serverWillAct` — one named action, so
    a Draft plan's row was dead by construction, since such a row is never
    startable
  - the menu BODY required `dispatch`, which a Draft row does not have

  The gate now asks whether **any** act is available, and each item asks
  for its own precondition. Written as two independent items rather than an
  if/else: should the two ever overlap, the menu shows both instead of
  silently picking one.

  **The marks get a track of their own.** They hung in the row's left
  padding on the argument that six columns should not move for a mark most
  rows never carry — which held while there was one mark. There are five
  now, and a row can wear several: measured on screen, the activity track
  and the unpushed bar overlapped, and `left-0` is the ROW's edge, which
  sits outside the section's border, so every mark straddled the panel.

  The cell is unconditional while its contents are not, so a markless row's
  six other cells do not shift. A seventh track costs its width AND a sixth
  gap, which crossed the 640px card breakpoint — the phase column gave up
  1rem to pay for it. The test that caught this predicted the day in its
  own comment; its gap constant is now derived from the track count rather
  than hard-coded, because `84` was right for six tracks and silently wrong
  for seven, in the reassuring direction.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#204](https://github.com/plot-pm/plot/pull/204) [`aa8874b`](https://github.com/plot-pm/plot/commit/aa8874b9b64d150548044150ae2c643c7e243f42) Thanks [@jwloka](https://github.com/jwloka)! - board: a row flashes on any observed fact that changed, not only its PR

  `watchedState` watched one thing — `pr.state` — so a row that changed
  section, gained unpushed commits, became dirty or got stuck did it
  silently. The marker existed to say _this just changed_ and only ever
  answered about the git host.

  It now watches every **observed** fact on the row: PR state, number and
  draft flag, git state, group, wave, phase, the three local signals, and
  stuck. Derived time is deliberately excluded — a ticking clock is not
  news, and including `ageMinutes` would flash every row on every pulse.

  **The unreadable case is the hard one, and it is settled per slot.** A
  PR whose host could not answer reports `unknown`, and `unknown` is not a
  value: it is the absence of one. So the memory carries the last KNOWN
  state forward across an outage — `green → unknown → failing` still
  flashes, because the memory still holds `green` when `failing` arrives —
  and only the moment is skipped, never the fact.

  Per slot rather than per row: a GitHub 503 says nothing about whether a
  worktree is dirty, and freezing the whole record for a remote host's
  reason would silence an agent's edits exactly while it writes.

  For a row first seen while the host was down there is nothing to carry.
  It is recorded honestly as `unknown`, and `sameWatched` treats `unknown`
  on either side as **not comparable** rather than as different — a
  sentinel chosen to compare as changed would flash the host's _recovery_,
  which is news about GitHub rather than about the branch. The stated cost:
  such a row does not flash on the first state it is finally seen in;
  `prNumber` going from null to a number covers most of it.

  `isObservation` is renamed `isUnreadable`. It returned true for
  `unknown` — the one value that is _not_ an observation — so it read as
  its own opposite at every call site.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#201](https://github.com/plot-pm/plot/pull/201) [`4947c87`](https://github.com/plot-pm/plot/commit/4947c87cb446dbc52d1ff4395d513962a9aa637b) Thanks [@jwloka](https://github.com/jwloka)! - board: unpushed commits get a mark of their own

  `local_ahead` reached the contract and stopped there — the row could not
  say _this checkout holds finished work nobody else can see_. On
  2026-08-17 that silence cost PR [#177](https://github.com/plot-pm/plot/issues/177) half an hour of dead CI: a rebase
  that stayed local read from outside exactly like an agent that had
  stopped.

  It gets a static bar at the same left edge as the activity mark,
  separated from it by **form and the absence of the glow** rather than by
  motion. Stillness is the message: the activity mark says _someone is
  writing here_ and travels and glows to say it; this says the opposite,
  so it does neither. It is the only one of the five marks with nothing
  animated, which is why `motion-reduce` needs no clause.

  `localAhead` is a count on the row (additive, defaults to 0, where 0
  means _not observed_ rather than _clean_) and is deliberately NOT part of
  the activity predicate: OR-ing it in would render a branch nobody has
  touched for hours as motion.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#194](https://github.com/plot-pm/plot/pull/194) [`6f24402`](https://github.com/plot-pm/plot/commit/6f2440294ac4c4deb8492572091d6f7fd0dab3af) Thanks [@jwloka](https://github.com/jwloka)! - The activity marker on the Agents tab now aligns to the row's first line and travels: a short track with a glowing dot moving out and back, fast where a write was observed and slow where a branch is merely claimed.

  **The marker was centred on the row, and the row stopped being one line tall.** It carried `sm:top-1/2 sm:-translate-y-1/2`, resting on an assumption its own comment stated: _"the row is `py-2` around one line of `text-sm`, so 20px spans nearly its full height."_ Under that assumption, centring on the row and centring on the line are the same pixel. The stuck cell then landed as its own line beneath the six columns (`sm:col-start-2 sm:col-end-[-1]`), so a row carrying a status line is roughly twice as tall — and `top-1/2` put the marker **between the two lines** instead of beside the branch name it belongs to. This was the third consequence of that one change: the stuck cell also started at the wrong x, and its cue survived at a dead end, both fixed the same day.

  The marker belongs to the **branch**, and the branch is on line one whatever else the row grows beneath it. So the mark is now given the first line's own box to sit in — `sm:top-2` where the first line begins, `sm:h-5` for one line box of `text-sm` — and the track centres itself inside it. Measured rather than assumed: the first line box begins **18.6 px** below the row's top edge on a real page, not the 8 px a reader would derive from the padding, so a hand-computed offset would be right today and wrong the moment the type scale moves. **The pairing that matters:** `top-1/2` looks correct on every single-line row and is wrong on exactly the rows carrying the most information, so a single-line assertion passes on the defect. The browser suite states it with a pair — one row on one line, one on two — and first proves the tall row really is taller.

  **The bar became a track with a travelling dot, and the dot must never arrive.** Rotation and travel were refused twice in this repo, both times for one reason: they _"imply progress toward completion, which nothing here measures."_ An agent in WORKING may finish in five minutes or five hours. A dot that goes out and comes back promises no destination — it reports a **rate**, not a distance, and that is the only reason travel is acceptable where those were not. The keyframes end where they began and the track has no far marker to reach; anything that fills, completes or arrives reintroduces exactly what was refused. Asserted on the browser's own resolved `@keyframes`, and on the absence of `width`, `scaleX` and `stroke-dash` in them.

  **Two speeds, and the speed is a fact rather than a decoration.** Fast where `local_dirty` or `local_locked` — someone is writing, measured. Slow where the row is merely in WORKING with neither signal — claimed, and the board does not know whether anyone is there. Both states were live on the board the day this was asked for: `feature/not-started-counts-plans` reported `dirty=true` against `bug/green-never-outranks-unknown` with `dirty=false` and the note _claimed, no known worker_. The two are separated by a factor of three so the difference reads rather than merely computes, and each pace carries its own `title` — _a write is in progress_ against _claimed, and no write observed_ — so the distinction is never carried by motion alone.

  **`isActive` is untouched, and the widening is visible at the render.** The predicate `activity-shows-itself` settled still means _someone is writing here_ and is now the **fast** half; the slow half is WORKING membership, added where the mark is rendered rather than by loosening the predicate. That keeps the second statement legible as a second statement. The slow dot says **unknown, never nobody**: both local fields are `.default(false)`, and a scan that could not observe a worktree reports absence rather than cleanliness — which is why the slow case is bounded by WORKING rather than applied to every row.

  **`motion-reduce` keeps the track, the dot and its glow, and stops only the travel.** All three halves, the fifth time this repo has written the rule: hiding the element under reduced motion passes a motion-only assertion and takes the marker along with the movement. The dot rests at the track's start rather than mid-flight, because a dot frozen halfway reads as a paused progress bar. Under reduced motion the two speeds collapse into one appearance and that is correct — _speed_ is what is being removed, so it cannot be the only carrier; the row's note still says which state it is in, in words.

  **`aria-hidden`, and a screen reader never hears a speed.** The note carries the fact in words, and the accessible text of the row contains neither _fast_ nor _slow_.

  **No third speed.** No gradient keyed to commit freshness: a scale nobody can read (_was that four minutes or forty?_) changing continuously is motion in place of information. `activityPace` reads the two local signals and nothing else, asserted by varying the age and the group and getting one answer.

  **No mark is implemented by modifying another.** `[data-live-dot]` keeps its own `animate-pulse` — asserted as _not `travel`_, since _not none_ would pass on a dot that had been handed this wave's animation — and `[data-change-mark]` and `[data-stuck-cue]` are untouched. The board's first hand-written keyframes arrive with this change, because no Tailwind utility travels: `pulse` changes opacity and `ping` scales, and both stay where they are.

  <!--
  bumps:
    skills: {}
  -->

- [#153](https://github.com/plot-pm/plot/pull/153) [`6550adc`](https://github.com/plot-pm/plot/commit/6550adc0de0b5e9fb923857dbd647241546a0619) Thanks [@jwloka](https://github.com/jwloka)! - Dormant groups on the Agents tab now start collapsed, NOT STARTED sorts by how long it has waited, and row actions move into an overflow menu.

  **The quietest groups were pushing the status line off the screen.** Seen on the live board: `QUIET (7)` and `DONE (13)` rendered twenty rows between them, six of which had said _no commit for 22 days_ for three weeks — and the footer reporting when the last scan ran, and when the next one is due, had scrolled out of view. The group order already encoded the intent (`waiting-on-you`, `working`, `waiting-on-machine`, `not-started`, `quiet`, `done`, deliberately actionable before diagnostic); what an ordering cannot do is stop a group at the bottom from consuming full vertical space anyway.

  **`quiet` and `done` now start collapsed; every other group starts open.** That default is not a preference — it is the existing order made effective. Those two are the diagnostic end: one means _go check whether this died_, the other _this is finished_, and neither needs reading on arrival.

  **A collapsed header keeps its count.** `QUIET (7)` states plainly that seven rows are hidden; a folded header without a number reads as _nothing here_, which is worse than the crowding it fixes. **An empty group never collapses at all** — its header renders the group's hint (_still thinking, or dead?_) rather than `(0)`, and that hint is the explanation for the emptiness and exactly what a reader wants when there is nothing to list. A control on a group with nothing to hide is an offer that leads nowhere.

  **A row falling into a collapsed group changes the count and nothing else.** No flash, no auto-expand: the pulse re-scans every five seconds, `quiet` is by construction the group whose changes are least urgent, and whoever folded it was asking not to be interrupted by it. Collapsing is manual in both directions — a view meant to sit beside your work must not move its own furniture.

  **The state persists in `localStorage`, and that is a deliberate departure.** The board's convention for view state is the URL — `?tab=agents`, `?lanes=1`, `?plan=…` — and there was no `localStorage` anywhere in the app, so this introduces a second mechanism for what looks like the same kind of state. The distinction that justifies it: **a URL is shareable, and collapse state should not be.** Everything in the query string is worth sending to someone; a link carrying `?collapsed=quiet,done` would rebuild the recipient's view as a side effect of "have a look at this". Persistence itself is not optional — this board is left running and reloaded several times an hour, and without it the reader re-configures the view every time.

  **NOT STARTED now sorts by waiting age, freshest first.** The row sort ordered every group by **commit** age and coerced a missing age to `-1`. NOT STARTED rows have no commit — their clock is `waitingDays`, from the plan's `Approved:` record, which the sort never consulted — so every row in the group tied at `-1` and the order was whatever the scan happened to produce: `feature/plot-sprint-support`, waiting since February, sat among branches approved minutes earlier.

  The direction **inverts for this group only**. Elsewhere old means neglected and belongs on top; here it means _nobody wants it_ — six months of availability is evidence of that, not urgency — while a plan approved minutes ago is the one still in the reader's head and the one a dispatch is likely to pick up. Undated rows lead: they have just arrived and have not yet been ignored by anyone. The inversion is confined rather than made general, because a rule that flips direction depending on where it is applied is two rules wearing one name — and applying it globally would silently reverse `quiet`, the group that most needs oldest-first.

  **Row actions move into a three-dot overflow menu** at the right edge. `Start work` sat at the far right _after the age_, so the line read _what · state · age · act_, with the action behind the quietest number on it — and it is about to stop being alone. The menu holds only things that **change** something; navigation stays in the row, where the thing is named, because a `cmd`-click on a real link is worth more than a tidier line.

  **A row with no available action renders the menu disabled**, a deliberate exception to this estate's rule against greyed-out controls. The distinction is what a control _claims_: a dead `Start work` lies about an action that does not exist here, while a dimmed three-dot menu says only _this is where actions would be_, which is true on every row. The layout argument decides it — with most rows carrying no action, rendering nothing would leave the right edge ragged **and moving**, since the pulse re-scans every five seconds. It uses `aria-disabled` rather than the native attribute, so the control stays focusable and the `title` explaining why — in the row's own words, _blocked by an earlier wave_, _no commit for 22 days_ — stays reachable without a mouse.

- [#147](https://github.com/plot-pm/plot/pull/147) [`6d7fd59`](https://github.com/plot-pm/plot/commit/6d7fd595fdbb091e6d98f26261af3e650ebb5953) Thanks [@jwloka](https://github.com/jwloka)! - An agent row now says which phase its work is in, and a shelved branch says it was shelved.

  The Agents tab grouped rows by what they _wait for_ — and every one of those groups is decided by time. That answers _is anything moving_ and cannot answer _moving on what_. A human still drafting a plan and an agent building against it read identically, and NOT STARTED could not tell _ready for someone to pick up_ from _no branch tip we can date_.

  **The phase replaces the repo cell.** Not a seventh cell: the row already wraps on a branch called `feature/opus5-hardening-challenge-budget`. The repo is the right thing to give up — constant in a one-repo board, rendered nowhere else in the app, and a column showing the same word on every row is chrome that never varies. Wider than the repo's `w-16`, which fits 8–9 characters: "Development" is 11 and would have rendered "Developm…".

  **The word is spelled out.** Initials cannot carry it — Discovery, Design and Development all begin with D, and `DE` covers two of them — and neither can the existing phase icons: `PHASE_LEADERSHIP` maps 👤 to three of the five phases, because it encodes _who leads_ rather than _which phase_. The cell also carries an `sr-only` label, because this list is a `<li>` of `<span>`s with no table semantics: column position conveys nothing to a screen reader, and `Development` does not announce itself as a phase the way `plot` happened to read as a repo name.

  **A `deferred` badge, beside the state rather than instead of it.** The phase has already fallen back a step for a handed-back branch, and a bare _Design_ row is indistinguishable from one nobody ever started. The badge carries the half the phase cannot: this did not fall back because nobody began it, but because someone gave it up.

  **Start work reaches the rows that can actually be started.** The button already existed on plan cards; nothing new is built. It appears only on `not-started` rows an earlier wave does not block — a button on a blocked row would offer to skip the ordering waves exist to express, and `plot-dispatch` refuses that branch anyway, so the board would be inviting an action the tool declines. No greyed-out control either. A row whose plan has no board card gets no button rather than a broken one.

- [#175](https://github.com/plot-pm/plot/pull/175) [`5ab8463`](https://github.com/plot-pm/plot/commit/5ab8463b073eb14494ffb059ecfbd4eb77205a05) Thanks [@jwloka](https://github.com/jwloka)! - The agent row becomes a real grid, and the PR cell renders from fields rather
  than from a sentence.

  Four rows in WAITING ON YOU, and no two of them agreed on where anything sat.
  Only three cells had a width — phase, age and the action menu — while plan and
  branch were content-sized and `ml-auto` on the note shoved everything from there
  to the right edge. So the slack collected _between_ branch and PR, and the
  branch started wherever the plan cell before it happened to end.

  **Six fixed tracks: phase, plan, branch, PR, age, menu**, with the branch on
  `1fr` because it is the longest and most variable value and the one worth
  reading in full. **An empty cell now leaves a gap rather than shifting its
  neighbours** — which is the whole point: a row with no phase aligns on branch
  with one that has a phase, and a row whose plan name sits in the group heading
  aligns with one whose does not. That second case is the one `showPlanHeading`
  introduced an hour earlier, where two rows in the same section differed by a
  whole cell.

  **Overflow elides the MIDDLE, keeping both ends.** Branch names here share long
  prefixes and differ at the tail — `feature/opus5-hardening-…` covers six
  branches — so end-truncation renders all six identically, which reads as six
  duplicate rows rather than as truncation. The head clips and the last twelve
  characters are pinned, so the browser decides where the fold falls at whatever
  width the column has; the full name stays in `title` and in the accessible name.

  **Table semantics, without a `<table>`.** `role="grid"` on the list, `role="row"`
  and `role="gridcell"` on the cells, and an `sr-only` header row carrying
  `role="columnheader"`. The rows carry interactive controls and sit inside a
  collapsible group structure with per-plan sub-headings, which table markup would
  fight rather than serve. The phase's `sr-only` prefix goes with it: it existed
  because _"column position conveys nothing and each row is heard as a run of
  words"_, and that stops being true. It survives below `sm` and only there, where
  a card has no columns for a header to name.

  **The PR cell reads `{ number, url, draft, state }`** — the fields wave 1
  delivered — instead of searching `row.note` for `PR #<n>`. That search was a
  parser for a format nobody declared: it silently rendered an unlinked note the
  moment the server's wording drifted, and could not produce a badge without
  taking the sentence back apart. `draft` and `state` render as two badges, never
  one folded into the other. The git host's own PR glyph replaces the word `PR`,
  never the state — the number stays, the state stays as a word, and the glyph
  carries an `aria-label`, since a bare `157` announces nothing. `unknown` renders
  nothing at all: a word saying only _this board could not find out_, stamped on
  every row of a host that carries no rollup, is noise.

  **The note keeps everything a PR state cannot say** — _uncommitted work_,
  _blocked by an earlier wave_, _claimed elsewhere_. It is relieved of one duty,
  not replaced. The server still composes `PR [#158](https://github.com/plot-pm/plot/issues/158), conflicts · awaiting review`,
  so the row drops the leading PR clause when the fields already carry that same
  number; a note it does not recognise is printed in full, which costs a duplicated
  word rather than a lost link.

  **Below 640px the row becomes a card**, because this is what the grid takes
  away. The tab had zero responsive breakpoints and its only concession to a
  narrow window was `flex-wrap` — which works precisely because _nothing depends
  on the position_. A grid inverts that. Measured: the fixed tracks need 544px
  before the branch gets a single pixel, and a 375px phone is 169px short. So each
  row becomes a small block, branch on its own line with plan, phase, PR and age
  wrapped beneath. **Nothing is dropped and nothing is elided** — dropping the
  plan name was the cheaper answer and would re-open, at one width, the defect
  `showPlanHeading` closed at every width.

  The branch name carries an explicit `aria-label`, which the plan did not
  anticipate. The fold renders as two flex items, and the accessible-name
  algorithm joins adjacent boxes with a space: the row announced
  `feat ure/reviewed`, a branch name no host would recognise and no reader could
  search for. The fold is a fact about the column's width, so it belongs to the
  visual channel alone.

  <!--
  bumps:
    skills: {}
  -->

- [#172](https://github.com/plot-pm/plot/pull/172) [`3a1e9ac`](https://github.com/plot-pm/plot/commit/3a1e9acc568be59c37b97df6dce018030b704cd5) Thanks [@jwloka](https://github.com/jwloka)! - **The last good pulse now survives a restart.** Until now a restarted board
  served `0 branches across 0 plans` — an empty view, not a stale one.

  Measured on 2026-08-17 with five agents in flight, three of them editing files
  under `packages/board/`. The operator's board runs under `node --watch`, so
  every save restarted the server, and the Agents tab reported _"Last scan
  failed"_ over zero rows. The fleet view exists to make parallel work visible,
  and the more parallel work ran, the less it could show.

  **The cache was never the problem.** `fleet.ts` already keeps one entry per
  repo, every request reads it, and the scan refreshes it asynchronously — which
  is why the tab polls at 4 s without running a scan per request. That design is
  right and is unchanged. It is _process memory_, and a `--watch` restart takes it
  with the process: a freshly started board has no cached pulse, so the _degrade,
  do not hide_ behaviour from [#141](https://github.com/plot-pm/plot/issues/141) has nothing to degrade **to**. The banner
  worked perfectly and named the exact failing command; there was simply no
  last-good payload behind it.

  So the in-memory cache gains a copy on disk at `.plot/state/last-pulse.json`,
  written on each successful scan, read once at startup, and served through the
  rendering that already exists — the banner, the `(frozen)` footer, the stopped
  clocks from [#141](https://github.com/plot-pm/plot/issues/141), the dimming from [#160](https://github.com/plot-pm/plot/issues/160). No second vocabulary for _these
  numbers are old_.

  **The file is read AND a scan is issued at once**, because neither closes the
  window alone. A scan costs 500–1050 ms (21.2 s measured on a cold boot), so
  rescanning at startup narrows the empty window without closing it — and a
  restart storm reopens it on every save. The file alone is the mirror failure: it
  would leave the board stale until the next poll. The file covers the gap, the
  scan ends it, and a completed scan overwrites every bridged field.

  **A bridge, not a store, and the distinction is load-bearing.** Plot derives
  state from git (Principle 1), and a JSON file that outlives its usefulness is a
  second source of truth that can disagree with the repository. Past fifteen
  minutes the honest answer is _no data_ — which is what the board says today and
  is correct once the numbers describe a repository state that has moved on. A
  payload stamped in the future is refused for the same reason: a clock that ran
  backwards would otherwise read as the freshest possible answer.

  **One-directional, like every other signal here.** A scan that succeeds replaces
  the file immediately; a scan that FAILS does not touch it. A failure must not
  destroy the last good answer, which is the only thing standing between a restart
  and an empty board.

  The file is machine-local by construction — it describes this machine's refs and
  worktrees — so `.plot/state/` is gitignored while the rest of `.plot` (briefs,
  templates, the review hold) stays committed. It is re-validated through
  `FleetPulseSchema` on read rather than trusted, because it may have been written
  by a different build; anything unreadable, unrecognised or expired reads as no
  bridge at all, which is exactly today's cold start.

  Asserted across an **actual process restart**, never a cleared in-memory map:
  the map is already correct, and its loss on restart is the entire defect.

  <!--
  bumps:
    skills: {}
  -->

- [#160](https://github.com/plot-pm/plot/pull/160) [`028af50`](https://github.com/plot-pm/plot/commit/028af5074dd4034e12fa879e12d07ea225232f35) Thanks [@jwloka](https://github.com/jwloka)! - **A frozen board now stops inviting, not just lying.** `board-shows-staleness` made the page admit its numbers were old — a banner, `(frozen)` in the footer, stopped clocks. It did not finish the job: rows kept full contrast, links kept their affordance, and the row action menu kept offering `Start work` on data minutes old. A reader who scrolled past a single banner was looking at a control surface behaving exactly as it does when everything is fine.

  The distinction is between **information** and **posture**. The banner says _these numbers are old_. What was missing is _do not operate this right now_.

  **Two escalating states.** The banner still comes first and alone. After a sustained silence the page dims, blocks interaction with the board, and names the way out.

  **Counted in missed polls, not seconds.** The two tabs poll 7.5× apart — `POLL_MS` 30 s against `FLEET_POLL_MS` 4 s — so one seconds-threshold means _seven and a half missed polls_ on one tab and _a single one_ on the other: it would dim on the first hiccup in one place and only after a real outage in the other. Counting consecutive failures keeps the statement identical on both, and survives someone changing an interval later.

  **The threshold is eight, and it was measured rather than guessed.** `pnpm board` runs under `node --watch`, so an ordinary edit restarts the server and the tab loses contact several times an hour. Five real restarts were timed on the implementing machine by touching the watched artifact and polling every 50 ms: the server was unanswerable for 3.1 s, 4.5 s, 5.1 s, 5.8 s and 9.1 s (median 5.1 s), and a cold boot took 21.2 s. At the fleet's 4 s poll those cost at most 3 and 6 consecutive failures. Eight clears the worst of them, so the case that happens several times an hour never triggers the case that means something.

  **Both tabs, which meant unifying two error models** — the largest part of this, and a behaviour change rather than an addition. Silence was measured for the Agents tab only, and the two tabs answered the same outage in opposite ways: Agents kept its rows, while the Board tab set an `error` string and **replaced its cards** with a red message, discarding a payload it still held. The Board tab now gets the newer _degrade, do not hide_ treatment. One outage no longer produces two different stories depending on which tab is in front.

  Five further decisions, each reached by discarding the obvious answer:

  - **A server that answers badly does not dim.** HTTP 500, malformed JSON, `{ error: … }` — it is alive and speaking, so _no contact_ would be plainly wrong and a restart hint would be the wrong advice. The existing error path keeps that case, and a bad answer resets the silence count rather than accumulating toward an overlay telling the reader to restart something already running.
  - **Blocked means interaction with the BOARD.** Reading needs no clicks, so reading never stops: scrolling, selecting and copying a branch name keep working, and the rows stay legible underneath. The overlay's own message and command stay usable, because blocking the way out would be a dead end with a lock on it. An already-open plan modal stays usable — it is a layer above the board and has its own error path; opening a _new_ one is board interaction and stops.
  - **Blocked actions stay visible and `aria-disabled` with the reason**, never removed. Vanishing buttons make the layout jump twice, on loss and again on recovery. `StartWorkButton` moved off the native `disabled` attribute for this: a natively disabled button leaves the tab order, taking the control _and_ its explanation out of reach of exactly the reader who cannot see that the page has dimmed. The row action menu also now refuses to **open** when the server will not act — it previously keyed only on whether the row was startable, so on a frozen page the three-dot menu still opened and still offered `Start work`. A scrim cannot cover that gap, because a keyboard reader never touches a scrim.
  - **The command and port come from the server**, travelling with the last successful poll via a new `server` field on the board document, read from the project's own `## Plot Config` under a new `Board command` key. `pnpm board` is _this_ repo's convention and Plot hardcodes no project conventions (Principle 5) — an adopting project would otherwise be handed advice that does not work. A project declaring none gets no command rather than a guessed one. The overlay names the port _this page was served from_ and never probes others: a page that guessed could attach itself to a different project's board.
  - **Returning to a backgrounded tab re-checks rather than counts.** Browsers throttle hidden timers, so a minimised window would otherwise come back holding a count assembled from however often it was allowed to wake. Visibility returning issues a poll: it either succeeds and the overlay goes, or it fails and the overlay is honest.

  Pinned by 25 browser tests against the shipped artifact, each written against an assertion a weaker implementation passes without — one failed poll dimming nothing, both tabs dimming after the same _number_ of failures, the Board tab reaching the state at all, the 500 and malformed-JSON cases staying clear, the overlay's own command being clickable and selectable while the board's controls are not, and the command and port round-tripping from a payload that names neither of this repo's defaults.

  **A plan heading is now earned per group, not per section.** Unrelated to the dimming and folded in because it lives in the same file: `showPlanHeadings(rowCount, planCount)` asked _should this section have headings at all_, so once any group in a section earned one, **every** group got one — including a plan holding a single row, whose heading labelled the one line beneath it and charged a line of height to repeat what that line already said. A section of one-row plans became a stack of alternating headings and rows.

  `showPlanHeading(group)` replaces it and asks the narrower question: a heading pays for itself by saving repetition, so it appears above two or more rows of one plan and nowhere else. Both clauses of the old rule are subsumed — the second IS this rule counted per group instead of summed across the section, and the first (two plans, one row each) turns out to be a case where headings are not wanted at all.

  The half that is easy to lose: a group without a heading has nowhere else to name its plan, so **its rows print the name themselves**. Heading and row now read one shared answer per group rather than computing it twice, which is how they would drift — a heading rendering while its rows also print the name says it twice; the reverse loses the name entirely. Pinned by a mixed-section test (one plan with several rows beside a plan with one), the case a section-wide answer cannot express, asserting both that the lonely row carries its plan name and that the headed rows do not repeat it.

  **Not covered, deliberately:** the IPv4/IPv6 case, where the server listens on `[::1]` and the browser resolves `127.0.0.1`. No overlay helps there — the document never loads — and it is recorded as a separate finding.

  <!--
  bumps:
    skills: {}
  -->

- [#148](https://github.com/plot-pm/plot/pull/148) [`6bd1804`](https://github.com/plot-pm/plot/commit/6bd1804b8571b3aebc62d2cbdb7fcd39dce851bb) Thanks [@jwloka](https://github.com/jwloka)! - A `working` row now shows that it is working — the board's first animation.

  **The Agents tab exists to show work in flight and rendered like a table of records.** A branch an agent was editing right now looked exactly like one nobody had touched for 22 days: same weight, same stillness, different text. The reader had to _read_ to find out that anything was happening. Measured before changing anything: the board contained **no animation at all** — not a transition, not a pulse, no `prefers-reduced-motion` block — so there was no existing convention to follow, and this becomes the first one.

  **One animation for the whole group, never graded by confidence.** `WORKING` has three entrances of differing strength — `uncommitted work in a local worktree` (files edited on this machine, the strongest evidence there is), `last commit 3 min ago`, and `claimed, no commits yet` (an agent reading the plan, or one that never started). Grading the animation by which one applied was considered and rejected: **group membership IS the statement, and it is true for all three.** Each is a reason the fleet considers the branch live, and the note beside the row already says _which_ reason — so a second vocabulary made of speeds would encode in motion what the text states plainly, while being unreadable in isolation and invisible in a screenshot, which this board takes seriously enough to have written into its rule for colour. A confidence-graded implementation passes a test that checks only one of the three notes, so all three are asserted to render _identically_ — same animation, same duration, same box.

  **A pulsing dot, not a spinner**, on a plain count: `WORKING` regularly holds several rows (four agents ran in parallel on 2026-08-16), and four rotating spinners in a column is flicker, not information. Rotation also implies _progress toward completion_, which nothing here measures; a pulse implies _aliveness_, which is exactly the claim being made. It sits **before** the row rather than inside the note, because the note is where the row states its facts and motion there competes with reading them — a leading dot needs no column of its own and scales from one row to eight.

  **What the animation claims is narrow and true by construction:** that the row is in `WORKING`, re-derived every scan. It stops the moment the row leaves the group, which is exactly when the work stopped or moved on — asserted across a state change rather than on a static fixture, because that self-stopping is the whole honesty of it and a fixture-only test passes on an implementation that never re-evaluates. This is deliberately unlike the countdown that kept ticking after its server died (fixed in `board-tells-the-truth`): that asserted a _specific future event_ that was not coming.

  **Reduced motion is built in, not retrofitted, and both halves matter.** `prefers-reduced-motion: reduce` disables the animation and **leaves the dot visible** — removing the element would satisfy "no motion" and lose the marker along with it. The reason is not politeness: motion triggers nausea for some readers, and this view is meant to be left open on a second screen. Tailwind's own `animate-pulse` with `motion-reduce:animate-none` carries it — no new CSS file, no keyframe of our own, and the reduced-motion variant arrives with the utility rather than needing its own media query. Smallest possible way to introduce a first animation.

  **No visibility handling.** A pure CSS animation costs effectively nothing and browsers already throttle background tabs; pausing it through the Page Visibility API would add a mechanism for a problem the platform solves — and the poll cycle, which is the expensive part, keeps running anyway.

  **The dot is `aria-hidden`.** A screen reader already gets the group heading and the row's own text, so the animation is decoration on top of information and never the carrier of it — the same rule the contract sets for colour (_carried as a symbol AND a word, never as colour alone_). The row is asserted to stay fully legible with motion off: group, note and age all unchanged.

  Two negatives are pinned because a naive implementation passes without them: rows in **every other group hold still** — including a `quiet` row that also carries a fresh claim, since the group is what decides and not the note or the age — and an **empty `WORKING` group animates nothing**, trivial by construction today but asserted so nobody later moves the animation to the group header, where it would run against zero rows.

  <!--
  bumps:
    skills: {}
  -->

### Patch Changes

- [#205](https://github.com/plot-pm/plot/pull/205) [`65a4f6b`](https://github.com/plot-pm/plot/commit/65a4f6bc22db22a52efc2824152a4552a1bdba88) Thanks [@jwloka](https://github.com/jwloka)! - board: a live worker keeps its row in WORKING

  Measured 2026-08-17: two agents ran for a quarter of an hour with WORKING
  empty, while WAITING ON YOU showed their branches. Both sections were
  lying, in opposite directions.

  Two rules were responsible, and neither was wrong on its own:

  - The running-worker verdict lived inside the `state === 'claimed'` arm.
    A worker's first real commit takes its branch out of `claimed` — so the
    row **lost its place in WORKING at the moment it proved it was
    working**. It now sits beside the other three worker verdicts, covering
    every unmerged state. `merged` still excludes itself: a branch that
    landed is done whatever its worktree holds.

  - The PR arm answered before any worker question. Right for a PR that is
    a person's errand — conflicts, failing checks, no checks, a state the
    host cannot read — and wrong for the rest: an agent that opened its PR
    and kept working was pulled out of WORKING by a green PR that asks
    nothing of anybody. A running worker now overtakes that arm **only**
    where `prAsksNobody` holds.

  `prAsksNobody` is an allowlist — `green` or `pending`, plus a draft,
  which is still the agent's own. A blocklist of errand-states would
  silently start claiming "nobody is blocked" the first time a state was
  added, which is the direction that fails quietly.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#173](https://github.com/plot-pm/plot/pull/173) [`ecb8351`](https://github.com/plot-pm/plot/commit/ecb835199e4d93fb63980814195faf6c7655c05c) Thanks [@jwloka](https://github.com/jwloka)! - `Start work` and `Approve` now really do refuse a second click inside one tick — and there is finally a test that says so.

  **The test came first, and it came out RED.** Both buttons carried a comment claiming a double click could not fire two runs, and both implemented it by reading a value derived from `useState`: `const blocked = starting || !dispatch.available`, checked in `onClick`. `setState` does not take effect until the next render, so two clicks in one tick both read `idle` and both called `fetch`. Nothing in this repo had ever checked that, on either button — so the first thing written here was the assertion, not the latch, and it failed with **two POSTs where one was asserted, on both buttons**. Writing the fix first would have made a green run unreadable: it could not distinguish a real defect caught from React's batching having covered it all along.

  **Two clicks in ONE TICK, not two awaited clicks.** Playwright's `locator.click()` waits for actionability between calls, which hands React a render in between and makes `blocked` true by the second — the defect is invisible that way, which is very likely why it survived this long. The test dispatches both events from a single synchronous block inside the page, which is what a fast physical double click delivers to the handler.

  **A `useRef` latch, because a ref changes synchronously.** The second click of a same-tick pair sees the flag already set. `blocked` **stays**: it carries the _other_ refusals — no dispatch binding, a non-localhost host — and those answer _may this act at all_, a different question from _is one of mine already running_. Both are asserted: a board bound to `0.0.0.0` still refuses every click on both buttons, and posts nothing.

  **The latch releases where the STATE does, never in a `finally` beside the fetch.** The button stays pending until the pulse confirms or the poll answers; a ref released when the request returned would re-arm it while it still reads `starting…` — clickable again behind a label saying it is busy. Pinned as its own assertion, since a `finally` passes the same-tick test and reintroduces the defect one beat later.

  **On `Approve` the guarded click is the SECOND one.** The first click arms and posts nothing by design, so the pair that fires two merges lands on the _armed_ label. A latch on the idle click would guard the wrong transition and pass a test that only clicked twice from idle.

  **Local only, no server-side in-flight registry.** A second browser tab is a different question with a different answer — git holds the claim for dispatch, and the host refuses a second merge — and an in-flight registry would be state the board does not otherwise keep. This fixes the case that produced the report: one person, one tab, two clicks.

  The pairing that matters is asserted too: **a slow single click still works.** A latch that never releases passes every same-tick assertion above and breaks the button completely.

  <!--
  bumps:
    skills: {}
  -->

- [#198](https://github.com/plot-pm/plot/pull/198) [`944f2bb`](https://github.com/plot-pm/plot/commit/944f2bb5590ea2722524c6f7aede441a6ab82716) Thanks [@jwloka](https://github.com/jwloka)! - The artifact resolver now distinguishes _nothing observed_ from _other files_, merges only in a worktree that is idle, and does not repeat a `not-observed` refusal every pulse.

  **An empty conflict set is not a small one.** Measured live on 2026-08-17: a row read `artifact conflict — conflicting: skills/plot/scripts/board/board-server.mjs`, and beneath it `repair refused — not-artifact-only`. The classification and the refusal contradicted each other, and the classification was right — one file, and it was the artifact. The resolver's log said why: it reused a worktree in which no merge was running, so `git diff --diff-filter=U` returned nothing. It found zero paths, compared zero against one, and concluded _not artifact-only_.

  Formally correct; factually inverted. **Empty there does not mean "other files", it means "I did not look."** The rule that produced it was correct and deliberate — that wave was told never to act on a host verdict without an observed conflict set — and the same test, applied to a set it never gathered, refused the one repair it was built to perform.

  So the two refusals are named apart, because `not-artifact-only` asserts something about the files that conflicted and a set of zero has none to assert it about:

  | Conflict set         | Meaning              | Resolver                    |
  | -------------------- | -------------------- | --------------------------- |
  | exactly the artifact | the licensed case    | repair                      |
  | other files present  | needs judgement      | refuse, `not-artifact-only` |
  | empty, no merge ran  | nothing was observed | refuse, `not-observed`      |

  A conflict is not the only thing that ends a merge non-zero: a merge that never _started_ — blocked by a dirty worktree, by a merge already in progress, by a ref that would not resolve — exits non-zero too and leaves nothing behind. The assertion is on the reason string rather than on the refusal, since a refusal naming the wrong cause sends the reader to look for files that were never examined.

  **The resolver no longer merges in a worktree someone else is working in.** Measured at the same moment as the refusal above: zero unmerged paths, three modified files, an agent working in it — and the resolver ran `git merge` inside it anyway. It refused before writing anything, but that was luck rather than design. Reuse is right when a worktree is idle, and the name alone does not say so; a worktree carrying modifications now refuses as `worktree-busy`, which the plan names the honest minimum. Untracked files are deliberately not counted: a stray log is not work in progress, and `merge` does not touch it — a fence counting every difference would refuse repairs for no reason.

  **Retry when the input changes, not when the clock ticks.** The pulse fires every 5 s and the branch stays `artifact-conflict` throughout, so a refusal leaving the input untouched was restarted by the very next pulse — five identical log entries, one per pulse, each reaching into the same worktree, none carrying information the one before it lacked. A `not-observed` refusal is now remembered against the input that produced it and not retried until that input changes.

  Scoped to `not-observed` alone, and the scope is the argument rather than a convenience: `tests-failed` and `build-failed` depend on a suite, `push-failed` on a remote that moves, `worktree-busy` and `already-in-flight` on state that clears the moment their owner finishes. Suppressing any of those would be a repair never retried after the world fixed itself. `not-observed` is the one whose cause lies entirely inside its input — nothing was read, and re-reading the same input reads nothing again. A run whose log could not be read is never suppressed either: the exit code cannot tell one failure from another, and suppressing on that guess would silence repairs that should retry.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#205](https://github.com/plot-pm/plot/pull/205) [`65a4f6b`](https://github.com/plot-pm/plot/commit/65a4f6bc22db22a52efc2824152a4552a1bdba88) Thanks [@jwloka](https://github.com/jwloka)! - board: NOT STARTED reads as a tree, not as a list of rows

  Three reported defects, one cause: a plan and its branches are one block
  on this board, and the markup treated every row as its own unit.

  **The separator divided the wrong pair.** Every row drew its own rule —
  the plan row included — so the line fell between a plan and its first
  branch, and no line fell between one plan and the next. Each visual
  block therefore held one plan's branches and the _following_ plan's
  heading. `last:border-0` could not save it: a plan row is never the last
  child of its own group. The rule now belongs to the group.

  **The phase was on the wrong row.** It is a property of the PLAN that a
  branch inherits, so the branches repeated one word down a column while
  the plan row left the cell empty. That emptiness rested on an argument
  that has expired — _"Approved for everything in this section"_ — which
  stopped being true when the section learned to hold Draft plans:
  `Discovery` and `Design` now sit side by side, and they are the
  difference between _needs your approval_ and _ready to start_.

  **So did the waiting clock.** Every branch of one plan shares one
  `waitingDays` — it dates the plan's own `Approved:` record — and
  repeating it says one number three times.

  Only the INHERITED clock is suppressed. A deferred branch keeps its own
  `ageMinutes`: an earlier version of this section erased a shelved
  branch's age and PR, and `fleet.ts` still carries the warning. A property
  of the plan is repetition; a property of the branch is information.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#200](https://github.com/plot-pm/plot/pull/200) [`75d15a1`](https://github.com/plot-pm/plot/commit/75d15a103bc038b8c4da2e869b1100962d05e6c3) Thanks [@jwloka](https://github.com/jwloka)! - plot-host: a transport failure exits non-zero instead of answering NONE

  `gh` exits 1 both when a branch has no PR and when the host cannot be
  reached, and the adapter caught both with one `|| echo '{"state":"NONE"}'`
  — so a caller could not tell _this branch has no PR_ from _I could not
  ask_. On 2026-08-17 GitHub returned 503 for an afternoon and every branch
  read as having no PR: wrong in the reassuring direction.

  The exit code cannot separate them (measured: both are 1), so the CLI's
  own stderr decides. A recognised miss phrasing — or no message at all,
  which is what a miss looks like through a CLI that does not explain
  itself — answers `NONE` and keeps exit 0. Everything else prints the
  host's words on stderr and exits 3, with nothing on stdout.

  An allowlist of miss phrasings rather than a blocklist of failures: a
  blocklist goes stale into silence the first time the CLI rewords itself,
  and silence here is indistinguishable from a branch that has no PR.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#174](https://github.com/plot-pm/plot/pull/174) [`9e22819`](https://github.com/plot-pm/plot/commit/9e22819d3abea138825e3e66e17c2e95b7e86f91) Thanks [@jwloka](https://github.com/jwloka)! - `Start work` now watches the count its own click moves, so a dispatch on an already-started plan reads as success instead of _no change — see log_.

  **The click always worked; the report on it did not.** A user said _"Start work on `feature/agent-rows-line-up` doesn't do anything"_, and every signal said otherwise: `dispatch.available` was `true`, the fleet scan said the wave was _eligible_, and `plot-dispatch --dry-run` said _would dispatch_. What failed was the success check. The button watched `card.started` — and **that flag describes the PLAN while the action starts a BRANCH**. A three-wave plan is `started: true` for ever after its first dispatch, so the flag the button was waiting on could never change again; three pulses later it reported _no change — see log_ about a dispatch that had prepared a worktree and pushed a claim.

  **The button is on that card deliberately, which is why the defect was permanent rather than occasional.** `isReadyToStart` demands Design-and-unstarted, but a second condition admits started Development cards: the button exists to start the **next** wave as well as the first. Two jobs, and a success check that served only the first — so every plan with more than one wave broke from the second click onward.

  **It now watches `waveSummary.claimed`.** Claiming a branch is exactly what a dispatch does, and unlike `started` the count moves on every wave. The comparison is `>`, not `!==`: claims are reaped when a branch merges, so a falling count is normal operation and not a success.

  **Still DERIVED, never asserted.** What changed is _which fact is read_, not whether git confirms it. The pulse still re-reads the refs and the row still travels on its own — an optimistic update would make the board display something it does not know.

  **`no change — see log` gets its meaning back.** It used to fire whenever a plan was already started, which was most of the time, so a message meant for _the dispatcher declined and here is why_ had been reporting successful dispatches instead. It is rare again, and rare is what lets it be believed — asserted in both directions, because a fix that simply stopped showing the message would pass every success test and delete a true signal.

  **A plan with `eligible: 0` refuses before the click**, naming the reason, rather than accepting and going quiet for three pulses. Same rule the row action menu already follows.

  **Without a pulse the button refuses rather than guesses.** Both counts are `.optional()` in the contract — _"Absent when there is no pulse"_ — so swapping `started` for `claimed` trades an always-present fact for a sometimes-present one, and the gap falls exactly where someone opens a freshly restarted board. It dims and says it is waiting for the first fleet scan: without a scan the board does not know which wave is eligible, so a dispatch would be a click into the dark that it could not report on afterwards either. Absent is treated as **unknown, never zero** — a first scan arriving with `claimed: 5` is the board learning what was already true, not five branches claimed by one click.

  **It deliberately does NOT fall back to `card.started` when the counts are missing.** That was the tempting fix and the worse one: it keeps the defect alive in precisely the window where it is most likely, hidden behind an apparently-working button. Asserted as its own test, because a fallback passes every other assertion here.

  A plan with no waves at all still lets the click through — no `waveSummary` is a pre-wave plan rather than a missing pulse, and `plot-dispatch.sh` is the authority there, refusing in its own words rather than having the board keep a copy of its preconditions.

  The `useRef` latch that pins the double click is untouched: it answers _is one of mine already running_, a different question with a different answer.

  <!--
  bumps:
    skills: {}
  -->

- [#202](https://github.com/plot-pm/plot/pull/202) [`11da9ea`](https://github.com/plot-pm/plot/commit/11da9ea5b899c21f93390558d7e1fb7950a52535) Thanks [@jwloka](https://github.com/jwloka)! - board: the PR error shows the whole path

  `slice(0, 80)` cut the failure message mid-path, and cut it **silently**:

  ```
  Command failed: bash /Users/…/plot/skills/plot/script
                                                      ↑ no ellipsis
  ```

  `…/skills/plot/script` reads like a filename and names a file that does
  not exist, so a message whose only job is to point at a cause pointed at
  a fiction. Measured cost: one wrong lookup before finding
  `plot-host.sh`.

  The limit is removed rather than raised — any limit moves the same defect
  to the next longer path — and the footer wraps instead. It costs a line
  of height on the rare occasion the board cannot reach the host, which is
  the one moment the reader is owed the whole sentence.

  <!--
  bumps:
    skills:
      plot: patch
  -->

- [#133](https://github.com/plot-pm/plot/pull/133) [`091c91e`](https://github.com/plot-pm/plot/commit/091c91e7204ae0f126b7b138c37b84042ea99e34) Thanks [@jwloka](https://github.com/jwloka)! - Two display bugs in the Agents tab, both found by looking at the board rather than by a test.

  **`next in 0s`, permanently.** The git countdown subtracted `ageSeconds` from the client's poll interval — but `ageSeconds` dates the _server's_ scan (5 s timer) while the client polls every 4 s. One clock's age against another clock's interval is reliably negative, and the clamp turned that into a fixed zero. The server now reports `scanNextInSeconds` from the timer it actually obeys, exactly as it already did for the PR side; absent, no countdown is shown at all.

  While fixing it: both countdowns now test with `== null`, since a payload that never passes through the schema sends `undefined` and `undefined - tick` renders `next in NaNs`.

  **A plan name printed on every row.** `plans.length > 1` suppressed the sub-heading for six QUIET rows of one plan, so its name appeared six times down the column — more chrome than one heading above six shorter rows. But `rows.length > plans.length` alone breaks the mirror case: two plans with one row each separate nothing and would run together unlabelled. A heading earns its place when it **separates** plans _or_ **saves** repetition, so it needs both counts. Where a heading names the plan, the rows below no longer repeat it.

  The rule is now a named function with unit tests for all four shapes, and the countdown gained the negative test its PR counterpart already had.

  <!--
  bumps:
    skills: {}
  -->

- [#141](https://github.com/plot-pm/plot/pull/141) [`731f6c5`](https://github.com/plot-pm/plot/commit/731f6c5bf21b407ae477faeb20f67a96d9c97419) Thanks [@jwloka](https://github.com/jwloka)! - **A board whose server has died now says so.** Until now it looked exactly like a working one.

  The Agents tab had no rendering at all for a failed fetch. `AgentList` read `fleet.error` only to choose the pre-first-scan message; after the first successful scan the error state was unrepresented, and the tab kept drawing its last payload — with a countdown clamped at `next in 0s`, which reads as _about to refresh_, and ages that went on advancing against a scan that had stopped happening. The sibling Board tab reported the outage while Agents hid it.

  It cost a real misdiagnosis on 2026-08-16: two screenshots were reported as regressions ("the heading is still there", "the plan link is still missing"), and neither was true on the live board — both were the frozen last render of a page whose server had stopped. Three hypotheses (stale bundle, JSX guard, minification) were spent before anyone checked what was actually running.

  **The failure that had no vocabulary.** `fleet.error` is the server _answering_ to say its own scan failed — a payload arrived, saying so. A dead server answers nothing, and no field inside a document the client never received can report that. So the signal now comes from where the fetch happens: `App` records when `/api/fleet` last answered and whether it has failed since, and passes the silence to the tab as `staleSeconds`. The two failures render as separate banners, because they send the reader to check different things and both can be true at once.

  Four decisions, each reached by discarding the obvious answer:

  - **The first failed fetch is enough** — no two-strikes rule. The outcomes are not symmetric: a hiccup shows a banner that clears itself four seconds later, while a dead server that looks healthy for two poll intervals costs a diagnosis.
  - **It recovers by itself** on the next successful fetch, with no reload. The polling never stopped, so the page can observe its own recovery; with a first-failure threshold, a "stale until reload" rule would strand the view on every hiccup.
  - **The first-load message stays separate.** _Waiting for the first fleet scan…_ is a different statement from _this data is old_ — one has never had an answer, the other has one it no longer trusts. Merging them would let an empty view claim staleness it cannot have.
  - **Degrade, do not hide.** The last payload stays on screen; it is still the best information available. What changes is the confidence around it — the countdowns disappear rather than freezing (a held number is still a prediction), the ages stop advancing and say they are frozen, and the banner reports how long ago the last answer arrived.

  Pinned by seven browser tests driving the shipped artifact, six of which fail against the old code on their own assertion — including the ones the plan called out as the ones a naive test passes without: on **one** failure, on the **recovery** and not only the failure, on the ages actually **freezing**, and on the first-load message staying distinct.

  <!--
  bumps:
    skills: {}
  -->

- [#136](https://github.com/plot-pm/plot/pull/136) [`85ac6fb`](https://github.com/plot-pm/plot/commit/85ac6fb1137ec9c5703276c86833f245a346ef31) Thanks [@jwloka](https://github.com/jwloka)! - An open PR whose branch no plan names now appears in the Agents tab.

  The pulse walks the branches a plan lists under `## Branches` — that is what makes it a fleet view rather than a branch listing, keeping `main`, release branches and stale worktree refs out. But a fix branch opened outside a plan carries the one thing the tab exists to surface, and could not show it: two PRs sat waiting to be merged while `WAITING ON YOU` read _none_, and the pulse reported 8 branches where origin had 20.

  Open PRs only. A merged PR with no plan is finished work, and admitting it would fill `done` with housekeeping nobody reads. No new host call either — the board already fetches every PR on its own slow timer, keyed by head branch.

  This also fills `WAITING ON A MACHINE`, which had never once been populated since the tab shipped. Its only entry is an open PR whose checks are running, and the branches carrying PR state were exactly the ones missing from the row set.

  <!--
  bumps:
    skills: {}
  -->

- [#164](https://github.com/plot-pm/plot/pull/164) [`12f424e`](https://github.com/plot-pm/plot/commit/12f424e9a73b8b5ab05e70e8af00e1f8c4ddf850) Thanks [@jwloka](https://github.com/jwloka)! - **Pins the mixed-section case for plan headings in a browser.** `showPlanHeading(group)` is already asserted per group in `test/unit`, but it is a pure function of a group — it cannot observe the row half of the same rule, and the row half is where a weaker implementation fails.

  The rule has two halves that must agree: a group of two or more rows earns a heading and its rows stay bare, while a one-row group earns none and its row must then carry the plan name **itself**. Decide the second half section-wide instead of per group — the obvious shortcut, since the heading half looks like it could be summed — and the lonely row loses its plan name with nothing replacing it. The unit test still passes; the reader is left looking at a branch with nothing saying what it belongs to.

  The new browser test holds one section containing both shapes at once (`beans` with three rows beside `lonely` with one) and asserts both halves together: exactly one heading, reading `beans(3)`; the lonely row carrying `lonely` as its own link; and the headed plan's rows not repeating the name. Verified to fail against the section-wide implementation, on the assertion that the lonely row keeps its name.

  Asserted on the plan **cell** rather than the row's text, because the branch is named `feature/beans-1` — a substring search for the plan name finds the branch and passes for the wrong reason.

  <!--
  bumps:
    skills: {}
  -->

- [#134](https://github.com/plot-pm/plot/pull/134) [`a93b906`](https://github.com/plot-pm/plot/commit/a93b9064947bec6ace806694e183bd9564d2d93b) Thanks [@jwloka](https://github.com/jwloka)! - `fleet.ts` no longer carries a literal NUL byte.

  It was the cache-key separator, and the choice is right — NUL cannot occur in a path, so it can never be ambiguous. Writing it as a raw byte rather than the `\0` escape is what cost: every line-oriented tool classifies the file as binary and then **answers nothing**. `grep` reports no matches without saying why; only `rg` names the reason. That cost three searches in one session which read as "not there" for constants present all along — and the obvious next move after such a search is to add code that already exists. Diffs and review views are blinded the same way.

  Behaviour is unchanged (`node` confirms the escape produces the identical byte), and a test now walks `src/` and `test/` for raw NULs. The gate was proven by putting the byte back and watching it fail.

  <!--
  bumps:
    skills: {}
  -->

- [#135](https://github.com/plot-pm/plot/pull/135) [`3a5f124`](https://github.com/plot-pm/plot/commit/3a5f1249fa3faaf122d45111dbc4d47070db19ab) Thanks [@jwloka](https://github.com/jwloka)! - Opening a Discovery plan no longer answers `Failed to load plan: HTTP 404`.

  Cards gained a second source when the board learned to read plans from prefixed branches, so a plan under PR review renders in the Discovery column. `/plan/<file>` kept resolving against the working tree alone — one consumer, two sources, and it saw half of them. The card sat on screen while clicking it failed.

  The plan viewer now reads either source. Branch plans come from git rather than a staged copy, since `collectBranchPlans` already carries the content and a request path has no business creating temp files. Traversal and unknown names stay 404, which the widened lookup makes worth re-asserting.

  <!--
  bumps:
    skills: {}
  -->

## 0.3.0

### Minor Changes

- [`f65e506`](https://github.com/plot-pm/plot/commit/f65e506c5ee16cdcc7e7a4efd9b8cd62c0de97d8) Thanks [@eins78](https://github.com/eins78)! - The Approved column splits into **Ready** (approved, no `Started:` record) vs **In progress** (has one) — Approved cards carry a `started` flag and render the matching badge. The plan-meta ceremony fields (`review`, `impl`, `approved_raw`, `started_raw`) enter the board's zod contract, and the story status vocabulary widens (`ready`, `in-review`).

## 0.2.1

### Patch Changes

- [#44](https://github.com/plot-pm/plot/pull/44) [`cee4d94`](https://github.com/plot-pm/plot/commit/cee4d94efbac12d56f5ed53aab250ce838580ba3) Thanks [@eins78](https://github.com/eins78)! - `@plot-pm/board` is now a self-contained npm package. It vendors Plot's plan-parser scripts (`plot-config.sh`, `plot-plan-meta.sh`) into the published tarball and bundles `zod`, so it declares zero runtime dependencies. You can now install and run the board with `npx @plot-pm/board` or `pnpm dlx @plot-pm/board` in any repository — including one pointed at a private or authenticated registry — instead of only from a Plot checkout.
