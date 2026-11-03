# Testability juror: plot-approve finds no plan on an open Bitbucket PR

Position: amend

## Findings

### 1. An existing test pins the defect, and the plan does not name it

`test/reconcile/host.test.mjs:1034-1042` (`host: pr-list bitbucket flattens to number/title/state/head`) runs the plain Bitbucket arm against the `makeStubs` `bb` stub and asserts with `deepEqual` that the row is exactly `{ number, title, state, head, author }`. Its fixture row carries no `source.commit`. After the change this test fails twice over: the row gains `headSha` (and `""` for this fixture, so `deepEqual` breaks), and the fixture cannot prove the new field because it has no hash to emit. The plan says "add the contract tests" and never says that this test must change. An unattended agent that sees it go red has two moves, and only one is right: update the fixture to carry `source.commit.hash` and assert `headSha` equals it.

No other test pins the plain shape: `host.test.mjs:1713` (`--state all`) asserts only `state` and `number`, so it stays green.

### 2. A stubbed `bb` can return the plain arm's payload, so the host-side test is cheap and fails before the change

`makeStubs({ bbJson })` (`host.test.mjs:69-128`) answers any `bb api …/pullrequests?state=` call with `{"values": <bbJson>}`. A fixture row `{"id":3,…,"source":{"branch":{"name":"idea/x"},"commit":{"hash":"0123456789ab"}},"draft":true}` reaches the plain jq at `plot-host.sh:4979-4981` (origin/main) unchanged. Asserting `row.headSha === '0123456789ab'` fails on main today (the jq drops the field) and passes after. That part of the test plan is sound.

### 3. The plain arm also drops `draft`, and that hides a second failure behind the first

The plain arm emits no `draft` field (`plot-host.sh:4979-4981`). `prOf` in `packages/domain/src/adapters/host/host-shell.ts:108` reads an absent `draft` as `false`. `openPrsOf` copies `pr.draft` into the found PR (`packages/board/src/server/entry/approve.ts:359`), and the approve path calls `pr-ready` only when `pr.draft` is true (`approve.ts:1068-1072`). So after the plan's change a draft plan PR found through the open-PR lookup reads as not-draft, `pr-ready` never runs, and the approve goes straight to `pr-merge` on a draft PR. The plan's changelog line promises "and take that PR out of draft", which this path cannot do. The plan's contract test names only `head` and `headSha`; it must name `draft` too. The `pr-ready` correction is reachable today only through `readPlanPr` (`approve.ts:262-276`, which reads `prState` and so gets `draft` from `bb_state_row`), not through the path this issue is about.

### 4. The `pr-ready` test can only prove the argv, not that `bb` accepts it

No test covers `pr-ready` on any backend today (`grep -n pr-ready test/reconcile/host.test.mjs` finds none). The existing `pr-close` test at `host.test.mjs:1106-1113` is the model: record argv and assert `['pr','edit','4','--ready']`. That test fails before the change (argv is `['pr','update','4','--ready']`) and passes after. It proves the call shape the author chose; it cannot prove `bb` accepts it, because the stub accepts anything. I ran `bb pr edit --help` on the installed `bb 1.12.1`: it lists `--ready`. `bb pr update --help` answers `unknown pr command: update`. So the plan's cause is confirmed on this machine; open question 4 (older `bb` versions) stays a person's or a measurement's question, not a test's.

### 5. The approve controller's open-PR lookup has no unit test with a successful listing

`packages/board/test/unit/approve.test.ts` (362 lines) drives `openPrsOf` only with a refusing `prList` (`:242-316`, the default-branch-checkout shape). No test drives a listing that answers with a row and finds the plan on that row's head. The fixtures to write one exist: `hostFixture({ prs })`, `refsFixture({ shas, changedFiles, files })` and the `ctxDefaultBranch` shape at `:291`. The plan does not name this test, and it is the test that proves the issue's symptom is gone at the controller.

Two limits a reader must know:

- `refsFixture.resolve` and `changedFiles` key by exact string (`packages/domain/src/adapters/refs/refs-fixture.ts:300-303, 323`). A fixture test with a 12-character `headSha` passes whatever the length, so it cannot answer open question 1. The real answer comes from git: I ran `git rev-parse <12-hex>^{commit}` and `git diff --name-only origin/main...<12-hex>` on this repo; both accept an abbreviated sha. `refs-git.ts:498-507` passes the value straight into `git diff`, so a short sha works where it is unambiguous. If the plan wants that pinned, the place is `packages/domain/test/refs-git-reads.test.ts` against a real repository, not the controller test.
- A unit test with a row carrying NO `headSha` fails before the change only if it asserts something other than `plan-not-found`, because main already answers `plan-not-found` for that row. The plan must choose the behaviour first (finding 6).

### 6. Open question 2 contradicts a documented invariant, and blocks a test

`approve.ts:332-339` says a PR whose head commit git cannot resolve "is never read at `origin/<head>`, which may not be the commit the merge would be pinned to". The plan's second bullet offers exactly that fallback. A test cannot be written until a person picks one answer. My recommendation: no fallback; emit `headSha` on every arm and keep the skip, because the merge is pinned to `headSha` (`approve.ts:1081-1084`) and a row without one cannot be merged pinned anyway.

### 7. The same filter lives in `needs-design.ts`

`packages/board/src/server/entry/needs-design.ts:186` holds the identical `(pr.headSha ?? '') !== ''` filter. The host-side fix repairs it too, but no test in the plan says so. One line in the plan (fixed by the same host change; no separate test) is enough.

## Amendments required

1. Name `test/reconcile/host.test.mjs:1034` and say it changes: the fixture row gains `source.commit.hash` and `draft`, and the assertion adds `headSha` and `draft`. Forbid deleting the `deepEqual`.
2. Emit `draft:(.draft // false)` on the plain Bitbucket arm as well as `headSha`, and make the contract test cover `head`, `headSha` and `draft` on the plain arm of both backends. Without `draft`, the changelog line about taking the PR out of draft is false on the path this plan fixes.
3. Add a `pr-ready` test modelled on `host.test.mjs:1106`, asserting `bb` argv `['pr','edit','<n>','--ready']`, and state in the plan that the installed-`bb` check was `bb pr edit --help` (1.12.1 lists `--ready`).
4. Add a unit test in `packages/board/test/unit/approve.test.ts` in the default-branch-checkout shape: `prList` answers one OPEN row with `head: 'idea/<slug>'`, a 12-hex `headSha` and `draft: true`; `refsFixture` resolves `<sha>^{commit}` and lists the plan file in `changedFiles[<sha>]` and `files`. Assert the plan is found, `pr-ready` is called, and `pr-merge` carries `--match-head <sha>`. This test fails on main only once the host change is in; as a controller test it holds the `draft` propagation and the pinned merge.
5. Close open question 2 as "no fallback to `origin/<head>`", citing `approve.ts:332-339`, and drop the fallback from the Approach and the slice line.
6. Close open question 1 with the measurement above (git accepts an unambiguous abbreviated sha); if a test is wanted, put it in `refs-git-reads.test.ts`.

## Decisions that need a person

- Open question 2 (fallback or not), if the person disagrees with amendment 5.
- Open question 4 (minimum `bb` version for `pr edit --ready`): a person names the floor, or the plan accepts the CLI's own error as the refusal, which `plot-host.sh:4459-4463` already documents.

## What I ran versus what I only read

Ran: `git show origin/main:` reads of `plot-host.sh`, `approve.ts`, `needs-design.ts`, `host-shell.ts`, `refs-git.ts`, `refs-fixture.ts`, `host.test.mjs`, `approve.test.ts`; `git grep` for callers; `gh issue view 3089`; `bb --version`, `bb pr edit --help`, `bb pr update --help` (read-only); `git rev-parse <12-hex>^{commit}` and `git diff --name-only origin/main...<12-hex>` on this repository.

Only read: that the `host.test.mjs:1034` test fails after the change (inferred from its `deepEqual`, not run); that Bitbucket refuses to merge a draft PR (not checked against the host); that `commitStatus` accepts a 12-character sha on Bitbucket (the same-branch path already passes `bb_state_row`'s short hash to it, so it is existing behaviour, not new). No test suite ran.
