Position: reject
Evidence: executed

# EVIDENCE lens — the persisted pulse holds the bought answer (#1050)

The plan proposes to build something that is already on `main`, and both of its supporting measurements are false as stated. The cold start reads the store, seeds the board from it, and asks the host only for a delta. The store is healthy at the current version.

## What I ran

### 1. The pulse measurement is TRUE — and the plan's own numbers are not

`.plot/state/last-pulse.json`, read today:

```
$ jq -r 'keys|join(" ")' .plot/state/last-pulse.json
ages approvedAt at branchUrlBase ideaPlans pulse version
```

I enumerated every path in the file, not just top-level keys, and normalised array indices:

```
$ jq -r '[paths|map(tostring)|join(".")]|map(gsub("\\.[0-9]+";"[]"))|unique|.[]'
```

58 distinct paths. Under `pulse.plans[].slices[].branches[]`: `branch`, `state`, `claimed`, `deferred`, `held`, `worker`, `worker_pid`, `worker_exit`, `changed_paths`, `conflicts`, `waits_on`, … — all git and process facts. A grep for PR field names across the whole file returns only 7 hits for `"draft"`, and those are plan **phases**, not PR drafts. **No PR number, no PR state, no `mergedAt`, at any depth.** The plan's central observation survives the nested check.

Two details in the plan's own evidence block are wrong: it says **11 KB** (the file is **16 099 bytes**) and lists the keys as `main head read_ref local_head plans summary`, which are the keys of the **nested `pulse` object**. The four real top-level siblings — `version`, `at`, `branchUrlBase`, `ideaPlans` — plus `ages` and `approvedAt` are not mentioned. Minor, but this plan's whole argument is a measurement of this file.

### 2. The leading hypothesis is dead

The plan states: *"the live store read `v: 1` against `PR_INDEX_VERSION` 2, so every read fell through to the host. That may be the whole defect."*

```
$ jq -r '{v, keys:(keys|join(" ")), complete, at, rows:(.rows|length)}' \
    .git/.plot/state/index/github.json
{ "v": 2, "keys": "at complete connector rows v watermark",
  "complete": false, "at": "2026-09-28T20:53:04.183Z", "rows": 987 }

$ grep -rn 'PR_INDEX_VERSION' packages/domain/src/entities/pr-index.ts
12: export const PR_INDEX_VERSION = 2;
```

**Store `v: 2`, code `PR_INDEX_VERSION = 2`, 987 rows of which 951 are MERGED, written today at 20:53.** The versions match. Nothing falls through for version reasons. The third of the plan's three candidate causes — and the one its Notes call *"may be the whole defect"* and *"may make this cheaper than it looks"* — does not hold.

### 3. The sharpest question: the cold start already reads the store

It does. `packages/board/src/server/fleet.ts:2629`:

```ts
const seedPrsFromStore = async (entry: CacheEntry, connector: string): Promise<void> => {
  if (entry.prsByNumber !== null) return;
  let held;
  try { held = await prStore.read(connector); } catch { return; }
  if (!held.ok || held.value === null) return;
  applyPrMaps(entry, mapsOfRows(held.value.rows));
};
```

Its docstring (`:2605-2627`) states the plan's own goal almost verbatim:

> **THIS IS WHAT A RESTART BUYS … What it can do is stop the board being blank for the 29 811 ms the call takes: a process that has just started renders the last answer immediately and replaces it when the host speaks.**

It is called on the refresh path at **`:2829`**, before the host call, with the comment *"READ BEFORE THE CALL, and this is the half of the store a restart feels. A cold process renders the last answer the host gave rather than nothing."*

And the call is already a delta, `:2841-2848`: a second `prStore.read` feeds `prWindowFor(stored, Date.now(), PR_FULL_READ_MS)`, which appends `--since` from the store's watermark. So the cold board does **not** re-buy every PR answer — it seeds from disk, then asks only for what changed.

Three `prStore.read` sites exist (`:2633`, `:2735`, `:2843`) plus the fold and write at `:2740`/`:2752`.

**`git log -S'seedPrsFromStore'`** names the two commits that built this: `83c4abdc` *"refreshPrs reads the store before its call and writes it after"* and `09cf9018` *"the call asks only for the delta"*.

### 4. It is tested, and the tests pass

`packages/board/test/unit/pr-store.test.ts` already asserts each of the plan's Done-when items:

| plan's Done-when | existing test |
|---|---|
| a restart serves PR state on first pulse | `:368` *"fills the maps from disk before the host answers"* |
| a missing/wrong-version store still asks the host | `:350` *"an unrecognised version falls back to a full read and does not throw"*; `:333` *"an unreadable store leaves the board working"* |
| lower host-call count on a cold start | `:309` *"a warm store produces the same maps a cold one does"* |
| never read a row as *no PR* | `:218` *"keeps the rows a partial pass did not mention"*; `:233` *"records the store as no longer whole"* |
| the seed does not lie about freshness | `:380` *"does not stamp prAt, so the operator is told how old the data is"* |

Run under Node 24:

```
$ corepack pnpm exec vitest run test/unit/pr-store.test.ts
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

## What a measurement contradicts

**The plan's headline is false.** *"the PR reading … lives only in memory and is re-fetched from scratch every start"* — it lives in `.git/.plot/state/index/github.json`, 987 rows, and `seedPrsFromStore` loads it before the first host call. *"The first pulse after a restart carries PR state instead of showing none until the first fetch lands"* is the behaviour `main` already has.

**The plan's own framing concedes this and then ignores it.** It says *"`PrIndexStore` already exists, already holds exactly these answers keyed by head, and is already written by `fleet.ts`. This plan does not add a store. It makes the restart path read it"* — and the restart path already reads it, in the same file, 90 lines from the write the plan cites.

**The three-way deferral is not honest.** All three causes are answerable by reading one file: cause 1 (never reads on start) is false at `:2829`; cause 2 (write path defective) is false at 987 rows written today; cause 3 (`PR_INDEX_VERSION`) is false at `v: 2 == 2`. This took well under ten minutes. "The slice measures before changing anything" reads as diligence but defers a question already settled on `main`, and it is what let the dead `v: 1` hypothesis survive into a Draft.

**On the stated reason the pulse persists only git:** I found no rule forbidding PR persistence — the opposite. `a-decision-reads-the-index` (CLAUDE.md) requires it, and `fleet.ts:2173`, which the plan cites, refuses to persist a **verdict**, not an answer: *"A persisted verdict would be a cache git cannot reach."* The plan reads that correctly and then treats the pulse's git-only content as the same inversion. The pulse and the PR index are **two separate stores with two separate jobs**; the PR answers are persisted, just not in `last-pulse.json`. There is no inversion to fix.

## What the plan must say before someone builds it

If anything survives here, it is a different and much smaller plan. It must:

1. **State that `seedPrsFromStore` (`fleet.ts:2629`, called `:2829`) exists and what it does not cover** — otherwise the slice reimplements a tested path.
2. **Retract the `v: 1` measurement** or date and locate it precisely (a desk? another checkout? before `09cf9018` landed?). The live store is `v: 2`.
3. **Fix the pulse measurement** — 16 099 bytes, and the quoted keys are the nested `pulse` object's, not the file's.
4. **Name a symptom that survives all of the above.** `complete: false` on the live store is the only loose thread I found: it means absence is not derivable, which is correct and conservative, but if #1050 reports a real gap this is where to look. That is a question about store completeness, not about persistence.
5. **Re-read #1050 against `main`.** The issue may predate `83c4abdc`/`09cf9018`, in which case it is already fixed and should be closed with the measurement rather than planned.

## What executing revealed that reading would not

- **The version hypothesis inverted.** The plan's most concrete number — the one its Notes build the cheap-fix story on — is contradicted by the live file. Only opening `.git/.plot/state/index/github.json` shows `v: 2`.
- **The feature is already built, by the author's own estate.** Reading the plan's Design section is persuasive precisely because it describes `main` accurately; the gap only appears when you follow `prStore` to its three read sites and find the cold start among them.
- **The plan's Done-when is a description of an existing green test file.** 29 passing tests, five of them matching its acceptance criteria line for line. Reading the plan alone cannot show that; running the suite does.

**Position: reject.** The premise is already implemented and tested on `main`, and the plan's supporting measurements are false. The right next step is to re-verify #1050 against current `main` and close it, or re-file a narrow plan about store completeness.
