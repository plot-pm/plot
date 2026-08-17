## Implementation brief — green-never-outranks-unknown (single wave)

- **Plan (canonical):** `docs/plans/2026-08-17-green-never-outranks-unknown.md` on `main`
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #187 merged (one interrogation round)
- **Branch:** `bug/green-never-outranks-unknown` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

`prState` returns `unknown` when `mergeable` is `unknown`, **before**
consulting `checks`.

The change is one line. The assertions are the work — the value reaches
four consumers, and two of them decide more than a colour.

### The measurement

Reported live from a screenshot: PR #57 read **green** in the agents row.
At that moment the host said:

```
plot-host:  checks="green"   mergeable="conflicting"
gh:         mergeable=CONFLICTING   mergeStateStatus=DIRTY
```

A branch unmergeable for **22 days** wearing the one word a reader acts
on without checking. A minute later the same row read `conflicts`,
correctly — so the defect is real, intermittent, and repairs itself,
which is why nobody reproduces it on request.

**The fold is right; its input is not.** `prState` handles `conflicting`
correctly and has **no case for `unknown`**, so control falls through to
`checks`:

| `mergeable` | `checks` | Reported | Honest |
|---|---|---|---|
| `conflicting` | anything | `conflicts` | ✅ |
| `mergeable` | `green` | `green` | ✅ |
| **`unknown`** | **`green`** | **`green`** | ❌ *cannot say* |

The function's own comment already states the rule it needs — *"a new
word from a future host must read as cannot say, never as the reassuring
end of the range"* — and applies it to `checks` while letting `mergeable`
bypass it.

**Two ways `unknown` arrives, neither rare.** GitHub computes
mergeability lazily and its API returned `503` at least four times on
2026-08-17 — under load `mergeable` comes back `UNKNOWN` while
`statusCheckRollup`, a plain stored field, still answers. And Bitbucket
reports `unknown` **always**, because `bb` cannot answer either question.

### Six decisions the plan settles — do not re-derive them

**`conflicting` still outranks everything.** The new line goes *below*
it. A host that knows the branch conflicts must still say so.

**Do not consult `checks` to break the tie.** They answer different
questions; a green check says nothing about whether a branch merges.
Twenty-two days of green on a conflicting branch is the proof.

**The change reaches four consumers, each needing its own assertion.**
Measured — `prState` has four callers:

| Caller | What it decides |
|---|---|
| the row's `pr.state` | the status cell and its word |
| `classify`'s note | *no checks* / *CI running* / *conflicts* |
| **`stuck.ts`** | `prState === 'conflicts'` → stuck; `'failing'` → CI evidence |
| **the change-marker** | watches `pr?.state ?? null`, flashes on transitions |

One of them **improves**: `stuck.ts` today sees `green` where the host
said nothing, so a branch that cannot merge is not detected as stuck at
all. This fix is what lets the watcher see it.

**A transition into or out of `unknown` does NOT flash.** With this fix a
503 turns `green` into `unknown` and the next pulse turns it back — two
flashes for nothing that happened, and there were four outages in one
afternoon. `unknown` is a fact about the *observation*, not the world,
and the marker reports changes in the world. This is the marker's own
rule — *absent is unknown, never a value* — applied one level up; it
already refuses to flash on a first sighting for the same reason.

**The note says WHICH fact is missing.** Today `unknown` renders as
*checks unavailable*, wrong whenever `mergeable` is what could not be
read. Two sentences, because only one is actionable:

| Missing | Note | Reader does |
|---|---|---|
| `mergeable` | *cannot say whether it merges* | check for a rebase |
| `checks` | *cannot read the checks* | nothing yet; look again |

**Bitbucket cannot answer this — permanently.** The adapter hard-codes
`checks:"unknown", mergeable:"unknown"` because `bb` has nothing to
report (*"Empty on bitbucket (bb has no run listing)"*). That is not
deferred work. So `unknown` on every Bitbucket row is correct, and this
fix does not cause it — it stops the answer being overwritten.

What the fix must not do is let a Bitbucket reader mistake the result for
a broken board: **WAITING ON A MACHINE will be permanently empty there**,
and an unexplained empty section reads as *nothing is running* rather
than *this host cannot tell me*. Where the host reports `unknown` for
every row, that section's empty state names the host's limit.

### Done when

- **`mergeable: unknown` + `checks: green` reports `unknown`.** Assert
  the live shape from #57's reported minute.
- **`mergeable: unknown` reports `unknown` for EVERY `checks` value.**
  Assert all six — an implementation special-casing only `green` passes
  the assertion above and leaves the others claiming more than the host
  said.
- **`conflicting` still outranks everything.** Assert `conflicting` +
  `green` is still `conflicts` — the cheap fix is to reorder and lose the
  cause.
- **`mergeable: mergeable` + `checks: green` is still `green`.** A fix
  that reports `unknown` whenever `mergeable` is not `conflicting`
  passes every assertion above and makes the board useless.
- **`stuck.ts` detects a conflict it previously missed.** Assert a branch
  the host calls unmergeable while its checks read `green` is now seen.
- **The change-marker does NOT flash on a transition into or out of
  `unknown`.** Assert `green → unknown → green` produces no marker.
- **A real transition still flashes.** Assert `pending → failing` is
  unaffected — suppressing too much removes the signal the marker exists
  for.
- **The note says which fact is missing.** Assert both sentences.
- **A Bitbucket row reads `unknown`, not whatever `checks` says**, and
  this is permanent rather than pending adapter work.
- **Where the host reports `unknown` for every row, the empty
  WAITING ON A MACHINE section names the host's limit** rather than
  implying quiet.
- **No contract change and no new field.** Assert `prState` remains a
  pure function over the two facts it already receives.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own
worktree** and the artifact committed (CI gates on no-diff); a changeset
is present with its `bumps:` block. **Do not edit versions by hand.**

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Check `git branch
--show-current` is `main` before that edit** — an agent today committed
plan bookkeeping onto another agent's branch by not checking.

**Push your first real commit as soon as it exists**, and **push again
immediately after any rebase**.

### Scope guard

`packages/board/src/server/fleet.ts` (`prState`, the note), the
change-marker's transition rule in
`packages/board/src/app/components/AgentList.tsx`, the empty-state text
for WAITING ON A MACHINE, and their tests.

**Do NOT change `plot-host.sh`.** It already reports both facts
correctly; the defect is entirely in the board's fold.

**Do NOT change the Bitbucket adapter.** It is at its limit, and a
separate plan in `agent-skills` (#59) covers teaching `bb` to answer.

**Do NOT touch `classify()`'s grouping**, the stuck detection's own
logic, or the resolver.

**`not-started-counts-plans` is in flight in `AgentList.tsx`.** Your
change there is small (the marker's transition rule); rebase rather than
race, and keep it narrow.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom. Recent waves put their
decisions in **exported pure functions** and asserted those. `prState`
already is one; the marker's transition rule should be too.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**Two known CI flakes — neither is yours:** Playwright's CDN `403`, and
`discovery.test.mjs` counting `plot-board-branch-*` in a shared
`os.tmpdir()`. Report rather than work around.

**GitHub's API returned `503` repeatedly this afternoon** — the very
condition this fix addresses. If a push or merge fails that way, retry.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
