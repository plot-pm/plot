## Implementation brief — reconcile-23-checks-no-plan-under

- **Plan (canonical):** `docs/plans/2026-10-21-reconcile-23-checks-no-plan-under.md` on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2256 merged
- **Branch:** `bug/reconcile-23-checks-no-plan-under` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-reconcile-scan.sh` §23 ("a finished plan's issue is still open") refuses
outright under `Tracker: jira`:

```
plot-reconcile-scan.sh:3081  elif [ "$oi_ask" = tracker ] && [ "$oi_scheme" = "jira" ]; then
plot-reconcile-scan.sh:3085    echo "  (not evaluated — plan Issue: numbers cannot be matched to Jira keys)"
```

Issue #2249 measured 6 unchecked plans on `ewz-kus-portal` (plot main
`be96cdfe4`, 2026-10-21, read-only) because of this refusal — the "issue still
open after delivery" check never runs where the tracker is Jira. Make it run.

### The decisions the plan settles — do not re-derive them

**The reader the plan's Open Question #1 asks about already exists, and §23
already calls it.** `plot-plan-meta.sh:605-611` parses Jira keys
(`[A-Z][A-Z0-9]*-[0-9]+`) into the same `issues[]` field as GitHub `#N`
numbers, gated on `PARSE_KEY_ISSUES=1` — set whenever `Tracker` is `jira` or
`linear` (`plot-plan-meta.sh:360`). §23's own `oi_claims` (line 3007-3010)
already reads `.issues` from that parse for the whole sweep (`plan_json`, one
`plot-plan-meta.sh` run). **There is no second parser to add or call** — the
refusal at line 3081 throws away data that is already sitting in `oi_claims`.

**The membership test downstream is already backend-agnostic — do not special-case
the comparison.** `plot-host.sh`'s Jira arm of `issue-list` (line 4978) maps
`number: .key`, so `.number` already carries the Jira key STRING
(`PROJ-123`), not a numeric id — comment at `plot-host.sh:4961-4964`
("`number` is the Jira KEY... #447 taught the parser to read that form"). §23's
existing membership test (`grep -x -F -f`, line 3126-3127) is plain fixed-string
line matching, so it already works for a key as much as a number. **The fix is
almost entirely deletion**: drop the `oi_scheme = jira` special case at line
3081-3086 so the Jira ask falls through to the same `issue-list` + compare path
every other tracker already takes. Re-special-casing the comparison (e.g.
writing a second matcher for string keys) duplicates code the gate already
runs.

**Open Question #2 (does Jira's list return closed issues too, so "open"
means what §23 needs) is answered — and it is the one real trap.** The
`issue-list` Jira arm's default `--state open` query is **not** "every open
issue in the project" — it is Jira's "my inbox": `assignee = currentUser()
AND ...` unless `Ticket prefixes` is configured, in which case the person
clause drops and the query is scoped to `project IN (...)` instead
(`plot-host.sh` issue-list case, the `person=""` / `scope` logic directly
above the JQL assembly, also documented at the `jira_require_config` /
`tracker_projects` comments). **A repo with no `Ticket prefixes` declared
gets back only the calling identity's assigned tickets** — comparing a
finished plan's Jira key against that narrow list would read every ticket not
assigned to the caller as "closed" (false negative: §23 would silently miss
open tickets reassigned to someone else). This is the measured defect
`an-outage-is-not-an-answer` and `host_miss_or_fail` already guard for the
"nobody answered" case; this is the quieter sibling — "somebody answered, but
not about the ticket you asked" — and it is specific to Jira's scoping, not
present on the GitHub arm (whose `issue-list` lists the whole repo). Decide
and state in the PR body whether §23 needs `Ticket prefixes` declared as a
precondition for a trustworthy Jira answer, or needs to pass a JQL override
scoped to the exact keys (`issue-list` has no such flag today — adding one is
in scope only if the inbox scoping proves too narrow to use as-is).

**Open Question #3 (does the Jira list have a result limit) is already
answered the same way GitHub's is.** `issue-list --limit` is accepted on both
backends and §23 already passes `--limit "$ISSUE_LIMIT"` (line 3093) — no new
limit plumbing is needed; just confirm `$ISSUE_LIMIT`'s existing value/config
key covers the Jira arm too (it is backend-agnostic in `plot-host.sh`).

**Keep the three outcomes apart, per the plan's Design step 2 and the
surrounding section's own established pattern.** `(not evaluated — ...)`
for "could not ask", a stated count for "answered, here are the open ones",
and the existing "not checked" treatment (plan's Design step 3) for a
finished plan with no key found via either `#N` or `PROJ-123` parsing — never
silently drop an unchecked plan into a clean result. `--offline`/`--no-pr`
behaviour (line 3061-3068, `pr_source=off`) is untouched; it already runs
before the tracker-specific branch and must keep doing so.

**Duplication rule, stated by the plan and by `CLAUDE.md` "A Shell Script
Asks The Domain":** if this slice ends up needing a second, shell-side Jira
key reader for any reason, it must join the corpus tier
(`packages/domain/corpus/`) with a comparison test against the domain's own
rule. Given the finding above — that no second reader is needed, only
deletion of the refusal — this should not come up; if it does, treat it as a
sign the "almost entirely deletion" read was wrong and re-check against this
brief before adding one.

### Done when

The plan's `## Done when` list does not exist as a separate section in this
plan (merged into Design above) — so the specification is: §23 reports a
checked count and names every unchecked plan under `Tracker: jira`, stays
advisory (`open_issues=`, no `attention=`, no close command — plan Design
step 4), and the existing non-Jira paths (GitHub, `nobody`, `unaskable`,
offline) are unchanged. Add or extend `test/reconcile/*.test.mjs` coverage
(or the shell fixture style already used for §23's other arms) proving:
a Jira-tracked repo with a finished plan whose key is in the tracker's
returned open set reports it as a finding; a finished plan whose key is
absent from that set is NOT reported as open (closed, correctly read); a
finished plan with no parseable key is counted as unchecked rather than
silently clean.

Plus: this repo's gates — `node skills/plot/scripts/board/plot-local-checks.mjs`,
run before each push; run what it prints. The suites in the `CI suites`
config key run in CI, and a failure there comes back as a correction. List no
full suite.

The shell gate applies: `scripts/check-shell-lines.sh` refuses a pull request
whose shell under `skills/` is longer than at its merge base. This slice
touches `plot-reconcile-scan.sh` (a `.sh` file) — given the fix is mostly
deletion (removing the Jira refusal block), it should net-shrink the file, but
confirm against the gate before pushing; if any addition is needed, it is
paid for in the same change.

### Bookkeeping

Open the PR through the controller once there is a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this
branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` §23 (around
lines 3000-3140) and any new/extended test fixtures under
`test/reconcile/` covering it. It does not touch `plot-plan-meta.sh`'s key
parsing (already correct and shared with the sprint/Release comparison) or
`plot-host.sh`'s `issue-list` Jira arm (already correct per the trap named
above) — if either looks wrong while implementing, report it rather than
editing it in this branch; this slice's job is reading what they already
produce, not changing how they produce it. No other branch is in flight
against this plan (single-slice plan, no wave structure).

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
