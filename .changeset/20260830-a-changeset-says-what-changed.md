---
'plot': patch
---

A changeset that would publish nothing now fails CI.

Changesets publishes the first line after the frontmatter, so a `bumps:`
comment written first becomes the release note and the description behind it
never ships. Measured 2026-08-30: **19 of 169 published entries**, 11%.

The rule is `packages/domain/src/rules/changeset.ts`, not another shell
branch: `scripts/` has no tests, the domain runs under a 100% coverage gate.
Two named refusals rather than a boolean, because their repairs differ —
`unknown-package` is a name to correct, `no-description` is prose to move or
write. The 20-character floor is a labelled guess that catches `.`, `wip` and
`TODO`; `Fix typo` is 8 characters and legitimate, so it sits below anything a
person writes. It checks syntax and size, never meaning.

`check-changeset-packages.sh` keeps its name and becomes an adapter: it reads
the workspace manifests and the changeset bytes, and its only remaining
conditional turns a refusal count into an exit code.

CLAUDE.md now shows a complete changeset with the block LAST and says why the
order matters. The CHANGELOG is annotated, not rewritten — 169 entries and all
19 markers are byte-identical, since 14 of the 19 have no recoverable changeset
to restore the wording from.

<!--
bumps:
  skills:
    plot: patch
-->
