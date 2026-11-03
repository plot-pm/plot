# Panel: plot-approve finds no plan on an open Bitbucket PR

- **Plan:** `docs/plans/2026-11-03-plot-approve-finds-no-plan-on.md` (issue #3089, plan PR #3091)
- **Jurors:** layering, safety, testability, seams
- **Positions:** amend, amend, amend, amend
- **Reconciled:** unanimous amend
- **Round:** 1, 2026-11-03

## Agreement

All four jurors found these, and the moderator checked each against `origin/main` at `0723f9dd5`:

- The diagnosis holds. The plain Bitbucket `pr-list` arm (`plot-host.sh:4979`) emits no `headSha`, and `openPrsOf` drops rows without one (`approve.ts:347`). `pr-ready` on `bb` runs `bb pr update` (`plot-host.sh:4467`), which `bb` does not have.
- The plain arm also lacks `draft`. `prOf` reads it as `false` (`host-shell.ts:108`), so after the `headSha` fix a draft plan PR found through the open-PR lookup skips `pr-ready` (`approve.ts:1068`) and goes to `pr-merge`. Safety rated it HIGH.
- The `origin/<head>` fallback in the plan contradicts the controller's own contract (`approve.ts:336-338`) and the merge pin (`approve.ts:1081-1084`). All four said to drop it.
- Open question 1 is answered from the code: git accepts an unambiguous 12-hex prefix in `rev-parse <sha>^{commit}` (`approve.ts:320-321`) and in `git diff origin/<main>...<sha>` (`refs-git.ts:498-507`).
- `needs-design.ts:181-201` holds a copy of `openPrsOf` with the same filter (named by layering, safety, testability and seams).
- `test/reconcile/host.test.mjs:1034-1042` asserts the defective five-field row with `deepEqual` and must be rewritten.

## Findings From Some Jurors

- **Keep the full sha from `resolve`** (layering, seams; safety proposed a prefix check after resolve). Adopted.
- **Name the unread PRs in `plan-not-found`** (layering, safety, seams). Adopted for both controllers.
- **`pr-ready` has a second caller**, the fleet agent loop through `Host.prReady` (`agent-loop.ts:444`, `host-shell.ts:382-383`, `loop-writes.ts:56`) (layering, seams). Adopted; the plan says it removes a manual mark-ready on Bitbucket slice PRs.
- **The merged-path comparison at `plan-pr.ts:241` is exact**, so a 12-hex row never matches a 40-hex `secondParent` (safety, seams). Adopted in this slice as a prefix match of at least 7 hex characters.
- **Emit the GitHub plain arm's full field set on the Bitbucket plain arm** (seams). Adopted: `draft`, `url`, `updatedAt`, `headSha`, `mergedAt`, `base`.
- **Two open PRs with one slug: the record and the merge can come from different PRs** (safety, F5). Checked and true: `remotePlanOf` reads the first carrying PR (`approve.ts:452-457`), and `planPrOf` merges the `idea/<slug>` PR with `rivals: []` (`plan-pr.ts:205-219`). The same split exists in `needs-design.ts:232` and `:393-397`. Out of scope; filed as #3093.
- **The controller calls `ctx.scripts.host(['pr-ready', ...])` instead of the `prReady` port** (layering, finding 7). Existing debt, not adopted; the `pr-ready` test runs `plot-host.sh` directly, which covers both routes.
- **A controller test with `refsFixture` cannot prove short-sha handling**, because the fixture keys by exact string (testability). Noted; the planned `approve.test.ts` case asserts the full sha in `changedFiles` keys and the merge pin, so it fails on `main` for a different reason than git's prefix handling.
- **The sprint file has no line for this plan** (seams, F10). Checked and true on `origin/main` and on the branch. Recorded in the plan's Notes; not decided.

## Rejected Or Corrected

- No juror finding was rejected after a source check.
- Line numbers differed slightly between jurors for the plain arm (`:4976-4978`, `:4979-4981`, near `:4985`). The plan uses `:4979`, the line of the `jq` expression on `0723f9dd5`.
- Safety's amendment 3 kept the host's short hash as the merge pin. The operator chose the full sha as the pin; `plot-host.sh:4445` prefix-matches both ways, so both work.

## What Each Juror Ran

| Juror | Ran | Read only |
|---|---|---|
| layering | `gh issue view 3089`; `git show`/`git grep` on `origin/main`; `bb --help`, `bb pr --help` | no test suite, no `plot-host.sh` call; did not check Bitbucket's commit-status endpoint against a short hash |
| safety | `gh issue view 3089`; `git show`/`git grep`; `bb --version` (1.12.1); `bb pr edit --help`; `bb pr update 1 --ready` (exit 1, `unknown pr command: update`, no host call) | Bitbucket's behaviour on merging a draft PR; git's prefix disambiguation under a collision |
| testability | `git show`/`git grep`; `gh issue view 3089`; `bb --version`, `bb pr edit --help`, `bb pr update --help`; `git rev-parse <12-hex>^{commit}` and `git diff --name-only origin/main...<12-hex>` on this repository | that `host.test.mjs:1034` fails after the change (inferred from `deepEqual`); Bitbucket draft-merge behaviour; `commitStatus` with a 12-hex sha |
| seams | `git show`/`git grep`/`git log -S`; `gh issue view 3089`; `gh pr view 3091`; `bb --help`, `bb pr --help`, `bb pr edit --help`, `bb pr update --help`, `bb --version`; `grep` over the 1.12.1, 1.11.2 and 1.10.1 `bb` sources | `git diff A...<prefix>` with a short sha (documented behaviour, not run) |

The moderator re-ran read-only: `bb --version` (1.12.1), `bb pr edit --help` on 1.12.1 and 1.11.2 (both list `--ready`), `bb pr update 1 --ready` on both (`unknown pr command: update`, no host call), `grep` of the 1.10.1 skill (`SKILL.md:73`, `tests/pr-edit.test.ts:66`), `git rev-parse <12-hex>^{commit}` (returns the 40-hex oid), and `git show`/`git grep` for every line the plan cites.

## Shared Blind Spot

No juror executed the controller against a real Bitbucket repository, and none observed how Bitbucket answers a merge of a draft PR. Every juror's claim about the open-PR path after the fix is read from code. The first real proof is an approval of a draft plan PR on a Bitbucket adopter after the slice merges.

## Operator Decisions

1. No fallback to `origin/<head>`. A row with no head sha is counted and named in the `plan-not-found` refusal, in `approve.ts` and `needs-design.ts`.
2. The plain Bitbucket `pr-list` arm emits `headSha`, `draft` and the fields its consumers read. The controller keeps the full sha from `refs.resolve(<sha>^{commit})` and pins the merge to it. The merged-PR comparison at `plan-pr.ts:241` is fixed in this slice; the moderator chose a prefix match (reason in the plan).
3. `pr-ready` on `bb` becomes `bb pr edit <n> --ready`. bb 1.10.1, 1.11.2 and 1.12.1 carry it; no minimum-version gate. The fleet agent loop's mark-ready is fixed by the same change.
4. The plan names source files, not bundles. The moderator chose one shared reader, `packages/board/src/server/entry/open-prs.ts`, for both controllers.
5. Six named tests, each failing on `main` today.
6. The two-PRs-one-slug defect is out of scope and filed as #3093.
7. No net shell growth and bash 3.2 syntax: every `plot-host.sh` edit changes text in an existing line.
8. One changeset, packages `plot` and `@plot-pm/board`, with `plan:` and skill bumps `plot` and `plot-approve`.
9. One slice on `bug/plot-approve-finds-no-plan-on`.

## Open For A Person

- The plan's `Sprint: follow-ups-2-30-1` has no matching line in `docs/sprints/2026-W45-follow-ups-2-30-1.md`. Add the line or clear the field.
