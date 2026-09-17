# Juror: the adapter

Position: amend

Lens: verify the claim that one `jq` filter in `plot-host.sh` is the whole defect, against the actual source, and find what else the change touches.

## Summary

The plan's line numbers are all correct and its diagnosis of the symptom is right. But it is wrong about the adapter in a way that changes the first slice's design: **`plot-host.sh` already has a `pr-merge-commit` op that answers this exact question on both backends, and the plan does not mention it.** The plan also misattributes its own "strongest evidence" to the wrong operation, proposes a Done-when that an existing test contradicts, and cites a Bitbucket payload shape from a `pr list` while the code path it proposes to edit calls `pr view`.

---

## 1. VERIFIED — `:2496` and `:2499` are the Bitbucket `pr-state` arm, and the key is absent

`skills/plot/scripts/plot-host.sh:2496`, inside `pr-state` (op begins `:2417`), the `else` (Bitbucket) arm, numeric-ref branch:

```bash
jq -c '{number:.id,state:(if .state=="DECLINED" then "CLOSED" else .state end),draft:(.draft // false),url:.links.html.href}' <<<"$out"
```

`:2499`, its failure path:

```bash
host_miss_or_fail "$err" '{"number":0,"state":"NONE","draft":false,"url":""}' || exit $?
```

Both omit `mergeCommit`. Quoted exactly as the plan quotes them. **The plan is right.**

## 2. VERIFIED — the GitHub paths are consistent, and there is a THIRD Bitbucket site the plan misses

`grep -n 'mergeCommit' plot-host.sh` gives every `NONE` object in the file:

| line | path | has `mergeCommit` |
|---|---|---|
| 2447 | GitHub REST, numeric miss | yes |
| 2461 | GitHub REST, branch empty-list | yes |
| 2468 | GitHub REST, branch miss | yes |
| 2476 | GitHub GraphQL success | yes |
| 2488 | GitHub GraphQL miss | yes |
| **2496** | **Bitbucket numeric success** | **no** |
| **2499** | **Bitbucket numeric miss** | **no** |
| **2538** | **Bitbucket BRANCH-lookup `NONE`** | **no** |
| **2539** | **Bitbucket BRANCH-lookup hit** | **no** |

Every GitHub path emits it; every Bitbucket path omits it. The plan names **two** of the four Bitbucket sites — `:2496` and `:2499` — and its slice text says *"on both the success and the miss path"*, which reads as if there were two.

`:2538`/`:2539` is the branch-lookup arm:

```bash
jq -c --arg b "$ref" '[.[] | select(.source.branch.name==$b)][0] // null
     | if .==null then {number:0,state:"NONE",draft:false,url:""}
       else {number:.id,state:(...),draft:(.draft // false),url:.links.html.href} end' <<<"$out"
```

This matters beyond tidiness: `skills/plot/scripts/plot-pr-state.sh:33` calls `pr-state "idea/${SLUG}"` — **a branch, not a number** — and `:47` then reads `.mergeCommit // empty`. So the branch arm is a live consumer path, and a fix touching only `:2496`/`:2499` leaves it broken. The Done-when's phrase *"on every path"* saves it, but the slice's own scope line does not.

## 3. REFUTED — `:2669`/`:2673` is NOT the `pr-merged` op, and an op the plan never mentions already answers the question

The plan says:

> `plot-host.sh:2669` carries the comment ... and `:2673` reads exactly that field in the `pr-merged` op

The lines are right and the attribution is wrong. Op boundaries in the file:

```
2417:  pr-state)
2560:  pr-merged)
2619:  pr-merge-commit)      <-- :2669/:2673 are in HERE
2686:  pr-create)
```

`pr-merged` (`:2560`–`:2617`) prints one word — `merged`/`not-merged`/`unknown` — and reads no sha at all. The `merge_commit.hash` read is in **`pr-merge-commit`**, a separate subcommand, whose own header at `:2619` says:

```
    # THE MERGE COMMIT OF A BRANCH'S MERGED PR, and nothing else.
    #
    # A SECOND SUBCOMMAND RATHER THAN A FIELD ON `pr-merged`, because that one
    # prints ONE WORD and eleven callers read it as one ...
```

**This is the finding that changes the plan.** `pr-merge-commit` is a complete, both-backend, already-shipped answer to *what is the merge commit of this branch's merged PR*. It is declared in the usage header at `:49`, it is behind the domain port as `prMergeCommit` (`packages/domain/src/ports/host.ts:180`), and it is implemented in the adapter at `packages/domain/src/adapters/host/host-shell.ts:287`:

```ts
prMergeCommit: async (branch): Promise<PortResult<string>> => {
  const run = await runProcess('bash', [host, 'pr-merge-commit', branch], inRepo);
```

The plan's design section argues at length that the field *is available* and that *"one op reads the field and the op beside it does not construct it"* — without ever noticing that the op reading it **is a general-purpose merge-commit op, not an incidental neighbour.** A design that has read `:2619`'s header cannot write that sentence, because the header explicitly explains why the sha lives in its own subcommand.

This does not make the plan wrong to fix `pr-state` — see §4 — but it makes the Design section's central argument unsound as written, and it leaves a cheaper alternative unconsidered and unrejected.

**The alternative the plan owes a rejection to:** `plot-reconcile-scan.sh:1192` could call `pr-merge-commit` instead of `pr-state | jq .mergeCommit`. That would work on both backends **today, with no adapter change at all.** Whether it is the right fix is genuinely arguable — the scan holds a PR *number* and `pr-merge-commit` takes a *branch*, which is a real obstacle (see §5) — but an argued rejection is what is missing, not the conclusion.

## 4. The plan's chosen fix is still defensible — and `pr-list` is the precedent it should have cited

The contract argument survives §3. `docs/stories/.../DESIGN-pr.md:100` lists `mergeCommit` as a field of the PR entity, and `:293` gives `pr-state`'s shape as *"number, state, draft, url, mergeCommit"*. The Bitbucket arm does not honour that. The plan's reading — *"the scan is reading the contract correctly; one backend does not honour it"* — holds.

And there is a precedent in the same file that the plan does not use and should: **`pr-list`'s Bitbucket arm goes out of its way to emit every key its GitHub arm emits**, `:3025`:

```bash
jq -c '.[] | {number:.id,title:.title,state:(...),head:.source.branch.name,draft:(.draft // false),checks:"unknown",mergeable:"unknown",review:"",url:(.links.html.href // ""),failing_checks:[]}'
```

with the comment at `:2962`:

```
      # Bitbucket carries no check rollup through `bb pr list`, and no
      # mergeability verdict either. Rather than guess, --rich reports
      # checks:"unknown" and mergeable:"unknown" ... An honest gap beats
      # an invented answer, and absent is not false.
```

**This answers the panel's class question directly.** I compared every PR-object construction in the file (`:2476`, `:2496`, `:2538/9`, `:2900`, `:2927`, `:2957`, `:2999`, `:3025`, `:3034`, plus the issue ops at `:3427`/`:3497` and `:3546`/`:3608`). The issue ops match key-for-key across backends. `pr-list` matches key-for-key across backends, deliberately, with the reasoning written down. **`pr-state` is the only op in `plot-host.sh` whose Bitbucket arm drops a key its GitHub arm emits.** So this is NOT one instance of a class — it is the single outlier against an otherwise-honoured convention, and the convention even states its own rule (*"absent is not false"*). That strengthens the plan rather than weakening it, and the plan should say so, because *"the file's own convention is violated in exactly one place"* is a far better argument than the one it makes.

## 5. UNVERIFIED AND LOAD-BEARING — the payload the plan proposes to read may not carry the field

The plan asserts:

> `bb pr view <id> --json` emits the raw Bitbucket API 2.0 object ... so the response already in hand holds the answer and no second call is needed.

I cannot call `bb` (this repo is GitHub), and the plan is honest that its evidence is the neighbouring line. **But the neighbouring line is not evidence for this claim**, because it reads a different call:

- `pr-merge-commit` Bitbucket, `:2670`: `bb pr list --state merged --json` → reads `.merge_commit.hash` out of a **list row**
- `pr-state` Bitbucket numeric, `:2494`: `bb pr view "$ref" --json` → the path the plan proposes to edit

The file itself records that bb list rows and detail objects are not interchangeable. `:1280`, about the GitHub REST fallback:

```
# The list row carries no `merged` key at all — measured against this repo
# 2026-08-28, where PR #494's row has `has("merged") == false`. Reading only
# `.merged` there reports every merged branch as CLOSED
```

That is the same class of hazard on the other vendor, measured. And **no test fixture in this repository contains `merge_commit`** — `git grep merge_commit -- test packages` returns only GitHub's `merge_commit_sha`. `pr-merge-commit` has **zero tests** (`grep 'pr-merge-commit' test/reconcile/host.test.mjs` → no matches). So the one line the plan calls its strongest evidence is itself unexercised code.

The plan's Done-when says the value *"is taken from the response already fetched and no second host call is made, checked by counting `bb` invocations"* — a check that passes whether or not the field is present, because a missing key yields `""` and the count is still one. **The Done-when cannot fail in the case that matters.** It needs a fixture asserting a non-empty sha for a merged PR, and if `bb pr view` turns out not to carry `merge_commit`, the first slice's design changes (it would have to reach `pr list --state merged`, i.e. a second call, and the Done-when's own no-second-call clause would then refuse the only implementation that works).

## 6. CONCRETE BREAKAGE — an existing test asserts the exact key set the slice changes

Three tests in `test/reconcile/host.test.mjs` `deepEqual` a Bitbucket `pr-state` object with no `mergeCommit`, so they fail the moment the key is added:

- `:3222` — and it is the worst one, because of what it is for:

```js
test('host: pr-state bitbucket is unaffected — no budget query, no REST', () => {
  const stubs = makeStubs({
    bbJson: '{"id":7,"state":"MERGED","draft":false,"links":{"html":{"href":"https://bb.test/pr/7"}}}',
  });
  const out = JSON.parse(run(['pr-state', '7'], { env: { PLOT_HOST: 'bitbucket' }, stubs }));
  assert.deepEqual(out, { number: 7, state: 'MERGED', draft: false, url: 'https://bb.test/pr/7' });
```

A **MERGED** Bitbucket PR whose stub payload carries no `merge_commit` at all. Under the fix this asserts `mergeCommit: ''` for a merged PR — the exact wrong answer — so the fixture must gain the field, not just the expectation.

- `:382` — `pr-state bitbucket normalizes DECLINED to CLOSED`
- `:453`/`:454` — `bb pr-state by branch resolves via pr-list filter`, the branch arm from §2

The plan's Done-when asks for *"a contract test asserting the GitHub and Bitbucket arms return the same key set"* — correct and welcome — but says nothing about the three existing tests that must be amended, and nothing about `:3222`'s fixture needing a merged-PR sha. `pnpm run test:contracts` cannot pass without touching them.

## 7. VERIFIED — consumers, and one behaviour change the plan does not name

Readers of `pr-state`'s `mergeCommit`:

- `plot-reconcile-scan.sh:1193` — the reported defect. Fix helps. **Branch-arm caveat does not apply** (it passes a number).
- `plot-pr-state.sh:47` — passes a **branch** (`idea/<slug>`, `:33`), so it needs `:2538/9` fixed, per §2.
- `packages/domain/src/adapters/host/host-shell.ts:75` — `mergeCommit: raw.mergeCommit ?? ''`. **The board is insulated:** the tolerant mapper already produces `''`, so the board gains a real sha where it had an empty string and loses nothing. The plan's `<!-- Board impact: none directly -->` is right, and the reason is this line rather than the one the plan gives.

`plot-pr-merged.sh` is correctly declared untouched — it reads `mergedAt`, never `mergeCommit`, confirmed.

**The unnamed behaviour change:** `plot-pr-state.sh` emits `mergeCommit` in its own output (`:66`). Today on Bitbucket that is always `""`. After the fix it is sometimes a sha. Nothing in this repo branches on it (`status` is what callers read, per `:18`), so the risk is low — but *"a caller reading `.mergeCommit // empty` can never distinguish backends"* is the intended effect, and the plan should say which callers start seeing a value, rather than asserting no consumer changes.

## 8. VERIFIED — the CLI gate is satisfied

`scripts/check-host-cli-callers.sh` is a path check: it flags a `gh`/`bb` invocation in a script other than `plot-host.sh`, with a named exception list. The first slice edits a `jq` filter **inside** `plot-host.sh` and adds no CLI call anywhere. No gate obligation, and the slice adds no entry to the exception list. The plan does not mention the gate; it did not need to, and saying so costs one line.

## 9. Slice 2 — no adapter objection, one correction

Moving section 6 below `== blocking sections end ==` (`plot-reconcile-scan.sh:1253`; section 6 begins `:1151`) is a report-layout change with no adapter surface. The `inspect:` line at `:1200` does hardcode `gh`, as claimed.

One correction the plan should absorb: `test/reconcile/host-cli-gate.test.mjs:98` pins that very `inspect:` string as a **licensed prose mention** of `gh`, proving the gate does not flag comments. Rewriting the line to name the configured CLI must keep that test meaningful — the test exists to prove `gh`-in-a-report-string is not a violation, and a line that no longer says `gh` on a GitHub repo may stop testing what it was written to test.

## What would move me to `proceed`

1. The Design section names `pr-merge-commit` (`:2619`) and argues why `pr-state` is fixed instead of the scan being repointed at it — the honest argument is probably *the scan holds a number and that op takes a branch*, plus the contract argument.
2. Slice 1's scope names all **four** Bitbucket sites, `:2538`/`:2539` included, since `plot-pr-state.sh` goes through the branch arm.
3. The Done-when replaces *"no second `bb` call, checked by counting invocations"* with a check that can fail: a fixture where `bb pr view` returns `merge_commit.hash` and the op emits that sha — and a statement of what happens if `bb pr view` turns out not to carry it.
4. The three existing `deepEqual` tests (`:382`, `:453`, `:3222`) are named as amendments, with `:3222`'s fixture gaining a merge commit.
5. The Notes' claim that this was argued from *"the neighbouring line"* is corrected: the neighbour reads `pr list`, and the path being edited is `pr view`.

None of these is a reason to abandon the plan. The defect is real, the target is right, and the second slice is independently sound. The first slice's argument and its Done-when are what need amending.
