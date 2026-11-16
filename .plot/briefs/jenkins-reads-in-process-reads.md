## Implementation brief — jenkins-reads-in-process (wave 2: Reads)

- **Plan (canonical):** docs/plans/2026-11-16-jenkins-reads-in-process.md on `main`
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3464 merged
- **Branch:** `feature/jenkins-reads-in-process-reads` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per the repo's `Review: pr` convention

This slice is wave 2. It builds on the merged Client slice (#3473): `jenkinsApi` in `adapters/build/jenkins-api.ts`, `rules/jen-url.ts`, and the census Jenkins fixture. The Cutover slice (`feature/jenkins-reads-in-process-cutover`) builds on this one. No census row moves in this slice.

### What to build

The three Jenkins questions fleetd asks, answered in-process over `jenkinsApi.request`, and the build port wired to them. Today every question starts a `jen` tree through `plot-host.sh`: on a Bitbucket repository with `CI: jenkins`, each idle beat costs 3 `jen` trees for the colour map and up to 10 `jen api` trees for 5 rows. This slice builds the reads and their proof. The Cutover slice makes fleetd use them for the PR listing.

Build:

- **The colour map.** `GET <job>/api/json` reads the job's own `_class`. A plain `WorkflowJob` answers its own `color` and `lastBuild`. A `WorkflowMultiBranchProject` asks its children once. Any other `_class` answers `unknown`, never `failed` (`plot-host.sh:1754-1757`, `jenkins_build_map` at `:1758`). The session check that `jen auth status` makes (`:1792-1794`) becomes the status of the first request: a refusal of kind `auth` reads `failed`, as an unreachable Jenkins does today.
- **Builds by sha.** `GET <branch path>/api/json?tree=builds[…]{0,3×limit}`, then the job root as a fallback. A multibranch `_class` at the root reads as an empty history. A JSON body without `builds` on the branch path reads as *no such branch* (`jenkins_sha_runs`, `plot-host.sh:2024-2070`).
- **Builds by branch.** The same request with no sha, as `runs` asks it (`plot-host.sh:5047`).
- `rules/ci-build-map.ts`: the colour-to-`checks` mapping (`JEN_COLOUR_JQ`, `plot-host.sh:1762-1768`) and the two job shapes.
- `rules/ci-sha-runs.ts`: the branch-record match (`:1993-2003`), the `NOT_BUILT` and `ABORTED` filter after the fetch (`:2005`, `:2076`), the `3 × limit` window and the plain job's branch filter.
- `adapters/build/build-jenkins.ts`: `buildJenkins` takes an optional client. `runs`, `runForSha` and `runsForSha` call it and keep `jenkinsConclusion` and `newestPerSha`. `rerunFailed`, `rerunAll` and `limit` stay on the shell.
- `adapters/build/build-resolve.ts`: `buildFor` passes the client only where its caller has one. `buildShell` takes the optional client too and passes it on, because fleetd reaches `buildFor` through `buildShell` (`registryd-main.ts:3371`). Model the optional-client shape on how `buildFor` and `buildShell` already take `api?: GithubApi`, and on `build-actions.ts` with `adapters/host/github-runs.ts` for the in-process reads.
- `packages/domain/corpus/jenkins-reads.corpus.test.ts`, with new recordings from `record-jenkins-reads.mjs`. It feeds one set of recorded Jenkins answers to the shell, through the stub `jen` that replays the real `jen`'s recorded output, and to the client, through the stub server. It compares every map entry, every run field and every refusal. Model it on `corpus/runs-for-sha.corpus.test.ts`.

Read the plan's *Slice 2* section before you start: it is canonical, and this brief records only what the plan leaves to interpretation.

### Settled decisions — do not re-derive them

- **A refusal is not an empty answer.** The reads return the client's refusal where the transport or the session fails. An unreachable or dead Jenkins is `failed` (map) or a refusal (runs), never an empty map or an empty run list. The shell reads empty bodies as failures too: `plot-host.sh` tells *Jenkins said no such branch* from *Jenkins did not answer*, and the port keeps that line. "No such branch" is an answer (no runs). "Did not answer" is a refusal.
- **`unknown` is not `failed`.** A job whose `_class` is neither `WorkflowJob` nor `WorkflowMultiBranchProject` (for example `FreeStyleProject`) answers `unknown`. A row asserts it. `failed` would turn a repository's PR checks red for a job shape Plot does not read.
- **Colour map.** `blue` is green. `red` and `yellow` are failing. Any `*_anime` is pending. A null, empty or other colour is none. Copy the table from `JEN_COLOUR_JQ`, not from memory, and let the corpus test hold the agreement.
- **Branch path, then root.** Builds by sha ask the branch path first, then the job root. Do not ask the root first: the shell's order decides which refusal a caller sees. A branch name is percent-encoded through `jenJobPath` (`rules/jen-url.ts`), and the multibranch child name from the map is percent-decoded back. A row covers a branch holding `/`.
- **Over-fetch, then filter.** The request asks for `3 × limit` builds. The `NOT_BUILT` and `ABORTED` filter and the branch-record match run after the fetch, and the result is cut to `limit` last. Filtering before the cut would answer fewer runs than the shell for a branch with many aborted builds.
- **Plain job keys.** A plain job's map key is the last path segment of the configured job. A plain job has no branch path, so its builds are filtered by the branch record, not fetched per branch.
- **The head sha matches the record, not the name.** A build belongs to a sha where its `lastBuiltRevision` or branch record names that sha. A rebuild of one commit gives several builds for one sha; `newestPerSha` keeps the newest, as today.
- **Job source.** `Default branch job` and `PLOT_JENKINS_JOB` keep their precedence from `plot-host.sh:1770-1779`. `jenkinsApi` already splits `Jenkins instance` at the first `/`; do not re-derive it.
- **Credentials, ledger, redirects and the vendor gate are the Client slice's.** `jenkinsApi` already refuses a third-host redirect, re-reads on `401`/`403`, charges the ledger and keeps every credential out of text. Call `request`; do not add a second path to the instance. No read here sends a request any other way.
- **Only a caller given a client goes in-process.** `buildFor` and `buildShell` with no client keep the shell for every read. The worker loop, the board and the merge path pass none. A `buildJenkins` row proves both: with the client, `runsForSha` starts no `plot-host.sh`; without it, `plot-host.sh runs-for-sha` runs.
- **Vendor gate.** CI's *The domain names no vendor* (`ci.yml:1666-1672`) greps code lines under `packages/domain/src/` outside `adapters/` for a standalone `jenkins` word, and an import path is a code line. Name the new rule modules `ci-build-map` and `ci-sha-runs`. Keep every string literal that names `jenkins` in `adapters/build/`. No module outside `adapters/` imports `./jenkins-pr-checks.js`. Check with `grep -rn "from '\./jenkins-" packages/domain/src/rules/`.
- **Declared duplicates.** `rules/ci-build-map.ts` and `rules/ci-sha-runs.ts` duplicate `plot-host.sh` rules on purpose, and `jenkins-reads.corpus.test.ts` holds the pair (`CLAUDE.md`, *A Shell Script Asks The Domain*). On a disagreement the branch stops. Adjust neither the rule nor the recording to make the test pass; report the disagreement in the PR with both answers and the subject.
- **Style.** New domain code uses arrow functions. TSDoc states what an export does, its parameters, its return and how it fails, and carries no history. Reasoning goes in the commit message and the plan.

### Done when

The plan's `## Done when` rows marked slice *Reads* are the specification: both transports read the same Jenkins answers (`jenkins-reads.corpus.test.ts`), both job shapes keep their reading, and the build port reads in-process where given the client. The rows marked *Client, Reads, Cutover* also hold at this slice's head: the domain names no vendor, the Jenkins fixture's `recordOnly` is untouched and the census is green, and census S4 on the three existing fixtures stays at 0.

Assertions a naive implementation passes without, and what each catches:

- The recordings must hold a branch the job never indexed and, apart from it, a transport failure. A client that maps both to an empty list passes every happy-path row and reports a Jenkins outage as *no builds*.
- A `NOT_BUILT` build and a rebuild of one commit. Without them the post-fetch filter and `newestPerSha` pass on any input.
- An HTML answer. Without it a client that parses the body as JSON throws instead of refusing.
- A `3xx` to `/oauth2/`, a `3xx` to a third host and a `403`, each asserted as a refusal of the kind the shell reports, with no request to the third host.
- A `FreeStyleProject` answering `unknown`. A client that maps every unread shape to `failed` passes the multibranch and plain rows.
- A multibranch child with a percent-encoded name. Without it a client that skips the decode keys the map on the wrong branch.
- A branch with more aborted builds than `limit`. Without it the `3 × limit` window passes with a window of `limit`.
- The `buildJenkins` row asserts both directions: no `plot-host.sh` start with the client, and the shell path without it. A row that only checks the client path passes when the client is always used.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` or the census locally. Add no changeset for this slice: no shipped behaviour changes (the Cutover carries the `plot` changeset). Do not commit a rebuilt board bundle. This slice edits no `.sh` file, and `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `adapters/build/jenkins-api.ts` (the read methods only; the request, credential and refresh code is the Client slice's), `rules/ci-build-map.ts`, `rules/ci-sha-runs.ts`, `adapters/build/build-jenkins.ts`, `adapters/build/build-resolve.ts`, `corpus/jenkins-reads.corpus.test.ts`, its recordings under `corpus/fixtures/jenkins-reads/` and the recorder `corpus/record-jenkins-reads.mjs` where new recordings need it. It must not edit `plot-host.sh` (the shell side of every duplicate stays as it is), `host-reads.ts`, `SHELL_CI`, `SHELL_RICH_CI`, `registryd-main.ts`, `bitbucket-jenkins.census.test.ts`, `rules/jenkins-pr-checks.ts` or the census fixture (Cutover). A change to `rules/jen-url.ts` or the client's request path means the Client slice missed something: report it rather than changing it here.

Branches in flight on origin at dispatch: `bug/pr-and-issue-reads-still-use` and `bug/pr-list-has-a-rest-route` edit `skills/plot/scripts/plot-host.sh` only, which this branch does not touch, so there is no collision here. The Cutover slice should re-check them. If you find something the plan did not anticipate, report it rather than improvising outside scope.
