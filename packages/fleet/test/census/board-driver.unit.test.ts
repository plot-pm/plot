import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boardArtifact, startBoard } from './board-driver.js';
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
