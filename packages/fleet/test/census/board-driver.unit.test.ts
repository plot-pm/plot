import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { removeTree } from '../rm-tree.mjs';
import { boardArtifact, startBoard } from './board-driver.js';
import { startSession } from './census-session.js';
import { buildSandbox, type Sandbox } from './sandbox.js';

// The board scenarios' driver, run without `strace`: the census starts the
// shipped board in a sandbox, reads it once, holds and drops a page's event
// stream, marks a window and stops the board's whole group.

describe.skipIf(!existsSync(boardArtifact()))('the census board driver', () => {
  let box: Sandbox;
  let readStatus = 0;
  let stdout = '';
  let code: number | null = null;

  beforeAll(async () => {
    box = await buildSandbox({ host: 'github', desks: 0, openPrs: 5 });
    const board = await startBoard(box, { trace: false });
    try {
      readStatus = await board.read();
      const page = await board.attach();
      await page.detach();
      await board.mark('w0');
    } finally {
      const end = await board.stop();
      stdout = end.stdout;
      code = end.code;
    }
  }, 120_000);

  afterAll(async () => {
    await box?.remove();
  });

  it('serves the warm read', () => {
    expect(readStatus).toBe(200);
  });

  it('marks a window and stops the board', () => {
    expect(stdout).toMatch(/^census: marked w0$/m);
    expect(stdout).toMatch(/^census: stopped /m);
    expect(code).toBe(0);
  });
});

// A stand-in board that starts one child in its own process group, as the
// board starts its PR reader, and writes the child's pid to a file.
const DETACHING_BOARD = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
child.unref();
writeFileSync(process.env.CENSUS_TEST_PID_FILE, String(child.pid));
console.log('listening on http://localhost:1');
setInterval(() => {}, 1000);
`;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('the census board host', () => {
  it('ends a child the board started in its own process group before it reports the stop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plot-census-host-'));
    let child = 0;
    try {
      const board = join(dir, 'board.cjs');
      const pidFile = join(dir, 'child.pid');
      writeFileSync(board, DETACHING_BOARD);
      const session = startSession({
        command: process.execPath,
        args: [fileURLToPath(new URL('./board-host.mjs', import.meta.url)), board],
        cwd: dir,
        env: { ...process.env, CENSUS_TEST_PID_FILE: pidFile },
        trace: false,
      });
      await session.waitFor(/^census: board \d+ \d+$/, 30_000);
      child = Number(readFileSync(pidFile, 'utf8'));
      expect(isAlive(child)).toBe(true);

      session.send('stop');
      const end = await session.end(30_000);

      expect(end.stdout).toMatch(/^census: stopped /m);
      expect(isAlive(child)).toBe(false);
    } finally {
      if (child > 0 && isAlive(child)) process.kill(child, 'SIGKILL');
      removeTree(dir);
    }
  }, 60_000);
});
