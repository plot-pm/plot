## Implementation brief — the-scan-holds-a-waiting-slice (wave Holding)

- **Plan (canonical):** `docs/plans/2026-09-01-a-slice-can-wait-on-another-plan.md` on main
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/the-scan-holds-a-waiting-slice` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** in-session, per the plan's `Review:` field

The plan's second wave. `Declaring` landed as **#623** (merge commit `8e8bef86`, 302 insertions across `plot-plan-meta.sh` and `parser.test.mjs`): the parser reads `<!-- waits: <branch> -->` beside `deferred:` and reports it as `waves[].branches[].waits_on`. **Consume that key; do not parse the annotation again.** `Refusing` — `feature/dispatch-refuses-a-waiting-slice` — is the next wave and depends on this one, because until the scan produces the state there is nothing for a dispatch to refuse.

### What to build

Two new branch states in `skills/plot/scripts/plot-fleet-scan.sh`:

- **`waiting`** — the branch declares `waits_on` and the prerequisite has not merged.
- **`blocked`** — the branch declares `waits_on` and the prerequisite cannot be found at all.

The fleet payload carries the prerequisite's branch name, so a reader sees *what* the slice waits on rather than only that it waits.

### The decisions the plan settles — do not re-derive them

**READ `HOST_STATE_CACHE`, NEVER `terminal_cached`.** The plan states this and the code confirms why. `terminal_cached()` (`plot-fleet-scan.sh:889`) returns 1 unless `TERMINAL_PLAN_OID` equals the plan **currently being walked**, and its own comment says an entry with no plan identity is never served, because *"an answer we cannot attribute to a plan revision is not evidence."* A prerequisite belongs to another plan by construction, so that cache can never answer about it. `HOST_STATE_CACHE` (`plot-fleet-scan.sh:426`) is a `mktemp -d` directory keyed by branch name alone through `cache_key()`, which makes it the only cache whose key this question can form.

**THE COST IS BOUNDED AND THE PLAN NAMES IT.** *"Free where the prerequisite is visited elsewhere in the run, one host call per run otherwise."* `host_pr_state` already reads and writes `HOST_STATE_CACHE` before asking the host, so a prerequisite the run visits for its own plan costs nothing the second time.

**ABSENT AND PRESENT ARE DIFFERENT, AND THE PARSER ALREADY SEPARATES THEM.** `plot-plan-meta.sh:553` emits `waits_on` only for a branch whose line carries the annotation, and its comment states the contract: *"a consumer reading `waits_on` gets a branch name or nothing — never a blank string."* So test the key's presence. A branch with no annotation keeps the state it has today, and this slice must not change any existing verdict.

**`waiting` AND `blocked` ARE DIFFERENT ANSWERS.** A prerequisite that exists and has not merged is a wait with an end. A prerequisite no plan declares is a defect in the plan estate — the case #623's parser test was required to cover. Collapsing them would hide a typo behind a state that reads as normal progress.

**NO ASSOCIATIVE ARRAYS.** `plot-fleet-scan.sh:2410` states the constraint and names the enforcement: */bin/bash* on macOS is 3.2, the script uses no bash-4 feature anywhere, and `test/reconcile/mergequeue.test.mjs` refuses a `declare -A`. Use index-parallel arrays, the idiom `plans`/`plan_reads`/`plan_phases` and `wave_readings` already use.

**THE TWO WALKS MUST AGREE POSITIONALLY.** `plot-fleet-scan.sh:3236` warns that the claimable flags come back positionally, so the state walk and the render walk must visit branches in the same order — and that a `deferred` branch still occupies a position even though `outstanding` skips it. A new state must occupy its position the same way.

**`deferred` OUTRANKS THE HOST LOOKUP.** `plot-fleet-scan.sh:3211` reads `if [ "$deferred" = "true" ]; then st="deferred"; else st=$(branch_state "$br"); fi`. A branch that is both deferred and waiting is deferred: somebody gave it up, which is a decision, while waiting is a measurement. Keep that precedence.

### Known tripwire

None found. Unlike `plot-reconcile-scan.sh`, whose `scan.test.mjs:264` asserts its footer as an exact string, `test/reconcile/fleet*.test.mjs` holds no `summary: plans=` exact-match assertion — checked 2026-09-01. A new footer counter therefore breaks no existing test, which means **nothing will catch a counter you forget to add**. Assert the footer yourself.

### Done when

- A branch whose `waits_on` prerequisite has an open PR reports `waiting`, and the payload names the prerequisite.
- A branch whose `waits_on` prerequisite has merged reports the state it would report without the annotation. Assert this: the annotation must stop mattering once the prerequisite lands.
- A branch whose `waits_on` names a branch no plan declares reports `blocked`, separately asserted from `waiting`.
- A branch with **no** `waits_on` reports exactly what it reports today. Assert one such branch per existing state, so the slice is provably additive.
- A branch that is both `deferred` and waiting reports `deferred`.
- `--json` and `--stream` both carry the new state and the prerequisite name; `--stream`'s terminal `pulse` line still arrives.
- The footer counts the new states, and a test asserts the footer.

### Repo gates

Node 24 (`nvm use`). `pnpm test`, `pnpm run test:reconcile`, `pnpm run typecheck`. Run `pnpm run test:board` as well: the board renders fleet states, so a new state word reaches it. **Do not run `pnpm run test:e2e`** — it is CI's gate, it dispatches real workers, and two concurrent local runs took this machine to load average 8.69.

### Changeset

`'plot': minor` — this is new behaviour, not a fix. **Description first**, `bumps:` block last: Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide differential fails.

### Scope guard

**This branch owns** `skills/plot/scripts/plot-fleet-scan.sh` and its tests under `test/reconcile/`.

**It does not own** `plot-plan-meta.sh`'s parsing, which #623 finished; `plot-dispatch.sh`'s refusal, which is the `Refusing` wave; or the board's rendering of the new state.

Report anything the plan did not anticipate rather than improvising outside scope.
