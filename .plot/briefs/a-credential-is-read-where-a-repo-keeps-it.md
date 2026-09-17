## Implementation brief — a-credential-is-read-where-a-repo-keeps-it (wave: A credential is read where a repo keeps it)

- **Plan (canonical):** `docs/plans/2026-09-17-a-credential-is-read-where-a-repo-keeps-it.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `feature/a-credential-is-read-where-a-repo-keeps-it` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

`plot-host.sh:1703` refuses the Jira inbox and tells the operator to create a
token while both values sit working in the repository's `.env`. Nothing on the
estate reads that file.

Where **both** variables are unset, read them from the repository root's `.env`,
and **say the values came from `.env`**. The environment always wins.

### Take the parse from the plan — it has been broken twice

**Do not invent one, and do not use `set -a; . ./.env`.** The plan carries a
`read_env` built with `sed`, measured against ten cases. Two earlier shapes
failed:

- `grep '^NAME=' | cut -d= -f2-` returns **empty** for `export NAME=…` and keeps
  the quotes on `NAME="…"`.
- Stripping quotes **before** whitespace leaves `"tok"` intact on
  `NAME="tok"   `, because the `"$` anchor misses.

**A quoted value reaching `curl -u` produces the 401 this plan removes.** Strip
whitespace, then quotes, then whitespace again — the order is the defect.

### The scope is wider than the refusal path

**The email already persists unredacted.** `plot-host.sh:1742` appends
`${JIRA_EMAIL}` to `budget.tsv` on every Jira call — 2448 lines on one machine.
Today that happens only where somebody exported the variable deliberately; after
your change it happens wherever a `.env` exists. **The widening owns the writing
down.**

**The redaction is not free and it belongs at the SOURCE.** `plot-budget.sh:250`
matches on `$3` — the account is a **key**, not a label, and one machine holds
three distinct Jira accounts. A constant redaction merges their rate windows.
Keep accounts distinguishable. And `slots-file.ts:185` turns an account into a
directory name; Jira does not reach it today only because slots are keyed on
`prAccount`.

### Gates worth reading twice

The value must appear in **no output stream** — assert its absence from stdout
and stderr — **and not in `budget.tsv`**, asserted by reading the ledger after a
call rather than by reading the code. `.env` joins `.gitignore`.

**One case is deliberately unpinned and the plan says so**: a `.env` holding a
STALE token. Naming the source is what makes that diagnosable.

### Repo gates

`pnpm run test:contracts`.
