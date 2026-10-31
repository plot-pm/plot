# Panel moderation: the-fleet-scan-re-reads-what

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: testability ran `plot-fleet-scan.sh --offline --json` twice (29.6 s and 27.7 s CPU, 249 s and 64 s wall at load 7.8 to 8.9) and showed the two outputs byte-identical after `changed_ago_seconds` is removed; layering timed 500 `basename` calls (35.1 s) against 500 parameter expansions (0.11 s) at load 6 to 7.8; safety sampled `ps` and saw the board's `--stream` scan and fleetd's `--json` scan running and fetching in this repository at once; seams read the bridge `at` at 14:49 as 3.5 minutes old. All four read the scan source and its callers; none ran a test.

## Agreed by all four

1. **Slice 1 is right and ships first.** It changes how the scan computes, not what it reads. It cannot remove the `git merge-base` and `cat-file` ancestry spawns, so those leave slice 1.
2. **Slice 4 already exists.** `fleetOwnsScan` (`packages/domain/src/rules/scan-owner.ts:37`, #1444, #1514, #1557) makes a board beside a live fleetd read `last-pulse.json`. fleetd writes the bridge only after a scan succeeds (`fleet-clock.ts:149-152`), so two timed-out scans age the bridge past `OWNED_BRIDGE_MAX_AGE_MS` (180 s) and the board starts its own scan. The extra scan lengthens fleetd's next one. The overrun feeds itself, and the 14:34 board scan was this fallback.
3. **The plan has no Done-when.** Each slice needs one command. The scan's `--json` is deterministic over a fixed state except `changed_ago_seconds`, so a normalised byte comparison is the oracle.
4. **Open Question 2:** the cache lives in fleetd's memory and travels to the scan per run, like `PLOT_TERMINAL_CACHE`. A restart is a cold full scan.

## Findings from one lens each

- **Safety:** "a ref move never makes them wrong, never invalidation" is false in five cases: a value read by ref name while two scans fetch, a cached `unknown`, a parse that depends on the parser and `PREFIX_RE`, a shallow repository or `refs/replace`, and the basename-keyed blob cache carried across beats. The scan reads 19 inputs; the plan's dirty set names 4 and names the PR index, which the scan does not read. The dispatch re-check (`plot-dispatch.sh --list-eligible`) is an independent guard only while it does not share fleetd's cache.
- **Layering:** a shell cache needs disk and pays the line ratchet; a dirty set at the shell boundary would carry verdict rows across beats. The cache and dirty set belong in TypeScript after the walk moves, over `PlanStore`, `Refs` and `Trees`, not "behind the Refs port".
- **Testability:** the merge-subject loop walks about 1240 plan entries, terminal plans included, while the row loop drops released, rejected and superseded plans unread (`plot-fleet-scan.sh:4305`). If nothing else reads their subject answers, a filter removes most of the 15.6 s and most of the 297 ancestry pairs with no cache. Not yet proved: `SLICE_NAMES` and cross-plan `waits:` are candidate readers.
- **Seams:** `Refs.pulse()` already runs the scan through the port. The scan has nine caller modes (fleetd, board fallback, `Refs.pulse`, `plot-dispatch.sh --slice-names/--list-eligible`, `--next`, `--log-pulse`, `<slug>`, `plot-fleetctl.sh`) and eight corpus files that spawn it. An incremental scan must still emit every plan, because the board drops a plan a finished scan leaves out. The domain walk is larger than one slice and needs its own plan. "1242 plan files" is 619 plans and 623 index links.

## Where they differ

- **Slice 4.** Layering, testability and seams offer: drop it, or change `fleetOwnsScan`. Safety adds a bound on the bridge's age so a board never shows a bridge that stopped. The amended plan changes the rule: fleetd keeps ownership while its scans keep starting, and the board shows the bridge's age instead of scanning; a fleetd that starts no scan hands the scan over as today.
- **Order of cache and walk.** Layering puts the walk (slice 5) before the cache and dirty set; seams moves the walk to its own plan; safety would key every reading by its full oid tuple and drop the hand-kept dirty set. The amended plan keeps slices 1 to 3 here (shell fixes, ownership, settled-plan filter) and moves the walk, the oid cache and the reading-level dirty set into a second plan, whose design starts from safety's input table and key rules.

## Shared blind spot

All four judged cost by the scan alone. None asked how often fleetd's tick needs a fresh reading at all: the scan runs every beat whether a dispatch, merge or progress decision is pending or not. A cheaper scan and a rarer scan are separate levers, and the second plan should measure the second.
