---
'plot': patch
---

A `Decision` gains its encoding half: how one `Write` reaches plan-file text, and which paths it names.

`rendering.ts` is pure and holds the choice of spelling — `withRecord`,
`withPhase`, `withoutHold`, `withSprintAnnotation`. A `Write` carries values and
no formatting, so a decision stays comparable across the two spellings a plan
file allows; something still has to pick one, and this is where that lives.

`pathsOf`/`pathsNamedBy` derive the paths a decision touches FROM the write
rather than from a list an author maintains. The failure mode is a write
somebody forgot, and an author who forgot it while writing forgets it again
while reviewing.

`adapters/performer/perform-fs.ts` applies a decision and is the only thing in
the package that writes. Every host- and process-reaching kind is skipped BY
NAME rather than through a `default`, so an unrecognised kind fails instead of
passing silently, and a sandbox running this cannot merge a real PR or start a
real agent no matter what a decision says.

**Rescued from a worker that died at exit 124, and incomplete.** The slice's
sandbox e2e comparison — approve and deliver parsing identically by both paths,
with a corrupted-date mutation proving the comparison can fail — is not here.
Neither file has a test, so the domain coverage gate is red.

<!--
bumps:
  skills:
    plot: patch
-->
