---
'@plot-pm/board': patch
---

The registry, the manifest stamp and the supervisor ask one rule which manifest names a desk. `joinManifestDir` is gone and both directory resolvers call `manifestDirectory`. The supervisor matched on the raw path alone, so a desk registered through a symlink read as unregistered and was reported as a leftover; both sides now carry the path as given and its realpath, and either matches either. `manifestForWorktree` answered the first of two manifests naming one desk and now answers none, because two agents on one desk is an estate defect a first match hides.

<!--
plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md
-->
