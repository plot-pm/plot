## Implementation brief — who-may-approve-a-release-and (wave 3: Passkey release approval)

- **Plan (canonical):** docs/plans/2026-11-03-who-may-approve-a-release-and.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3078 merged
- **Branch:** `feature/a-release-is-approved-with-a-passkey` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan's `Review: pr`)

All three waits have merged: `feature/one-rule-reads-the-caller` (#3103), `feature/the-release-checks-are-counted` (#3180) and `bug/release-approve-tells-its-tracker` (#3086). `feature/the-gate-refuses-release-approve` (#3083) also merged, so `release-approve` is already a `GatedAction` and `POST /api/release-approve` is already matched by the gate (`packages/domain/src/rules/ci-suite.ts:340`, `:455`). Nothing waits on this branch except documents: `skills/plot-release/SKILL.md` and the `CLAUDE.md` sentence name its refusals.

### What to build

Today `plot-ask.mjs release-approve <pr> <sha>` decides the caller from its own process: `callerOf({ unattended: process.env.PLOT_UNATTENDED === '1' })` in `mergePortsFor` (`packages/board/src/server/entry/main.ts`). A master agent's session has no `PLOT_UNATTENDED`, so it reads `person`, and `env -u PLOT_UNATTENDED` gives the same answer at a desk. The tool-call gate stops the documented commands, and it cannot stop a script written to a file and run. This slice makes a release approval need something no local process can produce: a user-verified WebAuthn assertion from the person's platform authenticator (Touch ID).

Build five things, in this order:

1. **`personProof` reading.** `releaseApprove` (`packages/domain/src/workflows/release-approve.ts`) gains `personProof: { credentialId: string } | 'none'` on `ReleaseApproveReadings` and a new refusal `person-unproven`. Check it right after the `unattended` check and before any host reading. `Caller` keeps its three values (`decision.ts:23`), so no other workflow changes its answer.
2. **`passkeyVerdict` rule** (new, `packages/domain/src/rules/`). A pure function over decoded readings: `type` is `webauthn.get`, challenge and origin match, the RP id hash matches, the UP and UV flags are set, and the sign count moved forward (or both are zero). It refuses by naming the failed check. It imports `zod` and nothing else.
3. **`Passkey` port and adapter.** The port is an `interface` in `packages/domain/src/ports/`, no runtime code. The adapter in `packages/domain/src/adapters/passkey/` implements the signature check over `node:crypto` (ES256, SPKI public key, `authenticatorData ‖ sha256(clientDataJSON)`) and owns the store `.plot/state/passkey.json` under the common git dir: credential id, SPKI public key, sign count, registration time. Follow how a sibling adapter such as `repair-record` or `reader-lock` is declared and registered in `adapters/index.ts`.
4. **Board routes and button.** `POST /api/release-approve` with `{ pr, sha, assertion }`, plus a challenge route and a registration route. The server issues a single-use challenge bound to `(pr, sha)` that expires after 120 s. It verifies the assertion, then calls `releaseApproveAt` with `personProof: { credentialId }`, and the action receipt records the credential id. The release row gets a release-approve button and the board gets a registration control that shows the registered credential id and time. `POST /api/release` and `POST /api/restart` accept an optional assertion: a verified one reads `person` whatever the board's own `PLOT_UNATTENDED` reads; without one, today's environment reading applies. Register routes where `/api/release` and `/api/restart` are registered (`packages/board/src/server/index.ts:259-284`).
5. **Command line refusal.** `plot-ask.mjs release-approve` carries no assertion, so it refuses `person-unproven` for every caller and names the board button. Split `mergePortsFor` so that `merge` keeps today's caller rule with no passkey (`mergeAt` unchanged) and `release-approve` passes `personProof: 'none'`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**WebAuthn, not a per-board token.** A token served in the page is readable by any local process that does `GET /`. `isSameOrigin` already gives the CSRF protection a token would add, and `packages/domain/src/controllers/caller.ts:24-27` already records why a hand-rolled token is not identity. Do not add one.

**Read the public key with `AuthenticatorAttestationResponse.getPublicKey()`, not CBOR.** The browser returns SPKI directly, so the server parses no attestation object. Accept only ES256 (`-7`); any other `alg` refuses at registration. A CBOR parser is a dependency and an attack surface the plan removed.

**RP id is `localhost`.** An IP address is not a valid RP id, so the board must be opened as `http://localhost:<port>`. When the page is served from `127.0.0.1`, the button says so and does not call `navigator.credentials`. Origin in the check is the exact `http://localhost:<port>`.

**First registration wins.** A replacement needs an assertion from the registered credential. Never overwrite the store on a second `create`. The adversary the plan does not stop is a process that deletes the store and registers its own credential, for example through a browser with a virtual authenticator, so the receipt's credential id and the board's registered-credential line are what expose it. Do not claim more than that in a comment or doc.

**The challenge is bound to `(pr, sha)`, single-use, 120 s.** A challenge issued for one head must not approve another, and a replayed assertion must refuse. Keep the challenge store in the board process's memory; it is not persisted.

**The signature check belongs behind a port.** The domain imports only `zod` (purity gate, `ci.yml:186`), so `node:crypto` lives in the adapter and `passkeyVerdict` takes the already-verified-or-not signature result as a reading. Do not import `node:crypto` into `rules/`.

**`userVerification: 'required'` on both `create` and `get`, and the UV flag is checked server-side.** The browser option alone proves nothing, because the server reads the flags from the signed authenticator data.

**Unchanged by the plan.** `continue.ts:184` keeps `caller: 'person'` (follow-up issue; #3067's `bug/an-answer-records-its-true-author` edits the same body). `plot-ask.mjs merge` keeps its caller rule. `plot-deliver.mjs --release` gets no passkey in this slice (named as a follow-up in the plan's Notes).

**Rules this repo keeps re-learning, carried over:** a refusal is the end of the action; an absent store reads `passkey-unregistered`, never an empty pass; a failed or unparseable read is not an absent reading; read exit codes, not emptiness. `person-unproven`, `passkey-unregistered`, `passkey-refused` (naming the failed check) and `challenge-expired` are refusal names the board shows on the release row, so add them to whatever union and renderer the existing refusals use.

### Done when

The plan's `## Tests` entries for *Passkey release approval* are the specification. Each fails on `origin/main`:

- `packages/domain/test/workflows-release-approve.test.ts` — `personProof: 'none'` refuses `person-unproven` for caller `person`; a proof passes to the merge (fixtures at `:42`, `:125`). This catches an implementation that checks the proof only on the board route and leaves the workflow open to the next entrance.
- New `packages/domain/test/passkey-verdict.test.ts` — a P-256 key generated in the test signs `authenticatorData ‖ sha256(clientDataJSON)`. The fixture verifies, and each of these refuses by name: a changed challenge, a changed origin, a changed RP id hash, a cleared UV flag, a sign count that did not move, a different key. Without the per-check cases, a verifier that checks only the signature passes.
- `packages/board/test/unit/ask-release-approve-argv.test.ts` — `plot-ask.mjs release-approve` refuses `person-unproven` under `PLOT_UNATTENDED` unset, `0` and `env -u`. This catches the exact bypass measured in the plan.
- A board route test — `POST /api/release-approve` without an assertion refuses whatever the board's own `PLOT_UNATTENDED` reads, and a verified one writes a receipt naming the credential id.
- A board route test — `POST /api/restart` with a verified assertion on a board started under `PLOT_UNATTENDED=1` reads `person`.
- Add a test for the single-use and expiry rules (a replayed challenge and a 121 s old challenge refuse `challenge-expired`), and one proving a challenge issued for `(pr, sha)` does not approve a different sha.

Plus: a changeset for `@plot-pm/board` and `plot` with the description first and the `bumps:` block last (name `plot-release` and `plot`); the browser test that proves the button shows the refusal wording, if the board's existing release-row test pattern has one (the decision is a domain property, the browser shows it); `CLAUDE.md`'s *The Master Agent Uses The Controllers* `release-approve` sentence names `person-unproven`, the passkey button and `POST /api/release-approve`, then `./scripts/check-agents-md.sh --write`; `skills/plot-release/SKILL.md` step 5b and its Model Guidance row say the release is approved on the board with a passkey. Do not commit a rebuilt `board-server.mjs` or any generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite; do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for growth in the same change by removing shell elsewhere or writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line under "Passkey release approval" in the plan's `## Slices` section. Do not edit any `State:` line; `plot-state-gate.sh` refuses it.

### Scope guard

This branch owns: `packages/domain/src/workflows/release-approve.ts`, the new `passkey-verdict` rule, the `Passkey` port and `adapters/passkey/`, `packages/board/src/server/entry/main.ts` (the `mergePortsFor` split and the `release-approve` arm), the new board route and the release and restart assertion arms in `packages/board/src/server/`, the board's release-row and registration UI, the tests above, and the two documents named under Done when.

Other branches from this plan: `feature/release-finish-names-unbooked-plans` (waits on `bug/release-finish-refuses-another-sprint`), `feature/one-loader-reads-a-role-file` and `feature/the-reviewer-loads-its-role-file` are unclaimed and touch `packages/fleet/src/shared/` and `entry/review.ts`, not this scope. The finish slice edits `packages/domain/src/workflows/release-finish.ts`, a different file from `release-approve.ts`, but both run in `plot-ask.mjs release-approve` in `entry/main.ts`; whichever lands second rebases. #3074 (Draft, no approved slice) edits the same `release-approve` sentence in `CLAUDE.md`, `releaseApproveAt` and `workflows-release-approve.test.ts`; if it lands first, rebase over it. Open PRs at dispatch: #3105 (`bug/the-queue-hands-out-an-approved-spike`), #3080 (release PR) and #3076 (idea); none touch this scope.

If you find something the plan did not anticipate — for example a ninth entrance that reads a caller, or a route that approves a release without `releaseApprove` — report it rather than improvising outside scope.
