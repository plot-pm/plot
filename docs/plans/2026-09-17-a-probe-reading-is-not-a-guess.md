# A probe reading is not a guess

> The probe's auth regex matches a word the CLI never prints on success, so a verifiable Jenkins reads as unverifiable; and a Jenkinsfile below the root reads as no CI at all.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #929
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-17, jwloka, in-session
- **Started:** 2026-09-17, Jan Wloka, `bug/the-auth-reading-matches-the-cli`
- **Started:** 2026-09-17, Jan Wloka, `bug/a-jenkinsfile-is-found-where-it-lives`

## Changelog

- `plot-board-probe.sh` reads a reachable Jenkins as `ok` rather than `unknown`, and finds a Jenkinsfile that lives in a subdirectory. The first is a latent defect that turns a verified success into *cannot verify*; the second was measured false on a real repository and makes adoption skip the `CI:` key entirely.

<!-- Board impact: adoption reads this probe. No plan format, no template,
     no layout. -->

## Design

**Two readings, one run, both contradicted by the tool that owns the answer.**
Reported 2026-09-17 on a Bitbucket repository tracking in Jira:

```json
"jen": {"installed": true, "auth": "failed",
        "instance": "jenkins-ci-apps.internal.quatico.dev/quaweb/continuous-build"},
"ci_signals": {"jenkinsfile": false, "gh_workflows": false}
```

### 1 — the auth regex names a word the CLI does not print

`plot-board-probe.sh:266` tests the success case as
`'jenkins auth:[[:space:]]*reachable'`. The CLI prints:

```
Jenkins auth:  OK — jan.wloka@quatico.com
```

**`OK`, not `reachable`.** So the success match never fires.

**Where that lands is `unknown`, not `failed`** — traced through `classify`
(`:236`) and confirmed by running it:

```
classify(status=0) -> unknown
classify(status=1) -> failed
```

`failed` requires a **non-zero exit**, and `jen` exits non-zero only on its
failure branch (`exit 1` beside `NOT reachable`); the `OK` branch falls through
to 0. **So a reachable Jenkins reads `unknown`.**

### The reported `failed` was correct, and saying so is the point

An earlier version of this plan read the report's `"auth": "failed"` as this
defect's symptom. It is not. Re-measured 2026-09-17 against the reporting
instance, three consecutive runs:

```
run 1: exit=1 :: Jenkins auth:  NOT reachable
run 2: exit=1 :: Jenkins auth:  NOT reachable
run 3: exit=1 :: Jenkins auth:  NOT reachable
```

**The adopter held a signed-in Keycloak session, a stored keychain token, and an
unreachable Jenkins.** The CLI separates those three facts on the line the probe
reads, and `failed` was the right answer for that run.

**The defect is latent and still worth fixing**, because the reading it corrupts
is the one nobody will question: a success that reports as *cannot verify* looks
like caution rather than a bug.

### The word is pinned by three tests that share the invention

```
$ grep -n 'reachable' test/reconcile/boardprobe.test.mjs
341:test('probe: jen reachable reads as ok', () => {
351:        'Jenkins auth:  reachable',
444:  const stub = stubClis({ jen: { stdout: 'Jenkins auth:  reachable' } });
```

**`Jenkins auth:  reachable` is a string the CLI never emits.** Three fixtures
assert against it, all green, and none of them says anything about the real
tool. That is the shape `CLAUDE.md` warns of — a test that answers *did I build
this?* with yes without it being true.

**So the decision is made here rather than left to the implementer: REPLACE the
word, do not add it.** `ok|reachable` would keep both green and keep the fiction
alive, and the next reader would find two accepted wordings with no way to tell
which the CLI uses. The three fixtures are rewritten to the CLI's own line,
captured rather than composed.

**The surrounding reasoning is right and is what makes this narrow.** The
comment at `:229` records that `jen … auth status` exits 0 for a slug that does
not exist, so only the `Jenkins auth:` line carries the answer; `:264` tests
`not reachable` *before* `reachable` because one contains the other. Both hold.
**What is wrong is one word in one regex**, and the fix must not widen the line
it reads.

**The consequence is a setup that cannot confirm what it just verified.**
`plot-board-setup/SKILL.md:434` routes `unknown` to *"cannot verify — say so;
never round it up to authenticated"*, which is the **safe** direction and stays.
What it costs is the probe's own purpose: an adopter whose Jenkins answers is
told the probe could not tell, on the one signal the setup exists to establish.

**That is quieter than a wrong repair and harder to notice**, which is the
argument for fixing it rather than the argument this plan first made.

### 2 — the Jenkinsfile test reads one path

`plot-board-probe.sh:130`:

```sh
[ -n "$git_root" ] && [ -f "$git_root/Jenkinsfile" ] && jenkinsfile=true
```

The reporting repository keeps three:

```
.build/pipelines/website/continuous-build/Jenkinsfile
.build/pipelines/website/continuous-deploy/Jenkinsfile
.build/pipelines/website/release/Jenkinsfile
```

**A repository that keeps its pipelines in a directory reads as having no CI.**
`proposeCi` then answers `silent` and setup writes no `CI:` key, so the Jenkins
instance question is never asked either — and a board with no `CI:` resolves its
build port to the arm that fetches nothing. **The earlier draft cited
`plot-host.sh:677` as an `exit 3` here; that line is a candidate loop and the
citation is withdrawn rather than replaced**, because the outcome does not need
it: no `CI:` key is itself the failure the setup skill exists to prevent.

### The search must be bounded, and the bound is the finding

**A bare `find` over a repository is the wrong fix.** `node_modules` alone makes
it slow, and a vendored fixture Jenkinsfile would be a false positive in the
other direction.

**The probe already owns this problem elsewhere**: `plot-deliverable-search.sh`
searches four named corpora rather than the tree, for exactly this reason, and
its header records that an unbounded search was tried and abandoned.

**So the bound is named here rather than left to the implementer**:
`find -maxdepth 5` from the repository root, excluding `node_modules`, `.git`,
and the configured `Worktree root`.

**Five, and the number is measured rather than counted.** The reporting
repository's hit is `.build/pipelines/website/continuous-build/Jenkinsfile`, and
`-maxdepth` counts path components from the start point rather than directories:

```
-maxdepth 3 -> 0 hit(s)
-maxdepth 4 -> 0 hit(s)
-maxdepth 5 -> 1 hit(s)
```

An earlier draft of this paragraph said four, reasoning that the file sits four
directories down. It does, and `-maxdepth 4` finds nothing — **the off-by-one is
exactly the defect this plan exists to fix, made once more in its own Design.**

The implementer measures the cost on this repository and states it in the
script; **what they do not decide is the shape**, because a bound chosen during
implementation is a bound nobody reviewed.

**`gh_workflows` is the model that already works** — `:132` tests a known
directory, not a path.

### What this does not do

**It does not change what `unknown` means.** A probe that cannot reach the CLI
still answers `unknown`, and `unknown` still never reads as authenticated. This
fixes a false `failed`, not the refusal that sits beside it.

**It does not make the probe decide.** `plot-board-probe.sh`'s header says *"It
DECIDES NOTHING"*, and the thresholds live in `proposeStack`. A corrected
reading reaches the same rule.

**It does not add a Jenkinsfile parser.** Whether a file is a valid pipeline is
Jenkins' question; the probe answers *does one exist*.

## Slices

### The auth reading matches what the CLI prints (Branch: bug/the-auth-reading-matches-the-cli, PR: #937)

- `bug/the-auth-reading-matches-the-cli` — match the `Jenkins auth:` line's actual success wording, keeping the `not reachable`-before-`reachable` order and the exit-code fallthrough

**Done when** a captured `Jenkins auth:  OK — <user>` line with **exit 0** reads
`ok`, pinned by a fixture holding the CLI's real output — and the same fixture
pinned to read `unknown` **before** the fix, since that is the pre-state and a
test asserting `failed` would pass for the wrong reason; `Jenkins auth: NOT reachable` still
reads `failed` and is tested **before** the success arm, pinned by a fixture
that contains both words; an unrecognised line still reads `unknown` and never
`ok`; a `jen` that is absent, or an instance that is unset, reads exactly as
today; **the three fixtures at `boardprobe.test.mjs:351`, `:444` and `:504` no
longer contain the string `Jenkins auth:  reachable`**, pinned by asserting its
absence from the file, since leaving one would re-admit the wording the fix
removes; and `pnpm run test:contracts` passes.

### A Jenkinsfile is found where a repository keeps it (Branch: bug/a-jenkinsfile-is-found-where-it-lives, PR: TBD)

- `bug/a-jenkinsfile-is-found-where-it-lives` — find a Jenkinsfile below the repository root within a stated, measured bound, excluding the directories that would make it slow or wrong

**Done when** a repository with `Jenkinsfile` at its root still reads `true`,
unchanged; one keeping `.build/pipelines/website/continuous-build/Jenkinsfile` — the
reporting repository's real depth — reads `true`, pinned at that exact path
rather than a shallower stand-in; a
repository with none reads `false`; a Jenkinsfile inside `node_modules` or a
test fixture directory does **not** make it `true`, pinned by a fixture that
contains one; the search's cost on this repository is **measured and stated in
the script**, not assumed; and `pnpm run test:contracts` passes.

## Notes

**Reported 2026-09-17 with both contradictions shown side by side** — the
probe's JSON beside the CLI's own output and a `find` listing three files.

**Two slices because the two halves share nothing**: one is a regex over a
captured line, the other is a filesystem search with a cost argument. They land
in the same file and in the same report, which is not a reason to make them one
change.

**The setup skill's own rule is what the second defect breaks** — *prove, don't
assert*. The probe reads one path and asserts a fact about the repository.

**Amended 2026-09-17 after a two-lens panel**
(`.plot/panels/2026-09-17-a-probe-reading-is-not-a-guess/`), which found the
first defect's symptom and consequence stated backwards: `classify` answers
`unknown` on a zero exit, and the reported `failed` was correct for its run. The
regex defect survives unchanged; what it harms does not.

**The panel's own blind spot is recorded here because it is this plan's too**:
both jurors reasoned from the probe's source and neither ran it. Every claim
above about what the probe *reports* is derived rather than observed, and the
two slices' fixtures are what convert them — which is why each `Done when` pins
a captured CLI line rather than a described one.
