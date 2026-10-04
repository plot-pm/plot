# A merge subject proves a landing the host cannot

> On Bitbucket, a branch merged and deleted is proven merged by the `Merged in <branch> (pull request #N)` commit on the default branch. Plot reads only GitHub's merge subject, so under HTTP 429 the branch reads `unknown` and every later slice of its plan is held.

## Status

- **State:** Released
- **Approved:** 2026-10-01, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1139
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Started:** 2026-10-01, Jan Wloka, `bug/the-merge-subject-is-one-rule`
- **Started:** 2026-10-02, Jan Wloka, `bug/the-queue-reads-the-merge-subject`
- **Delivered:** 2026-10-02
- **Released:** 2026-10-04, v2.23.0

## Changelog

- On Bitbucket, the fleet scan and the supervisor read a `Merged in <branch> (pull request #N)` commit on the default branch as proof that a branch without a ref merged. A merged slice no longer needs the host to answer before the next slice can be offered; under a refused host the next slice still needs one host answer about itself.
- On GitHub, a merge subject counts only when it names the repository's own owner, compared without case. Where the owner cannot be read, as for a local-path origin, any owner counts, as today.
- A merge subject proves a branch for a plan only when the merge is not contained in the commit that added the plan file. A reused branch name merged before the plan existed does not settle a slice nobody started. A name merged while the plan was a Draft on its own branch still counts, and the scan footer counts the subjects it ignored for this reason.
- Auto-delivery does not start on a merge subject alone. It waits until the host confirms the merge, so a throttled host no longer leaves a plan's auto-delivery stuck until the board restarts. The board's Deliver control reads the same rule, so it does not offer a plan whose landing only a merge subject proves.

## Motivation

Measured 2026-10-01 on a Bitbucket repository (`ewz-kus-portal`, Plot 2.22.1, `bb` 1.9.0), reported in #1139:

- PR #3644 merged and deleted `feature/ewzkus-3845-contractaccount-bykey-tracer`. `develop` carries `Merged in feature/ewzkus-3845-contractaccount-bykey-tracer (pull request #3644)`.
- The supervisor tick reported `held on merge-unknown (1)` for that branch, which is the plan's first slice. `plot-host.sh pr-merged` returned HTTP 429, then `unknown`.
- The plan's only unmerged slice was held `not-claimable` while a free agent waited, and a person started it by hand.

The same repository, counted read-only on 2026-10-01: `git log origin/develop --merges --grep='^Merged in '` returns **1723**, and the same query with `--no-merges` returns **0**. Every `Merged in` subject is a two-parent merge, so `--merges` loses none. `develop` holds 2289 merges in all; the other 566 include 15 backward `Merge remote-tracking branch 'origin/develop'` merges and older `Pull request #N: <title>` merges from before 2024-01-23, when the repository moved from Bitbucket Data Center to Bitbucket Cloud. All 1723 `Merged in` subjects fall inside the scan's 2000-merge cap. The same estate reuses branch names: 87 names appear in two or more `Merged in` subjects.

Three readers decide whether a refless branch landed, and none reads the Bitbucket subject. Verified against `origin/main` at `0013b372`:

| Reader | Where | Reads a merge subject |
|---|---|---|
| Fleet scan, per branch | `plot-fleet-scan.sh:2183` `merged_by_subject` → `rules/branch-state.ts:189` | GitHub form only: `^Merge pull request #N from [^/]+/<branch>$` |
| Fleet scan footer | `plot-fleet-scan.sh:492` `MERGE_DETECT` | GitHub form only, so a Bitbucket estate reports `merge_detect=none` |
| Supervisor queue | `packages/board/src/server/queue-reading.ts:237` `world.mergedBranches()` → `landedWithoutListing` → `queueOfPlan(plan, claimed, merged)` | None. The host's listing, then #1143's index rows and `pr-state <n>` |
| Worker loop, offline | `plot-worker-loop.sh:2213` `plot-fleet-scan.sh --offline --why-nothing` (`:594` documents the former `--offline --next`) | Through the scan. Offline, a refless Bitbucket branch reads `open` today |

The measured hold is the supervisor's. A fix in the scan alone leaves it in place: `queueOfPlan` takes its `merged` set from the host and from nothing else.

**What remains held after this plan.** Two panel jurors reproduced the fix in round 1 with the listing and the per-branch question both refused. The merged predecessor is released, and the next slice is then held on `merge-unknown` about its own branch. `readQueue` asks `world.queuedHasLanded(<next>)` (`queue-reading.ts:253-256`), which is `host.prMerged`, and an unstarted branch has no index row and no PR number for `landedWithoutListing` to use. The scan asks `merged_by_host` for the same branch and reads `unknown` under 429, and `--list-eligible` offers only `open` (`eligible.ts:139-170`). The gain is that one per-branch host answer now releases the next slice, where the whole listing was needed before. No host-free answer for an unstarted branch exists: the PR index never says no, and a refless branch with no subject may be a squash merge whose ref was deleted. That question belongs to #1094.

A GitHub panel juror measured the existing GitHub reading on 2026-10-01 (`.plot/panels` round on #1139): 122 of 200 merged PRs found by subject, 0 branch mismatches, 0 merge-commit mismatches against the host, 0 false positives. The 78 misses are squash or rebase merges with one parent, and each falls through to the host as it does today. It also found 22 first-parent subjects that name another owner: `eins78` ×20 (this repository's PRs #16-#19 from before its transfer) and four contributor forks. The current `[^/]+/` accepts all 22.

## Design

### Approach

**A merge subject is positive evidence for a branch with no ref, in the wave gate only.** The scan has used the GitHub form this way since 2026-08-16 (`6c66b389`). This plan adds the Bitbucket form, moves the decision into the domain, applies it per plan, and gives the supervisor the same reading.

**The rule is vendor-free.** `rules/merge-subject.ts` exports `mergedBySubject({ subjects, branches, forms, owner })`. A form is a template with three placeholders, `<branch>`, `<number>` and `<owner>`. The rule matches each subject as a whole line: the branch as literal text, the owner as literal text compared without case, the number as one or more digits. An `owner` of `null` matches any owner. It answers, for each subject, the branch it names, or nothing. An empty form list answers nothing. The rule names no host.

**One owner parser.** `rules/remote-owner.ts` exports `ownerOfRemote(url)`. It answers the path segment before the repository name for `https://<host>/<owner>/<repo>[.git]`, `ssh://git@<host>/<owner>/<repo>[.git]` and `git@<alias>:<owner>/<repo>[.git]`, lowercased, and `null` for a local path or any other shape. An SSH host alias such as `github-work` changes nothing, because the owner is the segment after the colon. The scan passes the `origin` URL to the bundle and never parses it; the supervisor reads it through `refs.remoteUrl` (`ports/refs.ts:339`) and calls the same function. `null` keeps today's answer, so `test/reconcile/fleet.test.mjs:845-900`, whose origin is a bare local path, stays green.

**Neither rule joins the domain barrel.** `packages/domain/src/index.ts` re-exports 43 rule files with `export *`. `merge-subject.ts` and `remote-owner.ts` stay out of it and are imported by subpath (`@plot-pm/domain/rules/merge-subject`), as `entry/branch-state.ts:24-27` does for its rule. A module that imports the barrel cannot reach them.

**The forms live in the host adapter.** `adapters/host/merge-subjects.ts` maps a backend word to its forms, as data only:

| Backend | Form |
|---|---|
| `github` | `Merge pull request #<number> from <owner>/<branch>` |
| `bitbucket` | `Merged in <branch> (pull request #<number>)`, Bitbucket Cloud's default merge message |
| any other | none |

A backend with no forms proves nothing, and every branch falls through to the host as today. Bitbucket Data Center's `Pull request #N: <title>` names no branch in its subject; `plot-host.sh` drives only `bitbucket.org`, so it gets no form. `packages/domain/package.json` exports `./rules/*` and the `./adapters` barrel but no `./adapters/host/*`; slice 1 adds that subpath export, so a bundle does not pull the adapters barrel.

### The age rule

**A subject proves a branch for a plan only when its merge is not contained in the commit that added the plan file.** A later plan may reuse a merged branch name; on Jira-keyed GitFlow estates a reopened ticket does this, and `ewz-kus-portal` holds 87 reused names. Round 1 executed the case: an unstarted reused name read `merged` (`bug/flaky — merged`), its slice read complete, the next slice opened, and the reused slice was never offered.

**The plan file is the dated file, read on `origin/<main>`.** The age reads the plan's own file under the plan directory, repository-relative, never the symlink under `active/` or `delivered/`. A delivery moves the symlink as a git rename, so the symlink's adding commit is the delivery or approval commit. Measured on `ewz-kus-portal`: `delivered/ewzkus-3697-uc1-auszug-bekannt.md` keeps 4 of 4 subjects through its target and 0 of 4 through its symlink, because one bulk move (`6cb45034de`) re-added 13 symlinks. The ref is `origin/<main>`, the same ref as the merges walk, never `HEAD`, which in a desk or on a feature branch holds another history.

**The walk is batched, and its cost is measured.** Three readings per scan or tick, none per plan:

1. One `git log origin/<main> --diff-filter=AR --name-status --format=@%H -- <plan dir>` for the adding commits of every plan file. An `A` line gives a path and its adding commit. An `R` line maps a new path to an old path; the bundle follows each `R` chain back to the old path's `A` line, so a renamed plan keeps the commit that first added it. Measured 2026-10-01 with `--diff-filter=A --name-only`: 0.10 s for 392 plan files here, 0.02 s on `ewz-kus-portal`; the `R` lines come from the same call. The per-file lookup it replaces cost 6 to 37 ms per plan, 5.23 s for 140 lookups here.
2. One `git log origin/<main> --merges --max-count=<cap> --format='%H %s'`, the walk the scan already runs, now with the merge's hash. Measured under 0.01 s at cap 2000 on both repositories.
3. `git merge-base --is-ancestor <merge> <added>` only for a pair where a subject names a refless branch of that plan. Measured 4 ms per call here. On `ewz-kus-portal` that is a few calls per scan; on a delivered plan whose slices all merged, one call per slice.

The ancestry call carries `# plot-ancestry: evidence — the rule decides; a wrong "contained" answer sends the branch to the host, a wrong "not contained" answer is the reused-name case this narrows`. `scripts/check-ancestry-decisions.sh` matches `merge-base … --is-ancestor`, so the gate requires and checks that line. When the adding-commit walk fails, or a plan file is absent from its answer, that plan gets no subjects, and its branches go to the host.

**One limit, stated and bounded, and one case the walk now covers:**

- **A plan drafted on its own branch.** Its adding commit lies on that branch, so `^<added>` excludes only the merges before the branch forked. A reused name merged on `<main>` between the fork and the plan's own merge still counts for that plan. The plain walk is chosen over `--first-parent`: a first-parent lookup closes this window, and it also excludes the merge of a plan written on the work branch it implements, which sends that plan's own slice to the host. All 34 plan files on `ewz-kus-portal` were added on a side branch, and the #1139 tracer subject lies inside `develop ^0a08b71102`, so the measured case is proven. A slice 1 fixture asserts this window.
- **A renamed plan file.** With git's default rename detection, the batched walk lists a renamed dated file as `R`, never `A`, so an `A`-only walk would leave the current path out of the answer and the plan would get no subjects. Reading `R` lines in the same call and following each one to the original `A` keeps the age across a retitle, at no extra call. Measured on `origin/main`: 4 of 392 dated plans have no `A` entry for their current path, all renamed while Draft. Where a chain does not end in an `A` line inside the walk, the plan gets no subjects and its branches go to the host. Slice 1 fixtures assert both: a `git mv` of a plan keeps the first add's age, and a chain with no `A` line sends the branch to the host.

**The scan footer names a subject ignored for age.** A slice whose subject the age rule rejects reads `unknown` under 429, the same as a slice with no subject. The footer gains `subject_predates_plan=<n>`, and the branch's JSON carries `subjectIgnored: "predates-plan"`, so `--why-nothing` and an operator can tell the two cases apart.

### The scan

**The scan asks through a bundle, once per scan, after it parses the plans.** A new bundle, `plot-merge-subject.mjs`, reads stdin in sections: the backend word, the `origin` URL, the merges as `<hash> <subject>` lines, then one section per plan with its dated file, its adding commit and its refless branches. The bundle is asked twice per scan. The first call answers the matched pairs, each as plan, branch, merge and adding commit. The scan runs one ancestry test per pair, which is a reading. The second call takes the same input plus the test answers, and answers per plan the branches proven, the pairs ignored for age, and the detection word. The rule stays in the bundle, and the shell only reads git. The scan reads the backend from `plot-host.sh backend` (`:408-409`, `:561`), a local read. The call goes after plan parsing, because the plan branches and their adding commits are known only then.

**The proof is keyed by plan and branch.** `branch_readings` takes a branch and its deferred flag (`plot-fleet-scan.sh:3319`); the subject lookup takes the plan as well, so one plan's proof never settles another plan's reused name. `merged_by_subject` becomes a lookup of the pair in the no-ref arm (`:3353`). The shell regexes at `:2183-2186` and `:492` are removed.

**The host question for a proven branch.** For the wave gate the subject is enough, and the scan does not ask the host about a proven branch. The one exception is a delivery candidate: an Approved plan whose every non-deferred branch reads `merged`. For such a plan the scan asks `merged_by_host` about a branch proven only by subject, and only when `HOST_VERDICT` is `ok` or `partial`. The scan sets that word from its listing before it reads branches (`plot-fleet-scan.sh:897-905`), and its vocabulary is `unasked`, `ok`, `partial`, `throttled`, `secondary` and `failed` (`:100`, `:660-689`). With any other word the scan asks nothing about the candidate and keeps `evidence: "subject"`, because a question the host is refusing is new spend in the condition #1139 reports, and the board scans every 5 s. The terminal cache (`PLOT_TERMINAL_CACHE`, `:1243`) keeps a merged answer per tip of `origin/<main>`: `terminal_cached` discards an entry when the main tip or the plan revision moves (`:1256-1271`), so a candidate is asked once per tip of `origin/<main>`, not once in all. The branch carries `evidence: "subject"` in the scan's JSON while the host has not confirmed it, and loses the field once the host answers merged.

**`merge_detect=unaskable` stays, and it is documented.** It is the footer word when this bundle alone cannot answer. Every refless branch then goes to the host. On Bitbucket that is today's behaviour. On GitHub it is worse than today, and the plan says so: the shell regex that answers today is removed, so a GitHub estate loses its subject proof while the bundle cannot answer. A missing `plot-branch-state.mjs` still exits 2 first (`:3531-3533`). A capped walk keeps today's `truncated` word. `skills/plot-pulse/SKILL.md:176` lists `unaskable` with the others, and slice 1 corrects that file's paragraph at `:188-191`, which says a host that cannot answer leaves the branch `open` while the scan reads `unknown` (`:3385-3395`).

### The supervisor

**The supervisor reads the same rule at a named seam.** `readQueue` reads only through `QueueWorld` (`queue-reading.ts:27-80`), and `queueWorldForRepo` (`entry/registryd-main.ts:528`) builds it. Slice 2 adds:

- Two refs-port operations, each with a git adapter and a fixture adapter:
  - `planAdditions(ref, dir)` answers a map from each file under `dir` to the commit that first added it, from one `git log <ref> --diff-filter=AR --name-status --format=@%H -- <dir>`, following each `R` to its original `A` as the scan's walk does. On failure it answers an error, and every plan then gets no subjects.
  - `mergeSubjects(ref, max)` answers `{ sha, subject }` for the merges on `ref`, from one `git log <ref> --merges --max-count=<max> --format='%H %s'`. `commitsSync` runs `--no-merges` (`refs-git.ts:380`) and cannot serve. On failure every plan gets no subjects.
  - Ancestry uses one more operation, `contains(ancestor, descendant)`, answering `yes`, `no` or `unknown`, with the `plot-ancestry: evidence` line in its git adapter. `unknown` proves nothing.
- `QueueWorld.subjectProven(plans, claimed)`: a map from plan to the branches the rule proves for it, or `null` when it cannot ask. It drops every name in `claimed`, so a ref-carrying branch is never reported proven and keeps its own `queuedHasLanded` question. `queue-reading.ts` receives sets of branches and never a backend word, because a vendor word there falls outside the vendor gate's root.
- **The proof is applied per plan.** `landedWithoutListing` (`queue-reading.ts:241`) and `queueOfPlan` (`:245`) take `merged ∪ proven(plan)` for each plan, never one union across plans, so a delivered plan's proof never settles the same name in a later plan.
- **The union applies only when the ref list was read.** `claimedBranches` answers `new Set(['*'])` on failure (`registryd-main.ts:556-560`), and `'*'` excludes no branch. With that sentinel, no proof is applied and the queue reads as it does today.

`queueOfPlan` settles a slice on `claimed || merged` (`queue-reading.ts:144-145`), so a ref already settles a branch. The proof therefore adds nothing for a claimed branch, and dropping claimed names keeps the host question that branch is owed.

**What stays as it is:**

- **The ref check stays in front in the scan.** A branch with a ref never reaches the subject arm (`branch-state.ts:170-182`).
- **Nothing is cached** beyond the terminal cache the scan already holds. The walks are local and run every pass. A cached proof would outlive a recreated branch.
- **`--merges` and reachability stay; first-parent stays out** of the merges walk. The scan's header measured a first-parent filter at 108 against 108 and recorded that it breaks GitFlow (`:439-446`).

### The boundary

**No destructive decision reads the subject.** Readers of the subject-derived `merged` state:

| Reader | What it does | What holds it |
|---|---|---|
| Wave gate, queue | offers the next slice | nothing needed; reversible |
| `auto-dispatch.ts:159` `mergedBranches(pulse)` | calls an agent free | an agent's branch has a claim ref and never reaches the subject |
| `auto-deliver.ts:252-256` `landedBranches`, `:273` `allSlicesMerged` | starts a delivery | `planAutoDeliver` calls `allSlicesConfirmed`, which reads a subject-only branch as `unknown`; then `plot-deliver.sh:181` → `plot-ask.mjs deliverable` → `controllers/deliverability.ts:86` `host.prMerged`, where `unknown` counts as not merged |
| `deliver.ts:230` `allSlicesMerged` | the board's Deliver verdict, a person's action | `deliver.ts:230` calls `allSlicesConfirmed` instead, so the control does not read deliverable on subject evidence; the delivery re-gate stays behind it |
| `board.ts:1005` `planStatus` → `allSlicesMerged` | the plan's status word | nothing needed; a status word starts no action, and a subject-proven slice reads merged there as in the wave gate |
| reap, ref deletion | removes a desk or a ref | `plot-reap.sh` and `plot-release-refs.sh:213` read `pr_merged` |

**The confirmation reading is a domain rule.** `rules/deliverable.ts` gains `allSlicesConfirmed(meta, pulse, complete)` beside `allSlicesMerged` (`:62`). It answers as `allSlicesMerged` does, except that a non-deferred branch carrying `evidence: "subject"` makes the answer `unknown`. Its unit tests sit beside `allSlicesMerged`'s and hold the domain's 100% branch coverage. `planAutoDeliver` (`auto-deliver.ts:258`) and the board's Deliver verdict (`deliver.ts:230`) call it; neither tests the field itself. CLAUDE.md, *The Layering Rule*: no domain-specific behaviour lives outside the domain.

**The fields are declared on the entity, or the rule reads nothing.** The board parses the pulse through `FleetReadingSchema` (`entities/fleet.ts:652`), and each branch through `BranchSchema` (`:174`), a plain `z.object` that strips undeclared keys. A scan that emits `evidence` and `subjectIgnored` would reach `allSlicesConfirmed` without them, the rule would answer as `allSlicesMerged`, and a test that builds its pulse as a typed literal would stay green. Slice 1 declares `evidence: z.enum(['subject']).optional()` and `subjectIgnored: z.enum(['predates-plan']).optional()` on `BranchSchema`, and the board client, which casts the payload, gains the same optional fields.

**Auto-delivery waits for the host, and that is what keeps it from sticking.** Without that skip, a subject-proven Bitbucket plan reads `merged` during a 429; the first tick starts `plot-deliver.sh`, which refuses; `pruneDelivering` (`auto-deliver.ts:311-332`) keeps the slug in `inFlight` while the plan reads approved and merged, and the refusal path (`:401-406`) does not remove it, so no later tick delivers until the board restarts. The round-2 skeptic executed this: tick 1 started the delivery, and four later ticks over the same pulse started none. With the skip, no tick starts a delivery on subject evidence, nothing enters `inFlight`, and the first tick after the host confirms the merge delivers.

**The gate is the auto-deliver tick test.** It builds every pulse by parsing scan JSON through `FleetReadingSchema`, never as a typed literal, so a field the schema strips fails the test. It runs `planAutoDeliver` and `maybeAutoDeliver` over a pulse in which a plan's only branch reads `merged` with `evidence: "subject"`: no delivery starts. A second pulse, the host having confirmed the merge, drops the field: the next tick starts the delivery. A third case keeps `inFlight` empty across five subject-only ticks. A Deliver-control test over the first pulse asserts that `deliver.ts` does not read the plan deliverable.

**An import test guards the rule's callers.** It is not the boundary's gate, because the subject reaches delivery as pulse data and not as an import. It lives in `packages/board/test/unit/`, reads files under `packages/*/src/` only, and matches identifiers, not module paths: `mergedBySubject`, `ownerOfRemote`, `subjectProven` and `mergeSubjects` appear only in the bundle entry, `entry/registryd-main.ts`, `queue-reading.ts`, the refs port and its adapters, and the host adapter's forms file. `packages/board/src/server/controllers/deliverability.ts`, `rules/landed.ts` and `auto-deliver.ts` contain none of them. Test files and `packages/domain/corpus/` are outside its scope, so the rule tests and the corpus call pass.

**The board row.** A slice the subject proved reads `merged` in the scan. `fleet.ts:5099-5106` puts it in DONE with the note `merged`, or `merged — slice still open`. Its PR column is empty, because the PR row comes from the host's listing, which the throttle refused. The plan adds no source label; slice 1's fixture asserts this row through `/api/fleet`.

**CLAUDE.md, "One Answer To 'Did This Land'", states its real scope.** Destructive decisions read the host's `mergedAt`. The wave gate also takes a host-written merge subject on the default branch, not contained in the commit that added the plan, as positive evidence for a branch with no ref. That has been true for GitHub since 2026-08-16 and the section does not say so.

**A Concept file, `docs/domain/merge-subject.md`,** names the term, the three placeholders, the age rule with its two limits, and the boundary above, in the format of `docs/domain/desk-root.md`.

**The corpus copy becomes a call.** `packages/domain/corpus/branch-state.corpus.test.ts:226-230` holds a third copy of the GitHub regex, any owner. Slice 1 replaces it with `mergedBySubject` and the adapter's forms.

### Open Points

- [ ] Bitbucket's squash strategy is not used on `ewz-kus-portal` (0 `Merged in` subjects on one-parent commits against 1723 on merges). An estate that squashes would lose the proof to `--merges` and fall through to the host. This plan does not drop `--merges`.
- [ ] Out of scope, to be filed as its own issue: `claimedBranches`' `{'*'}` sentinel is read by nothing in `packages/` (`git grep "has('\*')"` has no hit), so the comment "AN UNREADABLE REF LIST QUEUES NOTHING" at `registryd-main.ts:556` does not hold today. This plan only refuses to apply its proof under that sentinel.
- [ ] Out of scope: a host-free answer for an unstarted branch under 429 belongs to #1094.
- [ ] `plot-reconcile-scan.sh` §22 reads the GitHub form to find a PR number (`:2795`, `:2836`). It reports and gates nothing, so it stays out of this plan.

## Slices

### The merge subject is one rule (Branch: bug/the-merge-subject-is-one-rule, PR: #1159)

`rules/merge-subject.ts` and `rules/remote-owner.ts` with tests at 100% branch coverage, outside the domain barrel; `adapters/host/merge-subjects.ts` as data with its subpath export; the `plot-merge-subject.mjs` bundle with its `packages/board/build.mjs` entry, its `.gitattributes` line, and a CLAUDE.md Helper Scripts row; the scan's batched walks after plan parsing (adding commits, merges with hashes, ancestry per matched pair with its declaration), the lookup keyed by plan and branch, the host question kept only for a delivery candidate and only under `HOST_VERDICT` `ok` or `partial`, the `evidence` and `subjectIgnored` fields declared on `BranchSchema` and the board client, the `subject_predates_plan` footer counter, and the removal of both shell regexes; the `unaskable` footer word and the corrected `skills/plot-pulse/SKILL.md`; `allSlicesConfirmed` in `rules/deliverable.ts` at 100% branch coverage, called by `planAutoDeliver` and by `deliver.ts:230`, with tick tests that parse scan JSON and a Deliver-control test; the import test; the corpus copy replaced; the Concept file and the CLAUDE.md amendment. Fixture tests through the scan: both forms, a backward merge, a fork owner, an owner in other case, a prefix-sharing branch name, a local-path origin, a reused name whose merge predates its plan (reads `open`, footer counts it), a plan read through a `delivered/` symlink that moved after its first slice merged (the slice still reads `merged`), a plan drafted on its own branch with a reused name merged in that window (reads `merged`, the stated limit), a renamed plan (keeps the first add's age), a rename chain with no `A` line in the walk (the branch goes to the host), a delivery candidate with the listing refused by 429 (the host log holds no `pr-state` for it and the branch keeps `evidence: "subject"`), and two plans where the later one reuses the earlier one's merged name (only the earlier reads `merged`). A Bitbucket fixture with the first slice's ref deleted and every PR question refused with 429 asserts that the first slice reads `merged`, the host log holds no question about it, `--list-eligible` names nothing for the unstarted next slice, and `/api/fleet` shows the first slice in DONE with note `merged` and no PR. <!-- builds: mergedBySubject, ownerOfRemote, the merge-subject rule and its bundle -->

### The queue reads the merge subject (Branch: bug/the-queue-reads-the-merge-subject, PR: #1172)

`planAdditions`, `mergeSubjects` and `contains` on the refs port with their git and fixture adapters; `QueueWorld.subjectProven(plans, claimed)` and its `queueWorldForRepo` wiring; the per-plan proof before `landedWithoutListing` and `queueOfPlan`; the skip under the `{'*'}` sentinel. Queue tests with the listing **and** `queuedHasLanded` refusing with 429: the proven predecessor spends no host call and no index lookup, and the next slice is held on `merge-unknown` about its own branch; with `queuedHasLanded` answering `not-landed`, the next slice is handed out. A test with `claimedBranches` answering `{'*'}` and a subject naming an in-flight branch applies no proof. A test with a subject older than the plan applies no proof. A two-plan test: a delivered plan's merged name reused by a later plan settles only the delivered plan. A test with a branch that carries a ref and has a matching subject: it is not reported proven and still gets its own `queuedHasLanded` question. A test with `planAdditions` failing: every plan gets no subjects. <!-- builds: planAdditions, mergeSubjects, subjectProven, a refs-port reading of merge subjects -->

## Notes

Filed from a Bitbucket estate on 2026-10-01. A juror answered `amend` the same day and scoped the change to the scan; reading the code for this plan found that the measured hold is the supervisor's, which reads no subject at all, so the second slice is added. Round 1 (three jurors, unanimous amend) found that the next slice stays held on its own host question, that the reused-name and `{'*'}` cases reach the queue, that delivery reads the subject-derived state, and that a third copy of the rule lives in the corpus tier. Round 2 (three jurors, unanimous amend) found that the per-plan walk cost seconds, that the symlink path lost a delivered plan's subjects, that a global union undid the age rule, that the supervisor had no operation for the adding commit, that the import gate could not be built, and that auto-delivery stuck on a refused delivery; this text carries those answers. Round 3 (one agent, three lenses, unanimous amend) found that `BranchSchema` strips the `evidence` field before auto-delivery reads it, that the confirmation reading belonged in the domain, that the candidate question spent host calls during a throttle, that the walk lost a renamed plan, and that the Deliver control read subject evidence as deliverable; the correction after round 3 carries those answers. Related: #1094, #1143 (number lookups under a refused listing), #1140.
