## Implementation brief — plot-approve-finds-no-plan-on

- **Plan (canonical):** docs/plans/2026-11-03-plot-approve-finds-no-plan-on.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3091 merged
- **Branch:** `bug/plot-approve-finds-no-plan-on` (base: `main`)
- **Ends as:** one PR to main, opened with `plot-open-pr.sh`
- **Review of the code:** per repo convention (plot-review app required on main)

One slice, no waves: nothing waits on it and it waits on nothing.

### What to build

On Bitbucket, `/plot-approve` reports `plan-not-found` for a plan that lives only on its open plan PR (issue #3089, measured 2026-11-03: PR #975, `mat-spiel-auf-der-404`). Cause: the plain Bitbucket `pr-list` arm (`plot-host.sh:4979`) emits no `headSha` and no `draft`, and `openPrsOf` (`approve.ts:347`, copied at `needs-design.ts:186`) drops every row with an empty `headSha`. Second defect: `pr-ready` on `bb` runs `bb pr update --ready` (`plot-host.sh:4467`), which does not exist; the call is `bb pr edit <n> --ready`. The fleet agent loop's mark-ready goes through the same op, so every Bitbucket slice PR stays in draft today. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **Plain arm emits the rich arm's fields.** Add `draft`, `url`, `updatedAt`, `headSha`, `mergedAt`, `base` using the exact expressions of the no-Jenkins rich arm (`:4974`). `draft` is required, not optional: `prOf` reads an absent `draft` as false (`host-shell.ts:108`), so without it a draft plan PR would be merged unmarked.
- **Keep the full sha.** `holdsCommit` resolves `<sha>^{commit}` through `refs.resolve` (`git rev-parse`), which returns the 40-hex oid for a 12-hex prefix. Store that as `OpenPr.headSha`. The merge pin `--match-head <full sha>` matches a 12-hex head because the Bitbucket arm compares as prefixes both ways (`plot-host.sh:4445`). No new port operation.
- **No fallback to `origin/<head>`.** The doc comment at `approve.ts:336-338` forbids it: that ref may not be the commit the merge pins to.
- **One shared reader.** Move `openPrsOf`/`holdsCommit` into `packages/board/src/server/entry/open-prs.ts`; both controllers import it (as they share `ladder.ts`). Arrow function, factual TSDoc, each controller keeps its own refusal sentence for a failed `pr-list`. Do not edit two copies.
- **Unread rows are named.** A listed own-repo open row is unread when the host named no head sha, git lacks the head commit after fetch, or `changedFiles` fails. The `plan-not-found` refusal adds one line, e.g. `1 open PR could not be read: #975 (the host named no head commit)`. In approve: `refusalText`'s `plan-not-found` case (`approve.ts:546`). In needs-design: the controller appends to the domain detail (`workflows/needs-design.ts:120`) before the throw at `needs-design.ts:428`. Fork rows (`repo !== ''`) stay skipped and unnamed.
- **Merged-PR comparison takes a prefix.** `plan-pr.ts:241` compares `pr.headSha === addition.secondParent`; a 12-hex Bitbucket row never equals the 40-hex oid. New rule: exact match, or case-insensitive prefix with `headSha` at least 7 hex chars. Resolving each merged row was rejected: the rule must stay I/O-free, and a squash-merged head may not be held locally. `confirm` re-asks the host and requires `mergeCommit` equal to the addition, so a collision ends in `none`.
- **`pr-ready` → `bb pr edit <n> --ready`.** bb 1.10.1, 1.11.2, 1.12.1, 1.13.0 carry it. No minimum-version gate. Update the comments at `plot-host.sh:638` and `:4460-4463` to name `bb pr edit <n> --ready` and `--draft`.
- **Layering.** `plot-host.sh` stays the only host-CLI caller; `host-shell.ts` does not change; no new script.
- **Shell ratchet.** Every `plot-host.sh` edit changes text inside an existing line (the jq literal, the bb call); comment edits replace comments. The command count must not grow. Introduce no bash 4+ syntax.

Invariant carried over: the index/listing never says "no" — an unreadable row is "could not read", never "no plan".

### Done when

The plan's tests are the specification; each fails on main today:

- `host.test.mjs:1034-1042` rewritten (not deleted): fixture gains `source.commit.hash` `0123456789ab` and `draft:true`; `deepEqual` asserts `headSha` and `draft`.
- Contract test: every `pr-list` arm, both backends (GitHub plain/rich; Bitbucket plain, rich without Jenkins, rich with Jenkins), rows carry `head`, `headSha`, `draft`. Catches the plain arm regressing again.
- `pr-ready` argv test modelled on the `pr-close` test (`:1105-1112`): stub `bb` exits 1 on `pr update`, 0 on `pr edit 4 --ready`; assert exit 0 and argv.
- `approve.test.ts` default-branch-checkout case (`ctxDefaultBranch`, `:285`): short `headSha` resolves to a full sha; assert plan found, `pr-ready` runs, `pr-merge` carries `--match-head <full sha>`. Catches a lookup that keys `changedFiles` and the pin by the short hash.
- `approve.test.ts` refusal case: row without `headSha` → refusal names `#<n>` and `the host named no head commit`; matching case in `needs-design-route.test.ts`.
- `rules-plan-pr.test.ts`: 12-hex prefix of `secondParent` → `ask: 'confirm'`; 6-char prefix → `none`; existing `'h'`/`'h'` fixtures still pass.

Plus: changeset exactly as in the plan's Slices section (description first, `plan:`/`bumps:` comment block last; `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the `CI suites` run in CI and a failure there returns as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; the gate counts commands, not lines, and has no override. Do not commit rebuilt board bundles. New functions are arrows.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`); append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Sprint `follow-ups-2-30-1` holds no line for this slug; the plan's Notes record that.

### Scope guard

Owned: `skills/plot/scripts/plot-host.sh`, `packages/board/src/server/entry/{approve,needs-design,open-prs}.ts`, `packages/domain/src/rules/plan-pr.ts`, the tests above. Out of scope, filed as #3093: `remotePlanOf` reads the gating record from the first open PR changing the plan while approval merges the `idea/<slug>` PR. Report anything else unanticipated rather than improvising.
