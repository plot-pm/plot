## Implementation brief — the-bitbucket-arm-answers-with-a-merge-commit (wave: The Bitbucket arm answers with a merge commit)

- **Plan (canonical):** `docs/plans/2026-09-17-a-merge-commit-is-asked-of-the-host.md` on `main`
- **Approved:** 2026-09-18, jwloka, in-session
- **Branch:** `bug/the-bitbucket-arm-answers-with-a-merge-commit` (base: `main`)
- **Ends as:** one PR to `main`
- **Issue:** #943

**Second of two slices**, and the load-bearing one. Its sibling —
`bug/the-release-question-does-not-gate-a-delivery` — ships first; rebase on
`main` before you start in case it has landed.

### What to build

`pr-state` is the **only** op in `plot-host.sh` whose Bitbucket arm drops a key
its GitHub arm emits. Every GitHub path carries `mergeCommit` (`:2447`, `:2461`,
`:2468`, `:2476`, `:2488`); every Bitbucket path omits it. Construct it on **all
four**:

| line | path |
|---|---|
| `:2496` | numeric success |
| `:2499` | numeric miss (`NONE` object) |
| `:2538` | **branch-lookup `NONE`** |
| `:2539` | **branch-lookup hit** |

The branch arm is a live consumer path, not tidiness: `plot-pr-state.sh:33`
calls `pr-state "idea/${SLUG}"` — a branch, not a number — and `:47` then reads
`.mergeCommit // empty`. A fix touching only the numeric pair leaves it broken.

Bitbucket names it `merge_commit.hash`; `:2673` already reads exactly that in
the `pr-merge-commit` op, from the same payload. Take it from the response
already fetched — **no second host call**.

### THE GUARD — supplying the field is not the end of the path

`:1205` runs `git tag --contains "$sha"` next, and `:1207` is:

```bash
[ -n "$tag" ] || continue   # genuinely not released yet — nothing to report
```

A sha the local object store does not hold makes git print
`error: no such commit` — and **the rc is not readable**: the pipeline's exit
code is `head`'s, measured 0. So an unresolvable sha takes the `continue` whose
comment says the plan is simply unreleased.

That is eight lines above the section's own header: *"SILENCE WOULD BE THE WORSE
BUG. An empty section reads as 'nothing to report', and this section exists
precisely because 'cannot tell' and 'nothing wrong'"* must not look the same.

**Test `git cat-file -e "$sha^{commit}"` before the tag lookup and emit a
`cannot resolve` finding rather than falling through.** Three populations reach
it: `--no-fetch` with PRs on, a merge commit outside the local refspec or a
shallow clone, and a PR merged outside the host's merge button.

### Considered and rejected — do not "simplify" to these

- **`pr-merge-commit` instead of `pr-state | jq`.** It is a complete
  both-backend op (`:2619`, port `prMergeCommit`, adapter `host-shell.ts:287`).
  It takes a **branch**; the scan holds a **number**. Using it would trade a
  missing field for a missing lookup.
- **A grep fallback.** Refused at `:1195`: an earlier draft matched `#N` in
  commit messages and reported v2.2.0 for a plan that shipped in v1.7.0.
  `git log --grep "pull request #<n>"` is that same shape.
- **Touching `plot-pr-merged.sh`.** It reads `mergedAt` and deliberately never
  `mergeCommit`.

### Done when

All four Bitbucket paths emit `mergeCommit` — the hash for a merged PR, `""`
otherwise — so a caller reading `.mergeCommit // empty` cannot distinguish
backends. **A contract test asserts the GitHub and Bitbucket arms return the
same KEY SET**, since an absent key is exactly what was not caught. No second
`bb` invocation, checked by counting. The scan distinguishes an unresolvable sha
from an unreleased plan.

`pr-list`'s Bitbucket arm at `:3025` is the precedent — it emits every key its
GitHub arm does, filling unavailable ones with `"unknown"`, and explains why at
`:2962`: *"An honest gap beats an invented answer, and absent is not false."*

### A note on verification

**This repository is on GitHub**, so you cannot exercise the Bitbucket path
end-to-end. Test the `jq` filters against captured payload fixtures and say in
the PR what was and was not exercised live.

### Repo gates

`nvm use` first. `pnpm run test:contracts` must pass. `scripts/check-host-cli-callers.sh`
gates who may call the host CLI — stay inside `plot-host.sh`. Add a changeset.
**Do not run `pnpm run test:e2e`** — that is CI's gate.
