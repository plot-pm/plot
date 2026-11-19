---
'plot': patch
---

The marketplace installs `plot` from the release tag `vX.Y.Z` instead of from `main`. Before, the `plot` entry's source was `./`, so an install copied whatever `main` held at that moment and labelled it with the last released version: on 2026-11-19 an install reading `2.34.0` held `main` 190 commits past `v2.34.0`. The release step now writes the tag beside the version, the release-PR check accepts that ref line only when it names the version the same PR writes, and `sync-versions.sh` fails the release when its jq filter fails instead of reporting success.
