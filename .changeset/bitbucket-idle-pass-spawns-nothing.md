---
'plot': patch
---

fleetd reads no default-branch tip where the repository declares no CI system. The read ended `unreadable` after the tip read in that case, so each PR beat started one `git ls-remote` for an answer nothing used. An idle Bitbucket pass with no `CI` key now starts no process.
