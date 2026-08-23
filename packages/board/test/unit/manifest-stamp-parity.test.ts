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
  const marker = 'awk -v pid="$agent" -v started="$PLOT_STAMP_STARTED" ';
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

/** Run the dispatcher's awk over `text`, returning what it wrote. */
function runAwk(text: string, pid: string, started: string): string {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'plot-parity-'));
  try {
    const f = path.join(dir, 'm.json');
    fs.writeFileSync(f, text);
    // The manifest is passed TWICE, exactly as the dispatcher invokes it: the
    // awk pre-scans on `FNR==NR` (pass one) and rewrites on pass two.
    const out = execFileSync(
      'awk',
      ['-v', `pid=${pid}`, '-v', `started=${started}`, awkProgram(), f, f],
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

  it('on a FIRST dispatch — empty placeholder, filled', () => {
    const input = manifest('');
    const fromAwk = runAwk(input, '4242', NOW);
    const fromTs = stampManifest(input, { pid: '4242', startedAt: NOW });
    assert.equal(fromAwk, fromTs);
  });

  it('on a RELAUNCH — a filled pid, updated and recorded', () => {
    const input = manifest('91471');
    const fromAwk = runAwk(input, '69993', NOW);
    const fromTs = stampManifest(input, { pid: '69993', startedAt: NOW });
    assert.equal(fromAwk, fromTs);
  });

  it('on a SECOND relaunch — an existing previousPid/relaunches, incremented', () => {
    const input = manifest('69993', [
      '  "previousPid": "91471",',
      '  "relaunches": 1,',
    ]);
    const fromAwk = runAwk(input, '70001', NOW);
    const fromTs = stampManifest(input, { pid: '70001', startedAt: NOW });
    assert.equal(fromAwk, fromTs);
  });
});
