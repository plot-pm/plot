# Consumer lens — a-complete-page-is-not-truncated (#912)

**Lens question: who consumes this stderr warning, and is removing it for a complete page SUFFICIENT to fix the rendering the ticket reports?**

**Answer: nobody consumes it, and no. The warning is not the discard. The plan fixes a message that reaches no decision.**

---

## 1. Factual claims against main

Read `skills/plot/scripts/plot-host.sh:1815-1827` (the function), `:1774-1814` (the comment block).

**True:**

- The empty-page early return exists — `:1818`, `[ "$count" -gt 0 ] 2>/dev/null || return 0` with the comment *"an empty page had nothing to hide"*.
- The GitHub arm's `count<limit` return exists — `:1819-1822`, gated on `[ "$be" = "github" ]`.
- Bitbucket falls through to the `echo … >&2` at `:1826`.
- The quoted GitHub reasoning is real — `:1787-1790`, verbatim: *"a state is possibly truncated when it returned AT LEAST the requested limit… Fewer rows than the limit PROVES completeness."*
- The quoted *"it can NEVER prove completeness"* is real — `:1791-1793`.
- The warning's page-size sentence is real, but it is NOT in `pr_list_report_truncation`. It is a **different** echo, at `:2976`, in the Bitbucket `pr-list` arm.

**FALSE — the line citations:**

| Plan says | Actually on main |
|---|---|
| `plot-host.sh:1818-1827` for the code block | `:1815-1827` (`:1818` is the empty-page guard, not the block's first line) |
| `:1787-1790` for the GitHub reasoning | correct |
| `:1791-1795` for *"can NEVER prove"* | correct |

The code-block citation is off by three lines. Minor, but this panel exists because six plans this week cited things that were not there — so it is named.

**FALSE — the load-bearing claim.** `## Design` › *"The page size is read, never guessed"*: **"It travels with the backend rather than as a constant in the comparison."** There is no such reading on main. The only place the number 50 appears for Bitbucket is `plot-host.sh:2976`, inside a **hardcoded English string**:

```sh
echo "plot-host: bitbucket ignores --limit $limit; bb returns a fixed page (50 at 1.0.0)" >&2
```

`50` is a literal inside a message. `bb` is never asked its page size; `pr_list_call bb … pr list --state "$_s" --json` (`:2991`, `:3020`, `:3029`) passes no limit and the response carries no total and no cursor — which is precisely what `:1791-1793` says. So the plan's Done-when item *"the page size is read from the backend rather than hardcoded at the comparison, checked by asserting a different declared size moves the threshold"* describes reading a fact that **does not exist to be read**. The only way to satisfy it is to introduce a per-backend declared constant — i.e. hardcode 50 somewhere new and call the new place "the backend". That is the defect `:1783-1785` explicitly forbids: *"THE DETECTOR IS AGAINST THE REQUESTED LIMIT, NEVER THE CONSTANT 50."*

---

## 2. Is the core inference sound?

**As arithmetic, yes. As a fix, it is unreachable.**

The argument — a page below a fixed page size was not capped by that page — is valid, and it is the same argument the GitHub arm makes. But it needs a *known* page size, and §1 shows no known page size exists on main. The plan's own guard (*"Where the page size is not known, the current behaviour stands"*) is therefore not a narrow edge case: **it is every case**, and the implementation as specified changes nothing at all unless a new constant is introduced.

There is also a soundness gap the plan does not address. `bb pr list` is called **once per state** (`:2991`, `:3020`, `:3029`) and the page size, if any, applies **per call**. The count handed to `pr_list_report_truncation` is that one state's `jq 'length'`. The requested `--limit` is the whole-call limit. Comparing a per-state count against a whole-call page size is not the GitHub arm's comparison — GitHub's arm compares one state's count against the limit it actually sent for that state. The plan treats the two as the identical shape and they are not.

---

## 3. What the `Done when` fails to pin

- **Any consumer assertion whatsoever.** Six clauses, all about what `plot-host.sh` prints to stderr. Not one asserts a branch with an open PR renders as having one. The ticket's defect is a rendering; the gate is a message.
- **Where the page size comes from** — see §1. "read from the backend" names no mechanism, no file, no field.
- **The per-state vs whole-call mismatch** in §2.
- **`pnpm run test:contracts` passes** is the only repo gate named. The ticket's symptom lives in `packages/board` — `pnpm run test:board` is not required, consistent with the plan never touching a consumer.

---

## 4. CONSUMER TRACE — the discard is decided elsewhere

`pr-list` has exactly two consumers, both named in the file's own comment at `:1776-1777`.

**Consumer A — `plot-fleet-scan.sh`.** The call, `:675`:

```sh
host_err=$("$script_dir/plot-host.sh" pr-list --state all --limit "$PR_LIST_LIMIT" --rich \
       </dev/null 2>&1 >"$host_list_out"); rc=$?
```

stderr is captured into `host_err`. `host_err` has **exactly two occurrences in the whole file** (`grep -n 'host_err'` → `:675` assignment, `:703` read). The read at `:703` is inside `if [ "$rc" -ne 0 ]`, whose block **`return 0`s at `:742`**. On success the branch is never entered.

`HOST_VERDICT` is assigned at `:645, 700, 701, 702, 720, 739, 740, 746` — and `:746`, `HOST_VERDICT=ok`, is reached on **`rc=0` alone**, guarded by the comment at `:745`: *"The list arrived. An empty one arrived too — that is the whole distinction."*

`pr_list_report_truncation` writes to stderr and **returns 0**. It never touches the exit code. So today, on a Bitbucket page of 3, the warning fires, `rc` is 0, `HOST_VERDICT=ok`, and `host_err` is **discarded unread**. Removing the warning changes `host_err` from an unread string to a shorter unread string. `HOST_VERDICT` is `ok` in both worlds.

**Consumer B — `packages/board/src/server/fleet.ts:2477`,** `scriptsFor(opts).hostSaid(['pr-list', '--rich', …])`. `prError` is set only in the catch/refusal path (`:2549` region); a successful call's stderr does not reach the payload. Same conclusion.

**So what DOES cause the ticket's rendering?** `fleet.ts:6540-6552` names it, dated 2026-09-04, and it is not truncation:

> *"`prs` is filtered to OPEN by construction (see `CacheEntry.prs`), so on this path a branch whose PR was closed or merged arrives as `pr === null`"* … *"Measured 2026-09-04: #363, #369, #527, #654 and eleven more sat in WAITING ON YOU reading **"commits, no PR ever opened"** while the row itself linked the PR number beside that sentence."*

The exact string the ticket reports, with a measured cause — a **join/lookup miss in the classification path**, fixed there by passing `prsByHeadMap` (`:6552`, `const known = pr ?? prsByHeadMap?.get(branch) ?? null`). That is where the decision is made. It reads a PR map; it does not read a truncation warning, because none exists to read.

**Is removing the warning SUFFICIENT?** No. **Is it necessary?** Not established — the plan asserts *"the board discards the whole page rather than the rows it doubts"* and cites no code for it. I looked for that discard and it is not in either consumer: the scan keeps the page (`HOST_VERDICT=ok`, `js=$(cat "$host_list_out")` at `:676`) and the board keeps it too. The plan's `## Design` › *"What the wrong answer costs"* is the one paragraph connecting the warning to the rendering, and it is the paragraph with no file:line.

If the #912 measurement on `quaweb-website` is real — three open PRs rendering as none — the cause is upstream of the warning and this plan will not move it. The plan even concedes the disconnect in `## Design` › *"What this does not do"*: **"It does not change what a consumer does with the warning."** Correct, and since no consumer does anything with the warning, that sentence is the whole plan's outcome.

---

## 5. Strongest argument against doing this at all

**It is a message change filed as a bug fix, and shipping it closes #912 without touching #912's defect.** The ticket reports a rendering; the plan's gate is a stderr string with no reader. If it merges, the board renders exactly as before, the ticket is marked fixed, and the real cause — the open-only PR map at `fleet.ts:6540` — loses its only live measurement. That is worse than doing nothing: a false fix retires the evidence.

Secondary: the change also weakens a correct refusal. `:1783-1785` forbids naming a page size precisely because a future `bb` page of 100 would make a truncated 100-row list report complete. The plan reintroduces that dependency to silence a warning nobody reads — spending a real safety property for no consumer benefit.

---

## Recommendation

Reject as written. If the underlying complaint is real, the plan that fixes it starts at `fleet.ts:6540-6552` and `CacheEntry.prs`'s OPEN-only filter, with a Done-when that asserts a **rendered row**, not a stderr line. If the truncation warning is genuinely over-firing on Bitbucket, that is a separate, honest, cosmetic-tier change — and it should say so, drop the "read from the backend" clause it cannot satisfy, and not claim #912.

Verdict: reject
