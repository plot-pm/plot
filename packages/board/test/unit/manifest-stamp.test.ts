// The launch stamp: one contract, two implementations.
//
// A worker's pid is stamped into its manifest by whichever path launched it —
// the dispatcher's detached `sh -c` (inline `awk`, because a fresh shell cannot
// reach a bash function) or `/api/continue` (this TypeScript helper). The two
// MUST produce a byte-identical manifest for the same inputs, or the board reads
// one shape from a dispatched worker and another from a continued one. That is
// the `plot-worker-state.sh` lesson: five of six states drifted while the same
// computation was held in two copies. The cross-implementation identity is
// asserted in `manifest-stamp-parity.test.ts`; this file pins the TS side.
//
// THE DEFECT THIS FIXES: the old stamp fired once per manifest, matching only
// the empty placeholder `  "pid": "",`. A relaunch found a filled pid, matched
// nothing, and left the previous run's corpse on the row. So the stamp must
// UPDATE a filled pid, not only fill an empty one — and record what it displaced.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stampManifest, writeManifestStamp } from '../../src/server/manifest-stamp.js';
import { rmTree } from '../helpers.mjs';

/** The manifest a first dispatch writes — two-space indent, no trailing comma. */
function firstDispatch(pid = '', extra: string[] = []): string {
  return [
    '{',
    '  "session": "sess-1",',
    '  "branch": "feature/x",',
    '  "worktree": "/wt/x",',
    '  "command": "claude -p \\"go\\"",',
    `  "pid": "${pid}",`,
    ...extra,
    '  "startedAt": "2026-08-20T09:00:00Z"',
    '}',
    '',
  ].join('\n');
}

/** The process group a stamped manifest carries, in the order both writers emit. */
const GROUP = { wrapperPid: '7358', workerMonitorPid: '7364', agentMonitorPid: '7365',
  buildMonitorPid: '7367' };
const GROUP_LINES = [
  '  "wrapperPid": "7358",',
  '  "workerMonitorPid": "7364",',
  '  "agentMonitorPid": "7365",',
  '  "buildMonitorPid": "7367",',
];

describe('stampManifest — a first dispatch fills the pid and records the group', () => {
  // THESE TWO ASSERTIONS CHANGED WITH THE PROCESS GROUP, deliberately. They read
  // "a first stamp is byte-identical to today" and "the six launch-time keys",
  // which was the contract until the manifest had to name every process the
  // registry started — the wrapper and both monitors, not just the agent. The
  // estate held 1 manifest, 76 monitor processes and no way to name one of them.
  //
  // What survives is the half still true: a first dispatch carries NO RELAUNCH
  // BOOKKEEPING. What changes is the "and nothing else" half — a stamp now also
  // writes the group, on every path.
  it('replaces the empty placeholder and adds exactly the group', () => {
    const out = stampManifest(firstDispatch(''),
      { pid: '4242', startedAt: '2026-08-20T10:00:00Z', ...GROUP });
    assert.equal(out, firstDispatch('4242', GROUP_LINES),
      'a first stamp fills the pid and writes the group after it — nothing else moves');
  });

  it('adds no previousPid or relaunches on a first dispatch', () => {
    const out = stampManifest(firstDispatch(''),
      { pid: '4242', startedAt: '2026-08-20T10:00:00Z', ...GROUP });
    assert.ok(!out.includes('previousPid'), 'a first dispatch records no displaced pid');
    assert.ok(!out.includes('relaunches'), 'a first dispatch has relaunched zero times');
    const keys = Object.keys(JSON.parse(out));
    assert.deepEqual(keys.sort(),
      ['agentMonitorPid', 'branch', 'buildMonitorPid', 'command', 'pid', 'session', 'startedAt',
        'workerMonitorPid', 'worktree', 'wrapperPid'],
      'the six launch-time keys plus the three the group adds');
  });

  // ABSENT IS NOT NONE, at the writer's end. A caller that knows no group still
  // produces the lines, empty — so a reader can tell "no monitor was started"
  // from "this manifest predates the field".
  it('writes the group lines empty when the caller supplies none', () => {
    const out = stampManifest(firstDispatch(''), { pid: '4242', startedAt: '2026-08-20T10:00:00Z' });
    assert.ok(out.includes('"wrapperPid": "",'), 'the line is present and empty');
    assert.equal(JSON.parse(out).workerMonitorPid, '', 'empty means not attached');
  });
});

describe('stampManifest — a relaunch updates the pid and records what it displaced', () => {
  it('overwrites a filled pid, records previousPid, and sets relaunches to 1', () => {
    const out = stampManifest(firstDispatch('91471'),
      { pid: '69993', startedAt: '2026-08-20T12:00:00Z' });
    const m = JSON.parse(out);
    assert.equal(m.pid, '69993', 'the pid names the current run');
    assert.equal(m.previousPid, '91471', 'and the corpse it replaced');
    assert.equal(m.relaunches, 1, 'first relaunch');
    assert.equal(m.startedAt, '2026-08-20T12:00:00Z', 'startedAt describes the current run');
  });

  it('increments relaunches across TWO relaunches, not only setting previousPid', () => {
    // The assertion a stamp that sets previousPid correctly but never counts
    // would fail: relaunch once, then relaunch the result again.
    const once = stampManifest(firstDispatch('91471'),
      { pid: '69993', startedAt: '2026-08-20T12:00:00Z' });
    const twice = stampManifest(once, { pid: '70001', startedAt: '2026-08-20T13:00:00Z' });
    const m = JSON.parse(twice);
    assert.equal(m.pid, '70001');
    assert.equal(m.previousPid, '69993', 'the second relaunch displaced the first relaunch');
    assert.equal(m.relaunches, 2, 'counted, not just overwritten');
  });

  it('preserves session, branch, worktree and command across a relaunch', () => {
    const out = stampManifest(firstDispatch('91471'),
      { pid: '69993', startedAt: '2026-08-20T12:00:00Z' });
    const m = JSON.parse(out);
    assert.equal(m.session, 'sess-1');
    assert.equal(m.branch, 'feature/x');
    assert.equal(m.worktree, '/wt/x');
    assert.equal(m.command, 'claude -p "go"');
  });
});

describe('writeManifestStamp — atomic, and a no-op the registry can survive', () => {
  let dir = '';
  it('writes through a temp file and rename, never a half-written manifest', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-stamp-'));
    const p = path.join(dir, 'sess-1.json');
    fs.writeFileSync(p, firstDispatch('91471'));
    writeManifestStamp(p, { pid: '69993', startedAt: '2026-08-20T12:00:00Z' });
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(m.pid, '69993');
    assert.equal(m.previousPid, '91471');
    assert.equal(m.relaunches, 1);
    // No temp file left behind.
    assert.deepEqual(fs.readdirSync(dir), ['sess-1.json']);
    rmTree(dir);
  });

  it('leaves the manifest untouched when the file cannot be read', () => {
    // A missing manifest is not an error the caller must handle: the worker is
    // running regardless, and the registry already reads an absent pid as
    // unknown. The helper returns falsy rather than throwing.
    const missing = path.join(os.tmpdir(), 'plot-stamp-nope', 'x.json');
    assert.doesNotThrow(() => writeManifestStamp(missing, { pid: '1', startedAt: 'now' }));
  });
});
