## Implementation brief — resolve-the-release-of-a-pr

- **Plan (canonical):** [docs/plans/2026-10-21-resolve-the-release-of-a-pr.md](../../docs/plans/2026-10-21-resolve-the-release-of-a-pr.md) on `main`
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2218 merged
- **Branch:** `bug/resolve-the-release-of-a-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan's `Review: pr`

Single-branch plan, no wave.

### What to build

`plot-reconcile-scan.sh`'s section 6 resolves a delivered plan's release version from its last PR's merge commit. Today it does that by one lookup: `plot-host.sh pr-state <pr>` → `.mergeCommit` → `git cat-file -e` → `git tag --contains`. When the commit is missing from the clone, the finding at `:3408` says "not in this clone → cannot resolve" and blames whichever branch the PR's source was — but as of 2026-10-21, measured read-only against ewz-kus-portal (Bitbucket, main `01a6cf2ad`), that blame is wrong in a specific, reproducible case: PRs #3488–#3490 merged into `feature/ewzkus-3518-sammelrechnungen`, a branch Bitbucket deleted after merge. Bitbucket exposes no ref for a squash/merge commit once its *source* branch goes — but here the *source* branch (the plan's feature branch) is fine; what's gone is the **destination** branch the PR merged into. The commit sits on a ref no clone holds because the destination itself was deleted, not because of the source-branch-deletion case #2201 already fixed.

The fix: before giving up, follow the chain. That destination branch (`feature/ewzkus-3518-sammelrechnungen`) was itself the source of another PR (#3491), which merged into `develop`. `develop`'s merge commit (`651cb9be3724`) **is** in the clone, and `git tag --contains` places it in `v5.23.2213`. So the release is knowable — it just takes one more hop (or more, if `develop` were itself non-default and deleted later).

Build the hop as a bounded walk: while the PR's destination (`base`) is not the default branch, look for a merged PR whose head equals that destination, and follow it; stop on success (tag resolved), on a cycle/depth bound, or on a dead end (no merged PR found, or the base name reused in a loop) — each ending in its own named finding, not a loop or a silent wrong answer.

### The decisions the plan settles — do not re-derive them

**Two distinct unreachable-commit causes exist, and this plan fixes only the second.** `:3396`'s comment already separates three populations arriving at the `cannot resolve` arm: `--no-fetch` with PRs on, a shallow clone, and a Bitbucket squash/merge whose *source* branch was deleted (#2201's fix, delivered). This plan's motivation measured a **fourth, previously-conflated** cause: the PR's *destination* branch — not its source — was deleted, and the merge commit was transmitted only to that now-gone ref. PRs #3644 and #3705 (source branches deleted, commits present) prove the existing code's blame-the-source-branch wording is already wrong for a different reason than this plan's case; don't fold the two into one line — name whichever branch (source or destination) actually explains the gap.

**`pr-state`'s destination-branch field is already there on every backend, under two different keys — don't add a new host call to get it.** Checked `plot-host.sh` directly rather than guessing: GitHub's `pr-state` (`:3725`, GraphQL) prints `base: .baseRefName`; the REST fallback (`rest_pr_to_state`, `:2222`) prints `base: .base.ref`. Bitbucket's `pr-state` (`bb_state_row`, `:1876`) passes the raw Bitbucket PR payload through unchanged except for the `checks`/`mergeable` overlay — so it carries the field, but under the Bitbucket API's own key, `.destination.branch.name`, not folded to `base` the way `pr-list`'s Bitbucket row (`:4563`) already does. **Read `.base` for GitHub, `.destination.branch.name` for Bitbucket** — or fold Bitbucket's `pr-state` the same way `pr-list` already does, so the walk reads one key regardless of backend. Either way: no new call, `pr-state` already answers this.

**The PR index cannot shortcut the "find the PR whose source is this branch" step — it has no destination field at all.** Checked `packages/domain/src/entities/pr-index.ts`'s `PrIndexRowSchema` (`:30`–`:88`) directly: it stores `head`, `headSha`, `mergedAt`, `state`, and other per-PR facts the host answered, but no `base`/destination field, optional or otherwise — the schema is `.strict()`, so one can't quietly read it off an extra key either. The index **can** answer "a MERGED row with `head == <destination-branch-name>`" (useful — it's a free, no-host-call way to find the follow-on PR by source-branch name), per *A Decision Reads The Index*'s rule that only `MERGED` rows are trustworthy without a fresh ask. It cannot tell you where that PR merged *to* — that still needs a `pr-state`/`pr-list` call once the candidate PR number is known. Don't try to make the index answer the destination question; it structurally can't.

**The walk calls the domain; it does not duplicate the rule in shell.** Per `docs/shell-and-domain.md`'s cost rule: a lookup run once per *operator* command calls a bundle (measured 39ms bundle vs. 34ms bare `node -e ''` — free against a person waiting), while a lookup run once per *agent per pass* must duplicate in shell (a `node` start there costs 1750% more CPU at load, per `the-pass-is-measured`). Section 6 of `plot-reconcile-scan.sh` runs once per operator invocation of `/plot-reconcile`, never per-agent-per-pass — so this is squarely the "calls the domain" case. Write the chain-walk as a pure function in `packages/domain/src/rules/` (taking PR rows as values, per this repo's "readings as values, not ports" convention — see `## The Layering Rule`'s closing note), exercised by a `board/*.mjs` bundle the shell calls. Do not hand-roll the walk in bash with nested `jq` calls — that's the shape the cost rule exists to head off here, and it would also fight the `scripts/check-shell-lines.sh pr` ratchet below.

**All host reads still go through `plot-host.sh` — the walk adds no direct `gh`/`bb` call.** `scripts/check-host-cli-callers.sh` gates this; its exception list is exactly four scripts and none is this one. If the walk needs "find a merged PR by head branch name" and `plot-host.sh` has no such op today, that's a new `plot-host.sh` subcommand (or a `pr-list --state merged` filter client-side), not a bypass.

**The existing GitHub-vs-Bitbucket fetch-advice split (from #2201, delivered) must stay untouched for the cases it already covers.** `:3401`'s two arms — Bitbucket prints the "exposes no ref" reason line and no fetch command; everyone else prints `git fetch --tags origin, then re-run` — are the over-correction guard the plan's Done-when item 5 names. This plan's new "destination branch deleted" case is a *third* arm alongside those two, triggered when the destination is non-default (checked before falling into the existing `cat-file -e` miss), not a replacement for the existing two. Open Question 5 (does GitHub need the same follow?) is explicitly *not* settled by the plan — it says measure before widening; don't extend the walk to GitHub speculatively. GitHub's merge commit stays reachable via the base branch ref or `refs/pull/N/merge` regardless of source-branch deletion, which is why #2201 never needed this walk on GitHub; confirm (or disprove) that assumption with a real fixture before touching the GitHub arm, and if you don't have time to verify it, leave the GitHub arm exactly as `:3401` has it today and say so in the PR rather than guessing.

### Done when

The plan's `## Done when` list (docs/plans/2026-10-21-resolve-the-release-of-a-pr.md:51-58) is the specification — six items, each needs its own fixture:

- Chain resolves through one hop (PR A → deleted branch B → PR B → default branch, tagged) to A's version. This is the ewz-kus-portal case reproduced as a fixture, not the live repo.
- Chain-breaks case names the deleted **destination** branch specifically (not the source) and prints no `git fetch --tags origin` line — this is the assertion that catches a sloppy fix that just relabels the existing message without actually changing which branch it blames.
- The *pre-existing* source-branch-deleted-but-commit-present case (#2201, PRs #3644/#3705-shaped) still resolves directly with no walk triggered, and nowhere in the finding text does it blame the source branch for a destination-branch problem — i.e., don't regress #2201 while fixing this.
- A cycle (destination chain revisits a branch it already followed) or over-depth chain ends in a named finding, never an infinite loop — this needs an explicit depth bound and visited-set, and a test that constructs a cycle fixture to prove the bound fires rather than assuming it would.
- The GitHub `--no-fetch` fetch-advice line from #2201 is byte-for-byte unchanged — this is the over-correction guard; diff the GitHub fixture's output before/after.
- `scripts/check-shell-lines.sh pr` reports zero net growth in shipped shell line count. Since the walk logic belongs in the domain (see above), the shell side should only grow by the lines needed to call the new bundle — if it grows at all, remove an equal number of lines elsewhere in the same change (the gate takes no exemption).

Plus repo-wide gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — the related domain/board tests and typecheck for whatever you touch, plus the gate scripts (`check-shell-lines.sh`, `check-host-cli-callers.sh`, `check-ancestry-decisions.sh` among them). The `CI suites` config key (e2e, contracts, board, domain coverage, reconcile `node --test`) runs in CI on the PR — don't run the full suites locally; a failure there comes back as a correction, not a local blocker.

### Bookkeeping

Open the PR through the controller once there's a real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. When the PR exists, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Fix` heading, and push the first real commit as soon as it exists rather than batching everything into one push at the end.

### Scope guard

This branch owns: `skills/plot/scripts/plot-reconcile-scan.sh` section 6 (the unreachable-commit arm around `:3396`–`:3412`), any new rule under `packages/domain/src/rules/` and its corresponding `board/*.mjs` bundle, and `test/reconcile/scan.test.mjs`'s section-6 fixtures. If a new `plot-host.sh` subcommand is needed for "find merged PR by head branch," that file and its tests are in scope too — but check `plot-host.sh`'s existing `pr-list --state merged` first; a client-side filter over an existing op may make a new subcommand unnecessary.

No other branch is currently claimed or in flight against this plan — it is a single-slice plan with no wave structure. If you find the chain-walk needs touching `plot-fleet-scan.sh` or anything outside `plot-reconcile-scan.sh`, that's outside this plan's stated scope (which names section 6 specifically) — report it rather than widening the branch silently.
