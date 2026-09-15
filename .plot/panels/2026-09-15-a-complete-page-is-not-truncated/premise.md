# Premise lens — a-complete-page-is-not-truncated (#912)

Read on `origin/main` @ `af09f8dcb`. Machine has `bb 1.9.0`.

## Summary

The plan carries **two independent false premises**, either of which alone sinks it. The code it quotes is real and quoted accurately, but the two facts the fix rests on — that `bb` returns a *fixed* page, and that this warning is what cost the board its PRs — are both false on main.

## 1. Which factual claims are true

**TRUE, verified.** The quoted code is accurate.

- `plot-host.sh:1817` — `[ -n "$limit" ] || return 0`, no-limit callers owed nothing.
- `plot-host.sh:1818` — `[ "$count" -gt 0 ] 2>/dev/null || return 0`, the empty-page early return. **Confirmed.**
- `plot-host.sh:1819-1822` — the GitHub arm returns early when `count < limit`. **Confirmed**, and it is guarded by `if [ "$be" = "github" ]`.
- `plot-host.sh:1823-1826` — Bitbucket falls through unconditionally to the `echo … >&2`. **Confirmed.**
- The quoted comments at `:1787-1790` and `:1791-1795` are verbatim. **Confirmed.**
- `plot-host.sh:2976` does emit *"bitbucket ignores --limit $limit; bb returns a fixed page (50 at 1.0.0)"*. **Confirmed** the string exists.

**FALSE — the first premise.** The plan reads that comment at `:2976` as a *standing fact about the host* and builds the whole fix on it. It is a **stale note about `bb` 1.0.0**, and it is wrong about `bb` 1.9.0, which is what is installed. This is precisely the error class the panel was warned about: a neighbouring comment read as the definition in use.

I read the actual `bb` source (`~/.claude/plugins/cache/quatico-marketplace/working-with-bitbucket-api/1.9.0/bin/bb`):

- `cmd_pr_list:831` calls `bb_paginate "$path"` **with no limit argument**.
- `bb_paginate:193-195` — `local limit="${1:-50}"`, so the cap defaults to 50.
- `bb_paginate:203` — `while [[ -n "$url" && "$page" -lt 10 ]]` — it **follows `.next` and walks up to ten pages**, accumulating with `jq '$a + $b'` at `:222`.

So `bb pr list` does **not** return "a fixed page". It returns `min(50, everything reachable in 10 pages)`. The 50 is a **client-side accumulator cap inside `bb`**, not a server page size. Bitbucket's own `pagelen` is a separate number the plan never mentions (compare `bb:2210`, which passes `?pagelen=30` explicitly for commits).

**FALSE — the second premise, and this one is fatal on its own.** The plan's "What the wrong answer costs" says the board renders branches as `commits, no PR ever opened` **"under a banner saying the data is unavailable"**, i.e. it attributes the measured loss to this warning. It does not.

- `scripts-shell.ts:87` — `if (run.code === 0) return { answer: 'answered', stdout: run.stdout };` — on a successful exit **`run.stderr` is discarded entirely**. The warning never leaves the adapter.
- `pr_list_report_truncation` never changes the exit code — it is a bare `echo … >&2` at `plot-host.sh:1826` and the function ends.
- `fleet.ts:2483` — `if (said.answer !== 'answered') throw new Error(said.said);` — the *only* thing that can reach `prError` from a successful call is `allUnknown` (`fleet.ts:2536`), a content test on `pr.state`, not on any warning.
- A grep of `packages/board/src` and `packages/domain/src` for `possibly truncated` / `truncat` returns **zero** consumers of this message. The plan's own "Board impact" comment asserts *"the board consumes the warning this changes"*. **It does not consume it.**

So the warning is stderr-only and orphaned by design — `plot-host.sh:1800-1812` says so explicitly: *"THE REPORT GOES TO STDERR, not a stdout sentinel"*, kept *"machine-readable for a future diff"*. Silencing it for Bitbucket changes **no rendered state whatsoever**.

That means the measured cost on `quaweb-website` — three open PRs rendered as no PR — **has a different cause that this plan has not found**. Nine branches, two with open PRs, under an unavailable banner is the shape of `allUnknown` (`fleet.ts:2538`) or of a thrown refusal (`fleet.ts:2565`), neither of which this function can produce.

## 2. Is the core inference sound

**No, on three counts.**

- *Does `bb` have a fixed page size?* No — see above. It has a 50-row **client-side cap** after up to 10 server pages.
- *Is it discoverable at runtime?* No. `bb pr list --help` lists `--state`, `--author`, `--json`, `--jq` and nothing else; there is no `--limit`, no `--all`, no page-size flag, and no way for `bb` to report its own cap. `bb --help` exposes no pagination control.
- *Could a page below the cap still be incomplete?* **Yes, and this is the real defect in the inference.** `bb_paginate:203` breaks at `page == 10`. A repo whose server `pagelen` is small enough that 10 pages yield fewer than 50 rows returns a **short page that is genuinely truncated** — under 50 and incomplete. The plan's rule would call that complete and silence the warning on exactly the case it must not. The author filter fallback at `bb:834-848` also refetches and then **filters client-side** with `jq select`, producing a short result from a truncated superset. So "below the size" does not imply "complete" even granting a known size.

The GitHub argument does not transfer. GitHub's `--limit` is a value *this script requested and the host honoured*, so `count < limit` means the host ran out of rows. Bitbucket's 50 is a cap the script never requested and cannot observe, applied after a page walk that has its own separate bound.

## 3. Where would the page size come from

**There is no source, and the plan assumes one exists.** It requires the size to "travel with the backend rather than as a constant in the comparison" and never names where it is read from. I searched: `plot-host.sh` contains no `pagelen`, `page_size`, `pageSize` or `page-size`; the only `50` is prose in comments at `:1780`, `:1783`, `:2971`, `:2976`. `bb` offers no interrogation path.

The only implementable reading is a Plot-side constant `50` — which is exactly what `plot-host.sh:1783-1785` forbids by name: *"THE DETECTOR IS AGAINST THE REQUESTED LIMIT, NEVER THE CONSTANT 50. A future `bb` page size of 100 must not make a truncated 100-row list report complete — this plan's own defect restored."* The plan proposes to restore the defect that comment was written to prevent, and it does not engage with that sentence.

The plan's escape — "where the page size is not known, the current behaviour stands" — is not a safety valve but the whole outcome: the size is **never** knowable, so a correct implementation changes nothing and an incorrect one hardcodes 50.

## 4. What `Done when` fails to pin

Every gate is satisfiable by an implementation that is wrong.

- *"a known page size of 50"* — the gate supplies the fact the production path cannot obtain. A test can pass a `50` a real run will never have. Nothing pins **where a real run reads it**, so "read from the backend" is untested at the only point that matters.
- *"asserting a different declared size moves the threshold"* — this tests that a parameter is threaded, not that any backend can declare one. Passes against a hardcoded default plus a test-only override.
- Nothing pins the **10-page bound**: an implementation can satisfy every gate and still report a genuinely truncated short page as complete.
- Nothing pins a **rendered** outcome. Given §1, the honest gate — *the board shows the PRs* — cannot be written, because no board state depends on this message. The `Board impact` comment claims a consumer that does not exist, and no gate catches that.
- `pnpm run test:contracts` gates the helper estate, not the board, so it cannot fail on the unconsumed warning either.

## 5. Strongest argument against doing this at all

**It cannot fix #912, and the PR would close the ticket.** The reported symptom is branches rendering as having no PR under an unavailable banner. The warning this plan narrows is written to stderr, dropped at `scripts-shell.ts:87`, and read by nothing. Shipping it changes no rendered state, so the operator on `quaweb-website` sees the identical board — while the ticket is marked fixed and the real cause goes unlooked-for. That is worse than doing nothing: it spends the diagnosis.

Secondarily, it trades a warning that is currently **honest and conservative** for one that rests on a number nothing can read, reversing a comment that names this exact regression.

## What should happen instead

1. Find the real cause of #912 at `fleet.ts:2483` / `:2536` / `:2565` — which of `answer !== 'answered'`, `allUnknown`, or a throw fired on that repo. The banner is `prError`; capture its text.
2. Correct `plot-host.sh:2976` and `:2971`, which state a `bb` behaviour that stopped being true — `bb` 1.9.0 paginates to 10 pages under a 50-row client cap.
3. If the truncation warning is still wanted, give it a consumer first. An unread message cannot be too loud.

Verdict: reject
