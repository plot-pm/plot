# Who may approve a release, and the reviewer as a role agent

> `release-approve` cannot tell a person from a master agent, a board started by an unattended process refuses a person's clicks, a release leaves Delivered plans outside the sprint unbooked and unnamed, and the reviewer starts without its role file. Each is a trust-boundary question, and this plan records the person's decisions for each.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #3077
- **Sprint:** follow-ups-2-30-1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3078 merged
- **Started:** 2026-11-03, Jan Wloka, `feature/the-gate-refuses-release-approve`
- **Started:** 2026-11-03, Jan Wloka, `feature/one-rule-reads-the-caller`
- **Started:** 2026-11-06, Jan Wloka, `feature/a-release-is-approved-with-a-passkey`
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The controller gate refuses `plot-ask.mjs release-approve`, and a `curl` to the board's `POST /api/release`, `POST /api/release-approve` and `POST /api/restart`, from any agent tool call, at a desk and in the main checkout.
- A release is approved on the board through a button that requires a passkey (Touch ID) user-verification assertion. The server verifies the assertion before `release-approve` runs and records the credential id in the action receipt. `plot-ask.mjs release-approve` refuses `person-unproven`, because a command line carries no assertion.
- One rule maps a process's environment to its caller at all eight entrances.
- A release books a Delivered plan that a consumed changeset's `plan:` line names, and names every other Delivered plan outside the sprint.
- fixer, main-repair and the reviewer load their role files through one loader that fetches the default branch first. The reviewer reads `.claude/agents/reviewer.md`, keeps its read-only flags as a floor, and `.plot/charters/reviewer.json` is retired.

Board impact: a passkey registration control, a release-approve button on the release row that asks for the passkey, release and restart buttons that send an assertion, and new refusal names on the release row (`person-unproven`, `passkey-unregistered`, `passkey-refused`). The release finish output names Delivered plans outside the sprint. The plan format, template and helper scripts keep their shape.

## Motivation

Two slices left the plan for #3069 on 2026-11-03, by jwloka's decision after its four-juror panel. Both change a trust boundary, so they got their own Design phase. Line references below are against `origin/main` at `f10abe5a4`; `packages/` is unchanged since `a518552f1`.

### Release approval (#2927, #2918)

- MEDIUM: `releaseFinish` books only the sprint's scope plans (`packages/domain/src/workflows/release-finish.ts:110-177`). The scope list is computed in the board entry by `scopeSlugs` (`packages/board/src/server/entry/release-finish.ts:38-50`) and passed in at `:223`. A Delivered plan outside the sprint whose changesets ship under the tag stays Delivered, and the finish does not name it. (#2927)
- MEDIUM: `releaseApprove` refuses only an `unattended` caller (`packages/domain/src/workflows/release-approve.ts:73`). `plot-ask.mjs release-approve` takes its caller from `mergePortsFor` (`packages/board/src/server/entry/main.ts:156`), which reads `PLOT_UNATTENDED` of its own process. A master agent's session has no `PLOT_UNATTENDED`, so it reads `person`, and `env -u PLOT_UNATTENDED` or `PLOT_UNATTENDED=0` gives the same answer at a desk. The controller gate does not gate `release-approve`: `GatedAction` is `'dispatch' | 'approve' | 'deliver' | 'release' | 'restart'` (`packages/domain/src/rules/ci-suite.ts:247`), and `gate.ts:981` returns `null` for every call in a linked worktree before any action is read. `plot-ask.mjs` writes its action receipt before it decides (`main.ts:220`). (#2927)
- LOW: a board that an unattended process started refuses a person's release and restart clicks. The caller comes from the board's own `PLOT_UNATTENDED` (`packages/board/src/server/entry/deliver.ts:791`, `packages/board/src/server/restart.ts:70`). The reverse also holds: a board a person started answers every loopback POST as `person`, so an agent's `curl -X POST /api/restart` passes as a person today. (#2918)
- The same caller expression sits at eight entrances in two spellings: `entry/deliver.ts:791`, `entry/main.ts:156` (merge and release-approve), `entry/main.ts:260` (repair-pr), `server/restart.ts:70`, `packages/fleet/src/server/entry/continue-command.ts:103`, `restart-command.ts:91`, `restart-stopped-command.ts:105`, and `entry/release-gate.ts:191`, which reads `--unattended` instead. `packages/board/src/server/continue.ts:184` hardcodes `caller: 'person'` for every request.

### Reviewer role (#2918)

- MEDIUM: the reviewer starts from `reviewerCommand` (`packages/board/src/server/entry/review.ts:345`), and no code loads `.claude/agents/reviewer.md`. The reviewer reads a different definition, `.plot/charters/reviewer.json`, from the main checkout's working tree (`review.ts:333-336`, `:586-589`).
- The role-file load exists twice and differs. The fixer reads `fixer.md` from the main checkout and passes `.claude/settings/fixer.json` as a path into that checkout (`packages/fleet/src/shared/auto-fixer.ts:454-461`). main-repair reads `main-repair.md` and its settings from `origin/<default>` through `Refs.showFile`, with no fetch before the read (`packages/fleet/src/shared/repair-role.ts:111-113`), and hardcodes `MAIN_REPAIR_MAX_TURNS = 80` (`repair-role.ts:18`) while the fixer takes `maxTurns` from its file.

## Design

### Approach

#### Threat model

The person and every agent run under one OS user and one `gh` login (`jwloka`), so no host reading separates them, and any value a local process reads (an environment variable, a flag, a file, a header, a token in the served page) another local process can produce. Each slice names the adversary it stops:

| Slice | Stops | Does not stop |
|---|---|---|
| Agent tool calls | an agent (master or desk) that runs the documented commands or `curl`s the board routes | a hand-written script, written to a file and run; a command the gate's matcher does not recognise |
| One caller rule | nothing new: one rule replaces eight copies, so a later change reaches every entrance | |
| Passkey release approval | any local process, for `release-approve`: no process produces a user-verified assertion from the person's platform authenticator | a process that removes the passkey store and registers its own credential, for example through a browser with a virtual authenticator; the receipt's credential id and the board's registered-credential line expose it |
| Release finish scope | a desk's mistaken `plan:` line naming a plan that is not Delivered, and a changeset that did not ship under the tag | a `plan:` line that names the wrong Delivered plan: that plan is booked Released, and only a person repairs it |
| Role-file loader, Reviewer role | a PR head that rewrites its own reviewer; a dirty or off-branch main checkout; a moved local `origin/<default>` ref; a role file that widens the reviewer's tools or permissions | a merged change to a role file's instructions: the trust moves to what merges on the default branch |

#### Release caller

**A person is proven for a release by two things.**

1. **The controller gate refuses agent tool calls.** `controllerInvocation` (`ci-suite.ts:216`) recognises `plot-ask.mjs release-approve` and a `curl` (or other HTTP client) to `POST /api/release`, `POST /api/release-approve` and `POST /api/restart`, and `release-approve` joins `GatedAction`. The gate reads these before the linked-worktree return at `gate.ts:981`, so a desk and the main checkout refuse alike, and none of them has a receipt escape. The refusal text names the person's route: the board's button. The hook fires for an agent's tool call and not for a person's terminal, which is why it tells the two apart. It is a gate against habit: a script written to a file and run is not stopped, and the plan names that limit rather than claiming identity. Whether Claude Code's `!` prefix passes PreToolUse is unverified, and the slice records the measured answer. The master agent's route for a per-plan release and a restart becomes the bundles `plot-deliver.mjs --release` and `plot-restart-command.mjs` under the existing receipt; the board routes serve a person's click.
2. **The release is approved on the board with a passkey.** The release row gets a release-approve button that calls `navigator.credentials.get` with `userVerification: 'required'` against a credential the person registered once. A new route, `POST /api/release-approve` with `{ pr, sha, assertion }`, verifies the assertion before `releaseApproveAt` runs, and the action receipt records the credential id. No local process produces a user-verified assertion from the person's platform authenticator.
   - **Registration.** A board control registers one credential through `navigator.credentials.create` with `authenticatorAttachment: 'platform'` and `userVerification: 'required'`, reading the public key through `AuthenticatorAttestationResponse.getPublicKey()`, so the server parses no CBOR. Only ES256 (`-7`) is accepted. The first registration wins; a replacement needs an assertion from the registered credential. The store is `.plot/state/passkey.json` under the common git dir (credential id, SPKI public key, sign count, registration time), and the board shows the registered credential id and time.
   - **Relying party.** The RP id is `localhost`, so the board is opened as `http://localhost:<port>`; an IP address is not a valid RP id, and the button says so when the page is served from `127.0.0.1`.
   - **Verification.** The server issues a single-use challenge bound to `(pr, sha)` that expires after 120 s. A pure domain rule `passkeyVerdict` checks the decoded readings: `type` is `webauthn.get`, the challenge and origin match, the RP id hash matches, the UP and UV flags are set, and the sign count moved forward (or both are zero). The signature check is an adapter over `node:crypto` behind a `Passkey` port, because the domain imports only `zod`. Refusals: `passkey-unregistered`, `passkey-refused` (with the failed check named), `challenge-expired`.
   - **The command line.** `releaseApprove` gains a reading `personProof: { credentialId: string } | 'none'` and refuses `person-unproven` when it reads `none`. `plot-ask.mjs release-approve` carries no assertion, so it refuses `person-unproven` for every caller and names the board button. `PLOT_UNATTENDED=0` and `env -u PLOT_UNATTENDED` therefore never produce a release on their own. `Caller` keeps its three values (`decision.ts:23`), so no other workflow changes its answer.
   - **The per-board token** is dropped: any local process can `GET /` and read it. A token adds CSRF protection that `isSameOrigin` already gives, and `controllers/caller.ts:24-27` already records why a hand-rolled token is not identity.
   - **#2918's LOW.** `POST /api/release` and `POST /api/restart` accept an optional assertion. A verified one reads `person` whatever the board's own `PLOT_UNATTENDED` reads; without one, the board's environment reading applies as today. The gate above refuses both routes from an agent tool call.

**One rule reads the caller.** A pure domain function `callerOf({ unattended })` maps the environment reading to a `Caller` (`'unattended'` when `PLOT_UNATTENDED` is `1` or `--unattended` is passed, otherwise `'person'`), and all eight entrances call it. It reads no `process.env` itself; each entrance passes the values in. The passkey proof is a separate reading, so `callerOf` never answers a release on its own.

**Unchanged.** `plot-ask.mjs merge` keeps today's caller rule: `mergePortsFor` is split so that `merge` reads `callerOf` and no passkey. `continue.ts:184` keeps `caller: 'person'` in this plan: answering a desk's question is not a release, so the passkey proof does not apply, and #3067's `bug/an-answer-records-its-true-author` changes the same route body. It is a follow-up issue.

#### Release finish scope

- **The source.** The changesets that shipped under the tag are the `.changeset/*.md` paths the release merge removed, read from the merge's first-parent diff (`Refs.commitFiles`, `-m --first-parent`), with their text read at the merge's first parent. `.changeset/` on `origin/<default>` at finish time holds none of them, because the release PR's version commit deleted them.
- **The rule.** `releaseFinish` takes a new reading `shipped: readonly ReleaseChangeset[] | 'unaskable'`. It books a Delivered plan that a shipped changeset's `plan:` line names, and names every other Delivered plan outside the sprint. A named plan that is not Delivered (Draft, Approved, Released, or a missing path) is skipped and named, never added to the scope that `plan-unbookable` refuses (`release-finish.ts:133`), so one changeset line never refuses the whole release. `'unaskable'` books the sprint scope only and names `shipped-unread` in the output.
- **Into the domain.** `scopeSlugs` moves out of `entry/release-finish.ts:38` into a domain rule. The `plan:` line is read by `planReference` (`packages/domain/src/rules/changeset.ts:77`, `PLAN_LINE`), and the split into sprint and outside changesets reuses `groupChangesets` (`packages/domain/src/rules/release-prepare.ts:128`). `release-world.ts:40`'s own `planOfChangeset` regex is replaced by `planReference`, so one reader remains.
- **#3071's limit changes.** #3071 records "Plans outside the sprint stay out of scope (decided)" and its Notes "Limit:" line. Its test "A shared issue stays open through the sibling read" uses a plan C left Delivered outside the sprint. After this slice, C keeps its meaning only if no shipped changeset names it, so the slice states in that test that C's changeset carries no `plan:` line, and adds a plan D that a changeset names, which is booked and no longer holds the issue open.

#### Reviewer role

- **The authority** is `.claude/agents/reviewer.md`, read from a freshly fetched `origin/<default>`.
- **One loader.** `roleFilesAt` in `packages/fleet/src/shared/role-files.ts` fetches the default branch, refuses `default-branch-unfetched` when the fetch fails, reads `.claude/agents/<role>.md` and, where the role has one, `.claude/settings/<role>.json` at `origin/<default>` through `Refs.showFile`, and writes `agents.json` and `settings.json` under `.plot/state/<role>/`. It is an `*At`-style composition beside the pure translation, which stays in `rules/role-command.ts` (`roleAgentsJson`, `roleCommand`). No domain rule awaits or writes a file.
- **Callers.** fixer and main-repair move onto it, so the fixer's settings come from `origin/<default>` instead of the main checkout, and `repair-role.ts:111-113` gains the fetch. Every role takes its turn limit from its file's `maxTurns`: `MAIN_REPAIR_MAX_TURNS` goes, and `main-repair.md` already says `80`.
- **The reviewer's floor.** The reviewer reads its definition through the loader and keeps `reviewerCommand` (`packages/domain/src/rules/review-verdict.ts:157-190`). The code keeps `--tools` (`REVIEWER_TOOLS`), `--disallowedTools` (`REVIEWER_DENY`), `--permission-mode dontAsk`, `--strict-mcp-config` and `--add-dir <reviews dir>`. `model`, `effort` and `maxTurns` come from `reviewer.md`. A role file whose `tools` name anything outside `REVIEWER_TOOLS`, or that sets `permissionMode`, `disallowedTools` wider than the floor allows, or `mcpServers`, refuses `reviewer-role-widens` and names the key. The reviewer has no settings file and keeps `--setting-sources user`.
- **The charter retires.** `.plot/charters/reviewer.json` is deleted. Its `name`, `prompt`, `model` and `effort` are already in `reviewer.md`'s frontmatter; `capabilities: ["read-only"]` is replaced by the code floor and the `tools` list; `harness` is unset there and stays the default `''`. The `charter` entity stays for other agents (`packages/fleet/src/server/entry/prompt.ts:58`); only the reviewer's reader at `review.ts:333-336` and `:586-589` goes.
- **A failed start names its cause.** An absent or refused `reviewer.md` refuses the review start with the file and the reason, so `review-not-passed` is never the only signal. `role-gate.ts`'s reviewer exception (`packages/domain/src/rules/role-gate.ts:69`, `:277`) stays, as does the writer identity #3074 compares against.

#### Order and siblings

- **The `release-approve` sentence in `CLAUDE.md`, `releaseApproveAt`, and `workflows-release-approve.test.ts`** are edited by four plans: #3070 (`feature/the-release-checks-are-counted`), #3071 (`bug/release-approve-tells-its-tracker`), #3074 (`review-foreign-writer`, `review-writer-unread`, still Draft) and this one. The passkey slice waits on the #3070 and #3071 slices. #3074 has no approved slice name yet, so whichever of #3074 and the passkey slice lands second rebases over the first.
- **The finish slice** waits on both #3071 slices, `bug/release-approve-tells-its-tracker` and `bug/release-finish-refuses-another-sprint`, which change the same domain function and the `sprint()` fixture in `release-finish-real-repo.test.ts`.
- **The reviewer slice** waits on the loader slice and on #3070's `feature/the-release-review-is-switched-on`, which makes the reviewer start on every slice PR.
- **#3067's `feature/fleetd-starts-the-unblocker`** starts the unblocker through `roleCommand`. If it merges after the loader slice, it reads `unblocker.md` through `roleFilesAt`; if it merges first, the loader slice moves its load too.

### Tests

Each test fails on `origin/main` at `f10abe5a4`.

- Agent tool calls: `packages/domain/test/controller-gate.test.ts` — `controllerInvocation` answers `release-approve` for `plot-ask.mjs release-approve 1 abc1234`, and the gated action for `curl -X POST http://localhost:4000/api/release`, `/api/release-approve` and `/api/restart`. `packages/board/test/unit/controller-gate-readings.test.ts` — the gate refuses each of them from a linked worktree and from the main checkout, with a fresh receipt present, and names the board button.
- One caller rule: a new `packages/domain/test/caller.test.ts` — `callerOf` for `PLOT_UNATTENDED` unset, `0`, `1`, and the `--unattended` flag. `packages/fleet/test/unit/continue-command.test.ts:71` and `packages/board/test/unit/release-caller-gate.test.ts:47` stay green unchanged.
- Passkey release approval: `packages/domain/test/workflows-release-approve.test.ts` — `personProof: 'none'` refuses `person-unproven` for caller `person`; a proof passes to the merge (fixtures at `:42`, `:125`). A new `packages/domain/test/passkey-verdict.test.ts` with a fixture assertion: a P-256 key generated in the test signs `authenticatorData ‖ sha256(clientDataJSON)`; the fixture verifies, and a changed challenge, origin, RP id hash, a cleared UV flag, a sign count that did not move, and a different key each refuse by name. `packages/board/test/unit/ask-release-approve-argv.test.ts` — `plot-ask.mjs release-approve` refuses `person-unproven` under `PLOT_UNATTENDED` unset, `0` and `env -u`. A board route test — `POST /api/release-approve` without an assertion refuses whatever the board's own `PLOT_UNATTENDED` reads, and a verified one writes a receipt naming the credential id. A board route test — `POST /api/restart` with a verified assertion on a board started under `PLOT_UNATTENDED=1` reads `person`.
- Release finish scope: `packages/domain/test/workflows-release-finish.test.ts:94-115` — one Delivered plan outside the sprint that a shipped changeset names is booked; a second Delivered plan outside the sprint is named and not booked; a named Approved plan and a named missing path are skipped and named, and the finish still books its scope; `'unaskable'` books the scope and names `shipped-unread`. `packages/board/test/unit/release-finish-real-repo.test.ts` — the shipped changesets are read from the release merge's removed `.changeset/*.md` paths. `packages/board/test/unit/shared-issue-reads-the-post-push-tree.test.ts` — the restated plan C and the new plan D.
- Role-file loader: `packages/fleet/test/unit/repair-role.test.ts` — a failed fetch refuses `default-branch-unfetched` and writes nothing. `packages/fleet/test/unit/auto-fixer.test.ts:196` — the `readRoleFile(main, role)` fake is replaced; a `fixer.md` whose main-checkout text differs from `origin/<default>` starts with the `origin/<default>` text and `maxTurns`.
- Reviewer role: `packages/board/test/unit/review.test.ts:318-321` — the reviewer command carries `model`, `effort` and `--max-turns` from `reviewer.md` and keeps every floor flag; a `reviewer.md` adding `Bash` to `tools`, or setting `permissionMode`, refuses `reviewer-role-widens` and starts nothing; an absent `reviewer.md` refuses naming the file; with the fake `agentRun`, a verdict still writes `plot/review` on the head. This process-free run is the end-to-end proof; a real agent run is outside CI.

### Documents

- `CLAUDE.md`, *The Master Agent Uses The Controllers*: the `release-approve` sentence names `person-unproven`, the passkey button and `POST /api/release-approve`; the routes sentence says the master agent releases and restarts through the bundles, and the board routes serve a person's click. Then `./scripts/check-agents-md.sh --write`.
- `skills/plot-release/SKILL.md` step 5b and its Model Guidance row: the release is approved on the board with a passkey, and the finish names Delivered plans outside the sprint.
- `docs/plans/2026-11-03-a-release-through-release-approve-leaves.md` is history once delivered; the finish slice changes the test, not that plan.

### Open Questions

- [x] Who may approve a release, and from which reading? Decided: the controller gate refuses agent tool calls, and the release is approved on the board with a passkey. The release action guarded is `release-approve`; it had no board route (`controller-gate.ts:311`), and this plan adds `POST /api/release-approve`. `POST /api/release` is a different action (`deliver.ts --release`).
- [x] Which mechanism names the clicking person? Decided: a user-verified passkey assertion. The per-board token is dropped.
- [x] Does `releaseFinish` book a plan outside the sprint? Decided: it books a Delivered plan a shipped changeset names, and names the rest.
- [x] #3071's scope limit and shared-issue test. Decided: the finish slice waits on both #3071 slices and restates that test's plan C.
- [x] The order of the `release-approve` sentence edits. Decided: #3070, #3071, then this plan; #3074 rebases or is rebased over.
- [x] One role-file loader. Decided: one fleet-shared loader for fixer, main-repair and the reviewer.
- [x] The reviewer exception in `role-gate.ts` and #3074's writer identity. Decided: both stay.
- [x] A reviewer that stops starting. Decided: a refused start names its file and reason, proved process-free in `review.test.ts`.
- [x] Order against #3070 and #3067. Decided: the reviewer slice waits on `feature/the-release-review-is-switched-on`; the unblocker reads through the loader if the loader lands first.

## Slices

### Agent tool calls

- `feature/the-gate-refuses-release-approve` — the controller gate refuses `plot-ask.mjs release-approve` and a `curl` to `POST /api/release`, `/api/release-approve` and `/api/restart` from any agent tool call, before the linked-worktree return, with no receipt escape <!-- builds: release-approve as a gated action; a board-route match in controllerInvocation --> → #3083

### One caller rule

- `feature/one-rule-reads-the-caller` — one pure `callerOf` maps the environment to a `Caller`, and all eight entrances call it; no answer changes <!-- builds: callerOf rule --> → #3103

### Passkey release approval

- `feature/a-release-is-approved-with-a-passkey` — the board registers one passkey, approves a release through `POST /api/release-approve` with a verified user-verification assertion, records the credential id in the receipt, and `plot-ask.mjs release-approve` refuses `person-unproven`; release and restart accept an optional assertion <!-- builds: passkey port and adapter, passkeyVerdict rule, release-approve board route, personProof reading --> <!-- waits: feature/one-rule-reads-the-caller, feature/the-release-checks-are-counted, bug/release-approve-tells-its-tracker -->

### Release finish scope

- `feature/release-finish-names-unbooked-plans` — `releaseFinish` books a Delivered plan a shipped changeset's `plan:` line names, names every other Delivered plan outside the sprint, and skips and names a named plan that is not Delivered <!-- builds: a shipped-changesets reading and an outside-sprint rule in releaseFinish; scopeSlugs in the domain --> <!-- waits: bug/release-approve-tells-its-tracker, bug/release-finish-refuses-another-sprint -->

### Role-file loader

- `feature/one-loader-reads-a-role-file` — fixer and main-repair load their role files through one loader that fetches the default branch first and takes `maxTurns` from the file <!-- builds: roleFilesAt loader shared by fixer, main-repair and reviewer -->

### Reviewer role

- `feature/the-reviewer-loads-its-role-file` — the reviewer starts from `.claude/agents/reviewer.md` read through the loader, keeps its read-only flags as a floor, refuses a widening role file by name, and `.plot/charters/reviewer.json` is retired <!-- builds: reviewer role-file start and widening refusal --> <!-- waits: feature/one-loader-reads-a-role-file, feature/the-release-review-is-switched-on -->

## Notes

- Created from tracker issue #3077 by `/plot-idea`, unattended, and amended after its first four-juror panel round (`.plot/panels/2026-11-03-who-may-approve-a-release-and/`). The decisions under *Approach* are jwloka's.
- Follow-ups: `continue.ts:184` passes every request as `person`; whether a change to `.claude/agents/*.md` or `.claude/settings/*` needs a person's review before merge; whether `plot-deliver.mjs --release` needs the passkey proof too.
- Refs #3069.
- `feature/the-gate-refuses-release-approve` (#3083) could not measure whether Claude Code's `!` bash-mode prefix passes the PreToolUse hook — that prefix is an interactive-CLI shortcut the harness this slice ran under has no way to type into itself, only to observe through the Bash tool, which the hook already covers. Unverified; a person testing an interactive session is the only way to settle it.
