---
'plot': patch
---

CI counts the direct process calls production makes outside its adapters, and
fails when the number grows.

The domain purity gate already stops the domain importing the world; nothing
stopped the board reaching past the port — measured 2026-08-30, CI had zero
path references to `packages/board/src` while that tree held dozens of direct
`spawn`/`execFile` calls. The new gate is a ratchet at today's 54 with a stated
target of zero: it fails when a new site appears, names the files so a reader
sees where the layer was crossed, and never fails when the count falls.
