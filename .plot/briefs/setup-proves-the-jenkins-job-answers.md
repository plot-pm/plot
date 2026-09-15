## Implementation brief — setup-proves-the-jenkins-job-answers

- **Plan (canonical):** `docs/plans/2026-09-15-setup-proves-the-jenkins-job-answers.md` on `main`
- **Approved:** 2026-09-15, jwloka, in-session
- **Branch:** `bug/setup-proves-the-jenkins-job-answers` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

Sole slice. Nothing waits on it and it waits on nothing.

### What to build

**A `Jenkins instance` value naming no job path passes adoption as verified, and the board it produces has no build state at all.** Filed as #913 from a live adoption: the config carried the slug alone, `/plot-board-setup` reported healthy, and every PR on the board rendered `checks: unknown` under *"WAITING ON A MACHINE — could not reach the host"*. Measured with `pr-list --rich` on that instance: slug only → **no rows**; `<slug>/quaweb/continuous-build` → **4 PRs, all `checks: green`**.

Add the job-path reading to `skills/plot/scripts/plot-board-probe.sh`, beside the `jen_auth` reading it already emits, and have `/plot-board-setup` refuse the key on it. The probe collects and reports; the skill interprets and refuses. That split is what makes the gates executable — a test can call the probe, and it cannot call skill prose.

The plan is canonical; this orients you.

### The decisions the plan settles — do not re-derive them

**Asking Jenkins does NOT distinguish the defect, and the first draft of this plan got it wrong.** Measured live 2026-09-15 against the #913 instance, a slug-only value resolves a **non-empty** job list — `demos (Folder), quaweb (Folder), set-image-name (WorkflowJob), webbloqs-website (Folder)`. Four entries, not zero. So a gate pinning *"resolves zero branch jobs"* pins a behaviour this estate never produces; the only way to green it is to stub an empty array, which is a Jenkins with no jobs at all — the case the plan calls legitimate. **Do not add a `jen job list` call.** The distinction lives in the config value and a live call cannot make it.

**`${value#*/}` is the wrong test, and `plot-host.sh:3197` carries the same latent bug.** `plot-host.sh:616` accepts a URL form (`case "$1" in https://*|http://*) return 0`), and the naive split measured across all four forms:

```
jenkins.example.com                   → job=''                               refuse  ✓
jenkins.example.com/quaweb/cb         → job='quaweb/cb'                      accept  ✓
https://jenkins.example.com/          → job='/jenkins.example.com/'          ACCEPT  ✗
https://jenkins.example.com/quaweb/cb → job='/jenkins.example.com/quaweb/cb' host glued on ✗
```

A URL with no job path is **accepted while being exactly the #913 defect**, and a URL with one produces a job path carrying the host. The bare-hostname case is refused correctly **by accident** — hostnames have no slash. **Strip the scheme and authority before splitting.**

**Fix the test here; do not promote `plot-host.sh`'s copy.** In `plot-host.sh` the bug is confined to one op that exits 4. Turning it into a refusal that blocks adoption widens the blast radius. **This branch does not change `plot-host.sh`** — its resolution is correct, only the adoption check is missing.

**Refuse the key; do not record it with a finding.** `plot-board-setup/SKILL.md:272-281` already settles the severity on this exact key: *"A wrong instance is worse than an absent one — `jen -I <bogus> auth status` prints `Keycloak: signed in` and exits 0, so a guessed slug buys a green light that verifies nothing. Write no `Jenkins instance` key."* Follow that shape. A finding an adopter must never act on trains them to skip the run where it is real.

**The failure is narrower than "setup reports green", and that is the whole bug.** `jen_auth` already returns `unknown` when **no** instance resolves (`plot-board-probe.sh:260-263`), and step 4a maps `unknown` to *cannot verify*. So a **missing** key is already refused correctly. The defect is that a **present but incomplete** value reads `ok` while a wholly absent one reads `unknown` — **a partial value scores strictly better than no value**, which is the worse of the two failures.

**`PLOT_JENKINS_JOB` makes a slug-only value legitimate.** `plot-host.sh:3197` honours it and so must this. A slug-only value **with** the override set is **accepted**; this is the one case a pure shape test gets wrong, which is why the plan pins it explicitly.

**No new config key.** The job path rides the instance value, by `plot-host.sh:704-708`'s reasoning: a multibranch container is the *parent* of the branch and cannot be derived from it.

**The deploy side is out of scope.** [`a-jenkins-job-is-read-by-its-shape`](../../docs/plans/2026-09-15-a-jenkins-job-is-read-by-its-shape.md) delivered today and owns it. That plan fixed a reader that could not read a plain job's state; this one stops a config naming no job at all from passing as verified. Different defects.

#### What you will find in the probe, which the plan does not spell out

**The existing `jen` block is gated on `jen` being installed** (`plot-board-probe.sh:247-264`: everything sits inside `if [ "$jen_installed" = true ]`). The job-path reading is a **string test on a config value** and must answer whether or not `jen` is on PATH — so it belongs **outside** that conditional. Read the already-resolved `$jen_instance`, which falls back to `$JENKINS_INSTANCE` at line 249; do not re-read config.

**"Makes no network call" scopes the NEW reading, not the block above it.** `jen -I "$jen_instance" auth status` at line 251 is an existing, correct network call and stays. Removing it would break `jen reachable reads as ok`.

**Carried over unchanged:** the exit code decides nothing for `jen` — measured 2026-08-18, `jen -I <slug> auth status` exits 0 and prints `Keycloak: signed in` for a slug that does not exist. Only the wording carries the answer. And `NOT reachable` must be tested before `reachable`, since it contains it.

### Done when

The plan's `## Slices` → **Done when** list is the specification. Lifting the assertions that exist because a naive implementation would pass without them:

- **`https://host/` is REFUSED** — catches the `${value#*/}` split, which accepts it. This is the #913 defect wearing a URL.
- **`https://host/job/path` yields a job path NOT carrying the host** — catches stripping the scheme but not the authority.
- **A slug-only value WITH `PLOT_JENKINS_JOB` set is ACCEPTED** — catches a shape test that forgot the override. The one case a correct-looking implementation gets wrong.
- **`jen` is invoked zero times by the new reading** — catches the mechanism the plan explicitly rejected. Pin it with the existing `isolatedPath(stubDir)` helper (`test/reconcile/boardprobe.test.mjs:294`), which gives a PATH with no real `jen` on it.
- **A repo declaring no Jenkins at all still reads `unknown`** — catches a refusal that fires on absence. Setup already handles that case correctly and must keep doing so.
- **A fresh multibranch container with no children is NOT flagged** — it names a job path and is legitimate. Catches a check that went on to ask about contents.
- **A `<slug>/<job path>` value is accepted unchanged** — the control.
- The refusal sentence **names `<slug>/<job/path>` and what to check**, following `plot-host.sh:3200-3203`.
- **No new config key.**

The reading is emitted by `plot-board-probe.sh` rather than described in skill prose, pinned by a test calling the probe directly — that is what makes the seven gates above executable.

Every gate runs in this repository with no Jenkins and no fixture anybody cannot regenerate.

Plus the repo gates: `pnpm run test:contracts` passes (`test/reconcile/boardprobe.test.mjs` is the home for the new tests), `pnpm test`, and a changeset. Run `nvm use` first — pnpm crashes on Node 26. `test:e2e` is CI's gate, not a local one.

The probe is **strictly read-only** — it runs in a stranger's repo before anything is agreed to. Create, modify and delete nothing.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # --draft while the work is moving
```

**Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

**Changeset:** describe the change first, `bumps:` block last — a `bumps:` block written first becomes the published release note. `plot-board-setup` takes the bump; `plot` if the probe change is read as cross-cutting.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-board-probe.sh` — the new job-path reading and its JSON field
- `skills/plot-board-setup/SKILL.md` — the refusal, in the shape of lines 272-281
- `test/reconcile/boardprobe.test.mjs` — the gates
- `.changeset/`

**Do not touch `skills/plot/scripts/plot-host.sh`.** Its latent `${value#*/}` bug is named above and deliberately left alone.

No other branches are in flight — `origin` carries only `main` and `changeset-release/main`. Note that `.changeset/` holds siblings' changesets from `origin/main`: add your own, touch none.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
