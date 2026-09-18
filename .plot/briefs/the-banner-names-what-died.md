## Implementation brief — a-stopped-fleet-names-its-repair (wave 2: The banner names what died)

- **Plan (canonical):** `docs/plans/2026-09-18-a-stopped-fleet-names-its-repair.md` on `main`
- **Approved:** 2026-09-18, jwloka, in-session
- **Branch:** `bug/the-banner-names-what-died` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention

This is the plan's **second and last** wave. It waited on `bug/the-reading-carries-which-stopped`, which **merged as #950** — the wait is satisfied and nothing waits on this. Wave 1 built the reading; this slice renders it. Read wave 1's brief at `.plot/briefs/the-reading-carries-which-stopped.md` for the diagnosis that produced the field.

### What to build

`plot-fleetctl.sh --status` told five machine states apart and handed the board one bit, so a supervisor that **died unattended** — a crash, a logout, an OS update — read as a machine that never had a unit at all. The board printed *"not installed"*, which is false about the machine and hides an unexplained death: an operator told the unit is absent does not open `.plot/logs/registryd.log`, and whatever killed the supervisor once will kill it again after `--start`.

**Wave 1 already fixed the reading.** `--status` now emits `install=<state>` on its `summary:` line, `SupervisorRun` carries it, and `supervisorState` answers a **fourth word** for it. What is missing is everything downstream: the word reaches no wire, no banner and no attribute.

Build the render half — widen the wire enum, give the state its own banner wording, make it loud when agents are running, and carry it on the DOM attribute. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The word is `died`, and the plan does not say so.** The plan's `Done when` says *"the wire schema's enum gains the member"* without naming it, because the plan was written before wave 1 chose it. Wave 1 chose `died` (`packages/domain/src/rules/supervisor-reading.ts:44`), and its TSDoc argues the choice at length: the script's own word is `installed`, which is correct about the unit file and **exactly backwards as a fleet's status**, since it reads as the opposite of stopped. **Do not rename it** and do not invent a second word for the wire — the estate already carries one vocabulary split here and the rule's header forbids adding another.

**`died` IS A KIND OF `down`, not a fourth direction.** Both mean no slice will be picked up. They differ only in what a reader does next: `down` needs a start, `died` needs the log read **first**. That distinction is the entire point of the plan, so the banner must say it — and it must not imply the fleet is in some third condition.

**Wave 1 left a deliberate narrowing point, and finding it is this slice's first job.** `supervisorVerdict` (`:293`) computes the state, then **returns a hardcoded `state: 'down'`** in its final block, under a comment that names this slice:

```
// `died` LANDS HERE AND REPORTS AS `down`. It is a refinement of this state,
// not a fourth direction ... so the wording is today's until the slice that
// renders the diagnosis widens the wire.
```

That is the line to change. Widening the schema enum alone ships nothing, because the verdict never emits the fourth word.

**THE PROMINENCE TRAP — this is the defect a naive implementation ships.** `supervisorProminence` (`:238`) reads:

```ts
if (state === 'down' && readings.agentsRunning > 0) return 'alert';
return 'quiet';
```

`supervisorState` **already returns `died`** today. So the moment the verdict stops collapsing it, a `died` machine with three agents running falls past that `===` test to **`quiet`** — and `quiet` renders grey, carries no `role="alert"`, and **does not render the detail sentence at all** (`FleetControls.tsx:389`, `{loud && <span data-fleet-supervisor-detail …>}`). The banner would name the death in a word nobody reads and drop the sentence that says what to do.

This is the exact failure that cost an hour on 2026-09-09 — the correct sentence sat in a grey chip and nobody acted on it — and it is recorded twice in the source you are editing (`schema.ts:3524`, `FleetControls.tsx:381`). **`died` gets `alert` on the same condition `down` has.** Widening the test to cover both states is a one-line change and forgetting it is silent.

**The banner names no launchd vocabulary. None.** `supervisorVerdict`'s header is explicit: `plot-registryd.mjs`, the label `com.plot-pm.registryd` and the internal state `up` are three machine-side vocabularies, and *"the board is the one surface where a reader should meet none of them."* **An earlier draft of the plan proposed printing `launchctl bootstrap`, which is all three at once** — the plan records that as a rejected option. The repair the banner prints is **`/plot-fleet --status`**, a command a reader can type. `/plot-fleet --start` is what `down` prints and is *not* right here: starting first is the mistake this state exists to prevent.

**The label names the consequence, not the condition.** *No slice will be picked up* is what a reader decides about; `unsupervised` named a component and left the consequence to be derived. A test at `packages/domain/test/supervisor-reading.test.ts:230` (*"names the consequence and not the condition"*) enforces this over a loop of agent counts — check whether the new state belongs in that loop.

**The enum lives on the SERVER side and is the only guard.** `SupervisorSchema.state` is `z.enum(['up','down','unknown'])` (`packages/board/src/contract/schema.ts:3519`). The **client casts and does not parse**, so nothing on the client would reject a fourth value — it would arrive as a state nothing draws. Which means: widen this enum or **the server's own parse fails** the moment the verdict emits `died`. There is no second guard and no client-side fallback.

**The attribute is one line and its selectors are already counted.** `data-fleet-supervisor-state={supervisor.state}` (`FleetControls.tsx:360`) passes the value straight through, so it needs no edit to carry `died` — but every test keyed on the old values must be checked. Measured on this branch's base: **exactly one** test reads that attribute, `packages/board/test/integration/supervisor-badge.browser.test.ts:235`, and it asserts `'unknown'`. No selector anywhere keys on `"down"`. The surface is smaller than the plan implies; verify rather than trusting this line.

**`died` has zero consumers outside the rule file.** Measured on the base commit: grepping `'died'` and `SupervisorState` across `packages/board/src` and `packages/domain/src` returns nothing but `rules/supervisor-reading.ts`. Every touchpoint this slice needs is one you create.

**Carried over unchanged:** absent is not false — a missing `install` field means *an older script*, never *not installed*, and `supervisorState` answers `down` for it. That fallback is wave 1's compatibility contract; **do not touch it.** And read the exit code, not the emptiness.

### Done when

The plan's `## Slices` → *The banner names what died* → `Done when` list is the specification. Lifting the assertions that exist **because a naive implementation would pass without them**:

- **`supervisorProminence` answers `alert` for `died` with agents running.** A naive implementation changes only the verdict and the enum; every existing test still passes, because `died` currently reaches `quiet` and no test asserts otherwise. What catches it: a test naming `died` **with `agentsRunning > 0`** and asserting `alert`. Without it the banner renders grey and drops its own detail sentence — the whole failure the plan is about.
- **The `down` and `unknown` banners are byte-identical to today, pinned.** A naive implementation rewords the shared `down` block while adding the new arm, because they are the same return statement today. Assert the exact label and detail strings for `down` at both agent counts and for `unknown`.
- **The rewritten anti-contract test.** `packages/domain/test/supervisor-reading.test.ts:205`, *"carries a died reading to the wire as down, with today's wording"*, asserts `verdict.state === 'down'` for a `died` reading. **This test is designed to fail on this slice** — its own comment says *"A slice that widens the enum rewrites this test deliberately; one that widens it by accident fails here."* Rewrite it to assert the new contract; **do not delete it**, and make the replacement discriminating rather than vacuous.
- **The server parses its own payload.** A naive implementation widens the domain and forgets `schema.ts`, and the domain's unit tests all pass — the failure only appears when the server assembles a board (`packages/board/src/server/fleet.ts:7079`). A board test that builds a fleet payload in the new state catches it; a domain-only test does not.
- **The banner names no launchd vocabulary.** Assert the negative: the label and detail match none of `launchctl`, `registryd`, `com.plot-pm`, `bootstrap`, `unit`, `daemon`. Asserting only that the new prose is present passes while a forbidden word sits beside it.
- **The banner points at `/plot-fleet --status`, not `--start`.** A naive implementation copies `down`'s detail and keeps its repair, which is the one instruction this state must not give first.

Plus the repo's gates:

- `nvm use` first — Node 24, per `.nvmrc`. **pnpm crashes on Node 26** and a background job under it exits silently having produced nothing, which reads exactly like a hung test run.
- `pnpm run test:board` — this slice is board-side, and it **rebuilds the artifact**. Browser tests load the built artifact, so a stale one fails reassuringly.
- `pnpm test` and `pnpm run typecheck`.
- `pnpm run test:contracts` if you touch anything under `skills/`.
- **Do not run `pnpm run test:e2e`.** It is CI's gate, not a local one — two agents running it once produced 53 concurrent `node --test` processes and a board that could not answer in 25 seconds.
- A changeset. This is a `packages/board/` **and** `packages/domain/` change; use the package frontmatter form (`'@plot-pm/board': patch`), description **first**, `plan:` block **last** — a block written first becomes the published changelog entry. Name the plan on the `plan:` line.
- **The board artifact is a generated file.** On a conflict in `board-server.mjs`, do not read the diff: take either side, run `pnpm build:board`, commit the result.

### Bookkeeping

- Push the first real commit as soon as it exists. The branch ref is already claimed and pushed; this brief is on `main`.
- Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work is still moving). It takes the title from the plan's wave heading and the body from the plan and this brief. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- This is the plan's last wave: when this PR merges, the plan is ready for `/plot-deliver a-stopped-fleet-names-its-repair`.

### Scope guard

**This branch owns:**

- `packages/domain/src/rules/supervisor-reading.ts` — `supervisorVerdict`'s final block and `supervisorProminence`. **Not** `supervisorState`, which wave 1 finished and already answers `died`.
- `packages/board/src/contract/schema.ts:3519` — the `z.enum(['up','down','unknown'])` and its TSDoc
- `packages/board/src/app/components/FleetControls.tsx` — `data-fleet-supervisor-state` at `:360` and the `loud` guard at `:389`, if either needs it
- `packages/domain/test/supervisor-reading.test.ts` and `packages/board/test/integration/supervisor-badge.browser.test.ts`
- A changeset, and the rebuilt `skills/plot/scripts/board/board-server.mjs`

**This branch does NOT own:**

- `skills/plot/scripts/plot-fleetctl.sh` — wave 1's, and finished. If `--status`'s prose is wrong, that is an amendment to file, not an edit to make.
- `packages/board/src/server/supervisor-reading.ts` — `readSupervisor`'s parse, also wave 1's.
- The 5,000 ms timeout budget. The plan states it explicitly: *"The budget is not this plan's — one plan per defect."* A timeout reaching `down` is known and out of scope.

**Other branches in flight, measured 2026-09-18:** two, and **neither overlaps.** `bug/the-index-is-read-once` touches `plot-reconcile-scan.sh` and its test. `bug/the-arm-reports-the-states-that-answered` (plan `a-partial-page-is-not-an-outage`) is `plot-host.sh` / `plot-fleet-scan.sh` territory — adjacent in subject, disjoint in files; it had pushed no commits at the time of measurement, so re-check its diff before you merge. The open release PR `changeset-release/main` (#927, release 2.19.0) will conflict on `.changeset/` only if it merges first.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The plan's own `## Notes` records that a diagnosis written into a brief eight days ago reached one agent and no index, and the defect sat unfixed — so an amendment goes to the plan, not into a brief.
