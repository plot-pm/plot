## Implementation brief — jenkins-reads-in-process (wave 3: Cutover)

- **Plan (canonical):** docs/plans/2026-11-16-jenkins-reads-in-process.md on `main`
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3464 merged
- **Branch:** `feature/jenkins-reads-in-process-cutover` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per the repo's `Review: pr` convention

This slice is wave 3, the last. It builds on the merged Client slice (#3473) and the merged Reads slice (#3485). Nothing waits on it. It is the only slice that moves census rows and the only one that changes what a running fleetd starts.

### Read this first: the rotation measurement

The plan says the rotation result decides this slice (*Slice 1*, last bullet of the rotation measurement; Done-when row *The rotation result decides the Cutover*). A person records it in the story's *Measures*: whether the realm rotates refresh tokens for `client_id=cli`, whether reuse of a rotated token revokes the session, and whether `iss` equals the realm URL.

Measured on `origin/main` at `34023f066` (2026-11-17): `docs/stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md` holds no such line. `grep -n -i -E 'revok|rotation|client_id'` on it finds nothing about Jenkins. The Client PR merged without it. So before any code:

1. Fetch `origin/main` and read the story's *Measures* again. A person may have written the line since.
2. The line is absent, or says reuse revokes the session: stop. Write the `PLOT-BLOCKED` marker as the worker loop documents, name the measurement and the plan row, and open no PR. A person decides.
3. The line says reuse does not revoke the session: proceed, and name the accepted cost in the PR body: one `invalid_grant` answer, then one re-read of the store, on a lost race with `jen`.

Do not write the *Measures* line yourself. An unattended worker cannot log in, and an invented measurement is worse than none. Do not read an absent line as "does not revoke".

### What to build

fleetd asks Jenkins from inside its own process, and the Reads slice built the reads. Today an idle fleetd pass on a repository with `CI: jenkins` still starts `bash plot-host.sh pr-list --rich` for the rich open PR read, and that script starts a `jen` tree per question (3 for the colour map, up to 10 `jen api` for 5 rows). This slice moves that read in-process and proves it with census P12.

Build:

- **The Bitbucket overlay.** `bitbucketPrListing` (`packages/domain/src/adapters/host/bitbucket-pr-listing.ts:115`) overlays Jenkins colours on a rich read in-process: the colour map and the sha lookups from `jenkinsReads` (`adapters/build/jenkins-api.ts:626`), the rows from `rowsToBind`, and `bindChecks` (`rules/jenkins-pr-checks.ts`). The per-row projection that the shell's Bitbucket arm writes in `jq` (`$jmap`, `$shamap`, `$named`; `plot-host.sh` `_bb_jen_bind`) becomes `rules/ci-build-rows.ts`. Extend `corpus/bitbucket-pr-listing.corpus.test.ts` and `corpus/record-bitbucket-pr-listing.mjs` with a row against the shell arm.
- **The GitHub overlay (decision 4).** `githubPrListing` (`adapters/host/github-pr-listing.ts:173`) names Jenkins zero times today. It takes the same overlay. A corpus row compares it with the GitHub arm of `plot-host.sh` on the same recordings (extend `corpus/github-pr-listing.corpus.test.ts` and `corpus/record-github-pr-listing.mjs`). No census fixture is GitHub with `CI: jenkins`, so this row is the whole proof for the arm.
- **`hostReadsFor` takes an optional Jenkins client (decision 7).** `hostReadsFor` (`adapters/host/host-reads.ts:188`) gains the client. Given one, `SHELL_CI` (`:24`) and `SHELL_RICH_CI` (`:31`) do not apply and the overlay runs in-process. Given none, both lists apply as today, and the reason text keeps its current wording. Only fleetd passes a client.
- **fleetd composes the client.** `registryd-main.ts` (`hostReadsFor` at `:3145`, `buildShell` at `:3378`) builds the client through `composeJenkins` (`jenkins-api.ts:549`) where `CI` is `jenkins`, passes it to `hostReadsFor` and to `buildShell`, and keeps the shell where the composition answers `shell`. `PLOT_HOST_TRANSPORT=shell` (`rules/host-transport.ts`) forces the shell for Jenkins too (decision 5). fleetd logs the Jenkins transport, its reason and the credential source once at start, and `/plot-fleet --status` prints it.
- **The census.** Invert the case in `packages/fleet/test/census/bitbucket-jenkins.census.test.ts` (*reads the rich open pull requests through the shell*): it reads 0 stub `bb` open reads and more than 0 stub-server open-PR requests, and the start-line assertion names the in-process transport and the credential source. Shrink the Jenkins fixture's `recordOnly` to S4 alone, so P2, P3, P4, P7, P8, P10 and P11 assert on it. Turn P12 (`census-rows.ts`) to `green: true` with the lower bound beside the zero.
- **The story's *Measures*.** Record S4 on the Jenkins fixture against the merge base, as recorded and not asserted zero, with the reason below. Update the P12 row too. This is the only edit to the story; it does not touch the rotation line.
- **A changeset for `plot`.** This slice changes shipped behaviour. Write the description first and the `bumps:` block last (`CLAUDE.md`, *Versioning*). Name the plan on a `plan:` line inside the block.

Read the plan's *Slice 3* section before you start: it is canonical, and this brief records only what the plan leaves to interpretation.

### Settled decisions — do not re-derive them

- **Only a caller with a client goes in-process (decision 7).** The board's PR reader (`packages/fleet/src/server/entry/pr-reader.ts:134`, `:137`), the state branch (`packages/board/src/server/entry/state-branch.ts:69`) and the merge ports (`packages/board/src/server/entry/merge-ports.ts:39`) pass none and keep the shell overlay. Emptying `SHELL_RICH_CI` for everyone would move the board's reader off the shell, where no client and no credential probe exist, and would send its rows to `unknown`. Two Done-when rows hold this: a fleet row (the board's PR reader with no fleetd heartbeat writes rows whose `checks` carry the Jenkins colours and runs `plot-host.sh pr-list --rich`) and a board row (the merge ports read through the shell). A change that makes only the first of these pass has not proved the rule.
- **The wiring decides the Cutover; the reads are done.** Reads built `colourMap` and `builds`. Do not edit `jenkinsReads`, `rules/ci-build-map.ts`, `rules/ci-sha-runs.ts`, `rules/jen-url.ts` or the client's request, credential and refresh code. A disagreement between the overlay and the shell that traces to one of them means an earlier slice missed something: report it with both answers and the subject, and stop that part.
- **`bitbucketPrListing` already takes the Bitbucket client and a `Refs`.** Give it the Jenkins reads as a third, optional argument. Do not make it import the client. The adapter under `adapters/host/` is where the gate does not look, and a type two rules share lives in a vendor-free module.
- **S4 stays recorded, not asserted zero.** Declaring `CI` lets the default-branch read reach its tip read, which the plain Bitbucket S4 zero depends on not running (story *Measures*, S4 row: the fixture there declares no `CI`, so the read ends before the tip read). So S4 on the Jenkins fixture can be above 0 for a reason that is not a Jenkins read. P12 holds the Jenkins zero. Asserting S4 zero here would fail for a cause this plan does not own.
- **A row other than S4 that reads above 0 stops the branch.** The PR names the row and its commands. Do not widen `recordOnly` to make the census pass.
- **P12 has two halves and a naive change passes one.** Zero `jen` and zero Jenkins `plot-host.sh` reads is trivially true of a fleetd that reads nothing. The lower bound (the stub Jenkins route receives more than 0 requests summed over both idle passes, and the store's `checks` words equal the shell run's, including the one bound green word) is what proves the read still happens. Assert both.
- **The request count must not grow.** In-process Jenkins instance requests summed over both idle passes are at most the shell run's `jen api`, `job view` and `job list` calls, measured with `PLOT_HOST_TRANSPORT=shell` on the same fixture. The shell side's count is the stub `jen` invocations in the stub log, because the stub `jen` sends no request to the stub server. Token-route requests are reported apart.
- **The census gate.** The census job is not in `validate`'s `needs:`, so P12 does not block a merge by itself. The PR merges only on a green census job at its head commit. A red S5, S6 or S8 tolerance row, which this slice does not touch, takes one rerun of the same commit. A row red on the rerun stops the branch, and the PR names both runs. Rapid pushes starve CI, so push once per finished change.
- **The vendor gate.** CI's *The domain names no vendor* (`ci.yml:1666-1672`) greps code lines under `packages/domain/src/` outside `adapters/` for a standalone `jenkins` word, and an import path is a code line. Name the new module `rules/ci-build-rows.ts`. Keep every string literal that names `jenkins` in `adapters/`. Check with `grep -rn "from '\./jenkins-" packages/domain/src/rules/` and expect no hit.
- **Declared duplicates.** `rules/ci-build-rows.ts` duplicates the shell's projection on purpose, and the corpus rows hold the pair (`CLAUDE.md`, *A Shell Script Asks The Domain*). On a disagreement the branch stops. Adjust neither the rule nor the recording to make the test pass.
- **Absent is not false.** The overlay binds a colour only where a row's head sha matches a build. A row with no match keeps `unknown`. It never reads *no build* as `failed`, and a refusal from the client never reads as an empty map (Reads brief, *A refusal is not an empty answer*).
- **No credential in text.** The start line names the credential source (`environment` or the directory), never a value. The plan's leak row covers fleetd's log and the status line after P12.
- **Style.** New domain code uses arrow functions. TSDoc states what an export does, its parameters, its return and how it fails, and carries no history. Reasoning goes in the commit message and the plan.

### Done when

The plan's `## Done when` rows marked slice *Cutover* are the specification: P12 green (zero processes) and P12's lower bound, the Bitbucket overlay corpus row, the GitHub overlay corpus row and composition row, the caller-with-no-client rows, the inverted `bitbucket-jenkins.census.test.ts`, the request-count row, the transport-visible row, the S4 record, and the rotation row (above). The rows marked *Client, Reads, Cutover* also hold at this slice's head: the domain names no vendor, the Jenkins fixture's `recordOnly` is S4 alone and the census is green, and census S4 on the three existing fixtures stays at 0 with P5, P10 and P11 green.

Assertions a naive implementation passes without, and what each catches:

- **A bound green word.** The comparison of the store's `checks` words between the two runs must include the PR the census answers with a `SUCCESS` build of its head. Comparing `unknown` with `unknown` passes a fleetd that binds nothing.
- **The no-client row in both directions.** The board's reader with no fleetd still writes Jenkins colours through the shell. A row that checks only the in-process path passes when the client is always used.
- **`PLOT_HOST_TRANSPORT=shell` on Jenkins.** A row proves the switch keeps the shell overlay and the start line says so. Without it the switch covers GitHub, Bitbucket and Jira and silently not Jenkins.
- **A shell composition.** With no credential source, `composeJenkins` answers `shell`, fleetd logs the reason once, and the rich read stays on the shell for that process. Without the row, a machine with no credentials loses its Jenkins colours.
- **The GitHub overlay.** The corpus row compares against the shell's GitHub arm and covers a row with no matching build. A GitHub repository with `CI: jenkins` and a client reads in-process; one with no client keeps `SHELL_CI`.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` or the census locally: the census starts real traced runs, and CI is its authority. Do not commit a rebuilt board bundle (`scripts/check-no-bundle-diff.sh` refuses it). This slice edits no `.sh` file, and `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` grows past its merge base. The census step's `timeout-minutes` in `ci.yml` stays as the Client slice left it, unless the HEAD census exceeds 828 s; then raise it to 1.45 times the measured time and update the comment, as the plan says.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Before any hand fix of a PR, read `inFlight` in `.plot/state/fixer-attempts/<pr>.json`.

### Scope guard

This branch owns `adapters/host/bitbucket-pr-listing.ts`, `adapters/host/github-pr-listing.ts`, `adapters/host/host-reads.ts` (and its export line in `adapters/index.ts`), `rules/ci-build-rows.ts`, the two listing corpus tests and their recorders, `packages/fleet/src/server/entry/registryd-main.ts` (the Jenkins composition, the log line and the status line), `packages/fleet/test/census/` (the Jenkins fixture's `recordOnly`, P12, the inverted Jenkins case), the plan's `## Slices` annotation, the story's *Measures* S4 and P12 lines, and the changeset. It must not edit `plot-host.sh` (the shell side of every duplicate stays as it is), `rules/jenkins-pr-checks.ts`, `adapters/build/jenkins-api.ts`, `rules/jen-url.ts`, `rules/ci-build-map.ts`, `rules/ci-sha-runs.ts`, `pr-reader.ts`, `state-branch.ts` or `merge-ports.ts`: the last three keep the shell by passing no client.

Branches in flight on origin at dispatch (checked 2026-11-17 against `origin/main` at `34023f066`): `bug/pr-and-issue-reads-still-use` and `bug/pr-list-has-a-rest-route` edit `skills/plot/scripts/plot-host.sh` only, which this branch does not touch. `bug/red-hold-base-repair` edits `registryd-main.ts`, which this branch also edits: expect a textual conflict near `:3145` or `:3378` if it merges first, and rebase onto `main` rather than resolving by hand against a stale copy. If you find something the plan did not anticipate, report it rather than improvising outside scope.
