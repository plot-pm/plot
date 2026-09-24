# Estate lens — a-released-plan-tells-its-tracker

Position: amend

The defect is real and nothing implements it. But the plan's Motivation table is the load-bearing claim — *"every piece is built, only the caller is missing"* — and on this estate that table is **wrong in the one place it matters**. Four of its five rows are inaccurate, three of the four headline numbers are wrong, and the write the plan says exists cannot write to an issue on this repository's own tracker. Slice 2 as written cannot be built against the port it names.

## 1. The headline numbers, recomputed

Measured 2026-09-24 on `main` @ `a7687f38c`, all 331 plan files parsed with `plot-plan-meta.sh`, open set from `plot-host.sh issue-list --limit 300`.

| the plan says | measured | verdict |
|---|---|---|
| 322 plans | **331** | wrong |
| 23 plans name an issue | **33** | wrong (+43%) |
| 22 released name an issue | **18 released**, 21 released-or-delivered | wrong |
| 7 open tickets | **10** | wrong |
| 1 whose issue is still open → #935 | **1 → #935** | **CORRECT** |
| 299 plans name no issue | **298** | off by one, harmless |

Open set: `935 965 966 967 968 969 970 971 972 973`. The only finished plan naming an open issue is `docs/plans/2026-09-17-a-gate-matches-an-invocation.md` (`released`, `Issue: #935`). Nine of the ten open tickets are today's own drafts.

**The core finding survives the recount.** Every stale number moves in the direction that makes the plan's own case *weaker* per capita (33 issue-naming plans, not 23, and still one miss), so this is a correction, not a refutation. But a plan whose stated evidence is 3-for-4 wrong cannot be approved on that evidence.

## 2. The Motivation table — four of five rows wrong

| row | claim | measured |
|---|---|---|
| `plot-host.sh issue-status` | implemented | **TRUE** — `skills/plot/scripts/plot-host.sh:4302`, header at `:286` |
| `statusWrite` GitHub | `tracker-github.ts:72` | **path wrong** — `packages/domain/src/adapters/tracker/tracker-github.ts:72`. Line is right, directory is not (`adapters/tracker/`, not `adapters/`) |
| `statusWrite` Jira "calls the host" | `tracker-jira.ts:86` | **line wrong** — `statusWrite` is at `packages/domain/src/adapters/tracker/tracker-jira.ts:77`. `:86` is the `issue-status` call *inside* it |
| `Issue:` parsed as `issues[]`, **23 plans** | 23 | **33** (see §1) |
| a lifecycle step calling any of it: **none** | none | **TRUE** — see §3 |

## 3. The gap is real — confirmed

- `grep -rn statusWrite packages/domain/src packages/board/src` excluding the port definition and `adapters/tracker/` returns **zero production callers**. Only the interface (`ports/tracker.ts:135`), the four connectors, and `test/tracker-shell.test.ts`.
- `packages/domain/src/workflows/deliver.ts`, `workflows/release.ts`, `transitions/release.ts`, `entities/release.ts`, `packages/board/src/server/deliver.ts` — **zero** matches for `tracker|issue|Issue` in all five. The plan's "zero times" is correct.
- `git log -S 'statusWrite'`: only `2efbbf504` (Giving issue tracking its own port, #718), `bcc166262` (#745), `5d7d14c91`, plus this plan's own commit `7b9d83824`. **No prior attempt at a lifecycle caller.** `git log -S 'issueStatus'`: nothing.
- Prior plans naming tracker status: `2026-09-09-every-issue-renders-as-open-issue.md` (Released) states at `:78` *"The one op naming a status, `issue-status`, is the tracker port's single write. There is no read path for an issue's status anywhere."* That confirms the gap from the other direction and is **not** prior art for the write path. `2026-09-07-the-build-pipeline-is-its-own-connector.md:134` inventories the plumbing. Neither built this.

**No sibling arm already ships it.** This is not the shipped-five-days-ago shape.

## 4. THE BLOCKING FINDING — slice 2's port takes a PR, not an issue

`packages/domain/src/ports/tracker.ts:41-46`:

```
export interface StatusWrite {
  prUrl: string;   // "The pull request the status is about, as its address."
  status: string;
}
```

`:35` states the design intent explicitly: *"THE SUBJECT IS A PLOT ARTIFACT, not a tracker one. Plot names the PR it moved... which ticket, card or item that corresponds to is the tracker's own mapping and the connector's to resolve."*

The plan's Design says the rule is *"over a plan's phase and its `issues[]`"* and step 4 is *"the tracker port writes it"*. **The port has no parameter for an issue.** Two consequences, both fatal to slice 2 as scoped:

- **Jira resolves the key by regex over the PR URL.** `tracker-jira.ts:35` — `keyIn` runs `/\b([A-Z][A-Z0-9]+-\d+)\b/` over `prUrl`. A plan's `issues[]` of `935` never reaches it. Feeding the plan's issue would mean either widening `StatusWrite` — the exact widening `:38` says the port exists to refuse — or synthesising a fake URL.
- **GitHub cannot write to an issue at all.** `tracker-github.ts:72` shells to `plot-update-board.sh`, whose header reads *"Update GitHub Projects board status for a PR ... Adds the PR to the board (idempotent) and sets its Status field."* It touches **no issue**. On this repository — `Git host: github`, issues on github.com — the "already implemented write" moves a Projects board row for a pull request. It would not have closed or re-statused #935.
- **And `plot-host.sh issue-status` is Jira-only by design.** `:4312` — *"JIRA ONLY, and deliberately so rather than by omission"*; `:4323` is a bare `[ "$(tracker_scheme)" = "jira" ] || exit 4`. Bitbucket has no arm.

So on Plot's own repository, slice 2's chain terminates in a connector that writes to a Projects board, while the measured defect is a github.com **issue** left open. **The plan's central premise — "nothing new is built there" — is false for the only tracker this estate actually runs.** The plan must either scope slice 2 to Jira and say so, or admit it is adding an issue-status arm to the GitHub connector, which is new remote-write code and a much larger argument.

## 5. `trackerNone` — claim VERIFIED

`packages/domain/src/adapters/tracker/tracker-none.ts:30` — `statusWrite: async (): Promise<PortResult<StatusOutcome>> => unaskable()`. Every one of `issueList`, `issueView`, `statusWrite`, `limit` answers `unaskable`; the file's own docstring says *"EVERY OPERATION IS `unaskable`, INCLUDING THE WRITE."* The plan quotes this accurately. This is the one refusal that needs no new work.

## 6. The reconcile scan has no such section — slice 1 is NOT redundant

All 22 sections enumerated from `skills/plot/scripts/plot-reconcile-scan.sh` (1 `:971`, 2 `:979`, 3 `:1085`, 4 `:1216`, 5 `:1243`, 7 `:1318`, 8 `:1381`, 9-11 `:1558`-`:1566`, 12 `:1584`, 13 `:1615`, 14 `:1712`, 15 `:1835`, 16 `:1901`, 17 `:1999`, 18 `:2098`, 19 `:2242`, 20 `:2360`, 21 `:2430`, 22 `:2590`, 6 last at `:2805`). **None reads a tracker.** `grep -n "issue-list\|issue-view\|issue-status"` over the whole scan returns nothing — its only `issue` hit is the word "issues" in a comment at `:468`.

The nearest analogue is **section 13, "Stale sprint tally"** (`:1615`): unchecked *sprint checkbox* items whose plan is delivered/released. Same shape — a finished plan with an unticked marker elsewhere — but it reads a local markdown checkbox, never a remote service. It would not have caught #935.

**Slice 1 is genuinely new**, and it is the right first slice: it would have caught #935 on the next sweep, it needs no write, and it is unaffected by §4 entirely because reading an issue's open/closed state works on every connector (`issue-list` has GitHub, Bitbucket and Jira arms) while writing a status does not.

## 7. Is one miss enough? — yes for slice 1, no for slice 2

The plan asks this honestly and then answers it too generously.

- **For slice 1: yes.** One confirmed miss plus a detector that is currently *a person happening to look* justifies a read-only section at the cost of one scan section. It is advisory, gates nothing, and the same section catches the other 32 issue-naming plans as they finish.
- **For slice 2: not on this evidence.** One miss in 21 finished issue-naming plans is a 4.8% rate — and §4 shows it is not the cheap wiring job the plan costs it as. Given the port mismatch, slice 2 is *new connector work against a remote service*, not a call added to a workflow. The plan's own Notes already say *"if it proves the case is rare, slice 2 can be dropped."* That hedge is correct and should be promoted from a note to the plan's actual position.

**The slice ordering is right.** Slice 1 first, cheap, read-only, works where the write is refused — that judgement is sound and survives every correction above.

## What to amend

1. **Correct all four numbers** to 331 / 33 / 18 released (21 incl. delivered) / 10 open. Keep the finding: one miss, #935.
2. **Fix the three citations** — `packages/domain/src/adapters/tracker/tracker-github.ts:72`, `.../tracker-jira.ts:77`, `packages/domain/src/ports/tracker.ts:135`.
3. **Replace the Motivation table's premise.** "Every piece is built" is false: the write exists for *a PR's status*, not *a plan's issue*, and on GitHub it targets a Projects board. Say which.
4. **Re-scope or defer slice 2.** Either scope it to `Tracker: jira` and state that this repository's own #935 would not be covered, or state plainly that it requires a new GitHub issue-status arm and argue that separately. Add the `StatusWrite` shape as an Open Question — widening it is the thing `ports/tracker.ts:38` names as what the port exists to refuse.
5. **Keep slice 1 unchanged.** It is new, correctly placed, and would have caught the measured defect.
