## Implementation brief — the-lifecycle-runs-on-the-other-stack (slice: The stack is a sandbox the lifecycle runs in)

- **Plan (canonical):** `docs/plans/2026-09-07-the-lifecycle-runs-on-the-other-stack.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `infra/the-lifecycle-runs-on-the-other-stack` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

One slice. **Land this first — it is the sprint's progress meter.** The plan explains why: it must fail on arrival, and its failing assertions name which plan turns each green.

## What this delivers

One e2e test driving `/plot-init` → `/plot-idea` → `/plot-approve` → `/plot-implement` → `/plot-deliver` on a sandbox declaring **Bitbucket, Jenkins and Jira**, with `PLOT_UNATTENDED=1` and no answer available.

## The harness exists — use it, do not build one

`test/e2e/helpers.mjs` exports 15 functions, and every piece you need is among them:

| helper | for |
|---|---|
| `makeSandbox({ name, config })` | a repo with a `## Plot Config` — `lifecycle.test.mjs:19` is the pattern |
| `stubHost(...)` | a scripted `plot-host.sh`, so `bb` and `jen` answer without accounts |
| `runScript`, `runGate` | invoking a script and asserting its exit |
| `planMeta`, `instantiatePlan` | building and parsing a plan in the sandbox |
| `recordApproval`, `recordStarted`, `recordDelivered` | the transition records |

**The sandbox config is where the stack is declared:** `- **Git host:** bitbucket`, `- **Tracker:** jira <url>`, `- **CI:** jenkins`. `lifecycle.test.mjs:83` already writes `Tracker: jira` this way — **and then never asks the tracker anything, which is the gap this closes.**

## It must fail on arrival, and the PR must say which assertions

**A green test on day one means it is not testing the goal.** Expect these to fail, and name each with the plan that turns it green:

| assertion | fails because | fixed by |
|---|---|---|
| adoption proposes `Tracker:` and `CI:` | `plot-detect-repo.sh` emits neither field | `adoption-asks-about-the-stack` |
| a build state is reported | `runs` reaches `gh` alone; `jen` is asked nothing | `the-build-pipeline-is-its-own-connector` |
| every refusal names a repair | 16 of 126 do today | `a-first-run-refusal-names-its-repair` |
| an unreachable check reads *not asked* | `CardPrSchema` carries no `checks` | `the-board-says-what-it-could-not-ask` |

**Write them as real assertions that fail, not as `it.skip`.** A skipped test is not a progress meter.

## What it asserts, and what it must not

**THE PATH COMPLETES WITHOUT A PERSON.** Not that each step is right in isolation — `test/reconcile` has 1,393 tests for that. **That the steps compose unattended.**

**EVERY REFUSAL IS ASSERTED, NOT TOLERATED.** An unattended run that stops is a valid outcome — `PLOT-UNASKED` is the shape `/plot-init` already uses. The test says *which* refusals happen; a run that silently skips a step passes for the wrong reason.

**NO REAL VENDOR.** Bitbucket, Jenkins and Jira need accounts CI does not have. `stubHost` scripts the answers, which tests **Plot's behaviour on that configuration** — the thing this sprint changes — and not the vendors' APIs. Say so in the test's header comment.

**ONE FILE.** `test:e2e` is CI's gate and already costly — measured 2026-08-31: two agents running it produced **53 concurrent `node --test` processes** at load 8.69. Add one file and state its measured runtime in the PR.

## Repo gates

```bash
nvm use              # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:reconcile
```

**Run your own file directly** — `node --test test/e2e/the-lifecycle-runs-on-the-other-stack.test.mjs` — rather than the whole `test:e2e` suite. The suite is CI's gate, not a local one.

## Done when

One e2e test runs the lifecycle unattended on a Bitbucket + Jenkins + Jira sandbox, every refusal it meets is asserted rather than tolerated, the assertions that fail on arrival are listed in the PR with the plan that turns each green, and its runtime is stated.
