---
'@plot-pm/board': patch
---

Bound every client fetch, so a dead server says so instead of showing `Loading…`

`pnpm board` runs under `node --watch`, so every rebuild, pull and artifact
write restarts the server under whatever request is in flight. An unbounded
`fetch` killed mid-response neither resolves nor rejects — the promise simply
stays pending. The doc viewers' error branch was correct code that never ran,
and `Loading…` (which means *wait*) rendered for a server that would never
answer.

The doc viewers now bound the wait and report a timeout as a failure that names
the likely cause — *the board restarts when its files change; close and reopen*
— rather than an exception class a reader cannot act on. All 19 client fetch
call sites are bounded: the two pollers in `App.tsx` at 3.5 s (a hung poll never
reached the `catch`, so it never incremented the failure counters that drive the
"restart `pnpm board`" overlay — the apparatus built to announce a dead server
was silenced by exactly that event), and the action routes at 15 s.
