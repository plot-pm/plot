## Implementation brief — the-merge-controller-cannot-merge-a (wave 1: Rule and entry)

- **Plan (canonical):** `docs/plans/2026-10-19-the-merge-controller-cannot-merge-a.md` on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2101 merged
- **Branch:** `bug/the-merge-controller-cannot-merge-a-rule` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** PR review through the plot-review app, per repo convention

The `Host` slice (`bug/the-merge-controller-cannot-merge-a-host`) waits on this one: it duplicates this rule in `plot-host.sh` and pairs the two in a corpus test, so the helper's name, signature and 7-character minimum must be settled here.

### What to build

On a real Bitbucket repository (ewz-kus-portal, field test 2026-10-19) `plot-ask.mjs merge` refuses every PR. Bitbucket reports a 12-character head (`66836536f8c9`); the caller passes the full 40-character sha; `packages/domain/src/workflows/merge.ts:96` compares them by equality and refuses `head-moved` with the detail "the head of PR #3686 is 66836536f8c9; the caller read 66836536f8c9". Nothing was merged; the refusal is correct for the wrong reason.

Build one exported helper in `packages/domain/src/rules/` that answers: do two shas name one commit? Yes when one is a prefix of the other, the shorter has at least 7 hex characters, and the comparison ignores case. A shorter value or a non-hex value never matches. Then:

- `merge.ts:96` calls the helper in place of `pr.headSha.toLowerCase() !== input.sha.toLowerCase()`.
- `packages/board/src/server/entry/main.ts:148` accepts 7 to 40 hex characters for `sha` (today `/^[0-9a-f]{40}$/i`). The usage message stays.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **Prefix, not normalisation.** Expanding the 12-character head to 40 needs one extra `bb` call per merge and a second failure path. The plan rejects it; prefix matching needs no call.
- **7-character minimum.** A prefix of 1 to 6 characters collides across a repository's history, so `startsWith` with no floor would accept `a` as a pin. A merge cannot be undone; the floor is the safety property, not a nicety.
- **Out of scope: `checks-unbound`.** After this slice, `merge.ts:103` still refuses on Bitbucket because `checksSha` is always empty there. That belongs to #2075 (`2026-10-19-jenkins-checks-never-bind-to-the.md`). Do not fix it here, and do not weaken the `checksSha !== headSha` equality at `merge.ts:103`; if you meet it in a test, assert the `checks-unbound` refusal as the expected outcome.
- **`mergeCommit` stays short.** `pr-state` keeps reporting what Bitbucket gives. Grep for equality comparisons of `mergeCommit` against a git sha; report any hit instead of widening scope.
- **Absent is not false.** An empty or missing `headSha` stays `unaskable` (`merge.ts:93`), before the helper runs.

Open Points to decide in this slice and record in the PR body:

- Move `rules/verification-record.ts:109`'s private `sameCommit` onto the shared helper, or leave it. It has no minimum, so moving it changes its behaviour for short inputs. The unit is the function: do not rewrite it as a pass-through rename. Default: leave it, unless the helper's contract covers it without a behaviour change.
- Per `CLAUDE.md`, domain code uses arrow functions (`export const f = (…) => …`) and TSDoc that states what the export does, not why. Reasoning goes in the commit message.

### Done when

The plan's `## Done when` list is the specification (the plan carries its criteria in `## Design › Approach`). The assertions a naive implementation would pass without:

- A 12-character head and the matching 40-character sha: `merge` proceeds past the `head-moved` check. Catches the original defect.
- A 6-character pin that is a true prefix of the head: refused `head-moved`. Catches a missing minimum.
- A 12-character pin that differs from the head in its last character: refused `head-moved`. Catches a prefix check that compares only the first 7.
- Upper-case pin against lower-case head: matches. A non-hex pin of 7 or more characters: does not match.
- The head is the shorter value (Bitbucket short, caller long) and the caller is the shorter value: both directions match.
- `plot-ask.mjs merge 1 abcdef` (6 characters) exits 2 with the usage message; 7 and 40 characters pass validation.

Plus: a changeset (`.changeset/`, description first, `bumps:` block last, naming `@plot-pm/board` or `plot` as the gate requires; run `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; this slice should touch no `.sh` file. Do not run `test:e2e` locally. Do not commit `board-server.mjs` or any generated bundle.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new helper and its test), `packages/domain/src/workflows/merge.ts` and its tests, and `packages/board/src/server/entry/main.ts` and its tests. The `Host` branch owns `skills/plot/scripts/plot-host.sh`, the `test/reconcile/` stubbed-`bb` test and `packages/domain/corpus/`; leave those alone. `jenkins-checks-bind-to-the-head` (#2075) touches check binding in the Bitbucket adapter; avoid `merge.ts:103`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
