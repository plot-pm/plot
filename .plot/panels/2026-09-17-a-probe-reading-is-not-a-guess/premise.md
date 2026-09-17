# Premise lens — a-probe-reading-is-not-a-guess

Position: amend

The second defect (Jenkinsfile) is real and correctly stated. The first defect
(auth regex) is real in its *mechanism* and **wrong in its stated symptom and
its consequence**, and the plan's own slice-1 gate encodes the wrong word. Two
cited line numbers are wrong, one citation points at code that does not do what
the plan says, and slice 1 as written would **break a passing test that is
already correct**.

---

## 1 — Is the problem real, and stated correctly?

**Defect 2 (Jenkinsfile): real, stated correctly.** `:130` verified verbatim.

```
$ awk 'NR>=129 && NR<=132' skills/plot/scripts/plot-board-probe.sh
129: jenkinsfile=false
130: [ -n "$git_root" ] && [ -f "$git_root/Jenkinsfile" ] && jenkinsfile=true
131: gh_workflows=false
132: [ -n "$git_root" ] && [ -d "$git_root/.github/workflows" ] && gh_workflows=true
```

A root-only `-f` test cannot see `.build/pipelines/*/Jenkinsfile`. The plan's
"`gh_workflows` is the model that already works" is accurate — `:132` tests a
known *directory*. This half is sound.

**Defect 1 (auth regex): the regex is wrong, the reported symptom is not.**

The regex is exactly as cited, and the CLI wording genuinely differs. The `jen`
CLI is a shell script, so its success branch is readable directly:

```
$ grep -n "Jenkins auth:" $(command -v jen)
928:    echo "Jenkins auth:  OK — ${fullname}"
930:    echo "Jenkins auth:  NOT reachable"
```

So `OK`, not `reachable` — the plan is right that the success regex matches a
word the CLI never prints on the success path.

**But the plan's stated outcome is false.** It says (`:42-43`):

> So the match fails and `classify` falls through to `failed` or `unknown` —
> the report says `failed`.

I traced it. `classify` is:

```
$ awk 'NR>=235 && NR<=242' skills/plot/scripts/plot-board-probe.sh
classify() {
  local out="$1" status="$2" ok_re="$3"
  if printf '%s' "$out" | grep -qiE "$ok_re"; then echo ok
  elif [ "$status" -ne 0 ]; then echo failed
  else echo unknown
  fi
}
```

`failed` requires a **non-zero exit**. Read the CLI's own success branch:

```
926:  if [[ -n "$result" ]]; then
927:    fullname="$(echo "$result" | jq -r '.fullName // .id // "?"')"
928:    echo "Jenkins auth:  OK — ${fullname}"
929:  else
930:    echo "Jenkins auth:  NOT reachable"
931:    [[ "$jsrc" == "none" ]] && echo "  No Jenkins token..."
932:    exit 1          <-- ONLY the failure path exits non-zero
933:  fi
```

The `OK` branch falls through to `return 0`. So an authenticated `jen` exits
**0**, and `classify` returns **`unknown`**, never `failed`. Simulated against
the probe's own block with a stub reproducing the real success shape:

```
$ # stub prints the four real lines + "Jenkins auth:  OK — jan.wloka@..." ; exit 0
REAL-SHAPE EXIT=0
RESULT=unknown (classify arm)
```

And directly on `classify`:

```
classify(status=0) -> unknown
classify(status=1) -> failed
classify(status=2) -> failed
```

**The reported `"auth": "failed"` therefore did NOT come from the regex defect.**
`failed` requires a non-zero exit, which the CLI produces only when Jenkins is
genuinely unreachable. I reproduced the reporting repository's exact instance on
this machine:

```
$ jen -I "jenkins-ci-apps.internal.quatico.dev/quaweb/continuous-build" auth status
EXIT=1
Keycloak:      signed in
Instance:      jenkins-ci-apps.internal.quatico.dev/quaweb/continuous-build (...)
Secret store:  keychain
Jenkins token: stored (keychain), user jan.wloka@quatico.com
Jenkins auth:  NOT reachable
```

The CLI itself says **NOT reachable**, exit 1. The probe read `failed` and
`failed` was **the correct answer for that run**. The plan's headline — "reported
`jen auth: failed` against an authenticated CLI" — conflates *Keycloak signed in
with a stored keychain token* with *Jenkins reachable*. Those are different
facts, and the CLI distinguishes them on the very line the probe reads. The
adopter held a valid Keycloak token **and** an unreachable Jenkins.

**So: a real latent regex bug that has never yet produced a wrong reading, and a
reported symptom whose actual cause is elsewhere (or is not a bug at all).**

## 2 — Right fix, or a symptom?

**Defect 2: right fix, right level.** Bounding the search and stating the cost in
the script is the correct shape, and the precedent is real:

```
$ grep -n "corpora" skills/plot/scripts/plot-deliverable-search.sh | head -3
21:# WHAT IT SEARCHES IS NAMED, NOT GUESSED — four corpora, the four places those
37:# CLI*. Measured — `gh` matches **30 files** across the four corpora together,
```

**Defect 1: the fix is right, the gate is wrong.** Widening the regex to match
`OK` is correct and narrow. But because the true reading is `unknown` and not
`failed`, the *stated* consequence (§1's "repair for nothing") does not follow
from this defect. The skill table confirms the two readings route differently:

```
$ grep -n "failed\|unknown" skills/plot-board-setup/SKILL.md | sed -n '5,7p'
433:| `failed` | not authenticated — name the exact fix, e.g. `jen -I apps auth login` |
434:| `unknown` | **cannot verify** — say so; never round it up to authenticated |
```

An authenticated user is sent to `unknown` → "cannot verify", not to
`auth login`. That is a real defect (a verifiable success reported as
unverifiable) but it is **the plan's own "what this does not do" case**: the plan
says at `:95-97` "It does not change what `unknown` means... This fixes a false
`failed`, not the refusal that sits beside it." There is no false `failed` to
fix. The plan is fixing the refusal it says it is not touching.

## 3 — Does `Done when` contain a non-plumbing gate?

**Yes for both slices**, and this is the plan's strongest section.

Slice 1: *"`Jenkins auth: NOT reachable` still reads `failed` and is tested
**before** the success arm, pinned by a fixture that contains both words"* — a
fixture containing both words cannot pass by plumbing; ordering is behaviourally
observable. *"an unrecognised line still reads `unknown` and never `ok`"* is a
genuine negative gate.

Slice 2: *"a Jenkinsfile inside `node_modules` or a test fixture directory does
**not** make it `true`, pinned by a fixture that contains one"* — a real negative
gate, unsatisfiable by threading a value through. *"cost measured and stated in
the script, not assumed"* is an artefact gate.

**But slice 1's first gate is wrong as written**: *"a captured
`Jenkins auth:  OK — <user>` line reads `ok`"* is correct, while the plan's
premise text says that line currently reads `failed`. An implementer reading
§1 will write a regression fixture asserting the *pre-fix* value is `failed`,
and it is `unknown`. The gate and the premise disagree.

## 4 — Claims I could not verify, or found false

**FALSE — the central symptom.** "`classify` falls through to `failed` or
`unknown` — the report says `failed`" (`:42-43`). With exit 0 it is `unknown`,
deterministically. Shown in §1.

**FALSE — `plot-host.sh:677` exits 3 at the first build lookup** (`:76`).

```
$ awk 'NR>=676 && NR<=678' skills/plot/scripts/plot-host.sh
676:  while IFS= read -r candidate; do
677:    [ -n "$candidate" ] || continue
678:    if ci_looks_like_host "$candidate"; then
```

Line 677 is a `continue` inside a host-candidate loop — not an exit, not a build
lookup. The real refusal the plan means is `jenkins_no_instance()` at
**:913-919** (`exit 3` at :918), and even that fires on a **missing
`Jenkins instance` key**, not on a missing `CI:` key. The causal chain
"`silent` → no `CI:` key → `:677` exits 3" is not demonstrated; a repo with no
`CI:` key takes a different path.

**WRONG LINE — the ordering comment.** The plan cites `:264` for
`not reachable`-before-`reachable`; it is at **:263**, with the comment at :262.
`:266` for the success regex is correct.

```
262:     # `NOT reachable` must be tested BEFORE `reachable`, since it contains it.
263:     if printf '%s' "$out" | grep -qiE 'jenkins auth:[[:space:]]*not reachable'; then
266:       jen_auth=$(classify "$out" "$st" 'jenkins auth:[[:space:]]*reachable')
```

**TRUE.** The `:229`-area exit-0 comment is real (at :228-231). `proposeCi`
answers `silent` on no signals — `fromSignals` at `rules/stack.ts:478-479`
returns `{ answer: 'silent' }` for zero present signals, asserted at
`stack.test.ts:278`. The probe header's "It DECIDES NOTHING" is at `:13`. The
three-Jenkinsfile layout and the `gh_workflows` directory model are both as
described.

**UNVERIFIABLE.** The reporting repository is not on this machine, so the
`find` listing of three Jenkinsfiles is taken on trust — but it is
self-consistent and the defect follows from `:130` regardless.

## 5 — What the plan missed (premise lens)

**1. A passing test already asserts the plan's premise is false — and slice 1
would break it.**

```
$ awk 'NR>=361 && NR<=379' test/reconcile/boardprobe.test.mjs
361: test('probe: jen NOT reachable reads as failed even though it exits 0', () => {
362:   // MEASURED 2026-08-18: `jen -I <slug> auth status` exits 0 and prints
363:   // "Keycloak: signed in" for a slug that does not exist. Only the last line
364:   // distinguishes reachable from not — the exit code cannot.
...
376:       exit: 0,
379:   assert.equal(probe(r, { env: isolatedPath(stub) }).jen.auth, 'failed');
```

This fixture exits **0** and expects `failed` — which only works because the
`not reachable` arm at :263 fires *before* `classify`. The plan never mentions
this test. Slice 1 must keep it green, and the plan's "tested before the success
arm" gate is exactly it — so the gate is satisfiable by an **existing** test,
which weakens it. The plan should say the existing test is the baseline.

**2. `probe: jen reachable reads as ok` (:341-359) pins a fixture the CLI never
emits.** It asserts `Jenkins auth:  reachable` → `ok`. Per the `jen` source that
string does not exist; the real one is `OK — <user>`. The fix must decide
whether to keep the old fixture (documenting a wording that was never real) or
replace it. The plan's "keeping ... the exit-code fallthrough" does not address
it, and two other tests (:444, :504) reuse the same unreal stdout.

**3. The instance in the report contains a job path, which the probe treats as
the whole instance.** The reported instance is
`jenkins-ci-apps.internal.quatico.dev/quaweb/continuous-build`. The probe passes
it whole to `jen -I`, and I reproduced `NOT reachable` with it. `:279-302`
already documents this slug-vs-job-path hazard (#913). The plan should rule out
that the reported `failed` is that known defect rather than this one — as
measured, it is at least as likely.

**4. Fixing only the regex could turn a true `failed` into a false `ok`.** If a
future `jen` prints an `OK`-shaped line while exiting non-zero, the widened
regex wins over the exit code — `classify` tests the regex *first*. Given the
plan's own rule that a false green is the direction that must never happen, the
success arm deserves a gate that the plan does not state: `ok` requires the
success wording **and** a zero exit.

---

### What would move me to `proceed`

- Rewrite §1 to say the reading is **`unknown`**, not `failed`, with the
  exit-code trace; drop or re-argue the `auth login` consequence.
- Replace the `plot-host.sh:677` citation with `:913-919`, or drop the claim.
- Correct `:264` → `:263`.
- Name `boardprobe.test.mjs:341` and `:361` as the tests slice 1 must reconcile,
  and say what happens to the unreal `reachable` fixture.
- Either separate the #913 job-path hypothesis from this one, or state why the
  reported run is not that.

Slice 2 I would approve as written.
