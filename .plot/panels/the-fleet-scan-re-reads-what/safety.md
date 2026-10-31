# Safety juror: the-fleet-scan-re-reads-what

Position: amend

## Summary

Slice 1 is safe and ships alone: it changes how the scan computes, not what it reads. Slices 2 and 3 are correct in intent, but the plan states two things that are false as written. First, an answer keyed by object id can be wrong in three named cases. Second, the dirty set in step 3 omits most of the inputs the scan reads, and it names the wrong PR source. Slice 4 has no bound on the age of the bridge. The plan must close these gaps before approval. It does not need a different design.

## What I executed and what I only read

Executed, read-only, in `/Users/jwloka/Quatico/Agentic-Tools/plot` on 2026-10-31:

- `git ls-tree -r origin/main -- docs/plans | wc -l` gives 1242. This count includes the `active/` entries (2 today) and the `delivered/` symlinks, so "1242 plan files" overcounts a little.
- `git for-each-ref refs/remotes/origin` gives 11 refs and `refs/heads` gives 58, which is 69 in total. That is consistent with the plan's 66 if the plan counted local and remote heads together. The plan must say which refs it counted, because the scan walks `refs/remotes/origin` (`plot-fleet-scan.sh:758`) and `refs/heads` (`:1956`) for different questions.
- `time git for-each-ref` gives 9 ms and `time git ls-tree -r origin/main -- docs/plans` gives 62 ms. Change detection is cheap, as the plan says.
- `grep -c 'scan failed: timed out after 90000ms' .plot/logs/fleetd.err` gives 620, one more than the plan's 619.
- `git log --since='6 hours ago' origin/main` gives 50 commits. `git log origin/main --merges` gives 888 merges, which is below `MERGE_SCAN_LIMIT` 20000.
- `ps` and `lsof -d cwd`: at the moment of the check, the board (pid 20622) ran `plot-fleet-scan.sh --stream` (pid 6304) and fleetd (pid 74654) ran `plot-fleet-scan.sh --json` (pid 39159). Both had the cwd of this repository, and neither had `--offline`, so both ran `git fetch -q --prune` (`:385`) at the same time. One sample does not prove a steady state, but it shows that the concurrency is real.
- `git rev-parse --is-shallow-repository` gives `false`. `refs/replace` holds 0 refs.

Only read: `plot-fleet-scan.sh` (the input sites cited below), `plot-worker-state.sh`, `plot-plan-meta.sh:125-145`, `packages/fleet/src/shared/fleet-scan.ts:40-80,700-740` and `auto-dispatch.ts:76-185`. I ran no scan, no test, and no fleet or board command.

## 1. Motivation

The motivation holds. The four loop sites exist at the cited lines: `ref_mode_of` at `:2782`, `ref_plan_file` at `:2837-2887` (two `basename` calls per plan), and the merge-subject loop at `:3714-3745`, which runs `basename "$(readlink …)"` and a `case` over `$SUBJECT_ADDING` per plan. The ancestry calls are at `:3762-3769`. I did not re-run the trace, so the 40 s figure is the plan's measurement and not mine.

## 2. Every input the scan reads, and how it must enter the cache

The plan's dirty set names four inputs: changed plans, moved branches, branches a changed plan names, and changed PR-index rows. The scan reads at least 18. The table below gives each input and its rule. "Every beat" means the scan reads the input again on each beat and caches no answer from it.

| # | Input | Site | Rule |
|---|---|---|---|
| 1 | `git fetch --prune` result and `FETCH_ERROR` | `:385` | Every beat. A failed fetch is a fact for the footer (`:5375`). The incremental path must report it the same way. |
| 2 | `origin/$MAIN` tip | `:476`, `:2736`, `:2322`, `:2378`, `:3922` | Snapshot oid. Every main-relative reading (`conflicts_of`, `changed_paths_of`, `real_commits_beyond_main`, `local_ahead_of`, `commits_landed`) must have the key (main oid, branch oid). The plan's "moved branches" misses a branch that did not move while main did. |
| 3 | `refs/remotes/origin/*` with oids | `:758` | Snapshot. A ref that is created or deleted (deleted by `--prune`) must count as moved, not only a ref whose oid changed. A deletion is what sends a branch into the refless merge-subject path (`:3734`). |
| 4 | `refs/heads/*` | `:1956`, `:2225`, `:2599` | Snapshot. The plan's step 3 names only "branches" and does not say local heads. |
| 5 | Plan tree on `origin/$MAIN` with modes and symlink targets | `:2736`, `:2837` | Key by blob oid **and** symlink target. A symlink in `active/` can move without a change to the blob it names. |
| 6 | Plan files that exist only on a prefix branch | `:3342-3357` | The set depends on all refs, and the first branch in `REMOTE_REFS` order wins (`seen_branch_plans`). A cache per blob is safe. The *set* must be recomputed whenever any prefix ref moves. |
| 7 | Plan parse (`plot-plan-meta.sh … --prefixes "$PREFIX_RE"`) | `:3111` | The key must be (blob oid, `PREFIX_RE`, parser version). The answer depends on config and on the parser, not only on the blob. |
| 8 | `<!-- waits: … -->` edges between plans | `plot-plan-meta.sh:134`, `rules/eligible.ts:184` | A waits edge names a branch of any plan. A moved branch therefore changes the eligibility of a plan that did not change. This is safe only if verdicts are derived over all readings every beat, as step 3 says. The plan must state that the dirty set bounds *reads* and never *verdicts*. |
| 9 | Merge subjects on main | `:476` | Key by merge commit oid. This is immutable and safe. The raw subject may be cached. The rule's interpretation may not, because it reads `ORIGIN_URL` (`:3705`) and the host backend (`:3706`). |
| 10 | Commits that added each plan | `:3640` | Key by main oid. A new main recomputes the list or extends it from the old tip. |
| 11 | `remote.origin.url`, `plot-host.sh backend` | `:3705-3706`, `:407` | Every beat, or part of the cache key. |
| 12 | Plot Config in the working tree's `CLAUDE.md` (`cfg`) | `:262`, `:320`, `:328` | No git object id covers it. A digest of the config must be part of every key, or a config change must empty the cache. A changed `Main branch` or branch prefix list changes every answer. |
| 13 | `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE` | `:905`, `:1456`, `fleet-scan.ts:733-734` | Every beat. These are what the scan reads from the host. The scan does **not** read the PR index (`.plot/state/index/github.json`). The plan's "changed PR-index rows" names the wrong source. A PR that goes from draft to ready, or whose CI goes from pending to green, moves no ref. Only the listing row shows it. |
| 14 | `git worktree list` | `:1831` | Every beat. Worktrees appear and disappear with no ref move. |
| 15 | `git status --porcelain` in each worktree and the lock | `:2005`, `:1858` | Every beat. Uncommitted work has no object id. |
| 16 | Worker pid, `.startedAt`, `.plot-worker.exit`, registry `.plot/agents/*.json`, process table | `plot-worker-state.sh:183,314-327` | Every beat. A process dies with no change in git. |
| 17 | `PLOT-BLOCKED*` and `PLOT-CORRECTION.md` in a desk | `plot-worker-state.sh:472,492,513` | Every beat. |
| 18 | Worker log mtime, worktree file mtimes, and `now` | `:2572-2640`, `:1714` | Every beat. `changed_ago_of` returns seconds since `now`. A cached copy of that reading is wrong one beat later. Cache only the epoch, if anything. |
| 19 | Previous `last-pulse.json` | `:5217`, `:5428` | Read for the delta. It is an output, not an input to verdicts. If it became one, slice 3 would turn it into a persisted verdict. |

Rows 13 to 18 are cheap. There are 11 remote branches and few worktrees, so reading them every beat costs little. The plan must name them as inputs it reads every beat. It must not try to put them in a dirty set.

## 3. Where an answer keyed by object id is wrong

The plan says: *"a ref move never makes them wrong, so the cache needs pruning and never invalidation."* That holds for a fact computed from the objects in the key. It fails in these cases:

1. **A key from one snapshot and a value from a ref name.** The scan reads by name: `git show "origin/$MAIN:$p"` (`:2860`), `git merge-tree … "origin/$MAIN" "origin/$1"` (`:2322`), `git diff "origin/$MAIN...origin/$1"` (`:2378`). Two scans fetch with `--prune` at the same time (measured above). A ref can therefore move between the snapshot and the read. The value is then stored under a key it does not belong to, and with "never invalidation" it stays wrong. **This is the one case that makes the cache permanently wrong.** The fix: every read during a beat resolves through the oid in the snapshot (`git cat-file blob <oid>`, `git merge-tree <main-oid> <branch-oid>`), never through the ref name.
2. **`unknown` is not an answer.** The ancestry site at `:3762-3769` has three results. `unknown` means a commit that this checkout cannot read *yet*. A later fetch turns it into `yes` or `no`. The cache may store `yes` and `no` and must never store `unknown`. The same rule applies to a missing blob or a `git show` that fails.
3. **A parse is a function of the parser.** A parsed plan depends on `plot-plan-meta.sh`, on the Python reshaper at `:3112-3150` and on `PREFIX_RE`. Fast-forwarding main changes the scripts while fleetd keeps running, because fleetd starts the shell script again on each beat. A cache held in fleetd's memory would then serve the old parser's answer. The key must include a version: a hash of the parser files or of the bundle.
4. **Shallow history and replace refs.** `merge-base --is-ancestor` can answer `no` on a shallow clone and `yes` after a deepen. It also changes under `refs/replace`. This repository is not shallow and has no replace refs (measured). An adopting repository can have either. The cache must refuse ancestry entries when `--is-shallow-repository` is `true` or `refs/replace` is not empty.
5. **The within-run blob cache keys by basename** (`:2876`, `$REF_TMP/$(basename "$p")`). That is safe inside one run. Carried across beats, it would serve an old plan body under a new blob. Slice 2 must key by oid and must not extend this cache.

## 4. Where a stale reading starts, releases, reaps, merges or delivers wrongly

- **Start.** `auto-dispatch.ts:140` starts agents from `startableBranches(pulse, …)`. A stale `open` for a branch that has merged, or a stale "prior slice merged", starts an agent on the wrong slice. Today `plot-dispatch.sh:3852` re-checks with its own cold scan (`--list-eligible`). That re-check is an independent guard only while the dispatch scan does not share fleetd's cache. **Open Question 2 decides this.** A cache on disk that both processes read removes the guard.
- **Restart and reap.** A cached worker state (`running` when the process is dead, or `failed` when it is alive) restarts a live desk, which gives two agents on one branch, or keeps a dead one. Rows 14 to 17 must be read every beat.
- **Release a claim.** A claim is a `plot: claim` commit beyond main (`:244`). `real_commits_beyond_main` decides between `claimed` and `wip`, and it is main-relative (row 2). If the key leaves out the main oid, a claim that has merged still reads as a claim.
- **Merge and deliver.** These do not trust the scan. `plot-ask.mjs merge` asks the host again, and delivery reads `mergedAt` (`plot-pr-merged.sh`, *One Answer To "Did This Land"*). A stale scan cannot cause a wrong merge or a wrong delivery. The plan must state this as a constraint that slice 5 keeps when the walk moves into the domain.
- **Slice 4.** fleetd's scan timed out 620 times. A board that sees a live fleetd heartbeat and reads `last-pulse.json` would then show a bridge that never updates. `plot-dispatch-command.mjs` reads the same bridge. The heartbeat proves that fleetd is alive. It does not prove that its scan finishes. Slice 4 must also check the bridge's own age: if the bridge is older than about two scan budgets, the board runs its own scan or shows the bridge as stale.

## 5. Slices

- Slice 1: right cut, and it can ship alone. Its done-condition must be an output byte-compare. Run `plot-fleet-scan.sh --json --offline` before and after on the same refs, and require identical output except the timing fields. Give the wall and CPU figures under one stated load.
- Slices 2 and 3 are in the wrong order for safety. The corpus test (full scan compared with incremental scan) is the only proof for either slice, and it ships in slice 3. Slice 2 changes behaviour first and has no such proof. Move the corpus harness into slice 2, or ship it as a slice of its own before slice 2.
- The dirty set in slice 3 is a second invalidation mechanism on top of the keys from slice 2, and it is the riskier one, because it requires a hand-kept list of dependents (rows 2, 3, 6 and 8 show four that the plan misses). If every reading is keyed by the full tuple of oids it depends on (step 2, corrected as in section 3), the dirty set follows from the keys: an unchanged key is a cache hit. Recommend that slice 3 becomes "key every git reading by its full oid tuple, and read rows 1, 11 to 18 every beat" rather than a snapshot diff.
- Slice 4 can ship before slices 2 and 3, and it removes a whole concurrent scan. It needs the bridge age bound above.
- Slice 5: see question 4 below.

## 6. How we would know

- The corpus test must cover these states, and each needs a fixture where the two arms disagree if the cache is wrong: main moves while the branch stays; a branch ref is deleted by prune; a symlink in `active/` is retargeted; a `waits:` prerequisite in another plan merges; a listing row changes only `ciChecks` or draft; an object is missing and then fetched (`unknown` to `yes`); `PREFIX_RE` changes; the parser changes.
- A race test: move `origin/<branch>` between the snapshot and the reads (a stub `git` that fetches during the beat). Assert that the cache holds no entry whose key differs from the oid that was read.
- Count `unknown` entries in the cache. The count must be 0.

## 7. Open Questions

1. *Which inputs besides plans and refs?* Answered in the table in section 2: 19 inputs. Rows 1 and 11 to 18 are read every beat. Rows 2 to 10 go into the oid key.
2. *Where does the cache live across a restart?* In fleetd's memory only, or in a file under the git common dir that only fleetd writes and reads, keyed by parser version and config digest. It must not be a file that `plot-dispatch.sh --list-eligible` reads. That scan's cold run is the independent re-check before a start (section 4). A cold start is a full scan, and the plan accepts that cost already.
3. *Is the board's `--stream` scan concurrent with fleetd's?* One sample, measured: yes. Pid 6304 (board, `--stream`) and pid 39159 (fleetd, `--json`) ran in the same repository at the same time, and both fetched. The steady state needs a count over time, for example sampling `ps` once a minute for an hour. The sample is enough to require fix 3.1.
4. *Do slices 1 and 2 pay once slice 5 lands?* Slice 1 pays now, because it cuts the measured overrun with no change in behaviour. Slice 2 in shell would be a cache that slice 5 must rewrite in TypeScript. Do the oid-keyed cache once, on the domain side, behind `Refs`. The *A Shell Script Asks The Domain* section and the shell line ratchet (`scripts/check-shell-lines.sh`) both favour that. A shell cache adds lines that slice 5 then removes.

## 8. Amendments required before approval

1. Replace *"a ref move never makes them wrong … never invalidation"* with the exact rule: a cached answer is a function of the objects in its key, read through those oids and never through a ref name. `unknown` and failed reads are never cached. The key includes the parser version and a digest of the Plot Config. Ancestry entries are refused on a shallow repository or when `refs/replace` is not empty.
2. Replace "changed PR-index rows" with `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE`, which are read every beat. The scan does not read the PR index.
3. Add the table of inputs (section 2), or a reference to it, with the rule for each: oid key or every beat. Name local heads, ref deletion, symlink targets, main-relative readings and cross-plan `waits:` edges.
4. State that the dirty set bounds reads only. Verdicts stay a function of all readings on every beat.
5. Move the corpus harness into slice 2 or before it, and list the fixtures in section 6.
6. Add a bridge-age bound to slice 4.
7. Answer Open Question 2 in the plan: the cache is not shared with the dispatch re-check scan.
8. Fix the refs count: say whether 66 means remote refs, local heads or both.
