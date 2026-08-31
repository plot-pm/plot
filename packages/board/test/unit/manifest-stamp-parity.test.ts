// ONE CONTRACT, TWO IMPLEMENTATIONS — proven byte-identical.
//
// `stampManifest` (TypeScript, called by `/api/continue`) and the dispatcher's
// inline `awk` (a fresh `sh -c` that cannot reach the TypeScript) must produce
// the SAME manifest for the same inputs. This test extracts the exact awk
// program from `plot-dispatch.sh` and runs it, then compares to the TS helper.
// It is the guard the plan requires: without it, a fix to one path leaves the
// other carrying the reported bug, which is the `plot-worker-state.sh` failure
// the whole "one contract" design exists to prevent.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { stampManifest } from '../../src/server/manifest-stamp.js';

const DISPATCH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../skills/plot/scripts/plot-dispatch.sh',
);

/**
 * The awk program the dispatcher runs, extracted from the script's source.
 *
 * Read from the file rather than duplicated here, so this test breaks if the
 * dispatcher's awk is edited without keeping parity — which is the entire point.
 * The program sits between `awk -v pid="$agent" -v started="$PLOT_STAMP_STARTED" '`
 * and the closing quote before the manifest path.
 */
function awkProgram(): string {
  const src = fs.readFileSync(DISPATCH, 'utf8');
  // The program is inside a `sh -c '...'` where every literal single quote is
  // written as the four-byte sequence '"'"'. Undo that escaping to recover the
  // awk source as awk will actually see it.
  const marker =
    'awk -v pid="$agent" -v started="$PLOT_STAMP_STARTED" '
    + '-v wrapper="$$" -v wmon="$wmon" -v amon="$amon" -v bmon="$bmon" ';
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, 'the dispatcher awk invocation moved — update this extractor');
  const after = src.slice(at + marker.length);
  // The awk program is opened by the escaped-quote sequence and closed by the
  // next one before ` "$PLOT_MANIFEST_FILE"`.
  const open = `'"'"'`;
  assert.ok(after.startsWith(open), 'the awk program does not open where expected');
  const body = after.slice(open.length);
  const end = body.indexOf(`'"'"' "$PLOT_MANIFEST_FILE"`);
  assert.notEqual(end, -1, 'could not find the end of the awk program');
  return body.slice(0, end);
}

/** The process group a stamp records — the wrapper and both monitors. */
interface Group {
  wrapperPid: string;
  workerMonitorPid: string;
  agentMonitorPid: string;
}

/** Run the dispatcher's awk over `text`, returning what it wrote. */
function runAwk(text: string, pid: string, started: string, g: Group): string {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'plot-parity-'));
  try {
    const f = path.join(dir, 'm.json');
    fs.writeFileSync(f, text);
    // The manifest is passed TWICE, exactly as the dispatcher invokes it: the
    // awk pre-scans on `FNR==NR` (pass one) and rewrites on pass two.
    const out = execFileSync(
      'awk',
      [
        '-v', `pid=${pid}`,
        '-v', `started=${started}`,
        '-v', `wrapper=${g.wrapperPid}`,
        '-v', `wmon=${g.workerMonitorPid}`,
        '-v', `amon=${g.agentMonitorPid}`,
        awkProgram(), f, f,
      ],
      { encoding: 'utf8' },
    );
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function manifest(pid: string, extra: string[] = []): string {
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

describe('the awk and stampManifest agree byte for byte', () => {
  const NOW = '2026-08-20T12:00:00Z';
  const GROUP: Group = {
    wrapperPid: '7358',
    workerMonitorPid: '7364',
    agentMonitorPid: '7365',
  };

  it('on a FIRST dispatch — empty placeholder, filled', () => {
    const input = manifest('');
    const fromAwk = runAwk(input, '4242', NOW, GROUP);
    const fromTs = stampManifest(input, { pid: '4242', startedAt: NOW, ...GROUP });
    assert.equal(fromAwk, fromTs);
  });

  it('on a RELAUNCH — a filled pid, updated and recorded', () => {
    const input = manifest('91471');
    const fromAwk = runAwk(input, '69993', NOW, GROUP);
    const fromTs = stampManifest(input, { pid: '69993', startedAt: NOW, ...GROUP });
    assert.equal(fromAwk, fromTs);
  });

  it('on a SECOND relaunch — an existing previousPid/relaunches, incremented', () => {
    const input = manifest('69993', [
      '  "previousPid": "91471",',
      '  "relaunches": 1,',
    ]);
    const fromAwk = runAwk(input, '70001', NOW, GROUP);
    const fromTs = stampManifest(input, { pid: '70001', startedAt: NOW, ...GROUP });
    assert.equal(fromAwk, fromTs);
  });

  // THE GROUP IS RE-EMITTED, NOT DUPLICATED. A manifest a first dispatch already
  // grouped is stamped again by `/api/continue`; both implementations must drop
  // the old lines and write this run's. The drop is unconditional in each — it is
  // not gated on the relaunch flag — and this pins that they agree on it.
  it('over an EXISTING group — the old lines replaced, on a first-dispatch shape', () => {
    const input = manifest('', [
      '  "wrapperPid": "111",',
      '  "workerMonitorPid": "222",',
      '  "agentMonitorPid": "333",',
    ]);
    const fromAwk = runAwk(input, '4242', NOW, GROUP);
    const fromTs = stampManifest(input, { pid: '4242', startedAt: NOW, ...GROUP });
    assert.equal(fromAwk, fromTs);
    assert.ok(!fromTs.includes('"wrapperPid": "111"'), 'the stale group must be gone');
    assert.equal(fromTs.match(/"wrapperPid"/g)?.length, 1, 'exactly one wrapperPid line');
  });

  it('over an EXISTING group — on a relaunch shape', () => {
    const input = manifest('69993', [
      '  "wrapperPid": "111",',
      '  "workerMonitorPid": "222",',
      '  "agentMonitorPid": "333",',
      '  "previousPid": "91471",',
      '  "relaunches": 1,',
    ]);
    const fromAwk = runAwk(input, '70001', NOW, GROUP);
    const fromTs = stampManifest(input, { pid: '70001', startedAt: NOW, ...GROUP });
    assert.equal(fromAwk, fromTs);
    assert.equal(fromTs.match(/"wrapperPid"/g)?.length, 1, 'exactly one wrapperPid line');
  });

  // A MEMBER THAT WAS NEVER STARTED records `''` rather than vanishing — *absent
  // is not none*. A hand-made worktree has no monitors; the field says so.
  it('with no monitors attached — empty values, not missing lines', () => {
    const input = manifest('');
    const none: Group = { wrapperPid: '7358', workerMonitorPid: '', agentMonitorPid: '' };
    const fromAwk = runAwk(input, '4242', NOW, none);
    const fromTs = stampManifest(input, { pid: '4242', startedAt: NOW, ...none });
    assert.equal(fromAwk, fromTs);
    assert.ok(fromTs.includes('"workerMonitorPid": "",'), 'the line is present and empty');
  });
});
