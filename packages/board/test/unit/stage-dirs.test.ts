// A board build's stage directory is removed when the process ends mid-build,
// whether by `exit` or by SIGTERM — the `finally` that removes it on the normal
// path never runs on a signal.
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeStageDir, removeLiveStageDirs, removeStageDir } from '../../src/server/stage-dirs.js';
import { rmTree } from '../helpers.mjs';

const MODULE = fileURLToPath(new URL('../../src/server/stage-dirs.ts', import.meta.url));

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmTree(dir);
});

/**
 * Start a node process that installs the exit handlers, makes one stage
 * directory under `tmp`, prints its path, and then runs `then`.
 */
const child = (tmp: string, then: string) => {
  const source = [
    `const m = await import(${JSON.stringify(MODULE)});`,
    'm.removeStageDirsOnExit();',
    "process.stdout.write(m.makeStageDir('plot-stage-probe-') + '\\n');",
    then,
  ].join('\n');
  return spawn(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, TMPDIR: tmp },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
};

/** The first stdout line, which names the stage directory. */
const firstLine = (proc: ReturnType<typeof spawn>): Promise<string> =>
  new Promise((resolve, reject) => {
    let out = '';
    proc.stdout!.on('data', (chunk) => {
      out += String(chunk);
      const end = out.indexOf('\n');
      if (end >= 0) resolve(out.slice(0, end));
    });
    proc.once('exit', () => reject(new Error(`exited before naming its stage directory; stdout: ${out}`)));
  });

/** Wait for `proc` to exit, SIGKILL it at the bound, and answer how it ended. */
const exited = (proc: ReturnType<typeof spawn>, boundMs = 15_000) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve({ code: proc.exitCode, signal: proc.signalCode });
      return;
    }
    const timer = setTimeout(() => proc.kill('SIGKILL'), boundMs);
    proc.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

describe('stage directories', () => {
  it('removes a directory by the exact path it made', () => {
    const dir = makeStageDir('plot-stage-unit-');
    made.push(dir);
    assert.ok(path.basename(dir).startsWith('plot-stage-unit-'));
    assert.equal(path.dirname(dir), os.tmpdir());
    removeStageDir(dir);
    assert.equal(fs.existsSync(dir), false);
    assert.deepEqual(removeLiveStageDirs(), []);
  });

  it('removes every live directory when asked at exit', () => {
    const a = makeStageDir('plot-stage-unit-');
    const b = makeStageDir('plot-stage-unit-');
    made.push(a, b);
    fs.writeFileSync(path.join(a, 'plan.md'), '# A\n');
    assert.deepEqual(removeLiveStageDirs(), []);
    assert.equal(fs.existsSync(a), false);
    assert.equal(fs.existsSync(b), false);
  });

  it('a SIGTERM mid-build removes the directory, and the process still ends by SIGTERM', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-stage-term-'));
    made.push(tmp);
    const proc = child(tmp, 'setInterval(() => {}, 1000);');
    try {
      const dir = await firstLine(proc);
      assert.equal(fs.existsSync(dir), true, 'the stage directory exists while the build runs');
      proc.kill('SIGTERM');
      const ended = await exited(proc);
      assert.equal(ended.signal, 'SIGTERM');
      assert.equal(fs.existsSync(dir), false, `${dir} survived the SIGTERM`);
      assert.deepEqual(fs.readdirSync(tmp), []);
    } finally {
      proc.kill('SIGKILL');
      await exited(proc);
    }
  });

  it('process.exit mid-build removes the directory', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plot-stage-exit-'));
    made.push(tmp);
    const proc = child(tmp, 'process.exit(0);');
    const ended = await exited(proc);
    assert.equal(ended.code, 0);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
});
