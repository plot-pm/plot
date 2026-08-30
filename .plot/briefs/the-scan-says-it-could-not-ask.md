# Implementation brief — a-throttled-host-says-so (Reporting)

- **Plan (canonical):** `docs/plans/2026-08-29-a-throttled-host-says-so.md` on main
- **Branch:** `bug/the-scan-says-it-could-not-ask` (base: `main`)
- **Ends as:** one PR to main
- **Runs first.** The Rendering slice needs a payload field that does not exist
  until this lands.

### What to build

`plot-host.sh`'s `pr-list` distinguishes *asked and answered* from *could not
ask*, and `plot-fleet-scan.sh` carries that into its summary line and its rows.

### The rule already exists — on the wrong path

**`plot-host.sh:1484` states it in full, for `issue-list`:**

> **THREE OUTCOMES, KEPT APART.** An empty list means the host answered and there
> are none; a non-zero exit with empty stdout means the question failed; exit 4
> means this host cannot be asked at all. Collapsing any two of them reproduces
> `an-outage-is-not-an-answer` — a board that says "no issues" because it could
> not reach the tracker is stating a fact it does not have.

**`pr-list` collapses exactly those two.** The call is unchecked:

```sh
_gh_raw="$(gh pr list --state "$state" … --json number,title,…)"
pr_list_report_truncation github "$limit" "$state" …
printf '%s' "$_gh_raw" | jq -c …
```

The script runs under `set -uo pipefail` — **no `-e`** — so a failed `gh`
continues with `_gh_raw` empty, `jq` emits nothing, and the caller gets an empty
list. Reproduced 2026-08-30 against a nonexistent repo: `exit=1`, stdout empty.

**So this is extending an existing convention, not inventing one.** Read
`issue-list`'s implementation and follow it.

### The scan already has the vocabulary too

`plot-fleet-scan.sh:1701` carries `_pr_ready_degraded` with named reasons
(`no-host`, `no-cache`). You are adding one more reason, not a mechanism.

### What it looked like when it bit

`#513` was merged. Minutes later the scan reported the branch as `open` and
counted it among the unfinished, with `merge_detect=pr-merge` in the summary —
which reads as *the host was asked and answered*. What had actually happened:

```
GraphQL: API rate limit already exceeded for user ID 870334.
```

**Nothing in that output was a warning.**

### Done when

The plan's list, plus the one that discriminates:

- a stubbed host that exits with a rate-limit error produces `host=throttled` in
  the summary and **leaves no row claiming `open`**
- a healthy host still produces `host=ok` and **byte-identical rows** to today
- **a healthy host answering with an EMPTY list still reads `host=ok`, with zero
  PRs**

**That third one is the assertion that carries the slice.** Without it the fix
could be *"treat empty as throttled"*, which trades a silent wrong answer for a
noisy one and breaks a repo that genuinely has no open PRs.

**Mutation to run before calling it done:** make the stub exit 0 with empty
stdout — the suite must stay green. Then exit 1 with empty stdout — it must go
red. If both behave alike, the test is reading the emptiness rather than the
exit code.

Plus: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` (with
`env -u PLOT_UNATTENDED`), changeset with a `bumps: skills:` block.

### Scope guard

`pr-list` and the scan's reporting. Not `issue-list` (it is already right and is
your model), not the board (the Rendering slice), not the other host operations.

**Do not add a retry.** A throttled host is a fact to report; deciding whether
to wait is the caller's, and a retry inside the adapter hides the state this
slice exists to surface.
