# Manual test list — 2.15.0

**The release's claim is the sprint's goal, not the changeset list.** `the-board-serves-a-team` promises one thing:

> **A teammate on Bitbucket, Jenkins and Jira runs Plot unattended from adoption to a delivered plan, and every refusal on that path tells them what to do next.**

Four conditions, all of which must hold: **adopted**, **connected**, **legible**, **unattended**. This list tests *that*, and reaches for the 7 changesets only where one of them carries a claim the suites cannot decide.

## What the suites already decided

| suite | files | result |
|---|---|---|
| `@plot-pm/domain` | 96 | **2226 pass, 0 fail** |
| `test/reconcile` | 71 | run before cutting |
| board vitest | 158 | run before cutting |
| `packages/domain/corpus` | 8 | **43 pass** — adapters vs production, live estate |
| `test/e2e` | 12 | CI's gate, not a local run |

A changeset whose claim is *"the rule returns X"* is **not** in this list — a test decided it.

**§0 of the 2.14.0 list no longer applies.** `Host reads the git host > answers the merged question with three values` was load-flaky there and passes clean in the full suite here. Do not carry that warning forward without re-measuring it.

---

## 0 — One slice of this sprint did not ship, and the release must not claim it

**`feature/the-ci-connector-is-jenkins` merged as PR #821 carrying one file: `PLOT-BLOCKED.md`.** No `build-jenkins.ts` exists. `build-resolve.ts:22` says so in its own words:

> *"`jenkins` HAS NO CONNECTOR YET and therefore resolves to none, which is the honest answer while `build-jenkins.ts` does not exist."*

```bash
ls packages/domain/src/adapters/build/          # build-actions, build-none, build-resolve, build-fixture
grep -c jenkins packages/domain/src/adapters/build/build-resolve.ts   # comments only
gh pr diff 821 --name-only                      # PLOT-BLOCKED.md
```

**The plan delivered anyway, and that is the finding.** `/plot-deliver` asks whether every branch's PR merged, not whether the PR carried the work. A blocked agent commits its marker, the marker is a commit, the PR merges, and the slice reads `merged` to every counter on the estate.

**So the sprint's own summary overstates one of four conditions.** `connected` was to be settled by a Jenkins connector answering three operations; what shipped is a port with a GitHub connector and an honest `none` for everything else.

- [ ] **Decide before cutting:** ship 2.15.0 with `CI: jenkins` resolving to `none`, or hold for the connector.
- [ ] If shipping: the release note says Jenkins CI state is **absent and declared**, not merely untested.
- [ ] Either way, re-open the slice — the plan's `Done when` is unmet.

**A teammate on Jenkins is exactly the user this sprint named.** They will see no check state on any PR, which is the condition the plan called *"not wrong; absent"*.

---

## 1 — The four conditions, measured

Each is a number or a file. Run it, read it, and the claim is settled or it is not.

### adopted — a first run does not assume GitHub

```bash
skills/plot/scripts/plot-detect-repo.sh | head -40
```

**Expect:** `git host`, ticket scheme and CI system proposed **from what the repo shows**, each with the evidence that proposed it. A repo with a recurring `ABC-123` prefix proposes `Tracker: jira` and asks for the base URL — the one fact no commit subject carries.

- [ ] Run it in a **non-GitHub** checkout. A proposal naming `github` with no evidence is the defect this condition rules out.
- [ ] Unattended (`PLOT_UNATTENDED=1`): a measured signal still proposes, and names its gap as `PLOT-UNASKED` rather than defaulting silently.

### connected — an operation is refused, never absent

```bash
grep -cE '(^|[^a-z])bb ' skills/plot/scripts/plot-host.sh     # 81
grep -cE '(^|[^a-z])gh ' skills/plot/scripts/plot-host.sh     # 65
grep -cE '(^|[^a-z])jen ' skills/plot/scripts/plot-host.sh    # 2
```

**Bitbucket is covered; CI is not.** `runs`, `run-for-sha` and `ci-limit` still reach `gh` and nothing else — see §0.

- [ ] `PLOT_HOST=bitbucket skills/plot/scripts/plot-host.sh backend` → `bitbucket`, not a silent `github`.
- [ ] An unrecognised host **refuses with exit 4** and names the word: `PLOT_HOST=gitlab skills/plot/scripts/plot-host.sh backend`.
- [ ] With no tracker declared, a status write reports `unaskable` rather than succeeding silently.

### legible — a refusal names its repair

- [ ] `skills/plot/scripts/plot-dispatch.sh --stop` with no branch → refuses **and prints the command that would work**.
- [ ] `plot-fleetctl.sh --start` under the wrong `node` → names `nvm use`, and does not fill the unit.
- [ ] A host refusal on a Bitbucket checkout must not name `gh`. This is the one a teammate hits first.

### unattended — the path needs nobody who knows Plot

- [ ] Read three refusals from §1 **as a teammate who has not read this repository**. Each says what to do next, or the condition fails.

---

## 2 — What a person must look at (7 changesets)

The release consumes seven. Five are decided by tests; two are not.

- [ ] **`one-scorer-for-a-sprint-item`** — `plot-sprint-release.sh` now asks `board/plot-sprint-score.mjs` instead of computing `item_state`. The corpus test compares them over every item on the estate; **check the hop exists on a machine with no board running**, which is the case the seam was chosen for.
- [ ] **`adoption-proposes-the-stack`** — covered by §1's `adopted` run. Nothing else here exercises a first run.

---

## 3 — What needs a real host

- [ ] One PR opened, merged and read back through `plot-host.sh` on **Bitbucket**. `pr-merged` must read `mergedAt`, never `state`.
- [ ] `issue-status` against a real Jira — the one tracker write Plot performs.
- [ ] **Not Jenkins.** There is nothing to test; see §0.

---

## 4 — The board

```bash
pnpm build:board && pnpm board
```

- [ ] A plan card shows PR checks. With `CI` unset or `jenkins`, the state reads **`none`, distinct from `unknown`** — the distinction `a-dead-fetch-is-not-a-slow-one` shipped.
- [ ] The supervisor row reports whether anything supervises.

---

## 5 — Full lifecycle walkthrough (the skills)

- [ ] A plan written from `.plot/templates/plan.md` today, parsed end to end by `plot-plan-meta.sh`.
- [ ] `/plot-idea` → `/plot-approve` → `/plot-implement` → `/plot-deliver` on a throwaway slug.
- [ ] **`/plot-deliver` on a slice whose PR carried only a marker** — §0's defect. Expect it to deliver, and record that it did.

---

## 6 — Before cutting

- [ ] §0 decided explicitly, in writing, in the release note
- [ ] `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck` green
- [ ] `packages/domain`: 2226 pass, 0 fail — run twice; a moving failure set is load, not a regression
- [ ] `./scripts/check-changeset-packages.sh` passes over all 7
- [ ] `plot-reconcile-scan.sh` → `attention=0`
- [ ] Sprint items: 14 of 14 ticked, and §0 says one is overstated

## What this list deliberately omits

- **Anything a test already decides.** 2226 domain assertions and 43 corpus comparisons pass on this candidate; re-checking them by hand would find nothing.
- **`pnpm run test:e2e`.** CI's gate, not a local one — it dispatches real workers into sandbox repositories. Measured 2026-08-31: two agents running it produced **53 concurrent `node --test` processes** and a board that could not answer a request in 25 seconds.
- **The five double-claimed branches** the reconcile scan reports. All five belong to plans that are Delivered or Released; they are finished bookkeeping, and the scan reports without gating for exactly this reason.
- **`2026-W36-a-half-landed-workflow-says-so`**, which the scan reports as outliving its release. Its train shipped as v2.13.0; closing it is a person's call about a past sprint, not a condition of this one.
