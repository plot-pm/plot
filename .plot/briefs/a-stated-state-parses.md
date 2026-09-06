## Implementation brief — a-stated-state-parses (slice: The parse refuses an unadmitted state)

- **Plan (canonical):** `docs/plans/2026-09-06-a-stated-state-is-one-the-domain-admits.md` on `main`
- **Branch:** `bug/a-stated-state-parses` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of two, and it gates slice 2 — the four files cannot be corrected against a rule that does not exist yet.

## The defect

**Four files hold a state their schema rejects.** Measured 2026-09-06:

```
docs/stories/plot-gates/…                        status: archived
docs/stories/setup-asks-what-the-repo…/…         status: archived
docs/stories/the-board-is-blank-where-it…/…      status: archived
docs/sprints/2026-W36-a-half-landed-workflow…    Phase: Planned
```

`StoryStatusSchema` admits `draft ready active in-review paused done`. `SprintStateSchema` admits `Planning Committed Active Closed`. **Neither `archived` nor `Planned` is in either.**

**Both were found by a person reading files, in one session.** `plot-story-lint.sh` answers `0 finding(s)` over the three stories; the reconcile scan's thirteen sections never ask whether a state parses.

## Where the refusal goes, and why not the shell

**READ THE PLAN'S ROUND-2 CORRECTION FIRST.** Its first draft said `plot-plan-meta.sh` parses all three file kinds. **It does not** — its `sprint` and `story` fields are what a *plan* declares, not a parse of those files.

**Three readers, one validates:**

| file kind | reader | validates? |
|---|---|---|
| plan | `plot-plan-meta.sh:338` | **yes** — falls through to `UNKNOWN` |
| story | `plot-story-lint.sh:81`, `awk` over frontmatter | no |
| sprint | `plot-reconcile-scan.sh` | no |
| **both** | `board.ts` — `parseSprintFile:1086`, `parseStoryContent` | no |

**The board is the only component that parses both and the only one already holding both schemas** — `contract/schema.ts:189` (`SPRINT_PHASES`) and `:196` (story statuses). One change covers both file kinds; teaching two shell scripts to validate would be two more hand-copies.

## NO NEW COPY OF EITHER LIST

**#721 just established the direction.** It removed `BOARD_PHASES`'s hand-copy from `contract/schema.ts` and made the board import the domain's. `SPRINT_PHASES` at `:189` is the next one to go the same way, and this slice must not add a third spelling.

**Import `SprintStateSchema` and `StoryStatusSchema` from the domain.** If routing them is more than this slice can carry, say so and validate against what the board already declares — but do not write a fourth list.

## The pattern

`plot-plan-meta.sh:338` is the shape:

```awk
if (t ~ /^(draft|design|approved|delivered|released|rejected|superseded)$/) return t
if (t == "ready-for-review" || t == "in-review") return "approved"
...
return "UNKNOWN"
```

An admitted list, a legacy mapping, and a reading for everything else. **`UNKNOWN` is a reading, not an error** — the parser reports what it read and refuses nothing downstream, the same direction `unaskable` takes for a host.

## The shell readers inherit nothing, and that is stated

`plot-story-lint.sh:81` and the reconcile scan keep reading what the file says. They gain no validation here. **What they gain is a board that no longer renders an unadmitted value as if it parsed** — which is what let three stories and a sprint sit wrong for weeks.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

**A test per file kind**, each asserting an unadmitted value does not parse as admitted. The four measured cases are the fixtures.

## Done when

- `parseSprintFile` and `parseStoryContent` refuse a value their schema does not admit
- neither declares a new copy of either list
- an admitted value parses exactly as it does today
- a test covers both file kinds
- the gates above pass

## Do not

- **Do not write a fourth story-status or third sprint-phase list.** The domain has both; #721 shows the import.
- **Do not teach `plot-story-lint.sh` or the reconcile scan to validate.** Two shell copies is the thing this slice exists to avoid.
- **Do not turn `UNKNOWN` into an error.** The parser reports; consumers decide.
- **Do not correct the four files here.** That is slice 2, and it needs `archiveStory` for the three stories.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
