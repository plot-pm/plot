---
'plot': minor
'@plot-pm/board': minor
---

The master agent reaches the board's controller without HTTP, and the delivery gate stops scanning an estate it already measured.

`plot-ask.mjs <board|fleet>` is the entry point: one call, no server, the same
typed answer the route serialises. `node` rather than an HTTP call to a live
board, because a board is optional and none was running when the choice was
measured — seven skills would have gained a dependency whose failure arrives as
a skill that works on the operator's machine and not in a worker's. The cost is
stated: this path re-derives what a running board already computed, and an HTTP
fast path can be added later without changing any caller, because the artifact
is the seam.

A second bundle rather than a flag on `board-server.mjs`: `index.ts` binds a
port at import time, so a flag would mean a skill that asks a question also
starts a server.

`plot-estate-changed.sh` is the shell half — *is a second ask owed?* A
**measurement, never a timer**: it hashes what the scan reads, every remote
ref's SHA and every plan file's content, so the delivery gate's own fix is
always seen (a phase flip changes plan bytes, the push that follows moves a
ref). It fails toward scanning, because skipping a scan costs minutes while
skipping the gate costs a half-landed delivery nobody notices.

`plot-deliver`'s delivery-landed gate uses it. That gate is the single witness
for "a skill that asks twice in one run" — the plan believed five skills did,
and a recount found four were prose or a help block. Measured here 2026-08-31:
the reconcile scan takes **279.9 s** on this repo, so the gate's conditional
re-run is the expensive one. What changes is how often it asks; the grep, the
section-7 marker and both exit conditions are untouched.

The transport placeholders are left exactly as the controller emits them.
Rewriting them would invent a permission no caller granted, so an unavailable
capability with an empty reason reads as an absence and every real refusal
carries a sentence — a distinction `askedWithoutTransport` makes checkable.

<!--
bumps:
  skills:
    plot-deliver: minor
-->
