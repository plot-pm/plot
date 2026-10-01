## Implementation brief — a-merge-subject-proves-a-landing-the-host-cannot (wave 1: The merge subject is one rule)

- **Plan (canonical):** `docs/plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md` on `main` (corrected at `98a88a37` and `e512084a`)
- **Issue:** #1139
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-merge-subject-is-one-rule` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

Wave 2, `bug/the-queue-reads-the-merge-subject`, waits on this branch and gives the supervisor the same reading. **Do not touch `queue-reading.ts`, `entry/registryd-main.ts` or the refs port here.**

### What to build

The plan's sections **Approach**, **The age rule**, **The scan** and **The boundary** are the specification. This slice owns:

1. **Two vendor-free rules**, outside the domain barrel (`packages/domain/src/index.ts`), imported by subpath as `entry/branch-state.ts:24-27` does: `rules/merge-subject.ts` (`mergedBySubject({ subjects, branches, forms, owner })`, whole-line match, branch literal, owner literal without case, number as digits, `owner: null` matches any) and `rules/remote-owner.ts` (`ownerOfRemote(url)` for https, `ssh://` and `git@<alias>:` URLs, lowercased; `null` for a local path or any other shape). 100% branch coverage.
2. **The forms as data** in `adapters/host/merge-subjects.ts` (`github`: `Merge pull request #<number> from <owner>/<branch>`; `bitbucket`: `Merged in <branch> (pull request #<number>)`; any other: none), plus a `./adapters/host/*` subpath export in `packages/domain/package.json`.
3. **The bundle** `skills/plot/scripts/board/plot-merge-subject.mjs`: its `packages/board/build.mjs` entry, `.gitattributes` `-merge` line, committed artifact, and a CLAUDE.md Helper Scripts row. Asked twice per scan with sectioned stdin (backend, origin URL, `<hash> <subject>` merges, one section per plan); the scan runs one ancestry test per matched pair between the two calls.
4. **The scan** (`plot-fleet-scan.sh`), after plan parsing: one `git log origin/<main> --diff-filter=AR --name-status --format=@%H -- <plan dir>` (follow each `R` to its original `A`), the existing merges walk now with `%H %s`, and `git merge-base --is-ancestor <merge> <added>` only per matched pair, carrying the `# plot-ancestry: evidence — …` line the plan quotes. The proof is keyed by plan **and** branch. `merged_by_subject` becomes a lookup of the pair in the no-ref arm. Remove both shell regexes (`:492`, `:2183-2186`). The host question for a proven branch only for a delivery candidate, and only when `HOST_VERDICT` is `ok` or `partial`. Footer: `subject_predates_plan=<n>`, `merge_detect=unaskable` when the bundle cannot answer; branch JSON: `evidence: "subject"` until the host confirms, `subjectIgnored: "predates-plan"`.
5. **The entity:** `evidence: z.enum(['subject']).optional()` and `subjectIgnored: z.enum(['predates-plan']).optional()` on `BranchSchema` (`packages/domain/src/entities/fleet.ts:174`), and the same optional fields on the board client's types.
6. **`allSlicesConfirmed(meta, pulse, complete)`** in `rules/deliverable.ts` beside `allSlicesMerged` (`:62`): as `allSlicesMerged`, except a non-deferred branch with `evidence: "subject"` makes the answer `unknown`. `planAutoDeliver` (`auto-deliver.ts:273` today calls `allSlicesMerged`) and the board's Deliver verdict (`deliver.ts:230`) call it.
7. **The rest:** the import test in `packages/board/test/unit/` (identifiers, files under `packages/*/src/` only), the corpus copy at `packages/domain/corpus/branch-state.corpus.test.ts:226-230` replaced by `mergedBySubject`, `skills/plot-pulse/SKILL.md` (`:176` lists `unaskable`; correct `:188-191`), the Concept file `docs/domain/merge-subject.md` in the format of `docs/domain/desk-root.md`, and the CLAUDE.md "One Answer To 'Did This Land'" amendment.

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `plot-fleet-scan.sh` | 492 | `MERGE_DETECT`, the GitHub-only regex |
| `plot-fleet-scan.sh` | 2183 | `merged_by_subject() { # $1=branch …` |
| `plot-fleet-scan.sh` | 3319 | `branch_readings() { # $1=branch $2=deferred …` |
| `plot-fleet-scan.sh` | 3353 | `merged_by_subject "$br" && _bs_subject=true` |
| `rules/branch-state.ts` | 189 | `if (readings.mergeSubjectFound) return 'merged';` |
| `entities/fleet.ts` | 174 | `export const BranchSchema = z.object({` |
| `rules/deliverable.ts` | 62 | `export const allSlicesMerged = (` |
| `packages/board/src/server/deliver.ts` | 230 | `switch (allSlicesMerged(meta, …))` |
| `packages/board/src/server/auto-deliver.ts` | 273 | `if (allSlicesMerged(joinKey(plan.file), pulse, complete) !== 'merged') continue;` |
| `corpus/branch-state.corpus.test.ts` | 226-230 | the third copy of the GitHub regex |

### Tests (from the plan's slice 1 paragraph)

Rule tests at 100% branch coverage for both rules and `allSlicesConfirmed`. Fixture tests through the scan: both forms; a backward merge; a fork owner; an owner in other case; a prefix-sharing branch name; a local-path origin; a reused name whose merge predates its plan (reads `open`, footer counts it); a plan read through a `delivered/` symlink that moved after its first slice merged (still `merged`); a plan drafted on its own branch with a reused name merged in that window (reads `merged`, the stated limit); a renamed plan (keeps the first add's age); a rename chain with no `A` line (the branch goes to the host); a delivery candidate with the listing refused by 429 (no `pr-state` in the host log, `evidence: "subject"` kept); two plans where the later reuses the earlier's merged name (only the earlier reads `merged`). The Bitbucket fixture: first slice's ref deleted, every PR question refused with 429 — the first slice reads `merged`, the host log holds no question about it, `--list-eligible` names nothing for the unstarted next slice, and `/api/fleet` shows the first slice in DONE with note `merged` and no PR. Auto-deliver tick tests that **parse scan JSON through `FleetReadingSchema`**, never typed literals: no delivery on a subject-only plan; the next tick after the host confirms delivers; `inFlight` stays empty across five subject-only ticks. A Deliver-control test: `deliver.ts` does not read the plan deliverable.

### Panel caveats a worker trips on

- **A typed-literal pulse hides the stripped field.** `BranchSchema` is a plain `z.object`; a field it does not declare is dropped on parse, and a test that builds its pulse as a literal stays green while the skip never fires (round 3, blocking). Parse JSON in the tick tests.
- **No per-plan git call.** The per-plan lookup cost 5.23 s for 140 plans; the batched walk costs 0.10 s. Read the dated file under the plan directory, never the `active/`/`delivered/` symlink, and on `origin/<main>`, never `HEAD`.
- **No host spend during a throttle.** The candidate question runs only under `HOST_VERDICT` `ok`/`partial` (`plot-fleet-scan.sh:897-905` sets it; vocabulary at `:100`, `:660-689`).
- **GitHub loses the proof while the bundle cannot answer**, because the shell regex is removed. That is stated in the plan; do not keep the regex as a fallback.
- **The vendor gate** refuses `github`/`bitbucket` in `packages/domain/src` outside `adapters/`; the backend word stays in the adapter and the scan.
- **`check-ancestry-decisions.sh`** fails CI on an undeclared `--is-ancestor` call; the declaration line goes within five lines above it.

### Gates

`nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and the domain coverage run. **Do not run `pnpm run test:e2e`.** `test/reconcile/fleet.test.mjs` needs a ten-minute timeout; `test/reconcile/fleet.test.mjs:845-900` (bare local origin) must stay green.

### Rules that bite this slice

- Domain first; no new `plot-*.sh` script; the shell only reads git.
- New functions are arrow functions; TSDoc says what, not why.
- A changeset, description first and the `bumps:` block last.
- The controller-gate hook blocks any Bash command that names `plot-dispatch.sh`.
- Use `trash`, never `rm`. Never `git stash`.
