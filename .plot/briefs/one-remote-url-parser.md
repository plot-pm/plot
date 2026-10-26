## Implementation brief — release-deliver-and-merge-controllers-close (wave: One parser)

- **Plan (canonical):** docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md on `main`
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2505 merged
- **Branch:** `bug/one-remote-url-parser` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per `Review: pr` — plan-PR convention, reviewed as a normal PR

This slice is independent of the plan's other four waves (Shared issues, Release chain, Merge path, Cleanup) — no ordering dependency either way. It touches `packages/domain/src/rules/remote-slug.ts` and `remote-owner.ts`, which no sibling slice's brief claims.

### What to build

The plan groups three findings under "Duplicated parsing, weak tests and comments" (#2065, #2074, #2146, #2398). All three are still live on current `main` — `git log --oneline 84b1638e4..HEAD` touches none of the files below, so none were already fixed by an earlier-merged sibling:

1. **Three parsers answer one question (#2065, #2074).** The domain holds two private, unexported helpers that each split a git remote URL into host + path:
   - `hostAndPath` in `packages/domain/src/rules/remote-slug.ts:44-49`, used only by the exported `remoteSlug` (line 20). Handles scheme (`scheme://...`) and scp-style (`user@host:path`) forms via two regexes.
   - `pathOf` in `packages/domain/src/rules/remote-owner.ts:33-56`, used only by the exported `ownerOfRemote` (line 17). Handles scheme (http/https/ssh only — explicitly excludes `file://`) and scp-style with a single-char-host guard for Windows drive letters.
   - A third, `branchUrlBase`, lives outside the domain entirely: `packages/fleet/src/shared/fleet-scan.ts:213-235` (`@plot-pm/fleet`). One combined regex (line 219) handles all three shapes plus a Bitbucket-SSH-host allowlist and GitHub/Bitbucket URL-template logic baked in.

   These are not cosmetic duplicates — the regex dialects genuinely disagree on edge cases (ports, `file://`, single-character hosts), so the same remote URL can parse differently depending on which caller asked. `remote-owner.ts:4`'s own TSDoc already states the target: *"ONE PARSER, so the scan and the supervisor read one answer. The scan passes the `origin` URL to its bundle and parses nothing itself; the supervisor reads the URL through its refs port and calls this."* `remote-owner.ts` already declares the principle its own file violates once `remote-slug.ts` and `fleet-scan.ts` are counted.

   Converge on one host/path splitter in the domain that `remoteSlug`, `ownerOfRemote`, and `branchUrlBase` all call. Existing tests (`packages/domain/test/remote-slug.test.ts`, `packages/domain/test/remote-owner.test.ts`, `packages/fleet/test/unit/fleet-scan.test.ts`) cover each caller's cases separately and must keep passing — but none of them currently cross-check the three parsers' edge-case disagreement (ports, `file://`, single-char hosts), which is exactly the defect this slice removes. Add a test that would have caught the disagreement.

2. **`same-commit.corpus.test.ts` copies the shell instead of calling it (#2146).** `packages/domain/corpus/same-commit.corpus.test.ts`'s `shellVerdicts` function (lines 57-79) builds an inline bash fragment and runs it via `execFileSync('bash', ...)` — it never invokes the shipped `packages/board/plot-host.sh`. The file's own header comment (lines 11-22) admits this: *"THE COMPARED LOGIC IS EXTRACTED RATHER THAN THE WHOLE `pr-merge` CASE... copied verbatim from `plot-host.sh:3963`'s pin-matching expression."* That is the exact failure mode *A Shell Script Asks The Domain* (docs/shell-and-domain.md) exists to prevent: a hand-copied fragment can drift from the real script with nothing to catch it. The rule under test is `sameCommit` in `packages/domain/src/rules/same-commit.ts:26-32`. Other corpus tests in the same directory (e.g. `pr-merged.corpus.test.ts`, `listing-page.corpus.test.ts`) pipe cases through the actual shipped script rather than a pasted snippet — follow that pattern: call `plot-host.sh` (its Bitbucket pin-match arm, at or near line 3963) directly instead of re-deriving the bash.

3. **CHANGELOG generator corrupts `#N` inside code spans (#2398).** This bug is not in `packages/domain/src` — it's in the `@changesets/changelog-github` dependency's `linkifyIssueRefs` (`node_modules/@changesets/changelog-github/dist/changesets-changelog-github.cjs.js:59-65`):
   ```js
   function linkifyIssueRefs(line, { serverUrl, repo }) {
     return line.replace(/\[.*?\]\(.*?\)|\B#([1-9]\d*)\b/g, (match, issue) =>
       issue ? `[#${issue}](${serverUrl}/${repo}/issues/${issue})` : match);
   }
   ```
   The regex's left alternative skips text already inside a markdown link so it isn't double-linked, but has no alternative for backtick code spans — so `` `#2065` `` gets its `#2065` matched and turned into a link, breaking the code span. There is no existing Plot-side wrapper; `.changeset/config.json` configures the stock `@changesets/changelog-github` with no custom `changelogFunctions`. Fix this with a thin local `changelogFunctions` module (referenced from `.changeset/config.json` in place of the stock package) that wraps `getReleaseLine`/`getDependencyReleaseLine` and extends the regex to also skip text inside backticks — not a `patch-package` patch of `node_modules`, which `pnpm install` elsewhere in CI would need to replay and which the rest of this repo's gates don't expect.

### Decisions already settled — do not re-derive them

- **This slice does not touch `same-commit.ts`'s logic, sha-pinning length, or `approve.ts`.** That's the Merge path slice (`bug/merge-pins-only-resolvable-short-shas`, PR #2691, already merged per plan `## Slices`). Its own brief confirmed it owns `same-commit.ts` and the corpus test's *comparison target*; this slice owns the corpus test's *mechanism* (call the shell instead of copying it) — read `same-commit.ts` as already correct and do not re-derive its sha-length rule here. If the corpus test's existing shell-copy already encodes a 7-char-minimum assumption that `same-commit.ts` no longer shares after #2691 merged, that's a signal to re-check, not an invitation to change `same-commit.ts` from this branch.
- **The CHANGELOG fix is dependency-level, not domain-level.** Resist the urge to look for the bug under `packages/domain/` — it is not there. Confirm via `grep -rn "linkifyIssueRefs\|changelogFunctions" .changeset/ node_modules/@changesets/changelog-github/` before starting, since a stock-package version bump between plan-writing and implementation could have moved the line numbers above or fixed it upstream (check the installed version's changelog/release notes for "code span" or "backtick" first).
- **`branchUrlBase` stays in `@plot-pm/fleet`.** Converging on one parser means `fleet-scan.ts` calls into the domain for the host/path split, not that `branchUrlBase` itself moves into `packages/domain/src` wholesale — its Bitbucket-SSH-allowlist and URL-template logic are fleet-specific callers of the shared splitter, not part of the splitter itself.
- **Arrow functions and TSDoc-only comments bind the domain-side change.** `remote-slug.ts` and `remote-owner.ts` already use `export const f = (...) => ...` — any new shared helper follows suit, per CLAUDE.md § The Domain Package. State what the function does, not the history of why it was unified; that belongs in this PR's description and the commit message, not in a code comment.
- **The `bitbucket-slug.ts:8` doc-comment finding is out of scope here.** The plan's own Open Questions ask whether that LOW finding belongs in this plan at all, or in a separate docs/infra plan — it is not listed under this slice's line in `## Slices` and the file read clean on inspection. Leave it; don't fold it in.

### Done when

The plan's `## Done when` states: "One remote URL parser serves `remoteSlug`, `branchUrlBase` and `pathOf`; the same-commit corpus test runs `plot-host.sh`; the CHANGELOG keeps `#N` in code spans as code." Concretely:

- `hostAndPath` (`remote-slug.ts`) and `pathOf` (`remote-owner.ts`) are gone as separate implementations; `remoteSlug` and `ownerOfRemote` both resolve host+path through one shared function.
- `fleet-scan.ts`'s `branchUrlBase` calls that same shared function for its host/path split rather than running its own combined regex; its Bitbucket-allowlist and template-building logic stay in `fleet-scan.ts`.
- A test exists that feeds the same edge-case URL (port, `file://`, single-char host — whichever ones the three old regexes actually disagreed on) through all three call sites and asserts they now agree.
- `same-commit.corpus.test.ts`'s `shellVerdicts` calls `plot-host.sh` rather than an inline bash copy of its expression; the header comment admitting the copy is removed or rewritten to state the new mechanism.
- The CHANGELOG `#N`-in-code-span bug is fixed via a local `changelogFunctions` wrapper wired into `.changeset/config.json`, not a `node_modules` patch; a regenerated CHANGELOG snippet (test fixture or manual check) shows `` `#2065` `` staying literal text rather than becoming a link.
- Every existing test in `remote-slug.test.ts`, `remote-owner.test.ts`, `fleet-scan.test.ts`, and `same-commit.corpus.test.ts` still passes.

Plus the repo's gates: no bundle diff (`scripts/check-no-bundle-diff.sh`) — this slice touches `packages/domain/src/rules/*`, `packages/fleet/src/shared/fleet-scan.ts`, and `packages/domain/corpus/same-commit.corpus.test.ts`, not the board bundle; run `pnpm build:board` only to test locally, never commit it. A changeset for this fix, description first and `bumps:` block last (CLAUDE.md § Versioning) — this touches both `@plot-pm/board`... no, actually only `plot` (domain is unpublished internally; check whether the domain package needs its own changeset entry per current `.changeset/` convention before assuming `plot` alone covers it). `plan:` line pointing at this plan is optional but welcome. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves `@plot-pm/domain`'s and `@plot-pm/fleet`'s related vitest suites and typecheck for the files you touch. The `CI suites` config key's suites run in CI on every PR; do not run the full suite locally.

Name the shell gate too, even though this slice is mostly TypeScript: `same-commit.corpus.test.ts`'s rewrite calls `plot-host.sh` rather than editing it, so `scripts/check-shell-lines.sh` should not fire unless the corpus test's new call surfaces a gap in `plot-host.sh` itself that needs a shell-side fix — if it does, that growth is paid for in the same change per the gate's rule.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan and opens the PR titled from this slice's wave heading, with the plan and this brief linked in the body. When the PR exists, append `→ #<number>` to this branch's line under `### One parser` in the plan's `## Slices` section, on `main`.

### Scope guard

This branch owns: `packages/domain/src/rules/remote-slug.ts` (`hostAndPath` → shared parser), `packages/domain/src/rules/remote-owner.ts` (`pathOf` → shared parser), `packages/fleet/src/shared/fleet-scan.ts` (`branchUrlBase`'s host/path split only — not its Bitbucket-allowlist or URL-template logic), `packages/domain/corpus/same-commit.corpus.test.ts` (mechanism: call `plot-host.sh` instead of copying its expression — not `same-commit.ts`'s own logic), `.changeset/config.json` and a new local changelog-functions module (CHANGELOG `#N`-in-code-span fix).

Other branches from this plan, per its `## Slices` section at brief-writing time:
- `bug/shared-issue-close-reads-every-sibling` — Started 2026-10-24, PR #2578 — `deliver.ts` sibling-read and skip-list logic. No file overlap.
- `bug/release-chain-reads-every-page-and-hop` — Started 2026-10-25, PR #2686 — `pr-merge-dest`, `release-chain.ts`. No file overlap.
- `bug/merge-pins-only-resolvable-short-shas` — Started 2026-10-25, PR #2691 — `same-commit.ts`'s own logic, `approve.ts`'s sha-posting. This slice's corpus-test rewrite reads `same-commit.ts` but does not change it — if #2691 already changed the corpus test's comparison target, re-read it fresh before editing the test's mechanism.
- `bug/remove-dead-pin-and-approve-branches` — Started (brief written 2026-10-25) — `approve.ts`'s dead precedence branch, `gate.ts`, `host-pin.ts`, `controller-gate.ts`. No file overlap with this slice.

If you find a fourth live finding under "Duplicated parsing, weak tests and comments" that the plan did not name, or discover that one of the three items above was already fixed on `main` since this brief was written, report it in the PR description rather than silently expanding or shrinking scope.
