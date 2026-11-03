# Layering juror: plot-approve finds no plan on an open Bitbucket PR

Position: amend

## Summary

The plan puts both fixes in the right layer: the missing field and the wrong `bb` subcommand are adapter defects in `plot-host.sh`, and the plan changes them there. Two of its open questions are already answered by the code, and the answers keep every git call inside the refs adapter. The `origin/<head>` fallback contradicts a decision the controller documents, and the plan should drop it. The plan also misses a second field (`draft`) on the same arm, a duplicate of the lookup in `needs-design.ts`, and one existing test that breaks.

## Findings

1. **The adapter is the right place for the field fix.** The plain Bitbucket arm emits `{number,title,state,head,author}` (`plot-host.sh:4976-4978` on origin/main). The no-Jenkins rich arm emits `headSha:(.source.commit.hash // "")` (`plot-host.sh:4974`). `prOf` in `packages/domain/src/adapters/host/host-shell.ts:115` copies `headSha` only when present. The controller asks `ctx.host.prList('open', PRS_LISTED)` with no `rich` (`packages/board/src/server/entry/approve.ts:342`), so it reaches the plain arm. Adding the field in `plot-host.sh` keeps `plot-host.sh` the one place that reaches `bb`, and the port and the controller do not change. Confirmed.

2. **`pr-ready` is an adapter defect, and the fix also reaches the fleet.** `plot-host.sh:4466-4467` runs `bb pr update "$num" --ready`. Installed `bb --help` lists `pr edit <id> ... --ready/--draft` and no `pr update` (ran). The same `pr-ready` op serves `host-shell.ts:383` (`prReady` port), `perform-fs.ts:56` and `agent-loop.ts:444`, so the agent loop's mark-ready on Bitbucket fails today too. The plan names only the approve path; it should say the fix also serves the agent loop, so the test covers the op and not one caller.

3. **Open question 1 is answered: no new git call and no new port operation are needed.** `refs.changedFiles` runs `git diff --name-only origin/<main>...<branch>` and passes `branch` through unchanged (`packages/domain/src/adapters/refs/refs-git.ts:498-506`); git accepts an unambiguous short sha there. `holdsCommit` already calls `ctx.refs.resolve(`${sha}^{commit}`)` (`approve.ts:320-321`), and `resolve` is `git rev-parse <ref>` (`refs-git.ts:475-476`), which returns the full object id. So the short-to-full resolution already lives in the refs adapter. The controller only discards the answer. The fix is to keep the value `resolve` returns and carry the full sha in `OpenPr.headSha`. That removes any doubt about a short sha at the downstream sinks: `--match-head` (Bitbucket arm prefix-matches, `plot-host.sh:4445`), `readPlanAt` and `writeApprovalStatus` (`approve.ts:88-91`, whose Bitbucket status endpoint I did not check against a short hash).

4. **The `origin/<head>` fallback contradicts the controller's own documented decision.** The doc comment on `openPrsOf` says a PR whose head commit git cannot resolve "is skipped: it is never read at `origin/<head>`, which may not be the commit the merge would be pinned to" (`approve.ts:336-337`). The open path's sha later becomes the merge pin (`approve.ts:941`, `:1084`). A fallback through `ctx.refs.resolve('origin/<head>')` would stay inside the adapter, so it is not a layering violation, but it pins the merge to a ref the host did not name. Once every Bitbucket arm emits `headSha`, a row with no sha means the host gave none. The right answer is a named skip, not a substitute pin.

5. **The plain arm also lacks `draft`, and the open path decides `pr-ready` from it.** `prOf` defaults `draft` to `false` (`host-shell.ts:108`). The open path carries `pr.draft` into `found.draft` (`approve.ts:359`, `:941`), and `approve.ts:1068` calls `pr-ready` only when `draft` is true. After the `headSha` fix, a draft Bitbucket plan PR found on the open path reads as not draft, `pr-ready` never runs, and the controller merges a draft PR. The issue's second finding came from the worktree run (named path through `pr-view`), so this gap is not yet observed, but it is in the code path the plan opens. The plan's contract test names `head` and `headSha` only.

6. **The lookup is duplicated.** `packages/board/src/server/entry/needs-design.ts:180-200` holds a copy of `openPrsOf` with the same `headSha` filter and the same `holdsCommit`/`changedFiles` steps. The `plot-host.sh` fix repairs both. Any change to the lookup itself (full-sha capture, named skip) made only in `approve.ts` makes the two copies drift. The plan's "the lookup stays in the approve controller" names one copy.

7. **The controller bypasses the `prReady` port.** `approve.ts:1069` calls `ctx.scripts.host(['pr-ready', ...])` while the host port declares `prReady(pr)` (`packages/domain/src/ports/host.ts:236`) and `host-shell.ts:383` implements it. This is existing debt and not in the plan's scope; it does not block. It means the `pr-ready` contract test must run `plot-host.sh` itself, since a test through the port would miss the controller's route.

8. **An existing test asserts the exact plain shape and breaks.** `test/reconcile/host.test.mjs:1033-1042` (`host: pr-list bitbucket flattens to number/title/state/head`) uses `assert.deepEqual` against `{number,title,state,head,author}`. Adding `headSha` (and `draft`) fails it. The plan does not name it. Its stub payload carries no `source.commit.hash`, so the updated assertion should also add one to prove the field is read.

9. **The layering statement in the plan is true.** No new script, no new `gh`/`bb` caller, no spawn outside an adapter. `scripts/check-host-cli-callers.sh` is unaffected.

## Amendments required

1. Close open question 1 in the plan: `openPrsOf` keeps the full sha that `ctx.refs.resolve(`${sha}^{commit}`)` returns and stores it as `OpenPr.headSha`. No new port operation and no new git call.
2. Drop the `origin/<head>` fallback (open question 2), citing `approve.ts:336-337`. Replace it with a named skip: when the open-PR list drops a row for a missing or unresolvable `headSha`, the `plan-not-found` refusal names each dropped PR number and the reason, so a silent drop becomes a visible one.
3. Emit `draft:(.draft // false)` on the plain Bitbucket `pr-list` arm with `headSha`, and make the contract test require `head`, `headSha` and `draft` on every backend's plain row.
4. Apply the lookup change to `needs-design.ts:180-200` as well, or lift `openPrsOf` into one shared board-side reader that both controllers call. Name the choice in the slice.
5. Name `test/reconcile/host.test.mjs:1033-1042` as a test to update, with a stub payload that carries `source.commit.hash` and `draft`.
6. State that `pr-ready` serves the agent loop (`agent-loop.ts:444` via `perform-fs.ts`) and the `prReady` port, and test the op through `plot-host.sh` with a stubbed `bb` asserting argv `pr edit <n> --ready`.

## Decisions for a person

- Open question 4 (older `bb` versions without `pr edit --ready`): whether Plot supports such versions at all is a support-policy decision. An agent can only report the installed version.

## What I ran versus read

Ran: `gh issue view 3089`; `git show origin/main:` of `approve.ts`, `needs-design.ts`, `host-shell.ts`, `refs-git.ts`, `ports/host.ts`, `plot-host.sh`, `test/reconcile/host.test.mjs`; `git grep` for `headSha`, `pr-ready`, `prList`, `changedFiles`; `bb --help` and `bb pr --help`. Read only, not run: no test suite, no host write, no `plot-host.sh` call. I did not check whether Bitbucket's commit-status endpoint accepts a short hash.
