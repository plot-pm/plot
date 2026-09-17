# Panel — a-probe-reading-is-not-a-guess

**Reconciled: `unanimous` — amend (premise, scope)**

Both jurors read the `jen` CLI's source rather than the plan's quotation of it,
and both reached the same correction independently. The moderator re-ran the
disputed measurement.

## The plan describes a real defect and attributes the wrong effect to it

**The regex is wrong, and both jurors verified it at the source.** `jen:928`
prints `Jenkins auth:  OK — ${fullname}`; `plot-board-probe.sh:266` matches
`jenkins auth:[[:space:]]*reachable`. The success path prints a word the probe
never looks for.

**But the reported symptom cannot come from it.** `classify` answers `failed`
only on a non-zero exit, and `jen:932` shows `exit 1` on the failure branch
alone — the `OK` branch falls through to 0. So a broken regex over a genuine
success yields **`unknown`**, never `failed`.

Re-measured here, three consecutive runs against the reporting instance:

```
run 1: exit=1 :: Jenkins auth:  NOT reachable
run 2: exit=1 :: Jenkins auth:  NOT reachable
run 3: exit=1 :: Jenkins auth:  NOT reachable
```

**The probe's `failed` was the correct reading for that run.** The reporter held
a signed-in Keycloak session and a stored keychain token *and* an unreachable
Jenkins — three facts the CLI separates on the line the probe reads, and which
the plan's headline collapses into "an authenticated CLI".

### Where the jurors disagreed, and who was right

`scope` recorded `EXIT=0` for the same command `premise` measured as `exit 1`.
Three runs here answer **1**, consistently. `scope`'s capture almost certainly
read the exit of a pipeline rather than of `jen`, and its derived paragraph —
an unexplained inconsistency in the CLI — does not survive. **Its structural
point does**, and it is the same one `premise` makes: the regex defect's real
consequence is `ok` degrading to `unknown`.

## What that does to the plan, precisely

**The defect is worth fixing and the direction of its harm inverts.**
`plot-board-setup/SKILL.md:434` routes `unknown` to *"cannot verify — say so;
never round it up to authenticated"*. That is the **safe** direction. The plan's
Design argues the opposite — an adopter sent to repair nothing — and cites the
`failed` row to do it.

**So the plan's own "What this does not do" is now false.** It says *"It does
not change what `unknown` means… This fixes a false `failed`, not the refusal
that sits beside it."* There is no false `failed`. The change is precisely to
the `unknown` path it disclaims.

**And slice 1's first gate encodes the wrong pre-state.** An implementer reading
the Design will pin `failed` as the value before the fix; it is `unknown`. The
gate's post-state (`ok`) is right, which is why this is an amendment and not a
rejection.

## The second defect is sound and both jurors say so

`:130` is a root-only `-f` test, verified verbatim, and cannot see
`.build/pipelines/*/Jenkinsfile`. The plan's *"`gh_workflows` is the model that
already works"* is accurate — `:132` tests a known directory. The
`plot-deliverable-search.sh` precedent is real and its header carries the
measurement the plan cites.

`scope` adds the question the plan leaves open: **the bound is not stated.**
Depth and exclusions are deferred to the implementer while the gate demands they
be "measured and stated in the script". That is a decision the plan should make,
not delegate.

## Two citations that do not hold

- **`plot-host.sh:677` does not exit 3 at a build lookup.** Checked: the line
  sits inside a candidate loop with `ci_looks_like_host`. The consequence the
  plan draws from it needs a different citation or none.
- The `:42-43` account of `classify`'s fallthrough is wrong as stated, per above.

## What the lenses had in common

**Both read the CLI and the probe. Neither ran the probe.** The whole panel is
an argument about what `plot-board-probe.sh` would report, assembled from its
source and from `jen`'s — and the one empirical check that would settle it,
running the probe in the reporting repository, is available to neither juror
here because the repository is not this one.

**That is the shared blind spot, and it is also the plan's.** The plan reasons
from a JSON payload someone else captured. A fixture holding the probe's real
output for each of the three `jen` states would make every claim in this panel
checkable, and no slice creates one.

## The moderator's reading

**Unanimous, and right.** The two defects are real, the second is stated
correctly, and the first needs its symptom, its consequence and its slice-1
pre-state corrected — the fix itself does not change. The plan should also say
what the `failed` reading in the report actually was: correct.

**Nothing here moves the plan's phase.**
