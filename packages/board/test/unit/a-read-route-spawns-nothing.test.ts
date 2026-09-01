import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type EntryPoint,
  onDisk,
  SYNC_SPAWNS,
  walkReadPath,
  walkWholeGraph,
} from '../gate/no-sync-spawn.js';

/**
 * A READ ROUTE SPAWNS NOTHING — the gate, not the claim.
 *
 * `2026-08-31-the-read-path-stops-spawning.md`, the Proving slice, and the
 * measurement it closes is the plan's first `Done when`:
 *
 * > A `sample` of the board under load shows no `SyncProcessRunner::Spawn` below
 * > a read route's handler.
 *
 * Deliberately not a latency number. Contention flatters and spoils a number,
 * while the call either is on the stack or is not — and the original reading is
 * what makes that the right subject: **4258 of 4262 main-thread samples** held
 * `node::SyncProcessRunner::Spawn` below the request handler, on a board
 * refusing every request. A synchronous spawn cannot yield, so a static file
 * timed out at 15 s beside one.
 *
 * ## Why it is a gate
 *
 * The repo's own test: can you answer *"did I do this?"* without doing the work?
 * A rule saying *the read path must not spawn* passes that test, so it is a
 * rule. This fails a build, which is the difference.
 *
 * And it is the arm the three migrating waves could not carry themselves. Each
 * one moved its own files and proved its own behaviour; none of them could
 * refuse a spawn added to a fourth file next month, because the read path
 * crosses fourteen modules and no per-file check sees the crossing.
 *
 * ## What the population is, and why it is not a list of files
 *
 * The functions that run on the request's own stack, walked from the three
 * entry points the read routes call. Not the files: three read-path files keep a
 * documented synchronous twin for the write routes that cannot await yet
 * (`board.ts:readConfig`, `registry.ts:readManifestDirConfig`,
 * `agent-log.ts:readWorktreeRoot`), and a check that reddened them would be
 * turned off — which is the brief's own instruction.
 *
 * **The write routes are NOT in the population, and that is a decision rather
 * than an omission.** `idea.ts` (7 spawns), `deliver.ts` (3), `dispatch.ts` (3),
 * `reslice.ts` (3), `continue.ts` (3), `transition.ts` (2), `approve.ts` (2),
 * `commission.ts` (1) belong to `production-calls-the-domain-one-rule-at-a-time`.
 * A write route blocking for two seconds is a button that feels slow to one
 * person; a read-path spawn blocked every request in flight.
 *
 * See `test/gate/no-sync-spawn.ts` for what the walk follows and what it cannot
 * see, and `test/unit/no-sync-spawn.test.ts` for the walker's own tests.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, '../../src/server');

/**
 * WHERE A READ REQUEST ENTERS THE PROGRAM.
 *
 * Read off `src/server/index.ts`, and each one is a call the handler makes
 * directly:
 *
 * | route | call |
 * |---|---|
 * | `/api/board` | `await boardState({ opts, estate })`, then `await serverInfo(...)` |
 * | `/api/fleet` | `await fleetState({ opts, estate })` |
 *
 * `serverInfo` is listed separately because the handler calls it directly rather
 * than through the controller — it answers a fact about this SERVER's binding,
 * which a controller has no business inventing.
 *
 * Their resolution is asserted below. An entry point that no longer exists would
 * shrink the walk to nothing and take the gate with it, silently.
 */
const ENTRIES: readonly EntryPoint[] = [
  { file: path.join(SERVER, 'controllers/fleet-state.ts'), fn: 'boardState' },
  { file: path.join(SERVER, 'controllers/fleet-state.ts'), fn: 'fleetState' },
  { file: path.join(SERVER, 'server-info.ts'), fn: 'serverInfo' },
];

const prefix = walkReadPath(ENTRIES, onDisk);
const whole = walkWholeGraph(ENTRIES, onDisk);

/**
 * The size of the walk when this slice landed, as a floor rather than a target.
 *
 * A gate over an empty set passes and proves nothing — the failure
 * `stubbed-tests-start-no-board.test.ts` names, and the one this shape is most
 * exposed to: the walk resolves by name, so a renamed entry point or a moved
 * controller reduces it to zero and every assertion below goes green.
 *
 * A floor and not an equality, because unlike a test COUNT this number is not a
 * decision anybody makes. It moves whenever the read path gains or loses a
 * helper, which is ordinary work; it collapsing is not.
 *
 * Measured 2026-09-01: 11 on the prefix, 165 in the whole graph.
 */
const PREFIX_FLOOR = 8;
const GRAPH_FLOOR = 120;

describe('a read route spawns nothing', () => {
  it('finds the entry points it is meant to gate', () => {
    // The first way this file could stop being a gate: a route renamed, a
    // controller moved, and a walk over nothing.
    expect(
      prefix.unresolved.map((e) => `${path.basename(e.file)}:${e.fn}`),
      'a read route\'s entry point no longer resolves — the walk starts nowhere, '
      + 'so every assertion in this file would pass without checking anything. '
      + 'Repoint ENTRIES at what `/api/board` and `/api/fleet` call now',
    ).toEqual([]);
  });

  it('walks a population large enough to mean something', () => {
    // The second way: the entry points resolve, but the walk stops at the door
    // because a call moved behind a value the resolver cannot follow.
    expect(
      prefix.reached.length,
      `only ${prefix.reached.length} functions run before the read path yields, `
      + `down from ${PREFIX_FLOOR}. Either the read path shrank or the walk lost `
      + 'it — check `test/gate/no-sync-spawn.ts` before lowering this',
    ).toBeGreaterThanOrEqual(PREFIX_FLOOR);
    expect(
      whole.reached.length,
      'the whole call graph under a read route shrank sharply — the prefix above '
      + 'is only meaningful as a prefix OF something',
    ).toBeGreaterThanOrEqual(GRAPH_FLOOR);
  });

  it('runs no synchronous spawn below a read route\'s handler', () => {
    // THE GATE. Every trail is printed on failure, because *which* read route
    // reaches *which* spawn is the whole diagnosis — the four causes named from
    // reading the source on 2026-08-31 were all wrong, and the stack took five
    // seconds.
    expect(
      prefix.offences.map((o) => o.trail),
      'a read route reaches a synchronous spawn on its own stack. A synchronous '
      + 'spawn cannot yield, so the board serves NOTHING while it runs — a static '
      + 'file timed out at 15 s beside one on 2026-08-31. Move the call behind a '
      + `port, or behind an await: ${SYNC_SPAWNS.join(', ')} are all refused here`,
    ).toEqual([]);
  });

  /**
   * THE SURVIVORS, COUNTED WHERE THEY ARE — behind an await, on a later tick.
   *
   * ONE synchronous spawn is still reachable from a read route if `await` is
   * ignored, and it is a documented decision of the wave that left it:
   *
   * | trail ends in | left by |
   * |---|---|
   * | `auto-dispatch.ts:findMissingBriefs` | the automatic write, on the SCAN's clock inside its success path |
   *
   * Two more were counted here until 2026-09-02, and both are now migrated:
   * `agent-log.ts:readWorktreeRoot` and `auto-deliver.ts:deliverCommand` →
   * `board.ts:readConfig`. Neither file holds a synchronous spawn any more.
   *
   * It sits after many awaits in `fleet.ts:refresh`, which `ensureCache` STARTS
   * and never awaits. That is why it is not the gate above — and why it is
   * counted at all: the failure this number catches is it MOVING onto the
   * prefix, or a second appearing, either of which is a finding for a reviewer
   * rather than a silent change.
   *
   * A count and not a list of names, for the reason the population is walked
   * rather than listed: a list is a second place to update and it fails open.
   * The count moves only when the estate moves, and the diff that moves it says
   * which one.
   */
  it('leaves exactly the synchronous spawns the earlier waves documented', () => {
    expect(
      whole.offences.length,
      'the number of synchronous spawns reachable from a read route changed. '
      + 'None of them is on the request stack — the gate above is what asserts '
      + 'that — but each is a decision some wave wrote down, so adding or '
      + `removing one costs a line here. The trails:\n  ${
        whole.offences.map((o) => o.trail).join('\n  ')}`,
    ).toBe(SPAWNS_BEHIND_AN_AWAIT);
  });
});

/**
 * One on 2026-09-02, down from three, and lowering it is the interesting
 * direction.
 *
 * `production-calls-the-domain-one-rule-at-a-time` migrated the write-route call
 * sites that kept `agent-log.ts:readWorktreeRoot` synchronous, and
 * `auto-deliver.ts:deliverCommand` followed. The survivor is owned by the same
 * plan.
 *
 * A RATCHET, so this number goes down and never up. Raising it to accommodate a
 * new synchronous spawn is the change this test exists to refuse.
 */
const SPAWNS_BEHIND_AN_AWAIT = 1;
