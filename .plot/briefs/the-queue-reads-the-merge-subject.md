## Implementation brief — a-merge-subject-proves-a-landing-the-host-cannot (wave 2: The queue reads the merge subject)

- **Plan (canonical):** `docs/plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md` on `main` (corrected at `98a88a37` and `e512084a`)
- **Issue:** #1139
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-queue-reads-the-merge-subject` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

**This slice waits on wave 1, `bug/the-merge-subject-is-one-rule`.** It needs that slice's `mergedBySubject`, `ownerOfRemote` and the host adapter's forms. Start only after wave 1 has merged to `main`, and rebase onto `main` before you open the PR. **The measured #1139 hold is the supervisor's**, so this slice is the one that releases it.

### What to build

The plan's section **The supervisor** is the specification.

1. **Three refs-port operations**, each with a git adapter and a fixture adapter:
   - `planAdditions(ref, dir)`: a map from each file under `dir` to the commit that first added it, from one `git log <ref> --diff-filter=AR --name-status --format=@%H -- <dir>`, following each `R` to its original `A`. On failure it answers an error, and every plan gets no subjects.
   - `mergeSubjects(ref, max)`: `{ sha, subject }` for the merges on `ref`, from one `git log <ref> --merges --max-count=<max> --format='%H %s'`. `commitsSync` runs `--no-merges` (`refs-git.ts:380`) and cannot serve. On failure every plan gets no subjects.
   - `contains(ancestor, descendant)`: `yes`, `no` or `unknown`, with the `plot-ancestry: evidence` line in its git adapter. `unknown` proves nothing.
2. **`QueueWorld.subjectProven(plans, claimed)`**: a map from plan to the branches the rule proves for it, or `null` when it cannot ask. It **drops every name in `claimed`**, so a ref-carrying branch keeps its own `queuedHasLanded` question. `queue-reading.ts` receives sets of branches and never a backend word (a vendor word there falls outside the vendor gate's root). The owner comes from `refs.remoteUrl` (`ports/refs.ts:339`) through `ownerOfRemote`.
3. **Wire it in `queueWorldForRepo`** (`entry/registryd-main.ts:528`).
4. **Apply the proof per plan**: `landedWithoutListing` (`queue-reading.ts:241`) and `queueOfPlan` (`:245`) take `merged ∪ proven(plan)` for each plan, never one union across plans.
5. **Skip under the sentinel**: `claimedBranches` answers `new Set(['*'])` on failure (`registryd-main.ts:556-560`), and `'*'` excludes no branch. With that sentinel, apply no proof.

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `packages/board/src/server/queue-reading.ts` | 237 | `const listing = await world.mergedBranches();` |
| `queue-reading.ts` | 241 | `landedWithoutListing(plans, claimed, merged, world)` |
| `queue-reading.ts` | 245 | `queueOfPlan(plan, claimed, merged)` |
| `queue-reading.ts` | 253-256 | `queuedHasLanded` for the next slice |
| `packages/board/src/server/entry/registryd-main.ts` | 528 | `export const queueWorldForRepo = (` |
| `registryd-main.ts` | 556-560 | the "AN UNREADABLE REF LIST QUEUES NOTHING" comment and `return new Set(['*'])` |
| `packages/domain/src/ports/refs.ts` | 339 | `remoteUrl(remote: string)` |
| `refs-git.ts` | 380 | `commitsSync`'s `--no-merges` walk |

### Tests (from the plan's slice 2 paragraph)

Queue tests with the listing **and** `queuedHasLanded` refusing with 429: the proven predecessor spends no host call and no index lookup, and the next slice is held on `merge-unknown` about its own branch; with `queuedHasLanded` answering `not-landed`, the next slice is handed out. A test with `claimedBranches` answering `{'*'}` and a subject naming an in-flight branch applies no proof. A test with a subject older than the plan applies no proof. A two-plan test: a delivered plan's merged name reused by a later plan settles only the delivered plan. A branch that carries a ref and has a matching subject is not reported proven and still gets its own `queuedHasLanded` question. With `planAdditions` failing, every plan gets no subjects.

### Panel caveats a worker trips on

- **The next slice stays held under a full 429.** The plan says so: one per-branch host answer releases it; no host-free answer exists for an unstarted branch (that is #1094). Do not invent one; the PR index never says no.
- **A ref already settles a slice** (`queueOfPlan` settles on `claimed || merged`, `queue-reading.ts:144-145`), so a "refless only" restriction changes nothing; the claimed-name drop is what keeps the host question.
- **The `'*'` sentinel is read by nothing today** (Open Point, to be filed separately). This slice only refuses to apply its proof under it; do not fix the sentinel here.
- **The import test from wave 1** limits where `mergedBySubject`, `ownerOfRemote`, `subjectProven` and `mergeSubjects` may appear; keep the new code inside the allowed files.

### Gates

`nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`, and the domain coverage run. **Do not run `pnpm run test:e2e`.**

### Rules that bite this slice

- The layering rule: the supervisor reads git through the refs port and its adapter, never by spawning in `queue-reading.ts`.
- New functions are arrow functions; TSDoc says what, not why.
- A changeset, description first and the `bumps:` block last.
- Use `trash`, never `rm`. Never `git stash`.
