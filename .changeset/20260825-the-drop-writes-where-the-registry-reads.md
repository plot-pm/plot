---
'@plot-pm/board': patch
---

fix(@plot-pm/board): the drop writes where the registry reads

#420 taught the registry READER to resolve its manifest directory through
`plot-config.sh` (the `Agent registry` key), but left the WRITE path in
`drop.ts` joining the raw `AGENT_MANIFEST_DIR` constant. A board served from a
worktree the dispatcher never wrote to read the dispatcher's manifests through
the configured directory, but a Drop looked in the board's own worktree — found
nothing there — and answered `dropped=true` with "no manifest found" over a file
that still existed. The row returned on the next pulse, and nothing
distinguished the action from a no-op.

`POST /api/registry/drop` now resolves the manifest directory the SAME way the
reader does, reusing the exported `resolveManifestDir` — one implementation of
*where is the registry*, resolved once and used for both the read and the
unlink. The Drop removes the file the board is showing, and a `dropped=true`
over a missing manifest is now honest: it is the same directory the reader read,
not a wrong-place look.
