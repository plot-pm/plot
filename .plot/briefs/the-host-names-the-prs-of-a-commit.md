## Implementation brief — plot-approve-finds-a-plan-pr-at-any-age (wave 1: Host)

- **Plan (canonical):** `docs/plans/2026-11-21-plot-approve-finds-a-plan-pr-at-any-age.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3617 merged
- **Branch:** `bug/the-host-names-the-prs-of-a-commit` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/plot-approve-asks-the-pr-of-the-adding-merge`, waits on this branch, and wave 3 waits on wave 2. This branch changes no approve behaviour: it adds a host question and nothing asks it yet.

### What to build

A `Host` port operation, `prsOfCommit(sha)`, that answers the PRs the host associates with one commit as `readonly Pr[]`. Issue #3608: `plot-approve` finds a plan PR by listing the newest 100 merged PRs (`PRS_LISTED`, `packages/board/src/server/entry/open-prs.ts:5`). Measured 2026-11-21 on `templates-show-named-identifiers`, plan PR #3478 had 104 PRs merged after it and was not in the page, so `POST /api/approve` refused `no PR found for branch 'idea/templates-show-named-identifiers'`. `GET repos/plot-pm/plot/commits/0835e43b7…/pulls` answered #3478 in one call. This branch builds that call; wave 2 uses it.

Files, all under `packages/domain/`:

- `src/ports/host.ts` — declare `prsOfCommit(sha: string): Promise<PortResult<readonly Pr[]>>` next to `prConversation` (`:577`), with TSDoc for the parameter, the three answers and `lastRefusal`.
- `src/adapters/host/prs-of-commit.ts` (new) — `githubPrsOfCommit(api)`, `bitbucketPrsOfCommit(bitbucket)` and `hostWithPrsOfCommit(host, reader)`, on the pattern of `pr-conversation.ts` (`githubPrConversation` `:39`, `bitbucketPrConversation` `:100`, `hostWithConversation` `:154`): the reader carries its own `lastRefusal`, and the wrapper reports the reader's refusal after a `prsOfCommit` call and the host's after any other call.
- `src/adapters/host/host-reads.ts` — wrap both in-process compositions: Bitbucket (`:248-250`) and GitHub (`:259`). The shell transport returns the shell `Host` unwrapped (`:244`, `:256`) and stays that way.
- `src/adapters/host/host-shell.ts` — `prsOfCommit` answers `unaskable` with no call, beside `prConversation` (`:649-650`).
- `src/adapters/host/host-fixture.ts` — the fixture gains the operation, so every `Host` implementer type-checks.

### Decisions the plan settles — do not re-derive them

**By commit, in the port, and not a list filter.** `prList('merged', 100)` cannot name a PR older than its page, and raising the limit only moves the cliff. `Host.prMergeDests` (`ports/host.ts:426`) asks by head branch, which is the thing wave 2 does not know. The commit endpoint answers whatever the PR's age.

**GitHub reports a merged PR as `state: "closed"`.** Derive the state from `merged_at`: `closed` with a non-null `merged_at` is `MERGED` with `mergedAt` set, `closed` with `merged_at: null` is `CLOSED`, `open` is `OPEN`. A mapping that copies `state` makes every merged PR `CLOSED`, and wave 2's `MERGED` match then finds nothing — the same trap as `prHasLanded` (`entities/pr.ts`, *"What the host says; see `prHasLanded` for why this is not enough"*). `head` is `head.ref`, `headSha` is `head.sha`, `mergeCommit` is `merge_commit_sha`; `base`, `draft`, `url` and `author` come from the same row.

**Fields the endpoint does not carry take the absent values, never a guess.** Use what `plot-host.sh pr-list --rich-open` already emits for a terminal row: `mergeable: 'unknown'`, `checks: 'unknown'`, `review: ''`, `failingChecks: []`. These mean *not asked*. Do not read a second endpoint to fill them; wave 2 reads only `state`, `head`, `headSha` and `mergeCommit`.

**Bitbucket answers only once its commit links are indexed.** `GET /repositories/{ws}/{repo}/commit/{sha}/pullrequests` returns `MERGED` as its own state word, with `merge_commit.hash`. Both clients treat 2xx as `ok` (`github-api.ts:320`, `bitbucket-api.ts:259`), so an HTTP 202 arrives as a success with a body that holds no PRs, and an HTTP 404 arrives as `{ ok: false, refusal: { kind: 'failed' }, reply }` with `reply.status` set. Read `reply.status` for both: 202 and 404 each answer `unaskable` and name the reason; any other failure answers `failed` and leaves the refusal for `lastRefusal`. Mapping 202 to `[]` would read as *the host named no PR* — that is wave 2's `unnamed` and it would refuse a merge the host simply had not indexed yet.

**An empty array is an answer.** `[]` from a reachable host means the host associates no PR with that commit, and it is `answered([])`. A missing origin slug, a body that is not a list, or a refused request is `failed`, never `[]`. This is the repo's standing rule, *absent is not false*.

**No shell op, and no shell line.** Decided by the operator 2026-11-21: the shell `Host` answers `unaskable` and `plot-host.sh` gains no `pr-of-commit`. With no host credential wave 2 falls back to the newest-100 list and refuses by name. The HTTPS calls stay under `packages/domain/src/adapters/host/`, which `scripts/check-host-https-callers.sh` allows, so `scripts/check-shell-lines.sh` has nothing to offset.

**Do not move anything else in-process.** The approve entry's `prList`, merge and `plot/review` status write stay on the shell (plan Notes). This branch only adds the operation.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions (`export const f = (…) => …`) and factual TSDoc: what it does, the parameters, what it returns, how it fails. No decision history in comments; it goes in the commit message.
- A reader never rejects. A failed request returns `failed()` and sets `lastRefusal`; it does not throw.
- Never spawn from the domain outside `adapters/`; the reader reaches the host only through the injected client.

### Done when

The plan's `## Slices` line for this branch is the specification, and `Host.prsOfCommit` exists on the port with both readers composed in `hostReadsFor`. The tests, from the plan:

- `packages/domain/test/host-prs-of-commit.test.ts` (new) — GitHub asks `/repos/o/r/commits/<sha>/pulls` once; `closed` with `merged_at` maps to `MERGED` with `mergedAt`, `closed` with `merged_at: null` maps to `CLOSED`, and head, head sha, merge commit and base map; an empty array answers `[]`; an HTTP failure answers `failed`; Bitbucket asks `/repositories/w/r/commit/<sha>/pullrequests` and maps `merge_commit.hash`; a Bitbucket 202 and a Bitbucket 404 each answer `unaskable` and name the reason.
- `packages/domain/test/host-reads.test.ts` — on an in-process GitHub composition and an in-process Bitbucket composition, `prsOfCommit` asks the client; on the shell transport (`PLOT_HOST_TRANSPORT=shell`) it answers `unaskable`. This is the test that catches a composition that forgets the wrapper: `hostWithListing` copies every shell member (`host-reads.ts:126-132`), so without `hostWithPrsOfCommit` the call reaches the shell on every transport and the answer is `unaskable` even with a credential.
- `packages/domain/test/host-shell.test.ts` — the shell answers `unaskable` and spawns nothing.
- Assert the `closed` + `merged_at` mapping against a row whose `state` is `closed`: a test that feeds `state: "merged"` passes with the naive copy.

Plus: a changeset is not needed here — the plan's second slice carries it, and this branch changes no published behaviour. The repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file; if that changes, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/ports/host.ts`, `packages/domain/src/adapters/host/{prs-of-commit,host-reads,host-shell,host-fixture}.ts` and the three test files above.

It does not touch `packages/domain/src/rules/plan-pr.ts`, `packages/domain/src/workflows/approve.ts`, `packages/board/src/server/entry/{approve,open-prs,needs-design,interrogate}.ts` or `skills/plot-approve/SKILL.md`; those belong to `bug/plot-approve-asks-the-pr-of-the-adding-merge`, which waits on this branch. `bug/plot-approve-refuses-a-slice-on-the-plan-branch` owns the `slice-on-plan-branch` refusal and waits on that one. If you find something the plan did not anticipate, report it rather than improvising outside scope.
