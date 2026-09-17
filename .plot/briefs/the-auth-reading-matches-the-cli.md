## Implementation brief — the-auth-reading-matches-the-cli (wave: The auth reading matches what the CLI prints)

- **Plan (canonical):** `docs/plans/2026-09-17-a-probe-reading-is-not-a-guess.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `bug/the-auth-reading-matches-the-cli` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

**First of two slices.** `bug/a-jenkinsfile-is-found-where-it-lives` is the
second and touches the same file; it waits on this one landing.

### What to build

`plot-board-probe.sh:266` matches the success case as
`'jenkins auth:[[:space:]]*reachable'`. The CLI prints:

```
Jenkins auth:  OK — jan.wloka@quatico.com
```

Match what it prints.

### Two things the panel settled — read them before you write a test

**The pre-state is `unknown`, not `failed`.** `classify` answers `failed` only on
a non-zero exit, and `jen` exits non-zero only on its failure branch. A
reachable Jenkins currently reads **`unknown`**. A regression test asserting
`failed` would pass for the wrong reason.

**REPLACE the word, do not add it.** Three fixtures assert
`Jenkins auth:  reachable` — `boardprobe.test.mjs:351`, `:444`, `:504` — a
string the CLI **never emits**. `ok|reachable` keeps them green and keeps the
fiction alive. Rewrite all three to the CLI's real line, and a gate asserts the
old string is gone from the file.

### Keep what is already right

- `not reachable` is tested **before** `reachable`; one contains the other.
- Only the `Jenkins auth:` line carries the answer — `jen … auth status` exits 0
  for a slug that does not exist.
- `unknown` still never rounds up to authenticated.
- An absent `jen`, or an unset instance, reads exactly as today.

### Repo gates

`pnpm run test:contracts`.
