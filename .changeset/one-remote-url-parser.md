---
"@plot-pm/domain": patch
"@plot-pm/fleet": patch
"plot": patch
---

`remoteSlug` (`remote-slug.ts`), `ownerOfRemote` (`remote-owner.ts`) and `branchUrlBase` (`@plot-pm/fleet`'s `fleet-scan.ts`) each carried their own regex for splitting a git remote URL into host and path, and the three disagreed on `file://` URLs and single-character scp-style hosts (a Windows drive letter). They now share one parser, `hostAndPathOfRemote` (`packages/domain/src/rules/remote-url.ts`); `branchUrlBase` keeps its Bitbucket-host allowlist and GitHub/Bitbucket URL-template logic, calling the shared parser only for the host/path split. `same-commit.corpus.test.ts` now spawns the real `plot-host.sh pr-merge --match-head` against a stub `bb` instead of comparing `sameCommit` to an inline copy of its pin-match expression, closing the gap `docs/shell-and-domain.md` exists to prevent — two of its original cases passed an empty `--match-head` value, which the shell's own argument parsing refuses before the comparison runs, so their coverage moved to `same-commit.test.ts` as plain unit cases. `.changeset/changelog-functions.js` wraps `@changesets/changelog-github`'s `getReleaseLine`/`getDependencyReleaseLine` so a backtick-quoted issue reference in a changeset summary (`` `#2065` ``) stays literal text instead of being rewritten into a markdown link.

<!--
plan: docs/plans/2026-10-24-release-deliver-and-merge-controllers-close.md
bumps:
  skills:
    plot: patch
-->
