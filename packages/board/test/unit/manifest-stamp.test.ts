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

/** The manifest a first dispatch writes — two-space indent, no trailing comma. */
function firstDispatch(pid = ''): string {
  return [
    '{',
    '  "session": "sess-1",',
    '  "branch": "feature/x",',
    '  "worktree": "/wt/x",',
    '  "command": "claude -p \\"go\\"",',
    `  "pid": "${pid}",`,
    '  "startedAt": "2026-08-20T09:00:00Z"',
    '}',
    '',
  ].join('\n');
}

describe('stampManifest — a first dispatch fills the empty pid and nothing else', () => {
  it('replaces the empty placeholder and leaves every other line untouched', () => {
    const out = stampManifest(firstDispatch(''), { pid: '4242', startedAt: '2026-08-20T10:00:00Z' });
    assert.equal(out, firstDispatch('4242'),
      'a first stamp is exactly the old behaviour: fill the pid, touch nothing else');
  });

  it('adds no previousPid or relaunches on a first dispatch — byte-identical to today', () => {
    const out = stampManifest(firstDispatch(''), { pid: '4242', startedAt: '2026-08-20T10:00:00Z' });
    assert.ok(!out.includes('previousPid'), 'a first dispatch records no displaced pid');
    assert.ok(!out.includes('relaunches'), 'a first dispatch has relaunched zero times');
    const keys = Object.keys(JSON.parse(out));
    assert.deepEqual(keys.sort(),
      ['branch', 'command', 'pid', 'session', 'startedAt', 'worktree'],
      'the six launch-time keys, in the same shape the registry test pins');
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
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('leaves the manifest untouched when the file cannot be read', () => {
    // A missing manifest is not an error the caller must handle: the worker is
    // running regardless, and the registry already reads an absent pid as
    // unknown. The helper returns falsy rather than throwing.
    const missing = path.join(os.tmpdir(), 'plot-stamp-nope', 'x.json');
    assert.doesNotThrow(() => writeManifestStamp(missing, { pid: '1', startedAt: 'now' }));
  });
});
