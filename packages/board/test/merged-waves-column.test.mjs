// A plan whose every wave holds a merged branch reaches the phase after
// Development on its own — asserted through the shipped artifact, against a
// planted pulse a failing scan can never overwrite.
//
// The bridge + broken-scan pairing is borrowed from `bridge.test.mjs`: planting
// a pulse by hand and pointing the server at a scan that always fails means the
// served board reflects EXACTLY the branch states planted, with no live scan to
// race. That is what lets "all merged → the later column" and "one open → still
// Development" be asserted deterministically.
//
// The point the plan turns on is also asserted here: the plan FILE still reads
// `Phase: Approved` after the board has moved its card. Reaching the column is a
// measurement; delivering is a decision, and nothing here writes one.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, fetchBoard, SCRIPTS_DIR, rmTree } from './helpers.mjs';

const BRIDGE = '.plot/state/last-pulse.json';

const ALL_MERGED = '2026-08-21-all-waves-merged.md';
const ONE_OPEN = '2026-08-21-one-wave-open.md';
const DELIVERED = '2026-08-21-already-delivered.md';
const WITH_DEFERRED = '2026-08-21-merged-with-deferred.md';

const approvedPlan = (title) => `# ${title}
## Status
- **Phase:** Approved
- **Type:** bug
`;

const deliveredPlan = (title) => `# ${title}
## Status
- **Phase:** Delivered
- **Type:** bug
- **Delivered:** 2026-08-20, jwloka, everything landed
`;

/** A scratch repo with the four plan files — no git needed; the pulse is planted. */
function makeRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-merged-waves-'));
  const plans = path.join(tmp, 'docs/plans');
  fs.mkdirSync(plans, { recursive: true });
  fs.writeFileSync(path.join(plans, ALL_MERGED), approvedPlan('Every wave merged'), 'utf8');
  fs.writeFileSync(path.join(plans, ONE_OPEN), approvedPlan('One wave still open'), 'utf8');
  fs.writeFileSync(path.join(plans, DELIVERED), deliveredPlan('Already delivered'), 'utf8');
  fs.writeFileSync(path.join(plans, WITH_DEFERRED), approvedPlan('Merged beside a deferred branch'), 'utf8');
  return { tmp, cleanup: () => rmTree(tmp) };
}

const branch = (name, state) => ({ branch: name, state, deferred: state === 'deferred', claimed: '' });
const oneWave = (name, verdict, branches) => ({ name, verdict, branches });

/**
 * Plant a pulse describing the four plans' branch states by hand, so the served
 * board is a function of the states below and nothing else. Paired with a scan
 * that cannot succeed, this is the only source the server has.
 */
function plantBridge(repo) {
  const file = path.join(repo, BRIDGE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const plans = [
    // Every non-deferred branch merged across two waves → reaches the later phase.
    { file: ALL_MERGED, phase: 'approved', waves: [
      oneWave('Reached', 'complete', [branch('feature/a', 'merged')]),
      oneWave('Verified', 'complete', [branch('feature/b', 'merged'), branch('feature/c', 'merged')]),
    ] },
    // One branch open → the work is not done, stays in Development.
    { file: ONE_OPEN, phase: 'approved', waves: [
      oneWave('Reached', 'complete', [branch('feature/d', 'merged')]),
      oneWave('Verified', 'eligible', [branch('feature/e', 'open')]),
    ] },
    // Already delivered → the mapper put it past Development; the bump must not
    // touch it, and it must not be dragged back either.
    { file: DELIVERED, phase: 'delivered', waves: [
      oneWave('Reached', 'complete', [branch('feature/f', 'merged')]),
    ] },
    // Merged beside a deferred branch → the deferred one is exempt, so this
    // reaches the later phase too.
    { file: WITH_DEFERRED, phase: 'approved', waves: [
      oneWave('Reached', 'complete', [branch('feature/g', 'merged'), branch('feature/shelved', 'deferred')]),
    ] },
  ];
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    at: Date.now(),
    pulse: {
      main: 'main', head: 'main',
      plans,
      summary: { plans: plans.length, waves: 5, branches: 6, claimed: 0, eligible: 1, blocked: 0, deferred: 1 },
    },
    ages: [], branchUrlBase: '', approvedAt: [], ideaPlans: [],
  }), 'utf8');
}

/** A scripts dir whose scan always fails — the planted pulse is then the only source. */
function makeBrokenScan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-merged-waves-scan-'));
  for (const name of fs.readdirSync(SCRIPTS_DIR)) {
    if (name === 'plot-fleet-scan.sh') continue;
    fs.symlinkSync(path.join(SCRIPTS_DIR, name), path.join(dir, name));
  }
  fs.writeFileSync(
    path.join(dir, 'plot-fleet-scan.sh'),
    '#!/usr/bin/env bash\necho "scan is broken on purpose" >&2\nexit 3\n',
    { mode: 0o755 },
  );
  return { dir, cleanup: () => rmTree(dir) };
}

const cardIn = (board, phase, name) =>
  board.columns.find((c) => c.phase === phase)?.cards.find((k) => path.basename(k.path) === name);

describe('merged waves reach the phase after Development on their own', () => {
  let fixture, broken, server, board;

  before(async () => {
    fixture = makeRepo();
    broken = makeBrokenScan();
    plantBridge(fixture.tmp);
    server = await startServer(fixture.tmp, { PLOT_SCRIPTS_DIR: broken.dir });
    board = await fetchBoard(server.port);
  });

  after(() => {
    server?.kill();
    broken?.cleanup();
    fixture?.cleanup();
  });

  it('moves an all-merged approved plan out of Development into the later column', () => {
    assert.ok(!cardIn(board, 'Development', ALL_MERGED), 'an all-merged plan must leave Development');
    assert.ok(cardIn(board, 'Endgame', ALL_MERGED), 'it reaches the phase after Development');
  });

  it('counts a deferred branch as exempt — merged-beside-deferred also reaches it', () => {
    assert.ok(!cardIn(board, 'Development', WITH_DEFERRED), 'a deferred branch does not hold the plan back');
    assert.ok(cardIn(board, 'Endgame', WITH_DEFERRED), 'six-merged-three-deferred is complete');
  });

  it('leaves a plan with one open branch in Development — assert the negative', () => {
    // An implementation that flags everything passes only the positive tests.
    assert.ok(cardIn(board, 'Development', ONE_OPEN), 'one open branch means the work is not done');
    assert.ok(!cardIn(board, 'Endgame', ONE_OPEN), 'and it has NOT reached the later phase');
  });

  it('does not drag or double-move an already delivered plan', () => {
    assert.ok(cardIn(board, 'Endgame', DELIVERED), 'a delivered plan stays where the mapper put it');
    assert.ok(!cardIn(board, 'Development', DELIVERED), 'and is never pulled back to Development');
  });

  it('flips no phase in the plan file — reaching the column is a measurement, not a delivery', () => {
    // THE point of the wave. The board moved the card; the file is untouched, so
    // a person still decides delivery from here. Nothing wrote a `Delivered:`
    // record or changed `Phase:`.
    const raw = fs.readFileSync(path.join(fixture.tmp, 'docs/plans', ALL_MERGED), 'utf8');
    assert.match(raw, /- \*\*Phase:\*\* Approved/, 'the plan file still reads Approved');
    assert.ok(!/Delivered:/.test(raw), 'no delivery record was written');
  });
});
