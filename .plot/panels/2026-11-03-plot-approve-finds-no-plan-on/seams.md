# Seams juror: plot-approve-finds-no-plan-on

Position: amend

The diagnosis is correct and the fix sits at the right layer. All four open questions can be settled from the code and the installed `bb` now, and two seams the plan does not name change what the slice must do: the second filter in `needs-design.ts`, and the exact-equality comparison in `plan-pr.ts:241`.

## Findings

### F1. The two defects are real, as the plan states (true)

- `skills/plot/scripts/plot-host.sh` (origin/main) plain Bitbucket arm, near line 4985: `{number:.id,title:.title,state:…,head:.source.branch.name,author:(.author.nickname // "")}`. It has no `headSha`. Both rich arms emit `headSha:(.source.commit.hash // "")` (lines 4966, 4974).
- `packages/board/src/server/entry/approve.ts:347` filters `(pr.headSha ?? '') !== ''`. The plan names the bundle `board/plot-approve.mjs`. The source to edit is `approve.ts`, and the bundle is generated output.
- `plot-host.sh:4466-4467` runs `bb pr update "$num" --ready`. The installed `bb 1.12.1` answers `unknown pr command: update`.
- The `pr-merge --match-head` prefix-match claim is true (`plot-host.sh:4445` compares in both directions).

### F2. A second controller has the identical filter, and the plan does not name it

`packages/board/src/server/entry/needs-design.ts:182-196` repeats `openPrsOf` line for line: `prList('open', 100)`, the same `headSha` filter, `holdsCommit` and `changedFiles(headSha)`. `needs-design` therefore also misses an open-PR-only plan on Bitbucket. The adapter fix repairs both controllers. The plan must say so and test it, or a later "fix in the controller" moves only one of them.

### F3. The plain Bitbucket row lacks more than `headSha`

The GitHub plain arm (line 4824) emits `number,title,state,head,draft,url,updatedAt,headSha,mergedAt,author`. The Bitbucket plain arm emits five of those ten fields. `host-shell.ts:98-117` (`prOf`) defaults a missing `draft` to `false`. So once the open path admits Bitbucket rows, `OpenPr.draft` (`approve.ts:359`) reads `false` for a draft PR. The named path (`readPlanPr` → `pr-state`) carries the real `draft` flag and wins for an `idea/<slug>` PR. A batch PR found only through the open path, however, reaches `approve.ts:1068` with `draft: false`. It skips `pr-ready` and then tries to merge a draft PR. The same payload holds `.draft`, `.links.html.href`, `.updated_on` and `.state` (the rich arms already read them), so the fix costs no request and no shell line.

### F4. A short sha breaks the merged path's exact comparison

`packages/domain/src/rules/plan-pr.ts:241`: `readings.merged.find((pr) => pr.headSha === addition.secondParent)`. `secondParent` comes from `refs.resolve(\`${sha}^2\`)` (`approve.ts:396-398`), a 40-hex oid. With the change, the plain Bitbucket merged rows (`approve.ts:402-406`) carry a 12-hex hash, so the comparison still never matches. Today it compares `''`. This is no regression, but a reader of the plan will believe Bitbucket's merged-plan path now works, and it does not.

### F5. The `origin/<head>` fallback contradicts the controller's own contract

`approve.ts:333-338` says: "A PR from a fork, or whose head commit git cannot resolve after the fetch, is skipped: it is never read at `origin/<head>`, which may not be the commit the merge would be pinned to." The merge pins to `pr.headSha` (`approve.ts:1081-1084`). A fallback to `origin/<head>` would read a plan from one commit and merge another.

### F6. `pr-ready` has a second caller the plan does not name

`Host.prReady` (`host-shell.ts:382-383`) calls the same `plot-host.sh pr-ready`. The fleet agent loop emits it (`workflows/agent-loop.ts:444`, `fleet/src/server/entry/loop-writes.ts`) to take a finished slice's draft PR out of draft (#2587). On Bitbucket that write fails today and is only logged, so every Bitbucket slice PR stays in draft. The fix repairs it too, and that matters directly to the sprint's zero-interventions goal. The plan's Changelog and test should say so.

### F7. An existing test pins the defective shape

`test/reconcile/host.test.mjs:1034-1042`, `'host: pr-list bitbucket flattens to number/title/state/head'`, asserts `deepEqual(out, { number: 3, title: 'A', state: 'OPEN', head: 'feature/a', author: '' })`. This assertion fails after the change by design. The slice must rewrite it rather than treat the failure as a regression. Its stub payload carries no `source.commit.hash`, so the new contract test needs a payload that has one. No `pr-ready` test exists in `host.test.mjs` today.

### F8. Shell consumers are unaffected

`plot-impl-status.sh:205`, `plot-pr-merged.sh:141` and `plot-reconcile-scan.sh:563,764` select fields with `jq` (`.number`, `.head`, `.state`). An added field changes none of them. No TS consumer of the plain listing branches on the absence of `headSha`. `review-bypass.ts:55`, `plan-walk-branches.ts:333-334` and `registryd-main.ts:872` read no `headSha`.

### F9. Ratchet and bash 3.2 are clear

Both edits change text inside existing lines: one `jq` object literal, and `bb pr update` to `bb pr edit`. `scripts/check-shell-lines.sh` sees no net growth. `check-bash32-syntax.sh` sees no new syntax. Comments at `plot-host.sh:638` and `:4460-4463` say "depends on the bb CLI version". After the fix they should name `pr edit --ready`.

### F10. The sprint item is missing

The plan says `Sprint: follow-ups-2-30-1`. `docs/sprints/2026-W45-follow-ups-2-30-1.md` has no line for this slug, either on origin/main or on the idea branch (`git diff --stat origin/main...HEAD` lists only the plan file and its symlink).

## Open questions, settled from the code

1. **Does `changedFiles` accept a short sha?** Yes. `refs-git.ts:498-507` runs `git diff --name-only origin/<main>...<branch>`. `holdsCommit` runs `refs.resolve('<sha>^{commit}')` (`approve.ts:320-321`). Git accepts an unambiguous 12-hex prefix in both. F4 still requires a full oid, so the decision is to normalise (amendment A2).
2. **Fall back to `origin/<head>`?** No. F5 gives the controller's own reason. A row that still lacks `headSha` must lead to a named refusal (amendment A3), not a fallback.
3. **Does any consumer assume no `headSha`?** No production consumer does (F8). One test does (F7).
4. **Does `bb pr edit --ready` exist in older `bb`?** Every Quatico `bb` on this machine has it: 1.12.1 (`/opt/homebrew/bin/bb:1259`), 1.11.2 (plugin cache 3.17.1 `cli/bb`), and the 1.10.1 skill's `tests/pr-edit.test.ts:66`. None of them has `pr update`. The 1.10.1 skill (`SKILL.md:133`) names `bb pr edit <id> --ready` as the command and warns against invented subcommands. `git log -S'bb pr update'` shows that `8cfb641fc` introduced it with no measurement. craftamap `bb` (0.6.0) has neither command, and `bb_require_json` refuses it on `pr-list`. `pr-ready` does not call `bb_require_json`, so craftamap fails there with its own message, which is acceptable.

## Amendments required

- **A1.** Name the source files: `packages/board/src/server/entry/approve.ts` and `packages/board/src/server/entry/needs-design.ts`, not the bundle. State that the adapter fix repairs both controllers' open-PR lookups (F2).
- **A2.** Emit the GitHub plain arm's field set on the Bitbucket plain arm: `headSha`, `draft`, `url`, `updatedAt`, `mergedAt` (the `mergedAt` mapping as in the rich arm), and `base`. In `openPrsOf` (both controllers), store the full oid that `refs.resolve` returns, not the listed short hash. Either do the same for the merged listing before `planPrOf` compares at `plan-pr.ts:241`, or state in the plan that the merged path on Bitbucket stays out of scope, and file it as an issue.
- **A3.** Remove the open question about the `origin/<head>` fallback, and replace it with a decision. A listed open row with an empty `headSha` is counted. When the lookup then finds no plan, the `plan-not-found` refusal names how many open PRs it skipped for a missing head commit, so the defect cannot hide in the same message again.
- **A4.** Name the fleet's `Host.prReady` caller in the Changelog and the Motivation (F6).
- **A5.** Test plan. (a) Rewrite `host.test.mjs:1034-1042`. Give the payload `source.commit.hash` and `draft`, and assert the full row. (b) Add a contract test that runs every `pr-list` arm (GitHub plain, Bitbucket plain, Bitbucket rich without Jenkins) with a stub and asserts `head`, `headSha` and `draft`. It fails on main for the Bitbucket plain arm. (c) Add a `pr-ready` test on `PLOT_HOST=bitbucket` that asserts the stub's argv is `['pr','edit','<n>','--ready']`. It fails on main, where the argv holds `update`. (d) Add a unit test in `packages/board/test/unit/approve.test.ts` that feeds a fixture row with a 12-hex `headSha` and asserts that the plan is found and that `OpenPr.headSha` is the resolved full oid.
- **A6.** Update the comments at `plot-host.sh:638` and `:4460-4463` so they name `bb pr edit --ready` as the call (F9).

## Decisions for a person

- Add this plan to `docs/sprints/2026-W45-follow-ups-2-30-1.md`, or clear the `Sprint:` field (F10). An agent must not choose.
- Decide whether the merged-PR path on Bitbucket (F4) is in this slice or a follow-up issue. My recommendation is to include it, because the normalisation in A2 costs one `resolve` per row.

## What I ran versus read

Ran (read-only): `git show`/`git grep`/`git log -S` against origin/main; `gh issue view 3089`; `gh pr view 3091`; `bb --help`, `bb pr --help`, `bb pr edit --help`, `bb pr update --help` (answers `unknown pr command: update`), `bb --version` (1.12.1); `grep` over the installed and cached `bb` scripts (1.12.1, 1.11.2, the 1.10.1 skill). No host write, fleet or board command, or test suite was run.

Read only: `plot-host.sh` (pr-list, pr-ready, the bb caveats, `bb_require_json`), `approve.ts`, `needs-design.ts`, `plan-pr.ts`, `host-shell.ts`, `refs-git.ts`, `host.test.mjs:1034-1042`, the shell consumers of `pr-list`, and the sprint file. I did not execute the claim that a 12-hex prefix resolves in `git diff A...<prefix>`. That claim rests on documented git behaviour.
