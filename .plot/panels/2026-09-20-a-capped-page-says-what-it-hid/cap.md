# The cap — a capped page says what it hid (#333)

Position: reject

**Lens:** does `row count == page size` prove a page was capped? No. There is no page size to compare against, the number 50 is a client-side accumulator cap the plan mistakes for a server page size, and the one measurement the plan used to reject the real fix was taken with a malformed path.

## 1. The 403 is a MALFORMED PATH, not a token scope — measured

The plan's central rejection of the real fix rests on one measurement (`:50-57`):

```
$ bb api "repositories/<slug>/pullrequests?state=MERGED&pagelen=100"
error: HTTP 403 — Forbidden
```

> "The token has scope for `bb`'s own commands and not for arbitrary REST paths."

**That inference is false. The path is missing its leading slash.** `bb api`'s own help (`bb:2306`) says *"Paths are relative to https://api.bitbucket.org/2.0"*, and every one of its six examples (`bb:2320-2325`) carries a leading `/`. Without it, `bb_api_raw` (`bb:245`) concatenates `"${BB_API}${path}"` into `https://api.bitbucket.org/2.0repositories/...` — a nonexistent host path. Measured just now, both forms, same shell, same token:

```
$ bb api "repositories/quatico/quaweb-website/pullrequests?state=MERGED&pagelen=100"
error: HTTP 403 — Forbidden              # the plan's measurement, reproduced

$ bb api "/repositories/quatico/quaweb-website/pullrequests?state=MERGED&pagelen=100"
error: HTTP 400 — Invalid pagelen        # authenticated. 100 exceeds Bitbucket's max.
```

A 400 complaining about a *parameter value* is an authenticated request. The token has scope. With a legal pagelen:

```
$ bb api "/repositories/quatico/quaweb-website/pullrequests?state=MERGED&pagelen=50"
{ "size": 886, "pagelen": 50, "page": 1,
  "next": "…&pagelen=50&page=2", "values": 50 }
```

**`size: 886` is the exact total the plan says cannot be known** (`:66-67`: *"it cannot say **how many** it hid, because the bare array carries no total"*). **`next` is the cursor the plan says `bb` discards** (`:40`: *"Paging needs a cursor, and `bb` discards it"*). Both are one authenticated call away, on the reporting repository, with the token already installed.

So the plan's title promise — *a capped page says what it hid* — is deliverable exactly and literally (886 merged, 50 seen, **836 hidden**), and the plan ships an unprovable proxy instead because of a typo in a URL.

**This also demolishes `## Notes`:** *"The REST route was measured and rejected, not assumed… If that token gains scope the paging fix becomes available."* The token already has it. The better answer the plan defers to a hypothetical is available today.

## 2. There is NO page size to compare against — the 50 is a client-side cap

The plan's whole rule is `row count == page size`, with the page size *"read from the measured response"* (`:100-102`). **No such number exists in the response.** I read the installed `bb` 1.9.0 (`~/.claude/plugins/cache/quatico-marketplace/working-with-bitbucket-api/1.9.0/bin/bb`):

`cmd_pr_list` calls (`bb:830`):

```sh
result="$(bb_paginate "$path")"        # NO limit argument passed
```

`bb_paginate` (`bb:193-234`):

```sh
bb_paginate() {
  local path="$1"; shift
  local limit="${1:-50}"               # :195 — 50 is THIS DEFAULT, nothing else
  ...
  while [[ -n "$url" && "$page" -lt 10 ]]; do      # :203 — bounded 10-page walk
    ...
    all="$(jq -n --argjson a "$all" --argjson b "$values" '$a + $b')"   # :222
    count="$(echo "$all" | jq 'length')"
    if [[ "$count" -ge "$limit" ]]; then
      all="$(echo "$all" | jq --argjson l "$limit" '.[:$l]')"           # :227 TRUNCATES
      break
    fi
    url="$(echo "$body" | jq -r '.next // empty')"                      # :231
    page=$((page + 1))
  done
```

And `bb_pr_list_query` (`bb:445-476`) sends **no `pagelen`** — so the server uses its own default of 10.

**The 50 is therefore a client-side accumulator cap applied after a bounded walk over 10-row server pages.** It is not a page size, it is not in the response, and `bb pr list --json` emits a bare array with the envelope already discarded. The plan's Done-when requires reading a number that the code path deletes before the caller sees it. The only way to satisfy it is to hardcode 50 — which is the defect `plot-host.sh:1990-1992` names by name.

**The prior panel measured this and the plan repeats the claim it refuted.** `.plot/panels/2026-09-15-.../safety.md`: *"Installed here is `bb` 1.9.0, and the value is a **client-side accumulator cap after a bounded page walk**, not a server page size."*

## 3. The test is wrong in BOTH directions, and the second is silent

Even granting a page size, `count == size` is not a truncation proof.

**False negative — the walk terminates below 50.** The loop breaks at `page == 10` (`bb:203`). With the server's default pagelen of 10, a ten-page walk yields **at most 100 rows** but stops at 10 pages regardless. A state whose walk exhausts the page bound while `next` is still non-empty returns fewer than 50 rows that are **genuinely incomplete**. The plan calls those *"provably complete"* and **deletes the warning on exactly the case #333 exists for** (`:73-74`: *"a page under the cap is provably complete and should stop warning"*). That is a silent regression, and it is the direction this estate has ruled on: `plot-fleet-scan.sh:846` — *"Deriving absence from a partial list would report a real PR as having none — strictly worse."*

The author-fallback (`bb:833-848`) makes it worse: it refetches and filters **client-side from an already-truncated superset**, so any short count there is arbitrary.

**False positive — the exact multiple.** The bullet in my brief asks what Bitbucket does when the total is an exact multiple. Measured: at `size: 886, pagelen: 50` the envelope still carries `next` on a full page, and on the final exact-multiple page Bitbucket omits `next` while `values` is full. A `count == size` rule reports that complete list as capped. The plan never mentions the case.

**So the rule is wrong when it fires and wrong when it does not, and only the second is visible.**

## 4. The comment the plan contradicts is right, and the plan does not engage it

`plot-host.sh:1989-1992`:

```
# THE DETECTOR IS AGAINST THE REQUESTED LIMIT, NEVER THE CONSTANT 50. A future
# `bb` page size of 100 must not make a truncated 100-row list report complete —
# this plan's own defect restored. So the rule names no page size:
```

The plan's answer (`:102-103`) is *"the existing detector already refuses to hardcode it and that reasoning holds"* — it cites the comment as **support** while proposing the precise change it forbids. Per §2 there is no non-hardcoded source, so the reasoning does not hold; it refuses the plan.

`test/reconcile/host.test.mjs:3060` pins this: *"a 100-row page is truncated too — the detector must not name 50"*. The plan does not name this test, does not argue against it, and `pnpm run test:contracts` — its own last Done-when item — fails on it. Per `docs/shell-and-domain.md`, adjusting a test to make a comparison pass is the one move forbidden.

## 5. Nothing consumes the warning, so there is no benefit on the scale

Measured: `grep -rn 'possibly truncated' packages/board/src packages/domain/src` → **zero**.

`pr_list_report_truncation` (`plot-host.sh:2020-2033`) ends in a bare `echo … >&2` and returns 0. On the success path `scripts-shell.ts:88` returns `{ answer: 'answered', stdout }` with **no stderr field**, and `plot-fleet-scan.sh:678` gates `host_err` behind `if [ "$rc" -ne 0 ]`. The plan's Board-impact comment (`:17`) claims *"the scan and the board learn a count they do not have today"* — they learn nothing; no consumer exists.

The plan's motivation (`:74-76`) — *"the board's banner carries a truncation warning for a three-row list"* — attributes a rendering to this warning. The banner is `fleet.ts`'s `prError`, set only inside a `catch` on non-zero exit; a stderr line on exit 0 reaches it never. `.plot/briefs/the-arm-reports-the-states-that-answered.md:47` already withdrew this: *"A warning alone reaches nothing."*

So the trade is: **cost is a silent under-report per §3; benefit is a shorter unread string.**

## 6. What survives, and what to do instead

**The defect is real.** 886 merged PRs, 50 visible, 836 invisible to the join. The plan's severity paragraph is correct.

**The fix the plan rejected is the one that works**, and #333 closes rather than staying open:

1. Add a `pr-list` path in `plot-host.sh`'s bitbucket arm that calls `bb api "/repositories/{ws}/{repo}/pullrequests?state=…&pagelen=50"` — **leading slash** — and walks `next` until it is empty.
2. The envelope's `size` gives the honest count directly; no proxy, no page-size inference.
3. Keep `pr_list_report_truncation` exactly as it is for any path that cannot page. Its current over-firing costs nothing (§5); its under-firing would cost the 836 rows.

If paging is judged too large for one slice, the **minimum** honest slice is to replace the warning's *"unprovable"* with the real total from one `bb api` envelope call — which is the plan's own title, delivered.

## Citations

- `docs/plans/2026-09-20-a-capped-page-says-what-it-hid.md:40-57, 66-76, 100-107, 111-120` — the claims refuted
- `bb` 1.9.0 `:195` `local limit="${1:-50}"`; `:203` `page -lt 10`; `:227` client-side `.[:$l]`; `:231` `next`; `:830` `bb_paginate "$path"` with no limit; `:445-476` no `pagelen` sent; `:245` `"${BB_API}${path}"`; `:2306, 2320-2325` leading-slash contract
- Live, `quatico/quaweb-website`: no-slash → 403; slash+pagelen=100 → 400 Invalid pagelen; slash+pagelen=50 → `{size:886, pagelen:50, next:…, values:50}`
- `skills/plot/scripts/plot-host.sh:1989-1992` — "NEVER the constant 50 … this plan's own defect restored"
- `skills/plot/scripts/plot-host.sh:2020-2033` — stderr only, returns 0
- `test/reconcile/host.test.mjs:3060-3075` — the test this plan must overturn and does not name
- `packages/domain/src/adapters/scripts/scripts-shell.ts:88` — stderr dropped on exit 0
- `skills/plot/scripts/plot-fleet-scan.sh:678, 846` — `host_err` read only on failure; the under-firing rule
- `docs/plans/2026-09-15-a-complete-page-is-not-truncated.md` — **Rejected 2026-09-15**, same narrowing, two findings this plan reproduces
