---
'plot': patch
---

`plot-host.sh` no longer reads an absent CLI as a lookup miss. `is_lookup_miss` matched its bare `not found` alternative against the shell's own `bash: gh: command not found`, so `pr-merged` answered `not-merged` where `plot-pr-merged.sh` answered `unaskable` about the same branch — measured 2026-09-06 with `gh` off `PATH`.

The direction is why it mattered: `not-merged` reads to `rules/landed.ts` as `none`, so `mayRemove` may permit a removal where `unaskable` refuses, and `plot-release-refs.sh` deletes remote refs on that answer. The bare alternative stays — it is what recognises a Bitbucket or Jira miss — and what it now excludes is the shell's phrasing for a missing binary, which is a transport failure wearing a miss's words.
