# Manual test list — 2.16.0

**The release's claim is the sprint's goal, not the changeset list.** `the-jenkins-team-sees-its-builds` promises one thing:

> **A teammate on Bitbucket and Jenkins clones a repository, runs `/plot-init`, and sees real build status on the board — without being told which keys to set.**

Five conditions, all of which must hold: **proposed**, **connected**, **verified**, **counted**, **judged**. This list tests *that*, and reaches for the 29 changesets only where one of them carries a claim the suites cannot decide.

## What the suites already decided

| suite | files | result |
|---|---|---|
| `@plot-pm/domain` | 101 | **2426 pass, 0 fail** — measured on main, 2026-09-10 |
| `test/reconcile` | 77 | **1585 pass, 0 fail** — CI on `072b693fb`; a local run reported 1 failure on the same commit |
| board vitest | 163 | CI measured 3008 pass, 0 fail on the last branch |
| `packages/domain/corpus` | 8 | adapters vs production, live estate |
| `test/e2e` | 12 | CI's gate, not a local run |

A changeset whose claim is *"the rule returns X"* is **not** in this list — a test decided it.

**The contract suite is load-flaky too, and by the same amount.** CI on `072b693fb` reported **1585 pass, 0 fail** in about five minutes; the identical commit run locally reported **1 failure in 1106 seconds**. A local red here is a second measurement away from meaning anything.

**The board suite is load-flaky on a working machine, and that is measured rather than suspected.** Measured 2026-09-10 on this estate: the full `test/unit` run reported **16 failures across 6 files**, the same six passed **76/76 run serially**, and CI reported **1 failure of 3008** on identical code. `2d8f741d0` states the rule this repo settled on — *one failure is the load, two at the same assertion is a defect*. Do not cut on a local red board suite without the second measurement.

---

## 0 — The release gate refuses, and the refusal is correct

**Run it first, because it decides whether the rest of this list is worth your time.**

```bash
skills/plot/scripts/plot-release-gate.sh
```

**Measured 2026-09-10 on main:**

```
plot-release-gate: must-haves-open — 2 unfinished Must Have(s):
  [the-run-ops-ask-the-ci-backend] — checked in the sprint, but the plan is not delivered
  [a-sprint-transition-is-performed] — checked in the sprint, but the plan is not delivered
Deliver them, move them to Deferred, or pass --ignore-sprint.
```

**Both items shipped.** `the-run-ops-ask-the-ci-backend` is PR #837 (+461/−72, `plot-host.sh` and `build-actions.ts`); `a-sprint-transition-is-performed` is PR #839 (+874/−21). Their code is on main and their boxes are ticked.

**What is missing is a plan file, and the gate is right to say so.** Both merged as PRs with no plan, so `/plot-deliver` never ran against them — the `Delivered:` record that the gate reads does not exist, and cannot be written by ticking a box. This is the same gap `a-lifecycle-field-has-one-writer` names, and it is not a bookkeeping annoyance: the estate has no record that anybody verified those two slices.

- [ ] **Decide before cutting:** write the two plans and deliver them, move both to Deferred, or cut with `--ignore-sprint` and say so in the release note.
- [ ] If cutting with `--ignore-sprint`: the note states that two Must-Have slices shipped **without a delivery record**, not that they were verified.
- [ ] Either way, the escape is recorded — `--ignore-sprint` clears the sprint gate and **nothing else**.

**Do not tick a box to clear this gate.** The box is already ticked; the gate reads the plan estate, which outranks it in exactly this direction.

---

## 1 — The five conditions, measured

Each is a number or a file. Run it, read it, and the claim is settled or it is not.

### proposed — a first run proposes the CI system from what the repo shows

```bash
skills/plot/scripts/plot-detect-repo.sh | python3 -m json.tool | grep -A3 ci_signals
```

**Expect** `{"jenkinsfile": false, "gh_workflows": true}` on this repository. Then the judgement, which is the domain's and not the probe's:

```bash
skills/plot/scripts/plot-detect-repo.sh \
  | node skills/plot/scripts/board/plot-propose-stack.mjs \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ci"]); print(d["ciInstance"])'
```

**Expect** `{"answer": "propose", "proposed": "github-actions", "evidence": "`.github/workflows/`"}` and an instance proposal of `none` — this repo runs no Jenkins.

**The field is `ci_signals`, not `ci_system`.** Six places in `/plot-init`'s docs named the latter, which no code has ever read; a probe emitting that name produces `ci: null` — *nobody looked* — indistinguishable from the field being absent. If you see `ci: null` on a repo that plainly has CI, check the field name before anything else.

- [ ] **On a real Jenkins repository** (the sprint used `quaweb-website`): `ci_signals.jenkinsfile` is `true` and the proposal is `jenkins` with the instance slug, asking only for the job path.
- [ ] The Jenkinsfile search is not root-only. That repo keeps three at `.build/pipelines/<project>/<pipeline>/Jenkinsfile`; a root-only probe reads it as having no CI at all.
- [ ] **Two signals ask rather than tie-break.** A tree with both a `Jenkinsfile` and `.github/workflows/` answers `ask` and carries **no** `proposed` word — a caller must not be able to read half an answer.

### connected — the Jenkins answer reaches the port every reader uses

```bash
grep -c "case 'jenkins'" packages/domain/src/adapters/build/build-resolve.ts   # 1
ls packages/domain/src/adapters/build/                                          # build-jenkins.ts present
```

- [ ] `buildFor('jenkins', ctx).system()` answers `'jenkins'`, not `''`. It answered `''` through 2.15.0, which is what `build-resolve.ts:22` called *"the honest answer while `build-jenkins.ts` does not exist."*
- [ ] `runs` on a Jenkins repo returns **one** entry — a current state reported as a history of one — with `startedAt` and `url` **empty** rather than invented.
- [ ] `runForSha` answers `unaskable`, and `lastRefusal()` is **null**. Exit 4 is not a refusal (`build-shell.ts:133`): a caller retrying on `lastRefusal()` must not wait for something no wait makes askable.
- [ ] With no `Jenkins instance` key, the connector reports the refusal rather than an empty history. A repository whose instance is unset **has not been asked**, which is not the same as a branch that never built.

### verified — the connector's shape was read from a real instance

**Both halves are measured; this checks they still hold.**

```bash
export JENKINS_INSTANCE=<your instance>
jen -I "$JENKINS_INSTANCE" auth status          # Keycloak signed in, Jenkins token stored
jen build list <job> --json | head -40
```

- [ ] `jen` answers build history — `id`, `status`, timings, stages — and **no** commit sha. A search of the whole payload for `sha|commit|revision|scm` matches nothing.
- [ ] The sha **is** askable over REST, at `actions[].lastBuiltRevision.SHA1`:

```bash
H=<your instance>
JU=$(security find-generic-password -s jen -a "jenkins-user:$H" -w)
JT=$(security find-generic-password -s jen -a "jenkins-token:$H" -w)
curl -su "$JU:$JT" "https://$H/job/<path>/<n>/api/json" | grep -o 'lastBuiltRevision'
```

**The credential is the trap.** `jen auth token` prints a **Keycloak bearer**, and Jenkins answers that with an HTML login redirect — a measurement using it concluded the sha was unreachable, and the transport was wrong rather than the answer. The working credential is the Jenkins API token in the login keychain, service `jen`, account `jenkins-token:<host>`.

- [ ] **Known gap, and the release must not claim otherwise:** `plot-host.sh`'s jenkins `run-for-sha` arm exits 4 and `build-jenkins.ts` answers `unaskable`. Both are honest; neither has been taught the REST route. A Jenkins team gets **branch-level** build status, not sha-scoped merge gating.

### counted — a slice that carried no work is not counted as delivered

```bash
gh pr view <a merged slice PR> --json files | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["files"]))'
```

- [ ] `/plot-deliver` distinguishes a PR that carried work from one that carried a marker. Two slices passed that gate in 2.15.0 and nothing reported it — PR #811 merged **zero files** and #821 merged a `PLOT-BLOCKED.md`.
- [ ] **Both of those items were ticked by those empty PRs**, and stayed ticked for two days. A ticked box is not evidence; check the diff.

### judged — a setup decision is a domain property, not prose

```bash
echo '{"ci_signals":{"jenkinsfile":true,"gh_workflows":true}}' \
  | node skills/plot/scripts/board/plot-propose-stack.mjs
```

- [ ] Answers `ask` with both signals listed and no proposed word — the rule *one signal proposes, two signals ask*, which was a paragraph in `/plot-board-setup` until this sprint.
- [ ] `node >= 20`, the three commit-style counts, the ticket-prefix floor and the language count are `proposeStack`'s, not the collectors'.

---

## 2 — The board names which CI answered

**Start a board and read one line.** This is the release's only user-visible change on the board.

```bash
skills/plot/scripts/plot-board-verify.sh skills/plot/scripts/board/board-server.mjs \
  | grep -o '"ci":"[^"]*"'
```

**Expect** `"ci":"GitHub Actions"` on this repository — the reader's word, not the config key.

- [ ] On a Jenkins team, a board that cannot reach its CI says **"Checks not asked — Jenkins reports none for any pull request here."** It said *the host* through 2.15.0, which a reader cannot tell from a stack with no CI at all.
- [ ] The sentence is said **once per board**, not once per row. One unreachable service is not seventy-two findings.
- [ ] A CI system with no display-name entry shows as its config key rather than a placeholder — honest about which system was asked.
- [ ] **The vendor names live in `server-info.ts` and not in the domain.** `grep -rn "GitHub Actions" packages/domain/src/` returns comments only; CI's *domain names no vendor* gate enforces it.

---

## 3 — Where the automated suites do not reach

**Read this before deciding what to test by hand.** Measured 2026-09-10 across 360 test files.

**What is covered better than the docs suggest.** `CLAUDE.md` says *"behavioral testing is manual"* and *"the skills have no unit tests"*. Both understate the estate: **75 of 77** contract tests execute a script rather than asserting its prose, and **47 of 52** helper scripts are named by some test.

**The five scripts no test names:** `plot-estate-changed.sh`, `plot-release-gate.sh`, `plot-review-status.sh`, `plot-sprint-state.sh`, `plot-undeliver.sh`. Four of the five wrap a domain rule that **is** tested — the untested part is the shell half that reads the file and performs the write.

**The real gap is the release itself.**

| what e2e walks | Draft → Approved → Delivered |
|---|---|
| what e2e never walks | **Delivered → Released** |

`test/e2e/lifecycle.test.mjs` names `Delivered` five times and `Released` zero. No automated test cuts a tag, writes a `Released:` record, or runs `plot-release-gate.sh` — and a release is the one action nobody can undo.

- [ ] **So the release path is tested by this list and nothing else.** Walk §0 and §4 by hand, every time.

**Three more surfaces with no automated reach**, each already the cause of a real defect this cycle:

- [ ] **Skill prose against the code it describes.** Six references to `ci_system` survived because every test in `init-stack.test.mjs` asserted prose. Two new tests now execute the probe; the rest of the estate still does not.
- [ ] **The launchd path.** CI runs `ubuntu-latest`, so `systemd-analyze verify` gates the systemd unit and **nothing gates launchd** — the path every macOS operator uses. Measured 2026-09-10: `--status` reports `supervisor: running` for a job stuck in `spawn scheduled` that ticks nothing, because it asks whether launchd *knows the label*.
- [ ] **A stale checkout answering a question about main.** Three readings this cycle were wrong because a helper read the working tree while the fact lived on `origin/main`. Run release-time checks from a **detached checkout of `origin/main`**, not from a feature branch.

---

## 4 — Cutting the release

- [ ] `git worktree add --detach <tmp> origin/main` — every check below runs there, for the reason in §3.
- [ ] `pnpm install && pnpm --filter @plot-pm/domain run test` — expect 101 files, 2426 pass.
- [ ] `pnpm run test:contracts` — expect 1585 pass, 0 fail. A local failure here is load until a second run repeats it at the same assertion; **CI is the authority for this suite**, and it runs it on every push to main.
- [ ] `pnpm run build:board && git status --short` — **must be empty**. A stale artifact failed CI twice this cycle; the gate is separate from every test.
- [ ] `./scripts/check-changeset-packages.sh` — every changeset names a real package and says what changed.
- [ ] `skills/plot/scripts/plot-release-gate.sh` — §0. Nothing is tagged until this is answered.
- [ ] The version in `package.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` agrees, and is at least as high as the largest skill bump in the release.
- [ ] **The release note states the two known gaps by name:** sha-scoped Jenkins gating is absent (§1 *verified*), and two Must-Have slices shipped with no delivery record (§0).

**Nothing here tags.** `/plot-release` and the operator own that, and the gate decides the gate rather than the release — a release is the one action nobody can undo.
