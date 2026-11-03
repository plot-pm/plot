# Panel — pr-review accepts a plot/review status from any writer

Subject: `docs/plans/2026-11-03-pr-review-accepts-a-plot-review.md` (`674548181`, plan PR #3074, issue #3072)
Convened: 2026-11-03, round 1, against `origin/main`; findings re-checked against `origin/main` by the moderator before the amendment
Lenses: layering, safety, testability, seams — four jurors, one rubric, persona varied only.

## Outcome: UNANIMOUS — 4 amend

| Lens | Position | Evidence |
|---|---|---|
| layering | **amend** | read, plus `gh api` on the statuses of #3067's head, its rollup and the branch rules |
| safety | **amend** | read, plus the live ruleset and the statuses of a merged head |
| testability | **amend** | read, plus the statuses of #3067's head and `gh api apps/plot-review` |
| seams | **amend** | read, plus the statuses, the rollup, one GraphQL `StatusContext.creator` query and `gh api apps/plot-review` |

All four gated with a committed position. No hedges. Reconcile: `unanimous amend layering,safety,testability,seams`.

## Where all four agree

**1. The defect is real.** `plot-host.sh:4395` takes `[... | select(.context == "plot/review")][0]` and reads no `creator`. Re-checked on `origin/main`.

**2. The Motivation claim about the slice-PR rule is false.** `slicePrNext` (`slice-pr-next.ts:181`, `:227`, `:324`) and `release-prepare.ts:199`, `:260-267` read `plotReview` from the PR index, which `pr-list --rich` fills from `statusCheckRollup` (`plot-host.sh:4803`). The rollup carries no creator and holds the newest status per context. All four found that a writer check on `pr-review` alone leaves the index writer-blind, and three (layering, safety, seams) found that this turns a refusal into a PR that `mergeAt` refuses every pass. `reviewReaskPrNumbers` (`pr-index.ts:330`) never re-asks a `success` row on the current head — re-checked.

**3. Open Question 1 has a factual answer.** A `plot/review` status carries `creator.login = "plot-review[bot]"`, `type = "Bot"`, `id = 342578638`; the bot id is not the App id 5317669, and no field names the integration. The login comes from `GET /app` under the App JWT; `appJwt` and `call` exist in `plot-github-app.mjs:67`, `:74`.

**4. Open Question 3 has a factual answer.** `bitbucketReview`'s header (`bitbucket-pr-reading.ts:113-127`) states that a later write with the same key replaces the status; the status object carries no writer.

**5. The live reproduction is a host write.** Safety, seams and testability name it as the act under review; tests use a stubbed `gh`.

## Where they differ

The moderator records these and does not average them.

- **Placement of the rule.** Layering, seams and testability found that the Approach (shell filters) and the layering line (domain compares) are two designs. Layering and seams want a domain rule beside `bitbucketReview`; testability only asks that one be chosen. Safety reached the same placement through the shell-lines ratchet.
- **Foreign-status semantics.** Layering leaned to "trusted writer decides, foreign ignored" (GitHub's own semantics, no stall). Safety and seams required a named refusal for a newer foreign status. Decided by the person: refuse in `mergeAt` and `releaseApprove`, keep the read `ok`.
- **No `Review app` key.** Safety recommended refusing (`review-writer-unverified`), because with no key Plot writes no `plot/review` at all (`plot-host.sh:584-588`). Seams and layering recommended today's behaviour. Decided by the person: today's behaviour, reported as `unchecked`.
- **The `commit-status` path.** Only safety found that any agent can write as `plot-review[bot]` through `plot-host.sh commit-status`, because it mints a token from the `Review app` key, and that `controller-gate.ts` holds no refusal for it. Decided by the person: the gate joins this plan.
- **Config read from the working tree.** Seams and safety found that `plot-config.sh:290-291` reads the working tree, so a PR head can re-point the trusted writer. Decided by the person: the default branch's committed config.
- **Two login spellings.** Only seams measured that GraphQL `StatusContext.creator.login` reads `plot-review` while REST reads `plot-review[bot]`. The plan compares on the REST arm only.
- **Board review run.** Safety, seams and testability found that `review.ts:303`, `:498` read `prReview` before each write, so a filter or a non-ok read lets one forged status block or steer the App's runs.
- **Test seams.** Only testability found that `ghStub` matches the exact argv, so pagination breaks every GitHub case unless the stub changes in the same commit, and that `prReview` in `host-pr-review.test.mjs:40-49` reads this repository's real `Review app` unless `PLOT_REPO_ROOT` points at a temp root.
- **Bypass actors.** Safety named Integration 5173644 as an `always` bypass actor, so a fleet merge through it is not checked by GitHub. Out of scope; a person's decision.
- **`review-bypass:` authorship.** All four named it; layering, safety and seams asked for it out of scope by name. Decided: a follow-up.
- **Overlap.** Only seams named #3068 (the Merger App closes the fleet path at the host) and #3070 (both edit `release-approve.ts` and its test).

## What each juror ran and what it only read

- **Layering** ran `git show`, `git grep`, `gh api` on #3067's statuses, `gh pr view 3067 --json statusCheckRollup`, the branch rules and `gh issue view`. It did not check the Bitbucket status shape against a live API.
- **Safety** ran the same reads, the ruleset by id, and `ls -l` of the key directory. It did not confirm the rollup's missing creator or identify Integration 5173644.
- **Testability** ran `git show`, `git grep`, the statuses read and `gh api apps/plot-review`. It ran no test; "fails before" comes from the jq at `plot-host.sh:4395`.
- **Seams** ran the statuses read, `gh api apps/plot-review`, the rollup, one GraphQL query and `gh pr view` on #3068, #3070 and #3074.

No juror ran a test, a fleet command, a board command or a host write.

## What the lenses shared, and could have missed together

- **No juror measured `--paginate` on the statuses endpoint.** The page size and the order across pages come from the API's documentation, not from a run.
- **No juror measured `GET /app` with the key.** The slug is read from the public `apps/plot-review` endpoint; the JWT path is read from code.
- **No juror tested the index re-ask under load.** The extra `pr-review` call per unchecked `success` row costs host budget each delta; nobody counted it.
- **All four read the controller gate from code.** Nobody ran the hook against a `gh api … -f context=plot/review` command line, so the parsing of `-f`/`-F` and of a JSON `--input` body is unmeasured.
- **Bitbucket is read, not measured.** All four agree the status object has no writer; nobody read a live Bitbucket status.
