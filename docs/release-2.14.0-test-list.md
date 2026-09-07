# Manual test list — 2.14.0

**The release's claim is the sprint's goal, not the changeset list.** `the-domain-owns-the-lifecycle` promises one thing:

> **Every domain element's lifecycle is enforced by a test, and no script changes a lifecycle state without asking the domain.**

Four conditions, all of which must hold: **named**, **owned**, **enforced**, **routed**. This list tests *that*, and lists the 73 changesets only where one of them carries a claim the suites cannot decide.

## What the suites already decided

| suite | files | result |
|---|---|---|
| `@plot-pm/domain` | 93 | **2124 pass, 1 fail** — see §0 |
| `test/reconcile` | 69 | run before cutting |
| board vitest | 157 | run before cutting |
| `packages/domain/corpus` | 4 | adapters vs production, live estate |
| `test/e2e` | 11 | CI's gate, not a local run |

A changeset whose claim is *"the rule returns X"* is **not** in this list — a test decided it.

---

## 0 — One test is red on main, and the release cannot be cut over it

```bash
cd packages/domain && npx vitest run test/ports-real-state.test.ts
```

**`Host reads the git host > answers the merged question with three values` fails.** Measured 2026-09-07 on `main`, not on a branch. Decide before cutting: is it a real regression, a live-estate dependency, or a host-auth artefact? **A release cut over a red domain test contradicts this sprint's own goal.**

---

## 1 — The four conditions, measured

Each is a number. Run it, read it, and the claim is settled or it is not.

### named — one vocabulary per concept

```bash
grep -l '^- \*\*State:\*\*' docs/plans/*.md | wc -l    # expect 228
grep -l '^- \*\*Phase:\*\*' docs/plans/*.md | wc -l    # expect 2, both prose
grep -rn 'Wave\.plan\|Wave\.section' packages/board/src | wc -l   # expect 0
```

**The two remaining `Phase:` files must be prose, not fields.** Open both: their own `- **State:**` line must say `State`. If either uses `Phase:` as its field, the rename is incomplete.

### enforced — a rule that is violated fails a build

```bash
./scripts/check-state-declarations.sh    # expect: lifecycle=11 reading=10 classification=16, clean
```

**Then break it on purpose.** Add `export const FooSchema = z.enum(['a','b']);` to a domain entity with no `plot-state:` marker and re-run. **It must refuse.** A gate nobody has seen refuse is a rule.

### owned — one implementation per lifecycle

```bash
ls packages/domain/src/transitions/*.ts | wc -l    # 11 lifecycles
grep -rn "plot-state: lifecycle" packages/domain/src | wc -l   # 11 declarations
```

The two numbers must match. A declared lifecycle with no `transitions/` file is a rule in prose.

### routed — no script decides on its own authority

```bash
for s in plot-approve plot-deliver plot-reap plot-release-refs plot-sprint-release plot-fleet-scan plot-dispatch; do
  printf "%-22s %s\n" "$s" "$(grep -cE 'input-type=module|plot-transition\.mjs|plot-ask\.mjs|plot-branch-state\.mjs' skills/plot/scripts/$s.sh)"
done
```

**Six answer non-zero. `plot-sprint-release.sh` answers 0, and that is a known hole** — `scoreItem` exists in the domain with **no production caller**, while 12 lines of bash decide every sprint item's status. The two already disagree on an item with no plan. See [`a-sprint-item-has-one-scorer`](plans/2026-09-07-a-sprint-item-has-one-scorer.md).

**This is the sprint's own goal, unmet in one place.** Decide explicitly whether 2.14.0 ships with it.

---

## 2 — What a person must look at (∼25 changesets)

The suites cannot decide what a reader perceives.

**Start the board** (`pnpm board`, Agents tab) with a real estate.

1. **The supervisor badge.** With the supervisor **up**: nothing shown — quiet is correct. `/plot-fleet --stop`, wait one pulse: does the WORKING header say the fleet is unsupervised, and is it *noticeable*? 19 domain tests assert the states; none asserts a person sees it.
2. **`down` with zero agents must stay quiet.** Stop every agent, then the supervisor. The badge must not shout about a fleet that has nothing to neglect.
3. **A held slice says why.** `/plot-fleet --once` prints per-hold counts. Read one: does the reason tell you what to do next?
4. **Section 17.** `plot-reconcile-scan.sh`, read `== 17.` — each branch must name three actions. Does one of them look wrong to you? **That is the test**: the section reports facts precisely because verdicts can be wrong.

---

## 3 — What needs a real host (∼13 changesets)

1. **`plot-pr-merged.sh` against a squash-merged branch.** `mergedAt` set, `state` `CLOSED`, ancestry says *not merged*. All three readings on one branch; the answer must be **merged**.
2. **`--start-agents` on a fresh install.** `/plot-fleet --stop && --start`, then `plot-fleetctl.sh --once` twice. A queued slice must reach a free agent's manifest **without a hand write**. This is the defect #775 fixed and no test covers end to end.
3. **The tracker port with no tracker configured.** Every operation must answer `unaskable` — including the write. A silent success there reports a status that never left the machine.

---

## 4 — Cost (∼10 changesets)

1. **`plot-fleet-scan.sh`** — `time` it. It was 18.3 s against a 5 s board pulse; the terminal-cache work should have moved it.
2. **The board answers while it scans.** Load the Agents tab during a scan. Does it serve?
3. **`plot-reconcile-scan.sh`** — 218.5 s → 111.5 s was the last measurement after nine refs were deleted. Ten more were deleted 2026-09-07.

---

## 5 — Whether a refusal is actionable (∼8 changesets)

Every gate fails closed. Whether the message helps is not something an exit code knows. **Trigger each and read the output as a stranger would:**

| trigger | must name |
|---|---|
| `/plot-approve` on a plan with no PR | which command opens one |
| `/plot-deliver` with an unmerged branch | the branch, and `deferred:` as the escape |
| `plot-reap.sh` on a dirty desk | the path, and that nothing was deleted |
| `/plot-fleet --start` under wrong node | `nvm use`, not just "wrong version" |
| `plot-resolve-artifact.sh` on a non-artifact conflict | which file disqualified it |

---

## 6 — The supervisor is not understood, and the release should say so

**`ProcessType: Background` → `Adaptive` shipped on a comparison, not a cause.** The board ran 2d 12h beside a supervisor removed six times; the trigger is **unidentified**, and five explanations were tested and disproved — load (both directions), memory pressure, `AbandonProcessGroup`, `--once`, `--start`.

**The test is time.** Load the supervisor, leave it alone, sample `launchctl print`'s pid every few seconds for an hour:

```bash
while :; do launchctl print gui/$(id -u)/com.plot-pm.registryd 2>/dev/null | awk '/^\tpid = /{print $3}'; sleep 5; done
```

One pid for an hour is evidence. A gap is the defect returning under a new key.

**Do not describe this as fixed in the release notes.** It is mitigated on one measurement.

---

## 7 — Before cutting

- [ ] §0 red test decided
- [ ] Four conditions measured; `plot-sprint-release.sh` hole decided explicitly
- [ ] `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck` green
- [ ] Sprint items: 6 `done`, 2 `disputed` — both bookkeeping, neither outstanding work
- [ ] `./scripts/check-changeset-packages.sh` passes over all 73
- [ ] Supervisor watched for one hour without a pid change
